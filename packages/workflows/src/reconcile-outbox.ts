import "dotenv/config";
import { getDatabase, markOutboxPublished, workflowOutbox } from "@reviewer/db";
import { and, asc, eq, lte } from "drizzle-orm";
import { cron } from "inngest";
import { inngest } from "./client";
import { createWorkflowEvent } from "./events";

// Defaults to every 6 hours; override with RECONCILE_OUTBOX_CRON env var.
// Examples:
//   "*/1 * * * *"   — every minute (dev)
//   "*/15 * * * *"  — every 15 minutes
//   "0 */6 * * *"   — every 6 hours (production default)
//   "0 */1 * * *"   — every hour
const outboxCron = process.env.RECONCILE_OUTBOX_CRON ?? "0 */6 * * *";

export const reconcileWorkflowOutbox = inngest.createFunction(
  {
    id: "reconcile-workflow-outbox",
    retries: 3,
    triggers: [cron(outboxCron)],
  },
  async ({ step }) => {
    const database = getDatabase();
    const pending = await step.run("load-pending-events", () =>
      database
        .select({
          eventId: workflowOutbox.eventId,
          eventName: workflowOutbox.eventName,
          eventData: workflowOutbox.eventData,
        })
        .from(workflowOutbox)
        .where(
          and(eq(workflowOutbox.status, "pending"), lte(workflowOutbox.nextAttemptAt, new Date())),
        )
        .orderBy(asc(workflowOutbox.createdAt))
        .limit(50),
    );
    if (!pending.length) return { published: 0 };

    await step.sendEvent(
      "publish-pending-events",
      pending.map((event) => createWorkflowEvent(event.eventName, event.eventData, event.eventId as any)),
    );
    await step.run("mark-events-published", async () => {
      await Promise.all(pending.map((event) => markOutboxPublished(database, event.eventId)));
    });
    return { published: pending.length };
  },
);
