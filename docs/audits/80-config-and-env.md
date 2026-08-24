# Unit 80 — Configuration and environment

Read-only audit of `main` at 2026-08-09. Scope: `packages/server/src/env.ts`,
`packages/server/src/boot/env.ts`, `packages/server/src/boot/options.ts`,
`packages/server/src/collections/validate-config.ts`, `packages/cli/src/manifest.ts`,
`saas/backend/src/env.ts` (read only) and the scaffolded `.env.example`.

Lens: bug class 27 (one list, two meanings) and class 10 (a flag whose `false`
grants instead of skipping).

Stale sibling checkouts (`cloud-fleet-safety/`, `saas-bughunt/`, `saas-sweep/`,
`.claude/worktrees/`) were excluded from every scan.

---

## Verdict

**Partial.** The two schemas that exist — `rebaseEnvSchema` and
`bootEnvExtension` — are unusually good: production refinements, a
localhost-in-production sweep over every parsed value, a wildcard-CORS refusal, a
tri-state swagger resolver, and a `REBASE_MAX_BODY_SIZE` coercion whose docblock
names the exact failure it prevents. Nothing on the schema path is loose.

The defects are all in what the schema does **not** cover. Roughly a third of the
variables the platform reads never reach a schema at all: they are read raw, at
first use, from `process.env`, each with its own hand-rolled boolean or numeric
parse. Six different spellings of "is this true" are in use. And in one case the
same variable is read twice with different meanings, with the raw read — the
permissive one — governing the decision that matters.

The specific question asked has a reassuring answer: `validate-config` does **not**
drop unknown keys. It warns and continues, `securityRules` is in the allowlist, and
a compile-time `AssertNever` makes forgetting a new key a build error
(`validate-config.ts:137-149`). The memory note that records this class as
"dropped at boot" is now out of date. The same class is, however, still live one
layer up in `rebase.json` — see finding 9.

Counts: **1 high**, **5 medium**, **8 low**.

---

## Inventory

Built by grepping `process.env` and `import.meta.env` across the workspace and
then reading the two zod schemas — not from documentation. Variables reached
through an injected `env` bag (`backup-cron.ts`, `scale-to-zero.ts`,
`fetch-bundle.ts`, `validate-config.ts`, `telemetry/index.ts`) do not appear in a
naive `process.env.X` grep and are included here.

Legend for **When**: `boot` = parsed and refused by a zod schema before the
server serves; `lazy` = read from `process.env` at first use, so a typo surfaces
whenever that code path first runs.

### A. Core schema — `packages/server/src/env.ts` (parsed by `loadEnv`)

| Variable | When | Required | Default | Missing / malformed |
|---|---|---|---|---|
| `NODE_ENV` | boot | no | `development` | Any value outside `development\|production\|test` refuses the boot. **Unset ⇒ full development posture** — see finding 6 |
| `PORT` | boot | no | `3001` | `Number("abc")` ⇒ `NaN`; not validated. `env.ts:90` |
| `DATABASE_URL` | boot | **yes** | — | Refuses the boot (`.url()`). Consumed raw again at `boot/sources.ts:154` |
| `ADMIN_CONNECTION_STRING` | boot | no | falls back to `DATABASE_URL` | `.url()` |
| `JWT_SECRET` | boot | **yes** in production | auto-generated 48 bytes when `NODE_ENV!==production` (`env.ts:188`) | `min(32)` refuses the boot. Ephemeral in dev ⇒ every restart is a logout |
| `JWT_ACCESS_EXPIRES_IN` | boot | no | `1h` | Free string, unvalidated |
| `JWT_REFRESH_EXPIRES_IN` | boot | no | `400d` | Free string. Scaffold overrides to `30d` — finding 13 |
| `GOOGLE_CLIENT_ID` / `_SECRET` | boot | no | — | Id alone enables Google (`boot/options.ts:66-71`) |
| `REBASE_SERVICE_KEY` | boot | no | auto-generated in dev; a random per-boot `internalServiceKey` otherwise (`init.ts:948`) | Fails closed |
| `ALLOW_REGISTRATION` | boot | no | `false` | Enum `true\|false\|""`; fails closed |
| `DISABLE_SELF_REGISTRATION` | boot | no | `false` (**not** `undefined` — finding 7) | Enum |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | boot | no | `false` | Enum; fails closed |
| `CORS_ORIGINS` | boot | one of these two in production | — | Production without either refuses the boot (`env.ts:206`). Also read raw at `init/middlewares.ts:78` and `init.ts:1079` for a warning only |
| `FRONTEND_URL` | boot | ″ | — | Also the password-reset base URL (`smtp-email-service.ts:59`) |
| `DB_POOL_MAX` / `_IDLE_TIMEOUT` / `_CONNECT_TIMEOUT` | boot | no | `20` / `30000` / `10000` | `Number()`, unchecked here; re-read raw and range-checked at `boot/sources.ts:215-232` |
| `DATABASE_DIRECT_URL` | boot | no | falls back to the pool connection string | `.url()`; used for LISTEN/NOTIFY (`PostgresBootstrapper.ts:450`) |
| `DATABASE_READ_URL` | boot | no | — | `.url()`; `PostgresBootstrapper.ts:344` |
| `FORCE_LOCAL_STORAGE` | boot **and** lazy | no | `false` | **Two readers disagree — finding 1** |
| `STORAGE_TYPE` | boot | no | `local` | Enum `local\|s3\|gcs`. Value actually used comes from the raw read at `boot/sources.ts:254` |
| `STORAGE_PATH` | boot | no | `<bundle>/uploads` | Also raw at `storage/routes.ts:743` |
| `S3_BUCKET`/`_REGION`/`_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`/`_ENDPOINT`/`_FORCE_PATH_STYLE` | boot | no | region `auto` | `S3_ENDPOINT` is `.url()`. A bucket without credentials is a `BundleError` (`sources.ts:295-305`) |
| `GCS_BUCKET`/`_PROJECT_ID`/`_KEY_FILENAME` | boot | no | — | Credentials optional by design (Workload Identity) |

### B. Bundle-runtime schema — `packages/server/src/boot/env.ts` (`loadBootEnv`)

| Variable | When | Default | Missing / malformed |
|---|---|---|---|
| `SMTP_HOST`/`_PORT`/`_SECURE`/`_USER`/`_PASS`/`_FROM`/`_NAME` | boot | port `587`, secure `false` | No host ⇒ email silently unconfigured (`boot/options.ts:13`); auth routes report it |
| `APP_NAME` | boot | `Rebase` | — |
| `REBASE_SERVE_STATIC` | boot | `true` | `!== "false"` — anything but the literal `false` serves |
| `REBASE_MIGRATE_ON_BOOT` | boot (enum) | **documented `none` in production, implemented `ensure` everywhere** | **Finding 2** |
| `REBASE_METRICS` | boot | `false` | Enabled without `REBASE_METRICS_TOKEN` warns at `boot.ts:323` |
| `REBASE_METRICS_TOKEN` | boot | — | Absent ⇒ `/metrics` is open; warned, not refused |
| `LOG_LEVEL` | boot (enum) | `info` | Enum refuses the boot on this path; the logger's own raw read (`logger.ts:54`) silently defaults instead |
| `STORAGE_PUBLIC_READ` | boot | `false` | Fails closed |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | boot | `false` | Fails closed; the storage authz boot guard is the enforcer |
| `AUTH_REQUIRE` | boot | `true` | `!== "false"` — fails closed |
| `AUTH_ALLOW_USER_LOOKUP` | boot | `false` | Fails closed |
| `AUTH_COOKIE_SAME_SITE` | boot (enum) | `Lax` (`boot/options.ts:59`) | — |
| `AUTH_DEFAULT_ROLE` | boot | — | Unset ⇒ no default role |
| `GITHUB_CLIENT_ID`/`_SECRET`, `MICROSOFT_CLIENT_ID`/`_SECRET` | boot | — | Provider enabled only when both halves are present |
| `REBASE_BASE_PATH` | boot | `/api` | — |
| `REBASE_ENABLE_SWAGGER` | boot | tri-state; unset ⇒ on in dev, off in production (`resolveEnableSwagger`) | Clean |
| `REBASE_MAX_BODY_SIZE` | boot | — | `z.coerce.number().int().nonnegative()`; a non-number refuses the boot. **This is the reference implementation** |
| `REBASE_COMPRESSION` | boot | `true` | `!== "false"` |
| `REBASE_HISTORY` | boot | `true` | `!== "false"` |

### C. Read lazily — never validated at boot

| Variable | Reader | Default | Missing / malformed |
|---|---|---|---|
| `REBASE_FUNCTIONS_TIMEOUT_MS` | `functions/request-timeout.ts:19` | `30_000` | **Empty string ⇒ `0` ⇒ no timeout at all — finding 3** |
| `TRUSTED_PROXY_HOPS` | `auth/rate-limiter.ts:54` | `1` | Empty ⇒ `0`; garbage ⇒ `1`. Finding 14 |
| `MFA_ENCRYPTION_KEY` | `auth/mfa-crypto.ts:86` | falls back to `MFA_ENCRYPTION_KEY_PREVIOUS`, then `JWT_SECRET` | **Finding 4** |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | `auth/mfa-crypto.ts:87` | — | Comma-separated rotation list |
| `REBASE_STRICT_COLLECTION_CONFIG` | `collections/validate-config.ts:66` | `warn` | A typo silently means `warn` — the permissive side |
| `DISABLE_DB_ROLE_SWITCHING` | `PostgresBackendDriver.ts:1234` | `false` | Compared `!== "true"`; `=1`/`=yes`/`=TRUE` silently do nothing |
| `REALTIME_CDC` | `PostgresBootstrapper.ts:487` | `auto` | Unknown value warns and falls back — clean |
| `REALTIME_CHANNEL_BUS` | `services/channel-bus/index.ts:54` | `memory` | Unknown value warns; loses to an injected instance, with a warning — clean |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `init/process-safety.ts:40` | off | `=== "1"` only |
| `REBASE_LOG_RAW_QUERIES` | `utils/logger.ts:110` | off | Ignored in production by construction — clean |
| `REBASE_CRON_ALWAYS_ON` | `cron/scale-to-zero.ts:65` | off | Accepts `1\|true\|yes\|on` |
| `K_SERVICE`, `K_REVISION`, `K_CONFIGURATION`, `CLOUD_RUN_JOB`, `AWS_LAMBDA_FUNCTION_NAME`, `VERCEL`, `KUBERNETES_SERVICE_HOST` | `cron/scale-to-zero.ts:61-85` | — | Platform detection for the cron scale-to-zero warning |
| `REBASE_BUNDLE` | `boot/boot.ts:103`, `infra/docker/entrypoint.mjs:13`, `cli/commands/start.ts:87` | `dist-bundle` / `/bundle` | Missing manifest ⇒ hard fail with a hint |
| `REBASE_BUNDLE_URL` / `REBASE_BUNDLE_TOKEN` | `boot/fetch-bundle.ts:41,43` | — | A local `REBASE_BUNDLE` always wins |
| `REBASE_DEV_PROJECT_ROOT` | `boot/boot.ts:115` | `cwd` | Dev port file location |
| `BACKUP_SCHEDULE`, `BACKUP_DESTINATION`, `BACKUP_RETENTION_DAYS`, `BACKUP_KEEP_MINIMUM` | `server-postgres/src/backup/backup-cron.ts:68-90` | cron off when schedule unset | Non-integer values are named and refused — clean |
| `PG_DUMP_PATH` / `PG_RESTORE_PATH` | `backup/backup-service.ts:50-51` | PATH lookup | Diagnosed, not guessed |
| `DOTENV_CONFIG_PATH` | `server-postgres/src/cli.ts:36,552,770`, `doctor-cli.ts:27`, `introspect-db.ts:54`, `mcp/index.ts:644`, `cli/runtime/dev-server.mjs:19` | project `.env` | — |
| `<BASE>__<KEY>` suffixed twins of every DB and storage variable | `boot/sources.ts:66` | — | **Bypass every zod refinement — finding 11** |

### D. CLI and tooling

`REBASE_TELEMETRY_ENDPOINT`, `REBASE_TELEMETRY_DISABLED`, `DO_NOT_TRACK`, `CI`
(`cli/src/telemetry/index.ts:19,54-56`); `REBASE_DEBUG` (`cli/bin/rebase.js:106`);
`REBASE_AUTO_GENERATE` / `REBASE_GENERATE` (`cli/src/commands/dev.ts:234`);
`REBASE_DEV_APP` / `_CONFIG` / `_CRONS` / `_FUNCTIONS` / `_SCHEMA`
(`cli/runtime/dev-server.mjs:30-34`); `REBASE_CLOUD_URL`
(`cli/src/commands/cloud/context.ts:164`); `REBASE_JSON`
(`cloud/context.ts:547`); `REBASE_ENV_FILE_PATH`, `REBASE_RESET_EMAIL`,
`REBASE_RESET_PASSWORD`, `REBASE_BASE_URL` (`cli/src/commands/auth.ts:170-291`);
`REBASE_E2E` (`init.ts:894`); `REBASE_APP_BASE`, `REBASE_APP_PATH`,
`REBASE_APP_NAME` (`fold-static.ts:188-193`); `REBASE_PROJECT_DIR`,
`REBASE_API_TOKEN`, `REBASE_TOKEN`, `REBASE_MCP_ALLOW_REMOTE_WRITES`
(`mcp/src/index.ts:311-544`); `HOME`, `USERPROFILE`, `PATH`, `PATHEXT`,
`npm_config_user_agent`.

### E. Control plane — `saas/backend/src/env.ts` (read only; not in scope to fix)

Extends `loadEnv` with `GITHUB_*`, `LINKEDIN_*`, `SMTP_*`, `APP_NAME`,
`ENCRYPTION_KEY` (64-hex regex, optional in the schema and asserted fatal at boot
by `src/index.ts`), `TENANT_BASE_DOMAIN` (bare-hostname refinement, fatal in
production). Everything else the control plane reads is lazy: `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `DEFAULT_CLUSTER_ID`, `TENANT_INGRESS_IPV4`,
`DOMAIN_VERIFICATION_SECRET`, `SSH_PRIVATE_KEY_ENCRYPTION_KEY`, `BACKUP_S3_*`,
`BUILD_GCP_KEY`, `GCP_SA_KEY`, `MANAGED_REGION`, `MANAGED_RUNTIME_REGISTRY`,
`REBASE_BYO_FREE`, `DEV_SEED_PASSWORD`, `KUBERNETES_SERVICE_HOST` (6 sites),
`STUDIO_DEV_TENANT_*`, `MAX_*_BYTES`, `DEPLOY_*_TTL_MS`, `DNS_RESOLVERS`,
`SEED_SAAS_DATA`, `REBASE_SHARED_POOLS`, `REBASE_USAGE_METERING`,
`REBASE_MANAGED_RUNTIME`, `TENANT_REGISTRY`, `INGRESS_LOAD_BALANCER_IP`,
`BUNDLE_URL`, `BUNDLE_TOKEN`. Dev-only `ENCRYPTION_KEY` self-provisioning writes
the generated key back to `.env` and is explicitly disabled in production and test
(`saas/backend/src/env.ts:40-48`) — correct.

### F. Never read by code (compose / image only)

`REBASE_VERSION` (`docker-compose.yml:70`), `DATABASE_PASSWORD`
(`init.ts:1252,1266`), `POSTGRES_*` in the compose db service. Listed here so a
future sweep does not report them as dead.

### G. Browser bundle

Only `VITE_`-prefixed (Vite) and `PUBLIC_`-prefixed (Astro) values reach a bundle.
No `vite.config.*` or `astro.config.*` in the workspace sets `envPrefix` or a
`define:` block. Reaching a bundle today: `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`,
`VITE_GITHUB_CLIENT_ID`, `VITE_LINKEDIN_CLIENT_ID`, `import.meta.env.DEV|MODE|BASE_URL`,
and the website's `PUBLIC_FIREBASE_*` set. All are public identifiers. No `.env`
file is tracked in git (`git ls-files | grep '\.env'` returns three `.example` /
`.template` files only).

The `vite.config.ts` files set `envDir: ".."`, so the build reads the project-root
`.env` that also holds `DATABASE_URL`, `JWT_SECRET` and `S3_SECRET_ACCESS_KEY` —
safe only because Vite filters by prefix. The consequence to keep in mind is the
inverse rule: **any variable a user names `VITE_…` in that file is public**, and
nothing warns about it.

---

## Findings

### HIGH

**1. `FORCE_LOCAL_STORAGE=false` switches the production storage guard OFF.
(class 10, class 27)**

`packages/server/src/init/storage.ts:36`

```ts
if (isProduction && conf.type === "local" && !process.env.FORCE_LOCAL_STORAGE) {
```

The variable is declared in the schema as `optionalBoolString`
(`packages/server/src/env.ts:115`), which correctly parses `"false"` to `false`.
This site does not read the parsed value; it reads the raw string and tests it for
truthiness. `"false"`, `"0"`, `"no"` and `"off"` are all truthy strings, so any of
them *disables the guard* — the exact inversion the class describes.

The guard is the only thing standing between a production deployment and writing
uploads to a container filesystem that is erased on the next restart. Its own error
message says "set `FORCE_LOCAL_STORAGE=true`", so the documented value works and the
reader is broader than the document.

Failure scenario: an operator hardens a deployment by explicitly writing
`FORCE_LOCAL_STORAGE=false` — the natural way to say "no, I do not have a durable
volume". `initializeStorage` registers the local backend, the loud
`logger.error` never fires, uploads succeed with 200s, and every file is gone at the
next redeploy. Nothing fails; the data is simply not there.

Two further points make it survivable rather than obvious. The sibling reader
`app/backend/src/index.ts:58` uses the *parsed* `env.FORCE_LOCAL_STORAGE`, so the
two copies of the same decision disagree about the same string. And the test at
`packages/server/test/init-storage.test.ts:40` only ever sets `"true"` — setting it
to `"false"` leaves the suite green while the guard is off.

Fix direction: read the parsed value. Thread `env.FORCE_LOCAL_STORAGE` into
`initializeStorage` rather than reaching for `process.env` inside it, and add the
`"false"` case to the test. The general shape — a variable that has a zod
declaration *and* a raw reader — is worth sweeping for (see finding 11).

### MEDIUM

**2. `REBASE_MIGRATE_ON_BOOT`: the documented production default is `none`, the
implemented default is `ensure`; and `push` is a declared value nothing honours.
(class 21)**

`packages/server/src/boot/env.ts:36-45` documents:

> - `none` (default in production) — touch nothing.
> - `ensure` — … The default outside production.
> - `push` — reconcile collection tables with the bundle's schema … in production
>   it means a container restart can rewrite the schema, so it must be asked for
>   explicitly.

Both implementations are unconditional:

- `packages/server/src/boot/boot.ts:694` — `const mode = env.REBASE_MIGRATE_ON_BOOT || "ensure";`
- `packages/server/src/boot/boot.ts:816` — the same line again, hand-duplicated.

There is no `NODE_ENV` branch anywhere. A production runtime with the variable
unset — the normal case — runs `ensureCollectionSchema` and
`ensureCollectionPolicies` on every boot, contrary to the contract the docblock
states. An empty-string value (`REBASE_MIGRATE_ON_BOOT=` in a k8s manifest) is
falsy and also resolves to `ensure`, so the one spelling an operator might use to
mean "off" means "on".

Separately, `push` is in the enum and in the docblock, and:
- `boot.ts` distinguishes only `none`, so `push` behaves exactly as `ensure`;
- `infra/docker/entrypoint.mjs:163-175` hard-fails the container on `push` with a message
  explaining it is unsupported.

So the value is simultaneously documented as the dangerous option, inert on one
path, and fatal on the other.

Fix direction: resolve the mode once, in `boot/env.ts`, against `NODE_ENV` — the
same shape `resolveEnableSwagger` already uses one screen above — and decide
whether `push` is a value or is removed from the enum. Two call sites computing a
default by hand is how they drift.

**3. `REBASE_FUNCTIONS_TIMEOUT_MS=""` removes the custom-function request ceiling.
(class 10, class 17 second axis)**

`packages/server/src/functions/request-timeout.ts:19-22`

```ts
const fromEnv = Number(process.env.REBASE_FUNCTIONS_TIMEOUT_MS);
if (Number.isFinite(fromEnv) && fromEnv >= 0) return Math.floor(fromEnv);
```

`Number("")` is `0`, which is finite and non-negative, and `0` is documented three
lines above as "disables the ceiling". An empty-valued environment variable —
routine in a Helm chart or a Compose file that templates an unset optional — is
therefore not "unset", it is "no timeout". The function router is described in the
same file as "the one router that runs code the framework did not write", and on
the managed runtime the process is shared between tenants.

The lesson was already learned, one file over: `REBASE_MAX_BODY_SIZE`
(`boot/env.ts:97-110`) is a `z.coerce.number()` in the schema *specifically*
because a value nobody can interpret would otherwise "silently remove every body
limit from the API". That reasoning was applied to one of the two request-bounding
variables. `TRUSTED_PROXY_HOPS` (finding 14) is the third instance of the shape.

Fix direction: put it in `bootEnvExtension` with the same `z.coerce.number()`
treatment, and reserve `0` for an explicit `0`.

**4. `MFA_ENCRYPTION_KEY` falls back to `JWT_SECRET`, so rotating the JWT secret
bricks every enrolled TOTP.**

`packages/server/src/auth/mfa-crypto.ts:86-106`. The key chain is
`MFA_ENCRYPTION_KEY` → each entry of `MFA_ENCRYPTION_KEY_PREVIOUS` →
`JWT_SECRET`. When `MFA_ENCRYPTION_KEY` is unset the fallback is warned about once
and then used for **new** ciphertexts as well as old ones (`currentKey()` is
`keyCandidates()[0]`).

Rotating `JWT_SECRET` is a routine incident response and is documented nowhere as
coupled to MFA. After a rotation, every stored TOTP secret is undecryptable and
every user with MFA enabled is locked out — recoverable only by an admin
disenrolling them. In development the coupling is sharper still, because
`loadEnv` regenerates `JWT_SECRET` on every boot when it is unset
(`env.ts:188`), so a developer's own MFA enrolment survives exactly one restart.

Neither `MFA_ENCRYPTION_KEY` nor `MFA_ENCRYPTION_KEY_PREVIOUS` appears in either
zod schema or in any `.env.example`, and neither is length- or format-checked; a
one-character key is accepted.

Fix direction: keep the fallback for reads (it is what makes existing deployments
work) but refuse it for **writes** in production, so a deployment that has enrolled
anybody must name a dedicated key. Declare both variables in `bootEnvExtension`
with a minimum length, and say in the rotation notes that `JWT_SECRET` is load-bearing
for MFA until `MFA_ENCRYPTION_KEY` is set.

**5. The static-app boot path bypasses `loadBootEnv` entirely.**

`packages/server/src/boot/boot.ts:437-443` and `522-530`. A `kind: "static"`
bundle returns from `bootStaticApp` before `loadBootEnv` is called, and reads
`NODE_ENV`, `PORT`, `REBASE_BASE_PATH`, `REBASE_METRICS` and
`REBASE_METRICS_TOKEN` straight from `process.env`. The reason given — a static app
needs neither `DATABASE_URL` nor `JWT_SECRET` — is sound; the consequence is not
scoped to it.

What a static app loses along with the database requirement: the
localhost-in-production sweep (`env.ts:221-236`), the enum validation of
`NODE_ENV` and `LOG_LEVEL`, and every future refinement added to either schema. The
synthesized `env` object at line 524 is cast `as unknown as RebaseBootEnv`, so
nothing type-checks the divergence either.

This is the second-axis form of class 17: a rule applied at one of two entry points
is not a rule. Fix direction: give the static path a real (narrow) schema — a
`staticEnvSchema` that `bootEnvExtension` and it both extend, or a
`loadBootEnv({ requireDatabase: false })` — so the shared refinements run once.

**6. `rebase start` inherits `NODE_ENV=development` from the scaffolded `.env`.**

`packages/cli/src/commands/start.ts:81-91` loads the project `.env` and calls
`runFromBundle`. It never sets `NODE_ENV`. The scaffolded `.env` — produced by
`rebase init` copying `.env.example` (`init.ts:1109-1113`) — carries
`NODE_ENV=development` (`packages/cli/templates/template/.env.example:41`).

Only two places pin production: `infra/docker/server.Dockerfile:112` (`ENV NODE_ENV=production`)
and the generated `docker-compose.yml:82`. A self-hoster who runs
`rebase start` on a VPS instead of the compose stack therefore gets, silently:

- Swagger and the OpenAPI spec served (`resolveEnableSwagger`, unset ⇒ dev ⇒ on);
- Postgres `message`, `detail` and `hint` in HTTP error bodies (`api/errors.ts:317`);
- the schema editor mounted (`init.ts:1163`);
- the dev CORS resolver, which reflects any localhost origin and answers `*` for a
  request with no `Origin` (`boot/env.ts:202-207`);
- no `CORS_ORIGINS`/`FRONTEND_URL` requirement, and no localhost-in-production sweep;
- local storage permitted.

`rebase init` does generate a real `JWT_SECRET` and `REBASE_SERVICE_KEY` into a
0600 `.env` (`init.ts:1119-1157`), so the per-pod-ephemeral-secret case is closed
for scaffolded projects — but it remains open for anyone who writes their own
`.env`, and it is the one default that would be catastrophic: two replicas would
sign tokens with different keys and reject each other's.

Fix direction: `rebase start` is the production command (its own `.env.example`
comment says so). Default `NODE_ENV` to `production` there when the environment
does not say otherwise, or refuse to start with `NODE_ENV=development` unless
`--dev` is passed. At minimum, log a single loud line at boot when a process
without `NODE_ENV=production` is listening on a non-loopback interface.

### LOW

**7. `optionalBoolString` is not the tri-state its callers document. (class 10, latent)**

`packages/server/src/env.ts:22`

```ts
const optionalBoolString = z.enum(["true", "false", ""]).optional().transform(v => v === "true");
```

The transform runs after `.optional()`, so the output type is `boolean` and never
`undefined` — confirmed in the generated `packages/server/dist/env.d.ts:26-29`
(`ZodTransform<boolean, "" | "true" | "false" | undefined>`). The comment two lines
above `DISABLE_SELF_REGISTRATION` (`env.ts:103-106`) states the opposite:

> Optional so an unset variable means "not configured" rather than an explicit false.

Harmless today because every consumer coalesces (`init.ts:1063`,
`boot/options.ts:52`), so `false` and `undefined` are indistinguishable downstream.
It becomes a bug the moment anything writes `if (config.disableSelfRegistration !== undefined)`
to let an env var override an adapter setting — at which point *every* deployment
would be explicitly overriding it to `false`. Fix: `.transform(v => v === undefined ? undefined : v === "true")`,
or delete the comment.

**8. Six boolean parsers, one concept.**

| Spelling | Site |
|---|---|
| `v === "true"` (zod enum, rejects other values) | `env.ts:17,22` |
| `v !== "false"` (default-on) | `boot/env.ts:33,68,111,112` |
| raw truthiness of the string | `init/storage.ts:36` |
| `!== "true"` | `PostgresBackendDriver.ts:1234` |
| `/^(1\|true\|yes)$/i` | `mcp/src/index.ts:544` |
| `1\|true\|yes\|on` | `cron/scale-to-zero.ts:52` |
| `x && x !== "0"` | `cli/src/telemetry/index.ts:54-56` |

Concretely: `DISABLE_DB_ROLE_SWITCHING=1` silently does nothing, while
`REBASE_MCP_ALLOW_REMOTE_WRITES=1` works and `REBASE_CRON_ALWAYS_ON=on` works.
`.env.example:171` documents the `true` spelling, so the documented path is fine —
but a user who reaches for a different spelling gets silence rather than an error.
Fix direction: one exported `parseEnvBool` with a documented accepted set, used
everywhere that is not a zod enum.

**9. `rebase.json`: unknown top-level keys are silently dropped on read.
(class 27 — the same class the file's own comment records)**

`packages/cli/src/manifest.ts:408-415` builds the returned manifest from exactly
five keys: `$schema`, `rebase`, `apps`, `storage`, `telemetry`. Any other top-level
key is absent from the in-memory manifest, and nothing warns —
`warnUnknownFields` (`manifest.ts:175-187`) exists only for fields inside
`apps.<name>`. The same applies one level down: `validateStorageSources`
(`manifest.ts:477-481`) rebuilds each source from `engine`/`transport`/`label`, so
a fourth key in a storage block vanishes without a word.

The comment at `manifest.ts:384-393` is a post-mortem of exactly this: `telemetry`
was being dropped, which meant `rebase eject` deleted a committed `"telemetry": false`
and silently resumed sending events. The instance was fixed by adding the key to the
list. The shape was not.

Blast radius is smaller than the collection case because `writeManifest`
(`manifest.ts:639-642`) *does* carry unmodelled keys through to disk, so nothing is
destroyed — the key is merely inert. But a typo (`"strorage"`) produces a project
with no storage sources and no message, which is the failure `warnUnknownFields`
was written to prevent for app fields.

Fix direction: apply `warnUnknownFields` at the top level and inside each storage
source, against the same near-miss suggester.

**10. `stripNonClientFields` is a two-key denylist.**

`packages/server/src/api/contract-routes.ts:54-70` removes `securityRules` and
`callbacks` before publishing a collection over `/api/meta/contract`. Every other
server-side key — `auth`, `disableDefaultPolicies`, `strictWrites`, `history`,
`table`, `schema`, `dataSource`, `search` — is published, and a key added tomorrow
is published by default.

Currently low because the endpoint is admin-gated, and gated correctly: with no way
to authenticate it is not served at all (`init.ts:1855-1874`). The exposure is to
holders of an admin credential, which is the audience the endpoint is for. Worth
noting because the direction of the default is wrong: the docblock argues the
generator "reads the slug, the properties and the relations", which is an allowlist
argument implemented as a denylist.

**11. Suffixed source variables skip every schema refinement.**

`packages/server/src/boot/sources.ts:66-75` reads `<BASE>__<KEY>` directly from an
`EnvBag`, and `boot.ts:153` and `boot.ts:196-200` pass raw `process.env` rather than
the parsed env. So `S3_ENDPOINT` must be a valid URL to boot
(`env.ts:126`) while `S3_ENDPOINT__MEDIA` may be anything;
`DATABASE_URL` is `.url()`-checked and swept for localhost while
`DATABASE_URL__ANALYTICS` is neither — a named source may point at
`localhost:5432` in production and boot cleanly. `readBool` (`sources.ts:74`) also
accepts only the literal `"true"`, so `S3_FORCE_PATH_STYLE__MEDIA=1` is `false`.

The unsuffixed variables are the second half of this: they are validated by zod and
then *re-read raw* for the value actually used. The two reads agree today because
they read the same string, so this is a latent duplication rather than a live bug —
except in the one case where they do not agree, which is finding 1.

Fix direction: derive the suffixed variables' validation from the same zod fields
(a `z.object` built per suffix), or at minimum extend the localhost-in-production
sweep to any key matching `^(DATABASE_URL|ADMIN_CONNECTION_STRING|S3_ENDPOINT)__`.

**12. `.env.example` is materially incomplete.**

The template (`packages/cli/templates/template/.env.example`) documents roughly 35
variables. The runtime reads roughly 60. Absent from the file and security- or
availability-relevant:

`STORAGE_PUBLIC_READ`, `STORAGE_ALLOW_ANY_AUTHENTICATED`, `AUTH_REQUIRE`,
`AUTH_ALLOW_USER_LOOKUP`, `AUTH_COOKIE_SAME_SITE`, `AUTH_DEFAULT_ROLE`,
`DISABLE_SELF_REGISTRATION`, `GITHUB_CLIENT_ID`/`_SECRET`,
`MICROSOFT_CLIENT_ID`/`_SECRET`, `GOOGLE_CLIENT_SECRET` (the file lists only the
id; `app/.env.example` gets this right and explains why all three are needed),
`REBASE_METRICS`, `REBASE_METRICS_TOKEN`, `REBASE_MIGRATE_ON_BOOT`,
`REBASE_SERVE_STATIC`, `REBASE_ENABLE_SWAGGER`, `REBASE_MAX_BODY_SIZE`,
`REBASE_COMPRESSION`, `REBASE_HISTORY`, `REBASE_BASE_PATH`, `TRUSTED_PROXY_HOPS`,
`MFA_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY_PREVIOUS`,
`REBASE_STRICT_COLLECTION_CONFIG`, `REBASE_FUNCTIONS_TIMEOUT_MS`,
`REBASE_CRON_ALWAYS_ON`, `REBASE_EXIT_ON_UNHANDLED_REJECTION`,
`DATABASE_READ_URL`, `DATABASE_DIRECT_URL`, `REALTIME_CDC`,
`REALTIME_CHANNEL_BUS`.

Placeholder quality is good: `changeme` in the sample `DATABASE_URL` is replaced
with a generated password by `init` (`init.ts:1266`), `JWT_SECRET` and
`REBASE_SERVICE_KEY` are generated, `VITE_API_URL` is deliberately blanked with a
long explanation of why an absolute URL baked at build time is dangerous, and the
file is chmod 0600 before any secret is written into it (`init.ts:1119`). No
working credential ships in any tracked `.env*` file.

Fix direction: a generated section. The two schemas are already data —
`rebaseEnvSchema.shape` and `bootEnvExtension.shape` — so a script can emit the
commented block and a test can assert the file names every schema key, the same
ratchet shape `check:unused` uses.

**13. `.env.example` sets `JWT_REFRESH_EXPIRES_IN=30d`; the schema default is `400d`.**

`packages/cli/templates/template/.env.example:54` vs `packages/server/src/env.ts:98`.
The schema comment explains 400d carefully — the token is sliding, so the value
governs *inactivity*, and 400d is the browser cookie ceiling. Every scaffolded
project silently overrides that reasoning with a value nobody chose. Either the
scaffold should not set it, or the comment should say why 30d is right for a new
project.

**14. `TRUSTED_PROXY_HOPS=""` resolves to 0; garbage resolves to 1.**

`packages/server/src/auth/rate-limiter.ts:54-58`. `Number("")` is `0`, finite and
non-negative, so an empty value means "no proxy in front of me". This one fails in
the *safe* direction — with hops 0 the limiter uses the unforgeable socket address
and stops believing `X-Real-IP` (the fix documented at `rate-limiter.ts:133-143`) —
but behind a real proxy it collapses every client into the proxy's single bucket,
so the login and password-reset limiters throttle everybody at once. Note the
asymmetry: `TRUSTED_PROXY_HOPS=` gives 0 while `TRUSTED_PROXY_HOPS=abc` gives 1.
Same fix as finding 3.

---

## Checked and clean

- **`validate-config` does not drop unknown keys.** It reports them
  (`validate-config.ts:324-334`) at `warning` by default, `error` under
  `REBASE_STRICT_COLLECTION_CONFIG`, and returns the collection untouched. The
  message's phrase "is being ignored" describes downstream behaviour, not an act
  this file performs.
- **`securityRules` is safe.** It is in `COLLECTION_KEY_LIST`
  (`validate-config.ts:113`), and the `AssertNever<MissingCollectionKeys>` assertion
  (`validate-config.ts:137-149`) makes any new key on `PostgresCollectionConfig`,
  `FirebaseCollectionConfig` or `MongoDBCollectionConfig` a compile error until the
  list learns it. The worst case the brief asked about — a `securityRules` block
  silently discarded — cannot happen through this path.
- **`assertCollectionConfigs` is genuinely wired**, at both the direct-config path
  (`init.ts:653`) and the directory loader (`collections/loader.ts:108`) — not a
  validator nobody calls.
- **Production CORS.** `resolveCorsOrigin` (`boot/env.ts:199-231`) serves an
  explicit allow-list only, refuses an empty list, and refuses `*` with a message
  explaining that browsers reject it on credentialed requests. `loadEnv` refuses the
  boot earlier for the same reason.
- **The localhost-in-production sweep** (`env.ts:221-236`) walks every parsed value,
  handles bare hosts, bracketed IPv6 and non-HTTP schemes, and deliberately does not
  echo the value into the log because these variables carry credentials.
- **`resolveEnableSwagger`** (`boot/env.ts:183-186`) is the reference tri-state:
  explicit wins either way, unset follows `NODE_ENV`, and `undefined` is returned
  deliberately so one policy decides.
- **`REBASE_MAX_BODY_SIZE`** is the reference numeric coercion.
- **Telemetry** (`cli/src/telemetry/index.ts:52-63`) is opt-in with every branch
  refusing by default, honours `DO_NOT_TRACK` and `CI`, and lets a project's
  `"telemetry": false` beat an individual opt-in.
- **The contract endpoint** is admin-gated, and when it cannot be gated it is not
  served (`init.ts:1855-1874`) rather than served open.
- **Storage source suffix collisions** are refused at both the CLI
  (`manifest.ts:484-492`) and boot (`sources.ts:83-96`); an s3 source with a bucket
  and no credentials is a hard boot error rather than a runtime signing failure
  (`sources.ts:295-305`).
- **`REALTIME_CDC` and `REALTIME_CHANNEL_BUS`** both validate, warn on an unknown
  value, fall back safely, and document their precedence against a
  programmatically-supplied instance.
- **Backup cron variables** name and refuse non-integers rather than coercing.
- **Browser exposure**: no widened `envPrefix`, no `define:` injection, no tracked
  `.env`, only public identifiers in bundles, and `fold-static.ts:188-193` forces
  `NODE_ENV=production` and blanks `VITE_API_URL` for folded frontend builds.
- **`rebase init`** writes `.env` at 0600 *before* putting a secret in it, generates
  `JWT_SECRET`, `REBASE_SERVICE_KEY` and the database password, pins
  `REBASE_VERSION`, and rewrites the file's "copy this and fill in the values"
  banner so nobody overwrites the filled-in copy.
- **`internalServiceKey`** (`init.ts:948`) is a fresh 48 random bytes when
  `REBASE_SERVICE_KEY` is unset — a fallback that cannot be guessed.
- **saas dev `ENCRYPTION_KEY` provisioning** persists the generated key to `.env` so
  restarts stay readable, and is disabled in production and test
  (`saas/backend/src/env.ts:40-48`).

---

## Open questions

1. Is `REBASE_MIGRATE_ON_BOOT=push` meant to exist? It is in the enum, inert in
   `boot.ts`, and fatal in `infra/docker/entrypoint.mjs`. Removing it from the enum and
   the docblock may be the honest fix.
2. Should `rebase start` default `NODE_ENV` to `production`? It is documented as the
   production command, but changing the default is a behaviour change for anyone
   using it locally.
3. `REBASE_TELEMETRY_ENDPOINT` (`cli/src/telemetry/index.ts:19`) lets the
   environment redirect telemetry to an arbitrary host. Payloads are sanitized and
   sending is opt-in, so this is probably fine — but it is an env var that changes
   where data goes, with no allow-list.
4. Is there any value in a `check:env` gate that asserts (a) every schema key
   appears in the template `.env.example`, and (b) no `process.env.X` read exists
   for an `X` that a schema already declares? Both are mechanical, and (b) is the
   detector for finding 1's class.
5. `packages/server/src/env.ts:90` — `PORT: z.string().default("3001").transform(Number)`
   produces `NaN` for a non-numeric value with no complaint. The static path guards
   it with `|| 3001` (`boot.ts:440`) and `resolveStartPort` guards it with a warning
   (`cli/commands/dev.ts:158-167`); the main boot path does not obviously. Not traced
   to a concrete failure — UNCONFIRMED.
6. Whether any production tenant currently runs with `FORCE_LOCAL_STORAGE` set to a
   falsy-looking string. That is a fleet query, not a code question, and it should be
   answered before finding 1 is treated as theoretical.
