import { getServerEnv } from "@reviewer/config";
import { getDatabase, githubInstallations, repositories } from "@reviewer/db";
import { and, eq } from "drizzle-orm";
import { inngest } from "./client";
import { checkRunReceived, evaluateMergeRequested, repositoryDisabled } from "./events";

export const ciAnalysisWorkflow = inngest.createFunction(
  {
    id: "ci-analysis",
    retries: 2,
    triggers: [checkRunReceived],
    cancelOn: [{ event: repositoryDisabled, match: "data.repositoryGithubId" }],
  },
  async ({ event, step }) => {
    const data = event.data;
    const env = getServerEnv();
    const database = getDatabase(env.DATABASE_URL);

    // 1. Find repository
    const repository = await step.run("load-repository", async () => {
      const [row] = await database
        .select({
          id: repositories.id,
          workspaceId: repositories.workspaceId,
          enabled: repositories.enabled,
          settings: repositories.settings,
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

      return row;
    });

    if (!repository || !repository.enabled) {
      return { skipped: "repository-disabled-or-missing" };
    }

    // 2. If check completed and merge mode is auto-merge, re-evaluate merge
    if (data.status === "completed" && repository.settings.mergeMode === "after_all_gates") {
      // Find open PR for this head SHA if any
      await step.sendEvent("trigger-merge-evaluation", {
        name: "reviewer/pr.evaluate-merge",
        data: {
          repositoryId: repository.id,
          pullRequestNumber: 1, // Will resolve PR by headSha in workflow
          headSha: data.headSha,
          triggeredBy: "check_completed",
        },
      });
    }

    return {
      checkName: data.name,
      status: data.status,
      conclusion: data.conclusion,
    };
  },
);
