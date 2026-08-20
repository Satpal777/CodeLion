import { describe, expect, it } from "vitest";
import { generateFixPlan } from "../src/fixer";

describe("Fixer and Draft PR Engine", () => {
  it("generates structured fix plan with provenance", () => {
    const plan = generateFixPlan({
      repository: "acme/api",
      pullRequestNumber: 42,
      sourceHeadSha: "abc1234567",
      sourceBranch: "feature/new-auth",
      requesterLogin: "alice",
      userInstructions: "fix the null pointer exception",
      targetFindings: [
        {
          severity: "high",
          category: "correctness",
          title: "Null pointer dereference",
          explanation: "user may be null",
          path: "src/auth.ts",
          line: 2,
          side: "RIGHT",
          confidence: 0.95,
          evidence: "no null check",
          suggestedPatch: "if (!user) return null;",
        },
      ],
      existingFiles: [
        {
          path: "src/auth.ts",
          content: "export function getUser(user) {\n  return user.name;\n}",
        },
      ],
      destination: "stacked_pr",
    });

    expect(plan.destination).toBe("stacked_pr");
    expect(plan.filesToUpdate).toHaveLength(1);
    expect(plan.filesToUpdate[0]?.content).toContain("if (!user) return null;");
    expect(plan.validationReport.protectedPathsClean).toBe(true);
    expect(plan.provenance.requester).toBe("alice");
    expect(plan.description).toContain("**Requested by:** @alice");
  });

  it("refuses to generate fixes for protected paths", () => {
    const plan = generateFixPlan({
      repository: "acme/api",
      pullRequestNumber: 42,
      sourceHeadSha: "abc1234567",
      sourceBranch: "feature/new-auth",
      requesterLogin: "attacker",
      userInstructions: "update ci workflow",
      targetFindings: [
        {
          severity: "high",
          category: "security",
          title: "Insecure workflow",
          explanation: "update workflow",
          path: ".github/workflows/deploy.yml",
          line: 1,
          side: "RIGHT",
          confidence: 0.9,
          evidence: "",
          suggestedPatch: "name: pwned",
        },
      ],
      existingFiles: [
        {
          path: ".github/workflows/deploy.yml",
          content: "name: deploy",
        },
      ],
      destination: "stacked_pr",
    });

    expect(plan.validationReport.protectedPathsClean).toBe(false);
  });
});
