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

export class PHPAdapter implements LanguageAdapter {
  readonly id = "php-adapter";
  readonly version = "2026-08-20.1";
  readonly language = "php" as const;

  detect(file: RepositoryFile): DetectionResult {
    return {
      language: "php",
      isGenerated: file.path.includes("vendor/") || file.path.includes("cache/"),
      isTest: file.path.includes("tests/") || file.path.endsWith("Test.php"),
      confidence: 0.99,
    };
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const lines = input.source.replace(/\r\n/g, "\n").split("\n");
    return {
      path: input.path,
      language: "php",
      source: input.source,
      lines,
      ast: { type: "Program", startLine: 1, endLine: lines.length },
      isGenerated: input.path.includes("vendor/"),
      isTest: input.path.includes("Test.php"),
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
        const classMatch = /(?:class|interface|trait|enum)\s+([A-Za-z0-9_]+)/.exec(line);
        const fnMatch = /function\s+([A-Za-z0-9_]+)/.exec(line);
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

      const classMatch = /(?:abstract\s+|final\s+)?(class|interface|trait|enum)\s+([A-Za-z0-9_]+)/.exec(line);
      if (classMatch?.[2]) {
        records.push({
          name: classMatch[2],
          kind: classMatch[1] === "interface" ? "interface" : classMatch[1] === "enum" ? "enum" : "class",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: true,
        });
        continue;
      }

      const fnMatch = /(?:public|protected|private)?\s*(?:static\s+)?function\s+([A-Za-z0-9_]+)\s*\([^)]*\)/.exec(
        line,
      );
      if (fnMatch?.[1]) {
        records.push({
          name: fnMatch[1],
          kind: "method",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: !line.includes("private"),
        });
        continue;
      }
    }
    return records;
  }

  edges(document: ParsedDocument, _project: ProjectContext): SymbolEdge[] {
    const edges: SymbolEdge[] = [];
    for (const line of document.lines) {
      const useMatch = /^use\s+([A-Za-z0-9_\\]+);/.exec(line.trim());
      if (useMatch?.[1]) {
        const full = useMatch[1];
        edges.push({
          sourceSymbol: document.path,
          targetSymbol: full.split("\\").at(-1) ?? full,
          sourcePath: document.path,
          targetPath: full.replace(/\\/g, "/") + ".php",
          kind: "imports",
        });
      }
    }
    return edges;
  }

  async projectContext(files: RepositoryFile[]): Promise<ProjectContext> {
    const paths = files.map((f) => f.path);
    const manifests = paths.filter((p) => p.endsWith("composer.json") || p.endsWith("composer.lock"));
    const frameworks: string[] = [];
    if (paths.some((p) => p.includes("artisan") || p.includes("app/Http"))) frameworks.push("laravel");
    if (paths.some((p) => p.includes("symfony"))) frameworks.push("symfony");

    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests,
      packageManager: "composer",
      frameworks,
    };
  }

  testLinks(document: ParsedDocument, project: ProjectContext): TestLink[] {
    const links: TestLink[] = [];
    if (!document.isTest) {
      const baseName = document.path.split("/").at(-1)?.replace(".php", "") ?? "";
      for (const root of project.rootFiles) {
        if (root === `${baseName}Test.php`) {
          links.push({ sourcePath: document.path, testPath: root, confidence: 0.95 });
        }
      }
    }
    return links;
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: "php",
      idioms: ["Strict types declare(strict_types=1);", "Prepared PDO statements", "Typed properties (PHP 7.4+)"],
      dangerousPatterns: [
        "eval(",
        "unserialize(raw_input)",
        "exec(",
        "passthru(",
        "shell_exec(",
        "$_GET / $_POST directly in SQL string",
      ],
      securityChecks: ["Object Injection via unserialize()", "SQL Injection", "Local / Remote file inclusion via include($var)"],
      concurrencyConsiderations: ["Process isolation per request (FPM/Swoole)"],
      resourceManagementRules: ["Close file resources (fclose)", "Free large memory buffers in long-running workers"],
      testingFrameworks: ["PHPUnit", "Pest"],
      rules: [
        {
          id: "php-no-unserialize",
          category: "security",
          severity: "critical",
          description: "Detect dangerous unserialize calls",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/\bunserialize\s*\(/.test(line)) {
                findings.push({
                  title: "Insecure PHP object deserialization",
                  explanation: "unserialize() with user-controlled input allows PHP Object Injection and RCE. Use json_decode().",
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
