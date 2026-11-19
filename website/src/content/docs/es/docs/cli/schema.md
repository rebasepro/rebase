---
sourceHash: 26de566694c2cb42
title: Generación de esquemas
sidebar_label: Generación de esquemas
description: Genera esquemas de Drizzle ORM a partir de las tablas en backend/schema, crea migraciones SQL, haz introspección de una base de datos existente en archivos defineTable y mantén tu base de datos sincronizada con la CLI de Rebase.
---

## Visión general

Rebase utiliza un pipeline de **schema-as-code** donde las tablas que declaras con
`defineTable` en `backend/schema/` son la única fuente de verdad. La CLI
las transforma a través de un pipeline determinista:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página cubre cada comando de la CLI involucrado en ese pipeline.

## El pipeline

### 1. Tablas → Esquema de Drizzle

Las tablas que exporta `backend/schema/index.ts` describen columnas, tipos, relaciones,
enums y seguridad a nivel de fila (row-level security o RLS). Cada comando a continuación las lee a través del loader
con el que arranca el backend, por lo que un esquema que no compila —una tabla sin
`rls`, `"inherit"` sin `defaultRls`, un `defineTable` que el index no
exporta— detiene el comando con un `SchemaDefinitionError` detallando cada problema,
y no se escribe nada. El comando `schema generate` genera un archivo de esquema
de Drizzle ORM a partir de ellas.

Cada comando que lee el esquema acepta `--schema-dir <dir>` para un proyecto
que guarda sus tablas en otro lugar; el valor predeterminado es `backend/schema`, o la
clave `tables` de la aplicación de backend en `rebase.json`. `--collections` / `-c`, el
flag anterior a la versión 0.31, se rechaza con un mensaje que indica el codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), al igual que un
proyecto que aún contiene `config/collections`.

### 2. Esquema declarado → Migraciones

`db generate` convierte las tablas, políticas, funciones, índices, triggers y
vistas declarados en el SQL deseado para Ptah. Ptah compara ese SQL con las
migraciones de `backend/drizzle/migrations/`, reproducidas en una base de datos
temporal, y escribe una nueva migración. Rebase también lee la base de datos
de destino para proteger los objetos que no administra. Una columna creada
por el arranque o `db push` sigue apareciendo en la migración porque el diff
parte del historial de migraciones.

### 3. Migraciones → PostgreSQL

El comando `db migrate` aplica las migraciones pendientes a tu base de datos PostgreSQL.

## Comandos

### `rebase schema generate`

Genera un archivo de esquema de Drizzle ORM a partir de tus tablas:

```bash
rebase schema generate
```

**Qué hace:**
- Lee las tablas que exporta `backend/schema/index.ts`
- Genera `backend/src/schema.generated.ts` con definiciones de tablas, enums y relaciones de Drizzle

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | El directorio del esquema (por defecto: `backend/schema`); las rutas relativas se resuelven desde donde ejecutas el comando |
| `--output, -o` | Ruta de salida para el archivo de esquema generado; las rutas relativas se resuelven desde donde ejecutas el comando |
| `--watch, -w` | Observa los cambios y regenera automáticamente |

El **modo watch** es útil durante el desarrollo: edita un archivo de tabla y el esquema se regenera al instante:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Comprueba si el esquema generado todavía coincide con las tablas:

```bash
rebase schema stale          # informa y sale con código 1 si algo está desactualizado
rebase schema stale --fix    # regenera el archivo en su lugar
```

**Qué hace:**
- Procesa lo que generan las tablas en `backend/schema/` y lo compara, declaración por declaración, con `backend/src/schema.generated.ts`
- Nombra cada diferencia —una tabla faltante, una columna con tipo modificado, una etiqueta de enum eliminada o claves foráneas nombradas de la forma en que una versión anterior las derivaba— y finaliza con un código distinto de cero
- Con `--fix`, regenera el archivo en lugar de generar el informe

`rebase dev` mantiene el archivo actualizado por sí mismo, por lo que esta es la verificación ideal para un paso de build o CI. Admite `--schema-dir` y `--output` al igual que `rebase schema generate`.

### `rebase schema reconcile`

Relaja y elimina lo que el arranque (boot) no procesará, después de haber leído el plan:

```bash
rebase schema reconcile                         # relaja NOT NULL en columnas hechas anulables o eliminadas
rebase schema reconcile --drop voice_cache.wav  # y elimina una columna que ninguna tabla declara
```

**Qué hace:**
- Solicita al backend en ejecución que planifique contra su propia base de datos. Ese es el backend al que apuntan `.env` y el enlace a la nube, por lo que funciona en Rebase Cloud, donde nada más puede acceder a la base de datos.
- Planifica `DROP NOT NULL` para cada columna que una tabla declare como anulable (nullable) y que la base de datos aún requiera.
- Lista cada columna que ninguna tabla declara. Una que sea `NOT NULL` sin valor predeterminado bloquea cada inserción, por lo que también se relaja y sus datos permanecen. Solo elimina las columnas que indiques explícitamente con `--drop <table>.<column>`, y muestra cuántas filas contienen un valor en cada una.
- Se aplica una vez que escribes `yes`. El servidor ejecuta el plan solo sobre el resumen criptográfico (digest) del plan que leíste; de modo que si la base de datos o las tablas cambiaron en el transcurso, se rechaza y deberás revisarlo nuevamente. `--yes` omite la confirmación interactiva.

El arranque (boot) solo agrega cambios, por lo que tras eliminar una columna de su `defineTable`, su columna permanece en la base de datos con sus datos. Una columna `NOT NULL` sin valor predeterminado hará que fallen todas las inserciones, y el registro de arranque señalará este comando: sin `--drop` para conservar los datos, con él para eliminar la columna. Despliega primero el cambio de la tabla, porque reconcile planifica contra lo que ejecuta el backend. Requiere `REBASE_SERVICE_KEY` en `.env`. Localmente, `rebase db push` cubre lo mismo mediante su control de cambios destructivos.

### `rebase schema introspect`

Genera archivos `defineTable` a partir de una base de datos PostgreSQL existente:

```bash
rebase schema introspect
```

**Qué hace:**
- Se conecta a la base de datos de este proyecto, la que imprime `rebase db url` (la administrada se inicia si se trata de esa); `--database-url` especifica otra, y `--docker` utiliza la de compose
- Lee cada tabla, columna, tipo, clave foránea y política, y escribe
  `backend/schema/<table>.ts` —un `defineTable` por tabla— y el
  `backend/schema/index.ts` que las exporta (fusionado en un index que ya exista allí)
- Declara cada columna con su tipo de Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, un enum con sus etiquetas y nombre de tipo real
  (un `pgEnum` cuando el tipo se comparte), un arreglo como `<item>.array()`,
  `col.vector({ dimensions })`, claves identity y serial, valores predeterminados —escritos tal
  como los escribe Drizzle. Un tipo que ningún builder defina se convierte en
  `col.custom({ dataType: "<sql type>" })`, el cual Rebase sirve tal como lo
  retorna el driver; `db generate` y `db push` lo rechazan hasta que el planificador
  pueda procesarlo
- Declara la columna de clave foránea, el `belongsTo` sobre ella y el
  `hasMany` inverso en el destino; una tabla de unión se convierte en un `manyToMany`, y sus
  propias columnas en el `pivot`
- Lee las políticas de row-level security de cada tabla en su `rls`: nombre,
  comando, modo, lista `TO`, `USING` y `WITH CHECK`. Las políticas
  `<table>_default_*` que Rebase agrega por sí mismo se omiten, de modo que el `db push`
  posterior recrea cada política tal como estaba. Una tabla con row-level security activado
  y sin directivas se escribe como `rls: "admin-only"`
- Lee cada expresión (el `USING` de una política, un CHECK, un valor por defecto de columna) bajo
  el `search_path` que utiliza el servidor, `public`, por lo que una función en el esquema
  `rebase` se escribe como `rebase.roles()`
- Convierte un CHECK legible (`total >= 0`) en el `.validate()` de la columna, y deja la restricción misma en la base de datos, donde el push posterior la conserva. Cada CHECK también se lista bajo "Not carried over" con su SQL: un push a una base de datos *nueva* crea la validación, no la restricción
- Declara cada índice simple (solo columnas, btree, gin o brin, sin predicado) en los `indexes` de la tabla. Un índice exclusivo sobre una columna de clave foránea se delega a la relación, que crea uno automáticamente
- Con `--from supabase`, traduce las convenciones de Supabase para una base de datos que estés migrando: un valor predeterminado de columna `auth.uid()` se convierte en `.onCreateUser()` (el servidor escribe el id del invocador), una columna que contiene un id de usuario de Supabase (ese default o una clave foránea a `auth.users`) se convierte en `col.text().userId()`, ya que `rebase.users.id` y `rebase.uid()` son de tipo text, y una política `TO authenticated` / `TO anon` pierde el rol (una base de datos de Rebase no tiene ninguno de los dos) y requiere en su lugar un invocador con sesión iniciada / cerrada; una política exclusiva para `service_role` se descarta. Cada cambio se anota en la parte superior del archivo de la tabla. Sin el flag, estos se dejan como están (Rebase ejecutándose en la misma base de datos junto a Supabase aún los necesita), y la ejecución avisa cuando los encuentra
- Finaliza con lo que **no** transfirió: funciones, triggers, extensiones, CHECKs, índices que `indexes` no puede representar, claves foráneas compuestas de varias columnas o hacia otro esquema. El SQL que recrea cada uno que Postgres puede imprimir se escribe en `backend/sql/introspected-left-behind.sql`, para revisar y aplicar tras el primer push (`psql "$DATABASE_URL" -f …`, o `rebase cloud db query --file …` en Rebase Cloud)
- Te recuerda que `DATABASE_URL` todavía apunta a la base de datos que leyó: en una migración esa es la fuente, y un `db push` en este momento escribiría en ella
- Coloca lo que no pudo determinar con exactitud en un comentario al principio del archivo de la tabla y en la terminal —un conjunto cerrado de cadenas en una columna de texto, una columna generada cuya expresión no leyó, un tipo personalizado— junto con lo que un push le haría
- Con `--data-inference`, muestrea hasta 100 filas por tabla y escribe lo que
  encontró que corresponde a presentación —títulos, iconos, tableros, ordenamientos, opciones de campos— en
  `frontend/src/cms/<table>.tsx` como un `customizeTable`, cuando el frontend
  del proyecto depende de `@rebasepro/cms`. Un proyecto headless no recibe nada
- Frente a una base de datos que no se está ejecutando, imprime el mismo aviso
  que muestra `db push`, una sola vez, y no crea nada. Imprime el directorio de salida
  como una ruta absoluta

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | Dónde escribir los archivos de tabla (por defecto: `backend/schema`). Se eliminó `--output` |
| `--schema` | El esquema de Postgres que se leerá (por defecto: `public`) |
| `--force, -f` | Sobrescribe los archivos de tabla que ya existan; sin esta opción, se omite el archivo existente |
| `--database-url` | Lee esta base de datos en lugar de la del propio proyecto |
| `--docker` | Lee la base de datos de compose, iniciándola si es necesario |
| `--from supabase` | Traduce las convenciones de Supabase (defaults `auth.uid()`, claves foráneas a `auth.users`, `TO anon` / `TO authenticated`) para una base de datos de Rebase. No lo uses si Rebase se ejecuta en la misma base de datos junto a Supabase |
| `--data-inference` / `--no-data-inference` | Muestrea hasta 100 filas por tabla para detectar formatos, restricciones y ajustes de panel, o lee únicamente la estructura. Sin ninguna de las dos opciones preguntará de forma interactiva, y sin una terminal leerá solo la estructura |

Esto resulta útil al adoptar Rebase en una base de datos existente: primero haz introspección y luego edita las tablas generadas. Una tabla con row-level security desactivado se escribe como cualquier otra, con su `rls`; el push activará RLS, y la simulación (dry run) lo indicará. Un backend que se ejecuta sin ningún `backend/schema` sirve la base de datos directamente en su lugar — consulta [Solo backend](/docs/getting-started/headless/). ¿Migrando desde Supabase? Consulta [Migración desde Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Aplica el esquema declarado directamente a la base de datos:

```bash
rebase db push
rebase db push --dry-run
```

Rebase genera un único SQL deseado con tablas, políticas, funciones, índices
de búsqueda y vectoriales, triggers y vistas. Ptah Compat planifica y aplica
estos objetos en conjunto. El plan se limita a los objetos declarados por
Rebase. Las tablas, vistas, extensiones y funciones ajenas quedan intactas.
También se protegen las políticas, triggers, índices y restricciones CHECK y
EXCLUDE personalizados de una tabla declarada.

El comando muestra el plan antes de aplicarlo. Un cambio destructivo, incluido
`DROP EXTENSION`, requiere confirmación o `--allow-destructive`. `--dry-run`
muestra el plan sin modificar la base de datos ni escribir una migración.
Después de que Ptah aplica el plan, Rebase activa RLS, prepara las tablas de autenticación y los roles
de petición, y registra la versión del esquema. Los índices derivados de
claves foráneas que falten se crean antes del plan.

Con PostgreSQL externo, incluido un servicio local de Docker Compose, Ptah puede
reproducir SQL para `db push`, `db push --dry-run` y `db generate`. Usa
`PTAH_DEV_SERVER_DISPOSABLE=1` solo si puedes desechar todo el servidor de
desarrollo. En un servidor compartido, `PTAH_TRUST_REPLAY_SQL=1` permite reproducir
SQL con los permisos de la conexión de desarrollo. Actívalo solo si confías en ese
SQL. PGlite administrado ya es desechable. Consulta la
[configuración](/docs/getting-started/configuration/).

`db push` y `db generate` actualizan `.rebase/sql/` a partir del esquema
actual. Git ignora ese directorio.

| Archivo | Función |
|---------|---------|
| `schema.sql` | Estado deseado de los objetos declarados |
| `search.sql` | Restaura las columnas generadas de búsqueda tras un fallo |
| `policies.sql`, `vector.sql`, `triggers.sql`, `views.sql` | Extractos del SQL generado |

La CLI elimina las copias antiguas de SQL generado de `drizzle/` y conserva `drizzle/migrations/`.

Incluye `backend/drizzle/ptah-managed.json` en Git junto con las migraciones.
Rebase usa los nombres guardados para planificar la eliminación de declaraciones
retiradas.

Una política con nombre generado por Rebase se elimina cuando otra regla la
reemplaza. Una política con nombre personalizado se conserva. Usa
`rebase doctor --policies` para auditar cambios. Para que Rebase administre
una política personalizada, declárala en el `rls` de su tabla.

:::caution
`db push` modifica la base de datos directamente. Úsalo en desarrollo.
Para producción, crea una migración revisable con `db generate` y aplícala
con `db migrate`.
:::

### `rebase db generate`

Crea una migración SQL con marca de tiempo:

```bash
rebase db generate
```

Ptah compara el SQL deseado con el estado reconstruido desde
`backend/drizzle/migrations/`. El diff parte del historial, no de la base
de datos activa. Rebase consulta la base activa para identificar objetos
ajenos. Una columna añadida por el arranque o `db push` sigue apareciendo
en la migración generada.

El comando escribe la migración en `backend/drizzle/migrations/` y advierte sobre
las operaciones destructivas. Si el plan está vacío, no escribe una migración.

Para la primera migración, el comando muestra un ejemplo de `--baseline <version>`.
Comprueba antes que la base de datos coincide con esa versión.

Revisa cada migración en busca de `DROP CONSTRAINT`. Las restricciones CHECK y
EXCLUDE manuales que solo existen en el historial reproducido pueden aparecer como
eliminaciones.

### `rebase db migrate`

Aplica todas las migraciones pendientes:

```bash
rebase db migrate
```

**Qué hace:**
- Lee `drizzle/migrations/` buscando migraciones no aplicadas
- Las aplica en orden a la base de datos
- Lleva el registro de qué migraciones se han aplicado
- Sella las
  políticas de row-level security de la misma forma que lo hacen `db push` y el arranque del servidor, para que
  el primer arranque tras una migración las deje intactas en lugar de recrear cada
  una. Una migración se escribió a partir de las tablas de su momento, por lo que una política se
  sella solo cuando es exactamente lo que su regla genera actualmente: migrate la genera
  nuevamente a partir de su regla bajo otro nombre, en una transacción que revierte, y
  compara lo que almacenó Postgres, tal como hace `db push --dry-run`. Una política que
  difiera no recibe sello, y el próximo arranque reaplicará su tabla

`--refuse-destructive`
hace que rechace la operación en su lugar. Primero ejecuta una simulación de las migraciones pendientes. Si alguna
sentencia destruye datos, según la misma verificación que utilizan `db push` y `db generate`,
enumera esas sentencias y sale con código 1. No aplica nada, ni siquiera los archivos
anteriores a esa sentencia. Sin el flag, `db migrate` se comporta como siempre y
aplica todos los archivos pendientes:

```bash
rebase db migrate --refuse-destructive
```

Una migración que reconstruye una columna de búsqueda la elimina primero, por lo que este flag también rechazará
esa migración. Lee la lista que imprime y luego ejecuta `rebase db migrate`
sin el flag para aplicarla.

#### Establecer una línea base (baseline) en una base de datos que Rebase ya ha arrancado

Cada arranque de Rebase asegura el esquema, y `rebase db push` lo aplica directamente. Por lo tanto, una base de datos que haya ejecutado cualquiera de los dos ya contiene las tablas y tipos que la primera migración crearía, y `rebase db migrate` se detendrá con el error `type "posts_status" already exists (42710)`.

La migración no tiene ningún problema: la base de datos fue aprovisionada por otra vía. Registra el punto en el que ya se encuentra y luego migra con normalidad:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versión corresponde al prefijo numérico del archivo de migración que describe lo que hay en la base de datos *ahora*. Esa migración y todas las anteriores se registran como aplicadas; todo lo posterior se ejecuta. En una base de datos contra la que nunca se haya arrancado nada, no se requiere baseline: migra directamente.

Para una migración posterior, usa una línea base solo tras aplicar y verificar
todos los cambios pendientes hasta esa versión, incluidas las eliminaciones y
actualizaciones de datos. Una columna que ya existe solo demuestra un cambio.

### `rebase db branch`

Ramificación de bases de datos para desarrollo paralelo:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (y `switch --off`) y `rebase db branch prune`
son nuevos. `create`, `list`, `info` y `delete` se lanzaron en la versión 0.17.

Cada rama es una copia completa de la base de datos creada con `CREATE DATABASE ... TEMPLATE`,
por lo que requiere un servidor PostgreSQL real y ocupa el mismo espacio en disco que su origen.

### `rebase doctor`

Detecta discrepancias triples (three-way drift) entre tus tablas, el esquema generado de Drizzle y la base de datos PostgreSQL activa:

```bash
rebase doctor
```

**Qué comprueba:**
- Tablas ↔ Esquema generado — ¿están sincronizados?
- Esquema generado ↔ Base de datos — ¿hay cambios sin aplicar?
- Tablas ↔ Base de datos — ¿hay alguna discrepancia inesperada?

Ejecuta `doctor` siempre que sientas que algo está desincronizado. Identifica con exactitud dónde se encuentra la discrepancia.

La comparación con la base de datos incluye la que realiza el arranque antes de advertir que `schema.generated.ts` y la base de datos difieren, ejecutada a través del mismo código. Por ende, cada diferencia advertida por el arranque aparece también en el informe, con las mismas palabras: una columna que es NOT NULL en un lado y anulable en el otro, y una columna que la base de datos aún conserva pero el archivo no (el arranque nunca elimina una, por lo que una propiedad renombrada deja su columna anterior rezagada). Cada caso es una advertencia, y la solución indica `rebase db push`.

La comparación con la base de datos lee la base de datos del proyecto, resuelta de la misma forma en que lo hace `rebase db url` —en un andamiaje nuevo, la administrada, la cual `doctor` inicia. Si no se puede resolver ninguna, esa fase se reporta como **omitida** (skipped) en lugar de aprobada, y la ejecución nunca concluye con "All schemas are in sync" — una comprobación que no se realizó no garantiza un estado óptimo.

También señala cada tabla sin un [bloque `search`](/docs/backend/search) que contenga más de aproximadamente 10,000 filas. Una búsqueda en ella —el cuadro de búsqueda del administrador, `.search()`, `?searchString=`— es un `ILIKE '%term%'` sobre las columnas de texto, el cual ningún índice puede optimizar, por lo que cada búsqueda lee toda la tabla y su conteo la lee nuevamente (alrededor de un tercio de segundo para 100,000 filas, aumentando con el tamaño de la tabla). El recuento de filas es una estimación propia de Postgres, por lo que la comprobación no escanea datos. Es una sugerencia: no altera el código de salida y no se indexa nada automáticamente por ti.

Indica si existe una **unión huérfana**: una tabla en `public` con estructura de unión many-to-many que ninguna tabla declara. Esta estructura consiste en dos columnas que juntas forman la clave primaria, siendo cada una clave foránea hacia una tabla declarada. Renombrar o eliminar un `manyToMany` deja su unión antigua rezagada, ya que push y el arranque solo crean tablas, y cada fila de enlace todavía reside en ella. La nota es solo informativa, por lo que no altera el código de salida. Su solución es la sentencia `DROP TABLE`, la cual `doctor` muestra y nunca ejecuta.

### `rebase generate-sdk`

Genera un SDK tipado a partir de tus tablas:

```bash
rebase generate-sdk
```

**Qué hace:**
- Lee las tablas que exporta `backend/schema/index.ts`, a través del loader con el que arranca el backend, de modo que el SDK describa exactamente las tablas servidas; un esquema que no compile detiene el proceso
- Genera tipos de TypeScript para cada tabla en `generated/sdk/`
- Produce un archivo `database.types.ts` para usar con `createRebaseClient<Database>()`: el tipo `Database`, `TableName` (la unión de todos los slugs), y `tablesDictionary` / `TablesDictionary`, el mapa del descriptor de acceso al slug

`rebase dev` ejecuta esto por ti al iniciar y en cada guardado dentro de
`backend/schema/`. Ejecútalo manualmente en CI, en un repositorio que no contenga
tablas propias (consulta `--from` más abajo), o en cualquier entorno donde `rebase dev` no se esté ejecutando.

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | El directorio del esquema (por defecto: `backend/schema`, o la clave `tables` en `rebase.json`); las rutas relativas se resuelven desde donde ejecutas el comando |
| `-o`, `--output` | Directorio de salida para el SDK (por defecto: `generated/sdk/`) |
| `--from <link\|url>` | Lee el esquema desde un proyecto en ejecución en lugar del código fuente local. `link` utiliza el proyecto vinculado a este checkout. |
| `--token` | Token Bearer para el endpoint del contrato (por defecto: `$REBASE_SERVICE_KEY` de la shell; `.env` no se lee) |
| `--register` | También tipa los datos del lado del servidor: escribe los tipos y una declaración `Register` en `backend/generated/`, y lo registra en `rebase.json` — consulta [Datos tipados del lado del servidor](/docs/backend/typed-server-data/) |

`--from` permite que un repositorio sin tablas —un frontend independiente, una segunda aplicación web, una aplicación móvil— genere un cliente tipado a partir del
proyecto con el que se comunica: lee las `tables` del `/api/meta/contract` del backend en ejecución. `REBASE_SERVICE_KEY` solo se envía al proyecto al que este
checkout está vinculado; pasa `--token` explícitamente para cualquier otro host. La clave en
`.env` pertenece a tu backend local y nunca se envía.
Un rechazo indica
cuál de las siguientes situaciones ocurrió: un `--token` rechazado, una clave de shell rechazada, una clave
retenida ante un host que no está vinculado, una clave presente únicamente en `.env`, o ninguna clave provista.

**Uso después de la generación:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

Los nombres de campo en los tipos generados son los que sirve la API. El nombre
utilizado para la transferencia es la clave de su columna, y la API utiliza camelCase en todo momento: la introspección
escribe una columna `created_at` como `createdAt: col.timestamp({ withTimezone: true })`, cuyo nombre SQL
es el snake_case de la clave, y la sirve como `row.createdAt`. La columna
en sí no se modifica. El *accessor* de la tabla se convierte en un nombre de propiedad
de la misma manera (`my-notes` → `client.data.myNotes`), que es lo que `tablesDictionary`
mapea nuevamente al slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` traslada `config/collections` a
`backend/schema` (un `defineTable` por colección, cada columna explícita en
su posición original, con la nomenclatura de Drizzle, y `index.ts` con
`defaultRls`) y a `frontend/src/cms` (un `customizeTable` por cada colección personalizada,
archivos `defineFirestoreCollection`, `ui-config.json`), escribe
`backend/resources.ts`, `backend/storage.ts` y `backend/generated/register.ts`,
añade `rebaseBackendGuard()` al `vite.config.ts` de un andamiaje, y luego ejecuta
`rebase migrate sdk-calls`, que reescribe `.collection(` a `.table(`, los
demás cambios de nombre del SDK y las fuentes de reglas `existsIn` / `membership` en tu código,
y traslada las importaciones de elementos que la versión 0.31 movió a otro paquete
([el listado](/docs/upgrading/0-30-to-0-31-imports/)), añadiendo el paquete a las
dependencias del importador ("Dependencies added": ejecuta `pnpm install`). Actualiza cada paquete `@rebasepro` a la versión 0.31 antes de ejecutarlo.
Cada ejecución vuelve a leer el resultado: el SQL generado —DDL, políticas, búsqueda,
vectores, triggers, vistas, el esquema de Drizzle— debe ser idéntico byte por byte, o de lo contrario cada
archivo se restaura. Lo que no se pueda transferir se rechaza indicando archivo y línea, y
lo que quede a tu cargo se imprime como pasos manuales numerados, terminando con
`rebase skills install` cuando el proyecto contenga agent skills. Tus propios módulos en
`config/` se mantienen; la ejecución imprime la línea de `git rm` para lo que haya reemplazado. También
rastrea colecciones de Firestore que construye una función, alias de rutas, un panel montado
fuera de `App.tsx` y cualquier aplicación estática no protegida ([la lista completa](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Tras el `git rm`, `--check` reporta `already-migrated`.

| Flag | Efecto |
|---|---|
| `--dry-run` | Imprime archivos, rechazos, notas y pasos manuales; no escribe nada. Comienza por aquí. |
| `--check` | En un proyecto migrado: comprueba que `backend/schema` todavía genere el mismo SQL. Sale con código 1 mostrando el diff, o si una regla cambia de significado. |
| `--accept-rule-changes` | Con `--check`: las reglas bajo "Review before deploying" han sido revisadas. |
| `--json` / `--force` / `--skip-sdk-calls` | El informe en formato JSON (con `ruleChanges`); ejecutar sobre un árbol de trabajo sucio o sobre salidas editadas; no modifica tu código. |

Revisa dos listas en la salida de su SDK: **"Rewritten by name — review"** (receptores
no tipados, data slots, dobles de prueba) y **"Left unchanged — check each"**
(renombra aquellos que correspondan al SDK; [una búsqueda](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) localiza el resto).

La comprobación de SQL demuestra que la conversión es fiel, no que una regla siga significando lo
mismo que antes. La última sección de la salida, **"Review before deploying: these rules
change meaning"**, lista cada regla cuya política ahora concede algo diferente
—un `access: "authenticated"` simple no concedía nada y ahora admite a cualquier usuario
autenticado ([los cuatro casos](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Luego, comprueba contra tu base de datos: `rebase db push --dry-run` debería imprimir "No
changes: the database already matches the declared schema.", y
`rebase doctor --policies` ningún desfase.

## Flujo de trabajo en desarrollo

El flujo de trabajo de iteración rápida para desarrollo:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Flujo de trabajo en producción

El flujo de trabajo seguro y auditable para producción:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Review the generated SQL in backend/drizzle/migrations/
# 5. Commit the migration to version control
git add backend/drizzle/migrations/ backend/drizzle/ptah-managed.json

# 6. Apply in production
#    A database Rebase has already booted needs a baseline the first time —
#    see "Baselining a database Rebase has already booted" above.
rebase db migrate
```

## Resolución de problemas

| Síntoma | Solución |
|---------|----------|
| `Could not detect an active database plugin` | Instala `@rebasepro/server-postgres` en `backend/package.json` |
| El archivo de esquema no se actualiza | Verifica que la ruta de `--schema-dir` (o la clave `tables` en `rebase.json`) apunte al directorio correcto |
| La migración muestra cambios inesperados | Ejecuta `rebase doctor` para identificar discrepancias (drift) |
| `db push` falla en producción | Usa `db generate` + `db migrate` en su lugar |
| Una migración no debe eliminar datos en CI o producción | `rebase db migrate --refuse-destructive` sale con código 1 y no aplica nada cuando una sentencia pendiente destruye datos |
| `db migrate` falla con `already exists (42710)` | Verifica todos los cambios hasta esa versión, incluidas las eliminaciones y actualizaciones de datos, antes de establecer la línea base. |
| `db migrate` falla con `column … already exists (42701)` | Verifica todos los cambios hasta esa versión, incluidas las eliminaciones y actualizaciones de datos, antes de establecer la línea base. |

## Próximos pasos

- **[Tablas](/docs/schema/)** — Define tu modelo de datos
- **[Referencia de la CLI](/docs/cli)** — Todos los comandos de la CLI
- **[SDK tipado](/docs/sdk)** — Usa el SDK generado
