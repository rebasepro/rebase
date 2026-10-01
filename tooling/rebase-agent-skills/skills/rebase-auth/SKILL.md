---
name: rebase-auth
description: Guide for setting up and using Rebase Authentication, roles, Row-Level Security (RLS) policies, MFA, API keys, OAuth providers, custom auth adapters, and lifecycle hooks. Use this skill when the user needs to add authentication, manage users and roles, secure data access, configure OAuth, set up MFA, create API keys, or customize the auth pipeline.
---

# Rebase Authentication

Rebase ships a complete, built-in authentication system with JWT sessions, OAuth, MFA/TOTP, API keys, Row-Level Security, and lifecycle hooks — or you can plug in an external auth system (e.g., Clerk, Auth0, or custom identity providers) via the `AuthAdapter` interface.

> **IMPORTANT FOR AGENTS:** Always read the `rebase-basics` skill first. The auth system is configured inside `initializeRebaseBackend()` which is covered there.

## Table of Contents

- [Server-Side Configuration (RebaseAuthConfig)](#server-side-configuration)
- [OAuth Providers](#oauth-providers)
- [Auth Lifecycle Hooks](#auth-lifecycle-hooks)
- [MFA / TOTP](#mfa--totp)
- [API Keys](#api-keys)
- [REST Endpoints](#rest-endpoints)
- [Client SDK (auth module)](#client-sdk)
- [Row-Level Security (RLS)](#row-level-security)
- [Rate Limiting](#rate-limiting)
- [Custom Auth Adapters](#custom-auth-adapters)
- [Roles & Scopes](#roles--scopes)
- [Backend Hooks](#backend-hooks)
- [Email Configuration](#email-configuration)
- [Security Concepts](#security-concepts)
- [References](#references)

---

## Server-Side Configuration

Authentication is configured via the `auth` property of `initializeRebaseBackend()`. It accepts **either** a `RebaseAuthConfig` object (built-in auth) or an `AuthAdapter` (external auth).

> **Auth & multiple data sources.** The built-in auth system (users, sessions, API keys) is bootstrapped on the **default** data source — the auth collection must live there (the backend warns at boot otherwise). **RLS only protects Postgres**: server collections on engines without row-level security (e.g. MongoDB) still require authentication but enforce authorization at the app layer (the backend warns for these). **Direct data sources (e.g. Firestore) bypass Rebase auth entirely** — they're governed by the external backend's own rules/token; use an `AuthAdapter` to unify identity. See the **rebase-collections** skill for the data-source model.

### RebaseAuthConfig

| Property | Type | Default | Description |
|---|---|---|---|
| `collection` | `CollectionConfig` | Built-in users collection | The collection used for auth user storage. Import `defaultUsersCollection` from `@rebasepro/common` or pass a custom collection with required auth fields. |
| `jwtSecret` | `string` | — | **Required.** Secret for signing JWT access tokens. |
| `accessExpiresIn` | `string` | `"1h"` | Access token lifetime (e.g. `"15m"`, `"2h"`). |
| `refreshExpiresIn` | `string` | `"30d"` | Refresh token lifetime. |
| `requireAuth` | `boolean` | `true` | When `true`, data routes return 401 for unauthenticated requests. Set to `false` to rely entirely on Postgres RLS. |
| `allowRegistration` | `boolean` | `false` | Enable self-service registration via `POST /auth/register`. |
| `allowUserLookup` | `boolean` | `false` | Expose `POST /auth/find-user` — an authenticated email→minimal-profile lookup (`uid`/`displayName`/`photoURL` only) for invite flows. Enables user enumeration by signed-in users, so it's off by default. See [Inviting by email](#inviting-teammates-by-email). |
| `serviceKey` | `string` | — | Static secret for server-to-server auth. Must be ≥ 32 characters. Requests with `Authorization: Bearer <serviceKey>` get admin access. |
| `defaultRole` | `string` | — | Role ID assigned to new users (except the first user, who always gets `"admin"`). **Must NOT be `"admin"`** — throws a security error at startup. |
| `providers` | `OAuthProvider<unknown>[]` | `[]` | **Canonical** OAuth provider array. Use `create*Provider` factories or pass custom providers. Named shorthand fields below are merged into this array at startup. |
| `hooks` | `AuthHooks` | — | [Lifecycle hooks](#auth-lifecycle-hooks) to customize passwords, credentials, and auth events. |
| `email` | `EmailConfig` | — | [Email configuration](#email-configuration) for password resets, verification, and welcome emails. |
| `google` | `{ clientId, clientSecret? }` | — | Google OAuth shorthand. |
| `github` | `{ clientId, clientSecret }` | — | GitHub OAuth shorthand. |
| `microsoft` | `{ clientId, clientSecret, tenantId? }` | — | Microsoft/Entra ID shorthand. `tenantId` defaults to `"common"`. |
| `apple` | `{ clientId, teamId, keyId, privateKey }` | — | Apple Sign In shorthand. `privateKey` is the raw PEM (.p8) contents. |
| `facebook` | `{ clientId, clientSecret }` | — | Facebook/Meta OAuth. |
| `twitter` | `{ clientId, clientSecret }` | — | Twitter/X OAuth 2.0 with PKCE. |
| `discord` | `{ clientId, clientSecret }` | — | Discord OAuth. |
| `gitlab` | `{ clientId, clientSecret, baseUrl? }` | — | GitLab OAuth. `baseUrl` defaults to `"https://gitlab.com"` (supports self-hosted). |
| `linkedin` | `{ clientId, clientSecret }` | — | LinkedIn OAuth (OIDC). |
| `bitbucket` | `{ clientId, clientSecret }` | — | Bitbucket OAuth. |
| `slack` | `{ clientId, clientSecret }` | — | Slack OAuth (OIDC). |
| `spotify` | `{ clientId, clientSecret }` | — | Spotify OAuth. |

### Minimal Example

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";

await initializeRebaseBackend({
  server,
  app,
  database: createPostgresAdapter({ connection: db, schema }),
  auth: {
    jwtSecret: process.env.JWT_SECRET!,
    allowRegistration: true,
    serviceKey: process.env.REBASE_SERVICE_KEY,
    defaultRole: "member",
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    email: {
      from: "noreply@myapp.com",
      smtp: {
        host: "smtp.resend.com",
        port: 465,
        secure: true,
        auth: { user: "resend", pass: process.env.RESEND_API_KEY! },
      },
      appName: "MyApp",
      resetPasswordUrl: "https://myapp.com",
      verifyEmailUrl: "https://myapp.com",
    },
  },
});
```

### Collection-Level Auth Configuration

Instead of relying solely on the default database auth rules, you can mark any Postgres collection (such as `users.ts` or a custom `members.ts` collection) as the authentication collection. This is configured via the `auth` property on the collection itself:

```typescript
import { PostgresCollectionConfig } from "@rebasepro/types";

const membersCollection: PostgresCollectionConfig = {
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
    },

    // The access model — see "Roles & Scopes" below
    roles: { support: { name: "Support", scopes: ["users:read", "users:write"] } },
    scopes: { "project:deploy": { label: "Deploy projects", target: "project" } },
    personalKeys: true
  },
  properties: { ... }
};
```

When custom hooks (`onCreateUser`, `onResetPassword`) are called, they receive an `AuthCollectionContext` facade containing:
- `hashPassword(password: string): Promise<string>` — Hash password using the configured hashing algorithm (e.g. scrypt).
- `sendEmail?: (options) => Promise<void>` — Send an email (only available when email service is configured).
- `emailConfigured: boolean` — Whether email service is configured.
- `appName: string` — The app name from email config.
- `resetPasswordUrl: string` — The password reset link base URL.

### First-User Bootstrap

> **IMPORTANT FOR AGENTS:** Outside production (`NODE_ENV !== "production"`), the very first user registered (via `POST /auth/register` or OAuth) is automatically promoted to `"admin"`. This prevents the chicken-and-egg problem. All subsequent users receive the `defaultRole`.
>
> **In production that window is closed** — whoever reached a public registration form first would own the deployment. An empty production database answers registration with `403 SETUP_REQUIRED` instead. Name the first admin with `REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD` before the first boot (the account is created only against an empty user table, and the variables are ignored outside production), or assign the `admin` role with the service key.

### Inviting teammates by email

Invite flows must turn an email into a user id, but the `users` collection is
RLS-protected from the client. **Do not** hand-roll an admin server function for
this — enable `allowUserLookup` and use the built-in primitive:

```typescript no-verify
// backend: initializeRebaseBackend({ auth: { allowUserLookup: true } })

// client:
const profile = await rebase.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    // `rebase.data` in the browser — `dataAsAdmin` is server-only, undefined here
    await rebase.data.team_members.create({ team_id, user_id: profile.uid });
}
```

The `find-user` endpoint is authenticated-only and returns just the minimal
public profile. It is off by default because it enables user enumeration by any
signed-in user.

---

## OAuth Providers

Rebase supports 12 built-in OAuth providers. Each provider is configured via a shorthand property on `RebaseAuthConfig` and automatically mounts a `POST /api/auth/{providerId}` endpoint.

### Provider Reference

| Provider | ID | Config Properties | Client Payload |
|---|---|---|---|
| Google | `google` | `clientId`, `clientSecret?` | `{ idToken }` OR `{ accessToken }` OR `{ code, redirectUri }` |
| GitHub | `github` | `clientId`, `clientSecret` | `{ code, redirectUri }` |
| Microsoft | `microsoft` | `clientId`, `clientSecret`, `tenantId?` | `{ code, redirectUri }` |
| Apple | `apple` | `clientId`, `teamId`, `keyId`, `privateKey` | `{ code, redirectUri, user? }` |
| Facebook | `facebook` | `clientId`, `clientSecret` | `{ code, redirectUri }` |
| Twitter/X | `twitter` | `clientId`, `clientSecret` | `{ code, redirectUri, codeVerifier }` |
| Discord | `discord` | `clientId`, `clientSecret` | `{ code, redirectUri }` |
| GitLab | `gitlab` | `clientId`, `clientSecret`, `baseUrl?` | `{ code, redirectUri }` |
| LinkedIn | `linkedin` | `clientId`, `clientSecret` | `{ code, redirectUri }` |
| Bitbucket | `bitbucket` | `clientId`, `clientSecret` | `{ code, redirectUri }` |
| Slack | `slack` | `clientId`, `clientSecret` | `{ code, redirectUri }` |
| Spotify | `spotify` | `clientId`, `clientSecret` | `{ code, redirectUri }` |

### Google Three-Path Support

Google is unique — it supports three verification paths:

1. **ID Token** (One Tap / Sign In button) — `{ idToken }`. Cryptographic verification via Google's public keys. No `clientSecret` needed.
2. **Access Token** (popup via `initTokenClient`) — `{ accessToken }`. Validated via Google's userinfo endpoint. No `clientSecret` needed.
3. **Authorization Code** (most secure) — `{ code, redirectUri }`. Requires `clientSecret`. Tokens never touch the browser.

### Apple Special Behavior

- Apple only sends the user's name on the **first** authorization. The frontend must capture and forward it: `{ code, redirectUri, user: { name: { firstName, lastName }, email } }`.
- Apple does not provide a profile photo (`photoUrl` is always `null`).
- The `privateKey` is the raw PEM contents of the `.p8` file downloaded from Apple Developer.

### Twitter PKCE

Twitter uses OAuth 2.0 with PKCE. The client must send `codeVerifier` alongside `code` and `redirectUri`.

### OAuth Account Linking

When an OAuth user signs in via `POST /api/auth/{provider}`:

1. If an identity record exists for `(provider, providerId)` → log in that user. The email is not consulted.
2. If no identity exists but a user with the same email exists:
   - **The provider asserted `emailVerified: true` and the account's own email is verified** → **link** the provider to the existing account and log in as that user. One account, two sign-in methods.
   - **Either side is unverified** → reject with `403 EMAIL_NOT_VERIFIED`. Nothing is created or modified. `details.reason` is `provider-email-unverified`, `local-account-unverified` (the account has a password) or `local-account-unverified-passwordless`.
3. If neither exists → create a new user (verified if the provider verified the email), link the identity, assign `defaultRole`.

A magic link, an email code or a password reset proves the address and verifies
the account. On an unverified account, the first such proof removes the password
(a reset sets the new one) and every linked identity whose provider did not
verify that address, and ends every session, before it marks the account
verified — so whoever made an account for someone else's address keeps no way in. Accounts created with
`POST /api/admin/users` are stored verified. A custom auth repository without
`unlinkUserIdentity` refuses such a proof with `409 UNVERIFIED_IDENTITIES`.

> **IMPORTANT FOR AGENTS:** A second account is **never** silently created for
> an email that already exists. If asked "does signing in with Google create a
> duplicate user?", the answer is no — it either links (both sides verified) or
> errors (either unverified). This is **not configurable**; there is deliberately no option to
> auto-link on unverified emails, because that would let anyone who can make a
> provider emit an address they don't own take over the matching account.
> Google always asserts `email_verified` for real Google accounts, so linking
> is the normal path for Google sign-in.

### Linking a Provider to a Signed-In Account

`POST /api/auth/link/{provider}` attaches a provider identity to the **already
authenticated** account (requires `Authorization: Bearer <token>`). The body is
the same payload the provider's sign-in route takes, e.g. `{ idToken }`.

This is the escape hatch from an `EMAIL_NOT_VERIFIED` rejection, and the way to
attach a provider whose email differs from the account's.

Unlike sign-in, linking here does **not** require a verified email and does not
require the emails to match — on sign-in the provider's email is the only
evidence tying the identity to an account, whereas here the caller has already
proven ownership by holding a valid session.

- `409 IDENTITY_ALREADY_LINKED` if that provider identity belongs to another user.
- Idempotent (`alreadyLinked: true`) if already linked to the caller.

### Adding a Password to a Provider-Only Account

A user who signed up via OAuth has no `passwordHash`:

- `POST /auth/register` with the same email → `409 EMAIL_EXISTS`.
- `POST /auth/change-password` → `400 INVALID_ACCOUNT` (no existing password to verify).
- **`forgot-password` → `reset-password` is the supported path.** It re-proves ownership of the address by email, after which the account has both sign-in methods.

### Custom OAuth Provider

You can register any OAuth provider by implementing the `OAuthProvider<T>` interface:

```typescript
import { z } from "zod";
import type { OAuthProvider, OAuthProviderProfile } from "@rebasepro/server";

const myProvider: OAuthProvider<{ token: string }> = {
  id: "my-provider",
  schema: z.object({ token: z.string().min(1) }),
  verify: async (payload): Promise<OAuthProviderProfile | null> => {
    const userInfo = await verifyExternalToken(payload.token);
    if (!userInfo) return null;
    return {
      providerId: userInfo.id,
      email: userInfo.email,
      displayName: userInfo.name || null,
      photoUrl: userInfo.avatar || null,
    };
  },
};

// Use in config:
auth: {
  jwtSecret: "...",
  providers: [myProvider],
}
```

---

## Auth Lifecycle Hooks

The `AuthHooks` interface lets you customize specific behaviors of the built-in auth system. Every hook is optional — unset hooks fall through to built-in defaults.

### Hook Reference

| Hook | Signature | Default | Behavior |
|---|---|---|---|
| `hashPassword` | `(password: string) => Promise<string>` | scrypt (Node crypto, 64-byte key, 32-byte salt) | Hash a cleartext password for storage. |
| `verifyPassword` | `(password: string, storedHash: string) => Promise<boolean>` | scrypt with timing-safe comparison | Verify cleartext password against stored hash. |
| `validatePasswordStrength` | `(password: string) => PasswordValidationResult` | Min 8 chars, 1 uppercase, 1 lowercase, 1 digit | Return `{ valid: boolean, errors: string[] }`. |
| `verifyCredentials` | `(email, password, repo: AuthRepository) => Promise<UserData \| null>` | `getUserByEmail` + `verifyPassword` | Override the entire login credential check. Return user or `null`. |
| `onAuthenticated` | `(user: UserData, method: AuthMethod) => Promise<void>` | — | Called after **any** successful auth event. Fire-and-forget. |
| `beforeUserCreate` | `(data: CreateUserData) => Promise<CreateUserData>` | Passthrough | Modify or reject user creation. Throw to abort. |
| `afterUserCreate` | `(user: UserData) => Promise<void>` | — | Called after user creation. Fire-and-forget. |
| `beforeLogin` | `(email: string, method: AuthMethod) => Promise<void>` | — | Pre-login validation. Throw to reject (e.g. account lockout). |
| `afterLogout` | `(userId: string) => Promise<void>` | — | Post-logout cleanup. Fire-and-forget. |
| `onMfaVerified` | `(userId: string, factorId: string) => Promise<void>` | — | Called after successful MFA verification. Fire-and-forget. |
| `customizeAccessToken` | `(claims: Record<string, unknown>, user: UserData) => Promise<Record<string, unknown>>` | — | Modify JWT access token claims before signing. |
| `transformAuthResponse` | `(response: AuthResponsePayload, context: TransformAuthResponseContext) => Promise<AuthResponsePayload>` | — | Transform the auth response before sending to client. Runs in-request (not fire-and-forget). Errors are caught and logged; untransformed response returned as fallback. |
| `onPasswordReset` | `(userId: string) => Promise<void>` | — | Called after successful password reset. Fire-and-forget. |
| `beforeUserDelete` | `(userId: string) => Promise<void>` | — | Throw to prevent deletion. |
| `afterUserDelete` | `(userId: string) => Promise<void>` | — | Post-deletion cleanup. Fire-and-forget. |

### AuthMethod Values

`"login"` | `"register"` | `"oauth"` | `"refresh"` | `"password-reset"` | `"anonymous"` | `"magic-link"` | `"mfa"`

### AuthResponsePayload

```typescript
interface AuthResponsePayload {
  user?: {
    uid: string;
    email: string;
    displayName: string | null;
    photoURL: string | null;
    roles: string[];
    metadata: Record<string, unknown>;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: number;
    [key: string]: unknown;
  };
}
```

### TransformAuthResponseContext

```typescript
interface TransformAuthResponseContext {
  /** The authenticated user's ID. */
  uid: string;
  method: "login" | "register" | "oauth" | "refresh" | "anonymous" | "magic-link" | "mfa";
  request: Request;
}
```

### PasswordValidationResult

```typescript
interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}
```

### Example: bcrypt Passwords

```typescript
import bcrypt from "bcrypt";

auth: {
  jwtSecret: "...",
  hooks: {
    hashPassword: (pw) => bcrypt.hash(pw, 12),
    verifyPassword: (pw, hash) => bcrypt.compare(pw, hash),
    validatePasswordStrength: (pw) => ({
      valid: pw.length >= 6,
      errors: pw.length < 6 ? ["Password must be at least 6 characters"] : [],
    }),
  },
}
```

### Example: Custom JWT Claims

```typescript
hooks: {
  customizeAccessToken: async (claims, user) => ({
    ...claims,
    org_id: user.metadata?.organizationId,
    plan: user.metadata?.plan || "free",
  }),
}
```

### Example: Audit Logging

```typescript
hooks: {
  onAuthenticated: async (user, method) => {
    await auditLog.write({
      event: "auth.success",
      userId: user.id,
      method,
      timestamp: new Date(),
    });
  },
  beforeLogin: async (email, method) => {
    const isBlocked = await checkAccountLockout(email);
    if (isBlocked) throw new Error("Account is locked");
  },
}
```

### Example: External Token Bridge (e.g. custom auth system)

```typescript
import admin from "firebase-admin";

hooks: {
  transformAuthResponse: async (response, context) => {
    // Generate a custom provider token for the authenticated user
    const firebaseToken = await admin.auth().createCustomToken(context.uid);
    return {
      ...response,
      tokens: {
        ...response.tokens,
        firebaseToken,
      },
    };
  },
}
```

The frontend can then call `signInWithCustomToken(providerToken)` immediately after login.

---

## MFA / TOTP

Rebase supports Multi-Factor Authentication via TOTP (Time-based One-Time Password). The flow uses an enrollment → verify → challenge pattern with recovery codes.

### MFA Flow

1. **Enroll** — `POST /api/auth/mfa/enroll` returns a TOTP secret, URI (for QR), and 10 recovery codes.
2. **Verify enrollment** — `POST /api/auth/mfa/verify` with a 6-digit TOTP code to confirm the factor.
3. **Challenge on login** — After normal login (aal1), call `POST /api/auth/mfa/challenge` to create a challenge.
4. **Complete challenge** — `POST /api/auth/mfa/challenge/verify` with TOTP or recovery code. Upgrades token from `aal1` → `aal2`.

### MFA Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/mfa/enroll` | Required | Start enrollment. Returns `{ factor, totp: { secret, uri, qrUri }, recoveryCodes }`. |
| `POST` | `/api/auth/mfa/verify` | Required | Verify enrollment with `{ factorId, code }` (6-digit TOTP). |
| `POST` | `/api/auth/mfa/challenge` | Required | Create challenge with `{ factorId }`. Returns `{ challengeId, factorId, expiresAt }`. Challenge expires in 5 minutes. |
| `POST` | `/api/auth/mfa/challenge/verify` | Required | Complete challenge with `{ challengeId, code }`. Returns new tokens with `aal2`. Accepts TOTP (6 digits) or recovery code (>6 chars). |
| `GET` | `/api/auth/mfa/factors` | Required | List enrolled factors: `{ factors: [{ id, factorType, friendlyName, verified, createdAt }] }`. |
| `DELETE` | `/api/auth/mfa/unenroll` | Required | Remove factor with `{ factorId }` in body. Auto-cleans recovery codes when no verified factors remain. |

### MFA Types

```typescript
interface MfaFactor {
  id: string;
  uid: string;
  factorType: "totp";       // Only TOTP is supported
  friendlyName?: string;
  verified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface MfaChallengeInfo {
  id: string;
  factorId: string;
  createdAt: Date;
  verifiedAt?: Date;
  ipAddress?: string;
}
```

### AAL (Authentication Assurance Levels)

| Level | Meaning |
|---|---|
| `aal1` | Standard authentication (email/password, OAuth). |
| `aal2` | Elevated after MFA challenge verification. |

---

## API Keys

API keys are long-lived bearer credentials (`rk_live_…`) for agents, MCP clients, CI pipelines, cron schedulers and integrations. What a key may do is a list of **scopes** — the same `resource:action[:target]` strings every credential uses (see [Roles & Scopes](#roles--scopes)).

### Key Format

- Prefix: `rk_` (e.g. `rk_live_abc123...`)
- Storage: SHA-256 hash of the full key. The plaintext key is returned **exactly once** at creation.
- Display: Only the first 12 characters (`key_prefix`) are shown in subsequent API responses.

### Two kinds

| Kind | Acts as | Holds | Managed at | Who manages |
|---|---|---|---|---|
| `service` | `api-key:<id>`, RLS roles `["service", ...key.roles]` | exactly `key.scopes` | `/api/admin/api-keys` | holders of `keys:read` / `keys:write` |
| `personal` | its owner (uid), with the owner's roles read **live** on every request | `key.scopes` ∩ what the owner holds now | `/api/auth/keys` | the owning account, when the users collection sets `auth.personalKeys: true` |

> **There is no `admin: true` and no `permissions` list any more.** A key that should run as the `admin` RLS role gets `roles: ["admin"]`; what it may *do* is its `scopes`. A body that sends `permissions`/`admin` instead of `scopes` is refused with `400 INVALID_INPUT`.

### Scopes a key can hold

- **Data plane** — `data:read`, `data:write`, `data:delete` (target: collection slug), `storage:read`, `storage:write`, `storage:delete` (target: storage source id; the default source is `(default)`), `functions:invoke` (target: function name). `data:read:posts` = read `posts` only. The plain scope covers every target.
- **Admin plane** — `users:read|write`, `schema:read|write`, `database:read|write`, `backups:read`, `cron:read|write`, `logs:read`. A key holding one reaches that admin surface (e.g. a scheduler key with `cron:write`).
- **App scopes** — whatever the app declares under `auth.scopes` (e.g. `project:deploy:p1`).
- **Never** `keys:read` / `keys:write` — `400 KEY_MANAGEMENT_SCOPE`. A key that could manage keys could mint its own successor.

### Minting rules (both routes)

| Refusal | When |
|---|---|
| `400 INVALID_SCOPES` | malformed / unknown scope, or a target on a scope that takes none (`details.validScopes` lists them) |
| `400 UNKNOWN_SCOPE_TARGET` | the target names a collection, storage source or function this backend does not serve |
| `400 KEY_MANAGEMENT_SCOPE` | `keys:*` requested |
| `403 SCOPE_EXCEEDS_CREATOR` | a scope the creator does not hold — a key never holds more than its minter |
| `403 ROLE_EXCEEDS_CREATOR` | a service-key role the creator does not hold (admins may give any role) |
| `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` | the request to a key route was itself made with an API key |

A request the key lacks a scope for answers `403 SCOPE_MISSING` with `details.requiredScope` (target included, e.g. `data:write:orders`).

### Service Key Endpoints

| Method | Endpoint | Needs | Description |
|---|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` | List service keys (masked — no hashes). |
| `POST` | `/api/admin/api-keys` | `keys:write` | Create one. Returns the full plaintext key once. |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | One key (masked). |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | Change `name`, `scopes`, `roles`, `rate_limit`, `expires_at` — same minting rules. |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | Revoke (soft-delete). |

### Personal Key Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/auth/keys` | The caller's own keys. |
| `POST` | `/api/auth/keys` | `{ name, scopes, expires_at? }` — no `roles`, no `rate_limit` (400). |
| `DELETE` | `/api/auth/keys/:id` | Revoke one of the caller's own. |
| `GET` | `/api/auth/scopes` | Every scope this backend knows (`ScopeSummary[]`) and the ones the caller holds. |

`403 PERSONAL_KEYS_DISABLED` unless `auth.personalKeys: true`; `403 PERSONAL_KEY_NEEDS_ACCOUNT` for the service key and guest sessions. Demote the owner and their keys shrink with them; delete the account and they stop.

### Request and response shapes (`@rebasepro/types`)

```typescript
type ApiKeyKind = "service" | "personal";

interface CreateApiKeyRequest {
  name: string;
  scopes: string[];              // at least one, e.g. ["data:read:orders", "cron:write"]
  roles?: string[];              // RLS roles beside "service", e.g. ["admin"]
  rate_limit?: number | null;    // requests per 15-min window; null = server default (1000)
  expires_at?: string | null;    // ISO-8601; omit for no expiry
}

interface CreatePersonalKeyRequest {
  name: string;
  scopes: string[];
  expires_at?: string | null;
}

// What list / get / update return. Creation adds `key`, the plaintext, once.
interface ApiKeyMasked {
  id: string;
  name: string;
  kind: ApiKeyKind;
  key_prefix: string;
  scopes: string[];
  roles: string[];               // always [] on a personal key
  owner_uid: string | null;      // null on a service key
  rate_limit: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}
```

### Examples

```bash
# A scoped service key (read + write orders, no delete), expiring in 30 days
rebase api-keys create --name "Order sync" --scopes data:read:orders,data:write:orders --expires-in 30

# A scheduler that triggers cron jobs
rebase api-keys create --name "Scheduler" --scopes cron:read,cron:write

# CI / migrations: every scope you hold (less keys:*), and the admin RLS role
rebase api-keys create --name "CI" --full-access --roles admin --expires-in 90

# REST
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Analytics", "scopes": ["data:read:events"], "rate_limit": 500 }'
```

```typescript
// Client SDK — service keys (needs keys:write) and the caller's own personal keys
const { key } = await client.apiKeys.createKey({ name: "Order sync", scopes: ["data:read:orders"] });
const mine = await client.personalKeys.createKey({ name: "Laptop", scopes: ["data:read"] });
const { scopes, held } = await client.personalKeys.listScopes();
```

### Using an API Key

```bash
curl http://localhost:3000/api/data/events \
  -H "Authorization: Bearer rk_live_abc123..."
```

The same key works on REST data, storage, functions, the admin surfaces its scopes reach, the realtime WebSocket (sent in `AUTHENTICATE`; channels are refused for keys) and the hosted `/mcp` endpoint.

### What a request with a key goes through

1. The token is SHA-256 hashed and looked up in `rebase.api_keys`; expiry and revocation are checked.
2. A service key becomes `{ uid: "api-key:<id>", roles: ["service", ...key.roles] }`; a personal key becomes its owner, with the owner's roles read from the database now.
3. The key's scopes go on the request (`c.get("scopes")`) and are checked by every route: data by HTTP method (`GET` → `read`, `POST`/`PUT`/`PATCH` → `write`, `DELETE` → `delete`; `POST /bulk/delete` is a delete); on a nested path the target collection needs the operation and each parent `data:read`.
4. The DataDriver is scoped with `withAuth()` to that identity. This does **not** bypass RLS — statements run as `rebase_user` with `app.uid` set, and your policies are evaluated.
5. Per-key rate limiting applies (`rate_limit`, else the server's API-key default).

> **WARNING FOR AGENTS:** a key is a long-lived credential. Server-side only — never in client code.
>
> Scopes and RLS are **two independent gates**. A service key with `data:read` and no `admin` role can read **nothing** on a collection whose policies do not grant `service` — the default policies admit only the server context and `admin`. That is RLS working. Grant `service` in the collection's `securityRules`, or give the key `roles: ["admin"]`. Owner-style rules (`owner_id = rebase.uid()`) never match a service key; they do match a personal key, which runs as its owner.
>
> For an agent, mint the narrowest key that works and leave out `data:delete` and `functions:invoke` unless it needs them — a function is code and can write.

### Keys made before scopes

Old rows (`permissions` + `admin`) are rewritten on boot, never widened: `{collection:"posts", operations:["read","write"]}` → `data:read:posts`, `data:write:posts`; `"*"` → `data:<op>` + `storage:<op>` (+ `functions:invoke` if write); `"storage"` → `storage:<op>`; `"functions"` / `"functions/<name>"` → `functions:invoke[:<name>]` only if write was granted; `admin: true` → roles `["admin"]` + `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read`. The secret is unchanged.

### CLI

```bash
rebase api-keys list
rebase api-keys scopes                       # every scope, and which you hold
rebase api-keys create --name "Read Only" --scopes data:read:orders
rebase api-keys get <key-id>
rebase api-keys revoke <key-id>
```

`--scopes` (comma-separated or repeated), `--full-access`, `--roles`, `--rate-limit`, `--expires-in <days>`, `--expires-at <ISO date>`. `--permissions`, `--admin` and `--expires` are gone.

---

## REST Endpoints

All auth endpoints are mounted under `/api/auth`. Admin endpoints are under `/api/admin`.

### Public Auth Endpoints

| Method | Endpoint | Rate Limit | Auth | Description |
|---|---|---|---|---|
| `POST` | `/auth/register` | default (200/15min) | No | Create account. Body: `{ email, password, displayName? }`. |
| `POST` | `/auth/login` | default | No | Email/password login. Body: `{ email, password }`. |
| `POST` | `/auth/{providerId}` | default | No | OAuth sign-in. Body varies by provider. |
| `POST` | `/auth/refresh` | — | No | Refresh access token. Body: `{ refreshToken }`. Rotates refresh token. |
| `POST` | `/auth/logout` | — | No | Invalidate refresh token. Body: `{ refreshToken? }`. |
| `POST` | `/auth/anonymous` | strict (50/15min) | No | Create anonymous user with temp credentials. |
| `POST` | `/auth/forgot-password` | strict | No | Request password reset email. Body: `{ email }`. Always returns success (security). |
| `POST` | `/auth/reset-password` | strict | No | Reset password with token. Body: `{ token, password }`. Invalidates all sessions. |
| `GET` | `/auth/verify-email` | — | No | Verify email. Query: `?token=<token>`. |
| `GET` | `/auth/config` | default | No | Get auth capabilities for frontend: `{ needsSetup, registrationEnabled, passwordReset, emailVerification, magicLink, anonymousLogin, enabledProviders, … }`. |

### Authenticated Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/auth/me` | Required | Get current user profile + roles. |
| `PATCH` | `/auth/me` | Required | Update profile. Body: `{ displayName?, photoURL? }`. |
| `POST` | `/auth/change-password` | Required | Change password. Body: `{ oldPassword, newPassword }`. Invalidates all sessions. |
| `POST` | `/auth/send-verification` | Required | Send email verification link. Requires email service. |
| `POST` | `/auth/link/{provider}` | Required | Link an OAuth provider to the current account. Body: the provider's sign-in payload (e.g. `{ idToken }`). `409 IDENTITY_ALREADY_LINKED` if it belongs to another user. |
| `GET` | `/auth/sessions` | Required | List active sessions (refresh tokens). |
| `DELETE` | `/auth/sessions` | Required | Revoke all sessions (remote logout). |
| `DELETE` | `/auth/sessions/:id` | Required | Revoke a specific session. |
| `POST` | `/auth/anonymous/link` | Required | Upgrade anonymous → permanent. Body: `{ email, password }`. |

### Auth Response Format

All login/register/OAuth endpoints return:

```json
{
  "user": {
    "uid": "uuid",
    "email": "user@example.com",
    "displayName": "John",
    "photoURL": null,
    "roles": ["member"],
    "metadata": {}
  },
  "tokens": {
    "accessToken": "eyJ...",
    "refreshToken": "hex-string",
    "accessTokenExpiresAt": 1700000000000
  }
}
```

> **WARNING — the SDK flattens this, raw HTTP does not.** The JSON above is the
> *wire* shape, and it is what you get from `fetch("/api/auth/login")`: the token
> is at `body.tokens.accessToken`. The [Client SDK](#client-sdk) unwraps `tokens`
> before handing the session back, so `auth.signInWithEmail()` resolves to a
> flattened `{ user, accessToken, refreshToken }` instead. Both shapes are real,
> at two different layers. Reading the SDK's shape off a raw `fetch` yields
> `undefined` and the misleading symptom "login succeeded but returned no
> accessToken" — the login was fine; the token was one level down.

> **TIP:** Use the `transformAuthResponse` hook to inject additional tokens (e.g., external system tokens) or metadata into this response. See [Auth Lifecycle Hooks](#auth-lifecycle-hooks).

### Error Response Format

```json
{
  "error": {
    "message": "Invalid email or password",
    "code": "INVALID_CREDENTIALS"
  }
}
```

### Common Error Codes

| Code | HTTP | Description |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Wrong email/password. |
| `INVALID_TOKEN` | 401 | Invalid or expired refresh/reset token. |
| `TOKEN_EXPIRED` | 401 | Refresh token has expired. |
| `REGISTRATION_DISABLED` | 403 | `allowRegistration` is `false`. |
| `EMAIL_EXISTS` | 409 | Email already registered. |
| `WEAK_PASSWORD` | 400 | Password fails strength validation. |
| `INVALID_INPUT` | 400 | Zod validation failure. |
| `EMAIL_NOT_CONFIGURED` | 503 | Email service not set up (password reset/verification unavailable). |
| `ALREADY_VERIFIED` | 400 | Email already verified. |
| `NOT_ANONYMOUS` | 400 | User is not anonymous (cannot link). |
| `RATE_LIMITED` | 429 | Too many requests. |
| `SCOPE_MISSING` | 403 | The credential lacks the scope the route needs; `details.requiredScope` names it. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | A `users:write` holder tried to change an account holding more than they do. |
| `ROLE_EXCEEDS_CALLER` | 403 | The roles being granted hold more than the caller does. |

---

## Client SDK

The client SDK's `auth` module is created via `createAuth(transport, options?)`. It manages tokens, auto-refresh, session persistence, and state change listeners.

### CreateAuthOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `storage` | `AuthStorage` | `localStorage` (browser) or in-memory | Token persistence backend. |
| `authPath` | `string` | `"/auth"` | Base path for auth endpoints. |
| `autoRefresh` | `boolean` | `true` | Auto-refresh access tokens 2 minutes before expiry. |
| `persistSession` | `boolean` | `true` | Persist session to storage between page loads. |

### Client SDK Methods

```typescript
const { auth } = createRebaseClient({ baseUrl: "http://localhost:3000" });

// Email/password
await auth.signInWithEmail(email, password);
await auth.signUp(email, password, displayName /* optional */);

// Every method below resolves to a FLATTENED { user, accessToken, refreshToken }.
// That is the SDK's shape, not the wire's — over raw HTTP the token is nested at
// `tokens.accessToken`. See "Auth Response Format" above.
await auth.signInWithGoogle({ idToken });
await auth.signInWithGoogle({ accessToken });
await auth.signInWithGoogle({ code, redirectUri });
await auth.signInWithGitHub(code, redirectUri);
await auth.signInWithMicrosoft(code, redirectUri);
await auth.signInWithApple(code, redirectUri, user /* optional */);
await auth.signInWithFacebook(code, redirectUri);
await auth.signInWithTwitter(code, redirectUri, codeVerifier);
await auth.signInWithDiscord(code, redirectUri);
await auth.signInWithGitLab(code, redirectUri);
await auth.signInWithLinkedin(code, redirectUri);
await auth.signInWithBitbucket(code, redirectUri);
await auth.signInWithSlack(code, redirectUri);
await auth.signInWithSpotify(code, redirectUri);
await auth.signInWithOAuth(providerId, payload); // Generic

// Session
await auth.signOut();
await auth.refreshSession();
auth.getSession();                    // Returns RebaseSession | null (sync)

// Profile
await auth.getUser();                 // GET /auth/me
await auth.updateUser({ displayName, photoURL });   // both optional

// Password
await auth.resetPasswordForEmail(email);
await auth.resetPassword(token, newPassword);
await auth.changePassword(oldPassword, newPassword);

// Email verification
await auth.sendVerificationEmail();
await auth.verifyEmail(token);

// Sessions
await auth.getSessions();             // List active sessions
await auth.revokeSession(sessionId);
await auth.revokeAllSessions();       // Revokes all + signs out locally

// Config
await auth.getAuthConfig();           // GET /auth/config

// State listener
const unsubscribe = auth.onAuthStateChange((event, session) => {
  // event: "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED"
  console.log(event, session?.user);
});
```

### Client Types

```typescript
// `User` and `RebaseSession` are exported from `@rebasepro/client` — you do
// not need `@rebasepro/types` in package.json to name them.
type User = {
  readonly uid: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly photoURL: string | null;
  readonly providerId: string;
  readonly isAnonymous: boolean;
  readonly emailVerified?: boolean;
  roles?: string[];
  createdAt?: Date | string | null;
};

interface RebaseSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;           // Timestamp (ms)
  user: User;
}

type AuthChangeEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED";
```

### Custom Storage Backends

```typescript
import { createMemoryStorage, createCookieStorage } from "@rebasepro/client";

// In-memory (Node.js / SSR)
const auth = createAuth(transport, {
  storage: createMemoryStorage(),
});

// Cookie-based (SSR-friendly)
const auth = createAuth(transport, {
  storage: createCookieStorage({
    path: "/",
    sameSite: "Lax",
    secure: true,
    domain: ".myapp.com",
    maxAge: 365 * 24 * 60 * 60,    // 1 year (default)
  }),
});
```

### Session Restoration

On initialization (when `persistSession` is `true`):
1. Load stored session from storage.
2. If access token is still valid → restore session and schedule refresh.
3. If access token is expired but refresh token exists → immediately attempt refresh.
4. If refresh fails → clear session and emit `SIGNED_OUT`.

---

## Row-Level Security

Every request is scoped before it reaches the database: the auth middleware
resolves an identity, `scopeDataDriver` hands the driver a clone with
`rebase.uid()`, `rebase.jwt()` and `rebase.roles()` set, and Postgres evaluates
policies against that. If scoping throws, the request is rejected — there is no
unscoped fallback.

The identity a request gets is not always a person's. The full table of reserved
identities — service key, API key, anonymous — and what each one satisfies is in
**`references/rls-scoping.md`**. Read it before reasoning about what a cron job
or an API key can see; the answers are not the same as an end user's.

## Rate Limiting

Rebase uses an in-memory sliding-window rate limiter with IP-based keying.

### Pre-configured Limiters

| Limiter | Window | Limit | Applied To |
|---|---|---|---|
| `defaultAuthLimiter` | 15 minutes | 200 requests | `/auth/register`, `/auth/login`, `/auth/{provider}`, `/auth/config` |
| `strictAuthLimiter` | 15 minutes | 50 requests | `/auth/forgot-password`, `/auth/reset-password`, `/auth/anonymous` |

### Rate Limit Response Headers

All rate-limited endpoints include:

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Maximum requests in the window. |
| `X-RateLimit-Remaining` | Remaining requests in current window. |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets. |
| `Retry-After` | Seconds until the client can retry (only on 429). |

### API Key Rate Limiting

API keys have their own per-key rate limiter. The `rate_limit` on each key specifies requests per 15-minute window. When `rate_limit` is `null`, a default of 1000 requests per 15 minutes is applied.

### Rate Limit Error Response

```json
{
  "error": {
    "message": "Too many requests, please try again later.",
    "code": "RATE_LIMITED"
  }
}
```

### Rate limiting

Configure it on the backend, with `rateLimit`. `createRateLimiter` and friends are
internal plumbing — `@rebasepro/server` deliberately does not republish them at the
package root, because the limits a backend author actually wants are these:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ... server, app, database, auth
    rateLimit: {
        windowMs: 60 * 1000,   // the window every count below is measured in
        user: 1000,            // per signed-in user
        apiKey: 1000,          // fallback for a key with no `rate_limit` of its own
        anonymous: 100,        // per IP for unauthenticated callers; null disables
        // enabled: false      // for a deployment whose proxy already rate-limits
        // store: myStore      // share counts across replicas (defaults to this process)
    }
});
```


---

## Custom Auth Adapters

For external auth systems (Clerk, Auth0, custom providers, or custom JWT), use the `AuthAdapter` interface or the `createCustomAuthAdapter()` helper.

### AuthAdapter Interface

```typescript
interface AuthAdapter {
  readonly id: string;
  verifyRequest(request: Request): Promise<AuthenticatedUser | null>;
  verifyToken?(token: string): Promise<AuthenticatedUser | null>;
  userManagement?: UserManagementAdapter;
  createAuthRoutes?(): Hono<any> | undefined;
  createAdminRoutes?(): Hono<any> | undefined;
  getCapabilities(): AuthAdapterCapabilities | Promise<AuthAdapterCapabilities>;
  initialize?(): Promise<void>;
  destroy?(): Promise<void>;
  serviceKey?: string;
  transformAuthResponse?(response: AuthResponsePayload, context: TransformAuthResponseContext): Promise<AuthResponsePayload>;
}

interface AuthenticatedUser {
  uid: string;
  email: string;
  displayName?: string | null;
  photoUrl?: string | null;
  roles: string[];
  isAdmin: boolean;
  rawToken?: string;
  claims?: Record<string, unknown>;
}
```

### createCustomAuthAdapter

The simplest way to plug an existing auth system into Rebase. Only `verifyRequest` is required:

```typescript
import { createCustomAuthAdapter } from "@rebasepro/server";
import jwt from "jsonwebtoken";

const auth = createCustomAuthAdapter({
  verifyRequest: async (request) => {
    const token = request.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return null;

    try {
      const decoded = jwt.verify(token, MY_SECRET) as any;
      return {
        uid: decoded.sub,
        email: decoded.email,
        displayName: decoded.name,
        roles: decoded.roles || [],
        isAdmin: decoded.roles?.includes("admin") ?? false,
      };
    } catch {
      return null;
    }
  },

  // Optional: separate token verification for WebSocket auth.
  // Same contract as verifyRequest, but it receives just the token string
  // and must return an AuthenticatedUser or null.
  // Default: synthesizes a Request and calls verifyRequest.
  verifyToken: async (token) => {
    const decoded = jwt.verify(token, MY_SECRET) as any;
    return {
      uid: decoded.sub,
      email: decoded.email,
      roles: decoded.roles ?? [],
      isAdmin: decoded.roles?.includes("admin") ?? false,
    };
  },

  // Optional: enable user management in admin panel
  userManagement: { ... },

  // Optional: static service key
  serviceKey: process.env.REBASE_SERVICE_KEY,

  // Optional: override default capabilities
  capabilities: {
    emailPasswordLogin: false,
    registrationEnabled: false,
    enabledProviders: ["google"],
  },

  // Optional: enrich auth responses with external tokens
  transformAuthResponse: async (response, context) => {
    const externalToken = await generateExternalToken(context.uid);
    return {
      ...response,
      tokens: { ...response.tokens, externalToken },
    };
  },
});

// Pass to initializeRebaseBackend:
await initializeRebaseBackend({
  server, app,
  database: createPostgresAdapter({ connection: db, schema }),
  auth, // AuthAdapter directly
});
```

### AuthAdapterCapabilities

The frontend reads these from `GET /api/auth/config` to dynamically show/hide UI:

```typescript
interface AuthAdapterCapabilities {
  hasBuiltInAuthRoutes: boolean;    // true for built-in, false for external
  emailPasswordLogin: boolean;
  registrationEnabled: boolean;     // open right now — bootstrap window included
  passwordReset: boolean;           // needs an email service
  adminPasswordReset: boolean;      // admin resets someone else's password
  sessionManagement: boolean;
  profileUpdate: boolean;
  emailVerification: boolean;
  magicLink: boolean;
  anonymousLogin: boolean;          // POST /auth/anonymous is open
  enabledProviders: string[];       // e.g. ["google", "github"]
  externalLoginUrl?: string;        // Redirect URL for external auth
  needsSetup?: boolean;             // true when no users exist
}
```

### Default Capabilities for Custom Adapters

When using `createCustomAuthAdapter`, all capabilities default to `false`/`[]` unless overridden via `capabilities`.

---

## Roles & Scopes

Every "may this caller do X?" is answered by a **scope**, `resource:action[:target]` — the same strings on a session, a key, an MCP token and a role. Canonical source: `packages/types/src/types/scopes.ts`.

### Two planes

- **Data plane** — `data:read|write|delete` (target: collection), `storage:read|write|delete` (target: storage source id, `(default)` for the default one), `functions:invoke` (target: function name). **Every signed-in person holds all of it.** What a person may do with rows is the collection's `securityRules` (RLS) and storage policies — never a scope. On a key or token these scopes *narrow*.
- **Admin plane** — `users:read|write`, `schema:read|write`, `database:read|write`, `backups:read`, `cron:read|write`, `logs:read`, `keys:read|write`. **Nobody holds them implicitly.** The built-in `admin` role holds all of them; other roles hold what the app declares.

### Declaring roles and app scopes (users collection)

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: {
        enabled: true,
        roles: {
            support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] },
            developer: { name: "Developer", scopes: ["schema:read", "database:read", "logs:read", "cron:read"] }
        },
        scopes: {
            "project:deploy": { label: "Deploy projects", target: "project" }
        },
        personalKeys: true
    },
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

Boot refuses:
- declaring `admin` (built in, holds everything);
- a role listing a **data-plane** scope (`data:write` on a role would grant nothing — use `securityRules`);
- an unknown scope; an app scope reusing a built-in resource (`data`, `storage`, `functions`, `users`, `schema`, `database`, `backups`, `cron`, `logs`, `keys`) or missing a `label`;
- a `defaultRole` that is `admin` or holds any admin-plane scope.

A role nobody declares (e.g. `editor`) holds no admin-plane scope but still means something to RLS policies. **`schema-admin` no longer exists** — a project that used it declares a role with the scopes it meant (e.g. `schema:read`, `schema:write`, `database:read`, `database:write`).

**App scopes** (`project:deploy`) are held by every signed-in person; they exist so a key can be narrowed to one action. Check them in a function with `requireScope` / `hasScope` / `getScopes` from `@rebasepro/server/functions` (see `rebase-custom-functions`).

### What `admin` means

- Holds every admin-plane scope, `keys:*` included.
- Is the RLS role the default policies admit — an admin reads every row of a collection that keeps them.
- Only an admin grants `admin`. A role listing every admin-plane scope is still not `admin`.
- `requireAdmin` checks the role; prefer `requireScope` for anything a narrower role or a key should do.

### Nobody grants more than they hold

- Keys: scopes within the minter's (`SCOPE_EXCEEDS_CREATOR`), service-key roles within the minter's unless admin (`ROLE_EXCEEDS_CREATOR`), never `keys:*` (`KEY_MANAGEMENT_SCOPE`).
- Accounts: a `users:write` holder cannot edit/reset/delete an account holding anything they don't (`403 ACCOUNT_OUTRANKS_CALLER`) nor grant roles beyond their own (`403 ROLE_EXCEEDS_CALLER`).

### Credentials and what they hold

| Credential | Acts as | Scopes |
|---|---|---|
| Person's session (JWT) | the user | data plane + app scopes + their roles' scopes (admin → all) |
| Service key `rk_live_…` | `api-key:<id>`, roles `["service", ...key.roles]` | exactly `key.scopes` |
| Personal key `rk_live_…` | its owner, roles read live | `key.scopes` ∩ owner's current scopes |
| MCP OAuth token | the user | `data:read|write|delete`, optionally per collection |
| `REBASE_SERVICE_KEY` | `service`, role `admin` | everything |

### Admin routes

| Route | Needs |
|---|---|
| `GET /api/admin/users`, `GET /api/admin/users/:uid`, `GET /api/admin/roles` | `users:read` |
| `POST/PUT/DELETE /api/admin/users…`, `POST /api/admin/users/:uid/reset-password` | `users:write` |
| `/api/admin/schema-editor` | `schema:read` (GET) / `schema:write` (POST) |
| `/api/admin/schema/status`, `/plan`, `/api/admin/rls-audit`, `/api/meta/contract` | `schema:read` |
| `/api/admin/schema/apply` | `schema:write` (and a person, unless machine apply is on) |
| `/api/admin/cron` | `cron:read` (GET) / `cron:write` (trigger, PUT) |
| `/api/admin/backups` | `backups:read` |
| `/api/admin/logs` | `logs:read` |
| `/api/admin/api-keys` | `keys:read` (GET) / `keys:write` — never an API key |
| SQL editor / branches over the socket | `database:read` (catalogue, list) / `database:write` (`EXECUTE_SQL`, create/delete branch) |

`GET /api/admin/roles` → `{ roles: RoleSummary[] }` (`admin` + declared roles with their scopes); `client.admin.listRoles()`. Role CRUD (`createRole`/`updateRole`/`deleteRole`, `isAdmin`/`defaultPermissions`/`collectionPermissions`) no longer exists — roles are declared in code. A missing scope anywhere → `403 SCOPE_MISSING` with `details.requiredScope`.

---

## Auth hooks (`auth.hooks`)

<!-- docs-verify: ignore -->
> **IMPORTANT FOR AGENTS: there is no `hooks` key on `RebaseBackendConfig`, and
> no `BackendHooks`, `UserHooks`, `DataHooks` or `BackendHookContext` type.**
> A config object shaped like that type-errors, and in plain JavaScript it is
> silently ignored. There are exactly two extension points, and they sit in
> different places:
>
> | Want to… | Use | Where |
> |---|---|---|
> | React to sign-up / login / logout / password reset, or replace hashing | `auth.hooks` (`AuthHooks`) | inside the `auth` block |
> | Transform or gate **collection data** across every collection | `callbacks` (`CollectionCallbacks`) | top level of the backend config |
>
> Auth writes bypass the collection save pipeline (see the warning above), which
> is exactly why `auth.hooks` exists: a `beforeSave` on the users collection does
> not fire for registration, OAuth or admin user management.

### `AuthHooks`

| Hook | Signature | Description |
|---|---|---|
| `hashPassword` | `(password) => Promise<string>` | Replace the password hash function |
| `verifyPassword` | `(password, storedHash) => Promise<boolean>` | Replace hash verification |
| `validatePasswordStrength` | `(password) => PasswordValidationResult` | Enforce your own password policy |
| `verifyCredentials` | `(email, password, repo) => Promise<UserData \| null>` | Replace credential checking entirely |
| `beforeUserCreate` | `(data) => Promise<CreateUserData>` | Transform the record before it is written |
| `afterUserCreate` | `(user) => Promise<void>` | Side effects on sign-up (provision a team, send a welcome email) |
| `beforeLogin` | `(email, method) => Promise<void>` | Throw to block a sign-in |
| `onAuthenticated` | `(user, method) => Promise<void>` | Fires on every successful authentication |
| `afterLogout` | `(uid) => Promise<void>` | Side effects on sign-out |
| `onMfaVerified` | `(uid, factorId) => Promise<void>` | Fires when a second factor is accepted |
| `customizeAccessToken` | `(claims, user) => Promise<claims>` | Add claims to the access token |
| `transformAuthResponse` | — | Reshape the JSON an auth route returns |
| `onPasswordReset` | `(uid) => Promise<void>` | Fires after a reset completes |
| `beforeUserDelete` / `afterUserDelete` | `(uid) => Promise<void>` | Throw in `before` to prevent deletion |
| `onAdminCreateUser` | — | Fires when an administrator creates a user |
| `onAdminResetPassword` | — | Fires when an administrator resets a password |

`AuthMethod` is `"login" | "register" | "oauth" | "refresh" | "password-reset" |
"anonymous" | "magic-link" | "mfa"`.

```typescript no-verify
await initializeRebaseBackend({
    // ...
    auth: {
        collection: usersCollection,
        jwtSecret: process.env.JWT_SECRET,
        hooks: {
            async afterUserCreate(user) {
                await provisionPersonalTeam(user.id);
            },
            async customizeAccessToken(claims, user) {
                return { ...claims, tenant: user.metadata?.tenantId };
            }
        }
    }
});
```

### Masking data instead

PII masking is **not** an auth hook — it belongs in the global `callbacks`
block, which fires on every data path (REST, realtime, and server-side
`rebase.dataAsAdmin`):

```typescript no-verify
await initializeRebaseBackend({
    // ...
    callbacks: {
        afterRead({ row, context }) {
            if (!context.user?.roles?.includes("admin") && row.email) {
                return { ...row, email: "***" };
            }
            return row;
        }
    }
});
```

## Email Configuration

Email is required for password reset, email verification, and welcome emails. Configure via `auth.email`.

### EmailConfig

| Property | Type | Required | Description |
|---|---|---|---|
| `from` | `string` | Yes | Sender address (e.g. `"MyApp <noreply@myapp.com>"`). |
| `smtp` | `SMTPConfig` | One of `smtp` or `sendEmail` | SMTP server configuration. |
| `sendEmail` | `(options) => Promise<void>` | One of `smtp` or `sendEmail` | Custom email sending function (e.g. AWS SES, Resend SDK). |
| `resetPasswordUrl` | `string` | No | Base URL for reset links: `{url}/reset-password?token=xxx`. |
| `verifyEmailUrl` | `string` | No | Base URL for verification links: `{url}/verify-email?token=xxx`. |
| `appName` | `string` | No | App name in email templates. Defaults to `"Rebase"`. |
| `templates` | Object | No | Custom template functions (see below). |

### SMTPConfig

```typescript
interface SMTPConfig {
  host: string;
  port: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
  name?: string;
}
```

### Custom Email Templates

```typescript
email: {
  from: "noreply@myapp.com",
  smtp: { host: "smtp.example.com", port: 587 },
  templates: {
    passwordReset: (resetUrl, user) => ({
      subject: "Reset your password",
      html: `<p>Hi ${user.displayName || user.email},</p><p><a href="${resetUrl}">Reset</a></p>`,
      text: `Reset your password: ${resetUrl}`,
    }),
    emailVerification: (verifyUrl, user) => ({
      subject: "Verify your email",
      html: `<a href="${verifyUrl}">Verify</a>`,
    }),
    welcomeEmail: (user, appName) => ({
      subject: `Welcome to ${appName}!`,
      html: `<p>Welcome, ${user.displayName || user.email}!</p>`,
    }),
    userInvitation: (setPasswordUrl, user) => ({
      subject: "You've been invited",
      html: `<p>Set your password: <a href="${setPasswordUrl}">here</a></p>`,
    }),
  },
}
```

### Custom Email Provider (Non-SMTP)

```typescript
import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);

email: {
  from: "noreply@myapp.com",
  sendEmail: async (options) => {
    await resend.emails.send({
      from: options.from || "noreply@myapp.com",
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  },
  appName: "MyApp",
  resetPasswordUrl: "https://myapp.com",
}
```

---

## Security Concepts

### Service Key

A static secret for server-to-server authentication. Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

When a request includes `Authorization: Bearer <serviceKey>`:
- It bypasses JWT verification.
- It receives admin-level access (`uid: "service"`, `roles: ["admin"]`).
- Comparison is done with constant-time comparison to prevent timing attacks.
- Must be ≥ 32 characters (validated at startup).

> **TIP:** In global and collection callbacks, server-side `rebase.dataAsAdmin` calls appear as `uid: "service"`, `roles: ["admin"]`. Use this to skip masking, bypass rate limits, or grant elevated access in your callback logic.

### Token Rotation

Refresh tokens are rotated on every use:
1. Client sends refresh token to `POST /auth/refresh`.
2. Server deletes the old refresh token and creates a new one.
3. New access + refresh tokens are returned.

### Password Reset Security

- `POST /auth/forgot-password` always returns success (doesn't reveal whether email exists).
- Reset tokens are stored as SHA-256 hashes.
- Tokens expire in 1 hour.
- After password reset, **all sessions are invalidated** (all refresh tokens deleted).

### Zod Input Validation

All auth endpoints validate input with Zod schemas:

| Field | Validation |
|---|---|
| `email` | Valid email, max 255 chars |
| `password` | Min 1 char, max 128 chars |
| `displayName` | Max 255 chars |
| `photoURL` | Valid URL, max 2048 chars |
| `refreshToken` | Min 1 char |

---

## References

- Source: `packages/server/src/auth/` — All auth implementation
- Source: `packages/server/src/auth/routes.ts` — REST auth endpoints
- Source: `packages/server/src/auth/auth-hooks.ts` — Lifecycle hooks
- Source: `packages/server/src/auth/api-keys/` — API key system
- Source: `packages/server/src/auth/rate-limiter.ts` — Rate limiting
- Source: `packages/server/src/init.ts` — `RebaseAuthConfig` and backend init
- Source: `packages/client/src/auth.ts` — Client SDK auth module
- Source: `packages/types/src/types/auth_adapter.ts` — `AuthAdapter` interface
- Source: `packages/server/src/auth/rls-scope.ts` — RLS scoping
- Source: `packages/server/src/email/types.ts` — Email configuration
- Source: `packages/types/src/types/scopes.ts` — the scope vocabulary, `scopesForRoles`, `scopeGrants`
- Source: `packages/server/src/auth/access.ts` — `requireScope`, the access model, the "never more than the caller" checks
- **Reserved Identities**: `"service"` / `"anon"` / `"api-key:{id}"` — see [Row-Level Security > Reserved System Identities](#reserved-system-identities)
