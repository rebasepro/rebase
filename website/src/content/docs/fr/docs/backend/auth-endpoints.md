---
sourceHash: 51c0059da14c6fd7
title: Points de terminaison d'authentification et jetons
sidebar_label: Points de terminaison d'authentification
description: Les routes d'authentification montées par le backend Rebase, la structure de leurs réponses, l'authentification multifacteur, le contexte de base de données vu par une stratégie, le JWKS et les clés de service.
---

Les routes montées par [le bloc `auth`](/docs/backend/authentication/), et les jetons qu'elles renvoient.

## Points de terminaison d'authentification

Tous les points de terminaison d'authentification sont montés sur `/api/auth/` :

| Méthode | Chemin | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Créer un nouveau compte |
| `POST` | `/api/auth/login` | Se connecter avec e-mail/mot de passe |
| `POST` | `/api/auth/refresh` | Rafraîchir le jeton d'accès |
| `POST` | `/api/auth/<provider>` | Connexion OAuth (par ex., `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Associer un fournisseur OAuth au compte authentifié. Pour un invité, il s'agit d'une inscription : elle nécessite `allowRegistration`, prend l'adresse du fournisseur lorsque celui-ci la valide, et répond avec une session pour le compte que l'invité est devenu |
| `POST` | `/api/auth/logout` | Révoquer le jeton de rafraîchissement |
| `POST` | `/api/auth/forgot-password` | Envoyer un e-mail de réinitialisation de mot de passe |
| `POST` | `/api/auth/reset-password` | Réinitialiser le mot de passe avec un jeton |
| `POST` | `/api/auth/find-user` | Résoudre une adresse e-mail en un profil public minimal (optionnel — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Modifier le propre mot de passe de l'appelant (authentifié). Met fin à toutes les autres sessions et répond avec une nouvelle session pour l'appelant |
| `GET` | `/api/auth/me` | Le profil de l'appelant |
| `PATCH` | `/api/auth/me` | Mettre à jour le profil de l'appelant |
| `POST` | `/api/auth/change-email` | `{ newEmail }` : déplacer le compte de l'appelant vers une autre adresse. Envoie un lien à la nouvelle adresse et une notification à l'ancienne ; rien ne change tant que le lien n'a pas été suivi. Nécessite `aal2` sur un compte avec un second facteur. `409 EMAIL_EXISTS` ou `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` pour un invité — voir [Changer d'adresse e-mail](#changer-dadresse-e-mail) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` provenant du lien. Aucune session requise. Déplace le compte vers la nouvelle adresse, vérifiée ; `400 INVALID_TOKEN` pour un lien déjà utilisé, remplacé ou expiré, `409 EMAIL_EXISTS` lorsque l'adresse a été prise pendant l'attente |
| `GET` | `/api/auth/config` | Ce que ce backend propose à un écran de connexion — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders`, et `storage`, qui indique si le backend gère le stockage de fichiers. Non authentifié, et calculé à partir des mêmes prédicats appliqués par les routes, afin que ce que l'écran affiche ne puisse pas diverger de ce qu'il peut faire |
| `POST` | `/api/auth/send-verification` | Envoyer à l'appelant un lien de vérification d'e-mail |
| `GET` | `/api/auth/verify-email` | Consommer un lien de vérification (l'URL dans cet e-mail). Conserve ce qu'une session active du compte prouve et supprime ce que personne n'a prouvé — voir [Vérification d'e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | La même chose avec `{ token, password?, removeUnproven? }` : le mot de passe le conserve et connecte l'utilisateur ; sans aucune de ces preuves, un compte en détenant une répond `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Envoyer par e-mail un lien de connexion à usage unique. `503 EMAIL_NOT_CONFIGURED` sans SMTP |
| `POST` | `/api/auth/magic-link/verify` | Échanger un jeton de lien magique (magic link) contre une session |
| `POST` | `/api/auth/otp` | Envoyer par e-mail un code de connexion à six chiffres. Répond de la même manière que l'adresse possède un compte ou non |
| `POST` | `/api/auth/otp/verify` | Échanger `{ email, code }` contre une session |
| `POST` | `/api/auth/anonymous` | Créer une session anonyme (optionnel — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Associer de vrais identifiants au compte anonyme déjà connecté. Nécessite à la fois `allowAnonymous` et des inscriptions ouvertes : `403 ANONYMOUS_AUTH_DISABLED` une fois la connexion anonyme désactivée, y compris pour les invités connectés précédemment, et `403 REGISTRATION_DISABLED` tant que les inscriptions sont fermées |
| `GET` | `/api/auth/sessions` | Lister les sessions actives de l'appelant, une par connexion. Celle de l'appelant est marquée `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Révoquer toutes les sessions, y compris celle-ci — déconnexion à distance sur chaque appareil |
| `DELETE` | `/api/auth/sessions/:id` | Révoquer une session : son jeton de rafraîchissement, et le jeton d'accès détenu par cet appareil |
| `GET` | `/api/auth/scopes` | Chaque [portée (scope)](/docs/backend/roles-and-scopes/) connue de ce backend, et celles que détient l'appelant |
| `GET` | `/api/auth/keys` | Les [clés API personnelles](/docs/backend/api-keys/#personal-keys) propres à l'appelant |
| `POST` | `/api/auth/keys` | Créer une clé personnelle. `403 PERSONAL_KEYS_DISABLED` sauf si la table des utilisateurs définit `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Révoquer l'une des clés de l'appelant |
| `GET` | `/.well-known/jwks.json` | Le JWKS public — monté à la racine, pas sous `basePath`, car c'est là qu'un vérificateur regarde. Monté dès que le backend génère ses propres jetons ; un ensemble de clés vide jusqu'à ce que la [signature asymétrique](#jetons-asymétriques-et-jwks) soit configurée |
| `POST` | `/api/auth/mfa/enroll` | Démarrer l'enrôlement TOTP (renvoie le secret et les codes de récupération) |
| `POST` | `/api/auth/mfa/verify` | Confirmer un enrôlement avec un code provenant de l'application d'authentification |
| `GET` | `/api/auth/mfa/factors` | Lister les facteurs enregistrés de l'appelant |
| `POST` | `/api/auth/mfa/challenge` | Ouvrir un défi (challenge) pour un facteur vérifié |
| `POST` | `/api/auth/mfa/challenge/verify` | Répondre à un défi — c'est ce qui délivre la session |
| `DELETE` | `/api/auth/mfa/unenroll` | Supprimer un facteur (nécessite une session `aal2` dès lors que le compte dispose d'un facteur vérifié) |
| `POST` | `/api/auth/mfa/recovery-codes` | Remplacer les codes de récupération de l'appelant par dix nouveaux codes (nécessite une session `aal2`) |

La gestion administrative des utilisateurs et des rôles est une **surface distincte**, montée sur `/api/admin/` plutôt que sur `/api/auth/`. La lecture nécessite la portée `users:read` et la modification nécessite `users:write`, à l'exception de la lecture restreinte du sélecteur d'utilisateurs ci-dessous. Un administrateur et la clé de service détiennent les deux ; il en va de même pour un rôle qui les déclare. Nul ne peut modifier un compte qui possède plus de droits que lui-même. Voir [Rôles et portées](/docs/backend/roles-and-scopes/).

| Méthode | Chemin | Description |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Lister les utilisateurs (paginé). `?search=` fait correspondre une partie insensible à la casse de l'e-mail ou du nom d'affichage. Il recherche également n'importe quel rôle détenu par l'utilisateur, ainsi que l'uid |
| `GET` | `/api/admin/users/pick` | Lecture du sélecteur d'utilisateurs : `uid`, `displayName`, `email` et `photoURL` par utilisateur, rien d'autre. Accepte `?search=`, `?limit=` (25 par défaut) et `?offset=`, ou `?ids=a,b` pour les utilisateurs désignés par une valeur stockée. Répond à `users:read`, ainsi qu'à quiconque peut écrire dans une collection dotée d'un champ [`userSelect`](/docs/collections/properties/) — afin qu'un éditeur puisse en remplir un. Une règle écrite en SQL brut (`using` / `withCheck` que le modèle de stratégie ne peut pas lire) ne peut pas être évaluée à l'avance, elle est donc considérée comme un refus ici : sur une telle collection, seuls les détenteurs de `users:read` peuvent effectuer une sélection. Tous les autres reçoivent `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Créer un utilisateur |
| `GET` | `/api/admin/users/:uid` | Lire un utilisateur |
| `PUT` | `/api/admin/users/:uid` | Mettre à jour un utilisateur. `{ disabled: true }` désactive le compte sans le supprimer : chaque connexion et rafraîchissement est refusé (`ACCOUNT_DISABLED`), ses sessions prennent fin et chaque jeton qu'il détient est refusé ; `false` le réactive |
| `DELETE` | `/api/admin/users/:uid` | Supprimer un utilisateur. Ses sessions prennent fin, et chaque jeton d'accès qu'il détient est refusé à partir de cette requête |
| `POST` | `/api/admin/users/:uid/reset-password` | Réinitialiser le mot de passe d'un utilisateur sans son mot de passe actuel. `rebase auth reset-password` l'appelle, et n'écrit directement dans la base de données que lorsque le backend est inaccessible ; dans les deux cas, les sessions du compte prennent fin |
| `DELETE` | `/api/admin/users/:uid/mfa` | Supprimer les seconds facteurs et les codes de récupération d'un utilisateur, et mettre fin à ses sessions — pour quelqu'un qui a perdu les deux |
| `GET` | `/api/admin/roles` | `admin` et les rôles déclarés par la table des utilisateurs, avec leurs portées |
| `POST` | `/api/admin/bootstrap` | Permettre au premier utilisateur enregistré de revendiquer le rôle admin lorsqu'aucun n'existe. Refusé en production — voir [Amorçage du premier utilisateur](/docs/backend/authentication/#first-user-bootstrap) |

Tous les points de terminaison de l'API de données nécessitent un en-tête `Authorization: Bearer <token>` valide lorsque `requireAuth: true` (valeur par défaut).

### Politique de mot de passe

Un nouveau mot de passe nécessite au moins 8 caractères, avec une lettre majuscule, une lettre minuscule et un chiffre. L'inscription, la réinitialisation et le changement refusent un mot de passe non conforme avec `400 WEAK_PASSWORD`, en énumérant chaque règle enfreinte, tout comme un administrateur choisissant un mot de passe : `POST /api/admin/users`, une création sur la table des utilisateurs via l'API de données (`POST /api/data/users`, son `/bulk`, une écriture par socket ou MCP), `PUT /api/admin/users/:uid` et `POST /api/admin/users/:uid/reset-password`. Sur un `/bulk`, le message commence par `Row <n>: ` (compté à partir de 0), tout comme les autres erreurs de ligne du bulk.

Pour créer des comptes dont les mots de passe ont été définis par un autre système, comme lors d'un import, envoyez `skipPasswordPolicy: true` dans le corps de création (sur chaque ligne d'un `/bulk`). Le serveur ne l'honore que pour un administrateur ou la clé de service ; pour quiconque d'autre, il n'accorde aucune dispense et le refus le précise. Ce paramètre n'est jamais stocké. L'importation du panneau d'administration l'envoie pour chaque ligne contenant un `password`. La connexion ne vérifie jamais la politique, de sorte qu'un mot de passe plus ancien continue de fonctionner. Pour définir vos propres règles, transmettez `auth.hooks.validatePasswordStrength` depuis un backend [éjecté](/docs/backend/authentication/#configuration). Le premier administrateur initialisé à partir de `REBASE_ADMIN_PASSWORD` est soumis à une règle différente : au moins 12 caractères, et rien d'autre.

### Format de réponse

Chaque point de terminaison qui délivre une session répond avec la même enveloppe — `register`, `login`, chaque fournisseur OAuth, `magic-link/verify`, `otp/verify`, `anonymous`, `anonymous/link` et `mfa/challenge/verify` :

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

Renvoyez le jeton d'accès sous la forme `Authorization: Bearer <accessToken>`. `accessTokenExpiresAt` est exprimé en millisecondes epoch.

`POST /api/auth/refresh` répond avec la même enveloppe, sauf que `user` est entièrement omis lorsque le compte ne peut pas être relu, traitez-le donc comme facultatif ici.

`providerId` indique comment la session a été ouverte : `password`, `anonymous`, `magic-link`, `otp`, `mfa` (une connexion finalisée avec un second facteur), ou l'identifiant du fournisseur, tel que `google`. Il est stocké avec la session lors de la connexion, de sorte que `refresh` et `GET /api/auth/me` donnent la même réponse tant que la session est active. Une session connectée avant la version 0.24 indique `password`.

:::caution[Le SDK typé aplatit cette enveloppe — ce qui n'est pas le cas du HTTP brut]
Le JSON ci-dessus correspond au format réseau (wire format), et c'est ce que renvoie `fetch("/api/auth/login")` : le jeton se trouve sous **`body.tokens.accessToken`**.

Le [SDK typé](/docs/sdk/authentication) déballe `tokens` avant de renvoyer la session, de sorte que `auth.signInWithEmail()` se résout plutôt sous une forme aplatie **`{ user, accessToken, refreshToken }`**.

Les deux structures existent réellement ; elles appartiennent à deux couches différentes. Lire la structure du SDK depuis un `fetch` brut donne `undefined`, ce qui se traduit par « connexion réussie mais il n'y a aucun jeton d'accès » — la connexion a bien fonctionné, mais le jeton se trouvait un niveau plus bas.
:::

### Changer d'adresse e-mail

Un utilisateur connecté déplace son propre compte vers une autre adresse en deux étapes :

1. `POST /api/auth/change-email { newEmail }` enregistre la modification et envoie un lien, `<frontend>/confirm-email-change?token=…`, à la nouvelle adresse, ainsi qu'une notification sans lien à l'adresse actuelle. Le lien est valable 24 heures, et une nouvelle requête remplace la précédente. `GET /api/auth/me` indique l'adresse en attente sous le nom de `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` déplace le compte : la nouvelle adresse devient son adresse, vérifiée. Chaque identité OAuth dont le fournisseur attestait de l'ancienne adresse est détachée (`removedProviders` les nomme), car quiconque contrôle l'ancienne adresse pourrait autrement toujours se connecter par son intermédiaire, et tout lien de réinitialisation envoyé à l'ancienne adresse cesse de fonctionner. Les sessions sont conservées.

La nouvelle adresse n'est pas réservée pendant l'attente du lien : la réserver permettrait à n'importe quel compte d'empêcher un inconnu de s'inscrire avec sa propre adresse. Si un autre compte possède l'adresse au moment où le lien est ouvert, le lien répond `409 EMAIL_EXISTS` et rien n'est modifié ; entre deux comptes demandant la même adresse, le premier à suivre son lien l'obtient. Le hook `beforeEmailChange` peut refuser une adresse, tout comme le fait `beforeUserCreate` lors de l'inscription.

Dans le CMS, l'adresse est modifiée depuis **Paramètres du compte → Profil**, et le lien ouvre l'écran propre au CMS, que l'on soit connecté ou non. Un autre frontend dessert une page sur `/confirm-email-change` qui appelle la route avec le jeton du lien.

Lorsque [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) est activé (valeur par défaut), le jeton de rafraîchissement transite sous la forme d'un cookie `httpOnly` et `tokens.refreshToken` est une chaîne vide dans le corps. Le jeton d'accès n'est pas affecté.

### Authentification multifacteur (TOTP)

**Un second facteur filtre la connexion, et pas seulement les opérations individuelles.** Dès lors qu'un compte possède un facteur TOTP *vérifié*, aucune route ne lui délivre de session tant qu'un code n'est pas présenté — la connexion par mot de passe, chaque fournisseur OAuth, le lien magique, le code par e-mail et le lien anonyme refusent tous avec `401 MFA_REQUIRED` :

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

`mfaToken` n'est **pas une session** : il est restreint à cet usage précis, expire au bout de cinq minutes et est rejeté par toutes les routes authentifiées. Envoyez-le en tant que jeton bearer à `POST /api/auth/mfa/challenge` (avec un `factorId`), puis à `POST /api/auth/mfa/challenge/verify` (avec le `challengeId` et le code à six chiffres, ou un code de récupération). C'est ce dernier appel qui émet les jetons d'accès et de rafraîchissement, au niveau `aal2` ; le niveau est stocké sur la session et conservé à travers `POST /api/auth/refresh`.

L'enrôlement est également restreint. Le premier facteur d'un compte peut être enrôlé depuis une session ordinaire, mais dès qu'un facteur est vérifié, `enroll`, `verify` et `unenroll` nécessitent tous une session `aal2` — sinon, un mot de passe dérobé permettrait d'enrôler un facteur propre à l'attaquant, d'élever ses privilèges avec celui-ci, puis de supprimer le véritable facteur.

La vérification est limitée sur deux axes : un défi expire après cinq tentatives infructueuses, chaque compte est limité à dix tentatives de vérification par tranche de 15 minutes (comptabilisées par utilisateur, de sorte que faire tourner les adresses IP n'aide pas), et un code accepté est consigné pour le facteur afin de ne pas pouvoir être rejoué pour le reste de sa fenêtre de ±1 intervalle.

Dans la table des utilisateurs du CMS, **Réinitialiser la vérification en deux étapes** (`DELETE /api/admin/users/:uid/mfa`) et **Désactiver ou activer le compte** (`PUT /api/admin/users/:uid { disabled }`) sont proposés à quiconque détient `users:write`, tout comme les routes ; le bouton bascule n'est jamais proposé pour votre propre compte, et toute tentative sur un compte de rang supérieur au vôtre est refusée avec le motif du serveur.

Définissez `MFA_ENCRYPTION_KEY` (32+ caractères aléatoires) pour chiffrer les secrets TOTP stockés. Sans cela, le serveur se rabat sur `JWT_SECRET` et émet un avertissement. Définissez-le **avant** que quiconque ne s'enrôle : les secrets stockés ne comportent aucun identifiant de clé, de sorte que modifier la clé après coup rend les facteurs existants indéchiffrables et empêche leurs propriétaires de réussir un défi.

### Inviter des membres d'équipe par e-mail

Les flux d'invitation doivent convertir une adresse e-mail en un identifiant utilisateur, mais la table `users` est protégée par RLS vis-à-vis du client. Au lieu de concevoir manuellement une fonction serveur d'administration, optez pour la recherche intégrée :

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

Le point de terminaison est **réservé aux utilisateurs authentifiés** et ne renvoie que `uid`, `displayName` et `photoURL` — jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur recherché. Il est **désactivé par défaut** car il permet à tout utilisateur connecté de vérifier quelles adresses e-mail possèdent un compte ; ne l'activez que si votre expérience utilisateur d'invitation le nécessite.

## Contexte de base de données Row-Level Security (RLS)

Rebase fait le lien direct entre l'authentification de la requête et la sécurité au niveau des lignes (Row-Level Security ou RLS) de PostgreSQL. Chaque requête de base de données exécutée via un pilote ciblé sur l'utilisateur s'exécute au sein d'une transaction de base de données (`db.transaction()`) qui configure des paramètres de configuration locaux à la transaction :

*   `app.uid` — L'identifiant unique (`uid`) de l'utilisateur authentifié. Vaut par défaut `'anonymous'` pour les requêtes non authentifiées. L'ancien paramètre `app.user_id` est toujours renseigné à ses côtés, pour les stratégies compilées avant le renommage.
*   `app.user_roles` — Une chaîne séparée par des virgules répertoriant les rôles attribués à l'utilisateur.
*   `app.is_anonymous` — `'true'` pour une session invité (connexion anonyme), `'false'` sinon.
*   `app.jwt` — Une chaîne JSON contenant les revendications (claims) personnalisées du jeton ainsi que `sub`, `roles` et `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

Ces paramètres sont configurés localement pour la durée de la transaction à l'aide de la fonction `set_config` de Postgres :
```sql
SELECT 
    set_config('app.uid', $1, true),
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.is_anonymous', $3, true),
    set_config('app.jwt', $4, true);
```

### Fonctions d'aide pour les stratégies PostgreSQL

Pour simplifier l'écriture des stratégies de sécurité au niveau des lignes, Rebase crée des fonctions d'aide sous le schéma `rebase` lors de l'initialisation de la base de données :

*   **`rebase.uid()`** — Renvoie l'ID de l'utilisateur authentifié sous forme de `text`, ou `NULL` s'il n'est pas défini :
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT COALESCE(
            NULLIF(current_setting('app.uid', true), ''),
            NULLIF(current_setting('app.user_id', true), '')
        );
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Renvoie la chaîne des rôles séparés par des virgules :
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Renvoie la charge utile (payload) complète du JWT sous forme d'objet `jsonb` :
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.is_anonymous()`** — Indique si l'appelant est un invité, sous forme de `boolean` (`false` lorsqu'il n'est pas défini), afin qu'une stratégie puisse spécifier `NOT rebase.is_anonymous()`.

Vous pouvez utiliser ces fonctions d'aide directement dans vos règles de sécurité personnalisées ou vos migrations de base de données :
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Jetons asymétriques et JWKS

Par défaut, les jetons d'accès sont signés avec `jwtSecret` (HS256). Cela fonctionne, mais cela signifie que tout composant devant *vérifier* un jeton doit détenir la clé qui l'*émet* — ainsi, une passerelle ou un edge worker vérifiant une session peut également en falsifier une — et modifier le secret déconnecte tous les utilisateurs en même temps.

Configurez une clé de signature et Rebase signera les jetons d'accès de manière asymétrique, en publiant la moitié publique sur **`/.well-known/jwks.json`** afin que quiconque puisse vérifier les jetons :

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

Les clés RSA fonctionnent également et signent en `RS256` ; les clés EC P-256 signent en `ES256`. Seule la clé privée est configurée — la moitié publique en est dérivée, ce qui élimine tout risque de discordance dans la paire. `jwtSecret` reste requis dans tous les cas : il signe toujours les jetons à portée spécifique (liens de téléchargement, attente MFA, réinitialisation de mot de passe) que seul ce serveur lit.

### Rotation d'une clé

Placez la nouvelle clé en premier et conservez l'ancienne dans la liste. Les nouveaux jetons sont signés par la nouvelle clé ; les jetons déjà en circulation continuent d'être vérifiés par rapport à l'ancienne jusqu'à leur expiration, évitant ainsi toute déconnexion inopinée.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Une fois passée la durée de vie la plus longue d'un jeton d'accès, supprimez l'ancienne entrée. Utilisez `activeKid` si vous souhaitez publier une clé avant de signer avec.

### Vérification ailleurs

Les jetons portent le `kid` de la clé de signature dans leur en-tête, ce qui permet à un vérificateur de sélectionner la bonne clé dans le JWKS et de savoir quand récupérer à nouveau le jeu de clés après une rotation. Toute bibliothèque standard effectue cela pour vous — par exemple, avec `jose` :

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Si aucune `signingKeys` n'est configurée, `/.well-known/jwks.json` renvoie `{"keys":[]}` et les jetons restent en HS256. Rien ne change tant que vous n'ajoutez pas de clé.
:::

## Authentification par clé de service

Pour la communication entre serveurs (par ex., tâches cron, services externes), configurez une clé de service statique :

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Les clients s'authentifient avec l'en-tête `Authorization: Bearer <service-key>`. 

### Clé interne par démarrage (per-boot)

Si `REBASE_SERVICE_KEY` n'est pas fourni dans votre configuration, Rebase génère automatiquement une **clé interne aléatoire par démarrage**. 

Cette clé n'est jamais journalisée et ne quitte jamais le processus. Elle est utilisée par le singleton `rebase` pour s'authentifier auprès des API de plan de contrôle du serveur lui-même (authentification, stockage, etc.). Cela garantit que les tâches administratives (comme l'envoi d'un e-mail de bienvenue ou la génération d'une URL de stockage) fonctionnent toujours dès l'installation, en développement comme en production, sans nécessiter de gestion manuelle des clés.

### Protection contre les attaques temporelles et exigences relatives aux clés

Pour prévenir les attaques temporelles (timing attacks), Rebase valide à la fois la clé de service configurée par l'utilisateur et la clé interne à l'aide d'une comparaison de chaînes en temps constant (`safeCompare`). La clé de service configurée par l'utilisateur **doit comporter au moins 32 caractères** ; si une clé de moins de 32 caractères est configurée, Rebase lèvera une erreur de configuration au démarrage et se verrouillera par sécurité (fail-closed).

## Prochaines étapes

- **[Authentification](/docs/backend/authentication/)** — la configuration d'où proviennent ces routes
- **[Adaptateurs d'authentification personnalisés](/docs/backend/auth-adapters/)** — remplacer le fournisseur sous-jacent
- **[Règles de sécurité (RLS)](/docs/collections/security-rules/)** — ce qu'une stratégie fait avec `rebase.uid()`
- **[Authentification avec le SDK typé](/docs/sdk/authentication/)** — appeler ces routes depuis le SDK
