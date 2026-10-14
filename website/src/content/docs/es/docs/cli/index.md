---
sourceHash: 14d61f8d5b137ed3
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

O ejecuta cualquier comando sin instalarla: `pnpm dlx @rebasepro/cli <command>`.

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
| `--database-url <url>` | Usa una base de datos existente en lugar de la gestionada. <span class="since-badge" data-since="0.25">Desde 0.25</span> Debe ser una URL `postgres://` o `postgresql://`: cualquier otra cosa se rechaza antes de escribir un archivo, y el prompt interactivo vuelve a preguntar |
| `--introspect` | Genera colecciones a partir de esa base de datos. Implica `--template blank` y requiere `--install` |
| `--project <slug>` | Vincula el scaffold a un proyecto de Rebase Cloud |
| `--setup-key <key>` | La clave de un solo uso que autentica ese enlace |
| `-a, --agent <name>` | Configura agentes de programación de IA: las [skills](/docs/ai/skills) y el [servidor MCP](/docs/ai/mcp). Repetible o separado por comas — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Sin él, `init` pregunta y preselecciona los agentes instalados en la máquina; con `--yes`, ninguno |

### `rebase dev`

Inicia el servidor de desarrollo:

```bash
rebase dev
```

Inicia tanto el frontend como el backend con recarga en caliente (hot reloading), y regenera el esquema de Drizzle y los tipos del SDK (`generated/sdk/`) al inicio y en cada guardado de colecciones. En 0.23 solo regenera el esquema, y `rebase generate-sdk` queda a tu cargo.

Ambos puertos se derivan de la ruta del proyecto para que varios proyectos de Rebase puedan ejecutarse en paralelo. Utiliza las URLs que imprime `rebase dev`. Fija uno con `rebase dev --port 3001`.

### `rebase build`

Compila el proyecto en un bundle desplegable en `dist-bundle/`:

```bash
rebase build
```

El bundle es el artefacto que despliegas — la imagen del runtime lo carga, por lo que no hay que construir una imagen de aplicación propia. Flags útiles:

| Flag | Efecto |
|------|--------|
| `--output <dir>` (o `--out`) | Escribe el bundle en un lugar distinto a `dist-bundle/` (una aplicación a la vez) |
| `--vendor` | Siempre instala e incluye las dependencias del bundle |
| `--no-vendor` | Nunca empaqueta dependencias (no vendor); el pod las instala en el primer inicio |
| `--skip-type-check` | Omite la comprobación de tipos (más rápido, menos seguro) |
| `--no-static` | No integra el frontend en el bundle del backend (cada aplicación estática obtiene igualmente su propio bundle) |
| `--skip-static-build` | Integra el frontend como ya compilado, sin ejecutar su comando de compilación |

Las dependencias se empaquetan por defecto (vendored) para que el reinicio de un pod no conlleve una instalación de 35–55 segundos. Un árbol que supere los 200 MB en disco se descarta en su lugar, ya que el límite de subida es de 100 MB comprimido — consulta el registro de cambios (changelog) para conocer el motivo.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Cada aplicación estática que
lleva el bundle recibe una copia brotli (`.br`) y otra gzip (`.gz`) junto a cada
recurso con hash de contenido de 1 KB o más — los archivos que un navegador guarda en
caché durante un año. El runtime envía la que el navegador acepta, así que esos archivos no
cuestan trabajo de compresión por solicitud, tampoco en la primera visita tras un
despliegue, y los navegadores que aceptan brotli la reciben (alrededor de un 11 % más
pequeña que gzip en el JavaScript del administrador). La salida de compilación de tu propio
frontend se deja como estaba; solo cambia la copia dentro del bundle. En la aplicación de
ejemplo esto añade menos de un segundo a la compilación y unos 2,4 MB al bundle.

### `rebase upgrade`

Actualiza cada paquete `@rebasepro/*` que fija el proyecto a una única versión y, a continuación, instala con el gestor de paquetes indicado por su archivo lockfile. `rebase upgrade` toma la última versión; `--to 0.21.0` una versión exacta, sin búsqueda en el registro; `--to canary` un dist-tag. Cada versión fijada en `dependencies`, `devDependencies` y `optionalDependencies`, en cada `package.json` del proyecto, conserva su `^` o `~`, y nada más en el archivo cambia. `peerDependencies` y las especificaciones `workspace:`, `link:`, `file:`, git y etiquetas se enumeran y se dejan intactas. Los overrides en `pnpm-workspace.yaml` y `package.json` también se actualizan, pero un override `link:` o `file:` prevalece sobre cualquier versión fijada: se informa al respecto y `--drop-local-overrides` lo elimina. `--dry-run` no escribe nada, `--no-install` omite la instalación y `--json` imprime un único documento.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Un proyecto en una prerelease, como un canary, se queda en su canal salvo que `latest` sea más reciente. Un dist-tag que movería una versión fijada hacia atrás se rechaza (`downgrade_refused` con `--json`) salvo que pases `--allow-downgrade`; un `--to` exacto se aplica, y se marca como una degradación. En la 0.24, `rebase upgrade` toma `latest` sin más.

### `rebase start`

Ejecuta el bundle compilado tal y como lo ejecuta un despliegue:

```bash
rebase start
```

Lee `PORT` y el resto de `.env`, a diferencia de `rebase dev`, en el `NODE_ENV` que definan. Un `.env` recién generado por el scaffold indica `development`, por lo que la primera cuenta que se registre sigue convirtiéndose en administradora, y `rebase start` lo indica al principio; define `NODE_ENV=production` para un servidor de producción. `rebase start --bundle ./dist-bundle` ejecuta un bundle en otra ubicación.

`rebase start` no inicia ninguna base de datos, y el `.env` del scaffold no tiene `DATABASE_URL`, así que una ejecución local sobre la base de datos que usa `rebase dev` es `DATABASE_URL="$(rebase db url)" rebase start`. <span class="since-badge" data-since="0.25">Desde 0.25</span> Sin una, imprime esa línea antes de arrancar; en la 0.24 el runtime se detiene con "DATABASE_URL: is required".

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

<span class="since-badge" data-since="0.25">Desde 0.25</span> El servidor ejectado guarda las subidas locales en el `uploads/` del proyecto, ejecutado desde el código fuente o compilado, como hace `rebase dev`. Se ejecuta en `backend/`, así que un `STORAGE_PATH` relativo allí se lee desde `backend/`. En la 0.24 el servidor compilado usa `backend/dist/uploads`, que borra la siguiente compilación.

### `rebase schema generate`

Genera el esquema de Drizzle ORM a partir de tus colecciones TypeScript:

```bash
rebase schema generate
```

Esto lee tus colecciones desde `config/collections/` y genera `backend/src/schema.generated.ts` con definiciones de tablas, enums y relaciones de Drizzle.

### `rebase schema stale`

```bash
rebase schema stale          # name what differs from the collections, exit 1 if anything does
rebase schema stale --fix    # regenerate backend/src/schema.generated.ts instead
```

`rebase dev` mantiene el archivo al día por sí mismo, así que esta es la comprobación para una compilación o un paso de CI. Consulta [Generación de esquemas](/docs/cli/schema/#rebase-schema-stale).

### `rebase db`

```bash
rebase db push                 # apply the collections to the database (development)
rebase db generate             # write a SQL migration file
rebase db migrate              # apply the pending migrations
rebase db url                  # print the connection string this project uses
rebase db pull --from <url>    # copy another database into the local one
rebase db backup               # pg_dump; db backups list and db restore beside it
rebase db branch create <name> # a copy to work on; switch, list and prune it too
rebase db stop                 # stop the managed development database
rebase db reset                # delete it and start over
```

Cada uno está en [Comandos de base de datos](/docs/cli/database/), con el orden en el que un comando elige su base de datos; `push`, `generate` y `migrate` se tratan en profundidad en [Generación de esquemas](/docs/cli/schema/).

### `rebase console`

<span class="since-badge" data-since="0.25">Desde 0.25</span>

Un REPL de Node con los datos del proyecto abiertos, o un solo fragmento ejecutado con `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) y `collections` están en
el ámbito, y `await` de nivel superior funciona. La base de datos se resuelve como
la resuelve `rebase db push`, y abrirla no cambia nada en ella. Con `-e`, el resultado
esperado (con `await`) se imprime como JSON en stdout y un `throw` termina con código `1`. Flags: `--eval`/`-e`,
`--collections`/`-c`, `--database-url`, `--docker`. Consulta
[Scripts y la consola](/docs/backend/scripts/).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` no recibe nombre: infiere todas las apps del proyecto y escribe el `rebase.json` completo, y se niega a reemplazar uno que exista salvo que pases `--force`.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Un argumento de nombre se rechaza. `--force` conserva, del archivo que reemplaza, lo que la inferencia no puede saber: el nombre de cada app, su `path` y su ruta `cms`. Todo lo demás se infiere de nuevo, y una app declarada que ya no encuentra se nombra como eliminada, de modo que en un scaffold vuelve a escribir el `rebase.json` que entregó el scaffold. El comando de compilación de la app estática usa el gestor de paquetes del proyecto. En la 0.24 el nombre se ignora, y `--force` escribe la inferencia pura: la app estática pasa a ser `web`, compilada con `npm run build --workspace frontend`.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Para un checkout no vinculado a un proyecto de Cloud, `apps config` da la URL del backend tal como la sirve `rebase dev`. En la 0.24 imprime `http://localhost:3001`.

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

`rebase resources --check` es el flag que usa un trabajo de CI para fallar en caso de que `rebase.resources.json` ya no coincida con el código de configuración. <span class="since-badge" data-since="0.25">Desde 0.25</span> `--json` se combina con él: ante una desviación, `rebase resources --check --json` termina con código 1 con un contenedor de error (`resource_graph_missing` o `resource_graph_stale`), y si todo va bien el grafo lleva `check.status`. `--write --json` escribe el archivo e informa `written.changed`. En la 0.24 `--json` imprimía el grafo e ignoraba ambos flags.

Un recurso se declara en el código de configuración — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — o es un archivo bajo `backend/crons` o `backend/functions`, y nunca se escribe a mano en `rebase.resources.json`, el cual se genera a partir de esas declaraciones para que un host pueda leer lo que necesita un proyecto sin compilarlo. Cada entrada registra quién lo utiliza (`collection:events`, `property:posts.cover`, `function:report`).

Un backend también cuenta con una base de datos predeterminada y un origen de almacenamiento predeterminado que nadie declara. Ambos se enumeran aquí, marcados como `implicit`, y ninguno se escribe en `rebase.resources.json` — el host los proporciona, por lo que registrarlos solicitaría el aprovisionamiento de algo que nadie pidió.

Para ver lo que la plataforma mantiene para un proyecto en comparación con lo que declara su código, y para eliminar una base de datos aprovisionada que el código ya no menciona, consulta [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — todos los comandos de Rebase Cloud: autenticación, vinculación de proyectos, despliegues, configuración, bases de datos, recursos, cómputo y más — tiene [su propia página](/docs/cli/cloud).

### `rebase generate-sdk`

Genera un SDK tipado a partir de las definiciones de tus colecciones:

```bash
rebase generate-sdk
```

Crea tipos de TypeScript y un cliente con tipado seguro para todas tus colecciones.

`--register` también tipa los datos del lado del servidor: escribe los tipos y la
declaración `Register` en `config/generated/`, y recuerda la elección en
`rebase.json` (`registerDatabase`), de modo que las siguientes ejecuciones, `rebase dev`
y los clones nuevos los mantienen al día.
Consulta [Datos tipados en el servidor](/docs/backend/typed-server-data).

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

Gestiona las API keys de servicio del proyecto — la credencial que utiliza un agente, script u otro servicio, a diferencia de la sesión de un usuario final:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` nombra lo que la clave puede hacer, separado por comas o repetido; `--full-access` le da todos los alcances que tiene la clave de servicio excepto `keys:*`. `--roles` añade roles de RLS además de `service`, `--expires-in` recibe días y `--expires-at` una fecha ISO. `rebase api-keys scopes` lista todos los alcances que conoce el backend. Una clave solo se muestra una vez.

Las claves cuentan con doble validación: se aplican tanto los alcances de la clave como la seguridad a nivel de fila (RLS) de la identidad bajo la que actúa. Consulta [Claves de API](/docs/backend/api-keys/).

### `rebase storage`

<span class="since-badge" data-since="0.25">Desde 0.25</span> Mantenimiento de todo el almacén
de archivos guardados, a través del backend en ejecución con
`REBASE_SERVICE_KEY` de `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` lee cada fila de cada colección, incluidas las eliminadas lógicamente, y
lista los archivos de un origen (`--source`, el origen por defecto si se omite)
que ninguna cadena de ninguna fila nombra: una clave, una URL, una referencia
`rebase-storage:` en un texto. Los archivos más recientes que `--older-than` horas (24 por defecto) se
dejan fuera, porque el panel de administración sube un archivo antes de que se guarde la fila que lo nombra.
`--delete` pregunta antes de eliminar (`--yes` omite la pregunta, y es obligatorio
sin terminal), el servidor vuelve a buscar primero los archivos, y no se
elimina nada mientras una colección no se pueda leer. Los archivos que solo nombran tus propias tablas
fuera de las colecciones parecen sin uso: comprueba antes de eliminar.

`move` copia los archivos bajo `--prefix` a otro origen con las mismas claves,
una página cada vez. Un archivo que el destino ya tiene con el mismo tamaño se omite,
así que un traslado interrumpido se reanuda ejecutándolo de nuevo; `--delete-source` elimina cada
archivo del origen una vez que el destino lo tiene. Ambos necesitan `database:read`, y
eliminar o trasladar `database:write`, que la clave de servicio tiene.

### `rebase skills install`

Instala las skills de referencia de Rebase para tus asistentes de programación con IA — todos los `--agent` mencionados anteriormente:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulta [Skills del agente](/docs/ai/skills) para ver la lista completa y dónde se escriben los archivos.

### `rebase telemetry`

Envío anónimo de datos de uso, desactivado hasta que digas que sí. Un `rebase init` interactivo pregunta al final, y la opción predeterminada es negativa, así que no se comparte nada salvo que respondas que sí. La respuesta es por máquina (`~/.rebase/telemetry.json`): tras un sí, `init` no vuelve a preguntar, y tras un no, el siguiente `init` vuelve a preguntar. Cada checkout recibe un id de proyecto aleatorio, guardado en su `.rebase/telemetry-project.json`, ignorado por git. <span class="since-badge" data-since="0.25">Desde 0.25</span> En la 0.24 la opción predeterminada es sí, y el id de proyecto cambia en cada reinicio de `rebase dev`.

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
