---
sourceHash: b1b5ef4227e130d2
title: Écriture via REST
sidebar_label: Écriture via REST
description: Clés d'idempotence, écritures conditionnelles avec ETag et If-Match, opérations de champ, upserts sur clé naturelle, return=minimal et lots multi-tables.
---

Les verbes sont détaillés sur la page [REST API](/docs/backend/api/). Celle-ci traite des cinq éléments qu'une écriture peut *demander* au-delà de son verbe, ainsi que du point de terminaison qui écrit sur plusieurs tables à la fois. Tous sont activables à la demande par requête : une écriture qui ne demande rien de tout cela se comporte exactement comme d'habitude.

## Écriture

Au-delà des verbes, les routes d'écriture acceptent cinq éléments qui modifient le comportement d'une écriture. Tous les cinq sont activables par requête, donc rien ici ne modifie ce que fait une requête qui ne les demande pas. Les routes imbriquées (`/api/data/authors/42/posts`) exécutent le même code d'écriture que les routes racines, donc tout ce qui figure dans cette section s'applique également à elles, à l'exception de `?on_conflict=`.

Le corps d'une écriture doit être un objet JSON. `null`, un nombre, une chaîne ou un tableau renvoie un `400 BAD_REQUEST`.

<span class="since-badge" data-since="0.31">Depuis 0.31</span> Une écriture accepte les valeurs documentées par l'API REST et rien d'autre — la même structure que celle renvoyée par une lecture : une relation to-one (`belongsTo`, `hasOne`, un `via` to-one) sous la forme de la clé de la ligne liée ou `null`, une relation to-many sous la forme d'une liste de clés ou d'objets `{ id, _pivot? }`, une date sous forme de texte ISO, un vecteur sous forme de liste de nombres, un géopoint sous la forme `{ latitude, longitude }`, un `bytea` sous la forme d'une URL `data:application/octet-stream;base64,`. Une relation to-one écrite sous forme d'objet (`{ "author": { "id": 5 } }`) renvoie une erreur `400 VALIDATION_INVALID_VALUE` ("'posts.author' links one 'authors' row: write that row's key …"), tout comme un vecteur écrit sous la forme `{ "value": [...] }`. En processus, `rebase.data` accepte également un `Date` et un `Buffer` / `Uint8Array`.

Écrire une relation `hasMany` ou `hasOne` depuis le parent (`{ "replies": [1, 2] }` sur un thread) définit la clé étrangère sur les lignes enfants, et est donc soumis aux règles de cette clé : une colonne clé qui est `.readOnly()`, `.private()` ou restreinte par `access.write` la refuse (`400 VALIDATION_EXCLUDED_FIELDS` / `FIELD_NOT_WRITABLE`, "Writing 'replies' on 'threads' sets 'threadId' on the rows of 'replies'"), tout comme le ferait une écriture de la clé directement sur l'enfant.

Une mise à jour ne peut pas modifier la clé d'une ligne. Un corps qui spécifie la clé avec une autre valeur renvoie une erreur `400 KEY_IMMUTABLE`, avant l'exécution de tout hook et sans rien écrire, quelle que soit la provenance de la mise à jour : REST, socket temps réel, MCP ou le `rebase.data` intra-processus. La clé que possède déjà la ligne est acceptée, comme lorsqu'un formulaire renvoie la ligne entière. Pour déplacer une ligne vers une nouvelle clé, créez-la au nouvel emplacement et supprimez l'ancienne.

### Idempotence

`Idempotency-Key: <uuid>` sur n'importe quelle écriture signifie « si vous avez déjà répondu à cette requête exacte, répondez-y à nouveau plutôt que de l'exécuter deux fois ».

```bash
curl -X POST /api/data/orders \
     -H "Idempotency-Key: 1f0f…" \
     -d '{"total": 40}'
```

Un client qui ne reçoit jamais de réponse ne peut pas savoir si l'écriture a été validée, il réessaie donc — et sans clé, le serveur ne peut distinguer cette nouvelle tentative d'une deuxième véritable écriture. Sur une table avec un identifiant attribué par le serveur, cela crée une ligne en double, car l'identifiant inventé par le client n'a jamais été utilisé.

Une clé désigne **une seule requête** : elle enregistre la méthode, le chemin, la chaîne de requête (query string) et le corps pour lesquels elle a été revendiquée. Renvoyez cette requête exacte et sa réponse sera rejouée ; envoyez-en une différente sous la même clé et elle sera refusée avec `IDEMPOTENCY_KEY_REUSED` (422) au lieu de recevoir le résultat de la première. Une nouvelle tentative qui arrive alors que la première est toujours en cours reçoit `IDEMPOTENCY_KEY_IN_PROGRESS` (409) — renvoyez-la une fois la première terminée. La chaîne de requête compte car elle modifie l'action de la requête : `DELETE /api/data/posts/5?hard=true` sous la clé d'une suppression réversible antérieure est une requête différente, pas un rejeu. L'ordre de ses paramètres n'a pas d'importance.

Pris en charge sur `POST`, `PATCH`, `DELETE`, sur les trois routes `/bulk` et sur `/_batch`. Les clés ont une durée de vie de 24 heures et sont limitées à l'appelant connecté ; une requête non authentifiée n'ayant pas d'entité principale à laquelle s'associer, l'en-tête y est ignoré. Un backend incapable de stocker des clés ignore l'en-tête plutôt que de refuser l'écriture.

`DELETE` est le cas qui mérite une double lecture. Rejouée sans clé, la deuxième tentative constate que la ligne n'existe plus et renvoie `404` — ce qu'un client qui réessaie interprète comme un échec définitif pour une suppression qui a en réalité réussi. Avec une clé, elle rejoue le `204`.

### Concurrence optimiste : `ETag` et `If-Match`

`GET /api/data/:slug/:id` renvoie un `ETag`, tout comme le `GET` imbriqué sur une seule ligne. Renvoyez-le dans `If-Match` lors d'un `PATCH` ou `DELETE` ultérieur et l'écriture sera refusée avec un code `412` si la ligne a été modifiée entre-temps.

Un `PATCH` réussi répond avec l'`ETag` de la version qu'il a écrite, de sorte que l'écriture conditionnelle suivante ne nécessite aucune lecture préalable. Le tag accompagne également une réponse `204` renvoyée pour `Prefer: return=minimal`, et une réponse rejouée pour une `Idempotency-Key` porte le même tag que la première. Un abonnement en temps réel aux lignes porte le même tag sur chaque trame (voir [Temps réel](/docs/backend/realtime/)).

```bash
# read
curl -i /api/data/docs/d1
# → ETag: "9f2c…"

# write, conditionally
curl -X PATCH /api/data/docs/d1 \
     -H 'If-Match: "9f2c…"' \
     -d '{"title": "Second draft"}'
# → 412 PRECONDITION_FAILED if somebody else edited it first
```

Sans cela, le schéma lecture-modification-écriture applique la règle du « dernier arrivant gagne » sur tout ce que la seconde écriture n'a pas envoyé : deux éditeurs à une seconde d'intervalle réussissent tous les deux et la modification du premier disparaît sans la moindre erreur.

Le tag est dérivé d'une colonne d'horodatage avec `.onUpdateNow()` lorsque la table en déclare une — cette colonne *est* déjà une version — et d'un hachage stable de la ligne dans le cas contraire. `If-Match: *` affirme uniquement que la ligne existe. Rien n'est écrit lorsque la précondition échoue.

Le formulaire d'enregistrement de l'administration enregistre avec `If-Match` : une sauvegarde effectuée par rapport à une version que quelqu'un a remplacée depuis est refusée, le formulaire l'indique, et la modification reste dans le formulaire, rebasée sur la nouvelle version avec les champs en conflit mis en évidence.

Le tag est comparé au sein de la transaction propre à l'écriture, après le verrouillage de la ligne. Deux écritures portant le même tag ne peuvent pas réussir toutes les deux : la seconde attend que la première soit validée, lit ce qu'elle a écrit et est refusée avec un code `412`.

### Opérations sur les champs

La valeur d'une propriété dans le corps d'un `PATCH` peut être une opération sur la valeur stockée plutôt qu'une valeur brute :

```bash
curl -X PATCH /api/data/posts/p1 -d '{
  "views": { "$inc": 1 },
  "tags":  { "$push": "featured" },
  "meta":  { "$merge": { "seen": true } }
}'
```

| Opérateur | Type de propriété | Devient |
|----------|---------------|---------|
| `$inc` | `number` | `SET col = COALESCE(col, 0) + n` |
| `$push` | `array` | `array_append(col, …)`, ou une concaténation jsonb |
| `$pull` | `array` | `array_remove(col, …)`, ou une ré-agrégation jsonb |
| `$merge` | `map` | `col || '…'::jsonb` (une fusion **superficielle**) |

L'intérêt réside dans la lecture que l'appelant n'a plus besoin d'effectuer. Exprimer `views + 1` sous forme de valeur implique de la lire au préalable, et deux requêtes qui lisent chacune `4`, ajoutent un et écrivent `5` finissent à `5` — sans que rien dans aucune réponse n'indique qu'un incrément a été perdu. Compilée dans l'instruction, l'opération arithmétique a lieu sous le verrou de la ligne et ne peut rien perdre.

Exactement un opérateur par champ. Un opérateur sur un type de propriété pour lequel il n'est pas défini, un `$operator` inconnu ou un opérande au format incorrect renvoie un `400` (`INVALID_FIELD_OPERATION`) indiquant le champ concerné — une faute de frappe n'est jamais écrite dans la colonne sous forme de document JSON.

Le type `map` fait exception, car sa valeur *est* un document JSON et peut comporter ses propres clés en `$` — le `$schema` et `$id` d'un schéma JSON, un document exporté depuis une autre base de données. Sur un `map`, seul un objet comportant exactement une clé correspondant à l'un des opérateurs ci-dessus est une opération ; tout autre objet est stocké tel qu'envoyé, clés en `$` incluses. Ainsi, `{ "meta": { "$merge": { … } } }` fusionne, et `{ "meta": { "$schema": "https://json-schema.org/draft/2020-12/schema" } }` est stocké. Un opérateur mal orthographié sur un `map` est donc également stocké ; sur tous les autres types, il reste refusé. Le client hors ligne n'ayant pas de schéma pour distinguer un `map` d'autre chose, il refuse hors ligne une telle valeur en tant qu'opération de champ ; envoyez-la une fois la connexion rétablie.

Les opérations s'appliquent uniquement aux mises à jour : sur une ligne qui n'existe pas encore, il n'y a rien sur quoi opérer, elles sont donc refusées sur `POST`, sur les créations `/bulk` et sur les upserts.

Une opération est soumise à la `validation` de la propriété tout comme le serait une valeur. Les éléments ajoutés par push sont évalués selon les règles applicables aux éléments, les clés fusionnées selon les propriétés de la map, et la valeur *produite* par une opération selon les limites déclarées : `min`, `max`, `moreThan`, `lessThan`, `positive` et `negative` pour un nombre, nombre `min` et `max` d'éléments pour un tableau. Cette dernière vérification est une condition sur le même `UPDATE`, et non une lecture préalable. Sur `stock: { validation: { min: 0 } }`, `{ "stock": { "$inc": -1 } }` réussit tant que le stock est d'au moins 1 et est refusé à 0 avec le `400` (`VALIDATION_CONSTRAINT`) que recevrait `{ "stock": -1 }`, en nommant le champ et la contrainte. Deux décrémentations concurrentes d'un stock de 1 ne peuvent pas réussir toutes les deux, car la seconde est évaluée par rapport à la ligne validée par la première. Un nombre non défini équivaut à `0` et un tableau non défini à un tableau vide. Une opération refusée n'écrit rien, pas même les valeurs simples situées à côté dans le corps. Comme la vérification fait partie de l'instruction, elle s'applique également aux écritures en processus via `rebase.data`, qui contournent la validation au niveau de la requête.

### Upsert sur une clé naturelle

`POST /api/data/:slug?on_conflict=sku` insère la ligne ou met à jour celle qui contient déjà ce SKU, au lieu d'échouer. La route bulk accepte la même cible sous la forme de `onConflict` aux côtés de `upsert: true`, tout comme chaque opération `upsert` d'un lot.

```bash
curl -X POST '/api/data/products?on_conflict=sku' \
     -d '{"sku": "LAMP-01", "name": "Desk lamp", "price": 39}'

curl -X POST /api/data/products/bulk -d '{
  "rows": [ … ],
  "upsert": true,
  "onConflict": ["tenant_id", "sku"]
}'
```

La cible doit comporter une garantie d'unicité sur laquelle la base de données peut faire correspondre les enregistrements : la clé primaire (valeur par défaut si aucune n'est spécifiée), une colonne déclarée `.unique()`, ou les colonnes d'un [index](/docs/backend/indexes/) `unique: true`. Tout autre élément renvoie un `400` (`INVALID_CONFLICT_TARGET`) listant les cibles existantes — sinon, Postgres répondrait *there is no unique or exclusion constraint matching the ON CONFLICT specification* depuis l'intérieur d'une transaction qui a déjà commencé à s'exécuter.

Nommer une cible sans `upsert: true` lors d'une écriture bulk renvoie également un `400` : l'ignorer silencieusement transformerait un import rejouable en un import créant des doublons.

`?on_conflict=` est refusé lors d'une création imbriquée (`INVALID_CONFLICT_TARGET`). La ligne correspondante pourrait appartenir à un autre parent, et l'upsert la déplacerait sous celui-ci. Envoyez l'upsert sur la route propre à la table.

Un upsert qui rencontre une ligne stockée constitue une mise à jour de celle-ci. Le serveur lit la ligne désignée par la clé, dans le périmètre de l'appelant et au sein de la transaction d'écriture, puis exécute la mise à jour habituelle : les champs présents dans le corps sont écrits, ceux laissés de côté conservent leurs valeurs enregistrées plutôt que d'être réinitialisés à leur `.default()`, `beforeSave` et `afterSave` reçoivent `status: "existing"` avec les valeurs précédentes, et l'historique enregistre une mise à jour. Une ligne que la lecture ne pouvait pas voir, ou une ligne insérée simultanément, est tout de même interceptée par `ON CONFLICT … DO UPDATE`, qui ne définit que ce que le corps et les hooks ont écrit, ainsi que les horodatages `.onUpdateNow()`. Une clé désignant une ligne située en dehors du périmètre `beforeQuery` de l'appelant renvoie un `404`. Une clé appartenant à une ligne dans la [corbeille](/docs/collections/soft-delete/) renvoie `409 ROW_IN_TRASH` et n'écrit rien : restaurez d'abord la ligne ou purgez-la.

Une ligne qui existait déjà conserve son horodatage `.onCreateNow()` et son créateur `.onCreateUser()`. Un conflit signifie que la création de la ligne appartient au passé, et une réimportation nocturne qui réinitialiserait `createdAt` sur tout ce qu'elle touche fausserait toutes les requêtes du type « nouveautés de la semaine ».

#### Pas sur la table d'authentification

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

La table d'authentification (déclarée avec `defineAuthTable`) refuse les upserts par tous les moyens d'accès — `?on_conflict=`, `/bulk` avec `upsert: true`, une opération `upsert` dans `_batch`, la méthode `upsert()` du SDK et le socket temps réel — avec un code `400` (`INVALID_CONFLICT_TARGET`). Ses lignes représentent les utilisateurs, et en créer un ou en modifier un répond à des règles différentes : une création hache le mot de passe, normalise l'e-mail, exécute `onCreateUser` et envoie l'invitation, tandis qu'une mise à jour ne peut pas rétrograder le dernier administrateur. Un upsert ne sait de quel cas il s'agit qu'au cours de l'écriture, trop tard pour appliquer l'un ou l'autre. Créez les utilisateurs avec un simple `POST` et modifiez-les avec `PATCH`.

### `Prefer: return=minimal`

Par défaut, chaque écriture renvoie la ligne complète, ce qui permet de transmettre ce que le serveur a déterminé — un identifiant incrémentiel, un horodatage `.onCreateNow()`, ou tout ce que `beforeSave` a réécrit. Envoyez `Prefer: return=minimal` lorsque vous n'en avez pas besoin :

```bash
curl -X POST /api/data/events \
     -H "Prefer: return=minimal" \
     -d '{"kind": "page_view"}'
# → 204 No Content, Preference-Applied: return=minimal
```

Une écriture simple renvoie `204`. Une écriture `/bulk` ou `/_batch` renvoie `200` en transmettant les **identifiants** plutôt que les lignes — lors d'une création, l'identifiant est la seule chose que l'appelant ne peut pas calculer, de sorte que l'ignorer obligerait à relire la table à partir d'une clé naturelle pour savoir ce qui vient d'être écrit. Une clé sur une seule colonne est retournée sous forme de scalaire ; une clé composite sous forme d'objet regroupant ses colonnes.

## Lots multi-tables

<span class="since-badge" data-since="0.31">Depuis 0.31</span> Chaque opération désigne sa table avec `table` (auparavant `collection`).

`POST /api/data/_batch` effectue des écritures sur plusieurs tables au sein d'une seule transaction, sous le rôle propre de l'appelant, avec la même validation, les mêmes hooks et la même sécurité au niveau des lignes que ceux que la route unitaire de chaque opération appliquerait.

```json
POST /api/data/_batch
{
  "operations": [
    { "op": "create", "table": "orders",
      "values": { "total": 40 }, "ref": "order" },
    { "op": "create", "table": "order_items",
      "values": { "order_id": { "$ref": "order.id" }, "sku": "A-1" } },
    { "op": "update", "table": "stock",
      "id": "A-1", "values": { "count": { "$inc": -1 } } },
    { "op": "delete", "table": "carts", "id": "c-9" }
  ]
}
```

```json
{
  "data": [ { "id": 31, "total": 40 }, { "id": 88, … }, { … }, null ],
  "meta": { "operations": 4 }
}
```

`op` peut valoir `create`, `update`, `upsert` ou `delete`. `update` et `delete` nécessitent un `id` ; `create`, `update` et `upsert` nécessitent `values` ; `upsert` peut spécifier une cible `onConflict` selon les mêmes conditions que ci-dessus. `data` est aligné sur `operations` — la ligne écrite pour un create, update ou upsert, et `null` pour un delete — de sorte qu'un index dans l'un correspond à un index dans l'autre.

### `$ref` : pointer vers une ligne créée par le même lot

Une opération peut se nommer via `ref`, et toute opération ultérieure peut insérer `{ "$ref": "<name>.<field>" }` là où une valeur est attendue — dans `values` à n'importe quelle profondeur, ou comme `id`. Elle se résout par la valeur de ce champ dans la ligne écrite par l'opération nommée.

C'est la raison d'être de ce point de terminaison par rapport à une simple boucle : la clé étrangère d'un enfant ne peut être connue avant l'insertion du parent, de sorte que sans cela, le parent et les enfants devraient faire l'objet de requêtes distinctes — précisément la séquence susceptible d'échouer à mi-chemin. Seules les références **vers l'arrière** sont résolues ; une référence vers l'avant est refusée avant même l'ouverture de la transaction.

### Ce qui est vérifié avant toute écriture

La structure, les tables inconnues, les champs inconnus, les contraintes de valeur, les opérations sur les champs, les cibles de conflit et l'accessibilité des `$ref` sont tous validés avant l'ouverture de la transaction. Un lot s'exécute selon le principe du tout ou rien, et découvrir une coquille à l'opération 40 coûterait autrement l'annulation des 39 écritures précédentes.

Le nombre d'opérations est plafonné à la même limite qu'une écriture bulk (1000 par défaut), étant donné qu'un lot conserve ses verrous pendant toute la durée de la transaction. Les hooks de chaque opération s'exécutent à l'intérieur, les uns après les autres ; un hook lent est donc pénalisant pour chaque ligne pendant que la transaction est ouverte : 100 lignes dont le `beforeSave` attend 50 ms monopolisent une connexion, ainsi que les verrous de chaque ligne écrite jusque-là, pendant 5,3 s. Il en va de même pour une écriture `/bulk`. Voir [Un hook monopolise une connexion](/docs/collections/context-data-api/#a-hook-holds-a-connection). Un pilote incapable de rendre le lot atomique répond `BATCH_UNSUPPORTED` au lieu de se rabattre sur une boucle d'écritures individuelles — ce qui n'offrirait ni l'atomicité ni l'aller-retour unique recherchés avec un lot.

Un `update` ou un `delete` ciblant une ligne inexistante fait échouer l'ensemble du lot avec un code `404`, pour la même raison qu'une écriture partielle est refusée partout ailleurs : un état partiellement appliqué ne permet aucune récupération satisfaisante.
