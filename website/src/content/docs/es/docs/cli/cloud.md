---
sourceHash: c364fafa85c26d36
title: rebase cloud
sidebar_label: rebase cloud
description: Los grupos de comandos para Rebase Cloud en la CLI — autenticación, enlace de proyectos, despliegues, notificaciones, configuración, organizaciones, bases de datos, recursos, cómputo, almacenamiento, clústeres, facturación y uso.
---

Todo lo relacionado con Rebase Cloud, que está en fase beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no
incluye la versión beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos
actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera sobre
uno sin necesidad de vincularlo.

Se aplican tres opciones en todas partes: `--json` para salida legible por máquina (también
la predeterminada cuando se usa una tubería, excepto para `deploy`, o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un
plano de control específico (o `REBASE_CLOUD_URL`), y `--project, -p <id>`.

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
`notifications` en una organización: `--org`, o en su defecto la organización del proyecto,
o la seleccionada. Un token puede contener únicamente capacidades a nivel de organización.
`logs` también cubre `usage`. Lo que abarca cada una se encuentra en
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Cuando el plano de
control marca una respuesta a un token como obsoleta (un token anterior a `billing`
que lee la facturación), la CLI imprime el aviso una vez en stderr, nunca en el
valor de `--json`.

En una terminal sin contraseña proporcionada, `login` pregunta si deseas usar tu contraseña
o un código que el plano de control te envía por correo electrónico. Con la autenticación de dos factores activada,
luego solicita el código del autenticador (o un código de recuperación). Sin una terminal
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

`claim` imprime el enlace de reclamo del proyecto que `init --claim` aprovisionó en este
directorio y el tiempo restante antes de que se elimine sin reclamar (`Unclaimed: deleted
in 41h`). `--open` también lo abre en un navegador. El enlace se guarda únicamente en la
máquina que ejecutó `init --claim`, en `~/.rebase/credentials.json`; el plano de
control almacena un hash del mismo y no puede volver a imprimirlo. Antes de responder, `claim`
consulta al plano de control si el propio token del proyecto sigue funcionando. Un reclamo
revoca ese token, por lo que una vez que alguien ha reclamado el proyecto, `claim` rechaza
la solicitud con `already_claimed` en lugar de imprimir un enlace inactivo. También la rechaza una vez transcurrido
el plazo (`claim_expired`), y en un directorio sin enlace de reclamo
(`no_claim_link`). `rebase cloud status` y `rebase cloud whoami` muestran el mismo
enlace mientras el proyecto no haya sido reclamado.

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

`deploy` sin el nombre de una app despliega el backend. El despliegue de un bundle
de backend también sube el código fuente del proyecto —lo que rastrea git, nunca un `.env`— para
que una actualización de la plataforma pueda reconstruirlo; `--no-source` omite esto en una ocasión, y `cloud settings set
--platform-rebuilds off` lo desactiva y elimina la copia almacenada. `--allow-downgrade` despliega una versión anterior.

Un `deploy` con seguimiento finaliza con un resumen: cada app entregada junto con su URL, el
id del despliegue, cuánto tardó y si la nueva versión responde allí.
Espera hasta `--live-timeout` segundos (por defecto 60; `0` omite la comprobación) a que
el `/health` del backend y la dirección de cada app estática respondan. Un despliegue fallido
termina con una línea que indica la app y el motivo, y sale con un código distinto de cero. El resumen
se imprime incluso si se redirige mediante una tubería; `--json` (o `REBASE_JSON=1`) imprime un objeto en su lugar,
con `apps`, `hosts`, `live`, `liveChecks` y `durationMs`.

Antes de subir los archivos, `deploy` analiza el JavaScript de cada app estática que entrega:
los archivos `.js`/`.mjs`/`.cjs` en su `output` y los bloques `<script>` en línea en
su HTML. Un error de sintaxis detiene el despliegue con `file:line:column` (código
`syntax_error` con `--json`), y `--no-verify` omite la comprobación. Un despliegue
exitoso finaliza indicando la vía de reversión, `rebase cloud rollback`. Una app estática desplegada
por sí sola aún no se puede revertir; consulta
[Roll back](/docs/deployment/cloud#roll-back).

`--preview` sirve la compilación en `https://<project>--<name>.rebase.website` y
no modifica producción. Una vista previa del backend ejecuta su propio backend, en una
base de datos propia vacía, con sus apps estáticas integradas. Aún no se puede
previsualizar una app estática por sí sola en Rebase Cloud: `rebase cloud deploy <app> --preview`
se rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada. Una vista previa
de backend se factura como una unidad de app adicional al tamaño por defecto mientras exista, y
el despliegue indica a cuánto asciende al mes según la cotización del propio plano de control
(`cost` con `--json`; solo la regla y este enlace cuando el plano de control no puede
calcular el precio); `rebase cloud previews delete <name>` la detiene. `rebase cloud previews`
muestra una vista previa que la plataforma pausó (su base de datos superó el límite de vista previa) como
`paused`, con el motivo (`statusMessage` con `--json`). Una nueva dirección de vista previa
puede ser rechazada con `preview_cert_budget` cuando se agota el presupuesto semanal de certificados
de vista previa de la plataforma; el mensaje indica hasta cuándo.
Consulta [Preview a change](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime el log de compilación más reciente, y `-f` sigue en tiempo real una compilación que
aún se está ejecutando. `--runtime` lee lo que imprime la app en su lugar, desde cada pod
detrás de ella, con cada línea etiquetada con su pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` acepta una duración (`30s`, `5m`, `1h`) o una marca temporal RFC3339.
- `--tail <n>` es el número de líneas por pod desde el cual comenzar (el plano de control lo limita a 2000).
- `--grep` conserva las líneas que contienen el texto, sin distinguir mayúsculas de minúsculas; escribe `/re/flags` para
  una expresión regular.
- `--level error|warn|info|debug` conserva las líneas con esa severidad o peor. Lee
  la `severity` estructurada que registra un backend de Rebase, una palabra de nivel al inicio de una
  línea simple o un formato de error como `TypeError:`. Las líneas sin ninguno de estos se omiten.

Un seguimiento (`follow`) sondea cada dos segundos e imprime cada línea una vez. Anuncia los pods
que se inician, detienen o reinician. Cuando un contenedor se reinicia, también imprime las últimas
líneas de la instancia que terminó, donde suele encontrarse la causa. Espera mientras no haya ningún
pod en ejecución y, tras una desconexión, reintenta con retroceso exponencial (backoff) y
reanuda desde donde lo dejó. Con `--json`, el seguimiento imprime un objeto JSON por
línea (NDJSON): `{"type":"line","ts","pod","text"}` para cada línea de log y
`{"type":"event","event":…}` para el resto.

`--preview <name>` lee una vista previa en lugar de producción. Usa el nombre de la vista
previa o el id de despliegue que imprimió el despliegue de preview. Por sí solo, `--preview`
lee la única vista previa del proyecto. Una vista previa estática tiene log de compilación pero no
log de tiempo de ejecución (runtime), ya que no ejecuta ningún servidor.

## Config

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` lista la
clave que `rebase cloud init --claim` generó en la app y escribió en `.env` como
`REBASE_API_TOKEN`, mediante su prefijo y nunca su valor. Reclamar el proyecto
transfiere esa clave y deja de caducar. `app-key rotate` genera una nueva y
revoca todas las claves de agente anteriores a la vez. Escribe la nueva clave en un `.env`
que ya defina `REBASE_API_TOKEN`, y la excluye de `--json` en ese caso. En
cualquier otro directorio, imprime la clave una vez. Las claves creadas en el panel de administración de la app
no se modifican. Se ejecuta con tu sesión de inicio: ninguna capacidad de token la otorga.

`service-key`
imprime la generación del `REBASE_SERVICE_KEY` del proyecto, cuándo se rotó por última
vez y si la app aún se está reiniciando con la más reciente. Nunca
imprime la clave: para eso está `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite una nueva clave y reinicia la app con ella. La clave antigua funciona hasta que el
reinicio finalice, y nada después. Se rechaza mientras haya un despliegue en
curso, y se ejecuta con tu sesión. Reclamar un proyecto también rota su service
key.

Una vista previa de backend parte de las variables de producción, claves activas incluidas.
`env set KEY=VALUE --preview` asigna a las vistas previas su propio valor, `env unset KEY
--preview` excluye la variable de ellas, `env reset KEY --preview` restablece
el valor de producción y `env list --preview` muestra las diferencias.
Ninguno de ellos modifica jamás la producción.

`env set KEY --stdin` lee el valor desde la entrada estándar en lugar de la
línea de comandos, donde `ps` y el historial de tu shell lo mostrarían:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Se descarta un salto de línea final. `rebase_cloud_env_set` del servidor MCP establece
los valores de esta manera.

## Organizations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crea una invitación e imprime su enlace: de un solo uso,
válido por 7 días, aceptado solo por una cuenta que haya verificado esa dirección.
Nadie se une hasta que la acepte, incluso alguien que ya tenga una cuenta de Rebase.
La salida (y `emailDelivery` en `--json`) indica si se envió por correo; cuando
no fue así, una advertencia indica que debes enviar el enlace tú mismo. `--role` es `admin` o
`member` (por defecto). A nadie se le invita como `owner`: invítalo como administrador, y
un propietario lo promocionará con `members role <email> owner` una vez que se haya unido.
`invites resend` genera un nuevo enlace y el anterior deja de funcionar.
Invitar y usar `invites` requieren una sesión de `rebase cloud login`; se
rechaza `REBASE_TOKEN`. Invitar, listar, reenviar y revocar requieren el rol de
owner o admin; a un miembro se le notificará esto.
`members remove` pide confirmación previa (`--yes` la omite); eliminar o degradar a un owner
requiere ser owner, y el último owner permanece. `--org <id>` selecciona una organización
distinta a la seleccionada.

`activity` es el registro de auditoría de la organización seleccionada, con los eventos más recientes primero: quién
desplegó, revirtió, definió, eliminó o reveló una variable de entorno (por
nombre, nunca por valor), cambió un dominio, creó, restauró o descargó una
copia de seguridad, cambió el cómputo de un proyecto, detuvo o eliminó un proyecto, cambió el
rol de un miembro, o creó o revocó un token de acceso. `--action` acepta un área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o una acción completa
como `env.set`. Una página contiene hasta 100 entradas (`--limit`, por defecto 50); la
salida imprime el cursor `--before` para la siguiente página. `--json` es un valor único,
`{ org, events, nextCursor }`. Requiere el rol de owner o admin de la organización.
Un token solo lo lee con la capacidad `audit` en la organización
(`rebase cloud tokens create --can audit`). La página **Activity** de la consola
muestra el mismo registro.

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre un puerto local que *es* la base de datos gestionada (sin endpoint
público) hasta que se presione Ctrl-C; `--reveal` añade la contraseña. Solo para owner o admin.

## Guests

<span class="since-badge" data-since="0.27">Desde 0.27</span>

Cada `signInAnonymously()` en una prueba, bot o visita abandonada deja una fila
en los usuarios del proyecto. Estos comandos cuentan esas filas y las eliminan, para
que nadie tenga que recorrerlas una por una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` toma una antigüedad con una unidad: `45m`, `12h`, `30d` o `2w`. Sin `--yes`,
cuenta y no elimina nada. Procesa un proyecto de cualquier tamaño en pequeños
lotes.

Solo se pueden eliminar invitados. Un invitado es una fila con `is_anonymous` activado, sin contraseña y sin
identidad vinculada, y la aplicación aplica esa regla en la instrucción que elimina la
fila, por lo que el comando no puede afectar a una cuenta real, incluso a una que se haya registrado un momento
después de haber sido listada. `delete` rechaza una cuenta con `NOT_ANONYMOUS`.

**Last seen** (visto por última vez) es cuando la sesión del invitado se emitió o renovó por última vez, o cuando
se creó el invitado si no le queda ningún token de actualización. Un invitado que sigue regresando
no se considera antiguo, sin importar hace cuánto se creó. Los tokens de actualización y cualquier
otra fila de autenticación de un invitado eliminado se suprimen con él.

Las filas en tus propias tablas siguen su clave foránea:

| La columna | Qué sucede con la fila |
|---|---|
| Enlace opcional (`ON DELETE SET NULL`, por defecto) | Se conserva, con el enlace vaciado |
| Enlace requerido (`ON DELETE RESTRICT`, por defecto) | Se conserva, y el invitado con ella: el invitado se reporta como omitido, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Se elimina junto con el invitado |
| Sin clave foránea (un campo `userSelect`, un id simple) | Se conserva, conteniendo un id que ya no existe |

Comprueba cuáles de tus enlaces están en cascada antes de pasar `--yes`: no se puede deshacer.

El comando lee `REBASE_SERVICE_KEY` de la misma manera que lo hace `env reveal`, por lo que requiere un
owner o admin (o un token con la capacidad `env` que pertenezca a uno). La
clave permanece en memoria y viaja únicamente a la propia dirección del proyecto. A un proyecto en un
runtime anterior se le notificará que necesita uno más reciente.

## Resources

Lo que la plataforma mantiene para el proyecto, frente a lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando desaparece su declaración;
eso implicaría borrar datos mediante un push. La mantiene, la vincula y la factura hasta que alguien
la depure (`prune`) por su nombre.

## Compute

Lo que reserva el proyecto y cuánto cuesta.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` acepta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`.
`--scale-to-zero` está retirado: cada backend ejecuta al menos una instancia, por lo
que `true` se rechaza y `false` se ignora con una advertencia. No hay niveles
de planes: todo se tarifica por recurso. Consulta
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
acepta una lista separada por comas de `deploy.failed` (por defecto),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` y `preview.paused`. `--format slack` envía
`{ "text" }` únicamente en lugar del JSON del evento, que también incluye un `text`. La URL
es un argumento posicional porque `--url` especifica el plano de control. `add` imprime
el secreto de firma una sola vez; `--json` devuelve `{ projectId, webhook, secret }`.
`test <id>` sale con código 1 y el error `delivery_failed` cuando el receptor no aceptó
el evento de prueba. La visualización en lista está disponible para cualquier miembro de la organización; `add`, `test`
y `remove` requieren el rol de owner o admin. Un token los administra con la
capacidad `notifications` en la organización, bajo la misma regla de roles. Consulta
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` proporciona al clúster
propio del cliente un registro de imágenes dedicado, utilizado exclusivamente para ese clúster. Sin
él, dicho clúster utiliza el registro compartido de la plataforma, y cada despliegue en él
lo indicará en sus logs. Con él, las compilaciones suben imágenes a ese repositorio con un token para
esa cuenta, los pods descargan imágenes utilizando únicamente esa clave, y un rollback acepta las
imágenes del proyecto alojadas allí. Las imágenes
que el proyecto compiló previamente en el registro compartido siguen estando disponibles para descarga y siguen siendo
objetivos válidos de reversión. Los tres valores se configuran juntos; `--clear` los elimina. La clave
se sella cuando se escribe y nunca se vuelve a leer. Al igual que el resto de `clusters`,
requiere el rol platform-admin. El operador crea el repositorio y ambas
cuentas mediante Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` y `billing upcoming` leen los mismos datos de Stripe que la
página de Facturación de la consola, y solo están disponibles para los owners y admins
de la organización. Un token accede a ellos, y al resto de `billing`, con la capacidad
`billing` en la organización; un token creado antes de esa capacidad sigue
funcionando durante una versión más, mostrando una advertencia en cada respuesta. Los importes en `--json` se expresan en la unidad fraccionaria de la moneda (céntimos/centavos), exactamente como
los envía Stripe. Las facturas en borrador no se listan; la vista previa la calcula
Stripe y sus conceptos de consumo medido continúan acumulándose hasta que se cierre el período.

`usage` consulta lo que el proyecto vinculado (o `--project`) ha consumido en un mes
natural, en UTC: solicitudes frente al límite incluido, errores 5xx, el exceso
hasta la fecha en euros y, para el mes en curso, hacia dónde se dirige a este
ritmo (una estimación). El exceso es el cálculo propio del informe de sobrecostes, el
mismo que indica a Stripe qué facturar y que se reflejará en la factura del mes siguiente.
`usage org` enumera cada proyecto de la organización seleccionada con `rebase cloud
use`, junto con el total. Cualquier miembro de la organización puede consultarlo. Un token lo consulta
con la capacidad `logs` en el proyecto; `usage org` lista los proyectos sobre los cuales el
token posee dicha capacidad.
`--month` toma un mes anterior. La respuesta incluye `caveats`, cada una con un `code`: `storage_not_measured`
(el almacenamiento de objetos marca 0), `multi_pod_undercount` (las solicitudes atendidas mientras se ejecutan dos o
más pods de la app no se contabilizan), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
proyecto reclamado desde un agente solo cuenta los días a partir de la reclamación) y
`autoscale_not_charged` (se ejecutaron pods por encima de `--replicas` y esta plataforma aún no los
cobra). La respuesta de un proyecto con autoescalado también incluye `autoscale`:
`extraPodSeconds` por encima del mínimo base, `amountEur` según sus tarifas y `charged`.
