---
sourceHash: e0fcc045382336df
title: Relations
sidebar_label: Relations
description: "Liez des tables avec rel.belongsTo, hasOne, hasMany, manyToMany et via : clés étrangères liées ou dérivées, tables de jonction avec colonnes _pivot, règles de suppression, règles de nommage et jointures multi-sauts."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les `relations` d'une table nomment les liens qu'elle entretient avec d'autres tables. Chacune est un appel à `rel.*`, et sa clé est le nom de la relation : ce que demande `include`, ce qu'un chemin imbriqué tel que `/api/data/users/1/posts` lit, et ce qu'une écriture spécifie pour définir le lien.

```ts
// backend/schema/posts.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { tags } from "./tags";

export const posts = defineTable("posts", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
    },
    relations: {
        author: rel.belongsTo(() => users, { notNull: true, onDelete: "restrict" }),
        tags:   rel.manyToMany(() => tags, { pivot: { sortOrder: col.integer().default(0) } }),
    },
    rls: "admin-only",
});
```

La cible est un thunk, `() => users`, de sorte que deux tables peuvent pointer l'une vers l'autre quel que soit l'ordre de chargement de leurs modules. Aucune n'a besoin d'annotation de type : ce que retourne le thunk est vérifié lors de la compilation du schéma, et une relation dont la cible n'est ni une table ni une vue du schéma y est refusée.

:::note[Vous venez des collections ?]
Les relations ne sont plus des propriétés. La colonne de clé étrangère d'un `belongsTo` est dérivée de la relation, ou liée à une colonne que vous déclarez. Le guide de mise à niveau de cette version présente les correspondances.
:::

## Les cinq types

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Type | Emplacement de la clé | Retourne | Options |
|---|---|---|---|
| `rel.belongsTo` | sur **cette** table | une ligne | `localKey`, `notNull`, `unique`, `onDelete`, `onUpdate`, `index`, `constraint` |
| `rel.hasOne` | sur la table **cible**, unique | une ligne | `foreignKey`, `sourceKey` |
| `rel.hasMany` | sur la table **cible** | plusieurs lignes | `foreignKey`, `sourceKey`, `orderBy` |
| `rel.manyToMany` | dans une **table de jonction** | plusieurs lignes | `through`, `sourceKey`, `targetKey`, `pivot`, `onDelete` |
| `rel.via` | là où `steps` l'indique | une ou plusieurs | `steps` (requis), `cardinality` |

Toutes les options sont facultatives, sauf `steps` sur `rel.via`. Le reste est dérivé selon les règles décrites dans [Noms](#noms).

Chaque type accepte également `access` et `private`, qui déterminent qui reçoit les lignes de la relation, de la même manière que pour une colonne :

- `access: { read?, write? }` liste les rôles autorisés à inclure ou filtrer par la relation, ainsi que les rôles autorisés à définir le lien. L'omission d'une liste laisse cette direction au niveau de la ligne ; une liste vide la ferme.
- `private: true` conserve la relation sur le serveur : elle n'apparaît ni dans l'API, ni dans le SDK, ni dans OpenAPI.

Consultez [Accès aux champs](/docs/collections/field-access/) pour savoir ce que voit un appelant sans accès.

## belongsTo — la clé est sur cette table

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`belongsTo` place la clé étrangère sur la table déclarante. La colonne SQL de la clé est `localKey`, et `<nom de la relation au singulier>_id` lorsque cette option est omise : `author` devient `author_id`.

La relation est soit **liée** à une colonne que vous avez déclarée, soit elle en **dérive** une :

- **Liée.** Lorsque `columns` comporte une colonne dont le nom SQL est `localKey`, la relation l'utilise. Son type doit être celui de la clé de la cible, et ses modificateurs (`.notNull()`, `.unique()`) définissent la nature du lien.
- **Dérivée.** Sinon, la relation ajoute la colonne après celles déclarées, avec le type de la clé de la cible. Sa clé exposée (wire key) est le camelCase de sa colonne : `author_id` est renvoyé sous la forme `authorId`. `notNull: true` et `unique: true` sur la relation s'appliquent à cette colonne dérivée.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

// Derived: an `author_id` column, served as `authorId`.
export const notes = defineTable("notes", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    relations: { author: rel.belongsTo(() => users, { notNull: true }) },
    rls: "admin-only",
});

// Bound: `authorId` is the column `author_id`, so the relation uses it.
export const drafts = defineTable("drafts", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        authorId: col.uuid().notNull(),
    },
    relations: { author: rel.belongsTo(() => users) },
    rls: "admin-only",
});
```

La liaison maintient chaque colonne physique visible dans `columns`, à la position de votre choix. La dérivation est plus concise. Les deux produisent la même table.

Une relation et une colonne ne peuvent pas partager la même clé : la clé de la relation est ce que `include` spécifie, la colonne de clé étrangère a donc besoin de sa propre clé (`authorId`, et non `author`). Deux relations ne peuvent pas utiliser la même colonne.

| Option | Valeur par défaut | Description |
|---|---|---|
| `localKey` | `<nom au singulier>_id` | La colonne SQL contenant la clé. |
| `notNull` | `false` | La colonne dérivée est `NOT NULL`. Sur une colonne liée, utilisez plutôt `.notNull()` sur la colonne. |
| `unique` | `false` | La colonne dérivée est `UNIQUE`, ce qui rend le lien un-à-un. Sur une colonne liée, utilisez `.unique()`. |
| `onDelete` | `restrict` quand la colonne est `NOT NULL`, `set null` sinon | Ce qui arrive à cette ligne lorsque la ligne cible est supprimée. Consultez [Règles de suppression et de mise à jour](#règles-de-suppression-et-de-mise-à-jour). |
| `onUpdate` | aucun (Postgres applique `NO ACTION`) | Ce qui arrive lorsque la clé de la cible change. |
| `index` | `true` | `false` ignore l'index sur la colonne de clé étrangère. |
| `constraint` | `true` | `false` stocke la clé sans contrainte `FOREIGN KEY`. |

La colonne de clé étrangère est indexée sauf si `index: false` : Postgres indexe la clé vers laquelle pointe une clé étrangère, jamais la colonne qui la contient ; sans index, chaque lecture depuis l'autre côté parcourt donc toute cette table. Consultez [Les clés étrangères sont indexées pour vous](/docs/backend/indexes#foreign-keys-are-indexed-for-you).

## hasOne et hasMany — la clé est sur la cible

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`hasMany` lit les lignes de la cible qui pointent vers celle-ci. `hasOne` représente le même lien avec au plus une ligne du côté distant. Aucun des deux n'ajoute de colonne ici : la cible déclare le `belongsTo` qui contient la clé.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { posts } from "./posts";
import { profiles } from "./profiles";

export const authors = defineTable("authors", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    relations: {
        // reads posts.author_id
        posts:   rel.hasMany(() => posts, { foreignKey: "author_id" }),
        // reads profiles.author_id, which is unique
        profile: rel.hasOne(() => profiles, { foreignKey: "author_id" }),
    },
    rls: "admin-only",
});
```

`foreignKey` est la colonne SQL sur la cible, et prend par défaut la valeur `<slug de cette table au singulier>_id` : sur `authors`, `author_id`.

`hasMany` accepte un `orderBy` : l'ordre dans lequel les lignes associées sont renvoyées lorsque l'appelant n'en spécifie aucun. Il s'agit d'une ou plusieurs clés de tri, chacune sous la forme `[column, "asc" | "desc", nulls?]`, désignant les colonnes de la cible :

```ts
posts: rel.hasMany(() => posts, { foreignKey: "author_id", orderBy: [["published_at", "desc"]] }),
```

L'ordre déclaré s'applique à un include, à la lecture d'une relation à parent unique et à un listage imbriqué (`/api/data/authors/1/posts`) chaque fois que l'appelant ne spécifie aucun ordre. L'`orderBy` d'un appelant le remplace plutôt que de l'étendre. La clé de la cible par ordre croissant termine toujours le tri, garantissant ainsi des pages stables. Une `limit` d'include par parent conserve les premières lignes de cet ordre, et un listage imbriqué pagine dessus, avec un offset ou un curseur.

### Jointure sur une clé naturelle

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Par défaut, la clé de la cible contient la clé primaire de cette ligne. Lorsque les deux côtés sont joints sur autre chose (un identifiant d'identité externe, un SKU), `sourceKey` nomme la colonne sur cette table :

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { applications } from "./applications";

export const talents = defineTable("talents", {
    columns: {
        id:         col.uuid().primaryKey().defaultRandom(),
        authUserId: col.text().notNull().unique(),
    },
    relations: {
        // applications.auth_user_id = talents.auth_user_id
        applications: rel.hasMany(() => applications, { sourceKey: "auth_user_id", foreignKey: "auth_user_id" }),
    },
    rls: "admin-only",
});
```

La colonne `sourceKey` doit être unique : un lien qui adresse plusieurs lignes sources ne peut pas déterminer à laquelle appartient une ligne associée. Une ligne dont le `sourceKey` est `NULL` n'atteint aucune ligne associée, et écrire à travers la relation génère une erreur.

## manyToMany — via une table de jonction

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`manyToMany` relie les lignes via une table de jonction créée par Rebase, disposant de sa propre sécurité au niveau des lignes (RLS). La suppression d'un lien supprime la ligne de jonction, jamais la cible.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

export const projects = defineTable("projects", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    relations: {
        members: rel.manyToMany(() => users, {
            through: "project_members",
            pivot: {
                role:    col.enum(["owner", "editor", "viewer"]).notNull().default("viewer"),
                addedAt: col.timestamp({ withTimezone: true }).onCreateNow(),
            },
        }),
    },
    rls: "admin-only",
});
```

| Option | Valeur par défaut | Description |
|---|---|---|
| `through` | les deux noms de tables SQL, triés, joints par `_` | La table de jonction. Toujours dans le schéma `public`. |
| `sourceKey` | `<slug de cette table au singulier>_id` | La colonne de jonction pointant vers cette table. |
| `targetKey` | `<nom de la relation au singulier>_id` | La colonne de jonction pointant vers la cible. |
| `pivot` | aucun | Colonnes supplémentaires sur la jonction, créées avec `col.*`. |
| `onDelete` | `cascade` | Ce qui arrive à un lien lorsque l'une des deux lignes est supprimée. |

Les deux côtés d'un même lien peuvent le déclarer, chacun de son propre point de vue : `sourceKey` nomme toujours la colonne de la table déclarante. Deux relations qui pointent vers la même table de jonction avec des colonnes de clé différentes sont refusées.

La cible peut être la table elle-même — des morceaux (tracks) similaires à d'autres morceaux. Ses deux colonnes de jonction prendraient toutes deux par défaut le nom `track_id`, il convient donc de distinguer celle de la cible avec `targetKey` ; un auto-lien dont les deux colonnes résolvent vers le même nom est refusé lors de la compilation du schéma :

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";

export const tracks = defineTable("tracks", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text().notNull() },
    relations: {
        similar: rel.manyToMany(() => tracks, {
            through: "tracks_similar",
            targetKey: "similar_track_id",
        }),
    },
    rls: "admin-only",
});
```

La cible peut également être une vue (`defineView`) : `db push`, le démarrage et `schema generate` créent la table de jonction pour celle-ci, et `rebase doctor` comptabilise cette jonction comme gérée. Une vue ne déclare aucun `manyToMany` qui lui soit propre.

### `_pivot` : les colonnes propres à la jonction

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les colonnes `pivot` sont lues et écrites sous `_pivot`. Une lecture qui inclut la relation renvoie chaque ligne associée accompagnée des colonnes de son lien :

```json
{ "id": "p1", "name": "Website", "members": [
    { "id": "u7", "email": "ada@example.com", "_pivot": { "role": "owner", "addedAt": "2026-11-02T09:14:00Z" } }
] }
```

Une écriture définit les liens sous forme de liste, et un élément peut comporter le `_pivot` que le lien doit contenir :

```json
{ "members": [{ "id": "u7", "_pivot": { "role": "owner" } }, "u9"] }
```

Les colonnes de pivot acceptent tous les modificateurs de colonne sauf `.primaryKey()` : la clé de la jonction est constituée de ses deux colonnes de liaison.

### `_count` : le nombre de lignes associées

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un include d'une relation to-many (`hasMany`, `manyToMany`, un `via` to-many) peut demander le total aux côtés d'une page limitée de lignes, renvoyé sous le champ `_count` de la ligne. Ce total est calculé dans la même instruction, sous les mêmes filtres et la même sécurité au niveau des lignes. Consultez [Compter ce qu'une limite exclut](/docs/sdk/relations#counting-what-a-limit-leaves-out).

## via — une chaîne de jointures explicite

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`via` effectue la lecture à travers des jointures explicites : plusieurs sauts, des clés composites, ou une condition qui n'est pas une simple clé étrangère.

```ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { permissions } from "./permissions";

export const members = defineTable("members", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    relations: {
        permissions: rel.via(() => permissions, {
            steps: [
                { table: "member_roles",     on: { from: "id",            to: "member_id" } },
                { table: "role_permissions", on: { from: "role_id",       to: "role_id" } },
                { table: "permissions",      on: { from: "permission_id", to: "id" } },
            ],
        }),
    },
    rls: "admin-only",
});
```

Chaque étape joint `table`, `from` désignant une colonne de la table précédente (celle-ci, pour la première étape) et `to` une colonne de `table`. Une liste de colonnes des deux côtés réalise une jointure sur une clé composite : `on: { from: ["company_code", "region_id"], to: ["code", "region_id"] }`. Une liste de conditions dans `on` joint une ligne qui satisfait à n'importe laquelle d'entre elles, et est en lecture seule.

`cardinality` vaut `"many"` sauf si vous spécifiez `"one"`. Deux chaînes peuvent faire l'objet d'écritures, de la même façon que le type qu'elles remplacent :

- une chaîne **to-one** d'**une seule étape** : la ligne cible contient la clé, comme avec `hasOne` ;
- une chaîne **to-many** de **deux étapes à travers une table** intermédiaire : cette table contient les liens, comme avec `manyToMany` (sans `_pivot`).

Toute autre chaîne est en lecture seule. Une création ou une mise à jour la désignant est refusée avec l'erreur `400 RELATION_NOT_WRITABLE`, tout comme une écriture imbriquée via n'importe quel `via`.

Une chaîne peut traverser une table que la lecture contient déjà — un `via` d'une table vers elle-même, ou des petits-enfants atteints à travers la même table deux fois : chaque étape est jointe sous son propre alias. Un filtre de relation ou un tri par décompte associé n'accepte pas de `via`, et l'indique par une erreur.

## Règles de suppression et de mise à jour

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Action | Comportement |
|---|---|
| `"cascade"` | Supprime ou met à jour également les lignes associées |
| `"restrict"` | Refuse la suppression tant que des lignes associées existent |
| `"no action"` | Identique à `restrict`, vérifié à la fin de l'instruction |
| `"set null"` | Vide la colonne de clé étrangère |
| `"set default"` | Définit la colonne de clé étrangère à sa valeur par défaut |

Lorsque `onDelete` n'est pas défini, un `belongsTo` nullable vide le pointeur (`set null`), un `belongsTo` `NOT NULL` refuse la suppression (`restrict`), et un lien `manyToMany` est supprimé avec l'une ou l'autre des lignes (`cascade`). `NOT NULL` indique qu'une ligne ne peut pas exister sans son parent ; cela ne signifie pas que supprimer le parent doit supprimer la ligne. Spécifiez `"cascade"` si c'est ce que vous souhaitez : c'est la seule valeur qui supprime des lignes que vous n'avez pas explicitement désignées.

## Noms

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Chaque nom utilisé par une relation est dérivé lorsque vous ne l'écrivez pas. Ces règles correspondent à celles déjà appliquées par une base de données déployée, afin qu'elles ne changent pas d'une version à l'autre.

| Nom | Règle | `posts` avec relation `author` → `users` |
|---|---|---|
| Colonne `belongsTo` | `localKey`, sinon `<nom de relation au singulier>_id` | `author_id` |
| Clé exposée `belongsTo` | le camelCase de la colonne | `authorId` |
| Colonne `hasOne` / `hasMany` sur la cible | `foreignKey`, sinon `<slug de cette table au singulier>_id` | `post_id` sur la cible |
| Table de jonction | `through`, sinon les deux noms de tables SQL triés, joints par `_` | `posts_tags` pour `posts` ↔ `tags` |
| Colonne de jonction vers cette table | `sourceKey`, sinon `<slug de cette table au singulier>_id` | `post_id` |
| Colonne de jonction vers la cible | `targetKey`, sinon `<nom de relation au singulier>_id` | `tag_id` pour la relation `tags` |

Une clé étrangère dérivée a le type de la clé vers laquelle elle pointe. Une clé de type `serial` est ciblée par un simple `integer` de même largeur, et une clé enum par son propre type enum.

Le nom d'une relation `belongsTo` représente sa colonne de clé étrangère partout où une table désigne une colonne : dans `indexes`, dans `tenant`, et dans le `ownerField` ou la condition d'une règle.

## Lecture et écriture des relations

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les relations ne sont pas incluses dans une lecture à moins que l'appelant ne le demande :

```typescript
const { data } = await client.data.posts
    .include("author", "tags")
    .find();
```

Une ligne contient alors à la fois la clé étrangère et la ligne associée : `post.authorId` est toujours présent, `post.author` uniquement lorsqu'il est inclus. Le [SDK typé](/docs/sdk/relations/) couvre l'ensemble des includes : limites par relation, filtres, tri et imbrication.

Une écriture définit un lien to-one par sa clé (`{ author: "u7" }` ou `{ authorId: "u7" }`), ou `null` pour le délier, et un lien to-many sous forme de liste d'identifiants cibles ou d'objets `{ id, _pivot? }` (`{ tags: ["t1", "t2"] }`). Un lien to-one écrit sous forme d'objet (`{ author: { id: "u7" } }`) renvoie une erreur `400 VALIDATION_INVALID_VALUE` désignant la relation : transmettez la clé. Un filtre sur une relation compare sa clé. Consultez [Écriture de données](/docs/sdk/writing/).

Dans le CMS, chaque relation to-many devient un onglet sous l'enregistrement. Consultez [Relations dans le panneau d'administration](/docs/collections/relations-in-the-admin-panel/).

## Ce qui est refusé

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`rel.via()` sans `steps` lève une exception lors du chargement du module. Lors de la compilation du schéma, une table est refusée pour :

- une relation dont la cible n'est ni une table ni une vue du schéma ;
- une relation et une colonne partageant la même clé ;
- une colonne liée dont le type ne correspond pas au type de la clé cible, ou un `notNull` ou `unique` sur la relation que la colonne liée ne porte pas ;
- deux relations utilisant la même colonne de clé étrangère, ou une colonne dérivée dont la clé ou le nom SQL est déjà utilisé par une autre colonne ;
- un `belongsTo` pointant vers une table avec une clé composite, un `hasOne` ou `hasMany` depuis une table sans `sourceKey`, ou un `manyToMany` dont l'un des côtés est composite : une seule colonne ne peut pas en référencer plusieurs, utilisez donc `rel.via()` ;
- deux relations `manyToMany` résolvant vers une même table de jonction avec des colonnes de clé différentes ;
- un `manyToMany` dont les deux colonnes de jonction résolvent vers le même nom (un auto-lien sans `targetKey`) ;
- une colonne pivot marquée `.primaryKey()` (la clé de la jonction est constituée de ses deux colonnes de liaison) ou déclarant `.transform()` (les hooks d'une colonne pivot ne s'exécutent jamais ; le `afterRead` de la cible voit `_pivot`).

## Prochaines étapes

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- [Sécurité au niveau des lignes (RLS)](/docs/collections/security-rules/) : qui accède aux lignes à chaque extrémité
- [Index](/docs/backend/indexes/) : l'index de clé étrangère et les index composites sur les relations
- [Relations dans le SDK typé](/docs/sdk/relations/) : `include`, limites par relation, `_count`
