---
sourceHash: 3b130367f73c18c5
title: Endpoints d'authentification et jetons
sidebar_label: Endpoints d'authentification
description: Les routes d'authentification montées par le backend Rebase, le format de leurs réponses, l'authentification multifacteur, le contexte de base de données vu par une politique, JWKS et clés de service.
---

Les routes montées par [le bloc `auth`](/docs/backend/authentication/), et les jetons qu'elles renvoient.

## Endpoints d'authentification

Tous les endpoints d'authentification sont montés sur `/api/auth/` :

| Méthode | Chemin | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Créer un nouveau compte |
| `POST` | `/api/auth/login` | Connexion avec e-mail/mot de passe |
| `POST` | `/api/auth/refresh` | Rafraîchir le jeton d'accès |
| `POST` | `/api/auth/<provider>` | Connexion OAuth (ex. : `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Lier un fournisseur OAuth au compte authentifié |
| `POST` | `/api/auth/logout` | Révoquer le jeton de rafraîchissement |
| `POST` | `/api/auth/forgot-password` | Envoyer un e-mail de réinitialisation de mot de passe |
| `POST` | `/api/auth/reset-password` | Réinitialiser le mot de passe avec un jeton |
| `POST` | `/api/auth/find-user` | Résoudre une adresse e-mail en un profil public minimal (activation facultative — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Modifier le mot de passe de l'appelant (authentifié) |
| `GET` | `/api/auth/me` | Le profil de l'appelant |
| `PATCH` | `/api/auth/me` | Mettre à jour le profil de l'appelant |
| `GET` | `/api/auth/config` | Ce que ce backend propose à un écran de connexion — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders`. Non authentifié et calculé à partir des mêmes prédicats que ceux appliqués par les routes, de sorte que ce que l'écran affiche ne peut pas dévier de ce qu'il peut faire |
| `POST` | `/api/auth/send-verification` | Envoyer à l'appelant un lien de vérification d'e-mail |
| `GET` | `/api/auth/verify-email` | Valider un lien de vérification (l'URL présente dans cet e-mail) |
| `POST` | `/api/auth/magic-link` | Envoyer par e-mail un lien de connexion à usage unique. `503 EMAIL_NOT_CONFIGURED` sans SMTP |
| `POST` | `/api/auth/magic-link/verify` | Échanger un jeton de magic link contre une session |
| `POST` | `/api/auth/otp` | Envoyer par e-mail un code de connexion à six chiffres. Répond de la même manière que l'adresse possède un compte ou non |
| `POST` | `/api/auth/otp/verify` | Échanger `{ email, code }` contre une session |
| `POST` | `/api/auth/anonymous` | Créer une session anonyme (activation facultative — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Associer des identifiants réels au compte anonyme déjà connecté |
| `GET` | `/api/auth/sessions` | Lister les sessions actives de l'appelant (jetons de rafraîchissement) |
| `DELETE` | `/api/auth/sessions` | Révoquer toutes les sessions, y compris celle-ci — déconnexion à distance sur chaque appareil |
| `DELETE` | `/api/auth/sessions/:id` | Révoquer une session |
| `GET` | `/.well-known/jwks.json` | Le JWKS public — monté à la racine, et non sous `basePath`, car c'est là qu'un vérificateur regarde. Présent lorsque la [signature asymétrique](#asymmetric-tokens-and-jwks) est configurée |
| `POST` | `/api/auth/mfa/enroll` | Démarrer l'enrôlement TOTP (renvoie le secret et les codes de récupération) |
| `POST` | `/api/auth/mfa/verify` | Confirmer un enrôlement avec un code provenant de l'application d'authentification |
| `GET` | `/api/auth/mfa/factors` | Lister les facteurs enregistrés de l'appelant |
| `POST` | `/api/auth/mfa/challenge` | Initier un challenge pour un facteur vérifié |
| `POST` | `/api/auth/mfa/challenge/verify` | Répondre à un challenge — c'est ce qui émet la session |
| `DELETE` | `/api/auth/mfa/unenroll` | Supprimer un facteur (nécessite une session `aal2`) |

La gestion administrative des utilisateurs et des rôles est une **surface distincte**, montée sur
`/api/admin/` plutôt que sur `/api/auth/`, et restreinte au rôle `admin` ou à
la clé de service :

| Méthode | Chemin | Description |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Lister les utilisateurs (paginé) |
| `POST` | `/api/admin/users` | Créer un utilisateur |
| `GET` | `/api/admin/users/:uid` | Obtenir un utilisateur |
| `PUT` | `/api/admin/users/:uid` | Mettre à jour un utilisateur |
| `DELETE` | `/api/admin/users/:uid` | Supprimer un utilisateur |
| `POST` | `/api/admin/users/:uid/reset-password` | Réinitialiser le mot de passe d'un utilisateur sans son mot de passe actuel |
| `GET` | `/api/admin/roles` | Lister les rôles connus de ce backend |
| `POST` | `/api/admin/bootstrap` | Permettre au premier utilisateur inscrit de revendiquer le rôle admin tant qu'aucun n'existe. Refusé en production — voir [Amorçage du premier utilisateur](/docs/backend/authentication/#first-user-bootstrap) |

Tous les endpoints de l'API de données nécessitent un en-tête `Authorization: Bearer <token>` valide lorsque `requireAuth: true` (valeur par défaut).

### Format de réponse

Chaque endpoint qui émet une session répond avec la même enveloppe — `register`,
`login`, chaque fournisseur OAuth, `magic-link/verify`, `otp/verify`, `anonymous`,
`anonymous/link` et `mfa/challenge/verify` :

```json
{
  "user": {
    "uid": "8f1c2a6e-…",
    "email": "jane@example.com",
    "displayName": "Jane Doe",
    "photoURL": null,
    "providerId": "password",
    "isAnonymous": false,
    "emailVerified": true,
    "roles": ["editor"],
    "metadata": {}
  },
  "tokens": {
    "accessToken": "eyJhbGciOi…",
    "refreshToken": "9b2e…",
    "accessTokenExpiresAt": 1700000000000
  }
}
```

Renvoyez le jeton d'accès sous la forme `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` correspond aux millisecondes de l'époque Unix (epoch).

`POST /api/auth/refresh` répond avec la même enveloppe, avec deux nuances : `user`
est totalement omis lorsque le compte ne peut pas être relu, considérez-le donc comme facultatif
ici, et `providerId` vaut toujours `password`, quelle que soit la façon dont la session
a été créée initialement.

:::caution[Le SDK client aplatit cette enveloppe — le protocole HTTP brut ne le fait pas]
Le JSON ci-dessus est le format réseau, et c'est ce que renvoie `fetch("/api/auth/login")` :
le jeton se trouve dans **`body.tokens.accessToken`**.

Le [SDK client](/docs/sdk/authentication) déballe `tokens` avant de restituer la
session, de sorte que `auth.signInWithEmail()` se résout plutôt en un objet aplati
**`{ user, accessToken, refreshToken }`**.

Les deux structures existent réellement ; elles appartiennent à deux couches différentes.
Tenter de lire la structure du SDK à partir d'un simple `fetch` renvoie `undefined`, ce
qui se traduit par « connexion réussie mais il n'y a pas de jeton d'accès » — la connexion a bien
fonctionné, mais le jeton se trouvait un niveau plus bas.
:::

Lorsque [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) est activé, le jeton
de rafraîchissement transite dans un cookie `httpOnly` et `tokens.refreshToken` est une chaîne
vide dans le corps de la réponse. Le jeton d'accès n'est pas affecté.

### Authentification multifacteur (TOTP)

**Un deuxième facteur conditionne la connexion, et pas seulement des opérations individuelles.** Dès qu'un
compte dispose d'un facteur TOTP *vérifié*, aucune route ne lui délivre de session tant qu'un
code n'a pas été fourni — la connexion par mot de passe, chaque fournisseur OAuth, le lien magique et
anonymous-link refusent tous avec une erreur `401 MFA_REQUIRED` :

```json
{
  "error": {
    "code": "MFA_REQUIRED",
    "message": "Multi-factor authentication is required to complete sign-in.",
    "details": {
      "mfaToken": "<short-lived pre-auth token>",
      "factors": [{ "id": "…", "factorType": "totp", "friendlyName": "Phone" }]
    }
  }
}
```

`mfaToken` n'est **pas une session** : il est restreint à cet usage spécifique, expire au bout de cinq minutes
et est rejeté par toutes les routes authentifiées. Envoyez-le en tant que jeton porteur (bearer token) à
`POST /api/auth/mfa/challenge` (avec un `factorId`), puis à
`POST /api/auth/mfa/challenge/verify` (avec le `challengeId` et le code à six chiffres,
ou un code de récupération). C'est ce dernier appel qui génère les jetons d'accès et de rafraîchissement,
au niveau `aal2` ; ce niveau est stocké dans la session et conservé lors d'un
`POST /api/auth/refresh`.

L'enrôlement est également restreint. Le premier facteur d'un compte peut être enrôlé à partir d'une
session ordinaire, mais dès lors qu'un facteur est vérifié, `enroll`, `verify` et `unenroll`
requièrent tous une session `aal2` — sinon, un mot de passe volé permettrait d'enrôler un
nouveau facteur, d'élever les privilèges avec celui-ci et de supprimer le véritable facteur.

La vérification est limitée sur deux axes : un challenge expire après cinq tentatives infructueuses,
chaque compte est limité à dix tentatives de vérification par tranche de 15 minutes
(comptabilisées par utilisateur, donc changer d'adresse IP n'aide pas), et un code accepté est
enregistré pour ce facteur afin qu'il ne puisse pas être rejoué durant le reste de sa fenêtre de validité
de ±1 intervalle (step).

Définissez `MFA_ENCRYPTION_KEY` (au moins 32 caractères aléatoires) pour chiffrer les secrets TOTP
stockés. Sans cela, le serveur se rabat sur `JWT_SECRET` et émet un avertissement. Définissez-la
**avant** que quiconque ne s'enrôle : les secrets stockés ne comportent pas d'identifiant de clé, donc modifier
la clé ultérieurement rendra les facteurs existants indéchiffrables et empêchera leurs propriétaires de
valider un challenge.

### Inviter des membres d'équipe par e-mail

Les flux d'invitation doivent convertir une adresse e-mail en identifiant utilisateur, mais la collection
`users` est protégée par RLS vis-à-vis du client. Au lieu de développer manuellement une fonction
serveur d'administration, activez la recherche intégrée :

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // enables POST /api/auth/find-user
    },
});
```

Ensuite, depuis le client :

```typescript
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, user_id: profile.uid });
}
```

Cet endpoint est **réservé aux utilisateurs authentifiés** et ne renvoie que `uid`, `displayName`
et `photoURL` — jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur recherché. Il
est **désactivé par défaut** car il permet à tout utilisateur connecté de sonder quelles adresses e-mail
possèdent un compte ; ne l'activez que si votre expérience d'invitation le nécessite.

## Contexte de base de données Row-Level Security (RLS)

Rebase transmet directement l'authentification de la requête à la sécurité au niveau des lignes (Row-Level Security ou RLS) de PostgreSQL. Chaque requête de base de données exécutée via un pilote lié à l'utilisateur s'exécute au sein d'une transaction de base de données (`db.transaction()`) qui configure des paramètres locaux à la transaction :

*   `app.user_id` — L'identifiant unique (`uid`) de l'utilisateur authentifié. Vaut `'anon'` par défaut pour les requêtes non authentifiées.
*   `app.user_roles` — Une chaîne de caractères séparée par des virgules listant les rôles attribués à l'utilisateur.
*   `app.jwt` — Une chaîne JSON contenant l'intégralité du payload des revendications (claims) du JWT (`{"sub": "<uid>", "roles": [...]}`).

Ces paramètres sont configurés localement pour la durée de la transaction à l'aide de la fonction `set_config` de Postgres :
```sql
SELECT 
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.jwt', $3, true);
```

### Fonctions d'aide pour les politiques PostgreSQL

Pour simplifier l'écriture des politiques Row-Level Security, Rebase crée des fonctions d'aide sous le schéma `auth` lors de l'initialisation (bootstrapping) de la base de données :

*   **`rebase.uid()`** — Renvoie l'identifiant de l'utilisateur authentifié sous forme de `text`, ou `NULL` s'il n'est pas défini :
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Renvoie la chaîne des rôles séparés par des virgules :
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Renvoie le payload JWT complet sous la forme d'un objet `jsonb` :
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```

Vous pouvez utiliser ces fonctions d'aide directement dans vos règles de sécurité personnalisées ou vos migrations de base de données :
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Jetons asymétriques et JWKS

Par défaut, les jetons d'accès sont signés avec `jwtSecret` (HS256). Cela fonctionne, mais cela
signifie que tout service devant *vérifier* un jeton doit détenir la clé qui permet d'en *créer*
un — ainsi, une passerelle ou un edge worker vérifiant une session peut également en falsifier une — et
modifier le secret déconnecte tous les utilisateurs d'un coup.

Configurez une clé de signature et Rebase signera les jetons d'accès de manière asymétrique,
publiant la partie publique sur **`/.well-known/jwks.json`** pour que n'importe qui puisse effectuer
la vérification :

```typescript no-verify
auth: {
    jwtSecret: process.env.JWT_SECRET,
    signingKeys: [
        { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY! }
    ]
}
```

Ou depuis l'environnement, pour une clé unique :

```bash
JWT_PRIVATE_KEY="$(cat jwt-key.pem)"
JWT_KEY_ID=2026-08
```

Générez une clé avec :

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

Les clés RSA fonctionnent également et signent en `RS256` ; les clés EC P-256 signent en `ES256`. Seule la clé privée
est configurée — la partie publique en est dérivée, ce qui empêche toute discordance de paire.
`jwtSecret` reste requis dans tous les cas : il signe toujours les jetons à usage restreint
(liens de téléchargement, MFA en attente, réinitialisation de mot de passe) que seul ce serveur lit.

### Effectuer une rotation de clé

Placez la nouvelle clé en premier et conservez l'ancienne dans la liste. Les nouveaux jetons sont signés par
la nouvelle clé ; les jetons déjà en circulation continuent d'être vérifiés avec l'ancienne jusqu'à ce
qu'ils expirent, afin que personne ne soit déconnecté.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Une fois la durée de vie la plus longue d'un jeton d'accès écoulée, supprimez l'ancienne entrée. Utilisez
`activeKid` si vous souhaitez publier une clé avant de commencer à signer avec celle-ci.

### Vérification ailleurs

Les jetons portent le `kid` de la clé de signature dans leur en-tête, ce qui permet à un vérificateur
de choisir la bonne clé dans le JWKS et de savoir quand récupérer à nouveau le jeu de clés après une
rotation. Toute bibliothèque standard prend cela en charge — par exemple avec `jose` :

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Si aucun `signingKeys` n'est configuré, `/.well-known/jwks.json` répond
`{"keys":[]}` et les jetons restent en HS256. Rien ne change tant que vous n'ajoutez pas de clé.
:::

## Authentification par clé de service

Pour les communications de serveur à serveur (ex. : tâches cron, services externes), configurez une clé de service statique :

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Les clients s'authentifient avec l'en-tête `Authorization: Bearer <service-key>`. 

### Clé interne par démarrage (per-boot)

Si `REBASE_SERVICE_KEY` n'est pas fournie dans votre configuration, Rebase génère automatiquement une **clé interne aléatoire à chaque démarrage**. 

Cette clé n'est jamais consignée dans les logs et ne quitte jamais le processus. Elle est utilisée par le singleton `rebase` pour s'authentifier auprès des API du plan de contrôle internes au serveur (auth, stockage, etc.). Cela garantit que les tâches administratives (comme l'envoi d'un e-mail de bienvenue ou la génération d'une URL de stockage) fonctionnent toujours telles quelles en développement et en production, sans nécessiter de gestion manuelle des clés.

### Protection contre les attaques temporelles et exigences pour les clés

Pour prévenir les attaques temporelles (timing attacks), Rebase valide la clé de service configurée par l'utilisateur ainsi que la clé interne en utilisant une comparaison de chaînes à temps constant (`safeCompare`). La clé de service configurée par l'utilisateur **doit comporter au moins 32 caractères** ; si une clé de moins de 32 caractères est configurée, Rebase lèvera une erreur de configuration au démarrage et refusera de se lancer (fail-closed).

## Prochaines étapes

- **[Authentication](/docs/backend/authentication/)** — la configuration dont sont issues ces routes
- **[Adaptateurs d'authentification personnalisés](/docs/backend/auth-adapters/)** — remplacer le fournisseur sous-jacent
- **[Règles de sécurité (RLS)](/docs/collections/security-rules/)** — ce qu'une politique fait avec `rebase.uid()`
- **[Authentification avec le SDK client](/docs/sdk/authentication/)** — appeler ces routes depuis le SDK

---
