---
sourceHash: e658ebda47d3942e
title: Pagination
sidebar_label: Pagination
description: Paginer une table avec limit/offset, des numéros de page ou un curseur keyset — et quand chacune de ces méthodes cesse d'être correcte.
---

Trois façons de parcourir une table : un décalage (offset), un numéro de page et un curseur. Les deux premières sont positionnelles et la troisième ne l'est pas, ce qui fait toute la différence — une page positionnelle relit en comptant depuis le début, de sorte que les lignes écrites pendant la pagination décalent la signification de la « ligne 20 ».

```typescript
// Offset-based pagination
const page1 = await client.data.products.find({ limit: 20, offset: 0 });
const page2 = await client.data.products.find({ limit: 20, offset: 20 });

// Check if more pages exist
if (page1.meta.hasMore) {
    // fetch next page
}

// Page-number pagination (1-indexed)
const page = await client.data.products.find({ page: 2, limit: 20 });
```

Utilisez l'un ou l'autre. `page` et `offset` décrivent ensemble la même fenêtre deux fois, et la lecture est refusée avec `PAGE_WITH_OFFSET` plutôt que d'appliquer silencieusement `page`. Le SDK la refuse avant toute requête, sur HTTP, en cours de processus et hors ligne ; le serveur répond à une requête brute envoyant les deux avec une erreur 400.

`limit` doit être un nombre entier compris entre 1 et 1000. Une valeur supérieure — ou égale à zéro, négative ou fractionnaire — est refusée avec une erreur 400 `INVALID_LIMIT` plutôt que restreinte (clamped), car une page silencieusement réduite ne peut être distinguée de la dernière page. Pour lire au-delà de cette limite maximale, parcourez les pages avec `iterate()` ou `findAll()`.

#### Pagination par curseur

Chaque réponse de liste comporte un `meta.nextCursor` tant qu'il existe une autre page. Renvoyez-le dans le paramètre `after` et la page suivante reprendra **strictement après la dernière ligne servie**, plutôt qu'à un *décompte* de lignes que des écritures concurrentes auraient déjà décalé :

```typescript
let after: string | undefined;
do {
    const { data, meta } = await client.data.orders.find({
        orderBy: ["createdAt", "desc"],
        limit: 100,
        after
    });
    for (const order of data) await handle(order);
    after = meta.nextCursor;
} while (after);
```

`nextCursor` est absent sur la dernière page, ainsi que sur une page qu'aucun curseur ne peut décrire : une recherche ordonnée par pertinence (`_score`), une recherche vectorielle, ou une projection `fields` qui omet l'un des champs de `orderBy` — le curseur est construit à partir des valeurs de tri de la dernière ligne, et cette ligne ne les contient pas. Dans ce cas, `meta.hasMore` peut valoir `true` sans aucun `nextCursor`, et la boucle ci-dessus s'arrête prématurément : ajoutez les champs de tri à `fields`, ou paginez par `offset`. L'appel à `iterate()` avec une option `cursor` refuse un tel listing avec l'erreur `cursor-missing` plutôt que de s'arrêter. Un tri par un [agrégat sur une relation](/docs/sdk/relations/) pagine bien par curseur.

Le curseur est **opaque**. Il encode les clés de tri *et* les valeurs correspondantes de la dernière ligne, de sorte qu'il ne peut que poursuivre la liste d'où il provient : conservez un `orderBy` identique sur toutes les pages, faute de quoi la requête sera refusée avec `CURSOR_ORDER_MISMATCH` plutôt que de chercher dans un ordre non demandé. Une requête qui ne spécifie aucun `orderBy` adopte celui du curseur, vous pouvez donc simplement le réinjecter sans redéfinir le tri.

Ne l'analysez pas et n'en construisez pas : l'encodage est sujet à modifications, et toute autre valeur produira une erreur `INVALID_CURSOR`.

Quatre conséquences découlent de la nature d'un curseur :

- **`after` ne peut pas être combiné avec `offset` ou `page`** (400 `CURSOR_WITH_OFFSET`). Les deux indiquent où la page commence, et respecter les deux entraînerait l'omission de lignes.
- **Les tris sur plusieurs clés et les clés pouvant être nulles fonctionnent tous les deux.** La comparaison est construite sur chaque clé dans l'ordre, avec le [positionnement des valeurs NULL](/docs/sdk/querying#where-nulls-sort) déclaré par le tri — et non pas un simple `>` sur une seule colonne.
- **La pertinence ne peut pas servir de curseur.** Un `_score` est calculé par requête et n'est stocké nulle part, et deux requêtes avec des chaînes de recherche différentes produisent des scores qui ne sont pas sur la même échelle. Un tel listing ne comporte tout simplement aucun `nextCursor` ; paginez-le avec `offset`. Il en va de même pour la distance d'une recherche vectorielle, et un curseur envoyé avec celle-ci est refusé avec `VECTOR_CURSOR_UNSUPPORTED`.
- **Une souscription ne peut pas reprendre à partir d'un curseur.** `listen()` réexécute sa requête à chaque écriture, et `after` désigne un emplacement dans une exécution donnée ; par conséquent, `listen({ after })` est refusé avec `CURSOR_NOT_LIVE` avant même tout envoi. Utilisez `offset` ou `page` pour une fenêtre dynamique en temps réel, ou `find({ after })` pour lire la page une seule fois.

Sur HTTP, il s'agit d'un seul paramètre :

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

#### Ignorer le comptage

`meta.total` est un `COUNT(*)` sur chaque ligne correspondant à la requête, exécuté parallèlement à la page — et sur une grande table, son coût dépasse celui de la page. Une lecture qui ne fait que paginer vers l'avant n'en a jamais besoin, car `meta.hasMore` n'en dépend pas : passez `count: "none"` et la lecture demandera plutôt une ligne de plus au-delà de la page.

```typescript
const { data, meta } = await client.data.orders.find({ limit: 100, count: "none" });
meta.hasMore; // exact
```

Sans comptage, il n'y a aucun total à rapporter : sur HTTP, `meta.total` est absent, et en interne, il correspond aux lignes jusqu'à la fin de la page (`offset` plus la page). Sur HTTP, il s'agit de `?count=none` ; `?count=exact` est la valeur par défaut, et toute autre valeur renvoie un code 400 `INVALID_COUNT`. `iterate()` et `findAll()` l'envoient automatiquement sur chaque page, car un parcours ne renvoie aucun total.

#### Quelles lectures sont encapsulées, et lesquelles ne le sont pas

Deux formats, et une seule règle : **une fenêtre est encapsulée, une réponse complète ne l'est pas.**

| Méthode | Retourne | Pourquoi |
|--------|---------|-----|
| `find()`, `listen()` | `{ data, meta }` | Une seule page. `meta.total` / `meta.hasMore` sont le seul moyen de savoir s'il y a une suite |
| `findAll()`, `createMany()`, `updateMany()` | `M[]` | Rien d'autre à rapporter — le parcours est terminé, ou le lot *est* l'ensemble des lignes |
| `iterate()` | une ligne à la fois | Rien n'est matérialisé en mémoire |
| `findById()`, `get()`, `create()`, `update()` | une seule ligne | Pas une liste |

`data` n'est pas une enveloppe que le SDK ajoute parfois et oublie d'autres fois. C'est l'endroit où résident les métadonnées de pagination, et elle est présente précisément lorsqu'il y en a.

#### Tout lire : `iterate()` et `findAll()`

`iterate()` diffuse chaque ligne correspondant à une requête, une à une, en récupérant une page à la fois en coulisses. Rien ne s'accumule, c'est donc la méthode à privilégier pour une table qui ne tient pas en mémoire :

```typescript
for await (const order of client.data.orders.iterate({
    where: { status: ["==", "pending"] }
})) {
    await handleOrder(order);
}
```

`findAll()` est le même parcours collecté dans un tableau :

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
```

Les deux sont également disponibles sur le fluent builder, où `.limit()` devient la **taille de page** plutôt qu'un total :

```typescript
const rows = await client.data.orders
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(500)          // rows per request
    .findAll();
```

Quatre options permettent de configurer le parcours :

| Option | Par défaut | Ce que cela fait |
|--------|---------|--------------|
| `pageSize` | 200 | Lignes par requête. |
| `cursor` | — | Exiger la recherche par curseur : lève une exception au lieu de se rabattre sur l'offset. Voir ci-dessous. |
| `maxPages` | 10 000 | Plafond de requêtes, pour éviter qu'un serveur qui renvoie indéfiniment `hasMore` ne tourne en boucle infinie. |
| `maxRows` | 10 000 | `findAll()` uniquement. Dépasser cette limite **lève une exception** au lieu de renvoyer un tableau tronqué comme s'il s'agissait du résultat complet. Passez `Infinity` pour désactiver cette limite, ou utilisez `iterate()`. |

**Le parcours se positionne automatiquement.** Après la première page, il renvoie [le curseur du serveur](#pagination-par-curseur) — `meta.nextCursor` — dans le paramètre `after`, de sorte que chaque requête demande les lignes situées strictement après la dernière ligne observée. Des écritures simultanées avant cette ligne ne peuvent pas décaler la fenêtre, et la base de données n'a jamais besoin de sauter des lignes par décompte, ce qui ralentissait les longs parcours par offset : chaque page coûtait plus cher que la précédente.

Lorsque le serveur ne fournit aucun curseur — recherche ordonnée par pertinence, recherche vectorielle, lecture `distinct`, projection `fields` omettant un champ de tri — le parcours pagine par offset à la place, et une ligne insérée ou supprimée *pendant l'exécution du parcours* peut entraîner le saut ou la répétition d'une ligne. Passez `cursor` pour faire du positionnement par curseur une exigence plutôt qu'une préférence :

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

`cursor` indique la colonne selon laquelle trier lorsque la requête ne la spécifie pas déjà, et transforme le repli sur l'offset en une erreur. Le parcours ne construit aucune comparaison qui lui soit propre, c'est pourquoi un tri sur plusieurs clés fonctionne —

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

— et c'est aussi pourquoi une clé de tri pouvant être nulle fonctionne.

Le tri doit tout de même être **total**, ce qui signifie en pratique unique : l'identifiant de ligne départage en dernier recours, donc toute colonne peut servir à départager. Avec `cursor`, un parcours dont le curseur cesse d'avancer lève l'erreur `cursor-stalled` plutôt que de boucler indéfiniment, et une requête qu'aucun curseur ne peut décrire (pertinence) lève `cursor-missing` ; retirez `cursor` et le parcours paginera ces requêtes par offset.

## Voir aussi

- [Interroger les données](/docs/sdk/querying/) — filtres, fluent builder, tri.
- [Agrégats et recherche](/docs/sdk/aggregates-and-search/) — pourquoi la pertinence ne peut pas servir de clé de curseur.
