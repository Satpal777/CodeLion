import { describe, expect, it } from "vitest";
import { isProtectedPath, validatePatchPaths } from "../src/executor";

describe("Executor GitHub App & Protected Paths", () => {
  it("detects protected paths correctly", () => {
    expect(isProtectedPath(".github/workflows/ci.yml")).toBe(true);
    expect(isProtectedPath("infra/production/main.tf")).toBe(true);
    expect(isProtectedPath(".env.production")).toBe(true);
    expect(isProtectedPath("secrets/token.json")).toBe(true);
    expect(isProtectedPath("id_rsa")).toBe(true);
    expect(isProtectedPath("server.key")).toBe(true);
    expect(isProtectedPath("src/auth.ts")).toBe(false);
    expect(isProtectedPath("packages/ai/src/review.ts")).toBe(false);
  });

  it("validates patch paths and rejects unsafe files", () => {
    const result = validatePatchPaths([
      { path: "src/app.ts", content: "export const app = {};" },
      { path: ".github/workflows/deploy.yml", content: "name: pwned" },
    ]);

    expect(result.valid).toBe(false);
    expect(result.rejectedPaths).toEqual([".github/workflows/deploy.yml"]);
  });

  it("accepts safe code changes", () => {
    const result = validatePatchPaths([
      { path: "src/utils.ts", content: "export const add = (a, b) => a + b;" },
      { path: "tests/utils.test.ts", content: "it('adds', () => {});" },
    ]);

    expect(result.valid).toBe(true);
    expect(result.rejectedPaths).toHaveLength(0);
  });
});
