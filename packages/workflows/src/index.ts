export { inngest } from "./client";
export * from "./events";
export { indexRepository } from "./index-repository";
export { incrementalIndexWorkflow } from "./incremental-index";
export { reviewPullRequestWorkflow } from "./review-pull-request";
export { pullRequestChatWorkflow } from "./pull-request-chat";
export { agentFixWorkflow } from "./agent-fix";
export { evaluateMergeWorkflow } from "./evaluate-merge";
export { ciAnalysisWorkflow } from "./ci-analysis";
export { syncRepository } from "./sync-repository";
export { reconcileWorkflowOutbox } from "./reconcile-outbox";
export { feedbackLearnerWorkflow } from "./feedback-learner";

import { indexRepository } from "./index-repository";
import { incrementalIndexWorkflow } from "./incremental-index";
import { reviewPullRequestWorkflow } from "./review-pull-request";
import { pullRequestChatWorkflow } from "./pull-request-chat";
import { agentFixWorkflow } from "./agent-fix";
import { evaluateMergeWorkflow } from "./evaluate-merge";
import { ciAnalysisWorkflow } from "./ci-analysis";
import { syncRepository } from "./sync-repository";
import { reconcileWorkflowOutbox } from "./reconcile-outbox";
import { feedbackLearnerWorkflow } from "./feedback-learner";

export const workflowFunctions = [
  indexRepository,
  incrementalIndexWorkflow,
  reviewPullRequestWorkflow,
  pullRequestChatWorkflow,
  agentFixWorkflow,
  evaluateMergeWorkflow,
  ciAnalysisWorkflow,
  syncRepository,
  reconcileWorkflowOutbox,
  feedbackLearnerWorkflow,
];
