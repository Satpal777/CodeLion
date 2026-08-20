import { decodeGithubPrivateKey, getServerEnv } from "@reviewer/config";
import {
  defaultRepositorySettings,
  getDatabase,
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
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentPrincipal } from "../../../../lib/auth";

export async function GET(request: Request) {
  const principal = await getCurrentPrincipal();
  if (!principal) return NextResponse.redirect(new URL("/login", request.url));
  if (principal.role !== "owner" && principal.role !== "admin") {
    return NextResponse.json({ error: "Workspace administrator required" }, { status: 403 });
  }

  const env = getServerEnv();
  const url = new URL(request.url);
  const installationId = Number(url.searchParams.get("installation_id"));

  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    return NextResponse.json({ error: "Invalid GitHub App installation ID" }, { status: 400 });
  }

  const credentials = {
    appId: env.GITHUB_APP_ID,
    privateKey: decodeGithubPrivateKey(env.GITHUB_APP_PRIVATE_KEY_BASE64),
  };

  const appOctokit = createAppOctokit(credentials);
  const metadata = await getInstallationMetadata(appOctokit, installationId);

  const database = getDatabase(env.DATABASE_URL);
  const installation = await upsertInstallation(database, {
    workspaceId: principal.workspaceId,
    installationId: metadata.installationId,
    accountId: metadata.accountId,
    accountLogin: metadata.accountLogin,
    accountType: metadata.accountType,
    repositorySelection: metadata.repositorySelection,
    suspendedAt: metadata.suspendedAt,
  });

  const installationOctokit = createInstallationOctokit(credentials, installationId);
  const accessible = await getInstallationRepositories(installationOctokit);

  for (const repository of accessible) {
    const [existingRepository] = await database
      .select({ workspaceId: repositories.workspaceId })
      .from(repositories)
      .where(eq(repositories.githubRepositoryId, String(repository.id)))
      .limit(1);

    if (existingRepository && existingRepository.workspaceId !== principal.workspaceId) {
      continue;
    }

    await database
      .insert(repositories)
      .values({
        workspaceId: principal.workspaceId,
        installationId: installation.id,
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
          installationId: installation.id,
          owner: repository.owner.login,
          name: repository.name,
          defaultBranch: repository.default_branch,
          isPrivate: repository.private,
          updatedAt: new Date(),
        },
      });
  }

  await writeAuditEvent(database, {
    workspaceId: principal.workspaceId,
    actorUserId: principal.user.id,
    action: "github.installation.connected",
    targetType: "github_installation",
    targetId: String(installationId),
    outcome: "success",
    metadata: { repositoryCount: accessible.length, accountLogin: metadata.accountLogin },
  });

  const response = NextResponse.redirect(new URL("/dashboard/repositories", request.url));
  response.cookies.set("reviewer_install_state", "", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/github/setup",
    maxAge: 0,
  });

  return response;
}
