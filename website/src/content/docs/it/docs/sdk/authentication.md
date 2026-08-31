---
title: Autenticazione
sidebar_label: Autenticazione
description: Autenticazione lato client con l'SDK di Rebase — accesso con email/password, provider OAuth, gestione delle sessioni e listener dello stato di autenticazione.
---

## Panoramica

Il modulo `client.auth` gestisce l'autenticazione degli utenti, la gestione dei token e la persistenza delle sessioni. Una volta che un utente ha effettuato l'accesso, tutte le successive richieste di dati includono automaticamente il JWT.

L'SDK mantiene le sessioni nel `localStorage` per impostazione predefinita e aggiorna automaticamente i token prima della loro scadenza.

:::note[Ogni metodo di accesso restituisce una sessione appiattita]
`signInWithEmail`, `signUp` e ogni metodo `signInWith*` restituiscono
**`{ user, accessToken, refreshToken }`**: l'SDK ha già scartato l'involucro per
te.

L'API REST sottostante restituisce invece il token annidato, come
`{ user, tokens: { accessToken, … } }`. Questa differenza conta solo se chiami
anche `/api/auth/*` direttamente con `fetch`, dove `body.accessToken` è
`undefined` e il token si trova in `body.tokens.accessToken`. Vedi
[il formato dell'API REST](/docs/backend/authentication).
:::

## Email / Password

### Accesso

```typescript
const { user, accessToken, refreshToken } = await client.auth.signInWithEmail(
    "user@example.com",
    "password"
);
console.log(user.uid, user.email);
```

### Registrazione

```typescript
const { user } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

## Provider OAuth

L'SDK include metodi dedicati per i provider OAuth più diffusi, oltre a un `signInWithOAuth()` generico per qualsiasi provider personalizzato.

### Google

Supporta tre stili di invocazione:

```typescript
// ID-token flow (One Tap / Sign In With Google button)
await client.auth.signInWithGoogle({ idToken: googleIdToken });

// Access-token flow (popup)
await client.auth.signInWithGoogle({ accessToken: googleAccessToken });

// Authorization code flow (most secure, server-side exchange)
await client.auth.signInWithGoogle({ code: authCode, redirectUri: "https://..." });
```

### Altri Provider

Ogni provider segue il flusso del codice di autorizzazione con `(code, redirectUri)`:

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

Apple e Twitter richiedono parametri aggiuntivi:

```typescript
// Apple — optional user info from first sign-in
await client.auth.signInWithApple(code, redirectUri, {
    name: { firstName: "Jane", lastName: "Doe" },
    email: "jane@example.com"
});

// Twitter — requires PKCE code verifier
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
```

### OAuth Generico

Per qualsiasi provider registrato sul backend:

```typescript
await client.auth.signInWithOAuth("custom-provider", {
    code: authCode,
    redirectUri: "https://myapp.com/callback"
});
```

## Disconnessione

```typescript
await client.auth.signOut();
```

Questo revoca il refresh token sul server, cancella la sessione locale ed emette un evento `SIGNED_OUT`.

## Gestione delle Sessioni

### Ottenere la Sessione Corrente

```typescript
const session = client.auth.getSession();
// { accessToken, refreshToken, expiresAt, user } | null
```

### Ottenere l'Utente Corrente (Verificato dal Server)

```typescript
const user = await client.auth.getUser();
// Fetches the user from the backend (GET /auth/me)
```

### Aggiornare il Profilo Utente

```typescript
const updatedUser = await client.auth.updateUser({
    displayName: "Jane Doe",
    photoURL: "https://example.com/avatar.jpg"
});
```

### Aggiornare il Token

L'aggiornamento del token avviene automaticamente, ma puoi attivarlo manualmente:

```typescript
const session = await client.auth.refreshSession();
```

## Listener dello Stato di Autenticazione

Reagisci ai cambiamenti di autenticazione in tutta la tua applicazione:

```typescript
const unsubscribe = client.auth.onAuthStateChange((event, session) => {
    // event: "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED"
    console.log("Auth event:", event);
    console.log("Session:", session?.user?.email);
});

// Stop listening
unsubscribe();
```

## Gestione delle Password

### Password Dimenticata

```typescript
const { success, message } = await client.auth.resetPasswordForEmail(
    "user@example.com"
);
```

### Reimpostare la Password (con Token)

```typescript
const { success, message } = await client.auth.resetPassword(
    resetToken,
    "newSecurePassword"
);
```

### Cambiare la Password (Autenticato)

```typescript
const { success, message } = await client.auth.changePassword(
    "oldPassword",
    "newPassword"
);
```

## Verifica dell'Email

```typescript
// Send verification email to the current user
await client.auth.sendVerificationEmail();

// Verify with the token from the email link
await client.auth.verifyEmail(token);
```

## Gestione delle Sessioni (Multi-Dispositivo)

```typescript
// List all active sessions
const sessions = await client.auth.getSessions();

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

## Configurazione dell'Autenticazione

Interroga la configurazione di autenticazione del backend:

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

## Archiviazione della Sessione Personalizzata

Per impostazione predefinita, le sessioni vengono archiviate nel `localStorage`. Puoi personalizzarlo con l'opzione `auth`:

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

## Forma dell'Oggetto User

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

## Prossimi Passi

- **[Interrogare i dati](/docs/sdk/querying)** — Operazioni CRUD e query builder
- **[Sottoscrizioni in tempo reale](/docs/sdk/realtime)** — Dati in diretta con i WebSocket
- **[Autenticazione nel Backend](/docs/backend/authentication)** — Configurazione dell'autenticazione lato server
