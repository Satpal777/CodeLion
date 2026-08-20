import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeGithubPrivateKey, parseServerEnv } from "../src/index";

describe("decodeGithubPrivateKey", () => {
  it("decodes raw PEM key", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
    });

    const decoded = decodeGithubPrivateKey(privateKey);
    expect(decoded).toContain("-----BEGIN RSA PRIVATE KEY-----");
    expect(decoded).toContain("-----END RSA PRIVATE KEY-----");
  });

  it("decodes base64-encoded PEM key with real newlines", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
    });

    const base64 = Buffer.from(privateKey).toString("base64");
    const decoded = decodeGithubPrivateKey(base64);
    expect(decoded).toContain("-----BEGIN RSA PRIVATE KEY-----");
  });

  it("decodes base64-encoded PEM key with escaped literal \\n", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
    });

    const escapedPem = privateKey.replace(/\n/g, "\\n");
    const base64 = Buffer.from(escapedPem).toString("base64");
    const decoded = decodeGithubPrivateKey(base64);
    expect(decoded).toContain("-----BEGIN RSA PRIVATE KEY-----");
  });

  it("decodes raw PEM key with escaped literal \\n and quotes", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
    });

    const quotedEscaped = `"${privateKey.replace(/\n/g, "\\n")}"`;
    const decoded = decodeGithubPrivateKey(quotedEscaped);
    expect(decoded).toContain("-----BEGIN RSA PRIVATE KEY-----");
  });

  it("parses server environment without throwing on empty optional fields", () => {
    const env = parseServerEnv({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      AI_GATEWAY_API_KEY: "",
      INNGEST_EVENT_KEY: "",
      INNGEST_SIGNING_KEY: "",
    });

    expect(env.AI_GATEWAY_API_KEY).toBe("dev-ai-gateway-api-key");
    expect(env.INNGEST_EVENT_KEY).toBeUndefined();
    expect(env.INNGEST_SIGNING_KEY).toBeUndefined();
  });
});
