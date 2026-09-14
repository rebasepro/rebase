---
sourceHash: 21b1ae6712a17e38
title: Descripción general del backend
sidebar_label: Backend
description: El backend de Rebase proporciona un servidor completo con API REST, autenticación, almacenamiento, WebSocket en tiempo real e historial de entidades, todo inicializado con una única llamada a una función.
---

## Descripción general

El backend de Rebase es un **servidor Node.js** construido sobre [Hono](https://hono.dev/) que proporciona:

- **API REST** — Endpoints CRUD autogenerados para cada colección
- **Autenticación** — Tokens JWT, inicio de sesión mediante OAuth y OIDC, enlaces mágicos (magic links), códigos de un solo uso, MFA, claves de API y gestión de usuarios/roles
- **Almacenamiento** — Carga/descarga de archivos con sistema de archivos local o S3
- **WebSocket** — Sincronización de datos en tiempo real mediante PostgreSQL LISTEN/NOTIFY
- **Historial de entidades** — Pista de auditoría para cada cambio de datos
- **Bifurcación de base de datos (Database Branching)** — Copias de bases de datos instantáneas y aisladas para desarrollo/staging/pruebas
- **Tareas programadas (Cron Jobs)** — Tareas en segundo plano programadas con panel de monitorización

Todo se inicializa con una sola función:

:::note[Dónde va esto]
La llamada siguiente es la que tiene un backend **expulsado (ejected)**, en `backend/src/index.ts`. En el **entorno de ejecución gestionado (managed runtime)** no existe dicho archivo: el runtime realiza la llamada y usted lo configura a través de variables de entorno, los recursos que declara en `config/resources.ts` (`database()`, `bucket()`) y las dos exportaciones que lee de `config/index.ts` (`storageAuthorize`, `callbacks`). Cada página de esta sección indica cuál de los dos se aplica a la opción que documenta y menciona las que no tienen una variante gestionada. Si exporta una opción que el runtime no lee, le avisará al arrancar en lugar de ignorarla en silencio; si exporta una que fue reemplazada por una declaración de recurso, el arranque la rechazará por su nombre, indicando la línea de `config/resources.ts` que debe escribir en su lugar.
:::

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

const instance = await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),
    auth: {
        jwtSecret: env.JWT_SECRET,
    },
    storage: { type: "local", basePath: "./uploads" },
    history: true,
    enableSwagger: env.NODE_ENV !== "production"
});
```

## Dónde reside cada opción

Esa llamada es la forma **expulsada (ejected)**: la que usted mismo escribe después de `rebase eject`, o en un servidor personalizado. Un proyecto generado mediante scaffolding no la tiene: el runtime publicado arranca el proyecto y cada opción llega como una variable de entorno en `.env`, una exportación desde `config/index.ts` o un directorio que el bundle declara en `rebase.json`.

Ambas vías llegan al mismo `RebaseBackendConfig`. Este es el mapa completo.

| Opción | Runtime gestionado |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (por defecto `/api`) |
| `collections`, `collectionsDir` | el directorio `config/collections/`, declarado por `rebase.json` |
| `functionsDir` | `backend/functions/` |
| `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, más una declaración `database("<key>")` en `config/resources.ts` para cada base de datos además de la predeterminada |
| `auth` | `JWT_SECRET`, las variables `OAUTH_*` y `config/collections/users` |
| `storage` | las variables `STORAGE_*`, más una declaración `bucket("<key>")` en `config/resources.ts` para cada bucket además del predeterminado |
| `storageAuthorize` | `export const storageAuthorize` desde `config/index.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `callbacks` | `export const callbacks` desde `config/index.ts` |
| `history` | `REBASE_HISTORY` (activado por defecto) — solo en su forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; sin definir significa activado fuera de producción |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — consulte [Procesos divididos](/docs/deployment/split-processes/) |
| `corsHandled` | CORS es instalado por el runtime a partir de `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | la compilación estampa ambos en el bundle |
| `app`, `server`, `provisioningDriverResult` | el runtime los crea |

### Opciones sin ruta gestionada

Estas no tienen variable de entorno ni exportación de configuración. Solo son accesibles desde una llamada manual a `initializeRebaseBackend`: `rebase eject` o un [servidor personalizado](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` · `functionsTimeoutMs` ·
`storagePolicies` · `storageTriggers` · `baas` · `liveSchema` · `rlsAudit` ·
`history` en su forma de objeto (`{ retention }`)

`schemaEditor` se desactiva de forma forzada en un bundle compilado: el editor reescribe los archivos *fuente* de las colecciones, y un bundle contiene la salida compilada.

## Qué se crea

Tras la inicialización, se montan estas rutas:

| Ruta | Propósito |
|------|---------|
| `/api/auth/*` | Autenticación (registro, inicio de sesión, refresco, OAuth, magic links, códigos de un solo uso, MFA) |
| `/api/admin/*` | Gestión de usuarios y roles (solo administradores) |
| `/api/storage/*` | Carga, descarga y eliminación de archivos |
| `/api/data/:slug` | Operaciones CRUD por colección (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Historial de cambios de entidades (cuando está habilitado) |
| `/api/docs` | Especificación OpenAPI (cuando `enableSwagger: true`) |
| `/api/swagger` | Swagger UI (modo desarrollo, cuando `enableSwagger: true`) |
| `/api/meta/contract` | El esquema de colecciones del proyecto (solo administradores) |
| `/api/meta/schema-version` | Una cadena de versión para dicho esquema (sin autenticación) |
| `/api/functions/*` | Rutas de funciones personalizadas (cuando `functionsDir` está configurado) |
| `/api/cron/*` | Gestión de tareas cron (solo administradores, cuando `cronsDir` está configurado) |
| WebSocket en upgrade | Suscripciones en tiempo real |

---

## El ciclo de vida de inicialización

Cuando invoca `initializeRebaseBackend()`, el framework desencadena una secuencia de arranque secuencial de 5 fases:

```
[Start Boot]
     │
     ▼
1. ENV validation (Zod parsing of jwt, databases, cors)
     │
     ▼
2. Dynamic Collection Loading (Chokidar watches .ts files, AST parsing)
     │
     ▼
3. Database Bootstrapping (Acquires advisory lock, creates schemas/auth/helper SQL functions)
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

**El arranque falla ruidosamente.** Si la base de datos es inaccesible, las credenciales son incorrectas o no se puede aplicar el esquema de la colección, `initializeRebaseBackend` lanza un error, no se sirve nada y el proceso termina con código `1`. No existe un modo degradado ni un servidor parcial: un contenedor que no puede comunicarse con su base de datos se reinicia, y el error que provocó su caída es lo último que aparece en sus registros.

Esto es deliberado. Un servidor que se inicia respondiendo al inicio de sesión mientras todas las rutas `/api/data/*` fallan es mucho más difícil de diagnosticar que uno que nunca llega a levantarse, y un orquestador puede actuar ante un bucle de reinicios (crash loop).

Antes de la primera consulta, el arranque sondea la conexión e imprime el diagnóstico: el host y puerto a los que no pudo acceder, el motivo propio del controlador (`ECONNREFUSED`, `password authentication failed for user "app"`) y la solución. Consulte [Resolución de problemas](/docs/troubleshooting/) para ver la lista fallo por fallo.

### Una vez en funcionamiento: `/livez` y `/health`

Dos sondeos que responden a dos preguntas diferentes.

| Ruta | Toca la base de datos | Responde |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` mientras el proceso está en ejecución. Utilícelo para un sondeo de liveness (supervivencia). |
| `/health` | Sí, todas las fuentes de datos | `200 {"status":"ok"}` cuando todas las fuentes de datos configuradas responden; `503 {"status":"degraded"}` cuando alguna no lo hace. Utilícelo para un sondeo de readiness (disponibilidad). |

Configurar un sondeo de liveness en `/health` es un error que vale la pena mencionar: una pequeña interrupción en la base de datos haría que el orquestador termine un proceso que por lo demás es saludable, convirtiendo una breve caída en un bucle de reinicios.

`/health` no requiere autenticación, por lo que publica el veredicto y no el motivo; fuera de desarrollo, solo indica qué fuente de datos está degradada y nada más. El texto de error del controlador cita el host, el puerto, el nombre de la base de datos y el rol, y eso va a los registros. Ambas rutas también se sirven bajo `basePath` (`/api/health`).

---

## Referencia de configuración

```typescript
interface RebaseBackendConfig {
    // HTTP framework
    app: Hono;               // Hono application instance
    server: Server;           // Node.js HTTP server (for WebSocket attachment)
    basePath?: string;        // Route prefix (default: "/api")

    // Collections
    collections?: CollectionConfig[];  // Your collection definitions
    collectionsDir?: string;  // Auto-load collections from a directory

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

    // Custom API endpoints
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks
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

Cinco de ellas son fáciles de pasar por alto y modifican comportamientos que de otro modo solo podría observar:

| Clave | Por defecto | Qué hace |
|---|---|---|
| `compression` | `true` | gzip/deflate en las respuestas de la API, negociado a partir de `Accept-Encoding`. Los cuerpos ya comprimidos, transmitidos por streaming o marcados como `no-transform` no se tocan, por lo que es seguro dejarlo activado; una lista JSON grande normalmente se reduce ~20 veces. Establézcalo en `false` cuando nginx, Cloudflare u otro proxy intermedio ya aplique compresión, para evitar un doble procesamiento. Entorno: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Límite máximo para los cuerpos de las solicitudes en rutas de API; `0` lo desactiva. Las cargas de almacenamiento usan el `maxFileSize` propio de la configuración de almacenamiento (50MB), el cual prevalece en esas rutas. Entorno: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | desactivado | **Opcional (Opt-in).** A una API BaaS la llaman aplicaciones móviles, SPAs en otros dominios y herramientas de CLI, ninguno de los cuales envía un `Origin` que una lista fija aceptaría, por lo que no está activado por defecto. Actívelo con los orígenes que utilizan sus clientes de navegador. No existe variable de entorno: haga eject para configurarlo. |
| `cronPersistence` | `true` | Indica si los registros de ejecución llegan a `rebase.cron_logs`. `false` mantiene los trabajos en ejecución y el historial únicamente en memoria, el cual el panel de Studio pierde al reiniciar. |
| `schemaEditor` | activado fuera de producción, cuando `collectionsDir` está configurado | Fuerza la activación o desactivación de las rutas del editor de esquemas. El editor reescribe los *archivos fuente* de las colecciones, por lo que necesita un directorio donde escribir, y un bundle compilado no tiene ninguno, razón por la cual un despliegue nunca lo incluye. |

El resto de `RebaseBackendConfig` está documentado en su propia página (`auth`, `storage`, `jobs`, `callbacks`, `liveSchema`, `rlsAudit`) o marcado como `@internal`: `bootFromBundle` completa `bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`, `functionsSelection`, `functionsUpstream` y `runtimeVersion` a partir del entorno, y pasarlos manualmente es una forma de entrar en conflicto con el runtime sobre qué es este proceso.

## La instancia del backend

`initializeRebaseBackend` devuelve una `RebaseBackendInstance` con acceso a los servicios internos:

```typescript
const instance = await initializeRebaseBackend(config);

// Internal service access
instance.driver              // Default data driver
instance.driverRegistry      // All drivers (for multi-database)
instance.realtimeService     // Default realtime service
instance.auth?.userService       // User management
instance.auth?.roleService       // Role management
instance.storageController   // Default storage
instance.storageRegistry     // All storage backends
instance.collectionRegistry  // Collection metadata
instance.history?.historyService // Entity history
instance.cronScheduler       // Cron job scheduler (when cronsDir is set)
```

> **Nota:** Aunque la `instance` expone estos servicios internos, el código de la aplicación (como funciones personalizadas y tareas cron) debe usar el singleton global `rebase` de `@rebasepro/server` para interactuar con la API del backend.

## API REST

La API REST se genera automáticamente a partir de sus colecciones. Cada colección obtiene estos endpoints:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Listar entidades: el filtrado, la ordenación, la paginación y la búsqueda son parámetros de consulta |
| `GET` | `/api/data/:slug/count` | Cuántas filas coinciden con la misma consulta |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opcionalmente agrupados |
| `GET` | `/api/data/:slug/:id` | Obtener una sola entidad |
| `POST` | `/api/data/:slug` | Crear una nueva entidad |
| `PATCH` | `/api/data/:slug/:id` | Actualizar los campos enviados |
| `DELETE` | `/api/data/:slug/:id` | Eliminar un registro |
| `POST` | `/api/data/:slug/bulk` | Crear múltiples filas en una sola transacción |
| `PATCH` | `/api/data/:slug/bulk` | Actualizar múltiples filas en una sola transacción |
| `POST` | `/api/data/:slug/bulk/delete` | Eliminar múltiples filas en una sola transacción |

### Parámetros de consulta

Existe una referencia específica para ellos y no es esta página. [API REST](/docs/backend/api/) documenta ambos dialectos de consulta que acepta el servidor —el formato estilo PostgREST `?column=op.value` y el formato JSON `?where=`— junto con `orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` y búsqueda vectorial. [Endpoints](/docs/backend/endpoints/) es el índice de todas las rutas que monta el servidor, incluidas las generadas.

Un parámetro que el servidor no reserve se interpreta como un filtro en la columna con ese nombre, por lo que uno inventado no falla: simplemente no coincide con nada de forma silenciosa.

## WebSocket

El servidor WebSocket se adjunta al mismo servidor HTTP y proporciona suscripciones en tiempo real:

- Suscribirse a **cambios en colecciones**: reciba notificaciones cuando cualquier entidad de una colección se cree, actualice o elimine
- Suscribirse a **cambios en entidades**: reciba notificaciones cuando una entidad específica cambie
- Gestión automática de **reconexión** en el SDK del cliente

El backend utiliza PostgreSQL `LISTEN/NOTIFY` internamente. Para despliegues con múltiples instancias, proporcione un `connectionString` en su `PostgresBootstrapper` para habilitar la difusión entre instancias.

## Manejo de errores

Cada fallo —desde cualquier ruta, en cualquier subsistema— se devuelve en una única estructura:

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
| `code` | sí | `SCREAMING_SNAKE_CASE` y estable. Este es el campo sobre el que bifurcar la lógica condicional. |
| `details` | no | Carga útil (payload) estructurada cuando el rechazo trata *sobre* algo concreto: una lista de rutas fallidas, un conjunto de campos desconocidos. |
| `requestId` | no | Presente cuando la solicitud incluía o se le asignó uno; refleja `X-Request-ID`. Cítelo en un reporte de error. |

El estado HTTP se encuentra en la respuesta, no en el cuerpo. Bifurque sobre `code`, no sobre `message`; los mensajes están escritos para humanos y pueden cambiar con libertad.

El SDK del cliente convierte cada uno de estos en un `RebaseApiError` que incluye `status`, `code` y `details`, incluidos los fallos que ni siquiera llegaron a un servidor. Una conexión rechazada, un fallo de DNS, CORS o una cancelación (abort) llegan como `status: 0`, `code: "NETWORK_ERROR"`, con el propio error del runtime en `cause`, en lugar de lo que a `fetch` le haya parecido rechazar. Por lo tanto, el código de la aplicación captura una sola clase:

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

## Siguientes pasos

- **[Autenticación](/docs/backend/authentication)** — Proveedores JWT, OAuth y OIDC, MFA, claves de API, gestión de usuarios
- **[Almacenamiento](/docs/backend/storage)** — Almacenamiento de archivos local y en S3
- **[Callbacks de entidades](/docs/collections/callbacks)** — Hooks de ciclo de vida y API `context.data`
- **[Historial de entidades](/docs/backend/history)** — Registro de auditoría
- **[Funciones personalizadas](/docs/backend/custom-functions)** — Añadir endpoints de API personalizados
- **[Tareas programadas (Cron Jobs)](/docs/backend/cron-jobs)** — Tareas en segundo plano programadas
- **[Bifurcación de bases de datos](/docs/backend/branching)** — Copias instantáneas de bases de datos para dev/staging
- **[Despliegue](/docs/getting-started/deployment)** — Lleve el backend a producción
