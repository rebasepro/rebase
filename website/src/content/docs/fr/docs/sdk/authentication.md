---
sourceHash: e886a47c056f9c06
title: Authentification
sidebar_label: Authentification
description: Authentification côté client avec le SDK Rebase — connexion par e-mail/mot de passe, fournisseurs OAuth, gestion des sessions et écouteurs d'état d'authentification.
---

## Vue d'ensemble

Le module `client.auth` gère l'authentification des utilisateurs, la gestion des jetons et la persistance des sessions. Dès qu'un utilisateur se connecte, toutes les requêtes de données ultérieures incluent automatiquement le JWT.

Le SDK persiste les sessions dans `localStorage` par défaut et actualise automatiquement les jetons avant leur expiration.

:::note[Chaque méthode de connexion se résout en une session aplatie]
`signInWithEmail`, `signUp` et chaque méthode `signInWith*` retournent **`{ user, accessToken, refreshToken }`** — le SDK a déjà extrait les données pour vous.

L'API REST sous-jacente retourne le jeton imbriqué, sous la forme `{ user, tokens: { accessToken, … } }`. Cette différence n'a d'importance que si vous appelez également `/api/auth/*` directement avec `fetch`, où `body.accessToken` est `undefined` et le jeton se trouve sous `body.tokens.accessToken`. Voir [le format réseau](/docs/backend/auth-endpoints/#response-format).
:::

## E-mail / Mot de passe

### Se connecter

```typescript
const { user, accessToken, refreshToken } = await client.auth.signInWithEmail(
    "user@example.com",
    "password"
);
console.log(user.uid, user.email);
```

### S'inscrire

```typescript
const { user, confirmationRequired } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

Lorsque [`requireEmailVerification`](/docs/backend/email-verification/) est activé,
il n'y a pas de session tant que l'adresse n'est pas confirmée : `confirmationRequired` est `true` et `user` est `null`, indiquez donc à la personne d'ouvrir son e-mail. Sinon, `confirmationRequired` est `false` et `user` correspond au compte connecté. En version 0.23, `signUp` résout `{ user, accessToken, refreshToken }` et connecte toujours l'utilisateur.

## Fournisseurs OAuth

Le SDK comprend des méthodes dédiées pour les fournisseurs OAuth les plus populaires, ainsi qu'un `signInWithOAuth()` générique pour tout fournisseur personnalisé.

### Google

Prend en charge trois modes d'appel :

```typescript
// ID-token flow (One Tap / Sign In With Google button)
await client.auth.signInWithGoogle({ idToken: googleIdToken });

// Access-token flow (popup)
await client.auth.signInWithGoogle({ accessToken: googleAccessToken });

// Authorization code flow (most secure, server-side exchange)
await client.auth.signInWithGoogle({ code: authCode, redirectUri: "https://..." });
```

### Autres fournisseurs

Chaque fournisseur suit le flux de code d'autorisation (authorization code flow) avec `(code, redirectUri)` :

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

Apple et Twitter requièrent des paramètres supplémentaires :

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

Un lien de connexion en un clic envoyé par e-mail. Le lien est toujours `<base>/auth/magic-link?token=…`, où `<base>` est la valeur `email.magicLinkUrl` du backend, ou son URL de base de réinitialisation de mot de passe (`FRONTEND_URL` au runtime) si celle-ci n'est pas définie. Il n'y a pas de paramètre `redirectTo` par requête. Servez ce chemin dans votre frontend et renvoyez le jeton pour l'échanger contre une session. Le CMS le prend en charge en connectant l'utilisateur (en passant par l'étape du code en cas de second facteur) ; les autres frontends nécessitent une page d'atterrissage.

```typescript
// 1. Ask for the link.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` renvoie la même réponse, que l'adresse soit associée à un
compte ou non. C'est délibéré : un point de terminaison qui indiquerait « aucun utilisateur trouvé »
constituerait un oracle d'énumération de comptes. N'utilisez donc pas le résultat pour indiquer à
une personne si elle est inscrite ou non — le système ne le sait pas.

L'envoi d'un lien nécessite qu'un service d'e-mail soit configuré sur le backend,
faute de quoi `sendMagicLink` renverra une erreur 503 `EMAIL_NOT_CONFIGURED`.

## Codes à usage unique

Un code à six chiffres par e-mail, pour les cas où un lien s'avère peu pratique — une application
native, un second appareil, un navigateur qui altère les liens.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

L'envoi de l'adresse avec le code permet de limiter une tentative de devinette de six chiffres
à *un seul* compte plutôt qu'à l'ensemble des comptes simultanément.

## Sessions anonymes

Connectez un visiteur sans aucun identifiant, lui permettant ainsi de commencer à utiliser l'application
avant même d'avoir une raison de s'inscrire :

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

Le compte est bien réel : il possède un identifiant, des rôles et une session, ce qui permet à la sécurité
au niveau des lignes (row-level security) de délimiter ses lignes exactement comme pour un utilisateur inscrit. Ce qu'il n'a pas,
en revanche, c'est un moyen de reconnexion — personne ne peut se reconnecter *en tant que* ce compte une seconde fois,
de sorte que tout ce qui lui appartient est perdu avec la session.

`linkAnonymous` permet d'éviter qu'il soit éphémère. L'utilisateur **conserve son identifiant**, de sorte
que tout ce qu'il a créé pendant sa session anonyme lui reste attribué :

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Échec | Signification |
|-------|---------------|
| `ANONYMOUS_AUTH_DISABLED` (403) | Le backend n'a pas activé l'authentification anonyme, ou l'a désactivée depuis la connexion de cet invité : un invité ne devient un compte que si `allowAnonymous` est activé |
| `REGISTRATION_DISABLED` (403) | L'inscription est fermée sur le backend, et la conversion en compte constitue une inscription |
| `NOT_ANONYMOUS` (400) | La session actuelle appartient à un compte ordinaire |
| `EMAIL_EXISTS` (409) | L'adresse possède déjà un compte — connectez-vous plutôt à celui-ci |

<span class="since-badge" data-since="0.27">Depuis 0.27</span> Un invité qui ne revient jamais reste sous forme de ligne dans la base. Un administrateur peut
les supprimer avec `client.admin.listGuests()`, `client.admin.deleteGuest(uid)` et
`client.admin.deleteGuests({ lastSeenBefore })`, ou sur Rebase Cloud avec
[`rebase cloud guests`](/docs/cli/cloud/#guests). Ces méthodes ne touchent jamais qu'aux invités,
et `deleteGuests` fonctionne par lots : répétez l'opération tant que `remaining` n'est pas égal à 0, avec
`offset` défini sur le nombre d'éléments ignorés jusqu'à présent.

## Lier un fournisseur à un compte existant

`signInWithGoogle` et ses équivalents *connectent* un utilisateur. `linkProvider` associe l'identité
d'un fournisseur au compte déjà connecté, permettant à la même personne de revenir
par l'un ou l'autre moyen d'accès :

```typescript
await client.auth.linkProvider("google", { idToken });
```

La session prouvant déjà la propriété du compte, cela n'exige pas que le fournisseur
ait vérifié l'e-mail (contrairement à la connexion), et les deux adresses n'ont pas besoin
de correspondre. L'opération réussit de façon idempotente (`alreadyLinked: true`) lorsque cette identité
est déjà liée à ce compte, et refuse avec `IDENTITY_ALREADY_LINKED` (409) lorsqu'elle
appartient à un autre compte.

## Rechercher un utilisateur par e-mail

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Trois champs non sensibles et rien d'autre — suffisant pour afficher « vous invitez Jane »
avant l'envoi d'une invitation. Optionnel : réservé à un appelant connecté, et renvoie une
erreur 404 sauf si le backend définit `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Authentification multifacteur

Enrôlement d'un facteur, deuxième étape de connexion, codes de récupération et suppression d'un facteur : [Authentification multifacteur](/docs/sdk/multi-factor-authentication/).

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

Une requête ne part jamais avec un jeton que le client sait expiré : les requêtes
partagent une même actualisation et sont envoyées une seule fois, avec le nouveau jeton. Un jeton que le serveur
refuse prématurément bénéficie tout de même d'une actualisation, puis d'une nouvelle tentative par requête.

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
| `"cookie"` | Un cookie **HttpOnly** défini par le backend | Une application de navigateur. Le script exécuté sur votre page ne peut pas le lire, ce qui le protège contre les failles XSS |

Le mode cookie requiert `auth.cookieAuth` sur le backend, et c'est ce qu'utilise le modèle
frontend généré.

## Attendre la restauration de la session

**Une session restaurée n'est pas disponible lors du premier rendu.** `getSession()` est
synchrone : au chargement de la page, il renvoie `null` pendant que la restauration est encore
en cours — et en mode cookie, une restauration est *toujours* en cours, car le jeton d'actualisation
se trouve dans un cookie que la page ne peut pas lire, obligeant le client à demander un nouveau
jeton d'accès au serveur.

Une lecture synchrone provoque un clignotement d'état déconnecté à chaque rechargement :

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` se résout une fois que le client a terminé sa tentative — qu'il ait
trouvé une session ou non :

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

En React, cela correspond à un seul effet :

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

`useRebaseAuthController` dans `@rebasepro/app` effectue déjà cela, une application basée
sur le modèle généré en bénéficie donc automatiquement. Les requêtes de données n'ont pas besoin d'attendre : une requête
effectuée pendant la restauration est envoyée dès qu'elle aboutit — en tant qu'utilisateur restauré ou de manière anonyme — évitant
ainsi qu'un premier rendu ne lise une liste publique à la place des données propres à l'utilisateur.

Une restauration qui déclenche un rafraîchissement (un jeton stocké expiré ou le mode cookie) parvient à
`onAuthStateChange` sous la forme `TOKEN_REFRESHED` ; un jeton stocké encore valide est adopté
silencieusement. Un écouteur ne peut donc pas vous indiquer la fin de la restauration : un démarrage qui n'émet
rien ne peut être distingué d'un démarrage toujours en cours. Attendez `isInitialized()`
pour cette vérification et utilisez l'écouteur pour les changements ultérieurs.

`restoreOutcome()` indique la manière dont la restauration s'est terminée, une fois `isInitialized()`
résolu : `"restored"`, `"none"` (rien à restaurer), `"refused"` (le serveur a
refusé la session) ou `"unreachable"` (le serveur était inaccessible, la session n'a donc
été ni confirmée ni refusée). En mode cookie, `"unreachable"` sans session constitue le seul
cas où l'état « déconnecté » n'est pas garanti comme certain :

```typescript
await client.auth.isInitialized();
if (!client.auth.getSession() && client.auth.restoreOutcome() === "unreachable") {
    console.log("Offline: could not check the session.");
}
```

## Écouteur d'état d'authentification

Réagissez aux changements d'authentification à travers votre application :

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
| `SIGNED_IN` | Une connexion ou une inscription s'est terminée |
| `TOKEN_REFRESHED` | Le jeton d'accès a été renouvelé — y compris le renouvellement silencieux qui restaure une session au chargement de la page |
| `USER_UPDATED` | `updateUser()` a modifié le profil, `linkAnonymous()` a converti un invité en compte, `changeEmail()` a initié un changement d'adresse, ou `confirmEmailChange()` a basculé ce compte vers sa nouvelle adresse |
| `SIGNED_OUT` | Une déconnexion, `revokeAllSessions()`, ou une actualisation ayant définitivement échoué |

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

### Changer de mot de passe (authentifié)

```typescript
const { success, message } = await client.auth.changePassword(
    "oldPassword",
    "newPassword"
);
```

Toutes les autres sessions du compte sont clôturées : toute autre personne en détenant une doit se reconnecter
avec le nouveau mot de passe. Cet appareil reste connecté. Le serveur répond avec une
nouvelle session que le client adopte (en émettant `TOKEN_REFRESHED`).

## Vérification d'e-mail

L'inscription envoie par e-mail son lien de vérification au nouveau compte lorsque l'e-mail
est configuré. `sendVerificationEmail()` l'envoie à nouveau.

```typescript
// Send verification email to the current user
await client.auth.sendVerificationEmail();

// Verify with the token from the email link. Signed in as that account, this
// keeps everything on it.
const { passwordRemoved } = await client.auth.verifyEmail(token);

// Signed out, an account that holds a password answers PROOF_REQUIRED:
try {
    await client.auth.verifyEmail(token);
} catch (e) {
    if (e instanceof Error && "code" in e && e.code === "PROOF_REQUIRED") {
        // Keep the password, and sign in:
        await client.auth.verifyEmail(token, { password });
        // …or verify without it, which removes it:
        // await client.auth.verifyEmail(token, { removeUnproven: true });
    }
}
```

Le lien valide l'accès à la boîte de réception, et non l'identité de celui qui a enregistré l'adresse ; un mot de passe
qui n'est prouvé ni par la session ni par l'appel est donc supprimé plutôt que conservé — voir
[Vérification d'e-mail](/docs/backend/email-verification/).

Sur un backend configuré avec `requireEmailVerification`, `signUp()` se résout avec
`{ confirmationRequired: true, user: null }` et sans session : le compte
se connecte une fois le lien suivi avec son mot de passe.

## Modifier l'adresse e-mail

Un utilisateur connecté peut transférer son propre compte vers une autre adresse. Rien
ne change tant que la nouvelle adresse n'a pas répondu :

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

Le lien est valable 24 heures ; `getUser()` indique l'adresse en attente sous le nom
`pendingEmail`. La confirmation ne nécessite aucune session, et un client connecté avec ce
compte adopte la nouvelle adresse et émet `USER_UPDATED`. Les motifs de refus sont détaillés
dans [Modifier une adresse e-mail](/docs/backend/auth-endpoints/#changing-an-email-address).

## Gestion des sessions (multi-appareils)

```typescript
// List all active sessions, one per sign-in
const sessions = await client.auth.getSessions();
// [{ id, userAgent, ipAddress, createdAt, isCurrentSession }, …]

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

Chaque jeton d'accès mentionne la connexion à laquelle il appartient, de sorte qu'exactement une entrée possède
`isCurrentSession: true` : l'appareil demandeur. La révocation d'une session met fin simultanément au
jeton d'actualisation et au jeton d'accès de cet appareil dès la requête suivante,
aussi bien par HTTP que sur un socket temps réel actif. La déconnexion (`signOut()`) effectue
la même opération pour l'appareil qui se déconnecte. Un jeton d'accès émis avant cette version
ne mentionne aucune session ; il reste fonctionnel jusqu'à son expiration, dans l'heure qui suit.

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
//   magicLink: boolean, emailOtp?: boolean,
//   anonymousLogin: boolean, enabledProviders: string[],
//   externalLoginUrl?: string, needsSetup?: boolean, storage?: boolean
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

## Utiliser votre propre fournisseur d'authentification

En version 0.24, un
accesseur de jeton authentifie uniquement les requêtes HTTP, et le socket temps réel reste
anonyme.

Lorsque les utilisateurs se connectent avec un fournisseur propre à votre architecture (Clerk, Firebase Auth ou une
session existante de votre application), `client.auth` n'intervient pas. Transmettez plutôt au client une
fonction d'accès (getter) pour obtenir le jeton du fournisseur. Elle est sollicitée chaque fois qu'un jeton est
nécessaire : pour chaque requête HTTP, et à chaque authentification du socket
temps réel.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));

// Optional: let Clerk recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await clerk.session?.reload();
    return true;
});

// The socket authenticates as the Clerk user.
client.data.posts.listen({}, (response) => render(response.data));
```

- Le getter prévaut sur la session propre au client. S'il renvoie `null` ou
  génère une exception, le client transmet le jeton qu'il possède, le cas échéant : celui de sa session, un jeton défini
  avec `client.setToken()` ou l'option `token`.
- L'option `token` est lue chaque fois qu'un jeton est requis, jusqu'à ce que `setToken()` ou
  une connexion la remplace ; elle peut donc être déclarée sous forme d'accesseur
  (`get token() { return currentToken; }`).
- `setOnUnauthorized` gère les codes 401 sur HTTP ainsi que les erreurs d'authentification sur le socket,
  et remplace le rafraîchissement de session natif du client.

Le backend doit vérifier le jeton du fournisseur : voir
[Adaptateurs d'authentification personnalisés](/docs/backend/auth-adapters). Dans le panneau d'administration, configurez
le getter sur le client que vous passez à `<Rebase client>`
([Votre propre fournisseur d'authentification](/docs/frontend/authentication#your-own-auth-provider)).

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
    pendingEmail?: string | null; // an address change waiting for its link
    roles?: string[];          // text[] from the users table
    metadata?: Record<string, unknown>;
}
```

## Prochaines étapes

- **[Interroger les données](/docs/sdk/querying)** — Opérations CRUD et constructeur de requêtes
- **[Abonnements temps réel](/docs/sdk/realtime)** — Données en direct avec les WebSockets
- **[Backend d'authentification](/docs/backend/authentication)** — Configuration de l'authentification côté serveur
