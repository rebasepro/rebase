---
sourceHash: 194ea0c912d942b7
title: Una aplicación en ejecución
sidebar_label: Una aplicación en ejecución
description: Comandos de la CLI que actúan sobre una aplicación de Rebase en ejecución a través de su API — filas, usuarios, cron, logs, funciones, archivos, el simulador de RLS — en rebase dev, un servidor que especifiques o un proyecto de Rebase Cloud.
---

Estos comandos se comunican con una aplicación en ejecución a través de su propia API, por lo que la seguridad a nivel de fila (row-level security), el acceso a campos, los hooks y las políticas de almacenamiento deciden qué pueden hacer, tal como lo hacen para el SDK. Se conectan al `rebase dev` local, a un servidor que especifiques o a un proyecto de Rebase Cloud, con los mismos flags en todas partes.

## Elección del servidor y la credencial

| Flag | A dónde van las solicitudes y como quién |
|---|---|
| *(ninguno)* | `REBASE_BASE_URL` (shell, luego `.env`), o bien el `rebase dev` que este checkout está ejecutando; con la clave de servicio de `.env` |
| `--url <server>` | Ese servidor, con la clave de servicio de `.env` |
| `--project <slug>` | Un proyecto de Rebase Cloud, a través del proxy de Studio de la consola: inicias sesión con `rebase cloud login` y el plano de control adjunta la clave de la aplicación de su lado, por lo que ninguna clave llega a tu máquina. Propietarios y administradores de la organización, en un proyecto cuyo acceso a Studio esté activado (`rebase cloud settings set --studio on`) |
| `--cloud` | El proyecto de Rebase Cloud al que está vinculado este directorio |
| `--token <bearer>` | Enviar este bearer en su lugar: una clave `rk_` o un token de acceso de usuario. En un proyecto de Cloud va a la propia dirección de la aplicación |
| `--session` | Enviar la sesión de usuario que `rebase auth login` almacenó para ese servidor |
| `--anon` | No enviar nada: lo que recibe un visitante |

No se asume nada más: sin `REBASE_BASE_URL` y sin un `rebase dev` en ejecución, un comando se negará en lugar de enviar la clave de servicio a lo que sea que esté escuchando en un puerto. El `rebase dev` en ejecución es aquel cuyo proceso está activo, en el puerto anunciado por su backend (`.rebase/dev.json`, o bien el propio `.rebase/state.json` del backend); `.rebase-dev-url` es para tus scripts, y una ejecución terminada lo deja atrás, por lo que ningún comando lo lee. Cada comando acepta `--json` (y devuelve JSON siempre que stdout no sea una terminal, como lo hace `rebase cloud`) y `--yes`, que responde a la confirmación que solicita cada comando destructivo; sin una terminal, se rechaza con `confirmation_required` en lugar de solicitar confirmación.

`rebase api-keys`, `rebase storage orphans|move` y `rebase schema reconcile` aceptan los mismos flags.

## `rebase api`

Cualquier ruta que sirva la aplicación, con la credencial del proyecto — la larga cola que no tiene un comando propio: la actualización de una vista materializada, la auditoría de RLS, `/api/meta/contract`, una ruta añadida por un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Una ruta sin una `/` inicial está bajo `/api`. `-f key=value` es un campo de cadena de texto y `-F` uno tipado (`true`, `false`, `null`, números, JSON, `@file`); los campos componen la query string de un GET, HEAD o DELETE, y un cuerpo JSON en caso contrario. A diferencia de `gh api`, un campo por sí solo nunca convierte la solicitud en un POST: una escritura especifica su método o incluye `--input`. La respuesta se imprime tal como vino — JSON con formato legible (pretty-printed) — y una respuesta que no sea 2xx se imprime y finaliza con código de salida 1. Se rechaza una cabecera `Authorization`; los flags de destino eligen la credencial.

## `rebase data`

Las filas de una tabla, a través de `/api/data`. Los filtros son los propios de la API (`?status=eq.published`), transferidos tal como se escriben: `--where status=eq.published`, `--where price=gte.10`, y un simple `--where status=draft` para igualdad.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (repetible), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` recorre todas las páginas; `--format table\|json\|ndjson\|csv` (csv y ndjson se transmiten por streaming con `--all`) |
| `get <table> <id>` | Una fila, con `--fields` e `--include` |
| `count <table>` | Las filas que coinciden con `--where` |
| `aggregate <table>` | `--select` y `--group-by`, los propios de la API |
| `insert <table>` | `--data <json>` o `--file <path\|->`; un array representa varias filas en una sola escritura masiva; `--upsert <column>` |
| `update <table> [<id>]` | Una fila, o cada fila que coincida con `--where` tras un conteo y una confirmación; `--if-match <etag>` |
| `delete <table> [<id>]` | Solicita confirmación primero; `--hard` en una tabla con soft-delete |
| `import <table>` | `--file` (array JSON, NDJSON o CSV según la extensión, o `--format`), por lotes (`--batch`); `--upsert`, `--ignore-duplicates`. Lo que escribe `query --format json` se puede volver a leer |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tablas con el historial activado |
| `watch <table>` | Las filas coincidentes cada vez que cambian, a través del socket de tiempo real. No a través del proxy de Studio: en un proyecto de Cloud, pasa `--token` o `--session` |

La clave de servicio corresponde al rol `admin`: la seguridad a nivel de fila se sigue ejecutando con ese rol. Pasa `--token`, `--session` o `--anon` para ver la tabla como lo haría otro usuario.

## `rebase schema show`

Las tablas, o las columnas, relaciones y seguridad a nivel de fila de una tabla — desde `backend/schema` por defecto, o con `--remote` (o cualquier flag de destino) tal como el servidor en ejecución las describe para esta credencial. Una credencial sin `schema:read` no ve ninguna política, y una tabla que no puede leer no se lista.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Las cuentas, a través de `/api/admin/users`, `/roles` y `/guests`. Se hace referencia a una cuenta por su uid o su correo electrónico (una coincidencia exacta, nunca la primera aproximada).

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

`create` envía una invitación por correo electrónico o responde con una contraseña temporal de un solo uso cuando no se puede enviar correo. `--no-invite` crea la cuenta sin contraseña y no envía nada, para una aplicación en la que se inicia sesión mediante magic link, código por correo electrónico o un proveedor (`POST /api/admin/users` con `invite: false`). Otorgar un rol, `--disable`, `delete` y `mfa-reset` solicitan confirmación previa. Ningún emisor puede otorgar un rol superior al suyo ni actuar sobre una cuenta de mayor rango. `rebase auth reset-password` es la variante anterior, y aún recurre a la base de datos cuando el servidor no está en ejecución.

### Importación de cuentas

`import` transfiere cuentas desde otro sistema y conserva sus ids, de modo que las filas que apuntan a un usuario sigan apuntando al mismo. Acepta un archivo CSV, un array JSON o NDJSON (`--format`, o la extensión en su defecto), con estas columnas:

| Columna | |
|---|---|
| `id` | Se conserva como el id de la cuenta. Opcional: sin él, la tabla de usuarios genera uno. Un uuid es el caso habitual; letras, dígitos y `_ - . : \|` de hasta 128 caracteres también son válidos, aunque una columna de id de tipo `uuid` solo acepta uuids |
| `email` | Requerido |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Cuándo se creó la cuenta allí. Opcional: ahora |
| `email_verified` / `emailVerified` | `true`/`t`/`1` o `false`/`f`/`0`. Opcional: `false`, y el primer magic link o restablecimiento que siga la cuenta la confirma |
| `roles` | `editor;viewer`, entre comillas `"editor,viewer"`, o un array de Postgres `{editor,viewer}` |

No se importan contraseñas ni hashes, y no se envía ningún correo electrónico: una cuenta importada inicia sesión mediante magic link, un código por correo, un proveedor o restablecimiento de contraseña. Si el id o correo de una cuenta ya está ocupado, se reporta como omitida y se deja como está, nunca se actualiza, lo que permite volver a ejecutar el archivo. Cada cuenta se reporta como creada, omitida o fallida junto con la razón; el comando finaliza con código de salida 1 si alguna falla. `--dry-run` comprueba todas las cuentas y no escribe nada. La CLI envía 100 cuentas por solicitud (`POST /api/admin/users/import`), tanto en `rebase dev`, un servidor o un proyecto de Rebase Cloud por igual.

Desde Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv --project my-app
```

## `rebase cron`

Las tareas programadas de la aplicación (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` y `disable` anulan el código de la tarea en cada proceso, a través de los redespliegues; `run` solicita confirmación primero, y `--async` responde una vez que la ejecución ha comenzado. En un proyecto de Cloud, `rebase cron` no necesita acceso a Studio para lecturas: solicita al plano de control un token de plataforma `cron:read` de corta duración, el cual posee cualquier miembro con acceso a logs. `run`, `enable`, `disable` y `reset` solicitan `cron:write`, que posee un propietario o administrador de la organización en un proyecto con Studio activado. `rebase cloud cron` es la variante anterior, de solo lectura.

## `rebase logs`

El registro (log) de solicitudes y de la aplicación del servidor — el búfer que lee el Logs Explorer de Studio — una sola vez, o seguido con `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

El búfer pertenece a un solo proceso. Con `--project` o `--cloud` esto equivale a `rebase cloud logs --runtime`: la salida de cada réplica, a través del plano de control.

## `rebase functions`

Las rutas propias de la aplicación, una por archivo en `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` acepta los campos, cuerpo y cabeceras que acepta `rebase api`, e imprime la respuesta tal como vino. Las funciones deciden su propio acceso, por lo que la credencial importa: `--anon` muestra lo que obtiene un visitante.

## `rebase storage`

Archivos almacenados, a través de las políticas de almacenamiento. La ruta almacenada comienza con dos puntos: `:avatars/me.png` en el origen predeterminado, `media:avatars/me.png` en el origen denominado `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` sube bajo el prefijo público (una URL permanente y sin token), `--content-type` define el tipo y `--force` sobrescribe un archivo local en la descarga. `orphans` y `move` constituyen la parte de mantenimiento de todo el almacenamiento del grupo.

## `rebase rls simulate`

Lo que vería otra identidad, desde el simulador de RLS de la aplicación — el mismo que utiliza la función "ver como" ("view as") de Studio: por tabla, las filas que lee frente a las filas que tú lees, las tablas de las que sus scopes lo excluyen y las columnas que no puede leer. Solo lectura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

El simulador responde a la propia sesión de un administrador y nunca a una clave, por lo que esto envía la sesión que `rebase auth login` almacenó. `rebase verify --live` comprueba las políticas en sí, sin tener en cuenta ninguna identidad.

## `rebase auth login`, `emails` y `keys`

Algunas rutas responden a una persona y nunca a una máquina: el simulador de RLS, claves personales, aplicación del esquema en vivo. `rebase auth login` inicia sesión en una aplicación en ejecución — a través del navegador cuando el servidor ofrece inicio de sesión de dispositivo, o bien con `--email` y una contraseña (`--code` para un segundo factor) — y guarda la sesión en `~/.rebase/sessions.json`, por servidor, nunca en el proyecto. `auth whoami` indica quién considera el servidor que eres y los scopes que posees; `auth logout` finaliza la sesión allí también.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` lee el buzón de correo de desarrollo que un servidor sin `SMTP_HOST` mantiene en lugar de enviar correos; `--clear` lo vacía. A un buzón vacío se le responde indicando el servidor consultado (`The development mailbox at http://localhost:3082 (rebase dev) is empty.`, y `server` en el JSON), ya que una respuesta vacía de otro backend se interpreta exactamente igual que un correo que nunca se envió. `auth keys` administra tus propias claves `rk_`, que actúan en tu nombre, restringidas a los scopes indicados; el servidor solo responde cuando la tabla de autenticación define `auth.personalKeys: true`. Las claves de servicio corresponden a `rebase api-keys`, que también incorporó `update <id>`.

## Próximos pasos

- [Índice de endpoints](/docs/backend/endpoints/) — cada ruta a la que llegan estos comandos y el scope que necesita cada una
- [API REST](/docs/backend/api/) — la sintaxis de filtrado, ordenamiento y paginación que `rebase data` transmite
- [rebase cloud](/docs/cli/cloud/) — el proyecto en sí en Rebase Cloud: despliegues, entorno, copias de seguridad, acceso a Studio
- [Referencia de la CLI](/docs/cli/) — todos los demás comandos
