---
sourceHash: 507990241e43f026
title: Esquema como código
sidebar_label: Esquema como código
description: Cómo Rebase utiliza las tablas de TypeScript en backend/schema como la única fuente de verdad para el esquema de su base de datos, API, SDK y panel de administración.
---

## La idea central

<span class="since-badge" data-since="0.31">Desde 0.31</span>

En Rebase, las **tablas que declara con `defineTable` en `backend/schema/` son la única fuente de verdad**. A partir de ellas, Rebase genera:

- **Tablas de PostgreSQL** mediante la generación de esquemas de Drizzle ORM
- **Políticas RLS** — Seguridad a nivel de fila (Row Level Security) en Postgres, a partir del `rls` requerido de cada tabla
- Endpoints de **API REST** con filtrado, ordenamiento y paginación, además de tiempo real y MCP
- **SDK tipado** — operaciones de datos con seguridad de tipos (type-safe)
- **Los valores predeterminados del panel de administración** — formularios, listas, validación y tipos de campo, renderizados a partir de los descriptores de tabla que el backend entrega en `GET /api/schema/tables`; lo que el panel muestra más allá de estos reside en `frontend/src/cms/`

Esto significa que su esquema es:
- **Controlado por versiones**: cada cambio es un commit de git
- **Seguro en tipos (type-safe)**: TypeScript detecta errores en tiempo de compilación
- **Revisable**: los cambios de esquema pasan por pull requests
- **Portable**: la misma definición es leída por el backend, la CLI, el generador de SDK y, como tipos, el frontend

## Edición visual con manipulación de AST

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Rebase también proporciona un **editor visual de esquemas** en Studio. Cuando alguien lo utiliza para agregar una columna:

1. Studio **no** modifica directamente la base de datos
2. En su lugar, envía la edición como un `TablePatch`, y el servidor utiliza [ts-morph](https://ts-morph.com/) para analizar el archivo de la tabla en `backend/schema/` como un AST
3. Inserta el nuevo constructor `col.*` con precisión en el bloque `columns`
4. **Todo el código existente, hooks y lógica personalizada se conservan intactos**; se rechaza cualquier edición que afecte a código que no deba reescribir
5. El archivo se guarda, lo que activa la recarga en caliente (hot reload)

Cómo se *ve* una tabla en el panel no forma parte de esto: las etiquetas, iconos y vistas se guardan como preferencias del panel o se escriben en `frontend/src/cms/`. Consulte [Edición de esquemas en vivo](/docs/backend/live-schema-editing/) para conocer las ediciones y lo que el editor rechaza.

Este enfoque de "UI como generador de código" significa que las ediciones visuales producen el mismo TypeScript limpio que un desarrollador escribiría a mano.

## Pipeline de generación de esquemas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Sus tablas se leen una vez y se emiten dos veces: como un esquema de Drizzle a través del cual consulta el servidor en ejecución, y como SQL que describe la base de datos que pretendía tener. Es este SQL con el que se alinea la base de datos mediante [Atlas](https://atlasgo.io), que calcula las diferencias (diff) entre el esquema deseado y el activo, y planifica el cambio:

```
                      Tables (backend/schema)
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

`db push` es el ciclo de desarrollo; `db generate` + `db migrate` es el ciclo revisable y el que se debe utilizar en producción. Ambos pasan por el mismo SQL generado, por lo que no pueden discrepar sobre lo que significan sus tablas, y ambos lo vuelven a escribir desde cero a partir de las tablas antes de leerlo, de modo que no hay ninguna copia en su repositorio que quede desactualizada. Las migraciones son lo que usted incluye en sus commits. Consulte [Generación de esquemas](/docs/cli/schema) para ver todos los flags.

### Ejemplo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Dada esta tabla:

<!-- schema-sample: table -->
```ts
import { defineTable, col, sql } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id: col.text().primaryKey().default(sql`gen_random_uuid()::text`),
        name: col.text().notNull(),
        price: col.numeric(),
        active: col.boolean().default(true),
        createdAt: col.timestamp({ withTimezone: true }).onCreateNow()
    },
    rls: "admin-only"
});
```

Rebase genera este esquema de Drizzle — el archivo completo, con políticas predeterminadas y todo:

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
    pgPolicy("products_default_admin_read", { as: "permissive", for: "select", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_insert", { as: "permissive", for: "insert", to: ["rebase_admin"], withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_update", { as: "permissive", for: "update", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))`, withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_delete", { as: "permissive", for: "delete", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
])).enableRLS();

export const tables = { products };
export const enums = {  };
export const relations = {  };
```

Hay tres aspectos que vale la pena leer dos veces. La columna `id`: la base de datos la completa con un uuid (`gen_random_uuid()::text`), por lo que una fila creada desde el panel de administración, la API REST o el SDK no necesita una clave propia, y si envía una, se utiliza tal como se proporciona. El bloque `pgPolicy`: `rls: "admin-only"` habilita la seguridad a nivel de fila y genera solo las políticas base, que permiten que el contexto del servidor de confianza y el rol `admin` puedan leerla — y nadie más; consulte [Seguridad a nivel de fila](/docs/collections/security-rules). Y `active`, que traslada el `.default(true)` que escribió como un valor predeterminado de **columna**: un valor predeterminado literal compila a un `DEFAULT` real, por lo que una fila insertada mediante la API REST, un script de semillas (seed) o `psql` también lo recibe, no solo una ingresada en el panel de administración.

Y este SQL, que es lo que se entrega a Atlas como el estado deseado:

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

Las políticas, columnas de búsqueda, índices vectoriales y disparadores (triggers) `updated_at` se escriben en sus propios archivos y son aplicados directamente por la CLI; Atlas no gestiona ninguno de los cuatro.

## Seguridad y objetos de base de datos no mapeados

Cuando Rebase actualiza el esquema de la base de datos, mapea las tablas que declara a tablas de la base de datos. Para garantizar que los **objetos de base de datos no mapeados (por ejemplo, tablas, vistas, enums) nunca se eliminen ni se modifiquen**, Rebase implementa varias capas de seguridad:

1. **Exclusión de tablas no mapeadas**: Antes de cada push, la CLI lista cada tabla y vista en la base de datos y le pasa a Atlas un `--exclude` para cada una a la que no apunte ninguna tabla declarada (o una tabla intermedia/junction de una tabla declarada), de modo que Atlas nunca planifique un cambio sobre ella. Si la base de datos no se puede leer, el push se cancela en lugar de ejecutarse con una lista parcial.
2. **Esquemas propiedad de Rebase**: El esquema `rebase` (tablas de autenticación, funciones auxiliares de RLS, la tabla de revisiones de Atlas) y cualquier esquema `auth` se excluyen por completo, por lo que un push nunca podrá planificar un `DROP SCHEMA … CASCADE`.
3. **Objetos que Atlas no puede modelar**: Las columnas de búsqueda, los índices vectoriales y los triggers también se excluyen de Atlas y se aplican desde sus propios archivos generados.
4. **Control de cambios destructivos**: `rebase db push` ejecuta primero el plan en modo de prueba (dry-run). Una sentencia que destruya datos —una columna o tabla eliminada, un cambio de tipo con pérdida de datos— detiene el push: en una terminal le solicita que escriba `yes`, y sin una terminal (CI, scripts, agentes) se rechaza a menos que pase `--allow-destructive`.
5. **Propiedad de índices por nombre**: Los índices son el único objeto que reside *en* una tabla mapeada, por lo que el filtrado de tablas no puede protegerlos; anteriormente, un push planificaba un `DROP INDEX` para cualquier índice ausente en el estado deseado, lo que incluía a todos los creados a mano. Rebase ahora nombra los índices que genera como `<table>_<columns>_ix_<7 hex>` (`_ux_` cuando es único), un formato que ningún otro generador de nombres produce aquí, y excluye todo lo demás de la comparación (diff) por nombre. Un índice que haya escrito a mano o que provenga de una introspección nunca se toca; una declaración que elimine seguirá borrándose, que es lo esperado. Consulte **[Índices](/docs/backend/indexes)**.

## Próximos pasos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- **[Tablas](/docs/schema/)** — Todas las opciones de `defineTable`
- **[Columnas](/docs/schema/columns/)** — Mapeos detallados de tipos de columna
- **[Índices](/docs/backend/indexes)** — Cómo declarar los índices que necesitan sus consultas
