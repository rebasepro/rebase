---
sourceHash: ea9a6d9deb4ba31b
title: rebase cloud
sidebar_label: rebase cloud
description: Los grupos de comandos para Rebase Cloud en la CLI — autenticación, enlace de proyectos, despliegues, notificaciones, configuración, organizaciones, bases de datos, recursos, cómputo, almacenamiento, clústeres, facturación y uso.
---

Todo lo relacionado con Rebase Cloud, que está en beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no
incluye la beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos
actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera sobre
uno sin necesidad de vincularlo.

Tres opciones se aplican en todas partes: `--json` para una salida legible por máquinas (también es
la opción predeterminada cuando se usa una tubería, excepto para `deploy`, o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un
plano de control específico (o `REBASE_CLOUD_URL`), y `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in through the browser: a link and a code, approved in the console
rebase cloud login --no-browser   # print the link instead of opening it, e.g. over SSH
rebase cloud login --email me@example.com   # with your password instead
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud access-token   # the bearer the CLI would send now, refreshed first; for scripts and the MCP server
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` admite `deploy`, `logs`, `env`, `database` y `backups` en un proyecto
(`--project`, o el vinculado), y `billing`, `audit` y
`notifications` en una organización: `--org`, en su defecto la organización del proyecto,
o de lo contrario la seleccionada. Un token solo puede contener capacidades de organización.
`logs` también cubre `usage`. El alcance de cada uno se detalla en
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Cuando el plano de control
marca una respuesta a un token como obsoleta (un token anterior a `billing`
que lee facturación), la CLI imprime el aviso una vez en stderr, nunca en el
valor de `--json`.

Sin indicadores (flags), `login` inicia sesión a través del navegador. Imprime un código corto y
un enlace a la consola, abre el navegador y espera mientras apruebas el
inicio de sesión allí. Ya has iniciado sesión en la consola o inicias sesión con
cualquier método que ofrezca (contraseña, Google, GitHub, LinkedIn). Comprueba que el
navegador muestre el mismo código antes de aprobarlo. El enlace caduca después de diez
minutos y funciona una sola vez. Sin una terminal, o con `--json`, el enlace y el código
se envían a stderr y `login` sigue esperando, de modo que un agente pueda entregarte el enlace. Un
inicio de sesión denegado finaliza con `access_denied`, y uno caducado con `expired_token`.

Con `--email`, `login` pregunta si deseas usar tu contraseña o un código que el plano de control
te envía por correo electrónico. Con la autenticación de dos factores activada, luego solicita tu
código de autenticación (o un código de recuperación); a través del navegador, aprueba desde una
sesión de consola que lo haya utilizado. Sin una terminal no se puede escribir ninguno de los dos códigos: establece
`REBASE_TOKEN` con un token de acceso creado en la consola en Settings → Access
tokens. Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Project link

```bash
rebase cloud link         # link this directory to a cloud project (picked from a list)
rebase cloud link <slug>  # link the project with that slug or id, as --project <slug> does
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

Los comandos de organización (`orgs`, `billing`, `usage org`, `activity`,
`projects create`, `tokens create --can billing`) actúan sobre `--org <id>`, en su defecto la
organización que seleccionó `cloud use`, o si no la organización del proyecto vinculado. En
este último caso, indican cuál utilizaron. `orgs delete` nunca lo toma del
enlace: necesita `--org` o una organización seleccionada.

### Connect a self-hosted instance to Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

El [conector de Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
podrá acceder a ella junto a tus proyectos de Cloud. `connect` imprime
`REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE`; establécelos en
el servidor y reinícialo. En la carpeta del proyecto ofrece escribirlos en
`.env`. Volver a ejecutarlo es seguro. `--name` nombra la instancia, `--org` elige la
organización, `--no-wait` regresa sin esperar. Solo para propietarios y administradores.

## Projects

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects transfer [id] --to-org <id|slug>
rebase cloud projects delete [id]
```

`claim` imprime el enlace de reclamación del proyecto que `init --claim` aprovisionó en este
directorio, y el tiempo restante antes de que sea eliminado sin reclamar (`Unclaimed: deleted
in 41h`). `--open` también lo abre en un navegador. El enlace se guarda únicamente en la
máquina que ejecutó `init --claim`, en `~/.rebase/credentials.json`; el plano de control
almacena un hash de este y no puede volver a imprimirlo. Antes de responder, `claim`
consulta al plano de control si el token propio del proyecto sigue funcionando. Una reclamación
revoca ese token, por lo que una vez que alguien ha reclamado el proyecto, `claim` lo rechaza
con `already_claimed` en lugar de imprimir un enlace inactivo. También lo rechaza una vez que la
ventana de tiempo ha finalizado (`claim_expired`), y en un directorio sin enlace de reclamación
(`no_claim_link`). `rebase cloud status` y `rebase cloud whoami` muestran el mismo
enlace mientras el proyecto no haya sido reclamado.

`projects transfer` traslada un proyecto a otra organización, sin cambios: el
mismo id, dirección, dominios personalizados, base de datos, almacenamiento, variables de entorno y
despliegues. Solo cambian quién es el propietario, quién puede verlo y quién lo paga.
Debes ser propietario o administrador de ambas organizaciones y haber iniciado sesión con `rebase cloud login`;
un token de acceso no puede trasladar un proyecto. El destino se factura a partir de ese momento,
por lo que uno sin una tarjeta registrada (y no facturado internamente) rechazará el traslado y
nada cambiará. Un proyecto que aún esté esperando ser reclamado se traslada mediante su enlace de reclamación en su
lugar. La consola tiene la misma acción en Settings del proyecto, en la
zona de peligro.

## Deploy and observe

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud deploy [app] --preview [--preview-name <name>]  # its own address; production untouched
rebase cloud previews [list|delete <name>]
rebase cloud logs [--runtime] [-f] [--preview [name]]  # build log, or what the app prints
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud sleep [status|on|off|wake]  # sleep when idle; `on --after 15m|30m|1h|4h`
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk, realtime per instance
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sin nombre de aplicación despliega el backend. Un despliegue de paquete de
backend también sube el código fuente del proyecto —lo que git rastrea, nunca un `.env`— para que una
actualización de la plataforma pueda reconstruirlo; `--no-source` omite esto una vez, y `cloud settings set
--platform-rebuilds off` lo detiene y elimina la copia almacenada. `--allow-downgrade` despliega una versión anterior.

Una actualización de la plataforma puede reconstruir una aplicación gestionada en una versión de `@rebasepro`
más reciente de la que fija tu repositorio local. Un despliegue desde ese checkout restablecería el panel de administración
y el controlador antiguos, por lo que se rechaza antes de compilar nada, indicando
el comando que lo soluciona (`rebase upgrade --to <version>`). `rebase cloud status`
informa lo mismo previamente: una línea `Rebuilt on`, y en `--json`,
`runtime.platformRebuiltVersion` y `frameworkDrift`.

Un `deploy` seguido finaliza con un resumen: cada aplicación enviada con su URL, el
id del despliegue, cuánto tiempo tomó y si la nueva versión responde allí. Espera
hasta `--live-timeout` segundos (por defecto 60; `0` omite la comprobación) a que respondan
el `/health` del backend y la dirección de cada aplicación estática. Un despliegue fallido
termina con una sola línea que nombra la aplicación y el motivo, y finaliza con un código distinto de cero. El resumen
se imprime incluso cuando se redirige la salida por tubería; `--json` (o `REBASE_JSON=1`) imprime un objeto en su lugar,
con `apps`, `hosts`, `live`, `liveChecks` y `durationMs`. Un host cuyo
certificado HTTPS aún no se haya emitido se reporta como no activo, indicando ese motivo.

Antes de subirlo, `deploy` analiza el JavaScript de cada aplicación estática que envía:
los archivos `.js`/`.mjs`/`.cjs` en su `output` y los bloques `<script>` en línea en
su HTML. Un error de sintaxis detiene el despliegue indicando `file:line:column` (código
`syntax_error` bajo `--json`), y `--no-verify` omite la comprobación. Un despliegue
exitoso finaliza mostrando el camino de retorno, `rebase cloud rollback`. Una aplicación estática desplegada
por sí sola aún no se puede revertir; consulta
[Revertir](/docs/deployment/cloud#roll-back).

`--preview` sirve la compilación en `https://<project>--<name>.rebase.website` y
deja la producción intacta. Una vista previa (preview) del backend ejecuta su propio backend, en una
base de datos vacía propia, con sus aplicaciones estáticas integradas. Una aplicación estática aún no se puede
previsualizar por sí sola en Rebase Cloud: `rebase cloud deploy <app> --preview`
se rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada. Una vista previa del backend
se factura como una unidad de aplicación adicional en el tamaño predeterminado mientras exista, y
el despliegue indica a cuánto equivale al mes, según la cotización del propio plano de control
(`cost` bajo `--json`; solo la regla y este enlace cuando el plano de control no puede
cotizarlo); `rebase cloud previews delete <name>` la detiene. `rebase cloud previews`
muestra una vista previa que la plataforma pausó (su base de datos superó el límite de vista previa) como
`paused`, con el motivo (`statusMessage` bajo `--json`). Una nueva dirección de vista previa
puede ser rechazada con `preview_cert_budget` cuando se agota el presupuesto semanal de
certificados de vista previa de la plataforma; el mensaje indica hasta cuándo.
Consulta [Previsualizar un cambio](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime el registro (log) de compilación más reciente, y `-f` sigue en tiempo real una compilación que
aún se está ejecutando. `--runtime` lee en su lugar lo que imprime la aplicación desde cada pod
detrás de ella, indicando en cada línea el pod correspondiente cuando escribe más de uno:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
rebase cloud logs --runtime --raw                 # the lines exactly as the pods wrote them
```

- `--since` toma una duración (`30s`, `5m`, `1h`) o una marca temporal RFC3339.
- `--tail <n>` es el número de líneas por pod desde el cual comenzar (el plano de control lo limita a 2000).
- `--grep` conserva las líneas que contienen el texto, sin distinguir mayúsculas de minúsculas; escribe `/re/flags` para una
  expresión regular.
- Con `--grep` o `--level`, el filtro busca en cada línea que devuelve el plano de control
  para la ventana (las 2000 más recientes de cada pod), y `--tail` cuenta las líneas coincidentes:
  las `n` coincidencias más recientes por pod, 500 por defecto. Cuando un pod tuvo más
  líneas en la ventana que esa cantidad, la salida indica que las más antiguas no se
  buscaron (`filter.scanCapped` bajo `--json`).
- `--level error|warn|info|debug` conserva las líneas con esa severidad o peor. Lee
  la `severity` estructurada que registra un backend de Rebase, una palabra de nivel al inicio de una
  línea de texto sin formato o un patrón de error como `TypeError:`. Las líneas que no contengan ninguno se omiten.
- Una línea estructurada se imprime de forma legible: `14:30:32.126 WARN  [boot] Driver version skew …  fix="bump …"`, y una solicitud como `GET /api/data/rooms/RCTF 404 16ms  requestId=…`. `--raw` imprime en su lugar cada línea exactamente como la escribió el pod; las líneas de texto plano se imprimen sin cambios en ambos casos, y `--json` siempre incluye las líneas originales.

Un seguimiento (`-f`) consulta cada dos segundos e imprime cada línea una vez. Anuncia los pods
que se inician, se detienen o se reinician. Cuando un contenedor se reinicia, también imprime las últimas
líneas de la instancia que finalizó, donde suele estar el motivo. Espera mientras no haya
ningún pod en ejecución y, tras una desconexión, reintenta con retroceso exponencial (backoff) y
reanuda donde se quedó. Con `--json`, el seguimiento imprime un objeto JSON por
línea (NDJSON): `{"type":"line","ts","pod","text"}` para cada línea de registro, y
`{"type":"event","event":…}` para el resto.

`--preview <name>` lee una vista previa en lugar de producción. Usa el nombre de la
vista previa o el id de despliegue que imprimió un despliegue de vista previa. Por sí solo, `--preview`
lee la única vista previa del proyecto. Una vista previa estática tiene un registro de compilación pero no un
registro de tiempo de ejecución (runtime), ya que no ejecuta ningún servidor.

## Config

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
rebase cloud service-key [rotate] --preview <name>  # a backend preview's own key
```

`domains add` para un host que el proyecto ya tiene, como uno que un despliegue
registró desde `rebase.json`, imprime los registros DNS y el estado de ese host como lo
hace una adición nueva; `--json` agrega `alreadyRegistered: true`. Un host verificado se
sirve a través de HTTPS una vez que se emite su certificado, unos minutos después de la
verificación. Hasta entonces, el ingress responde con un certificado provisional,
y `domains list`, `domains verify` y `status` indican
`verified, certificate pending` en lugar de live. La CLI averigua esto mediante
un protocolo de enlace TLS con cada host verificado; `--json` lo transmite como `certificate`
(`ready`, `pending` o `unreachable`, con un `reason`).

`app-key` lista la
clave que `rebase cloud init --claim` generó en la aplicación y escribió en `.env` como
`REBASE_API_TOKEN`, mediante su prefijo y nunca su valor. Reclamar el proyecto
transfiere esa clave y deja de caducar. `app-key rotate` genera una nueva y
revoca todas las claves de agente anteriores al mismo tiempo. Escribe la nueva clave en un `.env`
que ya define `REBASE_API_TOKEN` y la excluye de `--json` allí. En
cualquier otro directorio, imprime la clave una sola vez. Las claves creadas en el panel de administración
de la aplicación no se tocan. Se ejecuta con tu inicio de sesión: ninguna capacidad de token lo otorga.

`service-key`
imprime la generación del `REBASE_SERVICE_KEY` del proyecto, cuándo se rotó por
última vez y si la aplicación todavía se está reiniciando con la más reciente. Nunca
imprime la clave: eso es `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite una nueva clave y reinicia la aplicación en ella. La clave anterior funciona hasta que el
reinicio haya terminado, y no después. Se rechaza mientras se ejecuta un despliegue
y se ejecuta con tu inicio de sesión. Reclamar un proyecto también rota su clave de
servicio.

Una vista previa del backend tiene su propia clave de servicio. Su primer despliegue la crea,
los redespliegues la mantienen y la clave de producción responde 401 en la vista previa.
`service-key --preview <name>` la imprime, al igual que `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
escribe una nueva y reinicia solo el pod de esa vista previa; la clave anterior funciona hasta que
el nuevo pod esté listo. Pregunta primero, y `--yes` omite la pregunta. Ambas solicitan
lo que pide `env reveal`: el rol de propietario o administrador de la organización, y para un
token de acceso la capacidad `env` en un proyecto reclamado. La clave y el
pod de producción no se tocan.

Una vista previa de backend comienza a partir de las variables de producción, incluidas las claves en vivo.
`env set KEY=VALUE --preview` otorga a las vistas previas su propio valor, `env unset KEY
--preview` excluye la variable de ellas, `env reset KEY --preview` restablece
el valor de producción y `env list --preview` muestra las diferencias.
Ninguno de ellos modifica la producción.

`env set KEY --stdin` lee el valor desde la entrada estándar en lugar de la
línea de comandos, donde `ps` y el historial de tu shell lo mostrarían:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Se descarta un salto de línea final. La función `rebase_cloud_env_set` del servidor MCP
establece los valores de esta manera.

`env set KEY --prompt` solicita el valor en un prompt oculto en tu terminal.
No se muestra nada en pantalla y el valor se almacena como un secreto, al igual que con `--stdin
--secret`. Un agente puede proporcionarte el comando a ejecutar, de modo que el valor nunca pase
por el chat. Sin una terminal lo rechaza (`input_required`) y apunta
a `--stdin`.

## Organizations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` añade a alguien que ya tiene una cuenta de Rebase con una
dirección de correo electrónico verificada, al igual que la opción Add member de la consola. Tienen acceso
de inmediato y no se envía nada por correo. Rebase Cloud aún no envía invitaciones, por lo que una
persona sin cuenta no recibe ningún enlace: el comando lo rechaza con `no_account` y
te pide que primero se registre y luego lo ejecutes de nuevo. Un plano de control que
gestione invitaciones crea una en su lugar e imprime su enlace (de un solo uso, válido por 7
días, aceptado solo por una cuenta que haya verificado esa dirección); `invites`
lista, revoca y reenvía esas invitaciones, y responde `not_served` en cualquier otro caso.
`--role` es `admin` o `member` (por defecto). Nadie se añade como `owner`: añádelos
como admin y un propietario los promociona con `members role <email> owner`.
Añadir miembros e `invites` requiere una sesión de `rebase cloud login`;
`REBASE_TOKEN` es rechazado. Ambos requieren el rol de propietario o administrador; a un miembro se le
notificará esto.
`members remove` pide confirmación primero (`--yes` la omite); eliminar o degradar a un propietario
requiere ser propietario, y el último propietario permanece. `--org <id>` selecciona una organización
distinta de la seleccionada.

### Project access

```bash
rebase cloud access [list]
rebase cloud access invite <email> [--role admin|developer|viewer]
rebase cloud access role <email|uid> <admin|developer|viewer>
rebase cloud access remove <email|uid>
rebase cloud access invites [list] | revoke <id|email> | resend <id|email>
```

`access` administra quién puede acceder a un proyecto, al vinculado o a `--project`. Los
propietarios y administradores de una organización son `admin` en cada proyecto que posee y sus
miembros son `developer`; `access` otorga a alguien un rol solo en este proyecto,
pertenezca o no a la organización. Su rol efectivo es el superior de los dos, y
`access` lo lista junto con su procedencia. `admin` tiene acceso a todo,
incluidos accesos y configuración; `developer` despliega y usa Studio,
registros y el entorno; `viewer` solo lectura.

`invite` crea una invitación al proyecto (`--role` es `developer` por defecto)
e imprime su enlace: de un solo uso, válido por 7 días, aceptado únicamente por una cuenta
que haya verificado esa dirección. `role` y `remove` cambian o eliminan el rol
propio del proyecto y piden confirmación primero (`--yes` la omite); a alguien que accede al
proyecto a través de la organización se le elimina con `orgs members remove`.
Perder `admin` en un proyecto también revoca el rol de `admin` que **Open admin
panel** le otorgó a esa persona dentro de la aplicación y finaliza sus sesiones allí. Cada
cambio requiere una sesión de `rebase cloud login` y permisos de `admin` en el proyecto; un
plano de control sin acceso a proyectos responde `not_served`.

`activity` es el registro de auditoría de la organización seleccionada, ordenado de más reciente a más antiguo: quién
desplegó, revirtió, definió, eliminó o reveló una variable de entorno (por
nombre, nunca por valor), cambió un dominio, creó, restauró o descargó una
copia de seguridad, modificó el cómputo de un proyecto, detuvo o eliminó un proyecto, cambió el
rol de un miembro, o creó o revocó un token de acceso. `--action` admite un área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o una acción completa
como `env.set`. Una página contiene hasta 100 entradas (`--limit`, 50 por defecto); la
salida imprime el cursor `--before` para la siguiente. `--json` devuelve un único valor,
`{ org, events, nextCursor }`. Requiere el rol de propietario o administrador de la organización.
Un token solo lo lee con la capacidad `audit` en la organización
(`rebase cloud tokens create --can audit`). La página **Activity** de la consola
muestra el mismo registro.

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db query [sql] [--file <path>]
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre un puerto local que *es* la base de datos gestionada (sin endpoint
público) hasta presionar Ctrl-C; `--reveal` añade la contraseña. Solo para propietarios o administradores.

`db query` ejecuta SQL en la base de datos gestionada e imprime el resultado de cada
sentencia, sin necesidad de un `psql` local: abre el mismo túnel durante la duración de una
consulta. Un archivo con varias sentencias se ejecuta como un solo script y se detiene en el primer
error; no se añade ninguna transacción, por lo que debes envolver el archivo en `BEGIN`/`COMMIT` para que sea
todo o nada. Se rechaza `COPY … FROM STDIN`. Solo para propietarios o administradores. Con
`--json` imprime `{ projectId, results: [{ command, rowCount, rows }] }`.

`db connect`, `db query` y `db backup` admiten `--database <key>` para una de
las [otras bases de datos](/docs/backend/multiple-sources/) del proyecto, la `key` de
una declaración `database("<key>")`. Sin este parámetro, actúan sobre la base de datos por defecto.

## Guests

Cada `signInAnonymously()` en una prueba, un bot o una visita abandonada deja una fila
en los usuarios del proyecto. Estos comandos cuentan esas filas y las eliminan, para
que nadie tenga que recorrerlas una por una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` toma una antigüedad con una unidad: `45m`, `12h`, `30d` o `2w`. Sin `--yes`
cuenta y no elimina nada. Procesa proyectos de cualquier tamaño en pequeños
lotes.

Solo los invitados (guests) pueden eliminarse. Un invitado es una fila con `is_anonymous` activado, sin contraseña y sin
identidad vinculada, y la aplicación aplica esa regla en la sentencia que elimina la
fila, por lo que el comando no puede afectar a una cuenta real, incluso a una que se haya registrado un momento
después de haber sido listada. `delete` rechaza una cuenta con `NOT_ANONYMOUS`.

**Last seen** (visto por última vez) indica cuándo se emitió o renovó por última vez la sesión del invitado, o cuándo
se creó el invitado si no le queda ningún token de actualización (refresh token). Un invitado que sigue regresando
no se considera antiguo, independientemente de cuándo se haya creado. Los tokens de actualización de un invitado eliminado
y cualquier otra fila de autenticación se eliminan con él.

Las filas en tus propias tablas siguen su clave foránea:

| La columna | Qué ocurre con la fila |
|---|---|
| Enlace opcional (`ON DELETE SET NULL`, el predeterminado) | Se conserva, con el enlace vaciado |
| Enlace obligatorio (`ON DELETE RESTRICT`, el predeterminado) | Se conserva, y el invitado con ella: el invitado se reporta como omitido, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Se elimina junto con el invitado |
| Sin clave foránea (un campo `userSelect`, un id simple) | Se conserva, conteniendo un id que ya no existe |

Comprueba cuáles de tus enlaces se propagan en cascada antes de pasar `--yes`: no se puede deshacer.

El comando pasa a través del proxy de Studio de la consola, que almacena la clave de la aplicación, por lo que la clave nunca llega a tu
máquina. Requiere ser propietario o administrador de la organización, en un proyecto cuyo acceso a Studio esté habilitado
(`rebase cloud settings set --studio on`). A un proyecto en un runtime más antiguo se le notificará que necesita uno más reciente.
`rebase users guests --project <slug>` es el mismo comando dentro de la familia de proyectos.

## Resources

Lo que la plataforma mantiene para el proyecto frente a lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando desaparece su declaración;
eso supondría que se eliminen datos mediante un push. La mantiene, la vincula y la factura hasta que alguien
la elimine (prune) por su nombre.

## Compute

Lo que el proyecto reserva y lo que cuesta.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` admite `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`.
`--scale-to-zero` está retirado: cada backend ejecuta al menos una instancia, por lo
que `true` es rechazado y `false` es ignorado con una advertencia. No existen niveles de
planes: todo tiene un precio por recurso. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, notifications, clusters, billing and usage

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud clusters list | add | verify | registry | open | close   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
rebase cloud billing invoices [--limit N]   # issued invoices, newest first, with Stripe's hosted page
rebase cloud billing upcoming    # a preview of each subscription's next invoice
rebase cloud usage [--month YYYY-MM]   # requests used this month against the allowance, and the overage so far
rebase cloud usage org           # every project of the selected organization, with the total
```

`notifications add <url>` envía los eventos del proyecto vinculado a una URL. `--events`
toma una lista separada por comas de `deploy.failed` (el valor predeterminado),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` y `preview.paused`. `--format slack` envía
únicamente `{ "text" }` en lugar del JSON del evento, que también contiene un `text`. La URL
es un argumento posicional porque `--url` especifica el plano de control. `add` imprime
el secreto de firma una sola vez; `--json` devuelve `{ projectId, webhook, secret }`.
`test <id>` sale con código 1 y `delivery_failed` cuando el receptor no aceptó
el evento de prueba. Listar está abierto a cualquier miembro de la organización; `add`, `test`
y `remove` requieren el rol de propietario o administrador. Un token los gestiona con la
capacidad `notifications` en la organización, bajo la misma regla de roles. Consulta
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` otorga al clúster propio de un
cliente un registro de imágenes propio, utilizado exclusivamente para ese clúster. Sin
este, dicho clúster utiliza el registro compartido de la plataforma, y cada despliegue en él
lo indicará en su registro. Con uno, las compilaciones se envían (push) a ese repositorio con un token para
esa cuenta, los pods descargan (pull) solo con esa clave, y una reversión acepta las
imágenes del proyecto allí. Las imágenes
que el proyecto compiló previamente en el repositorio compartido siguen estando disponibles para descargar y continúan siendo
objetivos de reversión. Los tres valores van juntos; `--clear` los elimina. La clave
se sella cuando se escribe y nunca se vuelve a leer. Al igual que el resto de `clusters`,
requiere el rol de platform-admin. El operador crea el repositorio y ambas
cuentas con Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`clusters add --platform-capacity` registra capacidad operada por Rebase: los proyectos
ubicados en su región se despliegan allí una vez que su línea base (baseline) está lista. No ofrece
la región a los clientes. `--open-to-customers` sí lo hace, al momento del registro, o posteriormente
con `clusters open <id-or-name>`; `clusters close <id-or-name>` deja de ofrecerla.
Los operadores pueden desplegar en un clúster cerrado. Mantén un clúster cerrado mientras su
dominio base se comparta con otro clúster: hasta que el registro comodín (wildcard) se traslade, sus
nombres de host solo se resolverán mediante registros explícitos (`ingress.<baseDomain>`,
`s3.<baseDomain>` y uno por proyecto), y `clusters add` imprime qué registros
añadir. Cuando el dominio es compartido, `open` advierte que el registro comodín ya debe
apuntar al clúster. No pide confirmación, por lo que funciona desde un script.

`billing invoices` y `billing upcoming` leen los mismos datos de Stripe que la
página Billing de la consola, y están disponibles únicamente para los propietarios y administradores
de la organización. Un token puede acceder a ellos, y al resto de `billing`, con la capacidad
`billing` en la organización; un token creado antes de esa capacidad seguirá funcionando
durante una versión más, con una advertencia en cada respuesta. Los importes en `--json` se expresan en la unidad fraccionaria de la moneda (céntimos o centavos), exactamente como
los envía Stripe. Las facturas en borrador no se listan; la vista previa la calcula
Stripe y sus líneas medidas continúan aumentando hasta que se cierre el periodo.

`usage` lee lo que el proyecto vinculado (o `--project`) ha consumido en un mes
natural, en UTC: solicitudes frente al límite incluido, errores 5xx, el exceso
hasta el momento en euros y, para el mes en curso, hacia dónde se dirige a este
ritmo (una estimación). El exceso es el cálculo propio del informe de excesos, el
que indica a Stripe qué facturar, y aparece en la factura del mes siguiente.
`usage org` enumera todos los proyectos de la organización seleccionada con `rebase cloud
use`, junto con el total. Cualquier miembro de la organización puede consultarlo. Un token lo lee
con la capacidad `logs` en el proyecto; `usage org` lista los proyectos sobre los cuales el
token tiene dicha capacidad.
`--month` toma un mes anterior. La respuesta incluye `caveats`, cada una con un `code`: `storage_not_measured`
(el almacenamiento de objetos marca 0), `multi_pod_undercount` (las solicitudes atendidas mientras se ejecutan dos o
más pods de la aplicación no se cuentan), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
proyecto reclamado desde un agente cuenta solo los días a partir de la reclamación) y
`autoscale_not_charged` (los pods se ejecutaron por encima de `--replicas` y esta plataforma aún no
los cobra). La respuesta de un proyecto con autoescalado también incluye `autoscale`:
`extraPodSeconds` por encima del mínimo base, `amountEur` a sus tarifas y `charged`.

## Deploy hooks, alerts and the rest

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms|requests_<surface>|errors_<surface>] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud domains redirect <domain> [--off]   # answer it with a 308 to the primary, path and query kept
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`domains redirect` se configura por dominio y está desactivado de forma predeterminada, de modo que un proyecto que sirva un host `api.` junto a su sitio conserva ambos; surte efecto cuando el dominio está verificado y otro es el principal, y nunca se aplica a un dominio en el que se sirve una aplicación. `deploy-hooks create` imprime la URL del hook una sola vez. `deploy --git` no se puede combinar con los indicadores de una compilación local, y en el entorno de ejecución gestionado requiere `--eject`, ya que el plano de control compila a partir del código fuente. `settings set --studio` es el conmutador que los comandos del proyecto (`rebase data`, `rebase users`, …) necesitan activo para `--project`: acceden a la aplicación a través del proxy de Studio de la consola. Un comando cuya ruta en el plano de control aún no esté desplegada responde `not_served` y la especifica. Los comandos destructivos solicitan confirmación primero y fallan con `confirmation_required` cuando nadie puede responder: pasa `--yes`.
