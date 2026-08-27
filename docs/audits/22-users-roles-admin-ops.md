# Unit 22 — Users, roles and admin operations

Read-only security review, `main` @ `c678e1745`, 2026-08-09.
Scope: `packages/server/src/auth/{admin-roles-route,admin-user-ops,admin-users-route,reset-password-admin,registration-policy,rls-scope}.ts`,
the role storage/lookup in `packages/server-postgres/src/auth/services.ts`, and the
admin-UI callers (`packages/cms/src/components/UserSelector.tsx`, the studio's
"run as user" surfaces). Lens: bug class 33 (a privileged reader on a route that
never asks who is calling) and class 36 (a mechanism nothing enforces).

## Verdict

**Not clean.** The four admin routes themselves are correctly gated — every
handler except `POST /bootstrap` carries `requireAdmin`, and `/bootstrap` has a
deliberate, well-reasoned "earliest-registered user" gate. The defects are not
in who the routes let in; they are in **what "admin" means**, which is computed
four different ways in this unit, and in the fact that these routes read and
write through `AuthRepository`, which runs on the **owner connection with the
RLS GUCs cleared** (`services.ts:124`). That is class 33's exact position: the
HTTP gate is the entire access-control model for user and role management, and
it disagrees with the RLS model it stands in for.

Three consequences are individually exploitable:

1. the admin gate trusts the JWT's `roles` claim, so **demoting an admin does
   nothing for up to an hour**, and the demoted admin can re-promote themselves
   inside that window;
2. `schema-admin` is a full admin at the HTTP gate but not at the RLS gate, and
   the guard that stops `defaultRole: "admin"` compares one string where the
   privilege predicate compares two — so `AUTH_DEFAULT_ROLE=schema-admin` makes
   every public registrant an administrator;
3. the credential-column and role-column protections are keyed on a hand-written
   `auth: true`, not on the presence of a `password_hash` or `roles` column, so
   an introspected (baas) project has neither.

Counts: **3 high, 6 medium, 7 low.**

---

## HIGH

### H1. Demotion is not enforceable: the admin gate reads roles from the token, and nothing revokes a session on a role change

* `packages/server/src/auth/middleware.ts:190-193` — `requireAdmin` reads
  `user.roles` out of the Hono context.
* `packages/server/src/auth/middleware.ts:156-167` — on the admin routers the
  context user is `verifyAccessToken(token)`, i.e. the `roles` claim minted at
  login.
* `packages/server/src/auth/admin-users-route.ts:312-327` — the role write. No
  session revocation.
* Contrast `packages/server/src/auth/builtin-auth-adapter.ts:152-160` and
  `packages/server/src/auth/adapter-middleware.ts:77-90`: on `/api/data/*` and
  `/api/functions/*` the adapter re-reads roles from the repository on every
  request, so a demotion is immediate there.
* `packages/server/src/init.ts:885` — `accessExpiresIn` defaults to `"1h"`.

**What's wrong.** Two implementations of "what roles does this caller have"
(class 2). The data plane resolves them from the database per request; the admin
plane — the one that *administers roles* — trusts a claim that is up to an hour
stale. Role changes, unlike password resets (`routes.ts:826`, `routes.ts:875`),
never call `setTokensValidAfter`, and no refresh token is revoked, so nothing
shortens the window.

**Failure scenario.** Alice holds `admin`. Bob (owner) discovers she is
compromised and does `PUT /api/admin/users/alice {"roles":["viewer"]}`. Alice's
browser still holds an access token carrying `roles:["admin"]`. For the rest of
that token's life she can:

* `PUT /api/admin/users/alice {"roles":["admin"]}` — restoring herself
  permanently, with no audit record (see M2);
* `POST /api/admin/users` — create a fresh admin account;
* `POST /api/admin/users/<bob>/reset-password {"password":"…"}` — take Bob's
  account (see M3).

The same holds for a **deleted** admin: `DELETE` cascades the refresh tokens
(`ensure-tables.ts:294`) but the access token is still accepted here, whereas on
`/api/data` `getUserRoleIds` of a missing user returns `[]` and the same token is
correctly not admin.

**Fix direction.** Have the admin gate resolve roles the way the data plane
does — one predicate, read from the repository (or the adapter's
`verifyRequest`), not from the claim. Independently, make a role change bump
`setTokensValidAfter(uid)` so live sessions are invalidated, the same way the
two password paths already do.

### H2. `defaultRole` guard checks one string; the privilege predicate checks two — `AUTH_DEFAULT_ROLE=schema-admin` grants admin to every registrant

* `packages/server/src/auth/routes.ts:152-153` — `if (config.defaultRole === "admin") throw …` ("CRITICAL SECURITY ERROR … Administrative privilege escalation via registration is strictly forbidden").
* `packages/server/src/auth/middleware.ts:191-193` — `role === "admin" || role === "schema-admin"`.
* `packages/server/src/auth/builtin-auth-adapter.ts:160` and `:197` — the same two-string test.
* `packages/server/src/boot/options.ts:62-64` — `AUTH_DEFAULT_ROLE` is settable from the environment.
* `packages/server/src/auth/routes.ts:415-417`, `:640-642`, `packages/server/src/auth/session-routes.ts:382-383` — the three paths that apply it (password signup, OAuth signup, anonymous signin).

**What's wrong.** The guard and the privilege predicate are two implementations
of "is this role administrative" and they do not agree. `schema-admin` is not in
`listRoles()` (`services.ts:1125-1143`), is not documented anywhere outside
`middleware.ts` and two tests, and is not recognised by the RLS admin arm
(`rolesOverlap(["admin"])`, `auth-default-policies.ts:60-63`) — so it reads as a
narrow "may edit the schema" tier. It is not: it satisfies `requireAdmin` on
every admin surface, including the user-management routes, which write through
the RLS-bypassing repository.

**Failure scenario.** An operator sets `AUTH_DEFAULT_ROLE=schema-admin` (or a
config `defaultRole: "schema-admin"`) intending to let signups reach the schema
editor on a staging box. The startup guard is silent — it only rejects the exact
string `"admin"`. Every account created by the public registration form now
passes `requireAdmin`; the first thing any of them can do is
`PUT /api/admin/users/<self> {"roles":["admin"]}` and become a real admin, which
also clears the RLS admin arm and thus reads and writes every table.

Even without the misconfiguration, the same asymmetry is a privilege-escalation
step: **any holder of `schema-admin` can promote themselves to `admin`**, so the
two tiers the codebase distinguishes are one tier.

**Fix direction.** One exported predicate — `isAdministrativeRole(role)` — used
by `requireAdmin`, both adapter `isAdmin` computations, and the `defaultRole`
guard, so the guard cannot be narrower than the check. Then decide whether
`schema-admin` is meant to be narrower than `admin`; if it is, it must not reach
the user/role routes, and RLS must know about it.

### H3. Credential and role columns are protected by a hand-written `auth: true`, not by what the table contains — introspected projects get neither protection

* `packages/common/src/util/auth-default-policies.ts:69-72` — `isAuthCollection` is purely `collection.auth === true | {enabled:true}`.
* `packages/common/src/util/auth-default-policies.ts:118-136` — the restrictive `<table>_require_admin_write` gate (the thing whose doc comment says "Without this, a permissive owner rule would let a user change their own `roles`") is injected **only** for those collections.
* `packages/server-postgres/src/services/row-pipeline.ts:104-117` — `excludeFromApi` is enforced on the read path, and only for properties that declare it.
* `packages/common/src/collections/default-collections.ts:66-83` — the hand-written default `users` collection declares it on `passwordHash` and `emailVerificationToken`.
* `packages/server-postgres/src/schema/introspect-runtime.ts`, `introspect-db-logic.ts`, `introspect-db-inference.ts` — grep for `password`, `excludeFromApi`, `auth:` returns **nothing**. Introspection never emits either.

**What's wrong.** Both protections are properties of a *declaration*, and the
BaaS/introspected path produces no such declaration. A table called `users` with
`password_hash text` and `roles text[]`, discovered by `rebase init` or served in
baas mode, is an ordinary collection: `password_hash` is a readable property and
`roles` is a writable one, with only the developer's own RLS policies in front.

**Failure scenario.** A project introspects an existing `users` table and writes
the policy everyone writes — "a user may select and update their own row"
(`id = auth.uid()`). Because the collection is not flagged `auth`, the
restrictive admin-write gate is never injected, so `PUT /api/data/users/<self>
{"roles":["admin"]}` succeeds: the row is theirs, the permissive policy grants
the UPDATE, and no layer objects to *which column* changed. The same policy
serves `password_hash` back on the GET. This is the shape already observed live
in another project (users route returning `passwordHash`).

Baas mode does refuse tables with RLS disabled
(`introspect-runtime.ts:47-54`), which bounds the read exposure to what the
developer's policies admit — it does nothing about the write.

**Fix direction.** Derive the protection from the data as well as the
declaration: when a collection is nominated as the auth collection (or when a
column matches the auth-users column set — `auth-users-columns.ts` already knows
that set), inject the restrictive write gate and mark the credential columns
`excludeFromApi` at introspection time. Failing that, refuse to serve a
collection whose columns look like `password_hash`/`roles` without an explicit
`auth:` decision, so the silence becomes a question.

---

## MEDIUM

### M1. The bootstrap one-shot latch is declared, read, and supplied by nobody

* `packages/server/src/auth/admin-users-route.ts:34-35` — `isBootstrapCompleted?` / `setBootstrapCompleted?` on `AdminUsersRouteConfig`.
* `:79-84` — read, and a `BOOTSTRAP_COMPLETED` 403 behind it.
* `:145-147` — written after a successful bootstrap.
* `packages/server/src/auth/builtin-auth-adapter.ts:243-250` — the only production construction of this route. Passes neither.
* Repo-wide grep: the only other hits are `AuthModuleConfig.isBootstrapCompleted` (`routes.ts:62`, read at `session-routes.ts:329`), also never supplied in production, and `auth-routes.test.ts`, which constructs the router directly (class 3 — a test that bypasses the wiring).

**What's wrong.** Class 36. `POST /api/admin/bootstrap` has exactly two live
gates — "no user holds `admin`" and "the caller is the earliest-registered
user" — because the third, the permanent latch, is dead code. Both live gates
are re-enterable: they are computed from the current table on every call.

**Failure scenario.** Any state in which the users table has rows but no row
holds `admin` re-opens self-promotion to the earliest-registered account,
forever. Reaching that state is an admin action (`DELETE /api/data/users/<...>`
through the data API bypasses the route-level "cannot delete the last
administrator" check at `admin-users-route.ts:349-357`), or a restore from a
partial backup, or a migration that rewrites `roles`. The account that then
gains admin is not the operator's choice; it is whoever signed up first, which
on a public site is frequently a stranger. The same is true for the register
path (`routes.ts:401-402`): empty the table and the next registration is admin
again, even with `allowRegistration: false`.

**Fix direction.** Wire the latch (a `schema_meta` row is the obvious home,
beside `AUTH_SCHEMA_VERSION`) or delete the option. A declared-and-unread
security option is worse than no option, because a reader of
`AdminUsersRouteConfig` concludes the window closes and it does not.

### M2. No audit record for any privileged user operation

* `packages/server/src/auth/admin-users-route.ts:126-143` — the *only* `[Security Audit]` entries in this unit, both on `/bootstrap`.
* Role grant/revoke (`:326`), admin user creation (`:247`), admin user deletion (`:359`), admin password reset (`reset-password-admin.ts:72`, `:136`, `:144`) — none logged.
* Compare `routes.ts:485`, `:507`, `mfa-routes.ts:388-444`, `mfa-gate.ts:65`: the convention exists and is used for login and MFA.

**What's wrong.** The operations with the largest blast radius in the product
leave no trace. Combined with H1, a demoted admin re-promoting themselves is not
merely possible but invisible: nothing in the logs distinguishes it from Bob
changing his mind.

**Failure scenario.** After an incident, there is no way to answer "who granted
this account `admin`, and when" — the `roles` array has no history, the route
logs nothing, and `updated_at` records only that *something* changed.

**Fix direction.** `logger.info("[Security Audit] …")` with
`eventType: auth.roles.changed | auth.user.created | auth.user.deleted |
auth.password.admin_reset`, actor uid, target uid, and before/after role sets.

### M3. Admin-initiated password reset does not revoke the target's sessions, three lines from the code that gets it right

* `packages/server/src/auth/reset-password-admin.ts:63-75` — `{"password": …}` sets the hash directly via `authRepo.updatePassword`.
* `:134-138`, `:142-146` — the temp-password fallbacks do the same.
* `packages/server/src/auth/admin-users-route.ts:300-309` — `PUT /users/:uid` with a `password` does the same.
* Contrast `packages/server/src/auth/routes.ts:815-826` (self-service reset) and `:871-875` (change-password), which both call `authRepo.setTokensValidAfter(uid, new Date())` immediately after `updatePassword` — and `routes.ts:1030-1037`, the refresh handler that enforces that mark.

**What's wrong.** The class-31 pairing again: two neighbouring implementations of
"the password changed", one of which carries the revocation and one of which does
not. The admin path is the one used *during an incident*.

**Failure scenario.** A user's account is phished. The admin resets their
password from the panel. The attacker's stolen refresh token is untouched — its
`session_started_at` predates nothing, because no mark was written — so it keeps
minting fresh access tokens for the full 30-day refresh lifetime. The admin
believes the account is secured.

Secondary: the route can target **another admin** with no restriction, so a
compromised admin (or an admin-scoped API key, see L1) can set a peer admin's
password and, with email unconfigured, receive the new password in the response
body (`:159`). MFA still gates the subsequent login, which is the one thing
containing this.

**Fix direction.** Call `setTokensValidAfter` on every path in
`reset-password-admin.ts` and in the `PUT /users/:uid` password branch. Better,
move it inside `AuthRepository.updatePassword` so a caller cannot forget.

### M4. `POST /admin/bootstrap` is an unauthenticated-adjacent, unrated, unbounded fan-out

* `packages/server/src/auth/admin-users-route.ts:73` — no `requireAdmin`, by design; any authenticated caller reaches the body.
* `:86` — `await authRepo.listUsers()`, which is `db.select().from(usersTable)` with no limit (`services.ts:342-345`), pulling every column of every user (including `password_hash`) into process memory.
* `:89-95` — then one `getUserRoleIds` **query per user** until an admin is found.
* `packages/server/src/init.ts:979-981`, `:1098-1104` — `/api/admin/*` gets the API-key pre-auth and nothing else; the rate limiter (`init.ts:997-1004`) is wired to the data and functions routers only.

**What's wrong.** Class 24. A caller controls how much work happens by having
signed up. The cost is O(users) rows plus O(users) round trips, per request, with
no limiter.

**Failure scenario.** Any registered user on a 200k-user deployment loops
`POST /api/admin/bootstrap`. Each call is a full table scan of `users` plus up to
200k point queries; a handful of concurrent requests saturates the pool and takes
the API down. The endpoint answers 403 every time, so nothing looks like an
attack in the error metrics.

**Fix direction.** Ask the database the question instead of the process: a single
`SELECT 1 … WHERE 'admin' = ANY(roles) LIMIT 1` for `hasAdmin` and a
`ORDER BY created_at, id LIMIT 1` for the earliest user. Add the auth rate
limiter to the route.

### M5. `POST /auth/register` re-introduces the unbounded read the comment 30 lines above forbids

* `packages/server/src/auth/routes.ts:364-367` — "Paginated on purpose: this runs for anonymous callers, and the unbounded `listUsers()` would hand them a full-table fetch per rejected attempt."
* `packages/server/src/auth/routes.ts:401` — `const existingUsers = await authRepo.listUsers();`
* `packages/server/src/auth/routes.ts:628` — the same on the OAuth signup path.
* `packages/server/src/auth/session-routes.ts:332` — the same in `GET /auth/config` (shadowed on an `init.ts` boot, live for a standalone mount).

**What's wrong.** The reasoning was done, written down, and applied to one of the
two reads in the same handler. The accepted-registration path does the very thing
the rejected path was fixed to avoid, and it is the path an anonymous caller
reaches whenever `allowRegistration` is true.

**Failure scenario.** Open registration on a large tenant: every signup fetches
every user row (all columns, `password_hash` included) into memory to answer
"length === 1". Sign-ups are cheap to generate.

**Fix direction.** `listUsersPaginated({ limit: 2 })` answers "is this the only
user" exactly, or better `count(*) = 1`. The `listUsers()` API is a foot-gun with
one legitimate caller left; consider removing it from `AuthRepository`.

### M6. The studio's "run as user" / impersonation is not implemented anywhere on the server

* `packages/studio/src/components/ApiExplorer/TryItPanel.tsx:140-144` — sends `x-rebase-impersonate: <uid>` alongside the **admin's own** JWT.
* Repo-wide grep for `impersonate` outside that line: no server reader exists.
* `packages/studio/src/components/JSEditor/JSEditor.tsx:384-390` — when a different user is selected, it builds a client with `token = await getAuthToken()` — again the admin's token.
* `:461-468` — `context.user` is set to the selected user, so the sandbox *displays* the impersonated identity.
* `packages/app/src/components/UserSelectPopover.tsx:208-211` — the trigger renders the word **"impersonating"** in amber.

**What's wrong.** Class 36, in its purest form: a security-verification tool
whose mechanism does not exist. Every request issued from "Run as: alice"
executes with the admin's uid and roles, and therefore clears every policy the
admin clears.

**Failure scenario.** An operator writes an RLS policy, then uses the API
Explorer or the JS editor to check it: selects a low-privilege user, runs
`client.data.collection("invoices").find()`, and sees the rows they expected the
policy to permit — or, worse, runs a negative check ("alice must not see other
tenants' invoices"), sees rows, misreads it as a policy bug, and *widens* the
policy to make the test pass. The panel says "impersonating" the whole time.

**Fix direction.** Either implement it — a server-side, admin-only,
audit-logged re-scope of the request driver honouring `x-rebase-impersonate`,
which is the only way the answer means anything — or remove the selector and the
"impersonating" badge until it exists. A wrong answer here is worse than no
feature, because it is consumed as evidence.

---

## LOW

### L1. An `admin: true` API key reaches every user-management route with no permission-list check
`packages/server/src/init.ts:972-981`, `packages/server/src/auth/api-keys/api-key-middleware.ts:98-101`.
An `rk_` key with `admin: true` is given `roles: ["admin","service"]` and passes
`requireAdmin`; the key's own `permissions` list is consulted only by the REST
generator and the storage/functions guards, never by `/api/admin/users`. This is
documented behaviour (the comment at `init.ts:972` names the surfaces), so it is
recorded rather than flagged — but the practical meaning is that a leaked CI key
can create an admin account and reset the owner's password, and the key's
permission list cannot express "admin, but not user management".

### L2. `setUserRoles` builds a Postgres array literal by string concatenation
`packages/server-postgres/src/auth/services.ts:522-529` —
`` const rolesArray = `{${roleIds.join(",")}}` ``, passed as a bound parameter and
cast `::text[]`. Not injectable (it is a parameter), but the array *literal
grammar* is: `["a,b"]` stores two roles, `[" admin"]` is stored as `admin`
(unquoted elements are whitespace-trimmed), and `['x"y']` raises `22P02` as a
500. Only admins reach it today, so this is correctness rather than escalation —
but it is one caller away from being neither. Use a bound `text[]` (drizzle's
array binding, or `string_to_array` avoided entirely) rather than assembling the
literal.

### L3. `emailVerified: true` is computed and discarded on the admin-create path
`packages/server/src/auth/admin-user-ops.ts:167` sets it; the caller
(`admin-users-route.ts:247-253`) hand-lists five fields into `createUser` and
`emailVerified` is not among them, though `CreateUserData` declares it
(`interfaces.ts:37`) and the register path passes it (`routes.ts:613`). Class 20
/ class 17. Every admin-created account is unverified, so any flow gated on
`emailVerified` refuses the accounts an admin provisioned. The *other* consumer
of the same prepare function — `api-generator.ts:596-604` — forwards
`prepared.values` wholesale, so the two "create a user" paths disagree about
every column the hand-list omits (metadata custom columns, hook-produced fields).

### L4. Role CRUD in the Postgres repository is fabricated
`packages/server-postgres/src/auth/services.ts:1115-1167` — `getRoleById` and
`listRoles` synthesise rows (`listRoles` returns a hardcoded admin/editor/viewer
while `roles` is in fact a free-form `text[]`), and `createRole`, `updateRole`
and `deleteRole` persist nothing while returning a plausible object. Class 14: a
caller cannot tell success from a no-op. `GET /api/admin/roles`
(`admin-roles-route.ts:30-33`) therefore advertises three roles on a system that
may use twenty, which is what the admin UI's role picker is built from.

### L5. `isAdmin` by string comparison, in five places, with no shared predicate
`middleware.ts:191-192`, `builtin-auth-adapter.ts:160`, `:197`,
`services.ts:498`, `:1119`, plus the RLS arm `rolesOverlap(["admin"])`
(`auth-default-policies.ts:60-63`). Three of the six accept `schema-admin`
(H2), three do not. To the audit question "can a user create a role with that
name" — no: there is no role table and no create-role route that persists, so
only an admin (or `defaultRole`) can put a string into `users.roles`. The risk is
entirely in the disagreement between the copies, not in role creation.

### L6. Unreachable branch and unguarded dereference in the admin users route
`admin-users-route.ts:101` — `"uid" in user ? user.uid : ("uid" in user ? user.uid : undefined)`,
both arms identical (a leftover from the `userId` → `uid` rename; the fallback
that was meant to be there is gone).
`admin-users-route.ts:329-330` — `result!.user` after a concurrent delete is a
500 rather than a 404.
`admin-users-route.ts:172-175` — the `?ids=` branch reports
`total: users.length` and `limit: ids.length`, so a caller paginating on `meta`
is told about the resolved subset rather than the request (the same shape as the
history-pagination finding in the 2026-08-07 sweep).

### L7. `UserSelector` 403s for every non-admin, and its comment about the alternative is stale
`packages/cms/src/components/UserSelector.tsx:71-78` fetches
`${apiBase}/admin/users`, which is `requireAdmin`. For an editor-role user the
response is 403, the `catch` at `:101-103` sets `hasMore=false`, and the picker
renders "No users found." — indistinguishable from an empty system, on a field
they are expected to fill. The comment beside it says the collection route
"serves the raw row, `passwordHash` included"; for the declared `users`
collection that is not true (`row-pipeline.ts:104-117` strips it, and
`default-collections.ts:70` declares it), and repeating it discourages the fix.
It *is* true for an introspected users table — see H3 — so the sentence is right
about the wrong reason.

---

## Answers to the posed questions

**Every route that can change a user's roles.**

| route | gate | enforced where | can a non-admin self-grant? |
|---|---|---|---|
| `POST /api/admin/users` (`admin-users-route.ts:227`, `:255-257`) | `requireAdmin` | route | no — but see H1/H2 for who counts as admin |
| `PUT /api/admin/users/:uid` (`:286`, `:312-327`) | `requireAdmin` | route | no — same caveats; this is the route H1 and H2 escalate through |
| `POST /api/admin/bootstrap` (`:73`, `:139`) | `requireAuth` + "no admin exists" + "caller is earliest user" | route | only in the no-admin state (M1) |
| `POST /auth/register` (`routes.ts:413-417`) | anonymous | route | only as the first user in an empty table |
| OAuth signup (`routes.ts:638-642`) | anonymous | route | same |
| anonymous signin (`session-routes.ts:382-383`) | anonymous | route | only via `defaultRole` (H2) |
| `POST|PUT /api/data/<auth collection>` | RLS restrictive `_require_admin_write` | database | no, **if** the collection is declared `auth: true` (H3) |

All of them are checked on the route or in RLS, none in the UI only. There is no
UI-only gate in this unit.

**Can a user set a role column through the generic data API?** On a declared
`auth: true` collection, no: the injected restrictive policy AND-s an
admin-or-server condition onto every INSERT/UPDATE/DELETE, so a permissive
"owner may edit own row" rule cannot reach it — and the protection is
column-blind by design, which is the right call. On an introspected/baas users
table, **yes** — see H3. The protection is on the `auth` flag, never on the
`roles` column itself.

**The bootstrap exception.** Two distinct mechanisms.
`POST /auth/register` / OAuth signup: strictly "the table contains exactly one
row and it is mine" (`routes.ts:401-402`, `:628-629`) — re-enterable by emptying
the table, which the admin routes prevent (`:339-341`, `:349-357`) but the data
API does not. `POST /admin/bootstrap`: **not** "table is empty" — it is "no user
holds `admin`" plus "you are the earliest-registered user", re-entered whenever
that state recurs, with the intended one-shot latch dead (M1). One further gap:
the "earliest" reduce at `admin-users-route.ts:118-124` compares
`new Date(createdAt).getTime()`, which is `NaN` for a null `created_at`; because
every comparison with `NaN` is false while `at !== bt` is *true*, the reduce
returns `b` on any NaN pair, so a single row with a null timestamp makes the
winner depend on the (unordered) row order of `listUsers()`. No test covers it
(`packages/server/test/admin-bootstrap.test.ts:44-99` covers the three happy
paths and the id tie-break).

**Admin-initiated password reset.** Requires `requireAdmin` only. Not audit
logged (M2). Can target another admin, with no self/peer restriction. Does not
revoke the target's sessions (M3). Returns the new password in the response body
when no email service is configured (`reset-password-admin.ts:159`). MFA on the
target account still applies at their next login, and there is no admin route
that unenrolls another user's factor — `DELETE /auth/mfa/unenroll` requires the
caller's *own* `aal2` — so an admin-set password alone does not defeat a second
factor.

**Impersonation.** Not implemented (M6). The header exists on the client only.

**Does listing users leak hidden fields?** No, on the admin routes:
`toAdminUser` (`admin-users-route.ts:47-68`) is a whitelist of eight fields and
never touches `passwordHash`, metadata or verification tokens, on all three read
paths (`?ids=`, list, by-uid). `excludeFromApi` is genuinely enforced on the
collection read path (`row-pipeline.ts:104-117`), including relation targets. The
exposure is at H3 — introspected tables that never declare it.

**Is `isAdmin` a string comparison, and can a user create such a role?** Yes to
the first (L5, and H2 for the consequence). No to the second: roles are strings
in `users.roles`, writable only by an admin, the server context, or
`defaultRole`; the role "table" is synthetic (L4), so there is nothing for a user
to create.

---

## Checked and clean

| checked | result |
|---|---|
| every handler in the three admin routers, against its gate | clean — `requireAdmin` on all of `GET /roles`, `GET/POST/PUT/DELETE /users`, `GET /users/:uid`, `POST /users/:uid/reset-password`; `router.use("/*", createRequireAuth)` is registered **before** the routes, so Hono runs it (the ordering trap `applyAdminGate` documents) |
| `POST /bootstrap`'s land-grab gate | clean in intent and covered by tests — earliest `createdAt`, ties broken by id, denied with a `[Security Audit]` warn. The NaN edge is called out above |
| last-admin protection | clean — both `PUT` (`:317-325`) and `DELETE` (`:348-357`) refuse to remove the final `admin`, and `DELETE` refuses self-deletion (`:339-341`) |
| `listUsersPaginated` SQL assembly | clean — `roleId` and the search pattern are bound parameters; `orderBy` is resolved through `getColumn` so only a real column name reaches `sql.raw`; the table name is config; `escapeLikePattern` is the shared helper, so no wildcard or ReDoS ingress (`services.ts:355-398`) |
| `GET /users` limit handling | clean — `resolveListLimitParam` refuses rather than clamps, and `?ids=` is capped at `MAX_USER_IDS_PER_LOOKUP` after de-duplication |
| `rls-scope.ts` | clean, and the reference for fail-closed — `scopeDataDriver` re-throws rather than falling back, and `SERVICE_IDENTITY`'s docblock is accurate about `dataAsAdmin` not being an RLS bypass |
| `registration-policy.ts` | clean — one predicate, both advertisers and the enforcer read it, and the `disableSelfRegistration` kill switch precedes the empty-table exception |
| `generateSecurePassword` / `generateSecureToken` / `hashToken` | clean — `randomInt`/`randomBytes`, a Fisher–Yates shuffle over `randomInt(i+1)`, 320-bit tokens, SHA-256 at rest, and reset tokens are stored hashed with a 1h (self) / 24h (invitation) expiry |
| the invitation vs. reset template split | clean — `finalizeAdminUserCreation` uses `userInvitation`, `reset-password-admin` keeps `passwordReset`; the 2026-08-07 finding is fixed and the reasoning is written down at `admin-user-ops.ts:213-225` |
| `deleteUser` and credential cascade | clean — `refresh_tokens.uid` and `password_reset_tokens.uid` are `REFERENCES … ON DELETE CASCADE` (`ensure-tables.ts:294`, `:323`) |
| MFA interaction | clean — `assertMfaSatisfied` gates session issuance, refresh carries `aal` forward from the token row, and no admin route can unenrol another user's factor |
| email normalization on the admin routes | clean — `normalizeEmail` on create (`:234`, and again inside `prepareAdminUserValues`) and on update (`:297`) |
| `withServerContext` | correct for its purpose — clears `app.uid`/`app.user_roles` inside the transaction so `policy.serverContext()` matches, and `set_config(..., true)` is `LOCAL`, so a pooled connection cannot carry it into the next request |

---

## Open questions

1. **Is `schema-admin` meant to exist?** It appears in `middleware.ts`, twice in
   `builtin-auth-adapter.ts`, and in two tests — nowhere in the docs, the role
   list, the RLS model, or the admin UI. If it is vestigial, deleting the two
   comparisons closes H2's amplification outright. If it is intended as a
   narrower tier, it currently isn't one.
2. **Should the admin gate resolve roles per request?** Doing so costs one query
   per admin request and closes H1, but it changes the failure mode when the
   database is unreachable — `verifyRequest` currently *falls back to the token's
   roles* on a repository error (`builtin-auth-adapter.ts:154-158`), which is the
   same stale-claim trust one layer down. Worth deciding both together.
3. **What does baas mode owe a users table it did not declare?** H3 assumes the
   answer is "the same protections a declared one gets". The alternative — refuse
   to serve a table whose columns look like credentials until the developer says
   otherwise — is louder and probably safer, but it breaks existing introspected
   projects on upgrade.
4. **`AuthRepository` is entirely privileged.** Every method reads or writes
   through the owner connection. That is correct for the auth flows, but it means
   any future route that touches `authRepo` is class 33 by default. Is a
   request-scoped variant worth having, so that "read a user" through an HTTP
   route is RLS-bound unless a caller opts out explicitly?
5. **UNCONFIRMED:** whether a `roles` column renamed via `columnName` breaks the
   last-admin guard. `listUsersPaginated` hardcodes `.roles`
   (`services.ts:369`, `:385`) while the rest of the service resolves column
   names through `getColumn`. Not reproduced — it needs a custom users table to
   confirm.
6. **UNCONFIRMED:** whether `GET /auth/config`'s unbounded `listUsers()`
   (`session-routes.ts:332`) is reachable in any shipped configuration. It is
   shadowed by the direct registration in `init.ts:1016`, and the docblock says
   so, but "standalone mounts" are named as a supported case.
