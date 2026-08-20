import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getServerEnv } from "@reviewer/config";
import {
  createSession,
  getDatabase,
  getSessionPrincipal,
  revokeSession,
  sessions,
  type User,
} from "@reviewer/db";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

export interface WebPrincipal {
  user: User;
  workspaceId: string;
  role: "owner" | "admin" | "maintainer" | "viewer";
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function encryptionKey(): Buffer {
  const key = Buffer.from(getServerEnv().DATA_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptCredential(envelope: string): string {
  const [version, iv, tag, ciphertext] = envelope.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid credential envelope");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function getCurrentPrincipal(): Promise<WebPrincipal | null> {
  const env = getServerEnv();
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const principal = await getSessionPrincipal(getDatabase(env.DATABASE_URL), hashSecret(token));
  if (!principal) return null;
  return {
    user: principal.user,
    workspaceId: principal.workspaceId,
    role: principal.role,
  };
}

export async function issueSession(
  userId: string,
  userAgent: string | null,
  githubToken: {
    accessToken: string;
    accessTokenExpiresAt?: Date;
    refreshToken?: string;
    refreshTokenExpiresAt?: Date;
  },
) {
  const env = getServerEnv();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1_000);
  await createSession(getDatabase(env.DATABASE_URL), {
    tokenHash: hashSecret(token),
    userId,
    expiresAt,
    ...(userAgent ? { userAgentHash: hashSecret(userAgent) } : {}),
    githubAccessTokenEncrypted: encryptCredential(githubToken.accessToken),
    ...(githubToken.accessTokenExpiresAt
      ? { githubAccessTokenExpiresAt: githubToken.accessTokenExpiresAt }
      : {}),
    ...(githubToken.refreshToken
      ? { githubRefreshTokenEncrypted: encryptCredential(githubToken.refreshToken) }
      : {}),
    ...(githubToken.refreshTokenExpiresAt
      ? { githubRefreshTokenExpiresAt: githubToken.refreshTokenExpiresAt }
      : {}),
  });
  return { token, expiresAt };
}

export async function getCurrentGithubUserToken(): Promise<string | null> {
  const env = getServerEnv();
  const rawSessionToken = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  if (!rawSessionToken) return null;
  const database = getDatabase(env.DATABASE_URL);
  const [session] = await database
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashSecret(rawSessionToken)))
    .limit(1);
  if (!session?.githubAccessTokenEncrypted || session.expiresAt <= new Date()) return null;

  const accessTokenStillValid =
    !session.githubAccessTokenExpiresAt || session.githubAccessTokenExpiresAt.getTime() > Date.now() + 60_000;
  if (accessTokenStillValid) return decryptCredential(session.githubAccessTokenEncrypted);
  if (
    !session.githubRefreshTokenEncrypted ||
    (session.githubRefreshTokenExpiresAt && session.githubRefreshTokenExpiresAt <= new Date())
  ) {
    return null;
  }

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: decryptCredential(session.githubRefreshTokenEncrypted),
    }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const refreshed = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
  };
  if (!refreshed.access_token) return null;
  const now = Date.now();
  await database
    .update(sessions)
    .set({
      githubAccessTokenEncrypted: encryptCredential(refreshed.access_token),
      githubAccessTokenExpiresAt: refreshed.expires_in
        ? new Date(now + refreshed.expires_in * 1_000)
        : null,
      githubRefreshTokenEncrypted: refreshed.refresh_token
        ? encryptCredential(refreshed.refresh_token)
        : session.githubRefreshTokenEncrypted,
      githubRefreshTokenExpiresAt: refreshed.refresh_token_expires_in
        ? new Date(now + refreshed.refresh_token_expires_in * 1_000)
        : session.githubRefreshTokenExpiresAt,
    })
    .where(eq(sessions.tokenHash, session.tokenHash));
  return refreshed.access_token;
}

export async function revokeCurrentSession() {
  const env = getServerEnv();
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  if (token) await revokeSession(getDatabase(env.DATABASE_URL), hashSecret(token));
}

export function isSafeSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
