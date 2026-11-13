---
sourceHash: 43fd981d241b2237
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecta Claude Code, Cursor, Gemini CLI o cualquier cliente MCP a un proyecto Rebase — las 53 herramientas que expone, la credencial con la que se autentica y la compuerta de loopback que se interpone entre un agente y producción.
---

`@rebasepro/mcp` es un servidor de [Model Context Protocol](https://modelcontextprotocol.io)
que proporciona a un asistente de IA herramientas reales sobre un proyecto Rebase:
leer y escribir filas, administrar usuarios, ejecutar migraciones, invocar funciones
y controlar el servidor de desarrollo.

Se comunica mediante MCP **únicamente a través de stdio**. No hay ningún puerto ni
listener — el proceso es tan confiable como lo que sea que lo haya generado, y no
hay ningún llamador remoto que autenticar. Esa es la parte segura. Las preguntas
interesantes tratan sobre lo que hace *una vez* que se está ejecutando, y esta
página las responde antes de mostrarte el bloque de configuración.

Un backend desplegado también puede servir MCP por sí mismo, sobre HTTP, para las
personas que usan tu aplicación. Eso es algo diferente con un modelo de
credenciales distinto: consulta [El endpoint MCP remoto](/docs/ai/remote-mcp/).

:::tip[¿Usas Claude en la web, escritorio o móvil?]
Añade el [conector de Rebase](/docs/ai/rebase-connector/) en su lugar:
`https://app.rebase.pro/mcp`, una sola vez, para cada proyecto que ejecutes en
Rebase Cloud o en tus propios servidores. Esta página trata sobre el servidor
local que un asistente de código inicia dentro de un proyecto.
:::

## Conectar un cliente

El servidor se ejecuta desde tu proyecto: `@rebasepro/mcp` es una devDependency
que cada estructura de `rebase init` fija con la CLI, y cada bloque a
continuación —toda la integración— inicia esa copia (`pnpm exec rebase-mcp`, o
`npx --no rebase-mcp` en un proyecto npm), nunca una versión más reciente de npm.
Un proyecto anterior lo añade una vez, con `rebase skills install --mcp` o
`pnpm add -D @rebasepro/mcp`.

`rebase init` escribe el bloque para cada agente que elijas cuando
[configura tus agentes de código de IA](/docs/ai/skills#set-up-by-rebase-init),
manteniendo cualquier otro servidor que ya esté en el archivo.
`rebase init --agent cursor,codex` hace lo mismo sin preguntar.

**Claude Code** — `.mcp.json` en la raíz de tu proyecto. `rebase init` escribe este
archivo por ti:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Cursor** — la misma estructura, en `.cursor/mcp.json`. Cursor expande
`${workspaceFolder}` a la raíz del proyecto:

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

**Gemini CLI** — `.gemini/settings.json`, bajo la misma clave:

```json title=".gemini/settings.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**Codex CLI** — TOML en lugar de JSON, en el `.codex/config.toml` del proyecto.
Codex lee la configuración de un proyecto solo una vez que has marcado el
proyecto como confiable:

```toml title=".codex/config.toml"
[mcp_servers.rebase]
command = "pnpm"
args = ["exec", "rebase-mcp"]

[mcp_servers.rebase.env]
REBASE_PROJECT_DIR = "."
```

**Kiro** — `.kiro/settings/mcp.json`:

```json title=".kiro/settings/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "."
      }
    }
  }
}
```

**GitHub Copilot en VS Code** — `.vscode/mcp.json`, bajo `servers` y con
un transporte explícito:

```json title=".vscode/mcp.json"
{
  "servers": {
    "rebase": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

**Windsurf** lee los servidores MCP solo desde su configuración a nivel de
usuario, por lo que no hay ningún archivo de proyecto que escribir. Añade el
servidor en sus ajustes de MCP como `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, con
esa ruta como `REBASE_PROJECT_DIR`.

Cualquier cliente MCP que pueda iniciar un servidor stdio funciona; la
estructura es la misma.

### Sobre qué directorio actúa

`REBASE_PROJECT_DIR` es el directorio que contiene `rebase.json`. Hay **una**
precedencia, y es la misma en cada cliente:

1. **El bloque de entorno** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Si cualquiera de ellos está establecido, el proyecto
   `default` se reconstruye a partir de ellos en cada inicio.
2. **El directorio de trabajo del servidor**, cuando contiene un `rebase.json`.
   Un proyecto en el que te encuentras tiene prioridad sobre cualquier cosa
   recordada en `~/.rebase/projects.json`.
3. **El `default` persistido** en `~/.rebase/projects.json`, cuando ninguno de
   los dos primeros indica nada.

El autodescubrimiento desde `.rebase/state.json` llena los vacíos en los tres
casos y nunca anula un valor proporcionado por alguno de ellos.

Los bloques a nivel de proyecto nombran el proyecto — `"."`, el directorio de
trabajo del cliente, o el `${workspaceFolder}` del editor— porque la regla 3
lee un archivo compartido por todos los proyectos de la máquina. Una
configuración a nivel de usuario, como la de Windsurf, especifica una ruta
absoluta en su lugar.

## A qué puede acceder el servidor

Esta es la sección que debes leer antes de apuntar un asistente a una base de
datos que te importe.

El servidor lleva **una credencial ambiental para todo el proceso**. No hay
identidad por herramienta ni modo de solo lectura; cada herramienta utiliza el
mismo token, y el único interruptor en el paquete habilita (*opts in*) un mayor
alcance en lugar de uno menor.

Qué credencial es, en orden de prioridad:

1. `REBASE_API_TOKEN` desde el entorno. `REBASE_TOKEN` no se lee aquí: es el
   token del plano de control de la CLI, y nunca se envía a la aplicación (el
   servidor lo indica una vez en stderr cuando es el único configurado). Las
   herramientas cloud aún lo pasan a la CLI que generan, la cual lo envía al
   plano de control.
2. `REBASE_SERVICE_KEY` leído del `.env` del proyecto.
3. La clave de servicio descubierta automáticamente desde `.rebase/state.json`
   mientras `rebase dev` está en ejecución.

El 2 y el 3 son la clave del backend de desarrollo de esta máquina, utilizada
únicamente cuando el destino está en loopback. Cuando `REBASE_BASE_URL` apunta a
otro lugar —`rebase cloud init --claim` escribe la dirección del proyecto cloud,
y ningún `REBASE_API_TOKEN` hasta que un despliegue tenga éxito— el servidor no
envía ningún token y lo indica una vez en stderr.

Un token que registras para un proyecto **prevalece sobre el autodescubrimiento**.
El descubrimiento solo llena un vacío.

:::danger[La ruta zero-config es una credencial de administrador]
Las opciones 2 y 3 son la **clave de servicio** —un secreto de administrador sin
restricciones de alcance. El backend lo resuelve a `uid: "service"`,
`roles: ["admin"]`, `isAdmin: true`. Esa identidad posee todos los
[alcances (scopes)](/docs/backend/roles-and-scopes/), y cumple las políticas
`_default_admin_read` / `_default_admin_write` que Rebase inyecta en cada tabla
que no haya configurado `defaultPolicies: false`.

Por lo tanto, la respuesta honesta a "¿sigue RLS limitándolo?" es: RLS *se
ejecuta* —el controlador sí se degrada al rol `rebase_user`— y luego una
política que el propio Rebase escribió le concede todo a esa identidad. Leer cada
fila de cada tabla es el **comportamiento diseñado de la configuración
predeterminada**, no una omisión de seguridad (bypass).

Con la configuración zero-config, un agente que posea estas herramientas puede
leer y escribir cada fila de cada tabla, listar cada usuario, restablecer
cualquier contraseña, invocar cualquier función de backend y ejecutar DDL contra
cualquier `DATABASE_URL` que el proyecto resuelva.
:::

### Proporcionarle una credencial restringida en su lugar

Registra una [clave de API (API key)](/docs/backend/api-keys) con alcance y el
modelo de dos compuertas se aplicará de verdad. Una clave de servicio se ejecuta
con los roles `["service"]`, que las políticas de administrador inyectadas
**no** nombran —por lo que RLS no le otorga nada a menos que una de tus propias
políticas indique lo contrario, y sus alcances la restringen aún más:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Luego, entrega la clave `rk_live_…` resultante al servidor en lugar de permitirle
descubrir una clave de servicio:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "/absolute/path/to/your/project",
        "REBASE_API_TOKEN": "rk_live_..."
      }
    }
  }
}
```

Dos cosas que esto **no** hace, y que vale la pena saber antes de depender de
ello:

- **No restringe las herramientas de la CLI.** `rebase_db_push`,
  `rebase_db_migrate`, `rebase_doctor` y las herramientas de ramas (branch)
  ejecutan la CLI de Rebase, que se conecta con `DATABASE_URL` y nunca ve tu
  token en absoluto. La compuerta de loopback a continuación es lo único que se
  interpone frente a ellas.
- **Una clave solo accede a una herramienta de administración con el alcance de esa herramienta.**
  `list_users` y `list_roles` necesitan `users:read`; `create_user`,
  `update_user`, `delete_user` y `rebase_auth_reset_password` necesitan
  `users:write`; las herramientas de storage y cron necesitan el alcance
  `storage:*` o `cron:*` correspondiente; `invoke_function` necesita
  `functions:invoke`. Sin él, la llamada responde `403 SCOPE_MISSING`. Incluso
  con `users:write`, una clave no puede modificar la cuenta de un administrador:
  un administrador posee `keys:read` y `keys:write`, que ninguna clave puede
  tener, y nadie puede gestionar una cuenta que posea más privilegios que uno
  mismo.

Una clave creada con `--roles admin` es un asunto diferente: lleva los roles
`["service", "admin"]`, lo que supera las mismas políticas de administrador
predeterminadas que la clave de servicio. Si además le otorgas `--full-access`,
su alcance es el de la clave de servicio, excepto la gestión de claves. Lo que
añade es que es **revocable, expirable y limitada por tasa (rate-limited) por
clave**, nada de lo cual aplica a la clave de servicio —rotar esa implica editar
`.env` y reiniciar el servidor.

Consulta [Agentes y servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers)
para ver la guía completa sobre el alcance de claves.

### Poner una tabla completamente fuera de alcance

<span class="since-badge" data-since="0.31">Desde 0.31</span>

La razón por la cual una credencial de administrador lee todo es la política base
que Rebase inyecta en cada tabla, otorgando acceso al contexto del servidor de
confianza y al rol `admin`. Una tabla puede optar por no incluir esa base y
asumir la responsabilidad total de su propio RLS:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const medicalRecords = defineTable("medical_records", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        patientId: col.text(),
        notes:     col.text(),
    },
    // Remove the injected admin/server baseline — nothing is readable
    // except what the rules below allow.
    defaultPolicies: false,
    rls: [
        { operations: ["select", "update"], ownerField: "patientId" },
    ],
});
```

Ahora la única forma de acceder es coincidir con `patientId`. El uid de la clave
de servicio es la cadena literal `service`, por lo que una regla de propietario
nunca coincide con ella —las lecturas devuelven cero filas y las escrituras son
rechazadas por Postgres. Este es el único control que restringe la credencial
predeterminada del servidor MCP en lugar de darla por sentado.

Recuerda que este es un cambio real de RLS, no de documentación: surte efecto
solo una vez que `rebase schema generate` y una migración hayan aplicado las
políticas. Consulta [Seguridad a nivel de fila (Row-level security)](/docs/collections/security-rules).

## La compuerta de loopback

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`rebase_project_add` acepta cualquier `baseUrl`, y las herramientas de la CLI se
conectan con cualquier `DATABASE_URL` que declare el proyecto. Por lo tanto, la
misma lista de herramientas que edita una base de datos provisional en tu
portátil puede eliminar filas de producción, sin nada de por medio excepto el
criterio del asistente sobre qué proyecto está activo.

**Cualquier herramienta que modifique el entorno de destino es rechazada a menos que ese destino esté en la interfaz de loopback.**
La compuerta está escrita como una lista de lo que *no* está bloqueado, por lo
que una herramienta añadida posteriormente llega protegida de forma
predeterminada.

- **No bloqueadas — lecturas:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`,
  `query_table`, `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`,
  `cron_get_job_logs`, `rebase_dev_logs`, y las lecturas de Rebase Cloud
  `rebase_cloud_status`, `rebase_cloud_logs`, `rebase_cloud_env_list`,
  `rebase_cloud_deployments_list`.
- **No bloqueadas — escrituras en Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  El aprovisionamiento crea un proyecto; las demás modifican un proyecto de
  producción. Ninguna de ellas pasa por `baseUrl` o `DATABASE_URL`, que son todo
  lo que la compuerta puede verificar. Consulta [Rebase Cloud](#rebase-cloud)
  para ver qué se interpone ante ellas.
- **No bloqueadas — solo locales:** `rebase_schema_introspect`,
  `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, las herramientas del servidor de desarrollo y las
  herramientas del registro de proyectos. Estas escriben archivos locales o
  estado local y no tienen un destino remoto que verificar.
- **Bloqueadas según `DATABASE_URL`:** las herramientas restantes de la CLI —
  `rebase_db_push`, `rebase_db_migrate`, `rebase_db_branch_create`,
  `rebase_db_branch_delete`.
- **Bloqueadas según la `baseUrl` del proyecto:** las herramientas restantes del
  SDK — `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job` e
  `invoke_function`.

Los dos destinos no son intercambiables. Las herramientas de la CLI nunca ven
`baseUrl`, por lo que un backend en localhost junto a una `DATABASE_URL` de
producción se verifica contra la base de datos, no contra el backend.

Un rechazo se ve así:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si no se puede resolver ninguna cadena de conexión, las herramientas de base de datos bloqueadas se rechazan.**
Sin `DATABASE_URL`, la CLI utiliza la base de datos de desarrollo administrada,
que es la predeterminada para un proyecto nuevo, y la compuerta rechaza sus
cuatro herramientas de base de datos allí. El rechazo indica el motivo y señala
lo que funciona en su lugar. No sugiere la exclusión voluntaria:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Desde una terminal,
`rebase db push` y `rebase db migrate` sí se ejecutan en esa base de datos; solo
se rechazan las herramientas MCP.

Solo loopback cuenta como local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(y `0.0.0.0`).
Los rangos privados como `10.x` y `192.168.x` **no** —es tan probable que sean un
clúster de staging compartido como un ordenador portátil, y tratarlos como
locales permitiría exactamente el accidente que la compuerta existe para prevenir.

Establece `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para deshabilitar esta protección.
Establecerlo globalmente en la configuración de tu cliente MCP elimina la
compuerta para cada proyecto al que el servidor pueda acceder, no solo para el
que estabas considerando.

## Marcado de datos no confiables

Las filas, registros de usuario, listas de almacenamiento, trabajos cron,
respuestas de funciones y salidas de la CLI regresan envueltos en un envoltorio
explícito:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Cualquier cosa almacenada en tu base de datos fue escrita por alguien, y llega por
el mismo canal que el contrato de herramientas que el asistente está siguiendo.
El envoltorio le indica al modelo que lo trate como contenido inerte en lugar de
instrucciones.

El `id` se genera de nuevo para cada respuesta, después de que los datos fueron
escritos, y solo el marcador final que lo contiene cierra el bloque. El texto
dentro de los datos que tenga la forma de un marcador se interrumpe con un espacio
de ancho cero, por lo que una fila que imprima `<<<END_UNTRUSTED_DATA>>>` no puede
cerrar el envoltorio antes de tiempo y dejar lo que le sigue afuera.

El [endpoint remoto](/docs/ai/remote-mcp/) delimita los resultados de sus
herramientas de la misma manera y se lo notifica al cliente; su `structuredContent`
transporta el resultado sin formato. `list_tables` y `describe_table` son las
excepciones: solo un modelo las lee, por lo que se envían una sola vez, en el
texto.

Es un marcador, no un entorno aislado (sandbox). Un asistente que disponga de
estas herramientas es tan seguro como el contenido que le permitas leer.

## Múltiples proyectos

Las configuraciones de los proyectos se almacenan en `~/.rebase/projects.json`,
y el servidor puede albergar varios a la vez —útil cuando trabajas en entornos
locales y remotos. Mientras `rebase dev` está en ejecución, el servidor lee el
puerto activo y la clave de servicio desde `.rebase/state.json` en el directorio
del proyecto, que es lo que hace que el caso local no requiera configuración
(zero-config).

:::note[El registro es la última palabra, no la primera]
La precedencia es la indicada anteriormente: bloque de entorno, luego el
directorio de trabajo cuando contiene un `rebase.json`, luego el `default`
persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` y `REBASE_API_TOKEN` reconstruyen el
proyecto `default` **en cada inicio**, no solo en el primero. La reconstrucción
es de la entrada completa: un token registrado contra el antiguo `projectDir` se
descarta en lugar de llevarse a un directorio para el cual nunca fue emitido. Un
`default` derivado de esa manera —o desde el directorio de trabajo— nunca se
reescribe en `~/.rebase/projects.json`, por lo que la clave de servicio de
desarrollo de un proyecto no puede convertirse en la de otro.

`activeProject` es persistente, por lo que si una sesión anterior llamó a
`rebase_project_switch`, las herramientas tendrán como objetivo ese proyecto y
el servidor lo indicará en stderr —a menos que ese proyecto esté registrado bajo
un directorio *diferente* de aquel en el que se ejecuta este servidor, en cuyo
caso recurre a `default` y lo indica. Si un asistente parece estar leyendo la
base de datos incorrecta, llama primero a `rebase_project_current`.
:::

Los tokens se almacenan en ese registro **en texto plano**. Es un archivo en tu
directorio de inicio que contiene credenciales de administrador para cada
proyecto que hayas registrado; trátalo en consecuencia.

## Rebase Cloud

Ocho herramientas llevan una aplicación desde este directorio a un backend en vivo
en [Rebase Cloud](/docs/deployment/cloud/) y la mantienen funcionando. Cada una
genera `rebase cloud <command> --json` en el directorio del proyecto activo: el
mismo comando que ejecuta una persona, por lo que no hay una segunda
implementación que pueda diferir de ella.

| Herramienta | Ejecuta | Modifica el proyecto |
|---|---|---|
| `rebase_cloud_provision` | `rebase cloud init --claim` | Crea uno, sin cuenta |
| `rebase_cloud_status` | `rebase cloud status` | No |
| `rebase_cloud_deploy` | `rebase cloud deploy` | Sí |
| `rebase_cloud_logs` | `rebase cloud logs [--runtime]` | No |
| `rebase_cloud_env_list` | `rebase cloud env list` | No |
| `rebase_cloud_env_set` | `rebase cloud env set KEY --stdin` | Sí, a partir del próximo despliegue |
| `rebase_cloud_deployments_list` | `rebase cloud deployments list` | No |
| `rebase_cloud_rollback` | `rebase cloud rollback --yes` | Sí |
| `rebase_cloud_projects_list` | `rebase cloud projects list --all-orgs` | No |

El flujo habitual del agente es: `rebase_cloud_provision`, luego darle al usuario
la URL de reclamación (claim URL); `rebase_cloud_status` para ver el proyecto
(mientras no esté reclamado, `unclaimed` contiene la URL de reclamación y cuándo
se elimina); `rebase_cloud_deploy` después de un cambio; `rebase_cloud_logs`
cuando algo falla; y `rebase_cloud_rollback` cuando la producción está rota.

**Sobre qué actúan.** El proyecto al que está vinculado el directorio activo en
`.rebase/cloud.json`. Ninguna de ellas toma un id de proyecto ni un directorio,
por lo que un asistente no puede dirigirlas a otro proyecto que no sea aquel al
que está vinculado el directorio. Cambiar el proyecto activo con
`rebase_project_switch` cambia el directorio en el que se ejecutan.

**Bajo qué autoridad.** Lo que la CLI resuelva en ese directorio: `REBASE_TOKEN`
cuando esté configurado, luego el token que `rebase cloud init --claim` almacenó
para un proyecto no reclamado, luego la sesión de `rebase cloud login`. En el
directorio de ese proyecto no reclamado, un `REBASE_TOKEN` que no posea ningún
alcance en el proyecto se aparta en favor del propio token del proyecto. El plano
de control verifica cada llamada como verifica las de la CLI, por lo que con un
token creado mediante `rebase cloud tokens create --can logs` un asistente puede
leer registros, y el plano de control rechazará sus despliegues, variables y
reversiones (rollbacks). La ausencia de credenciales, o una rechazada, regresa
como un error que indica lo que el usuario debe hacer (`rebase cloud login` o
reclamar el proyecto).

**Por qué no aplica la compuerta de loopback.** La compuerta verifica la
`baseUrl` de la aplicación y la `DATABASE_URL` de la CLI; estas herramientas no
utilizan ninguna de las dos. Después de `rebase_cloud_provision`,
`REBASE_BASE_URL` apunta al nuevo proyecto en la nube, por lo que verificarlo
rechazaría el mismo despliegue que el flujo necesita. El aprovisionamiento en sí
solo crea: no toca ninguna aplicación o base de datos existente, y la CLI aún lo
rechaza en un directorio que ya está vinculado. Un despliegue, una variable y un
rollback modifican la producción cada uno. Lo que se interpone ante ellos es la
credencial mencionada anteriormente y la aprobación de herramientas de tu cliente
MCP. Para evitar que un asistente modifique un proyecto cloud, configura
`REBASE_TOKEN` en el entorno del servidor con un token que no tenga las
capacidades `deploy` y `env`.

**Leer cualquiera de tus proyectos.** Las herramientas anteriores actúan sobre el
proyecto vinculado. Para leer los datos de otro —cualquier proyecto en cualquier
organización a la que pertenezca la cuenta que inició sesión, vinculado aquí o
no—, `rebase_cloud_projects_list` los lista y `rebase_project_use_cloud` (con un
id, slug o nombre) dirige las herramientas de datos y administración hacia él:
`query_table`, `get_row`, `list_users`, `list_roles`, `cron_list_jobs`,
`storage_list_objects`. Esas llamadas pasan a través del proxy de Studio de la
consola, portando la credencial propia de la CLI (`rebase cloud access-token`,
leída por llamada y nunca almacenada); el plano de control comprueba el acceso de
la persona y adjunta la clave de servicio del proyecto por su lado, por lo que
ninguna clave llega a la máquina. Un proyecto con Studio desactivado es rechazado,
y el conmutador lo indica. Es un destino remoto como cualquier otro, por lo que
las herramientas que modifican datos permanecen rechazadas allí a menos que
`REBASE_MCP_ALLOW_REMOTE_WRITES` esté configurado; `rebase_project_switch` regresa
al estado anterior.

Cada herramienta es una captura instantánea (snapshot):

- `rebase_cloud_logs` nunca sigue en tiempo real (follow). Su resultado incluye
  `nextSinceTime`; pásalo de vuelta como `since` para leer lo que vino después.
  Devuelve las últimas 200 líneas a menos que `tail` indique lo contrario.
  `source: "build"` devuelve el último registro de compilación en su lugar.
- `rebase_cloud_deploy` sigue el despliegue hasta el final y comprueba que la nueva
  versión responda. `wait: false` regresa tan pronto como se activa el despliegue.
  Nunca expulsa un proyecto del runtime administrado, nunca despliega una versión
  anterior del framework ni omite las comprobaciones de compilación: esas son
  decisiones del usuario, y un rechazo que requiera una lo indicará.
- `rebase_cloud_rollback` pasa `--yes`. La llamada a la herramienta es la
  confirmación, ya que no hay una terminal en la que preguntar.

`rebase_cloud_env_set` escribe el valor en la entrada estándar (stdin) de la
CLI, por lo que nunca está en una línea de comandos donde `ps` lo mostraría, y el
valor se elimina de cualquier cosa que la herramienta devuelva. Su resultado
indica lo que se almacenó (la clave, si es secreta, si hay un redespliegue
pendiente), nunca el valor. `rebase_cloud_env_list` lista solo claves. Una CLI más
antigua que `env set --stdin` es rechazada con un mensaje para actualizarla; el
valor no se envía de otra manera.

Los resultados regresan en el [envoltorio de datos no confiables](#marcado-de-datos-no-confiables),
detrás de una línea del servidor sobre qué hacer a continuación. Un rechazo es un
error de herramienta que lleva el código de la CLI, como `no_project`,
`token_rejected`, `managed_project` o `deploy_failed`. Cuando el servidor
reconoce el código, añade el siguiente paso y luego el propio mensaje de la CLI.
Cada herramienta comprueba sus argumentos contra el esquema que anuncia antes de
generar nada, y rechaza cualquier argumento que no declare.

## Referencia de herramientas

53 herramientas, en diez grupos: esquema y base de datos, planificación de
esquema, documentos, usuarios y roles, almacenamiento, cron, funciones, el
servidor de desarrollo, el registro de proyectos y Rebase Cloud.
Cada una, con lo que necesita y si la compuerta la rechaza contra un destino no
local, se encuentra en la [referencia de herramientas MCP](/docs/ai/mcp-tool-reference).

## Recursos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Más allá de las herramientas, el servidor expone recursos MCP para que un cliente
pueda obtener el contexto del proyecto sin gastar una llamada a una herramienta:

| URI | Descripción |
|---|---|
| `rebase://tables/{name}` | Código fuente TypeScript de la definición de una tabla (`defineTable`) |
| `rebase://schema` | El esquema generado de Drizzle (`schema.generated.ts`) |

Los archivos de tablas son los módulos del directorio de esquemas, aparte de su
`index.ts`: la clave `tables` de la aplicación de backend en `rebase.json`,
`backend/schema` de forma predeterminada, bajo el directorio del proyecto activo o
su `app/`.

`rebase://schema` se lista **solo si** el esquema generado existe.
`findBackendDir` busca `backend/` y luego `app/backend/` bajo el directorio del
proyecto activo, y lee `src/schema.generated.ts` de cualquiera que encuentre —por
lo que tanto el diseño generado por la plantilla como el de este monorepo
funcionan, y un proyecto organizado de una tercera manera, o uno que aún no haya
ejecutado `rebase schema generate`, simplemente no verá ofrecido el recurso.

## El endpoint remoto

Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, para las
personas que usan tu aplicación, conectándose cada una como ellas mismas bajo su
propia seguridad a nivel de fila. Eso tiene su propia página:
[El endpoint MCP remoto](/docs/ai/remote-mcp/).

## Configuración recomendada

- Apunta el servidor a un proyecto **local** y deja `REBASE_MCP_ALLOW_REMOTE_WRITES`
  sin configurar. La compuerta es lo más valioso del paquete.
- Para cualquier cosa remota, registra una **clave de API `rk_` con alcance limitado**
  en lugar de dejar que el autodescubrimiento entregue una clave de servicio.
- Comprueba `rebase_project_current` cuando la salida parezca incorrecta. El
  proyecto activo es persistente y vive fuera de tu repositorio.
- Trata `~/.rebase/projects.json` como un archivo de secretos.
