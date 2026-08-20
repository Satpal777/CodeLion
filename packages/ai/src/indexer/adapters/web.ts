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

export class WebAdapter implements LanguageAdapter {
  readonly id = "web-adapter";
  readonly version = "2026-08-20.1";
  readonly language: SupportedLanguage;

  constructor(language: "html" | "css" = "html") {
    this.language = language;
  }

  detect(file: RepositoryFile): DetectionResult {
    return {
      language: this.language,
      isGenerated: file.path.includes("dist/") || file.path.includes("build/"),
      isTest: false,
      confidence: 0.99,
    };
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const lines = input.source.replace(/\r\n/g, "\n").split("\n");
    return {
      path: input.path,
      language: input.language,
      source: input.source,
      lines,
      ast: { type: "Document", startLine: 1, endLine: lines.length },
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
        const cssMatch = /^([.#]?[A-Za-z0-9_-]+)\s*\{/.exec(line);
        if (cssMatch?.[1]) {
          symbol = cssMatch[1];
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

      const cssMatch = /^([.#][A-Za-z0-9_-]+)\s*\{/.exec(line);
      if (cssMatch?.[1]) {
        records.push({
          name: cssMatch[1],
          kind: "class",
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
      idioms: ["Semantic HTML5 elements", "WCAG AA contrast and aria labels", "Responsive CSS / modern grid & flexbox"],
      dangerousPatterns: [
        "<script> tags with inline unescaped user input (XSS)",
        "Missing alt tags on <img>",
        "Links with target=\"_blank\" without rel=\"noopener noreferrer\"",
      ],
      securityChecks: ["Cross-site scripting (XSS) in HTML markup", "Tabnabbing via target=_blank"],
      concurrencyConsiderations: [],
      resourceManagementRules: ["Optimize CSS bundle size", "Avoid render-blocking stylesheet imports (@import in CSS)"],
      testingFrameworks: ["axe-core", "Pa11y"],
      rules: [
        {
          id: "web-target-blank-rel",
          category: "security",
          severity: "medium",
          description: "Require rel=\"noopener noreferrer\" on target=\"_blank\" links",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/target\s*=\s*["']_blank["']/i.test(line) && !/rel\s*=\s*["'][^"']*noopener/i.test(line)) {
                findings.push({
                  title: "Reverse tabnabbing vulnerability",
                  explanation: "Links opening in a new tab with target=\"_blank\" should specify rel=\"noopener noreferrer\" to prevent window.opener hijacking.",
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
