---
sourceHash: cd3015585fe4e355
title: Copias de seguridad y restauración
sidebar_label: Copias de seguridad
description: "Realice, programe, liste y restaure copias de seguridad de la base de datos con pg_dump — qué contiene una copia de seguridad, el archivo de roles que la acompaña y lo único que no cubre: sus archivos subidos."
---

## Descripción general

Rebase realiza copias de seguridad de una base de datos Postgres con `pg_dump` y las restaura con
`pg_restore`. Puede hacer una copia de seguridad manualmente, programar una con un cron job,
listar las que tiene desde la CLI o desde el panel **Backups** de Studio, y restaurar
en una base de datos nueva sin tocar la que está en producción.

:::caution[Esto no hace una copia de seguridad de sus archivos]
Una copia de seguridad contiene la **base de datos** y nada más. Los archivos subidos residen en su
[backend de almacenamiento](/docs/backend/storage/) —un bucket de S3 o GCS, o el
directorio en `STORAGE_PATH`—, no en Postgres, por lo que una base de datos restaurada apunta a archivos que solo ese backend contiene.
Realice una copia de seguridad del bucket (mediante control de versiones o replicación) o del directorio de subidas
por separado, con su propia programación.
:::

## Inicio rápido

```bash
# Back up to a local directory (custom format, compressed)
rebase db backup --out ./backups

# Back up straight to private object storage
rebase db backup --out s3://my-private-bucket/backups

# List what you have
rebase db backups list

# Restore into a FRESH database (does not touch the live one)
rebase db restore ./backups/rebase-app-20260714T030000Z.dump \
  --create-db --target-db app_restored
```

La base de datos es la misma que resuelve cualquier otro [comando `rebase db`](/docs/cli/database/),
en el mismo orden: `--database-url`, `DATABASE_URL` en la shell, la
[rama](/docs/backend/branching/) a la que está cambiado el checkout, `DATABASE_URL`
en `.env`, Postgres en Docker (`--docker`, o el último `rebase dev --docker`),
y luego la base de datos de desarrollo administrada, la cual `restore` rechaza.

Un
`--out` relativo, el valor predeterminado `./backups` y una ruta de dump proporcionada a `rebase db restore`
se resuelven con respecto al directorio desde el que ejecuta `rebase`, normalmente la raíz del proyecto,
de modo que `rebase db backup` y `rebase db backups list` coincidan en el mismo lugar. Un
`BACKUP_DESTINATION` relativo se resuelve con respecto al directorio del backend, donde el
servidor también lo lee. Los tres comandos rechazan cualquier opción que no admitan
antes de ejecutar nada, e indican la que probablemente quería decir. La contraseña se pasa
a `pg_dump`, `pg_dumpall` y `pg_restore` a través de `PGPASSWORD`, nunca en su línea de comandos,
por lo que ningún mensaje de error ni lista de procesos la mostrará.

## Qué es una copia de seguridad

`rebase db backup` ejecuta `pg_dump` en formato personalizado (`-Fc`), que está comprimido
y puede restaurarse selectivamente. Los archivos se nombran
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump`; la marca de tiempo UTC en el nombre es por lo que
se ordenan la retención y el listado.

| Opción | Descripción |
| --- | --- |
| `--out`, `-o` | Una ruta local o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. Por defecto toma `$BACKUP_DESTINATION`, luego `./backups` en el directorio desde donde ejecuta `rebase`. |
| `--exclude-schema <s>` | Excluir un esquema del dump (repetible). Se rechazará cualquier patrón que coincida con `rebase` — consulte más abajo. |
| `--no-owner` | Omitir comandos de propiedad, para restaurar como un rol diferente. |
| `--enable-row-security` | Realizar el dump como un sujeto administrador en lugar de fallar por seguridad a nivel de fila. **Puede generar un dump parcial** — consulte [Seguridad a nivel de fila](#seguridad-a-nivel-de-fila-y-el-dump-que-queda-silenciosamente-incompleto). |
| `--row-security-role <r>` | El rol con el que se leerá usando el flag anterior. El valor predeterminado es `admin`. |

Un dump se valida antes de que el comando informe del éxito: `pg_restore --list`
debe poder leer todo el archivo.

Para destinos `s3://`, la CLI crea su cliente de almacenamiento a partir de las mismas
variables `S3_*` que utiliza su backend (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`).

### El archivo de roles

Cada copia de seguridad escribe un segundo archivo junto al dump:
`rebase-<db>-<…>Z.globals.sql`, generado por
`pg_dumpall --globals-only --no-role-passwords`. Un `pg_dump` por base de datos
no puede incluir roles de todo el clúster, y los permisos y políticas de seguridad
a nivel de fila del dump mencionan uno: `rebase_user`. Si se restaura en un nuevo Postgres sin él, el
primer `GRANT` a ese rol fallará y la restauración se detendrá.

Mantenga los dos archivos juntos. La CLI los sube y los restaura como un par, una
copia de seguridad programada los purga juntos, y `rebase db restore` busca el `.globals.sql` en el mismo
directorio o prefijo que el `.dump`. Los roles se recrean **sin contraseñas**;
configúrelas de nuevo tras una restauración en un nuevo clúster. `PG_DUMPALL_PATH` apunta a un
binario `pg_dumpall` específico.

### Qué contiene

Toda la base de datos, incluido el esquema `rebase`. Ese esquema contiene cada
cuenta de usuario y el resto de la autenticación, claves de API, historial de registros, la cola de tareas,
registros de cron y las funciones que invocan sus políticas RLS y los disparadores de captura de cambios.
Un dump sin él no tiene usuarios y no se puede restaurar en una base de datos vacía
de ninguna manera: las tablas que contiene tienen políticas que llaman a funciones
que no están presentes.

Por lo tanto,
`rebase db backup` rechaza un `--exclude-schema` que coincida con `rebase`, según
las propias reglas de patrones de pg_dump (incluidos `reb*` y `*`), antes de ejecutar nada.
Esas reglas procesan la sintaxis de expresiones regulares fuera de las comillas dobles, por lo que
`[r]ebase` y `audit|rebase` también se rechazan, y se consulta al servidor sobre
cada patrón antes de que `pg_dump` se ejecute, en el mismo motor de expresiones regulares
que utiliza la propia consulta de `pg_dump`.

Debido a que contiene
los hashes de todas las contraseñas y claves, un dump local y su `.globals.sql` se crean
con permisos de lectura únicamente para su propietario (0600), antes de que `pg_dump` escriba en ellos;
los archivos locales de una copia de seguridad programada también.

## Copias de seguridad programadas

Una copia de seguridad programada es un [cron job](/docs/backend/cron-jobs/) que vuelca la
base de datos, sube el resultado a `BACKUP_DESTINATION` y purga las copias de seguridad antiguas.
Coloque un archivo en `backend/crons/` que exporte uno por defecto:

```ts
// backend/crons/backup.ts
import { backupStorageFromEnv, type StorageController } from "@rebasepro/server";
import { createBackupCron, backupCronConfigFromEnv } from "@rebasepro/server-postgres";

const resolved = backupCronConfigFromEnv(process.env);
if (resolved.error) throw new Error(resolved.error);

function backupStorage(): StorageController | undefined {
    const destination = resolved.config?.destination;
    if (!destination || destination.kind === "local") return undefined; // local: written to disk directly
    // The same S3_* (or application-default GCS) client the CLI and the Backups panel build.
    return backupStorageFromEnv(destination, process.env);
}

// With BACKUP_SCHEDULE unset, export a disabled job so discovery still works.
export default resolved.config
    ? createBackupCron({ ...resolved.config, storage: backupStorage() })
    : createBackupCron({
        schedule: "0 3 * * *",
        connectionString: process.env.DATABASE_URL ?? "",
        destination: { kind: "local", path: "./backups" },
        enabled: false
    });
```

El controlador de almacenamiento se pasa como argumento en lugar de tomarse del contexto del trabajo,
porque el `rebase.storage` del contexto es la API de almacenamiento del lado del cliente, no un
controlador para el bucket de copias de seguridad.

Una copia de seguridad no está sujeta a los límites de subida del controlador. `maxFileSize` (50 MB
a menos que se configure) y `allowedMimeTypes` se aplican a lo que suben los usuarios, por lo que un dump de cualquier
tamaño se sube, al igual que uno escrito a través del controlador que sirve los
archivos de su aplicación.

| Variable | Significado |
| --- | --- |
| `BACKUP_SCHEDULE` | Expresión cron, p. ej. `0 3 * * *` para las 03:00 a diario. Si no se establece, desactiva las copias de seguridad programadas. |
| `BACKUP_DESTINATION` | Una ruta local o `s3://bucket/prefix` / `gs://bucket/prefix`. |
| `BACKUP_RETENTION_DAYS` | Eliminar copias de seguridad con más días de antigüedad que este número. Si no se define o es `0`, conserva todo. |
| `BACKUP_KEEP_MINIMUM` | Conservar siempre al menos este número de copias de seguridad recientes, sin importar su antigüedad — para que una interrupción prolongada no lo purgue todo. |

Cada nuevo dump se valida **antes** de purgar nada, por lo que un dump corrupto
nunca podrá ser la causa de que se elimine su última copia de seguridad válida. La purga solo afecta
a los archivos cuyos nombres coincidan con el patrón de copia de seguridad; cualquier otro elemento que comparta
el bucket o prefijo se mantiene intacto.

El cron ejecuta `pg_dump` dentro del proceso del servidor. La imagen de
runtime oficial (`rebasepro/server`, consulte [Autoalojamiento](/docs/deployment/self-hosting/))
incluye las herramientas de cliente de PostgreSQL 18 para ello.
En cualquier otro lugar —un VPS, su propia imagen—,
instale las herramientas de cliente usted mismo (consulte la siguiente sección).

## Compatibilidad de versiones

`pg_dump` y `pg_restore` deben tener la **misma versión principal que el servidor, o
una más reciente**. `rebase db backup` y `rebase db restore` comprueban la versión principal del cliente
contra el `server_version_num` del servidor activo antes de realizar el dump o restaurar, y
se detienen indicando la solución si no coinciden, o si
falta el binario:

```
✗ Client tool is Postgres 15 but the server is Postgres 16. pg_dump/pg_restore
  must be the same major version as the server or newer. Install Postgres 16
  client tools.
```

Instálelas con `brew install libpq` o `apt-get install postgresql-client-18`
(desde el repositorio apt de PostgreSQL, ya que el de Debian es más antiguo), o apunte a un
binario específico con `PG_DUMP_PATH`, `PG_RESTORE_PATH` y `PG_DUMPALL_PATH`.
`restore --clean` también ejecuta `psql`, que se incluye con ellos; `PSQL_PATH` permite
especificar otro.

## Seguridad a nivel de fila y el dump que queda silenciosamente incompleto

En un Postgres administrado —Cloud SQL, RDS y demás— no existe un superusuario que se
pueda otorgar, por lo que el rol con el que se conecta no suele ser propietario de ninguna de sus tablas y
no tiene `BYPASSRLS`. La seguridad a nivel de fila se le aplica, y `pg_dump` lo rechaza:

```
pg_dump: error: query failed: ERROR: query would be affected by row-level
security policy for table "company_leads"
```

Ese rechazo es el resultado seguro. Añadir `--enable-row-security` a `pg_dump`
manualmente es lo peligroso: tiene éxito, termina con código 0 y el dump contiene silenciosamente
solo las filas que admiten las políticas del rol que realiza el dump. Dos soluciones reales:

1. **Otorgue al rol que realiza el dump `BYPASSRLS`, o conviértalo en el propietario de las tablas.** El
   dump contendrá entonces todas las filas.

   ```sql
   ALTER ROLE my_backup_role BYPASSRLS;
   ```

2. **`rebase db backup --enable-row-security`.** Rebase establece `app.uid` y
   `app.user_roles` para que la política generada `admin_full_access` admita el
   dump, y muestra una advertencia indicando lo que ha sacrificado: una tabla cuyas
   políticas no incluyan una regla de administrador resultará incompleta, sin que nada avise de ello.

## Restauración

```bash
rebase db restore <backup> [--target-db <name>] [--create-db] [--clean] [--yes]
```

`restore` ejecuta `pg_restore` y es destructivo, por lo que nunca es automático:
sin `--yes` solicita una confirmación interactiva con `yes`, y en una
shell no interactiva se detiene e indica que se debe pasar `--yes`. `<backup>` es un archivo `.dump` local o una clave `s3://…` / `gs://…`,
que se descarga primero.

En una base de datos
que ya contiene lo que la copia de seguridad crea, necesita `--clean`: sin ello,
la operación es rechazada antes de ejecutar nada, indicando los esquemas y tablas en conflicto, y
avisa de que se debe pasar `--clean` o restaurar en una base de datos nueva con
`--create-db --target-db <name>`. Rechaza la
base de datos de desarrollo administrada, que no puede aceptar los datos COPY de un dump; en su lugar,
restaure en Postgres en Docker con `--docker`.

Con `--clean`,
la restauración reemplaza lo que contiene la copia de seguridad en una sola transacción. Elimina cada
esquema que la copia crea por completo (por ejemplo, `rebase`), y cada tabla que la copia
crea en un esquema que no le pertenece (`public`), con `CASCADE`, y luego restaura el
dump dentro de la misma transacción. Antes de pedir confirmación, enumera qué elementos se eliminarán que la
copia de seguridad no contiene, como `rebase.atlas_schema_revisions` de
`rebase db migrate`, una función, tipo o secuencia en un esquema reemplazado, o una
vista o clave foránea en otra parte que haga referencia a una de las tablas de la copia. Una restauración que se detenga en cualquier punto se revierte y se indica
que la base de datos conserva lo que tenía antes. Ejecuta el dump a través de `psql`, que
se incluye con `pg_restore` (`PSQL_PATH` permite indicar otro), y espera un máximo de
15 segundos por un bloqueo, que un `rebase dev` en ejecución podría retener.
`--continue-on-error` aún ejecuta el propio `--clean` de pg_restore.

Antes de restaurar, recrea los roles del clúster a partir del archivo
`.globals.sql` de la copia de seguridad —si un rol ya existe, se omite en lugar de dar error—, de modo que los
permisos y políticas del dump puedan aplicarse. Luego se detiene ante el primer error (`--exit-on-error`,
o `ON_ERROR_STOP` bajo `--clean`): una restauración que
registrara un `GRANT` fallido y continuara reportaría éxito sin que la
seguridad a nivel de fila estuviera aplicada. Sin un archivo `.globals.sql` junto a la copia de seguridad, advierte
que podrían faltar roles.

| Opción | Descripción |
| --- | --- |
| `--target-db <name>` | Restaurar en esta base de datos en lugar de la especificada en `DATABASE_URL`. |
| `--create-db` | Crear primero la base de datos de destino si no existe. |
| `--clean` | Reemplazar lo que contiene la copia de seguridad en una única transacción con la restauración: sus esquemas por completo y sus tablas en otros esquemas. Informa primero qué elementos se eliminarán además de la copia. |
| `--no-owner` | Ignorar la propiedad registrada en el dump. |
| `--continue-on-error` | Registrar y continuar tras los errores. **Puede dejar RLS sin aplicar**; úselo solo si sabe el motivo. |
| `--yes`, `-y` | Omitir la confirmación. |

El procedimiento seguro consiste en restaurar junto a la base de datos activa, verificarla y
solo entonces migrar la aplicación:

1. `rebase db restore <backup> --create-db --target-db app_restored`
2. Apunte un proceso temporal (o `psql`) a `app_restored` y verifique el recuento de filas,
   un inicio de sesión y las tablas más importantes.
3. Vuelva a apuntar `DATABASE_URL` a esta o renombre las bases de datos durante una breve
   ventana de mantenimiento.
4. Restaure sus archivos subidos desde su propia copia de seguridad, lo más cerca posible del mismo punto en el tiempo.

## El panel Backups

El panel **Backups** de Studio, en el grupo *Database*, lista las copias de seguridad en
`BACKUP_DESTINATION`, las más recientes primero, con su hora (y su tamaño, para un destino
local). **Download**
descarga el dump; **Roles file** descarga su `.globals.sql`. Descargue ambos y
manténgalos en el mismo directorio. Una copia de seguridad marcada como **No roles file** no tiene archivo complementario:
vuelva a crear sus roles manualmente antes de restaurarla en un nuevo Postgres.

Encima de la lista, el panel informa sobre la tarea de copia de seguridad programada y su última ejecución. Una ejecución fallida se muestra como un
error con su mensaje, de modo que una copia de seguridad nocturna que no pueda ejecutarse sea visible donde
se listan las copias de seguridad, no solo en el panel Tareas programadas.

Lo que indica sobre la tarea:

- **Last scheduled backup** es la última ejecución que realizó la programación. Una ejecución iniciada
  manualmente desde entonces (**Run Now** en Tareas programadas) obtiene una línea propia, de modo que una
  ejecución de prueba exitosa no pueda ocultar una nocturna fallida, y una que haya fallado no se
  reporte como la nocturna.
- Un trabajo declarado con `enabled: false` se interpreta como que las copias de seguridad programadas están **desactivadas**.
  Eso es lo que exporta el archivo cron anterior mientras `BACKUP_SCHEDULE` no esté definido, y
  configurar `BACKUP_SCHEDULE` las activa. **Paused** significa que un administrador pausó la
  tarea en Tareas programadas, y reanudarla allí la vuelve a activar.
- Un trabajo que el programador haya rechazado por un horario, zona horaria o tiempo de espera no válido,
  se reporta con el motivo. Nunca se ejecutará hasta que se corrija su archivo cron.
- Cuando el historial de ejecuciones en `rebase.cron_logs` no se puede leer, el panel lo
  indica así, en lugar de señalar que la copia de seguridad aún no se ha ejecutado.

La lista la lee el proceso del servidor que responde a `GET /api/admin/backups`,
y ese no siempre es el proceso que ejecuta la programación:

- Un destino `s3://` se lista y se descarga a través de un cliente para ese
  bucket, configurado a partir de las mismas variables `S3_*` que utiliza el cron de copia de seguridad. Un destino `gs://`
  utiliza las credenciales predeterminadas de la aplicación. Proporciónelas a **cada** proceso que
  atienda `/api/admin`, incluido el rol `api` de un
  [despliegue dividido](/docs/deployment/split-processes/), no solo al
  que ejecuta el cron. Un destino que el proceso no pueda leer responde `503`
  con el destino y el motivo, y el panel muestra eso en lugar de una
  lista vacía.
- Una ruta local corresponde al propio disco de ese proceso. Cuando la programación se ejecuta en otro
  proceso (un `api` con `REBASE_CRON_SCHEDULER=false` junto a un `worker`), el
  panel indica que está listando el disco de este proceso: las copias de seguridad programadas solo
  aparecerán allí si ambos procesos montan el mismo directorio. Un despliegue dividido
  debería realizar las copias de seguridad en almacenamiento de objetos.

Las descargas se transmiten mediante streaming a través de `GET /api/admin/backups/download?key=…`, solo para administradores,
por lo que el bucket nunca necesita ser público; cualquier clave fuera del prefijo de destino será
rechazada. Si `BACKUP_DESTINATION` no está configurado, el panel indica que las copias de seguridad no están
configuradas.

### Descargar una copia de seguridad

Un navegador no puede
incluir un encabezado `Authorization` en una descarga, por lo que Studio y el SDK solicitan un
enlace primero. `POST /api/admin/backups/download-url` con `{ "key": "…" }` (con el mismo
alcance de administrador y comprobaciones de clave que la descarga) responde
`{ url, token, expiresIn }`: una URL cuyo token sustituye al encabezado, para
esa copia de seguridad en el destino actual, durante 60 segundos. El token es
rechazado en cualquier otro lugar —como sesión, como token de descarga de almacenamiento o para otra
copia de seguridad— y una vez que expira. A continuación, el navegador transmite el dump por streaming directamente al
disco, por lo que una copia de seguridad del tamaño de su base de datos nunca tiene que caber en la memoria de una pestaña.

```ts
// In a browser: the browser saves the file.
await client.backups.download(key);

// Anywhere: a link that needs no header, for 60 seconds.
const { url } = await client.backups.downloadUrl(key);

// In Node: stream the bytes to a file.
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const { stream, name } = await client.backups.stream(key);
await pipeline(Readable.fromWeb(stream), createWriteStream(name));
```

`backups.download(key)` guarda el archivo en un navegador y lanza un error en otros entornos; use `stream(key)`
en Node. Frente a un servidor sin enlaces de descarga (uno anterior a la versión 0.25, o uno
sin secreto JWT para firmarlos), `download()` recurre a leer los bytes
directamente.

## Mantenga las copias de seguridad privadas

Una copia de seguridad contiene todos sus datos, incluidas credenciales y datos personales.

- Nunca use un bucket público. Mantenga su acceso privado y regístrelo.
- Active el cifrado en reposo: cifrado en el lado del servidor de S3, cifrado predeterminado
  de GCS o cifrado de disco para un directorio local.
- Restrinja quién puede leer la ubicación de las copias de seguridad y rote sus credenciales.
- Prefiera un bucket propio, separado de las subidas de los usuarios.

## Recuperación a un punto en el tiempo

Una copia de seguridad con `pg_dump` restaura al momento exacto en que se ejecutó el dump.
Recuperar a cualquier segundo intermedio requiere archivado de WAL y copias de seguridad base,
algo que la distribución de código abierto no ejecuta por usted. Si lo necesita de forma autoalojada, ejecute `pgBackRest`
o `wal-g` junto a su Postgres y conserve estos dumps como una segunda copia portátil.
