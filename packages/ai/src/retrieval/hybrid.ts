import type { SupportedLanguage } from "../indexer/languages";
import type { CodeChunk, SymbolEdge, SymbolRecord } from "../indexer/adapters/base";

export interface RetrievalQuery {
  terms: string[];
  symbols: string[];
  paths: string[];
  vectorEmbedding?: number[];
  language?: SupportedLanguage;
}

export interface CandidateChunk extends CodeChunk {
  score?: number;
  retrievalSource?: "exact_symbol" | "graph_neighbor" | "lexical" | "vector" | "hybrid";
}

export interface RetrievedContextItem {
  path: string;
  startLine: number;
  endLine: number;
  symbol: string | null;
  content: string;
  source: string;
  score: number;
  citation: string;
}

export interface ContextPlanOptions {
  maxTokens?: number;
  targetCommit?: string;
  includeGraphNeighbors?: boolean;
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    const a = vecA[i] ?? 0;
    const b = vecB[i] ?? 0;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function computeLexicalScore(queryTerms: string[], content: string): number {
  if (queryTerms.length === 0 || !content) return 0;
  const lowerContent = content.toLowerCase();
  let matches = 0;
  for (const term of queryTerms) {
    const lowerTerm = term.toLowerCase().trim();
    if (lowerTerm && lowerContent.includes(lowerTerm)) {
      // Bonus if it's an exact word
      const wordRegex = new RegExp(`\\b${lowerTerm}\\b`, "i");
      matches += wordRegex.test(lowerContent) ? 2 : 1;
    }
  }
  return matches / (queryTerms.length * 2);
}

/**
 * Reciprocal Rank Fusion (RRF) combines rankings from distinct retrieval mechanisms
 * (exact symbol, lexical search, and vector similarity).
 */
export function reciprocalRankFusion(
  rankings: Array<Array<{ item: CandidateChunk; score: number }>>,
  k = 60,
): CandidateChunk[] {
  const scoreMap = new Map<string, { chunk: CandidateChunk; rrfScore: number }>();

  for (const ranking of rankings) {
    ranking.forEach((entry, rank) => {
      const key = `${entry.item.path}:${entry.item.startLine}:${entry.item.contentHash}`;
      const rrfContribution = 1 / (k + rank + 1);
      const existing = scoreMap.get(key);
      if (existing) {
        existing.rrfScore += rrfContribution;
      } else {
        scoreMap.set(key, { chunk: entry.item, rrfScore: rrfContribution });
      }
    });
  }

  return Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map((entry) => ({ ...entry.chunk, score: entry.rrfScore }));
}

/**
 * Perform hybrid retrieval combining exact symbol matches, graph neighbors,
 * lexical search, and vector similarity over repository code chunks.
 */
export function hybridRetrieve(
  query: RetrievalQuery,
  allChunks: CandidateChunk[],
  edges: SymbolEdge[] = [],
  _symbols: SymbolRecord[] = [],
  options: { limit?: number; minScore?: number } = {},
): CandidateChunk[] {
  const limit = options.limit ?? 25;

  // 1. Exact Symbol / Path Matches
  const exactMatches: Array<{ item: CandidateChunk; score: number }> = [];
  for (const chunk of allChunks) {
    let exactScore = 0;
    if (chunk.symbol && query.symbols.includes(chunk.symbol)) {
      exactScore += 1.0;
    }
    if (query.paths.some((p) => chunk.path === p || chunk.path.endsWith(p))) {
      exactScore += 0.5;
    }
    if (exactScore > 0) {
      exactMatches.push({ item: { ...chunk, retrievalSource: "exact_symbol" }, score: exactScore });
    }
  }
  exactMatches.sort((a, b) => b.score - a.score);

  // 2. Graph Neighbor Resolution (callers, imports, dependencies)
  const neighborMatches: Array<{ item: CandidateChunk; score: number }> = [];
  const neighborSymbols = new Set<string>();
  for (const edge of edges) {
    if (query.symbols.includes(edge.sourceSymbol)) {
      neighborSymbols.add(edge.targetSymbol);
    }
    if (query.symbols.includes(edge.targetSymbol)) {
      neighborSymbols.add(edge.sourceSymbol);
    }
  }
  for (const chunk of allChunks) {
    if (chunk.symbol && neighborSymbols.has(chunk.symbol)) {
      neighborMatches.push({ item: { ...chunk, retrievalSource: "graph_neighbor" }, score: 0.8 });
    }
  }

  // 3. Lexical Ranking (BM25-style keyword matching)
  const lexicalMatches: Array<{ item: CandidateChunk; score: number }> = [];
  for (const chunk of allChunks) {
    const lexScore = computeLexicalScore(query.terms, chunk.content);
    if (lexScore > 0.1) {
      lexicalMatches.push({ item: { ...chunk, retrievalSource: "lexical" }, score: lexScore });
    }
  }
  lexicalMatches.sort((a, b) => b.score - a.score);

  // 4. Combine via Reciprocal Rank Fusion
  const fused = reciprocalRankFusion([exactMatches, neighborMatches, lexicalMatches]);
  return fused.slice(0, limit);
}

/**
 * Plan and format context for PR review or PR chat within strict token budget.
 */
export function planReviewContext(
  chunks: CandidateChunk[],
  options: ContextPlanOptions = {},
): RetrievedContextItem[] {
  const maxTokens = options.maxTokens ?? 8000;
  const commit = options.targetCommit ?? "HEAD";
  const items: RetrievedContextItem[] = [];

  let accumulatedEstimatedTokens = 0;

  for (const chunk of chunks) {
    // Approx 4 chars per token estimate
    const estimatedTokens = Math.ceil(chunk.content.length / 4);
    if (accumulatedEstimatedTokens + estimatedTokens > maxTokens && items.length > 0) {
      break;
    }

    const citation = `${chunk.path}@${commit}#L${chunk.startLine}-L${chunk.endLine}`;
    items.push({
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      symbol: chunk.symbol,
      content: chunk.content,
      source: chunk.retrievalSource ?? "hybrid",
      score: chunk.score ?? 1.0,
      citation,
    });

    accumulatedEstimatedTokens += estimatedTokens;
  }

  return items;
}
