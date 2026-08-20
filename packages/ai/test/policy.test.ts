import { describe, expect, it } from "vitest";
import {
  evaluateBranchProtection,
  evaluateCodeOwners,
  parseCodeOwners,
} from "../src/policy-engine";

describe("CODEOWNERS and Branch Protection Policy Engine", () => {
  it("parses CODEOWNERS files and extracts pattern-owner rules", () => {
    const content = `
# Global default
* @global-owner

# Auth components
/src/auth/** @security-team @auth-lead
*.go @go-team
`;
    const rules = parseCodeOwners(content);
    expect(rules).toHaveLength(3);
    expect(rules[0]?.pattern).toBe("*");
    expect(rules[1]?.pattern).toBe("/src/auth/**");
    expect(rules[1]?.owners).toEqual(["@security-team", "@auth-lead"]);
  });

  it("evaluates required CODEOWNERS with precedence and approval matching", () => {
    const rules = parseCodeOwners(`
* @general-team
/src/auth/** @security-team
`);
    const evalResult = evaluateCodeOwners(
      rules,
      ["src/auth/login.ts", "src/utils.ts"],
      ["security-team", "general-team"],
    );

    expect(evalResult.isSatisfied).toBe(true);
    expect(evalResult.allRequiredOwners).toContain("security-team");
    expect(evalResult.allRequiredOwners).toContain("general-team");
    expect(evalResult.unapprovedOwners).toHaveLength(0);
  });

  it("evaluates branch protection and detects violations", () => {
    const rules = {
      requiredApprovingReviewCount: 2,
      requireCodeOwnerReviews: true,
      dismissStaleReviews: true,
      requireLinearHistory: true,
      requiredStatusCheckContexts: ["ci/build", "ci/test"],
      strictRequiredStatusChecks: true,
      enforceAdmins: false,
      allowForcePushes: false,
      allowDeletions: false,
    };

    const evaluation = evaluateBranchProtection(rules, {
      humanApprovals: ["alice"],
      humanChangeRequests: ["bob"],
      completedCheckContexts: [
        { name: "ci/build", state: "success" },
        { name: "ci/test", state: "failure" },
      ],
      codeOwnersEvaluation: {
        matchedRules: [],
        allRequiredOwners: ["security-team"],
        approvingOwners: [],
        unapprovedOwners: ["security-team"],
        isSatisfied: false,
      },
    });

    expect(evaluation.isSatisfied).toBe(false);
    expect(evaluation.hasHumanChangeRequests).toBe(true);
    expect(evaluation.statusChecksPass).toBe(false);
    expect(evaluation.violations.length).toBeGreaterThanOrEqual(3);
  });
});
