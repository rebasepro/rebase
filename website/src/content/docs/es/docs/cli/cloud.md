---
sourceHash: 784025478be49fb3
title: rebase cloud
sidebar_label: rebase cloud
description: Los grupos de comandos para Rebase Cloud en la CLI — autenticación, vinculación de proyectos, despliegues, notificaciones, configuración, organizaciones, bases de datos, recursos, cómputo, almacenamiento, clústeres, facturación y uso.
---

Todo lo relacionado con Rebase Cloud, que se encuentra en beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no
incluye la beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos
actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera sobre
uno sin vincularlo.

Tres opciones se aplican en todas partes: `--json` para salida legible por máquina (también
el valor predeterminado al usar tuberías (pipes), excepto para `deploy`, o con `REBASE_JSON=1`), `--url <origin>` para apuntar a
un plano de control específico (o `REBASE_CLOUD_URL`), y `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud access-token   # the bearer the CLI would send now, refreshed first; for scripts and the MCP server
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` acepta `deploy`, `logs`, `env`, `database` y `backups` en un proyecto
(`--project`, o el vinculado), y `billing`, `audit` y
`notifications` en una organización: `--org`, de lo contrario la organización del proyecto,
o si no la seleccionada. Un token puede contener únicamente permisos de organización.
`logs` también abarca `usage`. El alcance de cada uno se describe en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents). Cuando el plano de
control marca una respuesta a un token como obsoleta (un token anterior a `billing`
que lee facturación), la CLI muestra el aviso una vez en stderr, nunca en el
valor de `--json`.

En una terminal sin contraseña proporcionada, `login` pregunta si deseas usar tu contraseña
o un código que el plano de control te envía por correo electrónico. Con la autenticación de dos factores activada,
luego solicita tu código de autenticador (o un código de recuperación). Sin una terminal
no se puede escribir ninguno: establece `REBASE_TOKEN` con un token de acceso creado en la consola
en Settings → Access tokens. Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Project link

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
entonces se comunica con ella junto a tus proyectos de Cloud. `connect` imprime
`REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE`; configúralos en
el servidor y reinícialo. En la carpeta del proyecto, ofrece escribirlos en
`.env`. Volver a ejecutarlo es seguro. `--name` nombra la instancia, `--org` elige la
organización, `--no-wait` regresa sin esperar. Propietarios y administradores.

## Projects

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
directorio, y el tiempo restante antes de que se elimine sin reclamar (`Unclaimed: deleted
in 41h`). `--open` también lo abre en un navegador. El enlace se guarda únicamente en la
máquina que ejecutó `init --claim`, en `~/.rebase/credentials.json`; el plano de
control almacena un hash del mismo y no puede volver a imprimirlo. Antes de responder, `claim`
pregunta al plano de control si el token propio del proyecto todavía funciona. Una reclamación
revoca ese token, por lo que una vez que alguien ha reclamado el proyecto, `claim` rechaza
la operación con `already_claimed` en lugar de imprimir un enlace inactivo. También la rechaza una vez
que la ventana ha finalizado (`claim_expired`), y en un directorio sin enlace de reclamación
(`no_claim_link`). `rebase cloud status` y `rebase cloud whoami` muestran el mismo
enlace mientras el proyecto permanezca sin reclamar.

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
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk, realtime per instance
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sin nombre de aplicación despliega el backend. Un despliegue de paquete
de backend también sube el código fuente del proyecto —lo que git rastrea, nunca un `.env`— para que una
actualización de la plataforma pueda reconstruirlo; `--no-source` omite eso una vez, y `cloud settings set
--platform-rebuilds off` lo detiene y elimina la copia almacenada. `--allow-downgrade` despliega una versión anterior.

Un `deploy` seguido finaliza con un resumen: cada aplicación que se distribuyó con su URL, el
id del despliegue, cuánto tiempo tomó y si la nueva versión responde allí.
Espera hasta `--live-timeout` segundos (por defecto 60; `0` omite la comprobación) para que el
`/health` de un backend y la dirección de cada aplicación estática respondan. Un despliegue fallido
termina en una sola línea indicando la aplicación y el motivo, y finaliza con un código distinto de cero. El resumen
se imprime incluso cuando se usa una tubería (pipe); `--json` (o `REBASE_JSON=1`) imprime un objeto en su lugar,
con `apps`, `hosts`, `live`, `liveChecks` y `durationMs`.

Antes de subir, `deploy` analiza el JavaScript de cada aplicación estática que envía:
los archivos `.js`/`.mjs`/`.cjs` en su `output` y los bloques inline `<script>` en
su HTML. Un error de sintaxis detiene el despliegue con `file:line:column` (código
`syntax_error` bajo `--json`), y `--no-verify` omite la comprobación. Un despliegue
exitoso termina indicando la forma de volver atrás, `rebase cloud rollback`. Una aplicación estática desplegada por
sí sola aún no se puede revertir; consulta
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` sirve la compilación en `https://<project>--<name>.rebase.website` y
no altera producción. Una vista previa (preview) del backend ejecuta su propio backend, en una
base de datos vacía propia, con sus aplicaciones estáticas integradas. Una aplicación estática no puede
previsualizarse por sí sola en Rebase Cloud todavía: `rebase cloud deploy <app> --preview`
se rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada. Una vista previa
de backend se factura como una unidad de aplicación adicional en el tamaño predeterminado mientras exista, y
el despliegue indica a cuánto equivale por mes, según la cotización del propio plano de control
(`cost` bajo `--json`; solo la regla y este enlace cuando el plano de control no puede
calcular el precio); `rebase cloud previews delete <name>` la detiene. `rebase cloud previews`
muestra una vista previa que la plataforma pausó (su base de datos creció más allá del límite de preview) como
`paused`, con el motivo (`statusMessage` bajo `--json`). Una nueva dirección de vista previa
puede ser rechazada con `preview_cert_budget` cuando se agota el presupuesto semanal de certificados de vista
previa de la plataforma; el mensaje indica hasta cuándo.
Consulta [Previsualizar un cambio](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime el registro de compilación más reciente, y `-f` sigue en tiempo real una compilación que
todavía se está ejecutando. `--runtime` lee lo que la aplicación imprime en su lugar, desde cada pod
detrás de ella, cada línea etiquetada con su pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` acepta una duración (`30s`, `5m`, `1h`) o una hora en formato RFC3339.
- `--tail <n>` es la cantidad de líneas por pod desde donde comenzar (el plano de control lo limita a 2000).
- `--grep` conserva las líneas que contienen el texto, sin distinguir mayúsculas de minúsculas; escribe `/re/flags` para una
  expresión regular.
- `--level error|warn|info|debug` conserva las líneas en esa severidad o peor. Lee
  la `severity` estructurada que registra un backend de Rebase, una palabra de nivel al inicio de una
  línea simple, o una estructura de error como `TypeError:`. Las líneas sin ninguna de estas se omiten.

Un seguimiento continuo (follow) sondea cada dos segundos e imprime cada línea una vez. Anuncia pods
que se inician, se detienen o se reinician. Cuando un contenedor se reinicia, también imprime las últimas
líneas de la instancia que falló, donde habitualmente se encuentra el motivo. Espera mientras no haya ningún
pod en ejecución, y tras una pérdida de conexión reintenta con retroceso progresivo (backoff) y
reanuda donde se quedó. Con `--json`, el seguimiento imprime un objeto JSON por
línea (NDJSON): `{"type":"line","ts","pod","text"}` para cada línea de registro, y
`{"type":"event","event":…}` para el resto.

`--preview <name>` lee una vista previa en lugar de producción. Usa el nombre
de la vista previa, o el id de despliegue que imprimió un despliegue de preview. Por sí solo, `--preview`
lee la única vista previa del proyecto. Una vista previa estática tiene un registro de compilación pero no
un registro de tiempo de ejecución (runtime), porque no ejecuta ningún servidor.

## Config

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` enumera la
clave que `rebase cloud init --claim` generó en la aplicación y escribió en `.env` como
`REBASE_API_TOKEN`, mediante su prefijo y nunca su valor. Reclamar el proyecto
transfiere esa clave y deja de expirar. `app-key rotate` genera una nueva y
revoca todas las claves de agente anteriores al mismo tiempo. Escribe la nueva clave en un `.env`
que ya defina `REBASE_API_TOKEN`, y la excluye de `--json` en ese caso. En
cualquier otro directorio, imprime la clave una sola vez. Las claves creadas en el panel de administración de la aplicación
no se modifican. Se ejecuta con tu inicio de sesión: ningún permiso de token la otorga.

`service-key`
imprime la generación de `REBASE_SERVICE_KEY` del proyecto, cuándo se rotó por última vez
y si la aplicación todavía se está reiniciando con la más reciente. Nunca
imprime la clave: eso corresponde a `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite una nueva clave y reinicia la aplicación utilizándola. La clave anterior funciona hasta que
el reinicio haya finalizado, y nada después. Se rechaza mientras un despliegue esté
en ejecución, y se ejecuta con tu inicio de sesión. Reclamar un proyecto también rota su clave
de servicio.

Una vista previa de backend comienza a partir de las variables de producción, claves activas incluidas.
`env set KEY=VALUE --preview` da a las vistas previas su propio valor, `env unset KEY
--preview` excluye la variable de ellas, `env reset KEY --preview` restablece
el valor de producción, y `env list --preview` muestra las diferencias.
Producción nunca se modifica con ninguno de ellos.

`env set KEY --stdin` lee el valor desde la entrada estándar en lugar de la
línea de comandos, donde `ps` y el historial de tu shell lo mostrarían:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Se descarta un salto de línea final. El método `rebase_cloud_env_set` del servidor MCP establece
valores de esta manera.

## Organizations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crea una invitación e imprime su enlace: de un solo uso,
válido por 7 días, aceptado únicamente por una cuenta que haya verificado esa dirección.
Nadie se une hasta que acepte, incluso alguien que ya tenga una cuenta de Rebase.
La salida (y `emailDelivery` en `--json`) indica si se envió por correo; cuando
no fue así, una advertencia indica que envíes el enlace tú mismo. `--role` es `admin` o
`member` (por defecto). Nadie es invitado como `owner`: invítalos como admin, y
un propietario los ascenderá con `members role <email> owner` una vez que se hayan unido.
`invites resend` genera un nuevo enlace y el anterior deja de funcionar.
Invitar y usar `invites` requieren una sesión de `rebase cloud login`; `REBASE_TOKEN` se
rechaza. Invitar, listar, reenviar y revocar requieren el rol de propietario o administrador;
a un miembro se le notificará esto.
`members remove` pide confirmación previa (`--yes` la omite); eliminar o degradar a un propietario
requiere ser propietario, y el último propietario permanece. `--org <id>` selecciona una organización
distinta de la seleccionada.

`activity` es el registro de auditoría de la organización seleccionada, del más reciente al más antiguo: quién
desplegó, revirtió, definió, eliminó o reveló una variable de entorno (por
nombre, nunca por valor), modificó un dominio, creó, restauró o descargó una
copia de seguridad, modificó el cómputo de un proyecto, detuvo o eliminó un proyecto, cambió el
rol de un miembro, o creó o revocó un token de acceso. `--action` toma un área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o una acción completa
como `env.set`. Una página contiene hasta 100 entradas (`--limit`, por defecto 50); la
salida imprime el cursor `--before` para la siguiente. `--json` es un valor único,
`{ org, events, nextCursor }`. Requiere el rol de propietario o administrador de la organización.
Un token lo lee únicamente con el permiso `audit` en la organización
(`rebase cloud tokens create --can audit`). La página **Activity** de la consola
muestra el mismo registro.

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre un puerto local que *es* la base de datos gestionada (sin endpoint
público) hasta Ctrl-C; `--reveal` agrega la contraseña. Solo propietarios o administradores.

## Guests

Cada `signInAnonymously()` en una prueba, un bot o una visita abandonada deja una fila
en los usuarios del proyecto. Estos comandos cuentan esas filas y las eliminan, para que
nadie tenga que ir haciéndolo clic por clic uno a uno.

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

Solo los invitados se pueden eliminar. Un invitado es una fila con `is_anonymous` establecido, sin contraseña y sin
identidad vinculada, y la aplicación aplica esa regla en la instrucción que elimina la
fila, por lo que el comando no puede afectar a una cuenta real, incluso a una que se haya registrado un instante
después de haber sido listada. `delete` rechaza una cuenta con `NOT_ANONYMOUS`.

**Last seen** es cuando la sesión del invitado fue emitida o renovada por última vez, o cuando
el invitado fue creado si ya no le queda ningún token de actualización (refresh token). Un invitado que sigue regresando
no se considera antiguo, sin importar hace cuánto se haya creado. Los refresh tokens de un invitado eliminado
y cualquier otra fila de autenticación se eliminan junto con él.

Las filas en tus propias tablas siguen su clave foránea:

| Columna | Qué le sucede a la fila |
|---|---|
| Enlace opcional (`ON DELETE SET NULL`, el valor predeterminado) | Se conserva, con el enlace vaciado |
| Enlace requerido (`ON DELETE RESTRICT`, el valor predeterminado) | Se conserva, y el invitado con ella: el invitado se reporta como omitido, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Se elimina junto con el invitado |
| Sin clave foránea (un campo `userSelect`, un id simple) | Se conserva, manteniendo un id que ya no existe |

Comprueba cuáles de tus enlaces están en cascada antes de pasar `--yes`: no se puede deshacer.

El comando lee `REBASE_SERVICE_KEY` del mismo modo que `env reveal`, por lo que requiere un
propietario o administrador (o un token con el permiso `env` que pertenezca a uno). La
clave permanece en memoria y se envía únicamente a la dirección propia del proyecto. A un proyecto en un
runtime más antiguo se le notificará que necesita uno más reciente.

## Resources

Lo que la plataforma mantiene para el proyecto, frente a lo que su código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando su declaración desaparece; eso
serían datos eliminados por un push. La mantiene, vincula y factura hasta que alguien
la purgue por su nombre.

## Compute

Lo que el proyecto reserva y cuánto cuesta.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` acepta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`.
`--scale-to-zero` está retirado: cada backend ejecuta al menos una instancia, por lo
que `true` se rechaza y `false` se ignora con una advertencia. No hay niveles de plan:
todo se tarifa por recurso. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

## Storage, notifications, clusters, billing and usage

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
toma una lista separada por comas de `deploy.failed` (por defecto),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` y `preview.paused`. `--format slack` envía
`{ "text" }` únicamente en lugar del JSON del evento, que también incluye un campo `text`. La URL
es un argumento posicional porque `--url` nombra al plano de control. `add` imprime
el secreto de firma una vez; `--json` devuelve `{ projectId, webhook, secret }`.
`test <id>` finaliza con código 1 y `delivery_failed` cuando el receptor no aceptó
el evento de prueba. La acción de listar está abierta a cualquier miembro de la organización; `add`, `test`
y `remove` requieren el rol de propietario o administrador. Un token los gestiona con el
permiso `notifications` en la organización, bajo la misma regla de roles. Consulta
[Notificaciones de Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` proporciona al clúster propio
de un cliente un registro de imágenes propio, usado únicamente para ese clúster. Sin
él, dicho clúster utiliza el registro compartido de la plataforma, y cada despliegue hacia él
lo indica en su registro. Con uno, las compilaciones suben a ese repositorio con un token para
esa cuenta, los pods descargan solo con esa clave, y un rollback acepta las
imágenes del proyecto allí. Las imágenes
que el proyecto haya compilado en el repositorio compartido anteriormente siguen siendo descargables y siguen
siendo objetivos de reversión (rollback). Los tres valores van juntos; `--clear` los elimina. La clave
se sella cuando se escribe y nunca se vuelve a leer. Al igual que el resto de `clusters`,
requiere el rol de administrador de plataforma (platform-admin). El operador crea el repositorio y ambas
cuentas con Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` y `billing upcoming` leen los mismos datos de Stripe que la
página Billing de la consola, y están abiertos únicamente a propietarios y administradores de la organización.
Un token puede acceder a ellos, y al resto de `billing`, con el permiso `billing`
en la organización; un token creado antes de esa funcionalidad sigue
funcionando durante una versión, con una advertencia en cada respuesta. Los importes en `--json` están en la unidad menor de la moneda (centavos), exactamente como
los envía Stripe. Las facturas en borrador no se listan; la vista previa es calculada por
Stripe y sus líneas medidas continúan aumentando hasta que se cierra el período.

`usage` lee lo que el proyecto vinculado (o `--project`) ha consumido en un mes
calendario, en UTC: solicitudes frente a la cuota incluida, errores 5xx, el exceso (overage)
hasta el momento en euros y, para el mes en curso, hacia dónde se dirige a este
ritmo (una estimación). El sobreuso es el cálculo propio del informe de exceso,
aquel que le indica a Stripe qué facturar, y se refleja en la factura del mes siguiente.
`usage org` lista cada proyecto de la organización seleccionada con `rebase cloud
use`, junto con el total. Cualquier miembro de la organización puede leerlo. Un token lo lee
con el permiso `logs` en el proyecto; `usage org` lista los proyectos en los que el
token dispone de él.
`--month` acepta un mes pasado. La respuesta contiene `caveats`, cada uno con un `code`: `storage_not_measured`
(el almacenamiento de objetos lee 0), `multi_pod_undercount` (las solicitudes atendidas mientras se ejecutan dos o
más pods de la aplicación no se cuentan), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
proyecto reclamado desde un agente cuenta solo los días a partir de la reclamación) y
`autoscale_not_charged` (los pods se ejecutaron por encima de `--replicas` y esta plataforma no
los cobra aún). La respuesta de un proyecto con autoescalado también contiene `autoscale`:
`extraPodSeconds` por encima del mínimo base, `amountEur` a sus tarifas, y `charged`.
