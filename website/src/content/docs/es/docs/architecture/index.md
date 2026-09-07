---
sourceHash: 08efd8549191e760
title: Resumen de la Arquitectura
sidebar_label: Arquitectura
description: Comprenda cómo el backend, el frontend, el SDK del cliente y la base de datos de Rebase se integran para formar un Backend-as-a-Service completo.
---

## Arquitectura del Sistema

Rebase es una plataforma full-stack con cuatro capas:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend Layer                           │
│  React Admin UI  •  Custom Views  •  Plugins  •  Your App      │
│  @rebasepro/app  •  @rebasepro/ui  •  @rebasepro/studio       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP + WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend Layer                            │
│  Hono HTTP Server  •  REST API  •  Auth  •  Storage  •  WS     │
│  @rebasepro/server                                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Drizzle ORM
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Database Layer                            │
│  PostgreSQL  •  Tables  •  RLS Policies  •  Realtime sync       │
└─────────────────────────────────────────────────────────────────┘
```

## Componentes Clave

### Sistema de Inicialización (Bootstrapper)

El backend se inicializa a través de un sistema de inicialización basado en plugins. La lógica específica de la base de datos se desacopla en su propio paquete, y los inicializadores (bootstrappers) se encargan de la inicialización de la base de datos, la autenticación y los servicios internos.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
        connectionString: process.env.DATABASE_URL!
    })
```

Las colecciones se resuelven automáticamente contra el inicializador configurado a través del registro interno de inyección de dependencias.

:::tip
El `createPostgresAdapter` maneja automáticamente el pool de conexiones a la base de datos, la resolución de esquemas y la configuración de `LISTEN/NOTIFY` en tiempo real.
:::

### Registro de Colecciones

El `BackendCollectionRegistry` es el índice en tiempo de ejecución de todas las colecciones, sus tablas PostgreSQL, enums y relaciones Drizzle. Se completa al iniciar a partir de sus definiciones de colección.

### Servicio en Tiempo Real

La sincronización en tiempo real utiliza el mecanismo nativo `LISTEN/NOTIFY` de PostgreSQL:

1. Ocurre una mutación de datos (inserción, actualización, eliminación)
2. El backend emite una `NOTIFY` en un canal
3. El `RealtimeService` recibe la notificación
4. Transmite el cambio a todos los clientes WebSocket conectados
5. Los componentes de React se vuelven a renderizar con los nuevos datos

Para **implementaciones multi-instancia** (por ejemplo, Cloud Run con múltiples réplicas), proporcione una `connectionString` en su PostgresBootstrapper para que todas las réplicas compartan la misma conexión `LISTEN`.

### Registro de Almacenamiento

Al igual que los controladores, los backends de almacenamiento se registran en un registro. Puede tener múltiples proveedores de almacenamiento (local, S3) y enrutar diferentes campos de archivo a diferentes backends usando `storageId`.

## Mapa de Paquetes

| Paquete | Rol | Usado por |
|---------|------|---------|
| `@rebasepro/types` | Interfaces de TypeScript para colecciones, propiedades, entidades, plugins | Todo |
| `@rebasepro/server` | Inicialización del servidor backend, API REST, autenticación, almacenamiento, WebSocket | Backend |
| `@rebasepro/client` | SDK del cliente — Transporte HTTP, WebSocket, autenticación | Frontend |
| `@rebasepro/app` | Framework React — Scaffold, controladores, formularios, rutas, hooks | Frontend |
| `@rebasepro/ui` | Librería de componentes de UI autónoma (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/app` | Vistas de inicio de sesión, hooks del controlador de autenticación, gestión de usuarios | Frontend |
| `@rebasepro/studio` | Editor de colecciones, consola SQL, consola JS, editor RLS, navegador de almacenamiento | Frontend |
| `@rebasepro/cli` | CLI para generación de esquemas, migraciones de DB, generación de SDK | Herramientas de desarrollo |
| `@rebasepro/forms` | Gestión ligera del estado de formularios de React | Frontend |
| `@rebasepro/plugin-ai` | Plugin de autocompletado de campos impulsado por IA | Frontend |
| `@rebasepro/plugin-data-import-export` | Importación y exportación de CSV/JSON/Excel | Frontend |
| `@rebasepro/inference` | Detección automática de esquemas a partir de datos de base de datos existentes | Backend/CLI |

## Flujo de Datos

### Flujo de Lectura
1. El usuario abre una colección en la interfaz de administración
2. El SDK del cliente envía `GET /api/data/:slug` + abre una suscripción WebSocket
3. El backend consulta PostgreSQL a través de Drizzle ORM
4. El transformador de datos deserializa los registros de la base de datos al formato de entidad
5. La respuesta se envía al frontend, los componentes se renderizan
6. WebSocket mantiene la vista sincronizada en tiempo real

### Flujo de Escritura
1. El usuario edita una entidad en el formulario
2. Se ejecutan las callbacks `beforeSave` (validación, transformación)
3. El SDK del cliente envía `PATCH /api/data/:slug/:id`
4. El backend serializa los valores, ejecuta `UPDATE` de Drizzle
5. Se ejecutan las callbacks `afterSave` (efectos secundarios)
6. La transmisión `NOTIFY` activa la actualización de WebSocket a todos los clientes
7. Si el historial está habilitado, se registra una instantánea

## Próximos Pasos

- **[Esquema como Código](/docs/architecture/schema-as-code)** — El enfoque TypeScript-first
- **[Resumen del Backend](/docs/backend)** — Configuración del servidor
- **[Colecciones](/docs/collections)** — Defina su esquema de datos
---
