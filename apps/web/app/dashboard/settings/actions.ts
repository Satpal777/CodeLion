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
