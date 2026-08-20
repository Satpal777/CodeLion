import { getDatabase, markOutboxPublished, workflowOutbox } from "@reviewer/db";
import { and, asc, eq, lte } from "drizzle-orm";
import { cron } from "inngest";
import { inngest } from "./client";
import { createWorkflowEvent } from "./events";

export const reconcileWorkflowOutbox = inngest.createFunction(
  {
    id: "reconcile-workflow-outbox",
    retries: 3,
    triggers: [cron("*/1 * * * *")],
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
