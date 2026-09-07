---
title: Auth endpoints and tokens
sidebar_label: Auth endpoints
description: The authentication routes the Rebase backend mounts, their response shapes, multi-factor authentication, the database context a policy sees, JWKS and service keys.
---

The routes [the `auth` block](/docs/backend/authentication/) mounts, and the tokens they hand back.

## Auth Endpoints

All auth endpoints are mounted at `/api/auth/`:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Create a new account |
| `POST` | `/api/auth/login` | Login with email/password |
| `POST` | `/api/auth/refresh` | Refresh the access token |
| `POST` | `/api/auth/<provider>` | OAuth sign-in (e.g., `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Link an OAuth provider to the authenticated account |
| `POST` | `/api/auth/logout` | Revoke refresh token |
| `POST` | `/api/auth/forgot-password` | Send password reset email |
| `POST` | `/api/auth/reset-password` | Reset password with token |
| `POST` | `/api/auth/find-user` | Resolve an email to a minimal public profile (opt-in — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Change the caller's own password (authenticated) |
| `GET` | `/api/auth/me` | The caller's own profile |
| `PATCH` | `/api/auth/me` | Update the caller's own profile |
| `GET` | `/api/auth/config` | What this backend offers a sign-in screen — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders`. Unauthenticated, and computed from the same predicates the routes enforce, so what the screen advertises cannot drift from what it can do |
| `POST` | `/api/auth/send-verification` | Send the caller an email-verification link |
| `GET` | `/api/auth/verify-email` | Consume a verification link (the URL in that email) |
| `POST` | `/api/auth/magic-link` | Email a one-time sign-in link. `503 EMAIL_NOT_CONFIGURED` without SMTP |
| `POST` | `/api/auth/magic-link/verify` | Exchange a magic-link token for a session |
| `POST` | `/api/auth/otp` | Email a six-digit sign-in code. Answers the same whether or not the address has an account |
| `POST` | `/api/auth/otp/verify` | Exchange `{ email, code }` for a session |
| `POST` | `/api/auth/anonymous` | Create an anonymous session (opt-in — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Attach real credentials to the anonymous account already signed in |
| `GET` | `/api/auth/sessions` | List the caller's active sessions (refresh tokens) |
| `DELETE` | `/api/auth/sessions` | Revoke every session, this one included — remote logout on every device |
| `DELETE` | `/api/auth/sessions/:id` | Revoke one session |
| `GET` | `/.well-known/jwks.json` | The public JWKS — mounted at the root, not under `basePath`, because that is where a verifier looks. Present when [asymmetric signing](#asymmetric-tokens-and-jwks) is configured |
| `POST` | `/api/auth/mfa/enroll` | Start TOTP enrolment (returns the secret and recovery codes) |
| `POST` | `/api/auth/mfa/verify` | Confirm an enrolment with a code from the authenticator |
| `GET` | `/api/auth/mfa/factors` | List the caller's enrolled factors |
| `POST` | `/api/auth/mfa/challenge` | Open a challenge against a verified factor |
| `POST` | `/api/auth/mfa/challenge/verify` | Answer a challenge — this is what issues the session |
| `DELETE` | `/api/auth/mfa/unenroll` | Remove a factor (requires an `aal2` session) |

Administrative user and role management is a **separate surface**, mounted at
`/api/admin/` rather than `/api/auth/`, and gated on the `admin` role or the
service key:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/users` | List users (paginated) |
| `POST` | `/api/admin/users` | Create a user |
| `GET` | `/api/admin/users/:uid` | Read one user |
| `PUT` | `/api/admin/users/:uid` | Update one user |
| `DELETE` | `/api/admin/users/:uid` | Delete one user |
| `POST` | `/api/admin/users/:uid/reset-password` | Reset a user's password without their current one |
| `GET` | `/api/admin/roles` | List the roles this backend knows |
| `POST` | `/api/admin/bootstrap` | Let the earliest-registered user claim the admin role while none exists. Refused in production — see [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |

All data API endpoints require a valid `Authorization: Bearer <token>` header when `requireAuth: true` (the default).

### Response format

Every endpoint that issues a session answers with the same envelope — `register`,
`login`, each OAuth provider, `magic-link/verify`, `otp/verify`, `anonymous`,
`anonymous/link` and `mfa/challenge/verify`:

```json
{
  "user": {
    "uid": "8f1c2a6e-…",
    "email": "jane@example.com",
    "displayName": "Jane Doe",
    "photoURL": null,
    "providerId": "password",
    "isAnonymous": false,
    "emailVerified": true,
    "roles": ["editor"],
    "metadata": {}
  },
  "tokens": {
    "accessToken": "eyJhbGciOi…",
    "refreshToken": "9b2e…",
    "accessTokenExpiresAt": 1700000000000
  }
}
```

Send the access token back as `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` is epoch milliseconds.

`POST /api/auth/refresh` answers with the same envelope, with two caveats: `user`
is omitted entirely when the account cannot be re-read, so treat it as optional
there, and `providerId` is always `password` however the session was first
created.

:::caution[The client SDK flattens this envelope — raw HTTP does not]
The JSON above is the wire format, and it is what `fetch("/api/auth/login")`
returns: the token lives at **`body.tokens.accessToken`**.

The [client SDK](/docs/sdk/authentication) unwraps `tokens` before it hands the
session back, so `auth.signInWithEmail()` resolves to a flattened
**`{ user, accessToken, refreshToken }`** instead.

Both shapes are real; they belong to two different layers. Reading the SDK's
shape off a raw `fetch` yields `undefined`, which shows up as "login succeeded
but there is no access token" — the login was fine, the token was one level down.
:::

With [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) enabled the refresh
token travels as an `httpOnly` cookie and `tokens.refreshToken` is an empty
string in the body. The access token is unaffected.

### Multi-factor authentication (TOTP)

**A second factor gates sign-in, not just individual operations.** Once an
account has one *verified* TOTP factor, no route issues it a session until a
code is presented — password login, every OAuth provider, magic link and
anonymous-link all refuse with `401 MFA_REQUIRED`:

```json
{
  "error": {
    "code": "MFA_REQUIRED",
    "message": "Multi-factor authentication is required to complete sign-in.",
    "details": {
      "mfaToken": "<short-lived pre-auth token>",
      "factors": [{ "id": "…", "factorType": "totp", "friendlyName": "Phone" }]
    }
  }
}
```

`mfaToken` is **not a session**: it is purpose-scoped, expires in five minutes,
and is rejected by every authenticated route. Send it as the bearer token to
`POST /api/auth/mfa/challenge` (with a `factorId`) and then to
`POST /api/auth/mfa/challenge/verify` (with the `challengeId` and the six-digit
code, or a recovery code). That last call is what mints the access and refresh
tokens, at `aal2`; the level is stored on the session and carried across
`POST /api/auth/refresh`.

Enrolment is gated too. The first factor on an account may be enrolled from an
ordinary session, but once one is verified, `enroll`, `verify` and `unenroll`
all require an `aal2` session — otherwise a stolen password could enrol a
factor of its own, step up on it, and delete the real one.

Verification is bounded on both axes: a challenge dies after five failed
guesses, each account is limited to ten verification attempts per 15 minutes
(counted per user, so rotating IPs does not help), and an accepted code is
recorded against the factor so it cannot be replayed for the rest of its
±1-step window.

Set `MFA_ENCRYPTION_KEY` (32+ random characters) to encrypt stored TOTP
secrets. Without it the server falls back to `JWT_SECRET` and warns. Set it
**before** anyone enrols: stored secrets carry no key id, so changing the key
afterwards leaves existing factors undecryptable and their owners unable to
complete a challenge.

### Inviting teammates by email

Invite flows need to turn an email address into a user id, but the `users`
collection is RLS-protected from the client. Instead of hand-rolling an admin
server function, opt into the built-in lookup:

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // enables POST /api/auth/find-user
    },
});
```

Then, from the client:

```typescript
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, user_id: profile.uid });
}
```

The endpoint is **authenticated-only** and returns just `uid`, `displayName`,
and `photoURL` — never the email, roles, or metadata of the looked-up user. It
is **off by default** because it lets any signed-in user probe which emails have
accounts; enable it only when your invite UX needs it.

## Row-Level Security (RLS) Database Context

Rebase bridges request authentication directly down to PostgreSQL Row-Level Security (RLS). Every database query executed through a user-scoped driver runs inside a database transaction (`db.transaction()`) that configures transaction-local configuration parameters:

*   `app.user_id` — The authenticated user's unique ID (`uid`). Defaults to `'anon'` for unauthenticated requests.
*   `app.user_roles` — A comma-separated string listing the user's assigned roles.
*   `app.jwt` — A JSON string containing the full JWT claims payload (`{"sub": "<uid>", "roles": [...]}`).

These parameters are configured locally for the duration of the transaction using Postgres's `set_config` function:
```sql
SELECT 
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.jwt', $3, true);
```

### PostgreSQL Policy Helper Functions

To make writing Row-Level Security policies simple, Rebase creates helper functions under the `auth` schema during database bootstrapping:

*   **`rebase.uid()`** — Returns the authenticated user's ID as `text`, or `NULL` if not set:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Returns the comma-separated roles string:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Returns the full JWT payload as a `jsonb` object:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```

You can use these helpers directly in your custom security rules or database migrations:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Asymmetric Tokens and JWKS

By default access tokens are signed with `jwtSecret` (HS256). That works, but it
means anything that needs to *verify* a token has to hold the key that *mints*
one — so a gateway or an edge worker checking a session can also forge one — and
changing the secret signs every user out at once.

Configure a signing key and Rebase signs access tokens asymmetrically instead,
publishing the public half at **`/.well-known/jwks.json`** for anyone to verify
against:

```typescript no-verify
auth: {
    jwtSecret: process.env.JWT_SECRET,
    signingKeys: [
        { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY! }
    ]
}
```

Or from the environment, for a single key:

```bash
JWT_PRIVATE_KEY="$(cat jwt-key.pem)"
JWT_KEY_ID=2026-08
```

Generate a key with:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

RSA keys work too and sign `RS256`; EC P-256 keys sign `ES256`. Only the private
key is configured — the public half is derived from it, so the pair cannot be
mismatched. `jwtSecret` stays required either way: it still signs the
purpose-scoped tokens (download links, MFA-pending, password reset) that only
this server ever reads.

### Rotating a key

Put the new key first and keep the old one listed. New tokens are signed by the
new key; tokens already in circulation keep verifying against the old one until
they expire, so nobody is signed out.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Once the longest access-token lifetime has passed, drop the old entry. Use
`activeKid` if you want to publish a key before signing with it.

### Verifying elsewhere

Tokens carry the signing key's `kid` in their header, which is how a verifier
picks the right key out of the JWKS and how it knows to re-fetch after a
rotation. Any standard library does this for you — for example, with `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
With no `signingKeys` configured, `/.well-known/jwks.json` answers
`{"keys":[]}` and tokens stay HS256. Nothing changes until you add a key.
:::

## Service Key Authentication

For server-to-server communication (e.g., cron jobs, external services), configure a static service key:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Clients authenticate with the `Authorization: Bearer <service-key>` header. 

### Internal Per-Boot Key

If `REBASE_SERVICE_KEY` is not provided in your configuration, Rebase automatically generates a random **internal per-boot key**. 

This key is never logged and never leaves the process. It is used by the `rebase` singleton to authenticate against the server's own control-plane APIs (auth, storage, etc.). This ensures that administrative tasks (like sending a welcome email or generating a storage URL) always function out-of-the-box in development and production without requiring manual key management.

### Timing-Attack Protection & Key Requirements

To prevent timing attacks, Rebase validates both the user-configured service key and the internal key using constant-time string comparison (`safeCompare`). The user-configured service key **must be at least 32 characters long**; if a key shorter than 32 characters is configured, Rebase will throw a configuration error on startup and fail-closed.

## Next Steps

- **[Authentication](/docs/backend/authentication/)** — the configuration these routes come from
- **[Custom auth adapters](/docs/backend/auth-adapters/)** — replacing the provider behind them
- **[Security Rules (RLS)](/docs/collections/security-rules/)** — what a policy does with `rebase.uid()`
- **[Client SDK Authentication](/docs/sdk/authentication/)** — calling these routes from the SDK
