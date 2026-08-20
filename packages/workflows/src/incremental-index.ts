import { decodeGithubPrivateKey, getServerEnv } from "@reviewer/config";
import {
  codeChunks,
  getDatabase,
  githubInstallations,
  repositories,
  repositoryFiles,
} from "@reviewer/db";
import { createInstallationOctokit } from "@reviewer/github";
import { chunkSource, detectLanguage, shouldIndexPath } from "@reviewer/ai";
import { and, eq, inArray } from "drizzle-orm";
import { inngest } from "./client";
import {
  repositoryDisabled,
  repositoryIncrementalIndexRequested,
  repositoryIndexCompleted,
} from "./events";

export const incrementalIndexWorkflow = inngest.createFunction(
  {
    id: "incremental-index-repository",
    retries: 3,
    concurrency: { limit: 1, key: "event.data.repositoryId" },
    triggers: [repositoryIncrementalIndexRequested],
    cancelOn: [{ event: repositoryDisabled, match: "data.repositoryId" }],
  },
  async ({ event, step }) => {
    const data = event.data;
    const env = getServerEnv();
    const database = getDatabase(env.DATABASE_URL);

    // 1. Load repository
    const repository = await step.run("load-repository", async () => {
      const [row] = await database
        .select({
          id: repositories.id,
          owner: repositories.owner,
          name: repositories.name,
          defaultBranch: repositories.defaultBranch,
          enabled: repositories.enabled,
          indexedSha: repositories.indexedSha,
          installationExternalId: githubInstallations.installationId,
        })
        .from(repositories)
        .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
        .where(eq(repositories.id, data.repositoryId))
        .limit(1);

      if (!row) throw new Error("Repository not found");
      if (!row.enabled) throw new Error("Repository indexing is disabled");
      return row;
    });

    const octokit = createInstallationOctokit(
      { appId: env.GITHUB_APP_ID, privateKey: decodeGithubPrivateKey(env.GITHUB_APP_PRIVATE_KEY_BASE64) },
      repository.installationExternalId,
    );

    // 2. Fetch commit comparison
    const diffPlan = await step.run("compare-commits", async () => {
      const { data: comparison } = await octokit.rest.repos.compareCommitsWithBasehead({
        owner: repository.owner,
        repo: repository.name,
        basehead: `${data.previousSha}...${data.newSha}`,
      });

      const addedOrModified = (comparison.files ?? []).filter(
        (f) =>
          (f.status === "added" || f.status === "modified") &&
          shouldIndexPath(f.filename) &&
          (f.changes ?? 0) <= 2000,
      );

      const removedPaths = (comparison.files ?? [])
        .filter((f) => f.status === "removed")
        .map((f) => f.filename);

      return {
        addedOrModified: addedOrModified.map((f) => ({
          path: f.filename,
          sha: f.sha,
          status: f.status,
        })),
        removedPaths,
      };
    });

    // 3. Process removed files
    if (diffPlan.removedPaths.length > 0) {
      await step.run("remove-deleted-files", async () => {
        await database
          .delete(repositoryFiles)
          .where(
            and(
              eq(repositoryFiles.repositoryId, repository.id),
              inArray(repositoryFiles.path, diffPlan.removedPaths),
            ),
          );
      });
    }

    // 4. Index added and modified files
    let newlyIndexedChunks = 0;
    for (const file of diffPlan.addedOrModified) {
      const result = await step.run(`index-changed-file-${file.path}`, async () => {
        if (!file.sha) return { chunksCount: 0 };
        const blobSha: string = file.sha;

        const { data: blob } = await octokit.rest.git.getBlob({
          owner: repository.owner,
          repo: repository.name,
          file_sha: blobSha,
        });

        if (blob.encoding !== "base64") return { chunksCount: 0 };
        const source = Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8");
        const language = detectLanguage(file.path);
        if (!language || source.includes("\u0000")) return { chunksCount: 0 };

        const chunks = chunkSource(file.path, language, source);

        const [storedFile] = await database
          .insert(repositoryFiles)
          .values({
            repositoryId: repository.id,
            path: file.path,
            blobSha,
            language,
            byteSize: source.length,
            indexedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [repositoryFiles.repositoryId, repositoryFiles.path],
            set: {
              blobSha,
              language,
              byteSize: source.length,
              indexedAt: new Date(),
            },
          })
          .returning({ id: repositoryFiles.id });

        if (storedFile) {
          await database.delete(codeChunks).where(eq(codeChunks.fileId, storedFile.id));
          if (chunks.length > 0) {
            await database.insert(codeChunks).values(
              chunks.map((chunk) => ({
                repositoryId: repository.id,
                fileId: storedFile.id,
                path: chunk.path,
                symbol: chunk.symbol,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                content: chunk.content,
                contentHash: chunk.contentHash,
                metadata: { language },
              })),
            );
          }
        }

        return { chunksCount: chunks.length };
      });
      newlyIndexedChunks += result.chunksCount;
    }

    // 5. Update repository indexed SHA
    await step.run("update-repository-sha", async () => {
      await database
        .update(repositories)
        .set({
          indexedSha: data.newSha,
          indexedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(repositories.id, repository.id));
    });

    await step.sendEvent(
      "notify-incremental-index-complete",
      repositoryIndexCompleted.create({
        repositoryId: repository.id,
        headSha: data.newSha,
        indexedFiles: diffPlan.addedOrModified.length,
        indexedChunks: newlyIndexedChunks,
      }),
    );

    return {
      repositoryId: repository.id,
      previousSha: data.previousSha,
      newSha: data.newSha,
      changedFilesIndexed: diffPlan.addedOrModified.length,
      deletedFilesRemoved: diffPlan.removedPaths.length,
    };
  },
);
