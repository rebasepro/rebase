---
sourceHash: d0327f13212ae542
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

## Salida legible por máquina

`--json` es el modificador, y fuera de la familia `cloud` es el único: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` y `rebase verify` colocan entonces un único valor JSON en stdout —el resultado, o una envoltura `{"error": {"message", "code", "hint", "issues"}}` con una salida distinta de cero— en **cada** terminación del comando, de modo que el llamador pueda parsear stdout incondicionalmente. Sin él, escriben texto legible por humanos y los fallos van a stderr. `rebase cloud` utiliza la misma envoltura y es la única excepción al modificador: también activa JSON por sí mismo cuando stdout no es un TTY, o cuando `REBASE_JSON=1` está configurado. Por lo tanto, `rebase cloud status | cat` es JSON mientras que `rebase status | cat` no lo es; en un script, pasa `--json` explícitamente en lugar de confiar en cualquiera de las reglas.

## Comandos

### `rebase init`

Inicializa un nuevo proyecto de Rebase:

```bash
rebase init [directory]
```

Configura un `backend/` (las tablas en `backend/schema/`) y un `frontend/` (el panel de administración, con las personalizaciones de sus tablas en `frontend/src/cms/`); `--headless` genera la estructura (scaffold) únicamente de `backend/`, sin `backend/schema/`. La [Estructura del proyecto](/docs/getting-started/project-structure/) muestra ambos árboles.

| Flag | Qué hace |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Por defecto `blog` |
| `--headless` | Solo backend: sin panel de administración ni `backend/schema/`: el servidor sirve las propias tablas de la base de datos. `--template` no tiene efecto, porque no hay tablas que poblar (seed) |
| `-y, --yes` | No preguntar nunca. **Requerido siempre que no haya un terminal para responder**, como en CI. Omite git init y la instalación de dependencias (los valores interactivos por defecto responden sí a ambos, así que pasa `--git` / `--install` si los deseas) |
| `-i, --install` | Instalar dependencias después del scaffolding. Sin él, init pregunta (por defecto sí); bajo `--yes`, no se instala nada |
| `--no-install` | No instalar nada y no preguntar |
| `-g, --git` | Inicializar un repositorio y hacer el primer commit. Sin él, init pregunta (por defecto sí); bajo `--yes`, no hay repositorio |
| `--database-url <url>` | Usar una base de datos existente en lugar de la gestionada. Debe ser una URL `postgres://` o `postgresql://`: cualquier otra cosa se rechaza antes de escribir un archivo, y la solicitud interactiva vuelve a preguntar |
| `--introspect` | Generar `backend/schema` a partir de esa base de datos. Implica `--template blank` y requiere `--install` |
| `--project <slug>` | Vincular el scaffold a un proyecto de Rebase Cloud |
| `--setup-key <key>` | La clave de un solo uso que autentica esa vinculación |
| `-a, --agent <name>` | Configurar agentes de codificación de IA: las [habilidades](/docs/ai/skills) y el [servidor MCP](/docs/ai/mcp). Repetible o separado por comas: `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Sin él, `init` pregunta y preselecciona los agentes instalados en la máquina; bajo `--yes`, ninguno |

### `rebase dev`

Inicia el servidor de desarrollo:

```bash
rebase dev
```

Inicia tanto el frontend como el backend con recarga en caliente (hot reloading), y regenera el esquema de Drizzle y los tipos del SDK (`generated/sdk/`) al iniciar y en cada guardado bajo `backend/schema/`.

Ambos puertos se derivan de la ruta del proyecto para que varios proyectos de Rebase puedan ejecutarse en paralelo. Utiliza las URLs que imprime `rebase dev`. Fija uno con `rebase dev --port 3001`.

Una edición en `.env` reinicia el backend, que vuelve a leer el archivo, al igual que el panel de administración. Lo que `rebase dev` establece por sí mismo se conserva hasta que lo reinicies: `PORT`, y `DATABASE_URL` cuando está en la base de datos gestionada o en Docker.

Con `--database-url`, `rebase dev` primero comprueba que algo responda en ese host y puerto. Si nada lo hace, lo indica mencionando el flag y sale con código `1` sin haber iniciado nada; también deja intactos los nombres de la base de datos en `.env`, sin iniciar nunca su contenedor compose.

### `rebase build`

Compila el proyecto en un paquete (bundle) desplegable en `dist-bundle/`:

```bash
rebase build
```

El bundle es el artefacto que despliegas: la imagen de runtime lo carga, por lo que no hay ninguna imagen de aplicación que debas compilar tú mismo. Flags útiles:

| Flag | Efecto |
|------|--------|
| `--output <dir>` (or `--out`) | Escribir el bundle en otro lugar que no sea `dist-bundle/` (una aplicación a la vez) |
| `--vendor` | Instalar e incluir siempre las dependencias del bundle |
| `--no-vendor` | No empaquetar nunca dependencias (vendor); el pod las instala en cada inicio |
| `--skip-type-check` | Omitir la comprobación de tipos (más rápido, menos seguro) |
| `--no-static` | No incorporar el frontend en el bundle del backend (cada aplicación estática sigue obteniendo su propio bundle) |
| `--skip-static-build` | Incorporar el frontend tal como ya está compilado, sin ejecutar su comando de compilación |

Se rechaza cualquier frontend —cada aplicación estática de `rebase.json` con una configuración de Vite— cuya configuración no utilice `rebaseBackendGuard()` (de `@rebasepro/app/vitePlugin`): es lo que mantiene el código del servidor fuera del bundle del navegador y evita que Vite incluya un archivo del backend en línea como una URL `data:` (falla la compilación, identificándose a sí mismo, cuando otro plugin reemplaza su `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` se traslada al bundle como `entry.uiConfig`, la presentación del espacio de trabajo que sirve un backend desplegado.

Las dependencias se empaquetan (vendored) por defecto para que una nueva instancia no tenga que asumir una instalación de 35 a 55 segundos. En su lugar, si un árbol supera los 2 GB en disco, se descarta, ya que el límite de subida es de 1 GB comprimido.

Cada aplicación estática que incluye el bundle obtiene una copia en brotli (`.br`) y en gzip (`.gz`) junto a cada recurso con hash de contenido de 1 KB o más (los archivos que un navegador almacena en caché durante un año). El runtime envía el que el navegador acepte, por lo que esos archivos no implican trabajo de compresión por solicitud, incluida la primera visita tras un despliegue, y los navegadores que aceptan brotli lo reciben (aproximadamente un 11% más pequeño que gzip en el JavaScript del admin). La salida de compilación propia de tu frontend se deja tal como estaba; solo cambia la copia en el bundle. En la aplicación de ejemplo, esto añade menos de un segundo a la compilación y unos 2.4 MB al bundle.

### `rebase upgrade`

Actualiza cada paquete `@rebasepro/*` fijado por el proyecto a una misma versión y luego instala con el gestor de paquetes correspondiente a su lockfile. `rebase upgrade` toma la última versión (`latest`); `--to 0.21.0` una versión exacta, sin consultar el registro; `--to canary` un dist-tag. Cada versión fijada en `dependencies`, `devDependencies` y `optionalDependencies`, en cada `package.json` dentro del proyecto, conserva su `^` o `~`, y nada más en el archivo cambia. `peerDependencies` y las especificaciones `workspace:`, `link:`, `file:`, de git y de etiquetas se listan y se dejan intactas. Los overrides en `pnpm-workspace.yaml` y `package.json` también se actualizan, pero un override `link:` o `file:` tiene prioridad sobre cualquier versión fijada: se informa de ello y `--drop-local-overrides` lo elimina. `--dry-run` no escribe nada, `--no-install` omite la instalación y `--json` imprime un único documento.

Un proyecto en una versión preliminar (prerelease), como un canary, se mantiene en su canal a menos que `latest` sea más reciente. Un dist-tag que movería una versión hacia atrás es rechazado (`downgrade_refused` bajo `--json`) a menos que pases `--allow-downgrade`; un `--to` exacto se aplica y se marca como un downgrade. Un `--dry-run` de una actualización que la ejecución real rechazaría muestra qué se movería y sale con código 0, y bajo `--json` su documento incluye el rechazo como `wouldRefuse` (`{ code, message, hint }`).

#### Actualizar un proyecto PostgreSQL a Rebase 0.34

Ejecuta la CLI de Rebase 0.34 desde la raíz del proyecto en Linux, macOS o Windows.
Sustituye `@ariga/atlas` por `@stokaro/ptah-compat` en el backend PostgreSQL.
Conserva los archivos de migración, `atlas.sum` y las revisiones registradas.

```bash
pnpm dlx @rebasepro/cli@0.34.0 upgrade --to 0.34.0 # version-pin: ignore
```

### `rebase start`

Ejecuta el bundle compilado de la misma manera que lo ejecuta un despliegue:

```bash
rebase start
```

Lee `PORT` y el resto de `.env`, a diferencia de `rebase dev`, en el `NODE_ENV` que definan. Un `.env` generado por el scaffold indica `development`, por lo que la primera cuenta que se registre seguirá convirtiéndose en administradora, y `rebase start` lo indica al principio; establece `NODE_ENV=production` para un servidor de producción. `rebase start --bundle ./dist-bundle` ejecuta un bundle en otra ubicación.

`rebase start` no inicia ninguna base de datos, y el `.env` del scaffold no tiene `DATABASE_URL`, por lo que una ejecución local sobre la base de datos que usa `rebase dev` es `DATABASE_URL="$(rebase db url)" rebase start`. Si no hay una, imprime esa línea antes de arrancar.

### `rebase apps list`

Muestra las aplicaciones que declara este repositorio:

```bash
rebase apps list
```

Un repositorio puede declarar más de una aplicación desplegable —un backend y un sitio de marketing, por ejemplo. Así es como ves sobre qué actuarán `rebase build` y el despliegue.

### `rebase eject`

Toma el control del proceso del servidor y de su imagen:

```bash
rebase eject
```

Escribe el punto de entrada del backend y un `Dockerfile` en el proyecto y cambia el backend para que el repositorio compile su propia imagen en lugar de ejecutar el runtime publicado. A partir de ese momento, **las actualizaciones del runtime de la plataforma ya no le afectarán**, y la configuración de CORS, autenticación, almacenamiento y apagado (shutdown) pasa a ser tu responsabilidad.

Previsualízalo con `rebase eject --dry-run`, que enumera lo que cambiaría y no modifica nada. `--force` reemplaza un `backend/src/index.ts` o `env.ts` existente, conservando el archivo actual como `<name>.bak`.

El servidor expulsado (ejected) conserva las subidas locales en `uploads/` del proyecto, ya sea ejecutado desde el código fuente o compilado, tal como lo hace `rebase dev`. Se ejecuta en `backend/`, por lo que un `STORAGE_PATH` relativo allí se lee desde `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Cada comando que lee el esquema acepta `--schema-dir <dir>` para un proyecto que lo guarde en otra parte; `--collections` fue eliminado. `rebase dev` mantiene el archivo actualizado, por lo que `stale` es la comprobación para una compilación o CI. Consulta [Generación de esquemas](/docs/cli/schema/).

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

Cada uno se describe en [Comandos de base de datos](/docs/cli/database/), junto con el orden en el que un comando selecciona su base de datos; `push`, `generate` y `migrate` se tratan en profundidad en [Generación de esquemas](/docs/cli/schema/).

### `rebase console`

Un REPL de Node con los datos del proyecto disponibles, o un fragmento ejecutado con `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) y `tables` (las tablas del proyecto, cargadas desde `backend/schema`) están en el ámbito (scope), y `await` de nivel superior funciona. La base de datos se resuelve como la resuelve `rebase db push`, y abrirla no cambia nada en ella. Con `-e`, el resultado esperado con await se imprime como JSON en stdout y cualquier excepción (throw) sale con código `1`. Flags: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulta [Scripts y la consola](/docs/backend/scripts/).

### `rebase migrate`

Migraciones unidireccionales desde una estructura que esta versión ya no lee: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` y `frontend/src/cms`) y `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` en tu propio código). Sus flags, lo que escriben y la sección "Review before deploying" se encuentran en [Generación de esquemas](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` no toma ningún nombre: infiere cada aplicación a partir del proyecto y escribe todo el archivo `rebase.json`, y se niega a reemplazar uno existente a menos que pases `--force`.

Se rechaza cualquier argumento de nombre. `--force` conserva lo que la inferencia no puede deducir del archivo que reemplaza: el nombre de cada aplicación, su `path` y su ruta `cms`. Todo lo demás se infiere nuevamente, y cualquier aplicación declarada que ya no encuentre se marca como eliminada, por lo que en un scaffold vuelve a escribir el `rebase.json` que incluía el scaffold. El comando de compilación de la aplicación estática utiliza el gestor de paquetes del proyecto.

Para una copia de trabajo (checkout) no vinculada a un proyecto de Cloud, `apps config` indica que no está vinculada, esté o no ejecutándose `rebase dev`, y proporciona la URL del backend tal como la sirve `rebase dev`.

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

Tres archivos deciden a qué puede acceder un backend, y esto imprime los tres juntos: `rebase.json` indica dónde está tu código y quién ejecuta el servidor, `backend/resources.ts` indica qué necesita el proyecto, y el entorno indica cómo acceder a cada elemento. Todo lo demás —`rebase.resources.json`, el manifiesto del bundle— se genera a partir del archivo intermedio para lectores que no pueden ejecutar tu código, y tú nunca lo escribes manualmente.

Un `○` es el estado que conviene conocer antes de un despliegue en lugar de después: declarado, no configurado. Un `✗` significa que el entorno define algo *incorrectamente*, lo que rechaza el arranque en lugar de degradarse.

Un `rebase.resources.json` que ya no coincide con las declaraciones recibe una línea con `○`. Uno que aún no ha sido escrito no la recibe: `rebase build` lo escribe en cada compilación, por lo que un proyecto que nunca se ha compilado, como un scaffold recién creado, no tiene nada que corregir.

### `rebase resources`

Lo que este proyecto declara que necesita: las bases de datos, buckets, tópicos y colas que solicita `backend/resources.ts`, y los crons y funciones que definen sus archivos:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` es el flag que utiliza un trabajo de CI para fallar ante un `rebase.resources.json` que ya no coincida con `backend/resources.ts`. `--json` se combina con él: ante discrepancias (drift), `rebase resources --check --json` sale con código 1 con una envoltura de error (`resource_graph_missing` o `resource_graph_stale`), y en caso de éxito el grafo incluye `check.status`. `--write --json` escribe el archivo y reporta `written.changed`.

Un recurso se declara en `backend/resources.ts` —`database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")`— o es un archivo bajo `backend/crons` o `backend/functions`, y nunca se escribe a mano en `rebase.resources.json`, el cual se genera a partir de esas declaraciones para que un host pueda leer lo que necesita un proyecto sin compilarlo. Cada entrada registra quién la utiliza (`table:events`, `column:posts.cover`, `function:report`).

Un backend también tiene una base de datos predeterminada y una fuente de almacenamiento predeterminada que nadie declara. Ambas se listan aquí, marcadas como `implicit`, y ninguna se escribe en `rebase.resources.json`: el host las suministra, por lo que registrarlas solicitaría que se aprovisione algo que nadie pidió. Declarar una con nombre, como `bucket("media")`, deja la predeterminada donde está, por lo que ambas se listan. Solo declarar la predeterminada explícitamente, o marcar un bucket como `default: true`, la reemplaza.

Para ver lo que la plataforma mantiene para un proyecto frente a lo que declara su código, y para eliminar una base de datos aprovisionada que el código ya no nombra, consulta [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` —cada comando para Rebase Cloud: autenticación, vinculación de proyectos, despliegues, configuración, bases de datos, recursos, cómputo y más— tiene [su propia página](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Escribe un cliente tipado para las tablas que exporta `backend/schema/index.ts` en `generated/sdk/`, con `TableName` y `tablesDictionary`; `--from <link|url>` lee en su lugar el contrato de un backend en ejecución. `--register` también tipa los datos del lado del servidor: escribe los tipos y la declaración `Register` en `backend/generated/` y lo recuerda en `rebase.json` (`registerDatabase`). Consulta [Datos tipados en el servidor](/docs/backend/typed-server-data) y [Generación de esquemas](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

El comando a ejecutar cuando algo va mal y aún no sabes qué es. Informa y nunca cambia nada, por lo que es seguro frente a cualquier base de datos a la que puedas acceder.

**Sin una base de datos.** Estas comprobaciones se ejecutan primero, porque todo lo que impide que un proyecto funcione por completo ocurre antes de que se pueda comparar una tabla:

| Comprobación | Por qué |
| --- | --- |
| Versión de Node | Frente al rango que declara la CLI. Una versión demasiado antigua no se reporta como "Node no soportado", sino como un error de sintaxis dentro de una dependencia. |
| Gestores de paquetes | Dos archivos de bloqueo (lockfiles) en un mismo proyecto. `npm install` en un workspace de pnpm reescribe `node_modules` en una estructura con la que pnpm no concuerda, y el síntoma es `Cannot find module` horas después. |
| Slugs duplicados | Dos tablas que declaran el mismo slug. El esquema se niega a compilar con esto, y aquí se señalan ambas. |
| Sanidad de `.env` | Un `JWT_SECRET` con menos de 32 caracteres (con el cual producción se niega a arrancar) y `NODE_ENV=production` sin `CORS_ORIGINS` ni `FRONTEND_URL`. Los valores nunca se imprimen. |
| Desajuste de versiones de `@rebasepro/*` | El mismo paquete fijado en diferentes versiones en los distintos archivos `package.json` del proyecto. Dos copias rompen `instanceof` entre ellas, lo que falla como un type guard que rechaza su propio tipo. |
| Cadenas de conexión | Un `=` no codificado en un parámetro de URL, que las propias herramientas de PostgreSQL se niegan a parsear; por lo tanto, las copias de seguridad y `psql` fallan mientras la aplicación sigue funcionando. |
| Funciones personalizadas | Lo que cada función necesita de su host y cuáles de ellas no se ejecutarían en un runtime de edge. |

**Frente a la base de datos** —la propia del proyecto, resuelta de la misma forma en que la resuelve `rebase db url`, por lo que en un scaffold nuevo es la base de datos gestionada, que `doctor` inicia:

| Comprobación | Por qué |
| --- | --- |
| Tablas → esquema generado | Si `schema.generated.ts` está desactualizado. |
| Tablas → base de datos | Tablas, columnas, enums, claves foráneas y uniones (junctions) faltantes. |
| Extensiones requeridas | Una columna `col.vector()` necesita pgvector, que Rebase instala solo donde el proyecto lo haya declarado. |
| Sello del esquema | Si esta base de datos fue aprovisionada a partir de estas tablas. Es un hash, por lo que puede indicar que ambos difieren, pero nunca cuál va por delante. Un sello `v1:` de un runtime anterior a 0.31 se reporta una vez, con la indicación de volver a sellar: `rebase db push`. |
| Tablas → tipos del SDK | Si el SDK tipado generado está desactualizado. |
| Políticas RLS | Si las políticas de la base de datos coinciden con el `rls` declarado y si alguna política nombra un rol que este servidor no puede usar. |

Si la base de datos no es accesible, sus fases se reportan como omitidas con el motivo y el resto se sigue ejecutando; consulta [Resolución de problemas](/docs/troubleshooting/).

Sale con un código distinto de cero cuando una comprobación encuentra un error, o cuando una fase no pudo ejecutarse porque la base de datos proporcionada rechaza las conexiones. Una fase omitida porque no se pudo resolver ninguna base de datos no se considera un fallo.

`rebase doctor --policies` ejecuta únicamente las comprobaciones de RLS —sin diff de esquema ni tipos de SDK— y falla de forma estricta (fails closed), lo que la convierte en la modalidad a usar como filtro de CI contra una base de datos desplegada.

`rebase doctor --database` ejecuta únicamente la verificación previa de la base de datos: si el rol con el que se ejecutan las solicitudes autenticadas existe, está restringido y se puede cambiar a él, qué otros inicios de sesión pueden cambiar a él, si todos los roles pueden conectarse y qué tablas, permisos (grants) y políticas compartiría Rebase con otros roles. Cada hallazgo indica el SQL que debe ejecutarse como administrador, la configuración de `rls` que adapta Rebase a la base de datos en su lugar, o ambos. Lee el catálogo y no modifica nada, y sale con código 1 cuando un hallazgo constituye un fallo. También funciona en un proyecto headless. Consulta [Ejecutar en una base de datos existente o compartida](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Comprueba si las tablas son seguras para publicar, en un comando rápido para CI y para los hooks de un agente de IA. Funciona sin conexión (offline) por defecto y nunca cambia nada.

| Paso | Qué lo hace fallar |
| --- | --- |
| Definiciones de tablas (`schema`) | `backend/schema` no carga o no compila a través del cargador con el que arranca el backend: una relación con una tabla que el índice no exporta, `rls: "inherit"` sin `defaultRls`, una tabla sin clave primaria — un hallazgo por problema. Una tabla sin `rls` es uno de ellos. |
| Cobertura de RLS (`rls`) | Una tabla con una columna `user_id`, `owner_id`, `organization_id` o `tenant_id` cuyas reglas —las suyas propias o el `defaultRls` que hereda— permiten que un rol lea todas las filas independientemente de ella. Una advertencia. `rls-policy-recursion`: una regla que lee su propia tabla en una subconsulta, o dos tablas cuyas reglas se leen mutuamente, lo que Postgres se niega a expandir, de modo que cada sentencia que protege falla con `42P17 infinite recursion detected in policy`; el hallazgo nombra la tabla que lee y la solución: mover la lectura a una función `SECURITY DEFINER`. Un error, o una advertencia cuando el bucle no es seguro. |
| Actualización de migraciones (`migrations`) | Una tabla o columna declarada en las tablas que ningún archivo en `backend/drizzle/migrations` crea, o una que eliminaron pero que una migración aún crea. Se omite para un proyecto que aún no tiene migraciones. |
| Personalizaciones del CMS (`cms`) | Un `customizeTable(...)` en `frontend/src/cms` (o en `src/cms` de una aplicación estática en `rebase.json`) que no coincide con las tablas, leído estáticamente — los módulos no se ejecutan. `cms-unknown-table`: el slug no nombra ninguna tabla, por lo que el panel lo ignora (se sugiere el slug más cercano). `cms-unknown-field`: una clave bajo `fields` no es ni una columna ni una relación (el nombre SQL de una columna se responde con su clave). `cms-hidden-required`: un campo excluido del formulario (`hiddenInForm`, `readOnly`, `disabled`) cuya columna es `NOT NULL` sin valor por defecto y sin nada que el servidor rellene, por lo que crear un registro desde el panel siempre falla; una advertencia cuando un hook o transformación `beforeSave` puede rellenarlo, y silenciado por `filledByServer`. `cms-duplicate-customization`: un mismo slug personalizado dos veces. `cms-not-static` (una advertencia): una llamada cuyo slug, opciones o `fields` no son literales o un `const` en el mismo archivo, por lo que nada en ella fue verificado. `cms-ui-config-not-mounted` (una advertencia): `frontend/src/cms/ui-config.json` existe pero no se le pasa a `<RebaseCMS>` como `uiConfig`. `cms-backend-guard-missing`: la configuración de Vite del frontend no usa `rebaseBackendGuard()`, por lo que `rebase build` lo rechazaría. Un proyecto headless no tiene `frontend/src/cms` y omite este paso. |
| Auditoría de RLS en vivo (`live`) | Con `--live`: el catálogo de [`rls-check`](/docs/rls-check) contra la base de datos del proyecto y si se ha aplicado cada migración. La base de datos se resuelve como la resuelven los comandos `db` — `--database-url`, `DATABASE_URL`, `--docker`, de lo contrario, la base de datos de desarrollo gestionada. Una base de datos que no está configurada o no responde es un error, no una omisión: se solicitó la auditoría. Una política de lectura `USING (true)` compilada a partir de una regla `access: "public"` es una advertencia mientras la API requiera un token (`AUTH_REQUIRE`, activado por defecto) —cada usuario autenticado lee todas las filas— y un error con `AUTH_REQUIRE=false`, donde las filas son anónimas. |

`--json` imprime un único objeto, `{ ok, schemaDir, steps, findings, summary }`: cada paso es `{ id, title, status, detail? }` (`status` es `passed`, `failed`, `warnings` o `skipped`), y cada hallazgo incluye `step`, `check` (un tipo estable en kebab-case), `severity`, `message` y, cuando proceda, `fix`, `table`, `file`, `line` y la ruta punteada (`path`) dentro de la tabla (`posts.rls[0]`) —para que un agente pueda reparar lo que rompió—. `summary` cuenta `errors` y `warnings`. `--quiet` no imprime nada cuando todo pasa con éxito. Sale con un código distinto de cero en caso de error; las advertencias no provocan fallos.

Un proyecto generado con el scaffold lo ejecuta para Claude Code después de cada edición bajo `backend/schema/`: consulta [`rebase skills install`](#rebase-skills-install).

### Comandos para una aplicación en ejecución

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` y `rebase storage ls|cp|rm|url|stat` actúan sobre una aplicación en ejecución a través de su API: el `rebase dev` local, un servidor que especifiques con `--url`, o un proyecto de Rebase Cloud con `--project`. Consulta [Una aplicación en ejecución](/docs/cli/project/).

### `rebase auth`

Comandos de gestión de autenticación:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestiona las claves de API de servicio del proyecto: la credencial que utiliza un agente, script u otro servicio, a diferencia de la sesión de un usuario final:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` indica lo que la clave puede hacer, separado por comas o repetido; `--full-access` le otorga todos los ámbitos (scopes) que posee la clave de servicio excepto `keys:*`. `--roles` añade roles de RLS junto a `service`, `--expires-in` acepta días y `--expires-at` una fecha ISO. `rebase api-keys scopes` lista todos los ámbitos que conoce el backend. Una clave se muestra una sola vez. Se aplican tanto los ámbitos de la clave como la seguridad a nivel de fila (RLS) de la identidad bajo la que actúa. Consulta [Claves de API](/docs/backend/api-keys/).

### `rebase storage`

Mantenimiento integral del almacenamiento de archivos guardados, a través del backend en ejecución con `REBASE_SERVICE_KEY` desde `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lee cada fila de cada tabla tal como está almacenada (incluidas las filas eliminadas suavemente [soft-deleted], pasando por alto cada hook `beforeQuery` y `afterRead`) y cada entrada de [historial](/docs/backend/history/), ya que una reversión restaura lo que contiene. Lista los archivos de una fuente (`--source`, la fuente predeterminada cuando se omite) que ninguna cadena en ellos nombra: una clave, una URL, una referencia `rebase-storage:` en un texto. Se excluyen los archivos con una antigüedad menor a `--older-than` horas (24 por defecto), debido a que el panel de administración sube un archivo antes de que se guarde la fila que lo referencia. El escaneo se ejecuta en el backend en segundo plano, por lo que un proyecto demasiado grande para escanearse dentro de una sola solicitud (detrás de un ingress que cancelaría por timeout) igualmente finaliza. La CLI lo inicia y luego muestra su progreso (archivos listados, filas leídas, tablas completadas y cualquiera que no se haya podido leer) hasta que concluye. Con la [cola de trabajos (job queue)](/docs/backend/jobs/) activa, el escaneo es un trabajo `storage.orphans` que ejecutan los workers de trabajos. Sin ella, el escaneo se ejecuta dentro del proceso del servidor al que se le solicitó, y la CLI lo indica: reiniciar ese proceso detiene el escaneo. Un escaneo es un intento de trabajo, limitado por `jobs.timeoutMs` (15 minutos por defecto). Auméntalo, o establécelo en 0, para una fuente que requiera más tiempo. `--json` imprime el mismo informe que antes, más su `scanId`.

`--delete` pregunta antes de eliminar (`--yes` omite la pregunta y es obligatorio si no hay terminal). Elimina únicamente a partir del escaneo recién impreso y solo dentro de los 15 minutos posteriores a la finalización de dicho escaneo. No se elimina nada mientras no se pueda leer una tabla: una tabla con hooks de lectura en una base de datos cuyo controlador (driver) no pueda leer a través de ellos cuenta como no leída. Antes de eliminar nada, el servidor vuelve a leer cada fila y entrada del historial frente a los archivos listados. Luego vuelve a verificar cada archivo justo antes de eliminarlo. Un archivo al que ahora haga referencia una fila, que se haya subido de nuevo desde el escaneo o que haya desaparecido, se conserva, y la CLI lo muestra como conservado. Los archivos que solo son referenciados por tablas que Rebase no sirve parecerán no utilizados: compruébalo antes de eliminar. Frente a un backend de 0.25.1 o anterior, la CLI escanea a la manera antigua, dentro de una sola solicitud.

`move` copia los archivos bajo `--prefix` a otra fuente bajo las mismas claves, una página a la vez. Se omite cualquier archivo que el destino ya contenga con el mismo tamaño, de modo que una transferencia detenida se reanuda ejecutándola nuevamente; `--delete-source` elimina cada archivo de la fuente una vez que el destino lo contiene, y se rechaza cuando las dos fuentes almacenan en el mismo bucket o directorio. Una vez completado el traslado, la CLI lista la fuente nuevamente con una nueva inspección y nombra cada archivo que el movimiento no trasladó: con `--delete-source`, cualquier archivo que aún permanezca en la fuente; sin él, cualquier archivo del cual el destino no conserve una copia con el mismo tamaño. Sale con código 1 cuando existe alguno, y ejecutar el mismo movimiento de nuevo lo procesa. `--json` los imprime como `notMoved`. Leer el informe de un escaneo requiere `database:read`. Iniciar un escaneo, eliminar y mover requieren `database:write`, que posee la clave de servicio.

### `rebase skills install`

Instala las habilidades de referencia de Rebase para tus asistentes de codificación de IA —cada `--agent` mencionado anteriormente:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulta las [Habilidades de agentes](/docs/ai/skills) para ver la lista completa y dónde se escriben los archivos.

`--hooks` instala la protección (guardrail) de Claude Code que `rebase init` incluye con cada proyecto: `.claude/hooks/post-edit-collection.sh`, registrado como un hook `PostToolUse` en `.claude/settings.json`, el cual ejecuta `rebase verify --quiet` después de cada edición bajo `backend/schema/` o `frontend/src/cms/` y devuelve cualquier problema al agente. Se conservan las configuraciones y los hooks existentes. `rebase skills --hooks` instala únicamente el hook.

### `rebase telemetry`

Envío anónimo de uso, desactivado hasta que digas que sí. Un `rebase init` interactivo pregunta al final, y la respuesta por defecto es no, por lo que no se comparte nada a menos que respondas afirmativamente. La respuesta es por máquina (`~/.rebase/telemetry.json`): tras un sí, `init` nunca vuelve a preguntar, y tras un no, el siguiente `init` preguntará de nuevo. Cada checkout obtiene un ID de proyecto aleatorio, guardado en su `.rebase/telemetry-project.json` ignorado por git.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` imprime la configuración actual, `show` imprime exactamente lo que se enviaría —esté o no activado el uso compartido, para que puedas revisar el contenido antes de decidir— y las otras dos opciones la modifican. Si nunca ejecutaste `init`, nunca se recopiló nada.

## Próximos pasos

- **[Generación de esquemas](/docs/cli/schema/#production-workflow)** — El flujo de trabajo de migración, desde la edición de una tabla hasta producción
- **[Esquema como código](/docs/architecture/schema-as-code)** — Cómo funciona la generación de esquemas
- **[Guía de inicio rápido](/docs/getting-started/quickstart)** — Empieza ahora
