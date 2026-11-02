---
sourceHash: c7ba0e6c6150d210
title: Referencia de herramientas MCP
sidebar_label: Referencia de herramientas MCP
description: Cada herramienta que registra el servidor MCP de Rebase, por grupo — qué necesita y qué hace cada una, y cuáles rechaza la puerta de loopback frente a un proyecto no local.
---

Las herramientas que [`@rebasepro/mcp`](/docs/ai/mcp) ofrece a un asistente. Cómo se conecta, qué credencial contiene y cómo la [puerta de loopback](/docs/ai/mcp#the-loopback-gate) decide qué significa ⚠ se detallan en la página del [servidor MCP](/docs/ai/mcp).

53 herramientas, en diez grupos. Las herramientas marcadas con ⚠ son rechazadas contra destinos no locales a menos que decidas desactivar esta restricción.

## Esquema y base de datos (13)

Ejecuta la CLI de Rebase en el directorio del proyecto activo.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_schema_generate` | — | Genera el esquema de Drizzle a partir de las definiciones de colecciones |
| `rebase_db_push` ⚠ | — | Aplica el esquema directamente a la base de datos (atajo de desarrollo) |
| `rebase_schema_introspect` | — | Realiza introspección de la base de datos activa hacia definiciones de colecciones |
| `rebase_db_generate` | — | Genera archivos de migración SQL a partir de cambios en el esquema |
| `rebase_db_migrate` ⚠ | — | Ejecuta todas las migraciones SQL pendientes |
| `rebase_generate_sdk` | — | Genera el SDK de TypeScript totalmente tipado |
| `rebase_doctor` | — | Detecta discrepancias (drift) entre las definiciones, el esquema generado y la base de datos activa |
| `rebase_db_branch_create` ⚠ | `name` | Crea una rama de base de datos (solo administradores) |
| `rebase_db_branch_list` | — | Lista las ramas de la base de datos (solo administradores) |
| `rebase_db_branch_delete` ⚠ | `name` | Elimina una rama de base de datos (solo administradores) |
| `rebase_db_branch_info` | `name` | Información y estado de la rama (solo administradores) |
| `rebase_db_branch_diff` | `name` | Lo que una rama cambió respecto a la base de datos a partir de la cual se creó: esquema, políticas y filas, con conflictos; no modifica ninguna (solo administradores) |
| `rebase_db_branch_switch` | — | Apunta este checkout a una rama o de regreso a la base de datos principal (solo administradores) |

## Planificación de esquemas (1)

Pregunta al backend qué haría un cambio, mediante `POST /api/admin/schema/plan`. Sin CLI y sin escribir nada en el disco: funciona en la base de datos de desarrollo gestionada, lo cual los comandos respaldados por Atlas no pueden hacer.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | El SQL que ejecutaría el cambio de una colección y qué sentencias destruyen datos |

## Documentos (5)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `list_documents` | `collection` | Lista filas, con `limit`, `offset`, `orderBy`, `where` opcionales |
| `get_document` | `collection`, `id` | Obtiene una sola fila por ID |
| `create_document` ⚠ | `collection`, `data` | Crea una fila |
| `update_document` ⚠ | `collection`, `id`, `data` | Actualiza una fila |
| `delete_document` ⚠ | `collection`, `id` | Elimina una fila |

## Usuarios y roles (6)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `list_users` | — | Lista todos los usuarios, incluidos los roles |
| `create_user` ⚠ | `email` | Crea un usuario (`displayName`, `password`, `roles` opcionales) |
| `update_user` ⚠ | `uid` | Actualiza el correo electrónico, el nombre para mostrar o los roles |
| `delete_user` ⚠ | `uid` | Elimina un usuario |
| `list_roles` | — | Lista los roles definidos |
| `rebase_auth_reset_password` ⚠ | `email` | Restablece una contraseña mediante la API de administración |

Tanto `create_user` como `update_user` aceptan `roles`, por lo que cualquiera de los dos puede crear un administrador. Por esta razón están restringidos por la puerta de loopback en lugar de ser tratados simplemente como "aditivos".

## Almacenamiento (3)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `storage_list_objects` | — | Lista los objetos almacenados |
| `storage_get_download_url` | `key` | Una URL de descarga temporal firmada y su expiración — no los metadatos del objeto |
| `storage_delete_object` ⚠ | `key` | Elimina un objeto |

`storage_get_download_url` se clasifica como una lectura porque no modifica el entorno, pero la URL firmada que genera es una capacidad al portador (bearer capability) que sobrevive a la llamada de la herramienta.

## Cron (5)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `cron_list_jobs` | — | Lista los trabajos programados y su estado |
| `cron_get_job` | `jobId` | Detalles del trabajo |
| `cron_get_job_logs` | `jobId` | Registros de ejecución |
| `cron_trigger_job` ⚠ | `jobId` | Ejecuta un trabajo inmediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Habilita o deshabilita un trabajo |

`cron_toggle_job` puede deshabilitar silenciosamente una copia de seguridad o un trabajo de facturación: un cambio sin errores y sin salida visible hasta que falte algo más adelante.

## Funciones (1)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invoca una [función personalizada](/docs/backend/custom-functions) con cualquier método y carga útil |

Esto ejecuta código que el servidor MCP nunca ha visto, con el método y cuerpo que el modelo haya elegido. Su radio de impacto abarca todo lo que hagan tus funciones.

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
| `rebase_project_status` | — | Comprueba el estado de salud del backend activo |
| `rebase_project_use_cloud` | `project` | Apunta a un proyecto de Rebase Cloud de la cuenta autenticada mediante id, slug o nombre, a través del proxy de Studio de la consola |

`rebase_project_switch` no está restringido por la puerta de loopback porque redirige todo lo demás en lugar de actuar sobre un destino en sí mismo. Por lo tanto, un asistente puede cambiar a un proyecto remoto sin activar la puerta de loopback; simplemente no podrá ejecutar una herramienta destructiva allí. `rebase_project_use_cloud` es el mismo tipo de cambio: apunta las herramientas de datos y administración a un proyecto de producción, donde las lecturas funcionan y la puerta de loopback rechaza las escrituras.

## Rebase Cloud (9)

Ejecuta `rebase cloud … --json` en el directorio del proyecto activo, contra el proyecto al que está vinculado, con las credenciales propias de la CLI. Consulta [Rebase Cloud](/docs/ai/mcp#rebase-cloud) para conocer sobre qué actúan y por qué ninguna de ellas está restringida por la puerta de loopback.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_cloud_provision` | — | Un backend activo sin cuenta (`rebase cloud init --claim`): la URL activa, la URL de administración y una URL de reclamo (`name`, `deploy`) |
| `rebase_cloud_status` | — | La URL, el estado, el último despliegue, el entorno de ejecución, la base de datos, el almacenamiento del proyecto vinculado y su URL de reclamo mientras no haya sido reclamado |
| `rebase_cloud_deploy` | — | Despliega y sigue el proceso hasta el final (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`) |
| `rebase_cloud_logs` | — | Una captura del registro de tiempo de ejecución o del registro de compilación más reciente (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Nunca realiza seguimiento continuo |
| `rebase_cloud_env_list` | — | Claves de las variables, nunca los valores (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Establece una variable; el valor pasa a través de stdin y nunca se devuelve (`secret`, `preview`) |
| `rebase_cloud_deployments_list` | — | Despliegues recientes y a cuáles se puede revertir (`limit`) |
| `rebase_cloud_projects_list` | — | Todos los proyectos a los que la cuenta con sesión iniciada puede acceder, en todas sus organizaciones |
| `rebase_cloud_rollback` | — | Vuelve a poner en servicio un despliegue anterior exitoso (`deploymentId`) |

`rebase_cloud_provision` crea un proyecto y vincula este directorio. Nunca lee la `baseUrl` del proyecto activo, por lo que la puerta de loopback no lo comprueba; la CLI lo rechaza si se ejecuta en un directorio que ya está vinculado.
