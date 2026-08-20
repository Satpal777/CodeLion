import { getServerEnv } from "@reviewer/config";
import { NextResponse } from "next/server";
import { getCurrentPrincipal, randomToken } from "../../../../lib/auth";

export async function GET(request: Request) {
  const principal = await getCurrentPrincipal();
  if (!principal) return NextResponse.redirect(new URL("/login", request.url));
  if (principal.role !== "owner" && principal.role !== "admin") {
    return NextResponse.json({ error: "Workspace administrator required" }, { status: 403 });
  }
  const env = getServerEnv();
  const state = randomToken();
  const target = new URL(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`);
  target.searchParams.set("state", state);

  const response = NextResponse.redirect(target);
  response.cookies.set("reviewer_install_state", state, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/github/setup",
    maxAge: 15 * 60,
  });
  return response;
}
