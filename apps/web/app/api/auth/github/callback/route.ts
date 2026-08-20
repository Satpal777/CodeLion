import { getServerEnv } from "@reviewer/config";
import { getDatabase, upsertGithubUser } from "@reviewer/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { issueSession } from "../../../../../lib/auth";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
});
const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable(),
  avatar_url: z.url().nullable(),
  email: z.string().email().nullable(),
});
const emailsSchema = z.array(
  z.object({ email: z.string().email(), primary: z.boolean(), verified: z.boolean() }),
);

export async function GET(request: Request) {
  const env = getServerEnv();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = (await cookies()).get("reviewer_oauth_state")?.value;
  if (!code || !state || !storedState || state !== storedState) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      code,
      redirect_uri: `${env.APP_URL}/api/auth/github/callback`,
    }),
    cache: "no-store",
  });
  if (!tokenResponse.ok) return NextResponse.json({ error: "OAuth exchange failed" }, { status: 502 });
  const token = tokenResponseSchema.parse(await tokenResponse.json());

  const authorization = { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json" };
  const [userResponse, emailResponse] = await Promise.all([
    fetch("https://api.github.com/user", { headers: authorization, cache: "no-store" }),
    fetch("https://api.github.com/user/emails", { headers: authorization, cache: "no-store" }),
  ]);
  if (!userResponse.ok) return NextResponse.json({ error: "Unable to load GitHub identity" }, { status: 502 });

  const githubUser = githubUserSchema.parse(await userResponse.json());
  const emails = emailResponse.ok ? emailsSchema.parse(await emailResponse.json()) : [];
  const verifiedPrimary = emails.find((email) => email.primary && email.verified)?.email ?? null;
  const { user } = await upsertGithubUser(getDatabase(env.DATABASE_URL), {
    githubId: String(githubUser.id),
    githubLogin: githubUser.login,
    displayName: githubUser.name,
    avatarUrl: githubUser.avatar_url,
    email: verifiedPrimary ?? githubUser.email,
  });

  const now = Date.now();
  const session = await issueSession(user.id, request.headers.get("user-agent"), {
    accessToken: token.access_token,
    ...(token.expires_in ? { accessTokenExpiresAt: new Date(now + token.expires_in * 1_000) } : {}),
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    ...(token.refresh_token_expires_in
      ? { refreshTokenExpiresAt: new Date(now + token.refresh_token_expires_in * 1_000) }
      : {}),
  });
  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.cookies.set("reviewer_oauth_state", "", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/github/callback",
    maxAge: 0,
  });
  response.cookies.set(env.SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return response;
}
