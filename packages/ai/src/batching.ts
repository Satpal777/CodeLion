import type { ReviewDecision, ReviewResult, ValidatedFinding } from "./schemas";
import type { ReviewFile } from "./review";

export interface ReviewBatch {
  batchIndex: number;
  totalBatches: number;
  batchName: string;
  files: ReviewFile[];
  totalChangedLines: number;
}

const IGNORED_EXTENSIONS = new Set([
  "lock",
  "min.js",
  "min.css",
  "map",
  "svg",
  "png",
  "jpg",
  "jpeg",
  "ico",
  "woff",
  "woff2",
  "ttf",
  "eot",
]);

const IGNORED_FILENAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "cargo.lock",
  "gemfile.lock",
  "composer.lock",
  "poetry.lock",
]);

export function isGeneratedOrBinaryFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const filename = normalized.split("/").pop() ?? "";
  if (IGNORED_FILENAMES.has(filename)) return true;

  const ext = filename.split(".").pop() ?? "";
  if (IGNORED_EXTENSIONS.has(ext)) return true;

  return (
    normalized.startsWith("dist/") ||
    normalized.includes("/dist/") ||
    normalized.startsWith("build/") ||
    normalized.includes("/build/") ||
    normalized.startsWith("node_modules/") ||
    normalized.includes("/node_modules/") ||
    normalized.startsWith(".next/") ||
    normalized.includes("/.next/") ||
    normalized.startsWith("vendor/") ||
    normalized.includes("/vendor/")
  );
}

export interface PartitionOptions {
  maxFilesPerBatch?: number;
  maxLinesPerBatch?: number;
}

/**
 * Partitions a list of changed PR files into manageable, focused review batches.
 * Groups by directory/module to keep related changes together.
 */
export function partitionReviewBatches(
  files: ReviewFile[],
  options: PartitionOptions = {},
): { reviewBatches: ReviewBatch[]; skippedFiles: ReviewFile[] } {
  const maxFiles = options.maxFilesPerBatch ?? 8;
  const maxLines = options.maxLinesPerBatch ?? 1_200;

  const reviewableFiles: ReviewFile[] = [];
  const skippedFiles: ReviewFile[] = [];

  for (const file of files) {
    if (isGeneratedOrBinaryFile(file.path)) {
      skippedFiles.push(file);
    } else {
      reviewableFiles.push(file);
    }
  }

  if (reviewableFiles.length === 0) {
    return { reviewBatches: [], skippedFiles };
  }

  // Sort files by directory path so related files stay in the same batch
  const sortedFiles = [...reviewableFiles].sort((a, b) => a.path.localeCompare(b.path));

  const batches: ReviewFile[][] = [];
  let currentBatch: ReviewFile[] = [];
  let currentLines = 0;

  for (const file of sortedFiles) {
    const fileLines = file.additions + file.deletions;

    const willExceedFiles = currentBatch.length >= maxFiles;
    const willExceedLines = currentLines + fileLines > maxLines && currentBatch.length > 0;

    if (willExceedFiles || willExceedLines) {
      batches.push(currentBatch);
      currentBatch = [];
      currentLines = 0;
    }

    currentBatch.push(file);
    currentLines += fileLines;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  const reviewBatches: ReviewBatch[] = batches.map((batchFiles, index) => {
    const topDir = batchFiles[0]?.path.split("/").slice(0, 2).join("/") ?? `batch-${index + 1}`;
    const totalLines = batchFiles.reduce((acc, f) => acc + f.additions + f.deletions, 0);
    return {
      batchIndex: index + 1,
      totalBatches: batches.length,
      batchName: `Batch ${index + 1}/${batches.length}: ${topDir} (${batchFiles.length} files, ${totalLines} LOC)`,
      files: batchFiles,
      totalChangedLines: totalLines,
    };
  });

  return { reviewBatches, skippedFiles };
}

/**
 * Merges and deduplicates multiple review batch results into a single comprehensive ReviewResult.
 */
export function aggregateBatchReviewResults(
  batchResults: ReviewResult[],
  skippedFileCount: number = 0,
): ReviewResult {
  if (batchResults.length === 0) {
    return {
      decision: "approve",
      summary: "No actionable code files required review.",
      riskScore: 0,
      findings: [],
      positiveNotes: [],
      testRecommendations: [],
      uncertainty: [],
      suppressedFindingCount: 0,
    };
  }

  const allFindings: ValidatedFinding[] = [];
  const seenFingerprints = new Set<string>();
  let totalSuppressed = 0;
  const testRecommendationsSet = new Set<string>();
  const positiveNotesSet = new Set<string>();
  const uncertaintySet = new Set<string>();
  let maxRiskScore = 0;
  const summaries: string[] = [];

  for (const res of batchResults) {
    if (res.summary) summaries.push(res.summary);
    if (res.riskScore > maxRiskScore) maxRiskScore = res.riskScore;
    totalSuppressed += res.suppressedFindingCount;

    for (const note of res.positiveNotes) {
      positiveNotesSet.add(note);
    }
    for (const test of res.testRecommendations) {
      testRecommendationsSet.add(test);
    }
    for (const unc of res.uncertainty) {
      uncertaintySet.add(unc);
    }

    for (const finding of res.findings) {
      if (!seenFingerprints.has(finding.fingerprint)) {
        seenFingerprints.add(finding.fingerprint);
        allFindings.push(finding);
      }
    }
  }

  // Determine overall decision based on combined findings
  let decision: ReviewDecision = "approve";
  if (allFindings.some((f) => f.severity === "critical" || f.severity === "high")) {
    decision = "request_changes";
  } else if (allFindings.length > 0) {
    decision = "comment";
  }

  const batchSummary =
    batchResults.length > 1
      ? `Reviewed ${batchResults.length} batches across the diff (${allFindings.length} findings identified${
          skippedFileCount > 0 ? `, ${skippedFileCount} generated/lock files skipped` : ""
        }).`
      : summaries[0] ?? "Review completed.";

  return {
    decision,
    summary: batchSummary,
    riskScore: maxRiskScore,
    findings: allFindings,
    positiveNotes: Array.from(positiveNotesSet).slice(0, 10),
    testRecommendations: Array.from(testRecommendationsSet).slice(0, 10),
    uncertainty: Array.from(uncertaintySet).slice(0, 10),
    suppressedFindingCount: totalSuppressed,
  };
}
