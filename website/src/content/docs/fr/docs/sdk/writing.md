---
sourceHash: a31d37ab40b701e5
title: Écriture de données
sidebar_label: Écriture de données
description: create, upsert, update et delete avec le SDK — opérations sur les champs, écritures conditionnelles, clés d'idempotence, écritures par lots et écriture entre collections dans une seule transaction.
---

Les lectures se trouvent sur [Interrogation des données](/docs/sdk/querying/). Cette page représente l'autre moitié :
tout ce qui modifie une ligne.

Chaque méthode présentée ici passe par le même pipeline qu'une écriture venant de n'importe où ailleurs — les [callbacks](/docs/collections/callbacks/),
les [relations](/docs/collections/relations/) et la
[sécurité au niveau des lignes](/docs/collections/security-rules/) s'appliquent toujours. Rien de
tout cela n'est un raccourci pour contourner vos propres règles ; ce que ces options vous apportent, c'est un aller-retour réseau, une
transaction ou une situation de concurrence que vous n'avez plus à perdre.

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

Insérez la ligne, ou remplacez celle qui occupe déjà sa clé :

```typescript
await client.data.users.upsert(
    { email: "ada@example.com", name: "Ada" },
    { onConflict: ["email"] }
);
```

Une seule instruction côté serveur (`INSERT … ON CONFLICT DO UPDATE`), donc contrairement à un
`findById` suivi d'un `create` ou d'un `update`, elle ne peut pas perdre la course entre les
deux, et contrairement à `create`, elle n'échoue pas lorsque la ligne est déjà présente.

`onConflict` cible par défaut la clé primaire, ce qui n'est pas la bonne cible pour la plupart
des écritures pour lesquelles on utilise un upsert : indexé sur un identifiant séquentiel, il s'agit d'une simple
insertion, car l'appelant ne connaît pas l'id — ainsi, un import rejouable
duplique chaque ligne lors de la deuxième exécution. Indiquez plutôt la clé naturelle. Elle doit
comporter une garantie d'unicité sur laquelle la base de données peut s'aligner — `validation: { unique:
true }` sur la propriété, ou les colonnes d'un [index](/docs/backend/indexes/) `unique: true`
— et tout autre élément renverra une erreur 400 listant les cibles
existantes, plutôt qu'une erreur levée depuis l'intérieur d'une transaction.

L'horodatage `on_create` d'une ligne qui existait déjà n'est pas modifié : un
conflit signifie que sa création est un fait appartenant au passé.

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
| `$inc` | `number` | additionner (négatif pour soustraire) |
| `$push` | `array` | ajouter une valeur, ou chacun des éléments d'un tableau de valeurs |
| `$pull` | `array` | supprimer toutes les occurrences d'une valeur |
| `$merge` | `map` | fusionner superficiellement (*shallow-merge*) un objet |

La raison de les utiliser réside dans la lecture que vous n'effectuez plus, et la situation de concurrence
que cette lecture engendre. `views = current + 1` implique de récupérer d'abord `current`, et deux
requêtes qui lisent chacune `4` écriront toutes les deux `5` — un incrément est perdu et aucune
réponse ne le signale. Compilée dans l'instruction, l'arithmétique s'exécute à l'intérieur
du verrou de ligne.

Exactement un opérateur par champ, et uniquement lors d'une mise à jour : sur une ligne qui
n'existe pas encore, il n'y a rien à manipuler, donc une opération dans un `create`,
`createMany` ou `upsert` renvoie une 400. Un opérateur sur un mauvais type de propriété, ou un
`$operator` mal orthographié, renvoie une 400 mentionnant le champ — jamais un document JSON
écrit dans la colonne.

En mode hors ligne, elles sont refusées plutôt que mises en file d'attente : une opération est évaluée
par rapport à une valeur stockée dont l'appareil n'a pas de copie à jour, et une ligne optimiste
ne pourrait afficher que le marqueur lui-même jusqu'à ce que la file soit traitée.

### Delete

```typescript
await client.data.products.delete(42);
```

### Écritures conditionnelles

`update` et `delete` acceptent un paramètre `ifMatch`, afin qu'une écriture soit refusée lorsque la ligne a
changé depuis que vous l'avez lue :

```typescript
import { etagOf } from "@rebasepro/client";

const post = await client.data.posts.get(1);
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(post) });
// → RebaseApiError, status 412, if somebody edited it in between
```

Sans cela, le modèle lecture-modification-écriture applique le principe du dernier rédacteur gagnant (*last-writer-wins*) sur tout ce que vous n'avez pas
envoyé : deux modifications effectuées à une seconde d'intervalle réussissent toutes les deux, et la modification de la première est
perdue sans qu'aucune erreur ne soit signalée nulle part.

`etagOf(row)` lit la version à partir d'une ligne issue de `findById`/`get`. Elle
réside sur une clé non énumérable, de sorte qu'elle n'entre jamais dans le type `Row` généré, dans un
`JSON.stringify` ou dans une décomposition (*spread*) au sein du corps de la prochaine mise à jour. Elle vaut `undefined` pour une
ligne issue de `find()`, du cache hors ligne ou d'un serveur qui n'envoie pas
d'`ETag` — et passer `undefined` n'envoie aucune précondition, l'appel ci-dessus
se dégrade donc en une mise à jour ordinaire plutôt que de lever une exception.

### Ignorer la réponse

Chaque écriture renvoie la ligne qu'elle a écrite. Passez `{ returning: false }` lorsque vous
n'en avez pas besoin :

```typescript
await client.data.events.create({ kind: "page_view" }, undefined, { returning: false });
```

Cela envoie `Prefer: return=minimal` ; le serveur répond `204` pour une écriture unique
et uniquement les identifiants pour un lot. La méthode résout alors `undefined` (ou `[]`),
vous ne risquez donc pas d'utiliser accidentellement une ligne que le serveur n'a jamais envoyée. Très utile lors des imports
et des écritures sans attente de retour (*fire-and-forget*) — le comportement par défaut renvoie la ligne, car elle contient ce que le
*serveur* a déterminé.

## Écritures par lots (*Batch Writes*)

Trois opérations écrivent plusieurs lignes dans une **seule requête et une seule
transaction**. Chaque ligne passe toujours par le pipeline standard — callbacks, relations,
sécurité au niveau des lignes — un lot n'est donc pas un moyen de contourner vos propres règles ; le gain
réside dans un seul aller-retour réseau et une seule transaction au lieu de N pour chacun.

Toutes les trois fonctionnent en **tout-ou-rien**. Si une seule ligne est rejetée, aucune n'est enregistrée et
l'erreur indique l'index concerné.

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

### Pourquoi `{ id, data }` plutôt que des lignes plates

`createMany` prend des lignes plates car une ligne en cours de création *est* l'ensemble de ses colonnes.
`updateMany` précise l'adresse séparément, car sur une table indexée sur autre chose
que l'`id` — un `sku`, une clé composite — une ligne plate ne peut pas indiquer si une
colonne est l'adresse ou une valeur à écrire. Cela reflète exactement le fonctionnement d'`update(id, data)`
sur une seule ligne.

### Pourquoi `deleteMany` prend des identifiants et non un filtre

Une suppression groupée basée sur un filtre est une opération différente et bien plus dangereuse : le
mode d'échec correspond à une condition omise ou mal tapée vidant une table, et cela ne peut pas
être vérifié au point d'appel comme peut l'être une liste explicite. Lisez d'abord, puis passez
les identifiants visés :

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
await client.data.sessions.deleteMany(stale.map(s => s.id as string));
```

### Tentatives de rejeu et doublons

Un client qui ne reçoit jamais la réponse ne peut pas savoir si le lot a été validé (*committed*),
il réessaie donc — et sans clé, le serveur ne peut pas distinguer cette nouvelle tentative d'un
second lot légitime. Transmettez une clé d'idempotence pour tout ce qui est susceptible d'être renvoyé :

```typescript
const attemptKey = crypto.randomUUID();
await client.data.products.createMany(rows, { idempotencyKey: attemptKey });
```

Une clé identifie une seule requête, pas une tâche : elle est enregistrée en fonction de la méthode, du chemin
et du corps avec lesquels elle a été envoyée. Renvoyer exactement cette requête rejoue sa réponse ;
la même clé sur une requête différente est refusée avec `IDEMPOTENCY_KEY_REUSED`
(422). Générez-en donc une par appel plutôt que de réutiliser un identifiant métier — un `importId`
partagé entre le `createMany` et le `deleteMany` d'un même import laisserait la
suppression ignorée en silence.

Une nouvelle tentative qui arrive alors que la première tentative est encore en cours de traitement reçoit
`IDEMPOTENCY_KEY_IN_PROGRESS` (409) : renvoyez-la, et la réponse correspondant au résultat de la première tentative
vous sera retournée dès que celle-ci aura abouti. Les clés sont conservées pendant 24 heures, et
uniquement pour un appelant authentifié — il n'y a pas d'entité (*principal*) à laquelle la rattacher autrement.

La file d'attente hors ligne définit automatiquement une clé à chaque rejeu.

### Limites

Les lots sont plafonnés côté serveur (1 000 lignes par défaut), car un lot conserve
ses verrous pendant toute la durée de la transaction. Dépasser cette limite entraîne une erreur `BULK_TOO_LARGE` qui
indique à la fois la limite et votre nombre de lignes ; découpez donc vos envois :

```typescript
for (const chunk of chunks(rows, 1000)) {
    await client.data.products.createMany(chunk, { upsert: true });
}
```

Une source de données qui ne peut pas écrire de manière atomique signale `BULK_UNSUPPORTED` plutôt
que de boucler silencieusement sur des écritures individuelles — ce qui ne vous offrirait ni l'atomicité
ni l'unique aller-retour réseau recherchés en utilisant un lot.

## Écriture entre collections

`createMany` et ses variantes s'appliquent à une collection à la fois. `client.batch()` est la
forme multi-collections : une requête, une transaction, tout ou rien.

```typescript
const result = await client.batch([
    { op: "create", collection: "orders",
      values: { total: 40 }, ref: "order" },
    { op: "create", collection: "order_items",
      values: { order_id: { $ref: "order.id" }, sku: "A-1" } },
    { op: "update", collection: "stock",
      id: "A-1", values: { count: { $inc: -1 } } },
    { op: "delete", collection: "carts", id: "c-9" }
]);

result.data;  // [ order, item, stock, null ] — aligned to the operations
result.meta;  // { operations: 4 }
```

`op` correspond à `create`, `update`, `upsert` ou `delete`, et `collection` restreint
`values` au schéma `Insert` ou `Update` généré pour cette collection. Chaque
opération exécute le pipeline correspondant à son équivalent sur une seule ligne — les mêmes
validations, callbacks et sécurité au niveau des lignes, sous la même identité utilisateur.

### `$ref`

Une opération peut se nommer elle-même à l'aide de `ref` ; une opération ultérieure peut placer
`{ $ref: "<name>.<field>" }` partout où une valeur est attendue, y compris comme `id` et à
n'importe quelle profondeur dans `values`. Cette expression est résolue avec la valeur de ce champ de la ligne écrite par
l'opération nommée.

C'est la raison d'être de cette méthode par rapport à une boucle sur `createMany` : la clé
étrangère de l'élément enfant n'existe pas tant que l'élément parent n'est pas inséré, les deux devraient donc
faire l'objet de requêtes distinctes — et des requêtes distinctes peuvent n'aboutir qu'à moitié. La procédure de récupération
dans ce cas (relire, déterminer quelle moitié a été validée, l'annuler) est un code que personne
n'écrit.

Seules les références arrière sont résolues. Une référence vers l'avant est refusée avant
l'ouverture de la transaction, au même titre que les collections inconnues, les champs inconnus, les opérations
de champ non autorisées et les cibles de conflit non valides — car détecter une erreur à
l'opération 40 coûterait sinon l'annulation (*rollback*) des 39 écritures précédentes.

### Limites et échecs

La même limite de 1 000 opérations s'applique comme pour une écriture groupée, pour la même raison : un lot
conserve ses verrous pendant toute la durée de la transaction. Un `update` ou un `delete` ciblant une ligne
qui n'existe pas fait échouer l'ensemble du lot avec une erreur 404. Un backend dont le pilote
ne peut pas assurer l'atomicité renvoie `BATCH_UNSUPPORTED` plutôt que d'exécuter une boucle.

`idempotencyKey` et `returning` fonctionnent de la même manière que pour toute autre écriture.

---
