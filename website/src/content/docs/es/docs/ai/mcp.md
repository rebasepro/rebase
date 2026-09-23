---
sourceHash: 5a197121af0d5219
title: Servidor MCP
sidebar_label: Servidor MCP
description: "Conecta Claude Code, Cursor, Gemini CLI o cualquier cliente MCP a un proyecto Rebase: las 42 herramientas que expone, la credencial con la que se autentica y la compuerta de loopback que se interpone entre un agente y producción."
---

`@rebasepro/mcp` es un servidor de [Model Context Protocol](https://modelcontextprotocol.io)
que proporciona a un asistente de IA herramientas reales sobre un proyecto Rebase: leer y
escribir filas, gestionar usuarios, ejecutar migraciones, invocar funciones y controlar el
servidor de desarrollo.

Se comunica mediante MCP **solo a través de stdio**. No hay puerto ni listener; el
proceso es exactamente tan confiable como lo que sea que lo haya generado, y no hay ningún
llamador remoto al que autenticar. Esa es la parte segura. Las preguntas interesantes giran
en torno a lo que hace *una vez* que se está ejecutando, y esta página las responde antes
de mostrarte el bloque de configuración.

Un backend desplegado también puede servir MCP por sí mismo, a través de HTTP, para las personas
que usan tu aplicación. Eso es algo diferente con un modelo de credenciales distinto:
consulta [El endpoint remoto](#el-endpoint-remoto).

## Conectar un cliente

El servidor está publicado en npm y no requiere un paso de instalación; `npx` lo descarga.
Cada bloque a continuación representa la integración completa.

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

**Cursor** — la misma estructura, en `.cursor/mcp.json`:

```json title=".cursor/mcp.json"
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

**Codex CLI** — TOML en lugar de JSON, en `~/.codex/config.toml`. Es a nivel
de usuario, no por proyecto, así que indica aquí el directorio del proyecto:

```toml title="~/.codex/config.toml"
[mcp_servers.rebase]
command = "npx"
args = ["-y", "@rebasepro/mcp"]
env = { REBASE_PROJECT_DIR = "/absolute/path/to/your/project" }
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

Cualquier cliente MCP que pueda iniciar un servidor stdio funciona; la estructura es la misma.

### En qué directorio actúa

`REBASE_PROJECT_DIR` es el directorio que contiene `rebase.json`. Existe **un**
orden de precedencia, y es el mismo en todos los clientes:

1. **El bloque de entorno** — `REBASE_PROJECT_DIR`, `REBASE_BASE_URL`,
   `REBASE_API_TOKEN`. Si alguno de ellos está definido, el proyecto `default` se reconstruye
   a partir de ellos en cada inicio.
2. **El directorio de trabajo del servidor**, cuando contiene un `rebase.json`. Un proyecto
   en el que te encuentras tiene prioridad sobre cualquier cosa recordada en `~/.rebase/projects.json`.
3. **El `default` persistido** en `~/.rebase/projects.json`, cuando ninguno de los dos
   primeros especifica nada.

El autodescubrimiento desde `.rebase/state.json` completa los vacíos en los tres casos y nunca
anula un valor suministrado por alguno de ellos.

Los bloques a nivel de proyecto configuran `REBASE_PROJECT_DIR` como `"."` (el directorio de
trabajo del cliente es el proyecto) porque la regla 3 lee un archivo compartido por todos
los proyectos de la máquina. El bloque de Codex es a nivel de usuario en lugar de por proyecto,
por lo que especifica una ruta absoluta en su lugar.

## Qué puede alcanzar el servidor

Esta es la sección que debes leer antes de apuntar un asistente a una base de datos que te
importe.

El servidor cuenta con **una única credencial ambiental para todo el proceso**. No hay
identidad por herramienta ni modo de solo lectura; cada herramienta usa el mismo token, y
la única opción en el paquete permite habilitar *más* alcance en lugar de menos.

Qué credencial es, en orden de prioridad:

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` del entorno
2. `REBASE_SERVICE_KEY` leída desde el `.env` del proyecto
3. La service key autodescubierta desde `.rebase/state.json` mientras `rebase dev`
   se está ejecutando

Un token que registres para un proyecto **tiene prioridad sobre el autodescubrimiento**. El descubrimiento solo
llena un vacío.

:::danger[La ruta de configuración cero es una credencial de administrador]
Las opciones 2 y 3 corresponden a la **service key**, un secreto de administrador sin restricciones de alcance. El backend
lo resuelve a `uid: "service"`, `roles: ["admin"]`, `isAdmin: true`. Esa
identidad omite por completo la lista de permisos de las API keys y cumple con las
políticas `_default_admin_read` / `_default_admin_write` que Rebase inyecta en
cada colección que no haya definido `disableDefaultPolicies`.

Por lo tanto, la respuesta honesta a "¿sigue RLS limitándolo?" es: RLS *se ejecuta*
(el driver se degrada al rol `rebase_user`) y luego una política escrita por el
propio Rebase otorga todo a esa identidad. Leer cada fila de cada
colección es el **comportamiento diseñado de la configuración por defecto**, no una
elusión.

Con la configuración cero, un agente en posesión de estas herramientas puede leer y escribir cada
fila de cada colección, listar a todos los usuarios, restablecer cualquier contraseña, invocar cualquier
función del backend y ejecutar DDL contra cualquier `DATABASE_URL` que resuelva el proyecto.
:::

### Proporcionarle una credencial restringida en su lugar

Registra una [API key](/docs/backend/api-keys) con alcance limitado y el modelo de dos compuertas
se aplicará de verdad. Una clave que no sea de administrador se ejecuta con los roles `["service"]`, los cuales
las políticas de administrador inyectadas **no** nombran; por lo tanto, RLS no le concede nada a menos que una de
tus propias políticas indique lo contrario, y la lista de permisos la restringe aún más:

```bash
rebase api-keys create -n "claude-code" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Luego, pasa la clave `rk_live_…` resultante al servidor en lugar de dejar que
descubra una service key:

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

Dos cosas que esto **no** hace, y que vale la pena saber antes de confiar en ello:

- **No restringe las herramientas de la CLI.** `rebase_db_push`, `rebase_db_migrate`,
  `rebase_doctor` y las herramientas de ramas ejecutan la CLI de Rebase, la cual se conecta con
  `DATABASE_URL` y nunca llega a ver tu token. La compuerta de loopback a continuación es lo
  único que se interpone ante ellas.
- **Una clave sin permisos de administrador no puede usar las herramientas de administración.** `list_users`, `create_user`,
  `update_user`, `delete_user`, `list_roles` y `rebase_auth_reset_password`
  residen detrás de `requireAdmin` y fallarán con una clave restringida. Así es como debe
  funcionar el sistema, pero significa que debes elegir entre alcance o restricción en lugar de
  tener ambos.

Una API key con `admin: true` es un asunto diferente: cuenta con los roles
`["admin", "service"]`, lo que cumple las mismas políticas de administrador predeterminadas que la service
key. En el plano de datos, su alcance es el mismo que el de la service key. Lo que aporta es que es
**revocable, expirable y tiene límites de tasa por clave**, nada de lo cual aplica a
la service key; rotar esta última implica editar `.env` y reiniciar el servidor.

Consulta [Agentes y servidores MCP](/docs/backend/api-keys#agents-and-mcp-servers) para ver la
guía completa sobre la definición del alcance de las claves.

### Dejar una colección completamente fuera de su alcance

La razón por la que una credencial de administrador puede leer todo es la política de referencia que Rebase
inyecta en cada colección, otorgando acceso al contexto del servidor de confianza y al
rol `admin`. Una colección puede excluirse de esa línea base y asumir la
responsabilidad total de su propio RLS:

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

Ahora la única forma de acceder es coincidir con `patient_id`. El uid de la service key es la
cadena literal `service`, por lo que una regla de propietario nunca coincidirá con él: las lecturas devolverán cero
filas y las escrituras serán rechazadas por Postgres. Este es el único control que restringe
la credencial por defecto del servidor MCP en lugar de darla por sentado.

Recuerda que este es un cambio real de RLS, no meramente documental: solo surte efecto
una vez que `rebase schema generate` y una migración hayan aplicado las políticas. Consulta
[Reglas de seguridad (RLS)](/docs/collections/security-rules).

## La compuerta de loopback

`rebase_project_add` acepta cualquier `baseUrl`, y las herramientas de la CLI se conectan con
cualquier `DATABASE_URL` que declare el proyecto. Por lo tanto, la misma lista de herramientas que edita una
base de datos de prueba en tu portátil puede eliminar filas de producción, sin nada
de por medio excepto el criterio del asistente sobre qué proyecto está activo.

**Cualquier herramienta que modifique el entorno de destino es rechazada a menos que ese destino esté
en la interfaz loopback.** La compuerta está diseñada como una lista de lo que *no*
está bloqueado, por lo que cualquier herramienta agregada posteriormente estará protegida por defecto.

- **Sin restricción — lecturas:** `rebase_schema_plan`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_download_url`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **Sin restricción — solo locales:** `rebase_schema_introspect`, `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, las herramientas del servidor de desarrollo y las del registro de proyectos.
  Estas escriben archivos locales o estado local y no tienen un destino remoto que verificar.
- **Restringidas según `DATABASE_URL`:** el resto de las herramientas de la CLI: `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Restringidas según la `baseUrl` del proyecto:** el resto de las herramientas del SDK:
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Los dos destinos no son intercambiables. Las herramientas de la CLI nunca ven `baseUrl`, por lo que si un
backend en localhost apunta a una `DATABASE_URL` de producción, se verificará contra
la base de datos, no contra el backend.

Un rechazo se ve así:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si no se puede resolver ninguna cadena de conexión, las herramientas de base de datos serán rechazadas**;
un destino no verificable no es un destino seguro:

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Solo loopback cuenta como local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
Los rangos privados como `10.x` y `192.168.x` **no** cuentan: es tan probable que sean
un clúster de staging compartido como un portátil, y tratarlos como locales permitiría pasar
exactamente el accidente que la compuerta busca evitar.

Establece `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desactivar esta protección. Configurarlo globalmente en la
configuración de tu cliente MCP elimina la compuerta para cada proyecto que el servidor pueda alcanzar, no
solo para aquel en el que estabas pensando.

## Marcado de datos no confiables

Las filas, los registros de usuario, los listados de almacenamiento, los trabajos cron, las respuestas de funciones y la
salida de la CLI se devuelven envueltos en un contenedor explícito:

```text
<<<UNTRUSTED_DATA source="list_documents">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA>>>
```

Cualquier cosa almacenada en tu base de datos fue escrita por alguien, y llega por
el mismo canal que el contrato de herramientas que el asistente está siguiendo. El contenedor le indica
al modelo que lo trate como contenido inerte en lugar de instrucciones.

Es un marcador, no un entorno aislado (sandbox). Un asistente que disponga de estas herramientas solo será tan seguro
como el contenido que le permitas leer.

## Múltiples proyectos

Las configuraciones de los proyectos se almacenan en `~/.rebase/projects.json`, y el servidor
puede mantener varios a la vez, lo cual es útil cuando trabajas en entornos locales y remotos.
Mientras `rebase dev` se está ejecutando, el servidor lee el puerto activo y
la service key desde `.rebase/state.json` en el directorio del proyecto, que es lo que
hace que el caso local funcione sin configuración.

:::note[El registro es la última palabra, no la primera]
La precedencia es la indicada anteriormente: el bloque de entorno, luego el directorio de trabajo
cuando contiene un `rebase.json`, y finalmente el `default` persistido.

`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` y `REBASE_API_TOKEN` reconstruyen el
proyecto `default` **en cada inicio**, no solo en el primero. La reconstrucción es
de la entrada completa: un token registrado contra el antiguo `projectDir` se descarta en
lugar de transferirse a un directorio para el cual nunca fue emitido. Un `default` derivado
de esa manera —o a partir del directorio de trabajo— nunca se reescribe en
`~/.rebase/projects.json`, por lo que la service key de desarrollo de un proyecto no puede convertirse en
la de otro.

`activeProject` es persistente (sticky), de modo que si una sesión anterior llamó a
`rebase_project_switch`, las herramientas apuntarán a ese proyecto y el servidor lo indicará en
stderr; a menos que ese proyecto esté registrado bajo un directorio *diferente* de
aquel en el que se ejecuta este servidor, en cuyo caso recurre a `default` y lo notifica.
Si parece que un asistente está leyendo la base de datos incorrecta, llama primero a
`rebase_project_current`.
:::

Los tokens se almacenan en ese registro **en texto plano**. Es un archivo en tu directorio
de inicio que contiene credenciales de administrador para cada proyecto que hayas registrado;
trátalo como corresponde.

## Referencia de herramientas

42 herramientas, en nueve grupos. Las herramientas marcadas con ⚠ son rechazadas contra destinos no locales
a menos que desactives la protección.

### Esquema y base de datos (12)

Ejecutan la CLI de Rebase en el directorio del proyecto activo.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_schema_generate` | — | Generar el esquema de Drizzle a partir de las definiciones de colecciones |
| `rebase_db_push` ⚠ | — | Aplicar el esquema directamente a la base de datos (atajo de desarrollo) |
| `rebase_schema_introspect` | — | Introspeccionar la base de datos en vivo para generar definiciones de colecciones |
| `rebase_db_generate` | — | Generar archivos de migración SQL a partir de cambios en el esquema |
| `rebase_db_migrate` ⚠ | — | Ejecutar todas las migraciones SQL pendientes |
| `rebase_generate_sdk` | — | Generar el SDK de TypeScript con tipado completo |
| `rebase_doctor` | — | Detectar desincronizaciones entre las definiciones, el esquema generado y la base de datos en vivo |
| `rebase_db_branch_create` ⚠ | `name` | Crear una rama de la base de datos (solo administradores) |
| `rebase_db_branch_list` | — | Listar ramas de la base de datos (solo administradores) |
| `rebase_db_branch_delete` ⚠ | `name` | Eliminar una rama de la base de datos (solo administradores) |
| `rebase_db_branch_info` | `name` | Información y estado de la rama (solo administradores) |
| `rebase_db_branch_switch` | — | Apuntar este checkout a una rama, o de vuelta a la base de datos principal (solo administradores) |

### Planificación de esquemas (1)

Pregunta al backend qué haría un cambio, mediante `POST /api/admin/schema/plan`. Sin
CLI y sin escribir nada en el disco: funciona en la base de datos de desarrollo administrada,
lo que los comandos respaldados por Atlas no pueden hacer.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | El SQL que ejecutaría el cambio de una colección, y qué sentencias destruyen datos |

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

Tanto `create_user` como `update_user` aceptan `roles`, por lo que cualquiera de los dos puede crear un
administrador. Por eso están restringidos en lugar de ser tratados como meramente "aditivos".

### Almacenamiento (3)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `storage_list_objects` | — | Listar objetos almacenados |
| `storage_get_download_url` | `key` | Una URL de descarga firmada temporal y su caducidad, no los metadatos del objeto |
| `storage_delete_object` ⚠ | `key` | Eliminar un objeto |

`storage_get_download_url` está clasificada como lectura porque no modifica el
entorno, pero la URL firmada que genera es una capacidad al portador que perdura más allá de
la llamada a la herramienta.

### Cron (5)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `cron_list_jobs` | — | Listar tareas programadas y su estado |
| `cron_get_job` | `jobId` | Detalles de la tarea |
| `cron_get_job_logs` | `jobId` | Registros de ejecución |
| `cron_trigger_job` ⚠ | `jobId` | Ejecutar una tarea inmediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Habilitar o deshabilitar una tarea |

`cron_toggle_job` puede deshabilitar de forma silenciosa una tarea de copia de seguridad o de facturación:
un cambio sin errores ni salidas visibles hasta que falte algo más adelante.

### Funciones (1)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invocar una [función personalizada](/docs/backend/custom-functions) con cualquier método y carga útil |

Esto invoca código que el servidor MCP nunca ha visto, con un método y cuerpo que el modelo
eligió. Su radio de impacto es lo que sea que hagan tus funciones.

### Servidor de desarrollo (3)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_dev_start` | — | Iniciar el servidor de desarrollo; regresa inmediatamente |
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
| `rebase_project_status` | — | Comprobar el estado del backend activo |

`rebase_project_switch` no está bloqueada, porque redirige todo lo demás
en lugar de actuar sobre un destino en sí mismo. Por lo tanto, un asistente puede cambiar a un
proyecto remoto sin activar la compuerta; simplemente no podrá ejecutar una herramienta destructiva
allí.

## Recursos

Más allá de las herramientas, el servidor expone recursos MCP para que un cliente pueda obtener
contexto del proyecto sin gastar una llamada a una herramienta:

| URI | Descripción |
|---|---|
| `rebase://collections/{name}` | Código fuente en TypeScript de la definición de una colección |
| `rebase://schema` | El esquema generado de Drizzle (`schema.generated.ts`) |

Las colecciones se detectan a partir de `app/config/collections/`,
`config/collections/` o `collections/` dentro del directorio del proyecto activo,
cualquiera que exista.

`rebase://schema` se lista **solo si** el esquema generado existe.
`findBackendDir` busca `backend/` y luego `app/backend/` dentro del directorio del
proyecto activo, y lee `src/schema.generated.ts` desde el que encuentre; por
lo tanto, tanto la estructura generada por defecto como la de este monorepositorio funcionan, y un proyecto estructurado de
una tercera forma, o uno que aún no haya ejecutado `rebase schema generate`,
simplemente no verá ofrecido el recurso.

## El endpoint remoto

Todo lo anterior es una herramienta de desarrollo: se ejecuta en tu máquina y posee una service
key o una API key. Un backend desplegado también puede servir MCP por sí mismo, en `/mcp`, para
las personas que usan tu aplicación. Un asistente que conecte cualquiera de ellos lee y
escribe en el proyecto **como esa persona**, y cada llamada se ejecuta bajo su propia
seguridad a nivel de fila (row-level security).

Está desactivado a menos que lo actives, y ambas variables son obligatorias:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Sin `REBASE_PUBLIC_URL`, un secreto JWT o un driver de datos que pueda limitar una consulta
a un solo usuario, el endpoint se negará a montarse e indicará el motivo en el registro de inicio. Ningún
`REBASE_ROLE` lo activa.

- **OAuth, con una pantalla de consentimiento.** Un cliente encuentra el servidor de autorización
  a través de `/.well-known/oauth-protected-resource`, se registra a sí mismo (el registro
  dinámico está activo por defecto; `REBASE_MCP_OPEN_REGISTRATION=false` lo limita
  a los clientes que registres) y envía a la persona a una pantalla de consentimiento que inicia
  su sesión a través de tu `/auth/login` existente.
- **Seis herramientas, dos alcances (scopes).** `mcp:read` ofrece `list_collections`,
  `query_collection` y `get_document`; `mcp:write` agrega `create_document`,
  `update_document` y `delete_document`. Un alcance decide qué herramientas se
  ofrecen, no qué filas: una lista vacía puede significar que RLS está funcionando, y `mcp:write` sigue
  sin poder escribir una fila que la persona no podría.
- **Un token solo para este endpoint.** Un token de acceso MCP es rechazado por
  `/api/data`, `/api/admin` y el WebSocket, por lo que conectar un asistente no
  le otorga una sesión.

Una limitación. Desconectar un cliente (`DELETE /api/oauth/grants/:clientId`, con la propia
sesión de la persona) revoca sus refresh tokens de inmediato, pero un token de acceso ya emitido
sigue funcionando hasta que expire, dentro del plazo de una hora. Esa misma hora acota todo lo
demás: cada refresco vuelve a leer los roles de la persona y rechaza una cuenta que se eliminó o
una concesión anterior a su último "cerrar sesión en todas partes" o cambio de contraseña. Así,
una degradación o un cierre de sesión llega a un cliente conectado en el plazo de vida de un
token de acceso. Una sesión de invitado no puede dar su consentimiento.

Las rutas se encuentran en [Endpoints](/docs/backend/endpoints/#mcp-surface) y las
variables en [Configuración](/docs/getting-started/configuration/#mcp-surface).

## Configuración recomendada

- Apunta el servidor a un proyecto **local** y deja `REBASE_MCP_ALLOW_REMOTE_WRITES`
  sin definir. La compuerta es la característica más valiosa del paquete.
- Para cualquier entorno remoto, registra una **API key `rk_` con alcance restringido** en lugar de permitir
  que el autodescubrimiento entregue una service key.
- Comprueba `rebase_project_current` cuando la salida parezca incorrecta. El proyecto activo es
  persistente y reside fuera de tu repositorio.
- Trata `~/.rebase/projects.json` como un archivo de secretos.
