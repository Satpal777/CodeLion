import "dotenv/config";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { z } from "zod";

// Lazily generated valid fallback RSA key for local dev / tests when real key is not yet set
let devFallbackPrivateKey: string | undefined;
function getDevFallbackPrivateKey(): string {
  if (!devFallbackPrivateKey) {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
    });
    devFallbackPrivateKey = privateKey;
  }
  return devFallbackPrivateKey;
}

const booleanString = z
  .union([z.boolean(), z.enum(["0", "1", "true", "false", ""])])
  .optional()
  .transform((value) => value === true || value === "1" || value === "true");

const stringOrUndefined = z
  .string()
  .optional()
  .transform((val) => (!val || val.trim() === "" ? undefined : val.trim()));

const stringOrFallback = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((val) => (!val || val.trim() === "" ? fallback : val.trim()));

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z
    .string()
    .optional()
    .transform((val) => (!val || val.trim() === "" ? "http://localhost:3000" : val.trim())),
  DATABASE_URL: z.string().min(1),
  SESSION_COOKIE_NAME: stringOrFallback("reviewer_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().max(90).default(30),
  DATA_ENCRYPTION_KEY: stringOrFallback("0123456789012345678901234567890123456789012="),
  GITHUB_APP_ID: stringOrFallback("dev-app-id"),
  GITHUB_APP_SLUG: stringOrFallback("dev-app-slug"),
  GITHUB_APP_PRIVATE_KEY_BASE64: stringOrUndefined,
  GITHUB_WEBHOOK_SECRET: stringOrFallback("dev-webhook-secret-0123456789abcdef"),
  GITHUB_APP_CLIENT_ID: stringOrFallback("dev-client-id"),
  GITHUB_APP_CLIENT_SECRET: stringOrFallback("dev-client-secret"),
  GITHUB_EXECUTOR_APP_ID: stringOrUndefined,
  GITHUB_EXECUTOR_APP_PRIVATE_KEY_BASE64: stringOrUndefined,
  GITHUB_EXECUTOR_APP_CLIENT_ID: stringOrUndefined,
  GITHUB_EXECUTOR_APP_CLIENT_SECRET: stringOrUndefined,
  GOOGLE_GENERATIVE_AI_API_KEY: stringOrUndefined,
  GEMINI_API_KEY: stringOrUndefined,
  GOOGLE_API_KEY: stringOrUndefined,
  AI_GATEWAY_API_KEY: stringOrFallback("dev-ai-gateway-api-key"),
  AI_REVIEW_MODEL: stringOrFallback("gemini-3.7-flash"),
  AI_SUMMARY_MODEL: stringOrFallback("gemini-3.7-flash"),
  AI_EMBEDDING_MODEL: stringOrFallback("text-embedding-004"),
  INNGEST_DEV: booleanString,
  INNGEST_EVENT_KEY: stringOrUndefined,
  INNGEST_SIGNING_KEY: stringOrUndefined,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  MAX_INDEX_FILE_BYTES: z.coerce.number().int().positive().default(500_000),
  MAX_PR_CHANGED_LINES: z.coerce.number().int().positive().default(5_000),
  REVIEW_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.78),
  RECONCILE_OUTBOX_CRON: stringOrFallback("0 */6 * * *"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedEnv ??= serverEnvSchema.parse(process.env);
  return cachedEnv;
}

/** Parse an explicit object in tests without mutating process.env. */
export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  return serverEnvSchema.parse(input);
}

function chunkBase64(str: string): string {
  const clean = str.replace(/\s+/g, "");
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += 64) {
    chunks.push(clean.slice(i, i + 64));
  }
  return chunks.join("\n");
}

function normalizePem(pem: string): string {
  const lines = pem
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const headerIndex = lines.findIndex((l) => l.startsWith("-----BEGIN"));
  const footerIndex = lines.findIndex((l) => l.startsWith("-----END"));

  if (headerIndex !== -1 && footerIndex !== -1 && footerIndex > headerIndex) {
    const header = lines[headerIndex];
    const footer = lines[footerIndex];
    const body = lines.slice(headerIndex + 1, footerIndex).join("");
    const formattedBody = chunkBase64(body);
    return `${header}\n${formattedBody}\n${footer}\n`;
  }

  return lines.join("\n") + "\n";
}

/**
 * Robustly decodes a GitHub App private key whether supplied as:
 * - A standard base64-encoded PEM string
 * - A raw PEM string (PKCS#1 or PKCS#8)
 * - An escaped string with literal `\n` characters
 * - A raw base64-encoded DER body
 */
export function decodeGithubPrivateKey(encoded?: string): string {
  if (!encoded || typeof encoded !== "string" || encoded.trim() === "") {
    return getDevFallbackPrivateKey();
  }

  let cleaned = encoded.trim();

  // Strip leading/trailing matching quotes (e.g. from .env file value exports)
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Convert literal escaped newlines "\n" or "\r\n" to actual newlines
  cleaned = cleaned.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "");

  let candidate = cleaned;

  // If the string is already a plain PEM certificate/key
  if (cleaned.includes("-----BEGIN")) {
    candidate = normalizePem(cleaned);
  } else {
    // Attempt base64 decoding
    try {
      const decoded = Buffer.from(cleaned, "base64").toString("utf8");
      const normalizedDecoded = decoded
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .trim();

      if (normalizedDecoded.includes("-----BEGIN")) {
        candidate = normalizePem(normalizedDecoded);
      } else {
        const base64Body = cleaned.replace(/\s+/g, "");
        if (/^[A-Za-z0-9+/=]+$/.test(base64Body) && base64Body.length > 100) {
          candidate = `-----BEGIN RSA PRIVATE KEY-----\n${chunkBase64(base64Body)}\n-----END RSA PRIVATE KEY-----\n`;
        }
      }
    } catch {
      // fallback
    }
  }

  // Verify that OpenSSL can actually parse the key
  try {
    createPrivateKey(candidate);
    return candidate;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[GitHub App Key Warning] The provided GITHUB_APP_PRIVATE_KEY_BASE64 cannot be parsed by OpenSSL (${errorMsg}). Using fallback key. Please ensure you have downloaded the .pem private key from your GitHub App settings (General -> Private keys -> Generate a private key) and base64-encoded it.`,
    );
    return getDevFallbackPrivateKey();
  }
}
