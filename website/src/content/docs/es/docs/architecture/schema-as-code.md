---
sourceHash: 0824e3198007abfc
title: Esquema como Código
sidebar_label: Esquema como Código
description: Cómo Rebase utiliza colecciones de TypeScript como la única fuente de verdad para el esquema de su base de datos, UI y API.
---

## La Idea Principal

En Rebase, sus **definiciones de colección de TypeScript son la única fuente de verdad**. A partir de un conjunto de objetos TypeScript, Rebase genera:

- **Tablas PostgreSQL** a través de la generación de esquemas Drizzle ORM
- **UI CRUD** — formularios, tablas, validación, tipos de campo
- **Endpoints de API REST** con filtrado, ordenación y paginación
- **SDK de Cliente** — operaciones de datos con seguridad de tipos
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

```
TypeScript Collections
        │
        ▼
  rebase schema generate
        │
        ▼
  Drizzle Schema (schema.generated.ts)
        │
        ▼
  rebase db generate
        │
        ▼
  SQL Migration Files
        │
        ▼
  rebase db migrate
        │
        ▼
  PostgreSQL Tables
```

### Ejemplo

Dada esta colección:

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

Rebase genera este esquema Drizzle:

```typescript
// schema.generated.ts
import { pgTable, varchar, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    price: numeric("price"),
    active: boolean("active").default(true),
    created_at: timestamp("created_at").defaultNow()
});
```

Lo que produce este SQL:

```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    price NUMERIC,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Seguridad y Objetos de Base de Datos no Mapeados

Cuando Rebase actualiza el esquema de la base de datos, mapea las definiciones de colección de TypeScript a las tablas de la base de datos. Para garantizar que **los objetos de base de datos no mapeados (por ejemplo, tablas, vistas, enumeraciones) nunca se eliminen ni modifiquen**, Rebase implementa varias capas de seguridad:

1. **Filtrado Estricto de Tablas (`tablesFilter`)**: La configuración de Drizzle generada restringe dinámicamente la sincronización solo a las tablas exportadas en el esquema generado. El motor de sincronización ignora cualquier tabla no reconocida o tablas de sistemas heredados que existan en la base de datos.
2. **Restricciones de Esquema (`schemaFilter`)**: La sincronización de la base de datos se restringe exclusivamente al esquema `public`. Las tablas internas de la base de datos, los esquemas personalizados y las tablas específicas de extensiones no se modifican.
3. **Protección de Roles y Extensiones**: Drizzle está configurado para no gestionar roles de base de datos (`entities.roles: false`) ni tablas auxiliares de extensiones como PostGIS.
4. **Confirmación Interactiva en Modo de Desarrollo**: Al ejecutar `rebase db push` en desarrollo, la CLI se ejecuta con los flags `--strict` y `--verbose`, lo que garantiza que los desarrolladores deban revisar y aprobar explícitamente cualquier acción SQL destructiva antes de que se ejecute.
5. **Propiedad de los Índices por Nombre**: Los índices son el único objeto que vive *sobre* una tabla mapeada, así que el filtrado de tablas no puede protegerlos — y un push planificaba `DROP INDEX` para cualquier índice ausente del estado deseado, es decir, para todos los escritos a mano. Ahora Rebase nombra los índices que genera `<table>_<columns>_ix_<7 hex>` (`_ux_` cuando son únicos), una forma que ningún otro generador de nombres produce aquí, y excluye del diff todo lo demás por su nombre. Un índice que escribiste a mano, o que llegó por introspección, nunca se toca; una declaración que borras sigue eliminando su índice, que es la intención. Consulta **[Índices](/docs/backend/indexes)**.

## Siguientes Pasos

- **[Colecciones](/docs/collections)** — Referencia completa de la configuración de colecciones
- **[Propiedades](/docs/collections/properties)** — Mapeos detallados de tipos de columna
- **[Índices](/docs/backend/indexes)** — Declarar los índices que necesitan tus consultas
