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

export class ScriptingAdapter implements LanguageAdapter {
  readonly id = "scripting-adapter";
  readonly version = "2026-08-20.1";
  readonly language: SupportedLanguage;

  constructor(language: "shell" | "powershell" | "lua" | "perl" | "r" | "julia" = "shell") {
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
      ast: { type: "Script", startLine: 1, endLine: lines.length },
      isGenerated: false,
      isTest: input.path.includes("test"),
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
        const fnMatch = /^(?:function\s+)?([A-Za-z0-9_-]+)\s*\(\)/.exec(line);
        if (fnMatch?.[1]) {
          symbol = fnMatch[1];
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

      const fnMatch = /^(?:function\s+)?([A-Za-z0-9_.-]+)\s*\(\)\s*\{?/.exec(line);
      if (fnMatch?.[1] && !["if", "for", "while", "case"].includes(fnMatch[1])) {
        records.push({
          name: fnMatch[1],
          kind: "function",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: true,
        });
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
      idioms: ["set -euo pipefail in bash scripts", "Double quote variables in shell: \"$var\"", "ShellCheck best practices"],
      dangerousPatterns: [
        "eval \"$UNTRUSTED\"",
        "curl | sh / wget | bash without checksum",
        "rm -rf \"$VAR\" where $VAR could be empty/unset",
        "Unquoted variable expansions in shell commands",
      ],
      securityChecks: ["Command injection", "Unquoted expansions", "Unchecked command failures"],
      concurrencyConsiderations: ["Subshell concurrency and race conditions on temporary files (mktemp)"],
      resourceManagementRules: ["Use trap ... EXIT to clean up temp files"],
      testingFrameworks: ["bats-core", "Pester"],
      rules: [
        {
          id: "shell-rm-rf-unquoted",
          category: "security",
          severity: "critical",
          description: "Detect dangerous rm -rf on unquoted or potentially empty variables",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/rm\s+-[rfRF]+\s+\$[A-Za-z0-9_]+(?:\s|$)/.test(line)) {
                findings.push({
                  title: "Dangerous rm -rf on unquoted variable",
                  explanation: "Unquoted variable in rm -rf can expand to root or empty string if unset. Use \"${VAR:?}\".",
                  line: idx + 1,
                  evidence: line.trim(),
                });
              }
            });
            return findings;
          },
        },
      ],
    };
  }

  validateSuggestion(input: SuggestionInput): ValidationResult {
    return { valid: Boolean(input.suggestedPatch.trim()), errors: [] };
  }
}
