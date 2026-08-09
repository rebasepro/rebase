# Unit 25 — Adapter-based and custom auth

Read-only security audit, 2026-08-09, against `main` @ `c678e1745`.

Files read: `packages/server/src/auth/custom-auth-adapter.ts`,
`builtin-auth-adapter.ts`, `adapter-middleware.ts`, `auth-hooks.ts`,
`collection-callback-warning.ts`, `interfaces.ts`, `middleware.ts`,
`require-auth.ts`, `rls-scope.ts`, `bearer-token.ts`, `crypto-utils.ts`,
`jwt.ts`, `routes.ts`, `session-routes.ts`, `magic-link-routes.ts`,
`mfa-routes.ts`, `mfa-gate.ts`, `admin-users-route.ts`, `admin-user-ops.ts`,
`reset-password-admin.ts`, `api-keys/api-key-middleware.ts`;
`packages/server/src/init.ts`, `api/rest/api-generator.ts`;
`packages/server-postgres/src/websocket.ts`, `PostgresBackendDriver.ts`,
`PostgresBootstrapper.ts`, `security/rls-enforcement.ts`,
`schema/rls-bootstrap-sql.ts`, `auth/services.ts`;
`packages/types/src/types/auth_adapter.ts`, `types/entity_callbacks.ts`;
`packages/server/test/custom-auth-adapter.test.ts`,
`auth-collection-callback-warning.test.ts`;
`website/src/content/docs/docs/backend/authentication.md`.

## Verdict

The two request-verification middlewares now agree. The regression this unit was
opened for — the adapter path downgrading a presented-but-unverifiable token to
anonymous where `createAuthMiddleware` 401s — is fixed at
`adapter-middleware.ts:118`, with a comment that names the failure, and the
adapter path is fail-closed on all three of its edge cases (throw → 401, null +
presented token → 401, RLS scoping failure → 500). Token verification, RLS
scoping and `requireAuth` resolution reach the same answer on both paths.

The damage is not in the middleware; it is in **`AuthHooks`**, which is where the
adapter architecture pushed every behaviour that used to live in a collection
callback. `collection-callback-warning.ts` tells a developer at boot that
`beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` will not fire for auth
writes and to use `afterUserCreate`, `beforeUserCreate`, `afterUserDelete`
instead. The published docs
(`website/src/content/docs/docs/backend/authentication.md:67-75`) repeat that
advice and name the three paths it covers: *registration, admin user management,
and OAuth*. Measured against the code, the advice is wrong on two of the three:

| the caution says | `beforeUserCreate` | `afterUserCreate` | `afterUserDelete` |
|---|---|---|---|
| registration | fires | fires | n/a |
| OAuth | **skipped** | fires | n/a |
| admin user management | **skipped** | **skipped** | **never fires anywhere** |

`beforeUserDelete` and `afterUserDelete` have exactly one call site each —
`builtin-auth-adapter.ts:408` and `:415`, inside
`UserManagementAdapter.deleteUser`, which **no route in the server invokes**.
`DELETE /admin/users/:uid` calls `authRepo.deleteUser` directly
(`admin-users-route.ts:359`). So the hook documented as *"Throw an error to
prevent deletion"* cannot prevent anything, and the deprovisioning hook that a
GDPR-erasure or external-resource-cleanup implementation would hang off is
silent. This is class 5 (remediation text nobody tested) sitting on top of class
21 (a declared extension point nothing reads) — the two-step is what makes it
dangerous: the developer was warned, followed the warning, and is now worse off
than if there had been no warning, because they believe the gap is covered.

The custom-adapter surface has the same shape one layer up. Three of the five
things `CustomAuthAdapterOptions` accepts do nothing:
`transformAuthResponse` is read by no code path (`custom-auth-adapter.ts:83`
stores it; the only reader in the server is the identically-named `AuthHooks`
member, which is builtin-only); `userManagement` is exposed on the return value
and consumed by nothing; and `serviceKey` — whose docblock says requests bearing
it *"bypass normal token verification and are granted admin-level access"* —
authenticates on `/admin/*` but is refused with 401 on `/api/data` and
`/api/functions`, because those routers get the adapter and the adapter never
checks it. `custom-auth-adapter.test.ts` has a test for each of the three, and
each asserts only that the property was copied onto the returned object.

Finally, one clean instance of class 29 in the data plane: the auth-collection
create route skips **all** write validation when the adapter does not implement
`describeUserCreationContract` (`api-generator.ts:584-594`), which is every
deployment that is not on the builtin adapter.

**Severity counts: 0 critical, 3 high, 5 medium, 6 low.**

---

## Every hook in `AuthHooks`, and where it fires

Paths are the HTTP surfaces a real deployment exposes. "unreachable" means the
call site exists but no route reaches it.

| hook | fires on | skipped on |
|---|---|---|
| `hashPassword` | `/auth/register` (`routes.ts:387`), `/auth/reset-password` (`:814`), `/auth/change-password` (`:870`), `/auth/anonymous/link` (`session-routes.ts:445`), `POST /admin/users` + auth-collection REST create (`admin-user-ops.ts:160`), `PUT /admin/users/:uid` (`admin-users-route.ts:305`), admin reset (`reset-password-admin.ts:71,135,143`), `userManagement.createUser/updateUser` (`builtin-auth-adapter.ts:371,400`, unreachable) | no password-storing path misses it |
| `verifyPassword` | `/auth/login` (`routes.ts:483`), `/auth/change-password` old-password check (`:858`) | replaced wholesale at login when `verifyCredentials` is set |
| `validatePasswordStrength` | register (`routes.ts:375`), reset (`:800`), change (`:864`), anonymous-link (`session-routes.ts:433`), admin reset (`reset-password-admin.ts:65`), `PUT /admin/users/:uid` (`admin-users-route.ts:301`) | **`POST /admin/users` and auth-collection REST create** — `prepareAdminUserValues` hashes `body.password` unchecked (`admin-user-ops.ts:158-160`); `userManagement.createUser/updateUser` (unreachable) |
| `verifyCredentials` | `/auth/login` (`routes.ts:466`) | everything else, by design |
| `onAuthenticated` | register (`routes.ts:440`), login (`:501`), anonymous (`session-routes.ts:402`), magic-link (`magic-link-routes.ts:159`) | **OAuth sign-in and sign-up** (`routes.ts:657`), **refresh** (`:1097`), **password reset** (`:828`), **MFA challenge verify** (`mfa-routes.ts:427`), **anonymous-link** (`session-routes.ts:459`) — the docblock claims OAuth, refresh and password-reset; `AuthMethod` declares `"oauth" \| "refresh" \| "password-reset" \| "mfa"`, none of which is ever passed |
| `beforeUserCreate` | `/auth/register` (`routes.ts:393`), `/auth/anonymous` (`session-routes.ts:375`), `userManagement.createUser` (`builtin-auth-adapter.ts:379`, unreachable) | **OAuth sign-up** (`routes.ts:609`), **`POST /admin/users`** (`admin-users-route.ts:247`), **auth-collection REST create** (`api-generator.ts:596`) — docblock says "registration or admin creation" |
| `afterUserCreate` | register (`routes.ts:431`), OAuth sign-up (`:619`), anonymous (`session-routes.ts:393`), `userManagement.createUser` (unreachable) | **`POST /admin/users`**, **auth-collection REST create** |
| `beforeLogin` | login (`routes.ts:460`), magic-link request (`magic-link-routes.ts:79`) | OAuth, refresh, anonymous, MFA challenge verify |
| `afterLogout` | `POST /auth/logout` **only when** an `Authorization: Bearer` access token is present *and still verifies* (`session-routes.ts:97-104`) | cookie-mode logout with no bearer header; logout with an already-expired access token (the ordinary case); `DELETE /auth/sessions` and `DELETE /auth/sessions/:id`; admin-side revocation |
| `onMfaVerified` | `POST /auth/mfa/challenge/verify` (`mfa-routes.ts:436`) | `POST /auth/mfa/verify` (enrolment verification, `:277`) |
| `customizeAccessToken` | every sign-in, via the single mint helper (`routes.ts:313`); refresh (`:1090`) | nothing — the only two `generateAccessToken` call sites are both covered |
| `transformAuthResponse` (the `AuthHooks` one) | register, login, oauth, refresh, anonymous ×2, mfa, magic-link — all 8 sign-in surfaces | nothing. Contrast the identically-named `AuthAdapter`/`CustomAuthAdapterOptions` member, which fires nowhere (**L1**) |
| `onPasswordReset` | `/auth/reset-password` token flow (`routes.ts:829`) | `/auth/change-password`; admin reset (`reset-password-admin.ts`); `PUT /admin/users/:uid` with a `password` |
| `beforeUserDelete` | `userManagement.deleteUser` (`builtin-auth-adapter.ts:408`) — **unreachable** | **every reachable path**: `DELETE /admin/users/:uid` (`admin-users-route.ts:359`), auth-collection REST delete, bulk delete, the registration-race undo (`routes.ts:634`) |
| `afterUserDelete` | `userManagement.deleteUser` (`:415`) — **unreachable** | **every reachable path** |
| `onAdminCreateUser` | `POST /admin/users` and auth-collection REST create, via `prepareAdminUserValues` (`admin-user-ops.ts:142`) | self-registration, OAuth sign-up, anonymous |
| `onAdminResetPassword` | `POST /admin/users/:uid/reset-password` (`reset-password-admin.ts:92`) | self-service `/auth/forgot-password` → `/auth/reset-password` |

Collection-level `auth.onCreateUser` (`AuthCollectionConfig`) is consulted only
by `prepareAdminUserValues` (`admin-user-ops.ts:130`), i.e. only via the builtin
adapter — see **L3**.

---

## HIGH

### H1. `beforeUserCreate` — the only reject/mutate gate on user creation — is skipped on OAuth sign-up and on both admin creation paths

`packages/server/src/auth/routes.ts:609`,
`packages/server/src/auth/admin-users-route.ts:247`,
`packages/server/src/auth/admin-user-ops.ts:157-176`.

The hook is documented as *"Called before a new user is created (registration or
admin creation). Return modified data to alter what gets stored, or throw an
error to reject the creation entirely."* (`auth-hooks.ts:124-132`). It fires on
`/auth/register` and `/auth/anonymous` and nowhere else that creates a user.

OAuth sign-up calls `authRepo.createUser` directly at `routes.ts:609` and then
fires `afterUserCreate` at `:619` — the *after* half of the pair is present in
that exact block, which is what makes the missing *before* half read as an
oversight rather than a decision.

**Failure scenario.** A tenant-scoped app implements the "reject signups from
disposable-email domains" / "reject anyone not on the corporate allowlist" rule
as a `beforeUserCreate` that throws. It is tested with `/auth/register` and
passes. A `google` or `github` button on the same login page creates the account
regardless — and OAuth accounts land with `emailVerified: true` (`routes.ts:613`)
and are auto-linked, so the account is a *stronger* one than the path the gate
protects. The same rule is bypassed again by `POST /admin/users`, which is what
the admin panel calls.

**Fix direction.** Route every creation through one helper that fires the pair.
The natural home is `prepareAdminUserValues` for the two admin paths and a small
`createUserWithHooks(repo, data, ops)` for `routes.ts:609`. Then pin it by
enumerating the *creations* rather than the hook: a test that asserts every
`authRepo.createUser` call in the server is preceded by `beforeUserCreate` —
class 17's second axis, call sites rather than fields.

### H2. `beforeUserDelete` and `afterUserDelete` fire on no reachable path

`packages/server/src/auth/builtin-auth-adapter.ts:406-420` (the only call sites);
`packages/server/src/auth/admin-users-route.ts:359` (the live delete).

`UserManagementAdapter` is assigned at `builtin-auth-adapter.ts:209`, threaded to
`authConfigResult.userService` at `init.ts:840`, and read by exactly one line —
`init.ts:1059`, which uses it as a *fallback for the auth repository*, not as a
user-management surface. Nothing calls `userManagement.deleteUser`. `grep -rn
"userManagement" packages/server/src` returns three hits, all of them
definitions or the assignment.

**Failure scenario.** `beforeUserDelete` is documented as a veto: *"Throw an
error to prevent deletion (e.g. for users with active subscriptions, pending
transactions)."* A billing integration implements it, an admin deletes a user
with an open subscription, and the row goes. `afterUserDelete` is the
deprovisioning hook — revoke the external IdP account, delete the S3 prefix,
notify the CRM — and it is the half of a GDPR erasure that touches everything
outside Postgres. Neither runs, and nothing logs that they did not.

**Fix direction.** Fire both around `authRepo.deleteUser` in
`admin-users-route.ts:359`, and around the auth-collection REST delete in
`api-generator.ts`. Note the registration-race undo at `routes.ts:634` deletes a
user too and should probably *not* fire them (it is compensating for a write that
never became a user) — decide that explicitly rather than by omission. Gate it
the way H1 should be gated: enumerate the `deleteUser` call sites, not the hook.

### H3. Auth-collection writes lose all field and value validation when the adapter has no `describeUserCreationContract`

`packages/server/src/api/rest/api-generator.ts:580-594`.

```ts
if (!isAuthCollection) {
    assertKnownWriteFields(body, resolvedCollection);
    assertWriteValuesValid(body, resolvedCollection);
} else {
    const contract = this.authAdapter?.describeUserCreationContract?.(collectionAuthConfig);
    if (contract?.validate) { … }
}
```

This is class 29 in its textbook form. The primary branch (builtin adapter)
returns `{ validate: true, extraFields: ["password"] }`
(`builtin-auth-adapter.ts:285`) and gets both checks. Every other branch —
`createCustomAuthAdapter` (which does not implement the method), a hand-rolled
`AuthAdapter`, or a collection marked `auth: true` on a backend with no auth
configured at all (`this.authAdapter` is then `undefined`) — evaluates
`contract?.validate` to `undefined` and **runs neither check**. The comment
directly above (`:573-579`) records that this total skip was a bug that was
already fixed once; the fix reached the builtin adapter only.

The docblock on the type says so plainly — *"If not implemented, validation is
skipped — the pre-existing behaviour"* (`auth_adapter.ts:464`) — which makes it a
documented default, not an accident. It is still the wrong default: the safe
fallback for "the adapter does not describe its contract" is the ordinary
collection contract, not no contract.

**Failure scenario.** On a custom-adapter backend, `POST /api/data/users` accepts
any key. `assertWriteValuesValid` is what enforces declared `validation` (min
length, enum membership, required) — none of it applies to the users collection.
And because `prepareUserCreation` is also absent on a custom adapter, the request
falls through to the ordinary create path at `:639`, so a `password` field in the
body is handed to `driver.save` verbatim: on a users table that declares a
`password` column it is stored in cleartext, and on one that does not it is
silently dropped and the route answers 201 — the exact "typo answered 201"
failure the comment above says was fixed.

**Fix direction.** Invert the default:

```ts
const contract = this.authAdapter?.describeUserCreationContract?.(collectionAuthConfig)
    ?? { validate: true, extraFields: [] };
```

An adapter that needs the exemption asks for it. Separately, refuse the write
when `isAuthCollection && !this.authAdapter?.prepareUserCreation` and the body
carries a `password` — silently storing or dropping a credential is worse than a
400.

---

## MEDIUM

### M1. `onAuthenticated` misses OAuth, refresh, password-reset and MFA — the four events an audit log most wants

`packages/server/src/auth/routes.ts:657` (oauth), `:1097` (refresh), `:828`
(password reset), `packages/server/src/auth/mfa-routes.ts:427` (mfa verify).

The docblock is explicit: *"Called after any successful authentication event
(login, register, OAuth, token refresh, password reset)"* (`auth-hooks.ts:113-122`).
Three of the five it names never call it. `AuthMethod` (`auth-hooks.ts:53`)
declares eight values; four — `"oauth"`, `"refresh"`, `"password-reset"`,
`"mfa"` — are never produced by any caller. Compare `transformAuthResponse`,
which is wired at all eight sign-in surfaces: the mechanism for reaching every
flow exists in the same file, and this hook did not use it.

**Failure scenario.** "Log every sign-in for SOC2" / "email the user on a login
from a new device" is implemented in `onAuthenticated`, verified against the
password form, and shipped. Every OAuth sign-in and every MFA-completed sign-in
is invisible to it. A password reset — the single most security-relevant
authentication event, because it is how an account takeover completes — is
invisible to it.

**Fix direction.** Fire it from `createSessionAndTokens` (`routes.ts:298`), which
already every sign-in route funnels through and which the MFA docblock at
`mfa-gate.ts:1-14` explains was chosen for exactly this "a new route inherits it
by construction" property. Pass the method in as an argument. Refresh and
password-reset need their own call, since neither goes through it.

### M2. The custom-adapter service key: documented as admin-granting, honoured on one surface of three, unvalidated, and the internal fallback is written to a field nothing reads

`packages/types/src/types/auth_adapter.ts:490-495` (the claim);
`packages/server/src/auth/custom-auth-adapter.ts:75`;
`packages/server/src/init.ts:829, 891-900, 956-958, 1450-1456, 1676-1682`.

Four separate defects around one field:

1. **The documented behaviour does not exist.** *"When set, requests with
   `Authorization: Bearer <serviceKey>` bypass normal token verification and are
   granted admin-level access."* `createCustomAuthAdapter` copies `serviceKey`
   onto the returned object but its `verifyRequest` is `options.verifyRequest`
   unmodified — no service-key branch. Only the *builtin* adapter checks it
   (`builtin-auth-adapter.ts:136`).
2. **`createAdapterAuthMiddleware` takes no `serviceKey` option at all.** The
   non-adapter branch passes `serviceKey: internalServiceKey`
   (`init.ts:1462, 1687`); the adapter branch (`:1450, 1676`) does not. So on a
   custom-adapter backend the key is refused with 401 on `/api/data/*` and
   `/api/functions/*`, while `createRequireAuth({ serviceKey })` accepts it on
   `/admin/*` (`:1157`). One credential, two answers.
3. **The compensating assignment is inert.** `init.ts:956-958` sets
   `authAdapter.serviceKey = internalServiceKey`, with a comment saying this
   makes *"the adapter and the websocket auth path recognize the singleton's
   control-plane requests"*. `grep` for reads of `adapter.serviceKey` across the
   server returns one hit — `init.ts:829`, which runs 127 lines *earlier*. The
   websocket's service-key branch is `else if (…)` behind `if (authAdapter)`
   (`websocket.ts:235`), so it is unreachable whenever an adapter exists. This is
   class 14: a field written and never read back. Its practical cost is that
   `rebase.functions.*` from server code (the in-process client built at
   `init.ts:1504` with `token: internalServiceKey`) 401s on every
   custom-adapter deployment.
4. **The ≥32-character guard is skipped on the adapter branch.** `init.ts:891-897`
   throws for a short `serviceKey`, but it sits inside the `else` (non-adapter)
   arm; the adapter arm at `:829` takes `authAdapter.serviceKey` unexamined. A
   four-character key passed to `createCustomAuthAdapter` becomes
   `internalServiceKey` and grants `uid: "service", roles: ["admin"]` on every
   admin surface via `createRequireAuth`. `safeCompare` is constant-time but
   cannot help against a guessable secret.

**Fix direction.** Move the length check above the `isAuthAdapter` branch so both
paths validate. Give `createAdapterAuthMiddleware` a `serviceKey` option and pass
`internalServiceKey` at both mount sites, checking it with `safeCompare` *before*
delegating to the adapter — that makes the trusted plane work uniformly and makes
the docblock true. Then delete the `authAdapter.serviceKey = …` assignment, or
make the WS branch read it unconditionally.

### M3. Adapter-supplied roles are unvalidated and are flattened into a comma-delimited GUC

`packages/server/src/auth/adapter-middleware.ts:86-95`;
`packages/server-postgres/src/security/rls-enforcement.ts:296-310`;
`packages/server-postgres/src/schema/rls-bootstrap-sql.ts:69-71`.

Nothing between `adapter.verifyRequest()` and the database inspects the returned
object. `roles` is passed straight into `c.set("user", …)` and `scopeDataDriver`,
and `applyAuthContext` writes `normalizedRoles.join(",")` into `app.user_roles`.
`rebase.roles()` returns that string, and every generated policy reads it as
`string_to_array(rebase.roles(), ',') && ARRAY['admin']`
(`packages/common/src/util/auth-default-policies.ts:54`).

The separator is therefore in-band and unescaped. A single role whose name
contains a comma splits into two roles inside the policy. `roles:
["team-a,admin"]` — one role the platform has never heard of — satisfies every
`admin` policy in the database.

**Reachability is UNCONFIRMED and depends on the adapter.** A custom
`verifyRequest` that maps roles from a claim the user cannot influence is safe.
One that maps external IdP group names — Azure AD display names, Auth0
organisation names, Keycloak groups, any directory where a comma in a group name
is legal — is not, and that is the normal reason to write a custom adapter. The
builtin path is safer only because role ids come from the `roles` table.

**Fix direction.** Validate at the boundary the platform owns, not in each
adapter: reject (or drop, and log) any role containing `,` in
`applyAuthContext`, and reject a non-array `roles` or non-string `uid` in
`createAdapterAuthMiddleware` with a 401. Better still, stop using a delimited
string — `set_config` can carry a JSON array and `rebase.roles()` can return
`text[]`, which removes the class rather than the instance. Note the same GUC is
built by `backup/pg-tools.ts:211` and would need the same treatment.

### M4. `isAdmin` is authoritative on the websocket and discarded on HTTP

`packages/server/src/auth/adapter-middleware.ts:86-90` vs
`packages/server-postgres/src/websocket.ts:113-119, 225-231`.

`AuthenticatedUser` carries both `roles: string[]` and `isAdmin: boolean`
(`auth_adapter.ts:54-57`). The HTTP adapter middleware copies `uid`, `email` and
`roles` into the context and drops `isAdmin`; `requireAdmin`
(`middleware.ts:190-193`) then decides admin-ness from `roles` alone. The
websocket copies `isAdmin` through (`websocket.ts:229`) and `isAdminSession`
checks it *first*, before falling back to roles (`:116`).

Two implementations of one predicate — class 2. For the builtin adapter they
agree, because it derives `isAdmin` from the same roles array
(`builtin-auth-adapter.ts:160`). For a custom adapter they diverge in both
directions: `{ isAdmin: true, roles: [] }` is an admin on the socket and not on
HTTP; `{ isAdmin: false, roles: ["admin"] }` is an admin on both, the `isAdmin`
field having no effect. A developer reading `AuthenticatedUser` cannot tell which
field is load-bearing, and the answer is "it depends which transport".

**Fix direction.** One predicate, in one place: `isAdminUser(user)` that reads
both fields the same way, imported by `requireAdmin` and `isAdminSession`. Note
`builtin-auth-adapter.ts:160` also counts `schema-admin` as admin, which
`isAdminSession`'s roles fallback does not — a third spelling of the same rule.

### M5. Admin surfaces verify JWTs directly and ignore the adapter — on an adapter backend they 500

`packages/server/src/init.ts:1157, 1858`;
`packages/server/src/auth/middleware.ts:129-169`;
`packages/server/src/auth/jwt.ts:183-186`.

`applyAdminGate` gates cron, backups, logs and the schema editor with
`createRequireAuth({ serviceKey: internalServiceKey })`, which checks the service
key and then calls `verifyAccessToken(token)` — the framework's own JWT
verifier. The adapter is not consulted. On a custom-adapter deployment
`configureJwt` is never called (`init.ts:882-888` is inside the non-adapter arm,
and it is the only call site in the workspace), so `verifyAccessToken` throws
`"JWT secret not configured"` (`jwt.ts:185`) rather than returning `null`.

`optionalAuth` (`middleware.ts:228`) and `extractUserFromToken` (`:245`) both
guard this call with `isJwtConfigured()`; `requireAuth` (`:104`) and
`createRequireAuth` (`:156`) do not. Two of four call sites remember.

**Failure scenario.** Fail-closed, so not an exposure — but a legitimate Clerk/
Auth0 admin presenting a valid adapter token gets a 500 with an internal message
instead of a 401 or 403, and the surfaces are reachable only by an admin `rk_`
API key (via `apiKeyPreAuth`, which short-circuits at `middleware.ts:135`) or by
a `REBASE_SERVICE_KEY` — and when none is configured that key is a per-boot
random string nobody can know (`init.ts:948`). So on an adapter backend without
a configured service key and without API keys, the admin surfaces are gated
against everyone, and say so with a 500.

**Fix direction.** Have `applyAdminGate` use the adapter when one exists — an
adapter-aware `createRequireAuth` that calls `adapter.verifyRequest` after the
service-key check, then `requireAdmin` on the resulting roles. At minimum, guard
the `verifyAccessToken` calls in `requireAuth`/`createRequireAuth` with
`isJwtConfigured()` so the answer is 401 rather than 500.

---

## LOW

### L1. `AuthAdapter.transformAuthResponse` and `CustomAuthAdapterOptions.transformAuthResponse` are read by nothing

`packages/server/src/auth/custom-auth-adapter.ts:83`;
`packages/types/src/types/auth_adapter.ts:504-519, 556-565`.

Declared on the adapter interface, accepted by the factory, documented with use
cases ("inject tokens from external auth systems"), and never called. The only
consumer of a `transformAuthResponse` anywhere in the server is
`routes.ts:179`, which reads `ops.transformAuthResponse` — the `AuthHooks`
member, resolved from `RebaseAuthConfig.hooks`, reachable only on the builtin
path. A custom adapter has no `hooks` channel at all, so for the deployments this
option exists to serve it is unreachable by construction. Class 21.

`custom-auth-adapter.test.ts:186` ("passes through transformAuthResponse when
provided") asserts `adapter.transformAuthResponse` is the function that was
passed in. It cannot fail on a build where nothing calls it — the same shape as
the CVE-labelled tests in bug-class 8. The neighbouring `serviceKey` (`:152`) and
`userManagement` (`:160`) tests have the identical problem, and both of those
fields are also effectively dead (M2, H2).

**Fix direction.** Either call it — the natural place is
`createAdapterAuthMiddleware`, or wherever an adapter's own routes build a
response — or name it in a "declared but unimplemented" constant and warn when an
adapter sets it, the pattern `slot-render-sites.test.ts` uses. Do not leave it
advertised.

### L2. The boot warning covers four of six declared collection callbacks, and does not run on the adapter path

`packages/server/src/auth/collection-callback-warning.ts:4`;
`packages/server/src/init.ts:877`;
`packages/types/src/types/entity_callbacks.ts:29-73`.

`CollectionCallbacks` declares six members: `afterRead`, `beforeSave`,
`afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete`. `DATA_CALLBACKS`
lists four. `afterRead` is the omission that matters: the auth subsystem reads
users through `authRepo.getUserById`/`getUserByEmail` and builds its responses by
hand (`buildAuthResponse`), so an `afterRead` on the users collection that
redacts or masks a column does not apply to `/auth/me`, to a login response, or
to the admin user list. That is bug-class 15's question — *"decrypt for whom?"* —
asked of a hook the warning does not mention.

Separately, `warnOnAuthCollectionDataCallbacks` is called at `init.ts:877`, inside
the `else` (non-adapter) arm, so an adapter deployment with an `auth: true`
collection is never warned. Also, the auto-discovery at `:848-855` uses `.find()`,
so with two auth-flagged collections only the first is checked.

**Fix direction.** Derive `DATA_CALLBACKS` from the `CollectionCallbacks` keys
rather than re-listing them (class 17), and call the warning for both arms.

### L3. Collection-level `auth.onCreateUser` and adapter `userManagement` are silently ignored for custom adapters

`packages/server/src/auth/admin-user-ops.ts:130`;
`packages/server/src/init.ts:840`.

`AuthCollectionConfig.onCreateUser` is consulted only inside
`prepareAdminUserValues`, which is reached only through the builtin adapter's
`prepareUserCreation`. A custom adapter never calls it. Likewise
`UserManagementAdapter` — a documented "optional user management for the admin
panel" — is stored on `authConfigResult.userService` and read by one line that
uses it as an auth-repository fallback. Configure either on a custom-adapter
backend and nothing happens, with no boot warning.

**Fix direction.** Warn at boot when an adapter that implements neither
`prepareUserCreation` nor `createAdminRoutes` is paired with a collection
declaring `auth.onCreateUser`, or with a `userManagement` that nothing will call.

### L4. Admin-initiated creation hashes a caller-supplied password without a strength check

`packages/server/src/auth/admin-user-ops.ts:157-160`.

```ts
const password = body.password as string | undefined;
const clearPassword = password || generateSecurePassword();
const passwordHash = await resolvedHooks.hashPassword(clearPassword);
```

Every other password-setting path validates first, including
`PUT /admin/users/:uid` twenty lines away in a file that shares this one's
helpers (`admin-users-route.ts:301`). Creation accepts `"a"`; update refuses it.
The generated fallback is strong (`generateSecurePassword`, 16 chars from a
`randomInt` alphabet), so this only bites when a password is supplied
explicitly — which is what the admin "create user with password" form does, and
what `POST /api/data/users` does.

**Fix direction.** Call `resolvedHooks.validatePasswordStrength` on
`body.password` in `prepareAdminUserValues` before hashing.

### L5. The live `GET /auth/config` has no rate limiter, runs `count(*)` per call, and 500s on a throwing adapter

`packages/server/src/init.ts:1016-1019`;
`packages/server/src/auth/session-routes.ts:327`;
`packages/server-postgres/src/auth/services.ts:386-390`.

`init.ts` registers `GET ${basePath}/auth/config` directly on the app, before
mounting the auth router — the same shadowing that bug-class 2 documents for
`registrationEnabled`. The shadowed copy in `session-routes.ts:327` carries
`defaultAuthLimiter`; the live one carries nothing. For the builtin adapter every
unauthenticated request runs `getCapabilities` →
`listUsersPaginated({ limit: 1 })` → an unfiltered `SELECT count(*) FROM users`.
Two round trips (`count` + `SELECT`) per anonymous hit on a route that exists to
tell a login form which buttons to draw.

The same handler has no `try`/`catch` around `authAdapter!.getCapabilities()`, so
a custom adapter whose `getCapabilities` throws turns a public route into a 500.

**Fix direction.** Apply `defaultAuthLimiter` to the live registration, cache the
`needsSetup` count (it can only go from `true` to `false`, once, per process),
and wrap the call so an adapter fault degrades to a conservative capability set
rather than a 500.

### L6. Three lifecycle hooks miss the sub-path most likely to matter

* `afterLogout` (`session-routes.ts:97-104`) fires only when a bearer access
  token is present **and still verifies**. Under `cookieAuth` there is no bearer
  header, and in the ordinary case a user logs out with an access token that has
  already expired — `verifyAccessToken` returns `null` and the hook is skipped.
  The uid is available from the refresh-token row the handler has already looked
  up, so this is decodable without the access token.
* `onMfaVerified` (`mfa-routes.ts:436`) fires on challenge-verify but not on
  enrolment verification (`:277`), which is the event an "a second factor was
  added to your account" notification needs.
* `onPasswordReset` (`routes.ts:829`) fires on the token flow but not on
  `/auth/change-password`, admin reset, or `PUT /admin/users/:uid` with a
  password — three other ways a credential changes.

**Fix direction.** Take the uid from the session row in `afterLogout`; fire
`onMfaVerified` from both verification routes; decide whether `onPasswordReset`
means "reset" or "credential changed" and make the name and the call sites agree.

---

## Checked and clean

* **The expired-token downgrade is genuinely fixed.** `adapter-middleware.ts:118`
  returns 401 for any presented-but-unresolvable token regardless of
  `requireAuth`, matching `middleware.ts:366-372`. The distinction it draws —
  absent header stays anonymous, empty-or-bad token 401s — is correct for
  cookie-authenticating adapters, and `extractBearerToken` (`bearer-token.ts:27`)
  returns `undefined` only for a genuinely absent or foreign-scheme header, so
  `Bearer ` with an empty token routes into verification and 401s.
* **Fail-closed on all three adapter faults.** Throw → 401 (`:78-82`); `null` +
  token → 401 (`:118`); `null` + no token → anon-scoped driver, and if *that*
  scoping throws → 500 (`:127-131`), never the unscoped driver. `scopeDataDriver`
  (`rls-scope.ts:71-81`) deliberately does not catch. The raw driver is never
  placed in the context on any path in either middleware.
* **`resolveRequireAuth`** (`require-auth.ts:46-50`) is one predicate, shared by
  the HTTP data routes and the socket (`websocket.ts:154`), and an adapter
  unconditionally implies `true`. The class-10 inversion is closed.
* **No SQL injection from adapter-supplied identity.** `applyAuthContext`
  (`rls-enforcement.ts:304-310`) parameterises `uid` and the roles string through
  `set_config`; only `userRole`, which is framework-controlled, reaches
  `sql.raw`, and it is passed through `quoteIdent`. (The comma-delimiter issue in
  M3 is a data-model problem, not an injection.)
* **Service-key comparison is constant-time and byte-correct** on both paths
  (`crypto-utils.ts:19-40`, with the multi-byte truncation bug already fixed and
  documented).
* **Query-string tokens do not authenticate through the adapter.**
  `builtin-auth-adapter.ts:121-129` reads only the `Authorization` header, with a
  comment explaining why, matching `middleware.ts:79-83`.
* **API-key handling is equivalent on both paths.** The adapter middleware's
  `token.startsWith("rk_")` (`:66`) is exactly `isApiKeyToken`
  (`api-key-middleware.ts:39-41`), and both routers pass the same `apiKeyStore`.
* **`customizeAccessToken` and `transformAuthResponse` (the hooks version) have
  complete coverage.** Both `generateAccessToken` call sites in the workspace fire
  the former; all eight sign-in surfaces fire the latter. These are the two hooks
  that were done by funnelling rather than by hand, and they are the two with no
  gaps — which is the argument for fixing H1/M1 the same way.
* **`defaultRole: "admin"` is refused at construction** (`routes.ts:152-154`), and
  the OAuth sign-up path consults the registration kill switch and the
  empty-table bootstrap (`routes.ts:592-643`) including the two-signups-raced
  undo.
* **`aal` being dropped by the adapter middleware is currently harmless** — no
  route outside `auth/` reads it, so there is no gate the adapter path silently
  passes. It will stop being harmless the moment one is added.
* **The boot warning module itself is correct** for the four callbacks it names:
  it checks `typeof === "function"`, returns early on absent config, and is
  covered by `auth-collection-callback-warning.test.ts`.

## Open questions

1. **Is the collection REST create path an unintended second registration
   endpoint?** `POST /api/data/users` on an auth collection reaches
   `prepareUserCreation` → password hashing → `driver.save`, and consults neither
   `disableSelfRegistration`, `allowRegistration`, the first-user bootstrap, nor
   `defaultAuthLimiter`. It is gated only by collection permissions and RLS. If a
   users collection has an insert policy an anonymous caller satisfies, that is
   registration with the kill switch bypassed. Belongs to unit 22, but it is the
   adapter contract (`prepareUserCreation`) that makes it a credential-creating
   route rather than a plain insert.
2. **Bulk create has no auth-collection branch.** `api-generator.ts:426-429`
   validates fields but never calls `prepareUserCreation`, so a bulk write to the
   users collection creates rows with no hashing, no hooks and no invitation.
   Whether that is exploitable depends on whether `passwordHash` and any role
   column are declared write-able on the generated users collection — not
   determined here.
3. **Is `UserManagementAdapter` meant to be live?** It is fully implemented for
   the builtin adapter, documented on the custom-adapter options as "for the
   admin panel", and called by nothing. Either the admin panel was meant to route
   user CRUD through it for adapter backends (in which case H2 disappears once
   that is wired) or it should be removed. The answer decides whether H2's fix is
   "fire the hooks in the routes" or "make the routes use the adapter".
4. **What does the admin panel show for a custom adapter?** `createAdminRoutes`
   is absent, so `/admin/users` does not exist, but `getCapabilities` defaults in
   `createCustomAuthAdapter` set `adminPasswordReset: false` and say nothing about
   user listing. Whether the panel hides the Users section or renders it against
   404s was not checked.
5. **Does any shipped adapter in the wild rely on `serviceKey`?** M2's fix changes
   behaviour for anyone who implemented the service-key check inside their own
   `verifyRequest` (the only way it currently works on `/api/data`) — they would
   get two checks. Harmless, but worth a note in the changelog.
