---
sourceHash: 3cba57377cf922df
title: Interroger les données
sidebar_label: Interroger les données
description: Opérations CRUD, constructeur de requêtes fluide, opérateurs de filtrage, tri, sélection de colonnes et agrégats avec le SDK client Rebase.
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

> **Mode strict (SDK généré) :** Lorsque vous passez le `collectionsDictionary` généré à `createRebaseClient`, le proxy de données valide les accès aux propriétés au moment de l'accès. Une faute de frappe telle que `client.data.prodcuts` lèvera immédiatement une erreur explicite avec une suggestion de correspondance la plus proche au lieu de produire plus tard une erreur 404 déroutante. Utilisez `client.data.collection<Record<string, unknown>>("slug")` pour contourner la validation pour les slugs dynamiques ou déterminés au moment de l'exécution.

## Opérations CRUD

### Find (Liste)

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

Deux méthodes, car il y a deux situations distinctes qui appellent du code différent.

`get` est destiné à une ligne dont vous supposez l'existence — l'ID provient d'un lien, d'un paramètre de route ou d'une autre ligne. Elle renvoie la ligne, de sorte que rien en aval n'ait besoin de restreindre le type, et une ligne manquante déclenche une exception sur laquelle vous pouvez créer une branche conditionnelle :

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

`findById` est destiné à une ligne qui peut légitimement ne pas être présente — une recherche par un ID saisi par un utilisateur, une vérification de cache :

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
La sécurité au niveau des lignes (Row-Level Security) renvoie délibérément la même réponse pour « ligne inexistante » et « non autorisé en lecture » : une erreur 404 qui ferait la distinction confirmerait l'existence de la ligne.
:::

### Écriture

`create`, `upsert`, `update`, `delete` et leurs variantes par lot se trouvent sur la page **[Écriture de données](/docs/sdk/writing/)**, ainsi que les opérations sur les champs, les écritures conditionnelles et les clés d'idempotence.

### Count

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Constructeur de requêtes fluide

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
|---------|-------------|---------|
| `.where(field, op, value)` | Ajouter une condition de filtre | `.where("age", ">=", 18)` |
| `.where(path, op, value)` | Filtrer sur le chemin d'une [relation](#querying-through-a-relation) ou d'un [JSON](#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Ajouter un [groupe OR/AND](#logical-conditions-or--and) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Trier les résultats | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Trier par un [agrégat sur une relation](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limiter le nombre de résultats | `.limit(25)` |
| `.offset(n)` | Ignorer les N premiers résultats | `.offset(50)` |
| `.after(cursor)` | Continuer après un [curseur](#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Renvoyer [uniquement ces colonnes](#returning-fewer-columns) | `.fields("id", "title")` |
| `.distinct()` | Regrouper les lignes identiques sur ces colonnes | `.fields("status").distinct()` |
| `.search(text)` | Recherche textuelle — voir [Recherche](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Recherche des plus proches voisins sur une propriété `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Charger les lignes associées](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Exécuter la requête | Renvoie `FindResult<M>` |
| `.aggregate(params)` | [Réduire au lieu de renvoyer des lignes](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Diffuser en continu chaque ligne correspondante](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Récupérer chaque ligne correspondante](#reading-everything-iterate-and-findall) | Renvoie `M[]` |
| `.count()` | Compter les lignes correspondantes | Renvoie `number` |
| `.listen(onUpdate, onError?)` | S'abonner aux mises à jour en temps réel | Renvoie `unsubscribe()` |

### Opérateurs de filtrage

| Opérateur | Alias | Description |
|-----------|-------|-------------|
| `"=="` | `"eq"` | Égal |
| `"!="` | `"neq"` | Différent de |
| `">"` | `"gt"` | Supérieur à |
| `">="` | `"gte"` | Supérieur ou égal à |
| `"<"` | `"lt"` | Inférieur à |
| `"<="` | `"lte"` | Inférieur ou égal à |
| `"in"` | | Valeur présente dans le tableau |
| `"not-in"` | `"nin"` | Valeur non présente dans le tableau |
| `"array-contains"` | `"cs"` | Le champ de type tableau contient la valeur |
| `"array-contains-any"` | `"csa"` | Le champ de type tableau contient l'une des valeurs |
| `"like"` | `"like"` | Correspondance de motif **sensible** à la casse ; `%` et `_` sont les caractères génériques |
| `"ilike"` | `"ilike"` | Correspondance de motif insensible à la casse |
| `"not-like"` | `"nlike"` | Ne correspond pas au motif |
| `"not-ilike"` | `"nilike"` | Ne correspond pas au motif, insensible à la casse |
| `"is-null"` | `"isnull"` | La colonne est `NULL`. Ne prend aucune valeur — toute valeur transmise est normalisée et ignorée |
| `"is-not-null"` | `"notnull"` | La colonne n'est pas `NULL`. Ne prend aucune valeur |

La colonne alias correspond à la notation **réseau** (wire format), utilisée dans les chaînes de requête REST. Elle n'apparaît jamais dans le code applicatif : le SDK et le panneau d'administration utilisent tous deux l'opérateur canonique de gauche.

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

> **Remarque :** Les chaînes PostgREST pré-sérialisées (format 2) constituent une solution de secours pour transmettre des valeurs de filtre déjà au format réseau. Privilégiez la syntaxe sous forme de tuple pour la sécurité du typage et la lisibilité.

## Conditions logiques (OR / AND / NOT)

Chaque champ dans `where` est combiné avec un opérateur logique AND. Pour associer des conditions avec un OR, ou pour nier un groupe, construisez une **condition logique** avec les fonctions d'assistance `or`, `and`, `not` et `cond` exportées par le SDK :

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

`cond` prend l'opérateur canonique — la colonne de gauche du tableau [Opérateurs de filtrage](#filter-operators). L'utilisation d'un opérateur que le dialecte ne prend pas en charge lève une `TypeError` lors de la sérialisation de la requête, plutôt que d'exécuter silencieusement une requête différente.

### Négation

`not` nie la **conjonction** de ses conditions : `not(a)` équivaut à `NOT a`, et `not(a, b)` à `NOT (a AND b)`. Les groupes peuvent s'imbriquer, ainsi l'autre loi de De Morgan s'écrit `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Cela se compile en un véritable `NOT (...)` SQL, et non en des opérateurs inversés. Cette distinction n'est pas cosmétique : la logique SQL est à trois valeurs, de sorte que `NOT (a AND b)` et `(NOT a) OR (NOT b)` cessent de coïncider dès qu'un `NULL` intervient, et seule l'une d'entre elles correspond à la requête que vous avez écrite.

Cela signifie également qu'une négation **inclut les lignes dont la colonne est NULL** — `not(cond("status", "==", "draft"))` renvoie les lignes sans aucun statut. C'est ce que signifie `NOT`, et c'est généralement ce que l'on souhaite ; si ce n'est pas le cas, associez-y un `is-not-null` avec un AND.

### Composition avec le reste de la requête

`where`, `logical` et `search` sont trois groupes indépendants, combinés entre eux par un AND :

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Il n'est pas possible d'appliquer un OR entre `where` et `logical`. Tout ce qui n'est pas un simple AND entre les trois doit être exprimé à l'intérieur d'un seul arbre `logical` — déplacez-y les champs nécessitant un OR.

### Sur le réseau

Un groupe logique transite sous la forme d'un unique paramètre de requête `or=`, `and=` ou `not=`, selon la même syntaxe à points que celle employée par les filtres de champ :

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Un seul des trois s'applique par requête — `or` prévaut sur `and`, et tous deux prévalent sur `not`. Imbriquez un groupe dans un autre pour les combiner.

Trois encodages méritent d'être connus, car ce sont ceux sur lesquels une chaîne de requête écrite manuellement fait souvent erreur :

| Condition | Forme réseau | Remarque |
|-----------|--------------|----------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` recherche la chaîne de quatre caractères `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` est une liste contenant une seule chaîne vide, ce qui correspond à une requête différente |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | un [chemin de relation](#querying-through-a-relation) conserve son point |

Les virgules, les parenthèses et les barres obliques inverses à l'intérieur d'une valeur sont échappées avec un antislash, ainsi `cond("name", "==", "Doe, John")` transite sous la forme `name.eq.Doe\, John` et ne divise pas le groupe.

Les groupes peuvent s'imbriquer jusqu'à 32 niveaux de profondeur. Au-delà, la requête est rejetée avec l'erreur `INVALID_LOGICAL_GROUP` — aplatissez-la, puisque `or(a,or(b,c))` équivaut à `or(a,b,c)`.

## Pagination

Les offsets, les numéros de page et les curseurs de type keyset disposent de leur propre page : [Pagination](/docs/sdk/pagination/).

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

Si vous omettez la direction, la valeur par défaut est `"asc"` — c'est exactement ce que signifie `?orderBy=name` via HTTP, quelle que soit la base de données sous-jacente.

### Trier par plusieurs colonnes

Un tri est une *liste* de clés. La deuxième départage les lignes considérées comme égales par la première, la troisième départage celles jugées égales par les deux premières — `orderBy` accepte donc tout aussi bien une liste de paires `[field, direction]` qu'une paire unique :

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

Avec le constructeur fluide, la même chose s'exprime en appelant `.orderBy()` à nouveau. Chaque appel **ajoute** une clé après les précédentes plutôt que de les remplacer :

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Chaque tri se termine par l'ID de la ligne, par ordre décroissant, que vous l'ayez demandé ou non. C'est ce qui rend l'ordonnancement *total* : sans cela, deux lignes partageant une même valeur seraient renvoyées dans l'ordre choisi arbitrairement par la base de données, et paginer sur un ordre susceptible de varier entre deux exécutions d'une même requête répéterait certaines lignes et en omettrait d'autres.

Un tri multi-colonnes pagine parfaitement sous un [curseur](#cursor-pagination) : la comparaison s'effectue sur chaque clé, dans l'ordre. Le seul ordre qu'un curseur ne peut pas décrire est **`_score`** — voir [Recherche](/docs/backend/search). La pertinence étant calculée par requête plutôt que stockée, il n'y a aucune valeur sur la ligne du curseur à laquelle comparer la page suivante, et une telle liste ne comporte aucun `nextCursor`.

### Positionnement des valeurs NULL lors du tri

Par défaut, les valeurs NULL sont triées **en dernier par ordre croissant et en premier par ordre décroissant** — la convention propre à Postgres. Ce comportement par défaut place chaque ligne sans date tout en haut d'une liste triée « du plus récent au plus ancien », avant toute donnée réelle, et la seule façon d'y échapper était auparavant d'utiliser un filtre `is-not-null` qui supprimait entièrement ces lignes.

Un troisième élément sur la clé indique où les placer à la place :

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

Via HTTP, il s'agit d'un troisième segment séparé par deux-points, `?orderBy=publishedAt:desc:last`, ou d'une clé `"nulls"` dans le format de tableau JSON. Toute valeur autre que `first`/`last` renvoie une erreur 400 au lieu de produire un tri silencieusement différent.

Le [curseur](#cursor-pagination) respecte ce que le tri a déclaré, de sorte que la pagination sur une clé nullable reste correcte quel que soit le placement choisi.

## Renvoyer moins de colonnes

`fields` restreint la lecture aux colonnes que vous spécifiez. Il s'agit d'une projection effectuée au niveau de la base de données — ce sont les colonnes *lues*, et non celles qui subsistent après un découpage de la réponse — ainsi, une requête qui n'a besoin que de deux champs d'une ligne large ne paie pas le coût du reste :

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Deux règles s'appliquent systématiquement, peu importe ce que vous spécifiez :

- **La clé primaire est toujours renvoyée.** Une ligne qui ne peut pas être adressée ne peut être ni mise à jour, ni supprimée, ni dépassée par pagination — et `meta.nextCursor` en dérive, de sorte qu'une projection sans elle désactiverait silencieusement la navigation par curseur.
- **Les colonnes `excludeFromApi` restent masquées.** En nommer une ne la démasque pas.

Une colonne inconnue génère une erreur 400 `UNKNOWN_FIELD`. Interprétée comme « l'omettre », une faute de frappe comme `fields: ["titel"]` renverrait des lignes sans titre et sans aucune indication sur la cause.

Une relation mentionnée dans `include` est chargée qu'elle apparaisse ou non dans `fields` ; pour restreindre les colonnes *au sein* d'une relation, consultez les [options par relation](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` regroupe les lignes qui sont identiques sur les colonnes renvoyées, et une lecture distincte renvoie **uniquement** les colonnes que vous nommez — la clé primaire est exclue de la projection, contrairement à toutes les autres lectures. Cela doit être ainsi : une clé de substitution (surrogate key) diffère sur chaque ligne, la conserver rendrait donc chaque ligne unique par construction et la requête renverrait un statut 200 sans avoir rien filtré.

Cela n'a donc de sens qu'en combinaison avec `fields`. Sans cela, vous demandez toutes les colonnes visibles, clé comprise, et rien n'est regroupé :

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Une lecture distincte n'adresse aucune ligne en particulier — il n'y a pas de clé pour les désigner — elle renvoie donc un ensemble de valeurs plutôt qu'un ensemble de lignes à mettre à jour ou à supprimer, et elle ne comporte aucun `nextCursor`. Elle ne fournit également **aucun `meta.total`** : le décompte nécessiterait un `COUNT(DISTINCT …)` que le pilote n'émet pas, et renvoyer le nombre de lignes à la place décrirait un ensemble différent de celui servi — un résultat complet de deux lignes revenait avec `total: 8, hasMore: true`, ce qui amènerait un client à paginer indéfiniment. `hasMore` provient de la page elle-même.

Deux combinaisons sont refusées plutôt que traitées de manière inutile :

- **Une requête qui attribue un score à chaque ligne** — un `search()` classé ou un `vectorSearch()` associe un `_score`/`_distance` par ligne, de sorte qu'aucune paire de lignes n'est jamais identique et que `DISTINCT` n'aurait aucun effet. (Une recherche de sous-chaîne simple n'attache rien et fonctionne sans problème.)
- **Trier par une colonne que vous n'avez pas renvoyée.** Postgres ne peut pas ordonner une lecture `DISTINCT` selon une expression qui ne figure pas dans la liste de sélection ; la requête renvoie une erreur 400 `DISTINCT_ORDER_BY_NOT_SELECTED` plutôt qu'une 500 citant du code SQL que vous n'avez jamais écrit.

Via HTTP : `?fields=status&distinct=true`.

## Agrégats

`aggregate()` réduit les lignes correspondantes au lieu de les renvoyer — `count`, `sum`, `avg`, `min`, `max`, éventuellement regroupées :

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

Les clés des résultats sont **dérivées**, et non choisies : `sum(total)` est renvoyé sous la forme `sum_total`, un simple `count()` sous la forme `count`. Vous permettre de les nommer impliquerait de vérifier que le nom ne correspond pas également à un champ de `groupBy` — une règle que personne ne devinerait, avec le risque d'écraser silencieusement une valeur si ce contrôle n'était pas fait.

`limit` restreint le nombre de **groupes** (un regroupement sur une colonne à forte cardinalité peut représenter l'équivalent de toute une table dans une seule réponse) et est ignoré en l'absence de `groupBy`, car un agrégat non groupé ne produit qu'une seule ligne. `orderBy`, `include` et la pagination ne s'appliquent pas : un agrégat n'a pas de lignes à trier, pas de relations à charger et pas de page à continuer.

Tout l'intérêt est de ne pas récupérer les lignes pour ensuite les réduire. « Le chiffre d'affaires par statut » sur un million de commandes correspond ici à une seule requête et une seule ligne par statut, contre un `findAll()` suivi d'une boucle ailleurs — ce qui s'avère erroné en présence d'un `limit` et hors de prix sans lui. Cela passe par le même gestionnaire limité à la requête que toutes les autres lectures, de sorte que la sécurité au niveau des lignes s'applique aux lignes agrégées.

Via HTTP : `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

Le filtrage JSON, la recherche en texte intégral et la recherche vectorielle ont leur propre page : [Agrégats et recherche](/docs/sdk/aggregates-and-search/).

La lecture des entités associées — `include`, ainsi que les accesseurs qui interrogent à travers une relation — a sa propre page : [Interroger les relations](/docs/sdk/relations/).

## Points de terminaison personnalisés

Appelez des points de terminaison serveur personnalisés enregistrés via le système de fonctions :

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

Les deux méthodes renvoient **le corps de la réponse de la fonction, tel quel**. Aucune des deux n'extrait automatiquement une clé `data`, donc une fonction qui renvoie `{ data: [...] }` vous livre cet objet et vous lisez `.data` vous-même.

`call()` prend un chemin complet et utilise toujours la méthode POST ; `invoke()` prend un nom de fonction et peut accepter une méthode HTTP, un sous-chemin et des en-têtes. Utilisez `invoke()` sauf si vous appelez un élément qui n'est pas une fonction.

## Prochaines étapes

- **[Authentification](/docs/sdk/authentication)** — Connexion, inscription, OAuth, sessions
- **[Abonnements temps réel](/docs/sdk/realtime)** — Données en direct avec WebSockets
- **[Stockage & Fichiers](/docs/sdk/storage)** — Téléverser, télécharger et gérer des fichiers
- **[Relations](/docs/collections/relations)** — Définir des relations entre collections

---
