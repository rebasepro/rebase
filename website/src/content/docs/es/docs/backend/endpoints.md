---
sourceHash: e08fbf11c0138bb1
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Cada ruta HTTP que monta un backend de Rebase — datos, autenticación, almacenamiento, administración, meta — con el control de acceso en cada una y la página que la explica.
---

Cada ruta que monta el servidor, en una sola tabla, con lo necesario para acceder a ella.

Las rutas asumen el `basePath` predeterminado de `/api`; `REBASE_BASE_PATH` las
mueve todas juntas. `/health`, `/livez` y `/metrics` se sitúan fuera de él a
propósito, porque un orquestador sondea `/health` y no debería tener que conocer
la ruta base. `/health` *también* está montado debajo de él, por lo que
`/api/health` responde de la misma manera en lugar de devolver un error 404 en el
preciso momento en que alguien está comprobando si el servidor está activo.

Un control — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compara esta
tabla con las rutas que registra el código fuente, de modo que no se puede añadir
una nueva superficie sin que aparezca aquí.

## Gates

| Gate | Significado |
|---|---|
| **none** | Sin autenticación. Cualquiera que pueda acceder al host puede llamarlo |
| **session** | Un emisor con sesión iniciada: un token de acceso o una clave de API con alcance para la operación |
| **admin** | Una sesión de administrador, una clave de servicio o una clave de API con alcance de administrador |
| **RLS** | Autenticado, y luego la base de datos decide fila por fila — consulta [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montado solo fuera de producción |

## Datos

Generado por colección, por lo que las rutas llevan tus slugs en lugar de una
lista fija. `:slug` es el `slug` de una colección.

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/data/collections` | session | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/api/#filtering) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/api/#filtering) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias obsoleto (deprecated) de `PATCH` — misma escritura parcial, responde `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserta múltiples filas, opcionalmente con upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Actualiza múltiples filas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina múltiples filas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Escribe a través de colecciones en una sola transacción — [Writing over REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

El conteo y la agregación son rutas propias, registradas antes de `/:id` para
que `aggregate` no se interprete como un id de entidad. `?select=` y `?groupBy=`
son sus parámetros, y `select` es obligatorio en `/aggregate`.

La búsqueda de texto, la búsqueda vectorial, la inclusión de relaciones y la
selección de campos *son* parámetros de consulta en `GET /api/data/:slug` en
lugar de rutas — `search`, `vector_search`, `include`, `fields`. Consulta
[REST API](/docs/backend/api/).

Un proyecto que no declara colecciones y no inspecciona ninguna sirve este
prefijo como un único `404 NO_COLLECTIONS`. Consulta [Backend only](/docs/getting-started/headless/).

## Auth

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/auth/register` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (un token de actualización) | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Revoca todas las demás sesiones |
| `DELETE` | `/api/auth/sessions/:id` | session | Revoca una |
| `POST` | `/api/auth/forgot-password` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (un token de restablecimiento) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/send-verification` | session | [Authentication](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token de verificación) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un token de enlace) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/otp/verify` | none (un código) | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/anonymous` | none | Sesiones de invitado. Desactivado a menos que `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un invitado) | Convierte a un invitado en una cuenta |
| `POST` | `/api/auth/find-user` | session | Desactivado a menos que `AUTH_ALLOW_USER_LOOKUP` — es una superficie de enumeración |
| `POST` | `/api/auth/:provider` | none | Uno por cada proveedor de OAuth/OIDC configurado |
| `POST` | `/api/auth/link/:provider` | session | Vincula un proveedor a la cuenta con sesión iniciada |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un inicio de sesión en curso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un ID de desafío) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/.well-known/jwks.json` | none | El JWKS público, cuando el [firmado asimétrico](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) está configurado |

## Admin

Todo lo que está bajo `/api/admin` necesita una sesión de administrador, una
clave de servicio o una clave de API con alcance de administrador. Ni un solo
privilegio: una clave con alcance limitado a una colección no puede acceder a nada
de esto.

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, y solo mientras no exista ningún administrador | Rechazado en producción — consulta [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | admin | Gestión de usuarios |
| `POST` | `/api/admin/users` | admin | Gestión de usuarios |
| `GET` | `/api/admin/users/:uid` | admin | Gestión de usuarios |
| `PUT` | `/api/admin/users/:uid` | admin | Gestión de usuarios |
| `DELETE` | `/api/admin/users/:uid` | admin | Gestión de usuarios |
| `POST` | `/api/admin/users/:uid/reset-password` | admin | Emite una contraseña temporal |
| `GET` | `/api/admin/roles` | admin | Los roles que declara el proyecto |
| `GET` | `/api/admin/api-keys` | admin | [API keys](/docs/backend/api-keys/) |
| `POST` | `/api/admin/api-keys` | admin | La clave en texto plano se devuelve una sola vez, al momento de su creación |
| `GET` | `/api/admin/api-keys/:id` | admin | [API keys](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | admin | [API keys](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | admin | [API keys](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | admin | Habilita o deshabilita un trabajo |
| `GET` | `/api/admin/cron/:id/logs` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | admin | Ejecuta un trabajo ahora |
| `GET` | `/api/admin/backups` | admin | Inventario de copias de seguridad |
| `GET` | `/api/admin/backups/download` | admin | Transmite una copia de seguridad |
| `GET` | `/api/admin/logs` | admin | El búfer de registros recientes |
| `GET` | `/api/admin/logs/latest` | admin | Las entradas más recientes |
| `GET` | `/api/admin/logs/stream` | admin | Server-sent events |
| `GET` | `/api/admin/rls-audit` | admin | El resultado más reciente de la auditoría programada |
| `GET` | `/api/admin/schema/status` | admin | [Live schema editing](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | admin | Planifica un cambio; nunca lo aplica |
| `POST` | `/api/admin/schema/apply` | admin | Desactivado a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | admin | Indica si el editor está disponible y el motivo cuando no lo está |
| `POST` | `/api/admin/schema-editor/collection/save` | admin | [Studio](/docs/studio/) — reescribe el código fuente de la colección |
| `POST` | `/api/admin/schema-editor/collection/delete` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | admin | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev | Correos que el transporte de desarrollo capturó en lugar de enviar |

`/api/admin/cron`, `/api/admin/logs` y `/api/admin/schema-editor` también se
sirven en sus rutas anteriores a la versión 0.17 sin el segmento `/admin`. Esos
alias son para proyectos que aún no han migrado; escribe el código nuevo usando la
ruta canónica.

## Almacenamiento

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Las fuentes de almacenamiento con nombre que sirve este backend |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Subidas reanudables: creación |
| `GET` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: desplazamiento (offset) |
| `PATCH` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: anexar |
| `DELETE` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: cancelar |

Un despliegue sin almacenamiento configurado sirve este prefijo como un error
`501` indicando la variable que necesita, en lugar de devolver un 404 como si la
funcionalidad no existiera.

## Funciones

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| cualquiera | `/api/functions/<name>` | lo que declare la función | [Custom Functions](/docs/backend/custom-functions/) |

Una ruta por cada archivo en `backend/functions/`, por lo que las rutas
provienen de tu proyecto. `GET /api/functions` **no** las lista: el inventario
de los endpoints personalizados de un despliegue no es público.

## Meta y operaciones

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/livez` | none | Solo vivacidad (liveness): indica si este proceso se está ejecutando. No toca la base de datos, por lo que es la ruta de sondeo que debe usar un contenedor — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Vivacidad y preparación (readiness). Informa sobre cada fuente de datos configurada, no solo la predeterminada |
| `GET` | `/api/docs` | none (admin en producción) | El documento de OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. Solo en desarrollo a menos que `REBASE_ENABLE_SWAGGER` |
| `GET` | `/api/meta/schema-version` | none | El hash del esquema a partir del cual se construyó este backend, y nada más |
| `GET` | `/api/meta/contract` | admin | El contrato completo de colecciones, para `rebase generate-sdk --from`. `404` cuando no hay autenticación configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` cuando está definido | Métricas de Prometheus, cuando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` cuando está definido | Las series registradas detrás de los gráficos de Studio. `501` en un entorno de ejecución sin backend |

Las conexiones WebSocket llegan como una actualización HTTP (HTTP upgrade) en el
mismo servidor en lugar de en una ruta propia — consulta [Realtime](/docs/backend/realtime/).

## Relacionado

- [REST API](/docs/backend/api/) — las rutas de datos al completo: filtros, ordenación, paginación, errores
- [Auth endpoints](/docs/backend/auth-endpoints/) — estructuras de solicitud y respuesta para la tabla de autenticación anterior
- [Environment & Configuration](/docs/getting-started/configuration/) — las variables que deciden cuáles de estas se montan

---
