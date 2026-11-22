---
sourceHash: 8ba7c94e0a895b48
title: rebase cloud
sidebar_label: rebase cloud
description: Los grupos de comandos para Rebase Cloud en la CLI — autenticación, vinculación de proyectos, despliegues, notificaciones, configuración, organizaciones, bases de datos, recursos, cómputo, almacenamiento, clústeres, facturación y uso.
---

Todo lo relacionado con Rebase Cloud, que está en fase beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no incluye
la versión beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría
de los comandos actúan sobre el proyecto vinculado en `.rebase/cloud.json`;
`--project <id>` opera sobre uno sin vincularlo.

Tres opciones se aplican en todas partes: `--json` para una salida legible por máquina
(también es el valor predeterminado cuando se usa con tuberías, excepto para `deploy`,
o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un plano de control específico
(o `REBASE_CLOUD_URL`), y `--project, -p <id>`.

## Autenticación

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

`--can` acepta `deploy`, `logs`, `env`, `database` y `backups` en un proyecto
(`--project`, o el vinculado), y `billing`, `audit` y
`notifications` en una organización: `--org`, si no la organización del proyecto,
o si no la seleccionada. Un token puede contener únicamente permisos de organización.
`logs` también cubre `usage`. El alcance de cada uno se encuentra en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents). Cuando el plano de control
marca una respuesta a un token como obsoleta (un token anterior a `billing`
que lee facturación), la CLI imprime el aviso una vez en stderr, nunca en el
valor de `--json`.

Sin flags, `login` inicia sesión a través del navegador. Imprime un código corto y
un enlace a la consola, abre el navegador y espera mientras apruebas el
inicio de sesión allí. Si ya has iniciado sesión en la consola, o puedes iniciar
sesión con cualquiera de los métodos ofrecidos (contraseña, Google, GitHub, LinkedIn).
Comprueba que el navegador muestre el mismo código antes de aprobarlo. El enlace
caduca tras diez minutos y funciona una sola vez. Sin una terminal, o con `--json`,
el enlace y el código se envían a stderr y `login` sigue esperando, de modo que un
agente pueda entregarte el enlace. Un inicio de sesión denegado finaliza con
`access_denied`, y uno caducado con `expired_token`.

Con `--email`, `login` pregunta si deseas usar tu contraseña o un código que el plano
de control te envía por correo electrónico. Con la autenticación de dos factores
activada, luego solicita el código del autenticador (o un código de recuperación);
a través del navegador, apruébalo desde una sesión de consola que lo haya utilizado.
Sin una terminal no se puede escribir ninguno de los dos códigos: establece
`REBASE_TOKEN` con un token de acceso creado en la consola en Settings → Access
tokens. Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Vinculación de proyectos

```bash
rebase cloud link         # link this directory to a cloud project (picked from a list)
rebase cloud link <slug>  # link the project with that slug or id, as --project <slug> does
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

Los comandos de organización (`orgs`, `billing`, `usage org`, `activity`,
`projects create`, `tokens create --can billing`) actúan sobre `--org <id>`, si no
sobre la organización que seleccionó `cloud use`, o si no sobre la organización del
proyecto vinculado. En este último caso, indican cuál utilizaron. `orgs delete`
nunca la toma del vínculo: necesita `--org` o una organización seleccionada.

### Conectar una instancia autoalojada a Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

El [conector de Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
podrá acceder a ella junto a tus proyectos de Cloud. `connect` imprime
`REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE`; configúralos en
el servidor y reinícialo. En la carpeta del proyecto, ofrece escribirlos en
`.env`. Volver a ejecutarlo es seguro. `--name` nombra la instancia, `--org`
selecciona la organización, `--no-wait` regresa sin esperar. Solo para propietarios
y administradores.

## Proyectos

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

`claim` imprime el enlace de reclamación del proyecto aprovisionado por `init --claim`
en este directorio, y el tiempo restante antes de que se elimine por no haber sido
reclamado (`Unclaimed: deleted in 41h`). `--open` también lo abre en un navegador.
El enlace se almacena únicamente en la máquina que ejecutó `init --claim`, en
`~/.rebase/credentials.json`; el plano de control guarda un hash del mismo y no puede
volver a imprimirlo. Antes de responder, `claim` consulta al plano de control si el
propio token del proyecto sigue funcionando. Una reclamación revoca ese token, por lo
que una vez que alguien ha reclamado el proyecto, `claim` lo rechaza con
`already_claimed` en lugar de imprimir un enlace inactivo. También lo rechaza una vez
transcurrido el plazo (`claim_expired`), y en un directorio que no tenga enlace de
reclamación (`no_claim_link`). `rebase cloud status` y `rebase cloud whoami` muestran
el mismo enlace mientras el proyecto no haya sido reclamado.

## Desplegar y observar

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud deploy [app] --preview [--preview-name <name>]  # its own address; production untouched
rebase cloud previews [list|delete <name>]
rebase cloud logs [--runtime] [-f] [--preview [name]]  # build log, or what the app prints
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk, realtime per instance
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sin nombre de aplicación despliega el backend. El despliegue de un bundle
de backend también sube el código fuente del proyecto —lo que git rastrea, nunca
un `.env`— para que una actualización de la plataforma pueda reconstruirlo; `--no-source`
omite esto una vez, y `cloud settings set --platform-rebuilds off` lo detiene y elimina
la copia almacenada. `--allow-downgrade` despliega una versión anterior.

Una actualización de la plataforma puede reconstruir una aplicación administrada con una
versión de `@rebasepro` más reciente que la fijada en tu checkout. Un despliegue desde
ese checkout restauraría el panel de administración y el driver anteriores, por lo que
se rechaza antes de compilar nada, indicando el comando que lo soluciona
(`rebase upgrade --to <version>`). `rebase cloud status` informa de lo mismo previamente:
una línea `Rebuilt on`, y en `--json`, `runtime.platformRebuiltVersion` y `frameworkDrift`.

Un `deploy` seguido finaliza con un resumen: cada aplicación enviada con su URL, el id
del despliegue, cuánto tiempo tardó y si la nueva versión responde allí. Espera hasta
`--live-timeout` segundos (por defecto 60; `0` omite la comprobación) a que respondan
el endpoint `/health` del backend y la dirección de cada aplicación estática. Un
despliegue fallido termina en una sola línea indicando la aplicación y el motivo, y
sale con un código distinto de cero. El resumen se imprime incluso cuando se usa en
tuberías; `--json` (o `REBASE_JSON=1`) imprime un único objeto en su lugar, con `apps`,
`hosts`, `live`, `liveChecks` y `durationMs`. Un host cuyo certificado HTTPS aún no haya
sido emitido se reporta como no activo, con dicho motivo.

Antes de subirlo, `deploy` analiza el JavaScript de cada aplicación estática que envía:
los archivos `.js`/`.mjs`/`.cjs` en su `output` y los bloques `<script>` inline en su
HTML. Un error de sintaxis detiene el despliegue indicando `file:line:column` (código
`syntax_error` con `--json`), y `--no-verify` omite la comprobación. Un despliegue
exitoso finaliza mostrando la forma de revertirlo: `rebase cloud rollback`. Una
aplicación estática desplegada por sí sola aún no se puede revertir; consulta
[Revertir](/docs/deployment/cloud#roll-back).

`--preview` sirve la compilación en `https://<project>--<name>.rebase.website` y no
modifica producción. Una vista previa del backend ejecuta su propio backend, en una
base de datos propia vacía, con sus aplicaciones estáticas integradas. Una aplicación
estática aún no se puede previsualizar por sí sola en Rebase Cloud: `rebase cloud deploy
<app> --preview` se rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada. Una vista
previa de backend se factura como una unidad de aplicación adicional en el tamaño
predeterminado mientras exista, y el despliegue indica a cuánto equivale eso al mes,
según la cotización del propio plano de control (`cost` bajo `--json`; solo la regla y
este enlace cuando el plano de control no puede calcular el precio); `rebase cloud
previews delete <name>` la detiene. `rebase cloud previews` muestra una vista previa
que la plataforma haya pausado (su base de datos superó el límite de vista previa) como
`paused`, junto con el motivo (`statusMessage` bajo `--json`). Una nueva dirección de
vista previa puede ser rechazada con `preview_cert_budget` cuando se agota el presupuesto
semanal de certificados de vista previa de la plataforma; el mensaje indica hasta cuándo.
Consulta [Previsualizar un cambio](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime el registro de compilación más reciente, y `-f` sigue
en tiempo real una compilación que aún se está ejecutando. `--runtime` lee en su lugar
lo que imprime la aplicación, desde cada pod que la respalda, etiquetando cada línea
con su pod correspondiente:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` acepta una duración (`30s`, `5m`, `1h`) o una fecha y hora RFC3339.
- `--tail <n>` es el número de líneas por pod desde donde comenzar (el plano de
  control lo limita a 2000).
- `--grep` conserva las líneas que contengan el texto, en cualquier caso; escribe
  `/re/flags` para una expresión regular.
- Con `--grep` o `--level`, el filtro busca en cada línea que devuelve el plano de
  control para la ventana (las 2000 más recientes de cada pod), y `--tail` cuenta las
  líneas coincidentes: las `n` coincidencias más recientes por pod, 500 por defecto.
  Cuando un pod tuvo más líneas en la ventana que esa cantidad, la salida indica que
  las más antiguas no se buscaron (`filter.scanCapped` bajo `--json`).
- `--level error|warn|info|debug` conserva las líneas con esa gravedad o superior.
  Lee la propiedad estructurada `severity` que registra un backend de Rebase, una
  palabra de nivel al inicio de una línea de texto plano o una estructura de error
  como `TypeError:`. Las líneas que no tengan ninguno se omiten.

Un seguimiento continuo sondea cada dos segundos e imprime cada línea una sola vez.
Notifica los pods que se inician, se detienen o se reinician. Cuando un contenedor se
reinicia, también imprime las últimas líneas de la instancia que falló, donde generalmente
se encuentra el motivo. Espera mientras no haya ningún pod en ejecución y, tras una
desconexión, reintenta con retroceso exponencial (backoff) y reanuda donde se quedó.
Con `--json`, el seguimiento imprime un objeto JSON por línea (NDJSON):
`{"type":"line","ts","pod","text"}` para cada línea de log, y
`{"type":"event","event":…}` para el resto.

`--preview <name>` lee una vista previa en lugar de producción. Usa el nombre de la
vista previa o el id de despliegue que imprimió el despliegue de la vista previa.
Por sí solo, `--preview` lee la única vista previa del proyecto. Una vista previa
estática tiene registro de compilación pero no de ejecución (runtime), ya que no
ejecuta ningún servidor.

## Configuración

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
rebase cloud service-key [rotate] --preview <name>  # a backend preview's own key
```

`domains add` para un host que el proyecto ya posee, como uno registrado por un
despliegue desde `rebase.json`, imprime los registros DNS y el estado de ese host tal
como lo hace una nueva adición; `--json` añade `alreadyRegistered: true`. Un host
verificado se sirve a través de HTTPS una vez emitido su certificado, unos minutos
después de la verificación. Hasta entonces, el ingress responde con un certificado
provisional (placeholder), y `domains list`, `domains verify` y `status` indican
`verified, certificate pending` en lugar de live. La CLI averigua esto mediante un
protocolo de enlace (handshake) TLS con cada host verificado; `--json` lo incluye como
`certificate` (`ready`, `pending` o `unreachable`, con un `reason`).

`app-key` enumera la
clave generada por `rebase cloud init --claim` en la aplicación y escrita en `.env`
como `REBASE_API_TOKEN`, mostrando solo su prefijo y nunca su valor. Reclamar el
proyecto transfiere esa clave y deja de caducar. `app-key rotate` genera una nueva y
revoca todas las claves de agente anteriores al mismo tiempo. Escribe la nueva clave
en un `.env` que ya defina `REBASE_API_TOKEN`, y no la muestra en `--json` en ese caso.
En cualquier otro directorio, imprime la clave una sola vez. Las claves creadas en el
panel de administración de la aplicación no se modifican. Se ejecuta con tu inicio
de sesión: ningún permiso de token lo otorga.

`service-key`
imprime la generación de la `REBASE_SERVICE_KEY` del proyecto, cuándo se rotó por
última vez y si la aplicación aún se está reiniciando con la más reciente. Nunca imprime
la clave: para eso está `env reveal REBASE_SERVICE_KEY`. `service-key rotate` emite una
nueva clave y reinicia la aplicación con ella. La clave anterior sigue funcionando hasta
que finaliza el reinicio, y deja de funcionar después. Se rechaza si hay un despliegue
en curso, y se ejecuta con tu inicio de sesión. Reclamar un proyecto también rota su
clave de servicio.

Una vista previa de backend tiene su propia clave de servicio. Su primer despliegue
la crea, los redespliegues la mantienen y la clave de producción responde con un 401
en la vista previa. `service-key --preview <name>` la imprime, al igual que `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>` escribe una
nueva y reinicia únicamente el pod de esa vista previa; la clave anterior funciona hasta
que el nuevo pod esté listo. Solicita confirmación previa, y `--yes` omite la pregunta.
Ambas solicitan lo mismo que `env reveal`: el rol de propietario o administrador de la
organización, y para un token de acceso, el permiso `env` en un proyecto reclamado. La
clave y el pod de producción no se tocan.

Una vista previa de backend parte de las variables de producción, incluidas las claves
en vivo. `env set KEY=VALUE --preview` asigna a las vistas previas su propio valor,
`env unset KEY --preview` excluye la variable de ellas, `env reset KEY --preview`
restablece el valor de producción y `env list --preview` muestra las diferencias.
Producción nunca se modifica con ninguno de ellos.

`env set KEY --stdin` lee el valor desde la entrada estándar en lugar de la línea de
comandos, donde `ps` y el historial de tu shell lo mostrarían:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Se descarta un salto de línea final. La función `rebase_cloud_env_set` del servidor
MCP establece valores de esta manera.

`env set KEY --prompt` solicita el valor mediante un prompt oculto en tu terminal.
No se muestra nada en pantalla y el valor se almacena como secreto, al igual que con
`--stdin --secret`. Un agente puede proporcionarte el comando para ejecutar, de modo
que el valor nunca pase por el chat. Sin una terminal se rechaza (`input_required`)
e indica el uso de `--stdin`.

## Organizaciones

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` añade a alguien que ya tenga una cuenta de Rebase con una
dirección de correo electrónico verificada, de la misma forma que lo hace Add member
en la consola. Tienen acceso de inmediato y no se envía nada por correo electrónico.
Rebase Cloud aún no envía invitaciones, por lo que una persona sin cuenta no recibe
ningún enlace: el comando lo rechaza con `no_account` y te pide que primero se registre
y luego lo ejecutes de nuevo. Un plano de control que gestione invitaciones crea una en
su lugar e imprime su enlace (de un solo uso, válido por 7 días, aceptado solo por una
cuenta que haya verificado esa dirección); `invites` lista, revoca y reenvía dichas
invitaciones, y responde `not_served` en cualquier otro caso. `--role` es `admin` o
`member` (por defecto). Nadie es añadido como `owner`: añádelos como admin, y un
propietario podrá ascenderlos con `members role <email> owner`. Añadir miembros e
`invites` requiere una sesión de `rebase cloud login`; `REBASE_TOKEN` es rechazado.
Ambos requieren el rol de propietario o administrador; a un miembro se le notificará esto.
`members remove` pide confirmación previa (`--yes` la omite); eliminar o degradar a un
propietario requiere ser propietario, y el último propietario no puede eliminarse.
`--org <id>` selecciona una organización diferente a la elegida actualmente.

`activity` es el registro de auditoría de la organización seleccionada, ordenado desde
el más reciente: quién desplegó, revirtió, definió, eliminó o reveló una variable de
entorno (por nombre, nunca por valor), cambió un dominio, creó, restauró o descargó una
copia de seguridad, modificó el cómputo de un proyecto, detuvo o eliminó un proyecto,
cambió el rol de un miembro, o creó o revocó un token de acceso. `--action` acepta un
área (`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o una acción
completa como `env.set`. Una página contiene hasta 100 entradas (`--limit`, por defecto
50); la salida imprime el cursor `--before` para la siguiente página. `--json` devuelve
un único valor, `{ org, events, nextCursor }`. Requiere el rol de propietario o
administrador de la organización. Un token solo puede leerlo con el permiso `audit` en la
organización (`rebase cloud tokens create --can audit`). La página **Activity** de la
consola muestra el mismo registro.

## Bases de datos

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre un puerto local que *es* la base de datos gestionada (sin endpoint
público) hasta que se pulsa Ctrl-C; `--reveal` añade la contraseña. Solo para
propietarios o administradores.

## Invitados

Cada `signInAnonymously()` en una prueba, bot o visita abandonada deja una fila en los
usuarios del proyecto. Estos comandos cuentan esas filas y las eliminan, para que nadie
tenga que recorrerlas una por una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` acepta una antigüedad con una unidad: `45m`, `12h`, `30d` o `2w`. Sin `--yes`,
cuenta y no elimina nada. Funciona en proyectos de cualquier tamaño procesando en pequeños
lotes.

Solo se pueden eliminar invitados. Un invitado es una fila con `is_anonymous` activado,
sin contraseña y sin identidad vinculada, y la aplicación aplica esa regla en la sentencia
que elimina la fila, de modo que el comando no puede afectar a una cuenta real, incluso
si esta se registró un instante después de ser listada. `delete` rechaza una cuenta con
`NOT_ANONYMOUS`.

**Visto por última vez** es cuando la sesión del invitado se emitió o renovó por última
vez, o cuando se creó el invitado si ya no tiene ningún token de actualización. Un
invitado que sigue regresando no se considera antiguo, sin importar hace cuánto se creó.
Los tokens de actualización de un invitado eliminado y cualquier otra fila de autenticación
se eliminan con él.

Las filas en tus propias tablas siguen su clave foránea:

| Columna | Qué ocurre con la fila |
|---|---|
| Enlace opcional (`ON DELETE SET NULL`, por defecto) | Se conserva, dejando el enlace vacío |
| Enlace obligatorio (`ON DELETE RESTRICT`, por defecto) | Se conserva, y el invitado con ella: el invitado se marca como omitido, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Se elimina junto con el invitado |
| Sin clave foránea (un campo `userSelect`, un id simple) | Se conserva, manteniendo un id que ya no existe |

Comprueba cuáles de tus enlaces están en cascada antes de pasar `--yes`: no se puede deshacer.

El comando pasa a través del proxy de Studio de la consola, el cual contiene la clave de
la aplicación, por lo que la clave nunca llega a tu máquina. Requiere un propietario o
administrador de la organización en un proyecto cuyo acceso a Studio esté habilitado
(`rebase cloud settings set --studio on`). A un proyecto con un runtime más antiguo se le
notificará que necesita uno más nuevo. `rebase users guests --project <slug>` es el mismo
comando dentro de la familia de comandos del proyecto.

## Recursos

Lo que la plataforma mantiene para el proyecto, en comparación con lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando desaparece su
declaración; eso supondría borrar datos con un push. La mantiene, la vincula y la factura
hasta que alguien la elimine por su nombre.

## Cómputo

Lo que reserva el proyecto y cuánto cuesta.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` acepta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`.
`--scale-to-zero` está retirado: cada backend ejecuta al menos una instancia, por lo
que `true` es rechazado y `false` se ignora con una advertencia. No hay niveles de planes:
todo se tarifica por recurso. Consulta [Rebase Cloud](/docs/deployment/cloud/).

## Almacenamiento, notificaciones, clústeres, facturación y uso

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud clusters list | add | verify | registry   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
rebase cloud billing invoices [--limit N]   # issued invoices, newest first, with Stripe's hosted page
rebase cloud billing upcoming    # a preview of each subscription's next invoice
rebase cloud usage [--month YYYY-MM]   # requests used this month against the allowance, and the overage so far
rebase cloud usage org           # every project of the selected organization, with the total
```

`notifications add <url>` envía los eventos del proyecto vinculado a una URL. `--events`
acepta una lista separada por comas de `deploy.failed` (por defecto),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` y `preview.paused`. `--format slack` envía
únicamente `{ "text" }` en lugar del JSON del evento, que también incluye un `text`. La
URL es un argumento posicional porque `--url` especifica el plano de control. `add` imprime
el secreto de firma una sola vez; `--json` devuelve `{ projectId, webhook, secret }`.
`test <id>` finaliza con código 1 y `delivery_failed` cuando el receptor no aceptó
el evento de prueba. Listar está disponible para cualquier miembro de la organización;
`add`, `test` y `remove` requieren el rol de propietario o administrador. Un token los
administra con el permiso `notifications` en la organización, bajo la misma regla de roles.
Consulta [Notificaciones de Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` proporciona al clúster propio
de un cliente su propio registro de imágenes, utilizado exclusivamente para ese clúster.
Sin él, dicho clúster utiliza el registro compartido de la plataforma, y cada despliegue
en él lo indicará en sus logs. Con uno, las compilaciones suben a ese repositorio con un
token de esa cuenta, los pods descargan únicamente con esa clave y una reversión
(rollback) acepta las imágenes del proyecto almacenadas allí. Las imágenes que el proyecto
compiló previamente en el registro compartido siguen estando disponibles para pull y siguen
siendo objetivos válidos de rollback. Los tres valores van juntos; `--clear` los elimina.
La clave se sella cuando se escribe y nunca se vuelve a leer. Al igual que el resto de
`clusters`, requiere el rol platform-admin. El operador crea el repositorio y ambas cuentas
con Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` y `billing upcoming` leen los mismos datos de Stripe que la página
Billing de la consola, y están disponibles únicamente para propietarios y administradores
de la organización. Un token puede acceder a ellos, y al resto de `billing`, con el
permiso `billing` en la organización; un token creado antes de esa funcionalidad sigue
funcionando durante una versión más, con una advertencia en cada respuesta. Los importes
en `--json` se expresan en la unidad fraccionaria de la moneda (céntimos), exactamente
como los envía Stripe. Las facturas en borrador no se listan; la vista previa la calcula
Stripe y sus líneas de consumo medido continúan acumulándose hasta que se cierre el periodo.

`usage` consulta lo que el proyecto vinculado (o `--project`) ha consumido en un mes
natural, en UTC: solicitudes frente a la cuota incluida, errores 5xx, el exceso acumulado
hasta el momento en euros y, para el mes en curso, la proyección estimada a este ritmo.
El exceso es el cálculo propio del informe de sobrecostes, el mismo que indica a Stripe
cuánto facturar y que se reflejará en la factura del mes siguiente. `usage org` enumera
cada proyecto de la organización seleccionada con `rebase cloud use`, junto con el total.
Cualquier miembro de la organización puede consultarlo. Un token puede leerlo con el
permiso `logs` en el proyecto; `usage org` lista los proyectos sobre los cuales el token
dispone de dicho permiso.
`--month` acepta un mes pasado. La respuesta incluye `caveats` (salvedades), cada una
con un `code`: `storage_not_measured` (el almacenamiento de objetos marca 0),
`multi_pod_undercount` (las solicitudes atendidas mientras se ejecutan dos o más pods de la
app no se contabilizan), `partial_days`, `metering_off`, `overage_billing_off`,
`not_billed`, `billed_next_month`, `pre_claim_days` (un proyecto reclamado a partir de
un agente solo cuenta los días a partir de la reclamación) y `autoscale_not_charged`
(los pods se ejecutaron por encima de `--replicas` y esta plataforma aún no los cobra).
La respuesta de un proyecto con autoescalado también incluye `autoscale`:
`extraPodSeconds` por encima del mínimo base, `amountEur` a sus tarifas, y `charged`.

## Deploy hooks, alertas y el resto

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

`domains redirect` se configura por dominio y está desactivado de forma predeterminada,
de modo que un proyecto que sirva un host `api.` junto a su sitio conserva ambos; surte
efecto mientras el dominio esté verificado y haya otro como principal, y nunca se aplica
a un dominio en el que se sirve una aplicación. `deploy-hooks create` imprime la URL del
hook una sola vez. `deploy --git` no se puede combinar con las flags de una compilación
local, y en el runtime administrado requiere `--eject`, porque el plano de control compila
desde el código fuente. `settings set --studio` es el interruptor que los comandos del
proyecto (`rebase data`, `rebase users`, …) necesitan activado para `--project`: acceden
a la aplicación mediante el proxy de Studio de la consola. Un comando cuya ruta en el plano
de control aún no esté desplegada responde `not_served` e indica su nombre. Los comandos
destructivos solicitan confirmación previa y se rechazan con `confirmation_required`
cuando no es posible responder: añade `--yes`.
