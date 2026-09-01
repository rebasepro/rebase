---
title: Authentification
sidebar_label: Authentification
description: Authentification côté client avec le SDK Rebase — connexion par e-mail/mot de passe, fournisseurs OAuth, gestion des sessions et écouteurs de l'état d'authentification.
---

## Vue d'ensemble

Le module `client.auth` gère l'authentification des utilisateurs, la gestion des tokens et la persistance des sessions. Une fois qu'un utilisateur est connecté, toutes les requêtes de données suivantes incluent automatiquement le JWT.

Le SDK conserve les sessions dans `localStorage` par défaut et rafraîchit automatiquement les tokens avant leur expiration.

:::note[Chaque méthode de connexion résout une session aplatie]
`signInWithEmail`, `signUp` et chaque méthode `signInWith*` renvoient
**`{ user, accessToken, refreshToken }`** — le SDK a déjà déballé l'enveloppe
pour vous.

L'API REST sous-jacente renvoie le token imbriqué, sous la forme
`{ user, tokens: { accessToken, … } }`. Cette différence ne compte que si vous
appelez aussi `/api/auth/*` directement avec `fetch` : `body.accessToken` y vaut
`undefined` et le token se trouve dans `body.tokens.accessToken`. Voir
[le format de l'API REST](/docs/backend/authentication).
:::

## E-mail / Mot de passe

### Connexion

```typescript
const { user, accessToken, refreshToken } = await client.auth.signInWithEmail(
    "user@example.com",
    "password"
);
console.log(user.uid, user.email);
```

### Inscription

```typescript
const { user } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

## Fournisseurs OAuth

Le SDK inclut des méthodes dédiées pour les fournisseurs OAuth populaires, ainsi qu'un `signInWithOAuth()` générique pour tout fournisseur personnalisé.

### Google

Prend en charge trois styles d'invocation :

```typescript
// ID-token flow (One Tap / Sign In With Google button)
await client.auth.signInWithGoogle({ idToken: googleIdToken });

// Access-token flow (popup)
await client.auth.signInWithGoogle({ accessToken: googleAccessToken });

// Authorization code flow (most secure, server-side exchange)
await client.auth.signInWithGoogle({ code: authCode, redirectUri: "https://..." });
```

### Autres fournisseurs

Chaque fournisseur suit le flux de code d'autorisation avec `(code, redirectUri)` :

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

Apple et Twitter nécessitent des paramètres supplémentaires :

```typescript
// Apple — optional user info from first sign-in
await client.auth.signInWithApple(code, redirectUri, {
    name: { firstName: "Jane", lastName: "Doe" },
    email: "jane@example.com"
});

// Twitter — requires PKCE code verifier
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
```

### OAuth générique

Pour tout fournisseur enregistré sur le backend :

```typescript
await client.auth.signInWithOAuth("custom-provider", {
    code: authCode,
    redirectUri: "https://myapp.com/callback"
});
```

## Déconnexion

```typescript
await client.auth.signOut();
```

Ceci révoque le refresh token sur le serveur, efface la session locale et émet un événement `SIGNED_OUT`.

## Gestion des sessions

### Obtenir la session actuelle

```typescript
const session = client.auth.getSession();
// { accessToken, refreshToken, expiresAt, user } | null
```

### Obtenir l'utilisateur actuel (vérifié par le serveur)

```typescript
const user = await client.auth.getUser();
// Fetches the user from the backend (GET /auth/me)
```

### Mettre à jour le profil de l'utilisateur

```typescript
const updatedUser = await client.auth.updateUser({
    displayName: "Jane Doe",
    photoURL: "https://example.com/avatar.jpg"
});
```

### Rafraîchir le token

Le rafraîchissement du token se produit automatiquement, mais vous pouvez le déclencher manuellement :

```typescript
const session = await client.auth.refreshSession();
```

## Écouteur de l'état d'authentification

Réagissez aux changements d'authentification dans toute votre application :

```typescript
const unsubscribe = client.auth.onAuthStateChange((event, session) => {
    // event: "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED"
    console.log("Auth event:", event);
    console.log("Session:", session?.user?.email);
});

// Stop listening
unsubscribe();
```

## Gestion des mots de passe

### Mot de passe oublié

```typescript
const { success, message } = await client.auth.resetPasswordForEmail(
    "user@example.com"
);
```

### Réinitialiser le mot de passe (avec token)

```typescript
const { success, message } = await client.auth.resetPassword(
    resetToken,
    "newSecurePassword"
);
```

### Changer le mot de passe (authentifié)

```typescript
const { success, message } = await client.auth.changePassword(
    "oldPassword",
    "newPassword"
);
```

## Vérification de l'e-mail

```typescript
// Send verification email to the current user
await client.auth.sendVerificationEmail();

// Verify with the token from the email link
await client.auth.verifyEmail(token);
```

## Gestion des sessions (multi-appareils)

```typescript
// List all active sessions
const sessions = await client.auth.getSessions();

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

## Configuration de l'authentification

Interrogez la configuration d'authentification du backend :

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

## Stockage de session personnalisé

Par défaut, les sessions sont stockées dans `localStorage`. Vous pouvez le personnaliser avec l'option `auth` :

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

## Forme de l'objet User

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

## Étapes suivantes

- **[Interroger les données](/docs/sdk/querying)** — Opérations CRUD et constructeur de requêtes
- **[Abonnements en temps réel](/docs/sdk/realtime)** — Données en direct avec WebSockets
- **[Authentification côté backend](/docs/backend/authentication)** — Configuration de l'authentification côté serveur
