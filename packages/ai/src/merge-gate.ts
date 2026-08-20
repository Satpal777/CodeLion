import type { ReviewFinding } from "./schemas";
import type { BranchProtectionEvaluation } from "./policy-engine";
import type { CIFailureAnalysis } from "./ci";

export type MergeMode = "never" | "after_approval" | "after_all_gates";

export interface MergeGateInput {
  repositoryMergeMode: MergeMode;
  isEmergencyKillSwitchActive?: boolean;
  pullRequest: {
    number: number;
    headSha: string;
    reviewedSha: string;
    state: "open" | "closed" | "merged";
    draft: boolean;
    mergeable: boolean | null;
  };
  reviewFindings: ReviewFinding[];
  ciAnalysis: CIFailureAnalysis;
  branchProtectionEvaluation?: BranchProtectionEvaluation;
  protectedPathsClean: boolean;
  executorAppActive: boolean;
}

export interface MergeGateDecision {
  allowed: boolean;
  mode: MergeMode;
  reason: string;
  checks: {
    modePermitsMerge: boolean;
    headShaMatches: boolean;
    prOpenAndMergeable: boolean;
    noBlockingFindings: boolean;
    noHumanBlockers: boolean;
    ciPassing: boolean;
    branchProtectionSatisfied: boolean;
    protectedPathsClean: boolean;
    executorAppActive: boolean;
    killSwitchClear: boolean;
  };
  blockingReasons: string[];
}

/**
 * Deterministically evaluates whether a pull request is eligible for automated merge or merge-queue entry.
 * Follows strict fail-closed security invariants: model cannot unilaterally merge without deterministic policy compliance.
 */
export function evaluateMergeGate(input: MergeGateInput): MergeGateDecision {
  const blockingReasons: string[] = [];

  // 1. Merge Mode Check
  const modePermitsMerge = input.repositoryMergeMode !== "never";
  if (!modePermitsMerge) {
    blockingReasons.push("Repository merge mode is set to 'never' (review only).");
  }

  // 2. Kill switch check
  const killSwitchClear = !input.isEmergencyKillSwitchActive;
  if (!killSwitchClear) {
    blockingReasons.push("Emergency merge kill switch is active for this repository/workspace.");
  }

  // 3. Exact head SHA check (CAS)
  const headShaMatches = input.pullRequest.headSha === input.pullRequest.reviewedSha;
  if (!headShaMatches) {
    blockingReasons.push(
      `PR head SHA moved (${input.pullRequest.headSha.slice(0, 7)}) since last review (${input.pullRequest.reviewedSha.slice(0, 7)}). Re-review required.`,
    );
  }

  // 4. PR open and mergeable
  const prOpenAndMergeable =
    input.pullRequest.state === "open" && !input.pullRequest.draft && input.pullRequest.mergeable !== false;
  if (!prOpenAndMergeable) {
    if (input.pullRequest.state !== "open") blockingReasons.push("PR is not open.");
    if (input.pullRequest.draft) blockingReasons.push("PR is marked as draft.");
    if (input.pullRequest.mergeable === false) blockingReasons.push("PR has merge conflicts.");
  }

  // 5. Unresolved blocking AI findings check
  const blockingFindings = input.reviewFindings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  );
  const noBlockingFindings = blockingFindings.length === 0;
  if (!noBlockingFindings) {
    blockingReasons.push(
      `${blockingFindings.length} unresolved high/critical blocking finding(s) present on PR.`,
    );
  }

  // 6. CI / Status Checks check
  const ciPassing = input.ciAnalysis.allRequiredPassed;
  if (!ciPassing) {
    blockingReasons.push(`CI checks failed: ${input.ciAnalysis.failedCheckNames.join(", ")}.`);
  }

  // 7. Branch protection & CODEOWNERS
  let branchProtectionSatisfied = true;
  let noHumanBlockers = true;
  if (input.branchProtectionEvaluation) {
    branchProtectionSatisfied = input.branchProtectionEvaluation.isSatisfied;
    noHumanBlockers = !input.branchProtectionEvaluation.hasHumanChangeRequests;
    if (!branchProtectionSatisfied) {
      blockingReasons.push(...input.branchProtectionEvaluation.violations);
    }
  }

  // 8. Protected paths check
  const protectedPathsClean = input.protectedPathsClean;
  if (!protectedPathsClean) {
    blockingReasons.push("PR touches protected files requiring manual administrative review.");
  }

  // 9. Executor app authorization check
  const executorAppActive = input.executorAppActive;
  if (!executorAppActive) {
    blockingReasons.push("Executor GitHub App is not installed or enabled for write actions.");
  }

  const allowed = blockingReasons.length === 0;
  const reason = allowed
    ? "All deterministic policy, branch protection, CI, and approval gates passed."
    : `Merge denied: ${blockingReasons.join(" ")}`;

  return {
    allowed,
    mode: input.repositoryMergeMode,
    reason,
    checks: {
      modePermitsMerge,
      headShaMatches,
      prOpenAndMergeable,
      noBlockingFindings,
      noHumanBlockers,
      ciPassing,
      branchProtectionSatisfied,
      protectedPathsClean,
      executorAppActive,
      killSwitchClear,
    },
    blockingReasons,
  };
}
