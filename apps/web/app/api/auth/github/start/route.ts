import { getServerEnv } from "@reviewer/config";
import { NextResponse } from "next/server";
import { randomToken } from "../../../../../lib/auth";

export async function GET(request: Request) {
  const env = getServerEnv();
  const state = randomToken();
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_APP_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", `${env.APP_URL}/api/auth/github/callback`);
  authorize.searchParams.set("state", state);

  const response = NextResponse.redirect(authorize);
  response.cookies.set("reviewer_oauth_state", state, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}
