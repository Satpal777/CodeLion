import { getServerEnv } from "@reviewer/config";
import { NextResponse } from "next/server";
import { isSafeSameOriginRequest, revokeCurrentSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  if (!isSafeSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const env = getServerEnv();
  await revokeCurrentSession();
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(env.SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
