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
[the wire format](/docs/backend/auth-endpoints/#response-format).
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

## Magic Links

A one-click sign-in link by email. The link lands on a page of yours carrying a
token; hand the token back to trade it for a session.

```typescript
// 1. Ask for the link. `redirectTo` is where the link points.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` answers the same thing whether or not the address has an
account. That is deliberate: an endpoint that said "no such user" is an account
enumeration oracle, so do not use the result to tell a person whether they are
registered — it does not know.

Both need an email service configured on the backend, or they answer 503
`EMAIL_NOT_CONFIGURED`.

## One-Time Codes

A six-digit code by email, for the same job where a link is awkward — a native
app, a second device, a browser that mangles links.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Sending the address with the code is what keeps a six-digit guess a guess
against *one* account rather than against every account at once.

## Anonymous Sessions

Sign a visitor in with no credentials at all, so they can start using the app
before they have a reason to sign up:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

The account is real: it has an id, roles and a session, so row-level security
scopes its rows exactly as it would a signed-up user's. What it does not have is
a way back — nobody can sign in *as* it a second time, so everything it owns is
lost with the session.

`linkAnonymous` is how it stops being throwaway. The user **keeps their id**, so
everything they created while anonymous stays theirs:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Failure | Means |
|---------|-------|
| `ANONYMOUS_AUTH_DISABLED` (403) | The backend has not enabled anonymous auth |
| `NOT_ANONYMOUS` (400) | The current session belongs to an ordinary account |
| `EMAIL_EXISTS` (409) | The address already has an account — sign in to that one instead |

## Linking a Provider to an Existing Account

`signInWithGoogle` and friends sign a user *in*. `linkProvider` attaches a
provider identity to the account already signed in, so the same person can come
back through either door:

```typescript
await client.auth.linkProvider("google", { idToken });
```

The session already proves account ownership, so unlike sign-in this does not
require the provider to have verified the email, and the two addresses need not
match. It succeeds idempotently (`alreadyLinked: true`) when that identity is
already on this account, and refuses with `IDENTITY_ALREADY_LINKED` (409) when
it belongs to a different one.

## Looking Up a User by Email

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Three non-sensitive fields and nothing else — enough to show "you are inviting
Jane" before an invitation is sent.

## Multi-Factor Authentication

TOTP factors — an authenticator app — plus the challenge that raises a session
from `aal1` to `aal2`.

### Enrolling a factor

```typescript
const { factor, totp, recoveryCodes } = await client.auth.mfa.enroll({
    friendlyName: "Phone"
});

showQrCode(totp.uri);        // otpauth://… — what the authenticator scans
showRecoveryCodes(recoveryCodes);
```

**Show the recovery codes once and never again.** Only their hashes are stored,
so nothing can display them later.

The factor is not usable until the user proves their authenticator produced a
code from that secret:

```typescript
await client.auth.mfa.verify(factor.id, "418293");
```

### Signing in with MFA

A sign-in against an MFA-enrolled account returns a session at `aal1`. Open a
challenge and answer it to get the real one:

```typescript
const factors = await client.auth.mfa.listFactors();
const { challengeId } = await client.auth.mfa.challenge(factors[0].id);

// A TOTP code, or one of the recovery codes.
const { user } = await client.auth.mfa.verifyChallenge(challengeId, "418293");
```

`verifyChallenge` mints the `aal2` session and this client adopts it, replacing
the tokens the sign-in handed back. A challenge expires after five minutes, and
a challenge that has been guessed at its limit stays spent for the rest of its
life — otherwise one open challenge is unlimited guesses at six digits.

### Removing a factor

```typescript
await client.auth.mfa.unenroll(factorId);
```

Requires an `aal2` session — one that has already answered a challenge — so a
stolen `aal1` token cannot turn MFA off. Removing the last verified factor also
discards the recovery codes.

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
    baseUrl: import.meta.env.VITE_API_URL,
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
