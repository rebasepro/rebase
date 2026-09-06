---
title: Descripción general del backend
sidebar_label: Backend
description: El backend de Rebase proporciona un servidor completo con API REST, autenticación, almacenamiento, tiempo real con WebSocket e historial de entidades, todo inicializado con una única llamada a función.
---

## Descripción general

El backend de Rebase es un **servidor Node.js** construido sobre [Hono](https://hono.dev/) que proporciona:

- **API REST** — Puntos finales CRUD auto-generados para cada colección
- **Autenticación** — Tokens JWT, inicio de sesión OAuth y OIDC, magic links, códigos de un solo uso, MFA, claves de API, gestión de usuarios/roles
- **Almacenamiento** — Carga/descarga de archivos con sistema de archivos local o S3
- **WebSocket** — Sincronización de datos en tiempo real a través de PostgreSQL LISTEN/NOTIFY
- **Historial de entidades** — Registro de auditoría para cada cambio de datos
- **Ramificación de la base de datos** — Copias de base de datos instantáneas y aisladas para desarrollo/staging/pruebas
- **Tareas Cron** — Tareas en segundo plano programadas con panel de monitoreo

Todo se inicializa con una única función:

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

## Qué se crea

Después de la inicialización, se montan estas rutas:

| Path | Propósito |
|------|---------|
| `/api/auth/*` | Autenticación (registro, inicio de sesión, actualización, OAuth, magic links, códigos de un solo uso, MFA) |
| `/api/admin/*` | Gestión de usuarios y roles (solo para administradores) |
| `/api/storage/*` | Carga, descarga y eliminación de archivos |
| `/api/data/:slug` | Operaciones CRUD por colección (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Historial de cambios de la entidad (cuando está habilitado) |
| `/api/docs` | Especificación OpenAPI (cuando `enableSwagger: true`) |
| `/api/swagger` | Swagger UI (modo de desarrollo, cuando `enableSwagger: true`) |
| `/api/meta/contract` | El esquema de colecciones del proyecto (solo admin) |
| `/api/meta/schema-version` | Una cadena de versión para ese esquema (sin autenticación) |
| `/api/functions/*` | Rutas de funciones personalizadas (cuando `functionsDir` está configurado) |
| `/api/cron/*` | Gestión de tareas cron (solo para administradores, cuando `cronsDir` está configurado) |
| WebSocket on upgrade | Suscripciones en tiempo real |

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

    // Bootstrappers (Databases, Auth, Realtime, etc.)
    bootstrappers: BackendBootstrapper[];

    // Authentication
    auth?: AuthConfig;

    // File storage
    storage?: BackendStorageConfig | Record<string, BackendStorageConfig>;

    // Entity history
    history?: boolean | HistoryConfig;

    // OpenAPI/Swagger
    enableSwagger?: boolean;

    // Custom API endpoints
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks
    cronsDir?: string;        // Auto-load cron jobs from a directory

    // Logging
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

## La instancia del backend

`initializeRebaseBackend` devuelve una `RebaseBackendInstance` con acceso a servicios internos:

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

La API REST se auto-genera a partir de tus colecciones. Cada colección obtiene estos puntos finales:

| Método | Path | Descripción |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Listar entidades — filtrar, ordenar, paginar y buscar son parámetros de consulta |
| `GET` | `/api/data/:slug/count` | Cuántas filas coinciden con esa misma consulta |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opcionalmente agrupados |
| `GET` | `/api/data/:slug/:id` | Obtener una única entidad |
| `POST` | `/api/data/:slug` | Crear una nueva entidad |
| `PATCH` | `/api/data/:slug/:id` | Actualizar los campos que envías |
| `DELETE` | `/api/data/:slug/:id` | Eliminar una entidad |
| `POST` | `/api/data/:slug/bulk` | Crear muchas filas en una sola transacción |
| `PATCH` | `/api/data/:slug/bulk` | Actualizar muchas filas en una sola transacción |
| `POST` | `/api/data/:slug/bulk/delete` | Eliminar muchas filas en una sola transacción |

### Parámetros de consulta

Hay una referencia para ellos y no es esta página. [API REST](/docs/backend/api/) documenta
los dos dialectos de consulta que el servidor acepta — la forma `?column=op.value` al estilo
PostgREST y la forma JSON `?where=` — junto con `orderBy`, `limit`/`offset`, `include`,
`fields`, `searchString` y la búsqueda vectorial.
[Puntos finales](/docs/backend/endpoints/) es el índice de todas las rutas que monta el
servidor, incluidas las generadas.

Un parámetro que el servidor no reserva se lee como un filtro sobre la columna de ese
nombre, así que uno inventado no falla: simplemente no coincide con nada.

## WebSocket

El servidor WebSocket se adjunta al mismo servidor HTTP y proporciona suscripciones en tiempo real:

- Suscribirse a **cambios en la colección** — recibir notificaciones cuando cualquier entidad en una colección es creada, actualizada o eliminada
- Suscribirse a **cambios en la entidad** — recibir notificaciones cuando una entidad específica cambia
- Manejo automático de la **reconexión** en el SDK del cliente

El backend usa internamente PostgreSQL `LISTEN/NOTIFY`. Para implementaciones multi-instancia, proporciona una `connectionString` en tu `PostgresBootstrapper` para habilitar la transmisión entre instancias.

## Manejo de errores

El backend incluye un manejador de errores que captura todas las excepciones y devuelve respuestas de error estructuradas:

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
| `message` | sí | Escrito para la persona que lo lee en una consola. Nombra el obstáculo, no la regla. |
| `code` | sí | `SCREAMING_SNAKE_CASE` y estable. Este es el campo sobre el que ramificar. |
| `details` | no | Carga estructurada cuando el rechazo trata *sobre* algo — una lista de rutas fallidas, un conjunto de campos desconocidos. |
| `requestId` | no | Presente cuando la petición llevaba uno o se le asignó; refleja `X-Request-ID`. Cítalo en un informe de error. |

El estado HTTP va en la respuesta, no en el cuerpo. Ramifica sobre `code`, no
sobre `message` — los mensajes están escritos para personas y pueden cambiar.

## Próximos pasos

- **[Autenticación](/docs/backend/authentication)** — JWT, proveedores OAuth y OIDC, MFA, claves de API, gestión de usuarios
- **[Almacenamiento](/docs/backend/storage)** — Almacenamiento de archivos local y S3
- **[Callbacks de entidad](/docs/collections/callbacks)** — Hooks de ciclo de vida y API `context.data`
- **[Historial de entidades](/docs/backend/history)** — Registro de auditoría
- **[Funciones personalizadas](/docs/backend/custom-functions)** — Añadir puntos finales de API personalizados
- **[Tareas Cron](/docs/backend/cron-jobs)** — Tareas en segundo plano programadas
- **[Ramificación de la base de datos](/docs/backend/branching)** — Copias instantáneas de bases de datos para desarrollo/staging
- **[Despliegue](/docs/getting-started/deployment)** — Llevar el backend a producción

---
