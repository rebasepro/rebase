---
sourceHash: fa7350988287074c
title: Visión general de la arquitectura
sidebar_label: Arquitectura
description: Comprende cómo el backend, frontend, SDK del cliente y la base de datos de Rebase se integran para formar un Backend-as-a-Service completo.
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

El backend se inicializa mediante un patrón unificado de adaptador de base de datos. La lógica específica de la base de datos se desacopla en su propio paquete, y el adaptador gestiona automáticamente el pooling de conexiones, la resolución de esquemas y el enrutamiento de eventos en tiempo real.

```typescript
import { createPostgresAdapter } from "@rebasepro/server-postgres";

database: createPostgresAdapter({
    connectionString: process.env.DATABASE_URL!
})
```

Las colecciones se resuelven automáticamente con el adaptador configurado mediante el registro interno de inyección de dependencias.

:::tip
El `createPostgresAdapter` gestiona automáticamente el pooling de conexiones a la base de datos, la resolución de esquemas y la configuración de `LISTEN/NOTIFY` en tiempo real.
:::

### Registro de colecciones

El `BackendCollectionRegistry` es el índice en tiempo de ejecución de todas las colecciones, sus tablas de PostgreSQL, enums y relaciones de Drizzle. Se puebla al iniciar a partir de las definiciones de tus colecciones.

### Servicio en tiempo real

La sincronización en tiempo real utiliza el mecanismo nativo `LISTEN/NOTIFY` de PostgreSQL:

1. Ocurre una mutación de datos (insert, update, delete)
2. El backend emite un `NOTIFY` en un canal
3. El `RealtimeService` recibe la notificación
4. Transmite el cambio a todos los clientes WebSocket conectados
5. Los componentes de React se vuelven a renderizar con los nuevos datos

Para **despliegues con múltiples instancias** (por ejemplo, Cloud Run con múltiples réplicas), proporciona un `connectionString` en tu PostgresBootstrapper para que todas las réplicas compartan la misma conexión `LISTEN`.

### Registro de almacenamiento

Al igual que los drivers, los backends de almacenamiento se registran en un registro. Puedes tener múltiples proveedores de almacenamiento (local, S3) y enrutar diferentes campos de archivos a diferentes backends mediante `storageId`.

## Mapa de paquetes

| Paquete | Rol | Usado por |
|---------|------|---------|
| `@rebasepro/types` | Interfaces de TypeScript para colecciones, propiedades, entidades, plugins | Todo |
| `@rebasepro/server` | Inicialización del servidor backend, API REST, autenticación, almacenamiento, WebSocket | Backend |
| `@rebasepro/client` | SDK del cliente — transporte HTTP, WebSocket, autenticación | Frontend |
| `@rebasepro/app` | Framework de React — Scaffold, controladores, formularios, rutas, hooks | Frontend |
| `@rebasepro/ui` | Biblioteca de componentes de UI independiente (Tailwind v4 + Radix) | Frontend |
| `@rebasepro/app` | Vistas de inicio de sesión, hooks de controladores de autenticación, gestión de usuarios | Frontend |
| `@rebasepro/studio` | Editor de colecciones, consola SQL, consola JS, editor de RLS, explorador de almacenamiento | Frontend |
| `@rebasepro/cli` | CLI para generación de esquemas, migraciones de BD, generación de SDK | Herramientas de desarrollo |
| `@rebasepro/forms` | Gestión ligera del estado de formularios en React | Frontend |
| `@rebasepro/plugin-ai` | Plugin de autocompletado de campos impulsado por IA | Frontend |
| `@rebasepro/plugin-data-import-export` | Importación y exportación de CSV/JSON/Excel | Frontend |
| `@rebasepro/inference` | Detección automática del esquema a partir de datos existentes de la base de datos | Backend/CLI |

## Flujo de datos

### Flujo de lectura
1. El usuario abre una colección en Rebase CMS
2. El SDK del cliente envía `GET /api/data/:slug` + abre una suscripción por WebSocket
3. El backend consulta PostgreSQL a través de Drizzle ORM
4. El transformador de datos deserializa los registros de la base de datos al formato de entidad
5. La respuesta se envía al frontend, los componentes se renderizan
6. El WebSocket mantiene la vista sincronizada en tiempo real

### Flujo de escritura
1. El usuario edita una entidad en el formulario
2. Se ejecutan los callbacks `beforeSave` (validación, transformación)
3. El SDK del cliente envía `PATCH /api/data/:slug/:id`
4. El backend serializa los valores, ejecuta el `UPDATE` de Drizzle
5. Se ejecutan los callbacks `afterSave` (efectos secundarios)
6. La difusión de `NOTIFY` activa la actualización por WebSocket a todos los clientes
7. Si el historial está habilitado, se registra una instantánea

## Próximos pasos

- **[Schema as Code](/docs/architecture/schema-as-code)** — El enfoque centrado en TypeScript
- **[Visión general del backend](/docs/backend)** — Configuración del servidor
- **[Colecciones](/docs/collections)** — Define tu esquema de datos
