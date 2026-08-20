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

export class SolidityAdapter implements LanguageAdapter {
  readonly id = "solidity-adapter";
  readonly version = "2026-08-20.1";
  readonly language = "solidity" as const;

  detect(file: RepositoryFile): DetectionResult {
    return {
      language: "solidity",
      isGenerated: file.path.includes("artifacts/") || file.path.includes("typechain/"),
      isTest: file.path.includes("test/") || file.path.endsWith(".t.sol"),
      confidence: 0.99,
    };
  }

  async parse(input: ParseInput): Promise<ParsedDocument> {
    const lines = input.source.replace(/\r\n/g, "\n").split("\n");
    return {
      path: input.path,
      language: "solidity",
      source: input.source,
      lines,
      ast: { type: "SourceUnit", startLine: 1, endLine: lines.length },
      isGenerated: input.path.includes("artifacts/"),
      isTest: input.path.includes("test") || input.path.endsWith(".t.sol"),
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
        const contractMatch = /(?:contract|interface|library)\s+([A-Za-z0-9_]+)/.exec(line);
        const fnMatch = /function\s+([A-Za-z0-9_]+)/.exec(line);
        if (contractMatch?.[1]) {
          symbol = contractMatch[1];
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

      const contractMatch = /(contract|interface|library)\s+([A-Za-z0-9_]+)/.exec(line);
      if (contractMatch?.[2]) {
        records.push({
          name: contractMatch[2],
          kind: contractMatch[1] === "interface" ? "interface" : "class",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: true,
        });
        continue;
      }

      const fnMatch = /function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*(external|public|internal|private)?/.exec(line);
      if (fnMatch?.[1]) {
        records.push({
          name: fnMatch[1],
          kind: "function",
          path: document.path,
          startLine: lineNum,
          endLine: lineNum,
          signature: line,
          isExported: fnMatch[2] === "external" || fnMatch[2] === "public",
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
    const manifests = paths.filter(
      (p) => p.endsWith("foundry.toml") || p.endsWith("hardhat.config.js") || p.endsWith("hardhat.config.ts"),
    );
    return {
      rootFiles: paths.filter((p) => !p.includes("/")),
      manifests,
      frameworks: paths.some((p) => p.includes("foundry.toml")) ? ["foundry"] : ["hardhat"],
    };
  }

  testLinks(document: ParsedDocument, project: ProjectContext): TestLink[] {
    const links: TestLink[] = [];
    if (!document.isTest) {
      const baseName = document.path.split("/").at(-1)?.replace(".sol", "") ?? "";
      for (const root of project.rootFiles) {
        if (root.includes(`${baseName}.t.sol`)) {
          links.push({ sourcePath: document.path, testPath: root, confidence: 0.95 });
        }
      }
    }
    return links;
  }

  reviewProfile(): LanguageReviewProfile {
    return {
      language: "solidity",
      idioms: ["Checks-Effects-Interactions pattern", "Reentrancy guards (nonReentrant modifier)", "SafeERC20 for token transfers"],
      dangerousPatterns: [
        "tx.origin used for authorization (use msg.sender)",
        "delegatecall with untrusted address",
        "selfdestruct / suicide calls",
        "Raw .call{value: ...}(\"\") before updating internal state (reentrancy hazard)",
        "block.timestamp used for random number generation",
      ],
      securityChecks: ["Reentrancy attacks", "tx.origin authorization bypass", "Integer overflow (Solidity <0.8.0)", "Unchecked return values of low-level calls"],
      concurrencyConsiderations: ["Front-running and MEV exposure"],
      resourceManagementRules: ["Gas optimization (cache storage reads in memory)"],
      testingFrameworks: ["Foundry", "Hardhat"],
      rules: [
        {
          id: "sol-no-tx-origin",
          category: "security",
          severity: "critical",
          description: "Ban tx.origin for authentication checks",
          check: (doc) => {
            const findings: ReturnType<ReviewRule["check"]> = [];
            doc.lines.forEach((line, idx) => {
              if (/\brequire\s*\(.*tx\.origin\b/.test(line) || /\btx\.origin\s*==/.test(line)) {
                findings.push({
                  title: "Insecure tx.origin authorization",
                  explanation: "Using tx.origin for authorization makes the contract vulnerable to phishing attacks. Use msg.sender instead.",
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
