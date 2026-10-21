# Rebase Agent-Era Roadmap — Engineering Implementation Specification

This document contains the complete, self-contained engineering specification for executing Rebase's five agent-era strategic pillars. It is written for an autonomous coding agent working in the Rebase monorepo.

Before starting any task, read [`AGENTS.md`](../../AGENTS.md) and the workflow guides in [`.agent/workflows/`](../../.agent/workflows/):
- **Use `pnpm` only.**
- **Never convert to `any`** and never use structural type casts (`as { ... }`). Use [`isSQLAdmin`](../../packages/types/src/types/database_adapter.ts) to narrow `driver.admin` when executing raw SQL.
- **Keep headless boundaries intact:** `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/server`, and `@rebasepro/server-postgres` must never import UI/CMS packages (`pnpm check:headless` and `pnpm check:types-headless`).
- **Build all UI from `@rebasepro/ui`** following [`UIReferenceView.tsx`](../../packages/app/src/debug/UIReferenceView.tsx).
- **Maintain i18n parity** across all locale files whenever adding UI copy (`pnpm check:locale-parity` and `pnpm check:untranslated`).

---

## Pillar 1: Human-in-the-Loop Approval Queue & Staged Agent Changes (`@rebasepro/cms` + `@rebasepro/server`)

### Context & Goal
As AI agents increasingly perform day-to-day data operations (drafting outreach, triaging tickets, enriching CRM records, proposing refunds), humans stop using the admin panel for raw manual data entry and instead use it as an **Approval Queue & Supervision Control Room**.

Today, Rebase supports schema-level state machines (e.g., `status: "draft" | "approved"`) enforced via `securityRules`. This pillar elevates human review into a **first-class, zero-boilerplate capability** across `@rebasepro/cms-types`, `@rebasepro/server`, `@rebasepro/server-postgres`, and `@rebasepro/cms`:
1. Declarative `admin.review` configuration on any collection.
2. Built-in staged proposals table (`_rebase_staged_changes`) so agents holding a `data:stage:*` scope (or configured roles) can propose `insert`, `update`, or `delete` operations without mutating live rows until approved, **plus** first-class support for inline state-machine review (`status` column transitions).
3. A dedicated **Review Queue** view in `@rebasepro/cms` with cell-level visual diffs, agent attribution (`rk_live_*` key name, model/actor metadata, reason), keyboard-driven `Approve (A)` / `Reject (R)` shortcuts, and batch approval.

---

### Task 1.1: Collection Review Configuration & API Key Scopes (`@rebasepro/types`, `@rebasepro/cms-types`)

#### Files to Modify
- `packages/types/src/types/collections.ts`
- `packages/types/src/types/api_keys.ts`
- `packages/types/src/types/scopes.ts`
- `packages/cms-types/src/types.ts`
- `packages/server/src/collections/validate-config.ts`

#### Specification
1. **Define `CollectionReviewConfig` in `@rebasepro/types` (`packages/types/src/types/collections.ts`)**:
   ```ts
   export interface CollectionReviewStateMachineConfig {
       mode: "state-field";
       /** Property key holding the review state (e.g. "status"). */
       field: string;
       /** Value written by agents awaiting human review (e.g. "draft" or "pending_review"). */
       pendingValue: string;
       /** Value written when an operator approves the record (e.g. "approved"). */
       approvedValue: string;
       /** Optional value written when an operator rejects the record (e.g. "rejected"). */
       rejectedValue?: string;
       /** Roles that are restricted to creating/updating into `pendingValue` only. */
       agentRoles?: string[];
       /** Roles permitted to transition records out of `pendingValue` into `approvedValue` / `rejectedValue`. */
       reviewerRoles?: string[];
   }

   export interface CollectionStagedReviewConfig {
       mode: "staged-table";
       /** Operations that require staging when called by `agentRoles` or `data:stage:*` keys. */
       operations?: Array<"insert" | "update" | "delete">;
       /** Roles whose mutations are automatically routed to `_rebase_staged_changes`. */
       agentRoles?: string[];
       /** Roles permitted to approve or reject staged changes. */
       reviewerRoles?: string[];
   }

   export type CollectionReviewConfig =
       | CollectionReviewStateMachineConfig
       | CollectionStagedReviewConfig;
   ```
2. **Attach `review?: CollectionReviewConfig` to collection configuration**:
   - Add `review?: CollectionReviewConfig` to `CollectionAdminConfig` in `packages/cms-types/src/types.ts` and to the server-side collection config in `packages/types/src/types/collections.ts` (since the server enforces staging and compiles state-field RLS policies).
   - Update `packages/server/src/collections/validate-config.ts` (`findCollectionConfigProblems`) to validate `review`:
     - When `mode === "state-field"`, verify that `field` exists in `collection.properties`, is of `type: "string"`, and if `enumValues` is defined, `pendingValue`, `approvedValue`, and `rejectedValue` are members of `enumValues`.
3. **Add `data:stage` scope to Service API Keys (`packages/types/src/types/api_keys.ts`, `packages/types/src/types/scopes.ts`)**:
   - Extend valid scope prefixes to support `data:stage` and `data:stage:<collectionSlug>`.
   - An API key with `data:stage:orders` (and without `data:write:orders`) can submit staged mutations to `/api/data/orders` (or `/api/data/orders/stage`), which land in `_rebase_staged_changes` with `status = 'pending'`.

#### Verification
- Run `pnpm check:core-types && pnpm check:headless && pnpm check:types-headless`.
- Add unit tests in `packages/server/test/validate-config.test.ts` covering valid and invalid `review` configs.

---

### Task 1.2: Staged Changes System Table, RLS Compiler Rules & Server Endpoints (`@rebasepro/server-postgres`, `@rebasepro/server`)

#### Files to Modify
- `packages/server-postgres/src/bootstrap/system-tables.ts` (or where `_rebase_*` system tables are bootstrapped)
- `packages/server-postgres/src/security/rls-compiler.ts`
- `packages/server/src/routes/data.ts`
- `packages/server/src/routes/staged-changes.ts` (new route module)
- `packages/mcp/src/tools/data.ts`

#### Specification
1. **System Table `_rebase_staged_changes` (`packages/server-postgres`)**:
   Bootstrap `_rebase_staged_changes` idempotently alongside `_rebase_api_keys` and `_rebase_audit_logs`:
   ```sql
   CREATE TABLE IF NOT EXISTS "_rebase_staged_changes" (
       "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       "collection_slug" TEXT NOT NULL,
       "operation" TEXT NOT NULL CHECK ("operation" IN ('insert', 'update', 'delete')),
       "target_record_id" TEXT,
       "before_data" JSONB,
       "proposed_data" JSONB,
       "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected')),
       "actor_type" TEXT NOT NULL DEFAULT 'api_key',
       "actor_id" TEXT,
       "actor_label" TEXT,
       "reason" TEXT,
       "reviewed_by" TEXT,
       "reviewed_at" TIMESTAMPTZ,
       "review_note" TEXT,
       "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   CREATE INDEX IF NOT EXISTS "idx_rebase_staged_changes_lookup"
       ON "_rebase_staged_changes" ("collection_slug", "status", "created_at" DESC);
   ```
2. **Automatic RLS Policy Generation for `mode: "state-field"` (`packages/server-postgres/src/security/rls-compiler.ts`)**:
   - When a collection declares `review: { mode: "state-field", field, pendingValue, approvedValue, agentRoles, reviewerRoles }`, the RLS compiler must synthesize restrictive `WITH CHECK` clauses so that any caller matching `agentRoles` (and not `reviewerRoles`) can only `INSERT` or `UPDATE` rows where `<field> = <pendingValue>`.
   - Ensure the generated SQL is deterministic and covered by `pnpm check:derived-names` / RLS compiler snapshot tests.
3. **REST API Endpoints (`packages/server/src/routes/staged-changes.ts`)**:
   - `GET /api/staged-changes?collection=<slug>&status=pending`: Lists staged changes (filtered by the caller's collection read permissions and reviewer role).
   - `POST /api/staged-changes`: Creates a staged change (or auto-intercept `POST/PATCH/DELETE /api/data/:collection` when the caller authenticates with a `data:stage` key or sets header `X-Rebase-Stage: true` with optional `X-Rebase-Stage-Reason`).Snapshots current row into `before_data` for `update`/`delete`.
   - `POST /api/staged-changes/:id/approve`: Executes the staged `insert`, `update`, or `delete` inside a single Postgres transaction under the approving operator's database session Context (so RLS is still enforced for the operator!), then marks `_rebase_staged_changes.status = 'approved'`, `reviewed_by`, `reviewed_at`.
   - `POST /api/staged-changes/:id/reject`: Marks `status = 'rejected'` with `review_note`.
   - `POST /api/staged-changes/batch`: Batch approve/reject an array of staged change IDs in a transaction.
4. **MCP Server Tools (`packages/mcp/src/tools/data.ts`)**:
   - Add `stage_document_change` (with `collection`, `operation`, `recordId`, `data`, `reason`) and `list_staged_changes` tools to `@rebasepro/mcp`, and run `pnpm generate:mcp-readme` to keep MCP tool tables in sync.

#### Verification
- Write integration tests in `packages/server-postgres/test/` testing:
  1. An `rk_live_*` key with `data:stage:orders` staging an update, verifying the live `orders` row is untouched.
  2. An operator approving the staged change and verifying the live `orders` row updates atomically.
  3. An agent role attempting to set `status = 'approved'` directly on a `mode: "state-field"` collection and getting rejected by Postgres RLS.

---

### Task 1.3: Cell-Level Diff & Approval Queue UI in `@rebasepro/cms`

#### Files to Modify
- `packages/cms/src/components/review/ReviewQueueView.tsx` (new)
- `packages/cms/src/components/review/StagedChangeDiffDrawer.tsx` (new)
- `packages/cms/src/components/CollectionView/CollectionViewHeader.tsx`
- `packages/cms/src/i18n/locales/{en,es,de,fr,it,pt}.ts`

#### Specification
1. **Badge & Tab in Collection Header (`CollectionViewHeader.tsx`)**:
   - When a collection has `review` configured (or has pending rows in `_rebase_staged_changes`), render a `Chip` / segmented tab in the collection toolbar: **`Review Queue (N)`** next to the standard Table / Kanban / Gallery layout switcher.
2. **Cell-Level Visual Diff Table (`ReviewQueueView.tsx`)**:
   - Build strictly with `@rebasepro/ui` primitives (`Button`, `Chip`, `Badge`, `Tooltip`, `Checkbox`, `Sheet` / `Dialog`).
   - For `mode: "staged-table"`, display each pending change with:
     - Operation badge (`INSERT` emerald, `UPDATE` amber, `DELETE` red).
     - Actor badge (`rk_live_7c2… · outreach-agent`) and `reason` note.
     - Inline field-by-field diff: changed cells show `<del class="text-surface-500 line-through">before</del> → <ins class="text-emerald-400 no-underline">after</ins>`.
   - For `mode: "state-field"`, filter the collection to `<field> = <pendingValue>` and provide one-click **Approve** (transitions `<field>` to `approvedValue`) and **Reject** (transitions to `rejectedValue`).
   - Support keyboard navigation (`j` / `k` to move rows, `a` to approve focused row, `r` to reject, `Space` to toggle selection for batch action).
3. **i18n**:
   - Add all review queue translation keys to `en.ts`, `es.ts`, `de.ts`, `fr.ts`, `it.ts`, `pt.ts` in `packages/cms/src/i18n/locales/`.

#### Verification
- Run `pnpm check:locale-parity && pnpm check:untranslated && pnpm check:icon-button-names`.
- Add unit/component tests in `packages/cms/test/`.

---

## Pillar 2: Packaging the Rebase Coding-Agent Harness (`@rebasepro/cli` & Agent Skills)

### Context & Goal
Rebase's own monorepo has a battle-tested Claude Code harness (`.claude/hooks/pre-tool-use.sh`, `.claude/hooks/post-tool-use.sh`, `rls-drift.sh`, `migration-order.sh`) and a benchmark suite (`tooling/scripts/harness/`). However, when a user runs `pnpm dlx @rebasepro/cli init my-app` or `rebase skills`, they only receive static markdown files (`AGENTS.md`, `CLAUDE.md`, and skills).

We must ship **executable guardrails** into every scaffolded Rebase project so that when a developer tells Claude Code or Cursor *"build me a multi-tenant B2B app"*, the agent is automatically prevented from bypassing `defineCollection`, forgetting RLS policies, or drifting schema from migrations.

---

### Task 2.1: Ship `.claude/hooks` and `rebase verify` in `@rebasepro/cli`

#### Files to Modify
- `packages/cli/src/commands/init.ts`
- `packages/cli/src/commands/skills.ts`
- `packages/cli/src/commands/verify.ts` (new CLI command)
- `packages/cli/src/index.ts`
- `packages/cli/templates/` (scaffold templates)

#### Specification
1. **New Command `rebase verify` (`packages/cli/src/commands/verify.ts`)**:
   Create a fast, single-command project verifier designed for both CI and agent `PostToolUse` / pre-commit hooks:
   - Step 1: Validates all `config/collections/*.ts` using `findCollectionConfigProblems` with `unknownKeys: "error"`.
   - Step 2: Checks for **RLS coverage**: flags any collection whose `securityRules` array is empty or missing (unless explicitly marked `publicRead` / opted out) or where a role has `select: true` with no row filter on a table containing `user_id`, `owner_id`, `organization_id`, or `tenant_id`.
   - Step 3: Checks **schema-to-migration freshness** (verifies whether `config/collections/*.ts` has ungenerated or unapplied schema changes compared to the latest migration snapshot).
   - Step 4: If `DATABASE_URL` is reachable and `--live` is passed, runs the 15 `@rebasepro/rls-check` catalogue checks against the live database.
   - Supports `--json` for structured agent feedback so coding agents can self-repair on failure.
2. **Scaffold `.claude/settings.json` and `.claude/hooks/` on `rebase init` and `rebase skills --hooks`**:
   - When scaffolding a project or running `rebase skills`, install a lightweight `.claude/settings.json` and `.claude/hooks/post-edit-collection.sh` that runs `npx rebase verify --quiet` whenever a file under `config/collections/` is modified by Claude Code.
   - Ensure the hook exits with a clear, actionable diagnostic message if the agent wrote an invalid property option, placed a UI widget outside `admin: { ... }`, or omitted `securityRules`.

#### Verification
- Run `pnpm check:templates && pnpm check:template-pins`.
- Add CLI tests in `packages/cli/test/` verifying `rebase verify` catches:
  - A collection with a top-level `widget` key instead of `admin.widget`.
  - A collection with a `tenant_id` property and no `securityRules`.

---

## Pillar 3: Pivot `@rebasepro/studio` to Agent Observability, RLS Simulation & Branch Diffs

### Context & Goal
Developers rarely use a web GUI to manually click "Add Column" anymore—they ask Claude to edit `config/collections/orders.ts`. What developers *cannot* easily do in a terminal chat with Claude is **visually verify who can see what rows**, **inspect what an agent changed on a database branch**, and **audit live agent tool calls**.

---

### Task 3.1: Interactive "View As Role / Service Key" RLS Simulator in the Panel Header

#### Files to Modify
- `packages/server/src/middleware/auth.ts`
- `packages/server-postgres/src/driver/postgres-driver.ts`
- `packages/app/src/components/studio/RlsSimulatorBar.tsx` (new)
- `packages/app/src/components/layout/AppHeader.tsx` (or top navigation bar in `@rebasepro/app`)
- `packages/app/src/i18n/locales/{en,es,de,fr,it,pt}.ts`

#### Specification
1. **Server-Side Impersonation Context for Admin Sessions (`packages/server`, `packages/server-postgres`)**:
   - When an authenticated user with the `admin` role sends requests with headers:
     - `X-Rebase-Simulate-Role: <roleName>`
     - `X-Rebase-Simulate-User-Id: <userId>` (optional)
     - `X-Rebase-Simulate-Api-Key-Id: <apiKeyId>` (optional)
   - The server verifies the caller is a real `admin`, and instead of running the query with admin bypass, sets the Postgres transaction-local claims (`SET LOCAL request.jwt.claim.role = ...`, `SET LOCAL request.jwt.claim.sub = ...`) and applies the simulated API key's collection/operation scopes!
   - Include response header `X-Rebase-Simulated-Context: role=<role>;sub=<id>;masked_columns=<cols>` so the UI can highlight hidden rows and masked columns.
2. **Interactive Simulator Switcher in `@rebasepro/app` (`RlsSimulatorBar.tsx`)**:
   - In Studio / Admin header, add a **"Simulate Access"** pill selector allowing the developer to pick:
     - Any defined Role (e.g., `anonymous`, `customer`, `support`, `agent`)
     - Any specific User from `_rebase_users`
     - Any active Service API Key (`rk_live_*` from `_rebase_api_keys`)
   - When active:
     - Render a prominent amber/blue simulation banner at the top of the panel: *"Viewing as API Key `support-agent` (`rk_live_a91…`) — 3 collections hidden, 2 columns masked by RLS."*
     - Every Data Grid in Rebase CMS immediately reloads through `useDataSource` with the simulation headers attached, showing the **exact rows and columns** that key or role can access.

#### Verification
- Write an E2E / integration test in `packages/server-postgres/test/` verifying that an admin passing `X-Rebase-Simulate-Role: customer` + `X-Rebase-Simulate-User-Id: u_1` only receives rows matching `u_1`'s RLS policy, and that non-admin users passing `X-Rebase-Simulate-Role` receive `403 Forbidden`.

---

### Task 3.2: Visual Database Branch Data-Diff & Merge View in Studio

#### Files to Modify
- `packages/server-postgres/src/branching/branch-diff.ts` (new)
- `packages/server/src/routes/branches.ts`
- `packages/app/src/views/studio/BranchDiffView.tsx` (new)
- `packages/mcp/src/tools/branching.ts`

#### Specification
1. **Schema + Row-Level Branch Diff Engine (`packages/server-postgres/src/branching/branch-diff.ts`)**:
   - Rebase already supports database branching (`rebase_db_branch_create`, `rebase_db_branch_list`, etc.).
   - Add a diff routine `diffDatabaseBranch(admin, branchName)` (using `isSQLAdmin(admin)`) that compares the branch database/schema against `main` and returns:
     - **Schema diff**: added/dropped/altered tables, columns, and RLS policies.
     - **Data summary diff**: per-collection count of inserted, updated, and deleted rows (up to a configurable sample limit, e.g., 100 rows per table, matched by primary key).
2. **REST Endpoint & MCP Tool**:
   - Expose `GET /api/studio/branches/:name/diff` and `POST /api/studio/branches/:name/merge`.
   - Expose `rebase_db_branch_diff` in `@rebasepro/mcp` (and run `pnpm generate:mcp-readme`).
3. **Studio Branch Diff UI (`BranchDiffView.tsx`)**:
   - In Rebase Studio's Branches tab, clicking a branch opens a GitHub-PR-style split view showing:
     - Tab 1: **Schema & RLS Policy Changes** (SQL / collection diff).
     - Tab 2: **Data Changes** (rows inserted/modified/deleted by the agent during its test run on that branch).

#### Verification
- Add unit and integration tests for `diffDatabaseBranch` in `packages/server-postgres/test/`.
- Ensure `isSQLAdmin` is used for all raw SQL queries (`pnpm check:casts`).

---

## Pillar 4: Make the Admin Panel the Host for Last-Mile Agent-Generated Views (`@rebasepro/cms` & `@rebasepro/cli`)

### Context & Goal
80% of back-office views are standard tables, forms, and Kanban boards that Rebase generates from `defineCollection` with zero code. For the remaining 20%—bespoke operational workflows like a clinical therapy planner, a side-by-side order refund & Stripe inspector, or a visual warehouse map—developers today are tempted to ask Claude to build a standalone Next.js app from scratch.

Instead, Rebase should make it effortless for a coding agent to drop a **100-line custom React view** into `config/views/` (or `admin.entityViews`) that automatically inherits Rebase's auth, RLS, sidebar navigation, `@rebasepro/ui` design system, and `useDataSource` hooks.

---

### Task 4.1: `rebase generate view` CLI Command & `rebase-custom-views` Agent Skill

#### Files to Modify
- `packages/cli/src/commands/generate-view.ts` (new)
- `packages/cli/src/index.ts`
- `tooling/rebase-agent-skills/rebase-custom-views/SKILL.md` (new skill)
- `packages/cms-types/src/types.ts`

#### Specification
1. **CLI Generator (`rebase generate view <slug>`)**:
   - Scaffolds a typed custom view file in `frontend/src/views/<Slug>View.tsx` (or `config/views/<slug>.tsx` depending on project layout) pre-wired with:
     - `@rebasepro/ui` imports (`Card`, `Button`, `Badge`, `DataTable`, `Tabs`, `Sheet`).
     - `@rebasepro/cms` hooks (`useDataSource`, `useAuthController`, `useSnackbarController`).
     - Automatic registration in the app's `views: AppView[]` or collection's `admin.entityViews`.
2. **Dedicated Agent Skill (`tooling/rebase-agent-skills/rebase-custom-views/SKILL.md`)**:
   - Document the exact contract for authoring custom top-level `AppView` screens, custom collection `admin.entityViews` (rendered inside the side drawer or collection tab), and custom field widgets (`admin.widget`).
   - Provide copy-pasteable, compiler-verified examples using `@rebasepro/ui` tokens (`bg-surface-card`, `bg-surface-sheet`, `border-hairline`) so any view Claude writes looks native to the Rebase panel on the first try.
   - Remember: every TypeScript code fence in `tooling/rebase-agent-skills/**/*.md` is compiled by `pnpm verify:docs:strict`! Make sure every example in the skill compiles cleanly against workspace types.

#### Verification
- Run `pnpm verify:docs:strict && pnpm check:doc-examples` to verify all code fences in the new skill compile and pass collection validation.

---

## Pillar 5: Zero-Signup Ephemeral Cloud Claiming & `rls-check` Growth Loop

### Context & Goal
When a user asks Claude Code or Cursor to build an app, the agent hits a wall if provisioning a cloud database/backend requires a human to open a browser, fill out a signup form, and copy-paste credentials first.
By allowing an agent to provision an ephemeral Rebase Cloud tenant via CLI/MCP and return a **Claim URL**, the agent becomes Rebase Cloud's primary distribution channel.

---

### Task 5.1: Unauthenticated Ephemeral Tenant Provisioning & Claim Flow (`saas/`, `@rebasepro/cli`, `@rebasepro/mcp`)

#### Files to Modify
- `saas/backend/src/routes/claim.ts` (new route in `saas/`)
- `packages/cli/src/commands/cloud.ts` (new or extend cloud commands)
- `packages/mcp/src/tools/projects.ts`

#### Specification
1. **Control-Plane Claim Endpoint (`saas/`)**:
   - `POST /api/cloud/provision-ephemeral` (rate-limited by IP):
     - Provisions an isolated ephemeral tenant database/schema with a 72-hour TTL (`expires_at = NOW() + INTERVAL '72 hours'`, `claimed_by = NULL`).
     - Generates a scoped project token, a one-time `claim_token`, and returns:
       - `projectUrl` (`https://<slug>.cloud.rebase.pro`)
       - `apiKey` (`rk_live_...`)
       - `claimUrl` (`https://cloud.rebase.pro/claim/<claim_token>`)
       - `expiresAt` (ISO timestamp)
   - `POST /api/cloud/claim/:claimToken` (authenticated by user session in browser):
     - Binds the ephemeral project to the user's Rebase Cloud account, clears `expires_at`, and transitions the tenant to permanent status.
2. **CLI & MCP Integration (`rebase cloud init --claim`)**:
   - Running `pnpm dlx @rebasepro/cli cloud init --claim` calls the endpoint, writes `REBASE_BASE_URL` and `REBASE_API_TOKEN` into `.env`, pushes the local collections, and prints the live Admin Panel URL + the 72-hour Claim URL for the user.

#### Verification
- Add unit tests for the claim token lifecycle and rate limiting in `saas/`.
- Run `pnpm verify:docs:strict` to ensure all cloud surface checks (`check-cloud-surface.mjs`) remain accurate.

---

### Task 5.2: `rls-check` Remediation Hint Output for Vibe-Coded Databases (`@rebasepro/rls-check`)

#### Files to Modify
- `packages/rls-check/src/reporter.ts`
- `packages/rls-check/src/cli.ts`

#### Specification
1. **Actionable Fix Hints & `--format agent` (`packages/rls-check`)**:
   - Add `--format agent` (or enrich `--json`) in `@rebasepro/rls-check` so coding agents running `npx @rebasepro/rls-check` receive:
     - The exact failing table, policy name, and check ID (out of the 15 catalogue checks).
     - The exact `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` SQL remediation **and** the equivalent Rebase `defineCollection({ securityRules: [...] })` snippet.
   - If you add a CLI flag to `@rebasepro/rls-check`, update `packages/rls-check/README.md` so `check-rls-check-flags.mjs` passes!

#### Verification
- Run `pnpm --filter @rebasepro/rls-check test` and `pnpm verify:docs:strict` (which runs `check-rls-check-count.mjs` and `check-rls-check-flags.mjs`).

---

## Global Verification Checklist (Run Before Completing Any Task)

Every PR or task implementation must pass the repository's verification gates before completion:

```bash
# 1. Typecheck all packages and tests
pnpm typecheck

# 2. Check headless boundaries, casts, and API surface
pnpm check:headless
pnpm check:types-headless
pnpm check:casts
pnpm check:api-surface

# 3. Check i18n parity and UI accessibility rules
pnpm check:locale-parity
pnpm check:untranslated
pnpm check:icon-button-names

# 4. Verify documentation, skills, and relative links
pnpm verify:docs:strict
pnpm check:doc-links
pnpm check:doc-examples

# 5. Run full quality suite (static + build + unit + E2E)
./tooling/scripts/verify-quality.sh
```
