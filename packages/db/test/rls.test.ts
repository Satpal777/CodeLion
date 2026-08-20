import { describe, expect, it } from "vitest";
import { assertTenantIsolation, generateRlsPoliciesSql, rlsEnabledTables } from "../src/rls";

describe("Database Row-Level Security (RLS) & Tenant Isolation", () => {
  it("defines RLS policies for all tenant-scoped tables", () => {
    const sql = generateRlsPoliciesSql();
    expect(sql).toContain("ALTER TABLE \"workspaces\" ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE \"repositories\" ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE \"code_chunks\" ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE \"review_runs\" ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE \"memories\" ENABLE ROW LEVEL SECURITY;");
    expect(rlsEnabledTables.length).toBeGreaterThanOrEqual(10);
  });

  it("asserts zero leakage across workspace boundaries", async () => {
    const wsA = "11111111-1111-1111-1111-111111111111";
    const wsB = "22222222-2222-2222-2222-222222222222";

    const recordsValid = [
      { id: "1", workspaceId: wsA },
      { id: "2", workspaceId: wsA },
    ];
    const checkValid = await assertTenantIsolation(wsA, wsB, recordsValid);
    expect(checkValid.isolated).toBe(true);
    expect(checkValid.leaksCount).toBe(0);

    const recordsLeaked = [
      { id: "1", workspaceId: wsA },
      { id: "2", workspaceId: wsB },
    ];
    const checkLeaked = await assertTenantIsolation(wsA, wsB, recordsLeaked);
    expect(checkLeaked.isolated).toBe(false);
    expect(checkLeaked.leaksCount).toBe(1);
  });
});
