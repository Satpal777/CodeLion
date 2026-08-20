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

export class TypeScriptAdapter implements LanguageAdapter {
  readonly id = "typescript-adapter";
  readonly version = "2026-08-20.1";
  readonly language = "typescript" as const;

  detect(file: RepositoryFile): DetectionResult {
    const isTest = /\.(test|spec)\.[jt]sx?$/.test(file.path) || file.path.includes("__tests__");
    const isGenerated =
      /\.(generated|d)\.ts$/.test(file.path) ||
      (file.content?.includes("@generated") ?? false) ||
      (file.content?.includes("AUTO-GENERATED") ?? false);
    return {
      language: file.path.endsWith(".js") || file.path.endsWith(".jsx") ? "javascript" : "typescript",
      dialect: file.path.endsWith("x") ? "react" : "standard",
      isGenerated,
      isTest,
      confidence: 0.99,
    };
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const lines = input.source.replace(/\r\n/g, "\n").split("\n");
    const errors: string[] = [];
    let syntaxValid = true;

    // Check basic bracket/brace balance
    let braceCount = 0;
    for (const line of lines) {
      for (const char of line) {
        if (char === "{") braceCount += 1;
        if (char === "}") braceCount -= 1;
      }
    }
    if (braceCount !== 0) {
      syntaxValid = false;
      errors.push(`Unbalanced braces in ${input.path}`);
    }

    return {
      path: input.path,
      language: input.language,
      source: input.source,
      lines,
      ast: { type: "Program", startLine: 1, endLine: lines.length },
      isGenerated: input.source.includes("@generated") || input.path.includes(".generated."),
      isTest: /\.(test|spec)\.[jt]sx?$/.test(input.path) || input.path.includes("__tests__"),
      syntaxValid,
      parseErrors: errors,
    };
  }

  chunk(document: ParsedDocument, options?: ChunkOptions): CodeChunk[] {
    const lines = document.lines;
    const chunks: CodeChunk[] = [];
    const maxLines = Math.max(20, options?.maxLines ?? 100);
    const overlap = Math.min(maxLines - 1, Math.max(0, options?.overlapLines ?? 15));

    for (let start = 0; start < lines.length; start += maxLines - overlap) {
      const end = Math.min(lines.length, start + maxLines);
      const content = lines.slice(start, end).join("\n");
      if (content.trim().length === 0) continue;

      let symbol: string | null = null;
      for (let i = start; i >= Math.max(0, start - 30); i -= 1) {
        const line = lines[i]?.trim() ?? "";
        const fnMatch = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line);
        const classMatch = /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(line);
        const constMatch = /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
        const ifaceMatch = /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/.exec(line);
        if (fnMatch?.[1]) {
          symbol = fnMatch[1];
          break;
        }
        if (classMatch?.[1]) {
          symbol = classMatch[1];
          break;
        }
        if (constMatch?.[1]) {
          symbol = constMatch[1];
          break;
        }
        if (ifaceMatch?.[1]) {
          symbol = ifaceMatch[1];
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

      const fnMatch = /^(export\s+)?(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(line);
      if (fnMatch?.[3]) {
        records.push({
          name: fnMatch[3],
          kind: "function",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: fnMatch[0],
          isExported: Boolean(fnMatch[1]),
        });
        continue;
      }

      const classMatch = /^(export\s+)?(abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(line);
      if (classMatch?.[3]) {
        records.push({
          name: classMatch[3],
          kind: "class",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: classMatch[0],
          isExported: Boolean(classMatch[1]),
        });
        continue;
      }

      const ifaceMatch = /^(export\s+)?interface\s+([A-Za-z_$][\w$]*)/.exec(line);
      if (ifaceMatch?.[2]) {
        records.push({
          name: ifaceMatch[2],
          kind: "interface",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: ifaceMatch[0],
          isExported: Boolean(ifaceMatch[1]),
        });
        continue;
      }

      const typeMatch = /^(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
      if (typeMatch?.[2]) {
        records.push({
          name: typeMatch[2],
          kind: "type",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: typeMatch[0],
          isExported: Boolean(typeMatch[1]),
        });
        continue;
      }
    }
    return records;
  }

  edges(document: ParsedDocument, _project: ProjectContext): SymbolEdge[] {
    const edges: SymbolEdge[] = [];
    const lines = document.lines;

    for (const line of lines) {
      const importMatch = /^import\s+(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/.exec(
        line.trim(),
      );
      if (importMatch) {
        const targetPath = importMatch[4];
        if (importMatch[1]) {
          const names = importMatch[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]);
          for (const name of names) {
            if (name) {
              edges.push({
                sourceSymbol: document.path,
                targetSymbol: name,
                sourcePath: document.path,
                targetPath,
                kind: "imports",
              });
            }
          }
        } else if (importMatch[2] || importMatch[3]) {
          edges.push({
            sourceSymbol: document.path,
            targetSymbol: (importMatch[2] || importMatch[3]) as string,
            sourcePath: document.path,
            targetPath,
            kind: "imports",
          });
        }
      }
    }
    return edges;
  }

  async projectContext(files: RepositoryFile[]): Promise<ProjectContext> {
    const paths = files.map((f) => f.path);
    const manifests = paths.filter((p) => p.endsWith("package.json") || p.endsWith("tsconfig.json"));
    const frameworks: string[] = [];
    if (paths.some((p) => p.includes("next.config"))) frameworks.push("nextjs");
    if (paths.some((p) => p.endsWith(".tsx") || p.endsWith(".jsx"))) frameworks.push("react");
    if (paths.some((p) => p.endsWith(".vue"))) frameworks.push("vue");
    if (paths.some((p) => p.endsWith(".svelte"))) frameworks.push("svelte");

    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests,
      packageManager: paths.some((p) => p.includes("bun.lock") || p.includes("bun.lockb"))
        ? "bun"
        : paths.some((p) => p.includes("pnpm-lock.yaml"))
          ? "pnpm"
          : paths.some((p) => p.includes("yarn.lock"))
            ? "yarn"
            : "npm",
      frameworks,
    };
  }

  testLinks(document: ParsedDocument, project: ProjectContext): TestLink[] {
    const links: TestLink[] = [];
    if (!document.isTest) {
      const baseName = document.path.replace(/\.[jt]sx?$/, "");
      for (const root of project.rootFiles) {
        if (root.includes(baseName) && (root.includes(".test.") || root.includes(".spec."))) {
          links.push({ sourcePath: document.path, testPath: root, confidence: 0.95 });
        }
      }
    }
    return links;
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: "typescript",
      idioms: ["strict null checks", "use signals or reactive state", "prefer unknown over any"],
      dangerousPatterns: [
        "eval(",
        "dangerouslySetInnerHTML",
        "child_process.exec(",
        "process.env accessed directly without schema validation",
        "type assertion 'as any'",
      ],
      securityChecks: ["XSS via template injection", "Prototype pollution", "Command injection via exec"],
      concurrencyConsiderations: ["Unawaited promises", "Race conditions in state setters", "Unhandled rejections"],
      resourceManagementRules: ["Clear setInterval/setTimeout", "Unsubscribe event listeners in useEffect/destroy"],
      testingFrameworks: ["vitest", "jest", "playwright"],
      rules: [
        {
          id: "ts-no-eval",
          category: "security",
          severity: "critical",
          description: "Detect dynamic code execution using eval() or Function constructor",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/\beval\s*\(/.test(line) || /new\s+Function\s*\(/.test(line)) {
                findings.push({
                  title: "Dangerous eval() or Function execution",
                  explanation: "Dynamic code execution is unsafe and enables arbitrary code execution.",
                  line: idx + 1,
                  evidence: line.trim(),
                });
              }
            });
            return findings;
          },
        },
        {
          id: "ts-no-any",
          category: "maintainability",
          severity: "low",
          description: "Encourage using unknown instead of any",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/:\s*any\b/.test(line) && !line.includes("// eslint-disable")) {
                findings.push({
                  title: "Avoid explicit any type",
                  explanation: "Use strict types or unknown instead of any to preserve type safety.",
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
    let openCount = 0;
    for (const char of input.suggestedPatch) {
      if (char === "{") openCount += 1;
      if (char === "}") openCount -= 1;
    }
    if (openCount !== 0) {
      errors.push("Suggested replacement has unbalanced curly braces");
    }
    return {
      valid: errors.length === 0,
      errors,
      formattedSuggestion: input.suggestedPatch,
    };
  }
}
