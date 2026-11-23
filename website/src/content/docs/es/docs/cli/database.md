---
sourceHash: 68cf15088ac8b29f
title: Comandos de Base de Datos
sidebar_label: Comandos de Base de Datos
description: Los comandos rebase db — push, generate y migrate, copias de seguridad y restauraciones, obtención de copias, la cadena de conexión, la base de datos de desarrollo administrada y ramas.
---

## Descripción general

`rebase db` es la familia de comandos que interactúan con la base de datos del
proyecto. Cada uno trabaja sobre la base de datos que resuelve el proyecto, en
el orden que enumera [Database Branching](/docs/backend/branching/#cli-integration):
`--database-url`, luego `DATABASE_URL` en la terminal, la rama a la que está
cambiado el checkout, `DATABASE_URL` en `.env`, `--docker`, y de lo contrario la
base de datos de desarrollo administrada que inicia `rebase dev`. `rebase db url`
imprime cuál es.

`request-role` y `provision` son para una base de datos de la que Rebase no es el
propietario absoluto; consulte [Running on an existing or shared database](/docs/deployment/existing-database/).
`push`, `generate` y `migrate` se describen en detalle en
[Schema Generation](/docs/cli/schema/), y todos los demás comandos se encuentran en la
[CLI reference](/docs/cli/).

## Comandos

### `rebase db push`

Envía los cambios de esquema directamente a la base de datos (solo en desarrollo):

```bash
rebase db push
```

`--database-url <url>` especifica la base de datos, y `--docker` la de compose, iniciada
si es necesario. `generate`, `migrate`, `branch`, `backup` y `restore` también admiten ambas opciones.

Deja intacto lo que las declaraciones de sus tablas no describen: otras tablas y
vistas, los índices que haya creado y las restricciones CHECK y EXCLUDE en una tabla
declarada, las cuales una declaración no puede expresar. Consulte
[`rebase db push`](/docs/cli/schema/#rebase-db-push) para conocer qué aplica y
ante qué se detiene.

El SQL que una declaración de tabla no puede expresar (funciones, disparadores,
restricciones CHECK, permisos) se ubica en `backend/sql/*.sql`. El comando push aplica
estos archivos por orden de nombre, después de las tablas y vistas y antes de las
políticas, de modo que una política pueda llamar a una función que defina un archivo.
Cada archivo se registra por nombre y hash en `rebase.sql_files` y se vuelve a ejecutar
solo cuando cambia, dentro de su propia transacción: si un archivo falla, se revierte y
detiene el push. Escriba archivos que sean seguros de volver a ejecutar (`CREATE OR REPLACE FUNCTION`,
`DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER`). Un archivo cuyo nombre comience
con `_` es un borrador y no se aplica. Eliminar un archivo no deshace nada de lo que
haya hecho. `--dry-run` lista los archivos que aplicaría.

Un despliegue aplica los mismos archivos: `rebase build` los incluye en el bundle, y
el arranque del servidor ejecuta cada archivo nuevo o modificado después de las tablas
y la autenticación y antes de las políticas, registrado en el mismo `rebase.sql_files`.
La transacción de cada archivo adquiere primero un bloqueo consultivo (advisory lock),
de modo que varias instancias que se inicien juntas, o un push durante un despliegue,
ejecuten cada archivo una sola vez. Un archivo puede ejecutarse hasta por 15 minutos. Un
archivo que falla detiene el arranque y muestra el nombre del archivo. `rebase dev`
también los aplica al arrancar. Una aplicación que compila su propio backend especifica
el directorio con `createPostgresAdapter({ sqlDir: "backend/sql" })`. No se aplica nada
con `REBASE_PROVISION=false` o `REBASE_MIGRATE_ON_BOOT=none`.

:::caution
`db push` modifica la base de datos directamente sin archivos de migración. Use `db generate` + `db migrate` para producción.
:::

### `rebase db generate`

Genera archivos de migración SQL a partir de cambios en el esquema:

```bash
rebase db generate
```

Crea archivos de migración con marca de tiempo en `backend/drizzle/migrations/` que se pueden revisar y confirmar (commit).

### `rebase db migrate`

Ejecuta las migraciones pendientes de la base de datos:

```bash
rebase db migrate
```

Aplica todas las migraciones no aplicadas a la base de datos.

En una base de datos que ya ha arrancado, la primera migración crea tablas que
el arranque ya creó, por lo que el primer `db migrate` allí se detiene antes de
ejecutar nada e imprime la línea base (baseline) a ejecutar. En su lugar, registre
esa migración como aplicada, una sola vez:

```bash
rebase db migrate --baseline <version>
```

La versión es el prefijo numérico del archivo de migración; `db generate` imprime el
comando con dicho valor completado. Consulte
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) para una base de datos que ya
registra migraciones.

Después de eso, `db migrate` aplica lo que el arranque no ha aplicado, y en una base
de datos servida por `rebase dev` eso es menos de lo que parece. El arranque añade cada
nueva tabla, columna y valor de enumeración tan pronto como cambia la declaración de una
tabla, por lo que para el momento en que `db generate` escribe la migración que añade una
columna, la columna ya está allí: ese `db migrate` se detiene nuevamente en `already exists`
y muestra el `--baseline <version>` que la registra. Cada nueva propiedad implica otra
línea base. Registre una migración solo cuando el arranque haya realizado todos los cambios
presentes en ella. Una que también elimine, renombre o restrinja algo contiene sentencias
que el arranque nunca ejecuta, y registrarla las omitirá. En desarrollo, `rebase db push`
es el comando que modifica el esquema; reserve `db generate` y `db migrate` para una base
de datos que el arranque aún no haya modificado.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` ejecuta `pg_dump`; `restore` ejecuta `pg_restore` y, al ser destructivo,
solicita escribir `yes` en una terminal, o acepta `--yes`; sin terminal y sin
`--yes` se rechaza e indica que debe proporcionarse.
En una base de datos que ya contiene lo que la copia de seguridad crea, `restore`
requiere `--clean`. Sin él, se rechaza antes de que se aplique nada, incluidos los
roles del clúster, y nombra los objetos que interfieren y ambas formas de resolverlo:
`--clean` o `--create-db --target-db <new name>`.
Con `--clean`, la restauración es una sola transacción: elimina los esquemas de la
copia de seguridad con todo lo que contienen, restaura y solo confirma (commit) una
vez que toda la restauración se ha completado con éxito, por lo que un fallo deja la
base de datos tal como estaba. Antes de preguntar, enumera lo que eliminará que no
esté contenido en la copia de seguridad. Ejecuta `psql`, que se distribuye junto con
`pg_restore`.
`restore` rechaza la base de datos de desarrollo administrada: una copia de seguridad
transporta sus filas como datos COPY, que esta no puede recibir.
Restaure en Postgres en Docker (`rebase db restore <dump> --docker --clean --yes`),
y luego `rebase db pull --from "$(rebase db url --docker)" --yes` la copiará en la
base de datos administrada. Una copia de seguridad de la base de datos administrada la
deja tal como estaba.
Las rutas relativas, y la predeterminada `./backups`, se resuelven respecto al
directorio desde el que ejecuta `rebase`, por lo que las tres líneas anteriores confluyen
en un solo directorio; cualquier opción que un comando no admita se rechaza antes de
que se ejecute nada.
El volcado y su archivo de roles son legibles únicamente por usted (0600), y
frente a una base de datos que no se esté ejecutando, `backup` y `restore` muestran
el mismo mensaje que `db push`.
La programación, el archivo de roles que acompaña a cada volcado y el procedimiento de restauración se detallan en [Backups and restore](/docs/deployment/backups/).

### `rebase db pull`

Copia otra base de datos en la de desarrollo local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` acepta una URL `postgres://` o `postgresql://`, o los pares
`host=… port=… dbname=…` de libpq entrecomillados como un solo argumento. Cualquier
otra cosa se rechaza antes de leer o iniciar nada, sin repetir el valor.

`--anonymize` reemplaza campos personales durante la importación, de modo que se pueda
trabajar localmente con una copia de producción sin transferir datos reales de clientes
a una laptop. Coincide columnas por nombre y funciona bajo el principio de mejor esfuerzo.
Una columna `name` simple se reemplaza solo en una tabla de personas: una llamada `users`,
`authors`, `customers` o similar, o cualquier tabla que también contenga una columna de
dirección de correo electrónico.
Una columna bajo un índice único recibe un valor distinto por fila, y el proceso es una
sola transacción: si falla, las tablas que habría reescrito se vacían y se enumeran, y
el comando finaliza con código de salida 1.

Un indicador (flag) que `pull` no admita se rechaza antes de leer o copiar nada,
indicando el que probablemente se pretendía usar: `--anonymise` responde "¿quiso decir
--anonymize?" y finaliza con código 1.
En `pull` y en cualquier otro comando, un modificador al que se le asigne un valor lo
interpreta: `--anonymize=true` o `=1` lo activa, `--anonymize=false` o `=0` lo desactiva,
y cualquier otro valor se rechaza.

`pg_dump` elimina los privilegios, por lo que la copia llegaría con las políticas RLS
de origen y ninguna de las concesiones de permisos (grants) asociadas, provocando que
cada lectura como `rebase_user` falle con `permission denied`. La extracción reprovisiona
el rol de la aplicación posteriormente, utilizando la misma rutina que emplean el arranque
y `rebase db push`, manteniendo revocadas las tablas internas de Rebase como corresponde.

El destino es siempre la base de datos de desarrollo local de este proyecto y no se
puede elegir: `--database-url` se rechaza en lugar de aceptarse, por lo que no hay forma
de indicar "extraer hacia producción". `--from` es la única dirección permitida.

Un pull reemplaza el contenido de la base de datos local: primero vacía cada esquema
que copia, por lo que una tabla que solo exista localmente no sobrevivirá. En la base
de datos de desarrollo administrada, las filas se transfieren como sentencias `INSERT`,
las cuales acepta allí donde `COPY` se detendría. Solo admite volcados en UTF8: un pull
desde una base de datos con otra codificación, como LATIN1, se rechaza antes de vaciar
nada. Extraiga esa hacia Postgres en Docker (`rebase db pull --docker` con el mismo `--from`),
o hacia un Postgres especificado por `DATABASE_URL`.

### `rebase db url`

Imprime la cadena de conexión que este proyecto está usando, y nada más, para
que pueda canalizarse por tubería (pipe):

```bash
rebase db url
psql "$(rebase db url)"
```

La base de datos de desarrollo administrada es el caso que necesita esto: `.env` deja
`DATABASE_URL` comentado a propósito, y el puerto se deriva de la ruta del proyecto,
por lo que nada en el disco lo especifica.
Mantiene ese puerto a través de detenciones e inicios, a menos que otro proceso lo
haya ocupado. Cuando haya definido un `DATABASE_URL` propio, eso es lo que imprime;
el orden de resolución es el mismo que siguen todos los demás comandos. Inicia la base
de datos administrada si aún no se está ejecutando.

Después de `rebase dev --docker`, `db url` y los demás comandos usan esa base de datos
de Docker (e informan de ello en stderr) hasta que se ejecute un `rebase dev` sin el flag.
La preferencia se guarda en `.rebase/dev-database.json` y tiene la misma prioridad que
`--docker`, por debajo de cualquier cadena de conexión. Si escribe `--docker` pero una
cadena de conexión tiene mayor prioridad, no se inicia ningún contenedor: una línea en
stderr indica que fue ignorado, nombra la opción predominante e indica cómo acceder a
Docker en su lugar. Un `rebase dev --docker` superado en prioridad de este modo mantiene
la preferencia recordada tal como estaba, de modo que cuando la cadena de conexión ya
no esté presente, los comandos volverán a seguir a Docker.

`rebase init` asigna a cada proyecto su propio puerto de compose, entre 5433 y 5632 según
la ruta del proyecto, y `--docker` verifica que lo que responda en él sea el contenedor
`db` de este proyecto. Cuando otro contenedor o un Postgres fuera de Docker ocupa el
puerto, se detiene y muestra el nombre en lugar de iniciar sesión en la base de datos de
otro. Para mover el proyecto, cambie el puerto del host del servicio `db` en
`docker-compose.yml`, y `DATABASE_URL` si está configurado en `.env`.

### `rebase db stop` / `rebase db reset`

Solo para la base de datos de desarrollo administrada:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Pertenece al proyecto, no al comando que la inició, por lo que detener `rebase dev`
la deja ejecutándose para los demás comandos. Después de 30 minutos sin conexiones,
se detiene automáticamente, y el siguiente comando que la necesite la iniciará de
nuevo. `rebase dev` lo informa al detenerse, indicando cómo detener la base de datos
de inmediato.

Ejecutar `db stop` mientras `rebase dev` está en ejecución advierte que su backend no
puede comunicarse con la base de datos hasta que vuelva a estar disponible. El siguiente
comando que la necesite (por ejemplo, `rebase db url`) la iniciará en el mismo puerto,
y el backend se reconectará sin necesidad de reiniciarse.

### `rebase db request-role migrate`

Migra las solicitudes de esta base de datos de un rol de Postgres a otro:

```bash
rebase db request-role migrate --to <role[,role]> [--dry-run] [--yes]
```

Las solicitudes se ejecutan como `rebase_user` a menos que el proyecto especifique
otro rol (`REBASE_RLS_REQUEST_ROLE` o `rls.requestRole`). Un rol pertenece a todo el
clúster, por lo que los proyectos que compartan uno deberían tener cada uno el suyo.
El primer arranque de aprovisionamiento registra el rol en la base de datos, y un
arranque posterior configurado con otro rol se negará a iniciar hasta que la base de
datos sea migrada.

El comando migra desde el rol registrado en la base de datos, o `rebase_user`. En una
sola transacción, crea el nuevo rol si no existe, permite que la conexión cambie a él,
vuelve a otorgar únicamente en esta base de datos cada permiso que poseía el rol anterior,
redirige las políticas que lo nombran y registra el nuevo rol. El rol anterior se deja
tal cual, ya que otra base de datos del clúster podría estar usándolo. A continuación,
imprime las sentencias `REVOKE` para revocar los permisos del rol antiguo en esta base
de datos, las cuales se pueden ejecutar una vez que nada los necesite.

`--dry-run` imprime las sentencias y los `REVOKE`s sin modificar nada. En una terminal
solicita confirmación previa; sin terminal se rechaza si no se incluye `--yes`. Luego,
configure `REBASE_RLS_REQUEST_ROLE` con el nuevo rol en cada servidor que utilice la
base de datos. Consulte [Running on an existing or shared database](/docs/deployment/existing-database/).

### `rebase db provision --print`

Imprime el SQL que configura el rol o roles de solicitud para esta base de datos, para
que lo ejecute un administrador de bases de datos:

```bash
rebase db provision --print > request-role.sql
```

Para cada rol de solicitud, imprime las sentencias que crean el rol, otorgan al rol de
conexión el derecho de cambiar a él y, bajo la opción predeterminada `grants: "schema"`,
le conceden acceso a los esquemas `public` y `rebase`. Los roles corresponden a
`REBASE_RLS_REQUEST_ROLE` cuando está configurado, o bien a los que un arranque registró
en la base de datos, o en su defecto a `rebase_user`. La explicación está redactada como
comentarios SQL, por lo que la salida puede ejecutarse directamente. Lee el rol de
conexión y no ejecuta nada más. `--print` es obligatorio. Combínelo con
`REBASE_RLS_PROVISION_ROLE=never` cuando los roles sean creados por un DBA o mediante
código de infraestructura.

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch diff <name> [--json] [--sample-limit <n>]
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL no copiará ni eliminará una base de datos a la que haya cualquier otra cosa
conectada, y lo habitual es que esa "otra cosa" sea su propio `rebase dev`. `create` y
`delete` indican qué mantiene abierta la base de datos; `--force` desconecta esas
sesiones primero.

Cada rama es una copia completa en disco, por lo que es necesario limpiarlas. `prune`
elimina tres cosas: una entrada cuya base de datos se eliminó fuera de Rebase, una base
de datos de rama cuya entrada nunca se escribió y —solo con `--older-than`— ramas que
superen la antigüedad especificada. Solicita confirmación antes de eliminar nada a menos
que pase `--yes`. Sin una terminal para preguntar, como en entornos de CI, no elimina
nada, indica que se pase `--yes` y finaliza con código 1.
`list` e `info` son de solo lectura: una base de datos sobre la que no se creó ninguna
rama no tendrá ninguna, y no crean ningún esquema `rebase` allí.

`diff` muestra qué cambió en una rama con respecto a la base de datos a partir de la
cual se creó: tablas, columnas, restricciones, índices, disparadores, políticas RLS,
tipos enum, vistas y funciones añadidas, eliminadas o alteradas, y por tabla las filas
insertadas, actualizadas y eliminadas. Las filas que el elemento principal (parent)
modificó por su cuenta desde entonces se contabilizan por separado, y las filas que
ambos modificaron se consideran conflictos. `--json` imprime el diff completo, con hasta
`--sample-limit` filas por tabla (por defecto 100). Lee ambas bases de datos y no modifica
ninguna; la fusión se realiza en Studio; consulte
[Reviewing and merging a branch](/docs/backend/branching/#reviewing-and-merging-a-branch).

`switch` registra la rama en `.rebase/branch.json` y nunca edita `.env`. Tiene prioridad
sobre `DATABASE_URL` en `.env` y es anulado por `--database-url` o un `DATABASE_URL` en
la terminal, de modo que un flag en la línea de comandos siempre prevalece sobre un
cambio realizado anteriormente. `delete` rechaza eliminar la rama en la que se encuentra
actualmente, ya que cada comando en el checkout, incluida la eliminación, apunta a ella:
use `switch --off` primero, y luego elimínela. Todo el flujo de trabajo se describe en
[Database Branching](/docs/backend/branching/).

#### `rebase db branch merge`

```bash
rebase db branch merge <name> [--on-conflict abort|branch|target] [--skip-blocked] [--yes]
```

Escribe las filas que una rama insertó, actualizó y eliminó en la base de datos a partir de la cual se creó. Imprime el diff primero y solicita confirmación, luego fusiona exactamente ese diff: la fusión especifica la huella digital (fingerprint) del diff, de modo que si el elemento principal cambió desde entonces, se rechaza en lugar de fusionarse. `--on-conflict` decide qué hacer con una fila modificada por ambas partes: `abort` (por defecto) no escribe nada, `branch` toma la fila de la rama, `target` conserva la del elemento principal; y `--skip-blocked` fusiona las tablas posibles y omite el resto. Los cambios de esquema y políticas nunca se fusionan: las migraciones se encargan de ellos. `delete` también solicita confirmación previa, y `--yes` responde afirmativamente a ambos en scripts.

:::note[En la base de datos de desarrollo administrada]
`push`, `generate` y `migrate` funcionan aquí como en cualquier otra base de datos.
`push` y `generate` planifican su trabajo con Atlas, que necesita una segunda base de
datos vacía con la cual comparar, y el PGlite administrado sirve exactamente una. Por lo
tanto, en la base de datos administrada, cada uno de ellos inicia un segundo PGlite
desechable en memoria para Atlas y lo detiene cuando finaliza el comando. Así es como se
elimina, renombra o restringe una columna allí: `rebase dev` solo añade elementos. La
barrera destructiva es la misma que en cualquier otro lugar. Para que Atlas realice la
planificación contra una base de datos vacía propia en su lugar, defina `REBASE_ATLAS_DEV_URL`
apuntando a ella; Rebase no crea ni elimina una base de datos especificada de esa forma.

`branch` se rechaza allí. `CREATE DATABASE ... TEMPLATE` en PGlite escribe una entrada de
catálogo y no copia nada, por lo que la rama resolvería a la base de datos de la que fue
clonada; cada escritura que pretendía aislar terminaría en su base de datos de desarrollo.
`rebase dev --docker` le proporciona un servidor real sobre el cual funcionan las ramas.
:::

## Relacionado

- [CLI reference](/docs/cli/) — todos los demás comandos de `rebase`
- [Schema Generation](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` y `db branch` en detalle
- [Backups and restore](/docs/deployment/backups/) — programación, el archivo de roles, restauración
- [Database Branching](/docs/backend/branching/) — cómo se crea una rama y qué implica
- [Running on an existing or shared database](/docs/deployment/existing-database/) — el rol de solicitud, sus configuraciones y `rebase doctor --database`
- [Scripts and the Console](/docs/backend/scripts/) — la misma base de datos desde un script o una REPL
