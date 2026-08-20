import type { TRPCContext } from "@reviewer/api";
import { getServerEnv } from "@reviewer/config";
import { getDatabase } from "@reviewer/db";
import { createWorkflowEvent, inngest } from "@reviewer/workflows";
import { getCurrentPrincipal } from "./auth";

export async function createTRPCContext(): Promise<TRPCContext> {
  const env = getServerEnv();
  const principal = await getCurrentPrincipal();
  return {
    database: getDatabase(env.DATABASE_URL),
    principal,
    requestId: crypto.randomUUID(),
    sendEvent: async (event) => {
      await inngest.send(createWorkflowEvent(event.name, event.data));
    },
  };
}
