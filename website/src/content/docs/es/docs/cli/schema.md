---
sourceHash: 1a01ad3180c225c1
title: Generación de esquemas
sidebar_label: Generación de esquemas
description: Genera esquemas de Drizzle ORM a partir de las tablas en backend/schema, crea migraciones SQL, haz introspección de una base de datos existente en archivos defineTable y mantén tu base de datos sincronizada con Rebase CLI.
---

## Descripción general

Rebase utiliza un pipeline de **esquema como código** (**schema-as-code**) donde las tablas que declaras con
`defineTable` en `backend/schema/` son la única fuente de verdad. La CLI
las transforma a través de un pipeline determinista:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página cubre cada comando de la CLI involucrado en ese pipeline.

## El Pipeline

### 1. Tablas → Esquema de Drizzle

Las tablas que exporta `backend/schema/index.ts` describen columnas, tipos, relaciones,
enums y seguridad a nivel de fila (row-level security). Cada comando a continuación las lee a través del cargador
desde el cual arranca el backend, por lo que un esquema que no compila — una tabla sin
`rls`, `"inherit"` sin `defaultRls`, un `defineTable` que el index no
exporta — detiene el comando con un `SchemaDefinitionError` que nombra cada problema,
y no se escribe nada. El comando `schema generate` genera un archivo de esquema de Drizzle ORM
a partir de ellas.

Cada comando que lee el esquema acepta `--schema-dir <dir>` para un proyecto
que guarda sus tablas en otro lugar; el valor predeterminado es `backend/schema`, o la
clave `tables` de la app backend en `rebase.json`. `--collections` / `-c`, el
flag anterior a la versión 0.31, se rechaza con un mensaje que nombra el codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), y lo mismo ocurre con un
proyecto que aún tenga `config/collections`.

### 2. Esquema de Drizzle → Migraciones

A partir del esquema generado de Drizzle, `db generate` calcula las diferencias contra las migraciones que ya están en `backend/drizzle/migrations/`, reproducidas en una base de datos temporal, y produce archivos de migración SQL con marcas de tiempo. Nunca lee tu base de datos: una columna que el arranque (boot) o `db push` ya hayan añadido seguirá apareciendo como `ADD COLUMN`.

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
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**Qué hace:**
- Renderiza lo que generan las tablas en `backend/schema/` y lo compara, declaración por declaración, con `backend/src/schema.generated.ts`
- Nombra cada diferencia (una tabla faltante, una columna con un nuevo tipo, una etiqueta de enum eliminada o claves foráneas nombradas de la forma en que una versión anterior las derivaba) y sale con un código distinto de cero
- Con `--fix`, regenera el archivo en lugar de generar un reporte

`rebase dev` mantiene el archivo actualizado por sí mismo, por lo que esta es la verificación ideal para una compilación (build)
o un paso de CI. Acepta `--schema-dir` y `--output` al igual que
`rebase schema generate`.

### `rebase schema reconcile`

Relaja y elimina lo que el arranque no eliminará, después de haber revisado el plan:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Qué hace:**
- Le pide al backend en ejecución que planifique contra su propia base de datos. A ese backend apuntan el `.env` y el enlace a la nube, por lo que funciona en Rebase Cloud, donde nada más tiene acceso a la base de datos.
- Planifica un `DROP NOT NULL` para cada columna que una tabla declare como anulable (nullable) pero que la base de datos aún exija.
- Lista cada columna que ninguna tabla declare. Una columna que sea `NOT NULL` sin valor predeterminado bloquea cada inserción, por lo que también se relaja y sus datos se conservan. Elimina únicamente las columnas que indiques con `--drop <table>.<column>`, y muestra cuántas filas contienen un valor en cada una.
- Se aplica una vez que escribes `yes`. El servidor ejecuta el plan únicamente sobre el digest del plan que revisaste, por lo que si la base de datos o las tablas cambiaron en el transcurso, se rechaza y debes revisar de nuevo. `--yes` omite la confirmación.

El arranque solo añade cosas, por lo que después de eliminar una columna de su `defineTable`, su columna permanece en la base de datos con sus datos. Una columna `NOT NULL` sin valor predeterminado hará que cada inserción falle, y el registro (log) de arranque sugiere este comando para resolverlo: sin `--drop` para conservar los datos, con él para eliminar la columna. Despliega primero el cambio de la tabla, porque reconcile planifica contra lo que el backend está ejecutando. Requiere `REBASE_SERVICE_KEY` en `.env`. A nivel local, `rebase db push` cubre lo mismo a través de su control de cambios destructivos (destructive-change gate).

### `rebase schema introspect`

Escribe archivos `defineTable` a partir de una base de datos PostgreSQL existente:

```bash
rebase schema introspect
```

**Qué hace:**
- Conecta a la base de datos de este proyecto, la que imprime `rebase db url` (la administrada se inicia si se trata de esa); `--database-url` especifica otra, y `--docker` utiliza la de compose
- Lee cada tabla, columna, tipo, clave foránea y política, y escribe
  `backend/schema/<table>.ts` — un `defineTable` por tabla — y el
  `backend/schema/index.ts` que las exporta (fusionado en un index que ya
  exista)
- Declara cada columna con su tipo de Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, un enum con sus etiquetas y nombre de tipo real
  (un `pgEnum` cuando el tipo se comparte), un array como `<item>.array()`,
  `col.vector({ dimensions })`, claves de identidad y seriales, valores predeterminados — escritos tal como
  los escribe Drizzle. Un tipo que ningún constructor nombre se convierte en
  `col.custom({ dataType: "<sql type>" })`, el cual Rebase sirve tal como lo
  devuelve el driver; `db generate` y `db push` lo rechazan hasta que el planificador
  pueda procesarlo
- Declara la columna de clave foránea, el `belongsTo` en ella y el
  `hasMany` inverso en el destino; una tabla de unión (junction table) se convierte en un `manyToMany`, y sus
  propias columnas en el `pivot`
- Lee las políticas de seguridad a nivel de fila (RLS) de cada tabla en su `rls`: nombre,
  comando, modo, lista `TO`, `USING` y `WITH CHECK`. Las políticas `<table>_default_*`
  que Rebase añade por sí mismo se omiten, de modo que el `db push` posterior recrea
  cada política tal como estaba. Una tabla con seguridad a nivel de fila activada y sin políticas se
  escribe como `rls: "admin-only"`
- Lee cada expresión (el `USING` de una política, un CHECK, un valor predeterminado de columna) bajo
  el `search_path` que utiliza el servidor, `public`, por lo que una función en el
  esquema `rebase` se escribe como `rebase.roles()`
- Convierte un CHECK que pueda leer (`total >= 0`) en el `.validate()` de la columna, y deja la restricción misma en la base de datos, donde el push posterior la conserva. Cada CHECK también se lista bajo "Not carried over" con su SQL: un push a una *nueva* base de datos crea la validación, no la restricción
- Declara cada índice simple (solo columnas, btree, gin o brin, sin predicado) en el `indexes` de la tabla. Un índice exclusivo sobre una columna de clave foránea se deja a la relación, que crea uno
- Con `--from supabase`, traduce las convenciones de Supabase para una base de datos que estés abandonando: un valor predeterminado de columna `auth.uid()` se convierte en `.onCreateUser()` (el servidor escribe el id de quien hace la llamada), una columna que almacena un id de usuario de Supabase (ese valor predeterminado, o una clave foránea a `auth.users`) se convierte en `col.text().userId()`, ya que `rebase.users.id` y `rebase.uid()` son texto, y una política `TO authenticated` / `TO anon` pierde el rol (una base de datos de Rebase no tiene ninguno de los dos) y en su lugar exige un remitente con sesión iniciada / no iniciada; una política exclusiva para `service_role` se descarta. Cada cambio se anota en la parte superior del archivo de la tabla. Sin el flag, estos se dejan tal como están (Rebase ejecutándose en la misma base de datos junto a Supabase aún los necesita), y la ejecución indica cuándo los detectó
- Termina con lo que **no** traspasó: funciones, disparadores (triggers), extensiones, CHECKs, índices que `indexes` no puede expresar, claves foráneas compuestas de varias columnas o hacia otro esquema. El SQL que recrea cada elemento que Postgres puede imprimir se escribe en `backend/sql/introspected-left-behind.sql`, para revisarlo y aplicarlo después del primer push (`psql "$DATABASE_URL" -f …`, o `rebase cloud db query --file …` en Rebase Cloud)
- Te recuerda que `DATABASE_URL` todavía apunta a la base de datos que leyó: en una migración esa es la fuente, y un `db push` ahora escribiría en ella
- En un proyecto headless, reemplaza el archivo `ai-instructions.md` del scaffold ("la base de datos es el esquema") con las reglas de esquema en código solo para backend, siempre que el archivo esté exactamente como lo generó el scaffold; un archivo editado no se toca, y el comando indica cuáles de sus reglas ya no aplican
- Coloca lo que no pudo determinar con exactitud en un comentario en la parte superior del archivo de la tabla y en la terminal — un conjunto cerrado de cadenas en una columna de texto, una columna generada cuya expresión no pudo leer, un tipo personalizado — junto con lo que un push le haría
- Con `--data-inference`, toma una muestra de hasta 100 filas por tabla y escribe lo que
  detectó referente a presentación — títulos, iconos, tableros, ordenamientos, opciones de campo — en
  `frontend/src/cms/<table>.tsx` como un `customizeTable`, cuando el
  frontend del proyecto depende de `@rebasepro/cms`. Un proyecto headless no recibe nada
- Frente a una base de datos que no se esté ejecutando, imprime el mismo banner que `db push`,
  una vez, y no crea nada. Imprime el directorio de salida como una
  ruta absoluta

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | Dónde escribir los archivos de tablas (por defecto: `backend/schema`). `--output` fue eliminado |
| `--schema` | El esquema de Postgres a leer (por defecto: `public`) |
| `--force, -f` | Sobrescribe los archivos de tablas que ya existan; sin él, se omiten los archivos existentes |
| `--database-url` | Lee esta base de datos en lugar de la propia del proyecto |
| `--docker` | Lee la base de datos de compose, iniciándola si es necesario |
| `--from supabase` | Traduce las convenciones de Supabase (valores predeterminados `auth.uid()`, claves foráneas a `auth.users`, `TO anon` / `TO authenticated`) para una base de datos Rebase. Omítelo cuando Rebase se ejecute en la misma base de datos junto a Supabase |
| `--data-inference` / `--no-data-inference` | Toma una muestra de hasta 100 filas por tabla para detectar formatos, restricciones y configuraciones de panel, o lee únicamente la estructura. Sin ninguno de los dos, pregunta; y sin una terminal, lee únicamente la estructura |

Esto es útil al adoptar Rebase en una base de datos existente: haz introspección
primero y luego edita las tablas generadas. Una tabla con la seguridad a nivel de fila desactivada se
escribe como cualquier otra, con su `rls`; el push activa RLS y el dry
run lo indica. Un backend que se ejecuta sin ningún `backend/schema` sirve la
base de datos directamente en su lugar; consulta [Backend only](/docs/getting-started/headless/).
¿Migrando desde Supabase? Consulta [Migrating from Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Envía los cambios de esquema directamente a la base de datos sin archivos de migración:

```bash
rebase db push
```

**Qué hace:**
- Lee el esquema generado de Drizzle
- Aplica los cambios directamente a la base de datos (CREATE, ALTER, DROP)
- Ejecuta primero un dry run del plan y se detiene antes de cualquier acción que destruya datos: una
  tabla, columna, esquema, vista o tipo eliminado, un `TRUNCATE`, o un cambio de tipo de
  columna que pueda perder valores (`timestamptz` → `date`, `numeric` → `integer`),
  o un cambio de clave primaria — `(id)` → `(id, locale)` asigna a cada fila un nuevo id, por lo que
  enlaces, claves foráneas e ids almacenados en otros lugares dejan de encontrar su fila.
  También se detiene
  antes de eliminar una restricción CHECK o EXCLUDE que la base de datos posea: no se pierde
  ninguna fila, pero a partir de entonces la base de datos aceptará las filas que antes rechazaba.
  Pregunta en una terminal, donde Ctrl-C o Ctrl-D responde que no, y de lo contrario
  lo rechaza; `--allow-destructive` lo aplica de todos modos. `--yes` todavía lo hace en
  esta versión, con una advertencia de obsolescencia (deprecation); a partir de la próxima versión solo aprobará
  pushes que no destruyan nada. Un push que
  se detenga ahí elimina su base de datos temporal `<db>_dev_diff` al salir
- Activa la seguridad a nivel de fila (RLS) para cada tabla declarada, incluidas las de unión, inmediatamente después del
  cambio de esquema y antes de cualquier paso que pueda fallar, de modo que un push que se detenga a mitad de camino deja una nueva tabla
  denegando cada solicitud en lugar de abierta a ellas
- Aplica las políticas RLS a las que compila el `rls` de tus tablas y **elimina las políticas que un push anterior haya reemplazado**
- <span class="since-badge" data-since="0.35">Desde 0.35</span> Con `--prune-policies`, también elimina las políticas en tablas declaradas que ninguna tabla declare — aquellas que el dry run lista como "left in force" (dejadas en vigor), como las políticas propias de una base de datos después de que una tabla pasó a `rls: "admin-only"` — en la transacción que aplica las declaradas. El dry run lista cada una bajo "Planned row-level security changes", y el push las controla como a una columna eliminada (pregunta en una terminal, y en otros entornos requiere `--allow-destructive`): eliminar una política cambia quién puede leer y escribir las filas, y eliminar una `RESTRICTIVE` amplía el acceso. Una tabla que `backend/schema` no declare, y el esquema `rebase`, nunca se tocan
- Deja intacta cada
  restricción CHECK y EXCLUDE en una tabla declarada. Una tabla
  no puede declarar ninguna de las dos, por lo que son reglas propias de la base de datos, escritas a mano
  o incorporadas por una base de datos que adoptó `schema introspect`; para eliminar una, elimínala
  a mano (`ALTER TABLE … DROP CONSTRAINT …`). Los disparadores (triggers) y funciones que hayas escrito
  tampoco se tocan
- Coincide con exactitud el
  nombre de todo lo que deja intacto, incluyendo caracteres
  como `.`, `[`, `]` o `*`
- Construye cualquier
  [índice de clave foránea que Rebase derive](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  que le falte a una tabla existente **antes** de planificar, con
  `CREATE INDEX CONCURRENTLY`, para que las escrituras en la tabla continúen durante la construcción;
  luego Atlas lo encuentra en su lugar. `--dry-run` los nombra y no construye nada
- Sella las
  políticas que aplica de la misma forma en que lo hace el arranque del servidor, para que el
  primer arranque después de un push no las toque en lugar de recrear cada una
- `--dry-run`
  lista la seguridad a nivel de fila que el push cambiaría, bajo "Planned
  row-level security changes": las tablas para las cuales activa RLS, y cada
  política que crea, reemplaza o elimina, calculada según lo decidan los propios
  pasos del push. Muestra "No changes" únicamente cuando ni el esquema ni la
  seguridad a nivel de fila cambiarían. Donde el sello de una política no coincide con su
  regla, o no tiene ninguno (uno que `db migrate` creó, uno escrito a mano), el dry
  run la crea de nuevo a partir de su regla bajo otro nombre, en una transacción que
  revierte (rollback), y compara lo que Postgres almacenó: una que resulta idéntica no cuenta como
  cambio. Por lo tanto, una regla que `schema introspect` leyó de nuevo como SQL no planifica nada, y
  tampoco lo hacen las políticas aplicadas por `db migrate`. Solo aquellas que no pudo comparar (por
  ejemplo, si el bloqueo de su tabla no se otorgó en dos segundos) se listan por separado. El push
  en sí imprime una sola línea contando los cambios
- Avisa cuando un `rebase dev` se está ejecutando sobre la misma base de datos: este aplica nuevas tablas y columnas a medida que guardas, por lo que "No changes" puede significar que ya las aplicó
- Muestra cada
  sentencia que Atlas aplica una sola vez. Atlas se conecta sin SSL a una base de datos en esta
  máquina (`localhost`, `127.x`, `::1`) cuya URL no especifique `sslmode`, al igual que la
  aplicación, en lugar de fallar con `SSL is not enabled on the server`; una URL que
  especifique `sslmode`, o un host diferente, se pasa tal cual está escrita. Una ejecución de Atlas
  que falle antes de planificar no deja ninguna base de datos `<db>_dev_diff` residual
- `--dry-run`
  no escribe nada del proyecto: `src/schema.generated.ts` se deja tal cual,
  y las copias `drizzle/*.sql` que una versión anterior confirmó en git se nombran, no
  se eliminan. Solo la entrada del plan va a `.rebase/sql/`, que no se confirma en git
- **No** crea archivos de migración

**Cuánto tiempo tarda.** Casi todo el tiempo de un push se debe a que Atlas calcula el plan:
construye el esquema deseado en una base de datos temporal y calcula las diferencias contra la real,
y ese costo crece más rápido que la cantidad de tablas — en una laptop tranquila
alrededor de 0.25 s por plan con 11 tablas, 0.9 s con 111 y 5.5 s con 411. Un push que
no cambia nada planifica una vez; uno que cambia algo planifica dos veces (el dry-run
que lee el control de cambios destructivos y luego la aplicación). Por lo tanto, un push en un esquema de
400 o más tablas tarda decenas de segundos, y más en una máquina ocupada o lenta.
Ese tiempo le corresponde a Atlas, no a tu base de datos: los pasos que lo rodean — generar el
SQL, el bloqueo de RLS, la búsqueda, los disparadores, las políticas, el rol — toman unos pocos segundos a
esa escala, sobre una sola conexión a tu base de datos.

**Los archivos que genera en el proceso**, todos bajo `.rebase/sql/` en el directorio
backend. `db push` y `db generate` escriben los cinco a partir de tus tablas en
cada ejecución, antes de leer cualquiera de ellos, por lo que una copia confirmada en git no sería
leída por nada. El directorio tiene su propio `.gitignore` y nunca se confirma en el control de versiones.

| Archivo | Contiene |
|------|-------|
| `schema.sql` | Tablas, columnas, restricciones e índices — el estado deseado por Atlas y el único sobre el cual calcula diferencias |
| `policies.sql` | Las políticas RLS a las que compila el `rls` de tus tablas |
| `search.sql` | Las funciones de búsqueda de texto completo y columnas generadas, para tablas con un bloque `search` |
| `vector.sql` | Extensiones de pgvector e índices ANN |
| `triggers.sql` | `rebase.set_updated_at()` y los disparadores `BEFORE UPDATE` detrás de `.onUpdateNow()` |

Atlas gestiona el primero y nada más, por lo que `db push` y la verificación del esquema en tiempo de
arranque aplican los otros cuatro por sí mismos. Un despliegue basado **solo en migraciones** — uno
que ejecuta `db migrate` y nunca `db push` — debe incorporar esos cuatro en una
migración manualmente; `db generate` lo indica cuando un cambio es invisible para Atlas.

Un proyecto que haya confirmado estos archivos en `drizzle/` bajo una versión anterior verá
esas copias eliminadas en su primera ejecución, y el comando nombra cada una para que puedas
confirmar la eliminación en git. Solo elimina archivos que comiencen con el encabezado del
generador. Un archivo que hayas escrito tú mismo se conserva, y lo mismo ocurre con `drizzle/migrations/`.

:::note[Editar una regla de seguridad renombra su política]
Una regla sin un `name` explícito compila a `<table>_<op>_<hash>`, donde el hash cubre la semántica de la regla; por lo tanto, *editar* una regla (en lugar de añadir una) produce una política con un nombre nuevo y deja atrás la antigua.

Esto solía importar mucho: Postgres combina las políticas `PERMISSIVE` mediante un OR lógico, de modo que un `USING (rebase.uid() IS NOT NULL)` reemplazado seguía otorgando todo sin importar cuán estricto fuera su sustituto. Endurecer una regla no tenía efecto y el push reportaba éxito.

`db push` ahora concilia esto: elimina las políticas generadas que ya no coincidan con ninguna regla y reporta — sin eliminar — cualquier política con nombre personalizado que tus tablas no describan, ya que son indistinguibles del SQL escrito deliberadamente por alguien.

Para auditar una base de datos a la que se le hizo push antes de la llegada de esta función, ejecuta `rebase doctor --policies`. Funciona como un control de CI: sale con un código distinto de cero si hay desviaciones (drift), y también cuando no pudo ejecutar la verificación en absoluto: falta `DATABASE_URL`, una ruta `--schema-dir` que no se resuelve, o si el rol de CI no tiene permisos para leer `pg_policies`. Un control que no pudo verificar no ha aprobado.

`doctor` y `db push` distinguen los dos tipos de elementos huérfanos. Una política con un nombre generado fue reemplazada y el siguiente push la eliminará. Cualquier otro nombre fue escrito a mano o por otra herramienta y sigue en vigor: descríbela en el `rls` de su tabla para conservarla (la vista de RLS de Studio la importa) o elimínala con `rebase db push --prune-policies` si está obsoleta.
:::

:::caution
`db push` modifica la base de datos directamente. Úsalo únicamente en desarrollo. Para producción, usa `db generate` + `db migrate` para crear archivos de migración revisables.
:::

### `rebase db generate`

Genera archivos de migración SQL a partir de los cambios en el esquema:

```bash
rebase db generate
```

**Qué hace:**
- Compara el esquema de Drizzle contra el estado que construyen las migraciones en `drizzle/migrations/`, no contra tu base de datos
- Produce archivos de migración SQL con marcas de tiempo en `backend/drizzle/migrations/`
- Los archivos se pueden revisar, editar y confirmar en el control de versiones
- Nombra cada
  sentencia en la nueva migración que destruya datos, utilizando la misma comprobación que `db push`
  ejecuta antes de aplicar: una tabla, columna, esquema, vista o tipo eliminado, un
  `TRUNCATE`, un cambio de tipo de columna que pueda perder valores, un cambio de clave primaria
  o la eliminación de una restricción CHECK o EXCLUDE que la base de datos contenga. Aun
  así escribe el archivo y sale con código 0, por lo que advierte y no rechaza.
- Termina indicando qué
  hacer a continuación: `rebase db migrate`, y para la primera migración de un proyecto, el
  `--baseline <version>` que necesita una base de datos que el arranque ya haya configurado. Una
  migración posterior no incluye la línea de baseline, ya que una migración destructiva con baseline
  omitiría su `DROP`, y una ejecución que no escribe ninguna migración solo indica eso.

**Un CHECK añadido por una migración tuya es eliminado por la siguiente.** `db generate`
calcula las diferencias de tus archivos de migración, no de la base de datos, y Atlas no tiene forma de omitir un
objeto de esa comparación. Por lo tanto, una restricción CHECK o EXCLUDE que hayas escrito a mano en una
migración, y que ninguna tabla pueda declarar, regresa como
`ALTER TABLE … DROP CONSTRAINT …` en la siguiente migración que escribe, integrada en
la misma sentencia que el cambio real. El reporte anterior nombra esa eliminación cuando
la base de datos ya contiene la restricción; no la quita del
archivo. Elimina la cláusula antes de `rebase db migrate`, o permite que
`rebase db migrate --refuse-destructive` se detenga ante ella. `db push` lee la
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
- Realiza un seguimiento de qué migraciones se han aplicado
- Sella las
  políticas de seguridad a nivel de fila de la misma manera que lo hacen `db push` y el arranque del servidor, para
  que el primer arranque después de una migración las deje intactas en lugar de recrear cada
  una. Una migración se escribió a partir de las tablas de su momento, por lo que una política solo se
  sella cuando es exactamente lo que su regla genera ahora: migrate la vuelve a
  crear a partir de su regla bajo otro nombre, en una transacción que revierte, y
  compara lo que Postgres almacenó, tal como lo hace `db push --dry-run`. Una política que
  difiera no recibe sello, y el siguiente arranque vuelve a aplicar su tabla

`--refuse-destructive`
hace que se rechace en su lugar. Primero ejecuta un dry run de las migraciones pendientes. Si alguna
sentencia destruye datos, según la misma comprobación que usan `db push` y `db generate`,
lista esas sentencias y sale con código 1. No aplica nada, ni siquiera los archivos
anteriores a esa sentencia. Sin el flag, `db migrate` se comporta como antes y
aplica cada archivo pendiente:

```bash
rebase db migrate --refuse-destructive
```

Una migración que reconstruye una columna de búsqueda la elimina primero, por lo que este flag también rechazará
esa migración. Revisa la lista que imprime y luego ejecuta `rebase db migrate`
sin el flag para aplicarla.

#### Crear una línea base (baseline) de una base de datos que Rebase ya ha arrancado

Cada arranque de Rebase asegura el esquema, y `rebase db push` lo aplica directamente. Por lo tanto, una base de datos que haya ejecutado cualquiera de los dos ya contiene las tablas y tipos que crearía la primera migración, y `rebase db migrate` se detiene con `pq: type "posts_status" already exists (42710)`.

No hay nada malo con la migración: la base de datos se aprovisionó de otra manera. Registra el punto en el que ya se encuentra y luego migra normalmente:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versión es el prefijo numérico del archivo de migración que describe lo que hay en la base de datos *ahora*. Esa migración y todo lo anterior a ella se registran como aplicados; todo lo posterior se ejecuta. En una base de datos contra la cual nunca se ha arrancado nada, no se necesita una línea base: migra de inmediato.

Lo mismo ocurre más adelante en el flujo de trabajo habitual: edita una tabla mientras `rebase dev` se ejecuta, y el arranque añade la columna antes de que `rebase db generate` escriba la migración que la añade, por lo que `rebase db migrate` se detiene con `column … already exists (42701)`. Establece una línea base para esa migración de la misma manera. `--baseline` funciona en una base de datos que ya registra migraciones: marca todo hasta la versión como aplicado mediante `atlas migrate set`, y lo notifica, o indica que no hay nada que registrar cuando el historial ya la alcanza. Una versión que ningún archivo en `drizzle/migrations` tenga se rechaza antes de que se ejecute nada, indicando las versiones disponibles.

### `rebase db branch`

Bifurcación de base de datos (branching) para desarrollo en paralelo:

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
por lo que necesita un servidor PostgreSQL real y ocupa el mismo espacio en disco que su origen.

### `rebase doctor`

Detecta desviaciones a tres bandas (three-way drift) entre tus tablas, el esquema generado de Drizzle y la base de datos PostgreSQL activa:

```bash
rebase doctor
```

**Qué comprueba:**
- Tablas ↔ Esquema generado: ¿están sincronizados?
- Esquema generado ↔ Base de datos: ¿hay cambios sin aplicar?
- Tablas ↔ Base de datos: ¿hay alguna desviación inesperada?

Ejecuta `doctor` siempre que algo parezca estar desincronizado. Señala con exactitud dónde se encuentra la discrepancia.

La comparación con la base de datos incluye la que realiza el arranque antes de advertir que `schema.generated.ts` y la base de datos no coinciden, ejecutada a través del mismo código. Por lo tanto, cada diferencia sobre la que advierte el arranque también aparece en el reporte, con las mismas palabras: una columna que es NOT NULL de un lado y anulable del otro, y una columna que la base de datos todavía tiene pero el archivo no (el arranque nunca elimina una, por lo que una propiedad renombrada deja atrás su columna antigua). Cada una es una advertencia, y la solución menciona `rebase db push`.

La comparación de la base de datos lee la base de datos del proyecto, resuelta de la manera en que `rebase db url` la resuelve — en un scaffold recién creado, la administrada, la cual inicia `doctor`. Cuando no se puede resolver ninguna, esa fase se reporta como **omitida** (**skipped**) en lugar de aprobada, y la ejecución nunca concluye con "All schemas are in sync" — una comprobación que no se realizó no es garantía de buen estado.

También menciona cada tabla sin un [bloque `search`](/docs/backend/search) cuya tabla contenga más de unas 10,000 filas. Una búsqueda allí — el cuadro de búsqueda del panel de administración, `.search()`, `?searchString=` — es un `ILIKE '%term%'` sobre las columnas de texto, el cual ningún índice puede atender, por lo que cada búsqueda lee la tabla completa, y su recuento la lee de nuevo (alrededor de un tercio de segundo con 100,000 filas, aumentando con el tamaño de la tabla). El recuento de filas es la propia estimación de Postgres, por lo que la comprobación no escanea nada. Es solo una sugerencia: no cambia el código de salida y no se indexa nada automáticamente.

Menciona una **unión huérfana** (**orphaned junction**): una tabla en `public` con estructura de tabla de unión muchos a muchos que ninguna tabla declara. La estructura consta de dos columnas que juntas forman la clave primaria, siendo cada una una clave foránea a una tabla declarada. Renombrar o eliminar un `manyToMany` deja atrás su antigua tabla de unión, ya que push y el arranque solo crean tablas, y cada fila de enlace sigue en ella. La nota es solo informativa, por lo que no altera el código de salida. Su solución es la sentencia `DROP TABLE`, que `doctor` muestra y nunca ejecuta.

### `rebase generate-sdk`

Genera un SDK tipado a partir de tus tablas:

```bash
rebase generate-sdk
```

**Qué hace:**
- Lee las tablas que exporta `backend/schema/index.ts`, a través del cargador desde el cual arranca el backend, de modo que el SDK describa con exactitud las tablas servidas; un esquema que no compile lo detiene
- Genera tipos de TypeScript para cada tabla en `generated/sdk/`
- Produce un archivo `database.types.ts` para usar con `createRebaseClient<Database>()`: el tipo `Database`, `TableName` (la unión de cada slug), y `tablesDictionary` / `TablesDictionary`, el mapa de descriptor de acceso (accessor) a slug

`rebase dev` ejecuta esto por ti al iniciar y con cada guardado en
`backend/schema/`. Ejecútalo tú mismo en CI, en un repositorio que no tenga
tablas propias (consulta `--from` más abajo), o en cualquier lugar donde `rebase dev` no se esté ejecutando.

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | El directorio del esquema (por defecto: `backend/schema`, o la clave `tables` en `rebase.json`); las rutas relativas se resuelven desde donde ejecutas el comando |
| `-o`, `--output` | Directorio de salida para el SDK (por defecto: `generated/sdk/`) |
| `--from <link\|url>` | Lee el esquema desde un proyecto en ejecución en lugar del código fuente local. `link` utiliza el proyecto vinculado a este checkout. |
| `--token` | Token de tipo Bearer para el endpoint de contrato (por defecto: `$REBASE_SERVICE_KEY` de la shell; no se lee `.env`) |
| `--register` | Tipa también los datos del lado del servidor: escribe los tipos y una declaración `Register` en `backend/generated/`, y lo recuerda en `rebase.json` — consulta [Datos tipados del lado del servidor](/docs/backend/typed-server-data/) |

`--from` es lo que permite a un repositorio que no contiene tablas — un frontend
independiente, una segunda aplicación web, una aplicación móvil — generar un cliente tipado a partir del
proyecto con el que se comunica: lee las `tables` del `/api/meta/contract` del backend en
ejecución. `REBASE_SERVICE_KEY` solo se envía al proyecto con el que este
checkout está vinculado; pasa `--token` explícitamente para cualquier otro host. La clave en
`.env` pertenece a tu backend local y nunca se envía.
Un rechazo indica
cuál de estos casos ocurrió: un `--token` rechazado, una clave de shell rechazada, una clave
retenida para un host no vinculado, una clave presente solo en `.env`, o ninguna clave en absoluto.

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

Los nombres de campo en los tipos generados son los que sirve la API. El nombre en el cable (wire
name) de un campo es su clave de columna, y la API utiliza camelCase en todo momento: la introspección
escribe una columna `created_at` como `createdAt: col.timestamp({ withTimezone: true })`, cuyo nombre en SQL
es el snake_case de la clave, y la sirve como `row.createdAt`. La columna
en sí no se modifica. El *descriptor de acceso* (accessor) de la tabla se transforma en un nombre de propiedad de
la misma manera (`my-notes` → `client.data.myNotes`), que es lo que `tablesDictionary`
mapea de vuelta al slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` traslada `config/collections` a
`backend/schema` (un `defineTable` por colección, cada columna explícita en
su posición original, con la sintaxis de Drizzle, y `index.ts` con
`defaultRls`) y `frontend/src/cms` (un `customizeTable` por colección
personalizada, archivos `defineFirestoreCollection`, `ui-config.json`), escribe
`backend/resources.ts`, `backend/storage.ts` y `backend/generated/register.ts`,
añade `rebaseBackendGuard()` al `vite.config.ts` del scaffold, y luego ejecuta
`rebase migrate sdk-calls`, el cual reescribe `.collection(` a `.table(`, los
demás renombramientos del SDK y los orígenes de reglas `existsIn` / `membership` en tu código,
y traslada las importaciones de nombres que la versión 0.31 movió a otro paquete
([la lista](/docs/upgrading/0-30-to-0-31-imports/)), añadiendo el paquete a las
dependencias de quien lo importa ("Dependencies added": ejecuta `pnpm install`). Actualiza todos los paquetes `@rebasepro` a la versión 0.31 antes de ejecutarlo.
Cada ejecución vuelve a leer el resultado: el SQL generado — DDL, políticas, búsqueda,
vector, disparadores, vistas, el esquema de Drizzle — debe ser idéntico byte por byte, o de lo contrario se
restaura cada archivo. Lo que no puede traspasar se rechaza indicando su archivo y línea, y
lo que te deja pendiente se imprime como pasos manuales numerados, terminando con
`rebase skills install` cuando el proyecto contiene agent skills. Tus propios módulos en
`config/` se conservan; la ejecución imprime la línea de `git rm` para lo que reemplazó. También
sigue colecciones de Firestore que construye una función, alias de rutas, un panel montado
fuera de `App.tsx` y cualquier aplicación estática no protegida ([la lista completa](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Después del `git rm`, `--check` reporta `already-migrated`.

| Flag | Efecto |
|---|---|
| `--dry-run` | Imprime archivos, rechazos, notas y pasos manuales; no escribe nada. Comienza aquí. |
| `--check` | En un proyecto migrado: comprueba que `backend/schema` aún renderiza el mismo SQL. Sale con código 1 mostrando el diff, o si alguna regla cambia de significado. |
| `--accept-rule-changes` | Con `--check`: indica que las reglas bajo "Review before deploying" fueron revisadas. |
| `--json` / `--force` / `--skip-sdk-calls` | El reporte en formato JSON (con `ruleChanges`); ejecuta sobre un árbol sucio o sobre una salida editada; no modifica tu código. |

Lee dos listas en la salida de su SDK: **"Rewritten by name — review"** (receptores
sin tipo, data slots, dobles de prueba) y **"Left unchanged — check each"**
(renombra aquellos que correspondan al SDK; [una búsqueda](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) encuentra el resto).

La comprobación de SQL demuestra que la conversión fue fiel, no que una regla siga significando lo
mismo que antes. La última sección de la salida, **"Review before deploying: these rules
change meaning"**, enumera cada regla cuya política ahora otorga algo diferente
— un simple `access: "authenticated"` no otorgaba nada y ahora admite a cualquier remitente
que haya iniciado sesión ([las cuatro formas](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Luego verifica contra tu base de datos: `rebase db push --dry-run` debería imprimir "No
changes: the database already matches these tables.", y
`rebase doctor --policies` ninguna desviación (no drift).

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
| Schema file not updating | Comprueba que la ruta `--schema-dir` (o la clave `tables` en `rebase.json`) apunte al directorio correcto |
| Migration shows unexpected changes | Ejecuta `rebase doctor` para identificar desviaciones |
| `db push` fails on production | Usa `db generate` + `db migrate` en su lugar |
| A migration must not drop data in CI or production | `rebase db migrate --refuse-destructive` sale con código 1 y no aplica nada cuando una sentencia pendiente destruye datos |
| `db migrate` fails with `already exists (42710)` | El arranque o `db push` ya aprovisionaron el esquema — regístralo con `rebase db migrate --baseline <version>` |
| `db migrate` fails with `column … already exists (42701)` | `rebase dev` añadió la columna al arrancar — establece la línea base para esa migración de la misma manera |
| `db push` on the managed database fails with `Error: EOF` | Atlas perdió una conexión mantenida por el `rebase dev` en ejecución. Ejecútalo de nuevo; si sigue fallando, detén `rebase dev` primero |

## Próximos pasos

- **[Tablas](/docs/schema/)** — Define tu modelo de datos
- **[Referencia de la CLI](/docs/cli)** — Todos los comandos de la CLI
- **[SDK tipado](/docs/sdk)** — Utiliza el SDK generado
