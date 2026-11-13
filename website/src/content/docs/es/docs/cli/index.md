---
sourceHash: 4281e973dcdf0b86
title: Referencia de la CLI
sidebar_label: CLI
description: Comandos de la CLI de Rebase para inicialización de proyectos, generación de esquemas, migraciones de bases de datos y generación de SDKs.
---

## Descripción general

La CLI de Rebase (`rebase`) gestiona tu proyecto desde el scaffolding hasta el despliegue.

## Instalación

```bash
pnpm add -g @rebasepro/cli
```

O ejecuta cualquier comando sin instalarlo: `pnpm dlx @rebasepro/cli <command>`.

## Salida legible por máquina

`--json` es el modificador, y fuera de la familia `cloud` es el único: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` y `rebase verify` colocan entonces un único valor JSON en stdout — el resultado, o una estructura envoltorio `{"error": {"message", "code", "hint", "issues"}}` con un código de salida distinto de cero — en **cada** salida del comando, de modo que quien lo invoque pueda analizar stdout incondicionalmente. Sin él, escriben texto para humanos y los fallos van a stderr. `rebase cloud` utiliza el mismo envoltorio y es la única excepción al modificador: también activa JSON automáticamente cuando stdout no es una TTY, o cuando `REBASE_JSON=1` está configurado. Por lo tanto, `rebase cloud status | cat` es JSON mientras que `rebase status | cat` no lo es — en un script, pasa `--json` explícitamente en lugar de confiar en cualquiera de las dos reglas.

## Comandos

### `rebase init`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Inicializa un nuevo proyecto de Rebase:

```bash
rebase init [directory]
```

Configura un `backend/` (las tablas en `backend/schema/`) y un `frontend/` (el panel de administración, con las personalizaciones de sus tablas en `frontend/src/cms/`); `--headless` genera la estructura únicamente para `backend/`, sin `backend/schema/`. [Estructura del proyecto](/docs/getting-started/project-structure/) muestra ambos árboles.

| Flag | Qué hace |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Por defecto `blog` |
| `--headless` | Solo backend — sin panel de administración y sin `backend/schema/`: el servidor expone las propias tablas de la base de datos. `--template` no tiene efecto, porque no hay tablas que poblar |
| `-y, --yes` | Nunca preguntar. **Requerido siempre que no haya un terminal para responder**, como en CI. Omite git init y la instalación de dependencias — los valores interactivos por defecto responden sí a ambos, así que pasa `--git` / `--install` si los deseas |
| `-i, --install` | Instala las dependencias tras el scaffolding. Sin él, init pregunta (por defecto sí); bajo `--yes`, no se instala nada |
| `--no-install` | No instalar nada y no preguntar |
| `-g, --git` | Inicializa un repositorio y realiza el primer commit. Sin él, init pregunta (por defecto sí); bajo `--yes`, no crea repositorio |
| `--database-url <url>` | Usa una base de datos existente en lugar de la gestionada. Debe ser una URL `postgres://` o `postgresql://`: cualquier otra cosa se rechaza antes de escribir ningún archivo, y el prompt interactivo vuelve a preguntar |
| `--introspect` | Genera `backend/schema` a partir de esa base de datos. Implica `--template blank` y requiere `--install` |
| `--project <slug>` | Vincula el scaffold a un proyecto de Rebase Cloud |
| `--setup-key <key>` | La clave de un solo uso que autentica dicha vinculación |
| `-a, --agent <name>` | Configura agentes de programación por IA: las [habilidades](/docs/ai/skills) y el [servidor MCP](/docs/ai/mcp). Repetible o separado por comas — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Sin él, `init` pregunta y preselecciona los agentes instalados en la máquina; bajo `--yes`, ninguno |

### `rebase dev`

Inicia el servidor de desarrollo:

```bash
rebase dev
```

Inicia tanto el frontend como el backend con recarga en caliente (hot reloading), y regenera el esquema de Drizzle y los tipos del SDK (`generated/sdk/`) al inicio y en cada guardado bajo `backend/schema/`.

Ambos puertos se derivan de la ruta del proyecto para que varios proyectos de Rebase puedan ejecutarse simultáneamente. Usa las URLs que imprime `rebase dev`. Fija uno con `rebase dev --port 3001`.

Una edición en `.env` reinicia el backend, que vuelve a leer el archivo, al igual que hace el panel de administración. Lo que `rebase dev` establece por sí mismo se conserva hasta que lo reinicies: `PORT`, y `DATABASE_URL` cuando está en la base de datos gestionada o en Docker.

Con `--database-url`, `rebase dev` comprueba primero que algo responda en ese host y puerto. Si nada responde, lo indica, mencionando la opción, y sale con código `1` sin haber iniciado nada; también deja intactos los nombres de base de datos en `.env`, sin iniciar nunca su contenedor compose.

### `rebase build`

Compila el proyecto en un bundle desplegable en `dist-bundle/`:

```bash
rebase build
```

El bundle es el artefacto que despliegas — la imagen del runtime lo carga, por lo que no hay ninguna imagen de aplicación que debas compilar tú mismo. Opciones útiles:

| Flag | Efecto |
|------|--------|
| `--output <dir>` (or `--out`) | Escribe el bundle en un lugar distinto de `dist-bundle/` (una aplicación a la vez) |
| `--vendor` | Siempre instala e incluye las dependencias del bundle |
| `--no-vendor` | Nunca incluye dependencias (vendor); el pod las instala en cada inicio |
| `--skip-type-check` | Omite la comprobación de tipos (más rápido, menos seguro) |
| `--no-static` | No integra el frontend dentro del bundle del backend (cada aplicación estática sigue obteniendo su propio bundle) |
| `--skip-static-build` | Integra el frontend tal como ya está compilado, sin ejecutar su comando de compilación |

<span class="since-badge" data-since="0.31">Desde 0.31</span> Cualquier frontend — cada aplicación estática de `rebase.json` con una configuración de Vite — cuya configuración no use `rebaseBackendGuard()` (de `@rebasepro/app/vitePlugin`) es rechazado: es lo que mantiene el código del servidor fuera del bundle del navegador y evita que Vite incluya en línea un archivo del backend como una URL `data:` (falla la compilación, identificándose a sí mismo, cuando otro plugin reemplaza su `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` se traslada al bundle como `entry.uiConfig`, la presentación del espacio de trabajo que sirve un backend desplegado.

Las dependencias se incluyen (vendored) por defecto para que una nueva instancia no tenga que pagar un tiempo de instalación de 35–55 segundos. En su lugar, un árbol que supere los 2 GB en disco se descarta, ya que el límite de subida es de 1 GB comprimido.

Cada aplicación estática que incluye el bundle obtiene una copia en brotli (`.br`) y gzip (`.gz`) junto a cada activo con hash de contenido de 1 KB o más — los archivos que un navegador almacena en caché durante un año. El runtime envía el que el navegador acepte, por lo que esos archivos no consumen trabajo de compresión por solicitud, incluida la primera visita tras un despliegue, y los navegadores que aceptan brotli lo reciben (alrededor de un 11% más pequeño que gzip en el JavaScript del admin). La salida de compilación propia de tu frontend se deja como estaba; solo cambia la copia en el bundle. En la aplicación de ejemplo, esto añade menos de un segundo a la compilación y unos 2.4 MB al bundle.

### `rebase upgrade`

Actualiza cada paquete `@rebasepro/*` fijado en el proyecto a una única versión y luego instala con el gestor de paquetes indicado por su lockfile. `rebase upgrade` toma la última versión (`latest`); `--to 0.21.0` una versión exacta, sin consultar el registro; `--to canary` un dist-tag. Cada versión fijada en `dependencies`, `devDependencies` y `optionalDependencies`, en cada `package.json` del proyecto, mantiene su `^` o `~`, y nada más en el archivo cambia. Las `peerDependencies` y las especificaciones `workspace:`, `link:`, `file:`, git y etiquetas se listan y se dejan intactas. Las anulaciones (overrides) en `pnpm-workspace.yaml` y `package.json` también se actualizan, pero un override con `link:` o `file:` prevalece sobre cualquier versión fijada: se notifica, y `--drop-local-overrides` lo elimina. `--dry-run` no escribe nada, `--no-install` omite la instalación y `--json` imprime un único documento.

Un proyecto en una versión preliminar (prerelease), como una canary, permanece en su canal a menos que `latest` sea más reciente. Un dist-tag que movería una versión fijada hacia atrás se rechaza (`downgrade_refused` con `--json`) a menos que pases `--allow-downgrade`; un `--to` exacto se aplica y se marca como una degradación (downgrade). Un `--dry-run` de una actualización que la ejecución real rechazaría muestra lo que se movería y sale con código 0, y bajo `--json` su documento incluye el rechazo como `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Ejecuta el bundle compilado de la misma forma en que lo ejecuta un despliegue:

```bash
rebase start
```

Lee `PORT` y el resto de `.env`, a diferencia de `rebase dev`, en el `NODE_ENV` que estos definen. Un `.env` generado dice `development`, por lo que la primera cuenta en registrarse aún se convierte en administrador, y `rebase start` lo indica al principio; define `NODE_ENV=production` para un servidor de producción. `rebase start --bundle ./dist-bundle` ejecuta un bundle en otra ubicación.

`rebase start` no inicia ninguna base de datos, y el `.env` del scaffold no tiene `DATABASE_URL`, por lo que una ejecución local sobre la base de datos que usa `rebase dev` es `DATABASE_URL="$(rebase db url)" rebase start`. Sin ella, imprime esa línea antes de arrancar.

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

Escribe el punto de entrada del backend y un `Dockerfile` en el proyecto y cambia la configuración del backend, de modo que el repositorio compila su propia imagen en lugar de ejecutar el runtime publicado. A partir de entonces, **las actualizaciones del runtime de la plataforma ya no le afectarán**, y la configuración de CORS, la autenticación, el almacenamiento y el apagado pasarán a ser tu responsabilidad.

Previsualízalo con `rebase eject --dry-run`, que enumera lo que cambiaría sin modificar nada. `--force` reemplaza un `backend/src/index.ts` o `env.ts` existente, conservando el archivo actual como `<name>.bak`.

El servidor desacoplado (ejected) conserva las subidas locales en `uploads/` del proyecto, ejecutado desde el código fuente o compilado, tal como hace `rebase dev`. Se ejecuta en `backend/`, por lo que un `STORAGE_PATH` relativo allí se lee desde `backend/`.

### `rebase schema generate` / `rebase schema stale`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Cada comando que lee el esquema acepta `--schema-dir <dir>` para un proyecto que lo mantiene en otro lugar; `--collections` fue eliminado. `rebase dev` mantiene el archivo actualizado, por lo que `stale` es la comprobación ideal para una compilación o CI. Consulta [Generación de esquemas](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # apply the tables to the database (development)
rebase db generate             # write a SQL migration file
rebase db migrate              # apply the pending migrations
rebase db url                  # print the connection string this project uses
rebase db pull --from <url>    # copy another database into the local one
rebase db backup               # pg_dump; db backups list and db restore beside it
rebase db branch create <name> # a copy to work on; switch, list and prune it too
rebase db stop                 # stop the managed development database
rebase db reset                # delete it and start over
rebase db request-role migrate --to <role> # move requests to another Postgres role
rebase db provision --print    # the SQL that sets up the request role, for a DBA
```

Cada uno se encuentra en [Comandos de base de datos](/docs/cli/database/), junto con el orden en el que un comando selecciona su base de datos; `push`, `generate` y `migrate` se tratan en profundidad en [Generación de esquemas](/docs/cli/schema/).

### `rebase console`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un REPL de Node con los datos del proyecto abiertos, o un fragmento ejecutado con `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) y `collections` (las tablas del proyecto, cargadas desde `backend/schema`) están en el ámbito (in scope), y el `await` en el nivel superior funciona. La base de datos se resuelve de la misma forma en que la resuelve `rebase db push`, y abrirla no cambia nada en ella. Con `-e`, el resultado esperado con await se imprime como JSON en stdout y cualquier excepción (throw) sale con código `1`. Opciones: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulta [Scripts y la consola](/docs/backend/scripts/).

### `rebase migrate`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Migraciones unidireccionales desde una estructura que esta versión ya no lee: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` y `frontend/src/cms`) y `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` en tu propio código). Sus opciones, lo que escriben y la sección "Revisar antes de desplegar" se encuentran en [Generación de esquemas](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` no toma ningún nombre: infiere cada aplicación a partir del proyecto y escribe todo el `rebase.json`, y se niega a reemplazar uno existente a menos que pases `--force`.

Se rechaza cualquier argumento de nombre. `--force` conserva lo que la inferencia no puede deducir del archivo que reemplaza: el nombre de cada aplicación, su `path` y su ruta `cms`. Todo lo demás se infiere de nuevo, y una aplicación declarada que ya no encuentre se señalará como eliminada, por lo que en un scaffold vuelve a escribir el `rebase.json` original. El comando de compilación de la aplicación estática utiliza el gestor de paquetes del proyecto.

Para una copia de trabajo (checkout) no vinculada a un proyecto de Cloud, `apps config` indica que no está vinculada, independientemente de si `rebase dev` está en ejecución o no, y proporciona la URL del backend tal como la sirve `rebase dev`.

### `rebase status`

Todo lo que declara este proyecto y si el entorno realmente lo vincula:

```bash
rebase status               # every resource, and the variables it reads
rebase status --json        # machine-readable
```

```
  backend  ·  managed  Rebase's runtime boots your bundle
  declared in  backend/resources.ts
  configured by  .env

  buckets
  ✓ media  s3 · account:minio
      ✓ S3_BUCKET__MEDIA
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Tres archivos deciden a qué puede acceder un backend, y este comando muestra los tres juntos: `rebase.json` indica dónde está tu código y quién ejecuta el servidor, `backend/resources.ts` define lo que el proyecto necesita, y el entorno especifica cómo acceder a cada cosa. Todo lo demás — `rebase.resources.json`, el manifiesto del bundle — se genera a partir del segundo para lectores que no pueden ejecutar tu código, y tú nunca lo escribes directamente.

Un `○` es el estado que conviene conocer antes de un despliegue en lugar de después: declarado, no configurado. Una `✗` significa que el entorno define algo *incorrectamente*, lo que impide el arranque en lugar de degradar su funcionamiento.

Un `rebase.resources.json` que ya no coincida con las declaraciones recibe una línea con `○`. Uno que aún no se haya escrito no: `rebase build` lo escribe en cada compilación, por lo que un proyecto que nunca se ha compilado, como un scaffold recién creado, no tiene nada que corregir.

### `rebase resources`

Lo que este proyecto declara que necesita — las bases de datos, buckets, topics y colas que solicita `backend/resources.ts`, y los crons y funciones que definen sus archivos:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` es la opción que utiliza un trabajo de CI para fallar ante un `rebase.resources.json` que ya no coincida con `backend/resources.ts`. `--json` se combina con ella: si hay discrepancias (drift), `rebase resources --check --json` sale con código 1 con una estructura envoltorio de error (`resource_graph_missing` o `resource_graph_stale`), y en caso de éxito el grafo incluye `check.status`. `--write --json` escribe el archivo y reporta `written.changed`.

Un recurso se declara en `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — o es un archivo bajo `backend/crons` o `backend/functions`, y nunca se escribe a mano en `rebase.resources.json`, el cual se genera a partir de esas declaraciones para que un host pueda leer lo que el proyecto necesita sin compilarlo. Cada entrada registra quién lo utiliza (`table:events`, `column:posts.cover`, `function:report`).

Un backend también cuenta con una base de datos predeterminada y una fuente de almacenamiento predeterminada que nadie declara. Ambas se listan aquí, marcadas como `implicit`, y ninguna se escribe en `rebase.resources.json` — el host las proporciona, por lo que registrarlas pediría aprovisionar algo que nadie solicitó. Declarar una con nombre propio, como `bucket("media")`, mantiene la predeterminada donde está, por lo que ambas se listan. Solo declarar la predeterminada en sí, o marcar un bucket con `default: true`, la reemplaza.

Para ver lo que la plataforma mantiene para un proyecto en comparación con lo que declara su código, y para eliminar una base de datos aprovisionada que el código ya no mencione, consulta [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — cada comando para Rebase Cloud: autenticación, enlace de proyectos, despliegues, configuración, bases de datos, recursos, cómputo y más — tiene [su propia página](/docs/cli/cloud).

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```bash
rebase generate-sdk
```

Escribe un cliente tipado para las tablas que exporta `backend/schema/index.ts` en `generated/sdk/`, con `TableName` y `tablesDictionary`; `--from <link|url>` lee en su lugar el contrato de un backend en ejecución. `--register` también tipa los datos del lado del servidor: escribe los tipos y la declaración `Register` en `backend/generated/` y lo recuerda en `rebase.json` (`registerDatabase`). Consulta [Datos tipados del lado del servidor](/docs/backend/typed-server-data) y [Generación de esquemas](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

El comando a ejecutar cuando algo va mal y aún no sabes qué es. Informa y nunca cambia nada, por lo que es seguro contra cualquier base de datos a la que puedas acceder.

**Sin base de datos.** Estas comprobaciones se ejecutan primero, porque todo lo que impide que un proyecto funcione por completo ocurre antes de que se pueda comparar una tabla:

| Comprobación | Por qué |
| --- | --- |
| Node version | Frente al rango que declara la CLI. Una versión demasiado antigua no se reporta como "Node no soportado" — es un error de sintaxis dentro de una dependencia. |
| Package managers | Dos lockfiles en un proyecto. Ejecutar `npm install` en un workspace de pnpm reescribe `node_modules` en una estructura incompatible con pnpm, y el síntoma es `Cannot find module` horas después. |
| Duplicate slugs | Dos tablas declarando el mismo slug. El esquema rechaza compilar con ello, y esto nombra a ambas. |
| `.env` sanity | Un `JWT_SECRET` de menos de 32 caracteres (con el cual producción rechaza arrancar), y `NODE_ENV=production` sin `CORS_ORIGINS` ni `FRONTEND_URL`. Los valores nunca se imprimen. |
| `@rebasepro/*` version skew | El mismo paquete fijado a diferentes versiones a través de los archivos `package.json` del proyecto. Dos copias rompen el `instanceof` entre ellas, lo que falla como un type guard rechazando su propio tipo. |
| Connection strings | Un `=` sin codificar en un parámetro de URL, que las propias herramientas de PostgreSQL se niegan a analizar — por lo que las copias de seguridad y `psql` fallan mientras la aplicación sigue funcionando. |
| Custom functions | Qué necesita cada función de su host y cuáles de ellas no se ejecutarían en un runtime de tipo edge. |

**Contra la base de datos** — la propia del proyecto, resuelta de la forma en que `rebase db url` la resuelve, por lo que en un scaffold nuevo es la base de datos gestionada, la cual `doctor` inicia:

| Comprobación | Por qué |
| --- | --- |
| Tables → generated schema | Si `schema.generated.ts` está desactualizado. |
| Tables → database | Tablas, columnas, enums, claves foráneas y uniones faltantes. |
| Required extensions | Una columna `col.vector()` necesita pgvector, que Rebase instala únicamente donde un proyecto lo haya declarado. |
| Schema stamp | Si esta base de datos se aprovisionó a partir de estas tablas. Un hash, por lo que puede indicar que ambas discrepan pero nunca cuál va por delante. Una marca `v1:` de un runtime anterior a 0.31 se reporta una vez, con la indicación para volver a marcar: `rebase db push`. |
| Tables → SDK types | Si el SDK tipado generado está desactualizado. |
| RLS policies | Si las políticas de la base de datos coinciden con el `rls` que declaraste, y si alguna política nombra un rol que este servidor no pueda usar. |

Si la base de datos es inaccesible, sus fases se reportan como omitidas junto con el motivo y el resto continúa ejecutándose — consulta [Resolución de problemas](/docs/troubleshooting/).

Sale con un código distinto de cero cuando una comprobación encuentra un error, o cuando una fase no pudo ejecutarse porque la base de datos proporcionada rechaza conexiones. Una fase omitida porque no se pudo resolver ninguna base de datos no se considera un fallo.

`rebase doctor --policies` ejecuta solo las comprobaciones de RLS — sin diferencias de esquema, sin tipos de SDK — y falla de manera estricta (fails closed), lo que la convierte en la opción ideal para usar como control (gate) de CI contra una base de datos desplegada.

`rebase doctor --database` ejecuta únicamente la verificación previa de la base de datos: si el rol con el que se ejecutan las solicitudes autenticadas existe, está restringido y se puede cambiar a él; qué otros inicios de sesión pueden cambiar a él; si todos los roles pueden conectarse; y qué tablas, permisos y políticas compartiría Rebase con otros roles. Cada hallazgo indica el SQL a ejecutar como administrador, la configuración de `rls` que adapta Rebase a la base de datos en su lugar, o ambos. Lee el catálogo y no cambia nada, y sale con código 1 cuando un hallazgo es un fallo. También funciona en un proyecto headless. Consulta [Ejecutar en una base de datos existente o compartida](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Determina si las tablas son seguras para desplegar a producción, en un único comando rápido para CI y para hooks de agentes de IA. Funciona sin conexión (offline) por defecto y nunca modifica nada.

| Paso | Qué lo hace fallar |
| --- | --- |
| Table definitions (`schema`) | `backend/schema` no carga o no compila a través del cargador con el que arranca el backend: una relación con una tabla que el índice no exporta, `rls: "inherit"` sin `defaultRls`, una tabla sin clave primaria — un hallazgo por problema. Una tabla sin `rls` es uno de ellos. |
| RLS coverage (`rls`) | Una tabla con una columna `user_id`, `owner_id`, `organization_id` o `tenant_id` cuyas reglas — las suyas propias o el `defaultRls` que hereda — permiten que un rol lea cada fila sin tenerla en cuenta. Es una advertencia. |
| Migration freshness (`migrations`) | Una tabla o columna declarada en las tablas que ningún archivo en `backend/drizzle/migrations` cree, o una que hayan eliminado pero que una migración aún cree. Se omite en proyectos sin migraciones todavía. |
| CMS customizations (`cms`) | Un `customizeTable(...)` en `frontend/src/cms` (o en `src/cms` de una aplicación estática en `rebase.json`) que no coincide con las tablas, leído de forma estática — los módulos no se ejecutan. `cms-unknown-table`: el slug no hace referencia a ninguna tabla, por lo que el panel lo ignora (se sugiere el slug más cercano). `cms-unknown-field`: una clave bajo `fields` no es ni columna ni relación (se responde con la clave al nombre SQL de una columna). `cms-hidden-required`: un campo oculto del formulario (`hiddenInForm`, `readOnly`, `disabled`) cuya columna es `NOT NULL` sin valor por defecto y sin nada que el servidor rellene, por lo que crear un registro desde el panel siempre falla; es una advertencia cuando un hook o transformación `beforeSave` puede rellenarlo, y se silencia con `filledByServer`. `cms-duplicate-customization`: un mismo slug personalizado dos veces. `cms-not-static` (una advertencia): una llamada cuyo slug, opciones o `fields` no son literales ni una `const` en el mismo archivo, por lo que nada en ella fue comprobado. `cms-ui-config-not-mounted` (una advertencia): `frontend/src/cms/ui-config.json` existe pero no se le pasa a `<RebaseCMS>` como `uiConfig`. `cms-backend-guard-missing`: la configuración de Vite del frontend no usa `rebaseBackendGuard()`, por lo que `rebase build` la rechazaría. Un proyecto headless no tiene `frontend/src/cms` y omite este paso. |
| Live RLS audit (`live`) | Con `--live`: el catálogo [`rls-check`](/docs/rls-check) contra la base de datos del proyecto, y si se han aplicado todas las migraciones. La base de datos se resuelve como lo hacen los comandos `db` — `--database-url`, `DATABASE_URL`, `--docker`, o de lo contrario la base de datos de desarrollo gestionada. Una base de datos que no está configurada o no responde es un error, no una omisión: se solicitó explícitamente la auditoría. Una política de lectura `USING (true)` compilada a partir de una regla `access: "public"` es una advertencia mientras la API requiera un token (`AUTH_REQUIRE`, activado por defecto) — cada usuario autenticado lee cada fila — y un error con `AUTH_REQUIRE=false`, donde las filas son anónimas. |

`--json` imprime un objeto, `{ ok, schemaDir, steps, findings, summary }`: cada paso es `{ id, title, status, detail? }` (`status` es `passed`, `failed`, `warnings` o `skipped`), y cada hallazgo incluye `step`, `check` (un tipo estable en kebab-case), `severity`, `message`, y cuando corresponda `fix`, `table`, `file`, `line` y la ruta con puntos `path` dentro de la tabla (`posts.rls[0]`) — para que un agente pueda reparar lo que rompió. `summary` cuenta `errors` y `warnings`. `--quiet` no imprime nada cuando todo pasa correctamente. Sale con código distinto de cero en caso de error; las advertencias no provocan fallo.

Un proyecto generado con scaffold lo ejecuta para Claude Code tras cada edición bajo `backend/schema/`: consulta [`rebase skills install`](#rebase-skills-install).

### `rebase auth`

Comandos de gestión de autenticación:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestiona las claves API de servicio del proyecto — la credencial que utiliza un agente, script u otro servicio, a diferencia de la sesión de un usuario final:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` indica lo que la clave puede hacer, separado por comas o repetido; `--full-access` le otorga todos los alcances (scopes) que posee la clave de servicio excepto `keys:*`. `--roles` añade roles de RLS junto a `service`, `--expires-in` toma días y `--expires-at` una fecha ISO. `rebase api-keys scopes` enumera todos los scopes que el backend conoce. Una clave se muestra solo una vez. Se aplican tanto los scopes de la clave como la seguridad a nivel de fila (RLS) de la identidad bajo la que actúa. Consulta [Claves API](/docs/backend/api-keys/).

### `rebase storage`

Mantenimiento general de los archivos almacenados, a través del backend en ejecución con `REBASE_SERVICE_KEY` de `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lee cada fila de cada tabla tal como está almacenada (filas con eliminación lógica incluidas, omitiendo cualquier hook `beforeQuery` y `afterRead`) y cada entrada de [historial](/docs/backend/history/), ya que una reversión restaura lo que contiene. Lista los archivos de una fuente (`--source`, la fuente predeterminada cuando se omite) a los que ninguna cadena en ellos hace referencia: una clave, una URL, una referencia `rebase-storage:` en un texto. Se descartan los archivos con una antigüedad menor a `--older-than` horas (24 por defecto), porque el panel de administración sube un archivo antes de que se guarde la fila que lo referencia. El análisis se ejecuta en el backend en segundo plano, por lo que un proyecto demasiado grande para analizarse dentro de una sola solicitud (detrás de un ingress que cause timeout) igualmente termina. La CLI lo inicia y luego muestra su progreso (archivos listados, filas leídas, tablas completadas y cualquiera que no se haya podido leer) hasta que finaliza. Con la [cola de tareas](/docs/backend/jobs/) activa, el análisis es un trabajo `storage.orphans` que ejecutan los workers de tareas. Sin ella, el análisis se ejecuta dentro del proceso del servidor al que se le solicitó, y la CLI lo advierte: reiniciar ese proceso detiene el análisis. Un análisis es un intento de trabajo, limitado por `jobs.timeoutMs` (15 minutos por defecto). Auméntalo o establécelo en 0 para una fuente que requiera más tiempo. `--json` imprime el mismo reporte que antes, más su `scanId`.

`--delete` solicita confirmación antes de eliminar (`--yes` omite la pregunta, y es obligatorio si no hay terminal). Solo elimina archivos del análisis recién mostrado, y solo dentro de los 15 minutos posteriores a que ese análisis se haya completado. No se elimina nada mientras alguna tabla no pueda leerse: una tabla con hooks de lectura en una base de datos cuyo driver no pueda eludirlos cuenta como no leída. Antes de eliminar nada, el servidor lee de nuevo cada fila y entrada del historial comparándola con los archivos listados. Luego vuelve a consultar el estado de cada archivo justo antes de eliminarlo. Un archivo al que ahora haga referencia una fila, que haya sido subido de nuevo desde el análisis o que ya no exista, se conserva, y la CLI lo enumera como conservado. Los archivos a los que solo hacen referencia tablas que Rebase no gestiona parecerán no utilizados: verifícalos antes de eliminarlos. Frente a un backend de la versión 0.25.1 o anterior, la CLI realiza el análisis al modo antiguo, dentro de una única solicitud.

`move` copia los archivos bajo `--prefix` a otra fuente bajo las mismas claves, una página a la vez. Se omite un archivo si el destino ya lo contiene con el mismo tamaño, por lo que una transferencia interrumpida se reanuda ejecutándola de nuevo; `--delete-source` elimina cada archivo del origen una vez que el destino ya lo contiene, y se rechaza cuando ambas fuentes almacenan en el mismo bucket o directorio. Una vez completado el traslado, la CLI vuelve a inspeccionar el origen con un recorrido nuevo y nombra cada archivo que la operación no movió: con `--delete-source`, cualquier archivo que aún permanezca en el origen; sin ella, cualquier archivo del cual el destino no conserve una copia del mismo tamaño. Sale con código 1 si queda alguno, y ejecutar el mismo movimiento de nuevo lo procesará. `--json` los imprime como `notMoved`. Leer el reporte de un análisis requiere `database:read`. Iniciar un análisis, eliminar y mover requieren `database:write`, permiso que posee la clave de servicio.

### `rebase skills install`

Instala las habilidades de referencia de Rebase para tus asistentes de programación con IA — todos los `--agent` mencionados anteriormente:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulta [Habilidades de agentes](/docs/ai/skills) para obtener la lista completa y saber dónde se escriben los archivos.

`--hooks` instala la protección (guardrail) para Claude Code que `rebase init` incluye con cada proyecto: `.claude/hooks/post-edit-collection.sh`, registrado como un hook `PostToolUse` en `.claude/settings.json`, el cual ejecuta `rebase verify --quiet` tras cada edición bajo `backend/schema/` o `frontend/src/cms/` y devuelve cualquier problema al agente. Las configuraciones y hooks existentes se conservan. `rebase skills --hooks` instala únicamente el hook.

### `rebase telemetry`

Uso compartido de telemetría anónima, desactivado hasta que digas que sí. Una ejecución interactiva de `rebase init` pregunta al final y el prompt selecciona "no" por defecto, por lo que no se comparte nada a menos que respondas afirmativamente. La respuesta se guarda por máquina (`~/.rebase/telemetry.json`): tras un "sí", `init` nunca vuelve a preguntar, y tras un "no", el siguiente `init` preguntará de nuevo. Cada checkout obtiene un ID de proyecto aleatorio, guardado en su archivo ignorado por git `.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime la configuración actual, `show` imprime exactamente lo que se enviaría — independientemente de si el envío está activado o no, para que puedas revisar los datos antes de decidir — y los otros dos modifican la opción. Si nunca ejecutaste `init`, nunca se recopiló nada.

## Próximos pasos

- **[Generación de esquemas](/docs/cli/schema/#production-workflow)** — El flujo de trabajo de migración, desde la edición de una tabla hasta producción
- **[Esquema como código](/docs/architecture/schema-as-code)** — Cómo funciona la generación de esquemas
- **[Inicio rápido](/docs/getting-started/quickstart)** — Comienza ahora
