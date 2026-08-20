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

export class RubyAdapter implements LanguageAdapter {
  readonly id = "ruby-adapter";
  readonly version = "2026-08-20.1";
  readonly language = "ruby" as const;

  detect(file: RepositoryFile): DetectionResult {
    return {
      language: "ruby",
      isGenerated: file.path.includes("db/schema.rb"),
      isTest: file.path.includes("spec/") || file.path.includes("test/") || file.path.endsWith("_spec.rb"),
      confidence: 0.99,
    };
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const lines = input.source.replace(/\r\n/g, "\n").split("\n");
    return {
      path: input.path,
      language: "ruby",
      source: input.source,
      lines,
      ast: { type: "Program", startLine: 1, endLine: lines.length },
      isGenerated: input.path.includes("db/schema.rb"),
      isTest: input.path.includes("spec/") || input.path.includes("test/"),
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
        const defMatch = /^\s*def\s+(?:self\.)?([A-Za-z0-9_!?=]+)/.exec(line);
        const classMatch = /^\s*(?:class|module)\s+([A-Za-z0-9_:]+)/.exec(line);
        if (defMatch?.[1]) {
          symbol = defMatch[1];
          break;
        }
        if (classMatch?.[1]) {
          symbol = classMatch[1];
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
      const line = lines[i] ?? "";
      const trimmed = line.trim();
      const lineNum = i + 1;

      const defMatch = /^\s*def\s+(?:self\.)?([A-Za-z0-9_!?=]+)/.exec(trimmed);
      if (defMatch?.[1]) {
        records.push({
          name: defMatch[1],
          kind: "method",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: trimmed,
          isExported: true,
        });
        continue;
      }

      const classMatch = /^\s*(class|module)\s+([A-Za-z0-9_:]+)/.exec(trimmed);
      if (classMatch?.[2]) {
        records.push({
          name: classMatch[2],
          kind: classMatch[1] === "module" ? "module" : "class",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: trimmed,
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
      const requireMatch = /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/.exec(line.trim());
      if (requireMatch?.[1]) {
        const target = requireMatch[1];
        edges.push({
          sourceSymbol: document.path,
          targetSymbol: target.split("/").at(-1) ?? target,
          sourcePath: document.path,
          targetPath: target.endsWith(".rb") ? target : `${target}.rb`,
          kind: "imports",
        });
      }
    }
    return edges;
  }

  async projectContext(files: RepositoryFile[]): Promise<ProjectContext> {
    const paths = files.map((f) => f.path);
    const manifests = paths.filter((p) => p.endsWith("Gemfile") || p.endsWith("Gemfile.lock") || p.endsWith(".gemspec"));
    const frameworks: string[] = [];
    if (paths.some((p) => p.includes("config/routes.rb") || p.includes("app/controllers"))) frameworks.push("rails");
    if (paths.some((p) => p.includes("sinatra"))) frameworks.push("sinatra");

    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests,
      packageManager: "bundler",
      frameworks,
    };
  }

  testLinks(document: ParsedDocument, project: ProjectContext): TestLink[] {
    const links: TestLink[] = [];
    if (!document.isTest) {
      const fileName = document.path.split("/").at(-1)?.replace(".rb", "") ?? "";
      for (const root of project.rootFiles) {
        if (root === `${fileName}_spec.rb` || root === `${fileName}_test.rb`) {
          links.push({ sourcePath: document.path, testPath: root, confidence: 0.95 });
        }
      }
    }
    return links;
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: "ruby",
      idioms: ["Ruby idiomatic style", "Safe navigation operator (&.)", "Enumerable methods over loops"],
      dangerousPatterns: [
        "eval(",
        "send(user_input)",
        "Kernel.system(raw_string)",
        "`#{raw_string}`",
        "Marshal.load(raw_input)",
        "YAML.load without safe_load",
      ],
      securityChecks: ["Remote code execution via Marshal.load", "SQL injection in ActiveRecord where(string)"],
      concurrencyConsiderations: ["Thread safety in Puma / Sidekiq background jobs"],
      resourceManagementRules: ["Ensure file IO blocks close handles automatically"],
      testingFrameworks: ["RSpec", "Minitest"],
      rules: [
        {
          id: "ruby-no-marshal-load",
          category: "security",
          severity: "critical",
          description: "Detect unsafe Marshal.load",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/\bMarshal\.load\b/.test(line)) {
                findings.push({
                  title: "Insecure Marshal.load deserialization",
                  explanation: "Marshal.load can execute arbitrary code. Use JSON or safe YAML parsing.",
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
