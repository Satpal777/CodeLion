import { describe, expect, it } from "vitest";
import { chunkSource, detectLanguage, shouldIndexPath } from "../src";

describe("language coverage", () => {
  it.each([
    ["src/app.tsx", "typescript"],
    ["service.py", "python"],
    ["main.go", "go"],
    ["lib.rs", "rust"],
    ["Controller.java", "java"],
    ["infra/main.tf", "terraform"],
    ["query.sql", "sql"],
    ["script.sh", "shell"],
  ])("detects %s", (path, expected) => {
    expect(detectLanguage(path)).toBe(expected);
  });

  it("drops dependencies, generated output and lock files", () => {
    expect(shouldIndexPath("node_modules/pkg/index.js")).toBe(false);
    expect(shouldIndexPath("src/generated/client.ts")).toBe(false);
    expect(shouldIndexPath("pnpm-lock.yaml")).toBe(false);
    expect(shouldIndexPath("src/review.ts")).toBe(true);
  });
});

describe("chunkSource", () => {
  it("creates stable bounded chunks and attaches a nearby symbol", () => {
    const source = ["export function review() {", ...Array.from({ length: 88 }, (_, i) => `  line${i}();`), "}"].join(
      "\n",
    );
    const chunks = chunkSource("review.ts", "typescript", source, { maxLines: 50, overlapLines: 10 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.symbol).toBe("review");
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks[1]?.startLine).toBe(41);
    expect(chunks[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
