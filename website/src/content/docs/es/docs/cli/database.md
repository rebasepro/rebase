---
sourceHash: 43740c5d88571844
title: Comandos de base de datos
sidebar_label: Comandos de base de datos
description: Los comandos rebase db — push, generate y migrate, copias de seguridad y restauraciones, traer una copia, la cadena de conexión, la base de datos de desarrollo gestionada y las ramas.
---

## Descripción general

`rebase db` es la familia de comandos que llegan a la base de datos del proyecto.
Cada uno trabaja sobre la base de datos que el proyecto resuelve, en el orden que
lista [Ramificación de bases de datos](/docs/backend/branching/#cli-integration):
`--database-url`, después `DATABASE_URL` en el shell, la rama a la que está cambiado
el checkout, `DATABASE_URL` en `.env`, `--docker` y, si no, la base de datos de
desarrollo gestionada que inicia `rebase dev`. `rebase db url` imprime cuál es.

`request-role` y `provision` son para una base de datos que Rebase no posee por completo;
consulta [Ejecutar sobre una base de datos existente o compartida](/docs/deployment/existing-database/).
`push`, `generate` y `migrate` se describen en profundidad en
[Generación de esquemas](/docs/cli/schema/), y cada uno de los demás comandos está
en la [Referencia de la CLI](/docs/cli/).

## Comandos

### `rebase db push`

Aplica cambios del esquema directamente en la base de datos (solo desarrollo):

```bash
rebase db push
```

`--database-url <url>` indica la base de datos, y `--docker` la de compose, iniciada
si hace falta. `generate`, `migrate`, `branch`, `backup` y `restore` aceptan ambos también.

Deja en paz lo que tus colecciones no describen: otras tablas y vistas, los índices que
escribiste y las restricciones CHECK y EXCLUDE de la tabla de una colección, que una
colección no puede declarar. Consulta [`rebase db push`](/docs/cli/schema/#rebase-db-push)
para ver qué aplica y ante qué se detiene.

:::caution
`db push` modifica la base de datos directamente sin archivos de migración. Usa `db generate` + `db migrate` para producción.
:::

### `rebase db generate`

Genera archivos de migración SQL a partir de los cambios en el esquema:

```bash
rebase db generate
```

Crea archivos de migración con marca de tiempo en `backend/drizzle/migrations/` que pueden revisarse y confirmarse en git.

### `rebase db migrate`

Ejecuta las migraciones de base de datos pendientes:

```bash
rebase db migrate
```

Aplica todas las migraciones no aplicadas a la base de datos.

En una base de datos que ya ha arrancado, la primera migración crea tablas que el
arranque ya creó, así que el primer `db migrate` allí se detiene con `already exists`.
Registra esa migración como aplicada en su lugar, una sola vez:

```bash
rebase db migrate --baseline <version>
```

La versión es el prefijo numérico del archivo de migración; `db generate` imprime el
comando con ella ya rellenada. Consulta
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) para una base de datos que ya
registra migraciones.

Después, `db migrate` aplica lo que el arranque no ha aplicado, y en una base de datos
que sirve `rebase dev` eso es menos de lo que parece. El arranque añade cada tabla,
columna y valor de enum nuevos en cuanto cambia una colección, así que, para cuando
`db generate` escribe la migración que añade una columna, la columna ya está ahí:
ese `db migrate` vuelve a detenerse con `already exists` y nombra el
`--baseline <version>` que la registra. Cada propiedad nueva supone otra baseline.
Registra una migración solo cuando el arranque hizo todos sus cambios. Una que además
elimina, renombra o estrecha algo contiene sentencias que el arranque nunca ejecuta, y
registrarla se las salta. En desarrollo, `rebase db push` es el comando que cambia el
esquema; deja `db generate` y `db migrate` para una base de datos que el arranque no
haya cambiado ya.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` ejecuta `pg_dump`; `restore` ejecuta `pg_restore` y, al ser destructivo,
pide que escribas `yes` en un terminal, o acepta `--yes`; sin terminal y sin
`--yes` se niega e indica que hay que pasarlo.
En una base de datos
que ya contiene lo que crea la copia de seguridad, `restore` necesita `--clean`. Sin
él, se niega antes de aplicar nada, roles del clúster incluidos, y nombra los
objetos que estorban y las dos formas de evitarlos: `--clean`, o
`--create-db --target-db <new name>`.
Con `--clean`
la restauración es una sola transacción: elimina los esquemas de la copia de seguridad
con todo lo que contienen, restaura y solo confirma cuando toda la restauración ha
salido bien, así que un fallo deja la base de datos como estaba. Antes de preguntar,
nombra lo que elimina y que la copia de seguridad no contiene. Ejecuta `psql`, que
viene con `pg_restore`.
`restore` rechaza
la base de datos de desarrollo gestionada: una copia de seguridad lleva sus filas
como datos COPY, que esta no puede recibir. Restaura en Postgres en Docker
(`rebase db restore <dump> --docker --clean --yes`), y luego
`rebase db pull --from "$(rebase db url --docker)" --yes` la copia en la base de
datos gestionada. Una copia de seguridad de la base de datos gestionada la deja como
estaba.
Las rutas relativas,
y el `./backups` predeterminado, se resuelven respecto al directorio desde el que
ejecutas `rebase`, de modo que las tres líneas de arriba coinciden en un mismo
directorio; una opción que un comando no admite se rechaza antes de que se ejecute
nada.
El dump y su archivo de roles solo
los puedes leer tú (0600), y contra una base de datos que no está en ejecución,
`backup` y `restore` imprimen el banner que imprime `db push`.
La programación, el archivo de roles que acompaña a cada dump y el procedimiento de restauración están en [Copias de seguridad y restauración](/docs/deployment/backups/).

### `rebase db pull`

Copia otra base de datos en la base de datos de desarrollo local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` acepta una URL `postgres://` o `postgresql://`, o los pares
`host=… port=… dbname=…` de libpq entrecomillados como un solo argumento. Cualquier
otra cosa se rechaza antes de leer o iniciar nada, sin repetir el valor.

`--anonymize` reemplaza los campos personales durante la importación, para que se pueda trabajar con una copia de producción localmente sin llevar datos reales de clientes a un portátil. Compara las columnas por nombre y es de mejor esfuerzo. Una columna `name` a secas solo se reemplaza en una
tabla de personas: una llamada `users`, `authors`, `customers` o similar, o cualquier
tabla que además tenga una columna de dirección de correo electrónico.
Una columna bajo un índice único recibe un valor distinto por fila, y la pasada es una sola
transacción: si falla, las tablas que habría reescrito se vacían y se nombran,
y el comando termina con código 1.

Un flag que `pull`
no acepta se rechaza antes de leer o copiar nada, nombrando el que probablemente se
quería escribir: `--anonymise` responde "did you mean --anonymize?" y termina con
código 1.
En `pull` y en todos los demás comandos, un switch al que se le da un valor lo lee:
`--anonymize=true` o `=1` lo activa, `--anonymize=false` o `=0` lo deja desactivado,
y cualquier otro valor se rechaza.

`pg_dump` elimina los privilegios, por lo que la copia llegaría con las políticas RLS del origen y ninguna de las concesiones (grants) asociadas — fallando cada lectura como `rebase_user` con `permission denied`. La operación pull reaprovisiona el rol de la aplicación después, utilizando la misma rutina que el arranque y `rebase db push`, de modo que las tablas internas de Rebase permanezcan revocadas como corresponde.

El destino siempre es la base de datos de desarrollo local de este proyecto y no se puede elegir: `--database-url` es rechazado en lugar de aceptado, por lo que no hay forma de ordenar "pull a producción". `--from` es la única dirección.

Un pull reemplaza
el contenido de la base de datos local: primero vacía cada esquema que copia, así que
una tabla que solo existe en local no sobrevive. En la base de datos de desarrollo
gestionada las filas viajan como sentencias `INSERT`, que esta acepta donde `COPY`
la detendría.

### `rebase db url`

Imprime la cadena de conexión que está usando este proyecto, y nada más, para que se pueda canalizar (pipe):

```bash
rebase db url
psql "$(rebase db url)"
```

La base de datos de desarrollo gestionada es el caso que necesita esto: `.env` deja `DATABASE_URL` comentada a propósito, y el puerto se deriva de la ruta del proyecto, por lo que nada en el disco la nombra. Conserva ese puerto entre una parada y un inicio, salvo que otra cosa lo haya ocupado. Cuando has definido una `DATABASE_URL` propia, eso es lo que imprime — el orden de resolución es el mismo que sigue cualquier otro comando. Inicia la base de datos gestionada si aún no se está ejecutando.

Tras
`rebase dev --docker`, `db url` y los demás comandos usan esa base de datos de Docker
(y lo dicen en stderr) hasta que se ejecuta un `rebase dev` sin el flag. La elección se
guarda en `.rebase/dev-database.json` y tiene la misma prioridad que `--docker`, por debajo de cualquier
cadena de conexión. Un `--docker` que escribas y que una cadena de conexión anula
no inicia ningún contenedor: una línea en stderr dice que se ignoró, nombra lo que ganó
y explica cómo llegar a Docker en su lugar. Un `rebase dev --docker` anulado de esa
forma deja la elección recordada como estaba, así que, en cuanto desaparece la cadena
de conexión, los comandos vuelven a seguir a Docker.

`rebase init`
da a cada proyecto su propio puerto de compose, entre 5433 y 5632 según la ruta del
proyecto, y `--docker` comprueba que lo que responde en él es el contenedor `db` de
este proyecto. Cuando otro contenedor o un Postgres fuera de Docker ocupa el puerto,
se detiene y lo nombra en lugar de iniciar sesión en la base de datos de otro. Para
mover el proyecto, cambia el puerto del host del servicio `db` en `docker-compose.yml`,
y `DATABASE_URL` si `.env` define una.

### `rebase db stop` / `rebase db reset`

Solo para la base de datos de desarrollo gestionada:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Pertenece al proyecto, no al comando que la inició, así que detener `rebase dev` la
deja en marcha para los demás comandos. Tras 30 minutos sin nada conectado se detiene
sola, y el siguiente comando que la necesita la vuelve a iniciar. `rebase dev`
lo dice al detenerse, con cómo detener la base de datos en ese momento.

`db stop` con un
`rebase dev` en marcha dice que su backend no puede llegar a la base de datos hasta
que vuelva. El siguiente comando que la necesita, `rebase db url` por ejemplo, la
inicia en el mismo puerto, y el backend se reconecta sin reiniciarse.

### `rebase db request-role migrate`

<span class="since-badge" data-since="0.30">Since 0.30</span>

Mueve las solicitudes de esta base de datos de un rol de Postgres a otro:

```bash
rebase db request-role migrate --to <role[,role]> [--dry-run] [--yes]
```

Las solicitudes se ejecutan como `rebase_user` salvo que el proyecto indique otro rol
(`REBASE_RLS_REQUEST_ROLE`, o `rls.requestRole`). Un rol pertenece a todo el
clúster, así que los proyectos que comparten uno deberían tener cada uno el suyo. El primer
arranque que aprovisiona registra el rol en la base de datos, y un arranque posterior
configurado con otro rol se niega a iniciar hasta que se migre la base de datos.

El comando migra desde el rol que registró la base de datos, o `rebase_user`. En
una sola transacción crea el nuevo rol si falta, permite que la conexión cambie
a él, vuelve a emitir, solo en esta base de datos, cada privilegio que tiene el rol antiguo,
reorienta las políticas que lo nombran y registra el nuevo rol. El rol antiguo se
deja tal cual, porque otra base de datos del clúster puede usarlo. Después
imprime las sentencias `REVOKE` que retiran aquí los privilegios del rol antiguo,
para ejecutarlas cuando ya nada los necesite.

`--dry-run` imprime las sentencias y los `REVOKE` y no cambia nada. En una
terminal pregunta primero; sin terminal se niega sin `--yes`. Después define
`REBASE_RLS_REQUEST_ROLE` con el nuevo rol en cada servidor que use la
base de datos. Consulta [Ejecutar sobre una base de datos existente o compartida](/docs/deployment/existing-database/).

### `rebase db provision --print`

<span class="since-badge" data-since="0.30">Since 0.30</span>

Imprime el SQL que configura el rol o los roles de solicitud de esta base de datos, para que
lo ejecute un administrador de bases de datos:

```bash
rebase db provision --print > request-role.sql
```

Para cada rol de solicitud imprime las sentencias que crean el rol, dan al
rol de conexión el derecho a cambiar a él y, con el `grants: "schema"` predeterminado,
le otorgan los esquemas `public` y `rebase`. Los roles son
`REBASE_RLS_REQUEST_ROLE` cuando está definido; si no, los que un arranque registró en la
base de datos; y si no, `rebase_user`. La explicación se escribe como comentarios SQL, así que
la salida se ejecuta tal cual. Lee el rol de conexión y no ejecuta nada más.
`--print` es obligatorio. Combínalo con `REBASE_RLS_PROVISION_ROLE=never` cuando los roles
los crea un DBA o el código de infraestructura.

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

PostgreSQL no copiará ni eliminará una base de datos a la que haya algo conectado, y ese "algo" suele ser tu propio `rebase dev`. `create` y `delete` indican qué está manteniendo abierta la base de datos; `--force` desconecta esas sesiones primero.

Cada rama es una copia completa en disco, por lo que es necesario limpiarlas. `prune` elimina tres cosas: una entrada cuya base de datos se eliminó fuera de Rebase, una base de datos de rama cuya entrada nunca se escribió y — solo con `--older-than` — ramas que superen la antigüedad especificada. Pide confirmación antes de eliminar nada a menos que pases `--yes`.
Sin un terminal en el que preguntar, como en CI, no elimina nada, indica que hay que pasar `--yes` y termina con código 1.
`list` e `info` solo leen: una base de datos en la que no se creó ninguna rama no tiene ninguna, y
no crean ningún esquema `rebase` allí.

`diff` muestra qué cambió una rama respecto a la base de datos de la que se creó: tablas, columnas, restricciones, índices, triggers, políticas RLS, tipos enum, vistas y funciones añadidos, eliminados o modificados, y por tabla las filas que insertó, actualizó y borró. Las filas que el padre cambió por su cuenta desde entonces se cuentan aparte, y las que cambiaron ambos son conflictos. `--json` imprime el diff completo, con hasta `--sample-limit` filas por tabla (100 por defecto). Lee las dos bases de datos y no cambia ninguna; la fusión está en Studio — consulta [Revisar y fusionar una rama](/docs/backend/branching/#reviewing-and-merging-a-branch).

`switch` registra la rama en `.rebase/branch.json` y nunca edita `.env`. Tiene prioridad sobre `DATABASE_URL` en `.env` y cede ante `--database-url` o un `DATABASE_URL` en el shell, por lo que un flag en la línea de comandos siempre prevalece sobre un cambio realizado anteriormente. `delete` rechaza la rama en la que te encuentras, ya que todos los comandos del checkout, el propio delete incluido, apuntan a ella: primero `switch --off`, y luego elimínala. El flujo de trabajo completo está en [Ramificación de bases de datos](/docs/backend/branching/).

:::note[En la base de datos de desarrollo gestionada]
`push`, `generate` y `migrate` funcionan aquí como en cualquier base de datos.
`push` y `generate` planifican su trabajo con Atlas, que necesita una segunda base de datos vacía con la que comparar — y el PGlite gestionado sirve exactamente una. Por eso, en la base de datos gestionada cada uno de ellos inicia un segundo PGlite desechable en memoria para Atlas, y lo detiene cuando termina el comando. Así es como allí se elimina, renombra o estrecha una columna: `rebase dev` solo añade. La puerta destructiva es la misma que en cualquier otro sitio. Para que Atlas planifique contra una base de datos vacía propia, define `REBASE_ATLAS_DEV_URL` con ella; Rebase no crea ni elimina una base de datos nombrada de esa manera.

`branch` se rechaza allí. `CREATE DATABASE ... TEMPLATE` contra PGlite escribe una entrada en el catálogo y no copia nada, por lo que la rama resolvería a la base de datos de la que fue clonada — cada escritura que querías aislar terminaría en tu base de datos de desarrollo. `rebase dev --docker` te proporciona un servidor real con el que las ramas pueden funcionar.
:::

## Relacionado

- [Referencia de la CLI](/docs/cli/) — cada uno de los demás comandos `rebase`
- [Generación de esquemas](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` y `db branch` en profundidad
- [Copias de seguridad y restauración](/docs/deployment/backups/) — programación, el archivo de roles, restauración
- [Ramificación de bases de datos](/docs/backend/branching/) — cómo se crea una rama y qué cuesta
- [Ejecutar sobre una base de datos existente o compartida](/docs/deployment/existing-database/) — el rol de solicitud, sus ajustes y `rebase doctor --database`
- [Scripts y la consola](/docs/backend/scripts/) — la misma base de datos desde un script o un REPL
