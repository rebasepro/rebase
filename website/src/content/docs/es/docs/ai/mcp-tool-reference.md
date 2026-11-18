---
sourceHash: c84938b646f4ea6d
title: Referencia de herramientas MCP
sidebar_label: Referencia de herramientas MCP
description: "Todas las herramientas que registra el servidor Rebase MCP, por grupo: qué necesita y qué hace cada una, y cuáles rechaza el loopback gate en un proyecto no local."
---

Las herramientas que [`@rebasepro/mcp`](/docs/ai/mcp) ofrece a un asistente. Cómo se conecta, qué credencial posee y cómo el [loopback gate](/docs/ai/mcp#the-loopback-gate) decide qué significa ⚠ se encuentran en la página del [servidor MCP](/docs/ai/mcp).

53 herramientas, en diez grupos. Las herramientas marcadas con ⚠ son rechazadas contra destinos no locales a menos que decidas desactivar esta restricción.

Todas las herramientas fuera del grupo de registro de proyectos, `rebase_cloud_projects_list`, `rebase_cloud_provision` y `rebase_dev_logs` también aceptan un `project` opcional (un nombre registrado, o un slug o id de Cloud), verificado contra el enlace de Cloud del directorio de la sesión antes de ejecutarse. Consulta [Sobre qué proyecto actúa una llamada](/docs/ai/mcp#which-project-a-call-acts-on).

## Esquema y base de datos (13)

Ejecuta la CLI de Rebase en el directorio del proyecto activo.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_schema_generate` | — | Genera el esquema de Drizzle a partir de las tablas en `backend/schema` |
| `rebase_db_push` ⚠ | — | Aplica el esquema directamente a la base de datos (atajo de desarrollo) |
| `rebase_schema_introspect` | — | Escribe un `defineTable` en `backend/schema` para cada tabla contenida en la base de datos activa |
| `rebase_db_generate` | — | Genera archivos de migración SQL a partir de cambios en el esquema |
| `rebase_db_migrate` ⚠ | — | Ejecuta todas las migraciones SQL pendientes |
| `rebase_generate_sdk` | — | Genera el SDK de TypeScript con tipado completo |
| `rebase_doctor` | — | Detecta discrepancias (drift) entre las tablas en `backend/schema`, el esquema generado y la base de datos activa |
| `rebase_db_branch_create` ⚠ | `name` | Crea una rama de base de datos (solo administradores) |
| `rebase_db_branch_list` | — | Lista las ramas de base de datos (solo administradores) |
| `rebase_db_branch_delete` ⚠ | `name` | Elimina una rama de base de datos (solo administradores) |
| `rebase_db_branch_info` | `name` | Información y estado de la rama (solo administradores) |
| `rebase_db_branch_diff` | `name` | Qué cambió una rama respecto a la base de datos a partir de la cual se creó: esquema, políticas y filas, con conflictos; no modifica ninguna de las dos (solo administradores) |
| `rebase_db_branch_switch` | — | Apunta este checkout a una rama, o de regreso a la base de datos principal (solo administradores) |

## Planificación de esquema (1)

Pregunta al backend qué haría un cambio a través de `POST /api/admin/schema/plan`. Sin CLI y sin escribir nada en el disco: funciona en la base de datos de desarrollo administrada, lo cual los comandos respaldados por Atlas no pueden hacer.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_schema_plan` | `patches` | El SQL que ejecutaría una lista de ediciones `TablePatch`, y qué sentencias destruyen datos; consulta [Edición de esquemas en vivo](/docs/backend/live-schema-editing/#the-edits-tablepatch) |

## Filas (5)

Los mismos nombres que utiliza el `/mcp` remoto; eran `list_documents`, `get_document`, `create_document`, `update_document` y `delete_document`, con un argumento `collection`.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `query_table` | `table` | Lee filas, con `limit`, `offset`, `orderBy`, `where` opcionales, tal como lo hace `data.table(name).find()` |
| `get_row` | `table`, `id` | Obtiene una sola fila por ID |
| `create_row` ⚠ | `table`, `data` | Crea una fila |
| `update_row` ⚠ | `table`, `id`, `data` | Actualiza una fila; solo se modifican las columnas indicadas |
| `delete_row` ⚠ | `table`, `id` | Elimina una fila |

## Usuarios y roles (6)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `list_users` | — | Lista todos los usuarios, incluidos los roles |
| `create_user` ⚠ | `email` | Crea un usuario (`displayName`, `password`, `roles` opcionales) |
| `update_user` ⚠ | `uid` | Actualiza el correo electrónico, nombre para mostrar o roles |
| `delete_user` ⚠ | `uid` | Elimina un usuario |
| `list_roles` | — | Lista los roles definidos |
| `rebase_auth_reset_password` ⚠ | `email` | Restablece una contraseña a través de la API de administración |

Tanto `create_user` como `update_user` aceptan `roles`, por lo que cualquiera de ellos puede crear un administrador. Por esa razón están sujetos al gate en lugar de tratarse como meramente "aditivos".

## Almacenamiento (3)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `storage_list_objects` | — | Lista los objetos almacenados |
| `storage_get_download_url` | `key` | Una URL de descarga temporal firmada y su expiración, no los metadatos del objeto |
| `storage_delete_object` ⚠ | `key` | Elimina un objeto |

`storage_get_download_url` se clasifica como una lectura porque no modifica el entorno, pero la URL firmada que genera es una capacidad al portador (bearer capability) que sobrevive a la llamada a la herramienta.

## Cron (5)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `cron_list_jobs` | — | Lista las tareas programadas y su estado |
| `cron_get_job` | `jobId` | Detalles de la tarea |
| `cron_get_job_logs` | `jobId` | Registros de ejecución |
| `cron_trigger_job` ⚠ | `jobId` | Ejecuta una tarea inmediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Habilita o deshabilita una tarea |

`cron_toggle_job` puede deshabilitar silenciosamente una tarea de respaldo o de facturación: un cambio sin errores ni salida visible hasta que falte algo más adelante.

## Funciones (1)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoca una [función personalizada](/docs/backend/custom-functions) con cualquier método y carga útil (payload) |

Esto invoca código que el servidor MCP nunca ha visto, con un método y cuerpo elegidos por el modelo. Su radio de impacto abarca todo lo que hagan tus funciones.

## Servidor de desarrollo (3)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_dev_start` | — | Inicia el servidor de desarrollo; responde de inmediato |
| `rebase_dev_logs` | — | Lee la salida reciente (por defecto 50 líneas, búfer de 500 líneas) |
| `rebase_dev_stop` | — | Detiene el servidor de desarrollo |

## Registro de proyectos (7)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_project_list` | — | Lista los proyectos registrados y muestra el que está activo |
| `rebase_project_switch` | `name` | Cambia el proyecto activo |
| `rebase_project_add` | `name` | Registra un proyecto (`projectDir`, `baseUrl`, `token` opcionales) |
| `rebase_project_remove` | `name` | Elimina un proyecto (el proyecto predeterminado no se puede eliminar) |
| `rebase_project_current` | — | Muestra el proyecto activo y su estado de autenticación |
| `rebase_project_status` | — | Comprueba el estado de salud (health check) del backend activo |
| `rebase_project_use_cloud` | `project` | Apunta a un proyecto de Rebase Cloud de la cuenta conectada mediante id, slug o nombre, a través del proxy de Studio de la consola |

`rebase_project_switch` no está sujeto al gate, ya que redirige el destino de todo lo demás en lugar de actuar directamente sobre él. Por lo tanto, un asistente puede cambiar a un proyecto remoto sin activar el gate; simplemente no podrá ejecutar una herramienta destructiva en él después. `rebase_project_use_cloud` es el mismo tipo de cambio: apunta las herramientas de datos y administración a un proyecto de producción, donde las lecturas funcionan y el gate rechaza las escrituras.

## Rebase Cloud (9)

Ejecuta `rebase cloud … --json` en el directorio del proyecto activo, contra el proyecto al que está vinculado, con las credenciales propias de la CLI. Consulta [Rebase Cloud](/docs/ai/mcp#rebase-cloud) para conocer sobre qué actúan y por qué ninguna de ellas está sujeta al gate.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_cloud_provision` | — | Un backend activo sin cuenta (`rebase cloud init --claim`): la URL activa, la URL de administración y una URL de reclamo (`name`, `deploy`, `confirm`). Sin `confirm: true`, solo indica lo que haría |
| `rebase_cloud_status` | — | La URL del proyecto vinculado, estado, último despliegue, runtime, base de datos, almacenamiento y su URL de reclamo mientras no haya sido reclamado |
| `rebase_cloud_deploy` | — | Despliega y sigue el proceso hasta el final (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`, `confirm`). Un despliegue en producción sin `confirm: true` solo indica lo que haría |
| `rebase_cloud_logs` | — | Una instantánea del registro de tiempo de ejecución o el registro de compilación más reciente (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Nunca hace seguimiento continuo (follow) |
| `rebase_cloud_env_list` | — | Claves de las variables, nunca los valores (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Establece una variable; el valor se pasa a través de stdin y nunca se devuelve (`secret`, `preview`, `confirm`). En producción, sin `confirm: true` solo indica lo que haría |
| `rebase_cloud_deployments_list` | — | Despliegues recientes y a cuáles se puede revertir (`limit`) |
| `rebase_cloud_projects_list` | — | Cada proyecto al que la cuenta que ha iniciado sesión puede acceder, en todas sus organizaciones |
| `rebase_cloud_rollback` | — | Vuelve a poner en servicio un despliegue exitoso anterior (`deploymentId`, `confirm`). Sin `confirm: true` solo indica lo que haría |

`rebase_cloud_provision` crea un proyecto y vincula este directorio. Nunca lee la `baseUrl` del proyecto activo, por lo que el gate no lo comprueba; la CLI lo rechaza en un directorio que ya está vinculado.
