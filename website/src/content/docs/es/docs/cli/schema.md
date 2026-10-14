---
sourceHash: 9b1b8edf410cbb6e
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

### `rebase schema stale`

Compruebe si el esquema generado sigue coincidiendo con las colecciones:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**Qué hace:**
- Renderiza lo que generan las colecciones de `config/collections/` y lo compara, declaración por declaración, con `backend/src/schema.generated.ts`
- Nombra cada diferencia — una tabla que falta, una columna con otro tipo, una etiqueta de enum eliminada, o claves foráneas con el nombre que les daba una versión anterior — y termina con un código distinto de cero
- Con `--fix`, regenera el archivo en lugar de informar

`rebase dev` mantiene el archivo al día por sí mismo, así que esta es la comprobación para una compilación o un paso de CI. Acepta `--collections` y `--output` igual que `rebase schema generate`.

### `rebase schema introspect`

Aplique ingeniería inversa a las definiciones de colecciones a partir de una base de datos PostgreSQL existente:

```bash
rebase schema introspect
```

**Qué hace:**
- Se conecta a su base de datos (usando la cadena de conexión de su `.env`)
- Inspecciona todas las tablas, columnas, tipos y claves foráneas
- Genera archivos de definición de colecciones
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Lee las políticas de
  seguridad a nivel de fila de cada tabla en los `securityRules` de su colección:
  nombre, comando, modo, lista `TO`, `USING` y `WITH CHECK`. Las políticas
  `<table>_default_*` que Rebase añade por su cuenta se dejan fuera. Así, el
  `db push` posterior recrea cada política tal como estaba. En la 0.24 las políticas
  quedan fuera de los archivos, y un push puede eliminar una cuyo nombre tiene la forma
  de una política generada (`<table>_<op>_<hash>`)
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Genera como entidad en
  la navegación una tabla cuyas políticas dan a cada usuario sus propias filas (leen
  `rebase.uid()`, `app.uid` o el JWT), por pocas filas que tenga. En la 0.24 una tabla
  pequeña es una lista de códigos, y una tabla poseída a través de otra se oculta como
  hija suya
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Contra una base de datos
  que no está en ejecución, imprime una vez el mismo banner que `db push` y no crea nada.
  Imprime el directorio de salida como una ruta absoluta
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Deja las restricciones CHECK y EXCLUDE de una
  tabla en la base de datos, donde el `db push` posterior las conserva. Una colección
  no puede declarar ninguna de las dos; un CHECK que la introspección puede leer
  (`total >= 0`) pasa además a ser la `validation` de la propiedad. En la 0.24 ese push
  las eliminaba

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--output, -o` | Directorio de salida para los archivos de colección generados |
| `--schema` | El esquema de Postgres que se lee (por defecto: `public`) |
| `--force, -f` | Sobrescribe los archivos de colección que ya existen; sin él, un archivo existente se omite |

Esto es útil al adoptar Rebase en una base de datos existente — primero haga introspección y luego personalice las colecciones generadas.

**Hacer introspección y luego push no cambia nada.** Las propiedades generadas indican exactamente qué es cada columna — `columnType`, `precision`/`scale`, `defaultValue`, `required`, el `isId` de una clave (`"increment"` para una identidad entera, `columnType: "serial"` para un serial, `"manual"` para una clave sin valor por defecto), el `onDelete` de una relación — y su `index: false` donde la base de datos no tiene índice sobre la columna de la clave, ya que una `belongsTo` está [indexada por defecto](/docs/backend/indexes#foreign-keys-are-indexed-for-you) (borra la línea para que se construya uno) — y el bloque `search` de una colección leído de vuelta a partir de la columna que construyó — así que `rebase db push --dry-run` justo después de una introspección no planea ningún cambio. Donde ninguna propiedad puede representar una columna — un `timestamp` sin zona horaria, un `interval`, un `inet`, un tipo enum que no se llama `<table>_<column>`, un valor por defecto como `CURRENT_DATE` — la introspección lo indica, columna por columna, en la terminal y en la parte superior del archivo, con lo que haría un push sobre ella y, cuando existe, la sentencia que hace que ambas coincidan (`ALTER TYPE "mood" RENAME TO "customers_current_mood";`). Una tabla con clave sobre más de una columna vuelve como una clave compuesta, con su `isId` en cada columna de la clave. Se omite, con su motivo, cuando una columna de la clave no puede llevar `isId` (un timestamp, por ejemplo) o la clave foránea de otra tabla apunta a ella, algo que una relación de una sola columna no puede hacer; `db push` deja en paz a una tabla que no es una colección. En 0.23, el push justo después de una introspección aún podía planear cambios de tipo, valores por defecto eliminados y NOT NULL, y una clave `id` fantasma.

**Cómo son los archivos generados**

La introspección escribe las colecciones con `defineCollection`, que mantiene las claves de las propiedades *literales* — de modo que `propertiesOrder`, `listProperties`, `sort` y `display.title` se autocompletan sobre los nombres de sus propias columnas, y una clave que queda de una columna renombrada es un error de compilación en lugar de una línea que no hace nada en silencio. Cuál importa depende de aquello de lo que dependa su proyecto, y se decide en cada ejecución:

| Su proyecto declara | Las colecciones generadas usan | Bloque `admin` |
|------|------|------|
| `@rebasepro/cms-types` (un proyecto con el panel) | `defineCollection` de `@rebasepro/cms-types` | sí |
| `@rebasepro/common` (un proyecto `--headless`) | `defineCollection` de `@rebasepro/common` | no |
| ninguno | una anotación `PostgresCollectionConfig`, con una advertencia | no |

Un proyecto headless no tiene panel de administración, y los tipos del núcleo no declaran ningún campo `admin` — así que el bloque no se emite allí. Es presentación (`icon`, `propertiesOrder`, `multiline`); nada del esquema, la API o sus datos depende de él.

### `rebase db push`

Envíe los cambios de esquema directamente a la base de datos sin archivos de migración:

```bash
rebase db push
```

**Qué hace:**
- Lee el esquema de Drizzle generado
- Aplica los cambios directamente a la base de datos (CREATE, ALTER, DROP)
- Ejecuta primero el plan en modo de prueba (dry run) y se detiene ante todo lo que destruya datos: una tabla, columna, esquema, vista o tipo eliminados, un `TRUNCATE`, un cambio de tipo de columna que pueda perder valores (`timestamptz` → `date`, `numeric` → `integer`), o un cambio de clave primaria: `(id)` → `(id, locale)` le da a cada fila un id nuevo, de modo que los enlaces, las claves foráneas y los ids guardados en otros lugares dejan de encontrar su fila. <span class="since-badge" data-since="0.25">Desde 0.25</span> También se detiene antes de eliminar una restricción CHECK o EXCLUDE que la base de datos tiene: no se pierde ninguna fila, pero desde entonces la base de datos acepta las filas que rechazaba. Pregunta en una terminal, donde Ctrl-C o Ctrl-D responden que no, y de lo contrario se niega; `--allow-destructive` (o `--yes`) lo aplica de todos modos. Un push que se detiene ahí elimina por el camino su base de datos temporal `<db>_dev_diff`
- Activa la seguridad a nivel de fila en todas las tablas de colecciones, incluidas las tablas de unión, justo después del cambio de esquema y antes de cualquier paso que pueda fallar, de modo que un push que se detiene a medias deja una tabla nueva denegando todas las solicitudes en lugar de abierta a ellas
- Aplica las políticas RLS de sus colecciones y **elimina las políticas que un push anterior reemplazó**
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Deja tal como están todas las restricciones
  CHECK y EXCLUDE de la tabla de una colección. Una colección no puede declarar ninguna de las
  dos, así que son reglas propias de la base de datos, escritas a mano o traídas por una base de
  datos que `schema introspect` adoptó; para quitar una, elimínela a mano
  (`ALTER TABLE … DROP CONSTRAINT …`). Tampoco toca los triggers ni las funciones que usted
  escribió. En la 0.24 el primer push tras una introspección eliminaba todas las restricciones
  CHECK y EXCLUDE sin preguntar
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Reconoce por su nombre exacto todo lo que deja en
  paz, aunque ese nombre lleve un `.`, `[`, `]` o `*`. En la 0.24 un índice escrito a mano con
  un nombre como `orders_idx[v1]` se eliminaba sin preguntar, y un `.` en el nombre de una
  tabla o de un índice hacía fallar cada push con `too many parts in pattern`
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Construye cualquier
  [índice de clave foránea que Rebase deriva](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  y que falte en una tabla existente **antes** de planificar, con
  `CREATE INDEX CONCURRENTLY`, de modo que las escrituras en la tabla continúan durante la
  construcción; Atlas lo encuentra luego en su sitio. `--dry-run` los nombra y no construye nada
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Sella las
  políticas que aplica como lo hace el arranque del servidor, de modo que el primer arranque
  tras un push las deja en paz en lugar de volver a crear cada una
- <span class="since-badge" data-since="0.25">Desde 0.25</span> `--dry-run`
  no escribe nada del proyecto: `src/schema.generated.ts` se deja como está,
  y las copias `drizzle/*.sql` que dejó una versión anterior se nombran, no
  se eliminan. Solo la entrada del plan va a `.rebase/sql/`, que no se incluye en un commit
- **No** crea archivos de migración

**Cuánto tarda.** Casi todo un push es Atlas calculando el plan: construye
tu esquema deseado en una base de datos temporal y lo compara con la real,
y ese coste crece más rápido que el número de tablas — en un portátil tranquilo
unos 0,25 s por plan con 11 tablas, 0,9 s con 111 y 5,5 s con 411. Un push que
no cambia nada planifica una vez; uno que cambia algo planifica dos veces (la prueba en seco
que lee la barrera de cambios destructivos, y luego la aplicación). Así que un push sobre un esquema de
400 o más tablas tarda decenas de segundos, y más en una máquina ocupada o lenta.
Ese tiempo es de Atlas, no de tu base de datos: los pasos que lo rodean — generar el
SQL, el bloqueo de RLS, la búsqueda, los triggers, las políticas, el rol — tardan unos pocos segundos con
ese tamaño, sobre una conexión a tu base de datos.

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

<span class="since-badge" data-since="0.25">Desde 0.25</span> `doctor` y `db push` distinguen los dos tipos de huérfana. Una política con un nombre generado fue reemplazada, y el siguiente push la elimina. Cualquier otro nombre lo escribió a mano una persona u otra herramienta y sigue en vigor: descríbala en los `securityRules` de su colección para conservarla (la vista RLS de Studio la importa), o elimínela a mano si está obsoleta. En la 0.24 ambas son «dejadas atrás por un push anterior».
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
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Nombra cada sentencia de la nueva migración que destruye datos, con la comprobación que
  ejecuta `db push` antes de aplicar: una tabla, columna, esquema, vista o tipo eliminados, un
  `TRUNCATE`, un cambio de tipo de columna que puede perder valores, un cambio de clave
  primaria, o la eliminación de una restricción CHECK o EXCLUDE que la base de datos tiene.
  Sigue escribiendo el archivo y termina con 0, así que avisa y no rechaza.

**Un CHECK que añadió una migración suya lo elimina la siguiente.** `db generate` compara
sus archivos de migración, no la base de datos, y Atlas no tiene forma de dejar un objeto
fuera de esa comparación. Así, una restricción CHECK o EXCLUDE que usted escribió a mano en
una migración, y que ninguna colección puede declarar, vuelve como
`ALTER TABLE … DROP CONSTRAINT …` en la siguiente migración que escribe, integrada en la
misma sentencia que el cambio real. El informe de arriba nombra esa eliminación cuando la
base de datos ya tiene la restricción; no la quita del archivo. Elimine la cláusula antes de
`rebase db migrate`, o deje que `rebase db migrate --refuse-destructive` se detenga en ella.
`db push` lee la base de datos y conserva la restricción.

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

<span class="since-badge" data-since="0.25">Desde 0.25</span> `--refuse-destructive`
hace que rechace en su lugar. Primero ejecuta en seco las migraciones pendientes. Si alguna
sentencia destruye datos, según la misma comprobación que usan `db push` y `db generate`, lista esas sentencias y
termina con 1. No aplica nada, ni siquiera los archivos anteriores a esa sentencia. Sin la
opción, `db migrate` se comporta como antes y aplica todos los archivos pendientes:

```bash
rebase db migrate --refuse-destructive
```

Una migración que reconstruye una columna de búsqueda la elimina primero, así que esta opción rechaza
también esa migración. Lea la lista que imprime y luego ejecute `rebase db migrate`
sin la opción para aplicarla.

#### Establecer una baseline en una base de datos que Rebase ya ha arrancado

Cada arranque de Rebase asegura el esquema, y `rebase db push` lo aplica directamente. Una base de datos sobre la que se haya ejecutado cualquiera de los dos ya tiene las tablas y los tipos que crearía la primera migración, y `rebase db migrate` se detiene con `pq: type "posts_status" already exists (42710)`.

La migración no tiene nada de malo: la base de datos se aprovisionó por otra vía. Registre dónde está ya y migre con normalidad:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versión es el prefijo numérico del archivo de migración que describe lo que hay en la base de datos *ahora*. Esa migración y todas las anteriores quedan registradas como aplicadas; todo lo posterior se ejecuta. Sobre una base de datos que nunca ha arrancado no hace falta baseline: migre directamente.

Lo mismo ocurre más tarde en el ciclo habitual: edite una colección mientras `rebase dev` se ejecuta, y el arranque añade la columna antes de que `rebase db generate` escriba la migración que la añade, de modo que `rebase db migrate` se detiene en `column … already exists (42701)`. Establezca una baseline de esa migración de la misma manera. <span class="since-badge" data-since="0.25">Desde 0.25</span> `--baseline` funciona en una base de datos que ya registra migraciones: marca todo hasta la versión como aplicado con `atlas migrate set`, y lo dice, o dice que no hay nada que registrar cuando el historial ya la alcanza. En la 0.24 Atlas ignora `--baseline` en cuanto hay alguna migración registrada, así que vuelve el mismo error.

### `rebase db branch`

Ramificación de base de datos para desarrollo en paralelo:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (y `switch --off`) y `rebase db branch prune`
son nuevos. `create`, `list`, `info` y `delete` se publicaron en la 0.17.

Cada rama es una copia completa de la base de datos hecha con `CREATE DATABASE ... TEMPLATE`,
por lo que necesita un servidor PostgreSQL real y cuesta el mismo disco que su origen.

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

La comparación con la base de datos necesita `DATABASE_URL` (o `ADMIN_CONNECTION_STRING`). Sin una, esa fase se informa como **omitida** en lugar de superada, y la ejecución nunca termina con "All schemas are in sync" — una comprobación que no ocurrió no es un certificado de buena salud.

<span class="since-badge" data-since="0.25">Desde 0.25</span> También nombra cada colección sin [bloque `search`](/docs/backend/search) cuya tabla contiene más de unas 10.000 filas. Una búsqueda ahí — el cuadro de búsqueda del administrador, `.search()`, `?searchString=` — es `ILIKE '%term%'` sobre las columnas de texto, que ningún índice puede servir, así que cada una lee la tabla entera, y su conteo la lee otra vez (alrededor de un tercio de segundo con 100.000 filas, creciendo con la tabla). El número de filas es la estimación propia de Postgres, así que la comprobación no escanea nada. Es una pista: no cambia el código de salida, y nada se indexa por ti.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Nombra una **junction huérfana**: una tabla de `public` con la forma de una junction many-to-many que ninguna colección declara. La forma son dos columnas que juntas forman la clave primaria, cada una clave foránea a la tabla de una colección. Renombrar o quitar una `manyToMany` deja atrás su antigua junction, porque push y el arranque solo crean tablas, y cada fila de enlace sigue en ella. La nota es solo informativa, así que no cambia el código de salida. Su arreglo es la sentencia `DROP TABLE`, que `doctor` muestra y nunca ejecuta.

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

En 0.23 el comando lee solo los archivos que enumera el barril `index.ts`, omite con una advertencia el que no carga, y toma el directorio como `--collections-dir`; y `rebase dev` solo regenera el esquema, así que los tipos del SDK los regenera usted.

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `-c`, `--collections` | Directorio de colecciones (por defecto: `config/collections/`); las rutas relativas se resuelven desde donde ejecutes el comando. También se acepta `--collections-dir`. |
| `-o`, `--output` | Directorio de salida para el SDK (por defecto: `generated/sdk/`) |
| `--from <link\|url>` | Lee el esquema de un proyecto en ejecución en lugar del código local. `link` usa el proyecto vinculado a este checkout. |
| `--token` | Token Bearer para el endpoint de contrato (por defecto: `$REBASE_SERVICE_KEY` del shell; `.env` no se lee) |

`--from` es lo que permite que un repositorio sin colecciones propias — un frontend aparte, una segunda aplicación web, una aplicación móvil — genere un cliente tipado del proyecto con el que habla. `REBASE_SERVICE_KEY` solo se envía al proyecto vinculado a este checkout; para cualquier otro host, pase `--token` explícitamente. La clave de `.env` pertenece a su backend local y nunca se envía.
<span class="since-badge" data-since="0.25">Desde 0.25</span> Un rechazo dice cuál de estos casos ocurrió: un `--token` rechazado, una clave del shell rechazada, una clave retenida para un host que no está vinculado, una clave que solo está en `.env`, o ninguna clave. En la 0.24 siempre dice que pase `--token` o defina `REBASE_SERVICE_KEY`.

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

Los nombres de campo en los tipos generados son los que sirve la API. El nombre de un campo en el cable es la clave de su propiedad, y la API es camelCase en todo: la introspección genera una columna `created_at` como una propiedad `createdAt` que lleva `columnName: "created_at"`, y la sirve como `row.createdAt`. La columna en sí no se toca. El *accessor* de la colección se convierte en un nombre de propiedad de la misma manera (`my-notes` → `client.data.myNotes`), que es lo que `collectionsDictionary` devuelve al slug.

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
#    see "Baselining a database Rebase has already booted" above.
rebase db migrate
```

## Solución de Problemas

| Síntoma | Solución |
|---------|----------|
| `Could not detect an active database plugin` | Instale `@rebasepro/server-postgres` en `backend/package.json` |
| El archivo de esquema no se actualiza | Compruebe que la ruta `--collections` apunta al directorio correcto |
| La migración muestra cambios inesperados | Ejecute `rebase doctor` para identificar la desviación |
| `db push` falla en producción | Use `db generate` + `db migrate` en su lugar |
| Una migración no debe eliminar datos en CI o producción | <span class="since-badge" data-since="0.25">Desde 0.25</span> `rebase db migrate --refuse-destructive` termina con 1 y no aplica nada cuando una sentencia pendiente destruye datos |
| `db migrate` falla con `already exists (42710)` | El arranque o `db push` ya aprovisionaron el esquema — regístrelo con `rebase db migrate --baseline <version>` |
| `db migrate` falla con `column … already exists (42701)` | `rebase dev` añadió la columna en el arranque — establezca una baseline de esa migración de la misma manera |
| `db push` en la base de datos gestionada falla con `Error: EOF` | Atlas perdió una conexión que mantiene el `rebase dev` en ejecución. Ejecútelo de nuevo; si sigue fallando, detenga primero `rebase dev` |

## Próximos Pasos

- **[Colecciones](/docs/collections)** — Defina su modelo de datos
- **[Referencia de la CLI](/docs/cli)** — Todos los comandos de la CLI
- **[SDK tipado](/docs/sdk)** — Use el SDK generado
