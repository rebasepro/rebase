---
sourceHash: e2f4e2f2165a93fe
title: Referencia de herramientas MCP
sidebar_label: Referencia de herramientas MCP
description: Cada herramienta que registra el servidor MCP de Rebase, por grupo — qué necesita y hace cada una, y cuáles rechaza la barrera de loopback frente a un proyecto no local.
---

Las herramientas que [`@rebasepro/mcp`](/docs/ai/mcp) ofrece a un asistente. Cómo se
conecta, qué credencial posee y cómo decide la [barrera de loopback](/docs/ai/mcp#the-loopback-gate)
qué significa ⚠ están en la página del [servidor MCP](/docs/ai/mcp).

51 herramientas, en diez grupos. Las herramientas marcadas con ⚠ se rechazan frente a destinos
no locales a menos que desactives la protección.

## Esquema y base de datos (13)

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
| `rebase_db_branch_diff` | `name` | Lo que una rama cambió respecto a la base de datos de la que se creó: esquema, políticas y filas, con conflictos; no modifica ninguna de las dos (solo administradores) |
| `rebase_db_branch_switch` | — | Apuntar este checkout a una rama, o de vuelta a la base de datos principal (solo administradores) |

## Planificación de esquema (1)

Pregunta al backend qué haría un cambio, a través de `POST /api/admin/schema/plan`. Sin CLI
y sin escribir nada en disco; funciona en la base de datos de desarrollo administrada,
algo que los comandos respaldados por Atlas no pueden hacer.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_schema_plan` | `collectionId`, `collection` | El SQL que ejecutaría el cambio de una colección y qué sentencias destruyen datos |

## Documentos (5)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `list_documents` | `collection` | Listar filas, con `limit`, `offset`, `orderBy`, `where` opcionales |
| `get_document` | `collection`, `id` | Obtener una sola fila por ID |
| `create_document` ⚠ | `collection`, `data` | Crear una fila |
| `update_document` ⚠ | `collection`, `id`, `data` | Actualizar una fila |
| `delete_document` ⚠ | `collection`, `id` | Eliminar una fila |

## Usuarios y roles (6)

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

## Almacenamiento (3)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `storage_list_objects` | — | Listar objetos almacenados |
| `storage_get_download_url` | `key` | Una URL de descarga firmada temporal y su caducidad (no metadatos del objeto) |
| `storage_delete_object` ⚠ | `key` | Eliminar un objeto |

`storage_get_download_url` se clasifica como lectura porque no modifica el entorno, pero la URL
firmada que genera es una capacidad portadora que perdura más allá de la llamada a la herramienta.

## Cron (5)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `cron_list_jobs` | — | Listar tareas programadas y su estado |
| `cron_get_job` | `jobId` | Detalles de la tarea |
| `cron_get_job_logs` | `jobId` | Registros de ejecución |
| `cron_trigger_job` ⚠ | `jobId` | Ejecutar una tarea inmediatamente |
| `cron_toggle_job` ⚠ | `jobId`, `enabled` | Habilitar o deshabilitar una tarea |

`cron_toggle_job` puede deshabilitar silenciosamente una copia de seguridad o una tarea de
facturación; un cambio sin errores y sin salida hasta que falte algo más adelante.

## Funciones (1)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `invoke_function` ⚠ | `name` | Invocar una [función personalizada](/docs/backend/custom-functions) con cualquier método y carga útil |

Esto llama a código que el servidor MCP nunca ha visto, con un método y cuerpo elegidos por
el modelo. Su radio de impacto abarca todo lo que hagan tus funciones.

## Servidor de desarrollo (3)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_dev_start` | — | Iniciar el servidor de desarrollo; retorna inmediatamente |
| `rebase_dev_logs` | — | Leer la salida reciente (por defecto 50 líneas, búfer de 500 líneas) |
| `rebase_dev_stop` | — | Detener el servidor de desarrollo |

## Registro de proyectos (6)

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_project_list` | — | Listar proyectos registrados y mostrar el activo |
| `rebase_project_switch` | `name` | Cambiar el proyecto activo |
| `rebase_project_add` | `name` | Registrar un proyecto (`projectDir`, `baseUrl`, `token` opcionales) |
| `rebase_project_remove` | `name` | Eliminar un proyecto (el proyecto predeterminado no se puede eliminar) |
| `rebase_project_current` | — | Mostrar el proyecto activo y su estado de autenticación |
| `rebase_project_status` | — | Comprobar el estado de salud del backend activo |

`rebase_project_switch` no está restringido porque redirige todo lo demás en lugar de actuar
sobre un destino en sí mismo. Por lo tanto, un asistente puede cambiar a un proyecto remoto
sin activar la barrera; simplemente no podrá ejecutar una herramienta destructiva allí después.

## Rebase Cloud (8)

Lanzan `rebase cloud … --json` en el directorio del proyecto activo, contra el
proyecto al que está vinculado, con la credencial propia de la CLI. Consulta
[Rebase Cloud](/docs/ai/mcp#rebase-cloud) para ver sobre qué actúan y por qué ninguna
está restringida por la barrera.

| Herramienta | Requerido | Descripción |
|---|---|---|
| `rebase_cloud_provision` | — | Un backend en vivo sin cuenta (`rebase cloud init --claim`): la URL en vivo, la URL de administración y una URL de reclamación (`name`, `deploy`) |
| `rebase_cloud_status` | — | La URL, el estado, el último despliegue, el runtime, la base de datos y el almacenamiento del proyecto vinculado, y su URL de reclamación mientras no está reclamado |
| `rebase_cloud_deploy` | — | Desplegar y seguirlo hasta el final (`app`, `bundle`, `message`, `wait`, `timeoutSeconds`, `preview`, `previewName`) |
| `rebase_cloud_logs` | — | Una instantánea del log de runtime, o el último log de compilación (`source`, `since`, `tail`, `grep`, `level`, `previous`, `preview`). Nunca hace seguimiento |
| `rebase_cloud_env_list` | — | Claves de las variables, nunca valores (`preview`) |
| `rebase_cloud_env_set` | `key`, `value` | Definir una variable; el valor pasa por stdin y nunca se devuelve (`secret`, `preview`) |
| `rebase_cloud_deployments_list` | — | Despliegues recientes, y a cuáles se puede hacer rollback (`limit`) |
| `rebase_cloud_rollback` | — | Volver a poner en servicio un despliegue exitoso anterior (`deploymentId`) |

`rebase_cloud_provision` crea un proyecto y vincula este directorio. Nunca
lee la `baseUrl` del proyecto activo, así que la barrera no la comprueba; la CLI
la rechaza en un directorio que ya está vinculado.
