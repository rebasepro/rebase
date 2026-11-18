---
sourceHash: e0ed23817228dbd2
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecta Claude Code, Cursor, Gemini CLI o cualquier cliente MCP a un proyecto Rebase — las 53 herramientas que expone, la credencial con la que se autentica y la barrera loopback que se interpone entre un agente y producción.
---

`@rebasepro/mcp` es un servidor de [Model Context Protocol](https://modelcontextprotocol.io)
que proporciona a un asistente de IA herramientas reales sobre un proyecto Rebase: leer y
escribir filas, administrar usuarios, ejecutar migraciones, invocar funciones y controlar el
servidor de desarrollo.

Se comunica mediante MCP **únicamente a través de stdio**. No hay ningún puerto ni listener: el
proceso es exactamente tan confiable como aquello que lo inició, y no hay ningún llamador
remoto que autenticar. Esa es la parte segura. Las preguntas interesantes giran en torno a lo que
hace *una vez* que se está ejecutando, y esta página las responde antes de mostrarte el bloque
de configuración.

Un backend desplegado también puede servir MCP por sí mismo, a través de HTTP, para las personas que
usan tu aplicación. Eso es algo diferente con un modelo de credenciales distinto:
consulta [El endpoint MCP remoto](/docs/ai/remote-mcp/).

:::tip[¿Usas Claude en la web, escritorio o móvil?]
Añade el [conector de Rebase](/docs/ai/rebase-connector/) en su lugar:
`https://app.rebase.pro/mcp`, una sola vez, para cada proyecto que ejecutes en Rebase Cloud
o en tus propios servidores. Esta página trata sobre el servidor local que un asistente de código inicia
dentro de un proyecto.
:::

## Conectar un cliente

El servidor se ejecuta desde tu proyecto: `@rebasepro/mcp` es una devDependency que cada
estructura de `rebase init` fija con la CLI, y cada bloque a continuación (toda la
integración) inicia esa copia (`pnpm exec rebase-mcp`, o `npx --no rebase-mcp`
en un proyecto npm), nunca una más reciente de npm. Un proyecto más antiguo la añade una vez,
con `rebase skills install --mcp` o `pnpm add -D @rebasepro/mcp`.

`rebase init` escribe el bloque para cada agente que elijas cuando
[configura tus agentes de código de IA](/docs/ai/skills#set-up-by-rebase-init), conservando
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

**Codex CLI** — TOML en lugar de JSON, en el archivo `.codex/config.toml` del proyecto.
Codex lee la configuración de un proyecto solo una vez que has marcado el proyecto como confiable:

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
ningún archivo de proyecto que escribir. Añade el servidor en su configuración de MCP como `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, con esa ruta como `REBASE_PROJECT_DIR`.

Cualquier cliente MCP que pueda iniciar un servidor stdio funciona; la estructura es la misma.

### Sobre qué directorio actúa

`REBASE_PROJECT_DIR` es el directorio que contiene `rebase.json`. Existe **un**
orden de precedencia y es el mismo en todos los clientes:

1. **El bloque de entorno** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Si alguno de ellos está establecido, el proyecto `default` se reconstruye
   a partir de ellos en cada inicio.
2. **El directorio de trabajo del servidor**, cuando contiene un `rebase.json`. Un proyecto
   en el que te encuentras tiene prioridad sobre cualquier cosa guardada en `~/.rebase/projects.json`.
3. **El `default` persistido** en `~/.rebase/projects.json`, cuando ninguno de los
   dos primeros indica nada.

El autodescubrimiento a partir de `.rebase/state.json` llena vacíos en los tres casos y nunca
anula un valor proporcionado por uno de ellos.

Los bloques a nivel de proyecto nombran el proyecto (`"."`, el directorio de trabajo del cliente
o el `${workspaceFolder}` del editor) porque la regla 3 lee un archivo compartido
por todos los proyectos del equipo. Una configuración a nivel de usuario, como la de Windsurf,
especifica en su lugar una ruta absoluta.

## Qué puede alcanzar el servidor

Esta es la sección que debes leer antes de apuntar un asistente a una base de datos que te
importe.

El servidor cuenta con **una única credencial ambiental para todo el proceso**. No hay
identidad por herramienta ni modo de solo lectura; cada herramienta usa el mismo token, y el
único interruptor en el paquete sirve para optar por *más* alcance en lugar de menos.

Cuál es esa credencial, en orden de prioridad:

1. `REBASE_API_TOKEN` del entorno. `REBASE_TOKEN` no se lee aquí:
   es el token del plano de control de la CLI y nunca se envía a la aplicación (el
   servidor lo indica una vez en stderr cuando es el único establecido). Las herramientas de cloud
   aún lo pasan a la CLI que ejecutan, la cual lo envía al plano de control.
2. `REBASE_SERVICE_KEY` leído del archivo `.env` del proyecto
3. La service key autodescubierta a partir de `.rebase/state.json` mientras `rebase dev`
   está en ejecución

Los puntos 2 y 3 corresponden a la clave del backend de desarrollo de esta máquina, que solo se utiliza cuando el destino está en
loopback. Cuando `REBASE_BASE_URL` apunta a otro lugar (`rebase cloud init --claim`
escribe la dirección del proyecto en la nube, y ningún `REBASE_API_TOKEN` hasta que un despliegue
tenga éxito), el servidor no envía ningún token y lo indica una vez en stderr.

Un token que registres para un proyecto **tiene prioridad sobre el autodescubrimiento**. El descubrimiento solo
llena vacíos.

:::danger[La vía sin configuración es una credencial de administrador]
Las opciones 2 y 3 corresponden a la **service key** (clave de servicio), un secreto de administrador sin restricciones de alcance. El backend
lo resuelve como `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Esa
identidad posee todos los [scopes](/docs/backend/roles-and-scopes/) y cumple con las
políticas `_default_admin_read` / `_default_admin_write` que Rebase inyecta en
cada tabla que no haya configurado `defaultPolicies: false`.

Por lo tanto, la respuesta honesta a "¿sigue RLS limitándolo?" es: RLS *se ejecuta* (el
controlador sí pasa al rol `rebase_user`), y luego una política escrita por el
propio Rebase otorga todo a esa identidad. Leer cada fila de cada
tabla es el **comportamiento previsto de la configuración por defecto**, no una
vulneración.

Con la configuración inicial por defecto (zero-config), un agente que disponga de estas herramientas puede leer y escribir cada
fila de cada tabla, listar todos los usuarios, restablecer cualquier contraseña, invocar cualquier función
de backend y ejecutar DDL contra cualquier `DATABASE_URL` que resuelva el proyecto.
:::

### Proporcionarle una credencial restringida en su lugar

Registra una [API key](/docs/backend/api-keys) con alcance limitado y el modelo de dos barreras
se aplicará de verdad. Una service key se ejecuta con los roles `["service"]`, los cuales
las políticas de administración inyectadas **no** nombran; por lo tanto, RLS no le concede nada a menos que una de
tus propias políticas indique lo contrario, y sus scopes la limitan aún más:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Luego, entrega la clave `rk_live_…` resultante al servidor en lugar de dejar que
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

Dos cosas que esto **no** hace, y que conviene conocer antes de confiar en ello:

- **No restringe las herramientas de la CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` y las herramientas de ramas ejecutan la CLI de Rebase, la cual se conecta mediante
  `DATABASE_URL` y nunca ve tu token. La barrera loopback que se describe a continuación es lo
  único que se interpone ante ellas.
- **Una clave solo accede a una herramienta de administrador con el scope de esa herramienta.** `list_users` y
  `list_roles` requieren `users:read`; `create_user`, `update_user`, `delete_user` y
  `rebase_auth_reset_password` requieren `users:write`; las herramientas de almacenamiento y cron
  requieren el scope `storage:*` o `cron:*` correspondiente; `invoke_function` requiere
  `functions:invoke`. Sin
  él, la llamada responderá `403 SCOPE_MISSING`. Incluso con `users:write`, una clave no puede
  modificar la cuenta de un administrador: un administrador posee `keys:read` y `keys:write`, lo cual ninguna
  clave puede tener, y nadie puede administrar una cuenta que tenga más privilegios que los suyos.

Una clave creada con `--roles admin` es un asunto diferente: porta los roles
`["service", "admin"]`, lo que supera las mismas políticas de administración predeterminadas que la service
key. Otórgale también `--full-access` y su alcance será el de la service key,
salvo por la administración de claves. Lo que añade es que es **revocable, puede expirar y tiene límite de peticiones (rate limit) por clave**,
nada de lo cual aplica a la service key (rotarla implica editar `.env` y reiniciar el servidor).

Consulta [Agentes y servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers) para ver la
guía completa sobre el alcance de claves.

### Dejar una tabla completamente fuera de alcance

La razón por la que una credencial de administrador puede leerlo todo es la política base que Rebase
inyecta en cada tabla, otorgando acceso al contexto del servidor de confianza y al
rol `admin`. Una tabla puede optar por no incluir esa base y asumir la
total responsabilidad de su propio RLS:

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

Ahora, la única forma de acceder es coincidir con `patientId`. El uid de la service key es la
cadena literal `service`, por lo que una regla de propietario nunca coincidirá con ella: las lecturas devuelven cero
filas y Postgres rechaza las escrituras. Este es el único control que restringe
la credencial predeterminada del servidor MCP en lugar de darla por supuesta.

Recuerda que este es un cambio real de RLS, no documental: surte efecto
únicamente una vez que `rebase schema generate` y una migración hayan aplicado las políticas. Consulta
[Seguridad a nivel de fila (Row-level security)](/docs/collections/security-rules).

## La barrera loopback

`rebase_project_add` acepta cualquier `baseUrl`, y las herramientas de la CLI se conectan con
cualquier `DATABASE_URL` que declare el proyecto. La misma lista de herramientas que edita una
base de datos temporal en tu portátil puede, por tanto, eliminar filas de producción, sin nada
de por medio excepto el criterio del asistente sobre qué proyecto está activo.

**Cualquier herramienta que modifique el entorno de destino es rechazada a menos que dicho destino se encuentre en
la interfaz loopback.** La barrera está escrita como una lista de lo que *no*
está restringido, de modo que cualquier herramienta añadida posteriormente estará protegida de forma predeterminada.

- **No restringidas — lecturas:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `query_table`,
  `get_row`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, y las lecturas de Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **No restringidas — escrituras en Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  El aprovisionamiento crea un proyecto; las demás modifican un proyecto de producción. Ninguna
  de ellas pasa por `baseUrl` o `DATABASE_URL`, que es todo lo que la barrera puede
  comprobar. Consulta [Rebase Cloud](#rebase-cloud) para ver qué protección se interpone ante ellas.
- **No restringidas — solo locales:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, las herramientas del servidor de desarrollo y las herramientas de registro de proyectos.
  Estas escriben archivos locales o estado local y no tienen un destino remoto que comprobar.
- **Restringidas según `DATABASE_URL`:** el resto de las herramientas de la CLI: `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Restringidas según la `baseUrl` del proyecto:** el resto de las herramientas del SDK:
  `create_row`, `update_row`, `delete_row`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  e `invoke_function`.

Los dos destinos no son intercambiables. Las herramientas de la CLI nunca ven `baseUrl`, por lo que un
backend en localhost junto a una `DATABASE_URL` de producción se comprueba contra
la base de datos, no contra el backend.

Un rechazo tiene este aspecto:

```text
Error: Refusing to run "delete_row": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si no se puede resolver ninguna cadena de conexión, se rechazan las herramientas de base de datos restringidas.**
Sin una `DATABASE_URL`, la CLI usa la base de datos de desarrollo administrada, que es
la predeterminada para un proyecto nuevo, y la barrera rechaza sus cuatro herramientas de base de datos
allí. El rechazo indica el motivo y menciona qué funciona en su lugar. No sugiere
la desactivación de la protección:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the tables in backend/schema to
that database at boot, additively. After changing a table, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Desde una terminal,
`rebase db push` y `rebase db migrate` sí se ejecutan en esa base de datos; solo las herramientas
MCP son rechazadas.

Solo loopback cuenta como local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(y `0.0.0.0`).
Los rangos privados como `10.x` y `192.168.x` **no** lo son: es tan probable que sean
un clúster de staging compartido como un ordenador portátil, y tratarlos como locales daría paso
precisamente al accidente que la barrera busca evitar.

Establece `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desactivar esta protección. Establecerlo globalmente en la
configuración de tu cliente MCP elimina la barrera para todos los proyectos que el servidor pueda alcanzar, no
solo para aquel en el que estabas pensando.

## Marcado de datos no confiables

Las filas, los registros de usuario, los listados de almacenamiento, los trabajos cron, las respuestas de funciones y la
salida de la CLI se devuelven envueltos en un contenedor explícito:

```text
<<<UNTRUSTED_DATA source="query_table" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Cualquier cosa almacenada en tu base de datos fue escrita por alguien, y llega por
el mismo canal que el contrato de herramientas que sigue el asistente. El contenedor le indica
al modelo que lo trate como contenido inerte en lugar de instrucciones.

El `id` se genera de forma única para cada respuesta, después de escribir los datos, y
solo el marcador final que lo incluye cierra el bloque. El texto dentro de los datos que tenga
forma de marcador se interrumpe con un espacio de ancho cero, por lo que una fila que imprima
`<<<END_UNTRUSTED_DATA>>>` no puede cerrar el contenedor antes de tiempo y dejar lo que sigue
fuera de él.

El [endpoint remoto](/docs/ai/remote-mcp/) delimita los resultados de sus herramientas de la misma
forma y se lo comunica al cliente; su `structuredContent` contiene el resultado plano.
`list_tables` y
`describe_table` son las excepciones: solo un modelo las lee, por lo que se
envían una sola vez, en el texto.

Es un marcador, no un entorno aislado (sandbox). Un asistente que disponga de estas herramientas solo es tan seguro
como el contenido que le permitas leer.

## Múltiples proyectos

Las configuraciones de proyectos se almacenan en `~/.rebase/projects.json`, y el servidor
puede albergar varios a la vez, lo cual es útil cuando trabajas en
entornos locales y remotos. Mientras `rebase dev` está en ejecución, el servidor lee el puerto activo y la
clave de servicio desde `.rebase/state.json` en el directorio del proyecto, que es lo que
hace que el caso local no requiera configuración (zero-config).

:::note[El registro tiene la última palabra, no la primera]
El orden de precedencia es el mencionado anteriormente: bloque de entorno, luego el directorio de trabajo
cuando contiene un `rebase.json`, y finalmente el `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` y `REBASE_API_TOKEN` reconstruyen el
proyecto `default` **en cada inicio**, no solo en el primero. La reconstrucción abarca
la entrada completa: un token registrado para el antiguo `projectDir` se descarta en lugar de transferirse
a un directorio para el cual nunca fue emitido. Un `default` derivado de
esa manera (o del directorio de trabajo) nunca se vuelve a escribir en
`~/.rebase/projects.json`, de modo que la clave de servicio de desarrollo de un proyecto no puede convertirse en
la de otro.

`activeProject` es persistente, por lo que si una sesión previa llamó a
`rebase_project_switch`, las herramientas apuntarán a ese proyecto y el servidor lo indicará en
stderr, a menos que ese proyecto esté registrado en un directorio *diferente* de
aquel en el que se ejecuta este servidor, en cuyo caso recurre a `default` y lo
notifica. Si un asistente parece estar leyendo la base de datos equivocada, llama
primero a `rebase_project_current`.
:::

### Sobre qué proyecto actúa una llamada

`activeProject` es a nivel de toda la máquina, y a menudo se instala un único servidor para todo el equipo. Por lo tanto, cada herramienta que actúa sobre un proyecto (todas excepto las herramientas de registro `rebase_project_*`, `rebase_cloud_projects_list`, `rebase_cloud_provision` y `rebase_dev_logs`) resuelve su proyecto **por llamada**, y acepta un parámetro opcional `project`: el nombre de un proyecto registrado, o un slug o id de Rebase Cloud. La llamada se comprueba contra el enlace de Cloud (`.rebase/cloud.json`) del directorio en el que trabaja la sesión: la primera [raíz](https://modelcontextprotocol.io/specification/latest/client/roots) del cliente o, en su defecto, el directorio de trabajo del servidor.

| La llamada | Directorio de la sesión | Resultado |
|---|---|---|
| especifica un proyecto | está vinculado al mismo proyecto | se ejecuta en él |
| especifica un proyecto | está vinculado a otro proyecto | **rechazada**, no se ejecuta nada |
| no especifica un proyecto | está vinculado a un proyecto distinto al activo | **rechazada**, no se ejecuta nada |
| no especifica un proyecto | está vinculado; el proyecto activo es uno local en otra ubicación | se ejecuta en el proyecto vinculado |
| no especifica un proyecto | no está vinculado | se ejecuta en el proyecto activo; una *escritura* en un proyecto de Cloud que haya seleccionado una sesión anterior requiere especificar el proyecto |

Un rechazo nombra ambos proyectos. `rebase_project_current` reporta el directorio y el enlace de la sesión bajo `session`. `rebase_cloud_env_set` y `rebase_cloud_rollback` pasan el proyecto resuelto a la CLI con `--project`; `rebase_cloud_deploy` envía el directorio en el que se ejecuta, por lo que es rechazado cuando el enlace de ese directorio es otro proyecto.

Los tokens se almacenan en ese registro **en texto plano**. Es un archivo en tu
directorio de inicio que contiene credenciales de administrador para cada proyecto que hayas registrado;
trátalo en consecuencia.

## Rebase Cloud

Ocho herramientas llevan una aplicación desde este directorio hasta un backend en producción en
[Rebase Cloud](/docs/deployment/cloud/) y la mantienen en funcionamiento. Cada una ejecuta
`rebase cloud <command> --json` en el directorio del proyecto activo: el mismo
comando que ejecutaría una persona, por lo que no hay una segunda implementación que pueda diferir de él.

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

El flujo habitual del agente es: `rebase_cloud_provision`, luego proporcionar al usuario la
URL de reclamo; `rebase_cloud_status` para ver el proyecto (mientras no esté reclamado,
`unclaimed` contiene la URL de reclamo y cuándo se eliminará); `rebase_cloud_deploy`
después de un cambio; `rebase_cloud_logs` cuando algo falle; y
`rebase_cloud_rollback` cuando producción esté rota.

**Sobre qué actúan.** El proyecto al que se resuelve la llamada, tal como se describe en
[Sobre qué proyecto actúa una llamada](#sobre-qué-proyecto-actúa-una-llamada): el argumento `project`,
comprobado contra el enlace del directorio de la sesión, o ese enlace, o
el proyecto activo. Una llamada que especifique un proyecto al cual el directorio de la sesión no esté
vinculado se rechaza antes de iniciar nada.

**Bajo qué autoridad.** Lo que sea que la CLI resuelva en ese directorio: `REBASE_TOKEN`
cuando esté configurado, luego el token que `rebase cloud init --claim` almacenó para un
proyecto no reclamado, y finalmente la sesión de `rebase cloud login`. En el directorio de ese
proyecto no reclamado, un `REBASE_TOKEN` que no tenga alcance sobre el proyecto se deja a
un lado a favor del token propio del proyecto. El plano de control
comprueba cada llamada al igual que comprueba las de la CLI, por lo que con un token creado mediante
`rebase cloud tokens create --can logs`, un asistente puede leer registros (logs), y el
plano de control rechazará sus despliegues, variables y rollbacks. Si no hay credencial o se rechaza,
se devuelve un error que indica lo que el usuario debe hacer (`rebase cloud login` o reclamar el proyecto).

**Por qué no aplica la barrera loopback.** La barrera comprueba la `baseUrl` de la aplicación y
la `DATABASE_URL` de la CLI; estas herramientas no utilizan ninguna de las dos. Después de `rebase_cloud_provision`,
`REBASE_BASE_URL` apunta al nuevo proyecto en la nube, por lo que restringirlo rechazaría
el mismo despliegue que el flujo necesita. El aprovisionamiento en sí solo crea: no altera
ninguna aplicación o base de datos existente, y la CLI aún lo rechaza en un directorio que
ya está vinculado. Un despliegue, una variable y un rollback modifican
la producción cada uno. Lo que se interpone ante ellos es la credencial anterior, la
aprobación de herramientas de tu cliente MCP y `confirm: true`: `rebase_cloud_deploy` a
producción, `rebase_cloud_env_set` en producción, `rebase_cloud_rollback` y
`rebase_cloud_provision` responden qué harían y no ejecutan nada hasta que una llamada
repita los mismos argumentos con `confirm: true`, lo cual el asistente envía solo
después de que el usuario lo apruebe. Un despliegue de vista previa (preview) y una variable de vista previa no requieren ninguna confirmación. Para evitar que un asistente modifique un
proyecto en la nube, define `REBASE_TOKEN` en el entorno del servidor con un token que no tenga
las capacidades `deploy` y `env`.

**Leer cualquiera de tus proyectos.** Las herramientas anteriores actúan sobre el proyecto vinculado.
Para leer los datos de otro (cualquier proyecto de cualquier organización a la que pertenezca la
cuenta que haya iniciado sesión, esté vinculado aquí o no), `rebase_cloud_projects_list` los lista
y `rebase_project_use_cloud` (con un id, slug o nombre) apunta las herramientas de datos y
administración hacia él: `query_table`, `get_row`, `list_users`, `list_roles`,
`cron_list_jobs`, `storage_list_objects`. Esas llamadas pasan a través del proxy de
Studio de la consola, portando la credencial propia de la CLI (`rebase cloud access-token`, leída
por llamada y nunca almacenada); el plano de control comprueba el acceso del usuario y
adjunta la service key del proyecto de su lado, por lo que ninguna clave llega a la máquina.
Un proyecto con Studio desactivado es rechazado, y el selector lo indica. Es un
destino remoto como cualquier otro, por lo que las herramientas que modifican datos permanecen rechazadas allí
a menos que se configure `REBASE_MCP_ALLOW_REMOTE_WRITES`; `rebase_project_switch` regresa
al anterior.

Cada herramienta es una instantánea:

- `rebase_cloud_logs` nunca sigue la salida en tiempo real (follow). Su resultado incluye `nextSinceTime`; pásalo
  como `since` para leer lo que vino después. Devuelve las últimas 200 líneas a menos que
  `tail` indique lo contrario. `source: "build"` devuelve en su lugar el registro de compilación más reciente.
- `rebase_cloud_deploy` sigue el despliegue hasta el final y comprueba que la nueva
  versión responda. `wait: false` regresa tan pronto como se activa el despliegue.
  Nunca expulsa (eject) un proyecto del entorno de ejecución administrado, despliega una versión anterior del framework
  ni omite las comprobaciones de compilación: esas son decisiones del usuario, y un
  rechazo que requiera alguna de ellas lo indicará.
- `rebase_cloud_rollback` pasa `--yes` una vez que la llamada incluye `confirm: true`
  (más abajo), ya que no hay una terminal para preguntar.

`rebase_cloud_env_set` escribe el valor en la entrada estándar de la CLI, por lo que
nunca está en una línea de comandos donde `ps` lo mostraría, y el valor se excluye de
todo lo que devuelva la herramienta. Su resultado indica qué se almacenó (la clave, si
es secreta, si hay un redespliegue pendiente), nunca el valor. `rebase_cloud_env_list`
lista únicamente claves. Una CLI anterior a `env set --stdin` es rechazada con un mensaje para
actualizarla; el valor no se envía de otra manera.

Los resultados se devuelven en el [contenedor de datos no confiables](#marcado-de-datos-no-confiables),
precedidos por una línea del servidor sobre qué hacer a continuación. Un rechazo es un error de herramienta
que contiene el código de la CLI, como `no_project`, `token_rejected`,
`managed_project` o `deploy_failed`. Cuando el servidor reconoce el código,
añade el siguiente paso y luego el mensaje propio de la CLI. Cada herramienta comprueba sus argumentos
contra el esquema que publica antes de iniciar cualquier proceso, y rechaza cualquier
argumento que no declare.

## Referencia de herramientas

53 herramientas, en diez grupos: esquema y base de datos, planificación de esquemas, documentos, usuarios
y roles, almacenamiento, cron, funciones, el servidor de desarrollo, el registro de proyectos y
Rebase Cloud.
Cada una, junto con lo que necesita y si la barrera la rechaza frente a un destino no local,
se encuentra en la [Referencia de herramientas MCP](/docs/ai/mcp-tool-reference).

## Recursos

Más allá de las herramientas, el servidor expone recursos MCP para que un cliente pueda obtener contexto
del proyecto sin gastar una llamada a herramienta:

| URI | Descripción |
|---|---|
| `rebase://tables/{name}` | Código fuente en TypeScript de una definición de tabla (`defineTable`) |
| `rebase://schema` | El esquema de Drizzle generado (`schema.generated.ts`) |

Los archivos de tablas son los módulos del directorio de esquemas, aparte de su `index.ts`: la
clave `tables` de la aplicación de backend en `rebase.json`, por defecto `backend/schema`,
bajo el directorio del proyecto activo o su `app/`.

`rebase://schema` se lista **únicamente si** existe el esquema generado.
`findBackendDir` busca `backend/` y luego `app/backend/` bajo el directorio del proyecto
activo, y lee `src/schema.generated.ts` del que encuentre,
de modo que tanto la estructura generada inicialmente como la de este monorepo funcionan, y un proyecto organizado de
una tercera manera, o uno que aún no haya ejecutado `rebase schema generate`, simplemente no
verá el recurso disponible.

## El endpoint remoto

Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, para las personas que usan
tu aplicación, conectándose cada una como sí misma bajo su propia seguridad a nivel de
fila. Eso tiene su propia página:
[El endpoint MCP remoto](/docs/ai/remote-mcp/).

## Configuración recomendada

- Apunta el servidor a un proyecto **local** y deja `REBASE_MCP_ALLOW_REMOTE_WRITES`
  sin definir. La barrera es lo más valioso del paquete.
- Para cualquier entorno remoto, registra una **API key `rk_` con alcance limitado** en lugar de dejar que
  el descubrimiento proporcione una service key.
- Comprueba `rebase_project_current` cuando la salida parezca incorrecta. El proyecto activo es
  persistente y reside fuera de tu repositorio.
- Trata `~/.rebase/projects.json` como un archivo de secretos.
