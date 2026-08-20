import type { Finding } from "./schemas";

export interface PriorFindingSuggestion {
  findingId: string;
  reviewRunId: string;
  path: string;
  line: number | null;
  title: string;
  suggestedPatch: string | null;
}

export interface AcceptanceCheckResult {
  accepted: boolean;
  reason: string;
}

/**
 * Evaluates whether a previous finding's suggested changes were applied in a subsequent commit diff.
 */
export function evaluateSuggestionAccepted(
  suggestion: PriorFindingSuggestion,
  filePatch: string | null,
): AcceptanceCheckResult {
  if (!suggestion.suggestedPatch || !filePatch) {
    return { accepted: false, reason: "missing_patch" };
  }

  // Normalize suggestion tokens
  const suggestionLines = suggestion.suggestedPatch
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && !l.startsWith("//") && !l.startsWith("#"));

  if (suggestionLines.length === 0) {
    return { accepted: false, reason: "empty_suggestion" };
  }

  // Extract added lines in the new git patch
  const patchAdditions = filePatch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1).trim())
    .filter((l) => l.length > 2);

  if (patchAdditions.length === 0) {
    return { accepted: false, reason: "no_additions_in_file" };
  }

  // Check how many of the suggested lines are present in the patch additions
  let matchCount = 0;
  for (const sLine of suggestionLines) {
    const found = patchAdditions.some(
      (pLine) => pLine.includes(sLine) || sLine.includes(pLine),
    );
    if (found) matchCount += 1;
  }

  const matchRatio = matchCount / suggestionLines.length;

  if (matchRatio >= 0.7) {
    return {
      accepted: true,
      reason: `Match ratio ${Math.round(matchRatio * 100)}% for suggestion '${suggestion.title}'`,
    };
  }

  return { accepted: false, reason: `Low match ratio ${Math.round(matchRatio * 100)}%` };
}
