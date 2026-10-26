---
sourceHash: 781e0136e6dc1271
title: Servidor MCP
sidebar_label: Servidor MCP
description: "Conecta Claude Code, Cursor, Gemini CLI o cualquier cliente MCP a un proyecto de Rebase: las 51 herramientas que expone, la credencial con la que se autentica y la barrera de loopback que se interpone entre un agente y producción."
---

`@rebasepro/mcp` es un servidor del [Model Context Protocol](https://modelcontextprotocol.io)
que proporciona a un asistente de IA herramientas reales sobre un proyecto de Rebase:
leer y escribir filas, gestionar usuarios, ejecutar migraciones, invocar funciones y
controlar el servidor de desarrollo.

Se comunica mediante MCP **únicamente a través de stdio**. No hay puerto ni listener;
el proceso es tan confiable como lo que lo haya generado, y no hay ningún emisor remoto
que autenticar. Esa es la parte segura. Las preguntas interesantes tratan sobre lo que
hace *una vez* que se está ejecutando, y esta página las responde antes de mostrarte
el bloque de configuración.

Un backend desplegado también puede servir MCP por sí mismo, a través de HTTP, para
las personas que usan tu aplicación. Eso es algo diferente con un modelo de credenciales
distinto: consulta [The Remote MCP Endpoint](/docs/ai/remote-mcp/).

## Conectar un cliente

El servidor se ejecuta desde tu proyecto: `@rebasepro/mcp` es una devDependency que
cada scaffold de `rebase init` fija con la CLI, y cada bloque a continuación — la
integración completa — arranca esa copia (`pnpm exec rebase-mcp`, o `npx --no rebase-mcp`
en un proyecto npm), nunca una más reciente desde npm. Un proyecto más antiguo la añade
una vez, con `rebase skills install --mcp` o `pnpm add -D @rebasepro/mcp`.

`rebase init` escribe el bloque para cada agente que elijas cuando
[configura tus agentes de programación con IA](/docs/ai/skills#set-up-by-rebase-init), manteniendo
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
Codex lee la configuración de un proyecto solo una vez que hayas confiado en él:

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

**Windsurf** lee los servidores MCP únicamente desde su configuración a nivel de usuario,
por lo que no hay ningún archivo de proyecto que escribir. Añade el servidor en su
configuración de MCP como `"command": "pnpm"`, `"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`,
con esa misma ruta en `REBASE_PROJECT_DIR`.

Cualquier cliente MCP que pueda iniciar un servidor stdio funcionará; la estructura es la misma.

### Sobre qué directorio actúa

`REBASE_PROJECT_DIR` es el directorio que contiene `rebase.json`. Hay **una**
precedencia y es la misma en todos los clientes:

1. **El bloque de entorno** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Si cualquiera de ellos está definido, el proyecto `default`
   se reconstruye a partir de ellos en cada inicio.
2. **El directorio de trabajo del servidor**, cuando contiene un `rebase.json`. Un proyecto
   en el que te encuentras tiene prioridad sobre cualquier cosa guardada en `~/.rebase/projects.json`.
3. **El `default` persistido** en `~/.rebase/projects.json`, cuando ninguno de los dos
   primeros indica nada.

El autodescubrimiento desde `.rebase/state.json` llena vacíos en los tres casos y nunca
anula un valor proporcionado por alguno de ellos.

Los bloques a nivel de proyecto definen el proyecto (`"."`, el directorio de trabajo del
cliente o el `${workspaceFolder}` del editor) porque la regla 3 lee un archivo compartido
por todos los proyectos del equipo. Una configuración a nivel de usuario, como la de Windsurf,
especifica una ruta absoluta en su lugar.

## A qué puede acceder el servidor

Esta es la sección que debes leer antes de apuntar un asistente a una base de datos que te importe.

El servidor cuenta con **una única credencial ambiental para todo el proceso**. No hay
identidad por herramienta ni modo de solo lectura; cada herramienta utiliza el mismo token,
y la única opción disponible en el paquete sirve para *habilitar* más alcance en lugar de reducirlo.

Qué credencial es esa, en orden de prioridad:

1. `REBASE_API_TOKEN` del entorno. `REBASE_TOKEN` no se lee aquí:
   es el token del plano de control de la CLI, y nunca se envía a la app (el
   servidor lo indica una vez por stderr cuando es el único definido). Las herramientas de cloud
   se lo siguen pasando a la CLI que lanzan, que lo envía al plano de control.
2. `REBASE_SERVICE_KEY` leída desde el `.env` del proyecto
3. La clave de servicio descubierta automáticamente desde `.rebase/state.json` mientras
   `rebase dev` está en ejecución

2 y 3 son la clave del backend de desarrollo de esta máquina, usada solo cuando el destino está en
loopback. Cuando `REBASE_BASE_URL` apunta a otra parte — <span class="since-badge" data-since="0.26">Desde 0.26</span> `rebase cloud init --claim`
escribe la dirección del proyecto de cloud, y ningún `REBASE_API_TOKEN` hasta que un despliegue
tiene éxito — el servidor no envía ningún token y lo indica una vez por stderr.

Un token que registres para un proyecto **prevalece sobre el autodescubrimiento**. El
descubrimiento solo llena vacíos.

:::danger[La vía sin configuración es una credencial de administrador]
Las opciones 2 y 3 corresponden a la **clave de servicio** (service key): un secreto de
administrador sin restricciones de alcance. El backend la resuelve a `uid: "service"`,
`roles: ["admin"]`, `isAdmin: true`. Esa identidad tiene todos los
[alcances](/docs/backend/roles-and-scopes/) y satisface las políticas `_default_admin_read` / `_default_admin_write`
que Rebase inyecta en cada colección que no haya establecido `disableDefaultPolicies`.

Por lo tanto, la respuesta honesta a "¿RLS sigue restringiéndola?" es: RLS *se ejecuta*
—el controlador sí pasa al rol `rebase_user`— y luego una política escrita por el propio
Rebase otorga todo a esa identidad. Leer cada fila de cada colección es el **comportamiento
diseñado de la configuración predeterminada**, no una omisión ni bypass de seguridad.

Con la configuración zero-config, un agente que posea estas herramientas puede leer y escribir
cada fila de cada colección, listar todos los usuarios, restablecer cualquier contraseña,
invocar cualquier función del backend y ejecutar DDL contra cualquier `DATABASE_URL` que
resuelva el proyecto.
:::

### Proporcionar una credencial restringida en su lugar

Registra una [clave de API](/docs/backend/api-keys) con alcance restringido y el modelo de dos
barreras se aplicará de verdad. Una clave de servicio se ejecuta con los roles
`["service"]`, los cuales las políticas de administración inyectadas **no** nombran; por lo tanto,
RLS no le otorga nada a menos que una de tus propias políticas indique lo contrario, y sus
alcances la restringen aún más:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Luego, entrega la clave `rk_live_…` resultante al servidor en lugar de dejar que descubra
una clave de servicio:

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

Dos cosas que esto **no** hace, ambas importantes antes de depender de ello:

- **No restringe las herramientas de CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` y las herramientas de ramas inician la CLI de Rebase, la cual se conecta
  con `DATABASE_URL` y nunca ve tu token. La barrera de loopback que se describe a continuación
  es lo único que se interpone frente a ellas.
- **Una clave llega a una herramienta de administración solo con el alcance de esa herramienta.**
  `list_users` y `list_roles` necesitan `users:read`; `create_user`, `update_user`, `delete_user`
  y `rebase_auth_reset_password` necesitan `users:write`; las herramientas de almacenamiento y
  de cron necesitan el alcance `storage:*` o `cron:*` correspondiente; `invoke_function`
  necesita `functions:invoke`. Sin él, la llamada responde `403 SCOPE_MISSING`. Incluso con
  `users:write`, una clave no puede cambiar la cuenta de un administrador: un administrador
  tiene `keys:read` y `keys:write`, que ninguna clave puede tener, y nadie puede gestionar una
  cuenta que tenga más que él.

Una clave creada con `--roles admin` es un asunto diferente: cuenta con los roles
`["service", "admin"]`, lo que cumple las mismas políticas de administración predeterminadas
que la clave de servicio. Si además le das `--full-access`, su alcance es el de la clave de
servicio, menos la gestión de claves. La diferencia es que es **revocable, puede expirar y
cuenta con límites de tasa por clave**, características que no aplican a la clave de servicio;
rotar esa última requiere editar `.env` y reiniciar el servidor.

Consulta [Agentes y servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers) para ver la
guía completa sobre el alcance de claves.

### Dejar una colección completamente fuera de alcance

La razón por la que una credencial de administrador lee todo es la política base que Rebase
inyecta en cada colección, otorgando el contexto de servidor de confianza y el rol `admin`.
Una colección puede optar por no aplicar esa base y asumir la responsabilidad total de su propia RLS:

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

Ahora la única forma de acceder es coincidir con `patient_id`. El uid de la clave de servicio
es la cadena literal `service`, por lo que una regla de propietario nunca coincidirá con ella:
las lecturas devolverán cero filas y las escrituras serán rechazadas por Postgres. Este es el
único control que restringe la credencial predeterminada del servidor MCP en lugar de darla
por supuesta.

Recuerda que este es un cambio real de RLS, no documental: surte efecto únicamente una vez
que `rebase schema generate` y una migración hayan aplicado las políticas. Consulta
[Reglas de seguridad (RLS)](/docs/collections/security-rules).

## La barrera de loopback

`rebase_project_add` acepta cualquier `baseUrl`, y las herramientas de CLI se conectan con
cualquier `DATABASE_URL` que declare el proyecto. Por lo tanto, la misma lista de herramientas
que edita una base de datos de prueba en tu ordenador puede eliminar filas de producción, sin
nada de por medio excepto el criterio del asistente sobre qué proyecto está activo.

**Cualquier herramienta que modifique el entorno de destino es rechazada a menos que ese
destino esté en la interfaz de loopback.** La barrera está estructurada como una lista de lo
que *no* está restringido, de modo que una herramienta agregada más tarde llega protegida de
forma predeterminada.

- **Sin restricción — lecturas:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, y <span class="since-badge" data-since="0.26">Desde 0.26</span> las lecturas de Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Sin restricción — escrituras de Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  Aprovisionar crea un proyecto; las demás modifican un proyecto de producción. Ninguna
  pasa por `baseUrl` ni por `DATABASE_URL`, que es todo lo que la barrera puede
  comprobar. Consulta [Rebase Cloud](#rebase-cloud) para ver qué se interpone ante ellas.
- **Sin restricción — solo locales:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, las herramientas del servidor de desarrollo y las herramientas del registro de proyectos.
  Estas escriben archivos locales o estado local y no tienen un destino remoto que verificar.
- **Restringidas contra `DATABASE_URL`:** las herramientas de CLI restantes — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Restringidas contra la `baseUrl` del proyecto:** las herramientas del SDK restantes —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  e `invoke_function`.

Los dos destinos no son intercambiables. Las herramientas de CLI nunca ven `baseUrl`, por lo
que un backend en localhost situado junto a una `DATABASE_URL` de producción se comprueba
contra la base de datos, no contra el backend.

Un rechazo tiene este aspecto:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si no se puede resolver ninguna cadena de conexión, las herramientas de base de datos con barrera son rechazadas.**
Sin `DATABASE_URL`, la CLI usa la base de datos de desarrollo gestionada, que es la
predeterminada en un proyecto nuevo, y la barrera rechaza allí sus cuatro herramientas de
base de datos. El rechazo explica por qué y nombra lo que sí funciona. No sugiere la
desactivación de la barrera:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the collections to that
database at boot, additively. After changing a collection, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Desde una terminal,
`rebase db push` y `rebase db migrate` sí se ejecutan en esa base de datos; solo se
rechazan las herramientas de MCP. En la 0.24 la CLI también las rechaza allí.

Solo loopback cuenta como local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(y `0.0.0.0`).
Los rangos privados como `10.x` y `192.168.x` **no** lo hacen; es tan probable que sean
un clúster de staging compartido como un ordenador portátil, y tratarlos como locales
permitiría exactamente el accidente que la barrera existe para evitar.

Establece `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desactivar esta protección. Establecerlo
globalmente en la configuración de tu cliente MCP elimina la barrera para todos los proyectos
a los que el servidor pueda acceder, no solo para aquel en el que estabas pensando.

## Marcado de datos no confiables

Las filas, los registros de usuario, las listas de almacenamiento, las tareas cron, las respuestas
de funciones y la salida de CLI se devuelven envueltos en un contenedor explícito:

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Cualquier cosa almacenada en tu base de datos fue escrita por alguien, y llega por el mismo
canal que el contrato de herramientas que sigue el asistente. El contenedor le indica al modelo
que lo trate como contenido inerte y no como instrucciones.

El `id` se genera de forma nueva para cada respuesta, después de que los datos fueron escritos,
y solo el marcador final que lo contiene cierra el bloque. El texto dentro de los datos que
tenga forma de marcador se divide con un espacio de ancho cero, por lo que una fila que imprima
`<<<END_UNTRUSTED_DATA>>>` no puede cerrar el contenedor antes de tiempo ni dejar fuera lo que sigue.

El [endpoint remoto](/docs/ai/remote-mcp/) marca los resultados de sus herramientas de la misma
forma y se lo indica al cliente; su `structuredContent` transporta el resultado sin marcar.
`list_collections` y
`describe_collection` son las excepciones: solo un modelo las lee, así que se envían
una sola vez, en el texto. Antes de la 0.24 el listado llevaba además una copia en
`structuredContent`.

Es un marcador, no un entorno aislado (sandbox). Un asistente que disponga de estas herramientas
es tan seguro como el contenido que le permitas leer.

## Múltiples proyectos

Las configuraciones de proyectos se almacenan en `~/.rebase/projects.json`, y el servidor puede
albergar varias a la vez, lo cual resulta útil cuando trabajas entre entornos locales y remotos.
Mientras `rebase dev` está en ejecución, el servidor lee el puerto activo y la clave de servicio
desde `.rebase/state.json` en el directorio del proyecto, que es lo que hace que el caso local
funcione sin configuración previa.

:::note[El registro es la última palabra, no la primera]
La precedencia es la descrita anteriormente: bloque de entorno, luego el directorio de trabajo
cuando contiene un `rebase.json`, y finalmente el `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` y `REBASE_API_TOKEN` reconstruyen el proyecto `default`
**en cada inicio**, no solo en el primero. La reconstrucción es de la entrada completa: un token
registrado contra el antiguo `projectDir` se descarta en lugar de transferirse a un directorio
para el cual nunca fue emitido. Un `default` derivado de esa manera —o del directorio de trabajo—
nunca se escribe de vuelta en `~/.rebase/projects.json`, de modo que la clave de servicio de
desarrollo de un proyecto no puede convertirse en la de otro.

`activeProject` es persistente, por lo que si una sesión anterior llamó a `rebase_project_switch`,
las herramientas apuntarán a ese proyecto y el servidor lo indicará en stderr —a menos que ese
proyecto esté registrado bajo un directorio *diferente* al que se ejecuta este servidor, en cuyo
caso recurre a `default` y lo notifica. Si un asistente parece estar leyendo la base de datos
incorrecta, llama primero a `rebase_project_current`.
:::

Los tokens se almacenan en ese registro **en texto plano**. Es un archivo en tu directorio de
inicio que contiene credenciales de administrador para cada proyecto que hayas registrado;
trátalo en consecuencia.

## Rebase Cloud

<span class="since-badge" data-since="0.26">Desde 0.26</span>

Ocho herramientas llevan una app desde este directorio hasta un backend en vivo en
[Rebase Cloud](/docs/deployment/cloud/) y lo mantienen en funcionamiento. Cada una lanza
`rebase cloud <command> --json` en el directorio del proyecto activo: el mismo
comando que ejecuta una persona, de modo que no hay una segunda implementación que pueda divergir.

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

El recorrido habitual de un agente es: `rebase_cloud_provision`, y luego entregar al usuario la
URL de reclamación; `rebase_cloud_status` para ver el proyecto (mientras no esté reclamado,
`unclaimed` lleva la URL de reclamación y cuándo se elimina); `rebase_cloud_deploy`
tras un cambio; `rebase_cloud_logs` cuando algo se comporta mal; y
`rebase_cloud_rollback` cuando producción está rota.

**Sobre qué actúan.** El proyecto al que está vinculado el directorio activo en
`.rebase/cloud.json`. Ninguna acepta un id de proyecto ni un directorio, de modo que un
asistente no puede apuntarlas a otro proyecto distinto del que tiene vinculado el directorio.
Cambiar el proyecto activo con `rebase_project_switch` cambia el directorio en el que
se ejecutan.

**Con qué autoridad.** La que resuelva la CLI en ese directorio: `REBASE_TOKEN`
cuando está definido, luego el token que `rebase cloud init --claim` guardó para un
proyecto sin reclamar, luego la sesión de `rebase cloud login`. En el directorio de ese
proyecto sin reclamar, un `REBASE_TOKEN` que no tiene ningún scope sobre el proyecto se
deja de lado en favor del token propio del proyecto. El plano de control
comprueba cada llamada como comprueba las de la CLI, así que con un token creado con
`rebase cloud tokens create --can logs` un asistente puede leer logs, y el
plano de control rechaza sus despliegues, variables y rollbacks. Sin credencial, o con una rechazada, se devuelve un error que indica lo que el
usuario tiene que hacer (`rebase cloud login`, o reclamar el proyecto).

**Por qué no se aplica la barrera de loopback.** La barrera comprueba la `baseUrl` de la app y
la `DATABASE_URL` de la CLI; estas herramientas no usan ninguna de las dos. Tras `rebase_cloud_provision`,
`REBASE_BASE_URL` apunta al nuevo proyecto de cloud, así que aplicarle la barrera rechazaría
el mismo despliegue que el recorrido necesita. El aprovisionamiento en sí solo crea: no toca
ninguna app ni base de datos existente, y la CLI lo rechaza igualmente en un directorio que
ya está vinculado. Un despliegue, una variable y un rollback modifican cada uno
producción. Lo que se interpone ante ellos es la credencial anterior y
la aprobación de herramientas de tu cliente MCP. Para evitar que un asistente modifique un proyecto
de cloud, define `REBASE_TOKEN` en el entorno del servidor con un token sin las
capacidades `deploy` y `env`.

Cada herramienta es una instantánea:

- `rebase_cloud_logs` nunca hace seguimiento. Su resultado lleva `nextSinceTime`; pásalo
  de vuelta como `since` para leer lo que vino después. Devuelve las últimas 200 líneas salvo que
  `tail` indique otra cosa. `source: "build"` devuelve en su lugar el último log de compilación.
- `rebase_cloud_deploy` sigue el despliegue hasta el final y comprueba que la nueva
  versión responde. `wait: false` regresa en cuanto se dispara el despliegue.
  Nunca expulsa un proyecto del runtime gestionado, despliega una versión anterior del framework
  ni omite las comprobaciones de compilación: esas son decisiones del usuario, y un
  rechazo que necesita una lo dice.
- `rebase_cloud_rollback` pasa `--yes`. La llamada a la herramienta es la confirmación, ya que
  no hay una terminal en la que preguntar.

`rebase_cloud_env_set` escribe el valor en la entrada estándar de la CLI, de modo que
nunca aparece en una línea de comandos donde `ps` lo mostraría, y el valor se elimina de
todo lo que devuelve la herramienta. Su resultado indica lo que se almacenó (la clave, si
es secreta, si hay un redespliegue pendiente), nunca el valor. `rebase_cloud_env_list`
lista solo claves. Una CLI anterior a `env set --stdin` se rechaza con un mensaje para
que la actualices; el valor no se envía de otra forma.

Los resultados llegan en el [contenedor de datos no confiables](#marcado-de-datos-no-confiables),
tras una línea del servidor sobre qué hacer a continuación. Un rechazo es un error de herramienta
que lleva el código de la CLI, como `no_project`, `token_rejected`,
`managed_project` o `deploy_failed`. Cuando el servidor reconoce el código,
añade el siguiente paso, y después el mensaje propio de la CLI. Cada herramienta comprueba sus argumentos
contra el esquema que anuncia antes de lanzar nada, y rechaza un
argumento que no declara.

## Referencia de herramientas

51 herramientas, en diez grupos: esquema y base de datos, planificación de esquema,
documentos, usuarios y roles, almacenamiento, cron, funciones, el servidor de desarrollo,
el registro de proyectos y Rebase Cloud. Cada una, con lo que necesita y si la barrera la rechaza
frente a un destino no local, está en la [referencia de herramientas MCP](/docs/ai/mcp-tool-reference).

## Recursos

Más allá de las herramientas, el servidor expone recursos MCP para que un cliente pueda extraer
el contexto del proyecto sin gastar una llamada a herramienta:

| URI | Descripción |
|---|---|
| `rebase://collections/{name}` | Código fuente en TypeScript de una definición de colección |
| `rebase://schema` | El esquema generado de Drizzle (`schema.generated.ts`) |

Las colecciones se descubren a partir de `app/config/collections/`, `config/collections/`
o `collections/` bajo el directorio del proyecto activo, cualquiera que exista.

`rebase://schema` se lista **solo si** el esquema generado existe. `findBackendDir` busca
`backend/` y luego `app/backend/` bajo el directorio del proyecto activo, y lee
`src/schema.generated.ts` de donde lo encuentre; por lo que tanto la estructura inicial
como la de este monorepositorio funcionan, y un proyecto estructurado de una tercera forma,
o uno que aún no haya ejecutado `rebase schema generate`, simplemente no verá ofrecido el recurso.

## El endpoint remoto

Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, para las personas que usan
tu aplicación, cada una conectándose como ella misma bajo su propia seguridad a nivel
de fila. Eso tiene su propia página:
[The Remote MCP Endpoint](/docs/ai/remote-mcp/).

## Configuración recomendada

- Apunta el servidor a un proyecto **local** y deja `REBASE_MCP_ALLOW_REMOTE_WRITES` sin
  definir. La barrera es lo más valioso del paquete.
- Para cualquier entorno remoto, registra una **clave de API `rk_` con alcance restringido**
  en lugar de permitir que el descubrimiento entregue una clave de servicio.
- Comprueba `rebase_project_current` cuando la salida parezca incorrecta. El proyecto activo
  es persistente y reside fuera de tu repositorio.
- Trata `~/.rebase/projects.json` como un archivo de secretos.
