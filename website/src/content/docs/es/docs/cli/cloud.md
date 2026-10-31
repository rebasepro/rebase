---
sourceHash: 4b7b199f1aa18e8d
title: rebase cloud
sidebar_label: rebase cloud
description: Los grupos de comandos para Rebase Cloud en la CLI — autenticación, vinculación de proyectos, despliegues, notificaciones, configuración, organizaciones, bases de datos, recursos, cómputo, almacenamiento, clústeres, facturación y uso.
---

Todo lo relacionado con Rebase Cloud, que está en beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no
incluye la versión beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos
actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera sobre
uno sin vincularlo.

Hay tres opciones aplicables en todas partes: `--json` para salida legible por máquina (también la opción predeterminada en tuberías, salvo para `deploy`, o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un plano de control específico (o `REBASE_CLOUD_URL`), y `--project, -p <id>`.

## Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud login --code   # with an emailed 6-digit code: accounts made with Google, GitHub or LinkedIn
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
rebase cloud tokens create --can billing --org <id>   # a token for an organization's billing
```

`--can` acepta `deploy`, `logs`, `env`, `database` y `backups` sobre un proyecto
(`--project`, o el vinculado), y `billing`, `audit` y
`notifications` sobre una organización: `--org`, si no la organización del proyecto,
si no la seleccionada. Un token puede tener únicamente capacidades de organización.
`logs` también cubre `usage`. A qué llega cada una está en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents). Cuando el plano de
control marca como obsoleta una respuesta a un token (un token anterior a que `billing`
leyera la facturación), la CLI imprime el aviso una vez por stderr, nunca en el
valor de `--json`.

En una terminal y sin contraseña indicada, `login` pregunta si usar tu contraseña
o un código que el plano de control te envía por correo. Con la autenticación de dos factores activada,
después pide el código de tu aplicación de autenticación (o un código de recuperación). Sin una terminal
no se puede escribir ninguno: define `REBASE_TOKEN` con un token de acceso creado en la consola
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
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

`claim` imprime el enlace de reclamación del proyecto que `init --claim` aprovisionó en este
directorio, y el tiempo que queda antes de que se elimine sin reclamar (`Unclaimed: deleted
in 41h`). `--open` también lo abre en un navegador. El enlace se guarda solo en la
máquina que ejecutó `init --claim`, en `~/.rebase/credentials.json`; el plano de control
almacena un hash de él y no puede volver a imprimirlo. Antes de responder, `claim`
pregunta al plano de control si el token propio del proyecto sigue funcionando. Una reclamación
revoca ese token, así que una vez que alguien ha reclamado el proyecto, `claim` se niega
con `already_claimed` en lugar de imprimir un enlace muerto. También se niega cuando
ha terminado el plazo (`claim_expired`), y en un directorio sin enlace de reclamación
(`no_claim_link`). `rebase cloud status` y `rebase cloud whoami` muestran el mismo
enlace mientras el proyecto no está reclamado.

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

`deploy` sin un nombre de aplicación despliega el backend. El despliegue de un bundle
de backend también sube el código fuente del proyecto —lo que git rastrea, nunca un `.env`— para que una
actualización de la plataforma pueda reconstruirlo; `--no-source` omite esto una vez, y `cloud settings set
--platform-rebuilds off` lo detiene y elimina la copia almacenada. `--allow-downgrade` despliega una versión anterior.

Un `deploy` seguido termina con un resumen: cada aplicación desplegada con su URL, el id del despliegue, cuánto tardó y si la nueva versión responde allí. Espera hasta `--live-timeout` segundos (60 por defecto; `0` omite la comprobación) a que respondan el `/health` del backend y la dirección de cada aplicación estática. Un despliegue fallido termina con una línea que nombra la aplicación y el motivo, y sale con un código distinto de cero. El resumen se imprime también en tuberías; `--json` (o `REBASE_JSON=1`) imprime en su lugar un objeto con `apps`, `hosts`, `live`, `liveChecks` y `durationMs`.

Antes de subir nada, `deploy` analiza el JavaScript de cada aplicación estática que publica: los archivos `.js`/`.mjs`/`.cjs` de su `output` y los bloques `<script>` en línea de su HTML. Un error de sintaxis detiene el despliegue con `file:line:column` (código `syntax_error` con `--json`), y `--no-verify` omite la comprobación. Un despliegue exitoso termina con el camino de vuelta, `rebase cloud rollback`. Una aplicación estática desplegada por separado todavía no admite rollback; consulta [Rollback](/docs/deployment/cloud#roll-back).

`--preview` sirve la compilación en `https://<project>--<name>.rebase.website` y
deja la producción intacta. La previsualización del backend ejecuta su propio backend, sobre una
base de datos vacía y propia, con sus aplicaciones estáticas integradas. Una aplicación estática todavía no se puede
previsualizar por sí sola en Rebase Cloud: `rebase cloud deploy <app> --preview`
se rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada. Una previsualización de backend
se factura como una unidad de app más al tamaño por defecto mientras exista, y
el despliegue indica a cuánto asciende por mes, según la propia cotización del plano de control
(`cost` con `--json`; solo la regla y este enlace cuando el plano de control no puede
cotizarla); `rebase cloud previews delete <name>` la detiene. `rebase cloud previews`
muestra como `paused` una previsualización que la plataforma pausó (su base de datos superó el límite de previsualización),
con el motivo (`statusMessage` con `--json`). Una dirección de previsualización nueva
puede ser rechazada con `preview_cert_budget` cuando se agota el presupuesto semanal de la plataforma de
certificados de previsualización; el mensaje indica hasta cuándo.
Consulta [Previsualizar un cambio](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime el último log de compilación, y `-f` sigue una compilación que
aún se está ejecutando. `--runtime` lee en su lugar lo que imprime la app, de cada pod
que hay detrás, con cada línea etiquetada con su pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` acepta una duración (`30s`, `5m`, `1h`) o una hora RFC3339.
- `--tail <n>` son las líneas por pod desde las que empezar (el plano de control lo limita a 2000).
- `--grep` conserva las líneas que contienen el texto, sin distinguir mayúsculas; escribe `/re/flags` para una
  expresión regular.
- `--level error|warn|info|debug` conserva las líneas de esa gravedad o peor. Lee
  el `severity` estructurado que registra un backend de Rebase, una palabra de nivel al inicio de una
  línea simple, o una forma de error como `TypeError:`. Las líneas sin ninguna se omiten.

Un seguimiento consulta cada dos segundos e imprime cada línea una vez. Anuncia los pods
que arrancan, se detienen o se reinician. Cuando un contenedor se reinicia, también imprime las últimas
líneas de la instancia que murió, donde suele estar el motivo. Espera mientras no hay ningún
pod en ejecución, y tras una conexión caída reintenta con backoff y
continúa donde lo dejó. Con `--json`, un seguimiento imprime un objeto JSON por
línea (NDJSON): `{"type":"line","ts","pod","text"}` por cada línea de log, y
`{"type":"event","event":…}` para el resto.

`--preview <name>` lee una previsualización en lugar de la producción. Usa el nombre de la
previsualización, o el id de despliegue que imprimió un despliegue de previsualización. Por sí solo, `--preview`
lee la única previsualización del proyecto. Una previsualización estática tiene log de compilación pero no
log de runtime, porque no ejecuta ningún servidor.

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
clave que `rebase cloud init --claim` creó en la app y escribió en `.env` como
`REBASE_API_TOKEN`, por su prefijo y nunca por su valor. Reclamar el proyecto
entrega esa clave y deja de caducar. `app-key rotate` crea una nueva y
revoca de golpe todas las claves de agente anteriores. Escribe la nueva clave en un `.env`
que ya define `REBASE_API_TOKEN`, y la mantiene fuera de `--json` allí. En
cualquier otro directorio imprime la clave una vez. Las claves creadas en el panel de administración
de la app no se tocan. Se ejecuta con tu inicio de sesión: ninguna capacidad de token lo concede.

`service-key`
imprime la generación del `REBASE_SERVICE_KEY` del proyecto, cuándo se rotó
por última vez y si la app sigue reiniciándose con la más reciente. Nunca
imprime la clave: eso es `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite una clave nueva y reinicia la app con ella. La clave anterior funciona hasta que el
reinicio ha terminado, y nada después. Se rechaza mientras hay un despliegue en
curso, y se ejecuta con tu inicio de sesión. Reclamar un proyecto también rota su clave
de servicio.

La previsualización de un backend parte de las variables de producción, claves reales incluidas.
`env set KEY=VALUE --preview` da a las previsualizaciones su propio valor, `env unset KEY
--preview` deja la variable fuera de ellas, `env reset KEY --preview` devuelve
el valor de producción, y `env list --preview` muestra las diferencias.
Ninguno de ellos modifica la producción.

`env set KEY --stdin` lee el valor de la entrada estándar en lugar de la
línea de comandos, donde `ps` y el historial de tu shell lo mostrarían:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Se descarta un salto de línea final. El `rebase_cloud_env_set` del servidor MCP establece
los valores de esta forma.

## Organizations

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` abre una invitación e imprime su enlace: de un solo uso,
válido 7 días, que solo acepta una cuenta que haya verificado esa dirección.
Nadie se une hasta que acepta, ni siquiera quien ya tiene una cuenta de Rebase.
La salida (y `emailDelivery` en `--json`) indica si se envió por correo; cuando
no se envió, una advertencia dice que envíes tú el enlace. `--role` es `admin` o
`member` (por defecto). Nadie es invitado como `owner`: invítalo como administrador, y
un propietario lo promueve con `members role <email> owner` una vez que se haya unido.
`invites resend` da un enlace nuevo y el anterior deja de funcionar.
Invitar y `invites` requieren una sesión de `rebase cloud login`; `REBASE_TOKEN` se
rechaza. Invitar, listar, reenviar y revocar requieren el rol de propietario o administrador;
a un miembro se le informa de ello.
`members remove` pregunta antes (`--yes` lo omite); eliminar o degradar a un propietario
requiere un propietario, y el último propietario permanece. `--org <id>` elige una organización
distinta de la seleccionada.

`activity` es el registro de auditoría de la organización seleccionada, de más reciente a más antiguo: quién
desplegó, hizo rollback, definió, eliminó o reveló una variable de entorno (por
nombre, nunca por valor), cambió un dominio, creó, restauró o descargó una copia de
seguridad, cambió el cómputo de un proyecto, detuvo o eliminó un proyecto, cambió el rol de un
miembro, o creó o revocó un token de acceso. `--action` acepta un área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o una acción completa
como `env.set`. Una página contiene hasta 100 entradas (`--limit`, 50 por defecto); la
salida imprime el cursor `--before` para la siguiente. `--json` es un solo valor,
`{ org, events, nextCursor }`. Requiere el rol de propietario o administrador de la organización.
Un token lo lee solo con la capacidad `audit` en la organización
(`rebase cloud tokens create --can audit`). La página **Activity** de la consola
muestra el mismo registro.

## Databases

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre un puerto local que *es* la base de datos administrada (sin
endpoint público) hasta presionar Ctrl-C; `--reveal` añade la contraseña. Solo propietario o administrador.

## Guests

<span class="since-badge" data-since="0.27">Desde 0.27</span>

Cada `signInAnonymously()` en una prueba, un bot o una visita abandonada deja una fila
entre los usuarios del proyecto. Estos comandos cuentan esas filas y las eliminan, para
que nadie tenga que revisarlas una por una con clics.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` toma una antigüedad con unidad: `45m`, `12h`, `30d` o `2w`. Sin `--yes` cuenta y
no elimina nada. Recorre un proyecto de cualquier tamaño en lotes pequeños.

Solo pueden eliminarse invitados. Un invitado es una fila con `is_anonymous` activado, sin
contraseña y sin identidad vinculada, y la app aplica esa regla en la sentencia que elimina
la fila, así que el comando no puede alcanzar una cuenta, ni siquiera una que se registró un
instante después de que se listara. `delete` rechaza una cuenta con `NOT_ANONYMOUS`.

**Last seen** (visto por última vez) es el momento en que se emitió o renovó por última vez
la sesión del invitado, o el momento en que se creó el invitado si ya no le queda ningún
refresh token. Un invitado que sigue volviendo no es antiguo, por mucho tiempo que haga que
se creó. Los refresh tokens de un invitado eliminado y cualquier otra fila de autenticación
se van con él.

Las filas de tus propias tablas siguen su clave foránea:

| La columna | Qué ocurre con la fila |
|---|---|
| Vínculo opcional (`ON DELETE SET NULL`, el valor por defecto) | Se conserva, con el vínculo vaciado |
| Vínculo obligatorio (`ON DELETE RESTRICT`, el valor por defecto) | Se conserva, y el invitado con ella: el invitado se informa como omitido, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Se elimina junto con el invitado |
| Sin clave foránea (un campo `userSelect`, un id simple) | Se conserva, con un id que ya no existe |

Comprueba cuáles de tus vínculos son en cascada antes de pasar `--yes`: no se puede deshacer.

El comando lee `REBASE_SERVICE_KEY` igual que `env reveal`, así que lo puede ejecutar un
propietario o administrador (o un token con la capacidad `env` que pertenezca a uno). La
clave se queda en memoria y solo va a la dirección propia del proyecto. A un proyecto con
un runtime más antiguo se le indica que necesita uno más reciente.

## Resources

Lo que la plataforma contiene para el proyecto, en comparación con lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando su declaración desaparece;
eso implicaría borrar datos mediante un push. La mantiene, la vincula y la factura hasta que
alguien la purgue por su nombre.

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
que `true` se rechaza y `false` se ignora con una advertencia. No hay
niveles de planes: todo se tarifa por recurso. Consulta
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
acepta una lista separada por comas de `deploy.failed` (el valor por defecto),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` y `preview.paused`. `--format slack` envía
solo `{ "text" }` en lugar del JSON del evento, que también lleva un `text`. La URL
es un argumento posicional porque `--url` nombra el plano de control. `add` imprime
el secreto de firma una vez; `--json` devuelve `{ projectId, webhook, secret }`.
`test <id>` termina con 1 y el código `delivery_failed` cuando el receptor no aceptó
el evento de prueba. Listar está abierto a cualquier miembro de la organización; `add`, `test`
y `remove` requieren el rol de propietario o administrador. Un token los gestiona con la
capacidad `notifications` en la organización, dentro de la misma regla de roles. Consulta
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` da al clúster propio de un cliente
un registro de imágenes propio, usado solo para ese clúster. Sin
uno, ese clúster usa el registro compartido de la plataforma, y cada despliegue en él
lo indica en su log. Con uno, las compilaciones suben a ese repositorio con un token de
esa cuenta, los pods descargan solo con esa clave, y un rollback acepta las
imágenes del proyecto allí. Las imágenes
que el proyecto construyó antes en el repositorio compartido siguen pudiéndose descargar y siguen siendo
destinos de rollback. Los tres valores van juntos; `--clear` los olvida. La clave
se sella cuando se escribe y nunca se vuelve a leer. Como el resto de `clusters`,
requiere el rol de administrador de la plataforma. El operador crea el repositorio y las dos
cuentas con Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` y `billing upcoming` leen los mismos datos de Stripe que la
página Billing de la consola, y están abiertos solo a los propietarios y administradores
de la organización. Un token llega a ellos, y al resto de `billing`, con la capacidad
`billing` en la organización; un token creado antes de esa capacidad sigue
funcionando durante una versión, con una advertencia en cada respuesta. Los importes en `--json` están en la unidad menor de la moneda (céntimos), exactamente como
los envía Stripe. Las facturas en borrador no se listan; la previsualización la calcula
Stripe y sus líneas medidas siguen creciendo hasta que se cierra el periodo.

`usage` lee lo que el proyecto vinculado (o `--project`) ha usado en un mes
natural, en UTC: peticiones frente a la asignación incluida, errores 5xx, el exceso
acumulado en euros y, para el mes en curso, hacia dónde se encamina a este
ritmo (una estimación). El exceso es el cálculo propio del informe de exceso, el
que le dice a Stripe qué facturar, y llega a la factura del mes siguiente.
`usage org` lista todos los proyectos de la organización seleccionada con `rebase cloud
use`, y el total. Cualquier miembro de la organización puede leerlo. Un token lo lee
con la capacidad `logs` en el proyecto; `usage org` lista los proyectos en los que el
token la posee.
`--month` acepta un mes pasado. La respuesta lleva `caveats`, cada uno con un `code`: `storage_not_measured`
(el almacenamiento de objetos lee 0), `multi_pod_undercount` (las peticiones servidas mientras se ejecutan dos o
más pods de la app no se cuentan), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
proyecto reclamado desde un agente cuenta solo los días desde la reclamación) y
`autoscale_not_charged` (los pods se ejecutaron por encima de `--replicas` y esta plataforma todavía no
los cobra). La respuesta de un proyecto con autoescalado también lleva `autoscale`:
`extraPodSeconds` por encima del mínimo, `amountEur` a sus tarifas, y `charged`.
