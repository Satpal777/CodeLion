import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { Database } from "./client";
import {
  auditEvents,
  feedbackEvents,
  githubInstallations,
  memberships,
  memories,
  repositories,
  reviewRuns,
  sessions,
  users,
  webhookDeliveries,
  workflowOutbox,
  workspaces,
  type RepositorySettings,
} from "./schema";

export const defaultRepositorySettings: RepositorySettings = {
  reviewsEnabled: false,
  autoReviewDrafts: false,
  minimumConfidence: 0.78,
  mergeMode: "never",
  excludedPaths: ["**/vendor/**", "**/dist/**", "**/*.min.js", "**/generated/**"],
  customInstructions: [],
};

export interface GithubIdentity {
  githubId: string;
  githubLogin: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

export async function upsertGithubUser(database: Database, identity: GithubIdentity) {
  const [user] = await database
    .insert(users)
    .values(identity)
    .onConflictDoUpdate({
      target: users.githubId,
      set: {
        githubLogin: identity.githubLogin,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        email: identity.email,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!user) throw new Error("Unable to persist GitHub user");

  const [existingMembership] = await database
    .select({ workspaceId: memberships.workspaceId })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .limit(1);

  if (existingMembership) return { user, workspaceId: existingMembership.workspaceId };

  const slug = `${identity.githubLogin.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-${identity.githubId}`;
  const [workspace] = await database
    .insert(workspaces)
    .values({ name: `${identity.githubLogin}'s workspace`, slug, createdBy: user.id })
    .returning();
  if (!workspace) throw new Error("Unable to create workspace");

  await database.insert(memberships).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: "owner",
  });

  return { user, workspaceId: workspace.id };
}

export async function createSession(
  database: Database,
  values: typeof sessions.$inferInsert,
) {
  await database.insert(sessions).values(values);
}

export async function getSessionPrincipal(database: Database, tokenHash: string) {
  const [row] = await database
    .select({
      user: users,
      workspaceId: memberships.workspaceId,
      role: memberships.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row ?? null;
}

export async function revokeSession(database: Database, tokenHash: string) {
  await database.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function listWorkspaceRepositories(database: Database, workspaceId: string) {
  return database
    .select()
    .from(repositories)
    .where(eq(repositories.workspaceId, workspaceId))
    .orderBy(desc(repositories.updatedAt));
}

export async function listWorkspaceReviews(database: Database, workspaceId: string, limit = 50) {
  return database
    .select({ run: reviewRuns, repository: repositories })
    .from(reviewRuns)
    .innerJoin(repositories, eq(reviewRuns.repositoryId, repositories.id))
    .where(eq(repositories.workspaceId, workspaceId))
    .orderBy(desc(reviewRuns.createdAt))
    .limit(Math.min(limit, 100));
}

export async function listActiveMemories(
  database: Database,
  values: { workspaceId: string; repositoryId?: string; userId?: string },
) {
  return database
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.workspaceId, values.workspaceId),
        eq(memories.status, "active"),
        values.repositoryId
          ? or(isNull(memories.repositoryId), eq(memories.repositoryId, values.repositoryId))
          : isNull(memories.repositoryId),
        values.userId
          ? or(isNull(memories.ownerUserId), eq(memories.ownerUserId, values.userId))
          : isNull(memories.ownerUserId),
      ),
    )
    .orderBy(desc(memories.confidence));
}

export async function recordWebhookDelivery(
  database: Database,
  values: typeof webhookDeliveries.$inferInsert,
) {
  const rows = await database
    .insert(webhookDeliveries)
    .values(values)
    .onConflictDoNothing({ target: webhookDeliveries.deliveryId })
    .returning({ deliveryId: webhookDeliveries.deliveryId });
  return rows.length === 1;
}

export async function recordWebhookDeliveryWithOutbox(
  database: Database,
  values: {
    delivery: typeof webhookDeliveries.$inferInsert;
    event: { id: string; name: string; data: Record<string, unknown> };
  },
) {
  const [deliveryRows, outboxRows] = await database.batch([
    database
      .insert(webhookDeliveries)
      .values(values.delivery)
      .onConflictDoNothing({ target: webhookDeliveries.deliveryId })
      .returning({ deliveryId: webhookDeliveries.deliveryId }),
    database
      .insert(workflowOutbox)
      .values({
        eventId: values.event.id,
        deliveryId: values.delivery.deliveryId,
        eventName: values.event.name,
        eventData: values.event.data,
      })
      .onConflictDoNothing({ target: workflowOutbox.eventId })
      .returning({ id: workflowOutbox.id }),
  ]);
  return { accepted: deliveryRows.length === 1, outboxId: outboxRows[0]?.id ?? null };
}

export async function markOutboxPublished(database: Database, eventId: string) {
  await database
    .update(workflowOutbox)
    .set({ status: "published", publishedAt: new Date(), lastError: null })
    .where(eq(workflowOutbox.eventId, eventId));
}

export async function upsertInstallation(
  database: Database,
  values: typeof githubInstallations.$inferInsert,
) {
  const inserted = await database
    .insert(githubInstallations)
    .values(values)
    .onConflictDoNothing({ target: githubInstallations.installationId })
    .returning();
  if (inserted[0]) return inserted[0];

  const [existing] = await database
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, values.installationId))
    .limit(1);
  if (!existing) throw new Error("Unable to persist GitHub installation");
  if (existing.workspaceId !== values.workspaceId) {
    throw new Error("GitHub installation is already bound to another workspace");
  }

  const [updated] = await database
    .update(githubInstallations)
    .set({
      accountId: values.accountId,
      accountLogin: values.accountLogin,
      accountType: values.accountType,
      repositorySelection: values.repositorySelection,
      suspendedAt: values.suspendedAt ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(githubInstallations.installationId, values.installationId),
        eq(githubInstallations.workspaceId, values.workspaceId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Unable to update GitHub installation");
  return updated;
}

export async function writeAuditEvent(database: Database, event: typeof auditEvents.$inferInsert) {
  await database.insert(auditEvents).values(event);
}

export async function recordFeedback(database: Database, event: typeof feedbackEvents.$inferInsert) {
  const [feedback] = await database.insert(feedbackEvents).values(event).returning();
  if (!feedback) throw new Error("Unable to persist feedback");
  return feedback;
}
