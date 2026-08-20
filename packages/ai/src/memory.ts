import { createHash } from "node:crypto";
import { z } from "zod";

export const feedbackSchema = z.object({
  verdict: z.enum(["accepted", "rejected", "partially_accepted", "not_applicable"]),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(2_000).optional(),
  explicitRemember: z.boolean().default(false),
  requestedScope: z.enum(["user", "repository", "workspace", "organization"]).optional(),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;

export interface MemoryCandidate {
  fingerprint: string;
  scope: "user" | "repository" | "workspace" | "organization";
  rule: string;
  rationale: string;
  confidence: number;
  evidenceCount: number;
  promotable: boolean;
  promotionReason: "explicit" | "repeated" | "admin_required" | "insufficient_evidence";
}

const unsafePreferencePatterns = [
  /ignore\s+(?:all\s+)?security/i,
  /skip\s+(?:auth|authorization|permission)/i,
  /always\s+approve/i,
  /expose\s+(?:secret|token|credential)/i,
  /disable\s+(?:tests|checks|validation)/i,
];

function normalizeRule(comment: string): string {
  return comment.trim().replace(/\s+/g, " ").slice(0, 500);
}

/**
 * Feedback creates evidence, not an automatic prompt mutation. Organization and
 * workspace rules require an administrator even when the user said “remember”.
 */
export function deriveMemoryCandidate(
  feedback: FeedbackInput,
  options: { repeatedEvidenceCount?: number; actorIsAdmin?: boolean } = {},
): MemoryCandidate | null {
  const rule = feedback.comment ? normalizeRule(feedback.comment) : "";
  if (!rule || feedback.verdict !== "rejected" || unsafePreferencePatterns.some((pattern) => pattern.test(rule))) {
    return null;
  }

  const scope = feedback.requestedScope ?? "repository";
  const evidenceCount = Math.max(1, options.repeatedEvidenceCount ?? 1);
  const broadScope = scope === "workspace" || scope === "organization";
  const adminAllowed = !broadScope || options.actorIsAdmin === true;
  const explicit = feedback.explicitRemember;
  const repeated = evidenceCount >= 3;
  const promotable = adminAllowed && (explicit || repeated);

  const promotionReason = !adminAllowed
    ? "admin_required"
    : explicit
      ? "explicit"
      : repeated
        ? "repeated"
        : "insufficient_evidence";

  return {
    fingerprint: createHash("sha256").update(`${scope}:${rule.toLowerCase()}`).digest("hex"),
    scope,
    rule,
    rationale: `Derived from a rejected review suggestion with ${evidenceCount} evidence event(s).`,
    confidence: explicit ? 0.95 : Math.min(0.9, 0.45 + evidenceCount * 0.15),
    evidenceCount,
    promotable,
    promotionReason,
  };
}

export interface ScopedMemory {
  id: string;
  scope: "user" | "repository" | "workspace" | "organization";
  rule: string;
  confidence: number;
  createdAt: Date;
}

const scopePriority: Record<ScopedMemory["scope"], number> = {
  user: 4,
  repository: 3,
  workspace: 2,
  organization: 1,
};

export function orderApplicableMemories(memories: ScopedMemory[]): ScopedMemory[] {
  return [...memories].sort((left, right) => {
    const byScope = scopePriority[right.scope] - scopePriority[left.scope];
    if (byScope !== 0) return byScope;
    const byConfidence = right.confidence - left.confidence;
    if (byConfidence !== 0) return byConfidence;
    return right.createdAt.getTime() - left.createdAt.getTime();
  });
}

export function memoryCanSuppressFinding(memory: ScopedMemory, category: string): boolean {
  if (category === "security" || category === "correctness") return false;
  return !unsafePreferencePatterns.some((pattern) => pattern.test(memory.rule));
}
