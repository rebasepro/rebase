# Unit 2 — the HTTP route surface

Read-only audit, 2026-08-09, against `main` at `c678e1745`. Scope: every route
registered by `packages/server/src/init.ts` and `packages/server/src/init/*.ts`,
plus the probe routes `packages/server/src/boot/boot.ts` adds outside `basePath`.
Route modules read in full: `api/rest/api-generator.ts`, `api/rest/idempotency.ts`,
`api/errors.ts`, `api/logs-routes.ts`, `api/contract-routes.ts`,
`api/schema-editor-routes.ts`, `api/openapi-generator.ts`, `auth/routes.ts`,
`auth/session-routes.ts`, `auth/mfa-routes.ts`, `auth/admin-users-route.ts`,
`auth/admin-roles-route.ts`, `auth/reset-password-admin.ts`,
`auth/builtin-auth-adapter.ts`, `auth/middleware.ts`, `auth/adapter-middleware.ts`,
`auth/rate-limiter.ts`, `auth/api-keys/*`, `storage/routes.ts`,
`functions/function-routes.ts`, `cron/cron-routes.ts`, `backup/backup-routes.ts`,
`history/history-routes.ts`.

## Verdict

The mounting *mechanics* are in good shape and clearly the product of previous
sweeps. Every admin surface follows the same shape — fresh router, gate, *then*
routes — so the Hono ordering trap that once left `POST /schema-editor/collection/save`
open is closed at all five call sites (`init.ts:1249, 1777, 1803, 1823, 1855`), and
the `applyAdminGate` refusal is a mounted 501 rather than an unexplained 404. Class 33
is likewise closed where it was found: `history-routes.ts:66-87` now authorizes
through the request-scoped driver before it touches the privileged history service,
and the REST generator's `getScopedDriver` (`api-generator.ts:196`) refuses to fall
back. The data plane is the reference — every one of its ~20 handlers reads through
`c.get("driver")` and every one of them calls `enforceApiKeyPermission` first.

The failures are on the edges of that surface, and they are the same two shapes the
log keeps naming: **a route that disagrees with its sibling**, and **a gate that
guards one door of a two-door room**.

The one that matters is the second. `POST /auth/anonymous` (`session-routes.ts:359`)
mints a real, authenticated session for anyone who asks, is mounted unconditionally,
and is gated by no registration policy whatsoever. `POST /admin/bootstrap`
(`admin-users-route.ts:73`) grants the `admin` role to whichever authenticated caller
is the earliest-registered user of an admin-less database. On an empty backend those
two compose into an unauthenticated first-admin seizure, and — this is the part that
makes it a bug rather than the documented bootstrap — it works with
`disableSelfRegistration: true`, the flag whose own docblock promises "an empty
backend has no self-service path in at all" (`init.ts:104`). One route was written to
be the hard kill switch; a second account-creating route was added beside it and never
told about it.

Below that: `GET {basePath}/docs` publishes the collection schema to anonymous callers
while its sibling `GET {basePath}/meta/contract` is admin-gated for precisely that
reason; `POST /auth/link/<provider>` returns the OAuth provider's raw error text three
hundred lines below the sign-in route that deliberately does not; `GET /health`
returns the raw driver error string; and `GET {basePath}/storage/sources` is the one
storage route with no gate on it. Nothing in the inventory is an unauthorized *write*,
and no route reads collection data on a privileged connection.

---

## Route inventory

Legend — **RLS binding**: `bound` = reads/writes through the request-scoped driver
(`c.get("driver")`, produced by `scopeDataDriver`); `service` = a privileged handle
captured in a closure (auth repository, `ApiKeyStore`, `HistoryService`,
`CronScheduler`, log ring buffer) — the route in front of it *is* the access-control
model; `none` = touches no database. **OpenAPI**: whether the operation appears in
`GET {bp}/docs`. `{bp}` is `config.basePath`, default `/api`.

### Probes and docs (no auth middleware anywhere on the chain)

| Method + path | Registered at | Auth gate | RLS | Rate limiter | OpenAPI |
|---|---|---|---|---|---|
| `GET /health`, `GET {bp}/health` | `boot/boot.ts:284` | none | service (`SELECT 1` + auth-schema probe) | none | no |
| `GET /livez` | `boot/boot.ts:318` | none | none | none | no |
| `GET /metrics` | `boot/boot.ts:329` → `metrics/index.ts:326` | bearer `REBASE_METRICS_TOKEN` **if set**; open if unset (boot warns) | none | none | no |
| `GET {bp}/docs` | `init/docs.ts:28` | **none** | none | none | is the document |
| `GET {bp}/swagger` | `init/docs.ts:37` | **none** (non-production only) | none | none | no |

### Auth — `{bp}/auth` (mounted only when `config.auth` is set)

App-level middleware on `{bp}/*` for every row below: requestId → compression →
bodyLimit(10 MB) → csrf (opt-in) → requestLogger → logMiddleware
(`init/middlewares.ts:35-93`). No auth is applied at router level; each route names
its own middleware in-line. All of them read through the bootstrapped `AuthRepository`
— a privileged, owner-connection handle — so every row is `service`.

| Method + path | Registered at | Auth gate | RLS | Rate limiter | OpenAPI |
|---|---|---|---|---|---|
| `GET {bp}/auth/config` | `init.ts:1016` (direct; **shadows** the router copy) | none | service | **none** | no |
| `GET /config` | `session-routes.ts:327` | none | service | `defaultAuthLimiter` | **unreachable** under `initializeRebaseBackend` |
| `POST /register` | `routes.ts:349` | none | service | `defaultAuthLimiter` 200/15m/IP | no |
| `POST /login` | `routes.ts:456` | none | service | `defaultAuthLimiter` | no |
| `POST /<provider>` (per OAuth provider) | `routes.ts:524` | none | service | `defaultAuthLimiter` | no |
| `POST /link/<provider>` | `routes.ts:688` | `requireAuth` (in-line) | service | `defaultAuthLimiter` | no |
| `POST /forgot-password` | `routes.ts:738` | none | service | `strictAuthLimiter` 50/15m/IP | no |
| `POST /reset-password` | `routes.ts:796` | none (bearer token in body) | service | `strictAuthLimiter` | no |
| `POST /change-password` | `routes.ts:843` | `requireAuth` | service | **none** | no |
| `POST /send-verification` | `routes.ts:892` | `requireAuth` | service | `strictAuthLimiter` + `verificationEmailLimiter` 5/15m/uid | no |
| `GET /verify-email` | `routes.ts:950` | none (token in query) | service | **none** | no |
| `POST /refresh` | `routes.ts:974` | none (token in body or httpOnly cookie) | service | **none** | no |
| `POST /logout` | `session-routes.ts:71` | none | service | none | no |
| `GET /sessions` | `session-routes.ts:117` | `requireAuth` | service | none | no |
| `DELETE /sessions` | `session-routes.ts:163` | `requireAuth` | service | none | no |
| `DELETE /sessions/:id` | `session-routes.ts:184` | `requireAuth` | service | none | no |
| `GET /me` | `session-routes.ts:215` | `requireAuth` | service | none | no |
| `PATCH /me` | `session-routes.ts:269` | `requireAuth` | service | none | no |
| `POST /find-user` (only if `allowUserLookup`) | `session-routes.ts:250` | `requireAuth` | service | `defaultAuthLimiter` | no |
| `POST /anonymous` | `session-routes.ts:359` | **none** | service (creates a user row) | `strictAuthLimiter` | no |
| `POST /anonymous/link` | `session-routes.ts:419` | `requireAuth` | service | **none** | no |
| `POST /mfa/enroll` | `mfa-routes.ts:220` | `requireAuth` + `requireStepUpForFactorChange` | service | `strictAuthLimiter` | no |
| `POST /mfa/verify` | `mfa-routes.ts:277` | `requireAuth` + step-up | service | `strict` + `mfaVerificationLimiter` (uid-keyed) | no |
| `POST /mfa/challenge` | `mfa-routes.ts:324` | in-handler `resolveStepUpPrincipal` (access **or** MFA-pending token) | service | `strictAuthLimiter` | no |
| `POST /mfa/challenge/verify` | `mfa-routes.ts:360` | in-handler principal + per-challenge attempt cap | service | `strict` + `mfaVerificationLimiter` | no |
| `GET /mfa/factors` | `mfa-routes.ts:475` | `requireAuth` | service | `strictAuthLimiter` | no |
| `DELETE /mfa/unenroll` | `mfa-routes.ts:497` | `requireAuth` | service | `strictAuthLimiter` | no |
| `POST /magic-link` (if `enableMagicLink`) | `magic-link-routes.ts:65` | none | service | `strictAuthLimiter` | no |
| `POST /magic-link/verify` | `magic-link-routes.ts:125` | none (token in body) | service | `strictAuthLimiter` | no |

### Admin — `{bp}/admin`

`config.app.use("{bp}/admin/*", apiKeyPreAuth)` is registered at `init.ts:980`,
**before** every `/admin` router, so `rk_` tokens are resolved in front of the JWT
gates. Ordering verified correct.

| Method + path | Registered at | Auth gate | RLS | Rate limiter | OpenAPI |
|---|---|---|---|---|---|
| `GET/POST {bp}/admin/api-keys`, `GET/PUT/DELETE …/:id` | `api-key-routes.ts:86-213`, gates at `:79-83` | `createRequireAuth(serviceKey)` → `rejectApiKeyAuth` → `requireAdmin`, all `use()` before routes | service (`ApiKeyStore`, unscoped driver) | none | no |
| `POST {bp}/admin/bootstrap` | `admin-users-route.ts:73` | `createRequireAuth` only — **no `requireAdmin` by design**; gated on "no admin exists" + "caller is the earliest-registered user" | service | none | no |
| `GET {bp}/admin/users` | `admin-users-route.ts:159` | `createRequireAuth` (`:71`) + `requireAdmin` | service | none | no |
| `GET {bp}/admin/users/:uid` | `admin-users-route.ts:215` | same | service | none | no |
| `POST {bp}/admin/users` | `admin-users-route.ts:227` | same | service | none | no |
| `PUT {bp}/admin/users/:uid` | `admin-users-route.ts:286` | same (+ last-admin guard) | service | none | no |
| `DELETE {bp}/admin/users/:uid` | `admin-users-route.ts:335` | same (+ self-delete and last-admin guards) | service | none | no |
| `POST {bp}/admin/users/:uid/reset-password` | `reset-password-admin.ts:47` | `createRequireAuth` (`:45`) + `requireAdmin` | service | none | no |
| `GET {bp}/admin/roles` | `admin-roles-route.ts:30` | `createRequireAuth` (`:28`) + `requireAdmin` | service | none | no |
| `GET {bp}/admin/backups` | `backup-routes.ts:29`, gate `init.ts:1803` | `applyAdminGate` (apiKeyPreAuth + requireAuth + requireAdmin) | none (filesystem / object store) | none | no |
| `GET {bp}/admin/backups/download?key=` | `backup-routes.ts:38` | same | none | none | no |

### Other admin surfaces

| Method + path | Registered at | Auth gate | RLS | Rate limiter | OpenAPI |
|---|---|---|---|---|---|
| `GET {bp}/schema-editor/status` | `init.ts:1251` | `applyAdminGate` (`:1249`, before) | none | none | no |
| `POST {bp}/schema-editor/property/save` | `schema-editor-routes.ts:11` | `applyAdminGate` | none (rewrites source files) | none | no |
| `POST …/property/delete` | `schema-editor-routes.ts:18` | same | none | none | no |
| `POST …/collection/save` | `schema-editor-routes.ts:32` | same | none | none | no |
| `POST …/collection/delete` | `schema-editor-routes.ts:39` | same | none | none | no |
| `ALL {bp}/schema-editor/*` → 501 | `init.ts:1263` | same | none | none | no |
| `GET {bp}/cron` | `cron-routes.ts:23` | `applyAdminGate` (`:1777`) | service (`CronScheduler`) | none | no |
| `GET {bp}/cron/:id` | `cron-routes.ts:29` | same | service | none | no |
| `POST {bp}/cron/:id/trigger` | `cron-routes.ts:39` | same | service (runs the job as the singleton) | none | no |
| `GET {bp}/cron/:id/logs` | `cron-routes.ts:52` | same | service (`cron_logs`) | none | no |
| `PUT {bp}/cron/:id` | `cron-routes.ts:67` | same | service | none | no |
| `GET {bp}/logs` | `logs-routes.ts:113` | `applyAdminGate` (`:1823`) | service (process-global ring buffer) | none | no |
| `GET {bp}/logs/latest` | `logs-routes.ts:127` | same | service | none | no |
| `GET {bp}/meta/contract` | `contract-routes.ts:87` | `apiKeyPreAuth` + `createRequireAuth` + `requireAdmin` (`init.ts:1855`, before); 404 when auth is unconfigurable | service (collection registry) | none | no |
| `GET {bp}/meta/schema-version` | `contract-routes.ts:122` | **none, deliberately** | service (cached hash) | none | no |

### Storage — `{bp}/storage`

Router-level, in order: `apiKeyPreAuth` + `createStorageApiKeyGuard()` when an API-key
store exists (`init.ts:1335`), then `bodyLimit(maxFileSize)` on `/upload`
(`init.ts:1339`), then the routes. `writeAuthMiddleware`/`readAuthMiddleware` resolve
to the adapter-backed pair or the JWT pair (`routes.ts:389-394`);
`requireAuth = resolveRequireAuth(config.auth)`, `publicRead = storagePublicRead`.
"authorize" = the `storageAuthorize` hook via `checkAuthorized` (`routes.ts:324`),
which is the **entire** access-control model when it is configured, and a no-op when
it is not (production boot refuses that state — `init/storage.ts:120`). No storage
route is under the data rate limiter.

| Method + path | Registered at | Auth gate | RLS | Rate limiter | OpenAPI |
|---|---|---|---|---|---|
| `POST /upload` | `routes.ts:433` | `writeAuthMiddleware` + authorize(`write`) | n/a | none | no |
| `GET /file/*` | `routes.ts:475` | `fileTokenAuth` → `publicObjectAuth` → `readAuthMiddleware` + authorize(`read`) | n/a | none | no |
| `GET /metadata/*` | `routes.ts:585` | same chain + authorize(`read`); **mints the scoped download token** | n/a | none | no |
| `DELETE /file/*` | `routes.ts:633` | `writeAuthMiddleware` + authorize(`delete`) | n/a | none | no |
| `GET /list` | `routes.ts:658` | `writeAuthMiddleware` + authorize(`list`) | n/a | none | no |
| `POST /folder` | `routes.ts:697` | `writeAuthMiddleware` + authorize(`write`) | n/a | none | no |
| `OPTIONS /tus` | `routes.ts:764` | none (protocol discovery) | n/a | none | no |
| `POST /tus` | `routes.ts:765` | `writeAuthMiddleware` + authorize inside `TusHandler` | n/a | none | no |
| `GET /tus/:id` | `routes.ts:766` | `readAuthMiddleware` (API-key guard classifies as `write`) | n/a | none | no |
| `PATCH /tus/:id` | `routes.ts:767` | `writeAuthMiddleware` | n/a | none | no |
| `DELETE /tus/:id` | `routes.ts:768` | `writeAuthMiddleware` | n/a | none | no |
| `GET /sources` | `routes.ts:778` | **none** | n/a | none | no |
| `ALL {bp}/storage/*` → 501 (no controller) | `init.ts:1363` | none | n/a | none | no |

### Data — `{bp}/data` (mounted only when `activeCollections.length > 0`)

Router-level, in order (`init.ts:1449-1473`): `createAdapterAuthMiddleware` **or**
`createAuthMiddleware` (`requireAuth = resolveRequireAuth(config.auth)`, defaults
true) → `createDataRateLimiter` (api-key 1000 / user 1000 / anon 300 per 15 m).
History routes are mounted before the REST generator so `/:slug/:id/history` wins over
the subcollection catch-all. Every handler resolves its driver with `getScopedDriver`
and calls `enforceApiKeyPermission` / `enforceSubcollectionApiKeyPermission` first.

| Method + path | Registered at | Auth gate | RLS | Rate limiter | OpenAPI |
|---|---|---|---|---|---|
| `GET /:slug/:id/history` | `history-routes.ts:96` | router auth + `authorizeEntityRead` (api-key perms, then scoped `fetchOne` → 404) | **service** for the history table, `bound` for the precheck | data limiter | **no** |
| `POST /:slug/:id/history/:historyId/revert` | `history-routes.ts:157` | same, plus cross-entity check | bound (write) | data limiter | **no** |
| `GET /<slug>/count` | `api-generator.ts:212` | router auth + api-key perms | bound | data limiter | **no** |
| `GET /<slug>` | `api-generator.ts:224` | same | bound | data limiter | yes |
| `GET /<slug>/:id` | `api-generator.ts:278` | same | bound | data limiter | yes |
| `POST /<slug>` | `api-generator.ts:554` | same (+ auth-collection branch via `prepareUserCreation`) | bound | data limiter | yes |
| `POST /<slug>/bulk` | `api-generator.ts:401` | same | bound | data limiter | yes |
| `PATCH /<slug>/bulk` | `api-generator.ts:455` | same | bound | data limiter | yes |
| `POST /<slug>/bulk/delete` | `api-generator.ts:518` | same | bound | data limiter | yes |
| `PATCH /<slug>/:id` | `api-generator.ts:750` | same | bound | data limiter | yes |
| `PUT /<slug>/:id` | `api-generator.ts:751` | same | bound | data limiter | yes |
| `DELETE /<slug>/:id` | `api-generator.ts:754` | same | bound | data limiter | yes |
| `GET /:parent/:parentId/:rest{.+}` (nested list / get / count) | `api-generator.ts:848` | router auth + nested api-key perms | bound | data limiter | list only |
| `POST /:parent/:parentId/:rest{.+}` | `api-generator.ts:957` | same | bound | data limiter | **no** |
| `PATCH` / `PUT /:parent/:parentId/:rest{.+}` | `api-generator.ts:1025-1026` | same | bound | data limiter | **no** |
| `DELETE /:parent/:parentId/:rest{.+}` | `api-generator.ts:1029` | same | bound | data limiter | **no** |

### Functions — `{bp}/functions` (mounted only when `config.functionsDir` is set)

Router-level, in order (`init.ts:1666-1717`): request timeout (30 s default) → adapter
or builtin auth middleware with **`requireAuth: false`** → `createFunctionApiKeyGuard`
→ `createDataRateLimiter` with the looser anonymous bucket (3000/15 m).

| Method + path | Registered at | Auth gate | RLS | Rate limiter | OpenAPI |
|---|---|---|---|---|---|
| `GET {bp}/functions` | `function-routes.ts:24` | **none** (lists function names, hides skip reasons) | none | functions limiter | no |
| `ANY {bp}/functions/<name>/*` | `function-routes.ts:38` (mounts each user Hono app) | whatever the function itself registers; API keys additionally need a `functions`/`functions/<name>` grant | `bound` via `c.var.driver`, or `service` via `rebase.dataAsAdmin`, or **unrestricted** via `rebase.sql` — the function's choice | functions limiter | no |

---

## Findings

### HIGH — `POST /auth/anonymous` + `POST /admin/bootstrap` is an unauthenticated first-admin seizure, and it defeats `disableSelfRegistration`

`packages/server/src/auth/session-routes.ts:359`,
`packages/server/src/auth/admin-users-route.ts:73-139`,
`packages/server/src/init.ts:1063` and `:1098-1104`.

`POST /auth/anonymous` is mounted unconditionally by `mountSessionRoutes`
(`routes.ts:1172`) — there is no `allowAnonymous` option anywhere in
`RebaseAuthConfig` or `BuiltinAuthAdapterConfig`, and the route consults neither
`allowRegistration`, `disableSelfRegistration`, nor `isRegistrationOpen`. It calls
`authRepo.createUser` and mints a full access + refresh token pair.

`POST /admin/bootstrap` requires only `createRequireAuth` (`admin-users-route.ts:71`);
`requireAdmin` is deliberately absent. Its guards are (a) no user holds `admin`, and
(b) the caller is the earliest-registered row of `authRepo.listUsers()`. That listing
is unfiltered — `packages/server-postgres/src/auth/services.ts:342` is a bare
`select().from(usersTable)` — so an anonymous user counts.

**Failure scenario.** A freshly deployed backend, no users yet, configured with
`auth: { jwtSecret, disableSelfRegistration: true }` — the configuration whose docblock
at `init.ts:96-106` promises "an empty backend has no self-service path in at all".

1. `POST /api/auth/anonymous` → 201, access + refresh token. The users table now holds
   exactly one row, created just now, owned by the attacker.
2. `POST /api/admin/bootstrap` with that access token → `isBootstrapCompleted` is
   undefined (the builtin adapter never wires it — `builtin-auth-adapter.ts:243-250`),
   no admin exists, the caller *is* the earliest user → `setUserRoles(uid, ["admin"])`.
3. `POST /api/auth/refresh` re-reads roles from the repository (`routes.ts:1062`) and
   mints an access token carrying `roles: ["admin"]`.
4. That token passes `requireAdmin` everywhere: `/admin/users` (create/reset any
   account), `/admin/api-keys` (mint a permanent admin key), `/cron/:id/trigger`,
   `/logs`, `/admin/backups/download`, `/meta/contract`, and — outside production —
   the schema editor.

`strictAuthLimiter` (50/15 m/IP) does not bound this; one request suffices. The same
composition works with the default `allowRegistration: false`, but there it is
arguably the documented register-bootstrap exception wearing a different hat; the
sharp part is that the *explicit* kill switch does not close it.

**Fix direction.** The registration policy is already extracted
(`auth/registration-policy.ts`) precisely so a new account-creating route cannot drift
from it — route `/auth/anonymous` through it (at minimum honour
`disableSelfRegistration`; ideally make anonymous sign-in opt-in, as `allowUserLookup`
and `magicLink` already are). Independently, `POST /admin/bootstrap` should refuse a
caller whose user row has `isAnonymous: true`: an identity nobody can prove they own
tomorrow is not one that should be able to claim the admin role today. Pin it with a
test in the shape class 8 recommends — assert "no anonymous principal reaches `admin`
**by any mechanism**", driven through `createBuiltinAuthAdapter` (class 3) rather than
through `createAdminUsersRoute` directly.

### MEDIUM — `GET {bp}/docs` publishes the schema anonymously; its sibling `{bp}/meta/contract` is admin-gated for exactly that reason

`packages/server/src/init/docs.ts:22-34`, `packages/server/src/init.ts:1497`, against
`packages/server/src/init.ts:1842-1874` and
`packages/server/src/api/contract-routes.ts:20-27`.

The contract endpoint's docblock states the rule: "Collection definitions describe
every table, column and relation in the project, including ones no security rule would
ever expose — that is a map of the database, not public API documentation." It is
therefore behind `apiKeyPreAuth` + `createRequireAuth` + `requireAdmin`, and it is
served as a 404 when there is no credential to check against.

`mountOpenApiDocs` registers `app.get("{bp}/docs")` with no middleware at all, on by
default (`enableSwagger` must be explicitly `false` to suppress it), and emits every
server-transport collection's slug, every documented column with its type and
`required` flag, every filter operator, and the enumerated `to-many` relation
subpaths. It is a narrower document than `/meta/contract` — `excludeFromApi` columns,
`relation` properties and `securityRules` are stripped — but it is the same category
of disclosure, and `openapi-generator.ts:637-651` says out loud that `/docs` "is
mounted on the app, not on the data router, so it carries none of the auth middleware
`{basePath}/data` does."

**Failure scenario.** Any anonymous caller who can reach a deployed backend gets the
table and column map, including which columns are `required` — the reconnaissance step
before probing RLS with crafted filters, and, for a `baas`-mode project, a description
of a database the operator never wrote a collection file for.

**Fix direction.** Gate `/docs` the way `/contract` is gated, or make it opt-in
(`enableSwagger` currently means "not explicitly off"). If it must stay public, say so
in one place shared with the contract route so the two decisions cannot drift again.
`/swagger` should follow whatever `/docs` does.

### MEDIUM — `POST /auth/link/<provider>` returns the OAuth provider's raw error text; the sign-in route beside it deliberately does not

`packages/server/src/auth/routes.ts:697-702`, against `routes.ts:544-553`.

The sign-in handler catches `provider.verify()` and comments the decision explicitly:
"The message is logged, never returned: a provider's token-endpoint error body
routinely echoes the client_id, the redirect URI and diagnostics about the credential
state." The link handler, in the same `for` loop over the same providers, does the
opposite:

```ts
throw ApiError.unauthorized(`${provider.id} link failed: ${msg}`, "OAUTH_ERROR");
```

`errorHandler` returns 4xx messages to the client verbatim (`api/errors.ts:295-297`),
so `msg` reaches the caller.

**Failure scenario.** Any signed-in user (including one created via
`POST /auth/anonymous`) posts a deliberately malformed code to
`/api/auth/link/google` and reads back whatever the provider's token endpoint said —
in practice the `client_id`, the `redirect_uri` the backend sent, and whether the
client secret is wrong or expired. Class 31/2: two implementations of one decision,
one of which was reasoned about.

**Fix direction.** Log and return the same opaque `Invalid <provider> credentials`.
Better, extract the catch into one helper both call sites use, so the next provider
route cannot pick the wrong half.

### MEDIUM — `GET /health` returns the raw driver error string to anonymous callers

`packages/server/src/init/health.ts:49-62`, surfaced at `packages/server/src/boot/boot.ts:284-313`.

`createHealthCheck` catches any probe failure and returns
`details: { error: error.message }`; the boot handler spreads `result.details` straight
into the 503 body, and secondary data sources add `dataSources: [{ key, error }]`. The
route carries no auth and orchestrators are expected to reach it.

**Failure scenario.** During any database incident, an anonymous request to `/health`
returns the pg client's message — `connect ECONNREFUSED 10.132.0.7:5432`, an auth
failure naming the role and database, or a `relation "…" does not exist` — i.e.
internal addressing and schema names, on the one endpoint guaranteed to be exposed
through the load balancer. The rest of the codebase already draws this line:
`api/errors.ts:315-322` withholds `dbMessage`/`detail`/`hint` in production and returns
only the SQLSTATE.

**Fix direction. **Apply the same production rule: `healthy: false` plus a stable code,
with the message logged (it already is, at `health.ts:33` and `:51`) and included in
the body only outside production, or only when the metrics token is presented.

### LOW — the live `GET {bp}/auth/config` has no rate limiter; the copy it shadows does

`packages/server/src/init.ts:1016`, against `packages/server/src/auth/session-routes.ts:327`.

`init.ts` registers `{bp}/auth/config` directly and mounts the auth router afterwards,
so Hono resolves the direct registration and `session-routes.ts:327` never runs — a
fact both files now document (`builtin-auth-adapter.ts:310-314`,
`session-routes.ts:310-320`). The shadowed copy carries `defaultAuthLimiter`. The live
one carries nothing, and its handler calls `authRepository.listUsersPaginated({limit:1})`
per request (`builtin-auth-adapter.ts:302`) — an unauthenticated endpoint that issues a
`COUNT` on the users table on every hit. The predicate was correctly shared between the
two copies; the middleware was not.

**Fix direction.** Add `defaultAuthLimiter` to the `init.ts` registration, or move the
capabilities handler behind the router mount so there is one registration again.

### LOW — `GET {bp}/storage/sources` is the only storage route with no auth gate

`packages/server/src/storage/routes.ts:778`.

Every other route in the file names a `writeAuthMiddleware`/`readAuthMiddleware`;
`/sources` names none, and the wrapper router in `init.ts:1330-1351` adds only the
API-key pre-auth (a pass-through for non-`rk_` callers) and the upload body limit. An
anonymous caller learns every configured storage source key, its engine (`s3`, `gcs`,
`local`) and its label. Minor on its own; it is also the parameter that routes
`?storageId=` on the gated routes, so it hands an attacker the exact vocabulary those
routes accept.

**Fix direction.** `readAuthMiddleware` on it, matching `GET /metadata/*`.

### LOW — two route families escape the error envelope entirely

`packages/server/src/api/logs-routes.ts:110` and
`packages/server/src/api/contract-routes.ts:73` create their routers with no
`router.onError(errorHandler)`, and the wrapper routers built for them in `init.ts`
(`:1821`, `:1840`) do not add one either. No `app.onError` exists anywhere — the only
two registrations on `config.app` are the data router (`init.ts:1386`) and the
functions router (`:1660`), both on child routers.

Every other family — auth, admin users, roles, reset-password, api-keys, storage,
history, cron, backups, schema-editor — registers `errorHandler` and therefore answers
`{ error: { message, code, requestId? } }`. A throw inside `/logs` or `/meta/contract`
(e.g. `serializeCollections` on a malformed registry) falls through to Hono's default
handler and answers a bare `500 Internal Server Error` as `text/plain`, which no
client in this repo parses. The comment in `cron-routes.ts:18` — "Hono's onError does
NOT propagate from parent to child routers" — is the reason each router carries its
own; these two were missed.

**Fix direction.** Add `errorHandler` to both, and register it on `config.app` as the
backstop so a future router that forgets is still inside the contract.

### LOW — four auth routes have no rate limiter while their siblings do

`routes.ts:843` (`POST /change-password`), `routes.ts:950` (`GET /verify-email`),
`routes.ts:974` (`POST /refresh`), `session-routes.ts:419` (`POST /anonymous/link`).

`/verify-email` and `/refresh` are unauthenticated, take a secret in a query parameter
or body, and perform a repository lookup per request. The tokens themselves are
high-entropy (`generateSecureToken`, `randomBytes`), so this is not a practical
guessing surface — it is an unbounded database-hit surface on the two endpoints most
likely to be scripted, sitting beside eight siblings that all carry `strictAuthLimiter`.

**Fix direction.** `strictAuthLimiter` on `/verify-email`; a generous limiter on
`/refresh` (it is called on every page load, so the default 200/15 m is too tight —
size it against the access-token lifetime).

### INFO — `{bp}/swagger` loads Swagger UI from `unpkg.com`

`packages/server/src/init/docs.ts:44-49`. Two unpinned-by-integrity `<script>`/`<link>`
tags against a third-party CDN, injected into a page served from the API origin — the
same origin the refresh cookie is scoped to under `cookieAuth`. Non-production only,
which is where developers hold live admin sessions. Worth an SRI hash or a vendored
copy.

### INFO — `logs-routes.ts` exports a module-level Hono app and a process-global buffer

`packages/server/src/api/logs-routes.ts:75` and `:110`. Two backends initialized in one
process (the test suites do this) share one ring buffer and register the same handlers
onto one router twice. Not reachable in a deployed runtime; noted because every other
route module is a factory.

---

## Checked and clean

| checked | result |
|---|---|
| **Class 33 — every route that reads data, against the driver it reads through.** Enumerated all 14 mount points in `init.ts` and traced each handler's read. | clean. The three privileged-handle families (`authRepo`, `ApiKeyStore`, `HistoryService`/`CronScheduler`/`logBuffer`) each sit behind a gate registered before the routes. The history route — where the class was found — now runs `authorizeEntityRead` first, checking the API key's permission list *and* re-fetching the row through `c.get("driver")` so an invisible row is a 404, not a 403 (`history-routes.ts:66-87`). |
| **Hono ordering — every `use()` that gates a router, against the routes it guards.** | clean at all six sites. `applyAdminGate` is called on a *fresh* router before `.route()` in schema-editor (`1249`/`1258`), cron (`1777`/`1779`), backup (`1803`/`1805`), logs (`1823`/`1825`); the contract gate is `1855`/`1876`; the storage API-key guard is `1335`/`1351`; the functions guard is `1695`/`1720`. `admin-users-route`, `reset-password-admin`, `admin-roles-route` and `api-key-routes` each `use("/*")` at the top of the factory. |
| `{bp}/admin/backups` being mounted *after* `{bp}/admin` | clean. Hono composes both, so the adapter admin router's `createRequireAuth` runs first and `applyAdminGate` runs after — additive, not a bypass. `{bp}/admin/api-keys` is registered *before* `{bp}/admin` and terminates first, so `rejectApiKeyAuth` is not skipped. |
| the data plane's driver discipline | clean. All 20 handlers in `api-generator.ts` call `getScopedDriver`, which throws rather than falling back (`:196-200`). Every one calls `enforceApiKeyPermission` or `enforceSubcollectionApiKeyPermission` before touching the driver, and the nested variant checks the *last* segment. |
| both auth middlewares, on a presented-but-invalid token | clean and in agreement — 401 regardless of `requireAuth`, on both the builtin (`middleware.ts:366-372`) and adapter (`adapter-middleware.ts:118-121`) paths, and neither ever puts the unscoped driver in the context. |
| API keys against admin surfaces | clean. `apiKeyPreAuth` resolves `rk_` in front of the JWT gates so `admin: true` keys work as documented; `rejectApiKeyAuth` (`api-key-routes.ts:59`) refuses keys on key management, reads included. |
| idempotency store (`api/rest/idempotency.ts`) | clean. Keys are scoped to a real uid, anonymous callers are refused rather than sharing a sentinel principal (`:78-80`), the claim is one atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`, the key is released on failure, and the table is revoked from `rebase_user`. |
| storage key/bucket canonicalization | clean. Every entry point runs `canonicalKeyOrBadRequest`/`canonicalBucketOrBadRequest`, `fileTokenAuth` derives the requested path with the same canonicalizer that `/metadata` signs with, and `isPathMatch` refuses a `..` segment rather than trusting URL normalization (`middleware.ts:483-490`). |
| storage content-type handling | clean. `resolveServedContentType` is an allowlist, SVG/HTML are excluded by name and by substring, and `X-Content-Type-Options: nosniff` is set unconditionally. |
| `resolveRequireAuth` | clean — one predicate, three callers (data router, storage routes, OpenAPI `requireAuth`), fails closed with no config. |
| rate-limit key derivation | clean — `X-Real-IP` is believed only when `trustedProxyHops > 0`, otherwise the socket address via `getConnInfo`. |
| `applyAdminGate` when no credential exists | clean — mounted-but-refusing 501 with a `{error:{code,message}}` body, not an unmounted 404. |
| success-envelope consistency | inconsistent but harmless and pre-existing: data returns `{data, meta}`, storage `{success, data}`, cron `{jobs}`/`{job}`, backups `{backups,…}`, auth `{user, tokens}`. Not a security property; noted so the error-envelope finding above is not confused with it. |

---

## Open questions

1. **Is `POST /auth/anonymous` meant to be on by default at all?** Every other
   optional auth surface is opt-in (`allowUserLookup`, `magicLink`,
   `allowRegistration`). Anonymous sign-in creates a durable row in the users table
   for any caller, and nothing prunes it — 50 rows per IP per 15 minutes with no
   ceiling. If the answer is "yes, by default", the bootstrap gate has to learn about
   it; if "no", the flag is the smaller fix.

2. **Should `POST /admin/bootstrap` exist at all once `POST /auth/register`
   auto-promotes the first user?** Its own comment (`admin-users-route.ts:110-117`)
   says it only matters in the "users exist but no admin" state. That state is
   reachable in exactly two ways, and one of them — the first user being deleted — is
   blocked by the last-admin guard. Narrowing it to the service key would remove a
   whole class of composition bug.

3. **`isBootstrapCompleted` / `setBootstrapCompleted` are declared on
   `AdminUsersRouteConfig` and passed by nobody** (`builtin-auth-adapter.ts:243-250`).
   Class 21 shape — a declared extension point with no wiring. Was a persistent
   "bootstrap is done" stamp intended, and does its absence matter now that the
   earliest-user gate carries the weight?

4. **Is `{bp}/docs` load-bearing for the Studio API Explorer?** If the Explorer fetches
   it with the admin session it already holds, gating it costs nothing; if something
   anonymous consumes it, the fix is a flag rather than a gate.

5. **Nothing asserts the inventory itself.** `admin-surfaces-gate.test.ts` covers the
   four `applyAdminGate` surfaces; no test enumerates *every* registered route and
   asserts that each one either names a gate or is on an explicit public allowlist.
   That is the gate this audit would most like to leave behind — the same
   both-directions shape as `slot-render-sites.test.ts` (class 21): a new route with no
   gate fails until it is admitted to the allowlist, and a route that gains a gate
   fails until it is removed from it.
