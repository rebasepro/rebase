---
sourceHash: 80785b5fbb8f2d05
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
| `--collections, -c` | Directorio de colecciones (por defecto: `config/collections/`); las rutas relativas se resuelven desde donde ejecutes el comando |
| `--output, -o` | Ruta de salida para el archivo de esquema generado; las rutas relativas se resuelven desde donde ejecutes el comando |
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

**Hacer introspección y luego push no cambia nada.** Las propiedades generadas indican exactamente qué es cada columna — `columnType`, `precision`/`scale`, `defaultValue`, `required`, el `isId` de una clave (`"increment"` para una identidad entera, `columnType: "serial"` para un serial, `"manual"` para una clave sin valor por defecto), el `onDelete` de una relación, y el bloque `search` de una colección leído de vuelta a partir de la columna que construyó — así que `rebase db push --dry-run` justo después de una introspección no planea ningún cambio. Donde ninguna propiedad puede representar una columna — un `timestamp` sin zona horaria, un `interval`, un `inet`, un tipo enum que no se llama `<table>_<column>`, un valor por defecto como `CURRENT_DATE` — la introspección lo indica, columna por columna, en la terminal y en la parte superior del archivo, con lo que haría un push sobre ella y, cuando existe, la sentencia que hace que ambas coincidan (`ALTER TYPE "mood" RENAME TO "customers_current_mood";`). Una tabla con clave sobre más de una columna se omite con su motivo: una colección lee una fila por una sola columna clave, y `db push` deja en paz a una tabla que no es una colección.

### `rebase db push`

Envíe los cambios de esquema directamente a la base de datos sin archivos de migración:

```bash
rebase db push
```

**Qué hace:**
- Lee el esquema de Drizzle generado
- Aplica los cambios directamente a la base de datos (CREATE, ALTER, DROP)
- Ejecuta primero el plan en modo de prueba (dry run) y se detiene ante todo lo que destruya datos: una tabla, columna, esquema, vista o tipo eliminados, un `TRUNCATE`, o un cambio de tipo de columna que pueda perder valores (`timestamptz` → `date`, `numeric` → `integer`). Pregunta en una terminal y, si no, se niega; `--allow-destructive` (o `--yes`) lo aplica de todos modos
- Aplica las políticas RLS de sus colecciones y **elimina las políticas que un push anterior reemplazó**
- **No** crea archivos de migración

**Los archivos que genera por el camino**, todos bajo `.rebase/sql/` en el directorio del backend. `db push` y `db generate` escriben los cinco a partir de sus colecciones en cada ejecución, antes de leer ninguno, así que nada leería una copia incluida en un commit. El directorio lleva su propio `.gitignore` y nunca entra en un commit.

| Archivo | Contiene |
|------|-------|
| `schema.sql` | Tablas, columnas, restricciones e índices — el estado deseado de Atlas, y el único que compara |
| `policies.sql` | Las políticas RLS en las que se compilan sus `securityRules` |
| `search.sql` | Las funciones de búsqueda de texto completo y las columnas generadas, para las colecciones con un bloque `search` |
| `vector.sql` | Las extensiones de pgvector y los índices ANN |
| `triggers.sql` | `rebase.set_updated_at()` y los triggers `BEFORE UPDATE` detrás de `autoValue: "on_update"` |

Atlas gestiona el primero y nada más, así que `db push` y la puesta al día del esquema al arrancar aplican los otros cuatro por su cuenta. Un despliegue **solo con migraciones** — uno que ejecuta `db migrate` y nunca `db push` — tiene que incorporar esos cuatro a una migración a mano; `db generate` lo indica cuando un cambio es invisible para Atlas.

Si un proyecto hizo commit de estos archivos en `drizzle/` con una versión anterior, esas copias se eliminan en su primera ejecución, y el comando las nombra una a una para que pueda hacer commit de la eliminación. Solo elimina los archivos que empiezan con la cabecera del generador. Un archivo que haya escrito usted se conserva, igual que `drizzle/migrations/`.

:::note[Editar una regla de seguridad cambia el nombre de su política]
Una regla sin un `name` explícito se compila como `<table>_<op>_<hash>`, donde el hash cubre la semántica de la regla — así que *editar* una regla (en lugar de añadir una) produce una política con un nombre nuevo y deja atrás la antigua.

Esto importaba mucho antes: Postgres combina las políticas `PERMISSIVE` con OR, así que un `USING (rebase.uid() IS NOT NULL)` reemplazado seguía concediéndolo todo por muy estricta que fuera su sustituta. Endurecer una regla no tenía ningún efecto, y el push informaba de éxito.

Ahora `db push` lo reconcilia: elimina las políticas generadas que ya no corresponden a ninguna regla, e informa — sin eliminarla — de cualquier política con nombre personalizado que sus colecciones no describan, ya que no se distingue de SQL que alguien escribió deliberadamente.

Para auditar una base de datos a la que se hizo push antes de este cambio, ejecute `rebase doctor --policies`. Funciona como control de CI: termina con un código distinto de cero si hay deriva, y también cuando no pudo ejecutar la comprobación — sin `DATABASE_URL`, una ruta `--collections` que no se resuelve, una lectura de `pg_policies` que el rol de CI no tiene concedida. Un control que no pudo mirar no ha pasado.
:::

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
- Produce archivos de migración SQL con marca de tiempo en `drizzle/migrations/`
- Los archivos pueden revisarse, editarse y confirmarse en el control de versiones

Las migraciones generadas son archivos SQL simples — puede inspeccionarlas y modificarlas antes de aplicarlas.

### `rebase db migrate`

Ejecute todas las migraciones pendientes:

```bash
rebase db migrate
```

**Qué hace:**
- Lee `drizzle/migrations/` en busca de migraciones no aplicadas
- Las aplica en orden a la base de datos
- Rastrea qué migraciones se han aplicado

#### Establecer una baseline en una base de datos que Rebase ya ha arrancado

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

Genere un SDK tipado a partir de sus definiciones de colecciones:

```bash
rebase generate-sdk
```

**Qué hace:**
- Lee cada archivo de colección en `config/collections/` — los archivos que sirve el backend, estén o no listados en el barril `index.ts` — y se detiene en el primero que no carga
- Genera tipos de TypeScript para todas las entidades en `generated/sdk/`
- Produce un archivo `database.types.ts` para usar con `createRebaseClient<Database>()`

`rebase dev` lo ejecuta por usted al arrancar y en cada guardado bajo `config/collections/`. Ejecútelo usted mismo en CI, en un repositorio sin colecciones (vea `--from` más abajo), o en cualquier lugar donde `rebase dev` no se esté ejecutando.

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `-c`, `--collections` | Directorio de colecciones (por defecto: `config/collections/`); las rutas relativas se resuelven desde donde ejecutes el comando. También se acepta `--collections-dir`. |
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

# 4. Review the generated SQL in drizzle/migrations/
# 5. Commit the migration to version control
git add drizzle/migrations/

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
- **[SDK tipado](/docs/sdk)** — Use el SDK generado
