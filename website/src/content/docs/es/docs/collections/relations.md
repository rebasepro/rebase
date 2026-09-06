---
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

Puedes definir la relación directamente en la propiedad. El framework las extrae automáticamente al array `relations[]` de la colección en el momento de la normalización, por lo que ya no necesitas una entrada `relations[]` separada para las propiedades.

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
                target: () => usersCollection,
                localKey: "author_id"
            }
        }
    }
});
```

### 2. Array de Relaciones Explícito

Para casos de uso avanzados o cuando una relación no se mapea directamente a un campo de formulario, puedes definirla en el array `relations`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { type: "string", name: "Title" },
        content: { type: "string", name: "Content", admin: { multiline: true } },
        author: { type: "relation", name: "Author", relationName: "author" }
    },
    relations: [
        {
            kind: "belongsTo",
            relationName: "author",
            target: () => usersCollection,
            localKey: "author_id"
        }
    ]
});
```

## Tipos de Relación

### Uno a Uno / Muchos a Uno

Una clave foránea en **esta** tabla apunta a la clave primaria de otra tabla.

```typescript
relations: [
    {
        kind: "belongsTo",           // The FK is on THIS table
        relationName: "author",
        target: () => usersCollection,
        localKey: "author_id"        // Column on the posts table
    }
]
```

Esto crea: `posts.authorId → users.id`

### Uno a Muchos (Inversa)

La clave foránea está en la tabla **objetivo**, apuntando de vuelta a esta entidad.

```typescript
// On the Users collection:
relations: [
    {
        kind: "hasMany",                 // The FK is on the TARGET table
        relationName: "posts",
        target: () => postsCollection,
        foreignKeyOnTarget: "authorId"  // Column on the posts table
    }
]
```

### Muchos a Muchos (Tabla de Unión)

Dos colecciones conectadas a través de una tabla de unión intermedia.

```typescript
// On the Users collection:
relations: [
    {
        kind: "manyToMany",
        relationName: "roles",
        target: () => rolesCollection,
        through: {
            table: "user_roles",         // Junction table name
            sourceColumn: "userId",     // FK to this collection
            targetColumn: "role_id"      // FK to target collection
        }
    }
]
```

Esto crea:
```sql
CREATE TABLE user_roles (
    userId INTEGER REFERENCES users(id),
    role_id INTEGER REFERENCES roles(id),
    PRIMARY KEY (userId, role_id)
);
```

## Propiedades de Relación

Para renderizar un campo de relación en un formulario, añade una propiedad con `type: "relation"`:

```typescript
properties: {
    author: {
        type: "relation",
        name: "Author",
        target: () => usersCollection, // Target collection
        widget: "select"           // "select" (dropdown) or "dialog" (full picker)
    }
}
```

![Campo de relación en formulario](/img/features/relation-form-field.png)

Al renderizar una previsualización (como en una celda de tabla o un chip de referencia), Rebase maneja la hidratación automáticamente:

![Previsualización de relación en tabla](/img/features/relation-table-preview.png)

## Uniones Multi-salto

Para relaciones complejas que atraviesan múltiples tablas, usa `joinPath`:

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
                on: { from: "id", to: "userId" }
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
const { data } = await client.data.articles
    .include("author")
    .find();

for (const article of data) {
    // Scalar FK — always present
    article.values.authorId;     // "uuid-1234"

    // Hydrated relation — only present when included
    article.values.author?.name;  // "Jane Doe"
}
```

> Los nombres de relación pasados a `include()` deben coincidir con el `relationName` definido en el array `relations` de la colección.

Para la referencia completa del constructor de consultas (filtrado, ordenación, paginación, en tiempo real), consulta la [documentación del SDK del Cliente](/docs/sdk).

## Interfaz Completa de Relación

```typescript
type Relation =
    | BelongsToRelation
    | HasOneRelation
    | HasManyRelation
    | ManyToManyRelation
    | ViaRelation;

// Every kind carries these:
interface RelationBase {
    relationName?: string;
    target: () => CollectionConfig;
    inverseRelationName?: string;
    onUpdate?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    onDelete?: "cascade" | "restrict" | "no action" | "set null" | "set default";
    overrides?: Partial<CollectionConfig>;
}

// ...and only the fields its own kind uses:
interface BelongsToRelation extends RelationBase {
    kind: "belongsTo";
    localKey?: string;              // column on THIS table
}

interface HasOneRelation extends RelationBase {
    kind: "hasOne";
    foreignKeyOnTarget?: string;    // column on the TARGET table
}

interface HasManyRelation extends RelationBase {
    kind: "hasMany";
    foreignKeyOnTarget?: string;    // column on the TARGET table
}

interface ManyToManyRelation extends RelationBase {
    kind: "manyToMany";
    through?: {
        table?: string;
        sourceColumn?: string;      // FK naming THIS collection
        targetColumn?: string;
    };
}

interface ViaRelation extends RelationBase {
    kind: "via";
    cardinality: "one" | "many";    // a join chain cannot imply it
    joinPath: JoinStep[];           // read-only
}
```

## Próximos Pasos

- **[Reglas de Seguridad](/docs/collections/security-rules)** — Seguridad a Nivel de Fila
- **[Propiedades](/docs/collections/properties)** — Referencia de tipos de propiedad
---
