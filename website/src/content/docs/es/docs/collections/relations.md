---
sourceHash: b8fb2609d1a27893
title: Relaciones
sidebar_label: Relaciones
description: Define relaciones SQL uno a uno, uno a muchos y muchos a muchos entre colecciones con claves foráneas, tablas de unión y uniones multi-salto.
---

## Overview

Las relaciones definen cómo las colecciones están conectadas a nivel de base de datos. Permiten a Rebase:

- Renderizar **campos selectores de relación** en formularios de entidad
- Resolver **entidades relacionadas** al mostrar previsualizaciones
- Generar **restricciones de clave foránea** en el esquema Drizzle
- Soportar comportamientos de **eliminación/actualización en cascada**

Las relaciones se pueden definir directamente dentro de la propiedad, o explícitamente en el array `relations` de una colección:

### 1. Relaciones en Línea (Recomendado)

Declara el enlace en la propiedad, anidado bajo `relation`. Elige el `kind` y el
tipo ofrece exactamente los campos que ese kind necesita.

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

### 2. Array de Relaciones Explícito

Para un enlace sin propiedad propia — nada por lo que nombrarlo en el formulario
ni en una columna de la tabla — decláralo en `relations`:

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

## Los cinco kinds

Una relación es de uno de cinco kinds. El kind decide dónde vive la clave, si
vuelve una fila o muchas, y qué puede tocar una escritura a través de ella.

| Kind | La clave vive | Devuelve | Notas |
|---|---|---|---|
| `belongsTo` | en **esta** tabla | una | `localKey`, por defecto `<relationName>_id` |
| `hasOne` | en la tabla del **destino** | una | `foreignKeyOnTarget`, por defecto `<thisCollection>_id` |
| `hasMany` | en la tabla del **destino** | muchas | los hijos pertenecen solo a este padre |
| `manyToMany` | en una **tabla de unión** | muchas | las filas se comparten; tuyo es el enlace |
| `via` | un `joinPath` explícito | cualquiera | de solo lectura; indica tú mismo la `cardinality` |

Todos los campos son opcionales salvo `kind` y `target` — el resto se deriva.

### belongsTo — la clave está en esta tabla

```typescript
author: {
    type: "relation",
    name: "Author",
    relation: { kind: "belongsTo", target: () => usersCollection }
}
// → posts.author_id
```

### hasMany / hasOne — la clave está en la suya

```typescript
relations: [
    { kind: "hasMany", relationName: "posts", target: () => postsCollection }
]
// → reads posts.user_id
```

`hasOne` es el mismo enlace con como mucho una fila al otro lado.

#### Unir por una clave natural

Por defecto, la clave foránea del destino guarda el **id** de la fila de origen.
Cuando los dos lados se unen por otra cosa — un id de identidad externa, un SKU,
un slug de inquilino — nombra esa columna con `sourceKey`:

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

`sourceKey` es el espejo de `localKey` en `belongsTo`: aquel nombra la columna
de la que lee este lado, este nombra la columna a la que apunta el otro. Sin él,
un enlace como el anterior no es expresable como `hasMany` en absoluto y tiene
que bajar a [`via`](#via--una-cadena-de-joins-explícita), que es de solo
lectura.

La columna tiene que ser única. Un enlace que direcciona más de una fila de
origen no puede decir a cuál pertenece una fila relacionada, y Postgres tampoco
acepta una clave foránea contra una columna no única. Rebase lo comprueba en el
momento de la lectura y se niega en lugar de elegir una.

Un padre cuyo `sourceKey` es `NULL` no alcanza ninguna fila, y escribir a través
de la relación es un error — no hay nada a lo que las filas relacionadas puedan
apuntar.

### manyToMany — a través de una tabla de unión

```typescript
tags: {
    type: "relation",
    name: "Tags",
    relation: { kind: "manyToMany", target: () => tagsCollection }
}
// → junction `posts_tags` (both table names, sorted), columns post_id / tag_id
```

Ambos lados declaran el suyo, y cada uno escribe `through` **desde su propio
punto de vista** — `sourceColumn` siempre nombra a *esta* colección:

```typescript
// on posts
{ kind: "manyToMany", relationName: "tags", target: () => tagsCollection,
  through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" } }

// on tags
{ kind: "manyToMany", relationName: "posts", target: () => postsCollection,
  through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" } }
```

### via — una cadena de joins explícita

Para enlaces que las cuatro formas anteriores no pueden expresar: rutas de
varios saltos, claves compuestas o un join cuya condición no es una clave
foránea simple. De solo lectura — Rebase no va a inferir cómo escribir a través
de una cadena arbitraria.

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

## Propiedades de Relación

Para renderizar un campo de relación en un formulario, añade una propiedad con `type: "relation"`:

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        relation: { kind: "belongsTo", target: () => usersCollection },
        widget: "select"           // "select" (dropdown) or "dialog" (full picker)
    }
}
```

Al renderizar una previsualización (como en una celda de tabla o un chip de referencia), Rebase maneja la hidratación automáticamente.

### Una relación a uno tiene selector; muchas, una pestaña

La cardinalidad decide la superficie, y solo se usa una:

- **`belongsTo` / `hasOne`** — una fila, así que la propiedad es una clave
  foránea que el autor edita. Se renderiza como el selector de arriba.
- **`hasMany` / `manyToMany`** — muchas filas, así que la vista de entidad las
  lista en una **pestaña** propia. La propiedad no se renderiza en el
  formulario: los hijos de una colección son una lista, no un valor que el
  registro guarde, y seleccionarlos de un desplegable no es algo que el
  formulario pueda ofrecer con sentido.

Declarar una relación a muchos como propiedad sigue mereciendo la pena: es lo
que da nombre a la pestaña, y lo que le da a la relación una columna en la tabla
de la colección, que la carga del listado hidrata para que las filas hijas
aparezcan como chips en la fila. Solo se descarta el campo del formulario.

En la tabla, una relación con propiedad propia obtiene **una** columna: la suya.
Cada pestaña tiene además una columna con un botón de salto a la pestaña, pero
en una relación declarada como propiedad ese botón repetía el mismo encabezado
junto a una columna que ya mostraba los hijos, así que se descarta. Oculta la
columna de la relación (`admin: { hideFromCollection: true }`) y el botón
vuelve, de modo que la relación nunca desaparece del todo de la tabla.

Si aun así quieres el selector en línea, pídelo:

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

## Uniones Multi-salto

Para relaciones que atraviesan varias tablas, usa `kind: "via"` con un
`joinPath`. Son de solo lectura: Rebase no va a inferir cómo escribir a través
de una cadena arbitraria.

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

### Uniones de Clave Compuesta

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

## Reglas de Cascada

Controla qué sucede cuando las entidades relacionadas son actualizadas o eliminadas:

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
| `"restrict"` | Prevenir la operación si existen filas relacionadas |
| `"no action"` | Igual que restrict (posponer a la verificación de restricción) |
| `"set null"` | Establecer la columna FK a NULL |
| `"set default"` | Establecer la columna FK a su valor predeterminado |

### Qué obtienes si no dices nada

<span class="since-badge" data-since="0.18">Since 0.18</span>

El valor predeterminado de un `belongsTo` **obligatorio** ha cambiado. En 0.17.3
es `ON DELETE CASCADE` — borrar un padre borra sus hijos — y a partir de 0.18 es
`RESTRICT`, así que el borrado falla y nombra la restricción. El resto de esta
sección no cambia, y `db push` planifica la reescritura de la restricción al
actualizar.

`onDelete` es opcional, así que la mayoría de las relaciones nunca lo nombran. El
valor predeterminado depende de si la relación es obligatoria:

| Relación | `onDelete` predeterminado |
|--------|----------|
| `belongsTo`, opcional | `"set null"` — el puntero se vacía |
| `belongsTo`, `validation: { required: true }` | `"restrict"` — el borrado del padre falla |
| `manyToMany` (filas de unión) | `"cascade"` — se va el enlace, la fila destino se queda |

Una relación obligatoria **no** es una cascada. `required` dice que un hijo no
puede existir sin un padre; no dice que borrar el padre deba destruir al hijo.
Son afirmaciones distintas, y solo una de ellas elimina filas que no nombraste.
Por eso el valor predeterminado hace fallar el borrado y nombra la restricción, y
`"cascade"` es algo que pides explícitamente:

```typescript
{
    kind: "belongsTo",
    relationName: "order",
    target: () => ordersCollection,
    // Una línea de pedido no significa nada sin su pedido: dilo.
    onDelete: "cascade"
}
```

`onUpdate` no tiene valor predeterminado: sin nada definido, Postgres aplica `NO
ACTION`. Usa `"cascade"` cuando la clave del destino sea algo que una persona
pueda editar — un slug, un SKU — para que los punteros la sigan.

## Obtención de Relaciones en el SDK

Al consultar datos a través del SDK del Cliente Rebase, las relaciones **no** se incluyen por defecto. Usa el método `include()` para solicitar entidades relacionadas junto con los datos primarios.

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

Cuando se incluye, la respuesta contiene tanto la **clave foránea escalar** como el **objeto de relación hidratado**:

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

> Los nombres de relación pasados a `include()` deben coincidir con el `relationName` definido en el array `relations` de la colección.

Para la referencia completa del constructor de consultas (filtrado, ordenación, paginación, en tiempo real), consulta la [documentación del SDK del Cliente](/docs/sdk).

## Relaciones en el panel de administración

Toda relación a muchos — `hasMany`, `manyToMany` o un `via` a muchos — se
convierte en una **pestaña** bajo un registro del panel de administración, que
lista las filas que ese registro alcanza.

### El segmento de ruta es el nombre de la relación

Una lista de hijos se direcciona como `parent/parentId/relationName`:

```
/c/authors/a-1/posts          the posts of author a-1
/c/posts/p-1/tags             the tags of post p-1
```

El último segmento es el **nombre de la relación**, no el slug de la colección
destino. A menudo coinciden, porque una relación sin nombre toma el slug de su
destino — pero una propiedad de relación en línea toma la *clave de la
propiedad*:

```typescript
properties: {
    featuredTags: {
        type: "relation",
        relation: { kind: "manyToMany", target: () => tagsCollection }
    }
}
// tab and path segment: featuredTags   (not "tags")
```

Esto es también lo que hace que funcionen dos relaciones a la misma colección:
cada una tiene su propio nombre, así que cada una tiene su pestaña y su ruta.

### Filas propias frente a filas compartidas

Lo que una pestaña te deja hacer depende de cómo se almacena la relación, porque
los dos casos significan cosas distintas:

| | Uno a muchos (`foreignKeyOnTarget`) | Muchos a muchos (`through`) |
|---|---|---|
| El hijo pertenece a | solo a este padre | a todos los padres que lo enlazan |
| Crear | crea la fila bajo este padre | crea la fila y la enlaza |
| Añadir existente | — | enlaza una fila existente |
| Quitar | **borra** la fila | **desenlaza**; la fila queda intacta |

El panel de administración renderiza cada caso en consecuencia: una pestaña de
muchos a muchos ofrece **Añadir existente** y **Quitar de este registro**, y
nunca un borrado que arrancaría la fila a los demás padres.

### Las mismas reglas sobre REST

Las listas de hijos son consultas de colección normales restringidas a un padre,
así que aceptan todo lo que acepta una lista raíz — filtros, `orderBy`, `limit`,
`offset`, `include` — y `meta.total` cuenta las filas filtradas. Filtra por campo
(`?field=op.value`) o con un objeto completo `?where={"field":["op","value"]}`;
ambos llegan a la misma consulta:

```
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

El segmento del padre se impone, no es decorativo. Direccionar una fila que no
está bajo ese padre devuelve `404`, y `PATCH` nunca mueve una fila de un padre a
otro — define la clave foránea explícitamente si eso es lo que quieres.

En un muchos a muchos, `PATCH parent/id/child/childId` es *pertenencia al
conjunto*: enlaza la fila si aún no lo está, y es idempotente. Así es como
adjuntas una fila que ya existe.

### Qué no se convierte en pestaña

- **Relaciones a uno** — son un campo del registro, no una lista. Escribir a
  través de una ruta a uno se rechaza: la clave foránea vive en la tabla del
  padre.
- **Relaciones declaradas dentro de un `map`** — son un campo de ese map.

## Interfaz Completa de Relación

`Relation` es una unión cerrada — un miembro por kind, cada uno con solo los
campos que ese kind tiene. No hay ninguna combinación de campos que describa dos
enlaces distintos, ni ningún campo que puedas definir y que el kind no use.

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
    through?: { table?: string; sourceColumn?: string; targetColumn?: string };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];
}
```

### La forma resuelta

Lo que escribes arriba es la forma de *autoría*. Internamente Rebase trabaja con
`ResolvedRelation`: el mismo enlace con todos los valores por defecto rellenos y
nada opcional, más `cardinality`, `targetSlug` y dos banderas — `writable`
(falsa solo para `via`) y `shared` (cierta cuando las filas destino pertenecen
también a otros padres, de modo que quitar desenlaza en vez de borrar).

`sourceKey` es la única excepción a «nada opcional»: su valor por defecto es la
clave primaria del origen, y resolver eso necesita el esquema del driver, que la
resolución no tiene. Ahí `undefined` significa «la clave primaria» y nada más.

Nunca escribes una `ResolvedRelation`. En una propiedad de relación, `relation`
es tuya y `resolvedRelation` es la versión rellena, estampada durante la
normalización.

## Próximos Pasos

- **[Reglas de Seguridad](/docs/collections/security-rules)** — Seguridad a Nivel de Fila
- **[Propiedades](/docs/collections/properties)** — Referencia de tipos de propiedad

---
