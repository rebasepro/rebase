---
sourceHash: c7ecc940df2e4680
title: Interroger les relations
sidebar_label: Relations
description: "Incluez des entités liées dans une requête et lisez une collection enfant via son parent grâce aux accesseurs de relations du SDK."
---

## Charger des lignes liées

Les relations peuvent être incluses afin que les entités associées soient renvoyées aux côtés des données principales, plutôt que simplement leurs identifiants de clé étrangère.

### Utilisation de `include()` (Fluent)

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

Les appels successifs **s'ajoutent** les uns aux autres plutôt que de se remplacer, ainsi
`.include("author").include("categories")` demande les deux.

### Utilisation de `find({ include })` (Paramètres)

```typescript
const { data } = await client.data.posts.find({
    include: ["author", "categories"]
});
```

### Imbrication : relations de relations

Un chemin avec des points charge une relation d'une relation, jusqu'à **trois sauts** (hops) :

```typescript
// Each post's comments, and each comment's author.
const { data } = await client.data
    .collection<{ id: string; comments?: { author?: { name: string } }[] }>("posts")
    .include("comments.author")
    .find();

console.log(data[0].comments?.[0].author?.name);
```

Nommer le saut intermédiaire est facultatif — `comments.author` implique déjà
`comments` — et envoyer les deux revient à faire deux fois la même requête.

Chaque saut correspond à une requête groupée (batch) pour l'ensemble de la page, et non une par ligne : une page de 50
publications avec `comments.author` représente trois requêtes, quel que soit le nombre de commentaires.
La limite de profondeur est ce qui empêche une relation autoréférentielle de boucler indéfiniment ;
au-delà, la requête renvoie une erreur 400 `INCLUDE_TOO_DEEP`.

### Restreindre ce qu'une relation charge

La forme sous forme de liste ne permet pas de spécifier un `limit` par relation ; une relation qui
doit être restreinte prend donc un objet d'options à la place :

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

| Option | Ce qu'elle fait |
|--------|-----------------|
| `limit` | Nombre de lignes **par parent**, et non sur l'ensemble de la page — cinq commentaires sur chaque publication, pas cinq au total. |
| `where` | Le même dialecte de filtrage que celui utilisé par le `where` de premier niveau. Poussé dans la requête SQL, de sorte que le `limit` s'applique aux lignes correspondantes. |
| `logical` | Un groupe `or`/`and`/`not` sur les lignes liées. |
| `orderBy` | La même syntaxe de tri, y compris le [positionnement des valeurs NULL](/docs/sdk/querying#where-nulls-sort). |
| `fields` | Colonnes de la ligne *liée*. Sa clé est toujours conservée, afin que la ligne reste adressable. |
| `include` | Relations de la ligne liée, à leur tour — c'est ainsi que l'arborescence s'imbrique. |

`true` est le raccourci pour "charger dans son intégralité" : `{ author: true }` et
`["author"]` correspondent à la même requête.

### Les noms de relation inconnus sont rejetés

Un nom qui n'est pas une relation de la collection entraîne une erreur **400
`UNKNOWN_RELATION`**, à tous les niveaux de l'arborescence — y compris à l'intérieur d'un
`include` imbriqué. Auparavant, il était ignoré, renvoyant un code 200 avec le champ simplement
manquant, or un champ de relation manquant ne se distingue pas d'une ligne qui
n'a réellement aucune ligne liée. Une faute de frappe ressemblait donc exactement à des données vides.

Avec un type `Database` généré, l'exécution ne va pas si loin : les clés de `include` sont
vérifiées par rapport aux relations réelles de la collection au moment de la compilation, de manière récursive.
Voir [Includes typés](#typed-includes).

### Sur le réseau

`include` est un paramètre de requête unique avec deux syntaxes, différenciées par une accolade
au début :

```
GET /api/data/posts?include=author,comments.author
GET /api/data/posts?include={"comments":{"limit":5,"include":{"author":true}}}
```

La forme plate est celle qu'un humain saisit et celle dont la plupart des requêtes ont besoin ; la forme JSON
existe car la forme plate ne peut pas transporter d'options par relation, et inventer une
ponctuation pour celles-ci (`comments(limit:5)`) aurait constitué une troisième grammaire à apprendre
en plus des deux que cette API possède déjà. Les deux formes sont acceptées sur chaque route de liste et
d'obtention par ID, et le SDK choisit celle dont la requête a besoin.

### Combinaison avec des filtres

```typescript
const { data } = await client.data.posts
    .where("status", "==", "published")
    .include("author")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();
```

### Lecture des données de relation

Lorsque des relations sont incluses, la réponse contient **à la fois** la clé étrangère scalaire et l'objet de relation hydraté :

```typescript
const { data } = await client.data
    .collection<{ authorId: string; author?: { name: string } }>("posts")
    .include("author")
    .find();

for (const post of data) {
    // Clé étrangère scalaire — toujours présente
    console.log(post.authorId);    // "uuid-1234"

    // Relation hydratée — présente lorsqu'elle est incluse
    console.log(post.author?.name); // "Jane Doe"
}
```

> **Remarque :** Sans `.include("author")`, seul le champ scalaire `authorId` est renvoyé. L'objet hydraté `author` sera `undefined`.

### Un `belongsTo` a trois formes

Une seule relation, trois endroits où elle apparaît — et le réseau n'est délibérément pas
symétrique à cet égard, il est donc utile de connaître les trois :

| Emplacement | Forme | Pourquoi |
|-------------|-------|----------|
| **Écriture** | `{ author: id }` **ou** `{ authorId: id }` | Les deux sont acceptés. Le transformateur d'écriture mappe la propriété de relation sur la colonne de clé étrangère, ce qui revient à la même écriture. |
| **Lecture** | `authorId` | C'est une colonne. Chaque lecture la renvoie. |
| **Lecture avec `include`** | `author`, la propre ligne de la cible | Chargée uniquement lorsque la requête la nomme, elle est donc absente de toute autre lecture. |

```typescript
type Post = { id: string; title: string; authorId: string; author?: { name: string } };
const posts = client.data.collection<Post>("posts");

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

Un type `Database` généré type précisément les trois : `Insert` et `Update` acceptent
l'une ou l'autre des syntaxes d'écriture, `Row` possède `authorId` sans condition, et `author` est
facultatif sur `Row` et **requis** sur la ligne renvoyée par une lecture avec `include` —
voir [Includes typés](#typed-includes).

Le seul cas où les trois formes se confondent est celui d'une relation nommée de manière identique à sa propre
clé étrangère. Dans ce cas, la ligne incluse est servie *par-dessus* la colonne, et le
type généré l'indique en typant cette clé comme étant les deux.

### Includes typés

`rebase generate-sdk` écrit le graphe de relations dans votre type `Database`, ainsi que
deux utilitaires basés sur celui-ci :

```typescript no-verify
import type { IncludeFor, RowWith } from "./database.types";

const ok: IncludeFor<"posts"> = { comments: { limit: 5, include: { author: true } } };

// @ts-expect-error — 'authr' is not a relation of 'comments'
const typo: IncludeFor<"posts"> = { comments: { include: { authr: true } } };
```

`IncludeFor<A>` restreint les clés d'un include aux relations existantes, à chaque
niveau. `RowWith<A, I>` est la ligne que cette lecture renvoie, où chaque relation incluse
est rendue **requise** — ainsi, après avoir demandé l'auteur, `row.author.name`
n'a pas besoin de `?.`.

Sans `Database` généré, `include` reste un simple `string[]` ou un arbre : un
type de ligne écrit manuellement ne contient aucune relation à valider, et le code
400 du serveur sert de garde-fou.

### Noms de relation

Les noms de relation que vous passez à `include()` doivent correspondre au `relationName` défini dans le tableau `relations` de la collection :

```typescript
// Collection definition
relations: [
    { relationName: "author", target: () => usersCollection, ... },
    { relationName: "categories", target: () => categoriesCollection, ... }
]

// SDK usage — names must match
client.data.articles.include("author", "categories").find()
```

## Interroger à travers une relation

`include()` récupère les lignes associées *après* que la page a été sélectionnée. Les deux
fonctionnalités ci-dessous sélectionnent la page **avec** elles : elles sont compilées en SQL, elles s'exécutent donc
avant `limit` et `offset` plutôt qu'après.

C'est ce dont a besoin un écran de file d'attente — *qui attend, le plus ancien en premier* — où les deux
parties de la question trouvent leur réponse dans une table liée plutôt que dans la ligne
qui est listée.

### Filtrer par une colonne de la ligne liée

Une clé avec un point traverse une relation pour atteindre l'une des colonnes de la cible :

```typescript
// Candidates with at least one application still open.
const { data } = await client.data.talents.find({
    where: {
        "applications.status": ["in", ["applied", "reviewing", "interview"]]
    }
});
```

Elle est compilée sous la forme d'un `EXISTS` sur la table liée, corrélé à la ligne en cours
de listage — et non d'une jointure (join), ce qui multiplierait les lignes et fausserait silencieusement le `limit`.

Tous les opérateurs fonctionnent, car l'élément comparé est une colonne ordinaire :

```typescript
where: {
    "applications.createdAt": ["<", "2026-01-01"],   // waiting since before…
    "agency.name": ["ilike", "%staffing%"]            // through a belongsTo
}
```

Les opérateurs négatifs — `!=`, `not-in`, `not-like`, `not-ilike` — signifient **"aucune
ligne liée ne correspond"**, et non "une ligne liée diffère" :

```typescript
// Candidates with no hired application.
where: { "applications.status": ["!=", "hired"] }
```

C'est l'interprétation souhaitée, et la seule qui permette à `==` et `!=`
de partitionner les lignes. L'autre interprétation — "au moins une candidature n'est pas 'hired'" — est
vraie pour presque tous les candidats ayant plus d'une candidature, et ne répond
à aucune question pertinente.

`is-null` et `is-not-null` ne forment délibérément **pas** une paire complémentaire ici.
Ils signifient "possède une ligne liée dont la colonne n'est pas définie" et "en possède une où elle est
définie" — deux assertions vraies pour un candidat avec deux candidatures, une de chaque type.

Un nom de relation inexistant, ou une colonne que la cible ne possède pas, déclenche une erreur
400 listant les vraies colonnes de la cible. Une condition n'est jamais ignorée : abandonner
une clé de filtre aurait pour effet d'*élargir* la lecture à l'ensemble des lignes.

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

Le constructeur fluent accepte la même clé :

```typescript
const { data } = await client.data.clients
    .orderBy({ relation: "orders", agg: "count" }, "desc")
    .find();
```

`min`, `max`, `count`, `sum` et `avg`. `field` est requis par tous
sauf `count`, qui compte les lignes liées lorsque vous l'omettez et compte
les lignes avec une colonne non nulle lorsque vous le renseignez.

C'est la partie d'une file d'attente que vous ne pouvez pas contourner côté client. Un filtre peut
être approximé en dénormalisant un indicateur sur la ligne ; un ordre ne peut pas du tout
être approximé une fois que le jeu de résultats est paginé, car le client ne détient jamais
qu'une seule page et celle-ci a été sélectionnée selon le mauvais ordre.

Les lignes pour lesquelles la relation n'aboutit à rien se placent à une extrémité définie — **en dernier
par ordre croissant, en premier par ordre décroissant**, l'emplacement que Postgres attribue à `NULL`. Un `count`
portant sur rien vaut `0` plutôt que null, donc ces lignes sont triées avec la valeur zéro.

Sur HTTP, la clé est une chaîne unique, elle s'intègre donc sans modification à `?orderBy=` :

```bash
GET /api/data/talents?orderBy=min(applications.createdAt):asc
```

La pagination par curseur fonctionne par-dessus. Aucun agrégat n'étant stocké sur la ligne du curseur
pour servir de comparaison, le pilote recalcule la valeur de la ligne du curseur en SQL à partir
de l'id dont il dispose.

### Sécurité au niveau des lignes (Row-level security)

Les deux sont compilés en une sous-requête qui s'exécute avec les droits du lecteur, de sorte qu'une ligne liée masquée
par vos stratégies de sécurité ne correspond pas à un filtre et ne contribue pas à un agrégat.

Une mise en garde, sur la direction **négative** uniquement : "aucune ligne liée ne correspond" et "aucune
ligne liée *que ce lecteur peut voir* ne correspond" sont équivalents. Une table cible
avec une sécurité au niveau des lignes et aucune politique `SELECT` pour `rebase_user` est opaque, donc
chaque ligne semble non correspondante et un filtre `!=` / `not-in` renverra trop de résultats. Rien
ne fuite — les propres politiques de la table listée décident toujours quelles lignes existent réellement,
et la direction positive ne renvoie correctement rien. La solution consiste à définir une politique
`SELECT` sur la cible. Rebase en dérive une pour une relation plusieurs-à-plusieurs (many-to-many) déclarée ; un
schéma écrit à la main doit la fournir explicitement.

### Prise en charge par les moteurs

Postgres uniquement. Firestore et MongoDB déclarent `filterableRelationKinds: []` et
ne proposent aucune de ces deux fonctionnalités — une base orientée documents établit des liens par référence et ne dispose pas
de sous-requête dans laquelle compiler ces opérations. Voir
[capacités des sources de données](/docs/backend/multiple-sources).

### Pourquoi pas `additionalFields` ?

`AdditionalFieldDelegate.value()` est asynchrone et reçoit l'ensemble du contexte, il *peut* donc
lire une autre collection — et pourtant il ne peut pas aider ici. Il s'exécute dans
le navigateur, une fois par ligne, **après** que la page a été récupérée et ordonnée. Une valeur
calculée à cet endroit peut être affichée, mais ne peut jamais faire l'objet d'un filtre, d'un tri ou d'une pagination.

Si une valeur dérivée n'est pas un agrégat sur une relation, placez-la dans la base de données —
une colonne générée, ou une colonne maintenue par trigger — et elle deviendra une
propriété ordinaire.

## Étapes suivantes

- [Interroger les données](/docs/sdk/querying/) — le constructeur de requêtes renvoyé par ces accesseurs
- [Relations](/docs/collections/relations/) — déclarer les liaisons lues par cette page
- [API REST](/docs/backend/api/) — le même `include` via HTTP

---
