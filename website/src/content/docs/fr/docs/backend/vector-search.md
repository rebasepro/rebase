---
sourceHash: 889a7fb508265011
title: Recherche vectorielle
sidebar_label: Recherche vectorielle
description: Recherche des plus proches voisins sur une colonne col.vector() via l'API REST — paramètres de requête, seuils, embeddings trop longs pour une URL et comportement des filtres sur un index HNSW.
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une table comportant une colonne `col.vector()` peut faire l'objet d'une recherche par similarité : les lignes les plus proches d'un vecteur de requête, selon une distance pgvector calculée dans la requête de base de données.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

## Déclaration de la colonne

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        name:      col.text().notNull(),
        embedding: col.vector({ dimensions: 1536, index: { method: "hnsw", metric: ["cosine", "l2"] } }),
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

`col.vector({ dimensions })` est une colonne pgvector `vector(dimensions)`, lue et écrite sous la forme d'un tableau `number[]`. Elle bénéficie d'un index de plus proches voisins approximatifs (ANN), à moins que `index` n'indique le contraire :

| Option `index` | Par défaut | Description |
|---|---|---|
| `method` | `"hnsw"` | `"hnsw"` ou `"ivfflat"`. |
| `metric` | `"cosine"` | `"cosine"`, `"l2"` ou `"ip"` (produit scalaire), ou une liste : un index est créé par métrique. |
| `m` | Valeur de pgvector | HNSW : connexions par couche. |
| `efConstruction` | Valeur de pgvector | HNSW : taille de la liste de candidats lors de la construction. |
| `lists` | Valeur de pgvector | IVFFlat : nombre de listes. |

`index: false` ne crée aucun index, de sorte que chaque recherche vectorielle est un scan exact. Une recherche basée sur une distance ne disposant pas de son propre index est également un scan exact ; pensez donc à indexer chaque métrique utilisée dans vos requêtes. Le paramètre de requête s'écrit `inner_product` pour le produit scalaire ; l'option de colonne s'écrit `ip`.


## Paramètres de requête

| Paramètre | Type | Description |
|-----------|------|-------------|
| `vector_search` | `string` | La clé de la colonne vectorielle sur laquelle effectuer la requête. |
| `vector` | `string` | Un tableau de nombres flottants sérialisé en JSON représentant le vecteur de requête. |
| `vector_distance` | `string` | La métrique de distance à évaluer. Valeurs prises en charge : `cosine` (par défaut, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Seuil maximal de distance. Seuls les enregistrements dont la distance est inférieure à ce seuil sont renvoyés. |

Une recherche vectorielle comportant un `vector_threshold` n'a pas de `meta.total` : compter les lignes situées en deçà d'une distance implique de calculer cette distance pour chaque ligne de la table, ce qu'aucun index ne permet de faire — ce qui coûte plusieurs fois le prix de la page elle-même et augmente avec le nombre de lignes × dimensions. `meta.hasMore` est exact, déterminé en lisant une ligne au-delà de la page. Sans seuil, le décompte est le décompte habituel.

Un embedding prend beaucoup de place dans une URL : 768 dimensions représentent environ 17 Ko de chaîne de requête et 1 536 environ 33 Ko. Le serveur accepte jusqu'à 64 Ko pour la ligne de requête et les en-têtes (16 Ko auparavant, entraînant une erreur 431 à partir de 768 dimensions), et un proxy placé en amont accepte généralement moins — la valeur par défaut de nginx étant de 8 Ko. Envoyez plutôt la recherche vectorielle via [`POST …/query`](#requêtes-trop-longues-pour-une-url) ; c'est ce que fait systématiquement le SDK.

## Filtres sur un index approximatif

Une recherche vectorielle qui applique également des filtres — une clause `where`, une recherche, la sécurité au niveau des lignes (RLS) — renvoie les lignes correspondantes les plus proches. Un index HNSW répond avec un nombre fixe de candidats les plus proches (`hnsw.ef_search`, 40 par défaut), et les autres conditions sont appliquées à ceux-ci ; lorsque peu d'entre eux correspondent, la page retournée est incomplète ou vide même si de nombreuses lignes correspondent par ailleurs, et la pagination par décalage (offset) saute des lignes. Avec pgvector 0.8.0 ou une version ultérieure, la lecture active le scan d'index itératif de pgvector (`hnsw.iterative_scan = strict_order`, uniquement pour la transaction de cette lecture), qui poursuit le scan jusqu'à ce que la page soit pleine, dans la limite de `hnsw.max_scan_tuples` (20 000 par défaut) — un filtre qui ne correspond à presque rien près du vecteur de requête peut tout de même renvoyer une page incomplète. Sur une version antérieure de pgvector et sur un index IVFFlat, une recherche vectorielle filtrée conserve ce comportement de page incomplète ; un scan exact (`index: false`) ne l'a jamais eu.

## Requêtes trop longues pour une URL

`POST /api/data/:slug/query` correspond à ce que renvoie le listing `GET /api/data/:slug`, avec les paramètres de requête dans un corps JSON plutôt que dans l'URL. Utilisez-le lorsque l'URL ne convient pas — l'embedding d'une recherche vectorielle, un filtre sur une longue liste `in`. Le SDK envoie toutes les recherches vectorielles de cette façon, ainsi que toute autre requête dont l'URL dépasserait 6 Ko.

```bash
POST /api/data/docs/query
Content-Type: application/json

{
  "vector_search": "embedding",
  "vector": [0.15, 0.22, -0.05],
  "vector_threshold": 0.8,
  "where": { "status": ["==", "published"] },
  "limit": 10
}
```

Les clés du corps sont les paramètres de requête, et le serveur les interprète exactement comme les paramètres lus par la requête `GET`, via le même analyseur — mêmes filtres, pagination, comptage, curseur et inclusions, même sécurité au niveau des lignes, mêmes erreurs. Une valeur s'écrit de la même façon que dans l'URL : une chaîne (ou un nombre ou un booléen), et pour un filtre répété dans l'URL, une liste (`"views": ["gte.10", "lte.99"]`). `where`, `include`, `orderBy` et `vector` acceptent leur valeur JSON brute ou ce JSON sous forme de chaîne de caractères. Une liste pour un paramètre que l'URL ne lit qu'une seule fois, un objet n'importe où ailleurs ou un paramètre également spécifié dans l'URL déclenche une erreur 400 `INVALID_QUERY_BODY`.

Cette opération est en lecture seule, de sorte qu'une clé d'API nécessite `data:read` et non `data:write`, et elle est décomptée de la même limite de débit (rate limit) que le `GET`. Les listings imbriqués en disposent également : `POST /api/data/authors/42/posts/query`. Un serveur antérieur à la version 0.24 répondra par une 404 ; le SDK enverra alors le `GET`.

Le décompte dispose du même pendant : `POST /api/data/:slug/count` (et `POST /api/data/authors/42/posts/count`) est l'équivalent de `GET /api/data/:slug/count` avec ses paramètres dans le corps, lus de la même façon et rejetés de la même façon. Un comptage porte les filtres du `find()` qu'il décrit, son URL est donc tout aussi longue. La méthode `count()` du SDK suit la même règle que `find()` — chaque recherche vectorielle, et tout décompte dont l'URL dépasserait 6 Ko — et se rabat sur le `GET` face à un serveur plus ancien.

## Voir aussi

- [REST API](/docs/backend/api/) — tous les autres paramètres acceptés par un listing
- [Aggregates & search](/docs/sdk/aggregates-and-search/#vector-search) — `.vectorSearch()` depuis le SDK
