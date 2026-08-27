# Unit 21 — Magic links, password reset, email verification, invitations

Read-only security audit, 2026-08-09, against `main` (`c678e1745`).
Scope: `packages/server/src/auth/magic-link-routes.ts`, `reset-password-admin.ts`,
the reset/verify/forgot routes in `routes.ts`, `admin-user-ops.ts`,
`admin-users-route.ts`, the token stores in `packages/server-postgres/src/auth/services.ts`
and `packages/server-mongo/src/auth/services.ts`, and the invitation flow.

---

## Verdict

The primitives are right. Tokens are 320-bit CSPRNG values, stored only as
SHA-256 hashes, expiry is enforced **at use** in SQL rather than at creation,
issuing a new token deletes the previous unused one, a magic link cannot
conjure an account, and the self-service reset both revokes every refresh token
and raises the `tokens_valid_after` watermark. The known defect the earlier
sweep found — the invitation reaching past `templates.userInvitation` to the
password-reset template — is fixed and commented at
`packages/server/src/auth/admin-user-ops.ts:212`.

What is wrong is at the edges, and it follows two familiar shapes. The first is
**class 17's second axis** — a rule applied at most of its call sites: session
revocation is on the two self-service password paths and on neither of the two
admin ones, and the per-recipient mail limiter is on one of the three routes
that send mail. The second is **class 19** — the single-use guarantee both
token flows advertise is a read followed by an unrelated write, and on the reset
path the two statements are separated by a full password hash.

One High, five Medium, seven Low. Nothing here is remotely reachable without
either the emailed token or an admin session; the High is a remediation that
does not remediate.

---

## HIGH

### H1. An admin password reset leaves every existing session alive

`packages/server/src/auth/reset-password-admin.ts:72`, `:136`, `:144`
`packages/server/src/auth/admin-users-route.ts:300-309`

Four call sites change a password without touching sessions:

| site | what it does | revokes? |
|---|---|---|
| `routes.ts:815` (self-service reset) | `updatePassword` | yes — `:825`, `:826` |
| `routes.ts:871` (change-password) | `updatePassword` | yes — `:874`, `:875` |
| `reset-password-admin.ts:72` (admin sets a password directly) | `updatePassword` | **no** |
| `reset-password-admin.ts:136` (email send failed → temp password) | `updatePassword` | **no** |
| `reset-password-admin.ts:144` (no email service → temp password) | `updatePassword` | **no** |
| `admin-users-route.ts:305` (`PUT /users/:uid` with `password`) | `updateUser({passwordHash})` | **no** |

Both admin UI modes reach the non-revoking route:
`packages/cms/src/components/common/default_entity_actions.tsx:276` POSTs
`/admin/users/:uid/reset-password` with `{password}` for "set manually" and
`{}` for "email a link".

**Failure scenario.** An attacker has stolen a user's refresh token — phishing,
a shared machine, an XSS in the customer's app. The user reports it; an
administrator opens the panel and resets the password, which is the one action
the product offers for this. The attacker's refresh token is untouched and its
session start predates no watermark, so `POST /auth/refresh`
(`routes.ts:1032-1037`) keeps minting access tokens for the full refresh
lifetime. The victim and the administrator both believe the account is
recovered. The "email a link" mode is safe only *if and when* the user consumes
the link; until then the attacker is still in, and the temp-password fallback
paths (`:136`, `:144`) change the password immediately and revoke nothing at
all.

**Fix direction.** Every path that writes a `passwordHash` must be followed by
`deleteAllRefreshTokensForUser` + `setTokensValidAfter`, which means not
repeating the pair at a fifth call site: put the credential change behind one
`replaceUserPassword(uid, hash)` helper in `auth-hooks.ts` or `admin-user-ops.ts`
that does both, and make the four sites above call it. Gate it by enumerating
the *feature* — assert that no route in `packages/server/src/auth` calls
`updatePassword`/`updateUser({passwordHash})` without the revocation, rather
than testing the two sites that already work.

---

## MEDIUM

### M2. Single-use is check-then-act, and on the reset path the window is a bcrypt

`packages/server/src/auth/routes.ts:807-818`
`packages/server/src/auth/magic-link-routes.ts:130-137`
`packages/server-postgres/src/auth/services.ts:796-834`, `:890-914`
`packages/server-mongo/src/auth/services.ts:465-485`, `:577-587`

Both consumers do:

```ts
const storedToken = await authRepo.findValidPasswordResetToken(tokenHash); // SELECT … used_at IS NULL
…
await authRepo.markPasswordResetTokenUsed(tokenHash);                      // UPDATE … SET used_at
```

Two statements, no transaction, no `RETURNING`, in both drivers. This is
class 19 in the mechanism whose entire stated purpose is "one-time use"
(`magic-link-routes.ts:136`).

The reset path makes it worse by ordering. Between the validating SELECT
(`routes.ts:807`) and the marking UPDATE (`:818`) sit `ops.hashPassword`
(`:814`) and `updatePassword` (`:815`). A password hash is deliberately slow —
hundreds of milliseconds — so the window in which a second request sees
`used_at IS NULL` is not a scheduling accident, it is the length of a KDF. The
same ordering means the password is written *before* the token is retired, so a
crash or a failed UPDATE between `:815` and `:818` leaves the password changed
and the token replayable indefinitely (until its 1-hour expiry).

**Failure scenario.** An attacker holds a copy of a reset token — a forwarded
invitation, a shared or archived mailbox, a mail gateway that stores bodies. The
victim clicks their link; the attacker fires a concurrent
`POST /auth/reset-password` with the same token and a password of their
choosing. Both pass validation, both write, and the last write wins the account.
Without the race the attacker gets `INVALID_TOKEN`. On the magic-link route the
same race yields two authenticated sessions from one link, one of them the
attacker's, with the victim seeing a perfectly normal sign-in.

**Fix direction.** Claim before acting, in one statement:

```sql
UPDATE password_reset_tokens SET used_at = NOW()
WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
RETURNING uid
```

`RETURNING` yields a row exactly when this request owns the token; the route
then hashes and writes. `token_hash` is already `UNIQUE`
(`packages/server-postgres/src/auth/ensure-tables.ts:325`, `:350`), so the
predicate is exact. Mongo's equivalent is `findOneAndUpdate` with the same
filter. Note what claiming first introduces (class 19's own warning): if the
subsequent `updatePassword` throws, the token is spent and the user must request
another — that is the correct trade here, but it should be a deliberate one, and
the error message should say "request a new link".

### M3. Account enumeration by response time on `/auth/forgot-password` and `/auth/magic-link`

`packages/server/src/auth/routes.ts:748-789`
`packages/server/src/auth/magic-link-routes.ts:74-118`

The body and status are identical for both branches and there is a good test
pinning that (`packages/server/test/auth-routes.test.ts:1037-1054`). The clock
is not pinned, and the test's own docblock says why:

> this handler does real work (token, template, SMTP) only for a user that
> exists, so it is *not* constant-time

An unknown address returns after one indexed SELECT. A known one returns after
a DELETE, an INSERT, template rendering and — the dominant term — an **awaited**
`emailService.send` (`routes.ts:773`, `magic-link-routes.ts:102`). An SMTP
round trip is tens to hundreds of milliseconds against a sub-millisecond miss;
this is not a statistical side channel needing thousands of samples, it is a
single-request oracle. The honesty of the comment is not a mitigation — the
oracle is live in production, and the paragraph documents it rather than closing
it.

**Failure scenario.** An attacker walks a breach list against
`/auth/forgot-password` and separates customers from non-customers at 50
requests per 15 minutes per IP, which for a distributed prober is no bound at
all. On a product where membership is itself sensitive (a health, legal or
dating backend built on Rebase) that is the whole leak.

**Fix direction.** The existing-user branch should not be on the response path.
`sendWelcomeEmail` (`routes.ts:266-283`) already shows the shape: build and send
fire-and-forget with a `.catch`, and return immediately. Do the same here —
respond first, then mint the token and send — so both branches cost one lookup.
A test can pin the *shape* rather than a timing threshold: assert that
`emailService.send` has not settled by the time the handler resolves.

### M4. `beforeLogin` runs only when the account exists, turning the hook into a hard oracle

`packages/server/src/auth/magic-link-routes.ts:76-80`

```ts
if (user) {
    if (ops.beforeLogin) {
        await ops.beforeLogin(email, "magic-link");
    }
    …
}
```

`POST /auth/login` calls the same hook *before* the lookup
(`routes.ts:459-462`), so the two routes disagree about what `beforeLogin`
means. The hook is documented as "throw to reject" and the natural
implementations — account suspended, domain not allowlisted, too many attempts
for this address — all throw for some addresses and not others.

**Failure scenario.** A deployment with any `beforeLogin` hook: an address with
no account always returns `200 {success:true}`; an address whose account exists
and is refused by the hook returns the hook's 4xx. That is existence *and*
account state, in the status line, on an unauthenticated endpoint whose entire
response text was written to avoid exactly this.

**Fix direction.** Call `beforeLogin` before the `getUserByEmail` lookup, as
login does, and swallow its rejection into the same generic 200 on this route
(logging it) — or, better, hoist the ordering into one shared helper so the two
routes cannot drift again (class 2: extract the predicate, then pin *agreement*
between the routes rather than the behaviour of each).

### M5. No per-recipient rate limit on the two routes that mail an arbitrary address

`packages/server/src/auth/routes.ts:738`, `magic-link-routes.ts:65`
Precedent: `packages/server/src/auth/rate-limiter.ts:190-219`

`verificationEmailLimiter` exists, is keyed on the recipient rather than the
caller, is documented with the exact reasoning ("the recipient is the quantity
being protected, not the caller"), and is mounted on one route —
`/auth/send-verification`. `/auth/forgot-password` and `/auth/magic-link` mail a
**caller-chosen, unauthenticated** address and carry only `strictAuthLimiter`,
50 requests / 15 min / IP, from a `MemoryRateLimitStore` that counts per replica.
Three routes send mail to an address the caller names; one of them bounds what
that address can be sent.

**Failure scenario.** An attacker mail-bombs a victim: 50 messages per 15
minutes per source IP, multiplied by every IP they have and by every replica
behind the load balancer. Each one is a genuine, correctly-signed
"reset your password" from the operator's domain — which is also a phishing
softener and a deliverability liability for the sender's reputation. A secondary
effect: each request deletes and re-inserts the victim's live reset token, so a
victim who is legitimately trying to reset their password can be kept in a state
where the link in their inbox is always the stale one.

**Fix direction.** Mount a recipient-keyed limiter on both routes, keyed on the
normalized email (these routes have no uid). Key it on
`normalizeEmail(email)` and keep `strictAuthLimiter` in front for the IP bound,
exactly as `/auth/send-verification` layers the two. Because the key is now
attacker-supplied data, hash it into the bucket name so the store cannot be made
to hold arbitrary strings.

### M6. The email-verification token never expires

`packages/server/src/auth/routes.ts:912-916`, `:950-968`
`packages/server-postgres/src/auth/services.ts:451-479`

`setVerificationToken` writes both the hash and `email_verification_sent_at`
(`:462`). `getUserByVerificationToken` (`:471-479`) matches on the hash column
and nothing else — no expiry predicate, and `emailVerificationSentAt` is mapped
into `UserData` (`:146`) and read by no one. Mongo is the same
(`packages/server-mongo/src/auth/services.ts:223-225`). This is the only one of
the four token kinds without a lifetime: magic link 15 min, reset 1 h,
invitation 24 h, verification **forever**.

It matters because `emailVerified` is load-bearing, not cosmetic:
`decideOAuthAutoLink` (`packages/server/src/auth/oauth-signin-policy.ts:44-56`)
refuses to attach an OAuth identity to a password-holding local account whose
address was never verified — that refusal is the pre-hijack defence, and the
verification token is the only thing that lifts it.

**Failure scenario.** A verification mail from two years ago surfaces — an
exported mailbox, an abandoned corporate account someone else inherits, a
support ticket with the raw email attached, a leaked backup. Whoever holds it
can `GET /auth/verify-email?token=…` today, flip `email_verified` on an account
they do not control, and thereby unlock OAuth auto-linking into it for anyone
who can present a provider-verified identity for that address. Compare the
15-minute magic link, which grants a session and is treated as far more
dangerous, when the verification token grants the durable permission.

**Fix direction.** Enforce a lifetime at use, from the column that is already
written: add `AND email_verification_sent_at > NOW() - INTERVAL '24 hours'` to
the lookup, and say so in the error. Nothing new needs storing — this is a
field the platform writes and never reads back (class 14), and reading it is the
whole fix.

### M7. `MagicLinkTokenService` discards the table it is given

`packages/server-postgres/src/auth/services.ts:862-867`

```ts
constructor(
    private db: NodePgDatabase,
    tableOrTables?: RebasePgTable | Partial<AuthSchemaTables>
) {
    this.magicLinkTokensTable = (magicLinkTokens as unknown as RebasePgTable);
}
```

The parameter is declared, passed by `PostgresTokenRepository`
(`:932`), and never read. Its sibling `PasswordResetTokenService`
(`:758-767`) honours the same parameter, over the same call, with the same
argument. Two implementations of one hop, disagreeing (class 11) — and the
constructor position hides it from `no-unused-vars`.

**Failure scenario.** A deployment with a non-`public` users schema.
`ensureAuthTablesExist` provisions `"<authSchema>"."magic_link_tokens"`
(`ensure-tables.ts:345`), while every read and write goes to the module-default
`rebase.magic_link_tokens`, whose `uid` FK points at `rebase.users`
(`packages/server-postgres/src/schema/auth-schema.ts:189-196`). Best case
magic-link sign-in fails closed on a missing relation or an FK violation; worse,
on a database that has both schemas (an upgraded install, a tenant that migrated
schemas) tokens are minted and validated against a table nobody provisions,
backs up, or reasons about — and no test would notice, because no test
exercises the magic-link routes at all.

**Fix direction.** Copy the resolution `PasswordResetTokenService` already
does. Then pin the boundary rather than the instance: assert that every auth
sub-service constructed with an explicit `AuthSchemaTables` reads from the table
it was handed, for all of them at once.

---

## LOW

### L1. Two emailed links bypass `resolveEmailLinkBase`, and the boot guard has a hole

`packages/server/src/auth/admin-user-ops.ts:209`
`packages/server/src/auth/reset-password-admin.ts:113`
`packages/server/src/email/link-base.ts:31-34`, `:97`

Both read `emailConfig?.resetPasswordUrl || ""` directly — the exact pattern
`link-base.ts` was written to remove, and which its docblock describes as
producing a dead relative `href` reported as success. Separately, the boot guard
`assertEmailLinkBases` passes when *either* `resetPassword` or `verifyEmail`
resolves, but the `resetPassword` chain has no fallback
(`LINK_BASE_FIELDS.resetPassword = ["resetPasswordUrl"]`). A config setting only
`verifyEmailUrl` therefore boots clean and emits relative, dead links from
`/auth/forgot-password`, from the invitation, and from the admin reset — all
three reporting `{invitationSent: true}` / `{success: true}`.

**Fix:** route both sites through `resolveEmailLinkBase(config, "resetPassword")`,
and make the boot guard require the base for each kind that can actually be
sent, not one of them.

### L2. Three token-lifecycle methods are declared, implemented twice, and called by nothing

`packages/server/src/auth/interfaces.ts:475`, `:480`
`packages/server-postgres/src/auth/services.ts:995`, `:999`
`packages/server-mongo/src/auth/services.ts:561`, `:565`

`deleteAllPasswordResetTokensForUser` and `deleteExpiredTokens` are on the
public `AuthRepository` interface and implemented in both drivers; no caller
exists anywhere in `packages/` or `saas/` (class 21). Two consequences:
outstanding reset tokens survive a `POST /auth/change-password`, so a user who
requests a reset, then remembers their password and changes it, leaves a live
1-hour token in their inbox; and used/expired rows in
`password_reset_tokens` and `magic_link_tokens` are never reaped, so token
hashes accumulate for the life of the database. `MagicLinkTokenService` has no
`deleteExpired` at all — not even the dead one.

**Fix:** call `deleteAllPasswordResetTokensForUser` from change-password and
from the admin reset, and give the reaper a caller (the cron scheduler is right
there) or delete the methods. A declared capability with no reader is worse than
an absent one.

### L3. Accepting an invitation proves mailbox control and is not credited for it

`packages/server/src/auth/admin-user-ops.ts:157-167`, `:203-207`
`packages/server/src/auth/oauth-signin-policy.ts:36-39`
`packages/server/src/auth/routes.ts:813-826`

`prepareAdminUserValues` always plants a `passwordHash` — `generateSecurePassword()`
when the admin supplied none (`:159`). The invitation then mails a
*password-reset* token. Consuming it (`POST /auth/reset-password`) sets the
password and revokes sessions but, unlike `magic-link/verify`
(`magic-link-routes.ts:145-149`), does **not** set `emailVerified` — even though
clicking a link in the mailbox proves ownership identically.

The invited account is therefore `hasPassword && !emailVerified` forever, which
is precisely the state `decideOAuthAutoLink` refuses. Its docblock says the
opposite out loud:

> it has no password at all (it was created by an OAuth sign-in **or an
> invitation**, so there is no credential an attacker could have planted in
> advance)

That assumption is false for this repo's own invitation flow. The invitee who
later clicks "Sign in with Google" gets a 403 whose remediation —
"Sign in with your existing method, then POST to /auth/link/…" — they cannot
follow, because the only password their account ever had was random and thrown
away (class 5: advice that does not change the state that produced the error).

**Fix:** set `emailVerified` when a reset/invitation token is consumed, the same
way magic-link does, and correct the policy docblock; or stop planting a
password on the invitation path so the `hasPassword` branch is honestly false.
Either one, not both.

### L4. `GET /auth/verify-email` has no rate limiter

`packages/server/src/auth/routes.ts:950`

Every other token-consuming auth route carries `strictAuthLimiter`;
this one carries nothing. The token is 320 bits, so guessing is not the
concern — an unauthenticated, unbounded, un-throttled indexed lookup per request
is (and a `GET` is trivially amplified by third-party page loads). Low, but it
is a one-word omission in an otherwise uniform row.

### L5. The reset writes the password before retiring the token, with no transaction

`packages/server/src/auth/routes.ts:815-818`

Covered by the fix for M2; called out separately because even a *correct*
claim-first UPDATE needs the ordering right. As written, an error between
`updatePassword` and `markPasswordResetTokenUsed` leaves the credential changed
and the token live for the rest of its hour.

### L6. The token travels in a `GET` query string

`packages/server/src/auth/routes.ts:923`, `:951`
`packages/client/src/auth.ts:712`

`/auth/verify-email?token=…` puts a bearer secret in a request line: reverse-proxy
access logs, browser history, and any `Referer` from the app's own landing pages
(`/reset-password?token=`, `/auth/magic-link?token=`) if they load third-party
resources. **Not** a server-side leak — `logMiddleware`
(`packages/server/src/api/logs-routes.ts:100-102`) records `c.req.path`, which
excludes the query, and `logger.ts:80-92` redacts any key containing `token`.
The exposure is entirely in components Rebase does not own.

**Fix direction:** accept the token in a `POST` body for verification as the
other three flows already do (keep the `GET` as a redirect-only shim if the
mail-client experience demands it), and document `history.replaceState` +
`Referrer-Policy: no-referrer` on the app pages that receive these links, since
that half is the framework user's to get right.

### L7. `POST /admin/users` re-lists the fields it persists and drops two of them

`packages/server/src/auth/admin-users-route.ts:247-253`

`prepareAdminUserValues` returns a `values` object; the route hand-copies five
keys out of it into `createUser`, dropping `emailVerified` (set to `true` at
`admin-user-ops.ts:167`) and anything a custom `onCreateUser` hook added. The
auth-collection path does not: `builtin-auth-adapter.ts:257-266` returns the
whole object and the REST layer saves it. So the same helper produces an
`emailVerified: true` account through one admin surface and an
`emailVerified: false` account through the other (class 17 — a literal list of
names where a spread would do). It fails closed here, which is why it has
survived; but it is the flag M6 and L3 both turn on, and the two admin surfaces
should not disagree about it.

---

## Checked and clean

- **Entropy and generation.** `generateSecureToken` is `randomBytes(40).toString("hex")`
  — 320 bits from the CSPRNG, one implementation, used by all four flows
  (`admin-user-ops.ts:54`). `generateSecurePassword` uses `randomInt`, not
  `Math.random`, including for the shuffle (`:36`, `:45`).
- **Storage.** Only `sha256(token)` is ever persisted, in all four flows and both
  drivers; the cleartext exists in the request and the email body and nowhere
  else. A fast hash is correct here — the pre-image space is 320 bits, so a KDF
  would buy nothing.
- **Expiry enforced at use, not creation.** Postgres filters `expires_at > NOW()`
  inside the lookup (`services.ts:814`, `:897`); Mongo filters
  `expiresAt: {$gt: new Date()}` (`services.ts:469`, `:579`). A clock-skewed or
  long-lived row cannot be spent. (Verification tokens are the exception — M6.)
- **Old tokens invalidated on re-issue.** `createToken` deletes the user's unused
  tokens before inserting, in both drivers and both token kinds
  (`services.ts:781-784`, `:878-881`; mongo `:453`, `:573`). The verification
  token is a single column, so writing a new one overwrites the old
  (`services.ts:451-466`), and `setEmailVerified` nulls it on success (`:442`) —
  verification is genuinely single-use.
- **Enumeration in the response.** Body and status are byte-identical between the
  hit and miss branches on both `/auth/forgot-password` and `/auth/magic-link`,
  including when SMTP throws, and there is a test asserting the whole body rather
  than the status (`auth-routes.test.ts:1037-1071`). Only the timing differs (M3).
- **Reset consumes into a full revocation.** `routes.ts:825-826` deletes every
  refresh token *and* raises `tokens_valid_after`, and the refresh route
  (`:1029-1037`) judges a presented token's `session_started_at` against that
  watermark — so a refresh already in flight cannot outrun the reset. This is the
  question "does an attacker keep their old session", and on the self-service
  path the answer is a clean no.
- **A magic link cannot authenticate a non-existent account.** The request route
  is a no-op when `getUserByEmail` misses (`magic-link-routes.ts:76`); the verify
  route resolves a uid from a stored row and 400s if the user has since vanished
  (`:140-143`). Nothing in the flow creates a user, so there is no
  "sign-in becomes sign-up" hole.
- **MFA is not bypassed.** Magic-link verify goes through the shared
  `createSessionAndTokens` (`routes.ts:298-343`), whose `assertMfaSatisfied` gate
  is inside the helper rather than repeated per route, and it does not pass
  `skipMfaGate`.
- **Magic link is opt-in.** Mounted only under `config.enableMagicLink`
  (`routes.ts:1198`), which defaults to `false` (`init.ts:1074`), and the
  capability is advertised from the same flag ANDed with a configured email
  service (`builtin-auth-adapter.ts:334`, `session-routes.ts:350`) — no drift
  between what is advertised and what is mounted.
- **Storage isolation.** Both token tables carry `token_hash TEXT NOT NULL UNIQUE`
  and an FK to users with `ON DELETE CASCADE` (`ensure-tables.ts:322-355`), and
  they live in the `rebase` schema, not `public`
  (`ensure-tables.ts:105`), so the data API — which serves the introspected
  public schema and already excludes RLS-less tables
  (`PostgresBootstrapper.ts:195-218`) — does not reach them.
- **Logging.** No token, hash or URL-with-query is logged on any path in scope.
  Request logging uses `c.req.path` (`logs-routes.ts:100-102`); the logger
  redacts any key normalizing to contain `token`, `secret`, `password`, …
  (`logger.ts:80-99`) and strips Drizzle's `Failed query:` spans, which is where
  a bound `token_hash` would otherwise surface.
- **The known class — invite reusing the reset template — is closed.**
  `finalizeAdminUserCreation` reads `templates.userInvitation` and falls back to
  `getUserInvitationTemplate` (`admin-user-ops.ts:227-232`), with the post-mortem
  in the comment above it; `reset-password-admin.ts:117` deliberately keeps the
  reset template because there the account really does exist. The *token type* is
  still shared (both mint a `password_reset_tokens` row), but that is the right
  call — the semantics of "prove the mailbox, then set a password" are identical.
  Its one real consequence is L3.
- **The saas org-invite lookup is gated.** `saas/backend/functions/invite-by-email.ts`
  requires an owner/admin membership in the target org before it will confirm an
  address exists, and returns only a uid — the enumeration reasoning is written
  out at `:22-26`.

---

## Open questions

1. **No test exercises the magic-link routes.** Grepping the suites for
   `magic-link` finds only `custom-auth-adapter.test.ts` (capability flag) and
   the email-template tests — nothing requests `/auth/magic-link` or
   `/auth/magic-link/verify`. M7's dropped table parameter would have been caught
   by any integration test at all, which is the tell. `/auth/reset-password` and
   `/auth/verify-email` are covered only against a mock `authRepo`
   (`auth-routes.test.ts:1101-1150`, `:1278-1305`), so nothing in CI has ever run
   the real SQL in `PasswordResetTokenService`.
2. **Are the auth token tables privilege-isolated, or only schema-isolated?**
   `ensure-tables.ts` issues no `ENABLE ROW LEVEL SECURITY`, `GRANT` or `REVOKE`
   for `password_reset_tokens` / `magic_link_tokens`; they are protected by
   living in the `rebase` schema. UNCONFIRMED whether `rebase_user` holds
   `USAGE` on that schema in a default install — if it does, a SQL-injection or
   an exposed raw-query path reaches the hashes. (Hashes alone are not spendable,
   so this is defence in depth, not a live hole.)
3. **Mongo's magic-link collection is unprefixed.** `rebase_password_reset_tokens`
   vs plain `magic_link_tokens`
   (`packages/server-mongo/src/auth/services.ts:449` vs `:572`). UNCONFIRMED
   whether anything namespaces application collections away from that name; if
   not, an app collection called `magic_link_tokens` shares storage with the
   auth flow.
4. **Timing was reasoned about, not measured.** M3 is argued from the awaited
   `emailService.send`; I did not run the server or take samples. The magnitude
   is a question, the direction is not.
5. **`PasswordResetTokenService.findValidByHash` issues two queries** — a bare
   `SELECT` by hash whose result is discarded except for a null check
   (`services.ts:797-805`), then the real guarded one (`:809-815`). Harmless
   today and it will disappear under M2's single-statement rewrite, but it is
   worth knowing whether the first query was meant to distinguish
   "no such token" from "expired or used" for a better error, since that
   distinction would itself be an oracle.
