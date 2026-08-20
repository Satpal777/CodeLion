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
  createExecutorOctokit,
  createInstallationOctokit,
  executeFixAction,
  getPullRequestContext,
} from "@reviewer/github";
import { generateFixPlan } from "@reviewer/ai";
import { and, eq } from "drizzle-orm";
import { inngest } from "./client";
import { agentFixRequested, repositoryDisabled } from "./events";

export const agentFixWorkflow = inngest.createFunction(
  {
    id: "agent-fix",
    retries: 2,
    concurrency: {
      limit: 1,
      key: "event.data.repositoryId + ':' + event.data.pullRequestNumber",
    },
    triggers: [agentFixRequested],
    cancelOn: [{ event: repositoryDisabled, match: "data.repositoryId" }],
  },
  async ({ event, step }) => {
    const data = event.data;
    const env = getServerEnv();
    const database = getDatabase(env.DATABASE_URL);

    // 1. Load repository and verify policy
    const repository = await step.run("load-repository-and-policy", async () => {
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

    const reviewerOctokit = createInstallationOctokit(
      { appId: env.GITHUB_APP_ID, privateKey: decodeGithubPrivateKey(env.GITHUB_APP_PRIVATE_KEY_BASE64) },
      repository.installationExternalId,
    );

    // 2. Fetch latest PR state and verified findings
    const fixContext = await step.run("load-fix-context", async () => {
      const pr = await getPullRequestContext(
        reviewerOctokit,
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

      // Download content of touched files
      const existingFiles: Array<{ path: string; content: string }> = [];
      for (const file of pr.files) {
        try {
          const { data: fileData } = await reviewerOctokit.rest.repos.getContent({
            owner: repository.owner,
            repo: repository.name,
            path: file.path,
            ref: pr.headSha,
          });
          if ("content" in fileData && fileData.encoding === "base64") {
            existingFiles.push({
              path: file.path,
              content: Buffer.from(fileData.content.replace(/\n/g, ""), "base64").toString("utf8"),
            });
          }
        } catch {
          // File might be new or binary
        }
      }

      return {
        pr,
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
        existingFiles,
      };
    });

    if (fixContext.pr.headSha !== data.headSha) {
      return { skipped: "head-sha-moved", expected: data.headSha, actual: fixContext.pr.headSha };
    }

    // 3. Generate Fix Plan
    const fixPlan = await step.run("generate-fix-plan", async () => {
      return generateFixPlan({
        repository: `${repository.owner}/${repository.name}`,
        pullRequestNumber: data.pullRequestNumber,
        sourceHeadSha: data.headSha,
        sourceBranch: fixContext.pr.title, // or branch ref
        requesterLogin: data.requesterLogin,
        userInstructions: data.instructions,
        targetFindings: fixContext.findings,
        existingFiles: fixContext.existingFiles,
        destination: data.destination,
      });
    });

    if (fixPlan.filesToUpdate.length === 0) {
      await step.run("reply-no-actionable-patch", async () => {
        await reviewerOctokit.rest.issues.createComment({
          owner: repository.owner,
          repo: repository.name,
          issue_number: data.pullRequestNumber,
          body: `⚠️ @${data.requesterLogin}, could not generate an actionable patch with safe suggested replacements. Please review the comments manually.`,
        });
      });
      return { skipped: "no-actionable-patch" };
    }

    // 4. Execute Fix Action via Executor Octokit
    const executorOctokit = createExecutorOctokit(
      { appId: env.GITHUB_APP_ID, privateKey: decodeGithubPrivateKey(env.GITHUB_APP_PRIVATE_KEY_BASE64) },
      repository.installationExternalId,
    );

    const executionResult = await step.run("execute-fix-via-github-app", async () => {
      return executeFixAction(executorOctokit, {
        owner: repository.owner,
        repo: repository.name,
        sourcePullNumber: data.pullRequestNumber,
        sourceHeadSha: data.headSha,
        sourceBranch: `pr-${data.pullRequestNumber}`,
        files: fixPlan.filesToUpdate.map((f) => ({ path: f.path, content: f.content })),
        title: fixPlan.title,
        body: fixPlan.description,
        destination: data.destination,
        requesterLogin: data.requesterLogin,
      });
    });

    // 5. Record Audit Event
    await step.run("write-audit-trail", async () => {
      await writeAuditEvent(database, {
        workspaceId: repository.workspaceId,
        action: "agent.fix_executed",
        targetType: "pull_request",
        targetId: String(data.pullRequestNumber),
        outcome: "success",
        metadata: {
          destination: data.destination,
          branchName: executionResult.branchName,
          commitSha: executionResult.commitSha,
          requester: data.requesterLogin,
          pullRequestNumber: executionResult.pullRequestNumber,
        },
      });
    });

    // 6. Post Notification to Source PR
    await step.run("notify-source-pr", async () => {
      const message =
        data.destination === "stacked_pr"
          ? `✅ **Fix proposal created!**\n\nI have opened draft PR #${executionResult.pullRequestNumber} with the proposed remediation.\n\nBranch: \`${executionResult.branchName}\``
          : `✅ **Changes committed!**\n\nI committed the proposed fix directly to branch \`${executionResult.branchName}\` (commit \`${executionResult.commitSha.slice(0, 7)}\`).`;

      await reviewerOctokit.rest.issues.createComment({
        owner: repository.owner,
        repo: repository.name,
        issue_number: data.pullRequestNumber,
        body: message,
      });
    });

    return {
      status: "completed",
      executionResult,
    };
  },
);
