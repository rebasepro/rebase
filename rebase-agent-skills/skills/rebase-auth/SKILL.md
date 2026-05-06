---
name: rebase-auth
description: Guide for setting up and using Rebase Authentication, roles, and Row-Level Security (RLS) policies. Use this skill when the user needs to add authentication, manage users and roles, or secure data access with RLS policies.
---

# Rebase Authentication

Rebase provides built-in authentication with role-based access control (RBAC) and application-level Row-Level Security (RLS) for all auto-generated APIs.

## Core Concepts

### Users

Users are managed through the Rebase user management system. Each user has:
- `uid`: Unique identifier
- `email`: User's email address
- `displayName`: Display name
- `roles`: Array of role IDs assigned to the user

### Roles

Roles define what a user can see and do. Each role has:
- `id`: Unique string identifier (e.g., `"admin"`, `"editor"`, `"viewer"`)
- `name`: Human-readable name
- `isAdmin`: Boolean flag for full access

Roles are stored as string IDs on user objects and resolved to full role objects at runtime.

### RLS Policies (Row-Level Security)

Rebase implements **application-level** RLS policies (not PostgreSQL native RLS). These policies are evaluated by the backend before executing database operations.

#### Available Auth Context Functions

Inside RLS policy expressions, you have access to:

| Function | Returns | Description |
|----------|---------|-------------|
| `auth.uid()` | `string` | The authenticated user's UID |
| `auth.jwt()` | `object` | The decoded JWT token claims |
| `auth.roles()` | `string[]` | Array of role IDs assigned to the current user |

**Important:** These are custom functions injected by the Rebase backend, NOT standard PostgreSQL functions.

## Setting Up Authentication

### 1. Configure Auth in Backend

Auth is configured via the `auth` field in `initializeRebaseBackend()`. The database driver is provided through the **bootstrapper protocol**:

```typescript
import { initializeRebaseBackend, HonoEnv } from "@rebasepro/server-core";
import { createPostgresDatabaseConnection, createPostgresBootstrapper } from "@rebasepro/server-postgresql";

const { db, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

const backend = await initializeRebaseBackend({
    server,
    app,
    bootstrappers: [
        createPostgresBootstrapper({
            connection: db,
            schema: { tables, enums, relations },
            adminConnectionString: process.env.DATABASE_URL,
            connectionString
        })
    ],
    auth: {
        jwtSecret: process.env.JWT_SECRET!,
        accessExpiresIn: "1h",       // Access token TTL
        refreshExpiresIn: "30d",     // Refresh token TTL
        allowRegistration: false,    // First user can always register
        seedDefaultRoles: true,      // Create default admin/editor/viewer roles
        defaultRole: "admin",        // Default role for new users
        serviceKey: process.env.REBASE_SERVICE_KEY, // Optional: service-to-service auth
        google: {                    // Optional: Google OAuth
            clientId: process.env.GOOGLE_CLIENT_ID!,
        },
    },
});
```

> [!WARNING]
> **JWT Dual-Package Hazard (Monorepos / pnpm)**
> When running a backend inside a monorepo workspace (especially with tools like `tsx` and `--preserve-symlinks`), you may encounter a `RebaseApiError: JWT secret not configured. Call configureJwt() first` error. This occurs because Node.js resolves two different module instances of `@rebasepro/server-core`.
>
> **Prevention:** You must explicitly call `configureJwt` in your backend application's entry point (`index.ts`) before `initializeRebaseBackend`:
> ```typescript
> import { initializeRebaseBackend, configureJwt } from "@rebasepro/server-core";
>
> configureJwt({
>     secret: process.env.JWT_SECRET!,
>     accessExpiresIn: "1h",
>     refreshExpiresIn: "30d"
> });
>
> const backend = await initializeRebaseBackend({ ... });
> ```

Auth tables (`rebase.users`, `rebase.roles`, etc.) are auto-created on first startup.

### Auth Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `jwtSecret` | `string` | — | JWT signing secret (≥32 chars) |
| `accessExpiresIn` | `string` | `"1h"` | Access token TTL |
| `refreshExpiresIn` | `string` | `"30d"` | Refresh token TTL |
| `allowRegistration` | `boolean` | `true` | Allow new user registration |
| `seedDefaultRoles` | `boolean` | `false` | Create admin/editor/viewer roles |
| `defaultRole` | `string` | — | Default role for new users |
| `serviceKey` | `string` | — | Service-to-service auth key |
| `google` | `{ clientId }` | — | Google OAuth configuration |

### 2. Define Roles

Roles can be defined in collection configuration or managed via the Studio UI:

```typescript
const roles = [
    { id: "admin", name: "Administrator", isAdmin: true },
    { id: "editor", name: "Editor", isAdmin: false },
    { id: "viewer", name: "Viewer", isAdmin: false },
];
```

### 3. Apply Security Rules (RLS)

Security rules are defined per-collection via the `securityRules` array:

```typescript
import { PostgresCollection } from "@rebasepro/types";

const postsCollection: PostgresCollection = {
    name: "Posts",
    table: "posts",
    securityRules: [
        // Any authenticated user can read
        { operation: "select", access: "authenticated" },
        // Only editors can create
        { operation: "insert", roles: ["editor"] },
        // Only the author can update their own posts
        { operation: "update", ownerField: "author_id" },
        // Only admins can delete
        { operation: "delete", roles: ["admin"] }
    ],
    properties: {
        // ...
    }
};
```

## Frontend Auth Setup

The frontend uses a composition pattern for authentication:

```tsx
import { useRebaseAuthController, useBackendUserManagement, RebaseAuth } from "@rebasepro/auth";
import { Rebase } from "@rebasepro/core";
import { createRebaseClient } from "@rebasepro/client";

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : undefined);

function App() {
    const rebaseClient = React.useMemo(() => createRebaseClient({ baseUrl: API_URL }), []);

    const authController = useRebaseAuthController({
        client: rebaseClient,
        googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID
    });

    const userManagement = useBackendUserManagement({
        client: rebaseClient,
        currentUser: authController.user
    });

    return (
        <Rebase client={rebaseClient} authController={authController} userManagement={userManagement}>
            <RebaseAuth/>
            {/* ... rest of app */}
        </Rebase>
    );
}
```

## User Management

### Via MCP Server

| Tool | Description |
|------|-------------|
| `list_users` | List all users and their roles |
| `add_user` | Invite a new user |
| `update_user_roles` | Change a user's assigned roles |
| `remove_user` | Remove a user |

### Via Studio UI

The Rebase Studio includes a built-in user management panel for visual role assignment.

## Dev Mode & Role Simulation

The Studio supports:
- **Dev/Editor mode toggle**: Switch between developer view and end-user preview
- **Effective Role simulation**: In Dev Mode, developers can select an "effective role" to preview exactly what a specific role can see and do

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
