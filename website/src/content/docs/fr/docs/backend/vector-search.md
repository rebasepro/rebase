---
sourceHash: 8376384a90695757
title: Recherche vectorielle
sidebar_label: Recherche vectorielle
description: Recherche des plus proches voisins sur une propriété vectorielle via l'API REST — les paramètres de requête, les seuils, les embeddings trop longs pour une URL, et le comportement des filtres sur un index HNSW.
---

Si une collection définit une propriété de type `vector`, vous pouvez effectuer des recherches de similarité rapides avec les opérations de distance de pgvector, compilées directement dans la requête de base de données.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

## Paramètres de requête

| Paramètre | Type | Description |
|-----------|------|-------------|
| `vector_search` | `string` | Le nom de la propriété vectorielle à interroger. |
| `vector` | `string` | Un tableau de nombres flottants sérialisé en JSON, représentant le vecteur de la requête. |
| `vector_distance` | `string` | La métrique de distance à évaluer. Valeurs prises en charge : `cosine` (par défaut, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Seuil de distance maximal. Seuls les enregistrements dont la distance est inférieure à ce seuil sont renvoyés. |

Une recherche vectorielle avec un
`vector_threshold` n'a pas de `meta.total` : compter les lignes dans une distance donnée revient à
calculer cette distance pour chaque ligne de la table, ce qu'aucun index ne sert — plusieurs
fois le coût de la page elle-même, croissant avec lignes × dimensions. `meta.hasMore` est
exact, obtenu en lisant une ligne au-delà de la page. Sans seuil, le décompte est le décompte
ordinaire.

Un embedding est long dans une URL : 768 dimensions représentent environ 17 Ko de chaîne de requête et
1 536 environ 33 Ko. Le serveur accepte jusqu'à 64 Ko de ligne de requête et d'en-têtes
(; 16 Ko auparavant, un 431
à partir de 768 dimensions), et un proxy placé devant en accepte généralement moins — la valeur par défaut de nginx
est de 8 Ko. Envoyez plutôt une recherche vectorielle par [`POST …/query`](#requêtes-trop-longues-pour-une-url) ;
le SDK le fait toujours.

## Filtres sur un index approximatif

Une recherche vectorielle qui
filtre aussi — un `where`, une recherche, la sécurité au niveau des lignes — renvoie les lignes les plus proches
qui correspondent. Un index HNSW répond avec un nombre fixe de candidats les plus proches
(`hnsw.ef_search`, 40 par défaut), et les autres conditions leur sont appliquées ;
lorsque peu d'entre eux correspondent, la page revenait courte ou vide alors que de nombreuses lignes
correspondaient, et les pages par décalage sautaient des lignes. Avec pgvector 0.8.0 ou ultérieur, la lecture active
le balayage itératif d'index de pgvector (`hnsw.iterative_scan = strict_order`, pour la
transaction de cette lecture seulement), qui continue de balayer jusqu'à ce que la page soit pleine, dans la limite de
`hnsw.max_scan_tuples` (20 000 par défaut) — un filtre qui ne correspond presque à rien
près du vecteur de la requête peut tout de même renvoyer une page courte. Sur un pgvector plus ancien, et sur
un index IVFFlat, une recherche vectorielle filtrée garde le comportement de page courte ; un balayage
exact (`index: false`) ne l'a jamais eu.

## Requêtes trop longues pour une URL

`POST /api/data/:slug/query`
est le listing que répond `GET /api/data/:slug`, avec les paramètres de requête dans un corps
JSON au lieu de l'URL. Utilisez-le lorsque l'URL ne tiendrait pas — l'embedding d'une
recherche vectorielle, un filtre sur une longue liste `in`. Le SDK envoie ainsi chaque recherche vectorielle,
ainsi que toute autre requête dont l'URL dépasserait 6 Ko.

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

Les clés du corps sont les paramètres de requête, et le serveur les relit pour en faire
exactement les paramètres que lit le `GET`, avec le même analyseur — mêmes filtres,
page, décompte, curseur et includes, même sécurité au niveau des lignes, mêmes erreurs. Une valeur est
écrite comme l'écrit l'URL : une chaîne (ou un nombre ou un booléen), et pour un filtre
répété dans l'URL une liste (`"views": ["gte.10", "lte.99"]`). `where`, `include`,
`orderBy` et `vector` prennent leur valeur JSON elle-même ou ce JSON sous forme de chaîne. Une
liste pour un paramètre que l'URL ne lit qu'une fois, un objet partout ailleurs, ou un paramètre
mis aussi dans l'URL donne un 400 `INVALID_QUERY_BODY`.

Il ne fait que lire : une clé d'API a donc besoin de `data:read` pour cela, pas de `data:write`, et il
compte dans la même limite de débit que le `GET`. Les listings imbriqués l'ont aussi :
`POST /api/data/authors/42/posts/query`. Un serveur antérieur à la 0.24 répond 404 ;
le SDK envoie alors le `GET`.

Le décompte a le
même jumeau : `POST /api/data/:slug/count` (et `POST /api/data/authors/42/posts/count`)
est `GET /api/data/:slug/count` avec ses paramètres dans le corps, lus de la même façon
et refusés de la même façon. Un décompte porte les filtres du `find()` qu'il décrit,
son URL est donc aussi longue. Le `count()` du SDK suit la règle de `find()` — chaque recherche
vectorielle, et tout décompte dont l'URL dépasserait 6 Ko — et se rabat sur le
`GET` face à un serveur plus ancien.

## Voir aussi

- [API REST](/docs/backend/api/) — tous les autres paramètres que prend un listing
- [Agrégats et recherche](/docs/sdk/aggregates-and-search/#vector-search) — `.vectorSearch()` depuis le SDK, et l'index que reçoit une propriété vectorielle
