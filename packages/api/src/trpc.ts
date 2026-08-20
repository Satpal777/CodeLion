import { initTRPC, TRPCError } from "@trpc/server";
import type { OpenApiMeta } from "trpc-to-openapi";
import type { TRPCContext } from "./context";

const t = initTRPC.context<TRPCContext>().meta<OpenApiMeta>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.principal) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
  }
  return next({ ctx: { ...ctx, principal: ctx.principal } });
});

export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.principal.role !== "owner" && ctx.principal.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Workspace administrator required" });
  }
  return next({ ctx });
});
