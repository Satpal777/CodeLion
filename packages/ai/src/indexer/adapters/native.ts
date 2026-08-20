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

export class NativeAdapter implements LanguageAdapter {
  readonly id = "native-adapter";
  readonly version = "2026-08-20.1";
  readonly language: SupportedLanguage;

  constructor(language: "c" | "cpp" | "objectivec" = "cpp") {
    this.language = language;
  }

  detect(file: RepositoryFile): DetectionResult {
    const isTest = file.path.includes("test/") || file.path.includes("tests/") || file.path.endsWith("_test.cc");
    return {
      language: this.language,
      isGenerated: file.path.includes("generated/") || file.path.includes("build/"),
      isTest,
      confidence: 0.98,
    };
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const lines = input.source.replace(/\r\n/g, "\n").split("\n");
    return {
      path: input.path,
      language: input.language,
      source: input.source,
      lines,
      ast: { type: "TranslationUnit", startLine: 1, endLine: lines.length },
      isGenerated: input.path.includes("generated/"),
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
        const classMatch = /^(?:class|struct)\s+([A-Za-z0-9_]+)/.exec(line);
        const fnMatch = /^(?:[\w:*&<>]+\s+)+([A-Za-z0-9_]+)\s*\([^)]*\)\s*(?:const)?\s*\{?/.exec(line);
        if (classMatch?.[1]) {
          symbol = classMatch[1];
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

      const classMatch = /^(class|struct)\s+([A-Za-z0-9_]+)/.exec(line);
      if (classMatch?.[2]) {
        records.push({
          name: classMatch[2],
          kind: classMatch[1] === "struct" ? "struct" : "class",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: true,
        });
        continue;
      }

      const fnMatch = /^(?:static\s+)?(?:inline\s+)?(?:[\w:*&<>]+\s+)+([A-Za-z0-9_]+)\s*\([^)]*\)/.exec(line);
      if (fnMatch?.[1] && !["if", "for", "while", "switch"].includes(fnMatch[1])) {
        records.push({
          name: fnMatch[1],
          kind: "function",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: !line.startsWith("static "),
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
      const includeMatch = /^#include\s+["<]([^">]+)[">]/.exec(trimmed);
      if (includeMatch?.[1]) {
        const header = includeMatch[1];
        edges.push({
          sourceSymbol: document.path,
          targetSymbol: header.split("/").at(-1) ?? header,
          sourcePath: document.path,
          targetPath: header,
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
        p.endsWith("CMakeLists.txt") ||
        p.endsWith("Makefile") ||
        p.endsWith(".vcxproj") ||
        p.endsWith("meson.build"),
    );
    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests,
      frameworks: [],
    };
  }

  testLinks(document: ParsedDocument, project: ProjectContext): TestLink[] {
    const links: TestLink[] = [];
    if (!document.isTest) {
      const baseName = document.path.split("/").at(-1)?.replace(/\.(c|cpp|cc|cxx|h|hpp|m|mm)$/, "") ?? "";
      for (const root of project.rootFiles) {
        if (root.includes(`${baseName}_test`) || root.includes(`test_${baseName}`)) {
          links.push({ sourcePath: document.path, testPath: root, confidence: 0.95 });
        }
      }
    }
    return links;
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: this.language,
      idioms: ["RAII memory management", "std::unique_ptr / std::shared_ptr", "Bounds checking with .at()"],
      dangerousPatterns: [
        "strcpy(",
        "strcat(",
        "sprintf(",
        "gets(",
        "system(",
        "raw pointer delete without nulling",
        "buffer overflow on array access",
        "Use after free",
      ],
      securityChecks: ["Buffer overflows", "Format string vulnerabilities", "Use-after-free", "Double free"],
      concurrencyConsiderations: ["Data races without std::mutex/atomic", "Deadlocks on out-of-order lock acquisition"],
      resourceManagementRules: ["Prefer smart pointers over manual new/delete", "Close file descriptors / sockets"],
      testingFrameworks: ["GoogleTest", "Catch2", "doctest"],
      rules: [
        {
          id: "native-banned-functions",
          category: "security",
          severity: "critical",
          description: "Ban unsafe C string functions susceptible to buffer overflow",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/\b(strcpy|strcat|sprintf|gets)\s*\(/.test(line)) {
                findings.push({
                  title: "Unsafe C function prone to buffer overflow",
                  explanation: "Functions like strcpy, strcat, and sprintf do not perform bounds checking. Use strncpy, snprintf, or std::string.",
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
