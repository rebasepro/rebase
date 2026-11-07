---
sourceHash: 468b0d48039a8127
title: Authentification
sidebar_label: Authentification
description: Authentification côté client avec le SDK Rebase — connexion par e-mail/mot de passe, fournisseurs OAuth, gestion de session et écouteurs d'état d'authentification.
---

## Aperçu

Le module `client.auth` gère l'authentification des utilisateurs, la gestion des jetons et la persistance des sessions. Dès qu'un utilisateur se connecte, toutes les requêtes de données ultérieures incluent automatiquement le JWT.

Le SDK persiste les sessions dans `localStorage` par défaut et actualise automatiquement les jetons avant leur expiration.

:::note[Chaque méthode de connexion renvoie une session aplatie]
`signInWithEmail`, `signUp` et chaque méthode `signInWith*` retournent **`{ user, accessToken, refreshToken }`** — le SDK a déjà extrait l'enveloppe pour vous.

L'API REST sous-jacente retourne quant à elle le jeton imbriqué, sous la forme `{ user, tokens: { accessToken, … } }`. Cette différence n'importe que si vous appelez également `/api/auth/*` directement avec `fetch`, où `body.accessToken` est `undefined` et le jeton se trouve à `body.tokens.accessToken`. Consultez [le format réseau](/docs/backend/auth-endpoints/#response-format).
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
const { user, confirmationRequired } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

Lorsque [`requireEmailVerification`](/docs/backend/email-verification/) est activé, il n'y a pas de session tant que l'adresse n'est pas confirmée : `confirmationRequired` vaut `true` et `user` vaut `null`, invitez donc l'utilisateur à ouvrir son e-mail. Sinon, `confirmationRequired` vaut `false` et `user` correspond au compte connecté. En 0.23, `signUp` résout `{ user, accessToken, refreshToken }` et connecte systématiquement l'utilisateur.

## Fournisseurs OAuth

Le SDK comprend des méthodes dédiées pour les fournisseurs OAuth courants, ainsi qu'une méthode générique `signInWithOAuth()` pour tout fournisseur personnalisé.

### Google

Prend en charge trois modes d'invocation :

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

Twitter requiert également le vérificateur de code PKCE :

```typescript
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
```

### Apple

Dans un navigateur, `signInWithApplePopup()` ouvre la popup d'Apple, vérifie l'état `state` et se connecte avec le code. Appelez-le depuis un gestionnaire de clic. Appelez `preloadAppleSignIn()` au montage, car Safari bloque une popup qui attend le téléchargement d'un script :

```typescript
import { preloadAppleSignIn } from "@rebasepro/client";

void preloadAppleSignIn();                                          // on mount
await client.auth.signInWithApplePopup({ clientId: "com.example.web" }); // on click
```

Sans `clientId`, le SDK lit le Services ID depuis `/auth/config`, ce qui retarde l'affichage de la popup. L'URI de redirection utilise par défaut l'origine de la page suivie de `/`, et doit être une URL de retour (Return URL) sur le Services ID (HTTPS, jamais `localhost`). Une popup fermée rejette la promesse avec le code `APPLE_SIGN_IN_CANCELLED`.

Une application native iOS ou macOS envoie le code d'autorisation issu de la connexion native Apple avec son bundle ID. Le bundle ID doit être listé dans `APPLE_BUNDLE_IDS` :

```typescript
await client.auth.signInWithApple({
    code: credential.authorizationCode,
    bundleId: "com.example.ios",
    user: { name: { firstName: "Jane" } } // sent by Apple on the first sign-in only
});
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

Un lien de connexion en un clic envoyé par e-mail. Le lien est toujours `<base>/auth/magic-link?token=…`, où `<base>` est le `email.magicLinkUrl` du backend, ou sa base de réinitialisation de mot de passe (`FRONTEND_URL` sur le runtime) lorsqu'elle n'est pas définie. Il n'y a pas de `redirectTo` par requête. Servez ce chemin sur votre frontend et transmettez le jeton en retour pour l'échanger contre une session. Le CMS le prend en charge, effectuant la connexion (en passant par l'étape du code en présence d'un deuxième facteur) ; les autres frontends nécessitent une page de destination (landing page).

```typescript
// 1. Ask for the link.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` renvoie la même réponse que l'adresse possède un compte ou non. C'est délibéré : un endpoint qui répondrait « aucun utilisateur trouvé » constituerait un oracle d'énumération de comptes ; n'utilisez donc pas le résultat pour indiquer à quelqu'un s'il est inscrit — il ne le sait pas.

L'envoi nécessite la configuration d'un service d'e-mail sur le backend, sans quoi `sendMagicLink` répond 503 `EMAIL_NOT_CONFIGURED`.

## Codes à usage unique

Un code à six chiffres envoyé par e-mail, pour les cas où un lien n'est pas pratique — une application native, un second appareil, un navigateur qui altère les liens.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

L'envoi de l'adresse avec le code permet de limiter la tentative de deviner le code à six chiffres à *un seul* compte plutôt qu'à l'ensemble des comptes simultanément.

## Sessions anonymes

Connectez un visiteur sans aucun identifiant, afin qu'il puisse commencer à utiliser l'application avant même d'avoir une raison de s'inscrire :

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

Le compte est bien réel : il possède un identifiant, des rôles et une session, de sorte que la sécurité au niveau des lignes (row-level security) applique ses filtres exactement comme pour un utilisateur inscrit. Ce qu'il n'a pas, c'est un moyen de revenir — personne ne peut se reconnecter *en tant que* ce compte une seconde fois, donc tout ce qu'il possède est perdu avec la session.

`linkAnonymous` permet de le rendre pérenne. L'utilisateur **conserve son identifiant**, de sorte que tout ce qu'il a créé de manière anonyme lui reste rattaché :

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Erreur | Signification |
|---------|-------|
| `ANONYMOUS_AUTH_DISABLED` (403) | Le backend n'a pas activé l'authentification anonyme, ou l'a désactivée depuis la connexion de cet invité : un invité ne peut devenir un compte que lorsque `allowAnonymous` est activé |
| `REGISTRATION_DISABLED` (403) | Les inscriptions sont fermées sur le backend, or la transformation en compte constitue une inscription |
| `NOT_ANONYMOUS` (400) | La session actuelle appartient à un compte ordinaire |
| `EMAIL_EXISTS` (409) | L'adresse possède déjà un compte — connectez-vous plutôt à celui-ci |

Un invité qui ne revient jamais reste sous forme de ligne dans la base. Un administrateur peut le nettoyer avec `client.admin.listGuests()`, `client.admin.deleteGuest(uid)` et `client.admin.deleteGuests({ lastSeenBefore })`, ou sur Rebase Cloud avec [`rebase cloud guests`](/docs/cli/cloud/#guests). Celles-ci ne touchent jamais qu'aux invités, et `deleteGuests` fonctionne par lots : répétez l'opération tant que `remaining` n'est pas 0, avec `offset` défini sur le nombre d'éléments ignorés jusqu'alors.

## Lier un fournisseur à un compte existant

`signInWithGoogle` et consorts *connectent* un utilisateur. `linkProvider` rattache l'identité d'un fournisseur au compte déjà connecté, permettant à la même personne de revenir par l'un ou l'autre moyen :

```typescript
await client.auth.linkProvider("google", { idToken });
```

La session prouve déjà la propriété du compte ; contrairement à la connexion, il n'est donc pas nécessaire que le fournisseur ait vérifié l'e-mail, et les deux adresses n'ont pas besoin de correspondre. L'opération réussit de manière idempotente (`alreadyLinked: true`) si cette identité est déjà associée à ce compte, et échoue avec `IDENTITY_ALREADY_LINKED` (409) si elle appartient à un autre compte.

## Rechercher un utilisateur par e-mail

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Trois champs non sensibles et rien d'autre — suffisant pour afficher « vous invitez Jane » avant l'envoi d'une invitation. Optionnel (opt-in) : réservé à un appelant connecté, et renvoie une 404 sauf si le backend définit `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Authentification multifacteur

Enrôlement d'un facteur, deuxième étape de connexion, codes de récupération et suppression d'un facteur : [Authentification multifacteur](/docs/sdk/multi-factor-authentication/).

## Déconnexion

```typescript
await client.auth.signOut();
```

Cela révoque le jeton d'actualisation sur le serveur, efface la session locale et émet un événement `SIGNED_OUT`.

## Gestion de session

### Obtenir la session actuelle

```typescript
const session = client.auth.getSession();
// { accessToken, refreshToken, expiresAt, user } | null
```

**Ne conservez jamais l'objet de session.** `getSession()` est un instantané. Chaque renouvellement du jeton d'accès, environ une fois par heure, remplace la session par un nouvel objet ; ainsi, une session conservée depuis le chargement de la page contiendra un jeton que le serveur refusera une fois expiré, et l'application apparaîtra déconnectée. Lisez la session au moment où vous en avez besoin.

### Envoyer le jeton à vos propres routes

L'appel d'une fonction dans `backend/functions/` ne nécessite aucune gestion de jeton : `client.functions.invoke` renouvelle le jeton avant l'envoi et réessaie une fois en cas d'erreur 401.

```typescript
const saved = await client.functions.invoke("progress", { level: 3 }, { path: "save" });
```

Pour toute autre requête, demandez le jeton à chaque fois avec `getAccessToken()`. Elle renouvelle un jeton expiré ou sur le point de l'être, attend la restauration de la session au chargement, et retourne `null` si personne n'est connecté.

```typescript
const token = await client.auth.getAccessToken();
await fetch("https://other.example.com/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: file
});
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

L'actualisation du jeton se fait automatiquement, mais vous pouvez la déclencher manuellement :

```typescript
const session = await client.auth.refreshSession();
```

Une requête ne part jamais avec un jeton que le client sait expiré : les requêtes partagent une seule actualisation et sont envoyées une fois munies du nouveau jeton. Un jeton que le serveur refuse prématurément bénéficie tout de même d'une actualisation, puis d'une nouvelle tentative par requête.

## Emplacement de la session : `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Mode | Emplacement du jeton d'actualisation | Valeur par défaut |
|------|----------------------------|---------|
| `"cookie"` | Un cookie **HttpOnly** défini par le backend. Les scripts exécutés sur votre page ne peuvent pas le lire, ce qui le protège contre les attaques XSS | Dans un navigateur |
| `"json"` | Renvoyé dans le corps de la réponse, conservé dans `storage` (`localStorage` par défaut) | Hors navigateur (Node, workers, React Native), et dans un navigateur si vous passez votre propre `storage` |

Le mode cookie nécessite `auth.cookieAuth` sur le backend, ce que le runtime Rebase, et donc Rebase Cloud, active systématiquement. Le mode JSON fonctionne avec les deux : ses requêtes d'authentification comportent l'en-tête `x-rebase-auth-flow: json`, et le backend y répond en incluant le jeton d'actualisation dans le corps. Un backend plus ancien ne transmet aucun jeton d'actualisation à un client JSON, de sorte que sa session se termine environ une heure après la connexion, et le client consigne dans les logs le mode à utiliser (sauf s'il a transmis son propre `storage`).

Passer votre propre `storage` maintient un client navigateur en mode JSON, ce qui est utile pour un second client conservant sa propre connexion indépendamment du cookie de la page, comme un invité aux côtés du compte connecté. Son jeton d'actualisation réside dans ce stockage, où les scripts de la page peuvent le lire ; veillez donc à conserver le compte principal de la page en mode cookie.

## Attendre la restauration de la session

**Une session restaurée n'est pas disponible au premier rendu.** `getSession()` est synchrone ; au chargement de la page, elle renvoie donc `null` pendant que la restauration est en cours — et en mode cookie, une restauration est *toujours* en cours, car le jeton d'actualisation se trouve dans un cookie illisible par la page, obligeant le client à demander un nouveau jeton d'accès au serveur.

La lire de manière synchrone produit un flash de déconnexion à chaque rechargement :

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

`useRebaseAuthController` dans `@rebasepro/app` fait déjà cela, de sorte qu'une application basée sur le modèle généré en bénéficie automatiquement. Les requêtes de données n'ont pas besoin d'attendre : une requête effectuée en cours de restauration est envoyée dès que celle-ci se termine — sous l'identité de l'utilisateur restauré, ou de manière anonyme — évitant ainsi qu'un premier rendu n'affiche un listing public au lieu de celui propre à l'utilisateur.

Une restauration qui déclenche une actualisation (jeton stocké expiré ou mode cookie) parvient à `onAuthStateChange` en tant que `TOKEN_REFRESHED` ; un jeton stocké encore valide est adopté silencieusement. Un écouteur ne peut donc pas vous indiquer que la restauration est terminée : un démarrage qui n'émet rien ne se distingue pas d'un démarrage toujours en cours. Attendez `isInitialized()` pour obtenir cette confirmation et utilisez l'écouteur pour les changements ultérieurs.

`restoreOutcome()` indique l'issue de la restauration une fois `isInitialized()` résolu : `"restored"`, `"none"` (rien à restaurer), `"refused"` (le serveur a rejeté la session) ou `"unreachable"` (le serveur n'a pas pu être joint, la session n'a donc été ni confirmée ni rejetée). En mode cookie, `"unreachable"` sans session constitue l'unique cas où l'état « déconnecté » n'est pas garanti comme avéré :

```typescript
await client.auth.isInitialized();
if (!client.auth.getSession() && client.auth.restoreOutcome() === "unreachable") {
    console.log("Offline: could not check the session.");
}
```

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

| Événement | Déclenchement |
|-------|------|
| `SIGNED_IN` | Une connexion ou une inscription est terminée |
| `TOKEN_REFRESHED` | Le jeton d'accès a été renouvelé — y compris le renouvellement silencieux restaurant une session au chargement de la page |
| `USER_UPDATED` | `updateUser()` a modifié le profil, `linkAnonymous()` a converti un invité en compte, `changeEmail()` a initié un changement d'adresse, ou `confirmEmailChange()` a transféré ce compte vers sa nouvelle adresse |
| `SIGNED_OUT` | Une déconnexion, `revokeAllSessions()` ou une actualisation ayant définitivement échoué |

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

### Modifier le mot de passe (authentifié)

```typescript
const { success, message } = await client.auth.changePassword(
    "oldPassword",
    "newPassword"
);
```

Toutes les autres sessions du compte prennent fin : toute autre personne en détenant une devra se reconnecter avec le nouveau mot de passe. Cet appareil reste connecté. Le serveur répond avec une nouvelle session que le client adopte (en émettant `TOKEN_REFRESHED`).

## Vérification de l'e-mail

L'inscription envoie par e-mail le lien de vérification au nouveau compte lorsque le service d'e-mail est configuré. `sendVerificationEmail()` l'envoie à nouveau.

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

Le lien prouve l'accès à la boîte de réception, mais pas qui a enregistré l'adresse ; ainsi, un mot de passe que ni la session ni l'appel ne prouvent est supprimé plutôt que conservé — consultez [Vérification de l'e-mail](/docs/backend/email-verification/).

Sur un backend configuré avec `requireEmailVerification`, `signUp()` résout `{ confirmationRequired: true, user: null }` sans session : le compte se connecte une fois que le lien est ouvert avec son mot de passe.

## Changer d'adresse e-mail

Un utilisateur connecté transfère son propre compte vers une autre adresse. Rien ne change tant que la nouvelle adresse n'a pas répondu :

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

Le lien est valable 24 heures ; `getUser()` indique l'adresse en attente sous `pendingEmail`. La confirmation ne nécessite aucune session, et un client connecté sous ce compte adopte la nouvelle adresse et émet `USER_UPDATED`. Les motifs de refus sont listés dans [Changer d'adresse e-mail](/docs/backend/auth-endpoints/#changing-an-email-address).

## Gestion de session (multi-appareils)

```typescript
// List all active sessions, one per sign-in
const sessions = await client.auth.getSessions();
// [{ id, userAgent, ipAddress, createdAt, isCurrentSession }, …]

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

Chaque jeton d'accès mentionne la connexion à laquelle il appartient, de sorte qu'exactement une entrée a `isCurrentSession: true` : l'appareil qui en fait la demande. Révoquer une session met fin simultanément au jeton d'actualisation et au jeton d'accès de cet appareil, dès la requête suivante, par HTTP et via un socket temps réel ouvert. La déconnexion (`signOut()`) fait de même pour l'appareil qui se déconnecte. Un jeton d'accès émis avant cette version ne mentionne aucune session ; il continue de fonctionner jusqu'à son expiration, dans l'heure qui suit.

## Configuration d'authentification

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
//   providerClientIds?: Record<string, string>,   // public ids, e.g. { apple: Services ID }
//   externalLoginUrl?: string, needsSetup?: boolean, storage?: boolean
// }
```

## Stockage de session personnalisé

Par défaut, les sessions sont stockées dans `localStorage`. Vous pouvez personnaliser cela avec l'option `auth` :

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

Clerk, Firebase Auth ou une session que votre application possède déjà, avec un récupérateur de jeton à la place de `client.auth` : [Votre propre fournisseur d'authentification](/docs/sdk/your-own-auth-provider/).

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

- **[Interroger des données](/docs/sdk/querying)** — Opérations CRUD et query builder
- **[Abonnements temps réel](/docs/sdk/realtime)** — Données en direct avec les WebSockets
- **[Backend d'authentification](/docs/backend/authentication)** — Configuration de l'authentification côté serveur
