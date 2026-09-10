---
sourceHash: 9c622813c5a4eca9
title: Écriture via REST
sidebar_label: Écriture via REST
description: Clés d'idempotence, écritures conditionnelles avec ETag et If-Match, opérations sur les champs, upserts sur clé naturelle, return=minimal et lots multi-collections.
---

Les verbes sont détaillés sur la page de l'[API REST](/docs/backend/api/). Celle-ci traite des cinq éléments qu'une écriture peut *demander* au-delà de son verbe, ainsi que du point de terminaison permettant d'écrire simultanément sur plusieurs collections. Chacun d'entre eux est optionnel par requête : une écriture qui ne demande rien de tout cela se comporte exactement comme d'habitude.

## Écriture

Au-delà des verbes, les routes d'écriture acceptent cinq éléments qui modifient le comportement d'une écriture. Tous les cinq sont optionnels par requête, ainsi rien de ce qui suit ne modifie le fonctionnement d'une requête qui ne les sollicite pas.

### Idempotence

`Idempotency-Key: <uuid>` sur n'importe quelle écriture signifie « si vous avez déjà répondu à cette requête exacte, renvoyez la même réponse plutôt que de l'exécuter deux fois ».

```bash
curl -X POST /api/data/orders \
     -H "Idempotency-Key: 1f0f…" \
     -d '{"total": 40}'
```

Un client qui ne reçoit jamais de réponse ne peut pas savoir si l'écriture a été validée, il réessaie donc — et sans clé, le serveur ne peut distinguer cette nouvelle tentative d'une deuxième écriture légitime. Sur une table avec un identifiant attribué par le serveur, cela crée une ligne en double, car l'identifiant inventé par le client n'a jamais été utilisé.

Une clé désigne **une seule requête** : elle enregistre la méthode, le chemin et le corps pour lesquels elle a été réclamée. Renvoyez cette requête exacte et sa réponse est rejouée ; envoyez-en une différente sous la même clé et elle est refusée avec `IDEMPOTENCY_KEY_REUSED` (422) au lieu de renvoyer le résultat de la première. Une tentative qui arrive alors que la première est toujours en cours reçoit `IDEMPOTENCY_KEY_IN_PROGRESS` (409) — renvoyez-la une fois que la première a abouti.

Pris en charge sur `POST`, `PATCH`, `DELETE`, sur les trois routes `/bulk` et sur `/_batch`. Les clés sont valables 24 heures et sont limitées à l'appelant authentifié ; une requête non authentifiée n'ayant pas d'entité principale à laquelle se rattacher, l'en-tête y est ignoré. Un backend incapable de stocker les clés ignore l'en-tête au lieu de refuser l'écriture.

Le cas de `DELETE` mérite une attention particulière. Rejouée sans clé, la seconde tentative constate que la ligne a disparu et renvoie `404` — ce qu'un client effectuant une nouvelle tentative interprète comme un échec définitif pour une suppression qui a pourtant réussi. Avec une clé, elle rejoue le code `204`.

### Concurrence optimiste : `ETag` et `If-Match`

`GET /api/data/:slug/:id` renvoie un `ETag`. Renvoyez-le dans l'en-tête `If-Match` lors d'un `PATCH` ou d'un `DELETE` ultérieur et l'écriture sera refusée avec un code `412` si la ligne a été modifiée entre-temps.

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

Sans cela, le mécanisme de lecture-modification-écriture applique la règle du « dernier arrivant gagne » sur tout ce que la seconde écriture n'a pas envoyé : deux modifications à une seconde d'intervalle réussissent toutes les deux, et le changement apporté par la première disparaît sans la moindre erreur.

Le jeton provient d'une propriété `date` avec `autoValue: "on_update"` lorsque la collection en déclare une — cette colonne constitue déjà une version — et d'un hachage stable de la ligne dans le cas contraire. `If-Match: *` affirme uniquement que la ligne existe. Rien n'est écrit lorsque la précondition échoue.

### Opérations sur les champs

Dans le corps d'un `PATCH`, la valeur d'une propriété peut être une opération sur la valeur stockée plutôt qu'une simple valeur :

```bash
curl -X PATCH /api/data/posts/p1 -d '{
  "views": { "$inc": 1 },
  "tags":  { "$push": "featured" },
  "meta":  { "$merge": { "seen": true } }
}'
```

| Opérateur | Type de propriété | Devient |
|-----------|-------------------|---------|
| `$inc` | `number` | `SET col = COALESCE(col, 0) + n` |
| `$push` | `array` | `array_append(col, …)`, ou une concaténation jsonb |
| `$pull` | `array` | `array_remove(col, …)`, ou une réagrégation jsonb |
| `$merge` | `map` | `col || '…'::jsonb` (une fusion de **premier niveau**) |

L'intérêt réside dans la lecture que l'appelant n'a plus besoin d'effectuer. Exprimer `views + 1` sous forme de valeur implique de la lire au préalable, et deux requêtes lisant chacune `4`, ajoutant un et écrivant `5` aboutiront à `5` — sans que rien dans l'une ou l'autre réponse n'indique qu'une incrémentation a été perdue. Compilée dans l'instruction SQL, l'opération arithmétique a lieu au sein du verrou de ligne et ne peut pas échouer.

Un seul opérateur est autorisé par champ. Un opérateur sur un type de propriété pour lequel il n'est pas défini, un `$operator` inconnu, ou un opérande dont le format est incorrect renvoie un `400` (`INVALID_FIELD_OPERATION`) nommant le champ concerné — une faute de frappe n'est jamais écrite dans la colonne sous forme de document JSON. Les opérations s'appliquent uniquement aux mises à jour : sur une ligne qui n'existe pas encore, il n'y a rien à modifier, elles sont donc refusées sur `POST`, sur les créations via `/bulk` et sur les opérations d'upsert.

### Upsert sur une clé naturelle

`POST /api/data/:slug?on_conflict=email` génère l'instruction `INSERT … ON CONFLICT (email) DO UPDATE` au lieu d'une simple insertion. La route bulk prend la même cible sous le nom `onConflict` aux côtés de `upsert: true`, tout comme chaque opération `upsert` d'un lot (batch).

```bash
curl -X POST '/api/data/users?on_conflict=email' \
     -d '{"email": "ada@example.com", "name": "Ada"}'

curl -X POST /api/data/users/bulk -d '{
  "rows": [ … ],
  "upsert": true,
  "onConflict": ["tenant_id", "slug"]
}'
```

La cible doit comporter une garantie d'unicité sur laquelle la base de données peut faire une correspondance : la clé primaire (valeur par défaut si aucune n'est précisée), une propriété avec `validation: { unique: true }`, ou les colonnes d'un [index](/docs/backend/indexes/) avec `unique: true`. Tout autre élément renvoie un `400` (`INVALID_CONFLICT_TARGET`) énumérant les cibles existantes — sans quoi Postgres répondrait *there is no unique or exclusion constraint matching the ON CONFLICT specification* depuis l'intérieur d'une transaction ayant déjà effectué du travail.

Indiquer une cible sans `upsert: true` lors d'une écriture en masse renvoie également un `400` : l'ignorer silencieusement transformerait un import rejouable en une opération générant des doublons.

Une ligne qui existait déjà conserve son horodatage `on_create`. Un conflit signifie que la création de la ligne est un fait passé, et un réimport nocturne réinitialisant `createdAt` sur chaque élément touché fausserait toutes les requêtes du type « nouveautés de la semaine ».

### `Prefer: return=minimal`

Par défaut, chaque écriture renvoie la ligne complète, qui contient les éléments déterminés par le serveur — un identifiant auto-incrémenté, un horodatage `autoValue`, ou les modifications apportées par `beforeSave`. Envoyez `Prefer: return=minimal` lorsque vous n'en avez pas besoin :

```bash
curl -X POST /api/data/events \
     -H "Prefer: return=minimal" \
     -d '{"kind": "page_view"}'
# → 204 No Content, Preference-Applied: return=minimal
```

Une écriture simple renvoie `204`. Une écriture via `/bulk` ou `/_batch` renvoie `200` contenant les **identifiants** plutôt que les lignes complètes — lors d'une création, l'identifiant est la seule chose que l'appelant ne peut pas calculer, l'omettre obligerait donc à relire la table via une clé naturelle pour savoir ce qui vient d'être écrit. Une clé à colonne unique est renvoyée sous forme scalaire ; une clé composite sous forme d'objet regroupant ses colonnes.

## Lots multi-collections

`POST /api/data/_batch` écrit sur plusieurs collections au sein d'une même transaction, sous le rôle propre de l'appelant, avec les mêmes validations, rappels (callbacks) et sécurité au niveau de la ligne (RLS) que ceux appliqués par la route unitaire de chaque opération.

```json
POST /api/data/_batch
{
  "operations": [
    { "op": "create", "collection": "orders",
      "values": { "total": 40 }, "ref": "order" },
    { "op": "create", "collection": "order_items",
      "values": { "order_id": { "$ref": "order.id" }, "sku": "A-1" } },
    { "op": "update", "collection": "stock",
      "id": "A-1", "values": { "count": { "$inc": -1 } } },
    { "op": "delete", "collection": "carts", "id": "c-9" }
  ]
}
```

```json
{
  "data": [ { "id": 31, "total": 40 }, { "id": 88, … }, { … }, null ],
  "meta": { "operations": 4 }
}
```

`op` accepte `create`, `update`, `upsert` ou `delete`. `update` et `delete` nécessitent un `id` ; `create`, `update` et `upsert` nécessitent `values` ; `upsert` peut spécifier une cible `onConflict` selon les mêmes conditions que mentionné plus haut. `data` est aligné sur `operations` — la ligne écrite pour un create, update ou upsert, et `null` pour un delete — de sorte qu'un index dans l'un correspond à l'index dans l'autre.

### `$ref` : pointer vers une ligne créée dans le même lot

Une opération peut se nommer elle-même via `ref`, et toute opération ultérieure peut placer `{ "$ref": "<nom>.<champ>" }` là où une valeur est attendue — dans `values` à n'importe quel niveau d'imbrication, ou en tant qu'`id`. Cela correspond au champ de la ligne écrite par l'opération désignée.

C'est la raison d'être de ce point de terminaison par rapport à une simple boucle : la clé étrangère d'un enfant est inconnue tant que le parent n'a pas été inséré, donc sans cela, le parent et les enfants doivent faire l'objet de requêtes distinctes — précisément la séquence susceptible d'échouer à mi-chemin. Seules les références **vers l'arrière** sont résolues ; une référence vers l'avant est refusée avant même l'ouverture de la transaction.

### Ce qui est vérifié avant toute écriture

Le format, les collections inconnues, les champs inconnus, les contraintes sur les valeurs, les opérations sur les champs, les cibles de conflit et la portée de `$ref` sont tous vérifiés avant l'ouverture de la transaction. Un lot s'exécute selon le principe du tout-ou-rien, et constater une faute de frappe à la 40e opération obligerait autrement à annuler (rollback) les 39 écritures précédentes.

Le volume est plafonné au même nombre d'opérations qu'une écriture en masse (1000 par défaut), car un lot conserve ses verrous pendant toute la durée de la transaction. Un pilote incapable de rendre le lot atomique répond `BATCH_UNSUPPORTED` plutôt que de se rabattre sur une boucle d'écritures unitaires — ce qui n'assurerait ni l'atomicité ni l'aller-retour unique pour lesquels un lot est utilisé.

Un `update` ou un `delete` ciblant une ligne inexistante fait échouer l'ensemble du lot avec un code `404`, pour la même raison qu'une écriture partielle est rejetée partout ailleurs : une application partielle est un état pour lequel il n'existe aucune reprise satisfaisante.

---
