export interface CheckRunDTO {
  id: number;
  name: string;
  headSha: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "skipped" | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string | null;
  outputTitle: string | null;
  outputSummary: string | null;
  outputText: string | null;
  annotations?: Array<{
    path: string;
    startLine: number;
    endLine: number;
    annotationLevel: "notice" | "warning" | "failure";
    message: string;
    rawDetails?: string;
  }>;
}

export interface CheckSuiteDTO {
  id: number;
  headSha: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "stale" | null;
  checkRunsCount: number;
  latestCheckRuns: CheckRunDTO[];
}

export interface CorrelatedCIFailure {
  checkName: string;
  path?: string | null | undefined;
  line?: number | null | undefined;
  rootCause: string;
  recommendation: string;
}

export interface CIFailureAnalysis {
  hasFailures: boolean;
  failedCheckNames: string[];
  correlatedFailures: CorrelatedCIFailure[];
  summary: string;
  allRequiredPassed: boolean;
}

/**
 * Analyzes CI check runs, extracts failure logs/annotations, and correlates them
 * directly with changed files in the pull request diff without claiming to run tests locally.
 */
export function analyzeCIOutcomes(
  checkRuns: CheckRunDTO[],
  changedPaths: string[] = [],
  requiredCheckNames: string[] = [],
): CIFailureAnalysis {
  const failedChecks = checkRuns.filter(
    (c) => c.status === "completed" && c.conclusion !== "success" && c.conclusion !== "skipped" && c.conclusion !== "neutral",
  );

  const correlatedFailures: CorrelatedCIFailure[] = [];

  for (const check of failedChecks) {
    let matchedPath: string | undefined;
    let matchedLine: number | undefined;

    // Check annotations
    if (check.annotations?.length) {
      const failureAnnotation = check.annotations.find((a) => a.annotationLevel === "failure") ?? check.annotations[0];
      if (failureAnnotation) {
        matchedPath = failureAnnotation.path;
        matchedLine = failureAnnotation.startLine;
      }
    }

    // If no annotation path, check output summary for changed file mentions
    if (!matchedPath && (check.outputSummary || check.outputText)) {
      const fullText = `${check.outputSummary ?? ""} ${check.outputText ?? ""}`;
      for (const p of changedPaths) {
        if (fullText.includes(p)) {
          matchedPath = p;
          break;
        }
      }
    }

    const failureDetails = check.outputSummary ?? check.outputTitle ?? check.conclusion ?? "Check failed";
    correlatedFailures.push({
      checkName: check.name,
      path: matchedPath,
      line: matchedLine,
      rootCause: failureDetails,
      recommendation: matchedPath
        ? `Investigate failure in \`${matchedPath}\`${matchedLine ? ` around line ${matchedLine}` : ""}: ${failureDetails}`
        : `Check ${check.name} logs for detailed test / build errors.`,
    });
  }

  // Check required checks
  const allRequiredPassed =
    requiredCheckNames.length > 0
      ? requiredCheckNames.every((name) => {
          const run = checkRuns.find((c) => c.name === name);
          return run?.status === "completed" && (run.conclusion === "success" || run.conclusion === "skipped");
        })
      : failedChecks.length === 0;

  const summary = failedChecks.length === 0
    ? `All ${checkRuns.length} observed check runs passed successfully.`
    : `${failedChecks.length} check run(s) reported failures (${failedChecks.map((c) => c.name).join(", ")}).`;

  return {
    hasFailures: failedChecks.length > 0,
    failedCheckNames: failedChecks.map((c) => c.name),
    correlatedFailures,
    summary,
    allRequiredPassed,
  };
}
