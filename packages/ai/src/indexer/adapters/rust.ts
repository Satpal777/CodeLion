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

export class RustAdapter implements LanguageAdapter {
  readonly id = "rust-adapter";
  readonly version = "2026-08-20.1";
  readonly language = "rust" as const;

  detect(file: RepositoryFile): DetectionResult {
    return {
      language: "rust",
      isGenerated: file.path.includes("target/") || (file.content?.includes("@generated") ?? false),
      isTest: file.path.includes("tests/") || file.path.endsWith("_test.rs"),
      confidence: 0.99,
    };
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const lines = input.source.replace(/\r\n/g, "\n").split("\n");
    return {
      path: input.path,
      language: "rust",
      source: input.source,
      lines,
      ast: { type: "Crate", startLine: 1, endLine: lines.length },
      isGenerated: input.path.includes("target/"),
      isTest: input.path.includes("tests/") || input.source.includes("#[test]"),
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
        const fnMatch = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/.exec(line);
        const structMatch = /^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z0-9_]+)/.exec(line);
        const implMatch = /^impl(?:<[^>]+>)?\s+([A-Za-z0-9_]+)/.exec(line);
        if (fnMatch?.[1]) {
          symbol = fnMatch[1];
          break;
        }
        if (structMatch?.[1]) {
          symbol = structMatch[1];
          break;
        }
        if (implMatch?.[1]) {
          symbol = implMatch[1];
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

      const fnMatch = /^(pub(?:\([^)]*\))?\s+)?(async\s+)?fn\s+([A-Za-z0-9_]+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/.exec(
        line,
      );
      if (fnMatch?.[3]) {
        records.push({
          name: fnMatch[3],
          kind: "function",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: Boolean(fnMatch[1]),
        });
        continue;
      }

      const typeMatch = /^(pub(?:\([^)]*\))?\s+)?(struct|enum|trait)\s+([A-Za-z0-9_]+)/.exec(line);
      if (typeMatch?.[3]) {
        records.push({
          name: typeMatch[3],
          kind: typeMatch[2] === "trait" ? "trait" : typeMatch[2] === "enum" ? "enum" : "struct",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: Boolean(typeMatch[1]),
        });
        continue;
      }
    }
    return records;
  }

  edges(document: ParsedDocument, _project: ProjectContext): SymbolEdge[] {
    const edges: SymbolEdge[] = [];
    for (const line of document.lines) {
      const trimmed = line.trim();
      const useMatch = /^use\s+([A-Za-z0-9_:]+)(?:::\{([^}]+)\})?;/.exec(trimmed);
      if (useMatch?.[1]) {
        const base = useMatch[1];
        if (useMatch[2]) {
          const items = useMatch[2].split(",").map((s) => s.trim());
          for (const item of items) {
            edges.push({
              sourceSymbol: document.path,
              targetSymbol: item,
              sourcePath: document.path,
              targetPath: `${base}::${item}`,
              kind: "imports",
            });
          }
        } else {
          edges.push({
            sourceSymbol: document.path,
            targetSymbol: base.split("::").at(-1) ?? base,
            sourcePath: document.path,
            targetPath: base,
            kind: "imports",
          });
        }
      }
    }
    return edges;
  }

  async projectContext(files: RepositoryFile[]): Promise<ProjectContext> {
    const paths = files.map((f) => f.path);
    const manifests = paths.filter((p) => p.endsWith("Cargo.toml") || p.endsWith("Cargo.lock"));
    const frameworks: string[] = [];
    if (paths.some((p) => p.includes("tokio"))) frameworks.push("tokio");
    if (paths.some((p) => p.includes("actix"))) frameworks.push("actix");
    if (paths.some((p) => p.includes("axum"))) frameworks.push("axum");

    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests,
      packageManager: "cargo",
      frameworks,
    };
  }

  testLinks(document: ParsedDocument, project: ProjectContext): TestLink[] {
    const links: TestLink[] = [];
    if (!document.isTest) {
      for (const root of project.rootFiles) {
        if (root.startsWith("tests/") && root.endsWith(".rs")) {
          links.push({ sourcePath: document.path, testPath: root, confidence: 0.9 });
        }
      }
    }
    return links;
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: "rust",
      idioms: ["Borrow checker idioms", "Result/Option combinators (?, map, and_then)", "Arc/Mutex for shared state"],
      dangerousPatterns: [
        "unsafe { ... } without safety documentation comment",
        ".unwrap() in production library code (use ? or expect with context)",
        "mem::forget or std::mem::transmute without strict size/alignment checks",
        "Panic in Drop implementation",
      ],
      securityChecks: ["Unsafe block memory safety invariants", "Undefined behavior in FFI bindings"],
      concurrencyConsiderations: ["Deadlocks with nested Mutex locks", "Async task cancellation safety"],
      resourceManagementRules: ["RAII Drop guarantees", "Properly flush BufWriter before dropping"],
      testingFrameworks: ["cargo test", "proptest", "criterion"],
      rules: [
        {
          id: "rust-no-uncommented-unsafe",
          category: "security",
          severity: "high",
          description: "Require // SAFETY: comments above unsafe blocks",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            for (let i = 0; i < doc.lines.length; i += 1) {
              const line = doc.lines[i]?.trim() ?? "";
              if (/^unsafe\s*\{/.test(line)) {
                const prevLine = doc.lines[i - 1]?.trim() ?? "";
                if (!prevLine.startsWith("// SAFETY:") && !prevLine.startsWith("/// SAFETY:")) {
                  findings.push({
                    title: "Missing SAFETY comment on unsafe block",
                    explanation: "Rust unsafe blocks must include a // SAFETY: comment explaining the invariants that guarantee memory safety.",
                    line: i + 1,
                    evidence: line,
                  });
                }
              }
            }
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
