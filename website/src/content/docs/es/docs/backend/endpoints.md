---
sourceHash: c2fabe52d7bfc689
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Cada ruta HTTP que monta un backend de Rebase — datos, autenticación, almacenamiento, administración, meta — con el control de acceso de cada una y la página que la explica.
---

Cada ruta que monta el servidor, en una sola tabla, junto con los requisitos para acceder a ella.

Las rutas asumen el `basePath` predeterminado de `/api`; `REBASE_BASE_PATH` las
traslada a todas juntas. `/health`, `/livez` y `/metrics` se ubican fuera de este
a propósito, ya que un orquestador sondea `/health` y no debería necesitar conocer
la ruta base. `/health` *también* está montado bajo este, de modo que `/api/health`
responde de la misma manera en lugar de devolver un error 404 en el momento exacto
en que alguien está comprobando si el servidor sigue activo.

Un control de validación — `tooling/scripts/docs-verify/check-endpoint-index.mjs` —
compara esta tabla con las rutas que registra el código fuente, impidiendo que se
añada una nueva superficie sin que aparezca aquí.

## Controles de acceso (Gates)

| Control | Significado |
|---|---|
| **none** | Sin autenticación. Cualquiera que tenga acceso al host puede invocarlo |
| **session** | Un emisor con sesión iniciada: un token de acceso o una clave de API con alcance para la operación |
| **`resource:action`** | Un emisor que posee ese [scope](/docs/backend/roles-and-scopes/): un administrador, un usuario cuyo rol lo declara, una clave de API creada con él o la clave de servicio |
| **RLS** | Autenticado, y luego la base de datos decide fila por fila — consulte [Reglas de seguridad](/docs/collections/security-rules/) |
| **dev** | Montado solo fuera de producción |

## Datos

Se genera por tabla, por lo que las rutas llevan sus slugs en lugar de una
lista fija. `:slug` es el slug de una tabla (su nombre, a menos que `defineTable` defina `slug`).

| Método | Ruta | Control | Más información |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | El listado, con parámetros de consulta en el cuerpo — [Consultas demasiado largas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | El recuento, con parámetros de consulta en el cuerpo — [Consultas demasiado largas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Recalcula una vista materializada, en las vistas que están materializadas — [Vistas](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias obsoleto de `PATCH` — la misma escritura parcial, responde con `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserta varias filas, opcionalmente con upsert — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Actualiza varias filas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina varias filas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Escribe entre tablas en una sola transacción — [Escritura mediante REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Historial de entidades](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Historial de entidades](/docs/backend/history/) |

`:id` es la clave de la fila. En una tabla con clave compuesta, es el valor de
cada columna de la clave, en el orden de la clave, unidos por `:::` (cada parte
codificada para URL): una tabla con clave en `(agency_id, id)` direcciona una fila
como `/api/data/proposals/<agency_id>:::<id>`. Una dirección con un número
incorrecto de partes se rechaza con `400 COMPOSITE_KEY_ADDRESS`, indicando las columnas de la clave.

El recuento y la agregación son rutas propias, registradas antes de `/:id` para
que `aggregate` no se interprete como el id de una entidad. `?select=` y `?groupBy=`
son sus parámetros, y `select` es obligatorio en `/aggregate`.

La búsqueda de texto, la búsqueda vectorial, la inclusión de relaciones y la selección de campos
*son* parámetros de consulta en `GET /api/data/:slug` en lugar de rutas: `searchString`,
`vector_search`, `include`, `fields`. Consulte [API REST](/docs/backend/api/).

Un proyecto que no declara tablas y no realiza introspección de ninguna sirve este prefijo
como un único `404 NO_TABLES`. Consulte [Solo backend](/docs/getting-started/headless/).

## Autenticación

| Método | Ruta | Control | Más información |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Lo que la pantalla de inicio de sesión puede ofrecer: registro, restablecimiento de contraseña, enlace mágico (magic link), códigos por correo, inicio de sesión de invitados, proveedores de OAuth y si la configuración del primer administrador está pendiente |
| `POST` | `/api/auth/register` | none | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (un token de actualización) | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Revoca todas las demás sesiones |
| `DELETE` | `/api/auth/sessions/:id` | session | Revoca una sesión |
| `POST` | `/api/auth/forgot-password` | none | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (un token de restablecimiento) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Envía por correo un enlace de confirmación a la nueva dirección — [Cambiar una dirección de correo electrónico](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un token de enlace) | Transfiere la cuenta a la nueva dirección — [Cambiar una dirección de correo electrónico](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Autenticación](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token de verificación) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un token de verificación y una sesión o la contraseña para conservarla) | [Verificación de correo electrónico](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un token de enlace) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/otp/verify` | none (un código) | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/device` | none | [Inicio de sesión de dispositivo](/docs/backend/device-sign-in/). Desactivado a menos que el backend lo active |
| `POST` | `/api/auth/device/token` | none (un código de dispositivo) | [Inicio de sesión de dispositivo](/docs/backend/device-sign-in/): sondeo del dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Inicio de sesión de dispositivo](/docs/backend/device-sign-in/): lo que muestra la página de aprobación |
| `POST` | `/api/auth/device/approve` | session (`aal2` con un segundo factor) | [Inicio de sesión de dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Inicio de sesión de dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sesiones de invitado. Desactivado a menos que se use `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un invitado) | Convierte un invitado en una cuenta |
| `POST` | `/api/auth/find-user` | session | Desactivado a menos que se use `AUTH_ALLOW_USER_LOOKUP` — es una superficie de enumeración |
| `POST` | `/api/auth/:provider` | none | Uno por cada proveedor de OAuth/OIDC configurado |
| `POST` | `/api/auth/link/:provider` | session | Vincula un proveedor a la cuenta que ha iniciado sesión |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un inicio de sesión en curso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un id de desafío) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Cada scope que conoce este backend y los que posee el emisor — [Roles y scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (una cuenta) | Las [claves personales](/docs/backend/api-keys/#personal-keys) propias del emisor |
| `POST` | `/api/auth/keys` | session (una cuenta) | La clave en texto sin formato se devuelve solo una vez. `403 PERSONAL_KEYS_DISABLED` a menos que la tabla de auth defina `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (una cuenta) | Revoca una de las claves propias del emisor |
| `GET` | `/.well-known/jwks.json` | none | El JWKS público, cuando está configurada la [firma asimétrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Administración

Todo lo que se encuentra bajo `/api/admin` requiere un scope del plano de administración, y cada
superficie define el suyo: `users:read` lista cuentas, `cron:write` activa un trabajo.
Un administrador posee todos ellos, al igual que la clave de servicio. Una persona posee los que
declaran sus roles, y una clave de API aquellos con los que fue creada. Una clave con scope limitado a
una tabla no accede a nada de esto. Consulte [Roles y scopes](/docs/backend/roles-and-scopes/).

| Método | Ruta | Control | Más información |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, y solo mientras no exista ningún administrador | Rechazado en producción — consulte [Bootstrap del primer usuario](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestión de usuarios |
| `POST` | `/api/admin/users` | `users:write` | Gestión de usuarios. Se rechazan roles superiores a los del propio emisor |
| `POST` | `/api/admin/users/import` | `users:write` | [Importa cuentas](/docs/backend/auth-endpoints/#importing-accounts) conservando sus ids: sin contraseña, sin correo, omitiendo id o correo ya existentes. Como máximo 100 por solicitud. Se rechazan roles superiores a los del propio emisor |
| `GET` | `/api/admin/users/pick` | `users:read`, o acceso de escritura a una tabla con una columna `.userId()` | La [lectura del selector de usuarios](/docs/backend/auth-endpoints/): solo id, nombre, correo y avatar. Una tabla cuyas reglas de escritura sean SQL puro no cuenta |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestión de usuarios |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Rechazado para una cuenta que posee más permisos que el emisor |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Rechazado para una cuenta que posee más permisos que el emisor |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emite una contraseña temporal |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Elimina los segundos factores y códigos de recuperación de la cuenta, y finaliza sus sesiones |
| `GET` | `/api/admin/guests` | `users:read` | Invitados, ordenados primero los vistos hace más tiempo. `?lastSeenBefore=` los restringe a lo que procesaría la eliminación posterior, y `total` los cuenta |
| `DELETE` | `/api/admin/guests` | `users:write` | Elimina un lote de invitados vistos por última vez antes de `?lastSeenBefore=`, el cual es obligatorio. Responde `{ deleted, skipped, remaining }`. Repita mientras `remaining` no sea 0, con `?offset=` establecido en la cantidad omitida. No afecta a las cuentas |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Elimina un invitado. Una cuenta se rechaza con `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` y los roles que declara el proyecto, con sus scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Claves de API](/docs/backend/api-keys/). Nunca para una clave de API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La clave en texto sin formato se devuelve solo una vez, al crearla |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Claves de API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Claves de API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Claves de API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Trabajos cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Trabajos cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Habilita o deshabilita un trabajo |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Trabajos cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Ejecuta un trabajo de inmediato. `?async=1` responde `202` una vez iniciado — [API de trabajos cron](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventario de copias de seguridad |
| `GET` | `/api/admin/backups/download` | `backups:read` | Transmite una copia de seguridad. Con el parámetro `?token=` obtenido de un enlace de descarga no se requiere encabezado, únicamente para esa copia |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un enlace a una copia de seguridad, `{ key }` → `{ url, token, expiresIn }`, válido por 60 segundos — [Copias de seguridad](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Inicia un escaneo en segundo plano de los archivos almacenados que ninguna fila referencia, `?storageId=&olderThanHours=`. Responde `202` con el registro del escaneo: `id`, `status` (`queued`) y `runner` (`worker` cuando es un trabajo `storage.orphans` en la cola de trabajos, `in-process` cuando el propio servidor lo ejecuta). El registro se almacena en la fuente, bajo el prefijo reservado `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | El registro del escaneo, `?storageId=`. Mientras se ejecuta: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` de `collectionsTotal`, `unscanned`). Una vez `completed`: `result`, el informe que devolvía el antiguo `GET /orphans`. Una ejecución que dejó de reportar durante 10 minutos se responde como `failed`. `404 STORAGE_SCAN_NOT_FOUND` si la fuente no contiene dicho escaneo |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Elimina en segundo plano los huérfanos de un escaneo completado, `202`. Cada uno se verifica nuevamente contra cada fila y entrada del historial, y se vuelve a solicitar justo antes de eliminarse. El resultado es el campo `deletion` del registro del escaneo. Devuelve `409` con `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` o `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Obsoleto: el escaneo dentro de la solicitud, `?storageId=&olderThanHours=`. Responde con `Deprecation: true`. Utilice `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Obsoleto, sin `?scan=`: vuelve a escanear y elimina dentro de la solicitud. `409 STORAGE_SCAN_INCOMPLETE` cuando una tabla no se pudo leer |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia una carpeta a otra fuente conservando las mismas claves, una página por llamada — lo que envía `rebase storage move`; `400 STORAGE_SAME_LOCATION` para `deleteSource` entre dos fuentes con la misma ubicación de almacenamiento |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Vuelve a listar la fuente tras un traslado, con el mismo cuerpo, una página por llamada: `{ checked, notMoved: [{ key, reason }], cursor? }` — cada archivo que aún permanece en la fuente con `deleteSource`, cada archivo del cual el destino carece de copia sin él. `rebase storage move` lo consulta al terminar el traslado |
| `GET` | `/api/admin/logs` | `logs:read` | El búfer de registros recientes |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Las entradas más recientes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Eventos enviados por el servidor (Server-sent events) |
| `GET` | `/api/admin/rls-audit` | `schema:read` | El resultado más reciente de la auditoría programada |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Roles, roles de reglas de usuarios y claves de servicio activas que un administrador puede simular |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Cada tabla según cómo accede `{ role?, userId?, apiKeyId? }`: filas visibles frente a las del emisor, ocultas por scope o RLS, campos enmascarados. Solo para sesión de administrador |
| `POST` | `/api/admin/sql/csv` | `database:write` | Transmite el resultado completo de una consulta de solo lectura como CSV — opción "Download full result as CSV" de [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Lo que modificó una [rama](/docs/backend/branching/#reviewing-and-merging-a-branch): esquema, políticas y filas, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Escribe las filas de la rama en su rama principal, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` si cualquiera de los lados cambió desde el diff o si hay conflicto de filas |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Edición de esquemas en vivo](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planifica un cambio; nunca aplica ninguno |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Solo personas, a menos que se use `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Planifica flexibilizar `NOT NULL` y descartar las columnas no declaradas indicadas en `drop`, para [reconciliación de esquemas](/docs/cli/schema/#rebase-schema-reconcile); nunca aplica ninguno |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Aplica un plan de reconciliación, únicamente si su `digest` coincide con el `confirm` enviado |
| `POST` | `/api/admin/schema/reload` | `schema:write` | Vuelve a inspeccionar PostgreSQL y recarga REST, Realtime, OpenAPI, políticas de almacenamiento, webhooks, roles y trabajos programados en caliente, sin necesidad de reiniciar |
| `GET` | `/api/admin/db/tables` | `database:read` | Lista las tablas de usuario de PostgreSQL con columnas, índices, políticas RLS y superposiciones de `rebase.table_meta` |
| `POST` | `/api/admin/db/tables` | `database:write` | Crea una tabla de PostgreSQL con políticas RLS iniciales y metadatos opcionales (`dryRun: true` previsualiza el SQL), y luego recarga en vivo |
| `PATCH` | `/api/admin/db/tables/:table` | `database:write` | Renombra una tabla, alterna Row Level Security (`rlsEnabled`) o actualiza la configuración de superposición de API en `rebase.table_meta` (`meta`), y luego recarga en vivo |
| `DELETE` | `/api/admin/db/tables/:table` | `database:write` | Elimina una tabla de PostgreSQL (requiere `{ confirm: "<table>" }` salvo que `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/columns` | `database:write` | Añade una columna a una tabla de PostgreSQL y recarga en vivo |
| `PATCH` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Modifica una columna (nombre, tipo, nulabilidad, valor por defecto) y recarga en vivo |
| `DELETE` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Elimina una columna (requiere `{ confirm: "<column>" }` salvo que `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/indexes` | `database:write` | Crea un índice en una tabla de PostgreSQL |
| `DELETE` | `/api/admin/db/tables/:table/indexes/:index` | `database:write` | Elimina un índice en una tabla de PostgreSQL |
| `POST` | `/api/admin/db/tables/:table/policies` | `database:write` | Crea una política RLS de PostgreSQL en una tabla y recarga en vivo |
| `DELETE` | `/api/admin/db/tables/:table/policies/:policy` | `database:write` | Elimina una política RLS de PostgreSQL en una tabla y recarga en vivo |
| `GET` | `/api/admin/storage/policies` | `database:read` | Lista las políticas declarativas de almacenamiento sin código de `rebase.storage_policies` |
| `POST` | `/api/admin/storage/policies` | `database:write` | Crea una política declarativa de acceso al almacenamiento |
| `PATCH` | `/api/admin/storage/policies/:id` | `database:write` | Actualiza una política declarativa de acceso al almacenamiento |
| `DELETE` | `/api/admin/storage/policies/:id` | `database:write` | Elimina una política declarativa de acceso al almacenamiento |
| `GET` | `/api/admin/webhooks` | `database:read` | Lista los webhooks de base de datos sin código de `rebase.webhooks` |
| `POST` | `/api/admin/webhooks` | `database:write` | Crea un webhook de base de datos |
| `PATCH` | `/api/admin/webhooks/:id` | `database:write` | Actualiza un webhook de base de datos |
| `DELETE` | `/api/admin/webhooks/:id` | `database:write` | Elimina un webhook de base de datos |
| `POST` | `/api/admin/webhooks/:id/test` | `database:write` | Envía una entrega de prueba en vivo a un endpoint de webhook configurado |
| `GET` | `/api/admin/roles` | `users:read` | Lista los roles RBAC y scopes sin código de `rebase.roles` |
| `POST` | `/api/admin/roles` | `users:write` | Crea o actualiza un rol RBAC sin código |
| `PUT` | `/api/admin/roles/:name` | `users:write` | Actualiza un rol RBAC sin código |
| `DELETE` | `/api/admin/roles/:name` | `users:write` | Elimina un rol RBAC sin código |
| `GET` | `/api/admin/cron/jobs` | `cron:read` | Lista los trabajos programados SQL/HTTP sin código de `rebase.cron_jobs` |
| `POST` | `/api/admin/cron/jobs` | `cron:write` | Crea un trabajo cron programado SQL o HTTP sin código. Un trabajo SQL ejecuta su instrucción con la propia conexión del servidor, por lo que también requiere `database:write` |
| `PATCH` | `/api/admin/cron/jobs/:id` | `cron:write` | Actualiza un trabajo cron programado sin código; un trabajo SQL, o uno que pase a serlo, también requiere `database:write` |
| `DELETE` | `/api/admin/cron/jobs/:id` | `cron:write` | Elimina un trabajo cron programado sin código |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Indica si el editor está disponible y el motivo si no lo está |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Cada tabla que exporta `backend/schema/index.ts` tal como la lee el editor, con lo que se edita en código (solo lectura) y por qué — [Edición de esquemas en vivo](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }`: los archivos que escribiría la edición, compilados; no escribe nada |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | La misma edición, escrita en `backend/schema`; no altera la base de datos |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tablas que contiene la base de datos y que `backend/schema` no declara: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | Descripción detallada de una de ellas: `{ table: { …, descriptor, rlsRaised?, notes } }`, para "Import an existing table". `404` si es desconocida o ya declarada, `400 SCHEMA_EDIT_REFUSED` si carece de clave primaria |
| `GET` | `/api/admin/ui-config` | session | Las preferencias de UI del espacio de trabajo por tabla, las propias del emisor y si el emisor puede modificar las del espacio de trabajo — consulte [Personalizar una tabla](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Fusiona un delta de `UiTablePreferences` en las preferencias del espacio de trabajo de una tabla (`replace` reemplaza). Escrito en `frontend/src/cms/ui-config.json` si el servidor puede escribir en el código fuente del proyecto, o en `rebase.ui_preferences` en caso contrario |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Elimina las preferencias del espacio de trabajo de una tabla |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (una persona) | Las preferencias propias del emisor para una tabla. Una clave de API no tiene ninguna: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (una persona) | Elimina las preferencias propias del emisor para una tabla |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Correos que el transporte de desarrollo capturó en lugar de enviar |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Vacía el buzón de correos capturados |

`/api/admin/cron`, `/api/admin/logs` y `/api/admin/schema-editor` también se
sirven en sus rutas anteriores a la versión 0.17 sin el segmento `/admin`. Esos alias
existen para proyectos que no han migrado; escriba el código nuevo utilizando la ruta canónica.

## Esquema

| Método | Ruta | Control | Más información |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, o una credencial con `schema:read` o un scope `data:*` | Cada tabla que sirve este backend, como un array JSON de descriptores filtrados para el emisor |
| `GET` | `/api/schema/tables/:slug` | igual que arriba | Un descriptor. `404 TABLE_NOT_FOUND` si este emisor no tiene acceso a esa tabla |

Los descriptores son a partir de los cuales el CMS renderiza sus valores predeterminados,
Studio dibuja el visualizador de esquemas y el editor de RLS, y las aplicaciones MCP
renderizan tablas y formularios. Incluyen las columnas con sus tipos de Postgres,
nulabilidad, reglas de validación y almacenamiento, relaciones por slug y la postura
de seguridad a nivel de fila (RLS). El código de los hooks nunca sale del servidor:
un descriptor solo indica qué hooks tiene una tabla.

Lo que se entrega al emisor depende de quién sea:

| Emisor | Tablas | Oculto / Redactado |
|---|---|---|
| Un administrador, un titular de `schema:read` o la clave de servicio | todas las tablas, incluidas las vistas simples | columnas `.private()`, para todos |
| Cualquier otra persona con sesión iniciada, incluidos invitados | solo las tablas a las que una regla permisiva da acceso para sus roles (más la tabla de auth y las vistas materializadas cuyos `roles` posea) | columnas y relaciones para las cuales sus roles no superen `access.read`; columnas `.private()`; únicamente las reglas aplicables a sus roles; relaciones hacia tablas a las que no tiene acceso; indicadores de hooks; SQL puro en reglas, políticas compiladas, consultas de vistas e índices |
| Una credencial (clave de API, token de MCP o token de plataforma) | las tablas indicadas en sus scopes `data:*`, o todas si cuenta con `schema:read` | igual que arriba, evaluado según los scopes que posea |
| Nadie con sesión iniciada | ninguna — `401` — a menos que el backend defina `schemaTables: { public: true }` | en ese caso, las tablas con una regla `select` pública, filtradas como para el emisor con menos privilegios: sin columnas con lista `access.read`, sin SQL puro ni políticas |

Una persona conserva `metadata`, `softDelete`, `tenant`, `history` y `search` en
las tablas a las que tiene acceso. `schemaTables: { persons: "all" }` en las
opciones del backend describe cada tabla y regla a cualquier emisor autenticado;
el valor predeterminado es `"granted"`. Las conexiones MCP se evalúan como una
credencial mediante el mismo serializador.

La identidad del emisor proviene del adaptador de autenticación del backend, el mismo
que consultan las rutas de datos, por lo que un backend con un [adaptador personalizado](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
se atiende aquí (y en `/api/docs` y en cada superficie de administración) con los roles que
devuelve su adaptador; una credencial que no reconozca genera un `401`.

Una credencial que no posee `schema:read` ni un scope `data:*` recibe
`403 SCOPE_MISSING`. Un backend sin autenticación configurada responde a
cada solicitud con `404 SCHEMA_UNAVAILABLE`: no hay un emisor para el cual
filtrar información, y `auth.requireAuth: false` no cambia esto.

Las respuestas incluyen `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` y el encabezado `x-rebase-schema`; una solicitud cuyo encabezado `If-None-Match`
coincida con la etiqueta actual recibe un `304`. La etiqueta cambia cuando cambia el esquema,
incluso tras una edición del esquema en vivo.

`schemaTables` es una opción de `initializeRebaseBackend` sin variable de entorno:
un proyecto generado mediante scaffolding accede a ella al desacoplarse (`ejecting`).

## Almacenamiento

| Método | Ruta | Control | Más información |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, por clave | [Almacenamiento](/docs/backend/storage/#storage-endpoints): metadatos para un máximo de 100 objetos |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Las fuentes de almacenamiento nombradas que sirve este backend |
| `OPTIONS` | `/api/storage/tus` | none | Subidas reanudables: las versiones y extensiones de TUS que admite este servidor |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Subidas reanudables: creación |
| `GET` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: desplazamiento (offset) |
| `PATCH` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: anexar |
| `DELETE` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: cancelar |

Un despliegue sin almacenamiento configurado responde en este prefijo con un `501` indicando
la variable que necesita, en lugar de devolver un 404 como si la funcionalidad no existiese —
excepto `GET /api/storage/sources`, que responde `200` con una lista vacía.

## Push

Montado únicamente con `push: true` (`REBASE_PUSH=true`). Con push activado pero sin claves,
cada ruta responde `503 PUSH_NOT_CONFIGURED`. Las claves de API y la clave de servicio son
rechazadas: una suscripción pertenece al navegador de una persona.

| Método | Ruta | Control | Más información |
|---|---|---|---|
| `GET` | `/api/push/key` | session | La clave pública de VAPID — [Notificaciones push](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Este navegador acepta notificaciones para el emisor — [Notificaciones push](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Detenerlas, en el navegador propio del emisor — [Notificaciones push](/docs/backend/push-notifications/#routes) |

## Funciones

| Método | Ruta | Control | Más información |
|---|---|---|---|
| `GET` | `/api/functions` | session | Los nombres de las funciones servidas y cuántos archivos no pudieron cargarse |
| any | `/api/functions/<name>` | lo que la función declare. Una clave de API también necesita `functions:invoke` | [Funciones personalizadas](/docs/backend/custom-functions/) |

Una ruta por cada archivo bajo `backend/functions/`, por lo que las rutas proceden de su
proyecto. `GET /api/functions` las lista únicamente para un emisor autenticado — una
sesión, una clave de API o la clave de servicio — y responde a cualquier otra persona con `401`: un
inventario de los endpoints personalizados de un despliegue no es público.

## RPC

| Método | Ruta | Control | Más información |
|---|---|---|---|
| `POST` | `/api/rpc/<name>` | el `access` de la RPC: none para `"public"` (con límite de tasa), session para `"authenticated"`; luego RLS dentro de la función. Una clave de API también requiere `data:read` (`data:write` para una RPC con `write: true`) | [Funciones SQL como RPC](/docs/backend/rpc/) |

Una ruta por cada `defineRpc` exportado desde `backend/schema/index.ts`, por lo que las
rutas provienen de su proyecto. Un nombre que nadie declaró responde `404
RPC_NOT_FOUND`, incluso cuando la base de datos tenga una función con ese nombre.

## Meta y operaciones

| Método | Ruta | Control | Más información |
|---|---|---|---|
| `GET` | `/livez` | none | Solo liveness: si este proceso está en ejecución. No interactúa con la base de datos, por lo que es la ruta de sondeo que debe usar un contenedor — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness y readiness. Informa sobre cada fuente de datos configurada, no solo la predeterminada |
| `GET` | `/api/docs` | por defecto, la audiencia del endpoint de esquema (401 para anónimos a menos que `schemaTables.public`, 403 para credenciales sin scope de esquema o datos); none cuando `enableSwagger` es `true`; el control de admin cuando es `false` | El documento OpenAPI 3.0 de las tablas que `GET /api/schema/tables` describe al emisor (todas ellas si `enableSwagger: true`). `404 DOCS_UNAVAILABLE` cuando no hay autenticación configurada |
| `GET` | `/api/swagger` | none | Swagger UI. Solo cuando `enableSwagger` es `true`, y nunca en producción |
| `GET` | `/api/meta/schema-version` | none | El hash del esquema a partir del cual se compiló este backend y la versión del runtime, y nada más |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — cada tabla tal como la ve un administrador, la entrada para `rebase generate-sdk --from`. `404` cuando no hay autenticación configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` cuando esté configurado | Métricas de Prometheus, cuando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` cuando esté configurado | Las series registradas que alimentan los gráficos de Studio. `501` en un runtime sin backend |
| `GET` | `/metrics/history/batch` | `REBASE_METRICS_TOKEN` cuando esté configurado | Hasta 16 series registradas a la vez, `?series=<a>,<b>&minutes=<n>&bucket=<1\|5\|30\|180>`, agrupadas en buckets. Incluye solicitudes por minuto y errores por superficie. `501` en un runtime sin backend |

Las conexiones WebSocket llegan como una actualización HTTP (HTTP upgrade) en el mismo servidor
en lugar de en una ruta separada — consulte [Realtime](/docs/backend/realtime/).

## Superficie MCP

Montado únicamente cuando `REBASE_MCP_ENABLED=true`, lo cual también requiere
`REBASE_PUBLIC_URL` — consulte
[Configuración](/docs/getting-started/configuration/#mcp-surface). Desactivado de
forma predeterminada: ningún `REBASE_ROLE` activa esto, ya que otorga acceso al proyecto a
software de terceros y esa es una decisión que debe tomar una persona.

Los documentos `.well-known` residen en el **origen**, no bajo `basePath`: RFC 8414
y RFC 9728 definen esas rutas de forma relativa al origen, y un cliente las obtiene
antes de disponer de ningún token.

| Método | Ruta | Control | Más información |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadatos de RFC 9728 que identifican este recurso y su servidor de autorización. Se sirve también en el formato con sufijo de ruta |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadatos de RFC 8414: los endpoints, tipos de concesión (grant types) y métodos PKCE que este despliegue admite |
| `POST` | `/mcp` | Bearer de OAuth, o una clave de API | El endpoint del protocolo MCP. Actúa **en nombre del usuario con sesión iniciada** (o de quien represente la clave), por lo que cada lectura y escritura queda sujeta al mismo RLS. Los scopes `data:*` determinan qué herramientas se ofrecen |
| `GET` | `/mcp` | Bearer de OAuth, o una clave de API | Responde `405` con `Allow: POST, DELETE`: este servidor no abre streams iniciados por el servidor. El token se comprueba primero, por lo que uno ausente o caducado recibe el desafío `401` |
| `DELETE` | `/mcp` | none | Responde `204`. El endpoint no mantiene sesiones, por lo que no hay nada que finalizar |
| `POST` | `/api/oauth/register` | con límite de tasa | Registro dinámico de clientes según RFC 7591. Rechazado cuando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | Pantalla de consentimiento a la que se redirige al cliente |
| `POST` | `/api/oauth/authorize/decision` | session | La respuesta de la persona a dicha pantalla: aprobar o denegar |
| `POST` | `/api/oauth/token` | credenciales de cliente + PKCE | Intercambia un código de autorización o renueva un token |
| `POST` | `/api/oauth/revoke` | credenciales de cliente | Revocación de tokens según RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Clientes aprobados por este usuario |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Retira una concesión, permitiendo a un usuario revocar el consentimiento sin un administrador |

El endpoint MCP propio del panel de administración no forma parte de esta superficie: utiliza
la sesión del panel de administración, nunca un token OAuth, y se monta junto con las
rutas de administración independientemente de si `REBASE_MCP_ENABLED` está configurado,
sobre un controlador que restringe cada llamada mediante RLS.

| Método | Ruta | Control | Más información |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, nunca anónimo | **Experimental.** Las mismas herramientas que `/mcp`, para la persona autenticada, con `data:read`, `data:write` y `data:delete`, bajo su RLS. La vista `savedAppsView` del panel de administración abre [aplicaciones guardadas](/docs/ai/remote-mcp/) a través de él |

## Relacionado

- [API REST](/docs/backend/api/) — las rutas de datos al detalle: filtros, ordenación, paginación, errores
- [Endpoints de autenticación](/docs/backend/auth-endpoints/) — formatos de solicitud y respuesta para la tabla de autenticación anterior
- [Entorno y configuración](/docs/getting-started/configuration/) — las variables que determinan cuáles de estas rutas se montan
