---
sourceHash: 50d3082d86c52ae2
title: Referencia de herramientas MCP
sidebar_label: Referencia de herramientas MCP
description: Cada herramienta que registra el servidor MCP de Rebase, por grupo — qué necesita y qué hace cada una, y cuáles rechaza la compuerta de bucle invertido en un proyecto no local.
---

Las herramientas que [`@rebasepro/mcp`](/docs/ai/mcp) ofrece a un asistente. Cómo se conecta,
qué credencial posee y cómo la [compuerta de bucle invertido](/docs/ai/mcp#the-loopback-gate)
decide qué significa ⚠ se encuentran en la página del [servidor MCP](/docs/ai/mcp).

53 herramientas, en diez grupos. Las herramientas marcadas con ⚠ se rechazan en destinos no locales
a menos que decidas excluirlas de esta restricción.

## Esquema y base de datos (13)

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Ejecuta la CLI de Rebase en el directorio del proyecto activo.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_schema_generate` | — | Genera el esquema de Drizzle a partir de las tablas en `backend/schema` |
| `rebase_db_push` ⚠ | — | Aplica el esquema directamente a la base de datos (atajo de desarrollo) |
| `rebase_schema_introspect` | — | Escribe un `defineTable` en `backend/schema` para cada tabla que contiene la base de datos activa |
| `rebase_db_generate` | — | Genera archivos de migración SQL a partir de cambios en el esquema |
| `rebase_db_migrate` ⚠ | — | Ejecuta todas las migraciones SQL pendientes |
| `rebase_generate_sdk` | — | Genera el SDK de TypeScript con tipado completo |
| `rebase_doctor` | — | Detecta desviaciones entre las tablas en `backend/schema`, el esquema generado y la base de datos activa |
| `rebase_db_branch_create` ⚠ | `name` | Crea una rama de la base de datos (solo administradores) |
| `rebase_db_branch_list` | — | Lista las ramas de la base de datos (solo administradores) |
| `rebase_db_branch_delete` ⚠ | `name` | Elimina una rama de la base de datos (solo administradores) |
| `rebase_db_branch_info` | `name` | Información y estado de la rama (solo administradores) |
| `rebase_db_branch_diff` | `name` | Qué cambió una rama respecto a la base de datos a partir de la cual se creó — esquema, políticas y filas, con conflictos; no modifica ninguna (solo administradores) |
| `rebase_db_branch_switch` | — | Apunta este checkout a una rama, o de vuelta a la base de datos principal (solo administradores) |

## Planificación de esquema (1)

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Pregunta al backend qué haría un cambio, mediante `POST /api/admin/schema/plan`. Sin
CLI y sin escribir nada en disco — opera en la base de datos de desarrollo administrada,
lo cual los comandos respaldados por Atlas no pueden hacer.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_schema_plan` | `patches` | El SQL que ejecutaría una lista de modificaciones `TablePatch`, y qué sentencias destruyen datos — consulta [Edición de esquemas en vivo](/docs/backend/live-schema-editing/#the-edits-tablepatch) |

## Filas (5)

<span class="since-badge" data-since="0.31">Desde 0.31</span> Los mismos nombres que utiliza el `/mcp` remoto; anteriormente eran `list_documents`, `get_document`, `create_document`, `update_document` y `delete_document`, con un argumento `collection`.

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
| `create_user` ⚠ | `email` | Crea un usuario (opcional: `displayName`, `password`, `roles`) |
| `update_user` ⚠ | `uid` | Actualiza correo electrónico, nombre para mostrar o roles |
| `delete_user` ⚠ | `uid` | Elimina un usuario |
| `list_roles` | — | Lista los roles definidos |
| `rebase_auth_reset_password` ⚠ | `email` | Restablece una contraseña mediante la API de administración |

`create_user` y `update_user` aceptan `roles`, por lo que cualquiera de los dos puede otorgar permisos
de administrador. Es por eso que están protegidos por la compuerta en lugar de considerarse meramente "aditivos".

## Almacenamiento (3)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `storage_list_objects` | — | Lista los objetos almacenados |
| `storage_get_download_url` | `key` | Una URL de descarga firmada temporal y su vencimiento — no metadatos del objeto |
| `storage_delete_object` ⚠ | `key` | Elimina un objeto |

`storage_get_download_url` está clasificada como una lectura porque no modifica el
entorno — pero la URL firmada que genera es una funcionalidad al portador (bearer) que perdura más allá
de la llamada a la herramienta.

## Cron (5)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `cron_list_jobs` | — | Lista los trabajos programados y su estado |
| `cron_get_job` | `jobId` | Detalles del trabajo |
| `cron_get_job_logs` | `jobId` | Registros de ejecución |
| `cron_trigger_job` ⚠ | `jobId` | Ejecuta un trabajo inmediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Habilita o deshabilita un trabajo |

`cron_toggle_job` puede deshabilitar silenciosamente un respaldo o un trabajo de facturación — un cambio
sin error ni salida visible hasta que falte algo más adelante.

## Funciones (1)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoca una [función personalizada](/docs/backend/custom-functions) con cualquier método y carga útil |

Esto llama a código que el servidor MCP nunca ha visto, con un método y cuerpo elegidos por
el modelo. Su radio de impacto abarca cualquier acción que realicen tus funciones.

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
| `rebase_project_add` | `name` | Registra un proyecto (opcional: `projectDir`, `baseUrl`, `token`) |
| `rebase_project_remove` | `name` | Elimina un proyecto (el proyecto predeterminado no se puede eliminar) |
| `rebase_project_current` | — | Muestra el proyecto activo y su estado de autenticación |
| `rebase_project_status` | — | Comprueba el estado de salud del backend activo |
| `rebase_project_use_cloud` | `project` | Apunta a un proyecto de Rebase Cloud de la cuenta conectada por ID, slug o nombre, a través del proxy de Studio de la consola |

`rebase_project_switch` no está protegido por la compuerta, ya que redirige el objetivo de todo lo demás
en lugar de actuar directamente sobre el objetivo en sí. Por lo tanto, un asistente puede cambiar a un
proyecto remoto sin activar la compuerta — simplemente no podrá ejecutar luego una herramienta destructiva
en él. `rebase_project_use_cloud` es el mismo tipo de cambio: apunta las herramientas de datos y de
administración a un proyecto de producción, donde las lecturas funcionan y la compuerta rechaza las escrituras.

## Rebase Cloud (9)

Ejecuta `rebase cloud … --json` en el directorio del proyecto activo, apuntando al
proyecto al que está vinculado, con las propias credenciales de la CLI. Consulta
[Rebase Cloud](/docs/ai/mcp#rebase-cloud) para ver sobre qué actúan y por qué ninguna de
ellas está restringida por la compuerta.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_cloud_provision` | — | Un backend activo sin cuenta (`rebase cloud init --claim`): la URL activa, la URL de administración y una URL de reclamo (`name`, `deploy`) |
| `rebase_cloud_status` | — | La URL del proyecto vinculado, estado, último despliegue, runtime, base de datos, almacenamiento y su URL de reclamo mientras no haya sido reclamado |
| `rebase_cloud_deploy` | — | Realiza el despliegue y lo monitorea hasta el final (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`) |
| `rebase_cloud_logs` | — | Una instantánea del registro de runtime, o el registro de compilación más reciente (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Nunca hace seguimiento continuo |
| `rebase_cloud_env_list` | — | Claves de variables, nunca los valores (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Establece una variable; el valor pasa a través de stdin y nunca se devuelve (`secret`, `preview`) |
| `rebase_cloud_deployments_list` | — | Despliegues recientes y a cuáles se puede revertir (`limit`) |
| `rebase_cloud_projects_list` | — | Todos los proyectos a los que puede acceder la cuenta conectada, a través de todas sus organizaciones |
| `rebase_cloud_rollback` | — | Vuelve a poner en servicio un despliegue exitoso anterior (`deploymentId`) |

`rebase_cloud_provision` crea un proyecto y vincula este directorio. Nunca
lee la `baseUrl` del proyecto activo, por lo que la compuerta no lo verifica; la CLI
lo rechaza en un directorio que ya está vinculado.
