---
title: Authentication & Login
sidebar_label: Authentication & Login
description: Set up the auth controller, login view, and role simulation in your Rebase React frontend.
---

## Overview

Rebase provides ready-to-use React components and hooks for authentication:

- **`useRebaseAuthController`** — Manages auth state, tokens, and session persistence
- **`LoginView`** — Pre-built login/signup form with OAuth support
- **Role simulation** — Test different roles without logging out

## Auth Controller

The `useRebaseAuthController` hook is the core of frontend authentication. It manages the current user, tokens, and session:

```typescript
import { useRebaseAuthController } from "@rebasepro/app";
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL, websocketUrl: WS_URL });

const authController = useRebaseAuthController({
    client,
    googleClientId: GOOGLE_CLIENT_ID  // Optional — enables Google OAuth
});

// Available properties:
authController.user           // Current user object (or null)
authController.initialLoading // True while checking stored session
authController.signOut()      // Log out
authController.getAuthToken() // Get current JWT for API calls
```

Pass the `authController` to the Rebase navigation controller to gate the entire admin panel behind authentication.

## Login View

The `LoginView` component provides a complete login and registration form:

```tsx
import { LoginView } from "@rebasepro/app";

function App() {
    if (!authController.user) {
        return (
            <LoginView
                authController={authController}
                googleClientId={GOOGLE_CLIENT_ID}
            />
        );
    }
    return <MyApp />;
}
```

The login view handles:
- Email/password login and registration
- Google, GitHub and LinkedIn OAuth sign-in (when configured)
- Password reset flow
- Form validation and error states

## Roles Model

Roles are stored as a `text[]` array column directly on the `rebase.users` table. You define available roles as an enum in your users collection definition:

```typescript title="config/collections/users.ts" no-verify
roles: {
    name: "Roles",
    type: "array",
    columnType: "text[]",
    of: {
        name: "Role",
        type: "string",
        enum: {
            admin: "Admin",
            editor: "Editor",
            viewer: "Viewer"
        }
    },
    admin: {
        readOnly: false
    }
}
```

To add or remove role options, update the `enum` map in your users collection and regenerate the schema.

## Role Simulation (Dev Mode)

In developer mode, you can simulate different roles without logging out. This is useful for testing RLS policies:

```typescript
import { useBuildEffectiveRoleController } from "@rebasepro/app";

const effectiveRoleController = useBuildEffectiveRoleController();

// When active, the UI behaves as if the current user has this role
effectiveRoleController.setEffectiveRole("editor");
```

## Next Steps

- **[Backend Authentication](/docs/backend/authentication)** — JWT, OAuth providers, SMTP configuration
- **[Security Rules (RLS)](/docs/collections/security-rules)** — Row-level access control per collection
- **[Client SDK Authentication](/docs/sdk/authentication)** — Programmatic auth methods
