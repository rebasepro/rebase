---
sourceHash: 6d4d1426d30011ff
title: Comandos de base de datos
sidebar_label: Comandos de base de datos
description: Los comandos de rebase db — push, generate y migrate, copias de seguridad y restauraciones, extracción de copias, la cadena de conexión, la base de datos de desarrollo administrada y ramas.
---

## Descripción general

`rebase db` es la familia de comandos que interactúan con la base de datos del
proyecto. Cada uno opera sobre la base de datos que el proyecto resuelve, en el
orden indicado en
[Ramificación de bases de datos](/docs/backend/branching/#cli-integration):
`--database-url`, luego `DATABASE_URL` en la terminal, la rama a la que está
cambiado el checkout, `DATABASE_URL` en `.env`, `--docker`, y de lo contrario la
base de datos de desarrollo administrada que inicia `rebase dev`. `rebase db url`
imprime cuál de ellas es.

`request-role` y `provision` son para una base de datos de la que Rebase no es
propietario exclusivo; consulte
[Ejecución en una base de datos existente o compartida](/docs/deployment/existing-database/).
`push`, `generate` y `migrate` se describen en detalle en
[Generación de esquemas](/docs/cli/schema/), y el resto de los comandos se
encuentra en la [Referencia de la CLI](/docs/cli/).

## Comandos

### `rebase db push`

Aplica cambios de esquema directamente en la base de datos (solo desarrollo):

```bash
rebase db push
```

`--database-url <url>` especifica la base de datos, y `--docker` la de compose,
iniciada si es necesario. `generate`, `migrate`, `branch`, `backup` y `restore`
también aceptan ambas.

Deja intacto lo que las declaraciones de sus tablas no describen: otras tablas y
vistas, índices que haya escrito, y las restricciones CHECK y EXCLUDE en una tabla
declarada, las cuales una declaración no puede expresar. Consulte
[`rebase db push`](/docs/cli/schema/#rebase-db-push) para conocer qué aplica y
ante qué se detiene.

:::caution
`db push` modifica la base de datos directamente sin archivos de migración. Use `db generate` + `db migrate` para producción.
:::

### `rebase db generate`

Genera archivos de migración SQL a partir de cambios en el esquema:

```bash
rebase db generate
```

Crea archivos de migración con marca de tiempo en `backend/drizzle/migrations/`
que pueden ser revisados y confirmados en el control de versiones.

### `rebase db migrate`

Ejecuta las migraciones de base de datos pendientes:

```bash
rebase db migrate
```

Aplica todas las migraciones no aplicadas a la base de datos.

En una base de datos que ya se ha iniciado, la primera migración crea tablas que
el arranque (boot) ya creó, por lo que el primer `db migrate` allí se detiene con
`already exists`. En su lugar, registre esa migración como aplicada, una sola vez:

```bash
rebase db migrate --baseline <version>
```

La versión es el prefijo numérico del archivo de migración; `db generate` imprime
el comando completado con ella. Consulte
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) para una base de datos que
ya registra migraciones.

Después de eso, `db migrate` aplica lo que el arranque no haya aplicado, y en una
base de datos servida por `rebase dev` eso es menos de lo que parece. El arranque
añade cada nueva tabla, columna y valor enum en cuanto cambia la declaración de
una tabla, de modo que para el momento en que `db generate` escribe la migración
que añade una columna, la columna ya existe: ese `db migrate` se detiene
nuevamente en `already exists` e indica la opción `--baseline <version>` para
registrarla. Cada nueva propiedad implica otra línea base (baseline). Registre
una migración únicamente cuando el arranque haya realizado todos los cambios
presentes en ella. Una migración que también elimine, renombre o restrinja algo
contiene sentencias que el arranque nunca ejecuta, y registrarla las omitirá. En
desarrollo, `rebase db push` es el comando que modifica el esquema; reserve
`db generate` y `db migrate` para una base de datos que el arranque no haya
modificado previamente.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` ejecuta `pg_dump`; `restore` ejecuta `pg_restore` y, al ser destructivo,
solicita escribir `yes` en la terminal, o acepta `--yes`; sin terminal y sin
`--yes`, la operación se rechaza y solicita proporcionarlo.
En una base de datos que ya contiene lo que la copia de seguridad crea, `restore`
requiere `--clean`. Sin esta opción, se rechaza antes de aplicar nada, incluidos
los roles del clúster, e indica los objetos en conflicto y las dos alternativas
para resolverlo: `--clean`, o `--create-db --target-db <new name>`.
Con `--clean`, la restauración se realiza en una sola transacción: elimina los
esquemas de la copia de seguridad junto con todo su contenido, restaura y
confirma los cambios solo una vez que toda la restauración se haya completado con
éxito, de modo que un fallo deja la base de datos tal como estaba. Antes de
solicitar confirmación, enumera lo que eliminará que no esté incluido en la copia
de seguridad. Ejecuta `psql`, que se incluye con `pg_restore`.
`restore` rechaza la base de datos de desarrollo administrada: una copia de
seguridad transporta sus filas como datos COPY, los cuales no puede recibir.
Restaure en Postgres en Docker (`rebase db restore <dump> --docker --clean --yes`),
y luego `rebase db pull --from "$(rebase db url --docker)" --yes` la copia en la
base de datos administrada. Una copia de seguridad de la base de datos
administrada la deja tal como estaba.
Las rutas relativas, y la predeterminada `./backups`, se resuelven con respecto
al directorio desde el cual ejecuta `rebase`, por lo que las tres líneas
anteriores coinciden en un mismo directorio; si se proporciona una opción no
admitida por un comando, se rechaza antes de que se ejecute nada.
El volcado (dump) y su archivo de roles solo son legibles por usted (0600), y
frente a una base de datos que no está en ejecución, `backup` y `restore` muestran
el mismo mensaje informativo que `db push`.
La programación, el archivo de roles que acompaña a cada volcado y el
procedimiento de restauración se detallan en
[Copias de seguridad y restauración](/docs/deployment/backups/).

### `rebase db pull`

Copia otra base de datos en la base de datos local de desarrollo:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` acepta una URL `postgres://` o `postgresql://`, o pares
`host=… port=… dbname=…` de libpq entre comillas como un único argumento.
Cualquier otro formato se rechaza antes de leer o iniciar nada, sin repetir el
valor.

`--anonymize` reemplaza campos personales durante la importación, de modo que se
pueda trabajar localmente con una copia de producción sin transferir datos reales
de clientes a una computadora portátil. Asocia columnas por nombre y funciona
según el principio del mejor esfuerzo. Una columna simple llamada `name` solo se
reemplaza en una tabla de personas: una llamada `users`, `authors`, `customers` o
similar, o cualquier tabla que también contenga una columna de dirección de
correo electrónico.
Una columna con un índice único recibe un valor distinto por fila, y el proceso se
realiza en una sola transacción: si falla, las tablas que habría reescrito se
vacían y se enumeran, y el comando termina con código 1.

Cualquier indicador (flag) que `pull` no acepte se rechaza antes de leer o copiar
nada, sugiriendo el que probablemente se pretendía usar: `--anonymise` responde
"did you mean --anonymize?" y termina con código 1.
En `pull` y en cualquier otro comando, un conmutador al que se le asigne un valor
lo interpreta: `--anonymize=true` o `=1` lo activa, `--anonymize=false` o `=0` lo
desactiva, y cualquier otro valor se rechaza.

`pg_dump` despoja los privilegios, por lo que la copia llegaría con las políticas
de RLS del origen y ninguna de las concesiones (grants) subyacentes, fallando cada
lectura como `rebase_user` con `permission denied`. El pull reaprovisiona el rol
de la aplicación posteriormente, utilizando la misma rutina que emplean el
arranque y `rebase db push`, de modo que las tablas internas de Rebase permanezcan
revocadas como corresponde.

El destino siempre es la base de datos de desarrollo local de este proyecto y no
se puede elegir: `--database-url` se rechaza en lugar de aceptarse, por lo que no
hay forma de indicar "pull hacia producción". `--from` es la única dirección.

Un pull reemplaza el contenido de la base de datos local: vacía primero cada
esquema que copia, por lo que una tabla que solo exista localmente no
sobrevivirá. En la base de datos de desarrollo administrada, las filas viajan
como sentencias `INSERT`, las cuales acepta allí donde `COPY` se detendría.

### `rebase db url`

Imprime la cadena de conexión que está utilizando este proyecto, y nada más, para
que pueda canalizarse (pipe):

```bash
rebase db url
psql "$(rebase db url)"
```

La base de datos de desarrollo administrada es el caso que necesita esto: `.env`
deja `DATABASE_URL` comentada a propósito, y el puerto se deriva de la ruta del
proyecto, por lo que nada en el disco la nombra.
Mantiene ese puerto entre una detención y un inicio, a menos que otro proceso lo
haya ocupado. Cuando haya configurado una `DATABASE_URL` propia, eso es lo que
imprime; el orden de resolución es el mismo que sigue cualquier otro comando.
Inicia la base de datos administrada si aún no está en ejecución.

Después de `rebase dev --docker`, `db url` y los demás comandos usan esa base de
datos Docker (e indican esto en stderr) hasta que se ejecute un `rebase dev` sin
el indicador. La elección se conserva en `.rebase/dev-database.json` y se
clasifica en la misma posición de precedencia que `--docker`, por debajo de
cualquier cadena de conexión. Un `--docker` que introduzca y que sea superado en
precedencia por una cadena de conexión no inicia ningún contenedor: una línea en
stderr indica que fue ignorado, nombra el que tuvo prioridad y explica cómo
acceder a Docker en su lugar. Un `rebase dev --docker` superado de esa manera
mantiene la preferencia guardada tal como estaba, de modo que una vez eliminada
la cadena de conexión, los comandos vuelven a seguir a Docker.

`rebase init` asigna a cada proyecto su propio puerto de compose, del 5433 al
5632 según la ruta del proyecto, y `--docker` verifica que lo que responde en él
sea el contenedor `db` de este proyecto. Cuando otro contenedor o un Postgres
fuera de Docker ocupa el puerto, se detiene y lo indica en lugar de conectarse a
la base de datos de otra persona. Para mover el proyecto, cambie el puerto del
host del servicio `db` en `docker-compose.yml`, y `DATABASE_URL` si `.env` define
una.

### `rebase db stop` / `rebase db reset`

Solo para la base de datos de desarrollo administrada:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Pertenece al proyecto, no al comando que la inició, por lo que detener
`rebase dev` la deja en ejecución para los demás comandos. Tras 30 minutos sin
conexiones, se detiene automáticamente, y el siguiente comando que la necesite la
iniciará de nuevo. `rebase dev` lo indica al detenerse, explicando cómo detener la
base de datos en ese momento.

`db stop` bajo un `rebase dev` en ejecución indica que su backend no podrá
comunicarse con la base de datos hasta que vuelva a estar disponible. El siguiente
comando que la necesite, por ejemplo `rebase db url`, la inicia en el mismo
puerto y el backend se vuelve a conectar sin necesidad de reiniciar.

### `rebase db request-role migrate`

Mueve las solicitudes de esta base de datos de un rol de Postgres a otro:

```bash
rebase db request-role migrate --to <role[,role]> [--dry-run] [--yes]
```

Las solicitudes se ejecutan como `rebase_user` a menos que el proyecto
especifique otro rol (`REBASE_RLS_REQUEST_ROLE`, o `rls.requestRole`). Un rol
pertenece a todo el clúster, por lo que los proyectos que compartan uno deberían
tener el suyo propio. El primer arranque de aprovisionamiento registra el rol en
la base de datos, y un arranque posterior configurado con otro rol se negará a
iniciar hasta que la base de datos se migre.

El comando migra desde el rol que registró la base de datos, o `rebase_user`. En
una sola transacción, crea el nuevo rol si no existe, permite que la conexión
cambie a él, vuelve a emitir únicamente en esta base de datos cada concesión
(grant) que posea el rol anterior, redirige las políticas que lo nombren y
registra el nuevo rol. El rol anterior se deja tal como está, ya que otra base de
datos en el clúster podría estar usándolo. Luego imprime las sentencias `REVOKE`
que retiran aquí los permisos del rol anterior, para ejecutarlas una vez que nada
las necesite.

`--dry-run` imprime las sentencias y los `REVOKE` sin cambiar nada. En una
terminal solicita confirmación primero; sin terminal, la operación se rechaza a
menos que se use `--yes`. Luego configure `REBASE_RLS_REQUEST_ROLE` con el nuevo
rol en cada servidor que utilice la base de datos. Consulte
[Ejecución en una base de datos existente o compartida](/docs/deployment/existing-database/).

### `rebase db provision --print`

Imprime el SQL que configura los roles de solicitud para esta base de datos, para
que lo ejecute un administrador de base de datos:

```bash
rebase db provision --print > request-role.sql
```

Para cada rol de solicitud, imprime las sentencias que crean el rol, otorgan al
rol de conexión el permiso para cambiar a él y, bajo la opción predeterminada
`grants: "schema"`, le conceden acceso a los esquemas `public` y `rebase`. Los
roles son `REBASE_RLS_REQUEST_ROLE` cuando está definido; de lo contrario, los
que un arranque haya registrado en la base de datos; de lo contrario,
`rebase_user`. La explicación está redactada como comentarios SQL, de modo que la
salida se puede ejecutar tal cual. Lee el rol de conexión y no ejecuta nada más.
`--print` es obligatorio. Combínelo con `REBASE_RLS_PROVISION_ROLE=never` cuando
los roles sean creados por un DBA o mediante código de infraestructura.

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

PostgreSQL no copiará ni eliminará una base de datos a la que haya algo más
conectado, y ese "algo más" suele ser su propio `rebase dev`. `create` y
`delete` indican qué está manteniendo abierta la base de datos; `--force`
desconecta primero esas sesiones.

Cada rama es una copia completa en disco, por lo que es necesario limpiarlas.
`prune` elimina tres cosas: una entrada cuya base de datos se eliminó fuera de
Rebase, una base de datos de rama cuya entrada nunca se escribió y —solo con
`--older-than`— ramas que superen la antigüedad especificada. Solicita
confirmación antes de eliminar nada, a menos que pase `--yes`. Sin una terminal
para preguntar, como en CI, no elimina nada, indica que se pase `--yes` y termina
con código 1.
`list` e `info` son de solo lectura: una base de datos en la que no se creó
ninguna rama no tiene ninguna, y no crean ningún esquema `rebase` allí.

`diff` muestra qué cambió una rama con respecto a la base de datos a partir de la
cual se creó: tablas, columnas, restricciones, índices, disparadores (triggers),
políticas de RLS, tipos enum, vistas y funciones agregadas, eliminadas o
alteradas, y por tabla las filas insertadas, actualizadas y eliminadas. Las filas
que la base de datos principal cambió por su cuenta desde entonces se cuentan por
separado, y las filas modificadas por ambas representan conflictos. `--json`
imprime el diff completo, con hasta `--sample-limit` filas por tabla (por defecto
100). Lee ambas bases de datos y no modifica ninguna; la fusión se realiza en
Studio — consulte
[Revisión y fusión de una rama](/docs/backend/branching/#reviewing-and-merging-a-branch).

`switch` registra la rama en `.rebase/branch.json` y nunca edita `.env`. Tiene
prioridad sobre `DATABASE_URL` en `.env` y queda por detrás de `--database-url` o
un `DATABASE_URL` en la terminal, por lo que un indicador en la línea de comandos
siempre prevalece sobre un cambio realizado anteriormente. `delete` rechaza la
rama en la que se encuentra actualmente, ya que todos los comandos en el checkout,
incluida la eliminación, apuntan a ella: ejecute `switch --off` primero y luego
elimínela. Todo el flujo de trabajo se encuentra en
[Ramificación de bases de datos](/docs/backend/branching/).

:::note[En la base de datos de desarrollo administrada]
`push`, `generate` y `migrate` funcionan aquí como en cualquier otra base de
datos.
`push` y `generate` planifican su trabajo con Atlas, que necesita una segunda
base de datos vacía para comparar, y el PGlite administrado sirve exactamente
una. Por lo tanto, en la base de datos administrada, cada uno de ellos inicia un
segundo PGlite desechable en memoria para Atlas y lo detiene cuando finaliza el
comando. Así es como se elimina, renombra o restringe una columna allí:
`rebase dev` solo añade elementos. El control de operaciones destructivas es el
mismo que en cualquier otro lugar. Para hacer que Atlas planifique contra una
base de datos vacía propia en su lugar, configure `REBASE_ATLAS_DEV_URL`
apuntando a ella; Rebase no crea ni elimina una base de datos nombrada de esa
manera.

`branch` se rechaza allí. `CREATE DATABASE ... TEMPLATE` en PGlite escribe una
entrada en el catálogo y no copia nada, por lo que la rama se resolvería en la
base de datos desde la que se clonó: cada escritura que pretendía aislar
terminaría en su base de datos de desarrollo. `rebase dev --docker` le
proporciona un servidor real con el que pueden funcionar las ramas.
:::

## Relacionado

- [Referencia de la CLI](/docs/cli/) — todos los demás comandos de `rebase`
- [Generación de esquemas](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` y `db branch` en profundidad
- [Copias de seguridad y restauración](/docs/deployment/backups/) — programación, el archivo de roles, restauración
- [Ramificación de bases de datos](/docs/backend/branching/) — cómo se crea una rama y qué implica
- [Ejecución en una base de datos existente o compartida](/docs/deployment/existing-database/) — el rol de solicitud, sus configuraciones y `rebase doctor --database`
- [Scripts y la consola](/docs/backend/scripts/) — la misma base de datos desde un script o un REPL
