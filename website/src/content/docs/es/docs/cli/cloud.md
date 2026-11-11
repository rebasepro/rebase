---
sourceHash: 9d048d537401732a
title: rebase cloud
sidebar_label: rebase cloud
description: Los grupos de comandos para Rebase Cloud en la CLI — autenticación, enlace de proyectos, despliegues, notificaciones, configuración, organizaciones, bases de datos, recursos, cómputo, almacenamiento, clústeres, facturación y uso.
---

Todo lo relacionado con Rebase Cloud, que se encuentra en beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber en qué consiste y qué
no incluye la beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos
actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera sobre
uno sin necesidad de vincularlo.

Tres opciones aplican en todas partes: `--json` para una salida legible por máquina (también el
valor por defecto cuando se usa una tubería/pipe, excepto para `deploy`, o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un
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

`--can` acepta `deploy`, `logs`, `env`, `database` y `backups` en un proyecto
(`--project`, o el vinculado), y `billing`, `audit` y
`notifications` en una organización: `--org`, o en su defecto la organización del proyecto,
o en su defecto la seleccionada. Un token puede tener únicamente capacidades de organización.
`logs` también cubre `usage`. A qué tiene acceso cada una se detalla en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents). Cuando el plano de
control marca una respuesta a un token como obsoleta (un token anterior a `billing`
que lee la facturación), la CLI imprime el aviso una sola vez en stderr, nunca en el
valor de `--json`.

Sin flags, `login` inicia sesión a través del navegador. Imprime un código corto y
un enlace a la consola, abre el navegador y espera mientras apruebas el
inicio de sesión allí. Debes haber iniciado sesión en la consola previamente, o iniciar sesión con
cualquier método que esta ofrezca (contraseña, Google, GitHub, LinkedIn). Verifica que el
navegador muestre el mismo código antes de aprobarlo. El enlace expira después de diez
minutos y funciona una sola vez. Sin una terminal, o con `--json`, el enlace y el código
se envían a stderr y `login` sigue esperando, de modo que un agente pueda entregarte el enlace. Un
inicio de sesión denegado finaliza con `access_denied`, y uno expirado con `expired_token`.

Con `--email`, `login` pregunta si deseas usar tu contraseña o un código que el plano de
control te envía por correo electrónico. Con la autenticación de dos factores activada, luego te pide tu
código de autenticador (o un código de recuperación); a través del navegador, aprueba desde una
sesión de consola que lo haya utilizado. Sin una terminal no se puede escribir ninguno de los dos códigos: establece
`REBASE_TOKEN` con un token de acceso creado en la consola en Settings → Access
tokens. Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Enlace de proyectos

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

### Conectar una instancia autoalojada a Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

El [conector de Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
tendrá acceso a ella junto a tus proyectos de Cloud. `connect` imprime
`REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE`; establécelos en
el servidor y reinícialo. En la carpeta del proyecto ofrece escribirlos en
`.env`. Volver a ejecutarlo es seguro. `--name` nombra la instancia, `--org` selecciona la
organización, `--no-wait` regresa sin esperar. Propietarios y administradores.

## Proyectos

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects list --all-orgs   # every organization you belong to
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` imprime el enlace de reclamación del proyecto que `init --claim` aprovisionó en este
directorio, y el tiempo restante antes de que sea eliminado sin reclamar (`Unclaimed: deleted
in 41h`). `--open` también lo abre en un navegador. El enlace solo se conserva en la
máquina que ejecutó `init --claim`, en `~/.rebase/credentials.json`; el plano de
control almacena un hash del mismo y no puede volver a imprimirlo. Antes de responder, `claim`
consulta al plano de control si el token propio del proyecto sigue funcionando. Una reclamación
revoca ese token, por lo que una vez que alguien ha reclamado el proyecto, `claim` lo rechaza
con `already_claimed` en lugar de imprimir un enlace roto. También lo rechaza una vez que la
ventana de tiempo ha finalizado (`claim_expired`), y en un directorio sin enlace de reclamación
(`no_claim_link`). `rebase cloud status` y `rebase cloud whoami` muestran el mismo
enlace mientras el proyecto permanezca sin reclamar.

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

`deploy` sin el nombre de una aplicación despliega el backend. El despliegue del paquete de un
backend también sube el código fuente del proyecto —lo que git rastrea, nunca un `.env`— para que una
actualización de la plataforma pueda reconstruirlo; `--no-source` omite esto una vez, y `cloud settings set
--platform-rebuilds off` lo desactiva y elimina la copia almacenada. `--allow-downgrade` despliega una versión anterior.

Un `deploy` con seguimiento finaliza con un resumen: cada aplicación que se distribuyó junto con su URL, el
ID del despliegue, cuánto tiempo tomó y si la nueva versión responde allí.
Espera hasta `--live-timeout` segundos (por defecto 60; `0` omite la comprobación) a que respondan
el `/health` del backend y la dirección de cada aplicación estática. Un despliegue fallido
termina con una sola línea que indica la aplicación y el motivo, y sale con un código distinto de cero. El resumen
se imprime incluso cuando se redirige con un pipe; `--json` (o `REBASE_JSON=1`) imprime un único objeto en su lugar,
con `apps`, `hosts`, `live`, `liveChecks` y `durationMs`.

Antes de subirlo, `deploy` analiza el JavaScript de cada aplicación estática que envía:
los archivos `.js`/`.mjs`/`.cjs` en su `output` y los bloques `<script>` inline en
su HTML. Un error de sintaxis detiene el despliegue con `file:line:column` (código
`syntax_error` bajo `--json`), y `--no-verify` omite la comprobación. Un despliegue exitoso
termina indicando el comando de retorno, `rebase cloud rollback`. Una aplicación estática desplegada por
sí sola aún no se puede revertir; consulta
[Revertir cambios](/docs/deployment/cloud#roll-back).

`--preview` sirve la compilación en `https://<project>--<name>.rebase.website` y
no altera producción. Una vista previa del backend ejecuta su propio backend, en una
base de datos vacía propia, integrando sus aplicaciones estáticas. Una aplicación estática aún no se puede
previsualizar de forma aislada en Rebase Cloud: `rebase cloud deploy <app> --preview`
es rechazado con `PREVIEW_STATIC_UNSERVED` y no publica nada. Una vista previa de
backend se factura como una unidad de aplicación adicional en el tamaño por defecto mientras exista, y
el despliegue indica a cuánto asciende eso por mes, a partir del propio presupuesto del plano de control
(`cost` bajo `--json`; únicamente la regla y este enlace cuando el plano de control no pueda
calcular el precio); `rebase cloud previews delete <name>` la detiene. `rebase cloud previews`
muestra una vista previa que la plataforma pausó (su base de datos creció más allá del límite de vista previa) como
`paused`, junto con el motivo (`statusMessage` bajo `--json`). Se puede rechazar una nueva dirección de vista previa
con `preview_cert_budget` cuando se agota el presupuesto semanal de certificados de vista previa de la plataforma;
el mensaje indica hasta cuándo.
Consulta [Previsualizar un cambio](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime el último registro de compilación, y `-f` sigue en tiempo real una compilación que aún
se encuentra en ejecución. `--runtime` lee en su lugar lo que imprime la aplicación, desde cada pod
asociado a ella, con cada línea etiquetada con su pod correspondiente:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` acepta una duración (`30s`, `5m`, `1h`) o una fecha/hora RFC3339.
- `--tail <n>` es el número de líneas por pod desde las que iniciar (el plano de control lo limita a 2000).
- `--grep` conserva las líneas que contienen el texto, sin distinguir mayúsculas o minúsculas; escribe `/re/flags` para una
  expresión regular.
- `--level error|warn|info|debug` conserva las líneas con esa severidad o peor. Lee
  el campo estructurado `severity` que registra un backend de Rebase, una palabra de nivel al inicio de una
  línea simple, o un patrón de error como `TypeError:`. Las líneas que no contengan ninguno se omiten.

Un seguimiento consulta cada dos segundos e imprime cada línea una sola vez. Anuncia los pods
que se inician, detienen o reinician. Cuando un contenedor se reinicia, también imprime las últimas
líneas de la instancia que finalizó, donde usualmente se encuentra el motivo. Espera mientras no haya
ningún pod en ejecución, y tras una pérdida de conexión reintenta con backoff y
se reanuda donde se interrumpió. Con `--json`, el seguimiento imprime un objeto JSON por
línea (NDJSON): `{"type":"line","ts","pod","text"}` para cada línea de log, y
`{"type":"event","event":…}` para el resto.

`--preview <name>` lee una vista previa en lugar de producción. Usa el nombre
de la vista previa o el ID de despliegue que imprimió el despliegue de vista previa. Por sí solo, `--preview`
lee la única vista previa del proyecto. Una vista previa estática tiene un registro de compilación pero no
un registro de runtime, ya que no ejecuta ningún servidor.

## Configuración

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` lista la
clave que `rebase cloud init --claim` generó en la aplicación y escribió en `.env` como
`REBASE_API_TOKEN`, mediante su prefijo y nunca su valor. Al reclamar el proyecto
se transfiere esa clave y deja de expirar. `app-key rotate` genera una nueva y
revoca todas las claves de agente anteriores a la vez. Escribe la nueva clave en un `.env`
que ya configure `REBASE_API_TOKEN`, y la excluye de `--json` en ese caso. En
cualquier otro directorio imprime la clave una sola vez. Las claves creadas en el panel de administración de la aplicación
no se modifican. Se ejecuta con tu inicio de sesión: ninguna capacidad de token la otorga.

`service-key`
imprime la generación de la variable `REBASE_SERVICE_KEY` del proyecto, cuándo se rotó por última vez
y si la aplicación aún se está reiniciando con la más reciente. Nunca
imprime la clave: para eso está `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite una nueva clave y reinicia la aplicación con ella. La clave anterior sigue funcionando hasta que
el reinicio haya finalizado, y deja de funcionar después. Se rechaza mientras un despliegue esté
en ejecución, y se ejecuta con tu sesión iniciada. Reclamar un proyecto también rota su clave
de servicio.

Una vista previa del backend parte de las variables de producción, incluidas las claves en vivo.
`env set KEY=VALUE --preview` asigna a las vistas previas su propio valor, `env unset KEY
--preview` excluye la variable de ellas, `env reset KEY --preview` restablece
el valor de producción, y `env list --preview` muestra las diferencias.
Producción nunca se modifica mediante ninguno de ellos.

`env set KEY --stdin` lee el valor desde la entrada estándar en lugar de la
línea de comandos, donde `ps` y el historial de tu shell lo expondrían:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Se descarta un salto de línea final. La función `rebase_cloud_env_set` del servidor MCP establece
los valores de esta manera.

## Organizaciones

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crea una invitación e imprime su enlace: de un solo uso,
válido por 7 días, aceptado únicamente por una cuenta que haya verificado esa dirección de correo.
Nadie se une hasta que acepte, incluso alguien que ya tenga una cuenta de Rebase.
La salida (y `emailDelivery` en `--json`) indica si se envió por correo electrónico; si
no fue así, una advertencia indica que debes enviar el enlace manualmente. `--role` es `admin` o
`member` (por defecto). Nadie es invitado como `owner`: invítalo como admin, y
un propietario lo ascenderá con `members role <email> owner` una vez que se haya unido.
`invites resend` genera un nuevo enlace y el anterior deja de funcionar.
Invitar y usar `invites` requieren una sesión iniciada con `rebase cloud login`; `REBASE_TOKEN` es
rechazado. Invitar, listar, reenviar y revocar requieren el rol de
propietario o administrador; a un miembro se le notificará esto.
`members remove` solicita confirmación primero (`--yes` la omite); eliminar o degradar a un propietario
requiere ser propietario, y el último propietario debe permanecer. `--org <id>` selecciona una organización
distinta de la seleccionada.

`activity` es el registro de auditoría de la organización seleccionada, del más reciente al más antiguo: quién
desplegó, revirtió, configuró, eliminó o reveló una variable de entorno (por
nombre, nunca por valor), cambió un dominio, creó, restauró o descargó una
copia de seguridad, modificó el cómputo de un proyecto, detuvo o eliminó un proyecto, cambió el
rol de un miembro, o creó o revocó un token de acceso. `--action` toma un área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o una acción completa
como `env.set`. Una página contiene hasta 100 entradas (`--limit`, por defecto 50); la
salida imprime el cursor `--before` para la siguiente. `--json` es un solo valor,
`{ org, events, nextCursor }`. Requiere el rol de propietario o administrador de la organización.
Un token lo lee únicamente con la capacidad `audit` en la organización
(`rebase cloud tokens create --can audit`). La página **Activity** de la consola
muestra el mismo registro.

## Bases de datos

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre un puerto local que *es* la base de datos administrada (sin endpoint
público) hasta Ctrl-C; `--reveal` agrega la contraseña. Solo para propietarios o administradores.

## Invitados

Cada `signInAnonymously()` en una prueba, un bot o una visita abandonada deja una fila
en los usuarios del proyecto. Estos comandos cuentan esas filas y las eliminan, de modo que
nadie tenga que revisarlas una por una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` toma una antigüedad con una unidad: `45m`, `12h`, `30d` o `2w`. Sin `--yes`
cuenta y no elimina nada. Procesa un proyecto de cualquier tamaño en pequeños
lotes.

Solo los invitados se pueden eliminar. Un invitado es una fila con `is_anonymous` activado, sin contraseña y sin
identidad vinculada, y la aplicación aplica esa regla en la sentencia que elimina la
fila, de modo que el comando no pueda afectar a una cuenta, incluso a una que se haya registrado un momento
después de haber sido listada. `delete` rechaza una cuenta con `NOT_ANONYMOUS`.

**Last seen** es el momento en que la sesión del invitado fue emitida o renovada por última vez, o cuando
el invitado fue creado si ya no le queda ningún token de actualización. Un invitado que sigue regresando
no se considera antiguo, sin importar hace cuánto tiempo fue creado. Los tokens de actualización de un invitado eliminado
y cualquier otra fila de autenticación se eliminan con él.

Las filas en tus propias tablas respetan su clave foránea:

| La columna | Qué ocurre con la fila |
|---|---|
| Enlace opcional (`ON DELETE SET NULL`, por defecto) | Se conserva, dejando el enlace vacío |
| Enlace requerido (`ON DELETE RESTRICT`, por defecto) | Se conserva, y el invitado con él: se reporta el invitado como omitido, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Se elimina junto con el invitado |
| Sin clave foránea (un campo `userSelect`, un id simple) | Se conserva, manteniendo un id que ya no existe |

Comprueba cuáles de tus enlaces están en cascada antes de pasar `--yes`: no se puede deshacer.

El comando lee `REBASE_SERVICE_KEY` de la misma forma que lo hace `env reveal`, por lo que requiere un
rol de propietario o administrador (o un token con la capacidad `env` que pertenezca a uno). La
clave permanece en memoria y se envía únicamente a la dirección propia del proyecto. A un proyecto con un
runtime más antiguo se le notificará que necesita uno más reciente.

## Recursos

Lo que la plataforma mantiene para el proyecto, frente a lo que su código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando su declaración desaparece; eso
supondría eliminar datos mediante un push. La mantiene, vincula y factura hasta que alguien
la elimine explícitamente (`prune`) por su nombre.

## Cómputo

Lo que el proyecto reserva y cuánto cuesta.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` acepta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`.
`--scale-to-zero` está retirado: cada backend ejecuta al menos una instancia, por lo que
`true` es rechazado y `false` es ignorado con una advertencia. No existen niveles
de planes: todo se tarifica por recurso. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

## Almacenamiento, notificaciones, clústeres, facturación y uso

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud notifications [list] | add <url> | test <id> | remove <id>   # deploy, backup, billing and usage events to Slack, Discord or any URL
rebase cloud webhooks            # retired: exits 1 (`command_retired`) and names `notifications`
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
únicamente `{ "text" }` en lugar del JSON del evento, el cual también incluye un `text`. La URL
es un argumento posicional porque `--url` especifica el plano de control. `add` imprime
el secreto de firma una sola vez; `--json` devuelve `{ projectId, webhook, secret }`.
`test <id>` finaliza con código 1 y el mensaje `delivery_failed` cuando el receptor no aceptó
el evento de prueba. Listar está abierto a cualquier miembro de la organización; `add`, `test`
y `remove` requieren el rol de propietario o administrador. Un token los gestiona con la
capacidad `notifications` en la organización, bajo la misma regla de roles. Consulta
[Notificaciones de Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` proporciona al propio
clúster de un cliente un registro de imágenes exclusivo, utilizado únicamente para ese clúster. Sin
él, dicho clúster utiliza el registro compartido de la plataforma, y cada despliegue en él
lo indicará en su registro. Con él, las compilaciones hacen push a ese repositorio con un token de
esa cuenta, los pods hacen pull únicamente con esa clave, y una reversión (rollback) acepta las
imágenes del proyecto allí. Las imágenes
que el proyecto haya compilado en el repositorio compartido anteriormente siguen siendo accesibles para pull y siguen siendo
objetivos de reversión. Los tres valores van juntos; `--clear` los elimina. La clave
se sella cuando se escribe y nunca se vuelve a leer. Al igual que el resto de `clusters`,
requiere el rol de platform-admin. El operador crea el repositorio y ambas
cuentas con Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` y `billing upcoming` leen los mismos datos de Stripe que la
página Billing de la consola, y están disponibles únicamente para los propietarios y administradores de la organización.
Un token tiene acceso a ellos, y al resto de `billing`, con la capacidad `billing`
en la organización; un token creado antes de esa capacidad sigue funcionando
durante una versión más, mostrando una advertencia en cada respuesta. Los importes en `--json` se indican en la unidad menor de la moneda (céntimos), exactamente como
los envía Stripe. Las facturas en borrador no se listan; la vista previa es calculada por
Stripe y sus líneas de consumo medido siguen aumentando hasta que se cierra el período.

`usage` lee lo que el proyecto vinculado (o `--project`) ha consumido en un mes
calendario, en UTC: peticiones frente a la cuota incluida, errores 5xx, el exceso
acumulado hasta el momento en euros y, para el mes en curso, hacia dónde se dirige a este
ritmo (una estimación). El exceso es el cálculo propio del informe de consumo excedente,
el que indica a Stripe qué facturar, y se refleja en la factura del mes siguiente.
`usage org` lista cada proyecto de la organización seleccionada con `rebase cloud
use`, junto con el total. Cualquier miembro de la organización puede leerlo. Un token lo lee
con la capacidad `logs` en el proyecto; `usage org` lista los proyectos en los que el
token dispone de dicha capacidad.
`--month` acepta un mes pasado. La respuesta incluye advertencias (`caveats`), cada una con un `code`: `storage_not_measured`
(el almacenamiento de objetos lee 0), `multi_pod_undercount` (las solicitudes atendidas mientras se ejecutan dos o
más pods de la app no se contabilizan), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
proyecto reclamado desde un agente cuenta solo los días a partir de la reclamación) y
`autoscale_not_charged` (los pods se ejecutaron por encima de `--replicas` y esta plataforma no
les aplica cargos todavía). La respuesta de un proyecto con autoescalado también incluye `autoscale`:
`extraPodSeconds` por encima del mínimo base, `amountEur` a sus tarifas vigentes, y `charged`.
