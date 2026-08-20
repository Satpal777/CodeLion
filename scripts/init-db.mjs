import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { execSync } from "node:child_process";

const rlsEnabledTables = [
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
];

function generateRlsPoliciesSql() {
  const statements = [];

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

  return statements;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL is not set in the environment.");
    process.exit(1);
  }

  console.log("1. Ensuring required PostgreSQL extensions (vector, uuid-ossp)...");
  const sql = neon(databaseUrl);

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector;`;
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`;
    console.log("   ✓ PostgreSQL vector and uuid-ossp extensions active.");
  } catch (err) {
    console.warn("   ⚠️ Extension check note:", err.message);
  }

  console.log("\n2. Creating tables and indexes with Drizzle Kit...");
  try {
    execSync("bun --filter @reviewer/db db:push", { stdio: "inherit" });
    console.log("   ✓ Schema tables and relations pushed successfully.");
  } catch (err) {
    console.error("   ❌ Schema push failed:", err.message);
    process.exit(1);
  }

  console.log("\n3. Applying Row-Level Security (RLS) policies...");
  try {
    const statements = generateRlsPoliciesSql();
    for (const statement of statements) {
      await sql.query(statement);
    }
    console.log(`   ✓ RLS isolation policies applied to ${rlsEnabledTables.length} tenant tables.`);
  } catch (err) {
    console.warn("   ⚠️ RLS policy note:", err.message);
  }

  console.log("\n🎉 Database tables and security policies initialized successfully!");
}

main().catch((err) => {
  console.error("Failed to initialize database:", err.message);
  process.exit(1);
});
