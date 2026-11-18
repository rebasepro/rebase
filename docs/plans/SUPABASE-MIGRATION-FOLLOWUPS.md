# Supabase migration follow-ups

What is left from the feedback written during the Triptelier migration
(Supabase + Vercel → Rebase Cloud, 2026-11-18). The bugs found there are fixed
on branch `claude/migration-feedback-fixes-5af765`; this note covers the items
that are product decisions, live in the control plane (`saas/`), or could not be
reproduced. Each says what was found, what to build, and what to decide first.

## C1. `users delete` answers 500 on Rebase Cloud. Cause is in the control plane

**Found.** The 500 does not come from the tenant. The tenant's runtime log
(`rebase cloud logs --runtime --project triptelier --since 24h`) has a request
line for every call in that window, including the failing ones (`503
EMAIL_NOT_CONFIGURED`, a function's 500), with the error code. The three
`GET /api/admin/users` calls that `users delete` makes first (`resolveUid`) are
there at 11:03:58 and 11:04:03, answered by `uid: "service"`, which is the
Studio proxy's service key. The `DELETE` that follows each one is **not** there.
The user-deletion path itself (`admin-users-route.ts` → `deleteUser`) is
identical in 0.33.0 and 0.33.2 (`git diff v0.33.0 v0.33.2` touches none of it),
so the runtime/bundle skew is not the cause, and the hand-added
`agencies.owner_id → rebase.users(id) ON DELETE CASCADE` never ran.

The request goes CLI → `app.rebase.pro/api/functions/studio/:projectId/proxy/*`
(`saas/backend/functions/studio.ts`) → tenant. A local reproduction of that
proxy's forwarding (Hono + `@hono/node-server`, the same header stripping and
`fetch(…, { body: c.req.raw.body, duplex: "half" })`) forwards a body-less
`DELETE` correctly, so the forwarding itself is not it either. The 500 is
raised in the control plane before or around the forward: `authorizeStudio`,
the framework's function mount, or middleware in front of it.

**Next.** Read the control plane's log for 2026-11-18 ~11:04 UTC
(`kubectl -n rebase-saas logs -l app=rebase-saas-control-plane --since=…`,
which needed a `gcloud` re-auth from this session), for `unhandled request
error` on `/api/functions/studio/35e08cdc-…/proxy/api/admin/users/…`. Then add a
`DELETE` case to `saas/backend/functions/studio.test.ts`, which covers GET and
PATCH only. Nothing was changed in `saas/` from this branch.

## C5. A fresh project's first deploy warns about version skew

`rebase init` scaffolds the CLI's own release (0.33.2) while the managed
runtime image ships the framework it was built with (runtime 1.102.0 →
0.33.0). The warning (`frameworkAheadNotice` in `saas/backend/src/managed/intake.ts`)
is accurate. The fix is in the release process, not in `init`: release a
runtime image with every framework release (`pnpm release:runtime` after the
npm publish), so that "latest CLI" and "latest runtime" agree. Pinning `init`
to the runtime's framework would scaffold an older release than the CLI that
wrote it, which is worse. Decide: make the runtime release part of the stable
release checklist (`stable-release-gates-and-traps`), and until then soften the
notice to say "a newer runtime is on its way; nothing to do" when only the
patch differs.

## C7. `rebase cloud db import --from <url>`

`rebase cloud db query -f` (added on this branch) applies SQL with no local
client, but a data import needs `COPY`, which the simple query protocol over
the tunnel cannot stream from a file. Build `cloud db import` as a control-plane
job, not a CLI loop: the control plane already reaches the tenant database, so
it can run `pg_dump --data-only <source> | psql <tenant>` in a pod (the source
URL given once, never stored), and report rows per table. Decide: which source
schemas (default `public`, plus Supabase's `auth.users` mapped to
`rebase.users` with ids kept), and whether a running deployment is paused
during the import.

## Item 2. A home for SQL functions, triggers and CHECKs

`schema introspect` now writes the objects it cannot carry to
`backend/sql/introspected-left-behind.sql`, and `rebase cloud db query -f`
applies it. What is missing is the lifecycle: nothing applies `backend/sql/`
on `db push`, at boot, or when a preview database is made, and nothing checks
it was applied.

Proposal: `backend/sql/*.sql`, applied in file-name order after the tables, by
`db push`, by the provisioning boot (not by `REBASE_PROVISION=false`
processes), and by preview creation; each file recorded by name and hash in
`rebase.sql_files`, re-applied when its hash changes, so files must be
idempotent (`CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS … CREATE TRIGGER`).
`doctor` reports a file whose hash differs from the one applied. Atlas does not
inspect functions or triggers (see `undeclarable-constraints.ts`), so the
planner will not fight them. Decide: whether a file may contain DDL on a
declared table (refuse, as `rebase.sql()` does), and how a removed file is
undone (it is not; say so).

## Item 3. Public RPC

A Supabase client's `rpc('fn')` maps today to a custom function that calls the
SQL function through `getSql(c)` (shown in the new
[Migrating from Supabase](../../website/src/content/docs/docs/recipes/migrate-from-supabase.md)
guide). For an app with forty functions that is forty handlers. Proposal:
`defineRpc("get_public_proposal", { access: "public" | "authenticated", args: json.object(…) })`
in `backend/rpc/`, mounted at `POST /api/rpc/<name>`, validating `args`, and
calling the function as the request role (`getSql`, so RLS and `SECURITY
DEFINER` behave as in Supabase). Decide: whether `access: "public"` is allowed
without a rate limit (no: reuse `function-rate-limits`), and whether the SDK
gets `rebase.rpc(name, args)`.

## Item 5 (rest). `db push` and policies, and defaults that call `rebase.*`

Fixed on this branch: a foreign-key drop prompts, `uuid → text` is lossless.
Two remain:

- `ALTER COLUMN … TYPE` on a column a policy reads fails with "cannot alter
  type of a column used in a policy definition". The push should, inside its
  transaction, drop the policies that reference the column, alter it, and
  recreate them (their definitions are in the desired state, so the planner
  knows them). Atlas plans the ALTER only; the dependency has to be added by
  our wrapper (`atlas-apply-report.ts` runs the plan).
- A column default that calls `rebase.uid()` fails Atlas's validation database,
  which has no `rebase` schema. Introspection no longer writes one (an
  `auth.uid()` default is now `.onCreateUser()`), but a hand-written one still
  fails. Create the `rebase` helper functions in the dev database Atlas
  validates against, from the same SQL boot uses.

## Item 8. Redirects for static apps

`vercel.json` / Netlify `_redirects` are host- and query-conditional, which
the static mount cannot express. Proposal: a `redirects` array on a static app
entry in `rebase.json`,
`{ "from": "/old/:path*", "to": "/new/:path*", "status": 308, "host"?: "…", "query"?: { "k": "v" } }`,
compiled into the bundle manifest and applied by `serveSPA` before files, and
on Rebase Cloud at the edge. Decide the matching syntax (Vercel's `:param*` is
the most familiar) and whether `rebase migrate` converts `vercel.json`.

## Item 10 (rest). Bulk user import keeping ids

`rebase users create --no-invite` (this branch) covers one account. An import
needs ids kept, so foreign keys to the users table still match. Proposal:
`rebase users import users.csv|json` → `POST /api/admin/users/import` (admin
only), accepting `id`, `email`, `displayName`, `createdAt`, `emailVerified`,
never a password hash from another system unless its algorithm is declared,
and sending no email. `CreateUserData` needs an optional `id` across both
repositories.

## Item 13. `init --yes` writes agent files for every assistant

The rule files for every assistant are template content (one copy of the rules
per assistant, so a teammate on another tool gets them), and the block written
into an enclosing repository's `CLAUDE.md` / `AGENTS.md` is deliberate (an
assistant started at the repository root otherwise never sees the project's
rules; see `utils/root-pointer.ts`). This branch makes `init` say that the
root block is outside the project and that `REBASE_ROOT_RULES=0` skips it.
Decide: whether `--yes` with no `--agent` should ship only `AGENTS.md` (the
cross-tool file) and leave the per-assistant files to `rebase skills install`.

## Item 17. The 30 s function timeout

Kept as the default: it bounds what a wedged handler holds. The 504 now names
`REBASE_FUNCTIONS_TIMEOUT_MS`, and the migration guide says to raise it for an
edge function that calls an LLM (Supabase allows 150 s). Decide whether a
function file may declare its own timeout (`defineFunction(…, { timeoutMs })`),
which is what ported LLM functions want.

## Item 18. Dev port moved from 3082 to 3083

Not reproduced: one sighting, after a fast stop/start, when the old process may
still have held the port. `rebase dev` already prints the move
(`portMovedNotice`), and `rebase dev --port` pins it. No change.

## `rebase migrate supabase`

The pieces now exist separately: Supabase-aware `schema introspect` with the
left-behind report, `cloud db query -f`, `users create --no-invite`,
`MAGIC_LINK_URL` templates, the migration guide. A `rebase migrate supabase
--from <db-url>` would run them in order (introspect into a fresh project,
write `backend/sql/`, port edge functions with a codemod for `Deno.serve`,
`Deno.env.get` and `createClient(…service_role…)`, import data keeping user ids,
copy a bucket), stopping before anything writes to production. It depends on
items 2, 3 and C7 above.
