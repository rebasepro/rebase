---
sourceHash: 45064786f1785a65
title: Interroger les données
sidebar_label: Interroger les données
description: Opérations CRUD, query builder fluide, opérateurs de filtrage, tri, sélection de colonnes et agrégats avec le SDK typé Rebase.
---

## Accéder aux tables

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Accédez à n'importe quelle table via `client.data.<tableName>` (en camelCase, automatiquement converti en snake_case) ou `client.data.table<Record<string, unknown>>("slug")` (slug explicite) :

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.table<Record<string, unknown>>("blog_posts")
```

> **Mode strict (SDK généré) :** Lorsque vous transmettez le `tablesDictionary` généré à `createRebaseClient` en tant que `tables`, le proxy de données valide les accès aux propriétés au moment de l'accès. Une faute de frappe comme `client.data.prodcuts` lève immédiatement l'erreur `UNKNOWN_TABLE` avec une suggestion de correspondance la plus proche au lieu de produire une erreur 404 déroutante plus tard. Utilisez `client.data.table<Record<string, unknown>>("slug")` pour contourner la validation pour les slugs dynamiques ou déterminés au moment de l'exécution.

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

### Lire un enregistrement par ID

Deux méthodes existent, car il y a deux situations qui appellent un code différent.

`get` est destiné à une ligne dont vous attendez l'existence — l'ID provient d'un lien, d'un paramètre de route ou d'une autre ligne. Il renvoie la ligne, de sorte que rien en aval n'a besoin d'affiner le type, et une ligne manquante est une exception sur laquelle vous pouvez brancher votre logique :

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

`findById` est destiné à une ligne qui peut légitimement ne pas exister — une recherche par un ID saisi par un utilisateur, une vérification de cache :

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

`findById` prend les relations à charger, tout comme `find` :
`findById(1, { include: ["tags"] })`.

:::note
La sécurité au niveau des lignes (Row-level security) fait que « aucune ligne de ce type » et « pas le droit de lecture » produisent délibérément la même réponse : un code 404 qui les distinguerait confirmerait que la ligne existe.
:::

### Écriture

`create`, `upsert`, `update`, `delete` et leurs variantes par lot se trouvent sur **[Écrire des données](/docs/sdk/writing/)**, ainsi que les opérations sur les champs, les écritures conditionnelles et les clés d'idempotence.

### Count (Compter)

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Query Builder fluide

Enchaînez les méthodes pour des requêtes plus expressives :

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
| `.where(path, op, value)` | Filtrer sur un chemin de [relation](/docs/sdk/relations#querying-through-a-relation) ou [JSON](/docs/sdk/aggregates-and-search#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Ajouter un [groupe OR/AND](#conditions-logiques-or--and--not) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Trier les résultats | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Trier par un [agrégat sur une relation](/docs/sdk/relations#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limiter le nombre de résultats | `.limit(25)` |
| `.offset(n)` | Ignorer les N premiers résultats | `.offset(50)` |
| `.after(cursor)` | Continuer après un [curseur](/docs/sdk/pagination#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Retourner [uniquement ces colonnes](#retourner-moins-de-colonnes) | `.fields("id", "title")` |
| `.distinct()` | Fusionner les lignes identiques sur ces colonnes | `.fields("status").distinct()` |
| `.search(text)` | Recherche textuelle — voir [Recherche](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Recherche des plus proches voisins sur une propriété `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Charger les lignes associées](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Exécuter la requête | Retourne `FindResult<M>` |
| `.aggregate(params)` | [Réduire au lieu de renvoyer des lignes](#agrégats) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Diffuser en continu chaque ligne correspondante](/docs/sdk/pagination#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Collecter chaque ligne correspondante](/docs/sdk/pagination#reading-everything-iterate-and-findall) | Retourne `M[]` |
| `.count()` | Compter les lignes correspondantes | Retourne `number` |
| `.listen(onUpdate, onError?)` | S'abonner aux mises à jour en temps réel | Retourne `unsubscribe()` |

### Opérateurs de filtrage

| Opérateur | Alias | Description |
|-----------|-------|-------------|
| `"=="` | `"eq"` | Égal |
| `"!="` | `"neq"` | Non égal |
| `">"` | `"gt"` | Supérieur à |
| `">="` | `"gte"` | Supérieur ou égal à |
| `"<"` | `"lt"` | Inférieur à |
| `"<="` | `"lte"` | Inférieur ou égal à |
| `"in"` | | Valeur présente dans le tableau |
| `"not-in"` | `"nin"` | Valeur absente du tableau |
| `"array-contains"` | `"cs"` | Le champ tableau contient la valeur |
| `"array-contains-any"` | `"csa"` | Le champ tableau contient l'une des valeurs |
| `"array-contains-all"` | `"csall"` | Le champ tableau contient chacune des valeurs |
| `"array-contained-by"` | `"cd"` | Le champ tableau ne contient rien d'autre que les valeurs (tableau vide inclus) |
| `"like"` | `"like"` | Correspondance de motif **sensible à la casse** ; `%` et `_` sont les caractères génériques |
| `"ilike"` | `"ilike"` | Correspondance de motif insensible à la casse |
| `"not-like"` | `"nlike"` | Ne correspond pas au motif |
| `"not-ilike"` | `"nilike"` | Ne correspond pas au motif, insensible à la casse |
| `"is-null"` | `"isnull"` | La colonne est `NULL`. Ne prend aucune valeur — ce que vous passez est normalisé et ignoré |
| `"is-not-null"` | `"notnull"` | La colonne n'est pas `NULL`. Ne prend aucune valeur |

La colonne alias correspond à la notation **réseau** (wire), utilisée dans les chaînes de requête REST. Elle n'apparaît jamais dans le code applicatif : le SDK et le panneau d'administration utilisent tous deux l'opérateur canonique situé à gauche.

Les quatre opérateurs de tableau fonctionnent sur les colonnes de tableau natives (`text[]`, `integer[]`, …) et sur les tableaux JSONB, et un index GIN sur la colonne les prend tous en charge. Pour lister les éléments distincts d'une colonne de tableau, groupez un agrégat par `unnest(<field>)` (voir [Agrégats](/docs/sdk/aggregates-and-search/#grouping-by-an-expression)).

Les quatre opérateurs de motif comparent du texte. Un champ `enum` est comparé par sa valeur, donc `{ status: ["like", "draft%"] }` fonctionne sur un statut stocké sous forme d'enum Postgres. Sur un nombre, une date ou tout autre champ qui n'est pas du texte, ils sont rejetés avec une erreur 400 `INVALID_FILTER_OPERATOR`.

### Ignorer la casse : `lower(field)`

Une clé de filtre peut convertir un champ texte dans une casse spécifique — `lower(artist)` ou `upper(code)` — et chaque opérateur compare ensuite la valeur convertie ; écrivez donc les valeurs dans cette même casse :

```typescript
await client.data.songs.find({
    where: { "lower(artist)": ["in", ["abba", "queen"]] }
});
```

Cela compile en `lower(artist) = ANY($1)` : une seule liste liée de n'importe quelle longueur, prise en charge par un index sur `lower(artist)`. Sur HTTP, la clé s'écrit de la même manière : `?lower(artist)=in.(abba,queen)`.

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

> **Remarque :** Les chaînes PostgREST pré-sérialisées (format 2) sont une solution de secours pour transmettre des valeurs de filtre qui sont déjà au format réseau. Privilégiez la syntaxe par tuple pour la sécurité du typage et la lisibilité.

## Conditions logiques (OR / AND / NOT)

Chaque champ dans `where` est combiné avec un AND. Pour relier des conditions par un OR, ou pour inverser un groupe, construisez une **condition logique** à l'aide des helpers `or`, `and`, `not` et `cond` exportés par le SDK :

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

Le query builder fluide accepte la même arborescence :

```typescript
const { data } = await client.data.products
    .where(or(cond("status", "==", "active"), cond("featured", "==", true)))
    .orderBy("createdAt", "desc")
    .find();
```

`cond` prend l'opérateur canonique — la colonne de gauche du tableau des [Opérateurs de filtrage](#opérateurs-de-filtrage). Un opérateur non pris en charge par le dialecte produit une `TypeError` lors de la sérialisation de la requête, et non une requête silencieusement différente.

Sur un client avec des [types générés](/docs/sdk#typed-sdk-generation), `logical` et `.where(group)` vérifient chaque condition de l'arborescence par rapport à la ligne, tout comme le fait `where` : une colonne inexistante sur la ligne, ou une valeur du mauvais type pour l'opérateur (`cond("views", "==", "many")` sur une colonne numérique), génère une erreur de compilation. Un chemin de relation ou JSON (`author.name`, `metadata->>tier`) n'est pas vérifié.

### Négation

`not` inverse la **conjonction** de ses conditions : `not(a)` équivaut à `NOT a`, et `not(a, b)` à `NOT (a AND b)`. Les groupes s'imbriquent, donc l'autre loi de De Morgan s'écrit `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Cela compile en un véritable `NOT (...)` SQL, et non en des opérateurs inversés. Cette distinction n'est pas simplement cosmétique : SQL utilise une logique à trois valeurs, de sorte que `NOT (a AND b)` et `(NOT a) OR (NOT b)` cessent d'être équivalents dès qu'un `NULL` intervient, et un seul des deux correspond à la requête que vous avez écrite.

Cela signifie également qu'une négation **inclut les lignes dont la colonne est NULL** — `not(cond("status", "==", "draft"))` renvoie les lignes sans aucun statut. C'est ce que signifie `NOT`, et c'est généralement ce que l'on souhaite ; si ce n'est pas le cas, ajoutez un `is-not-null` avec un AND à ses côtés.

### Composition avec le reste de la requête

`where`, `logical` et `search` sont trois groupes indépendants, combinés entre eux par un AND :

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Il n'y a aucun moyen d'appliquer un OR entre `where` et `logical`. Tout ce qui n'est pas un simple AND des trois doit être exprimé au sein d'une seule arborescence `logical` — déplacez les champs que vous devez relier par un OR à l'intérieur de celle-ci.

### Sur le réseau

Un groupe logique transite sous la forme d'un paramètre de requête unique `or=`, `and=` ou `not=`, selon la même syntaxe à points que celle utilisée par les filtres de champs :

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Un seul des trois s'applique par requête — `or` l'emporte sur `and`, et tous deux sur `not`. Imbriquez un groupe dans un autre pour les combiner.

Trois encodages méritent d'être connus, car ce sont ceux sur lesquels une chaîne de requête écrite à la main se trompe généralement :

| Condition | Format réseau | Note |
|-----------|---------------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` est une recherche de la chaîne de quatre caractères `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` est une liste contenant une chaîne vide, ce qui correspond à une requête différente |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | un [chemin de relation](/docs/sdk/relations#querying-through-a-relation) conserve son point |

Les virgules, parenthèses et barres obliques inverses à l'intérieur d'une valeur sont échappées par une barre oblique inverse, de sorte que `cond("name", "==", "Doe, John")` transite sous la forme `name.eq.Doe\, John` et ne scinde pas le groupe.

Les groupes peuvent s'imbriquer jusqu'à 32 niveaux de profondeur. Au-delà, la requête est rejetée avec l'erreur `INVALID_LOGICAL_GROUP` — aplatissez-la, puisque `or(a,or(b,c))` équivaut à `or(a,b,c)`.

## Pagination

Les offsets, les numéros de page et les curseurs de type keyset ont leur propre page :
[Pagination](/docs/sdk/pagination/).

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

Une direction omise prend par défaut la valeur `"asc"` — la même signification que `?orderBy=name` en HTTP, quelle que soit la base de données sous-jacente.

### Trier par plusieurs colonnes

Un tri est une *liste* de clés. La deuxième départage les lignes que la première considère comme égales, la troisième départage les lignes que les deux premières n'ont pas pu départager — ainsi, `orderBy` accepte une liste de paires `[field, direction]` tout aussi naturellement qu'une seule :

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

Le query builder fluide exprime la même chose en appelant `.orderBy()` à nouveau. Chaque appel **ajoute** une clé après les précédentes plutôt que de les remplacer :

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Chaque tri se termine par l'ID de la ligne, par ordre décroissant, que vous l'ayez demandé ou non. C'est ce qui rend l'ordonnancement *total* : sans cela, deux lignes partageant une même valeur sont renvoyées dans l'ordre choisi arbitrairement par la base de données, et paginer sur un ordre susceptible de varier entre deux exécutions d'une même requête répète certaines lignes et en ignore d'autres.

Un tri sur plusieurs colonnes pagine parfaitement à l'aide d'un [curseur](/docs/sdk/pagination#cursor-pagination) : la comparaison est construite sur chaque clé, dans l'ordre. Le seul ordre qu'un curseur ne peut pas décrire est **`_score`** — voir [Recherche](/docs/backend/search). La pertinence est calculée par requête plutôt que stockée, il n'y a donc aucune valeur sur la ligne du curseur à laquelle comparer la page suivante, et une telle liste ne comporte aucun `nextCursor`.

### Emplacement de tri des valeurs NULL

Par défaut, les valeurs NULL sont triées **en dernier dans l'ordre croissant et en premier dans l'ordre décroissant** — la convention propre à Postgres. Ce comportement par défaut place chaque ligne sans date tout en haut d'une liste triée « du plus récent au plus ancien », avant tout élément réel, et la seule solution consistait auparavant à appliquer un filtre `is-not-null` qui supprimait entièrement ces lignes.

Un troisième élément sur la clé indique où elles doivent se positionner à la place :

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

En HTTP, il s'agit d'un troisième segment séparé par deux-points, `?orderBy=publishedAt:desc:last`, ou d'une clé `"nulls"` dans le format de tableau JSON. Toute valeur autre que `first`/`last` produit une erreur 400 plutôt qu'un ordre silencieusement différent.

Le [curseur](/docs/sdk/pagination#cursor-pagination) respecte ce que le tri a déclaré, de sorte que la pagination sur une clé nullable reste correcte dans les deux cas de placement.

## Retourner moins de colonnes

`fields` restreint la lecture aux colonnes que vous nommez. Il s'agit d'une projection au niveau de la base de données — ce sont les colonnes *lues*, et non celles qui subsistent après un découpage de la réponse — de sorte qu'une requête n'ayant besoin que de deux champs d'une ligne large ne paie pas pour le reste :

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Deux règles s'appliquent toujours, quelles que soient les colonnes nommées :

- **La clé primaire est toujours renvoyée.** Une ligne qui ne peut pas être adressée ne peut pas être mise à jour, supprimée ou dépassée par pagination — et `meta.nextCursor` en découle, de sorte qu'une projection sans elle désactiverait silencieusement la navigation par curseur.
- **Les colonnes `excludeFromApi` restent masquées.** Le fait d'en nommer une ne la démasque pas.

Une colonne inconnue génère une erreur 400 `UNKNOWN_FIELD`. Si elle était interprétée comme « à omettre », une faute de frappe comme `fields: ["titel"]` renverrait des lignes sans titre et sans aucune indication sur la cause.

Une relation nommée dans `include` est chargée qu'elle apparaisse ou non dans `fields` ; pour restreindre les colonnes *au sein* d'une relation, consultez les [options par relation](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` fusionne les lignes identiques sur les colonnes renvoyées, et une lecture distincte ne renvoie **que** les colonnes que vous spécifiez — la clé primaire est exclue de la projection, contrairement à toutes les autres lectures. Elle doit l'être : une clé de substitution diffère sur chaque ligne, la conserver rendrait donc chaque ligne unique par définition et la requête renverrait un statut 200 sans avoir rien fait.

Cela ne prend donc tout son sens qu'accompagné de `fields`. Sans cela, vous demandez toutes les colonnes visibles, clé incluse, et rien n'est fusionné :

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Une lecture distincte n'adresse aucune ligne — il n'y a pas de clé pour les adresser — elle renvoie donc un ensemble de valeurs plutôt qu'un ensemble de lignes à modifier ou supprimer, et elle ne comporte aucun `nextCursor`. Elle n'indique également **aucun `meta.total`** : compter nécessiterait un `COUNT(DISTINCT …)` que le pilote n'émet pas, et indiquer le nombre de lignes à la place décrirait un ensemble différent de celui servi — un résultat complet de deux lignes revenait avec `total: 8, hasMore: true`, ce qui poussait le client à paginer à l'infini. `hasMore` provient de la page elle-même.

Deux combinaisons sont refusées plutôt que traitées de manière inutile :

- **Une requête qui attribue un score à chaque ligne** — un `search()` avec classement ou un `vectorSearch()` associe un `_score`/`_distance` par ligne, de sorte que deux lignes ne sont jamais égales et que `DISTINCT` n'aurait aucun effet. (Une simple recherche de sous-chaîne n'associe rien et fonctionne très bien.)
- **Trier par une colonne que vous n'avez pas renvoyée.** Postgres ne peut pas ordonner une lecture `DISTINCT` selon une expression en dehors de la liste du select ; la requête échoue avec une erreur 400 `DISTINCT_ORDER_BY_NOT_SELECTED` au lieu d'une 500 citant du SQL que vous n'avez jamais écrit.

En HTTP : `?fields=status&distinct=true`.

## Agrégats

`aggregate()` réduit les lignes correspondantes au lieu de les renvoyer — `count`, `sum`, `avg`, `min`, `max`, éventuellement groupés :

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

Les filtres du builder sont conservés, ce qui constitue généralement la syntaxe la plus courte :

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Les clés de résultat sont **dérivées**, et non choisies : `sum(total)` devient `sum_total`, un simple `count()` devient `count`. Vous permettre de les nommer impliquerait de vérifier que ce nom n'est pas également un champ de `groupBy` — une règle que personne ne devinerait, et une valeur silencieusement écrasée si elle n'était pas vérifiée.

Les groupes sont paginés comme les lignes d'un listing : `limit` les borne et `offset` les saute (grouper par une colonne à forte cardinalité représente le volume de toute une table en une seule réponse). Un agrégat groupé sans `limit` reçoit la valeur par défaut du listing — **50 groupes** en HTTP — vérifiez donc `meta` sur le résultat avant de le considérer comme complet :

```typescript
const byCustomer = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }],
    groupBy: ["customerId"],
    limit: 200
});
byCustomer.meta; // { limit: 200, offset: 0, hasMore: true } — page on with offset: 200
```

Le résultat reste un tableau de lignes ; `meta` est une propriété non énumérable sur celui-ci, de sorte qu'une décomposition (spread) ou un `JSON.stringify` ne voit que les lignes. Elle est présente dès lors que les groupes ont été tronqués à une `limit`. Sans `groupBy`, il n'y a qu'une seule ligne, `limit` n'a aucun effet et `offset` est refusé. Dans une fonction serveur (`rebase.data`, `context.data`), un agrégat groupé sans `limit` renvoie l'ensemble des groupes. `include` n'est pas envoyé avec un agrégat : il n'a aucune relation à charger. Les groupes peuvent être triés avec `orderBy`, par une colonne `groupBy` ou par la clé d'un agrégat — voir [Agrégats et recherche](/docs/sdk/aggregates-and-search/).

Tout l'intérêt est de ne pas récupérer de lignes pour les réduire. Le « chiffre d'affaires par statut » sur un million de commandes représente ici une seule requête et une seule ligne par statut, contre un `findAll()` suivi d'une boucle partout ailleurs — ce qui est incorrect sous une `limit` et inabordable sans elle. L'opération s'exécute via le même handle délimité à la requête que toutes les autres lectures, de sorte que la sécurité au niveau des lignes s'applique aux lignes agrégées.

En HTTP : `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

Le filtrage JSON, la recherche en texte intégral et la recherche vectorielle font l'objet d'une page dédiée :
[Agrégats et recherche](/docs/sdk/aggregates-and-search/).

La lecture des entités associées — `include`, et les accesseurs qui interrogent à travers une relation — dispose de sa propre page : [Interroger les relations](/docs/sdk/relations/).

## Endpoints personnalisés

Appelez des endpoints serveur personnalisés enregistrés via le système de fonctions :

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

Les deux renvoient **le corps de réponse de la fonction, tel quel**. Aucun des deux ne cherche à extraire une clé `data`, donc une fonction qui répond `{ data: [...] }` vous renvoie cet objet et vous lisez vous-même `.data`.

`call()` prend un chemin complet et effectue systématiquement un POST ; `invoke()` prend un nom de fonction et peut accepter une méthode, un sous-chemin et des en-têtes. Utilisez `invoke()` sauf si vous appelez autre chose qu'une fonction.

## Prochaines étapes

- **[Authentification](/docs/sdk/authentication)** — Connexion, inscription, OAuth, sessions
- **[Abonnements temps réel](/docs/sdk/realtime)** — Données en direct avec les WebSockets
- **[Stockage & Fichiers](/docs/sdk/storage)** — Téléverser, télécharger et gérer des fichiers
- **[Relations](/docs/collections/relations)** — Définir des relations entre les tables
