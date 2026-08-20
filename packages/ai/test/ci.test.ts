import { describe, expect, it } from "vitest";
import { analyzeCIOutcomes } from "../src/ci";

describe("CI Analysis and Check Run Correlation", () => {
  it("correlates check run failure annotations with changed files", () => {
    const analysis = analyzeCIOutcomes(
      [
        {
          id: 1,
          name: "vitest",
          headSha: "abc1234",
          status: "completed",
          conclusion: "failure",
          startedAt: null,
          completedAt: null,
          htmlUrl: null,
          outputTitle: "Test failure",
          outputSummary: "1 test failed in src/auth.ts",
          outputText: null,
          annotations: [
            {
              path: "src/auth.ts",
              startLine: 42,
              endLine: 42,
              annotationLevel: "failure",
              message: "Expected 200 OK but got 401 Unauthorized",
            },
          ],
        },
      ],
      ["src/auth.ts"],
      ["vitest"],
    );

    expect(analysis.hasFailures).toBe(true);
    expect(analysis.allRequiredPassed).toBe(false);
    expect(analysis.correlatedFailures).toHaveLength(1);
    expect(analysis.correlatedFailures[0]?.path).toBe("src/auth.ts");
    expect(analysis.correlatedFailures[0]?.line).toBe(42);
  });

  it("reports all required checks passed when conclusions are success", () => {
    const analysis = analyzeCIOutcomes(
      [
        {
          id: 1,
          name: "build",
          headSha: "abc1234",
          status: "completed",
          conclusion: "success",
          startedAt: null,
          completedAt: null,
          htmlUrl: null,
          outputTitle: "Build passed",
          outputSummary: "Build successful",
          outputText: null,
        },
      ],
      ["src/app.ts"],
      ["build"],
    );

    expect(analysis.hasFailures).toBe(false);
    expect(analysis.allRequiredPassed).toBe(true);
  });
});
