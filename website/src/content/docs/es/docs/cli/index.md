---
sourceHash: 97dd0e836d51f599
title: Referencia de CLI
sidebar_label: CLI
description: Comandos de la CLI de Rebase para la inicialización de proyectos, generación de esquemas, migraciones de bases de datos y generación de SDKs.
---

## Descripción general

La CLI de Rebase (`rebase`) gestiona tu proyecto desde el scaffolding inicial hasta el despliegue.

## Instalación

```bash
pnpm add -g @rebasepro/cli
```

O úsala mediante `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Salida legible por máquina

`--json` es el modificador y, fuera de la familia `cloud`, es el único: `rebase status`, `rebase resources` y `rebase apps list` emiten un único valor JSON en stdout —el resultado, o una estructura `{"error": {"message", "code", "hint", "issues"}}` con una salida distinta de cero— en **cada** finalización del comando, de modo que quien lo invoque pueda procesar stdout de forma incondicional. Sin él, escriben texto legible por humanos y los errores van a stderr. `rebase cloud` utiliza la misma estructura y es la única excepción a este modificador: también activa JSON por sí mismo cuando stdout no es una TTY, o cuando `REBASE_JSON=1` está definido. Por lo tanto, `rebase cloud status | cat` produce JSON mientras que `rebase status | cat` no —en un script, pasa `--json` explícitamente en lugar de depender de cualquiera de estas reglas.

## Comandos

### `rebase init`

Inicializa un nuevo proyecto de Rebase:

```bash
rebase init [directory]
```

Configura la estructura del proyecto con paquetes para frontend, backend y compartidos.

| Flag | Qué hace |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Por defecto `blog` |
| `--headless` | Solo backend: sin panel de administración y sin archivos de colecciones. `--template` no tiene efecto, ya que no hay colecciones que sembrar |
| `-y, --yes` | Nunca solicita confirmación. **Requerido siempre que no haya un terminal para responder**, como en entornos de CI. Omite git init y la instalación de dependencias (los valores predeterminados interactivos responden afirmativamente a ambos, así que pasa `--git` / `--install` si los deseas) |
| `-i, --install` | Instala dependencias tras el scaffolding |
| `-g, --git` | Inicializa un repositorio y realiza el primer commit |
| `--database-url <url>` | Usa una base de datos existente en lugar de la administrada |
| `--introspect` | Genera colecciones a partir de esa base de datos. Implica `--template blank` y requiere `--install` |
| `--project <slug>` | Vincula el scaffolding a un proyecto de Rebase Cloud |
| `--setup-key <key>` | La clave de un solo uso que autentica dicha vinculación |

### `rebase dev`

Inicia el servidor de desarrollo:

```bash
rebase dev
```

Inicia tanto el frontend como el backend con recarga en caliente (hot reloading).

Ambos puertos se derivan de la ruta del proyecto, por lo que varios proyectos de Rebase pueden ejecutarse
en paralelo. Utiliza las URLs que imprime `rebase dev`. Fija un puerto específico con `rebase dev --port 3001`.

### `rebase build`

Compila el proyecto en un bundle desplegable en `dist-bundle/`:

```bash
rebase build
```

El bundle es el artefacto que despliegas: la imagen del runtime lo carga, por lo que no es necesario
construir una imagen de aplicación por tu cuenta. Flags útiles:

| Flag | Efecto |
|------|--------|
| `--out <dir>` | Escribe el bundle en un lugar distinto a `dist-bundle/` |
| `--vendor` | Siempre instala e incluye las dependencias del bundle (vendoring) |
| `--no-vendor` | Nunca realiza vendoring; el pod las instala en el primer inicio |
| `--skip-type-check` | Omite la comprobación de tipos (más rápido, menos seguro) |
| `--no-static` | Omite la compilación del frontend |

Las dependencias se incluyen mediante vendoring por defecto para que el reinicio de un pod no conlleve
un retraso de instalación de 35 a 55 segundos. Un árbol de dependencias que supere los 200 MB en disco
se descarta, ya que el límite de subida es de 100 MB comprimidos —consulta el registro de cambios para conocer los motivos.

### `rebase start`

Ejecuta el bundle compilado como un servidor de producción:

```bash
rebase start
```

Lee `PORT` y el resto de variables en `.env`, a diferencia de `rebase dev`. Apúntalo a un bundle
situado en otra ubicación con `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Muestra las aplicaciones que declara este repositorio:

```bash
rebase apps list
```

Un repositorio puede declarar más de una aplicación desplegable —por ejemplo, un backend y un
sitio de marketing. Así es como puedes ver sobre qué actuarán `rebase build` y el despliegue.

### `rebase eject`

Toma el control del proceso del servidor y de su imagen:

```bash
rebase eject
```

Escribe el punto de entrada del backend y un `Dockerfile` en el proyecto y cambia la configuración
de su backend, de modo que el repositorio construya su propia imagen en lugar de ejecutar el runtime
publicado. A partir de ese momento, **las actualizaciones del runtime de la plataforma ya no lo afectarán**,
y la configuración de CORS, autenticación, almacenamiento y apagado (shutdown) pasarán a ser tu responsabilidad.

Previsualízalo con `rebase eject --dry-run`, que enumera lo que cambiaría sin modificar nada.
`--force` reemplaza un archivo `backend/src/index.ts` o `env.ts` existente, conservando el archivo actual como `<name>.bak`.

### `rebase schema generate`

Genera el esquema de Drizzle ORM a partir de tus colecciones de TypeScript:

```bash
rebase schema generate
```

Esto lee tus colecciones desde `config/collections/` y genera `backend/src/schema.generated.ts` con definiciones de tablas, enumeraciones y relaciones de Drizzle.

### `rebase db push`

Envía los cambios de esquema directamente a la base de datos (solo desarrollo):

```bash
rebase db push
```

:::caution
`db push` modifica la base de datos directamente sin archivos de migración. Utiliza `db generate` + `db migrate` para producción.
:::

### `rebase db generate`

Genera archivos de migración SQL a partir de los cambios en el esquema:

```bash
rebase db generate
```

Crea archivos de migración con marca de tiempo en `drizzle/` que se pueden revisar y confirmar en el control de versiones.

### `rebase db migrate`

Ejecuta las migraciones de base de datos pendientes:

```bash
rebase db migrate
```

Aplica todas las migraciones no aplicadas a la base de datos.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` ejecuta `pg_dump`; `restore` ejecuta `pg_restore` y es destructivo, por lo que
requiere `--yes`. `--out` acepta una ruta local o una URL de almacenamiento de objetos, y
usa por defecto `$BACKUP_DESTINATION` o `./backups`.

### `rebase db pull`

Copia otra base de datos en la base de datos de desarrollo local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` reemplaza campos personales durante la importación, de modo que se pueda
trabajar localmente con una copia de producción sin transferir datos reales de clientes al ordenador.

`pg_dump` elimina privilegios, por lo que la copia llegaría con las políticas RLS del
origen pero sin ninguno de los permisos detrás de ellas —haciendo que cada lectura como `rebase_user`
falle con `permission denied`. El pull reaprovisiona el rol de la aplicación posteriormente,
usando la misma rutina que emplean el arranque y `rebase db push`, de modo que las tablas internas
de Rebase permanezcan revocadas como corresponde.

El destino siempre es la base de datos de desarrollo local de este proyecto y no se puede
elegir: `--database-url` se rechaza, por lo que no hay forma de indicar "hacer un pull hacia producción".
`--from` es la única dirección permitida.

### `rebase db url`

Imprime la cadena de conexión que está utilizando este proyecto, y nada más, para que
pueda encadenarse con pipes:

```bash
rebase db url
psql "$(rebase db url)"
```

La base de datos de desarrollo administrada es el caso que necesita esto: `.env` deja
`DATABASE_URL` comentada a propósito, y el puerto se deriva de la ruta del proyecto,
por lo que nada en el disco la nombra explícitamente. Cuando hayas configurado una `DATABASE_URL`
propia, eso será lo que imprima este comando —el orden de resolución es el mismo que sigue
cualquier otro comando. Inicia la base de datos administrada si no se está ejecutando ya.

### `rebase db stop` / `rebase db reset`

Solo para la base de datos de desarrollo administrada:

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

PostgreSQL no copiará ni eliminará una base de datos a la que haya otra conexión activa, y
lo habitual es que esa "otra conexión" sea tu propio `rebase dev`. `create` y `delete` indican
qué está manteniendo abierta la base de datos; `--force` desconecta esas sesiones primero.

Cada rama es una copia completa en disco, por lo que es necesario limpiarlas. `prune` elimina
tres cosas: una entrada cuya base de datos se eliminó fuera de Rebase, una base de datos de rama
cuya entrada nunca se registró y —solo con `--older-than`— ramas que superen la antigüedad indicada.
Solicitará confirmación antes de eliminar nada a menos que pases `--yes`.

`switch` registra la rama en `.rebase/branch.json` y nunca edita `.env`. Tiene prioridad
sobre `DATABASE_URL` en `.env` y cede ante `--database-url` o una variable `DATABASE_URL` en la terminal,
por lo que un flag en la línea de comandos siempre prevalece sobre un cambio realizado anteriormente.
Eliminar la rama en la que te encuentras te devuelve a la base de datos principal en lugar de
dejar el proyecto apuntando a una base de datos inexistente.

:::note[No disponible en la base de datos de desarrollo administrada]
`push`, `generate` y `migrate` planifican su trabajo con Atlas, que necesita una segunda
base de datos vacía contra la cual comparar —y la instancia administrada de PGlite sirve exactamente una.
Ejecutarlos allí se detiene con un mensaje que lo indica. Apunta `DATABASE_URL` a un PostgreSQL
real para el flujo de trabajo de migraciones; `rebase dev` ya crea tablas faltantes de forma
aditiva en la instancia administrada.

`branch` se rechaza allí por una razón similar. `CREATE DATABASE ... TEMPLATE` en PGlite
escribe una entrada de catálogo y no copia nada, por lo que la rama apuntaría a la base de datos
desde la que se clonó —cada escritura que pretendías aislar terminaría en tu base de datos de desarrollo.
`rebase dev --docker` te proporciona un servidor real sobre el que pueden operar las ramas.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

Todo lo que este proyecto declara y si el entorno realmente lo vincula:

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
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
      ✓ S3_BUCKET__MEDIA
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Tres archivos deciden a qué puede acceder un backend, y este comando muestra los tres juntos:
`rebase.json` indica dónde está tu código y quién ejecuta el servidor,
`config/resources.ts` indica qué necesita el proyecto, y el entorno indica cómo acceder a cada cosa.
Todo lo demás —`rebase.resources.json`, el manifiesto del bundle— se genera a partir de este último
para aquellos lectores que no pueden ejecutar tu código, y nunca lo escribes manualmente.

Un símbolo `○` representa el estado que conviene conocer antes de un despliegue y no después:
declarado, pero no configurado. Una `✗` indica que el entorno configura algo *incorrectamente*,
lo que rechaza el arranque en lugar de degradar el servicio.

### `rebase resources`

Lo que este proyecto declara que necesita: las bases de datos, buckets, tópicos y
colas que solicita su código de configuración, y los crons y funciones que definen sus archivos:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` es nuevo: es el flag que un trabajo de CI utiliza para fallar
si un archivo `rebase.resources.json` ya no coincide con el código de configuración.

Un recurso se declara en el código de configuración —`database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")`— o es un archivo
bajo `backend/crons` o `backend/functions`, y nunca se escribe a mano en
`rebase.resources.json`, el cual se genera a partir de esas declaraciones para que un host pueda
leer lo que necesita un proyecto sin compilarlo. Cada entrada registra quién la usa
(`collection:events`, `property:posts.cover`, `function:report`).

Un backend también tiene una base de datos por defecto y una fuente de almacenamiento por defecto
que nadie declara. Ambas se listan aquí marcadas como `implicit`, y ninguna se escribe en
`rebase.resources.json` —el host las proporciona, por lo que registrarlas implicaría solicitar
el aprovisionamiento de algo que nadie pidió.

Para ver qué mantiene la plataforma para un proyecto en comparación con lo que declara su código,
y para eliminar una base de datos aprovisionada que el código ya no menciona, consulta
`rebase cloud resources` más abajo.

### `rebase cloud`

Todo lo relacionado con Rebase Cloud, que se encuentra en beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber en qué consiste y qué no incluye la versión beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos
actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera sobre
uno sin vincularlo.

Tres opciones aplican en todas partes: `--json` para salida legible por máquina (también la
predeterminada cuando se usa con pipes o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un
plano de control específico (o `REBASE_CLOUD_URL`), y `--project, -p <id>`.

#### Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # show the current session
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

`deploy` sin un nombre de aplicación despliega el backend.

#### Configuración

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain
```

#### Organizaciones

```bash
rebase cloud orgs list | create | members
```

#### Bases de datos

```bash
rebase cloud db list | create | info | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

#### Recursos

Lo que la plataforma mantiene para el proyecto frente a lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando desaparece su declaración; eso
equivaldría a borrar datos mediante un push. La mantiene, la vincula y la factura hasta que alguien
la purgue explícitamente por su nombre.

#### Cómputo

Lo que reserva el proyecto y su coste.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` acepta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`.
No hay niveles de planes: todo se tarifica por recurso. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

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

Crea tipos de TypeScript y un cliente con tipado seguro para todas tus colecciones.

### `rebase doctor`

```bash
rebase doctor
```

El comando que debes ejecutar cuando algo va mal y aún no sabes qué es. Genera un
informe y nunca modifica nada, por lo que es seguro de ejecutar contra cualquier base de datos
a la que tengas acceso.

**Sin una base de datos.** Estas comprobaciones se ejecutan primero, ya que todo lo que impide
que un proyecto funcione en absoluto ocurre antes de que se pueda comparar una tabla:

| Comprobación | Motivo |
| --- | --- |
| Versión de Node | Frente al rango que declara la CLI. Una versión demasiado antigua no se notifica como "Node incompatible", sino como un error de sintaxis dentro de una dependencia. |
| Gestores de paquetes | Dos archivos de bloqueo (lockfiles) en un mismo proyecto. `npm install` en un workspace de pnpm reorganiza `node_modules` de una forma incompatible con pnpm, manifestándose horas después como `Cannot find module`. |
| Slugs duplicados | El registro conserva la última colección registrada, por lo que la otra no se reporta como ausente, sino que se sirve como la ganadora, bajo su propio nombre. |
| Validez de `.env` | Un `JWT_SECRET` de menos de 32 caracteres (con el cual producción rehúsa iniciar) y `NODE_ENV=production` sin `CORS_ORIGINS` ni `FRONTEND_URL`. Los valores nunca se imprimen. |
| Discrepancia de versiones de `@rebasepro/*` | El mismo paquete fijado a diferentes versiones en los archivos `package.json` del proyecto. Dos copias rompen el funcionamiento de `instanceof` entre ellas, fallando como una guarda de tipos que rechaza su propio tipo. |
| Cadenas de conexión | Un carácter `=` sin codificar en un parámetro de URL, que las propias herramientas de PostgreSQL se niegan a procesar —haciendo que los backups y `psql` fallen mientras la aplicación continúa funcionando. |
| Funciones personalizadas | Lo que cada función requiere de su host, y cuáles de ellas no funcionarían en un runtime edge. |

**Contra la base de datos**, cuando `DATABASE_URL` está configurada:

| Comprobación | Motivo |
| --- | --- |
| Colecciones → esquema generado | Si `schema.generated.ts` está desactualizado. |
| Colecciones → base de datos | Tablas, columnas, enumeraciones, claves foráneas y uniones faltantes. |
| Extensiones requeridas | Una propiedad `{ type: "vector" }` requiere pgvector, que Rebase instala únicamente donde un proyecto lo haya declarado. |
| Sello de esquema (Schema stamp) | Si esta base de datos fue aprovisionada a partir de estas colecciones. Es un hash, por lo que puede indicar que ambas difieren pero nunca cuál está más avanzada. |
| Colecciones → tipos del SDK | Si el SDK tipado generado está desactualizado. |
| Políticas RLS | Si las políticas de la base de datos coinciden con las `securityRules` declaradas y si alguna política nombra un rol que este servidor no puede utilizar. |

Si no se puede acceder a la base de datos, sus fases se reportan como omitidas indicando el
motivo y el resto continúa ejecutándose —consulta [Resolución de problemas](/docs/troubleshooting/).

Termina con un código de salida distinto de cero cuando una comprobación encuentra un error, o cuando
una fase no pudo ejecutarse porque la base de datos asignada rechaza las conexiones. Una fase omitida
porque no definiste `DATABASE_URL` no se considera un fallo.

`rebase doctor --policies` ejecuta únicamente las comprobaciones de RLS —sin diff de esquema ni
tipos del SDK— y falla cerrando el acceso, lo que lo convierte en la modalidad indicada para usar como control en CI contra una base de datos desplegada.

### `rebase auth`

Comandos de gestión de autenticación:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestiona API keys de servicio con ámbito limitado: las credenciales que utiliza un agente, script u otro
servicio, a diferencia de la sesión de un usuario final:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` recibe un array JSON de objetos `{ collection, operations }`, o bien utiliza
`--full-access` para lectura/escritura/eliminación en todas las colecciones y funciones. `--expires`
acepta `7d`, `30d`, `90d`, `1y` o una fecha ISO, y `--rate-limit` define las peticiones
por ventana de 15 minutos. Una clave solo se muestra una vez, en el momento de su creación.

Las claves tienen doble validación: aplican tanto los permisos propios de la clave como la seguridad a nivel de fila (RLS)
de la identidad bajo la que actúa, por lo que una clave nunca podrá leer más de lo que dicha identidad tiene permitido.

### `rebase skills install`

Instala las skills de referencia de Rebase para tu asistente de codificación con IA. Compatible con
Cursor, Claude Code, Windsurf, Gemini CLI y Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulta [Agent Skills](/docs/ai/skills) para ver la lista completa y dónde se escriben los archivos.

### `rebase telemetry`

Uso compartido de telemetría anónima. **`rebase init` pregunta una vez por proyecto, y la opción
predeterminada es afirmativa —no se envía nada a menos que respondas:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` muestra la configuración actual, `show` imprime exactamente qué se enviaría —esté o no
activada la compartición, para que puedas revisar el contenido antes de decidir— y los
otros dos comandos modifican dicha configuración. Si nunca ejecutaste `init`, nunca se recopiló nada.

## Flujo de trabajo de migración

El flujo de trabajo habitual para los cambios de esquema:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration
rebase db generate

# 4. Review the generated SQL in drizzle/

# 5. Apply the migration
rebase db migrate
```

## Siguientes pasos

- **[Schema as Code](/docs/architecture/schema-as-code)** — Cómo funciona la generación de esquemas
- **[Inicio rápido](/docs/getting-started/quickstart)** — Primeros pasos

---
