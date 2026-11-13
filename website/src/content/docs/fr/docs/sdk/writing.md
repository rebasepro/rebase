---
sourceHash: dc2857e881f65bd3
title: Écriture de données
sidebar_label: Écriture de données
description: create, upsert, update et delete avec le SDK — opérations sur les champs, écritures conditionnelles, clés d'idempotence, écritures par lot et écriture sur plusieurs tables en une seule transaction.
---

Les lectures sont abordées dans [Interrogation des données](/docs/sdk/querying/). Cette page constitue l'autre moitié :
tout ce qui modifie une ligne.

Chaque méthode présentée ici passe par le même pipeline qu'une écriture venant de n'importe où ailleurs — les [hooks](/docs/collections/callbacks/),
les [relations](/docs/collections/relations/) et la
[sécurité au niveau des lignes](/docs/collections/security-rules/) continuent tous de s'appliquer. Rien de
tout cela ne contourne vos propres règles ; ce que ces options vous apportent, c'est un aller-retour réseau en moins, une
transaction, ou une situation de concurrence que vous n'avez plus à perdre.

## Écritures sur une seule ligne

### Create

```typescript
const newProduct = await client.data.products.create({
    name: "New Product",
    price: 29.99,
    active: true
});

// With a specific ID
const newProduct = await client.data.products.create(
    { name: "Custom ID Product" },
    "my-custom-id"
);
```

### Upsert

Insérez la ligne, ou mettez à jour celle occupant déjà sa clé :

```typescript
await client.data.products.upsert(
    { sku: "LAMP-01", name: "Desk lamp", price: 39 },
    { onConflict: ["sku"] }
);
```

Le serveur décide de l'action à mener au sein d'une seule transaction et s'appuie sur
`INSERT … ON CONFLICT DO UPDATE`. Ainsi, contrairement à un `findById` suivi d'un
`create`-ou-`update`, il ne peut pas perdre la course entre les deux, et contrairement à
`create`, il n'échoue pas lorsque la ligne existe déjà.

Lorsque la ligne existe déjà, l'upsert constitue une mise à jour de celle-ci. Les champs que vous transmettez sont
écrits et ceux omis conservent leurs valeurs stockées — ils ne sont pas réinitialisés
à leur `defaultValue`. `beforeSave` et `afterSave` reçoivent `status: "existing"`
avec les valeurs précédentes, et l'historique enregistre une mise à jour. Une clé qui cible une ligne
hors du périmètre `beforeQuery` de l'appelant renvoie une 404.

`onConflict` cible par défaut la clé primaire, ce qui n'est pas la cible appropriée pour la plupart des
écritures pour lesquelles on utilise un upsert : indexé sur un identifiant séquentiel, cela devient une simple
insertion car l'appelant ne connaît pas l'id — un import réexécutable
dupliquerait donc chaque ligne lors de la seconde exécution. Spécifiez plutôt la clé naturelle. Elle doit
comporter une garantie d'unicité sur laquelle la base de données peut faire correspondre les enregistrements — `validation: { unique:
true }` sur la propriété, ou les colonnes d'un [index](/docs/backend/indexes/) avec `unique: true`
— toute autre valeur renvoyant une 400 listant les cibles existantes,
plutôt qu'une erreur déclenchée depuis l'intérieur d'une transaction.

L'horodatage `on_create` et le créateur `user_on_create` d'une ligne qui existait déjà
ne sont pas modifiés : un conflit signifie que sa création appartient au passé.

#### Conserver la ligne stockée : `where` et `ignoreDuplicates`

`where` ne remplace la ligne stockée que si elle correspond au filtre — un filtre sur les
colonnes de la ligne stockée, rédigé comme on le ferait pour un `find()`. `ignoreDuplicates` ne la
remplace jamais. Dans les deux cas, l'appel se résout à `undefined` lorsque la ligne stockée a été
laissée telle quelle, et la vérification est effectuée directement par l'instruction SQL (`ON CONFLICT … DO UPDATE
… WHERE`, `ON CONFLICT DO NOTHING`), de sorte qu'aucune autre écriture ne peut s'intercaler entre une lecture
et la décision :

```typescript
// Keep the best score of the day: written only when it beats the stored one.
const kept = await client.data.scores.upsert(
    { day, player, score },
    { where: { score: ["<", score] } }
);

// Claim a slot once; a second claim changes nothing.
const claim = await client.data.claims.upsert({ slot, owner }, { ignoreDuplicates: true });
if (!claim) throw new Error("taken");
```

`createMany(rows, { upsert: true, where })` et `{ upsert: true, ignoreDuplicates: true }`
effectuent la même opération par ligne et ne renvoient que les lignes qu'ils ont écrites. Les deux nécessitent `upsert`, et
ils ne peuvent pas être combinés (`INVALID_CONFLICT_RULE`).

#### Pas sur la table d'authentification

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`upsert()` sur la table d'authentification (celle déclarée avec `defineAuthTable`) est refusé
avec une 400 (`INVALID_CONFLICT_TARGET`), tout comme `createMany` avec `upsert`
sur cette même table. Créer un utilisateur et en modifier un obéissent à des règles différentes — une création
hache le mot de passe et envoie l'invitation, une mise à jour ne peut pas rétrograder le dernier
administrateur — et un upsert ne sait de quel cas il s'agit qu'au moment de l'écriture. Appelez
plutôt `create` ou `update`.

### Update

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

#### Opérations sur les champs

Une valeur peut également être une opération sur la valeur *stockée* :

```typescript
await client.data.posts.update(postId, {
    views: { $inc: 1 },
    tags:  { $push: "featured" },
    meta:  { $merge: { lastSeen: Date.now() } }
});
```

| Opérateur | Type de propriété | Signification |
|----------|---------------|---------|
| `$inc` | `number` | ajouter (négatif pour soustraire) |
| `$push` | `array` | ajouter une valeur, ou chacune des valeurs d'un tableau |
| `$pull` | `array` | supprimer toutes les occurrences d'une valeur |
| `$merge` | `map` | fusion superficielle (shallow-merge) d'un objet |

L'intérêt de les utiliser réside dans la lecture que vous n'avez plus besoin d'effectuer, et la situation de concurrence que
cette lecture ouvrirait. `views = current + 1` implique de récupérer `current` au préalable ; si deux
requêtes lisent chacune `4`, elles écriront toutes les deux `5` — un incrément est perdu sans qu'aucune
réponse ne le signale. Compilée directement dans l'instruction SQL, l'opération arithmétique a lieu sous le
verrou de la ligne.

Exactement un opérateur par champ, et uniquement lors d'une mise à jour : sur une ligne qui n'existe
pas encore, il n'y a rien sur quoi opérer ; ainsi, une opération dans un `create`,
`createMany` ou `upsert` renvoie une 400. Un opérateur appliqué au mauvais type de propriété, ou un
`$operator` mal orthographié, renvoie une 400 mentionnant le champ — jamais un document JSON
écrit dans la colonne.

Une opération est soumise aux règles de `validation` de la propriété au même titre qu'une valeur, et cela
inclut la valeur qu'elle produit. `{ stock: { $inc: -1 } }` sur un champ `stock` avec
`validation: { min: 0 }` réussit tant que le stock est d'au moins 1 et est refusé
à 0 avec la même erreur 400 (`VALIDATION_CONSTRAINT`) que recevrait `{ stock: -1 }`. Il
en va de même pour `max`, `moreThan`, `lessThan`, `positive` et `negative`, ainsi que pour
le nombre `min` et `max` d'éléments d'un tableau après un `$push` ou un `$pull`. La vérification fait partie intégrante
de l'instruction de mise à jour ; par conséquent, deux décréments concurrents d'un stock de 1 ne peuvent pas
réussir tous les deux, et une mise à jour refusée n'écrit rien.

En mode hors ligne, elles sont refusées plutôt que mises en file d'attente : une opération est évaluée
par rapport à une valeur stockée dont l'appareil ne possède pas de copie à jour, et une ligne optimiste
ne pourrait afficher que le marqueur lui-même jusqu'à ce que la file d'attente soit vidée.

### Delete

```typescript
await client.data.products.delete(42);
```

Sur une table avec [suppression réversible (soft delete)](/docs/collections/soft-delete), cela marque la
ligne au lieu de la supprimer. `client.data.products.trash` liste, compte, restaure
et purge les lignes marquées.

### Écritures conditionnelles

`update` et `delete` acceptent un paramètre `ifMatch`, de sorte qu'une écriture est refusée si la ligne a
été modifiée depuis que vous l'avez lue :

```typescript
import { etagOf } from "@rebasepro/client";

const post = await client.data.posts.get(1);
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(post) });
// → RebaseApiError, status 412, if somebody edited it in between
```

Sans cela, le modèle lecture-modification-écriture applique le principe du dernier rédacteur gagnant (*last-writer-wins*) sur tout ce que vous n'avez
pas envoyé : deux éditeurs effectuant une modification à une seconde d'intervalle réussissent tous deux, et la modification du premier
disparaît sans qu'aucune erreur ne soit signalée.

`etagOf(row)` extrait la version d'une ligne issue de `findById`/`get`. Elle
réside sur une clé non énumérable, de sorte qu'elle n'apparaît jamais dans le type `Row` généré, dans un
`JSON.stringify`, ni lors d'une décomposition (*spread*) dans le corps de la mise à jour suivante. Elle vaut `undefined` pour une
ligne issue de `find()`, du cache hors ligne ou d'un serveur qui n'envoie aucun
`ETag` — et passer `undefined` n'envoie aucune précondition, de sorte que l'appel ci-dessus
se transforme en une mise à jour ordinaire au lieu de lever une exception.

Une ligne renvoyée par `update()` contient la version produite par cette écriture, ce qui
permet d'enchaîner des modifications conditionnelles sans lecture intermédiaire. Une ligne reçue par un
callback de `listenById()` contient la version affichée par cette trame :

```typescript
import { etagOf } from "@rebasepro/client";

let shown: Record<string, unknown> | undefined;
client.data.posts.listenById(1, (post) => {
    shown = post; // etagOf(shown) is the version this frame shows
});

// On save: refused with 412 if the row has moved on since that frame
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(shown) });
```

Depuis un navigateur sur une autre origine — un frontend Vite sur son propre port, un hôte
`app.` appelant un hôte `api.` — l'`ETag` n'est lisible que parce que le serveur
l'indique dans `Access-Control-Expose-Headers`. Le runtime Rebase le fait, aux côtés
de `Retry-After`, `X-Request-ID`, des en-têtes `X-RateLimit-*` et de
`Preference-Applied`. Un backend qui configure son propre `cors()` doit exposer
la même liste, faute de quoi `etagOf` y sera toujours `undefined` et chaque écriture conditionnelle
sera transmise sans condition.

### Ignorer la réponse

Chaque écriture se résout avec la ligne qu'elle a écrite. Transmettez `{ returning: false }` lorsque vous
n'en avez pas besoin :

```typescript
await client.data.events.create({ kind: "page_view" }, undefined, { returning: false });
```

Cela envoie `Prefer: return=minimal` ; le serveur répond `204` pour une écriture unique
et renvoie uniquement les identifiants pour un lot. La méthode se résout alors à `undefined` (ou `[]`),
ce qui vous évite d'utiliser accidentellement une ligne que le serveur n'a jamais renvoyée. Utile pour les imports
et les écritures sans attente de confirmation (*fire-and-forget*) — le comportement par défaut renvoie la ligne car elle contient ce que le
*serveur* a déterminé.

## Écritures par lot

Trois opérations permettent d'écrire plusieurs lignes en une **seule requête et une seule
transaction**. Chaque ligne passe toujours par le pipeline normal — hooks, relations,
sécurité au niveau des lignes — un lot n'est donc pas un moyen de contourner vos propres règles ; le gain
réside dans un seul aller-retour et une seule transaction au lieu de N pour chacun.

Toutes les trois fonctionnent selon le principe du **tout-ou-rien**. Si une ligne est rejetée, aucune n'est enregistrée et
l'erreur indique l'index en cause.

```typescript
// Create
await client.data.products.createMany([
    { name: "Widget", price: 9.99 },
    { name: "Gadget", price: 19.99 }
]);

// Update — each entry names its row and the fields to change
await client.data.orders.updateMany([
    { id: "o-1", data: { status: "shipped" } },
    { id: "o-2", data: { status: "shipped" } }
]);

// Delete — by id
await client.data.sessions.deleteMany(["s-1", "s-2"]);
```

### Nombre d'instructions générées par un lot

Sur une table ne comportant aucun hook `beforeSave`, `afterSave` ou `afterSaveError`,
aucun `history` et aucun `tenant`, un lot se résume à une poignée d'instructions plutôt qu'une
par ligne : `createMany` envoie des instructions `INSERT … RETURNING` multilignes (avec
`upsert`, `INSERT … ON CONFLICT … DO UPDATE`), et `updateMany` une instruction
`UPDATE … FROM (VALUES …) RETURNING` par série d'entrées modifiant les mêmes
champs. Les valeurs par défaut déclarées, les horodatages `.onCreateNow()` / `.onUpdateNow()`, `afterRead` et les événements en temps réel
s'appliquent à chaque ligne de la même manière que lorsqu'elles sont traitées une à une. Si la base de données refuse le
lot, celui-ci est annulé et rejoué ligne par ligne afin que l'erreur indique toujours l'entrée
ayant échoué. Une table qui déclare l'un de ces hooks conserve le pipeline ligne par ligne,
car chaque hook s'exécute une fois par ligne entre les écritures de cette ligne.

De même, un `update` unique n'effectue aucune lecture lorsque rien ne requiert la ligne stockée :
l'`UPDATE … RETURNING` fait à la fois office de 404 pour une ligne manquante et renvoie la ligne
correspondante. Un `delete` sans hook, historique ou corbeille à gérer ne lit rien
non plus.

### Nombre d'allers-retours pour une écriture

Une écriture sur une telle table représente un seul aller-retour vers la base de données : le
`BEGIN` de la transaction, l'identité de l'appelant, l'instruction et le `COMMIT` partent
en un seul lot. Cela s'applique à `create`, `update`, `upsert`, `delete`,
`updateWhere`, `deleteWhere` et à un `createMany` écrit groupé. Une instruction
refusée par la base de données ignore le `COMMIT` qui suit, et l'écriture est annulée comme
pour tout échec. Une écriture qui exécute un hook ou consigne l'historique envoie son
`COMMIT` après ceux-ci, lors d'un second aller-retour.

### Pourquoi `{ id, data }` plutôt que des lignes plates

`createMany` prend des lignes plates car une ligne en cours de création *est* l'ensemble de ses colonnes.
`updateMany` sépare l'adresse des données, car sur une table indexée sur autre chose
qu'`id` — un `sku`, une clé composite — une ligne plate ne peut pas déterminer si une
colonne constitue l'adresse ou une valeur à écrire. Cela reproduit exactement le fonctionnement d'`update(id, data)`
pour une ligne unique.

## Écriture à l'aide d'un filtre

`updateWhere` et `deleteWhere` écrivent toutes les lignes correspondant à un filtre, en une
seule instruction — `UPDATE … WHERE … RETURNING` et `DELETE … WHERE`. Le filtre correspond aux options
`where` et `logical` acceptées par `find()` :

```typescript
// Every expired session, gone; resolves to how many.
const removed = await client.data.sessions.deleteWhere({ where: { expiresAt: ["<", cutoff] } });

// Field operations work as on update(); resolves to the rows updated.
const bumped = await client.data.songs.updateWhere(
    { where: { "lower(artist)": ["in", ["abba", "queen"]] } },
    { plays: { $inc: 1 } }
);
```

Un filtre ne correspondant à rien ne constitue pas une erreur — `[]`, ou `0` — ce qui fait également
de `deleteWhere` la méthode idéale pour supprimer une ligne qui pourrait déjà ne plus exister,
là où `delete` renverrait une 404. Et comme l'instruction qui écrit est celle qui vérifie le
filtre, il s'agit d'une opération compare-and-set :

```typescript
// Save only over the revision this client read; [] means somebody else saved first.
const [saved] = await client.data.saves.updateWhere(
    { where: { player: ["==", player], rev: ["==", rev] } },
    { body, rev: { $inc: 1 } }
);
```

Un filtre sans condition est refusé avec l'erreur `FILTER_REQUIRED` plutôt que d'être exécuté —
il ciblerait sinon toutes les lignes — et un champ qui n'est pas une colonne est rejeté comme lors d'une
lecture, sans jamais être ignoré silencieusement. Une mise à jour filtrée ne peut pas modifier une colonne clé.

Sur une table dont les écritures effectuent des traitements par ligne — un hook de sauvegarde ou de suppression,
l'historique, le multi-tenant, un `beforeQuery`, la suppression réversible, l'accès au niveau du champ — les lignes correspondantes
sont lues selon le périmètre de l'appelant et écrites une par une à travers le pipeline complet,
au sein d'une seule transaction. En HTTP, il s'agit des routes en masse avec un filtre
à la place des identifiants : `PATCH /api/data/<slug>/bulk` avec `{ where, logical, data }`
et `POST /api/data/<slug>/bulk/delete` avec `{ where, logical }`. Elles ne sont pas
disponibles sur la table d'authentification, dont les mises à jour et suppressions sont vérifiées utilisateur par
utilisateur (`FILTERED_USER_WRITE`) ; spécifiez les utilisateurs avec `updateMany`/`deleteMany`.

### Nouvelles tentatives et doublons

Un client qui ne reçoit jamais la réponse ne peut pas savoir si le lot a été validé,
il réessaie donc — et sans clé, le serveur ne peut pas distinguer cette nouvelle tentative d'un
second lot légitime distinct. Transmettez une clé d'idempotence pour toute requête susceptible d'être réexpédiée :

```typescript
const attemptKey = crypto.randomUUID();
await client.data.products.createMany(rows, { idempotencyKey: attemptKey });
```

Une clé identifie une seule requête, pas une tâche : elle est enregistrée en association avec la méthode, le chemin
et le corps avec lesquels elle a été envoyée. Renvoyer cette requête exacte rejoue sa réponse ;
la même clé utilisée sur une requête différente est refusée avec l'erreur `IDEMPOTENCY_KEY_REUSED`
(422). Générez-en donc une nouvelle par appel au lieu de réutiliser un identifiant métier — un `importId`
partagé entre le `createMany` et le `deleteMany` d'un même import laisserait la
suppression silencieusement non exécutée.

Une nouvelle tentative qui arrive alors que la première tentative est encore en cours de traitement reçoit
`IDEMPOTENCY_KEY_IN_PROGRESS` (409) : renvoyez-la, et elle recevra le résultat de la
première tentative dès que celle-ci aboutira. Les clés sont conservées pendant 24 heures, et
uniquement pour un appelant authentifié — il n'existe autrement aucun identifiant de principal auquel la rattacher.

La file d'attente hors ligne définit automatiquement une clé lors de chaque rejeu.

### Limites

Les lots sont limités côté serveur (1 000 lignes par défaut), car un lot conserve
ses verrous pendant toute la durée de la transaction. Dépasser cette limite déclenche une erreur `BULK_TOO_LARGE`
mentionnant à la fois la limite et le nombre de vos lignes ; découpez-les donc par morceaux :

```typescript
for (const chunk of chunks(rows, 1000)) {
    await client.data.products.createMany(chunk, { upsert: true });
}
```

Une source de données incapable d'écrire de manière atomique renvoie `BULK_UNSUPPORTED` plutôt
que d'exécuter silencieusement une boucle d'écritures individuelles — ce qui ne vous apporterait
ni l'atomicité ni l'aller-retour unique que vous recherchiez en utilisant un lot.

## Écriture sur plusieurs tables

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`createMany` et ses variantes s'appliquent à une table à la fois. `client.batch()` est la forme
multi-tables : une requête, une transaction, le tout ou rien.

```typescript
const result = await client.batch([
    { op: "create", table: "orders",
      values: { total: 40 }, ref: "order" },
    { op: "create", table: "orderItems",
      values: { orderId: { $ref: "order.id" }, sku: "A-1" } },
    { op: "update", table: "stock",
      id: "A-1", values: { count: { $inc: -1 } } },
    { op: "delete", table: "carts", id: "c-9" }
]);

result.data;  // [ order, item, stock, null ] — aligned to the operations
result.meta;  // { operations: 4 }
```

`op` prend la valeur `create`, `update`, `upsert` ou `delete`, et `table` restreint
`values` au type `Insert` ou `Update` généré pour cette table — une colonne
inexistante sur la table génère une erreur de compilation, de même qu'une création à laquelle il manque un
champ obligatoire. `table` représente l'accesseur, c'est-à-dire le nom pris par
`client.data.<accessor>` (`orderItems` pour le slug `order_items`) ; le client transmet le slug,
par le biais du dictionnaire `tables` avec lequel il a été instancié. Chaque
opération exécute le même pipeline que son équivalent sur une seule ligne — la même
validation, les mêmes hooks et la même sécurité au niveau des lignes, sous la même identité utilisateur.

### `$ref`

Une opération peut se nommer avec `ref` ; une opération ultérieure peut placer
`{ $ref: "<nom>.<champ>" }` à n'importe quel endroit où une valeur est attendue, y compris comme `id` et
à n'importe quel niveau d'imbrication dans `values`. Elle se résout avec ce champ de la ligne écrite par
l'opération nommée.

C'est la raison d'être de cette méthode par rapport à une boucle sur `createMany` : la
clé étrangère de l'élément enfant n'existe pas tant que le parent n'a pas été inséré, obligeant à deux
requêtes séparées — or deux requêtes séparées peuvent réussir à moitié. La récupération
après un tel échec (relire, déterminer quelle moitié a été enregistrée, l'annuler) est un code que personne
n'a envie d'écrire.

Seules les références vers l'arrière sont résolues. Une référence vers l'avant est refusée avant même
l'ouverture de la transaction, tout comme les tables inconnues, les champs inconnus, les opérations
sur les champs non autorisées et les cibles de conflit non éligibles — car découvrir une erreur à la
40e opération coûterait autrement l'annulation des 39 écritures précédentes.

### Limites et échecs

Le même plafond de 1 000 opérations s'applique que pour une écriture en masse, pour la même raison : un lot
conserve ses verrous pendant toute la durée de la transaction. Un `update` ou un `delete` ciblant une ligne
inexistante fait échouer l'ensemble du lot avec une 404. Un backend dont le pilote
ne peut pas garantir l'atomicité renvoie `BATCH_UNSUPPORTED` plutôt que d'exécuter une boucle.

`idempotencyKey` et `returning` fonctionnent de la même manière que pour toute autre écriture.

Côté serveur, `rebase.dataAsAdmin.batch([...])` et `context.data.batch([...])`
acceptent les mêmes opérations et renvoient le même résultat, au sein de la transaction propre à l'appelant.
Le nom `batch` y est réservé tout comme `table` : une table dont
l'accesseur est `batch` est accessible via `data.table("batch")`.
