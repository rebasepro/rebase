---
sourceHash: 169899c54121eb6e
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Cada ruta HTTP que monta un backend de Rebase — datos, autenticación, almacenamiento, administración, meta — con el control de acceso en cada una y la página que la explica.
---

Cada ruta que monta el servidor, en una sola tabla, con lo necesario para acceder a ella.

Las rutas asumen el `basePath` predeterminado de `/api`; `REBASE_BASE_PATH` las mueve
todas juntas. `/health`, `/livez` y `/metrics` se ubican fuera de este a propósito,
ya que un orquestador sondea `/health` y no debería necesitar conocer la ruta
base. `/health` *también* está montada bajo esta, por lo que `/api/health` responde de la
misma manera en lugar de devolver un 404 en el momento exacto en que alguien está comprobando si el servidor
está activo.

Un control — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compara esta
tabla con las rutas que registra el código fuente, por lo que no se puede añadir
una nueva superficie sin que aparezca aquí.

## Gates

| Gate | Significado |
|---|---|
| **none** | Sin autenticación. Cualquiera que pueda acceder al host puede llamarlo |
| **session** | Un emisor autenticado: un token de acceso o una clave de API con alcance para la operación |
| **`resource:action`** | Un emisor que posee ese [scope](/docs/backend/roles-and-scopes/): un administrador, una persona cuyo rol lo declara, una clave de API creada con él o la service key |
| **RLS** | Autenticado, y luego la base de datos decide fila por fila — consulte [Reglas de seguridad](/docs/collections/security-rules/) |
| **dev** | Montado solo fuera de producción |

## Datos

Generado por colección, por lo que las rutas llevan sus slugs en lugar de una lista
fija. `:slug` es el `slug` de una colección.

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | El listado, parámetros de consulta en el cuerpo — [Consultas demasiado largas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Consultas](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | El conteo, parámetros de consulta en el cuerpo — [Consultas demasiado largas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [API REST](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias obsoleto de `PATCH` — misma escritura parcial, responde con `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserta múltiples filas, opcionalmente realizando upsert — [API REST](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Actualiza múltiples filas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina múltiples filas por id — [API REST](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Escribe en varias colecciones en una sola transacción — [Escritura mediante REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Historial de entidades](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Historial de entidades](/docs/backend/history/) |

El conteo y la agregación son rutas propias, registradas antes de `/:id` para
que `aggregate` no se interprete como el id de una entidad. `?select=` y `?groupBy=` son
sus parámetros, y `select` es obligatorio en `/aggregate`.

La búsqueda de texto, la búsqueda vectorial, la inclusión de relaciones y la selección de campos *son* parámetros
de consulta en `GET /api/data/:slug` en lugar de rutas — `searchString`,
`vector_search`, `include`, `fields`. Consulte la [API REST](/docs/backend/api/).

Un proyecto que no declare colecciones ni inspeccione ninguna sirve este prefijo
como un único `404 NO_COLLECTIONS`. Consulte [Solo backend](/docs/getting-started/headless/).

## Autenticación

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
| `DELETE` | `/api/auth/sessions/:id` | session | Revoca una |
| `POST` | `/api/auth/forgot-password` | none | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (un token de restablecimiento) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Envía por correo un enlace de confirmación a la nueva dirección — [Cambiar una dirección de correo electrónico](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (un token de enlace) | Traslada la cuenta a la nueva dirección — [Cambiar una dirección de correo electrónico](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Autenticación](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token de verificación) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (un token de verificación y una sesión o la contraseña para mantenerla) | [Verificación de correo electrónico](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un token de enlace) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/otp/verify` | none (un código) | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/anonymous` | none | Sesiones de invitado. Desactivado a menos que `ALLOW_ANONYMOUS` esté habilitado |
| `POST` | `/api/auth/anonymous/link` | session (un invitado) | Convierte un invitado en una cuenta |
| `POST` | `/api/auth/find-user` | session | Desactivado a menos que `AUTH_ALLOW_USER_LOOKUP` esté habilitado — es una superficie de enumeración |
| `POST` | `/api/auth/:provider` | none | Uno por cada proveedor OAuth/OIDC configurado |
| `POST` | `/api/auth/link/:provider` | session | Vincula un proveedor a la cuenta iniciada |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un inicio de sesión en curso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un ID de challenge) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Todos los scopes que conoce este backend y los que posee el emisor — [Roles y scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (una cuenta) | Las [claves personales](/docs/backend/api-keys/#personal-keys) del propio emisor |
| `POST` | `/api/auth/keys` | session (una cuenta) | La clave en texto plano se devuelve una sola vez. `403 PERSONAL_KEYS_DISABLED` a menos que la colección de usuarios defina `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (una cuenta) | Revoca una de las claves del propio emisor |
| `GET` | `/.well-known/jwks.json` | none | El JWKS público, cuando está configurada la [firma asimétrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Administración

Todo lo que esté bajo `/api/admin` necesita un scope del plano de administración, y cada
superficie especifica el suyo: `users:read` lista cuentas, `cron:write` activa un trabajo.
Un administrador posee todos ellos, al igual que la service key. Un usuario posee los que
sus roles declaran, y una clave de API aquellos con los que fue creada. Una clave con alcance
limitado a una colección no puede acceder a nada de esto. Consulte [Roles y scopes](/docs/backend/roles-and-scopes/).

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, y solo mientras no exista ningún administrador | Rechazado en producción — consulte [Bootstrap del primer usuario](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | Gestión de usuarios |
| `POST` | `/api/admin/users` | `users:write` | Gestión de usuarios. Se rechazan roles superiores a los del propio emisor |
| `GET` | `/api/admin/users/pick` | `users:read`, o acceso de escritura a una colección con un campo `userSelect` | La [lectura del selector de usuarios](/docs/backend/auth-endpoints/): solo id, nombre, correo electrónico y avatar. Una colección cuyas reglas de escritura sean SQL puro no cuenta |
| `GET` | `/api/admin/users/:uid` | `users:read` | Gestión de usuarios |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Rechazado para una cuenta que posee más permisos que el emisor |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Rechazado para una cuenta que posee más permisos que el emisor |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Emite una contraseña temporal |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Elimina los segundos factores y los códigos de recuperación de la cuenta, y finaliza sus sesiones |
| `GET` | `/api/admin/guests` | `users:read` | <span class="since-badge" data-since="0.27">Desde 0.27</span> Invitados, ordenados primero los vistos por última vez hace más tiempo. `?lastSeenBefore=` los restringe a lo que tomaría la eliminación a continuación, y `total` los cuenta |
| `DELETE` | `/api/admin/guests` | `users:write` | <span class="since-badge" data-since="0.27">Desde 0.27</span> Elimina un lote de los invitados vistos por última vez antes de `?lastSeenBefore=`, el cual es obligatorio. Responde `{ deleted, skipped, remaining }`. Repita mientras `remaining` no sea 0, con `?offset=` establecido en cuántos se han omitido. No se puede acceder a cuentas |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | <span class="since-badge" data-since="0.27">Desde 0.27</span> Elimina un invitado. Una cuenta se rechaza con `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` y los roles que declara el proyecto, con sus scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [Claves de API](/docs/backend/api-keys/). Nunca una clave de API |
| `POST` | `/api/admin/api-keys` | `keys:write` | La clave en texto plano se devuelve una sola vez, al crearla |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [Claves de API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [Claves de API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [Claves de API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Trabajos cron](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Trabajos cron](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Habilita o deshabilita un trabajo |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Trabajos cron](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Ejecuta un trabajo ahora. `?async=1` responde `202` una vez que ha iniciado — [API de trabajos cron](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Inventario de copias de seguridad |
| `GET` | `/api/admin/backups/download` | `backups:read` | Transmite una copia de seguridad. Con `?token=` de un enlace de descarga, no se necesita encabezado, únicamente para esa copia de seguridad |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | Un enlace a una copia de seguridad, `{ key }` → `{ url, token, expiresIn }`, válido durante 60 segundos — [Copias de seguridad](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Inicia un escaneo en segundo plano de los archivos almacenados que ninguna fila referencia, `?storageId=&olderThanHours=`. Responde `202` con el registro del escaneo: `id`, `status` (`queued`) y `runner` (`worker` cuando es un trabajo `storage.orphans` en la cola de trabajos, `in-process` cuando el servidor lo ejecuta él mismo). Su registro se escribe en la fuente, bajo la ruta reservada `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | El registro del escaneo, `?storageId=`. Mientras se ejecuta: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` de `collectionsTotal`, `unscanned`). Una vez `completed`: `result`, el informe que devolvía el antiguo `GET /orphans`. Una ejecución que haya dejado de reportar durante 10 minutos se responde como `failed`. `404 STORAGE_SCAN_NOT_FOUND` cuando la fuente no contiene dicho escaneo |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Elimina en segundo plano los archivos huérfanos de un escaneo completado, `202`. Cada uno se comprueba nuevamente contra cada fila y entrada del historial, y se vuelve a solicitar justo antes de eliminarse. El resultado es el campo `deletion` del registro de escaneo. `409` con `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` o `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Obsoleto: el escaneo dentro de la solicitud, `?storageId=&olderThanHours=`. Responde con `Deprecation: true`. Utilice `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Obsoleto, sin `?scan=`: escanea nuevamente y elimina dentro de la solicitud. `409 STORAGE_SCAN_INCOMPLETE` cuando una colección no se pudo leer |
| `POST` | `/api/admin/storage/move` | `database:write` | Copia una carpeta a otra fuente bajo las mismas claves, una página por llamada — lo que envía `rebase storage move`; `400 STORAGE_SAME_LOCATION` para `deleteSource` entre dos fuentes que almacenan en el mismo lugar |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Lista la fuente nuevamente tras un traslado, con el mismo cuerpo, una página por llamada: `{ checked, notMoved: [{ key, reason }], cursor? }` — cada archivo que aún permanezca en la fuente con `deleteSource`, cada archivo del que el destino no tenga copia sin él. `rebase storage move` lo consulta cuando el traslado ha terminado |
| `GET` | `/api/admin/logs` | `logs:read` | El búfer de registros recientes |
| `GET` | `/api/admin/logs/latest` | `logs:read` | Las entradas más recientes |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Eventos enviados por el servidor (Server-sent events) |
| `GET` | `/api/admin/rls-audit` | `schema:read` | El último resultado de la auditoría programada |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Roles, roles de reglas de usuarios y claves de servicio activas que un administrador puede simular |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Cada colección tal como accede a ella `{ role?, userId?, apiKeyId? }`: filas visibles frente a las del emisor, ocultas por scope o RLS, campos enmascarados. Solo sesión de administrador |
| `POST` | `/api/admin/sql/csv` | `database:write` | Transmite el resultado completo de una consulta de solo lectura como CSV — "Descargar resultado completo como CSV" de [Studio](/docs/studio/) |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | Lo que cambió una [rama](/docs/backend/branching/#reviewing-and-merging-a-branch): esquema, políticas y filas, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Escribe las filas de la rama en su principal (parent), `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` cuando cualquiera de los lados cambió desde el diff, o hay conflicto de filas |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Edición de esquemas en vivo](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Planifica un cambio; nunca aplica ninguno |
| `POST` | `/api/admin/schema/apply` | `schema:write` | Solo una persona, a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` esté habilitado |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Si el editor está disponible y el motivo cuando no lo está |
| `POST` | `/api/admin/schema-editor/collection/save` | `schema:write` | [Studio](/docs/studio/) — reescribe el código fuente de la colección |
| `POST` | `/api/admin/schema-editor/collection/delete` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | `schema:write` | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | `schema:write` | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Correos electrónicos capturados por el transporte de desarrollo en lugar de enviarse |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Vacía el buzón de correo capturado |

`/api/admin/cron`, `/api/admin/logs` y `/api/admin/schema-editor` también se
sirven en sus rutas anteriores a la versión 0.17 sin el segmento `/admin`. Esos alias son
para proyectos que aún no han migrado; escriba el nuevo código utilizando la ruta canónica.

## Almacenamiento

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, por clave | [Almacenamiento](/docs/backend/storage/#storage-endpoints): metadatos para hasta 100 objetos |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Las fuentes de almacenamiento con nombre que sirve este backend |
| `OPTIONS` | `/api/storage/tus` | none | Subidas reanudables: las versiones de TUS y extensiones que este servidor soporta |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Subidas reanudables: creación |
| `GET` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: desplazamiento (offset) |
| `PATCH` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: anexar |
| `DELETE` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: cancelar |

Un despliegue sin almacenamiento configurado sirve este prefijo como un `501` indicando la
variable que necesita, en lugar de responder 404 como si la funcionalidad no existiera —
excepto `GET /api/storage/sources`, que responde `200` con una lista vacía.

## Funciones

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/functions` | session | Los nombres de las funciones servidas y cuántos archivos no se pudieron cargar |
| cualquiera | `/api/functions/<name>` | lo que la función declare. Una clave de API también necesita `functions:invoke` | [Funciones personalizadas](/docs/backend/custom-functions/) |

Una ruta por archivo bajo `backend/functions/`, por lo que las rutas provienen de su
proyecto. `GET /api/functions` las lista solo para un emisor autenticado — una
sesión, una clave de API o la service key — y responde a cualquier otra persona con `401`: el
inventario de endpoints personalizados de un despliegue no es público.

## Meta y operaciones

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/livez` | none | Comprobación de funcionamiento exclusivamente (liveness): si este proceso se está ejecutando. No accede a la base de datos, por lo que es la ruta de sondeo que debería usar un contenedor — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness y readiness. Informa sobre cada fuente de datos configurada, no solo la predeterminada |
| `GET` | `/api/docs` | none (`schema:read` cuando `enableSwagger` es `false`, el valor predeterminado del runtime en producción) | El documento de OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. Solo fuera de producción; `REBASE_ENABLE_SWAGGER` no puede habilitarlo en producción. Tampoco se sirve cuando `enableSwagger` es `false`, incluso en desarrollo |
| `GET` | `/api/meta/schema-version` | none | El hash del esquema a partir del cual se construyó este backend y la versión del runtime, y nada más |
| `GET` | `/api/meta/contract` | `schema:read` | El contrato completo de colecciones, para `rebase generate-sdk --from`. `404` cuando no hay autenticación configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` cuando esté configurado | Métricas de Prometheus, cuando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` cuando esté configurado | Las series registradas detrás de los gráficos de Studio. `501` en un runtime sin backend |

Las conexiones WebSocket llegan como una actualización HTTP (upgrade) en el mismo servidor en lugar de
en una ruta propia — consulte [Tiempo real](/docs/backend/realtime/).

## Superficie MCP

Montado únicamente cuando `REBASE_MCP_ENABLED=true`, lo que también requiere
`REBASE_PUBLIC_URL` — consulte
[Configuración](/docs/getting-started/configuration/#mcp-surface). Desactivado de forma
predeterminada: ningún `REBASE_ROLE` activa esto, ya que otorga acceso al proyecto a
software de terceros y esa es una decisión que debe tomar una persona.

Los documentos `.well-known` se encuentran en el **origen**, no bajo `basePath`: el RFC 8414
y el RFC 9728 definen esas rutas relativas al origen, y un cliente las obtiene
antes de poseer cualquier token.

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadatos de RFC 9728 que nombran este recurso y su servidor de autorización. Se sirve también en la forma con sufijo de ruta |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadatos de RFC 8414: los endpoints, grant types y métodos PKCE que este despliegue soporta |
| `POST` | `/mcp` | Portador (bearer) OAuth, o una clave de API | El endpoint del protocolo MCP. Actúa **como el usuario autenticado** (o como quienquiera que actúe la clave), por lo que cada lectura y escritura está sujeta al mismo RLS. Los scopes `data:*` deciden qué herramientas se ofrecen |
| `GET` | `/mcp` | Portador (bearer) OAuth, o una clave de API | Responde `405` con `Allow: POST, DELETE`: este servidor no abre ningún flujo iniciado por el servidor. El token se comprueba primero, por lo que uno ausente o caducado recibe el challenge `401` en su lugar |
| `DELETE` | `/mcp` | none | Responde `204`. El endpoint no mantiene ninguna sesión, por lo que no hay nada que finalizar |
| `POST` | `/api/oauth/register` | con límite de tasa (rate-limited) | Registro dinámico de clientes de RFC 7591. Rechazado cuando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La pantalla de consentimiento a la que se redirige a un cliente |
| `POST` | `/api/oauth/authorize/decision` | session | La respuesta del usuario a esta: aprobar o denegar |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Intercambia un código de autorización, o renueva |
| `POST` | `/api/oauth/revoke` | client credentials | Revocación de token de RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Qué clientes ha aprobado este usuario |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Retira uno, para que un usuario pueda revocar un consentimiento sin necesidad de un administrador |

## Relacionado

- [API REST](/docs/backend/api/) — las rutas de datos al completo: filtros, ordenación, paginación, errores
- [Endpoints de autenticación](/docs/backend/auth-endpoints/) — estructuras de solicitud y respuesta para la tabla de autenticación anterior
- [Entorno y configuración](/docs/getting-started/configuration/) — las variables que deciden cuáles de estas se montan
