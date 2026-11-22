---
sourceHash: 928eebeb904fa5e0
title: Endpoints d'authentification et jetons
sidebar_label: Endpoints d'authentification
description: Les routes d'authentification montées par le backend Rebase, la structure de leurs réponses, l'authentification multifacteur, le contexte de base de données vu par une policy, JWKS et clés de service.
---

Les routes montées par [le bloc `auth`](/docs/backend/authentication/), et les jetons qu'elles renvoient.

## Endpoints d'authentification

Tous les endpoints d'authentification sont montés sur `/api/auth/` :

| Méthode | Chemin | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Créer un nouveau compte |
| `POST` | `/api/auth/login` | Se connecter avec e-mail/mot de passe |
| `POST` | `/api/auth/refresh` | Rafraîchir le jeton d'accès |
| `POST` | `/api/auth/<provider>` | Connexion OAuth (par exemple, `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Lier un fournisseur OAuth au compte authentifié. Pour un invité (guest), il s'agit d'une inscription : cela nécessite `allowRegistration`, prend l'adresse du fournisseur lorsque celui-ci la valide, et répond avec une session pour le compte que l'invité est devenu |
| `POST` | `/api/auth/logout` | Révoquer le jeton de rafraîchissement |
| `POST` | `/api/auth/forgot-password` | Envoyer l'e-mail de réinitialisation de mot de passe |
| `POST` | `/api/auth/reset-password` | Réinitialiser le mot de passe avec un jeton |
| `POST` | `/api/auth/find-user` | Résoudre un e-mail en un profil public minimal (optionnel — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Modifier le propre mot de passe de l'appelant (authentifié). Met fin à toutes les autres sessions et renvoie une nouvelle session pour l'appelant |
| `GET` | `/api/auth/me` | Le propre profil de l'appelant |
| `PATCH` | `/api/auth/me` | Mettre à jour le propre profil de l'appelant |
| `POST` | `/api/auth/change-email` | `{ newEmail }` : transférer le propre compte de l'appelant vers une autre adresse. Envoie un lien par e-mail à la nouvelle adresse et une notification à l'ancienne ; rien ne change tant que le lien n'est pas suivi. Nécessite `aal2` sur un compte avec un second facteur. `409 EMAIL_EXISTS` ou `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` pour un invité — voir [Modifier une adresse e-mail](#modifier-une-adresse-e-mail) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` provenant du lien. Aucune session requise. Transfère le compte vers la nouvelle adresse, vérifiée ; `400 INVALID_TOKEN` pour un lien déjà utilisé, remplacé ou expiré, `409 EMAIL_EXISTS` lorsque l'adresse a été prise pendant l'attente |
| `GET` | `/api/auth/config` | Ce que ce backend propose à un écran de connexion — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders`, et `storage`, qui indique si le backend gère le stockage de fichiers. Non authentifié, et calculé à partir des mêmes prédicats que ceux appliqués par les routes, de sorte que ce que l'écran annonce ne peut pas diverger de ce qu'il peut faire |
| `POST` | `/api/auth/send-verification` | Envoyer à l'appelant un lien de vérification d'e-mail |
| `GET` | `/api/auth/verify-email` | Consommer un lien de vérification (l'URL contenue dans cet e-mail). Conserve ce qu'une session active du compte prouve et supprime ce que personne n'a prouvé — voir [Vérification d'e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | La même chose avec `{ token, password?, removeUnproven? }` : le mot de passe le conserve et connecte l'utilisateur ; sans aucune de ces preuves, un compte en détenant une répond `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Envoyer par e-mail un lien de connexion à usage unique. `503 EMAIL_NOT_CONFIGURED` sans SMTP |
| `POST` | `/api/auth/magic-link/verify` | Échanger un jeton de magic link contre une session |
| `POST` | `/api/auth/otp` | Envoyer par e-mail un code de connexion à six chiffres. Répond de la même manière, que l'adresse possède un compte ou non |
| `POST` | `/api/auth/otp/verify` | Échanger `{ email, code }` contre une session |
| `POST` | `/api/auth/anonymous` | Créer une session anonyme (optionnel — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Associer de véritables identifiants au compte anonyme déjà connecté. Nécessite à la fois `allowAnonymous` et l'inscription ouverte : `403 ANONYMOUS_AUTH_DISABLED` une fois la connexion anonyme désactivée, y compris pour les invités connectés auparavant, et `403 REGISTRATION_DISABLED` tant que l'inscription est fermée |
| `GET` | `/api/auth/sessions` | Lister les sessions actives de l'appelant, une par connexion. Celle de l'appelant est marquée `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Révoquer toutes les sessions, y compris celle-ci — déconnexion à distance sur chaque appareil |
| `DELETE` | `/api/auth/sessions/:id` | Révoquer une session : son jeton de rafraîchissement et le jeton d'accès détenu par cet appareil |
| `GET` | `/api/auth/scopes` | Tous les [scopes](/docs/backend/roles-and-scopes/) connus de ce backend, et ceux détenus par l'appelant |
| `GET` | `/api/auth/keys` | Les propres [clés d'API personnelles](/docs/backend/api-keys/#personal-keys) de l'appelant |
| `POST` | `/api/auth/keys` | Créer une clé personnelle. `403 PERSONAL_KEYS_DISABLED` sauf si la table des utilisateurs définit `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Révoquer l'une des propres clés de l'appelant |
| `GET` | `/.well-known/jwks.json` | Le JWKS public — monté à la racine, et non sous `basePath`, car c'est là qu'un vérificateur cherche. Monté dès lors que le backend émet ses propres jetons ; un jeu de clés vide jusqu'à ce que la [signature asymétrique](#jetons-asymétriques-et-jwks) soit configurée |
| `POST` | `/api/auth/mfa/enroll` | Démarrer l'enrôlement TOTP (renvoie le secret et les codes de récupération) |
| `POST` | `/api/auth/mfa/verify` | Confirmer un enrôlement avec un code provenant de l'application d'authentification |
| `GET` | `/api/auth/mfa/factors` | Lister les facteurs enregistrés de l'appelant |
| `POST` | `/api/auth/mfa/challenge` | Initier un challenge contre un facteur vérifié |
| `POST` | `/api/auth/mfa/challenge/verify` | Répondre à un challenge — c'est ce qui émet la session |
| `DELETE` | `/api/auth/mfa/unenroll` | Supprimer un facteur (nécessite une session `aal2` dès lors que le compte dispose d'un facteur vérifié) |
| `POST` | `/api/auth/mfa/recovery-codes` | Remplacer les codes de récupération de l'appelant par dix nouveaux codes (nécessite une session `aal2`) |

La gestion administrative des utilisateurs et des rôles est une **surface distincte**, montée sur
`/api/admin/` plutôt que sur `/api/auth/`. La lecture nécessite le scope `users:read` et
la modification nécessite `users:write`, à l'exception de la lecture restreinte du sélecteur d'utilisateurs ci-dessous. Un administrateur et la clé de service possèdent les deux ; il en va de même pour un
rôle qui les déclare. Personne ne peut modifier un compte qui possède plus de droits
qu'il n'en a lui-même. Voir [Rôles et scopes](/docs/backend/roles-and-scopes/).

| Méthode | Chemin | Description |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Lister les utilisateurs (paginé). `?search=` correspond de manière insensible à la casse à une partie de l'e-mail ou du nom d'affichage. Il correspond également à tout rôle détenu par l'utilisateur, ainsi qu'à l'uid |
| `GET` | `/api/admin/users/pick` | Lecture du sélecteur d'utilisateurs : `uid`, `displayName`, `email` et `photoURL` par utilisateur, rien d'autre. Accepte `?search=`, `?limit=` (25 par défaut) et `?offset=`, ou `?ids=a,b` pour les utilisateurs désignés par une valeur stockée. Répond à `users:read`, ainsi qu'à quiconque peut écrire dans une collection avec un champ [`userSelect`](/docs/collections/properties/) — afin qu'un éditeur puisse en remplir un. Une règle écrite en SQL brut (`using` / `withCheck` que le modèle de politique ne peut pas lire) ne pouvant être jugée à l'avance, elle compte ici comme un refus : sur une telle collection, seuls les détenteurs de `users:read` peuvent effectuer une sélection. Toute autre personne reçoit `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Créer un utilisateur. `invite: false` sans `password` le crée sans mot de passe et n'envoie rien |
| `POST` | `/api/admin/users/import` | Importer des comptes depuis un autre système en conservant leurs identifiants. Voir [Importer des comptes](#importer-des-comptes) |
| `GET` | `/api/admin/users/:uid` | Lire un utilisateur |
| `PUT` | `/api/admin/users/:uid` | Mettre à jour un utilisateur. `{ disabled: true }` désactive le compte sans le supprimer : chaque connexion et rafraîchissement est refusé (`ACCOUNT_DISABLED`), ses sessions prennent fin et chaque jeton qu'il détient est rejeté ; `false` le réactive |
| `DELETE` | `/api/admin/users/:uid` | Supprimer un utilisateur. Ses sessions prennent fin et chaque jeton d'accès qu'il détient est refusé à partir de cette requête |
| `POST` | `/api/admin/users/:uid/reset-password` | Réinitialiser le mot de passe d'un utilisateur sans son mot de passe actuel. `rebase auth reset-password` l'appelle, et n'écrit directement dans la base de données que lorsque le backend est inaccessible ; dans les deux cas, les sessions du compte prennent fin |
| `DELETE` | `/api/admin/users/:uid/mfa` | Supprimer les seconds facteurs et les codes de récupération d'un utilisateur, et mettre fin à ses sessions — pour quelqu'un qui a perdu les deux |
| `GET` | `/api/admin/roles` | `admin` et les rôles déclarés par la table des utilisateurs, avec leurs scopes |
| `POST` | `/api/admin/bootstrap` | Permettre au premier utilisateur inscrit de revendiquer le rôle d'administrateur tant qu'aucun n'existe. Refusé en production — voir [Amorçage du premier utilisateur](/docs/backend/authentication/#first-user-bootstrap) |

Tous les endpoints de l'API de données nécessitent un en-tête `Authorization: Bearer <token>` valide lorsque `requireAuth: true` (valeur par défaut).

### Importer des comptes

`POST /api/admin/users/import` crée des comptes qui existent déjà dans un autre
système, sous les identifiants qu'ils y possèdent, afin que chaque ligne faisant référence à l'un d'eux
désigne toujours le même compte. Cela nécessite `users:write`, comme `POST /api/admin/users`.

```json
{
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "displayName": "Ada",
      "createdAt": "2024-05-02T08:30:00Z", "emailVerified": true, "roles": ["editor"] }
  ],
  "dryRun": false
}
```

- **`id`** est conservé et est optionnel. Un uuid est le cas le plus courant ; tout identifiant composé de
  lettres, de chiffres et de `_ - . : |`, commençant par une lettre ou un chiffre, jusqu'à 128
  caractères, convient également (identifiants Firebase, Auth0, Clerk). `service`, `anonymous`,
  `anon` et `default` sont refusés, tout comme n'importe quel autre format non conforme : `400 INVALID_ID` pour
  ce compte. Une table des utilisateurs dont la colonne `id` est de type `uuid` n'accepte que des uuids.
- **`email`** est requis. `displayName`, `photoUrl`, `createdAt` (ISO 8601) et
  `roles` sont optionnels ; `emailVerified` vaut `false` sauf indication contraire. Un compte non vérifié
  est confirmé par le premier magic link ou lien de réinitialisation qu'il suit, et aucune connexion via un
  fournisseur tiers ne peut être effectuée d'ici là.
- **Pas de mot de passe, pas d'e-mail.** Un champ `password` ou `passwordHash` fait échouer
  ce compte, et aucun e-mail n'est envoyé. Le compte se connecte par magic link, code par
  e-mail, fournisseur OAuth ou réinitialisation de mot de passe.
- **Rien n'est mis à jour.** Un compte dont l'identifiant est déjà pris est marqué `skipped` avec
  `ID_EXISTS`, un compte dont l'e-mail est déjà pris avec `EMAIL_EXISTS` (y compris un compte précédent
  dans la même requête). Exécuter le même import deux fois est sans danger.
- **Aucun rôle supérieur à celui de l'appelant**, comme sur `POST /api/admin/users`, et
  `beforeUserCreate` s'exécute pour chaque compte et peut le refuser.
- **Au maximum 100 comptes par requête** (`400 TOO_MANY_USERS` au-delà).
  `dryRun: true` exécute chaque vérification sans rien écrire.

La réponse est `200` avec un résultat par compte, dans l'ordre :

```json
{
  "dryRun": false, "created": 1, "skipped": 1, "failed": 1,
  "results": [
    { "index": 0, "status": "created", "uid": "5b0a3c9e-…", "email": "ada@example.com" },
    { "index": 1, "status": "skipped", "uid": "…", "email": "bob@example.com", "code": "EMAIL_EXISTS", "message": "…" },
    { "index": 2, "status": "failed", "email": "eve@example.com", "code": "INVALID_ID", "message": "…" }
  ]
}
```

`rebase users import <file>` envoie un fichier CSV ou JSON de cette manière, par lots de 100 comptes
à la fois, et `client.admin.importUsers(users, { dryRun })` est l'appel correspondant dans le SDK.

### Politique de mot de passe

Un nouveau mot de passe nécessite au moins 8 caractères, avec une lettre majuscule, une
lettre minuscule et un chiffre. L'inscription, la réinitialisation et la modification refusent tout mot de passe
non conforme avec l'erreur `400 WEAK_PASSWORD`, en énumérant chaque règle enfreinte, et il en va de même pour un
administrateur définissant un mot de passe : `POST /api/admin/users`, une création sur la
table des utilisateurs via l'API de données (`POST /api/data/users`, son `/bulk`, une
écriture par socket ou MCP), `PUT /api/admin/users/:uid` et
`POST /api/admin/users/:uid/reset-password`. Sur un `/bulk`, le message commence par
`Row <n>: ` (numéroté à partir de 0), à l'image des autres erreurs de ligne d'une opération groupée.

Pour créer des comptes dont les mots de passe ont été définis par un autre système, comme lors d'un import, envoyez
`skipPasswordPolicy: true` dans le corps de création (sur chaque ligne d'un `/bulk`). Le
serveur ne l'honore que pour un administrateur ou la clé de service ; pour quiconque
d'autre, aucune dérogation n'est accordée et le motif de refus l'indique. Cette option n'est jamais stockée. L'importation
du panneau d'administration l'envoie pour chaque ligne contenant un `password`. La connexion
ne vérifie jamais la politique, ce qui permet à un ancien mot de passe de continuer à fonctionner. Pour définir vos propres règles, passez
`auth.hooks.validatePasswordStrength` depuis un backend [éjecté](/docs/backend/authentication/#configuration).
Le premier administrateur initialisé à partir de `REBASE_ADMIN_PASSWORD` est soumis à une
règle différente : au moins 12 caractères, sans autre contrainte.

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
`accessTokenExpiresAt` correspond aux millisecondes de l'époque Unix.

`POST /api/auth/refresh` répond avec la même enveloppe, sauf que `user` est
entièrement omis lorsque le compte ne peut pas être relu ; traitez-le donc comme optionnel
dans ce cas.

`providerId` indique le mode de connexion à la session : `password`, `anonymous`,
`magic-link`, `otp`, `mfa` (une connexion finalisée avec un second facteur), ou l'identifiant
du fournisseur, tel que `google`. Il est stocké avec la session lors de la connexion, de sorte que
`refresh` et `GET /api/auth/me` fournissent la même réponse pendant toute la durée
de vie de la session. Une session connectée avant la version 0.24 indique `password`.

:::caution[Le SDK typé aplatit cette enveloppe — le HTTP brut ne le fait pas]
Le format JSON ci-dessus est le format de transport réseau, et c'est ce que `fetch("/api/auth/login")`
renvoie : le jeton se trouve sous **`body.tokens.accessToken`**.

Le [SDK typé](/docs/sdk/authentication) désencapsule `tokens` avant de renvoyer
la session, si bien que `auth.signInWithEmail()` renvoie à la place un objet aplati :
**`{ user, accessToken, refreshToken }`**.

Les deux structures sont valides ; elles appartiennent à deux couches différentes. Lire la
structure du SDK depuis un `fetch` brut donne `undefined`, ce qui se traduit par "la connexion a réussi
mais il n'y a pas de jeton d'accès" — la connexion s'est bien déroulée, le jeton se trouvait simplement un niveau plus bas.
:::

### Modifier une adresse e-mail

Un utilisateur connecté
transfère son propre compte vers une autre adresse en deux étapes :

1. `POST /api/auth/change-email { newEmail }` enregistre la modification et envoie par e-mail un
   lien, `<frontend>/confirm-email-change?token=…`, à la nouvelle adresse, ainsi qu'un
   avis sans lien à l'adresse actuelle. Le lien est valable 24 heures, et une
   nouvelle requête remplace la précédente. `GET /api/auth/me` indique l'adresse
   en attente sous `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` transfère le compte : la nouvelle
   adresse devient son adresse officielle, vérifiée. Chaque identité OAuth dont le fournisseur
   garantissait l'ancienne adresse est détachée (`removedProviders` les énumère),
   car quiconque contrôle l'ancienne adresse pourrait sinon toujours se connecter
   par ce biais, et tout lien de réinitialisation envoyé à l'ancienne adresse cesse de fonctionner.
   Les sessions sont conservées.

La nouvelle adresse n'est pas réservée pendant l'attente du lien : la réserver permettrait à n'importe quel
compte d'empêcher un tiers de s'inscrire avec sa propre adresse. Si un autre
compte s'est approprié l'adresse au moment où le lien est suivi, le lien répond
`409 EMAIL_EXISTS` et rien n'est modifié ; si deux comptes demandent la même
adresse, le premier à suivre son lien l'obtient. Le hook `beforeEmailChange` peut
refuser une adresse, tout comme le fait `beforeUserCreate` lors de l'inscription.

Dans le CMS, l'adresse est modifiée depuis **Paramètres du compte → Profil**, et le
lien ouvre l'écran dédié du CMS, que l'utilisateur soit connecté ou non. Un autre frontend propose une page
sur `/confirm-email-change` qui appelle la route avec le jeton du lien.

Avec [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) activé (par défaut), le jeton
de rafraîchissement transite sous la forme d'un cookie `httpOnly` et `tokens.refreshToken` est une chaîne
vide dans le corps. Le jeton d'accès n'est pas affecté.

### Authentification multifacteur (TOTP)

**Un second facteur protège la connexion, et pas seulement des opérations individuelles.** Dès qu'un
compte possède un facteur TOTP *vérifié*, aucune route ne lui délivre de session tant qu'un
code n'est pas fourni — la connexion par mot de passe, chaque fournisseur OAuth, le magic link, le code par
e-mail et le lien anonyme refusent tous avec l'erreur `401 MFA_REQUIRED` :

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

`mfaToken` n'est **pas une session** : il est restreint à cet usage spécifique, expire au bout de cinq minutes,
et est rejeté par toutes les routes authentifiées. Envoyez-le comme jeton bearer à
`POST /api/auth/mfa/challenge` (avec un `factorId`), puis à
`POST /api/auth/mfa/challenge/verify` (avec le `challengeId` et le code à six chiffres,
ou un code de récupération). C'est ce dernier appel qui émet les jetons d'accès et de rafraîchissement,
au niveau `aal2` ; ce niveau est stocké sur la session et conservé à travers
`POST /api/auth/refresh`.

L'enrôlement est également restreint. Le premier facteur d'un compte peut être enrôlé depuis une
session ordinaire, mais une fois un facteur vérifié, `enroll`, `verify` et `unenroll`
nécessitent tous une session `aal2` — dans le cas contraire, un mot de passe dérobé permettrait d'enrôler un
propre facteur, d'élever ses privilèges avec celui-ci, puis de supprimer le facteur légitime.

La vérification est limitée sur deux axes : un challenge expire après cinq tentatives
infructueuses, chaque compte est limité à dix tentatives de vérification par tranche de 15 minutes
(comptabilisées par utilisateur, donc la rotation d'adresses IP est inefficace), et un code accepté est
enregistré contre le facteur afin qu'il ne puisse pas être rejoué pendant le reste de sa
fenêtre de ±1 pas.

Dans la table des utilisateurs du CMS, **Réinitialiser la validation en deux étapes**
(`DELETE /api/admin/users/:uid/mfa`) et **Désactiver ou activer le compte**
(`PUT /api/admin/users/:uid { disabled }`) sont proposés à toute personne détenant
`users:write`, tout comme les routes correspondantes ; l'option n'est jamais proposée sur votre propre
compte, et une tentative sur un compte ayant un rang supérieur au vôtre est refusée avec le motif du serveur.

Définissez `MFA_ENCRYPTION_KEY` (au moins 32 caractères aléatoires) pour chiffrer les secrets
TOTP stockés. Sans cette variable, le serveur utilise par défaut `JWT_SECRET` et émet un avertissement. Définissez-la
**avant** toute inscription : les secrets stockés ne portent aucun identifiant de clé, donc modifier la clé
ultérieurement rendra les facteurs existants indéchiffrables et leurs propriétaires incapables de
valider un challenge.

### Inviter des collaborateurs par e-mail

Les parcours d'invitation doivent associer une adresse e-mail à un identifiant d'utilisateur, mais la table `users`
est protégée par RLS vis-à-vis du client. Au lieu de développer manuellement une fonction
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

L'endpoint est **strictement réservé aux utilisateurs authentifiés** et ne renvoie que `uid`, `displayName`
et `photoURL` — jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur recherché. Il
est **désactivé par défaut** car il permet à tout utilisateur connecté de sonder quelles adresses e-mail possèdent
un compte ; ne l'activez que si votre expérience d'invitation le requiert.

## Contexte de base de données Row-Level Security (RLS)

Rebase fait directement le lien entre l'authentification de la requête et le système de sécurité Row-Level Security (RLS) de PostgreSQL. Chaque requête de base de données exécutée via un driver associé à un utilisateur s'exécute au sein d'une transaction de base de données (`db.transaction()`) qui configure des paramètres de configuration locaux à la transaction :

*   `app.uid` — L'identifiant unique de l'utilisateur authentifié (`uid`). Défini par défaut sur `'anonymous'` pour les requêtes non authentifiées. La version antérieure au renommage `app.user_id` est toujours renseignée à ses côtés, pour les policies compilées avant le renommage.
*   `app.user_roles` — Une chaîne séparée par des virgules listant les rôles attribués à l'utilisateur.
*   `app.is_anonymous` — `'true'` pour une session invité (connexion anonyme), `'false'` sinon.
*   `app.jwt` — Une chaîne JSON contenant les revendications personnalisées (claims) du jeton ainsi que `sub`, `roles` et `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

Ces paramètres sont configurés localement pour la durée de la transaction à l'aide de la fonction `set_config` de Postgres :
```sql
SELECT 
    set_config('app.uid', $1, true),
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.is_anonymous', $3, true),
    set_config('app.jwt', $4, true);
```

### Fonctions d'assistance pour les politiques PostgreSQL

Pour simplifier l'écriture des politiques Row-Level Security, Rebase crée des fonctions d'assistance sous le schéma `rebase` lors de l'amorçage de la base de données :

*   **`rebase.uid()`** — Renvoie l'identifiant de l'utilisateur authentifié sous forme de `text`, ou `NULL` s'il n'est pas défini :
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
*   **`rebase.jwt()`** — Renvoie l'ensemble de la charge utile (payload) du JWT sous la forme d'un objet `jsonb` :
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.is_anonymous()`** — Indique si l'appelant est un invité, sous forme de `boolean` (`false` lorsqu'il n'est pas défini), afin qu'une politique puisse stipuler `NOT rebase.is_anonymous()`.

Vous pouvez utiliser ces fonctions directement dans vos règles de sécurité personnalisées ou vos migrations de base de données :
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Jetons asymétriques et JWKS

Par défaut, les jetons d'accès sont signés avec `jwtSecret` (HS256). Cela fonctionne, mais
cela implique que tout composant devant *vérifier* un jeton doit détenir la clé qui *l'émet*
— ainsi, une passerelle ou un edge worker contrôlant une session peut également en falsifier un — et
changer le secret déconnecte tous les utilisateurs en même temps.

Configurez une clé de signature et Rebase signera les jetons d'accès de manière asymétrique,
en publiant la partie publique sur **`/.well-known/jwks.json`** afin que quiconque puisse
la vérifier :

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

Les clés RSA fonctionnent également et signent en `RS256` ; les clés EC P-256 signent en `ES256`. Seule la clé
privée est configurée — la partie publique en est dérivée, ce qui empêche toute discordance
au sein de la paire. `jwtSecret` reste obligatoire dans tous les cas : il sert toujours à signer les
jetons à portée spécifique (liens de téléchargement, attente MFA, réinitialisation de mot de passe) que seul
ce serveur lit.

### Effectuer la rotation d'une clé

Placez la nouvelle clé en premier et conservez l'ancienne dans la liste. Les nouveaux jetons sont signés par la
nouvelle clé ; les jetons déjà en circulation continuent d'être vérifiés avec l'ancienne jusqu'à ce
qu'ils expirent, de sorte que personne n'est déconnecté.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Une fois la durée de vie du jeton d'accès le plus long écoulée, retirez l'ancienne entrée. Utilisez
`activeKid` si vous souhaitez publier une clé avant de l'utiliser pour signer.

### Vérifier ailleurs

Les jetons portent le `kid` de la clé de signature dans leur en-tête, ce qui permet à un vérificateur
de sélectionner la bonne clé au sein du JWKS et de savoir quand récupérer à nouveau les clés après une
rotation. Toute bibliothèque standard prend cela en charge — par exemple, avec `jose` :

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Si aucune variable `signingKeys` n'est configurée, `/.well-known/jwks.json` répond
`{"keys":[]}` et les jetons restent en HS256. Rien ne change tant que vous n'ajoutez pas de clé.
:::

## Authentification par clé de service

Pour la communication de serveur à serveur (ex. tâches cron, services externes), configurez une clé de service statique :

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Les clients s'authentifient avec l'en-tête `Authorization: Bearer <service-key>`.

### Clé interne par démarrage (per-boot)

Si `REBASE_SERVICE_KEY` n'est pas fourni dans votre configuration, Rebase génère automatiquement une **clé interne aléatoire par démarrage**.

Cette clé n'est jamais journalisée et ne quitte jamais le processus. Elle est utilisée par le singleton `rebase` pour s'authentifier auprès des API du plan de contrôle du serveur lui-même (authentification, stockage, etc.). Cela garantit que les tâches administratives (comme l'envoi d'un e-mail de bienvenue ou la génération d'une URL de stockage) fonctionnent toujours dès l'installation, en développement comme en production, sans nécessiter de gestion manuelle des clés.

### Protection contre les attaques temporelles et exigences de clé

Pour prévenir les attaques temporelles (timing attacks), Rebase valide la clé de service configurée par l'utilisateur ainsi que la clé interne à l'aide d'une comparaison de chaînes en temps constant (`safeCompare`). La clé de service configurée par l'utilisateur **doit comporter au moins 32 caractères** ; si une clé de moins de 32 caractères est configurée, Rebase lèvera une erreur de configuration au démarrage et refusera de démarrer (fail-closed).

## Prochaines étapes

- **[Authentification](/docs/backend/authentication/)** — la configuration dont ces routes sont issues
- **[Adaptateurs d'authentification personnalisés](/docs/backend/auth-adapters/)** — remplacer le fournisseur sous-jacent
- **[Règles de sécurité (RLS)](/docs/collections/security-rules/)** — ce qu'une politique fait avec `rebase.uid()`
- **[Authentification via le SDK typé](/docs/sdk/authentication/)** — appeler ces routes depuis le SDK
