---
sourceHash: 03df1518e08ca072
title: Generación de Esquemas
sidebar_label: Generación de Esquemas
description: Genere esquemas de Drizzle ORM a partir de las definiciones de colecciones, cree migraciones SQL y mantenga su base de datos sincronizada con la CLI de Rebase.
---

## Resumen

Rebase usa un pipeline de **esquema-como-código** donde sus definiciones de colecciones en TypeScript son la única fuente de verdad. La CLI las transforma a través de un pipeline determinista:

```
Collections (TypeScript) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página cubre todos los comandos de la CLI involucrados en ese pipeline.

## El Pipeline

### 1. Colecciones → Esquema de Drizzle

Sus definiciones de colecciones en `config/collections/` describen tablas, columnas, tipos, relaciones y enums. El comando `schema generate` las lee y produce un archivo de esquema de Drizzle ORM.

### 2. Esquema de Drizzle → Migraciones

A partir del esquema de Drizzle generado, `db generate` compara con el estado actual de la base de datos y produce archivos de migración SQL con marca de tiempo.

### 3. Migraciones → PostgreSQL

El comando `db migrate` aplica las migraciones pendientes a su base de datos PostgreSQL.

## Comandos

### `rebase schema generate`

Genere un archivo de esquema de Drizzle ORM a partir de sus definiciones de colecciones:

```bash
rebase schema generate
```

**Qué hace:**
- Lee todas las colecciones de `config/collections/`
- Genera `backend/src/schema.generated.ts` con las definiciones de tablas, enums y relaciones de Drizzle

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--collections, -c` | Ruta al directorio de colecciones (por defecto: `config/collections/`) |
| `--output, -o` | Ruta de salida para el archivo de esquema generado |
| `--watch, -w` | Vigilar cambios y regenerar automáticamente |

El **modo watch** es útil durante el desarrollo — edite un archivo de colección y el esquema se regenera al instante:

```bash
rebase schema generate --watch
```

### `rebase schema introspect`

Aplique ingeniería inversa a las definiciones de colecciones a partir de una base de datos PostgreSQL existente:

```bash
rebase schema introspect
```

**Qué hace:**
- Se conecta a su base de datos (usando la cadena de conexión de su `.env`)
- Inspecciona todas las tablas, columnas, tipos y claves foráneas
- Genera archivos de definición de colecciones

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--output, -o` | Directorio de salida para los archivos de colección generados |

Esto es útil al adoptar Rebase en una base de datos existente — primero haga introspección y luego personalice las colecciones generadas.

### `rebase db push`

Envíe los cambios de esquema directamente a la base de datos sin archivos de migración:

```bash
rebase db push
```

**Qué hace:**
- Lee el esquema de Drizzle generado
- Aplica los cambios directamente a la base de datos (CREATE, ALTER, DROP)
- **No** crea archivos de migración

:::caution
`db push` modifica la base de datos directamente. Úselo solo en desarrollo. Para producción, use `db generate` + `db migrate` para crear archivos de migración revisables.
:::

### `rebase db generate`

Genere archivos de migración SQL a partir de los cambios de esquema:

```bash
rebase db generate
```

**Qué hace:**
- Compara el esquema de Drizzle con el estado actual de la base de datos
- Produce archivos de migración SQL con marca de tiempo en el directorio `drizzle/`
- Los archivos pueden revisarse, editarse y confirmarse en el control de versiones

Las migraciones generadas son archivos SQL simples — puede inspeccionarlas y modificarlas antes de aplicarlas.

### `rebase db migrate`

Ejecute todas las migraciones pendientes:

```bash
rebase db migrate
```

**Qué hace:**
- Lee el directorio `drizzle/` en busca de migraciones no aplicadas
- Las aplica en orden a la base de datos
- Rastrea qué migraciones se han aplicado

#### Establecer una baseline en una base de datos que Rebase ya ha arrancado

<span class="since-badge" data-since="0.18">Since 0.18</span>

Cada arranque de Rebase asegura el esquema, y `rebase db push` lo aplica directamente. Una base de datos sobre la que se haya ejecutado cualquiera de los dos ya tiene las tablas y los tipos que crearía la primera migración, y `rebase db migrate` se detiene con `pq: type "posts_status" already exists (42710)`.

La migración no tiene nada de malo: la base de datos se aprovisionó por otra vía. Registre dónde está ya y migre con normalidad:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versión es el prefijo numérico del archivo de migración que describe lo que hay en la base de datos *ahora*. Esa migración y todas las anteriores quedan registradas como aplicadas; todo lo posterior se ejecuta. Sobre una base de datos que nunca ha arrancado no hace falta baseline: migre directamente.

### `rebase db branch`

Ramificación de base de datos para desarrollo en paralelo:

```bash
rebase db branch create feature_auth
rebase db branch list
rebase db branch delete feature_auth
```

### `rebase doctor`

Detecte la desviación de tres vías entre sus definiciones de colecciones, el esquema de Drizzle generado y la base de datos PostgreSQL en vivo:

```bash
rebase doctor
```

**Qué comprueba:**
- Colecciones ↔ Esquema generado — ¿están sincronizados?
- Esquema generado ↔ Base de datos — ¿hay cambios sin aplicar?
- Colecciones ↔ Base de datos — ¿hay alguna desviación inesperada?

Ejecute `doctor` cada vez que algo parezca desincronizado. Señala exactamente dónde está la discrepancia.

### `rebase generate-sdk`

Genere un SDK de cliente tipado a partir de sus definiciones de colecciones:

```bash
rebase generate-sdk
```

**Qué hace:**
- Lee las colecciones de `config/collections/` (admite exports de barril `index.ts` o archivos individuales)
- Genera tipos de TypeScript para todas las entidades en `generated/sdk/`
- Produce un archivo `database.types.ts` para usar con `createRebaseClient<Database>()`

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `-c`, `--collections-dir` | Ruta al directorio de colecciones (por defecto: `config/collections/`) |
| `-o`, `--output` | Directorio de salida para el SDK (por defecto: `generated/sdk/`) |
| `--from <link\|url>` | Lee el esquema de un proyecto en ejecución en lugar del código local. `link` usa el proyecto vinculado a este checkout. |
| `--token` | Token Bearer para el endpoint de contrato (por defecto: `$REBASE_SERVICE_KEY`) |

`--from` es lo que permite que un repositorio sin colecciones propias — un frontend aparte, una segunda aplicación web, una aplicación móvil — genere un cliente tipado del proyecto con el que habla. `REBASE_SERVICE_KEY` solo se envía al proyecto vinculado a este checkout; para cualquier otro host, pase `--token` explícitamente.

**Uso tras la generación:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    collections: collectionsDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

Los nombres de campo en los tipos generados son los que sirve la API, sin cambios: una columna `createdAt` es `row.createdAt`. Solo el *accessor* de la colección se convierte en un nombre de propiedad (`my-notes` → `client.data.myNotes`), que es lo que `collectionsDictionary` devuelve al slug.

## Flujo de Trabajo de Desarrollo

El flujo de trabajo de iteración rápida para desarrollo:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Flujo de Trabajo de Producción

El flujo de trabajo seguro y revisable para producción:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Review the generated SQL in drizzle/
# 5. Commit the migration to version control
git add drizzle/

# 6. Apply in production
#    A database Rebase has already booted needs a baseline the first time —
#    see the baselining section above.
rebase db migrate
```

## Solución de Problemas

| Síntoma | Solución |
|---------|----------|
| `Could not detect an active database plugin` | Instale `@rebasepro/server-postgres` en `backend/package.json` |
| El archivo de esquema no se actualiza | Compruebe que la ruta `--collections` apunta al directorio correcto |
| La migración muestra cambios inesperados | Ejecute `rebase doctor` para identificar la desviación |
| `db push` falla en producción | Use `db generate` + `db migrate` en su lugar |
| `db migrate` falla con `already exists (42710)` | El arranque o `db push` ya aprovisionaron el esquema — regístrelo con `rebase db migrate --baseline <version>` |

## Próximos Pasos

- **[Colecciones](/docs/collections)** — Defina su modelo de datos
- **[Referencia de la CLI](/docs/cli)** — Todos los comandos de la CLI
- **[SDK del Cliente](/docs/sdk)** — Use el SDK generado
