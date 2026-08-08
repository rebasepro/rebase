# Unit 20 — MFA (TOTP, recovery codes, aal1→aal2)

Read-only security audit. Files read: `packages/server/src/auth/mfa.ts`,
`mfa-crypto.ts`, `mfa-routes.ts`, `routes.ts`, `session-routes.ts`,
`magic-link-routes.ts`, `middleware.ts`, `require-auth.ts`, `jwt.ts`,
`rate-limiter.ts`, `builtin-auth-adapter.ts`, `admin-user-ops.ts`,
`interfaces.ts`; `packages/server-postgres/src/auth/services.ts` (MfaService),
`ensure-tables.ts`; `packages/server-mongo/src/auth/services.ts`;
`packages/common/src/util/internal-tables.ts`; `packages/server/test/mfa.test.ts`,
`packages/server/test/auth-routes.test.ts`.

## Verdict

The TOTP primitives are correct and carefully tested — RFC 4226/4648 vectors, a
CSPRNG secret of the recommended 20 bytes, AES-256-GCM at rest, an atomic
single-use recovery-code claim, an expiry- and reuse-checked challenge row, and
a privilege boundary that keeps `rebase_user` out of `mfa_factors` entirely. The
problem is not in the crypto; it is that **nothing consumes it**. Grepping `aal`
across the whole server yields five writes and exactly one read — the `aal2`
check on `DELETE /auth/mfa/unenroll` (`mfa-routes.ts:296`). Every route that
mints a session — password login, register, all OAuth providers, magic link,
anonymous, anonymous-link, refresh — issues a full `aal1` access token and
refresh token with no reference to whether the account has a verified factor, and
no route anywhere in the framework, the admin surface or the SaaS control plane
requires `aal2`. A user who enrols TOTP gets a QR code, a set of recovery codes,
and no change whatsoever to what a stolen password buys. On top of that the one
gate that does read `aal` is self-service: an `aal1` session can enrol its own
factor, verify it with a code it computes itself, step up to `aal2`, and then
unenrol the victim's real factor — all without re-entering a password. The
verification endpoints carry no rate limiter of any kind and no replay marking,
so even if enforcement were added today a 6-digit code with a ±1 step window
would be brute-forceable at line rate. Recovery codes are 40 bits behind a single
unsalted SHA-256, which is a few GPU-hours from a database or backup leak.

Severity counts: **1 critical, 3 high, 5 medium, 5 low.**

---

## CRITICAL

### C1. No session-minting route enforces the second factor; `aal2` is read exactly once in the codebase

**Where the sessions are minted (all `aal1`, unconditionally):**

- `packages/server/src/auth/routes.ts:278-294` — `createSessionAndTokens()`, the
  shared helper. `generateAccessToken(uid, roleIds, "aal1", customClaims)`.
- `packages/server/src/auth/routes.ts:465` — `POST /auth/login` (password).
- `packages/server/src/auth/routes.ts:391` — `POST /auth/register`.
- `packages/server/src/auth/routes.ts:574` — every OAuth provider callback.
- `packages/server/src/auth/routes.ts:994` — `POST /auth/refresh`, hardcoded
  `"aal1"`.
- `packages/server/src/auth/session-routes.ts:386` — `POST /auth/anonymous`.
- `packages/server/src/auth/session-routes.ts:459` — `POST /auth/anonymous/link`.
- `packages/server/src/auth/magic-link-routes.ts:151` — `POST /auth/magic-link/verify`.

**Where `aal` is read:** `packages/server/src/auth/mfa-routes.ts:296` — and
nowhere else. `grep -rn "aal" packages/server/src` returns writes at
`routes.ts:289,294,990,994`, `jwt.ts:112,122,197`, `mfa-routes.ts:226`, and that
single consumer. `packages/admin/src`, `packages/client/src` and `saas/backend/src`
contain no occurrence of `mfa`, `totp` or `aal2` at all.

**What's wrong.** MFA is modelled as an *optional step-up* that no resource
requires, rather than a *gate* on session issuance. `POST /auth/login` never
calls `hasVerifiedMfaFactors()` (its only caller in the repo is the unenroll
cleanup at `mfa-routes.ts:317`); it never returns an `MFA_REQUIRED` challenge;
and the token it hands back is byte-for-byte the token a user without MFA gets.
The MFA endpoints are reachable only *after* `requireAuth` has already accepted a
full session, so the challenge flow is a thing you may optionally do with a
session you already hold.

**Failure scenario.** An attacker phishes or credential-stuffs a password for an
account that has TOTP enrolled and verified. `POST /auth/login` returns
`{ user, tokens: { accessToken, refreshToken } }`. That access token authenticates
every `/api/data`, `/api/storage`, `/api/functions` and admin route the user's
roles allow — RLS binds on `uid`, not on `aal`. The refresh token keeps the
session alive indefinitely. The victim's second factor is never consulted, never
prompted, and produces no signal. The account's MFA enrolment reduced the
attacker's cost by zero.

**Fix direction.** Make session issuance conditional. In
`createSessionAndTokens()` (or a wrapper the login/OAuth/magic-link paths share),
consult `authRepo.hasVerifiedMfaFactors(uid)`; when true, return an
`MFA_REQUIRED` response carrying a short-lived, purpose-scoped pre-auth token
(`generateDownloadToken`-style `purpose` claim — `verifyAccessToken` already
refuses purpose-scoped tokens as sessions, `jwt.ts:187-190`) plus the factor
list, and mint the real session only from `POST /auth/mfa/challenge/verify`.
`POST /auth/refresh` must carry the presented session's `aal` forward rather than
hardcoding `aal1`, which means persisting `aal` on the refresh-token row. Pin it
with a test that a login for an MFA-enrolled user cannot reach `/api/data` — the
property, not a spy on a neighbouring call (bug class 8).

---

## HIGH

### H1. The `aal2` gate on unenroll is self-service: an `aal1` session can enrol, verify and step up on its own factor, then delete the victim's

**Path:** `packages/server/src/auth/mfa-routes.ts:47` (`POST /mfa/enroll`,
`requireAuth` only), `:102` (`POST /mfa/verify`, `requireAuth` only), `:146`
(`POST /mfa/challenge`), `:181` (`POST /mfa/challenge/verify`), `:289`
(`DELETE /mfa/unenroll`, the `aal2` check at `:296`).

**What's wrong.** `POST /mfa/enroll` requires no `aal2`, no password
re-entry, and no rate limit; it returns the plaintext Base32 secret in the
response body (`:88`). `POST /mfa/verify` also requires no `aal2` — so the caller
verifies the factor it just created using a code it computes from the secret it
was just handed. `POST /mfa/challenge` accepts any *verified* factor owned by the
caller, and `challenge/verify` mints `aal2` (`:226`). Nothing constrains a user to
one factor, and nothing requires the *existing* factor to be the one that
authorises adding another.

**Failure scenario.** Attacker holds a stolen password (or, more cheaply given C1,
any live `aal1` session — an XSS-lifted access token, a shared machine).
1. `POST /auth/mfa/enroll` → attacker's own secret + 10 fresh recovery codes,
   and the victim's existing recovery codes are destroyed (see M1).
2. `POST /auth/mfa/verify` with a code derived from that secret → `verified=true`.
3. `POST /auth/mfa/challenge` on the attacker's factor → challengeId.
4. `POST /auth/mfa/challenge/verify` → `aal2` access token + a brand-new refresh
   token in a new session.
5. `DELETE /auth/mfa/unenroll` on the *victim's* factorId → the real second
   factor is gone, and `hasVerifiedMfaFactors` is still true (the attacker's
   factor remains), so the recovery-code cleanup at `:317` does not even fire.

The account now has exactly one second factor and the attacker owns it. The
comment at `:295` — "Require aal2 … Please re-authenticate with your second
factor" — describes a control that the enrolment pair defeats.

**Fix direction.** Enrolling a factor on an account that *already has a verified
factor* must itself require `aal2` (or a fresh password re-entry), the same rule
unenroll applies. Confirming enrolment (`/mfa/verify`) belongs behind the same
check. Consider a hard cap on verified factors and an out-of-band notification on
every enrol/unenrol.

### H2. No rate limiting on any MFA verification endpoint, and the challenge records no attempt count

**Path:** `packages/server/src/auth/mfa-routes.ts:47,102,146,181,289` — each is
`router.post(path, requireAuth, handler)`. Compare `routes.ts:320,427,495`
(`defaultAuthLimiter`, 200/15min) and `routes.ts:655,713`,
`magic-link-routes.ts:64,124` (`strictAuthLimiter`, 50/15min). The `/auth` router
is mounted at `init.ts:1058` with no router-level limiter, and
`createDataRateLimiter` is applied only to `/data` (`init.ts:1428`) and
`/functions` (`:1651`). `MfaService.getMfaChallengeById`
(`packages/server-postgres/src/auth/services.ts:1422-1428`) selects on
`expires_at > NOW() AND verified_at IS NULL`; the row has no attempt column, and
`verifyMfaChallenge` is called only on success (`mfa-routes.ts:221`).

**What's wrong.** A 6-digit code with `window = 1` accepts 3 of 1,000,000 values
per attempt. With no limiter, no lockout and no per-challenge attempt cap, the
expected work to guess is ~333,000 requests — and a challenge stays open for its
full 5 minutes across unlimited failures, with unlimited challenges available.

**Failure scenario.** Attacker holds a password for an MFA-enrolled account (in a
world where C1 is fixed and MFA actually gates login). They script
`POST /auth/mfa/challenge/verify` against one challenge. At a few hundred
requests/second against a single replica, the second factor falls in hours; a
distributed run makes it minutes. Nothing throttles, nothing locks the account,
and the only trace is 333,000 identical 401s. Note also that the framework's
limiters are IP-keyed (`rate-limiter.ts:148-167`), so an account-scoped counter
is the right key here regardless — an IP-keyed limiter alone is rotatable.

**Fix direction.** Two limiters, not one: a `strictAuthLimiter`-grade IP limiter
on `/mfa/verify` and `/mfa/challenge/verify`, *and* a counter keyed on `uid` (a
value the attacker cannot rotate) that locks the factor after ~5–10 consecutive
failures. Add `attempts` to `mfa_challenges` and refuse the challenge past a
small bound. `resolveLimit` on `createRateLimiter` already supports a per-request
allowance.

### H3. A used TOTP code is never marked used — replayable for the rest of the ±1 window

**Path:** `packages/server/src/auth/mfa.ts:103-112` (`verifyTotp`, window
default 1), `mfa-routes.ts:127` and `:208` (both call sites), `:221`
(`verifyMfaChallenge` marks the *challenge* consumed, not the code).

**What's wrong.** RFC 6238 §5.2 requires that an accepted OTP not be accepted a
second time. Nothing here records the counter step that succeeded, so the same
6 digits are valid for up to 90 seconds (previous, current and next step) across
an unlimited number of fresh challenges. `verifyMfaChallenge` prevents replaying
the *challenge id*, which is a different object — opening a new challenge is one
unauthenticated-by-second-factor request away.

**Failure scenario.** An attacker who observes one code — a phishing proxy that
relays it, a shoulder-surf, a malicious authenticator-app clipboard read, a
logged support-chat message — replays it within the window: `POST /mfa/challenge`
then `POST /mfa/challenge/verify` with the same digits. Because `challenge/verify`
mints a *new refresh token* (`mfa-routes.ts:232-239`), the replay buys a durable
session, not a momentary one. Real-time-phishing kits are built precisely around
this window.

**Fix direction.** Persist the last accepted counter step per factor (a
`last_used_counter BIGINT` on `mfa_factors`) and refuse any token whose matching
step is `<=` it. Have `verifyTotp` return the matched counter rather than a
boolean so the caller can enforce it.

---

## MEDIUM

### M1. Enrolment destroys the account's existing recovery codes before anything is verified

**Path:** `packages/server/src/auth/mfa-routes.ts:76-78` (enroll generates 10
codes and calls `createRecoveryCodes` unconditionally);
`packages/server-postgres/src/auth/services.ts:1451-1456` —
`createRecoveryCodes` opens with `DELETE FROM recovery_codes WHERE uid = $1`.

**What's wrong.** `POST /auth/mfa/enroll` needs only `aal1`, has no rate limit,
and its very first side effect is to wipe every recovery code the account holds —
including for a factor the caller never verifies and then abandons. The
destructive write happens before any proof that the caller controls the new
factor, and before any proof that the caller is more than a password-holder.

**Failure scenario.** Attacker with a stolen password (or a stolen `aal1` token)
issues one `POST /auth/mfa/enroll` and walks away. The victim's ten printed
recovery codes are now dead rows; the codes returned in the response belong to
the attacker. If the victim later loses their phone, there is no recovery path at
all (see M4) — a one-request permanent account lockout. Repeated in a loop it is
also unbounded row churn: each call inserts a factor row and ten code rows with
ten separate round-trips.

**Fix direction.** Separate factor enrolment from recovery-code issuance. Generate
codes only when a factor transitions to `verified`, or expose a distinct
`POST /auth/mfa/recovery-codes/regenerate` that requires `aal2`. Cap factors per
user. Rate-limit `/mfa/enroll`.

### M2. Recovery codes are 40 bits behind a single unsalted SHA-256

**Path:** `packages/server/src/auth/mfa.ts:148-154` (`randomBytes(5)` → 10 hex
chars, formatted `XXXXX-XXXXX`), `:159-161` (`createHash("sha256")` of the
dash-stripped uppercase code, no salt, no iteration).

**What's wrong.** 2^40 ≈ 1.1×10^12 candidates over a 16-character alphabet, and
the hash is one SHA-256 with no per-row salt — the canonical GPU-friendly case.
The exact format (`/^[A-F0-9]{5}-[A-F0-9]{5}$/`, pinned by `mfa.test.ts:197`)
tells an attacker the keyspace exactly, and the ten rows for one user can be
cracked in a single pass because they share no salt. These codes are full MFA
bypasses — `challenge/verify` accepts one in place of a TOTP (`mfa-routes.ts:211-214`).

**Failure scenario.** A database backup leaks, or any read reaches
`rebase.recovery_codes` (the `REVOKE` in `internal-tables.ts:74-76` closes the
`rebase_user` role, but not a `pg_dump`, a replica, a platform admin, or SQL
injection through an owner connection). A commodity GPU exhausts 2^40 SHA-256 in
hours and recovers every unused code for every user — a permanent second-factor
bypass for the whole tenant, invisible until used.

**Fix direction.** Raise the code to at least 80 bits (`randomBytes(10)`, base32
with an unambiguous alphabet) *and* store it under a slow salted KDF — the repo
already has a password hasher (`auth/password.ts`) that is the right shape. A
recovery code is a password, not a token identifier; it should not be hashed like
one.

### M3. The TOTP secret is encrypted with `SHA-256(JWT_SECRET)` by default, with no key id and no rotation story

**Path:** `packages/server/src/auth/mfa-crypto.ts:24-42` (`resolveKeyString`:
`MFA_ENCRYPTION_KEY`, else `JWT_SECRET` with a `logger.warn`, else throw),
`:47-49` (`deriveKey` = one unsalted SHA-256 of the raw string), `:65`
(ciphertext = `iv:authTag:ciphertext`, no key version).

**What's wrong.** Three distinct problems stacked:
- **Key reuse across purposes.** By default the AES key that unwraps every TOTP
  secret is derived from the *JWT signing secret* — the value the scaffold puts in
  `.env` (`packages/cli/templates/template/.env.example:52`), passes into Docker
  Compose (`docker-compose.yml:80`) and hands to every backend replica. One
  disclosure of the signing key (which also mints arbitrary sessions) additionally
  decrypts every second factor into a cloneable authenticator.
- **No KDF.** A single SHA-256 of a possibly low-entropy operator-chosen string,
  no salt, no iterations.
- **No key id, so rotation is a silent brick.** The ciphertext carries no version.
  Setting `MFA_ENCRYPTION_KEY` on a deployment that had been falling back to
  `JWT_SECRET` — which is literally what the warning at `:32-35` instructs — makes
  every stored secret undecryptable. `decryptTotpSecret` throws from
  `mfa-routes.ts:125` and `:206`, so `/mfa/verify` and `/mfa/challenge/verify`
  return 500 forever for every enrolled user, with no migration path. This is bug
  class 5: remediation text whose command produces the failure.
- `MFA_ENCRYPTION_KEY` appears in **no** `.env.example`, doc page, `rebase doctor`
  check or env validator — the only occurrences in the repo are inside
  `mfa-crypto.ts` itself. There is also no test file for this module.

**Failure scenario.** An operator reads the boot warning, sets
`MFA_ENCRYPTION_KEY`, redeploys, and every MFA user is locked out of step-up at
once with an opaque 500. Or: a `JWT_SECRET` leaks through a log, a client bundle
or a repo commit, and the attacker gains not just session forgery but a permanent
clone of every second factor — the thing MFA exists to make independent of the
password/session channel.

**Fix direction.** Require a dedicated key, derived with a real KDF (scrypt/HKDF
with a salt), refuse the `JWT_SECRET` fallback in production the way
`ENCRYPTION_KEY` is already made mandatory on the SaaS side. Prefix the ciphertext
with a key id (`v1:iv:tag:ct`) and support decrypting under a previous key so
rotation re-wraps rather than bricks. Document the variable and add a boot check.

### M4. Recovery codes cannot be regenerated, exhaustion has no path out, and the one function that could warn is read by nothing

**Path:** `packages/server/src/auth/interfaces.ts:562`
(`getUnusedRecoveryCodeCount`), implemented at
`packages/server-postgres/src/auth/services.ts:1479-1487` and
`packages/server-mongo/src/auth/services.ts:806-808`. Its only callers in the
repo are its own tests (`packages/server-postgres/test/mfa-service.test.ts:556,566`).
No route exposes it, no response mentions remaining codes, and there is no
regenerate endpoint — the only writer of recovery codes is `POST /mfa/enroll`
(`mfa-routes.ts:78`).

**What's wrong.** Bug class 21: a declared capability nothing reads. Users are
never told how many codes remain; when the tenth is consumed the account has zero
recovery material and the only way to obtain more is to enrol *another* factor,
which requires already holding one (or a password, per H1). There is no
admin-side MFA reset anywhere — `admin-user-ops.ts` and `admin-users-route.ts`
contain no MFA reference at all, and `reset-password-admin.ts` resets the
password without touching factors.

**Failure scenario.** A user loses their phone and burns through their codes. No
route regenerates them, no admin can clear the factor, and `DELETE /mfa/unenroll`
requires the `aal2` they cannot obtain. Given C1 the account is still usable
(password alone works), which is the only reason this is not a hard lockout — the
moment C1 is fixed, this becomes one.

**Fix direction.** Return `remaining` from `challenge/verify` and `GET /mfa/factors`,
warn below a threshold, add an `aal2`-gated regenerate endpoint, and add a
deliberate, audited admin MFA-reset that requires admin re-authentication.

### M5. The Mongo driver stubs MFA to "no factors, no codes" and throws on enrolment

**Path:** `packages/server-mongo/src/auth/services.ts:775-814` —
`createMfaFactor`/`verifyMfaFactor`/`createMfaChallenge`/`createRecoveryCodes`
throw `"MFA is not implemented for MongoDB"`; `getMfaFactors` returns `[]`,
`getMfaFactorById` and `getMfaChallengeById` return `null`, `useRecoveryCode`
returns `false`, `getUnusedRecoveryCodeCount` returns `0`, `deleteAllRecoveryCodes`
is a no-op, and **`hasVerifiedMfaFactors` returns `false`**.

**What's wrong.** The MFA router is mounted unconditionally
(`routes.ts:1081`), so a Mongo-backed project advertises five working MFA
endpoints that 500 on the first one. More importantly, `hasVerifiedMfaFactors`
returning a hardcoded `false` is a zero-state that *grants*: it is the exact
predicate any future login gate would consult, and on Mongo it will always answer
"this account has no second factor" — bug class 1/10. Whoever fixes C1 will fix it
on Postgres and silently open a hole on Mongo.

**Fix direction.** Either implement it or refuse it loudly: do not mount
`mountMfaRoutes` when the repository declares no MFA support, and make
`hasVerifiedMfaFactors` throw rather than answer `false` on a driver that cannot
know. A capability flag on the auth adapter, checked at both the mount site and
the (future) login gate, is the class-2 fix shape.

---

## LOW

### L1. Stepping up to `aal2` does not retire the `aal1` session, and refresh downgrades to `aal1`

`mfa-routes.ts:232-239` creates a *new* refresh token in a *new* session and
returns a new access token, but never revokes the session the caller arrived on —
so the pre-MFA credential stays live for its full refresh lifetime.
`routes.ts:994` then hardcodes `"aal1"` on refresh, so the `aal2` claim survives
at most one access-token lifetime (default `1h`, `jwt.ts:136`) and cannot be
carried across a reload. Together: `aal2` is short-lived, non-durable and does not
displace the weaker credential it was supposed to strengthen.

### L2. `customizeAccessToken` can override `aal`

`jwt.ts:119-124` spreads `customClaims` **after** `aal`, and
`routes.ts:285-292` hands the hook a `defaultClaims` object that already contains
`aal: "aal1"`. A hook that echoes its input back with `aal: "aal2"` — or that
merges a user-controlled profile object — mints an MFA-verified token without any
factor. Set `aal` after the spread, or strip reserved claims from hook output.

### L3. The challenge's recorded IP is raw, spoofable `x-forwarded-for`

`mfa-routes.ts:167` (`c.req.header("x-forwarded-for") || "unknown"`), and again
at `:237` for the refresh-token row. `rate-limiter.ts:148-167` documents at length
why this header must be read with a trusted-hop count and does so; the MFA and
session-creation paths take the leftmost client-supplied value verbatim. The
result is an audit/device record an attacker chooses, and a `sessions` list the
victim cannot use to spot the intrusion. Route both through the same hop-aware
resolver.

### L4. No cap on factors, and enrolment writes 11 rows per call with 11 round-trips

`mfa-routes.ts:68-78` plus `services.ts:1459-1464` (a per-code `INSERT` in a
loop, not a multi-row insert, and not in a transaction — a crash between the
`DELETE` and the last `INSERT` leaves the account with fewer codes than it was
shown). Unauthenticated-by-second-factor and unthrottled, this is cheap row churn.

### L5. `base32Decode` skips invalid characters instead of rejecting

`mfa.ts:48-50` — `if (index === -1) continue;`. Not currently reachable with
attacker input (the only decoded value is a secret this server generated), but it
means a corrupted or truncated ciphertext decodes to *some* buffer rather than
failing, so a key/storage fault surfaces as "your code is wrong" rather than as an
error. Reject on an out-of-alphabet character.

---

## Checked and clean

- **TOTP/HOTP correctness.** `generateHotp` (`mfa.ts:69-85`) implements RFC 4226
  dynamic truncation correctly (`& 0x0f` offset, `& 0x7f` on the high byte,
  `% 1000000`, zero-padded). `mfa.test.ts` pins RFC 4648 base32 vectors, a
  genuinely short code (`003784`), and — the good one — a window test that
  asserts a neighbouring step is accepted with `window=1` and *refused* with
  `window=0`, plus an explicit non-vacuity check that the three codes differ
  (`mfa.test.ts:105-144`). That is the class-6/class-8 fix shape done right.
- **Secret generation.** `randomBytes(20)` — CSPRNG, 160 bits, the RFC 4226
  recommendation (`mfa.ts:128`). Unique per call, asserted.
- **Encryption at rest.** AES-256-GCM with a fresh 12-byte random IV per call and
  an authenticated 16-byte tag (`mfa-crypto.ts:57-66`); the tag is set before
  `final()` on decrypt, so tampering throws. The scheme itself is sound — the
  problems are key management (M3), not the construction.
- **Recovery-code single use.** `UPDATE … WHERE uid = $1 AND code_hash = $2 AND
  used_at IS NULL RETURNING id` (`services.ts:1467-1477`) — one statement,
  claim-and-act, no check-then-act race (bug class 19).
- **Challenge validity.** `getMfaChallengeById` filters `expires_at > NOW() AND
  verified_at IS NULL` in SQL (`services.ts:1422-1428`), so an expired or
  already-used challenge is simply not found. 5-minute TTL set server-side
  (`:1405`).
- **Factor ownership.** All four routes that take a `factorId` compare
  `factor.uid !== userCtx.uid` and 404 (`mfa-routes.ts:116,159,201,310`), and
  `deleteMfaFactor` re-scopes on `uid` in the `WHERE` clause
  (`services.ts:1394-1399`) rather than trusting the route. `auth-routes.test.ts:1466-1526`
  tests the challenge ownership check with positive *and* negative cases and
  asserts no challenge row is minted on refusal — and its docblock records that
  inverting `!==` to `===` used to leave the suite green.
- **Table-level privilege boundary.** `mfa_factors`, `mfa_challenges` and
  `recovery_codes` are in `REBASE_INTERNAL_TABLES`
  (`packages/common/src/util/internal-tables.ts:74-76`), so `REVOKE ALL … FROM
  rebase_user` runs on them and `pnpm rls:check` fails if one is added without a
  revoke. All three cascade on user delete (`ensure-tables.ts:727,747,769`).
- **`aal` parsing fails closed.** `verifyAccessToken` (`jwt.ts:197`) coerces any
  missing or unrecognised `aal` to `"aal1"` — the restrictive value — and refuses
  purpose-scoped tokens outright (`:187-190`).
- **No admin or service bypass of the unenroll gate.** `mfa-routes.ts` imports the
  plain `requireAuth` (JWT-only); the `/auth` router is mounted without
  `apiKeyPreAuth` (`init.ts:1058` vs `:946,1121,1300,1780`), and the service-key
  contexts (`middleware.ts:150,324`; `builtin-auth-adapter.ts:134-141`) carry no
  `aal`, so they fall to `"aal1"` and are refused by `:296`. No impersonation
  route exists — `generateAccessToken` has exactly three call sites repo-wide.
- **No MFA state reachable through admin user ops.** `admin-user-ops.ts` and
  `admin-users-route.ts` contain no MFA reference; there is no admin path that
  clears a factor. (That is also M4's problem, from the other direction.)
- **`POST /auth/reset-password`** (`routes.ts:713-753`) does not mint a session —
  it updates the password, deletes every refresh token and sets the
  `tokens_valid_after` watermark. So password reset is not itself a session-minting
  bypass; it is only an MFA bypass by way of C1 (reset → log in → full access).

---

## Open questions

1. **Is MFA meant to gate login, or to gate specific operations?** The code
   supports neither today. If the intent is operation-level step-up (the Supabase
   model), then the missing piece is a `requireAal2` middleware and a documented
   way for a collection or route to demand it — and the audit finding is "the
   mechanism ships with zero consumers". If the intent is login-level (the usual
   expectation, and what `ArchitectureDiagram.tsx:151`'s "TOTP multi-factor
   authentication with recovery codes" tag implies to a reader), C1 is the whole
   feature. This choice determines the shape of every other fix.
2. **Is there any client-side MFA support planned?** `packages/client/src` and
   `packages/admin/src` contain no `mfa`/`totp` occurrence, so today no shipped UI
   or SDK method can drive enrolment or challenge — the endpoints are reachable
   only by hand-rolled fetch. Worth confirming whether the feature is considered
   released.
3. **What is the migration plan for already-stored TOTP secrets** if M3 is fixed?
   Existing ciphertexts have no key id, so a versioned scheme needs a
   "try v1-unversioned, re-wrap as v2" read path for one release.
4. **Should `mfa_challenges` be pruned?** Rows are inserted per challenge and never
   deleted; nothing in `ensure-tables.ts` or the cron surface reaps expired ones.
   Combined with H2's unlimited challenge creation, this is unbounded growth on an
   unauthenticated-by-second-factor endpoint.
5. **Does any deployment currently rely on the `JWT_SECRET` fallback?** If so, the
   fix for M3 must not be a hard boot failure on `MFA_ENCRYPTION_KEY` absence
   without a re-wrap tool, or it converts a warning into an outage for every
   enrolled user.
