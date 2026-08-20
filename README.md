# Self-learning GitHub reviewer

A security-first, multi-tenant GitHub App that indexes repositories, reviews pull requests with repository context, learns scoped preferences from explicit feedback, and exposes both tRPC and OpenAPI interfaces.

The implementation uses Turborepo, Next.js, shadcn-style components, Lucide icons, tRPC, `trpc-to-openapi`, Neon Postgres, Octokit, the Vercel AI SDK, and Inngest.

Start with [manual.md](./manual.md). Product scope and design decisions live in [plan.md](./plan.md).

## Workspace

- `apps/web` — dashboard, OAuth, GitHub webhooks, tRPC/OpenAPI and Inngest handlers
- `packages/api` — typed application API
- `packages/ai` — indexing/retrieval adapters, structured review and memory policy
- `packages/config` — validated server configuration
- `packages/db` — Drizzle schema and persistence helpers
- `packages/github` — GitHub App boundary and webhook verification
- `packages/workflows` — durable Inngest orchestration

## Commands

```bash
bun install
bun db:push
bun dev
bun test
bun typecheck
```

This repository is an executable foundation for the single-release plan. Any incomplete production capability is called out explicitly in `manual.md`; unsafe GitHub write actions are never silently simulated.
