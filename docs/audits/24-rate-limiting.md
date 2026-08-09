# Unit 24 — rate limiting

**Audited:** 2026-08-09 · read-only · `packages/server/src/auth/rate-limiter.ts`,
`packages/server/src/auth/rate-limit-store.ts`, every call site across
`packages/server/src/**` (auth, admin, data, functions, storage, cron, backups, logs,
schema editor, meta), plus the socket budgets in
`packages/server-postgres/src/websocket.ts` and its untouched twin
`packages/server-mongo/src/websocket.ts`.

## Verdict

The mechanism is good and the coverage is not. `MemoryRateLimitStore` is a genuine
sliding window with an honest docblock about being per-replica; `createDataRateLimiter`
puts every request in exactly one bucket, most-specific first; `verificationEmailLimiter`
and `mfaVerificationLimiter` both key on the *account under attack* rather than the
caller, which is the hard half of the problem and the half most codebases get wrong. The
X-Real-IP defect the map records is genuinely fixed, and pinned by four tests.

What was not fixed is the thing that defect was an instance of. `defaultKeyGenerator`
believes `X-Forwarded-For` whenever `trustedProxyHops > 0`, and **the default is 1** —
resolved from `TRUSTED_PROXY_HOPS`, an env var that appears in exactly three places in
this repository, all of them inside `rate-limiter.ts` itself. It is set by no boot path,
no manifest, no `.env` example and no documentation page. So every deployment that is not
behind a proxy — `rebase dev`, a self-hosted `rebase-server` bound to a port, a container
with a passthrough load balancer — reads its rate-limit key out of a header the caller
writes. That is class 30 exactly: the limiter makes a claim about who sent the request
that its own inputs cannot support, and the code that reasons carefully about it is one
`||` away from the code that assumes it. `curl -H 'X-Forwarded-For: $RANDOM'` restores
every limiter in the process to a limit of one, including login, registration,
forgot-password, magic-link and the 300/window anonymous data bucket.

Underneath that, three coverage holes. **Storage has no limiter at all** — not on upload,
not on download, not on the tus endpoints — which is the only surface in the product
where a request directly buys S3 operations and egress bytes, and `storagePublicRead`
makes it anonymous. **`forgot-password` and `magic-link` have only an IP bucket**, though
the docblock four files away spells out why that is the wrong axis for a route whose cost
is borne by a third party: `send-verification` got a per-recipient limiter and its two
siblings did not. And **`AUTHENTICATE` returns before the socket budget is applied on both
websockets**, so the one frame type an unauthenticated client can send is the one frame
type that is never counted — each of which runs a JWT verification, or, with an adapter,
an outbound call to Clerk.

The store answer is honest but incomplete: in-memory, per-pod, documented as such — and
no shared implementation ships, no boot path configures one, and the managed runtime runs
N pods. A limit of 300 is a limit of 300 × pods, today, in production.

---

## Coverage table

Every surface that mutates state, sends mail, or costs money. "IP" means the
`defaultKeyGenerator` key, which is spoofable under the default `trustedProxyHops: 1` —
see H1.

### `${basePath}/auth` — `auth/routes.ts`, `session-routes.ts`, `magic-link-routes.ts`, `mfa-routes.ts`

| Route | Limiter | Key / budget | Cost |
|---|---|---|---|
| `POST /register` | `defaultAuthLimiter` | IP, 200/15m | creates a user, **sends mail** (`routes.ts:275`) |
| `POST /login` | `defaultAuthLimiter` | IP, 200/15m | password hash verify |
| `POST /{oauthProvider}` (×12) | `defaultAuthLimiter` | IP, 200/15m | outbound provider token exchange; creates users |
| `POST /link/{provider}` | `defaultAuthLimiter` + `requireAuth` | IP, 200/15m | mutates identities |
| `POST /forgot-password` | `strictAuthLimiter` | IP, 50/15m | **sends mail** — no per-recipient bound (H3) |
| `POST /reset-password` | `strictAuthLimiter` | IP, 50/15m | mutates password, kills sessions |
| `POST /change-password` | **none** | — | password verify (hash) + mutate + delete all tokens (M4) |
| `POST /send-verification` | `strictAuthLimiter` **+ `verificationEmailLimiter`** | IP 50/15m **+ uid 5/15m** | **sends mail** — the reference implementation |
| `GET /verify-email` | **none** | — | mutates `emailVerified`; DB lookup per call |
| `POST /refresh` | **none** | — | token rotation: 1–2 DB writes per call |
| `POST /logout` | **none** | — | deletes a refresh token |
| `GET /config` | `defaultAuthLimiter` | IP, 200/15m | read |
| `GET /me` | **none** (`requireAuth`) | — | read |
| `PATCH /me` | **none** (`requireAuth`) | — | mutates the profile row |
| `GET /sessions` | **none** (`requireAuth`) | — | read |
| `DELETE /sessions`, `DELETE /sessions/:id` | **none** (`requireAuth`) | — | mutates |
| `POST /find-user` | `defaultAuthLimiter` + `requireAuth` | IP, 200/15m | user enumeration by design |
| `POST /anonymous` | `strictAuthLimiter` | IP, 50/15m | **creates a user row per call** |
| `POST /anonymous/link` | **none** (`requireAuth`) | — | mutates identity |
| `POST /magic-link` | `strictAuthLimiter` | IP, 50/15m | **sends mail** — no per-recipient bound (H3) |
| `POST /magic-link/verify` | `strictAuthLimiter` | IP, 50/15m | mints a session |
| `POST /mfa/enroll` | `strictAuthLimiter` + `requireAuth` | IP, 50/15m | creates a factor |
| `POST /mfa/verify` | `strictAuthLimiter` + `mfaVerificationLimiter` | IP 50/15m + **uid 10/15m** | TOTP verify |
| `POST /mfa/challenge` | `strictAuthLimiter` | IP, 50/15m | creates a challenge row |
| `POST /mfa/challenge/verify` | `strictAuthLimiter` + `mfaVerificationLimiter` | IP 50/15m + **uid 10/15m** | TOTP verify, mints a session |
| `GET /mfa/factors` | `strictAuthLimiter` | IP, 50/15m | read |
| `DELETE /mfa/unenroll` | `strictAuthLimiter` + `requireAuth` | IP, 50/15m | deletes a factor |

`defaultAuthLimiter` and `strictAuthLimiter` are module-level singletons
(`rate-limiter.ts:174`, `:184`), each with one private store. Every route above marked
`strictAuthLimiter` shares **one** 50/15m budget per IP — MFA verification and password
reset compete for the same 50.

### `${basePath}/admin` and `${basePath}/admin/api-keys` — admin-gated, no limiter anywhere

| Route | Limiter | Cost |
|---|---|---|
| `POST /admin/bootstrap` | **none** | first-admin promotion (`admin-users-route.ts:73`) |
| `GET /admin/users`, `GET /admin/users/:uid` | **none** | read |
| `POST /admin/users` | **none** | creates a user, **sends the invitation mail** (`admin-user-ops.ts:234`) |
| `PUT /admin/users/:uid`, `DELETE /admin/users/:uid` | **none** | mutates |
| `POST /admin/users/:uid/reset-password` | **none** | **sends mail** (`reset-password-admin.ts:124`) |
| `GET /admin/roles` | **none** | read |
| `GET/POST/PUT/DELETE /admin/api-keys[/:id]` | **none** | mints and revokes credentials |
| `GET /admin/backups`, `GET /admin/backups/download` | **none** | streams a database dump |

All are behind `applyAdminGate` / `createRequireAuth` + `requireAdmin`. But
`apiKeyPreAuth` (`init.ts:980`) runs in front of `${basePath}/admin/*` for *every* caller
and does an un-limited DB lookup on any `rk_`-prefixed bearer token — see M5.

### `${basePath}/data` — `createDataRateLimiter(rateLimitConfig)` at `init.ts:1472`

One bucket per request, resolved most-specific first
(`rate-limiter.ts:303-316`): `api-key:<id>` at the key's own `rate_limit ?? 1000`;
else `user:<uid>` at 1000; else `ip:<addr>` at 300. Window 15m. Store shared with the
functions router (`init.ts:997-1004`). Applied at the router level, so it covers:

| Route | Cost |
|---|---|
| `GET /:slug`, `GET /:slug/count`, `GET /:slug/:id` | reads |
| `POST /:slug`, `PATCH|PUT /:slug/:id`, `DELETE /:slug/:id` | writes |
| `POST /:slug/bulk`, `PATCH /:slug/bulk`, `POST /:slug/bulk/delete` | **up to 1000 rows per single hit** (`api-generator.ts:59`, `:388`) |
| `GET|POST|PATCH|PUT|DELETE /:parent/:parentId/:rest{.+}` | subcollection CRUD |
| `GET /:slug/:id/history` | read |
| `POST /:slug/:id/history/:historyId/revert` | write |

Note the ordering: the auth middleware (`init.ts:1450`/`:1458`) runs **before** the
limiter, so token verification and the API-key DB lookup are paid on requests the limiter
then refuses.

### `${basePath}/functions` — `createDataRateLimiter({...rateLimitConfig, anonymous: 3000})` at `init.ts:1711`

Same buckets, anonymous raised to `DEFAULT_FUNCTIONS_ANONYMOUS_LIMIT = 3000`
(`rate-limiter.ts:269`), overridable via `rateLimit.anonymousFunctions`, `null` disables.
Covers `GET /` (the listing) and every user-defined function sub-app mounted at
`/{name}` — arbitrary user code, arbitrary cost, one hit per request.

### `${basePath}/storage` — **no limiter of any kind**

| Route | Limiter | Cost |
|---|---|---|
| `POST /upload` | **none** | S3/GCS `PutObject` + stored bytes. `bodyLimit` caps one request at `maxFileSize` (default 50 MB), not the rate |
| `GET /file/*` | **none** | S3 `GetObject` + **egress bytes**; anonymous when `storagePublicRead` |
| `GET /metadata/*` | **none** | `HeadObject`; mints scoped download tokens |
| `DELETE /file/*` | **none** | deletes objects |
| `GET /list` | **none** | `ListObjectsV2` |
| `POST /folder` | **none** | creates objects |
| `POST /tus`, `PATCH /tus/:id`, `DELETE /tus/:id` | **none** | resumable upload lifecycle |
| `GET /sources` | **none** | read |

Two adjacent mechanisms are *not* rate limiters but do bound something: `bodyLimit` on
`/upload` (`init.ts:1339`) caps a single request's size, and the image-transform path has
its own admission queue and 500-entry LRU (`storage/routes.ts:26-75`, `TransformOverloadedError`).
Neither bounds request rate. See H2.

### Remaining surfaces

| Surface | Limiter | Notes |
|---|---|---|
| `${basePath}/cron` — `GET /`, `GET /:id`, `GET /:id/logs`, `PUT /:id`, **`POST /:id/trigger`** | **none** | admin-gated; the trigger runs a job body on demand |
| `${basePath}/logs` — `GET /`, `GET /latest` | **none** | admin-gated |
| `${basePath}/schema-editor` — `POST /property/save|delete`, `POST /collection/save|delete` | **none** | admin-gated; **writes source files** |
| `${basePath}/meta/contract` | **none** | admin-gated |
| `${basePath}/meta/schema-version` | **none** | anonymous by design |
| `${basePath}/docs`, `/swagger` | **none** | anonymous |
| `/health`, `/livez` | **none** | `/health` touches the database |
| `/metrics` | **none** | token-gated when `REBASE_METRICS_TOKEN` is set |

### WebSocket — `server-postgres/src/websocket.ts:282-312`

| Frame class | Budget | Key | Window |
|---|---|---|---|
| `AUTHENTICATE` | **none** — handled at `:206` and `return`s at `:270`, before the counter | — | — |
| `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state`, `channel_history` | `WS_CHANNEL_RATE_LIMIT` = 7200 | **the socket** (`clientId`) | fixed 60 s, reset on first frame after expiry |
| everything else (queries, subscriptions, `EXECUTE_SQL`, branch ops) | `WS_RATE_LIMIT` = 2000 | **the socket** | fixed 60 s, same shape |

`server-mongo/src/websocket.ts:195-209` has the general budget only — no channel split
(L3). Neither file caps the number of sockets one peer may open.

---

## HIGH

### H1. The default is "believe `X-Forwarded-For`", and nothing in this repository ever declares a proxy

**`packages/server/src/auth/rate-limiter.ts:50-59`** (`resolveTrustedProxyHops`),
**`:148-168`** (`defaultKeyGenerator`).

```ts
return 1;                                    // :58 — the default when TRUSTED_PROXY_HOPS is unset
...
if (trustedProxyHops > 0) {                  // :152
    const forwardedFor = c.req.header("x-forwarded-for");
    ...
    const idx = Math.max(0, ips.length - trustedProxyHops);
    return ips[idx];                         // :158
}
```

`TRUSTED_PROXY_HOPS` occurs three times in the entire monorepo — `rate-limiter.ts:39`,
`:48`, `:54` — and all three are the declaration of the variable. No `.env` example, no
Helm/Kustomize manifest, no scaffold, no `boot/options.ts` line, no documentation page
sets it. `boot/boot.ts` never passes `trustedProxyHops` either. So every deployment runs
at `1`.

`1` is an *assertion that exactly one trusted reverse proxy is in front*. When that is
false, the entire header is the caller's, `ips.length - 1` is the last thing the caller
wrote, and the key is chosen by the client. The reasoning that got applied to `X-Real-IP`
— "with no proxy there, nothing writes it except the caller" (`:135-141`) — is verbatim
true of `X-Forwarded-For` at `trustedProxyHops: 1`; the correction stopped at the header
whose bug had been reported.

**Failure scenario.** A self-hosted `rebase-server` on a VM with a port open, or any
`rebase dev`:

```
for i in $(seq 1 100000); do
  curl -H "X-Forwarded-For: 10.0.$((i/256)).$((i%256))" \
       -d '{"email":"victim@example.com"}' https://host/api/auth/forgot-password
done
```

Each request is a fresh bucket, so `strictAuthLimiter` counts to one, forever. The same
one line defeats: login and registration (200/15m → unbounded, and registration mails
attacker-authored HTML per the unit-38 finding), `POST /auth/anonymous` (unbounded user
rows), the 300/window anonymous data bucket, and the 3000/window anonymous functions
bucket. It also defeats `verificationEmailLimiter`'s *fallback* branch
(`rate-limiter.ts:216`) though not its uid branch.

Secondary, in the opposite direction: a deployment that *is* behind a two-hop edge (GCLB
appends the client IP and its own; an ingress controller behind an LB is two) reads the
proxy's constant address at `hops: 1`, and every anonymous caller on earth shares one
300/window bucket — a self-DoS that looks like a working limiter. UNCONFIRMED which shape
`app.rebase.pro`'s ingress has; the point is that `1` is a guess either way.

**Fix direction.** Default to `0` — trust nothing, use `socketAddress()`, which is
unforgeable and available under `@hono/node-server`. Make declaring a proxy an explicit
act, log the resolved hop count once at boot next to the resolved source ("keying rate
limits on the socket address; set TRUSTED_PROXY_HOPS if a proxy is in front"), and set
`TRUSTED_PROXY_HOPS` in the managed runtime's manifest to whatever its edge actually
appends. Then pin the default itself: the existing tests all pass `trustedProxyHops`
explicitly (`test/rate-limiter.test.ts:135`), so the value a real deployment gets is the
one value never exercised.

### H2. Storage — upload, download and tus — has no rate limiter at all

**`packages/server/src/init.ts:1330-1352`** (the storage router: `apiKeyPreAuth`,
`createStorageApiKeyGuard`, `bodyLimit`, then `route("/")` — no limiter),
**`packages/server/src/storage/routes.ts:433, 475, 585, 633, 658, 697, 765-768`**.

This is the only surface where one HTTP request buys a metered third-party operation:
`PutObject`, `GetObject` and its egress bytes, `ListObjectsV2`. `readAuthMiddleware` is
`createMiddleware(!publicRead && requireAuth)` (`routes.ts:303`), so with
`storagePublicRead: true` — a documented, ordinary setting — `GET /file/*` is anonymous,
unauthenticated and unbounded.

**Failure scenario.** One machine loops `GET /api/storage/file/<a-large-public-object>`.
Every request is a full S3 `GetObject` and a full egress charge, with no ceiling and no
per-caller accounting; the bill arrives a month later. The authenticated variant is worse
per request: `POST /upload` at 50 MB a time writes stored bytes that keep costing after
the flood stops, and `DELETE /file/*` is unbounded object deletion inside whatever the
authorize hook allows. The tus endpoints multiply this — `POST /tus` then N `PATCH`es,
each an uncounted operation.

**Fix direction.** Mount `createDataRateLimiter` on the storage router, sharing the same
store as data and functions so a caller has one budget across the product (the comment at
`init.ts:993` already argues exactly this for the other two routers, and storage was
missed). Storage's cost profile is bytes rather than requests, so a second, coarser bound
on bytes-per-window per bucket is the honest control; the request limiter is the floor.

### H3. `forgot-password` and `magic-link` bound the caller, never the recipient

**`packages/server/src/auth/routes.ts:738`**,
**`packages/server/src/auth/magic-link-routes.ts:65`** — both `strictAuthLimiter` only.

The argument is already written down, in `rate-limiter.ts:191-208`:

> An IP limiter cannot express what is wanted here — the recipient is the quantity being
> protected, not the caller

That reasoning was applied to `POST /auth/send-verification` and to nothing else. Its two
siblings take the recipient address **straight from the request body** and mail it, with
only an IP bucket in front. This is class 17's second axis: the feature was applied at one
of the three call sites that need it, and the one it was applied to is the one where the
recipient is *hardest* for the attacker to choose (it requires holding a session).

**Failure scenario.** Without even reaching for H1: 50 requests per 15 minutes per IP is
4,800 password-reset emails a day at `victim@example.com` from a single source address,
and the route is designed to return `success: true` either way, so nothing anywhere
records that one address received them all. Two source IPs double it; with H1, one does.
The victim's mailbox provider learns to mark the sender's domain as abusive, which is
damage to the *deployment*, not only to the victim.

**Fix direction.** A `passwordResetEmailLimiter` and a `magicLinkEmailLimiter` keyed on a
hash of the normalized recipient address, mounted after the IP limiter exactly as
`send-verification` does it. Key on `sha256(lower(trim(email)))` rather than the raw
string so the bucket name is not itself an email address in a heap dump, and normalize —
otherwise `Victim@x.com` and `victim@x.com` are two buckets. The lookup must happen before
the `if (user)` branch, or the limiter becomes an oracle for which addresses exist.

---

## MEDIUM

### M1. `AUTHENTICATE` is the one frame an unauthenticated peer can send, and the one frame never counted

**`packages/server-postgres/src/websocket.ts:206-271`** (handled and `return`ed),
rate limiting at **`:282-312`** (after). Identical in
**`packages/server-mongo/src/websocket.ts:128-185`** vs **`:195-209`**.

Every `AUTHENTICATE` frame runs `authAdapter.verifyToken(token)` — for Clerk/Auth0-style
adapters an outbound HTTPS request per frame, billed and rate-limited by the provider —
or `extractUserFromToken`, an HMAC/RSA verification. Neither is counted, so a single
socket can issue them at line rate. The 401-equivalent (`AUTH_ERROR`) does not close the
socket, so there is no natural stop.

**Failure scenario.** Open one socket, stream `{"type":"AUTHENTICATE","payload":{"token":"…"}}`
as fast as the socket drains: CPU burn on JWT verification, or a flood of outbound
verification calls that trips the identity provider's own limit and takes down sign-in for
real users — a self-inflicted outage with no entry in this server's logs, because
`wsDebug` is off by default and the adapter's throw is swallowed at `:232`.

**Fix direction.** Count `AUTHENTICATE` against a small dedicated budget applied *before*
the type switch — a handful per socket per minute is generous, since a client authenticates
once and re-authenticates on token refresh. Close the socket after N failures rather than
replying forever.

### M2. Socket budgets are per socket, and nothing caps sockets

**`packages/server-postgres/src/websocket.ts:164-175`** — a fresh `ClientSession` with
fresh counters per connection; `new WebSocketServer({ server })` at `:135` with no
`maxPayload`, no connection cap, no per-peer accounting.

The budget is attached to the thing the caller creates for free. Ten sockets is 20,000
general frames and 72,000 channel frames a minute from one peer; a thousand sockets is a
thousand times the intended limit, plus a thousand `ClientSession` objects and a thousand
entries in `realtimeService`. Nothing in the socket path consults an IP at all.

Second, smaller defect in the same block: the window is **fixed, not sliding**
(`:291-294`, `:301-304`) — `if (now - windowStart > WINDOW) { count = 0; windowStart = now }`.
That is precisely the shape `rate-limit-store.ts:36-40` explains the HTTP store avoids:
spend the budget at the end of one window and again at the start of the next for 2× over
an instant. 4,000 general frames, or 14,400 channel frames, back to back.

**Fix direction.** Key the socket budget on the authenticated uid where there is one, and
on the connection's remote address otherwise, in a store shared across sockets — then a
second socket splits the budget instead of doubling it. Add a per-address concurrent
connection cap. Reuse `MemoryRateLimitStore`, which already does sliding windows correctly,
instead of a second hand-rolled counter that does not.

### M3. The store is per-pod, ships in one flavour, and the managed runtime configures none

**`packages/server/src/auth/rate-limit-store.ts:45`** (the only
`implements RateLimitStore` in the monorepo), **`packages/server/src/init.ts:1001-1002`**
(defaults to `new MemoryRateLimitStore(...)`), **`packages/server/src/boot/boot.ts`** —
`grep rateLimit boot/ init/` returns nothing, so the managed runtime never supplies a store.

The docblocks are admirably honest about this (`rate-limit-store.ts:5-9`,
`init.ts:264-268`). Honesty is not enforcement. On the managed runtime a limit of 300 is
`300 × pods`, and it changes silently whenever the deployment scales — including under the
load that triggers the scale-up, so the limit loosens exactly when it is needed. The
module-level `strictAuthLimiter` has the same property: 50 attempts per IP per pod.

Worse for the *strict* limiters, the effect compounds with H1: a spoofable key and a
per-pod count are independent multipliers on the same budget.

**Fix direction.** Ship a real shared store — Postgres is already there and a single
`INSERT … ON CONFLICT DO UPDATE … RETURNING` gives an atomic counter without a new
dependency (see class 19 for the shape). Wire it in `boot/boot.ts` when a database is
configured, and log the resolved store at boot so "per-replica" is a thing the operator
reads rather than infers. Until then, the docblock's advice belongs in the docs, not only
in the source (L6).

### M4. Password login has no per-account throttle; MFA verification does

**`packages/server/src/auth/routes.ts:456`** (`defaultAuthLimiter` only) versus
**`packages/server/src/auth/mfa-routes.ts:155-168`**, whose docblock states the rule:

> Keyed on the uid rather than the IP because an IP is the attacker's to rotate and the
> account under attack is not: a distributed run against one account passes an IP-keyed
> limiter untouched.

Login is the route that sentence describes. `grep -i lockout|failedAttempts|loginAttempts`
over `auth/` returns nothing but a comment in `auth-hooks.ts:149` suggesting the user
implement it themselves. A credential-stuffing run from 200 addresses gets 40,000 attempts
per 15 minutes against one account, and every one of them costs the server a password hash.

`POST /auth/change-password` (`routes.ts:843`) is the same shape with no limiter at all:
`ops.verifyPassword` on every call, unbounded, from any authenticated session.

**Fix direction.** A uid-keyed (or normalized-email-keyed, since the uid is not known
until the lookup) attempt limiter in front of `verifyPassword`, mounted the way
`mfaVerificationLimiter` is. Key on the hashed identifier so a failed-login bucket is not
a user-enumeration side channel, and count *failures* rather than requests so a busy
legitimate account is not locked out by its own success.

### M5. `rk_` pre-auth turns any unauthenticated request into a database query, on surfaces with no limiter

**`packages/server/src/init.ts:980`** (`config.app.use(`${basePath}/admin/*`, apiKeyPreAuth)`),
**`packages/server/src/auth/api-keys/api-key-middleware.ts:268-282`** →
**`:67-82`** (`store.findByKeyHash(hash)` before any validity check).

`createApiKeyPreAuth` runs for every request to `/api/admin/*` — a surface with no rate
limiter on any route — and any request whose bearer token starts with `rk_` reaches the
database. The key need not exist; the 401 is issued *after* the lookup.

**Failure scenario.** `curl -H 'Authorization: Bearer rk_<random>' https://host/api/admin/roles`
in a loop: one indexed SELECT per request, unauthenticated, unbounded, against the same
Postgres that serves the application. The same pre-auth is mounted on the storage router
(`init.ts:1335`) and on `/api/meta/contract` (`init.ts:1855`), both also unlimited.
`last_used_at` is debounced (`api-key-middleware.ts:142`) and only touched for valid keys,
so this is reads, not writes — which is why it is medium rather than high.

**Fix direction.** An IP-keyed limiter in front of the admin surfaces (they are admin-only;
a tight budget costs nobody anything), and consider a negative-result cache keyed on the
hash so a repeated bad key is answered from memory.

### M6. Internal control-plane calls share one caller bucket, and have no socket to key on

**`packages/server/src/init.ts:1504-1512`** — the server singleton's `fetch` is
`config.app.request(...)`, an in-process dispatch with no socket.
`socketAddress()` (`rate-limiter.ts:114-120`) calls `getConnInfo(c)`, which needs
`c.env.incoming`; on `app.request()` there is none, it throws, and the key falls to
`"unknown"`.

Two consequences, both real:

* On the IP-keyed auth limiters, every internal `rebase.auth.*` call lands in the single
  `"unknown"` bucket — 50 per 15 minutes across the whole process for anything on
  `strictAuthLimiter`. Under `@hono/node-server` genuine requests do carry conn info, so
  `"unknown"` is in practice the *internal* bucket; a boot sequence or a cron job that
  makes more than 50 such calls in a window self-429s.
* On `/api/data` and `/api/functions`, the service key resolves to `uid: "service"`
  (`auth/middleware.ts:150`, `:325`), which `isAnonymousUid` does not match, so internal
  traffic keys on `user:service` at the 1000/15m user budget — ~1.1 requests/second for
  everything the platform does on its own behalf. `rebase.data` is a native driver and
  bypasses HTTP, which is what keeps this from being routine; `rebase.functions.call` from
  a cron handler does not.

**Fix direction.** Give the trusted-server identity its own bucket or skip the limiter for
it — `resolveLimit` already has the `null` escape hatch documented at `rate-limiter.ts:29-33`
for exactly this ("not my bucket"). Then make `"unknown"` loud: a counter or a
once-per-minute warning, because a growing `"unknown"` bucket means either an internal
caller or a runtime with no conn info, and both are things an operator wants told.

---

## LOW

### L1. `Retry-After: NaN` whenever the effective limit is 0

**`packages/server/src/auth/rate-limit-store.ts:67-74`** — with `limit === 0`,
`timestamps.length >= limit` is true on the first hit while `timestamps` is empty, so
`timestamps[0]` is `undefined` and `Math.max(0, undefined + windowMs - now)` is `NaN`
(`Math.max` propagates NaN). **`rate-limiter.ts:90-92`** then emits
`Retry-After: NaN` and `X-RateLimit-Reset: NaN`.

Reachable via `rateLimit: { anonymous: 0 }` — `0` is a legal `number` for the field
(`rate-limiter.ts:249`) and means "refuse everyone", a thing an operator might reasonably
write — or via an `api_keys.rate_limit` of `0` set directly in the database, since
`key.rate_limit ?? apiKeyLimit` keeps a `0`. The HTTP routes validate `>= 1`
(`api-key-routes.ts:112`, `:184`); nothing else does. `test/rate-limiter.test.ts:113-126`
already drives `limit: 0` and asserts only the message, so the path is exercised and the
header unchecked.

**Fix direction.** `retryAfterMs: timestamps.length > 0 ? … : windowMs`. Then assert the
header in the `limit: 0` test — it is one line from where the class-9 fix already landed.

### L2. Eight raw readers of `x-forwarded-for`, none of which got the trusted-hops reasoning

`auth/routes.ts:423`, `:497`, `:660`, `:1110`; `auth/session-routes.ts:389`, `:462`;
`auth/mfa-routes.ts:345`, `:430`; `auth/magic-link-routes.ts:155` — all
`c.req.header("x-forwarded-for") || "unknown"`, the whole header string, commas and all.

These feed device-session records (shown to the user in `GET /auth/sessions` as "signed in
from"), MFA challenge rows, and the security audit log. The caller chooses the value
outright: a login can be recorded as originating from any address, of any length, which is
forensic evidence an attacker writes. `defaultKeyGenerator` is not exported, so no call
site *could* reuse the careful version even if its author wanted to.

**Fix direction.** Export a `resolveClientIp(c)` (the current `defaultKeyGenerator` body)
from `rate-limiter.ts`, route all nine readers through it, and cap the stored length. One
predicate, one implementation — class 2's fix shape.

### L3. The Mongo socket never got the channel budget

**`packages/server-mongo/src/websocket.ts:36-41, 195-209`** — one counter, 2000/min, no
`CHANNEL_MESSAGE_TYPES` set. If channel frames reach that server they starve the query
budget, which is the exact bug `WS_CHANNEL_RATE_LIMIT` was introduced to fix in its twin.
UNCONFIRMED whether the Mongo realtime provider serves channel frames at all; if it does
not, the divergence is still worth a comment saying so, because the next reader will
assume the two files agree.

### L4. The limiter counts requests; the cost per request is not bounded by it

One hit buys a `POST /:slug/bulk` of up to 1000 rows (`api-generator.ts:59`, `:388`), or a
50 MB upload, or an arbitrary user function. The 300/window anonymous bucket is therefore
also a 300,000-row-write/window bucket. This is a design property rather than a defect —
worth stating in the docs so nobody reads "300 requests" as "300 units of work".

### L5. Hop count is resolved at import time for the shared limiters and at request time inside one key generator

`createRateLimiter` calls `resolveTrustedProxyHops` once, at construction
(`rate-limiter.ts:67`), and `defaultAuthLimiter`/`strictAuthLimiter` are constructed at
module load — so they freeze `process.env.TRUSTED_PROXY_HOPS` as it stood when
`auth/rate-limiter.ts` was first imported. `verificationEmailLimiter`'s fallback calls
`defaultKeyGenerator(c)` with the parameter defaulted (`:216` → `:150`), which re-reads the
env **per request**. If anything loads `.env` after the first import of this module the two
disagree. Harmless today; it is the seam a future "configure hops from `rebase.json`" walks
into.

### L6. The numbers that are documented are right; most are not documented

Matches: API-key default 1000 (`website/src/content/docs/docs/backend/api.md:420` ↔
`rate-limiter.ts:243`), anonymous functions 3000
(`docs/backend/custom-functions.md:401` ↔ `rate-limiter.ts:269`), channel frames 7200
(`docs/backend/realtime.md:392` and `docs/channel-authorization.md:72` ↔
`websocket.ts:67`).

Undocumented anywhere a user will look: 200/15m (`defaultAuthLimiter`), 50/15m
(`strictAuthLimiter`, and that it is *one shared bucket* across ~15 routes), 5/15m
(verification email), 10/15m (MFA), 1000/15m (signed-in user), 300/15m (anonymous data),
2000/min (general socket frames), the 15-minute window itself, the `rateLimit` config block
as a whole (only `rateLimit.anonymousFunctions` is ever mentioned), `TRUSTED_PROXY_HOPS`
(mentioned nowhere at all), and the per-replica caveat. There is no 429 / `Retry-After` /
`X-RateLimit-*` contract page for client authors; the only mention of 429 in the docs is
the offline queue's retry list.

### L7. Unbounded key growth between sweeps, amplified by H1

`MemoryRateLimitStore` (`rate-limit-store.ts:46`) is a `Map` swept every `sweepMs`
(15 minutes by default). Keys are unvalidated caller-supplied strings under H1 — arbitrary
length up to Node's header cap, one Map entry each. A spoofing flood therefore also grows
the heap for up to a full sweep interval. Fixing H1 mostly fixes this; a key-count ceiling
with oldest-first eviction would fix it independently.

---

## Checked and clean

* **`MemoryRateLimitStore` is a genuine sliding window.** `timestamps.filter(t => now - t < windowMs)`
  on every read (`rate-limit-store.ts:65`); the boundary-riding double-spend the docblock
  describes is not available on the HTTP path. `retryAfterMs` correctly names the moment
  the *oldest* hit leaves the window. Injectable `now` means the window is tested without
  sleeping.
* **The X-Real-IP defect the audit map names is fixed and pinned.** `rate-limiter.ts:152`
  gates both headers on `trustedProxyHops > 0`;
  `test/rate-limiter.test.ts:157-200` covers `X-Forwarded-For`, `X-Real-IP`, and both
  together at `hops: 0`, and the test that used to assert the wrong behaviour carries a
  comment saying so. (The residue is the *default*, H1 — not this fix.)
* **`X-Forwarded-For` parsing is right-anchored, not left.** `ips[ips.length - trustedProxyHops]`
  with a `Math.max(0, …)` floor, so a short header cannot index negatively and a
  client-prepended entry is never selected at the declared hop count.
* **Bucket resolution is most-specific-first and total.** `createDataRateLimiter`'s
  `keyGenerator` and `resolveLimit` branch identically (`:303-316`), so key and limit can
  never come from different principals — the drift this shape usually has.
* **Anonymous uids do not get the signed-in budget.** `isAnonymousUid(user.uid)` is
  checked in both the key generator and the limit resolver (`:307`, `:314`), so a
  throwaway anonymous session falls to the IP bucket rather than being handed 1000.
* **`resolveLimit`'s `null` means "skip", `undefined` means "default", and `0` is
  preserved.** `effectiveLimit === null` short-circuits before `?? limit`
  (`rate-limiter.ts:81-82`), which is the one ordering that makes all three distinguishable.
  Pinned by `test/api-key-permissions-fixes.test.ts:504`.
* **One store across the data and functions routers.** `init.ts:993-1004` builds it once
  and both routers receive it, so a caller has one budget rather than two — the comment
  states the reasoning and the code matches it.
* **The limiter is no longer gated on `apiKeyStore`.** `init.ts:1471` mounts on
  `rateLimitConfig` alone; a deployment with no API keys is still limited.
* **`Retry-After` is emitted only on refusal.** `test/rate-limiter.test.ts:74-83` asserts
  the negative, which is the half that a header set unconditionally would have passed.
* **The store fails closed.** `await store.hit(...)` is unguarded (`rate-limiter.ts:84`),
  so a throwing custom store propagates to `errorHandler` and the request gets a 500 —
  it does not pass. Undocumented and untested, but the behaviour is the safe one.
* **`api_keys.rate_limit` is validated on both write paths** — positive integer or null,
  `api-key-routes.ts:111-113` and `:183-185`.
* **MFA challenges have a second, non-rate-limit bound.** `MAX_CHALLENGE_ATTEMPTS = 5`
  recorded atomically per challenge row (`mfa-routes.ts:387-410`), so exhausting the
  10/15m uid limiter is not the only thing standing between an attacker and a TOTP code.
* **The channel budget's number is derived, documented, and matches.** 7200 in code,
  7200 in `docs/backend/realtime.md:392`, and `docs/channel-authorization.md:72-74` says
  out loud that it is sized to a documented workload rather than chosen as a product limit.
* **`mfaVerificationLimiter`'s key cannot be chosen by the caller.** `resolveStepUpPrincipal`
  takes the uid only from a verified access token or a verified MFA-pending token
  (`mfa-routes.ts:138`, `:145`); an unverifiable token falls to the shared
  `"unidentified"` bucket, which is the fail-closed direction.
* **Bulk writes are capped per request** at `DEFAULT_MAX_BULK_ROWS = 1000`
  (`api-generator.ts:59`), so one hit is bounded even though it is not bounded *well* (L4).

---

## Open questions

1. **What does the managed runtime's edge actually append to `X-Forwarded-For`?** The
   correct `TRUSTED_PROXY_HOPS` for `app.rebase.pro` and for `*.apps.rebase.pro` is a fact
   about the GKE ingress, and H1's second failure mode (everyone in one bucket) turns on it.
   Someone should read one real request's headers in each tier and then *set* the variable
   rather than leaving it at the guess.
2. **Is the `saas` control plane rate-limited at all?** `grep` for
   `createRateLimiter|createDataRateLimiter|RateLimitStore` outside `packages/server/src`
   returns only tests. If `saas/backend` mounts its own Hono app without these, its signup,
   billing and deploy routes have no limiter — out of this unit's scope, but it is the
   surface where a request provisions a pod.
3. **Should `strictAuthLimiter` really be one bucket across MFA and password reset?**
   Fifteen routes sharing 50/15m per IP means a user who fumbles their TOTP code six times
   has spent an eighth of the budget that also has to cover their password reset. Splitting
   it per concern costs nothing and removes a cross-route denial.
4. **Does the Mongo realtime provider serve channel frames?** Decides whether L3 is a bug
   or a comment.
5. **What is the intended behaviour when a shared store is unavailable?** Once a Postgres
   or Redis store exists, "the store is down" becomes a live state, and today's implicit
   500 is a choice nobody has made deliberately. The `RateLimitStore` interface should say
   which way it fails, and a test should hold it there.
6. **Is `rateLimit: { enabled: false }` ever set in the wild?** It disables the data *and*
   functions limiters in one move (`init.ts:997`), including the anonymous functions
   bucket, which is the one that faces the internet. A separate `anonymous`-only opt-out
   may be what operators behind a CDN actually want.
