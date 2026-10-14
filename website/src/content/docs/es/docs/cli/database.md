---
sourceHash: 866dbef37f99114d
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

Crea archivos de migración con marca de tiempo en `drizzle/migrations/` que pueden revisarse y confirmarse en git.

### `rebase db migrate`

Ejecuta las migraciones de base de datos pendientes:

```bash
rebase db migrate
```

Aplica todas las migraciones no aplicadas a la base de datos.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` ejecuta `pg_dump`; `restore` ejecuta `pg_restore` y, al ser destructivo, requiere `--yes`.
<span class="since-badge" data-since="0.25">Desde 0.25</span> Las rutas relativas,
y el `./backups` predeterminado, se resuelven respecto al directorio desde el que
ejecutas `rebase`, de modo que las tres líneas de arriba coinciden en un mismo
directorio; una opción que un comando no admite se rechaza antes de que se ejecute
nada. En la 0.24 el valor predeterminado es `backend/backups`, así que lístalo con
`--out ./backups`.
<span class="since-badge" data-since="0.25">Desde 0.25</span> El dump y su archivo de roles solo
los puedes leer tú (0600), y contra una base de datos que no está en ejecución,
`backup` y `restore` imprimen el banner que imprime `db push`. En la 0.24 los dumps son 0644.
La programación, el archivo de roles que acompaña a cada dump y el procedimiento de restauración están en [Copias de seguridad y restauración](/docs/deployment/backups/).

### `rebase db pull`

Copia otra base de datos en la base de datos de desarrollo local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` reemplaza los campos personales durante la importación, para que se pueda trabajar con una copia de producción localmente sin llevar datos reales de clientes a un portátil. Compara las columnas por nombre y es de mejor esfuerzo. <span class="since-badge" data-since="0.25">Desde 0.25</span>
Una columna bajo un índice único recibe un valor distinto por fila, y la pasada es una sola
transacción: si falla, las tablas que habría reescrito se vacían y se nombran,
y el comando termina con código 1. En la 0.24 fallaba en `token_hash` una vez que los usuarios
habían iniciado sesión dos veces, dejando datos reales atrás.

`pg_dump` elimina los privilegios, por lo que la copia llegaría con las políticas RLS del origen y ninguna de las concesiones (grants) asociadas — fallando cada lectura como `rebase_user` con `permission denied`. La operación pull reaprovisiona el rol de la aplicación después, utilizando la misma rutina que el arranque y `rebase db push`, de modo que las tablas internas de Rebase permanezcan revocadas como corresponde.

El destino siempre es la base de datos de desarrollo local de este proyecto y no se puede elegir: `--database-url` es rechazado en lugar de aceptado, por lo que no hay forma de ordenar "pull a producción". `--from` es la única dirección.

### `rebase db url`

Imprime la cadena de conexión que está usando este proyecto, y nada más, para que se pueda canalizar (pipe):

```bash
rebase db url
psql "$(rebase db url)"
```

La base de datos de desarrollo gestionada es el caso que necesita esto: `.env` deja `DATABASE_URL` comentada a propósito, y el puerto se deriva de la ruta del proyecto, por lo que nada en el disco la nombra. Cuando has definido una `DATABASE_URL` propia, eso es lo que imprime — el orden de resolución es el mismo que sigue cualquier otro comando. Inicia la base de datos gestionada si aún no se está ejecutando.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Tras
`rebase dev --docker`, `db url` y los demás comandos usan esa base de datos de Docker
(y lo dicen en stderr) hasta que se ejecuta un `rebase dev` sin el flag. La elección se
guarda en `.rebase/dev-database.json` y tiene la misma prioridad que `--docker`, por debajo de cualquier
cadena de conexión. Un `--docker` que escribas y que una cadena de conexión anula
no inicia ningún contenedor: una línea en stderr dice que se ignoró, nombra lo que ganó
y explica cómo llegar a Docker en su lugar. En la 0.24 cada comando necesita su propio
`--docker`, y uno anulado igualmente inicia el contenedor.

### `rebase db stop` / `rebase db reset`

Solo para la base de datos de desarrollo gestionada:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL no copiará ni eliminará una base de datos a la que haya algo conectado, y ese "algo" suele ser tu propio `rebase dev`. `create` y `delete` indican qué está manteniendo abierta la base de datos; `--force` desconecta esas sesiones primero.

Cada rama es una copia completa en disco, por lo que es necesario limpiarlas. `prune` elimina tres cosas: una entrada cuya base de datos se eliminó fuera de Rebase, una base de datos de rama cuya entrada nunca se escribió y — solo con `--older-than` — ramas que superen la antigüedad especificada. Pide confirmación antes de eliminar nada a menos que pases `--yes`.
<span class="since-badge" data-since="0.25">Desde 0.25</span> Sin un terminal en el que preguntar, como en CI, no elimina nada, indica que hay que pasar `--yes` y termina con código 1; en la 0.24 dice "Nothing was changed." y termina con código 0.
`list` e `info` solo leen: una base de datos en la que no se creó ninguna rama no tiene ninguna, y
no crean ningún esquema `rebase` allí. En la 0.24 crean el registro.

`switch` registra la rama en `.rebase/branch.json` y nunca edita `.env`. Tiene prioridad sobre `DATABASE_URL` en `.env` y cede ante `--database-url` o un `DATABASE_URL` en el shell, por lo que un flag en la línea de comandos siempre prevalece sobre un cambio realizado anteriormente. `delete` rechaza la rama en la que te encuentras, ya que todos los comandos del checkout, el propio delete incluido, apuntan a ella: primero `switch --off`, y luego elimínala. El flujo de trabajo completo está en [Ramificación de bases de datos](/docs/backend/branching/).

:::note[En la base de datos de desarrollo gestionada]
<span class="since-badge" data-since="0.25">Desde 0.25</span> `push`, `generate` y `migrate` planifican su trabajo con Atlas, que necesita una segunda base de datos vacía con la que comparar — y el PGlite gestionado sirve exactamente una. Por eso, en la base de datos gestionada cada uno de ellos inicia un segundo PGlite desechable en memoria para Atlas, y lo detiene cuando termina el comando. Así es como allí se elimina, renombra o estrecha una columna: `rebase dev` solo añade. La puerta destructiva es la misma que en cualquier otro sitio. Para que Atlas planifique contra una base de datos vacía propia, define `REBASE_ATLAS_DEV_URL` con ella; Rebase no crea ni elimina una base de datos nombrada de esa manera.

`branch` se rechaza allí. `CREATE DATABASE ... TEMPLATE` contra PGlite escribe una entrada en el catálogo y no copia nada, por lo que la rama resolvería a la base de datos de la que fue clonada — cada escritura que querías aislar terminaría en tu base de datos de desarrollo. `rebase dev --docker` te proporciona un servidor real con el que las ramas pueden funcionar.
:::

## Relacionado

- [Referencia de la CLI](/docs/cli/) — cada uno de los demás comandos `rebase`
- [Generación de esquemas](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` y `db branch` en profundidad
- [Copias de seguridad y restauración](/docs/deployment/backups/) — programación, el archivo de roles, restauración
- [Ramificación de bases de datos](/docs/backend/branching/) — cómo se crea una rama y qué cuesta
- [Scripts y la consola](/docs/backend/scripts/) — la misma base de datos desde un script o un REPL
