import { getServerEnv } from "@reviewer/config";
import { getDatabase, upsertGithubUser } from "@reviewer/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { issueSession } from "../../../../../lib/auth";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional().default("bearer"),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
});

const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

const emailsSchema = z.array(
  z.object({
    email: z.string(),
    primary: z.boolean().optional(),
    verified: z.boolean().optional(),
  }),
);

export async function GET(request: Request) {
  try {
    const env = getServerEnv();
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const storedState = (await cookies()).get("reviewer_oauth_state")?.value;

    if (!code || !state || !storedState || state !== storedState) {
      console.error("[OAuth Callback] State verification failed", {
        hasCode: !!code,
        hasState: !!state,
        hasStoredState: !!storedState,
        matches: state === storedState,
      });
      return NextResponse.redirect(new URL("/login?error=invalid_state", request.url));
    }

    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "CodeLion-GitHub-Reviewer",
      },
      body: JSON.stringify({
        client_id: env.GITHUB_APP_CLIENT_ID,
        client_secret: env.GITHUB_APP_CLIENT_SECRET,
        code,
        redirect_uri: `${env.APP_URL}/api/auth/github/callback`,
      }),
      cache: "no-store",
    });

    if (!tokenResponse.ok) {
      console.error("[OAuth Callback] Access token request HTTP error:", tokenResponse.status);
      return NextResponse.redirect(new URL("/login?error=oauth_exchange_failed", request.url));
    }

    const rawTokenData = (await tokenResponse.json()) as Record<string, unknown>;
    if (rawTokenData.error) {
      console.error("[OAuth Callback] GitHub OAuth error response:", rawTokenData);
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(String(rawTokenData.error))}`, request.url),
      );
    }

    const token = tokenResponseSchema.parse(rawTokenData);

    const authorization = {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "CodeLion-GitHub-Reviewer",
    };

    const [userResponse, emailResponse] = await Promise.all([
      fetch("https://api.github.com/user", { headers: authorization, cache: "no-store" }),
      fetch("https://api.github.com/user/emails", { headers: authorization, cache: "no-store" }),
    ]);

    if (!userResponse.ok) {
      console.error("[OAuth Callback] Failed to fetch GitHub user profile:", userResponse.status);
      return NextResponse.redirect(new URL("/login?error=user_fetch_failed", request.url));
    }

    const rawUserData = await userResponse.json();
    const githubUser = githubUserSchema.parse(rawUserData);

    let verifiedPrimaryEmail: string | null = null;
    if (emailResponse.ok) {
      try {
        const rawEmails = await emailResponse.json();
        const emails = emailsSchema.parse(rawEmails);
        verifiedPrimaryEmail = emails.find((e) => e.primary && e.verified)?.email ?? null;
      } catch (emailErr) {
        console.warn("[OAuth Callback] Non-fatal error parsing user emails:", emailErr);
      }
    }

    const { user } = await upsertGithubUser(getDatabase(env.DATABASE_URL), {
      githubId: String(githubUser.id),
      githubLogin: githubUser.login,
      displayName: githubUser.name ?? null,
      avatarUrl: githubUser.avatar_url ?? null,
      email: verifiedPrimaryEmail ?? githubUser.email ?? null,
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
      path: "/",
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
  } catch (error) {
    console.error("[OAuth Callback Unhandled Error]:", error);
    return NextResponse.redirect(new URL("/login?error=server_error", request.url));
  }
}
