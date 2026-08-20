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

export class SQLAdapter implements LanguageAdapter {
  readonly id = "sql-adapter";
  readonly version = "2026-08-20.1";
  readonly language = "sql" as const;

  detect(file: RepositoryFile): DetectionResult {
    return {
      language: "sql",
      isGenerated: file.path.includes("schema.sql") || file.path.includes("dump.sql"),
      isTest: file.path.includes("test") || file.path.includes("fixture"),
      confidence: 0.99,
    };
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const lines = input.source.replace(/\r\n/g, "\n").split("\n");
    return {
      path: input.path,
      language: "sql",
      source: input.source,
      lines,
      ast: { type: "Script", startLine: 1, endLine: lines.length },
      isGenerated: input.path.includes("dump.sql"),
      isTest: input.path.includes("fixture"),
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
        const tableMatch = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)/i.exec(line);
        if (tableMatch?.[1]) {
          symbol = tableMatch[1].replace(/["`]/g, "");
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

      const tableMatch = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)/i.exec(line);
      if (tableMatch?.[1]) {
        records.push({
          name: tableMatch[1].replace(/["`]/g, ""),
          kind: "table",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: true,
        });
        continue;
      }

      const viewMatch = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([A-Za-z0-9_."]+)/i.exec(line);
      if (viewMatch?.[1]) {
        records.push({
          name: viewMatch[1].replace(/["`]/g, ""),
          kind: "query",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: true,
        });
        continue;
      }
    }
    return records;
  }

  edges(document: ParsedDocument, _project: ProjectContext): SymbolEdge[] {
    const edges: SymbolEdge[] = [];
    for (const line of document.lines) {
      const fkMatch = /REFERENCES\s+([A-Za-z0-9_."]+)\s*\(/i.exec(line);
      if (fkMatch?.[1]) {
        edges.push({
          sourceSymbol: document.path,
          targetSymbol: fkMatch[1].replace(/["`]/g, ""),
          sourcePath: document.path,
          kind: "references",
        });
      }
    }
    return edges;
  }

  async projectContext(files: RepositoryFile[]): Promise<ProjectContext> {
    const paths = files.map((f) => f.path);
    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests: paths.filter((p) => p.includes("migration") || p.includes("drizzle")),
      frameworks: ["sql"],
    };
  }

  testLinks(_document: ParsedDocument, _project: ProjectContext): TestLink[] {
    return [];
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: "sql",
      idioms: ["Transaction safety (BEGIN/COMMIT)", "Idempotent migrations (IF NOT EXISTS)", "Index optimization on foreign keys"],
      dangerousPatterns: [
        "DROP TABLE without IF EXISTS or backup",
        "ALTER TABLE ... ADD COLUMN NOT NULL without default value on large table (table lock)",
        "Unindexed foreign key columns in Postgres causing whole-table locks during delete",
        "TRUNCATE TABLE without transaction boundary",
      ],
      securityChecks: ["Privilege escalation in stored procedures", "SQL injection vectors in dynamic SQL"],
      concurrencyConsiderations: ["Deadlocks from non-deterministic lock acquisition order across transactions"],
      resourceManagementRules: ["Ensure indexes exist for foreign keys and frequent query filters"],
      testingFrameworks: ["pgTAP", "sql-migrate"],
      rules: [
        {
          id: "sql-not-null-no-default",
          category: "data_migration",
          severity: "high",
          description: "Flag ADD COLUMN NOT NULL without DEFAULT on existing tables",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/ALTER\s+TABLE\s+.*ADD\s+COLUMN\s+.*NOT\s+NULL/i.test(line) && !/DEFAULT/i.test(line)) {
                findings.push({
                  title: "Migration risk: ADD COLUMN NOT NULL without DEFAULT",
                  explanation: "Adding a NOT NULL column without a DEFAULT will fail on tables with existing rows.",
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
