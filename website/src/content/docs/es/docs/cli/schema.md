---
sourceHash: 98d9c2872375ef18
title: Generación de esquemas
sidebar_label: Generación de esquemas
description: Genera esquemas de Drizzle ORM a partir de las tablas en backend/schema, crea migraciones SQL, realiza introspección de una base de datos existente hacia archivos defineTable y mantén tu base de datos sincronizada con la CLI de Rebase.
---

## Información general

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Rebase utiliza un pipeline de **schema-as-code** donde las tablas que declaras con
`defineTable` en `backend/schema/` son la única fuente de verdad. La CLI
las transforma a través de un pipeline determinista:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página cubre cada comando de la CLI involucrado en ese pipeline.

## El pipeline

### 1. Tablas → Esquema de Drizzle

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Las tablas que exporta `backend/schema/index.ts` describen columnas, tipos, relaciones,
enums y seguridad a nivel de fila (row-level security). Cada comando a continuación las lee a través del cargador
con el que arranca el backend, por lo que un esquema que no compile —una tabla sin
`rls`, `"inherit"` sin un `defaultRls`, un `defineTable` que el index no
exporta— detiene el comando con un `SchemaDefinitionError` indicando cada problema,
y no se escribe nada. El comando `schema generate` genera un archivo de esquema
de Drizzle ORM a partir de ellas.

Cada comando que lee el esquema acepta `--schema-dir <dir>` para un proyecto
que guarda sus tablas en otro lugar; el valor predeterminado es `backend/schema`, o la
clave `tables` de la app del backend en `rebase.json`. El flag previo a la versión 0.31, `--collections` / `-c`,
se rechaza con un mensaje que indica el codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), al igual que un
proyecto que aún conserva `config/collections`.

### 2. Esquema de Drizzle → Migraciones

A partir del esquema de Drizzle generado, `db generate` calcula las diferencias (diffs) respecto a las migraciones que ya están en `backend/drizzle/migrations/`, reproducidas en una base de datos temporal (scratch), y produce archivos de migración SQL con marca de tiempo. Nunca lee tu base de datos: una columna que el arranque o `db push` ya hayan añadido seguirá apareciendo como `ADD COLUMN`.

### 3. Migraciones → PostgreSQL

El comando `db migrate` aplica las migraciones pendientes a tu base de datos PostgreSQL.

## Comandos

### `rebase schema generate`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

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
| `--schema-dir` | El directorio de esquemas (predeterminado: `backend/schema`); las rutas relativas se resuelven desde donde ejecutas el comando |
| `--output, -o` | Ruta de salida para el archivo de esquema generado; las rutas relativas se resuelven desde donde ejecutas el comando |
| `--watch, -w` | Observa los cambios y regenera automáticamente |

El **modo watch** es útil durante el desarrollo: edita un archivo de tabla y el esquema se regenera al instante:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Comprueba si el esquema generado aún coincide con las tablas:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**Qué hace:**
- Renderiza lo que generan las tablas en `backend/schema/` y lo compara, declaración por declaración, con `backend/src/schema.generated.ts`
- Nombra cada diferencia —una tabla faltante, una columna con el tipo cambiado, una etiqueta de enum eliminada o claves foráneas nombradas como las derivaba una versión anterior— y sale con código distinto de cero
- Con `--fix`, regenera el archivo en lugar de generar un reporte

`rebase dev` mantiene el archivo actualizado por sí mismo, por lo que esta es la verificación ideal para un paso de compilación (build)
o CI. Acepta `--schema-dir` y `--output` al igual que `rebase schema generate`.

### `rebase schema reconcile`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Relaja y elimina lo que el arranque no puede, después de que hayas leído el plan:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Qué hace:**
- Le pide al backend en ejecución que planifique contra su propia base de datos. Ese es el backend al que apuntan `.env` y el enlace de la nube, por lo que funciona en Rebase Cloud, donde nada más puede acceder a la base de datos.
- Planifica `DROP NOT NULL` para cada columna que una tabla declare como anulable pero que la base de datos aún requiera.
- Lista cada columna que ninguna tabla declara. Una que sea `NOT NULL` sin valor predeterminado bloquea cada inserción, por lo que también se relaja y sus datos se conservan. Solo elimina las columnas que indiques con `--drop <table>.<column>`, y muestra cuántas filas contienen un valor en cada una.
- Se aplica una vez que escribes `yes`. El servidor ejecuta el plan únicamente sobre el digest del que leíste; por lo tanto, si la base de datos o las tablas cambiaron mientras tanto, lo rechaza y debes revisarlo de nuevo. `--yes` omite la confirmación.

El arranque únicamente añade cosas, por lo que después de eliminar una columna de su `defineTable`, la columna permanece en la base de datos con sus datos. Una columna `NOT NULL` sin valor predeterminado hace que fallen todas las inserciones, y el registro del arranque sugiere este comando para resolverlo: sin `--drop` para conservar los datos, y con él para eliminar la columna. Despliega primero el cambio de la tabla, ya que reconcile planifica contra lo que ejecuta el backend. Requiere `REBASE_SERVICE_KEY` en `.env`. A nivel local, `rebase db push` cubre lo mismo mediante su control de cambios destructivos.

### `rebase schema introspect`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Escribe archivos `defineTable` a partir de una base de datos PostgreSQL existente:

```bash
rebase schema introspect
```

**Qué hace:**
- Se conecta a la base de datos de este proyecto, la que imprime `rebase db url` (la administrada se inicia si se trata de ella); `--database-url` especifica otra, y `--docker` utiliza la de compose
- Lee cada tabla, columna, tipo, clave foránea y directiva de seguridad (policy), y escribe `backend/schema/<table>.ts` —un `defineTable` por tabla— y el `backend/schema/index.ts` que las exporta (fusionado en un index si ya existe uno)
- Declara cada columna con su tipo de Postgres: `col.uuid()`, `col.varchar({ length })`, `col.numeric({ precision, scale })`, un enum con sus etiquetas y nombre de tipo real (un `pgEnum` cuando el tipo es compartido), un array como `<item>.array()`, `col.vector({ dimensions })`, claves identity y serial, valores predeterminados —escritos tal como los escribe Drizzle. Un tipo que ningún builder defina se convierte en `col.custom({ dataType: "<sql type>" })`, el cual Rebase sirve tal como lo devuelve el controlador (driver); `db generate` y `db push` lo rechazan hasta que el planificador pueda procesarlo
- Declara la columna de clave foránea, el `belongsTo` en ella y el `hasMany` inverso en el destino; una tabla intermedia (junction) se convierte en un `manyToMany`, y sus propias columnas en el `pivot`
- Lee las directivas de seguridad a nivel de fila (RLS) de cada tabla en su `rls`: nombre, comando, modo, lista `TO`, `USING` y `WITH CHECK`. Las directivas `<table>_default_*` que Rebase añade por sí mismo se omiten, de modo que el `db push` posterior recrea cada directiva tal como estaba. Una tabla con seguridad a nivel de fila activada y sin directivas se escribe como `rls: "admin-only"`
- Lee cada expresión (el `USING` de una directiva, un CHECK, un valor predeterminado de columna) bajo el `search_path` que usa el servidor, `public`, por lo que una función en el esquema `rebase` se escribe como `rebase.roles()`
- Convierte un CHECK legible (`total >= 0`) en el `.validate()` de la columna y deja la restricción en la base de datos, donde el push posterior la conserva
- Coloca lo que no pudo determinar exactamente en un comentario al principio del archivo de la tabla y en la terminal —un conjunto cerrado de cadenas en una columna de texto, una columna generada cuya expresión no pudo leer, un tipo personalizado— junto con lo que un push le haría
- Con `--data-inference`, muestrea hasta 100 filas por tabla y escribe lo que detecta que corresponde a la presentación —títulos, iconos, tableros, ordenamientos, opciones de campos— en `frontend/src/cms/<table>.tsx` como un `customizeTable`, cuando el frontend del proyecto depende de `@rebasepro/cms`. Un proyecto headless no recibe nada de esto
- Frente a una base de datos que no está en ejecución, imprime el mismo banner que `db push`, una vez, y no crea nada. Imprime el directorio de salida como una ruta absoluta

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | Dónde escribir los archivos de tabla (predeterminado: `backend/schema`). Se eliminó `--output` |
| `--schema` | El esquema de Postgres a leer (predeterminado: `public`) |
| `--force, -f` | Sobrescribe los archivos de tabla que ya existan; sin este flag, se omitirá cualquier archivo existente |
| `--database-url` | Lee esta base de datos en lugar de la propia del proyecto |
| `--docker` | Lee la base de datos de compose, iniciándola si es necesario |
| `--data-inference` / `--no-data-inference` | Muestrea hasta 100 filas por tabla para detectar formatos, restricciones y ajustes de paneles, o lee únicamente la estructura. Sin ninguna de las dos opciones preguntará interactivamente, y sin una terminal leerá solo la estructura |

Esto resulta útil al adoptar Rebase en una base de datos existente: primero haz introspección y luego edita las tablas generadas. Una tabla con la seguridad a nivel de fila desactivada se escribe como cualquier otra, con su `rls`; el push activará RLS y la simulación (dry run) lo indicará. Un backend que se ejecuta sin ningún `backend/schema` sirve la base de datos directamente en su lugar; consulta [Backend only](/docs/getting-started/headless/).

### `rebase db push`

Envía los cambios de esquema directamente a la base de datos sin archivos de migración:

```bash
rebase db push
```

**Qué hace:**
- Lee el esquema de Drizzle generado
- Aplica los cambios directamente a la base de datos (CREATE, ALTER, DROP)
- Primero hace una simulación (dry run) del plan y se detiene antes de ejecutar cualquier acción que destruya datos: una tabla, columna, esquema, vista o tipo eliminado, un `TRUNCATE`, o un cambio de tipo de columna que pueda perder valores (`timestamptz` → `date`, `numeric` → `integer`), o un cambio de clave primaria —`(id)` → `(id, locale)` da a cada fila un nuevo id, por lo que los enlaces, claves foráneas e ids almacenados en otros lugares dejarán de encontrar su fila. También se detiene antes de eliminar una restricción CHECK o EXCLUDE existente en la base de datos: no se pierde ninguna fila, pero a partir de ese momento la base de datos aceptará las filas que antes rechazaba. Pregunta en una terminal interactiva, donde Ctrl-C o Ctrl-D responden negativamente, y de lo contrario lo rechaza; `--allow-destructive` lo aplica de todos modos. `--yes` aún lo hace también en esta versión, con una advertencia de desuso (deprecation); a partir de la próxima versión solo aprobará pushes que no destruyan nada. Un push que se detiene en este punto elimina su base de datos temporal `<db>_dev_diff` al salir
- Activa la seguridad a nivel de fila para cada tabla declarada, incluidas las tablas intermedias, justo después del cambio de esquema y antes de cualquier paso que pueda fallar, de modo que un push que se interrumpa a mitad del proceso deje una nueva tabla denegando todas las peticiones en lugar de abierta a ellas
- Aplica las directivas RLS a las que compila el `rls` de tus tablas y **elimina las directivas que un push anterior reemplazó**
- Deja intacta cualquier restricción CHECK y EXCLUDE en una tabla declarada. Una tabla no puede declarar ninguna de las dos, por lo que son reglas de la propia base de datos, escritas a mano o traídas por una base de datos que `schema introspect` adoptó; para eliminar una, bórrala manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Los triggers y funciones que hayas escrito tampoco se modifican
- Hace coincidir el nombre de todo lo que deja intacto de forma exacta, incluyendo si contiene un `.`, `[`, `]` o `*`
- Construye cualquier [índice de clave foránea que Rebase derive](/docs/backend/indexes#foreign-keys-are-indexed-for-you) que le falte a una tabla existente **antes** de la planificación, mediante `CREATE INDEX CONCURRENTLY`, para que las escrituras en la tabla continúen durante la compilación; Atlas lo encuentra luego en su lugar. `--dry-run` los nombra y no construye nada
- Marca (stamps) las directivas que aplica de la misma forma en que lo hace el arranque del servidor, de modo que el primer arranque después de un push las deja intactas en lugar de recrear cada una
- `--dry-run` lista los cambios de seguridad a nivel de fila que realizaría el push, bajo "Planned row-level security changes": las tablas en las que activa RLS y cada directiva que crea, reemplaza o elimina, calculadas tal como lo deciden los propios pasos del push. Solo indica "No changes" cuando ni el esquema ni la seguridad a nivel de fila cambian. Donde la marca de una directiva no coincide con su regla, o no tiene ninguna (una creada por `db migrate`, una escrita a mano), la simulación la crea nuevamente a partir de su regla bajo otro nombre, en una transacción que revierte, y compara lo que almacenó Postgres: una que resulta idéntica se considera sin cambios. Por lo tanto, una regla que `schema introspect` leyó como SQL no genera ningún plan, y tampoco las directivas que `db migrate` aplicó. Solo una que no pudo comparar (por ejemplo, si no se concedió el bloqueo de su tabla en dos segundos) se lista por separado. El push en sí imprime una sola línea contando los cambios
- Muestra cada instrucción que Atlas aplica una sola vez. Atlas se conecta sin SSL a una base de datos en esta máquina (`localhost`, `127.x`, `::1`) cuya URL no especifica `sslmode`, al igual que hace la app, en lugar de fallar con `SSL is not enabled on the server`; una URL que especifica `sslmode`, u otro host, se transfiere tal como está escrita. Una ejecución de Atlas que falla antes de planificar no deja ninguna base de datos `<db>_dev_diff` residual
- `--dry-run` no escribe nada en los archivos del proyecto: `src/schema.generated.ts` se deja tal como está, y las copias de `drizzle/*.sql` que una versión anterior confirmó en git se mencionan, pero no se eliminan. Solo la entrada del plan va a `.rebase/sql/`, que no se incluye en el control de versiones
- **No** crea archivos de migración

**Cuánto tiempo tarda.** Casi la totalidad de un push consiste en Atlas calculando el plan: construye el esquema deseado en una base de datos temporal y calcula la diferencia respecto a la real, y ese coste crece más rápido que la cantidad de tablas —en un portátil sin carga toma unos 0,25 s por plan con 11 tablas, 0,9 s con 111 y 5,5 s con 411. Un push que no cambia nada planifica una vez; uno que cambia algo planifica dos veces (la simulación que lee el control de cambios destructivos y luego la aplicación). Por lo tanto, un push en un esquema de 400 o más tablas tarda decenas de segundos, y más en una máquina ocupada o lenta. Ese tiempo pertenece a Atlas, no a tu base de datos: los pasos circundantes —generar el SQL, el bloqueo de RLS, búsqueda, triggers, directivas, el rol— toman unos pocos segundos a esa escala, a través de una sola conexión a tu base de datos.

**Los archivos que genera en el proceso**, todos bajo `.rebase/sql/` en el directorio del backend. `db push` y `db generate` escriben los cinco a partir de tus tablas en cada ejecución, antes de leer cualquiera de ellos, por lo que una copia confirmada en git no sería leída por nada. El directorio incluye su propio `.gitignore` y nunca se confirma en el repositorio.

| Archivo | Contenido |
|---------|-----------|
| `schema.sql` | Tablas, columnas, restricciones e índices: el estado deseado por Atlas y el único sobre el cual calcula diferencias |
| `policies.sql` | Las directivas RLS a las que compila el `rls` de tus tablas |
| `search.sql` | Las funciones de búsqueda de texto completo y columnas generadas, para tablas con un bloque `search` |
| `vector.sql` | Extensiones de pgvector e índices ANN |
| `triggers.sql` | `rebase.set_updated_at()` y los triggers `BEFORE UPDATE` detrás de `.onUpdateNow()` |

Atlas gestiona el primero y nada más, por lo que `db push` y el aseguramiento del esquema en el arranque aplican los otros cuatro por su cuenta. Un despliegue **basado únicamente en migraciones** —uno que ejecuta `db migrate` y nunca `db push`— debe incorporar esos cuatro en una migración manualmente; `db generate` lo avisa cuando un cambio es invisible para Atlas.

Un proyecto que haya confirmado estos archivos en `drizzle/` bajo una versión anterior verá eliminadas esas copias en su primera ejecución, y el comando mencionará cada una para que puedas confirmar la eliminación en git. Solo elimina archivos que comiencen con el encabezado del generador. Un archivo que hayas escrito tú mismo se conserva, al igual que `drizzle/migrations/`.

:::note[Editar una regla de seguridad renombra su directiva]
Una regla sin un `name` explícito compila a `<table>_<op>_<hash>`, donde el hash cubre la semántica de la regla; por lo tanto, *editar* una regla (en lugar de añadir una) produce una directiva con un nuevo nombre y deja la anterior atrás.

Esto solía importar mucho: Postgres combina las directivas `PERMISSIVE` mediante OR, por lo que una directiva reemplazada con `USING (rebase.uid() IS NOT NULL)` seguía concediendo acceso a todo sin importar cuán estricto fuera su reemplazo. Restringir una regla no tenía efecto y push reportaba éxito.

`db push` ahora concilia esto: elimina las directivas generadas que ya no coincidan con ninguna regla y reporta —sin eliminar— cualquier directiva con nombre personalizado que tus tablas no describan, ya que no se pueden distinguir del SQL que alguien escribió deliberadamente.

Para auditar una base de datos a la que se le hizo push antes de esta actualización, ejecuta `rebase doctor --policies`. Funciona como una barrera en CI: sale con código distinto de cero si hay discrepancias (drift), y también cuando no pudo ejecutar la verificación en absoluto —falta de `DATABASE_URL`, una ruta de `--schema-dir` que no se resuelve, o lectura de `pg_policies` no concedida al rol de CI. Una verificación que no pudo ejecutarse no se considera aprobada.

`doctor` y `db push` distinguen los dos tipos de elementos huérfanos. Una directiva con un nombre generado fue reemplazada y el siguiente push la eliminará. Cualquier otro nombre fue escrito a mano o por otra herramienta y sigue en vigor: descríbela en el `rls` de su tabla para conservarla (la vista de RLS de Studio la importa) o elimínala a mano si está obsoleta.
:::

:::caution
`db push` modifica la base de datos directamente. Úsalo solo en desarrollo. Para producción, usa `db generate` + `db migrate` para crear archivos de migración revisables.
:::

### `rebase db generate`

Genera archivos de migración SQL a partir de los cambios de esquema:

```bash
rebase db generate
```

**Qué hace:**
- Compara el esquema de Drizzle contra el estado que construyen las migraciones en `drizzle/migrations/`, no contra tu base de datos
- Produce archivos de migración SQL con marca de tiempo en `backend/drizzle/migrations/`
- Los archivos se pueden revisar, editar y confirmar en el control de versiones
- Nombra cada instrucción en la nueva migración que destruya datos, utilizando la misma comprobación que `db push` ejecuta antes de aplicar: una tabla, columna, esquema, vista o tipo eliminado, un `TRUNCATE`, un cambio de tipo de columna que pueda perder valores, un cambio de clave primaria, o la eliminación de una restricción CHECK o EXCLUDE que la base de datos contiene. Aun así, escribe el archivo y sale con código 0, por lo que advierte pero no rechaza.
- Termina indicando qué hacer a continuación: `rebase db migrate`, y para la primera migración de un proyecto, el `--baseline <version>` que el arranque de una base de datos ya configurada necesita en su lugar. Una migración posterior no incluye la línea de línea base, ya que una destructiva establecida como línea base omitiría su `DROP`, y una ejecución que no escribe ninguna migración indica únicamente eso.

**El siguiente cambio eliminará un CHECK que haya añadido una de tus migraciones.** `db generate` calcula las diferencias de tus archivos de migración, no de la base de datos, y Atlas no tiene forma de omitir un objeto en esa comparación. Por lo tanto, una restricción CHECK o EXCLUDE que hayas escrito a mano en una migración, y que ninguna tabla pueda declarar, regresa como `ALTER TABLE … DROP CONSTRAINT …` en la siguiente migración que escriba, integrada en la misma instrucción que el cambio real. El reporte anterior nombra esa eliminación cuando la base de datos ya contiene la restricción; no la extrae del archivo. Elimina la cláusula antes de `rebase db migrate`, o deja que `rebase db migrate --refuse-destructive` se detenga en ella. `db push` lee la base de datos y conserva la restricción.

Las migraciones generadas son archivos SQL planos: puedes inspeccionarlos y modificarlos antes de aplicarlos.

### `rebase db migrate`

Ejecuta todas las migraciones pendientes:

```bash
rebase db migrate
```

**Qué hace:**
- Lee `drizzle/migrations/` en busca de migraciones no aplicadas
- Las aplica en orden a la base de datos
- Lleva un registro de qué migraciones se han aplicado
- Marca (stamps) las directivas de seguridad a nivel de fila de la misma manera que lo hacen `db push` y el arranque del servidor, para que el primer arranque después de una migración las deje intactas en lugar de recrear cada una. Una migración se escribió a partir de las tablas de su momento, por lo que una directiva solo se marca cuando coincide exactamente con lo que su regla genera ahora: migrate la crea de nuevo a partir de su regla bajo otro nombre, en una transacción que revierte, y compara lo que Postgres almacenó, tal como lo hace `db push --dry-run`. Una directiva que difiera no recibe ninguna marca, y el siguiente arranque vuelve a aplicar su tabla

`--refuse-destructive` hace que lo rechace en su lugar. Primero ejecuta una simulación (dry run) de las migraciones pendientes. Si alguna instrucción destruye datos, según la misma comprobación que utilizan `db push` y `db generate`, lista esas instrucciones y sale con código 1. No aplica nada, ni siquiera los archivos anteriores a esa instrucción. Sin el flag, `db migrate` se comporta como antes y aplica cada archivo pendiente:

```bash
rebase db migrate --refuse-destructive
```

Una migración que reconstruye una columna de búsqueda la elimina primero, por lo que este flag también rechazará esa migración. Lee la lista que imprime y luego ejecuta `rebase db migrate` sin el flag para aplicarla.

#### Establecer una línea base (baseline) en una base de datos donde Rebase ya ha arrancado

Cada arranque de Rebase asegura el esquema, y `rebase db push` lo aplica directamente. Por lo tanto, una base de datos que haya ejecutado cualquiera de los dos ya contiene las tablas y tipos que la primera migración crearía, y `rebase db migrate` se detiene con `pq: type "posts_status" already exists (42710)`.

No hay nada malo con la migración: la base de datos se aprovisionó de otra manera. Registra el punto en el que ya se encuentra y luego migra normalmente:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versión es el prefijo numérico del archivo de migración que describe lo que hay en la base de datos *ahora*. Esa migración y todo lo anterior se registran como aplicados; todo lo posterior se ejecuta. En una base de datos contra la cual nunca ha arrancado nada, no se necesita ninguna línea base: migra directamente.

Lo mismo sucede más adelante en el ciclo de trabajo habitual: edita una tabla mientras `rebase dev` se ejecuta, y el arranque añade la columna antes de que `rebase db generate` escriba la migración que la añade, por lo que `rebase db migrate` se detiene con `column … already exists (42701)`. Establece la línea base para esa migración de la misma manera. `--baseline` funciona en una base de datos que ya registra migraciones: marca todo hasta esa versión como aplicado con `atlas migrate set`, y lo confirma, o indica que no hay nada que registrar cuando el historial ya la alcanza. Una versión que ningún archivo en `drizzle/migrations` tenga se rechaza antes de ejecutar nada, indicando las versiones disponibles.

### `rebase db branch`

Gestión de ramas (branching) de bases de datos para desarrollo en paralelo:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (y `switch --off`) y `rebase db branch prune` son nuevos. `create`, `list`, `info` y `delete` se incorporaron en la versión 0.17.

Cada rama es una copia completa de la base de datos creada con `CREATE DATABASE ... TEMPLATE`, por lo que necesita un servidor PostgreSQL real y ocupa el mismo espacio en disco que su origen.

### `rebase doctor`

Detecta discrepancias tripartitas (three-way drift) entre tus tablas, el esquema de Drizzle generado y la base de datos PostgreSQL en vivo:

```bash
rebase doctor
```

**Qué comprueba:**
- Tablas ↔ Esquema generado: ¿están sincronizados?
- Esquema generado ↔ Base de datos: ¿hay cambios sin aplicar?
- Tablas ↔ Base de datos: ¿hay alguna discrepancia inesperada?

Ejecuta `doctor` siempre que sientas que algo está desincronizado. Identifica con exactitud dónde se encuentra la discrepancia.

La comparación con la base de datos incluye la que realiza el arranque antes de advertir que `schema.generated.ts` y la base de datos no concuerdan, ejecutada a través del mismo código. Por lo tanto, cada diferencia sobre la que el arranque advierte también está en el reporte, en las mismas palabras: una columna que es NOT NULL en un lado y nullable en el otro, y una columna que la base de datos aún tiene y el archivo no (el arranque nunca elimina una, por lo que una propiedad renombrada deja su columna anterior atrás). Cada una es una advertencia, y la solución indica `rebase db push`.

La comparación con la base de datos lee la base de datos del proyecto, resuelta de la misma forma que `rebase db url` la resuelve —en un scaffold nuevo, la administrada, que `doctor` inicia. Cuando no se puede resolver ninguna, esa fase se reporta como **omitida** en lugar de aprobada, y la ejecución nunca concluye con "All schemas are in sync": una comprobación que no se llevó a cabo no es una confirmación de buen estado.

También señala cada tabla sin un [`search` block](/docs/backend/search) cuya tabla contenga más de aproximadamente 10.000 filas. Una búsqueda allí —el cuadro de búsqueda del panel de administración, `.search()`, `?searchString=`— se ejecuta como `ILIKE '%term%'` sobre las columnas de texto, lo cual ningún índice puede optimizar, por lo que cada consulta lee la tabla completa y su conteo vuelve a leerla por completo (aproximadamente un tercio de segundo con 100.000 filas, aumentando con el tamaño de la tabla). El recuento de filas es la propia estimación de Postgres, por lo que la comprobación no escanea nada. Es una sugerencia: no modifica el código de salida y no se indexa nada automáticamente por ti.

Identifica una **tabla intermedia huérfana (orphaned junction)**: una tabla en `public` con la estructura de una unión muchos a muchos que ninguna tabla declara. La estructura consiste en dos columnas que juntas forman la clave primaria, siendo cada una de ellas una clave foránea hacia una tabla declarada. Renombrar o eliminar un `manyToMany` deja su unión anterior atrás, porque push y boot solo crean tablas, y cada fila de enlace todavía está en ella. La nota es solo informativa, por lo que no altera el código de salida. Su solución es la instrucción `DROP TABLE`, que `doctor` muestra y nunca ejecuta.

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Genera un SDK tipado a partir de tus tablas:

```bash
rebase generate-sdk
```

**Qué hace:**
- Lee las tablas que exporta `backend/schema/index.ts`, a través del cargador con el que arranca el backend, para que el SDK describa exactamente las tablas servidas; un esquema que no compile detiene el proceso
- Genera tipos de TypeScript para cada tabla en `generated/sdk/`
- Produce un archivo `database.types.ts` para usar con `createRebaseClient<Database>()`: el tipo `Database`, `TableName` (la unión de cada slug) y `tablesDictionary` / `TablesDictionary`, el mapa del descriptor de acceso al slug

`rebase dev` ejecuta esto por ti al iniciar y en cada guardado en
`backend/schema/`. Ejecútalo tú mismo en CI, en un repositorio que no tenga
tablas propias (consulta `--from` más abajo) o en cualquier lugar donde `rebase dev` no se esté ejecutando.

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | El directorio de esquemas (predeterminado: `backend/schema`, o la clave `tables` en `rebase.json`); las rutas relativas se resuelven desde donde ejecutas el comando |
| `-o`, `--output` | Directorio de salida para el SDK (predeterminado: `generated/sdk/`) |
| `--from <link\|url>` | Lee el esquema de un proyecto en ejecución en lugar del código fuente local. `link` utiliza el proyecto vinculado a este checkout. |
| `--token` | Token de portador (Bearer token) para el endpoint del contrato (predeterminado: `$REBASE_SERVICE_KEY` de la shell; `.env` no se lee) |
| `--register` | También tipa los datos del lado del servidor: escribe los tipos y una declaración `Register` en `backend/generated/`, y lo recuerda en `rebase.json` — consulta [Datos tipados en el servidor](/docs/backend/typed-server-data/) |

`--from` es lo que permite que un repositorio que no contiene tablas —un
frontend independiente, una segunda aplicación web, una aplicación móvil— genere un cliente tipado a partir del
proyecto con el que se comunica: lee las `tables` del `/api/meta/contract` del backend en ejecución.
`REBASE_SERVICE_KEY` solo se envía al proyecto al que está vinculado este checkout;
pasa `--token` explícitamente para cualquier otro host. La clave en
`.env` pertenece a tu backend local y nunca se envía.
Un rechazo indica cuál de estas situaciones ocurrió: un `--token` rechazado, una clave de shell rechazada, una clave
retenida para un host no vinculado, una clave presente únicamente en `.env`, o ninguna clave en absoluto.

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

Los nombres de campo en los tipos generados son los que sirve la API. El nombre de transmisión de un campo
es su clave de columna, y la API utiliza camelCase en todas partes: la introspección
escribe una columna `created_at` como `createdAt: col.timestamp({ withTimezone: true })`, cuyo nombre SQL
es el snake_case de la clave, y la sirve como `row.createdAt`. La columna
en sí no se modifica. El *descriptor de acceso* de la tabla se transforma en un nombre de propiedad
de la misma manera (`my-notes` → `client.data.myNotes`), que es lo que `tablesDictionary`
asocia nuevamente al slug.

### `rebase migrate`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`rebase migrate collections-to-tables [dir]` traslada `config/collections` a
`backend/schema` (un `defineTable` por colección, cada columna explícita en
su posición original, según la sintaxis de Drizzle, y `index.ts` con
`defaultRls`) y a `frontend/src/cms` (un `customizeTable` por cada colección
personalizada, archivos `defineFirestoreCollection`, `ui-config.json`), escribe
`backend/resources.ts`, `backend/storage.ts` y `backend/generated/register.ts`,
añade `rebaseBackendGuard()` al `vite.config.ts` de un scaffold, y luego ejecuta
`rebase migrate sdk-calls`, que reescribe `.collection(` por `.table(`, los
demás cambios de nombre del SDK y los orígenes de reglas `existsIn` / `membership` en tu código,
y traslada las importaciones de identificadores que la versión 0.31 movió a otro paquete (los tipos y ayudantes del panel
de administración a `@rebasepro/cms-types`, la migración lift a
`@rebasepro/common/migrate` — [la lista](/docs/upgrading/0-30-to-0-31-imports/)),
añadiendo el paquete a las dependencias del importador ("Dependencies added": ejecuta
`pnpm install`). Actualiza cada paquete de `@rebasepro` a la versión 0.31 antes de ejecutarlo.
Cada ejecución vuelve a leer el resultado: el SQL generado —DDL, directivas, búsqueda,
vector, triggers, vistas, el esquema de Drizzle— debe ser idéntico byte por byte, o de lo contrario cada
archivo se restablece. Lo que no pueda trasladar se rechaza indicando su archivo y línea, y
lo que queda a tu cargo se imprime como pasos manuales numerados, terminando con
`rebase skills install` cuando el proyecto contiene habilidades de agente. Tus propios módulos en
`config/` se conservan; la ejecución imprime la línea `git rm` para lo que reemplazó.

| Flag | Efecto |
|---|---|
| `--dry-run` | Imprime archivos, rechazos, notas y pasos manuales; no escribe nada. Comienza por aquí. |
| `--check` | En un proyecto migrado: comprueba que `backend/schema` todavía genere el mismo SQL. Sale con código 1 mostrando el diff, o si una regla cambia de significado. |
| `--accept-rule-changes` | Con `--check`: indica que las reglas bajo "Review before deploying" fueron revisadas. |
| `--json` / `--force` / `--skip-sdk-calls` | El reporte en formato JSON (con `ruleChanges`); ejecutar en un árbol sucio o sobre una salida editada; no toca tu código. |

Revisa dos listas en su salida del SDK: **"Rewritten by name — review"** (llamadas sobre un
receptor no tipado, reescritas por su nombre) y **"Left unchanged — check each"**
(llamadas que no se verificaron como pertenecientes al SDK: renombra aquellas que lo sean, o fallarán en tiempo de ejecución).

La comprobación de SQL demuestra que la conversión es fiel, no que una regla todavía signifique lo que
significaba. La última sección de la salida, **"Review before deploying: these rules change meaning"**, enumera cada regla cuya directiva ahora concede algo diferente
—un simple `access: "authenticated"` no concedía nada y ahora admite a cualquier
usuario autenticado ([las cuatro variantes](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Luego comprueba contra tu base de datos: `rebase db push --dry-run` debería imprimir "No
changes: the database already matches these tables.", y
`rebase doctor --policies` ninguna discrepancia (no drift).

## Flujo de trabajo de desarrollo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El flujo de trabajo de iteración rápida para desarrollo:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Flujo de trabajo de producción

<span class="since-badge" data-since="0.31">Desde 0.31</span>

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
| La migración muestra cambios inesperados | Ejecuta `rebase doctor` para identificar discrepancias (drift) |
| `db push` falla en producción | Usa `db generate` + `db migrate` en su lugar |
| Una migración no debe eliminar datos en CI o producción | `rebase db migrate --refuse-destructive` sale con código 1 y no aplica nada cuando una instrucción pendiente destruye datos |
| `db migrate` falla con `already exists (42710)` | El arranque o `db push` ya aprovisionaron el esquema — regístralo con `rebase db migrate --baseline <version>` |
| `db migrate` falla con `column … already exists (42701)` | `rebase dev` añadió la columna al arrancar — establece la línea base para esa migración de la misma manera |
| `db push` en la base de datos administrada falla con `Error: EOF` | Atlas perdió una conexión que el proceso activo de `rebase dev` mantiene abierta. Ejecútalo de nuevo; si sigue fallando, detén primero `rebase dev` |

## Próximos pasos

- **[Tablas](/docs/schema/)** — Define tu modelo de datos
- **[Referencia de la CLI](/docs/cli)** — Todos los comandos de la CLI
- **[SDK tipado](/docs/sdk)** — Usa el SDK generado
