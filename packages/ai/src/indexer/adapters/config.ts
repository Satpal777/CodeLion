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

export class ConfigAdapter implements LanguageAdapter {
  readonly id = "config-adapter";
  readonly version = "2026-08-20.1";
  readonly language: SupportedLanguage;

  constructor(language: "json" | "yaml" | "toml" | "xml" | "terraform" | "dockerfile" = "json") {
    this.language = language;
  }

  detect(file: RepositoryFile): DetectionResult {
    return {
      language: this.language,
      isGenerated: file.path.includes("lock") || file.path.includes(".terraform/"),
      isTest: false,
      confidence: 0.99,
    };
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const lines = input.source.replace(/\r\n/g, "\n").split("\n");
    return {
      path: input.path,
      language: input.language,
      source: input.source,
      lines,
      ast: { type: "ConfigDoc", startLine: 1, endLine: lines.length },
      isGenerated: input.path.includes("lock"),
      isTest: false,
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
        const tfMatch = /^(?:resource|module|variable|output)\s+["']([^"']+)["'](?:\s+["']([^"']+)["'])?/.exec(
          line,
        );
        const yamlKeyMatch = /^([A-Za-z0-9_-]+):/.exec(line);
        if (tfMatch?.[1]) {
          symbol = tfMatch[2] ? `${tfMatch[1]}.${tfMatch[2]}` : tfMatch[1];
          break;
        }
        if (yamlKeyMatch?.[1]) {
          symbol = yamlKeyMatch[1];
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

      const tfMatch = /^(resource|module|variable|output)\s+["']([^"']+)["'](?:\s+["']([^"']+)["'])?/.exec(line);
      if (tfMatch?.[1] && tfMatch[2]) {
        const name = tfMatch[3] ? `${tfMatch[2]}.${tfMatch[3]}` : tfMatch[2];
        records.push({
          name,
          kind: "constant",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: true,
        });
      }
    }
    return records;
  }

  edges(_document: ParsedDocument, _project: ProjectContext): SymbolEdge[] {
    return [];
  }

  async projectContext(files: RepositoryFile[]): Promise<ProjectContext> {
    return {
      rootFiles: files.map((f) => f.path).filter((p) => !p.includes("/")),
      manifests: [],
      frameworks: [],
    };
  }

  testLinks(_document: ParsedDocument, _project: ProjectContext): TestLink[] {
    return [];
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: this.language,
      idioms: ["Least privilege IAM roles in IaC", "Pin container base image digests / exact tags", "Avoid hardcoding secret tokens in YAML/JSON"],
      dangerousPatterns: [
        "Plaintext passwords / tokens in config files",
        "0.0.0.0/0 open ingress on sensitive ports (22, 3306, 5432) in Terraform security groups",
        "Privileged mode in Dockerfile / Kubernetes pod specs (privileged: true)",
        "Running containers as root (missing USER nonroot in Dockerfile)",
      ],
      securityChecks: ["Hardcoded secrets", "Wildcard open security groups", "Root container execution"],
      concurrencyConsiderations: [],
      resourceManagementRules: ["Set resource limits/requests on Kubernetes containers"],
      testingFrameworks: ["tflint", "checkov", "hadolint"],
      rules: [
        {
          id: "iac-no-plaintext-secrets",
          category: "security",
          severity: "critical",
          description: "Detect hardcoded API keys or passwords in config",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (
                /(?:password|secret_key|api_key|private_key|token)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{16,}["']/i.test(
                  line,
                ) &&
                !line.includes("${") &&
                !line.includes("vault") &&
                !line.includes("env.")
              ) {
                findings.push({
                  title: "Hardcoded secret detected in configuration",
                  explanation: "Do not store plaintext credentials in configuration or IaC. Use environment variables or a secret manager.",
                  line: idx + 1,
                  evidence: line.trim().slice(0, 30) + "... [REDACTED]",
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
