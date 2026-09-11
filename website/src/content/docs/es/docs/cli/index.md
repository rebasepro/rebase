---
sourceHash: ace00ff64a9b8e17
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

`--json` es el modificador, y fuera de la familia `cloud` es el único: `rebase status`, `rebase resources` y `rebase apps list` colocan entonces un único valor JSON en stdout — el resultado, o una estructura envolvente `{"error": {"message", "code", "hint", "issues"}}` con una salida distinta de cero — en **cada** finalización del comando, de modo que el invocador pueda analizar stdout incondicionalmente. Sin él, escriben texto legible para humanos y los errores van a stderr. `rebase cloud` utiliza la misma estructura envolvente y es la única excepción al modificador: también activa JSON por sí mismo cuando stdout no es una TTY, o cuando `REBASE_JSON=1` está configurado. Por lo tanto, `rebase cloud status | cat` genera JSON mientras que `rebase status | cat` no — en un script, pasa `--json` explícitamente en lugar de depender de cualquiera de las dos reglas.

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
| `--headless` | Solo backend — sin panel de administración ni archivos de colecciones. `--template` no tiene efecto, porque no hay colecciones que sembrar |
| `-y, --yes` | Nunca preguntar. **Requerido siempre que no haya un terminal para responder**, como en CI. Omite git init y la instalación de dependencias — los valores interactivos por defecto responden sí a ambos, así que pasa `--git` / `--install` si los deseas |
| `-i, --install` | Instalar dependencias después del scaffolding |
| `-g, --git` | Inicializar un repositorio y realizar el primer commit |
| `--database-url <url>` | Usar una base de datos existente en lugar de la administrada |
| `--introspect` | Generar colecciones a partir de esa base de datos. Implica `--template blank` y requiere `--install` |
| `--project <slug>` | Vincular el scaffold a un proyecto de Rebase Cloud |
| `--setup-key <key>` | La clave de un solo uso que autentica ese vínculo |

### `rebase dev`

Inicia el servidor de desarrollo:

```bash
rebase dev
```

Inicia tanto el frontend como el backend con recarga en caliente (hot reloading).

Ambos puertos se derivan de la ruta del proyecto para que varios proyectos de Rebase puedan ejecutarse en paralelo. Usa las URLs que imprime `rebase dev`. Fija uno con `rebase dev --port 3001`.

### `rebase build`

Compila el proyecto en un bundle desplegable en `dist-bundle/`:

```bash
rebase build
```

El bundle es el artefacto que despliegas — la imagen del runtime lo carga, por lo que no hay ninguna imagen de aplicación que debas compilar tú mismo. Flags útiles:

| Flag | Efecto |
|------|--------|
| `--out <dir>` | Escribir el bundle en otro lugar que no sea `dist-bundle/` |
| `--vendor` | Siempre instalar e incluir las dependencias del bundle |
| `--no-vendor` | Nunca incluir dependencias (vendor); el pod las instala en el primer inicio |
| `--skip-type-check` | Omitir la comprobación de tipos (más rápido, menos seguro) |
| `--no-static` | Omitir la compilación del frontend |

Las dependencias se incluyen (vendored) por defecto para que el reinicio de un pod no pague una instalación de 35–55 segundos. En cambio, si el árbol supera los 200 MB en disco se descarta, ya que el límite de subida es de 100 MB comprimido — consulta el changelog para ver la justificación.

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

Un repositorio puede declarar más de una aplicación desplegable — por ejemplo, un backend y un sitio de marketing. Así es como ves sobre qué actuarán `rebase build` y el despliegue.

### `rebase eject`

Toma el control del proceso del servidor y su imagen:

```bash
rebase eject
```

Escribe el punto de entrada del backend y un `Dockerfile` en el proyecto y cambia su backend, de modo que el repositorio construye su propia imagen en lugar de ejecutar el runtime publicado. A partir de entonces, **las actualizaciones del runtime de la plataforma ya no lo alcanzarán**, y CORS, la configuración de autenticación, el almacenamiento y el apagado pasarán a ser tu responsabilidad de configurar.

Previsualízalo con `rebase eject --dry-run`, que enumera lo que cambiaría sin modificar nada. `--force` reemplaza un `backend/src/index.ts` o `env.ts` existente, conservando el archivo actual como `<name>.bak`.

### `rebase schema generate`

Genera el esquema de Drizzle ORM a partir de tus colecciones de TypeScript:

```bash
rebase schema generate
```

Esto lee tus colecciones desde `config/collections/` y genera `backend/src/schema.generated.ts` con definiciones de tablas, enums y relaciones de Drizzle.

### `rebase db push`

Envía los cambios de esquema directamente a la base de datos (solo desarrollo):

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

Aplica todas las migraciones no aplicadas a la base de datos.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` ejecuta `pg_dump`; `restore` ejecuta `pg_restore` y es destructivo, por lo que requiere `--yes`. `--out` acepta una ruta local o una URL de almacenamiento de objetos, y su valor predeterminado es `$BACKUP_DESTINATION` o `./backups`.

### `rebase db pull`

Copia otra base de datos en la de desarrollo local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` reemplaza los campos personales durante la importación, de modo que se pueda trabajar localmente con una copia de producción sin transferir datos reales de clientes a un portátil.

`pg_dump` despoja los privilegios, por lo que la copia llegaría con las políticas RLS del origen y ninguna de las concesiones (grants) detrás de ellas — fallando cada lectura como `rebase_user` con `permission denied`. El pull vuelve a aprovisionar el rol de la aplicación posteriormente, usando la misma rutina que usan el arranque y `rebase db push`, por lo que las tablas internas de Rebase permanecen revocadas como debe ser.

El destino siempre es la base de datos de desarrollo local de este proyecto y no se puede elegir: `--database-url` se rechaza en lugar de aceptarse, por lo que no hay forma de indicar un "pull hacia producción". `--from` es la única dirección.

### `rebase db url`

Imprime la cadena de conexión que está utilizando este proyecto, y nada más, para poder redirigirla por tuberías (pipes):

```bash
rebase db url
psql "$(rebase db url)"
```

La base de datos de desarrollo administrada es el caso que necesita esto: `.env` deja `DATABASE_URL` comentada a propósito, y el puerto se deriva de la ruta del proyecto, por lo que nada en el disco la nombra. Cuando hayas configurado tu propia `DATABASE_URL`, eso es lo que imprime — el orden de resolución es el mismo que sigue cualquier otro comando. Inicia la base de datos administrada si aún no se está ejecutando.

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

PostgreSQL no copiará ni eliminará una base de datos a la que haya algo conectado, y ese "algo" habitual es tu propio `rebase dev`. `create` y `delete` indican qué mantiene abierta la base de datos; `--force` desconecta primero esas sesiones.

Cada rama es una copia completa en disco, por lo que es necesario limpiarlas. `prune` elimina tres cosas: una entrada cuya base de datos fue eliminada fuera de Rebase, una base de datos de rama cuya entrada nunca se escribió y — solo con `--older-than` — ramas que superen la antigüedad especificada. Pregunta antes de eliminar cualquier cosa a menos que pases `--yes`.

`switch` registra la rama en `.rebase/branch.json` y nunca edita `.env`. Tiene prioridad sobre `DATABASE_URL` en `.env` y cede ante `--database-url` o una `DATABASE_URL` en la shell, por lo que una flag en la línea de comandos siempre prevalece sobre un cambio realizado anteriormente. Eliminar la rama en la que te encuentras te devuelve a la base de datos principal en lugar de dejar el checkout apuntando a una base de datos que ya no existe.

:::note[No en la base de datos de desarrollo administrada]
`push`, `generate` y `migrate` planifican su trabajo con Atlas, que necesita una segunda base de datos vacía con la cual comparar — y el PGlite administrado sirve exactamente una. Ejecutarlos allí se detiene con un mensaje indicándolo. Apunta `DATABASE_URL` a un PostgreSQL real para el flujo de trabajo de migración; `rebase dev` ya crea las tablas que faltan de forma aditiva en la administrada.

`branch` se rechaza allí por una razón similar. `CREATE DATABASE ... TEMPLATE` contra PGlite escribe una entrada en el catálogo y no copia nada, por lo que la rama se resolvería en la base de datos de la que fue clonada — cada escritura que pretendías aislar terminaría en tu base de datos de desarrollo. `rebase dev --docker` te proporciona un servidor real con el que las ramas pueden trabajar.
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

Tres archivos deciden a qué puede acceder un backend, y esto imprime los tres juntos:
`rebase.json` indica dónde está tu código y quién ejecuta el servidor,
`config/resources.ts` indica qué necesita el proyecto, y el entorno indica cómo
acceder a cada cosa. Todo lo demás — `rebase.resources.json`, el manifiesto del bundle —
se genera a partir del archivo intermedio para lectores que no pueden ejecutar tu
código, y nunca lo escribes tú.

Un `○` es el estado que vale la pena conocer antes de un despliegue en lugar de después:
declarado, no configurado. Una `✗` significa que el entorno configura algo *incorrectamente*,
lo que rechaza el arranque en lugar de degradarse.

### `rebase resources`

Lo que este proyecto declara que necesita — las bases de datos, buckets, topics y
colas que solicita su código de configuración, y los crons y funciones que definen sus archivos:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` es nuevo — la flag que usa un trabajo de CI para fallar
ante un `rebase.resources.json` que ya no coincide con el código de configuración.

Un recurso se declara en el código de configuración — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — o es un archivo
bajo `backend/crons` o `backend/functions`, y nunca se escribe a mano en
`rebase.resources.json`, el cual se genera a partir de esas declaraciones para que un host pueda
leer lo que necesita un proyecto sin compilarlo. Cada entrada registra quién la usa
(`collection:events`, `property:posts.cover`, `function:report`).

Un backend también tiene una base de datos predeterminada y una fuente de almacenamiento predeterminada que nadie
declara. Ambas se enumeran aquí, marcadas como `implicit`, y ninguna se escribe en
`rebase.resources.json` — el host las suministra, por lo que registrarlas solicitaría
aprovisionar algo que nadie ha pedido.

Para ver lo que la plataforma mantiene para un proyecto frente a lo que declara su código,
y para eliminar una base de datos aprovisionada que el código ya no nombra, consulta
`rebase cloud resources` más abajo.

### `rebase cloud`

Todo lo relacionado con Rebase Cloud, que está en beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no incluye
la versión beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría de los comandos
actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` opera en
uno sin vincularlo.

Tres opciones se aplican en todas partes: `--json` para salida legible por máquina (también el
valor predeterminado cuando se redirige por tubería o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un
plano de control específico (o `REBASE_CLOUD_URL`), y `--project, -p <id>`.

#### Autenticación

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # show the current session
```

#### Enlace de proyecto

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
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` abre un puerto local que *es* la base de datos administrada (sin endpoint
público) hasta presionar Ctrl-C; `--reveal` añade la contraseña. Solo propietario o administrador.

#### Recursos

Lo que la plataforma mantiene para el proyecto, frente a lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando desaparece su declaración — eso
supondría datos eliminados por un push. La mantiene, vincula y factura hasta que alguien la
elimine (prune) por su nombre.

#### Cómputo

Lo que reserva el proyecto y cuánto cuesta.

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

Crea tipos de TypeScript y un cliente con seguridad de tipos (type-safe) para todas tus colecciones.

### `rebase doctor`

```bash
rebase doctor
```

El comando a ejecutar cuando algo va mal y aún no sabes qué es. Informa
y nunca cambia nada, por lo que es seguro contra cualquier base de datos a la que
puedas acceder.

**Sin una base de datos.** Estas comprobaciones se ejecutan primero, porque todo lo que impide que un proyecto
funcione en absoluto ocurre antes de que se pueda comparar una tabla:

| Comprobación | Motivo |
| --- | --- |
| Versión de Node | Contra el rango que declara la CLI. Una versión demasiado antigua no se informa como "Node no soportado" — es un error de sintaxis dentro de una dependencia. |
| Gestores de paquetes | Dos lockfiles en un solo proyecto. `npm install` en un espacio de trabajo de pnpm reescribe `node_modules` con una estructura con la que pnpm no concuerda, y el síntoma es `Cannot find module` horas más tarde. |
| Slugs duplicados | El registro conserva la última colección registrada, por lo que la otra no se reporta como faltante — se sirve como la ganadora, bajo su propio nombre. |
| Sanidad de `.env` | Un `JWT_SECRET` de menos de 32 caracteres (con el cual producción rechaza arrancar), y `NODE_ENV=production` sin `CORS_ORIGINS` ni `FRONTEND_URL`. Los valores nunca se imprimen. |
| Desfase de versiones de `@rebasepro/*` | El mismo paquete fijado a diferentes versiones en los archivos `package.json` del proyecto. Dos copias rompen el `instanceof` entre ellas, lo que falla como un type guard que rechaza su propio tipo. |
| Cadenas de conexión | Un `=` no codificado en un parámetro de URL, que las propias herramientas de PostgreSQL se niegan a analizar — por lo que los backups y `psql` fallan mientras la aplicación sigue funcionando. |
| Funciones personalizadas | Qué necesita cada función de su host y cuáles de ellas no se ejecutarían en un runtime edge. |

**Contra la base de datos**, cuando `DATABASE_URL` está configurada:

| Comprobación | Motivo |
| --- | --- |
| Colecciones → esquema generado | Si `schema.generated.ts` está desactualizado. |
| Colecciones → base de datos | Tablas, columnas, enums, claves foráneas y uniones faltantes. |
| Extensiones requeridas | Una propiedad `{ type: "vector" }` necesita pgvector, que Rebase instala únicamente donde un proyecto lo declaró. |
| Sello de esquema (Schema stamp) | Si esta base de datos fue aprovisionada a partir de estas colecciones. Un hash, de modo que puede indicar que los dos difieren y nunca cuál va por delante. |
| Colecciones → tipos de SDK | Si el SDK tipado generado está desactualizado. |
| Políticas RLS | Si las políticas de la base de datos coinciden con las `securityRules` que declaraste, y si alguna política nombra un rol que este servidor no puede usar. |

Si la base de datos es inaccesible, sus fases se informan como omitidas con el
motivo y el resto continúa ejecutándose — consulta [Resolución de problemas](/docs/troubleshooting/).

Sale con un código distinto de cero cuando una comprobación encuentra un error, o cuando una fase no pudo ejecutarse
porque la base de datos proporcionada rechaza las conexiones. Una fase omitida porque
no configuraste ninguna `DATABASE_URL` no se considera un fallo.

`rebase doctor --policies` ejecuta únicamente las comprobaciones de RLS — sin diferencias de esquema ni tipos de SDK —
y falla de forma estricta (fails closed), lo que lo convierte en la modalidad indicada para usar como control de CI contra una
base de datos desplegada.

### `rebase auth`

Comandos de gestión de autenticación:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestiona claves de API de servicio con alcance limitado (scoped) — la credencial que utiliza un agente, script u otro
servicio, a diferencia de la sesión de un usuario final:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` acepta un array JSON de objetos `{ collection, operations }`, o usa
`--full-access` para lectura/escritura/eliminación en cada colección y función. `--expires`
acepta `7d`, `30d`, `90d`, `1y` o una fecha ISO, y `--rate-limit` establece las solicitudes
por ventana de 15 minutos. La clave se muestra una sola vez, en el momento de su creación.

Las claves tienen doble control de acceso: se aplican tanto los permisos propios de la clave como la seguridad a nivel de fila (RLS) de
la identidad bajo la que actúa, por lo que una clave nunca puede leer más de lo que dicha identidad permite.

### `rebase skills install`

Instala las skills de referencia de Rebase para tu asistente de programación con IA. Es compatible con
Cursor, Claude Code, Windsurf, Gemini CLI y Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulta [Agent Skills](/docs/ai/skills) para ver la lista completa y dónde se escriben los archivos.

### `rebase telemetry`

Uso compartido anónimo de telemetría. **`rebase init` pregunta una vez por proyecto, y la respuesta
por defecto es sí — no se envía nada a menos que respondas:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime la configuración actual, `show` imprime exactamente lo que se enviaría —
esté o no activado el uso compartido, para que puedas revisar el contenido antes de decidir —, y
los otros dos la modifican. Si nunca ejecutaste `init`, nunca se recopiló nada.

## Flujo de trabajo de migración

El flujo de trabajo típico para cambios de esquema:

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

## Próximos pasos

- **[Schema as Code](/docs/architecture/schema-as-code)** — Cómo funciona la generación de esquemas
- **[Quickstart](/docs/getting-started/quickstart)** — Primeros pasos

---
