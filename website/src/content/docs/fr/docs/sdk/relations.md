---
sourceHash: 3db2d10879df1c44
title: Interroger les relations
sidebar_label: Relations
description: "Inclure des entités liées dans une requête et lire une table enfant via son parent grâce aux accesseurs de relations du SDK."
---

## Charger les lignes associées

Les relations peuvent être incluses de manière à ce que les entités associées soient renvoyées aux côtés des données principales, plutôt que de simples identifiants de clés étrangères.

### Utiliser `include()` (Fluent)

```typescript
// Include specific relations
const { data } = await client.data.posts
    .include("author", "categories")
    .find();

// Include all defined relations, one hop deep
const { data } = await client.data.posts
    .include("*")
    .find();
```

Les appels répétés **s'ajoutent** les uns aux autres plutôt que de se remplacer, donc `.include("author").include("categories")` demande les deux.

### Utiliser `find({ include })` (Paramètres)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Imbrication : relations de relations

Un chemin avec notation pointée charge une relation de relation, jusqu'à **trois sauts** :

```typescript
// Each post's comments, and each comment's author.
const { data } = await client.data
    .table<{ id: string; comments?: { author?: { name: string } }[] }>("posts")
    .include("comments.author")
    .find();

console.log(data[0].comments?.[0].author?.name);
```

Nommer le saut intermédiaire est facultatif — `comments.author` implique déjà `comments` — et envoyer les deux revient à faire la même requête deux fois.

Chaque saut correspond à une seule requête groupée pour l'ensemble de la page, et non une par ligne : une page de 50 articles avec `comments.author` représente trois requêtes, quel que soit le nombre de commentaires. Cette limite de profondeur est ce qui empêche une relation auto-référentielle de boucler à l'infini ; au-delà, la requête renvoie une erreur 400 `INCLUDE_TOO_DEEP`.

### Restreindre ce qu'une relation charge

La syntaxe sous forme de liste ne permet pas de spécifier un `limit` par relation, une relation nécessitant d'être restreinte prend donc un objet d'options à la place :

```typescript
const { data } = await client.data.posts.include({
    comments: {
        limit: 5,
        where: { published: ["==", true] },
        orderBy: ["createdAt", "desc"],
        fields: ["id", "body"],
        include: { author: true }
    }
}).find();
```

| Option | Description |
|--------|--------------|
| `limit` | Lignes **par parent**, et non sur toute la page — cinq commentaires sur chaque publication, pas cinq au total. Appliqué au niveau de la requête, de sorte que les lignes excédentaires ne sont jamais lues depuis la base de données. |
| `where` | La même syntaxe de filtre que celle utilisée par le `where` de premier niveau. Injecté dans la requête, de sorte que le `limit` s'applique aux lignes correspondantes. |
| `logical` | Un groupe `or`/`and`/`not` sur les lignes associées. |
| `orderBy` | La même syntaxe de tri, y compris le [positionnement des valeurs NULL](/docs/sdk/querying#where-nulls-sort). Les égalités, ainsi qu'un `limit` sans `orderBy`, sont triées selon la clé de la ligne associée, par ordre croissant. |
| `fields` | Colonnes de la ligne *associée*. Sa clé est toujours conservée afin que la ligne reste adressable. |
| `include` | Relations de la ligne associée, à leur tour — c'est ainsi que l'arbre s'imbrique. |
| `count` | Renvoie également le nombre total de lignes associées, par parent, sous le champ `_count` de la ligne. Voir [Compter ce qu'une limite exclut](#compter-ce-quune-limite-exclut). |

`true` est le raccourci pour « charger dans son intégralité » : `{ author: true }` et `["author"]` représentent la même requête.

### Compter ce qu'une limite exclut

Un `limit` plafonne ce qui est envoyé, et `count: true` indique la quantité omise. C'est ce dont une liste a besoin pour afficher quatre tags et un « +33 » :

```typescript
const { data } = await client.data.posts.include({
    tags: { limit: 4, count: true }
}).find();

// data[0] → { id: 1, title: "…", tags: [ …4 rows ], _count: { tags: 37 } }
```

- `_count` est un objet par ligne, indexé par nom de relation. Compter deux relations ajoute deux clés.
- Le total est calculé dans la même instruction SQL qui lit les lignes. Il couvre les mêmes lignes qu'une lecture sans le `limit` renverrait : le `where` du include, le soft delete et la sécurité au niveau des lignes (RLS) s'appliquent tous. Le demander n'ajoute aucune requête.
- Sans `limit`, le total correspond au nombre de lignes renvoyées.
- `count` fonctionne uniquement sur les relations to-many. Sur une relation to-one, il renvoie une erreur 400 `INVALID_INCLUDE`. Il en va de même pour une table possédant une colonne nommée `_count`, car le total l'écraserait.
- Une relation que l'appelant n'a pas le droit de lire (accès au champ) est exclue de `_count`, de la même manière que ses lignes le sont.

### Les noms de relations inconnus sont refusés

Un nom qui n'est pas une relation de la table renvoie une erreur **400 `UNKNOWN_RELATION`**, à chaque niveau de l'arbre — y compris à l'intérieur d'un `include` imbriqué. Cela était autrefois ignoré, ce qui répondait un code 200 avec le champ simplement manquant, et un champ de relation manquant ne peut être distingué d'une ligne n'ayant réellement aucune ligne liée. Une faute de frappe ressemblait donc exactement à des données vides.

Avec un type `Database` généré, cela ne va pas aussi loin : les clés de `include` sont vérifiées par rapport aux relations réelles de la table au moment de la compilation, de manière récursive. Voir [Includes typés](#includes-typés).

### Sur le réseau

`include` est un paramètre de requête qui possède deux syntaxes, différenciées par une accolade ouvrante au début :

```
GET /api/data/posts?include=author,comments.author
GET /api/data/posts?include={"comments":{"limit":5,"include":{"author":true}}}
```

La forme plate est ce qu'un humain saisit et ce dont la plupart des requêtes ont besoin ; la forme JSON existe car la forme plate ne peut pas transporter d'options par relation, et inventer une ponctuation dédiée (`comments(limit:5)`) aurait représenté une troisième grammaire à apprendre en plus des deux que cette API possède déjà. Les deux sont acceptées sur chaque route de liste et de récupération par identifiant, et le SDK sélectionne celle dont la requête a besoin.

### Combinaison avec des filtres

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Lire les données de relation

Lorsque les relations sont incluses, la réponse contient **à la fois** la clé étrangère scalaire et l'objet de relation hydraté :

```typescript
const { data } = await client.data
    .table<{ authorId: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Scalar foreign key — always present
    console.log(post.authorId);    // "uuid-1234"

    // Hydrated relation — present when included
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Remarque :** Sans `.include("author")`, seul le champ scalaire `authorId` est renvoyé. L'objet hydraté `author` sera `undefined`.

### Un `belongsTo` a trois formes

Une seule relation, trois endroits où elle apparaît — et le réseau n'est délibérément pas symétrique à cet égard, il est donc utile de connaître les trois :

| Emplacement | Forme | Pourquoi |
|-------|-------|-----|
| **Écriture** | `{ author: id }` **ou** `{ authorId: id }` | Les deux sont acceptés. Le transformateur d'écriture mappe la propriété de relation sur la colonne de clé étrangère, les deux correspondent donc à la même écriture. Un objet (`{ author: { id } }`) renvoie une 400 mentionnant la relation : envoyez la clé. |
| **Lecture** | `authorId` | C'est une colonne. Chaque lecture la renvoie. |
| **Lecture avec `include`** | `author`, la propre ligne de la cible | Chargée uniquement lorsque la requête la nomme, elle est donc absente de toute autre lecture. |

```typescript
type Post = { id: string; title: string; authorId: string; author?: { name: string } };
const posts = client.data.table<Post>("posts");

// Write: either spelling.
await posts.create({ title: "Hello", author: authorId } as Partial<Post>);
await posts.create({ title: "Hello", authorId });

// Read: the key.
const post = await posts.get(id);
post.authorId;          // "uuid-1234"
post.author;            // undefined — nothing asked for it

// Read with include: the row.
const { data } = await posts.include("author").find();
data[0].authorId;       // "uuid-1234" — still there
data[0].author?.name;   // "Jane Doe"
```

Un type `Database` généré type précisément ces trois formes : `Insert` et `Update` acceptent l'une ou l'autre des syntaxes d'écriture, `Row` possède `authorId` inconditionnellement, et `author` est facultatif sur `Row` — `RowWith<"posts", ["author"]>` est la ligne avec ce champ **obligatoire**, pour une lecture qui l'a demandé. Voir [Includes typés](#includes-typés).

Le seul cas où les trois formes se confondent est lorsqu'une relation porte exactement le même nom que sa propre clé étrangère. Dans ce cas, la ligne incluse est servie *par-dessus* la colonne, et le type généré le reflète en typant cette clé avec les deux.

### Includes typés

`rebase generate-sdk` écrit le graphe de relations dans votre type `Database`, ainsi que deux helpers basés sur celui-ci :

```typescript no-verify
import type { IncludeFor, RowWith } from "./database.types";

const ok: IncludeFor<"posts"> = { comments: { limit: 5, include: { author: true } } };

// @ts-expect-error — 'authr' is not a relation of 'comments'
const typo: IncludeFor<"posts"> = { comments: { include: { authr: true } } };
```

`IncludeFor<A>` contraint les clés d'un include aux relations qui existent, à chaque niveau — et un client typé vérifie `include` de la même manière, dans `find({ include })` et dans `.include(...)`, de sorte que `posts.include("authr")` soit une erreur de compilation plutôt qu'une erreur 400 `UNKNOWN_RELATION`. Les lignes renvoyées par une lecture typent toujours chaque relation comme facultative ; `RowWith<A, I>` est cette ligne avec chaque relation incluse rendue **obligatoire**, pour annoter ce que vous lisez — ainsi, après avoir demandé l'auteur, un `RowWith<"posts", ["author"]>` ne nécessite aucun `?.` sur `row.author.name`.

Sans type `Database` généré, `include` reste un simple `string[]` ou un arbre : un type de ligne écrit à la main ne contient aucune relation par rapport à laquelle effectuer la vérification, et l'erreur 400 du serveur sert alors de filet de sécurité.

### Noms des relations

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les noms que vous passez à `include()` sont les clés des `relations` de la table :

```ts
// backend/schema/articles.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { categories } from "./categories";

export const articles = defineTable("articles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull()
    },
    relations: {
        author: rel.belongsTo(() => users),
        categories: rel.manyToMany(() => categories)
    },
    rls: "admin-only"
});
```

```typescript
// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Interroger à travers une relation

`include()` récupère les lignes associées *après* que la page a été sélectionnée. Les deux fonctionnalités ci-dessous sélectionnent la page **avec** elles : elles compilent en SQL, et s'exécutent donc avant `limit` et `offset` plutôt qu'après.

C'est ce dont un écran de file d'attente a besoin — *qui attend, les plus anciens d'abord* — où les deux aspects de la question sont résolus par une table liée plutôt que par la ligne listée.

### Filtrer par une colonne de la ligne associée

Une clé avec notation pointée accède à l'une des colonnes de la cible à travers une relation :

```typescript
// Candidates with at least one application still open.
const { data } = await client.data.talents.find({
    where: {
        "applications.status": ["in", ["applied", "reviewing", "interview"]]
    }
});
```

Elle compile en un `EXISTS` sur la table associée, corrélé à la ligne listée — et non une jointure, qui multiplierait les lignes et fausserait silencieusement `limit`.

Tous les opérateurs fonctionnent, car l'élément comparé est une colonne ordinaire :

```typescript
where: {
    "applications.createdAt": ["<", "2026-01-01"],   // waiting since before…
    "agency.name": ["ilike", "%staffing%"]            // through a belongsTo
}
```

Les opérateurs négatifs — `!=`, `not-in`, `not-like`, `not-ilike` — signifient **« aucune ligne liée ne correspond »**, et non « au moins une ligne liée diffère » :

```typescript
// Candidates with no hired application.
where: { "applications.status": ["!=", "hired"] }
```

C'est l'interprétation souhaitée, et la seule qui permet à `==` et `!=` de partitionner les lignes. L'autre interprétation — « une certaine candidature n'est pas 'hired' » — est vraie pour presque tous les candidats ayant plus d'une candidature, et ne répond à aucune question utile.

`is-null` et `is-not-null` ne forment délibérément **pas** une paire complémentaire ici. Ils signifient « possède une ligne liée dont la colonne n'est pas définie » et « en possède une où elle est définie » — les deux étant vrais pour un candidat ayant deux candidatures, une de chaque type.

Un nom de relation qui n'existe pas, ou une colonne que la cible ne possède pas, renvoie une 400 indiquant les vraies colonnes de la cible. Il ne s'agit jamais d'une condition ignorée : ignorer une clé de filtre *élargirait* la lecture à chaque ligne.

### Trier par un agrégat sur une relation

```typescript
// Candidates, whoever has been waiting longest first.
const { data } = await client.data.talents.find({
    where: { "applications.status": ["in", ["applied", "reviewing"]] },
    orderBy: [[{ relation: "applications", field: "createdAt", agg: "min" }, "asc"]]
});

// Clients, busiest first.
orderBy: [[{ relation: "orders", agg: "count" }, "desc"]]
```

Le constructeur fluent prend la même clé :

```typescript
const { data } = await client.data.clients
    .orderBy({ relation: "orders", agg: "count" }, "desc")
    .find();
```

`min`, `max`, `count`, `sum` et `avg`. `field` est requis par chacun d'eux à l'exception de `count`, qui compte les lignes associées si vous l'omettez et compte les lignes avec une colonne non nulle si vous le spécifiez.

C'est l'aspect d'une file d'attente qu'on ne peut pas contourner côté client. Un filtre peut être approximé en dénormalisant un indicateur sur la ligne ; un tri ne peut absolument pas être approximé dès lors que le jeu de résultats est paginé, car le client ne détient jamais qu'une seule page et la page a été sélectionnée selon le mauvais ordre.

Les lignes pour lesquelles la relation n'aboutit à rien se retrouvent à une extrémité définie — **en dernier par ordre croissant, en premier par ordre décroissant**, le positionnement que Postgres applique à `NULL`. Un `count` de zéro élément donne `0` plutôt que null, ces lignes sont donc triées avec la valeur zéro.

Via HTTP, la clé est une chaîne simple, elle s'intègre donc telle quelle dans `?orderBy=` :

```bash
GET /api/data/talents?orderBy=min(applications.createdAt):asc
```

La pagination par curseur fonctionne avec cela. Il n'y a pas d'agrégat stocké sur la ligne du curseur auquel se comparer, le pilote recalcule donc la valeur de la ligne du curseur en SQL à partir de l'identifiant dont il dispose.

### Sécurité au niveau des lignes

Les deux se compilent en une sous-requête exécutée avec les droits du lecteur, ainsi une ligne liée masquée par vos stratégies ne correspondra à aucun filtre et ne contribuera à aucun agrégat.

Un avertissement toutefois, sur la direction **négative** uniquement : « aucune ligne liée ne correspond » et « aucune ligne liée *que ce lecteur peut voir* ne correspond » sont équivalents. Une table cible avec sécurité au niveau des lignes et sans stratégie `SELECT` pour `rebase_user` est opaque, ainsi chaque ligne semble sans correspondance et un filtre `!=` / `not-in` renverra trop de résultats. Rien ne fuite — les propres stratégies de la table listée déterminent toujours quelles lignes existent, et la direction positive ne renvoie correctement rien. La solution consiste à ajouter une stratégie `SELECT` sur la table cible. Rebase en déduit une automatiquement pour un many-to-many déclaré ; un schéma écrit manuellement doit la fournir.

### Prise en charge par le moteur

Postgres uniquement. Une collection Firestore dans le CMS déclare `filterableRelationKinds: []` et ne propose aucune de ces fonctionnalités — une base documentaire lie par référence et ne dispose pas de sous-requêtes dans lesquelles compiler tout cela. Voir [Firebase](/docs/frontend/firebase/).

### Pourquoi pas `additionalFields` ?

`AdditionalFieldDelegate.value()` est asynchrone et reçoit l'ensemble du contexte, il *peut* donc lire une autre table — mais il ne peut toujours pas aider ici. Il s'exécute dans le navigateur, une fois par ligne, **après** que la page a été récupérée et triée. Une valeur ainsi calculée peut être affichée mais ne pourra jamais faire l'objet d'un filtrage, d'un tri ou d'une pagination.

Si une valeur dérivée n'est pas un agrégat sur une relation, placez-la dans la base de données — via une colonne générée ou maintenue par un déclencheur — et elle deviendra une propriété ordinaire.

## Prochaines étapes

- [Querying Data](/docs/sdk/querying/) — le constructeur de requêtes que ces accesseurs renvoient
- [Relations](/docs/collections/relations/) — déclarer les liaisons que cette page lit
- [REST API](/docs/backend/api/) — le même `include` via HTTP
