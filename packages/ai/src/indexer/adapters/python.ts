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

export class PythonAdapter implements LanguageAdapter {
  readonly id = "python-adapter";
  readonly version = "2026-08-20.1";
  readonly language = "python" as const;

  detect(file: RepositoryFile): DetectionResult {
    const isTest =
      /^(test_|tests_)/.test(file.path.split("/").at(-1) ?? "") ||
      file.path.endsWith("_test.py") ||
      file.path.includes("tests/");
    const isGenerated = file.path.includes("generated") || (file.content?.includes("# auto-generated") ?? false);
    return {
      language: "python",
      dialect: "python3",
      isGenerated,
      isTest,
      confidence: 0.99,
    };
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const lines = input.source.replace(/\r\n/g, "\n").split("\n");
    const errors: string[] = [];

    return {
      path: input.path,
      language: input.language,
      source: input.source,
      lines,
      ast: { type: "Module", startLine: 1, endLine: lines.length },
      isGenerated: input.source.includes("# auto-generated") || input.path.includes("generated/"),
      isTest: input.path.includes("test_") || input.path.includes("tests/"),
      syntaxValid: true,
      parseErrors: errors,
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
        const fnMatch = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(line);
        const classMatch = /^class\s+([A-Za-z_]\w*)/.exec(line);
        if (fnMatch?.[1]) {
          symbol = fnMatch[1];
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

      const fnMatch = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(trimmed);
      if (fnMatch?.[1]) {
        const isMethod = line.startsWith("    ") || line.startsWith("\t");
        records.push({
          name: fnMatch[1],
          kind: isMethod ? "method" : "function",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: fnMatch[0],
          isExported: !fnMatch[1].startsWith("_"),
        });
        continue;
      }

      const classMatch = /^class\s+([A-Za-z_]\w*)(?:\(([^)]*)\))?:/.exec(trimmed);
      if (classMatch?.[1]) {
        records.push({
          name: classMatch[1],
          kind: "class",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: classMatch[0],
          isExported: !classMatch[1].startsWith("_"),
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
      const fromImportMatch = /^from\s+([A-Za-z0-9_.]+)\s+import\s+([A-Za-z0-9_,\s*]+)/.exec(trimmed);
      if (fromImportMatch?.[1] && fromImportMatch[2]) {
        const symbols = fromImportMatch[2].split(",").map((s) => s.trim());
        for (const sym of symbols) {
          if (sym) {
            edges.push({
              sourceSymbol: document.path,
              targetSymbol: sym,
              sourcePath: document.path,
              targetPath: fromImportMatch[1].replace(/\./g, "/") + ".py",
              kind: "imports",
            });
          }
        }
      }
      const directImportMatch = /^import\s+([A-Za-z0-9_, ]+)/.exec(trimmed);
      if (directImportMatch?.[1]) {
        const modules = directImportMatch[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]);
        for (const mod of modules) {
          if (mod) {
            edges.push({
              sourceSymbol: document.path,
              targetSymbol: mod,
              sourcePath: document.path,
              kind: "imports",
            });
          }
        }
      }
    }
    return edges;
  }

  async projectContext(files: RepositoryFile[]): Promise<ProjectContext> {
    const paths = files.map((f) => f.path);
    const manifests = paths.filter(
      (p) =>
        p.endsWith("pyproject.toml") ||
        p.endsWith("requirements.txt") ||
        p.endsWith("Pipfile") ||
        p.endsWith("setup.py"),
    );
    const frameworks: string[] = [];
    if (paths.some((p) => p.includes("django") || p.includes("manage.py"))) frameworks.push("django");
    if (paths.some((p) => p.includes("fastapi"))) frameworks.push("fastapi");
    if (paths.some((p) => p.includes("flask"))) frameworks.push("flask");

    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests,
      packageManager: paths.some((p) => p.includes("poetry.lock"))
        ? "poetry"
        : paths.some((p) => p.includes("Pipfile"))
          ? "pipenv"
          : "pip",
      frameworks,
    };
  }

  testLinks(document: ParsedDocument, project: ProjectContext): TestLink[] {
    const links: TestLink[] = [];
    if (!document.isTest) {
      const fileName = document.path.split("/").at(-1)?.replace(".py", "") ?? "";
      for (const root of project.rootFiles) {
        if (root === `test_${fileName}.py` || root === `${fileName}_test.py`) {
          links.push({ sourcePath: document.path, testPath: root, confidence: 0.95 });
        }
      }
    }
    return links;
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: "python",
      idioms: ["PEP 8 style", "type annotations (mypy)", "context managers (with statements)", "list comprehensions"],
      dangerousPatterns: [
        "pickle.loads(",
        "os.system(",
        "subprocess.Popen(..., shell=True)",
        "eval(",
        "exec(",
        "yaml.load(..., Loader=yaml.Loader)",
        "mutable default argument: def foo(bar=[])",
      ],
      securityChecks: [
        "Insecure deserialization via pickle",
        "SQL injection via raw string formatting in cursor.execute",
        "Command injection via shell=True",
      ],
      concurrencyConsiderations: ["GIL limitations with CPU-bound threading", "asyncio loop blocking with sync I/O"],
      resourceManagementRules: ["Always use with open(...) for file handles", "Close DB sessions in finally/context"],
      testingFrameworks: ["pytest", "unittest"],
      rules: [
        {
          id: "py-no-shell-true",
          category: "security",
          severity: "critical",
          description: "Detect subprocess calls with shell=True",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/subprocess\.(?:call|Popen|run|check_output)\(.*shell\s*=\s*True/i.test(line)) {
                findings.push({
                  title: "Command injection risk with shell=True",
                  explanation: "Executing subprocesses with shell=True allows shell metacharacters and command injection.",
                  line: idx + 1,
                  evidence: line.trim(),
                });
              }
            });
            return findings;
          },
        },
        {
          id: "py-no-pickle-load",
          category: "security",
          severity: "critical",
          description: "Detect insecure pickle deserialization",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/\bpickle\.(?:loads?|Unpickler)\b/.test(line)) {
                findings.push({
                  title: "Insecure pickle deserialization",
                  explanation: "pickle is not secure against erroneous or maliciously constructed data. Use json or safetensors.",
                  line: idx + 1,
                  evidence: line.trim(),
                });
              }
            });
            return findings;
          },
        },
        {
          id: "py-mutable-default-arg",
          category: "correctness",
          severity: "medium",
          description: "Detect mutable default arguments in functions",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/def\s+\w+\(.*=\s*(\[\]|\{\})\s*\)/.test(line)) {
                findings.push({
                  title: "Mutable default argument",
                  explanation: "Default arguments in Python are evaluated once at function definition time. Use None as default.",
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
    const errors: string[] = [];
    if (!input.suggestedPatch.trim()) {
      return { valid: false, errors: ["Suggested patch is empty"] };
    }
    return {
      valid: true,
      errors,
      formattedSuggestion: input.suggestedPatch,
    };
  }
}
