export interface CodeOwnerRule {
  pattern: string;
  owners: string[];
}

export interface CodeOwnersEvaluation {
  matchedRules: Array<{ path: string; pattern: string; requiredOwners: string[] }>;
  allRequiredOwners: string[];
  approvingOwners: string[];
  unapprovedOwners: string[];
  isSatisfied: boolean;
}

export interface BranchProtectionRules {
  requiredApprovingReviewCount: number;
  requireCodeOwnerReviews: boolean;
  dismissStaleReviews: boolean;
  requireLinearHistory: boolean;
  requiredStatusCheckContexts: string[];
  strictRequiredStatusChecks: boolean;
  enforceAdmins: boolean;
  allowForcePushes: boolean;
  allowDeletions: boolean;
}

export interface BranchProtectionEvaluation {
  isSatisfied: boolean;
  violations: string[];
  approvalsCount: number;
  requiredApprovalsCount: number;
  hasHumanChangeRequests: boolean;
  statusChecksPass: boolean;
  codeOwnersSatisfied: boolean;
}

/**
 * Parses GitHub CODEOWNERS syntax into structured rules.
 */
export function parseCodeOwners(content: string): CodeOwnerRule[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const rules: CodeOwnerRule[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parts = trimmed.split(/\s+/);
    const pattern = parts[0];
    const owners = parts.slice(1).filter((o) => o.startsWith("@") || o.includes("@"));

    if (pattern && owners.length > 0) {
      rules.push({ pattern, owners });
    }
  }

  return rules;
}

/**
 * Match a file path against a glob-like CODEOWNERS pattern.
 */
export function matchCodeOwnerPattern(pattern: string, filePath: string): boolean {
  const normPattern = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  const normPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;

  if (normPattern === "*") return true;
  if (normPattern.endsWith("/*")) {
    const dir = normPattern.slice(0, -2);
    return normPath.startsWith(dir) && !normPath.slice(dir.length + 1).includes("/");
  }
  if (normPattern.endsWith("/")) {
    return normPath.startsWith(normPattern);
  }
  if (normPattern.includes("*")) {
    const regexStr = "^" + normPattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$";
    return new RegExp(regexStr).test(normPath);
  }
  return normPath === normPattern || normPath.startsWith(normPattern + "/");
}

/**
 * Evaluates whether required CODEOWNERS have approved the PR for touched files.
 */
export function evaluateCodeOwners(
  rules: CodeOwnerRule[],
  changedFilePaths: string[],
  approvedReviewerLogins: string[],
): CodeOwnersEvaluation {
  const matchedRules: CodeOwnersEvaluation["matchedRules"] = [];
  const requiredOwnersSet = new Set<string>();

  for (const file of changedFilePaths) {
    // In CODEOWNERS, later matching rules take precedence over earlier ones
    let matchedRule: CodeOwnerRule | undefined;
    for (let i = rules.length - 1; i >= 0; i -= 1) {
      const rule = rules[i];
      if (rule && matchCodeOwnerPattern(rule.pattern, file)) {
        matchedRule = rule;
        break;
      }
    }

    if (matchedRule) {
      matchedRules.push({
        path: file,
        pattern: matchedRule.pattern,
        requiredOwners: matchedRule.owners,
      });
      matchedRule.owners.forEach((o) => requiredOwnersSet.add(o.replace(/^@/, "")));
    }
  }

  const allRequiredOwners = Array.from(requiredOwnersSet);
  const approvingSet = new Set(approvedReviewerLogins.map((l) => l.toLowerCase()));
  const approvingOwners = allRequiredOwners.filter((o) => approvingSet.has(o.toLowerCase()));
  const unapprovedOwners = allRequiredOwners.filter((o) => !approvingSet.has(o.toLowerCase()));

  return {
    matchedRules,
    allRequiredOwners,
    approvingOwners,
    unapprovedOwners,
    isSatisfied: unapprovedOwners.length === 0,
  };
}

/**
 * Deterministically evaluates branch protection compliance for a PR.
 */
export function evaluateBranchProtection(
  rules: BranchProtectionRules,
  input: {
    humanApprovals: string[];
    humanChangeRequests: string[];
    completedCheckContexts: Array<{ name: string; state: "success" | "failure" | "pending" }>;
    codeOwnersEvaluation?: CodeOwnersEvaluation | undefined;
  },
): BranchProtectionEvaluation {
  const violations: string[] = [];

  // 1. Approvals count check
  const approvalsCount = input.humanApprovals.length;
  if (approvalsCount < rules.requiredApprovingReviewCount) {
    violations.push(
      `Insufficient human approvals: ${approvalsCount}/${rules.requiredApprovingReviewCount} required approvals met.`,
    );
  }

  // 2. Change requests check
  const hasHumanChangeRequests = input.humanChangeRequests.length > 0;
  if (hasHumanChangeRequests) {
    violations.push(
      `Active human change requests from: ${input.humanChangeRequests.join(", ")}.`,
    );
  }

  // 3. Status checks check
  let statusChecksPass = true;
  for (const requiredContext of rules.requiredStatusCheckContexts) {
    const check = input.completedCheckContexts.find((c) => c.name === requiredContext);
    if (!check || check.state !== "success") {
      statusChecksPass = false;
      violations.push(`Required status check '${requiredContext}' is ${check?.state ?? "missing"}.`);
    }
  }

  // 4. CODEOWNERS check
  let codeOwnersSatisfied = true;
  if (rules.requireCodeOwnerReviews && input.codeOwnersEvaluation) {
    if (!input.codeOwnersEvaluation.isSatisfied) {
      codeOwnersSatisfied = false;
      violations.push(
        `Missing required CODEOWNER approvals from: ${input.codeOwnersEvaluation.unapprovedOwners.join(", ")}.`,
      );
    }
  }

  return {
    isSatisfied: violations.length === 0,
    violations,
    approvalsCount,
    requiredApprovalsCount: rules.requiredApprovingReviewCount,
    hasHumanChangeRequests,
    statusChecksPass,
    codeOwnersSatisfied,
  };
}
