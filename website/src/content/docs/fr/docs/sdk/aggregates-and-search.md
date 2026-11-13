---
sourceHash: 598d10fdd9ac95db
title: Agrégats et recherche
sidebar_label: Agrégats & recherche
description: "Comptez, additionnez et groupez avec le SDK, filtrez dans les colonnes JSON, et exécutez des recherches textuelles et vectorielles depuis le client."
---

## Agrégats

`count`, `sum`, `avg`, `min`, `max` et les fonctions ci-dessous sur les lignes sélectionnées par un filtre, sans les récupérer :

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

### Fonctions supplémentaires

| `select` | SDK | Clé de résultat | Description |
|---|---|---|---|
| `countDistinct(sid)` | `{ fn: "countDistinct", field: "sid" }` | `count_distinct_sid` | Valeurs non nulles distinctes |
| `mode(lang)` | `{ fn: "mode", field: "lang" }` | `mode_lang` | La valeur la plus fréquente |
| `percentile(price,0.95)` | `{ fn: "percentile", field: "price", p: 0.95 }` | `p95_price` | Centile continu, `p` de 0 à 1 (`0.5` est la médiane) |
| `distinct(lang)` | `{ fn: "distinct", field: "lang" }` | `distinct_lang` | Les valeurs non nulles distinctes, triées, sous forme de tableau |
| `fingerprint()` | `{ fn: "fingerprint" }` | `fingerprint` | Une chaîne qui change dès qu'une ligne couverte change |

### Agrégats filtrés et alias

Un agrégat peut ne compter qu'une partie des lignes : donnez-lui son propre `where` (l'équivalent de `FILTER (WHERE …)` en SQL). Plusieurs agrégats peuvent être combinés en une seule requête sur les lignes sélectionnées par le `where` externe, de sorte qu'un tableau de bord de huit comptages ne nécessite qu'un seul scan. Nommez chacun d'eux avec `as`, ce qui est nécessaire lorsque deux agrégats utilisent la même fonction :

```ts
const [stats] = await client.data.songs.aggregate({
    select: [
        { fn: "count", as: "rows" },
        { fn: "count", as: "live", where: { tags: ["!=", []] } },
        { fn: "count", as: "unplayable", where: { playable: ["==", false] } },
        { fn: "sum", field: "plays", as: "plays" }
    ]
});
// { rows: 30000, live: 21480, unplayable: 312, plays: 918211 }
```

Un nom utilisé deux fois, ou correspondant à la clé d'une colonne `groupBy`, est rejeté (`INVALID_AGGREGATE_SELECT`) plutôt que d'écraser une valeur. En HTTP, un nom s'écrit à la manière de PostgREST, `select=live:count()` ; un agrégat doté de son propre `where` est transmis sous forme de tableau JSON — `select=[{"fn":"count","as":"live","where":{"tags":["!=",[]]}}]`.

Le `field` d'un agrégat peut être un chemin JSON, `props->>players` : `sum`, `avg` et `percentile` lisent la valeur correspondante comme un nombre et ignorent celles qui ne le sont pas, tandis que les autres la lisent comme du texte. Un chemin JSON peut également être une entrée de `groupBy`, indexée par le chemin tel qu'écrit :

```ts
await client.data.events.aggregate({
    select: [{ fn: "count" }, { fn: "avg", field: "props->>players", as: "players" }],
    groupBy: ["props->>music"]
});
// [{ "props->>music": "80s", count: 412, players: 3.4 }, …]
```

### Regroupement par expression

Une entrée `groupBy` peut transformer sa colonne. En HTTP, elle s'écrit comme une fonction, dans le SDK sous la forme `{ field, transform }`, et elle est renvoyée sous `<transform>_<field>` — qui est également le nom utilisé par `orderBy` :

| Transformation | Regroupe par |
|---|---|
| `lower(name)`, `upper(name)` | La colonne en texte minuscule ou majuscule |
| `year(createdAt)`, `month(createdAt)`, `day(createdAt)` | La date, en UTC, sous la forme `2026`, `2026-11`, `2026-11-08` — ou selon un fuseau horaire : `day(createdAt,Europe/Madrid)`, `{ field, transform: "day", timeZone: "Europe/Madrid" }` |
| `unnest(tags)` | Chaque élément d'une colonne de type tableau : un groupe par élément |

```ts
// How many songs carry each tag — the distinct elements of an array column.
const tags = await client.data.songs.aggregate({
    select: [{ fn: "count" }],
    groupBy: [{ field: "tags", transform: "unnest" }],
    orderBy: ["unnest_tags", "asc"]
});
// [{ unnest_tags: "pop", count: 812 }, …]

// Each artist's usual language, however the name is capitalised.
await client.data.songs.aggregate({
    select: [{ fn: "mode", field: "lang" }],
    groupBy: [{ field: "artist", transform: "lower" }]
});
```

```bash
GET /api/data/events/aggregate?select=count(),countDistinct(sid)&groupBy=day(at)&orderBy=day_at:asc
```

### Quelque chose a-t-il changé ? `fingerprint()`

`fingerprint()` répond à la question « cette table a-t-elle changé depuis ma dernière vérification ? » sans lire les lignes : conservez la chaîne, redemandez plus tard, et ne recalculez ce que vous aviez dérivé des lignes que lorsqu'elle diffère. Toute insertion, mise à jour ou suppression d'une ligne couverte la modifie ; une écriture qui ne change rien (définir une colonne à sa propre valeur) peut également la modifier, et supprimer une ligne que vous venez d'ajouter la rétablit. Elle couvre ce que l'appelant peut voir et ce que les filtres sélectionnent, et elle peut être groupée, de sorte que `groupBy=lang` donne une empreinte par langue.

```ts
let lastFingerprint: string | undefined;

async function catalogueChanged(): Promise<boolean> {
    const [{ fingerprint }] = await client.data.songs.aggregate({ select: [{ fn: "fingerprint" }] });
    const changed = fingerprint !== lastFingerprint;
    lastFingerprint = String(fingerprint);
    return changed;
}
```

Elle est calculée à partir des versions de lignes conservées par Postgres, et non à partir des valeurs, ce qui coûte un scan de la table plutôt qu'un hachage de chaque ligne : sur 30 000 lignes, cela prend 4 ms là où `md5(string_agg(...))` sur les lignes en prend 56. Elle n'est pas disponible sur une vue standard, qui ne stocke aucune ligne ; une vue matérialisée en possède une.

Les groupes sont paginés comme les lignes d'un listing. `limit` les restreint, `offset` (ou `page`) en ignore un certain nombre, et `orderBy` les trie par un champ de `groupBy` ou une clé de résultat. L'ordre se termine toujours par les clés de groupe, de sorte que chaque limite de page tombe au même endroit. Un agrégat groupé sans `limit` est tronqué selon la valeur par défaut d'un listing (50 groupes), tout comme un listing. Avec une `limit` — y compris celle par défaut — la réponse indique s'il y en a d'autres, et la méthode `aggregate()` du SDK la renvoie sous `meta` dans le résultat :

```bash
GET /api/data/orders/aggregate?select=count()&groupBy=customer&orderBy=count:desc&limit=20&offset=20
```

```json
{ "data": [ … ], "meta": { "limit": 20, "offset": 20, "hasMore": true } }
```

`offset`, `page` ou `orderBy` sans `groupBy`, ou un curseur sur n'importe quel agrégat, renvoie une erreur `400 INVALID_AGGREGATE_WINDOW` : un agrégat non groupé ne comporte qu'une seule ligne, et un groupe n'est pas une ligne après laquelle un curseur peut continuer.

Un agrégat lit les valeurs stockées et n'exécute jamais `afterRead`. Ainsi, sur une table réécrite par un hook `afterRead` — qu'il soit global, propre à la table ou issu du `.transform()` d'une colonne — seuls `count()` et `fingerprint()` sans `groupBy` sont pris en charge, que ce soit via HTTP ou in-process ; toute autre opération renvoie une erreur `400 AGGREGATE_MASKED_BY_AFTER_READ`, car une somme, un maximum ou un groupe lirait les valeurs masquées par le hook.

Depuis le SDK, `aggregate()` accepte le même `orderBy` que `find()` — un tuple `[key, "asc" | "desc"]` ou une liste de tuples — où la clé est une colonne de `groupBy` ou une clé de résultat. Les deux sont typées : sur un modèle généré, une clé qui n'est ni l'une ni l'autre ne compilera pas. In-process (`rebase.data`), les groupes reviennent dans le même ordre que via HTTP.

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
**La sécurité au niveau des lignes (RLS) s'applique aux lignes agrégées.** Un agrégat est un moyen efficace d'obtenir des informations sur des lignes que vous ne pouvez pas lire ; il s'exécute donc selon les propres politiques de l'appelant : quiconque ne peut rien sélectionner ne compte rien.
:::

Les agrégats nécessitent un pilote qui les implémente. Sur un pilote qui ne les prend pas en charge, le point de terminaison répond `501` plutôt qu'un résultat vide — un tableau de bord ne devrait pas afficher « aucune correspondance » alors que la réalité est « non pris en charge ».

## Filtrer à l'intérieur du JSON

Une colonne `json` ou `jsonb` peut être filtrée par chemin, en utilisant la syntaxe avec flèches propre à Postgres :

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

Les segments de chemin sont toujours transmis en tant que paramètres liés, jamais injectés directement dans le SQL.

### Comparaison des valeurs

`->>` renvoie du **texte**, les comparaisons sont donc des comparaisons textuelles — sauf si un opérateur d'ordre (`>`, `>=`, `<`, `<=`) reçoit un **nombre**, auquel cas il effectue un transtypage vers une valeur numérique :

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Les lignes dont la valeur à ce chemin n'est pas un nombre sont exclues d'une comparaison numérique plutôt que de faire échouer la requête. Les booléens sont comparés comme `"true"` / `"false"`, qui est la manière dont `->>` les restitue.

:::note
`array-contains` et les autres opérateurs s'appliquant à une colonne entière ne sont pas disponibles sur un chemin — ils interrogent l'ensemble du document, utilisez-les donc directement sur la colonne.
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

Par défaut, il s'agit d'une **recherche de sous-chaîne insensible à la casse** sur les colonnes de texte de premier niveau de la table. Il ne s'agit pas d'une recherche en texte intégral : elle n'explore pas l'intérieur des colonnes JSON ou tableaux, ne gère ni la racinisation (stemming) ni le classement (ranking), et ne peut pas utiliser d'index.

Une table peut activer la véritable recherche plein texte en déclarant un bloc `search`, ce qui permet également de classer les résultats par `_score`. Voir [Search](/docs/backend/search).

## Recherche vectorielle

Pour les tables comportant une colonne `col.vector()`, triez les lignes par similarité avec un embedding de requête. Les lignes sont renvoyées de la plus proche à la plus éloignée, chacune portant une valeur `_distance`. La distance détermine l'ordre : un `orderBy` sur la même requête est ignoré. Sans `limit`, une recherche vectorielle renvoie 10 lignes, et non les 50 d'un listing standard.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

Le `where` sur la même requête sert de filtre pour déterminer les lignes candidates — cela renvoie les lignes les plus proches qui correspondent également aux critères, et non les lignes les plus proches filtrées a posteriori. Sur l'index HNSW, cela s'applique à partir de pgvector 0.8.0 (voir [Filters on an approximate index](/docs/backend/vector-search/#filters-on-an-approximate-index)) ; sur une version plus ancienne de pgvector, un filtre auquel peu de lignes proches satisfont renvoie une page incomplète. La génération de `queryVector` vous incombe : Rebase stocke et recherche les embeddings, mais ne les calcule pas.

Le SDK envoie une recherche vectorielle sous la forme `POST /api/data/<table>/query`, avec l'embedding dans le corps de la requête : dans l'URL, 768 dimensions représentent environ 17 Ko, ce qui dépasse ce que Node (16 Ko) et la plupart des proxys (nginx : 8 Ko) acceptent. `count()` avec une recherche vectorielle fonctionne de la même manière, via `POST /api/data/<table>/count`. Face à un serveur antérieur à la version 0.24, qui ne dispose pas d'une telle route, l'un comme l'autre bascule vers un `GET` — et un embedding volumineux peut alors toujours être rejeté avec une erreur 431 ou 414.

Avec un `threshold`, le résultat ne comporte pas de `meta.total` — compter les lignes situées à une certaine distance nécessiterait de la calculer pour chaque ligne de la table. Paginez plutôt avec `meta.hasMore`, qui reste exact.

### Ce que vous devez fournir

- **pgvector.** Une propriété `vector` est compilée en une colonne `VECTOR(n)`, et ce type provient de l'extension `vector`. Rebase l'installera pour vous, mais seulement si vous l'y autorisez :

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Cette ligne constitue une permission plutôt qu'une demande — Rebase n'exécute `CREATE EXTENSION IF NOT EXISTS vector` que lorsque votre schéma le nécessite. Il s'agit d'une option volontaire (opt-in) car l'installation d'une extension dépend d'éléments que Rebase ne peut pas voir depuis la connexion : l'image doit inclure la bibliothèque (ce qui est le cas de `pgvector/pgvector:pg18` du scaffold, mais pas d'un `postgres:18` standard), le rôle doit être autorisé à l'installer, et un fournisseur géré doit l'avoir inscrite sur liste blanche.

  Si vous ne spécifiez rien, Rebase n'installe rien — installez-la alors une fois manuellement. Dans les deux cas, la colonne est créée, et Postgres la refusera avec `type "vector" does not exist` sur une base de données qui n'a ni l'un ni l'autre, en indiquant les deux solutions possibles.

La colonne, son index ANN et ce `CREATE EXTENSION` sont générés dans `.rebase/sql/vector.sql`, aux côtés de `schema.sql` et `policies.sql`, et `rebase db push` les applique pour vous. Ils disposent de leur propre fichier car Atlas — le moteur derrière `db push` — calcule son diff en matérialisant `schema.sql` dans une base de données temporaire qu'il réinitialise au début de chaque exécution ; ainsi, un `VECTOR(n)` s'y trouverait résolu sur une base de données ne disposant jamais de pgvector.

`rebase db generate` ajoute ce fichier à la migration qu'il génère, de sorte qu'une migration rejouée sur une base de données vierge crée également la colonne. Une modification portant uniquement sur la propriété vectorielle ne produit aucune migration, car le schéma comparé par Atlas reste inchangé — `db generate` vous en informe si cela se produit.

### L'index

Chaque colonne vectorielle reçoit un index HNSW pour la distance cosinus, créé avec la table et signalé au démarrage. Cosinus, car c'est la métrique utilisée par `vectorSearch` à moins que vous ne spécifiiez `distance` — un index ne dessert qu'un seul opérateur, donc une requête `l2` sur un index cosinus bascule silencieusement vers un scan séquentiel.

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

`index: false` conserve intentionnellement le scan exact. Au-delà de 2 000 dimensions, pgvector ne peut construire aucun des deux types d'index ; la colonne est donc créée sans indexation, ce qui est signalé au démarrage — `vectorSearch` répond toujours, sous la forme d'un scan exact.

`vectorSearch` est une requête, pas un abonnement : appeler `.listen()` sur celle-ci est refusé plutôt que traité comme un listing ordinaire, car rien ne recalcule les distances lors d'une écriture.

## Prochaines étapes

- [Interroger les données](/docs/sdk/querying/) — le constructeur de requêtes sur lequel reposent ces fonctionnalités
- [Recherche](/docs/backend/search/) — comment la recherche plein texte et vectorielle est configurée côté backend
- [API REST](/docs/backend/api/) — les mêmes requêtes via HTTP
