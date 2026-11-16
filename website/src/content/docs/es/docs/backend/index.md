---
sourceHash: e399d82e853d3169
title: Visión general del backend
sidebar_label: Backend
description: El backend de Rebase proporciona un servidor completo con API REST, autenticación, almacenamiento, tiempo real con WebSocket e historial de entidades — todo inicializado con una única llamada a función.
---

## Visión general

El backend de Rebase es un **servidor Node.js** construido sobre [Hono](https://hono.dev/) que proporciona:

- **API REST** — Endpoints CRUD autogenerados para cada tabla
- **Autenticación** — Tokens JWT, inicio de sesión con OAuth y OIDC, enlaces mágicos (magic links), códigos de un solo uso, MFA, claves de API, gestión de usuarios y roles
- **Almacenamiento** — Subida y descarga de archivos con sistema de archivos local o S3
- **WebSocket** — Sincronización de datos en tiempo real mediante PostgreSQL LISTEN/NOTIFY
- **Historial de entidades** — Registro de auditoría para cada cambio de datos
- **Ramificación de base de datos (Branching)** — Copias de base de datos instantáneas y aisladas para desarrollo, staging y pruebas
- **Tareas programadas (Cron Jobs)** — Tareas en segundo plano programadas con panel de monitorización

Todo se inicializa con una sola función:

:::note[Dónde va esto]
La llamada siguiente es lo que contiene un backend **expulsado (ejected)**, en `backend/src/index.ts`. En
el **runtime administrado** no existe tal archivo: el runtime realiza la llamada y
usted lo configura a través de variables de entorno, las tablas que exporta
`backend/schema/index.ts`, los recursos que declara en `backend/resources.ts` (`database()`,
`bucket()`), y dos exportaciones que lee: `storageAuthorize` de
`backend/storage.ts` y `hooks` de `backend/hooks.ts`. Cada página de esta
sección indica cuál de las dos opciones se aplica a la configuración que documenta y nombra
aquellas que no tienen forma administrada. Si exporta cualquier otra cosa desde esos dos módulos,
el runtime le advertirá durante el arranque en lugar de ignorarlo en silencio; si exporta una
que una declaración de recurso haya reemplazado, el arranque la rechazará por su nombre, indicando la
línea de `backend/resources.ts` que debe escribir en su lugar.
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
dos backends en un mismo proceso, invoque los pasos usted mismo. Consulte
[Integración de servidor personalizado](/docs/backend/custom-server/).

## Dónde reside cada opción

Esa llamada es la forma **ejected** — la que usted escribe manualmente tras `rebase
eject` o en un servidor personalizado. Un proyecto generado inicialmente no la tiene: el
runtime publicado arranca el proyecto y cada opción llega como una variable de entorno
en `.env`, una exportación desde `backend/storage.ts` o `backend/hooks.ts`,
o un directorio que el bundle declara en `rebase.json`.

Ambas vías conducen al mismo `RebaseBackendConfig`. Este es el mapa completo.

| Opción | Runtime administrado |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (por defecto `/api`) |
| `tables`, `schemaDir`, `defaultRls` | el directorio `backend/schema/` (la clave `tables` de `rebase.json`): las tablas y el `defaultRls` que exporta su `index.ts` |
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
| `hooks` | `export const hooks` desde `backend/hooks.ts` — hooks globales de tabla |
| `history` | `REBASE_HISTORY` (activado por defecto) — solo la forma booleana |
| `push` | `REBASE_PUSH`, con `REBASE_VAPID_*` para las claves — solo la forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; si no se define, sirve `/api/docs` a la audiencia del endpoint de schema; `true` lo publica con la Swagger UI; `false` lo mantiene protegido tras la barrera de administrador |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` y sus credenciales `REBASE_LIVE_SCHEMA_*` — solo la forma de repositorio |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — consulte [Procesos divididos](/docs/deployment/split-processes/) |
| `corsHandled` | El runtime instala CORS a partir de `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | la compilación estampa ambos en el bundle |
| `app`, `server`, `provisioningDriverResult` | el runtime los crea |

### Opciones sin ruta administrada

Estas no tienen variable de entorno ni exportación de módulo. Solo son accesibles
desde una llamada escrita a mano a `initializeRebaseBackend` — `rebase eject` o un
[servidor personalizado](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` en su forma de objeto (`{ retention }`) ·
`push` en su forma de objeto (`{ allowedHosts, sender, vapid }`)

`schemaEditor` se desactiva de forma forzada en un bundle compilado: el editor reescribe
los archivos *fuente* de `backend/schema`, y un bundle contiene la salida compilada.

## Qué se crea

Tras la inicialización, se montan estas rutas:

| Ruta | Propósito |
|------|-----------|
| `/api/auth/*` | Autenticación (registro, inicio de sesión, actualización/refresh, OAuth, magic links, códigos de un solo uso, MFA) |
| `/api/admin/*` | Usuarios, roles, claves de servicio, cron, copias de seguridad, registros (logs) y esquema, cada uno tras su propio [ámbito (scope)](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Subida, descarga y eliminación de archivos |
| `/api/data/:slug` | Operaciones CRUD por tabla (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Historial de cambios de la entidad (cuando está habilitado) |
| `/api/docs` | Especificación OpenAPI de las tablas que el emisor de la petición puede ver (pública con `enableSwagger: true`; solo para administradores con `false`) |
| `/api/swagger` | Swagger UI (con `enableSwagger: true`, únicamente fuera de producción) |
| `/api/schema/tables` | Las tablas que sirve este backend, tal como las puede ver el emisor de la petición — consulte [Endpoints](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | La versión del esquema, el runtime y cada tabla como los ve un administrador (requiere `schema:read`) |
| `/api/meta/schema-version` | Una cadena de versión para dicho esquema (sin autenticación) |
| `/api/functions/*` | Rutas de funciones personalizadas (cuando `functions` o `functionsDir` está configurado) |
| `/api/push/*` | Suscripciones a [notificaciones push](/docs/backend/push-notifications/) (cuando `push` está activo) |
| `/api/admin/cron/*` | Gestión de tareas cron (`cron:read` / `cron:write`, cuando `crons` o `cronsDir` está configurado) |
| WebSocket en upgrade | Suscripciones en tiempo real, en `/` para una API en `/api` |

---

## El ciclo de vida de inicialización

Al invocar `initializeRebaseBackend()`, el framework activa una secuencia de arranque secuencial de 5 etapas:

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

## Qué ocurre cuando el arranque falla

**El arranque falla de forma ruidosa.** Si no se puede acceder a la base de datos, las credenciales
son incorrectas o el esquema no se puede compilar o aplicar, `initializeRebaseBackend`
lanza un error (throws), no se sirve nada y el proceso termina con código `1`. No hay modo degradado
ni servidor parcial: un contenedor que no puede comunicarse con su base de datos se reinicia, y
el error que lo detuvo es lo último que aparece en sus logs.

Esto es deliberado. Un servidor que se inicia respondiendo al inicio de sesión mientras todas las
rutas `/api/data/*` fallan es mucho más difícil de diagnosticar que uno que nunca llega a
iniciarse — y un orquestador puede actuar ante un bucle de fallos continuos (crash loop).

Antes de la primera consulta, el arranque sondea la conexión e imprime el diagnóstico: el
host y el puerto a los que no pudo conectarse, el motivo propio del controlador (`ECONNREFUSED`,
`password authentication failed for user "app"`) y la solución. Consulte
[Resolución de problemas](/docs/troubleshooting/) para ver la lista fallo por fallo.

### Una vez en funcionamiento: `/livez` y `/health`

Dos sondas que responden a dos preguntas distintas.

| Ruta | Accede a la base de datos | Responde |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` mientras el proceso se esté ejecutando. Utilícelo como liveness probe. |
| `/health` | Sí, cada fuente de datos | `200 {"status":"ok"}` cuando todas las fuentes de datos configuradas responden; `503 {"status":"degraded"}` cuando alguna no lo hace. Utilícelo como readiness probe. |

Configurar un liveness probe en `/health` es un error que vale la pena mencionar: una interrupción momentánea de la base de datos
haría que el orquestador elimine un proceso que por lo demás es saludable, convirtiendo un corte breve
en un bucle de reinicios.

`/health` no requiere autenticación, por lo que publica el veredicto y no el motivo —
fuera de entornos de desarrollo solo indica qué fuente de datos está degradada y nada más. El
texto del error del controlador cita el host, el puerto, el nombre de la base de datos y el rol, y eso va
a los logs. `/health` también se sirve bajo `basePath` (`/api/health`);
`/livez` no.

Ambas sondas pertenecen al runtime administrado. Un archivo `backend/src/index.ts` expulsado (ejected) sirve
`/health` y `/api/health` por sí mismo, sondeando únicamente la base de datos predeterminada, y no tiene
`/livez` hasta que usted añada uno.

---

## Referencia de configuración

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

Cinco de ellas son fáciles de pasar por alto y modifican un comportamiento que de otro modo solo se podría
observar:

| Clave | Por defecto | Qué hace |
|---|---|---|
| `compression` | `true` | gzip/deflate en las respuestas de la API, negociado a partir de `Accept-Encoding`. Los cuerpos ya comprimidos, transmitidos por streaming o con `no-transform` no se modifican, al igual que los cuerpos de menos de 1 KB (gzip cuesta más de lo que ahorra en esos casos), por lo que es seguro dejarlo activo — una lista JSON grande suele reducirse aproximadamente unas 20 veces. Establezca `false` cuando nginx, Cloudflare u otro proxy intermedio ya aplique compresión, para evitar pagar el costo dos veces. Variable de entorno: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Límite máximo para el cuerpo de las peticiones en rutas de la API; `0` lo deshabilita. Las subidas de almacenamiento utilizan el `maxFileSize` propio de la configuración de almacenamiento (50MB), que prevalece en dichas rutas. Variable de entorno: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | desactivado | **Opcional (Opt-in).** Una API de BaaS es llamada por aplicaciones móviles, SPAs en otros dominios y herramientas de CLI, ninguna de las cuales envía un `Origin` que una lista fija aceptaría — por lo que no está habilitado por defecto. Actívelo especificando los orígenes que utilizan sus clientes de navegador. No tiene formato de variable de entorno: expulse (eject) para configurarlo. |
| `cronPersistence` | `true` | Determina si los logs de ejecución llegan a `rebase.cron_logs`. `false` mantiene las tareas en ejecución y el historial solo en memoria, perdiéndose en el panel de Studio al reiniciar. |
| `schemaEditor` | activo fuera de producción, cuando `schemaDir` está definido | Fuerza la activación o desactivación de las rutas del editor de esquemas. El editor reescribe los *archivos fuente* de `backend/schema`, por lo que necesita un directorio en el que escribir — y un bundle compilado no tiene ninguno, razón por la cual un despliegue nunca lo incluye. |

El resto de `RebaseBackendConfig` está documentado en su propia página (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) o marcado como `@internal`:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` y `runtimeVersion` son completados por
`bootFromBundle` a partir del entorno, y pasarlos manualmente es una forma de
entrar en conflicto con el runtime sobre la naturaleza de este proceso.

## La instancia del backend

`initializeRebaseBackend` devuelve el backend que ha construido, ya montado e
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

También incluye
`rebase`, el cliente en proceso, `fetch(request)`, `routes`, los grupos de rutas
como subaplicaciones de Hono, `services`, sus propias claves JWT, modelo de acceso, almacén de claves de API y
limitadores de tasa (rate limiters), y `verifyCredential(token)`; consulte
[Integración de servidor personalizado](/docs/backend/custom-server/).

> **Nota:** Aunque la `instance` expone estos servicios internos, el código de la aplicación (como funciones personalizadas y tareas cron) debe utilizar el singleton `rebase` de `@rebasepro/server` para interactuar con la API del backend. Dentro de una petición, ejecución de cron o job, `rebase` es el backend que lo atiende; en cualquier otro lugar es el predeterminado del proceso, que `initializeRebaseBackend` asigna a su propio backend.

## API REST

La API REST se genera a partir de sus tablas. Cada tabla obtiene estos endpoints:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Lista entidades — filtrado, ordenación, paginación y búsqueda son parámetros de consulta |
| `GET` | `/api/data/:slug/count` | Cuántas filas coinciden con la misma consulta |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opcionalmente agrupados |
| `GET` | `/api/data/:slug/:id` | Obtiene una entidad individual |
| `POST` | `/api/data/:slug` | Crea una nueva entidad |
| `PATCH` | `/api/data/:slug/:id` | Actualiza los campos que envíe |
| `DELETE` | `/api/data/:slug/:id` | Elimina un registro |
| `POST` | `/api/data/:slug/bulk` | Crea múltiples filas en una sola transacción |
| `PATCH` | `/api/data/:slug/bulk` | Actualiza múltiples filas en una sola transacción |
| `POST` | `/api/data/:slug/bulk/delete` | Elimina múltiples filas en una sola transacción |

### Parámetros de consulta

Existe una referencia dedicada para ellos y no es esta página. [API
REST](/docs/backend/api/) documenta ambos dialectos de consulta que acepta el servidor — la
forma al estilo PostgREST `?column=op.value` y la forma JSON `?where=` — junto con
`orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` y búsqueda
vectorial. [Endpoints](/docs/backend/endpoints/) es el índice de todas las rutas que
monta el servidor, incluidas las generadas.

Cualquier parámetro que el servidor no reserve se interpreta como un filtro en la columna con
ese nombre, por lo que uno inventado no produce un error: simplemente no coincidirá con nada en silencio.

## WebSocket

El servidor WebSocket se acopla al mismo servidor HTTP y proporciona suscripciones en tiempo real. Responde a las actualizaciones (upgrades) en una única ruta, `/` para una API en `/api`, a donde se conecta el SDK, y deja cualquier otra ruta a sus propios listeners de `upgrade`:

- Suscripción a **cambios en tablas** — reciba notificaciones cuando cualquier fila de una tabla se cree, actualice o elimine
- Suscripción a **cambios en filas** — reciba notificaciones cuando cambie una fila específica
- Gestión automática de la **reconexión** en el SDK con tipos

El backend utiliza PostgreSQL `LISTEN/NOTIFY` internamente. Para despliegues con múltiples instancias, proporcione una `connectionString` en su `PostgresBootstrapper` para habilitar la difusión entre instancias.

## Gestión de errores

Cada fallo — de cualquier ruta, en cualquier subsistema — se devuelve en una única estructura envolvente (envelope):

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
| `message` | sí | Redactado para una persona que lee una consola. Nombra el obstáculo, no la regla. |
| `code` | sí | `SCREAMING_SNAKE_CASE` y estable. Este es el campo a evaluar para ramificar la lógica. |
| `details` | no | Carga útil estructurada cuando el rechazo trata *sobre* algo concreto — una lista de rutas que fallan, un conjunto de campos desconocidos. |
| `requestId` | no | Presente cuando la petición transportaba o se le asignó uno; refleja `X-Request-ID`. Cítelo en un reporte de error. |

El estado HTTP está en la respuesta, no en el cuerpo. Ramifique la lógica según `code`, no según
`message` — los mensajes están escritos para humanos y pueden cambiar con libertad.

El SDK con tipos convierte cada uno de estos en un `RebaseApiError` que transporta
`status`, `code` y `details` — incluidos los fallos que nunca llegaron al
servidor. Una conexión rechazada, un fallo de DNS, CORS o un aborto se reciben como
`status: 0`, `code: "NETWORK_ERROR"`, con el error propio del runtime en `cause`,
en lugar de cualquier error con el que `fetch` decidiera rechazar. Una respuesta sin
envolvente — un 413 de un proxy, un 502 de un balanceador de carga — aún así obtiene un `code` a partir de su
código de estado (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), y un
cliente creado fuera de un navegador sin `baseUrl` falla con
`BASE_URL_REQUIRED` en lugar de un error de red.
Una lectura que obtiene una respuesta exitosa
pero sin la forma esperada — un `204`, un cuerpo vacío, una página sin lista
`data` — falla con `UNEXPECTED_RESPONSE` en lugar de resolverse como "sin filas", y
al pasar a `createMany`, `updateMany`, `deleteMany` o `batch` algo distinto a
un array, falla con `INVALID_BULK_BODY`, el código que utiliza el servidor para el mismo
error. Por lo tanto, el código de la aplicación captura una sola clase:

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
- **[Hooks de tabla](/docs/collections/callbacks)** — Hooks del ciclo de vida y la API `context.data`
- **[Historial de entidades](/docs/backend/history)** — Registro de auditoría
- **[Funciones personalizadas](/docs/backend/custom-functions)** — Añadir endpoints de API personalizados
- **[Tareas programadas (Cron Jobs)](/docs/backend/cron-jobs)** — Tareas programadas en segundo plano
- **[Ramificación de base de datos (Branching)](/docs/backend/branching)** — Copias instantáneas de bases de datos para dev/staging
- **[Despliegue](/docs/getting-started/deployment)** — Lleve el backend a producción
