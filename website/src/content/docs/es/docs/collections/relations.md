---
sourceHash: e0fcc045382336df
title: Relaciones
sidebar_label: Relaciones
description: "Vincula tablas con rel.belongsTo, hasOne, hasMany, manyToMany y via: claves foráneas vinculadas o derivadas, tablas de unión con columnas _pivot, reglas de eliminación, reglas de nomenclatura y uniones de múltiples saltos."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

Las `relations` de una tabla nombran los enlaces que tiene con otras tablas. Cada una es una llamada a `rel.*`, y su clave es el nombre de la relación: lo que solicita `include`, lo que lee una ruta anidada como `/api/data/users/1/posts`, y lo que una escritura nombra para establecer el enlace.

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

El destino es un thunk, `() => users`, por lo que dos tablas pueden apuntar entre sí sin importar el orden en que se carguen sus módulos. Ninguna necesita una anotación de tipo: lo que devuelve el thunk se verifica cuando se compila el esquema, y una relación cuyo destino no sea una tabla o vista del esquema se rechaza en ese punto.

:::note[¿Vienes de collections?]
Las relaciones ya no son propiedades. La columna de clave foránea de un `belongsTo` se deriva de la relación o se vincula a una columna declarada. La guía de actualización para esta versión muestra la correspondencia.
:::

## Los cinco tipos

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Tipo | La clave reside | Devuelve | Opciones |
|---|---|---|---|
| `rel.belongsTo` | en **esta** tabla | una fila | `localKey`, `notNull`, `unique`, `onDelete`, `onUpdate`, `index`, `constraint` |
| `rel.hasOne` | en la tabla de **destino**, única | una fila | `foreignKey`, `sourceKey` |
| `rel.hasMany` | en la tabla de **destino** | muchas filas | `foreignKey`, `sourceKey`, `orderBy` |
| `rel.manyToMany` | en una **tabla de unión** | muchas filas | `through`, `sourceKey`, `targetKey`, `pivot`, `onDelete` |
| `rel.via` | donde indiquen los `steps` | una o muchas | `steps` (obligatorio), `cardinality` |

Todas las opciones son opcionales excepto `steps` en `rel.via`. El resto se deriva según las reglas en [Nombres](#nombres).

Cada tipo también admite `access` y `private`, que deciden quién recibe las filas de la relación, de la misma manera que lo hacen para una columna:

- `access: { read?, write? }` enumera los roles que pueden incluir o filtrar por la relación y los roles que pueden establecer el enlace. Una lista omitida delega esa dirección a la fila; una lista vacía la cierra.
- `private: true` mantiene la relación en el servidor: no está en la API, el SDK ni OpenAPI.

Consulta [Acceso a campos](/docs/collections/field-access/) para saber qué ve un cliente sin acceso.

## belongsTo — la clave está en esta tabla

<span class="since-badge" data-since="0.31">Since 0.31</span>

`belongsTo` coloca la clave foránea en la tabla que la declara. La columna SQL de la clave es `localKey`, y `<nombre de la relación en singular>_id` cuando se omite: `author` es `author_id`.

La relación se **vincula** a una columna que declaraste o **deriva** una:

- **Vinculada.** Cuando `columns` tiene una columna cuyo nombre SQL es `localKey`, la relación la utiliza. Su tipo debe ser el tipo de la clave de destino, y sus modificadores (`.notNull()`, `.unique()`) definen qué es el enlace.
- **Derivada.** De lo contrario, la relación agrega la columna después de las declaradas, con el tipo de la clave de destino. Su clave en la conexión (wire key) es el camelCase de su columna: `author_id` se sirve como `authorId`. `notNull: true` y `unique: true` en la relación se aplican a esta columna derivada.

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

La vinculación mantiene visible cada columna física en `columns`, en la posición que elijas. La derivación es más corta. Ambas producen la misma tabla.

Una relación y una columna no pueden compartir clave: la clave de la relación es lo que nombra `include`, por lo que la columna de clave foránea necesita una clave propia (`authorId`, no `author`). Dos relaciones no pueden utilizar la misma columna.

| Opción | Por defecto | Qué hace |
|---|---|---|
| `localKey` | `<singular name>_id` | La columna SQL que contiene la clave. |
| `notNull` | `false` | La columna derivada es `NOT NULL`. En una columna vinculada, escribe `.notNull()` en la columna en su lugar. |
| `unique` | `false` | La columna derivada es `UNIQUE`, lo que hace que el enlace sea uno a uno. En una columna vinculada, escribe `.unique()`. |
| `onDelete` | `restrict` cuando la columna es `NOT NULL`, `set null` en caso contrario | Qué ocurre con esta fila cuando se elimina la fila de destino. Consulta [Reglas de eliminación y actualización](#reglas-de-eliminación-y-actualización). |
| `onUpdate` | ninguno (Postgres aplica `NO ACTION`) | Qué ocurre cuando cambia la clave de destino. |
| `index` | `true` | `false` omite el índice en la columna de clave foránea. |
| `constraint` | `true` | `false` almacena la clave sin una restricción `FOREIGN KEY`. |

La columna de clave foránea se indexa a menos que se indique `index: false`: Postgres indexa la clave a la que apunta una clave foránea, nunca la columna que la contiene, por lo que sin un índice cada lectura desde el otro lado escanea esta tabla. Consulta [Las claves foráneas se indexan automáticamente](/docs/backend/indexes#foreign-keys-are-indexed-for-you).

## hasOne y hasMany — la clave está en el destino

<span class="since-badge" data-since="0.31">Since 0.31</span>

`hasMany` lee filas del destino que apuntan de vuelta a esta. `hasOne` es el mismo enlace con a lo sumo una fila en el otro extremo. Ninguno añade una columna aquí: el destino declara el `belongsTo` que contiene la clave.

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

`foreignKey` es la columna SQL en el destino, y por defecto es `<slug de esta tabla en singular>_id`: en `authors`, `author_id`.

`hasMany` acepta un `orderBy`: el orden en que se devuelven las filas relacionadas cuando quien hace la llamada no especifica ninguno. Es una clave de ordenamiento o varias, cada una `[column, "asc" | "desc", nulls?]`, que nombran las columnas del destino:

```ts
posts: rel.hasMany(() => posts, { foreignKey: "author_id", orderBy: [["published_at", "desc"]] }),
```

El orden declarado se aplica a un include, a la lectura de relación de un único padre y a un listado anidado (`/api/data/authors/1/posts`) siempre que quien hace la llamada no especifique un orden. El `orderBy` del llamador lo reemplaza en lugar de extenderlo. La clave del destino en orden ascendente siempre finaliza el orden, de modo que las páginas sean estables. Un `limit` de include por padre conserva las primeras filas de ese orden, y un listado anidado pagina sobre él, con un offset o un cursor.

### Unión mediante una clave natural

<span class="since-badge" data-since="0.31">Since 0.31</span>

Por defecto, la clave del destino contiene la clave primaria de esta fila. Cuando los dos lados se unen mediante otro elemento (un identificador de identidad externa, un SKU), `sourceKey` nombra la columna en esta tabla:

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

La columna `sourceKey` debe ser única: un enlace que apunte a varias filas de origen no puede determinar a cuál pertenece una fila relacionada. Una fila cuyo `sourceKey` sea `NULL` no alcanza ninguna fila relacionada, y escribir a través de la relación genera un error.

## manyToMany — a través de una unión

<span class="since-badge" data-since="0.31">Since 0.31</span>

`manyToMany` vincula filas a través de una tabla de unión que Rebase crea, con su propia seguridad a nivel de fila. Eliminar un enlace borra la fila de la unión, nunca el destino.

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

| Opción | Por defecto | Qué hace |
|---|---|---|
| `through` | los dos nombres de tabla SQL, ordenados, unidos por `_` | La tabla de unión. Siempre en el esquema `public`. |
| `sourceKey` | `<slug de esta tabla en singular>_id` | La columna de unión que apunta a esta tabla. |
| `targetKey` | `<nombre de la relación en singular>_id` | La columna de unión que apunta al destino. |
| `pivot` | ninguno | Columnas adicionales en la unión, creadas con `col.*`. |
| `onDelete` | `cascade` | Qué ocurre con un enlace cuando se elimina cualquiera de las filas. |

Ambos lados de un enlace pueden declararlo, cada uno desde su propio punto de vista: `sourceKey` siempre nombra la columna de la tabla que la declara. Se rechazan dos relaciones que resuelven en la misma tabla de unión con diferentes columnas clave.

El destino puede ser la propia tabla; por ejemplo, pistas similares a otras pistas. Sus dos columnas de unión tendrían por defecto `track_id`, por lo que se debe diferenciar la del destino mediante `targetKey`; un autoenlace cuyas dos columnas resuelvan con el mismo nombre se rechaza al compilar el esquema:

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

El destino también puede ser una vista (`defineView`): `db push`, el arranque y `schema generate` crean la tabla de unión para ella, y `rebase doctor` considera esa unión como administrada. Una vista no declara ningún `manyToMany` propio.

### `_pivot`: las columnas propias de la unión

<span class="since-badge" data-since="0.31">Since 0.31</span>

Las columnas `pivot` se leen y escriben bajo `_pivot`. Una lectura que incluye la relación sirve cada fila relacionada con las columnas de su enlace:

```json
{ "id": "p1", "name": "Website", "members": [
    { "id": "u7", "email": "ada@example.com", "_pivot": { "role": "owner", "addedAt": "2026-11-02T09:14:00Z" } }
] }
```

Una escritura establece los enlaces como una lista, y un elemento puede incluir el `_pivot` que el enlace debe contener:

```json
{ "members": [{ "id": "u7", "_pivot": { "role": "owner" } }, "u9"] }
```

Las columnas pivot admiten todos los modificadores de columna excepto `.primaryKey()`: la clave de la unión son sus dos columnas de enlace.

### `_count`: cuántas filas relacionadas hay

<span class="since-badge" data-since="0.31">Since 0.31</span>

Un include de una relación to-many (`hasMany`, `manyToMany`, un `via` to-many) puede solicitar el total junto con una página limitada de filas, servido bajo el `_count` de la fila. Se cuenta en la misma sentencia, bajo los mismos filtros y seguridad a nivel de fila. Consulta [Contar lo que un límite deja fuera](/docs/sdk/relations#counting-what-a-limit-leaves-out).

## via — una cadena de unión explícita

<span class="since-badge" data-since="0.31">Since 0.31</span>

`via` lee a través de joins que especificas explícitamente: varios saltos, claves compuestas o una condición que no sea una simple clave foránea.

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

Cada paso une `table`, donde `from` nombra una columna de la tabla anterior (esta misma, para el primer paso) y `to` una columna de `table`. Una lista de columnas en ambos lados realiza la unión sobre una clave compuesta: `on: { from: ["company_code", "region_id"], to: ["code", "region_id"] }`. Una lista de condiciones en `on` une una fila que cumpla cualquiera de ellas, y es de solo lectura.

`cardinality` es `"many"` a menos que indiques `"one"`. Se puede escribir a través de dos cadenas, de la misma forma en que se escribe para el tipo al que sustituyen:

- una cadena **to-one** de **un paso**: la fila de destino contiene la clave, como ocurre con `hasOne`;
- una cadena **to-many** de **dos pasos a través de una tabla** intermedia: esa tabla contiene los enlaces, como ocurre con `manyToMany` (sin `_pivot`).

Cualquier otra cadena es de solo lectura. Una creación o actualización que la especifique se rechaza con `400 RELATION_NOT_WRITABLE`, al igual que una escritura anidada a través de cualquier `via`.

Una cadena puede pasar a través de una tabla que la lectura ya contenga — un `via` de una tabla a sí misma, o nietos alcanzados a través de la misma tabla dos veces: cada paso se une bajo su propio alias. Un filtro de relación o un ordenamiento por un conteo relacionado no admite un `via`, y así lo indica.

## Reglas de eliminación y actualización

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Acción | Comportamiento |
|---|---|
| `"cascade"` | Eliminar o actualizar también las filas relacionadas |
| `"restrict"` | Rechazar la eliminación mientras existan filas relacionadas |
| `"no action"` | Como `restrict`, verificado al final de la sentencia |
| `"set null"` | Vaciar la columna de clave foránea |
| `"set default"` | Establecer la columna de clave foránea en su valor por defecto |

Cuando `onDelete` no está configurado, un `belongsTo` que admite nulos vacía el puntero (`set null`), uno `NOT NULL` rechaza la eliminación (`restrict`) y un enlace `manyToMany` se elimina con cualquiera de las filas (`cascade`). `NOT NULL` indica que una fila no puede existir sin su padre; no indica que eliminar el padre deba eliminar la fila. Solicita `"cascade"` cuando eso sea lo que buscas: es el único valor que elimina filas que no especificaste.

## Nombres

<span class="since-badge" data-since="0.31">Since 0.31</span>

Cada nombre que usa una relación se deriva cuando no lo especificas. Las reglas son las mismas que ya tiene una base de datos desplegada, por lo que no cambian entre versiones.

| Nombre | Regla | `posts` con relación `author` → `users` |
|---|---|---|
| Columna `belongsTo` | `localKey`, de lo contrario `<nombre de la relación en singular>_id` | `author_id` |
| Clave de conexión (wire key) de `belongsTo` | El camelCase de la columna | `authorId` |
| Columna `hasOne` / `hasMany` en el destino | `foreignKey`, de lo contrario `<slug en singular de esta tabla>_id` | `post_id` en el destino |
| Tabla de unión | `through`, de lo contrario ambos nombres de tabla SQL ordenados, unidos por `_` | `posts_tags` para `posts` ↔ `tags` |
| Columna de unión a esta tabla | `sourceKey`, de lo contrario `<slug en singular de esta tabla>_id` | `post_id` |
| Columna de unión al destino | `targetKey`, de lo contrario `<nombre de la relación en singular>_id` | `tag_id` para la relación `tags` |

Una clave foránea derivada tiene el tipo de la clave a la que apunta. Una clave de tipo `serial` es referenciada por un `integer` estándar del mismo ancho, y una clave enum por su propio tipo enum.

El nombre de una relación `belongsTo` representa su columna de clave foránea dondequiera que una tabla nombre una columna: en `indexes`, en `tenant` y en el `ownerField` o condición de una regla.

## Lectura y escritura de relaciones

<span class="since-badge" data-since="0.31">Since 0.31</span>

Las relaciones no se incluyen en una lectura a menos que quien hace la llamada lo solicite:

```typescript
const { data } = await client.data.posts
    .include("author", "tags")
    .find();
```

Una fila incluye entonces tanto la clave foránea como la fila relacionada: `post.authorId` siempre está presente, `post.author` solo cuando se incluye. El [SDK tipado](/docs/sdk/relations/) cubre los includes en su totalidad: límites por relación, filtros, ordenamiento y anidamiento.

Una escritura establece un enlace to-one mediante su clave (`{ author: "u7" }` o `{ authorId: "u7" }`), o `null` para desvincular, y un enlace to-many como una lista de ids de destino u objetos `{ id, _pivot? }` (`{ tags: ["t1", "t2"] }`). Un enlace to-one escrito como un objeto (`{ author: { id: "u7" } }`) devuelve un `400 VALIDATION_INVALID_VALUE` indicando la relación: envía la clave. Un filtro en una relación compara su clave. Consulta [Escritura de datos](/docs/sdk/writing/).

En el CMS, cada relación to-many se convierte en una pestaña debajo del registro. Consulta [Relaciones en el panel de administración](/docs/collections/relations-in-the-admin-panel/).

## Qué se rechaza

<span class="since-badge" data-since="0.31">Since 0.31</span>

`rel.via()` sin steps arroja un error cuando se carga el módulo. Cuando se compila el esquema, una tabla se rechaza por:

- una relación cuyo destino no es una tabla o vista del esquema;
- una relación y una columna con la misma clave;
- una columna vinculada cuyo tipo no es el tipo de la clave de destino, o un `notNull` o `unique` en la relación que la columna vinculada no tenga;
- dos relaciones que utilizan una misma columna de clave foránea, o una columna derivada cuya clave o nombre SQL ya posee otra columna;
- un `belongsTo` que apunta a una tabla con una clave compuesta, un `hasOne` o `hasMany` desde una sin un `sourceKey`, o un `manyToMany` con cualquiera de los lados compuesto: una columna no puede hacer referencia a varias, por lo que debe expresarse con `rel.via()`;
- dos relaciones `manyToMany` que resuelven en una misma tabla de unión con diferentes columnas clave;
- un `manyToMany` cuyas dos columnas de unión resuelven al mismo nombre (un autoenlace sin `targetKey`);
- una columna pivot marcada con `.primaryKey()` (la clave de la unión son sus dos columnas de enlace) o que declare `.transform()` (los hooks de una columna pivot nunca se ejecutan; el `afterRead` del destino ve `_pivot`).

## Siguientes pasos

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Seguridad a nivel de fila](/docs/collections/security-rules/): quién accede a las filas en cada extremo
- [Índices](/docs/backend/indexes/): el índice de clave foránea y los índices compuestos sobre relaciones
- [Relaciones en el SDK tipado](/docs/sdk/relations/): `include`, límites por relación, `_count`
