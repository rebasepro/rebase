---
sourceHash: 02c94e203b545b2c
title: Copias de seguridad y restauración
sidebar_label: Copias de seguridad
description: Crea, programa, lista y restaura copias de seguridad de la base de datos con pg_dump — qué contiene una copia de seguridad, el archivo de roles que la acompaña, y lo único que no cubre, tus archivos subidos.
---

## Descripción general

Rebase respalda una base de datos Postgres con `pg_dump` y la restaura con
`pg_restore`. Puedes crear una copia de seguridad a mano, programar una con un
cron job, listar las que tienes desde la CLI o el panel **Copias de
seguridad** de Studio, y restaurar en una base de datos nueva sin tocar la que
está en producción.

:::caution[Esto no respalda tus archivos]
Una copia de seguridad contiene la **base de datos** y nada más. Los archivos
subidos viven en tu [backend de almacenamiento](/docs/backend/storage/) — un
bucket de S3 o GCS, o el directorio en `STORAGE_PATH` — no en Postgres, así
que una base de datos restaurada apunta a archivos que solo ese backend tiene.
Respalda el bucket (con versionado o replicación) o el directorio de subidas
por separado, con su propia programación.
:::

## Inicio rápido

```bash
# Back up to a local directory (custom format, compressed)
rebase db backup --out ./backups

# Back up straight to private object storage
rebase db backup --out s3://my-private-bucket/backups

# List what you have
rebase db backups list --out ./backups

# Restore into a FRESH database (does not touch the live one)
rebase db restore ./backups/rebase-app-20260714T030000Z.dump \
  --create-db --target-db app_restored
```

La cadena de conexión proviene del entorno de tu proyecto, como en cualquier
otro comando [`rebase db`](/docs/cli/): `DATABASE_URL`, recurriendo a
`ADMIN_CONNECTION_STRING` si falta.

## Qué es una copia de seguridad

`rebase db backup` ejecuta `pg_dump` en formato personalizado (`-Fc`), que está
comprimido y puede restaurarse de forma selectiva. Los archivos se llaman
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump`; la marca de tiempo UTC en el nombre es
lo que usan la retención y el listado para ordenar.

| Opción | Descripción |
| --- | --- |
| `--out`, `-o` | Una ruta local, o una URL `s3://bucket/prefix` / `gs://bucket/prefix`. Por defecto usa `$BACKUP_DESTINATION`, y luego `./backups`. |
| `--exclude-schema <s>` | Omite un esquema del dump (repetible). Nunca omitas `rebase` — ver más abajo. |
| `--no-owner` | Omite las instrucciones de propiedad, para restaurar como un rol distinto. |
| `--enable-row-security` | Vuelca los datos como sujeto administrador en lugar de fallar por la seguridad a nivel de fila. **Puede producir un dump parcial** — consulta [Seguridad a nivel de fila](#seguridad-a-nivel-de-fila-y-el-dump-que-queda-corto-en-silencio). |
| `--row-security-role <r>` | El rol con el que leer al usar la opción anterior. Por defecto, `admin`. |

Un dump se valida antes de que el comando reporte éxito: `pg_restore --list`
debe ser capaz de leer el archivo completo.

Para destinos `s3://`, la CLI construye su cliente de almacenamiento a partir
de las mismas variables `S3_*` que usa tu backend (`S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`).

### El archivo de roles

Cada copia de seguridad escribe un segundo archivo junto al dump:
`rebase-<db>-<…>Z.globals.sql`, producido por
`pg_dumpall --globals-only --no-role-passwords`. Un `pg_dump` por base de datos
no puede incluir los roles de todo el clúster, y los grants y las políticas de
seguridad a nivel de fila del dump nombran uno — `rebase_user`. Restaurado en
un Postgres nuevo sin él, el primer `GRANT` a ese rol falla y la restauración
se detiene.

Mantén los dos archivos juntos. La CLI los sube, lista, poda y restaura como
un par, y `rebase db restore` busca el `.globals.sql` en el mismo directorio o
prefijo que el `.dump`. Los roles se recrean **sin contraseñas**; vuelve a
definirlas después de restaurar en un clúster nuevo. `PG_DUMPALL_PATH` apunta
a un binario `pg_dumpall` específico.

### Qué contiene

Toda la base de datos, incluido el esquema `rebase`. Ese esquema contiene toda
cuenta de usuario y el resto de la autenticación, las claves de API, el
historial de registros, la cola de trabajos, los logs de cron y las funciones
que llaman tus políticas de RLS y los triggers de captura de cambios. Un dump
sin él no tiene usuarios, y no se puede restaurar en una base de datos vacía
en absoluto: las tablas que sí contiene tienen políticas que llaman a
funciones que no están.

## Copias de seguridad programadas

Una copia de seguridad programada es un [cron job](/docs/backend/cron-jobs/)
que vuelca la base de datos, sube el resultado a `BACKUP_DESTINATION` y
elimina las copias antiguas. Coloca un archivo en `backend/crons/` que
exporte uno por defecto:

```ts
// backend/crons/backup.ts
import { GCSStorageController, S3StorageController, type StorageController } from "@rebasepro/server";
import { createBackupCron, backupCronConfigFromEnv } from "@rebasepro/server-postgres";

const resolved = backupCronConfigFromEnv(process.env);
if (resolved.error) throw new Error(resolved.error);

function backupStorage(): StorageController | undefined {
    const destination = resolved.config?.destination;
    if (destination?.kind === "gcs") {
        return new GCSStorageController({ type: "gcs", bucket: destination.bucket });
    }
    if (destination?.kind !== "s3") return undefined; // local: written to disk directly
    return new S3StorageController({
        type: "s3",
        bucket: destination.bucket,
        region: process.env.S3_REGION || "auto",
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true"
    });
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

El controlador de almacenamiento se pasa explícitamente en lugar de tomarse
del contexto de la tarea, porque el `rebase.storage` del contexto es la API de
almacenamiento del lado del cliente, no un controlador para el bucket de
copias de seguridad.

| Variable | Significado |
| --- | --- |
| `BACKUP_SCHEDULE` | Expresión cron, p. ej. `0 3 * * *` para las 03:00 cada día. Sin definir desactiva las copias de seguridad programadas. |
| `BACKUP_DESTINATION` | Una ruta local, o `s3://bucket/prefix` / `gs://bucket/prefix`. |
| `BACKUP_RETENTION_DAYS` | Elimina las copias de seguridad más antiguas que este número de días. Sin definir o `0` lo conserva todo. |
| `BACKUP_KEEP_MINIMUM` | Conserva siempre al menos este número de copias recientes, sin importar su antigüedad — así una interrupción larga no elimina todo. |

Cada dump nuevo se valida **antes** de eliminar nada, así que un dump corrupto
nunca puede ser la razón de que se elimine tu última copia buena. La
eliminación solo afecta a los archivos cuyo nombre coincide con el patrón de
copia de seguridad; cualquier otra cosa que comparta el bucket o el prefijo
se deja intacta.

El cron ejecuta `pg_dump` dentro del proceso del servidor.
<span class="since-badge" data-since="0.24">Desde 0.24</span> la imagen oficial
del runtime (`rebasepro/server`, consulta [Autoalojamiento](/docs/deployment/self-hosting/))
incluye las herramientas de cliente de PostgreSQL 18 para esto;
en la 0.23 y anteriores no tenía ninguna, y cada ejecución programada fallaba
con `Could not find the 'pg_dump' binary`. En cualquier otro lugar — un VPS, tu
propia imagen — instala las herramientas de cliente tú mismo (consulta la
siguiente sección).

## Compatibilidad de versiones

`pg_dump` y `pg_restore` deben ser de la **misma versión mayor que el
servidor, o más nuevos**. Cada comando comprueba primero la versión mayor del
cliente contra el `server_version_num` del servidor en producción y se detiene
con la solución si no coinciden, o si falta el binario:

```
✗ Client tool is Postgres 15 but the server is Postgres 16. pg_dump/pg_restore
  must be the same major version as the server or newer. Install Postgres 16
  client tools.
```

Instálalas con `brew install libpq` o `apt-get install postgresql-client-18`
(desde el repositorio apt de PostgreSQL, donde la versión propia de Debian es
más antigua), o apunta a un binario específico con `PG_DUMP_PATH`,
`PG_RESTORE_PATH` y `PG_DUMPALL_PATH`.

## Seguridad a nivel de fila, y el dump que queda corto en silencio

En un Postgres administrado — Cloud SQL, RDS y el resto — no hay ningún
superusuario disponible para conceder, así que el rol con el que te conectas
normalmente no es dueño de ninguna de tus tablas y no tiene `BYPASSRLS`. La
seguridad a nivel de fila se le aplica, y `pg_dump` se niega:

```
pg_dump: error: query failed: ERROR: query would be affected by row-level
security policy for table "company_leads"
```

Ese rechazo es el resultado seguro. Añadir `--enable-row-security` a `pg_dump`
a mano es el peligroso: tiene éxito, sale con código 0, y el dump contiene en
silencio solo las filas que admiten las políticas del rol que lo ejecuta. Dos
formas reales de evitarlo:

1. **Concede al rol que hace el dump `BYPASSRLS`, o hazlo propietario de las
   tablas.** El dump entonces contiene todas las filas.

   ```sql
   ALTER ROLE my_backup_role BYPASSRLS;
   ```

2. **`rebase db backup --enable-row-security`.** Rebase define `app.uid` y
   `app.user_roles` para que la política `admin_full_access` generada admita
   el dump, e imprime una advertencia indicando lo que has sacrificado: una
   tabla cuyas políticas no incluyen ninguna regla de administrador sale
   incompleta, y nada lo indica.

## Restauración

```bash
rebase db restore <backup> [--target-db <name>] [--create-db] [--clean] [--yes]
```

`restore` ejecuta `pg_restore`, y es destructivo, así que nunca es automático:
sin `--yes` pide una confirmación interactiva («yes»), y en un shell no
interactivo se detiene. `<backup>` es un `.dump` local o una clave
`s3://…` / `gs://…`, que se descarga primero.

Antes de restaurar, recrea los roles del clúster a partir del `.globals.sql`
de la copia de seguridad — un rol existente se omite, no es un error —, para
que los grants y las políticas del dump se apliquen. Luego se ejecuta con
`--exit-on-error`: una restauración que registrara un `GRANT` fallido y
siguiera adelante reportaría éxito con la seguridad a nivel de fila sin
aplicar. Sin un `.globals.sql` junto a la copia de seguridad, avisa de que
podrían faltar roles.

| Opción | Descripción |
| --- | --- |
| `--target-db <name>` | Restaura en esta base de datos en lugar de la que indica `DATABASE_URL`. |
| `--create-db` | Crea primero la base de datos de destino si no existe. |
| `--clean` | Elimina los objetos existentes antes de recrearlos (`--clean --if-exists`). |
| `--no-owner` | Ignora la propiedad registrada en el dump. |
| `--continue-on-error` | Registra los errores y continúa. **Puede dejar la RLS sin aplicar**; úsalo solo cuando sepas por qué. |
| `--yes`, `-y` | Omite la confirmación. |

El procedimiento seguro es restaurar junto a la base de datos en producción,
comprobarla, y solo entonces mover la aplicación:

1. `rebase db restore <backup> --create-db --target-db app_restored`
2. Apunta un proceso de prueba (o `psql`) a `app_restored` y comprueba el
   recuento de filas, un inicio de sesión y las tablas que más te importan.
3. Redirige `DATABASE_URL` hacia ella, o renombra las bases de datos, durante
   una ventana de mantenimiento corta.
4. Restaura tus archivos subidos desde su propia copia de seguridad, lo más
   cerca posible del mismo punto en el tiempo.

## El panel de Copias de seguridad

El panel **Copias de seguridad** de Studio, en el grupo *Base de datos*, lista
las copias en `BACKUP_DESTINATION`, de más reciente a más antigua, con su
tamaño y hora. **Download** descarga el dump; **Roles file** descarga su
`.globals.sql`. Descarga ambos y guárdalos en un mismo directorio. Una copia
marcada **No roles file** no tiene archivo asociado: recrea sus roles a mano
antes de restaurarla en un Postgres nuevo.

<span class="since-badge" data-since="0.24">Desde 0.24</span> encima de la
lista se informa de la tarea de copia de seguridad programada y su última
ejecución. Una ejecución fallida se muestra como un error con su mensaje, así
que una copia de seguridad nocturna que no puede ejecutarse es visible donde
se listan las copias, no solo en el panel de Cron Jobs.

Las descargas se transmiten a través de `GET /api/admin/backups/download?key=…`,
solo para administradores, así que el bucket nunca tiene que ser público; una
clave fuera del prefijo del destino se rechaza. Con `BACKUP_DESTINATION` sin
definir, el panel indica que las copias de seguridad no están configuradas.

## Mantén las copias de seguridad privadas

Una copia de seguridad contiene todos tus datos, credenciales y datos
personales incluidos.

- Nunca uses un bucket público. Mantén su acceso privado y regístralo.
- Activa el cifrado en reposo: cifrado del lado del servidor de S3, cifrado
  por defecto de GCS, o cifrado de disco para un directorio local.
- Restringe quién puede leer la ubicación de la copia de seguridad, y rota sus
  credenciales.
- Prefiere un bucket propio, separado de las subidas de los usuarios.

## Recuperación a un punto en el tiempo (point-in-time recovery)

Una copia de seguridad con `pg_dump` restaura hasta el momento en que se
ejecutó el dump. Recuperar a cualquier segundo intermedio necesita archivado
de WAL y copias de seguridad base, que la distribución de código abierto no
ejecuta por ti. Si lo necesitas autoalojado, ejecuta `pgBackRest` o `wal-g`
junto a tu Postgres y conserva estos dumps como una segunda copia, portable.
