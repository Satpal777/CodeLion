import type { SupportedLanguage } from "./languages";
import { getLanguageAdapter } from "./adapters/registry";
import type { ChunkOptions, CodeChunk, SymbolRecord, SymbolEdge, TestLink, LanguageReviewProfile } from "./adapters/base";

export type { ChunkOptions, CodeChunk, SymbolRecord, SymbolEdge, TestLink, LanguageReviewProfile };

export function chunkSource(
  path: string,
  language: SupportedLanguage,
  source: string,
  options: ChunkOptions = {},
): CodeChunk[] {
  if (source.includes("\u0000")) return [];
  const adapter = getLanguageAdapter(language);
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const doc = {
    path,
    language,
    source,
    lines,
    ast: { type: "Program", startLine: 1, endLine: lines.length },
    isGenerated: false,
    isTest: false,
    syntaxValid: true,
    parseErrors: [],
  };
  return adapter.chunk(doc, options);
}

export function extractSymbols(path: string, language: SupportedLanguage, source: string): SymbolRecord[] {
  if (source.includes("\u0000")) return [];
  const adapter = getLanguageAdapter(language);
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const doc = {
    path,
    language,
    source,
    lines,
    ast: { type: "Program", startLine: 1, endLine: lines.length },
    isGenerated: false,
    isTest: false,
    syntaxValid: true,
    parseErrors: [],
  };
  return adapter.symbols(doc);
}

export function extractEdges(path: string, language: SupportedLanguage, source: string): SymbolEdge[] {
  if (source.includes("\u0000")) return [];
  const adapter = getLanguageAdapter(language);
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const doc = {
    path,
    language,
    source,
    lines,
    ast: { type: "Program", startLine: 1, endLine: lines.length },
    isGenerated: false,
    isTest: false,
    syntaxValid: true,
    parseErrors: [],
  };
  return adapter.edges(doc, { rootFiles: [path], manifests: [], frameworks: [] });
}

export function getLanguageProfile(language: SupportedLanguage): LanguageReviewProfile {
  const adapter = getLanguageAdapter(language);
  return adapter.reviewProfile();
}
