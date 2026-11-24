---
sourceHash: 3e9a0fde0de12d46
title: Una aplicación en ejecución
sidebar_label: Una aplicación en ejecución
description: Comandos de la CLI que actúan sobre una aplicación de Rebase en ejecución a través de su API — filas, usuarios, cron, logs, funciones, archivos, el simulador de RLS — en rebase dev, un servidor que indiques o un proyecto de Rebase Cloud.
---

Estos comandos se comunican con una aplicación en ejecución a través de su propia API, por lo que la seguridad a nivel de fila (RLS), el acceso a campos, los hooks y las políticas de almacenamiento deciden qué pueden hacer, al igual que lo hacen para el SDK. Se conectan al `rebase dev` local, a un servidor que indiques o a un proyecto de Rebase Cloud, con los mismos flags en todas partes.

## Elección del servidor y la credencial

| Flag | A dónde van las peticiones y con qué identidad |
|---|---|
| *(ninguno)* | `REBASE_BASE_URL` (shell, luego `.env`), o bien el `rebase dev` que este checkout esté ejecutando; con la clave de servicio de `.env` |
| `--url <server>` | Dicho servidor, con la clave de servicio de `.env` |
| `--project <slug>` | Un proyecto de Rebase Cloud, a través del proxy de Studio de la consola: inicias sesión con `rebase cloud login` y el plano de control adjunta la clave de la aplicación por su lado, por lo que ninguna clave llega a tu máquina. Propietarios y administradores de la organización, en un proyecto cuyo acceso a Studio esté habilitado (`rebase cloud settings set --studio on`) |
| `--cloud` | El proyecto de Rebase Cloud al que está vinculado este directorio |
| `--token <bearer>` | Envía este bearer en su lugar: una clave `rk_` o un token de acceso de usuario. En un proyecto de Cloud, va a la propia dirección de la aplicación |
| `--session` | Envía la sesión personal que `rebase auth login` almacenó para ese servidor |
| `--anon` | No envía nada: lo que recibe un visitante |

No se adivina nada más: sin `REBASE_BASE_URL` y sin un `rebase dev` en ejecución, el comando se rechaza en lugar de enviar la clave de servicio a lo que sea que esté escuchando en un puerto. El `rebase dev` en ejecución es aquel cuyo proceso está activo, en el puerto anunciado por su backend (`.rebase/dev.json`, o bien el `.rebase/state.json` del propio backend); `.rebase-dev-url` es para tus scripts, y una ejecución interrumpida lo deja atrás, por lo que ningún comando lo lee. Cada comando admite `--json` (y genera JSON siempre que stdout no sea un terminal, al igual que `rebase cloud`) y `--yes`, que responde afirmativamente a la confirmación que solicita cada comando destructivo; sin un terminal, se rechaza con `confirmation_required` en lugar de solicitar confirmación.

`rebase api-keys`, `rebase storage orphans|move` y `rebase schema reconcile` aceptan los mismos flags.

## `rebase api`

Cualquier ruta que sirva la aplicación, con la credencial del proyecto: la cola larga que no tiene un comando propio: la actualización de una vista materializada, la auditoría de RLS, `/api/meta/contract`, una ruta añadida por un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Una ruta sin una `/` inicial se encuentra bajo `/api`. `-f key=value` es un campo de tipo string y `-F` uno tipado (`true`, `false`, `null`, números, JSON, `@file`); los campos conforman la query string en una petición GET, HEAD o DELETE, y un cuerpo JSON en caso contrario. A diferencia de `gh api`, un campo por sí solo nunca convierte la petición en un POST: una escritura especifica su método o incluye `--input`. La respuesta se imprime tal como se recibió (JSON formateado) y una respuesta que no sea 2xx se imprime y finaliza con código 1. Se rechaza una cabecera `Authorization`; los flags de destino eligen la credencial.

## `rebase data`

Las filas de una tabla, a través de `/api/data`. Los filtros son los propios de la API (`?status=eq.published`), pasados tal como están escritos: `--where status=eq.published`, `--where price=gte.10`, y un simple `--where status=draft` para igualdad.

```bash
rebase data query posts --where status=eq.published --order-by created_at:desc -n 10
rebase data query orders --all --format csv > orders.csv
rebase data get posts 42 --include author
rebase data count posts --where status=eq.draft
rebase data aggregate orders --select "count(),sum(total)" --group-by status
rebase data insert posts --data '{"title":"Hello"}'
rebase data update posts 42 --data '{"title":"Renamed"}'
rebase data delete posts --where status=eq.draft --yes
rebase data import posts --file seed.csv --upsert slug
rebase data history posts 42 && rebase data revert posts 42 <historyId>
rebase data watch posts --where status=eq.published
```

| Acción | Notas |
|---|---|
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (repetible), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` recorre cada página; `--format table\|json\|ndjson\|csv` (csv y ndjson transmiten en streaming con `--all`) |
| `get <table> <id>` | Una fila, con `--fields` e `--include` |
| `count <table>` | Las filas que coinciden con `--where` |
| `aggregate <table>` | `--select` y `--group-by`, los propios de la API |
| `insert <table>` | `--data <json>` o `--file <path\|->`; un array representa varias filas en una sola escritura masiva; `--upsert <column>` |
| `update <table> [<id>]` | Una fila, o todas las filas que coincidan con `--where` tras un conteo y una confirmación; `--if-match <etag>` |
| `delete <table> [<id>]` | Solicita confirmación primero; `--hard` en una tabla con soft-delete |
| `import <table>` | `--file` (array JSON, NDJSON o CSV por extensión, o `--format`), en lotes (`--batch`); `--upsert`, `--ignore-duplicates`. Lo que `query --format json` escribe, este lo puede leer |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tablas con el historial habilitado |
| `watch <table>` | Las filas coincidentes cada vez que cambian, a través del socket en tiempo real. No a través del proxy de Studio: en un proyecto de Cloud pasa `--token` o `--session` |

La clave de servicio equivale al rol `admin`: la seguridad a nivel de fila se sigue ejecutando, bajo ese rol. Pasa `--token`, `--session` o `--anon` para ver la tabla como lo haría otra persona.

## `rebase schema show`

Las tablas, o las columnas, relaciones y seguridad a nivel de fila de una tabla: desde `backend/schema` por defecto, o con `--remote` (o cualquier flag de destino) según las describe el servidor en ejecución a esta credencial. Una credencial sin `schema:read` no ve ninguna política, y no se listará una tabla que no pueda leer.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Las cuentas, a través de `/api/admin/users`, `/roles` y `/guests`. Se hace referencia a una cuenta por su uid o su email (una coincidencia exacta, nunca la primera coincidencia aproximada).

```bash
rebase users list --search ada
rebase users create ada@example.com --role admin
rebase users import users.csv --dry-run
rebase users update bob@example.com --add-role editor
rebase users update bob@example.com --disable
rebase users reset-password bob@example.com
rebase users mfa-reset bob@example.com
rebase users roles
rebase users guests prune --older-than 30d --yes
```

`create` envía una invitación por correo electrónico, o devuelve una contraseña temporal una única vez si no se puede enviar correo. `--no-invite` crea la cuenta sin contraseña y no envía nada, pensado para una aplicación que inicia sesión mediante magic link, código por correo o un proveedor (`POST /api/admin/users` con `invite: false`). La asignación de roles, `--disable`, `delete` y `mfa-reset` solicitan confirmación previa. Ningún emisor puede otorgar un rol superior al suyo ni actuar sobre una cuenta de mayor rango. `rebase auth reset-password` es la sintaxis anterior, y todavía recurre a la base de datos si el servidor no está en ejecución.

### Importar cuentas

`import` traslada cuentas desde otro sistema conservando sus IDs, de modo que las filas que apuntan a un usuario sigan apuntando al mismo. Admite un archivo CSV, un array JSON o NDJSON (`--format`, o determinado por la extensión), con estas columnas:

| Columna | |
|---|---|
| `id` | Se conserva como el ID de la cuenta. Opcional: si falta, la tabla de usuarios genera uno. El caso habitual es un uuid; también se admiten letras, dígitos y `_ - . : \|` hasta 128 caracteres, aunque una columna de id de tipo `uuid` solo acepta uuids |
| `email` | Requerido |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Cuándo se creó la cuenta en el sistema de origen. Opcional: ahora |
| `email_verified` / `emailVerified` | `true`/`t`/`1` o `false`/`f`/`0`. Opcional: `false`, y el primer magic link o restablecimiento que siga la cuenta la confirma |
| `roles` | `editor;viewer`, entre comillas `"editor,viewer"`, o un array de Postgres `{editor,viewer}` |
| `password_hash` / `encrypted_password` | El hash que almacenó el otro sistema. Se lee únicamente con `--password-hashes bcrypt`; sin este flag, un archivo que contenga esta columna se rechazará antes de enviar nada |

No se envía ningún correo. Con `--password-hashes bcrypt`, una cuenta cuya fila tenga un hash inicia sesión con la contraseña que tenía, y en su primer inicio de sesión se reemplaza el hash por el propio de Rebase. Cualquier otra cuenta importada inicia sesión mediante magic link, código por correo, un proveedor o un restablecimiento de contraseña. Nunca se importa una contraseña en texto plano. Una cuenta cuyo ID o email ya esté en uso se reporta como omitida y se deja tal cual, sin actualizarse nunca, de modo que el archivo se pueda volver a ejecutar. Cada cuenta se reporta como creada, omitida o fallida junto con el motivo; el comando sale con código 1 si alguna falla. `--dry-run` comprueba cada cuenta sin escribir nada. La CLI envía 100 cuentas por petición (`POST /api/admin/users/import`), tanto en `rebase dev`, un servidor o un proyecto de Rebase Cloud.

Desde Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt --project my-app
```

`users.csv` contendrá entonces el hash de contraseña de cada cuenta: elimínalo una vez completada la importación.

## `rebase cron`

Las tareas programadas de la aplicación (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` y `disable` anulan el código de la tarea en cada proceso, a través de nuevos despliegues; `run` solicita confirmación primero, y `--async` responde en cuanto la ejecución ha comenzado. En un proyecto de Cloud, `rebase cron` no requiere acceso a Studio para lecturas: solicita al plano de control un token de plataforma `cron:read` de corta duración, que posee cualquier miembro con acceso a logs. `run`, `enable`, `disable` y `reset` requieren `cron:write`, el cual posee un propietario o administrador de la organización en un proyecto con Studio activado. `rebase cloud cron` es la sintaxis anterior, de solo lectura.

## `rebase logs`

El log de peticiones y de aplicación del servidor (el búfer que lee la vista Logs de Studio), una sola vez o seguido en tiempo real con `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

El búfer pertenece a un único proceso. Con `--project` o `--cloud`, esto equivale a `rebase cloud logs --runtime`: la salida de cada réplica, a través del plano de control.

## `rebase functions`

Las rutas propias de la aplicación, una por cada archivo en `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` admite los mismos campos, cuerpo y cabeceras que `rebase api`, e imprime la respuesta tal como se recibió. Las funciones deciden su propio acceso, por lo que la credencial importa: `--anon` muestra lo que obtiene un visitante.

## `rebase storage`

Archivos almacenados, a través de las políticas de almacenamiento. La referencia en el almacenamiento comienza con dos puntos: `:avatars/me.png` en el origen predeterminado, `media:avatars/me.png` en el origen denominado `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` sube bajo el prefijo público (una URL permanente sin token), `--content-type` define el tipo y `--force` sobrescribe un archivo local al descargar. `orphans` y `move` son la parte del grupo orientada al mantenimiento de todo el almacenamiento.

## `rebase rls simulate`

Lo que vería otra identidad, desde el simulador de RLS de la aplicación (el que utiliza la opción "view as" de Studio): por tabla, las filas que lee en comparación con las filas que tú lees, las tablas de las que sus scopes la excluyen y las columnas que no puede leer. Solo lectura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

El simulador responde a la propia sesión de un administrador y nunca a una clave, por lo que esto envía la sesión que `rebase auth login` almacenó. `rebase verify --live` comprueba las políticas en sí mismas, sin considerar ninguna identidad específica.

## `rebase auth login`, `emails` y `keys`

Algunas rutas responden a una persona y nunca a una máquina: el simulador de RLS, claves personales, aplicación de esquemas en vivo (`live schema apply`). `rebase auth login` inicia sesión en una aplicación en ejecución (a través del navegador cuando el servidor ofrece inicio de sesión de dispositivo, o bien con `--email` y una contraseña, usando `--code` para un segundo factor) y guarda la sesión en `~/.rebase/sessions.json`, por servidor, nunca en el proyecto. `auth whoami` indica quién considera el servidor que eres y los scopes que posees; `auth logout` finaliza la sesión allí también.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` lee el buzón de desarrollo que un servidor sin `SMTP_HOST` mantiene en lugar de enviar correos; `--clear` lo vacía. Un buzón vacío responde indicando el servidor consultado (`The development mailbox at http://localhost:3082 (rebase dev) is empty.` y `server` en el JSON), ya que una respuesta vacía de otro backend se interpreta exactamente igual que un correo que nunca se envió. `auth keys` gestiona tus propias claves `rk_`, que actúan en tu nombre, limitadas a los scopes indicados; el servidor solo responde si la tabla de autenticación define `auth.personalKeys: true`. Las claves de servicio se gestionan con `rebase api-keys`, que también incorporó `update <id>`.

## Próximos pasos

- [Índice de endpoints](/docs/backend/endpoints/) — cada ruta a la que llegan estos comandos y el scope que requiere cada una
- [REST API](/docs/backend/api/) — la sintaxis de filtrado, ordenación y paginación que `rebase data` transmite
- [rebase cloud](/docs/cli/cloud/) — el proyecto en sí en Rebase Cloud: despliegues, variables de entorno, copias de seguridad, acceso a Studio
- [Referencia de la CLI](/docs/cli/) — todos los demás comandos
