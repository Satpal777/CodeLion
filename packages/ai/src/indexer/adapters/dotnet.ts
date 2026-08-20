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

export class DotNetAdapter implements LanguageAdapter {
  readonly id = "dotnet-adapter";
  readonly version = "2026-08-20.1";
  readonly language: SupportedLanguage;

  constructor(language: "csharp" | "fsharp" = "csharp") {
    this.language = language;
  }

  detect(file: RepositoryFile): DetectionResult {
    return {
      language: this.language,
      isGenerated: file.path.includes(".Designer.cs") || file.path.includes("obj/") || file.path.includes("bin/"),
      isTest: file.path.includes("Test") || file.path.includes("Spec"),
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
      ast: { type: "CompilationUnit", startLine: 1, endLine: lines.length },
      isGenerated: input.path.includes("obj/") || input.path.includes(".Designer.cs"),
      isTest: input.path.includes("Test"),
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
        const classMatch = /(?:public|internal|private)?\s*(?:class|struct|record|interface|enum)\s+([A-Za-z0-9_]+)/.exec(
          line,
        );
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

      const typeMatch = /(public|internal|protected|private)?\s*(abstract|static|sealed)?\s*(class|struct|record|interface|enum)\s+([A-Za-z0-9_]+)/.exec(
        line,
      );
      if (typeMatch?.[4]) {
        records.push({
          name: typeMatch[4],
          kind: typeMatch[3] === "interface" ? "interface" : typeMatch[3] === "enum" ? "enum" : "class",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: typeMatch[1] === "public",
        });
        continue;
      }

      const methodMatch = /(public|internal|protected|private)\s+(async\s+)?(static\s+)?(?:[\w<>[\],?]+\s+)+([A-Za-z0-9_]+)\s*\([^)]*\)/.exec(
        line,
      );
      if (methodMatch?.[4]) {
        records.push({
          name: methodMatch[4],
          kind: "method",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: methodMatch[1] === "public",
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
      const usingMatch = /^using\s+(?:static\s+)?([A-Za-z0-9_.]+);/.exec(trimmed);
      if (usingMatch?.[1]) {
        const ns = usingMatch[1];
        edges.push({
          sourceSymbol: document.path,
          targetSymbol: ns.split(".").at(-1) ?? ns,
          sourcePath: document.path,
          targetPath: ns,
          kind: "imports",
        });
      }
    }
    return edges;
  }

  async projectContext(files: RepositoryFile[]): Promise<ProjectContext> {
    const paths = files.map((f) => f.path);
    const manifests = paths.filter((p) => p.endsWith(".csproj") || p.endsWith(".fsproj") || p.endsWith(".sln"));
    const frameworks: string[] = [];
    if (paths.some((p) => p.includes("Microsoft.AspNetCore"))) frameworks.push("aspnetcore");
    if (paths.some((p) => p.includes("Microsoft.EntityFrameworkCore"))) frameworks.push("efcore");

    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests,
      packageManager: "nuget / dotnet",
      frameworks,
    };
  }

  testLinks(document: ParsedDocument, project: ProjectContext): TestLink[] {
    const links: TestLink[] = [];
    if (!document.isTest) {
      const baseName = document.path.split("/").at(-1)?.replace(/\.(cs|fs)$/, "") ?? "";
      for (const root of project.rootFiles) {
        if (root.includes(`${baseName}Tests`) || root.includes(`${baseName}Specs`)) {
          links.push({ sourcePath: document.path, testPath: root, confidence: 0.95 });
        }
      }
    }
    return links;
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: this.language,
      idioms: ["Nullable reference types (C# 8+)", "async/await best practices", "IDisposable / using declarations"],
      dangerousPatterns: [
        "Process.Start(rawUserInput)",
        "SqlCommand without SqlParameter (SQL injection)",
        "BinaryFormatter.Deserialize (insecure deserialization)",
        ".Result or .Wait() on Task (deadlock hazard)",
      ],
      securityChecks: ["SQL Injection", "Command Injection", "Insecure XML external entity (XXE) parsing"],
      concurrencyConsiderations: ["Sync-over-async causing threadpool starvation", "CancellationToken propagation"],
      resourceManagementRules: ["Always use 'using' statement or declaration with IDisposable objects", "Dispose HttpClient properly via IHttpClientFactory"],
      testingFrameworks: ["xUnit", "NUnit", "MSTest"],
      rules: [
        {
          id: "dotnet-no-binary-formatter",
          category: "security",
          severity: "critical",
          description: "Detect dangerous BinaryFormatter deserialization",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/BinaryFormatter\s*\.\s*Deserialize\b/.test(line)) {
                findings.push({
                  title: "Insecure BinaryFormatter deserialization",
                  explanation: "BinaryFormatter is insecure and cannot be made secure. Use System.Text.Json.",
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
