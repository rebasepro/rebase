---
sourceHash: 4b7b199f1aa18e8d
title: rebase cloud
sidebar_label: rebase cloud
description: Los grupos de comandos para Rebase Cloud en la CLI — autenticación, enlace de proyectos, despliegues, notificaciones, configuración, organizaciones, bases de datos, recursos, cómputo, almacenamiento, clústeres, facturación y uso.
---

Todo lo relacionado con Rebase Cloud, que está en beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no
incluye la beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría
de los comandos actúan sobre el proyecto vinculado en `.rebase/cloud.json`;
`--project <id>` opera sobre uno sin necesidad de vincularlo.

Tres opciones aplican en todas partes: `--json` para salida legible por máquina
(también el valor por defecto cuando se usa en tuberías, excepto para `deploy`,
o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un plano de control
específico (o `REBASE_CLOUD_URL`), y `--project, -p <id>`.

## Autenticación

```bash
rebase cloud login      # sign in to the control plane
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` acepta `deploy`, `logs`, `env`, `database` y `backups` en un proyecto
(`--project`, o el vinculado), y `billing`, `audit` y `notifications` en una
organización: `--org`, o en su defecto la organización del proyecto, o la
seleccionada. Un token puede contener únicamente capacidades de organización.
`logs` también cubre `usage`. El alcance de cada uno se encuentra en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents). Cuando el plano
de control marca una respuesta a un token como obsoleta (un token anterior a
`billing` que lee facturación), la CLI imprime el aviso una vez en stderr, nunca
en el valor `--json`.

En una terminal sin contraseña proporcionada, `login` pregunta si deseas usar tu
contraseña o un código que el plano de control te envía por correo electrónico.
Con la autenticación de dos factores activada, luego solicita tu código de
autenticador (o un código de recuperación). Sin una terminal no se puede escribir
ninguno: establece `REBASE_TOKEN` con un token de acceso creado en la consola en
Settings → Access tokens. Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Enlace de proyectos

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

## Proyectos

```bash
rebase cloud init --claim [--name <name>]   # a live backend with no account, and a link to claim it within 72 hours
rebase cloud claim [--open]                 # that link again, and how long is left
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` imprime el enlace de reclamo del proyecto que `init --claim` aprovisionó
en este directorio y el tiempo restante antes de que se elimine sin reclamar
(`Unclaimed: deleted in 41h`). `--open` también lo abre en un navegador. El
enlace se conserva únicamente en la máquina que ejecutó `init --claim`, en
`~/.rebase/credentials.json`; el plano de control almacena un hash del mismo y no
puede volver a imprimirlo. Antes de responder, `claim` pregunta al plano de
control si el token propio del proyecto aún funciona. Un reclamo revoca ese
token, por lo que una vez que alguien ha reclamado el proyecto, `claim` lo rechaza
con `already_claimed` en lugar de imprimir un enlace inactivo. También lo rechaza
una vez que la ventana de tiempo ha terminado (`claim_expired`), y en un
directorio sin enlace de reclamo (`no_claim_link`). `rebase cloud status` y
`rebase cloud whoami` muestran el mismo enlace mientras el proyecto no haya sido
reclamado.

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
un `.env`— para que una actualización de la plataforma pueda reconstruirlo;
`--no-source` omite esto por una vez, y `cloud settings set --platform-rebuilds off`
lo detiene y elimina la copia almacenada. `--allow-downgrade` despliega una versión
anterior.

Un `deploy` con seguimiento termina con un resumen: cada aplicación entregada con
su URL, el id del despliegue, cuánto tiempo tomó y si la nueva versión responde
allí. Espera hasta `--live-timeout` segundos (por defecto 60; `0` omite la
comprobación) a que respondan el endpoint `/health` del backend y la dirección de
cada aplicación estática. Un despliegue fallido termina en una sola línea
indicando la aplicación y el motivo, y finaliza con un código de salida distinto de
cero. El resumen se imprime incluso cuando se usa en tuberías; `--json` (o
`REBASE_JSON=1`) imprime un objeto en su lugar, con `apps`, `hosts`, `live`,
`liveChecks` y `durationMs`.

Antes de subir, `deploy` analiza el JavaScript de cada aplicación estática que
envía: los archivos `.js`/`.mjs`/`.cjs` en su `output` y los bloques `<script>`
inline en su HTML. Un error de sintaxis detiene el despliegue con `file:line:column`
(código `syntax_error` bajo `--json`), y `--no-verify` omite la comprobación. Un
despliegue exitoso termina indicando cómo revertirlo: `rebase cloud rollback`.
Una aplicación estática desplegada por sí sola aún no se puede revertir; consulta
[Revertir](/docs/deployment/cloud#roll-back).

`--preview` sirve la compilación en `https://<project>--<name>.rebase.website` y
no afecta a producción. Una previsualización del backend ejecuta su propio backend,
en su propia base de datos vacía, con sus aplicaciones estáticas integradas. Una
aplicación estática aún no se puede previsualizar por sí sola en Rebase Cloud:
`rebase cloud deploy <app> --preview` se rechaza con `PREVIEW_STATIC_UNSERVED` y
no publica nada. Una previsualización de backend se factura como una unidad de
aplicación adicional en el tamaño predeterminado mientras exista, y el despliegue
indica a cuánto asciende eso por mes, a partir del presupuesto propio del plano
de control (`cost` bajo `--json`; solo la regla y este enlace cuando el plano de
control no puede cotizarlo); `rebase cloud previews delete <name>` la detiene.
`rebase cloud previews` muestra una previsualización pausada por la plataforma
(su base de datos superó el límite de previsualización) como `paused`, con el
motivo (`statusMessage` bajo `--json`). Se puede rechazar una nueva dirección de
previsualización con `preview_cert_budget` cuando se agota el presupuesto semanal
de certificados de previsualización de la plataforma; el mensaje indica hasta cuándo.
Consulta [Previsualizar un cambio](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime el registro de compilación más reciente, y `-f` sigue
un build que aún se está ejecutando. `--runtime` lee en su lugar lo que imprime la
aplicación, desde cada pod detrás de ella, con cada línea etiquetada con su pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` acepta una duración (`30s`, `5m`, `1h`) o una marca temporal RFC3339.
- `--tail <n>` es el número de líneas por pod desde donde comenzar (el plano de
  control lo limita a 2000).
- `--grep` conserva las líneas que contienen el texto, sin distinguir mayúsculas
  de minúsculas; escribe `/re/flags` para una expresión regular.
- `--level error|warn|info|debug` conserva las líneas con esa severidad o peor.
  Lee la `severity` estructurada que registra un backend de Rebase, una palabra de
  nivel al inicio de una línea simple o un formato de error como `TypeError:`. Las
  líneas que no contengan ninguno se omiten.

El seguimiento sondea cada dos segundos e imprime cada línea una sola vez. Anuncia
los pods que se inician, se detienen o se reinician. Cuando un contenedor se
reinicia, también imprime las últimas líneas de la instancia caída, donde
generalmente se encuentra el motivo. Espera mientras no haya ningún pod en
ejecución y, tras una desconexión, reintenta con retroceso exponencial (backoff) y
se reanuda donde se quedó. Con `--json`, el seguimiento imprime un objeto JSON por
línea (NDJSON): `{"type":"line","ts","pod","text"}` para cada línea de log, y
`{"type":"event","event":…}` para el resto.

`--preview <name>` lee una previsualización en lugar de producción. Usa el nombre
de la previsualización o el id de despliegue que imprimió un deploy de
previsualización. Por sí solo, `--preview` lee la única previsualización del
proyecto. Una previsualización estática tiene un log de compilación pero no un
log de tiempo de ejecución (runtime), ya que no ejecuta ningún servidor.

## Configuración

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
rebase cloud app-key [rotate]           # the app key init --claim wrote; owners and admins
rebase cloud service-key [rotate]       # REBASE_SERVICE_KEY; owners and admins
```

`app-key` lista la clave que `rebase cloud init --claim` generó en la aplicación
y escribió en `.env` como `REBASE_API_TOKEN`, mostrando solo su prefijo y nunca su
valor. Al reclamar el proyecto se transfiere esa clave y deja de expirar. `app-key
rotate` genera una nueva y revoca todas las claves de agente anteriores al mismo
tiempo. Escribe la nueva clave en un `.env` que ya defina `REBASE_API_TOKEN`, y
la mantiene fuera de `--json` allí. En cualquier otro directorio imprime la clave
una vez. Las claves creadas en el panel de administración de la aplicación no se
modifican. Se ejecuta con tu inicio de sesión: ninguna capacidad de token lo autoriza.

`service-key` imprime la generación del `REBASE_SERVICE_KEY` del proyecto, cuándo
se rotó por última vez y si la aplicación aún se está reiniciando con la más
reciente. Nunca imprime la clave: para eso está `env reveal REBASE_SERVICE_KEY`.
`service-key rotate` emite una nueva clave y reinicia la aplicación con ella. La
clave anterior funciona hasta que el reinicio haya finalizado, y no después. Se
rechaza mientras un despliegue está en ejecución, y se ejecuta con tu inicio de
sesión. Reclamar un proyecto también rota su clave de servicio.

Una previsualización de backend parte de las variables de producción, incluidas
las claves en vivo. `env set KEY=VALUE --preview` otorga a las previsualizaciones
su propio valor, `env unset KEY --preview` excluye la variable de ellas, `env
reset KEY --preview` restablece el valor de producción y `env list --preview`
muestra las diferencias. Producción nunca se ve afectada por ninguno de ellos.

`env set KEY --stdin` lee el valor desde la entrada estándar en lugar de la línea
de comandos, donde `ps` y el historial de tu shell lo mostrarían:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Se descarta el salto de línea final. La herramienta `rebase_cloud_env_set` del
servidor MCP establece valores de esta forma.

## Organizaciones

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crea una invitación e imprime su enlace: de un solo uso, válido
por 7 días, aceptado únicamente por una cuenta que haya verificado esa dirección.
Nadie se une hasta que acepte, incluso alguien que ya tenga una cuenta de Rebase.
La salida (y `emailDelivery` en `--json`) indica si se envió por correo; si no fue
así, una advertencia indica que debes enviar el enlace tú mismo. `--role` es
`admin` o `member` (por defecto). Nadie es invitado como `owner`: invítalos como
admin, y un propietario los asciende con `members role <email> owner` una vez que
se hayan unido. `invites resend` proporciona un enlace nuevo y el anterior deja de
funcionar. Invitar y gestionar `invites` requiere una sesión de `rebase cloud
login`; `REBASE_TOKEN` es rechazado. Invitar, listar, reenviar y revocar requieren
el rol de propietario o administrador; a un miembro se le informa al respecto.
`members remove` pide confirmación primero (`--yes` la omite); eliminar o degradar
a un propietario requiere ser propietario, y el último propietario debe permanecer.
`--org <id>` selecciona una organización distinta a la seleccionada.

`activity` es el registro de auditoría de la organización seleccionada, de más
reciente a más antiguo: quién desplegó, revirtió, definió, eliminó o reveló una
variable de entorno (por nombre, nunca por valor), cambió un dominio, creó,
restauró o descargó una copia de seguridad, modificó el cómputo de un proyecto,
detuvo o eliminó un proyecto, cambió el rol de un miembro, o creó o revocó un
token de acceso. `--action` toma un área (`deploy`, `deploy_hook`, `env`,
`domain`, `backup`, `pitr`, `database`, `extension`, `storage`, `project`,
`org`, `member`, `invite`, `token`) o una acción completa como `env.set`. Una
página contiene hasta 100 entradas (`--limit`, 50 por defecto); la salida imprime
el cursor `--before` para la siguiente. `--json` es un único valor, `{ org, events,
nextCursor }`. Requiere el rol de propietario o administrador de la organización.
Un token solo lo lee con la capacidad `audit` en la organización (`rebase cloud
tokens create --can audit`). La página **Activity** de la consola muestra el mismo
registro.

## Bases de datos

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre un puerto local que *es* la base de datos administrada (sin
endpoint público) hasta presionar Ctrl-C; `--reveal` añade la contraseña. Solo para
propietario o administrador.

## Invitados

<span class="since-badge" data-since="0.27">Desde 0.27</span>

Cada `signInAnonymously()` en una prueba, un bot o una visita abandonada deja una
fila en los usuarios del proyecto. Estos comandos cuentan esas filas y las
eliminan, para que nadie tenga que hacer clic en ellas una por una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` toma una antigüedad con una unidad: `45m`, `12h`, `30d` o `2w`. Sin
`--yes` cuenta y no elimina nada. Procesa proyectos de cualquier tamaño en pequeños
lotes.

Solo se pueden eliminar invitados. Un invitado es una fila con `is_anonymous`
activado, sin contraseña y sin identidad vinculada, y la aplicación aplica esa
regla en la sentencia que elimina la fila, de modo que el comando no puede afectar
a una cuenta, incluso a una que se haya registrado un momento después de haber sido
listada. `delete` rechaza una cuenta con `NOT_ANONYMOUS`.

**Última visualización (Last seen)** es cuando la sesión del invitado se emitió o
renovó por última vez, o cuando se creó el invitado si ya no le queda ningún token
de actualización (refresh token). Un invitado que sigue regresando no se considera
antiguo, sin importar hace cuánto se haya creado. Los tokens de actualización de
un invitado eliminado y cualquier otra fila de autenticación se eliminan con él.

Las filas en tus propias tablas siguen su clave foránea:

| Columna | Qué le sucede a la fila |
|---|---|
| Enlace opcional (`ON DELETE SET NULL`, por defecto) | Se conserva, con el enlace vacío |
| Enlace obligatorio (`ON DELETE RESTRICT`, por defecto) | Se conserva, y el invitado junto con ella: el invitado se reporta como omitido, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Se elimina junto con el invitado |
| Sin clave foránea (un campo `userSelect`, un simple id) | Se conserva, manteniendo un id que ya no existe |

Comprueba cuáles de tus enlaces están en cascada antes de pasar `--yes`: no se puede
deshacer.

El comando lee `REBASE_SERVICE_KEY` de la misma manera que `env reveal`, por lo
que requiere un propietario o administrador (o un token con la capacidad `env` que
pertenezca a uno). La clave permanece en memoria y solo va a la propia dirección
del proyecto. A un proyecto en un runtime anterior se le notifica que necesita
uno más reciente.

## Recursos

Lo que la plataforma contiene para el proyecto, frente a lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando desaparece su
declaración; eso equivaldría a datos eliminados por un push. La mantiene, vincula
y factura hasta que alguien la limpie (`prune`) por su nombre.

## Cómputo

Lo que reserva el proyecto y cuánto cuesta.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` acepta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`.
`--scale-to-zero` está retirado: cada backend ejecuta al menos una instancia, por
lo que `true` se rechaza y `false` se ignora con una advertencia. No hay niveles
de planes: todo se tarifa por recurso. Consulta
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

`notifications add <url>` envía los eventos del proyecto vinculado a una URL.
`--events` toma una lista separada por comas de `deploy.failed` (por defecto),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` y `preview.paused`. `--format slack`
envía `{ "text" }` solo en lugar del JSON del evento, que también incluye un
`text`. La URL es un argumento posicional porque `--url` especifica el plano de
control. `add` imprime el secreto de firma una vez; `--json` devuelve
`{ projectId, webhook, secret }`. `test <id>` sale con código 1 y
`delivery_failed` cuando el receptor no aceptó el evento de prueba. Listar está
disponible para cualquier miembro de la organización; `add`, `test` y `remove`
requieren el rol de propietario o administrador. Un token los administra con la
capacidad `notifications` en la organización, bajo la misma regla de rol. Consulta
[Notificaciones de Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` proporciona al clúster
propio de un cliente un registro de imágenes propio, utilizado únicamente para ese
clúster. Sin uno, dicho clúster utiliza el registro compartido de la plataforma, y
cada despliegue en él lo indica en su log. Con uno, las compilaciones hacen push
a ese repositorio con un token para esa cuenta, los pods hacen pull únicamente
con esa clave y una reversión acepta las imágenes del proyecto allí. Las imágenes
que el proyecto compiló previamente en el repositorio compartido continúan
estando disponibles para pull y como objetivos de reversión. Los tres valores van
juntos; `--clear` los elimina. La clave se sella cuando se escribe y nunca se
vuelve a leer. Al igual que el resto de `clusters`, requiere el rol de
platform-admin. El operador crea el repositorio y ambas cuentas con Terraform
(`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` y `billing upcoming` leen los mismos datos de Stripe que la
página Billing de la consola, y están abiertos únicamente para los propietarios y
administradores de la organización. Un token puede acceder a ellos, y al resto de
`billing`, con la capacidad `billing` en la organización; un token creado antes de
esa capacidad sigue funcionando durante una versión, con una advertencia en cada
respuesta. Los importes en `--json` están en la unidad menor de la moneda
(centavos), exactamente como los envía Stripe. Las facturas en borrador no se
listan; la vista previa la calcula Stripe y sus líneas de uso medido siguen
creciendo hasta que se cierra el período.

`usage` lee lo que el proyecto vinculado (o `--project`) ha utilizado en un mes
natural, en UTC: solicitudes frente a la cuota incluida, errores 5xx, el exceso
hasta el momento en euros y, para el mes en curso, hacia dónde se dirige a este
ritmo (una estimación). El exceso es el cálculo del propio informe de excesos, el
que indica a Stripe qué facturar y que se refleja en la factura del mes siguiente.
`usage org` lista todos los proyectos de la organización seleccionada con `rebase
cloud use`, junto con el total. Cualquier miembro de la organización puede leerlo.
Un token lo lee con la capacidad `logs` en el proyecto; `usage org` lista los
proyectos sobre los cuales el token posee dicha capacidad.
`--month` acepta un mes pasado. La respuesta contiene `caveats`, cada uno con un
`code`: `storage_not_measured` (el almacenamiento de objetos lee 0),
`multi_pod_undercount` (las solicitudes atendidas mientras se ejecutan dos o más
pods de la app no se contabilizan), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
proyecto reclamado desde un agente solo cuenta los días a partir del reclamo) y
`autoscale_not_charged` (se ejecutaron pods por encima de `--replicas` y esta
plataforma aún no los cobra). La respuesta de un proyecto con autoescalado también
contiene `autoscale`: `extraPodSeconds` por encima del mínimo, `amountEur` a sus
tarifas y `charged`.
