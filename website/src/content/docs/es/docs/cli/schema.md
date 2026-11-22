---
sourceHash: 06945ca1e787897f
title: Generación de esquemas
sidebar_label: Generación de esquemas
description: Genera esquemas de Drizzle ORM a partir de las tablas en backend/schema, crea migraciones SQL, realiza introspección de una base de datos existente en archivos defineTable y mantén tu base de datos sincronizada con el CLI de Rebase.
---

## Descripción general

Rebase utiliza un pipeline de **esquema como código** donde las tablas declaradas con
`defineTable` en `backend/schema/` son la única fuente de verdad. El CLI
las transforma a través de un pipeline determinista:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página cubre cada comando del CLI involucrado en ese pipeline.

## El Pipeline

### 1. Tablas → Esquema de Drizzle

Las tablas que exporta `backend/schema/index.ts` describen columnas, tipos, relaciones,
enums y seguridad a nivel de fila (RLS). Cada uno de los siguientes comandos las lee a través del loader
con el que arranca el backend, por lo que un esquema que no compila —una tabla sin
`rls`, `"inherit"` sin `defaultRls`, o un `defineTable` que el index no
exporta— detiene el comando con un `SchemaDefinitionError` indicando cada problema,
y no se escribe nada. El comando `schema generate` genera un archivo de esquema de Drizzle ORM
a partir de ellas.

Cada comando que lee el esquema acepta `--schema-dir <dir>` para proyectos
que guardan sus tablas en otra ubicación; el valor predeterminado es `backend/schema`, o la
clave `tables` de la aplicación de backend en `rebase.json`. El flag previo a la versión 0.31, `--collections` / `-c`,
es rechazado con un mensaje indicando el codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), al igual que cualquier
proyecto que aún conserve `config/collections`.

### 2. Esquema de Drizzle → Migraciones

A partir del esquema de Drizzle generado, `db generate` calcula las diferencias frente a las migraciones existentes en `backend/drizzle/migrations/`, reproducidas en una base de datos temporal (scratch database), y genera archivos de migración SQL con marca de tiempo. Nunca lee tu base de datos: una columna que el arranque (boot) o `db push` ya hayan añadido seguirá apareciendo como `ADD COLUMN`.

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
| `--watch, -w` | Observa cambios y regenera automáticamente |

El **modo watch** es útil durante el desarrollo: edita un archivo de tabla y el esquema se regenera instantáneamente:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Comprueba si el esquema generado sigue coincidiendo con las tablas:

```bash
rebase schema stale          # informa y sale con código 1 si algo está desactualizado
rebase schema stale --fix    # regenera el archivo en su lugar
```

**Qué hace:**
- Renderiza lo que generan las tablas en `backend/schema/` y lo compara, declaración por declaración, con `backend/src/schema.generated.ts`
- Nombra cada diferencia —una tabla faltante, una columna con tipo modificado, una etiqueta de enum eliminada o claves foráneas nombradas como las derivaba una versión anterior— y sale con un código distinto de cero
- Con `--fix`, regenera el archivo en lugar de solo reportar

`rebase dev` mantiene el archivo actualizado por sí mismo, por lo que esta es la verificación ideal para un paso de build
o de CI. Acepta `--schema-dir` y `--output` igual que `rebase schema generate`.

### `rebase schema reconcile`

Relaja y elimina lo que el arranque no modificará, después de haber revisado el plan:

```bash
rebase schema reconcile                         # relaja NOT NULL en columnas hechas anulables o eliminadas
rebase schema reconcile --drop voice_cache.wav  # y elimina una columna que ninguna tabla declara
```

**Qué hace:**
- Solicita al backend en ejecución que planifique contra su propia base de datos. Ese es el backend al que apuntan `.env` y el enlace a la nube, por lo que funciona en Rebase Cloud, donde nada más tiene acceso directo a la base de datos.
- Planifica `DROP NOT NULL` para cada columna que una tabla declare como anulable pero que la base de datos aún requiera como obligatoria.
- Lista cada columna que ninguna tabla declare. Una columna que sea `NOT NULL` sin valor por defecto bloquea cualquier inserción, por lo que también se relaja y sus datos se conservan. Solo elimina las columnas que especifiques con `--drop <table>.<column>`, y muestra cuántas filas contienen un valor en cada una.
- Se aplica una vez que escribes `yes`. El servidor ejecuta el plan únicamente sobre el digest del plan que revisaste, por lo que si la base de datos o las tablas cambiaron en el transcurso, se rechaza y deberás revisar nuevamente. `--yes` omite la confirmación.

El arranque (boot) solo añade elementos, por lo que después de eliminar una columna de su `defineTable`, su columna permanece en la base de datos junto con sus datos. Una columna `NOT NULL` sin valor predeterminado hará que fallen todas las inserciones, y el registro de boot recomendará este comando: sin `--drop` para conservar los datos, con él para eliminar la columna. Despliega primero el cambio de la tabla, ya que reconcile planifica en función de lo que el backend está ejecutando. Requiere `REBASE_SERVICE_KEY` en `.env`. A nivel local, `rebase db push` cubre lo mismo mediante su control de cambios destructivos.

### `rebase schema introspect`

Genera archivos `defineTable` a partir de una base de datos PostgreSQL existente:

```bash
rebase schema introspect
```

**Qué hace:**
- Se conecta a la base de datos de este proyecto, la que imprime `rebase db url` (si es la administrada, se inicia en caso necesario); `--database-url` especifica otra, y `--docker` utiliza la de compose
- Lee cada tabla, columna, tipo, clave foránea y política, y escribe
  `backend/schema/<table>.ts` —un `defineTable` por tabla— y el
  `backend/schema/index.ts` que las exporta (fusionado en un index si ya existe uno)
- Declara cada columna con su tipo de Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, un enum con sus etiquetas y nombre de tipo real
  (un `pgEnum` cuando el tipo es compartido), un array como `<item>.array()`,
  `col.vector({ dimensions })`, claves identity y serial, valores predeterminados —escritos tal
  como los escribe Drizzle. Un tipo que ningún builder soporte se convierte en
  `col.custom({ dataType: "<sql type>" })`, el cual Rebase sirve tal como lo devuelve
  el controlador; `db generate` y `db push` lo rechazan hasta que el planificador
  pueda interpretarlo
- Declara la columna de clave foránea, el `belongsTo` correspondiente y el
  `hasMany` inverso en el destino; una tabla de unión se convierte en un `manyToMany`, y sus
  propias columnas forman el `pivot`
- Lee las políticas de seguridad a nivel de fila (RLS) de cada tabla en su propiedad `rls`: nombre,
  comando, modo, lista `TO`, `USING` y `WITH CHECK`. Las políticas `<table>_default_*`
  que Rebase añade por su cuenta se omiten, de modo que el `db push` posterior recrea
  cada política tal como estaba. Una tabla con seguridad a nivel de fila activada y sin políticas se
  escribe con `rls: "admin-only"`
- Lee cada expresión (el `USING` de una política, un CHECK, un valor predeterminado de columna) bajo
  el `search_path` que utiliza el servidor, `public`, de modo que una función en el esquema `rebase`
  se escribe como `rebase.roles()`
- Convierte un CHECK que pueda interpretar (`total >= 0`) en el `.validate()` de la columna, y deja la restricción intacta en la base de datos, donde el push posterior la conserva. Cada CHECK también se lista bajo "Not carried over" con su SQL: un push hacia una *nueva* base de datos crea la validación, no la restricción
- Declara cada índice simple (solo columnas, btree, gin o brin, sin predicado) en los `indexes` de la tabla. Un índice exclusivo sobre una columna de clave foránea se delega a la relación, que crea uno automáticamente
- Con `--from supabase`, traduce las convenciones de Supabase para una base de datos que estés migrando: un valor predeterminado de columna `auth.uid()` se convierte en `.onCreateUser()` (el servidor escribe el id del invocador), una columna que almacena un id de usuario de Supabase (ese default, o una clave foránea hacia `auth.users`) se convierte en `col.text().userId()`, ya que `rebase.users.id` y `rebase.uid()` son de tipo texto, y una política `TO authenticated` / `TO anon` pierde el rol (una base de datos de Rebase no tiene ninguno de los dos) y requiere en su lugar un invocador autenticado / no autenticado; una política exclusiva para `service_role` se descarta. Cada cambio se anota en la parte superior del archivo de la tabla. Sin este flag, se dejan tal como están (Rebase ejecutándose en la misma base de datos junto a Supabase aún los necesita), y la ejecución informa cuando los encuentra
- Concluye con lo que **no** se transfirió: funciones, triggers, extensiones, CHECKs, índices que `indexes` no puede expresar, claves foráneas sobre múltiples columnas o hacia otro esquema. El SQL que recrea cada elemento que Postgres puede imprimir se escribe en `backend/sql/_introspected-left-behind.sql` a modo de borrador: revísalo, asegúrate de que sea seguro ejecutarlo repetidamente y renómbralo quitando el `_` inicial; `rebase db push` y cada despliegue lo aplicarán cada vez que cambie
- Te recuerda que `DATABASE_URL` todavía apunta a la base de datos leída: en una migración esa es la fuente, y un `db push` en ese momento escribiría sobre ella
- En un proyecto headless, reemplaza el archivo `ai-instructions.md` del scaffold ("la base de datos es el esquema") con las reglas de esquema en código solo para backend, siempre que el archivo coincida exactamente con el generado originalmente; si ha sido editado no se toca, y el comando indica cuáles de sus reglas ya no aplican
- Añade en un comentario en la parte superior del archivo de la tabla y en la terminal lo que no pudo determinar con exactitud —un conjunto cerrado de cadenas en una columna de texto, una columna generada cuya expresión no pudo leer, un tipo personalizado— junto con lo que un push le haría
- Con `--data-inference`, muestrea hasta 100 filas por tabla y escribe lo que
  identificó como presentación —títulos, iconos, tableros, ordenamientos, opciones de campos— en
  `frontend/src/cms/<table>.tsx` como un `customizeTable`, cuando el frontend del
  proyecto depende de `@rebasepro/cms`. Un proyecto headless no recibe nada
- Frente a una base de datos que no está en ejecución, imprime el mismo aviso que emite
  `db push`, una sola vez, y no crea nada. Muestra el directorio de salida como una
  ruta absoluta

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | Dónde escribir los archivos de tablas (por defecto: `backend/schema`). `--output` fue eliminado |
| `--schema` | El esquema de Postgres que se va a leer (por defecto: `public`) |
| `--force, -f` | Sobrescribe los archivos de tablas que ya existan; sin él, se omite cualquier archivo existente |
| `--database-url` | Lee esta base de datos en lugar de la propia del proyecto |
| `--docker` | Lee la base de datos de compose, iniciándola si es necesario |
| `--from supabase` | Traduce las convenciones de Supabase (defaults `auth.uid()`, claves foráneas a `auth.users`, `TO anon` / `TO authenticated`) para una base de datos Rebase. Omítelo cuando Rebase opere en la misma base de datos junto a Supabase |
| `--data-inference` / `--no-data-inference` | Muestrea hasta 100 filas por tabla para detectar formatos, restricciones y ajustes del panel, o lee únicamente la estructura. Sin ninguno de los dos, solicita confirmación; sin una terminal interactiva, lee únicamente la estructura |
| `--users` | Escribe también `users.ts` para `rebase.users`, como un `defineAuthTable` que coincide con la tabla creada por auth. Muestra Users en el admin como una tabla a la que puedes añadir columnas. Sin él, las cuentas se gestionan en Users & Roles de Studio |

Esto resulta útil al adoptar Rebase sobre una base de datos existente: realiza la introspección
primero y luego edita las tablas generadas. Una tabla con seguridad a nivel de fila desactivada se
escribe como cualquier otra, con su propiedad `rls`; el push activará RLS y el simulacro
(dry run) así lo indicará. Un backend que se ejecuta sin ningún `backend/schema` sirve la
base de datos directamente; consulta [Solo backend](/docs/getting-started/headless/).
¿Migrando desde Supabase? Consulta [Migración desde Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Envía los cambios del esquema directamente a la base de datos sin archivos de migración:

```bash
rebase db push
```

**Qué hace:**
- Lee el esquema de Drizzle generado
- Aplica los cambios directamente a la base de datos (CREATE, ALTER, DROP)
- Ejecuta primero un simulacro (dry run) del plan y se detiene antes de cualquier acción que destruya datos: una
  tabla, columna, esquema, vista o tipo eliminado, un `TRUNCATE`, un cambio de
  tipo de columna que pueda perder valores (`timestamptz` → `date`, `numeric` → `integer`),
  o un cambio de clave primaria — `(id)` → `(id, locale)` asigna a cada fila un nuevo id,
  por lo que enlaces, claves foráneas e ids almacenados en otros lugares dejarán de encontrar su fila.
  También se detiene
  antes de la eliminación de una restricción CHECK o EXCLUDE existente en la base de datos: ninguna fila
  se pierde, pero a partir de ese momento la base de datos aceptará filas que antes rechazaba.
  Solicita confirmación en una terminal, donde Ctrl-C o Ctrl-D responden negativamente, y de
  lo contrario rechaza la operación; `--allow-destructive` la aplica de todos modos. `--yes` aún lo permite en
  esta versión, mostrando una advertencia de desuso (deprecation); a partir de la próxima versión solo aprobará
  pushes que no destruyan nada. Un push que
  se detiene en ese punto elimina su base de datos temporal `<db>_dev_diff` al salir
- Activa la seguridad a nivel de fila en cada tabla declarada, incluidas las de unión, inmediatamente después del
  cambio de esquema y antes de cualquier paso que pueda fallar, asegurando que un push interrumpido a mitad de camino deje una nueva tabla
  denegando cualquier solicitud en lugar de dejarla abierta
- Aplica las políticas RLS a las que compila el `rls` de tus tablas, y **elimina las políticas que un push anterior haya reemplazado**
- <span class="since-badge" data-since="0.35">Desde 0.35</span> Con `--prune-policies`, también elimina las políticas en tablas declaradas que ninguna tabla declare —las que el dry run lista como "left in force", tales como políticas propias de la base de datos después de que una tabla pasó a `rls: "admin-only"`— dentro de la transacción que aplica las declaradas. El dry run lista cada una bajo "Planned row-level security changes", y el push las controla de la misma manera que a una columna eliminada (solicita confirmación en una terminal, y en otros entornos requiere `--allow-destructive`): eliminar una política altera quién puede leer y escribir las filas, y eliminar una política `RESTRICTIVE` amplía el acceso. Una tabla que `backend/schema` no declare, así como el esquema `rebase`, nunca se tocan
- Deja intacta cada
  restricción CHECK y EXCLUDE en una tabla declarada. Como una tabla
  no puede declarar ninguna de las dos, se consideran reglas propias de la base de datos, escritas manualmente
  o heredadas por una base de datos adoptada mediante `schema introspect`; para quitar una, elimínala
  manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Los triggers y funciones escritos por ti tampoco se modifican
- Coincide con
  el nombre exacto de todo lo que deja intacto, incluyendo caracteres como
  `.`, `[`, `]` o `*`
- Construye cualquier
  [índice de clave foránea que Rebase derive](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  que le falte a una tabla existente **antes** de la planificación, utilizando
  `CREATE INDEX CONCURRENTLY`, permitiendo que las escrituras en la tabla continúen durante la construcción;
  Atlas luego lo encuentra ya presente. `--dry-run` los lista y no construye nada
- Aplica una marca temporal/sello a las
  políticas que aplica de la misma forma en que lo hace el arranque del servidor, evitando que el primer arranque posterior a un
  push las recree por completo
- `--dry-run`
  lista la seguridad a nivel de fila que el push modificaría, bajo "Planned
  row-level security changes": las tablas en las que activa RLS y cada
  política que crea, reemplaza o elimina, calculadas tal como lo deciden
  los pasos del propio push. Muestra "No changes" únicamente cuando ni el esquema ni
  la seguridad a nivel de fila cambiarían. Si el sello de una política no coincide con su
  regla, o si carece de él (una creada por `db migrate` o escrita a mano), el dry run
  la recrea a partir de su regla bajo otro nombre dentro de una transacción a la que luego hace
  rollback, y compara lo que Postgres almacenó: si resulta idéntica, se considera
  sin cambios. Por lo tanto, una regla que `schema introspect` recuperó como SQL no planifica nada, y
  tampoco lo hacen las políticas aplicadas por `db migrate`. Solo se listan por separado aquellas que no pudo comparar (por ejemplo, si el bloqueo
  de su tabla no se otorgó en dos segundos). El push
  en sí imprime una sola línea resumiendo la cantidad de cambios
- Informa cuando se está ejecutando un `rebase dev` sobre la misma base de datos: este aplica nuevas tablas y columnas al guardar, por lo que "No changes" puede significar que ya han sido aplicadas
- Muestra una sola vez cada
  instrucción que Atlas aplica. Atlas se conecta sin SSL a bases de datos en esta
  máquina (`localhost`, `127.x`, `::1`) cuya URL no especifique `sslmode`, al igual que
  la aplicación, en lugar de fallar con `SSL is not enabled on the server`; una URL que
  especifique `sslmode`, u otro host, se transfiere tal cual está escrita. Una ejecución de Atlas
  que falle antes de planificar no deja ninguna base de datos `<db>_dev_diff` residual
- `--dry-run`
  no escribe nada del proyecto: `src/schema.generated.ts` permanece intacto,
  y las copias en `drizzle/*.sql` confirmadas por una versión anterior se mencionan pero no
  se eliminan. Solo la entrada del plan se envía a `.rebase/sql/`, la cual no se incluye en el control de versiones
- **No** genera archivos de migración

**Cuánto tarda.** Casi la totalidad del tiempo de un push corresponde al cálculo del plan por parte de Atlas:
este construye el esquema deseado en una base de datos temporal y calcula las diferencias con respecto a la
real, y ese coste aumenta más rápido que la cantidad de tablas —en un equipo portátil sin carga pesada,
toma unos 0,25 s por plan con 11 tablas, 0,9 s con 111 y 5,5 s con 411. Un push que
no introduce cambios planifica una sola vez; uno que modifica algo planifica dos veces (el dry run
que lee el control de cambios destructivos, y luego la aplicación). En consecuencia, un push sobre un esquema de
400 o más tablas puede tardar decenas de segundos, e incluso más en máquinas ocupadas o lentas.
Ese tiempo pertenece a Atlas, no a tu base de datos: los pasos auxiliares —generar el
SQL, el bloqueo de RLS, la búsqueda, los triggers, las políticas y el rol— toman solo unos pocos segundos en
esa escala, sobre una única conexión a tu base de datos.

**Los archivos generados en el proceso**, todos ubicados en `.rebase/sql/` dentro del directorio
del backend. `db push` y `db generate` escriben los cinco a partir de tus tablas en
cada ejecución, antes de leer cualquiera de ellos, por lo que una copia confirmada en git no sería
leída por nada. El directorio incluye su propio `.gitignore` y nunca se incluye en el control de versiones.

| Archivo | Contiene |
|---------|----------|
| `schema.sql` | Tablas, columnas, restricciones e índices: el estado deseado por Atlas y el único sobre el cual calcula diferencias |
| `policies.sql` | Las políticas RLS a las que compila el `rls` de tus tablas |
| `search.sql` | Las funciones de búsqueda de texto completo y columnas generadas, para tablas con un bloque `search` |
| `vector.sql` | Extensiones de pgvector e índices ANN |
| `triggers.sql` | `rebase.set_updated_at()` y los triggers `BEFORE UPDATE` detrás de `.onUpdateNow()` |

Atlas solo gestiona el primero, por lo que `db push` y la verificación del esquema en tiempo de arranque
aplican los otros cuatro por su cuenta. Un despliegue basado **exclusivamente en migraciones** —uno
que ejecute `db migrate` y nunca `db push`— debe incorporar esos cuatro elementos en una
migración manualmente; `db generate` lo notificará cuando un cambio sea invisible para Atlas.

Un proyecto que haya confirmado estos archivos en `drizzle/` bajo una versión previa verá esas
copias eliminadas en su primera ejecución, y el comando detallará cada una para que puedas
confirmar la eliminación en git. Solo elimina archivos que comiencen con el encabezado
del generador. Los archivos escritos manualmente se conservan, al igual que `drizzle/migrations/`.

:::note[Editar una regla de seguridad renombra su política]
Una regla sin un `name` explícito compila a `<table>_<op>_<hash>`, donde el hash representa la semántica de la regla; por lo tanto, *editar* una regla (en lugar de añadir una nueva) genera una política bajo un nuevo nombre y deja la anterior intacta.

Esto solía ser un problema crítico: Postgres combina políticas `PERMISSIVE` con el operador OR, por lo que una política sustituida con `USING (rebase.uid() IS NOT NULL)` continuaba concediendo acceso total sin importar cuán estricta fuera su reemplazo. Restringir una regla no tenía efecto y el push reportaba éxito.

`db push` ahora soluciona esto: elimina las políticas generadas que ya no coincidan con ninguna regla y reporta —sin eliminar— cualquier política con nombre personalizado que tus tablas no describan, ya que no se pueden distinguir de SQL escrito deliberadamente por alguien.

Para auditar una base de datos sobre la que se aplicó push antes de esta mejora, ejecuta `rebase doctor --policies`. Funciona como control en CI: finaliza con código de error si hay desviaciones (drift), y también cuando no puede ejecutar la comprobación —sin `DATABASE_URL`, con una ruta `--schema-dir` que no resuelve o sin permisos para leer `pg_policies` con el rol de CI. Un control que no pudo ejecutarse se considera no superado.

`doctor` y `db push` distinguen los dos tipos de políticas huérfanas. Una política con nombre generado ha sido sustituida y el siguiente push la eliminará. Cualquier otro nombre fue escrito manualmente o por otra herramienta y permanece vigente: descríbela en el `rls` de su tabla para conservarla (la vista RLS de Studio la importa) o elimínala con `rebase db push --prune-policies` si está obsoleta.
:::

:::caution
`db push` modifica la base de datos directamente. Utilízalo únicamente en entornos de desarrollo. Para producción, usa `db generate` + `db migrate` para crear archivos de migración auditables.
:::

### `rebase db generate`

Genera archivos de migración SQL a partir de los cambios en el esquema:

```bash
rebase db generate
```

**Qué hace:**
- Compara el esquema de Drizzle contra el estado construido por las migraciones en `drizzle/migrations/`, no contra tu base de datos
- Genera archivos de migración SQL con marca de tiempo en `backend/drizzle/migrations/`
- Los archivos pueden revisarse, editarse y confirmarse en el control de versiones
- Identifica cada
  instrucción en la nueva migración que destruya datos, utilizando la misma verificación que `db push`
  ejecuta antes de aplicar: una tabla, columna, esquema, vista o tipo eliminado,
  un `TRUNCATE`, un cambio de tipo de columna que pueda perder valores, un cambio de
  clave primaria o la eliminación de una restricción CHECK o EXCLUDE presente en la base de datos. Aun
  así escribe el archivo y finaliza con código 0, por lo que emite una advertencia sin rechazar la operación.
- Concluye indicando los pasos a
  seguir: `rebase db migrate`, y para la primera migración de un proyecto, la opción
  `--baseline <version>` que requiere una base de datos ya inicializada por el arranque. Una
  migración posterior no incluye la sugerencia de baseline, ya que aplicar baseline a una destructiva omitiría
  su `DROP`; una ejecución que no genere migraciones se limitará a indicar ese hecho.

**Un CHECK agregado por una migración propia será eliminado por la siguiente.** `db generate`
compara tus archivos de migración, no la base de datos, y Atlas no tiene forma de omitir un
objeto de esa comparación. Por lo tanto, una restricción CHECK o EXCLUDE que hayas escrito manualmente
en una migración, y que ninguna tabla pueda declarar, reaparece como
`ALTER TABLE … DROP CONSTRAINT …` en la siguiente migración generada, integrada en
la misma instrucción que el cambio real. El reporte anterior señala esa eliminación cuando
la base de datos ya contiene la restricción; no la retira del
archivo. Elimina la cláusula antes de ejecutar `rebase db migrate`, o permite que
`rebase db migrate --refuse-destructive` se detenga ante ella. `db push` lee la
base de datos y conserva la restricción.

Las migraciones generadas son archivos SQL estándar: puedes inspeccionarlas y modificarlas antes de aplicarlas.

### `rebase db migrate`

Aplica todas las migraciones pendientes:

```bash
rebase db migrate
```

**Qué hace:**
- Lee `drizzle/migrations/` en busca de migraciones no aplicadas
- Las aplica en orden a la base de datos
- Hace un seguimiento de las migraciones que han sido aplicadas
- Aplica un sello a las
  políticas de seguridad a nivel de fila de la misma manera que lo hacen `db push` y el arranque del servidor,
  de modo que el primer arranque posterior a una migración las conserve sin recrear cada
  una. Una migración fue escrita a partir de las tablas de su época, por lo que una política solo
  se sella cuando coincide exactamente con lo que su regla genera actualmente: migrate la recrea
  a partir de su regla bajo otro nombre, en una transacción a la que hace rollback, y
  compara lo almacenado en Postgres, tal como hace `db push --dry-run`. Una política que
  difiera no recibe sello, y el siguiente arranque reaplicará su tabla

`--refuse-destructive`
hace que la operación sea rechazada en su lugar. Ejecuta primero un simulacro de las migraciones pendientes. Si alguna
instrucción destruye datos, según la misma verificación que utilizan `db push` y `db generate`,
lista dichas instrucciones y finaliza con código 1. No aplica nada, ni siquiera los archivos
previos a esa instrucción. Sin este flag, `db migrate` se comporta como siempre y
aplica cada archivo pendiente:

```bash
rebase db migrate --refuse-destructive
```

Una migración que reconstruye una columna de búsqueda la elimina primero, por lo que este flag también
rechazará esa migración. Revisa la lista que imprime y luego ejecuta `rebase db migrate`
sin el flag para aplicarla.

#### Establecer una línea base (baseline) en una base de datos que Rebase ya ha arrancado

Cada arranque de Rebase asegura la estructura del esquema y `rebase db push` la aplica directamente. Por lo tanto, una base de datos que haya ejecutado cualquiera de los dos ya contiene las tablas y tipos que la primera migración crearía, provocando que `rebase db migrate` se detenga con `pq: type "posts_status" already exists (42710)`.

No hay ningún problema con la migración: la base de datos simplemente fue aprovisionada por otra vía. Registra el punto en el que se encuentra y luego migra con normalidad:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versión corresponde al prefijo numérico del archivo de migración que describe lo que existe en la base de datos *actualmente*. Esa migración y todas las anteriores se registrarán como aplicadas; las posteriores se ejecutarán. En una base de datos sobre la que nunca se haya arrancado nada, no es necesario establecer una línea base: ejecuta migrate directamente.

Lo mismo sucede más adelante en el flujo habitual: editas una tabla mientras `rebase dev` está en ejecución y el arranque añade la columna antes de que `rebase db generate` escriba la migración que la añade, por lo que `rebase db migrate` se detiene con `column … already exists (42701)`. Aplica baseline a esa migración de la misma manera. `--baseline` funciona en bases de datos que ya tienen un historial de migraciones: marca todo hasta la versión especificada como aplicado mediante `atlas migrate set` y lo notifica, o indica que no hay nada que registrar si el historial ya la alcanza. Una versión que no exista en ningún archivo de `drizzle/migrations` será rechazada antes de ejecutar nada, listando las versiones disponibles.

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

`rebase db branch switch` (junto con `switch --off`) y `rebase db branch prune`
son nuevos. `create`, `list`, `info` y `delete` se incorporaron en la versión 0.17.

Cada rama es una copia completa de la base de datos creada mediante `CREATE DATABASE ... TEMPLATE`,
por lo que requiere un servidor PostgreSQL real y ocupa el mismo espacio en disco que su origen.

### `rebase doctor`

Detecta discrepancias a tres bandas entre tus tablas, el esquema de Drizzle generado y la base de datos PostgreSQL activa:

```bash
rebase doctor
```

**Qué comprueba:**
- Tablas ↔ Esquema generado: ¿están sincronizados?
- Esquema generado ↔ Base de datos: ¿hay cambios no aplicados?
- Tablas ↔ Base de datos: ¿existe alguna discrepancia imprevista?

Ejecuta `doctor` siempre que sientas que algo está desincronizado. Localiza con precisión matemática dónde reside la discrepancia.

La comparación de la base de datos incluye la misma verificación que el arranque realiza antes de advertir que `schema.generated.ts` y la base de datos no coinciden, procesada mediante el mismo código. En consecuencia, cada diferencia sobre la que advierte el arranque también aparece en este informe, expresada en los mismos términos: una columna NOT NULL en un extremo y anulable en el otro, o una columna que la base de datos aún conserva pero que el archivo ya no tiene (el arranque nunca elimina columnas, por lo que una propiedad renombrada deja su columna anterior rezagada). Cada caso es una advertencia, y la solución propuesta indica `rebase db push`.

La comparación de la base de datos examina la base de datos del proyecto, resuelta de la misma forma que lo hace `rebase db url` —en un scaffold nuevo, la administrada, la cual `doctor` inicia. Si no se puede resolver ninguna, esa fase se reporta como **omitida** (skipped) en lugar de exitosa, y la ejecución nunca concluye con "All schemas are in sync": una comprobación que no se realizó no equivale a un visto bueno.

También señala cada tabla que carezca de un [bloque `search`](/docs/backend/search) y que contenga más de aproximadamente 10.000 filas. Una búsqueda en ese escenario —el cuadro de búsqueda del admin, `.search()`, `?searchString=`— se traduce en un `ILIKE '%term%'` sobre las columnas de texto que ningún índice puede optimizar, obligando a escanear la tabla completa en cada consulta, y nuevamente para su conteo (alrededor de un tercio de segundo con 100.000 filas, aumentando con el tamaño de la tabla). La cantidad de filas es una estimación propia de Postgres, por lo que la comprobación no realiza lecturas de datos. Se trata de una sugerencia: no altera el código de salida ni crea índices automáticamente.

Advierte sobre **uniones huérfanas** (orphaned junctions): tablas en `public` estructuradas como una unión many-to-many que ninguna tabla declara. La estructura consiste en dos columnas que juntas forman la clave primaria, siendo cada una clave foránea hacia una tabla declarada. Renombrar o quitar un `manyToMany` deja su tabla de unión anterior rezagada, ya que push y el arranque solo crean tablas, y todas las filas de enlace permanecen en ella. Esta nota es meramente informativa, por lo que no altera el código de salida. Su resolución consiste en la instrucción `DROP TABLE`, la cual `doctor` muestra pero nunca ejecuta.

### `rebase generate-sdk`

Genera un SDK tipado a partir de tus tablas:

```bash
rebase generate-sdk
```

**Qué hace:**
- Lee las tablas que exporta `backend/schema/index.ts`, a través del loader con el que arranca el backend, asegurando que el SDK describa exactamente las tablas servidas; un esquema que no compile detiene la ejecución
- Genera tipos de TypeScript para cada tabla en `generated/sdk/`
- Crea un archivo `database.types.ts` para usar con `createRebaseClient<Database>()`: el tipo `Database`, `TableName` (la unión de cada slug) y `tablesDictionary` / `TablesDictionary`, el mapeo de descriptor de acceso (accessor) a slug

`rebase dev` ejecuta esto por ti al iniciar y con cada guardado dentro de
`backend/schema/`. Ejecútalo manualmente en CI, en repositorios que no posean
tablas propias (ver `--from` abajo), o en cualquier entorno donde `rebase dev` no esté en ejecución.

**Opciones:**

| Flag | Descripción |
|------|-------------|
| `--schema-dir` | El directorio del esquema (por defecto: `backend/schema`, o la clave `tables` en `rebase.json`); las rutas relativas se resuelven desde donde ejecutas el comando |
| `-o`, `--output` | Directorio de salida para el SDK (por defecto: `generated/sdk/`) |
| `--from <link\|url>` | Lee el esquema desde un proyecto en ejecución en lugar del código fuente local. `link` utiliza el proyecto vinculado a esta copia de trabajo. |
| `--token` | Token Bearer para el endpoint de contrato (por defecto: `$REBASE_SERVICE_KEY` del shell; no lee `.env`) |
| `--register` | También tipa los datos del lado del servidor: escribe los tipos y una declaración `Register` en `backend/generated/`, y lo guarda en `rebase.json` — consulta [Datos tipados en el servidor](/docs/backend/typed-server-data/) |

`--from` permite que un repositorio sin tablas locales —un frontend independiente, una segunda aplicación web, una aplicación móvil— genere un cliente tipado a partir del proyecto con el que interactúa: lee las `tables` del `/api/meta/contract` del backend en ejecución. `REBASE_SERVICE_KEY` solo se envía al proyecto vinculado a esta copia local; pasa `--token` explícitamente para cualquier otro host. La clave en `.env` pertenece a tu backend local y nunca se envía al exterior.
Cualquier rechazo indicará cuál fue la causa: un `--token` denegado, una clave de shell rechazada, una clave no enviada a un host no vinculado, una clave presente únicamente en `.env` o la ausencia total de clave.

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

Los nombres de campo en los tipos generados son los que sirve la API. El nombre en tránsito de un campo es la clave de su columna, y la API utiliza camelCase en todo momento: la introspección escribe una columna `created_at` como `createdAt: col.timestamp({ withTimezone: true })`, cuyo nombre SQL es el snake_case de la clave, y la sirve como `row.createdAt`. La columna en la base de datos permanece intacta. El *accessor* de la tabla se transforma en un nombre de propiedad de la misma manera (`my-notes` → `client.data.myNotes`), que es lo que `tablesDictionary` mapea de vuelta al slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` traslada `config/collections` a
`backend/schema` (un `defineTable` por colección, con cada columna explícita en
su posición original bajo la nomenclatura de Drizzle, e `index.ts` con
`defaultRls`) y a `frontend/src/cms` (un `customizeTable` por colección personalizada,
archivos `defineFirestoreCollection`, `ui-config.json`), escribe
`backend/resources.ts`, `backend/storage.ts` y `backend/generated/register.ts`,
añade `rebaseBackendGuard()` al `vite.config.ts` del scaffold, y luego ejecuta
`rebase migrate sdk-calls`, que renombra `.collection(` a `.table(`, aplica los
demás cambios de nombre del SDK y las fuentes de reglas `existsIn` / `membership` en tu código,
y traslada las importaciones de elementos que la versión 0.31 movió a otro paquete
([el listado](/docs/upgrading/0-30-to-0-31-imports/)), añadiendo el paquete a las
dependencias del importador ("Dependencies added": ejecuta `pnpm install`). Actualiza todos los paquetes `@rebasepro` a la versión 0.31 antes de ejecutarlo.
Cada ejecución vuelve a validar el resultado: el SQL generado —DDL, políticas, búsqueda,
vectores, triggers, vistas, el esquema de Drizzle— debe ser idéntico byte por byte, o de
lo contrario se restauran todos los archivos. Lo que no pueda transferirse se rechazará indicando archivo y línea, y
lo que requiera intervención manual se mostrará en pasos numerados, terminando con
`rebase skills install` si el proyecto contiene agent skills. Tus propios módulos en
`config/` se conservan; la ejecución imprime la línea `git rm` para lo que fue reemplazado. También
rastrea colecciones de Firestore construidas mediante funciones, alias de rutas, paneles montados
fuera de `App.tsx` y cualquier aplicación estática no protegida ([la lista completa](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Tras ejecutar el `git rm`, `--check` reportará `already-migrated`.

| Flag | Efecto |
|---|---|
| `--dry-run` | Muestra archivos, rechazos, notas y pasos manuales; no escribe nada. Comienza por aquí. |
| `--check` | En proyectos ya migrados: valida que `backend/schema` siga produciendo el mismo SQL. Sale con código 1 mostrando el diff si una regla cambia de significado. |
| `--accept-rule-changes` | Junto con `--check`: confirma que se revisaron las reglas bajo "Review before deploying". |
| `--json` / `--force` / `--skip-sdk-calls` | Reporte en JSON (con `ruleChanges`); permite ejecutar en un árbol de trabajo sucio o sobre salidas modificadas; no altera tu código. |

Revisa dos listas en la salida del SDK: **"Rewritten by name — review"** (receptores no tipados, slots de datos, test doubles) y **"Left unchanged — check each"** (renombra aquellos que correspondan al SDK; [una búsqueda](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) localiza el resto).

La comprobación de SQL demuestra que la conversión es fiel, pero no garantiza que una regla mantenga exactamente su efecto previo. La última sección de la salida, **"Review before deploying: these rules change meaning"**, lista cada regla cuya directiva concede ahora algo distinto —un simple `access: "authenticated"` no concedía nada y ahora admite a cualquier usuario autenticado ([los cuatro casos](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
A continuación, verifica contra tu base de datos: `rebase db push --dry-run` debería imprimir "No changes: the database already matches these tables.", y `rebase doctor --policies` no debería mostrar discrepancias.

## Flujo de trabajo en desarrollo

El flujo de iteración rápida para desarrollo:

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
| `db push` falla en producción | Utiliza `db generate` + `db migrate` en su lugar |
| Una migración no debe eliminar datos en CI ni en producción | `rebase db migrate --refuse-destructive` sale con código 1 y no aplica nada cuando una instrucción pendiente destruye datos |
| `db migrate` falla con `already exists (42710)` | El arranque o `db push` ya aprovisionaron el esquema; regístralo con `rebase db migrate --baseline <version>` |
| `db migrate` falla con `column … already exists (42701)` | `rebase dev` añadió la columna durante el arranque; establece la línea base para esa migración de la misma manera |
| `db push` falla en la base de datos administrada con `Error: EOF` | Atlas perdió una conexión que el proceso activo de `rebase dev` mantiene retenida. Ejecútalo de nuevo; si continúa fallando, detén `rebase dev` primero |

## Próximos pasos

- **[Tablas](/docs/schema/)** — Define tu modelo de datos
- **[Referencia del CLI](/docs/cli)** — Todos los comandos del CLI
- **[SDK tipado](/docs/sdk)** — Utiliza el SDK generado
