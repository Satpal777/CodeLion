import { eventType } from "inngest";
import { z } from "zod";

const version = "2026-08-20.1";

const repositoryIndexSchema = z.object({
  repositoryId: z.string().uuid(),
  requestedByUserId: z.string().uuid().optional(),
});

const repositoryIncrementalIndexSchema = z.object({
  repositoryId: z.string().uuid(),
  previousSha: z.string().min(7),
  newSha: z.string().min(7),
});

const repositorySyncSchema = z.object({
  deliveryId: z.string().min(1),
  repositoryGithubId: z.string().min(1),
  installationId: z.number().int().positive(),
  beforeSha: z.string().optional(),
  afterSha: z.string().optional(),
});

const repositoryIndexCompletedSchema = z.object({
  repositoryId: z.string().uuid(),
  headSha: z.string().min(7),
  indexedFiles: z.number().int().nonnegative(),
  indexedChunks: z.number().int().nonnegative(),
});

const repositoryDisabledSchema = z.object({
  repositoryId: z.string().uuid(),
  repositoryGithubId: z.string().min(1),
});

const pullRequestReviewSchema = z.object({
  deliveryId: z.string().min(1),
  repositoryGithubId: z.string().min(1),
  installationId: z.number().int().positive(),
  pullRequestNumber: z.number().int().positive(),
  headSha: z.string().min(7),
  baseSha: z.string().min(7),
});

const pullRequestCommentSchema = z.object({
  deliveryId: z.string().min(1),
  repositoryGithubId: z.string().min(1),
  installationId: z.number().int().positive(),
  pullRequestNumber: z.number().int().positive(),
  commentId: z.number().int().positive(),
  authorLogin: z.string().optional(),
  authorAssociation: z.string().optional(),
  body: z.string().optional(),
});

const pullRequestFeedbackSchema = z.object({
  deliveryId: z.string().min(1),
  repositoryGithubId: z.string().min(1),
  installationId: z.number().int().positive(),
  pullRequestNumber: z.number().int().positive(),
  source: z.string().min(1),
  verdict: z.enum(["accepted", "rejected"]),
  commentId: z.number().int().positive().optional(),
  detail: z.string().optional(),
});

const agentFixSchema = z.object({
  repositoryId: z.string().uuid(),
  pullRequestNumber: z.number().int().positive(),
  headSha: z.string().min(7),
  requesterLogin: z.string().min(1),
  instructions: z.string().min(1),
  destination: z.enum(["stacked_pr", "existing_branch"]),
});

const evaluateMergeSchema = z.object({
  repositoryId: z.string().uuid(),
  pullRequestNumber: z.number().int().positive(),
  headSha: z.string().min(7),
  triggeredBy: z.enum(["review_completed", "check_completed", "user_action"]),
});

const checkRunReceivedSchema = z.object({
  deliveryId: z.string().min(1),
  repositoryGithubId: z.string().min(1),
  installationId: z.number().int().positive(),
  checkRunId: z.number().int().positive(),
  name: z.string(),
  headSha: z.string().min(7),
  status: z.string(),
  conclusion: z.string().nullable().optional(),
});

export const repositoryIndexRequested = eventType("reviewer/repository.index-requested", {
  version,
  schema: repositoryIndexSchema,
});

export const repositoryIncrementalIndexRequested = eventType("reviewer/repository.incremental-index-requested", {
  version,
  schema: repositoryIncrementalIndexSchema,
});

export const repositorySyncRequested = eventType("reviewer/repository.sync-requested", {
  version,
  schema: repositorySyncSchema,
});

export const repositoryIndexCompleted = eventType("reviewer/repository.index-completed", {
  version,
  schema: repositoryIndexCompletedSchema,
});

export const repositoryDisabled = eventType("reviewer/repository.disabled", {
  version,
  schema: repositoryDisabledSchema,
});

export const pullRequestReviewRequested = eventType("reviewer/pr.review-requested", {
  version,
  schema: pullRequestReviewSchema,
});

export const pullRequestCommentReceived = eventType("reviewer/pr.comment-received", {
  version,
  schema: pullRequestCommentSchema,
});

export const pullRequestFeedbackReceived = eventType("reviewer/pr.feedback-received", {
  version,
  schema: pullRequestFeedbackSchema,
});

export const agentFixRequested = eventType("reviewer/agent.fix-requested", {
  version,
  schema: agentFixSchema,
});

export const evaluateMergeRequested = eventType("reviewer/pr.evaluate-merge", {
  version,
  schema: evaluateMergeSchema,
});

export const checkRunReceived = eventType("reviewer/ci.check-run-received", {
  version,
  schema: checkRunReceivedSchema,
});

export function createWorkflowEvent(
  name: string,
  data: Record<string, unknown>,
  id = crypto.randomUUID(),
) {
  switch (name) {
    case "reviewer/repository.index-requested":
      return { ...repositoryIndexRequested.create(repositoryIndexSchema.parse(data)), id };
    case "reviewer/repository.incremental-index-requested":
      return { ...repositoryIncrementalIndexRequested.create(repositoryIncrementalIndexSchema.parse(data)), id };
    case "reviewer/repository.sync-requested":
      return { ...repositorySyncRequested.create(repositorySyncSchema.parse(data)), id };
    case "reviewer/repository.index-completed":
      return { ...repositoryIndexCompleted.create(repositoryIndexCompletedSchema.parse(data)), id };
    case "reviewer/repository.disabled":
      return { ...repositoryDisabled.create(repositoryDisabledSchema.parse(data)), id };
    case "reviewer/pr.review-requested":
      return { ...pullRequestReviewRequested.create(pullRequestReviewSchema.parse(data)), id };
    case "reviewer/pr.comment-received":
      return { ...pullRequestCommentReceived.create(pullRequestCommentSchema.parse(data)), id };
    case "reviewer/pr.feedback-received":
      return { ...pullRequestFeedbackReceived.create(pullRequestFeedbackSchema.parse(data)), id };
    case "reviewer/agent.fix-requested":
      return { ...agentFixRequested.create(agentFixSchema.parse(data)), id };
    case "reviewer/pr.evaluate-merge":
      return { ...evaluateMergeRequested.create(evaluateMergeSchema.parse(data)), id };
    case "reviewer/ci.check-run-received":
      return { ...checkRunReceived.create(checkRunReceivedSchema.parse(data)), id };
    default:
      throw new Error(`Unsupported workflow event: ${name}`);
  }
}
