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
import { and, eq, notInArray } from "drizzle-orm";
import { inngest } from "./client";
import { repositoryDisabled, repositoryIndexCompleted, repositoryIndexRequested } from "./events";

export const indexRepository = inngest.createFunction(
  {
    id: "index-repository",
    retries: 3,
    concurrency: { limit: 1, key: "event.data.repositoryId" },
    triggers: [repositoryIndexRequested],
    cancelOn: [{ event: repositoryDisabled, match: "data.repositoryId" }],
  },
  async ({ event, step }) => {
    const data = event.data;
    const env = getServerEnv();
    const database = getDatabase(env.DATABASE_URL);

    const repository = await step.run("load-repository", async () => {
      const [row] = await database
        .select({
          id: repositories.id,
          owner: repositories.owner,
          name: repositories.name,
          defaultBranch: repositories.defaultBranch,
          enabled: repositories.enabled,
          installationExternalId: githubInstallations.installationId,
        })
        .from(repositories)
        .innerJoin(githubInstallations, eq(repositories.installationId, githubInstallations.id))
        .where(eq(repositories.id, data.repositoryId))
        .limit(1);
      if (!row) throw new Error("Repository not found");
      if (!row.enabled) throw new Error("Repository indexing is disabled");
      await database
        .update(repositories)
        .set({ state: "indexing", updatedAt: new Date() })
        .where(eq(repositories.id, row.id));
      return row;
    });

    const octokit = createInstallationOctokit(
      { appId: env.GITHUB_APP_ID, privateKey: decodeGithubPrivateKey(env.GITHUB_APP_PRIVATE_KEY_BASE64) },
      repository.installationExternalId,
    );

    const snapshot = await step.run("fetch-tree", async () => {
      const { data: branch } = await octokit.rest.repos.getBranch({
        owner: repository.owner,
        repo: repository.name,
        branch: repository.defaultBranch,
      });
      const headSha = branch.commit.sha;
      const { data: tree } = await octokit.rest.git.getTree({
        owner: repository.owner,
        repo: repository.name,
        tree_sha: headSha,
        recursive: "true",
      });
      if (tree.truncated) throw new Error("Repository tree is too large for recursive indexing");
      return {
        headSha,
        files: tree.tree.flatMap((entry) => {
          if (
            entry.type !== "blob" ||
            !entry.path ||
            !entry.sha ||
            !shouldIndexPath(entry.path) ||
            (entry.size ?? 0) > env.MAX_INDEX_FILE_BYTES
          ) {
            return [];
          }
          return [{ path: entry.path, sha: entry.sha, size: entry.size ?? 0 }];
        }),
      };
    });

    const batchSize = 20;
    let indexedFiles = 0;
    let indexedChunks = 0;
    for (let offset = 0; offset < snapshot.files.length; offset += batchSize) {
      const batch = snapshot.files.slice(offset, offset + batchSize);
      const result = await step.run(`index-batch-${offset / batchSize}`, async () => {
        const contents = await Promise.all(
          batch.map(async (file) => {
            const { data: blob } = await octokit.rest.git.getBlob({
              owner: repository.owner,
              repo: repository.name,
              file_sha: file.sha,
            });
            if (blob.encoding !== "base64") return null;
            const source = Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString("utf8");
            const language = detectLanguage(file.path);
            if (!language || source.includes("\u0000")) return null;
            return { ...file, source, language, chunks: chunkSource(file.path, language, source) };
          }),
        );

        let filesWritten = 0;
        let chunksWritten = 0;
        for (const file of contents) {
          if (!file) continue;
          const [storedFile] = await database
            .insert(repositoryFiles)
            .values({
              repositoryId: repository.id,
              path: file.path,
              blobSha: file.sha,
              language: file.language,
              byteSize: file.size,
              indexedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [repositoryFiles.repositoryId, repositoryFiles.path],
              set: {
                blobSha: file.sha,
                language: file.language,
                byteSize: file.size,
                indexedAt: new Date(),
              },
            })
            .returning({ id: repositoryFiles.id });
          if (!storedFile) continue;
          await database.delete(codeChunks).where(eq(codeChunks.fileId, storedFile.id));
          if (file.chunks.length) {
            await database.insert(codeChunks).values(
              file.chunks.map((chunk) => ({
                repositoryId: repository.id,
                fileId: storedFile.id,
                path: chunk.path,
                symbol: chunk.symbol,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                content: chunk.content,
                contentHash: chunk.contentHash,
                metadata: { language: file.language },
              })),
            );
          }
          filesWritten += 1;
          chunksWritten += file.chunks.length;
        }
        return { filesWritten, chunksWritten };
      });
      indexedFiles += result.filesWritten;
      indexedChunks += result.chunksWritten;
    }

    await step.run("remove-stale-files", async () => {
      const currentPaths = snapshot.files.map((file) => file.path);
      const predicate = currentPaths.length
        ? and(
            eq(repositoryFiles.repositoryId, repository.id),
            notInArray(repositoryFiles.path, currentPaths),
          )
        : eq(repositoryFiles.repositoryId, repository.id);
      await database.delete(repositoryFiles).where(predicate);
    });

    const markedReady = await step.run("mark-index-ready", async () => {
      const updated = await database
        .update(repositories)
        .set({
          state: "ready",
          indexedSha: snapshot.headSha,
          indexedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(repositories.id, repository.id), eq(repositories.enabled, true)))
        .returning({ id: repositories.id });
      return updated.length === 1;
    });
    if (!markedReady) return { repositoryId: repository.id, skipped: "disabled-before-completion" };

    await step.sendEvent(
      "notify-index-complete",
      repositoryIndexCompleted.create({
        repositoryId: repository.id,
        headSha: snapshot.headSha,
        indexedFiles,
        indexedChunks,
      }),
    );

    return { repositoryId: repository.id, headSha: snapshot.headSha, indexedFiles, indexedChunks };
  },
);
