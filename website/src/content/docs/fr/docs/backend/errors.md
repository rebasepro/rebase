---
sourceHash: ffb0a0aaabda1c4c
title: Codes d'erreur
sidebar_label: Codes d'erreur
description: Tous les codes d'erreur qu'un backend Rebase peut renvoyer, avec leur statut HTTP, leur signification et la marche à suivre — ainsi que l'enveloppe de réponse, X-Request-ID et les règles relatives aux details.
---

Chaque échec renvoyé par un backend Rebase utilise une enveloppe unique et comporte un `code` stable. Le code est l'élément sur lequel baser vos branchements conditionnels : le message est rédigé pour un être humain et peut être reformulé, le statut est partagé par une douzaine de problèmes différents, alors que le code ne présente aucun de ces deux inconvénients.

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

- **`message`** — lisible par un humain. Pour un code `4xx`, il s'agit du message propre au serveur ; pour un code `5xx`, il est délibérément générique, car le texte sous-jacent peut citer un hôte, un rôle ou un nom de colonne.
- **`code`** — l'une des valeurs ci-dessous. Stable d'une version mineure à l'autre.
- **`details`** — facultatif, et jamais garanti. Voir les règles ci-dessous.
- **`requestId`** — présent dès lors que la requête a traversé le middleware de request-ID, ce qui est le cas de chaque route sous `basePath`.

### `X-Request-ID`

Chaque requête sous `basePath` reçoit un identifiant : l'en-tête `X-Request-ID` de l'appelant lorsqu'il s'agit d'un UUID v4 valide, ou à défaut un nouvel identifiant généré pour l'occasion. Il est renvoyé dans la réponse sous l'en-tête `X-Request-ID`, inclus dans l'enveloppe d'erreur en tant que `requestId`, et associé à la ligne de log du serveur pour cette requête.

Il s'agit de la clé de jointure. Mentionnez-la dans un rapport de bug et un opérateur pourra retrouver la ligne de log exacte expliquant l'échec, contenant la raison qui n'a jamais été montrée au client.

Envoyer votre propre identifiant permet à une trace de survivre à un saut réseau : une passerelle ou un exécuteur de tâches qui transmet l'en-tête conserve un ID unique à travers chaque service ayant traité la requête. Une valeur invalide est ignorée plutôt que rejetée — un en-tête mal formé provenant d'un appelant ne justifie pas de faire échouer une requête — ne présumez donc pas que l'ID envoyé est l'ID obtenu. Lisez l'en-tête de réponse.

### Contenu de `details`

`details` a une vocation diagnostique, pas contractuelle. Trois règles l'encadrent :

1. **Tout ce qu'une route définit explicitement est toujours renvoyé.** Il s'agit des erreurs propres à l'appelant décrites avec précision : quel champ de filtre était inconnu, quelle relation n'est pas accessible en écriture, quelle valeur ne correspondait pas à son type.
2. **Les diagnostics de base de données sont tronqués en production.** Lorsque l'échec provient de Postgres, `details.dbCode` — le SQLSTATE — est toujours présent : il nomme la classe du problème sans rien révéler sur les données. `dbMessage`, `detail` et `hint` ne sont ajoutés que lorsque `NODE_ENV` n'est pas défini sur `production`, car Postgres y inclut le contenu des lignes. `23505` indique `Key (email)=(a@b.c) already exists.`, ce qui répond à la question « cette personne est-elle inscrite ? » pour n'importe quelle adresse testée.
3. **Ne basez jamais vos conditions sur `details`.** Basez-les sur `code`. Le contenu de `details` correspond à ce qui était utile à un humain à cet endroit du code au moment de l'appel, et cela peut changer.

## Interpréter un statut

| Statut | Ce que cela indique sur la requête |
| --- | --- |
| `400` | Mal formée, ou demandant un élément qui n'existe pas dans le schéma. Corrigez la requête. |
| `401` | Non authentifié, ou identifiant expiré. Connectez-vous ou actualisez la session. |
| `403` | Authentifié, mais non autorisé. Réessayer avec la même identité ne servira à rien. |
| `404` | Route, collection ou ligne introuvable — ou ligne masquée par la sécurité au niveau des lignes (RLS). |
| `409` | Conflit avec l'état existant : un doublon, ou une écriture concurrente. |
| `413` `415` `422` | Le corps est trop volumineux, le type de média est incorrect, ou la requête est sémantiquement rejetée. |
| `429` | Limite de débit atteinte. Ralentissez ; le message indique pendant combien de temps. |
| `500` | L'erreur provient du serveur ou de sa base de données, pas de l'appelant. Consultez les logs. |
| `501` | La route existe, mais ce déploiement ne peut pas la servir — une fonctionnalité est désactivée ou non configurée. |
| `502` `503` `504` | Une dépendance était inaccessible, non configurée ou trop lente. |

## Authentification et comptes

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route nécessite un second facteur et la session n'en possède qu'un. | Complétez le challenge MFA, puis réessayez. |
| `ALREADY_VERIFIED` | 400 | L'adresse ou le facteur est déjà vérifié. | Rien — l'état souhaité est déjà effectif. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | La connexion anonyme est désactivée sur ce serveur. | Activez-la, ou connectez-vous avec une identité réelle. |
| `API_KEY_FORBIDDEN` | 403 | Une clé d'API a été utilisée sur une route réservée aux utilisateurs réels. | Utilisez une session utilisateur. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Une clé d'API a tenté de créer, lister ou révoquer des clés d'API. | Gérez les clés en tant qu'administrateur connecté. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Une route protégée a été exécutée sans middleware d'authentification Rebase en amont, les identifiants de l'appelant n'ont donc jamais été vérifiés. | Montez l'application via le routeur de fonctions plutôt que directement sur votre propre serveur. |
| `BOOTSTRAP_ANONYMOUS` | 403 | L'initialisation du premier administrateur a été tentée par un appelant anonyme. | Connectez-vous d'abord. |
| `BOOTSTRAP_COMPLETED` | 403 | Le premier administrateur existe déjà. | Demandez à un administrateur existant d'accorder le rôle. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | L'initialisation est réservée au tout premier utilisateur, ce qui n'est pas le cas ici. | Demandez à un administrateur existant d'accorder le rôle. |
| `CAPTCHA_FAILED` | 400 | Le fournisseur a rejeté le jeton CAPTCHA. | Résolvez un nouveau test CAPTCHA. |
| `CAPTCHA_REQUIRED` | 400 | La route requiert un jeton CAPTCHA et aucun n'a été transmis. | Incluez le jeton. |
| `CHALLENGE_EXHAUSTED` | 401 | Trop de codes erronés saisis pour un même challenge MFA. | Démarrez un nouveau challenge. |
| `EMAIL_EXISTS` | 409 | Un compte avec cette adresse existe déjà. | Connectez-vous, ou demandez une réinitialisation de mot de passe. |
| `EMAIL_NOT_CONFIGURED` | 503 | Des liens magiques ou un OTP ont été demandés, mais le serveur ne dispose d'aucun transport d'e-mails. | Configurez SMTP, ou utilisez une autre méthode de connexion. |
| `EMAIL_NOT_VERIFIED` | 403 | Le compte existe mais son adresse n'est pas vérifiée. | Vérifiez l'adresse. |
| `FACTOR_NOT_VERIFIED` | 400 | Le facteur MFA a été enregistré mais jamais confirmé. | Confirmez le facteur. |
| `IDENTITY_ALREADY_LINKED` | 409 | Cette identité OAuth appartient à un autre compte. | Connectez-vous avec celle-ci, ou dissociez-la d'abord de l'autre compte. |
| `INVALID_ACCOUNT` | 400 | Le compte se trouve dans un état ne permettant pas cette opération. | Consultez le message. |
| `INVALID_CHALLENGE` | 400 | Le challenge MFA est inconnu ou expiré. | Démarrez-en un nouveau. |
| `INVALID_CODE` | 401 | Le code OTP ou MFA est incorrect. | Réessayez avec le code actuel. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou mot de passe incorrect — sans préciser délibérément lequel. | Réessayez, ou réinitialisez le mot de passe. |
| `INVALID_TOKEN` | 400 | Un jeton de vérification, de réinitialisation ou de lien magique est mal formé ou inconnu. | Demandez un nouveau lien. |
| `LAST_ADMIN` | 403 | La modification laisserait le projet sans aucun administrateur. | Donnez le rôle d'administrateur à quelqu'un d'autre au préalable. |
| `MFA_REQUIRED` | 401 | Le mot de passe était correct et le compte dispose d'un second facteur vérifié, la connexion n'est donc qu'à moitié terminée. `details` contient un jeton éphémère limité au challenge MFA — il ne s'agit pas d'une session. | Initiez un challenge et répondez-y ; la réponse au challenge génère la session. |
| `NO_SESSION` | 401 | Aucun cookie de session ou jeton d'actualisation n'a été fourni. Normal lors d'un premier chargement de page. | Connectez-vous. |
| `NOT_ANONYMOUS` | 400 | Une route de mise à niveau depuis le statut anonyme a été appelée par un compte réel. | Rien à mettre à niveau. |
| `OAUTH_ERROR` | 401 | Le fournisseur OAuth a refusé la requête ou a renvoyé une erreur. | Réessayez le flux ; le message contient la raison fournie par le fournisseur. |
| `RATE_LIMITED` | 429 | Trop de tentatives effectuées par cet appelant. | Ralentissez ; le message indique la durée d'attente requise. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | L'URI de redirection cible ne figure pas sur la liste autorisée. | Ajoutez-la à la configuration du fournisseur. |
| `REGISTRATION_DISABLED` | 403 | L'inscription en libre-service est désactivée. | Demandez à un administrateur de créer le compte. |
| `ROLE_EXISTS` | 409 | Ce nom de rôle est déjà utilisé. | Choisissez un autre nom. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossible de lire les rôles pour une requête réservée aux administrateurs. Verrouillage par défaut plutôt que de faire confiance à la revendication (claim) du jeton. | Réessayez ; vérifiez la base de données. |
| `SELF_DELETE` | 400 | Un administrateur a tenté de supprimer son propre compte. | Demandez à un autre administrateur de le faire. |
| `SESSION_REVOKED` | 401 | La session a été déconnectée ailleurs, ou toutes les sessions ont été révoquées. | Reconnectez-vous. |
| `SETUP_REQUIRED` | 403 | Le projet n'a pas encore d'administrateur, cette route n'est donc pas disponible. | Terminez la configuration du premier administrateur. |
| `TOKEN_ALREADY_USED` | 401 | Un jeton à usage unique a déjà été utilisé. | Demandez-en un nouveau. |
| `TOKEN_EXPIRED` | 401 | La durée de validité du jeton a expiré. | Demandez-en un nouveau. |
| `USER_NOT_FOUND` | 404 | Aucun compte avec cet identifiant. | Vérifiez l'identifiant. |
| `WEAK_PASSWORD` | 400 | Le mot de passe ne respecte pas la politique configurée. | Choisissez-en un plus robuste. |

## Données, requêtes et écritures

<span class="since-badge" data-since="0.20">Depuis 0.20</span>

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Ce pilote ne prend pas en charge l'agrégat demandé. | Utilisez un pilote compatible, ou calculez-le côté client. |
| `BRANCHING_UNSUPPORTED` | — | Une branche de base de données a été demandée via le websocket Studio sur la base de développement managée (PGlite), où une branche *est* le parent et rien ne serait isolé. Le refus est identique à celui affiché par `rebase db branch`. | Pointez `DATABASE_URL` vers votre propre instance Postgres (`rebase dev --docker` en lance une) et branchez là-bas. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contient plus d'opérations que la limite autorisée par lot (1000 par défaut). Un lot correspond à une transaction et conserve ses verrous pendant toute sa durée. | Envoyez-le par segments ; le message précise la limite et votre nombre d'opérations. |
| `BATCH_UNSUPPORTED` | 400 | Le pilote de ce backend ne peut pas écrire sur plusieurs collections de manière atomique, et une boucle d'écritures individuelles ne serait ni atomique ni effectuée en un seul aller-retour. | Envoyez les écritures sous forme de requêtes distinctes, ou via des appels `/bulk` par collection. |
| `BULK_TOO_LARGE` | 400 | Le corps de la requête groupée dépasse la limite d'éléments configurée. | Scindez la requête. |
| `BULK_UNSUPPORTED` | 400 | Cette collection ou ce pilote ne gère pas les écritures groupées. | Écrivez les lignes une par une. |
| `CALLBACK_REJECTED` | 400 | Un callback de collection a refusé l'écriture. Un `throw` depuis `beforeSave`/`beforeDelete`/`after*` renvoie une 400 contenant le message de l'auteur ; un `beforeDelete` renvoyant `false` produit une 403. `details.stage` indique le callback en cause, `details.path` la collection. | Lisez le message — il a été rédigé par ce projet, pas par Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` a été combiné avec `?offset=` ou `?page=`. Un curseur indiquant déjà où commence la page, appliquer un décalage en plus saute silencieusement autant de lignes après le curseur — créant un écart invisible pour l'appelant dans la réponse. | Utilisez l'un ou l'autre, pas les deux. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` a été combiné avec une recherche textuelle ou vectorielle. Ces deux opérations attribuent un score par ligne, de sorte que deux lignes ne sont jamais équivalentes et que `DISTINCT` ne fusionnerait rien — cela semblerait fonctionner mais ne changerait rien. | Supprimez l'une des deux options. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Une lecture `distinct` est triée selon une colonne qu'elle ne renvoie pas. Un `SELECT DISTINCT` ne peut être trié que par les colonnes de sa liste de sélection, sans quoi les lignes fusionnées n'ont pas d'ordre défini. `details.fields` les énumère. | Ajoutez ces champs à `?fields=`, ou retirez-les de `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres a refusé l'instruction (`42501`) : politique de sécurité au niveau des lignes (RLS) refusant ce rôle, ou `GRANT` manquant. | Voir [Dépannage](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Un filtre, un `orderBy`, un `fields`, un `select` d'agrégat ou un `groupBy` désigne un champ que les rôles de cet appelant ne peuvent pas lire (`access.read`). Un champ qu'aucune réponse ne peut inclure ne doit pas pouvoir être interrogé, sous peine de rendre sa valeur déductible prédicat par prédicat. `details.violations` énumère chaque champ. | Retirez le champ de la requête, ou obtenez le rôle requis. Voir [Accès aux champs](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Le corps définit un champ dans lequel les rôles de cet appelant ne peuvent pas écrire (`access.write`). Rejeté plutôt qu'ignoré : une écriture ignorant un champ notifierait un succès pour une modification non réalisée. `details.violations` énumère chaque champ. | Supprimez le champ, ou obtenez le rôle requis. Un champ auquel personne ne peut écrire répond `VALIDATION_EXCLUDED_FIELDS` à la place. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Une requête antérieure avec la même `Idempotency-Key` est toujours en cours d'exécution. | Réessayez une fois terminée. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La même `Idempotency-Key` a été envoyée avec un corps différent. | Utilisez une nouvelle clé, ou renvoyez le corps d'origine. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` indique une fonction autre que `count`, `sum`, `avg`, `min` ou `max`. | Utilisez l'une de ces fonctions ; le message les énumère. |
| `INVALID_AGGREGATE_SELECT` | 400 | Une entrée de `?select=` n'est pas sous la forme `fn(field)`, ou une fonction autre que `count()` n'a reçu aucun champ. | Écrivez `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | Une opération dans `/_batch` ne comporte pas `op`, `collection`, `values` ou `id`, nomme une collection non gérée par ce backend, ou réutilise un nom de `ref`. | Consultez le message ; il indique l'index de l'opération concernée. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` ne cible aucune opération antérieure, pointe vers l'avant, ou demande un champ absent de la ligne référencée. Seules les références arrières sont résolues. | Définissez l'opération avec `ref` *avant* d'y faire référence. |
| `INVALID_BULK_BODY` | 400 | Le corps de la requête groupée n'a pas la structure attendue. | Envoyez le tableau `items` documenté. |
| `INVALID_CONFLICT_TARGET` | 400 | Le paramètre `on_conflict` / `onConflict` d'un upsert nomme des colonnes sans garantie d'unicité, ou les nomme sans `upsert: true`. Postgres renverrait autrement une erreur 42P10 au sein d'une transaction ayant déjà effectué des opérations. | Déclarez `validation: { unique: true }` ou un index `unique` ; le message liste les cibles existantes. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` ne vaut ni `include` ni `only`. Rejeté plutôt qu'ignoré : une faute de frappe du type `?deleted=true` masquant discrètement chaque ligne supprimée semblerait fonctionner tout en répondant à la question inverse. | Spécifiez `include` (actives et supprimées) ou `only` (supprimées uniquement). Omettez-le pour ne cibler que les lignes actives. |
| `INVALID_DISTINCT` | 400 | `?distinct=` ne vaut ni `true` ni `false`. | Transmettez l'une de ces valeurs ; `1` et `0` sont également acceptés. |
| `INVALID_FIELD_OPERATION` | 400 | Un opérateur `$inc` / `$push` / `$pull` / `$merge` a été utilisé sur un type de propriété non pris en charge, avec un opérande de format incorrect, avec deux opérateurs sur un même champ, avec une faute d'orthographe, ou lors d'une création (où aucune valeur stockée n'existe). | Voir [Écriture via REST](/docs/backend/writes/#field-operations) ; le message indique le champ concerné. |
| `INVALID_FILTER_FIELD` | 400 | Le filtre indique une propriété que cette collection ne possède pas. | Vérifiez l'orthographe par rapport à la collection. |
| `INVALID_FILTER_OPERATOR` | 400 | L'opérateur n'est pas pris en charge par ce type de propriété. | Voir [Requêtage de données](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Une valeur de filtre ne peut pas être interprétée selon le type de la colonne comparée : `?id=eq.abc` sur une clé entière, une valeur absente de l'enum, un horodatage invalide, un nombre hors des limites du type. `details.dbCode` contient le SQLSTATE. | Transmettez une valeur compatible avec le type de la colonne. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` ne vaut ni `true` ni `false`. Toute autre valeur est rejetée plutôt qu'interprétée comme un « non » — une faute de frappe effectuant une suppression réversible alors que l'appelant demandait une purge définitive lui ferait croire à tort que la donnée a disparu. | Renseignez `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` est mal formé : liste de chemins invalide, ou imbrication dépassant la profondeur maximale. Erreur interceptée à la frontière plutôt que de laisser le pilote lever une 500. | Consultez le message ; il indique le chemin fautif. |
| `INVALID_INPUT` | 400 | Le corps de la requête n'a pas passé la validation. | Consultez le message. |
| `INVALID_LIMIT` | — | Un abonnement temps réel a demandé une limite hors de la plage autorisée. Notifié via une trame WebSocket `ERROR`, et non une réponse HTTP. | Réduisez la limite. |
| `INVALID_LOGICAL_GROUP` | 400 | Un groupe `?or=` / `?and=` est mal formé ou imbriqué au-delà de la limite autorisée. | Consultez le message ; il détaille la règle d'aplatissement. |
| `INVALID_OFFSET` | 400 | `?offset=` n'est pas un entier supérieur ou égal à 0. | Spécifiez un entier positif ou nul. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` n'est pas `field`, `field:desc`, ni un tableau JSON de `{ field, direction }`. | Consultez le message ; il présente les trois syntaxes possibles. |
| `INVALID_PAGE` | 400 | `?page=` n'est pas un nombre entier supérieur ou égal à 1. La pagination commence à 1, `?page=0` est donc considéré comme une erreur et non comme la première page. | Renseignez `1` ou plus, ou utilisez `?offset=`. |
| `INVALID_PARAM` | 400 | Un paramètre de requête est mal formé. | Consultez le message. |
| `INVALID_VECTOR` | 400 | `?vector=` n'est pas un tableau JSON de nombres. | Spécifiez un format tel que `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` n'est pas `cosine`, `l2` ou `inner_product`. | Utilisez l'une de ces trois valeurs. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` n'est pas un nombre. | Spécifiez un nombre. |
| `INVALID_WHERE` | 400 | `?where=` n'est pas un objet JSON associant des champs à des conditions. | Renseignez par exemple `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route d'agrégation a été appelée sans `?select=`. | Ajoutez-en un, ex. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Le projet ne gère aucune collection : aucune n'est déclarée dans le code, et aucune table ne permet d'en déduire. | Créez des tables — via une migration, du SQL, ou un fichier de collection complété par `rebase db push` — puis redémarrez. |
| `NOT_FOUND` | 404 | Aucune ligne correspondant à cet identifiant dans cette collection — ou ligne masquée pour cet appelant par la sécurité au niveau des lignes. | Vérifiez l'identifiant, puis les `securityRules` de la collection. |
| `UNKNOWN_RELATION` | 400 | `?include=` mentionne un élément qui n'est pas une relation sur la collection. Le même code renvoie **404** lorsqu'un *chemin d'URL* imbriqué en mentionne un, ex. `/api/data/authors/1/posts` alors qu'`authors` n'en déclare aucun — dans ce cas l'URL ne pointe vers rien, il s'agit d'une ressource non trouvée plutôt que d'une requête mal formée. | Vérifiez le nom de la relation — le message indique celles disponibles sur la collection. Une référence arrière doit être déclarée sur le parent pour être accessible. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | Le tri cible une propriété qui ne peut pas être triée. | Triez sur une propriété associée à une colonne. |
| `PAYLOAD_TOO_LARGE` | 413 | Le corps dépasse la limite configurée. | Réduisez la taille, ou augmentez la limite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` a tenté une écriture. Une lecture liée à une requête s'exécute dans une transaction en lecture seule (`READ ONLY`), le callback ou toute fonction appelée par ce dernier ne peut donc pas effectuer d'écriture. | Déplacez l'écriture en dehors de la lecture : tâche de fond, ou `rebase.dataAsAdmin` depuis un cron ou une fonction personnalisée. |
| `RELATION_MISCONFIGURED` | 500 | Une relation ne correspond pas au schéma enregistré. L'opération est refusée plutôt qu'ignorée : l'ignorer notifierait un succès pour une écriture non effectuée, ou indiquerait l'absence de lignes pourtant existantes. | Exécutez `rebase schema generate` si le schéma généré est plus ancien que la base de données. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relation ne peut pas être dissociée depuis ce côté. | Effectuez l'écriture depuis le côté propriétaire. |
| `RELATION_NOT_WRITABLE` | 400 | Le chemin imbriqué ne correspond pas à une relation modifiable en écriture. | Voir [Relations](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Une écriture de relation ne disposait d'aucune clé source pour établir le lien. | Enregistrez la ligne parente d'abord. |
| `SCHEMA_DRIFT` | 500 | Une table ou une colonne attendue par le code n'existe pas dans la base de données. | Faites `rebase db push` en développement ; redéployez sur un tenant managé. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` a été combiné avec `orderBy: "_score"`. La pertinence étant calculée par requête et non stockée, elle ne peut pas servir de clé pour un curseur. | Paginez la pertinence avec `limit`/`offset`, ou triez par colonne. |
| `TENANT_IMMUTABLE` | 400 | Une écriture déplacerait une ligne d'un tenant à un autre. Une ligne ne peut pas changer de tenant. `details.violations` indique le champ. | Créez la ligne dans l'autre tenant et supprimez celle-ci, ou écrivez avec un rôle présent dans `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | L'écriture mentionne un tenant auquel cet appelant n'appartient pas ; la base de données la refuserait également. | Écrivez dans un tenant auquel l'appelant appartient, ou authentifiez-vous en tant que membre de celui-ci. |
| `TENANT_REQUIRED` | 400 | La collection est sectorisée par tenant et le tenant ne peut pas être déduit : la requête n'en fournit aucun, ou l'appelant appartient à plusieurs d'entre eux. | Précisez explicitement le champ du tenant, ou authentifiez-vous en tant qu'appelant n'appartenant qu'à un seul tenant. |
| `UNKNOWN_FIELD` | 400 | `?fields=` nomme un champ que la collection ne possède pas. | Vérifiez l'orthographe ; le message liste les champs valides. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un agrégat ou `groupBy` nomme un champ que la collection ne possède pas. | Vérifiez l'orthographe ; le message liste les champs valides. |
| `UNKNOWN_FILTER_FIELD` | 400 | Le filtre nomme un champ absent de cette collection — ou de la cible d'une relation. | Vérifiez l'orthographe ; le message liste les champs valides. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Le filtre utilise un opérateur inexistant. | Le message énumère tous les opérateurs valides. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | Le tri cible un champ absent de cette collection. | Vérifiez l'orthographe ; le message liste les champs valides. |
| `PRECONDITION_FAILED` | 412 | Un en-tête `If-Match` indiquait une version de ligne qui n'est plus à jour : quelqu'un l'a modifiée entre la lecture et cette tentative d'écriture. Rien n'a été écrit. | Relisez la ligne, réappliquez la modification et envoyez le nouvel `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` demande un champ absent de la collection. | Vérifiez l'orthographe ; le message liste les champs reconnus. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Une recherche vectorielle a ciblé une propriété qui n'est pas de type `vector` sur cette collection. | Le message répertorie les propriétés vectorielles de la collection. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Le `Content-Type` n'est pas accepté par cette route. | Envoyez le type documenté pour cette route. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Le filtre traverse une relation `via`, dont le chemin de jointure est défini dans un seul sens, ne permettant pas de faire le lien avec une sous-requête. | Filtrez depuis le côté propriétaire. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'opérateur n'est pas défini pour ce champ : une relation sans colonne sur cette ligne est filtrée par appartenance, et la correspondance insensible à la casse ne s'applique qu'au texte. | Consultez le message ; il détaille ce que le champ accepte. |
| `VALIDATION_CONSTRAINT` | 400 | Une valeur a enfreint une règle de `validation` déclarée par la propriété — longueur, intervalle, motif ou champ requis. | Consultez le message ; il indique chaque violation. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Le corps tente d'écrire dans une colonne marquée `excludeFromApi` ou `access: { write: [] }` — deux syntaxes pour la même règle. Ces colonnes sont réservées au serveur : hash de mot de passe, jeton de vérification. Contrairement à `FIELD_NOT_WRITABLE`, cette réponse est identique pour tous les appelants, y compris `admin`. | Supprimez le champ. Voir [Accès aux champs](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Une valeur ne correspond pas au type de sa propriété. | Consultez le message ; il précise la propriété concernée. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Le corps mentionne un champ absent de la collection — y compris un argument `id` sur une collection ayant une autre clé primaire. | Vérifiez l'orthographe ; le message liste les champs connus. |
| `WRITE_DENIED` | 403 | Une règle de sécurité ou une politique RLS a refusé l'écriture. | Vérifiez les `securityRules` de la collection. |

## `PG_<SQLSTATE>` — une contrainte refusée par la base de données

Une écriture que Postgres rejette en raison des *données envoyées par l'appelant* renvoie le SQLSTATE dans son code d'erreur : `PG_23505`, `PG_23503`, etc. Il s'agit d'une famille de codes et non d'une liste exhaustive — Postgres définissant des centaines de SQLSTATEs — mais seules deux classes sont susceptibles d'être renvoyées ici, car seules ces deux-là relèvent de la responsabilité de l'appelant :

- **classe 23**, violation de contrainte d'intégrité : un doublon, une clé étrangère pointant vers un élément inexistant, une colonne NOT NULL laissée vide ;
- **classe 22**, exception sur les données : une valeur incompatible avec le type de la colonne.

Tout le reste — coupure de connexion, colonne manquante, problème de privilège — relève du serveur et reste une erreur `500`. Dès lors, `code.startsWith("PG_")` constitue un test fiable pour vérifier si « la ligne transmise était invalide », et les quatre codes ci-dessous sont ceux qu'un client rencontre en pratique. `details.dbCode` contient le même SQLSTATE pour chacun d'eux, et le message précise la contrainte concernée.

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Une valeur n'a pas pu être convertie dans le type de la colonne — le pendant côté écriture de `INVALID_FILTER_VALUE`. | Envoyez une valeur adaptée au type de la colonne. |
| `PG_23502` | 400 | Une colonne `NOT NULL` a été laissée vide. | Fournissez le champ, ou définissez une valeur par défaut pour la colonne. |
| `PG_23503` | 400 | Une clé étrangère pointe vers une ligne inexistante. | Créez la ligne cible au préalable, ou corrigez l'identifiant. |
| `PG_23505` | 409 | Une contrainte d'unicité a été violée. Le message précise la contrainte. | Utilisez une valeur différente, ou mettez à jour la ligne existante. |

## Stockage

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | Le nom du bucket est mal formé. | Vérifiez le nom. |
| `INVALID_STORAGE_KEY` | 400 | La clé de l'objet est mal formée ou sort de son préfixe. | Vérifiez la clé. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Les paramètres de transformation d'image sont hors limites ou contradictoires. | Voir [Stockage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Le fichier téléversé dépasse la limite `maxSize` déclarée sur la propriété cible. Règle appliquée côté serveur, et pas seulement dans le navigateur. `details` indique la propriété, la limite et la taille réelle. | Téléversez un fichier plus petit, ou augmentez `maxSize` sur la propriété. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Le type du fichier téléversé ne figure pas dans `acceptedFiles` de la propriété. `details` indique la propriété, la liste acceptée et le type de contenu envoyé. | Téléversez un type accepté, ou élargissez `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | Aucun backend de stockage n'est configuré sur ce serveur. | Configurez S3, GCS ou un stockage local. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La source de stockage est déclarée mais ne dispose d'aucun identifiant de connexion ici. | Définissez les variables d'environnement de cette source. |
| `STORAGE_WRITE_FAILED` | 502 | Le backend de stockage a refusé ou interrompu l'écriture. | Vérifiez ses propres logs et ses identifiants. |
| `TRANSFORM_OVERLOADED` | 503 | Trop de transformations d'images sont en cours de traitement. | Réessayez ; envisagez la mise en place d'un CDN en amont. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | La requête a indiqué une source de stockage (`?storageId=`) non déclarée par ce projet. Un `bucket` non pris en charge par ce déploiement renvoie le même code avec un statut **404** — c'est l'espace de stockage qui est manquant, et `details` liste les buckets et sources existants. Ces deux cas renvoyaient auparavant « fichier introuvable », à l'identique d'une clé simplement inexistante. | Déclarez la source dans `config/resources.ts`, ou interrogez `GET /api/storage/sources`. |

## Fonctions personnalisées

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Aucune fonction portant ce nom n'est disponible — ou elle existe, mais ses propres routes ne couvrent pas le sous-chemin demandé. Un appelant connecté reçoit également la liste de ce qui *est* disponible ; un appelant anonyme ne la reçoit pas, cette liste constituant l'inventaire de tous les endpoints personnalisés. Lorsqu'un fichier de ce nom n'a pas pu être chargé, le message l'indique : c'est la différence entre une faute de frappe et un déploiement cassé. | Vérifiez le nom avec `GET /api/functions`, ou consultez les logs de démarrage pour identifier un fichier n'ayant pas pu se charger. |
| `FUNCTION_TIMEOUT` | 504 | Le gestionnaire a dépassé son délai d'expiration. Il continue de s'exécuter et ne peut pas être annulé depuis ici. | Associez un `AbortSignal` aux appels sortants, ou augmentez `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Ce processus relaie les fonctions vers un autre processus qui n'a pas répondu. | Vérifiez que l'unité exécutant les fonctions est bien démarrée. |

## Interfaces d'administration et modification de schéma

Ces erreurs signalent qu'une fonctionnalité est désactivée ou non configurée plutôt qu'une anomalie dans la requête. Chacune est également signalée sur la route `/status` correspondante avec un statut `200`, permettant à une interface de griser la fonctionnalité au lieu d'afficher une erreur.

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Une interface réservée aux administrateurs a été appelée sur un serveur sans authentification configurée, rendant impossible la distinction entre un administrateur et un visiteur anonyme. | Définissez `auth.jwtSecret`, ou transmettez un `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | Le contrat du projet n'est exposé que lorsque l'authentification est configurée — il décrit chaque table et relation. | Configurez l'authentification. `/meta/schema-version` est toujours disponible. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Aucune boîte aux lettres de développement n'est active. Les e-mails ne sont interceptés que si `SMTP_HOST` n'est pas défini et que `NODE_ENV` n'est pas en production. | Supprimez `SMTP_HOST` en développement, ou consultez la boîte de réception réelle. |
| `INVALID_CHANGE` | 400 | La modification de schéma proposée n'est pas bien formée. | Consultez le message. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'application d'une modification de schéma planifiée a échoué pour une raison non couverte par des codes plus précis. | Consultez le message ; il contient textuellement l'échec sous-jacent. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modification est valide mais ne peut pas être appliquée au schéma dans son état actuel. | Consultez le message. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Le dépôt contient des modifications non validées (uncommitted), empêchant d'appliquer la modification en toute sécurité. | Faites un commit ou un stash, puis réessayez. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'éditeur de schéma a refusé la modification. | Consultez le message ; il s'agit du refus explicite émis par l'éditeur. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Une clé d'API ou un autre identifiant machine a tenté d'appliquer une modification de schéma. | Connectez-vous en tant qu'utilisateur, ou activez `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La modification de schéma à chaud nécessite `collectionsDir` ou `liveSchema.repository`, et ce serveur a démarré sans aucun des deux. | Configurez l'un des deux paramètres. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planification fonctionne ; aucun dépôt n'est configuré pour valider la modification. | Configurez `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Ce pilote ne peut pas planifier de modifications de schéma. | La modification à chaud est disponible sur Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Les collections sont ici déduites par introspection de la base de données, il n'y a donc aucun fichier source à éditer. | Modifiez le schéma au moyen d'une migration. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'éditeur de schéma est désactivé sur ce serveur. | Activez-le avec `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'éditeur de schéma nécessite `ts-morph`, qui n'est pas installé. | Exécutez `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Le serveur n'a pas de `collectionsDir`, l'éditeur n'a donc aucun répertoire cible où écrire. | Définissez `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'éditeur est désactivé avec `NODE_ENV=production` : les fichiers d'un serveur déployé sont reconstruits depuis votre dépôt à chaque déploiement, toute modification effectuée ici serait donc écrasée. | Modifiez les collections en développement et déployez-les. |

## Codes génériques

Une route utilise l'un de ces codes lorsqu'aucun autre plus précis ne s'applique.

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Requête mal formée, sans code plus spécifique applicable. | Consultez le message. |
| `UNAUTHORIZED` | 401 | Non authentifié, ou identifiant rejeté. | Connectez-vous ou actualisez la session. |
| `FORBIDDEN` | 403 | Authentifié, mais non autorisé. | Réessayer avec la même identité ne servira à rien. |
| `CONFLICT` | 409 | Conflit avec l'état actuel de la ressource. | Consultez le message. |
| `INTERNAL_ERROR` | 500 | Une erreur est survenue sur le serveur. Le message est volontairement générique. | Notez le `requestId` ; la cause détaillée se trouve dans les logs. |
| `NOT_CONFIGURED` | 503 | Une dépendance requise par cette route n'est pas configurée sur ce serveur. | Consultez le message. |
| `SERVICE_UNAVAILABLE` | 503 | Une dépendance est inaccessible. | Réessayez ; consultez les logs. |

## Garantir l'exactitude de cette page

La commande `pnpm verify:docs` échoue si un code pouvant être levé par le serveur manque dans ces tableaux, si un tableau répertorie un code qu'aucun composant ne peut lever, si un statut indiqué diffère du code source, ou si une famille de codes comme `PG_<SQLSTATE>` ne possède pas de ligne pour un SQLSTATE que les appelants peuvent rencontrer. L'étape de validation se trouve dans `tooling/scripts/docs-verify/check-error-codes.mjs`.

Ce script s'auto-contrôle au préalable. L'analyse lit les codes directement depuis le code TypeScript plutôt qu'à partir d'un serveur en exécution ; par construction, ses angles morts sont donc silencieux : par le passé, il a déjà échoué à détecter un code encapsulé dans une fonction d'une ligne, ou écrit à la suite d'un message contenant un `)`, et concluait que « chaque code susceptible d'être levé par le serveur est documenté » alors qu'il en manquait dix-sept sur la page. Désormais, l'outil exécute une fixture reproduisant exactement ces cas avant d'analyser cette page, et refuse de rendre son rapport s'il ne parvient pas à les détecter.

---
