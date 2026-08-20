import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { toReviewerEvent, verifyWebhookSignature } from "../src/webhooks";

const secret = "a-secret-with-at-least-thirty-two-characters";

describe("verifyWebhookSignature", () => {
  it("accepts the exact signed bytes", () => {
    const body = '{"action":"opened"}';
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
  });

  it("rejects altered and malformed input", () => {
    const signature = `sha256=${createHmac("sha256", secret).update("safe").digest("hex")}`;
    expect(verifyWebhookSignature("unsafe", signature, secret)).toBe(false);
    expect(verifyWebhookSignature("safe", "sha256=nope", secret)).toBe(false);
    expect(verifyWebhookSignature("safe", null, secret)).toBe(false);
  });
});

describe("toReviewerEvent", () => {
  it("creates an id-only review event for a ready pull request", () => {
    const event = toReviewerEvent("pull_request", "delivery-1", {
      action: "opened",
      installation: { id: 12 },
      repository: {
        id: 34,
        name: "repo",
        full_name: "owner/repo",
        private: true,
        default_branch: "main",
        owner: { login: "owner" },
      },
      pull_request: {
        number: 5,
        draft: false,
        head: { sha: "head" },
        base: { sha: "base" },
      },
    });

    expect(event).toEqual({
      id: "delivery-1",
      name: "reviewer/pr.review-requested",
      data: {
        deliveryId: "delivery-1",
        repositoryGithubId: "34",
        installationId: 12,
        pullRequestNumber: 5,
        headSha: "head",
        baseSha: "base",
      },
    });
  });

  it("creates a comment-received event for pull_request_review_comment", () => {
    const event = toReviewerEvent("pull_request_review_comment", "delivery-2", {
      action: "created",
      installation: { id: 12 },
      repository: {
        id: 34,
        name: "repo",
        full_name: "owner/repo",
        private: true,
        default_branch: "main",
        owner: { login: "owner" },
      },
      pull_request: {
        number: 5,
        head: { sha: "head" },
        base: { sha: "base" },
      },
      comment: {
        id: 99,
        body: "@bot fix this",
        user: { id: 101, login: "dev", type: "User" },
      },
    });

    expect(event).toEqual({
      id: "delivery-2",
      name: "reviewer/pr.comment-received",
      data: {
        deliveryId: "delivery-2",
        repositoryGithubId: "34",
        installationId: 12,
        pullRequestNumber: 5,
        commentId: 99,
      },
    });
  });
});
