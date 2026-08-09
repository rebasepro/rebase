# Unit 18 — Auth core (tokens, sessions, cookies, passwords, anonymous)

Read-only security audit, 2026-08-09, against `main` at `c678e1745`.

Files read: `packages/server/src/auth/routes.ts`, `middleware.ts`,
`adapter-middleware.ts`, `require-auth.ts`, `session-routes.ts`, `jwt.ts`,
`password.ts`, `bearer-token.ts`, `cookie-utils.ts`, `crypto-utils.ts`,
`builtin-auth-adapter.ts`, `rls-scope.ts`, `mfa-gate.ts`, `rate-limiter.ts`,
`interfaces.ts`, `auth-hooks.ts`, `admin-users-route.ts`, `admin-roles-route.ts`,
`reset-password-admin.ts`, `api-keys/api-key-routes.ts`; `packages/server/src/init.ts`,
`boot/options.ts`, `env.ts`; `packages/server-postgres/src/websocket.ts`,
`src/auth/services.ts`, `src/schema/auth-schema.ts`;
`packages/server/test/password-hash-compat.test.ts`; `docs/bug-classes.md`.
Also read `@hono/node-server@2.0.12` `newRequest` to settle the cookie question.

## Verdict

The refresh half of this subsystem is in good shape and clearly has had a pass:
rotation keeps the superseded row instead of deleting it, sessions are grouped
so a logout kills siblings, `sessionStartedAt` does not advance on rotation,
`aal` is carried forward rather than restated, and there is a revocation
watermark (`users.tokens_valid_after`) designed to close the
refresh-racing-a-password-reset window. The access half has none of that. **The
access token is a bearer credential that nothing can revoke and nothing
re-validates**: `verifyAccessToken` (`jwt.ts:183`) checks a signature, an expiry
and a `purpose`, and returns the token's own `roles` array. `tokensValidAfter`
has exactly one read in the entire repo — `routes.ts:1032`, on the refresh path —
and its own docstring (`interfaces.ts:419`) claims a broader contract than that
one call site delivers: *"the instant before which every session of this user is
void."* Every session except the one holding a live access token. This is class
36 in the shape the brief predicted: the mechanism is written, typed, persisted,
migration-covered and tested, and the line that consults it on the access path
does not exist.

Two things make that worse than a one-hour staleness window. First, the
DB-backed role read *does* exist — `builtin-auth-adapter.verifyRequest`
(`builtin-auth-adapter.ts:155`) throws away the token's roles and re-reads them
from the repository — and it is wired into two of the three enforcement points
(the `/api/data` router and the websocket) but **not** into the admin surfaces,
which run `createRequireAuth` + `requireAdmin` and therefore authorize on the
JWT's own `roles` claim. Second, one of the surfaces reachable that way is
`POST /api/admin/users/:uid/reset-password`, which turns a one-hour stale-admin
window into permanent takeover of any account.

Separately, in the ordinary production topology — anything terminating TLS in
front of Node — the httpOnly refresh cookie is issued **without `Secure`**, and
`POST /auth/anonymous` followed by `POST /auth/anonymous/link` walks straight
around `disableSelfRegistration`, the documented hard kill switch for account
creation.

Severity counts: **4 high, 5 medium, 9 low.**

---

## HIGH

### H1. No server-side revocation of access tokens; `tokensValidAfter` has one read

`packages/server/src/auth/jwt.ts:183-214`, `middleware.ts:85-117`,
`middleware.ts:352-359`, `adapter-middleware.ts:77`,
`builtin-auth-adapter.ts:121-207`, versus the single read at
`packages/server/src/auth/routes.ts:1032`.

**What's wrong.** Four routes deliberately revoke a user's sessions —
`POST /auth/reset-password` (`routes.ts:825-826`), `POST /auth/change-password`
(`routes.ts:874-875`), `DELETE /auth/sessions` (`session-routes.ts:169-173`),
`POST /auth/logout` (`session-routes.ts:85-89`) — and every one of them acts
only on the `refresh_tokens` table plus the `tokens_valid_after` watermark. No
path that *accepts* an access token consults either. `verifyAccessToken` is
purely offline; `requireAuth`, `createRequireAuth`, `optionalAuth`,
`queryTokenAuth`, `createAuthMiddleware`, `createAdapterAuthMiddleware`,
`extractUserFromToken` (websocket) and `builtin-auth-adapter.verifyRequest`
all accept a signed, unexpired token unconditionally. Logout is a client-side
gesture as far as the access token is concerned.

**Failure scenario.** An attacker phishes a session and holds the access token
(not the refresh token — a token pasted from devtools, captured from a proxy
log, or lifted by XSS from wherever the SDK keeps it). The victim notices,
changes their password and clicks "sign out all devices". Both actions delete
every refresh row and stamp `tokens_valid_after`. The attacker's access token
keeps working against `/api/data`, `/api/functions`, `/api/storage`, the
websocket and `/auth/*` for the remainder of its lifetime — one hour by default,
and unbounded if the deployment set `JWT_ACCESS_EXPIRES_IN` higher (see L6, there
is no ceiling). The victim, the operator and the audit log all believe the
session is dead.

**Fix direction.** The watermark already exists and is already loaded on the
refresh path; the missing piece is a read on the accept path. Put the check
where the identity is resolved rather than in `verifyAccessToken` (which is
sync and has no repository): compare the token's `iat` against
`getTokensValidAfter(uid)` in `builtin-auth-adapter.verifyRequest` /
`verifyToken`, and in `createRequireAuth`. `iat` is already in every token
jsonwebtoken signs — it just is not surfaced by `verifyAccessToken`, which
discards everything except `uid`/`roles`/`aal`. Cache the watermark per uid with
a short TTL so it costs one query per user per few seconds, not one per request.
Then assert the property rather than the call: a test that mints a token, stamps
the watermark, and expects 401 on `/api/data`, on the socket, and on
`/api/admin/users`.

### H2. Admin surfaces authorize on the JWT's `roles` claim, never re-read from the database

`packages/server/src/auth/middleware.ts:129-170` (`createRequireAuth` sets
`c.set("user", payload)` from `verifyAccessToken`), `middleware.ts:190`
(`requireAdmin` reads `user.roles`), mounted at `init.ts:1157`, `init.ts:1858`,
`admin-users-route.ts:71`, `admin-roles-route.ts:28`,
`reset-password-admin.ts:45`, `api-keys/api-key-routes.ts:79`. Contrast
`builtin-auth-adapter.ts:152-160`, which discards `payload.roles` and calls
`authRepository.getUserRoleIds(payload.uid)`.

**What's wrong.** This is class 17's second axis — the feature (authorize on the
*current* roles, not the minted ones) was applied at the call sites someone was
looking at. `/api/data` gets it via `createAdapterAuthMiddleware`; the websocket
gets it via `authAdapter.verifyToken` (`server-postgres/src/websocket.ts:219`);
every admin surface does not. So `POST /api/admin/users`, `PUT/DELETE
/api/admin/users/:uid`, `GET/POST /api/admin/roles`,
`POST /api/admin/users/:uid/reset-password`, `/api/admin/api-keys`, and the
cron / backups / logs / schema-editor routers gated by `applyAdminGate` all
answer to a claim the caller has been carrying since they last signed in.

**Failure scenario.** An admin is compromised (or leaves). The response is to
strip their roles — `setUserRoles(uid, [])` — and/or delete the account.
`/api/data` immediately reflects it. `/api/admin/*` does not. Within the
remaining token lifetime the attacker calls
`POST /api/admin/users/:uid/reset-password` against the owner's account; with no
email service configured that route returns a one-time temporary password in the
response body (`builtin-auth-adapter.ts:327-330` documents exactly this
fallback). The one-hour window is now a permanent account takeover, and it also
covers minting a long-lived `rk_` admin API key, which survives independently of
any JWT. Deleting the user does not help either: nothing on this path looks the
user up at all, so a token for a row that no longer exists still passes
`requireAdmin`.

**Fix direction.** One predicate, not two. `createRequireAuth` should resolve
the caller through the same adapter the data plane uses (or, minimally, re-read
`getUserRoleIds` and fail closed when the user is absent) rather than trusting
`payload.roles`. Pin agreement rather than behaviour, in the shape
`registration-policy.test.ts` uses: assert that a uid whose roles were just
changed gets the same answer from `/api/data`, from the socket, and from
`/api/admin/users`.

### H3. The refresh cookie is issued without `Secure` behind any TLS-terminating proxy

`packages/server/src/auth/cookie-utils.ts:33-37`.

```ts
const isSecure = settings.secure ??
    (settings.sameSite === "None" ? true : c.req.url.startsWith("https"));
```

**What's wrong.** `c.req.url`'s scheme is decided by
`@hono/node-server`'s `newRequest`: `scheme = incoming.socket && incoming.socket.encrypted ? "https" : "http"`
(`@hono/node-server@2.0.12/dist/index.mjs:462`). Nothing in this repo reads
`X-Forwarded-Proto` — `grep -ri "x-forwarded-proto"` over `packages/` and
`saas/` returns nothing. Behind nginx, a GKE ingress, Cloud Run, Fly, Render or
any other TLS terminator, the Node socket is plaintext, so `c.req.url` is
`http://…` and the auto-detection evaluates **false**. The default
`sameSite` is `"Lax"` (`cookie-utils.ts:13`), so the `"None" ⇒ true` escape does
not fire either. Unless the operator explicitly writes `cookieAuth: { secure: true }`,
the 400-day refresh token ships with `HttpOnly; SameSite=Lax; Path=/` and no
`Secure`. The doc comment on `AuthModuleConfig.cookieAuth`
(`routes.ts:66-71`) promises the opposite: *"delivered as an `httpOnly`,
`Secure`, `SameSite` cookie"*.

**Failure scenario.** An attacker on the same network as the victim (café Wi-Fi,
a hostile ISP, an ARP-spoofed LAN) injects any `http://<app-host>/…` subresource
or redirect — an image tag on any page, a captive-portal splash, a 302 on a
plaintext request. The browser attaches the refresh cookie to that cleartext
request because it carries no `Secure` attribute, and the attacker reads a
credential that is good for 400 sliding days and is not bound to a device, an
IP, or the access token. HSTS mitigates this only after a first successful HTTPS
visit and only where the host is preloaded or the header is set — neither is
this code's guarantee to make.

**Fix direction.** Default `secure` to `true` and require an explicit opt-out for
localhost development rather than inferring it (the inference is unfixable in
general — the process genuinely cannot see the edge's scheme). If inference is
kept, read `X-Forwarded-Proto` gated on the same `trustedProxyHops` notion
`rate-limiter.ts:129` already implements, so the header is believed only where a
proxy is declared. While there: `__Host-` prefix the cookie name when
`domain` is unset and `path` is `/`, which makes `Secure` non-optional at the
browser instead of at review time.

### H4. Anonymous sign-in bypasses `disableSelfRegistration` and cannot be turned off

`packages/server/src/auth/session-routes.ts:359` (`POST /auth/anonymous`) and
`session-routes.ts:419` (`POST /auth/anonymous/link`).

**What's wrong.** Both routes are mounted unconditionally by
`mountSessionRoutes`, which `createAuthRoutes` always calls (`routes.ts:1172`).
Neither consults `config.disableSelfRegistration`, `config.allowRegistration`,
`isRegistrationAllowed()` or `isRegistrationOpen()` — the three registration
gates that `POST /auth/register` goes through at `routes.ts:354-372`. There is
also no config key anywhere in the repo to disable anonymous auth:
`grep -rn "allowAnonymous\|anonymousAuth\|enableAnonymous"` over `packages/`
returns zero hits, and `getCapabilities()` does not advertise it, so a client
cannot even discover that it is on.

**Failure scenario.** An operator ships a closed backend: `allowRegistration`
defaults to `false` (`routes.ts:164`, `builtin-auth-adapter.ts:101`) and, for
belt and braces, sets `disableSelfRegistration: true`, whose docstring calls it
a *"hard kill switch: block self-registration outright"*
(`builtin-auth-adapter.ts:58-68`). `POST /auth/register` correctly answers 403.
Any anonymous caller then sends `POST /auth/anonymous` — 201, with a real
`users` row, a real session, and `config.defaultRole` assigned exactly as a
registered user would get it (`session-routes.ts:382-384`) — followed by
`POST /auth/anonymous/link` with any email and password, which sets `email`,
`passwordHash` and `isAnonymous: false` on that same row
(`session-routes.ts:448-452`). The result is a permanent email/password account
on a server that refuses registration, created in two unauthenticated requests
(the second is authenticated only by the token the first one just handed out).
`/auth/anonymous` carries `strictAuthLimiter` (50 per 15 min per IP per
replica); `/auth/anonymous/link` carries no limiter at all. The same pair is
also an unauthenticated row-insert loop against the `users` table.

Secondary, same root: nothing downstream reads `isAnonymous`. Grepping it across
`server/src` and `server-postgres/src` yields writes, response-shape
declarations, and exactly one authorization-adjacent read —
`session-routes.ts:426`, which only asks "is this user still anonymous" inside
the link route itself. The access token carries no anonymity claim, RLS binds on
`uid` and `roles`, and an anonymous user holds the same `defaultRole` as a
registered one. So "anonymous users can reach whatever `defaultRole` reaches",
and no policy can be written to say otherwise.

**Fix direction.** Route both endpoints through the shared registration
predicate (`registration-policy.ts`), which is what it exists for, and add an
`allowAnonymous` config key that is `false` by default and reported by
`getCapabilities()` — a capability that exists and is not in the capability
surface is class 2 waiting to happen. Independently, put `is_anonymous` in the
RLS-visible identity (an `anon`-adjacent implicit role, or a claim the policy
compiler can reach) so `defaultRole` is not the only lever.

---

## MEDIUM

### M1. Refresh-token reuse is detected and logged, but the family is never revoked

`packages/server/src/auth/routes.ts:1039-1059`.

The brief asks directly. The answer is: detected, logged at `warn`, **not**
revoked. Outside the 10-second reuse window a replayed token yields 401
`TOKEN_ALREADY_USED` and the comment explains the choice — *"we decline the
request but leave the session standing"* — reasoning about the false-positive
case (a straggler from a lost response) and not about the true-positive one.
But the two are distinguishable, and OAuth 2.0 BCP §4.14.2 and every
implementation this file benchmarks against (GoTrue's reuse interval is cited by
name at `routes.ts:81`) revoke the family on a *late* replay for exactly that
reason: the reuse interval already absorbs the benign case, so a replay well
outside it is evidence of two holders.

**Failure scenario.** An attacker exfiltrates a refresh token (a synced browser
profile, a backup, a proxy log, the non-cookie mode where it sits in the JSON
body and in client storage). The legitimate client rotates first; the attacker's
copy is now stale and, when used, produces one `warn` line and a 401. The
attacker simply waits for the *next* time they are the one holding the live
token — or, more simply, uses their captured token before the victim's client
next refreshes, at which point the attacker holds the live token and the
*victim* gets the 401. Either way the session survives, both parties keep
retrying, and there is no mechanism that ever ends it. The signal exists
(`routes.ts:1052`) and no code reads it.

**Fix direction.** On a replay outside the reuse window, call
`revokeRefreshTokenSession(storedToken.sessionId)` and stamp
`setTokensValidAfter`, then 401. Both repository methods already exist and are
already used by logout. Keep the log line; it becomes the record of a killed
session instead of a note about one that survived.

### M2. `customizeAccessToken` can overwrite `uid` and `roles`; only `aal` was protected

`packages/server/src/auth/jwt.ts:119-130`.

```ts
const payload: Record<string, unknown> = { uid, roles, ...customClaims, aal };
```

The comment above it is precise about the hazard and then guards one third of
it: *"one that merged a user-controlled profile object could echo back
`aal: "aal2"`. Spreading last made the assurance level of a session something
its own holder could assert, which is the one claim that must be decided here."*
`uid` and `roles` are also claims that must be decided here, and they are
spread *over*, not after. The hook's own docstring
(`auth-hooks.ts:173-183`) encourages the shape that breaks it: *"Return the
modified claims object"*, with the default claims — including `uid` and `roles`
— handed in as the first argument.

**Failure scenario.** An application writes the documented hook to add tenant
info: `async (claims, user) => ({ ...claims, ...user.metadata })`. `metadata` is
a JSONB column on `users`; whether the user can write it depends on that
deployment's RLS, and on a `baas` project where `users` is an ordinary
collection it frequently can. A user who lands `{"roles": ["admin"]}` in their
own metadata mints themselves an admin token at next login — and because of H2,
that token is admin on every `/api/admin/*` surface, where no database read
would contradict it. `uid` is the same story with a wider blast radius:
`uid: "service"` is the identity `rls-scope.ts:38` documents as the trusted
server plane.

**Fix direction.** Same fix that was already applied to `aal`, extended:
`{ ...customClaims, uid, roles, aal }`. Better still, refuse rather than
silently override — delete the reserved keys from the hook's return and log once
at `warn` naming them, so an application that is accidentally setting `roles`
finds out instead of having it quietly dropped.

### M3. `refreshTokenReuseIntervalSeconds` is declared, documented as a security tradeoff, and unreachable

`packages/server/src/auth/routes.ts:79-94` (declaration and docstring),
`routes.ts:1043` (the only read).

Class 3, the `disableSelfRegistration` shape exactly. The option is on
`AuthModuleConfig`, read by the refresh route, and set by nobody:
`grep -rn "refreshTokenReuseIntervalSeconds"` over `packages/` and `saas/`
returns the declaration, the read, and nothing else. It is absent from
`BuiltinAuthAdapterConfig`, from the `createAuthRoutes({...})` call inside
`createBuiltinAuthAdapter` (`builtin-auth-adapter.ts:212-227`), from
`RebaseAuthConfig` in `init.ts`, and from `boot/options.ts` / `env.ts`. No
framework user can change it; it is permanently 10 seconds. Its own docstring
says *"Widen it if your clients are flaky or your deploys are long; the cost is
how long a captured token stays useful to someone who copied it"* — advice for a
knob that does not turn.

**Fix direction.** Plumb it through `BuiltinAuthAdapterConfig` →
`createAuthRoutes`, and through `RebaseAuthConfig` + an env var, or delete the
option and hardcode the constant. Either is honest; the current state is not.
The same trace catches `isBootstrapCompleted` / `setBootstrapCompleted` (see L9).

### M4. No per-account login throttle and no lockout

`packages/server/src/auth/rate-limiter.ts:174-178`, applied at
`routes.ts:456`.

`/auth/login` is protected by `defaultAuthLimiter`: 200 requests per 15 minutes,
keyed by client IP, counted in a per-process `MemoryRateLimitStore`
(`rate-limiter.ts:72`). Nothing counts failures per *account*. There is no
lockout, no exponential backoff, and no "unusual sign-in" signal — the failure
path logs one `warn` (`routes.ts:485`) and returns.

**Failure scenario.** Credential stuffing. 200 attempts per IP per window is
~13/minute; a botnet of 1,000 residential IPs sustains 13,000 attempts per
minute against a list of accounts, and the per-replica in-memory store
multiplies the ceiling by the replica count (a 5-pod deployment behind a
round-robin ingress gives each IP 1,000 per window). Nothing in the system
notices that one account absorbed thousands of failures, because the only
counter is keyed by the attacker's address.

**Fix direction.** Add a second limiter keyed on the normalized email, in the
shape `verificationEmailLimiter` already uses for the recipient rather than the
caller (`rate-limiter.ts:206-217`) — that file has already worked out that "the
quantity being protected is not the caller". Back it with the shared
`RateLimitStore` so it is not per-replica, and emit a security-audit event when
an account crosses the threshold.

### M5. Scrypt parameters are unversioned in the stored hash — there is no upgrade path

`packages/server/src/auth/password.ts:22-24, 67-90`, and
`packages/server/test/password-hash-compat.test.ts`.

The stored format is `salt:hash`. `N`, `r`, `p` and `keylen` appear nowhere in
it, and `verifyPassword` re-derives with the module's *current* constants. So
raising `N` does not upgrade anything — it invalidates every hash in the
database at once, and the symptom is every existing user failing to log in with
a correct password. The compat test recognises this and responds by pinning the
current values as a frozen contract (*"Scrypt parameters are a stored-data
contract, not a tuning knob"*), which is the right instinct and also means the
parameters can now never be raised. There is no rehash-on-successful-login path
and no `needsRehash` predicate anywhere in the package.

**Failure scenario.** Not an attack so much as a trap that guarantees the
defence cannot be strengthened: in 2030, when `N: 16384` is weak, the only
available move is a forced password reset for the entire user base — and the
version of this code that discovers the problem is the one that bumps the
constant, ships, and locks everyone out.

**Fix direction.** Version the stored string —
`scrypt$N=16384,r=8,p=1$<salt>$<hash>` (or move to PHC format outright) — parse
the parameters out on verify, and rehash with the current parameters inside
`POST /auth/login` when the stored parameters are weaker than the configured
ones. That is the one moment the plaintext is available. Keep the legacy-hash
test; add one asserting a legacy hash is *upgraded* after a successful login.

---

## LOW

**L1. `verifyPassword` throws on a stored hash whose digest is not exactly 64
bytes.** `password.ts:89` — `timingSafeEqual` raises `RangeError: Input buffers
must have the same byte length` when the lengths differ (verified). The compat
test only covers hashes with no `:` at all (`"not-a-hash"`, `""`), which take the
`return false` branch at line 79. A hash of a different `keylen` — imported from
another system that also uses `salt:hash`, truncated by a `varchar` bound, or
written through `updateUser` with a raw `passwordHash` — makes `/auth/login`
throw into `errorHandler` and answer **500** where every other credential
failure answers 401. That is both a permanent lockout for that account and a
cheap oracle distinguishing "account has a legacy/damaged hash" from "wrong
password". Wrap the compare, or length-check first and `return false`.

**L2. `AccessTokenPayload` declares five claims that `verifyAccessToken` never
returns, and two of them are read.** `jwt.ts:22-31` declares `email`,
`displayName`, `photoURL`, `mfa_verified`, `amr`; `verifyAccessToken`
(`jwt.ts:205-209`) returns only `uid`, `roles`, `aal`.
`builtin-auth-adapter.ts:164-165` and `:201-202` then read `payload.email ??
""` and `payload.displayName ?? null`, so **`AuthenticatedUser.email` is
always the empty string** for every JWT-authenticated caller — including inside
custom functions, which read the principal via `c.get("user")`. Any application
that authorizes on the email (`user.email.endsWith("@acme.com")`) evaluates
against `""`; that particular shape fails closed, but an allowlist written as
`allowed.includes(user.email)` with `""` accidentally in the list does not.
`mfa_verified` and `amr` are declared and read by nothing at all (class 21).
Either populate the claims in `verifyAccessToken` or delete them from the type
and from the two readers.

**L3. Refresh cookie defaults to `Path=/`, with no `__Host-`/`__Secure-`
prefix.** `cookie-utils.ts:12, 36`. With `HttpOnly` set, XSS cannot read the
cookie — but XSS anywhere on the origin can `fetch("/api/auth/refresh", {
credentials: "include" })` and mint access tokens for as long as the page lives,
and `Path` does not change that. What `Path=/` does add is that the 400-day
credential is attached to every request to the origin, including
`/api/storage/file/*`, which serves user-uploaded content from the same host.
Narrow the default to the auth base path, and prefix the name (see H3).
Related nit: `clearRefreshCookie` (`cookie-utils.ts:57`) omits `Secure` where
`setRefreshCookie` may have set it — harmless today, since cookies are keyed on
name/domain/path, but it is the kind of asymmetry that stops being harmless when
a `__Secure-` prefix is added.

**L4. No `iss` / `aud` claim, minted or verified.** `jwt.ts:132-135` signs with
`{ expiresIn, algorithm: "HS256" }` and nothing else; `jwt.ts:192` verifies with
`{ algorithms: ["HS256"] }`. Algorithm confusion is correctly closed. Issuer and
audience are not: any HS256 token signed with the same secret and carrying a
`uid`/`userId`/`sub` and no `purpose` authenticates as that subject. That is
fine while the secret is used by exactly one issuer, and it is a cross-service
confusion bug the day `JWT_SECRET` is shared with another component or a
compatibility layer. Add `iss` and `aud` on mint and require them on verify.

**L5. `verifyAccessToken` accepts three spellings of the subject, one of which
is not ours.** `jwt.ts:197` — `decoded.uid || decoded.userId || decoded.sub`.
The `userId` fallback is documented and time-boxed by the rename. `sub` is
justified in the docblock as *"older external IdPs may send `sub`"*, but an
external IdP's token is not signed with this server's secret, so this branch
cannot be doing what the comment says. Combined with L4, it widens the set of
foreign tokens that would authenticate if a secret is ever shared. Remove `sub`,
or gate it behind an explicit config.

**L6. Token lifetimes are unvalidated, unbounded, and parsed by two disagreeing
parsers.** `env.ts:94, 98` accept any string. `jwt.sign` routes a string through
`ms()`; `getAccessTokenExpiryMs` (`jwt.ts:143`) uses `^(\d+)([dhms])$` and falls
back to one hour on no match. So `JWT_ACCESS_EXPIRES_IN=30` signs a token that
`ms("30")` makes live **30 milliseconds** while the response advertises
`accessTokenExpiresAt` an hour out; `"2 days"` signs 48 hours and advertises
one. Neither parser has a ceiling, so `"9999d"` mints an effectively permanent
credential — which, given H1, nothing can ever revoke. Validate both strings at
boot against the same grammar the local parser uses, and cap the access lifetime
(the refresh side already has `MAX_COOKIE_AGE_MS` and knows why).

**L7. A third, contradictory default for the refresh TTL.** `jwt.ts:40` says
`"400d"`, `env.ts:98` says `"400d"` and the surrounding comments explain at
length why 30 days was wrong — and `init.ts:886` hardcodes
`safeAuthConfig.refreshExpiresIn || "30d"`. Booting through `boot/options.ts`
the Zod default always supplies a value so the fallback never fires, but an
embedder calling `initializeRebaseBackend({ auth: { jwtSecret } })` directly —
the shape `init.ts:78` documents — gets 30 days and the exact behaviour the
jwt.ts comment describes as the bug being fixed. One constant, imported.

**L8. Four auth routes carry no rate limiter.** `POST /auth/refresh`
(`routes.ts:974`), `POST /auth/logout` (`session-routes.ts:71`),
`POST /auth/anonymous/link` (`session-routes.ts:419`) and
`GET /auth/verify-email` (`routes.ts:950`) are the only routes in the module
without one, and the first and last are unauthenticated. Guessing a 40-byte
token is not the risk; the unbounded database work per request is, and
`/auth/refresh` does up to five queries and an insert. Relatedly, email
verification tokens have **no expiry** — `setVerificationToken` /
`getUserByVerificationToken` (`interfaces.ts:313, 318`) store and match a hash
with no `expires_at` and no check, so a link mailed years ago still verifies.
(The email unit was audited separately; noting it here because the route lives
in `routes.ts`.)

**L9. `isBootstrapCompleted` / `setBootstrapCompleted` are never wired.**
Declared on `AuthModuleConfig` (`routes.ts:62`) and `AdminUsersRouteConfig`
(`admin-users-route.ts:34-35`), read at `session-routes.ts:329` and
`admin-users-route.ts:79`, and passed by nobody —
`createBuiltinAuthAdapter` constructs both routers without them
(`builtin-auth-adapter.ts:213-226`, `:243-250`). `POST /admin/bootstrap`
therefore skips its "already completed" gate entirely and relies on the two
checks below it (no admin exists, and the caller is the earliest-registered
user), which do hold. So this is defence-in-depth that is absent rather than an
opening — but it is the same unplumbed-option shape as M3, found by the same
trace, and worth fixing in the same pass.

---

## Checked and clean

- **`safeCompare` coverage.** Every secret comparison in the auth core is
  constant-time: the service key in `createRequireAuth` (`middleware.ts:149`),
  in `createAuthMiddleware` (`middleware.ts:323`), in
  `builtin-auth-adapter.verifyRequest`/`verifyToken` (`:136`, `:174`), and in
  the websocket. `crypto-utils.ts:19-44` itself is correct and its byte-length
  handling is the fix for a real bug (multi-byte truncation), with the length
  check folded in after the compare. Refresh tokens, password-reset tokens and
  verification tokens are matched by **hash, in the database**, where a
  constant-time compare is not the applicable control. The only non-constant-time
  secret comparison found anywhere is `mfa.ts:127`
  (`generateHotp(secret, step) === token`), a 6-digit TOTP code — MFA was
  audited separately in `20-mfa.md`; recorded here because the sweep asked.
- **`requireAuth: false` is a skip, not a grant.** Both middlewares set no user
  and scope the driver as `anon` (`middleware.ts:374-386`,
  `adapter-middleware.ts:123-131`); the enforcement is a single trailing
  `if (enforceAuth && !c.get("user"))`. Neither derives a permission from the
  negation. The class-10 instance named in `bug-classes.md` — the socket's
  `authenticated: !requireAuth` — is closed: both sockets now call the shared
  `resolveRequireAuth` (`server-postgres/src/websocket.ts:154`,
  `server-mongo/src/websocket.ts:89`), and `require-auth.ts:46-50` fails closed
  on a missing config and on an adapter. `applyAdminGate` (`init.ts:1126-1158`)
  deliberately does *not* read `requireAuth`, with a comment explaining why,
  and answers 501 rather than mounting open when no credential exists.
- **Fail-closed RLS scoping.** `scopeDataDriver` re-throws
  (`rls-scope.ts:71-81`), and every call site turns a throw into a 500 or a 401
  rather than proceeding with the unscoped driver — `middleware.ts:334, 360,
  381`, `adapter-middleware.ts:96, 127`. The raw driver is never placed in the
  request context.
- **Presented-but-invalid tokens.** Both middlewares 401 a token that fails to
  verify even when `requireAuth` is false (`middleware.ts:366-372`,
  `adapter-middleware.ts:118-121`), so an expired token cannot be silently
  downgraded to anonymous. `auth-invalid-token-parity.test.ts` exists for this.
- **Purpose-scoped token separation.** `verifyAccessToken` refuses any token
  carrying `purpose` (`jwt.ts:193-196`), so download tokens and MFA pre-auth
  tokens cannot authenticate a request, and `verifyMfaPendingToken` refuses an
  access token in the other direction (`jwt.ts:316`).
- **`aal` on refresh.** Read from `refresh_tokens.aal` and carried forward
  (`routes.ts:1086`), defaulting to the restrictive `aal1` on an absent value,
  rather than the hardcoded `aal1` the MFA audit found.
- **Session revocation semantics on the refresh side.** Logout and
  `DELETE /auth/sessions/:id` resolve a token to its *session* and revoke the
  family (`session-routes.ts:85-89`, `:200-204`), not the single presented row;
  `sessionStartedAt` does not advance on rotation (`routes.ts:1113`), so a
  session cannot outrun the watermark by refreshing; and `DELETE
  /auth/sessions/:id` is scoped to the caller's own tokens before acting.
- **Rotation bookkeeping.** The superseded row is kept, not deleted
  (`routes.ts:1117-1125`), which is what makes replay detectable at all; the
  prune is opportunistic and cannot fail the request.
- **CSRF on the cookie paths.** `SameSite=Lax` is the default and both
  cookie-reading routes are `POST`, so a cross-site form cannot carry the
  cookie. A deployment that sets `sameSite: "None"` (the cross-origin SPA case)
  exposes `POST /auth/logout` to a cross-site denial-of-service and
  `POST /auth/refresh` to a forced rotation, neither of which discloses a token
  — the response is unreadable without a CORS allowance, and browsers forbid
  `*` with credentials. Worth a docs line, not a finding.
- **`extractBearerToken`** (`bearer-token.ts:27-33`) folds only the scheme name
  and returns the token byte-for-byte; the `undefined` (no header) vs `""`
  (empty token) distinction is used consistently by every caller.
- **Rate-limit key derivation.** `defaultKeyGenerator`
  (`rate-limiter.ts:148-167`) believes `X-Forwarded-For` and `X-Real-IP` only
  when `trustedProxyHops > 0`, indexes XFF from the right, and otherwise falls
  back to the unforgeable socket address. The `X-Real-IP` bypass recorded in
  memory is closed.
- **First-admin bootstrap.** `POST /auth/register` promotes only a genuine first
  user and deletes the loser of a race through the empty-table window
  (`routes.ts:398-418`); `POST /admin/bootstrap` additionally requires that no
  admin exists *and* that the caller is the earliest-registered user
  (`admin-users-route.ts:86-137`). `defaultRole: "admin"` throws at construction
  (`routes.ts:152-154`).
- **`configureJwt`** rejects secrets under 32 characters and a denylist of known
  defaults (`jwt.ts:47-83`); `generateRefreshToken` and `generateSecureToken`
  both use 40 CSPRNG bytes; refresh tokens are stored SHA-256-hashed.
- **`isRLSScopedDriver` / `isAuthAdapter`** are real discriminators, not class-18
  tautologies — both test for the presence *and* callability of the method.
- **User enumeration.** `/auth/forgot-password` always answers success
  (`routes.ts:786`); `/auth/login` returns one message for "no such user", "no
  password hash" and "wrong password". `/auth/register` does return 409
  `EMAIL_EXISTS`, which is the standard tradeoff and is rate-limited.
  `POST /auth/find-user` is opt-in, authenticated, and returns three
  non-sensitive fields.

## Open questions

1. **Is the one-hour access-token window an accepted risk, or an oversight?**
   H1 and H2 are both cheap to fix if the answer is "oversight", and the
   watermark's existence suggests it is. If it is accepted, the docs should say
   so at the point where `DELETE /auth/sessions` and `/auth/logout` are
   described, because both currently read as complete revocation.
2. **Was `cookieAuth.secure`'s auto-detection ever exercised behind a real
   proxy?** H3 is a runtime-topology bug; a unit test constructing a Hono
   context with an `https://` URL would pass. Worth a test that asserts the
   `Set-Cookie` header from a request whose URL is `http://` and whose
   `X-Forwarded-Proto` is `https` — the scenario every production deployment is
   in.
3. **Is anonymous auth meant to be a default-on capability?** H4 assumes not.
   If it is intentional, `disableSelfRegistration` needs a docstring saying it
   does not cover it, and `getCapabilities()` should advertise it so a client
   can tell.
4. **Does any shipped example or the scaffold write a `customizeAccessToken`
   hook?** M2's exploitability depends on whether the documented pattern is in
   circulation. Not checked outside `packages/`.
5. **`packages/server/test` coverage of the revocation path.** There is a
   `refresh-rotation.property.test.ts` with a `validAfter` map, so the refresh
   watermark is modelled. Nothing appears to assert what an access token does
   after a revocation, which is consistent with H1 being invisible to the suite.
   Not run (read-only audit).
