---
sourceHash: 6a0a2927f191087f
title: Agrégats et recherche
sidebar_label: Agrégats & recherche
description: "Comptez, additionnez et regroupez avec le SDK, filtrez dans les colonnes JSON, et exécutez des recherches textuelles et vectorielles depuis le client."
---

## Agrégats

`count`, `sum`, `avg`, `min` et `max` sur les lignes sélectionnées par un filtre,
sans les récupérer :

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)
```

```json
{ "data": [{ "count": 128, "sum_total": 40522 }] }
```

Regroupez pour obtenir une ligne par valeur :

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

Les résultats sont indexés par fonction et par champ — `count()` devient `count`,
`sum(total)` devient `sum_total`.

Les groupes se paginent comme les lignes d'un listage. `limit` les borne,
`offset` (ou `page`) les saute et `orderBy` les trie par un champ de `groupBy`
ou une clé de résultat. L'ordre se termine toujours sur les clés de groupe, donc
chaque limite de page tombe au même endroit. Un agrégat groupé sans `limit` est
tronqué à la valeur par défaut d'un listage (50 groupes), comme un listage
ordinaire. Avec un `limit` — y compris celle par défaut — la réponse indique
s'il en reste, et `aggregate()` du SDK le restitue sous forme de `meta` sur le
résultat :

```bash
GET /api/data/orders/aggregate?select=count()&groupBy=customer&orderBy=count:desc&limit=20&offset=20
```

```json
{ "data": [ … ], "meta": { "limit": 20, "offset": 20, "hasMore": true } }
```

`offset`, `page` ou `orderBy` sans `groupBy`, ou un curseur sur n'importe quel
agrégat, donne un `400 INVALID_AGGREGATE_WINDOW` : un agrégat non groupé n'a
qu'une ligne, et un groupe n'est pas une ligne après laquelle un curseur
pourrait reprendre.

Depuis le SDK, `aggregate()` accepte le même `orderBy` qu'un `find()` — un seul
tuple `[key, "asc" | "desc"]` ou une liste de tuples — où la clé est une colonne de `groupBy`
ou une clé de résultat. Les deux sont typés : sur un modèle généré, une clé qui n'est ni
l'une ni l'autre ne compile pas. En cours de processus (`rebase.data`), les groupes reviennent dans
le même ordre que via HTTP.

```ts
const topCustomers = await client.data.orders.aggregate({
    select: [{ fn: "count" }, { fn: "sum", field: "total" }],
    groupBy: ["customer"],
    orderBy: ["sum_total", "desc"],
    limit: 10
});
```

Il accepte les mêmes filtres que le point de terminaison de liste, de sorte qu'un
agrégat peut être restreint de la même manière qu'un listing :

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**La sécurité au niveau des lignes (RLS) s'applique aux lignes agrégées.** Un
agrégat est un moyen efficace d'obtenir des informations sur des lignes que vous
ne pouvez pas lire, il s'exécute donc selon les politiques propres à l'appelant :
une personne qui ne peut rien sélectionner ne compte rien.
:::

Les agrégats nécessitent un pilote (driver) qui les implémente. Sur un pilote
qui ne le fait pas, le point de terminaison renvoie `501` plutôt qu'un résultat
vide — un tableau de bord ne devrait pas recevoir « aucune correspondance »
lorsque la réalité est « non pris en charge ».

## Filtrer dans du JSON

Une colonne `json` ou `jsonb` peut être filtrée par chemin, en utilisant la
syntaxe de flèche propre à Postgres :

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

Les segments de chemin sont toujours envoyés sous forme de paramètres liés,
jamais concaténés directement dans le SQL.

### Comparaison des valeurs

`->>` renvoie du **texte**, les comparaisons sont donc des comparaisons textuelles
— sauf lorsqu'un opérateur de comparaison (`>`, `>=`, `<`, `<=`) reçoit un
**nombre**, auquel cas il effectue un transtypage vers le numérique :

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Les lignes dont la valeur à ce chemin n'est pas un nombre sont exclues d'une
comparaison numérique plutôt que de faire échouer la requête. Les booléens sont
comparés comme `"true"` / `"false"`, qui correspond au format renvoyé par `->>`.

:::note
`array-contains` et les autres opérateurs portant sur l'ensemble de la colonne
ne sont pas disponibles sur un chemin — ils interrogent l'ensemble du document,
utilisez-les donc directement sur la colonne elle-même.
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

Par défaut, il s'agit d'une **recherche de sous-chaîne insensible à la casse**
sur les propriétés `string` de premier niveau de la collection. Il ne s'agit pas
d'une recherche en texte intégral : elle ne fouille pas dans les propriétés `map`
ou `array`, ne fait pas de racinisation ni de classement, et ne peut pas utiliser
d'index.

Une collection Postgres peut activer une véritable recherche plein texte en
déclarant un bloc `search`, ce qui permet également de classer les résultats par
`_score`. Voir [Recherche](/docs/backend/search).

## Recherche vectorielle

Pour les collections possédant une propriété `vector`, triez les lignes par
similarité avec un embedding de requête. Les lignes sont renvoyées de la plus
proche à la plus éloignée, chacune portant un `_distance`. La distance
est l'ordre : un `orderBy` sur la même requête est ignoré. Sans `limit`, une recherche vectorielle renvoie
10 lignes, et non les 50 d'une liste.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

`where` sur la même requête est un filtre sur les lignes candidates — cela renvoie
les lignes les plus proches qui correspondent également, et non les lignes les plus
proches filtrées après coup. Sur l'index HNSW, cela vaut à partir de pgvector 0.8.0 (voir
[Filtres sur un index approximatif](/docs/backend/vector-search/#filters-on-an-approximate-index)) ;
sur un pgvector plus ancien, un filtre que peu des lignes les plus proches satisfont renvoie une page
trop courte. La production de `queryVector` vous incombe : Rebase stocke et recherche les embeddings,
il ne les calcule pas.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Le SDK envoie une recherche vectorielle sous la forme `POST /api/data/<collection>/query`, avec l'embedding
dans le corps : dans l'URL, 768 dimensions représentent environ 17 Ko, au-delà de ce qu'acceptent Node (16 Ko) et la
plupart des proxys (nginx : 8 Ko). `count()` avec une recherche vectorielle emprunte le même chemin, sous la forme
`POST /api/data/<collection>/count`. Face à un serveur antérieur à la 0.24, qui n'a pas cette route, l'un comme
l'autre se rabat sur le `GET` — et un long embedding peut alors encore être refusé par un 431 ou un 414.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Avec un `threshold`, le résultat n'a pas de `meta.total` — compter les lignes situées dans une
distance le calcule pour chaque ligne de la table. Paginez avec `meta.hasMore`, qui reste exact.

### Ce que vous devez fournir

- **pgvector.** Une propriété `vector` est compilée en une colonne `VECTOR(n)`,
  et ce type provient de l'extension `vector`. Rebase l'installera pour vous,
  mais uniquement là où vous l'y autorisez :

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Cette ligne constitue une autorisation plutôt qu'une requête directe — Rebase
  exécute `CREATE EXTENSION IF NOT EXISTS vector` uniquement lorsque quelque
  chose dans votre schéma en a besoin. C'est une démarche volontaire (opt-in)
  car l'installation d'une extension dépend d'éléments que Rebase ne peut pas
  voir depuis l'intérieur de la connexion : l'image doit inclure la bibliothèque
  (c'est le cas de `pgvector/pgvector:pg18` fournie par le scaffold, pas d'un
  `postgres:18` standard), le rôle doit avoir l'autorisation de l'installer, et
  un fournisseur infogéré doit l'avoir inscrite sur liste blanche.

  Si vous ne spécifiez rien, Rebase n'installe rien — installez-la manuellement
  une fois à la place. Dans les deux cas, la colonne est créée, et Postgres la
  refuse avec `type "vector" does not exist` sur une base de données qui n'a ni
  l'un ni l'autre, en indiquant les deux solutions possibles.

La colonne, son index ANN et ce `CREATE EXTENSION` sont générés dans
`.rebase/sql/vector.sql`, aux côtés de `schema.sql` et `policies.sql`, et `rebase db
push` les applique pour vous. Ils disposent de leur propre fichier car Atlas —
le moteur derrière `db push` — calcule son diff en matérialisant `schema.sql`
dans une base de données temporaire qu'il réinitialise au début de chaque
exécution ; ainsi, un `VECTOR(n)` à cet endroit serait résolu par rapport à une
base de données qui ne peut jamais disposer de pgvector.

`rebase db generate` ajoute ce fichier à la migration qu'il génère, de sorte
qu'une migration rejouée sur une base de données vierge crée également la colonne.
Une modification apportée uniquement à la propriété vectorielle ne produit aucune
migration, car le schéma dont Atlas calcule le diff reste inchangé — `db generate`
le signale lorsque cela se produit.

### L'index

Chaque colonne vectorielle reçoit un index HNSW pour la distance cosinus, créé
avec la table et signalé au démarrage. Cosinus, car c'est ce que `vectorSearch`
mesure par défaut à moins de passer `distance` — un index ne sert qu'un seul
opérateur à la fois, donc une requête `l2` sur un index cosinus repasse
silencieusement en parcours complet (scan).

Ajustez-le, ou désactivez-le, sur la propriété :

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

`index: false` conserve délibérément le scan exact. Au-delà de 2000 dimensions,
pgvector ne peut construire aucun des deux types d'index ; la colonne est donc
créée et laissée sans index, et le démarrage le signale — `vectorSearch` répond
toujours, sous forme de scan exact.

`vectorSearch` est une requête, pas un abonnement : appeler `.listen()` dessus
est refusé plutôt que traité comme un simple listing, car rien ne recalcule les
distances lors d'une écriture.

## Prochaines étapes

- [Interroger les données](/docs/sdk/querying/) — le constructeur de requêtes sur lequel ils s'appuient
- [Recherche](/docs/backend/search/) — comment la recherche en texte intégral et vectorielle est configurée sur le backend
- [API REST](/docs/backend/api/) — les mêmes requêtes via HTTP
