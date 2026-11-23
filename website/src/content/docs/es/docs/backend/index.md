---
sourceHash: f3631ce64dd803f5
title: Descripción general del Backend
sidebar_label: Backend
description: El backend de Rebase proporciona un servidor completo con API REST, autenticación, almacenamiento, tiempo real mediante WebSockets e historial de entidades — todo inicializado con una única llamada a función.
---

## Descripción general

El backend de Rebase es un **servidor Node.js** construido sobre [Hono](https://hono.dev/) que proporciona:

- **API REST** — Endpoints CRUD autogenerados para cada tabla
- **Autenticación** — Tokens JWT, inicio de sesión mediante OAuth y OIDC, magic links, códigos de un solo uso, MFA, claves de API, gestión de usuarios/roles
- **Almacenamiento** — Subida y descarga de archivos con sistema de archivos local o S3
- **WebSocket** — Sincronización de datos en tiempo real mediante LISTEN/NOTIFY de PostgreSQL
- **Historial de entidades** — Registro de auditoría para cada cambio de datos
- **Bifurcación de bases de datos (Branching)** — Copias de base de datos instantáneas y aisladas para desarrollo, staging y pruebas
- **Tareas programadas (Cron Jobs)** — Tareas en segundo plano programadas con panel de monitorización

Todo se inicializa con una única función:

:::note[Dónde va esto]
La llamada que se muestra a continuación es la que tiene un backend **ejected**, en `backend/src/index.ts`. En
el **runtime administrado** no existe dicho archivo: el runtime realiza la llamada y
usted lo configura mediante variables de entorno, las tablas que exporta
`backend/schema/index.ts`, los recursos declarados en `backend/resources.ts` (`database()`,
`bucket()`), y dos exportaciones que este lee: `storageAuthorize` desde
`backend/storage.ts` y `hooks` desde `backend/hooks.ts`. Cada página de esta
sección indica cuál de las dos formas aplica a la opción documentada, y nombra
aquellas que no tienen una forma administrada. Si exporta cualquier otra cosa desde esos dos módulos,
el runtime le advertirá al iniciar en lugar de omitirlo en silencio; si exporta una opción
que una declaración de recurso reemplazó, el inicio la rechazará explícitamente indicando
la línea que debe escribir en `backend/resources.ts`.
:::

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import path from "node:path";
import { env } from "./env";

const instance = await initializeRebaseBackend({
    app,
    server,
    schemaDir: path.resolve(__dirname, "../schema"),
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),
    auth: {
        jwtSecret: env.JWT_SECRET,
    },
    storage: { type: "local", basePath: "./uploads" },
    history: true
});
```

Esa única llamada es
un atajo sobre varios pasos públicos: `installUnhandledRejectionHandler` evita que un
rejection no controlado finalice el proceso, `createRebaseBackend` construye el backend,
`setDefaultBackend` lo establece como el predeterminado para la API a nivel de módulo, y
`mount`, `attachRealtime` y `start` se encargan de servirlo. Si desea montar solo algunos grupos
de rutas, colocarlos en otras rutas, delegar los temporizadores a otro proceso o ejecutar
dos backends en un mismo proceso, llame a los pasos manualmente. Consulte
[Integración de servidor personalizado](/docs/backend/custom-server/).

## Dónde reside cada opción

Esa llamada corresponde a la estructura **ejected** — la que usted mismo escribe tras ejecutar `rebase
eject`, o en un servidor personalizado. Un proyecto generado automáticamente (scaffolded) no la tiene: el
runtime publicado inicia el proyecto, y cada opción se suministra como una variable
de entorno en `.env`, una exportación desde `backend/storage.ts` o `backend/hooks.ts`,
o un directorio declarado por el bundle en `rebase.json`.

Ambas vías desembocan en el mismo `RebaseBackendConfig`. Este es el mapa completo:

| Opción | Runtime administrado |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (por defecto `/api`) |
| `tables`, `schemaDir`, `defaultRls` | el directorio `backend/schema/` (la clave `tables` de `rebase.json`): las tablas y el `defaultRls` que exporta su `index.ts` |
| `rpc` | las declaraciones `defineRpc` que exporta `backend/schema/index.ts` — consulte [Funciones SQL como RPC](/docs/backend/rpc/) |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, más una declaración `database("<key>")` en `backend/resources.ts` para cada base de datos adicional a la predeterminada |
| `auth` | `JWT_SECRET`, las variables `OAUTH_*`, y la tabla que `backend/schema` declara con `defineAuthTable` |
| `storage` | las variables `STORAGE_*`, más una declaración `bucket("<key>")` en `backend/resources.ts` para cada bucket adicional al predeterminado |
| `storageAuthorize` | `export const storageAuthorize` desde `backend/storage.ts` |
| `storagePolicies` | `STORAGE_POLICIES`, como reglas JSON — consulte [Autorización de almacenamiento](/docs/backend/storage-authorization/#as-data-storage_policies) |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` desde `backend/hooks.ts` — hooks globales de tabla |
| `history` | `REBASE_HISTORY` (activado por defecto) — solo en forma booleana |
| `push` | `REBASE_PUSH`, con `REBASE_VAPID_*` para las claves — solo en forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; sin definir sirve `/api/docs` a la audiencia del endpoint de schema, `true` lo publica con Swagger UI, `false` lo mantiene protegido para administradores |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` y sus credenciales `REBASE_LIVE_SCHEMA_*` — solo en forma de repositorio |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — consulte [Procesos divididos](/docs/deployment/split-processes/) |
| `corsHandled` | El runtime configura CORS a partir de `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | el build estampa ambos valores en el bundle |
| `app`, `server`, `provisioningDriverResult` | el runtime los crea automáticamente |

### Opciones sin ruta administrada

Estas no disponen de variable de entorno ni de exportación de módulo. Solo se puede
acceder a ellas mediante una llamada manual a `initializeRebaseBackend` — a través de `rebase eject` o en un
[servidor personalizado](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` en su forma de objeto (`{ retention }`) ·
`push` en su forma de objeto (`{ allowedHosts, sender, vapid }`)

`schemaEditor` se deshabilita obligatoriamente en un bundle compilado: el editor modifica los
archivos *fuente* de `backend/schema`, y un bundle solo contiene código ya compilado.

## Qué se crea

Tras la inicialización, se montan las siguientes rutas:

| Ruta | Propósito |
|------|-----------|
| `/api/auth/*` | Autenticación (registro, inicio de sesión, refresco, OAuth, magic links, códigos de un solo uso, MFA) |
| `/api/admin/*` | Usuarios, roles, claves de servicio, cron, copias de seguridad, registros y schema, cada uno tras su propio [scope](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Subida, descarga y eliminación de archivos |
| `/api/data/:slug` | Operaciones CRUD por tabla (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Historial de cambios de entidades (cuando está habilitado) |
| `/api/docs` | Especificación OpenAPI de las tablas visibles para el usuario (pública con `enableSwagger: true`; solo administradores con `false`) |
| `/api/swagger` | Swagger UI (con `enableSwagger: true`, únicamente fuera de producción) |
| `/api/schema/tables` | Las tablas que sirve este backend, según los permisos del usuario — consulte [Endpoints](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | La versión del schema, el runtime y cada tabla según la vista de un administrador (requiere `schema:read`) |
| `/api/meta/schema-version` | Cadena de versión para dicho schema (sin autenticación) |
| `/api/rpc/:name` | Las funciones SQL declaradas con `defineRpc`, ejecutadas con la identidad del solicitante — consulte [Funciones SQL como RPC](/docs/backend/rpc/) |
| `/api/functions/*` | Rutas de funciones personalizadas (cuando `functions` o `functionsDir` está configurado) |
| `/api/push/*` | Suscripciones a [notificaciones push](/docs/backend/push-notifications/) (cuando `push` está habilitado) |
| `/api/admin/cron/*` | Gestión de tareas cron (`cron:read` / `cron:write`, cuando `crons` o `cronsDir` está configurado) |
| WebSocket en upgrade | Suscripciones en tiempo real, en `/` para una API en `/api` |

---

## Ciclo de vida de inicialización

Al invocar `initializeRebaseBackend()`, el framework ejecuta una secuencia de arranque de 5 etapas:

```
[Inicio de arranque]
     │
     ▼
1. Configuración (el adaptador de base de datos, opciones de autenticación y almacenamiento proporcionadas)
     │
     ▼
2. Carga de Schema (importa backend/schema/index.ts, compila cada tabla — un error en cualquiera detiene el arranque)
     │
     ▼
3. Bootstrap de Base de Datos (crea schemas/auth/funciones SQL auxiliares, según lo permita `provision`)
     │
     ▼
4. Inicialización de Servicios (Auth, instancias de cliente Storage S3/Local, inicialización del store de Cron)
     │
     ▼
5. Montaje de Rutas y Carga Edge (controladores Hono, funciones personalizadas, vinculación WebSocket)
     │
     ▼
[Arranque completado]
```

---

## Qué ocurre cuando falla el arranque

**El arranque falla ruidosamente.** Si no se puede acceder a la base de datos, las credenciales son
incorrectas, o el schema no se puede compilar o aplicar, `initializeRebaseBackend`
lanza un error, no se sirve nada y el proceso termina con código de salida `1`. No hay modo degradado
ni servidor parcial: un contenedor que no puede conectarse a su base de datos se reinicia, y
el error que provocó el fallo es lo último registrado en sus logs.

Esto es deliberado. Un servidor que arranca permitiendo iniciar sesión mientras fallan
todas las rutas `/api/data/*` es mucho más difícil de diagnosticar que uno que nunca llega a
iniciarse — y un orquestador puede actuar ante un bucle de reinicios (crash loop).

Antes de la primera consulta, el arranque comprueba la conexión e imprime el diagnóstico: el
host y puerto a los que no pudo acceder, el motivo propio del driver (`ECONNREFUSED`,
`password authentication failed for user "app"`), y la solución. Consulte
[Resolución de problemas](/docs/troubleshooting/) para ver la lista detallada de errores.

### Una vez en funcionamiento: `/livez` y `/health`

Dos sondas que responden a dos preguntas distintas.

| Ruta | Accede a la base de datos | Respuesta |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` mientras el proceso esté en ejecución. Utilícela como liveness probe. |
| `/health` | Sí, a cada fuente de datos | `200 {"status":"ok"}` cuando todas las fuentes de datos configuradas responden; `503 {"status":"degraded"}` si alguna falla. Utilícela como readiness probe. |

Configurar una liveness probe apuntando a `/health` es un error importante a evitar: un fallo
momentáneo de la base de datos haría que el orquestador elimine un proceso que por lo demás está sano,
convirtiendo una breve interrupción en un bucle continuo de reinicios.

`/health` no requiere autenticación, por lo que solo publica el estado final y no el motivo —
fuera del entorno de desarrollo solo especifica qué fuente de datos está degradada y nada más. El
texto del error del driver detalla el host, puerto, nombre de base de datos y rol, y eso se
envía a los logs. `/health` también se sirve bajo el `basePath` (`/api/health`);
`/livez` no.

Ambas sondas pertenecen al runtime administrado. Un `backend/src/index.ts` ejected sirve
`/health` y `/api/health` por su cuenta, verificando únicamente la base de datos por defecto, y no
incluye `/livez` a menos que usted lo añada.

---

## Referencia de configuración

La opción `rpc` a continuación.

```typescript
interface RebaseBackendConfig {
    // HTTP framework
    app: Hono;               // Hono application instance
    server: Server;           // Node.js HTTP server (for WebSocket attachment)
    basePath?: string;        // Route prefix (default: "/api")

    // Tables
    tables?: (AnyTableDef | AnyViewDef)[]; // defineTable / defineAuthTable / defineView results
    defaultRls?: DefaultRls;  // What `rls: "inherit"` tables take, when you pass `tables`
    schemaDir?: string;       // The backend/schema directory: loaded when `tables` is absent, and what the schema editor writes
    hooks?: TableHooks;       // Global table hooks, run for every table

    // Database adapter (PostgreSQL, SQLite, etc.)
    database?: DatabaseAdapter;

    // Authentication configuration or custom adapter
    auth?: RebaseAuthConfig | AuthAdapter;

    // File storage
    storage?: BackendStorageConfig | Record<string, BackendStorageConfig>;

    // Entity history
    history?: boolean | HistoryConfig;

    // OpenAPI/Swagger
    enableSwagger?: boolean;

    // SQL functions served at /api/rpc/<name> (defineRpc). Read from the
    // schemaDir index when the tables are; pass them as values otherwise.
    rpc?: AnyRpcDef[];

    // Custom API endpoints: values, or a directory of files (not both)
    functions?: Record<string, FunctionApp>;  // { "send-invoice": app } → /api/functions/send-invoice
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks: values, or a directory of files (not both)
    crons?: Record<string, CronJobDefinition>; // { "nightly-report": defineCron(…) }
    cronsDir?: string;         // Auto-load cron jobs from a directory
    cronPersistence?: boolean; // Write run logs to rebase.cron_logs (default: true)

    // HTTP behaviour
    compression?: boolean;     // gzip/deflate for API responses (default: true)
    maxBodySize?: number;      // Request-body ceiling in bytes (default: 10MB; 0 disables)
    csrf?: { origin: string | string[] | ((origin: string) => boolean) };

    // Schema editing
    schemaEditor?: boolean;   // Force the schema-editor routes on or off

    // Logging
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

Cinco de estas opciones pasan desapercibidas fácilmente y modifican un comportamiento que de otro
modo solo podría inferirse:

| Clave | Valor por defecto | Qué hace |
|---|---|---|
| `compression` | `true` | Compresión gzip/deflate en respuestas de API, negociada mediante `Accept-Encoding`. Los cuerpos ya comprimidos, en streaming y con directiva `no-transform` no se modifican, al igual que los cuerpos menores a 1 KB (gzip consume más de lo que ahorra en esos casos), por lo que es seguro mantenerlo activo — una lista JSON extensa suele reducirse unas ~20 veces. Establezca `false` si un proxy intermedio como nginx o Cloudflare ya aplica compresión, para evitar duplicar el proceso. Variable: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Límite para cuerpos de petición en rutas de API; `0` lo desactiva. Las subidas a Storage utilizan el límite propio de su configuración `maxFileSize` (50MB), que prevalece en dichas rutas. Variable: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | desactivado | **Opcional (Opt-in).** Una API BaaS recibe peticiones desde aplicaciones móviles, SPAs en otros dominios y herramientas CLI, ninguna de las cuales envía un encabezado `Origin` compatible con una lista estática — por ello no está activo por defecto. Actívelo especificando los orígenes que emplean sus clientes web. Sin variable de entorno: requiere modo eject para configurarlo. |
| `cronPersistence` | `true` | Determina si los registros de ejecución se guardan en `rebase.cron_logs`. Con `false`, las tareas se siguen ejecutando pero el historial reside solo en memoria, perdiéndose en el panel de Studio tras un reinicio. |
| `schemaEditor` | activo fuera de producción cuando `schemaDir` está configurado | Fuerza la activación o desactivación de las rutas del editor de schema. El editor modifica los *archivos fuente* en `backend/schema`, por lo que necesita un directorio donde escribir — y un bundle compilado carece de él, motivo por el cual nunca está disponible en despliegues. |

El resto de `RebaseBackendConfig` está documentado en su página correspondiente (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) o marcado como `@internal`:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` y `runtimeVersion` son asignados por
`bootFromBundle` a partir del entorno; pasarlos manualmente puede generar discrepancias
con el runtime sobre el rol del proceso.

## La instancia del Backend

`initializeRebaseBackend` devuelve el backend que ha construido, ya montado y
en funcionamiento. Su tipo es `RebaseBackendInstance`, que extiende de `RebaseBackend`, el
mismo tipo retornado por `createRebaseBackend`:

```typescript
const instance = await initializeRebaseBackend(config);

// Internal service access
instance.driver              // Default data driver
instance.driverRegistry      // All drivers (for multi-database)
instance.realtimeService     // Default realtime service
instance.auth?.userService       // User management
instance.storageController   // Default storage
instance.storageRegistry     // All storage backends
instance.getTableDescriptors() // The compiled tables, as GET /api/schema/tables serves them
instance.history?.historyService // Entity history
instance.cronScheduler       // Cron job scheduler (when crons or cronsDir is set)
instance.jobQueue            // Durable job queue (when jobs are enabled)
instance.setTableHooks(slug, hooks) // Replace a table's hooks
instance.shutdown()          // Drain and stop; also closes the server it was given
```

También proporciona
`rebase`, el cliente en el mismo proceso (in-process), `fetch(request)`, `routes`, los grupos
de rutas como sub-aplicaciones Hono, `services`, sus propias claves JWT, modelo de accesos, almacén de claves de API y
limitadores de tasa (rate limiters), además de `verifyCredential(token)`; consulte
[Integración de servidor personalizado](/docs/backend/custom-server/).

> **Nota:** Aunque la instancia expone estos servicios internos, el código de la aplicación (como funciones personalizadas y tareas cron) debe utilizar el singleton `rebase` de `@rebasepro/server` para interactuar con la API del backend. Dentro de una petición, ejecución cron o tarea, `rebase` representa al backend que lo atiende; en otros contextos es el predeterminado del proceso, establecido por `initializeRebaseBackend`.

## API REST

La API REST se genera automáticamente a partir de sus tablas. Cada tabla cuenta con estos endpoints:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Listar entidades — filtros, ordenación, paginación y búsqueda se gestionan por parámetros de consulta |
| `GET` | `/api/data/:slug/count` | Cuántas filas coinciden con la misma consulta |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opcionalmente agrupados |
| `GET` | `/api/data/:slug/:id` | Obtener una entidad individual |
| `POST` | `/api/data/:slug` | Crear una nueva entidad |
| `PATCH` | `/api/data/:slug/:id` | Actualizar los campos especificados |
| `DELETE` | `/api/data/:slug/:id` | Eliminar un registro |
| `POST` | `/api/data/:slug/bulk` | Crear múltiples filas en una única transacción |
| `PATCH` | `/api/data/:slug/bulk` | Actualizar múltiples filas en una única transacción |
| `POST` | `/api/data/:slug/bulk/delete` | Eliminar múltiples filas en una única transacción |

### Parámetros de consulta (Query parameters)

Existe una referencia exhaustiva para ellos fuera de esta página. [API
REST](/docs/backend/api/) detalla ambos dialectos de consulta compatibles con el servidor — la
sintaxis estilo PostgREST `?column=op.value` y el formato JSON `?where=` —, junto con
`orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` y búsqueda vectorial.
[Endpoints](/docs/backend/endpoints/) ofrece el índice de todas las rutas que monta
el servidor, incluyendo las autogeneradas.

Cualquier parámetro no reservado por el servidor se interpreta como un filtro sobre la columna
de dicho nombre, por lo que un parámetro inventado no produce error: simplemente no coincidirá con ningún registro.

## WebSocket

El servidor WebSocket se acopla al mismo servidor HTTP y provee suscripciones en tiempo real. Gestiona peticiones de upgrade en una ruta única, `/` para una API en `/api`, donde se conecta el SDK, delegando cualquier otra ruta a sus propios listeners de `upgrade`:

- Suscribirse a **cambios en tablas** — reciba notificaciones cuando cualquier fila de una tabla sea creada, actualizada o eliminada
- Suscribirse a **cambios en filas** — reciba notificaciones cuando cambie una fila específica
- Manejo automático de **reconexión** en el SDK tipado

El backend emplea `LISTEN/NOTIFY` de PostgreSQL internamente. En despliegues multi-instancia, proporcione un `connectionString` en su `PostgresBootstrapper` para permitir la difusión (broadcasting) entre instancias.

## Manejo de errores

Cada fallo — procedente de cualquier ruta, en cualquier subsistema — se devuelve en un formato estándar único:

```json
{
    "error": {
        "message": "Entity not found",
        "code": "NOT_FOUND",
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

| Campo | Siempre presente | Significado |
|-------|:----------------:|-------------|
| `message` | sí | Pensado para que lo lea una persona en consola. Describe el obstáculo, no la regla. |
| `code` | sí | En formato `SCREAMING_SNAKE_CASE` y estable. Es el campo adecuado sobre el que basar la lógica condicional. |
| `details` | no | Carga estructurada cuando el rechazo se refiere a algo en específico: una lista de rutas con errores, un conjunto de campos desconocidos. |
| `requestId` | no | Presente si la petición contenía o se le asignó uno; refleja `X-Request-ID`. Inclúyalo al reportar un error. |

El código de estado HTTP se encuentra en la respuesta, no en el cuerpo. Establezca las condiciones según `code`, no según
`message` — los mensajes están redactados para humanos y pueden modificarse en el futuro.

El SDK tipado convierte cada uno de estos errores en un `RebaseApiError` que contiene
`status`, `code` y `details` — incluyendo aquellos fallos que ni siquiera llegaron al
servidor. Una conexión rechazada, un fallo de DNS, problemas de CORS o una cancelación (abort) llegan con
`status: 0`, `code: "NETWORK_ERROR"`, reportando el error nativo del runtime en `cause`,
en lugar de cualquier error genérico con el que `fetch` decidiera rechazar la promesa. Una respuesta sin
envoltorio de error — un código 413 de un proxy, un 502 de un balanceador de carga — recibe igualmente un `code` derivado de su
estado (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), y un
cliente instanciado fuera del navegador sin `baseUrl` falla con
`BASE_URL_REQUIRED` en lugar de un error de red.
Una lectura que devuelve éxito
sin la estructura esperada — un código `204`, un cuerpo vacío, una página sin lista de `data` —
falla con `UNEXPECTED_RESPONSE` en lugar de interpretarse como "cero filas", y llamadas a
`createMany`, `updateMany`, `deleteMany` o `batch` que reciban algo distinto a
un array fallan con `INVALID_BULK_BODY`, el mismo código de error que emite el servidor ante esa situación.
De este modo, el código de la aplicación puede capturar una sola clase de excepción:

```typescript
async function setPrice(id: string, price: number) {
    try {
        return await client.data.products.update(id, { price });
    } catch (e) {
        if (e instanceof RebaseApiError && e.code === "NOT_FOUND") return null;
        throw e;
    }
}
```

## Próximos pasos

- **[Autenticación](/docs/backend/authentication)** — JWT, proveedores OAuth y OIDC, MFA, claves de API, gestión de usuarios
- **[Almacenamiento](/docs/backend/storage)** — Almacenamiento de archivos local y en S3
- **[Hooks de tabla](/docs/collections/callbacks)** — Hooks de ciclo de vida y la API `context.data`
- **[Historial de entidades](/docs/backend/history)** — Registro de auditoría
- **[Funciones personalizadas](/docs/backend/custom-functions)** — Añada endpoints de API personalizados
- **[Funciones SQL como RPC](/docs/backend/rpc)** — Ejecute una función de Postgres en `/api/rpc/<name>`, utilizando la identidad del solicitante
- **[Tareas programadas (Cron Jobs)](/docs/backend/cron-jobs)** — Tareas programadas en segundo plano
- **[Bifurcación de bases de datos (Branching)](/docs/backend/branching)** — Copias instantáneas de bases de datos para dev/staging
- **[Despliegue](/docs/getting-started/deployment)** — Lleve el backend a producción
