import { createHash } from "node:crypto";
import type {
  ChunkOptions,
  CodeChunk,
  DetectionResult,
  LanguageAdapter,
  LanguageReviewProfile,
  ParseInput,
  ParsedDocument,
  ProjectContext,
  RepositoryFile,
  ReviewRule,
  SuggestionInput,
  SymbolEdge,
  SymbolRecord,
  TestLink,
  ValidationResult,
} from "./base";
import type { SupportedLanguage } from "../languages";

export class LegacyAdapter implements LanguageAdapter {
  readonly id = "legacy-adapter";
  readonly version = "2026-08-20.1";
  readonly language: SupportedLanguage;

  constructor(language: "cobol" | "fortran" = "cobol") {
    this.language = language;
  }

  detect(file: RepositoryFile): DetectionResult {
    return {
      language: this.language,
      isGenerated: false,
      isTest: file.path.includes("test"),
      confidence: 0.95,
    };
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const lines = input.source.replace(/\r\n/g, "\n").split("\n");
    return {
      path: input.path,
      language: input.language,
      source: input.source,
      lines,
      ast: { type: "Program", startLine: 1, endLine: lines.length },
      isGenerated: false,
      isTest: false,
      syntaxValid: true,
      parseErrors: [],
    };
  }

  chunk(document: ParsedDocument): CodeChunk[] {
    const lines = document.lines;
    const chunks: CodeChunk[] = [];
    const maxLines = 100;
    const overlap = 15;

    for (let start = 0; start < lines.length; start += maxLines - overlap) {
      const end = Math.min(lines.length, start + maxLines);
      const content = lines.slice(start, end).join("\n");
      if (content.trim().length === 0) continue;

      let symbol: string | null = null;
      for (let i = start; i >= Math.max(0, start - 30); i -= 1) {
        const line = lines[i]?.trim() ?? "";
        const pgmMatch = /PROGRAM-ID\.\s+([A-Za-z0-9_-]+)/i.exec(line);
        const subMatch = /SUBROUTINE\s+([A-Za-z0-9_]+)/i.exec(line);
        if (pgmMatch?.[1]) {
          symbol = pgmMatch[1];
          break;
        }
        if (subMatch?.[1]) {
          symbol = subMatch[1];
          break;
        }
      }

      chunks.push({
        path: document.path,
        language: document.language,
        symbol,
        startLine: start + 1,
        endLine: end,
        content,
        contentHash: createHash("sha256")
          .update(`${document.path}:${start + 1}:${content}`)
          .digest("hex"),
      });
      if (end === lines.length) break;
    }
    return chunks;
  }

  symbols(document: ParsedDocument): SymbolRecord[] {
    const records: SymbolRecord[] = [];
    const lines = document.lines;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]?.trim() ?? "";
      const lineNum = i + 1;

      const pgmMatch = /PROGRAM-ID\.\s+([A-Za-z0-9_-]+)/i.exec(line);
      if (pgmMatch?.[1]) {
        records.push({
          name: pgmMatch[1],
          kind: "module",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: true,
        });
        continue;
      }

      const subMatch = /(?:SUBROUTINE|FUNCTION)\s+([A-Za-z0-9_]+)/i.exec(line);
      if (subMatch?.[1]) {
        records.push({
          name: subMatch[1],
          kind: "function",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: true,
        });
        continue;
      }
    }
    return records;
  }

  edges(_document: ParsedDocument, _project: ProjectContext): SymbolEdge[] {
    return [];
  }

  async projectContext(files: RepositoryFile[]): Promise<ProjectContext> {
    return {
      rootFiles: files.map((f) => f.path).filter((p) => !p.includes("/")),
      manifests: [],
      frameworks: [],
    };
  }

  testLinks(_document: ParsedDocument, _project: ProjectContext): TestLink[] {
    return [];
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: this.language,
      idioms: ["Legacy application maintenance standards", "Numeric precision and truncation checks in fixed-point math"],
      dangerousPatterns: [
        "ALTER statement in COBOL (self-modifying code)",
        "GOTO jumping outside section boundaries",
        "Implicit variable typing in Fortran without IMPLICIT NONE",
      ],
      securityChecks: ["Data buffer overflows in copybooks", "Fixed field length truncations"],
      concurrencyConsiderations: ["Mainframe batch job concurrency / file locking"],
      resourceManagementRules: ["Properly close sequential datasets"],
      testingFrameworks: [],
      rules: [],
    };
  }

  validateSuggestion(input: SuggestionInput): ValidationResult {
    return { valid: Boolean(input.suggestedPatch.trim()), errors: [] };
  }
}
