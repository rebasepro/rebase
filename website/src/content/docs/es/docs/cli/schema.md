---
sourceHash: a1e48da6a746fb71
title: Generación de esquemas
sidebar_label: Generación de esquemas
description: Genera esquemas de Drizzle ORM a partir de las tablas en backend/schema, crea migraciones SQL, realiza introspección de una base de datos existente en archivos defineTable y mantén tu base de datos sincronizada con la CLI de Rebase.
---

## Descripción general

Rebase utiliza un pipeline de **schema-as-code** (esquema como código) donde las tablas que declaras con
`defineTable` en `backend/schema/` son la única fuente de verdad. La CLI
las transforma a través de un pipeline determinista:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página cubre todos los comandos de la CLI involucrados en ese pipeline.

## ¿Cuál debo usar?

Un cambio en una tabla llega a PostgreSQL de tres formas:

- **Arranque (Boot), por sí solo.** El backend aplica la parte aditiva en cada inicio (`REBASE_MIGRATE_ON_BOOT=ensure`, el valor predeterminado): tablas, columnas, tipos enum y políticas de seguridad a nivel de fila (RLS) faltantes. Bajo `rebase dev`, una tabla o columna agregada no necesita nada más. El arranque nunca elimina (drop), renombra ni restringe (narrow).
- **`rebase db push`, en desarrollo.** Sincroniza el esquema directamente con la base de datos, incluyendo eliminaciones y cambios de nombre, tras su [filtro de cambios destructivos](#rebase-db-push). Úsalo en una base de datos que no migres.
- **`rebase db generate` + `rebase db migrate`, en producción.** Cada cambio es un archivo SQL revisado en el control de versiones, aplicado en orden.

Mover a migraciones una base de datos que el arranque o `db push` ya ha configurado requiere un punto de referencia (baseline), ya que contiene previamente las tablas que crea la primera migración. `rebase db migrate` lee esto antes de ejecutar nada, se detiene e imprime el comando `rebase db migrate --baseline <version>` a ejecutar con la versión completada; consulta [Establecer una línea base en una base de datos que Rebase ya ha iniciado](#establecer-una-línea-base-baseline-en-una-base-de-datos-que-rebase-ya-ha-iniciado). A la inversa, `db push` en una base de datos que registra migraciones lo indica en una sola línea: la siguiente migración que realice el mismo cambio se detendrá en `already exists`.

## El Pipeline

### 1. Tablas → Esquema de Drizzle

Las tablas que exporta `backend/schema/index.ts` describen columnas, tipos, relaciones,
enums y seguridad a nivel de fila. Cada uno de los siguientes comandos las lee a través del cargador
con el que inicia el backend, por lo que un esquema que no compila —una tabla sin
`rls`, `"inherit"` sin `defaultRls`, un `defineTable` que el índice no
exporta— detiene el comando con un `SchemaDefinitionError` que especifica cada problema,
y no se escribe nada. El comando `schema generate` genera un archivo de esquema de Drizzle ORM
a partir de ellas.

Cada comando que lee el esquema acepta `--schema-dir <dir>` para proyectos
que guardan sus tablas en otra ubicación; el valor predeterminado es `backend/schema`, o la
clave `tables` de la aplicación backend en `rebase.json`. La opción previa a 0.31, `--collections` / `-c`,
se rechaza con un mensaje que indica el codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), al igual que cualquier
proyecto que todavía conserve `config/collections`.

### 2. Esquema de Drizzle → Migraciones

A partir del esquema generado de Drizzle, `db generate` calcula las diferencias frente a las migraciones que ya existen en `backend/drizzle/migrations/`, reproducidas en una base de datos temporal (scratch), y genera archivos de migración SQL con marca de tiempo. Nunca lee tu base de datos: una columna que el arranque o `db push` ya haya añadido seguirá apareciendo como `ADD COLUMN`.

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
| `--schema-dir` | El directorio de esquemas (por defecto: `backend/schema`); las rutas relativas se resuelven desde donde ejecutas el comando |
| `--output, -o` | Ruta de salida para el archivo de esquema generado; las rutas relativas se resuelven desde donde ejecutas el comando |
| `--watch, -w` | Observa los cambios y regenera automáticamente |

El **modo de observación (watch mode)** es útil durante el desarrollo: edita un archivo de tabla y el esquema se regenerará instantáneamente:

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
- Especifica cada diferencia —una tabla faltante, una columna con tipo cambiado, una etiqueta enum eliminada o claves foráneas nombradas como las derivaba una versión anterior— y sale con un código distinto de cero
- Con `--fix`, regenera el archivo en lugar de generar un reporte

`rebase dev` mantiene el archivo actualizado automáticamente, por lo que esta comprobación es
ideal para una compilación o un paso de CI. Acepta `--schema-dir` y `--output` al
igual que `rebase schema generate`.

### `rebase schema reconcile`

Flexibiliza y elimina lo que el arranque no puede, después de haber revisado el plan:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Qué hace:**
- Solicita al backend en ejecución que planifique contra su propia base de datos. A eso apuntan el `.env` del backend y el enlace a la nube, por lo que funciona en Rebase Cloud, donde nada más tiene acceso a la base de datos.
- Planifica un `DROP NOT NULL` para cada columna que una tabla declara como nullable pero que la base de datos aún exige.
- Lista cada columna que ninguna tabla declara. Una columna que sea `NOT NULL` sin valor predeterminado bloquea cada inserción, por lo que también se flexibiliza y sus datos se conservan. Solo elimina las columnas que indiques con `--drop <table>.<column>` y muestra cuántas filas contienen un valor en cada una.
- Se aplica una vez que escribes `yes`. El servidor ejecuta el plan únicamente sobre el digest del que leíste; por lo tanto, si la base de datos o las tablas cambiaron entretanto, lo rechaza y debes revisar nuevamente. `--yes` omite la confirmación.

El arranque solo añade elementos, por lo que después de eliminar una columna de su `defineTable`, su columna permanece en la base de datos con sus datos. Una columna `NOT NULL` sin un valor predeterminado provocará que cada inserción falle, y el registro de arranque sugerirá este comando: sin `--drop` para conservar los datos, con él para eliminar la columna. Despliega primero el cambio de la tabla, ya que reconcile planifica contra lo que el backend está ejecutando. Requiere `REBASE_SERVICE_KEY` en `.env`. Localmente, `rebase db push` cubre lo mismo a través de su filtro de cambios destructivos.

### `rebase schema introspect`

Genera archivos `defineTable` a partir de una base de datos PostgreSQL existente:

```bash
rebase schema introspect
```

**Qué hace:**
- Se conecta a la base de datos de este proyecto, la que imprime `rebase db url` (se inicia la administrada si se trata de esa); `--database-url` especifica otra y `--docker` utiliza la de compose
- Lee cada tabla, columna, tipo, clave foránea y política, y escribe
  `backend/schema/<table>.ts` —un `defineTable` por tabla— y el
  `backend/schema/index.ts` que las exporta (fusionado en un índice si
  ya existe)
- Declara cada columna con su tipo de Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, un enum con sus etiquetas y nombre de tipo real
  (un `pgEnum` cuando el tipo es compartido), un arreglo como `<item>.array()`,
  `col.vector({ dimensions })`, claves identity y serial, valores predeterminados, tal como
  los escribe Drizzle. Un tipo que ningún generador reconoce se convierte en
  `col.custom({ dataType: "<sql type>" })`, el cual Rebase sirve tal como lo
  devuelve el controlador; `db generate` y `db push` lo rechazan hasta que el planificador
  pueda procesarlo
- Declara la columna de clave foránea, el `belongsTo` en ella y el
  `hasMany` inverso en el destino; una tabla de unión (junction table) se convierte en un `manyToMany`, con sus
  propias columnas como `pivot`
- Lee las políticas de seguridad a nivel de fila de cada tabla en su `rls`: nombre,
  comando, modo, lista `TO`, `USING` y `WITH CHECK`. Las políticas `<table>_default_*`
  que Rebase agrega por sí mismo se omiten, por lo que el `db push` posterior recrea
  cada política tal como estaba. Una tabla con seguridad a nivel de fila habilitada y sin políticas se
  escribe como `rls: "admin-only"`
- Lee cada expresión (el `USING` de una política, un CHECK, el valor predeterminado de una columna) bajo
  el `search_path` que utiliza el servidor, `public`, de modo que una función en el esquema
  `rebase` se escriba como `rebase.roles()`
- Convierte un CHECK que puede interpretar (`total >= 0`) en el `.validate()` de la columna, y deja la restricción en la base de datos, donde el push posterior la conserva. Cada CHECK también se lista bajo "Not carried over" con su SQL: un push a una base de datos *nueva* crea la validación, no la restricción
- Declara cada índice simple (solo columnas, btree, gin o brin, sin predicado) en los `indexes` de la tabla. Un índice exclusivo sobre una columna de clave foránea se delega a la relación, que crea uno automáticamente
- Con `--from supabase`, traduce las convenciones de Supabase para una base de datos de la que estás migrando: un valor predeterminado de columna con `auth.uid()` se convierte en `.onCreateUser()` (el servidor escribe el id del emisor), una columna que almacena un id de usuario de Supabase (ese valor por defecto, o una clave foránea a `auth.users`) se convierte en `col.text().userId()`, ya que `rebase.users.id` y `rebase.uid()` son de tipo texto, y una política `TO authenticated` / `TO anon` pierde el rol (una base de datos de Rebase no tiene ninguno de los dos) y en su lugar exige un emisor autenticado / no autenticado; las políticas exclusivas para `service_role` se descartan. Cada cambio se anota al principio del archivo de la tabla. Sin este flag, se dejan tal como están (Rebase ejecutándose en la misma base de datos junto a Supabase aún las necesita) y la ejecución indica cuándo las detectó
- Concluye con lo que **no** transfirió: funciones, disparadores (triggers), extensiones, CHECKs, índices que `indexes` no puede expresar, claves foráneas compuestas por varias columnas o que apuntan a otro esquema. El SQL que recrea cada elemento que Postgres puede imprimir se escribe en `backend/sql/_introspected-left-behind.sql`, un borrador: revísalo, hazlo seguro para reejecutar y renómbralo quitando el `_` inicial; `rebase db push` y cada despliegue lo aplicarán siempre que haya cambiado
- Te recuerda que `DATABASE_URL` aún apunta a la base de datos que leyó: en una migración esa es la fuente, y ejecutar `db push` ahora escribiría sobre ella
- En un proyecto headless, reemplaza el archivo `ai-instructions.md` del scaffold ("la base de datos es el esquema") con las reglas de esquema en código exclusivas de backend siempre que el archivo esté exactamente como lo generó el scaffold; si ha sido editado, no se modifica y el comando indica cuáles de sus reglas ya no son válidas
- Coloca lo que no pudo determinar con exactitud en un comentario al principio del archivo de la tabla y en la terminal —un conjunto cerrado de cadenas en una columna de texto, una columna generada cuya expresión no leyó, un tipo personalizado— junto con lo que un push le haría
- Con `--data-inference`, toma muestras de hasta 100 filas por tabla y escribe lo que
  detecta referente a la presentación —títulos, íconos, tableros, ordenamientos, opciones de campo— en
  `frontend/src/cms/<table>.tsx` como un `customizeTable`, cuando el frontend del
  proyecto depende de `@rebasepro/cms`. Un proyecto headless no recibe nada
- Frente a una base de datos que no está en ejecución, muestra el mismo banner que
  `db push`, una sola vez, y no crea nada. Imprime el directorio de salida como una
  ruta absoluta

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | Dónde escribir los archivos de tabla (por defecto: `backend/schema`). `--output` fue eliminado |
| `--schema` | El esquema de Postgres a leer (por defecto: `public`) |
| `--force, -f` | Sobrescribe los archivos de tabla que ya existen; sin esta opción, se omiten los archivos existentes |
| `--database-url` | Lee esta base de datos en lugar de la propia del proyecto |
| `--docker` | Lee la base de datos de compose, iniciándola si es necesario |
| `--from supabase` | Traduce las convenciones de Supabase (valores predeterminados de `auth.uid()`, claves foráneas de `auth.users`, `TO anon` / `TO authenticated`) para una base de datos de Rebase. No lo uses si Rebase se ejecuta en la misma base de datos junto a Supabase |
| `--data-inference` / `--no-data-inference` | Toma una muestra de hasta 100 filas por tabla para detectar formatos, restricciones y ajustes del panel, o lee únicamente la estructura. Sin ninguna de las dos opciones, lo preguntará, y sin una terminal, solo leerá la estructura |
| `--users` | También escribe `users.ts` para `rebase.users`, como un `defineAuthTable` que coincide con la tabla que creó auth. Muestra Users en el panel de administración como una tabla a la que puedes agregar columnas. Sin esta opción, las cuentas se administran en Users & Roles de Studio |

Esto es útil al adoptar Rebase en una base de datos existente: realiza la introspección
primero y luego edita las tablas generadas. Una tabla con la seguridad a nivel de fila desactivada se
escribe como cualquier otra, con su `rls`; el push activará RLS y el dry
run lo indicará. Un backend que se ejecuta sin ningún `backend/schema` sirve la
base de datos directamente en su lugar; consulta [Solo backend](/docs/getting-started/headless/).
¿Migrando desde Supabase? Consulta [Migrar desde Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Envía los cambios de esquema directamente a la base de datos sin archivos de migración:

```bash
rebase db push
```

**Qué hace:**
- Lee el esquema generado de Drizzle
- Aplica los cambios directamente en la base de datos (CREATE, ALTER, DROP)
- Realiza primero un dry-run del plan y se detiene antes de cualquier acción que destruya datos: una
  tabla, columna, esquema, vista o tipo eliminado, un `TRUNCATE`, o un cambio de tipo de columna
  que pueda perder valores (`timestamptz` → `date`, `numeric` → `integer`),
  o un cambio de clave primaria — `(id)` → `(id, locale)` otorga a cada fila un nuevo id, por lo
  que los enlaces, claves foráneas e ids almacenados en otros lugares dejan de encontrar su fila.
  También se detiene
  antes de eliminar una restricción CHECK o EXCLUDE existente en la base de datos: no se
  pierde ninguna fila, pero a partir de ese momento la base de datos aceptará las filas que antes rechazaba.
  Pregunta en la terminal, donde Ctrl-C o Ctrl-D responde que no, y de lo contrario lo
  rechaza; `--allow-destructive` lo aplica de todos modos. `--yes` aún lo hace también en
  esta versión, con una advertencia de desuso (deprecation); a partir de la próxima versión solo aprobará
  los pushes que no destruyan nada. Un push que
  se detenga en ese punto eliminará su base de datos temporal `<db>_dev_diff` al salir
- Activa la seguridad a nivel de fila para cada tabla declarada, incluidas las de unión, justo después del
  cambio de esquema y antes de cualquier paso que pueda fallar, de modo que un push que se detenga a mitad de camino deje una nueva tabla
  denegando todas las solicitudes en lugar de dejarla abierta a todas
- Aplica las políticas RLS a las que compila el `rls` de tus tablas y **elimina las políticas que un push anterior haya reemplazado**
- Con `--prune-policies`, también elimina las políticas en las tablas declaradas que ninguna tabla declara —las que el dry run lista como "left in force", tales como las políticas propias de la base de datos después de que una tabla pasa a `rls: "admin-only"`— en la misma transacción que aplica las declaradas. El dry run lista cada una bajo "Planned row-level security changes", y el push las condiciona de la misma manera que una columna eliminada (pregunta en la terminal y, en otros entornos, requiere `--allow-destructive`): eliminar una política modifica quién puede leer y escribir las filas, y eliminar una política `RESTRICTIVE` amplía el acceso. Una tabla que `backend/schema` no declare y el esquema `rebase` nunca se tocan
- Mantiene intacta
  cualquier restricción CHECK y EXCLUDE en una tabla declarada. Una tabla
  no puede declarar ninguna de las dos, por lo que son reglas propias de la base de datos, escritas a mano
  o conservadas de una base de datos adoptada mediante `schema introspect`; para eliminar una, hazlo
  manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Los disparadores (triggers) y funciones que hayas escrito
  tampoco se modifican
- Coincide exactamente
  con el nombre de todo lo que deja intacto, incluyendo caracteres
  como `.`, `[`, `]` o `*`
- Construye cualquier
  [índice de clave foránea que Rebase derive](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  que le falte a una tabla existente **antes** de planificar, con
  `CREATE INDEX CONCURRENTLY`, de modo que las escrituras en la tabla continúen durante la compilación;
  luego Atlas lo encuentra ya ubicado. `--dry-run` los nombra y no construye nada
- Sella las
  políticas que aplica de la misma forma en que lo hace el arranque del servidor, de modo que el primer arranque después de un
  push las deje intactas en lugar de recrear cada una
- `--dry-run`
  lista la seguridad a nivel de fila que el push cambiaría, bajo "Planned
  row-level security changes": las tablas para las que activa RLS y cada
  política que crea, reemplaza o elimina, calculadas de la forma en que los pasos
  del push lo determinan. Solo muestra "No changes" cuando ni el esquema ni la
  seguridad a nivel de fila cambiarían. Cuando el sello de una política no coincide con su
  regla, o no tiene ninguno (una creada por `db migrate` o escrita a mano), el dry
  run la crea nuevamente a partir de su regla con otro nombre, en una transacción que
  luego revierte (rollback), y compara lo que almacenó Postgres: una que resulte idéntica se considera
  sin cambios. Por lo tanto, una regla que `schema introspect` interpretó como SQL no genera ningún plan, y
  tampoco las políticas que aplicó `db migrate`. Solo aquellas que no pudo comparar (por
  ejemplo, si el bloqueo de la tabla no se concedió en dos segundos) se listan por separado. El comando push
  en sí imprime una sola línea contando los cambios
- Te avisa cuando `rebase dev` se está ejecutando sobre la misma base de datos: aplica nuevas tablas y columnas a medida que guardas, por lo que "No changes" puede significar que ya las aplicó
- Muestra cada
  instrucción que Atlas aplica una sola vez. Atlas se conecta sin SSL a una base de datos en esta
  máquina (`localhost`, `127.x`, `::1`) cuya URL no especifique `sslmode`, al igual que la aplicación,
  en lugar de fallar con `SSL is not enabled on the server`; una URL que
  especifique `sslmode`, u otro host, se transmite tal cual está escrita. Una ejecución de Atlas
  que falle antes de planificar no deja ninguna base de datos `<db>_dev_diff` residual
- `--dry-run`
  no escribe nada del proyecto: `src/schema.generated.ts` se deja tal como está,
  y las copias de `drizzle/*.sql` que una versión anterior confirmó (committed) se mencionan, pero no se
  eliminan. Solo la entrada del plan va a `.rebase/sql/`, que no se incluye en el control de versiones (no se commitea)
- **No** crea archivos de migración

**Cuánto tarda.** Casi todo el tiempo de un push es Atlas calculando el plan:
construye el esquema deseado en una base de datos temporal (scratch) y calcula la diferencia con respecto a la
real, y ese costo aumenta más rápido que el número de tablas: en una laptop sin carga de trabajo,
aproximadamente 0.25 s por plan con 11 tablas, 0.9 s con 111 y 5.5 s con 411. Un push que
no cambia nada planifica una vez; uno que cambia algo planifica dos veces (el dry-run
que lee el filtro de cambios destructivos y luego la aplicación). Por lo tanto, un push en un esquema de
400 o más tablas tarda decenas de segundos, y más en una máquina ocupada o lenta.
Ese tiempo pertenece a Atlas, no a tu base de datos: los pasos circundantes (generar el
SQL, el bloqueo de RLS, la búsqueda, los triggers, las políticas, el rol) toman unos pocos segundos para
ese tamaño, a través de una única conexión a tu base de datos.

**Los archivos que genera en el proceso**, todos bajo `.rebase/sql/` en el directorio
backend. `db push` y `db generate` escriben los cinco a partir de tus tablas en
cada ejecución, antes de leer cualquiera de ellos, por lo que una copia confirmada en el repositorio no sería
leída por nada. El directorio tiene su propio `.gitignore` y nunca se incluye en el control de versiones.

| Archivo | Contiene |
|---------|----------|
| `schema.sql` | Tablas, columnas, restricciones e índices: el estado deseado por Atlas y el único sobre el cual calcula diferencias |
| `policies.sql` | Las políticas RLS a las que compila el `rls` de tus tablas |
| `search.sql` | Las funciones de búsqueda de texto completo y columnas generadas, para tablas con un bloque `search` |
| `vector.sql` | Extensiones de pgvector e índices ANN |
| `triggers.sql` | `rebase.set_updated_at()` y los disparadores `BEFORE UPDATE` detrás de `.onUpdateNow()` |

Atlas gestiona el primero y nada más, por lo que `db push` y el aseguramiento del esquema
en el arranque aplican los otros cuatro por sí mismos. Un despliegue **basado solo en migraciones** —uno
que ejecuta `db migrate` y nunca `db push`— debe incorporar esos cuatro en una
migración manualmente; `db generate` te avisa cuando un cambio es invisible para Atlas.

A un proyecto que haya incluido estos archivos en `drizzle/` en una versión anterior se le
eliminarán esas copias en su primera ejecución, y el comando especificará cada una para que puedas
confirmar (commit) la eliminación. Solo elimina archivos que comiencen con el
encabezado del generador. Cualquier archivo que hayas escrito tú mismo se conserva, al igual que `drizzle/migrations/`.

:::note[Editar una regla de seguridad renombra su política]
Una regla sin un `name` explícito compila a `<table>_<op>_<hash>`, donde el hash cubre la semántica de la regla; por lo tanto, *editar* una regla (en lugar de agregar una nueva) produce una política con un nombre nuevo y deja atrás la antigua.

Esto solía ser muy importante: Postgres combina las políticas `PERMISSIVE` mediante un operador OR, por lo que un `USING (rebase.uid() IS NOT NULL)` reemplazado seguía otorgando acceso a todo sin importar cuán estricto fuera su sustituto. Restringir una regla no tenía efecto y el push reportaba éxito.

Ahora `db push` concilia esto: elimina las políticas generadas que ya no coinciden con ninguna regla y reporta —sin eliminar— cualquier política con nombre personalizado que tus tablas no describan, ya que son indistinguibles de SQL escrito deliberadamente por alguien.

Para auditar una base de datos a la que se le aplicó push antes de esta mejora, ejecuta `rebase doctor --policies`. Funciona como un filtro de CI: sale con un código distinto de cero si hay desfase (drift), y también cuando no pudo ejecutar la verificación en absoluto (falta de `DATABASE_URL`, una ruta de `--schema-dir` que no se resuelve o lectura de `pg_policies` no concedida al rol de CI). Un filtro que no pudo inspeccionar no ha pasado la comprobación.

`doctor` y `db push` distinguen los dos tipos de elementos huérfanos. Una política con un nombre generado fue reemplazada y el siguiente push la elimina. Cualquier otro nombre fue escrito a mano o por otra herramienta y sigue en vigor: descríbela en el `rls` de su tabla para conservarla (la vista de RLS de Studio la importa) o elimínala con `rebase db push --prune-policies` si está obsoleta.
:::

:::caution
`db push` modifica la base de datos directamente. Úsalo solo en desarrollo. Para producción, utiliza `db generate` + `db migrate` para crear archivos de migración revisables.
:::

### `rebase db generate`

Genera archivos de migración SQL a partir de cambios en el esquema:

```bash
rebase db generate
```

**Qué hace:**
- Compara el esquema de Drizzle contra el estado que construyen las migraciones en `drizzle/migrations/`, no contra tu base de datos
- Genera archivos de migración SQL con marca de tiempo en `backend/drizzle/migrations/`
- Los archivos se pueden revisar, editar y confirmar en el control de versiones
- Especifica cada
  instrucción de la nueva migración que destruya datos, utilizando la misma comprobación que ejecuta `db push`
  antes de aplicar cambios: una tabla, columna, esquema, vista o tipo eliminado, un
  `TRUNCATE`, un cambio de tipo de columna que pueda perder valores, un cambio de clave primaria,
  o la eliminación de una restricción CHECK o EXCLUDE presente en la base de datos. Aún
  así escribe el archivo y sale con código 0, por lo que advierte y no rechaza la operación.
- Concluye indicando los siguientes
  pasos: `rebase db migrate` y, para la primera migración de un proyecto, la opción
  `--baseline <version>` que necesita una base de datos que el arranque ya ha configurado. Las migraciones
  posteriores no incluyen línea de baseline, ya que si una migración destructiva se estableciera como línea base
  omitiría su `DROP`; además, una ejecución que no genere migraciones simplemente indicará eso.

**Un CHECK añadido por una migración tuya será eliminado por la siguiente.** `db generate`
calcula las diferencias de tus archivos de migración, no de la base de datos, y Atlas no tiene forma de excluir un
objeto de esa diferencia. Por lo tanto, una restricción CHECK o EXCLUDE que hayas escrito manualmente en una
migración, y que ninguna tabla pueda declarar, volverá como
`ALTER TABLE … DROP CONSTRAINT …` en la siguiente migración generada, combinada en
la misma instrucción que el cambio real. El reporte mencionado indica esa eliminación cuando
la base de datos ya contiene la restricción; pero no la elimina del
archivo. Borra la cláusula antes de ejecutar `rebase db migrate`, o permite que
`rebase db migrate --refuse-destructive` se detenga en ella. `db push` lee la
base de datos y conserva la restricción.

Las migraciones generadas son archivos SQL planos: puedes inspeccionarlos y modificarlos antes de aplicarlos.

### `rebase db migrate`

Ejecuta todas las migraciones pendientes:

```bash
rebase db migrate
```

**Qué hace:**
- Lee `drizzle/migrations/` en busca de migraciones no aplicadas
- Las aplica en orden a la base de datos
- Realiza un seguimiento de las migraciones que se han aplicado
- Sella las
  políticas de seguridad a nivel de fila de la misma manera que lo hacen `db push` y el arranque del servidor, de modo
  que el primer arranque después de una migración las deje intactas en lugar de recrear cada
  una. Una migración se escribió a partir de las tablas de su momento, por lo que una política solo se
  sella cuando coincide exactamente con lo que genera su regla en la actualidad: migrate la genera
  nuevamente a partir de su regla con otro nombre, en una transacción que revierte, y
  compara lo que almacenó Postgres, tal como hace `db push --dry-run`. Una política que
  difiera no recibe sello, y el siguiente arranque reaplicará su tabla

`--refuse-destructive`
hace que, en su lugar, rechace la operación. Realiza primero un dry-run de las migraciones pendientes. Si alguna
instrucción destruye datos, según la misma comprobación que usan `db push` y `db generate`,
lista dichas instrucciones y sale con código 1. No aplica nada, ni siquiera los archivos
anteriores a esa instrucción. Sin el flag, `db migrate` se comporta como siempre y
aplica cada archivo pendiente:

```bash
rebase db migrate --refuse-destructive
```

Una migración que reconstruye una columna de búsqueda la elimina primero, por lo que esta opción también
rechazará esa migración. Lee la lista que imprime y luego ejecuta `rebase db migrate`
sin la opción para aplicarla.

#### Establecer una línea base (baseline) en una base de datos que Rebase ya ha iniciado

Cada arranque de Rebase asegura el esquema y `rebase db push` lo aplica directamente. Por lo tanto, una base de datos en la que se haya ejecutado cualquiera de los dos ya contiene las tablas y tipos que crearía la primera migración. En una base de datos de este tipo sin historial de migraciones, `rebase db migrate` no ejecuta nada: indica las tablas que ya están presentes y el comando a ejecutar, con la versión de la migración más reciente ya completada. No registra la línea base automáticamente.

No hay ningún problema con la migración: la base de datos se aprovisionó de otra manera. Registra el estado en el que ya se encuentra una sola vez; el mismo comando ejecutará las migraciones posteriores y cualquier `rebase db migrate` futuro será una ejecución común:

```bash
rebase db migrate --baseline 20260906101530
```

La versión es el prefijo numérico del archivo de migración que describe lo que hay en la base de datos *ahora*. Esa migración y todo lo anterior a ella se registran como aplicados; todo lo posterior se ejecuta. El arranque nunca elimina ni renombra nada, por lo que si una de esas migraciones lo hace, establece la línea base en la versión anterior a ella. En una base de datos contra la que nunca se haya arrancado nada, no es necesaria una línea base: ejecuta las migraciones directamente.

Lo mismo sucede más adelante en el flujo habitual: editas una tabla mientras `rebase dev` está en ejecución y el arranque añade la columna antes de que `rebase db generate` escriba la migración que la añade, por lo que `rebase db migrate` se detiene en `column … already exists (42701)`. Establece la línea base de esa migración de la misma manera. `--baseline` funciona en una base de datos que ya registra migraciones: marca todo hasta esa versión como aplicado con `atlas migrate set` y lo notifica, o indica que no hay nada que registrar cuando el historial ya la alcanza. Una versión que ningún archivo en `drizzle/migrations` posea se rechaza antes de que se ejecute nada, indicando las versiones disponibles.

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

Cada rama es una copia completa de la base de datos creada con `CREATE DATABASE ... TEMPLATE`,
por lo que requiere un servidor PostgreSQL real y consume el mismo espacio en disco que su origen.

### `rebase doctor`

Detecta desfases a tres vías entre tus tablas, el esquema generado de Drizzle y la base de datos PostgreSQL activa:

```bash
rebase doctor
```

**Qué comprueba:**
- Tablas ↔ Esquema generado: ¿están sincronizados?
- Esquema generado ↔ Base de datos: ¿hay cambios sin aplicar?
- Tablas ↔ Base de datos: ¿hay algún desfase inesperado?

Ejecuta `doctor` siempre que sientas que algo no está sincronizado. Señala con precisión exacta dónde está la discrepancia.

La comparación de la base de datos incluye la que realiza el arranque antes de advertir que `schema.generated.ts` y la base de datos no coinciden, ejecutada a través del mismo código. Por lo tanto, cada diferencia sobre la que advierte el arranque también aparece en el reporte, con las mismas palabras: una columna que es NOT NULL en un lado y nullable en el otro, y una columna que la base de datos todavía tiene pero que el archivo no (el arranque nunca elimina una, por lo que una propiedad renombrada deja su columna anterior atrás). Cada una es una advertencia, y la solución sugiere ejecutar `rebase db push`.

La comparación de la base de datos lee la base de datos del proyecto, resuelta de la forma en que lo hace `rebase db url` (en un scaffold nuevo, la administrada, la cual `doctor` inicia). Cuando ninguna puede resolverse, esa fase se reporta como **omitida** (skipped) en lugar de aprobada, y la ejecución nunca concluye con "All schemas are in sync": una comprobación que no se realizó no es un certificado de buena salud.

También señala cada tabla sin un [bloque `search`](/docs/backend/search) que contenga más de unas 10,000 filas. Una búsqueda allí (el cuadro de búsqueda del panel de administración, `.search()`, `?searchString=`) se realiza mediante `ILIKE '%term%'` sobre las columnas de texto, lo cual ningún índice puede procesar de forma eficiente, por lo que cada una lee la tabla completa y su conteo vuelve a leerla (aproximadamente un tercio de segundo con 100,000 filas, aumentando con el tamaño de la tabla). El recuento de filas es la propia estimación de Postgres, por lo que la comprobación no escanea nada. Es una sugerencia: no modifica el código de salida y no indexa nada por ti.

Señala una **unión huérfana (orphaned junction)**: una tabla en `public` con estructura de unión de muchos a muchos que ninguna tabla declara. Esta estructura consiste en dos columnas que juntas forman la clave primaria, siendo cada una de ellas una clave foránea hacia una tabla declarada. Renombrar o eliminar un `manyToMany` deja atrás su antigua tabla de unión, ya que push y el arranque solo crean tablas, y todas las filas de enlace permanecen en ella. Esta nota es solo informativa, por lo que no cambia el código de salida. Su solución es la instrucción `DROP TABLE`, la cual `doctor` muestra pero nunca ejecuta.

### `rebase generate-sdk`

Genera un SDK tipado a partir de tus tablas:

```bash
rebase generate-sdk
```

**Qué hace:**
- Lee las tablas que exporta `backend/schema/index.ts`, a través del cargador desde el que arranca el backend, de modo que el SDK describa exactamente las tablas servidas; un esquema que no compile detiene el proceso
- Genera tipos de TypeScript para cada tabla en `generated/sdk/`
- Genera un archivo `database.types.ts` para su uso con `createRebaseClient<Database>()`: el tipo `Database`, `TableName` (la unión de todos los slugs) y `tablesDictionary` / `TablesDictionary`, el mapeo de descriptor de acceso (accessor) a slug

`rebase dev` ejecuta esto por ti al iniciar y con cada guardado dentro de
`backend/schema/`. Ejecútalo manualmente en CI, en un repositorio que no tenga
tablas propias (consulta `--from` más abajo) o en cualquier lugar donde `rebase dev` no se esté ejecutando.

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | El directorio de esquemas (por defecto: `backend/schema`, o la clave `tables` en `rebase.json`); las rutas relativas se resuelven desde donde ejecutas el comando |
| `-o`, `--output` | Directorio de salida para el SDK (por defecto: `generated/sdk/`) |
| `--from <link\|url>` | Lee el esquema desde un proyecto en ejecución en lugar del código local. `link` usa el proyecto vinculado a este checkout. |
| `--token` | Token Bearer para el endpoint del contrato (por defecto: `$REBASE_SERVICE_KEY` de la terminal; `.env` no se lee) |
| `--register` | También tipa datos del lado del servidor: escribe los tipos y una declaración `Register` en `backend/generated/`, y lo recuerda en `rebase.json` — consulta [Datos tipados en el servidor](/docs/backend/typed-server-data/) |

`--from` es lo que permite que un repositorio que no contiene tablas (un
frontend independiente, una segunda aplicación web, una aplicación móvil) genere un cliente tipado a partir del
proyecto con el que se comunica: lee las `tables` del endpoint
`/api/meta/contract` del backend en ejecución. `REBASE_SERVICE_KEY` solo se envía al proyecto al que está vinculado este
checkout; pasa `--token` explícitamente para cualquier otro host. La clave en
`.env` pertenece a tu backend local y nunca se envía.
Un rechazo explica
cuál de estas situaciones ocurrió: un `--token` rechazado, una clave de shell rechazada, una clave
retenida para un host no vinculado, una clave solo presente en `.env` o ninguna clave en absoluto.

**Uso tras la generación:**

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

Los nombres de los campos en los tipos generados son los que sirve la API. El nombre en cable
(wire name) de un campo es su clave de columna, y la API utiliza camelCase en todas partes: la introspección
escribe una columna `created_at` como `createdAt: col.timestamp({ withTimezone: true })`, cuyo nombre SQL
es el snake_case de la clave, y la sirve como `row.createdAt`. La columna
en sí no se modifica. El *descriptor de acceso (accessor)* de la tabla se convierte en un nombre de propiedad de
la misma manera (`my-notes` → `client.data.myNotes`), que es lo que `tablesDictionary`
mapea de vuelta al slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` traslada `config/collections` a
`backend/schema` (un `defineTable` por colección, cada columna explícita en
su posición original, con la nomenclatura de Drizzle, e `index.ts` con
`defaultRls`) y a `frontend/src/cms` (un `customizeTable` por colección
personalizada, archivos `defineFirestoreCollection`, `ui-config.json`), escribe
`backend/resources.ts`, `backend/storage.ts` y `backend/generated/register.ts`,
añade `rebaseBackendGuard()` al `vite.config.ts` de un scaffold, y luego ejecuta
`rebase migrate sdk-calls`, que reescribe `.collection(` a `.table(`, los
demás cambios de nombre del SDK y las fuentes de reglas `existsIn` / `membership` en tu código,
y traslada las importaciones de identificadores que la versión 0.31 movió a otro paquete
([la lista](/docs/upgrading/0-30-to-0-31-imports/)), agregando el paquete a las
dependencias del importador ("Dependencies added": ejecuta `pnpm install`). Actualiza cada paquete de `@rebasepro` a la versión 0.31 antes de ejecutarlo.
Cada ejecución vuelve a leer el resultado: el SQL generado (DDL, políticas, búsqueda,
vectores, triggers, vistas, el esquema de Drizzle) debe ser idéntico byte por byte, o de lo
contrario se restaura cada archivo. Lo que no pueda transferir se rechaza indicando su archivo y línea, y
lo que quede pendiente para ti se imprime como pasos manuales numerados, terminando con
`rebase skills install` si el proyecto contiene habilidades de agentes (agent skills). Tus propios módulos en
`config/` se conservan; la ejecución imprime la línea de `git rm` correspondiente a lo que reemplazó. También
rastrea colecciones de Firestore que construye una función, alias de rutas, un panel montado
fuera de `App.tsx` y cualquier aplicación estática no protegida ([la lista completa](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Después de ejecutar `git rm`, `--check` reporta `already-migrated`.

| Flag | Efecto |
|---|---|
| `--dry-run` | Muestra archivos, rechazos, notas y pasos manuales; no escribe nada. Empieza aquí. |
| `--check` | En un proyecto migrado: comprueba que `backend/schema` aún renderiza el mismo SQL. Sale con código 1 con el diff, o si alguna regla cambia de significado. |
| `--accept-rule-changes` | Junto con `--check`: confirma que las reglas bajo "Review before deploying" fueron revisadas. |
| `--json` / `--force` / `--skip-sdk-calls` | El reporte como JSON (con `ruleChanges`); ejecutar sobre un árbol de trabajo con cambios sin guardar o sobre una salida editada; no toca tu código. |

Revisa dos listas en la salida de su SDK: **"Rewritten by name — review"** (receptores
no tipados, data slots, dobles de prueba) y **"Left unchanged — check each"**
(renombra aquellos que correspondan al SDK; [una búsqueda](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) encontrará el resto).

La verificación de SQL demuestra que la conversión es fidedigna, no que una regla mantenga el significado que
tenía. La última sección de la salida, **"Review before deploying: these rules change meaning"**,
lista cada regla cuya política ahora otorga permisos diferentes
—un simple `access: "authenticated"` no concedía nada y ahora admite a cualquier emisor que haya iniciado
sesión ([las cuatro formas](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Luego comprueba contra tu base de datos: `rebase db push --dry-run` debería imprimir "No
changes: the database already matches these tables.", y
`rebase doctor --policies` ningún desfase (drift).

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
git add backend/drizzle/migrations/

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
| La migración muestra cambios inesperados | Ejecuta `rebase doctor` para identificar desfases (drift) |
| `db push` falla en producción | Usa `db generate` + `db migrate` en su lugar |
| Una migración no debe eliminar datos en CI ni en producción | `rebase db migrate --refuse-destructive` sale con código 1 y no aplica nada cuando una instrucción pendiente destruye datos |
| `db migrate` se detiene con "already has the tables your migrations create", o falla con `already exists (42710)` | El arranque o `db push` ya aprovisionaron el esquema: regístralo con el comando `rebase db migrate --baseline <version>` que imprime |
| `db migrate` falla con `column … already exists (42701)` | `rebase dev` añadió la columna en el arranque: establece la línea base para esa migración de la misma manera |
| `db push` en la base de datos administrada falla con `Error: EOF` | Atlas perdió una conexión que mantiene activa `rebase dev`. Ejecútalo de nuevo; si sigue fallando, detén primero `rebase dev` |

## Próximos pasos

- **[Tablas](/docs/schema/)** — Define tu modelo de datos
- **[Referencia de la CLI](/docs/cli)** — Todos los comandos de la CLI
- **[SDK tipado](/docs/sdk)** — Usa el SDK generado
