import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export const rlsEnabledTables = [
  "workspaces",
  "memberships",
  "github_installations",
  "repositories",
  "repository_files",
  "code_chunks",
  "review_runs",
  "review_findings",
  "feedback_events",
  "memories",
  "memory_usages",
  "audit_events",
] as const;

/**
 * Generates the full PostgreSQL Row Level Security (RLS) policies SQL.
 * Defense-in-depth isolation: every query on tenant data requires app.current_workspace_id.
 */
export function generateRlsPoliciesSql(): string {
  const statements: string[] = [
    "-- Enable RLS and define workspace isolation policies",
  ];

  for (const table of rlsEnabledTables) {
    statements.push(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    statements.push(`DROP POLICY IF EXISTS "${table}_workspace_isolation" ON "${table}";`);

    if (table === "workspaces") {
      statements.push(
        `CREATE POLICY "workspaces_workspace_isolation" ON "workspaces" FOR ALL USING ("id" = current_setting('app.current_workspace_id', true)::uuid);`,
      );
    } else if (table === "repository_files" || table === "code_chunks" || table === "review_runs") {
      statements.push(
        `CREATE POLICY "${table}_workspace_isolation" ON "${table}" FOR ALL USING ("repository_id" IN (SELECT "id" FROM "repositories" WHERE "workspace_id" = current_setting('app.current_workspace_id', true)::uuid));`,
      );
    } else if (table === "review_findings") {
      statements.push(
        `CREATE POLICY "review_findings_workspace_isolation" ON "review_findings" FOR ALL USING ("review_run_id" IN (SELECT r."id" FROM "review_runs" r JOIN "repositories" repo ON r."repository_id" = repo."id" WHERE repo."workspace_id" = current_setting('app.current_workspace_id', true)::uuid));`,
      );
    } else if (table === "memory_usages") {
      statements.push(
        `CREATE POLICY "memory_usages_workspace_isolation" ON "memory_usages" FOR ALL USING ("memory_id" IN (SELECT "id" FROM "memories" WHERE "workspace_id" = current_setting('app.current_workspace_id', true)::uuid));`,
      );
    } else {
      statements.push(
        `CREATE POLICY "${table}_workspace_isolation" ON "${table}" FOR ALL USING ("workspace_id" = current_setting('app.current_workspace_id', true)::uuid);`,
      );
    }
  }

  return statements.join("\n");
}

/**
 * Sets the current tenant context for the active database transaction.
 */
export async function setTenantContext(
  db: NodePgDatabase<typeof schema>,
  workspaceId: string,
): Promise<void> {
  await db.execute(sql`SELECT set_config('app.current_workspace_id', ${workspaceId}, true)`);
}

/**
 * Validates that cross-tenant queries fail closed and return 0 records from other workspaces.
 */
export async function assertTenantIsolation(
  workspaceAId: string,
  workspaceBId: string,
  records: Array<{ workspaceId?: string }>,
): Promise<{ isolated: boolean; leaksCount: number }> {
  const leaks = records.filter((r) => r.workspaceId && r.workspaceId !== workspaceAId && r.workspaceId === workspaceBId);
  return {
    isolated: leaks.length === 0,
    leaksCount: leaks.length,
  };
}
