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

export class SwiftAdapter implements LanguageAdapter {
  readonly id = "swift-adapter";
  readonly version = "2026-08-20.1";
  readonly language = "swift" as const;

  detect(file: RepositoryFile): DetectionResult {
    return {
      language: "swift",
      isGenerated: file.path.includes("DerivedData/") || file.path.includes(".build/"),
      isTest: file.path.includes("Tests/") || file.path.endsWith("Tests.swift"),
      confidence: 0.99,
    };
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const lines = input.source.replace(/\r\n/g, "\n").split("\n");
    return {
      path: input.path,
      language: "swift",
      source: input.source,
      lines,
      ast: { type: "SourceFile", startLine: 1, endLine: lines.length },
      isGenerated: input.path.includes("DerivedData/"),
      isTest: input.path.includes("Tests"),
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
        const typeMatch = /(?:class|struct|protocol|enum|actor)\s+([A-Za-z0-9_]+)/.exec(line);
        const fnMatch = /func\s+([A-Za-z0-9_]+)/.exec(line);
        if (typeMatch?.[1]) {
          symbol = typeMatch[1];
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

      const typeMatch = /(public|internal|private|fileprivate|open)?\s*(class|struct|protocol|enum|actor)\s+([A-Za-z0-9_]+)/.exec(
        line,
      );
      if (typeMatch?.[3]) {
        records.push({
          name: typeMatch[3],
          kind: typeMatch[2] === "protocol" ? "interface" : typeMatch[2] === "enum" ? "enum" : "class",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: typeMatch[1] === "public" || typeMatch[1] === "open",
        });
        continue;
      }

      const fnMatch = /(public|internal|private|fileprivate|open)?\s*(?:static\s+)?func\s+([A-Za-z0-9_]+)\s*\([^)]*\)/.exec(
        line,
      );
      if (fnMatch?.[2]) {
        records.push({
          name: fnMatch[2],
          kind: "method",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: fnMatch[1] === "public" || fnMatch[1] === "open",
        });
        continue;
      }
    }
    return records;
  }

  edges(document: ParsedDocument, _project: ProjectContext): SymbolEdge[] {
    const edges: SymbolEdge[] = [];
    for (const line of document.lines) {
      const importMatch = /^import\s+([A-Za-z0-9_]+)/.exec(line.trim());
      if (importMatch?.[1]) {
        const mod = importMatch[1];
        edges.push({
          sourceSymbol: document.path,
          targetSymbol: mod,
          sourcePath: document.path,
          kind: "imports",
        });
      }
    }
    return edges;
  }

  async projectContext(files: RepositoryFile[]): Promise<ProjectContext> {
    const paths = files.map((f) => f.path);
    const manifests = paths.filter((p) => p.endsWith("Package.swift") || p.endsWith(".xcodeproj"));
    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests,
      packageManager: "swiftpm",
      frameworks: paths.some((p) => p.includes("SwiftUI")) ? ["SwiftUI"] : ["UIKit"],
    };
  }

  testLinks(document: ParsedDocument, project: ProjectContext): TestLink[] {
    const links: TestLink[] = [];
    if (!document.isTest) {
      const baseName = document.path.split("/").at(-1)?.replace(".swift", "") ?? "";
      for (const root of project.rootFiles) {
        if (root.includes(`${baseName}Tests`)) {
          links.push({ sourcePath: document.path, testPath: root, confidence: 0.95 });
        }
      }
    }
    return links;
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: "swift",
      idioms: ["Swift Concurrency (async/await, actors)", "guard let / if let optional binding", "Value types over reference types"],
      dangerousPatterns: [
        "Force unwrapping with '!' in production code",
        "Retain cycles in escaping closures ([weak self] omitted)",
        "UnsafePointer / withUnsafeBytes without bounds checks",
      ],
      securityChecks: ["Keychain data protection", "ATS network security", "Memory leaks via strong reference cycles"],
      concurrencyConsiderations: ["Sendable protocol conformance", "Data isolation with Swift actors"],
      resourceManagementRules: ["ARC reference management", "Break retain cycles with [weak self]"],
      testingFrameworks: ["XCTest", "Swift Testing"],
      rules: [
        {
          id: "swift-no-force-unwrap",
          category: "reliability",
          severity: "medium",
          description: "Discourage force unwrapping (!) in production code",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            if (!doc.isTest) {
              doc.lines.forEach((line, idx) => {
                if (/\b\w+!\b/.test(line) && !line.includes("IBOutlet") && !line.includes("//")) {
                  findings.push({
                    title: "Force unwrapping risk",
                    explanation: "Force unwrapping optionals with ! will crash if the value is nil. Use guard let or ?? default.",
                    line: idx + 1,
                    evidence: line.trim(),
                  });
                }
              });
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
