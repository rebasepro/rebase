---
sourceHash: 9be8187c5259c1dd
title: Visión general del Backend
sidebar_label: Backend
description: El backend de Rebase proporciona un servidor completo con API REST, autenticación, almacenamiento, tiempo real mediante WebSocket e historial de entidades — todo inicializado con una única llamada a función.
---

## Visión general

El backend de Rebase es un **servidor Node.js** construido sobre [Hono](https://hono.dev/) que ofrece:

- **API REST** — Endpoints CRUD autogenerados para cada tabla
- **Autenticación** — Tokens JWT, inicio de sesión mediante OAuth y OIDC, magic links, códigos de un solo uso, MFA, claves de API, gestión de usuarios/roles
- **Almacenamiento** — Subida/descarga de archivos con sistema de archivos local o S3
- **WebSocket** — Sincronización de datos en tiempo real mediante LISTEN/NOTIFY de PostgreSQL
- **Historial de entidades** — Registro de auditoría para cada cambio en los datos
- **Bifurcación de base de datos (Database Branching)** — Copias de base de datos instantáneas y aisladas para desarrollo/staging/pruebas
- **Tareas Cron** — Tareas programadas en segundo plano con panel de monitorización

Todo se inicializa con una única función:

:::note[Dónde va esto]
La llamada que se muestra a continuación es la que tiene un backend **expulsado (ejected)**, en `backend/src/index.ts`. En
el **runtime administrado** no existe tal archivo: el runtime realiza la llamada y
usted lo configura mediante variables de entorno, las tablas que
`backend/schema/index.ts` exporta, los recursos que declara en `backend/resources.ts` (`database()`,
`bucket()`) y dos exportaciones que este lee: `storageAuthorize` de
`backend/storage.ts` y `hooks` de `backend/hooks.ts`. Cada página de esta
sección indica cuál de los dos casos aplica a la opción que documenta, y nombra
aquellas que no tienen una forma administrada. Si exporta cualquier otra cosa desde esos dos módulos,
el runtime le advertirá durante el arranque en lugar de omitirlo silenciosamente; si exporta uno
que haya sido reemplazado por una declaración de recurso, el arranque lo rechazará por su nombre, indicando
la línea a escribir en `backend/resources.ts` en su lugar.
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
un atajo que engloba pasos públicos: `installUnhandledRejectionHandler` evita que un
rejection suelto detenga el proceso, `createRebaseBackend` construye el backend,
`setDefaultBackend` lo establece como aquel al que responde la API a nivel de módulo, y
`mount`, `attachRealtime` y `start` se encargan de servirlo. Para montar solo algunos grupos
de rutas, colocarlos en otras rutas, delegar los temporizadores a otro proceso o ejecutar
dos backends en un único proceso, invoque los pasos manualmente. Consulte
[Integración en servidor personalizado](/docs/backend/custom-server/).

## Dónde reside cada opción

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Esa llamada corresponde a la estructura **expulsada (ejected)** — la que usted mismo escribe tras ejecutar `rebase
eject` o en un servidor personalizado. Un proyecto generado automáticamente no la incluye: el
runtime publicado arranca el proyecto, y cada opción llega en forma de variable de entorno
en `.env`, una exportación desde `backend/storage.ts` o `backend/hooks.ts`,
o un directorio que el bundle declara en `rebase.json`.

Ambas vías conducen a la misma `RebaseBackendConfig`. Este es el mapa completo.

| Opción | Runtime administrado |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (por defecto `/api`) |
| `tables`, `schemaDir`, `defaultRls` | el directorio `backend/schema/` (la clave `tables` de `rebase.json`): las tablas y el `defaultRls` que su `index.ts` exporta |
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
| `history` | `REBASE_HISTORY` (habilitado por defecto) — solo la forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; si no se define, sirve `/api/docs` a la audiencia del endpoint de schema; `true` lo publica con la interfaz Swagger UI; `false` lo mantiene restringido a administradores |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` y sus credenciales `REBASE_LIVE_SCHEMA_*` — solo la forma de repositorio |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — consulte [Procesos divididos](/docs/deployment/split-processes/) |
| `corsHandled` | El runtime instala CORS a partir de `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | el proceso de compilación estampa ambos en el bundle |
| `app`, `server`, `provisioningDriverResult` | el runtime los crea |

### Opciones sin ruta administrada

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Estas no disponen de variable de entorno ni de exportación de módulo. Solo son accesibles
mediante una llamada manual a `initializeRebaseBackend` — a través de `rebase eject` o en un
[servidor personalizado](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` en su forma de objeto (`{ retention }`)

`schemaEditor` se desactiva obligatoriamente en un bundle compilado: el editor reescribe los
archivos *fuente* de `backend/schema`, y un bundle contiene la salida compilada.

## Qué se crea

Tras la inicialización, se montan las siguientes rutas:

| Ruta | Propósito |
|------|-----------|
| `/api/auth/*` | Autenticación (registro, login, refresco, OAuth, magic links, códigos de un solo uso, MFA) |
| `/api/admin/*` | Usuarios, roles, claves de servicio, cron, copias de seguridad, logs y schema, cada uno protegido por su propio [ámbito (scope)](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Subida, descarga y eliminación de archivos |
| `/api/data/:slug` | Operaciones CRUD por tabla (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Historial de cambios de entidades (cuando está habilitado) |
| `/api/docs` | Especificación OpenAPI de las tablas que el invocador tiene permiso de ver (pública con `enableSwagger: true`; solo administradores con `false`) |
| `/api/swagger` | Swagger UI (con `enableSwagger: true`, únicamente fuera de producción) |
| `/api/schema/tables` | Las tablas que sirve este backend, según lo que el invocador pueda ver — consulte [Endpoints](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | La versión del schema, el runtime y cada tabla tal como los ve un administrador (requiere `schema:read`) |
| `/api/meta/schema-version` | Cadena de versión para dicho schema (sin autenticación) |
| `/api/functions/*` | Rutas de funciones personalizadas (cuando `functions` o `functionsDir` está configurado) |
| `/api/admin/cron/*` | Gestión de tareas cron (`cron:read` / `cron:write`, cuando `crons` o `cronsDir` está configurado) |
| WebSocket en upgrade | Suscripciones en tiempo real, en `/` para una API en `/api` |

---

## El ciclo de vida de la inicialización

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Al invocar `initializeRebaseBackend()`, el framework ejecuta una secuencia de arranque secuencial de 5 fases:

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

## Qué ocurre cuando falla el arranque

**El arranque falla de forma contundente (loudly).** Si la base de datos es inaccesible, las credenciales son
incorrectas, o el schema no se puede compilar o aplicar, `initializeRebaseBackend`
lanza una excepción, no se sirve nada y el proceso termina con código de salida `1`. No hay modo degradado
ni servidor parcial: un contenedor que no puede comunicarse con su base de datos se reinicia, y
el error que provocó su caída será lo último que aparezca en sus logs.

Esto es deliberado. Un servidor que arranca respondiendo a inicios de sesión mientras todas las
rutas `/api/data/*` fallan resulta mucho más difícil de diagnosticar que uno que nunca llega a
levantarse — y un orquestador puede intervenir ante un bucle de caídas (crash loop).

Antes de la primera consulta, el arranque comprueba la conexión e imprime el diagnóstico: el
host y el puerto a los que no pudo acceder, el motivo propio del driver (`ECONNREFUSED`,
`password authentication failed for user "app"`) y la solución. Consulte
[Resolución de problemas](/docs/troubleshooting/) para ver la lista fallo por fallo.

### Una vez en funcionamiento: `/livez` y `/health`

Dos sondas que responden a dos preguntas distintas.

| Ruta | Toca la base de datos | Responde |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` mientras el proceso esté en ejecución. Utilícela para una sonda de ejecución (liveness probe). |
| `/health` | Sí, todas las fuentes de datos | `200 {"status":"ok"}` cuando cada fuente de datos configurada responde; `503 {"status":"degraded"}` cuando alguna no lo hace. Utilícela para una sonda de preparación (readiness probe). |

Configurar una sonda de ejecución (liveness probe) en `/health` es un error importante a tener en cuenta: una falla momentánea en la base de datos
haría que el orquestador finalice un proceso que por lo demás está sano, convirtiendo una breve interrupción
en un bucle de reinicios.

`/health` no requiere autenticación, por lo que hace público el veredicto pero no el motivo —
fuera de entornos de desarrollo únicamente indica qué fuente de datos se encuentra degradada y nada más. El
texto de error del driver detalla el host, el puerto, el nombre de la base de datos y el rol, y esa información se envía
a los logs. `/health` también se sirve bajo `basePath` (`/api/health`);
`/livez` no.

Ambas sondas pertenecen al runtime administrado. Un archivo `backend/src/index.ts` expulsado sirve
`/health` y `/api/health` por sí mismo, sondeando únicamente la base de datos por defecto, y no
dispone de `/livez` hasta que usted añada uno.

---

## Referencia de configuración

<span class="since-badge" data-since="0.31">Desde 0.31</span>

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

Cinco de estas opciones son fáciles de pasar por alto y modifican comportamientos que de otro modo solo
podría observar:

| Clave | Por defecto | Qué hace |
|---|---|---|
| `compression` | `true` | Compresión gzip/deflate en las respuestas de la API, negociada mediante `Accept-Encoding`. Los cuerpos ya comprimidos, transmitidos por streaming o con encabezado `no-transform` no se modifican, al igual que los cuerpos de menos de 1 KB (el coste de gzip supera el ahorro en estos casos), por lo que es seguro dejarla habilitada — una lista JSON extensa suele reducirse unas 20 veces (~20x). Establézcala en `false` si nginx, Cloudflare u otro proxy intermedio ya aplica compresión, para evitar duplicar el procesamiento. Entorno: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Límite máximo para los cuerpos de petición en rutas de la API; `0` lo deshabilita. Las subidas de almacenamiento utilizan el `maxFileSize` propio de la configuración de almacenamiento (50MB), que prevalece en dichas rutas. Entorno: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | desactivado | **Opcional (Opt-in).** Una API de BaaS es consumida por aplicaciones móviles, SPAs en otros dominios y herramientas de línea de comandos (CLI), ninguno de los cuales envía un encabezado `Origin` admisible por una lista fija — por lo que no viene activado por defecto. Habilítelo indicando los orígenes que emplean sus clientes web. No existe forma vía variable de entorno: expulse (eject) la configuración para definirlo. |
| `cronPersistence` | `true` | Determina si los logs de ejecución se guardan en `rebase.cron_logs`. Con `false`, los trabajos se siguen ejecutando pero el historial se conserva solo en memoria, perdiéndose en el panel de Studio tras un reinicio. |
| `schemaEditor` | activado fuera de producción, cuando `schemaDir` está definido | Fuerza la activación o desactivación de las rutas del editor de schema. El editor reescribe los *archivos fuente* de `backend/schema`, por lo que necesita un directorio donde escribir — y un bundle compilado no dispone de ninguno, razón por la cual nunca está presente en despliegues. |

El resto de `RebaseBackendConfig` se documenta en su propia página (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) o bien está marcado como `@internal`:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` y `runtimeVersion` son asignados por
`bootFromBundle` a partir del entorno; pasarlos manualmente puede generar discrepancias
con el runtime acerca de la naturaleza de este proceso.

## La instancia del Backend

`initializeRebaseBackend` devuelve el backend que ha construido, ya montado e
iniciado. Su tipo es `RebaseBackendInstance`, que corresponde a `RebaseBackend`, el
tipo retornado por `createRebaseBackend`:

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
`rebase`, el cliente interno del proceso, `fetch(request)`, `routes`, los grupos de rutas
como subaplicaciones de Hono, `services`, sus propias claves JWT, modelo de acceso, almacén de claves de API y
limitadores de tasa (rate limiters), y `verifyCredential(token)`; consulte
[Integración en servidor personalizado](/docs/backend/custom-server/).

> **Nota:** Aunque la `instance` expone estos servicios internos, el código de la aplicación (como funciones personalizadas y tareas cron) debe utilizar el singleton `rebase` de `@rebasepro/server` para interactuar con la API del backend. Dentro de una petición, una ejecución de cron o un job, `rebase` es el backend que lo está ejecutando; en cualquier otro lugar es el backend por defecto del proceso, que `initializeRebaseBackend` establece en su backend.

## API REST

La API REST se genera a partir de sus tablas. Cada tabla obtiene estos endpoints:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Listar entidades — filtrado, ordenación, paginación y búsqueda se configuran mediante parámetros de consulta |
| `GET` | `/api/data/:slug/count` | Cantidad de filas que coinciden con dicha consulta |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opcionalmente agrupados |
| `GET` | `/api/data/:slug/:id` | Obtener una entidad específica |
| `POST` | `/api/data/:slug` | Crear una nueva entidad |
| `PATCH` | `/api/data/:slug/:id` | Actualizar los campos especificados |
| `DELETE` | `/api/data/:slug/:id` | Eliminar un registro |
| `POST` | `/api/data/:slug/bulk` | Crear múltiples filas en una sola transacción |
| `PATCH` | `/api/data/:slug/bulk` | Actualizar múltiples filas en una sola transacción |
| `POST` | `/api/data/:slug/bulk/delete` | Eliminar múltiples filas en una sola transacción |

### Parámetros de consulta

Existe una referencia específica para ellos fuera de esta página. [API
REST](/docs/backend/api/) documenta ambos dialectos de consulta que admite el servidor — el
formato estilo PostgREST `?column=op.value` y el formato JSON `?where=` — junto con
`orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` y búsqueda vectorial.
[Endpoints](/docs/backend/endpoints/) es el índice de todas las rutas que
el servidor monta, incluyendo las generadas.

Cualquier parámetro que el servidor no tenga reservado se interpreta como un filtro sobre la columna
con dicho nombre, de modo que uno inventado no arroja error: simplemente no coincidirá con ningún registro.

## WebSocket

El servidor WebSocket se acopla al mismo servidor HTTP y proporciona suscripciones en tiempo real. Gestiona las peticiones de upgrade en una única ruta, `/` para una API en `/api`, que es donde conecta el SDK, dejando cualquier otra ruta a sus propios listeners de `upgrade`:

- Suscribirse a **cambios en tablas** — reciba notificaciones cuando se cree, actualice o elimine cualquier fila de una tabla
- Suscribirse a **cambios en filas** — reciba notificaciones cuando cambie una fila específica
- Manejo automático de **reconexión** en el SDK tipado

El backend utiliza internamente `LISTEN/NOTIFY` de PostgreSQL. Para despliegues con múltiples instancias, proporcione una `connectionString` en su `PostgresBootstrapper` para habilitar la difusión entre instancias.

## Gestión de errores

Cada fallo — procedente de cualquier ruta o subsistema — se devuelve bajo un formato uniforme:

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
| `message` | sí | Redactado para una persona leyendo una consola. Describe el obstáculo, no la regla. |
| `code` | sí | `SCREAMING_SNAKE_CASE` y estable. Es el campo adecuado para ramificar la lógica. |
| `details` | no | Carga útil estructurada cuando el rechazo *trata sobre* algo concreto — una lista de rutas fallidas, un conjunto de campos desconocidos. |
| `requestId` | no | Presente cuando la petición incluía uno o se le asignó; reproduce `X-Request-ID`. Inclúyalo en reportes de errores. |

El código de estado HTTP va en la respuesta, no en el cuerpo. Ramifique su lógica en función de `code`, no de
`message` — los mensajes están redactados para humanos y son susceptibles de cambiar.

El SDK tipado convierte cada uno de estos en un `RebaseApiError` que contiene
`status`, `code` y `details` — incluyendo los fallos que nunca llegaron a
alcanzar al servidor. Una conexión rechazada, un fallo de DNS, problemas de CORS o una cancelación (abort) llegan con
`status: 0`, `code: "NETWORK_ERROR"`, con el error original del runtime en `cause`,
en lugar de cualquier error arbitrario con el que `fetch` hubiera decidido fallar. Una respuesta sin
envoltorio de error — como el 413 de un proxy o el 502 de un balanceador de carga — aun así recibe un `code` derivado de su
código de estado (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), y un
cliente instanciado fuera del navegador sin `baseUrl` falla con
`BASE_URL_REQUIRED` en lugar de un error de red.
Una lectura que devuelva éxito
pero sin la estructura esperada — un `204`, un cuerpo vacío, una página sin lista `data` —
falla con `UNEXPECTED_RESPONSE` en lugar de resolverse como "sin registros", y
pasar algo que no sea un array a `createMany`, `updateMany`, `deleteMany` o `batch`
falla con `INVALID_BULK_BODY`, el mismo código que emplea el servidor ante ese mismo error. Por ello, el código de la aplicación solo necesita capturar una única clase:

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
- **[Funciones personalizadas](/docs/backend/custom-functions)** — Añadir endpoints de API personalizados
- **[Tareas Cron](/docs/backend/cron-jobs)** — Tareas programadas en segundo plano
- **[Bifurcación de base de datos](/docs/backend/branching)** — Copias de base de datos instantáneas para desarrollo/staging
- **[Despliegue](/docs/getting-started/deployment)** — Llevar el backend a producción
