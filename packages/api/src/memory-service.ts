import { deriveMemoryCandidate, type FeedbackInput } from "@reviewer/ai";
import { memories, type Database } from "@reviewer/db";
import { and, eq, isNull } from "drizzle-orm";

export async function learnFromFeedback(
  database: Database,
  input: {
    workspaceId: string;
    repositoryId: string;
    actorUserId: string;
    actorIsAdmin: boolean;
    feedbackId: string;
    feedback: FeedbackInput;
  },
) {
  const firstPass = deriveMemoryCandidate(input.feedback, { actorIsAdmin: input.actorIsAdmin });
  if (!firstPass) return null;

  const [existing] = await database
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.workspaceId, input.workspaceId),
        eq(memories.scope, firstPass.scope),
        firstPass.scope === "repository"
          ? eq(memories.repositoryId, input.repositoryId)
          : isNull(memories.repositoryId),
        firstPass.scope === "user"
          ? eq(memories.ownerUserId, input.actorUserId)
          : isNull(memories.ownerUserId),
        eq(memories.fingerprint, firstPass.fingerprint),
      ),
    )
    .limit(1);
  const evidenceCount = (existing?.evidenceCount ?? 0) + 1;
  const candidate = deriveMemoryCandidate(input.feedback, {
    actorIsAdmin: input.actorIsAdmin,
    repeatedEvidenceCount: evidenceCount,
  });
  if (!candidate) return null;

  const status = candidate.promotable ? "active" : "candidate";
  if (existing) {
    const [updated] = await database
      .update(memories)
      .set({
        status,
        evidenceCount,
        confidence: candidate.confidence,
        rationale: candidate.rationale,
        sourceFeedbackId: input.feedbackId,
        promotedBy: candidate.promotable ? input.actorUserId : existing.promotedBy,
        promotedAt: candidate.promotable ? (existing.promotedAt ?? new Date()) : existing.promotedAt,
        updatedAt: new Date(),
      })
      .where(eq(memories.id, existing.id))
      .returning();
    return updated ?? null;
  }

  const [created] = await database
    .insert(memories)
    .values({
      workspaceId: input.workspaceId,
      repositoryId: candidate.scope === "repository" ? input.repositoryId : null,
      ownerUserId: candidate.scope === "user" ? input.actorUserId : null,
      scope: candidate.scope,
      status,
      fingerprint: candidate.fingerprint,
      rule: candidate.rule,
      rationale: candidate.rationale,
      confidence: candidate.confidence,
      evidenceCount,
      sourceFeedbackId: input.feedbackId,
      promotedBy: candidate.promotable ? input.actorUserId : null,
      promotedAt: candidate.promotable ? new Date() : null,
    })
    .returning();
  return created ?? null;
}
