---
sourceHash: a3fccf5118b08dd0
title: Referencia de la CLI
sidebar_label: CLI
description: Comandos de la CLI de Rebase para inicializar proyectos, generar esquemas, migrar bases de datos y generar el SDK.
---

## Resumen

La CLI de Rebase (`rebase`) gestiona tu proyecto desde el andamiaje hasta el despliegue.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

O úsala mediante `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Salida legible por máquinas

<span class="since-badge" data-since="0.18">Since 0.18</span>

`--json` es el interruptor, y fuera de la familia `cloud` es el único:
`rebase status`, `rebase resources` y `rebase apps list` ponen entonces un único
valor JSON en stdout — el resultado, o un sobre
`{"error": {"message", "code", "hint", "issues"}}` con salida distinta de cero —
en **cada** salida del comando, de modo que quien lo invoca puede parsear stdout
sin condiciones. Sin él escriben texto humano y los fallos van a stderr.
`rebase cloud` usa el mismo sobre y es la única excepción al interruptor: también
activa el JSON por su cuenta cuando stdout no es un TTY, o cuando
`REBASE_JSON=1` está definido. Así que `rebase cloud status | cat` es JSON
mientras que `rebase status | cat` no lo es — en un script, pasa `--json`
explícitamente en lugar de confiar en cualquiera de las dos reglas.

## Comandos

### `rebase init`

Inicializa un nuevo proyecto Rebase:

```bash
rebase init [directory]
```

Prepara la estructura del proyecto con los paquetes de frontend, backend y compartidos.

| Flag | Qué hace |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Por defecto `blog` |
| `--headless` | Solo backend — sin panel de administración ni archivos de colecciones. `--template` no tiene efecto, porque no hay colecciones que sembrar |
| `-y, --yes` | Nunca pregunta. **Obligatorio allí donde no hay terminal que responda**, como en CI. Omite `git init` y la instalación de dependencias — los valores interactivos por defecto dicen que sí a ambos, así que pasa `--git` / `--install` si los quieres |
| `-i, --install` | Instalar las dependencias tras el andamiaje |
| `-g, --git` | Inicializar un repositorio y hacer el primer commit |
| `--database-url <url>` | Usar una base de datos existente en lugar de la gestionada |
| `--introspect` | Generar colecciones a partir de esa base de datos. Implica `--template blank` y necesita `--install` |
| `--project <slug>` | Vincular el andamiaje a un proyecto de Rebase Cloud |
| `--setup-key <key>` | La clave de un solo uso que autoriza ese vínculo |

### `rebase dev`

Arranca el servidor de desarrollo:

```bash
rebase dev
```

Arranca a la vez el frontend y el backend con recarga en caliente.

Ambos puertos se derivan de la ruta del proyecto, de modo que varios proyectos
Rebase pueden convivir a la vez. Usa las URLs que imprime `rebase dev`. Fija uno
con `rebase dev --port 3001`.

### `rebase build`

Compila el proyecto en un bundle desplegable en `dist-bundle/`:

```bash
rebase build
```

El bundle es el artefacto que despliegas — la imagen del runtime lo carga, así
que no hay ninguna imagen de aplicación que debas construir tú. Flags útiles:

| Flag | Efecto |
|------|--------|
| `--out <dir>` | Escribir el bundle en otro sitio distinto de `dist-bundle/` |
| `--vendor` | Instalar y enviar siempre las dependencias del bundle |
| `--no-vendor` | No incluirlas nunca; el pod instala en el primer arranque |
| `--skip-type-check` | Omitir la comprobación de tipos (más rápido, menos seguro) |
| `--no-static` | Omitir la compilación del frontend |

Las dependencias se incluyen por defecto para que un reinicio del pod no pague
entre 35 y 55 segundos de instalación. Un árbol que supera los 200 MB en disco se
descarta en su lugar, porque el límite de subida es de 100 MB comprimidos — el
razonamiento está en el changelog.

### `rebase start`

Ejecuta el bundle compilado como servidor de producción:

```bash
rebase start
```

Lee `PORT` y el resto de `.env`, a diferencia de `rebase dev`. Apúntalo a un
bundle en otro sitio con `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Muestra las apps que declara este repositorio:

```bash
rebase apps list
```

Un repositorio puede declarar más de una app desplegable — un backend y un sitio
de marketing, por ejemplo. Así es como ves sobre qué actuarán `rebase build` y el
despliegue.

### `rebase eject`

Toma el control del proceso del servidor y de su imagen:

```bash
rebase eject
```

Escribe el punto de entrada del backend y un `Dockerfile` en el proyecto y
conmuta su backend, de modo que el repositorio construya su propia imagen en
lugar de ejecutar el runtime publicado. A partir de ahí **las actualizaciones del
runtime de la plataforma ya no le llegan**, y CORS, el cableado de autenticación,
el almacenamiento y el apagado pasan a ser cosa tuya.

Previsualízalo con `rebase eject --dry-run`, que enumera lo que cambiaría y no
cambia nada. `--force` reemplaza un `backend/src/index.ts` o `env.ts` existente,
conservando el archivo actual como `<name>.bak`.

### `rebase schema generate`

Genera el esquema de Drizzle ORM a partir de tus colecciones de TypeScript:

```bash
rebase schema generate
```

Esto lee tus colecciones de `config/collections/` y genera `backend/src/schema.generated.ts` con las definiciones de tablas, enums y relaciones de Drizzle.

### `rebase db push`

Envía los cambios de esquema directamente a la base de datos (solo desarrollo):

```bash
rebase db push
```

:::caution
`db push` modifica la base de datos directamente, sin archivos de migración. Usa `db generate` + `db migrate` para producción.
:::

### `rebase db generate`

Genera archivos de migración SQL a partir de los cambios de esquema:

```bash
rebase db generate
```

Crea archivos de migración con marca de tiempo en `drizzle/`, que se pueden revisar y confirmar en el repositorio.

### `rebase db migrate`

Ejecuta las migraciones pendientes de la base de datos:

```bash
rebase db migrate
```

Aplica a la base de datos todas las migraciones no aplicadas.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` ejecuta `pg_dump`; `restore` ejecuta `pg_restore` y es destructivo, así
que exige `--yes`. `--out` acepta una ruta local o una URL de almacenamiento de
objetos, y por defecto usa `$BACKUP_DESTINATION` o `./backups`.

### `rebase db pull`

Copia otra base de datos en la de desarrollo local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` reemplaza los campos personales en el camino de entrada, de modo
que una copia de producción se puede trabajar en local sin llevar datos reales de
clientes a un portátil.

`pg_dump` elimina los privilegios, así que la copia llegaría con las políticas
RLS del origen y sin ninguno de los grants que las sostienen — cada lectura como
`rebase_user` fallando con `permission denied`. El pull vuelve a aprovisionar el
rol de la aplicación después, con la misma rutina que usan el arranque y
`rebase db push`, de modo que las tablas internas de Rebase siguen revocadas como
corresponde.

El destino es siempre la base de datos de desarrollo local de este proyecto y no
se puede elegir: `--database-url` se rechaza en lugar de aceptarse, así que no
hay manera de escribir «traer a producción». `--from` es la única dirección.

### `rebase db url`

Imprime la cadena de conexión que está usando este proyecto, y nada más, para que
se pueda encauzar por tuberías:

```bash
rebase db url
psql "$(rebase db url)"
```

La base de datos de desarrollo gestionada es el caso que necesita esto: `.env`
deja `DATABASE_URL` comentada a propósito, y el puerto se deriva de la ruta del
proyecto, así que nada en disco lo nombra. Cuando has definido tu propia
`DATABASE_URL`, es esa la que se imprime — el orden de resolución es el mismo que
sigue cualquier otro comando. Arranca la base de datos gestionada si aún no está
en marcha.

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

PostgreSQL no copia ni elimina una base de datos a la que haya algo más
conectado, y ese «algo más» suele ser tu propio `rebase dev`. `create` y `delete`
nombran lo que mantiene abierta la base de datos; `--force` desconecta antes esas
sesiones.

<span class="since-badge" data-since="0.18">Since 0.18</span> Cada rama es una copia completa en disco, así que hay que ir limpiándolas.
`prune` elimina tres cosas: una entrada cuya base de datos se borró fuera de
Rebase, una base de datos de rama cuya entrada nunca se escribió y — solo con
`--older-than` — ramas más antiguas que la edad que indiques. Pregunta antes de
eliminar nada, salvo que pases `--yes`.

<span class="since-badge" data-since="0.18">Since 0.18</span> `switch` registra la rama en `.rebase/branch.json` y nunca edita `.env`. Tiene
prioridad sobre `DATABASE_URL` en `.env` y pierde frente a `--database-url` o a
una `DATABASE_URL` del shell, de modo que un flag en la línea de comandos siempre
manda sobre un switch hecho antes. Borrar la rama en la que estás te devuelve a
la base de datos principal, en lugar de dejar el checkout apuntando a una base de
datos que ya no existe.

:::note[No en la base de datos de desarrollo gestionada]
`push`, `generate` y `migrate` planifican su trabajo con Atlas, que necesita una
segunda base de datos vacía con la que comparar — y el PGlite gestionado sirve
exactamente una. Ejecutarlos ahí se detiene con un mensaje que lo explica. Apunta
`DATABASE_URL` a un PostgreSQL real para el flujo de migraciones; `rebase dev` ya
crea de forma aditiva las tablas que faltan en la gestionada.

`branch` se rechaza ahí por una razón emparentada.
`CREATE DATABASE ... TEMPLATE` contra PGlite escribe una entrada de catálogo y no
copia nada, así que la rama resolvería a la base de datos de la que se clonó —
cada escritura que pretendías aislar acabaría en tu base de datos de desarrollo.
`rebase dev --docker` te da un servidor real contra el que las ramas sí
funcionan.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

<span class="since-badge" data-since="0.18">Since 0.18</span>

Todo lo que este proyecto declara, y si el entorno lo enlaza de verdad:

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

Tres archivos deciden qué puede alcanzar un backend, y esto imprime los tres
juntos: `rebase.json` dice dónde está tu código y quién ejecuta el servidor,
`config/resources.ts` dice qué necesita el proyecto, y el entorno dice cómo
alcanzar cada cosa. Todo lo demás — `rebase.resources.json`, el manifiesto del
bundle — se genera a partir del de en medio para lectores que no pueden ejecutar
tu código, y nunca lo escribes tú.

Un `○` es el estado que conviene conocer antes de un despliegue y no después:
declarado, no configurado. Un `✗` significa que el entorno define algo *mal*, lo
que rechaza el arranque en lugar de degradarse.

### `rebase resources`

Lo que este proyecto declara necesitar — las bases de datos, buckets, topics y
colas que pide su código de configuración, y los crons y funciones que definen
sus archivos:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` es nuevo <span class="since-badge" data-since="0.18">Since 0.18</span> — el flag que un job de CI usa para fallar ante un `rebase.resources.json` que ya
no coincide con el código de configuración.

Un recurso se declara en el código de configuración — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — o es un archivo
bajo `backend/crons` o `backend/functions`, y nunca se escribe a mano en
`rebase.resources.json`, que se genera a partir de esas declaraciones para que un
host pueda leer qué necesita un proyecto sin compilarlo. Cada entrada registra
quién lo usa (`collection:events`, `property:posts.cover`, `function:report`).

Un backend tiene además una base de datos por defecto y una fuente de
almacenamiento por defecto que nadie declara. Ambas se listan aquí, marcadas como
`implicit`, y ninguna se escribe en `rebase.resources.json` — las suministra el
host, así que registrarlas sería pedir que se aprovisione algo que nadie ha
pedido.

Para ver qué guarda la plataforma para un proyecto frente a lo que declara su
código, y para eliminar una base de datos aprovisionada que el código ya no
nombra, consulta `rebase cloud resources` más abajo.

### `rebase cloud`

Todo lo relativo a Rebase Cloud, que está en beta privada. Consulta la
[guía de Rebase Cloud](/docs/deployment/cloud/) para saber qué es y qué no incluye
la beta.

Cada grupo responde a `--help`, y `--help` nunca ejecuta el comando. La mayoría
de los comandos actúan sobre el proyecto vinculado en `.rebase/cloud.json`;
`--project <id>` opera sobre uno sin vincularlo.

Tres opciones se aplican en todas partes: `--json` para salida legible por
máquinas (también el valor por defecto al encauzar por tubería, o con
`REBASE_JSON=1`), `--url <origin>` para apuntar a un plano de control concreto (o
`REBASE_CLOUD_URL`) y `--project, -p <id>`.

#### Autenticación

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # show the current session
```

#### Vínculo del proyecto

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

#### Desplegar y observar

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

`deploy` sin nombre de app despliega el backend.

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

Lo que la plataforma guarda para el proyecto, frente a lo que declara su código.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un despliegue nunca elimina una base de datos aprovisionada cuando desaparece su
declaración — eso serían datos borrados por un push. La conserva, la enlaza y la
factura hasta que alguien la pode por su nombre.

#### Compute

Lo que el proyecto reserva, y lo que eso cuesta.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` acepta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` y `--no-autoscale`. No
hay planes por niveles: todo se cobra por recurso. Consulta
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

Genera un SDK de cliente tipado a partir de tus definiciones de colecciones:

```bash
rebase generate-sdk
```

Crea tipos de TypeScript y un cliente con seguridad de tipos para todas tus colecciones.

### `rebase doctor`

```bash
rebase doctor
```

El comando que ejecutas cuando algo va mal y aún no sabes qué. Informa y no
cambia nada nunca, así que es seguro contra cualquier base de datos a la que
puedas llegar.

**Sin base de datos.** Estas se ejecutan primero, porque todo lo que impide que un
proyecto funcione siquiera ocurre antes de que se pueda comparar una tabla:

| Comprobación | Por qué |
| --- | --- |
| Versión de Node | Frente al rango que declara la CLI. Una versión demasiado antigua no se reporta como «Node no compatible» — es un error de sintaxis dentro de una dependencia. |
| Gestores de paquetes | Dos lockfiles en un mismo proyecto. `npm install` en un workspace de pnpm reescribe `node_modules` con un layout con el que pnpm no está de acuerdo, y el síntoma es un `Cannot find module` horas después. |
| Slugs duplicados | El registro se queda con la última colección registrada, así que la otra no se reporta como ausente — se sirve como ganadora, bajo su propio nombre. |
| Sensatez de `.env` | Un `JWT_SECRET` de menos de 32 caracteres (con el que producción se niega a arrancar), y `NODE_ENV=production` sin `CORS_ORIGINS` ni `FRONTEND_URL`. Los valores nunca se imprimen. |
| Divergencia de versiones de `@rebasepro/*` | El mismo paquete fijado a versiones distintas entre los `package.json` del proyecto. Dos copias rompen `instanceof` entre ellas, lo que falla como un type guard que rechaza su propio tipo. |
| Cadenas de conexión | Un `=` sin codificar en un parámetro de URL, que las propias herramientas de PostgreSQL se niegan a parsear — así que los backups y `psql` se rompen mientras la aplicación sigue funcionando. |
| Funciones personalizadas | Qué necesita cada función de su host, y cuáles de ellas no se ejecutarían en un runtime de edge. |

**Contra la base de datos**, cuando `DATABASE_URL` está definida:

| Comprobación | Por qué |
| --- | --- |
| Colecciones → esquema generado | Si `schema.generated.ts` está desactualizado. |
| Colecciones → base de datos | Tablas, columnas, enums, claves foráneas y junctions que faltan. |
| Extensiones requeridas | Una propiedad `{ type: "vector" }` necesita pgvector, que Rebase instala solo donde un proyecto lo declaró. |
| Sello del esquema | Si esta base de datos se aprovisionó a partir de estas colecciones. Es un hash, así que puede decir que ambos discrepan y nunca cuál va por delante. |
| Colecciones → tipos del SDK | Si el SDK tipado generado está desactualizado. |
| Políticas RLS | Si las políticas de la base de datos coinciden con las `securityRules` que declaraste, y si alguna política nombra un rol que este servidor no puede usar. |

Si la base de datos es inalcanzable, sus fases se reportan como omitidas con el
motivo y el resto sigue ejecutándose — consulta
[Resolución de problemas](/docs/troubleshooting/).

Termina con código distinto de cero cuando una comprobación encuentra un error, o
cuando una fase no ha podido ejecutarse porque la base de datos que se le dio
rechaza las conexiones. Una fase omitida porque no definiste `DATABASE_URL` no es
un fallo.

`rebase doctor --policies` ejecuta solo las comprobaciones de RLS — sin diff de
esquema, sin tipos del SDK — y falla en cerrado, lo que la convierte en la forma
que hay que usar como puerta de CI contra una base de datos desplegada.

### `rebase auth`

Comandos de gestión de la autenticación:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestiona claves de API de servicio con ámbitos — la credencial que usa un agente,
un script u otro servicio, a diferencia de la sesión de un usuario final:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` acepta un array JSON de objetos `{ collection, operations }`, o
usa `--full-access` para lectura/escritura/borrado en todas las colecciones y
funciones. `--expires` acepta `7d`, `30d`, `90d`, `1y` o una fecha ISO, y
`--rate-limit` fija las peticiones por ventana de 15 minutos. Una clave se
muestra una sola vez, al crearla.

Las claves tienen doble puerta: se aplican tanto los permisos de la propia clave
como la seguridad a nivel de fila de la identidad con la que actúa, de modo que
una clave nunca puede leer más de lo que puede esa identidad.

### `rebase skills install`

Instala las skills de referencia de Rebase para tu asistente de programación con
IA. Admite Cursor, Claude Code, Windsurf, Gemini CLI y Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulta [Agent Skills](/docs/ai/skills) para ver la lista completa y dónde se escriben los archivos.

### `rebase telemetry`

Envío anónimo de uso. **Es opcional y está apagado salvo que lo hayas activado:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime el ajuste actual, `show` imprime exactamente lo que se enviaría,
y los otros dos lo cambian. `rebase init` lo pregunta una vez; si nunca
ejecutaste `init`, nunca se recogió nada.

## Flujo de trabajo de migración

El flujo de trabajo típico para los cambios de esquema:

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

## Próximos Pasos

- **[Esquema como código](/docs/architecture/schema-as-code)** — Cómo funciona la generación de esquemas
- **[Inicio rápido](/docs/getting-started/quickstart)** — Empieza aquí
