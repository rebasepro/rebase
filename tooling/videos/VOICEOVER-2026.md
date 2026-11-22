# Rebase & Rebase Cloud (2026 Series) — Agent Build Spec & Voice-Over Scripts

Ten short films built for **2026**, where coding agents write the app before lunch, runtime agents touch production data all day, and teams choose **Rebase** (MIT open source) and **Rebase Cloud** (private beta, opened in batches) so neither agents nor cloud vendors wreck production.

None of these ten films repeat the old boilerplate-era explainers ("look, TypeScript autocomplete!", "look, `init` creates a folder!", "look, a function is a file!"). Every film starts from an acute 2026 failure mode and proves the answer with **real, shipped capabilities in this monorepo**.

---

## Instructions for the Coding Agent Building These Films

Read these files in `tooling/videos` before writing any scene code:

1. **`src/series/kit.tsx`** — `FilmSpec`, `SceneSpec`, `PRESENTER` (`wide` 1920×1080 and `tall` 1080×1920 from a single take), `Headline`, `Label`, `At`, `useBody`, `useStage`, `useCue`, `checkFilm`, `endCommand`.
2. **`src/series/films/03-agents.tsx` & `04-own.tsx` & `10-existing.tsx`** — reference patterns for `lines([...])`, `Frame`, `Code`, `Terminal`, `CHROMA`, `SURFACE`, `INK`, `FONT`, `ramp`, `ENTER`.
3. **`src/live/words.ts` & `src/live/follow.ts`** — how the live teleprompter (`pnpm live`) tracks spoken words. Do **not** alter the `SCRIPT` strings below without re-running `pnpm lint:film <id>`: every script below has already been verified clean against `banned`, `repeat-word` (within 12 words), `repeat-run` (3-word runs), and `same-start` (two-word sentence openings), with zero CLI punctuation (`--flags`) inside spoken words.
4. **Product & naming rules (`docs/PRODUCT.md`, `website/SITE-STORY.md`):**
   - Product names: **Rebase Backend**, **Rebase CMS**, **Rebase Studio**; together CMS + Studio are **the admin panel** (lowercase). Never call the panel "optional" or a "separate product".
   - **Rebase Cloud** is in **private beta** (live today with real tenants, opened in batches, priced per resource, requested at `rebase.pro/pricing` — never presented as self-serve GA or per-seat).
   - **No TypeScript `any` and no structural casts.**
   - **Every command, JSON payload, log line, and code snippet on screen must match the repo sources listed under `Proof & Repo Sources` for each film.** Never invent flags or output lines.

### Where to put the code

- Write each film in `tooling/videos/src/series/films/` (either replacing the 10 entries in `src/series/index.ts` or registering a new `SERIES_2026` array in `src/series/index.ts` + `src/Root.tsx` + `scripts/lint-film.ts` + `scripts/audit-film.ts` — keep `?film=<id>` working in `pnpm live`).
- In `tall` (9:16), nothing readable may go below `y = 1560` or right of `x = 960`, and every `<Headline>` must wrap to **at most 2 lines** (~30 chars/line in tall) with **at most 3 distinct display headline font sizes** across the film.
- At every scene cut, keep visual presence across the transition (`audit:film`'s `bare-ground` check fails if a cut frame drops below brightness threshold).

### Mandatory verification gates before finishing

Run all three from `tooling/videos` for every film `<id>`:

```bash
pnpm lint:film <id>      # 0 errors on banned, repeat-word, repeat-run, same-start
pnpm audit:film <id>     # renders simulated read at 155 wpm in wide + tall; checks bare-ground, headlines ≤3 sizes, wrap ≤2 lines
pnpm typecheck           # zero TypeScript errors
```

Then inspect `tooling/videos/out/audit/<id>/wide/sheet.png`, `wide/cuts.png`, `tall/sheet.png`, and `tall/cuts.png` directly to verify zero text clipping, overlap, or cramped layouts.

---

## Release Order Overview

| # | `id` | Episode Title | Core Capability | Product Focus | `endCommand` |
|---|---|---|---|---|---|
| 01 | `claim` | Zero-Account Agent Provisioning | `rebase cloud init --claim` + one-click claim & key rotation | Rebase Cloud | `"rebase cloud init --claim"` |
| 02 | `review-queue` | Agents Propose, Humans Approve | `@rebasepro/plugin-review` (`rebase.staged_changes` + cell diff) | Rebase + Cloud | `"pnpm add @rebasepro/plugin-review"` |
| 03 | `claude-panel` | Your Admin Panel Inside Claude | `https://app.rebase.pro/mcp` + `@rebasepro/mcp-apps` (`show_collection`, `show_app`) | Cloud + OSS | `"rebase cloud connect <url>"` |
| 04 | `db-branch` | Sub-Second Database Branches | `rebase db branch create`, `diff`, `merge` (`CREATE DATABASE … TEMPLATE`) | Rebase CLI | `"rebase db branch create experiment"` |
| 05 | `time-machine` | Built-In Row Undo | `history: true` + `rebase data history` & `rebase data revert` | Rebase + Cloud | `"rebase data revert orders <id>"` |
| 06 | `rls-simulate` | Prove Permissions Before Prod | `rebase rls simulate` + `<Rebase simulateAccess>` + `rls-policy-recursion` | Rebase Studio + CLI | `"rebase rls simulate"` |
| 07 | `leave-supabase` | One-Command Supabase Escape | `rebase schema introspect --from supabase` + `rebase cloud db query` | Rebase + Cloud | `"rebase schema introspect --from supabase"` |
| 08 | `safe-previews` | Agent Previews That Cannot Touch Prod | `rebase cloud deploy --preview-name` (isolated pod + empty Postgres) | Rebase Cloud | `"rebase cloud deploy --preview"` |
| 09 | `one-cli` | One Agent-Safe CLI for Everything | `rebase data/logs/cron/storage` + `--project` Studio proxy + `--can` tokens | Rebase CLI + Cloud | `"pnpm dlx @rebasepro/cli init"` |
| 10 | `honest-cloud` | Billed for Physics, Fireable Before Lunch | Resource dials, dedicated Postgres, `Open CMS` SSO, region warning, `rebase eject` | Rebase Cloud + OSS | `null` *(rebase.pro · Request beta access)* |

---

## 01 · Zero-Account Agent Provisioning — `claim`

- **Accent:** `CHROMA.cyan` (with `CHROMA.coral` on the revoked agent key)
- **`endCommand`:** `"rebase cloud init --claim"`
- **`toCorner`:** `{ line: "run", word: "One" }`
- **`close`:** `{ line: "close", word: "Let" }`

### Spoken Script (112 words · lint-verified)

```ts
const SCRIPT = lines([
    ["hook", "My coding agent just deployed a live production backend, and I haven't even created an account yet."],
    ["run", "One Rebase Cloud command spins up Postgres, pushes the schema, and puts the API on a real public address."],
    ["locked", "Until a human claims the project, mail ports remain shut, secrets stay hidden, and the whole stack self-destructs after seventy-two hours."],
    ["handover", "When the app works, my agent hands me a single-use link. I click it, drop the backend into my org, and keep shipping."],
    ["rotate", "Claiming revokes the agent's bootstrap token and rotates the service key behind its back with one clean restart."],
    ["close", "Let agents build at full speed, then take the keys away on Rebase Cloud."],
]);
```

### Visual Device & Scenes

- **`run`:** Terminal running `rebase cloud init --claim` (or MCP `rebase_cloud_provision`). Prints the live `https://<slug>.rebase.website` URL, the admin panel URL, and the one-time **claim URL** + `72h` countdown badge.
- **`locked`:** Three security pills locking down the unclaimed sandbox: `SMTP 465 / 587 / 993 CLOSED`, `ENV & DB SECRETS REDACTED`, `EXPIRES IN 72:00:00`.
- **`handover`:** Browser card clicking the claim URL → moves project from `unclaimed` into `Organization: Acme` (`billing: active`, expiry removed from `REBASE_API_TOKEN`).
- **`rotate`:** Key rotation diagram: agent's bootstrap control-plane token flashes `REVOKED`, `REBASE_SERVICE_KEY` rotates to a fresh key, pod restarts cleanly (`1 restart · old agent key dead`).

### Proof & Repo Sources

- Read `website/src/content/docs/docs/deployment/cloud-agents.md` (§ *A backend with no account*, lines 104–189) for every exact behavior:
  - Command: `rebase cloud init --claim` (and `rebase cloud claim --open`, MCP tool `rebase_cloud_provision`).
  - Unclaimed restrictions: outbound ports `80` and `443` only (mail ports `465`, `587`, `993` closed until claimed); token cannot read env var values, `REBASE_SERVICE_KEY`, or DB password, and cannot run `db connect` or previews; deleted after 72 hours if unclaimed; pre-claim usage is not billed to claimer.
  - Handover: claiming revokes the agent's bootstrap token, replaces `REBASE_SERVICE_KEY` and restarts the app once (`rebase cloud app-key rotate` also rotates `REBASE_API_TOKEN`).

---

## 02 · Agents Propose, Humans Approve — `review-queue`

- **Accent:** `#F59E0B` (amber for staged proposals, `#34D399` emerald on approve)
- **`endCommand`:** `"pnpm add @rebasepro/plugin-review"`
- **`toCorner`:** `{ line: "stage", word: "With" }`
- **`close`:** `{ line: "close", word: "Agents" }`

### Spoken Script (103 words · lint-verified)

```ts
const SCRIPT = lines([
    ["hook", "Giving a support agent direct write access to your orders table is how you wake up to four hundred accidental refunds."],
    ["stage", "With the Rebase review plugin, agents never hold write scopes. Instead, their key can only propose changes."],
    ["hold", "Every insert, update, or delete lands in a staged table that regular users cannot even see."],
    ["diff", "Your ops team opens the admin panel, checks a cell-level diff of what the bot wants to edit, and clicks approve."],
    ["apply", "Postgres runs that mutation inside one transaction under the human reviewer's own row-level security."],
    ["close", "Agents do the legwork, people make the call, on self-hosted Rebase or Rebase Cloud."],
]);
```

### Visual Device & Scenes

- **`stage`:** Split credential card: `data:write:orders` crossed out in coral; `functions:invoke:review` lit up, alongside the 4-line `ReviewConfig` from `packages/plugin-review/README.md`.
- **`hold`:** Flow diagram: `support-agent (rk_live_…)` sends an update (`status: "paid" → "refunded"`) → routed into `rebase.staged_changes` while live `public.orders` stays untouched.
- **`diff`:** Rebase CMS Review Queue row showing the actor badge, operation (`UPDATE`), struck-through old value vs. proposed value (`diffStagedChange`), and the **Approve** button.
- **`apply`:** Single transaction box: `BEGIN → SET LOCAL role rebase_user (ops reviewer) → UPDATE orders → mark staged_changes approved → COMMIT`.

### Proof & Repo Sources

- Read `packages/plugin-review/README.md` and `packages/plugin-review/src/`:
  - Exports: `ReviewConfig`, `reviewRls()`, `diffStagedChange()` from `@rebasepro/plugin-review/config`; `reviewFunction()` from `@rebasepro/plugin-review/server`; `useReviewPlugin()` from `@rebasepro/plugin-review`.
  - Modes: `mode: "staged-table"` (writes to `rebase.staged_changes`, out of end-user role's reach) and `mode: "state-field"`.
  - Key scope pattern: `functions:invoke:review` with **no** `data:write`.

---

## 03 · Your Admin Panel Inside Claude — `claude-panel`

- **Accent:** `CHROMA.violet` (or `CHROMA.cyan` on dark ground)
- **`endCommand`:** `"rebase cloud connect <url>"`
- **`toCorner`:** `{ line: "blind", word: "And" }`
- **`close`:** `{ line: "close", word: "Use" }`

### Spoken Script (110 words · lint-verified)

```ts
const SCRIPT = lines([
    ["hook", "Stop vibe-coding fifty throwaway internal dashboards that break the next time somebody renames a column."],
    ["blind", "And definitely stop letting Claude edit production database rows blind in plain text."],
    ["open", "Connect Rebase to Claude, ask for your orders, and your real admin table opens inside the chat with live search, filters, and forms."],
    ["app", "Need a custom view? Ask Claude to sketch an interactive app over those records and run it right there."],
    ["confirm", "Every edit, deploy, rollback, or cron trigger shows the exact plan first and waits for your click, signed in as your own account."],
    ["close", "Use it on Rebase Cloud from your laptop or phone, or link any self-hosted server in seconds."],
]);
```

### Visual Device & Scenes

- **`blind`:** Left side shows raw JSON text mutation hazard vs. clean connector URL `https://app.rebase.pro/mcp` (`OAuth 2.1 · your Rebase account`).
- **`open`:** Use the real screenshot assets in `docs/claude-directory/screenshots/1-table.png` (or faithfully render `show_collection` / `show_record` MCP App frame inside a conversation card, with search, filter chips, switches, and paging).
- **`app`:** `show_app` tool badge rendering a live custom React micro-app preloaded with the table's first page.
- **`confirm`:** Two-step confirmation card (`docs/claude-directory/screenshots/2-edit-plan.png` / `write`, `deploy`, `env`, `cron` annotated `destructiveHint: true` → Plan preview → **Confirm & Save** button, plus badge `Acts as you · RLS enforced · no service key`).

### Proof & Repo Sources

- Read `docs/claude-directory/SUBMISSION.md`, `docs/hosted-mcp-connector.md`, `website/dist/ai.md`, and `packages/mcp-apps/`:
  - Connector URL: `https://app.rebase.pro/mcp`.
  - Tools: `projects`, `project_status`, `logs`, `schema`, `query`, `show_collection` (or `show_table`), `show_record`, `show_app`, `write`, `deploy`, `env`, `cron`.
  - Self-hosted bridge command: `rebase cloud connect <url>`.

---

## 04 · Sub-Second Database Branches — `db-branch`

- **Accent:** `#34D399` (emerald branch line splitting and merging cleanly)
- **`endCommand`:** `"rebase db branch create experiment"`
- **`toCorner`:** `{ line: "clone", word: "One" }`
- **`close`:** `{ line: "close", word: "Instant" }`

### Spoken Script (101 words · lint-verified)

```ts
const SCRIPT = lines([
    ["hook", "Before you let an agent run a risky migration or backfill ten thousand rows, clone the database."],
    ["clone", "One CLI command gives you a full copy in under a second, including every table, index, row, and security policy."],
    ["how", "Postgres copies the underlying files straight on disk through native templates right after Rebase evicts idle connection pools."],
    ["wild", "Point your coding agent at that isolated copy and let it go wild while production feels nothing."],
    ["merge", "Inspect every changed record in the terminal diff, then merge back only the row updates that look right."],
    ["close", "Instant database branches without moving your Postgres to a proprietary vendor."],
]);
```

### Visual Device & Scenes

- **Persistent `layer` (git-style database graph):** Main trunk (`rebase`) splits into `rb_agent_backfill` and merges verified rows back at the end.
- **`clone`:** Terminal running `rebase db branch create agent_backfill` → `< 1s` clone with counts (`tables · indexes · rows · RLS policies`).
- **`how`:** SQL callout `CREATE DATABASE "rb_agent_backfill" TEMPLATE "rebase";` + `DatabasePoolManager` evicting idle connections first.
- **`wild`:** Agent terminal hammering mutations on `rb_agent_backfill` while `production` flatlines at `0 writes`.
- **`merge`:** Terminal running `rebase db branch diff agent_backfill` followed by `rebase db branch merge agent_backfill` (matching diff fingerprint).

### Proof & Repo Sources

- Read `website/src/content/docs/docs/backend/branching.md` and `CHANGELOG.md` (`0.32.0`: `rebase db branch merge <name>`):
  - SQL mechanism: `CREATE DATABASE "rb_<name>" TEMPLATE "<source>";` after `DatabasePoolManager` evicts idle pools (`--force` handles external sessions via `ALTER DATABASE … ALLOW_CONNECTIONS false` + advisory lock).
  - Commands: `rebase db branch create`, `rebase db branch diff`, `rebase db branch merge <name>` (`--on-conflict`, `--skip-blocked`), plus MCP tools `rebase_db_branch_create` and `rebase_db_branch_diff`.

---

## 05 · Built-In Row Undo — `time-machine`

- **Accent:** `CHROMA.cyan` (`CHROMA.coral` for the bad agent wipe, `#34D399` on revert)
- **`endCommand`:** `"rebase data revert orders <id>"`
- **`toCorner`:** `{ line: "on", word: "In" }`
- **`close`:** `{ line: "close", word: "Mistakes" }`

### Spoken Script (111 words · lint-verified)

```ts
const SCRIPT = lines([
    ["hook", "Sooner or later, an agent script with a bad filter is going to wipe out the wrong customer records."],
    ["on", "In Rebase, entity history is switched on out of the box. Every create, update, and delete snapshots what changed, who did it, and what sat there before."],
    ["privacy", "Viewing an audit trail checks the exact policy protecting that record, and never leaks columns from related tables."],
    ["cli", "Open your terminal, pull the timeline for that broken order, and compare every version in seconds."],
    ["revert", "One revert command writes the previous values back through the API with all hooks and permissions intact."],
    ["close", "Mistakes happen faster in twenty twenty-six, so ship a backend with undo built in."],
]);
```

### Visual Device & Scenes

- **`on`:** `defineTable("orders", { …, history: true })` (and badge `Managed runtime: REBASE_HISTORY=true by default`) feeding `rebase.entity_history` (`action`, `changed_fields`, `previous_values`, `values`, `user_id`).
- **`privacy`:** Foreign-key shield: `customer_id` stored as plain key only — no embedded related row values leaked across policies.
- **`cli`:** Terminal running `rebase data history orders ord_8841` printing the timeline table (v3 `update` by `rk_live_agent` corrupting `total` vs. v2 clean state).
- **`revert`:** Terminal running `rebase data revert orders ord_8841 <entry-id>` → live record snaps back to v2 values through REST + RLS.

### Proof & Repo Sources

- Read `website/src/content/docs/docs/backend/history.md` and `CHANGELOG.md` (`0.32.0` `rebase data`):
  - Managed runtime default: `REBASE_HISTORY=true` (90-day retention default).
  - Table: `rebase.entity_history` (`table_name`, `values`, `previous_values`, `changed_fields`, `action`, `user_id`, timestamp; `belongsTo` kept as FK only, never embedding related rows).
  - CLI commands: `rebase data history` and `rebase data revert` (`packages/cli`).

---

## 06 · Prove Permissions Before Prod — `rls-simulate`

- **Accent:** `CHROMA.cyan` (matrix cells in `#34D399` allowed / `CHROMA.coral` denied)
- **`endCommand`:** `"rebase rls simulate"`
- **`toCorner`:** `{ line: "guess", word: "Teams" }`
- **`close`:** `{ line: "close", word: "Quit" }`

### Spoken Script (102 words · lint-verified)

```ts
const SCRIPT = lines([
    ["hook", "Nobody actually tests row-level security across five roles and fifteen tables, because doing it by hand is miserable."],
    ["guess", "Teams eyeball the SQL, push to production, and pray one buyer cannot read someone else's invoices."],
    ["sim", "With Rebase, you run the simulator from your terminal or switch on Simulate Access inside Studio."],
    ["matrix", "Pick any person, role, or scoped agent key, and see across every table what Postgres serves and what comes back forbidden."],
    ["loop", "Before you even deploy, our verifier catches policies referencing each other in a loop, stopping infinite recursion crashes cold."],
    ["close", "Quit guessing what your database rules allow, and prove them before launch."],
]);
```

### Visual Device & Scenes

- **`guess`:** Wall of raw `CREATE POLICY` SQL with a subtle cross-tenant leak (`invoices` exposed).
- **`sim`:** Terminal running `rebase rls options` & `rebase rls simulate` alongside Studio's `<Rebase simulateAccess>` identity switcher.
- **`matrix`:** Permission grid: rows = `orders`, `invoices`, `users`, `audit_logs`; columns = `anonymous`, `buyer (alice)`, `support`, `rk_live_bot`. Instant visual readout of row counts vs. `FORBIDDEN / 0 rows`.
- **`loop`:** `rebase verify` catching `rls-policy-recursion` (`42P17 infinite recursion detected in policy` between `projects` ↔ `members`) with the exact remedy (`move the read into a SECURITY DEFINER function`).

### Proof & Repo Sources

- Read `CHANGELOG.md` (`0.32.0`: `rebase rls simulate`, `rebase rls options`, `rls-policy-recursion` / `findPolicyRecursion` in `@rebasepro/rls-check`; `0.34.1`: `<Rebase simulateAccess>` and `client.simulate()`) and `packages/studio/src/components/RLSEditor/RLSEditor.tsx`.

---

## 07 · One-Command Supabase Escape — `leave-supabase`

- **Accent:** `#34D399` (clean translation table from Supabase SQL → Rebase TypeScript)
- **`endCommand`:** `"rebase schema introspect --from supabase"`
- **`toCorner`:** `{ line: "why", word: "Your" }`
- **`close`:** `{ line: "close", word: "Preserve" }`

### Spoken Script (103 words · lint-verified)

```ts
const SCRIPT = lines([
    ["hook", "Try moving off Supabase by hand, and your first migration dies on proprietary auth functions before a single table loads."],
    ["why", "Your schemas get tangled up with custom Postgres roles, UUID user links, and service-role shortcuts."],
    ["cmd", "Point the Rebase schema introspector at your live Supabase connection string with one flag."],
    ["translate", "It rewrites user defaults into server hooks, converts authenticated and anon rules into clean policies, and drops service-role backdoors."],
    ["honest", "Anything outside your tables, like triggers, custom SQL functions, and check constraints, gets saved into a file you can run straight on Rebase Cloud."],
    ["close", "Preserve every user ID, own your stack, and leave lock-in behind."],
]);
```

### Visual Device & Scenes

- **`why`:** Red Postgres error banner: `ERROR: schema "auth" does not exist` on `default auth.uid()` + `TO authenticated` + `references auth.users(id)`.
- **`cmd`:** Terminal: `rebase schema introspect --database-url "$SUPABASE_DB_URL" --from supabase`.
- **`translate`:** Animated 2-column translation board (verbatim from `migrate-from-supabase.md`):
  - `owner_id uuid default auth.uid()` → `col.text().onCreateUser().userId()`
  - `auth.uid()` in policy → `rebase.uid()`
  - `TO authenticated` / `TO anon` → signed-in / signed-out condition
  - `TO service_role` only → dropped
- **`honest`:** Terminal "Not carried over" summary writing `backend/sql/introspected-left-behind.sql`, then pushing it with zero local `psql` via `rebase cloud db query --file backend/sql/introspected-left-behind.sql`.

### Proof & Repo Sources

- Read `website/src/content/docs/docs/recipes/migrate-from-supabase.md` and `CHANGELOG.md` (`0.34.0`: `rebase schema introspect --from supabase` and `rebase cloud db query --file`). Every single conversion rule on screen must match lines 31–47 and 68 of `migrate-from-supabase.md`.

---

## 08 · Agent Previews That Cannot Touch Prod — `safe-previews`

- **Accent:** `CHROMA.cyan` (`#34D399` isolated pods, `CHROMA.coral` hard wall protecting production)
- **`endCommand`:** `"rebase cloud deploy --preview"`
- **`toCorner`:** `{ line: "deploy", word: "On" }`
- **`close`:** `{ line: "close", word: "Ship" }`

### Spoken Script (111 words · lint-verified)

```ts
const SCRIPT = lines([
    ["hook", "When four coding agents open backend pull requests before lunch, a shared staging server turns into a crime scene."],
    ["deploy", "On Rebase Cloud, pass a preview name when you deploy, and that branch gets its own live address in seconds."],
    ["isolated", "Every backend preview boots inside an isolated pod on a fresh, empty Postgres instance with a separate service key."],
    ["why", "Production tables stay untouched, live security policies never get overwritten, and scheduled jobs cannot fire against real users."],
    ["guard", "Even the upload route is fail-safe: hit an older control plane by mistake, and it returns four-oh-four rather than touching live traffic."],
    ["close", "Ship ten agent branches at once with Rebase Cloud and stop sweating production."],
]);
```

### Visual Device & Scenes

- **`deploy`:** Terminal running `rebase cloud deploy --preview-name new-quiz` → live check green at `https://songbuzz--new-quiz.rebase.website` (`production: unchanged`).
- **`isolated`:** Architecture split: `Production` (`songbuzz.rebase.website` + prod CNPG DB + prod `REBASE_SERVICE_KEY`) separated by a solid wall from three live agent previews (`--new-quiz`, `--billing-v2`, `--rls-fix`), each with its own pod, empty DB, and preview key (`rebase cloud service-key --preview new-quiz`).
- **`why`:** Three hazard icons blocked at the wall: `REBASE_MIGRATE_ON_BOOT`, `ensureCollectionPolicies`, `cron workers`.
- **`guard`:** Route callout: `POST /api/functions/previews/<projectId>` → older server returns `404 previews_unavailable` ("deploys nothing") instead of ignoring an unknown flag on `/deploy` and overwriting prod.

### Proof & Repo Sources

- Read `docs/preview-deployments.md` (lines 18–75) and `CHANGELOG.md` (`0.32.0`: `rebase cloud service-key --preview <name>`).

---

## 09 · One Agent-Safe CLI for Everything — `one-cli`

- **Accent:** `#F59E0B` (terminal amber / `CHROMA.coral` on `confirmation_required` guard)
- **`endCommand`:** `"pnpm dlx @rebasepro/cli init"`
- **`toCorner`:** `{ line: "reach", word: "The" }`
- **`close`:** `{ line: "close", word: "One" }`

### Spoken Script (119 words · lint-verified)

```ts
const SCRIPT = lines([
    ["hook", "Agents are incredible in a terminal right up until a piped script misreads a flag and deletes production."],
    ["reach", "The Rebase CLI drives your whole running app: query rows as JSON or CSV, tail logs, run crons, upload files, or run remote SQL directly."],
    ["proxy", "Target any Cloud project by slug, and requests route through our Studio proxy so your live service key never enters local memory."],
    ["guard", "Pipe a destructive command with no terminal attached, and it stops cold with confirmation-required unless you explicitly approve."],
    ["token", "For CI and background bots, mint a ninety-day token narrowed to deploys and logs, unable to create new keys or overwrite live backups."],
    ["close", "One CLI built for humans at a keyboard and agents in a shell."],
]);
```

### Visual Device & Scenes

- **`reach`:** Rapid command cascade inside one clean terminal:
  - `rebase data query orders --where 'status == "open"' --format csv --cloud`
  - `rebase logs -f --level error --project shop`
  - `rebase storage cp ./banner.webp :media/banner.webp --cloud`
  - `rebase cloud db query "select count(*) from orders" --project shop`
- **`proxy`:** Diagram: `CLI (--project shop)` → `Console Studio Proxy` → `App Runtime` (`REBASE_SERVICE_KEY stays on control plane · 0 secrets in CLI memory`).
- **`guard`:** Agent script runs `rebase data delete orders --where 'status == "draft"' --json` → blocked immediately with `{ "error": "confirmation_required" }` because `--yes` was omitted.
- **`token`:** `rebase cloud tokens create --project shop --can deploy,logs --expires-in 90` showing capability chips (`deploy ✓`, `logs ✓`, `tokens create ✗`, `db restore ✗`).

### Proof & Repo Sources

- Read `CHANGELOG.md` (`0.32.0` lines 110–145 & `0.34.0` line 49 `rebase cloud db query`) and `website/src/content/docs/docs/deployment/cloud-agents.md` (lines 19–100).

---

## 10 · Billed for Physics, Fireable Before Lunch — `honest-cloud`

- **Accent:** `CHROMA.coral` (`#34D399` on zero-seat CMS & same-day `rebase eject`)
- **`endCommand`:** `null` *(end card shows `rebase.pro` — Rebase Cloud is private beta by request)*
- **`toCorner`:** `{ line: "physics", word: "Postgres" }`
- **`close`:** `{ line: "close", word: "And" }`

### Spoken Script (135 words · lint-verified)

```ts
const SCRIPT = lines([
    ["hook", "Two habits in cloud pricing need to die: charging thirty dollars a seat for an admin panel, and selling fake reserved compute on pooled databases."],
    ["physics", "Postgres has zero per-tenant CPU quotas, so multi-tenant clusters cannot reserve anything. On Rebase Cloud, every project gets a dedicated engine."],
    ["dials", "Turn three dials for app, database, and storage, read the itemized price, and invite fifty teammates to Rebase CMS for nothing extra."],
    ["signin", "Owners click Open CMS in the console and land inside their panel already signed in, with zero bootstrap passwords to wire up."],
    ["region", "Place an app in Germany and an external Postgres in Belgium, and the form warns you up front about latency and double egress."],
    ["close", "And because Cloud runs our exact MIT image, a standard dump plus eject moves everything onto your own box the same day."],
]);
```

### Visual Device & Scenes

- **`physics`:** Left card (`Shared Postgres "Reserved" Tier` crossed out: `PostgreSQL has no per-database CPU/RAM quota`) vs. right card (`Rebase Cloud: Dedicated CNPG Instance per project, or BYODB`).
- **`dials`:** The Rebase Cloud create-project resource dials (`App` · `Database (10 GiB+)` · `Storage`) with live itemized monthly figure + badge `50 CMS seats → +€0.00`.
- **`signin`:** Rebase Cloud project header showing the **Open CMS** button → mints 1-minute single-use token → lands straight inside Rebase CMS signed in as `admin`.
- **`region`:** Placement warning callout (`App: Falkenstein · DB: Belgium` → `crossBoundaryWarning`: *"Every query will cross the public internet… expect tens of milliseconds per round trip and egress billed on both sides"*).
- **`close`:** presenter grows back beside `rebase db backup` (`pg_dump`) + `rebase eject` (`Dockerfile`, `docker-compose.yml`, `rebasepro/server` MIT image) + `Private beta · Request access at rebase.pro`.

### Proof & Repo Sources

- Read `saas/OFFERING.md` (lines 10–69), `saas` commit `2c1b0b3` (`the create form sizes a project with dials and itemises its price`) & `d913586` (`10 GiB` default), `CHANGELOG.md` (`0.34.0` line 44: `Open CMS` / `Continue with Rebase Cloud` via `POST /api/auth/platform-signin`), `website/src/i18n/en.ts` (`cloud.status`, `pricing.cloud.*`), and `packages/cli/src/commands/eject.ts`.

---

## Recording Notes for Francesco (`pnpm live`)

- Because every script above avoids spoken CLI punctuation (`--flags` appear only in the `<Terminal>` windows, never in the spoken line), Chrome's recognizer in `pnpm live` will track your voice smoothly without stalling.
- If a phrase feels different in your mouth while rehearsing (`http://localhost:3500/?film=<id>` → **Rehearse** mode), click **Use mine** to write your phrasing back in, then run `pnpm lint:film <id>` once so no accidental word-repeat sneaks in.
