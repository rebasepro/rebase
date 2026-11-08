---
sourceHash: 7715c57bf7cc986a
title: Agrégats et recherche
sidebar_label: Agrégats & recherche
description: "Comptez, additionnez et groupez avec le SDK, filtrez au sein des colonnes JSON, et exécutez des recherches textuelles et vectorielles depuis le client."
---

## Agrégats

`count`, `sum`, `avg`, `min` et `max` sur les lignes sélectionnées par un filtre, sans les récupérer :

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)
```

```json
{ "data": [{ "count": 128, "sum_total": 40522 }] }
```

Groupez pour obtenir une ligne par valeur :

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)&groupBy=status
```

```json
{
  "data": [
    { "status": "paid",    "count": 96, "sum_total": 31200 },
    { "status": "pending", "count": 32, "sum_total": 9322 }
  ]
}
```

Les résultats sont indexés par fonction et par champ — `count()` devient `count`, `sum(total)` devient `sum_total`.

Les groupes se paginent comme les lignes d'une liste. `limit` les délimite, `offset` (ou `page`) les ignore, et `orderBy` les trie selon un champ de `groupBy` ou une clé de résultat. L'ordre se termine toujours par les clés de groupe, de sorte que chaque limite de page tombe au même endroit. Un agrégat groupé sans `limit` est tronqué à la valeur par défaut d'une liste (50 groupes), tout comme une liste. Avec un `limit` — y compris celui par défaut — la réponse indique s'il y en a d'autres, et la fonction `aggregate()` du SDK le renvoie sous forme de `meta` sur le résultat :

```bash
GET /api/data/orders/aggregate?select=count()&groupBy=customer&orderBy=count:desc&limit=20&offset=20
```

```json
{ "data": [ … ], "meta": { "limit": 20, "offset": 20, "hasMore": true } }
```

`offset`, `page` ou `orderBy` sans `groupBy`, ou un curseur sur n'importe quel agrégat, renvoie une erreur `400 INVALID_AGGREGATE_WINDOW` : un agrégat non groupé ne comporte qu'une seule ligne, et un groupe n'est pas une ligne qu'un curseur peut poursuivre.

Un agrégat lit les valeurs stockées et n'exécute jamais `afterRead`. Ainsi, sur une collection réécrite par un rappel `afterRead` — au niveau global, de la collection ou d'une propriété — seul `count()` sans `groupBy` est pris en charge, aussi bien via HTTP qu'en processus ; toute autre opération renvoie une erreur `400 AGGREGATE_MASKED_BY_AFTER_READ`, car une somme, un maximum ou un groupe lirait les valeurs masquées par le rappel.

Depuis le SDK, `aggregate()` accepte le même `orderBy` que `find()` — un tuple `[key, "asc" | "desc"]` ou une liste de tuples — où la clé est une colonne de `groupBy` ou une clé de résultat. Les deux sont typés : sur un modèle généré, une clé qui n'est ni l'une ni l'autre ne compilera pas. En processus interne (`rebase.data`), les groupes reviennent dans le même ordre que via HTTP.

```ts
const topCustomers = await client.data.orders.aggregate({
    select: [{ fn: "count" }, { fn: "sum", field: "total" }],
    groupBy: ["customer"],
    orderBy: ["sum_total", "desc"],
    limit: 10
});
```

Il accepte les mêmes filtres que le point de terminaison de liste, de sorte qu'un agrégat peut être affiné de la même manière qu'un listing :

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**La sécurité au niveau des lignes (Row-level security) s'applique aux lignes agrégées.** Un agrégat est un moyen efficace d'obtenir des informations sur des lignes que vous ne pouvez pas lire ; il s'exécute donc selon les propres politiques de l'appelant : quelqu'un qui ne peut rien sélectionner ne compte rien.
:::

Les agrégats nécessitent un pilote qui les implémente. Sur un pilote qui ne le fait pas, le point de terminaison répond `501` plutôt qu'un résultat vide — un tableau de bord ne devrait pas afficher "aucun résultat" alors que la réalité est "non pris en charge".

## Filtrer au sein du JSON

Une colonne `json` ou `jsonb` peut être filtrée par chemin (path), en utilisant la syntaxe avec flèches propre à Postgres :

```typescript
// Orders whose metadata says the country is US
const { data } = await client.data.orders
    .where("metadata->>country", "==", "US")
    .find();

// Nested paths walk with -> and take the leaf with ->>
await client.data.orders.where("metadata->address->>city", "==", "Berlin").find();
```

Via REST :

```bash
GET /api/data/orders?metadata->>country=eq.US
```

Les segments de chemin sont toujours envoyés sous forme de paramètres liés, jamais injectés directement dans le SQL.

### Comparaison des valeurs

`->>` produit du **texte**, les comparaisons sont donc des comparaisons textuelles — à l'exception d'un opérateur d'ordre (`>`, `>=`, `<`, `<=`) recevant un **nombre**, qui effectue un transtypage vers une valeur numérique :

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Les lignes dont la valeur à ce chemin n'est pas un nombre sont exclues d'une comparaison numérique plutôt que de faire échouer la requête. Les booléens sont comparés sous forme de `"true"` / `"false"`, qui est la manière dont `->>` les restitue.

:::note
`array-contains` et les autres opérateurs portant sur l'ensemble de la colonne ne sont pas disponibles sur un chemin — ils interrogent l'intégralité du document, utilisez-les donc directement sur la colonne elle-même.
:::

## Recherche textuelle

```typescript
// Via find params
const { data } = await client.data.products.find({
    searchString: "wireless headphones"
});

// Fluent style
const { data } = await client.data.products
    .search("wireless headphones")
    .limit(10)
    .find();
```

Par défaut, il s'agit d'une **recherche de sous-chaîne insensible à la casse** sur les propriétés `string` de premier niveau de la collection. Il ne s'agit pas d'une recherche plein texte : elle n'explore pas l'intérieur des propriétés `map` ou `array`, n'effectue pas de racinisation ni de classement, et ne peut pas utiliser d'index.

Une collection Postgres peut opter pour une véritable recherche plein texte en déclarant un bloc `search`, ce qui permet également de classer les résultats par `_score`. Consultez [Recherche](/docs/backend/search).

## Recherche vectorielle

Pour les collections disposant d'une propriété `vector`, ordonnez les lignes par similarité avec un embedding de requête. Les lignes sont renvoyées de la plus proche à la plus éloignée, chacune portant une propriété `_distance`. La distance détermine l'ordre : un `orderBy` sur la même requête est ignoré. Sans `limit`, une recherche vectorielle renvoie 10 lignes, et non 50 comme un listing standard.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

`where` sur la même requête sert de filtre pour déterminer quelles lignes sont candidates — cela renvoie les lignes les plus proches qui correspondent également aux critères, et non les lignes les plus proches filtrées a posteriori. Sur l'index HNSW, cela s'applique à partir de pgvector 0.8.0 (voir [Filtres sur un index approximatif](/docs/backend/vector-search/#filters-on-an-approximate-index)) ; sur une version plus ancienne de pgvector, un filtre auquel peu de lignes proches correspondent renvoie une page courte. Produire `queryVector` relève de votre responsabilité : Rebase stocke et recherche les embeddings, mais ne les calcule pas.

Le SDK envoie une recherche vectorielle sous la forme `POST /api/data/<collection>/query`, avec l'embedding dans le corps de la requête : dans l'URL, 768 dimensions représentent environ 17 Ko, dépassant ce que Node (16 Ko) et la plupart des proxys (nginx : 8 Ko) acceptent. `count()` avec une recherche vectorielle fonctionne de la même manière, via `POST /api/data/<collection>/count`. Avec un serveur antérieur à la version 0.24, qui ne dispose pas d'une telle route, l'un comme l'autre bascule vers un `GET` — et un embedding volumineux peut alors être rejeté avec une erreur 431 ou 414.

Avec un `threshold`, le résultat ne comporte pas de `meta.total` — compter les lignes situées à une certaine distance nécessiterait de le calculer pour chaque ligne de la table. Paginez avec `meta.hasMore`, qui reste exact.

### Ce que vous devez fournir

- **pgvector.** Une propriété `vector` est compilée en une colonne `VECTOR(n)`, et ce type provient de l'extension `vector`. Rebase l'installera pour vous, mais uniquement là où vous l'y autorisez :

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Cette ligne constitue une autorisation plutôt qu'une requête — Rebase n'exécute `CREATE EXTENSION IF NOT EXISTS vector` que lorsque votre schéma le nécessite. Il s'agit d'un choix explicite (opt-in) car l'installation d'une extension dépend d'éléments que Rebase ne peut pas détecter depuis la connexion : l'image doit inclure la bibliothèque (ce qui est le cas de `pgvector/pgvector:pg18` du scaffold, mais pas d'un `postgres:18` standard), le rôle doit avoir l'autorisation de l'installer, et un fournisseur géré doit l'avoir inscrite sur une liste autorisée.

  Si vous ne spécifiez rien, Rebase n'installe rien — installez-la manuellement une fois dans ce cas. Dans les deux cas, la colonne est créée, et Postgres la refusera avec l'erreur `type "vector" does not exist` sur une base de données qui ne dispose d'aucune de ces options, indiquant les deux solutions possibles.

La colonne, son index ANN et ce `CREATE EXTENSION` sont générés dans `.rebase/sql/vector.sql`, aux côtés de `schema.sql` et `policies.sql`, et `rebase db push` les applique pour vous. Ils disposent de leur propre fichier car Atlas — le moteur derrière `db push` — calcule son diff en matérialisant `schema.sql` dans une base de données temporaire qu'il réinitialise au début de chaque exécution, de sorte qu'un `VECTOR(n)` présent dans ce fichier serait résolu sur une base de données qui ne peut jamais disposer de pgvector.

`rebase db generate` ajoute ce fichier à la migration qu'il génère, de sorte qu'une migration rejouée sur une base de données vierge crée également la colonne. Une modification portant uniquement sur la propriété vectorielle ne génère aucune migration, car le schéma comparé par Atlas reste inchangé — `db generate` vous en informe le cas échéant.

### L'index

Chaque colonne vectorielle reçoit un index HNSW pour la distance cosinus, créé en même temps que la table et signalé au démarrage. Le cosinus est utilisé car c'est la mesure par défaut de `vectorSearch` à moins que vous ne transmettiez `distance` — un index ne dessert qu'un seul opérateur, donc une requête `l2` sur un index cosinus repasse silencieusement en analyse séquentielle.

Ajustez-le ou désactivez-le sur la propriété :

```ts
embedding: {
    type: "vector",
    dimensions: 1536,
    // Defaults: one HNSW index, cosine. Any of these may be omitted.
    index: {
        method: "hnsw",              // or "ivfflat"
        distance: ["cosine", "l2"],  // one index each
        m: 24,                       // hnsw
        efConstruction: 128          // hnsw
    }
}
```

`index: false` conserve volontairement le scan exact. Au-delà de 2000 dimensions, pgvector ne peut construire aucun des deux types d'index ; la colonne est donc créée sans indexation et le démarrage le signale — `vectorSearch` répond toujours, sous forme de scan exact.

`vectorSearch` est une requête, pas un abonnement : appeler `.listen()` sur celle-ci est refusé plutôt que traité comme un simple listing, car rien ne recalcule les distances lors d'une écriture.

## Prochaines étapes

- [Interroger les données](/docs/sdk/querying/) — le constructeur de requêtes sur lequel ces opérations reposent
- [Recherche](/docs/backend/search/) — comment la recherche plein texte et vectorielle est configurée côté backend
- [API REST](/docs/backend/api/) — les mêmes requêtes via HTTP
