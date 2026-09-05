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
- [Roles & Permissions](#roles--permissions)
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
    }
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

> **IMPORTANT FOR AGENTS:** The very first user registered (via `POST /auth/register` or OAuth) is automatically promoted to `"admin"`. This prevents the chicken-and-egg problem. All subsequent users receive the `defaultRole`.

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
    await rebase.dataAsAdmin.team_members.create({ team_id, user_id: profile.uid });
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
   - **The provider asserted `emailVerified: true`** → **link** the provider to the existing account and log in as that user. One account, two sign-in methods.
   - **The provider did NOT verify the email** → reject with `403 EMAIL_NOT_VERIFIED`. Nothing is created or modified.
3. If neither exists → create a new user, link the identity, assign `defaultRole`.

> **IMPORTANT FOR AGENTS:** A second account is **never** silently created for
> an email that already exists. If asked "does signing in with Google create a
> duplicate user?", the answer is no — it either links (verified) or errors
> (unverified). This is **not configurable**; there is deliberately no option to
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
  userId: string;
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

API keys provide machine-to-machine authentication for agents, MCP servers, CI pipelines, cron jobs, and third-party integrations. They are scoped to specific collections and operations, and can optionally be granted full admin access.

### Key Format

- Prefix: `rk_` (e.g. `rk_live_abc123...`)
- Storage: SHA-256 hash of the full key. The plaintext key is returned **exactly once** at creation.
- Display: Only the first 12 characters (`key_prefix`) are shown in subsequent API responses.

### Admin Access for Agents / MCP

By default API keys get the `service` role (data access only). Set `"admin": true` to grant the key the `admin` role, which allows it to call **all admin routes** (`/api/admin/*`) — including schema management, user management, and API key management itself.

> **Use `admin: true` for agents, MCP servers, and CI pipelines that need full control over the Rebase instance.**

```bash
# CLI — create an admin API key
rebase api-keys create --name "My Agent" --admin --full-access

# REST
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Agent",
    "admin": true,
    "permissions": [{ "collection": "*", "operations": ["read", "write", "delete"] }]
  }'
```

### API Key Admin Endpoints

All endpoints are mounted under `/api/admin/api-keys` and require **admin** authentication (JWT with admin role or service key).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/api-keys` | List all API keys (masked — no hashes). |
| `POST` | `/api/admin/api-keys` | Create a new API key. Returns the full plaintext key once. |
| `GET` | `/api/admin/api-keys/:id` | Get single API key details (masked). |
| `PUT` | `/api/admin/api-keys/:id` | Update name, permissions, admin, rate_limit, or expires_at. |
| `DELETE` | `/api/admin/api-keys/:id` | Revoke (soft-delete) an API key. |

### Create API Key Request

```typescript
interface CreateApiKeyRequest {
  name: string;
  permissions: ApiKeyPermission[];
  admin?: boolean;           // true = grant admin role (access to all admin routes)
  rate_limit?: number | null;    // Requests per 15-min window. null = unlimited
  expires_at?: string | null;    // ISO-8601 timestamp. null = no expiration
}

interface ApiKeyPermission {
  collection: string;            // Collection slug, or "*" for all collections
  operations: ("read" | "write" | "delete")[];
}
```

### Examples

**Scoped key (read-only on one collection):**

```bash
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <admin-token-or-service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Analytics Pipeline",
    "permissions": [
      { "collection": "events", "operations": ["read", "write"] },
      { "collection": "users", "operations": ["read"] }
    ],
    "rate_limit": 500,
    "expires_at": "2025-12-31T23:59:59Z"
  }'
```

**Admin key (for agents / MCP / CI):**

```bash
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <admin-token-or-service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI Agent",
    "admin": true,
    "permissions": [{ "collection": "*", "operations": ["read", "write", "delete"] }]
  }'
```

### Using an API Key

```bash
curl http://localhost:3000/api/data/events \
  -H "Authorization: Bearer rk_live_abc123..."
```

### API Key Middleware Behavior

When a request arrives with a `rk_` prefixed bearer token:
1. The token is SHA-256 hashed and looked up in the `rebase.api_keys` table.
2. Expiry and revocation status are checked.
3. If `admin: true`, the key is assigned `roles: ["admin", "service"]` — granting access to admin routes. Otherwise `roles: ["service"]`.
4. Permissions are validated against the requested collection and HTTP method (`GET` → `read`, `POST`/`PUT`/`PATCH` → `write`, `DELETE` → `delete`).
5. The DataDriver is scoped with `withAuth()` using the key's service identity. This does **not** bypass RLS — the statements run as the restricted `rebase_user` role with `app.uid = 'api-key:{id}'`, and your policies are evaluated against that.
6. Per-key rate limiting is enforced if `rate_limit` is set.

> **WARNING FOR AGENTS:** an API key is a long-lived credential carrying a broad
> identity (`service`, or `admin` too when `admin: true`). It is for trusted
> server-side use only — never expose one to client-side code.
>
> It does **not** bypass RLS, and assuming it does produces the opposite bug to
> the one you expect: a non-admin key with `"*"` permissions can read **nothing**,
> because no policy grants the `service` role. That is RLS working. Either grant
> `service` in the relevant collections' security rules, or use an admin key,
> which clears the built-in default policies through their `rolesOverlap(['admin'])`
> arm. Owner-style rules (`owner_id = rebase.uid()`) never match a key.

### Role Summary

| Key type | `roles` assigned | Admin routes | Data routes |
|---|---|---|---|
| Default (no `admin`) | `["service"]` | ✗ | ✓ (scoped by `permissions`) |
| `admin: true` | `["admin", "service"]` | ✓ | ✓ |

### API Key Response Types

```typescript
// Returned once at creation (includes the full plaintext key)
interface ApiKeyWithSecret {
  id: string;
  name: string;
  key_prefix: string;       // First 12 chars, for display
  key: string;              // FULL plaintext key — save this immediately
  permissions: ApiKeyPermission[];
  admin: boolean;
  rate_limit: number | null;
  created_by: string;
  createdAt: string;
  updatedAt: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

// All subsequent reads (no hash, no full key)
interface ApiKeyMasked {
  id: string;
  name: string;
  key_prefix: string;
  permissions: ApiKeyPermission[];
  admin: boolean;
  rate_limit: number | null;
  created_by: string;
  createdAt: string;
  updatedAt: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}
```

### Also update `admin` on an existing key

```bash
curl -X PUT http://localhost:3000/api/admin/api-keys/<id> \
  -H "Authorization: Bearer <admin-token-or-service-key>" \
  -H "Content-Type: application/json" \
  -d '{ "admin": true }'
```

### CLI

```bash
# List all keys
rebase api-keys list

# Create a scoped key
rebase api-keys create --name "Read Only" --permissions '[{"collection":"orders","operations":["read"]}]'

# Create an admin key (for agents / MCP / CI)
rebase api-keys create --name "My Agent" --admin --full-access

# Revoke a key
rebase api-keys revoke <key-id>
```

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

Rebase implements RLS by scoping the DataDriver via `withAuth()` before each request. This injects the authenticated user's identity into the database context.

### How RLS Scoping Works

1. Auth middleware verifies the JWT (or API key / service key).
2. The middleware calls `scopeDataDriver(driver, { uid, roles })`.
3. If the driver supports `withAuth()` (e.g. Postgres), it returns a scoped clone with Postgres session variables set:
   - `rebase.uid()` — the user's ID
   - `rebase.jwt()` — the JWT claims
   - `rebase.roles()` — the user's role IDs
4. All subsequent queries in that request use the scoped driver with RLS policies applied.

### Fail-Closed Security

> **IMPORTANT FOR AGENTS:** If `withAuth()` throws an error, the request is **rejected** with 500. The system never falls back to unscoped access. This is by design (fail-closed).

### Anonymous Users

When `requireAuth` is `false` and no token is provided, the driver is scoped with:
- `uid: "anon"`
- `roles: ["anon"]`

This allows Postgres RLS policies to handle public access explicitly.

### Service Key Scoping

Requests with the `serviceKey` are scoped as `uid: "service"`, `roles: ["admin"]`.
That is admin-scoped, **not** RLS-bypassing: the statements still run as
`rebase_user` with policies evaluated against that identity — the admin role
simply satisfies the built-in default policies. `policy.serverContext()`
(`rebase.uid() IS NULL`) is **false** for it, so a collection with
`disableDefaultPolicies: true` whose only rule is `serverContext()` denies these
writes and returns zero rows for these reads. `rebase.sql()` is the real bypass:
owner connection, no policies.

### API Key Scoping

API keys use a service identity for RLS scoping: `uid: "api-key:{id}"`, `roles: ["service"]` (or `["admin", "service"]` when `admin: true`). They do not inherit the `created_by` user's identity.

### Reserved System Identities

The auth middleware assigns these reserved identities automatically. They are visible in `context.user` (global and collection callbacks) and `c.get("user")` (custom functions):

| Auth Method | `userId` | `roles` | When It Occurs |
|---|---|---|---|
| JWT (end-user) | Real user ID (e.g. `"abc123"`) | User's assigned roles (e.g. `["viewer"]`) | Normal authenticated requests |
| Service Key | `"service"` | `["admin"]` | Server-side `rebase.dataAsAdmin` calls, cron jobs, or any request with `Authorization: Bearer <serviceKey>` |
| API Key (default) | `"api-key:{id}"` | `["service"]` | Machine-to-machine API key requests |
| API Key (admin) | `"api-key:{id}"` | `["admin", "service"]` | Admin API key requests |
| Anonymous | `"anon"` | `["anon"]` | Unauthenticated when `requireAuth: false` |
| No token + `requireAuth: true` | — | — | **Rejected (401)** |

> **IMPORTANT FOR AGENTS:** the server singleton's data plane is `rebase.dataAsAdmin` (used in cron jobs, custom functions and webhooks). It is backed by the **native DataDriver** — no JSON round trip through the REST API — and is scoped once, at boot, as `{ uid: "service", roles: ["admin"] }`. Callbacks live in the driver rather than the route layer, so global and collection callbacks still fire, seeing `uid: "service"` and `roles: ["admin"]`. That is how a callback distinguishes a server-internal read from an end-user one. `rebase.data` still resolves at runtime as an alias, but `RebaseServerClient` omits it from the type so the privileged plane has exactly one name.

---

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

## Roles & Permissions

### Role Data Structure

```typescript
interface RoleData {
  id: string;
  name: string;
  isAdmin: boolean;
  defaultPermissions: {
    read?: boolean;
    create?: boolean;
    edit?: boolean;
    delete?: boolean;
  } | null;
  collectionPermissions: Record<string, {
    read?: boolean;
    create?: boolean;
    edit?: boolean;
    delete?: boolean;
  }> | null;
}
```

### Built-in Role Behavior

- The **first user** in the system is automatically assigned the `"admin"` role.
- Subsequent users get the `defaultRole` (if configured).
- Setting `defaultRole: "admin"` throws a startup error to prevent privilege escalation.
- Admin status is determined by having a role with `id === "admin"` or `id === "schema-admin"`.

### Admin Routes for User/Role Management

Admin user and role management is handled via dedicated admin routes (mounted under `/api/admin`) which require `requireAuth` + `requireAdmin` middleware.

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
- **Reserved Identities**: `"service"` / `"anon"` / `"api-key:{id}"` — see [Row-Level Security > Reserved System Identities](#reserved-system-identities)
