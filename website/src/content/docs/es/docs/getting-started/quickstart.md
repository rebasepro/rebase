---
title: Inicio Rápido
sidebar_label: Inicio Rápido
description: Crea un nuevo proyecto Rebase y ejecútalo localmente en menos de 2 minutos.
---

## Crear un Nuevo Proyecto

```bash
pnpm dlx @rebasepro/cli init my-app
```

Esto genera la estructura de un proyecto con tres paquetes:

| Carpeta | Descripción |
|--------|-------------|
| `frontend/` | SPA de React — Vite + TypeScript con la interfaz de administración de Rebase |
| `backend/` | Servidor Node.js — Hono, PostgreSQL a través de Drizzle ORM, WebSocket |
| `config/` | Definiciones de colecciones TypeScript compartidas por ambos lados |

## Requisitos Previos

- **Node.js** 18+
- **PostgreSQL** — instalación local, Docker o cualquier base de datos gestionada (Neon, Supabase, etc.)
- **pnpm** (recomendado) o npm

## Configurar tu Entorno

Después de generar la estructura, edita el archivo `.env` en la raíz del proyecto:

```bash
# PostgreSQL connection string
DATABASE_URL=postgresql://username:password@localhost:5432/your_database

# JWT secret for authentication (generate a strong random string)
JWT_SECRET=change-me-to-a-random-secret

# Frontend URL for CORS
VITE_API_URL=http://localhost:3001

# Optional: Google OAuth client ID
# VITE_GOOGLE_CLIENT_ID=your-google-client-id
```

## Iniciar los Servidores de Desarrollo

```bash
pnpm dev
```

Esto inicia:
- **Backend** en `http://localhost:3001` — API REST, autenticación, almacenamiento, WebSocket
- **Frontend** en `http://localhost:5173` — Panel de administración de Rebase
- **Recarga en caliente** para ambos — los cambios surten efecto al instante

También puedes iniciarlos individualmente:

```bash
pnpm dev:backend   # Backend only
pnpm dev:frontend  # Frontend only
```

## Primer Inicio de Sesión

Cuando abras `http://localhost:5173`, verás la pantalla de inicio de sesión. El primer usuario en registrarse se convierte automáticamente en administrador — este es el flujo de arranque.

1. Haz clic en **Registrarse**
2. Introduce tu correo electrónico y contraseña
3. Estás dentro — con acceso completo de administrador

## Define tu Primera Colección

Abre `config/collections/` y crea un nuevo archivo:

```typescript title="config/collections/products.ts"
import { EntityCollection } from "@rebasepro/types";

export const productsCollection: EntityCollection = {
    slug: "products",
    name: "Products",
    singularName: "Product",
    table: "products",
    properties: {
        name: {
            type: "string",
            name: "Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        description: {
            type: "string",
            name: "Description",
            multiline: true
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        created_at: {
            type: "date",
            name: "Created At",
            autoValue: "on_create"
        }
    }
};
```

## Generar el Esquema de la Base de Datos

```bash
rebase schema generate   # Generate Drizzle schema from your collections
rebase db push           # Push the schema to your database
```

Reinicia los servidores de desarrollo y tu nueva colección de **Productos** aparecerá en la navegación.

## Referencia de Comandos de Base de Datos

| Comando | Descripción |
|---------|-------------|
| `rebase schema generate` | Genera el esquema de Drizzle a partir de tus colecciones de TypeScript |
| `rebase db push` | Envía los cambios de esquema directamente a la base de datos (solo desarrollo) |
| `rebase db generate` | Genera archivos de migración SQL |
| `rebase db migrate` | Ejecuta las migraciones pendientes |

## Qué Sigue

- **[Estructura del Proyecto](/docs/getting-started/project-structure)** — Comprende el código generado
- **[Colecciones](/docs/collections)** — Profundiza en la definición del esquema
- **[Entorno y Configuración](/docs/getting-started/configuration)** — Todas las opciones de configuración
- **[Despliegue](/docs/getting-started/deployment)** — Despliega a producción
