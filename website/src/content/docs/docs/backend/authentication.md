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

```typescript
const backend = await initializeRebaseBackend({
    // ...
    auth: {
        collection: usersCollection,         // Your users collection definition
        jwtSecret: env.JWT_SECRET,           // Required — signing secret
        accessExpiresIn: "1h",               // Access token lifetime (default: 1h)
        refreshExpiresIn: "30d",             // Refresh token lifetime (default: 30d)
        serviceKey: env.REBASE_SERVICE_KEY,  // Optional — for server-to-server calls
        allowRegistration: true,             // Allow new signups (default: true)
        seedDefaultRoles: true,              // Seed enum roles on startup

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

## Auth Endpoints

All auth endpoints are mounted at `/api/auth/`:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Create a new account |
| `POST` | `/api/auth/login` | Login with email/password |
| `POST` | `/api/auth/refresh` | Refresh the access token |
| `POST` | `/api/auth/<provider>` | OAuth sign-in (e.g., `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/logout` | Revoke refresh token |
| `POST` | `/api/auth/forgot-password` | Send password reset email |
| `POST` | `/api/auth/reset-password` | Reset password with token |

All data API endpoints require a valid `Authorization: Bearer <token>` header when `requireAuth: true` (the default).

## Auto-Created Tables

On first startup, Rebase creates these tables in the `rebase` schema:

- **`rebase.users`** — User accounts with email, password hash, and a `roles` text[] column
- **`rebase.refresh_tokens`** — JWT refresh token storage

Roles are stored as a `text[]` array column directly on the users table — there are no separate `roles` or `user_roles` tables.

## First User Bootstrap

When no users exist in the database, the first person to register automatically becomes an admin. After that, registration is controlled by the `allowRegistration` setting.

This ensures you can always bootstrap a fresh deployment without needing to seed the database manually.

## Collection-Level Auth Configuration

Instead of relying solely on the default database auth rules, you can mark any Postgres collection (such as `users.ts` or a custom `members.ts` collection) as the authentication collection. This is configured via the `auth` property on the collection itself:

```typescript
import { PostgresCollection } from "@rebasepro/types";

const membersCollection: PostgresCollection = {
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

## Service Key Authentication

For server-to-server communication (e.g., cron jobs, external services), configure a static service key:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Clients authenticate with the `Authorization: Bearer <service-key>` header. The service key bypasses user authentication and grants full access.

## Custom Auth Adapters

Rebase allows complete replacement of the built-in authentication system via the `AuthAdapter` interface. Use this to integrate with Firebase Auth, Auth0, Clerk, or any external SSO provider:

```typescript
import { AuthAdapter } from "@rebasepro/types";

const myAdapter: AuthAdapter = {
    middleware: async (c, next) => {
        // Extract and verify token from the request
        const token = c.req.header("Authorization")?.replace("Bearer ", "");
        // Verify with your auth provider...
        // Set user context for downstream handlers
        await next();
    }
};

await initializeRebaseBackend({
    auth: myAdapter,  // Pass adapter directly instead of config object
    // ...
});
```

## Next Steps

- **[Frontend Authentication](/docs/frontend/authentication)** — Login UI, auth controller, user management
- **[Security Rules (RLS)](/docs/collections/security-rules)** — Row-level access control
- **[Client SDK Authentication](/docs/sdk/authentication)** — Auth methods in the client SDK
