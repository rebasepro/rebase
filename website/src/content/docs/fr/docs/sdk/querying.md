---
sourceHash: 72b63305690d555c
title: Interroger les données
sidebar_label: Interroger les données
description: Opérations CRUD, constructeur de requêtes fluide, opérateurs de filtrage, tri, sélection de colonnes et agrégats avec le SDK Client Rebase.
---

## Accéder aux collections

Accédez à n'importe quelle collection via `client.data.<collectionName>` (camelCase, converti automatiquement en snake_case) ou `client.data.collection<Record<string, unknown>>("slug")` (slug explicite) :

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Mode strict (SDK généré) :** Lorsque vous passez le `collectionsDictionary` généré à `createRebaseClient`, le proxy de données valide les accès aux propriétés au moment de l'accès. Une faute de frappe comme `client.data.prodcuts` lèvera immédiatement une erreur claire accompagnée d'une suggestion de correspondance la plus proche, plutôt que de produire une erreur 404 déroutante plus tard. Utilisez `client.data.collection<Record<string, unknown>>("slug")` pour contourner la validation pour les slugs dynamiques ou déterminés au moment de l'exécution.

## Opérations CRUD

### Find (Lister)

```typescript
// All products (default limit: 50)
const { data, meta } = await client.data.products.find();

// With pagination, filtering, and sorting
const { data, meta } = await client.data.products.find({
    where: { active: ["==", true], price: [">=", 100] },
    orderBy: ["createdAt", "desc"],
    limit: 25,
    offset: 0
});

// data is Row[] — flat rows, with the id at the top level
// meta has { total, limit, offset, hasMore }
```

### Lire un élément par ID

Deux méthodes existent, car il y a deux situations qui appellent un code différent.

`get` est destiné à une ligne dont vous attendez l'existence — l'identifiant provient d'un lien, d'un paramètre de route ou d'une autre ligne. Il renvoie directement la ligne, évitant ainsi d'avoir à affiner le type en aval, et une ligne manquante déclenche une exception sur laquelle vous pouvez brancher votre logique :

```typescript
const product = await client.data.products.get(42);
product.name;    // Row, not Row | undefined
```

```typescript
import { RebaseApiError } from "@rebasepro/client";

async function loadProduct(id: string) {
    try {
        return await client.data.products.get(id);
    } catch (e) {
        if (e instanceof RebaseApiError && e.code === "NOT_FOUND") return null;
        throw e;
    }
}
```

`findById` est conçu pour une ligne qui peut légitimement ne pas exister — une recherche basée sur un identifiant saisi par un utilisateur, une vérification dans un cache :

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
La sécurité au niveau des lignes (Row-level security) fait délibérément en sorte que « cette ligne n'existe pas » et « vous n'avez pas l'autorisation de la lire » renvoient la même réponse : un code 404 qui ferait la distinction confirmerait que la ligne existe.
:::

### Écriture

`create`, `upsert`, `update`, `delete` et leurs variantes par lot sont décrits dans **[Écrire des données](/docs/sdk/writing/)**, avec les opérations sur les champs, les écritures conditionnelles et les clés d'idempotence.

### Count (Compter)

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Constructeur de requêtes fluide (Fluent Query Builder)

Enchaînez les méthodes pour construire des requêtes plus expressives :

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();
```

### Méthodes disponibles

| Méthode | Description | Exemple |
|--------|-------------|---------|
| `.where(field, op, value)` | Ajouter une condition de filtre | `.where("age", ">=", 18)` |
| `.where(path, op, value)` | Filtrer sur le chemin d'une [relation](#querying-through-a-relation) ou d'un [JSON](#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Ajouter un [groupe OR/AND](#logical-conditions-or--and) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Trier les résultats | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Trier selon un [agrégat sur une relation](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limiter le nombre de résultats | `.limit(25)` |
| `.offset(n)` | Ignorer les N premiers résultats | `.offset(50)` |
| `.after(cursor)` | Poursuivre après un [curseur](#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Retourner [uniquement ces colonnes](#returning-fewer-columns) | `.fields("id", "title")` |
| `.distinct()` | Fusionner les lignes identiques sur ces colonnes | `.fields("status").distinct()` |
| `.search(text)` | Recherche textuelle — voir [Recherche](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Recherche des plus proches voisins sur une propriété `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Charger les lignes associées](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Exécuter la requête | Renvoie `FindResult<M>` |
| `.aggregate(params)` | [Réduire au lieu de renvoyer des lignes](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Diffuser chaque ligne correspondante](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Récupérer toutes les lignes correspondantes](#reading-everything-iterate-and-findall) | Renvoie `M[]` |
| `.count()` | Compter les lignes correspondantes | Renvoie `number` |
| `.listen(onUpdate, onError?)` | S'abonner aux mises à jour en temps réel | Renvoie `unsubscribe()` |

### Opérateurs de filtrage

| Opérateur | Alias | Description |
|----------|-------|-------------|
| `"=="` | `"eq"` | Égal |
| `"!="` | `"neq"` | Différent de |
| `">"` | `"gt"` | Supérieur à |
| `">="` | `"gte"` | Supérieur ou égal à |
| `"<"` | `"lt"` | Inférieur à |
| `"<="` | `"lte"` | Inférieur ou égal à |
| `"in"` | | Valeur présente dans le tableau |
| `"not-in"` | `"nin"` | Valeur absente du tableau |
| `"array-contains"` | `"cs"` | Le champ tableau contient la valeur |
| `"array-contains-any"` | `"csa"` | Le champ tableau contient au moins une des valeurs |
| `"like"` | `"like"` | Correspondance de motif **sensible à la casse** ; `%` et `_` sont les caractères génériques |
| `"ilike"` | `"ilike"` | Correspondance de motif insensible à la casse |
| `"not-like"` | `"nlike"` | Ne correspond pas au motif |
| `"not-ilike"` | `"nilike"` | Ne correspond pas au motif, de manière insensible à la casse |
| `"is-null"` | `"isnull"` | La colonne est `NULL`. Ne prend aucune valeur — toute valeur fournie est ignorée |
| `"is-not-null"` | `"notnull"` | La colonne n'est pas `NULL`. Ne prend aucune valeur |

La colonne alias correspond à la notation **réseau** (wire), utilisée dans les chaînes de requête REST. Elle n'apparaît jamais dans le code applicatif : le SDK et le panneau d'administration utilisent tous deux l'opérateur canonique de gauche.

### Syntaxes de la clause Where

Le paramètre `where` dans `find()` prend en charge deux formats :

```typescript no-verify
// 1. Tuple syntax — [operator, value] (recommended)
await client.data.products.find({
    where: {
        status: ["==", "active"],
        featured: ["==", true],
        price: [">=", 100],
        category: ["in", ["electronics", "gadgets"]],
        deleted_at: ["!=", null]
    }
});

// 2. Pre-serialized PostgREST string syntax (advanced)
await client.data.products.find({
    where: { status: "eq.published", price: "gte.100" }
});
```

> **Remarque :** Les chaînes PostgREST pré-sérialisées (format 2) constituent une solution de secours pour transmettre des valeurs de filtre déjà au format réseau. Privilégiez la syntaxe par tuples pour la sécurité du typage et la lisibilité.

## Conditions logiques (OR / AND / NOT)

Chaque champ dans `where` est combiné avec un AND. Pour relier des conditions avec un OR, ou pour nier un groupe, construisez une **condition logique** à l'aide des fonctions utilitaires `or`, `and`, `not` et `cond` exportées par le SDK :

```typescript
import { or, and, not, cond } from "@rebasepro/client";

const { data } = await client.data.products.find({
    logical: or(
        cond("status", "==", "active"),
        and(
            cond("status", "==", "draft"),
            cond("authorId", "==", currentUserId)
        )
    )
});
```

Le constructeur fluide accepte la même arborescence :

```typescript
const { data } = await client.data.products
    .where(or(cond("status", "==", "active"), cond("featured", "==", true)))
    .orderBy("createdAt", "desc")
    .find();
```

`cond` prend l'opérateur canonique — la colonne de gauche du tableau des [Opérateurs de filtrage](#filter-operators). Un opérateur absent du dialecte lèvera une erreur `TypeError` lors de la sérialisation de la requête, plutôt que de produire silencieusement une requête différente.

### Négation

`not` inverse la **conjonction** de ses conditions : `not(a)` équivaut à `NOT a`, et `not(a, b)` à `NOT (a AND b)`. Les groupes peuvent s'imbriquer, de sorte que l'autre loi de De Morgan s'écrit `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

L'instruction est compilée en un véritable `NOT (...)` SQL, et non en des opérateurs inversés. Cette distinction n'est pas d'ordre purement cosmétique : SQL utilise une logique à trois valeurs, de sorte que `NOT (a AND b)` et `(NOT a) OR (NOT b)` cessent d'être équivalents dès qu'une valeur `NULL` entre en jeu, et seul l'un d'entre eux correspond à la requête que vous avez formulée.

Cela signifie également qu'une négation **inclut les lignes dont la colonne est NULL** — `not(cond("status", "==", "draft"))` renvoie les lignes sans aucun statut. C'est ce que signifie `NOT`, et généralement ce qui est souhaité ; si ce n'est pas le cas, ajoutez une condition `is-not-null` avec un AND.

### Composition avec le reste de la requête

`where`, `logical` et `search` sont trois groupes indépendants, combinés entre eux avec un AND :

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Il n'est pas possible d'appliquer un OR entre `where` et `logical`. Tout ce qui ne constitue pas un simple AND entre ces trois éléments doit être formulé à l'intérieur d'un même arbre `logical` — déplacez-y les champs qui doivent être combinés par un OR.

### Au niveau du réseau

Un groupe logique transite sous la forme d'un unique paramètre de requête `or=`, `and=` ou `not=`, selon la même syntaxe à points que celle utilisée par les filtres de champs :

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Un seul des trois s'applique par requête — `or` l'emporte sur `and`, et tous deux sur `not`. Imbriquez un groupe dans un autre pour les combiner.

Trois encodages méritent d'être connus, car ils sont souvent source d'erreurs lors de l'écriture manuelle d'une chaîne de requête :

| Condition | Forme réseau | Remarque |
|-----------|-----------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` recherche la chaîne de quatre caractères `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` est une liste contenant une chaîne vide, ce qui correspond à une requête différente |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | un [chemin de relation](#querying-through-a-relation) conserve son point |

Les virgules, parenthèses et barres obliques inverses au sein d'une valeur sont échappées avec un antislash, de sorte que `cond("name", "==", "Doe, John")` transite sous la forme `name.eq.Doe\, John` et ne sépare pas le groupe.

Les groupes peuvent être imbriqués jusqu'à 32 niveaux de profondeur. Au-delà, la requête est rejetée avec l'erreur `INVALID_LOGICAL_GROUP` — aplatissez-la, puisque `or(a,or(b,c))` équivaut à `or(a,b,c)`.

## Pagination

Les décalages (offsets), les numéros de page et les curseurs de clés (keyset cursors) font l'objet d'une page dédiée : [Pagination](/docs/sdk/pagination/).

## Tri

```typescript
// Sort by field (format: ["field", "direction"])
const { data } = await client.data.products.find({
    orderBy: ["createdAt", "desc"]
});

// Fluent style
const { data } = await client.data.products
    .orderBy("price", "asc")
    .find();
```

Une direction omise prend par défaut la valeur `"asc"` — ce qui équivaut à `?orderBy=name` en HTTP, quelle que soit la base de données sous-jacente.

### Trier sur plusieurs colonnes

Un tri est une *liste* de clés. La deuxième départage les lignes que la première considère égales, la troisième départage celles que les deux premières considèrent égales — `orderBy` accepte donc aussi bien une liste de paires `[champ, direction]` qu'une paire unique :

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

Le constructeur fluide permet d'obtenir le même résultat en appelant à nouveau `.orderBy()`. Chaque appel **ajoute** une clé à la suite des précédentes plutôt que de les remplacer :

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Chaque tri se termine par l'id de la ligne, par ordre décroissant, que vous l'ayez demandé ou non. C'est ce qui rend l'ordre *total* : sans cela, deux lignes partageant une même valeur sont renvoyées dans l'ordre choisi par la base de données, et paginer sur un ordre susceptible de varier d'une exécution à l'autre d'une même requête répète certaines lignes et en ignore d'autres.

Un tri multicolonne se pagine sans problème avec un [curseur](#cursor-pagination) : la comparaison est établie sur chaque clé, dans l'ordre. Le seul ordre qu'un curseur ne peut pas décrire est **`_score`** — voir [Recherche](/docs/backend/search). La pertinence étant calculée par requête plutôt que stockée, il n'existe aucune valeur sur la ligne du curseur à laquelle comparer la page suivante, et une telle liste ne comporte pas de `nextCursor`.

### Position des valeurs NULL dans le tri

Par défaut, les valeurs NULL sont triées **en dernier par ordre croissant et en premier par ordre décroissant** — selon la convention propre à Postgres. C'est cette valeur par défaut qui place chaque ligne sans date tout en haut d'une liste triée « du plus récent au plus ancien », devant toutes les lignes réelles, et la seule issue consistait auparavant à appliquer un filtre `is-not-null` pour exclure entièrement ces lignes.

Un troisième élément sur la clé permet d'indiquer où les placer à la place :

```typescript
// Newest first, and the ones with no date at the end where they belong.
const { data } = await client.data.posts.find({
    orderBy: [["publishedAt", "desc", "last"]]
});
```

```typescript
const { data } = await client.data.posts
    .orderBy("publishedAt", "desc", "last")
    .find();
```

En HTTP, cela correspond à un troisième segment séparé par deux-points, `?orderBy=publishedAt:desc:last`, ou à une clé `"nulls"` dans la structure de tableau JSON. Toute valeur autre que `first`/`last` déclenche une erreur 400 plutôt que d'appliquer un ordre silencieusement différent.

Le [curseur](#cursor-pagination) respecte la position déclarée pour le tri, de sorte que la pagination sur une clé nullable reste correcte quelle que soit l'option choisie.

## Restreindre les colonnes retournées

`fields` restreint la lecture aux colonnes indiquées. Il s'agit d'une projection effectuée au niveau de la base de données — ce sont les colonnes *lues*, et non pas celles conservées après découpage de la réponse — de sorte qu'une requête ne requérant que deux champs d'une ligne large ne paie pas le coût de lecture du reste :

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Deux principes s'appliquent toujours, quelles que soient les colonnes spécifiées :

- **La clé primaire est toujours retournée.** Une ligne qui ne peut pas être ciblée ne peut être ni modifiée, ni supprimée, ni dépassée par pagination — et `meta.nextCursor` en dérive, si bien qu'une projection sans elle désactiverait silencieusement la navigation par curseur.
- **Les colonnes `excludeFromApi` restent masquées.** Spécifier leur nom ne permet pas de les afficher.

Une colonne inconnue génère une erreur 400 `UNKNOWN_FIELD`. Si elle était interprétée comme « omettre ce champ », une faute de frappe telle que `fields: ["titel"]` renverrait des lignes sans titre et sans fournir la moindre explication.

Une relation spécifiée dans `include` est chargée, qu'elle apparaisse ou non dans `fields` ; pour restreindre les colonnes *à l'intérieur* d'une relation, consultez les [options par relation](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

<span class="since-badge" data-since="0.20">Depuis 0.20</span>

`distinct` fusionne les lignes identiques sur les colonnes retournées, et une lecture distincte renvoie **uniquement** les colonnes que vous indiquez — la clé primaire est exclue de la projection, à l'inverse de toutes les autres lectures. Cela est nécessaire : une clé de substitution (surrogate key) diffère sur chaque ligne, la conserver rendrait donc chaque ligne unique par construction et la requête renverrait un code 200 sans avoir rien fait.

Cette opération n'a donc de sens qu'en combinaison avec `fields`. Sans cela, vous demandez toutes les colonnes visibles, clé comprise, et aucune ligne n'est fusionnée :

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Une lecture distincte ne cible aucune ligne en particulier — il n'y a pas de clé pour les désigner — elle renvoie donc un ensemble de valeurs plutôt qu'un ensemble de lignes à modifier ou supprimer, et elle ne fournit aucun `nextCursor`. De plus, elle ne rapporte **aucun `meta.total`** : un décompte exigerait un `COUNT(DISTINCT …)` que le pilote n'exécute pas, et indiquer le nombre total de lignes décrirait un ensemble différent de celui servi — un résultat complet de deux lignes renvoyé sous la forme `total: 8, hasMore: true` amènerait le client à paginer indéfiniment. La valeur `hasMore` est déterminée à partir de la page elle-même.

Deux combinaisons sont refusées plutôt que de renvoyer un résultat sans utilité :

- **Une requête qui calcule un score pour chaque ligne** — un appel classé à `search()` ou à `vectorSearch()` attribue un `_score`/`_distance` par ligne, de sorte que deux lignes ne sont jamais égales et que `DISTINCT` n'aurait aucun effet. (Une recherche de sous-chaîne standard n'associe aucun score et fonctionne parfaitement.)
- **Trier selon une colonne qui n'est pas retournée.** Postgres ne peut pas ordonner une lecture `DISTINCT` selon une expression extérieure à la liste de sélection ; la requête génère une erreur 400 `DISTINCT_ORDER_BY_NOT_SELECTED` au lieu d'une erreur 500 citant du code SQL que vous n'avez jamais écrit.

En HTTP : `?fields=status&distinct=true`.

## Agrégats

`aggregate()` effectue une réduction des lignes correspondantes au lieu de les renvoyer — `count`, `sum`, `avg`, `min`, `max`, avec regroupement facultatif :

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

Les filtres du constructeur s'y appliquent, ce qui constitue généralement la syntaxe la plus concise :

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Les clés des résultats sont **dérivées** et non choisies : `sum(total)` renvoie `sum_total`, un simple `count()` renvoie `count`. Vous permettre de les nommer impliquerait de vérifier que le nom choisi n'est pas également un champ présent dans `groupBy` — une règle difficilement prévisible, avec le risque d'écraser silencieusement une valeur si elle n'était pas vérifiée.

`limit` borne le nombre de **groupes** (un regroupement sur une colonne à forte cardinalité peut représenter l'équivalent d'une table entière dans une seule réponse) et est ignoré sans `groupBy`, puisqu'un agrégat non groupé correspond à une seule ligne. `orderBy`, `include` et la pagination ne s'appliquent pas : un agrégat ne comporte aucune ligne à trier, aucune relation à charger et aucune page à poursuivre.

L'objectif essentiel est de ne pas rapatrier des lignes dans le seul but de les réduire côté client. Obtenir les « revenus par statut » sur un million de commandes correspond ici à une seule requête et une ligne par statut, contre un `findAll()` suivi d'une boucle partout ailleurs — ce qui est incorrect avec un `limit` et trop lourd sans lui. Cette opération s'exécute via le même handle lié à la requête que toutes les autres lectures, de sorte que la sécurité au niveau des lignes s'applique aux lignes agrégées.

En HTTP : `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

Le filtrage JSON, la recherche en texte intégral et la recherche vectorielle font l'objet d'une page dédiée : [Agrégats et recherche](/docs/sdk/aggregates-and-search/).

La lecture des entités associées — `include`, et les accesseurs exécutant des requêtes via une relation — fait l'objet d'une page dédiée : [Interroger les relations](/docs/sdk/relations/).

## Endpoints personnalisés

Appelez des endpoints serveur personnalisés déclarés via le système de fonctions :

```typescript
// Using client.functions.invoke()
const result = await client.functions.invoke<{ summary: string }>(
    "generate-summary",
    { articleId: 42 }
);

// With options
const result = await client.functions.invoke<{ status: string }>(
    "process-order",
    { orderId: 123 },
    { method: "POST", path: "status/check" }
);

// Shorthand via client.call()
const result = await client.call<{ summary: string }>(
    "functions/generate-summary",
    { articleId: 42 }
);
```

Les deux méthodes renvoient **le corps de réponse de la fonction, tel quel**. Aucune des deux ne cherche à extraire une clé `data` interne ; ainsi, une fonction renvoyant `{ data: [...] }` vous transmet cet objet tel quel et il vous appartient de lire `.data`.

`call()` attend un chemin complet et utilise systématiquement la méthode POST ; `invoke()` prend un nom de fonction et peut recevoir une méthode, un sous-chemin ainsi que des en-têtes. Utilisez `invoke()` sauf si votre appel s'adresse à un élément qui n'est pas une fonction.

## Prochaines étapes

- **[Authentification](/docs/sdk/authentication)** — Connexion, inscription, OAuth, sessions
- **[Abonnements en temps réel](/docs/sdk/realtime)** — Données en direct via WebSockets
- **[Stockage et fichiers](/docs/sdk/storage)** — Téléversement, téléchargement et gestion de fichiers
- **[Relations](/docs/collections/relations)** — Définir des relations entre collections

---
