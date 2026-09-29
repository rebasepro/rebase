---
sourceHash: 7a7a97c334fa87c6
title: Servidor MCP
sidebar_label: Servidor MCP
description: "Conecta Claude Code, Cursor, Gemini CLI o cualquier cliente MCP a un proyecto de Rebase: las 42 herramientas que expone, la credencial con la que se autentica y la barrera de loopback que se interpone entre un agente y producción."
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
distinto: consulta [El endpoint remoto](#the-remote-endpoint).

## Conectar un cliente

El servidor está publicado en npm y no necesita ningún paso de instalación; `npx` lo descarga.
Cada bloque a continuación representa la integración completa.

<span class="since-badge" data-since="0.24">Desde 0.24</span> `rebase init` escribe el bloque para cada agente que elijas cuando
[configura tus agentes de programación con IA](/docs/ai/skills#set-up-by-rebase-init), manteniendo
cualquier otro servidor que ya esté en el archivo. `rebase init --agent cursor,codex` hace
lo mismo sin preguntar.

**Claude Code** — `.mcp.json` en la raíz de tu proyecto. `rebase init` escribe este
archivo por ti:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
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
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
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
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
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
command = "npx"
args = ["-y", "@rebasepro/mcp"]

[mcp_servers.rebase.env]
REBASE_PROJECT_DIR = "."
```

**Kiro** — `.kiro/settings/mcp.json`:

```json title=".kiro/settings/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
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
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
      "env": {
        "REBASE_PROJECT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

**Windsurf** lee los servidores MCP únicamente desde su configuración a nivel de usuario,
por lo que no hay ningún archivo de proyecto que escribir. Añade el servidor en la configuración
de MCP de Windsurf, con una ruta absoluta en `REBASE_PROJECT_DIR`.

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

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` del entorno
2. `REBASE_SERVICE_KEY` leída desde el `.env` del proyecto
3. La clave de servicio descubierta automáticamente desde `.rebase/state.json` mientras
   `rebase dev` está en ejecución

Un token que registres para un proyecto **prevalece sobre el autodescubrimiento**. El
descubrimiento solo llena vacíos.

:::danger[La vía sin configuración es una credencial de administrador]
Las opciones 2 y 3 corresponden a la **clave de servicio** (service key): un secreto de
administrador sin restricciones de alcance. El backend la resuelve a `uid: "service"`,
`roles: ["admin"]`, `isAdmin: true`. Esa identidad omite la lista de permisos de las claves
de API por completo y satisface las políticas `_default_admin_read` / `_default_admin_write`
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
barreras se aplicará de verdad. Una clave que no sea de administrador se ejecuta con los roles
`["service"]`, los cuales las políticas de administración inyectadas **no** nombran; por lo tanto,
RLS no le otorga nada a menos que una de tus propias políticas indique lo contrario, y la lista
de permisos la restringe aún más:

```bash
rebase api-keys create -n "claude-code" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Luego, entrega la clave `rk_live_…` resultante al servidor en lugar de dejar que descubra
una clave de servicio:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"],
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
- **Una clave que no sea de administrador no puede utilizar las herramientas de administración.**
  `list_users`, `create_user`, `update_user`, `delete_user`, `list_roles` y `rebase_auth_reset_password`
  se encuentran tras `requireAdmin` y fallarán con una clave restringida. Esto es el sistema
  funcionando como debe, pero implica tener que elegir entre alcance amplio o restringido en
  lugar de disponer de ambos.

Una clave de API con `admin: true` es un asunto diferente: cuenta con los roles
`["admin", "service"]`, lo que cumple las mismas políticas de administración predeterminadas
que la clave de servicio. En el plano de datos, su alcance es el mismo que el de la clave de
servicio. La diferencia es que es **revocable, puede expirar y cuenta con límites de tasa por clave**,
características que no aplican a la clave de servicio; rotar esa última requiere editar `.env`
y reiniciar el servidor.

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
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Sin restricción — solo locales:** `rebase_schema_introspect`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, las herramientas del servidor de desarrollo y las herramientas del registro de proyectos.
  Estas escriben archivos locales o estado local y no tienen un destino remoto que verificar.
- **Restringidas contra `DATABASE_URL`:** las herramientas de CLI restantes — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Restringidas contra la `baseUrl` del proyecto:** las herramientas del SDK restantes —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Los dos destinos no son intercambiables. Las herramientas de CLI nunca ven `baseUrl`, por lo
que un backend en localhost situado junto a una `DATABASE_URL` de producción se comprueba
contra la base de datos, no contra el backend.

Un rechazo tiene este aspecto:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si no se puede resolver ninguna cadena de conexión, las herramientas de base de datos son rechazadas** —
un destino no verificable no es un destino seguro:

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Solo loopback cuenta como local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
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

## Referencia de herramientas

42 herramientas, en nueve grupos. Las herramientas marcadas con ⚠ se rechazan frente a destinos
no locales a menos que desactives la protección.

### Esquema y base de datos (12)

Ejecutan la CLI de Rebase en el directorio del proyecto activo.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_schema_generate` | — | Generar esquema de Drizzle a partir de las definiciones de colecciones |
| `rebase_db_push` ⚠ | — | Aplicar el esquema directamente a la base de datos (atajo para desarrollo) |
| `rebase_schema_introspect` | — | Introspeccionar la base de datos activa a definiciones de colecciones |
| `rebase_db_generate` | — | Generar archivos de migración SQL a partir de cambios en el esquema |
| `rebase_db_migrate` ⚠ | — | Ejecutar todas las migraciones SQL pendientes |
| `rebase_generate_sdk` | — | Generar el SDK de TypeScript completamente tipado |
| `rebase_doctor` | — | Detectar discrepancias entre definiciones, esquema generado y la base de datos activa |
| `rebase_db_branch_create` ⚠ | `name` | Crear una rama de base de datos (solo administradores) |
| `rebase_db_branch_list` | — | Listar ramas de base de datos (solo administradores) |
| `rebase_db_branch_delete` ⚠ | `name` | Eliminar una rama de base de datos (solo administradores) |
| `rebase_db_branch_info` | `name` | Información y estado de la rama (solo administradores) |
| `rebase_db_branch_switch` | — | Apuntar este checkout a una rama, o de vuelta a la base de datos principal (solo administradores) |

### Planificación de esquema (1)

Pregunta al backend qué haría un cambio, a través de `POST /api/admin/schema/plan`. Sin CLI
y sin escribir nada en disco; funciona en la base de datos de desarrollo administrada,
algo que los comandos respaldados por Atlas no pueden hacer.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | El SQL que ejecutaría el cambio de una colección y qué sentencias destruyen datos |

### Documentos (5)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `list_documents` | `collection` | Listar filas, con `limit`, `offset`, `orderBy`, `where` opcionales |
| `get_document` | `collection`, `id` | Obtener una sola fila por ID |
| `create_document` ⚠ | `collection`, `data` | Crear una fila |
| `update_document` ⚠ | `collection`, `id`, `data` | Actualizar una fila |
| `delete_document` ⚠ | `collection`, `id` | Eliminar una fila |

### Usuarios y roles (6)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `list_users` | — | Listar todos los usuarios, incluidos los roles |
| `create_user` ⚠ | `email` | Crear un usuario (`displayName`, `password`, `roles` opcionales) |
| `update_user` ⚠ | `uid` | Actualizar correo electrónico, nombre para mostrar o roles |
| `delete_user` ⚠ | `uid` | Eliminar un usuario |
| `list_roles` | — | Listar roles definidos |
| `rebase_auth_reset_password` ⚠ | `email` | Restablecer una contraseña a través de la API de administración |

`create_user` y `update_user` aceptan `roles`, por lo que cualquiera de los dos puede otorgar
permisos de administrador. Por eso están restringidos en lugar de ser tratados simplemente como "aditivos".

### Almacenamiento (3)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `storage_list_objects` | — | Listar objetos almacenados |
| `storage_get_download_url` | `key` | Una URL de descarga firmada temporal y su caducidad (no metadatos del objeto) |
| `storage_delete_object` ⚠ | `key` | Eliminar un objeto |

`storage_get_download_url` se clasifica como lectura porque no modifica el entorno, pero la URL
firmada que genera es una capacidad portadora que perdura más allá de la llamada a la herramienta.

### Cron (5)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `cron_list_jobs` | — | Listar tareas programadas y su estado |
| `cron_get_job` | `jobId` | Detalles de la tarea |
| `cron_get_job_logs` | `jobId` | Registros de ejecución |
| `cron_trigger_job` ⚠ | `jobId` | Ejecutar una tarea inmediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Habilitar o deshabilitar una tarea |

`cron_toggle_job` puede deshabilitar silenciosamente una copia de seguridad o una tarea de
facturación; un cambio sin errores y sin salida hasta que falte algo más adelante.

### Funciones (1)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invocar una [función personalizada](/docs/backend/custom-functions) con cualquier método y carga útil |

Esto llama a código que el servidor MCP nunca ha visto, con un método y cuerpo elegidos por
el modelo. Su radio de impacto abarca todo lo que hagan tus funciones.

### Servidor de desarrollo (3)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_dev_start` | — | Iniciar el servidor de desarrollo; retorna inmediatamente |
| `rebase_dev_logs` | — | Leer la salida reciente (por defecto 50 líneas, búfer de 500 líneas) |
| `rebase_dev_stop` | — | Detener el servidor de desarrollo |

### Registro de proyectos (6)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_project_list` | — | Listar proyectos registrados y mostrar el activo |
| `rebase_project_switch` | `name` | Cambiar el proyecto activo |
| `rebase_project_add` | `name` | Registrar un proyecto (`baseUrl`, `projectDir` opcional, `token`) |
| `rebase_project_remove` | `name` | Eliminar un proyecto (el proyecto predeterminado no se puede eliminar) |
| `rebase_project_current` | — | Mostrar el proyecto activo y su estado de autenticación |
| `rebase_project_status` | — | Comprobar el estado de salud del backend activo |

`rebase_project_switch` no está restringido porque redirige todo lo demás en lugar de actuar
sobre un destino en sí mismo. Por lo tanto, un asistente puede cambiar a un proyecto remoto
sin activar la barrera; simplemente no podrá ejecutar una herramienta destructiva allí después.

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

Todo lo anterior es una herramienta para desarrolladores: se ejecuta en tu máquina y utiliza
una clave de servicio o una clave de API. Un backend desplegado también puede servir MCP por
sí mismo, en `/mcp`, para las personas que usan tu aplicación. Un asistente que alguno de ellos
conecte lee y escribe en el proyecto **como esa persona**, y cada llamada se ejecuta bajo su
propia seguridad a nivel de fila (RLS).

Está desactivado a menos que lo actives, y ambas variables son obligatorias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sin `REBASE_PUBLIC_URL`, un secreto JWT o un controlador de datos que pueda restringir una
consulta a un usuario, el endpoint se niega a montarse y explica el motivo en el registro
de inicio. Ningún `REBASE_ROLE` lo activa.

- **OAuth, con pantalla de consentimiento.** Un cliente encuentra el servidor de autorización
  a través de `/.well-known/oauth-protected-resource`, se registra (el registro dinámico está
  activado por defecto; `REBASE_MCP_OPEN_REGISTRATION=false` lo limita a los clientes que
  registres) y envía a la persona a una pantalla de consentimiento que inicia su sesión a
  través de tu `/auth/login` existente.
- **Seis herramientas, dos ámbitos (scopes).** `mcp:read` ofrece `list_collections`,
  `query_collection` y `get_document`; `mcp:write` añade `create_document`, `update_document`
  y `delete_document`. Un ámbito decide qué herramientas se ofrecen, no qué filas: una lista
  vacía puede ser resultado del funcionamiento de RLS, y `mcp:write` sigue sin poder escribir
  una fila que la persona no podría.
- **Un token solo para este endpoint.** Un token de acceso MCP es rechazado por `/api/data`,
  `/api/admin` y el WebSocket, por lo que conectar un asistente no le otorga una sesión.

Una limitación. Desconectar un cliente (`DELETE /api/oauth/grants/:clientId`, con la propia
sesión de la persona) revoca sus tokens de actualización de inmediato, pero un token de
acceso ya emitido sigue funcionando hasta que expire, dentro de una hora. Esa misma hora
delimita todo lo demás: cada actualización vuelve a leer los roles de la persona y rechaza
una cuenta que haya sido eliminada o una concesión anterior a su último "cerrar sesión en
todas partes" o cambio de contraseña. De este modo, una degradación de rol o un cierre de
sesión llega a un cliente conectado en el plazo de vida útil de un token de acceso. Una
sesión de invitado no puede otorgar consentimiento en absoluto.

Las rutas se encuentran en [Endpoints](/docs/backend/endpoints/#mcp-surface) y las
variables en [Configuración](/docs/getting-started/configuration/#mcp-surface).

## Configuración recomendada

- Apunta el servidor a un proyecto **local** y deja `REBASE_MCP_ALLOW_REMOTE_WRITES` sin
  definir. La barrera es lo más valioso del paquete.
- Para cualquier entorno remoto, registra una **clave de API `rk_` con alcance restringido**
  en lugar de permitir que el descubrimiento entregue una clave de servicio.
- Comprueba `rebase_project_current` cuando la salida parezca incorrecta. El proyecto activo
  es persistente y reside fuera de tu repositorio.
- Trata `~/.rebase/projects.json` como un archivo de secretos.
