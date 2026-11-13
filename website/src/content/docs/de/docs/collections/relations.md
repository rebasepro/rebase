---
sourceHash: e0fcc045382336df
title: Relationen
sidebar_label: Relationen
description: "Tabellen verknüpfen mit rel.belongsTo, hasOne, hasMany, manyToMany und via: gebundene oder abgeleitete Fremdschlüssel, Junction-Tabellen mit _pivot-Spalten, Löschregeln, Benennungsregeln und Multi-Hop-Joins."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die `relations` einer Tabelle benennen die Verknüpfungen, die sie zu anderen Tabellen hat. Jede davon ist ein `rel.*`-Aufruf, und ihr Schlüssel ist der Name der Relation: das, was `include` anfordert, was ein verschachtelter Pfad wie `/api/data/users/1/posts` liest, und was ein Schreibvorgang angibt, um die Verknüpfung zu setzen.

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

Das Ziel ist ein Thunk, `() => users`, sodass zwei Tabellen unabhängig von der Ladereihenfolge ihrer Module aufeinander verweisen können. Keine von beiden benötigt eine Typannotation: Was der Thunk zurückgibt, wird bei der Kompilierung des Schemas geprüft, und eine Relation, deren Ziel keine Tabelle oder View des Schemas ist, wird dort abgelehnt.

:::note[Umstieg von Collections?]
Relationen sind keine Properties mehr. Die Fremdschlüsselspalte eines `belongsTo` wird aus der Relation abgeleitet oder an eine von Ihnen deklarierte Spalte gebunden. Die Upgrade-Anleitung für dieses Release zeigt das Mapping.
:::

## Die fünf Arten

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Art | Wo der Schlüssel liegt | Gibt zurück | Optionen |
|---|---|---|---|
| `rel.belongsTo` | in **dieser** Tabelle | eine Zeile | `localKey`, `notNull`, `unique`, `onDelete`, `onUpdate`, `index`, `constraint` |
| `rel.hasOne` | in der **Ziel**tabelle, eindeutig | eine Zeile | `foreignKey`, `sourceKey` |
| `rel.hasMany` | in der **Ziel**tabelle | mehrere Zeilen | `foreignKey`, `sourceKey`, `orderBy` |
| `rel.manyToMany` | in einer **Junction-Tabelle** | mehrere Zeilen | `through`, `sourceKey`, `targetKey`, `pivot`, `onDelete` |
| `rel.via` | wo `steps` es vorgibt | eine oder mehrere | `steps` (erforderlich), `cardinality` |

Jede Option ist optional, mit Ausnahme von `steps` bei `rel.via`. Der Rest wird nach den Regeln unter [Namen](#namen) abgeleitet.

Jede Art akzeptiert auch `access` und `private`, die festlegen, wer die Zeilen der Relation erhält, genau wie bei einer Spalte:

- `access: { read?, write? }` listet die Rollen auf, die die Relation über `include` einbinden oder nach ihr filtern dürfen, sowie die Rollen, die die Verknüpfung setzen dürfen. Eine weggelassene Liste überlässt diese Richtung der Zeile; eine leere Liste sperrt sie.
- `private: true` behält die Relation auf dem Server: Sie ist weder in der API noch im SDK oder in OpenAPI enthalten.

Siehe [Feldzugriff](/docs/collections/field-access/) dafür, was ein Aufrufer ohne Zugriff sieht.

## belongsTo — der Schlüssel liegt in dieser Tabelle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`belongsTo` platziert den Fremdschlüssel auf der deklarierenden Tabelle. Die SQL-Spalte des Schlüssels ist `localKey`, und `<Relationsname im Singular>_id`, wenn dieser weggelassen wird: `author` wird zu `author_id`.

Die Relation wird entweder an eine von Ihnen deklarierte Spalte **gebunden** oder **leitet** eine ab:

- **Gebunden.** Wenn `columns` eine Spalte enthält, deren SQL-Name `localKey` ist, verwendet die Relation diese. Ihr Typ muss dem Typ des Schlüssels des Ziels entsprechen, und ihre Modifikatoren (`.notNull()`, `.unique()`) bestimmen, wie die Verknüpfung beschaffen ist.
- **Abgeleitet.** Andernfalls fügt die Relation die Spalte nach den deklarierten Spalten mit dem Typ des Zielschlüssels hinzu. Ihr Wire-Key ist das camelCase ihrer Spalte: `author_id` wird als `authorId` ausgeliefert. `notNull: true` und `unique: true` auf der Relation gelten für diese abgeleitete Spalte.

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

Das Binden hält jede physische Spalte in `columns` an der von Ihnen gewählten Position sichtbar. Das Ableiten ist kürzer. Beides führt zur selben Tabelle.

Eine Relation und eine Spalte dürfen sich keinen Schlüssel teilen: Der Schlüssel der Relation ist das, was `include` benennt, daher benötigt die Fremdschlüsselspalte einen eigenen Schlüssel (`authorId`, nicht `author`). Zwei Relationen dürfen nicht dieselbe Spalte verwenden.

| Option | Standard | Was sie bewirkt |
|---|---|---|
| `localKey` | `<singular name>_id` | Die SQL-Spalte, die den Schlüssel enthält. |
| `notNull` | `false` | Die abgeleitete Spalte ist `NOT NULL`. Schreiben Sie bei einer gebundenen Spalte stattdessen `.notNull()` an die Spalte. |
| `unique` | `false` | Die abgeleitete Spalte ist `UNIQUE`, was die Verknüpfung zu einer 1:1-Beziehung macht. Schreiben Sie bei einer gebundenen Spalte stattdessen `.unique()`. |
| `onDelete` | `restrict`, wenn die Spalte `NOT NULL` ist, andernfalls `set null` | Was mit dieser Zeile passiert, wenn die Zielzeile gelöscht wird. Siehe [Lösch- und Aktualisierungsregeln](#lösch--und-aktualisierungsregeln). |
| `onUpdate` | keine (Postgres wendet `NO ACTION` an) | Was passiert, wenn sich der Schlüssel des Ziels ändert. |
| `index` | `true` | `false` überspringt den Index auf der Fremdschlüsselspalte. |
| `constraint` | `true` | `false` speichert den Schlüssel ohne einen `FOREIGN KEY`-Constraint. |

Die Fremdschlüsselspalte wird indexiert, sofern nicht `index: false` gesetzt ist: Postgres indexiert den Schlüssel, auf den ein Fremdschlüssel verweist, niemals die Spalte, die ihn enthält; ohne Index würde daher jeder Lesevorgang von der anderen Seite diese Tabelle scannen. Siehe [Fremdschlüssel werden automatisch indexiert](/docs/backend/indexes#foreign-keys-are-indexed-for-you).

## hasOne und hasMany — der Schlüssel liegt auf dem Ziel

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`hasMany` liest Zeilen des Ziels, die auf diese zurückverweisen. `hasOne` ist dieselbe Verknüpfung mit höchstens einer Zeile auf der Gegenseite. Keines von beiden fügt hier eine Spalte hinzu: Das Ziel deklariert das `belongsTo`, das den Schlüssel enthält.

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

`foreignKey` ist die SQL-Spalte auf dem Ziel und hat standardmäßig den Wert `<dieser Tabellen-Slug im Singular>_id`: bei `authors` also `author_id`.

`hasMany` akzeptiert ein `orderBy`: die Reihenfolge, in der verknüpfte Zeilen zurückgegeben werden, wenn der Aufrufer keine angibt. Dies ist ein oder mehrere Sortierschlüssel, jeweils `[column, "asc" | "desc", nulls?]`, die Spalten des Ziels benennen:

```ts
posts: rel.hasMany(() => posts, { foreignKey: "author_id", orderBy: [["published_at", "desc"]] }),
```

Die deklarierte Reihenfolge gilt für ein Include, das Lesen einer Relation eines einzelnen übergeordneten Datensatzes und eine verschachtelte Auflistung (`/api/data/authors/1/posts`), wann immer der Aufrufer keine Reihenfolge angibt. Ein `orderBy` des Aufrufers ersetzt diese, anstatt sie zu erweitern. Der aufsteigende Schlüssel des Ziels schließt die Sortierung immer ab, sodass Paginierungsseiten stabil sind. Ein `limit` beim Include pro übergeordnetem Datensatz behält die ersten Zeilen dieser Reihenfolge bei, und eine verschachtelte Auflistung paginiert darüber, entweder mit einem Offset oder einem Cursor.

### Join über einen natürlichen Schlüssel

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Standardmäßig enthält der Schlüssel des Ziels den Primärschlüssel dieser Zeile. Wenn beide Seiten über etwas anderes verknüpft werden (eine externe Identitäts-ID, eine SKU), benennt `sourceKey` die Spalte in dieser Tabelle:

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

Die `sourceKey`-Spalte muss eindeutig sein: Eine Verknüpfung, die mehrere Quellzeilen adressiert, kann nicht bestimmen, zu welcher davon eine verknüpfte Zeile gehört. Eine Zeile, deren `sourceKey` `NULL` ist, erreicht keine verknüpften Zeilen, und das Schreiben über die Relation führt zu einem Fehler.

## manyToMany — über eine Junction-Tabelle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`manyToMany` verknüpft Zeilen über eine Junction-Tabelle, die Rebase erstellt, mit eigener Row-Level Security. Das Entfernen einer Verknüpfung löscht die Junction-Zeile, niemals das Ziel.

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

| Option | Standard | Was sie bewirkt |
|---|---|---|
| `through` | die beiden SQL-Tabellennamen, sortiert, verbunden durch `_` | Die Junction-Tabelle. Immer im `public`-Schema. |
| `sourceKey` | `<dieser Tabellen-Slug im Singular>_id` | Die Junction-Spalte, die auf diese Tabelle verweist. |
| `targetKey` | `<Relationsname im Singular>_id` | Die Junction-Spalte, die auf das Ziel verweist. |
| `pivot` | keine | Zusätzliche Spalten in der Junction-Tabelle, erstellt mit `col.*`. |
| `onDelete` | `cascade` | Was mit einer Verknüpfung geschieht, wenn eine der beiden Zeilen gelöscht wird. |

Beide Seiten einer Verknüpfung können diese deklarieren, jeweils aus ihrer eigenen Sicht: `sourceKey` benennt immer die Spalte der deklarierenden Tabelle. Zwei Relationen, die auf dieselbe Junction-Tabelle mit unterschiedlichen Schlüsselspalten verweisen, werden abgelehnt.

Das Ziel kann die Tabelle selbst sein — z. B. Tracks, die anderen Tracks ähneln. Ihre beiden Junction-Spalten würden standardmäßig beide `track_id` lauten; benennen Sie daher die des Ziels mit `targetKey` abweichend. Eine Selbstverknüpfung, deren zwei Spalten denselben Namen ergeben, wird beim Kompilieren des Schemas abgelehnt:

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

Das Ziel kann auch ein View (`defineView`) sein: `db push`, Systemstart und `schema generate` erstellen die Junction-Tabelle dafür, und `rebase doctor` zählt diese Junction als verwaltet. Ein View deklariert kein eigenes `manyToMany`.

### `_pivot`: die eigenen Spalten der Junction-Tabelle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`pivot`-Spalten werden unter `_pivot` gelesen und geschrieben. Ein Lesevorgang, der die Relation einbindet, liefert jede verknüpfte Zeile mit den Spalten ihrer Verknüpfung aus:

```json
{ "id": "p1", "name": "Website", "members": [
    { "id": "u7", "email": "ada@example.com", "_pivot": { "role": "owner", "addedAt": "2026-11-02T09:14:00Z" } }
] }
```

Ein Schreibvorgang setzt die Verknüpfungen als Liste, und ein Element kann das `_pivot` tragen, das die Verknüpfung enthalten soll:

```json
{ "members": [{ "id": "u7", "_pivot": { "role": "owner" } }, "u9"] }
```

Pivot-Spalten akzeptieren jeden Spaltenmodifikator außer `.primaryKey()`: Der Schlüssel der Junction-Tabelle besteht aus ihren beiden Verknüpfungsspalten.

### `_count`: wie viele verknüpfte Zeilen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Include einer To-Many-Relation (`hasMany`, `manyToMany`, ein To-Many-`via`) kann neben einer limitierten Seite von Zeilen auch die Gesamtzahl anfordern, die unter `_count` der Zeile bereitgestellt wird. Sie wird in demselben Statement unter denselben Filtern und derselben Row-Level Security gezählt. Siehe [Zählen, was ein Limit auslässt](/docs/sdk/relations#counting-what-a-limit-leaves-out).

## via — eine explizite Join-Kette

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`via` liest über explizit definierte Joins: mehrere Hops, zusammengesetzte Schlüssel oder eine Bedingung, die kein einfacher Fremdschlüssel ist.

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

Jeder Schritt verknüpft `table`, wobei `from` eine Spalte der vorherigen Tabelle benennt (für den ersten Schritt diese Tabelle) und `to` eine Spalte von `table`. Eine Liste von Spalten auf beiden Seiten verknüpft über einen zusammengesetzten Schlüssel: `on: { from: ["company_code", "region_id"], to: ["code", "region_id"] }`. Eine Liste von Bedingungen in `on` verknüpft eine Zeile, die mindestens eine davon erfüllt, und ist schreibgeschützt (read-only).

`cardinality` ist `"many"`, sofern Sie nicht `"one"` angeben. Über zwei Arten von Ketten kann geschrieben werden, und zwar genau so, wie über die Art geschrieben wird, die sie vertreten:

- eine **To-One**-Kette aus **einem Schritt**: Die Zielzeile enthält den Schlüssel, wie bei `hasOne`;
- eine **To-Many**-Kette aus **zwei Schritten über eine Tabelle** zwischen den Endpunkten: Diese Tabelle enthält die Verknüpfungen, wie bei `manyToMany` (ohne `_pivot`).

Jede andere Kette ist schreibgeschützt. Ein Erstell- oder Aktualisierungsvorgang, der sie benennt, wird mit `400 RELATION_NOT_WRITABLE` abgelehnt, ebenso wie ein verschachtelter Schreibvorgang über ein beliebiges `via`.

Eine Kette kann eine Tabelle durchlaufen, die der Lesevorgang bereits enthält — ein `via` von einer Tabelle zu sich selbst oder Kindeskinder, die zweimal über dieselbe Tabelle erreicht werden: Jeder Schritt wird unter seinem eigenen Alias gejoint. Ein Relationsfilter oder eine Sortierung nach einer verknüpften Anzahl akzeptiert kein `via` und weist explizit darauf hin.

## Lösch- und Aktualisierungsregeln

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Aktion | Verhalten |
|---|---|
| `"cascade"` | Auch die verknüpften Zeilen löschen oder aktualisieren |
| `"restrict"` | Das Löschen ablehnen, solange verknüpfte Zeilen existieren |
| `"no action"` | Wie `restrict`, wird am Ende des Statements geprüft |
| `"set null"` | Die Fremdschlüsselspalte leeren |
| `"set default"` | Die Fremdschlüsselspalte auf ihren Standardwert setzen |

Wenn `onDelete` nicht festgelegt ist, leert ein nullable `belongsTo` den Zeiger (`set null`), ein `NOT NULL`-Pointer lehnt das Löschen ab (`restrict`), und eine `manyToMany`-Verknüpfung wird mit jeder der beiden Zeilen gelöscht (`cascade`). `NOT NULL` besagt, dass eine Zeile ohne ihren übergeordneten Datensatz nicht existieren kann; es besagt nicht, dass das Löschen des übergeordneten Datensatzes auch die Zeile löschen soll. Geben Sie `"cascade"` an, wenn Sie genau das beabsichtigen: Es ist der einzige Wert, der Zeilen entfernt, die Sie nicht explizit benannt haben.

## Namen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Jeder Name, den eine Relation verwendet, wird abgeleitet, wenn Sie ihn nicht explizit angeben. Die Regeln entsprechen denen, die eine bereitgestellte Datenbank bereits anwendet, sodass sie sich zwischen Releases nicht ändern.

| Name | Regel | `posts` mit Relation `author` → `users` |
|---|---|---|
| `belongsTo`-Spalte | `localKey`, sonst `<Relationsname im Singular>_id` | `author_id` |
| `belongsTo`-Wire-Key | das camelCase der Spalte | `authorId` |
| `hasOne`- / `hasMany`-Spalte auf dem Ziel | `foreignKey`, sonst `<dieser Tabellen-Slug im Singular>_id` | `post_id` auf dem Ziel |
| Junction-Tabelle | `through`, sonst beide SQL-Tabellennamen sortiert, verbunden durch `_` | `posts_tags` für `posts` ↔ `tags` |
| Junction-Spalte zu dieser Tabelle | `sourceKey`, sonst `<dieser Tabellen-Slug im Singular>_id` | `post_id` |
| Junction-Spalte zum Ziel | `targetKey`, sonst `<Relationsname im Singular>_id` | `tag_id` für Relation `tags` |

Ein abgeleiteter Fremdschlüssel hat den Typ des Schlüssels, auf den er verweist. Auf einen Schlüssel vom Typ `serial` verweist ein einfacher `integer` derselben Breite, und auf einen Enum-Schlüssel dessen eigener Enum-Typ.

Der Name einer `belongsTo`-Relation steht überall dort für ihre Fremdschlüsselspalte, wo eine Tabelle eine Spalte benennt: in `indexes`, in `tenant` sowie im `ownerField` oder der Bedingung einer Regel.

## Relationen lesen und schreiben

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Relationen werden bei einem Lesevorgang standardmäßig nicht einbezogen, es sei denn, der Aufrufer fordert dies explizit an:

```typescript
const { data } = await client.data.posts
    .include("author", "tags")
    .find();
```

Eine Zeile enthält dann sowohl den Fremdschlüssel als auch die verknüpfte Zeile: `post.authorId` ist immer vorhanden, `post.author` nur, wenn per Include angefordert. Das [typisierte SDK](/docs/sdk/relations/) deckt Includes vollständig ab: Limits pro Relation, Filter, Sortierung und Verschachtelung.

Ein Schreibvorgang setzt eine To-One-Verknüpfung über ihren Schlüssel (`{ author: "u7" }` oder `{ authorId: "u7" }`) bzw. `null`, um die Verknüpfung aufzuheben, und eine To-Many-Verknüpfung als Liste von Ziel-IDs oder `{ id, _pivot? }`-Objekten (`{ tags: ["t1", "t2"] }`). Eine To-One-Verknüpfung, die als Objekt geschrieben wird (`{ author: { id: "u7" } }`), führt zu einem `400 VALIDATION_INVALID_VALUE`, der die Relation benennt: Senden Sie stattdessen den Schlüssel. Ein Filter auf eine Relation vergleicht deren Schlüssel. Siehe [Daten schreiben](/docs/sdk/writing/).

Im CMS wird jede To-Many-Relation zu einem Tab unter dem Datensatz. Siehe [Relationen im Admin-Panel](/docs/collections/relations-in-the-admin-panel/).

## Was abgelehnt wird

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`rel.via()` ohne Schritte wirft bereits beim Laden des Moduls einen Fehler. Bei der Kompilierung des Schemas wird eine Tabelle aus folgenden Gründen abgelehnt:

- eine Relation, deren Ziel keine Tabelle oder View des Schemas ist;
- eine Relation und eine Spalte mit demselben Schlüssel;
- eine gebundene Spalte, deren Typ nicht dem Typ des Zielschlüssels entspricht, oder ein `notNull` oder `unique` auf der Relation, das die gebundene Spalte nicht aufweist;
- zwei Relationen, die dieselbe Fremdschlüsselspalte verwenden, oder eine abgeleitete Spalte, deren Schlüssel oder SQL-Name bereits von einer anderen Spalte verwendet wird;
- ein `belongsTo`, das auf eine Tabelle mit zusammengesetztem Primärschlüssel verweist, ein `hasOne` oder `hasMany` von einer solchen Tabelle ohne `sourceKey`, oder ein `manyToMany`, bei dem eine der beiden Seiten zusammengesetzt ist: Eine einzelne Spalte kann nicht auf mehrere verweisen, drücken Sie dies daher mit `rel.via()` aus;
- zwei `manyToMany`-Relationen, die mit unterschiedlichen Schlüsselspalten auf dieselbe Junction-Tabelle verweisen;
- ein `manyToMany`, dessen zwei Junction-Spalten denselben Namen ergeben (eine Selbstverknüpfung ohne `targetKey`);
- eine Pivot-Spalte, die mit `.primaryKey()` markiert ist (der Schlüssel der Junction-Tabelle besteht aus ihren beiden Verknüpfungsspalten) oder `.transform()` deklariert (Hooks von Pivot-Spalten werden nie ausgeführt; das `afterRead` des Ziels sieht `_pivot`).

## Nächste Schritte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- [Row-Level Security](/docs/collections/security-rules/): Wer auf die Zeilen an beiden Enden zugreifen kann
- [Indizes](/docs/backend/indexes/): Der Fremdschlüssel-Index und zusammengesetzte Indizes über Relationen
- [Typisierte SDK-Relationen](/docs/sdk/relations/): `include`, Limits pro Relation, `_count`
