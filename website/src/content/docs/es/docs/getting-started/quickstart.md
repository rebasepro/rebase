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
- **Docker** — para ejecutar el contenedor de PostgreSQL incluido. (O trae tu propio PostgreSQL: instalación local, Neon, Supabase, etc.)
- **pnpm** (recomendado) o npm

## Tu Entorno Ya Está Configurado

`init` genera un archivo `.env` listo para usar en la raíz del proyecto, con un `JWT_SECRET` real, una contraseña de base de datos y un puerto de base de datos local libre. No necesitas crear ni editar nada para empezar.

:::caution
No ejecutes `cp .env.example .env`. `.env.example` es una referencia de las variables disponibles — copiarlo sobre tu `.env` descarta los secretos generados y apunta `DATABASE_URL` a una base de datos que no existe. Edita `.env` directamente si quieres cambiar un valor.
:::

Si prefieres apuntar a tu propio PostgreSQL en lugar del contenedor incluido, edita `DATABASE_URL` en `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

## Iniciar la Base de Datos

La estructura incluye un `docker-compose.yml` con un servicio de PostgreSQL. Inícialo:

```bash
docker compose up -d db
```

(Omite esto si apuntaste `DATABASE_URL` a tu propia base de datos.)

## Crear las Tablas

Envía tus colecciones a la base de datos. Esto crea las tablas de las colecciones de ejemplo `posts`, `authors` y `tags`:

```bash
pnpm run db:push
```

Sin este paso, el panel de administración se abre igualmente, pero cada colección está vacía y sus llamadas a la API fallan hasta que las tablas existan.

## Introspección de una Base de Datos Existente (Opcional)

Si se está conectando a una base de datos existente con tablas preexistentes, puede introspeccionarla para generar automáticamente sus archivos de colección de TypeScript:

```bash
pnpm rebase schema introspect
```

Esto analizará las tablas, enums y relaciones de su base de datos y escribirá los archivos de colección correspondientes en `config/collections/`.

## Iniciar los Servidores de Desarrollo

```bash
pnpm dev
```

Esto inicia ambos a la vez:
- **Backend** — API REST, autenticación, almacenamiento, WebSocket
- **Frontend** — el panel de administración de Rebase
- **Recarga en caliente** para ambos — los cambios surten efecto al instante

Ambos puertos se **derivan de la ruta del proyecto** en lugar de ser fijos, así que
varios proyectos Rebase pueden ejecutarse a la vez. `rebase dev` imprime las dos
URLs que vinculó — usa esas, no `localhost:3001`/`localhost:5173`. (`PORT` y
`VITE_API_URL` en `.env` configuran `rebase start`, el servidor de producción, y
aquí se ignoran.) Fija un puerto con `rebase dev --port 3001`.

## Primer Inicio de Sesión

Cuando abras la URL del frontend que imprimió `rebase dev`, verás la pantalla de inicio de sesión. El primer usuario en registrarse se convierte automáticamente en administrador — este es el flujo de arranque.

1. Haz clic en **Registrarse**
2. Introduce tu correo electrónico y contraseña
3. Estás dentro — con acceso completo de administrador

## Define tu Primera Colección

Abre `config/collections/` y crea un nuevo archivo. Exporta la colección como **export por defecto** — así es como el registro la detecta:

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
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
            admin: { multiline: true }
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create"
        }
    }
});

export default productsCollection;
```

Luego regístrala en `config/collections/index.ts` para que tanto el backend como el panel de administración la conozcan:

```typescript title="config/collections/index.ts" {2,5}
// ...imports existentes
import productsCollection from "./products.js";

export const collections = [
    postsCollection, authorsCollection, tagsCollection, usersCollection, productsCollection
];
```

## Crear la Tabla

Envía la nueva colección a la base de datos:

```bash
pnpm run db:push
```

Esto regenera el esquema a partir de tus colecciones y lo aplica. Reinicia los servidores de desarrollo y tu nueva colección de **Productos** aparecerá en la navegación.

## Referencia de Comandos de Base de Datos

| Comando | Descripción |
|---------|-------------|
| `rebase schema generate` | Genera el esquema de Drizzle a partir de tus colecciones de TypeScript |
| `rebase schema introspect` | Genera colecciones de TypeScript a partir de una base de datos existente |
| `rebase db push` | Envía los cambios de esquema directamente a la base de datos (solo desarrollo) |
| `rebase db generate` | Genera archivos de migración SQL |
| `rebase db migrate` | Ejecuta las migraciones pendientes |

## Qué Sigue

- **[Estructura del Proyecto](/docs/getting-started/project-structure)** — Comprende el código generado
- **[Colecciones](/docs/collections)** — Profundiza en la definición del esquema
- **[Entorno y Configuración](/docs/getting-started/configuration)** — Todas las opciones de configuración
- **[Despliegue](/docs/getting-started/deployment)** — Despliega a producción
