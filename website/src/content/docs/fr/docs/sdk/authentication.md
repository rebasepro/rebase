---
sourceHash: 08f462e8a9e1a008
title: Authentification
sidebar_label: Authentification
description: Authentification côté client avec le SDK Rebase — connexion par e-mail/mot de passe, fournisseurs OAuth, gestion des sessions et écouteurs d'état d'authentification.
---

## Présentation

Le module `client.auth` gère l'authentification des utilisateurs, la gestion des jetons et la persistance des sessions. Dès qu'un utilisateur se connecte, toutes les requêtes de données ultérieures incluent automatiquement le JWT.

Le SDK persiste les sessions dans le `localStorage` par défaut et actualise automatiquement les jetons avant leur expiration.

:::note[Chaque méthode de connexion résout une session aplatie]
`signInWithEmail`, `signUp` et chaque méthode `signInWith*` renvoient
**`{ user, accessToken, refreshToken }`** — le SDK a déjà déballé l'enveloppe pour vous.

L'API REST sous-jacente renvoie quant à elle le jeton imbriqué, sous la forme
`{ user, tokens: { accessToken, … } }`. Cette différence n'a d'importance que si vous
appelez également `/api/auth/*` directement avec `fetch`, où `body.accessToken` vaut `undefined`
et le jeton se trouve à `body.tokens.accessToken`. Consultez
[le format réseau](/docs/backend/auth-endpoints/#response-format).
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

Le SDK comprend des méthodes dédiées pour les fournisseurs OAuth courants, ainsi qu'un `signInWithOAuth()` générique pour tout fournisseur personnalisé.

### Google

Prend en charge trois styles d'appel :

```typescript
// ID-token flow (One Tap / Sign In With Google button)
await client.auth.signInWithGoogle({ idToken: googleIdToken });

// Access-token flow (popup)
await client.auth.signInWithGoogle({ accessToken: googleAccessToken });

// Authorization code flow (most secure, server-side exchange)
await client.auth.signInWithGoogle({ code: authCode, redirectUri: "https://..." });
```

### Autres fournisseurs

Chaque fournisseur suit le flux par code d'autorisation avec `(code, redirectUri)` :

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

## Liens magiques (Magic Links)

Un lien de connexion en un clic par e-mail. Le lien atterrit sur l'une de vos pages avec un
jeton ; renvoyez le jeton pour l'échanger contre une session.

```typescript
// 1. Ask for the link. `redirectTo` is where the link points.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` renvoie la même réponse, que l'adresse possède ou non un
compte. C'est délibéré : un point de terminaison qui indiquerait « aucun utilisateur » constitue un oracle
d'énumération de comptes ; n'utilisez donc pas le résultat pour indiquer à une personne si elle est
inscrite — il ne le sait pas.

Les deux nécessitent qu'un service d'e-mail soit configuré sur le backend, faute de quoi ils renvoient un code 503
`EMAIL_NOT_CONFIGURED`.

## Codes à usage unique

Un code à six chiffres par e-mail, pour les cas où un lien n'est pas pratique — une
application native, un second appareil, un navigateur qui altère les liens.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Envoyer l'adresse avec le code est ce qui restreint une tentative de devinette à six chiffres à *un seul* compte plutôt qu'à tous les comptes en même temps.

## Sessions anonymes

Connectez un visiteur sans aucun identifiant, afin qu'il puisse commencer à utiliser l'application avant d'avoir une raison de s'inscrire :

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

Le compte est réel : il possède un identifiant, des rôles et une session, de sorte que la sécurité au niveau des lignes (Row-Level Security) délimite ses lignes exactement comme elle le ferait pour un utilisateur inscrit. Ce qu'il n'a pas, c'est un moyen de retour — personne ne peut se reconnecter *en tant que* ce compte une seconde fois, donc tout ce qu'il possède est perdu avec la session.

`linkAnonymous` permet de ne plus le rendre éphémère. L'utilisateur **conserve son identifiant**, de sorte que tout ce qu'il a créé en étant anonyme lui reste attribué :

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Échec | Signification |
|-------|---------------|
| `ANONYMOUS_AUTH_DISABLED` (403) | Le backend n'a pas activé l'authentification anonyme |
| `NOT_ANONYMOUS` (400) | La session actuelle appartient à un compte ordinaire |
| `EMAIL_EXISTS` (409) | L'adresse possède déjà un compte — connectez-vous plutôt à celui-ci |

## Associer un fournisseur à un compte existant

`signInWithGoogle` et consorts connectent un utilisateur. `linkProvider` associe l'identité d'un fournisseur au compte déjà connecté, permettant ainsi à la même personne de revenir par l'une ou l'autre porte :

```typescript
await client.auth.linkProvider("google", { idToken });
```

La session prouve déjà la propriété du compte, donc contrairement à la connexion, cela ne nécessite pas que le fournisseur ait vérifié l'e-mail, et les deux adresses n'ont pas besoin de correspondre. L'opération réussit de façon idempotente (`alreadyLinked: true`) lorsque cette identité est déjà associée à ce compte, et refuse avec `IDENTITY_ALREADY_LINKED` (409) lorsqu'elle appartient à un autre.

## Rechercher un utilisateur par e-mail

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Trois champs non sensibles et rien d'autre — suffisant pour afficher « vous invitez Jane » avant l'envoi d'une invitation.

## Authentification multifacteur

Facteurs TOTP — une application d'authentification — ainsi que le challenge qui élève une session de `aal1` à `aal2`.

### Enrôler un facteur

```typescript
const { factor, totp, recoveryCodes } = await client.auth.mfa.enroll({
    friendlyName: "Phone"
});

showQrCode(totp.uri);        // otpauth://… — what the authenticator scans
showRecoveryCodes(recoveryCodes);
```

**Affichez les codes de récupération une seule fois et jamais plus.** Seuls leurs hachages sont stockés, rien ne pourra donc les afficher ultérieurement.

Le facteur n'est pas utilisable tant que l'utilisateur n'a pas prouvé que son application d'authentification a généré un code à partir de ce secret :

```typescript
await client.auth.mfa.verify(factor.id, "418293");
```

### Se connecter avec la MFA

Une connexion sur un compte enrôlé en MFA ne renvoie aucune session. Elle est refusée avec `401 MFA_REQUIRED`, et les `details` de l'erreur contiennent un `mfaToken` et les `factors` vérifiés du compte. Passez ce jeton à `challenge` et `verifyChallenge` pour obtenir la session :

```typescript
import { RebaseApiError } from "@rebasepro/client";

type MfaRequired = {
    mfaToken: string;
    factors: { id: string; factorType: string; friendlyName?: string }[];
};

try {
    await client.auth.signInWithEmail(email, password);
} catch (e) {
    if (!(e instanceof RebaseApiError) || e.code !== "MFA_REQUIRED") throw e;
    const { mfaToken, factors } = e.details as MfaRequired;

    const { challengeId } = await client.auth.mfa.challenge(factors[0].id, { mfaToken });

    // A TOTP code, or one of the recovery codes.
    const { user } = await client.auth.mfa.verifyChallenge(challengeId, "418293", { mfaToken });
}
```

Le `mfaToken` n'est envoyé que sur ces deux requêtes et n'est jamais installé sur le client. `verifyChallenge` génère la session `aal2`, ce client l'adopte et émet `SIGNED_IN` comme pour toute autre connexion. Le `mfaToken` expire cinq minutes après la connexion qui l'a renvoyé, et un challenge cinq minutes après son ouverture. Un challenge ayant atteint sa limite de tentatives reste consommé pour le reste de sa durée de vie — sans quoi un challenge ouvert permettrait des tentatives illimitées sur six chiffres.

Sans `mfaToken`, les deux appels élèvent la session que ce client détient déjà de `aal1` à `aal2`.

### Supprimer un facteur

```typescript
await client.auth.mfa.unenroll(factorId);
```

Nécessite une session `aal2` — ayant déjà validé un challenge — afin qu'un jeton `aal1` dérobé ne puisse pas désactiver la MFA. La suppression du dernier facteur vérifié élimine également les codes de récupération.

## Déconnexion

```typescript
await client.auth.signOut();
```

Cela révoque le jeton d'actualisation sur le serveur, efface la session locale et émet un événement `SIGNED_OUT`.

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

### Mettre à jour le profil utilisateur

```typescript
const updatedUser = await client.auth.updateUser({
    displayName: "Jane Doe",
    photoURL: "https://example.com/avatar.jpg"
});
```

### Actualiser le jeton

L'actualisation du jeton s'effectue automatiquement, mais vous pouvez la déclencher manuellement :

```typescript
const session = await client.auth.refreshSession();
```

## Emplacement de la session : `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Mode | Emplacement du jeton d'actualisation | Quand l'utiliser |
|------|--------------------------------------|------------------|
| `"json"` *(par défaut)* | Renvoyé dans le corps de la réponse, conservé dans `localStorage` | Une application native, un script, tout environnement sans gestionnaire de cookies de navigateur |
| `"cookie"` | Un cookie **HttpOnly** défini par le backend | Une application de navigateur. Un script s'exécutant sur votre page ne peut pas le lire, ce qui le protège contre les attaques XSS |

Le mode cookie nécessite `auth.cookieAuth` sur le backend, et c'est ce qu'utilise le modèle frontend généré.

## Attendre la restauration de la session

**Une session restaurée n'est pas disponible lors du premier rendu.** `getSession()` est synchrone, donc au chargement de la page, il renvoie `null` pendant que la restauration est encore en cours — et en mode cookie, une restauration est *toujours* en cours, car le jeton d'actualisation se trouve dans un cookie que la page ne peut pas lire, obligeant le client à demander un nouveau jeton d'accès au serveur.

Le lire de manière synchrone provoque un clignotement d'état déconnecté à chaque rechargement :

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` se résout dès que le client a terminé sa tentative — qu'il ait trouvé une session ou non :

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

En React, cela se résume à un effet :

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

`useRebaseAuthController` dans `@rebasepro/app` effectue déjà cela, donc une application construite sur le modèle généré en bénéficie automatiquement.

Une restauration réussie parvient également à `onAuthStateChange` sous forme de `TOKEN_REFRESHED` — il s'agit bien d'un rafraîchissement — mais un écouteur seul ne peut pas vous indiquer que la restauration s'est terminée : un démarrage sans session n'émet absolument rien, ce qui ne permet pas de le distinguer d'une restauration encore en cours. Attendez la résolution de `isInitialized()` pour cette vérification et utilisez l'écouteur pour les changements ultérieurs.

## Écouteur d'état d'authentification

Réagissez aux changements d'authentification dans l'ensemble de votre application :

```typescript
const unsubscribe = client.auth.onAuthStateChange((event, session) => {
    // event: "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED"
    console.log("Auth event:", event);
    console.log("Session:", session?.user?.email);
});

// Stop listening
unsubscribe();
```

| Événement | Quand |
|-----------|-------|
| `SIGNED_IN` | Une connexion ou une inscription est terminée |
| `TOKEN_REFRESHED` | Le jeton d'accès a été renouvelé — y compris le renouvellement silencieux qui restaure une session au chargement de la page |
| `USER_UPDATED` | `updateUser()` a modifié le profil |
| `SIGNED_OUT` | Une déconnexion, ou un rafraîchissement qui a échoué définitivement |

## Gestion des mots de passe

### Mot de passe oublié

```typescript
const { success, message } = await client.auth.resetPasswordForEmail(
    "user@example.com"
);
```

### Réinitialiser le mot de passe (avec jeton)

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

Par défaut, les sessions sont stockées dans `localStorage`. Vous pouvez personnaliser ce comportement avec l'option `auth` :

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

## Structure de l'objet utilisateur

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

## Prochaines étapes

- **[Interrogation des données](/docs/sdk/querying)** — Opérations CRUD et constructeur de requêtes
- **[Abonnements en temps réel](/docs/sdk/realtime)** — Données en direct avec les WebSockets
- **[Backend d'authentification](/docs/backend/authentication)** — Configuration de l'authentification côté serveur
