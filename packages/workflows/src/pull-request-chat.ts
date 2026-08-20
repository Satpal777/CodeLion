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
import { createInstallationOctokit, getPullRequestContext } from "@reviewer/github";
import {
  buildChatSystemPrompt,
  deriveMemoryCandidate,
  executeTextGeminiTask,
  formatChatReply,
  hybridRetrieve,
  isAuthorizedForAction,
  parseChatIntent,
  planReviewContext,
} from "@reviewer/ai";
import { and, eq, inArray } from "drizzle-orm";
import { inngest } from "./client";
import { pullRequestCommentReceived, repositoryDisabled } from "./events";

export interface UnifiedCommentDetails {
  id: number;
  body: string;
  authorLogin: string;
  authorAssociation: string;
  isReviewComment: boolean;
  inReplyToId: number | null;
  path: string | null;
  line: number | null;
}

export const pullRequestChatWorkflow = inngest.createFunction(
  {
    id: "pull-request-chat",
    retries: 3,
    concurrency: {
      limit: 1,
      key: "event.data.repositoryGithubId + ':' + event.data.pullRequestNumber",
    },
    triggers: [pullRequestCommentReceived],
    cancelOn: [{ event: repositoryDisabled, match: "data.repositoryGithubId" }],
  },
  async ({ event, step }) => {
    const data = event.data;
    const env = getServerEnv();
    const database = getDatabase(env.DATABASE_URL);

    // 1. Load repository and installation
    const repository = await step.run("load-repository", async () => {
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
      if (!row) throw new Error("Repository installation not found");
      return row;
    });

    const octokit = createInstallationOctokit(
      { appId: env.GITHUB_APP_ID, privateKey: decodeGithubPrivateKey(env.GITHUB_APP_PRIVATE_KEY_BASE64) },
      repository.installationExternalId,
    );

    // 2. Fetch comment details (supports both inline review comments and issue comments)
    const commentDetails: UnifiedCommentDetails = await step.run("fetch-comment", async () => {
      try {
        const { data: reviewComment } = await octokit.rest.pulls.getReviewComment({
          owner: repository.owner,
          repo: repository.name,
          comment_id: data.commentId,
        });
        return {
          id: reviewComment.id,
          body: reviewComment.body ?? "",
          authorLogin: reviewComment.user?.login ?? "unknown",
          authorAssociation: reviewComment.author_association ?? "NONE",
          isReviewComment: true,
          inReplyToId: reviewComment.in_reply_to_id ?? null,
          path: reviewComment.path ?? null,
          line: reviewComment.line ?? reviewComment.original_line ?? null,
        };
      } catch {
        const { data: comment } = await octokit.rest.issues.getComment({
          owner: repository.owner,
          repo: repository.name,
          comment_id: data.commentId,
        });
        return {
          id: comment.id,
          body: comment.body ?? "",
          authorLogin: comment.user?.login ?? "unknown",
          authorAssociation: comment.author_association ?? "NONE",
          isReviewComment: false,
          inReplyToId: null,
          path: null,
          line: null,
        };
      }
    });

    const botSlug = env.GITHUB_APP_SLUG ? env.GITHUB_APP_SLUG.toLowerCase() : "codelion";
    const bodyLower = commentDetails.body.toLowerCase();
    const isBotMentioned =
      bodyLower.includes(`@${botSlug}`) ||
      bodyLower.includes("@bot") ||
      bodyLower.includes("@codelion") ||
      bodyLower.includes("@reviewer") ||
      commentDetails.isReviewComment;

    // Helper to post reply to the right place
    const postReply = async (bodyText: string) => {
      if (commentDetails.isReviewComment) {
        try {
          await octokit.rest.pulls.createReplyForReviewComment({
            owner: repository.owner,
            repo: repository.name,
            pull_number: data.pullRequestNumber,
            comment_id: commentDetails.inReplyToId ?? commentDetails.id,
            body: bodyText,
          });
          return;
        } catch {
          // Fall through to issue comment if thread reply fails
        }
      }

      await octokit.rest.issues.createComment({
        owner: repository.owner,
        repo: repository.name,
        issue_number: data.pullRequestNumber,
        body: bodyText,
      });
    };

    if (!isBotMentioned) {
      return { skipped: "bot-not-mentioned" };
    }

    const intent = parseChatIntent(commentDetails.body, `@${botSlug}`);

    // 3. Authorization check
    const isAuthorized = isAuthorizedForAction(commentDetails.authorAssociation, intent.type);
    if (!isAuthorized) {
      await step.run("post-unauthorized-reply", async () => {
        await postReply(
          `Sorry @${commentDetails.authorLogin}, only repository collaborators can trigger mutating actions like fixes or merges.`,
        );
      });
      return { skipped: "unauthorized", user: commentDetails.authorLogin };
    }

    // 4. Handle Feedback Intent
    if (intent.type === "feedback") {
      const memoryResult = await step.run("process-feedback-intent", async () => {
        const candidate = deriveMemoryCandidate({
          verdict: intent.verdict,
          comment: intent.comment,
          explicitRemember: intent.explicitRemember && ["OWNER", "MEMBER"].includes(commentDetails.authorAssociation),
          requestedScope: intent.scope,
        });

        const [savedFeedback] = await database
          .insert(feedbackEvents)
          .values({
            workspaceId: repository.workspaceId,
            repositoryId: repository.id,
            source: "github_comment",
            verdict: intent.verdict,
            comment: intent.comment,
            explicitRemember: intent.explicitRemember,
          })
          .returning();

        return { feedbackId: savedFeedback?.id, candidate };
      });

      await step.run("reply-feedback-acknowledgement", async () => {
        const reply = intent.explicitRemember
          ? `Understood @${commentDetails.authorLogin}. I have recorded this preference for ${intent.scope ?? "repository"} reviews: *"${intent.comment}"*.`
          : `Thank you for the feedback @${commentDetails.authorLogin}. Recorded as candidate review learning.`;
        await postReply(reply);
      });

      return { intent: "feedback", memoryResult };
    }

    // 5. Handle Fix Intent -> Fan out to agentFixRequested
    if (intent.type === "fix") {
      const prContext = await getPullRequestContext(
        octokit,
        repository.owner,
        repository.name,
        data.pullRequestNumber,
      );

      await step.sendEvent("trigger-agent-fix", {
        name: "reviewer/agent.fix-requested",
        data: {
          repositoryId: repository.id,
          pullRequestNumber: data.pullRequestNumber,
          headSha: prContext.headSha,
          requesterLogin: commentDetails.authorLogin,
          instructions: intent.instructions,
          destination: intent.destination === "existing_branch" ? "existing_branch" : "stacked_pr",
        },
      });

      await step.run("reply-fix-started", async () => {
        const destDesc = intent.destination === "existing_branch" ? "existing PR branch" : "new draft PR";
        await postReply(
          `⏳ Working on proposed fix for @${commentDetails.authorLogin} (target: ${destDesc})...`,
        );
      });

      return { intent: "fix", status: "fix-workflow-queued" };
    }

    // 6. Handle Conversational / Explain Intent with Gemini
    const replyContent = await step.run("generate-conversational-reply", async () => {
      const prContext = await getPullRequestContext(
        octokit,
        repository.owner,
        repository.name,
        data.pullRequestNumber,
      );

      const paths = prContext.files.map((f) => f.path);
      const storedChunks = paths.length
        ? await database
            .select()
            .from(codeChunks)
            .where(and(eq(codeChunks.repositoryId, repository.id), inArray(codeChunks.path, paths)))
            .limit(100)
        : [];

      const terms = commentDetails.body.split(/\s+/).filter((t) => t.length > 2);
      const hybridCandidates = hybridRetrieve(
        { terms, symbols: [], paths },
        storedChunks.map((c) => ({
          path: c.path,
          language: (c.metadata as { language?: string })?.language ?? "typescript",
          symbol: c.symbol,
          startLine: c.startLine,
          endLine: c.endLine,
          content: c.content,
          contentHash: c.contentHash,
        }) as any),
      );

      const retrievedContext = planReviewContext(hybridCandidates, {
        targetCommit: prContext.headSha.slice(0, 7),
        maxTokens: 3000,
      });

      const activeMemories = await listActiveMemories(database, {
        workspaceId: repository.workspaceId,
        repositoryId: repository.id,
      });

      // Get latest review run findings
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

      const chatContext = {
        repository: `${repository.owner}/${repository.name}`,
        pullRequestNumber: prContext.number,
        title: prContext.title,
        description: prContext.body,
        baseSha: prContext.baseSha,
        headSha: prContext.headSha,
        changedFiles: prContext.files.map((f) => ({ path: f.path, changes: f.changes, patch: f.patch })),
        latestReview: latestRun
          ? {
              decision: latestRun.decision ?? "comment",
              summary: latestRun.summary ?? "",
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
            }
          : undefined,
        retrievedContext,
        activeMemories: activeMemories.map((m) => ({ id: m.id, rule: m.rule, rationale: m.rationale })),
        messages: [{ role: "user" as const, content: commentDetails.body, authorLogin: commentDetails.authorLogin }],
      };

      const systemPrompt = buildChatSystemPrompt(chatContext);
      const userPrompt = commentDetails.path && commentDetails.line
        ? `[Review finding context: comment placed on ${commentDetails.path}:${commentDetails.line}]\n\nUser Question/Comment:\n${commentDetails.body}`
        : commentDetails.body;

      let answer: string;
      try {
        const { output } = await executeTextGeminiTask({
          system: systemPrompt,
          prompt: userPrompt,
        });
        answer = output;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        answer = `I reviewed your comment on PR #${prContext.number}. (Note: AI generation encountered: ${message}).`;
      }

      return formatChatReply(answer, retrievedContext.slice(0, 3).map((c) => c.citation));
    });

    await step.run("post-chat-reply", async () => {
      await postReply(replyContent);
    });

    return { intent: intent.type, status: "replied" };
  },
);
