import { z } from "zod";

export const severitySchema = z.enum(["critical", "high", "medium", "low", "nit"]);

export const findingSchema = z.object({
  severity: severitySchema,
  category: z.enum([
    "security",
    "correctness",
    "reliability",
    "performance",
    "maintainability",
    "testing",
    "documentation",
  ]),
  title: z.string().min(4).max(120),
  explanation: z.string().min(10).max(2_000),
  path: z.string().min(1),
  line: z.number().int().positive().nullable(),
  side: z.enum(["RIGHT", "LEFT"]).nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().min(1).max(1_000),
  suggestedPatch: z.string().max(4_000).nullable(),
});

export const modelReviewSchema = z.object({
  summary: z.string().min(1).max(4_000),
  riskScore: z.number().min(0).max(1),
  findings: z.array(findingSchema).max(50),
  positiveNotes: z.array(z.string().max(500)).max(10),
  testRecommendations: z.array(z.string().max(500)).max(10),
  uncertainty: z.array(z.string().max(500)).max(10),
});

export type Finding = z.infer<typeof findingSchema>;
export type ModelReview = z.infer<typeof modelReviewSchema>;
export type ReviewDecision = "approve" | "comment" | "request_changes";

export interface ValidatedFinding extends Finding {
  fingerprint: string;
  inlineEligible: boolean;
}

export type ReviewFinding = ValidatedFinding;

export interface ReviewResult extends Omit<ModelReview, "findings"> {
  decision: ReviewDecision;
  findings: ValidatedFinding[];
  suppressedFindingCount: number;
  /** The exact model name that generated this review (e.g. "gemini-2.5-flash"). */
  modelUsed?: string;
}
