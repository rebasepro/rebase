---
sourceHash: 9b25ea3a0b2cb11a
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Cada ruta HTTP que monta un backend de Rebase — datos, autenticación, almacenamiento, administración, meta — con el control de acceso en cada una y la página que la explica.
---

Cada ruta que monta el servidor, en una tabla, con los requisitos necesarios para acceder a ella.

Las rutas asumen el `basePath` predeterminado de `/api`; `REBASE_BASE_PATH` las traslada
todas juntas. `/health`, `/livez` y `/metrics` se encuentran fuera de él a propósito,
ya que un orquestador sondea `/health` y no debería necesitar conocer la ruta
base. `/health` *también* está montado debajo de él, por lo que `/api/health` responde
de la misma manera en lugar de dar un error 404 en el momento exacto en que alguien está
verificando si el servidor está activo.

Un control (gate) — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compara esta
tabla con las rutas que registra el código fuente, de modo que no se puede añadir una
nueva superficie sin que aparezca aquí.

## Gates

| Gate | Significado |
|---|---|
| **none** | Sin autenticación. Cualquiera que pueda alcanzar el host puede llamarlo |
| **session** | Un llamador autenticado: un token de acceso o una clave de API con alcance para la operación |
| **`resource:action`** | Un llamador que posee ese [scope](/docs/backend/roles-and-scopes/): un administrador, una persona cuyo rol lo declara, una clave de API creada con él o la clave de servicio |
| **RLS** | Autenticado, y luego la base de datos decide fila por fila — consulte [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montado solo fuera de producción |

## Data

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Generado por tabla, por lo que las rutas llevan sus slugs en lugar de una lista
fija. `:slug` es el slug de una tabla (su nombre, a menos que `defineTable` establezca `slug`).

| Método | Ruta | Gate | Más |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | El listado, con parámetros de consulta en el cuerpo — [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | El recuento, con parámetros de consulta en el cuerpo — [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Recalcula una vista materializada, en las vistas que están materializadas — [Views](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias obsoleto de `PATCH` — misma escritura parcial, responde `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserta múltiples filas, opcionalmente con upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Actualiza múltiples filas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina múltiples filas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Escribe en varias tablas en una sola transacción — [Writing over REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

El conteo y la agregación son rutas propias, registradas antes de `/:id` para
que `aggregate` no se interprete como el id de una entidad. `?select=` y `?groupBy=` son
sus parámetros, y `select` es obligatorio en `/aggregate`.

La búsqueda de texto, la búsqueda vectorial, la inclusión de relaciones y la selección de campos *son*
parámetros de consulta en `GET /api/data/:slug` en lugar de rutas: `searchString`,
`vector_search`, `include`, `fields`. Consulte [REST API](/docs/backend/api/).

Un proyecto que no declara tablas y no introspecciona ninguna sirve este prefijo
como un único `404 NO_TABLES`. Consulte [Backend only](/docs/getting-started/headless/).

## Auth

| Método | Ruta | Gate | Más |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | Lo que la pantalla de inicio de sesión puede ofrecer: registro, restablecimiento de contraseña, magic link, códigos por correo, inicio de sesión como invitado, proveedores OAuth y si la configuración del primer administrador está pendiente |
| `POST` | `/api/auth/register` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (un token de actualización) | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Revoca todas las demás sesiones |
| `DELETE` | `/api/auth/sessions/:id` | session | Revoca una sesión |
| `POST` | `/api/auth/forgot-password` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (un token de restablecimiento) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Envía un enlace de confirmación por correo a la nueva dirección — [Changing an email address](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un token de enlace) | Traslada la cuenta a la nueva dirección — [Changing an email address](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentication](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token de verificación) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un token de verificación y una sesión o la contraseña para conservarla) | [Email verification](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un token de enlace) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/otp/verify` | none (un código) | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/device` | none | <span class="since-badge" data-since="0.31">Desde 0.31</span> [Device sign-in](/docs/backend/device-sign-in/). Desactivado a menos que el backend lo active |
| `POST` | `/api/auth/device/token` | none (un código de dispositivo) | [Device sign-in](/docs/backend/device-sign-in/): el sondeo del dispositivo |
| `GET` | `/api/auth/device/:userCode` | session | [Device sign-in](/docs/backend/device-sign-in/): lo que muestra la página de aprobación |
| `POST` | `/api/auth/device/approve` | session (`aal2` con un segundo factor) | [Device sign-in](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Device sign-in](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Sesiones de invitado. Desactivado a menos que esté configurado `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un invitado) | Convierte a un invitado en una cuenta |
| `POST` | `/api/auth/find-user` | session | Desactivado a menos que esté configurado `AUTH_ALLOW_USER_LOOKUP` — es una superficie de enumeración |
| `POST` | `/api/auth/:provider` | none | Uno por cada proveedor OAuth/OIDC configurado |
| `POST` | `/api/auth/link/:provider` | session | Vincula un proveedor a la cuenta con sesión iniciada |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un inicio de sesión en curso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un id de desafío) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Todos los scopes que este backend conoce y los que posee el llamador — [Roles and scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (una cuenta) | Las [claves personales](/docs/backend/api-keys/#personal-keys) del propio llamador |
| `POST` | `/api/auth/keys` | session (una cuenta) | La clave en texto sin formato se devuelve solo una vez. `403 PERSONAL_KEYS_DISABLED` a menos que la tabla de autenticación establezca `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (una cuenta) | Revoca una de las claves propias del llamador |
| `GET` | `/.well-known/jwks.json` | none | El JWKS público, cuando está configurada la [firma asimétrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Admin

Todo lo que está bajo `/api/admin` requiere un scope del plano de administración, y cada
superficie especifica el suyo: `users:read` lista cuentas, `cron:write` activa un trabajo.
Un administrador los posee todos, al igual que la clave de servicio. Una persona posee los que
declaran sus roles, y una clave de API los que se le asignaron al crearla. Una clave con alcance
limitado a una tabla no tiene acceso a nada de esto. Consulte [Roles and scopes](/docs/backend/roles-and-scopes/).

| Método | Ruta | Gate | Más |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, y solo mientras no exista ningún administrador | Rechazado en producción — consulte [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestión de usuarios |
| `POST` | `/api/admin/users` | `users:write` | Gestión de usuarios. Se rechazan los roles que excedan los propios del llamador |
| `GET` | `/api/admin/users/pick` | `users:read`, o acceso de escritura a una tabla con una columna `.userId()` | La [lectura del selector de usuarios](/docs/backend/auth-endpoints/): solo id, nombre, correo electrónico y avatar. Una tabla cuyas reglas de escritura sean SQL puro no cuenta |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestión de usuarios |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Rechazado para una cuenta que posee más privilegios que el llamador |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Rechazado para una cuenta que posee más privilegios que el llamador |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emite una contraseña temporal |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Elimina los segundos factores y los códigos de recuperación de la cuenta, finaliza sus sesiones |
| `GET` | `/api/admin/guests` | `users:read` | Invitados, ordenados por los vistos hace más tiempo primero. `?lastSeenBefore=` los restringe a lo que eliminaría la operación siguiente, y `total` los cuenta |
| `DELETE` | `/api/admin/guests` | `users:write` | Elimina un lote de los invitados vistos por última vez antes de `?lastSeenBefore=`, el cual es obligatorio. Responde `{ deleted, skipped, remaining }`. Repita mientras `remaining` no sea 0, con `?offset=` establecido en la cantidad que se ha omitido. No se puede acceder a las cuentas |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Elimina un invitado. Una cuenta se rechaza con `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` y los roles que declara el proyecto, con sus scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API keys](/docs/backend/api-keys/). Nunca mediante una clave de API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La clave en texto sin formato se devuelve solo una vez, en el momento de la creación |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [API keys](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Habilita o deshabilita un trabajo |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Ejecuta un trabajo ahora. `?async=1` responde `202` una vez que ha comenzado — [Cron Jobs API](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventario de copias de seguridad |
| `GET` | `/api/admin/backups/download` | `backups:read` | Transmite una copia de seguridad en streaming. Con el `?token=` de un enlace de descarga, no se necesita encabezado, únicamente para esa copia de seguridad |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un enlace a una copia de seguridad, `{ key }` → `{ url, token, expiresIn }`, válido durante 60 segundos — [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Inicia un escaneo en segundo plano de los archivos almacenados que ninguna fila nombra, `?storageId=&olderThanHours=`. Responde `202` con el registro del escaneo: `id`, `status` (`queued`) y `runner` (`worker` cuando es un trabajo de `storage.orphans` en la cola de trabajos, `in-process` cuando el propio servidor lo ejecuta). Su registro se escribe en la fuente, bajo la ruta reservada `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | El registro del escaneo, `?storageId=`. Mientras se ejecuta: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` de `collectionsTotal`, `unscanned`). Una vez `completed`: `result`, el informe que respondía el antiguo `GET /orphans`. Una ejecución que dejó de informar durante 10 minutos se responde como `failed`. `404 STORAGE_SCAN_NOT_FOUND` cuando la fuente no contiene dicho escaneo |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Elimina los huérfanos de un escaneo completado en segundo plano, `202`. Cada uno se verifica nuevamente contra cada fila y entrada del historial, y se vuelve a solicitar justo antes de eliminarse. El resultado es el campo `deletion` del registro del escaneo. `409` con `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` o `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Obsoleto: el escaneo dentro de la solicitud, `?storageId=&olderThanHours=`. Responde con `Deprecation: true`. Utilice `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Obsoleto, sin `?scan=`: vuelve a escanear y elimina dentro de la solicitud. `409 STORAGE_SCAN_INCOMPLETE` cuando una tabla no se pudo leer |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia una carpeta a otra fuente bajo las mismas claves, una página por llamada — lo que envía `rebase storage move`; `400 STORAGE_SAME_LOCATION` para `deleteSource` entre dos fuentes que almacenan en la misma ubicación |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Vuelve a listar la fuente después de un traslado, con el mismo cuerpo, una página por llamada: `{ checked, notMoved: [{ key, reason }], cursor? }` — cada archivo que todavía está en la fuente con `deleteSource`, cada archivo del cual el destino no tiene copia sin él. `rebase storage move` lo consulta cuando el traslado termina |
| `GET` | `/api/admin/logs` | `logs:read` | El búfer de registros recientes |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Las entradas más recientes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | El resultado más reciente de la auditoría programada |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Roles, roles de reglas de usuarios y claves de servicio activas que un administrador puede simular |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Cada tabla tal como la accede `{ role?, userId?, apiKeyId? }`: filas visibles frente a las del llamador, ocultas por scope o RLS, campos enmascarados. Solo sesión de administrador |
| `POST` | `/api/admin/sql/csv` | `database:write` | Transmite el resultado completo de una consulta de solo lectura como CSV en streaming — "Download full result as CSV" de [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Lo que cambió una [rama](/docs/backend/branching/#reviewing-and-merging-a-branch): esquema, políticas y filas, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Escribe las filas de la rama en su elemento primario, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` cuando cualquiera de los lados cambió desde el diff, o si hay conflicto entre filas |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Live schema editing](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planifica un cambio; nunca aplica ninguno |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Solo una persona, a menos que esté definido `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Planifica flexibilizar `NOT NULL` y eliminar las columnas no declaradas nombradas en `drop`, para [schema reconcile](/docs/cli/schema/#rebase-schema-reconcile); nunca aplica ninguno |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Aplica un plan de conciliación, solo si su `digest` coincide con el `confirm` enviado |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Si el editor está disponible y el motivo cuando no lo está |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | <span class="since-badge" data-since="0.31">Desde 0.31</span> Cada tabla que `backend/schema/index.ts` exporta tal como la lee el editor, con lo que se edita en código (solo lectura) y el motivo — [Live schema editing](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Desde 0.31</span> `{ patches: TablePatch[] }`: los archivos que la edición escribiría, compilados; no escribe nada |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Desde 0.31</span> La misma edición, escrita en `backend/schema`; no se modifica la base de datos |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | <span class="since-badge" data-since="0.31">Desde 0.31</span> Tablas que tiene la base de datos y `backend/schema` no declara: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | <span class="since-badge" data-since="0.31">Desde 0.31</span> Una de ellas descrita: `{ table: { …, descriptor, rlsRaised?, notes } }`, para "Import an existing table". `404` cuando es desconocida o ya está declarada, `400 SCHEMA_EDIT_REFUSED` sin una clave primaria |
| `GET` | `/api/admin/schema-editor/frontend/calls` | `schema:read` | <span class="since-badge" data-since="0.31">Desde 0.31</span> Las llamadas a `defineFirestoreCollection` en `frontend/src/cms` que el editor puede reescribir (solo desarrollo) |
| `POST` | `/api/admin/schema-editor/frontend/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Desde 0.31</span> Los archivos que escribiría una edición de una de esas llamadas; no escribe nada |
| `POST` | `/api/admin/schema-editor/frontend/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Desde 0.31</span> La misma edición, escrita en el lugar. `409 SCHEMA_EDIT_STALE_FILE` cuando el archivo cambió en el disco |
| `GET` | `/api/admin/ui-config` | session | <span class="since-badge" data-since="0.31">Desde 0.31</span> Las preferencias de interfaz de usuario del espacio de trabajo por tabla, las propias del llamador y si el llamador puede escribir las del espacio de trabajo — consulte [Studio](/docs/studio/#collection-editor) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Desde 0.31</span> Combina un delta de `UiTablePreferences` en las preferencias del espacio de trabajo de una tabla (`replace` reemplaza). Escrito en `frontend/src/cms/ui-config.json` donde el servidor pueda escribir en el código fuente del proyecto; de lo contrario, en `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Desde 0.31</span> Elimina las preferencias del espacio de trabajo de una tabla |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (una persona) | <span class="since-badge" data-since="0.31">Desde 0.31</span> Las preferencias propias del llamador para una tabla. Una clave de API no tiene ninguna: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (una persona) | <span class="since-badge" data-since="0.31">Desde 0.31</span> Elimina las preferencias propias del llamador para una tabla |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Correos que el transporte de desarrollo capturó en lugar de enviar |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Vacía el buzón capturado |

`/api/admin/cron`, `/api/admin/logs` y `/api/admin/schema-editor` también se
sirven en sus rutas anteriores a la versión 0.17 sin el segmento `/admin`. Esos alias son
para proyectos que no han migrado; escriba el código nuevo utilizando la ruta canónica.

## Schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Método | Ruta | Gate | Más |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, o una credencial con `schema:read` o un scope `data:*` | Cada tabla que sirve este backend, como un arreglo JSON de descriptores filtrados para el llamador |
| `GET` | `/api/schema/tables/:slug` | igual que el anterior | Un descriptor. `404 TABLE_NOT_FOUND` cuando a este llamador no se le sirve esa tabla |

Los descriptores son aquello a partir de lo cual el CMS renderiza sus valores predeterminados,
Studio dibuja el visualizador de esquemas y el editor de RLS, y las aplicaciones MCP
renderizan tablas y formularios. Contienen columnas con sus tipos de Postgres,
nulabilidad, reglas de validación y almacenamiento, relaciones por slug y la
postura de seguridad a nivel de fila. El código de los hooks nunca sale del servidor: un descriptor
solo indica qué hooks tiene una tabla.

Lo que se sirve a un llamador depende de quién sea:

| Llamador | Tablas | Ocultado / Filtrado |
|---|---|---|
| Un administrador, un poseedor de `schema:read` o la clave de servicio | todas las tablas, incluidas las vistas simples | columnas `.private()`, para todos |
| Cualquier otra persona que haya iniciado sesión, incluidos los invitados | solo las tablas a las que llega una regla permisiva para sus roles (más la tabla de autenticación y las vistas materializadas cuyos `roles` poseen) | columnas y relaciones para las cuales sus roles no superan `access.read`; columnas `.private()`; únicamente las reglas que pueden aplicarse a sus roles; relaciones hacia tablas que no se les sirven; flags de hooks; SQL puro en reglas, políticas compiladas, consultas de vistas e índices |
| Una credencial (clave de API, token MCP o de plataforma) | las tablas que nombran sus scopes `data:*`, o todas ellas con `schema:read` | igual que el anterior, evaluado según los scopes que porta |
| Nadie conectado | ninguna — `401` — a menos que el backend establezca `schemaTables: { public: true }` | en ese caso, las tablas con una regla `select` pública, filtradas como para el llamador con menores privilegios: ninguna columna con lista de `access.read`, sin SQL puro, sin políticas |

Una persona conserva `metadata`, `softDelete`, `tenant`, `history` y `search` en
las tablas que se le sirven. `schemaTables: { persons: "all" }` en las opciones
del backend describe cada tabla y regla a cada llamador autenticado; el
valor predeterminado es `"granted"`. Las conexiones MCP se evalúan como una
credencial, mediante el mismo serializador.

La identidad del llamador proviene del adaptador de autenticación del backend, el mismo al que
consultan las rutas de datos, por lo que un backend con un [adaptador personalizado](/docs/backend/auth-adapters/#the-adapter-decides-the-caller-everywhere)
se atiende aquí (y en `/api/docs` y en cada superficie de administración) con los roles que
devuelve su adaptador; una credencial que no reconozca da como resultado un `401`.

Una credencial que no posea ni `schema:read` ni un scope `data:*` recibe
`403 SCOPE_MISSING`. Un backend sin autenticación configurada responde a
cada solicitud con `404 SCHEMA_UNAVAILABLE`: no hay llamador para el cual filtrar, y
`auth.requireAuth: false` no modifica esto.

Las respuestas llevan `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` y el encabezado `x-rebase-schema`; una solicitud cuyo `If-None-Match`
especifique la etiqueta actual recibe `304`. La etiqueta cambia cuando cambia el esquema,
incluso después de una edición en vivo del esquema.

`schemaTables` es una opción de `initializeRebaseBackend` sin variable de entorno:
un proyecto generado con scaffolding accede a ella mediante ejecting.

## Storage

| Método | Ruta | Gate | Más |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, por clave | [Storage](/docs/backend/storage/#storage-endpoints): metadatos de hasta 100 objetos |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Las fuentes de almacenamiento con nombre que sirve este backend |
| `OPTIONS` | `/api/storage/tus` | none | Cargas reanudables: las versiones y extensiones de TUS que admite este servidor |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Cargas reanudables: creación |
| `GET` | `/api/storage/tus/:id` | el propietario de la carga | Cargas reanudables: desplazamiento (offset) |
| `PATCH` | `/api/storage/tus/:id` | el propietario de la carga | Cargas reanudables: anexar (append) |
| `DELETE` | `/api/storage/tus/:id` | el propietario de la carga | Cargas reanudables: cancelar |

Una implementación sin almacenamiento configurado sirve este prefijo como un error `501` indicando
la variable que necesita, en lugar de responder 404 como si la función no existiera —
excepto `GET /api/storage/sources`, que responde `200` con una lista vacía.

## Functions

| Método | Ruta | Gate | Más |
|---|---|---|---|
| `GET` | `/api/functions` | session | Los nombres de las funciones servidas y cuántos archivos no se pudieron cargar |
| cualquier | `/api/functions/<name>` | lo que declare la función. Una clave de API también necesita `functions:invoke` | [Custom Functions](/docs/backend/custom-functions/) |

Una ruta por archivo bajo `backend/functions/`, de modo que las rutas provienen de su
proyecto. `GET /api/functions` las lista únicamente para un llamador autenticado — una
sesión, una clave de API o la clave de servicio — y responde a cualquier otra persona con `401`: un
inventario de los endpoints personalizados de una implementación no es público.

## Meta y operaciones

| Método | Ruta | Gate | Más |
|---|---|---|---|
| `GET` | `/livez` | none | Comprobación de actividad (liveness) únicamente: indica si este proceso se está ejecutando. No consulta la base de datos, razón por la cual es la ruta de sondeo que debería usar un contenedor — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Actividad y disponibilidad (liveness y readiness). Informa sobre cada fuente de datos configurada, no solo la predeterminada |
| `GET` | `/api/docs` | <span class="since-badge" data-since="0.31">Desde 0.31</span> la audiencia del endpoint de esquema de forma predeterminada (401 anónimo a menos que sea `schemaTables.public`, 403 para una credencial sin un scope de esquema o datos); none cuando `enableSwagger` es `true`; el gate de administración cuando es `false` | El documento OpenAPI 3.0 de las tablas que `GET /api/schema/tables` describe al llamador (todas ellas con `enableSwagger: true`). `404 DOCS_UNAVAILABLE` cuando no hay autenticación configurada |
| `GET` | `/api/swagger` | none | Swagger UI. Solo cuando `enableSwagger` es `true`, y nunca en producción |
| `GET` | `/api/meta/schema-version` | none | El hash del esquema a partir del cual se construyó este backend y la versión del runtime, y nada más |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — cada tabla tal como la ve un administrador, la entrada de `rebase generate-sdk --from`. `404` cuando no hay autenticación configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` cuando esté configurado | Métricas de Prometheus, cuando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` cuando esté configurado | Las series registradas detrás de los gráficos de Studio. `501` en un runtime sin backend |

Las conexiones WebSocket llegan como una actualización HTTP (upgrade) en el mismo servidor en lugar de en
una ruta propia — consulte [Realtime](/docs/backend/realtime/).

## Superficie MCP

Montada únicamente cuando `REBASE_MCP_ENABLED=true`, lo que también requiere
`REBASE_PUBLIC_URL` — consulte
[Configuration](/docs/getting-started/configuration/#mcp-surface). Desactivada de forma
predeterminada: ningún `REBASE_ROLE` activa esto, ya que otorga acceso al proyecto a
software de terceros y esa es una decisión que debe tomar una persona.

Los documentos `.well-known` se ubican en el **origen**, no bajo `basePath`: RFC 8414
y RFC 9728 definen esas rutas en relación con el origen, y un cliente las obtiene
antes de poseer ningún token.

| Método | Ruta | Gate | Más |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadatos de RFC 9728 que nombran este recurso y su servidor de autorización. También se sirve en la forma con sufijo de ruta |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadatos de RFC 8414: los endpoints, tipos de concesión y métodos PKCE que admite esta implementación |
| `POST` | `/mcp` | Portador OAuth (bearer), o una clave de API | El endpoint del protocolo MCP. Actúa **como el usuario que ha iniciado sesión** (o como quienquiera que actúe la clave), por lo que cada lectura y escritura está sujeta al mismo RLS. Los scopes `data:*` deciden qué herramientas se ofrecen |
| `GET` | `/mcp` | Portador OAuth (bearer), o una clave de API | Responde `405` con `Allow: POST, DELETE`: este servidor no abre ningún flujo iniciado por el servidor. El token se comprueba primero, por lo que uno faltante o caducado recibe en su lugar el desafío `401` |
| `DELETE` | `/mcp` | none | Responde `204`. El endpoint no mantiene ninguna sesión, por lo que no hay nada que finalizar |
| `POST` | `/api/oauth/register` | limitado por tasa | Registro dinámico de clientes según RFC 7591. Rechazado cuando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La pantalla de consentimiento a la que se redirige a un cliente |
| `POST` | `/api/oauth/authorize/decision` | session | La respuesta de la persona a esta — aprobar o denegar |
| `POST` | `/api/oauth/token` | credenciales de cliente + PKCE | Intercambia un código de autorización o actualiza el token |
| `POST` | `/api/oauth/revoke` | credenciales de cliente | Revocación de tokens según RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Qué clientes ha aprobado este usuario |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Retira uno, para que una persona pueda revocar un consentimiento sin necesidad de un administrador |

El endpoint MCP propio del panel de administración no forma parte de esta superficie: utiliza la
sesión del panel de administración, nunca un token OAuth, y se monta con las rutas
de administración independientemente de si `REBASE_MCP_ENABLED` está configurado o no, sobre un controlador que aplica
el alcance de RLS a cada llamada.

| Método | Ruta | Gate | Más |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, nunca anónimo | **Experimental.** Las mismas herramientas que `/mcp`, para la persona que ha iniciado sesión, con `data:read`, `data:write` y `data:delete`, bajo su RLS. La vista `savedAppsView` del panel de administración abre [aplicaciones guardadas](/docs/ai/remote-mcp/) a través de él |

## Relacionado

- [REST API](/docs/backend/api/) — las rutas de datos al completo: filtros, ordenación, paginación, errores
- [Auth endpoints](/docs/backend/auth-endpoints/) — estructuras de solicitud y respuesta para la tabla de autenticación anterior
- [Environment & Configuration](/docs/getting-started/configuration/) — las variables que deciden cuáles de estos se montan
