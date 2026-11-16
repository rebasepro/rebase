---
sourceHash: bd97024430acdcb1
title: rebase cloud
sidebar_label: rebase cloud
description: Grupos de comandos para Rebase Cloud en la CLI — autenticación, enlace de proyectos, despliegues, notificaciones, configuración, organizaciones, bases de datos, recursos, cómputo, almacenamiento, clústeres, facturación y uso.
---

Todo lo relacionado con Rebase Cloud, actualmente en beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no
incluye la versión beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos
actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera sobre
uno sin necesidad de vincularlo.

Tres opciones aplican en todas partes: `--json` para salida procesable por máquina (también
la opción predeterminada al usar tuberías, excepto para `deploy`, o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un
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

`--can` admite `deploy`, `logs`, `env`, `database` y `backups` en un proyecto
(`--project`, o el vinculado), y `billing`, `audit` y
`notifications` en una organización: `--org`, de lo contrario la organización del proyecto,
o bien la seleccionada. Un token puede contener únicamente permisos a nivel de organización.
`logs` también cubre `usage`. El alcance de cada uno se detalla en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents). Cuando el plano de
control marca una respuesta a un token como obsoleta (un token anterior a `billing`
que lee facturación), la CLI imprime el aviso una vez en stderr, nunca en el
valor de `--json`.

Sin indicadores, `login` inicia sesión a través del navegador. Imprime un código corto y
un enlace a la consola, abre el navegador y espera mientras apruebas el
inicio de sesión allí. Si ya has iniciado sesión en la consola, o puedes iniciar sesión con
cualquier método disponible (contraseña, Google, GitHub, LinkedIn). Comprueba que el
navegador muestre el mismo código antes de aprobarlo. El enlace caduca a los diez
minutos y funciona una sola vez. Sin una terminal, o con `--json`, el enlace y el código
se envían a stderr y `login` sigue esperando, permitiendo que un agente te entregue el enlace. Un
inicio de sesión denegado sale con `access_denied`, y uno caducado con `expired_token`.

Con `--email`, `login` pregunta si deseas usar tu contraseña o un código que el plano de
control te envía por correo electrónico. Con la autenticación de dos factores activada, solicita después tu
código de autenticador (o un código de recuperación); mediante el navegador, apruébalo desde una
sesión de consola que lo haya utilizado. Sin una terminal, ninguno de los dos códigos puede escribirse: define
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
podrá acceder a ella junto a tus proyectos de Cloud. `connect` imprime
`REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE`; defínelas en
el servidor y reinícialo. En la carpeta del proyecto ofrece escribirlas en
`.env`. Volver a ejecutarlo es seguro. `--name` asigna un nombre a la instancia, `--org` selecciona la
organización, `--no-wait` regresa sin esperar. Solo para propietarios (owners) y administradores (admins).

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
directorio, junto con el tiempo restante antes de que se elimine si no se reclama (`Unclaimed: deleted
in 41h`). `--open` también lo abre en un navegador. El enlace solo se conserva en la
máquina que ejecutó `init --claim`, en `~/.rebase/credentials.json`; el plano de
control almacena un hash de este y no puede volver a imprimirlo. Antes de responder, `claim`
consulta al plano de control si el token propio del proyecto sigue funcionando. Una reclamación
revoca ese token, por lo que una vez que alguien ha reclamado el proyecto, `claim` lo rechaza
con `already_claimed` en lugar de imprimir un enlace inactivo. También lo rechaza una vez que el
plazo ha expirado (`claim_expired`), y en un directorio que no tenga enlace de reclamación
(`no_claim_link`). `rebase cloud status` y `rebase cloud whoami` muestran el mismo
enlace mientras el proyecto no haya sido reclamado.

## Despliegue y observación

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

Un `deploy` seguido finaliza con un resumen: cada aplicación entregada con su URL, el
ID de despliegue, el tiempo transcurrido y si la nueva versión responde allí.
Espera hasta `--live-timeout` segundos (por defecto 60; `0` omite la comprobación) a que el
`/health` del backend y la dirección de cada aplicación estática respondan. Un despliegue fallido
finaliza con una sola línea que indica la aplicación y el motivo, saliendo con un código distinto de cero. El resumen
se imprime incluso cuando se redirige la salida (piped); `--json` (o `REBASE_JSON=1`) imprime en su lugar un único objeto,
con `apps`, `hosts`, `live`, `liveChecks` y `durationMs`.

Antes de subir, `deploy` analiza el JavaScript de cada aplicación estática que entrega:
los archivos `.js`/`.mjs`/`.cjs` en su `output` y los bloques `<script>` inline en
su HTML. Un error de sintaxis detiene el despliegue indicando `archivo:línea:columna` (código
`syntax_error` bajo `--json`), y `--no-verify` omite la comprobación. Un despliegue
exitoso termina ofreciendo la opción de revertir, `rebase cloud rollback`. Una aplicación estática desplegada por
separado aún no se puede revertir; consulta
[Reversión](/docs/deployment/cloud#roll-back).

`--preview` sirve la compilación en `https://<project>--<name>.rebase.website` y
deja producción intacta. Una vista previa (preview) del backend ejecuta su propio backend, en una
base de datos propia vacía, incorporando sus aplicaciones estáticas. Una aplicación estática aún no puede
previsualizarse por separado en Rebase Cloud: `rebase cloud deploy <app> --preview`
es rechazado con `PREVIEW_STATIC_UNSERVED` y no publica nada. Una vista previa de backend
se factura como una unidad de aplicación adicional en el tamaño predeterminado mientras exista, y
el despliegue indica a cuánto equivale eso al mes según la cotización del propio plano de control
(`cost` bajo `--json`; solo la regla y este enlace cuando el plano de control no puede
calcular el precio); `rebase cloud previews delete <name>` la detiene. `rebase cloud previews`
muestra como `paused` una vista previa pausada por la plataforma (su base de datos superó el límite de preview),
junto con el motivo (`statusMessage` bajo `--json`). Se puede rechazar una nueva dirección de preview
con `preview_cert_budget` cuando se agote el presupuesto semanal de certificados de vista previa de la plataforma;
el mensaje indica hasta cuándo.
Consulta [Previsualizar un cambio](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime el registro de compilación más reciente, y `-f` sigue (tails) una compilación que
aún está en ejecución. En cambio, `--runtime` lee lo que imprime la aplicación, desde cada pod
que la respalda, con cada línea etiquetada con su respectivo pod:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` acepta una duración (`30s`, `5m`, `1h`) o una marca temporal RFC3339.
- `--tail <n>` indica la cantidad de líneas por pod desde las que comenzar (el plano de control lo limita a 2000).
- `--grep` conserva las líneas que contienen el texto, sin distinguir mayúsculas o minúsculas; escribe `/re/flags` para
  usar una expresión regular.
- Con `--grep` o `--level`, el filtro busca en cada línea devuelta por el plano de control
  para la ventana (las 2000 más recientes de cada pod), y `--tail` cuenta las líneas coincidentes:
  las `n` coincidencias más recientes por pod, 500 por defecto. Cuando un pod tenía más
  líneas en la ventana que ese límite, la salida indica que las más antiguas no se
  buscaron (`filter.scanCapped` bajo `--json`).
- `--level error|warn|info|debug` conserva las líneas con esa gravedad o superior. Lee
  la `severity` estructurada que registra un backend de Rebase, una palabra de nivel al inicio de una
  línea de texto sin formato o un patrón de error como `TypeError:`. Las líneas que no contengan ninguno se omiten.

Un seguimiento continuo sondea cada dos segundos e imprime cada línea una sola vez. Notifica sobre pods
que se inician, detienen o reinician. Cuando un contenedor se reinicia, también imprime las últimas
líneas de la instancia caída, donde generalmente se encuentra el motivo. Espera mientras no haya ningún
pod en ejecución, y tras una desconexión, reintenta con retroceso exponencial (backoff) y
reanuda donde se quedó. Con `--json`, el seguimiento imprime un objeto JSON por
línea (NDJSON): `{"type":"line","ts","pod","text"}` para cada línea de registro y
`{"type":"event","event":…}` para el resto.

`--preview <name>` lee una vista previa en lugar de producción. Usa el nombre de la
vista previa o el ID de despliegue que imprimió el despliegue de preview. Por sí solo, `--preview`
lee la única vista previa del proyecto. Una vista previa estática tiene registro de compilación pero no
de tiempo de ejecución (runtime), ya que no ejecuta ningún servidor.

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
`REBASE_API_TOKEN`, mostrando solo su prefijo y nunca su valor. Reclamar el proyecto
transfiere esa clave y esta deja de caducar. `app-key rotate` genera una nueva y
revoca todas las claves de agente anteriores al mismo tiempo. Escribe la nueva clave en un `.env`
que ya defina `REBASE_API_TOKEN`, y la excluye de `--json` allí. En
cualquier otro directorio imprime la clave una sola vez. Las claves creadas en el panel de administración de la aplicación
no se modifican. Se ejecuta con tu inicio de sesión: ningún permiso de token la otorga.

`service-key`
imprime la generación de la variable `REBASE_SERVICE_KEY` del proyecto, cuándo se rotó por
última vez y si la aplicación todavía se está reiniciando con la más reciente. Nunca
imprime la clave: para eso está `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite una nueva clave y reinicia la aplicación utilizándola. La clave anterior sigue funcionando hasta que finaliza
el reinicio, y nunca después. Se rechaza mientras haya un despliegue
en curso, y se ejecuta con tu inicio de sesión. Reclamar un proyecto también rota su
clave de servicio.

Una vista previa del backend parte de las variables de producción, incluidas las claves activas.
`env set KEY=VALUE --preview` asigna a las vistas previas su propio valor, `env unset KEY
--preview` excluye la variable de ellas, `env reset KEY --preview` restablece
el valor de producción y `env list --preview` muestra las diferencias.
Ninguno de ellos modifica nunca la producción.

`env set KEY --stdin` lee el valor desde la entrada estándar en lugar de la
línea de comandos, donde `ps` y el historial de tu shell lo mostrarían:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Se descarta un salto de línea final. La herramienta `rebase_cloud_env_set` del servidor MCP establece
los valores de esta manera.

## Organizaciones

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite` crea una invitación e imprime su enlace: de un solo uso,
válido por 7 días y aceptable únicamente por una cuenta que haya verificado dicha dirección.
Nadie se une hasta que la acepte, incluso alguien que ya tenga una cuenta de Rebase.
La salida (y `emailDelivery` en `--json`) indica si se envió por correo electrónico; cuando
no fue así, una advertencia indica que envíes el enlace tú mismo. `--role` es `admin` o
`member` (predeterminado). A nadie se le invita como `owner`: invítalo como admin y
un owner lo ascenderá con `members role <email> owner` una vez que se haya unido.
`invites resend` genera un nuevo enlace y el anterior deja de funcionar.
Invitar y gestionar `invites` requieren una sesión de `rebase cloud login`; `REBASE_TOKEN` no
está permitido. Invitar, listar, reenviar y revocar requieren el rol de owner o admin;
a un miembro se le notificará si no lo tiene.
`members remove` solicita confirmación primero (`--yes` la omite); eliminar o degradar a un owner
requiere ser owner, y el último owner permanece. `--org <id>` selecciona una organización
distinta a la actual.

`activity` es el registro de auditoría de la organización seleccionada, con los eventos más recientes primero: quién
desplegó, revirtió, definió, eliminó o reveló una variable de entorno (por
nombre, nunca por valor), cambió un dominio, creó, restauró o descargó una
copia de seguridad, modificó el cómputo de un proyecto, detuvo o eliminó un proyecto, cambió el
rol de un miembro, o creó o revocó un token de acceso. `--action` admite un área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o una acción completa
como `env.set`. Cada página contiene hasta 100 entradas (`--limit`, por defecto 50); la
salida imprime el cursor `--before` para la siguiente página. `--json` devuelve un solo valor,
`{ org, events, nextCursor }`. Requiere el rol de owner o admin en la organización.
Un token solo puede leerlo con el permiso `audit` en la organización
(`rebase cloud tokens create --can audit`). La página **Activity** de la consola
muestra el mismo registro.

## Bases de datos

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre un puerto local que *es* la base de datos administrada (sin endpoint
público) hasta que se presione Ctrl-C; `--reveal` añade la contraseña. Solo para owner o admin.

## Invitados

Cada llamada a `signInAnonymously()` en una prueba, un bot o una visita abandonada deja una fila
en la tabla de usuarios del proyecto. Estos comandos cuentan esas filas y las eliminan, para que
nadie tenga que borrarlas una por una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` acepta una antigüedad con una unidad: `45m`, `12h`, `30d` o `2w`. Sin `--yes`
cuenta los registros pero no elimina nada. Procesa proyectos de cualquier tamaño en pequeños
lotes.

Solo se pueden eliminar invitados. Un invitado es una fila con `is_anonymous` activado, sin contraseña y sin
identidad vinculada, y la aplicación aplica esa regla en la sentencia que elimina la
fila, por lo que el comando no puede afectar a una cuenta real, incluso si se registró un momento
después de haber sido listada. `delete` rechaza una cuenta normal con `NOT_ANONYMOUS`.

**Última visualización (Last seen)** indica cuándo se emitió o actualizó por última vez la sesión del invitado, o cuándo
se creó el invitado si ya no le queda ningún token de actualización. Un invitado que sigue regresando
no se considera antiguo, sin importar hace cuánto se haya creado. Los tokens de actualización
y cualquier otra fila de autenticación de un invitado eliminado se borran junto con él.

Las filas en tus propias tablas siguen su clave foránea:

| Columna | Qué ocurre con la fila |
|---|---|
| Enlace opcional (`ON DELETE SET NULL`, el predeterminado) | Se conserva, dejando el enlace vacío |
| Enlace obligatorio (`ON DELETE RESTRICT`, el predeterminado) | Se conserva, y el invitado con ella: el invitado se reporta como omitido, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Se elimina junto con el invitado |
| Sin clave foránea (un campo `userSelect`, un id simple) | Se conserva, conteniendo un id que ya no existe |

Comprueba cuáles de tus enlaces están en cascada antes de pasar `--yes`: no se puede deshacer.

El comando pasa a través del proxy de Studio en la consola, el cual contiene la clave de la aplicación, por lo que la clave nunca llega a tu
máquina. Requiere un owner o admin de la organización, en un proyecto cuyo acceso a Studio esté habilitado
(`rebase cloud settings set --studio on`). A un proyecto con un runtime más antiguo se le notificará que necesita uno más reciente.
`rebase users guests --project <slug>` es el mismo comando dentro de la familia de comandos del proyecto.

## Recursos

Lo que la plataforma aloja para el proyecto, en comparación con lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando desaparece su declaración; eso
implicaría borrar datos mediante un push. La mantiene, la vincula y la factura hasta que alguien
la elimine explícitamente por su nombre con prune.

## Cómputo

Lo que reserva el proyecto y cuánto cuesta.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` admite `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`.
`--scale-to-zero` ha sido retirado: cada backend ejecuta al menos una instancia, por lo
que `true` se rechaza y `false` se ignora con una advertencia. No hay planes
por niveles: todo se tarifica por recurso. Consulta
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
acepta una lista separada por comas de `deploy.failed` (por defecto),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` y `preview.paused`. `--format slack` envía
únicamente `{ "text" }` en lugar del JSON del evento, que también incluye un `text`. La URL
es un argumento posicional porque `--url` especifica el plano de control. `add` imprime
el secreto de firma una sola vez; `--json` devuelve `{ projectId, webhook, secret }`.
`test <id>` sale con código 1 y `delivery_failed` cuando el receptor no aceptó
el evento de prueba. Listar está disponible para cualquier miembro de la organización; `add`, `test`
y `remove` requieren el rol de owner o admin. Un token puede administrarlas con el
permiso `notifications` en la organización, bajo la misma regla de roles. Consulta
[Notificaciones de Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` proporciona al clúster
propio de un cliente un registro de imágenes dedicado, utilizado exclusivamente para ese clúster. Sin
este, dicho clúster utiliza el registro compartido de la plataforma, y cada despliegue en él
lo indica en su registro de compilación. Con uno configurado, las compilaciones envían imágenes a ese repositorio con un token para
esa cuenta, los pods descargan imágenes únicamente con esa clave, y una reversión acepta las
imágenes del proyecto ubicadas allí. Las imágenes
que el proyecto construyó anteriormente en el registro compartido siguen estando disponibles para su descarga y como
destinos de reversión. Los tres valores van juntos; `--clear` los elimina. La clave
se sella cuando se escribe y nunca se vuelve a leer. Al igual que el resto de `clusters`,
requiere el rol de platform-admin. El operador crea el repositorio y ambas
cuentas mediante Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`billing invoices` y `billing upcoming` leen los mismos datos de Stripe que la
página de Facturación de la consola, y solo están disponibles para los owners y admins de la
organización. Un token puede acceder a ellos, y al resto de `billing`, con el permiso
`billing` en la organización; un token creado antes de existir este permiso seguirá funcionando
durante una versión más, mostrando una advertencia en cada respuesta. Los importes en `--json` se expresan en la unidad fraccionaria de la moneda (centavos), exactamente como
los envía Stripe. Las facturas en borrador no se listan; la vista previa la calcula
Stripe y sus líneas de consumo medido continúan acumulándose hasta que se cierre el período.

`usage` lee lo que el proyecto vinculado (o `--project`) ha consumido en un mes natural,
en UTC: solicitudes frente a la cuota incluida, errores 5xx, el exceso de consumo acumulado
hasta el momento en euros y, para el mes en curso, la proyección estimada a este
ritmo. El exceso de consumo es el cálculo propio del informe de excedentes, el
que indica a Stripe qué facturar, y se refleja en la factura del mes siguiente.
`usage org` lista todos los proyectos de la organización seleccionada con `rebase cloud
use`, junto con el total. Cualquier miembro de la organización puede consultarlo. Un token puede leerlo
con el permiso `logs` en el proyecto; `usage org` lista los proyectos sobre los cuales el
token dispone de dicho permiso.
`--month` acepta un mes pasado. La respuesta incluye `caveats` (advertencias), cada una con un `code`: `storage_not_measured`
(el almacenamiento de objetos marca 0), `multi_pod_undercount` (no se cuentan las solicitudes atendidas mientras se ejecutan dos o
más pods de la app), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
proyecto reclamado desde un agente cuenta únicamente a partir del día de la reclamación) y
`autoscale_not_charged` (los pods se ejecutaron por encima de `--replicas` y esta plataforma aún no los
cobra). La respuesta de un proyecto con escalado automático también incluye `autoscale`:
`extraPodSeconds` por encima del mínimo, `amountEur` según sus tarifas y `charged`.

## Deploy hooks, alertas y demás

<span class="since-badge" data-since="0.32">Desde 0.32</span>

```bash
rebase cloud deploy-hooks [list] | create [--name <name>] [--branch <branch>] | revoke <id>   # secret URLs a git host or CI calls to deploy
rebase cloud alerts [list] [--all] | ack <id> | snooze <id> --hours <1-168>   # the project's incidents
rebase cloud deploy --git [<branch>]     # build on the control plane from the connected repository
rebase cloud metrics --runtime           # requests, errors and latency, per surface
rebase cloud metrics --history [--series cpu_millicores|memory_bytes|event_loop_delay_ms] [--minutes <n>]
rebase cloud domains primary <domain>    # make a verified domain the canonical one
rebase cloud settings set --studio on|off
rebase cloud orgs rename <name> [--slug <slug>]
rebase cloud orgs delete                 # refused while the organization has projects
rebase cloud billing email <address>     # where invoices go
rebase cloud clusters baseline <id> [--install]   # platform admins
```

`deploy-hooks create` imprime la URL del hook una sola vez. `deploy --git` no se puede combinar con los indicadores de una compilación local, y en el runtime administrado requiere `--eject`, debido a que el plano de control compila a partir del código fuente. `settings set --studio` es el conmutador que los comandos del proyecto (`rebase data`, `rebase users`, …) necesitan activado para `--project`: acceden a la aplicación a través del proxy de Studio de la consola. Un comando cuya ruta en el plano de control aún no esté desplegada responde con `not_served` e indica su nombre. Los comandos destructivos solicitan confirmación primero y son rechazados con `confirmation_required` cuando no se puede interactuar: especifica `--yes`.
