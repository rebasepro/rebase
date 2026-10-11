---
sourceHash: a03adef95cbad36c
title: Pagination
sidebar_label: Pagination
description: Parcourir une collection par pagination limit/offset, numéros de page ou curseur keyset — et quand chacune cesse d'être exacte.
---

Trois façons de parcourir une collection : un offset, un numéro de page et un curseur. Les
deux premières sont positionnelles et la troisième ne l'est pas, ce qui fait toute la différence —
une page positionnelle relit en comptant depuis le début, de sorte que les lignes écrites pendant
que vous paginez décalent ce que signifie « ligne 20 ».

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

`limit` doit être un nombre entier compris entre 1 et 1000. Une valeur plus grande —
ou égale à zéro, négative ou fractionnaire — est rejetée avec une erreur 400 `INVALID_LIMIT` plutôt
que tronquée (clamped), car une page silencieusement plus petite ne peut être distinguée de la dernière page.
Pour lire au-delà de ce plafond, parcourez les pages avec `iterate()` ou `findAll()`.

#### Pagination par curseur

Chaque réponse de liste comporte un `meta.nextCursor` tant qu'il existe une autre page.
Renvoyez-le sous la forme de `after` et la page suivante reprendra **strictement après la dernière ligne
servie**, plutôt qu'à un *nombre* de lignes que des écritures simultanées ont déjà
déplacé :

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

`nextCursor` est absent sur la dernière page, et sur une page qu'aucun curseur ne
peut décrire : une recherche triée par pertinence (`_score`), une recherche
vectorielle, et une projection `fields` qui omet un des champs de `orderBy` — le
curseur est construit à partir des valeurs de tri de la dernière ligne, et cette
ligne ne les porte pas. Là, `meta.hasMore` peut valoir `true` sans `nextCursor`,
et la boucle ci-dessus s'arrête prématurément : ajoutez les champs de tri à
`fields`, ou paginez par `offset`. `iterate()` appelé avec un `cursor` refuse un
tel listage avec `cursor-missing` plutôt que de s'arrêter. Un tri par un
[agrégat sur une relation](/docs/sdk/relations/) se pagine bien par curseur.

Le curseur est **opaque**. Il encode les clés de tri *et* les valeurs correspondantes de la dernière
ligne, de sorte qu'il ne peut que poursuivre la liste dont il provient : conservez un `orderBy`
identique d'une page à l'autre, sinon la requête est rejetée avec
`CURSOR_ORDER_MISMATCH` plutôt que d'effectuer une recherche dans un ordre que personne n'a demandé. Une
requête qui ne spécifie aucun `orderBy` adopte celui du curseur, vous pouvez donc le renvoyer
directement sans redéfinir le tri.

Ne l'analysez pas et n'en construisez pas : l'encodage est conçu pour pouvoir changer, et
toute autre valeur entraînera une erreur `INVALID_CURSOR`.

Quatre conséquences découlent de la nature d'un curseur :

- **`after` ne peut pas être combiné avec `offset` ou `page`** (400
  `CURSOR_WITH_OFFSET`). Les deux indiquent où commence la page, et respecter les deux
  entraînerait l'omission de lignes.
- **Les tris multi-clés et les clés pouvant être nulles fonctionnent tous les deux.** La comparaison est construite
  sur chaque clé dans l'ordre, avec le [positionnement des valeurs NULL](/docs/sdk/querying#where-nulls-sort) déclaré par le tri —
  et non un simple `>` sur une seule colonne.
- **La pertinence ne peut pas faire l'objet d'un curseur.** Un `_score` est calculé par requête et
  n'est stocké nulle part, et deux requêtes avec des chaînes de recherche différentes produisent des
  scores qui ne sont pas sur la même échelle. Une telle liste ne comporte tout simplement aucun
  `nextCursor` ; pagineza-la avec `offset`. Il en va de même de la distance d'une recherche
  vectorielle, et un curseur envoyé avec une telle recherche est refusé avec
  `VECTOR_CURSOR_UNSUPPORTED`.
- **Un abonnement ne peut pas reprendre à partir d'un curseur.** `listen()` réexécute sa requête à
  chaque écriture, et `after` désigne un point dans une seule de ces exécutions, donc
  `listen({ after })` est refusé avec `CURSOR_NOT_LIVE` avant tout envoi. Utilisez `offset` ou
  `page` pour une fenêtre en direct, ou `find({ after })` pour lire la page une fois.

En HTTP, il s'agit d'un paramètre unique :

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

#### Ignorer le comptage

<span class="since-badge" data-since="0.25">Depuis 0.25</span> `meta.total` est un `COUNT(*)` sur toutes les lignes correspondant à la requête, exécuté à côté de la
page — et sur une grande table, il coûte plus cher que la page elle-même. Une lecture qui ne fait
qu'avancer n'en a jamais besoin, car `meta.hasMore` n'en dépend pas : passez `count: "none"` et la lecture
demande à la place une ligne de plus que la page.

```typescript
const { data, meta } = await client.data.orders.find({ limit: 100, count: "none" });
meta.hasMore; // exact
```

Sans comptage, il n'y a pas de total à indiquer : en HTTP, `meta.total` est absent, et en processus il
s'agit des lignes jusqu'à la fin de la page (`offset` plus la page). En HTTP, c'est `?count=none` ;
`?count=exact` est la valeur par défaut, et toute autre valeur renvoie une erreur 400 `INVALID_COUNT`.
`iterate()` et `findAll()` l'envoient d'eux-mêmes à chaque page, puisqu'un parcours n'indique aucun total.

#### Quelles lectures sont enveloppées et lesquelles ne le sont pas

Deux formes, et une seule règle : **une fenêtre est enveloppée, une réponse complète ne l'est pas.**

| Méthode | Retourne | Pourquoi |
|--------|---------|-----|
| `find()`, `listen()` | `{ data, meta }` | Une page. `meta.total` / `meta.hasMore` sont le seul moyen de savoir s'il y en a d'autres |
| `findAll()`, `createMany()`, `updateMany()` | `M[]` | Rien d'autre à signaler — le parcours est terminé, ou le lot *constitue* les lignes |
| `iterate()` | une ligne à la fois | Rien n'est matérialisé du tout |
| `findById()`, `get()`, `create()`, `update()` | une ligne | Pas une liste |

`data` n'est pas une enveloppe (wrapper) que le SDK ajoute parfois et oublie parfois. C'est
là que résident les métadonnées de pagination, et elle est présente exactement quand il y en a.

#### Tout lire : `iterate()` et `findAll()`

`iterate()` diffuse chaque ligne correspondant à une requête, une à la fois, en récupérant une page à
la fois en coulisses. Rien ne s'accumule, c'est donc la méthode à privilégier pour
une collection qui ne peut pas tenir en mémoire :

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

Les deux sont également disponibles sur le fluent builder, où `.limit()` devient la **taille de page**
plutôt qu'un total :

```typescript
const rows = await client.data.orders
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(500)          // rows per request
    .findAll();
```

Quatre options définissent le parcours :

| Option | Par défaut | Description |
|--------|---------|--------------|
| `pageSize` | 200 | Nombre de lignes par requête. |
| `cursor` | — | Exiger la recherche par curseur : lever une erreur au lieu de se rabattre sur l'offset. Voir ci-dessous. |
| `maxPages` | 10 000 | Plafond de requêtes, pour éviter qu'un serveur qui répond indéfiniment `hasMore` ne tourne en boucle sans fin. |
| `maxRows` | 10 000 | `findAll()` uniquement. Tout dépassement **lève une exception** plutôt que de renvoyer un tableau tronqué comme s'il s'agissait de la réponse complète. Passez `Infinity` pour désactiver cette limite, ou utilisez `iterate()`. |

**Le parcours cherche par curseur de lui-même.** Après la première page, il renvoie
[le curseur du serveur](#pagination-par-curseur) — `meta.nextCursor` — sous forme de `after`,
de sorte que chaque requête demande les lignes strictement postérieures à la dernière vue. Les écritures
simultanées situées avant cette ligne ne peuvent pas décaler la fenêtre, et la base de données n'a jamais
à sauter des lignes par comptage, ce qui rendait lents les longs parcours par offset : chaque page coûtait
plus cher que la précédente.

Lorsque le serveur n'émet aucun curseur — une recherche triée par pertinence, une recherche vectorielle,
une lecture `distinct`, une projection `fields` qui omet un champ de tri — le parcours pagine par offset
à la place, et une ligne insérée ou supprimée *pendant l'exécution du parcours* peut lui faire sauter ou
répéter une ligne. Passez `cursor` pour faire de la recherche par curseur une exigence plutôt qu'une préférence :

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

`cursor` indique la colonne selon laquelle trier lorsque la requête ne le précise pas déjà, et transforme le
repli sur l'offset en erreur. Le parcours ne construit aucune comparaison propre, c'est pourquoi un tri
multi-clés fonctionne —

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

— et pourquoi une clé de tri pouvant être nulle fonctionne aussi.

Le tri doit tout de même être **total**, ce qui en pratique signifie unique : l'identifiant de ligne
départage en dernier recours, de sorte que n'importe quelle colonne peut servir à départager. Avec `cursor`, un
parcours dont le curseur cesse d'avancer lève une erreur `cursor-stalled` plutôt que de boucler indéfiniment,
et une requête qu'aucun curseur ne peut décrire (pertinence) lève une erreur `cursor-missing` ; supprimez
`cursor` et le parcours pagine celles-ci par offset.

## Voir aussi

- [Interroger les données](/docs/sdk/querying/) — filtres, fluent builder, tri.
- [Agrégats et recherche](/docs/sdk/aggregates-and-search/) — pourquoi la pertinence ne peut pas servir de clé de curseur.
