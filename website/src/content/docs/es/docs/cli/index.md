---
sourceHash: c8a8fbca59f68e48
title: Referencia de la CLI
sidebar_label: CLI
description: Comandos de la CLI de Rebase para inicialización de proyectos, generación de esquemas, migraciones de bases de datos y generación de SDK.
---

## Visión general

La CLI de Rebase (`rebase`) gestiona tu proyecto desde el scaffolding hasta el despliegue.

## Instalación

```bash
pnpm add -g @rebasepro/cli
```

O úsalo mediante `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Salida legible por máquina

`--json` es el indicador (switch), y fuera de la familia `cloud` es el único: `rebase status`, `rebase resources`, `rebase apps list` y <span class="since-badge" data-since="0.22">Since 0.22</span> `rebase upgrade` colocan entonces un único valor JSON en stdout —el resultado, o una estructura envoltorio `{"error": {"message", "code", "hint", "issues"}}` con un código de salida distinto de cero— en **cada** terminación del comando, para que quien lo invoque pueda analizar stdout incondicionalmente. Sin él, escriben texto legible por humanos y los fallos van a stderr. `rebase cloud` utiliza la misma estructura envoltorio y es la única excepción al indicador: también activa JSON automáticamente cuando stdout no es una TTY, o cuando `REBASE_JSON=1` está definido. Así, `rebase cloud status | cat` es JSON mientras que `rebase status | cat` no lo es; en un script, pasa `--json` explícitamente en lugar de depender de cualquiera de las dos reglas.

## Comandos

### `rebase init`

Inicializa un nuevo proyecto de Rebase:

```bash
rebase init [directory]
```

Configura la estructura del proyecto con frontend, backend y paquetes compartidos.

| Flag | Qué hace |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Por defecto `blog` |
| `--headless` | Solo backend: sin panel de administración ni archivos de colecciones. `--template` no tiene efecto, ya que no hay colecciones que inicializar |
| `-y, --yes` | Nunca solicita confirmación. **Requerido donde no haya una terminal para responder**, como en CI. Omite git init y la instalación de dependencias; los valores predeterminados interactivos responden que sí a ambos, así que pasa `--git` / `--install` si los deseas |
| `-i, --install` | Instala dependencias tras el scaffolding |
| `-g, --git` | Inicializa un repositorio y realiza el primer commit |
| `--database-url <url>` | Usa una base de datos existente en lugar de la gestionada |
| `--introspect` | Genera colecciones a partir de esa base de datos. Implica `--template blank` y requiere `--install` |
| `--project <slug>` | Vincula el proyecto inicializado a un proyecto de Rebase Cloud |
| `--setup-key <key>` | La clave de un solo uso que autentica esa vinculación |

### `rebase dev`

Inicia el servidor de desarrollo:

```bash
rebase dev
```

Inicia tanto el frontend como el backend con recarga en caliente (hot reloading).

Ambos puertos se derivan de la ruta del proyecto, por lo que varios proyectos de Rebase pueden ejecutarse simultáneamente. Utiliza las URLs que imprime `rebase dev`. Fija uno con `rebase dev --port 3001`.

### `rebase build`

Compila el proyecto en un bundle desplegable en `dist-bundle/`:

```bash
rebase build
```

El bundle es el artefacto que despliegas; la imagen del runtime lo carga, por lo que no es necesario compilar una imagen de la aplicación por tu cuenta. Flags útiles:

| Flag | Efecto |
|------|--------|
| `--out <dir>` | Escribe el bundle en un lugar distinto a `dist-bundle/` |
| `--vendor` | Siempre instala e incluye las dependencias del bundle |
| `--no-vendor` | Nunca incluye dependencias (vendor); el pod las instala en el primer inicio |
| `--skip-type-check` | Omite la comprobación de tipos (más rápido, menos seguro) |
| `--no-static` | Omite la compilación del frontend |

Las dependencias se incluyen (vendored) por defecto para que el reinicio de un pod no conlleve una instalación de 35–55 segundos. En cambio, un árbol que supere los 200 MB en disco se descarta, ya que el límite de subida es de 100 MB comprimido; consulta el changelog para ver la justificación.

### `rebase upgrade`

<span class="since-badge" data-since="0.22">Since 0.22</span> Lleva cada paquete `@rebasepro/*` que fija el proyecto a una misma versión
y luego instala con el gestor de paquetes que indica el lockfile. `rebase upgrade`
toma la más reciente; `--to 0.21.0`, una versión exacta, sin consultar el registro;
`--to canary`, una dist-tag. Cada versión fijada en `dependencies`,
`devDependencies` y `optionalDependencies`, en cada `package.json` del proyecto,
conserva su `^` o `~`, y nada más cambia en el archivo. `peerDependencies` y las
especificaciones `workspace:`, `link:`, `file:`, git y de etiqueta se listan y no
se tocan. Los overrides de `pnpm-workspace.yaml` y `package.json` también se
actualizan, pero un override `link:` o `file:` se impone a cualquier versión
fijada: se informa, y `--drop-local-overrides` lo elimina. `--dry-run` no escribe
nada, `--no-install` omite la instalación y `--json` imprime un único documento.

### `rebase start`

Ejecuta el bundle compilado como un servidor de producción:

```bash
rebase start
```

Lee `PORT` y el resto de `.env`, a diferencia de `rebase dev`. Apúntalo a un bundle en otra ubicación con `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Muestra las aplicaciones que declara este repositorio:

```bash
rebase apps list
```

Un repositorio puede declarar más de una aplicación desplegable; por ejemplo, un backend y un sitio de marketing. Así es como puedes ver sobre qué actuarán `rebase build` y el despliegue.

### `rebase eject`

Toma el control total del proceso del servidor y de su imagen:

```bash
rebase eject
```

Escribe el punto de entrada del backend y un `Dockerfile` en el proyecto y cambia su backend, de modo que el repositorio compile su propia imagen en lugar de ejecutar el runtime publicado. A partir de ese momento, **las actualizaciones del runtime de la plataforma ya no le afectarán**, y CORS, la configuración de autenticación, el almacenamiento y el apagado pasan a ser tu responsabilidad de configuración.

Previsualízalo con `rebase eject --dry-run`, que lista lo que cambiaría sin modificar nada. `--force` reemplaza un `backend/src/index.ts` o `env.ts` existente, conservando el archivo actual como `<name>.bak`.

### `rebase schema generate`

Genera el esquema de Drizzle ORM a partir de tus colecciones de TypeScript:

```bash
rebase schema generate
```

Esto lee tus colecciones desde `config/collections/` y genera `backend/src/schema.generated.ts` con definiciones de tablas, enumeraciones y relaciones de Drizzle.

### `rebase db push`

Aplica los cambios de esquema directamente en la base de datos (solo para desarrollo):

```bash
rebase db push
```

:::caution
`db push` modifica la base de datos directamente sin archivos de migración. Usa `db generate` + `db migrate` para producción.
:::

### `rebase db generate`

Genera archivos de migración SQL a partir de cambios en el esquema:

```bash
rebase db generate
```

Crea archivos de migración con marca de tiempo en `drizzle/` que se pueden revisar y confirmar (commit).

### `rebase db migrate`

Ejecuta las migraciones de base de datos pendientes:

```bash
rebase db migrate
```

Aplica todas las migraciones pendientes a la base de datos.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` ejecuta `pg_dump`; `restore` ejecuta `pg_restore` y es destructivo, por lo que requiere `--yes`. `--out` acepta una ruta local o una URL de almacenamiento de objetos, y toma por defecto `$BACKUP_DESTINATION` o `./backups`.

### `rebase db pull`

Copia otra base de datos en la base de datos de desarrollo local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` reemplaza campos personales durante la importación, para que se pueda trabajar localmente en una copia de producción sin transferir datos reales de clientes a un portátil.

`pg_dump` elimina los privilegios, por lo que la copia llegaría con las políticas RLS del origen y ninguna de las concesiones (grants) asociadas, fallando cada lectura como `rebase_user` con `permission denied`. El pull reaprovisiona el rol de la aplicación posteriormente, usando la misma rutina que utilizan el arranque e inicio (`rebase db push`), por lo que las tablas internas de Rebase permanecen revocadas como corresponde.

El destino siempre es la base de datos de desarrollo local de este proyecto y no se puede elegir: `--database-url` se rechaza en lugar de aceptarse, por lo que no hay forma de indicar un "pull hacia producción". `--from` es la única dirección permitida.

### `rebase db url`

Imprime la cadena de conexión que está utilizando este proyecto, y nada más, para que se pueda canalizar (pipe):

```bash
rebase db url
psql "$(rebase db url)"
```

La base de datos de desarrollo gestionada es el caso que necesita esto: `.env` deja `DATABASE_URL` comentada a propósito, y el puerto se deriva de la ruta del proyecto, por lo que nada en el disco la nombra. Cuando hayas configurado una `DATABASE_URL` propia, eso es lo que imprime; el orden de resolución es el mismo que sigue cualquier otro comando. Inicia la base de datos gestionada si aún no se está ejecutando.

### `rebase db stop` / `rebase db reset`

Solo para la base de datos de desarrollo gestionada:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL no copiará ni eliminará una base de datos si hay alguna otra conexión activa hacia ella, y lo habitual es que ese "algo más" sea tu propio `rebase dev`. `create` y `delete` indican qué mantiene abierta la base de datos; `--force` desconecta esas sesiones primero.

Cada branch es una copia completa en disco, por lo que es necesario limpiarlas. `prune` elimina tres cosas: una entrada cuya base de datos se eliminó fuera de Rebase, una base de datos de branch cuya entrada nunca se escribió y, únicamente con `--older-than`, branches que superen la antigüedad indicada. Solicita confirmación antes de eliminar nada a menos que pases `--yes`.

`switch` registra el branch en `.rebase/branch.json` y nunca edita `.env`. Tiene prioridad sobre `DATABASE_URL` en `.env` y queda por detrás de `--database-url` o una `DATABASE_URL` en la shell, por lo que un flag en la línea de comandos siempre prevalece sobre un cambio realizado anteriormente. Eliminar el branch en el que te encuentras te devuelve a la base de datos principal en lugar de dejar el checkout apuntando a una base de datos inexistente.

:::note[No aplicable en la base de datos de desarrollo gestionada]
`push`, `generate` y `migrate` planifican su trabajo con Atlas, que necesita una segunda base de datos vacía con la que comparar, y el PGlite gestionado proporciona exactamente una. Ejecutarlos allí se detiene con un mensaje informando de ello. Apunta `DATABASE_URL` a un PostgreSQL real para el flujo de trabajo de migraciones; `rebase dev` ya crea tablas faltantes de forma aditiva en la base de datos gestionada.

`branch` se rechaza allí por una razón similar. `CREATE DATABASE ... TEMPLATE` en PGlite escribe una entrada en el catálogo y no copia nada, por lo que el branch resolvería a la base de datos desde la que se clonó: cada escritura que pretendías aislar terminaría en tu base de datos de desarrollo. `rebase dev --docker` te proporciona un servidor real con el que pueden trabajar los branches.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

Todo lo que declara este proyecto y si el entorno realmente lo vincula:

```bash
rebase status               # every resource, and the variables it reads
rebase status --json        # machine-readable
```

```
  backend  ·  managed  Rebase's runtime boots your bundle
  declared in  config/resources.ts
  configured by  .env

  buckets
  ✓ media  s3 · account:minio
      ✓ S3_BUCKET__MEDIA
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Tres archivos determinan a qué puede acceder un backend, y esto imprime los tres juntos: `rebase.json` indica dónde está tu código y quién ejecuta el servidor, `config/resources.ts` indica qué necesita el proyecto, y el entorno indica cómo acceder a cada recurso. Todo lo demás (`rebase.resources.json`, el manifiesto del bundle) se genera a partir de este último para lectores que no pueden ejecutar tu código, y nunca lo escribes manualmente.

Un `○` es el estado que conviene conocer antes de un despliegue y no después: declarado, no configurado. Un `✗` significa que el entorno configura algo *incorrectamente*, lo cual rechaza el arranque en lugar de degradarse.

### `rebase resources`

Lo que este proyecto declara que necesita: las bases de datos, buckets, topics y colas que solicita su código de configuración, y los crons y funciones que definen sus archivos:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` es nuevo: el flag que utiliza un job de CI para fallar si un `rebase.resources.json` ya no coincide con el código de configuración.

Un recurso se declara en el código de configuración —`database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")`— o es un archivo bajo `backend/crons` o `backend/functions`, y nunca se escribe a mano en `rebase.resources.json`, el cual se genera a partir de esas declaraciones para que un host pueda leer lo que necesita un proyecto sin compilarlo. Cada entrada registra quién la usa (`collection:events`, `property:posts.cover`, `function:report`).

Un backend también tiene una base de datos predeterminada y una fuente de almacenamiento predeterminada que nadie declara. Ambas se listan aquí, marcadas como `implicit`, y ninguna se escribe en `rebase.resources.json`; el host las suministra, por lo que registrarlas solicitaría el aprovisionamiento de algo que nadie pidió.

Para ver lo que la plataforma mantiene para un proyecto en comparación con lo que declara su código, y para eliminar una base de datos aprovisionada que el código ya no nombra, consulta `rebase cloud resources` a continuación.

### `rebase cloud`

Todo lo relacionado con Rebase Cloud, que está en beta privada. Consulta la [guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no incluye la versión beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera en uno sin vincularlo.

Tres opciones se aplican en todas partes: `--json` para salida legible por máquina (también el valor por defecto al canalizar o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un plano de control específico (o `REBASE_CLOUD_URL`), y `--project, -p <id>`.

#### Autenticación

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # show the current session
```

#### Enlace de proyectos

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

#### Proyectos

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

#### Despliegue y observabilidad

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud logs [--runtime] [-f]       # build logs, or the running process's
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` sin especificar el nombre de una aplicación despliega el backend. <span class="since-badge" data-since="0.22">Since 0.22</span> Un
despliegue de bundle de backend también sube el código fuente del proyecto —lo que git
rastrea, nunca un `.env`— para que una actualización de la plataforma pueda
reconstruirlo; `--no-source` lo omite en un despliegue. `rebase cloud settings set --platform-rebuilds off` desactiva las reconstrucciones de la plataforma para el proyecto: las actualizaciones solo mueven el runtime y el código fuente guardado se borra. `--allow-downgrade` despliega un bundle compilado con una versión anterior a la que ejecuta el proyecto.

#### Configuración

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
```

#### Organizaciones

```bash
rebase cloud orgs list | create | members
```

#### Bases de datos

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre un puerto local que *es* la base de datos gestionada (sin endpoint público) hasta presionar Ctrl-C; `--reveal` añade la contraseña. Solo para propietario o administrador.

#### Recursos

Lo que la plataforma almacena para el proyecto, frente a lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando se retira su declaración: eso implicaría eliminar datos mediante un push. La mantiene, la vincula y la factura hasta que alguien la elimine (prune) por su nombre.

#### Cómputo

Lo que reserva el proyecto y cuánto cuesta.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` acepta `--cpu`, `--memory`, `--replicas`, `--spot`, `--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`, `--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`. No existen planes por niveles: todo se tarifica por recurso. Consulta [Rebase Cloud](/docs/deployment/cloud/).

#### Almacenamiento, webhooks, clústeres y facturación

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
```

### `rebase generate-sdk`

Genera un SDK de cliente tipado a partir de las definiciones de tus colecciones:

```bash
rebase generate-sdk
```

Crea tipos de TypeScript y un cliente con seguridad de tipos (type-safe) para todas tus colecciones.

### `rebase doctor`

```bash
rebase doctor
```

El comando a ejecutar cuando algo va mal y aún no sabes qué es. Informa y nunca cambia nada, por lo que es seguro para cualquier base de datos a la que puedas acceder.

**Sin una base de datos.** Estas comprobaciones se ejecutan primero, porque todo lo que impide que un proyecto funcione en absoluto ocurre antes de que se pueda comparar una tabla:

| Comprobación | Motivo |
| --- | --- |
| Versión de Node | Frente al rango que declara la CLI. Una versión demasiado antigua no se reporta como "Node no soportado", sino como un error de sintaxis dentro de una dependencia. |
| Gestores de paquetes | Dos archivos de bloqueo (lockfiles) en un mismo proyecto. Ejecutar `npm install` en un workspace de pnpm reescribe `node_modules` con una estructura incompatible con pnpm, y el síntoma es un `Cannot find module` horas después. |
| Slugs duplicados | El registro conserva la última colección registrada, por lo que la otra no se reporta como faltante: se sirve como ganadora, bajo su propio nombre. |
| Integridad de `.env` | Un `JWT_SECRET` de menos de 32 caracteres (con el cual producción se niega a arrancar) y `NODE_ENV=production` sin `CORS_ORIGINS` ni `FRONTEND_URL`. Los valores nunca se imprimen. |
| Discrepancia de versiones de `@rebasepro/*` | El mismo paquete fijado en versiones diferentes a través de los archivos `package.json` del proyecto. Dos copias rompen el `instanceof` entre ellas, fallando como un type guard que rechaza su propio tipo. |
| Cadenas de conexión | Un `=` no codificado en un parámetro de la URL, el cual las herramientas nativas de PostgreSQL se niegan a interpretar, haciendo que las copias de seguridad y `psql` fallen mientras la aplicación sigue funcionando. |
| Funciones personalizadas | Lo que cada función necesita de su host y cuáles de ellas no se ejecutarían en un runtime de edge. |

**Contra la base de datos**, cuando `DATABASE_URL` está configurada:

| Comprobación | Motivo |
| --- | --- |
| Colecciones → esquema generado | Si `schema.generated.ts` está desactualizado. |
| Colecciones → base de datos | Tablas, columnas, enumeraciones, claves foráneas y uniones faltantes. |
| Extensiones requeridas | Una propiedad `{ type: "vector" }` necesita pgvector, que Rebase instala únicamente donde el proyecto lo haya declarado. |
| Marca del esquema (Schema stamp) | Si esta base de datos se aprovisionó a partir de estas colecciones. Es un hash, por lo que puede indicar que ambas difieren, pero nunca cuál va por delante. |
| Colecciones → tipos del SDK | Si el SDK tipado generado está desactualizado. |
| Políticas RLS | Si las políticas de la base de datos coinciden con las `securityRules` que declaraste y si alguna política nombra un rol que este servidor no puede utilizar. |

Si la base de datos es inaccesible, sus fases se reportan como omitidas con el motivo y el resto continúa ejecutándose; consulta [Troubleshooting](/docs/troubleshooting/).

Sale con un código distinto de cero cuando una comprobación encuentra un error, o cuando una fase no pudo ejecutarse porque la base de datos indicada rechaza las conexiones. Una fase omitida porque no configuraste `DATABASE_URL` no se considera un fallo.

`rebase doctor --policies` ejecuta únicamente las comprobaciones de RLS (sin diff de esquema ni tipos del SDK) y falla bloqueando (fail-closed), lo que lo convierte en el formato ideal para usar como control (gate) en CI contra una base de datos desplegada.

### `rebase auth`

Comandos de gestión de autenticación:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestiona claves API de servicio con alcance limitado: las credenciales que utiliza un agente, script u otro servicio, a diferencia de la sesión de un usuario final:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` toma un array JSON de objetos `{ collection, operations }`, o usa `--full-access` para lectura/escritura/eliminación en todas las colecciones y funciones. `--expires` acepta `7d`, `30d`, `90d`, `1y` o una fecha ISO, y `--rate-limit` define las peticiones por ventana de 15 minutos. La clave se muestra una sola vez, en el momento de su creación.

Las claves tienen doble verificación: se aplican tanto los permisos propios de la clave como la seguridad a nivel de fila (RLS) de la identidad a la que representa, de modo que una clave nunca puede leer más de lo que dicha identidad puede.

### `rebase skills install`

Instala las habilidades de referencia de Rebase para tu asistente de código con IA. Compatible con Cursor, Claude Code, Windsurf, Gemini CLI y Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulta [Habilidades de agentes](/docs/ai/skills) para ver la lista completa y dónde se escriben los archivos.

### `rebase telemetry`

Envío anónimo de datos de uso. **`rebase init` pregunta una vez por proyecto y el prompt responde que sí por defecto; no se envía nada a menos que respondas:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime la configuración actual, `show` imprime exactamente qué se enviaría (esté o no activado el envío, para que puedas revisar el contenido antes de decidir) y los otros dos lo modifican. Si nunca ejecutaste `init`, nunca se recopiló nada.

## Próximos pasos

- **[Generación de esquemas](/docs/cli/schema/#production-workflow)** — El flujo de trabajo de migraciones, desde la edición de una colección hasta producción
- **[Schema as Code](/docs/architecture/schema-as-code)** — Cómo funciona la generación de esquemas
- **[Inicio rápido](/docs/getting-started/quickstart)** — Comienza ahora
