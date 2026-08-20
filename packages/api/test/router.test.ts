import { describe, expect, it } from "vitest";
import { appRouter } from "../src/router";

describe("tRPC and OpenAPI AppRouter", () => {
  it("defines health check procedure", async () => {
    const caller = appRouter.createCaller({
      database: {} as any,
      principal: {
        user: { id: "u1", githubLogin: "alice", displayName: "Alice" },
        workspaceId: "w1",
        role: "owner",
      },
    });

    const result = await caller.health({});
    expect(result.status).toBe("ok");
    expect(result.version).toBe("0.1.0");
    expect(result.timestamp).toBeTruthy();
  });

  it("exposes all required router domains", () => {
    expect(appRouter._def.procedures.health).toBeDefined();
    expect(appRouter._def.procedures["repository.list"]).toBeDefined();
    expect(appRouter._def.procedures["repository.setEnabled"]).toBeDefined();
    expect(appRouter._def.procedures["repository.updateSettings"]).toBeDefined();
    expect(appRouter._def.procedures["review.list"]).toBeDefined();
    expect(appRouter._def.procedures["review.getFindings"]).toBeDefined();
    expect(appRouter._def.procedures["action.triggerFix"]).toBeDefined();
    expect(appRouter._def.procedures["action.evaluateMerge"]).toBeDefined();
    expect(appRouter._def.procedures["audit.list"]).toBeDefined();
    expect(appRouter._def.procedures["usage.getMetrics"]).toBeDefined();
    expect(appRouter._def.procedures["feedback.submit"]).toBeDefined();
    expect(appRouter._def.procedures["memory.list"]).toBeDefined();
    expect(appRouter._def.procedures["memory.delete"]).toBeDefined();
  });
});
