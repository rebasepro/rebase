---
sourceHash: 87457f19450dd976
title: Codes d'erreur
sidebar_label: Codes d'erreur
description: Tous les codes d'erreur qu'un backend Rebase peut renvoyer, avec leur statut HTTP, leur signification et la marche à suivre — ainsi que l'enveloppe de réponse, X-Request-ID et les règles applicables aux détails.
---

Chaque échec renvoyé par un backend Rebase utilise une enveloppe unique et comporte un `code` stable. C'est sur ce code qu'il faut brancher la logique : le message est rédigé pour un humain et peut être reformulé, le statut est partagé par une douzaine de problèmes différents, et le code n'est ni l'un ni l'autre.

## L'enveloppe

```json
{
  "error": {
    "message": "Schema drift: table \"posts\" does not exist.",
    "code": "SCHEMA_DRIFT",
    "details": { "dbCode": "42P01" },
    "requestId": "6f1b2f3e-8a0c-4d1b-9c3e-2a5b7c9d1e0f"
  }
}
```

- **`message`** — lisible par un humain. Pour une erreur `4xx`, il s'agit du propre message du serveur ; pour une erreur `5xx`, il est délibérément générique, car le texte sous-jacent peut citer un hôte, un rôle ou un nom de colonne.
- **`code`** — l'une des valeurs ci-dessous. Stable d'une version mineure à l'autre.
- **`details`** — facultatif, et jamais garanti. Voir les règles ci-dessous.
- **`requestId`** — présent dès lors que la requête est passée par le middleware de request-ID, ce qui est le cas de chaque route sous `basePath`.

### `X-Request-ID`

Chaque requête sous `basePath` reçoit un identifiant : l'en-tête `X-Request-ID` de l'appelant lorsqu'il s'agit d'un UUID v4 valide, ou un nouvel identifiant dans le cas contraire. Il est renvoyé dans la réponse sous le nom `X-Request-ID`, inclus dans l'enveloppe d'erreur en tant que `requestId`, et associé à la ligne de log du serveur pour cette requête.

Il s'agit de la clé de jointure. Mentionnez-la dans un rapport de bug et un opérateur pourra retrouver la ligne de journalisation exacte qui explique l'échec, révélant la raison qui n'a jamais été montrée au client.

Envoyer le vôtre permet à une trace de traverser les sauts réseau : une passerelle ou un gestionnaire de tâches qui relaie l'en-tête conserve un ID unique à travers tous les services ayant traité la requête. Une valeur invalide est ignorée plutôt que rejetée — un en-tête malformé provenant d'un appelant ne justifie pas l'échec d'une requête — ne supposez donc pas que l'ID envoyé correspond nécessairement à l'ID reçu. Consultez l'en-tête de réponse.

### Ce que contient `details`

`details` est diagnostique, non contractuel. Trois règles l'encadrent :

1. **Tout ce qu'une route définit explicitement est toujours renvoyé.** Il s'agit des erreurs de l'appelant décrites précisément : quel champ de filtre était inconnu, quelle relation n'est pas modifiable, quelle valeur ne correspondait pas à son type.
2. **Les diagnostics de base de données sont épurés en production.** Lorsque l'erreur provient de Postgres, `details.dbCode` — le SQLSTATE — est toujours présent : il indique la classe de problème sans rien révéler sur les données. `dbMessage`, `detail` et `hint` ne sont ajoutés que lorsque `NODE_ENV` n'est pas `production`, car Postgres y insère le contenu des lignes. Le code `23505` indique `Key (email)=(a@b.c) already exists.`, ce qui permettrait de savoir « cette personne est-elle inscrite ? » pour n'importe quelle adresse testée.
3. **Ne branchez jamais de logique conditionnelle sur `details`.** Branchez-la sur `code`. Le contenu de `details` correspond à ce qui était utile à un humain à cet endroit précis de l'appel, et il est sujet à changement.

## Interpréter un statut

| Statut | Ce qu'il indique sur la requête |
| --- | --- |
| `400` | Malformée, ou demandant un élément inexistant dans le schéma. Corrigez la requête. |
| `401` | Non authentifiée, ou identifiants/jeton expirés. Connectez-vous ou actualisez la session. |
| `403` | Authentifiée, mais non autorisée. Réessayer avec la même identité ne changera rien. |
| `404` | Route, collection ou ligne introuvable — ou ligne masquée par la sécurité au niveau des lignes (RLS). |
| `409` | Conflit avec l'état existant : un doublon ou une écriture concurrente. |
| `413` `415` `422` | Corps de requête trop volumineux, mauvais type de média ou rejeté sémantiquement. |
| `429` | Limite de débit atteinte. Ralentissez ; le message indique pour combien de temps. |
| `500` | Le serveur ou sa base de données est en défaut, pas l'appelant. Consultez les logs. |
| `501` | La route existe, mais ce déploiement ne peut pas la servir — fonctionnalité désactivée ou non configurée. |
| `502` `503` `504` | Une dépendance était inaccessible, non configurée ou trop lente. |

## Authentification et comptes

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route nécessite un second facteur et la session n'en a qu'un. | Complétez le challenge MFA, puis réessayez. |
| `ALREADY_VERIFIED` | 400 | L'adresse ou le facteur est déjà vérifié. | Rien — l'état souhaité est déjà atteint. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Le compte modifié, réinitialisé ou supprimé détient un rôle ou une portée que l'appelant ne détient pas. `details.beyond` les nomme. | Faites effectuer la modification par quelqu'un qui les détient. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | La connexion anonyme est désactivée sur ce serveur. | Activez-la ou connectez-vous avec une véritable identité. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Une clé API a tenté de lister, créer, modifier ou révoquer des clés API, de son propre type ou personnelles. | Gérez les clés en tant que personne qui détient `keys:write`, ou avec la clé de service. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Une route protégée a été exécutée sans middleware d'authentification Rebase en amont ; les identifiants n'ont donc jamais été vérifiés. | Montez l'application via le routeur de fonctions plutôt que directement sur votre propre serveur. |
| `BOOTSTRAP_ANONYMOUS` | 403 | L'initialisation du premier administrateur a été tentée par un appelant anonyme. | Connectez-vous d'abord. |
| `BOOTSTRAP_COMPLETED` | 403 | Le premier administrateur existe déjà. | Demandez à un administrateur existant d'accorder le rôle. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | L'initialisation est réservée au tout premier utilisateur, ce qui n'est pas le cas ici. | Demandez à un administrateur existant d'accorder le rôle. |
| `CAPTCHA_FAILED` | 400 | Le fournisseur a rejeté le jeton CAPTCHA. | Résolvez un nouveau défi CAPTCHA. |
| `CAPTCHA_REQUIRED` | 400 | La route requiert un jeton CAPTCHA et aucun n'a été envoyé. | Incluez le jeton. |
| `CHALLENGE_EXHAUSTED` | 401 | Trop de codes erronés saisis pour un même challenge MFA. | Démarrez un nouveau challenge. |
| `EMAIL_EXISTS` | 409 | Un compte avec cette adresse existe déjà — à l'inscription, lors d'un changement d'adresse, et en suivant un lien de changement d'adresse quand un autre compte a pris l'adresse pendant l'attente. | Connectez-vous ou lancez une réinitialisation de mot de passe ; pour un changement d'adresse, choisissez-en une autre. |
| `EMAIL_NOT_CONFIGURED` | 503 | Des liens magiques ou OTP ont été demandés, mais le serveur n'a pas de service d'envoi d'e-mails. | Configurez SMTP ou utilisez une autre méthode de connexion. |
| `EMAIL_NOT_VERIFIED` | 403 | Le compte existe et son adresse n'est pas vérifiée. | Vérifiez l'adresse. |
| `FACTOR_NOT_VERIFIED` | 400 | Le facteur MFA a été enregistré mais jamais confirmé. | Confirmez le facteur. |
| `IDENTITY_ALREADY_LINKED` | 409 | Cette identité OAuth appartient à un autre compte. | Connectez-vous avec celle-ci, ou dissociez-la d'abord de l'autre compte. |
| `IMPERSONATION_FORBIDDEN` | 403 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Une requête a envoyé `x-rebase-impersonate` et son appelant ne peut pas exécuter une requête en tant qu'un autre utilisateur. Seule la session propre d'un administrateur connecté le peut, jamais une clé d'API ni la clé de service. | Envoyez-la avec la session d'un administrateur, ou retirez l'en-tête. |
| `IMPERSONATION_INVALID` | 400 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> `x-rebase-impersonate` a été envoyé vide. | Envoyez l'uid de l'utilisateur au nom duquel agir, ou retirez l'en-tête. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> `x-rebase-impersonate` ne désigne aucun utilisateur actif : aucun compte n'a cet uid, ou il est désactivé. | Vérifiez l'uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> L'authentification de ce backend ne peut pas exécuter une requête en tant qu'un autre utilisateur, car son `AuthAdapter` n'a pas de `resolveUser`. | Implémentez `resolveUser` dans l'adaptateur, ou retirez l'en-tête. |
| `INVALID_ACCOUNT` | 400 | Le compte est dans un état qui ne permet pas cette opération. | Voir le message d'erreur. |
| `INVALID_CHALLENGE` | 400 | Le challenge MFA est inconnu ou expiré. | Démarrez-en un nouveau. |
| `INVALID_CODE` | 400 / 401 | Le code OTP ou MFA est incorrect : 400 pour la connexion par code e-mail (`/auth/otp/verify`), 401 pour un enrôlement ou un challenge MFA. | Réessayez avec le code actuel. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou mot de passe incorrect — sans préciser délibérément lequel. | Réessayez ou réinitialisez le mot de passe. |
| `INVALID_SCOPES` | 400 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> La demande de clé contient quelque chose qui n'est pas une portée : malformée, inconnue, ou avec une cible que la portée n'accepte pas. `details.problems` indique laquelle et pourquoi ; `details.validScopes` les liste toutes. | Utilisez un nom de la liste. Voir [Rôles et portées](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un jeton de vérification, de réinitialisation, de lien magique ou de changement d'adresse est malformé, inconnu, déjà consommé ou expiré (400). Un identifiant de fournisseur OAuth ou un refresh token qui ne se vérifie pas donne un 401. | Demandez un nouveau lien, ou reconnectez-vous. |
| `KEY_MANAGEMENT_SCOPE` | 400 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> La demande de clé contient `keys:read` ou `keys:write`. Aucune clé ne peut gérer des clés. `details.scopes` les nomme. | Retirez-les. |
| `LAST_ADMIN` | 403 | Cette modification laisserait le projet sans aucun administrateur. | Désignez un autre administrateur au préalable. |
| `MFA_REQUIRED` | 401 | Le mot de passe était correct et le compte dispose d'un second facteur vérifié ; la connexion n'est donc qu'à moitié terminée. `details` contient un jeton éphémère limité au challenge MFA — il ne s'agit pas d'une session. | Ouvrez un challenge et répondez-y ; la réponse au challenge délivre la session. |
| `NO_SESSION` | 401 | Aucun cookie de session ni jeton de rafraîchissement n'a été fourni. Normal lors du premier chargement de page. | Connectez-vous. |
| `NOT_ANONYMOUS` | 400 | Une route de conversion de compte anonyme a été appelée par un vrai compte. | Rien à convertir. |
| `OAUTH_ERROR` | 401 | Le fournisseur OAuth a refusé la demande ou a renvoyé une erreur. | Réessayez le flux ; le message contient la raison fournie par le fournisseur. |
| `PERSONAL_KEYS_DISABLED` | 403 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Les clés API personnelles sont désactivées sur ce backend. | Définissez `personalKeys: true` dans le bloc `auth` de la collection des utilisateurs. |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> La clé de service ou une session invité a tenté d'utiliser les routes des clés personnelles. Aucune des deux n'a de compte au nom duquel une clé pourrait agir. | Connectez-vous à un compte, ou créez une clé de service sous `/api/admin/api-keys`. |
| `RATE_LIMITED` | 429 | Trop de tentatives effectuées par cet appelant. | Ralentissez la cadence ; le message indique pendant combien de temps. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | L'URI de redirection ne figure pas sur la liste autorisée. | Ajoutez-la dans la configuration du fournisseur. |
| `REGISTRATION_DISABLED` | 403 | L'inscription en libre-service est désactivée. | Demandez à un administrateur de créer le compte. |
| `ROLE_EXCEEDS_CALLER` | 403 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Les rôles accordés détiennent une portée, ou `admin`, que l'appelant ne détient pas. `details.beyond` les nomme. | Faites accorder le rôle par quelqu'un qui les détient. |
| `ROLE_EXCEEDS_CREATOR` | 403 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Une clé de service a reçu un rôle RLS que son créateur ne détient pas. Seul un administrateur peut donner n'importe quel rôle. `details.roles` les nomme. | Retirez le rôle, ou faites créer la clé par un administrateur. |
| `ROLE_EXISTS` | 409 | Ce nom de rôle est déjà pris. | Choisissez un autre nom. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossible de lire les rôles de l'appelant — sur une route d'administration, ou sur une requête de données d'un backend avec `config.auth`. Échoue par sécurité plutôt que de faire confiance aux rôles du jeton. | Réessayez ; vérifiez la base de données. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> La demande de clé contient une portée que son créateur ne détient pas. Une clé ne détient jamais plus que le compte qui la crée. `details.scopes` les nomme. | Retirez-les, ou faites créer la clé par quelqu'un qui les détient. |
| `SCOPE_MISSING` | 403 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> L'identifiant ne détient pas la portée qu'exige cette route, cette collection, cette source de stockage ou cette fonction. `details.requiredScope` la nomme, cible comprise. | Pour une personne, un rôle qui déclare la portée. Pour une clé, une clé qui la détient. Voir [Rôles et portées](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un administrateur a tenté de supprimer son propre compte. | Demandez à un autre administrateur de le faire. |
| `SESSION_REVOKED` | 401 | La session a été déconnectée ailleurs, ou toutes les sessions ont été révoquées, ou le compte a été supprimé. | Reconnectez-vous. |
| `ACCOUNT_DISABLED` | 401/403 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Un administrateur a désactivé le compte : la connexion (403), le rafraîchissement et tous les jetons qu'il détient (401) sont refusés. | Adressez-vous à un administrateur. |
| `EMAIL_NOT_CONFIRMED` | 403 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> `requireEmailVerification` est activé et l'adresse n'est pas encore vérifiée. Répondu uniquement pour un mot de passe correct ; un nouveau lien est envoyé par e-mail. | Suivez le lien reçu par e-mail. |
| `PROOF_REQUIRED` | 409 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> `POST /auth/verify-email` : le compte détient un mot de passe ou une identité que personne n'a prouvé, et la requête ne prouve ni l'un ni l'autre. Le jeton n'est pas consommé. | Envoyez `password` pour le conserver, ou `removeUnproven: true` pour vérifier sans lui. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Un e-mail de vérification a été demandé pour une adresse que le courrier ne peut pas atteindre — celle d'un invité, ou le placeholder de X (400) — ou un compte a demandé à basculer sur une telle adresse (409, `POST /auth/change-email`). | Définissez d'abord une véritable adresse. |
| `EMAIL_UNCHANGED` | 400 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> `POST /auth/change-email` a nommé l'adresse actuelle du compte. | Rien à changer. |
| `ANONYMOUS_USER` | 403 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Un invité a demandé à changer son adresse e-mail ; un invité n'en a aucune qui lui soit propre. | Transformez-le d'abord en compte (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Des codes de récupération ont été demandés pour un compte sans second facteur vérifié. | Enrôlez d'abord un facteur. |
| `HOOK_REJECTED` | 400 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` ou `beforeEmailChange` a levé une exception. Le message est celui du hook ; un hook qui a choisi un statut 4xx répond avec celui-ci. | Voir le message. |
| `INVALID_JSON` | 400 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Le corps de la requête n'est pas du JSON. | Envoyez un corps JSON. |
| `SELF_DISABLE` | 400 | Un administrateur a tenté de désactiver son propre compte. | Demandez à un autre administrateur. |
| `NOT_SUPPORTED` | 501 | Le dépôt d'authentification de ce backend ne peut pas faire ce qui a été demandé (désactiver des comptes, changer une adresse). | Redémarrez le serveur pour que la colonne soit ajoutée, ou utilisez un dépôt qui le prend en charge. |
| `UNKNOWN_SCOPE_TARGET` | 400 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> La cible d'une portée nomme une collection, une source de stockage ou une fonction que ce backend ne sert pas. `details` liste celles qu'il sert. | Corrigez la cible. |
| `UNVERIFIED_IDENTITIES` | 409 | Un lien magique, un code par e-mail ou une réinitialisation du mot de passe a prouvé l'adresse d'un compte non vérifié, et ce compte porte une identité de connexion dont le fournisseur n'a jamais vérifié cette adresse. Le dépôt d'authentification ne peut pas la supprimer (il n'a pas `unlinkUserIdentity`), donc la preuve est refusée plutôt que de laisser ce moyen d'accès sur un compte vérifié. | Implémentez `unlinkUserIdentity` dans le dépôt d'authentification personnalisé, ou faites examiner le compte par un administrateur. |
| `SETUP_REQUIRED` | 403 | Le projet n'a pas encore d'administrateur ; cette route n'est donc pas disponible. | Terminez la configuration du premier administrateur. |
| `TOKEN_ALREADY_USED` | 401 | Un jeton à usage unique a été rejoué, ou un refresh token qui a été remplacé par rotation il y a plus de `refreshTokenReuseIntervalSeconds`. | Demandez-en un nouveau, ou reconnectez-vous. |
| `TOKEN_EXPIRED` | 401 | Le jeton a dépassé sa durée de validité. | Demandez-en un nouveau. |
| `USER_NOT_FOUND` | 404 | Aucun compte avec cet identifiant. | Vérifiez l'identifiant. |
| `WEAK_PASSWORD` | 400 | Le mot de passe ne respecte pas la politique configurée. | Choisissez un mot de passe plus robuste. |

## Données, requêtes et écritures

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Ce pilote ne sait pas calculer l'agrégat demandé. | Utilisez un pilote compatible ou calculez-le côté client. |
| `BRANCHING_UNSUPPORTED` | — | Une branche de base de données a été demandée via la websocket Studio sur la base de développement gérée (PGlite), où une branche *est* le parent et rien ne serait isolé. Le refus est identique à celui affiché par `rebase db branch`. | Pointez `DATABASE_URL` vers votre propre instance Postgres (`rebase dev --docker` en lance une) et branchez là-bas. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contient plus d'opérations que la limite autorisée par lot (1000 par défaut). Un lot correspond à une transaction unique et conserve ses verrous pendant toute sa durée. | Envoyez-le par morceaux ; le message indique la limite et votre total. |
| `BATCH_UNSUPPORTED` | 400 | Le pilote de ce backend ne peut pas écrire sur plusieurs collections de manière atomique, et une boucle d'écritures individuelles ne serait ni atomique ni exécutée en un seul aller-retour. | Envoyez les écritures sous forme de requêtes séparées, ou via des appels `/bulk` par collection. |
| `BULK_TOO_LARGE` | 400 | Le corps de la requête en masse dépasse la limite d'éléments configurée. | Fractionnez la requête. |
| `BULK_UNSUPPORTED` | 400 | Cette collection ou ce pilote ne prend pas en charge les écritures en masse. | Écrivez les lignes une par une. |
| `CALLBACK_REJECTED` | 400 | Un callback de collection a refusé l'écriture. Une exception (`throw`) levée depuis `beforeSave`/`beforeDelete`/`after*` renvoie un 400 avec le message rédigé par l'auteur ; un `beforeDelete` renvoyant `false` produit un 403. `details.stage` indique le callback en cause, `details.path` la collection. | Lisez le message — il a été rédigé pour ce projet, pas par Rebase. |
| `CALLBACK_RECURSION` | 500 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Des écritures déclenchées par des hooks imbriqués sur plus de 16 niveaux : l'écriture `context.data` d'un hook exécute à nouveau les hooks de cette collection, et rien dans la chaîne ne l'arrête — généralement un `afterSave` qui met à jour sa propre ligne sans condition. L'écriture entière a été annulée. Le message nomme le hook et la collection ; `details.chain` liste chaque étape hook → écriture. | Rendez l'écriture du hook conditionnelle : agissez seulement sur `status === "new"`, ou ignorez-la quand `values` porte déjà ce qu'elle écrirait. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` a été combiné avec `?offset=` ou `?page=`. Un curseur indiquant déjà où commence la page, appliquer un offset par-dessus saute silencieusement autant de lignes après le curseur — créant un décalage invisible pour l'appelant dans la réponse. | Utilisez l'un ou l'autre. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` a été combiné avec une recherche textuelle ou vectorielle. Les deux attribuent un score par ligne, de sorte qu'aucune paire de lignes n'est jamais égale et `DISTINCT` ne fusionnerait rien — cela semblerait fonctionner sans rien changer. | Retirez l'un des deux paramètres. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Une lecture avec `distinct` est triée par une colonne qu'elle ne renvoie pas. Un `SELECT DISTINCT` ne peut être ordonné que par les colonnes présentes dans sa liste de sélection, sinon les lignes fusionnées n'ont pas d'ordre défini. `details.fields` liste les colonnes concernées. | Ajoutez ces champs à `?fields=`, ou retirez-les de `?orderBy=`. |
| `DB_CONNECT_TIMEOUT` | 503 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> L'ouverture d'une nouvelle connexion à la base de données a pris plus longtemps que `DB_POOL_CONNECT_TIMEOUT` : la base de données est lente à accepter des connexions, ou éloignée. Envoyé avec `Retry-After`. | Réessayez ; le SDK le fait. Vérifiez la charge de la base de données et le réseau qui y mène. |
| `DB_PERMISSION_DENIED` | 500 | Postgres a refusé l'instruction (`42501`) : soit en raison d'une politique RLS rejetant ce rôle, soit à cause d'un `GRANT` manquant. | Voir le guide de [Dépannage](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Chaque connexion du pool est restée occupée pendant `DB_POOL_CONNECT_TIMEOUT`, si bien que cette requête n'a jamais atteint la base de données. De la charge, pas une panne ; envoyé avec `Retry-After`. Le serveur journalise le remède une fois par minute. | Réessayez ; le SDK le fait. Augmentez `DB_POOL_MAX`, ou trouvez les requêtes lentes ou les transactions longues qui retiennent des connexions. |
| `FIELD_NOT_READABLE` | 400 | Un filtre, un `orderBy`, `fields`, un `select` d'agrégation ou un `groupBy` mentionne un champ inaccessible en lecture pour les rôles de cet appelant (`access.read`) — ou une opération de champ (`$inc`, `$push`, …) en cible un, auquel cas une borne refusée révélerait la valeur stockée. Un champ qu'aucune réponse ne peut contenir doit être inaccessible aux requêtes, faute de quoi la valeur deviendrait déductible prédicat par prédicat. `details.violations` indique chaque champ. | Retirez le champ de la requête ou obtenez le rôle requis. Voir [Accès aux champs](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Le corps de la requête définit un champ inaccessible en écriture pour les rôles de l'appelant (`access.write`). Refusé plutôt qu'ignoré : ignorer silencieusement un champ rapporterait un succès pour une modification non effectuée. Le même code refuse une écriture passant par un parent qui définit une relation que l'appelant ne peut pas écrire, ainsi qu'une mise à jour qui donne une valeur à un champ `softDelete` — seule une suppression le renseigne. `details.violations` nomme chaque champ. | Retirez le champ ou obtenez le rôle. Un champ que personne ne peut modifier répond plutôt `VALIDATION_EXCLUDED_FIELDS`. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Une requête précédente utilisant la même `Idempotency-Key` est toujours en cours d'exécution. | Réessayez une fois celle-ci terminée. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La même `Idempotency-Key` a été envoyée avec un corps de requête différent. | Utilisez une nouvelle clé ou envoyez le corps d'origine. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` a spécifié une fonction différente de `count`, `sum`, `avg`, `min` ou `max`. | Utilisez l'une de ces fonctions ; le message les énumère. |
| `INVALID_AGGREGATE_SELECT` | 400 | Une entrée de `?select=` n'est pas sous la forme `fn(field)`, ou une fonction autre que `count()` a été fournie sans champ. | Écrivez `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` ou `orderBy` sur un agrégat sans `groupBy`, ou un curseur sur n'importe quel agrégat. Un agrégat non groupé est une ligne, et un groupe n'est pas une ligne après laquelle un curseur peut reprendre. | Ajoutez `groupBy`, ou retirez-les ; paginez les groupes avec `offset` ou `page`. Voir [Agrégats](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Une opération `/_batch` omet `op`, `collection`, `values` ou `id`, nomme une collection non prise en charge, ou réutilise un nom de `ref`. | Voir le message ; il indique l'opération par son index. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` ne cible aucune opération antérieure, pointe vers l'avant ou demande un champ inexistant sur la ligne référencée. Seules les références arrière sont résolues. | Définissez l'opération avec `ref` *avant* de la référencer. |
| `INVALID_BULK_BODY` | 400 | Le corps de l'opération en masse ne respecte pas la structure attendue. | Envoyez le tableau `items` documenté. |
| `INVALID_CONFLICT_TARGET` | 400 | Le paramètre `on_conflict` / `onConflict` d'un upsert mentionne des colonnes sans garantie d'unicité, les mentionne sans `upsert: true`, ou est envoyé sur une création imbriquée, où une ligne trouvée passerait sous le nouveau parent. Postgres renverrait autrement l'erreur 42P10 au sein d'une transaction ayant déjà effectué des modifications. | Déclarez `validation: { unique: true }` ou un index `unique` ; le message liste les cibles existantes. |
| `INVALID_CURSOR` | 400 | Le curseur `after` est illisible, ou nomme un identifiant de ligne qui ne correspond pas aux colonnes clés de la collection : il a été tronqué, réencodé ou construit à la main. | Renvoyez tel quel le `meta.nextCursor` de la page précédente. Voir [Pagination](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` n'est ni `include` ni `only`. Refusé plutôt qu'ignoré : une coquille telle que `?deleted=true` masquant toutes les lignes supprimées semblerait fonctionner tout en produisant l'effet inverse. | Envoyez `include` (actives et supprimées) ou `only` (supprimées seules). Omettez-le pour les lignes actives uniquement. |
| `INVALID_DISTINCT` | 400 | `?distinct=` n'est ni `true` ni `false`. | Renseignez l'une de ces valeurs ; `1` et `0` sont également acceptés. |
| `INVALID_FIELD_OPERATION` | 400 | Un opérateur `$inc` / `$push` / `$pull` / `$merge` a été utilisé sur un type non compatible, avec un format d'opérande incorrect, avec deux opérateurs sur le même champ, avec une faute de frappe, ou lors d'une création (où aucune valeur existante ne peut être modifiée). | Voir [Écriture via REST](/docs/backend/writes/#field-operations) ; le message indique le champ. |
| `INVALID_FILTER_FIELD` | 400 | Le filtre indique une propriété inexistante dans cette collection. | Vérifiez l'orthographe par rapport à la collection. |
| `INVALID_FILTER_OPERATOR` | 400 | L'opérateur n'est pas pris en charge par ce type de propriété. | Voir [Interrogation des données](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Une valeur de filtre ne peut pas être convertie dans le type de la colonne ciblée : `?id=eq.abc` sur une clé entière, valeur absente d'un enum, horodatage invalide, nombre hors limites. `details.dbCode` contient le SQLSTATE. | Envoyez une valeur correspondant au type de la colonne. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` n'est ni `true` ni `false`. Toute autre valeur est refusée plutôt qu'interprétée comme « faux » — une faute de frappe entraînant une suppression réversible alors que l'appelant voulait une purge définitive lui ferait croire à tort que la donnée a disparu. | Renseignez `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` est malformé : chemin invalide ou imbrication dépassant la profondeur autorisée. Intercepté en bordure d'API plutôt que de laisser le pilote lever une 500. | Voir le message ; il indique le chemin en cause. |
| `INVALID_INPUT` | 400 | Le corps de la requête a échoué à la validation. | Voir le message. |
| `INVALID_LIMIT` | — | Une souscription en temps réel a demandé une limite hors plage autorisée. Livré sous forme de trame WebSocket `ERROR`, et non de réponse HTTP. | Réduisez la limite. |
| `INVALID_LOGICAL_GROUP` | 400 | Un groupe `?or=` / `?and=` est malformé ou imbriqué au-delà de la profondeur maximale. | Voir le message ; il illustre la règle d'aplatissement. |
| `INVALID_OFFSET` | 400 | `?offset=` n'est pas un entier supérieur ou égal à 0. | Envoyez un entier positif ou nul. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` n'est ni `field`, ni `field:desc`, ni un tableau JSON de `{ field, direction }`. | Voir le message ; il montre les trois syntaxes acceptées. |
| `INVALID_PAGE` | 400 | `?page=` n'est pas un entier supérieur ou égal à 1. La pagination commence à 1 ; `?page=0` est une erreur et non la première page. | Envoyez `1` ou plus, ou utilisez `?offset=`. |
| `INVALID_PARAM` | 400 | Un paramètre d'URL est malformé. | Voir le message. |
| `INVALID_VECTOR` | 400 | `?vector=` n'est pas un tableau JSON de nombres. | Envoyez `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` n'est ni `cosine`, ni `l2`, ni `inner_product`. | Utilisez l'une de ces trois options. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` n'est pas un nombre. | Envoyez un nombre. |
| `INVALID_WHERE` | 400 | `?where=` n'est pas un objet JSON associant des champs à des conditions. | Envoyez `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Une mise à jour nomme la clé de la ligne avec une valeur autre que celle à laquelle elle est adressée — dans le corps, ou écrite par un `beforeSave`. Une ligne ne peut pas se déplacer vers une autre clé : tout ce qui suit l'écriture (la relecture, `afterSave`, l'historique, le temps réel) l'adresse par la clé qu'elle avait. Refusé avant l'exécution de tout hook, sans rien écrire, sur chaque porte d'accès. `details.violations` nomme le champ. | Créez la ligne sous la nouvelle clé et supprimez celle-ci. Envoyer la clé que la ligne possède déjà ne pose aucun problème. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route d'agrégation a été appelée sans `?select=`. | Ajoutez ce paramètre, par ex. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Le projet ne propose aucune collection : aucune n'est déclarée dans le code et aucune table n'existe pour les inférer. | Créez des tables — via une migration, du SQL ou un fichier de collection suivi de `rebase db push` — puis redémarrez. |
| `NOT_FOUND` | 404 | Aucune ligne avec cet identifiant dans cette collection — ou ligne masquée à cet appelant par la sécurité au niveau des lignes. | Vérifiez l'identifiant, puis les `securityRules` de la collection. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` mentionne une relation inexistante sur la collection. Ce même code renvoie un **404** lorsqu'un *chemin d'URL* imbriqué en mentionne une, par ex. `/api/data/authors/1/posts` si `authors` n'en déclare pas — l'URL ne ciblant rien, il s'agit d'une ressource introuvable plutôt que d'une requête malformée. | Vérifiez le nom de la relation — le message indique celles disponibles. Une référence inverse doit être déclarée sur le parent pour être traversable. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | Le tri cible une propriété qui ne peut pas être triée. | Triez sur une propriété adossée à une colonne. |
| `PAYLOAD_TOO_LARGE` | 413 | Le corps de la requête dépasse la limite configurée. | Réduisez la taille envoyée ou augmentez la limite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` a tenté d'écrire. Une lecture liée à une requête s'exécute dans une transaction `READ ONLY` ; ni le callback ni ce qu'il appelle ne peuvent effectuer d'écritures. | Déplacez l'écriture hors de la lecture : tâche de fond, ou `rebase.dataAsAdmin` depuis un cron ou une fonction personnalisée. |
| `RELATION_HAS_NO_PIVOT` | 400 | L'écriture contenait une charge utile de liaison, mais le chemin n'atteint pas sa cible via une relation `manyToMany` déclarant `through.properties` — il n'y a donc pas de table de jonction pour accueillir cette donnée. | Déclarez `through.properties` sur la relation ou retirez la charge utile. Voir [Relations](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Une relation ne correspond pas au schéma enregistré. L'opération est refusée plutôt qu'ignorée : l'ignorer validerait une écriture qui n'a pas eu lieu, ou renverrait un résultat vide pour des lignes existantes. | Exécutez `rebase schema generate` si le schéma généré est plus ancien que la base de données. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relation ne peut pas être déliée depuis ce côté. | Effectuez l'écriture depuis le côté propriétaire. |
| `RELATION_NOT_WRITABLE` | 400 | Le chemin imbriqué ne correspond pas à une relation modifiable. | Voir [Relations](/docs/collections/relations/). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relation déclare des colonnes de jonction, mais cette source de données ne permet pas d'y écrire. | Le lien lui-même fonctionne ; seules les données portées par la jonction sont bloquées. Vérifiez les capacités du pilote. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Une écriture de relation ne disposait d'aucune clé source à laquelle rattacher le lien. | Enregistrez d'abord la ligne parente. |
| `ROW_IN_TRASH` | 409 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> La clé d'un upsert appartient à une ligne dans la corbeille (une ligne en soft delete conserve sa clé). Un upsert n'écrit jamais dans une ligne supprimée, quelle que soit la porte d'accès : REST `?on_conflict=`, les upserts `/bulk` et `/_batch`, le SDK et le socket temps réel. Rien n'a été écrit. | Restaurez d'abord la ligne (une mise à jour qui remet le champ de soft delete à `null`), ou purgez-la avec `?hard=true` puis refaites l'upsert. Voir [Suppression douce (Soft delete)](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Une table ou une colonne attendue par le code n'existe pas dans la base de données. | `rebase db push` en développement ; redéployez sur un environnement géré. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` a été combiné avec `orderBy: "_score"`. La pertinence étant calculée à la volée pour chaque requête et non stockée, elle ne peut servir de curseur. | Paginez par pertinence avec `limit`/`offset`, ou triez par colonne. |
| `TENANT_IMMUTABLE` | 400 | Une écriture déplacerait une ligne d'un tenant à un autre. Une ligne ne peut pas changer de tenant. `details.violations` indique le champ en cause. | Créez la ligne dans l'autre tenant et supprimez la ligne actuelle, ou écrivez avec un rôle présent dans `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | L'écriture cible un tenant auquel cet appelant n'appartient pas ; la base de données la rejetterait également. | Écrivez dans un tenant auquel l'appelant est rattaché, ou authentifiez-vous en tant que membre de celui-ci. |
| `TENANT_REQUIRED` | 400 | La collection est compartimentée par tenant et celui-ci ne peut être déduit : la requête n'en fournit aucun ou l'appelant appartient à plusieurs d'entre eux. | Précisez explicitement le champ du tenant, ou authentifiez-vous sous une identité rattachée à un seul tenant. |
| `TRANSACTION_ABORTED` | 500 | Une instruction exécutée dans la transaction de l'écriture a échoué et un callback a intercepté l'erreur. Postgres avait déjà interrompu la transaction : l'écriture a donc été annulée et rien n'a été enregistré. Seule une création, mise à jour ou suppression `context.data` que la base de données a refusée est annulée d'elle-même et peut être interceptée sans risque. | Laissez l'échec se propager, ou vérifiez la condition avant d'exécuter l'instruction. Voir [Sémantique des transactions](/docs/collections/callbacks/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` cible un champ inexistant dans la collection. | Vérifiez l'orthographe ; le message énumère les champs valides. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un agrégat ou un `groupBy` mentionne un champ inexistant dans la collection. | Vérifiez l'orthographe ; le message énumère les champs valides. |
| `UNKNOWN_FILTER_FIELD` | 400 | Le filtre indique un champ inexistant dans cette collection (ou dans la cible d'une relation). | Vérifiez l'orthographe ; le message énumère les champs valides. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Le filtre spécifie un opérateur qui n'existe pas. | Le message énumère l'ensemble des opérateurs valides. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | Le tri cible un champ absent de cette collection. | Vérifiez l'orthographe ; le message énumère les champs valides. |
| `PRECONDITION_FAILED` | 412 | Un en-tête `If-Match` a ciblé une version de la ligne qui n'est plus à jour : une modification est intervenue entre la lecture et cette écriture. Rien n'a été enregistré. | Relisez la ligne, réappliquez le changement et envoyez le nouvel `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` demande un champ qui n'existe pas dans la collection. | Vérifiez l'orthographe ; le message énumère les champs connus. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Une recherche vectorielle a ciblé une propriété qui n'est pas de type `vector` sur cette collection. | Le message liste les propriétés vectorielles de la collection. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Le `Content-Type` n'est pas accepté par cette route. | Envoyez le format attendu par la documentation de la route. |
| `UNSUPPORTED_OPTION` | — | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Levée, pas répondue : une écriture passant par l'accesseur interne au processus (`context.data` dans un callback, `rebase.data` dans une fonction ou un cron) a reçu `ifMatch` ou `idempotencyKey`. Cette porte d'accès n'a ni vérification de précondition ni magasin d'idempotence, donc l'option est refusée avant toute écriture plutôt qu'ignorée. | Retirez l'option à cet endroit, ou passez par le client HTTP, qui honore les deux. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Le filtre traverse une relation `via`, dont la jointure est unidirectionnelle : impossible d'y corréler une sous-requête inverse. | Filtrez depuis le côté propriétaire. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'opérateur n'est pas défini pour ce champ : une relation sans colonne sur cette ligne se filtre par appartenance, et la recherche insensible à la casse ne s'applique qu'au texte. | Voir le message ; il détaille ce que le champ accepte. |
| `VALIDATION_CONSTRAINT` | 400 | Une valeur enfreint une règle de `validation` déclarée par la propriété — longueur, intervalle, motif (regex), champ obligatoire. | Voir le message ; il indique chaque violation. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Le corps de la requête tente d'écrire sur une colonne marquée `excludeFromApi`, ou `access: { write: [] }` — deux écritures d'une même règle. Celles-ci sont réservées au serveur : hachage de mot de passe, jeton de vérification. Contrairement à `FIELD_NOT_WRITABLE`, cette réponse est identique pour tous les appelants, y compris `admin`. | Retirez le champ. Voir [Accès aux champs](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Une valeur ne correspond pas au type de sa propriété. | Voir le message ; il indique la propriété. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Le corps de la requête mentionne un champ absent de la collection — y compris un argument `id` sur une collection dont la clé primaire est différente. | Vérifiez l'orthographe ; le message énumère les champs reconnus. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Un curseur (`after` / `startAfter`) a été combiné avec une recherche vectorielle. Les lignes sont triées par une distance calculée pour chaque requête, qui ne peut pas servir de curseur, donc un listage vectoriel ne porte pas de `nextCursor`. | Paginez les lignes les plus proches avec `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Une règle de sécurité ou une politique RLS a refusé l'écriture. | Consultez les `securityRules` de la collection. |

## `PG_<SQLSTATE>` — une contrainte refusée par la base de données

Une écriture rejetée par Postgres pour une raison liée aux *données fournies par l'appelant* répond avec le SQLSTATE directement dans le code : `PG_23505`, `PG_23503`, etc. Il s'agit d'une famille de codes et non d'une liste exhaustive — Postgres définissant des centaines de SQLSTATEs — mais seules deux classes peuvent parvenir jusqu'ici, car seules ces deux-là relèvent de la responsabilité de l'appelant :

- **classe 23**, violation de contrainte d'intégrité : doublon, clé étrangère pointant vers le vide, colonne NOT NULL laissée vide ;
- **classe 22**, exception sur les données : valeur incompatible avec le type de la colonne.

Tout le reste — coupure de connexion, colonne manquante, problème de droits — incombe au serveur et reste sous forme de `500`. Dès lors, `code.startsWith("PG_")` constitue un test fiable pour déterminer si « la ligne envoyée était invalide », et les quatre entrées ci-dessous sont celles qu'un client rencontre en pratique. `details.dbCode` contient le même SQLSTATE pour chacune d'elles, et le message indique le nom de la contrainte.

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Impossible de lire une valeur dans le type de la colonne — pendant côté écriture de `INVALID_FILTER_VALUE`. | Envoyez une valeur correspondant au type de la colonne. |
| `PG_23502` | 400 | Une colonne `NOT NULL` a été laissée vide. | Renseignez le champ ou définissez une valeur par défaut sur la colonne. |
| `PG_23503` | 400 | Une clé étrangère pointe vers une ligne qui n'existe pas. | Créez d'abord la ligne ciblée ou corrigez l'identifiant. |
| `PG_23505` | 409 | Violation d'une contrainte d'unicité. Le message précise la contrainte. | Utilisez une valeur différente ou mettez à jour la ligne existante. |

## Stockage

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | Le `maxResults` d'un listage de stockage n'est pas un entier d'au moins 1, ou son `pageToken` n'a pas été émis par la source. Une taille de page inférieure à un renvoyait autrefois une page vide portant le même jeton, si bien qu'une boucle `while (pageToken)` ne se terminait jamais. | Envoyez un `maxResults` positif, et renvoyez `nextPageToken` tel quel. |
| `INVALID_STORAGE_BUCKET` | 400 | Le nom du bucket est malformé. | Vérifiez le nom. |
| `INVALID_STORAGE_KEY` | 400 | La clé de l'objet est malformée ou sort de son préfixe. | Vérifiez la clé. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Les paramètres de transformation d'image sont hors limites ou contradictoires. | Voir [Stockage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Le fichier téléversé dépasse la taille `maxSize` définie sur la propriété cible. Appliqué côté serveur, et pas seulement dans le navigateur. `details` précise la propriété, la limite et la taille réelle. | Téléversez un fichier plus léger ou augmentez `maxSize` sur la propriété. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Le type du fichier téléversé ne figure pas dans la liste `acceptedFiles` de la propriété. `details` précise la propriété, la liste acceptée et le Content-Type envoyé. | Téléversez un type accepté ou élargissez `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Aucun service de stockage n'est configuré sur ce serveur, ou aucun n'est celui par défaut et la requête ne nomme aucune source ; le message nomme les sources servies (501). Un téléversement reprenable dont la source a disparu avant la fin donne un 503. | Configurez S3, GCS ou le stockage local, ou nommez une source avec `?storageId=`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La source de stockage est déclarée mais ne dispose d'aucun identifiant configuré ici. | Définissez les variables d'environnement de cette source. |
| `STORAGE_WRITE_FAILED` | 502 | Le service de stockage a refusé ou interrompu l'écriture. | Vérifiez ses propres logs et identifiants. |
| `TRANSFORM_OVERLOADED` | 503 | Trop de transformations d'images sont en cours d'exécution. | Réessayez ; envisagez la mise en place d'un CDN en amont. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La requête a ciblé une source de stockage (`?storageId=`) non déclarée par ce projet. Un `bucket` non pris en charge par ce déploiement renvoie ce même code avec un statut **404** (sur un listage, et sur un téléversement, un dossier ou un téléversement reprenable vers S3 ou GCS) — c'est l'espace de stockage qui est manquant, et `details` liste les buckets et sources existants. Ces deux cas renvoyaient auparavant « fichier introuvable », de manière indifférenciée par rapport à une simple clé inexistante. | Déclarez la source dans `config/resources.ts`, ou consultez `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Le `PATCH` d'un téléversement reprenable est arrivé alors qu'un autre fragment du même téléversement était encore en cours de réception — presque toujours un client qui retente le fragment en vol. Il est refusé plutôt que mis en file, comme le fait tusd. | Demandez le décalage avec `HEAD /api/storage/tus/:id` et reprenez à partir de là ; tus-js-client patiente et retente de lui-même. Voir [Téléversements reprenables TUS](/docs/backend/storage/#tus-resumable-upload-protocol). |

## Fonctions personnalisées

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Aucune fonction portant ce nom n'est servie — ou elle l'est, mais ses propres routes ne couvrent pas le sous-chemin demandé. Un appelant connecté reçoit également la liste de ce qui *est* servi ; un appelant anonyme ne la reçoit pas, car cette liste constitue l'inventaire complet des endpoints personnalisés. Lorsqu'un fichier de ce nom n'a pas pu être chargé, le message le précise : c'est la différence entre une faute de frappe et un déploiement défectueux. | Vérifiez le nom via `GET /api/functions`, ou consultez les logs de démarrage pour repérer un fichier qui n'aurait pas pu se charger. |
| `FUNCTION_TIMEOUT` | 504 | Le gestionnaire de fonction a dépassé son délai d'expiration. Il continue de s'exécuter ; il ne peut pas être interrompu d'ici. | Associez un `AbortSignal` aux appels sortants, ou augmentez `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Ce processus relaie les fonctions vers un autre processus qui n'a pas répondu. | Vérifiez que l'instance exécutant les fonctions est bien active. |

## Tâches cron

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Un déclenchement manuel d'une tâche cron déjà en cours d'exécution — dans le processus qui a répondu, ou dans un autre qui détient le bail d'exécution de la tâche, comme le worker derrière un processus `api`. Rien n'a été exécuté. L'omission figure dans l'historique de la tâche, et `details.log` est cette entrée ; sa ligne nomme le processus qui exécute la tâche. | Réessayez quand cette exécution est terminée. Voir [Tâches cron](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Interfaces d'administration et modification du schéma

Ces codes indiquent qu'une fonctionnalité est désactivée ou non configurée, plutôt qu'une erreur dans la requête. Chacun d'eux est également signalé sur la route `/status` correspondante avec un code `200`, permettant à une interface de griser la fonctionnalité au lieu d'afficher une erreur.

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Une interface réservée aux administrateurs a été appelée sur un serveur sans authentification configurée ; impossible donc de distinguer un administrateur d'un tiers anonyme. | Définissez `auth.jwtSecret`, ou transmettez un `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | Le contrat du projet n'est exposé que lorsque l'authentification est configurée — il décrit l'intégralité des tables et des relations. | Configurez l'authentification. `/meta/schema-version` reste toujours accessible. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Aucune boîte de réception de développement n'est active. Les e-mails ne sont interceptés que lorsque `SMTP_HOST` n'est pas défini et que `NODE_ENV` n'est pas en production. | Supprimez `SMTP_HOST` en développement, ou consultez la véritable boîte de réception. |
| `INVALID_CHANGE` | 400 | La modification de schéma proposée n'est pas bien formée. | Voir le message. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'application d'une modification de schéma planifiée a échoué pour une raison non couverte par des codes plus précis. | Voir le message ; il rapporte mot pour mot l'échec sous-jacent. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modification est valide mais ne peut pas être appliquée au schéma en l'état. | Voir le message. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Le dépôt contient des modifications non validées (uncommitted), empêchant d'appliquer l'édition en toute sécurité. | Effectuez un commit ou un stash, puis réessayez. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'éditeur de schéma a refusé la modification. | Voir le message ; il s'agit du refus émis directement par l'éditeur. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Une clé API ou un autre compte de service a tenté d'appliquer une modification de schéma. | Connectez-vous en tant qu'utilisateur, ou activez `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | L'édition de schéma à chaud nécessite `collectionsDir` ou `liveSchema.repository`, et ce serveur a été démarré sans aucun des deux. | Configurez l'un d'eux. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planification fonctionne, mais aucun dépôt n'est configuré pour commiter le changement. | Configurez `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Ce pilote ne sait pas planifier les modifications de schéma. | L'édition en direct est disponible sur Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Les collections sont ici introspectées directement depuis la base de données ; aucun fichier source n'est donc modifiable. | Modifiez le schéma via une migration. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'éditeur de schéma est désactivé sur ce serveur. | Activez-le avec `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'éditeur de schéma requiert `ts-morph`, qui n'est pas installé. | Exécutez `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Le serveur n'a pas de `collectionsDir` ; l'éditeur n'a donc aucun emplacement où écrire. | Définissez `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'éditeur est désactivé avec `NODE_ENV=production` : les fichiers d'un serveur déployé étant reconstruits depuis votre dépôt à chaque déploiement, toute modification locale ici serait écrasée. | Modifiez les collections en développement puis déployez. |

## Codes génériques

Une route renvoie l'un de ces codes lorsqu'aucun motif plus précis ne s'applique.

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Requête malformée, sans code plus précis applicable. | Voir le message. |
| `UNAUTHORIZED` | 401 | Non authentifié, ou identifiant rejeté. | Connectez-vous ou rafraîchissez le jeton. |
| `FORBIDDEN` | 403 | Authentifié, mais non autorisé. | Réessayer avec la même identité ne changera rien. |
| `CONFLICT` | 409 | Conflit avec l'état existant. | Voir le message. |
| `INTERNAL_ERROR` | 500 | Une erreur est survenue sur le serveur. Le message est délibérément générique. | Citez le `requestId` ; le détail figure dans les logs. |
| `NOT_CONFIGURED` | 503 | Une dépendance requise par cette route n'est pas configurée sur ce serveur. | Voir le message. |
| `SERVICE_UNAVAILABLE` | 503 | Une dépendance était inaccessible. | Réessayez ; consultez les logs. |

## Maintenir l'exactitude de cette page

`pnpm verify:docs` échoue lorsqu'un code que le serveur peut émettre est absent de ces tableaux, lorsqu'un tableau liste un code qui ne peut jamais être levé, lorsque les statuts d'une ligne ne sont pas exactement ceux avec lesquels le code source lève le code, ou lorsqu'une famille de codes telle que `PG_<SQLSTATE>` ne documente pas une ligne pour un SQLSTATE rencontré par les appelants. L'étape correspondante est `tooling/scripts/docs-verify/check-error-codes.mjs`.

Ce script commence par se vérifier lui-même. L'analyse extrait les codes directement depuis TypeScript et non depuis un serveur en cours d'exécution, de sorte que ses angles morts sont silencieux par conception : il lui est arrivé de ne pas détecter un code encapsulé dans un wrapper d'une ligne, ou placé après un message contenant une parenthèse `)`, affirmant alors à tort que « chaque code émis par le serveur est documenté » sur une page où il en manquait dix-sept. Désormais, cette étape exécute d'abord un jeu de test reproduisant fidèlement ces cas de figure avant de lire cette page, et refuse de rendre son verdict si elle ne parvient pas à les repérer.
