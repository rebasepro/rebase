---
sourceHash: b58890f96ff100b4
title: Visión general de la arquitectura
sidebar_label: Arquitectura
description: Comprenda cómo el backend, el frontend, el SDK tipado y la base de datos de Rebase se integran para formar un Backend-as-a-Service completo.
---

## Arquitectura del sistema

Rebase es una plataforma full-stack con cuatro capas:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  Rebase CMS + Studio  •  Custom Views  •  Plugins  •  Your App │
│  @rebasepro/app  •  @rebasepro/ui  •  @rebasepro/studio       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP + WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend Layer                            │
│  Hono HTTP Server  •  REST API  •  Auth  •  Storage  •  WS     │
│  @rebasepro/server                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Database Layer                            │
│  PostgreSQL  •  Tables  •  RLS Policies  •  Realtime sync       │
└─────────────────────────────────────────────────────────────────┘
```

## Componentes clave

### Sistema de adaptadores de base de datos

El backend se inicializa a través de un patrón unificado de adaptador de base de datos. La lógica específica de la base de datos se desacopla en su propio paquete, y el adaptador gestiona automáticamente el pooling de conexiones, la resolución de esquemas y el enrutamiento de eventos en tiempo real.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
    connectionString: process.env.DATABASE_URL!
})
```

Cada tabla se resuelve en función del adaptador configurado: la base de datos predeterminada o la que su `database` indique en `backend/resources.ts`.

:::tip
`createPostgresAdapter` gestiona automáticamente el pooling de conexiones a la base de datos, la resolución de esquemas y la configuración de `LISTEN/NOTIFY` en tiempo real.
:::

### Descriptores de tablas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Al arrancar, el backend compila las tablas que exporta `backend/schema/index.ts` en
**descriptores**: cada columna con su tipo de Postgres, nulabilidad, reglas de validación y
almacenamiento, las relaciones por slug y la postura de seguridad a nivel de fila (RLS). Si
hay un problema en cualquier tabla, se rechaza el arranque con un único `SchemaDefinitionError` que
enumera cada problema. Los descriptores son la base desde donde se sirven REST, realtime, MCP y el
documento OpenAPI, sobre lo que se calcula la versión del esquema y lo que
`GET /api/schema/tables` entrega al panel de administración y al Studio, redactado según el
llamante. El código de los hooks nunca sale del servidor. Un backend sin `backend/schema`
realiza una introspección de la base de datos hacia los mismos descriptores.

### Servicio en tiempo real

La sincronización en tiempo real utiliza el mecanismo nativo `LISTEN/NOTIFY` de PostgreSQL:

1. Ocurre una mutación de datos (insert, update, delete) — a través de la API o cualquier otra vía que escriba en la tabla: `psql`, un cron, el editor SQL
2. Un trigger en la tabla emite un `NOTIFY` en un canal (donde no se pueda instalar el trigger, el backend lo emite, solo para escrituras realizadas a través de la API)
3. `RealtimeService` recibe la notificación
4. Transmite el cambio a todos los clientes WebSocket conectados
5. Los componentes de React se vuelven a renderizar con los nuevos datos

Para **despliegues multi-instancia** (p. ej., Cloud Run con múltiples réplicas), cada réplica mantiene su propia conexión `LISTEN` a la misma base de datos, de modo que el cambio llega a los suscriptores de cada réplica. Detrás de un pooler en modo transacción como PgBouncer, que no mantiene un `LISTEN`, configure `DATABASE_DIRECT_URL` apuntando a la base de datos directamente.

### Registro de almacenamiento

Al igual que los drivers, los backends de almacenamiento se registran en un registro. Puede tener múltiples proveedores de almacenamiento (local, S3) y enrutar diferentes columnas de almacenamiento a diferentes backends con `col.storage({ source })`.

## Mapa de paquetes

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Paquete | Rol | Utilizado por |
|---------|------|---------|
| `@rebasepro/types` | Los constructores de tablas (`defineTable`, `col`, `rel`), los descriptores y las interfaces que comparten todos los paquetes | Todo |
| `@rebasepro/server` | Inicialización del servidor backend, API REST, auth, almacenamiento, WebSocket; reexporta los constructores desde `@rebasepro/server/schema`, un punto de entrada que no carga código de servidor | Backend |
| `@rebasepro/server-postgres` | El driver de Postgres: planificación de esquemas, migraciones, políticas RLS, tiempo real | Backend |
| `@rebasepro/codegen` | Generación del SDK tipado a partir de los descriptores de tablas | Herramientas de desarrollo |
| `@rebasepro/client` | SDK tipado — transporte HTTP, WebSocket, auth | Frontend |
| `@rebasepro/app` | Framework de React — Scaffold, controladores, formularios, rutas, hooks, vistas de inicio de sesión, hooks de controladores de autenticación | Frontend |
| `@rebasepro/ui` | Biblioteca independiente de componentes de interfaz de usuario (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/studio` | Visualizador y editor de esquemas, consola SQL, consola JS, editor de RLS, explorador de almacenamiento | Frontend |
| `@rebasepro/cli` | CLI para generación de esquemas, migraciones de base de datos, generación de SDK | Herramientas de desarrollo |
| `@rebasepro/forms` | Gestión ligera del estado de formularios en React | Frontend |
| `@rebasepro/plugin-ai` | Plugin de autocompletado de campos impulsado por IA | Frontend |
| `@rebasepro/cms` | El panel de administración: una vista por tabla a partir de los descriptores, `customizeTable`, formularios y enrutamiento, importación y exportación de CSV/JSON/Excel | Frontend |
| `@rebasepro/cms-types` | Tipos y utilidades del panel: opciones de `customizeTable`, opciones de campos, acciones de entidades y el modelo de vista de colecciones y propiedades que dibuja el panel (`CollectionConfig`, `StringProperty`, `CollectionCallbacks`, …) | Frontend |
| `@rebasepro/firebase` | Firestore como fuente que el panel lee directamente: `defineFirestoreCollection` | Frontend |
| `@rebasepro/inference` | Inferir campos a partir de filas de muestra (la importación "crear desde un archivo" del panel de administración) | Frontend |

## Flujo de datos

### Flujo de lectura
1. El usuario abre una tabla en Rebase CMS
2. El SDK tipado envía `GET /api/data/:slug` + abre una suscripción por WebSocket
3. El backend consulta PostgreSQL mediante Drizzle ORM
4. La respuesta incluye las filas tal como las entrega la API; el panel construye los valores de su formulario a partir de la fila y el descriptor de la tabla
5. La respuesta se envía al frontend, los componentes se renderizan
6. WebSocket mantiene la vista sincronizada en tiempo real

### Flujo de escritura
1. El usuario edita una fila en el formulario
2. El SDK tipado envía `PATCH /api/data/:slug/:id`
3. El backend valida los valores contra la tabla y ejecuta los hooks `beforeSave`
4. Ejecuta el `UPDATE` bajo la seguridad a nivel de fila (RLS) del llamante
5. Los hooks `afterSave` se ejecutan en la misma transacción
6. La emisión de `NOTIFY` activa la actualización por WebSocket para todos los clientes
7. Si el historial está habilitado, se registra una instantánea

## Próximos pasos

- **[Esquema como código](/docs/architecture/schema-as-code)** — El enfoque centrado en TypeScript
- **[Visión general del backend](/docs/backend)** — Configuración del servidor
- **[Tablas](/docs/schema/)** — Defina su esquema de datos
