---
sourceHash: 59966953b83890cf
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecte Claude Code, Cursor, Gemini CLI o cualquier cliente MCP a un proyecto de Rebase — las 53 herramientas que expone, la credencial con la que se autentica y la compuerta de loopback que se interpone entre un agente y producción.
---

`@rebasepro/mcp` es un servidor de [Model Context Protocol](https://modelcontextprotocol.io)
que proporciona a un asistente de IA herramientas reales sobre un proyecto de Rebase:
leer y escribir filas, administrar usuarios, ejecutar migraciones, invocar funciones
y controlar el servidor de desarrollo.

Se comunica mediante MCP **únicamente a través de stdio**. No hay ningún puerto ni
listener — el proceso es tan confiable como lo sea aquello que lo inició, y no hay
ningún llamador remoto que autenticar. Esa es la parte segura. Las preguntas
interesantes tratan sobre lo que hace *una vez* que está en ejecución, y esta página
las responde antes de mostrarle el bloque de configuración.

Un backend desplegado también puede servir MCP por sí mismo, a través de HTTP,
para las personas que usan su aplicación. Eso es algo diferente con un modelo de
credenciales distinto: consulte [El endpoint MCP remoto](/docs/ai/remote-mcp/).

## Conectar un cliente

El servidor se ejecuta desde su proyecto: `@rebasepro/mcp` es una devDependency que
cada scaffold de `rebase init` fija con la CLI, y cada bloque a continuación —toda
la integración— inicia esa copia (`pnpm exec rebase-mcp`, o `npx --no rebase-mcp`
en un proyecto npm), nunca una más reciente de npm. Un proyecto más antiguo la
añade una sola vez, con `rebase skills install --mcp` o `pnpm add -D @rebasepro/mcp`.

`rebase init` escribe el bloque para cada agente que elija cuando
[configura sus agentes de codificación de IA](/docs/ai/skills#set-up-by-rebase-init),
manteniendo cualquier otro servidor que ya esté en el archivo.
`rebase init --agent cursor,codex` hace lo mismo sin preguntar.

**Claude Code** — `.mcp.json` en la raíz de su proyecto. `rebase init` escribe este
archivo por usted:

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
Codex lee la configuración de un proyecto solo después de que haya confiado en el proyecto:

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

**Windsurf** lee los servidores MCP únicamente desde su configuración a nivel de
usuario, por lo que no hay ningún archivo de proyecto que escribir. Añada el
servidor en su configuración de MCP como `"command": "pnpm"`,
`"args": ["--dir", "/absolute/path/to/your/project", "exec", "rebase-mcp"]`, con
esa ruta como `REBASE_PROJECT_DIR`.

Cualquier cliente MCP que pueda generar un servidor stdio funciona; la estructura
es la misma.

### En qué directorio actúa

`REBASE_PROJECT_DIR` es el directorio que contiene `rebase.json`. Hay **un solo**
orden de precedencia, y es el mismo en todos los clientes:

1. **El bloque de entorno** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Si alguno de ellos está configurado, el proyecto `default`
   se reconstruye a partir de ellos en cada inicio.
2. **El directorio de trabajo del servidor**, cuando contiene un `rebase.json`. Un
   proyecto en el que se encuentra tiene prioridad sobre cualquier cosa recordada
   en `~/.rebase/projects.json`.
3. **El `default` persistido** en `~/.rebase/projects.json`, cuando ninguno de los
   dos primeros especifica nada.

La autodetección desde `.rebase/state.json` llena vacíos en los tres casos y nunca
anula un valor proporcionado por alguno de ellos.

Los bloques a nivel de proyecto nombran el proyecto — `"."`, el directorio de
trabajo del cliente o `${workspaceFolder}` del editor— porque la regla 3 lee un
archivo compartido por todos los proyectos de la máquina. Una configuración a nivel
de usuario, como la de Windsurf, especifica en su lugar una ruta absoluta.

## A qué puede acceder el servidor

Esta es la sección que debe leer antes de apuntar un asistente a una base de datos
que le importe.

El servidor lleva **una única credencial ambiental para todo el proceso**. No hay
identidad por herramienta ni modo de solo lectura; cada herramienta usa el mismo
token, y la única opción en el paquete permite habilitar *más* alcance en lugar de
menos.

Cuál es esa credencial, en orden de prioridad:

1. `REBASE_API_TOKEN` del entorno. `REBASE_TOKEN` no se lee aquí: es el token del
   plano de control de la CLI y nunca se envía a la aplicación (el servidor lo
   indica una vez en stderr cuando es el único configurado). Las herramientas de
   cloud aún lo pasan a la CLI que generan, la cual lo envía al plano de control.
2. `REBASE_SERVICE_KEY` leída del `.env` del proyecto
3. La clave de servicio autodetectada desde `.rebase/state.json` mientras
   `rebase dev` está en ejecución

2 y 3 son la clave del backend de desarrollo de esta máquina, usada solo cuando
el destino está en loopback. Cuando `REBASE_BASE_URL` apunta a otro lugar —`rebase cloud init --claim`
escribe la dirección del proyecto en la nube, y ningún `REBASE_API_TOKEN` hasta que
un despliegue tenga éxito— el servidor no envía ningún token y lo indica una vez
en stderr.

Un token que registre para un proyecto **tiene prioridad sobre la autodetección**.
La detección solo llena un vacío.

:::danger[La vía sin configuración es una credencial de administrador]
Las opciones 2 y 3 son la **clave de servicio** —un secreto de administrador sin
restricciones de alcance. El backend la resuelve como `uid: "service"`,
`roles: ["admin"]`, `isAdmin: true`. Esa identidad posee todos los
[alcances](/docs/backend/roles-and-scopes/) y satisface las políticas
`_default_admin_read` / `_default_admin_write` que Rebase inyecta en cada
colección que no haya establecido `disableDefaultPolicies`.

Por lo tanto, la respuesta sincera a "¿RLS todavía lo restringe?" es: RLS *se ejecuta*
—el controlador sí pasa al rol `rebase_user`— y luego una política escrita por el
propio Rebase le concede todo a esa identidad. Leer cada fila de cada colección es
el **comportamiento por diseño de la configuración predeterminada**, no una
evasión de seguridad.

Con la configuración sin ajustes (zero-config), un agente con estas herramientas puede
leer y escribir cada fila de cada colección, listar a todos los usuarios, restablecer
cualquier contraseña, invocar cualquier función del backend y ejecutar DDL contra
cualquier `DATABASE_URL` que resuelva el proyecto.
:::

### Proporcionar una credencial restringida en su lugar

Registre una [clave de API](/docs/backend/api-keys) con alcance definido y el modelo
de dos compuertas se aplicará realmente. Una clave de servicio se ejecuta con los
roles `["service"]`, los cuales las políticas de administración inyectadas **no**
nombran — por lo que RLS no le otorga nada a menos que una de sus propias políticas
indique lo contrario, y sus alcances la restringen aún más:

```bash
rebase api-keys create -n "claude-code" \
  --scopes data:read:articles \
  --expires-in 30
```

Luego, pase la clave `rk_live_…` resultante al servidor en lugar de dejar que detecte
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

Dos cosas que esto **no** hace, y que vale la pena conocer antes de confiar en ello:

- **No restringe las herramientas de la CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` y las herramientas de ramas generan la CLI de Rebase, la cual se
  conecta con `DATABASE_URL` y nunca ve su token en absoluto. La compuerta de
  loopback a continuación es lo único que se interpone frente a ellas.
- **Una clave solo puede acceder a una herramienta de administración con el alcance de esa herramienta.**
  `list_users` y `list_roles` necesitan `users:read`; `create_user`, `update_user`,
  `delete_user` y `rebase_auth_reset_password` necesitan `users:write`; las
  herramientas de almacenamiento y cron necesitan el alcance correspondiente `storage:*`
  o `cron:*`; `invoke_function` necesita `functions:invoke`. Sin este, la llamada
  responde `403 SCOPE_MISSING`. Incluso con `users:write`, una clave no puede
  modificar la cuenta de un administrador: un administrador posee `keys:read` y
  `keys:write`, lo cual ninguna clave puede tener, y nadie puede administrar una
  cuenta que tenga más privilegios que ellos mismos.

Una clave creada con `--roles admin` es un asunto diferente: lleva los roles
`["service", "admin"]`, lo que cumple con las mismas políticas de administrador
predeterminadas que la clave de servicio. Si le da también `--full-access`, su
alcance es el mismo que el de la clave de servicio, menos la gestión de claves. Lo
que añade es que es **revocable, puede expirar y tiene límite de velocidad por clave**,
nada de lo cual aplica a la clave de servicio —rotar esa implica editar `.env` y
reiniciar el servidor.

Consulte [Agentes y servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers)
para ver la guía completa sobre el alcance de claves.

### Dejar una colección completamente fuera de alcance

La razón por la que una credencial de administrador lee todo es la política base
que Rebase inyecta en cada colección, otorgando acceso al contexto de servidor de
confianza y al rol `admin`. Una colección puede optar por no usar esa política base
y asumir total responsabilidad de su propio RLS:

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

Ahora la única forma de acceder es coincidir con `patient_id`. El uid de la clave
de servicio es la cadena literal `service`, por lo que una regla de propietario nunca
coincide con él —las lecturas devuelven cero filas y las escrituras son rechazadas
por Postgres. Este es el único control que restringe la credencial predeterminada del
servidor MCP en lugar de darla por supuesta.

Recuerde que este es un cambio real de RLS, no documental: solo surte efecto una vez
que `rebase schema generate` y una migración hayan aplicado las políticas. Consulte
[Reglas de seguridad (RLS)](/docs/collections/security-rules).

## La compuerta de loopback

`rebase_project_add` acepta cualquier `baseUrl`, y las herramientas de la CLI se
conectan con cualquier `DATABASE_URL` que declare el proyecto. Por lo tanto, la misma
lista de herramientas que edita una base de datos de prueba en su portátil puede
eliminar filas de producción, sin nada de por medio excepto el criterio del asistente
sobre qué proyecto está activo.

**Toda herramienta que modifique el entorno de destino es rechazada a menos que ese destino esté en la interfaz loopback.**
La compuerta está escrita como una lista de lo que *no* está restringido por la
compuerta, por lo que una herramienta agregada más adelante llega protegida de
forma predeterminada.

- **Sin compuerta — lecturas:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `rebase_db_branch_diff`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`, y las lecturas de Rebase Cloud `rebase_cloud_status`,
  `rebase_cloud_logs`, `rebase_cloud_env_list`, `rebase_cloud_deployments_list`.
- **Sin compuerta — escrituras de Rebase Cloud:** `rebase_cloud_provision`,
  `rebase_cloud_deploy`, `rebase_cloud_env_set`, `rebase_cloud_rollback`.
  El aprovisionamiento crea un proyecto; las demás modifican un proyecto de producción.
  Ninguna de ellas pasa por `baseUrl` o `DATABASE_URL`, que es todo lo que la
  compuerta puede verificar. Consulte [Rebase Cloud](#rebase-cloud) para ver qué
  se interpone frente a ellas.
- **Sin compuerta — solo locales:** `rebase_schema_introspect`, `rebase_db_branch_switch`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, las herramientas del servidor de desarrollo y las herramientas
  de registro de proyectos. Estas escriben archivos locales o estado local y no tienen
  un destino remoto que verificar.
- **Con compuerta frente a `DATABASE_URL`:** las herramientas restantes de la CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Con compuerta frente a `baseUrl` del proyecto:** las herramientas restantes del SDK —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`
  e `invoke_function`.

Los dos destinos no son intercambiables. Las herramientas de la CLI nunca ven
`baseUrl`, por lo que un backend en localhost junto a una `DATABASE_URL` de
producción se comprueba contra la base de datos, no contra el backend.

Un rechazo se ve así:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si no se puede resolver ninguna cadena de conexión, las herramientas de base de datos con compuerta son rechazadas.**
Sin `DATABASE_URL`, la CLI usa la base de datos de desarrollo administrada, que es
la predeterminada para un nuevo proyecto, y la compuerta rechaza sus cuatro herramientas
de base de datos en ese caso. El rechazo explica el motivo y señala lo que funciona
en su lugar. No sugiere la desactivación voluntaria:

```text
Error: Refusing to run "rebase_db_push": project "default" sets no DATABASE_URL, so the
CLI would use the managed development database (PGlite, started by `rebase dev`). You
most likely do not need this tool: the dev server applies the collections to that
database at boot, additively. After changing a collection, restart it with
rebase_dev_stop and rebase_dev_start. …
```

Desde una terminal,
`rebase db push` y `rebase db migrate` sí se ejecutan en esa base de datos; solo se
rechazan las herramientas de MCP. En la versión 0.24, la CLI también las rechaza allí.

Solo loopback cuenta como local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
(y `0.0.0.0`).
Los rangos privados como `10.x` y `192.168.x` **no** lo hacen —es tan probable que
sean un clúster de staging compartido como un ordenador portátil, y tratarlos como
locales daría paso exactamente al accidente que la compuerta busca evitar.

Establezca `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desactivar esta protección.
Establecerlo globalmente en la configuración de su cliente MCP elimina la compuerta
para cada proyecto al que el servidor pueda acceder, no solo aquel en el que estaba pensando.

## Marcado de datos no confiables

Las filas, los registros de usuario, los listados de almacenamiento, los trabajos cron,
las respuestas de funciones y la salida de la CLI se devuelven envueltos en un contenedor
explícito:

```text
<<<UNTRUSTED_DATA source="list_documents" id="9b2f4c1e-…">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA id="9b2f4c1e-…">>>
```

Cualquier cosa almacenada en su base de datos fue escrita por alguien y llega por el
mismo canal que el contrato de herramientas que el asistente está siguiendo. El
contenedor le indica al modelo que lo trate como contenido inerte en lugar de instrucciones.

El `id` se genera de forma única para cada respuesta, después de que los datos fueron
escritos, y solo el marcador final que lo contiene cierra el bloque. El texto dentro
de los datos que tenga forma de marcador se rompe con un espacio de ancho cero, de
modo que una fila que imprima `<<<END_UNTRUSTED_DATA>>>` no puede cerrar el contenedor
antes de tiempo y dejar lo que sigue afuera.

El [endpoint remoto](/docs/ai/remote-mcp/) delimita los resultados de sus herramientas
de la misma manera y así se lo indica al cliente; su `structuredContent` lleva el
resultado sin formato. `list_collections` y `describe_collection` son las excepciones:
solo un modelo las lee, por lo que se envían una vez, en el texto. Antes de la versión
0.24, el listado también incluía una copia en `structuredContent`.

Es un marcador, no un sandbox. Un asistente con estas herramientas es tan seguro como
el contenido que le permite leer.

## Múltiples proyectos

Las configuraciones de los proyectos se almacenan en `~/.rebase/projects.json`, y el
servidor puede albergar varios a la vez —útil cuando trabaja entre entornos locales
y remotos. Mientras `rebase dev` está en ejecución, el servidor lee el puerto activo
y la clave de servicio desde `.rebase/state.json` en el directorio del proyecto, lo
que hace que el caso local no requiera configuración.

:::note[El registro es la última palabra, no la primera]
La precedencia es la mencionada arriba: bloque de entorno, luego el directorio de
trabajo cuando contiene un `rebase.json`, y luego el `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` y `REBASE_API_TOKEN` reconstruyen el
proyecto `default` **en cada inicio**, no solo en el primero. La reconstrucción es
por entrada completa: un token registrado para el antiguo `projectDir` se descarta
en lugar de transferirse a un directorio para el cual nunca fue emitido. Un `default`
derivado de esa manera —o desde el directorio de trabajo— nunca se vuelve a escribir
en `~/.rebase/projects.json`, por lo que la clave de servicio de desarrollo de un
proyecto no puede convertirse en la de otro.

`activeProject` es persistente, de modo que si una sesión anterior llamó a
`rebase_project_switch`, las herramientas apuntan a ese proyecto y el servidor lo
indica en stderr —a menos que ese proyecto esté registrado bajo un directorio
*diferente* de aquel en el que se ejecuta este servidor, en cuyo caso recurre a
`default` y así lo indica. Si un asistente parece estar leyendo la base de datos
equivocada, llame a `rebase_project_current` primero.
:::

Los tokens se almacenan en ese registro **en texto plano**. Es un archivo en su
directorio de usuario que contiene credenciales de administrador para cada proyecto
que haya registrado; trátelo en consecuencia.

## Rebase Cloud

Ocho herramientas llevan una aplicación desde este directorio hasta un backend en
producción en [Rebase Cloud](/docs/deployment/cloud/) y la mantienen en funcionamiento.
Cada una genera `rebase cloud <command> --json` en el directorio del proyecto activo:
el mismo comando que ejecutaría una persona, por lo que no hay una segunda
implementación que pueda divergir de él.

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

El flujo habitual del agente es: `rebase_cloud_provision`, luego proporcionar al
usuario la URL de reclamo; `rebase_cloud_status` para ver el proyecto (mientras no esté
reclamado, `unclaimed` contiene la URL de reclamo y cuándo se elimina); `rebase_cloud_deploy`
tras un cambio; `rebase_cloud_logs` cuando algo funciona mal; y
`rebase_cloud_rollback` cuando producción tiene problemas.

**Sobre qué actúan.** El proyecto al que el directorio activo está vinculado en
`.rebase/cloud.json`. Ninguna de ellas toma un id de proyecto ni un directorio, por lo
que un asistente no puede apuntarlas a otro proyecto distinto de aquel al que el
directorio está vinculado. Cambiar el proyecto activo con `rebase_project_switch`
cambia el directorio en el que se ejecutan.

**Bajo qué autoridad.** Lo que sea que la CLI resuelva en ese directorio: `REBASE_TOKEN`
cuando esté configurado, luego el token que `rebase cloud init --claim` almacenó para
un proyecto no reclamado, y después la sesión de `rebase cloud login`. En el directorio
de ese proyecto no reclamado, un `REBASE_TOKEN` que no posea ningún alcance sobre el
proyecto se deja a un lado a favor del propio token del proyecto. El plano de control
verifica cada llamada tal como verifica las de la CLI, por lo que con un token creado
mediante `rebase cloud tokens create --can logs` un asistente puede leer registros, y el
plano de control rechazará sus despliegues, variables y rollbacks. Si no hay
credencial o se rechaza una, se devuelve un error que indica lo que el usuario debe
hacer (`rebase cloud login` o reclamar el proyecto).

**Por qué no se aplica la compuerta de loopback.** La compuerta comprueba la `baseUrl`
de la aplicación y la `DATABASE_URL` de la CLI; estas herramientas no usan ninguna de
las dos. Después de `rebase_cloud_provision`, `REBASE_BASE_URL` apunta al nuevo
proyecto en la nube, por lo que aplicar la compuerta sobre ella rechazaría el mismo
despliegue que el flujo necesita. El aprovisionamiento en sí solo crea: no altera ninguna
aplicación ni base de datos existente, y la CLI aún lo rechaza en un directorio que
ya está vinculado. Un despliegue, una variable y un rollback modifican cada uno la
producción. Lo que se interpone frente a ellos es la credencial mencionada anteriormente
y la aprobación de herramientas de su cliente MCP. Para evitar que un asistente
modifique un proyecto en la nube, configure `REBASE_TOKEN` en el entorno del servidor
con un token que no tenga las capacidades `deploy` y `env`.

**Leer cualquiera de sus proyectos.** Las herramientas anteriores actúan sobre el
proyecto vinculado. Para leer los datos de otro proyecto —cualquier proyecto en cualquier
organización a la que pertenezca la cuenta que inició sesión, vinculado aquí o no—,
`rebase_cloud_projects_list` los lista y `rebase_project_use_cloud` (con un id, slug o
nombre) apunta las herramientas de datos y de administración hacia él: `list_documents`,
`get_document`, `list_users`, `list_roles`, `cron_list_jobs`, `storage_list_objects`.
Esas llamadas pasan a través del proxy de Studio de la consola, portando la credencial
propia de la CLI (`rebase cloud access-token`, leída por llamada y nunca almacenada);
el plano de control comprueba el acceso del usuario y adjunta la clave de servicio del
proyecto por su cuenta, de modo que ninguna clave llega a la máquina. Un proyecto con
Studio desactivado es rechazado, y el selector así lo indica. Es un destino remoto
como cualquier otro, por lo que las herramientas que modifican datos permanecen
rechazadas allí a menos que `REBASE_MCP_ALLOW_REMOTE_WRITES` esté configurado;
`rebase_project_switch` vuelve atrás.

Cada herramienta es una instantánea:

- `rebase_cloud_logs` nunca sigue los registros en tiempo real. Su resultado incluye
  `nextSinceTime`; páselo de vuelta como `since` para leer lo que vino después.
  Devuelve las últimas 200 líneas a menos que `tail` indique lo contrario.
  `source: "build"` devuelve en su lugar el registro de compilación más reciente.
- `rebase_cloud_deploy` sigue el despliegue hasta el final y comprueba que la nueva
  versión responda. `wait: false` responde tan pronto como se activa el despliegue.
  Nunca expulsa un proyecto del runtime administrado, despliega una versión anterior
  del framework ni omite las verificaciones de compilación: esas son decisiones del
  usuario, y un rechazo que requiera una de ellas así lo indicará.
- `rebase_cloud_rollback` pasa `--yes`. La llamada a la herramienta es la confirmación,
  ya que no hay una terminal en la que preguntar.

`rebase_cloud_env_set` escribe el valor en la entrada estándar de la CLI, por lo que
nunca está en una línea de comandos donde `ps` pudiera mostrarlo, y el valor se excluye
de cualquier cosa que la herramienta devuelva. Su resultado indica qué se almacenó (la
clave, si es secreta, si hay un redespliegue pendiente), nunca el valor. `rebase_cloud_env_list`
lista únicamente las claves. Una CLI más antigua que `env set --stdin` es rechazada
con un mensaje para actualizarla; el valor no se envía de otra manera.

Los resultados se devuelven en el [contenedor de datos no confiables](#marcado-de-datos-no-confiables),
precedidos por una línea del servidor sobre qué hacer a continuación. Un rechazo es un
error de herramienta que incluye el código de la CLI, como `no_project`,
`token_rejected`, `managed_project` o `deploy_failed`. Cuando el servidor reconoce el
código, añade el siguiente paso, seguido del mensaje propio de la CLI. Cada herramienta
verifica sus argumentos contra el esquema que anuncia antes de generar nada, y rechaza
cualquier argumento que no declare.

## Referencia de herramientas

53 herramientas, en diez grupos: esquema y base de datos, planificación de esquemas,
documentos, usuarios y roles, almacenamiento, cron, funciones, el servidor de
desarrollo, el registro de proyectos y Rebase Cloud.
Cada una, con lo que necesita y si la compuerta la rechaza frente a un destino no local,
se encuentra en la [Referencia de herramientas MCP](/docs/ai/mcp-tool-reference).

## Recursos

Más allá de las herramientas, el servidor expone recursos de MCP para que un cliente
pueda obtener contexto del proyecto sin consumir una llamada a una herramienta:

| URI | Descripción |
|---|---|
| `rebase://collections/{name}` | Código fuente en TypeScript de la definición de una colección |
| `rebase://schema` | El esquema generado de Drizzle (`schema.generated.ts`) |

Las colecciones se detectan a partir de `app/config/collections/`,
`config/collections/` o `collections/` bajo el directorio del proyecto activo —el
que exista.

`rebase://schema` se lista **solo si** el esquema generado existe.
`findBackendDir` busca `backend/` y luego `app/backend/` bajo el directorio del
proyecto activo, y lee `src/schema.generated.ts` de cualquiera que encuentre —de
modo que tanto la estructura generada por el scaffold como la de este monorrepo
funcionan, y un proyecto estructurado de una tercera forma, o uno que aún no haya
ejecutado `rebase schema generate`, simplemente no verá ofrecido el recurso.

## El endpoint remoto

Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, a las
personas que usan su aplicación, conectándose cada una como ellas mismas bajo su propia
seguridad a nivel de fila. Eso tiene su propia página:
[El endpoint MCP remoto](/docs/ai/remote-mcp/).

## Configuración recomendada

- Apunte el servidor a un proyecto **local** y deje `REBASE_MCP_ALLOW_REMOTE_WRITES`
  sin configurar. La compuerta es el elemento individual más valioso del paquete.
- Para cualquier entorno remoto, registre una **clave de API `rk_` con alcance restringido**
  en lugar de permitir que la detección entregue una clave de servicio.
- Compruebe `rebase_project_current` cuando la salida parezca incorrecta. El proyecto
  activo es persistente y reside fuera de su repositorio.
- Trate `~/.rebase/projects.json` como un archivo de secretos.
