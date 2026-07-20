# Changelog

## [Unreleased]

## [0.10.0] - 2026-07-20

### Breaking

- **The authenticated principal is `uid` everywhere** — the identity had two names. `uid` was the domain model's: the `User` type, the `AuthenticatedUser` adapter contract, the driver scope, and the RLS layer, where policies read `auth.uid()`. `userId` was the JWT claim's, inherited by the Hono request context because it was populated straight from the decoded payload. A request crossed that boundary twice, so a route handler and a collection hook two frames apart saw the same person under different keys — and three unrelated places had independently grown the same defensive `a ?? b` read to cope. `uid` wins because `userId` was confined to four server-side packages while `uid` is the vocabulary of twelve, and because the two ends of the stack — Postgres policies and the client SDK — already agreed on it.

  Tokens now carry a `uid` claim and `c.get("user")` returns `{ uid, roles }`. Anything reading `payload.userId` or `user.userId` must move.

- **ESM only — the CJS/UMD output is gone** — the packages shipped both, but the output banner injects `import` / `import.meta.url`, which a UMD bundle cannot parse as CommonJS, so the CJS half was never loadable. `main`, `module` and the `import` condition all point at `index.es.js`; the `require` condition is removed. A CommonJS consumer must `import()` or move to ESM.

- **`id` is an address, not a column** — the synthesized `id` was written into rows on the way out, where it collided with the data three ways: it renamed the key (a `sku` primary key was served as `id`, with `sku` absent entirely), it changed the type (an integer key reached the SDK as `"42"`), and it destroyed real values, because `drizzleResultToRow` spread it last so it would win over a raw `id` column. Rows now carry their own columns under their own names and types. Code reading `row.id` on a table not keyed on `id` must read the real key.

- **A write naming a field the collection lacks is a 400** — unknown keys used to travel into the INSERT, so a typo came back as `column "titel" does not exist`, phrased by Postgres from a stack the caller cannot see, and only when the column really was absent. The `id` case is called out specifically: `create(data, id)` writes the id argument as an `id` column, which is meaningless for a table keyed on `sku`, so the error names the real key instead of sending someone hunting for an `id` they never wrote. Bulk writes are checked before the transaction opens and report the offending row index.

- **`policy.authenticated()` no longer matches anonymous requests** — it compiled to `auth.uid() IS NOT NULL`, a tautology on the user path: `applyAuthContext` coerces a blank user id to the `'anonymous'` sentinel precisely so it cannot read back as NULL and pass for the trusted server context. So a rule reading as "logged-in users only" granted full access to anonymous visitors, and neither the type system, the DDL generator nor `checkPolicyDrift` said a word. `not(authenticated())` was separately special-cased to mean "is the server context", which the default policies leaned on — so both spellings moved together. Review any rule built on either.

  **Upgrading does not change your database.** The compiled SQL lives in `pg_policies`, so an existing app keeps the permissive `auth.uid() IS NOT NULL` until `db push` runs again — and `checkPolicyDrift` will not say so. It compares policy presence, roles and command, not expression text (Postgres rewrites `qual` on store, so text comparison reports drift that does not exist), and the policy name is a hash of the rule *as written in config*, which did not change. A stale permissive policy therefore matches the expected one on every field the checker looks at and `db doctor` reports clean. Read the qual out of `pg_policies` directly to confirm. See [Upgrading](https://rebase.pro/docs/upgrading).

- **22 retired package names deprecated on npm** — the names the repo no longer publishes now carry a deprecation notice pointing at their replacement, so an install of an old name says so instead of silently resolving to an abandoned version.

- **Package renames** — packages are now named for their role, not their position. `core` was frontend-only React while `server-core` was the actual core of the product; they shared a word and were otherwise unrelated. `client-firebase` depended on `admin`/`core`/`ui`, so it was a UI integration wearing a client-SDK name. Import paths are the only change — no behavior moved with them.

  | Old | New |
  |----------|----------|
  | `@rebasepro/core` | `@rebasepro/app` |
  | `@rebasepro/server-core` | `@rebasepro/server` |
  | `@rebasepro/server-postgresql` | `@rebasepro/server-postgres` |
  | `@rebasepro/server-mongodb` | `@rebasepro/server-mongo` |
  | `@rebasepro/client-postgresql` | `@rebasepro/client-postgres` |
  | `@rebasepro/client-firebase` | `@rebasepro/firebase` |
  | `@rebasepro/formex` | `@rebasepro/forms` |
  | `@rebasepro/sdk-generator` | `@rebasepro/codegen` |
  | `@rebasepro/schema-inference` | `@rebasepro/inference` |
  | `@rebasepro/mcp-server` | `@rebasepro/mcp` |
  | `@rebasepro/plugin-data-enhancement` | `@rebasepro/plugin-ai` |

  Unchanged: `types`, `utils`, `common`, `client`, `ui`, `admin`, `studio`, `cli`, `plugin-insights`.

- **`@rebasepro/auth` removed** — it was one hook and an API helper whose only dependency was `@rebasepro/types`, and it always had to be installed alongside `core` anyway. `useRebaseAuthController`, `fetchAuthConfig`, `createAuthConfigCache` and `clearAuthConfigCache` now come from `@rebasepro/app`, beside the `RebaseAuth` and `LoginView` components they are used with. The auth *system* was never here — it lives in `@rebasepro/client` (`client.auth`) and `@rebasepro/server`.

- **`defaultSecurityRules` moved off the server config** — it lived on `RebaseBackendConfig`, was applied to the in-memory registry, and enforced nothing: `db push` generates the Postgres policies — the only thing that actually enforces access — from the collection *files*, and never sees the running server. Declare it in `config/collections/index.ts` instead, where the loader reads it and both the runtime and `db push` see the same thing. Its old doc also claimed collections without rules were "unrestricted"; they are locked to admin-only by the generator. In `baas` mode there are no collection files and no `db push`, so the database's own RLS is the whole model and there is nothing to default.

  ```ts
  // config/collections/index.ts
  export const defaultSecurityRules: SecurityRule[] = [
      { operation: "select", access: "public" },
      { operations: ["insert", "update", "delete"], roles: ["admin"] }
  ];
  ```

- **A collection file that fails to import is now a hard error** — the loader used to log and continue, which turns a broken file into a missing API route and a missing policy, with a successful exit code. Both read as "no data" rather than as a failure.

- **`RebaseCMS` → `RebaseAdmin`** — the component now matches the package it ships from. `mode: "cms"` on `RebaseBackendConfig` is unchanged: it describes where collections come from (config vs database), not the UI.

- **BaaS mode does not serve tables without row-level security** — see Fixes. A table with RLS disabled is skipped and named at boot; `baas: { unprotectedTables: "serve" }` restores the old behavior.

### Features & Improvements

- **Presence and broadcast channels in the SDK** — the realtime engine had supported `join_channel`, `broadcast` and the presence messages for a while, but the client could only send them fire-and-forget: no methods to call them, and no way to receive channel events, since `on()` handled only connect/disconnect/reconnect/error. Anything wanting presence opened a second socket and reimplemented the authenticate handshake, the reconnect backoff and the presence heartbeat — a couple of hundred lines per app, duplicating this package. `client.realtime.channel(name)` now provides `track` / `onPresence` / `broadcast` / `onBroadcast` / `leave`, with channels as per-name singletons so two components cannot cut each other off by leaving. It also hides two protocol details discoverable from neither the message list nor the docs: a joining client is told only about its own join, so `join()` sends an explicit `presence_state` to get the roster; and presence expires after 30s, so tracking is re-sent on a heartbeat.

- **Ordered, replayable per-channel history** — broadcast was fire-and-forget to whoever happened to be connected. Enough for presence and for "someone saved"; not enough for op-based collaborative editing, where a client that blinks out for two seconds had to resync a whole document rather than catch up on the four operations it missed. Every broadcast on a retained channel now gets a per-channel sequence number, allocated by the same statement that stores it, so a reconnecting client can say where it got to and receive only what it missed. Retention is server-side and opt-in (`realtime.channels`, matching exact names or a trailing `*` prefix) — a channel is created by whoever names it, so a client-supplied history depth would let any visitor commit the backend to unbounded storage. With no rules configured nothing is written, no table is created, and broadcast runs the same synchronous path as before.

- **Per-object authorization for storage** — storage routes authenticated but did not authorize. `requireAuth` and `publicRead` are global switches: they decide whether a caller must be signed in, not what that caller may touch, so any authenticated user could read any key they could name. For multi-tenant apps the only thing between two tenants' files was key unguessability, which is not an access-control model. `storageAuthorize({ key, bucket, operation, user })` is the storage analogue of a collection's security rules; denials are 403, and a hook that throws denies too, so a failed ownership lookup cannot fall open. The load-bearing placement is `/metadata` rather than `/file/*`, because `/metadata` mints the short-lived path-scoped download token that `/file/*` trusts — and it minted one for any authenticated caller for any path. Listing is gated on the prefix, since a listing is how you discover keys nobody told you about, and TUS is gated at create time so a denied upload leaves no temp file to resume.

- **Bulk writes and upsert** — only single-row create/update/delete existed, so a ~10k-row ETL had no way to express itself and dropped to `admin.executeSql` with hand-bound parameters, which is where injection bugs live. `createMany(rows, { upsert: true })` is available on both the HTTP and server-side clients, and as `POST /api/data/:collection/bulk`. Every row still runs the normal pipeline — callbacks, relations, RLS — because `saveMany` reuses `save()`; the win is that the batch shares one transaction and one round trip. `upsert` is `INSERT ... ON CONFLICT DO UPDATE` on the primary key, one statement, so it cannot lose the race a read-then-write can.

- **Junction tables inherit the security model instead of escaping it** — a `through` relation makes the generator create a table nobody declared, and those were the one kind of generated table with no RLS at all. Since `rebase_user` holds full DML grants, any signed-up user could read or wipe every edge between two locked-down endpoints (3,648 rows on the live demo), and there was nowhere to write rules for a junction anyway. A junction's security is now derived: the same locked server-or-admin baseline every collection gets; reads follow the endpoints via two correlated `EXISTS` subqueries that run under the caller's role, so visibility is delegated rather than copied and endpoint policy changes propagate with no junction change; and writes follow the owning side, because linking an edge is editing the owning row.

- **Account linking** — the `EMAIL_NOT_VERIFIED` rejection on OAuth sign-in told users to link the provider from their profile, but no such endpoint existed; the only link route was anonymous→password, so the error was a dead end. An authenticated `POST /auth/link/:provider` now attaches a provider identity to the current account, with a matching client `linkProvider()`. Linking deliberately does not require a verified email or matching addresses: on sign-in the provider's email is the only evidence tying an identity to an account, so an unverified address would allow takeover, but here the caller already proved ownership with a valid session. Refuses with 409 `IDENTITY_ALREADY_LINKED` when the identity belongs to another user, and is idempotent for the caller's own.

- **Cron is coordinated across instances** — every app instance ran every cron job, since the scheduler is in-process `setTimeout` and the executing flag only guards within one process, so N replicas meant N executions per tick. Handlers stay app-level closures; only the mutual exclusion moves to the database, where each instance derives the same scheduled fire time from the cron expression and atomically claims the slot.

- **`rebase cloud` reaches operational parity** — project slugs replace UUIDs across every user-facing surface (`--project` takes the subdomain the console URLs show; raw UUIDs still resolve for old scripts and link files), plus `rebase cloud debug` for diagnosing deployed projects and `rebase cloud storage create` / `attach`. `rebase init` gains real `--project` / `--setup-key` handling — the setup page advertised both flags while permissive arg parsing silently swallowed them.

- **Tail-follow logs explorer in Studio** — sticky auto-scroll with a new-entry pill.

- **Admin: the RLS editor offers the roles that actually exist** — it listed native PostgreSQL roles from `pg_roles` when picking values for `SecurityRule.roles`, which matches the strings on the users table via `auth.roles()`. Choosing `public` or `rebase_user` there compiled to a condition no user could satisfy. `fetchApplicationRoles` now sits alongside `fetchAvailableRoles` across the `SQLAdmin` surface, and the doc comments on both fields spell out which is which.

- **Admin: an unsaved-changes guard for split and entity views**, with shared view-mode routing.

- **`pnpm verify:docs`** — typechecks documentation code fences against the workspace SDK, so a doc that names an API the code does not have fails instead of aging quietly.

- **BaaS mode — a REST API over your database with no collections at all** — `mode: "baas"` derives collections from the live database at boot instead of loading config files. Every protected table becomes a REST resource, with types, primary keys and relations read from `information_schema`; the drizzle tables the query layer needs are built in memory, so no generated `schema.generated.ts` is required either. Change the schema with a migration and the API follows. Join tables are skipped, the schema editor is off (it exists to write config files), and no React enters the backend's module graph. `introspectionSchema` on the Postgres adapter selects a schema other than `public`.

- **The SDK works with no collections** — `rebase.data.collection("posts").find()` needs only a table name against a BaaS backend: no collections map, no generated types, nothing to declare. The optional `collections` option exists only to pin non-obvious slugs.

- **`rebase init --flavor baas`** — scaffolds a headless project: `backend/` alone, no `config/`, no `frontend/`, and no UI package in the install tree. Without `--flavor`, `init` asks: *BaaS + admin* (default) or *BaaS only*.

- **`rebase doctor --policies`** — diffs `pg_policies` against the policies your collections generate, reporting missing, orphaned and diverged, and exits non-zero so CI can gate it. Policies live in Postgres and the config is only their source; nothing reconciled the two, so a stale policy outlived every config fix. Reuses `generatePostgresPoliciesDdl` — the same function `db push` applies — so it compares against what would really be written. It also reports policy roles this server can never assume, without booting one. Policy *expressions* are deliberately not compared: Postgres rewrites `qual`/`with_check` on storage, and a check that cries wolf gets ignored.

- **One definition of "the collections"** — the runtime, the drizzle-schema generator, the policy generator and the doctor each scanned the collections directory themselves, four copy-pasted filters agreeing by discipline rather than construction. A drift between them would serve one set of collections while pushing policies for another. They now share one loader, exported from `@rebasepro/server`.

- **Guards for the two failure modes that ship silently** — `pnpm run check:headless` imports every collection file and server package under a loader hook that rejects React, so a UI import cannot creep back into the backend. `pnpm run check:names` fails on references to renamed packages and duplicate dependency keys. Both run in CI. A new BaaS e2e installs a scaffolded project from real tarballs and boots it against tables it was never told about — the only place `workspace:*` resolves, so the only thing that proves the templates rather than the library.

### Fixes

- **A signup with a typo'd field is now a 400, not a silent 201** — a write to an auth-enabled collection skipped unknown-field validation entirely, because a signup body carries `password` and provider fields the users table does not declare as columns. The skip was total, so `POST /api/data/users` with an undeclared `emial` returned 201 and dropped the field, while the same typo on `posts` was a 400 — directly contradicting the Breaking note above. The exemption is now scoped to exactly the fields the auth adapter consumes (the built-in one names `password`); everything else is validated as on any collection. An auth collection with a custom `onCreateUser` hook opts out, since the hook then owns the body's shape.

- **`POST /auth/refresh` with no session is a 401, not a 400** — clients refresh on page load before they know whether a session exists, so a first-time visitor with no token is the most common way the route is called. It answered `400 INVALID_INPUT` and logged a warning for every anonymous page view. Absent-token is now `401 NO_SESSION`, logged at debug; a present-but-malformed token is still a 400. `ApiError` gained an `expected` flag (and an `unauthenticated()` factory) so a routine outcome no longer looks like an incident in the logs.

- **The generated `docker-compose.yml` could not boot** — `63108aa90` made the server refuse to start with local storage under `NODE_ENV=production`, on the grounds that the container filesystem is destroyed on the next restart and uploads go with it. The scaffold's compose file sets `NODE_ENV=production` and *does* mount a durable named volume at the storage path, which is the exact case the check tells you to acknowledge with `FORCE_LOCAL_STORAGE=true` — but the template never set it. So `docker compose up`, the "recommended for production" path in every scaffolded README, crash-looped the backend with `Failed to start server`. The flag is now set in the template, next to the volume that justifies it. This was invisible for days because the e2e step that would have caught it sits behind a step that was already failing.

- **`init --database-url` shipped a compose stack with the password `changeme`** — `DATABASE_PASSWORD` was only written on the branch that generates a local database. Supply your own `--database-url` and it was omitted entirely, so `docker-compose.yml`, which interpolates `${DATABASE_PASSWORD:-changeme}` into both `POSTGRES_PASSWORD` and the backend's connection string, fell back to the literal default — on a `db` service that publishes a host port. The password is now generated in both cases; the supplied URL is untouched.

- **`rebase init` told you things that were not true** — the next steps were assembled from the flags you passed rather than from what actually happened. `--introspect` without `--install` printed "Skipping introspection because dependencies were not installed" and then, four lines later, "Database has been introspected & collections generated!" — the second line branched on the flag, never on the outcome. It now reports what really ran, and when introspection did not, it prints the `schema introspect` and `schema generate` commands that finish the job. In the same pass: the `cd` hint used the project's basename, so `init apps/my-app` said `cd my-app` — a directory that does not exist from where you are standing — and `init .` told you to `cd` into a directory you were already in; both now use the path you typed, and in-place scaffolds print no `cd` at all.

- **`rebase init --help` printed the wrong help** — `init` was missing from the dispatcher's namespaced-command list, so `--help` fell through to the global command index. `--template`, `--flavor`, `--yes`, `--database-url`, `--introspect`, `--project` and `--setup-key` were documented in exactly one place: the error you get for running init on a non-TTY. You had to trigger a failure to discover the flags. `init` now has its own help, and a test fails if a flag the parser accepts goes undocumented.

- **`--git` left the work half-done** — it ran `git init` and stopped, leaving every scaffolded file untracked on whatever `init.defaultBranch` happened to be, so the first `git diff` was noise and the first commit was the user's problem. It now lands an initial commit on `main`, authored by the user's own git identity where one is configured. `.gitignore` is in place before the commit, so `.env` and its generated secrets are never in it while `.env.example` is.

- **`--template` was accepted and discarded for the baas flavor** — baas has no collections, so a preset has nothing to swap; the flag was taken silently and the scaffold came out identical either way. It now says the preset is being ignored, and the help spells out that `--template` does not apply to baas.

- **OAuth token substitution allowed account takeover** — the Google path resolved client-supplied access tokens through the userinfo endpoint, which does not check `aud`, so any valid Google access token — including one an attacker obtained for their own OAuth client — was accepted and resolved to whatever account it belonged to. The audience is now verified against our `clientId` via tokeninfo before the identity is trusted, and ID-token paths read the real `email_verified` claim instead of hardcoding it. On Microsoft, `emailVerified` is derived from a provider-provisioned `mail` mailbox rather than asserted `true`, so a bare userPrincipalName can no longer auto-link an OAuth login onto a pre-existing password account. CORS, rate limiting and vector SQL were hardened in the same pass.

- **`/admin/bootstrap` was a land-grab** — the self-promotion endpoint only refused to run once an admin already existed. In a "users exist but no admin" state — reachable via concurrent first-registrations, or by deleting the first user — any authenticated user could seize the initial admin role. It is now gated to the earliest-registered user, deterministically tie-broken by id, with security-audit logs on both the denial and the success.

- **The API served password hashes** — `/api/data/users` returned every user their own `passwordHash` and `emailVerificationToken`. RLS scoped the row to the caller so this was not a cross-user leak, but a salted hash is offline-crackable and a verification token can be replayed. The users collection only marked them `ui.hideFromCollection`, which stops the admin panel from *rendering* a field and leaves it in the JSON.

- **The data API was rate-limited by API key only** — the limiter returned early for any request that carried no API key, so JWT and anonymous traffic — most of what a BaaS serves — was unbounded, and it was mounted only `if (apiKeyStore)`, making its presence depend on a feature it does not need. Every request now falls in exactly one bucket, resolved most-specific first: API key by id, signed-in user by uid, everyone else by IP.

- **Storage had no effective upload size cap** — the `bodyLimit` was registered *after* the routes, so Hono never ran it. A wrapper router now applies it in front. Storage also accepts API keys under a new `storage` permission namespace (read/write/delete), where `rk_` tokens previously 401'd as malformed JWTs.

- **API keys and admin surfaces** — the builtin auth adapter no longer authenticates `?token=` query params, which could leak full JWTs and the service key into access logs (the non-adapter middleware already refused them). Admin API keys now genuinely reach admin surfaces, with `rk_` pre-auth running in front of `/admin/*`, cron, backups and logs.

- **A purpose-scoped token is not an access token** — every storage token is signed with the same secret, so a signature says the server minted it, not what it is for. A download token travels in URLs and grants one file; it was rejected as a session only because it happens to carry no id, and nothing stopped a future one from carrying one. `verifyAccessToken` now refuses any token with a `purpose` claim outright. No live hole was found — this is defence in depth.

- **Superseded RLS policies survived `db push`** — a generated policy is named after a hash of its own semantics, so editing a `securityRule` writes a policy under a new name, and `policies.sql` only DROPs the names it is about to CREATE. Because Postgres ORs PERMISSIVE policies together, a superseded `USING (auth.uid() IS NOT NULL)` kept granting everything no matter how tight its replacement was — and push reported success throughout, so tightening a rule looked like it had worked and hadn't.

- **A pooled connection could leak its RLS GUCs** — when the client-side `query_timeout` fires inside a drizzle transaction, pg rejects the promise but keeps the connection and splices queued queries, so drizzle's ROLLBACK times out without ever reaching the wire and the `finally` releases the client back to the pool with no error. pg-pool then re-pooled it mid-transaction with the `app.*` GUCs still set, and the next checkout ran inside the zombie transaction under someone else's auth context.

- **Relation batching guessed on composite keys** — batching matched parents on `parentPks[0]`, so two rows of a composite-keyed collection differing only past the first column collapsed together: `tenant_id IN (1, 1)` collected every row of tenant 1 and filed them all under `"1"`, last write winning. Each booking of a tenant was handed its neighbour's relations, and nothing errored. The WHERE is now an OR over whole keys, or it refuses rather than guess.

- **Ephemeral local storage is refused in production** — `STORAGE_TYPE` defaults to `local`, which on a managed platform is the pod's ephemeral filesystem: every uploaded file destroyed on the next restart, with no error at write time, no error at read time, and a warning nobody reads until the data is gone. Boot now fails instead. `FORCE_LOCAL_STORAGE=true` remains the opt-in for a deployment with a real volume mounted. GCS env vars were added alongside, local bucket defaulting made symmetric, and list paging fixed.

- **Subscriptions could hang forever** — a collection view could sit on its loading spinner indefinitely with no error until reload. `subscribe_collection` / `subscribe_one` are in the `expectsResponse = false` set, so unlike ordinary requests they had no timeout, and a subscribe that got no reply left the subscription pending forever; a subscribe whose send rejected — a token refresh losing a cold-load race — failed the same silent way.

- **The service key did not authenticate websockets, and channel messages lost their envelope** — channel payloads are now wrapped consistently, and the realtime socket connects lazily rather than in the constructor, so constructing a client no longer opens a connection.

- **Realtime told subscribers the wrong name for their rows**, and a save now names the row it saved rather than deriving an address the caller never asked for.

- **The doctor reported drift on a clean project**, and the schema tooling now says which RLS policies you did not write and how to drop them.

- **`rebase init` failed when installed from npm**, hung on a non-interactive terminal, and defaulted to the wrong package manager; `pnpm start` now filters the backend workspace by path, storage subcommands dispatch correctly, and a stale build warns instead of behaving mysteriously. macOS deploy contexts are handled — AppleDouble tar entries suppressed, dotfiles skipped in directory loaders, and the 100MB upload cap pre-checked.

- **Postgres errors surfaced as opaque 500s** — the underlying error is now reported, and a legacy auth schema is reconciled on boot.

- **Admin: a navigated entity is addressed by the path it was fetched by**, field bindings in `DEFAULT_FIELD_CONFIGS` are read lazily, and the two `WhereFilterOp` definitions now fail loudly when they drift instead of silently disagreeing.

- **Studio: the views that were lying** — an RLS editor crash, dark-mode controls, a revoke confirmation, and the policies those views disowned.

- **BaaS mode served every table to every authenticated user** — it introspects all tables, `ensureAppRole` grants `rebase_user` `SELECT/INSERT/UPDATE/DELETE` across the schema, and nothing enabled RLS, because that only happens via `db push`, which BaaS never runs. Pointing Rebase at an ordinary database therefore exposed every row of every table. A table with RLS disabled has no authorization model, so it is now excluded and logged with the `ALTER TABLE` needed to protect it. Tables with RLS enabled but no policies are served and return nothing — legal, and indistinguishable from an empty table, so that is called out at boot too.

- **Security rules targeting an unusable Postgres role now fail the boot** — `pgRoles` sets a policy's `TO` clause, so naming a role requests never run as means the policy never applies and RLS filters every row. The table reads as empty, which is indistinguishable from having no data, so the mistake shipped. Boot now throws, naming the collection and role, with a specific hint for Supabase's `authenticated`/`anon`/`service_role`.

- **The demo app's collections were empty** — every collection but `users` granted `pgRoles: ["authenticated"]`, a Supabase role name, while requests run as `rebase_user`. RLS filtered every row; `authors` and `posts` granted `TO public`, which is why they were the only two showing data. They now use the documented API (`select: public`, writes `admin`), the same shape `rebase init` scaffolds. The generated `drizzle/policies.sql` carried the same policies and is regenerated — it is what `db push` applies, so the config alone would have changed nothing.

- **The service key did not authenticate websockets** — the HTTP middleware compares it before JWT verification; the websocket path went straight to `extractUserFromToken`, and a static secret can only ever fail that. Any SDK client using a service key (scripts, cron, server-to-server) got `jwt malformed` on every connect and silently received no realtime events.

- **`collection-file → UI package` imports no longer drag React into the backend** — `users.ts` imported `resetPasswordAction` from `@rebasepro/admin`, so the Node backend loaded the entire admin bundle at boot. The action is already injected frontend-side for `auth` collections, making the import redundant. `@rebasepro/admin` is also gone from the config and backend templates, and `@rebasepro/core`/`ui` from `@rebasepro/auth` — none were imported.

### Testing

- **CI had been red for three days on a bug in the test, not the product** — every commit since 2026-07-17 failed the browser e2e with `Local API request failed with status: 401`, and Publish kept shipping canaries past it. The suite writes `REBASE_SERVICE_KEY` into the scaffolded `.env` with a regex, and the regex put `\s*` before the variable name — where `\s` matches newlines. While the CLI shipped that line commented out, the `#` anchored the match and it worked. `259ef0b7a` made the CLI write the key uncommented, so the leftmost match began at the end of the *previous* line and swallowed the newline, welding the assignment onto the comment above it. dotenv then read the whole line as a comment, the server auto-generated its own key, and every service-key request was rejected — a failure three layers away from its cause. The writer is line-based now, and asserts the variable landed on a line of its own instead of trusting the write.

- **The e2e suites refuse to run when their port is taken** — both suites pin a port (3099, 3098) and assert against it, but `rebase dev` falls back to another port when one is busy, so the browser step drove whatever else happened to be listening. A dev server left running in a git worktree held 3099 and silently served the entire local run — including a database that had already been torn down, which is a convincing way to produce failures that have nothing to do with your change. Startup now stops with the squatting pid and command named, and the port is overridable via `E2E_BACKEND_PORT` / `E2E_BAAS_BACKEND_PORT`.

- **Every `init` template is now driven to a persisted row** — the e2e suite scaffolded one project, in one shape, and checked that tables and indexes existed. A template could scaffold, typecheck and migrate cleanly while being unable to store anything, and nothing would say so. `test/e2e/templates.test.ts` takes all six preset × flavor combinations through the path a user actually walks: scaffold, install, bootstrap a real PostgreSQL database, boot the backend, register, log in, write over the HTTP data API, read back, and confirm the row in Postgres — because an API that echoes what it was sent passes every assertion short of the last one. The baas cases additionally assert the security posture the flavor is built on: a table with no row-level security must **not** be served, the boot log must name it and say how to fix it, and once a policy exists, `auth.uid()` must hide one user's rows from another.

- **`rebase init`'s output is under test** — `test/e2e/init-ux.test.ts` pins the reporting defects above so they cannot return: next steps that contradict what happened, a `cd` that points at a directory that does not exist, undocumented flags, an uncommitted `--git` tree, and a silently discarded `--template`. It drives the real binary and installs nothing, so it runs in about three seconds.

- **`test/` is typechecked** — the build config only ever included `src`, so the e2e suites could drift out of sync with the code they drive and fail only at runtime, minutes into a docker-backed run. `tsconfig.test.json` (`pnpm typecheck:test`) covers them; it caught a missing import while this was being written.

- **A stale `dist/` fails loudly** — the e2e suites link the workspace packages and load their build output, so an unbuilt tree silently tests yesterday's code. This surfaced as `Permission denied on "posts"` — a failure with no visible connection to its cause. The suite now checks that every linked package's `dist/` is newer than its sources and, if not, names the packages and the build command instead of running.

## [0.9.0] - 2026-07-13

### Breaking

- **Entity → Entity vocabulary rename** — The `Entity` noun has been removed from the entire public API surface. Every type, hook, component, prop, config key, and wire-protocol message that previously used "entity" now uses "entity" (or, in backend callbacks, the flat database term "row"). This is a search-and-replace-level migration for consumers — no behavioral changes. The full rename map follows.

  **Types (`@rebasepro/types`)**

  | Old Name | New Name |
  |----------|----------|
  | `Entity<M>` | `Entity<M>` |
  | `EntityCollection<M>` | `CollectionConfig<M>` |
  | `EntityCallbacks<M>` | `CollectionCallbacks<M>` |
  | `EntityValues<M>` | `EntityValues<M>` |
  | `EntityStatus` | `EntityStatus` |
  | `EntityReference` | `EntityReference` |
  | `EntityView` | `EntityCustomView` |
  | `EntityAction<M>` | `EntityAction<M>` |
  | `EntityActionClickProps<M>` | `EntityActionClickProps<M>` |
  | `EntityFormProps` | `EntityFormProps` |
  | `EntitySidePanelProps` | `EntitySidePanelProps` |
  | `SideEntityController` | `SideEntityController` |
  | `EntitySelectionProps` | `EntitySelectionProps` |
  | `EntityPreview` | `EntityPreview` |
  | `EntityCollectionView` | `DataCollectionView` |
  | `EntityCard` | `EntityCard` |
  | `EntitySelectionTable` | `EntitySelectionTable` |

  **Collection config props**

  | Old Prop | New Prop |
  |----------|----------|
  | `entityViews` | `entityViews` |
  | `entityActions` | `entityActions` |
  | `openEntityMode` | `openEntityMode` |
  | `includeEntityLink` | `includeEntityLink` |
  | `entityId` (in panel props) | `entityId` |

  **React hooks & components (`@rebasepro/admin`)**

  | Old Name | New Name |
  |----------|----------|
  | `useSideEntityController()` | `useSideEntityController()` |
  | `useEntitySelectionDialog()` | `useEntitySelectionDialog()` |
  | `SideEntityProvider` | `SideEntityProvider` |
  | `mergeEntityActions()` | `mergeEntityActions()` |
  | `resolveEntityAction()` | `resolveEntityAction()` |
  | `resolveEntityView()` | `resolveEntityView()` |
  | `editEntityAction` | `editEntityAction` |
  | `copyEntityAction` | `copyEntityAction` |
  | `deleteEntityAction` | `deleteEntityAction` |

  **Callback API (`CollectionCallbacks`)** — beyond the rename, the parameter shapes changed:

  | Old Param | New Param | Notes |
  |-----------|-----------|-------|
  | `entity` (in `afterRead`) | `row` | Now a flat `Record<string, unknown>`, not a `Entity<M>` wrapper |
  | `entityId` (in save/delete) | `id` | `string \| number` |
  | `previousEntity` | `previousValues` | `Partial<EntityValues<M>>` |
  | `afterCreate` / `afterUpdate` | `afterSave` | Use `status: "new" \| "existing"` to distinguish |

  Migration example:
  ```diff
  -import type { EntityCallbacks } from "@rebasepro/types";
  -const callbacks: EntityCallbacks = {
  -    afterRead: ({ entity }) => {
  -        return { ...entity, values: { ...entity.values, email: "***" } };
  -    },
  -    afterCreate: ({ entity }) => { /* ... */ },
  -    beforeDelete: ({ entityId }) => { /* ... */ },
  +import type { CollectionCallbacks } from "@rebasepro/types";
  +const callbacks: CollectionCallbacks = {
  +    afterRead: ({ row }) => {
  +        return { ...row, email: "***" };
  +    },
  +    afterSave: ({ id, status }) => { if (status === "new") { /* ... */ } },
  +    beforeDelete: ({ id }) => { /* ... */ },
  };
  ```

  **WebSocket wire protocol**

  | Old Message Type | New Message Type |
  |-----------------|-----------------|
  | `FETCH_ENTITY` | `FETCH_ONE` |
  | `SAVE_ENTITY` | `SAVE` |
  | `DELETE_ENTITY` | `DELETE` |
  | `COUNT_ENTITIES` | `COUNT` |
  | `subscribe_entity` | `subscribe_one` |
  | `collection_entity_patch` | `collection_patch` |

  **Database schema**

  | Old Name | New Name |
  |----------|----------|
  | `rebase.entity_history` (table) | `rebase.entity_history` |
  | `entity_id` (column) | `entity_id` |
  | `rebase_entity_changes` (PG NOTIFY channel) | `rebase_entity_changes` |

- **Unified `<Rebase>` data props** — Removed the `data` and `driver` props. There are now exactly two ways to provide data: `client` (server transport) and `dataSources` (everything else). A `dataSources` entry keyed `"(default)"` with a `driver` replaces `client.data` as the default source — this is how a fully client-side app (e.g. Firestore-only via `RebaseFirebaseApp`) is wired. Migration: `driver={x}` → `dataSources={[{ key: "(default)", engine: "firestore", driver: x }]}`; `data={x}` had no known users (custom backends implement `DataDriver`, now the documented integration SPI).
- **Deterministic default-source resolution** — The default data source resolves as: `"(default)"`-keyed entry with driver → `client.data` → the sole registered source. Several sources without an explicit default now throw instead of silently picking the first object entry (order-dependent).

- **Side-panel / Edit-view / Collection-view component rename** — Renames mechanically-generated "Entity" component names to descriptive, role-based names. Components bound to Rebase core data use the `Binding` suffix. This is a search-and-replace migration — no behavioral changes.

  **Types (`@rebasepro/types`)**

  | Old Name | New Name |
  |----------|----------|
  | `EntitySidePanelProps` | `SidePanelBindingProps` |
  | `sideEntityController` (on `RebaseContext`) | `sidePanelController` |
  | `sideEntityController` (on `EntityActionClickProps`) | `sidePanelController` |
  | `"Entity.FormActions"` (override key) | `"EditView.FormActions"` |
  | `"Entity.DetailView"` (override key) | `"DetailView"` |
  | `"Entity.Preview"` (override key) | `"RecordPreview"` |

  **Components (`@rebasepro/admin`)**

  | Old Name | New Name |
  |----------|----------|
  | `SideEntityProvider` | `SidePanelProvider` |
  | `EntitySidePanel` | `SidePanelBinding` |
  | `EntityEditView` | `EditViewBinding` |
  | `EntityEditViewFormActions` | `EditFormActions` |
  | `EntityDetailView` | `DetailViewBinding` |
  | `EntityView` | `RecordViewBinding` |
  | `EntityPreview` | `RecordPreviewBinding` |
  | `EntityJsonPreview` | `JsonPreviewBinding` |
  | `DataCollectionView` | `CollectionViewBinding` |
  | `EntityCollectionBoardView` | `CollectionBoardViewBinding` |
  | `EntityCollectionCardView` | `CollectionCardViewBinding` |
  | `EntityCollectionListView` | `CollectionListViewBinding` |
  | `DataCollectionViewActions` | `CollectionViewActions` |
  | `DataCollectionViewStartActions` | `CollectionViewStartActions` |
  | `DataCollectionTable` | `CollectionTableBinding` |
  | `EntityCollectionRowActions` | `CollectionRowActions` |
  | `EntitySelectionTable` | `SelectionTableBinding` |
  | `EntityBoardCard` | `BoardCardBinding` |
  | `EntityCard` | `RecordCardBinding` |
  | `useEntityPreviewSlots` | `usePreviewSlots` |
  | `SideEntityControllerContext` | `SidePanelControllerContext` |

  **Bridge key (`@rebasepro/core`)**

  | Old Key | New Key |
  |---------|---------|
  | `"sideEntityController"` | `"sidePanelController"` |
  | `sideEntityController` (on `StudioBridge`) | `sidePanelController` |

- **Client split into server/browser variants** — `RebaseClient` is now split so the RLS-bypassing accessor is explicit: use `rebase.dataAsAdmin` (server-only) for admin-scoped, RLS-bypassing access, and `rebase.data` for user-scoped access. The public API surface was curated to hide internal plumbing.

- **`update`/`delete` throw on not-found** — SDK `update()` and `delete()` now throw when the target row does not exist, instead of silently returning `undefined`.

- **`deleteAll` is now internal** — removed from the public data accessors.

- **Scaffold defaults to cookie auth** — new projects store the refresh token in an httpOnly cookie (`authFlowMode: "cookie"`) by default.

- **`AdminUser.provider` → `providerId`** — renamed to match the canonical `User` type.

### Features & Improvements

- **Membership / relational RLS predicate (`policy.existsIn`)** — a first-class access predicate for scoping reads/writes by membership in a related collection (e.g. "only rows whose team the caller belongs to"). Compiles to a single correlated `EXISTS` subquery — no per-row `afterRead` lookups. Adds `policy.existsIn({ collection, where })` and the `policy.outerField(name)` operand for correlating the subquery to the outer row.

- **Built-in email → user lookup for invites** — opt-in `auth.allowUserLookup` exposes an authenticated `POST /auth/find-user` and a client `rebase.auth.findUserByEmail(email)` that returns a minimal public profile (`uid`, `displayName`, `photoURL` only). Removes the hand-rolled `dataAsAdmin` server function that invite flows previously required. Off by default (enables user enumeration by signed-in users).

- **Mount the admin under a path prefix** — `RebaseCMS` accepts a `basePath` so the admin can live under a sub-path route (e.g. `/admin`) without the collection data-grid hanging on URL↔collection resolution.

- **Filter operators** — LIKE family (`like`, `ilike`, etc.) and null checks, with engine-aware, customizable filter fields.

- **Scoped storage tokens** — storage access is now governed by scoped, time-limited tokens, with a documented public-files + scoped-token URL model.

- **Uniform server error envelope** — server error responses are routed through a central handler for a consistent `{ error: { message, code, details? } }` wire shape.

- **Inferred data-source transport** — `DataSourceDefinition.transport` is now optional: entries with a client-side `driver` default to `"direct"`, entries without to `"server"`. A `"(default)"`-keyed entry without a driver can be used to declare the default source's engine/capabilities while the client keeps serving the data.

- **`installShutdownHandlers`** — New `@rebasepro/server-core` helper that encapsulates graceful shutdown: drains via `backend.shutdown()`, runs `onCleanup` (e.g. closing your database pool), guards against repeated signals, and force-exits if shutdown hangs. Replaces the hand-rolled ~40-line shutdown block in the backend templates — the CLI template previously lacked the re-entry guard and force-exit timer entirely.

- **Honest Realtime Meta** — Added `FindResponse.meta.estimated` flag on realtime first-paint updates. When `listen()` emits its immediate heuristic metadata, the emission now carries `estimated: true`. Redundant second emissions are skipped when the authoritative count matches the heuristic, and count failures no longer silently pretend to be authoritative — the `estimated` flag remains as the signal.

### Fixes

- **Concurrency-safe refresh-token rotation** — token rotation now uses an atomic `INSERT … ON CONFLICT DO UPDATE` instead of a DELETE-then-INSERT. Concurrent `/refresh` calls (which cookie-mode boot can fire at once) previously raced into a `unique_device_session` violation and returned 500, breaking the session. The client also single-flights concurrent refreshes.

- **Cookie session restore** — `/auth/refresh` now returns the user object, and the client restores the user (falling back to `/me`) instead of leaving a blank `uid`. A cold start restored from an httpOnly cookie alone no longer yields an empty user.

- **Resilient auto-refresh** — a transient refresh failure (network blip, backend restart, 5xx) now retries with exponential backoff instead of immediately signing the user out; only a genuine auth failure (401/403/invalid/expired token) or exhausted retries signs out.

- **`server-postgresql` ships `src/`** — the driver package now packs `src` alongside `dist`, fixing `✗ Could not find CLI entry point for @rebasepro/server-postgresql` for `rebase db push` / `schema generate` in published/packed installs (the CLI runs `src/cli.ts` via tsx; no `dist/cli.js` is built).

- **Malformed request bodies** — the API now rejects malformed JSON bodies with `400` and tightens the public-path check.

- **Auth collection callbacks warning** — the server warns at startup when an auth collection defines `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`, since auth-driven user creation bypasses the collection save pipeline (use the `afterUserCreate` auth hook instead).

- **CLI DX** — friendly diagnostics for "SSL is not enabled on the server" (suggests `sslmode=disable`) and for dependency-drop failures that leave a schema half-migrated; a clear warning when `--collections` resolves to a missing path; and `rebase dev` now surfaces when it overrides the project's `.env` PORT / `VITE_API_URL` with its derived per-project port.

- **Scaffold hardening** — the frontend Vite config ships `resolve.dedupe` for React / React Router so a locally `link:`ed Rebase checkout doesn't load duplicate React copies (which broke the admin's data router); `.env.example` documents `sslmode=disable`.

## [0.8.0] - 2026-07-01

### Changed

- **Strict collection accessors** — When a `collections` dictionary is passed to `createRebaseClient`, unknown property accessors on `client.data` now throw immediately with a nearest-match suggestion instead of silently producing a 404 later. Use `data.collection("slug")` for dynamic slugs.

### Cleanup

- **Removed** — Six unused FireCMS-legacy builder identity functions (`buildProperties`, `buildPropertiesOrBuilder`, `buildEnum`, `buildEnumValueConfig`, `buildEntityCallbacks`, `buildAdditionalFieldDelegate`). Migration: remove the wrapper call — they were identity functions, so the object literal is the same value.
- **Deprecated** — `buildCollection` / `buildProperty` in favor of `defineCollection`. Both are marked `@deprecated` and will be removed before 1.0.
- **Removed** — Unused `<Rebase apiKey>` prop (it was never consumed by the component).
- **Fixed** — Duplicated sentences in `propertiesOrder` JSDoc; rewrote `subcollection:` description to cover both Firestore and Postgres.

### Features & Improvements

- **Unified Policy & Filter Engine** — Replaced ad-hoc permission checks with a centralized `evaluatePolicy` system and `Policy` type. This system translates high-level security rules into both frontend conditions (for UI gating) and backend-specific filters (Postgres RLS, Firestore security rules). Includes `policyToPostgres` and `securityRuleToConditions` utilities, ensuring the admin UI matches database enforcement by construction.
- **`defineCron` authoring helper** — Typed identity wrapper for cron job files (parity with `defineFunction`). Demo app now ships a working cron job (`refresh-product-stats`).
- **Multi-Backend Storage Sources** — Introduced a first-class `StorageSource` system allowing a single project to use multiple storage backends (S3, GCS, Local, Firebase) simultaneously. Added `GCSStorageController` for native Google Cloud Storage support with TUS resumable uploads. Managed via `StorageSourcesContext` and `StorageRegistry`, enabling complex multi-cloud storage architectures.
- **Custom Backend Functions** — New `defineFunction()` API for creating type-safe, discoverable backend endpoints. Functions are automatically mounted, type-checked, and can be invoked directly from the client SDK with full type safety. Includes a new `invoke_function` MCP tool for interacting with custom endpoints from AI agents.
- **Property Schema Consolidation** — Refactored the property system to unify how database-level schemas, UI configurations, and validation rules are defined. Removed overlapping property types and introduced a more robust `PropertyConfig` system that handles complex relations and references consistently across all data drivers (Postgres, MongoDB, Firestore).
- **Editable UI Table** — Significantly enhanced `VirtualTable` with native editable cells (`VirtualTableInput`, `VirtualTableSelect`, `VirtualTableNumberInput`, `VirtualTableDateField`). Added a new `SelectionStore` and `SelectionContext` for robust multi-row selection, keyboard navigation, and batch operations within the CMS.
- **Expanded Agent Skills** — Massive overhaul of the Rebase AI coding skills. Added new specialized skills for `rebase-custom-functions`, `rebase-ui-components`, and `rebase-storage`. Expanded existing skills for auth, security, and SDK with deep architectural context, common patterns, and safety rules.
- **Public API Refinement** — Cleaned up the public API surface of `@rebasepro/client` and `@rebasepro/core`, simplifying integration into existing applications. Consolidated data controllers, improved type inference, and refined the `Rebase` component props for better developer experience.
- **NPM Publishing Safeguards** — Added `validate-no-workspace-protocol.sh` and `check-packages.sh` scripts to the release pipeline. These prevent publishing packages with `workspace:` dependencies or inconsistent versions, ensuring library consumers always get stable, resolved dependencies.

### Fixes

- **Dependency Management** — Resolved workspace-wide dependency conflicts and fixed "workspace protocol" leakage in built artifacts that caused installation failures in certain environments.
- **Lifecycle Interception** — Unified lifecycle interception systems across different data drivers. This ensures consistent execution of `beforeSave`, `afterSave`, `beforeDelete`, and `afterDelete` hooks regardless of whether the collection is backed by Postgres, MongoDB, or Firestore.
- **OAuth Configuration** — Refactored and stabilized OAuth provider configuration. Resolved inconsistencies in how environment variables were parsed for Discord, Microsoft, and LinkedIn providers.
- **MongoDB & Firestore Parity** — Improved collection support for MongoDB and Firestore, bringing their relation/reference capabilities and storage integration closer to parity with the PostgreSQL driver.
- **Any Type Audit** — Conducted a comprehensive audit of `any` types across the core packages, replacing them with strict types or narrowing guards (e.g., `isSQLAdmin`) to improve overall codebase robustness and prevent runtime errors.

### Testing

- **Security Policy Tests** — New test suites for `evaluatePolicy`, `policyToPostgres`, and `securityRuleToConditions` covering Kleene logic and complex nested expressions.
- **Storage Tests** — Added comprehensive integration tests for `GCSStorageController`, multi-storage routing, and TUS upload flows.
- **UI Tests** — New unit and integration tests for `VirtualTable` editable fields, selection logic, and keyboard accessibility.
- **Schema Gates** — Added `collection_registry_property_gates` tests to validate property resolution and permission-based visibility gating at the registry level.

---

## [0.7.0] - 2026-06-29

### Features & Improvements

- **Multi-Datasource Architecture** — Introduced a first-class `DataSourceDefinition` / `DataSourceCapabilities` system that lets a single Rebase instance route collections to different database engines (Postgres, Firestore, MongoDB, or custom drivers). Collections declare a `dataSource` key, and the frontend router, backend driver registry, and collection editor all resolve capabilities from the same definition. Includes `resolveDataSource()`, `createDataSourceRegistry()`, `registerDataSourceCapabilities()`, and a new `DataSourcesContext` React provider. The editor automatically shows/hides tabs (Relations, Subcollections, RLS) and property types based on each source's declared feature flags.
- **Headless Collection Views** — Extracted reusable, data-agnostic collection view components (`CollectionView`, `CollectionTableView`, `CollectionCardView`, `CollectionListView`, `CollectionKanbanView`) into `@rebasepro/ui`. These headless components accept a generic `CollectionDataController<T>` — no coupling to entities or the CMS data layer — making them usable in custom pages, standalone apps, and third-party integrations. Includes a `CollectionViewToolbar` with view-mode toggle, search, filters, and pagination.
- **Headless Entity Forms** — Decoupled `EntityForm`, `EntityFormActions`, and `EntityFormBinding` from the admin package internals. Forms now accept pluggable field bindings and layout props, enabling standalone entity editing outside the CMS shell. Added `PopupFormField` for inline editing and extended form layout controls.
- **Auth Hooks Expansion** — Significantly expanded the `AuthHooks` interface with new lifecycle hooks: `beforeLogin`, `afterLogout`, `onPasswordReset`, `beforeUserDelete`, `afterUserDelete`, `onAdminCreateUser`, `onAdminResetPassword`, and `transformAuthResponse`. The `transformAuthResponse` hook lets developers inject external tokens (e.g. Firebase Custom Tokens) or project-specific metadata into every auth response. Added `AuthMethod` type covering all authentication methods.
- **Custom Auth Adapter** — New `createCustomAuthAdapter()` factory for plugging existing auth systems into Rebase with minimal config. Only `verifyRequest` is required — capabilities, user lookup, and registration are all optional overrides.
- **Magic Link Authentication** — Added passwordless magic-link login flow with `mountMagicLinkRoutes()`. Generates secure tokens with 15-minute expiry, sends branded emails via the configured email provider, and integrates with the `transformAuthResponse` hook and rate limiting.
- **API Keys** — Full API key management with collection-level permission scoping (`read` / `write` / `delete`), admin keys, rate limiting, expiration, and revocation. Includes server-side middleware (`api-key-middleware.ts`), a Postgres-backed key store, a Studio management UI (`ApiKeysView`), a CLI command (`rebase api-keys list|create|revoke`), and a client SDK module (`@rebasepro/client` `api-keys.ts`). Keys are stored with hashed secrets; the full key is only returned on creation.
- **Atlas Migrations (replaces Drizzle Kit)** — Replaced `drizzle-kit` with [Atlas](https://atlasgo.io/) for schema migrations. Added `generate-postgres-ddl-logic.ts` that produces raw SQL DDL (with enums, RLS policies, and indexes) from collection definitions. Migrations are now version-controlled SQL files under `drizzle/migrations/` with an `atlas.sum` integrity file. CLI `rebase db` commands updated accordingly.
- **Improved RLS Editor** — Overhauled the Studio RLS editor with better policy visualization, shared `table-classification.ts` module (classifying tables as `rebase-internal`, `junction`, or `user`), and improved default auth policies generation.
- **Headless Collection Editor** — Made the collection schema editor headless and decoupled from the admin shell. Extracted serializable types and utilities, allowing the editor to be embedded in custom Studio views or third-party tools.
- **Security Audit Logging** — Added structured security audit logging across all OAuth providers (Apple, Google, GitHub, GitLab, Facebook, Discord, Microsoft, LinkedIn, Slack, Spotify, Twitter, Bitbucket). Improved `ECONNREFUSED` error handling with actionable diagnostics, and fixed `chalk` CJS compatibility.
- **Landing Page & Demos** — New layered architecture diagram on the developers page, improved CRM dashboard demo (`CrmDashboardDemo`), and fixed NEAT gradient mismatches across all landing pages.
- **CLI Skills Enhancements** — Extended the `rebase skills` command with updated skill definitions for auth, security, collections, realtime, and SDK documentation.

### Fixes

- **Security Hardening** — Parameterized queries in API key store and cron store to prevent SQL injection. Hardened WebSocket connection safeguards, strengthened `EntityPersistService` input validation, and added `.dockerignore` / `.gitignore` rules to prevent secrets leakage. Sanitized environment variable handling in production.
- **Repo Cleanup** — Reorganized internal documentation (`BREAKING_CHANGES_POSTGRES.md`, `PUBLISHING.md`, `REBASE_ARCHITECTURE.md`) into `.github/internal/`. Cleaned up legacy `formex` `.yarn/cache` artifacts, updated `CONTRIBUTING.md`, `README.md`, and `AGENT.md`. Deprecated export documentation moved to `docs/DEPRECATED_EXPORTS.md`.
- **UI & Ergonomics** — Multiple ergonomic fixes across the admin panel: improved Sheet/Dialog focus management, refined `DrawerNavigationGroup` and breadcrumb context, stabilized navigation resolution hooks, and cleaned up `BreadcrumbsContext` and `CollectionRegistryContext`.

### Testing

- **Multi-Datasource Tests** — New test suites for `buildRoutedRebaseData`, `resolveDataSource`, `collection_registry_datasource`, `routing_integration`, `multi-datasource-routing`, and `routed-realtime-service`.
- **Auth Tests** — Added tests for `custom-auth-adapter`, `transform-auth-response`, and extended `auth-routes` tests covering magic links and lifecycle hooks.
- **Postgres Tests** — New `auth-default-policies` tests, extended `cli-helpers-extended` tests, `connection` tests, `databasePoolManager` tests, `doctor-extended` tests, and `generate-postgres-ddl` tests.
- **UI Tests** — Added `views.test.tsx` covering the new headless `CollectionView`, `ListView`, `CardView`, and `TableView` components.
- **E2E Tests** — Updated Playwright E2E tests for collections, studio features, and the new API keys flow.

---

## [0.6.1] - 2026-06-23

### Fixes

- **CLI Init Crash** — Fixed `rebase init` crashing with `UnknownPromptTypeError: Prompt type "list" is not registered` after entering the project name. The `inquirer` v14 dependency renamed the `"list"` prompt type to `"select"`, breaking the interactive flow. The non-interactive (`--yes`) path was unaffected, which is why E2E tests did not catch it.

### Testing

- **Interactive Prompt Validation** — Extracted prompt question building into a testable `buildInitQuestions()` function and added unit tests that validate all prompt `type` values against the installed `inquirer` version's registered types. This prevents prompt-type regressions from shipping silently when `inquirer` is upgraded.

---

## [0.6.0] - 2026-06-18


### Features & Improvements

- **Schema Drift & Previews** — Added a schema drift notification banner to Starlight and Studio home page, and improved previews for collection reference/relation properties.
- **Rebase Client & Types** — Consolidated RebaseClient context hooks, aligned types in `@rebasepro/client` and reconciled data controllers for cleaner imports.
- **Observability** — Integrated structured request-logger middleware and an `X-Request-ID` correlation header to trace client requests across core backend services.
- **Code Quality & Testing** — Added robust unit/integration tests across `@rebasepro/ui` components, StudioHomePage, and data plugins. Cleaned up Vite configuration targets, and strengthened type-safety checks.
- **Multi-Factor Authentication (MFA)** — Full TOTP-based MFA implementation with enroll, verify, challenge, and unenroll flows. Includes recovery codes, `aal1`→`aal2` token upgrade on challenge verification, and an `onMfaVerified` auth hook. Auth routes extracted into dedicated `mfa-routes.ts` and `session-routes.ts` modules.
- **Component Override System** — New `ComponentOverrideContext` and `useComponentOverride` hook allow developers to replace built-in UI components at both the global (`<Rebase components={…}>`) and per-collection level, with resolution priority: collection → global → default.
- **CLI Skills Command** — `rebase skills` auto-detects and installs Rebase AI coding skills for Cursor, Claude Code, Windsurf, and Gemini/Antigravity, writing the correct file format (`.mdc`, `SKILL.md`, `.md`) to each agent's rules directory.
- **MCP Server Expansion** — Added storage tools (`storage_list_objects`, `storage_delete_object`, `storage_get_metadata`), cron tools (`cron_list_jobs`, `cron_get_job`, `cron_trigger_job`, `cron_get_job_logs`, `cron_toggle_job`), and `invoke_function` for calling custom backend functions. Automatic package-manager detection for dev server commands.
- **Server Init Refactor** — Decomposed the monolithic `init.ts` into focused modules: `init/middlewares.ts` (request ID, body limits, CSRF, CORS warnings, logging), `init/health.ts` (health-check endpoint with DB latency), `init/shutdown.ts` (graceful teardown ordering), `init/storage.ts` (multi-backend storage bootstrap), and `init/docs.ts` (OpenAPI serving).
- **Entity Form Improvements** — Enhanced `EntityDetailView` and `EntityEditView` with better field-binding support, added `PopupFormField` inline editing, extended `EntityForm` with additional layout controls, and added `replace` option to `navigateToEntity`.
- **Drizzle Schema Generation** — Improved generated schema logic with richer column-type support and cleaned up `EntityPersistService` by extracting reusable persist utilities.
- **Documentation & Website** — Added `llms.txt`, updated `sitemap.md`, expanded backend auth, realtime, collections, SDK, and component-overrides documentation. Agent skills updated for auth, collections, realtime, SDK, and Studio.


### Fixes

- **Auth Refactoring** — Resolved auth issues and cleaned up redundant user management hooks, admin routes, and legacy decorators.
- **Studio & UI Components** — Corrected icon sizing bugs in navigation cards, restored and stabilized SQLEditor panel logic, improved tab scroll styles, and updated third-party dependencies across all packages.
- **Relation Preview Rendering** — Fixed broken relation previews in list views by correcting `useEntityPreviewSlots` resolution and adding proper hydration logic in `RelationPreview` and `PropertyPreview` components.
- **Security Hardening** — Hardened WebSocket client with connection-level safeguards, added input validation to GraphQL and REST generators, tightened API key store and cron store queries, improved image-transform and SPA-serve path handling, and added branch-service authorization checks.
- **PostgreSQL Error Handling** — New `pg-error-utils.ts` module extracts native PG errors from Drizzle's cause chain, translates 5-character SQLSTATE codes into user-friendly messages, and surfaces constraint, column, and table metadata.
- **Roles Query** — Fixed roles query resolution in user management flows.
- **Package Cleanup** — Cleaned up `package.json` files across the monorepo, fixed dependency declarations, and corrected `plugin-insights` version reference.
- **VirtualTable & UI** — Refactored `VirtualTable` and `VirtualTableHeader` for better resize handling and simplified render logic. Improved `Dialog` focus management and `LoginView`/`ErrorView` layout.

### Testing

- **Admin Package Tests** — Added component-level tests, data export tests, data import tests (including `get_import_inference_type` and transforms), and extended navigation utils test coverage.
- **PostgreSQL Tests** — New `relations.test.ts` for relation service, `pg-error-utils.test.ts` for error extraction, and expanded `drizzle-conditions.test.ts` and `generate-drizzle-schema.test.ts`.
- **MCP Server Tests** — Extended test suite covering new storage, cron, and function tool handlers.


---

## [0.5.0] - 2026-06-15

### Features & Improvements

- **Aesthetic Landing Page** — Added high-performance custom NEAT canvas background gradients, revamped hero illustrations, and introduced localized documentation and responsive demo page structures.
- **Developer Workspaces** — Added curated development skills rules (covering cron jobs, design-language, email, history, and SDK specs) directly into the agent workspace configs.
- **Data Insights & Migrations** — Integrated database migration `0002` schema changes and a seed script, and introduced an automated insights calculator service.
- **CLI Improvements** — Hardened CLI initialization options for PostgreSQL 18.

### Fixes

- **RLS & Security** — Resolved critical security gaps in Postgres Row-Level Security (RLS) policies.
- **Multi-DB Drivers** — Cleaned up type-safety and package path dependencies for `server-mongodb` and `server-postgresql`.

---

## [0.4.0] - 2026-06-11

### Features & Improvements

- **Unified Authentication** — Redesigned default auth routing, eliminated the `defaultUsersCollection` construct, and streamlined default view redirects.
- **Email Config** — Added custom `SMTP_NAME` parameter configuration in SMTP email delivery properties.

### Fixes

- **Layout & Sizing** — Resolved side navigation alignment glitches, added scroll-overflow fixes in entity data grids, and corrected `ReadOnlyFieldBinding` form fields.
- **Missing Build Configurations** — Added missing `tsconfig.prod.json` compiler files and stabilized workspace-level packaging dependencies.

---

## [0.2.5] - 2026-06-09

### Features & Improvements

- **Role Model Simplification** — Removed roles as an independent table/collection, simplifying permissions into a standard DB enum column directly in the `users` table.
- **SDK & Client Methods** — Extended Rebase client drivers with new data persistence methods.

### Fixes

- **Types & Layouts** — Extended schema types to support native UUID format in string fields, adjusted scroll behaviors in tab grids, and solved pnpm lockfile conflicts.

---

## [0.2.4] - 2026-06-08

### Features & Improvements

- **PostgreSQL 18** — Upgraded core infrastructure and Docker configurations to support PostgreSQL v18.
- **Scaffold Configurations** — Added VPC and S3-compatible cloud storage setup inputs directly into the CLI project-creation prompts.
- **Auth Hooks & Orgs** — Added basic multi-tenant organization support and renamed `AuthOverrides` to `AuthHooks`.
- **Advanced Query Operators** — Introduced `array-contains-any` and `not-in` filter clauses for postgres client drivers.
- **Error Boundaries** — Wrapped main application routes in a robust `ErrorBoundary` with specific full-page and authorization error layouts, and attached global listeners for unhandled promise rejections.

### Fixes

- **Stricter Typing & Logging** — Replaced broad `any` usages with type-safe `unknown` keywords, and migrated core controllers from `console.log` to the structured monorepo logger.

---

## [0.2.3] - 2026-05-31

### Features & Improvements

- **OIDC Publish Workflows** — Migrated package publishing workflows to use GitHub Actions OIDC federation with NPM, removing hardcoded auth tokens and adding secure ID-token scopes.
- **Dynamic Versions** — Dynamically resolved workspace versions from `lerna.json` during canary package releases.

### Fixes

- **CLI Scaffold** — Fixed CLI template installation bugs, repaired Docker database image configs, and restored correct properties inside template collection schemas.

---

## [0.2.1] - 2026-05-30

### Fixes

- **Lockfile & Build Issues** — Fixed a missing integrity hash for the `xlsx` dependency in the lockfile, and resolved frontend build failures by adding `@types/node` and `vite/client` type definitions.
- **SQL Editor Component** — Updated the `SQLEditor` component for improved stability and rendering.

### CI & E2E Testing

- **E2E Test Runner Improvements** — Replaced the `execa` dependency with a custom spawn helper in E2E tests, resolved package packing/resolution issues, and fixed split chunk E2E test failures by accumulating logs for dev server URL detection.
- **Vite Template Config** — Tracked `virtual.d.ts` in git and fixed glob inclusions in `tsconfig` files to prevent template compilation errors.

---

## [0.2.0] - 2026-05-29

### Features & Improvements

- **Postgres Vector (pgvector) Support** — Added a `vector` property type for embeddings, including admin UI field bindings, validation, Postgres schema generation, API generators, and data transformations.
- **Pluggable AuthAdapter Architecture** — Replaced direct Firebase Auth logic in key controllers with a pluggable adapter system to support dynamic/external authentication providers (e.g., dynamic Postgres auth schemas).
- **Users & Roles Collections** — Migrated the user/role system to be treated as standard, customizable data collections, with built-in overrides and migration of auth UI components to the core package.
- **A/B Testing & Landing Page Revamp** — Added A/B testing infrastructure, hero CTAs, testimonials, landing page Bento Grid layouts (`ProductContent`), and demo view modes.
- **SDK Drift Detection** — Added SDK drift detection to the CLI doctor command to check for drift between collection definitions and generated SDKs.
- **EntityDetailView & UI Enhancements** — Created `EntityDetailView` for read-only displays, new `FilterChip` components, and support for collection filter presets.
- **CLI and Test Improvements** — Upgraded pnpm to v11, added CLI init E2E tests, localhost validation tests, and AI coding assistant rules to CLI templates.
- **Database Role Switching Config** — Introduced `DISABLE_DB_ROLE_SWITCHING` and `ADMIN_CONNECTION_STRING` options with troubleshooting documentation.
- **License Update** — Relicensed the project under the MIT License.

### Fixes & Refactoring

- **Realtime Service Shutdown Deadlock** — Fixed potential deadlocks during shutdown by cleaning up websocket realtime services before closing the database pool.
- **Environment Validation** — Centralized environment variable validation in `server-core`.
- **UI Styling & Translations** — Refactored UI components to use consistent Typography/Alert variants, and updated i18n translation strings.

---

## [0.1.2] - 2026-05-15

### Improvements

- **Removed `lodash` dependency** — Replaced `lodash/cloneDeep` with a custom `deepClone` utility in `@rebasepro/utils`. This eliminates the external dependency and fixes `npx create-rebase-app` failing due to missing `lodash` at runtime.
- **New `deepClone` utility** — A lightweight deep-clone function that preserves function references and class instances (Date, GeoPoint, etc.), designed specifically for Rebase collection objects.

### CI & Tooling

- **Automated release pipeline** — New GitHub Actions workflow (`Publish Stable Release`) that handles version bumping, npm publishing, and GitHub Release creation in a single click from the Actions tab.
- **Local release script** — `pnpm release:patch`, `pnpm release:minor`, `pnpm release:major` for releasing from the command line with the same pipeline.
- **Canary releases** — Every push to `main` publishes a canary version to npm (`@canary` dist-tag).

### Fixes

- Fixed navigation utility tests to assert the correct call signature with `undefined` options parameter.
- Updated package descriptions to reflect the Postgres-based architecture.

---

## [0.1.0] - 2025-05-14

🎉 **First public release of Rebase** — an open-source headless CMS and admin panel for Postgres.

### Highlights

- **Full Admin Panel** — Spreadsheet, card, list, and table views for managing your data with inline editing, filtering, sorting, and search.
- **PostgreSQL Backend** — First-class Postgres support with Drizzle ORM, schema introspection, and automatic migrations.
- **Authentication** — Built-in auth with email/password, Google OAuth, and anonymous sign-in. Role-based access control with customizable permissions.
- **Storage** — S3-compatible file storage with image resizing, drag-and-drop uploads, and metadata management.
- **Studio** — SQL editor, RLS policy editor, schema visualizer, JS/TS editor, cron jobs, and API explorer.
- **CLI** — `npx create-rebase-app` to scaffold a new project in seconds. Supports both npm and pnpm.
- **SDK Generator** — Auto-generate fully typed TypeScript SDKs from your collection definitions.
- **MCP Server** — Model Context Protocol server for AI-assisted database management.
- **Plugins** — Data enhancement and insights plugins for extending the admin experience.
- **UI Component Library** — A comprehensive set of accessible, themeable React components built on Radix primitives.
- **Firebase Support** — Optional Firebase/Firestore data source and authentication adapters.
- **MongoDB Support** — Optional MongoDB data source adapter.

### Packages

| Package | Description |
|---|---|
| `@rebasepro/types` | Core TypeScript type definitions |
| `@rebasepro/utils` | Shared utility functions |
| `@rebasepro/common` | Common modules shared across packages |
| `@rebasepro/formex` | Lightweight form management library |
| `@rebasepro/ui` | React component library |
| `@rebasepro/core` | Core CMS logic and controllers |
| `@rebasepro/client` | Client-side data access layer |
| `@rebasepro/client-postgresql` | PostgreSQL client adapter |
| `@rebasepro/client-firebase` | Firebase/Firestore client adapter |
| `@rebasepro/server-core` | Server framework and middleware |
| `@rebasepro/server-postgresql` | PostgreSQL server adapter with Drizzle |
| `@rebasepro/server-mongodb` | MongoDB server adapter |
| `@rebasepro/auth` | Authentication controllers and views |
| `@rebasepro/admin` | Full admin panel interface |
| `@rebasepro/studio` | SQL editor, schema tools, and developer utilities |
| `@rebasepro/cli` | CLI for project scaffolding and management |
| `@rebasepro/sdk-generator` | TypeScript SDK code generation |
| `@rebasepro/mcp-server` | MCP server for AI integrations |
| `@rebasepro/schema-inference` | Database schema introspection and inference |
| `@rebasepro/plugin-data-enhancement` | AI-powered data enhancement plugin |
| `@rebasepro/plugin-insights` | Analytics and insights plugin |
