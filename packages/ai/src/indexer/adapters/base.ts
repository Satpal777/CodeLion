import type { SupportedLanguage } from "../languages";

export interface RepositoryFile {
  path: string;
  blobSha?: string;
  byteSize?: number;
  content?: string;
}

export interface DetectionResult {
  language: SupportedLanguage;
  dialect?: string;
  isGenerated: boolean;
  isTest: boolean;
  confidence: number;
}

export interface ParseInput {
  path: string;
  source: string;
  language: SupportedLanguage;
}

export interface ASTNode {
  type: string;
  name?: string;
  startLine: number;
  endLine: number;
  children?: ASTNode[];
  metadata?: Record<string, unknown>;
}

export interface ParsedDocument {
  path: string;
  language: SupportedLanguage;
  source: string;
  lines: string[];
  ast: ASTNode;
  isGenerated: boolean;
  isTest: boolean;
  syntaxValid: boolean;
  parseErrors: string[];
}

export interface ChunkOptions {
  maxLines?: number;
  overlapLines?: number;
}

export interface CodeChunk {
  path: string;
  language: SupportedLanguage;
  symbol: string | null;
  startLine: number;
  endLine: number;
  content: string;
  contentHash: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface SymbolRecord {
  name: string;
  kind:
    | "function"
    | "method"
    | "class"
    | "interface"
    | "struct"
    | "enum"
    | "trait"
    | "module"
    | "type"
    | "variable"
    | "constant"
    | "route"
    | "table"
    | "query";
  path: string;
  startLine: number;
  endLine: number;
  signature?: string;
  docstring?: string;
  isExported: boolean;
}

export interface SymbolEdge {
  sourceSymbol: string;
  targetSymbol: string;
  sourcePath: string;
  targetPath?: string | undefined;
  kind: "calls" | "imports" | "implements" | "extends" | "references" | "tests" | "migrates";
}

export interface ProjectContext {
  rootFiles: string[];
  manifests: string[];
  packageManager?: string;
  frameworks: string[];
  moduleGraph?: Record<string, string[]>;
}

export interface TestLink {
  sourcePath: string;
  testPath: string;
  targetSymbol?: string;
  confidence: number;
}

export interface ReviewRuleFinding {
  title: string;
  explanation: string;
  line: number;
  evidence: string;
  suggestedPatch?: string;
}

export interface ReviewRule {
  id: string;
  category:
    | "correctness"
    | "security"
    | "authorization"
    | "reliability"
    | "performance"
    | "compatibility"
    | "data_migration"
    | "testing"
    | "maintainability";
  severity: "critical" | "high" | "medium" | "low" | "nit";
  description: string;
  check: (doc: ParsedDocument, symbols: SymbolRecord[], edges: SymbolEdge[]) => ReviewRuleFinding[];
}

export interface LanguageReviewProfile {
  language: SupportedLanguage;
  idioms: string[];
  dangerousPatterns: string[];
  securityChecks: string[];
  concurrencyConsiderations: string[];
  resourceManagementRules: string[];
  testingFrameworks: string[];
  rules: ReviewRule[];
}

export interface SuggestionInput {
  path: string;
  language: SupportedLanguage;
  originalContent: string;
  suggestedPatch: string;
  startLine: number;
  endLine: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  formattedSuggestion?: string;
}

export interface LanguageAdapter {
  id: string;
  version: string;
  language: SupportedLanguage;
  detect(file: RepositoryFile): DetectionResult;
  parse(input: ParseInput): Promise<ParsedDocument>;
  chunk(document: ParsedDocument, options?: ChunkOptions): CodeChunk[];
  symbols(document: ParsedDocument): SymbolRecord[];
  edges(document: ParsedDocument, project: ProjectContext): SymbolEdge[];
  projectContext(files: RepositoryFile[]): Promise<ProjectContext>;
  testLinks(document: ParsedDocument, project: ProjectContext): TestLink[];
  reviewProfile(): LanguageReviewProfile;
  validateSuggestion(input: SuggestionInput): ValidationResult;
}
