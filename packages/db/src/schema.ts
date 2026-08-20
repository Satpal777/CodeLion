import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "maintainer", "viewer"]);
export const repositoryState = pgEnum("repository_state", [
  "pending",
  "indexing",
  "ready",
  "degraded",
  "disabled",
]);
export const reviewState = pgEnum("review_state", [
  "queued",
  "running",
  "completed",
  "failed",
  "superseded",
]);
export const reviewDecision = pgEnum("review_decision", [
  "approve",
  "comment",
  "request_changes",
  "skipped",
]);
export const findingSeverity = pgEnum("finding_severity", [
  "critical",
  "high",
  "medium",
  "low",
  "nit",
]);
export const memoryScope = pgEnum("memory_scope", [
  "user",
  "repository",
  "workspace",
  "organization",
]);
export const memoryStatus = pgEnum("memory_status", ["candidate", "active", "rejected", "archived"]);

export interface RepositorySettings {
  reviewsEnabled: boolean;
  autoReviewDrafts: boolean;
  minimumConfidence: number;
  mergeMode: "never" | "after_approval" | "after_all_gates";
  excludedPaths: string[];
  customInstructions: string[];
}

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubId: text("github_id").notNull(),
    githubLogin: text("github_login").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_github_id_unique").on(table.githubId)],
);

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgentHash: text("user_agent_hash"),
    githubAccessTokenEncrypted: text("github_access_token_encrypted"),
    githubAccessTokenExpiresAt: timestamp("github_access_token_expires_at", { withTimezone: true }),
    githubRefreshTokenEncrypted: text("github_refresh_token_encrypted"),
    githubRefreshTokenExpiresAt: timestamp("github_refresh_token_expires_at", { withTimezone: true }),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId), index("sessions_expiry_idx").on(table.expiresAt)],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("workspaces_slug_unique").on(table.slug)],
);

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRole("role").notNull().default("maintainer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("memberships_user_id_idx").on(table.userId),
  ],
);

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    accountId: text("account_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull(),
    repositorySelection: text("repository_selection").notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("github_installations_external_id_unique").on(table.installationId),
    index("github_installations_workspace_idx").on(table.workspaceId),
  ],
);

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => githubInstallations.id, { onDelete: "cascade" }),
    githubRepositoryId: text("github_repository_id").notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    isPrivate: boolean("is_private").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    state: repositoryState("state").notNull().default("pending"),
    indexedSha: text("indexed_sha"),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),
    settings: jsonb("settings").$type<RepositorySettings>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("repositories_github_id_unique").on(table.githubRepositoryId),
    index("repositories_workspace_idx").on(table.workspaceId),
    index("repositories_installation_idx").on(table.installationId),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(),
    eventName: text("event_name").notNull(),
    action: text("action"),
    installationId: bigint("installation_id", { mode: "number" }),
    repositoryId: text("repository_id"),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").notNull().default("accepted"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    errorCode: text("error_code"),
  },
  (table) => [index("webhook_deliveries_received_idx").on(table.receivedAt)],
);

export const workflowOutbox = pgTable(
  "workflow_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id").notNull(),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => webhookDeliveries.deliveryId, { onDelete: "cascade" }),
    eventName: text("event_name").notNull(),
    eventData: jsonb("event_data").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_outbox_event_id_unique").on(table.eventId),
    uniqueIndex("workflow_outbox_delivery_unique").on(table.deliveryId),
    index("workflow_outbox_pending_idx").on(table.status, table.nextAttemptAt),
  ],
);

export const repositoryFiles = pgTable(
  "repository_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    blobSha: text("blob_sha").notNull(),
    language: text("language").notNull(),
    byteSize: integer("byte_size").notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("repository_files_repo_path_unique").on(table.repositoryId, table.path),
    index("repository_files_sha_idx").on(table.repositoryId, table.blobSha),
  ],
);

export const codeChunks = pgTable(
  "code_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => repositoryFiles.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    symbol: text("symbol"),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("code_chunks_content_unique").on(table.repositoryId, table.path, table.contentHash),
    index("code_chunks_repo_path_idx").on(table.repositoryId, table.path),
  ],
);

export const reviewRuns = pgTable(
  "review_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    pullRequestNumber: integer("pull_request_number").notNull(),
    headSha: text("head_sha").notNull(),
    baseSha: text("base_sha").notNull(),
    state: reviewState("state").notNull().default("queued"),
    decision: reviewDecision("decision"),
    model: text("model"),
    summary: text("summary"),
    riskScore: real("risk_score"),
    githubReviewId: text("github_review_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("review_runs_head_unique").on(table.repositoryId, table.pullRequestNumber, table.headSha),
    index("review_runs_repo_created_idx").on(table.repositoryId, table.createdAt),
  ],
);

export const reviewFindings = pgTable(
  "review_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewRunId: uuid("review_run_id")
      .notNull()
      .references(() => reviewRuns.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    severity: findingSeverity("severity").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    path: text("path"),
    line: integer("line"),
    side: text("side"),
    confidence: real("confidence").notNull(),
    suggestedPatch: text("suggested_patch"),
    publishedInline: boolean("published_inline").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("review_findings_fingerprint_unique").on(table.reviewRunId, table.fingerprint),
    index("review_findings_review_idx").on(table.reviewRunId),
  ],
);

export const feedbackEvents = pgTable(
  "feedback_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repositoryId: uuid("repository_id").references(() => repositories.id, { onDelete: "cascade" }),
    reviewRunId: uuid("review_run_id").references(() => reviewRuns.id, { onDelete: "set null" }),
    findingId: uuid("finding_id").references(() => reviewFindings.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    source: text("source").notNull(),
    verdict: text("verdict").notNull(),
    rating: integer("rating"),
    comment: text("comment"),
    explicitRemember: boolean("explicit_remember").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("feedback_events_repo_created_idx").on(table.repositoryId, table.createdAt),
    index("feedback_events_finding_idx").on(table.findingId),
  ],
);

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repositoryId: uuid("repository_id").references(() => repositories.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    scope: memoryScope("scope").notNull(),
    status: memoryStatus("status").notNull().default("candidate"),
    fingerprint: text("fingerprint").notNull(),
    rule: text("rule").notNull(),
    rationale: text("rationale").notNull(),
    evidenceCount: integer("evidence_count").notNull().default(1),
    confidence: real("confidence").notNull(),
    sourceFeedbackId: uuid("source_feedback_id").references(() => feedbackEvents.id, {
      onDelete: "set null",
    }),
    promotedBy: uuid("promoted_by").references(() => users.id, { onDelete: "set null" }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("memories_scope_lookup_idx").on(
      table.workspaceId,
      table.repositoryId,
      table.ownerUserId,
      table.status,
    ),
    index("memories_fingerprint_idx").on(table.workspaceId, table.fingerprint),
  ],
);

export const memoryUsages = pgTable(
  "memory_usages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    reviewRunId: uuid("review_run_id")
      .notNull()
      .references(() => reviewRuns.id, { onDelete: "cascade" }),
    effect: text("effect").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("memory_usages_unique").on(table.memoryId, table.reviewRunId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    outcome: text("outcome").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_events_workspace_created_idx").on(table.workspaceId, table.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Repository = typeof repositories.$inferSelect;
export type ReviewRun = typeof reviewRuns.$inferSelect;
export type Memory = typeof memories.$inferSelect;
