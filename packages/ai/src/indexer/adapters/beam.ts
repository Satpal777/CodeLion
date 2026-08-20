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

export class BEAMAdapter implements LanguageAdapter {
  readonly id = "beam-adapter";
  readonly version = "2026-08-20.1";
  readonly language: SupportedLanguage;

  constructor(language: "elixir" | "erlang" = "elixir") {
    this.language = language;
  }

  detect(file: RepositoryFile): DetectionResult {
    return {
      language: this.language,
      isGenerated: file.path.includes("_build/") || file.path.includes("deps/"),
      isTest: file.path.includes("test/") || file.path.endsWith("_test.exs"),
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
      isGenerated: input.path.includes("_build/"),
      isTest: input.path.includes("_test.exs") || input.path.includes("test/"),
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
        const modMatch = /defmodule\s+([A-Za-z0-9_.]+)/.exec(line);
        const fnMatch = /defp?\s+([A-Za-z0-9_!?]+)/.exec(line);
        if (modMatch?.[1]) {
          symbol = modMatch[1];
          break;
        }
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

      const modMatch = /defmodule\s+([A-Za-z0-9_.]+)\s+do/.exec(line);
      if (modMatch?.[1]) {
        records.push({
          name: modMatch[1],
          kind: "module",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: true,
        });
        continue;
      }

      const fnMatch = /(def|defp)\s+([A-Za-z0-9_!?]+)\s*(\([^)]*\))?/.exec(line);
      if (fnMatch?.[2]) {
        records.push({
          name: fnMatch[2],
          kind: "function",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: fnMatch[1] === "def",
        });
        continue;
      }
    }
    return records;
  }

  edges(document: ParsedDocument, _project: ProjectContext): SymbolEdge[] {
    const edges: SymbolEdge[] = [];
    for (const line of document.lines) {
      const aliasMatch = /(?:alias|import|use)\s+([A-Za-z0-9_.]+)/.exec(line.trim());
      if (aliasMatch?.[1]) {
        const mod = aliasMatch[1];
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
    const manifests = paths.filter((p) => p.endsWith("mix.exs") || p.endsWith("mix.lock") || p.endsWith("rebar.config"));
    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests,
      packageManager: "mix",
      frameworks: paths.some((p) => p.includes("phoenix")) ? ["phoenix"] : [],
    };
  }

  testLinks(document: ParsedDocument, project: ProjectContext): TestLink[] {
    const links: TestLink[] = [];
    if (!document.isTest) {
      const baseName = document.path.split("/").at(-1)?.replace(/\.(ex|exs|erl)$/, "") ?? "";
      for (const root of project.rootFiles) {
        if (root.includes(`${baseName}_test.exs`)) {
          links.push({ sourcePath: document.path, testPath: root, confidence: 0.95 });
        }
      }
    }
    return links;
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: this.language,
      idioms: ["Pattern matching in function heads", "GenServer lifecycle safety", "Supervision trees"],
      dangerousPatterns: [
        ":erlang.binary_to_term(untrusted) without [:safe]",
        "System.cmd with unvalidated input",
        "Unbounded GenServer state accumulation / memory leak",
      ],
      securityChecks: ["Remote code execution via binary_to_term", "SQL injection in Ecto.Adapters.SQL.query"],
      concurrencyConsiderations: ["Process mailbox overflow", "GenServer call timeouts and deadlocks"],
      resourceManagementRules: ["Properly link and monitor spawned processes"],
      testingFrameworks: ["ExUnit", "EUnit", "Common Test"],
      rules: [
        {
          id: "beam-unsafe-binary-to-term",
          category: "security",
          severity: "critical",
          description: "Detect :erlang.binary_to_term without [:safe]",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/:erlang\.binary_to_term\s*\(/.test(line) && !line.includes("[:safe]")) {
                findings.push({
                  title: "Insecure binary_to_term call",
                  explanation: ":erlang.binary_to_term can allocate arbitrary atoms and execute code. Always pass [:safe].",
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
