import { describe, expect, it } from "vitest";
import {
  aggregateBatchReviewResults,
  isGeneratedOrBinaryFile,
  partitionReviewBatches,
} from "../src/batching";
import { enrichDiffWithCallersAndPrevState } from "../src/context-enricher";
import type { ReviewResult } from "../src/schemas";

describe("batching & context enricher engine", () => {
  it("detects generated and lock files", () => {
    expect(isGeneratedOrBinaryFile("package-lock.json")).toBe(true);
    expect(isGeneratedOrBinaryFile("pnpm-lock.yaml")).toBe(true);
    expect(isGeneratedOrBinaryFile("dist/bundle.js")).toBe(true);
    expect(isGeneratedOrBinaryFile("src/index.ts")).toBe(false);
  });

  it("partitions large file lists into structured review batches", () => {
    const files = [
      { path: "src/auth/login.ts", status: "modified", additions: 200, deletions: 50, patch: "@@ -1 +1 @@" },
      { path: "src/auth/logout.ts", status: "modified", additions: 100, deletions: 10, patch: "@@ -1 +1 @@" },
      { path: "src/billing/invoice.ts", status: "modified", additions: 800, deletions: 200, patch: "@@ -1 +1 @@" },
      { path: "src/billing/stripe.ts", status: "modified", additions: 500, deletions: 100, patch: "@@ -1 +1 @@" },
      { path: "package-lock.json", status: "modified", additions: 2000, deletions: 1000, patch: "@@ -1 +1 @@" },
    ];

    const { reviewBatches, skippedFiles } = partitionReviewBatches(files, {
      maxFilesPerBatch: 2,
      maxLinesPerBatch: 600,
    });

    expect(skippedFiles.length).toBe(1);
    expect(skippedFiles[0]?.path).toBe("package-lock.json");
    expect(reviewBatches.length).toBeGreaterThanOrEqual(2);
  });

  it("enriches diff with previous state and caller call-sites", () => {
    const files = [
      {
        path: "src/services/user.ts",
        status: "modified",
        additions: 10,
        deletions: 5,
        patch: `@@ -10,5 +10,10 @@
-function getUser(id: string) {
+function getUser(id: string, orgId: string) {
+  return db.query(id, orgId);
 }`,
      },
    ];

    const storedChunks = [
      {
        path: "src/controllers/auth.ts",
        symbol: "handleLogin",
        startLine: 20,
        endLine: 35,
        content: "const user = await getUser(req.userId);",
      },
    ];

    const deltas = enrichDiffWithCallersAndPrevState(files, storedChunks);
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas[0]?.symbol).toBe("getUser");
    expect(deltas[0]?.callersAndReferences.length).toBe(1);
    expect(deltas[0]?.callersAndReferences[0]?.path).toBe("src/controllers/auth.ts");
  });

  it("aggregates multiple batch results into a unified ReviewResult", () => {
    const batch1: ReviewResult = {
      decision: "comment",
      summary: "Batch 1 passed with minor comments.",
      riskScore: 0.3,
      findings: [
        {
          fingerprint: "f-1",
          severity: "low",
          category: "maintainability",
          title: "Format code",
          explanation: "Add spacing",
          path: "src/a.ts",
          line: 10,
          side: "RIGHT",
          confidence: 0.9,
          evidence: "line 10",
          suggestedPatch: null,
          inlineEligible: true,
        },
      ],
      positiveNotes: ["Clean structure"],
      testRecommendations: ["test-auth"],
      uncertainty: [],
      suppressedFindingCount: 0,
    };

    const batch2: ReviewResult = {
      decision: "request_changes",
      summary: "Batch 2 had critical vulnerabilities.",
      riskScore: 0.9,
      findings: [
        {
          fingerprint: "f-2",
          severity: "critical",
          category: "security",
          title: "SQL Injection",
          explanation: "Unescaped query parameter",
          path: "src/b.ts",
          line: 55,
          side: "RIGHT",
          confidence: 0.95,
          evidence: "line 55 query",
          suggestedPatch: "safeQuery(param)",
          inlineEligible: true,
        },
      ],
      positiveNotes: [],
      testRecommendations: ["test-security"],
      uncertainty: [],
      suppressedFindingCount: 1,
    };

    const combined = aggregateBatchReviewResults([batch1, batch2]);
    expect(combined.decision).toBe("request_changes");
    expect(combined.riskScore).toBe(0.9);
    expect(combined.findings.length).toBe(2);
    expect(combined.testRecommendations).toContain("test-auth");
    expect(combined.testRecommendations).toContain("test-security");
    expect(combined.positiveNotes).toContain("Clean structure");
  });
});
