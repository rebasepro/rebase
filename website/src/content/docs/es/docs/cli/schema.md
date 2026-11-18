---
sourceHash: 28ddba8b909b96aa
title: Generación de esquemas
sidebar_label: Generación de esquemas
description: Genera esquemas de Drizzle ORM a partir de las tablas en backend/schema, crea migraciones SQL, realiza introspección de una base de datos existente hacia archivos defineTable y mantén tu base de datos sincronizada con la CLI de Rebase.
---

## Descripción general

Rebase utiliza un pipeline de **esquema como código** (schema-as-code) donde las tablas que declaras con
`defineTable` en `backend/schema/` son la única fuente de verdad. La CLI
las transforma a través de un pipeline determinista:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página cubre cada comando de la CLI involucrado en ese pipeline.

## El Pipeline

### 1. Tablas → Esquema de Drizzle

Las tablas que exporta `backend/schema/index.ts` describen columnas, tipos, relaciones,
enums y seguridad a nivel de fila (RLS). Cada comando a continuación las lee a través del cargador
con el que arranca el backend, por lo que un esquema que no compile (una tabla sin
`rls`, `"inherit"` sin `defaultRls`, un `defineTable` que el index no
exporte) detiene el comando con un `SchemaDefinitionError` detallando cada problema,
y no se escribe nada. El comando `schema generate` genera un archivo de esquema
de Drizzle ORM a partir de ellas.

Cada comando que lee el esquema acepta `--schema-dir <dir>` para proyectos
que guardan sus tablas en otra ubicación; el valor predeterminado es `backend/schema`, o la
clave `tables` de la aplicación backend en `rebase.json`. `--collections` / `-c`, el
flag anterior a la versión 0.31, se rechaza con un mensaje que indica el codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), al igual que un
proyecto que todavía contenga `config/collections`.

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
- Genera `backend/src/schema.generated.ts` con definiciones de tablas de Drizzle, enums y relaciones

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | El directorio del esquema (por defecto: `backend/schema`); las rutas relativas se resuelven desde donde ejecutas el comando |
| `--output, -o` | Ruta de salida para el archivo de esquema generado; las rutas relativas se resuelven desde donde ejecutas el comando |
| `--watch, -w` | Observa los cambios y regenera automáticamente |

El **modo watch** es útil durante el desarrollo; edita un archivo de tabla y el esquema se regenerará al instante:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Comprueba si el esquema generado todavía coincide con las tablas:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**Qué hace:**
- Renderiza lo que generan las tablas en `backend/schema/` y lo compara, declaración por declaración, con `backend/src/schema.generated.ts`
- Nombra cada diferencia (una tabla faltante, una columna con el tipo cambiado, una etiqueta de enum eliminada o claves foráneas nombradas como las derivaba una versión anterior) y sale con un código distinto de cero
- Con `--fix`, regenera el archivo en lugar de solo emitir el informe

`rebase dev` mantiene el archivo actualizado por sí mismo, por lo que esta es la comprobación adecuada para un paso de compilación o CI. Acepta `--schema-dir` y `--output` al igual que `rebase schema generate`.

### `rebase schema reconcile`

Relaja y elimina lo que el arranque no hará, después de haber revisado el plan:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Qué hace:**
- Solicita al backend en ejecución que planifique contra su propia base de datos. Es hacia donde apuntan el `.env` del backend y el enlace a la nube, por lo que funciona en Rebase Cloud, donde nada más puede acceder a la base de datos.
- Planifica un `DROP NOT NULL` para cada columna que una tabla declare como anulable pero que la base de datos aún requiera.
- Lista cada columna que ninguna tabla declare. Una columna que sea `NOT NULL` sin un valor por defecto bloquea cada inserción, por lo que también se relaja y sus datos permanecen. Solo elimina las columnas que especifiques con `--drop <table>.<column>`, y muestra cuántas filas contienen un valor en cada una.
- Se aplica una vez que escribes `yes`. El servidor ejecuta el plan únicamente sobre el digest del que leíste; por lo tanto, si la base de datos o las tablas cambiaron en el transcurso, lo rechaza y debes revisar de nuevo. `--yes` omite la confirmación.

El arranque únicamente añade cosas, por lo que tras eliminar una columna de su `defineTable`, la columna permanece en la base de datos junto con sus datos. Una columna `NOT NULL` sin valor por defecto hará que fallen todas las inserciones, y el registro del arranque indicará este comando: sin `--drop` para mantener los datos, o con él para eliminar la columna. Despliega primero el cambio de la tabla, porque reconcile planifica contra lo que ejecuta el backend. Requiere `REBASE_SERVICE_KEY` en `.env`. A nivel local, `rebase db push` cubre lo mismo mediante su control de cambios destructivos.

### `rebase schema introspect`

Escribe archivos `defineTable` a partir de una base de datos PostgreSQL existente:

```bash
rebase schema introspect
```

**Qué hace:**
- Se conecta a la base de datos de este proyecto, la que imprime `rebase db url` (la administrada se inicia si es esa); `--database-url` especifica otra, y `--docker` usa la de compose
- Lee cada tabla, columna, tipo, clave foránea y política, y escribe `backend/schema/<table>.ts` —un `defineTable` por tabla— y el `backend/schema/index.ts` que las exporta (fusionado en un index si ya existe uno)
- Declara cada columna con su tipo de Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, un enum con sus etiquetas y el nombre real del tipo
  (un `pgEnum` cuando el tipo es compartido), un array como `<item>.array()`,
  `col.vector({ dimensions })`, claves de identidad y seriales, valores por defecto —escritos tal como
  los define Drizzle. Un tipo que ningún constructor reconozca se convierte en
  `col.custom({ dataType: "<sql type>" })`, el cual Rebase sirve tal como lo devuelve
  el controlador; `db generate` y `db push` lo rechazan hasta que el planificador
  pueda interpretarlo
- Declara la columna de clave foránea, el `belongsTo` en ella y el `hasMany` inverso
  en el destino; una tabla de unión se convierte en un `manyToMany`, y sus propias
  columnas en el `pivot`
- Lee las políticas de seguridad a nivel de fila (RLS) de cada tabla en su `rls`: nombre,
  comando, modo, lista `TO`, `USING` y `WITH CHECK`. Las políticas `<table>_default_*`
  que Rebase añade por su cuenta se omiten, de modo que el `db push` posterior recrea
  cada política tal como estaba. Una tabla con seguridad a nivel de fila activada y sin políticas se
  escribe como `rls: "admin-only"`
- Lee cada expresión (el `USING` de una política, un CHECK, un valor por defecto de columna) bajo
  el `search_path` que utiliza el servidor, `public`, por lo que una función en el esquema
  `rebase` se escribe como `rebase.roles()`
- Convierte un CHECK que pueda interpretar (`total >= 0`) en el `.validate()` de la columna, y
  mantiene la restricción intacta en la base de datos, donde el push posterior la conserva
- Deja lo que no pudo determinar con exactitud en un comentario en la parte superior del archivo
  de la tabla y en la terminal —un conjunto cerrado de cadenas en una columna de texto, una
  columna generada cuya expresión no pudo leer, un tipo personalizado— junto con lo que
  un push le haría
- Con `--data-inference`, muestrea hasta 100 filas por tabla y escribe lo que
  encontró que pertenezca a la presentación (títulos, iconos, tableros, ordenaciones, opciones de campo) en
  `frontend/src/cms/<table>.tsx` como un `customizeTable`, cuando el frontend del proyecto
  depende de `@rebasepro/cms`. Un proyecto headless no recibe nada
- Frente a una base de datos que no esté en ejecución, imprime el mismo aviso que
  `db push`, una sola vez, y no crea nada. Imprime el directorio de salida como una
  ruta absoluta

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | Dónde escribir los archivos de tabla (por defecto: `backend/schema`). `--output` fue eliminado |
| `--schema` | El esquema de Postgres a leer (por defecto: `public`) |
| `--force, -f` | Sobrescribe los archivos de tabla que ya existen; sin él, un archivo existente se omite |
| `--database-url` | Lee esta base de datos en lugar de la del propio proyecto |
| `--docker` | Lee la base de datos de compose, iniciándola si es necesario |
| `--data-inference` / `--no-data-inference` | Muestrea hasta 100 filas por tabla para detectar formatos, restricciones y ajustes de panel, o lee solo la estructura. Sin ninguno de los dos, pregunta; y sin una terminal, lee únicamente la estructura |

Esto es útil al adoptar Rebase en una base de datos existente: realiza la introspección
primero y luego edita las tablas generadas. Una tabla con la seguridad a nivel de fila desactivada se
escribe como cualquier otra, con su `rls`; el push activará RLS, y el simulacro
(dry-run) lo advertirá. Un backend que se ejecute sin ningún `backend/schema` sirve
la base de datos directamente en su lugar — consulta [Solo backend](/docs/getting-started/headless/).

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
- Lee `drizzle/migrations/` en busca de migraciones no aplicadas
- Las aplica en orden a la base de datos
- Registra qué migraciones se han aplicado
- Sella las
  políticas de seguridad a nivel de fila de la misma manera que lo hacen `db push` y el arranque del servidor, para
  que el primer arranque posterior a un migrate las deje intactas en lugar de recrearlas todas.
  Una migración fue escrita a partir de las tablas de su momento, por lo que una política se
  sella únicamente cuando coincide con exactitud con lo que su regla genera actualmente: migrate la genera
  de nuevo a partir de su regla bajo otro nombre, en una transacción que luego revierte, y
  compara lo que almacenó Postgres, tal como hace `db push --dry-run`. Una política que
  difiera no recibe sello, y el próximo arranque vuelve a aplicarla a su tabla

`--refuse-destructive`
hace que lo rechace. Ejecuta primero un simulacro (dry-run) de las migraciones pendientes. Si alguna
sentencia destruye datos, según la misma verificación que usan `db push` y `db generate`,
lista dichas sentencias y sale con código 1. No aplica nada, ni siquiera los archivos
anteriores a esa sentencia. Sin el flag, `db migrate` se comporta como siempre y
aplica cada archivo pendiente:

```bash
rebase db migrate --refuse-destructive
```

Una migración que reconstruye una columna de búsqueda primero la elimina, por lo que este flag también
rechazará esa migración. Revisa la lista que imprime y luego ejecuta `rebase db migrate`
sin el flag para aplicarla.

#### Establecer una línea base en una base de datos que Rebase ya ha iniciado

Cada arranque de Rebase asegura el esquema, y `rebase db push` lo aplica directamente. Por lo tanto, una base de datos que haya ejecutado cualquiera de los dos ya contiene las tablas y tipos que la primera migración crearía, y `rebase db migrate` se detendrá con el error `type "posts_status" already exists (42710)`.

No hay nada malo con la migración; la base de datos fue aprovisionada por otra vía. Registra el punto en el que ya se encuentra y luego migra normalmente:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versión es el prefijo numérico del archivo de migración que describe lo que hay en la base de datos *ahora*. Esa migración y todo lo anterior se registran como aplicados; todo lo posterior se ejecuta. En una base de datos contra la cual nunca se ha iniciado nada, no se necesita línea base: migra de inmediato.

Para una migración posterior, usa una línea base solo tras aplicar y verificar
todos los cambios pendientes hasta esa versión, incluidas las eliminaciones y
actualizaciones de datos. Una columna que ya existe solo demuestra un cambio.

### `rebase db branch`

Ramificación de bases de datos para desarrollo en paralelo:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (y `switch --off`) junto con `rebase db branch prune`
son nuevos. `create`, `list`, `info` y `delete` se incorporaron en la versión 0.17.

Cada rama es una copia completa de la base de datos realizada con `CREATE DATABASE ... TEMPLATE`,
por lo que requiere un servidor PostgreSQL real y consume el mismo espacio en disco que su origen.

### `rebase doctor`

Detecta desajustes a tres bandas entre tus tablas, el esquema de Drizzle generado y la base de datos PostgreSQL activa:

```bash
rebase doctor
```

**Qué comprueba:**
- Tablas ↔ Esquema generado — ¿están sincronizados?
- Esquema generado ↔ Base de datos — ¿hay cambios pendientes de aplicar?
- Tablas ↔ Base de datos — ¿existe algún desfase (drift) inesperado?

Ejecuta `doctor` siempre que sientas que algo está desincronizado. Te señalará exactamente dónde está la discrepancia.

La comparación con la base de datos incluye la que el arranque realiza antes de advertir que `schema.generated.ts` y la base de datos no coinciden, ejecutada mediante el mismo código. Por lo tanto, cada diferencia sobre la que el arranque advierte también está en el informe, con las mismas palabras: una columna que es NOT NULL en un lado y anulable en el otro, y una columna que la base de datos todavía tiene pero el archivo no (el arranque nunca elimina una, por lo que una propiedad renombrada deja atrás su columna antigua). Cada una es una advertencia, y la solución indica usar `rebase db push`.

La comparación con la base de datos lee la base de datos del proyecto, resuelta de la forma en que `rebase db url` la resuelve —en un proyecto recién generado será la administrada, la cual `doctor` inicia. Cuando no se puede resolver ninguna, esa fase se reporta como **omitida** (skipped) en lugar de superada, y la ejecución nunca concluye con "All schemas are in sync" —una comprobación que no se realizó no equivale a un estado saludable garantizado.

También lista cada tabla sin un [bloque `search`](/docs/backend/search) cuya tabla contenga más de unas 10.000 filas. Una búsqueda allí —el cuadro de búsqueda del administrador, `.search()`, `?searchString=`— se traduce en un `ILIKE '%term%'` sobre las columnas de texto, el cual ningún índice puede optimizar, por lo que cada consulta lee la tabla completa y el conteo la vuelve a leer por completo (alrededor de un tercio de segundo con 100.000 filas, aumentando con el tamaño de la tabla). La cantidad de filas es la propia estimación de Postgres, por lo que la comprobación no escanea nada. Es solo una sugerencia: no modifica el código de salida y no se indexa nada automáticamente por ti.

Indica una **unión huérfana**: una tabla en `public` estructurada como una unión muchos a muchos que ninguna tabla declara. La estructura consiste en dos columnas que juntas forman la clave primaria, siendo cada una de ellas una clave foránea hacia una tabla declarada. Renombrar o eliminar un `manyToMany` deja atrás su unión antigua, ya que push y el arranque solo crean tablas, y cada fila de enlace todavía está presente en ella. La nota es solo informativa, por lo que no altera el código de salida. Su solución es la sentencia `DROP TABLE`, que `doctor` muestra pero nunca ejecuta por su cuenta.

### `rebase generate-sdk`

Genera un SDK tipado a partir de tus tablas:

```bash
rebase generate-sdk
```

**Qué hace:**
- Lee las tablas que exporta `backend/schema/index.ts`, a través del cargador con el que arranca el backend, para que el SDK describa exactamente las tablas servidas; un esquema que no compile detiene la ejecución
- Genera tipos de TypeScript para cada tabla en `generated/sdk/`
- Produce un archivo `database.types.ts` para usar con `createRebaseClient<Database>()`: el tipo `Database`, `TableName` (la unión de todos los slugs), y `tablesDictionary` / `TablesDictionary`, el mapa del descriptor de acceso al slug

`rebase dev` ejecuta esto por ti al iniciar y en cada guardado dentro de
`backend/schema/`. Ejecútalo manualmente en CI, en un repositorio que no tenga
tablas propias (consulta `--from` más abajo), o en cualquier lugar donde `rebase dev` no se esté ejecutando.

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | El directorio del esquema (por defecto: `backend/schema`, o la clave `tables` en `rebase.json`); las rutas relativas se resuelven desde donde ejecutas el comando |
| `-o`, `--output` | Directorio de salida para el SDK (por defecto: `generated/sdk/`) |
| `--from <link\|url>` | Lee el esquema desde un proyecto en ejecución en lugar del código fuente local. `link` utiliza el proyecto vinculado a esta copia local. |
| `--token` | Token Bearer para el endpoint de contrato (por defecto: `$REBASE_SERVICE_KEY` desde la shell; no se lee `.env`) |
| `--register` | También tipa los datos del lado del servidor: escribe los tipos y una declaración `Register` en `backend/generated/`, y lo recuerda en `rebase.json` — consulta [Datos tipados del lado del servidor](/docs/backend/typed-server-data/) |

`--from` es lo que permite que un repositorio que no contiene tablas —un
frontend independiente, una segunda aplicación web, una aplicación móvil— genere un cliente tipado desde el
proyecto con el que se comunica: lee las `tables` del endpoint
`/api/meta/contract` del backend en ejecución. `REBASE_SERVICE_KEY` solo se envía al proyecto al que
esta copia local está vinculada; pasa `--token` explícitamente para cualquier otro host. La clave en
`.env` pertenece a tu backend local y nunca se envía.
Un rechazo indica
cuál de estas situaciones ocurrió: un `--token` rechazado, una clave de shell rechazada, una clave
no enviada a un host no vinculado, una clave presente solo en `.env`, o ninguna clave en absoluto.

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
en la transmisión de un campo es su clave de columna, y la API utiliza camelCase en todo momento: la introspección
escribe una columna `created_at` como `createdAt: col.timestamp({ withTimezone: true })`, cuyo nombre SQL
es el snake_case de la clave, y la sirve como `row.createdAt`. La columna
en sí no se modifica. El *descriptor de acceso* (accessor) de la tabla se convierte en un nombre de propiedad
de la misma manera (`my-notes` → `client.data.myNotes`), que es lo que `tablesDictionary`
asocia de vuelta al slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` traslada `config/collections` a
`backend/schema` (un `defineTable` por colección, cada columna explícita en
su posición original, con la sintaxis de Drizzle, e `index.ts` con
`defaultRls`) y `frontend/src/cms` (un `customizeTable` por colección personalizada,
archivos `defineFirestoreCollection`, `ui-config.json`), escribe
`backend/resources.ts`, `backend/storage.ts` y `backend/generated/register.ts`,
añade `rebaseBackendGuard()` al `vite.config.ts` de una plantilla inicial, y luego ejecuta
`rebase migrate sdk-calls`, el cual reescribe `.collection(` a `.table(`, los
demás cambios de nombre del SDK y los orígenes de reglas `existsIn` / `membership` en tu código,
y traslada las importaciones de los nombres que la versión 0.31 movió a otro paquete
([el listado](/docs/upgrading/0-30-to-0-31-imports/)), añadiendo el paquete a las
dependencias del importador ("Dependencies added": ejecuta `pnpm install`). Actualiza cada paquete `@rebasepro` a la versión 0.31 antes de ejecutarlo.
Cada ejecución vuelve a leer el resultado: el SQL generado —DDL, políticas, búsqueda,
vectores, triggers, vistas, el esquema de Drizzle— debe ser idéntico byte por byte, o de lo contrario cada
archivo se restaura. Lo que no pueda trasladar se rechaza indicando su archivo y línea, y
lo que te deja a ti se imprime como pasos manuales numerados, terminando con
`rebase skills install` cuando el proyecto incluye agent skills. Tus propios módulos en
`config/` se conservan; la ejecución imprime la línea `git rm` para lo que reemplazó. También
rastrea colecciones de Firestore que cree una función, alias de rutas, un panel montado
fuera de `App.tsx` y cualquier aplicación estática no protegida ([la lista completa](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Después del `git rm`, `--check` reportará `already-migrated`.

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

## Flujo de trabajo de desarrollo

El flujo de trabajo de iteración rápida para desarrollo:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Flujo de trabajo de producción

El flujo de trabajo seguro y revisable para producción:

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

## Solución de problemas

| Síntoma | Solución |
|---------|----------|
| `Could not detect an active database plugin` | Instala `@rebasepro/server-postgres` en `backend/package.json` |
| El archivo de esquema no se actualiza | Comprueba que la ruta `--schema-dir` (o la clave `tables` en `rebase.json`) apunte al directorio correcto |
| La migración muestra cambios inesperados | Ejecuta `rebase doctor` para identificar el desfase (drift) |
| `db push` falla en producción | Usa `db generate` + `db migrate` en su lugar |
| Una migración no debe eliminar datos en CI o producción | `rebase db migrate --refuse-destructive` sale con código 1 y no aplica nada cuando una sentencia pendiente destruye datos |
| `db migrate` falla con `already exists (42710)` | Verifica todos los cambios hasta esa versión, incluidas las eliminaciones y actualizaciones de datos, antes de establecer la línea base. |
| `db migrate` falla con `column … already exists (42701)` | Verifica todos los cambios hasta esa versión, incluidas las eliminaciones y actualizaciones de datos, antes de establecer la línea base. |

## Próximos pasos

- **[Tablas](/docs/schema/)** — Define tu modelo de datos
- **[Referencia de CLI](/docs/cli)** — Todos los comandos de la CLI
- **[SDK tipado](/docs/sdk)** — Usa el SDK generado
