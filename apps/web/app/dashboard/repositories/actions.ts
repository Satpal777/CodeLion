"use server";

import { decodeGithubPrivateKey, getServerEnv } from "@reviewer/config";
import {
  defaultRepositorySettings,
  getDatabase,
  githubInstallations,
  repositories,
  upsertInstallation,
  writeAuditEvent,
} from "@reviewer/db";
import {
  createAppOctokit,
  createInstallationOctokit,
  getInstallationMetadata,
  getInstallationRepositories,
} from "@reviewer/github";
import { createWorkflowEvent, inngest } from "@reviewer/workflows";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentPrincipal } from "../../../lib/auth";

const toggleSchema = z.object({ repositoryId: z.uuid(), enabled: z.enum(["true", "false"]) });

export async function setRepositoryEnabled(formData: FormData) {
  const principal = await getCurrentPrincipal();
  if (!principal || (principal.role !== "owner" && principal.role !== "admin")) {
    throw new Error("Workspace administrator required");
  }
  const input = toggleSchema.parse({
    repositoryId: formData.get("repositoryId"),
    enabled: formData.get("enabled"),
  });
  const enabled = input.enabled === "true";
  const database = getDatabase();
  const [current] = await database
    .select()
    .from(repositories)
    .where(
      and(eq(repositories.id, input.repositoryId), eq(repositories.workspaceId, principal.workspaceId)),
    )
    .limit(1);
  if (!current) throw new Error("Repository not found");

  await database
    .update(repositories)
    .set({
      enabled,
      state: enabled ? "indexing" : "disabled",
      settings: { ...current.settings, reviewsEnabled: enabled },
      updatedAt: new Date(),
    })
    .where(
      and(eq(repositories.id, input.repositoryId), eq(repositories.workspaceId, principal.workspaceId)),
    );
  await writeAuditEvent(database, {
    workspaceId: principal.workspaceId,
    actorUserId: principal.user.id,
    action: enabled ? "repository.enabled" : "repository.disabled",
    targetType: "repository",
    targetId: input.repositoryId,
    outcome: "success",
  });
  if (enabled) {
    await inngest.send(
      createWorkflowEvent("reviewer/repository.index-requested", {
        repositoryId: input.repositoryId,
        requestedByUserId: principal.user.id,
      }),
    );
  } else {
    await inngest.send(
      createWorkflowEvent("reviewer/repository.disabled", {
        repositoryId: input.repositoryId,
        repositoryGithubId: current.githubRepositoryId,
      }),
    );
  }
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/repositories");
}

export async function syncRepositories(_formData?: FormData): Promise<void> {
  const principal = await getCurrentPrincipal();
  if (!principal || (principal.role !== "owner" && principal.role !== "admin")) {
    throw new Error("Workspace administrator required");
  }

  const env = getServerEnv();
  const database = getDatabase(env.DATABASE_URL);

  const credentials = {
    appId: env.GITHUB_APP_ID,
    privateKey: decodeGithubPrivateKey(env.GITHUB_APP_PRIVATE_KEY_BASE64),
  };

  const appOctokit = createAppOctokit(credentials);

  // 1. Find existing workspace installations
  let installations = await database
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.workspaceId, principal.workspaceId));

  // If none recorded yet, discover from GitHub App
  if (installations.length === 0) {
    try {
      const { data: appInstallations } = await appOctokit.rest.apps.listInstallations();
      for (const inst of appInstallations) {
        const metadata = await getInstallationMetadata(appOctokit, inst.id);
        const stored = await upsertInstallation(database, {
          workspaceId: principal.workspaceId,
          installationId: metadata.installationId,
          accountId: metadata.accountId,
          accountLogin: metadata.accountLogin,
          accountType: metadata.accountType,
          repositorySelection: metadata.repositorySelection,
          suspendedAt: metadata.suspendedAt,
        });
        installations.push(stored);
      }
    } catch (e: unknown) {
      const err = e as { message?: string; status?: number };
      console.warn(
        `[Sync Warning] Could not list GitHub App installations: ${err.message ?? "Unknown error"}. ` +
          `If using a new GitHub App, ensure GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_BASE64 match your GitHub App in Developer Settings.`,
      );
    }
  }

  for (const inst of installations) {
    try {
      const installationOctokit = createInstallationOctokit(credentials, inst.installationId);
      const accessible = await getInstallationRepositories(installationOctokit);

      for (const repository of accessible) {
        await database
          .insert(repositories)
          .values({
            workspaceId: principal.workspaceId,
            installationId: inst.id,
            githubRepositoryId: String(repository.id),
            owner: repository.owner.login,
            name: repository.name,
            defaultBranch: repository.default_branch,
            isPrivate: repository.private,
            settings: defaultRepositorySettings,
          })
          .onConflictDoUpdate({
            target: repositories.githubRepositoryId,
            set: {
              installationId: inst.id,
              owner: repository.owner.login,
              name: repository.name,
              defaultBranch: repository.default_branch,
              isPrivate: repository.private,
              updatedAt: new Date(),
            },
          });
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.warn(`[Sync Warning] Failed to sync repositories for installation ${inst.installationId}: ${err.message}`);
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/repositories");
}
