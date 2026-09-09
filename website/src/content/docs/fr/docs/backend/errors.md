---
sourceHash: b82ed0c23d6537de
title: Codes d'erreur
sidebar_label: Codes d'erreur
description: Tous les codes d'erreur qu'un backend Rebase peut renvoyer, avec leur statut HTTP, leur signification et la marche à suivre — ainsi que l'enveloppe de réponse, X-Request-ID et les règles relatives aux détails.
---

Chaque échec renvoyé par un backend Rebase utilise une enveloppe unique et comporte un `code` stable. C'est sur ce code qu'il faut baser vos conditions : le message est rédigé pour un humain et peut être reformulé, le statut est partagé par une douzaine de problèmes différents, tandis que le code n'est ni l'un ni l'autre.

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

- **`message`** — lisible par un humain. Pour une erreur `4xx`, il s'agit du message propre au serveur ; pour une `5xx`, il est délibérément générique, car le texte sous-jacent peut citer un hôte, un rôle ou un nom de colonne.
- **`code`** — l'une des valeurs ci-dessous. Stable au fil des versions mineures.
- **`details`** — facultatif, et jamais garanti. Consultez les règles ci-dessous.
- **`requestId`** — présent dès lors que la requête est passée par le middleware d'identifiant de requête, ce qui est le cas pour chaque route sous `basePath`.

### `X-Request-ID`

Chaque requête sous `basePath` reçoit un identifiant : l'en-tête `X-Request-ID` de l'appelant lorsqu'il s'agit d'un UUID v4 valide, ou un nouvel identifiant dans le cas contraire. Il est renvoyé dans la réponse sous la forme `X-Request-ID`, inclus dans l'enveloppe d'erreur sous le nom `requestId`, et attaché à la ligne de log du serveur pour cette requête.

C'est la clé de jointure. Citez-la dans un rapport de bug et un opérateur pourra retrouver l'unique ligne de log expliquant la défaillance, contenant la raison qui n'a jamais été montrée au client.

Envoyer votre propre identifiant permet à une trace de survivre à un saut réseau : une passerelle ou un exécuteur de tâches qui transmet l'en-tête conserve un identifiant unique à travers chaque service ayant traité la requête. Une valeur invalide est ignorée plutôt que rejetée — un en-tête malformé provenant d'un appelant ne mérite pas de faire échouer une requête — ne présumez donc pas que l'identifiant envoyé est celui que vous recevrez. Lisez l'en-tête de réponse.

### Ce que contient `details`

Le champ `details` a une visée diagnostique, et non contractuelle. Trois règles le régissent :

1. **Tout ce qu'une route définit explicitement est toujours renvoyé.** Il s'agit des erreurs propres à l'appelant décrites précisément : quel champ de filtre était inconnu, quelle relation n'est pas modifiable, quelle valeur ne correspondait pas à son type.
2. **Les diagnostics de base de données sont épurés en production.** Lorsque l'erreur provient de Postgres, `details.dbCode` — le SQLSTATE — est toujours présent : il nomme la catégorie du problème et ne révèle rien sur les données. `dbMessage`, `detail` et `hint` ne sont ajoutés que lorsque `NODE_ENV` n'est pas `production`, car Postgres y inclut le contenu des lignes. Le code `23505` indique `Key (email)=(a@b.c) already exists.`, ce qui répond à la question « cette personne est-elle inscrite ? » pour n'importe quelle adresse testée.
3. **Ne basez jamais vos conditions sur `details`.** Basez-les sur `code`. Le contenu de `details` correspond à ce qui était utile pour un humain à cet endroit précis du code, et cela peut changer.

## Interpréter un statut

| Statut | Ce qu'il indique sur la requête |
| --- | --- |
| `400` | Malformée, ou demandant un élément inexistant dans le schéma. Corrigez la requête. |
| `401` | Non authentifié, ou identifiant expiré. Connectez-vous ou actualisez la session. |
| `403` | Authentifié, mais non autorisé. Réessayer avec la même identité ne servira à rien. |
| `404` | Route, collection ou ligne inexistante — ou ligne masquée par la sécurité au niveau des lignes (RLS). |
| `409` | Conflit avec l'état existant : doublon ou écriture concurrente. |
| `413` `415` `422` | Corps trop volumineux, mauvais type de média ou rejet sémantique. |
| `429` | Limite de débit atteinte (rate limit). Patientez ; le message précise pendant combien de temps. |
| `500` | L'erreur provient du serveur ou de sa base de données, pas de l'appelant. Consultez les logs. |
| `501` | La route existe, mais ce déploiement ne peut pas la traiter — fonctionnalité désactivée ou non configurée. |
| `502` `503` `504` | Une dépendance était inaccessible, non configurée ou trop lente. |

## Authentification et comptes

| Code | Statut | Signification | Que faire |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La route nécessite un second facteur et la session n'en possède qu'un. | Complétez le défi MFA, puis réessayez. |
| `ALREADY_VERIFIED` | 400 | L'adresse ou le facteur est déjà vérifié. | Rien — l'état souhaité est déjà atteint. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | La connexion anonyme est désactivée sur ce serveur. | Activez-la, ou connectez-vous avec une véritable identité. |
| `API_KEY_FORBIDDEN` | 403 | Une clé API a été utilisée sur une route réservée aux utilisateurs réels. | Utilisez une session utilisateur. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Une clé API a tenté de créer, lister ou révoquer des clés API. | Gérez les clés en tant qu'administrateur connecté. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Une route protégée a été exécutée sans middleware d'authentification Rebase en amont, les identifiants de l'appelant n'ont donc jamais été examinés. | Montez l'application via le routeur de fonctions plutôt que directement sur votre propre serveur. |
| `BOOTSTRAP_ANONYMOUS` | 403 | L'initialisation du premier administrateur a été tentée par un appelant anonyme. | Connectez-vous d'abord. |
| `BOOTSTRAP_COMPLETED` | 403 | Le premier administrateur existe déjà. | Demandez à un administrateur existant d'accorder le rôle. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | L'initialisation est réservée au tout premier utilisateur, ce qui n'est pas le cas ici. | Demandez à un administrateur existant d'accorder le rôle. |
| `CAPTCHA_FAILED` | 400 | Le fournisseur a rejeté le jeton CAPTCHA. | Résolvez un nouveau défi. |
| `CAPTCHA_REQUIRED` | 400 | La route requiert un jeton CAPTCHA et aucun n'a été transmis. | Incluez le jeton. |
| `CHALLENGE_EXHAUSTED` | 401 | Trop de codes erronés saisis pour ce défi MFA. | Démarrez un nouveau défi. |
| `EMAIL_EXISTS` | 409 | Un compte avec cette adresse e-mail existe déjà. | Connectez-vous ou initiez une réinitialisation de mot de passe. |
| `EMAIL_NOT_CONFIGURED` | 503 | Des liens magiques ou des OTP ont été demandés, mais le serveur n'a pas de transport d'e-mails configuré. | Configurez SMTP ou utilisez une autre méthode de connexion. |
| `EMAIL_NOT_VERIFIED` | 403 | Le compte existe et son adresse e-mail n'est pas vérifiée. | Vérifiez l'adresse e-mail. |
| `FACTOR_NOT_VERIFIED` | 400 | Le facteur MFA a été enregistré mais jamais confirmé. | Confirmez le facteur. |
| `IDENTITY_ALREADY_LINKED` | 409 | Cette identité OAuth appartient à un autre compte. | Connectez-vous avec celle-ci, ou dissociez-la d'abord sur l'autre compte. |
| `INVALID_ACCOUNT` | 400 | Le compte est dans un état qui ne permet pas cette opération. | Consultez le message. |
| `INVALID_CHALLENGE` | 400 | Le défi MFA est inconnu ou expiré. | Démarrez-en un nouveau. |
| `INVALID_CODE` | 401 | Le code OTP ou MFA est incorrect. | Réessayez avec le code actuel. |
| `INVALID_CREDENTIALS` | 401 | E-mail ou mot de passe incorrect — sans préciser délibérément lequel. | Réessayez ou réinitialisez le mot de passe. |
| `INVALID_TOKEN` | 400 | Un jeton de vérification, de réinitialisation ou de lien magique est malformé ou inconnu. | Demandez un nouveau lien. |
| `LAST_ADMIN` | 403 | La modification laisserait le projet sans administrateur. | Promouvez quelqu'un d'autre au préalable. |
| `MFA_REQUIRED` | 401 | Le mot de passe était correct et le compte possède un second facteur vérifié, la connexion n'est donc qu'à moitié terminée. `details` contient un jeton à durée de vie courte propre au défi MFA — il ne s'agit pas d'une session. | Ouvrez un défi et validez-le ; la réponse au défi délivrera la session. |
| `NO_SESSION` | 401 | Aucun cookie de session ni jeton de rafraîchissement n'a été présenté. Normal lors du premier chargement d'une page. | Connectez-vous. |
| `NOT_ANONYMOUS` | 400 | Une route de mise à niveau depuis un statut anonyme a été appelée par un compte réel. | Rien à mettre à niveau. |
| `OAUTH_ERROR` | 401 | Le fournisseur OAuth a refusé la requête ou a renvoyé une erreur. | Réessayez le flux ; le message contient la raison fournie par le prestataire. |
| `RATE_LIMITED` | 429 | Trop de tentatives effectuées par cet appelant. | Patientez ; le message indique pendant combien de temps. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | L'URI de redirection ne figure pas dans la liste autorisée. | Ajoutez-la à la configuration du fournisseur. |
| `REGISTRATION_DISABLED` | 403 | L'inscription en libre-service est désactivée. | Demandez à un administrateur de créer le compte. |
| `ROLE_EXISTS` | 409 | Ce nom de rôle est déjà pris. | Choisissez un autre nom. |
| `ROLE_LOOKUP_FAILED` | 503 | Impossible de lire les rôles pour une requête restreinte aux administrateurs. Échoue par sécurité plutôt que de faire confiance aux revendications (claims) du jeton. | Réessayez ; vérifiez la base de données. |
| `SELF_DELETE` | 400 | Un administrateur a tenté de supprimer son propre compte. | Demandez à un autre administrateur de le faire. |
| `SESSION_REVOKED` | 401 | La session a été fermée ailleurs, ou toutes les sessions ont été révoquées. | Reconnectez-vous. |
| `SETUP_REQUIRED` | 403 | Le projet n'a pas encore d'administrateur, cette route n'est donc pas disponible. | Effectuez la configuration du premier administrateur. |
| `TOKEN_ALREADY_USED` | 401 | Un jeton à usage unique a été rejoué. | Demandez-en un nouveau. |
| `TOKEN_EXPIRED` | 401 | Le jeton a dépassé sa durée de validité. | Demandez-en un nouveau. |
| `USER_NOT_FOUND` | 404 | Aucun compte avec cet identifiant. | Vérifiez l'identifiant. |
| `WEAK_PASSWORD` | 400 | Le mot de passe ne respecte pas la politique configurée. | Choisissez un mot de passe plus robuste. |

## Données, requêtes et écritures

| Code | Statut | Signification | Que faire |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Ce pilote ne peut pas calculer l'agrégat demandé. | Utilisez un pilote compatible, ou calculez-le côté client. |
| `BRANCHING_UNSUPPORTED` | — | Une branche de base de données a été demandée via le websocket Studio sur la base de développement gérée (PGlite), où une branche *est* le parent et où rien ne serait isolé. Le refus est identique à celui affiché par `rebase db branch`. | Pointez `DATABASE_URL` vers votre propre instance Postgres (`rebase dev --docker` en lance une) et créez des branches dessus. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contient plus d'opérations que la limite autorisée par lot (1000 par défaut). Un lot représente une transaction unique et conserve ses verrous pendant toute sa durée. | Envoyez le lot par morceaux ; le message indique la limite et votre total. |
| `BATCH_UNSUPPORTED` | 400 | Le pilote de ce backend ne peut pas écrire de manière atomique à travers plusieurs collections, et une boucle d'écritures individuelles ne serait ni atomique ni exécutée en un seul aller-retour. | Envoyez les écritures sous forme de requêtes séparées, ou via des appels `/bulk` par collection. |
| `BULK_TOO_LARGE` | 400 | Le corps de la requête en masse dépasse la limite d'éléments configurée. | Fractionnez la requête. |
| `BULK_UNSUPPORTED` | 400 | Cette collection ou ce pilote ne prend pas en charge les écritures en masse. | Écrivez les lignes une par une. |
| `CALLBACK_REJECTED` | 400 | Un callback de collection a refusé l'écriture. Un `throw` depuis `beforeSave`/`beforeDelete`/`after*` renvoie une 400 contenant le message défini par l'auteur ; un `beforeDelete` renvoyant `false` produit une 403. `details.stage` indique quel callback est concerné, `details.path` précise la collection. | Lisez le message — il a été rédigé par ce projet, et non par Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` a été combiné avec `?offset=` ou `?page=`. Un curseur indique déjà le début de la page, un décalage supplémentaire ignore donc silencieusement ce nombre de lignes après le curseur — un saut invisible pour l'appelant dans la réponse. | Utilisez l'un ou l'autre. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` a été combiné avec une recherche textuelle ou vectorielle. Les deux ajoutent un score par ligne, deux lignes ne sont donc jamais strictement égales et `DISTINCT` ne fusionnerait rien — cela semblerait fonctionner sans rien modifier. | Supprimez l'un des deux paramètres. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Une lecture avec `distinct` est triée selon une colonne qu'elle ne renvoie pas. Un `SELECT DISTINCT` ne peut être trié que par des colonnes figurant dans sa liste de sélection, sinon les lignes fusionnées n'ont pas d'ordre défini. `details.fields` les énumère. | Ajoutez ces champs à `?fields=`, ou retirez-les de `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres a refusé l'instruction (`42501`) : soit en raison d'une politique RLS rejetant ce rôle, soit à cause d'un `GRANT` manquant. | Consultez la section [Troubleshooting](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Un filtre, un `orderBy`, un `fields`, un `select` d'agrégation ou un `groupBy` mentionne un champ que les rôles de cet appelant ne peuvent pas lire (`access.read`). Un champ qu'aucune réponse ne peut inclure doit être un champ qu'aucune requête ne peut inspecter, sous peine de pouvoir deviner la valeur prédicat par prédicat. `details.violations` énumère chaque champ. | Retirez le champ de la requête, ou obtenez le rôle adéquat. Consultez [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Le corps définit un champ que les rôles de cet appelant ne peuvent pas modifier (`access.write`). Refusé plutôt qu'ignoré : une écriture ignorant un champ notifierait un succès pour une modification non appliquée. `details.violations` énumère chaque champ. | Supprimez le champ, ou obtenez le rôle adéquat. Un champ que personne ne peut modifier renvoie plutôt `VALIDATION_EXCLUDED_FIELDS`. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Une requête précédente avec la même `Idempotency-Key` est toujours en cours d'exécution. | Réessayez dès qu'elle est terminée. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La même `Idempotency-Key` a été envoyée avec un corps différent. | Utilisez une nouvelle clé, ou renvoyez le corps original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` a indiqué une fonction qui n'est ni `count`, `sum`, `avg`, `min` ni `max`. | Utilisez l'une d'elles ; le message les énumère. |
| `INVALID_AGGREGATE_SELECT` | 400 | Une entrée de `?select=` ne respecte pas la forme `fn(champ)`, ou une fonction autre que `count()` a été fournie sans champ. | Écrivez `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | Une opération `/_batch` omet `op`, `collection`, `values` ou `id`, nomme une collection non prise en charge par ce backend, ou réutilise un nom `ref`. | Consultez le message ; il indique l'opération par son index. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<nom>.<champ>" }` ne correspond à aucune opération antérieure, pointe vers l'avant, ou demande un champ inexistant dans la ligne référencée. Seules les références arrière sont résolues. | Définissez l'opération avec `ref` *avant* d'y faire référence. |
| `INVALID_BULK_BODY` | 400 | Le corps de l'opération de masse n'a pas la structure attendue. | Envoyez le tableau `items` documenté. |
| `INVALID_CONFLICT_TARGET` | 400 | Le paramètre `on_conflict` / `onConflict` d'un upsert mentionne des colonnes sans garantie d'unicité, ou les mentionne sans `upsert: true`. Postgres renverrait sinon une erreur 42P10 au sein d'une transaction ayant déjà effectué des opérations. | Déclarez `validation: { unique: true }` ou un index `unique` ; le message énumère les cibles existantes. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` n'est ni `include` ni `only`. Refusé plutôt qu'ignoré : une coquille telle que `?deleted=true` masquant discrètement chaque ligne supprimée semblerait fonctionner tout en répondant l'inverse de la question posée. | Envoyez `include` (actives et supprimées) ou `only` (supprimées uniquement). Omettez-le pour les lignes actives seules. |
| `INVALID_DISTINCT` | 400 | `?distinct=` n'est ni `true` ni `false`. | Renseignez l'une de ces valeurs ; `1` et `0` sont également acceptés. |
| `INVALID_FIELD_OPERATION` | 400 | Un opérateur `$inc` / `$push` / `$pull` / `$merge` a été utilisé sur un type de propriété non pris en charge, avec un opérande de format incorrect, avec deux opérateurs sur un même champ, mal orthographié, ou lors d'une création — où aucune valeur stockée n'existe pour appliquer l'opération. | Consultez [Writing over REST](/docs/backend/writes/#field-operations) ; le message précise le champ. |
| `INVALID_FILTER_FIELD` | 400 | Le filtre indique une propriété inexistante dans cette collection. | Vérifiez l'orthographe par rapport à la collection. |
| `INVALID_FILTER_OPERATOR` | 400 | L'opérateur n'est pas pris en charge par ce type de propriété. | Consultez [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Une valeur de filtre ne peut pas être interprétée selon le type de la colonne comparée : `?id=eq.abc` sur une clé entière, un libellé absent de l'énumération, un horodatage invalide, un nombre hors des limites du type. `details.dbCode` contient le SQLSTATE. | Envoyez une valeur correspondant au type de la colonne. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` n'est ni `true` ni `false`. Toute autre valeur est refusée plutôt qu'interprétée comme un « non » — une faute de frappe effectuant une suppression douce alors que l'appelant souhaitait une purge définitive lui ferait croire à tort que les données ont disparu. | Envoyez `true` ou `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` est malformé : liste de chemins invalide, ou niveau d'imbrication supérieur à la profondeur maximale. Traité à la frontière de l'API plutôt que de laisser le pilote renvoyer une 500. | Consultez le message ; il indique le chemin en cause. |
| `INVALID_INPUT` | 400 | Le corps de la requête a échoué à la validation. | Consultez le message. |
| `INVALID_LIMIT` | — | Un abonnement en temps réel a demandé une limite hors de la plage autorisée. Notifié via une trame WebSocket `ERROR`, et non par une réponse HTTP. | Réduisez la limite. |
| `INVALID_LOGICAL_GROUP` | 400 | Un groupe `?or=` / `?and=` est malformé ou dépasse la profondeur autorisée. | Consultez le message ; il présente la règle d'aplatissement. |
| `INVALID_OFFSET` | 400 | `?offset=` n'est pas un nombre entier supérieur ou égal à 0. | Envoyez un entier non négatif. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` n'est pas au format `field`, `field:desc`, ni un tableau JSON de `{ field, direction }`. | Consultez le message ; il détaille les trois syntaxes. |
| `INVALID_PAGE` | 400 | `?page=` n'est pas un nombre entier supérieur ou égal à 1. La pagination commence à 1, `?page=0` est donc une erreur et non la première page. | Envoyez `1` ou plus, ou utilisez `?offset=`. |
| `INVALID_PARAM` | 400 | Un paramètre de requête est malformé. | Consultez le message. |
| `INVALID_VECTOR` | 400 | `?vector=` n'est pas un tableau JSON de nombres. | Envoyez `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` n'est ni `cosine`, `l2` ni `inner_product`. | Utilisez l'une de ces trois options. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` n'est pas un nombre. | Envoyez un nombre. |
| `INVALID_WHERE` | 400 | `?where=` n'est pas un objet JSON associant des champs à des conditions. | Envoyez `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | La route d'agrégation a été appelée sans le paramètre `?select=`. | Ajoutez-en un, ex. : `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Le projet ne fournit aucune collection : aucune n'est déclarée dans le code, et aucune table n'existe pour les générer. | Créez des tables — via une migration, du SQL, ou un fichier de collection accompagné de `rebase db push` — puis redémarrez. |
| `NOT_FOUND` | 404 | Aucune ligne avec cet identifiant dans cette collection — ou ligne masquée à cet appelant par la sécurité au niveau des lignes. | Vérifiez l'identifiant, puis les `securityRules` de la collection. |
| `UNKNOWN_RELATION` | 400 | `?include=` mentionne un élément qui n'est pas une relation sur la collection. Le même code renvoie **404** lorsqu'un *chemin d'URL* imbriqué en nomme un à la place, par exemple `/api/data/authors/1/posts` où `authors` n'en déclare aucun — dans ce cas, l'URL ne pointe vers rien, il s'agit donc d'une ressource introuvable plutôt que d'une requête malformée. | Vérifiez le nom de la relation — le message énumère celles de la collection. Une rétro-référence doit être déclarée sur le parent pour pouvoir être parcourue. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | Le tri mentionne une propriété non triable. | Triez sur une propriété adossée à une colonne. |
| `PAYLOAD_TOO_LARGE` | 413 | Le corps dépasse la limite configurée. | Envoyez moins de données, ou augmentez la limite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` a tenté d'effectuer une écriture. Une lecture liée à une requête s'exécute dans une transaction `READ ONLY`, ni le callback ni ce qu'il appelle ne peuvent donc écrire. | Déplacez l'écriture hors de la lecture : tâche d'arrière-plan, ou `rebase.dataAsAdmin` depuis une tâche cron ou une fonction personnalisée. |
| `RELATION_MISCONFIGURED` | 500 | Une relation ne correspond pas au schéma enregistré. L'opération est refusée plutôt qu'ignorée : l'abandonner indiquerait un succès pour une écriture qui n'a pas eu lieu, ou une absence pour des lignes bien réelles. | Exécutez `rebase schema generate` si le schéma généré est plus ancien que la base de données. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relation ne peut pas être dissociée depuis ce côté. | Effectuez la modification depuis le côté propriétaire. |
| `RELATION_NOT_WRITABLE` | 400 | Le chemin imbriqué n'est pas une relation modifiable. | Consultez [Relations](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Une écriture de relation ne disposait d'aucune clé source pour rattacher le lien. | Enregistrez d'abord la ligne parente. |
| `SCHEMA_DRIFT` | 500 | Une table ou une colonne attendue par le code n'existe pas dans la base de données. | Exécutez `rebase db push` en développement ; redéployez sur un environnement géré. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` a été combiné avec `orderBy: "_score"`. La pertinence est calculée à chaque requête et non stockée, elle ne peut donc pas servir de curseur. | Paginez la pertinence avec `limit`/`offset`, ou triez par colonne. |
| `TENANT_IMMUTABLE` | 400 | Une écriture déplacerait une ligne d'un tenant vers un autre. Une ligne ne peut pas changer de tenant. `details.violations` indique le champ concerné. | Créez la ligne dans l'autre tenant et supprimez celle-ci, ou écrivez avec un rôle présent dans `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | L'écriture mentionne un tenant auquel cet appelant n'appartient pas ; la base de données la refuserait également. | Écrivez dans un tenant auquel l'appelant appartient, ou authentifiez-vous avec une identité qui en fait partie. |
| `TENANT_REQUIRED` | 400 | La collection est sectorisée par tenant et le tenant ne peut pas être déduit : la requête n'en précise aucun, ou l'appelant appartient à plusieurs d'entre eux. | Transmettez explicitement le champ du tenant, ou authentifiez-vous en tant qu'appelant n'appartenant qu'à un seul tenant. |
| `UNKNOWN_FIELD` | 400 | `?fields=` mentionne un champ inexistant dans la collection. | Vérifiez l'orthographe ; le message énumère les champs valides. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un agrégat ou un `groupBy` mentionne un champ inexistant dans la collection. | Vérifiez l'orthographe ; le message énumère les champs valides. |
| `UNKNOWN_FILTER_FIELD` | 400 | Le filtre indique un champ que cette collection — ou la cible d'une relation — ne possède pas. | Vérifiez l'orthographe ; le message énumère les champs valides. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Le filtre spécifie un opérateur qui n'existe pas. | Le message répertorie l'ensemble des opérateurs. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | Le tri spécifie un champ inexistant dans cette collection. | Vérifiez l'orthographe ; le message énumère les champs valides. |
| `PRECONDITION_FAILED` | 412 | Un en-tête `If-Match` a mentionné une version de la ligne qui n'est plus à jour : une écriture est intervenue entre la lecture et cette modification. Rien n'a été enregistré. | Relisez la ligne, réappliquez la modification et envoyez le nouvel `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` demande un champ inexistant dans la collection. | Vérifiez l'orthographe ; le message énumère les champs connus. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Une recherche vectorielle a mentionné une propriété qui n'est pas de type `vector` sur cette collection. | Le message énumère les propriétés vectorielles de la collection. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Le `Content-Type` n'est pas accepté par cette route. | Envoyez le type documenté par la route. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Le filtre traverse une relation `via`, dont le chemin de jointure n'est défini que dans un seul sens ; rien ne permet donc de raccrocher une sous-requête. | Filtrez depuis le côté propriétaire. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | L'opérateur n'est pas défini pour ce champ : une relation sans colonne sur cette ligne est filtrée par appartenance, et la correspondance insensible à la casse ne s'applique qu'au texte. | Consultez le message ; il liste ce que le champ accepte. |
| `VALIDATION_CONSTRAINT` | 400 | Une valeur a enfreint une règle de `validation` déclarée par la propriété — longueur, plage, motif (pattern), champ obligatoire. | Consultez le message ; il précise chaque violation. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Le corps tente d'écrire dans une colonne marquée `excludeFromApi`, ou `access: { write: [] }` — une même règle sous deux syntaxes. Celles-ci sont réservées au serveur : empreinte de mot de passe, jeton de vérification. Contrairement à `FIELD_NOT_WRITABLE`, cette réponse est identique pour tous les appelants, y compris `admin`. | Retirez le champ. Consultez [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Une valeur ne correspond pas au type de sa propriété. | Consultez le message ; il nomme la propriété. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Le corps mentionne un champ inexistant dans la collection — y compris un argument `id` sur une collection ayant une autre clé primaire. | Vérifiez l'orthographe ; le message énumère les champs connus. |
| `WRITE_DENIED` | 403 | Une règle de sécurité ou une politique de sécurité au niveau des lignes (RLS) a refusé l'écriture. | Vérifiez les `securityRules` de la collection. |

## `PG_<SQLSTATE>` — une contrainte refusée par la base de données

Une écriture que Postgres rejette en raison des *données de l'appelant* renvoie le code SQLSTATE dans son identifiant d'erreur : `PG_23505`, `PG_23503`, etc. Il s'agit d'une famille de codes et non d'une liste exhaustive — Postgres définissant des centaines de SQLSTATE — mais seules deux classes sont susceptibles d'être renvoyées ici, car seules ces deux-là relèvent de la responsabilité de l'appelant :

- **classe 23**, violation de contrainte d'intégrité : doublon, clé étrangère pointant vers le vide, colonne NOT NULL laissée vide ;
- **classe 22**, exception de données : valeur non prise en charge par le type de la colonne.

Tout le reste — coupure de connexion, colonne manquante, problème de privilèges — incombe au serveur et reste sous forme d'erreur `500`. Dès lors, `code.startsWith("PG_")` constitue un test fiable pour déterminer si « la ligne envoyée était incorrecte », et les quatre codes ci-dessous sont ceux qu'un client rencontre concrètement. `details.dbCode` reprend le même SQLSTATE pour chacun d'eux, et le message nomme la contrainte en cause.

| Code | Statut | Signification | Que faire |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Une valeur n'a pas pu être interprétée selon le type de la colonne — le pendant côté écriture de `INVALID_FILTER_VALUE`. | Envoyez une valeur correspondant au type de la colonne. |
| `PG_23502` | 400 | Une colonne `NOT NULL` a été laissée vide. | Renseignez le champ ou attribuez une valeur par défaut à la colonne. |
| `PG_23503` | 400 | Une clé étrangère pointe vers une ligne qui n'existe pas. | Créez d'abord la ligne cible ou corrigez l'identifiant. |
| `PG_23505` | 409 | Violation d'une contrainte d'unicité. Le message précise la contrainte. | Utilisez une valeur différente ou mettez à jour la ligne existante. |

## Stockage

| Code | Statut | Signification | Que faire |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | Le nom du bucket est malformé. | Vérifiez le nom. |
| `INVALID_STORAGE_KEY` | 400 | La clé de l'objet est malformée ou sort de son préfixe. | Vérifiez la clé. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Les paramètres de transformation d'image sont hors limites ou contradictoires. | Consultez [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Le fichier téléversé dépasse le `maxSize` déclaré par la propriété cible. Appliqué côté serveur, et pas seulement dans le navigateur. `details` précise la propriété, la limite et la taille réelle. | Téléversez un fichier plus petit, ou augmentez `maxSize` sur la propriété. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Le type du fichier téléversé ne figure pas dans la liste `acceptedFiles` de la propriété. `details` indique la propriété, la liste acceptée et le type de contenu envoyé. | Téléversez un type accepté, ou élargissez `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | Aucun backend de stockage n'est configuré sur ce serveur. | Configurez S3, GCS ou le stockage local. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La source de stockage est déclarée mais ne dispose d'aucun identifiant configuré ici. | Définissez les variables d'environnement de cette source. |
| `STORAGE_WRITE_FAILED` | 502 | Le backend de stockage a refusé ou interrompu l'écriture. | Consultez ses propres logs et identifiants. |
| `TRANSFORM_OVERLOADED` | 503 | Trop de transformations d'images sont en cours d'exécution. | Réessayez ; envisagez la mise en place d'un CDN en amont. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | La requête a mentionné une source de stockage (`?storageId=`) non déclarée par ce projet. Un `bucket` non pris en charge par ce déploiement renvoie le même code avec un statut **404** — c'est le stockage qui est manquant, et `details` liste les buckets et sources existants. Ces deux cas étaient auparavant renvoyés sous l'intitulé « fichier introuvable », identique à une clé simplement absente. | Déclarez la source dans `config/resources.ts`, ou vérifiez `GET /api/storage/sources`. |

## Fonctions personnalisées

| Code | Statut | Signification | Que faire |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Aucune fonction portant ce nom n'est fournie — ou bien elle existe, mais ses propres routes ne couvrent pas le chemin qui suit. Un appelant connecté reçoit également la liste de ce qui *est* fourni ; un appelant anonyme ne la reçoit pas, car cette liste constitue l'inventaire complet des points de terminaison personnalisés. Lorsqu'un fichier portant ce nom n'a pas pu être chargé, le message le précise : c'est la différence entre une simple faute de frappe et un déploiement défaillant. | Comparez le nom avec `GET /api/functions`, ou vérifiez le log de démarrage pour repérer un fichier non chargé. |
| `FUNCTION_TIMEOUT` | 504 | Le gestionnaire a dépassé son délai d'expiration (timeout). Il s'exécute toujours ; il ne peut pas être annulé depuis cet endroit. | Associez un `AbortSignal` aux appels sortants, ou augmentez `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Ce processus relaie les fonctions vers un autre qui n'a pas répondu. | Vérifiez que l'unité exécutant les fonctions est bien active. |

## Interfaces d'administration et modification du schéma

Ces codes indiquent qu'une fonctionnalité est désactivée ou non configurée, plutôt qu'une erreur dans la requête. Chacun est également signalé sur la route `/status` correspondante avec un code `200`, permettant à une interface de griser la fonctionnalité au lieu d'afficher une erreur.

| Code | Statut | Signification | Que faire |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Une interface réservée aux administrateurs a été appelée sur un serveur sans authentification configurée ; rien ne permet donc de distinguer un administrateur d'un inconnu. | Définissez `auth.jwtSecret`, ou fournissez un `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | Le contrat du projet n'est accessible que lorsque l'authentification est configurée — il décrit chaque table et relation. | Configurez l'authentification. `/meta/schema-version` est toujours accessible. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Aucune boîte de réception de développement n'est active. Les e-mails ne sont capturés que lorsque `SMTP_HOST` n'est pas défini et que `NODE_ENV` n'est pas en production. | Supprimez la définition de `SMTP_HOST` en développement, ou consultez la véritable boîte de réception. |
| `INVALID_CHANGE` | 400 | La modification de schéma proposée n'est pas bien formée. | Consultez le message. |
| `SCHEMA_CHANGE_FAILED` | 400 | L'application d'une modification de schéma planifiée a échoué pour une raison non couverte par des codes plus précis. | Consultez le message ; il reprend textuellement l'échec sous-jacent. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | La modification est valide mais ne peut pas être appliquée au schéma dans son état actuel. | Consultez le message. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Le dépôt contient des modifications non validées (uncommitted changes), l'édition ne peut donc pas être appliquée en toute sécurité. | Effectuez un commit ou un stash, puis réessayez. |
| `SCHEMA_EDIT_REFUSED` | 400 | L'éditeur de schéma a refusé la modification. | Consultez le message ; il s'agit du refus propre à l'éditeur. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Une clé API ou une autre entité machine a tenté d'appliquer une modification de schéma. | Connectez-vous en tant qu'utilisateur, ou définissez `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | L'édition de schéma à chaud nécessite `collectionsDir` ou `liveSchema.repository`, et ce serveur a été démarré sans aucun des deux. | Configurez l'un d'eux. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planification fonctionne ; il n'y a aucun dépôt dans lequel enregistrer (commit) la modification. | Configurez `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Ce pilote ne peut pas planifier de modifications de schéma. | L'édition à chaud est disponible sur Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Les collections font l'objet d'une introspection depuis la base de données ici, il n'y a donc aucun fichier source à modifier. | Modifiez le schéma via une migration. |
| `SCHEMA_EDITOR_DISABLED` | 501 | L'éditeur de schéma est désactivé sur ce serveur. | Activez-le via `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | L'éditeur de schéma a besoin de `ts-morph`, qui n'est pas installé. | `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Le serveur n'a pas de `collectionsDir`, l'éditeur n'a donc aucun emplacement où écrire. | Définissez `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | L'éditeur est désactivé sous `NODE_ENV=production` : les fichiers d'un serveur déployé sont reconstruits depuis votre dépôt à chaque déploiement, toute modification ici serait donc écrasée. | Modifiez les collections en développement puis déployez. |

## Codes génériques

Une route utilise l'un de ces codes lorsqu'aucun code plus précis ne s'applique.

| Code | Statut | Signification | Que faire |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Requête malformée, et aucun code plus précis ne s'applique. | Consultez le message. |
| `UNAUTHORIZED` | 401 | Non authentifié, ou identifiants rejetés. | Connectez-vous ou actualisez la session. |
| `FORBIDDEN` | 403 | Authentifié, mais non autorisé. | Réessayer avec la même identité ne servira à rien. |
| `CONFLICT` | 409 | Conflit avec l'état existant. | Consultez le message. |
| `INTERNAL_ERROR` | 500 | Une erreur est survenue sur le serveur. Le message est volontairement générique. | Transmettez le `requestId` ; la cause se trouve dans les logs. |
| `NOT_CONFIGURED` | 503 | Une dépendance requise par cette route n'est pas configurée sur ce serveur. | Consultez le message. |
| `SERVICE_UNAVAILABLE` | 503 | Une dépendance était inaccessible. | Réessayez ; vérifiez les logs. |

## Maintenir cette page à jour

La commande `pnpm verify:docs` échoue lorsqu'un code que le serveur peut renvoyer est absent de ces tableaux, lorsqu'un tableau liste un code qui ne peut jamais être levé, lorsqu'un statut indiqué est en désaccord avec le code source, ou lorsqu'une famille de codes telle que `PG_<SQLSTATE>` ne contient pas de ligne pour un SQLSTATE que les appelants peuvent rencontrer. L'étape est gérée par le script `tooling/scripts/docs-verify/check-error-codes.mjs`.

Il commence par se vérifier lui-même. L'analyse lit les codes directement depuis le code TypeScript plutôt que depuis un serveur en cours d'exécution, ses angles morts sont donc silencieux par nature : il lui est déjà arrivé de ne pas repérer un code transmis via un wrapper d'une ligne, ou écrit après un message contenant une parenthèse `)`, tout en affirmant que « chaque code susceptible d'être levé par le serveur est documenté » sur une page où il en manquait dix-sept. C'est pourquoi cette étape exécute au préalable un jeu d'essai reproduisant exactement ces structures avant de lire cette page, et refuse de produire le moindre rapport si elle ne parvient pas à les détecter.

---
