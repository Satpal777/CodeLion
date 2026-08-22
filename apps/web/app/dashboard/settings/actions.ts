"use server";

import { getServerEnv } from "@reviewer/config";
import { getDatabase, users, workspaces } from "@reviewer/db";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentPrincipal } from "../../../lib/auth";

export async function deleteAccount(formData: FormData) {
  const principal = await getCurrentPrincipal();
  if (!principal || principal.role !== "owner") throw new Error("Workspace owner required");
  if (formData.get("confirmation") !== principal.user.githubLogin) {
    throw new Error("Confirmation does not match the GitHub login");
  }
  const database = getDatabase();
  await database.delete(workspaces).where(eq(workspaces.id, principal.workspaceId));
  await database.delete(users).where(eq(users.id, principal.user.id));
  const env = getServerEnv();
  (await cookies()).set(env.SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  redirect("/");
}

/** Cookie name that persists the user's preferred AI provider. */
export const AI_PROVIDER_COOKIE = "ai_provider_preference";

/**
 * Persists the selected AI provider in a cookie so server-side AI calls
 * can honour the user's choice.  Only "openai-compatible" is valid when
 * the env vars are configured; every other value resets to Gemini.
 */
export async function setAIProvider(provider: "gemini" | "openai-compatible") {
  const principal = await getCurrentPrincipal();
  if (!principal) throw new Error("Unauthorized");

  const env = getServerEnv();
  const jar = await cookies();

  if (provider === "openai-compatible") {
    jar.set(AI_PROVIDER_COOKIE, "openai-compatible", {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  } else {
    jar.delete(AI_PROVIDER_COOKIE);
  }
}

/**
 * Reads the current provider preference from the request cookie jar.
 * Returns "openai-compatible" only when the cookie is set AND the env
 * vars are actually present; otherwise returns "gemini".
 */
export async function getAIProviderPreference(): Promise<"gemini" | "openai-compatible"> {
  const jar = await cookies();
  const value = jar.get(AI_PROVIDER_COOKIE)?.value;
  if (value === "openai-compatible") return "openai-compatible";
  return "gemini";
}

