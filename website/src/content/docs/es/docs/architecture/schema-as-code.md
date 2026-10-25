---
sourceHash: d55621114a4225a1
title: Esquema como Código
sidebar_label: Esquema como Código
description: Cómo Rebase utiliza colecciones de TypeScript como la única fuente de verdad para el esquema de su base de datos, UI y API.
---

## La Idea Principal

En Rebase, sus **definiciones de colección de TypeScript son la única fuente de verdad**. A partir de un conjunto de objetos TypeScript, Rebase genera:

- **Tablas PostgreSQL** a través de la generación de esquemas Drizzle ORM
- **UI CRUD** — formularios, tablas, validación, tipos de campo
- **Endpoints de API REST** con filtrado, ordenación y paginación
- **SDK tipado** — operaciones de datos con seguridad de tipos
- **Políticas RLS** — Seguridad a Nivel de Fila en Postgres

Esto significa que su esquema es:
- **Controlado por versiones** — cada cambio es un commit de git
- **Con seguridad de tipos** — TypeScript detecta errores en tiempo de compilación
- **Revisable** — los cambios de esquema pasan por pull requests
- **Portátil** — la misma definición funciona en frontend, backend y CLI

## Edición Visual con Manipulación de AST

Rebase también proporciona un **editor visual de colecciones** en modo Studio. Cuando un no-desarrollador utiliza el editor visual para añadir un campo:

1. El Studio **no** modifica directamente la base de datos
2. En su lugar, utiliza [ts-morph](https://ts-morph.com/) para analizar su archivo fuente TypeScript como un AST
3. Inserta la nueva definición de propiedad precisamente en el bloque `properties`
4. **Todo el código existente, callbacks y lógica personalizada se conservan intactos**
5. El archivo se guarda, lo que activa la recarga en caliente

Este enfoque de "UI como Generador de Código" significa que las ediciones visuales producen el mismo TypeScript limpio que un desarrollador escribiría a mano.

## Pipeline de Generación de Esquemas

Tus colecciones se leen una vez y se emiten dos — como un esquema Drizzle a
través del cual consulta el servidor en ejecución, y como SQL que describe la
base de datos que querías tener. Es a ese SQL al que se ajusta la base de datos,
mediante [Atlas](https://atlasgo.io), que compara tu esquema deseado con el
existente y planifica el cambio:

```
                        Collections (TypeScript)
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
   rebase schema generate                   (db push and db generate write
            │                               the SQL below on every run, into
            ▼                               .rebase/sql/, which is not committed)
  backend/src/schema.generated.ts                       │
  the Drizzle schema the runtime                        ▼
  reads and writes rows through             schema.sql              ← Atlas's desired state
                                            policies.sql            ← RLS, applied separately
                                            search.sql, vector.sql, ← Atlas cannot manage these
                                            triggers.sql
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   rebase db push              rebase db generate
                                   Atlas plans the diff        Atlas writes the diff
                                   and applies it now          to drizzle/migrations/
                                          │                           │
                                          │                           ▼
                                          │                    rebase db migrate
                                          │                    applies them in order
                                          └─────────────┬─────────────┘
                                                        ▼
                                                  PostgreSQL
```

`db push` es el ciclo de desarrollo; `db generate` + `db migrate` es el
revisable, y el que debes usar en producción. Ambos pasan por el mismo SQL
generado, así que no pueden discrepar sobre lo que significan tus colecciones, y
ambos lo vuelven a escribir a partir de las colecciones antes de leerlo, así que
no hay ninguna copia en tu repositorio que pueda quedarse desactualizada. Lo que
versionas son las migraciones. Consulta
[Generación de Esquemas](/docs/cli/schema) para ver todos los flags.

### Ejemplo

Dada esta colección:

<!-- schema-sample: collection -->
```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    table: "products",
    properties: {
        name: { type: "string", name: "Name", validation: { required: true } },
        price: { type: "number", name: "Price", columnType: "numeric" },
        active: { type: "boolean", name: "Active", defaultValue: true },
        createdAt: { type: "date", name: "Created", autoValue: "on_create" }
    }
});
```

Rebase genera este esquema Drizzle: el archivo completo, con la columna `id`, las políticas predeterminadas y todo:

<!-- schema-sample: drizzle -->
```typescript
// schema.generated.ts
// This file is auto-generated by the Rebase Drizzle generator. Do not edit manually.

import { boolean, numeric, pgPolicy, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { relations as drizzleRelations, sql } from 'drizzle-orm';


export const products = pgTable("products", {
    name: text("name").notNull(),
    price: numeric("price"),
    active: boolean("active").default(sql`TRUE`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`now()`),
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`)
}, (table) => ([
    pgPolicy("products_default_admin_read", { as: "permissive", for: "select", to: ["public"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_insert", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_update", { as: "permissive", for: "update", to: ["public"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))`, withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_delete", { as: "permissive", for: "delete", to: ["public"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
])).enableRLS();

export const tables = { products };
export const enums = {  };
export const relations = {  };
```

Hay tres cosas ahí que merece la pena leer dos veces. La columna `id` que no
declaraste: toda colección recibe una clave primaria `text` a menos que una
propiedad declare `isId`, y la base de datos la rellena con un uuid
(`gen_random_uuid()::text`), de modo que una fila creada desde el panel de
administración, la API REST o el SDK no necesita una clave propia. Una clave
que sí envías se usa tal cual. En la 0.23 la columna no tiene valor por
defecto, y una creación que no envía clave falla. El bloque `pgPolicy`: la seguridad a nivel de
fila está habilitada en todas las tablas, y esas políticas base son las que
permiten que el contexto de servidor de confianza y el rol `admin` puedan
leerla en cualquier caso — consulta
[Reglas de seguridad](/docs/collections/security-rules). Y `active`, que lleva
el `defaultValue` que escribiste como un valor por defecto de **columna**: un
`defaultValue` literal se compila a un `DEFAULT` real, así que una fila
insertada por la API REST, un script de siembra o `psql` también lo recibe, no
solo una escrita desde el panel de administración. Un valor por defecto de
tipo `reference` o `vector` no es un literal de columna y se mantiene como un
valor de la capa de aplicación.

Lo que produce este SQL:

<!-- schema-sample: sql -->
```sql
-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.

CREATE SCHEMA IF NOT EXISTS "rebase";

CREATE TABLE "public"."products" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "price" NUMERIC,
  "active" BOOLEAN DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

Policies, search columns, vector indexes and `updated_at` triggers are written to
files of their own and applied by the CLI in their own right — Atlas manages
none of the four.

## Seguridad y Objetos de Base de Datos no Mapeados

Cuando Rebase actualiza el esquema de la base de datos, mapea las definiciones de colección de TypeScript a las tablas de la base de datos. Para garantizar que **los objetos de base de datos no mapeados (por ejemplo, tablas, vistas, enumeraciones) nunca se eliminen ni modifiquen**, Rebase implementa varias capas de seguridad:

1. **Exclusión de tablas sin mapear**: Antes de cada push, la CLI lista todas las tablas y vistas de la base de datos y le pasa a Atlas un `--exclude` por cada una que no respalde ninguna colección (ni sea la tabla de unión de una colección), de modo que Atlas nunca planifica un cambio sobre ella. Si no se puede leer la base de datos, el push se aborta en lugar de ejecutarse con una lista parcial.
2. **Esquemas que Rebase posee**: El esquema `rebase` (tablas de autenticación, funciones auxiliares de RLS, la tabla de revisiones de Atlas) y cualquier esquema `auth` se excluyen por completo, de modo que un push nunca puede planificar un `DROP SCHEMA … CASCADE`.
3. **Objetos que Atlas no puede modelar**: Las columnas de búsqueda, los índices vectoriales y los triggers también se excluyen de Atlas, y se aplican desde sus propios archivos generados.
4. **Barrera para cambios destructivos**: `rebase db push` primero ejecuta el plan en modo de simulación. Una sentencia que destruye datos (una columna o tabla eliminada, un cambio de tipo con pérdida) detiene el push: en un terminal te pide que escribas `yes`, y sin uno (CI, scripts, agentes) se niega a menos que pases `--allow-destructive`.
5. **Propiedad de los Índices por Nombre**: Los índices son el único objeto que vive *sobre* una tabla mapeada, así que el filtrado de tablas no puede protegerlos — y un push planificaba `DROP INDEX` para cualquier índice ausente del estado deseado, es decir, para todos los escritos a mano. Ahora Rebase nombra los índices que genera `<table>_<columns>_ix_<7 hex>` (`_ux_` cuando son únicos), una forma que ningún otro generador de nombres produce aquí, y excluye del diff todo lo demás por su nombre. Un índice que escribiste a mano, o que llegó por introspección, nunca se toca; una declaración que borras sigue eliminando su índice, que es la intención. Consulta **[Índices](/docs/backend/indexes)**.

## Siguientes Pasos

- **[Colecciones](/docs/collections)** — Referencia completa de la configuración de colecciones
- **[Propiedades](/docs/collections/properties)** — Mapeos detallados de tipos de columna
- **[Índices](/docs/backend/indexes)** — Declarar los índices que necesitan tus consultas
