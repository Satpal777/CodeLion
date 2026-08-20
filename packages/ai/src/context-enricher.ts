import type { ReviewFile, RetrievedContext } from "./review";
import type { CodeChunk } from "./indexer/chunker";

export interface SymbolDeltaContext {
  symbol: string;
  path: string;
  previousStateSnippet: string;
  newStateSnippet: string;
  callersAndReferences: Array<{
    path: string;
    startLine: number;
    endLine: number;
    snippet: string;
    modifiedInThisPr: boolean;
  }>;
}

/**
 * Extracts changed functions/symbols from diffs, comparing previous state vs new state,
 * and attaches caller call-sites from indexed chunks across the repository.
 */
export function enrichDiffWithCallersAndPrevState(
  files: ReviewFile[],
  storedChunks: Array<{
    path: string;
    symbol: string | null;
    startLine: number;
    endLine: number;
    content: string;
  }>,
): SymbolDeltaContext[] {
  const modifiedFilePaths = new Set(files.map((f) => f.path));
  const deltas: SymbolDeltaContext[] = [];

  for (const file of files) {
    if (!file.patch) continue;

    // Extract deleted and added lines from patch
    const patchLines = file.patch.split("\n");
    const deletedLines: string[] = [];
    const addedLines: string[] = [];
    const symbolCandidates = new Set<string>();

    for (const line of patchLines) {
      if (line.startsWith("-") && !line.startsWith("---")) {
        deletedLines.push(line.slice(1));
        // Match function/class/method names
        const fnMatch = /(?:function|class|interface|type|const|let|var|def|fn|func)\s+([a-zA-Z0-9_$]+)/.exec(line);
        if (fnMatch?.[1]) symbolCandidates.add(fnMatch[1]);
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        addedLines.push(line.slice(1));
        const fnMatch = /(?:function|class|interface|type|const|let|var|def|fn|func)\s+([a-zA-Z0-9_$]+)/.exec(line);
        if (fnMatch?.[1]) symbolCandidates.add(fnMatch[1]);
      }
    }

    // For each identified symbol, find callers/references in stored chunks
    for (const sym of Array.from(symbolCandidates).slice(0, 10)) {
      const callers: SymbolDeltaContext["callersAndReferences"] = [];

      for (const chunk of storedChunks) {
        // Look for chunks that reference this symbol outside of its declaration
        if (chunk.content.includes(sym)) {
          callers.push({
            path: chunk.path,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            snippet: chunk.content.slice(0, 500),
            modifiedInThisPr: modifiedFilePaths.has(chunk.path),
          });
          if (callers.length >= 5) break;
        }
      }

      deltas.push({
        symbol: sym,
        path: file.path,
        previousStateSnippet: deletedLines.slice(0, 20).join("\n"),
        newStateSnippet: addedLines.slice(0, 20).join("\n"),
        callersAndReferences: callers,
      });
    }
  }

  return deltas;
}
