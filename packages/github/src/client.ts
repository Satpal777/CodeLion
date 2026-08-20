import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

export interface GithubAppCredentials {
  appId: string | number;
  privateKey: string;
}

export function createAppOctokit(credentials: GithubAppCredentials): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: credentials,
    userAgent: "self-learning-reviewer/0.1.0",
  });
}

export function createInstallationOctokit(
  credentials: GithubAppCredentials,
  installationId: number,
): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { ...credentials, installationId },
    userAgent: "self-learning-reviewer/0.1.0",
  });
}

export function createUserOctokit(userAccessToken: string): Octokit {
  return new Octokit({ auth: userAccessToken, userAgent: "self-learning-reviewer/0.1.0" });
}

export interface PullRequestFile {
  path: string;
  previousPath?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  blobUrl: string;
}

export interface PullRequestContext {
  number: number;
  title: string;
  body: string;
  author: string;
  baseSha: string;
  headSha: string;
  files: PullRequestFile[];
}

export async function getPullRequestContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestContext> {
  const [{ data: pull }, files] = await Promise.all([
    octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber }),
    octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    }),
  ]);

  return {
    number: pull.number,
    title: pull.title,
    body: pull.body ?? "",
    author: pull.user?.login ?? "unknown",
    baseSha: pull.base.sha,
    headSha: pull.head.sha,
    files: files.map((file) => ({
      path: file.filename,
      ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ?? null,
      blobUrl: file.blob_url,
    })),
  };
}

export async function getPullRequestState(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
) {
  const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  return {
    headSha: data.head.sha,
    baseSha: data.base.sha,
    state: data.state,
    draft: data.draft ?? false,
    merged: data.merged,
  };
}

export interface ReviewComment {
  path: string;
  line: number;
  side: "RIGHT" | "LEFT";
  body: string;
}

export async function publishPullRequestReview(
  octokit: Octokit,
  input: {
    owner: string;
    repo: string;
    pullNumber: number;
    headSha: string;
    decision: "approve" | "comment" | "request_changes";
    body: string;
    comments: ReviewComment[];
  },
) {
  const event =
    input.decision === "approve"
      ? "APPROVE"
      : input.decision === "request_changes"
        ? "REQUEST_CHANGES"
        : "COMMENT";

  return octokit.rest.pulls.createReview({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    commit_id: input.headSha,
    event,
    body: input.body,
    comments: input.comments,
  });
}

export async function publishPullRequestReviewIdempotent(
  octokit: Octokit,
  input: Parameters<typeof publishPullRequestReview>[1] & { idempotencyKey: string },
) {
  const marker = `<!-- reviewer-run:${input.idempotencyKey} -->`;
  const existing = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    per_page: 100,
  });
  const prior = existing.find(
    (review) => review.user?.type === "Bot" && review.body?.includes(marker),
  );
  if (prior) return { data: prior, reused: true } as const;

  const result = await publishPullRequestReview(octokit, {
    owner: input.owner,
    repo: input.repo,
    pullNumber: input.pullNumber,
    headSha: input.headSha,
    decision: input.decision,
    body: `${input.body}\n\n${marker}`,
    comments: input.comments,
  });
  return { data: result.data, reused: false } as const;
}


export async function userCanAccessInstallation(octokit: Octokit, installationId: number) {
  const installations = await octokit.paginate(
    octokit.rest.apps.listInstallationsForAuthenticatedUser,
    { per_page: 100 },
  );
  return installations.some((installation) => installation.id === installationId);
}

/** Returns only repositories visible to both the acting user and the installation. */
export async function getUserInstallationRepositories(octokit: Octokit, installationId: number) {
  return octokit.paginate(octokit.rest.apps.listInstallationReposForAuthenticatedUser, {
    installation_id: installationId,
    per_page: 100,
  });
}

/** Lists all repositories directly granted to the GitHub App installation. */
export async function getInstallationRepositories(
  installationOctokit: Octokit,
): Promise<
  Array<{
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
    owner: { login: string };
  }>
> {
  const { data } = await installationOctokit.rest.apps.listReposAccessibleToInstallation({
    per_page: 100,
  });
  return (data.repositories ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    private: r.private,
    default_branch: r.default_branch,
    owner: { login: r.owner.login },
  }));
}

export async function getInstallationMetadata(appOctokit: Octokit, installationId: number) {
  const { data } = await appOctokit.rest.apps.getInstallation({ installation_id: installationId });
  const account = data.account;
  if (!account) throw new Error("GitHub installation has no account");
  return {
    installationId: data.id,
    accountId: String(account.id),
    accountLogin: "login" in account ? account.login : account.slug,
    accountType: "type" in account ? (account as { type?: string }).type ?? "Organization" : "Organization",
    repositorySelection: data.repository_selection,
    suspendedAt: data.suspended_at ? new Date(data.suspended_at) : null,
  };
}

/**
 * The merge call is deliberately separate from review generation. The caller must
 * prove policy approval and bind the operation to the reviewed head SHA.
 */
export async function mergePullRequestGuarded(
  octokit: Octokit,
  input: {
    owner: string;
    repo: string;
    pullNumber: number;
    expectedHeadSha: string;
    reviewApproved: boolean;
    policyAllowsMerge: boolean;
    requiredChecksPassed: boolean;
    mergeMethod: "merge" | "squash" | "rebase";
  },
) {
  if (!input.reviewApproved || !input.policyAllowsMerge || !input.requiredChecksPassed) {
    throw new Error("Merge policy denied the operation");
  }

  const { data: pull } = await octokit.rest.pulls.get({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
  });
  if (pull.head.sha !== input.expectedHeadSha) {
    throw new Error("Pull request head changed after review");
  }

  return octokit.rest.pulls.merge({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    sha: input.expectedHeadSha,
    merge_method: input.mergeMethod,
  });
}
