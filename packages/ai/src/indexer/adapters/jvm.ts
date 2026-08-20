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

export class JVMAdapter implements LanguageAdapter {
  readonly id = "jvm-adapter";
  readonly version = "2026-08-20.1";
  readonly language: SupportedLanguage;

  constructor(language: "java" | "kotlin" | "groovy" | "scala" = "java") {
    this.language = language;
  }

  detect(file: RepositoryFile): DetectionResult {
    const isTest =
      file.path.includes("src/test/") ||
      file.path.endsWith("Test.java") ||
      file.path.endsWith("Spec.groovy") ||
      file.path.endsWith("Test.kt") ||
      file.path.endsWith("Spec.scala");
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
      ast: { type: "CompilationUnit", startLine: 1, endLine: lines.length },
      isGenerated: input.path.includes("generated/") || input.source.includes("@Generated"),
      isTest: input.path.includes("src/test/") || input.path.includes("Test"),
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
        const classMatch = /(?:public|protected|private)?\s*(?:class|interface|enum|record|object|trait)\s+(\w+)/.exec(
          line,
        );
        const methodMatch = /(?:public|protected|private)?\s*(?:static\s+)?(?:[\w<>[\],]+\s+)+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{?/.exec(
          line,
        );
        if (classMatch?.[1]) {
          symbol = classMatch[1];
          break;
        }
        if (methodMatch?.[1]) {
          symbol = methodMatch[1];
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

      const classMatch = /(?:public|protected|private)?\s*(?:class|interface|enum|record|object|trait)\s+(\w+)/.exec(
        line,
      );
      if (classMatch?.[1]) {
        records.push({
          name: classMatch[1],
          kind: line.includes("interface")
            ? "interface"
            : line.includes("enum")
              ? "enum"
              : line.includes("trait")
                ? "trait"
                : "class",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: line.includes("public"),
        });
        continue;
      }

      const methodMatch = /(?:public|protected|private)\s+(?:static\s+)?(?:final\s+)?(?:[\w<>[\],]+\s+)(\w+)\s*\([^)]*\)/.exec(
        line,
      );
      if (methodMatch?.[1]) {
        records.push({
          name: methodMatch[1],
          kind: "method",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: line.includes("public"),
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
      const importMatch = /^import\s+(?:static\s+)?([A-Za-z0-9_.]+);?/.exec(trimmed);
      if (importMatch?.[1]) {
        const fullImport = importMatch[1];
        const targetSymbol = fullImport.split(".").at(-1) ?? fullImport;
        edges.push({
          sourceSymbol: document.path,
          targetSymbol,
          sourcePath: document.path,
          targetPath: fullImport.replace(/\./g, "/") + ".java",
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
        p.endsWith("pom.xml") ||
        p.endsWith("build.gradle") ||
        p.endsWith("build.gradle.kts") ||
        p.endsWith("build.sbt"),
    );
    const frameworks: string[] = [];
    if (paths.some((p) => p.includes("spring"))) frameworks.push("spring");
    if (paths.some((p) => p.includes("quarkus"))) frameworks.push("quarkus");
    if (paths.some((p) => p.includes("micronaut"))) frameworks.push("micronaut");

    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests,
      packageManager: paths.some((p) => p.includes("gradle"))
        ? "gradle"
        : paths.some((p) => p.includes("sbt"))
          ? "sbt"
          : "maven",
      frameworks,
    };
  }

  testLinks(document: ParsedDocument, project: ProjectContext): TestLink[] {
    const links: TestLink[] = [];
    if (!document.isTest) {
      const className = document.path.split("/").at(-1)?.replace(/\.(java|kt|groovy|scala)$/, "") ?? "";
      for (const root of project.rootFiles) {
        if (root.includes(`${className}Test`) || root.includes(`${className}Spec`)) {
          links.push({ sourcePath: document.path, testPath: root, confidence: 0.95 });
        }
      }
    }
    return links;
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: this.language,
      idioms: ["Effective Java patterns", "try-with-resources", "Optional usage", "Immutability where possible"],
      dangerousPatterns: [
        "Runtime.getRuntime().exec(",
        "ObjectInputStream.readObject() without filter",
        "Statement.executeQuery(rawQuery + userInput)",
        "NullPointerException risks on unboxing",
        "synchronized on String or boxed primitive",
      ],
      securityChecks: [
        "Insecure Java deserialization",
        "SQL injection via concatenated JDBC queries",
        "Log4j/JNDI injection via unescaped logging strings",
      ],
      concurrencyConsiderations: [
        "Thread safety on Shared mutable state",
        "Double-checked locking without volatile",
        "Thread starvation and deadlock risks",
      ],
      resourceManagementRules: [
        "Always use try-with-resources on AutoCloseable",
        "Properly shutdown ExecutorService pools",
      ],
      testingFrameworks: ["JUnit 5", "TestNG", "Spock", "ScalaTest"],
      rules: [
        {
          id: "jvm-no-raw-exec",
          category: "security",
          severity: "critical",
          description: "Detect unvalidated Runtime.exec calls",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/Runtime\.getRuntime\(\)\.exec\s*\(/.test(line)) {
                findings.push({
                  title: "Dangerous Runtime.exec invocation",
                  explanation: "Runtime.exec can allow command injection. Use ProcessBuilder with explicit arguments.",
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
