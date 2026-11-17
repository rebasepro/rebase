---
sourceHash: 1090d0be0be163a6
title: Tablas
sidebar_label: Tablas
description: "Declara tablas de Postgres en backend/schema con defineTable: columnas, relaciones y una postura obligatoria de seguridad a nivel de fila. Cada tabla se convierte en SQL, políticas, rutas REST, realtime y MCP, y tipos de SDK."
---

Una tabla se declara una sola vez, en TypeScript, en el directorio `backend/schema/`.
Esa declaración es lo único que el backend sabe sobre tus datos. A partir de ella,
Rebase genera la tabla y sus políticas de seguridad a nivel de fila en Postgres,
sirve la tabla a través de REST, realtime y MCP, y genera los tipos para el SDK.

```ts
// backend/schema/posts.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

export const posts = defineTable("posts", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull().validate({ min: 3, max: 200 }),
        status:      col.enum(["draft", "published", "archived"]).notNull().default("draft"),
        publishDate: col.timestamp({ withTimezone: true }),
        createdAt:   col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
    },
    relations: {
        author: rel.belongsTo(() => users, { notNull: true }),
    },
    rls: [
        { operation: "select", access: "public", condition: { status: "published" } },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] },
    ],
});
```

Hay tres cosas que vale la pena notar de este ejemplo antes que cualquier otra:

- **Las columnas aceptan valores nulos a menos que indiques lo contrario**, como en SQL. `.notNull()`
  hace que una columna sea `NOT NULL` y obligatoria al crearla. Consulta [Columnas](/docs/schema/columns/).
- **La clave foránea se declara mediante la relación.** `author` deriva una
  columna `author_id`, su restricción y su índice. Consulta
  [Relaciones](/docs/collections/relations/).
- **`rls` es obligatorio.** Una tabla sin una postura de seguridad a nivel de fila es un
  error de tipo, y se rechaza cuando se compila el esquema. Consulta
  [Seguridad a nivel de fila](/docs/collections/security-rules/).

:::note[¿Vienes de collections?]
Las tablas reemplazan los archivos `config/collections` de versiones anteriores. El CMS
lee sus valores predeterminados a partir de las tablas; sus propias personalizaciones residen en el
frontend. La guía de actualización de esta versión cubre la migración.
:::

## El directorio `backend/schema`

```text
backend/
├── schema/
│   ├── index.ts      # exports every table and view, and optionally defaultRls
│   ├── users.ts      # defineAuthTable("users", …)
│   ├── posts.ts      # defineTable("posts", …)
│   └── tags.ts       # defineTable("tags", …)
├── functions/
└── crons/
```

Un archivo por tabla es una convención, no una regla. Lo que cuenta es
`backend/schema/index.ts`: el backend lee las tablas y vistas que exporta,
y nada más.

```ts
// backend/schema/index.ts
import type { DefaultRls } from "@rebasepro/server/schema";

export { users } from "./users";
export { posts } from "./posts";
export { tags } from "./tags";

// What every table declared with `rls: "inherit"` takes.
export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" },
];
```

`defaultRls` es opcional. Solo lo leen las tablas que indican
`rls: "inherit"`; un proyecto que nunca escribe `"inherit"` no lo necesita.

El directorio es `backend/schema` a menos que `rebase.json` especifique otro mediante
la clave `tables`. La clave `schema` mantiene su significado anterior: el módulo
Drizzle generado.

```json
{
    "apps": {
        "backend": {
            "type": "backend",
            "runtime": "managed",
            "tables": "backend/schema"
        }
    }
}
```

Un proyecto sin `backend/schema/index.ts` no declara ninguna tabla. El backend
entonces lee las tablas de la base de datos activa al arrancar, y solo sirve aquellas
que tengan habilitada la seguridad a nivel de fila. Consulta [Solo backend](/docs/getting-started/headless/).

Los archivos de esquema son TypeScript puro sin dependencias del servidor:
`@rebasepro/server/schema` no carga nada del servidor. Un frontend puede hacer
`import type { posts } from "../../backend/schema/posts"` para tipar su propio código
contra una tabla, sin incluir código del backend en el bundle del navegador.

## En qué se convierte una tabla

| A partir de la declaración | Rebase genera |
|---|---|
| `columns`, `relations`, `indexes` | el `CREATE TABLE`, claves foráneas, tablas de unión e índices, escritos en `schema.sql` mediante `rebase db push` y `rebase db generate` |
| `rls`, `tenant`, la tabla de autenticación | `ENABLE ROW LEVEL SECURITY` y un `CREATE POLICY` por regla y operación, en `policies.sql` |
| `search`, columnas vectoriales | la columna `tsvector` generada y los índices GIN y ANN |
| el slug | las rutas REST bajo `/api/data/<slug>`, suscripciones realtime, las herramientas MCP y el documento OpenAPI |
| los tipos y modificadores de las columnas | los tipos `Row`, `Insert` y `Update` del SDK, y los [tipos inferidos](/docs/schema/types/) que puedes usar en tu propio código |

Cada interfaz lee la misma forma compilada de la tabla, llamada su
descriptor: columnas con sus tipos de Postgres, nulabilidad, reglas de validación y
almacenamiento, relaciones resueltas a slugs y la postura de seguridad
a nivel de fila. El código de los hooks nunca sale del servidor; el descriptor solo indica qué
hooks existen. El backend sirve los descriptores en `GET /api/schema/tables`,
que es a partir de lo cual renderizan el CMS, el Studio y las aplicaciones MCP.

El flujo desde la declaración hasta la base de datos se describe en
[Esquema como código](/docs/architecture/schema-as-code/).

## Opciones de `defineTable`

`defineTable(name, config)` toma el nombre de la tabla y estas claves:

| Clave | Qué hace |
|---|---|
| `columns` | **Obligatorio.** Constructores `col.*` por clave, en orden físico. Al menos uno debe ser `.primaryKey()`. Consulta [Columnas](/docs/schema/columns/). |
| `rls` | **Obligatorio.** `"admin-only"`, `"inherit"`, o una lista no vacía de reglas. Consulta [Seguridad a nivel de fila](/docs/collections/security-rules/). |
| `relations` | Constructores `rel.*` por nombre de relación. Consulta [Relaciones](/docs/collections/relations/). |
| `slug` | El nombre en la API, el SDK y en los scopes. Es el nombre de la tabla si se omite. |
| `table` | El nombre de la tabla SQL, cuando difiere del nombre. |
| `schema` | El esquema de Postgres. `public` si se omite. |
| `database` | Una base de datos Postgres no predeterminada, declarada en `backend/resources.ts`. Consulta [Múltiples orígenes](/docs/backend/multiple-sources/). |
| `description` | Lo que contiene la tabla. Se muestra en OpenAPI y en las descripciones de herramientas MCP. |
| `defaultPolicies` | `false` genera solo tus reglas, sin las políticas base de administrador. Rechazado con `rls: "admin-only"`. `true` mantiene la base cuando la base de datos de la tabla la desactiva para todas las tablas (`database({ rls: { defaultPolicies: false } })`). Si se omite, la configuración de la base de datos decide. |
| `rlsRequired` | `false` sirve la tabla incluso cuando la base de datos no aplica su `rls` (seguridad a nivel de fila desactivada, políticas declaradas faltantes), para un esquema propiedad de otra herramienta y una aplicación que aplica el acceso por sí misma. `true` lo requiere bajo una base de datos que especifica `database({ rls: { required: false } })`. Si se omite, la configuración de la base de datos decide, y una tabla que la base de datos no protege no se sirve en un arranque que no aprovisiona nada. Consulta [Otra herramienta es propietaria del esquema](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access). |
| `tenant` | Delimita cada fila a un tenant. Consulta [Tenencia](/docs/collections/tenancy/). |
| `softDelete` | `true` o `{ field }`: un borrado estampa una marca de tiempo en lugar de eliminar la fila. Consulta [Borrado suave](/docs/collections/soft-delete/). |
| `history` | `true` registra cada escritura en la tabla de historial. Consulta [Historial de entidades](/docs/backend/history/). |
| `search` | Búsqueda de texto completo clasificada sobre las columnas indicadas. Consulta [Búsqueda](/docs/backend/search/). |
| `indexes` | Índices, cada uno con la consulta a la que sirve. Consulta [Índices](/docs/backend/indexes/). |
| `hooks` | Hooks de ciclo de vida del lado del servidor. Consulta [Hooks de tabla](/docs/collections/callbacks/). |
| `strictWrites` | Una escritura que nombra una columna que la tabla no declara devuelve un 400. `false` la acepta, para una columna que existe en la base de datos sin estar declarada (llenada por un disparador, por ejemplo). La columna aún debe existir. |
| `metadata` | Cualquier dato que desees que se sirva con el descriptor de la tabla. Rebase no lo lee. |

Otras dos definiciones comparten la mayoría de estas claves:
[`defineAuthTable`](/docs/schema/auth-table/) para la tabla donde se almacenan
los usuarios, y [`defineView`](/docs/collections/views/) para vistas SQL.

## Nombres

El primer argumento de `defineTable` es el nombre de la tabla, y es el valor predeterminado
para todo lo demás:

| Nombre | Predeterminado | Anulación |
|---|---|---|
| Tabla SQL | el nombre | `table: "blog_posts"` |
| Slug de API, descriptor de acceso SDK, objetivo de scope | el nombre | `slug: "articles"` |
| Esquema de Postgres | `public` | `schema: "content"` |
| Columna SQL de una columna | el snake_case de su clave | el primer argumento del constructor: `col.text("legacy_name")` |

La clave de una columna es su nombre en la fila JSON, en el SDK y en los filtros y
ordenaciones. Su nombre en SQL es el snake_case de la clave: `publishDate` es la columna
`publish_date`, y `photoURL` es `photo_url`. El primer argumento de un constructor mapea
una clave a cualquier otro nombre SQL, como en Drizzle (`col.text("legacy_name")`), que
es cómo una tabla adopta los nombres de una base de datos existente sin cambiar lo que
ven los clientes.

`table` y `schema` deben ser identificadores SQL válidos. Dos definiciones no pueden
compartir un nombre, un slug o una tabla SQL. El slug importa más allá de la URL: los nombres
de las claves foráneas y de las columnas de unión se derivan de él, por lo que cambiar el slug
de una tabla que ya está desplegada puede renombrar columnas. Establece `slug` explícitamente cuando
deba diferir del nombre de la tabla y no lo modifiques después.

## Claves primarias

No hay una columna `id` implícita. Cada tabla marca al menos una columna
como `.primaryKey()`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const invoices = defineTable("invoices", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        number: col.integer().notNull().unique(),
    },
    rls: "admin-only",
});

// Several key columns form a composite key, in declaration order.
export const dailyStats = defineTable("daily_stats", {
    columns: {
        siteId: col.uuid().primaryKey(),
        day:    col.date().primaryKey(),
        views:  col.integer().notNull().default(0),
    },
    rls: "admin-only",
});
```

Una columna clave es `NOT NULL` por definición. Una clave `uuid` generalmente toma
`.defaultRandom()`; una clave de entero toma `.generatedByDefaultAsIdentity()`. Una clave sin un
valor predeterminado la proporciona quien realiza la llamada al momento de la creación. Una columna clave no puede ser
`.private()`, y no puede ser un `timestamptz` o `time`.

## Cuándo se rechaza una definición

Un esquema que dejaría una tabla desprotegida o inservible nunca llega a la
base de datos. Se rechaza en tres puntos:

1. **En el editor.** `rls` y `columns` son requeridos por los tipos, y
   `rls: []` no es una postura válida. Un campo de `tenant` o `softDelete`, o una
   columna de índice escrita como una clave simple, que no nombre ninguna columna es un error de tipo.
2. **Al cargar el módulo.** `defineTable` arroja un error en una tabla sin columnas,
   una columna que no sea un constructor `col.*`, una relación que no sea el resultado
   de `rel.*`, una relación con la misma clave que una columna o un `rls` no utilizable. Esto
   también detecta código JavaScript y conversiones de tipo que los tipos no pueden ver.
3. **Al compilar el esquema.** `rebase db generate`, `rebase db push`,
   `rebase doctor` y el arranque del servidor compilan todas las tablas juntas y se detienen con
   un `SchemaDefinitionError` que enumera cada problema, cada uno con la tabla, la
   columna o relación, y qué escribir en su lugar:

```text
The schema cannot be used (2 problems):
  - posts: the table has no primary key. Mark a column `.primaryKey()` — e.g. `id: col.uuid().primaryKey().defaultRandom()`; several make a composite key in declaration order.
  - comments: `rls: "inherit"` takes the project's `defaultRls`, and none was given. Export `defaultRls` from backend/schema/index.ts (`"admin-only"` or a list of rules), or write this table's own `rls`.
```

El paso de compilación verifica lo que necesita evaluar todas las tablas a la vez: los destinos de las relaciones y
sus tipos de clave, tablas de unión que ambas relaciones reclaman, slugs y nombres SQL
que colisionan (incluidos los nombres que colisionan una vez que Postgres los trunca a 63
bytes), reglas que nombran una columna que la tabla no tiene, e `"inherit"`
sin un `defaultRls`. Una tabla exportada desde un archivo junto a `index.ts` pero no
desde el propio `index.ts` también se rechaza: el índice es la lista de tablas.

## Próximos pasos

- [Columnas](/docs/schema/columns/): cada constructor y modificador `col.*`
- [Documentos JSON](/docs/schema/json/): `jsonb` tipado y validado con `json.*`
- [Relaciones](/docs/collections/relations/): los cinco tipos de `rel.*`
- [Seguridad a nivel de fila](/docs/collections/security-rules/): la postura de `rls` y sus reglas
- [Hooks de tabla](/docs/collections/callbacks/): hooks de ciclo de vida del lado del servidor
- [Inferencia de tipos](/docs/schema/types/): `InferRow`, `InferInsert` e `InferUpdate`
