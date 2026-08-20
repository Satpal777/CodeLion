# -----------------------------------------------------------------------------
# Stage 1: Base image with pnpm enabled
# -----------------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@latest --activate

# -----------------------------------------------------------------------------
# Stage 2: Prune workspace with Turbo for @reviewer/web
# -----------------------------------------------------------------------------
FROM base AS pruner
WORKDIR /app
RUN pnpm install -g turbo
COPY . .
RUN turbo prune @reviewer/web --docker

# -----------------------------------------------------------------------------
# Stage 3: Install dependencies & build
# -----------------------------------------------------------------------------
FROM base AS installer
WORKDIR /app

# First copy dependency manifests from pruned output for layer caching
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml

RUN pnpm install --frozen-lockfile

# Copy full source code from pruned output
COPY --from=pruner /app/out/full/ .

# Build all dependencies and Next.js standalone application
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm build

# -----------------------------------------------------------------------------
# Stage 4: Production Runner
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy Next.js standalone build and static assets
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=installer --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Ensure public folder is available
RUN mkdir -p ./apps/web/public && chown -R nextjs:nodejs ./apps/web/public

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
