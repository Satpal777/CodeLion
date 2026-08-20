import { createHash } from "node:crypto";
import type {
  CodeChunk,
  DetectionResult,
  LanguageAdapter,
  LanguageReviewProfile,
  ParseInput,
  ParsedDocument,
  ProjectContext,
  RepositoryFile,
  SuggestionInput,
  SymbolEdge,
  SymbolRecord,
  TestLink,
  ValidationResult,
} from "./base";

export class DartAdapter implements LanguageAdapter {
  readonly id = "dart-adapter";
  readonly version = "2026-08-20.1";
  readonly language = "dart" as const;

  detect(file: RepositoryFile): DetectionResult {
    return {
      language: "dart",
      isGenerated: file.path.endsWith(".g.dart") || file.path.endsWith(".freezed.dart"),
      isTest: file.path.includes("test/") || file.path.endsWith("_test.dart"),
      confidence: 0.99,
    };
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const lines = input.source.replace(/\r\n/g, "\n").split("\n");
    return {
      path: input.path,
      language: "dart",
      source: input.source,
      lines,
      ast: { type: "CompilationUnit", startLine: 1, endLine: lines.length },
      isGenerated: input.path.endsWith(".g.dart"),
      isTest: input.path.includes("test/"),
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
        const classMatch = /(?:class|mixin|enum|extension)\s+([A-Za-z0-9_]+)/.exec(line);
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
      const line = lines[i]?.trim() ?? "";
      const lineNum = i + 1;

      const classMatch = /(?:abstract\s+)?(class|mixin|enum|extension)\s+([A-Za-z0-9_]+)/.exec(line);
      if (classMatch?.[2]) {
        records.push({
          name: classMatch[2],
          kind: classMatch[1] === "enum" ? "enum" : "class",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: !classMatch[2].startsWith("_"),
        });
        continue;
      }
    }
    return records;
  }

  edges(document: ParsedDocument, _project: ProjectContext): SymbolEdge[] {
    const edges: SymbolEdge[] = [];
    for (const line of document.lines) {
      const importMatch = /^import\s+['"]([^'"]+)['"]/.exec(line.trim());
      if (importMatch?.[1]) {
        const target = importMatch[1];
        edges.push({
          sourceSymbol: document.path,
          targetSymbol: target.split("/").at(-1) ?? target,
          sourcePath: document.path,
          targetPath: target,
          kind: "imports",
        });
      }
    }
    return edges;
  }

  async projectContext(files: RepositoryFile[]): Promise<ProjectContext> {
    const paths = files.map((f) => f.path);
    const manifests = paths.filter((p) => p.endsWith("pubspec.yaml") || p.endsWith("pubspec.lock"));
    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests,
      packageManager: "pub",
      frameworks: paths.some((p) => p.includes("flutter")) ? ["flutter"] : [],
    };
  }

  testLinks(document: ParsedDocument, project: ProjectContext): TestLink[] {
    const links: TestLink[] = [];
    if (!document.isTest) {
      const baseName = document.path.split("/").at(-1)?.replace(".dart", "") ?? "";
      for (const root of project.rootFiles) {
        if (root.includes(`${baseName}_test.dart`)) {
          links.push({ sourcePath: document.path, testPath: root, confidence: 0.95 });
        }
      }
    }
    return links;
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: "dart",
      idioms: ["Sound null safety", "Flutter widget lifecycles", "Stream / Future cancellation"],
      dangerousPatterns: [
        "Uncontrolled setState in build method",
        "Unclosed StreamSubscription in State.dispose",
        "Process.run with unvalidated arguments",
      ],
      securityChecks: ["Secure storage usage", "Certificate pinning in HttpClient"],
      concurrencyConsiderations: ["Isolates for heavy computation", "Microtask queue starvation"],
      resourceManagementRules: ["Always cancel StreamSubscriptions in dispose()", "Dispose TextEditingController"],
      testingFrameworks: ["flutter_test", "test"],
      rules: [],
    };
  }

  validateSuggestion(input: SuggestionInput): ValidationResult {
    return { valid: Boolean(input.suggestedPatch.trim()), errors: [] };
  }
}
