---
title: Servidor MCP
sidebar_label: Servidor MCP
description: Conecta Claude Code, Cursor, Gemini CLI o cualquier cliente MCP a un proyecto Rebase — las 41 herramientas que expone, la credencial con la que se autentica y la compuerta loopback que se interpone entre un agente y producción.
---

`@rebasepro/mcp` es un servidor del [Model Context Protocol](https://modelcontextprotocol.io)
que proporciona a un asistente de IA herramientas reales sobre un proyecto Rebase:
leer y escribir filas, gestionar usuarios, ejecutar migraciones, invocar funciones,
controlar el servidor de desarrollo.

Se comunica mediante MCP **únicamente a través de stdio**. No hay puerto ni listener;
el proceso es exactamente tan confiable como lo que sea que lo haya generado, y no hay
ningún llamador remoto al que autenticar. Esa es la parte segura. Las preguntas
interesantes giran en torno a lo que hace *una vez* que está en ejecución, y esta
página las responde antes de mostrarte el bloque de configuración.

## Conexión de un cliente

El servidor está publicado en npm y no necesita instalación; `npx` lo descarga.
Cada bloque de abajo es la integración completa.

**Claude Code** — `.mcp.json` en la raíz de tu proyecto. `rebase init` escribe este archivo por ti:

```json title=".mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"]
    }
  }
}
```

**Cursor** — la misma forma, en `.cursor/mcp.json`:

```json title=".cursor/mcp.json"
{
  "mcpServers": {
    "rebase": {
      "command": "npx",
      "args": ["-y", "@rebasepro/mcp"]
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
      "args": ["-y", "@rebasepro/mcp"]
    }
  }
}
```

**Codex CLI** — TOML en lugar de JSON, en `~/.codex/config.toml`. Es a nivel de usuario, no por proyecto, así que indica aquí el directorio del proyecto:

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
      "args": ["-y", "@rebasepro/mcp"]
    }
  }
}
```

Funciona cualquier cliente MCP capaz de lanzar un servidor stdio; la forma es la misma.

### Sobre qué directorio actúa

`REBASE_PROJECT_DIR` debe ser el directorio que contiene `rebase.json`. Si lo
omites, el servidor usa su directorio de trabajo, que para un archivo de
configuración a nivel de proyecto es el propio proyecto — por eso solo lo define
el bloque de Codex, que es a nivel de usuario.

Si lo defines, gana: el entorno reconstruye el proyecto `default` en cada
arranque, así que una ruta absoluta en una configuración de usuario tiene
prioridad sobre lo que recuerde `~/.rebase/projects.json`.

## A qué puede acceder el servidor

Esta es la sección que debes leer antes de apuntar un asistente a una base de datos
que te importe.

El servidor lleva **una única credencial de entorno para todo el proceso**. No hay
identidad por herramienta ni modo de solo lectura; cada herramienta utiliza el mismo
token, y la única opción en el paquete sirve para *aumentar* el alcance en lugar de
reducirlo.

Cuál es esa credencial, en orden de prioridad:

1. `REBASE_API_TOKEN` / `REBASE_TOKEN` desde el entorno
2. `REBASE_SERVICE_KEY` leída desde el `.env` del proyecto
3. La clave de servicio descubierta automáticamente desde `.rebase/state.json` mientras
   `rebase dev` se está ejecutando

Un token que registres para un proyecto **prevalece sobre el descubrimiento automático**.
El descubrimiento solo cubre un vacío.

:::danger[La vía sin configuración es una credencial de administrador]
Las opciones 2 y 3 son la **clave de servicio (service key)** — un secreto de
administración sin restricciones de alcance. El backend la resuelve como `uid: "service"`,
`roles: ["admin"]`, `isAdmin: true`. Esa identidad omite por completo la lista de permisos
de API key y satisface las políticas `_default_admin_read` / `_default_admin_write`
que Rebase inyecta en cada colección que no haya establecido `disableDefaultPolicies`.

Así que la respuesta honesta a "¿sigue RLS limitándolo?" es: RLS *se ejecuta* —el
controlador sí pasa al rol `rebase_user`— y luego una política escrita por el propio
Rebase le otorga todo a esa identidad. Leer cada fila de cada colección es el
**comportamiento previsto en la configuración por defecto**, no una vulneración.

Con la configuración cero (zero-config), un agente que disponga de estas herramientas
puede leer y escribir cada fila de cada colección, listar todos los usuarios, restablecer
cualquier contraseña, invocar cualquier función del backend y ejecutar DDL contra
cualquier `DATABASE_URL` que el proyecto resuelva.
:::

### Proporcionarle una credencial restringida en su lugar

Registra una [API key](/docs/backend/api#api-keys) con alcance limitado y el modelo
de dos compuertas se aplicará de verdad. Una clave que no es de administrador se ejecuta
con los roles `["service"]`, los cuales las políticas de administración inyectadas
**no** nombran —por lo que RLS no le otorga nada a menos que una de tus propias políticas
indique lo contrario, y la lista de permisos la restringe aún más:

```bash
rebase api-keys create -n "claude-code" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Luego, proporciona la clave `rk_live_…` resultante al servidor en lugar de dejar que
descubra una clave de servicio:

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
  `rebase_doctor` y las herramientas de ramas ejecutan la CLI de Rebase, la cual se
  conecta con `DATABASE_URL` y nunca ve tu token. La compuerta loopback descrita
  abajo es lo único que se interpone ante ellas.
- **Una clave que no es de administrador no puede utilizar las herramientas de administración.**
  `list_users`, `create_user`, `update_user`, `delete_user`, `list_roles` y
  `rebase_auth_reset_password` se encuentran protegidas por `requireAdmin` y fallarán
  con una clave restringida. Así es como funciona el sistema, pero significa que
  debes elegir entre alcance y restricción en lugar de obtener ambos.

Una API key con `admin: true` es un asunto diferente: tiene los roles `["admin", "service"]`,
lo que cumple con las mismas políticas de administración por defecto que la clave de
servicio. En el plano de datos, su alcance es el mismo que el de la clave de servicio.
La ventaja que añade es que es **revocable, con fecha de expiración y limitada por tasa
(rate-limited) por clave**, nada de lo cual aplica a la clave de servicio —rotar esa
última implica editar `.env` y reiniciar el servidor.

Consulta [Agentes y Servidores MCP](/docs/backend/api#agents-and-mcp-servers) para
ver la guía completa sobre el alcance de claves.

### Dejar una colección completamente fuera de su alcance

La razón por la que una credencial de administrador lo lee todo es la política base
que Rebase inyecta en cada colección, otorgando el contexto de servidor de confianza
y el rol `admin`. Una colección puede optar por no aplicar esa base y asumir la
total responsabilidad de su propio RLS:

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

Ahora la única forma de acceder es coincidiendo con `patient_id`. El uid de la clave
de servicio es la cadena literal `service`, por lo que una regla de propietario (owner)
nunca coincidirá con ella —las lecturas devuelven cero filas y las escrituras son
rechazadas por Postgres. Este es el único control que restringe la credencial por
defecto del servidor MCP en lugar de darla por sentada.

Recuerda que este es un cambio real de RLS, no de documentación: surte efecto
únicamente una vez que `rebase schema generate` y una migración hayan aplicado las
políticas. Consulta [Reglas de Seguridad (RLS)](/docs/collections/security-rules).

## La compuerta loopback

`rebase_project_add` acepta cualquier `baseUrl`, y las herramientas de la CLI se
conectan con cualquier `DATABASE_URL` que el proyecto declare. Por lo tanto, la
misma lista de herramientas que edita una base de datos de prueba en tu portátil
puede eliminar filas de producción, sin nada de por medio excepto el criterio
del asistente sobre qué proyecto está activo.

**Se rechaza cualquier herramienta que modifique el entorno de destino a menos que
ese destino esté en la interfaz loopback.** La compuerta está diseñada como una
lista de lo que *no* está bloqueado, por lo que una herramienta agregada más
adelante estará protegida por defecto.

- **No bloqueadas — lecturas:** `rebase_schema_plan`, `rebase_schema_introspect`, `rebase_doctor`,
  `rebase_db_branch_list`, `rebase_db_branch_info`, `list_documents`,
  `get_document`, `list_users`, `list_roles`, `storage_list_objects`,
  `storage_get_metadata`, `cron_list_jobs`, `cron_get_job`, `cron_get_job_logs`,
  `rebase_dev_logs`.
- **No bloqueadas — solo locales:** `rebase_schema_generate`, `rebase_db_generate`,
  `rebase_generate_sdk`, las herramientas del servidor de desarrollo y las herramientas
  de registro de proyectos. Estas escriben archivos locales o estado local y no tienen
  un destino remoto que verificar.
- **Bloqueadas según `DATABASE_URL`:** las herramientas restantes de la CLI — `rebase_db_push`,
  `rebase_db_migrate`, `rebase_db_branch_create`, `rebase_db_branch_delete`.
- **Bloqueadas según la `baseUrl` del proyecto:** las herramientas restantes del SDK —
  `create_document`, `update_document`, `delete_document`, `create_user`,
  `update_user`, `delete_user`, `rebase_auth_reset_password`,
  `storage_delete_object`, `cron_trigger_job`, `cron_toggle_job`,
  `invoke_function`.

Los dos destinos no son intercambiables. Las herramientas de la CLI nunca ven `baseUrl`,
por lo que un backend en localhost junto a una `DATABASE_URL` de producción se verifica
contra la base de datos, no contra el backend.

Un rechazo se ve así:

```text
Error: Refusing to run "delete_document": project "default" points at
https://api.example.com/, which is not local. Set REBASE_MCP_ALLOW_REMOTE_WRITES=true
to allow destructive tools against remote environments.
```

**Si no se puede resolver ninguna cadena de conexión, las herramientas de base de datos son rechazadas** —
un destino no verificable no es seguro:

```text
Error: Refusing to run "rebase_db_push": no DATABASE_URL could be resolved for
project "default", so the database it would connect to cannot be verified as local.
```

Solo loopback cuenta como local: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
Los rangos privados como `10.x` y `192.168.x` **no** cuentan —es tan probable que
sean un clúster de staging compartido como una computadora portátil, y tratarlos como
locales permitiría exactamente el accidente que la compuerta busca evitar.

Establece `REBASE_MCP_ALLOW_REMOTE_WRITES=true` para desactivar esta protección.
Establecerlo de forma global en la configuración de tu cliente MCP elimina la compuerta
para cada proyecto al que el servidor pueda acceder, no solo para aquel en el que
estabas pensando.

## Marcado de datos no confiables

Las filas, registros de usuarios, listados de storage, tareas cron, respuestas de
funciones y la salida de la CLI se devuelven envueltos en un contenedor explícito:

```text
<<<UNTRUSTED_DATA source="list_documents">>>
[ … rows … ]
<<<END_UNTRUSTED_DATA>>>
```

Todo lo almacenado en tu base de datos fue escrito por alguien, y llega a través del
mismo canal que el contrato de herramientas que el asistente está siguiendo. El contenedor
le indica al modelo que lo trate como contenido inerte en lugar de instrucciones.

Es un marcador, no un sandbox. Un asistente con acceso a estas herramientas es tan
seguro como el contenido que le permites leer.

## Múltiples proyectos

Las configuraciones de los proyectos se almacenan en `~/.rebase/projects.json`, y el
servidor puede albergar varios a la vez —útil cuando trabajas entre entornos locales
y remotos. Mientras `rebase dev` está en ejecución, el servidor lee el puerto activo
y la clave de servicio desde `.rebase/state.json` en el directorio del proyecto, que
es lo que hace que el caso local funcione sin configuración previa.

:::note[El bloque de entorno tiene prioridad sobre el registro]
`REBASE_PROJECT_DIR`, `REBASE_BASE_URL` y `REBASE_API_TOKEN` reconstruyen el
proyecto `default` **en cada arranque**, no solo en el primero. La reconstrucción
afecta a toda la entrada: un token registrado para el `projectDir` anterior se
descarta en lugar de trasladarse a un directorio para el que nunca se emitió.

El `default` persistido solo se usa cuando la configuración del cliente no define
ninguna de las tres variables. `activeProject` sigue siendo persistente: si una
sesión anterior llamó a `rebase_project_switch`, las herramientas apuntan a ese
proyecto y el servidor lo indica por stderr. Si un asistente parece estar leyendo
la base de datos equivocada, ejecuta primero `rebase_project_current`.
:::

Los tokens se almacenan en ese registro **en texto plano**. Es un archivo en tu directorio
de inicio que contiene credenciales de administrador para cada proyecto que hayas
registrado; trátalo como corresponde.

## Referencia de herramientas

41 herramientas, en ocho grupos. Las herramientas marcadas con ⚠ son rechazadas contra
destinos no locales a menos que desactives esta protección.

### Esquema y base de datos (12)

Ejecutan la CLI de Rebase en el directorio del proyecto activo.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_schema_plan` | — | Muestra el SQL que ejecutaría `rebase_db_push`, sin ejecutar nada |
| `rebase_schema_generate` | — | Genera el esquema Drizzle a partir de las definiciones de colecciones |
| `rebase_db_push` ⚠ | — | Aplica el esquema directamente a la base de datos (atajo para desarrollo) |
| `rebase_schema_introspect` | — | Realiza introspección de la base de datos en vivo hacia definiciones de colecciones |
| `rebase_db_generate` | — | Genera archivos de migración SQL a partir de cambios en el esquema |
| `rebase_db_migrate` ⚠ | — | Ejecuta todas las migraciones SQL pendientes |
| `rebase_generate_sdk` | — | Genera el SDK de TypeScript con tipado completo |
| `rebase_doctor` | — | Detecta desviaciones (drift) entre las definiciones, el esquema generado y la base de datos en vivo |
| `rebase_db_branch_create` ⚠ | `name` | Crea una rama de base de datos (solo administradores) |
| `rebase_db_branch_list` | — | Lista las ramas de base de datos (solo administradores) |
| `rebase_db_branch_delete` ⚠ | `name` | Elimina una rama de base de datos (solo administradores) |
| `rebase_db_branch_info` | `name` | Información y estado de la rama (solo administradores) |

### Documentos (5)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `list_documents` | `collection` | Lista filas, con `limit`, `offset`, `orderBy`, `where` opcionales |
| `get_document` | `collection`, `id` | Obtiene una sola fila por ID |
| `create_document` ⚠ | `collection`, `data` | Crea una fila |
| `update_document` ⚠ | `collection`, `id`, `data` | Actualiza una fila |
| `delete_document` ⚠ | `collection`, `id` | Elimina una fila |

### Usuarios y roles (6)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `list_users` | — | Lista todos los usuarios, incluidos los roles |
| `create_user` ⚠ | `email` | Crea un usuario (`displayName`, `password`, `roles` opcionales) |
| `update_user` ⚠ | `uid` | Actualiza email, nombre para mostrar o roles |
| `delete_user` ⚠ | `uid` | Elimina un usuario |
| `list_roles` | — | Lista los roles definidos |
| `rebase_auth_reset_password` ⚠ | `email` | Restablece una contraseña mediante la API de administración |

Tanto `create_user` como `update_user` aceptan `roles`, por lo que cualquiera de ellos
puede crear un administrador. Por eso están bloqueadas en lugar de ser tratadas como
meramente "aditivas".

### Almacenamiento (Storage) (3)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `storage_list_objects` | — | Lista objetos almacenados |
| `storage_get_metadata` | `key` | Metadatos más una URL temporal firmada de descarga |
| `storage_delete_object` ⚠ | `key` | Elimina un objeto |

`storage_get_metadata` está clasificada como lectura porque no cambia el entorno,
pero la URL firmada que genera es una capacidad al portador que sobrevive a la
llamada de la herramienta.

### Cron (5)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `cron_list_jobs` | — | Lista las tareas programadas y su estado |
| `cron_get_job` | `jobId` | Detalles de la tarea |
| `cron_get_job_logs` | `jobId` | Registros de ejecución |
| `cron_trigger_job` ⚠ | `jobId` | Ejecuta una tarea inmediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Habilita o deshabilita una tarea |

`cron_toggle_job` puede deshabilitar silenciosamente una copia de seguridad o una
tarea de facturación —un cambio sin errores ni salida hasta que falte algo más adelante.

### Funciones (1)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoca una [función personalizada](/docs/backend/custom-functions) con cualquier método y payload |

Esto llama a código que el servidor MCP nunca ha visto, con un método y un cuerpo
elegidos por el modelo. Su radio de impacto es todo lo que hagan tus funciones.

### Servidor de desarrollo (3)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_dev_start` | — | Inicia el servidor de desarrollo; retorna inmediatamente |
| `rebase_dev_logs` | — | Lee la salida reciente (por defecto 50 líneas, búfer de 500 líneas) |
| `rebase_dev_stop` | — | Detiene el servidor de desarrollo |

### Registro de proyectos (6)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_project_list` | — | Lista los proyectos registrados y muestra el activo |
| `rebase_project_switch` | `name` | Cambia el proyecto activo |
| `rebase_project_add` | `name` | Registra un proyecto (`baseUrl`, `projectDir` y `token` opcionales) |
| `rebase_project_remove` | `name` | Elimina un proyecto (el proyecto predeterminado no se puede eliminar) |
| `rebase_project_current` | — | Muestra el proyecto activo y su estado de autenticación |
| `rebase_project_status` | — | Comprueba el estado de salud del backend activo |

`rebase_project_switch` no está bloqueada, porque redirige todo lo demás en lugar
de actuar sobre un destino en sí mismo. Por lo tanto, un asistente puede cambiar a
un proyecto remoto sin activar la compuerta; simplemente no podrá ejecutar luego
una herramienta destructiva allí.

## Recursos

Más allá de las herramientas, el servidor expone recursos MCP para que un cliente
pueda obtener contexto del proyecto sin gastar una llamada a herramienta:

| URI | Descripción |
|---|---|
| `rebase://collections/{name}` | Código fuente en TypeScript de la definición de una colección |
| `rebase://schema` | El esquema generado de Drizzle (`schema.generated.ts`) |

Las colecciones se descubren desde `app/config/collections/`,
`config/collections/` o `collections/` bajo el directorio del proyecto activo
—la que exista.

`rebase://schema` se lista **solo si** el esquema generado se encuentra exactamente
en `app/backend/src/schema.generated.ts`. Esa es una única ruta fija sin alternativas,
por lo que un proyecto organizado de manera diferente —o uno que aún no haya ejecutado
`rebase schema generate`— simplemente no verá el recurso ofrecido. Si falta y lo
esperabas, verifica la ruta antes de concluir que el servidor está roto.

## Configuración recomendada

- Apunta el servidor a un proyecto **local** y deja `REBASE_MCP_ALLOW_REMOTE_WRITES`
  sin definir. La compuerta es el elemento más valioso del paquete.
- Para cualquier cosa remota, registra una **API key `rk_` con alcance restringido**
  en lugar de dejar que el descubrimiento entregue una clave de servicio.
- Comprueba `rebase_project_current` cuando la salida parezca incorrecta. El proyecto
  activo es persistente y vive fuera de tu repositorio.
- Trata a `~/.rebase/projects.json` como un archivo de secretos.

---
