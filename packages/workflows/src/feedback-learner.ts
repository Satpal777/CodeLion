import { getServerEnv } from "@reviewer/config";
import {
  feedbackEvents,
  getDatabase,
  githubInstallations,
  memories,
  repositories,
} from "@reviewer/db";
import { deriveMemoryCandidate } from "@reviewer/ai";
import { and, eq } from "drizzle-orm";
import { inngest } from "./client";
import { pullRequestFeedbackReceived, repositoryDisabled } from "./events";

export const feedbackLearnerWorkflow = inngest.createFunction(
  {
    id: "feedback-learner",
    retries: 2,
    concurrency: {
      limit: 1,
      key: "event.data.repositoryGithubId",
    },
    triggers: [pullRequestFeedbackReceived],
    cancelOn: [{ event: repositoryDisabled, match: "data.repositoryGithubId" }],
  },
  async ({ event, step }) => {
    const data = event.data;
    const env = getServerEnv();
    const database = getDatabase(env.DATABASE_URL);

    // 1. Resolve repository
    const repository = await step.run("load-repository", async () => {
      const [row] = await database
        .select({
          id: repositories.id,
          workspaceId: repositories.workspaceId,
          owner: repositories.owner,
          name: repositories.name,
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

      if (!row) throw new Error("Repository not found for feedback");
      return row;
    });

    // 2. Record feedback event
    const feedback = await step.run("record-feedback-event", async () => {
      const [saved] = await database
        .insert(feedbackEvents)
        .values({
          workspaceId: repository.workspaceId,
          repositoryId: repository.id,
          source: data.source,
          verdict: data.verdict,
          comment: data.detail ?? `User marked finding as ${data.verdict} on PR #${data.pullRequestNumber}`,
        })
        .returning();

      return saved;
    });

    // 3. If feedback is negative/rejected, synthesize or promote memory candidate
    if (data.verdict === "rejected" && feedback) {
      await step.run("synthesize-memory-candidate", async () => {
        const candidate = deriveMemoryCandidate({
          verdict: "rejected",
          comment: data.detail ?? "",
          explicitRemember: false,
          requestedScope: "repository",
        });

        if (candidate) {
          await database
            .insert(memories)
            .values({
              workspaceId: repository.workspaceId,
              repositoryId: repository.id,
              scope: candidate.scope,
              status: candidate.promotable ? "active" : "candidate",
              fingerprint: candidate.fingerprint,
              rule: candidate.rule,
              rationale: candidate.rationale,
              confidence: candidate.confidence,
              sourceFeedbackId: feedback.id,
            })
            .onConflictDoNothing();
        }
      });
    }

    return { feedbackId: feedback?.id, verdict: data.verdict };
  },
);
