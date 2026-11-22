---
sourceHash: 5e278801233fce19
title: rebase cloud
sidebar_label: rebase cloud
description: Grupos de comandos para Rebase Cloud en la CLI — autenticación, enlace de proyectos, despliegues, notificaciones, configuración, organizaciones, bases de datos, recursos, cómputo, almacenamiento, clústeres, facturación y uso.
---

Todo lo relacionado con Rebase Cloud, que se encuentra en beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no
incluye la beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos
actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera sobre
uno sin necesidad de vincularlo.

Tres opciones aplican en todas partes: `--json` para salida legible por máquina (también el
valor predeterminado cuando se usa una tubería (pipe), excepto para `deploy`, o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un
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
`notifications` en una organización: `--org`, de lo contrario la organización del proyecto,
o bien la seleccionada. Un token puede contener únicamente capacidades de organización.
`logs` también cubre `usage`. El alcance de cada una se encuentra en
[CI y agentes](/docs/deployment/cloud-agents/#ci-and-agents). Cuando el plano de
control marca una respuesta a un token como obsoleta (un token anterior a `billing`
que lee la facturación), la CLI imprime el aviso una vez en stderr, nunca en el
valor de `--json`.

Sin indicadores (flags), `login` inicia sesión a través del navegador. Imprime un código corto y
un enlace a la consola, abre el navegador y espera mientras apruebas el
inicio de sesión allí. Ya habrás iniciado sesión en la consola o puedes iniciar sesión con
cualquiera de los métodos ofrecidos (contraseña, Google, GitHub, LinkedIn). Comprueba que el
navegador muestre el mismo código antes de aprobarlo. El enlace caduca a los diez
minutos y funciona una sola vez. Sin una terminal, o con `--json`, el enlace y el código
se envían a stderr y `login` sigue esperando, de modo que un agente pueda entregarte el enlace. Un
inicio de sesión denegado finaliza con `access_denied`, y uno caducado con `expired_token`.

Con `--email`, `login` pregunta si deseas usar tu contraseña o un código que el plano de
control te envía por correo electrónico. Con la autenticación de dos factores activada, luego solicita el
código del autenticador (o un código de recuperación); a través del navegador, apruébalo desde una
sesión de consola que lo haya utilizado. Sin una terminal, ninguno de los códigos se puede escribir: establece
`REBASE_TOKEN` con un token de acceso creado en la consola en Settings → Access
tokens. Consulta [Rebase Cloud](/docs/deployment/cloud#link-a-project).

## Enlace de proyecto

```bash
rebase cloud link         # link this directory to a cloud project (picked from a list)
rebase cloud link <slug>  # link the project with that slug or id, as --project <slug> does
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

Los comandos de organización (`orgs`, `billing`, `usage org`, `activity`,
`projects create`, `tokens create --can billing`) actúan sobre `--org <id>`, de lo contrario sobre
la organización seleccionada con `cloud use`, o bien sobre la organización del proyecto vinculado. En
este último caso, indican cuál utilizaron. `orgs delete` nunca la toma del
enlace: requiere `--org` o una organización seleccionada.

### Conectar una instancia autoalojada a Claude

```bash
rebase cloud connect https://your-app.com      # add it to your account; prints two variables, waits until it answers
rebase cloud connect --list                    # the instances you added, and whether each is connected
rebase cloud connect --remove https://your-app.com
```

El [conector de Rebase](/docs/ai/rebase-connector/) (`https://app.rebase.pro/mcp`)
luego se conecta a ella junto a tus proyectos de Cloud. `connect` imprime
`REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE`; configúralos en
el servidor y reinícialo. En la carpeta del proyecto, ofrece escribirlos en
`.env`. Volver a ejecutarlo es seguro. `--name` nombra la instancia, `--org` elige la
organización, `--no-wait` regresa sin esperar. Solo para propietarios y administradores.

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

`claim` imprime el enlace de reclamación del proyecto aprovisionado por `init --claim` en este
directorio y el tiempo restante antes de que se elimine sin reclamar (`Unclaimed: deleted
in 41h`). `--open` también lo abre en un navegador. El enlace solo se conserva en la
máquina que ejecutó `init --claim`, en `~/.rebase/credentials.json`; el plano de
control almacena un hash del mismo y no puede volver a imprimirlo. Antes de responder, `claim`
pregunta al plano de control si el token propio del proyecto aún funciona. Una reclamación
revoca ese token, por lo que una vez que alguien ha reclamado el proyecto, `claim` rechaza
la solicitud con `already_claimed` en lugar de imprimir un enlace inactivo. También la rechaza una vez finalizada
la ventana de tiempo (`claim_expired`), y en un directorio sin enlace de reclamación
(`no_claim_link`). `rebase cloud status` y `rebase cloud whoami` muestran el mismo
enlace mientras el proyecto no haya sido reclamado.

`projects transfer` traslada un proyecto a otra organización sin cambios: el
mismo id, dirección, dominios personalizados, base de datos, almacenamiento, variables de entorno y
despliegues. Solo cambian quién es el propietario, quién puede verlo y quién lo paga. Debes
ser propietario o administrador de ambas organizaciones e iniciar sesión con `rebase cloud login`;
un token de acceso no puede trasladar un proyecto. La organización de destino se factura a partir de ese momento,
por lo que una sin tarjeta registrada (y no facturada internamente) rechazará el traslado y
nada cambiará. Un proyecto que aún esté esperando ser reclamado se traslada a través de su enlace de reclamación
en su lugar. La consola incluye la misma acción en la configuración (Settings) del proyecto, en la
zona de peligro (danger zone).

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

`deploy` sin un nombre de aplicación despliega el backend. El despliegue de un bundle
de backend también sube el código fuente del proyecto —lo que git rastrea, nunca un `.env`— para que una
actualización de la plataforma pueda reconstruirlo; `--no-source` omite esto una vez, y `cloud settings set
--platform-rebuilds off` lo detiene y elimina la copia almacenada. `--allow-downgrade` despliega una versión anterior.

Una actualización de la plataforma puede reconstruir una aplicación gestionada en una versión de `@rebasepro` más
reciente que la fijada en tu checkout. Un despliegue desde ese checkout restauraría el panel
de administración y el driver más antiguos, por lo que se rechaza antes de compilar nada, indicando
el comando que lo soluciona (`rebase upgrade --to <version>`). `rebase cloud status`
advierte esto mismo previamente: una línea `Rebuilt on`, y en `--json`,
`runtime.platformRebuiltVersion` y `frameworkDrift`.

Un `deploy` seguido finaliza con un resumen: cada aplicación enviada junto con su URL, el
id del despliegue, el tiempo transcurrido y si la nueva versión responde allí. Espera
hasta `--live-timeout` segundos (por defecto 60; `0` omite la comprobación) para que el
`/health` de un backend y la dirección de cada aplicación estática respondan. Un despliegue fallido
termina con una sola línea que indica la aplicación y el motivo, y finaliza con un código distinto de cero. El resumen
se imprime incluso cuando se redirige la salida (piped); `--json` (o `REBASE_JSON=1`) imprime un objeto en su lugar,
con `apps`, `hosts`, `live`, `liveChecks` y `durationMs`. Un host cuyo certificado
HTTPS aún no haya sido emitido se reporta como no disponible (not live), indicando ese motivo.

Antes de subir los archivos, `deploy` analiza el JavaScript de cada aplicación estática que envía:
los archivos `.js`/`.mjs`/`.cjs` en su `output` y los bloques `<script>` en línea de
su HTML. Un error de sintaxis detiene el despliegue indicando `file:line:column` (código
`syntax_error` con `--json`), y `--no-verify` omite la comprobación. Un despliegue
exitoso termina indicando cómo revertirlo, `rebase cloud rollback`. Una aplicación estática desplegada por
sí sola no se puede revertir todavía; consulta
[Revertir (Roll back)](/docs/deployment/cloud#roll-back).

`--preview` sirve la compilación en `https://<project>--<name>.rebase.website` y
no modifica producción. Una vista previa del backend ejecuta su propio backend, en una
base de datos vacía propia, con sus aplicaciones estáticas integradas. Por el momento, una aplicación estática no puede
previsualizarse de forma aislada en Rebase Cloud: `rebase cloud deploy <app> --preview`
se rechaza con `PREVIEW_STATIC_UNSERVED` y no publica nada. Una vista previa del
backend se factura como una unidad de aplicación adicional en el tamaño predeterminado mientras exista, y
el despliegue indica a cuánto asciende al mes según la cotización del propio plano de control
(`cost` bajo `--json`; solo la regla y este enlace cuando el plano de control no puede
calcular el precio); `rebase cloud previews delete <name>` la detiene. `rebase cloud previews`
muestra una vista previa que la plataforma haya pausado (su base de datos superó el límite de vista previa) como
`paused`, junto con el motivo (`statusMessage` bajo `--json`). Una nueva dirección de vista previa
puede ser rechazada con `preview_cert_budget` cuando se agota el presupuesto semanal de certificados
de vista previa de la plataforma; el mensaje indica hasta cuándo.
Consulta [Previsualizar un cambio](/docs/deployment/cloud/#preview-a-change).

### Logs

`rebase cloud logs` imprime el registro de compilación más reciente, y `-f` sigue en tiempo real una compilación que
aún se está ejecutando. `--runtime` lee en su lugar lo que imprime la aplicación, desde cada pod
detrás de ella, con cada línea etiquetada con su pod correspondiente:

```bash
rebase cloud logs --runtime -f                    # follow until Ctrl-C (exits 0)
rebase cloud logs --runtime --since 15m --grep timeout
rebase cloud logs --runtime -f --level error      # errors only
rebase cloud logs --runtime --previous            # a restarted container's last run
```

- `--since` acepta una duración (`30s`, `5m`, `1h`) o una marca temporal en formato RFC3339.
- `--tail <n>` es la cantidad de líneas por pod desde las que iniciar (el plano de control lo limita a 2000).
- `--grep` conserva las líneas que contienen el texto, sin distinguir mayúsculas de minúsculas; escribe `/re/flags` para una
  expresión regular.
- Con `--grep` o `--level`, el filtro busca en cada línea que el plano de control
  devuelve para esa ventana de tiempo (las 2000 más recientes de cada pod), y `--tail` cuenta las líneas
  coincidentes: las `n` coincidencias más recientes por pod, 500 por defecto. Cuando un pod tuvo más
  líneas en la ventana que esa cantidad, la salida indica que las más antiguas no fueron
  analizadas (`filter.scanCapped` bajo `--json`).
- `--level error|warn|info|debug` conserva las líneas con esa gravedad o superior. Lee
  la propiedad estructurada `severity` que registra un backend de Rebase, una palabra de nivel al inicio de una
  línea de texto simple o un formato de error como `TypeError:`. Las líneas que no tengan ninguno se omiten.

El seguimiento (`follow`) sondea cada dos segundos e imprime cada línea una sola vez. Anuncia los pods
que se inician, detienen o reinician. Cuando un contenedor se reinicia, también imprime las últimas
líneas de la instancia que cayó, donde suele encontrarse el motivo. Espera mientras no haya ningún
pod en ejecución y, tras una desconexión, vuelve a intentarlo con retroceso exponencial (backoff) y
se reanuda donde se quedó. Con `--json`, el seguimiento imprime un objeto JSON por
línea (NDJSON): `{"type":"line","ts","pod","text"}` para cada línea de log, y
`{"type":"event","event":…}` para el resto.

`--preview <name>` lee una vista previa en lugar de producción. Usa el nombre de la
vista previa o el id de despliegue que imprimió el despliegue de vista previa. Por sí solo, `--preview`
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

`domains add` para un host que el proyecto ya posee, como uno registrado por un
despliegue desde `rebase.json`, imprime los registros DNS de ese host y su estado tal como lo hace
una adición nueva; `--json` añade `alreadyRegistered: true`. Un host verificado se
sirve mediante HTTPS una vez emitido su certificado, unos minutos después de la
verificación. Hasta entonces, el ingress responde con un certificado provisional,
y `domains list`, `domains verify` y `status` muestran
`verified, certificate pending` en lugar de live. La CLI averigua esto mediante
un protocolo de enlace TLS (TLS handshake) con cada host verificado; `--json` lo incluye como `certificate`
(`ready`, `pending` o `unreachable`, con un `reason`).

`app-key` lista la
clave que `rebase cloud init --claim` generó en la aplicación y escribió en `.env` como
`REBASE_API_TOKEN`, mediante su prefijo y nunca su valor. Reclamar el proyecto
transfiere esa clave y esta deja de caducar. `app-key rotate` genera una nueva y
revoca todas las claves de agente anteriores al mismo tiempo. Escribe la nueva clave en un `.env`
que ya defina `REBASE_API_TOKEN` y no la incluye en `--json` en ese caso. En
cualquier otro directorio imprime la clave una sola vez. Las claves creadas en el panel de administración
de la aplicación no se tocan. Se ejecuta con tu inicio de sesión: ninguna capacidad de token lo autoriza.

`service-key`
imprime la generación de `REBASE_SERVICE_KEY` del proyecto, cuándo se rotó por
última vez y si la aplicación aún se está reiniciando con la más reciente. Nunca
imprime la clave: para eso está `env reveal REBASE_SERVICE_KEY`. `service-key rotate`
emite una nueva clave y reinicia la aplicación con ella. La clave antigua funciona hasta que el
reinicio haya terminado, y no después. Se rechaza mientras un despliegue está en
ejecución, y se ejecuta con tu inicio de sesión. Reclamar un proyecto también rota su clave
de servicio.

Una vista previa del backend tiene una clave de servicio propia. Su primer despliegue la crea,
los nuevos despliegues la mantienen y la clave de producción responde con 401 en la vista previa.
`service-key --preview <name>` la imprime, al igual que `env reveal
REBASE_SERVICE_KEY --preview <name>`. `service-key rotate --preview <name>`
genera una nueva y reinicia únicamente el pod de esa vista previa; la clave antigua funciona hasta
que el nuevo pod esté listo. Solicita confirmación primero, y `--yes` omite la pregunta. Ambas solicitan
lo mismo que `env reveal`: el rol de propietario o administrador de la organización, y para un
token de acceso, la capacidad `env` en un proyecto reclamado. La clave y el
pod de producción no se tocan.

Una vista previa del backend parte de las variables de producción, claves en vivo incluidas.
`env set KEY=VALUE --preview` asigna a las vistas previas su propio valor, `env unset KEY
--preview` excluye la variable de ellas, `env reset KEY --preview` restablece
el valor de producción y `env list --preview` muestra las diferencias.
Producción nunca se ve modificada por ninguno de ellos.

`env set KEY --stdin` lee el valor desde la entrada estándar en lugar de la
línea de comandos, donde `ps` y el historial de tu shell lo mostrarían:

```bash
read -rs STRIPE_KEY   # paste the value; nothing is echoed
printf %s "$STRIPE_KEY" | rebase cloud env set STRIPE_KEY --stdin --secret
```

Se descarta el salto de línea final. La función `rebase_cloud_env_set` del servidor
MCP establece valores de esta forma.

`env set KEY --prompt` solicita el valor mediante una entrada oculta en tu terminal.
No se muestra nada en pantalla y el valor se almacena como un secreto, tal como sucede con `--stdin
--secret`. Un agente puede proporcionarte el comando a ejecutar para que el valor nunca pase
por el chat. Sin una terminal, rechaza la operación (`input_required`) e indica
el uso de `--stdin`.

## Organizaciones

```bash
rebase cloud orgs list | create
rebase cloud orgs members [list] | invite <email> [--role admin|member] | remove <email|uid> | role <email|uid> <role>
rebase cloud orgs invites [list] | revoke <id|email> | resend <id|email>
rebase cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit N] [--before <cursor>]
```

`members invite <email>` añade a alguien que ya tenga una cuenta de Rebase con una
dirección de correo electrónico verificada, tal como lo hace Add member en la consola. Obtiene acceso
de inmediato y no se envía ningún correo. Rebase Cloud aún no envía invitaciones, por lo que una
persona sin cuenta no recibe ningún enlace: el comando rechaza la solicitud con `no_account` y
te pide que primero se registre y luego vuelvas a ejecutarlo. Un plano de control que
gestione invitaciones abre una e imprime su enlace (de un solo uso, válido por 7
días, aceptado solo por una cuenta que haya verificado esa dirección); `invites`
las lista, revoca y reenvía, y responde `not_served` en otros casos.
`--role` es `admin` o `member` (por defecto). Nadie se añade como `owner`: añádelos
como admin, y un propietario podrá ascenderlos con `members role <email> owner`.
Añadir miembros e `invites` requiere una sesión de `rebase cloud login`;
`REBASE_TOKEN` es rechazado. Ambos requieren el rol de propietario o administrador; a un miembro se le
informa de ello.
`members remove` solicita confirmación primero (`--yes` la omite); eliminar o degradar a un propietario
requiere ser propietario, y el último propietario debe permanecer. `--org <id>` selecciona una organización
distinta a la seleccionada actualmente.

`activity` es el registro de auditoría de la organización seleccionada, de más reciente a más antiguo: quién
desplegó, revirtió, definió, eliminó o reveló una variable de entorno (por
nombre, nunca por valor), cambió un dominio, creó, restauró o descargó una
copia de seguridad, modificó el cómputo de un proyecto, detuvo o eliminó un proyecto, cambió el
rol de un miembro o creó o revocó un token de acceso. `--action` toma un área
(`deploy`, `deploy_hook`, `env`, `domain`, `backup`, `pitr`, `database`,
`extension`, `storage`, `project`, `org`, `member`, `invite`, `token`) o una acción completa
como `env.set`. Una página contiene hasta 100 entradas (`--limit`, 50 por defecto); la
salida imprime el cursor `--before` para la siguiente página. `--json` es un valor único,
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

`db connect` abre un puerto local que *es* la base de datos gestionada (sin endpoint
público) hasta presionar Ctrl-C; `--reveal` añade la contraseña. Solo para propietarios o administradores.

## Invitados

Cada `signInAnonymously()` en una prueba, un bot o una visita abandonada deja una fila
en los usuarios del proyecto. Estos comandos cuentan esas filas y las eliminan para que
nadie tenga que hacerlo una a una.

```bash
rebase cloud guests                              # how many, and the ones last seen longest ago
rebase cloud guests --older-than 30d --limit 100 # the ones not seen for 30 days
rebase cloud guests delete <id>                  # one guest; asks first
rebase cloud guests prune --older-than 30d       # dry run: how many would go
rebase cloud guests prune --older-than 30d --yes # deletes them
```

`prune` toma una antigüedad con una unidad: `45m`, `12h`, `30d` o `2w`. Sin `--yes`,
cuenta y no elimina nada. Procesa proyectos de cualquier tamaño en pequeños
lotes.

Solo los invitados se pueden eliminar. Un invitado es una fila con `is_anonymous` activado, sin contraseña y sin
identidad vinculada, y la aplicación aplica esa regla en la instrucción que elimina la
fila, por lo que el comando no puede afectar a una cuenta real, incluso si se registró un momento
después de haber sido listada. `delete` rechaza una cuenta normal con `NOT_ANONYMOUS`.

**Last seen** (última vez visto) es cuando la sesión del invitado fue emitida o actualizada por última vez, o cuando
se creó el invitado si ya no le quedan tokens de actualización. Un invitado que regresa con frecuencia
no se considera antiguo, sin importar hace cuánto tiempo se creó. Los tokens de actualización de un invitado eliminado
y cualquier otra fila de autenticación se eliminan junto con él.

Las filas en tus propias tablas siguen su clave foránea:

| La columna | Qué le sucede a la fila |
|---|---|
| Enlace opcional (`ON DELETE SET NULL`, por defecto) | Se conserva, dejando el enlace vacío |
| Enlace obligatorio (`ON DELETE RESTRICT`, por defecto) | Se conserva, y el invitado con ella: el invitado se reporta como omitido, con `GUEST_REFERENCED` |
| `onDelete: "cascade"` | Se elimina junto con el invitado |
| Sin clave foránea (un campo `userSelect`, un simple id) | Se conserva, manteniendo un id que ya no existe |

Comprueba cuáles de tus enlaces están en cascada antes de pasar `--yes`: no se puede deshacer.

El comando pasa por el proxy de Studio de la consola, que almacena la clave de la aplicación, por lo que la clave nunca llega a tu
máquina. Requiere ser propietario o administrador de la organización, en un proyecto cuyo acceso a Studio esté habilitado
(`rebase cloud settings set --studio on`). A un proyecto con un runtime más antiguo se le notificará que necesita uno más nuevo.
`rebase users guests --project <slug>` es el mismo comando dentro de la familia de comandos del proyecto.

## Recursos

Lo que la plataforma mantiene para el proyecto, en comparación con lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando su declaración desaparece;
eso supondría la eliminación de datos mediante un push. La mantiene, vincula y factura hasta que alguien
la elimine expresamente por su nombre con prune.

## Cómputo

Lo que el proyecto reserva y lo que esto cuesta.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` acepta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`.
`--scale-to-zero` está retirado: cada backend ejecuta al menos una instancia, por lo
que `true` es rechazado y `false` es ignorado con una advertencia. No existen niveles de
planes: todo se tarifa por recurso. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

## Almacenamiento, notificaciones, clústeres, facturación y uso

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
acepta una lista separada por comas de `deploy.failed` (por defecto),
`deploy.succeeded`, `deploy.rolled_back`, `backup.unhealthy`,
`billing.payment_failed`, `usage.threshold` y `preview.paused`. `--format slack` envía
únicamente `{ "text" }` en lugar del JSON del evento, que también contiene un `text`. La URL
es un argumento posicional porque `--url` especifica el plano de control. `add` imprime
el secreto de firma una sola vez; `--json` devuelve `{ projectId, webhook, secret }`.
`test <id>` finaliza con código 1 y `delivery_failed` cuando el receptor no aceptó
el evento de prueba. Listar está disponible para cualquier miembro de la organización; `add`, `test`
y `remove` requieren el rol de propietario o administrador. Un token los gestiona con la
capacidad `notifications` en la organización, sujeto a la misma regla de roles. Consulta
[Notificaciones de Cloud](/docs/deployment/cloud-notifications/).

`clusters registry <cluster-id> --repository <host/project/repo>
--push-service-account <email> --pull-key-file <key.json>` proporciona al clúster
propio de un cliente un registro de imágenes propio, utilizado exclusivamente para ese clúster. Sin
este, dicho clúster utiliza el registro compartido de la plataforma, y cada despliegue en él
lo indicará en sus logs. Con uno configurado, las compilaciones suben a ese repositorio con un token para
esa cuenta, los pods descargan solo con esa clave y una reversión (rollback) acepta las
imágenes del proyecto alojadas allí. Las imágenes
que el proyecto compiló previamente en el registro compartido siguen estando disponibles para descarga y siguen siendo
objetivos de rollback. Los tres valores van juntos; `--clear` los elimina. La clave
se sella cuando se escribe y nunca se vuelve a leer. Al igual que el resto de `clusters`,
requiere el rol de administrador de la plataforma (platform-admin). El operador crea el repositorio y ambas
cuentas con Terraform (`saas/infra/gcp/registry-linked-clusters.tf`).

`clusters add --platform-capacity` registra capacidad operada por Rebase: los proyectos
ubicados en su región se despliegan allí una vez que su línea base (baseline) esté lista. No ofrece
la región a los clientes. `--open-to-customers` sí lo hace, en el momento del registro, o posteriormente con
`clusters open <id-or-name>`; `clusters close <id-or-name>` deja de ofrecerla.
Los operadores pueden desplegar en un clúster cerrado. Mantén un clúster cerrado mientras su
dominio base se comparta con otro clúster: hasta que el registro comodín (wildcard) se mueva, sus
nombres de host solo se resolverán mediante registros explícitos (`ingress.<baseDomain>`,
`s3.<baseDomain>` y uno por cada proyecto), y `clusters add` imprime qué registros
añadir. Cuando el dominio es compartido, `open` advierte que el registro comodín ya
debe apuntar al clúster. No pide confirmación, por lo que funciona desde un script.

`billing invoices` y `billing upcoming` leen los mismos datos de Stripe que la
página Billing de la consola, y están disponibles únicamente para los propietarios y administradores
de la organización. Un token puede acceder a ellos, y al resto de `billing`, con la capacidad `billing`
en la organización; un token creado antes de esa capacidad sigue
funcionando durante una versión más, con una advertencia en cada respuesta. Los importes en `--json` se expresan en la unidad menor de la moneda (céntimos), exactamente como
los envía Stripe. Las facturas en borrador no se listan; la vista previa la calcula
Stripe y sus líneas de consumo medido siguen incrementándose hasta que se cierre el período.

`usage` lee lo que el proyecto vinculado (o `--project`) ha consumido en un mes
calendario, en UTC: solicitudes frente a la cuota incluida, errores 5xx, el exceso
hasta el momento en euros y, para el mes en curso, la proyección a este
ritmo (un estimado). El exceso es el propio cálculo del informe de excesos,
el que le indica a Stripe qué facturar, y se refleja en la factura del mes siguiente.
`usage org` lista todos los proyectos de la organización seleccionada con `rebase cloud
use`, junto con el total. Cualquier miembro de la organización puede leerlo. Un token lo lee
con la capacidad `logs` en el proyecto; `usage org` lista los proyectos sobre los cuales
el token posee dicha capacidad.
`--month` acepta un mes pasado. La respuesta incluye `caveats`, cada uno con un `code`: `storage_not_measured`
(el almacenamiento de objetos marca 0), `multi_pod_undercount` (las solicitudes atendidas mientras se ejecutan dos o
más pods de la aplicación no se contabilizan), `partial_days`, `metering_off`,
`overage_billing_off`, `not_billed`, `billed_next_month`, `pre_claim_days` (un
proyecto reclamado desde un agente cuenta solo los días a partir de la reclamación) y
`autoscale_not_charged` (los pods se ejecutaron por encima de `--replicas` y esta plataforma aún no los
cobra). La respuesta de un proyecto con autoescalado también incluye `autoscale`:
`extraPodSeconds` por encima del valor mínimo, `amountEur` según sus tarifas y `charged`.

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

`domains redirect` se configura por dominio y está desactivado por defecto, de modo que un proyecto que sirve un host `api.` junto a su sitio web conserva ambos; surte efecto cuando el dominio está verificado y otro es el principal, y nunca se aplica a un dominio en el que se sirve una aplicación. `deploy-hooks create` imprime la URL del hook una sola vez. `deploy --git` no se puede combinar con los flags de una compilación local, y en el runtime gestionado requiere `--eject`, ya que el plano de control compila desde el código fuente. `settings set --studio` es el interruptor que los comandos de proyecto (`rebase data`, `rebase users`, …) necesitan activado para `--project`: se comunican con la aplicación a través del proxy de Studio de la consola. Un comando cuya ruta en el plano de control aún no esté desplegada responde con `not_served` e indica su nombre. Los comandos destructivos solicitan confirmación primero y fallan con `confirmation_required` cuando no hay nadie para responder: pasa `--yes`.
