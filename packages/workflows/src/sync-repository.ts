import { decodeGithubPrivateKey, getServerEnv } from "@reviewer/config";
import {
  defaultRepositorySettings,
  getDatabase,
  githubInstallations,
  repositories,
} from "@reviewer/db";
import { createInstallationOctokit } from "@reviewer/github";
import { eq } from "drizzle-orm";
import { inngest } from "./client";
import { repositorySyncRequested } from "./events";

export const syncRepository = inngest.createFunction(
  {
    id: "sync-repository",
    retries: 3,
    triggers: [repositorySyncRequested],
  },
  async ({ event, step }) => {
    const data = event.data;
    const env = getServerEnv();
    const database = getDatabase(env.DATABASE_URL);
    const [installation] = await database
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.installationId, data.installationId))
      .limit(1);
    if (!installation) return { skipped: "unknown-installation" };

    const octokit = createInstallationOctokit(
      { appId: env.GITHUB_APP_ID, privateKey: decodeGithubPrivateKey(env.GITHUB_APP_PRIVATE_KEY_BASE64) },
      data.installationId,
    );
    const githubRepository = await step.run("fetch-repository", async () => {
      const response = await octokit.request("GET /repositories/{repository_id}", {
        repository_id: Number(data.repositoryGithubId),
      });
      return response.data;
    });

    const [existingRepository] = await database
      .select({ workspaceId: repositories.workspaceId })
      .from(repositories)
      .where(eq(repositories.githubRepositoryId, String(githubRepository.id)))
      .limit(1);
    if (existingRepository && existingRepository.workspaceId !== installation.workspaceId) {
      return { skipped: "repository-bound-to-another-workspace" };
    }

    const [repository] = await database
      .insert(repositories)
      .values({
        workspaceId: installation.workspaceId,
        installationId: installation.id,
        githubRepositoryId: String(githubRepository.id),
        owner: githubRepository.owner.login,
        name: githubRepository.name,
        defaultBranch: githubRepository.default_branch,
        isPrivate: githubRepository.private,
        settings: defaultRepositorySettings,
      })
      .onConflictDoUpdate({
        target: repositories.githubRepositoryId,
        set: {
          installationId: installation.id,
          owner: githubRepository.owner.login,
          name: githubRepository.name,
          defaultBranch: githubRepository.default_branch,
          isPrivate: githubRepository.private,
          updatedAt: new Date(),
        },
      })
      .returning();
    return { repositoryId: repository?.id ?? null };
  },
);
