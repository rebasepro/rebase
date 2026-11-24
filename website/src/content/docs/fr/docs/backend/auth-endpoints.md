---
sourceHash: 6d4a5f8b72b38f97
title: Points de terminaison d'authentification et jetons
sidebar_label: Points de terminaison d'authentification
description: Les routes d'authentification montées par le backend Rebase, la structure de leurs réponses, l'authentification multifacteur, le contexte de base de données vu par une stratégie, JWKS et clés de service.
---

Les routes montées par [le bloc `auth`](/docs/backend/authentication/) et les jetons qu'elles renvoient.

## Points de terminaison d'authentification

Tous les points de terminaison d'authentification sont montés sous `/api/auth/` :

| Méthode | Chemin | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Créer un nouveau compte |
| `POST` | `/api/auth/login` | Connexion avec e-mail/mot de passe |
| `POST` | `/api/auth/refresh` | Rafraîchir le jeton d'accès |
| `POST` | `/api/auth/<provider>` | Connexion OAuth (ex. : `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Lier un fournisseur OAuth au compte authentifié. Pour un invité, il s'agit d'une inscription : cela nécessite `allowRegistration`, utilise l'adresse du fournisseur lorsque celui-ci la valide, et répond avec une session pour le compte qu'est devenu l'invité |
| `POST` | `/api/auth/logout` | Révoquer le jeton de rafraîchissement |
| `POST` | `/api/auth/forgot-password` | Envoyer l'e-mail de réinitialisation du mot de passe |
| `POST` | `/api/auth/reset-password` | Réinitialiser le mot de passe avec un jeton |
| `POST` | `/api/auth/find-user` | Résoudre un e-mail en un profil public minimal (optionnel — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Modifier le propre mot de passe de l'appelant (authentifié). Met fin à toutes les autres sessions et répond avec une nouvelle session pour l'appelant |
| `GET` | `/api/auth/me` | Le propre profil de l'appelant |
| `PATCH` | `/api/auth/me` | Mettre à jour le propre profil de l'appelant |
| `POST` | `/api/auth/change-email` | `{ newEmail }` : transférer le propre compte de l'appelant vers une autre adresse. Envoie un lien à la nouvelle adresse et une notification à l'ancienne ; rien ne change tant que le lien n'est pas suivi. Nécessite `aal2` sur un compte disposant d'un second facteur. `409 EMAIL_EXISTS` ou `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` pour un invité — voir [Modification d'une adresse e-mail](#modification-dune-adresse-e-mail) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` provenant du lien. Aucune session requise. Transfère le compte vers la nouvelle adresse, vérifiée ; `400 INVALID_TOKEN` pour un lien déjà utilisé, remplacé ou expiré, `409 EMAIL_EXISTS` lorsque l'adresse a été prise pendant l'attente |
| `GET` | `/api/auth/config` | Ce que ce backend met à disposition d'un écran de connexion — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders`, et `storage`, qui indique si le backend prend en charge le stockage de fichiers. Non authentifié, et calculé à partir des mêmes prédicats que ceux appliqués par les routes, de sorte que ce que l'écran affiche ne peut pas diverger de ce qu'il peut faire |
| `POST` | `/api/auth/send-verification` | Envoyer un lien de vérification d'e-mail à l'appelant |
| `GET` | `/api/auth/verify-email` | Consommer un lien de vérification (l'URL contenue dans cet e-mail). Conserve ce qu'une session active du compte prouve et supprime ce que personne n'a prouvé — voir [Vérification d'e-mail](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Identique avec `{ token, password?, removeUnproven? }` : le mot de passe le conserve et connecte l'utilisateur ; sans aucune de ces preuves, un compte en détenant une répond `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Envoyer par e-mail un lien de connexion à usage unique. `503 EMAIL_NOT_CONFIGURED` sans SMTP |
| `POST` | `/api/auth/magic-link/verify` | Échanger un jeton de lien magique contre une session |
| `POST` | `/api/auth/otp` | Envoyer par e-mail un code de connexion à six chiffres. Répond de manière identique, que l'adresse possède un compte ou non |
| `POST` | `/api/auth/otp/verify` | Échanger `{ email, code }` contre une session |
| `POST` | `/api/auth/anonymous` | Créer une session anonyme (optionnel — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Associer de véritables identifiants au compte anonyme déjà connecté. Nécessite à la fois `allowAnonymous` et l'ouverture des inscriptions : `403 ANONYMOUS_AUTH_DISABLED` dès que la connexion anonyme est désactivée, y compris pour les invités connectés auparavant, et `403 REGISTRATION_DISABLED` tant que les inscriptions sont fermées |
| `GET` | `/api/auth/sessions` | Lister les sessions actives de l'appelant, une par connexion. Celle de l'appelant est marquée `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Révoquer toutes les sessions, y compris celle-ci — déconnexion à distance sur chaque appareil |
| `DELETE` | `/api/auth/sessions/:id` | Révoquer une session : son jeton de rafraîchissement et le jeton d'accès détenu par cet appareil |
| `GET` | `/api/auth/scopes` | Tous les [périmètres (scopes)](/docs/backend/roles-and-scopes/) connus de ce backend, et ceux détenus par l'appelant |
| `GET` | `/api/auth/keys` | Les propres [clés d'API personnelles](/docs/backend/api-keys/#personal-keys) de l'appelant |
| `POST` | `/api/auth/keys` | Créer une clé personnelle. `403 PERSONAL_KEYS_DISABLED` sauf si la table des utilisateurs définit `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Révoquer l'une des propres clés de l'appelant |
| `GET` | `/.well-known/jwks.json` | Le JWKS public — monté à la racine et non sous `basePath`, car c'est là qu'un vérificateur cherche. Monté dès lors que le backend émet ses propres jetons ; ensemble de clés vide jusqu'à ce que la [signature asymétrique](#jetons-asymétriques-et-jwks) soit configurée |
| `POST` | `/api/auth/mfa/enroll` | Démarrer l'enregistrement TOTP (renvoie le secret et les codes de récupération) |
| `POST` | `/api/auth/mfa/verify` | Confirmer un enregistrement avec un code de l'application d'authentification |
| `GET` | `/api/auth/mfa/factors` | Lister les facteurs enregistrés de l'appelant |
| `POST` | `/api/auth/mfa/challenge` | Ouvrir un challenge pour un facteur vérifié |
| `POST` | `/api/auth/mfa/challenge/verify` | Répondre à un challenge — c'est ce qui émet la session |
| `DELETE` | `/api/auth/mfa/unenroll` | Supprimer un facteur (nécessite une session `aal2` dès lors que le compte a un facteur vérifié) |
| `POST` | `/api/auth/mfa/recovery-codes` | Remplacer les codes de récupération de l'appelant par dix nouveaux codes (nécessite une session `aal2`) |

La gestion administrative des utilisateurs et des rôles est une **surface distincte**, montée sous
`/api/admin/` plutôt que `/api/auth/`. La lecture nécessite le scope `users:read` et
la modification requiert `users:write`, à l'exception de la lecture restreinte du sélecteur d'utilisateurs ci-dessous. Un administrateur et la clé de service détiennent les deux ; il en va de même pour un
rôle qui les déclare. Nul ne peut modifier un compte disposant de plus de privilèges que
lui-même. Voir [Rôles et scopes](/docs/backend/roles-and-scopes/).

| Méthode | Chemin | Description |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Lister les utilisateurs (paginé). `?search=` correspond à une partie insensible à la casse de l'e-mail ou du nom d'affichage. Il correspond également à tout rôle attribué à l'utilisateur, ainsi qu'à l'uid |
| `GET` | `/api/admin/users/pick` | La lecture du sélecteur d'utilisateurs : `uid`, `displayName`, `email` et `photoURL` par utilisateur, rien d'autre. Prend en charge `?search=`, `?limit=` (25 par défaut) et `?offset=`, ou `?ids=a,b` pour les utilisateurs désignés par une valeur stockée. Répond à `users:read`, ainsi qu'à toute personne autorisée à écrire dans une collection dotée d'un champ [`userSelect`](/docs/collections/properties/) — afin qu'un éditeur puisse en renseigner un. Une règle écrite en SQL brut (`using` / `withCheck` que le modèle de stratégie ne peut pas lire) ne pouvant pas être évaluée à l'avance, elle compte ici comme un refus : sur une telle collection, seuls les détenteurs de `users:read` peuvent effectuer une sélection. Tous les autres reçoivent `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Créer un utilisateur. `invite: false` sans `password` le crée sans mot de passe et n'envoie rien |
| `POST` | `/api/admin/users/import` | Importer des comptes depuis un autre système, en conservant leurs identifiants. Voir [Importation de comptes](#importation-de-comptes) |
| `GET` | `/api/admin/users/:uid` | Lire un utilisateur |
| `PUT` | `/api/admin/users/:uid` | Mettre à jour un utilisateur. `{ disabled: true }` désactive le compte sans le supprimer : chaque connexion et rafraîchissement est refusé (`ACCOUNT_DISABLED`), ses sessions prennent fin et chaque jeton qu'il détient est refusé ; `false` le réactive |
| `DELETE` | `/api/admin/users/:uid` | Supprimer un utilisateur. Ses sessions prennent fin, et chaque jeton d'accès qu'il détient est refusé à compter de cette requête |
| `POST` | `/api/admin/users/:uid/reset-password` | Réinitialiser le mot de passe d'un utilisateur sans son mot de passe actuel. `rebase auth reset-password` l'appelle et n'écrit directement dans la base de données que lorsque le backend est inaccessible ; dans les deux cas, les sessions du compte prennent fin |
| `DELETE` | `/api/admin/users/:uid/mfa` | Supprimer les seconds facteurs et les codes de récupération d'un utilisateur, et mettre fin à ses sessions — pour une personne ayant perdu les deux |
| `GET` | `/api/admin/roles` | `admin` et les rôles déclarés par la table des utilisateurs, avec leurs scopes |
| `POST` | `/api/admin/bootstrap` | Permettre au premier utilisateur inscrit de revendiquer le rôle d'administrateur lorsqu'aucun n'existe. Refusé en production — voir [Initialisation du premier utilisateur](/docs/backend/authentication/#first-user-bootstrap) |

Tous les points de terminaison de l'API de données nécessitent un en-tête `Authorization: Bearer <token>` valide lorsque `requireAuth: true` (valeur par défaut).

### Importation de comptes

`POST /api/admin/users/import` crée des comptes qui existent déjà dans un autre
système, sous les identifiants qu'ils y possèdent, afin que chaque ligne qui en désigne
un continue de faire référence au même compte. Cela nécessite `users:write`, tout comme `POST /api/admin/users`.

```json
{
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "displayName": "Ada",
      "createdAt": "2024-05-02T08:30:00Z", "emailVerified": true, "roles": ["editor"] }
  ],
  "dryRun": false
}
```

Avec des empreintes de mot de passe (password hashes) :

```json
{
  "passwordHashAlgorithm": "bcrypt",
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "emailVerified": true,
      "passwordHash": "$2a$10$…" }
  ]
}
```

- **`id`** est conservé et reste optionnel. Un uuid est le cas d'usage courant ; tout identifiant composé
  de lettres, de chiffres et de `_ - . : |`, commençant par une lettre ou un chiffre, jusqu'à 128
  caractères, convient également (identifiants Firebase, Auth0, Clerk). `service`, `anonymous`,
  `anon` et `default` sont refusés, tout comme n'importe quelle autre valeur : `400 INVALID_ID` pour
  ce compte. Une table d'utilisateurs dont la colonne `id` est de type `uuid` n'accepte que des uuids.
- **`email`** est obligatoire. `displayName`, `photoUrl`, `createdAt` (ISO 8601) et
  `roles` sont optionnels ; `emailVerified` vaut `false` sauf s'il est renseigné. Un compte non vérifié
  est confirmé dès le premier lien magique ou e-mail de réinitialisation qu'il suit, et ne peut pas
  faire l'objet d'une connexion via un fournisseur d'ici là.
- **Aucun e-mail, et aucun mot de passe sauf si vous fournissez l'empreinte.** Aucun message n'est envoyé.
  Un champ `password` entraîne l'échec de ce compte. Un compte sans `passwordHash`
  se connecte par lien magique, code reçu par e-mail, fournisseur OAuth ou réinitialisation de mot de passe.
- **`passwordHash`** est l'empreinte stockée par l'autre système, prise en compte uniquement si la
  requête précise son format dans `passwordHashAlgorithm`. Il s'agit aujourd'hui de
  `"bcrypt"` (`$2a$`, `$2b$` ou `$2y$`) : ce que Supabase stocke dans
  `auth.users.encrypted_password`, et ce qu'Auth0, Clerk ainsi que la plupart des applications Rails,
  Laravel et Django-bcrypt enregistrent. Le compte se connecte alors avec le
  mot de passe qu'il possédait, et sa première connexion remplace l'empreinte par l'algorithme scrypt propre
  à Rebase, sans fermer les autres sessions. Une empreinte sans `passwordHashAlgorithm`,
  ou qui ne respecte pas ce format, fait échouer le compte concerné (`INVALID_INPUT`,
  `INVALID_PASSWORD_HASH`) ; l'empreinte n'est jamais renvoyée en réponse. Un projet disposant de ses
  propres hooks `hashPassword` ou `verifyPassword` conserve l'empreinte telle qu'importée, et
  son `verifyPassword` détermine ce qu'il accepte.
- **Rien n'est mis à jour.** Un compte dont l'identifiant est déjà pris est ignoré (`skipped`) avec
  `ID_EXISTS`, et un compte dont l'e-mail est déjà utilisé avec `EMAIL_EXISTS` (y compris un compte précédent
  dans la même requête). Exécuter le même import deux fois est sans danger.
- **Aucun rôle supérieur à celui de l'appelant**, comme sur `POST /api/admin/users`, et
  `beforeUserCreate` s'exécute pour chaque compte et peut le refuser.
- **Au maximum 100 comptes par requête** (`400 TOO_MANY_USERS` au-delà).
  `dryRun: true` exécute l'ensemble des vérifications sans rien écrire.

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

`rebase users import <file>` transmet un fichier CSV ou JSON de cette manière, par lots de 100 comptes
à la fois, et `client.admin.importUsers(users, { dryRun })` correspond à l'appel SDK équivalent.

### Politique de mot de passe

Un nouveau mot de passe nécessite au moins 8 caractères, avec une lettre majuscule, une
lettre minuscule et un chiffre. L'inscription, la réinitialisation et la modification refusent tout mot de passe
non conforme avec l'erreur `400 WEAK_PASSWORD`, en énumérant chaque règle enfreinte, tout comme un
administrateur qui choisit un mot de passe : `POST /api/admin/users`, une création sur la
table des utilisateurs via l'API de données (`POST /api/data/users`, son `/bulk`, une
écriture par socket ou MCP), `PUT /api/admin/users/:uid` et
`POST /api/admin/users/:uid/reset-password`. Sur un `/bulk`, le message commence par
`Row <n>: ` (numéroté à partir de 0), à l'image des autres erreurs de ligne d'une opération groupée.

Pour créer des comptes dont les mots de passe ont été définis par un autre système, comme lors d'une importation, transmettez
`skipPasswordPolicy: true` dans le corps de création (sur chaque ligne d'un `/bulk`). Le
serveur ne l'honore que pour un administrateur ou la clé de service ; pour tout
autre appelant, aucune dérogation n'est accordée et le refus l'indique explicitement. Ce paramètre n'est jamais stocké. L'import
du panneau d'administration l'envoie pour chaque ligne comportant un champ `password`. La connexion
ne vérifie jamais la politique, ce qui permet à un ancien mot de passe de continuer à fonctionner. Pour définir vos propres règles, transmettez
`auth.hooks.validatePasswordStrength` depuis un backend [éjecté](/docs/backend/authentication/#configuration).
Le premier administrateur initialisé à partir de `REBASE_ADMIN_PASSWORD` est soumis à une
règle différente : au moins 12 caractères, sans aucune autre restriction.

### Format de réponse

Chaque point de terminaison qui émet une session répond avec la même enveloppe — `register`,
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
`accessTokenExpiresAt` est exprimé en millisecondes epoch.

`POST /api/auth/refresh` répond avec la même enveloppe, à ceci près que `user` est
totalement omis lorsque le compte ne peut pas être relu ; traitez-le donc comme optionnel
dans ce contexte.

`providerId` indique le mode de connexion de la session : `password`, `anonymous`,
`magic-link`, `otp`, `mfa` (une connexion finalisée avec un second facteur), ou l'identifiant
du fournisseur, tel que `google`. Il est stocké avec la session au moment de la connexion, de sorte que
`refresh` et `GET /api/auth/me` renvoient la même réponse pendant toute la
durée de vie de la session. Une session ouverte avant la version 0.24 indique `password`.

:::caution[Le SDK typé aplatit cette enveloppe — le protocole HTTP brut ne le fait pas]
Le JSON ci-dessus représente le format réseau, et c'est ce que `fetch("/api/auth/login")`
renvoie : le jeton se situe au niveau de **`body.tokens.accessToken`**.

Le [SDK typé](/docs/sdk/authentication) désencapsule `tokens` avant de restituer
la session, si bien que `auth.signInWithEmail()` renvoie à la place une structure aplatie
**`{ user, accessToken, refreshToken }`**.

Ces deux formats existent réellement ; ils appartiennent à deux couches distinctes. Lire la structure
du SDK directement depuis un appel `fetch` brut renvoie `undefined`, ce qui se traduit par un message du type « connexion réussie
mais il n'y a pas de jeton d'accès » — la connexion a bien réussi, le jeton se trouvait simplement un niveau plus bas.
:::

### Modification d'une adresse e-mail

Un utilisateur connecté
transfère son propre compte vers une autre adresse en deux étapes :

1. `POST /api/auth/change-email { newEmail }` enregistre le changement et envoie un
   lien, `<frontend>/confirm-email-change?token=…`, à la nouvelle adresse, ainsi qu'une
   notification sans lien à l'adresse actuelle. Le lien reste valide 24 heures, et une
   nouvelle demande remplace la précédente. `GET /api/auth/me` signale l'adresse en
   attente sous le champ `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` effectue le transfert du compte : la nouvelle
   adresse devient son adresse officielle, vérifiée. Chaque identité OAuth dont le fournisseur
   garantissait l'ancienne adresse est détachée (`removedProviders` les énumère),
   car quiconque contrôle l'ancienne adresse pourrait sinon continuer à se connecter
   par son biais, et tout lien de réinitialisation envoyé à l'ancienne adresse cesse de fonctionner.
   Les sessions sont conservées.

La nouvelle adresse n'est pas réservée pendant que le lien est en attente : la bloquer permettrait
à n'importe quel compte d'empêcher un inconnu de s'inscrire avec sa propre adresse. Si un autre
compte s'est approprié l'adresse avant que le lien ne soit suivi, le lien répond
`409 EMAIL_EXISTS` et rien n'est déplacé ; entre deux comptes demandant la même
adresse, le premier à suivre son lien l'obtient. Le hook `beforeEmailChange` peut
refuser une adresse, à l'image de ce que fait `beforeUserCreate` lors de l'inscription.

Dans le CMS, l'adresse se modifie depuis **Paramètres du compte → Profil**, et le
lien ouvre l'écran propre au CMS, que l'on soit connecté ou non. Un autre frontend sert une page
à l'adresse `/confirm-email-change` qui appelle la route avec le jeton du lien.

Lorsque [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) est activé (comportement par défaut), le jeton
de rafraîchissement transite dans un cookie `httpOnly` et `tokens.refreshToken` est une chaîne
vide dans le corps de réponse. Le jeton d'accès n'est pas affecté.

### Authentification multifacteur (TOTP)

**Un second facteur conditionne la connexion, et non de simples opérations individuelles.** Dès lors
qu'un compte possède un facteur TOTP *vérifié*, aucune route ne lui délivre de session tant qu'un
code n'a pas été présenté — la connexion par mot de passe, chaque fournisseur OAuth, le lien magique, le code
reçu par e-mail et la liaison de compte anonyme échouent tous avec l'erreur `401 MFA_REQUIRED` :

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
et est rejeté par toutes les routes authentifiées. Transmettez-le en tant que jeton porteur à
`POST /api/auth/mfa/challenge` (avec un `factorId`), puis à
`POST /api/auth/mfa/challenge/verify` (avec le `challengeId` et le code à six chiffres,
ou un code de récupération). C'est ce dernier appel qui délivre les jetons d'accès et de rafraîchissement,
au niveau `aal2` ; ce niveau est stocké sur la session et conservé à travers
`POST /api/auth/refresh`.

L'enregistrement est lui aussi contrôlé. Le premier facteur d'un compte peut être configuré depuis
une session ordinaire, mais dès lors qu'un facteur est vérifié, `enroll`, `verify` et `unenroll`
nécessitent tous une session `aal2` — dans le cas contraire, un mot de passe dérobé permettrait d'enregistrer
son propre facteur, de monter en privilèges avec celui-ci et de supprimer le véritable facteur.

La vérification est limitée selon deux critères : un challenge expire après cinq tentatives
infructueuses, chaque compte est limité à dix tentatives de vérification par tranche de 15 minutes
(comptabilisées par utilisateur, de sorte qu'alterner les adresses IP est inefficace), et un code accepté est
enregistré pour le facteur concerné afin qu'il ne puisse pas être rejoué pendant le reste de sa
fenêtre de tolérance de ±1 pas de temps.

Dans la table des utilisateurs du CMS, **Réinitialiser la validation en deux étapes**
(`DELETE /api/admin/users/:uid/mfa`) et **Désactiver ou activer le compte**
(`PUT /api/admin/users/:uid { disabled }`) sont proposés à toute personne détenant
`users:write`, à l'instar des routes correspondantes ; l'interrupteur n'est jamais proposé pour votre propre
compte, et une tentative sur un compte ayant un rang supérieur au vôtre est refusée avec le motif du serveur.

Définissez `MFA_ENCRYPTION_KEY` (au moins 32 caractères aléatoires) pour chiffrer les secrets TOTP
stockés. En son absence, le serveur bascule sur `JWT_SECRET` en émettant un avertissement. Définissez-la
**avant** toute inscription : les secrets enregistrés ne comportent aucun identifiant de clé, si bien que modifier la clé
ultérieurement rend les facteurs existants indéchiffrables et empêche leurs propriétaires de
valider un challenge.

### Inviter des collaborateurs par e-mail

Les flux d'invitation nécessitent de convertir une adresse e-mail en identifiant utilisateur, mais la table
`users` est protégée par RLS vis-à-vis du client. Au lieu de concevoir manuellement une
fonction d'administration côté serveur, activez la recherche intégrée :

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

Le point de terminaison est **strictement authentifié** et ne renvoie que `uid`, `displayName`,
et `photoURL` — jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur recherché. Il est
**désactivé par défaut** car il permet à n'importe quel utilisateur connecté de sonder quelles adresses e-mail disposent
d'un compte ; ne l'activez que si l'expérience utilisateur de vos invitations l'exige.

## Contexte de base de données pour la sécurité au niveau des lignes (RLS)

Rebase fait directement le lien entre l'authentification des requêtes et la sécurité au niveau des lignes (RLS) de PostgreSQL. Chaque requête de base de données exécutée au travers d'un pilote lié à l'utilisateur s'exécute au sein d'une transaction de base de données (`db.transaction()`) qui définit des paramètres de configuration locaux à la transaction :

*   `app.uid` — L'identifiant unique de l'utilisateur authentifié (`uid`). Défini par défaut sur `'anonymous'` pour les requêtes non authentifiées. La version antérieure au renommage, `app.user_id`, continue d'être écrite à ses côtés, pour les stratégies compilées avant ce changement.
*   `app.user_roles` — Une chaîne de caractères séparés par des virgules listant les rôles attribués à l'utilisateur.
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

### Fonctions d'assistance pour les stratégies PostgreSQL

Afin de simplifier l'écriture des stratégies de sécurité au niveau des lignes, Rebase crée des fonctions d'assistance au sein du schéma `rebase` lors de l'initialisation de la base de données :

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
*   **`rebase.jwt()`** — Renvoie l'intégralité de la charge utile (payload) du JWT sous la forme d'un objet `jsonb` :
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.is_anonymous()`** — Indique si l'appelant est un invité, sous forme de `boolean` (`false` lorsqu'il n'est pas défini), afin qu'une stratégie puisse spécifier `NOT rebase.is_anonymous()`.

Vous pouvez utiliser ces fonctions d'assistance directement dans vos règles de sécurité personnalisées ou vos migrations de base de données :
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Jetons asymétriques et JWKS

Par défaut, les jetons d'accès sont signés avec `jwtSecret` (HS256). Ce fonctionnement convient, mais implique
que tout élément devant *vérifier* un jeton doit détenir la clé qui l'*émet*
— ainsi, une passerelle ou un edge worker contrôlant une session est également en mesure d'en fabriquer une de toutes pièces — et
modifier le secret a pour effet de déconnecter instantanément tous les utilisateurs.

Configurez une clé de signature et Rebase signera à la place les jetons d'accès de manière asymétrique,
en publiant la composante publique sur **`/.well-known/jwks.json`** afin que quiconque puisse
effectuer une vérification :

```typescript no-verify
auth: {
    jwtSecret: process.env.JWT_SECRET,
    signingKeys: [
        { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY! }
    ]
}
```

Ou directement depuis l'environnement, pour une clé unique :

```bash
JWT_PRIVATE_KEY="$(cat jwt-key.pem)"
JWT_KEY_ID=2026-08
```

Générez une clé avec :

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

Les clés RSA fonctionnent également et signent en `RS256` ; les clés EC P-256 signent en `ES256`. Seule la clé
privée est configurée — la composante publique en est dérivée, ce qui empêche toute discordance
au sein de la paire. `jwtSecret` reste requis dans tous les cas : il continue de signer
les jetons dédiés à des usages restreints (liens de téléchargement, MFA en attente, réinitialisation de mot de passe) que
seul ce serveur est amené à lire.

### Rotation d'une clé

Placez la nouvelle clé en première position et conservez l'ancienne dans la liste. Les nouveaux jetons sont signés à l'aide de la
nouvelle clé ; les jetons déjà en circulation continuent d'être validés avec l'ancienne jusqu'à
leur expiration, évitant ainsi toute déconnexion intempestive.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Une fois écoulée la durée de vie maximale des jetons d'accès, supprimez l'ancienne entrée. Utilisez
`activeKid` si vous souhaitez publier une clé avant de l'employer pour la signature.

### Vérification ailleurs

Les jetons intègrent le `kid` de la clé de signature dans leur en-tête, ce qui permet à un vérificateur
de sélectionner la bonne clé au sein du JWKS et de savoir quand procéder à une nouvelle récupération après
une rotation. N'importe quelle bibliothèque standard effectue cette opération automatiquement — par exemple, avec `jose` :

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Si aucune clé n'est configurée dans `signingKeys`, `/.well-known/jwks.json` renvoie
`{"keys":[]}` et les jetons restent signés en HS256. Rien ne change tant que vous n'ajoutez pas de clé.
:::

## Authentification par clé de service

Pour la communication entre serveurs (par exemple, tâches cron, services externes), configurez une clé de service statique :

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Les clients s'authentifient au moyen de l'en-tête `Authorization: Bearer <service-key>`.

### Clé interne générée à chaque démarrage

Si `REBASE_SERVICE_KEY` n'est pas renseignée dans votre configuration, Rebase génère automatiquement une **clé interne aléatoire à chaque démarrage**.

Cette clé n'est jamais journalisée et ne quitte jamais le processus en cours. Elle est utilisée par le singleton `rebase` pour s'authentifier auprès des API du plan de contrôle du serveur lui-même (authentification, stockage, etc.). Cela garantit que les tâches administratives (telles que l'envoi d'un e-mail de bienvenue ou la génération d'une URL de stockage) fonctionnent toujours de manière opérationnelle en développement et en production, sans nécessiter de gestion manuelle des clés.

### Protection contre les attaques temporelles et exigences relatives aux clés

Afin d'empêcher les attaques temporelles (timing attacks), Rebase valide la clé de service configurée par l'utilisateur ainsi que la clé interne à l'aide d'une comparaison de chaînes en temps constant (`safeCompare`). La clé de service définie par l'utilisateur **doit comporter au moins 32 caractères** ; si une clé de moins de 32 caractères est configurée, Rebase lèvera une erreur de configuration dès le démarrage et adoptera un comportement de fermeture sécurisée (fail-closed).

## Prochaines étapes

- **[Authentification](/docs/backend/authentication/)** — la configuration dont sont issues ces routes
- **[Adaptateurs d'authentification personnalisés](/docs/backend/auth-adapters/)** — remplacer le fournisseur sous-jacent
- **[Règles de sécurité (RLS)](/docs/collections/security-rules/)** — ce qu'une stratégie réalise avec `rebase.uid()`
- **[Authentification avec le SDK typé](/docs/sdk/authentication/)** — appeler ces routes depuis le SDK
