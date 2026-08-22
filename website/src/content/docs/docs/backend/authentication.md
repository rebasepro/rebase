---
title: Authentication
sidebar_label: Authentication
description: Configure JWT authentication, OAuth providers, SMTP email, auth hooks, and custom auth adapters on the backend.
---

## Overview

Rebase includes a complete backend authentication system:

- **JWT tokens** — Access and refresh token flow with configurable expiration
- **OAuth providers** — Google, LinkedIn, GitHub, Microsoft, Apple, and more
- **SMTP email** — Password reset and email verification flows
- **Auth hooks** — Lifecycle hooks for user creation and more
- **Custom auth adapters** — Plug in Firebase Auth, Auth0, Clerk, or any external provider
- **Service key** — Static key for server-to-server authentication
- **Auto-bootstrapping** — First user automatically gets the admin role

## Configuration

The `auth` block in `initializeRebaseBackend` controls all backend authentication:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    auth: {
        collection: usersCollection,         // Your users collection definition
        jwtSecret: env.JWT_SECRET,           // Required — signing secret
        accessExpiresIn: "1h",               // Access token lifetime (default: 1h)
        refreshExpiresIn: "30d",             // Refresh token lifetime (default: 30d)
        serviceKey: env.REBASE_SERVICE_KEY,  // Optional — for server-to-server calls
        allowRegistration: true,             // Allow new signups (default: false)

        // OAuth providers
        google: env.GOOGLE_CLIENT_ID
            ? { clientId: env.GOOGLE_CLIENT_ID }
            : undefined,

        // SMTP email (for password reset, email verification)
        email: env.SMTP_HOST
            ? {
                from: env.SMTP_FROM || `${env.APP_NAME} <noreply@example.com>`,
                smtp: {
                    host: env.SMTP_HOST,
                    port: env.SMTP_PORT,              // 587 for TLS, 465 for SSL
                    secure: env.SMTP_SECURE,           // true for port 465
                    auth: env.SMTP_USER
                        ? { user: env.SMTP_USER, pass: env.SMTP_PASS! }
                        : undefined,
                    name: env.SMTP_NAME,               // Optional EHLO/HELO hostname
                },
                appName: env.APP_NAME,
                logoUrl: env.EMAIL_LOGO_URL,           // Logo shown atop the default templates
                resetPasswordUrl: env.FRONTEND_URL,    // URL for password reset page
            }
            : undefined,

        // Lifecycle hooks
        hooks: {
            afterUserCreate: async (user) => {
                console.log(`New user registered: ${user.email}`);
            }
        }
    }
});
```

### The `auth` block, in full

| Key | Type | Default | What it does |
|-----|------|---------|--------------|
| `collection` | `CollectionConfig` | — | The users collection. See [Collection-Level Auth Configuration](#collection-level-auth-configuration) |
| `jwtSecret` | `string` | — | HS256 signing secret. Required in production |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Asymmetric signing keys — see [Asymmetric Tokens and JWKS](#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | first key | Which of `signingKeys` mints new tokens |
| `accessExpiresIn` | `string` | `1h` | Access-token lifetime |
| `refreshExpiresIn` | `string` | `30d` | Refresh-token lifetime. Sliding: each rotation re-ups it. The runtime passes `JWT_REFRESH_EXPIRES_IN`, whose own default is `400d` |
| `requireAuth` | `boolean` | `true` | Require a session for the data API |
| `allowRegistration` | `boolean` | `false` | Open `POST /api/auth/register`. The first user on an empty table is admitted either way |
| `disableSelfRegistration` | `boolean` | `false` | Kill switch: also closes the first-user bootstrap window that `allowRegistration: false` leaves open |
| `allowAnonymous` | `boolean` | `false` | Enable `POST /api/auth/anonymous`. Deliberately not gated by `allowRegistration` — a public read-mostly app can want sessions without accounts |
| `allowUserLookup` | `boolean` | `false` | Mount `POST /api/auth/find-user` for invite-by-email flows |
| `defaultRole` | `string` | — | Role given to a newly registered user when none is specified |
| `serviceKey` | `string` | — | Static key for server-to-server calls — see [Service Key Authentication](#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, for password reset, verification, invitations and magic links |
| `magicLink` | `boolean` | `false` | Enable passwordless email sign-in. Needs `email` configured; without it the routes answer `503 EMAIL_NOT_CONFIGURED` |
| `cookieAuth` | `CookieAuthConfig` | — | Deliver the refresh token as an `httpOnly` `Secure` `SameSite` cookie instead of in the JSON body — see below |
| `providers` | `OAuthProvider[]` | `[]` | The canonical OAuth array; the named provider fields resolve into it |
| `allowedRedirectUris` | `string[]` | — | Narrow which redirect URIs the OAuth routes accept |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Refresh tokens in an `httpOnly` cookie

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

The refresh token is the long-lived credential, and in the default JSON-body
mode any XSS on the page can read it. `cookieAuth` moves it into a cookie the
page's own JavaScript cannot touch. The **access** token stays in the JSON body,
because the client has to put it in an `Authorization` header.

Two things have to follow, or sign-in breaks rather than degrades: client fetches
to the auth endpoints need `credentials: "include"`, and CORS has to allow
credentials — which means an explicit origin list, never `origin: "*"`.
`AUTH_COOKIE_SAME_SITE` is the environment spelling of `sameSite`.

| Key | Default | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | current domain | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` is only for a genuinely cross-site frontend |
| `secure` | auto | Forced on when `sameSite` is `None`; otherwise taken from the request protocol |

:::caution[Collection callbacks do not fire for auth users]
User creation and updates through the auth system — registration, admin user
management, and OAuth — write **directly** to the user store and bypass the
collection save pipeline. A `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`
callback on the auth (users) collection will **not** run for these paths. For
side effects like provisioning a personal team on signup, use the auth lifecycle
hooks (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), which
receive the fully-populated user record.
:::

### Bot protection

Rate limiting bounds one caller. A thousand addresses sending one request each
never touch a per-IP window — and `/auth/register`, `/auth/forgot-password` and
`/auth/magic-link` all send mail, so the bill for an unprotected form is paid in
reputation on your sending domain.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

Or from the environment, which is what a managed deployment has:

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink   # optional; this is the default
```

The client sends the widget's token as `captchaToken` in the JSON body, or in
the widget's own `cf-turnstile-response` / `h-captcha-response` header. Both are
accepted; set `tokenField` to use a different body key.

**`login` is not protected by default.** A challenge on every sign-in taxes every
real user, and credential stuffing is what the rate limiter and account lockout
are for. Add it to `routes` if you want it.

#### It fails closed

If the provider cannot be reached, verification fails and the request is
refused. An attacker able to cause that outage could otherwise switch the
protection off, which is the one thing a challenge must not allow.

The cost is that a provider outage blocks sign-ups. That is loud, visible, and
undone by removing one config key — a better failure than a silent one noticed
when the mail domain gets blocklisted.

#### A misconfiguration fails the boot

`enabled: true` with no provider, an unknown provider, or no secret all refuse to
start. A challenge that is silently absent while the config says it is there is
the one failure this cannot have.

The caller is told only that the challenge failed — never whether the token was
absent, malformed, already used, or unverifiable. Which one it was goes to the
log, because telling a script tells it how to get closer.

### Email in development

Without `SMTP_HOST`, auth mail has nowhere to go. Rather than refusing the
request, a development server captures the message and prints its links:

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Follow the link and the flow completes. Nothing about the token changes — it is
minted, stored and validated exactly as it would be from a real inbox; only
delivery is different.

This is on whenever all three hold, and there is no setting that changes them:

- `SMTP_HOST` is unset — a configured mail server always wins;
- `NODE_ENV` is not `production`. A captured password-reset mail carries a
  working reset token, so the capture buffer is a credential store and must not
  exist in production;
- `FRONTEND_URL` is an absolute `http(s)` URL, because otherwise the emailed
  link has no base and would be dead on arrival.

If any of them does not hold, `POST /auth/magic-link` and
`POST /auth/forgot-password` answer `503 EMAIL_NOT_CONFIGURED` as before. In
production, set `SMTP_HOST` (or `auth.email.sendEmail`) to send mail for real.

### Branding the default emails

The built-in password-reset, verification, invitation, welcome and magic-link
templates render a logo above the card. It comes from `email.logoUrl`:

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

It must be a **PNG or JPG on an absolute `http(s)` URL**. Mail clients do not
render SVG and block `data:` URIs, and the image is fetched by the recipient's
client rather than by your server — so a relative path, a data URI or a local
file renders no logo rather than a broken image. `appName` is used as the `alt`
text, so a client with images turned off still shows the name.

The fallback is deliberately asymmetric. `appName` falls back to `Rebase`, but
the logo only falls back to the Rebase mark while the install has **not** renamed
itself. Set `appName` to anything else and you get no logo until you set
`logoUrl` — otherwise Acme's users would receive a Rebase mark in mail signed by
Acme's domain.

If you replace a template through `email.templates`, none of this applies: your
function owns the whole body.

### OAuth Providers

Each OAuth provider is configured with at minimum a `clientId`. Some providers require a `clientSecret`:

```typescript
auth: {
    google:    { clientId: "..." },
    linkedin:  { clientId: "...", clientSecret: "..." },
    github:    { clientId: "...", clientSecret: "..." },
    microsoft: { clientId: "...", clientSecret: "...", tenantId: "..." },
    apple:     { clientId: "...", teamId: "...", keyId: "...", privateKey: "..." },
    facebook:  { clientId: "...", clientSecret: "..." },
    twitter:   { clientId: "...", clientSecret: "..." },
    discord:   { clientId: "...", clientSecret: "..." },
    gitlab:    { clientId: "...", clientSecret: "..." },
    bitbucket: { clientId: "...", clientSecret: "..." },
    slack:     { clientId: "...", clientSecret: "..." },
    spotify:   { clientId: "...", clientSecret: "..." },
}
```

`gitlab` also takes an optional `baseUrl`, for a self-hosted GitLab instance.

Each named field is resolved at startup into `auth.providers`, which is the
canonical array and the extension point for anything the named fields do not
cover. Entries are built with the `create*Provider` factories, and the two forms
merge — named fields are appended after explicit entries:

```typescript no-verify
import { createGoogleProvider, createGitHubProvider } from "@rebasepro/server";

auth: {
    providers: [
        createGoogleProvider({ clientId: "…", clientSecret: "…" }),
        createGitHubProvider({ clientId: "…", clientSecret: "…" })
    ]
}
```

#### Narrowing the redirect URIs

```typescript no-verify
auth: { allowedRedirectUris: ["https://admin.example.com/"] }
```

Left unset, the only check on an OAuth redirect is the provider's own
registered-URI match — which authorises **every** URI registered on that OAuth
client, including the `localhost` entry someone added for development and the
staging host nobody removed. Listing the origins this backend actually serves
narrows it to those. URIs are compared on origin plus path; query, fragment and
a trailing slash are ignored.

### Account Linking Across Sign-In Methods

What happens when someone registers with email/password as `ada@example.com`,
then later clicks "Sign in with Google" on a Google account with that same
address? Rebase **links the two into one account** — but only when the provider
asserts the email as verified. It never silently creates a second account for
the same address.

On `POST /api/auth/<provider>` the resolution order is:

1. **Known provider identity** — if this exact provider identity has signed in
   before, that user is returned. The email is not consulted.
2. **Existing account with the same email, provider verified it** — the
   identity is attached to the existing account and the user is signed in to
   it. One account, two ways in.
3. **Existing account with the same email, provider did NOT verify it** —
   rejected with `403 EMAIL_NOT_VERIFIED`. Nothing is created or modified.
4. **No account with that email** — a new account is created.

Step 3 is the security-critical case. If an unverified provider email were
enough to link, anyone who could get a provider to emit an address they don't
own could take over the matching Rebase account. Google always asserts
`email_verified` for real Google accounts, so step 2 is the normal path for
Google sign-in; step 3 mostly catches providers that let users supply an
arbitrary unconfirmed address.

This behavior is not configurable — there is deliberately no option to link on
unverified emails.

To recover from a step-3 rejection, the user signs in with their existing
method and calls the explicit link endpoint:

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

Linking while authenticated intentionally does **not** require a verified
email, and does not require the emails to match at all — a user's Google
address is often not their app address. The asymmetry is deliberate: on
sign-in the provider's email is the only evidence tying the incoming identity
to an account, whereas here the caller has already proven ownership by holding
a valid session. It returns `409 IDENTITY_ALREADY_LINKED` if that provider
identity belongs to another user, and is idempotent if it is already linked to
the caller.

#### The reverse direction

A user who signed up with Google and has no password:

- **Registering with the same email** is refused with `409 EMAIL_EXISTS`.
- **`POST /api/auth/change-password`** returns `400 INVALID_ACCOUNT` — there is
  no existing password to verify against.
- **`forgot-password` → `reset-password` is the supported way to add one.**
  It re-proves ownership of the address by email, after which the account has
  both sign-in methods.

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
| `GET` | `/api/auth/config` | What this backend offers a sign-in screen — `needsSetup`, `registrationEnabled`, `emailServiceEnabled`, `magicLinkEnabled`, `anonymousLoginEnabled`, `enabledProviders`. Unauthenticated, and computed from the same predicates the routes enforce, so what the screen advertises cannot drift from what it can do |
| `POST` | `/api/auth/send-verification` | Send the caller an email-verification link |
| `GET` | `/api/auth/verify-email` | Consume a verification link (the URL in that email) |
| `POST` | `/api/auth/magic-link` | Email a one-time sign-in link. `503 EMAIL_NOT_CONFIGURED` without SMTP |
| `POST` | `/api/auth/magic-link/verify` | Exchange a magic-link token for a session |
| `POST` | `/api/auth/anonymous` | Create an anonymous session (opt-in — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Attach real credentials to the anonymous account already signed in |
| `GET` | `/api/auth/sessions` | List the caller's active sessions (refresh tokens) |
| `DELETE` | `/api/auth/sessions` | Revoke every session, this one included — remote logout on every device |
| `DELETE` | `/api/auth/sessions/:id` | Revoke one session |
| `GET` | `/api/auth/jwks.json` | The public JWKS, when [asymmetric signing](#asymmetric-tokens-and-jwks) is configured |
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
| `POST` | `/api/admin/bootstrap` | Create the first administrator on an empty user table — see [First User Bootstrap](#first-user-bootstrap) |

All data API endpoints require a valid `Authorization: Bearer <token>` header when `requireAuth: true` (the default).

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
const profile = await rebase.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await rebase.data.team_members.create({ team_id, user_id: profile.uid });
}
```

The endpoint is **authenticated-only** and returns just `uid`, `displayName`,
and `photoURL` — never the email, roles, or metadata of the looked-up user. It
is **off by default** because it lets any signed-in user probe which emails have
accounts; enable it only when your invite UX needs it.

## Auto-Created Tables

On first startup, Rebase automatically provisions the `auth` schema and the following tables in the database (bound to the schema defined in your collection, e.g., `rebase`):

- **`rebase.users`** — User accounts with email, password hash, metadata, and a `roles` text[] column (roles are stored as inline text arrays to optimize queries and avoid joins).
- **`rebase.refresh_tokens`** — Long-lived sessions carrying hashed refresh tokens, user agents, and IP addresses. Includes a unique index on `token_hash` and a unique constraint on `(user_id, user_agent, ip_address)` to track active device sessions.
- **`rebase.password_reset_tokens`** — Expirable single-use tokens for password recovery flows.
- **`rebase.mfa_factors`** — Enrolled multi-factor authentication methods (e.g. TOTP secrets encrypted with AES-256).
- **`rebase.mfa_challenges`** — Verification logs tracking active MFA verification attempts.
- **`rebase.recovery_codes`** — Hashed multi-factor backup/recovery codes.
- **`rebase.app_config`** — Key-value store for system configurations.

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

## First User Bootstrap

When no users exist in the database, the first person to register automatically becomes an admin. After that, registration is controlled by the `allowRegistration` setting.

This ensures you can always bootstrap a fresh deployment without needing to seed the database manually. To prevent concurrent runs and schema generation race conditions on hot reloading (HMR) or startup, bootstrapping operations are synchronized using a Postgres advisory lock:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Collection-Level Auth Configuration

Instead of relying solely on the default database auth rules, you can mark any Postgres collection (such as `users.ts` or a custom `members.ts` collection) as the authentication collection. This is configured via the `auth` property on the collection itself:

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const membersCollection = defineCollection({
  name: "Members",
  slug: "members",
  table: "members",
  auth: {
    enabled: true,
    
    // Customize what happens when an admin creates a user via the REST API
    onCreateUser: async (values, ctx) => {
      const hash = await ctx.hashPassword("welcome123");
      return {
        values: { ...values, passwordHash: hash, emailVerified: true },
        temporaryPassword: "welcome123"
      };
    },

    // Customize what happens when an admin resets a user's password in the admin panel
    onResetPassword: async (userId, ctx) => {
      const tempPassword = "reset_" + Math.random().toString(36).substring(2, 8);
      return {
        temporaryPassword: tempPassword,
        invitationSent: false
      };
    },

    // Inject/override auth-specific actions (e.g. show/hide the reset password button)
    actions: {
      resetPassword: true // Or false to disable, or a custom EntityAction
    }
  },
  properties: { ... }
});
```

When custom hooks (`onCreateUser`, `onResetPassword`) are called, they receive an `AuthCollectionContext` facade containing:
- `hashPassword(password: string): Promise<string>` — Hash password using the configured hashing algorithm (e.g. scrypt).
- `sendEmail?: (options) => Promise<void>` — Send an email (only available when email service is configured).
- `emailConfigured: boolean` — Whether email service is configured.
- `appName: string` — The app name from email config.
- `resetPasswordUrl: string` — The password reset link base URL.

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


## Custom Auth Adapters

Rebase allows complete replacement of the built-in authentication system via a pluggable authentication architecture. This decouples authentication verification from the database and REST/WebSocket layers, enabling seamless integration with external providers such as **Clerk**, **Auth0**, **Firebase Auth**, or custom JWT identity services.

### The AuthAdapter Contract

You can implement the `AuthAdapter` interface directly for complete control. The interface definition is as follows:

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { AuthenticatedUser, AuthAdapterCapabilities, UserManagementAdapter, UserCreationPrepareResult, UserCreationFinalizeResult } from "@rebasepro/types";

export interface AuthAdapter {
  /** Unique identifier for this auth adapter (e.g., "clerk", "custom") */
  readonly id: string;

  /**
   * Verifies an incoming HTTP request and returns the authenticated user payload.
   * Called by Hono authentication middleware on every REST endpoint.
   */
  verifyRequest(request: Request): Promise<AuthenticatedUser | null>;

  /**
   * Verifies a raw token string (e.g. for WebSocket connection handshake phase 1).
   * If omitted, a synthetic request is automatically constructed.
   */
  verifyToken?(token: string): Promise<AuthenticatedUser | null>;

  /** Optional user management operations (CRUD) for the Admin Dashboard panel */
  userManagement?: UserManagementAdapter;

  /** Optional: Mount adapter-specific custom public routes (e.g. callback paths) */
  createAuthRoutes?(): Hono<any, any, any> | undefined;

  /** Optional: Mount adapter-specific admin-only routes */
  createAdminRoutes?(): Hono<any, any, any> | undefined;

  /** Advertise supported capabilities (to customize Admin Dashboard UI visibility) */
  getCapabilities(): AuthAdapterCapabilities | Promise<AuthAdapterCapabilities>;

  /** Lifecycle hooks called during backend start and graceful shutdown */
  initialize?(): Promise<void>;
  destroy?(): Promise<void>;

  /** Custom user lifecycle hooks (e.g., hash passwords before collection writes) */
  prepareUserCreation?(
    values: Record<string, unknown>,
    collectionAuth?: unknown
  ): Promise<UserCreationPrepareResult>;

  finalizeUserCreation?(
    entity: { id: string; values: Record<string, unknown> },
    clearPassword?: string
  ): Promise<UserCreationFinalizeResult>;

  /** Static service key to bypass checks for server-to-server calls */
  serviceKey?: string;
}
```

### The Authenticated User Payload

Regardless of the external authentication provider chosen, your adapter must resolve successful token verifications to a uniform `AuthenticatedUser` object. The Rebase RLS Scope Injector maps these values directly to PostgreSQL session variables inside transactions:

```typescript
export interface AuthenticatedUser {
  uid: string;                    // Maps to pg local 'app.user_id' -> rebase.uid()
  email: string;                  // User email address
  displayName?: string | null;    // Optional display name
  photoUrl?: string | null;        // Optional avatar URL
  roles: string[];                // Maps to pg local 'app.user_roles' -> rebase.roles()
  isAdmin: boolean;               // Grants global superuser privileges if true
  rawToken?: string;              // The original token string (for downstream forwarding)
  claims?: Record<string, any>;   // Custom claims/metadata (available in rebase.jwt())
}
```

---

### Quick Integration via `createCustomAuthAdapter`

For standard scenarios (such as validating JWTs from a third-party service), you can use the `createCustomAuthAdapter` utility. This utility handles capabilities defaults and implements WebSocket token validation out-of-the-box by wrapping your `verifyRequest` implementation.

#### Example: Integrating with Clerk

To connect a Rebase backend with **Clerk**, you can verify Clerk JWT tokens using Clerk's JSON Web Key Set (JWKS):

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";
import { createCustomAuthAdapter } from "@rebasepro/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Clerk JWKS URL
const CLERK_JWKS_URL = "https://clerk.your-domain.com/.well-known/jwks.json";
const JWKS = createRemoteJWKSet(new URL(CLERK_JWKS_URL));

const clerkAuthAdapter = createCustomAuthAdapter({
    serviceKey: process.env.REBASE_SERVICE_KEY,
    verifyRequest: async (request) => {
        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace("Bearer ", "");
        if (!token) return null;

        try {
            // Verify Clerk JWT token against JWKS
            const { payload } = await jwtVerify(token, JWKS);
            
            const metadata = payload.metadata as Record<string, unknown> | undefined;
            const roles = Array.isArray(metadata?.roles) ? metadata.roles as string[] : [];
            
            return {
                uid: payload.sub!,
                email: (payload as Record<string, unknown>).email as string || "",
                displayName: (payload as Record<string, unknown>).name as string || null,
                roles: roles,
                isAdmin: roles.includes("admin"),
                claims: payload as Record<string, unknown>
            };
        } catch (error) {
            console.error("Clerk token verification failed:", error);
            return null; // Fail-closed
        }
    },
    capabilities: {
        hasBuiltInAuthRoutes: false, // Login is managed by Clerk UI
        emailPasswordLogin: false,
        registration: false,
        passwordReset: false,
        profileUpdate: false,
        sessionManagement: false
    }
});

const backend = await initializeRebaseBackend({
    auth: clerkAuthAdapter,
    // ...
});
```

#### Example: Integrating with Firebase Auth

To verify Firebase Auth tokens using Firebase's public certificates:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";
import { createCustomAuthAdapter } from "@rebasepro/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_JWKS_URL = "https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com";
const JWKS = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
const FIREBASE_PROJECT_ID = "my-firebase-project-id";

const firebaseAuthAdapter = createCustomAuthAdapter({
    serviceKey: process.env.REBASE_SERVICE_KEY,
    verifyRequest: async (request) => {
        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace("Bearer ", "");
        if (!token) return null;

        try {
            const { payload } = await jwtVerify(token, JWKS, {
                issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
                audience: FIREBASE_PROJECT_ID
            });

            const roles = Array.isArray((payload as Record<string, unknown>).roles) ? (payload as Record<string, unknown>).roles as string[] : [];

            return {
                uid: payload.sub!,
                email: (payload as Record<string, unknown>).email as string || "",
                displayName: (payload as Record<string, unknown>).name as string || null,
                photoUrl: (payload as Record<string, unknown>).picture as string || null,
                roles: roles,
                isAdmin: roles.includes("admin"),
                claims: payload as Record<string, unknown>
            };
        } catch (error) {
            console.error("Firebase token verification failed:", error);
            return null;
        }
    }
});

const backend = await initializeRebaseBackend({
    auth: firebaseAuthAdapter,
    // ...
});
```

---

### Mounting Auth Routes and Admin UI Actions

If your custom auth provider requires mounting redirect endpoints (like OAuth callback routes or SAML login loops), implement the `createAuthRoutes` method on your adapter:

```typescript
const myOauthAdapter: AuthAdapter = {
    id: "custom-oauth",
    verifyRequest: async (req) => ({
        // validate the token, then return the caller
        uid: "…",
        email: "user@example.com",
        roles: [],
        isAdmin: false
    }),
    getCapabilities: () => ({
        hasBuiltInAuthRoutes: true,
        emailPasswordLogin: false,
        registration: false,
        passwordReset: false,
        adminPasswordReset: false,
        sessionManagement: false,
        profileUpdate: false,
        emailVerification: false,
        magicLink: false,
        enabledProviders: []
    }),
    createAuthRoutes: () => {
        const app = new Hono<HonoEnv>();
        
        // Mounted automatically under /api/auth/callback
        app.get("/callback", async (c) => {
            const code = c.req.query("code");
            // Exchange code for provider tokens and set cookies/redirect
            return c.redirect("/dashboard");
        });
        
        return app;
    }
};
```

If you wish to allow user CRUD operations directly inside the Rebase Admin Dashboard, implement the `userManagement` helper within the adapter options, which provides hooks for `listUsers`, `createUser`, `updateUser`, and `deleteUser`.


## Next Steps

- **[Frontend Authentication](/docs/frontend/authentication)** — Login UI, auth controller, user management
- **[Security Rules (RLS)](/docs/collections/security-rules)** — Row-level access control
- **[Client SDK Authentication](/docs/sdk/authentication)** — Auth methods in the client SDK
