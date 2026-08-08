# Unit 19 — OAuth providers

Read-only security audit of the twelve OAuth provider implementations in
`packages/server/src/auth/` and the shared plumbing they call.

Scope: `apple-`, `bitbucket-`, `discord-`, `facebook-`, `github-`, `gitlab-`,
`google-`, `linkedin-`, `microsoft-`, `slack-`, `spotify-`, `twitter-oauth.ts`,
plus `routes.ts`, `jwt.ts`, `cookie-utils.ts`, `crypto-utils.ts`,
`builtin-auth-adapter.ts`, `interfaces.ts`, `init.ts`, and the one shipped
consumer of the flow, `packages/app/src/components/LoginView/LoginView.tsx`.

Date: 2026-08-08. Nothing was modified.

---

## The shape of the subsystem

Every provider is the same object: an `id`, a Zod `schema` for the request body,
and `verify(payload) -> OAuthProviderProfile | null`. The profile is
`{ providerId, email, displayName, photoUrl, emailVerified }`
(`interfaces.ts:58`). `routes.ts:495` mounts one `POST /auth/<id>` per provider,
calls `verify`, and then runs a single find-or-create-or-link decision for all
twelve (`routes.ts:510-572`).

That is the important structural fact. **Half of the OAuth security surface is
not in these files at all.** The browser performs the authorization request; the
server only ever sees a `code` (or a token) plus a `redirectUri`, both taken
verbatim from the request body. So `state`, PKCE challenge generation, nonce and
the redirect-URI allowlist are, by construction, someone else's job — and this
audit found that in the one client the repo ships, they are nobody's job.

The second important fact: `emailVerified` is not a display field. It is the
*sole* authorization input to account linking (`routes.ts:516-525`). A provider
that returns `emailVerified: true` for an address it did not verify hands over
any pre-existing local account with that address. Five of the twelve providers
return a literal `true`.

---

## Comparison table

Per-provider security controls. "n/a" means the provider or the flow makes the
control inapplicable; "—" means the control is absent where it should apply.

| Provider | CSPRNG `state` stored + verified | PKCE | `redirect_uri` allowlisted server-side | Token exchange authn | id_token sig / `aud` / `iss` verified | nonce | `emailVerified` source | Stable key | Extra trust taken from the client |
|---|---|---|---|---|---|---|---|---|---|
| **apple** | — | — | — (caller-supplied) | client_secret JWT (ES256) | **decoded, never verified** (`apple:87`) | — | `id_token.email_verified` | `sub` | **yes — `payload.user.email`** (`apple:97`) |
| **bitbucket** | — | — | — (caller-supplied) | HTTP Basic | n/a (no id_token) | n/a | `is_confirmed` filter (`bitbucket:64`) ✅ | `uuid` | no |
| **discord** | — | — | — (caller-supplied) | client_secret in body | n/a | n/a | `profile.verified` ✅ | `id` | no |
| **facebook** | — | — | — (caller-supplied) | **client_secret in URL query** (`facebook:23`) | n/a | n/a | **hardcoded `true`** (`facebook:66`) | `id` | no |
| **github** | — | — | — (caller-supplied) | client_secret in body | n/a | n/a | **hardcoded `true`**; `/user/emails` path does check `verified`, the `/user` fast path does not (`github:73,89,104`) | `id` | no |
| **gitlab** | — | — | — (caller-supplied) | client_secret in body | n/a | n/a | **hardcoded `true`** (`gitlab:64`) | `id` | no |
| **google** | — | — | — (caller-supplied) | client_secret in body | **✅ full verify** via `google-auth-library` + `aud` check on `tokeninfo` (`google:184,255,55`) | — | `email_verified` claim ✅ | `sub` | no |
| **linkedin** | — | — | — (caller-supplied) | client_secret in body | id_token received and **discarded**; identity from `/userinfo` (`linkedin:46,50`) | — | `email_verified` ✅ | `sub` | no |
| **microsoft** | — | — | — (caller-supplied) | client_secret in body | **no id_token used at all**; identity from Graph `/me` | — | **`Boolean(profile.mail)`** (`microsoft:83`) — not a verification signal | `id` | no |
| **slack** | — | — | — (caller-supplied) | client_secret in body | id_token not used; `/openid.connect.userInfo` | n/a | `email_verified` ✅ | `sub` | no |
| **spotify** | — | — | — (caller-supplied) | HTTP Basic | n/a | n/a | **hardcoded `true`** (`spotify:61`) | `id` | no |
| **twitter** | — | **✅ `codeVerifier` required** (`twitter:24`) | — (caller-supplied) | HTTP Basic | n/a | n/a | `true` iff v1.1 `verify_credentials` returned an email; explicit `false` for the placeholder (`twitter:99,112`) ✅ | `id` | no |

Outliers, read down the columns:

- **`state`: zero of twelve.** Not a per-provider defect — the design puts it in
  the client, and the shipped client omits it (F4).
- **PKCE: one of twelve.** Twitter is the only provider that even accepts a
  `code_verifier`. Google, Microsoft, Apple, GitLab, Slack, Discord and Spotify
  all support PKCE and none of them get it.
- **Signature verification: one of twelve.** Google is the only provider that
  cryptographically verifies anything. Apple *has* an id_token and base64-decodes
  it. LinkedIn *receives* an id_token and throws it away.
- **`emailVerified`: five of twelve fabricate it** (facebook, github, gitlab,
  spotify — literal `true`; microsoft — derived from a field that carries no
  verification meaning). Bitbucket is the model: it filters on `is_confirmed`
  and only then says `true`.
- **Client-supplied identity: one of twelve.** Apple alone reads an identity
  field out of the request body.
- **Error handling: one of twelve throws.** Eleven providers `return null` on
  failure; Google re-throws, and `routes.ts:501-504` puts the thrown message in
  the HTTP response (F10).

---

## Findings

### F1 — HIGH — Five providers assert `emailVerified: true` for an email the provider never verified; that flag alone grants an existing account

`packages/server/src/auth/spotify-oauth.ts:61`,
`packages/server/src/auth/facebook-oauth.ts:66`,
`packages/server/src/auth/gitlab-oauth.ts:64`,
`packages/server/src/auth/github-oauth.ts:104`,
`packages/server/src/auth/microsoft-oauth.ts:83`
— consumed at `packages/server/src/auth/routes.ts:516-525`.

`routes.ts` treats `externalUser.emailVerified` as proof that the caller controls
the address, and on that basis links the incoming OAuth identity into a
pre-existing local account:

```
user = await authRepo.getUserByEmail(externalUser.email);
if (user) {
    if (!externalUser.emailVerified) { throw ApiError.forbidden(...) }
    await authRepo.linkUserIdentity(user.id, provider.id, externalUser.providerId, ...);
}
```

The flag is the whole gate. Five providers manufacture it:

- **spotify-oauth.ts:61** — `emailVerified: true`, unconditional. Spotify's
  `/v1/me` returns `email` with no verification field at all, so there is
  nothing in the response the code could have checked. (That Spotify permits an
  unconfirmed address on a usable account is UNCONFIRMED here — I did not
  contact the provider. The code-level defect does not depend on it: the
  provider reported nothing and the code reported "verified".)
- **facebook-oauth.ts:66** and **gitlab-oauth.ts:64** — same, unconditional
  `true`, no field consulted.
- **github-oauth.ts:73,89,104** — the `/user/emails` branch *does* filter on
  `e.verified`, then line 104 hardcodes `true` for **both** branches, including
  the `profileData.email` fast path at line 73 which was never checked.
- **microsoft-oauth.ts:83** — `Boolean(profileData.mail)`, with a nine-line
  comment (lines 75-83) asserting `mail` is "a provisioned, provider-verified
  mailbox address". It is not. `mail` is a directory attribute that a tenant
  administrator can set to an arbitrary string via Graph or AAD Connect sync,
  and `tenantId` defaults to `"common"` (line 17), so *every* Entra tenant in
  the world is an accepted issuer. Microsoft's own guidance is that the email
  from a multi-tenant app is not a verified identifier without the `xms_edov`
  claim, which is neither requested nor read here.

**Failure scenario (Microsoft, the sharpest):** attacker registers a free Entra
tenant (minutes, no cost), creates a user in it, sets that user's `mail`
attribute to `cfo@victim-corp.com`, and signs in to the target Rebase backend
through the Microsoft button. `verify` returns
`{ providerId: <attacker's object id>, email: "cfo@victim-corp.com",
emailVerified: true }`. `routes.ts:514` finds the CFO's existing account,
line 518 passes, line 525 links the attacker's identity to it, line 574 mints a
session. Full takeover of an arbitrary account, with persistence — the identity
row survives a password reset.

The Spotify/Facebook/GitLab variants are the same attack with a cheaper setup
wherever the provider does not force address confirmation.

**Fix direction.** `emailVerified` must be `true` only where the provider
returned a verification signal that the code read. For Microsoft: request and
require `xms_edov`, or default `tenantId` to a required config value rather than
`"common"`, or return `false` and let the operator opt in. For the other four:
return `false` (auto-link then correctly refuses, and `POST /auth/link/<p>`
remains the supported path). The type should make the omission impossible —
`emailVerified` is currently `boolean | undefined` in `interfaces.ts:64`, which
lets a provider forget it as easily as fake it.

---

### F2 — HIGH — Apple takes the account's email address out of the request body

`packages/server/src/auth/apple-oauth.ts:97` (schema at `:49-55`,
`emailVerified` at `:114`).

```
const email = decoded.email || payload.user?.email;
```

`payload.user.email` is the client's JSON body. Apple is the only one of the
twelve providers that reads any identity field from the request rather than from
the provider. The comment explains the intent — Apple sends the *name* only on
first authorization, so the frontend forwards it — but the schema also accepts an
`email` (line 54) and line 97 promotes it to the identity email whenever the
id_token's `email` claim is absent.

An attacker chooses whether the claim is absent: they construct their own
authorization request to Apple against the same Services ID and a registered
redirect URI, omitting the `email` scope. Apple then issues an id_token with a
valid `sub` and no `email`, and the fallback fires.

**Failure scenario:** attacker posts
`{ code: <their own valid code>, redirectUri: <registered>, user: { email: "cfo@victim-corp.com" } }`.
No local account exists for that address yet, so `routes.ts:534` creates one with
the victim's email, owned by the attacker's Apple `sub`. Consequences depend on
what the deployment does with `user.email` — pending org invitations matched by
address, domain-derived role assignment, "is this an employee" checks — and the
victim is permanently locked out of registering (`EMAIL_EXISTS` at
`routes.ts:354`). Where the victim's account *does* already exist, `email_verified`
is absent alongside `email`, so `emailVerified` is `false` (line 114) and F1's
gate holds — this one stops at squatting plus whatever email-keyed trust the app
layers on top, not at direct takeover.

**Fix direction.** Drop `email` from the Apple schema entirely; keep `name`. The
id_token is the only acceptable source of the address.

---

### F3 — HIGH — OAuth sign-in creates accounts without consulting the registration policy, including the first-user-becomes-admin bootstrap

`packages/server/src/auth/routes.ts:532-560`, versus `routes.ts:320-343`.

`POST /auth/register` gates on `config.disableSelfRegistration` (line 325) and
then `isRegistrationAllowed()` (line 334). `registration-policy.ts:34` documents
`disableSelfRegistration` as "The hard kill switch. Blocks registration
including first-user bootstrap", and the file's own header is about this exact
class — one predicate that had drifted into three implementations. It found
three. There is a fourth, and it is the one that skips the check completely:
the OAuth branch calls `authRepo.createUser` at line 534 with no gate above it,
and then at lines 552-556 runs the same first-user promotion:

```
const allUsers = await authRepo.listUsers();
const isFirstUser = allUsers.length === 1 && allUsers[0].id === user.id;
if (isFirstUser) { await authRepo.setUserRoles(user.id, ["admin"]); }
```

**Failure scenario:** an operator deploys with
`auth: { disableSelfRegistration: true, google: { clientId, clientSecret } }`,
provisioning accounts out of band exactly as the doc comment describes. Any
person on the internet with a Google account posts to `/auth/google` and gets an
account. If the operator has not yet created their first user — the window
between `rebase deploy` and the first login, which is precisely when the kill
switch is supposed to be load-bearing — that stranger is promoted to `admin`.

`magic-link-routes.ts` is clean here: it never creates users. OAuth is the only
account-creating path that skips the gate.

**Fix direction.** Call the same `isRegistrationAllowed()` before line 534, and
apply the same post-hoc race check that `routes.ts:375-382` applies to
registration. The test at `auth-routes.test.ts:1669` already covers OAuth for
the *non-first* user case; the disabled-registration case has no test.

---

### F4 — HIGH — The shipped admin login builds GitHub and LinkedIn authorize URLs with no `state`, and accepts any `?code=` on return

`packages/app/src/components/LoginView/LoginView.tsx:618`, `:648`, callback at
`:278-297`.

```ts
window.location.href = `https://github.com/login/oauth/authorize?client_id=${githubClientId}&redirect_uri=${redirectUri}&scope=${scope}`;
```

No `state`, no PKCE, no nonce. The return leg is the mirror image:

```ts
const code = params.get("code");
const provider = localStorage.getItem("rebase_oauth_provider");
if (code && provider) { ... authController.oauthLogin(provider, { code, redirectUri: cleanUrl }) }
```

The only thing binding the returned `code` to a login this browser started is a
localStorage marker naming the *provider*. It is set when the button is clicked
(lines 615, 645) and removed only on a callback that carries a `code` (line
283) — so a user who clicks "Sign in with GitHub" and then abandons the flow
(denies consent, closes the popup, hits back) leaves the marker set
indefinitely.

**Failure scenario (login CSRF / code injection):** attacker starts a GitHub
authorization for the target app under their own account, captures the resulting
`code` at the redirect URI without spending it, then gets the victim — who has a
stale `rebase_oauth_provider` marker, or is induced to click the login button
first — to load `https://admin.victim-corp.com/?code=<attacker_code>`. The
victim's browser posts the attacker's code to `/auth/github` and receives a
session cookie for the **attacker's** account. Everything the victim then does
in that admin session — uploads, invites, collection data — lands in an account
the attacker controls and can read at leisure. With PKCE also absent, a code
intercepted by any means is directly replayable.

**Fix direction.** Generate `state` with `crypto.getRandomValues`, store it in
`sessionStorage` next to the provider name, require an exact match on the
callback before posting, and clear the marker on *every* return path including
`?error=`. Add PKCE (`code_challenge`/`code_verifier`) for the providers that
support it — the server already has the plumbing for it in the Twitter provider.

---

### F5 — HIGH — Auto-linking trusts a *local* account whose email was never verified (account pre-hijacking)

`packages/server/src/auth/routes.ts:512-525`.

The gate at line 518 checks that the *provider* verified the address. Nothing
checks that the **local** account did. `POST /auth/register` creates users with
no `emailVerified` (`routes.ts:359-363`), so every password account starts
unverified and stays that way until someone completes
`/auth/send-verification` — which requires a configured email service
(`routes.ts:809`) that many deployments will not have.

**Failure scenario (classic pre-hijack):** attacker registers
`cfo@victim-corp.com` with a password of their choosing, on an instance where
registration is open. Nothing is verified, nothing is sent. Weeks later the real
CFO signs in with Google. `routes.ts:514` finds the attacker's row, Google says
verified, line 525 links, line 574 issues the CFO a session **on the attacker's
user record**. The attacker still knows the password, logs in at
`/auth/login`, and reads everything the CFO has since created.

**Fix direction.** Auto-link only when the existing local account is itself
verified, or has no `passwordHash` at all. Otherwise fall through to the
`EMAIL_NOT_VERIFIED` message that already exists at line 520 and require the
`/auth/link/<provider>` path, which correctly demands a live session.

---

### F6 — MEDIUM — OAuth-created users are never marked `emailVerified`, even when the provider verified the address

`packages/server/src/auth/routes.ts:534-538`.

```
user = await authRepo.createUser({
    email: normalizeEmail(externalUser.email),
    displayName: ..., photoUrl: ...
});
```

`CreateUserData.emailVerified` exists (`interfaces.ts:37`) and is not passed.
`externalUser.emailVerified` was computed, used once for the link decision, and
discarded for the create decision — the two branches of the same `if` disagree
about whether the same value means anything.

**Impact:** every account created through Google, Slack, Discord, LinkedIn or
Bitbucket sits at `emailVerified: false` forever. `buildAuthResponse`
(`routes.ts:121`) reports it to the client, so any app that gates a feature on
`user.emailVerified` locks out its OAuth users, and `POST /auth/send-verification`
mails a verification link to people who have already proven the address. It also
widens F5: OAuth-created accounts are exactly the "unverified local account"
that the auto-link gate then trusts.

**Fix direction.** Pass `emailVerified: externalUser.emailVerified === true`.

---

### F7 — MEDIUM — `beforeLogin`, `onAuthenticated` and `beforeUserCreate` never fire on the OAuth path, though the hook type declares the case

`packages/server/src/auth/routes.ts:495-584`; contracts at
`auth-hooks.ts:53`, `:122`, `:132`, `:152`.

`AuthMethod` is declared as
`"login" | "register" | "oauth" | "refresh" | "password-reset" | "anonymous" | "magic-link" | "mfa"`
(`auth-hooks.ts:53`). `"oauth"` is in the union. The OAuth route calls none of
the three hooks. `/auth/login` calls `beforeLogin` (line 431) and
`onAuthenticated` (line 472); `/auth/register` calls `beforeUserCreate`
(line 364) and `onAuthenticated` (line 411); `/auth/magic-link` calls
`beforeLogin` (line 77) and `onAuthenticated` (line 158). Only the OAuth branch
calls `afterUserCreate` and nothing else.

`beforeLogin` is documented as "Throw an error to reject the login attempt (e.g.
for account lockout, IP-based restrictions)". So a deployment that implements
account suspension, IP allowlisting or a temporary lockdown in `beforeLogin`
enforces it against password and magic-link logins and **not** against any of
the twelve OAuth providers. A suspended user signs in with Google.

`beforeUserCreate` is the hook that injects tenant/org fields and rejects
disallowed email domains at creation; OAuth sign-ups bypass that too, producing
rows the rest of the system assumes cannot exist.

**Fix direction.** Call `beforeLogin(externalUser.email, "oauth")` before the
find-or-create, `beforeUserCreate` on the create branch, and
`onAuthenticated(user, "oauth")` before the response. The `"oauth"` literal in
the union is the giveaway that this was intended.

---

### F8 — MEDIUM — No security-audit log line for OAuth sign-in

`packages/server/src/auth/routes.ts:495-584` versus `:456-461` and `:478-482`.

`/auth/login` emits `auth.login.failure` and `auth.login.success` with `uid` and
`email`. The OAuth route emits nothing on either outcome — not on a successful
sign-in, not on a rejected one, and not on the `EMAIL_NOT_VERIFIED` refusal at
line 519, which is the single highest-signal event in the whole subsystem
(someone attempting to attach a provider identity to an account they do not
appear to own).

**Impact:** an incident responder reconstructing "how did this session get
created" from the audit stream sees password logins and nothing else. The
takeover paths in F1, F2 and F5 all run silently.

**Fix direction.** Mirror the two `[Security Audit]` lines, adding
`provider: provider.id` and, for the link decision, the pre-existing `uid`.

---

### F9 — MEDIUM — `redirect_uri` is caller-controlled with no server-side allowlist, on all twelve

Every provider: schema is `z.string().url()` (e.g. `github-oauth.ts:17`,
`slack-oauth.ts:14`), and the value is forwarded verbatim into the token
exchange (`github-oauth.ts:32`, `apple-oauth.ts:74`, `google-oauth.ts:230`,
etc.). No provider config accepts an allowed-redirect list — see the full config
surface at `init.ts:137-148` — and `routes.ts` never inspects it.

The only check is the provider's own registered-URI match. That is a real
control, but it is coarser than an allowlist here: it permits *any* URI
registered on that OAuth client. A team that registers `localhost:3000` for
development, a staging host, and a second product on the same client id has
implicitly authorized all of them to mint codes this backend will accept.
Combined with F4's missing `state`, that is the delivery vehicle for the code
injection described there.

**Fix direction.** Add `allowedRedirectUris?: string[]` to the provider config
and reject a mismatch in `routes.ts` before calling `verify`, defaulting to the
app's own origin.

---

### F10 — MEDIUM — Google's provider is the only one that throws, and the thrown text (including the provider's raw error body) is returned to the unauthenticated caller

`packages/server/src/auth/google-oauth.ts:237`, `:248`, `:287`; surfaced at
`packages/server/src/auth/routes.ts:501-504`.

```ts
// google-oauth.ts:237
throw new Error(`Google token exchange failed (${tokenResponse.status}): ${errorBody}`);
// routes.ts:501
} catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw ApiError.unauthorized(`${provider.id} login failed: ${msg}`, "OAUTH_ERROR");
}
```

Eleven providers `return null` and produce the generic
`Invalid <provider> credentials`. Google alone re-raises, and `routes.ts`
concatenates the message — which contains Google's verbatim response body — into
a 401 served to an anonymous caller. Token-endpoint error bodies routinely echo
back the `client_id`, the redirect URI, and diagnostics about the credential
state.

Related, same file: `verifyGoogleAccessToken` puts the access token in a URL
query string (`google-oauth.ts:42`). Google's own endpoint requires it, but query
strings are the part of a request that egress proxies, APM agents and error
trackers log by default.

**Fix direction.** In `routes.ts`, log `msg` and return a generic message. The
`ApiError.unauthorized` call should not interpolate provider output.

---

### F11 — MEDIUM — Facebook sends the client secret in a URL query string

`packages/server/src/auth/facebook-oauth.ts:21-27`.

```ts
const tokenUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
tokenUrl.searchParams.set("client_secret", config.clientSecret);
...
const tokenResponse = await fetch(tokenUrl.toString());
```

Facebook is the only provider that does this — the other eleven put credentials
in a POST body or an `Authorization: Basic` header. The request is TLS-protected
in flight, but the full URL is what gets written to outbound-proxy access logs,
APM spans, and any `fetch` error object that is logged with its `input`. A
long-lived app secret in a log aggregator is a credential compromise that will
not be noticed.

**Fix direction.** `POST` with `application/x-www-form-urlencoded`, matching the
other eleven. Facebook's token endpoint accepts it.

---

### F12 — MEDIUM — Apple's id_token is base64-decoded and trusted; `iss`, `aud`, `exp` and the signature are all unchecked

`packages/server/src/auth/apple-oauth.ts:85-92`.

```ts
const [, payloadB64] = tokenData.id_token.split(".");
const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
```

The comment — "Apple's id_token is a standard JWT — we only need the payload" —
is the entire justification. Compare Google at `google-oauth.ts:254-257`, which
calls `verifyIdToken` with an explicit `audience` even for a token it obtained
itself from its own confidential exchange.

The exposure is genuinely narrower than it looks: the token arrives over TLS
directly from `appleid.apple.com/auth/token` in response to a request
authenticated with a client_secret this server signed, so an attacker cannot
substitute a token of their own. What is actually missing is the `aud` check —
nothing confirms the token was minted for *this* Services ID rather than another
one under the same Apple team — and `exp`/`iss`, and any resilience if this
decode is ever refactored to accept an id_token from the client the way Google's
Path 1 does. There is also no `nonce`, on the only provider in the set where a
nonce would apply.

Note the missing guard as well: `tokenData.id_token.split(".")` will throw on a
response without an `id_token`, and `JSON.parse` on a malformed segment — both
land in the `catch` at line 116 and become a generic 401, so it degrades safely,
but the failure is indistinguishable from a wrong credential.

**Fix direction.** Verify against Apple's JWKS (`/auth/keys`) with
`aud === config.clientId`, `iss === "https://appleid.apple.com"` and `exp`
enforced. `jsonwebtoken` is already a dependency of this file (line 3) — it is
imported to *sign* the client secret and not used to verify anything.

---

### F13 — LOW — LinkedIn receives an id_token and discards it

`packages/server/src/auth/linkedin-oauth.ts:46,50`.

```ts
const tokenData = await tokenResponse.json() as { access_token: string; id_token?: string };
```

`id_token` is destructured into the type and never read. Identity comes from a
second network round-trip to `/v2/userinfo` instead. Not exploitable — the
userinfo call is bearer-authenticated against the token we just obtained — but
it is a free, strictly stronger identity source (signed, audience-bound, one
fewer request) that the code names and then ignores. Same shape as
`microsoft-oauth.ts`, which does not request an id_token at all despite sending
`scope: "openid"` (line 39).

---

### F14 — LOW — Twitter writes a synthetic email into the users table

`packages/server/src/auth/twitter-oauth.ts:110`.

```ts
email = `${profileData.id}@twitter.placeholder.rebase`;
```

`emailVerified` is correctly set to `false` on line 112, with a comment
explaining why, so the auto-link gate holds. The residue is that
`users.email` — a column the rest of the platform treats as an address — now
contains a value in a non-existent TLD. Any code that mails users, or that
counts distinct domains, or that validates the column on a later write, meets a
string that is not an email. `.placeholder.rebase` is at least unregistrable,
which is the right choice among bad ones.

---

### F15 — LOW — `verifyAccessToken` logs the first 15 characters of every token that fails verification

`packages/server/src/auth/jwt.ts:205`.

```ts
logger.error("[JWT] Verification failed", { error: error, detail: token.substring(0, 15) });
```

15 characters of an HS256 JWT is the header plus a byte or two — no secret
material — so this is close to harmless. It is still an unvalidated,
attacker-supplied string written to the log at `error` level on every malformed
`Authorization` header, which is both a log-injection surface and a free way to
flood the error stream. Line 193 has the same shape with `detail: decoded`,
which dumps the full decoded payload of a *validly signed* token.

---

### F16 — LOW / DX — Eleven of twelve providers have no test, and the subsystem has no documentation

`packages/server/test/google-oauth.test.ts` is the only provider test in the
repo (`find packages/server -name "*oauth*"`). It covers exactly the control
Google is the only provider to implement — audience verification — and covers it
well (five cases, including the `aud` mismatch).

The eleven providers with no test are the eleven that fabricate or mis-derive
`emailVerified`. `auth-routes.test.ts` exercises the shared route with a mocked
Google provider only; the `EMAIL_NOT_VERIFIED` branch at `routes.ts:519` — the
single most security-relevant line in the unit — has no test at all.

Documentation: a repo-wide grep for `oauthProviders` or `createGitHubProvider`
across every `.md`/`.mdx` returns nothing. Twelve providers ship with zero prose.
Since the design deliberately leaves `state`, PKCE and the authorize request to
the integrator (see "The shape of the subsystem"), the absence of documentation
is not a docs gap — it is the reason F4 exists in the repo's own client, and it
guarantees every integrator reinvents the dangerous half from scratch.

---

## Checked and clean

- **`crypto-utils.ts:19` `safeCompare`** — byte-length padding, comparison
  before the length check, `try/catch` around `timingSafeEqual`. Correct, and
  the comment explains the multi-byte bug it was written to fix. Not reachable
  from the OAuth path, but it is the shared plumbing in scope.
- **Google, all three paths** (`google-oauth.ts:184`, `:206`, `:252`) — Path 1
  and Path 3 verify the id_token signature and audience via
  `google-auth-library`; Path 2 checks `aud` against `tokeninfo` before trusting
  any identity field and takes only display fields from `userinfo`. The comment
  at lines 21-36 correctly states why `userinfo` alone is insufficient. This is
  the reference implementation the other eleven should be measured against.
- **`POST /auth/link/<provider>`** (`routes.ts:605-647`) — requires a live
  session, refuses an identity already owned by another user (line 628), is
  idempotent for a re-link (line 634), and the comment at lines 594-603 gives
  the correct reason why the email-verification requirement is deliberately
  *absent* here and present on sign-in. Genuinely well done.
- **Provider identity keys** — every provider keys on the provider's own stable
  id (`sub`, `uuid`, numeric `id`), never on the email. `getUserByIdentity`
  (`routes.ts:510`) runs before any email lookup, so an email change at the
  provider does not lose or move the account.
- **Email normalization** — `getUserByEmail` normalizes internally
  (`server-postgres/src/auth/services.ts:269`), so the un-normalized
  `externalUser.email` at `routes.ts:514` still matches the `lower(email)`
  unique index. The case-mismatch duplicate-account bug I went looking for is
  not there.
- **Bitbucket's email selection** (`bitbucket-oauth.ts:64-66`) — filters
  `is_primary && is_confirmed`, falls back to any `is_confirmed`, returns `null`
  rather than guessing. The correct pattern.
- **Twitter's PKCE and placeholder handling** (`twitter-oauth.ts:24`, `:112`) —
  requires `code_verifier`, and explicitly sets `emailVerified: false` for the
  placeholder with a comment naming the auto-link consequence.
- **Rate limiting** — `defaultAuthLimiter` is applied to both the sign-in and
  link routes (`routes.ts:495`, `:605`), same as `/auth/login`.
- **Cookie flags** (`cookie-utils.ts:36-47`) — `HttpOnly` always, `SameSite`
  defaults to `Lax`, `Secure` inferred from the scheme and forced when
  `SameSite=None`, `Max-Age` clamped to the 400-day browser ceiling.
- **`jwt.ts:186-190`** — algorithm pinned to HS256 on verify (no `alg: none` /
  confusion), and purpose-scoped download tokens are explicitly rejected as
  access tokens.
- **First-user promotion** is correctly bounded to the genuine first user on the
  OAuth path (`routes.ts:552-556`), and `auth-routes.test.ts:1669` tests it
  through the real route rather than through a mock that cannot fail. The gap in
  F3 is the *registration policy*, not the promotion arithmetic.
- **No open redirect.** There is no server-side post-login return URL anywhere
  in the OAuth path; `LoginView.tsx:285` builds the return target from
  `window.location.origin + pathname`, which cannot be steered by a query
  parameter.
- **No tokens in logs from the eleven non-Google providers.** Each logs
  `await tokenResponse.text()` from a *failed* exchange, which by definition
  carries no token, and none logs `access_token` on success.

---

## Open questions

1. **Is `POST /auth/<provider>` reachable without the frontend?** It is a plain
   JSON endpoint with no origin check and no CSRF token. F4 assumes the browser
   posts it; a direct `curl` with a stolen code works identically. Worth
   deciding whether these routes should require an `Origin` match when
   `cookieAuth` is enabled.
2. **Spotify's and Facebook's actual email-confirmation policy.** I labelled the
   provider-side behaviour UNCONFIRMED in F1 because verifying it means creating
   accounts at those providers. The code defect stands either way, but the
   severity of the Spotify variant specifically hinges on it.
3. **Does any Rebase deployment key authorization on `user.email`?** F2's impact
   is bounded by the answer. If the SaaS console or any tenant matches org
   invitations or role grants by email address, F2 rises to a takeover.
4. **`microsoft-oauth.ts:17` — is `"common"` the intended default?** Every other
   provider has a single issuer. This one silently federates to every Entra
   tenant that exists, and the doc comment at lines 75-83 suggests the author
   believed `mail` compensated for that.
5. **Should `emailVerified` be required rather than optional?**
   (`interfaces.ts:64`.) Making it non-optional would not have caught the five
   hardcoded `true`s, but a discriminated shape —
   `{ emailVerification: "provider-verified" | "unverified" | "not-reported" }`
   — would have forced each author to state which one they meant, and
   `not-reported` would be the honest answer for Spotify, Facebook and GitLab.
6. **Was the GitLab `baseUrl` (`gitlab-oauth.ts:14`) ever meant to be
   per-request?** It is config-only today, which is correct. Flagging it so it
   stays that way — a caller-supplied instance URL would turn the provider into
   an SSRF primitive and an arbitrary-identity oracle in one step.
