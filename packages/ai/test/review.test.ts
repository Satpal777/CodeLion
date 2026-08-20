import { describe, expect, it } from "vitest";
import { decideReview, validateModelReview } from "../src/review";

const baseReview = {
  summary: "One actionable problem was found.",
  riskScore: 0.8,
  positiveNotes: [],
  testRecommendations: [],
  uncertainty: [],
};

describe("review policy", () => {
  it("requests changes only for high-impact findings", () => {
    expect(
      decideReview([
        {
          severity: "high",
          category: "correctness",
          title: "Lost update",
          explanation: "Concurrent writes overwrite the newest value.",
          path: "src/a.ts",
          line: 2,
          side: "RIGHT",
          confidence: 0.9,
          evidence: "The update has no compare-and-swap guard.",
          suggestedPatch: null,
        },
      ]),
    ).toBe("request_changes");
  });

  it("suppresses low-confidence and off-diff findings", () => {
    const result = validateModelReview(
      {
        ...baseReview,
        findings: [
          {
            severity: "medium",
            category: "reliability",
            title: "Retry is missing",
            explanation: "The new network operation fails permanently on a transient response.",
            path: "src/a.ts",
            line: 2,
            side: "RIGHT",
            confidence: 0.9,
            evidence: "The call has no retry boundary.",
            suggestedPatch: null,
          },
          {
            severity: "low",
            category: "maintainability",
            title: "Speculative style issue",
            explanation: "This is only a speculative style preference and should not be shown.",
            path: "src/a.ts",
            line: 2,
            side: "RIGHT",
            confidence: 0.4,
            evidence: "No concrete evidence.",
            suggestedPatch: null,
          },
        ],
      },
      [{ path: "src/a.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1,2 @@\n old\n+new" }],
      0.78,
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.inlineEligible).toBe(true);
    expect(result.suppressedFindingCount).toBe(1);
  });
});
