---
sourceHash: b82ed0c23d6537de
title: Codes d'erreur
sidebar_label: Codes d'erreur
description: Tous les codes d'erreur qu'un backend Rebase peut renvoyer, avec leur statut HTTP, leur signification et la marche à suivre — ainsi que l'enveloppe de réponse, X-Request-ID et les règles applicables à details.
---

Chaque échec renvoyé par un backend Rebase utilise une enveloppe unique et comporte un `code` stable. Le code est l'élément sur lequel créer un branchement conditionnel : le message est écrit pour un humain et peut être reformulé, le statut est partagé par une douzaine de problèmes différents, alors que le code n'est ni l'un ni l'autre.

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

- **`message`** — lisible par un humain. Pour un code `4xx`, il s'agit du message propre au serveur ; pour un `5xx`, il est délibérément générique, car le texte sous-jacent peut citer un hôte, un rôle ou un nom de colonne.
- **`code`** — l'une des valeurs ci-dessous. Stable à travers les versions mineures.
- **`details`** — optionnel, et jamais garanti. Voir les règles ci-dessous.
- **`requestId`** — présent dès lors que la requête est passée par le middleware de request-ID, ce qui correspond à chaque route sous `basePath`.

### `X-Request-ID`

Chaque requête sous `basePath` reçoit un identifiant : l'en-tête `X-Request-ID` de l'appelant lorsqu'il s'agit d'un UUID v4 valide, sinon un nouvel identifiant généré. Il est renvoyé dans la réponse sous le nom de `X-Request-ID`, inclus dans l'enveloppe d'erreur en tant que `requestId`, et rattaché à la ligne de log du serveur pour cette requête.

C'est la clé de jointure. Citez-la dans un rapport de bug et un opérateur pourra retrouver la ligne de log exacte qui explique l'échec, contenant la raison qui n'a jamais été montrée au client.

Envoyer le vôtre permet à une trace de survivre à un saut : une passerelle ou un exécuteur de tâches qui transfère l'en-tête conserve un ID unique à travers chaque service ayant traité la requête. Une valeur invalide est ignorée plutôt que rejetée — un en-tête malformé provenant d'un appelant ne justifie pas l'échec d'une requête — ne présumez donc pas que l'ID envoyé est l'ID obtenu. Lisez l'en-tête de réponse.

### Ce que contient `details`

`details` a une visée diagnostique, et non contractuelle. Trois règles l'encadrent :

1. **Tout ce qu'une route définit explicitement est toujours renvoyé.** Il s'agit des erreurs de l'appelant décrites avec précision : quel champ de filtre était inconnu, quelle relation n'est pas modifiable en écriture, quelle valeur ne correspondait pas à son type.
2. **Les diagnostics de base de données sont tronqués en production.** Lorsque l'échec provient de Postgres, `details.dbCode` — le SQLSTATE — est toujours présent : il nomme la classe de problème et ne révèle rien sur les données. `dbMessage`, `detail` et `hint` ne sont ajoutés que lorsque `NODE_ENV` n'est pas `production`, car Postgres y insère le contenu des lignes. `23505` rapporte `Key (email)=(a@b.c) already exists.`, ce qui répond à « cette personne est-elle inscrite ? » pour n'importe quelle adresse que quelqu'un souhaiterait tester.
3. **Ne faites jamais de branchement conditionnel sur `details`.** Faites-le sur `code`. Le contenu de `details` correspond à ce qui était utile à une personne à cet endroit précis du code, et cela peut changer.

## Comprendre un statut

| Statut | Ce qu'il indique à propos de la requête |
| --- | --- |
| `400` | Malformée, ou demandant quelque chose qui n'existe pas dans le schéma. Corrigez la requête. |
| `401` | Non authentifié, ou identifiant expiré. Connectez-vous ou actualisez la session. |
| `403` | Authentifié, mais non autorisé. Réessayer avec la même identité ne servira à rien. |
| `404` | Route, collection ou ligne inexistante — ou ligne masquée par la sécurité au niveau des lignes (row-level security). |
| `409` | Conflit avec l'état existant : un doublon ou une écriture concurrente. |
| `413` `415` `422` | Le corps est trop volumineux, le type de média est incorrect, ou rejeté sémantiquement. |
| `429` | Limite de débit atteinte (rate limit). Ralentissez la cadence ; le message indique pendant combien de temps. |
| `500` | Le serveur ou sa base de données est en défaut, pas l'appelant. Consultez les logs. |
| `501` | La route existe, mais ce déploiement ne peut pas la servir — une fonctionnalité désactivée ou non configurée. |
| `502` `503` `504` | Une dépendance était inaccessible, non configurée ou trop lente. |

## Authentification et comptes

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route nécessite un second facteur et la session n'en a qu'un seul. | Complétez le défi MFA, puis réessayez. |
| `ALREADY_VERIFIED` | 400 | L'adresse ou le facteur est déjà vérifié. | Rien — l'état souhaité est déjà effectif. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | La connexion anonyme est désactivée sur ce serveur. | Activez-la, ou connectez-vous avec une véritable identité. |
| `API_KEY_FORBIDDEN` | 403 | Une clé d'API a été utilisée sur une route réservée aux humains. | Utilisez une session utilisateur. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Une clé d'API a tenté de créer, lister ou révoquer des clés d'API. | Gérez les clés en tant qu'administrateur connecté. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Une route protégée s'est exécutée sans middleware d'authentification Rebase en amont, de sorte que les identifiants de l'appelant n'ont jamais été vérifiés. | Montez l'application via le routeur de fonctions plutôt que directement sur votre propre serveur. |
| `BOOTSTRAP_ANONYMOUS` | 403 | L'initialisation (bootstrap) du premier administrateur a été tentée par un appelant anonyme. | Connectez-vous d'abord. |
| `BOOTSTRAP_COMPLETED` | 403 | Le premier administrateur existe déjà. | Demandez à un administrateur existant d'accorder le rôle. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | L'initialisation est réservée au tout premier utilisateur, et ce n'est pas celui-ci. | Demandez à un administrateur existant d'accorder le rôle. |
| `CAPTCHA_FAILED` | 400 | Le fournisseur a rejeté le jeton CAPTCHA. | Résolvez un nouveau test CAPTCHA. |
| `CAPTCHA_REQUIRED` | 400 | La route nécessite un jeton CAPTCHA et aucun n'a été transmis. | Incluez le jeton. |
| `CHALLENGE_EXHAUSTED` | 401 | Trop de codes incorrects saisis pour un même défi MFA. | Démarrez un nouveau défi. |
| `EMAIL_EXISTS` | 409 | Un compte avec cette adresse existe déjà. | Connectez-vous, ou lancez une réinitialisation de mot de passe. |
| `EMAIL_NOT_CONFIGURED` | 503 | Des liens magiques ou des OTP ont été demandés et le serveur ne dispose d'aucun transport d'e-mail. | Configurez SMTP, ou utilisez une autre méthode de connexion. |
| `EMAIL_NOT_VERIFIED` | 403 | Le compte existe et son adresse n'est pas vérifiée. | Vérifiez l'adresse. |
| `FACTOR_NOT_VERIFIED` | 400 | Le facteur MFA a été enregistré mais jamais confirmé. | Confirmez le facteur. |
| `IDENTITY_ALREADY_LINKED` | 409 | Cette identité OAuth appartient à un autre compte. | Connectez-vous avec celle-ci, ou dissociez-la d'abord de cet autre compte. |
| `INVALID_ACCOUNT` | 400 | Le compte est dans un état sur lequel cette opération ne peut pas agir. | Consultez le message. |
| `INVALID_CHALLENGE` | 400 | Le défi MFA est inconnu ou a expiré. | Démarrez-en un nouveau. |
| `INVALID_CODE` | 401 | Le code OTP ou MFA est incorrect. | Réessayez avec le code actuel. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou mot de passe incorrect — sans préciser lequel de manière intentionnelle. | Réessayez, ou réinitialisez le mot de passe. |
| `INVALID_TOKEN` | 400 | Un jeton de vérification, de réinitialisation ou de lien magique est malformé ou inconnu. | Demandez un nouveau lien. |
| `LAST_ADMIN` | 403 | Cette modification laisserait le projet sans aucun administrateur. | Promouvez d'abord quelqu'un d'autre. |
| `MFA_REQUIRED` | 401 | Le mot de passe était correct et le compte possède un second facteur vérifié, la connexion n'est donc qu'à moitié achevée. `details` contient un jeton à durée de vie courte restreint au défi MFA — il ne s'agit pas d'une session. | Ouvrez un défi et validez-le ; la réponse au défi délivre la session. |
| `NO_SESSION` | 401 | Aucun cookie de session ou jeton d'actualisation (refresh token) n'a été fourni. Normal lors d'un premier chargement de page. | Connectez-vous. |
| `NOT_ANONYMOUS` | 400 | Une route de mise à niveau depuis le statut anonyme a été appelée par un compte réel. | Rien à mettre à niveau. |
| `OAUTH_ERROR` | 401 | Le fournisseur OAuth a refusé la requête ou a renvoyé une erreur. | Réessayez le flux ; le message indique le motif du fournisseur. |
| `RATE_LIMITED` | 429 | Trop de tentatives de la part de cet appelant. | Ralentissez la cadence ; le message indique pendant combien de temps. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | La cible de redirection ne figure pas sur la liste autorisée. | Ajoutez-la à la configuration du fournisseur. |
| `REGISTRATION_DISABLED` | 403 | L'inscription en libre-service est désactivée. | Demandez à un administrateur de créer le compte. |
| `ROLE_EXISTS` | 409 | Ce nom de rôle est déjà pris. | Choisissez un autre nom. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossible de lire les rôles pour une requête réservée aux administrateurs. Verrouillage par défaut (fail-closed) plutôt que de faire confiance à la revendication (claim) du jeton. | Réessayez ; vérifiez la base de données. |
| `SELF_DELETE` | 400 | Un administrateur a tenté de supprimer son propre compte. | Demandez à un autre administrateur de le faire. |
| `SESSION_REVOKED` | 401 | La session a été déconnectée ailleurs, ou toutes les sessions ont été révoquées. | Connectez-vous à nouveau. |
| `SETUP_REQUIRED` | 403 | Le projet n'a pas encore d'administrateur, cette route n'est donc pas disponible. | Terminez la configuration du premier administrateur. |
| `TOKEN_ALREADY_USED` | 401 | Un jeton à usage unique a été rejoué. | Demandez-en un nouveau. |
| `TOKEN_EXPIRED` | 401 | Le jeton a dépassé sa durée de validité. | Demandez-en un nouveau. |
| `USER_NOT_FOUND` | 404 | Aucun compte avec cet identifiant. | Vérifiez l'identifiant. |
| `WEAK_PASSWORD` | 400 | Le mot de passe ne respecte pas la politique configurée. | Choisissez un mot de passe plus robuste. |

## Données, requêtes et écritures

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Ce pilote ne peut pas calculer l'agrégat demandé. | Utilisez un pilote capable de le faire, ou calculez-le côté client. |
| `BRANCHING_UNSUPPORTED` | — | Une branche de base de données a été demandée via le websocket de Studio sur la base de données de développement managée (PGlite), où une branche *est* le parent et rien ne serait isolé. Le refus est le même que celui affiché par `rebase db branch`. | Faites pointer `DATABASE_URL` vers votre propre instance Postgres (`rebase dev --docker` en lance une) et branchez à partir de là. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contient plus d'opérations que la limite par lot (1000 par défaut). Un lot constitue une transaction unique et maintient ses verrous pendant toute sa durée. | Envoyez-le par morceaux ; le message indique la limite ainsi que votre total. |
| `BATCH_UNSUPPORTED` | 400 | Le pilote de ce backend ne peut pas effectuer d'écritures atomiques à travers plusieurs collections, et une boucle d'écritures individuelles ne serait ni atomique ni effectuée en un seul aller-retour. | Envoyez les écritures sous forme de requêtes distinctes ou via des appels `/bulk` par collection. |
| `BULK_TOO_LARGE` | 400 | Le corps de la requête groupée dépasse la limite d'éléments configurée. | Divisez la requête. |
| `BULK_UNSUPPORTED` | 400 | Cette collection ou ce pilote ne prend pas en charge les écritures groupées (bulk). | Écrivez les lignes une par une. |
| `CALLBACK_REJECTED` | 400 | Un callback de collection a refusé l'écriture. Un `throw` depuis `beforeSave`/`beforeDelete`/`after*` produit un 400 contenant le message de son auteur ; un `beforeDelete` qui renvoie `false` produit un 403. `details.stage` indique le callback en cause, `details.path` la collection. | Lisez le message — il a été rédigé par ce projet, pas par Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` a été combiné avec `?offset=` ou `?page=`. Un curseur indique déjà où la page commence, par conséquent un offset appliqué par-dessus ignore silencieusement autant de lignes après le curseur — un écart que l'appelant ne peut pas voir dans la réponse. | Utilisez l'un ou l'autre. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` a été combiné avec une recherche ou une requête vectorielle. Les deux attribuent un score par ligne, de sorte que deux lignes ne sont jamais identiques et `DISTINCT` ne fusionnerait rien — cela semblerait fonctionner sans rien modifier. | Supprimez l'un des deux. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Une lecture `distinct` est ordonnée selon une colonne qu'elle ne renvoie pas. Un `SELECT DISTINCT` ne peut être ordonné que par les colonnes présentes dans sa liste de sélection, sinon les lignes fusionnées n'ont pas d'ordre défini. `details.fields` les énumère. | Ajoutez ces champs à `?fields=`, ou retirez-les de `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres a refusé l'instruction (`42501`) : soit une stratégie de sécurité au niveau des lignes refusant ce rôle, soit un `GRANT` manquant. | Voir [Dépannage](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Un filtre, un `orderBy`, `fields`, un `select` d'agrégation ou un `groupBy` mentionne un champ que les rôles de cet appelant ne peuvent pas lire (`access.read`). Un champ qu'aucune réponse ne peut contenir doit être un champ qu'aucune requête ne peut interroger, sinon la valeur devient déductible prédicat par prédicat. `details.violations` liste chaque champ. | Retirez le champ de la requête, ou obtenez le rôle requis. Voir [Accès aux champs](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Le corps de la requête définit un champ que les rôles de cet appelant ne peuvent pas modifier en écriture (`access.write`). Refusé plutôt qu'ignoré : une écriture qui écarterait un champ renverrait un succès pour une modification qui n'a pas eu lieu. `details.violations` liste chaque champ. | Supprimez le champ, ou obtenez le rôle requis. Un champ que personne ne peut modifier renvoie `VALIDATION_EXCLUDED_FIELDS` à la place. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Une requête antérieure avec la même `Idempotency-Key` est toujours en cours d'exécution. | Réessayez une fois celle-ci terminée. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La même `Idempotency-Key` a été envoyée avec un corps différent. | Utilisez une nouvelle clé, ou envoyez le corps d'origine. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` a indiqué une fonction autre que `count`, `sum`, `avg`, `min` ou `max`. | Utilisez l'une d'entre elles ; le message en dresse la liste. |
| `INVALID_AGGREGATE_SELECT` | 400 | Une entrée de `?select=` n'est pas sous la forme `fn(field)`, ou une fonction autre que `count()` n'a reçu aucun champ. | Écrivez `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | Une opération de `/_batch` omet `op`, `collection`, `values` ou `id`, nomme une collection que ce backend ne dessert pas, ou réutilise un nom de `ref`. | Consultez le message ; il identifie l'opération par son index. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` ne correspond à aucune opération antérieure, pointe vers l'avant, ou réclame un champ que la ligne référencée ne possède pas. Seules les références vers l'arrière sont résolues. | Nommez l'opération avec `ref` *avant* de la référencer. |
| `INVALID_BULK_BODY` | 400 | Le corps de la requête groupée n'a pas la structure attendue. | Envoyez le tableau `items` documenté. |
| `INVALID_CONFLICT_TARGET` | 400 | Le paramètre `on_conflict` / `onConflict` d'un upsert nomme des colonnes sans garantie d'unicité, ou les nomme sans `upsert: true`. Sans cela, Postgres renverrait l'erreur 42P10 depuis l'intérieur d'une transaction ayant déjà effectué du travail. | Déclarez `validation: { unique: true }` ou un index `unique` ; le message énumère les cibles existantes. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` n'est ni `include` ni `only`. Refusé plutôt qu'ignoré : une faute de frappe telle que `?deleted=true` masquant discrètement toutes les lignes supprimées semblerait fonctionner tout en répondant à la question inverse. | Envoyez `include` (actives et supprimées) ou `only` (supprimées uniquement). Omettez-le pour les lignes actives uniquement. |
| `INVALID_DISTINCT` | 400 | `?distinct=` n'est pas `true` ou `false`. | Envoyez l'une de ces valeurs ; `1` et `0` sont également acceptés. |
| `INVALID_FIELD_OPERATION` | 400 | Une opération `$inc` / `$push` / `$pull` / `$merge` a été utilisée sur un type de propriété pour lequel elle n'est pas définie, avec un opérande de format incorrect, avec deux opérateurs sur un même champ, mal orthographiée, ou lors d'une création — où aucune valeur stockée n'existe encore pour opérer. | Voir [Écriture via REST](/docs/backend/writes/#field-operations) ; le message nomme le champ. |
| `INVALID_FILTER_FIELD` | 400 | Le filtre nomme une propriété que cette collection ne possède pas. | Vérifiez l'orthographe par rapport à la collection. |
| `INVALID_FILTER_OPERATOR` | 400 | L'opérateur n'est pas pris en charge par ce type de propriété. | Voir [Interrogation des données](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Une valeur de filtre ne peut pas être interprétée selon le type de la colonne à laquelle elle est comparée : `?id=eq.abc` sur une clé entière, une étiquette absente de l'enum, un horodatage non valide, un nombre hors limites pour ce type. `details.dbCode` contient le SQLSTATE. | Envoyez une valeur correspondant au type de la colonne. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` n'est ni `true` ni `false`. Toute autre valeur est refusée plutôt qu'interprétée comme un « non » — une faute de frappe effectuant une suppression réversible (soft-delete) alors que l'appelant demandait une purge définitive lui ferait croire à tort que les données ont disparu. | Envoyez `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` est malformé : il ne s'agit pas d'une liste de chemins valide, ou l'imbrication dépasse la profondeur maximale. Erreur interceptée à la frontière de l'API plutôt que de laisser le pilote lever une 500. | Consultez le message ; il indique le chemin en cause. |
| `INVALID_INPUT` | 400 | Le corps de la requête n'a pas passé la validation. | Consultez le message. |
| `INVALID_LIMIT` | — | Un abonnement en temps réel a demandé une limite hors de la plage autorisée. Délivré sous forme de trame WebSocket `ERROR`, et non d'une réponse HTTP. | Réduisez la limite. |
| `INVALID_LOGICAL_GROUP` | 400 | Un groupe `?or=` / `?and=` est malformé ou imbriqué au-delà de la profondeur autorisée. | Consultez le message ; il montre la règle d'aplatissement. |
| `INVALID_OFFSET` | 400 | `?offset=` n'est pas un nombre entier supérieur ou égal à 0. | Envoyez un entier positif ou nul. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` n'est ni `field`, ni `field:desc`, ni un tableau JSON de `{ field, direction }`. | Consultez le message ; il présente les trois syntaxes possibles. |
| `INVALID_PAGE` | 400 | `?page=` n'est pas un entier supérieur ou égal à 1. La pagination commence à 1, donc `?page=0` constitue une erreur et non la première page. | Envoyez `1` ou plus, ou utilisez `?offset=`. |
| `INVALID_PARAM` | 400 | Un paramètre de requête est malformé. | Consultez le message. |
| `INVALID_VECTOR` | 400 | `?vector=` n'est pas un tableau JSON de nombres. | Envoyez `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` n'est ni `cosine`, ni `l2`, ni `inner_product`. | Utilisez l'une de ces trois valeurs. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` n'est pas un nombre. | Envoyez un nombre. |
| `INVALID_WHERE` | 400 | `?where=` n'est pas un objet JSON associant des champs à des conditions. | Envoyez `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route d'agrégation a été appelée sans `?select=`. | Ajoutez-en un, par ex. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Le projet ne sert aucune collection : aucune n'est déclarée dans le code, et aucune table n'est disponible pour les dériver. | Créez des tables — via une migration, du SQL, ou un fichier de collection suivi de `rebase db push` — puis redémarrez. |
| `NOT_FOUND` | 404 | Aucune ligne avec cet identifiant dans cette collection — ou ligne masquée à cet appelant par la sécurité au niveau des lignes. | Vérifiez l'identifiant, puis les `securityRules` de la collection. |
| `UNKNOWN_RELATION` | 400 | `?include=` nomme un élément qui n'est pas une relation sur la collection. Ce même code renvoie un **404** lorsqu'un *chemin d'URL* imbriqué en nomme un à la place, par ex. `/api/data/authors/1/posts` où `authors` n'en déclare aucun — dans ce cas, l'URL ne pointe vers rien, il s'agit donc d'une ressource non trouvée plutôt que d'une requête malformée. | Vérifiez le nom de la relation — le message énumère celles dont dispose la collection. Une référence inverse doit être déclarée sur le parent pour pouvoir être parcourue. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | Le tri nomme une propriété qui ne peut pas être triée. | Triez sur une propriété adossée à une colonne. |
| `PAYLOAD_TOO_LARGE` | 413 | Le corps de la requête dépasse la limite configurée. | Envoyez moins de données, ou augmentez la limite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` a tenté d'effectuer une écriture. Une lecture liée à une requête s'exécute dans une transaction `READ ONLY`, de sorte que ni le callback ni ce qu'il appelle ne peut écrire. | Déplacez l'écriture hors de la lecture : une tâche de fond, ou `rebase.dataAsAdmin` depuis une tâche cron ou une fonction personnalisée. |
| `RELATION_MISCONFIGURED` | 500 | Une relation ne se résout pas par rapport au schéma enregistré. L'opération est refusée plutôt qu'ignorée : l'abandonner signalerait un succès pour une écriture qui n'a jamais eu lieu, ou un résultat vide pour des lignes existantes. | Exécutez `rebase schema generate` si le schéma généré est plus ancien que la base de données. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relation ne peut pas être déliée depuis ce côté. | Effectuez l'écriture depuis le côté propriétaire. |
| `RELATION_NOT_WRITABLE` | 400 | Le chemin imbriqué n'est pas une relation modifiable en écriture. | Voir [Relations](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Une écriture de relation ne disposait d'aucune clé source à laquelle rattacher le lien. | Enregistrez d'abord la ligne parente. |
| `SCHEMA_DRIFT` | 500 | Une table ou une colonne attendue par le code n'existe pas dans la base de données. | `rebase db push` en développement ; redéployez sur un tenant managé. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` a été combiné avec `orderBy: "_score"`. La pertinence est calculée par requête plutôt que stockée, elle ne peut donc pas servir de clé pour un curseur. | Paginez la pertinence avec `limit`/`offset`, ou ordonnez selon une colonne. |
| `TENANT_IMMUTABLE` | 400 | Une écriture déplacerait une ligne d'un tenant à un autre. Une ligne ne peut pas changer de tenant. `details.violations` indique le champ. | Créez la ligne dans l'autre tenant et supprimez celle-ci, ou écrivez avec un rôle présent dans `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | L'écriture désigne un tenant auquel cet appelant n'appartient pas ; la base de données la refuserait également. | Écrivez dans un tenant auquel l'appelant appartient, ou authentifiez-vous en tant qu'utilisateur qui en fait partie. |
| `TENANT_REQUIRED` | 400 | La collection est compartimentée par tenant (tenant-scoped) et le tenant ne peut pas être déduit : la requête n'en comporte aucun, ou l'appelant appartient à plusieurs tenants. | Envoyez explicitement le champ du tenant, ou authentifiez-vous en tant qu'appelant n'appartenant qu'à un seul tenant. |
| `UNKNOWN_FIELD` | 400 | `?fields=` nomme un champ que la collection ne possède pas. | Vérifiez l'orthographe ; le message liste les champs valides. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un agrégat ou `groupBy` nomme un champ que la collection ne possède pas. | Vérifiez l'orthographe ; le message liste les champs valides. |
| `UNKNOWN_FILTER_FIELD` | 400 | Le filtre nomme un champ que cette collection — ou la cible d'une relation — ne possède pas. | Vérifiez l'orthographe ; le message liste les champs valides. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Le filtre nomme un opérateur qui n'existe pas. | Le message liste l'ensemble des opérateurs. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | Le tri nomme un champ que cette collection ne possède pas. | Vérifiez l'orthographe ; le message liste les champs valides. |
| `PRECONDITION_FAILED` | 412 | Un en-tête `If-Match` a indiqué une version de la ligne qui n'est plus à jour : quelqu'un l'a modifiée entre la lecture et cette écriture. Rien n'a été écrit. | Relisez la ligne, réappliquez la modification et envoyez le nouvel `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` demande un champ que la collection ne possède pas. | Vérifiez l'orthographe ; le message liste les champs connus. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Une recherche vectorielle a désigné une propriété qui n'est pas de type `vector` sur cette collection. | Le message liste les propriétés vectorielles de la collection. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Le `Content-Type` ne fait pas partie de ceux acceptés par cette route. | Envoyez le type documenté par la route. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Le filtre traverse une relation `via`, dont le chemin de jointure n'est défini que dans un seul sens, ne laissant aucun moyen de corréler une sous-requête en retour. | Filtrez depuis le côté propriétaire. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'opérateur n'est pas défini pour ce champ : une relation sans colonne sur cette ligne est filtrée par appartenance, et la correspondance insensible à la casse ne s'applique qu'au texte. | Consultez le message ; il détaille ce que le champ accepte. |
| `VALIDATION_CONSTRAINT` | 400 | Une valeur a enfreint une règle de `validation` déclarée par la propriété — longueur, intervalle, motif (pattern), champ obligatoire. | Consultez le message ; il indique chaque violation. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Le corps de la requête tente d'écrire dans une colonne marquée `excludeFromApi`, ou `access: { write: [] }` — une même règle sous deux syntaxes. Ces valeurs sont réservées au serveur : hachage de mot de passe, jeton de vérification. Contrairement à `FIELD_NOT_WRITABLE`, la réponse est identique pour chaque appelant, y compris `admin`. | Supprimez le champ. Voir [Accès aux champs](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Une valeur ne correspond pas au type de sa propriété. | Consultez le message ; il indique la propriété. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Le corps de la requête indique un champ que la collection ne possède pas — y compris un argument `id` sur une collection dont la clé primaire est autre. | Vérifiez l'orthographe ; le message liste les champs connus. |
| `WRITE_DENIED` | 403 | Une règle de sécurité ou une stratégie de sécurité au niveau des lignes a refusé l'écriture. | Vérifiez les `securityRules` de la collection. |

## `PG_<SQLSTATE>` — une contrainte refusée par la base de données

Une écriture rejetée par Postgres pour une raison liée aux *données de l'appelant* répond avec le SQLSTATE dans le code : `PG_23505`, `PG_23503`, et ainsi de suite. Il s'agit d'une famille et non d'une liste — Postgres définit des centaines de SQLSTATE — mais seules deux classes y parviennent, car seules ces deux-là relèvent de la responsabilité de l'appelant :

- **classe 23**, violation de contrainte d'intégrité : un doublon, une clé étrangère pointant vers le vide, une colonne NOT NULL laissée vide ;
- **classe 22**, exception de données : une valeur que le type de la colonne ne peut pas contenir.

Tout le reste — une connexion interrompue, une colonne manquante, un problème de privilèges — relève du serveur et reste un `500`. Par conséquent, `code.startsWith("PG_")` est un test fiable pour déterminer si « la ligne envoyée était incorrecte », et les quatre ci-dessous sont ceux qu'un client rencontre réellement. `details.dbCode` contient le même SQLSTATE pour chacun d'eux, et le message indique le nom de la contrainte.

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Une valeur n'a pas pu être interprétée selon le type de la colonne — le pendant côté écriture d'`INVALID_FILTER_VALUE`. | Envoyez une valeur correspondant au type de la colonne. |
| `PG_23502` | 400 | Une colonne `NOT NULL` a été laissée vide. | Envoyez le champ, ou attribuez une valeur par défaut à la colonne. |
| `PG_23503` | 400 | Une clé étrangère pointe vers une ligne inexistante. | Créez d'abord la ligne cible, ou corrigez l'identifiant. |
| `PG_23505` | 409 | Une contrainte d'unicité a été violée. Le message nomme la contrainte. | Utilisez une valeur différente, ou mettez à jour la ligne existante. |

## Stockage

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | Le nom du bucket est malformé. | Vérifiez le nom. |
| `INVALID_STORAGE_KEY` | 400 | La clé d'objet est malformée, ou sort de son préfixe. | Vérifiez la clé. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Les paramètres de transformation d'image sont hors limites ou contradictoires. | Voir [Stockage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Le téléversement dépasse la valeur `maxSize` déclarée par la propriété cible. Appliqué côté serveur, et pas seulement dans le navigateur. `details` contient la propriété, la limite et la taille réelle. | Téléversez un fichier plus petit, ou augmentez `maxSize` sur la propriété. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Le type du fichier téléversé ne figure pas dans `acceptedFiles` de la propriété. `details` contient la propriété, la liste autorisée et le type de contenu envoyé. | Téléversez un type accepté, ou élargissez `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | Aucun backend de stockage n'est configuré sur ce serveur. | Configurez S3, GCS ou le stockage local. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La source de stockage est déclarée mais ne dispose d'aucun identifiant ici. | Définissez les variables d'environnement de cette source. |
| `STORAGE_WRITE_FAILED` | 502 | Le backend de stockage a refusé ou abandonné l'écriture. | Vérifiez ses propres logs et identifiants. |
| `TRANSFORM_OVERLOADED` | 503 | Trop de transformations d'images sont en cours d'exécution. | Réessayez ; envisagez d'ajouter un CDN en amont. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | La requête a désigné une source de stockage (`?storageId=`) que ce projet ne déclare pas. Un `bucket` que ce déploiement ne dessert pas renvoie le même code avec un **404** — c'est l'espace de stockage qui est manquant, et `details` liste les buckets et les sources existants. Les deux renvoyaient auparavant « fichier non trouvé », identique à une clé simplement absente. | Déclarez la source dans `config/resources.ts`, ou vérifiez `GET /api/storage/sources`. |

## Fonctions personnalisées

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Aucune fonction portant ce nom n'est servie — ou une fonction existe, mais ses propres routes ne couvrent pas le chemin qui suit. Un appelant connecté est également informé de ce qui *est* servi ; un appelant anonyme ne l'est pas, car cette liste constitue l'inventaire de chaque point de terminaison personnalisé. Lorsqu'un fichier de ce nom n'a pas pu être chargé, le message l'indique : c'est la différence entre une faute de frappe et un déploiement défaillant. | Vérifiez le nom par rapport à `GET /api/functions`, ou vérifiez dans le log de démarrage si un fichier n'a pas pu être chargé. |
| `FUNCTION_TIMEOUT` | 504 | Le gestionnaire a dépassé son délai d'expiration (timeout). Il est toujours en cours d'exécution ; il ne peut pas être annulé d'ici. | Attribuez un `AbortSignal` aux appels sortants, ou augmentez `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Ce processus relaie les fonctions vers un autre processus qui n'a pas répondu. | Vérifiez que l'unité de fonctions fonctionne correctement. |

## Interfaces d'administration et modification de schéma

Ceux-ci indiquent qu'une fonctionnalité est désactivée ou non configurée plutôt que la requête était erronée. Chacun est également signalé sur la route `/status` correspondante avec un `200`, ce qui permet à un panneau d'administration de griser la fonctionnalité au lieu d'afficher une erreur.

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Une interface réservée aux administrateurs a été appelée sur un serveur sans authentification configurée, rien ne permettant de distinguer un administrateur d'un inconnu. | Définissez `auth.jwtSecret`, ou transmettez un `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | Le contrat du projet n'est servi que lorsque l'authentification est configurée — il décrit chaque table et relation. | Configurez l'authentification. `/meta/schema-version` est toujours servi. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Aucune boîte aux lettres de développement n'est active. Les e-mails ne sont capturés que lorsque `SMTP_HOST` n'est pas défini et que `NODE_ENV` n'est pas en production. | Supprimez la variable `SMTP_HOST` en développement, ou consultez la véritable boîte de réception. |
| `INVALID_CHANGE` | 400 | La modification de schéma proposée n'est pas bien formée. | Consultez le message. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'application d'une modification de schéma planifiée a échoué pour une raison que des codes plus spécifiques ne couvrent pas. | Consultez le message ; il s'agit de l'échec sous-jacent textuel. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modification est valide mais ne peut pas être appliquée au schéma en l'état. | Consultez le message. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Le dépôt contient des modifications non validées (uncommitted), la modification n'a donc pas pu être appliquée en toute sécurité. | Effectuez un commit ou un stash, puis réessayez. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'éditeur de schéma a refusé la modification. | Consultez le message ; il s'agit du refus propre à l'éditeur. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Une clé d'API ou un autre identifiant machine a tenté d'appliquer une modification de schéma. | Connectez-vous en tant qu'utilisateur, ou définissez `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La modification de schéma en direct nécessite `collectionsDir` ou `liveSchema.repository`, et ce serveur a été démarré sans aucun des deux. | Configurez-en un. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planification fonctionne ; il n'y a aucun dépôt dans lequel commiter la modification. | Configurez `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Ce pilote ne peut pas planifier de modifications de schéma. | La modification en direct est disponible sur Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Les collections sont ici introspectées à partir de la base de données, il n'y a donc aucun fichier source à modifier. | Modifiez le schéma à l'aide d'une migration. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'éditeur de schéma est désactivé pour ce serveur. | Activez-le avec `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'éditeur de schéma nécessite `ts-morph`, qui n'est pas installé. | `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Le serveur n'a pas de `collectionsDir`, l'éditeur n'a donc aucun emplacement où écrire. | Définissez `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'éditeur est désactivé sous `NODE_ENV=production` : les fichiers d'un serveur déployé sont reconstruits depuis votre dépôt à chaque déploiement, toute modification effectuée ici serait donc perdue. | Modifiez les collections en développement et déployez. |

## Codes génériques

Une route utilise l'un de ces codes lorsque rien de plus spécifique ne s'applique.

| Code | Statut | Signification | Action |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformée, et rien de plus précis ne s'applique. | Consultez le message. |
| `UNAUTHORIZED` | 401 | Non authentifié, ou identifiant rejeté. | Connectez-vous ou actualisez la session. |
| `FORBIDDEN` | 403 | Authentifié, mais non autorisé. | Réessayer avec la même identité ne servira à rien. |
| `CONFLICT` | 409 | Conflit avec l'état existant. | Consultez le message. |
| `INTERNAL_ERROR` | 500 | Une erreur est survenue sur le serveur. Le message est délibérément générique. | Citez le `requestId` ; la raison figure dans les logs. |
| `NOT_CONFIGURED` | 503 | Une dépendance nécessaire à cette route n'est pas configurée sur ce serveur. | Consultez le message. |
| `SERVICE_UNAVAILABLE` | 503 | Une dépendance était inaccessible. | Réessayez ; vérifiez les logs. |

## Maintenir l'exactitude de cette page

`pnpm verify:docs` échoue lorsqu'un code que le serveur peut déclencher est absent de ces tableaux, lorsqu'un tableau répertorie un code que rien ne peut déclencher, lorsqu'un statut indiqué ne concorde pas avec le code source, ou lorsqu'une famille de codes comme `PG_<SQLSTATE>` ne possède pas de ligne pour un SQLSTATE rencontré par les appelants. L'étape correspondante est `tooling/scripts/docs-verify/check-error-codes.mjs`.

Elle s'auto-vérifie d'abord. L'analyse extrait les codes directement du TypeScript plutôt que d'un serveur en cours d'exécution, de sorte que ses angles morts sont silencieux par conception : il lui est arrivé de ne pas détecter un code transmis via un wrapper d'une ligne, ou un code écrit après un message contenant une `)`, et d'affirmer que « chaque code que le serveur peut déclencher est documenté » sur une page à laquelle il en manquait dix-sept. Par conséquent, l'étape exécute une fixture reprenant précisément ces cas de figure avant de lire cette page, et refuse de rapporter quoi que ce soit si elle ne parvient pas à les détecter.

---
