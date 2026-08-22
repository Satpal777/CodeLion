import {
  aggregateBatchReviewResults,
  enrichDiffWithCallersAndPrevState,
  evaluateSuggestionAccepted,
  orderApplicableMemories,
  partitionReviewBatches,
  recordSpanAttributes,
  renderReviewBody,
  reviewPullRequest,
  type ReviewResult,
} from "@reviewer/ai";
import { decodeGithubPrivateKey, getServerEnv } from "@reviewer/config";
import {
  codeChunks,
  feedbackEvents,
  getDatabase,
  githubInstallations,
  listActiveMemories,
  repositories,
  reviewFindings,
  reviewRuns,
} from "@reviewer/db";
import {
  createInstallationOctokit,
  getPullRequestContext,
  getPullRequestState,
  publishPullRequestReviewIdempotent,
} from "@reviewer/github";
import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { inngest } from "./client";
import { pullRequestReviewRequested, repositoryDisabled, repositoryIndexCompleted } from "./events";

export const reviewPullRequestWorkflow = inngest.createFunction(
  {
    id: "review-pull-request",
    retries: 3,
    concurrency: {
      limit: 1,
      key: "event.data.repositoryGithubId + ':' + event.data.pullRequestNumber",
    },
    triggers: [pullRequestReviewRequested],
    cancelOn: [{ event: repositoryDisabled, match: "data.repositoryGithubId" }],
  },
  async ({ event, step }) => {
    const data = event.data;
    const env = getServerEnv();
    const database = getDatabase(env.DATABASE_URL);

    const repository = await step.run("load-policy", async () => {
      const [row] = await database
        .select({
          id: repositories.id,
          workspaceId: repositories.workspaceId,
          owner: repositories.owner,
          name: repositories.name,
          enabled: repositories.enabled,
          state: repositories.state,
          settings: repositories.settings,
          installationExternalId: githubInstallations.installationId,
        })
        .from(repositories)
        .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
        .where(
          and(
            eq(repositories.githubRepositoryId, data.repositoryGithubId),
            eq(githubInstallations.installationId, data.installationId),
          ),
        )
        .limit(1);
      if (!row) throw new Error("Repository installation is not connected");
      if (!row.enabled || !row.settings.reviewsEnabled) return { ...row, skipReason: "reviews-disabled" };
      return { ...row, skipReason: null };
    });
    if (repository.skipReason) return { skipped: repository.skipReason };

    if (repository.state !== "ready") {
      const completedIndex = await step.waitForEvent("wait-for-repository-index", {
        event: repositoryIndexCompleted,
        timeout: "30m",
        if: `async.data.repositoryId == '${repository.id}'`,
      });
      if (!completedIndex) return { skipped: "index-timeout" };
      const [refreshed] = await database
        .select({ state: repositories.state, enabled: repositories.enabled, settings: repositories.settings })
        .from(repositories)
        .where(eq(repositories.id, repository.id))
        .limit(1);
      if (!refreshed?.enabled || !refreshed.settings.reviewsEnabled || refreshed.state !== "ready") {
        return { skipped: "repository-not-ready" };
      }
    }

    const octokit = createInstallationOctokit(
      { appId: env.GITHUB_APP_ID, privateKey: decodeGithubPrivateKey(env.GITHUB_APP_PRIVATE_KEY_BASE64) },
      repository.installationExternalId,
    );

    const pullRequest = await step.run("fetch-pull-request-metadata", async () => {
      const current = await getPullRequestContext(
        octokit,
        repository.owner,
        repository.name,
        data.pullRequestNumber,
      );
      return {
        number: current.number,
        title: current.title,
        body: current.body,
        author: current.author,
        baseSha: current.baseSha,
        headSha: current.headSha,
        files: current.files.map(({ patch: _patch, ...file }) => file),
      };
    });
    if (pullRequest.headSha !== data.headSha) {
      return { skipped: "superseded-head", expected: data.headSha, actual: pullRequest.headSha };
    }

    const totalChangedLines = pullRequest.files.reduce((total, file) => total + file.changes, 0);
    if (totalChangedLines > env.MAX_PR_CHANGED_LINES) {
      return { skipped: "pull-request-too-large", totalChangedLines };
    }

    const reviewRun = await step.run("create-review-run", async () => {
      const inserted = await database
        .insert(reviewRuns)
        .values({
          repositoryId: repository.id,
          pullRequestNumber: pullRequest.number,
          headSha: pullRequest.headSha,
          baseSha: pullRequest.baseSha,
          state: "running",
          model: env.AI_REVIEW_MODEL,
          startedAt: new Date(),
        })
        .onConflictDoNothing({
          target: [reviewRuns.repositoryId, reviewRuns.pullRequestNumber, reviewRuns.headSha],
        })
        .returning();
      if (inserted[0]) return inserted[0];
      const [existing] = await database
        .select()
        .from(reviewRuns)
        .where(
          and(
            eq(reviewRuns.repositoryId, repository.id),
            eq(reviewRuns.pullRequestNumber, pullRequest.number),
            eq(reviewRuns.headSha, pullRequest.headSha),
          ),
        )
        .limit(1);
      if (!existing) throw new Error("Unable to create review run");
      return existing;
    });
    if (reviewRun.state === "completed" && reviewRun.githubReviewId) {
      return { reused: true, reviewRunId: reviewRun.id, githubReviewId: reviewRun.githubReviewId };
    }

    // Reconcile whether suggestions from previous review runs on this PR were committed/applied
    await step.run("reconcile-previous-suggestions", async () => {
      const previousRuns = await database
        .select({ id: reviewRuns.id })
        .from(reviewRuns)
        .where(
          and(
            eq(reviewRuns.repositoryId, repository.id),
            eq(reviewRuns.pullRequestNumber, pullRequest.number),
            ne(reviewRuns.id, reviewRun.id),
            eq(reviewRuns.state, "completed"),
          ),
        )
        .orderBy(desc(reviewRuns.createdAt))
        .limit(3);

      if (previousRuns.length === 0) return { reconciled: 0 };

      const runIds = previousRuns.map((r) => r.id);
      const findingsWithSuggestions = await database
        .select()
        .from(reviewFindings)
        .where(
          and(
            inArray(reviewFindings.reviewRunId, runIds),
            isNotNull(reviewFindings.suggestedPatch),
          ),
        );

      const currentPr = await getPullRequestContext(
        octokit,
        repository.owner,
        repository.name,
        pullRequest.number,
      );

      let acceptedCount = 0;
      for (const finding of findingsWithSuggestions) {
        const file = currentPr.files.find((f) => f.path === finding.path);
        if (!file?.patch) continue;

        const check = evaluateSuggestionAccepted(
          {
            findingId: finding.id,
            reviewRunId: finding.reviewRunId,
            path: finding.path ?? "",
            line: finding.line,
            title: finding.title,
            suggestedPatch: finding.suggestedPatch,
          },
          file.patch,
        );

        if (check.accepted) {
          await database
            .insert(feedbackEvents)
            .values({
              workspaceId: repository.workspaceId,
              repositoryId: repository.id,
              reviewRunId: finding.reviewRunId,
              findingId: finding.id,
              source: "git_commit_suggestion_applied",
              verdict: "accepted",
              comment: `Suggestion for '${finding.title}' was committed in subsequent PR push (${pullRequest.headSha.slice(0, 7)}).`,
            })
            .onConflictDoNothing();
          acceptedCount += 1;
        }
      }

      return { reconciled: acceptedCount };
    });

    // Batched Review Execution with Caller & Function State Enrichment
    const result = await step.run("run-batched-review", async (): Promise<ReviewResult> => {
      const current = await getPullRequestContext(
        octokit,
        repository.owner,
        repository.name,
        data.pullRequestNumber,
      );
      if (current.headSha !== data.headSha) throw new Error("Pull request head changed before model execution");

      // Partition into focused batches, skipping generated bloat/lock files
      const { reviewBatches, skippedFiles } = partitionReviewBatches(current.files, {
        maxFilesPerBatch: 8,
        maxLinesPerBatch: 1200,
      });

      if (reviewBatches.length === 0) {
        return {
          decision: "approve",
          summary: `Approved. All ${skippedFiles.length} changed files are generated locks or binary assets.`,
          riskScore: 0,
          findings: [],
          positiveNotes: [],
          testRecommendations: [],
          uncertainty: [],
          suppressedFindingCount: 0,
        };
      }

      const paths = current.files.map((file) => file.path);
      const storedChunks = paths.length
        ? await database
            .select({
              path: codeChunks.path,
              startLine: codeChunks.startLine,
              endLine: codeChunks.endLine,
              symbol: codeChunks.symbol,
              content: codeChunks.content,
            })
            .from(codeChunks)
            .where(and(eq(codeChunks.repositoryId, repository.id), inArray(codeChunks.path, paths)))
            .limit(100)
        : [];

      const activeMemories = await listActiveMemories(database, {
        workspaceId: repository.workspaceId,
        repositoryId: repository.id,
      });
      const orderedMemories = orderApplicableMemories(
        activeMemories.map((memory) => ({
          id: memory.id,
          scope: memory.scope,
          rule: memory.rule,
          confidence: memory.confidence,
          createdAt: memory.createdAt,
        })),
      );

      const batchResults: ReviewResult[] = [];

      for (const batch of reviewBatches) {
        const batchPaths = batch.files.map((f) => f.path);
        const batchContext = storedChunks.filter((c) => batchPaths.includes(c.path));
        const symbolDeltas = enrichDiffWithCallersAndPrevState(batch.files, storedChunks);

        const batchReview = await reviewPullRequest({
          repository: `${repository.owner}/${repository.name}`,
          pullRequestNumber: current.number,
          title: `${current.title} (${batch.batchName})`,
          description: current.body,
          baseSha: current.baseSha,
          headSha: current.headSha,
          files: batch.files,
          context: batchContext,
          symbolDeltas,
          memories: orderedMemories.map((memory) => ({
            id: memory.id,
            scope: memory.scope,
            rule: memory.rule,
            rationale: activeMemories.find((stored) => stored.id === memory.id)?.rationale ?? "Learned preference",
          })),
          trustedInstructions: repository.settings.customInstructions,
          minimumConfidence: repository.settings.minimumConfidence,
          model: env.AI_REVIEW_MODEL,
          useOpenAICompatible: true,
        });

        batchResults.push(batchReview);
      }

      const aggregated = aggregateBatchReviewResults(batchResults, skippedFiles.length);
      recordSpanAttributes({
        "reviewer.decision": aggregated.decision,
        "reviewer.risk_score": aggregated.riskScore,
        "reviewer.findings_count": aggregated.findings.length,
      });
      return aggregated;
    });

    await step.run("persist-findings", async () => {
      await database.delete(reviewFindings).where(eq(reviewFindings.reviewRunId, reviewRun.id));
      if (result.findings?.length) {
        await database.insert(reviewFindings).values(
          result.findings.map((finding) => ({
            reviewRunId: reviewRun.id,
            fingerprint: finding.fingerprint,
            severity: finding.severity,
            category: finding.category,
            title: finding.title,
            body: finding.explanation,
            path: finding.path,
            line: finding.line,
            side: finding.side,
            confidence: finding.confidence,
            suggestedPatch: finding.suggestedPatch,
            publishedInline: finding.inlineEligible,
          })),
        );
      }
      await database
        .update(reviewRuns)
        .set({
          decision: result.decision as "approve" | "comment" | "request_changes",
          summary: result.summary,
          riskScore: result.riskScore,
          updatedAt: new Date(),
        })
        .where(eq(reviewRuns.id, reviewRun.id));
    });

    const published = await step.run("publish-github-review", async () => {
      const [activeRepository] = await database
        .select({ enabled: repositories.enabled, settings: repositories.settings })
        .from(repositories)
        .where(eq(repositories.id, repository.id))
        .limit(1);
      if (!activeRepository?.enabled || !activeRepository.settings.reviewsEnabled) {
        throw new Error("Repository review access was disabled before publication");
      }
      const current = await getPullRequestState(
        octokit,
        repository.owner,
        repository.name,
        pullRequest.number,
      );
      if (current.headSha !== pullRequest.headSha || current.state !== "open" || current.merged) {
        throw new Error("Pull request changed before publication");
      }
      return publishPullRequestReviewIdempotent(octokit, {
        idempotencyKey: reviewRun.id,
        owner: repository.owner,
        repo: repository.name,
        pullNumber: pullRequest.number,
        headSha: pullRequest.headSha,
        decision: result.decision as "approve" | "comment" | "request_changes",
        body: renderReviewBody(result as unknown as ReviewResult),
        comments: (result.findings ?? [])
          .filter(
            (finding): finding is typeof finding & { line: number; side: "RIGHT" | "LEFT" } =>
              Boolean(finding && finding.inlineEligible && finding.line !== null && finding.side !== null),
          )
          .slice(0, 20)
          .map((finding) => ({
            path: finding.path,
            line: finding.line,
            side: finding.side,
            body: `**${finding.severity.toUpperCase()}: ${finding.title}**\n\n${finding.explanation}${
              finding.suggestedPatch ? `\n\n\`\`\`suggestion\n${finding.suggestedPatch}\n\`\`\`` : ""
            }`,
          })),
      });
    });

    await step.run("complete-review", async () => {
      await database
        .update(reviewRuns)
        .set({
          state: "completed",
          githubReviewId: String(published.data.id),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(reviewRuns.id, reviewRun.id));
    });

    return {
      reviewRunId: reviewRun.id,
      githubReviewId: String(published.data.id),
      decision: result.decision,
      findingCount: result.findings.length,
      reused: published.reused,
      modelUsed: result.modelUsed ?? env.AI_REVIEW_MODEL,
    };
  },
);

