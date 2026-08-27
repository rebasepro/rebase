---
title: Estructura del Proyecto
sidebar_label: Estructura del Proyecto
description: Comprende la estructura de un proyecto Rebase — frontend, backend y colecciones compartidas.
---

Un proyecto inicial de Rebase tiene tres paquetes interconectados:

```
my-app/
├── .env                    # Environment variables (DATABASE_URL, JWT_SECRET, etc.)
├── package.json            # Root workspace config
│
├── frontend/               # React admin panel (Vite)
│   ├── src/
│   │   ├── App.tsx         # Main application component
│   │   ├── main.tsx        # React entry point
│   │   └── index.css       # Global styles
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                # Node.js API server (Hono)
│   ├── src/
│   │   ├── index.ts        # Server entry — initializes Rebase backend
│   │   └── schema.generated.ts  # Auto-generated Drizzle schema
│   ├── drizzle.config.ts   # Drizzle ORM configuration
│   ├── Dockerfile
│   └── package.json
│
└── config/                 # Collection definitions
    └── collections/
        ├── index.ts        # Exports all collections
        └── products.ts     # Example: products collection
```

## Frontend (`frontend/`)

El frontend es una aplicación estándar de **Vite + React + TypeScript**. El archivo clave es `App.tsx`, que conecta todos los controladores de Rebase:

```typescript title="frontend/src/App.tsx"
import { Rebase } from "@rebasepro/app";
import { Scaffold, AppBar, Drawer } from "@rebasepro/cms";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

// The client connects to your backend API and WebSocket
const rebaseClient = createRebaseClient({
    baseUrl: "http://localhost:3001",
    websocketUrl: "ws://localhost:3001"
});

// Collections are imported via a Vite virtual module
// that reads from the config/ directory
```

### Key Concepts

- **`createRebaseClient`** — Crea el cliente SDK que gestiona las solicitudes HTTP, las conexiones WebSocket y la gestión de tokens de autenticación
- **`virtual:rebase-collections`** — Un plugin de Vite que autoimporta tus colecciones compartidas en tiempo de construcción
- **Controladores** — `useBuildNavigationStateController`, `useBuildCollectionRegistryController`, etc. — estos configuran el enrutamiento, la resolución de colecciones y la configuración de la interfaz de usuario

## Backend (`backend/`)

El backend es un **servidor Node.js** construido sobre [Hono](https://hono.dev/) (un framework HTTP rápido y ligero). El punto de entrada `index.ts` lo inicializa todo:

```typescript title="backend/src/index.ts"
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    database: createPostgresAdapter({
            connection: db,
            schema: { tables, enums, relations }
        }),
    auth: {
        jwtSecret: process.env.JWT_SECRET!,
        google: { clientId: process.env.GOOGLE_CLIENT_ID },
    },
    storage: {
        type: "local",
        basePath: "./uploads"
    },
    history: true
});
```

`initializeRebaseBackend` configura:
- **Rutas de la API REST** en `/api/data/*` — CRUD auto-generado para cada colección
- **Rutas de autenticación** en `/api/auth/*` — registro, inicio de sesión, refresco, Google OAuth
- **Rutas de almacenamiento** en `/api/storage/*` — carga/descarga de archivos
- Servidor **WebSocket** — sincronización de entidades en tiempo real a través de Postgres LISTEN/NOTIFY
- **Historial** — registro de auditoría en cada cambio de entidad

## Colecciones compartidas (`config/`)

Las colecciones son la **única fuente de verdad** para tu modelo de datos. Se definen en TypeScript y son consumidas tanto por el frontend (para la generación de la interfaz de usuario) como por el backend (para la generación de esquemas y el enrutamiento de la API).

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    table: "products",
    properties: {
        name: { type: "string", name: "Name" },
        price: { type: "number", name: "Price" }
    }
});
```

El `slug` se convierte en la ruta URL en la interfaz de administración y en el endpoint de la API REST (`/api/data/products`). La `table` se mapea al nombre de la tabla de PostgreSQL.

## Cómo se conectan

1. **Tú defines** colecciones en `config/`
2. **El backend** las lee para generar esquemas de Drizzle y montar rutas REST
3. **El frontend** las lee (a través del plugin de Vite) para renderizar tablas, formularios y navegación
4. **La CLI** las lee para generar archivos de migración con `rebase schema generate`

Los cambios en las colecciones se propagan automáticamente en todas partes.

## Next Steps

- **[Inicio rápido](/docs/getting-started/quickstart)** — Comienza con un nuevo proyecto Rebase
- **[Configuración](/docs/getting-started/configuration)** — Todas las variables de entorno y opciones

---
