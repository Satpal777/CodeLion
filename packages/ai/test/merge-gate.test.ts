import { describe, expect, it } from "vitest";
import { evaluateMergeGate } from "../src/merge-gate";

describe("Guarded Auto-Merge Engine", () => {
  const baseInput = {
    repositoryMergeMode: "after_all_gates" as const,
    isEmergencyKillSwitchActive: false,
    pullRequest: {
      number: 10,
      headSha: "1111111",
      reviewedSha: "1111111",
      state: "open" as const,
      draft: false,
      mergeable: true,
    },
    reviewFindings: [],
    ciAnalysis: {
      hasFailures: false,
      failedCheckNames: [],
      correlatedFailures: [],
      summary: "All CI passed",
      allRequiredPassed: true,
    },
    branchProtectionEvaluation: {
      isSatisfied: true,
      violations: [],
      approvalsCount: 2,
      requiredApprovalsCount: 2,
      hasHumanChangeRequests: false,
      statusChecksPass: true,
      codeOwnersSatisfied: true,
    },
    protectedPathsClean: true,
    executorAppActive: true,
  };

  it("permits merge when all deterministic gates pass", () => {
    const decision = evaluateMergeGate(baseInput);
    expect(decision.allowed).toBe(true);
    expect(decision.blockingReasons).toHaveLength(0);
  });

  it("fails closed when merge mode is 'never'", () => {
    const decision = evaluateMergeGate({
      ...baseInput,
      repositoryMergeMode: "never",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.blockingReasons.some((r) => r.includes("'never'"))).toBe(true);
  });

  it("fails closed when PR head SHA moved since review", () => {
    const decision = evaluateMergeGate({
      ...baseInput,
      pullRequest: {
        ...baseInput.pullRequest,
        headSha: "2222222",
        reviewedSha: "1111111",
      },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.blockingReasons.some((r) => r.includes("head SHA moved"))).toBe(true);
  });

  it("fails closed when unresolved blocking AI findings exist", () => {
    const decision = evaluateMergeGate({
      ...baseInput,
      reviewFindings: [
        {
          severity: "critical",
          category: "security",
          title: "SQL Injection",
          explanation: "Raw input in query",
          path: "src/db.ts",
          line: 5,
          side: "RIGHT",
          confidence: 0.99,
          evidence: "no param",
          suggestedPatch: null,
          fingerprint: "fp1",
          inlineEligible: true,
        },
      ],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.blockingReasons.some((r) => r.includes("blocking finding"))).toBe(true);
  });

  it("fails closed when emergency kill switch is active", () => {
    const decision = evaluateMergeGate({
      ...baseInput,
      isEmergencyKillSwitchActive: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.blockingReasons.some((r) => r.includes("kill switch"))).toBe(true);
  });

  it("fails closed when CI checks fail", () => {
    const decision = evaluateMergeGate({
      ...baseInput,
      ciAnalysis: {
        hasFailures: true,
        failedCheckNames: ["build-production"],
        correlatedFailures: [],
        summary: "Build failed",
        allRequiredPassed: false,
      },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.blockingReasons.some((r) => r.includes("CI checks failed"))).toBe(true);
  });
});
