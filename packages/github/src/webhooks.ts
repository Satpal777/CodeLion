import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=") || secret.length < 32) return false;

  const providedHex = signatureHeader.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(providedHex)) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const provided = Buffer.from(providedHex, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const webhookEnvelopeSchema = z.object({
  action: z.string().optional(),
  installation: z.object({ id: z.number().int().positive() }).optional(),
  repository: z
    .object({
      id: z.number().int().positive(),
      name: z.string(),
      full_name: z.string(),
      private: z.boolean(),
      default_branch: z.string(),
      owner: z.object({ login: z.string() }),
    })
    .optional(),
  repositories_added: z
    .array(
      z.object({
        id: z.number().int().positive(),
        name: z.string(),
        full_name: z.string(),
      }),
    )
    .optional(),
  repositories_removed: z
    .array(
      z.object({
        id: z.number().int().positive(),
        name: z.string(),
        full_name: z.string(),
      }),
    )
    .optional(),
  repositories: z
    .array(
      z.object({
        id: z.number().int().positive(),
        name: z.string(),
        full_name: z.string(),
      }),
    )
    .optional(),
  pull_request: z
    .object({
      number: z.number().int().positive(),
      draft: z.boolean().optional(),
      head: z.object({ sha: z.string() }),
      base: z.object({ sha: z.string() }),
    })
    .optional(),
  issue: z.object({ number: z.number().int().positive(), pull_request: z.unknown().optional() }).optional(),
  comment: z
    .object({
      id: z.number().int().positive(),
      body: z.string(),
      user: z.object({ id: z.number().int().positive(), login: z.string(), type: z.string() }),
    })
    .optional(),
  review: z
    .object({
      id: z.number().int().positive(),
      body: z.string().nullable().optional(),
      state: z.string(),
      user: z.object({ id: z.number().int().positive(), login: z.string(), type: z.string() }),
    })
    .optional(),
  thread: z
    .object({
      id: z.number().int().positive().optional(),
      comments: z.array(z.object({ id: z.number().int().positive() })).optional(),
    })
    .optional(),
  reaction: z
    .object({
      content: z.string(),
      user: z.object({ id: z.number().int().positive(), login: z.string() }).optional(),
    })
    .optional(),
  check_run: z
    .object({
      id: z.number().int().positive(),
      name: z.string(),
      head_sha: z.string(),
      status: z.string(),
      conclusion: z.string().nullable().optional(),
    })
    .optional(),
});

export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

export function parseWebhookEnvelope(rawBody: string): WebhookEnvelope {
  return webhookEnvelopeSchema.parse(JSON.parse(rawBody) as unknown);
}

export type ReviewerEvent =
  | {
      id: string;
      name: "reviewer/pr.review-requested";
      data: {
        deliveryId: string;
        repositoryGithubId: string;
        installationId: number;
        pullRequestNumber: number;
        headSha: string;
        baseSha: string;
      };
    }
  | {
      id: string;
      name: "reviewer/pr.comment-received";
      data: {
        deliveryId: string;
        repositoryGithubId: string;
        installationId: number;
        pullRequestNumber: number;
        commentId: number;
      };
    }
  | {
      id: string;
      name: "reviewer/pr.feedback-received";
      data: {
        deliveryId: string;
        repositoryGithubId: string;
        installationId: number;
        pullRequestNumber: number;
        source: string;
        verdict: "accepted" | "rejected";
        commentId?: number;
        detail?: string;
      };
    }
  | {
      id: string;
      name: "reviewer/repository.sync-requested";
      data: {
        deliveryId: string;
        repositoryGithubId: string;
        installationId: number;
      };
    }
  | {
      id: string;
      name: "reviewer/ci.check-run-received";
      data: {
        deliveryId: string;
        repositoryGithubId: string;
        installationId: number;
        checkRunId: number;
        name: string;
        headSha: string;
        status: string;
        conclusion?: string | null;
      };
    };

/** Maps only events the product intentionally handles. Payload content stays in GitHub. */
export function toReviewerEvent(
  eventName: string,
  deliveryId: string,
  envelope: WebhookEnvelope,
): ReviewerEvent | null {
  const installationId = envelope.installation?.id;
  const repositoryGithubId =
    envelope.repository?.id.toString() ??
    envelope.repositories_added?.[0]?.id.toString() ??
    envelope.repositories?.[0]?.id.toString() ??
    "all";

  if (!installationId) return null;

  if (eventName === "installation_repositories" || eventName === "installation") {
    return {
      id: deliveryId,
      name: "reviewer/repository.sync-requested",
      data: { deliveryId, repositoryGithubId, installationId },
    };
  }

  if (repositoryGithubId === "all") return null;

  if (
    eventName === "pull_request" &&
    envelope.pull_request &&
    ["opened", "reopened", "ready_for_review", "synchronize"].includes(envelope.action ?? "")
  ) {
    if (envelope.pull_request.draft && envelope.action !== "ready_for_review") return null;
    return {
      id: deliveryId,
      name: "reviewer/pr.review-requested",
      data: {
        deliveryId,
        repositoryGithubId,
        installationId,
        pullRequestNumber: envelope.pull_request.number,
        headSha: envelope.pull_request.head.sha,
        baseSha: envelope.pull_request.base.sha,
      },
    };
  }

  if (
    (eventName === "issue_comment" || eventName === "pull_request_review_comment") &&
    envelope.action === "created" &&
    envelope.comment &&
    envelope.comment.user.type !== "Bot"
  ) {
    const pullRequestNumber = envelope.pull_request?.number ?? envelope.issue?.number;
    if (pullRequestNumber) {
      return {
        id: deliveryId,
        name: "reviewer/pr.comment-received",
        data: {
          deliveryId,
          repositoryGithubId,
          installationId,
          pullRequestNumber,
          commentId: envelope.comment.id,
        },
      };
    }
  }

  // Handle Review Thread resolution
  if (
    eventName === "pull_request_review_thread" &&
    (envelope.action === "resolved" || envelope.action === "unresolved") &&
    envelope.pull_request
  ) {
    const threadCommentId = envelope.thread?.comments?.[0]?.id;
    return {
      id: deliveryId,
      name: "reviewer/pr.feedback-received",
      data: {
        deliveryId,
        repositoryGithubId,
        installationId,
        pullRequestNumber: envelope.pull_request.number,
        source: envelope.action === "resolved" ? "github_thread_resolved" : "github_thread_unresolved",
        verdict: envelope.action === "resolved" ? "accepted" : "rejected",
        detail: `Thread marked ${envelope.action} on PR #${envelope.pull_request.number}`,
        ...(threadCommentId ? { commentId: threadCommentId } : {}),
      },
    };
  }

  // Handle emoji reactions on comments
  if (eventName === "reaction" && envelope.action === "created" && envelope.reaction && envelope.comment) {
    const isPositive = ["+1", "heart", "hooray", "rocket"].includes(envelope.reaction.content);
    const isNegative = ["-1", "confused"].includes(envelope.reaction.content);

    if (isPositive || isNegative) {
      const pullRequestNumber = envelope.pull_request?.number ?? envelope.issue?.number ?? 1;
      return {
        id: deliveryId,
        name: "reviewer/pr.feedback-received",
        data: {
          deliveryId,
          repositoryGithubId,
          installationId,
          pullRequestNumber,
          source: "github_reaction",
          verdict: isPositive ? "accepted" : "rejected",
          commentId: envelope.comment.id,
          detail: `Reaction ${envelope.reaction.content} on comment #${envelope.comment.id}`,
        },
      };
    }
  }

  if (eventName === "push") {
    return {
      id: deliveryId,
      name: "reviewer/repository.sync-requested",
      data: { deliveryId, repositoryGithubId, installationId },
    };
  }

  if (eventName === "check_run" && envelope.check_run) {
    return {
      id: deliveryId,
      name: "reviewer/ci.check-run-received",
      data: {
        deliveryId,
        repositoryGithubId,
        installationId,
        checkRunId: envelope.check_run.id,
        name: envelope.check_run.name,
        headSha: envelope.check_run.head_sha,
        status: envelope.check_run.status,
        conclusion: envelope.check_run.conclusion ?? null,
      },
    };
  }

  return null;
}
