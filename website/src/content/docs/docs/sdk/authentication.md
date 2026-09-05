---
title: Authentication
sidebar_label: Authentication
description: Client-side authentication with the Rebase SDK — email/password sign-in, OAuth providers, session management, and auth state listeners.
---

## Overview

The `client.auth` module handles user authentication, token management, and session persistence. Once a user signs in, all subsequent data requests automatically include the JWT.

The SDK persists sessions to `localStorage` by default and automatically refreshes tokens before they expire.

:::note[Every sign-in method resolves to a flattened session]
`signInWithEmail`, `signUp` and every `signInWith*` method return
**`{ user, accessToken, refreshToken }`** — the SDK has already unwrapped the
envelope for you.

The REST API underneath returns the token nested instead, as
`{ user, tokens: { accessToken, … } }`. That difference only matters if you also
call `/api/auth/*` directly with `fetch`, where `body.accessToken` is `undefined`
and the token is at `body.tokens.accessToken`. See
[the wire format](/docs/backend/authentication#response-format).
:::

## Email / Password

### Sign In

```typescript
const { user, accessToken, refreshToken } = await client.auth.signInWithEmail(
    "user@example.com",
    "password"
);
console.log(user.uid, user.email);
```

### Sign Up

```typescript
const { user } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

## OAuth Providers

The SDK includes dedicated methods for popular OAuth providers, plus a generic `signInWithOAuth()` for any custom provider.

### Google

Supports three invocation styles:

```typescript
// ID-token flow (One Tap / Sign In With Google button)
await client.auth.signInWithGoogle({ idToken: googleIdToken });

// Access-token flow (popup)
await client.auth.signInWithGoogle({ accessToken: googleAccessToken });

// Authorization code flow (most secure, server-side exchange)
await client.auth.signInWithGoogle({ code: authCode, redirectUri: "https://..." });
```

### Other Providers

Each provider follows the authorization code flow with `(code, redirectUri)`:

```typescript
await client.auth.signInWithGitHub(code, redirectUri);
await client.auth.signInWithMicrosoft(code, redirectUri);
await client.auth.signInWithFacebook(code, redirectUri);
await client.auth.signInWithLinkedin(code, redirectUri);
await client.auth.signInWithDiscord(code, redirectUri);
await client.auth.signInWithGitLab(code, redirectUri);
await client.auth.signInWithBitbucket(code, redirectUri);
await client.auth.signInWithSlack(code, redirectUri);
await client.auth.signInWithSpotify(code, redirectUri);
```

Apple and Twitter require additional parameters:

```typescript
// Apple — optional user info from first sign-in
await client.auth.signInWithApple(code, redirectUri, {
    name: { firstName: "Jane", lastName: "Doe" },
    email: "jane@example.com"
});

// Twitter — requires PKCE code verifier
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
```

### Generic OAuth

For any provider registered on the backend:

```typescript
await client.auth.signInWithOAuth("custom-provider", {
    code: authCode,
    redirectUri: "https://myapp.com/callback"
});
```

## Sign Out

```typescript
await client.auth.signOut();
```

This revokes the refresh token on the server, clears the local session, and emits a `SIGNED_OUT` event.

## Session Management

### Get Current Session

```typescript
const session = client.auth.getSession();
// { accessToken, refreshToken, expiresAt, user } | null
```

### Get Current User (Server-Verified)

```typescript
const user = await client.auth.getUser();
// Fetches the user from the backend (GET /auth/me)
```

### Update User Profile

```typescript
const updatedUser = await client.auth.updateUser({
    displayName: "Jane Doe",
    photoURL: "https://example.com/avatar.jpg"
});
```

### Refresh Token

Token refresh happens automatically, but you can trigger it manually:

```typescript
const session = await client.auth.refreshSession();
```

## Where the Session Lives: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Mode | Where the refresh token is | When to use it |
|------|----------------------------|----------------|
| `"json"` *(default)* | Returned in the response body, kept in `localStorage` | A native app, a script, anything without a browser's cookie jar |
| `"cookie"` | An **HttpOnly** cookie the backend sets | A browser app. Script running on your page cannot read it, which is what makes it XSS-safe |

Cookie mode needs `auth.cookieAuth` on the backend, and it is what the generated
frontend template uses.

## Waiting for the Session to Be Restored

**A restored session is not available on the first render.** `getSession()` is
synchronous, so on page load it answers `null` while the restore is still in
flight — and in cookie mode a restore is *always* in flight, because the refresh
token is in a cookie the page cannot read, so the client has to ask the server
for a fresh access token.

Reading it synchronously is what produces a logged-out flash on every reload:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` resolves once the client has finished trying — whether it
found a session or not:

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

In React, that is one effect:

```tsx
import { useEffect, useState } from "react";

function useCurrentUser() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        client.auth.isInitialized().then(() => {
            if (cancelled) return;
            setUser(client.auth.getSession()?.user ?? null);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, []);

    return { user, loading };
}
```

`useRebaseAuthController` in `@rebasepro/app` already does this, so an app built
on the generated template gets it for free.

A successful restore also reaches `onAuthStateChange` as `TOKEN_REFRESHED` — it
*is* a refresh — but a listener alone cannot tell you that the restore finished:
a boot with no session emits nothing at all, which is indistinguishable from one
still in progress. Await `isInitialized()` for that question and use the
listener for changes after it.

## Auth State Listener

React to authentication changes across your application:

```typescript
const unsubscribe = client.auth.onAuthStateChange((event, session) => {
    // event: "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED"
    console.log("Auth event:", event);
    console.log("Session:", session?.user?.email);
});

// Stop listening
unsubscribe();
```

| Event | When |
|-------|------|
| `SIGNED_IN` | A sign-in or sign-up completed |
| `TOKEN_REFRESHED` | The access token was renewed — including the silent renewal that restores a session on page load |
| `USER_UPDATED` | `updateUser()` changed the profile |
| `SIGNED_OUT` | A sign-out, or a refresh that failed for good |

## Password Management

### Forgot Password

```typescript
const { success, message } = await client.auth.resetPasswordForEmail(
    "user@example.com"
);
```

### Reset Password (with Token)

```typescript
const { success, message } = await client.auth.resetPassword(
    resetToken,
    "newSecurePassword"
);
```

### Change Password (Authenticated)

```typescript
const { success, message } = await client.auth.changePassword(
    "oldPassword",
    "newPassword"
);
```

## Email Verification

```typescript
// Send verification email to the current user
await client.auth.sendVerificationEmail();

// Verify with the token from the email link
await client.auth.verifyEmail(token);
```

## Session Management (Multi-Device)

```typescript
// List all active sessions
const sessions = await client.auth.getSessions();

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

## Auth Configuration

Query the backend's authentication configuration:

```typescript
const config = await client.auth.getAuthConfig();
// {
//   hasBuiltInAuthRoutes: boolean,
//   emailPasswordLogin: boolean,
//   registrationEnabled: boolean,   // open right now, bootstrap window included
//   passwordReset: boolean,         // needs an email service
//   adminPasswordReset: boolean,
//   sessionManagement: boolean,
//   profileUpdate: boolean,
//   emailVerification: boolean,
//   magicLink: boolean,
//   anonymousLogin: boolean,
//   enabledProviders: string[],
//   needsSetup: boolean
// }
```

## Custom Session Storage

By default, sessions are stored in `localStorage`. You can customize this with the `auth` option:

```typescript
import { createRebaseClient, createCookieStorage } from "@rebasepro/client";

// Use cookies instead of localStorage
const client = createRebaseClient({
    baseUrl: "http://localhost:3001",
    auth: {
        storage: createCookieStorage({
            path: "/",
            sameSite: "Lax",
            secure: true
        }),
        autoRefresh: true,       // default: true
        persistSession: true     // default: true
    }
});
```

## User Object Shape

```typescript
// Canonical type — import from @rebasepro/types
interface User {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    providerId: string;
    isAnonymous: boolean;
    emailVerified?: boolean;
    roles?: string[];          // text[] from the users table
    metadata?: Record<string, unknown>;
}
```

## Next Steps

- **[Querying Data](/docs/sdk/querying)** — CRUD operations and query builder
- **[Realtime Subscriptions](/docs/sdk/realtime)** — Live data with WebSockets
- **[Authentication Backend](/docs/backend/authentication)** — Server-side auth configuration
