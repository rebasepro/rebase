---
sourceHash: 94ae1d0452d97c4b
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Cada ruta HTTP que monta un backend de Rebase (datos, autenticación, almacenamiento, administración, metadatos), junto con el control de acceso (gate) de cada una y la página que la explica.
---

Cada ruta que monta el servidor, en una sola tabla, junto con los requisitos para acceder a ella.

Las rutas asumen el `basePath` predeterminado de `/api`; `REBASE_BASE_PATH` las traslada
todas juntas. `/health`, `/livez` y `/metrics` se sitúan fuera intencionalmente,
ya que un orquestador sondea `/health` y no debería necesitar conocer la ruta
base. `/health` *también* se monta debajo de ella, por lo que `/api/health` responde
de la misma manera en lugar de dar un error 404 justo cuando alguien comprueba si el servidor
está activo.

Un control (gate) — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compara esta
tabla con las rutas que registra el código fuente, de modo que no se puede agregar una nueva
superficie sin que aparezca aquí.

## Gates

| Gate | Significado |
|---|---|
| **none** | No autenticado. Cualquiera que pueda alcanzar el host puede llamarlo |
| **session** | Un emisor autenticado: un token de acceso o una API key con alcance para la operación |
| **`resource:action`** | Un emisor que posee ese [alcance (scope)](/docs/backend/roles-and-scopes/): un administrador, una persona cuyo rol lo declara, una API key creada con él o la clave de servicio (service key) |
| **RLS** | Autenticado, y luego la base de datos decide fila por fila; consulta [Reglas de seguridad](/docs/collections/security-rules/) |
| **dev** | Montado solo fuera de producción |

## Datos

Generado por tabla, por lo que las rutas llevan tus slugs en lugar de una lista
fija. `:slug` es el slug de una tabla (su nombre, a menos que `defineTable` establezca `slug`).

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | El listado, parámetros de consulta en el cuerpo — [Consultas demasiado largas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | El conteo, parámetros de consulta en el cuerpo — [Consultas demasiado largas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Recalcula una vista materializada, en las vistas que están materializadas — [Vistas](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias obsoleto (deprecated) de `PATCH`: misma escritura parcial, responde `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserta varias filas, opcionalmente con upsert — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Actualiza varias filas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina varias filas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Escritura entre tablas en una sola transacción — [Escritura a través de REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Historial de entidades](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Historial de entidades](/docs/backend/history/) |

El conteo y la agregación son rutas propias, registradas antes de `/:id` para
que `aggregate` no se interprete como el id de una entidad. `?select=` y `?groupBy=` son
sus parámetros, y `select` es obligatorio en `/aggregate`.

La búsqueda de texto, la búsqueda vectorial, la inclusión de relaciones y la selección de campos *son* parámetros
de consulta en `GET /api/data/:slug` en lugar de rutas: `searchString`,
`vector_search`, `include`, `fields`. Consulta [API REST](/docs/backend/api/).

Un proyecto que no declara tablas y no realiza introspección de ninguna sirve este prefijo
como un único `404 NO_TABLES`. Consulta [Solo backend](/docs/getting-started/headless/).

## Autenticación

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Lo que la pantalla de inicio de sesión puede ofrecer: registro, restablecimiento de contraseña, magic link, códigos por correo, inicio de sesión como invitado, proveedores OAuth y si la configuración del primer administrador está pendiente |
| `POST` | `/api/auth/register` | none | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (un refresh token) | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Endpoints de autenticación](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Revoca todas las demás sesiones |
| `DELETE` | `/api/auth/sessions/:id` | session | Revoca una |
| `POST` | `/api/auth/forgot-password` | none | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (un token de restablecimiento) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Envía por correo un enlace de confirmación a la nueva dirección — [Cambiar una dirección de correo electrónico](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un token de enlace) | Mueve la cuenta a la nueva dirección — [Cambiar una dirección de correo electrónico](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Autenticación](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token de verificación) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un token de verificación y una sesión o la contraseña para mantenerla) | [Verificación de correo electrónico](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un token de enlace) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/otp/verify` | none (un código) | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/device` | none | [Inicio de sesión en dispositivos](/docs/backend/device-sign-in/). Desactivado a menos que el backend lo active |
| `POST` | `/api/auth/device/token` | none (un código de dispositivo) | [Inicio de sesión en dispositivos](/docs/backend/device-sign-in/): sondeo del dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Inicio de sesión en dispositivos](/docs/backend/device-sign-in/): lo que muestra la página de aprobación |
| `POST` | `/api/auth/device/approve` | session (`aal2` con un segundo factor) | [Inicio de sesión en dispositivos](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Inicio de sesión en dispositivos](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sesiones de invitado. Desactivado a menos que se configure `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un invitado) | Convierte a un invitado en una cuenta |
| `POST` | `/api/auth/find-user` | session | Desactivado a menos que se configure `AUTH_ALLOW_USER_LOOKUP` — es una superficie de enumeración |
| `POST` | `/api/auth/:provider` | none | Uno por cada proveedor OAuth/OIDC configurado |
| `POST` | `/api/auth/link/:provider` | session | Vincula un proveedor a la cuenta con sesión iniciada |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un inicio de sesión en curso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un ID de desafío) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Todos los alcances que este backend conoce y los que posee el emisor — [Roles y alcances](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (una cuenta) | Las propias [claves personales](/docs/backend/api-keys/#personal-keys) del emisor |
| `POST` | `/api/auth/keys` | session (una cuenta) | La clave en texto plano se devuelve una sola vez. `403 PERSONAL_KEYS_DISABLED` a menos que la tabla de autenticación configure `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (una cuenta) | Revoca una de las propias claves del emisor |
| `GET` | `/.well-known/jwks.json` | none | El JWKS público, cuando está configurada la [firma asimétrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Administración

Todo lo que esté bajo `/api/admin` requiere un alcance (scope) del plano de administración, y cada
superficie especifica el suyo propio: `users:read` lista cuentas, `cron:write` activa un trabajo.
Un administrador los posee todos, al igual que la clave de servicio (service key). Una persona posee los que
declaran sus roles, y una API key aquellos con los que fue creada. Una clave con alcance limitado a
una tabla no accede a nada de esto. Consulta [Roles y alcances](/docs/backend/roles-and-scopes/).

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, y solo mientras no exista ningún administrador | Rechazado en producción — consulta [Inicialización del primer usuario](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestión de usuarios |
| `POST` | `/api/admin/users` | `users:write` | Gestión de usuarios. Se rechazan los roles superiores a los del propio emisor |
| `GET` | `/api/admin/users/pick` | `users:read`, o acceso de escritura a una tabla con una columna `.userId()` | La [lectura del selector de usuarios](/docs/backend/auth-endpoints/): id, nombre, correo y avatar únicamente. Una tabla cuyas reglas de escritura sean SQL puro no cuenta |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestión de usuarios |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Rechazado para una cuenta que posea más privilegios que el emisor |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Rechazado para una cuenta que posea más privilegios que el emisor |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emite una contraseña temporal |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Elimina los segundos factores y códigos de recuperación de la cuenta, finaliza sus sesiones |
| `GET` | `/api/admin/guests` | `users:read` | Invitados, ordenados por los vistos por última vez hace más tiempo primero. `?lastSeenBefore=` los filtra a lo que abarcaría la eliminación siguiente, y `total` los cuenta |
| `DELETE` | `/api/admin/guests` | `users:write` | Elimina un lote de invitados vistos por última vez antes de `?lastSeenBefore=`, el cual es obligatorio. Responde `{ deleted, skipped, remaining }`. Repetir mientras `remaining` no sea 0, con `?offset=` configurado con la cantidad de los que se han omitido. Las cuentas no pueden ser afectadas |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Elimina un invitado. Se rechaza una cuenta con `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` y los roles que declara el proyecto, con sus alcances |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API keys](/docs/backend/api-keys/). Nunca mediante una API key |
| `POST` | `/api/admin/api-keys` | `keys:write` | La clave en texto plano se devuelve una sola vez, al momento de su creación |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [API keys](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Tareas cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Tareas cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Habilitar o deshabilitar una tarea |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Tareas cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Ejecutar una tarea ahora. `?async=1` responde `202` una vez iniciada — [API de tareas cron](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventario de respaldos |
| `GET` | `/api/admin/backups/download` | `backups:read` | Transmite un respaldo. Con `?token=` de un enlace de descarga, no se necesita encabezado, únicamente para ese respaldo |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un enlace a un respaldo, `{ key }` → `{ url, token, expiresIn }`, válido durante 60 segundos — [Respaldos](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Inicia un escaneo de archivos almacenados no referenciados por ninguna fila, `?storageId=&olderThanHours=`, en segundo plano. Responde `202` con el registro del escaneo: `id`, `status` (`queued`) y `runner` (`worker` cuando es un trabajo `storage.orphans` en la cola de trabajos, `in-process` cuando el servidor lo ejecuta por sí mismo). Su registro se escribe en la fuente, bajo la ruta reservada `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | El registro del escaneo, `?storageId=`. Mientras se ejecuta: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` de `collectionsTotal`, `unscanned`). Una vez `completed`: `result`, el informe que respondía el antiguo `GET /orphans`. Una ejecución que dejó de reportar durante 10 minutos se responde como `failed`. `404 STORAGE_SCAN_NOT_FOUND` cuando la fuente no contiene dicho escaneo |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Elimina los huérfanos de un escaneo completado en segundo plano, `202`. Cada uno se comprueba de nuevo contra cada fila y entrada del historial, y se vuelve a solicitar justo antes de ser eliminado. El resultado es el campo `deletion` del registro de escaneo. `409` con `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` o `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Obsoleto: el escaneo dentro de la solicitud, `?storageId=&olderThanHours=`. Responde con `Deprecation: true`. Usa `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Obsoleto, sin `?scan=`: escanea nuevamente y elimina dentro de la solicitud. `409 STORAGE_SCAN_INCOMPLETE` cuando una tabla no se pudo leer |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia una carpeta a otra fuente bajo las mismas claves, una página por llamada — lo que envía `rebase storage move`; `400 STORAGE_SAME_LOCATION` para `deleteSource` entre dos fuentes que almacenan en la misma ubicación |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Lista la fuente nuevamente después de un traslado, con el mismo cuerpo, una página por llamada: `{ checked, notMoved: [{ key, reason }], cursor? }` — cada archivo que aún está en la fuente con `deleteSource`, cada archivo del cual el destino no tiene copia sin él. `rebase storage move` lo consulta cuando el traslado ha finalizado |
| `GET` | `/api/admin/logs` | `logs:read` | El búfer de registros recientes |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Las entradas más recientes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | El resultado más reciente de la auditoría programada |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Roles, roles de reglas de usuarios y claves de servicio activas que un administrador puede simular |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Cada tabla según accede `{ role?, userId?, apiKeyId? }`: filas visibles frente a las del emisor, ocultas por alcance o RLS, campos enmascarados. Solo para sesión de administrador |
| `POST` | `/api/admin/sql/csv` | `database:write` | Transmite el resultado completo de una consulta de solo lectura como CSV — "Download full result as CSV" de [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Lo que cambió una [rama](/docs/backend/branching/#reviewing-and-merging-a-branch): esquema, políticas y filas, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Escribe las filas de la rama en su principal, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` cuando cualquiera de los lados cambió desde el diff, o hay conflicto entre filas |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Edición de esquema en vivo](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planifica un cambio; nunca aplica ninguno |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Solo una persona, a menos que se configure `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Planifica relajar `NOT NULL` y eliminar las columnas no declaradas indicadas en `drop`, para [conciliación de esquema](/docs/cli/schema/#rebase-schema-reconcile); nunca aplica ninguno |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Aplica un plan de conciliación, solo si su `digest` coincide con el `confirm` enviado |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Si el editor está disponible y el motivo cuando no lo está |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | Cada tabla que exporta `backend/schema/index.ts` según la lee el editor, indicando qué se edita en código (solo lectura) y por qué — [Edición de esquema en vivo](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | `{ patches: TablePatch[] }`: los archivos que escribiría la edición, compilados; no escribe nada |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | La misma edición, escrita en `backend/schema`; la base de datos no se modifica |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | Tablas que tiene la base de datos y que `backend/schema` no declara: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | Una de ellas descrita: `{ table: { …, descriptor, rlsRaised?, notes } }`, para "Import an existing table". `404` si es desconocida o ya declarada, `400 SCHEMA_EDIT_REFUSED` sin una clave primaria |
| `GET` | `/api/admin/schema-editor/frontend/calls` | `schema:read` | Las llamadas a `defineFirestoreCollection` en `frontend/src/cms` que el editor puede reescribir (solo en desarrollo) |
| `POST` | `/api/admin/schema-editor/frontend/preview` | `schema:write` | Los archivos que escribiría una edición de una de esas llamadas; no escribe nada |
| `POST` | `/api/admin/schema-editor/frontend/apply` | `schema:write` | La misma edición, escrita in situ. `409 SCHEMA_EDIT_STALE_FILE` si el archivo cambió en el disco |
| `GET` | `/api/admin/ui-config` | session | Las preferencias de interfaz de usuario del espacio de trabajo por tabla, las propias del emisor y si el emisor puede escribir las del espacio de trabajo — consulta [Studio](/docs/studio/#collection-editor) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Fusiona un delta de `UiTablePreferences` en las preferencias del espacio de trabajo de una tabla (`replace` reemplaza). Escrito en `frontend/src/cms/ui-config.json` donde el servidor pueda escribir en el código fuente del proyecto, o bien en `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | Elimina las preferencias del espacio de trabajo de una tabla |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (una persona) | Las preferencias propias del emisor para una tabla. Una API key no tiene ninguna: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (una persona) | Elimina las preferencias propias del emisor para una tabla |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Correos que el transporte de desarrollo capturó en lugar de enviar |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Vacía el buzón capturado |

`/api/admin/cron`, `/api/admin/logs` y `/api/admin/schema-editor` también
se sirven en sus rutas anteriores a la versión 0.17 sin el segmento `/admin`. Esos alias son
para proyectos que aún no han migrado; escribe el nuevo código utilizando la ruta canónica.

## Esquema

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, o una credencial con `schema:read` o un alcance `data:*` | Cada tabla que sirve este backend, como un arreglo JSON de descriptores depurados según el emisor |
| `GET` | `/api/schema/tables/:slug` | igual que arriba | Un descriptor. `404 TABLE_NOT_FOUND` cuando a este emisor no se le sirve esa tabla |

Los descriptores son aquello a partir de lo cual el CMS renderiza sus valores predeterminados,
Studio dibuja el visualizador de esquemas y el editor de RLS, y las aplicaciones MCP
renderizan tablas y formularios. Contienen columnas con sus tipos de Postgres,
nulabilidad, reglas de validación y almacenamiento, relaciones por slug y la
postura de seguridad a nivel de fila (RLS). El código de los hooks nunca sale del servidor: un descriptor
solo indica qué hooks tiene una tabla.

Lo que se le sirve a un emisor depende de quién sea:

| Emisor | Tablas | Información excluida |
|---|---|---|
| Un administrador, quien posea `schema:read` o la clave de servicio (service key) | todas las tablas, incluidas las vistas simples | columnas `.private()`, para todos |
| Cualquier otra persona con sesión iniciada, incluidos los invitados | solo las tablas a las que alcanza una regla permisiva para sus roles (además de la tabla de autenticación y las vistas materializadas cuyos `roles` posean) | columnas y relaciones para las que sus roles no superan `access.read`; columnas `.private()`; solo las reglas que pueden aplicarse a sus roles; relaciones con tablas que no se les sirven; indicadores (flags) de hooks; SQL sin procesar en reglas, políticas compiladas, consultas de vistas e índices |
| Una credencial (API key, token de MCP o de plataforma) | las tablas que indican sus alcances `data:*`, o todas con `schema:read` | igual que arriba, evaluado según los alcances que porta |
| Nadie con sesión iniciada | ninguna — `401` — a menos que el backend defina `schemaTables: { public: true }` | en ese caso, las tablas con una regla `select` pública, depuradas como para el emisor con menos privilegios: ninguna columna con lista `access.read`, sin SQL puro, sin políticas |

Una persona conserva `metadata`, `softDelete`, `tenant`, `history` y `search` en
las tablas que se le sirven. `schemaTables: { persons: "all" }` en las opciones
del backend describe cada tabla y regla a cada emisor autenticado; el
valor predeterminado es `"granted"`. Las conexiones MCP se evalúan como una
credencial, mediante el mismo serializador.

La identidad del emisor proviene del adaptador de autenticación del backend, el mismo que
consultan las rutas de datos, por lo que un backend con un [adaptador personalizado](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
se atiende aquí (y en `/api/docs` y en cada superficie de administración) con los roles que
devuelve su adaptador; una credencial que no reconozca genera un `401`.

Una credencial que no contenga ni `schema:read` ni un alcance `data:*` recibe
`403 SCOPE_MISSING`. Un backend sin autenticación configurada responde
a cada solicitud con `404 SCHEMA_UNAVAILABLE`: no hay un emisor para el cual depurar información, y
`auth.requireAuth: false` no modifica esto.

Las respuestas incluyen `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` y el encabezado `x-rebase-schema`; una solicitud cuyo `If-None-Match`
coincide con la etiqueta actual recibe `304`. La etiqueta cambia cuando cambia el esquema,
incluso tras una edición del esquema en vivo.

`schemaTables` es una opción de `initializeRebaseBackend` sin variable de
entorno: un proyecto generado mediante scaffolding accede a ella haciendo eject.

## Almacenamiento

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, por clave | [Almacenamiento](/docs/backend/storage/#storage-endpoints): metadatos para un máximo de 100 objetos |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Las fuentes de almacenamiento con nombre que sirve este backend |
| `OPTIONS` | `/api/storage/tus` | none | Subidas reanudables: las versiones y extensiones de TUS que admite este servidor |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Subidas reanudables: creación |
| `GET` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: offset |
| `PATCH` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: anexión (append) |
| `DELETE` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: cancelación |

Un despliegue sin almacenamiento configurado sirve este prefijo como un `501` indicando la
variable que necesita, en lugar de dar un 404 como si la función no existiera,
excepto `GET /api/storage/sources`, que responde `200` con una lista vacía.

## Notificaciones push

Montado únicamente con `push: true` (`REBASE_PUSH=true`). Con push activado pero sin claves,
cada ruta responde `503 PUSH_NOT_CONFIGURED`. Se rechazan las API keys y la clave de servicio:
una suscripción pertenece al navegador de una persona.

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/push/key` | session | La clave pública VAPID — [Notificaciones push](/docs/backend/push-notifications/) |
| `POST` | `/api/push/subscriptions` | session | Este navegador recibe notificaciones, para el emisor — [Notificaciones push](/docs/backend/push-notifications/#routes) |
| `DELETE` | `/api/push/subscriptions` | session | Detenerlas, en el propio navegador del emisor — [Notificaciones push](/docs/backend/push-notifications/#routes) |

## Funciones

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/functions` | session | Los nombres de las funciones servidas y cuántos archivos no se pudieron cargar |
| any | `/api/functions/<name>` | lo que declare la función. Una API key también necesita `functions:invoke` | [Funciones personalizadas](/docs/backend/custom-functions/) |

Una ruta por cada archivo bajo `backend/functions/`, por lo que las rutas proceden de tu
proyecto. `GET /api/functions` las lista únicamente para un emisor autenticado —una
sesión, una API key o la clave de servicio— y responde `401` a cualquier otra persona: el
inventario de endpoints personalizados de un despliegue no es público.

## Metadatos y operaciones

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/livez` | none | Solo liveness: indica si este proceso está en ejecución. No interactúa con la base de datos, por lo que es la ruta de sondeo que debería usar un contenedor — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness y readiness. Informa sobre cada fuente de datos configurada, no solo la predeterminada |
| `GET` | `/api/docs` | la audiencia del endpoint de esquema por defecto (401 anónimo a menos que `schemaTables.public`, 403 para una credencial sin alcance de esquema o datos); none cuando `enableSwagger` es `true`; el gate de administración cuando es `false` | El documento OpenAPI 3.0 de las tablas que `GET /api/schema/tables` describe al emisor (todas ellas con `enableSwagger: true`). `404 DOCS_UNAVAILABLE` cuando no hay autenticación configurada |
| `GET` | `/api/swagger` | none | Swagger UI. Solo cuando `enableSwagger` es `true`, y nunca en producción |
| `GET` | `/api/meta/schema-version` | none | El hash del esquema a partir del cual se compiló este backend y la versión del runtime, y nada más |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — cada tabla tal como la ve un administrador, la entrada de `rebase generate-sdk --from`. `404` cuando no hay autenticación configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` cuando esté configurado | Métricas de Prometheus, cuando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` cuando esté configurado | Las series registradas detrás de los gráficos de Studio. `501` en un runtime sin backend |
| `GET` | `/metrics/history/batch` | `REBASE_METRICS_TOKEN` cuando esté configurado | Hasta 16 series registradas a la vez, `?series=<a>,<b>&minutes=<n>&bucket=<1\|5\|30\|180>`, agrupadas por intervalo. Incluye peticiones y errores por minuto y superficie. `501` en un runtime sin backend |

Las conexiones WebSocket llegan como una actualización HTTP (HTTP upgrade) en el mismo servidor en lugar de en
una ruta propia; consulta [Tiempo real](/docs/backend/realtime/).

## Superficie MCP

Montado únicamente cuando `REBASE_MCP_ENABLED=true`, lo cual también requiere
`REBASE_PUBLIC_URL` — consulta
[Configuración](/docs/getting-started/configuration/#mcp-surface). Desactivado de
forma predeterminada: ningún `REBASE_ROLE` activa esto, ya que otorga acceso al proyecto a
software de terceros y esa es una decisión que debe tomar una persona.

Los documentos `.well-known` se ubican en el **origen**, no bajo `basePath`: RFC 8414
y RFC 9728 definen esas rutas relativas al origen, y un cliente las obtiene
antes de poseer cualquier token.

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadatos RFC 9728 que nombran este recurso y su servidor de autorización. También se sirve en la forma con sufijo de ruta |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadatos RFC 8414: los endpoints, tipos de concesión (grant types) y métodos PKCE que admite este despliegue |
| `POST` | `/mcp` | Bearer de OAuth, o una API key | El endpoint del protocolo MCP. Actúa **como el usuario autenticado** (o como quien represente la clave), por lo que cada lectura y escritura está sujeta al mismo RLS. Los alcances `data:*` deciden qué herramientas se ofrecen |
| `GET` | `/mcp` | Bearer de OAuth, o una API key | Responde `405` con `Allow: POST, DELETE`: este servidor no abre transmisiones iniciadas por el servidor. El token se comprueba primero, por lo que uno ausente o caducado recibe en su lugar el desafío `401` |
| `DELETE` | `/mcp` | none | Responde `204`. El endpoint no mantiene sesión, por lo que no hay nada que finalizar |
| `POST` | `/api/oauth/register` | con límite de tasa (rate-limited) | Registro dinámico de clientes RFC 7591. Rechazado cuando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La pantalla de consentimiento a la que se redirige a un cliente |
| `POST` | `/api/oauth/authorize/decision` | session | La respuesta de la persona a esta — aprobar o denegar |
| `POST` | `/api/oauth/token` | credenciales de cliente + PKCE | Intercambia un código de autorización o actualiza el token (refresh) |
| `POST` | `/api/oauth/revoke` | credenciales de cliente | Revocación de tokens RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Qué clientes ha aprobado este usuario |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Retira uno, para que una persona pueda revocar un consentimiento sin necesidad de un administrador |

El endpoint MCP propio del panel de administración no forma parte de esta superficie: utiliza la
sesión del panel de administración, nunca un token OAuth, y se monta junto con las
rutas de administración independientemente de si `REBASE_MCP_ENABLED` está configurado, sobre un
controlador que aplica el alcance de cada llamada a RLS.

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, nunca anónimo | **Experimental.** Las mismas herramientas que `/mcp`, para la persona con sesión iniciada, con `data:read`, `data:write` y `data:delete`, bajo su RLS. El `savedAppsView` del panel de administración abre [aplicaciones guardadas](/docs/ai/remote-mcp/) a través de él |

## Relacionado

- [API REST](/docs/backend/api/) — las rutas de datos al completo: filtros, ordenamiento, paginación, errores
- [Endpoints de autenticación](/docs/backend/auth-endpoints/) — estructuras de solicitud y respuesta para la tabla de autenticación anterior
- [Entorno y configuración](/docs/getting-started/configuration/) — las variables que determinan cuáles de estas se montan
