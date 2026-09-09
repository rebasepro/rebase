---
sourceHash: 6d40635c3d2f94ea
title: Interroger les données
sidebar_label: Interroger les données
description: Opérations CRUD, constructeur de requêtes fluent, opérateurs de filtrage, tri, sélection de colonnes et agrégats avec le SDK Rebase Client.
---

## Accéder aux collections

Accédez à n'importe quelle collection via `client.data.<collectionName>` (en camelCase, automatiquement converti en snake_case) ou `client.data.collection<Record<string, unknown>>("slug")` (slug explicite) :

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Mode strict (SDK généré) :** Lorsque vous transmettez le `collectionsDictionary` généré à `createRebaseClient`, le proxy de données valide les accès aux propriétés au moment de l'accès. Une faute de frappe comme `client.data.prodcuts` lèvera immédiatement une erreur explicite avec une suggestion de correspondance la plus proche, au lieu de produire une erreur 404 déroutante plus tard. Utilisez `client.data.collection<Record<string, unknown>>("slug")` pour contourner la validation pour les slugs dynamiques ou déterminés au moment de l'exécution.

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

Deux méthodes, car il existe deux situations qui nécessitent un code différent.

`get` est destiné à une ligne dont vous supposez l'existence — l'identifiant provient d'un lien, d'un paramètre de route ou d'une autre ligne. Elle renvoie la ligne, afin que rien en aval n'ait besoin d'affiner le type, et une ligne manquante constitue une exception sur laquelle vous pouvez créer une branche conditionnelle :

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

`findById` s'utilise pour une ligne qui peut légitimement ne pas exister — une recherche via un identifiant saisi par un utilisateur, une vérification de cache :

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
La sécurité au niveau des lignes (Row-level security) fait délibérément de « ligne inexistante » et « accès non autorisé » la même réponse : une 404 qui ferait la distinction confirmerait l'existence de la ligne.
:::

### Écriture

`create`, `upsert`, `update`, `delete` et leurs variantes par lot sont décrits sur la page **[Écrire des données](/docs/sdk/writing/)**, ainsi que les opérations sur les champs, les écritures conditionnelles et les clés d'idempotence.

### Count (Compter)

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Constructeur de requêtes fluent

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
| `.where(field, op, value)` | Ajouter une condition de filtrage | `.where("age", ">=", 18)` |
| `.where(path, op, value)` | Filtrer sur un chemin de [relation](#querying-through-a-relation) ou [JSON](#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Ajouter un [groupe OR/AND](#logical-conditions-or--and) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Trier les résultats | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Trier par un [agrégat sur une relation](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limiter le nombre de résultats | `.limit(25)` |
| `.offset(n)` | Ignorer les N premiers résultats | `.offset(50)` |
| `.after(cursor)` | Continuer après un [curseur](#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Retourner [uniquement ces colonnes](#returning-fewer-columns) | `.fields("id", "title")` |
| `.distinct()` | Regrouper les lignes identiques sur ces colonnes | `.fields("status").distinct()` |
| `.search(text)` | Recherche textuelle — voir [Recherche](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Recherche par plus proches voisins sur une propriété `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Charger les lignes associées](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Exécuter la requête | Renvoie `FindResult<M>` |
| `.aggregate(params)` | [Réduire au lieu de renvoyer des lignes](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Diffuser chaque ligne correspondante en continu](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Collecter chaque ligne correspondante](#reading-everything-iterate-and-findall) | Renvoie `M[]` |
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
| `"in"` | | Valeur dans le tableau |
| `"not-in"` | `"nin"` | Valeur non présente dans le tableau |
| `"array-contains"` | `"cs"` | Le champ tableau contient la valeur |
| `"array-contains-any"` | `"csa"` | Le champ tableau contient au moins une des valeurs |
| `"like"` | `"like"` | Correspondance de motif **sensible** à la casse ; `%` et `_` sont les caractères génériques |
| `"ilike"` | `"ilike"` | Correspondance de motif insensible à la casse |
| `"not-like"` | `"nlike"` | Ne correspond pas au motif |
| `"not-ilike"` | `"nilike"` | Ne correspond pas au motif, insensible à la casse |
| `"is-null"` | `"isnull"` | La colonne est `NULL`. Ne prend aucune valeur — ce que vous passez est ignoré |
| `"is-not-null"` | `"notnull"` | La colonne n'est pas `NULL`. Ne prend aucune valeur |

La colonne alias correspond à la syntaxe **réseau** (wire), utilisée dans les chaînes de requête REST. Elle n'apparaît jamais dans le code applicatif : le SDK et le panneau d'administration utilisent tous deux l'opérateur canonique situé à gauche.

### Syntaxes de la clause Where

Le paramètre `where` de `find()` prend en charge deux formats :

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

> **Remarque :** Les chaînes PostgREST pré-sérialisées (format 2) constituent une solution de secours pour transmettre des valeurs de filtre qui sont déjà au format réseau. Privilégiez la syntaxe sous forme de tuple pour la sécurité du typage et la lisibilité.

## Conditions logiques (OR / AND / NOT)

Chaque champ dans `where` est combiné avec un AND. Pour combiner des conditions avec un OR, ou pour nier un groupe, construisez une **condition logique** à l'aide des fonctions utilitaires `or`, `and`, `not` et `cond` exportées par le SDK :

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

Le constructeur fluent accepte la même arborescence :

```typescript
const { data } = await client.data.products
    .where(or(cond("status", "==", "active"), cond("featured", "==", true)))
    .orderBy("createdAt", "desc")
    .find();
```

`cond` prend l'opérateur canonique — la colonne de gauche du tableau des [opérateurs de filtrage](#filter-operators). Un opérateur non pris en charge par le dialecte produit une `TypeError` lors de la sérialisation de la requête, plutôt qu'une requête silencieusement différente.

### Négation

`not` nie la **conjonction** de ses conditions : `not(a)` équivaut à `NOT a`, et `not(a, b)` à `NOT (a AND b)`. Les groupes s'imbriquent, ainsi l'autre loi de De Morgan s'exprime par `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Elle est compilée en un véritable `NOT (...)` SQL, et non en opérateurs inversés. Cette distinction n'est pas cosmétique : la logique SQL est à trois valeurs, de sorte que `NOT (a AND b)` et `(NOT a) OR (NOT b)` cessent d'être équivalents dès qu'un `NULL` intervient, et une seule de ces formes correspond à la requête que vous avez écrite.

Cela signifie également qu'une négation **inclut les lignes dont la colonne est NULL** — `not(cond("status", "==", "draft"))` renvoie les lignes sans aucun statut. C'est la sémantique même de `NOT`, et généralement ce que l'on recherche ; si ce n'est pas le cas, ajoutez un `is-not-null` avec un AND.

### Composition avec le reste de la requête

`where`, `logical` et `search` sont trois groupes indépendants, combinés entre eux par un AND :

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Il n'est pas possible d'effectuer un OR entre `where` et `logical`. Tout ce qui n'est pas un simple AND entre ces trois éléments doit être exprimé au sein d'une même arborescence `logical` — déplacez-y les champs que vous devez combiner avec un OR.

### Format réseau

Un groupe logique est transmis sous la forme d'un unique paramètre de requête `or=`, `and=` ou `not=`, selon la même syntaxe à points que celle utilisée par les filtres de champ :

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Un seul des trois s'applique par requête — `or` prévaut sur `and`, et tous deux prévalent sur `not`. Imbriquez un groupe dans un autre pour les combiner.

Trois encodages méritent d'être connus, car ce sont ceux sur lesquels une chaîne de requête écrite à la main se trompe souvent :

| Condition | Format réseau | Remarque |
|-----------|-----------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` recherche la chaîne de quatre caractères `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` est une liste contenant une chaîne vide, ce qui constitue une requête différente |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | un [chemin de relation](#querying-through-a-relation) conserve son point |

Les virgules, parenthèses et barres obliques inverses au sein d'une valeur sont échappées avec une barre oblique inverse, de sorte que `cond("name", "==", "Doe, John")` circule sous la forme `name.eq.Doe\, John` et ne sépare pas le groupe.

Les groupes peuvent être imbriqués jusqu'à 32 niveaux de profondeur. Au-delà, la requête est rejetée avec `INVALID_LOGICAL_GROUP` — aplatissez-la, puisque `or(a,or(b,c))` équivaut à `or(a,b,c)`.

## Pagination

Les offsets, numéros de page et curseurs keyset ont leur propre page :
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

Une direction omise équivaut par défaut à `"asc"` — la même signification que `?orderBy=name` en HTTP, quelle que soit la base de données sous-jacente.

### Trier par plusieurs colonnes

Un tri est une *liste* de clés. La deuxième départage les lignes que la première considère égales, la troisième départage celles que les deux premières n'ont pu départager — ainsi, `orderBy` accepte une liste de paires `[champ, direction]` aussi simplement qu'une paire unique :

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

Le constructeur fluent exprime la même chose en appelant à nouveau `.orderBy()`. Chaque appel **ajoute** une clé après les précédentes au lieu de les remplacer :

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Chaque tri se termine par l'identifiant de ligne (id), par ordre décroissant, que vous l'ayez demandé ou non. C'est ce qui rend le tri *total* : sans cela, deux lignes partageant une même valeur sont renvoyées dans l'ordre choisi arbitrairement par la base de données, et paginer sur un ordre susceptible de différer entre deux exécutions d'une même requête répète certaines lignes et en ignore d'autres.

Un tri sur plusieurs colonnes pagine parfaitement à l'aide d'un [curseur](#cursor-pagination) : la comparaison est construite sur chaque clé, dans l'ordre. Le seul ordre qu'un curseur ne peut pas décrire est **`_score`** — voir [Recherche](/docs/backend/search). La pertinence étant calculée par requête plutôt que stockée, il n'y a aucune valeur sur la ligne du curseur à laquelle comparer la page suivante, et une telle liste ne comporte aucun `nextCursor`.

### Positionnement des valeurs NULL lors du tri

Par défaut, les valeurs NULL sont triées **en dernier par ordre croissant et en premier par ordre décroissant** — la convention propre à Postgres. Ce comportement par défaut place chaque ligne sans date tout en haut d'une liste triée « du plus récent au plus ancien », avant toute date réelle, et la seule issue consistait auparavant en un filtre `is-not-null` qui supprimait entièrement ces lignes.

Un troisième élément sur la clé indique où les positionner à la place :

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

En HTTP, il s'agit d'un troisième segment séparé par deux-points, `?orderBy=publishedAt:desc:last`, ou d'une clé `"nulls"` sous la forme d'un tableau JSON. Toute valeur autre que `first`/`last` renvoie une erreur 400 plutôt qu'un ordre silencieusement différent.

Le [curseur](#cursor-pagination) respecte la déclaration de tri, de sorte que la pagination sur une clé nullable reste correcte, quel que soit son positionnement.

## Retourner moins de colonnes

`fields` restreint la lecture aux colonnes indiquées. Il s'agit d'une projection effectuée au niveau de la base de données — ce sont les colonnes *lues*, et non celles qui subsistent après un élagage de la réponse — ainsi, une requête nécessitant deux champs d'une ligne volumineuse ne paie pas le coût du reste :

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Deux règles s'appliquent systématiquement, quels que soient les champs spécifiés :

- **La clé primaire est toujours renvoyée.** Une ligne qui ne peut pas être adressée ne peut être ni mise à jour, ni supprimée, ni dépassée lors d'une pagination — et `meta.nextCursor` en découle, de sorte qu'une projection sans elle désactiverait silencieusement la recherche par curseur.
- **Les colonnes `excludeFromApi` restent masquées.** Le fait d'en nommer une ne la rend pas visible.

Une colonne inconnue entraîne une erreur 400 `UNKNOWN_FIELD`. Si elle était interprétée comme « à omettre », une faute de frappe comme `fields: ["titel"]` renverrait des lignes sans titres sans le moindre indice.

Une relation mentionnée dans `include` est chargée, qu'elle apparaisse ou non dans `fields` ; pour restreindre les colonnes *au sein* d'une relation, consultez les [options par relation](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` fusionne les lignes qui sont identiques sur les colonnes renvoyées. Elle n'a de sens qu'avec `fields`, car la clé primaire fait toujours partie de la projection et chaque ligne est donc déjà distincte :

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

`meta.total` compte également les lignes distinctes, ainsi `hasMore` décrit fidèlement l'ensemble en cours de pagination. Deux combinaisons sont refusées plutôt que traitées de façon inutile :

- **Une requête attribuant un score à chaque ligne** — une recherche avec classement `search()` ou une `vectorSearch()` associe un `_score`/`_distance` par ligne, de sorte qu'aucune paire de lignes n'est jamais identique et que `DISTINCT` n'aurait aucun effet. (Une recherche de sous-chaîne classique n'associe rien et fonctionne sans problème.)
- **Trier par une colonne qui n'est pas renvoyée.** Postgres ne peut pas ordonner une lecture `DISTINCT` selon une expression ne figurant pas dans la liste du SELECT ; la requête renvoie une erreur 400 `DISTINCT_ORDER_BY_NOT_SELECTED` au lieu d'une 500 citant du SQL que vous n'avez jamais écrit.

En HTTP : `?fields=status&distinct=true`.

## Agrégats

`aggregate()` réduit les lignes correspondantes au lieu de les renvoyer — `count`, `sum`, `avg`, `min`, `max`, avec regroupement facultatif :

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

Les filtres du constructeur s'y appliquent directement, ce qui constitue généralement la syntaxe la plus concise :

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Les clés de résultat sont **dérivées** et non choisies : `sum(total)` est renvoyé sous la forme `sum_total`, et un simple `count()` sous la forme `count`. Vous permettre de les nommer impliquerait de vérifier que ce nom n'est pas également un champ de `groupBy` — une règle que personne ne devinerait, et une valeur écrasée silencieusement si cela n'était pas vérifié.

`limit` borne le nombre de **groupes** (un regroupement sur une colonne à forte cardinalité peut représenter l'équivalent d'une table entière en une seule réponse) et est ignoré en l'absence de `groupBy`, car un agrégat non groupé ne produit qu'une seule ligne. `orderBy`, `include` et la pagination ne s'appliquent pas : un agrégat n'a pas de lignes à trier, pas de relations à charger et pas de page à poursuivre.

Tout l'intérêt est de ne pas récupérer les lignes pour les réduire ensuite. « Le chiffre d'affaires par statut » sur un million de commandes correspond ici à une seule requête et à une ligne par statut, contre un `findAll()` suivi d'une boucle partout ailleurs — ce qui est incorrect en présence d'une `limit` et inabordable sans elle. L'opération s'exécute via le même gestionnaire de portée de requête que n'importe quelle autre lecture, la sécurité au niveau des lignes s'applique donc aux lignes agrégées.

En HTTP : `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

Le filtrage JSON, la recherche en texte intégral et la recherche vectorielle ont leur propre page :
[Agrégats et recherche](/docs/sdk/aggregates-and-search/).

La lecture d'entités associées — `include`, ainsi que les accesseurs qui interrogent à travers une relation — a sa propre page : [Interroger les relations](/docs/sdk/relations/).

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

Les deux renvoient **le corps de réponse de la fonction, tel quel**. Aucun des deux n'extrait une clé `data`, ainsi une fonction qui répond `{ data: [...] }` vous renvoie cet objet et vous lisez vous-même `.data`.

`call()` prend un chemin complet et effectue systématiquement un POST ; `invoke()` prend un nom de fonction et peut accepter une méthode, un sous-chemin et des en-têtes. Utilisez `invoke()` à moins d'appeler un élément qui n'est pas une fonction.

## Prochaines étapes

- **[Authentification](/docs/sdk/authentication)** — Connexion, inscription, OAuth, sessions
- **[Abonnements temps réel](/docs/sdk/realtime)** — Données en direct avec WebSockets
- **[Stockage & Fichiers](/docs/sdk/storage)** — Téléverser, télécharger et gérer des fichiers
- **[Relations](/docs/collections/relations)** — Définir des relations entre les collections

---
