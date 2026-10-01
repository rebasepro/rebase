---
sourceHash: cc9569d9e5b15674
title: Referencia de la CLI
sidebar_label: CLI
description: Comandos de Rebase CLI para inicialización de proyectos, generación de esquemas, migraciones de bases de datos y generación de SDK.
---

## Descripción general

La CLI de Rebase (`rebase`) gestiona tu proyecto desde el scaffolding hasta el despliegue.

## Instalación

```bash
pnpm add -g @rebasepro/cli
```

O úsalo a través de `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Salida legible por máquina

`--json` es el modificador, y fuera de la familia `cloud` es el único: `rebase status`, `rebase resources`, `rebase apps list` y `rebase upgrade` colocan entonces un único valor JSON en stdout — el resultado, o un contenedor `{"error": {"message", "code", "hint", "issues"}}` con una salida distinta de cero — en **cada** finalización del comando, de modo que el llamador pueda parsear stdout incondicionalmente. Sin él, escriben texto legible para humanos y los fallos van a stderr. `rebase cloud` utiliza el mismo contenedor y es la única excepción al modificador: también activa JSON por sí mismo cuando stdout no es una TTY, o cuando `REBASE_JSON=1` está definido. Por lo tanto, `rebase cloud status | cat` produce JSON mientras que `rebase status | cat` no — en un script, pasa `--json` explícitamente en lugar de depender de cualquiera de las dos reglas.

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
| `--headless` | Solo backend — sin panel de administración ni archivos de colecciones. `--template` no tiene efecto, ya que no hay colecciones para inicializar |
| `-y, --yes` | No solicitar confirmación nunca. **Requerido siempre que no haya un terminal para responder**, como en CI. Omite git init y la instalación de dependencias — los valores interactivos por defecto responden sí a ambos, así que pasa `--git` / `--install` si los deseas |
| `-i, --install` | Instala dependencias tras el scaffolding |
| `-g, --git` | Inicializa un repositorio y realiza el primer commit |
| `--database-url <url>` | Usa una base de datos existente en lugar de la gestionada |
| `--introspect` | Genera colecciones a partir de esa base de datos. Implica `--template blank` y requiere `--install` |
| `--project <slug>` | Vincula el scaffold a un proyecto de Rebase Cloud |
| `--setup-key <key>` | La clave de un solo uso que autentica ese enlace |
| `-a, --agent <name>` | <span class="since-badge" data-since="0.24">Desde 0.24</span> Configura agentes de programación de IA: las [skills](/docs/ai/skills) y el [servidor MCP](/docs/ai/mcp). Repetible o separado por comas — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Sin él, `init` pregunta y preselecciona los agentes instalados en la máquina; con `--yes`, ninguno |

### `rebase dev`

Inicia el servidor de desarrollo:

```bash
rebase dev
```

Inicia tanto el frontend como el backend con recarga en caliente (hot reloading), y regenera el esquema de Drizzle y los tipos del SDK (`generated/sdk/`) al inicio y en cada guardado de colecciones.

Ambos puertos se derivan de la ruta del proyecto para que varios proyectos de Rebase puedan ejecutarse en paralelo. Utiliza las URLs que imprime `rebase dev`. Fija uno con `rebase dev --port 3001`.

### `rebase build`

Compila el proyecto en un bundle desplegable en `dist-bundle/`:

```bash
rebase build
```

El bundle es el artefacto que despliegas — la imagen del runtime lo carga, por lo que no hay que construir una imagen de aplicación propia. Flags útiles:

| Flag | Efecto |
|------|--------|
| `--out <dir>` | Escribe el bundle en un lugar distinto a `dist-bundle/` |
| `--vendor` | Siempre instala e incluye las dependencias del bundle |
| `--no-vendor` | Nunca empaqueta dependencias (no vendor); el pod las instala en el primer inicio |
| `--skip-type-check` | Omite la comprobación de tipos (más rápido, menos seguro) |
| `--no-static` | Omite la compilación del frontend |

Las dependencias se empaquetan por defecto (vendored) para que el reinicio de un pod no conlleve una instalación de 35–55 segundos. Un árbol que supere los 200 MB en disco se descarta en su lugar, ya que el límite de subida es de 100 MB comprimido — consulta el registro de cambios (changelog) para conocer el motivo.

### `rebase upgrade`

Actualiza cada paquete `@rebasepro/*` que fija el proyecto a una única versión y, a continuación, instala con el gestor de paquetes indicado por su archivo lockfile. `rebase upgrade` toma la última versión; `--to 0.21.0` una versión exacta, sin búsqueda en el registro; `--to canary` un dist-tag. Cada versión fijada en `dependencies`, `devDependencies` y `optionalDependencies`, en cada `package.json` del proyecto, conserva su `^` o `~`, y nada más en el archivo cambia. `peerDependencies` y las especificaciones `workspace:`, `link:`, `file:`, git y etiquetas se enumeran y se dejan intactas. Los overrides en `pnpm-workspace.yaml` y `package.json` también se actualizan, pero un override `link:` o `file:` prevalece sobre cualquier versión fijada: se informa al respecto y `--drop-local-overrides` lo elimina. `--dry-run` no escribe nada, `--no-install` omite la instalación y `--json` imprime un único documento.

### `rebase start`

Ejecuta el bundle compilado como servidor de producción:

```bash
rebase start
```

Lee `PORT` y el resto de `.env`, a diferencia de `rebase dev`. Apúntalo a un bundle en otra ubicación con `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Muestra las aplicaciones que declara este repositorio:

```bash
rebase apps list
```

Un repositorio puede declarar más de una aplicación desplegable — un backend y un sitio de marketing, por ejemplo. Así es como ves sobre qué actuarán `rebase build` y el despliegue.

### `rebase eject`

Toma el control del proceso del servidor y su imagen:

```bash
rebase eject
```

Escribe el punto de entrada del backend y un `Dockerfile` en el proyecto y cambia la configuración del backend, de modo que el repositorio compile su propia imagen en lugar de ejecutar el runtime publicado. A partir de entonces, **las actualizaciones del runtime de la plataforma ya no le afectarán**, y la configuración de CORS, autenticación, almacenamiento y apagado pasarán a ser responsabilidad tuya.

Obtén una vista previa con `rebase eject --dry-run`, que muestra lo que cambiaría sin modificar nada. `--force` reemplaza un `backend/src/index.ts` o `env.ts` existente, conservando el archivo actual como `<name>.bak`.

### `rebase schema generate`

Genera el esquema de Drizzle ORM a partir de tus colecciones TypeScript:

```bash
rebase schema generate
```

Esto lee tus colecciones desde `config/collections/` y genera `backend/src/schema.generated.ts` con definiciones de tablas, enums y relaciones de Drizzle.

### `rebase db push`

Aplica cambios del esquema directamente en la base de datos (solo desarrollo):

```bash
rebase db push
```

:::caution
`db push` modifica la base de datos directamente sin archivos de migración. Usa `db generate` + `db migrate` para producción.
:::

### `rebase db generate`

Genera archivos de migración SQL a partir de los cambios en el esquema:

```bash
rebase db generate
```

Crea archivos de migración con marca de tiempo en `drizzle/migrations/` que pueden revisarse y confirmarse en git.

### `rebase db migrate`

Ejecuta las migraciones de base de datos pendientes:

```bash
rebase db migrate
```

Aplica todas las migraciones no aplicadas a la base de datos.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` ejecuta `pg_dump`; `restore` ejecuta `pg_restore` y es destructivo, por lo que requiere `--yes`. `--out` acepta una ruta local o una URL de almacenamiento de objetos, y su valor predeterminado es `$BACKUP_DESTINATION` o `./backups`.

### `rebase db pull`

Copia otra base de datos en la base de datos de desarrollo local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` reemplaza los campos personales durante la importación, para que se pueda trabajar con una copia de producción localmente sin llevar datos reales de clientes a un portátil.

`pg_dump` elimina los privilegios, por lo que la copia llegaría con las políticas RLS del origen y ninguna de las concesiones (grants) asociadas — fallando cada lectura como `rebase_user` con `permission denied`. La operación pull reaprovisiona el rol de la aplicación después, utilizando la misma rutina que el arranque y `rebase db push`, de modo que las tablas internas de Rebase permanezcan revocadas como corresponde.

El destino siempre es la base de datos de desarrollo local de este proyecto y no se puede elegir: `--database-url` es rechazado en lugar de aceptado, por lo que no hay forma de ordenar "pull a producción". `--from` es la única dirección.

### `rebase db url`

Imprime la cadena de conexión que está usando este proyecto, y nada más, para que se pueda canalizar (pipe):

```bash
rebase db url
psql "$(rebase db url)"
```

La base de datos de desarrollo gestionada es el caso que necesita esto: `.env` deja `DATABASE_URL` comentada a propósito, y el puerto se deriva de la ruta del proyecto, por lo que nada en el disco la nombra. Cuando has definido una `DATABASE_URL` propia, eso es lo que imprime — el orden de resolución es el mismo que sigue cualquier otro comando. Inicia la base de datos gestionada si aún no se está ejecutando.

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

PostgreSQL no copiará ni eliminará una base de datos a la que haya algo conectado, y ese "algo" suele ser tu propio `rebase dev`. `create` y `delete` indican qué está manteniendo abierta la base de datos; `--force` desconecta esas sesiones primero.

Cada rama es una copia completa en disco, por lo que es necesario limpiarlas. `prune` elimina tres cosas: una entrada cuya base de datos se eliminó fuera de Rebase, una base de datos de rama cuya entrada nunca se escribió y — solo con `--older-than` — ramas que superen la antigüedad especificada. Pide confirmación antes de eliminar nada a menos que pases `--yes`.

`switch` registra la rama en `.rebase/branch.json` y nunca edita `.env`. Tiene prioridad sobre `DATABASE_URL` en `.env` y cede ante `--database-url` o un `DATABASE_URL` en el shell, por lo que un flag en la línea de comandos siempre prevalece sobre un cambio realizado anteriormente. Al eliminar la rama en la que te encuentras, vuelves a la base de datos principal en lugar de dejar el entorno apuntando a una base de datos que ya no existe.

:::note[No disponible en la base de datos de desarrollo gestionada]
`push`, `generate` y `migrate` planifican su trabajo con Atlas, que necesita una segunda base de datos vacía con la que comparar — y el PGlite gestionado sirve exactamente una. Al ejecutarlos allí, se detendrán con un mensaje indicándolo. Apunta `DATABASE_URL` a un PostgreSQL real para el flujo de trabajo de migraciones; `rebase dev` ya crea las tablas que faltan de forma acumulativa en la base de datos gestionada.

`branch` se rechaza allí por una razón relacionada. `CREATE DATABASE ... TEMPLATE` contra PGlite escribe una entrada en el catálogo y no copia nada, por lo que la rama resolvería a la base de datos de la que fue clonada — cada escritura que querías aislar terminaría en tu base de datos de desarrollo. `rebase dev --docker` te proporciona un servidor real con el que las ramas pueden funcionar.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

Todo lo que declara este proyecto, y si el entorno realmente lo vincula:

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

Tres archivos determinan a qué puede acceder un backend, y este comando muestra los tres juntos: `rebase.json` indica dónde está tu código y quién ejecuta el servidor, `config/resources.ts` indica qué necesita el proyecto, y el entorno indica cómo acceder a cada cosa. Todo lo demás — `rebase.resources.json`, el manifiesto del bundle — se genera a partir del segundo para lectores que no pueden ejecutar tu código, y tú nunca lo escribes.

Un `○` es el estado que conviene conocer antes de un despliegue y no después: declarado, no configurado. Una `✗` significa que el entorno define algo de forma *incorrecta*, lo que impide el arranque en lugar de degradar el servicio.

### `rebase resources`

Lo que este proyecto declara necesitar — las bases de datos, buckets, topics y colas que solicita su código de configuración, y los crons y funciones que definen sus archivos:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` es nuevo — el flag que usa un trabajo de CI para fallar en caso de que `rebase.resources.json` ya no coincida con el código de configuración.

Un recurso se declara en el código de configuración — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — o es un archivo bajo `backend/crons` o `backend/functions`, y nunca se escribe a mano en `rebase.resources.json`, el cual se genera a partir de esas declaraciones para que un host pueda leer lo que necesita un proyecto sin compilarlo. Cada entrada registra quién lo utiliza (`collection:events`, `property:posts.cover`, `function:report`).

Un backend también cuenta con una base de datos predeterminada y un origen de almacenamiento predeterminado que nadie declara. Ambos se enumeran aquí, marcados como `implicit`, y ninguno se escribe en `rebase.resources.json` — el host los proporciona, por lo que registrarlos solicitaría el aprovisionamiento de algo que nadie pidió.

Para ver lo que la plataforma mantiene para un proyecto en comparación con lo que declara su código, y para eliminar una base de datos aprovisionada que el código ya no menciona, consulta `rebase cloud resources` a continuación.

### `rebase cloud`

Todo lo relacionado con Rebase Cloud, que se encuentra en fase beta privada. Consulta la [guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no incluye la versión beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera sobre uno sin necesidad de vincularlo.

Hay tres opciones aplicables en todas partes: `--json` para salida legible por máquina (también la opción predeterminada en tuberías o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un plano de control específico (o `REBASE_CLOUD_URL`), y `--project, -p <id>`.

#### Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

#### Vinculación de proyectos

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

`deploy` sin un nombre de aplicación despliega el backend. El despliegue de un bundle de backend también sube el código fuente del proyecto — lo que git rastrea, nunca un `.env` — para que una actualización de la plataforma pueda recompilarlo; `--no-source` omite esto una vez, y `cloud settings set --platform-rebuilds off` lo detiene y elimina la copia almacenada. `--allow-downgrade` despliega una versión anterior.

#### Configuración

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
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

`db connect` abre un puerto local que *es* la base de datos gestionada (sin endpoint público) hasta que se presione Ctrl-C; `--reveal` añade la contraseña. Solo para propietario (owner) o administrador.

#### Recursos

Lo que la plataforma mantiene para el proyecto, en comparación con lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando su declaración desaparece — eso supondría datos eliminados mediante un push. La mantiene, vincula y factura hasta que alguien la elimine (prune) por su nombre.

#### Cómputo

Lo que el proyecto reserva y cuánto cuesta.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` acepta `--cpu`, `--memory`, `--replicas`, `--spot`, `--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`, `--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`. No hay niveles de planes: todo se tarifica por recurso. Consulta [Rebase Cloud](/docs/deployment/cloud/).

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

Genera un SDK tipado a partir de las definiciones de tus colecciones:

```bash
rebase generate-sdk
```

Crea tipos de TypeScript y un cliente con tipado seguro para todas tus colecciones.

### `rebase doctor`

```bash
rebase doctor
```

El comando que se debe ejecutar cuando algo no funciona bien y aún no sabes qué es. Genera un informe y nunca modifica nada, por lo que es seguro de usar frente a cualquier base de datos a la que tengas acceso.

**Sin una base de datos.** Estas comprobaciones se ejecutan primero, porque todo lo que impide que un proyecto funcione ocurre antes de que se pueda comparar una tabla:

| Comprobación | Por qué |
| --- | --- |
| Versión de Node | Frente al rango que declara la CLI. Una versión demasiado antigua no se notifica como "Node no soportado" — resulta en un error de sintaxis dentro de una dependencia. |
| Gestores de paquetes | Dos archivos lockfile en un mismo proyecto. Ejecutar `npm install` en un workspace de pnpm reescribe `node_modules` en una disposición incompatible con pnpm, y el síntoma es `Cannot find module` horas después. |
| Slugs duplicados | El registro conserva la última colección registrada, por lo que la otra no se notifica como faltante — se sirve como la ganadora, bajo su propio nombre. |
| Validación de `.env` | Un `JWT_SECRET` con menos de 32 caracteres (con el cual producción se niega a arrancar), y `NODE_ENV=production` sin `CORS_ORIGINS` ni `FRONTEND_URL`. Los valores nunca se muestran. |
| Desalineación de versiones de `@rebasepro/*` | El mismo paquete fijado a diferentes versiones en los archivos `package.json` del proyecto. Dos copias rompen el `instanceof` entre ellas, fallando como una guarda de tipos que rechaza su propio tipo. |
| Cadenas de conexión | Un `=` no codificado en un parámetro de URL, que las propias herramientas de PostgreSQL se niegan a parsear — provocando que los respaldos y `psql` fallen mientras la aplicación sigue funcionando. |
| Funciones personalizadas | Lo que cada función necesita de su host y cuáles de ellas no se ejecutarían en un edge runtime. |

**Contra la base de datos**, cuando `DATABASE_URL` está configurada:

| Comprobación | Por qué |
| --- | --- |
| Colecciones → esquema generado | Si `schema.generated.ts` está desactualizado. |
| Colecciones → base de datos | Tablas, columnas, enums, claves foráneas y uniones faltantes. |
| Extensiones requeridas | Una propiedad `{ type: "vector" }` necesita pgvector, que Rebase instala únicamente donde el proyecto lo haya declarado. |
| Sello del esquema (Schema stamp) | Si esta base de datos fue aprovisionada a partir de estas colecciones. Es un hash, por lo que puede indicar que ambos difieren, pero nunca cuál está más adelantado. |
| Colecciones → tipos del SDK | Si el SDK tipado generado está desactualizado. |
| Políticas RLS | Si las políticas de la base de datos coinciden con las `securityRules` declaradas, y si alguna política nombra un rol que este servidor no pueda usar. |

Si la base de datos no es accesible, sus fases se reportan como omitidas con el motivo y el resto se sigue ejecutando — consulta [Resolución de problemas](/docs/troubleshooting/).

Finaliza con código distinto de cero cuando una comprobación detecta un error o cuando una fase no pudo ejecutarse porque la base de datos indicada rechaza las conexiones. Una fase omitida debido a que no definiste `DATABASE_URL` no se considera un fallo.

`rebase doctor --policies` ejecuta únicamente las comprobaciones de RLS — sin diferencias de esquema ni tipos de SDK — y falla de forma restrictiva (fail closed), lo que lo convierte en la opción adecuada para usar como control (gate) en CI contra una base de datos desplegada.

### `rebase auth`

Comandos de gestión de autenticación:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

<span class="since-badge" data-since="0.24">Desde 0.24</span> Gestiona las API keys de servicio del proyecto — la credencial que utiliza un agente, script u otro servicio, a diferencia de la sesión de un usuario final:

```bash
rebase api-keys list
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` nombra lo que la clave puede hacer, separado por comas o repetido; `--full-access` le da todos los alcances que tiene la clave de servicio excepto `keys:*`. `--roles` añade roles de RLS además de `service`, `--expires-in` recibe días y `--expires-at` una fecha ISO. `rebase api-keys scopes` lista todos los alcances que conoce el backend. Una clave solo se muestra una vez.

Las claves cuentan con doble validación: se aplican tanto los alcances de la clave como la seguridad a nivel de fila (RLS) de la identidad bajo la que actúa. Consulta [Claves de API](/docs/backend/api-keys/).

### `rebase skills install`

Instala las skills de referencia de Rebase para tus asistentes de programación con IA — todos los `--agent` mencionados anteriormente:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulta [Skills del agente](/docs/ai/skills) para ver la lista completa y dónde se escriben los archivos.

### `rebase telemetry`

Envío anónimo de datos de uso. **`rebase init` pregunta una vez por proyecto, y la opción predeterminada es afirmativa — no se envía nada a menos que respondas:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime la configuración actual, `show` imprime exactamente lo que se enviaría — independientemente de si el envío está activado o no, para que puedas revisar el payload antes de decidir —, y los otros dos lo modifican. Si nunca ejecutaste `init`, nunca se recopiló nada.

## Siguientes pasos

- **[Generación de esquemas](/docs/cli/schema/#production-workflow)** — El flujo de trabajo de migración, desde la edición de colecciones hasta producción
- **[Esquema como código](/docs/architecture/schema-as-code)** — Cómo funciona la generación de esquemas
- **[Inicio rápido](/docs/getting-started/quickstart)** — Empieza a trabajar
