"use server";

import { getDatabase, memories, writeAuditEvent } from "@reviewer/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentPrincipal } from "../../../lib/auth";

export async function deleteMemory(formData: FormData) {
  const principal = await getCurrentPrincipal();
  if (!principal || (principal.role !== "owner" && principal.role !== "admin")) {
    throw new Error("Workspace administrator required");
  }
  const memoryId = z.uuid().parse(formData.get("memoryId"));
  const deleted = await getDatabase()
    .delete(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.workspaceId, principal.workspaceId)))
    .returning({ id: memories.id });
  if (!deleted.length) throw new Error("Memory not found");
  await writeAuditEvent(getDatabase(), {
    workspaceId: principal.workspaceId,
    actorUserId: principal.user.id,
    action: "memory.deleted",
    targetType: "memory",
    targetId: memoryId,
    outcome: "success",
  });
  revalidatePath("/dashboard/memory");
}
