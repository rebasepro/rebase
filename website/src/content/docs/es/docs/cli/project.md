---
sourceHash: 6cce3d2ac14320cc
title: Una aplicación en ejecución
sidebar_label: Una aplicación en ejecución
description: Comandos de CLI que actúan sobre una aplicación Rebase en ejecución a través de su API — filas, usuarios, cron, logs, funciones, archivos, el simulador de RLS — en rebase dev, un servidor que especifiques o un proyecto de Rebase Cloud.
---

Estos comandos se comunican con una aplicación en ejecución a través de su propia API, por lo que la seguridad a nivel de fila (row-level security), el acceso a campos, los hooks y las políticas de almacenamiento deciden lo que pueden hacer, al igual que lo hacen para el SDK. Se comunican con el `rebase dev` local, un servidor que especifiques o un proyecto de Rebase Cloud, con los mismos flags en todas partes.

## Elección del servidor y las credenciales

| Flag | A dónde van las solicitudes y como quién |
|---|---|
| *(ninguno)* | `REBASE_BASE_URL` (shell, luego `.env`), o bien el `rebase dev` que este checkout esté ejecutando; con la clave de servicio de `.env` |
| `--url <server>` | Ese servidor, con la clave de servicio de `.env` |
| `--project <slug>` | Un proyecto de Rebase Cloud, a través del proxy de Studio de la consola: inicias sesión con `rebase cloud login`, y el plano de control adjunta la clave de la aplicación de su lado, por lo que ninguna clave llega a tu máquina. Propietarios y administradores de la organización, en un proyecto cuyo acceso a Studio esté habilitado (`rebase cloud settings set --studio on`) |
| `--cloud` | El proyecto de Rebase Cloud al que está vinculado este directorio |
| `--token <bearer>` | En su lugar, envía este bearer: una clave `rk_` o el token de acceso de un usuario. En un proyecto de Cloud va a la propia dirección de la aplicación |
| `--session` | Envía la sesión de usuario que `rebase auth login` almacenó para ese servidor |
| `--anon` | No envía nada: lo que recibe un visitante |

No se asume nada más: sin `REBASE_BASE_URL` y sin un `rebase dev` en ejecución, un comando se rechazará en lugar de enviar la clave de servicio a lo que sea que esté escuchando en un puerto. Cada comando admite `--json` (y genera JSON siempre que stdout no sea una terminal, como ocurre con `rebase cloud`) y `--yes`, que responde a la confirmación que solicita cada comando destructivo; sin una terminal, se rechaza con `confirmation_required` en lugar de solicitar confirmación.

`rebase api-keys`, `rebase storage orphans|move` y `rebase schema reconcile` aceptan los mismos flags.

## `rebase api`

Cualquier ruta que sirva la aplicación, con las credenciales del proyecto: la variedad de casos secundarios que no tienen un comando propio: la actualización de una vista materializada, la auditoría de RLS, `/api/meta/contract`, una ruta que añade un plugin.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

Una ruta sin una `/` inicial se encuentra bajo `/api`. `-f key=value` es un campo de tipo string y `-F` uno tipado (`true`, `false`, `null`, números, JSON, `@file`); los campos son la query string de un GET, HEAD o DELETE y un cuerpo JSON en caso contrario. A diferencia de `gh api`, un campo por sí solo nunca convierte la solicitud en un POST: una operación de escritura especifica su método o incluye `--input`. La respuesta se imprime tal como vino — JSON con formato legible — y una respuesta que no sea 2xx se imprime y finaliza con código de salida 1. Se rechaza la cabecera `Authorization`; los flags de destino eligen la credencial.

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
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (repetible), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` recorre cada página; `--format table\|json\|ndjson\|csv` (csv y ndjson se transmiten en streaming con `--all`) |
| `get <table> <id>` | Una fila, con `--fields` e `--include` |
| `count <table>` | Las filas que coinciden con `--where` |
| `aggregate <table>` | `--select` y `--group-by`, los propios de la API |
| `insert <table>` | `--data <json>` o `--file <path\|->`; un array representa varias filas en una sola escritura masiva; `--upsert <column>` |
| `update <table> [<id>]` | Una fila, o cada fila que coincida con `--where` tras un conteo y una confirmación; `--if-match <etag>` |
| `delete <table> [<id>]` | Pide confirmación primero; `--hard` en una tabla con soft-delete |
| `import <table>` | `--file` (array de JSON, NDJSON o CSV según la extensión, o `--format`), por lotes (`--batch`); `--upsert`, `--ignore-duplicates`. Lo que escribe `query --format json` se vuelve a leer |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tablas con el historial activado |
| `watch <table>` | Las filas coincidentes cada vez que cambian, a través del socket de tiempo real. No a través del proxy de Studio: en un proyecto de Cloud, pasa `--token` o `--session` |

La clave de servicio corresponde al rol `admin`: la seguridad a nivel de fila se sigue ejecutando, con ese rol. Pasa `--token`, `--session` o `--anon` para ver la tabla como lo haría otra persona.

## `rebase schema show`

Las tablas, o las columnas, relaciones y seguridad a nivel de fila de una tabla — desde `backend/schema` por defecto, o con `--remote` (o cualquier flag de destino) tal como el servidor en ejecución las describe para esta credencial. Una credencial sin `schema:read` no ve ninguna política, y las tablas que no puede leer no se listan.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

Las cuentas, a través de `/api/admin/users`, `/roles` y `/guests`. Una cuenta se especifica por su uid o su email (una coincidencia exacta, nunca el primer resultado aproximado).

```bash
rebase users list --search ada
rebase users create ada@example.com --role admin
rebase users update bob@example.com --add-role editor
rebase users update bob@example.com --disable
rebase users reset-password bob@example.com
rebase users mfa-reset bob@example.com
rebase users roles
rebase users guests prune --older-than 30d --yes
```

`create` envía una invitación por correo electrónico, o devuelve una contraseña temporal una sola vez cuando no se puede enviar correo. `--no-invite` crea la cuenta sin contraseña y no envía nada, para una aplicación en la que se inicia sesión mediante magic link, un código por correo o un proveedor (`POST /api/admin/users` con `invite: false`). Otorgar un rol, `--disable`, `delete` y `mfa-reset` piden confirmación primero. Ningún emisor puede otorgar un rol superior al suyo ni actuar sobre una cuenta de mayor rango. `rebase auth reset-password` es la sintaxis anterior, y todavía recurre a la base de datos cuando el servidor no está en ejecución.

## `rebase cron`

Los trabajos programados de la aplicación (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` y `disable` anulan el código del trabajo en cada proceso, a lo largo de los redespliegues; `run` pide confirmación primero, y `--async` responde una vez que la ejecución ha comenzado. En un proyecto de Cloud, `rebase cron` no necesita acceso a Studio para lecturas: solicita al plano de control un token de plataforma `cron:read` de corta duración, el cual posee cualquier miembro con acceso a los logs. `run`, `enable`, `disable` y `reset` solicitan `cron:write`, el cual posee un propietario o administrador de la organización en un proyecto con Studio activado. `rebase cloud cron` es la sintaxis anterior de solo lectura.

## `rebase logs`

El registro de solicitudes y de la aplicación del servidor — el búfer que lee el Logs Explorer de Studio — una sola vez, o seguido con `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

El búfer pertenece a un solo proceso. Con `--project` o `--cloud`, esto equivale a `rebase cloud logs --runtime`: la salida de cada réplica, a través del plano de control.

## `rebase functions`

Las rutas propias de la aplicación, una por archivo en `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` admite los mismos campos, cuerpo y cabeceras que `rebase api`, e imprime la respuesta tal como vino. Las funciones deciden su propio acceso, por lo que la credencial importa: `--anon` muestra lo que recibe un visitante.

## `rebase storage`

Archivos almacenados, a través de las políticas de almacenamiento. La ruta del lado del almacenamiento comienza con dos puntos: `:avatars/me.png` en la fuente predeterminada, `media:avatars/me.png` en la fuente con clave `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` sube bajo el prefijo público (una URL permanente sin token), `--content-type` establece el tipo y `--force` sobrescribe un archivo local al descargarlo. `orphans` y `move` son la parte del grupo dedicada al mantenimiento de todo el almacenamiento.

## `rebase rls simulate`

Lo que vería otra identidad, a partir del simulador de RLS de la aplicación — el mismo que usa la opción "view as" de Studio: por tabla, las filas que lee en comparación con las filas que tú lees, las tablas de las que sus scopes le impiden el acceso y las columnas que no puede leer. De solo lectura.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

El simulador responde a la propia sesión de un administrador y nunca a una clave, por lo que esto envía la sesión que `rebase auth login` almacenó. `rebase verify --live` verifica las políticas en sí mismas, sin considerar ninguna identidad.

## `rebase auth login`, `emails` y `keys`

Algunas rutas responden a una persona y nunca a una máquina: el simulador de RLS, las claves personales, la aplicación de esquemas en vivo. `rebase auth login` inicia sesión en una aplicación en ejecución — a través del navegador cuando el servidor ofrece inicio de sesión de dispositivo, o bien con `--email` y una contraseña (`--code` para un segundo factor) — y guarda la sesión en `~/.rebase/sessions.json`, por servidor, nunca en el proyecto. `auth whoami` indica quién considera el servidor que eres y los scopes que tienes; `auth logout` finaliza la sesión allí también.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` lee el buzón de desarrollo que un servidor sin `SMTP_HOST` mantiene en lugar de enviar correos; `--clear` lo vacía. `auth keys` gestiona tus propias claves `rk_`, que actúan en tu nombre, restringidas a los scopes indicados; el servidor solo responde si la tabla auth establece `auth.personalKeys: true`. Las claves de servicio se gestionan con `rebase api-keys`, que también incorporó `update <id>`.

## Próximos pasos

- [Índice de endpoints](/docs/backend/endpoints/) — cada ruta a la que llegan estos comandos y el scope que necesita cada una
- [API REST](/docs/backend/api/) — la sintaxis de filtrado, ordenación y paginación que `rebase data` transmite
- [rebase cloud](/docs/cli/cloud/) — el proyecto en sí en Rebase Cloud: despliegues, entorno, copias de seguridad, acceso a Studio
- [Referencia de la CLI](/docs/cli/) — todos los demás comandos
