import { describe, expect, it } from "vitest";
import { createWorkflowEvent, workflowFunctions } from "../src";

describe("Workflow Functions and Typed Event Schemas", () => {
  it("registers all durable Inngest workflow functions", () => {
    expect(workflowFunctions.length).toBe(10);
    const functionIds = workflowFunctions.map((fn) => fn.id());
    expect(functionIds).toContain("index-repository");
    expect(functionIds).toContain("incremental-index-repository");
    expect(functionIds).toContain("review-pull-request");
    expect(functionIds).toContain("pull-request-chat");
    expect(functionIds).toContain("agent-fix");
    expect(functionIds).toContain("evaluate-merge");
    expect(functionIds).toContain("ci-analysis");
    expect(functionIds).toContain("sync-repository");
    expect(functionIds).toContain("reconcile-workflow-outbox");
    expect(functionIds).toContain("feedback-learner");
  });

  it("creates valid versioned workflow events with schemas", () => {
    const validUuid = crypto.randomUUID();
    const fixEvent = createWorkflowEvent("reviewer/agent.fix-requested", {
      repositoryId: validUuid,
      pullRequestNumber: 5,
      headSha: "1234567",
      requesterLogin: "alice",
      instructions: "fix null pointer",
      destination: "stacked_pr",
    });

    expect(fixEvent.name).toBe("reviewer/agent.fix-requested");
    expect(fixEvent.data.destination).toBe("stacked_pr");

    const feedbackEvent = createWorkflowEvent("reviewer/pr.feedback-received", {
      deliveryId: "del-123",
      repositoryGithubId: "repo-99",
      installationId: 456,
      pullRequestNumber: 10,
      source: "github_thread_resolved",
      verdict: "accepted",
      detail: "Thread resolved by author",
    });

    expect(feedbackEvent.name).toBe("reviewer/pr.feedback-received");
    expect(feedbackEvent.data.verdict).toBe("accepted");

    const mergeEvent = createWorkflowEvent("reviewer/pr.evaluate-merge", {
      repositoryId: validUuid,
      pullRequestNumber: 5,
      headSha: "1234567",
      triggeredBy: "review_completed",
    });

    expect(mergeEvent.name).toBe("reviewer/pr.evaluate-merge");
    expect(mergeEvent.data.triggeredBy).toBe("review_completed");
  });
});
