---
sourceHash: 27723fe81b7fd939
title: Referencia de la CLI
sidebar_label: CLI
description: Comandos de la CLI de Rebase para la inicialización de proyectos, generación de esquemas, migraciones de bases de datos y generación de SDKs.
---

## Descripción general

La CLI de Rebase (`rebase`) gestiona tu proyecto desde el scaffolding hasta el despliegue.

## Instalación

```bash
pnpm add -g @rebasepro/cli
```

O úsala mediante `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Salida procesable por máquinas

`--json` es el modificador, y fuera de la familia de comandos `cloud` es el único: `rebase status`, `rebase resources` y `rebase apps list` generan un único valor JSON en stdout —el resultado o un contenedor `{"error": {"message", "code", "hint", "issues"}}` con un código de salida distinto de cero— en **cada** salida del comando, de modo que quien lo invoque pueda parsear stdout incondicionalmente. Sin este modificador, escriben texto legible por humanos y los fallos se dirigen a stderr. `rebase cloud` utiliza el mismo contenedor y es la única excepción al modificador: también activa JSON de forma automática cuando stdout no es una TTY, o cuando `REBASE_JSON=1` está definido. De este modo, `rebase cloud status | cat` produce JSON mientras que `rebase status | cat` no lo hace; en un script, pasa `--json` de forma explícita en lugar de confiar en cualquiera de estas reglas.

## Comandos

### `rebase init`

Inicializa un nuevo proyecto de Rebase:

```bash
rebase init [directory]
```

Configura la estructura del proyecto con frontend, backend y paquetes compartidos.

| Flag | Qué hace |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Por defecto: `blog` |
| `--headless` | Solo backend — sin panel de administración ni archivos de colecciones. `--template` no tiene efecto, ya que no hay colecciones que inicializar |
| `-y, --yes` | No solicitar confirmación interactiva. **Obligatorio donde no haya una terminal para responder**, como en entornos de CI. Omite git init y la instalación de dependencias —las opciones interactivas por defecto aceptan ambas, así que pasa `--git` / `--install` si las deseas |
| `-i, --install` | Instala dependencias tras la creación de la estructura |
| `-g, --git` | Inicializa un repositorio y realiza el primer commit |
| `--database-url <url>` | Usa una base de datos existente en lugar de la gestionada |
| `--introspect` | Genera colecciones a partir de esa base de datos. Implica `--template blank` y requiere `--install` |
| `--project <slug>` | Vincula la estructura a un proyecto de Rebase Cloud |
| `--setup-key <key>` | Clave de un solo uso que autentica esa vinculación |

### `rebase dev`

Inicia el servidor de desarrollo:

```bash
rebase dev
```

Inicia tanto el frontend como el backend con hot reloading.

Ambos puertos se derivan de la ruta del proyecto, lo que permite ejecutar varios proyectos de Rebase en paralelo. Utiliza las URLs que imprime `rebase dev`. Fija un puerto específico con `rebase dev --port 3001`.

### `rebase build`

Compila el proyecto en un bundle desplegable en `dist-bundle/`:

```bash
rebase build
```

El bundle es el artefacto que se despliega —la imagen del runtime lo carga, por lo que no es necesario compilar una imagen de aplicación propia. Opciones útiles:

| Flag | Efecto |
|------|--------|
| `--out <dir>` | Escribe el bundle en un directorio distinto a `dist-bundle/` |
| `--vendor` | Siempre instala e incluye las dependencias del bundle |
| `--no-vendor` | Nunca incluye dependencias (vendor); el pod las instala en el primer arranque |
| `--skip-type-check` | Omite la comprobación de tipos (más rápido, menos seguro) |
| `--no-static` | Omite la compilación del frontend |

Las dependencias se incluyen mediante vendoring por defecto para que el reinicio de un pod no requiera una espera de instalación de 35 a 55 segundos. Un árbol de dependencias que supere los 200 MB en disco se descarta, ya que el límite de subida es de 100 MB comprimido —consulta el registro de cambios (changelog) para conocer el motivo detallado.

### `rebase start`

Ejecuta el bundle compilado como servidor de producción:

```bash
rebase start
```

Lee `PORT` y el resto de variables en `.env`, a diferencia de `rebase dev`. Puedes apuntarlo a un bundle ubicado en otra ruta mediante `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Muestra las aplicaciones declaradas por este repositorio:

```bash
rebase apps list
```

Un repositorio puede declarar más de una aplicación desplegable —por ejemplo, un backend y un sitio de marketing. Mediante este comando puedes ver sobre qué actuarán `rebase build` y el despliegue.

### `rebase eject`

Toma el control total del proceso del servidor y de su imagen:

```bash
rebase eject
```

Escribe el punto de entrada del backend y un `Dockerfile` en el proyecto y cambia la configuración del backend para que el repositorio compile su propia imagen en lugar de ejecutar el runtime publicado. A partir de ese momento, **las actualizaciones del runtime de la plataforma ya no se aplicarán automáticamente**, y CORS, la configuración de autenticación, el almacenamiento y el apagado pasarán a ser responsabilidad de tu configuración.

Previsualízalo con `rebase eject --dry-run`, que enumera los cambios que se realizarían sin modificar nada. `--force` reemplaza un archivo `backend/src/index.ts` o `env.ts` existente, conservando el archivo actual como `<name>.bak`.

### `rebase schema generate`

Genera el esquema de Drizzle ORM a partir de tus colecciones de TypeScript:

```bash
rebase schema generate
```

Esto lee tus colecciones desde `config/collections/` y genera `backend/src/schema.generated.ts` con las definiciones de tablas de Drizzle, enums y relaciones.

### `rebase db push`

Aplica los cambios de esquema directamente en la base de datos (solo para desarrollo):

```bash
rebase db push
```

:::caution
`db push` modifica la base de datos directamente sin generar archivos de migración. Usa `db generate` + `db migrate` para producción.
:::

### `rebase db generate`

Genera archivos de migración SQL a partir de los cambios en el esquema:

```bash
rebase db generate
```

Crea archivos de migración con marca temporal en `drizzle/` que pueden ser revisados y guardados en el control de versiones.

### `rebase db migrate`

Ejecuta las migraciones pendientes en la base de datos:

```bash
rebase db migrate
```

Aplica todas las migraciones no aplicadas en la base de datos.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` ejecuta `pg_dump`; `restore` ejecuta `pg_restore` y es destructivo, por lo que requiere `--yes`. `--out` acepta una ruta local o una URL de almacenamiento de objetos, y toma por defecto el valor de `$BACKUP_DESTINATION` o `./backups`.

### `rebase db pull`

Copia otra base de datos en la base de datos de desarrollo local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` reemplaza los campos personales durante la importación, lo que permite trabajar localmente con una copia de producción sin transferir datos reales de clientes a un portátil.

`pg_dump` elimina los privilegios, por lo que la copia llegaría con las políticas RLS del origen pero sin ninguna de las concesiones de permisos (grants) asociadas —provocando que cada lectura como `rebase_user` falle con `permission denied`. El comando pull reaprovisiona el rol de la aplicación posteriormente mediante la misma rutina que utilizan el arranque y `rebase db push`, manteniendo revocadas las tablas internas de Rebase como corresponde.

El destino siempre es la base de datos de desarrollo local de este proyecto y no se puede modificar: `--database-url` es rechazado en lugar de aceptado, por lo que no es posible hacer un pull hacia producción. `--from` es la única dirección permitida.

### `rebase db url`

Imprime la cadena de conexión que está utilizando este proyecto, y nada más, para facilitar su uso con tuberías (pipes):

```bash
rebase db url
psql "$(rebase db url)"
```

La base de datos de desarrollo gestionada es el caso que requiere esto: `.env` mantiene `DATABASE_URL` comentada a propósito, y el puerto se deriva de la ruta del proyecto, por lo que nada en el disco la nombra explícitamente. Si has configurado tu propia `DATABASE_URL`, eso es lo que imprimirá —el orden de resolución es el mismo que siguen los demás comandos. Si la base de datos gestionada no se está ejecutando, este comando la inicia.

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

PostgreSQL no copiará ni eliminará una base de datos a la que haya otras conexiones activas, y por lo general ese proceso conectado suele ser tu propio `rebase dev`. `create` y `delete` indican qué proceso mantiene abierta la base de datos; `--force` desconecta esas sesiones en primer lugar.

Cada rama es una copia completa en disco, por lo que es necesario limpiarlas periódicamente. `prune` elimina tres elementos: entradas cuya base de datos fue eliminada fuera de Rebase, bases de datos de ramas cuya entrada nunca fue registrada, y —únicamente con `--older-than`— ramas que superen la antigüedad indicada. Solicitará confirmación antes de eliminar nada, a menos que se pase `--yes`.

`switch` registra la rama en `.rebase/branch.json` y nunca modifica `.env`. Tiene prioridad sobre la variable `DATABASE_URL` en `.env`, pero se subordina a `--database-url` o a una variable `DATABASE_URL` definida en la shell; un flag en la línea de comandos siempre prevalece sobre un cambio de rama previo. Si eliminas la rama en la que te encuentras, volverás a la base de datos principal en lugar de dejar el entorno apuntando a una base de datos inexistente.

:::note[No disponible en la base de datos de desarrollo administrada]
`push`, `generate` y `migrate` planifican su trabajo con Atlas, que requiere una segunda base de datos vacía para comparar —y el PGlite gestionado sirve exactamente una. Ejecutarlos allí se detendrá con un mensaje explicativo. Apunta `DATABASE_URL` a un PostgreSQL real para el flujo de trabajo de migraciones; `rebase dev` ya crea tablas faltantes de forma aditiva en la instancia gestionada.

`branch` se rechaza allí por una razón relacionada. `CREATE DATABASE ... TEMPLATE` en PGlite solo escribe una entrada en el catálogo y no copia nada, por lo que la rama se resolvería apuntando a la base de datos desde la que se clonó —cada escritura que pretendías aislar terminaría en tu base de datos de desarrollo. `rebase dev --docker` te proporciona un servidor real compatible con ramas.
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
      ✓ S3_BUCKET__MEDIA
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Tres archivos determinan a qué puede acceder un backend, y este comando muestra los tres en conjunto:
`rebase.json` indica dónde está tu código y qué ejecuta el servidor,
`config/resources.ts` define qué necesita el proyecto, y el entorno especifica cómo llegar a cada recurso. Todo lo demás —`rebase.resources.json`, el manifiesto del bundle— se genera a partir del archivo intermedio para aquellos lectores que no pueden ejecutar tu código, y nunca debe escribirse a mano.

El símbolo `○` representa el estado que conviene conocer antes de un despliegue y no después: declarado, no configurado. Una `✗` significa que el entorno configura algo de forma *incorrecta*, lo cual bloquea el arranque en lugar de degradar el servicio.

### `rebase resources`

Qué declara necesitar este proyecto: las bases de datos, buckets, topics y colas solicitados por su código de configuración, así como los crons y funciones que definen sus archivos:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` es una opción nueva: el flag utilizado en tareas de CI para fallar si el archivo `rebase.resources.json` ya no coincide con el código de configuración.

Un recurso se declara en el código de configuración —`database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")`— o es un archivo bajo `backend/crons` o `backend/functions`. Nunca se escribe a mano en `rebase.resources.json`, ya que este se genera automáticamente a partir de dichas declaraciones para que un host pueda interpretar lo que necesita un proyecto sin compilarlo. Cada entrada registra quién la utiliza (`collection:events`, `property:posts.cover`, `function:report`).

Un backend también cuenta con una base de datos por defecto y un origen de almacenamiento por defecto que nadie declara explícitamente. Ambos se enumeran aquí marcados como `implicit`, y ninguno se escribe en `rebase.resources.json` —el host los suministra por defecto, por lo que registrarlos solicitaría el aprovisionamiento de algo que nadie ha pedido.

Para ver qué mantiene la plataforma para un proyecto en comparación con lo que declara su código, y para eliminar una base de datos aprovisionada que el código ya no menciona, consulta `rebase cloud resources` más abajo.

### `rebase cloud`

Todo lo relacionado con Rebase Cloud, que se encuentra en beta privada. Consulta la [guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué incluye y qué no forma parte de la beta.

Cada grupo de comandos admite `--help`, y `--help` nunca ejecuta la acción. La mayoría de los comandos actúan sobre el proyecto vinculado en `.rebase/cloud.json`; `--project <id>` permite operar sobre uno sin vincularlo previamente.

Tres opciones aplican de manera global: `--json` para salida estructurada (también por defecto al usar pipes o con `REBASE_JSON=1`), `--url <origin>` para apuntar a un plano de control específico (o mediante `REBASE_CLOUD_URL`), y `--project, -p <id>`.

#### Autenticación

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

Ejecutar `deploy` sin un nombre de aplicación despliega el backend.

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

`db connect` abre un puerto local conectado directamente a la base de datos gestionada —la cual no dispone de endpoint público— y lo mantiene activo hasta presionar Ctrl-C. `--reveal` muestra la contraseña.

#### Recursos

Lo que la plataforma mantiene para el proyecto frente a lo que su código declara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando su declaración desaparece del código —eso significaría borrar datos con un simple push. Se mantiene, vincula y factura hasta que alguien la elimine expresamente por su nombre mediante un prune.

#### Cómputo

Lo que reserva el proyecto y su coste asociado.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` acepta los parámetros `--cpu`, `--memory`, `--replicas`, `--spot`, `--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`, `--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`. No existen planes estructurados en niveles: todo se tarifica por recurso consumido. Consulta [Rebase Cloud](/docs/deployment/cloud/).

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

Crea tipos de TypeScript y un cliente con seguridad de tipos para todas tus colecciones.

### `rebase doctor`

```bash
rebase doctor
```

El comando a ejecutar cuando algo falla y aún no sabes qué es. Genera diagnósticos y nunca modifica nada, por lo que es seguro ejecutarlo contra cualquier base de datos accesible.

**Sin base de datos.** Estas comprobaciones se ejecutan primero, ya que los fallos que impiden por completo el funcionamiento de un proyecto ocurren antes de poder comparar una tabla:

| Comprobación | Por qué |
| --- | --- |
| Versión de Node | Compara contra el rango declarado por la CLI. Una versión demasiado antigua no se reporta como "Node no compatible", sino como un error de sintaxis dentro de una dependencia. |
| Gestores de paquetes | Dos lockfiles en un mismo proyecto. Ejecutar `npm install` en un workspace de pnpm reestructura `node_modules` de una forma incompatible con pnpm, generando errores de `Cannot find module` más adelante. |
| Slugs duplicados | El registro conserva la última colección registrada, por lo que la otra no se reporta como faltante: se sirve como ganadora, bajo su propio nombre. |
| Consistencia de `.env` | Un `JWT_SECRET` inferior a 32 caracteres (que impide el arranque en producción), y `NODE_ENV=production` sin `CORS_ORIGINS` ni `FRONTEND_URL`. Los valores nunca se muestran en pantalla. |
| Desfase de versiones de `@rebasepro/*` | El mismo paquete anclado a diferentes versiones en los archivos `package.json` del proyecto. Tener dos copias rompe la evaluación de `instanceof` entre ellas, provocando que un type guard falle al rechazar su propio tipo. |
| Cadenas de conexión | Un carácter `=` no codificado en los parámetros de la URL, el cual las herramientas nativas de PostgreSQL rechazan —ocasionando que las copias de seguridad y `psql` fallen mientras la aplicación sigue funcionando. |
| Funciones personalizadas | Qué requiere cada función de su host y cuáles no podrían ejecutarse en un edge runtime. |

**Contra la base de datos**, cuando `DATABASE_URL` está configurada:

| Comprobación | Por qué |
| --- | --- |
| Colecciones → esquema generado | Comprueba si `schema.generated.ts` está desactualizado. |
| Colecciones → base de datos | Tablas, columnas, enums, foreign keys y junctions faltantes. |
| Extensiones requeridas | Una propiedad `{ type: "vector" }` requiere pgvector, que Rebase instala únicamente si el proyecto lo ha declarado. |
| Sello de esquema (Schema stamp) | Verifica si esta base de datos fue aprovisionada a partir de estas colecciones. Es un hash que puede indicar si difieren, pero nunca cuál de las dos es más reciente. |
| Colecciones → tipos del SDK | Comprueba si el SDK tipado generado está desactualizado. |
| Políticas RLS | Verifica si las políticas de la base de datos coinciden con las `securityRules` declaradas y si alguna política menciona un rol inaccesible para este servidor. |

Si no es posible acceder a la base de datos, sus fases correspondientes se reportan como omitidas junto con el motivo y el resto de las comprobaciones se ejecutan con normalidad —consulta [Resolución de problemas](/docs/troubleshooting/).

Finaliza con un código de salida distinto de cero cuando una comprobación detecta un error o cuando una fase no pudo ejecutarse debido a que la base de datos especificada rechaza las conexiones. Una fase omitida porque no se definió `DATABASE_URL` no se considera un fallo.

`rebase doctor --policies` ejecuta únicamente las comprobaciones de RLS —sin diffs de esquemas ni tipos de SDK— y falla de forma estricta (fail-closed), lo que la convierte en la opción adecuada para actuar como control en pipelines de CI sobre bases de datos desplegadas.

### `rebase auth`

Comandos para la gestión de la autenticación:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestiona API keys de servicio con ámbito limitado —las credenciales utilizadas por un agente, script u otro servicio, a diferencia de la sesión de un usuario final:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` recibe un array JSON de objetos `{ collection, operations }`, o bien se puede usar `--full-access` para conceder lectura/escritura/borrado en todas las colecciones y funciones. `--expires` admite `7d`, `30d`, `90d`, `1y` o una fecha ISO, y `--rate-limit` define el límite de peticiones por ventana de 15 minutos. La clave se muestra una sola vez, en el momento de su creación.

Las claves cuentan con un doble control de acceso: se aplican tanto los permisos propios de la clave como la seguridad a nivel de fila (RLS) de la identidad que representa, por lo que una clave nunca puede leer más información de la que dicha identidad tiene autorizada.

### `rebase skills install`

Instala los reference skills de Rebase para tu asistente de programación por IA. Compatible con Cursor, Claude Code, Windsurf, Gemini CLI y Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulta [Agent Skills](/docs/ai/skills) para ver la lista completa y las rutas donde se guardan los archivos.

### `rebase telemetry`

Envío anónimo de datos de uso. **`rebase init` lo solicita una única vez por proyecto, y la opción por defecto es afirmativa —no se envía nada a menos que se responda a la solicitud:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` muestra la configuración actual, `show` imprime exactamente qué datos se enviarían —esté o no activado el envío, permitiendo revisar el contenido antes de decidir— y los otros dos modifican la preferencia. Si nunca ejecutaste `init`, no se ha recopilado ninguna información.

## Flujo de trabajo de migraciones

El flujo habitual para aplicar cambios en el esquema:

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
- **[Inicio rápido](/docs/getting-started/quickstart)** — Comienza ahora

---
