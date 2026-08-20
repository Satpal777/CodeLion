import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { GithubAppCredentials } from "./client";

export interface ExecutorCredentials extends GithubAppCredentials {
  slug?: string;
}

export interface FileChange {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
}

export interface FixPullRequestInput {
  owner: string;
  repo: string;
  sourcePullNumber: number;
  sourceHeadSha: string;
  sourceBranch: string;
  files: FileChange[];
  title: string;
  body: string;
  destination: "stacked_pr" | "existing_branch";
  requesterLogin: string;
}

export interface FixPullRequestResult {
  destination: "stacked_pr" | "existing_branch";
  branchName: string;
  commitSha: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
  draft: boolean;
}

const protectedPathPatterns = [
  /^\.github\/workflows\//i,
  /^infra\/production\//i,
  /\.env(\.|$)/i,
  /(?:^|\/)(?:id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.crt|.*\.keystore)$/i,
  /(?:^|\/)(?:credentials?|secrets?|tokens?)\.(?:json|yaml|yml|toml)$/i,
];

export function isProtectedPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return protectedPathPatterns.some((pattern) => pattern.test(normalized));
}

export function validatePatchPaths(files: FileChange[]): { valid: boolean; rejectedPaths: string[] } {
  const rejectedPaths: string[] = [];
  for (const file of files) {
    if (isProtectedPath(file.path)) {
      rejectedPaths.push(file.path);
    }
  }
  return {
    valid: rejectedPaths.length === 0,
    rejectedPaths,
  };
}

export function createExecutorOctokit(credentials: ExecutorCredentials, installationId: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { ...credentials, installationId },
    userAgent: "self-learning-reviewer-executor/0.1.0",
  });
}

/**
 * Executes chat-directed fix actions safely through the Executor GitHub App.
 * Uses Compare-and-Swap (CAS) with expected SHA and refuses protected path modifications.
 */
export async function executeFixAction(
  executorOctokit: Octokit,
  input: FixPullRequestInput,
): Promise<FixPullRequestResult> {
  const pathValidation = validatePatchPaths(input.files);
  if (!pathValidation.valid) {
    throw new Error(
      `Executor refused modification to protected paths: ${pathValidation.rejectedPaths.join(", ")}`,
    );
  }

  const { data: currentSourcePull } = await executorOctokit.rest.pulls.get({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.sourcePullNumber,
  });

  if (currentSourcePull.head.sha !== input.sourceHeadSha) {
    throw new Error(
      `Compare-and-swap failed: PR head changed from ${input.sourceHeadSha} to ${currentSourcePull.head.sha}`,
    );
  }

  // Destination 1: Create a Stacked Draft PR targeting the source PR branch
  if (input.destination === "stacked_pr") {
    const shortId = crypto.randomUUID().slice(0, 7);
    const branchName = `ai/fix/pr-${input.sourcePullNumber}-${shortId}`;

    // 1. Create fix branch from source head SHA
    await executorOctokit.rest.git.createRef({
      owner: input.owner,
      repo: input.repo,
      ref: `refs/heads/${branchName}`,
      sha: input.sourceHeadSha,
    });

    // 2. Commit files to fix branch
    const commitSha = await commitFilesToBranch(
      executorOctokit,
      input.owner,
      input.repo,
      branchName,
      input.sourceHeadSha,
      input.files,
      `fix: addressed review findings on PR #${input.sourcePullNumber}\n\nRequested-by: @${input.requesterLogin}`,
    );

    // 3. Open Stacked Draft Pull Request targeting the source branch
    const { data: newPull } = await executorOctokit.rest.pulls.create({
      owner: input.owner,
      repo: input.repo,
      title: input.title,
      body: input.body,
      head: branchName,
      base: input.sourceBranch,
      draft: true,
    });

    return {
      destination: "stacked_pr",
      branchName,
      commitSha,
      pullRequestNumber: newPull.number,
      pullRequestUrl: newPull.html_url,
      draft: true,
    };
  }

  // Destination 2: Commit directly to existing source PR branch
  const commitSha = await commitFilesToBranch(
    executorOctokit,
    input.owner,
    input.repo,
    input.sourceBranch,
    input.sourceHeadSha,
    input.files,
    `fix: automated review remediation\n\nRequested-by: @${input.requesterLogin}`,
  );

  return {
    destination: "existing_branch",
    branchName: input.sourceBranch,
    commitSha,
    pullRequestNumber: input.sourcePullNumber,
    draft: currentSourcePull.draft ?? false,
  };
}

async function commitFilesToBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  baseCommitSha: string,
  files: FileChange[],
  message: string,
): Promise<string> {
  // 1. Create blobs for each file
  const treeItems: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
  for (const file of files) {
    const { data: blob } = await octokit.rest.git.createBlob({
      owner,
      repo,
      content: file.content,
      encoding: file.encoding ?? "utf-8",
    });
    treeItems.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  // 2. Create tree pointing to base commit tree
  const { data: baseCommit } = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: baseCommitSha,
  });

  const { data: newTree } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.tree.sha,
    tree: treeItems,
  });

  // 3. Create commit
  const { data: newCommit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: newTree.sha,
    parents: [baseCommitSha],
  });

  // 4. Update branch ref
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });

  return newCommit.sha;
}
