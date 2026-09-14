---
sourceHash: c7cd1dd8eea181bf
title: Índice de endpoints
sidebar_label: Índice de endpoints
description: Cada ruta HTTP que monta un backend de Rebase — datos, autenticación, almacenamiento, administración, meta — con el control de acceso de cada una y la página que la explica.
---

Cada ruta que monta el servidor, en una sola tabla, junto con lo necesario para acceder a ella.

Las rutas asumen el `basePath` predeterminado de `/api`; `REBASE_BASE_PATH` las mueve todas
juntas. `/health`, `/livez` y `/metrics` se ubican fuera de este a propósito,
porque un orquestador sondea `/health` y no debería necesitar conocer la ruta
base. `/health` *también* está montado bajo este, por lo que `/api/health` responde de la misma
manera en lugar de devolver un 404 en el preciso momento en que alguien está verificando si el servidor
está activo.

Un control — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compara esta
tabla con las rutas que registra el código fuente, de modo que no se pueda agregar una nueva superficie
sin que aparezca aquí.

## Gates

| Gate | Significado |
|---|---|
| **none** | Sin autenticación. Cualquiera que pueda alcanzar el host puede invocarlo |
| **session** | Un llamador que ha iniciado sesión: un token de acceso o una clave de API con alcance para la operación |
| **admin** | Una sesión de administrador, una clave de servicio o una clave de API con alcance de administrador |
| **RLS** | Autenticado, y luego la base de datos decide fila por fila — consulte [Security Rules](/docs/collections/security-rules/) |
| **dev** | Montado solo fuera de producción |

## Datos

Generado por colección, por lo que las rutas llevan sus slugs en lugar de una lista
fija. `:slug` es el `slug` de una colección.

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/api/data/collections` | session | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug` | RLS | [Consultas](/docs/backend/api/#filtering) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug/count` | RLS | [Consultas](/docs/backend/api/#filtering) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Alias obsoleto de `PATCH` — misma escritura parcial, responde `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Inserta varias filas, opcionalmente realizando upsert — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Actualiza varias filas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Elimina varias filas por id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Escribe a través de colecciones en una sola transacción — [Escritura a través de REST](/docs/backend/writes/#cross-collection-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Historial de entidades](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Historial de entidades](/docs/backend/history/) |

El conteo y la agregación son rutas independientes, registradas antes de `/:id` para
que `aggregate` no se interprete como el id de una entidad. `?select=` y `?groupBy=` son
sus parámetros, y `select` es obligatorio en `/aggregate`.

La búsqueda de texto, la búsqueda vectorial, la inclusión de relaciones y la selección de campos *son* parámetros
de consulta en `GET /api/data/:slug` en lugar de rutas: `search`,
`vector_search`, `include`, `fields`. Consulte [REST API](/docs/backend/api/).

Un proyecto que no declara colecciones y no inspecciona ninguna sirve este prefijo
como un único `404 NO_COLLECTIONS`. Consulte [Solo backend](/docs/getting-started/headless/).

## Autenticación

| Método | Ruta | Gate | Más información |
|---|---|---|---|
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
| `POST` | `/api/auth/send-verification` | session | [Autenticación](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (un token de verificación) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link` | none | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (un token de enlace) | [Autenticación](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/otp/verify` | none (un código) | Códigos de un solo uso por correo electrónico |
| `POST` | `/api/auth/anonymous` | none | Sesiones de invitado. Desactivado a menos que se use `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (un invitado) | Convierte una sesión de invitado en una cuenta |
| `POST` | `/api/auth/find-user` | session | Desactivado a menos que se use `AUTH_ALLOW_USER_LOOKUP` — es una superficie de enumeración |
| `POST` | `/api/auth/:provider` | none | Uno por cada proveedor OAuth/OIDC configurado |
| `POST` | `/api/auth/link/:provider` | session | Vincula un proveedor a la cuenta con sesión iniciada |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (un inicio de sesión en curso) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (un id de desafío) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/.well-known/jwks.json` | none | El JWKS público, cuando está configurada la [firma asimétrica](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |

## Admin

Todo lo que está bajo `/api/admin` requiere una sesión de administrador, una clave de servicio o una
clave de API con alcance de administrador. No un solo privilegio: una clave con alcance para una colección
no tiene acceso a nada de esto.

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, y solo mientras no exista ningún administrador | Rechazado en producción — consulte [Bootstrap del primer usuario](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | admin | Gestión de usuarios |
| `POST` | `/api/admin/users` | admin | Gestión de usuarios |
| `GET` | `/api/admin/users/:uid` | admin | Gestión de usuarios |
| `PUT` | `/api/admin/users/:uid` | admin | Gestión de usuarios |
| `DELETE` | `/api/admin/users/:uid` | admin | Gestión de usuarios |
| `POST` | `/api/admin/users/:uid/reset-password` | admin | Emite una contraseña temporal |
| `GET` | `/api/admin/roles` | admin | Los roles que declara el proyecto |
| `GET` | `/api/admin/api-keys` | admin | [Claves de API](/docs/backend/api-keys/) |
| `POST` | `/api/admin/api-keys` | admin | La clave en texto plano se devuelve una sola vez, en su creación |
| `GET` | `/api/admin/api-keys/:id` | admin | [Claves de API](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | admin | [Claves de API](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | admin | [Claves de API](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | admin | [Tareas programadas](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | admin | [Tareas programadas](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | admin | Habilita o deshabilita una tarea |
| `GET` | `/api/admin/cron/:id/logs` | admin | [Tareas programadas](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | admin | Ejecuta una tarea ahora |
| `GET` | `/api/admin/backups` | admin | Inventario de copias de seguridad |
| `GET` | `/api/admin/backups/download` | admin | Transmite una copia de seguridad |
| `GET` | `/api/admin/logs` | admin | El búfer de registros recientes |
| `GET` | `/api/admin/logs/latest` | admin | Las entradas más recientes |
| `GET` | `/api/admin/logs/stream` | admin | Server-sent events |
| `GET` | `/api/admin/rls-audit` | admin | El resultado más reciente de la auditoría programada |
| `GET` | `/api/admin/schema/status` | admin | [Edición de esquemas en vivo](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | admin | Planifica un cambio; nunca lo aplica |
| `POST` | `/api/admin/schema/apply` | admin | Desactivado a menos que se use `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | admin | Si el editor está disponible, y el motivo cuando no lo está |
| `POST` | `/api/admin/schema-editor/collection/save` | admin | [Studio](/docs/studio/) — reescribe el código fuente de la colección |
| `POST` | `/api/admin/schema-editor/collection/delete` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | admin | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev | Correos que el transporte de desarrollo capturó en lugar de enviar |

`/api/admin/cron`, `/api/admin/logs` y `/api/admin/schema-editor` también se sirven
en sus rutas anteriores a la versión 0.17 sin el segmento `/admin`. Esos alias son
para proyectos que no se han migrado; escriba el código nuevo utilizando la ruta canónica.

## Storage

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Almacenamiento](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | Los orígenes de almacenamiento con nombre que sirve este backend |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Subidas reanudables: creación |
| `GET` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: desplazamiento (offset) |
| `PATCH` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: anexar |
| `DELETE` | `/api/storage/tus/:id` | el propietario de la subida | Subidas reanudables: cancelar |

Un despliegue sin almacenamiento configurado sirve este prefijo como un `501` indicando la
variable que necesita, en lugar de responder con un 404 como si la funcionalidad no existiera.

## Funciones

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| cualquiera | `/api/functions/<name>` | lo que la función declare | [Funciones personalizadas](/docs/backend/custom-functions/) |

Una ruta por archivo bajo `backend/functions/`, por lo que las rutas provienen de su
proyecto. `GET /api/functions` **no** las lista: el inventario de endpoints personalizados
de un despliegue no es público.

## Metadatos y operaciones

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/livez` | none | Solo actividad (liveness): si este proceso se está ejecutando. No toca la base de datos, por lo que es la ruta de sondeo que un contenedor debería usar — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Actividad y preparación. Informa sobre cada origen de datos configurado, no solo el predeterminado |
| `GET` | `/api/docs` | none (admin en producción) | El documento OpenAPI 3.0 |
| `GET` | `/api/swagger` | none | Swagger UI. Solo para desarrollo a menos que se use `REBASE_ENABLE_SWAGGER` |
| `GET` | `/api/meta/schema-version` | none | El hash del esquema a partir del cual se compiló este backend, y nada más |
| `GET` | `/api/meta/contract` | admin | El contrato completo de colecciones, para `rebase generate-sdk --from`. `404` cuando no hay autenticación configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` cuando esté configurado | Métricas de Prometheus, cuando `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` cuando esté configurado | Las series registradas detrás de los gráficos de Studio. `501` en un entorno de ejecución sin backend |

Las conexiones WebSocket llegan como una actualización HTTP (upgrade) en el mismo servidor en lugar de
en una ruta propia — consulte [Realtime](/docs/backend/realtime/).

## Superficie MCP

Montada solo cuando `REBASE_MCP_ENABLED=true`, lo que también requiere
`REBASE_PUBLIC_URL` — consulte
[Configuración](/docs/getting-started/configuration/#mcp-surface). Desactivado por
defecto: ningún `REBASE_ROLE` activa esto, ya que otorga acceso al proyecto a
software de terceros y esa es una decisión que debe tomar una persona.

Los documentos `.well-known` se ubican en el **origen**, no bajo `basePath`: RFC 8414
y RFC 9728 definen esas rutas relativas al origen, y un cliente las obtiene
antes de disponer de algún token.

| Método | Ruta | Gate | Más información |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | Metadatos RFC 9728 que nombran este recurso y su servidor de autorización. También se sirve en la forma con sufijo de ruta |
| `GET` | `/.well-known/oauth-authorization-server` | none | Metadatos RFC 8414: los endpoints, tipos de concesión (grant types) y métodos PKCE que admite este despliegue |
| `POST` | `/mcp` | OAuth bearer | El endpoint del protocolo MCP. Actúa **como el usuario con sesión iniciada**, por lo que cada lectura y escritura está sujeta al mismo RLS |
| `GET` | `/mcp` | OAuth bearer | El flujo de server-sent events para una sesión |
| `DELETE` | `/mcp` | OAuth bearer | Finaliza una sesión |
| `POST` | `/api/oauth/register` | con límite de tasa | Registro dinámico de clientes RFC 7591. Rechazado cuando `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | La pantalla de consentimiento a la que se redirige a un cliente |
| `POST` | `/api/oauth/authorize/decision` | session | La respuesta de la persona a esta — aprobar o denegar |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Intercambia un código de autorización o actualiza un token |
| `POST` | `/api/oauth/revoke` | client credentials | Revocación de tokens RFC 7009 |
| `GET` | `/api/oauth/grants` | session | Qué clientes ha aprobado este usuario |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Revoca una concesión, para que una persona pueda deshacer un consentimiento sin necesidad de un administrador |

## Relacionado

- [REST API](/docs/backend/api/) — las rutas de datos al completo: filtros, ordenamiento, paginación, errores
- [Endpoints de autenticación](/docs/backend/auth-endpoints/) — estructuras de solicitud y respuesta para la tabla de autenticación anterior
- [Entorno y configuración](/docs/getting-started/configuration/) — las variables que deciden cuáles de estas se montan

---
