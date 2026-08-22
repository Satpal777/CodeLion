import { feedbackSchema, globalUsageTracker, isOpenAICompatibleConfigured } from "@reviewer/ai";
import {
  auditEvents,
  feedbackEvents,
  listActiveMemories,
  listWorkspaceRepositories,
  listWorkspaceReviews,
  memories,
  repositories,
  reviewFindings,
  reviewRuns,
  writeAuditEvent,
} from "@reviewer/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc";
import { learnFromFeedback } from "./memory-service";

const repositoryOutput = z.object({
  id: z.string().uuid(),
  owner: z.string(),
  name: z.string(),
  defaultBranch: z.string(),
  isPrivate: z.boolean(),
  enabled: z.boolean(),
  state: z.string(),
  indexedSha: z.string().nullable(),
  indexedAt: z.string().nullable(),
});

export const appRouter = router({
  health: publicProcedure
    .meta({ openapi: { method: "GET", path: "/health", tags: ["System"] } })
    .input(z.object({}))
    .output(z.object({ status: z.literal("ok"), version: z.string(), timestamp: z.string() }))
    .query(() => ({ status: "ok", version: "0.1.0", timestamp: new Date().toISOString() })),

  repository: router({
    list: protectedProcedure
      .meta({
        openapi: { method: "GET", path: "/repositories", tags: ["Repositories"], protect: true },
      })
      .input(z.object({}))
      .output(z.array(repositoryOutput))
      .query(async ({ ctx }) => {
        const rows = await listWorkspaceRepositories(ctx.database, ctx.principal.workspaceId);
        return rows.map((repository) => ({
          id: repository.id,
          owner: repository.owner,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
          isPrivate: repository.isPrivate,
          enabled: repository.enabled,
          state: repository.state,
          indexedSha: repository.indexedSha,
          indexedAt: repository.indexedAt?.toISOString() ?? null,
        }));
      }),

    setEnabled: adminProcedure
      .meta({
        openapi: {
          method: "POST",
          path: "/repositories/{repositoryId}/enabled",
          tags: ["Repositories"],
          protect: true,
        },
      })
      .input(z.object({ repositoryId: z.string().uuid(), enabled: z.boolean() }))
      .output(z.object({ id: z.string().uuid(), enabled: z.boolean(), state: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const [current] = await ctx.database
          .select()
          .from(repositories)
          .where(
            and(
              eq(repositories.id, input.repositoryId),
              eq(repositories.workspaceId, ctx.principal.workspaceId),
            ),
          )
          .limit(1);
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });
        const [updated] = await ctx.database
          .update(repositories)
          .set({
            enabled: input.enabled,
            state: input.enabled ? "indexing" : "disabled",
            settings: { ...current.settings, reviewsEnabled: input.enabled },
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(repositories.id, input.repositoryId),
              eq(repositories.workspaceId, ctx.principal.workspaceId),
            ),
          )
          .returning({ id: repositories.id, enabled: repositories.enabled, state: repositories.state });

        if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Repository update failed" });
        await writeAuditEvent(ctx.database, {
          workspaceId: ctx.principal.workspaceId,
          actorUserId: ctx.principal.user.id,
          action: input.enabled ? "repository.enabled" : "repository.disabled",
          targetType: "repository",
          targetId: updated.id,
          outcome: "success",
        });
        if (input.enabled && ctx.sendEvent) {
          await ctx.sendEvent({
            name: "reviewer/repository.index-requested",
            data: { repositoryId: updated.id, requestedByUserId: ctx.principal.user.id },
          });
        } else if (!input.enabled && ctx.sendEvent) {
          await ctx.sendEvent({
            name: "reviewer/repository.disabled",
            data: {
              repositoryId: updated.id,
              repositoryGithubId: current.githubRepositoryId,
            },
          });
        }
        return updated;
      }),

    updateSettings: adminProcedure
      .input(
        z.object({
          repositoryId: z.string().uuid(),
          settings: z.object({
            reviewsEnabled: z.boolean().optional(),
            autoReviewDrafts: z.boolean().optional(),
            minimumConfidence: z.number().min(0).max(1).optional(),
            mergeMode: z.enum(["never", "after_approval", "after_all_gates"]).optional(),
            excludedPaths: z.array(z.string()).optional(),
            customInstructions: z.array(z.string()).optional(),
          }),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [current] = await ctx.database
          .select()
          .from(repositories)
          .where(
            and(
              eq(repositories.id, input.repositoryId),
              eq(repositories.workspaceId, ctx.principal.workspaceId),
            ),
          )
          .limit(1);
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });

        const mergedSettings = {
          ...current.settings,
          ...(input.settings.reviewsEnabled !== undefined ? { reviewsEnabled: input.settings.reviewsEnabled } : {}),
          ...(input.settings.autoReviewDrafts !== undefined ? { autoReviewDrafts: input.settings.autoReviewDrafts } : {}),
          ...(input.settings.minimumConfidence !== undefined ? { minimumConfidence: input.settings.minimumConfidence } : {}),
          ...(input.settings.mergeMode !== undefined ? { mergeMode: input.settings.mergeMode } : {}),
          ...(input.settings.excludedPaths !== undefined ? { excludedPaths: input.settings.excludedPaths } : {}),
          ...(input.settings.customInstructions !== undefined ? { customInstructions: input.settings.customInstructions } : {}),
        };
        await ctx.database
          .update(repositories)
          .set({ settings: mergedSettings, updatedAt: new Date() })
          .where(eq(repositories.id, current.id));

        await writeAuditEvent(ctx.database, {
          workspaceId: ctx.principal.workspaceId,
          actorUserId: ctx.principal.user.id,
          action: "repository.settings_updated",
          targetType: "repository",
          targetId: current.id,
          outcome: "success",
          metadata: { settings: input.settings },
        });

        return { success: true, settings: mergedSettings };
      }),
  }),

  review: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().int().positive().max(100).default(50) }))
      .query(async ({ ctx, input }) => {
        const rows = await listWorkspaceReviews(ctx.database, ctx.principal.workspaceId, input.limit);
        return rows.map(({ run, repository }) => ({
          id: run.id,
          repository: `${repository.owner}/${repository.name}`,
          pullRequestNumber: run.pullRequestNumber,
          headSha: run.headSha,
          state: run.state,
          decision: run.decision,
          summary: run.summary,
          riskScore: run.riskScore,
          createdAt: run.createdAt.toISOString(),
        }));
      }),

    getFindings: protectedProcedure
      .input(z.object({ reviewRunId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        return ctx.database
          .select()
          .from(reviewFindings)
          .where(eq(reviewFindings.reviewRunId, input.reviewRunId));
      }),
  }),

  action: router({
    triggerFix: protectedProcedure
      .input(
        z.object({
          repositoryId: z.string().uuid(),
          pullRequestNumber: z.number().int().positive(),
          headSha: z.string().min(7),
          instructions: z.string().min(1),
          destination: z.enum(["stacked_pr", "existing_branch"]).default("stacked_pr"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.sendEvent) {
          await ctx.sendEvent({
            name: "reviewer/agent.fix-requested",
            data: {
              repositoryId: input.repositoryId,
              pullRequestNumber: input.pullRequestNumber,
              headSha: input.headSha,
              requesterLogin: ctx.principal.user.githubLogin,
              instructions: input.instructions,
              destination: input.destination,
            },
          });
        }
        return { queued: true, destination: input.destination };
      }),

    evaluateMerge: adminProcedure
      .input(
        z.object({
          repositoryId: z.string().uuid(),
          pullRequestNumber: z.number().int().positive(),
          headSha: z.string().min(7),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.sendEvent) {
          await ctx.sendEvent({
            name: "reviewer/pr.evaluate-merge",
            data: {
              repositoryId: input.repositoryId,
              pullRequestNumber: input.pullRequestNumber,
              headSha: input.headSha,
              triggeredBy: "user_action",
            },
          });
        }
        return { evaluationQueued: true };
      }),
  }),

  audit: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().int().positive().max(100).default(50) }))
      .query(async ({ ctx, input }) => {
        return ctx.database
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.workspaceId, ctx.principal.workspaceId))
          .orderBy(desc(auditEvents.createdAt))
          .limit(input.limit);
      }),
  }),

  usage: router({
    getMetrics: protectedProcedure.query(({ ctx }) => {
      return globalUsageTracker.getWorkspaceUsage(ctx.principal.workspaceId);
    }),
  }),

  ai: router({
    /**
     * Returns the current AI provider configuration visible to the UI.
     * Only exposes metadata — no keys are sent to the client.
     */
    config: protectedProcedure
      .output(
        z.object({
          openAICompatible: z.object({
            configured: z.boolean(),
            modelName: z.string(),
          }),
          geminiCascadeLength: z.number(),
        }),
      )
      .query(() => ({
        openAICompatible: {
          configured: isOpenAICompatibleConfigured(),
          modelName: (process.env.OPENAI_COMPATIBLE_MODEL ?? "").trim(),
        },
        geminiCascadeLength: 9, // reflects GEMINI_MODEL_CASCADE length
      })),
  }),

  feedback: router({
    submit: protectedProcedure
      .input(
        z.object({
          repositoryId: z.string().uuid(),
          reviewRunId: z.string().uuid().optional(),
          findingId: z.string().uuid().optional(),
          feedback: feedbackSchema,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [repository] = await ctx.database
          .select({ id: repositories.id })
          .from(repositories)
          .where(
            and(
              eq(repositories.id, input.repositoryId),
              eq(repositories.workspaceId, ctx.principal.workspaceId),
            ),
          )
          .limit(1);
        if (!repository) throw new TRPCError({ code: "NOT_FOUND", message: "Repository not found" });

        const [feedback] = await ctx.database
          .insert(feedbackEvents)
          .values({
            workspaceId: ctx.principal.workspaceId,
            repositoryId: repository.id,
            ...(input.reviewRunId ? { reviewRunId: input.reviewRunId } : {}),
            ...(input.findingId ? { findingId: input.findingId } : {}),
            actorUserId: ctx.principal.user.id,
            source: "dashboard",
            verdict: input.feedback.verdict,
            ...(input.feedback.rating ? { rating: input.feedback.rating } : {}),
            ...(input.feedback.comment ? { comment: input.feedback.comment } : {}),
            explicitRemember: input.feedback.explicitRemember,
          })
          .returning();
        if (!feedback) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

        const memory = await learnFromFeedback(ctx.database, {
          workspaceId: ctx.principal.workspaceId,
          repositoryId: repository.id,
          actorUserId: ctx.principal.user.id,
          actorIsAdmin: ctx.principal.role === "owner" || ctx.principal.role === "admin",
          feedbackId: feedback.id,
          feedback: input.feedback,
        });
        return {
          feedbackId: feedback.id,
          memoryCreated: Boolean(memory),
          memoryActive: memory?.status === "active",
        };
      }),
  }),

  memory: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await listActiveMemories(ctx.database, {
        workspaceId: ctx.principal.workspaceId,
        userId: ctx.principal.user.id,
      });
      return rows.map((memory) => ({
        id: memory.id,
        scope: memory.scope,
        status: memory.status,
        rule: memory.rule,
        rationale: memory.rationale,
        confidence: memory.confidence,
        evidenceCount: memory.evidenceCount,
        createdAt: memory.createdAt.toISOString(),
      }));
    }),
    delete: adminProcedure
      .input(z.object({ memoryId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const deleted = await ctx.database
          .delete(memories)
          .where(
            and(eq(memories.id, input.memoryId), eq(memories.workspaceId, ctx.principal.workspaceId)),
          )
          .returning({ id: memories.id });
        if (!deleted.length) throw new TRPCError({ code: "NOT_FOUND", message: "Memory not found" });
        return { deleted: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
