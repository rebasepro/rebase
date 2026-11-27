---
sourceHash: 3ade348460459f69
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Cada ruta HTTP que monta un backend de Rebase — datos, autenticación, almacenamiento, administración, meta — con el control de acceso de cada una y la página que la explica.
---

Todas las rutas que monta el servidor, en una sola tabla, con los requisitos necesarios para acceder a ellas.

Las rutas asumen el `basePath` predeterminado de `/api`; `REBASE_BASE_PATH` las
traslada a todas juntas. `/health`, `/livez` y `/metrics` se encuentran fuera a
propósito, debido a que un orquestador sondea `/health` y no debería tener que
conocer la ruta base. `/health` *también* está montado debajo de ella, por lo que
`/api/health` responde de la misma manera en lugar de devolver un error 404 en el
momento justo en que alguien está comprobando si el servidor está activo.

Un gate (control de acceso) — `tooling/scripts/docs-verify/check-endpoint-index.mjs` —
compara esta tabla con las rutas que registra el código fuente, de modo que no se
puede añadir una nueva superficie sin que aparezca aquí.

## Gates

| Gate | Significado |
|---|---|
| **none** | No autenticado. Cualquiera que pueda alcanzar el host puede llamarlo |
| **session** | Un emisor autenticado: un token de acceso o una API key con alcance para la operación |
| **`resource:action`** | Un emisor que posee ese [scope](/docs/backend/roles-and-scopes/): un administrador, una persona cuyo rol lo declara, una API key creada con él o la service key |
| **RLS** | Autenticado, y luego la base de datos decide fila por fila — consulte [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montado solo fuera de producción |

## Data

Generado por tabla, por lo que las rutas llevan sus slugs en lugar de una lista
fija. `:slug` es el slug de una tabla (su nombre, a menos que `defineTable` defina `slug`).

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | El listado, con los parámetros de consulta en el cuerpo — [Consultas demasiado largas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | El conteo, con los parámetros de consulta en el cuerpo — [Consultas demasiado largas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Recalcula una vista materializada, en las vistas que son materializadas — [Vistas](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias obsoleto de `PATCH` — misma escritura parcial, responde con `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserta múltiples filas, opcionalmente realizando upsert — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Actualiza múltiples filas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina múltiples filas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Escribe en múltiples tablas en una sola transacción — [Escritura a través de REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Historial de entidades](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Historial de entidades](/docs/backend/history/) |

`:id` es la clave de la fila. En una tabla con clave compuesta, corresponde al
valor de cada columna de la clave, en el orden de la clave, unidos por `:::` (cada
parte codificada para URL): una tabla cuya clave sea `(agency_id, id)` direcciona
una fila como `/api/data/proposals/<agency_id>:::<id>`. Una dirección con un
número incorrecto de partes se rechaza con `400 COMPOSITE_KEY_ADDRESS`, indicando
las columnas de la clave.

El conteo y la agregación son rutas propias, registradas antes de `/:id` para que
`aggregate` no se interprete como un id de entidad. `?select=` y `?groupBy=` son
sus parámetros, y `select` es obligatorio en `/aggregate`.

La búsqueda de texto, la búsqueda vectorial, la inclusión de relaciones y la
selección de campos *son* parámetros de consulta en `GET /api/data/:slug` en lugar
de rutas — `searchString`, `vector_search`, `include`, `fields`. Consulte
[API REST](/docs/backend/api/).

Un proyecto que no declara tablas y no inspecciona ninguna sirve este prefijo como
un único error `404 NO_TABLES`. Consulte [Solo backend](/docs/getting-started/headless/).

## Auth

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Lo que la pantalla de inicio de sesión puede ofrecer: registro, restablecimiento de contraseña, magic link, códigos por correo electrónico, inicio de sesión como invitado, proveedores OAuth y si la configuración del primer administrador está pendiente |
| `POST` | `/api/auth/register` | none | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (un refresh token) | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Revoca todas las demás sesiones |
| `DELETE` | `/api/auth/sessions/:id` | session | Revoca una sesión |
| `POST` | `/api/auth/forgot-password` | none | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (un token de restablecimiento) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Envía un enlace de confirmación a la nueva dirección — [Cambiar una dirección de correo electrónico](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un token de enlace) | Traslada la cuenta a la nueva dirección — [Cambiar una dirección de correo electrónico](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Autenticación](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token de verificación) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un token de verificación y una sesión o la contraseña para conservarla) | [Verificación de correo electrónico](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un token de enlace) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/otp/verify` | none (un código) | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/device` | none | [Inicio de sesión de dispositivo](/docs/backend/device-sign-in/). Desactivado a menos que el backend lo active |
| `POST` | `/api/auth/device/token` | none (un código de dispositivo) | [Inicio de sesión de dispositivo](/docs/backend/device-sign-in/): el sondeo (poll) del dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Inicio de sesión de dispositivo](/docs/backend/device-sign-in/): lo que muestra la página de aprobación |
| `POST` | `/api/auth/device/approve` | session (`aal2` con un segundo factor) | [Inicio de sesión de dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Inicio de sesión de dispositivo](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sesiones de invitado. Desactivado a menos que `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un invitado) | Convierte un invitado en una cuenta |
| `POST` | `/api/auth/find-user` | session | Desactivado a menos que `AUTH_ALLOW_USER_LOOKUP` — es una superficie de enumeración |
| `POST` | `/api/auth/:provider` | none | Uno por cada proveedor OAuth/OIDC configurado |
| `POST` | `/api/auth/link/:provider` | session | Vincula un proveedor a la cuenta con sesión iniciada |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un inicio de sesión en curso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un id de challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Cada scope que este backend conoce y los que posee el emisor — [Roles y scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (una cuenta) | Las [claves personales](/docs/backend/api-keys/#personal-keys) propias del emisor |
| `POST` | `/api/auth/keys` | session (una cuenta) | La clave en texto plano se devuelve una sola vez. `403 PERSONAL_KEYS_DISABLED` a menos que la tabla de auth configure `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (una cuenta) | Revoca una de las claves propias del emisor |
| `GET` | `/.well-known/jwks.json` | none | El JWKS público, cuando la [firma asimétrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) está configurada |

## Admin

Todo lo que está bajo `/api/admin` requiere un scope del plano de administración,
y cada superficie especifica el suyo propio: `users:read` lista cuentas, `cron:write`
activa un trabajo. Un administrador los posee todos, al igual que la service key.
Una persona posee aquellos que declaran sus roles, y una API key aquellos con los
que fue creada. Una clave con alcance limitado a una tabla no tiene acceso a nada
de esto. Consulte [Roles y scopes](/docs/backend/roles-and-scopes/).

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, y solo mientras no exista ningún administrador | Rechazado en producción — consulte [Bootstrap del primer usuario](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestión de usuarios |
| `POST` | `/api/admin/users` | `users:write` | Gestión de usuarios. Se rechazan roles superiores a los del emisor |
| `POST` | `/api/admin/users/import` | `users:write` | [Importa cuentas](/docs/backend/auth-endpoints/#importing-accounts) manteniendo sus ids: sin correo electrónico, sin contraseña a menos que se incluya su hash bcrypt, omitiendo ids o correos ya ocupados. Como máximo 100 por solicitud. Se rechazan roles superiores a los del emisor |
| `GET` | `/api/admin/users/pick` | `users:read`, o acceso de escritura a una tabla con una columna `.userId()` | La [lectura del selector de usuarios](/docs/backend/auth-endpoints/): solo id, nombre, correo electrónico y avatar. Una tabla cuyas reglas de escritura sean SQL puro no cuenta |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestión de usuarios |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Rechazado para una cuenta que posea más permisos que el emisor |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Rechazado para una cuenta que posea más permisos que el emisor |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emite una contraseña temporal |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Elimina los segundos factores y códigos de recuperación de la cuenta, finaliza sus sesiones |
| `GET` | `/api/admin/guests` | `users:read` | Invitados, ordenados primero por los vistos hace más tiempo. `?lastSeenBefore=` los restringe a lo que tomaría la eliminación siguiente, y `total` los cuenta |
| `DELETE` | `/api/admin/guests` | `users:write` | Elimina un lote de invitados vistos por última vez antes de `?lastSeenBefore=`, que es obligatorio. Responde `{ deleted, skipped, remaining }`. Repita mientras `remaining` no sea 0, con `?offset=` establecido en la cantidad que se ha omitido. No se puede acceder a cuentas |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Elimina un invitado. Una cuenta se rechaza con `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` y los roles que declara el proyecto, con sus scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API keys](/docs/backend/api-keys/). Nunca mediante una API key |
| `POST` | `/api/admin/api-keys` | `keys:write` | La clave en texto plano se devuelve una sola vez, al crearse |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [API keys](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Habilita o deshabilita un trabajo |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Ejecuta un trabajo ahora. `?async=1` responde `202` una vez iniciado — [API de Cron Jobs](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventario de copias de seguridad |
| `GET` | `/api/admin/backups/download` | `backups:read` | Transmite una copia de seguridad en flujo. Con `?token=` proveniente de un enlace de descarga, no se necesita encabezado, únicamente para esa copia de seguridad |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un enlace a una copia de seguridad, `{ key }` → `{ url, token, expiresIn }`, válido por 60 segundos — [Copias de seguridad](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Inicia un escaneo en segundo plano de los archivos almacenados que ninguna fila nombra, `?storageId=&olderThanHours=`. Responde `202` con el registro del escaneo: `id`, `status` (`queued`) y `runner` (`worker` cuando es un trabajo de `storage.orphans` en la cola de trabajos, `in-process` cuando el propio servidor lo ejecuta). Su registro se escribe en la fuente, bajo la ruta reservada `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | El registro del escaneo, `?storageId=`. Mientras se ejecuta: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` de `collectionsTotal`, `unscanned`). Una vez `completed`: `result`, el informe que respondía el antiguo `GET /orphans`. Una ejecución que dejó de informar durante 10 minutos se responde como `failed`. `404 STORAGE_SCAN_NOT_FOUND` cuando la fuente no contiene dicho escaneo |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Elimina en segundo plano los huérfanos de un escaneo completado, `202`. Cada uno se verifica nuevamente contra cada fila y entrada del historial, y se vuelve a solicitar justo antes de eliminarse. El resultado es el campo `deletion` del registro de escaneo. `409` con `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` o `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Obsoleto: el escaneo dentro de la solicitud, `?storageId=&olderThanHours=`. Responde con `Deprecation: true`. Utilice `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Obsoleto, sin `?scan=`: escanea de nuevo y elimina dentro de la solicitud. `409 STORAGE_SCAN_INCOMPLETE` cuando una tabla no se pudo leer |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia una carpeta a otra fuente bajo las mismas claves, una página por llamada — lo que envía `rebase storage move`; `400 STORAGE_SAME_LOCATION` para `deleteSource` entre dos fuentes que almacenan en la misma ubicación |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Lista la fuente nuevamente después de un traslado, con el mismo cuerpo, una página por llamada: `{ checked, notMoved: [{ key, reason }], cursor? }` — cada archivo que aún está en la fuente con `deleteSource`, cada archivo del que el destino no tiene copia sin él. `rebase storage move` lo consulta cuando el traslado finaliza |
| `GET` | `/api/admin/logs` | `logs:read` | El búfer de registros recientes |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Las entradas más recientes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Eventos enviados por el servidor (Server-sent events) |
| `GET` | `/api/admin/rls-audit` | `schema:read` | El resultado más reciente de la auditoría programada |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Roles, roles de reglas de usuarios y service keys activas que un administrador puede simular |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Cada tabla según la alcanza `{ role?, userId?, apiKeyId? }`: filas visibles frente a las del emisor, ocultas por scope o RLS, campos enmascarados. Solo sesión de administrador |
| `POST` | `/api/admin/sql/csv` | `database:write` | Transmite en flujo el resultado completo de una consulta de solo lectura como CSV — "Descargar resultado completo como CSV" de [Studio](/docs/studio/) |
| `GET` | `/api/admin/sql/snippets` | `database:read` | Los fragmentos guardados de la consola SQL que ve quien llama: los suyos y los del equipo |
| `POST` | `/api/admin/sql/snippets` | `database:write` | Guarda un fragmento (`name`, `sql`, `visibility`: `personal` o `team`, `favorite`) |
| `PATCH` | `/api/admin/sql/snippets/:id` | `database:write` | Cambia los campos de un fragmento; solo su propietario o un administrador |
| `DELETE` | `/api/admin/sql/snippets/:id` | `database:write` | Elimina un fragmento; solo su propietario o un administrador |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Lo que cambió en una [rama (branch)](/docs/backend/branching/#reviewing-and-merging-a-branch): esquema, políticas y filas, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Escribe las filas de la rama en su padre, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` cuando cualquiera de los lados cambió desde el diff, o hay conflicto entre filas |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Edición de esquemas en vivo](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planifica un cambio; nunca lo aplica |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Solo una persona, a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Planifica relajar `NOT NULL` y eliminar las columnas no declaradas nombradas en `drop`, para [schema reconcile](/docs/cli/schema/#rebase-schema-reconcile); nunca aplica ninguno |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Aplica un plan de reconciliación, solo si su `digest` coincide con el `confirm` enviado |
| `POST` | `/api/admin/schema/reload` | `schema:write` | Reinspecciona PostgreSQL y recarga REST, Realtime, OpenAPI, políticas de almacenamiento, webhooks, roles y trabajos programados en el lugar sin reiniciar |
| `GET` | `/api/admin/db/tables` | `database:read` | Lista las tablas de PostgreSQL de usuarios con columnas, índices, políticas RLS y superposiciones de `rebase.table_meta` |
| `POST` | `/api/admin/db/tables` | `database:write` | Crea una tabla de PostgreSQL con políticas RLS y metadatos iniciales opcionales (`dryRun: true` previsualiza el SQL), luego recarga en vivo |
| `PATCH` | `/api/admin/db/tables/:table` | `database:write` | Cambia el nombre de una tabla, alterna Row Level Security (`rlsEnabled`) o actualiza la configuración de superposición de la API en `rebase.table_meta` (`meta`), luego recarga en vivo |
| `DELETE` | `/api/admin/db/tables/:table` | `database:write` | Elimina una tabla de PostgreSQL (requiere `{ confirm: "<table>" }` a menos que `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/columns` | `database:write` | Añade una columna a una tabla de PostgreSQL y recarga en vivo |
| `PATCH` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Modifica una columna (nombre, tipo, nulabilidad, valor por defecto) y recarga en vivo |
| `DELETE` | `/api/admin/db/tables/:table/columns/:column` | `database:write` | Elimina una columna (requiere `{ confirm: "<column>" }` a menos que `dryRun: true`) |
| `POST` | `/api/admin/db/tables/:table/indexes` | `database:write` | Crea un índice en una tabla de PostgreSQL |
| `DELETE` | `/api/admin/db/tables/:table/indexes/:index` | `database:write` | Elimina un índice en una tabla de PostgreSQL |
| `POST` | `/api/admin/db/tables/:table/policies` | `database:write` | Crea una política RLS de PostgreSQL en una tabla y recarga en vivo |
| `DELETE` | `/api/admin/db/tables/:table/policies/:policy` | `database:write` | Elimina una política RLS de PostgreSQL en una tabla y recarga en vivo |
| `GET` | `/api/admin/db/tables/:table/details` | `database:read` | Restricciones de una tabla, claves foráneas en ambos sentidos, triggers, permisos, políticas, uso de índices, estadísticas de almacenamiento y definición en SQL |
| `POST` | `/api/admin/db/tables/:table/constraints` | `database:write` | Añade una restricción de clave foránea, única o de comprobación (`dryRun: true` muestra el SQL antes) |
| `DELETE` | `/api/admin/db/tables/:table/constraints/:constraint` | `database:write` | Elimina una restricción |
| `PATCH` | `/api/admin/db/tables/:table/triggers/:trigger` | `database:write` | Activa o desactiva un trigger (`{ enabled }`) |
| `DELETE` | `/api/admin/db/tables/:table/triggers/:trigger` | `database:write` | Elimina un trigger |
| `POST` | `/api/admin/db/tables/:table/maintenance` | `database:write` | Ejecuta `ANALYZE` o `VACUUM (ANALYZE)` en la tabla (`{ action }`) |
| `POST` | `/api/admin/db/tables/:table/refresh` | `database:write` | Actualiza una vista materializada |
| `GET` | `/api/admin/db/tables/:table/rows` | `database:read` | Filas como propietario de la base de datos: `limit`, `offset`, `orderBy`, `direction` y `filters` (JSON); `format=csv` transmite todas las coincidencias |
| `POST` | `/api/admin/db/tables/:table/rows` | `database:write` | Inserta filas (`{ rows }`), todas o ninguna |
| `PATCH` | `/api/admin/db/tables/:table/rows` | `database:write` | Actualiza una fila por su clave primaria (`{ key, values }`) |
| `DELETE` | `/api/admin/db/tables/:table/rows` | `database:write` | Elimina filas por clave primaria (`{ keys }`) |
| `GET` | `/api/admin/db/insights/sources` | `database:read` | Las bases de datos que la vista Base de datos puede inspeccionar (`?source=` en las rutas de abajo) |
| `GET` | `/api/admin/db/insights/overview` | `database:read` | Versión del servidor, tamaño de la base de datos y conexiones en uso |
| `GET` | `/api/admin/db/insights/advisors` | `database:read` | Hallazgos de seguridad de `rls-check` y de rendimiento (índices sin uso o duplicados, claves foráneas sin índice, claves primarias ausentes, filas muertas) |
| `GET` | `/api/admin/db/insights/queries` | `database:read` | Las sentencias más costosas de `pg_stat_statements` (`sort`, `limit`), o por qué no se puede leer |
| `POST` | `/api/admin/db/insights/queries/reset` | `database:write` | Reinicia `pg_stat_statements` |
| `GET` | `/api/admin/db/insights/activity` | `database:read` | Sesiones activas con sus esperas, duraciones y bloqueos |
| `POST` | `/api/admin/db/insights/activity/:pid/cancel` | `database:write` | Cancela la sentencia en curso de una sesión (`pg_cancel_backend`) |
| `POST` | `/api/admin/db/insights/activity/:pid/terminate` | `database:write` | Termina una sesión (`pg_terminate_backend`) |
| `GET` | `/api/admin/db/catalog/functions` | `database:read` | Funciones fuera de los esquemas protegidos, con sus definiciones |
| `DELETE` | `/api/admin/db/catalog/functions/:schema/:name` | `database:write` | Elimina una función (su firma en el cuerpo) |
| `GET` | `/api/admin/db/catalog/triggers` | `database:read` | Todos los triggers, con su tabla y función |
| `GET` | `/api/admin/db/catalog/types` | `database:read` | Enums con sus valores, dominios y tipos compuestos |
| `POST` | `/api/admin/db/catalog/types/:schema/:name/values` | `database:write` | Añade un valor a un enum (`ALTER TYPE … ADD VALUE`) |
| `GET` | `/api/admin/db/catalog/extensions` | `database:read` | Extensiones que ofrece el servidor y cuáles están instaladas |
| `POST` | `/api/admin/db/catalog/extensions/:name` | `database:write` | Instala una extensión (`CREATE EXTENSION`) |
| `DELETE` | `/api/admin/db/catalog/extensions/:name` | `database:write` | Elimina una extensión (`DROP EXTENSION`) |
| `GET` | `/api/admin/storage/policies` | `database:read` | Lista las políticas de almacenamiento declarativas sin código de `rebase.storage_policies` |
| `POST` | `/api/admin/storage/policies` | `database:write` | Crea una política de acceso de almacenamiento declarativa |
| `PATCH` | `/api/admin/storage/policies/:id` | `database:write` | Actualiza una política de acceso de almacenamiento declarativa |
| `DELETE` | `/api/admin/storage/policies/:id` | `database:write` | Elimina una política de acceso de almacenamiento declarativa |
| `GET` | `/api/admin/webhooks` | `database:read` | Lista los webhooks de base de datos sin código de `rebase.webhooks` |
| `POST` | `/api/admin/webhooks` | `database:write` | Crea un webhook de base de datos |
| `PATCH` | `/api/admin/webhooks/:id` | `database:write` | Actualiza un webhook de base de datos |
| `DELETE` | `/api/admin/webhooks/:id` | `database:write` | Elimina un webhook de base de datos |
| `POST` | `/api/admin/webhooks/:id/test` | `database:write` | Envía una entrega de prueba en vivo a un endpoint de webhook configurado |
| `GET` | `/api/admin/roles` | `users:read` | Lista `admin`, los roles declarados en el código y los creados en tiempo de ejecución en `rebase.roles`, con sus scopes y su origen |
| `POST` | `/api/admin/roles` | `users:write` | Crea o actualiza un rol creado en tiempo de ejecución. Se rechaza para un rol declarado en el código, un scope del plano de datos o desconocido, o un scope que quien llama no tiene |
| `PUT` | `/api/admin/roles/:name` | `users:write` | Actualiza un rol creado en tiempo de ejecución, con las mismas reglas |
| `DELETE` | `/api/admin/roles/:name` | `users:write` | Elimina un rol creado en tiempo de ejecución del que quien llama tiene todos los scopes |
| `GET` | `/api/admin/cron/jobs` | `cron:read` | Lista los trabajos programados SQL/HTTP sin código de `rebase.cron_jobs` |
| `POST` | `/api/admin/cron/jobs` | `cron:write` | Crea un cron job programado de SQL o HTTP sin código. Un trabajo de SQL ejecuta su sentencia utilizando la propia conexión del servidor, por lo que también requiere `database:write` |
| `PATCH` | `/api/admin/cron/jobs/:id` | `cron:write` | Actualiza un cron job programado sin código; un trabajo de SQL, o uno que pase a serlo, también requiere `database:write` |
| `DELETE` | `/api/admin/cron/jobs/:id` | `cron:write` | Elimina un cron job programado sin código |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Indica si el editor está disponible y el motivo cuando no lo está |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Cada tabla que exporta `backend/schema/index.ts` según la lee el editor, con lo que se edita en código (solo lectura) y por qué — [Edición de esquemas en vivo](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }`: los archivos que la edición escribiría, compilados; no escribe nada |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | La misma edición, escrita en `backend/schema`; no se modifica la base de datos |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tablas que tiene la base de datos y que `backend/schema` no declara: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | Una de ellas descrita: `{ table: { …, descriptor, rlsRaised?, notes } }`, para "Import an existing table". `404` cuando es desconocida o ya fue declarada, `400 SCHEMA_EDIT_REFUSED` sin una clave primaria |
| `GET` | `/api/admin/ui-config` | session | Las preferencias de la interfaz de usuario del espacio de trabajo por tabla, las propias del emisor, y si el emisor puede escribir las del espacio de trabajo — consulte [Personalizar una tabla](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Combina un delta de `UiTablePreferences` en las preferencias del espacio de trabajo de una tabla (`replace` reemplaza). Escrito en `frontend/src/cms/ui-config.json` donde el servidor puede escribir el código fuente del proyecto, o de lo contrario en `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Elimina las preferencias del espacio de trabajo de una tabla |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (una persona) | Las preferencias propias del emisor para una tabla. Una API key no tiene ninguna: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (una persona) | Elimina las preferencias propias del emisor para una tabla |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Correos que el transporte de desarrollo capturó en lugar de enviar |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Vacía el buzón capturado |

`/api/admin/cron`, `/api/admin/logs` y `/api/admin/schema-editor` también se
sirven en sus rutas anteriores a la versión 0.17 sin el segmento `/admin`. Esos
alias son para proyectos que no han migrado; escriba el nuevo código utilizando la
ruta canónica.

## Schema

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, o una credencial con `schema:read` o un scope `data:*` | Cada tabla que este backend sirve, como un array JSON de descriptores filtrados (redacted) para el emisor |
| `GET` | `/api/schema/tables/:slug` | igual que arriba | Un descriptor. `404 TABLE_NOT_FOUND` cuando al emisor no se le sirve esa tabla |

Los descriptores son la base a partir de la cual el CMS renderiza sus valores
predeterminados, Studio dibuja el visualizador de esquemas y el editor de RLS,
y las aplicaciones MCP renderizan tablas y formularios. Incluyen columnas con sus
tipos de Postgres, nulabilidad, reglas de validación y almacenamiento, relaciones
por slug y la postura de seguridad a nivel de fila (RLS). El código de los hooks
nunca sale del servidor: un descriptor solo indica qué hooks tiene una tabla.

Lo que se sirve a un emisor depende de quién sea:

| Emisor | Tablas | Ocultado |
|---|---|---|
| Un administrador, un poseedor de `schema:read` o la service key | todas las tablas, vistas simples incluidas | columnas `.private()`, para todos |
| Cualquier otra persona autenticada, invitados incluidos | solo las tablas que alcanza una regla permisiva para sus roles (además de la tabla auth y las vistas materializadas cuyos `roles` posea) | columnas y relaciones para las que sus roles no superan `access.read`; columnas `.private()`; únicamente las reglas aplicables a sus roles; relaciones hacia tablas que no se le sirven; indicadores de hooks; SQL puro en reglas, políticas compiladas, consultas de vistas e índices |
| Una credencial (API key, token de MCP o de plataforma) | las tablas que sus scopes `data:*` nombran, o todas ellas con `schema:read` | como arriba, determinado por los scopes que porta |
| Nadie autenticado | ninguna — `401` — a menos que el backend configure `schemaTables: { public: true }` | en ese caso, las tablas con una regla `select` pública, omitiendo información como para el emisor con menores privilegios: ninguna columna con lista `access.read`, sin SQL puro, sin políticas |

Una persona conserva `metadata`, `softDelete`, `tenant`, `history` y `search` en
las tablas que se le sirven. `schemaTables: { persons: "all" }` en las opciones
del backend describe cada tabla y regla a cada emisor autenticado; el valor
predeterminado es `"granted"`. Las conexiones MCP se evalúan como una credencial,
mediante el mismo serializador.

La identidad del emisor proviene del adaptador de autenticación del backend, el
mismo al que consultan las rutas de datos, por lo que un backend con un
[adaptador personalizado](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
se atiende aquí (y en `/api/docs` y en cada superficie de administración) con los
roles que devuelve su adaptador; una credencial que no reconozca da como resultado
un `401`.

Una credencial que no posea ni `schema:read` ni un scope `data:*` recibe
`403 SCOPE_MISSING`. Un backend sin autenticación configurada responde a cada
solicitud con `404 SCHEMA_UNAVAILABLE`: no hay un emisor para el cual filtrar,
y `auth.requireAuth: false` no modifica esto.

Las respuestas incluyen `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` y el encabezado `x-rebase-schema`; una solicitud cuyo `If-None-Match`
indique la etiqueta actual recibe un `304`. La etiqueta cambia cuando el esquema lo
hace, incluso tras una edición del esquema en vivo.

`schemaTables` es una opción de `initializeRebaseBackend` sin variable de entorno:
un proyecto generado mediante scaffolding accede a ella expulsándose (ejecting).

## Storage

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, por clave | [Almacenamiento](/docs/backend/storage/#storage-endpoints): metadatos para hasta 100 objetos |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Las fuentes de almacenamiento con nombre que este backend sirve |
| `OPTIONS` | `/api/storage/tus` | none | Subidas reanudables: las versiones y extensiones de TUS que este servidor soporta |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Subidas reanudables: creación |
| `GET` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: offset |
| `PATCH` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: anexar (append) |
| `DELETE` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: cancelar |

Un despliegue sin almacenamiento configurado sirve este prefijo como un `501`
indicando la variable que necesita, en lugar de dar un 404 como si la función no
existiera — excepto `GET /api/storage/sources`, que responde `200` con una lista
vacía.

## Push

Montado solo con `push: true` (`REBASE_PUSH=true`). Con push activado pero sin
claves, cada ruta responde `503 PUSH_NOT_CONFIGURED`. Las API keys y la service key
son rechazadas: una suscripción pertenece al navegador de una persona.

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/push/key` | session | La clave pública VAPID — [Notificaciones push](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Este navegador recibe notificaciones, para el emisor — [Notificaciones push](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Detenerlas, en el propio navegador del emisor — [Notificaciones push](/docs/backend/push-notifications/#routes) |

## Functions

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/functions` | session | Los nombres de las funciones servidas y cuántos archivos no se pudieron cargar |
| cualquiera | `/api/functions/<name>` | lo que declare la función. Una API key también requiere `functions:invoke` | [Funciones personalizadas](/docs/backend/custom-functions/) |

Una ruta por archivo bajo `backend/functions/`, por lo que las rutas provienen de su
proyecto. `GET /api/functions` las lista únicamente para un emisor autenticado —
una sesión, una API key o la service key — y responde a cualquier otro con `401`:
el inventario de los endpoints personalizados de un despliegue no es público.

## RPC

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/rpc/<name>` | el `access` del RPC: none para `"public"` (con límite de tasa), session para `"authenticated"`; luego RLS dentro de la función. Una API key también requiere `data:read` (`data:write` para un RPC con `write: true`) | [Funciones SQL como RPC](/docs/backend/rpc/) |

Una ruta por cada `defineRpc` exportado desde `backend/schema/index.ts`, por lo
que las rutas provienen de su proyecto. Un nombre que nadie declaró responde `404
RPC_NOT_FOUND`, incluso cuando la base de datos tenga una función con ese nombre.

## Meta y operaciones

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/livez` | none | Solo vitalidad (liveness): comprueba si este proceso se está ejecutando. No toca la base de datos, razón por la cual es la ruta de sondeo que debe usar un contenedor — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Vitalidad y preparación (liveness y readiness). Informa sobre cada fuente de datos configurada, no solo la predeterminada |
| `GET` | `/api/docs` | la audiencia del endpoint de esquema por defecto (401 anónimo a menos que `schemaTables.public`, 403 para una credencial sin scope de esquema o datos); none cuando `enableSwagger` es `true`; el gate de admin cuando es `false` | El documento OpenAPI 3.0 de las tablas que `GET /api/schema/tables` describe al emisor (todas ellas con `enableSwagger: true`). `404 DOCS_UNAVAILABLE` cuando no hay autenticación configurada |
| `GET` | `/api/swagger` | none | Swagger UI. Solo cuando `enableSwagger` es `true`, y nunca en producción |
| `GET` | `/api/meta/schema-version` | none | El hash del esquema a partir del cual se construyó este backend y la versión del runtime, y nada más |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — cada tabla tal como la ve un administrador, la entrada de `rebase generate-sdk --from`. `404` cuando no hay autenticación configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` cuando esté configurado | Métricas de Prometheus, cuando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` cuando esté configurado | Las series registradas detrás de los gráficos de Studio. `501` en un runtime sin backend |
| `GET` | `/metrics/history/batch` | `REBASE_METRICS_TOKEN` cuando esté configurado | Hasta 16 series registradas a la vez, `?series=<a>,<b>&minutes=<n>&bucket=<1\|5\|30\|180>`, agrupadas en intervalos. Incluye solicitudes por minuto y errores por superficie. `501` en un runtime sin backend |

Las conexiones WebSocket llegan como una actualización HTTP (HTTP upgrade) en el
mismo servidor en lugar de en una ruta propia — consulte [Realtime](/docs/backend/realtime/).

## Superficie MCP

Montado únicamente cuando `REBASE_MCP_ENABLED=true`, lo cual también requiere
`REBASE_PUBLIC_URL` — consulte
[Configuración](/docs/getting-started/configuration/#mcp-surface). Desactivado de
forma predeterminada: ningún `REBASE_ROLE` lo activa, ya que otorga acceso al
proyecto a software de terceros y esa es una decisión que debe tomar una persona.

Los documentos `.well-known` se sitúan en el **origen**, no bajo `basePath`: RFC 8414
y RFC 9728 definen esas rutas relativas al origen, y un cliente las obtiene antes
de poseer ningún token.

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadatos de RFC 9728 que nombran este recurso y su servidor de autorización. También se sirve en el formato con sufijo de ruta |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadatos de RFC 8414: los endpoints, tipos de concesión (grant types) y métodos PKCE que este despliegue soporta |
| `POST` | `/mcp` | Bearer OAuth, o una API key | El endpoint del protocolo MCP. Actúa **como el usuario con sesión iniciada** (o como quienquiera que represente la clave), por lo que cada lectura y escritura está sujeta al mismo RLS. Los scopes `data:*` deciden qué herramientas se ofrecen |
| `GET` | `/mcp` | Bearer OAuth, o una API key | Responde `405` con `Allow: POST, DELETE`: este servidor no abre flujos iniciados por el servidor. El token se comprueba primero, por lo que uno faltante o caducado recibe en su lugar el challenge `401` |
| `DELETE` | `/mcp` | none | Responde `204`. El endpoint no mantiene ninguna sesión, por lo que no hay nada que finalizar |
| `POST` | `/api/oauth/register` | límite de tasa | Registro dinámico de clientes según RFC 7591. Rechazado cuando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La pantalla de consentimiento a la que se redirige a un cliente |
| `POST` | `/api/oauth/authorize/decision` | session | La respuesta de la persona — aprobar o denegar |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Intercambia un código de autorización, o renueva (refresh) |
| `POST` | `/api/oauth/revoke` | client credentials | Revocación de tokens según RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Qué clientes ha aprobado este usuario |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Retira uno, para que una persona pueda revocar un consentimiento sin necesidad de un administrador |

El propio endpoint MCP del panel de administración no forma parte de esta
superficie: utiliza la sesión del panel de administración, nunca un token OAuth,
y se monta junto con las rutas de administración independientemente de si
`REBASE_MCP_ENABLED` está configurado o no, sobre un controlador que aplica el
alcance de RLS a cada llamada.

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, nunca anónimo | **Experimental.** Las mismas herramientas que `/mcp`, para la persona autenticada, con `data:read`, `data:write` y `data:delete`, bajo su RLS. La `savedAppsView` del panel de administración abre [aplicaciones guardadas](/docs/ai/remote-mcp/) a través de él |

## Relacionado

- [API REST](/docs/backend/api/) — las rutas de datos al completo: filtros, ordenación, paginación, errores
- [Endpoints de autenticación](/docs/backend/auth-endpoints/) — estructuras de solicitud y respuesta para la tabla de autenticación anterior
- [Entorno y configuración](/docs/getting-started/configuration/) — las variables que deciden cuáles de estas rutas se montan
