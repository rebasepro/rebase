---
sourceHash: f6e7c705c409b9aa
title: Una app en ejecución
sidebar_label: Una app en ejecución
description: Comandos de CLI que actúan sobre una app de Rebase en ejecución a través de su API — filas, usuarios, cron, logs, funciones, archivos, el simulador de RLS — en rebase dev, un servidor que indiques o un proyecto de Rebase Cloud.
---

Estos comandos se comunican con una app en ejecución a través de su propia API, por lo que la seguridad a nivel de fila, el acceso a campos, los hooks y las directivas de almacenamiento deciden lo que pueden hacer, al igual que lo hacen para el SDK. Se conectan al `rebase dev` local, a un servidor que indiques o a un proyecto de Rebase Cloud, con los mismos flags en todas partes.

## Elegir el servidor y la credencial

| Flag | A dónde van las peticiones y como quién |
|---|---|
| *(ninguno)* | `REBASE_BASE_URL` (shell, luego `.env`), o el `rebase dev` que este checkout está ejecutando; con la clave de servicio de `.env` |
| `--url <server>` | Ese servidor, con la clave de servicio de `.env` |
| `--project <slug>` | Un proyecto de Rebase Cloud, a través del proxy de Studio de la consola: inicias sesión con `rebase cloud login`, y el plano de control adjunta la clave de la app de su lado, por lo que ninguna clave llega a tu máquina. Propietarios y administradores de la organización, en un proyecto cuyo acceso a Studio esté activado (`rebase cloud settings set --studio on`) |
| `--cloud` | El proyecto de Rebase Cloud al que está vinculado este directorio |
| `--token <bearer>` | Enviar este bearer en su lugar: una clave `rk_` o el token de acceso de un usuario. En un proyecto de Cloud, va a la propia dirección de la app |
| `--session` | Enviar la sesión de persona que `rebase auth login` almacenó para ese servidor |
| `--anon` | No enviar nada: lo que recibe un visitante |

No se adivina nada más: sin `REBASE_BASE_URL` y sin un `rebase dev` en ejecución, un comando se rechaza en lugar de enviar la clave de servicio a lo que sea que esté escuchando en un puerto. El `rebase dev` en ejecución es aquel cuyo proceso está activo, en el puerto anunciado por su backend (`.rebase/dev.json`, o el propio `.rebase/state.json` del backend); `.rebase-dev-url` es para tus scripts, y una ejecución cancelada lo deja atrás, por lo que ningún comando lo lee. Cada comando admite `--json` (y produce JSON siempre que stdout no sea un terminal, como ocurre con `rebase cloud`) y `--yes`, que responde a la confirmación requerida por cualquier comando destructivo; sin un terminal, se rechaza con `confirmation_required` en lugar de solicitar confirmación interactiva.

`rebase api-keys`, `rebase storage orphans|move` y `rebase schema reconcile` aceptan los mismos flags.

## `rebase api`

Cualquier ruta que sirva la app, con la credencial del proyecto — la larga cola de operaciones que no tienen un comando propio: la actualización de una vista materializada, la auditoría de RLS, `/api/meta/contract`, una ruta añadida por un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Una ruta sin una `/` inicial se encuentra bajo `/api`. `-f key=value` es un campo de texto (string) y `-F` uno tipado (`true`, `false`, `null`, números, JSON, `@file`); los campos componen la query string de un GET, HEAD o DELETE, y un cuerpo JSON en caso contrario. A diferencia de `gh api`, un campo por sí solo nunca convierte la petición en un POST: una escritura especifica su método o incluye `--input`. La respuesta se imprime tal como vino — con formato legible en JSON — y una respuesta que no sea 2xx se imprime y termina con código de salida 1. Se rechaza una cabecera `Authorization`; los flags de destino seleccionan la credencial.

## `rebase data`

Las filas de una tabla, a través de `/api/data`. Los filtros son los propios de la API (`?status=eq.published`), pasados tal como se escriben: `--where status=eq.published`, `--where price=gte.10`, y un simple `--where status=draft` para igualdad.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (repetible), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` recorre todas las páginas; `--format table\|json\|ndjson\|csv` (csv y ndjson transmiten en stream con `--all`) |
| `get <table> <id>` | Una fila, con `--fields` e `--include` |
| `count <table>` | Las filas que coinciden con `--where` |
| `aggregate <table>` | `--select` y `--group-by`, los propios de la API |
| `insert <table>` | `--data <json>` o `--file <path\|->`; un array representa varias filas en una sola escritura masiva; `--upsert <column>` |
| `update <table> [<id>]` | Una fila, o cada fila que coincida con `--where` tras un conteo y una confirmación; `--if-match <etag>` |
| `delete <table> [<id>]` | Pide confirmación primero; `--hard` en una tabla con soft-delete |
| `import <table>` | `--file` (array JSON, NDJSON o CSV según la extensión, o `--format`), por lotes (`--batch`); `--upsert`, `--ignore-duplicates`. Vuelve a leer lo que escribe `query --format json` |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tablas con el historial activado |
| `watch <table>` | Las filas coincidentes cada vez que cambian, a través del socket en tiempo real. No a través del proxy de Studio: en un proyecto Cloud pasa `--token` o `--session` |

La clave de servicio tiene el rol `admin`: la seguridad a nivel de fila se sigue aplicando, como ese rol. Pasa `--token`, `--session` o `--anon` para ver la tabla como lo haría otra persona.

## `rebase schema show`

Las tablas, o las columnas, relaciones y seguridad a nivel de fila de una tabla — desde `backend/schema` por defecto, o con `--remote` (o cualquier flag de destino) según las describe el servidor en ejecución a esta credencial. Una credencial sin `schema:read` no ve directivas, y una tabla que no puede leer no se lista.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Las cuentas, a través de `/api/admin/users`, `/roles` y `/guests`. Una cuenta se indica mediante su uid o su email (una coincidencia exacta, nunca la primera aproximada).

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

`create` envía una invitación por correo electrónico, o devuelve una contraseña temporal una sola vez cuando no se puede enviar correo. `--no-invite` crea la cuenta sin contraseña y no envía nada, para una app que inicia sesión mediante magic link, un código por email o un proveedor (`POST /api/admin/users` con `invite: false`). Otorgar un rol, `--disable`, `delete` y `mfa-reset` solicitan confirmación previa. Ningún emisor puede otorgar un rol superior al suyo ni actuar sobre una cuenta de mayor rango. `rebase auth reset-password` es la variante anterior, y aún recurre a la base de datos si el servidor no está en ejecución.

### Importar cuentas

`import` transfiere cuentas desde otro sistema y conserva sus IDs, de modo que las filas que apuntan a un usuario sigan apuntando al mismo. Admite un archivo CSV, un array JSON o NDJSON (`--format`, o según la extensión), con estas columnas:

| Columna | |
|---|---|
| `id` | Se conserva como el ID de la cuenta. Opcional: sin él, la tabla de usuarios genera uno. Un UUID es el caso habitual; letras, dígitos y `_ - . : \|` de hasta 128 caracteres también son válidos, aunque una columna id de tipo `uuid` solo acepta UUIDs |
| `email` | Obligatorio |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | Cuándo se creó la cuenta allí. Opcional: ahora |
| `email_verified` / `emailVerified` | `true`/`t`/`1` o `false`/`f`/`0`. Opcional: `false`, y el primer magic link o restablecimiento que la cuenta siga lo confirmará |
| `roles` | `editor;viewer`, `"editor,viewer"` entre comillas, o un array de Postgres `{editor,viewer}` |
| `password_hash` / `encrypted_password` | El hash que el otro sistema almacenó. Se lee únicamente con `--password-hashes bcrypt`; sin el flag, un archivo que contenga esta columna se rechazará antes de enviar nada |

No se envía ningún correo electrónico. Con `--password-hashes bcrypt`, una cuenta cuya fila tenga un hash inicia sesión con la contraseña que tenía, y en su primer inicio de sesión se reemplaza el hash con el propio de Rebase. Cualquier otra cuenta importada inicia sesión mediante magic link, un código por email, un proveedor o un restablecimiento de contraseña. Nunca se importa una contraseña en texto plano. Una cuenta cuyo ID o email ya esté en uso se reporta como omitida y se deja tal como está, nunca se actualiza, por lo que el archivo se puede ejecutar de nuevo. Cada cuenta se reporta como creada, omitida o fallida con el motivo; el comando finaliza con código de salida 1 si alguna falla. `--dry-run` comprueba todas las cuentas y no escribe nada. La CLI envía 100 cuentas por petición (`POST /api/admin/users/import`), tanto en `rebase dev`, un servidor o un proyecto de Rebase Cloud.

Desde Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt --project my-app
```

`users.csv` contiene entonces el hash de contraseña de cada cuenta: elimínalo una vez completada la importación.

## `rebase cron`

Las tareas programadas de la app (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` y `disable` anulan el código de la tarea en cada proceso, a través de los redespliegues; `run` solicita confirmación primero, y `--async` responde una vez que la ejecución ha comenzado. En un proyecto de Cloud, `rebase cron` no necesita acceso a Studio para lecturas: solicita al plano de control un token de plataforma `cron:read` de corta duración, que posee cualquier miembro con acceso a los logs. `run`, `enable`, `disable` y `reset` solicitan `cron:write`, el cual posee un propietario o administrador de la organización en un proyecto con Studio activado. `rebase cloud cron` es la forma anterior de solo lectura.

## `rebase logs`

El registro de solicitudes y de la aplicación del servidor — el búfer que lee la vista Logs de Studio — una vez, o seguido en tiempo real con `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

El búfer pertenece a un solo proceso. Con `--project` o `--cloud` esto equivale a `rebase cloud logs --runtime`: la salida de cada réplica, a través del plano de control.

## `rebase functions`

Las rutas propias de la app, una por archivo en `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` admite los mismos campos, cuerpo y cabeceras que `rebase api`, e imprime la respuesta tal como vino. Las funciones deciden su propio acceso, por lo que la credencial importa: `--anon` muestra lo que obtiene un visitante.

## `rebase storage`

Archivos almacenados, a través de las directivas de almacenamiento. La ruta almacenada comienza con dos puntos: `:avatars/me.png` en la fuente por defecto, `media:avatars/me.png` en la fuente identificada como `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` sube bajo el prefijo público (una URL permanente, sin token), `--content-type` define el tipo MIME, y `--force` sobrescribe un archivo local al descargar. `orphans` y `move` son los comandos de mantenimiento global del almacenamiento dentro del grupo.

## `rebase rls simulate`

Lo que vería otra identidad, desde el simulador de RLS de la app — el que utiliza la opción "view as" de Studio: por tabla, las filas que lee en comparación con las filas que tú lees, las tablas de las que sus scopes la excluyen y las columnas que no puede leer. De solo lectura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

El simulador responde a la propia sesión de un administrador y nunca a una clave, por lo que esto envía la sesión que `rebase auth login` almacenó. `rebase verify --live` comprueba las directivas en sí, sin considerar ninguna identidad específica.

## `rebase auth login`, `emails` y `keys`

Algunas rutas responden a una persona y nunca a una máquina: el simulador de RLS, las claves personales, la aplicación del esquema en vivo. `rebase auth login` inicia sesión en una app en ejecución — a través del navegador cuando el servidor ofrece inicio de sesión de dispositivo, o bien con `--email` y una contraseña (`--code` para un segundo factor) — y guarda la sesión en `~/.rebase/sessions.json`, por servidor, nunca en el proyecto. `auth whoami` indica quién considera el servidor que eres y los scopes que posees; `auth logout` finaliza la sesión allí también.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` lee el buzón de desarrollo que un servidor sin `SMTP_HOST` mantiene en lugar de enviar correos; `--clear` lo vacía. Un buzón vacío responde con el servidor consultado (`The development mailbox at http://localhost:3082 (rebase dev) is empty.`, y `server` en el JSON), ya que una respuesta vacía de otro backend parece exactamente un correo que nunca se envió. `auth keys` gestiona tus propias claves `rk_`, que actúan como tú, restringidas a los scopes especificados; el servidor responde a esto solo cuando la tabla de autenticación define `auth.personalKeys: true`. Las claves de servicio se gestionan con `rebase api-keys`, que también incorporó `update <id>`.

## `rebase mcp`

Conecta un cliente de IA al propio endpoint MCP de una app en ejecución (`/mcp`), donde un agente inicia sesión como una persona y queda sujeto a la seguridad a nivel de fila de esa persona:

```bash
rebase mcp connect                        # pick the clients from a list
rebase mcp connect --client claude-code   # or name them: claude-code, cursor, vscode, claude, chatgpt, all
rebase mcp connect --print                # print every way to connect, change nothing
rebase mcp url                            # the endpoint's URL
```

| Flag | Descripción |
|------|-------------|
| `--client <names>` | Omitir el selector interactivo. Separados por comas, o `all` |
| `--name <name>` | El nombre con el que registrar el servidor. Por defecto: el nombre del proyecto, con `-local` para un servidor de desarrollo |
| `--print` | Imprimir la URL, el comando de Claude Code y los enlaces de instalación, sin modificar nada |
| `--url <server>` | El backend en esta dirección. Por defecto: `REBASE_BASE_URL`, o bien el `rebase dev` en ejecución |
| `--cloud` | El proyecto de Rebase Cloud al que está vinculado este directorio |
| `--json` | Salida legible por máquina |

`rebase mcp url` acepta `--url`, `--cloud` y `--json`. Lo que hace cada cliente con la URL se detalla en [Conectar un cliente](/docs/ai/remote-mcp/#connecting-a-client). Este no es el servidor MCP para desarrolladores en `.mcp.json`, el cual se configura con `rebase skills install --mcp`.

## Próximos pasos

- [Índice de endpoints](/docs/backend/endpoints/) — cada ruta a la que llegan estos comandos y el scope que cada una necesita
- [API REST](/docs/backend/api/) — la sintaxis de filtrado, ordenación y paginación que `rebase data` transmite
- [rebase cloud](/docs/cli/cloud/) — el proyecto en sí en Rebase Cloud: despliegues, variables de entorno, copias de seguridad, acceso a Studio
- [Referencia de la CLI](/docs/cli/) — todos los demás comandos
