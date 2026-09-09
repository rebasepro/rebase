---
sourceHash: f040abfe0eee948c
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

Le curseur est **opaque**. Il encode les clés de tri *et* les valeurs correspondantes de la dernière
ligne, de sorte qu'il ne peut que poursuivre la liste dont il provient : conservez un `orderBy`
identique d'une page à l'autre, sinon la requête est rejetée avec
`CURSOR_ORDER_MISMATCH` plutôt que d'effectuer une recherche dans un ordre que personne n'a demandé. Une
requête qui ne spécifie aucun `orderBy` adopte celui du curseur, vous pouvez donc le renvoyer
directement sans redéfinir le tri.

Ne l'analysez pas et n'en construisez pas : l'encodage est conçu pour pouvoir changer, et
toute autre valeur entraînera une erreur `INVALID_CURSOR`.

Trois conséquences découlent de la nature d'un curseur :

- **`after` ne peut pas être combiné avec `offset` ou `page`** (400
  `CURSOR_WITH_OFFSET`). Les deux indiquent où commence la page, et respecter les deux
  entraînerait l'omission de lignes.
- **Les tris multi-clés et les clés pouvant être nulles fonctionnent tous les deux.** La comparaison est construite
  sur chaque clé dans l'ordre, avec le [positionnement des valeurs NULL](#where-nulls-sort) déclaré par le tri —
  et non un simple `>` sur une seule colonne.
- **La pertinence ne peut pas faire l'objet d'un curseur.** Un `_score` est calculé par requête et n'est stocké
  nulle part, et deux requêtes avec des chaînes de recherche différentes produisent des scores qui ne sont
  pas sur la même échelle. Une telle liste ne comporte tout simplement aucun `nextCursor` ; pagineza-la
  avec `offset`.

En HTTP, il s'agit d'un paramètre unique :

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

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

Trois options définissent le parcours :

| Option | Par défaut | Description |
|--------|---------|--------------|
| `pageSize` | 200 | Nombre de lignes par requête. |
| `cursor` | — | Recherche par curseur sur une colonne au lieu d'une pagination par offset. Voir ci-dessous. |
| `maxPages` | 10 000 | Plafond de requêtes, pour éviter qu'un serveur qui répond indéfiniment `hasMore` ne tourne en boucle sans fin. |
| `maxRows` | 10 000 | `findAll()` uniquement. Tout dépassement **lève une exception** plutôt que de renvoyer un tableau tronqué comme s'il s'agissait de la réponse complète. Passez `Infinity` pour désactiver cette limite, ou utilisez `iterate()`. |

**Privilégiez `cursor` dès que la collection possède une colonne unique et triable.**
La pagination par offset recompte les lignes à chaque requête, de sorte qu'une ligne insérée ou supprimée
*pendant l'exécution du parcours* décale la fenêtre et le parcours saute ou répète silencieusement
des lignes. La recherche par curseur demande les lignes strictement postérieures à la dernière vue, ce que
les écritures simultanées situées avant le curseur ne peuvent pas décaler :

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

`cursor` signifie ici « chercher par curseur plutôt que paginer par offset », et indique la colonne selon
laquelle trier lorsque la requête ne le précise pas déjà. La recherche elle-même correspond
[au curseur du serveur](#cursor-pagination) : le parcours renvoie `meta.nextCursor` sous forme
de `after` et ne construit aucune comparaison propre, c'est pourquoi un tri multi-clés
fonctionne —

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

— et pourquoi une clé de tri pouvant être nulle fonctionne aussi.

Le tri doit tout de même être **total**, ce qui en pratique signifie unique : l'identifiant de ligne
départage en dernier recours, de sorte que n'importe quelle colonne peut servir à départager, mais un parcours dont
le curseur cesse d'avancer lève une erreur `cursor-stalled` plutôt que de boucler indéfiniment. Une
requête qu'aucun curseur ne peut décrire (pertinence) lève une erreur `cursor-missing` ; supprimez `cursor`
et effectuez une pagination par offset.

## Voir aussi

- [Interroger les données](/docs/sdk/querying/) — filtres, fluent builder, tri.
- [Agrégats et recherche](/docs/sdk/aggregates-and-search/) — pourquoi la pertinence ne peut pas servir de clé de curseur.

---
