---
sourceHash: 4b515c5100c1fcb5
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecta Claude Code, Cursor, Gemini CLI o cualquier cliente MCP a un proyecto de Rebase — las 53 herramientas que expone, la credencial con la que se autentica y la compuerta de loopback que se interpone entre un agente y producción.
---

`@rebasepro/mcp` es un servidor de [Model Context Protocol](https://modelcontextprotocol.io)
que entrega a un asistente de IA herramientas reales sobre un proyecto de Rebase: leer y
escribir filas, gestionar usuarios, ejecutar migraciones, invocar funciones, controlar el servidor
de desarrollo.

Se comunica mediante MCP **únicamente a través de stdio**. No hay puerto ni listener; el
proceso es exactamente tan confiable como lo que sea que lo haya iniciado, y no hay un llamador
remoto al que autenticar. Esa es la parte segura. Las preguntas interesantes giran en torno
a lo que hace *una vez* que se está ejecutando, y esta página las responde antes de
mostrarte el bloque de configuración.

Un backend desplegado también puede servir MCP por sí mismo, sobre HTTP, para las personas que usan
tu aplicación. Eso es algo diferente con un modelo de credenciales distinto:
consulta [El endpoint MCP remoto](/docs/ai/remote-mcp/).

:::tip[¿Usas Claude en la web, escritorio o móvil?]
Añade el [conector de Rebase](/docs/ai/rebase-connector/) en su lugar:
`https://app.rebase.pro/mcp`, una sola vez, para cada proyecto que ejecutes en Rebase Cloud
o en tus propios servidores. Esta página trata sobre el servidor local que un asistente de código inicia
dentro de un proyecto.
:::

## Conectar un cliente

El servidor se ejecuta desde tu proyecto: `@rebasepro/mcp` es una devDependency que cada
plantilla de `rebase init` fija con la CLI, y cada bloque a continuación —toda la
integración— inicia esa copia (`pnpm exec rebase-mcp`, o `npx --no rebase-mcp`
en un proyecto npm), nunca una más reciente de npm. Un proyecto más antiguo la añade una vez,
con `rebase skills install --mcp` o `pnpm add -D @rebasepro/mcp`.

`rebase init` escribe el bloque para cada agente que elijas cuando
[configura tus agentes de codificación con IA](/docs/ai/skills#set-up-by-rebase-init), manteniendo
cualquier otro servidor que ya esté en el archivo. `rebase init --agent cursor,codex` hace
lo mismo sin preguntar.

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
Codex lee la configuración de un proyecto solo una vez que has confiado en el proyecto:

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

**Windsurf** lee los servidores MCP solo desde su configuración a nivel de usuario, por lo que no hay
un archivo de proyecto que escribir. Añade el servidor en sus ajustes de MCP como `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, con esa ruta como `REBASE_PROJECT_DIR`.

Cualquier cliente MCP que pueda iniciar un servidor stdio funciona; la estructura es la misma.

### En qué directorio actúa

`REBASE_PROJECT_DIR` es el directorio que contiene `rebase.json`. Hay **una**
precedencia, y es la misma en cada cliente:

1. **El bloque de entorno** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Si alguno de ellos está establecido, el proyecto `default` se reconstruye
   a partir de ellos en cada inicio.
2. **El directorio de trabajo del servidor**, cuando contiene un `rebase.json`. Un proyecto
   en el que estás situado tiene prioridad sobre cualquier cosa recordada en `~/.rebase/projects.json`.
3. **El `default` persistido** en `~/.rebase/projects.json`, cuando ninguno de los
   dos primeros indica nada.

El autodescubrimiento desde `.rebase/state.json` llena vacíos en los tres casos y nunca
anula un valor que alguno de ellos haya proporcionado.

Los bloques a nivel de proyecto nombran el proyecto — `"."`, el directorio de trabajo del cliente
o el `${workspaceFolder}` del editor — porque la regla 3 lee un archivo
compartido por cada proyecto en la máquina. Una configuración a nivel de usuario, como la de Windsurf,
indica en su lugar una ruta absoluta.

## Qué puede alcanzar el servidor

Esta es la sección que debes leer antes de apuntar un asistente a una base de datos que te importe.

El servidor lleva **una credencial ambiental para todo el proceso**. No hay
identidad por herramienta ni modo de solo lectura; cada herramienta utiliza el mismo token, y la
única opción en el paquete es para *habilitar* más alcance en lugar de menos.

Qué credencial es esa, en orden de prioridad:

1. `REBASE_API_TOKEN` del entorno. `REBASE_TOKEN` no se lee aquí:
   es el token del plano de control de la CLI y nunca se envía a la aplicación (el
   servidor lo advierte una vez en stderr cuando es el único establecido). Las herramientas de la nube
   aún lo pasan a la CLI que generan, la cual lo envía al plano de control.
2. `REBASE_SERVICE_KEY` leída del archivo `.env` del proyecto.
3. La service key autodescubierta desde `.rebase/state.json` mientras `rebase dev`
   está en ejecución.

2 y 3 son la clave del backend de desarrollo de esta máquina, utilizada solo cuando el destino está en
loopback. Cuando `REBASE_BASE_URL` apunta a otro lugar —`rebase cloud init --claim`
escribe la dirección del proyecto en la nube, y ningún `REBASE_API_TOKEN` hasta que un despliegue
tenga éxito— el servidor no envía ningún token y lo advierte una vez en stderr.

Un token que registres para un proyecto **se impone sobre el autodescubrimiento**. El descubrimiento solo
llena un vacío.

:::danger[La ruta zero-config es una credencial de administrador]
Las opciones 2 y 3 son la **service key** — un secreto de administración sin ámbito restringido. El backend
lo resuelve como `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Esa
identidad posee todos los [scopes](/docs/backend/roles-and-scopes/), y satisface las
políticas `_default_admin_read` / `_default_admin_write` que Rebase inyecta en
cada colección que no haya establecido `disableDefaultPolicies`.

Así que la respuesta honesta a "¿sigue RLS limitándolo?" es: RLS *se ejecuta* —el
driver sí degrada al rol `rebase_user`— y luego una política escrita por el propio Rebase
otorga a esa identidad todo. Leer cada fila de cada
colección es el **comportamiento diseñado de la configuración por defecto**, no una
omisión o bypass.

Con la configuración zero-config, un agente que posea estas herramientas puede leer y escribir cada
fila de cada colección, listar todos los usuarios, restablecer cualquier contraseña, invocar cualquier función
del backend y ejecutar DDL contra cualquier `DATABASE_URL` que resuelva el proyecto.
:::

### Darle una credencial restringida en su lugar

Registra una [API key](/docs/backend/api-keys) con ámbito y el modelo de dos compuertas
se aplica de verdad. Una service key se ejecuta con los roles `["service"]`, los cuales las
políticas de administrador inyectadas **no** nombran —por lo que RLS no le otorga nada a menos que una de
tus propias políticas indique lo contrario, y sus scopes la restringen aún más:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Luego entrega la clave `rk_live_…` resultante al servidor en lugar de dejar que
descubra una service key:

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

Dos cosas que esto **no** hace, y que vale la pena conocer antes de confiar en ello:

- **No restringe las herramientas de la CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` y las herramientas de ramas (branches) ejecutan la CLI de Rebase, la cual se conecta con
  `DATABASE_URL` y nunca ve tu token en absoluto. La compuerta de loopback a continuación es lo
  único que se interpone frente a ellas.
- **Una clave solo accede a una herramienta de administrador con el scope de esa herramienta.** `list_users` y
  `list_roles` necesitan `users:read`; `create_user`, `update_user`, `delete_user` y
  `rebase_auth_reset_password` necesitan `users:write`; las herramientas de almacenamiento y cron
  necesitan el scope correspondiente `storage:*` o `cron:*`; `invoke_function` necesita
  `functions:invoke`. Sin
  él, la llamada responde `403 SCOPE_MISSING`. Incluso con `users:write`, una clave no puede
  modificar la cuenta de un administrador: un administrador posee `keys:read` y `keys:write`, algo que ninguna
  clave puede tener, y nadie puede gestionar una cuenta que posea más privilegios que los propios.

Una clave creada con `--roles admin` es un asunto diferente: lleva los roles
`["service", "admin"]`, lo que cumple las mismas políticas de administrador predeterminadas que la service
key. Si además le das `--full-access`, su alcance es el de la service key,
salvo la gestión de claves. Lo que añade es que es **revocable, con fecha de caducidad y
con límite de tasa por clave**, nada de lo cual aplica a la service key —rotar esa
implica editar `.env` y reiniciar el servidor.

Consulta [Agentes y servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers) para ver la
guía completa sobre el alcance de claves.

### Poner una colección completamente fuera de alcance

La razón por la que una credencial de administrador lee todo es la política base que Rebase
inyecta en cada colección, otorgando el contexto de servidor confiable y el
rol `admin`. Una colección puede optar por no incluir esa base y asumir toda la
responsabilidad de su propia RLS:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const medicalRecordsCollection = defineCollection({
    slug: "medical_records",
    name: "Medical records",
    table: "medical_records",
    properties: {
        patient_id: { name: "Patient", type: "string" },
        notes: { name: "Notes", type: "string" }
    },
    // Remove the injected admin/server baseline — nothing is readable
    // except what the rules below allow.
    disableDefaultPolicies: true,
    securityRules: [
        { operations: ["select", "update"], ownerField: "patient_id" }
    ]
});
```

Ahora, la única forma de entrar es coincidir con `patient_id`. El uid de la service key es la
cadena literal `service`, por lo que una regla de propietario (owner) nunca coincide con él —las lecturas devuelven cero
filas y las escrituras son rechazadas por Postgres. Este es el único control que restringe
la credencial por defecto del servidor MCP en lugar de darla por asumida.

Recuerda que este es un cambio real de RLS, no documental: solo surte efecto
una vez que `rebase schema generate` y una migración hayan aplicado las políticas. Consulta
[Reglas de seguridad (RLS)](/docs/collections/security-rules).

## La compuerta de loopback

`rebase_project_add` acepta cualquier `baseUrl`, y las herramientas de la CLI se conectan con
cualquier `DATABASE_URL` que declare el proyecto. La misma lista de herramientas que edita una
base de datos de prueba en tu portátil puede, por lo tanto, eliminar filas de producción, sin nada
en medio excepto el criterio del asistente sobre qué proyecto está activo.

**Cualquier herramienta que modifique el entorno de destino es rechazada a menos que dicho destino esté
en la interfaz de loopback.** La compuerta está escrita como una lista de lo que *no* está
bloqueado, de modo que una herramienta añadida posteriormente llega protegida por defecto.

- **Sin bloqueo — lecturas:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, y las lecturas de Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Sin bloqueo — escrituras de Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  El aprovisionamiento crea un proyecto; las demás modifican un proyecto de producción. Ninguna
  de ellas pasa por `baseUrl` o `DATABASE_URL`, que es todo lo que la compuerta puede
  verificar. Consulta [Rebase Cloud](#rebase-cloud) para ver qué se interpone ante ellas.
- **Sin bloqueo — solo locales:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, las herramientas del servidor de desarrollo y las herramientas de registro de proyectos.
  Estas escriben archivos locales o estado local y no tienen un destino remoto que verificar.
- **Bloqueadas según `DATABASE_URL`:** las herramientas restantes de la CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Bloqueadas según la `baseUrl` del proyecto:** las herramientas restantes del SDK —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  e `invoke_function`.

Los dos destinos no son intercambiables. Las herramientas de la CLI nunca ven `baseUrl`, por lo que un
backend en localhost situado junto a una `DATABASE_URL` de producción se verifica contra
la base de datos, no contra el backend.

Un rechazo se ve así:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si no se puede resolver ninguna cadena de conexión, las herramientas de BD bloqueadas son rechazadas.**
Sin `DATABASE_URL`, la CLI utiliza la base de datos de desarrollo administrada, que es
la predeterminada para un proyecto nuevo, y la compuerta rechaza allí sus cuatro herramientas de base de datos.
El rechazo explica el motivo y nombra qué funciona en su lugar. No sugiere
la desactivación voluntaria:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the collections to that
database at boot, additively. After changing a collection, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Desde una terminal,
`rebase db push` y `rebase db migrate` sí se ejecutan en esa base de datos; solo las herramientas MCP
son rechazadas.

Solo el loopback cuenta como local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(y `0.0.0.0`).
Los rangos privados como `10.x` y `192.168.x` **no** lo hacen —esos tienen tantas probabilidades de ser
un clúster de staging compartido como un portátil, y tratarlos como locales daría
luz verde exactamente al accidente que la compuerta existe para evitar.

Establece `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desactivarla. Establecerlo globalmente en la
configuración de tu cliente MCP elimina la compuerta para cada proyecto que el servidor pueda alcanzar, no
solo para aquel en el que estabas pensando.

## Marcado de datos no confiables

Las filas, los registros de usuario, los listados de almacenamiento, los trabajos cron, las respuestas de funciones y la salida
de la CLI regresan envueltos en un contenedor explícito:

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Cualquier cosa almacenada en tu base de datos fue escrita por alguien, y llega a través del
mismo canal que el contrato de herramientas que el asistente está siguiendo. El contenedor le indica
al modelo que lo trate como contenido inerte en lugar de instrucciones.

El `id` se genera de forma nueva para cada respuesta, después de que los datos fueron escritos, y
solo el marcador final que lo lleva cierra el bloque. El texto dentro de los datos que tenga una
forma similar a la de un marcador se interrumpe con un espacio de ancho cero, de modo que una fila que imprima
`<<<END_UNTRUSTED_DATA>>>` no pueda cerrar el contenedor antes de tiempo y dejar lo que sigue
por fuera.

El [endpoint remoto](/docs/ai/remote-mcp/) delimita los resultados de sus herramientas de la misma
manera y se lo comunica al cliente; su `structuredContent` lleva el resultado plano.
`list_collections` y
`describe_collection` son las excepciones: solo un modelo las lee, por lo que se
envían una vez, en el texto.

Es un marcador, no un sandbox. Un asistente que tenga estas herramientas es tan seguro
como el contenido que le permitas leer.

## Múltiples proyectos

Las configuraciones de los proyectos se almacenan en `~/.rebase/projects.json`, y el servidor
puede albergar varios a la vez —útil cuando trabajas entre entornos locales
y remotos. Mientras `rebase dev` está en ejecución, el servidor lee el puerto activo y
la service key desde `.rebase/state.json` en el directorio del proyecto, que es lo que
hace que el caso local sea zero-config.

:::note[El registro es la última palabra, no la primera]
La precedencia es la indicada anteriormente: bloque de entorno, luego el directorio de trabajo
cuando contiene un `rebase.json`, luego el `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` y `REBASE_API_TOKEN` reconstruyen el
proyecto `default` **en cada inicio**, no solo en el primero. La reconstrucción es
de la entrada completa: un token registrado contra el antiguo `projectDir` se descarta en lugar
de trasladarse a un directorio para el cual nunca fue emitido. Un `default` derivado de esa
manera —o del directorio de trabajo— nunca se vuelve a escribir en
`~/.rebase/projects.json`, por lo que la service key de desarrollo de un proyecto no puede convertirse en
la de otro.

`activeProject` es persistente, por lo que si una sesión previa llamó a
`rebase_project_switch`, las herramientas apuntan a ese proyecto y el servidor lo advierte en
stderr —a menos que ese proyecto esté registrado bajo un directorio *diferente* al
que ejecuta este servidor, en cuyo caso recurre a `default` y lo
advierte. Si un asistente parece estar leyendo la base de datos equivocada, llama primero a
`rebase_project_current`.
:::

Los tokens se almacenan en ese registro **en texto plano**. Es un archivo en tu directorio
home que contiene credenciales de administrador para cada proyecto que hayas registrado; trátalo
en consecuencia.

## Rebase Cloud

Ocho herramientas llevan una aplicación desde este directorio hasta un backend activo en
[Rebase Cloud](/docs/deployment/cloud/) y la mantienen en funcionamiento. Cada una genera
`rebase cloud <command> --json` en el directorio del proyecto activo: el mismo
comando que ejecuta una persona, por lo que no hay una segunda implementación que pueda diferir de él.

| Herramienta | Ejecuta | Modifica el proyecto |
|---|---|---|
| `rebase_cloud_provision` | `rebase cloud init --claim` | Crea uno, sin cuenta |
| `rebase_cloud_status` | `rebase cloud status` | No |
| `rebase_cloud_deploy` | `rebase cloud deploy` | Sí |
| `rebase_cloud_logs` | `rebase cloud logs [--runtime]` | No |
| `rebase_cloud_env_list` | `rebase cloud env list` | No |
| `rebase_cloud_env_set` | `rebase cloud env set KEY --stdin` | Sí, a partir del siguiente despliegue |
| `rebase_cloud_deployments_list` | `rebase cloud deployments list` | No |
| `rebase_cloud_rollback` | `rebase cloud rollback --yes` | Sí |
| `rebase_cloud_projects_list` | `rebase cloud projects list --all-orgs` | No |

El flujo habitual del agente es: `rebase_cloud_provision`, luego entregar al usuario la
URL de reclamo (claim URL); `rebase_cloud_status` para ver el proyecto (mientras no esté reclamado,
`unclaimed` contiene la URL de reclamo y cuándo se elimina); `rebase_cloud_deploy`
después de un cambio; `rebase_cloud_logs` cuando algo falla; y
`rebase_cloud_rollback` cuando producción está rota.

**Sobre qué actúan.** El proyecto al que el directorio activo está vinculado en
`.rebase/cloud.json`. Ninguna de ellas toma un id de proyecto ni un directorio, por lo que un
asistente no puede apuntarlas a otro proyecto que no sea aquel al que el directorio está
vinculado. Cambiar el proyecto activo con `rebase_project_switch` cambia
el directorio en el que se ejecutan.

**Bajo qué autoridad.** Lo que sea que la CLI resuelva en ese directorio: `REBASE_TOKEN`
cuando está establecido, luego el token que `rebase cloud init --claim` almacenó para un
proyecto no reclamado, y luego la sesión de `rebase cloud login`. En el directorio de ese proyecto
no reclamado, un `REBASE_TOKEN` que no tenga ningún scope en el proyecto se reserva
para el token del propio proyecto. El plano de control
verifica cada llamada tal como verifica las de la CLI, por lo que con un token generado mediante
`rebase cloud tokens create --can logs`, un asistente puede leer logs, y el
plano de control rechaza sus despliegues, variables y rollbacks. Si no hay credencial o se rechaza,
regresa como un error que indica lo que el usuario debe hacer (`rebase cloud login` o reclamar el proyecto).

**Por qué no aplica la compuerta de loopback.** La compuerta verifica la `baseUrl` de la aplicación y
la `DATABASE_URL` de la CLI; estas herramientas no usan ninguna de las dos. Después de `rebase_cloud_provision`,
`REBASE_BASE_URL` apunta al nuevo proyecto en la nube, por lo que bloquear sobre ella rechazaría
el mismo despliegue que el flujo necesita. El aprovisionamiento en sí solo crea: no toca
ninguna aplicación o base de datos existente, y la CLI aún lo rechaza en un directorio que
ya está vinculado. Un despliegue, una variable y un rollback modifican
la producción. Lo que se interpone frente a ellos es la credencial mencionada anteriormente y
la aprobación de herramientas de tu cliente MCP. Para evitar que un asistente modifique un proyecto
en la nube, establece `REBASE_TOKEN` en el entorno del servidor con un token sin las
capacidades `deploy` y `env`.

**Leer cualquiera de tus proyectos.** Las herramientas anteriores actúan sobre el proyecto vinculado.
Para leer los datos de otro proyecto —cualquier proyecto en cualquier organización a la que pertenezca
la cuenta iniciada, vinculado aquí o no—, `rebase_cloud_projects_list` los lista
y `rebase_project_use_cloud` (con un id, slug o nombre) apunta las herramientas de datos y
administración hacia él: `list_documents`, `get_document`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Esas llamadas pasan a través del proxy de Studio de la
consola, llevando la credencial propia de la CLI (`rebase cloud access-token`, leída
por llamada y nunca almacenada); el plano de control verifica el acceso de la persona y
adjunta la service key del proyecto en su lado, por lo que ninguna clave llega a la máquina.
Un proyecto con Studio desactivado es rechazado, y el selector lo indica. Es un
destino remoto como cualquier otro, por lo que las herramientas que modifican datos permanecen rechazadas allí
a menos que se establezca `REBASE_MCP_ALLOW_REMOTE_WRITES`; `rebase_project_switch` regresa
al anterior.

Cada herramienta es una instantánea (snapshot):

- `rebase_cloud_logs` nunca hace seguimiento continuo (follow). Su resultado incluye `nextSinceTime`; pásalo
  de vuelta como `since` para leer lo que vino después. Devuelve las últimas 200 líneas a menos que
  `tail` indique lo contrario. `source: "build"` devuelve el último registro de compilación en su lugar.
- `rebase_cloud_deploy` sigue el despliegue hasta el final y verifica que la nueva
  versión responda. `wait: false` retorna tan pronto como se activa el despliegue.
  Nunca expulsa (eject) un proyecto del runtime administrado, ni despliega una versión anterior del framework,
  ni omite las comprobaciones de compilación: esas son decisiones del usuario, y un
  rechazo que necesite una de ellas lo indica.
- `rebase_cloud_rollback` pasa `--yes`. La llamada a la herramienta es la confirmación, ya que
  no hay terminal en la que preguntar.

`rebase_cloud_env_set` escribe el valor en la entrada estándar de la CLI, por lo que nunca
está en una línea de comandos donde `ps` lo mostraría, y el valor se elimina de
cualquier respuesta devuelta por la herramienta. Su resultado indica lo que se almacenó (la clave, si
es secreta, si hay un redespliegue pendiente), nunca el valor. `rebase_cloud_env_list`
lista solo claves. Una CLI anterior a `env set --stdin` es rechazada con un mensaje para
actualizarla; el valor no se envía de otra manera.

Los resultados regresan en el [contenedor de datos no confiables](#marcado-de-datos-no-confiables),
tras una línea del servidor sobre qué hacer a continuación. Un rechazo es un error de herramienta
que contiene el código de la CLI, como `no_project`, `token_rejected`,
`managed_project` o `deploy_failed`. Cuando el servidor reconoce el código,
añade el siguiente paso, seguido del propio mensaje de la CLI. Cada herramienta verifica sus argumentos
contra el esquema que publica antes de iniciar nada, y rechaza cualquier
argumento que no esté declarado.

## Referencia de herramientas

53 herramientas, en diez grupos: esquema y base de datos, planificación de esquemas, documentos, usuarios
y roles, almacenamiento, cron, funciones, el servidor de desarrollo, el registro de proyectos y
Rebase Cloud.
Cada una, con lo que necesita y si la compuerta la rechaza contra un destino
no local, se encuentra en la [referencia de herramientas MCP](/docs/ai/mcp-tool-reference).

## Recursos

Más allá de las herramientas, el servidor expone recursos MCP para que un cliente pueda obtener contexto
del proyecto sin gastar una llamada a herramienta:

| URI | Descripción |
|---|---|
| `rebase://collections/{name}` | Código fuente en TypeScript de la definición de una colección |
| `rebase://schema` | El esquema de Drizzle generado (`schema.generated.ts`) |

Las colecciones se descubren desde `app/config/collections/`,
`config/collections/` o `collections/` bajo el directorio del proyecto activo —
el que exista.

`rebase://schema` se lista **solo si** el esquema generado existe.
`findBackendDir` busca `backend/` y luego `app/backend/` bajo el directorio del proyecto
activo, y lee `src/schema.generated.ts` desde el que encuentre primero —
por lo que tanto la estructura predeterminada como la de este monorepo funcionan, y un proyecto estructurado de
una tercera forma, o uno que aún no haya ejecutado `rebase schema generate`, simplemente no
verá ofrecido el recurso.

## El endpoint remoto

Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, para las personas que usan
tu aplicación, cada una conectándose con su propia identidad bajo su propia seguridad
a nivel de fila (RLS). Eso tiene su propia página:
[El endpoint MCP remoto](/docs/ai/remote-mcp/).

## Configuración recomendada

- Apunta el servidor a un proyecto **local** y deja `REBASE_MCP_ALLOW_REMOTE_WRITES`
  sin definir. La compuerta es el elemento individual más valioso del paquete.
- Para cualquier entorno remoto, registra una **API key `rk_` con ámbito** en lugar de permitir
  que el descubrimiento proporcione una service key.
- Comprueba `rebase_project_current` cuando la salida parezca incorrecta. El proyecto activo es
  persistente y vive fuera de tu repositorio.
- Trata a `~/.rebase/projects.json` como un archivo de secretos.
