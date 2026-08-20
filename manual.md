# Self-learning Reviewer — setup and operations manual

This manual is the source of truth for running the repository locally and deploying it. Keep it updated whenever an environment variable, permission, command, workflow, or operational dependency changes.

## 1. Current implementation status

The repository currently provides the first secure, runnable vertical slice from `plan.md`:

| Capability | Status |
| --- | --- |
| Turborepo and shared TypeScript configuration | Implemented |
| Next.js landing page and authenticated dashboard | Implemented |
| GitHub App user authorization with encrypted user tokens and hashed sessions | Implemented |
| GitHub App installation and accessible repository discovery | Implemented |
| Repository enable/disable controls | Implemented |
| Major-language detection and bounded source chunking | Implemented |
| Initial and manually triggered repository indexing | Implemented |
| Signed, deduplicated GitHub webhook receiver | Implemented |
| Transactional webhook inbox/outbox and scheduled event reconciliation | Implemented |
| Durable Inngest indexing, sync, and review workflows | Implemented |
| Structured AI review with diff-line validation | Implemented |
| Idempotent GitHub review publishing | Implemented |
| tRPC API, OpenAPI adapter, generated specification and docs page | Implemented |
| Feedback API and scoped memory promotion policy | Implemented |
| Memory visibility and deletion UI | Implemented |
| Full workspace/account data deletion UI | Implemented |
| PR chat, feedback commands in GitHub, fix branches, draft PR creation | Planned next |
| Automated guarded merging and full check-suite policy | Planned next; intentionally disabled |
| Hybrid vector/lexical retrieval and Tree-sitter symbol graphs | Planned next; schema and adapter boundary exist |
| Executor GitHub App for write-to-code actions | Planned next; no unsafe substitute is present |

The current application never pretends to perform an unimplemented write action. Review publishing is the only GitHub mutation in the Reviewer App path.

## 2. Prerequisites

- Node.js 24 or newer (or Bun runtime)
- Bun 1.2 or newer
- A Neon Postgres project
- A GitHub App with user authorization for sign-in, repository access, and review publishing
- A Vercel AI Gateway key usable by the configured models
- An Inngest account for deployment; the local Inngest Dev Server is sufficient for development

Check local versions:

```bash
bun --version
```

## 3. Install the workspace

From the repository root:

```bash
bun install
cp .env.example .env.local
```

If package installation receives a registry `403`, the network or registry mirror running the command is blocking npm. Use an environment that permits `https://registry.npmjs.org`, then rerun `bun install`. No private package registry is required.

## 4. Create the Neon database

1. Create a Neon project and database.
2. Copy the pooled connection string into `DATABASE_URL` in `.env.local`.
3. In the Neon SQL editor, enable pgvector before Drizzle creates `vector(1536)` columns:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

4. Apply the schema:

```bash
bun db:push
```

For a production release, generate and review a migration instead of using schema push:

```bash
bun db:generate
```

Commit the generated migration and apply it through the deployment pipeline. Never run unreviewed schema push against production.

## 5. Configure GitHub App user authorization for login

Create the Reviewer GitHub App under **Settings → Developer settings → GitHub Apps**. The same GitHub App provides user authorization for product identity and installation tokens for repository access; those two kinds of authority remain separate in code.

Use these values for local development:

| GitHub field | Value |
| --- | --- |
| GitHub App name | Reviewer Local |
| Homepage URL | `http://localhost:3000` |
| User authorization callback URL | `http://localhost:3000/api/auth/github/callback` |

Copy the GitHub App client ID and client secret to:

```dotenv
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
```

Enable expiring user-to-server access tokens. The access and refresh tokens are envelope-encrypted with `DATA_ENCRYPTION_KEY` inside the server session. They are used to verify that the acting user can access an installation and to compute the user/installation repository intersection. They are never used to publish reviews or index source code; those operations use short-lived installation tokens.

Grant the GitHub App the **Email addresses: read** user permission if verified email display is required. Product identity still works when no email address is returned.

## 6. Configure the GitHub Reviewer App

Continue configuring the same Reviewer GitHub App created in the previous section.

### URLs

| GitHub field | Local value |
| --- | --- |
| Homepage URL | `http://localhost:3000` |
| Setup URL | `http://localhost:3000/api/github/setup` |
| Webhook URL | A public tunnel URL ending in `/api/github/webhooks` |
| User authorization callback URL | `http://localhost:3000/api/auth/github/callback` |

Enable **Redirect on update** for the Setup URL. During local development, expose port 3000 with a trusted HTTPS tunnel and use that public origin for the webhook URL. The OAuth callback remains the exact origin configured in `APP_URL`.

### Repository permissions

Grant only these permissions to the Reviewer App:

| Permission | Level | Why |
| --- | --- | --- |
| Metadata | Read | Required by GitHub Apps |
| Contents | Read | Index repository code and retrieve context |
| Pull requests | Read and write | Read diffs and publish reviews/inline comments |
| Issues | Read and write | Read and reply to pull request conversation comments |
| Checks | Read | Evaluate required checks before a future guarded merge |
| Commit statuses | Read | Evaluate status contexts before a future guarded merge |

Do not grant `Contents: write` to this app. The later fix-branch feature must use a separate optional Executor App with explicit consent and stronger policy controls.

### Webhook events

Subscribe to:

- Pull request
- Pull request review
- Pull request review comment
- Issue comment
- Push
- Installation
- Installation repositories
- Check run
- Check suite
- Status

The current receiver processes pull-request and push signals and safely queues versioned issue-comment events for the upcoming authorized chat handler. Installation repository selection changes return through the configured Setup URL and refresh the accessible repository list. Subscribing to the remaining launch events now avoids an installation permission migration later.

### Secrets and private key

Generate a webhook secret with at least 32 random bytes and set:

```dotenv
GITHUB_APP_ID=...
GITHUB_APP_SLUG=...
GITHUB_WEBHOOK_SECRET=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
```

Download the GitHub App private key. Store it as a single-line base64 value rather than placing multiline PEM text in an environment file:

```bash
base64 < reviewer-app.private-key.pem | tr -d '\n'
```

Copy the output to:

```dotenv
GITHUB_APP_PRIVATE_KEY_BASE64=...
```

Never commit `.env.local`, the original PEM file, webhook secrets, OAuth secrets, installation tokens, or AI credentials.

## 7. Configure the Vercel AI SDK

Create a Vercel AI Gateway key and set:

```dotenv
AI_GATEWAY_API_KEY=...
AI_REVIEW_MODEL=openai/gpt-5.4
AI_SUMMARY_MODEL=openai/gpt-5.4-mini
AI_EMBEDDING_MODEL=openai/text-embedding-3-small
```

`packages/ai` uses schema-constrained output. Repository code, diffs, PR text, and retrieved chunks are always placed inside an explicitly untrusted prompt boundary. Repository content cannot redefine system policy.

Model changes are configuration changes and should be evaluated against the review test corpus before production rollout. Do not silently fall back to a weaker model after an authentication or quota failure.

## 8. Configure Inngest

For local development, keep:

```dotenv
INNGEST_DEV=1
```

Start the application in one terminal:

```bash
bun dev
```

Root scripts load the root `.env.local` through `dotenv-cli` before Turborepo starts package tasks. Do not duplicate secrets into package directories.

Start the Inngest Dev Server in another terminal:

```bash
bunx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

The Inngest dashboard normally opens at `http://localhost:8288`. Confirm these functions are registered:

- `index-repository`
- `sync-repository`
- `review-pull-request`
- `reconcile-workflow-outbox`

For deployment, set the production Inngest event key and signing key:

```dotenv
INNGEST_DEV=0
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=...
```

Inngest events carry identifiers and immutable SHAs, not raw repository source or complete webhook payloads. Functions re-fetch authorized data at execution time.

## 9. Complete environment reference

Start from `.env.example`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_URL` | Yes | Exact public application origin; no trailing slash |
| `NODE_ENV` | Yes | `development`, `test`, or `production` |
| `DATABASE_URL` | Yes | Neon pooled Postgres URL with TLS |
| `SESSION_COOKIE_NAME` | Yes | HttpOnly login cookie name |
| `SESSION_TTL_DAYS` | Yes | Server session lifetime, maximum 90 days |
| `DATA_ENCRYPTION_KEY` | Reserved | Envelope encryption key for later stored executor credentials |
| `GITHUB_APP_ID` | Yes | Reviewer GitHub App numeric ID |
| `GITHUB_APP_SLUG` | Yes | Used to construct the installation URL |
| `GITHUB_APP_CLIENT_ID` | Yes | Reviewer App user authorization |
| `GITHUB_APP_CLIENT_SECRET` | Yes | Reviewer App user authorization and token refresh |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | Yes | Base64-encoded PEM private key |
| `GITHUB_WEBHOOK_SECRET` | Yes | Validates `X-Hub-Signature-256` |
| `AI_GATEWAY_API_KEY` | Yes | Vercel AI Gateway authentication |
| `AI_REVIEW_MODEL` | Yes | Structured review model ID |
| `AI_SUMMARY_MODEL` | Yes | Reserved lower-cost summary/chat model ID |
| `AI_EMBEDDING_MODEL` | Yes | Reserved for the hybrid retrieval upgrade |
| `INNGEST_DEV` | Yes | Local dev-server mode flag |
| `INNGEST_EVENT_KEY` | Production | Inngest event publishing key |
| `INNGEST_SIGNING_KEY` | Production | Verifies production function invocations |
| `MAX_INDEX_FILE_BYTES` | Yes | Rejects oversized files during indexing |
| `MAX_PR_CHANGED_LINES` | Yes | Safely skips overly large reviews |
| `REVIEW_CONFIDENCE_THRESHOLD` | Yes | Default minimum finding confidence |

Generate a future 32-byte encryption key without printing other environment data:

```bash
openssl rand -base64 32
```

## 10. Run locally

After the database, OAuth App, GitHub App, AI Gateway, and Inngest configuration are ready:

```bash
bun dev
```

Open `http://localhost:3000`.

Expected onboarding flow:

1. Select **Sign in with GitHub**.
2. GitHub redirects to `/api/auth/github/callback` and the app creates a personal workspace.
3. Open **Repositories** and select **Connect GitHub App**.
4. Grant access to selected repositories in GitHub.
5. The Setup URL imports the accessible repository metadata in a disabled state.
6. Select **Enable and index** for one repository.
7. Watch `index-repository` in the Inngest dashboard until the state becomes `ready`.
8. Open or update a non-draft pull request.
9. Watch `review-pull-request`; a single review should appear on the exact head SHA.

The API documentation is available at:

- Human-readable route list: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/api/openapi.json`
- REST-compatible base: `http://localhost:3000/api/v1`
- tRPC endpoint: `http://localhost:3000/api/trpc`
- Health endpoint: `http://localhost:3000/api/v1/health`

## 11. Validate changes

Run all checks before committing:

```bash
bun run format:check
bun run typecheck
bun run test
bun run build
```

Focused tests:

```bash
bun --filter @reviewer/github test
bun --filter @reviewer/ai test
```

The existing tests cover raw webhook signature validation, webhook normalization, major-language detection, chunk stability, finding confidence/diff validation, memory promotion, unsafe-memory rejection, and security precedence.

Before changing review prompts or models, add representative true-positive and false-positive examples to an evaluation corpus. Model output that passes a schema can still be semantically wrong.

## 12. Deployment outline

The intended production topology is:

- Vercel: `apps/web`, route handlers, tRPC/OpenAPI, GitHub webhook receiver and Inngest serve endpoint
- Neon: Postgres, pgvector, tenant data, indexes, reviews, feedback, memory and audit events
- Inngest Cloud: durable workflow state, retries, concurrency and observability
- GitHub: OAuth identity and Reviewer App installation
- Vercel AI Gateway: model access through the AI SDK

Deployment checklist:

1. Create a production Reviewer GitHub App using the production `APP_URL`.
2. Use separate development and production GitHub App credentials.
3. Put every secret in the deployment secret store, not Vercel build arguments or source files.
4. Apply reviewed database migrations before routing production traffic.
5. Configure the production Inngest app and verify its signing key.
6. Confirm the webhook endpoint returns `202` for a signed GitHub ping/delivery.
7. Install the app on a test organization and a selected test repository first.
8. Enable review only after the initial index reports `ready`.
9. Run the full review evaluation suite across all supported language families.
10. Keep merge mode `never` until the guarded merge implementation and its adversarial tests land.

## 13. Security invariants

Do not weaken these invariants while extending the product:

- GitHub App user authorization establishes identity; an installation separately controls repository access.
- User access and refresh tokens are encrypted at rest and are used only for installation/user intersection checks.
- Every database query carrying user data is scoped by `workspaceId` or reaches data through a verified workspace-owned parent.
- GitHub webhook signatures are validated against the exact raw request body before JSON parsing.
- Delivery IDs are unique and make webhook ingestion idempotent.
- Installation tokens are generated on demand and never persisted.
- Review runs are unique for repository, PR number, and head SHA.
- Review publishing checks for a hidden run marker before creating another GitHub review.
- Inline comments are published only on lines present in the supplied patch.
- Repository data is untrusted prompt input and cannot define agent policy.
- Learned memory cannot suppress security or correctness findings.
- Broad memory scopes require workspace administration.
- GitHub writes stay disabled when required permissions or policy evidence are absent.
- A review approval is not a merge authorization.
- All repository-content write actions must eventually use a separately consented Executor App.

Run dependency, secret, static-analysis, and container/deployment scans in CI. Treat workflow definitions, prompts, generated patches, and repository instructions as security-sensitive code.

## 14. Data deletion

The product retains durable user data until manual deletion, as specified in `plan.md`.

- Individual learned rules can be deleted under **Dashboard → Memory**.
- The workspace owner can type their GitHub login under **Dashboard → Settings → Delete account and workspace**.
- Account deletion cascades through installations, repositories, indexed files/chunks, reviews, findings, feedback, memories, usages, audit events, memberships and sessions.
- The user must separately uninstall the GitHub App in GitHub to revoke the GitHub installation itself.
- In production, document backup retention and deletion propagation time before accepting customer data.

## 15. Troubleshooting

### OAuth returns “Invalid OAuth state”

- Confirm `APP_URL` exactly matches the browser origin.
- Confirm the OAuth callback URL is `${APP_URL}/api/auth/github/callback`.
- Do not switch between `localhost` and `127.0.0.1` during the flow.
- Confirm cookies are not blocked and the callback completes within ten minutes.

### GitHub App setup returns 400

- Confirm the GitHub App Setup URL is `${APP_URL}/api/github/setup`.
- Start installation from the dashboard so the HttpOnly state cookie is created.
- Confirm the current session is still valid.

### Webhook returns 401

- Confirm the GitHub App webhook secret and `GITHUB_WEBHOOK_SECRET` are identical.
- Do not transform, parse, or reserialize the body before signature validation.
- Confirm the public tunnel forwards the request body unchanged.

### Repository remains `indexing`

- Open the Inngest dashboard and inspect `index-repository`.
- Confirm `Contents: read` is granted.
- Confirm the installation still includes the repository.
- A recursive Git tree marked `truncated` is intentionally rejected. The follow-up indexer must use directory traversal for very large repositories.
- Check `MAX_INDEX_FILE_BYTES`; individual oversized files are skipped.

### No review is posted

- Confirm the repository is enabled and its settings have `reviewsEnabled: true`.
- Draft pull requests are skipped until `ready_for_review`.
- Confirm `Pull requests: read and write` is granted.
- Confirm the PR stays under `MAX_PR_CHANGED_LINES`.
- Confirm the webhook contains a non-duplicate delivery ID and the Inngest function ran.
- Confirm `AI_GATEWAY_API_KEY` can access `AI_REVIEW_MODEL`.

### Drizzle reports that type `vector` does not exist

Run this once in the target Neon database, then rerun the schema command:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 16. Development rules

- Follow YAGNI and DRY: extend package contracts only when a real workflow needs them.
- Keep GitHub DTOs inside `packages/github`; do not leak raw Octokit response shapes through the product.
- Keep model schemas, prompt boundaries, validation, and deterministic policy inside `packages/ai`.
- Keep workflow events small and version them before making breaking payload changes.
- Update this manual and `.env.example` in the same change as any setup modification.
- Add a migration for every database change.
- Add tests for every permission boundary, retry/idempotency behavior, memory promotion rule, new language adapter, and GitHub mutation.
- Never add an environment-based authentication bypass to production code.

## 17. Next implementation sequence

Continue the approved single-release plan in this order:

1. Add full-tree traversal fallback and incremental push indexing.
2. Add embeddings plus hybrid vector, path, symbol, import, and lexical retrieval.
3. Add Tree-sitter adapters per language family and per-language evaluation fixtures.
4. Add GitHub comment authorization and thread-aware PR chat.
5. Connect GitHub ratings/rejections to evidence aggregation and memory candidate review.
6. Add the separate Executor App, constrained tool registry, fix branches and draft PR creation.
7. Add required-check, branch-protection, CODEOWNERS, approval, head-SHA, cooldown, and audit gates.
8. Enable configurable auto-merge only after adversarial tests prove every gate fails closed.

Do not collapse the Reviewer App and Executor App to save setup work; that would expand the default blast radius and violate the security plan.
