---
sourceHash: aae5af4b5b61ddcd
title: rebase cloud
sidebar_label: rebase cloud
description: Los grupos de comandos para Rebase Cloud en la CLI — autenticación, vinculación de proyectos, despliegues, notificaciones, configuración, organizaciones, bases de datos, recursos, cómputo, almacenamiento, clústeres, facturación y uso.
---

Todo lo relacionado con Rebase Cloud, que se encuentra en fase beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no incluye la
versión beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos
actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera sobre
uno sin necesidad de vincularlo.

Tres opciones se aplican en todas partes: `--json` para una salida legible por máquina (también es la
predeterminada cuando se usa una tubería (pipe), excepto para `deploy`, o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un
plano de control específico (o `REBASE_CLOUD_URL`), y `--project, -p <id>`.

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
`notifications` en una organización: `--org`, o la organización del proyecto,
o la seleccionada. Un token puede contener solo capacidades de organización.
`logs` también cubre `usage`. El alcance de cada uno se encuentra en
[CI and agents](/docs/deployment/cloud-agents/#ci-and-agents). Cuando el plano de
control marca una respuesta a un token como obsoleta (un token anterior a `billing`
que lee la facturación), la CLI imprime el aviso una vez en stderr, nunca en el
valor de `--json`.

Sin flags, `login` inicia sesión a través del navegador. Imprime un código corto y
un enlace a la consola, abre el navegador y espera mientras apruebas el inicio
de sesión allí. Si ya has iniciado sesión en la consola, o puedes iniciar sesión con
cualquier método que ofrezca (contraseña, Google, GitHub, LinkedIn). Verifica que el
navegador muestre el mismo código antes de aprobarlo. El enlace expira después de diez
minutos y funciona una sola vez. Sin una terminal, o con `--json`, el enlace y el código
van a stderr y `login` sigue esperando, para que un agente pueda entregarte el enlace. Un
inicio de sesión denegado sale con `access_denied`, uno expirado con `expired_token`.

Con `--email`, `login` pregunta si deseas usar tu contraseña o un código que el plano de control
te envía por correo electrónico. Con la autenticación de dos factores activada, luego solicita tu
código de autenticación (o un código de recuperación); a través del navegador, aprueba desde una
sesión de consola que lo haya utilizado. Sin una terminal no se puede escribir ninguno de los dos códigos:
establece `REBASE_TOKEN` con un token de acceso creado en la consola en Settings → Access
tokens. Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Vinculación de proyectos

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
puede acceder a ella junto a tus proyectos de Cloud. `connect` imprime
`REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE`; configúralos en
el servidor y reinícialo. En la carpeta del proyecto, ofrece escribirlos en
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

`claim` imprime el enlace de reclamación del proyecto aprovisionado por `init --claim` en este
directorio y el tiempo restante antes de que sea eliminado si no se reclama (`Unclaimed: deleted
in 41h`). `--open` también lo abre en un navegador. El enlace se guarda únicamente en la
máquina que ejecutó `init --claim`, en `~/.rebase/credentials.json`; el plano de
control almacena un hash del mismo y no puede volver a imprimirlo. Antes de responder, `claim`
consulta al plano de control si el token propio del proyecto todavía funciona. Una reclamación
revoca ese token, por lo que una vez que alguien ha reclamado el proyecto, `claim` lo rechaza
con `already_claimed` en lugar de imprimir un enlace inactivo. También lo rechaza una vez que la
ventana de tiempo ha terminado (`claim_expired`), y en un directorio sin enlace de reclamación
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

`deploy` sin un nombre de aplicación despliega el backend. Un despliegue de bundle de backend
también sube el código fuente del proyecto —lo que git rastrea, nunca un `.env`— para que una
actualización de la plataforma pueda reconstruirlo; `--no-source` omite esto una vez, y `cloud settings set
--platform-rebuilds off` lo detiene y elimina la copia almacenada. `--allow-downgrade` despliega una versión anterior.

Un `deploy` seguido finaliza con un resumen: cada aplicación enviada con su URL, el
ID de despliegue, cuánto tiempo tomó y si la nueva versión responde allí.
Espera hasta `--live-timeout` segundos (por defecto 60; `0` omite la comprobación) para que el
`/health` del backend y la dirección de cada aplicación estática respondan. Un despliegue fallido
termina en una sola línea indicando la aplicación y el motivo, y sale con un código distinto de cero. El resumen
se imprime incluso a través de tuberías (pipes); `--json` (o `REBASE_JSON=1`) imprime un solo objeto en su lugar,
con `apps`, `hosts`, `live`, `liveChecks` y `durationMs`.

Antes de subir, `deploy` analiza el JavaScript de cada aplicación estática que envía:
los archivos `.js`/`.mjs`/`.cjs` en su `output` y los bloques `<script>` en línea en
su HTML. Un error de sintaxis detiene el despliegue con `file:line:column` (código
`syntax_error` bajo `--json`), y `--no-verify` omite la comprobación. Un despliegue
exitoso finaliza mostrando el camino de regreso, `rebase cloud rollback`. Una aplicación estática desplegada por
sí sola aún no se puede revertir; consulta
[Revertir](/docs/deployment/cloud#roll-back).

`--preview` sirve la compilación en `https://<project>--<name>.rebase.website` y
no afecta a producción. Una vista previa del backend ejecuta su propio backend, en una
base de datos propia vacía, con sus aplicaciones estáticas integradas. Una aplicación estática aún no se puede
previsualizar por sí sola en Rebase Cloud: `rebase cloud deploy <app> --preview`
se rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada. Una vista previa de backend
se factura como una unidad de aplicación adicional en el tamaño predeterminado mientras exista, y
el despliegue indica a cuánto equivale eso por mes, a partir de la cotización del propio plano de control
(`cost` bajo `--json`; solo la regla y este enlace cuando el plano de control no puede
calcular el precio); `rebase cloud previews delete <name>` la detiene. `rebase cloud previews`
muestra una vista previa pausada por la plataforma (su base de datos superó el límite de la vista previa) como
`paused`, con el motivo (`statusMessage` bajo `--json`). Se puede rechazar una nueva dirección de vista previa
con `preview_cert_budget` cuando se agote el presupuesto semanal de certificados de vista previa de la plataforma;
el mensaje indica hasta cuándo.
Consulta [Previsualizar un cambio](/docs/deployment/cloud/#preview-a-change).

### Registros

`rebase cloud logs` imprime el registro de compilación más reciente, y `-f` sigue una compilación que
aún está en ejecución. `--runtime` lee lo que la aplicación imprime en su lugar, desde cada pod
detrás de ella, con cada línea etiquetada con su pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` toma una duración (`30s`, `5m`, `1h`) o una hora en formato RFC3339.
- `--tail <n>` es la cantidad de líneas por pod desde donde comenzar (el plano de control lo limita a 2000).
- `--grep` conserva las líneas que contienen el texto, sin distinguir mayúsculas/minúsculas; escribe `/re/flags` para una
  expresión regular.
- Con `--grep` o `--level`, el filtro busca en cada línea que el plano de control
  devuelve para la ventana (las 2000 más recientes de cada pod), y `--tail` cuenta las líneas
  coincidentes: las `n` coincidencias más recientes por pod, 500 por defecto. Cuando un pod tenía más
  líneas en la ventana que esa cantidad, la salida indica que las más antiguas no fueron
  buscadas (`filter.scanCapped` bajo `--json`).
- `--level error|warn|info|debug` conserva las líneas con esa gravedad o superior. Lee
  la gravedad estructurada (`severity`) que registra un backend de Rebase, una palabra de nivel al inicio de una
  línea simple o una estructura de error como `TypeError:`. Las líneas sin ninguna de estas se omiten.

Un seguimiento consulta cada dos segundos e imprime cada línea una sola vez. Anuncia los pods
que se inician, se detienen o se reinician. Cuando un contenedor se reinicia, también imprime las últimas
líneas de la instancia que finalizó, donde suele encontrarse el motivo. Espera mientras no haya ningún
pod en ejecución y, tras una desconexión, reintenta con retroceso exponencial (backoff) y
reanuda donde se quedó. Con `--json`, un seguimiento imprime un objeto JSON por
línea (NDJSON): `{"type":"line","ts","pod","text"}` para cada línea de registro y
`{"type":"event","event":…}` para el resto.

`--preview <name>` lee una vista previa en lugar de producción. Usa el nombre de la vista previa,
o el ID de despliegue que imprimió un despliegue de vista previa. Por sí solo, `--preview`
lee la única vista previa del proyecto. Una vista previa estática tiene un registro de compilación pero no un
registro de tiempo de ejecución (runtime), ya que no ejecuta ningún servidor.

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

`app-key` enumera la
clave que `rebase cloud init --claim` generó en la aplicación y escribió en `.env` como
`REBASE_API_TOKEN`, por su prefijo y nunca por su valor. Reclamar el proyecto
transfiere esa clave y deja de expirar. `app-key rotate` genera una nueva y
revoca todas las claves de agentes anteriores a la vez. Escribe la nueva clave en un `.env`
que ya defina `REBASE_API_TOKEN`, y la mantiene fuera de `--json` allí. En
cualquier otro directorio, imprime la clave una sola vez. Las claves creadas en el panel de administración de la aplicación
no se tocan. Se ejecuta con tu inicio de sesión: ninguna capacidad de token lo autoriza.

`service-key`
imprime la generación del `REBASE_SERVICE_KEY` del proyecto, cuándo se rotó por última vez
y si la aplicación aún se está reiniciando con la más reciente. Nunca
imprime la clave: eso corresponde a `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite una nueva clave y reinicia la aplicación para aplicarla. La clave antigua funciona hasta que el
reinicio haya finalizado, y nada después. Se rechaza mientras un despliegue se encuentre en
ejecución, y se ejecuta con tu inicio de sesión. Reclamar un proyecto rota su
clave de servicio también.

Una vista previa de backend tiene una clave de servicio propia. Su primer despliegue la genera,
los redespliegues la conservan y la clave de producción responde 401 en la vista previa.
`service-key --preview <name>` la imprime, al igual que `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
escribe una nueva y reinicia solo el pod de esa vista previa; la clave antigua funciona hasta que
el nuevo pod esté listo. Pregunta primero, y `--yes` omite la confirmación. Ambos solicitan
lo que `env reveal` solicita: el rol de propietario o administrador de la organización, y para un
token de acceso, la capacidad `env` en un proyecto reclamado. La clave y el pod de
producción no se tocan.

Una vista previa de backend parte de las variables de producción, claves en vivo incluidas.
`env set KEY=VALUE --preview` otorga a las vistas previas su propio valor, `env unset KEY
--preview` omite la variable en ellas, `env reset KEY --preview` restablece
el valor de producción y `env list --preview` muestra las diferencias.
Producción nunca se modifica por ninguno de ellos.

`env set KEY --stdin` lee el valor desde la entrada estándar en lugar de la
línea de comandos, donde `ps` y el historial de tu shell lo mostrarían:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Se elimina un salto de línea final. La función `rebase_cloud_env_set` del servidor MCP
establece los valores de esta manera.

## Organizaciones

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crea una invitación e imprime su enlace: de un solo uso,
válido por 7 días, aceptado solo por una cuenta que haya verificado esa dirección.
Nadie se une hasta que acepte, incluso alguien que ya tenga una cuenta de Rebase.
La salida (y `emailDelivery` en `--json`) indica si se envió por correo electrónico; cuando
no fue así, una advertencia indica que debes enviar el enlace tú mismo. `--role` es `admin` o
`member` (por defecto). Nadie es invitado como `owner`: invítalos como administradores, y
un propietario los promociona con `members role <email> owner` una vez que se hayan unido.
`invites resend` genera un nuevo enlace y el antiguo deja de funcionar.
Invitar e `invites` requieren una sesión de `rebase cloud login`; `REBASE_TOKEN` es
rechazado. Invitar, listar, reenviar y revocar requieren el rol de propietario o administrador;
a un miembro se le informa de ello.
`members remove` pregunta primero (`--yes` lo omite); eliminar o degradar a un propietario
requiere ser propietario, y el último propietario permanece. `--org <id>` selecciona una organización
distinta a la seleccionada.

`activity` es el registro de auditoría de la organización seleccionada, del más reciente al más antiguo: quién
desplegó, revirtió, estableció, eliminó o reveló una variable de entorno (por
nombre, nunca por valor), cambió un dominio, creó, restauró o descargó una
copia de seguridad, modificó el cómputo de un proyecto, detuvo o eliminó un proyecto, cambió el
rol de un miembro, o creó o revocó un token de acceso. `--action` toma un área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o una acción completa
como `env.set`. Una página contiene hasta 100 entradas (`--limit`, por defecto 50); la
salida imprime el cursor `--before` para la siguiente. `--json` es un valor único,
`{ org, events, nextCursor }`. Requiere el rol de propietario o administrador de la organización.
Un token solo lo lee con la capacidad `audit` en la organización
(`rebase cloud tokens create --can audit`). La página **Activity** de la consola
muestra el mismo registro.

## Bases de datos

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre un puerto local que *es* la base de datos gestionada (sin
endpoint público) hasta presionar Ctrl-C; `--reveal` añade la contraseña. Solo propietarios o administradores.

## Invitados

Cada llamada a `signInAnonymously()` en una prueba, un bot o una visita abandonada deja una fila
en los usuarios del proyecto. Estos comandos cuentan esas filas y las eliminan, para que
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

Solo los invitados pueden eliminarse. Un invitado es una fila con `is_anonymous` activado, sin contraseña y sin
identidad vinculada, y la aplicación aplica esa regla en la instrucción que elimina la
fila, por lo que el comando no puede afectar a una cuenta real, incluso a una que se haya registrado un momento
después de haber sido listada. `delete` rechaza una cuenta con `NOT_ANONYMOUS`.

**Last seen** es el momento en que la sesión del invitado se emitió o renovó por última vez, o cuando
se creó el invitado si ya no le queda ningún token de actualización (refresh token). Un invitado que sigue regresando
no se considera antiguo, sin importar hace cuánto tiempo se haya creado. Los tokens de actualización de un invitado eliminado
y cualquier otra fila de autenticación se eliminan con él.

Las filas en tus propias tablas siguen su clave foránea:

| La columna | Qué sucede con la fila |
|---|---|
| Enlace opcional (`ON DELETE SET NULL`, por defecto) | Se conserva, con el enlace vaciado |
| Enlace obligatorio (`ON DELETE RESTRICT`, por defecto) | Se conserva, y el invitado con ella: el invitado se reporta como omitido, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Se elimina junto con el invitado |
| Sin clave foránea (un campo `userSelect`, un ID simple) | Se conserva, manteniendo un ID que ya no existe |

Comprueba cuáles de tus enlaces están en cascada antes de pasar `--yes`: no se puede deshacer.

El comando pasa a través del proxy de Studio de la consola, que mantiene la clave de la aplicación, por lo que la clave nunca llega a tu
máquina. Requiere un propietario o administrador de la organización, en un proyecto cuyo acceso a Studio esté habilitado
(`rebase cloud settings set --studio on`). A un proyecto en un runtime más antiguo se le notificará que necesita uno más reciente.
`rebase users guests --project <slug>` es el mismo comando en la familia de proyectos.

## Recursos

Lo que la plataforma mantiene para el proyecto, frente a lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando desaparece su declaración —eso
supondría borrar datos con un simple push. La mantiene, vincula y factura hasta que alguien
la elimine (prune) por su nombre.

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
que `true` se rechaza y `false` se ignora con una advertencia. No hay niveles
de planes: todo tiene un precio por recurso. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

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
toma una lista separada por comas de `deploy.failed` (por defecto),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` y `preview.paused`. `--format slack` envía
`{ "text" }` solo en lugar del JSON del evento, que también incluye un `text`. La URL
es un argumento posicional porque `--url` especifica el plano de control. `add` imprime
el secreto de firma una sola vez; `--json` devuelve `{ projectId, webhook, secret }`.
`test <id>` sale con código 1 y el código `delivery_failed` cuando el receptor no aceptó
el evento de prueba. El listado está abierto a cualquier miembro de la organización; `add`, `test`
y `remove` requieren el rol de propietario o administrador. Un token los gestiona con la
capacidad `notifications` en la organización, bajo la misma regla de roles. Consulta
[Cloud notifications](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` otorga al clúster
propio del cliente un registro de imágenes propio, utilizado únicamente para ese clúster. Sin
él, dicho clúster utiliza el registro compartido de la plataforma, y cada despliegue en él
lo indica en su registro de logs. Con él, las compilaciones hacen push a ese repositorio con un token para
esa cuenta, los pods hacen pull únicamente con esa clave y un rollback acepta las
imágenes del proyecto allí. Las imágenes
que el proyecto construyó anteriormente en el registro compartido siguen estando disponibles para hacer pull y
siguen siendo objetivos de reversión. Los tres valores van juntos; `--clear` los elimina. La clave
se sella cuando se escribe y nunca se vuelve a leer. Al igual que el resto de `clusters`,
requiere el rol platform-admin. El operador crea el repositorio y ambas
cuentas con Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` y `billing upcoming` leen los mismos datos de Stripe que la
página de Facturación (Billing) de la consola, y están abiertos únicamente a los propietarios y administradores de la organización.
Un token puede acceder a ellos, y al resto de `billing`, con la capacidad `billing`
en la organización; un token creado antes de esa capacidad sigue funcionando
durante una versión, mostrando una advertencia en cada respuesta. Los importes en `--json` están en la unidad menor de la moneda (centavos/céntimos), exactamente como
los envía Stripe. Las facturas en borrador no se listan; la vista previa la calcula
Stripe y sus líneas medidas continúan aumentando hasta que se cierre el período.

`usage` lee lo que el proyecto vinculado (o `--project`) ha utilizado en un mes
natural, en UTC: solicitudes frente a la cuota incluida, errores 5xx, el exceso
hasta el momento en euros y, para el mes en curso, hacia dónde se dirige a este
ritmo (una estimación). El exceso es el cálculo del propio informe de excesos, el
que indica a Stripe qué facturar, y aparece en la factura del mes siguiente.
`usage org` enumera cada proyecto de la organización seleccionada con `rebase cloud
use` y el total. Cualquier miembro de la organización puede leerlo. Un token lo lee
con la capacidad `logs` en el proyecto; `usage org` lista los proyectos sobre los que
el token dispone de ella.
`--month` toma un mes pasado. La respuesta incluye `caveats`, cada una con un `code`: `storage_not_measured`
(el almacenamiento de objetos marca 0), `multi_pod_undercount` (las solicitudes atendidas mientras se ejecutan dos o
más pods de la aplicación no se contabilizan), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
proyecto reclamado desde un agente cuenta solo los días a partir de la reclamación) y
`autoscale_not_charged` (se ejecutaron pods por encima de `--replicas` y esta plataforma aún no
los cobra). La respuesta de un proyecto con autoescalado también incluye `autoscale`:
`extraPodSeconds` por encima del mínimo base, `amountEur` a sus tarifas y `charged`.

## Deploy hooks, alertas y el resto

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud domains redirect <domain> [--off]   # answer it with a 308 to the primary, path and query kept
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`domains redirect` es por dominio y está desactivado de forma predeterminada, de modo que un proyecto que sirve un host `api.` junto a su sitio conserva ambos; surte efecto mientras el dominio esté verificado y otro sea el principal, y nunca se aplica a un dominio en el que se sirve una aplicación. `deploy-hooks create` imprime la URL del hook una sola vez. `deploy --git` no se puede combinar con los flags de una compilación local, y en el runtime gestionado necesita `--eject`, ya que el plano de control compila desde el código fuente. `settings set --studio` es el interruptor que los comandos de proyecto (`rebase data`, `rebase users`, …) necesitan activado para `--project`: acceden a la aplicación a través del proxy de Studio de la consola. Un comando cuya ruta en el plano de control aún no está desplegada responde `not_served` e indica su nombre. Los comandos destructivos preguntan primero y rechazan la acción con `confirmation_required` cuando nadie puede responder: pasa `--yes`.
