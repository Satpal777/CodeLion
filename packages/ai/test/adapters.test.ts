import { describe, expect, it } from "vitest";
import { getLanguageAdapter, supportedLanguages, detectLanguage } from "../src";

describe("Major-Language Launch Matrix Conformance", () => {
  it("registers adapters for every supported language", () => {
    expect(supportedLanguages.length).toBeGreaterThanOrEqual(38);
    for (const lang of supportedLanguages) {
      const adapter = getLanguageAdapter(lang);
      expect(adapter).toBeDefined();
      expect(adapter.id).toBeTruthy();
      expect(adapter.reviewProfile).toBeTypeOf("function");
    }
  });

  const languageSamples: Array<{
    lang: (typeof supportedLanguages)[number];
    file: string;
    code: string;
    expectedSymbol: string;
    expectedKind: string;
  }> = [
    {
      lang: "typescript",
      file: "src/user.ts",
      code: "export function authenticateUser(token: string): boolean { return true; }",
      expectedSymbol: "authenticateUser",
      expectedKind: "function",
    },
    {
      lang: "python",
      file: "services/auth.py",
      code: "def authenticate_user(token: str) -> bool:\n    return True\n",
      expectedSymbol: "authenticate_user",
      expectedKind: "function",
    },
    {
      lang: "java",
      file: "src/main/java/AuthService.java",
      code: "public class AuthService {\n  public boolean authenticateUser(String token) { return true; }\n}",
      expectedSymbol: "AuthService",
      expectedKind: "class",
    },
    {
      lang: "kotlin",
      file: "src/main/kotlin/Auth.kt",
      code: "class AuthManager {\n  fun login() = true\n}",
      expectedSymbol: "AuthManager",
      expectedKind: "class",
    },
    {
      lang: "go",
      file: "pkg/auth/auth.go",
      code: "package auth\n\nfunc Authenticate(token string) bool {\n  return true\n}",
      expectedSymbol: "Authenticate",
      expectedKind: "function",
    },
    {
      lang: "rust",
      file: "src/auth.rs",
      code: "pub fn authenticate_user(token: &str) -> bool { true }",
      expectedSymbol: "authenticate_user",
      expectedKind: "function",
    },
    {
      lang: "c",
      file: "src/auth.c",
      code: "int authenticate_user(const char* token) { return 1; }",
      expectedSymbol: "authenticate_user",
      expectedKind: "function",
    },
    {
      lang: "cpp",
      file: "src/Auth.cpp",
      code: "class AuthController {\npublic:\n  bool login();\n};",
      expectedSymbol: "AuthController",
      expectedKind: "class",
    },
    {
      lang: "csharp",
      file: "Services/AuthService.cs",
      code: "namespace App;\npublic class AuthService {\n  public bool Login() => true;\n}",
      expectedSymbol: "AuthService",
      expectedKind: "class",
    },
    {
      lang: "ruby",
      file: "app/services/auth.rb",
      code: "class AuthService\n  def authenticate(token)\n    true\n  end\nend",
      expectedSymbol: "authenticate",
      expectedKind: "method",
    },
    {
      lang: "php",
      file: "src/AuthService.php",
      code: "<?php\nclass AuthService {\n  public function authenticate(string $token): bool { return true; }\n}",
      expectedSymbol: "AuthService",
      expectedKind: "class",
    },
    {
      lang: "swift",
      file: "Sources/Auth.swift",
      code: "public class AuthManager {\n  public func login() -> Bool { return true }\n}",
      expectedSymbol: "AuthManager",
      expectedKind: "class",
    },
    {
      lang: "dart",
      file: "lib/auth.dart",
      code: "class AuthService {\n  bool authenticate() => true;\n}",
      expectedSymbol: "AuthService",
      expectedKind: "class",
    },
    {
      lang: "sql",
      file: "migrations/001_users.sql",
      code: "CREATE TABLE users (\n  id UUID PRIMARY KEY,\n  email TEXT NOT NULL\n);",
      expectedSymbol: "users",
      expectedKind: "table",
    },
    {
      lang: "shell",
      file: "scripts/deploy.sh",
      code: "#!/bin/bash\nfunction deploy_app() {\n  echo 'deploying'\n}",
      expectedSymbol: "deploy_app",
      expectedKind: "function",
    },
    {
      lang: "elixir",
      file: "lib/auth.ex",
      code: "defmodule App.Auth do\n  def authenticate(token), do: true\nend",
      expectedSymbol: "App.Auth",
      expectedKind: "module",
    },
    {
      lang: "haskell",
      file: "src/Auth.hs",
      code: "module Auth where\nauthenticate :: String -> Bool\nauthenticate _ = True",
      expectedSymbol: "authenticate",
      expectedKind: "function",
    },
    {
      lang: "solidity",
      file: "contracts/Token.sol",
      code: "contract MyToken {\n  function transfer(address to, uint256 amount) public {}\n}",
      expectedSymbol: "MyToken",
      expectedKind: "class",
    },
    {
      lang: "cobol",
      file: "src/auth.cbl",
      code: "       IDENTIFICATION DIVISION.\n       PROGRAM-ID. AUTHPROG.",
      expectedSymbol: "AUTHPROG",
      expectedKind: "module",
    },
    {
      lang: "terraform",
      file: "main.tf",
      code: 'resource "aws_s3_bucket" "data_bucket" {\n  bucket = "my-bucket"\n}',
      expectedSymbol: "aws_s3_bucket.data_bucket",
      expectedKind: "constant",
    },
  ];

  it.each(languageSamples)(
    "extracts symbols accurately for $lang ($file)",
    async ({ lang, file, code, expectedSymbol, expectedKind }) => {
      const adapter = getLanguageAdapter(lang);
      const doc = await adapter.parse({ path: file, source: code, language: lang });
      const symbols = adapter.symbols(doc);
      expect(symbols.length).toBeGreaterThan(0);
      const matched = symbols.find((s) => s.name === expectedSymbol);
      expect(matched).toBeDefined();
      expect(matched?.kind).toBe(expectedKind);
    },
  );

  it.each(languageSamples)("produces valid chunk boundaries for $lang", async ({ lang, file, code }) => {
    const adapter = getLanguageAdapter(lang);
    const doc = await adapter.parse({ path: file, source: code, language: lang });
    const chunks = adapter.chunk(doc);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(chunks[0]?.startLine).toBe(1);
  });

  it("validates language review profile rules", () => {
    const tsProfile = getLanguageAdapter("typescript").reviewProfile();
    expect(tsProfile.dangerousPatterns.length).toBeGreaterThan(0);
    expect(tsProfile.rules.some((r) => r.id === "ts-no-eval")).toBe(true);

    const pyProfile = getLanguageAdapter("python").reviewProfile();
    expect(pyProfile.rules.some((r) => r.id === "py-no-pickle-load")).toBe(true);

    const solProfile = getLanguageAdapter("solidity").reviewProfile();
    expect(solProfile.rules.some((r) => r.id === "sol-no-tx-origin")).toBe(true);
  });
});
