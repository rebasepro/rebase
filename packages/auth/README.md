# @rebasepro/auth

Custom JWT authentication adapter for the Rebase backend — React hooks and API utilities for email/password, OAuth, and session management.

## Installation

```bash
pnpm add @rebasepro/auth
```

**Peer dependencies:** `react >= 19`, `react-dom >= 19`

## What This Package Does

`@rebasepro/auth` connects the Rebase CMS frontend to the backend's JWT authentication system. It provides a React hook (`useRebaseAuthController`) that manages login, registration, token refresh, session persistence, and user profile updates, plus a lower-level API module for direct HTTP calls to auth endpoints. For the generic `LoginView` and `RebaseAuth` UI components, see `@rebasepro/app`.

## Key Exports

### Hooks

| Export | Description |
|---|---|
| `useRebaseAuthController` | Main auth hook — returns a `RebaseAuthController` with login, register, logout, token refresh, session management, and profile methods. Accepts `RebaseAuthControllerProps`. |
| `useBackendUserManagement` | Hook for admin-level user CRUD (list, create, update, delete users). Returns a `UserManagement` interface. Accepts `BackendUserManagementConfig`. |

### Types

| Export | Description |
|---|---|
| `RebaseAuthController` | Extends the base `AuthController` with email/password login, Google login, generic OAuth, registration, password reset/change, session management, and profile updates. |
| `RebaseAuthControllerProps` | Config for `useRebaseAuthController` — `client`, `apiUrl`, `googleClientId`, `onSignOut`, `defineRolesFor`. |
| `AuthTokens` | `{ accessToken, refreshToken, accessTokenExpiresAt }` |
| `UserInfo` | `{ uid, email, displayName, photoURL, emailVerified, roles, metadata }` |
| `AuthResponse` | `{ user: UserInfo, tokens: AuthTokens }` |
| `RefreshResponse` | `{ tokens: AuthTokens }` |
| `BackendUserManagementConfig` | Config for `useBackendUserManagement`. |
| `UserManagement` | Interface returned by `useBackendUserManagement`. |

### API Utilities

| Export | Description |
|---|---|
| `setApiUrl(url)` | Set the base API URL for all auth requests |
| `getApiUrl()` | Get the current base API URL |
| `fetchAuthConfig()` | Fetch auth config from `/api/auth/config` (cached, deduplicated) |
| `AuthApiError` | Error class with `message` and `code` fields |
| `AuthConfigResponse` | Type — `{ needsSetup, registrationEnabled, emailServiceEnabled, passwordReset, emailVerification, enabledProviders }` |

## Quick Start

```tsx
import { useRebaseAuthController } from "@rebasepro/auth";
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3001" });

function App() {
    const authController = useRebaseAuthController({
        client,
        apiUrl: "http://localhost:3001",
    });

    // authController.emailPasswordLogin(email, password)
    // authController.googleLogin({ idToken })
    // authController.register(email, password, displayName)
    // authController.signOut()
    // authController.user — current logged-in user or null
}
```

## Related Packages

- [`@rebasepro/app`](../core) — `LoginView`, `RebaseAuth` UI components, `AuthController` base type
- [`@rebasepro/client`](../client) — HTTP client with its own `auth` module for direct API calls
- [`@rebasepro/types`](../types) — Base `AuthController` and `User` types
- [`@rebasepro/ui`](../ui) — UI components used by auth views
