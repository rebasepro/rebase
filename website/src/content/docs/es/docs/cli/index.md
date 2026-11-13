---
sourceHash: ed5be063323e7f6a
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

O ejecuta cualquier comando sin instalarlo: `pnpm dlx @rebasepro/cli <command>`.

## Salida legible por máquinas

`--json` es el modificador, y fuera de la familia `cloud` es el único: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` y `rebase verify` envían entonces un único valor JSON a stdout —el resultado, o una estructura `{"error": {"message", "code", "hint", "issues"}}` con un código de salida distinto de cero— en **cada** salida del comando, de modo que quien lo invoque pueda analizar stdout incondicionalmente. Sin él, escriben texto legible para humanos y los fallos van a stderr. `rebase cloud` utiliza la misma estructura y es la única excepción al modificador: también activa JSON por sí mismo cuando stdout no es una TTY, o cuando `REBASE_JSON=1` está configurado. Por lo tanto, `rebase cloud status | cat` es JSON mientras que `rebase status | cat` no lo es; en un script, pasa `--json` explícitamente en lugar de confiar en cualquiera de las dos reglas.

## Comandos

### `rebase init`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Inicializa un nuevo proyecto de Rebase:

```bash
rebase init [directory]
```

Configura un `backend/` (las tablas en `backend/schema/`) y un `frontend/` (el panel de administración, con sus personalizaciones de tablas en `frontend/src/cms/`); `--headless` genera únicamente el `backend/`, sin `backend/schema/`. [Estructura del proyecto](/docs/getting-started/project-structure/) muestra ambos árboles.

| Flag | Qué hace |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Predeterminado `blog` |
| `--headless` | Solo backend: sin panel de administración y sin `backend/schema/`: el servidor expone las propias tablas de la base de datos. `--template` no tiene efecto, ya que no hay tablas que inicializar |
| `-y, --yes` | No preguntar nunca. **Obligatorio siempre que no haya un terminal para responder**, como en CI. Omite git init y la instalación de dependencias; los valores interactivos predeterminados responden afirmativamente a ambos, así que pasa `--git` / `--install` si los deseas |
| `-i, --install` | Instalar dependencias después de generar la estructura. Sin él, init pregunta (por defecto sí); bajo `--yes`, no se instala nada |
| `--no-install` | No instalar nada y no preguntar |
| `-g, --git` | Inicializar un repositorio y hacer el primer commit. Sin él, init pregunta (por defecto sí); bajo `--yes`, no se crea el repositorio |
| `--database-url <url>` | Usar una base de datos existente en lugar de la gestionada. Debe ser una URL `postgres://` o `postgresql://`: cualquier otra cosa se rechaza antes de escribir un archivo, y el prompt interactivo volverá a preguntar |
| `--introspect` | Generar `backend/schema` a partir de esa base de datos. Implica `--template blank` y requiere `--install` |
| `--project <slug>` | Vincular la estructura generada a un proyecto de Rebase Cloud |
| `--setup-key <key>` | La clave de un solo uso que autentica esa vinculación |
| `-a, --agent <name>` | Configurar agentes de programación por IA: las [skills](/docs/ai/skills) y el [servidor MCP](/docs/ai/mcp). Repetible o separado por comas — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Sin él, `init` pregunta y preselecciona los agentes instalados en la máquina; bajo `--yes`, ninguno |

### `rebase dev`

Inicia el servidor de desarrollo:

```bash
rebase dev
```

Inicia tanto el frontend como el backend con recarga en caliente (hot reloading) y regenera el esquema de Drizzle y los tipos del SDK (`generated/sdk/`) al inicio y en cada guardado dentro de `backend/schema/`.

Ambos puertos se derivan de la ruta del proyecto para que varios proyectos de Rebase puedan ejecutarse en paralelo. Usa las URLs que imprime `rebase dev`. Fija uno con `rebase dev --port 3001`.

Cualquier edición en `.env` reinicia el backend, el cual vuelve a leer el archivo, al igual que hace el panel de administración. Lo que `rebase dev` establece por sí mismo se conserva hasta que lo reinicies: `PORT`, y `DATABASE_URL` cuando está en la base de datos gestionada o en Docker.

Con `--database-url`, `rebase dev` primero verifica que algo responda en ese host y puerto. Si nada responde, lo indica mencionando el flag y finaliza con código `1` sin iniciar nada; además, deja intactos los nombres de `.env` de la base de datos, sin iniciar nunca su contenedor compose.

### `rebase build`

Compila el proyecto en un bundle desplegable en `dist-bundle/`:

```bash
rebase build
```

El bundle es el artefacto que despliegas: la imagen del runtime lo carga, por lo que no necesitas compilar una imagen de aplicación por tu cuenta. Flags útiles:

| Flag | Efecto |
|------|--------|
| `--output <dir>` (o `--out`) | Escribir el bundle en otro lugar que no sea `dist-bundle/` (una aplicación a la vez) |
| `--vendor` | Siempre instalar e incluir las dependencias del bundle |
| `--no-vendor` | Nunca incluir dependencias (vendor); el pod las instala en cada inicio |
| `--skip-type-check` | Omitir la comprobación de tipos (más rápido, menos seguro) |
| `--no-static` | No integrar el frontend en el bundle del backend (cada app estática sigue obteniendo su propio bundle) |
| `--skip-static-build` | Integrar el frontend tal como ya está compilado, sin ejecutar su comando de compilación |

<span class="since-badge" data-since="0.31">Desde 0.31</span> Se rechazará un frontend cuya configuración de Vite no utilice `rebaseBackendGuard()` (de `@rebasepro/app/vitePlugin`): es lo que mantiene el código del servidor fuera del bundle del navegador. `frontend/src/cms/ui-config.json` se incorpora al bundle como `entry.uiConfig`, la presentación del espacio de trabajo que sirve un backend desplegado.

Las dependencias se empaquetan (vendored) por defecto para que una nueva instancia no tenga que asumir una instalación de 35–55 segundos. En su lugar, si el árbol supera los 2 GB en disco, se descarta, ya que el límite de subida es de 1 GB comprimido.

Cada app estática que contiene el bundle recibe una copia brotli (`.br`) y gzip (`.gz`) junto a cada recurso con hash de contenido de 1 KB o más —los archivos que un navegador almacena en caché durante un año. El runtime envía la que el navegador acepte, por lo que esos archivos no implican trabajo de compresión por petición, incluida la primera visita tras un despliegue, y los navegadores compatibles con brotli la reciben (aproximadamente un 11% más pequeña que gzip en el JavaScript del admin). La salida de compilación propia de tu frontend se mantiene intacta; solo cambia la copia en el bundle. En la aplicación de ejemplo, esto añade menos de un segundo a la compilación y unos 2.4 MB al bundle.

### `rebase upgrade`

Actualiza todos los paquetes `@rebasepro/*` fijados en el proyecto a una única versión y, a continuación, los instala con el gestor de paquetes correspondiente a su lockfile. `rebase upgrade` selecciona latest; `--to 0.21.0` una versión exacta, sin consultar el registro; `--to canary` un dist-tag. Cada versión fijada en `dependencies`, `devDependencies` y `optionalDependencies`, en cada `package.json` del proyecto, conserva su `^` o `~`, y nada más cambia en el archivo. Las `peerDependencies` y las especificaciones `workspace:`, `link:`, `file:`, git y tags se listan y se dejan intactas. Las anulaciones (overrides) en `pnpm-workspace.yaml` y `package.json` también se actualizan, pero una anulación por `link:` o `file:` prevalece sobre cualquier versión fijada: se notifica, y `--drop-local-overrides` la elimina. `--dry-run` no escribe nada, `--no-install` omite la instalación y `--json` imprime un único documento.

Un proyecto en una versión preliminar (prerelease), como canary, permanece en su canal a menos que `latest` sea más reciente. Se rechazará un dist-tag que mueva una versión fijada hacia atrás (`downgrade_refused` bajo `--json`) a menos que pases `--allow-downgrade`; un `--to` exacto se aplica y se marca como downgrade. Un `--dry-run` de una actualización que la ejecución real rechazaría muestra qué cambiaría y finaliza con código 0, y bajo `--json` su documento incluye el rechazo como `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Ejecuta el bundle compilado de la misma forma en que lo ejecuta un despliegue:

```bash
rebase start
```

Lee `PORT` y el resto de `.env`, a diferencia de `rebase dev`, en el `NODE_ENV` que definan. Un `.env` generado inicialmente indica `development`, por lo que la primera cuenta que se registre seguirá convirtiéndose en la administradora, y `rebase start` lo advertirá al inicio; define `NODE_ENV=production` para un servidor de producción. `rebase start --bundle ./dist-bundle` ejecuta un bundle ubicado en otra ruta.

`rebase start` no inicia ninguna base de datos, y el `.env` inicial no tiene `DATABASE_URL`, por lo que una ejecución local con la base de datos que usa `rebase dev` es `DATABASE_URL="$(rebase db url)" rebase start`. Sin ella, imprimirá esa línea antes de arrancar.

### `rebase apps list`

Muestra las apps que declara este repositorio:

```bash
rebase apps list
```

Un repositorio puede declarar más de una app desplegable —por ejemplo, un backend y un sitio de marketing. Así es como puedes ver sobre qué actuarán `rebase build` y el despliegue.

### `rebase eject`

Toma el control del proceso del servidor y su imagen:

```bash
rebase eject
```

Escribe el punto de entrada del backend y un `Dockerfile` en el proyecto y cambia la configuración del backend, de modo que el repositorio compila su propia imagen en lugar de ejecutar el runtime publicado. A partir de ese momento, **las actualizaciones del runtime de la plataforma ya no le afectarán**, y la configuración de CORS, autenticación, almacenamiento y apagado pasan a ser tu responsabilidad.

Previsualízalo con `rebase eject --dry-run`, que lista lo que cambiaría sin modificar nada. `--force` reemplaza un `backend/src/index.ts` o `env.ts` existente, guardando el archivo actual como `<name>.bak`.

El servidor expulsado (ejected) mantiene las subidas locales en `uploads/` del proyecto, ya sea ejecutado desde el código fuente o compilado, tal como hace `rebase dev`. Se ejecuta en `backend/`, por lo que un `STORAGE_PATH` relativo allí se lee desde `backend/`.

### `rebase schema generate` / `rebase schema stale`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Todos los comandos que leen el esquema aceptan `--schema-dir <dir>` para proyectos que lo mantengan en otra ubicación; `--collections` fue eliminado. `rebase dev` mantiene el archivo actualizado, por lo que `stale` es la comprobación adecuada para una compilación o CI. Consulta [Generación de esquemas](/docs/cli/schema/).

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

Cada uno se detalla en [Comandos de base de datos](/docs/cli/database/), junto con el orden en que un comando selecciona su base de datos; `push`, `generate` y `migrate` se explican en profundidad en [Generación de esquemas](/docs/cli/schema/).

### `rebase console`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un REPL de Node con los datos del proyecto disponibles, o un fragmento ejecutado con `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) y `collections` (las tablas del proyecto, cargadas desde `backend/schema`) están en el ámbito (scope), y `await` en el nivel superior funciona. La base de datos se resuelve de la misma forma que `rebase db push` la resuelve, y abrirla no cambia nada en ella. Con `-e`, el resultado esperado se imprime como JSON en stdout y cualquier excepción finaliza con `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulta [Scripts y la consola](/docs/backend/scripts/).

### `rebase migrate`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Migraciones unidireccionales desde una estructura que esta versión ya no lee:
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema`
y `frontend/src/cms`) y `rebase migrate sdk-calls` (`data.collection("x")`
→ `data.table("x")` en tu propio código). Sus flags, lo que escriben y la
sección "Revisar antes de desplegar" se encuentran en
[Generación de esquemas](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` no toma ningún nombre: deduce cada app a partir del proyecto y escribe todo el `rebase.json`, negándose a reemplazar uno existente a menos que pases `--force`.

Se rechaza cualquier argumento de nombre. `--force` conserva lo que la deducción no puede determinar a partir del archivo que reemplaza: el nombre de cada app, su `path` y su ruta `cms`. Todo lo demás se deduce nuevamente, y cualquier app declarada que ya no se encuentre se marcará como eliminada, por lo que en una estructura generada (scaffold) vuelve a escribir el `rebase.json` que venía por defecto. El comando de compilación de la app estática utiliza el gestor de paquetes del proyecto.

Para una copia local no vinculada a un proyecto de Cloud, `apps config` indica que no está vinculada, independientemente de si `rebase dev` se está ejecutando o no, y proporciona la URL del backend tal como la sirve `rebase dev`.

### `rebase status`

Todo lo que este proyecto declara y si el entorno realmente lo vincula:

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

Tres archivos deciden a qué puede acceder un backend, y este comando muestra los tres juntos:
`rebase.json` indica dónde está tu código y quién ejecuta el servidor,
`backend/resources.ts` indica qué necesita el proyecto, y el entorno especifica cómo
acceder a cada cosa. Todo lo demás —`rebase.resources.json`, el manifiesto del bundle—
se genera a partir del segundo para lectores que no pueden ejecutar tu código,
y tú nunca lo escribes manualmente.

Un `○` representa el estado que conviene conocer antes de un despliegue en lugar de después:
declarado, pero no configurado. Una `✗` significa que el entorno define algo *incorrectamente*,
lo cual impide el arranque en lugar de degradar el servicio.

Un `rebase.resources.json` que ya no coincida con las declaraciones recibe una línea `○`.
Uno que aún no se haya escrito no: `rebase build` lo escribe en cada compilación, por lo que
un proyecto que nunca se ha compilado, como una estructura recién creada, no tiene nada que corregir.

### `rebase resources`

Lo que este proyecto declara que necesita —las bases de datos, buckets, topics y
colas que `backend/resources.ts` solicita, y los crons y funciones que definen sus archivos:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` es el flag que utiliza un flujo de CI para fallar si
`rebase.resources.json` ya no coincide con `backend/resources.ts`.
`--json` se combina
con él: ante discrepancias (drift), `rebase resources --check --json` finaliza con código 1 con una
estructura de error (`resource_graph_missing` o `resource_graph_stale`), y en caso de éxito
el grafo incluye `check.status`. `--write --json` escribe el archivo y reporta `written.changed`.

Un recurso se declara en `backend/resources.ts` — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — o es un archivo
bajo `backend/crons` o `backend/functions`, y nunca se escribe a mano en
`rebase.resources.json`, el cual se genera a partir de esas declaraciones para que un host pueda
leer lo que un proyecto necesita sin compilarlo. Cada entrada registra quién lo utiliza
(`table:events`, `column:posts.cover`, `function:report`).

Un backend también cuenta con una base de datos predeterminada y una fuente de almacenamiento predeterminada
que nadie declara. Ambas se listan aquí, marcadas como `implicit`, y ninguna se escribe en
`rebase.resources.json` —el host las suministra, por lo que registrarlas solicitaría
el aprovisionamiento de algo que nadie pidió.
Declarar una con nombre,
como `bucket("media")`, deja la predeterminada donde está, por lo que ambas se listan.
Solo declarar la predeterminada en sí, o marcar un bucket como `default: true`, la reemplaza.

Para ver lo que la plataforma mantiene para un proyecto en comparación con lo que declara su código,
y para eliminar una base de datos aprovisionada que el código ya no menciona, consulta
[`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` —todos los comandos para Rebase Cloud: autenticación, enlace de proyectos, despliegues, configuración, bases de datos, recursos, cómputo y más— tiene [su propia página](/docs/cli/cloud).

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```bash
rebase generate-sdk
```

Escribe un cliente tipado para las tablas que exporta `backend/schema/index.ts` en
`generated/sdk/`, con `TableName` y `tablesDictionary`; `--from <link|url>`
lee en su lugar el contrato de un backend en ejecución. `--register` también tipa
los datos del lado del servidor: escribe los tipos y la declaración `Register` en
`backend/generated/` y lo recuerda en `rebase.json` (`registerDatabase`).
Consulta [Datos tipados en el lado del servidor](/docs/backend/typed-server-data) y
[Generación de esquemas](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

El comando a ejecutar cuando algo va mal y aún no sabes qué es. Informa
y nunca cambia nada, por lo que es seguro frente a cualquier base de datos a la que
tengas acceso.

**Sin una base de datos.** Estas comprobaciones se ejecutan primero, porque todo lo que impide
que un proyecto funcione en absoluto ocurre antes de que se pueda comparar una tabla:

| Comprobación | Por qué |
| --- | --- |
| Node version | Comparada con el rango que declara la CLI. Una versión demasiado antigua no se reporta como "Node no soportado": es un error de sintaxis dentro de una dependencia. |
| Package managers | Dos lockfiles en un mismo proyecto. Ejecutar `npm install` en un workspace de pnpm reescribe `node_modules` con una estructura con la que pnpm no coincide, y el síntoma es `Cannot find module` horas más tarde. |
| Duplicate slugs | Dos tablas declarando el mismo slug. El esquema rechaza compilar con esto, y esto nombra a ambas. |
| `.env` sanity | Un `JWT_SECRET` con menos de 32 caracteres (con el cual producción se niega a arrancar) y `NODE_ENV=production` sin `CORS_ORIGINS` ni `FRONTEND_URL`. Los valores nunca se imprimen. |
| `@rebasepro/*` version skew | El mismo paquete fijado a diferentes versiones en los archivos `package.json` del proyecto. Dos copias rompen el `instanceof` entre ellas, lo que falla como un type guard rechazando su propio tipo. |
| Connection strings | Un `=` no codificado en un parámetro de URL, que las herramientas propias de PostgreSQL se niegan a analizar; por lo tanto, las copias de seguridad y `psql` fallan mientras la aplicación sigue funcionando. |
| Custom functions | Lo que cada función necesita de su host y cuáles de ellas no se ejecutarían en un runtime edge. |

**Contra la base de datos** —la propia del proyecto, resuelta de la forma en que `rebase db url`
la resuelve, por lo que en una estructura recién creada es la base de datos gestionada,
la cual inicia `doctor`:

| Comprobación | Por qué |
| --- | --- |
| Tables → generated schema | Si `schema.generated.ts` está desactualizado. |
| Tables → database | Tablas, columnas, enums, claves foráneas y uniones (junctions) faltantes. |
| Required extensions | Una columna `col.vector()` necesita pgvector, que Rebase instala únicamente donde un proyecto lo haya declarado. |
| Schema stamp | Si esta base de datos fue aprovisionada a partir de estas tablas. Es un hash, por lo que puede indicar que ambas difieren, pero nunca cuál va por delante. Una marca `v1:` de un runtime anterior a la versión 0.31 se reporta una vez, junto con la forma de volver a marcarla: `rebase db push`. |
| Tables → SDK types | Si el SDK tipado generado está desactualizado. |
| RLS policies | Si las políticas de la base de datos coinciden con el `rls` que declaraste, y si alguna política nombra un rol que este servidor no puede usar. |

Si la base de datos es inaccesible, sus fases se reportan como omitidas con el
motivo y el resto sigue ejecutándose; consulta [Solución de problemas](/docs/troubleshooting/).

Finaliza con un código distinto de cero cuando una comprobación encuentra un error o cuando
una fase no pudo ejecutarse porque la base de datos proporcionada rechaza las conexiones. Una fase
omitida debido a que no se pudo resolver ninguna base de datos no se considera un fallo.

`rebase doctor --policies` ejecuta únicamente las comprobaciones de RLS —sin diferencias de esquema
ni tipos del SDK— y falla de forma restrictiva (fails closed), lo que la convierte en la opción ideal
como control de paso en CI frente a una base de datos desplegada.

`rebase doctor --database`
ejecuta únicamente la verificación previa de la base de datos: si el rol con el que se ejecutan
las peticiones autenticadas existe, está restringido y se puede cambiar a él, qué otros inicios
de sesión pueden cambiar a él, si todos los roles pueden conectarse y qué tablas, permisos (grants)
y políticas compartiría Rebase con otros roles. Cada hallazgo indica el SQL que debe ejecutarse
como administrador, la configuración de `rls` que adapta Rebase a la base de datos en su lugar,
o ambos. Lee el catálogo sin modificar nada y finaliza con código 1 cuando un hallazgo es un fallo.
También funciona en un proyecto headless. Consulta
[Ejecución en una base de datos existente o compartida](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Verifica si las tablas están listas para producción, en un comando rápido para CI y para
los hooks de un agente de IA. Funciona sin conexión por defecto y nunca modifica nada.

| Paso | Qué provoca su fallo |
| --- | --- |
| Definiciones de tablas (`schema`) | `backend/schema` no carga o no compila, a través del loader con el que arranca el backend: una relación a una tabla que el índice no exporta, `rls: "inherit"` sin `defaultRls`, una tabla sin clave primaria — un hallazgo por problema. Una tabla sin `rls` es uno de ellos. |
| Cobertura de RLS (`rls`) | Una tabla con una columna `user_id`, `owner_id`, `organization_id` o `tenant_id` cuyas reglas —propias o el `defaultRls` que hereda— permiten que un rol lea cualquier fila independientemente de ella. Es una advertencia (warning). |
| Actualización de migraciones (`migrations`) | Una tabla o columna que declaran las tablas y que ningún archivo en `backend/drizzle/migrations` crea, o una eliminada que una migración aún crea. Se omite en proyectos que aún no tengan migraciones. |
| Personalizaciones del CMS (`cms`) | Un `customizeTable(...)` en `frontend/src/cms` (o en `src/cms` de una app estática en `rebase.json`) que no coincide con las tablas, leído estáticamente — los módulos no se ejecutan. `cms-unknown-table`: el slug no corresponde a ninguna tabla, por lo que el panel lo ignora (se sugiere el slug más cercano). `cms-unknown-field`: una clave bajo `fields` no es ni columna ni relación (el nombre SQL de una columna se responde con su clave). `cms-hidden-required`: un campo oculto del formulario (`hiddenInForm`, `readOnly`, `disabled`) cuya columna es `NOT NULL` sin valor por defecto y sin nada que el servidor complete, por lo que crear un registro desde el panel siempre falla; es una advertencia cuando un hook o transformación `beforeSave` puede completarlo, y se silencia con `filledByServer`. `cms-duplicate-customization`: un mismo slug personalizado dos veces. `cms-not-static` (advertencia): una llamada cuyo slug, opciones o `fields` no son literales ni una constante (`const`) en el mismo archivo, por lo que no se comprobó nada en ella. `cms-ui-config-not-mounted` (advertencia): `frontend/src/cms/ui-config.json` existe pero no se pasa a `<RebaseCMS>` como `uiConfig`. `cms-backend-guard-missing`: la configuración de Vite del frontend no usa `rebaseBackendGuard()`, por lo que `rebase build` lo rechazaría. Un proyecto headless no tiene `frontend/src/cms` y omite este paso. |
| Auditoría de RLS en vivo (`live`) | Con `--live`: el catálogo de [`rls-check`](/docs/rls-check) contra la base de datos del proyecto, y si se han aplicado todas las migraciones. La base de datos se resuelve como lo hacen los comandos `db` — `--database-url`, `DATABASE_URL`, `--docker`, o de lo contrario la base de datos de desarrollo gestionada. Una base de datos no configurada o que no responde es un error, no una omisión: se solicitó explícitamente la auditoría. Una política de lectura `USING (true)` compilada a partir de una regla `access: "public"` es una advertencia mientras la API requiera un token (`AUTH_REQUIRE`, activado por defecto) —todo usuario autenticado lee todas las filas— y un error con `AUTH_REQUIRE=false`, donde las filas son anónimas. |

`--json` imprime un único objeto, `{ ok, schemaDir, steps, findings, summary }`:
cada paso es `{ id, title, status, detail? }` (`status` es `passed`, `failed`,
`warnings` o `skipped`), y cada hallazgo contiene `step`, `check` (un tipo estable
en kebab-case), `severity`, `message` y, cuando apliquen, `fix`, `table`,
`file`, `line` y la ruta `path` con puntos hacia la tabla (`posts.rls[0]`), de modo que un agente
pueda reparar lo que haya roto. `summary` contabiliza `errors` y `warnings`. `--quiet` no imprime nada cuando todo pasa correctamente. Finaliza con código distinto de cero ante
un error; las advertencias no provocan fallo.

Un proyecto generado lo ejecuta para Claude Code tras cada edición en `backend/schema/`: consulta
[`rebase skills install`](#rebase-skills-install).

### `rebase auth`

Comandos de gestión de autenticación:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestiona las API keys de servicio del proyecto —la credencial que utiliza un agente, script u
otro servicio, a diferencia de la sesión de un usuario final:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` indica qué puede hacer la clave, separado por comas o repetido; `--full-access`
le otorga todos los alcances (scopes) que posee la clave de servicio excepto `keys:*`. `--roles` añade
roles de RLS junto a `service`, `--expires-in` acepta días y `--expires-at` una fecha en formato ISO.
`rebase api-keys scopes` lista todos los alcances que conoce el backend. Una clave se muestra solo una vez.
Se aplican tanto los alcances de la clave como la seguridad a nivel de fila (RLS) de la identidad bajo la cual actúa.
Consulta [API keys](/docs/backend/api-keys/).

### `rebase storage`

Mantenimiento completo de archivos almacenados a través del backend en ejecución con
`REBASE_SERVICE_KEY` desde `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lee cada fila de cada tabla tal como está almacenada (incluidas las filas con
borrado lógico o soft-delete, omitiendo todos los hooks `beforeQuery` y `afterRead`) y cada
entrada de [historial](/docs/backend/history/), ya que una reversión restaura lo que contiene.
Lista los archivos de una fuente (`--source`, la fuente predeterminada cuando se omite)
que ninguna cadena de texto en ellos mencione: una clave, una URL o una referencia
`rebase-storage:` en un texto. Se excluyen los archivos con una antigüedad menor a `--older-than` horas (24 por defecto),
porque el panel de administración sube un archivo antes de que se guarde la fila que lo referencia.
El escaneo se ejecuta en el backend en segundo plano, por lo que un proyecto demasiado grande para escanearse
en una sola petición (detrás de un ingress que supere el tiempo de espera) aun así finaliza. La
CLI lo inicia y luego muestra su progreso (archivos listados, filas leídas, tablas
completadas y cualquiera que no se haya podido leer) hasta que concluye. Con la
[cola de trabajos (job queue)](/docs/backend/jobs/) activada, el escaneo es un trabajo `storage.orphans` que
ejecutan los workers de trabajos. Sin ella, el escaneo se ejecuta dentro del proceso del servidor al que
se le solicitó, y la CLI lo advierte: reiniciar ese proceso detiene el escaneo. Un escaneo
es un intento de trabajo, limitado por `jobs.timeoutMs` (15 minutos por defecto). Auméntalo,
o establécelo en 0, para una fuente que requiera más tiempo. `--json` imprime el mismo
informe que antes, más su `scanId`.

`--delete` pregunta antes de eliminar (`--yes` omite la pregunta y es obligatorio
sin un terminal). Elimina únicamente a partir del escaneo recién impreso y solo dentro de los
15 minutos posteriores a la finalización de ese escaneo. No se elimina nada mientras una tabla
no se pueda leer: una tabla con hooks de lectura en una base de datos cuyo controlador no
pueda omitirlos se considera no leída. Antes de eliminar nada, el servidor vuelve a leer cada fila
y entrada del historial frente a los archivos listados. Luego, vuelve a verificar cada archivo
justo antes de eliminarlo. Un archivo al que ahora haga referencia una fila, que haya sido
subido de nuevo desde el escaneo o que haya desaparecido, se conserva, y la CLI
lo lista como conservado. Los archivos que solo mencionan tablas que Rebase no gestiona
parecerán no utilizados: compruébalo antes de eliminar. Frente a un backend de la versión 0.25.1 o anterior, la
CLI realiza el escaneo de la forma antigua, dentro de una sola petición.

`move` copia los archivos bajo `--prefix` a otra fuente bajo las mismas claves,
una página a la vez. Se omite un archivo que el destino ya posea con el mismo tamaño,
por lo que una transferencia interrumpida se reanuda al ejecutarla de nuevo; `--delete-source` elimina cada
archivo del origen una vez que el destino lo contiene, y se rechaza cuando ambas
fuentes almacenan en el mismo bucket o directorio. Una vez completado el traslado, la CLI
vuelve a listar la fuente con un nuevo recorrido e indica cada archivo que la operación no
movió: con `--delete-source`, cualquier archivo que aún permanezca en el origen; sin él, cualquier archivo
del cual el destino no tenga una copia del mismo tamaño. Finaliza con 1 cuando hay alguno, y
ejecutar la misma operación nuevamente lo procesará. `--json` los imprime como `notMoved`. Leer el informe de
un escaneo requiere `database:read`. Iniciar un escaneo, eliminar y mover requieren
`database:write`, permisos que posee la clave de servicio.

### `rebase skills install`

Instala las skills de referencia de Rebase para tus asistentes de programación con IA —cada uno de los indicados en `--agent` anteriormente:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulta [Skills para agentes](/docs/ai/skills) para ver la lista completa y dónde se escriben los archivos.

`--hooks` instala la protección (guardrail) para Claude Code que `rebase init` incluye con cada
proyecto: `.claude/hooks/post-edit-collection.sh`, registrado como un hook `PostToolUse`
en `.claude/settings.json`, que ejecuta `rebase verify --quiet` tras cada edición
dentro de `backend/schema/` o `frontend/src/cms/` y devuelve cualquier problema al agente. Las
configuraciones y hooks existentes se conservan. `rebase skills --hooks` instala únicamente el hook.

### `rebase telemetry`

Uso compartido anónimo de telemetría, desactivado hasta que digas que sí. Una ejecución interactiva de `rebase init`
pregunta al final, y la respuesta por defecto es no, por lo que no se comparte nada a menos que
respondas afirmativamente. La respuesta se guarda por máquina (`~/.rebase/telemetry.json`): tras un sí,
`init` nunca vuelve a preguntar, y tras un no, el siguiente `init` preguntará de nuevo. Cada
clon o descarga (checkout) recibe un id de proyecto aleatorio, guardado en su archivo ignorado por git
`.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime la configuración actual, `show` imprime exactamente lo que se enviaría —esté
o no activado el envío, para que puedas revisar el contenido antes de decidir— y
los otros dos lo modifican. Si nunca ejecutaste `init`, nunca se recopiló nada.

## Próximos pasos

- **[Generación de esquemas](/docs/cli/schema/#production-workflow)** — El flujo de trabajo de migración, desde la edición de una tabla hasta producción
- **[Esquema como código](/docs/architecture/schema-as-code)** — Cómo funciona la generación de esquemas
- **[Guía de inicio rápido](/docs/getting-started/quickstart)** — Empieza a utilizar Rebase
