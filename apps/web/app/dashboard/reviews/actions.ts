"use server";

import { learnFromFeedback } from "@reviewer/api";
import {
  feedbackEvents,
  getDatabase,
  repositories,
  reviewRuns,
  writeAuditEvent,
} from "@reviewer/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentPrincipal } from "../../../lib/auth";

const reviewFeedbackSchema = z.object({
  repositoryId: z.uuid(),
  reviewRunId: z.uuid(),
  verdict: z.enum(["accepted", "rejected", "partially_accepted", "not_applicable"]),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(2_000).optional(),
  explicitRemember: z.boolean(),
});

export async function submitReviewFeedback(formData: FormData) {
  const principal = await getCurrentPrincipal();
  if (!principal || principal.role === "viewer") throw new Error("Workspace maintainer required");
  const input = reviewFeedbackSchema.parse({
    repositoryId: formData.get("repositoryId"),
    reviewRunId: formData.get("reviewRunId"),
    verdict: formData.get("verdict"),
    rating: formData.get("rating"),
    comment: formData.get("comment") || undefined,
    explicitRemember: formData.get("explicitRemember") === "on",
  });
  const database = getDatabase();
  const [run] = await database
    .select({ id: reviewRuns.id })
    .from(reviewRuns)
    .innerJoin(repositories, eq(reviewRuns.repositoryId, repositories.id))
    .where(
      and(
        eq(reviewRuns.id, input.reviewRunId),
        eq(repositories.id, input.repositoryId),
        eq(repositories.workspaceId, principal.workspaceId),
      ),
    )
    .limit(1);
  if (!run) throw new Error("Review not found");

  const [feedback] = await database
    .insert(feedbackEvents)
    .values({
      workspaceId: principal.workspaceId,
      repositoryId: input.repositoryId,
      reviewRunId: input.reviewRunId,
      actorUserId: principal.user.id,
      source: "dashboard_review",
      verdict: input.verdict,
      rating: input.rating,
      ...(input.comment ? { comment: input.comment } : {}),
      explicitRemember: input.explicitRemember,
    })
    .returning();
  if (!feedback) throw new Error("Unable to record feedback");

  const memory = await learnFromFeedback(database, {
    workspaceId: principal.workspaceId,
    repositoryId: input.repositoryId,
    actorUserId: principal.user.id,
    actorIsAdmin: principal.role === "owner" || principal.role === "admin",
    feedbackId: feedback.id,
    feedback: {
      verdict: input.verdict,
      rating: input.rating,
      ...(input.comment ? { comment: input.comment } : {}),
      explicitRemember: input.explicitRemember,
      requestedScope: "repository",
    },
  });
  await writeAuditEvent(database, {
    workspaceId: principal.workspaceId,
    actorUserId: principal.user.id,
    action: "review.feedback_submitted",
    targetType: "review_run",
    targetId: input.reviewRunId,
    outcome: "success",
    metadata: { verdict: input.verdict, rating: input.rating, memoryCandidate: Boolean(memory) },
  });
  revalidatePath("/dashboard/reviews");
  revalidatePath("/dashboard/memory");
}
