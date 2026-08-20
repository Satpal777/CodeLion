import { describe, expect, it } from "vitest";
import {
  computeLexicalScore,
  cosineSimilarity,
  hybridRetrieve,
  planReviewContext,
  reciprocalRankFusion,
} from "../src/retrieval/hybrid";

describe("hybrid retrieval engine", () => {
  it("computes cosine similarity accurately", () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const vecC = [0, 1, 0];

    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0);
    expect(cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0);
  });

  it("scores lexical term matches with word boundary bonus", () => {
    const content = "export function authenticateUser(token: string) { return verify(token); }";
    const scoreA = computeLexicalScore(["authenticateUser"], content);
    const scoreB = computeLexicalScore(["nonexistent"], content);

    expect(scoreA).toBeGreaterThan(0.5);
    expect(scoreB).toBe(0);
  });

  it("fuses multi-channel rankings with Reciprocal Rank Fusion", () => {
    const chunkA = {
      path: "src/auth.ts",
      language: "typescript" as const,
      symbol: "auth",
      startLine: 1,
      endLine: 20,
      content: "auth code",
      contentHash: "hash-a",
    };
    const chunkB = {
      path: "src/db.ts",
      language: "typescript" as const,
      symbol: "db",
      startLine: 1,
      endLine: 20,
      content: "db code",
      contentHash: "hash-b",
    };

    const ranking1 = [{ item: chunkA, score: 1.0 }, { item: chunkB, score: 0.5 }];
    const ranking2 = [{ item: chunkA, score: 0.9 }];

    const fused = reciprocalRankFusion([ranking1, ranking2]);
    expect(fused[0]?.path).toBe("src/auth.ts");
    expect(fused[0]?.score).toBeGreaterThan(fused[1]?.score ?? 0);
  });

  it("retrieves candidates combining exact symbols and lexical search", () => {
    const chunks = [
      {
        path: "src/user.ts",
        language: "typescript" as const,
        symbol: "getUser",
        startLine: 1,
        endLine: 15,
        content: "function getUser() { return db.find(); }",
        contentHash: "c1",
      },
      {
        path: "src/billing.ts",
        language: "typescript" as const,
        symbol: "chargeCustomer",
        startLine: 1,
        endLine: 15,
        content: "function chargeCustomer() { stripe.charge(); }",
        contentHash: "c2",
      },
    ];

    const results = hybridRetrieve(
      { terms: ["stripe", "charge"], symbols: ["chargeCustomer"], paths: ["src/billing.ts"] },
      chunks,
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.symbol).toBe("chargeCustomer");
  });

  it("plans and formats review context within token budget", () => {
    const chunks = [
      {
        path: "src/auth.ts",
        language: "typescript" as const,
        symbol: "login",
        startLine: 10,
        endLine: 25,
        content: "function login() { ... }",
        contentHash: "h1",
        score: 0.95,
      },
    ];

    const context = planReviewContext(chunks, { targetCommit: "abc1234", maxTokens: 500 });
    expect(context).toHaveLength(1);
    expect(context[0]?.citation).toBe("src/auth.ts@abc1234#L10-L25");
  });
});
