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

export class FunctionalAdapter implements LanguageAdapter {
  readonly id = "functional-adapter";
  readonly version = "2026-08-20.1";
  readonly language: SupportedLanguage;

  constructor(language: "haskell" | "ocaml" = "haskell") {
    this.language = language;
  }

  detect(file: RepositoryFile): DetectionResult {
    return {
      language: this.language,
      isGenerated: file.path.includes("_build/") || file.path.includes(".stack-work/"),
      isTest: file.path.includes("test/") || file.path.endsWith("Spec.hs"),
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
      ast: { type: "Module", startLine: 1, endLine: lines.length },
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
        const typeMatch = /^(?:data|type|newtype)\s+([A-Za-z0-9_]+)/.exec(line);
        const letMatch = /^let\s+([A-Za-z0-9_]+)/.exec(line);
        if (typeMatch?.[1]) {
          symbol = typeMatch[1];
          break;
        }
        if (letMatch?.[1]) {
          symbol = letMatch[1];
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

      const typeMatch = /^(data|type|newtype)\s+([A-Za-z0-9_]+)/.exec(line);
      if (typeMatch?.[2]) {
        records.push({
          name: typeMatch[2],
          kind: "type",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: true,
        });
        continue;
      }

      const sigMatch = /^([a-z][A-Za-z0-9_']*)\s*::/.exec(line);
      if (sigMatch?.[1]) {
        records.push({
          name: sigMatch[1],
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

  edges(document: ParsedDocument, _project: ProjectContext): SymbolEdge[] {
    const edges: SymbolEdge[] = [];
    for (const line of document.lines) {
      const importMatch = /^import\s+(?:qualified\s+)?([A-Za-z0-9_.]+)/.exec(line.trim());
      if (importMatch?.[1]) {
        const mod = importMatch[1];
        edges.push({
          sourceSymbol: document.path,
          targetSymbol: mod.split(".").at(-1) ?? mod,
          sourcePath: document.path,
          kind: "imports",
        });
      }
    }
    return edges;
  }

  async projectContext(files: RepositoryFile[]): Promise<ProjectContext> {
    const paths = files.map((f) => f.path);
    const manifests = paths.filter(
      (p) =>
        p.endsWith("package.yaml") ||
        p.endsWith(".cabal") ||
        p.endsWith("stack.yaml") ||
        p.endsWith("dune-project"),
    );
    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests,
      frameworks: [],
    };
  }

  testLinks(_document: ParsedDocument, _project: ProjectContext): TestLink[] {
    return [];
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: this.language,
      idioms: ["Purity and total functions", "Explicit Monad transformers", "Avoid partial functions (head, fromJust)"],
      dangerousPatterns: [
        "unsafePerformIO",
        "head [] (partial function crash)",
        "fromJust on Nothing",
        "Obj.magic in OCaml (type safety escape)",
      ],
      securityChecks: ["unsafePerformIO concurrency race conditions", "Type system subversion via Obj.magic"],
      concurrencyConsiderations: ["STM (Software Transactional Memory) transaction purity", "Deadlock avoidance with MVar"],
      resourceManagementRules: ["Bracket patterns for resource acquisition and release"],
      testingFrameworks: ["Hspec", "QuickCheck", "OUnit", "Alcotest"],
      rules: [
        {
          id: "hs-no-unsafe-perform-io",
          category: "security",
          severity: "high",
          description: "Detect unsafePerformIO usage",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/\bunsafePerformIO\b/.test(line)) {
                findings.push({
                  title: "unsafePerformIO detected",
                  explanation: "unsafePerformIO breaks referential transparency and can cause non-deterministic behavior and memory corruption.",
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
