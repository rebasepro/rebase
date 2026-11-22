---
sourceHash: 3d3fc39a95926201
title: Descripción general del backend
sidebar_label: Backend
description: El backend de Rebase proporciona un servidor completo con API REST, autenticación, almacenamiento, tiempo real con WebSocket e historial de entidades, todo inicializado con una sola llamada a función.
---

## Descripción general

El backend de Rebase es un **servidor Node.js** construido sobre [Hono](https://hono.dev/) que proporciona:

- **API REST** — Endpoints CRUD autogenerados para cada tabla
- **Autenticación** — Tokens JWT, inicio de sesión con OAuth y OIDC, enlaces mágicos (magic links), códigos de un solo uso, MFA, claves de API, gestión de usuarios/roles
- **Almacenamiento** — Carga/descarga de archivos con sistema de archivos local o S3
- **WebSocket** — Sincronización de datos en tiempo real mediante LISTEN/NOTIFY de PostgreSQL
- **Historial de entidades** — Registro de auditoría para cada cambio de datos
- **Bifurcación de bases de datos** — Copias de bases de datos instantáneas y aisladas para desarrollo/staging/pruebas
- **Tareas Cron** — Tareas en segundo plano programadas con panel de monitorización

Todo se inicializa con una sola función:

:::note[Dónde va esto]
La siguiente llamada es lo que tiene un backend **ejected**, en `backend/src/index.ts`. En
el **runtime gestionado** no existe tal archivo: el runtime realiza la llamada y
lo configuras a través de variables de entorno, las tablas que
`backend/schema/index.ts` exporta, los recursos que declaras en `backend/resources.ts` (`database()`,
`bucket()`), y dos exportaciones que lee: `storageAuthorize` de
`backend/storage.ts` y `hooks` de `backend/hooks.ts`. Cada página de esta
sección indica cuál de los dos casos aplica a la opción que documenta, y nombra
aquellas que no tienen forma gestionada. Si exportas cualquier otra cosa de esos dos módulos,
el runtime te avisará al arrancar en lugar de descartarlo en silencio; si exportas
uno que una declaración de recursos reemplazó, el arranque lo rechazará por su nombre, con la
línea de `backend/resources.ts` que debes escribir en su lugar.
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
un atajo sobre pasos públicos: `installUnhandledRejectionHandler` evita que un
rechazo no controlado termine el proceso, `createRebaseBackend` construye el backend,
`setDefaultBackend` lo establece como aquel al que responde la API a nivel de módulo, y
`mount`, `attachRealtime` y `start` lo sirven. Para montar solo algunos grupos
de rutas, colocarlos en otras rutas, delegar los temporizadores a otro proceso o ejecutar
dos backends en un proceso, llama a los pasos tú mismo. Consulta
[Integración con servidor personalizado](/docs/backend/custom-server/).

## Dónde reside cada opción

Esa llamada es la forma **ejected** — la que escribes tú mismo después de `rebase
eject`, o en un servidor personalizado. Un proyecto generado con scaffolding no la tiene: el
runtime publicado arranca el proyecto, y cada opción llega como una variable de entorno
en `.env`, una exportación de `backend/storage.ts` o `backend/hooks.ts`,
o un directorio que el bundle declara en `rebase.json`.

Ambos caminos llegan al mismo `RebaseBackendConfig`. Este es el mapa completo.

| Opción | Runtime gestionado |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (por defecto `/api`) |
| `tables`, `schemaDir`, `defaultRls` | el directorio `backend/schema/` (la clave `tables` de `rebase.json`): las tablas y el `defaultRls` que exporta su `index.ts` |
| `rpc` | <span class="since-badge" data-since="0.35">Desde 0.35</span> las declaraciones `defineRpc` que exporta `backend/schema/index.ts` — consulta [Funciones SQL como RPC](/docs/backend/rpc/) |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, más una declaración `database("<key>")` en `backend/resources.ts` para cada base de datos adicional a la predeterminada |
| `auth` | `JWT_SECRET`, las variables `OAUTH_*`, y la tabla que `backend/schema` declara con `defineAuthTable` |
| `storage` | las variables `STORAGE_*`, más una declaración `bucket("<key>")` en `backend/resources.ts` para cada bucket adicional al predeterminado |
| `storageAuthorize` | `export const storageAuthorize` desde `backend/storage.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` desde `backend/hooks.ts` — hooks globales de tablas |
| `history` | `REBASE_HISTORY` (activado por defecto) — solo la forma booleana |
| `push` | `REBASE_PUSH`, con `REBASE_VAPID_*` para las claves — solo la forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; sin definir sirve `/api/docs` a la audiencia del endpoint de esquema, `true` lo publica con la interfaz de Swagger UI, `false` lo mantiene restringido tras el acceso de administrador |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` y sus credenciales `REBASE_LIVE_SCHEMA_*` — solo la forma de repositorio |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — consulta [Procesos divididos](/docs/deployment/split-processes/) |
| `corsHandled` | CORS es instalado por el runtime a partir de `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | la compilación (build) estampa ambos en el bundle |
| `app`, `server`, `provisioningDriverResult` | el runtime los crea |

### Opciones sin ruta gestionada

Estas no tienen variable de entorno ni exportación de módulo. Solo son accesibles
desde una llamada escrita a mano a `initializeRebaseBackend` — `rebase eject` o un
[servidor personalizado](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` en su forma de objeto (`{ retention }`) ·
`push` en su forma de objeto (`{ allowedHosts, sender, vapid }`)

`schemaEditor` se desactiva obligatoriamente en un bundle compilado: el editor reescribe los
archivos *fuente* de `backend/schema`, y un bundle contiene la salida compilada.

## Qué se crea

Tras la inicialización, se montan estas rutas:

| Ruta | Propósito |
|------|-----------|
| `/api/auth/*` | Autenticación (registro, inicio de sesión, actualización/refresh, OAuth, magic links, códigos de un solo uso, MFA) |
| `/api/admin/*` | Usuarios, roles, claves de servicio, cron, copias de seguridad, logs y esquema, cada uno tras su propio [ámbito (scope)](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Subida, descarga y eliminación de archivos |
| `/api/data/:slug` | Operaciones CRUD por tabla (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Historial de cambios de entidades (cuando está habilitado) |
| `/api/docs` | Especificación OpenAPI de las tablas que el solicitante puede ver (pública con `enableSwagger: true`; solo para administradores con `false`) |
| `/api/swagger` | Swagger UI (con `enableSwagger: true`, solo fuera de producción) |
| `/api/schema/tables` | Las tablas que sirve este backend, según lo que el solicitante pueda ver — consulta [Endpoints](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | La versión del esquema, el runtime y cada tabla como los ve un administrador (requiere `schema:read`) |
| `/api/meta/schema-version` | Una cadena de versión para ese esquema (sin autenticación) |
| `/api/rpc/:name` | <span class="since-badge" data-since="0.35">Desde 0.35</span> Las funciones SQL declaradas con `defineRpc`, ejecutadas en nombre del solicitante — consulta [Funciones SQL como RPC](/docs/backend/rpc/) |
| `/api/functions/*` | Rutas de funciones personalizadas (cuando `functions` o `functionsDir` están configurados) |
| `/api/push/*` | Suscripciones a [notificaciones push](/docs/backend/push-notifications/) (cuando `push` está activado) |
| `/api/admin/cron/*` | Gestión de tareas cron (`cron:read` / `cron:write`, cuando `crons` o `cronsDir` están configurados) |
| WebSocket al actualizar conexión (upgrade) | Suscripciones en tiempo real, en `/` para una API en `/api` |

---

## El ciclo de vida de inicialización

Cuando invocas `initializeRebaseBackend()`, el framework desencadena una secuencia de arranque secuencial de 5 etapas:

```
[Start Boot]
     │
     ▼
1. Configuration (the database adapter, the auth and storage options you passed)
     │
     ▼
2. Schema Loading (imports backend/schema/index.ts, compiles every table — a problem in any refuses the boot)
     │
     ▼
3. Database Bootstrapping (creates schemas/auth/helper SQL functions, as `provision` allows)
     │
     ▼
4. Service Initialization (Auth, Storage S3/Local client instances, Cron store seeding)
     │
     ▼
5. Route Mounting & Edge Loading (Hono controllers, custom functions, WebSocket binding)
     │
     ▼
[Boot Complete]
```

---

## Qué sucede cuando falla el arranque

**El arranque falla ruidosamente.** Si no se puede acceder a la base de datos, las credenciales son
incorrectas o el esquema no se puede compilar o aplicar, `initializeRebaseBackend`
lanza un error (throws), no se sirve nada y el proceso termina con código `1`. No hay modo degradado
ni servidor parcial: un contenedor que no puede comunicarse con su base de datos se reinicia, y
el error que causó su terminación es lo último en sus logs.

Esto es deliberado. Un servidor que se inicia respondiendo al inicio de sesión mientras todas
las rutas `/api/data/*` fallan es mucho más difícil de diagnosticar que uno que nunca llega a
levantarse — y un orquestador puede actuar ante un bucle de fallos (crash loop).

Antes de la primera consulta, el arranque sondea la conexión e imprime el diagnóstico: el
host y puerto a los que no pudo acceder, el motivo propio del controlador (driver) (`ECONNREFUSED`,
`password authentication failed for user "app"`), y la solución. Consulta
[Solución de problemas](/docs/troubleshooting/) para ver la lista fallo por fallo.

### Una vez en funcionamiento: `/livez` y `/health`

Dos sondas que responden a dos preguntas diferentes.

| Ruta | Accede a la base de datos | Respuesta |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` mientras el proceso esté en ejecución. Úsala para una sonda de liveness. |
| `/health` | Sí, cada fuente de datos | `200 {"status":"ok"}` cuando cada fuente de datos configurada responde; `503 {"status":"degraded"}` cuando una no lo hace. Úsala para una sonda de readiness. |

Configurar una sonda de liveness en `/health` es un error que vale la pena mencionar: un fallo momentáneo
de la base de datos haría que el orquestador mate un proceso que de otro modo estaría sano,
convirtiendo una breve interrupción en un bucle de reinicios.

`/health` no requiere autenticación, por lo que publica el veredicto y no el motivo —
fuera del entorno de desarrollo solo indica qué fuente de datos está degradada y nada más. El
texto de error del driver cita el host, el puerto, el nombre de la base de datos y el rol, y eso va
a los logs. `/health` también se sirve bajo `basePath` (`/api/health`);
`/livez` no.

Ambas sondas pertenecen al runtime gestionado. Un `backend/src/index.ts` expulsado (ejected) sirve
`/health` y `/api/health` por sí mismo, sondeando solo la base de datos predeterminada, y
no tiene `/livez` hasta que agregues una.

---

## Referencia de configuración

<span class="since-badge" data-since="0.35">Desde 0.35</span> La opción `rpc` a continuación.

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

Cinco de ellas son fáciles de pasar por alto y cambian comportamientos que, de otro modo, solo podrías
observar:

| Clave | Por defecto | Qué hace |
|---|---|---|
| `compression` | `true` | gzip/deflate en respuestas de la API, negociado desde `Accept-Encoding`. Los cuerpos ya comprimidos, transmitidos por streaming o con `no-transform` no se modifican, al igual que los cuerpos de menos de 1 KB (gzip cuesta más de lo que ahorra en esos casos), por lo que es seguro dejarlo activado — una lista JSON grande suele reducirse aproximadamente 20 veces. Establécelo en `false` cuando nginx, Cloudflare u otro proxy intermedio ya aplique compresión, para evitar pagar el coste dos veces. Variable de entorno: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Límite máximo para cuerpos de solicitud en rutas de API; `0` lo deshabilita. Las subidas de almacenamiento usan el `maxFileSize` propio de la configuración de almacenamiento (50MB), que prevalece para esas rutas. Variable de entorno: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | desactivado | **Opcional (opt-in).** Una API de BaaS es llamada por aplicaciones móviles, SPAs en otros dominios y herramientas de CLI, ninguna de las cuales envía un `Origin` que una lista fija aceptaría — por lo que no está activado por defecto. Actívalo indicando los orígenes que utilizan tus clientes web. Sin variable de entorno: haz eject para configurarlo. |
| `cronPersistence` | `true` | Determina si los registros de ejecución llegan a `rebase.cron_logs`. `false` mantiene las tareas en ejecución y el historial solo en memoria, lo que hace que el panel de Studio lo pierda tras un reinicio. |
| `schemaEditor` | activado fuera de producción, cuando `schemaDir` está configurado | Fuerza la activación o desactivación de las rutas del editor de esquemas. El editor reescribe los *archivos fuente* de `backend/schema`, por lo que necesita un directorio donde escribir — y un bundle compilado no tiene ninguno, razón por la cual un despliegue nunca lo incluye. |

El resto de `RebaseBackendConfig` está documentado en su propia página (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) o marcado como `@internal`:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` y `runtimeVersion` son completados por
`bootFromBundle` a partir del entorno, y pasarlos manualmente es una forma de
contradecir al runtime sobre lo que es este proceso.

## La instancia del backend

`initializeRebaseBackend` devuelve el backend que construyó, ya montado e
iniciado. Su tipo es `RebaseBackendInstance`, que es `RebaseBackend`, el
tipo que devuelve `createRebaseBackend`:

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

También contiene
`rebase`, el cliente en proceso, `fetch(request)`, `routes`, los grupos de rutas
como subaplicaciones de Hono, `services`, sus propias claves JWT, modelo de acceso, almacén de claves de API y
limitadores de tasa (rate limiters), y `verifyCredential(token)`; consulta
[Integración con servidor personalizado](/docs/backend/custom-server/).

> **Nota:** Aunque `instance` expone estos servicios internos, el código de la aplicación (como funciones personalizadas y tareas cron) debe usar el singleton `rebase` de `@rebasepro/server` para interactuar con la API del backend. Dentro de una solicitud, ejecución de cron o tarea, `rebase` es el backend que la atiende; en otros lugares es el valor predeterminado del proceso, que `initializeRebaseBackend` establece en su backend.

## API REST

La API REST se genera a partir de tus tablas. Cada tabla obtiene estos endpoints:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Listar entidades — el filtrado, la ordenación, la paginación y la búsqueda son parámetros de consulta |
| `GET` | `/api/data/:slug/count` | Cuántas filas coinciden con la misma consulta |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opcionalmente agrupados |
| `GET` | `/api/data/:slug/:id` | Obtener una sola entidad |
| `POST` | `/api/data/:slug` | Crear una nueva entidad |
| `PATCH` | `/api/data/:slug/:id` | Actualizar los campos enviados |
| `DELETE` | `/api/data/:slug/:id` | Eliminar un registro |
| `POST` | `/api/data/:slug/bulk` | Crear varias filas en una sola transacción |
| `PATCH` | `/api/data/:slug/bulk` | Actualizar varias filas en una sola transacción |
| `POST` | `/api/data/:slug/bulk/delete` | Eliminar varias filas en una sola transacción |

### Parámetros de consulta

Existe una referencia completa para ellos y no es esta página. [API
REST](/docs/backend/api/) documenta ambos dialectos de consulta que acepta el servidor — el
formato al estilo PostgREST `?column=op.value` y el formato JSON `?where=` — junto con
`orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` y búsqueda
vectorial. [Endpoints](/docs/backend/endpoints/) es el índice de cada ruta que
monta el servidor, incluidas las generadas.

Un parámetro que el servidor no reserve se interpreta como un filtro en la columna con
ese nombre, por lo que uno inventado no falla: simplemente no coincide con nada de forma silenciosa.

## WebSocket

El servidor WebSocket se adjunta al mismo servidor HTTP y proporciona suscripciones en tiempo real. Responde a las actualizaciones de conexión (upgrades) en una sola ruta, `/` para una API en `/api`, que es donde se conecta el SDK, y deja cualquier otra ruta para tus propios listeners de `upgrade`:

- Suscribirse a **cambios en tablas** — recibir notificaciones cuando se cree, actualice o elimine cualquier fila de una tabla
- Suscribirse a **cambios en filas** — recibir notificaciones cuando cambie una fila específica
- Gestión automática de **reconexión** en el SDK tipado

El backend utiliza `LISTEN/NOTIFY` de PostgreSQL internamente. Para despliegues con múltiples instancias, proporciona un `connectionString` en tu `PostgresBootstrapper` para habilitar la difusión entre instancias.

## Manejo de errores

Cada fallo — desde cualquier ruta, en cualquier subsistema — se devuelve en una única estructura:

```json
{
    "error": {
        "message": "Entity not found",
        "code": "NOT_FOUND",
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

| Campo | Siempre presente | Qué es |
|-------|:----------------:|--------|
| `message` | sí | Escrito para una persona que lee una consola. Nombra el obstáculo, no la regla. |
| `code` | sí | `SCREAMING_SNAKE_CASE` y estable. Este es el campo sobre el que aplicar condicionales o bifurcaciones. |
| `details` | no | Carga útil (payload) estructurada cuando el rechazo es *sobre* algo — una lista de rutas fallidas, un conjunto de campos desconocidos. |
| `requestId` | no | Presente cuando la solicitud incluía uno o se le asignó; refleja `X-Request-ID`. Indícalo en un informe de errores. |

El estado HTTP se encuentra en la respuesta, no en el cuerpo. Aplica lógica condicional según `code`, no según
`message` — los mensajes están escritos para humanos y están sujetos a cambios.

El SDK tipado convierte cada uno de estos en un `RebaseApiError` que contiene
`status`, `code` y `details` — incluidos los fallos que nunca llegaron al
servidor. Una conexión rechazada, un fallo de DNS, CORS o una cancelación (abort) llegan como
`status: 0`, `code: "NETWORK_ERROR"`, con el propio error del runtime en `cause`,
en lugar de lo que a `fetch` le haya parecido rechazar. Una respuesta sin estructura de error
— un 413 de un proxy, un 502 de un balanceador de carga — aún así obtiene un `code` a partir de su
estado (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), y un
cliente construido fuera de un navegador sin `baseUrl` falla con
`BASE_URL_REQUIRED` en lugar de con un error de red.
Una lectura que recibe una respuesta exitosa
pero sin el formato esperado — un `204`, un cuerpo vacío, una página sin lista
`data` — falla con `UNEXPECTED_RESPONSE` en lugar de resolverse como "sin filas", y
`createMany`, `updateMany`, `deleteMany` o `batch` que reciban algo distinto a
un array fallan con `INVALID_BULK_BODY`, el código que utiliza el servidor para el mismo
error. De esta forma, el código de la aplicación solo captura una clase:

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

- **[Autenticación](/docs/backend/authentication)** — Proveedores JWT, OAuth y OIDC, MFA, claves de API, gestión de usuarios
- **[Almacenamiento](/docs/backend/storage)** — Almacenamiento de archivos local y en S3
- **[Hooks de tablas](/docs/collections/callbacks)** — Hooks del ciclo de vida y la API `context.data`
- **[Historial de entidades](/docs/backend/history)** — Registro de auditoría
- **[Funciones personalizadas](/docs/backend/custom-functions)** — Agregar endpoints de API personalizados
- **[Funciones SQL como RPC](/docs/backend/rpc)** — Invocar una función de Postgres en `/api/rpc/<name>`, en nombre del solicitante
- **[Tareas Cron](/docs/backend/cron-jobs)** — Tareas programadas en segundo plano
- **[Bifurcación de bases de datos](/docs/backend/branching)** — Copias instantáneas de bases de datos para dev/staging
- **[Despliegue](/docs/getting-started/deployment)** — Llevar el backend a producción
