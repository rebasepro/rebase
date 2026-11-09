---
sourceHash: 86856f16dce196a2
title: Relaciones
sidebar_label: Relaciones
description: Define relaciones SQL uno a uno, uno a muchos y muchos a muchos entre colecciones con claves foráneas, tablas de unión y combinaciones multi-hop.
---

## Descripción general

Las relaciones definen cómo se conectan las colecciones a nivel de base de datos. Permiten a Rebase:

- Renderizar **campos selectores de relaciones** en formularios de entidades
- Resolver **entidades relacionadas** al mostrar vistas previas
- Generar **restricciones de clave foránea** en el esquema de Drizzle
- Admitir comportamientos de **eliminación/actualización en cascada**

Las relaciones se pueden definir en línea (inline) dentro de la propiedad, o explícitamente en el array `relations` de una colección:

### 1. Relaciones en línea (Recomendado)

Declara el enlace en la propiedad, anidado bajo `relation`. Elige el `kind` y
el tipo ofrecerá exactamente los campos que ese tipo necesita.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", admin: { multiline: true } },
        author: {
            type: "relation",
            name: "Author",
            relation: {
                kind: "belongsTo",
                target: () => usersCollection
            }
        }
    }
});
```

### 2. Array explícito de relaciones

Para un enlace sin una propiedad propia (sin nada con qué nombrarlo en el formulario o en
una columna de la tabla), decláralo en `relations`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    properties: {
        name: { type: "string", name: "Name" }
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "posts",
            target: () => postsCollection
        }
    ]
});
```

## Los cinco tipos (kinds)

Una relación es de uno de cinco tipos. El tipo determina dónde reside la clave, si
devuelve una fila o muchas, y qué puede afectar una escritura a través de ella.

| Kind | Dónde reside la clave | Devuelve | Notas |
|---|---|---|---|
| `belongsTo` | en **esta** tabla | uno | `localKey`, por defecto `<relationName>_id` |
| `hasOne` | en la tabla del **destino** | uno | `foreignKeyOnTarget`, por defecto el singular de esta colección más `_id` (`users` → `user_id`) |
| `hasMany` | en la tabla del **destino** | muchos | los hijos pertenecen únicamente a este padre |
| `manyToMany` | en una **tabla de unión** | muchos | las filas son compartidas; tú eres el dueño del enlace |
| `via` | un `joinPath` explícito | cualquiera | editable cuando es de un solo salto (single-hop), de solo lectura en caso contrario; define la `cardinality` tú mismo |

Cada campo es opcional excepto `kind` y `target` (y, en `via`, `cardinality`
y `joinPath`); el resto es derivado.

### belongsTo — la clave está en esta tabla

```typescript
author: {
    type: "relation",
    name: "Author",
    relation: { kind: "belongsTo", target: () => usersCollection }
}
// → posts.author_id
```

La columna se
indexa automáticamente: Postgres indexa la clave a la que apunta una clave foránea, nunca la
columna que la contiene, por lo que sin un índice cada inclusión de `hasMany` y listado anidado
desde el otro lado escanea esta tabla. `index: false` mantiene la restricción y
elimina el índice; consulta [Foreign keys are indexed for you](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
para saber cuándo vale la pena y cuándo Rebase lo omite por su cuenta porque
otro índice ya cubre la columna.

### hasMany / hasOne — la clave está en la de ellos

```typescript
relations: [
    { kind: "hasMany", relationName: "posts", target: () => postsCollection }
]
// → reads posts.user_id
```

`hasOne` es el mismo enlace con a lo sumo una fila en el otro extremo.

#### Unión mediante una clave natural

Por defecto, la clave foránea de destino contiene el **id** de la fila de origen. Cuando los dos
lados se unen mediante otro valor (un id de identidad externa, un SKU, un
slug de tenant), indica esa columna con `sourceKey`:

```typescript
relations: [
    {
        kind: "hasMany",
        relationName: "applications",
        target: () => applicationsCollection,
        sourceKey: "auth_user_id",          // column on THIS table
        foreignKeyOnTarget: "auth_user_id"  // column on the TARGET's table
    }
]
// → reads applications.auth_user_id = talents.auth_user_id
```

`sourceKey` es el reflejo de `localKey` en `belongsTo`: aquel nombra la
columna *desde* la que lee este lado, este nombra la columna *a la que* apunta
el otro lado. Sin él, un enlace como el anterior no se puede expresar como `hasMany` en absoluto
y debe recurrir a [`via`](#via--una-cadena-de-unión-explícita), que es de solo lectura para
una cadena como esta.

La columna debe ser única. Un enlace que apunta a más de una fila de origen
no puede determinar a cuál pertenece una fila relacionada, y Postgres tampoco aceptará una
clave foránea contra una columna no única. Rebase comprueba esto en tiempo de lectura
y lo rechaza en lugar de elegir una al azar.

Un padre cuyo `sourceKey` sea `NULL` no alcanza ninguna fila, y escribir a través de la
relación genera un error: no hay nada a lo que las filas relacionadas puedan apuntar.

### manyToMany — a través de una tabla de unión

```typescript
tags: {
    type: "relation",
    name: "Tags",
    relation: { kind: "manyToMany", target: () => tagsCollection }
}
// → junction `posts_tags` (both table names, sorted), columns post_id / tag_id
```

Ambos lados declaran el suyo propio, y cada uno escribe `through` **desde su propio punto de
vista**; `sourceColumn` siempre hace referencia a *esta* colección:

```typescript
// on posts
{ kind: "manyToMany", relationName: "tags", target: () => tagsCollection,
  through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }

// on tags
{ kind: "manyToMany", relationName: "posts", target: () => postsCollection,
  through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" } }
```

### via — una cadena de unión explícita

Para enlaces que las cuatro formas anteriores no pueden expresar: rutas de múltiples saltos (multi-hop), claves compuestas
o una combinación cuya condición no sea una simple clave foránea.

Una cadena de **un solo salto** (single-hop) se puede escribir a través de una creación o actualización, de la misma manera en que se escribe el tipo al que sustituye:

- una cadena **to-one** de **un paso**: la fila de destino contiene la clave, por lo que
  `{ badge: "b-1" }` apunta la columna de esa fila a esta, y `null` la desenlaza,
  tal como lo hace una escritura de `hasOne`;
- una cadena **to-many** de **dos pasos a través de una tabla** entre los extremos: esa
  tabla contiene los enlaces, por lo que `{ tags: ["t-1", "t-2"] }` los establece como sus filas, como lo
  hace una escritura de `manyToMany` (un `via` no incluye `_pivot`).

Cualquier cosa más larga es de **solo lectura**: Rebase no deducirá cómo escribir a través de una
cadena arbitraria. Una creación o actualización que especifique una se rechazará con
`400 RELATION_NOT_WRITABLE`, y el formulario de administración mostrará el campo sin un selector.
Una escritura anidada (`PATCH users/1/permissions/3`) a través de cualquier `via` se rechazará de
la misma manera.

```typescript
{
    kind: "via",
    relationName: "permissions",
    target: () => permissionsCollection,
    cardinality: "many",
    joinPath: [
        { table: "user_roles",       on: { from: "id",            to: "user_id" } },
        { table: "role_permissions", on: { from: "role_id",       to: "role_id" } },
        { table: "permissions",      on: { from: "permission_id", to: "id" } }
    ]
}
```

## Propiedades de relación

Para renderizar un campo de relación en un formulario, agrega una propiedad con `type: "relation"`:

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        relation: { kind: "belongsTo", target: () => usersCollection },
        // Which control draws it is presentation, so it goes in the admin block:
        // "select" (dropdown) or "dialog" (full picker).
        admin: { widget: "select" }
    }
}
```

Al renderizar una vista previa (como en una celda de tabla o un chip de referencia), Rebase gestiona la hidratación automáticamente.

### To-one obtiene un selector, many obtiene una pestaña

La cardinalidad decide la superficie visual, y solo se utiliza una superficie:

- **`belongsTo` / `hasOne`** — una fila, por lo que la propiedad es una clave foránea que
  el autor edita. Se renderiza como el selector mostrado anteriormente.
- **`hasMany` / `manyToMany`** — muchas filas, por lo que la vista de entidad las lista como una
  **pestaña** propia. La propiedad no se renderiza en el formulario: los hijos de una colección
  son una lista, no un valor que contiene el registro, y seleccionarlos desde un
  menú desplegable no es algo que el formulario pueda ofrecer de manera adecuada.

Declarar una relación de tipo many como propiedad sigue siendo útil: es lo que da nombre
a la pestaña y lo que proporciona a la relación una columna en la tabla de la colección, la cual la
consulta del listado hidrata para que las filas hijas aparezcan como chips en la fila. Solo se
omite el campo del formulario.

En la tabla, una relación con una propiedad propia obtiene **una** columna: la suya propia.
Cada pestaña también tiene una columna de botón para saltar a la pestaña, pero para una
relación declarada como propiedad ese botón repetía el mismo encabezado junto a una columna que ya
mostraba los hijos, por lo que se omite. Si ocultas la columna de la relación
(`admin: { hideFromCollection: true }`), el botón reaparece, de modo que la
relación nunca desaparece por completo de la tabla.

Ocultar la columna no detiene la consulta. La lectura de la lista de la colección incluye
cada relación declarada por una propiedad, esté oculta o no, por lo que el código que lee las
filas de la lista (`additionalFields`, resolutores de visualización, acciones de entidad, acciones de
colección mediante `tableController.rows`, slots de plugins) encuentra las filas relacionadas
allí, anidadas bajo el nombre de la relación tal como las devuelve el `include` de REST, junto
a la columna de clave foránea. A `browserCallbacks.afterRead` se le entrega la misma fila. Una relación declarada únicamente en el array `relations`
de la colección, sin propiedad, no se incrusta en la lista; sus filas se cargan cuando se
abre su pestaña.

Si deseas el selector en línea de todos modos, indícalo:

```typescript
properties: {
    tags: {
        type: "relation",
        name: "Tags",
        relation: { kind: "manyToMany", target: () => tagsCollection },
        admin: { renderInForm: true }   // off by default; the tab is the default treatment
    }
}
```

## Combinaciones de múltiples saltos (Multi-Hop Joins)

Para relaciones que atraviesan múltiples tablas, usa `kind: "via"` con un `joinPath`.
Una cadena de más de un enlace es de solo lectura: Rebase no deducirá cómo escribir
a través de una cadena arbitraria (consulta [via](#via--una-cadena-de-unión-explícita) para conocer las
cadenas de un solo salto en las que sí escribe).

```typescript
// Users → Permissions through Roles
relations: [
    {
        kind: "via",
        relationName: "permissions",
        target: () => permissionsCollection,
        cardinality: "many",
        joinPath: [
            {
                table: "user_roles",
                on: { from: "id", to: "user_id" }
            },
            {
                table: "roles",
                on: { from: "role_id", to: "id" }
            },
            {
                table: "role_permissions",
                on: { from: "id", to: "role_id" }
            },
            {
                table: "permissions",
                on: { from: "permission_id", to: "id" }
            }
        ]
    }
]
```

### Combinaciones con claves compuestas

```typescript
joinPath: [
    {
        table: "customers",
        on: {
            from: ["company_code", "region_id"],  // Multiple columns
            to: ["code", "region_id"]
        }
    }
]
```

### Coincidencia con cualquiera de dos columnas

Una lista en `on` une una fila que cumpla **cualquiera de las condiciones**: un enlace mantenido en `a` o `b`. Es de **solo lectura**.

```typescript
joinPath: [{ table: "friendships", on: [{ from: "id", to: "a" }, { from: "id", to: "b" }] }]
```

Agregar un segundo paso hacia `people` (`on: [{ from: "a", to: "id" }, { from: "b", to: "id" }]`) también coincide con la propia columna del padre, por lo que cada persona se devuelve como su propio amigo: lista las filas de amistad o filtra a la persona.

## Reglas de cascada

Controla lo que sucede cuando las entidades relacionadas se actualizan o se eliminan:

```typescript
relations: [
    {
        kind: "belongsTo",
        relationName: "author",
        target: () => usersCollection,
        localKey: "author_id",
        onDelete: "cascade",    // Delete posts when user is deleted
        onUpdate: "cascade"     // Update FK when user ID changes
    }
]
```

| Acción | Comportamiento |
|--------|----------|
| `"cascade"` | Propagar el cambio a las filas relacionadas |
| `"restrict"` | Impedir la operación si existen filas relacionadas |
| `"no action"` | Igual que restrict (aplazar a la comprobación de la restricción) |
| `"set null"` | Establecer la columna FK en NULL |
| `"set default"` | Establecer la columna FK en su valor por defecto |

### Lo que obtienes cuando no especificas nada

`onDelete` es opcional, por lo que la mayoría de las relaciones nunca especifican uno. El valor por defecto depende de
si la relación es obligatoria:

| Relación | `onDelete` por defecto |
|--------|----------|
| `belongsTo`, opcional | `"set null"` — el puntero se vacía |
| `belongsTo`, `validation: { required: true }` | `"restrict"` — la eliminación del padre falla |
| `manyToMany` (filas de unión) | `"cascade"` — el enlace desaparece, el destino se mantiene |

Una relación requerida **no** es una eliminación en cascada. `required` indica que un hijo no puede existir
sin un padre; no dice que eliminar al padre deba destruir al hijo.
Son afirmaciones diferentes, y solo una de ellas elimina filas que no especificaste.
Por lo tanto, el comportamiento por defecto falla la eliminación e indica la restricción, y `"cascade"` es
algo que debes solicitar explícitamente:

```typescript
{
    kind: "belongsTo",
    relationName: "order",
    target: () => ordersCollection,
    // A line item is meaningless without its order — say so.
    onDelete: "cascade"
}
```

`onUpdate` no tiene un valor por defecto: si no se define nada, Postgres aplica `NO ACTION`. Establece
`"cascade"` cuando la clave de destino sea algo que un usuario pueda editar (un slug, un SKU)
para que los punteros la sigan.

## Obtención de relaciones en el SDK

Al consultar datos a través del SDK tipado de Rebase, las relaciones **no** se incluyen por defecto. Usa el método `include()` para solicitar entidades relacionadas junto con los datos principales.

### Incluir relaciones específicas

```typescript
const { data } = await client.data.articles
    .include("author", "categories")
    .find();
```

### Incluir todas las relaciones

```typescript
const { data } = await client.data.articles
    .include("*")
    .find();
```

### Uso de la sintaxis de parámetros

```typescript
const { data } = await client.data.articles.find({
    include: ["author", "categories"]
});
```

### Estructura de la respuesta

Cuando se incluyen, la respuesta contiene tanto la **clave foránea escalar** como el **objeto de relación hidratado**:

```typescript
const { data } = await client.data
    .collection<{ id: string; authorId: string; author?: { name: string } }>("articles")
    .include("author")
    .find();

// The SDK returns flat rows — there is no `.values` wrapper. (`Entity`, with
// `id`/`path`/`values`, is an admin-UI view model, not what the client hands back.)
for (const article of data) {
    // Scalar FK — always present
    article.authorId;     // "uuid-1234"

    // Hydrated relation — only present when included
    article.author?.name;  // "Jane Doe"
}
```

> Los nombres de las relaciones pasados a `include()` deben coincidir con el nombre de la relación: el `relationName` de una entrada en el array `relations` de la colección, o la clave de la propiedad que la declara en línea.

Para consultar la referencia completa del constructor de consultas (filtrado, ordenación, paginación, tiempo real), consulta la [documentación del SDK tipado](/docs/sdk).

## Relaciones en el panel de administración

Cada relación to-many (`hasMany`, `manyToMany` o un `via` to-many) se convierte en una pestaña dentro de un registro en el panel de administración, identificada por el nombre de la relación. [Relaciones en el panel de administración](/docs/collections/relations-in-the-admin-panel/) cubre las rutas, lo que crea, enlaza, desenlaza o elimina una pestaña, las mismas reglas a través de REST y qué relaciones no se convierten en pestaña.

## Interfaz completa de Relation

`Relation` es una unión cerrada: un miembro por cada `kind`, cada uno con únicamente los
campos que ese tipo posee. No existe combinación de campos que describa dos
enlaces distintos, ni campo que puedas definir que el tipo no utilice.

```typescript
type Relation =
    | BelongsToRelation
    | HasOneRelation
    | HasManyRelation
    | ManyToManyRelation
    | ViaRelation;

interface RelationBase {
    relationName?: string;          // defaults to the property key, then the target's slug
    target: () => CollectionConfig;
    onUpdate?: OnAction;
    onDelete?: OnAction;
    overrides?: Partial<CollectionConfig>;   // applied when rendered as a tab
}
// `required` is not here. It is `validation: { required: true }` on the
// property that declares the relation, the same key every other field uses.

interface BelongsToRelation extends RelationBase {
    kind: "belongsTo";
    localKey?: string;              // column on THIS table
    index?: boolean;                // btree on localKey; defaults to true
}

interface HasOneRelation extends RelationBase {
    kind: "hasOne";
    foreignKeyOnTarget?: string;    // column on the TARGET's table
    sourceKey?: string;             // column on THIS table; defaults to the primary key
}

interface HasManyRelation extends RelationBase {
    kind: "hasMany";
    foreignKeyOnTarget?: string;    // column on the TARGET's table
    sourceKey?: string;             // column on THIS table; defaults to the primary key
}

interface ManyToManyRelation extends RelationBase {
    kind: "manyToMany";
    through?: {
        table?: string;
        sourceColumn?: string;
        targetColumn?: string;
        properties?: Properties;    // extra columns on the junction row, served under `_pivot`
    };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];
}
```

### La forma resuelta

Lo que escribes arriba es la forma de *autoría*. Internamente, Rebase trabaja con
`ResolvedRelation`: el mismo enlace con todos los valores por defecto completados y nada
opcional, más `cardinality`, `targetSlug` y dos indicadores (flags): `writable` (falso
únicamente para un `via` de múltiples saltos o uno con un paso que coincida con alguna de varias condiciones) y `shared` (verdadero cuando las filas de destino pertenecen también a otros padres,
por lo que una eliminación desenlaza en lugar de borrar).

`sourceKey` es la única excepción a "nada opcional": su valor por defecto es la
clave primaria del origen, y resolver eso requiere el esquema del driver, del
cual la resolución no dispone. `undefined` en ese campo significa "la clave primaria" y
nada más.

Nunca escribes directamente un `ResolvedRelation`. En una propiedad de relación, `relation` es
la tuya y `resolvedRelation` es la versión completada, asignada durante la
normalización.

## Próximos pasos

- **[Reglas de seguridad](/docs/collections/security-rules)** — Seguridad a nivel de fila (Row Level Security)
- **[Propiedades](/docs/collections/properties)** — Referencia de tipos de propiedades
