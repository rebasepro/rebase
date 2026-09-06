---
title: Authentication
sidebar_label: Authentication
description: Configure JWT authentication, OAuth providers, SMTP email, bot protection and the users collection on the Rebase backend.
---

Authentication is three pages, because it is three jobs. This one is **configuration**: what goes in the `auth` block and in the environment.

- [Endpoints and tokens](/docs/backend/auth-endpoints/) — the routes the backend mounts, the response shapes, MFA, the database context a policy sees, JWKS and service keys.
- [Custom auth adapters](/docs/backend/auth-adapters/) — replacing the built-in provider with Clerk, Firebase Auth or your own.

## Overview

Rebase includes a complete backend authentication system:

- **JWT tokens** — Access and refresh token flow with configurable expiration
- **OAuth providers** — Google, LinkedIn, GitHub, Microsoft, Apple, and more
- **SMTP email** — Password reset and email verification flows
- **Auth hooks** — Lifecycle hooks for user creation and more
- **Custom auth adapters** — Plug in Firebase Auth, Auth0, Clerk, or any external provider
- **Service key** — Static key for server-to-server authentication
- **Auto-bootstrapping** — Outside production, the first user automatically gets the admin role; a production deployment names its admin with `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD` <span class="since-badge" data-since="0.18">Since 0.18</span>

## Configuration

:::note[Where this goes]
**Managed runtime:** environment — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` and the provider `*_CLIENT_ID` / `*_CLIENT_SECRET` pairs, one for each of the twelve providers ([the spellings](#the-environment-spellings); Apple's is four keys, not a pair). The users collection is whichever one the bundle names (`collections/users` by convention).
**No managed route:** `auth.hooks`. They are functions; eject to pass them.
**Ejected:** `initializeRebaseBackend({ auth })` in `backend/src/index.ts`.
:::

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
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Asymmetric signing keys — see [Asymmetric Tokens and JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | first key | Which of `signingKeys` mints new tokens |
| `accessExpiresIn` | `string` | `1h` | Access-token lifetime |
| `refreshExpiresIn` | `string` | `30d` | Refresh-token lifetime. Sliding: each rotation re-ups it. The runtime passes `JWT_REFRESH_EXPIRES_IN`, whose own default is `400d` |
| `requireAuth` | `boolean` | `true` | Require a session for the data API |
| `allowRegistration` | `boolean` | `false` | Open `POST /api/auth/register`. Outside production the first user on an empty table is admitted either way; in production the admin is named with `REBASE_ADMIN_EMAIL` <span class="since-badge" data-since="0.18">Since 0.18</span> |
| `disableSelfRegistration` | `boolean` | `false` | Kill switch: also closes the first-user bootstrap window that `allowRegistration: false` leaves open |
| `allowAnonymous` | `boolean` | `false` | Enable `POST /api/auth/anonymous`. Deliberately not gated by `allowRegistration` — a public read-mostly app can want sessions without accounts |
| `allowUserLookup` | `boolean` | `false` | Mount `POST /api/auth/find-user` for invite-by-email flows |
| `defaultRole` | `string` | — | Role given to a newly registered user when none is specified |
| `serviceKey` | `string` | — | Static key for server-to-server calls — see [Service Key Authentication](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, for password reset, verification, invitations and magic links |
| `magicLink` | `boolean` | `false` | Enable passwordless email sign-in. Needs `email` configured; without it the routes answer `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Enable six-digit sign-in codes by email — see [One-time codes](#one-time-codes-by-email). Same email requirement |
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
`AUTH_COOKIE_SAME_SITE` is the environment spelling of `sameSite`, and
`AUTH_COOKIE_SECURE` of `secure`.

The cookie carries `Secure` unless you turn it off, and nothing about the request
can: the flag used to be read from the request protocol, which is `http` behind
any TLS-terminating proxy, so the refresh token travelled in cleartext in the
commonest production topology. `AUTH_COOKIE_SECURE=false` is the one way out, for
a deployment genuinely served over plain http — a LAN address, an appliance — and
it warns at boot. `http://localhost` does not need it: browsers treat it as a
trustworthy origin and accept `Secure` cookies there.

| Key | Default | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | current domain | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` is only for a genuinely cross-site frontend |
| `secure` | `true` | Secure by default; `AUTH_COOKIE_SECURE=false` for plain http |

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
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
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

#### Reading the captured mail without a terminal

The log is only useful to someone watching it. A server in Docker, a second
window, or a scrolled-past line all leave a link that was printed and cannot be
found — so the same capture is served over HTTP:

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Each message carries `to`, `subject`, `at`, the `html` and `text` parts, and
`links` — the absolute URLs found in the body, in document order, which is the
part anyone actually wants.

It is admin-only, through the same gate cron, logs and backups use, and it
answers `501 DEV_MAILBOX_UNAVAILABLE` when there is nothing to serve — with SMTP
configured, mail was delivered rather than held. `NODE_ENV=production` refuses
it regardless of anything else: what these messages contain is a working login.

### One-time codes by email

A magic link opens the session on whichever device holds the mailbox. That is
the right device on a laptop and the wrong one everywhere else — a television, a
terminal, a second browser, a kiosk. A code crosses that gap, because a person
carries it across.

```ts
auth: {
    emailOtp: true,   // or AUTH_EMAIL_OTP=true
    email: { /* … */ }
}
```

```ts
await rebase.auth.sendEmailOtp("someone@example.com");
// …the person reads six digits out of their inbox…
const { user } = await rebase.auth.verifyEmailOtp("someone@example.com", "384102");
```

The address is sent again with the code, and that is not a convenience. What is
stored is a hash of the address *and* the code together, so a guess is a guess
against one named account — not against every account in the table at once,
which is what a code-only lookup would make of a million possibilities.

The rest of what keeps six digits sufficient:

- **Ten minutes**, and single use.
- **Five verification attempts per address per window**, keyed on the address
  rather than the caller's IP: an IP is the attacker's to rotate and the account
  under attack is not. Counts live wherever the deployment's rate-limit store
  does — per replica by default, shared with `REBASE_RATE_LIMIT_STORE=sql`.
- **Uniform digits**, from `randomInt` rather than a modulo of random bytes.
- `POST /auth/otp` answers identically for an address with no account, so it
  cannot be used to ask whether somebody is a customer.

Reading a code out of the inbox proves the address, so a successful sign-in
marks it verified — exactly as following a magic link does.

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

#### The environment spellings

A managed or bundle deployment has no `auth` block to write in — it configures
the server entirely through the environment — so every provider above has a
`<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET` pair, and both halves have to
be set before the provider is configured at all:

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

`GET /api/auth/config` then lists `discord` in `enabledProviders`, which is how
to check that a pair arrived.

Apple is the exception: it has no static client secret, because Rebase signs a
short-lived ES256 JWT for each token exchange. It needs all four of
`APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` — the
`.p8` file's contents, newlines and all.

Two options have no environment spelling and need the `auth` block (so, an
ejected or code-configured backend): `microsoft.tenantId`, which otherwise
defaults to `common` and reports every address as unverified, and
`gitlab.baseUrl`, for a self-hosted instance.

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

## Auto-Created Tables

On first startup, Rebase automatically provisions the `auth` schema and the following tables in the database (bound to the schema defined in your collection, e.g., `rebase`):

- **`rebase.users`** — User accounts with email, password hash, metadata, and a `roles` text[] column (roles are stored as inline text arrays to optimize queries and avoid joins).
- **`rebase.refresh_tokens`** — Long-lived sessions carrying hashed refresh tokens, user agents, and IP addresses. Includes a unique index on `token_hash` and a unique constraint on `(user_id, user_agent, ip_address)` to track active device sessions.
- **`rebase.password_reset_tokens`** — Expirable single-use tokens for password recovery flows.
- **`rebase.mfa_factors`** — Enrolled multi-factor authentication methods (e.g. TOTP secrets encrypted with AES-256).
- **`rebase.mfa_challenges`** — Verification logs tracking active MFA verification attempts.
- **`rebase.recovery_codes`** — Hashed multi-factor backup/recovery codes.
- **`rebase.app_config`** — Key-value store for system configurations.

## First User Bootstrap

<span class="since-badge" data-since="0.18">Since 0.18</span>

When no users exist in the database and the server is **not** running with `NODE_ENV=production`, the first person to register automatically becomes an admin. After that, registration is controlled by the `allowRegistration` setting.

In production that window is closed, because a host with a public name is reachable before its operator has registered, and whoever got there first would own it. A production deployment names its first admin in the environment instead — `REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD`, created at boot while the table is still empty — or assigns the role with the service key. With the window closed, an empty table refuses the bootstrap registration with `SETUP_REQUIRED` (and says so), a first account created through open registration is an ordinary account, `GET /api/auth/config` never reports `needsSetup`, `POST /api/admin/bootstrap` refuses, and the boot log warns when the table is empty and no admin is named.

On a laptop this means you can always bootstrap a fresh database without seeding it manually. To prevent concurrent runs and schema generation race conditions on hot reloading (HMR) or startup, bootstrapping operations are synchronized using a Postgres advisory lock:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Collection-Level Auth Configuration

Instead of relying solely on the default database auth rules, you can mark any Postgres collection (such as `users.ts` or a custom `members.ts` collection) as the authentication collection. This is configured via the `auth` property on the collection itself:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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
- `sendEmail?: (options) => Promise<EmailSendResult>` — Send an email (only available when email service is configured). Resolves with what the provider reported — `messageId`, `accepted`, `rejected` — so a hook can store the id and later thread a reply back to it.
- `emailConfigured: boolean` — Whether email service is configured.
- `appName: string` — The app name from email config.
- `resetPasswordUrl: string` — The password reset link base URL.

## Next Steps

- **[Endpoints and tokens](/docs/backend/auth-endpoints/)** — every route this configuration mounts
- **[Custom auth adapters](/docs/backend/auth-adapters/)** — bringing your own identity provider
- **[Frontend Authentication](/docs/frontend/authentication/)** — login UI, auth controller, user management
- **[Security Rules (RLS)](/docs/collections/security-rules/)** — row-level access control
- **[Client SDK Authentication](/docs/sdk/authentication/)** — auth methods in the client SDK
