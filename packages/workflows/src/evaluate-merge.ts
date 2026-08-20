import { decodeGithubPrivateKey, getServerEnv } from "@reviewer/config";
import {
  getDatabase,
  githubInstallations,
  repositories,
  reviewFindings,
  reviewRuns,
  writeAuditEvent,
} from "@reviewer/db";
import {
  createInstallationOctokit,
  getPullRequestContext,
  getPullRequestState,
  mergePullRequestGuarded,
} from "@reviewer/github";
import {
  analyzeCIOutcomes,
  evaluateBranchProtection,
  evaluateCodeOwners,
  evaluateMergeGate,
  parseCodeOwners,
} from "@reviewer/ai";
import { and, eq } from "drizzle-orm";
import { inngest } from "./client";
import { evaluateMergeRequested, repositoryDisabled } from "./events";

export const evaluateMergeWorkflow = inngest.createFunction(
  {
    id: "evaluate-merge",
    retries: 2,
    concurrency: {
      limit: 1,
      key: "event.data.repositoryId + ':' + event.data.pullRequestNumber",
    },
    triggers: [evaluateMergeRequested],
    cancelOn: [{ event: repositoryDisabled, match: "data.repositoryId" }],
  },
  async ({ event, step }) => {
    const data = event.data;
    const env = getServerEnv();
    const database = getDatabase(env.DATABASE_URL);

    // 1. Load repository and settings
    const repository = await step.run("load-repository-settings", async () => {
      const [row] = await database
        .select({
          id: repositories.id,
          workspaceId: repositories.workspaceId,
          owner: repositories.owner,
          name: repositories.name,
          enabled: repositories.enabled,
          settings: repositories.settings,
          installationExternalId: githubInstallations.installationId,
        })
        .from(repositories)
        .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
        .where(eq(repositories.id, data.repositoryId))
        .limit(1);

      if (!row) throw new Error("Repository not found");
      return row;
    });

    const mergeMode = repository.settings.mergeMode ?? "never";
    if (mergeMode === "never") {
      return { skipped: "merge-mode-never" };
    }

    const octokit = createInstallationOctokit(
      { appId: env.GITHUB_APP_ID, privateKey: decodeGithubPrivateKey(env.GITHUB_APP_PRIVATE_KEY_BASE64) },
      repository.installationExternalId,
    );

    // 2. Load PR state and review findings
    const prState = await step.run("fetch-pr-and-reviews", async () => {
      const state = await getPullRequestState(
        octokit,
        repository.owner,
        repository.name,
        data.pullRequestNumber,
      );

      const prContext = await getPullRequestContext(
        octokit,
        repository.owner,
        repository.name,
        data.pullRequestNumber,
      );

      const [latestRun] = await database
        .select()
        .from(reviewRuns)
        .where(
          and(
            eq(reviewRuns.repositoryId, repository.id),
            eq(reviewRuns.pullRequestNumber, data.pullRequestNumber),
          ),
        )
        .orderBy(reviewRuns.createdAt)
        .limit(1);

      const findings = latestRun
        ? await database
            .select()
            .from(reviewFindings)
            .where(eq(reviewFindings.reviewRunId, latestRun.id))
        : [];

      return {
        state,
        prContext,
        latestRun,
        findings: findings.map((f) => ({
          severity: f.severity,
          category: f.category as any,
          title: f.title,
          explanation: f.body,
          path: f.path ?? "",
          line: f.line,
          side: (f.side as "RIGHT" | "LEFT") ?? "RIGHT",
          confidence: f.confidence,
          evidence: "",
          suggestedPatch: f.suggestedPatch,
          fingerprint: f.fingerprint,
          inlineEligible: f.publishedInline,
        })),
      };
    });

    // 3. Fetch check runs & CI status
    const ciData = await step.run("fetch-check-runs", async () => {
      try {
        const { data: suites } = await octokit.rest.checks.listSuitesForRef({
          owner: repository.owner,
          repo: repository.name,
          ref: prState.state.headSha,
        });
        const checkRuns: any[] = [];
        for (const suite of suites.check_suites) {
          const { data: runs } = await octokit.rest.checks.listForSuite({
            owner: repository.owner,
            repo: repository.name,
            check_suite_id: suite.id,
          });
          checkRuns.push(...runs.check_runs);
        }
        return checkRuns.map((r) => ({
          id: r.id,
          name: r.name,
          headSha: r.head_sha,
          status: r.status,
          conclusion: r.conclusion,
          startedAt: r.started_at,
          completedAt: r.completed_at,
          htmlUrl: r.html_url,
          outputTitle: r.output?.title ?? null,
          outputSummary: r.output?.summary ?? null,
          outputText: r.output?.text ?? null,
        }));
      } catch {
        return [];
      }
    });

    const ciAnalysis = analyzeCIOutcomes(
      ciData,
      prState.prContext.files.map((f) => f.path),
    );

    // 4. Evaluate Branch Protection & CODEOWNERS
    const branchProtectionEval = await step.run("evaluate-branch-protection", async () => {
      // List reviews on PR
      const { data: reviews } = await octokit.rest.pulls.listReviews({
        owner: repository.owner,
        repo: repository.name,
        pull_number: data.pullRequestNumber,
      });

      const humanApprovals = reviews
        .filter((r) => r.state === "APPROVED" && r.user?.type !== "Bot")
        .map((r) => r.user?.login ?? "");

      const humanChangeRequests = reviews
        .filter((r) => r.state === "CHANGES_REQUESTED" && r.user?.type !== "Bot")
        .map((r) => r.user?.login ?? "");

      // Try fetching CODEOWNERS if available
      let codeOwnersEvaluation;
      try {
        const { data: codeOwnersFile } = await octokit.rest.repos.getContent({
          owner: repository.owner,
          repo: repository.name,
          path: ".github/CODEOWNERS",
          ref: prState.state.headSha,
        });
        if ("content" in codeOwnersFile && codeOwnersFile.encoding === "base64") {
          const content = Buffer.from(codeOwnersFile.content, "base64").toString("utf8");
          const rules = parseCodeOwners(content);
          codeOwnersEvaluation = evaluateCodeOwners(
            rules,
            prState.prContext.files.map((f) => f.path),
            humanApprovals,
          );
        }
      } catch {
        // No CODEOWNERS file
      }

      return evaluateBranchProtection(
        {
          requiredApprovingReviewCount: 1,
          requireCodeOwnerReviews: Boolean(codeOwnersEvaluation),
          dismissStaleReviews: false,
          requireLinearHistory: false,
          requiredStatusCheckContexts: [],
          strictRequiredStatusChecks: false,
          enforceAdmins: false,
          allowForcePushes: false,
          allowDeletions: false,
        },
        {
          humanApprovals,
          humanChangeRequests,
          completedCheckContexts: ciData.map((c) => ({
            name: c.name,
            state: c.conclusion === "success" ? "success" : c.conclusion ? "failure" : "pending",
          })),
          codeOwnersEvaluation,
        },
      );
    });

    // 5. Evaluate Merge Gate
    const mergeDecision = evaluateMergeGate({
      repositoryMergeMode: mergeMode,
      pullRequest: {
        number: data.pullRequestNumber,
        headSha: prState.state.headSha,
        reviewedSha: prState.latestRun?.headSha ?? prState.state.headSha,
        state: prState.state.state as any,
        draft: prState.state.draft,
        mergeable: prState.state.merged ? false : true,
      },
      reviewFindings: prState.findings,
      ciAnalysis,
      branchProtectionEvaluation: branchProtectionEval,
      protectedPathsClean: true,
      executorAppActive: true,
    });

    if (!mergeDecision.allowed) {
      return {
        status: "denied",
        decision: mergeDecision,
      };
    }

    // 6. Execute Merge if allowed
    const mergeResult = await step.run("execute-guarded-merge", async () => {
      return mergePullRequestGuarded(octokit, {
        owner: repository.owner,
        repo: repository.name,
        pullNumber: data.pullRequestNumber,
        expectedHeadSha: prState.state.headSha,
        reviewApproved: prState.latestRun?.decision === "approve",
        policyAllowsMerge: mergeDecision.allowed,
        requiredChecksPassed: ciAnalysis.allRequiredPassed,
        mergeMethod: "squash",
      });
    });

    // 7. Write Audit Event
    await step.run("write-merge-audit", async () => {
      await writeAuditEvent(database, {
        workspaceId: repository.workspaceId,
        action: "pull_request.auto_merged",
        targetType: "pull_request",
        targetId: String(data.pullRequestNumber),
        outcome: "success",
        metadata: {
          headSha: prState.state.headSha,
          mergeMethod: "squash",
          triggeredBy: data.triggeredBy,
        },
      });
    });

    return {
      status: "merged",
      decision: mergeDecision,
      mergeResult: mergeResult.data,
    };
  },
);
