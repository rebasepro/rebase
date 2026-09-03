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
- **pnpm** (recomendado) o npm

Nada de base de datos que instalar, y **sin Docker**. `rebase dev` ejecuta un PostgreSQL gestionado para el proyecto, con sus datos en `.rebase/`. Consulta [Usa tu propio PostgreSQL](#usa-tu-propio-postgresql) si prefieres aportar el tuyo — una instalación local, Neon, Supabase o el contenedor que incluye esta estructura.

## Tu Entorno Ya Está Configurado

`init` genera un archivo `.env` listo para usar en la raíz del proyecto, con un `JWT_SECRET` real, una contraseña de base de datos y un puerto de base de datos local libre. No necesitas crear ni editar nada para empezar.

:::caution
No ejecutes `cp .env.example .env`. `.env.example` es una referencia de las variables disponibles — copiarlo sobre tu `.env` descarta los secretos generados y apunta `DATABASE_URL` a una base de datos que no existe. Edita `.env` directamente si quieres cambiar un valor.
:::

## Iniciar los Servidores de Desarrollo

```bash
pnpm install   # only if you declined the install `init` offered
pnpm dev
```

Esa es toda la primera ejecución — no hay base de datos que arrancar ni paso de esquema que recordar. `rebase dev` hace tres cosas antes de servir:

1. Genera `backend/src/schema.generated.ts` a partir de `config/collections/`.
2. Arranca un PostgreSQL gestionado para este proyecto, con sus datos en `.rebase/`.
3. Aplica tus colecciones, de modo que existan las tablas de ejemplo `posts`, `authors` y `tags`.

Después arranca las dos mitades a la vez:

- **Backend** — API REST, autenticación, almacenamiento, WebSocket
- **Frontend** — el panel de administración de Rebase
- **Recarga en caliente** para ambos — los cambios surten efecto al instante

Ambos puertos se **derivan de la ruta del proyecto** en lugar de ser fijos, así que
varios proyectos Rebase pueden ejecutarse a la vez. `rebase dev` imprime las dos
URLs que vinculó — usa esas, no `localhost:3001`/`localhost:5173`. (`PORT` y
`VITE_API_URL` en `.env` configuran `rebase start`, el servidor de producción, y
aquí se ignoran.) Fija un puerto con `rebase dev --port 3001`.

## Usa tu propio PostgreSQL

`DATABASE_URL` está comentada en `.env` a propósito — eso es lo que hace que la base de datos gestionada sea la opción por defecto. Apúntala a cualquier PostgreSQL que quieras (una instalación local, Neon, Supabase) y prevalecerá sobre la gestionada:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

La estructura también incluye un `docker-compose.yml` con un servicio de PostgreSQL, y la URL que ya está en `.env` apunta a él. Descomenta esa línea y luego:

```bash
docker compose up -d db
pnpm run db:push
pnpm dev
```

`db:push` es lo que crea las tablas de tus colecciones en una base de datos que Rebase no gestiona por ti.

:::caution
`db:push`, `db:generate` y `db:migrate` planifican sus cambios con [Atlas](https://atlasgo.io), que compara tu esquema con una segunda base de datos vacía. La base de datos de desarrollo gestionada sirve exactamente una, así que las tres se niegan a ejecutarse contra ella y lo dicen, en lugar de fallar a medias. Allí no las necesitas: `rebase dev` aplica tus colecciones al arrancar. Recurre a ellas cuando estés sobre un PostgreSQL propio, y para migraciones, eliminaciones y renombrados de columnas.
:::

## Introspección de una Base de Datos Existente (Opcional)

Si se está conectando a una base de datos existente con tablas preexistentes, puede introspeccionarla para generar automáticamente sus archivos de colección de TypeScript:

```bash
pnpm rebase schema introspect
```

Esto analizará las tablas, enums y relaciones de su base de datos y escribirá los archivos de colección correspondientes en `config/collections/`.

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

Reinicia `rebase dev`. Regenera el esquema a partir de tus colecciones y aplica la nueva tabla antes de servir, así que **Productos** aparece en la navegación.

Sobre un PostgreSQL propio, ese es en cambio el trabajo de `db:push`:

```bash
pnpm run db:push
```

## Referencia de Comandos de Base de Datos

| Comando | Descripción |
|---------|-------------|
| `rebase schema generate` | Genera el esquema de Drizzle a partir de tus colecciones de TypeScript. No necesita base de datos — `rebase dev` lo ejecuta por ti |
| `rebase schema introspect` | Genera colecciones de TypeScript a partir de una base de datos existente |
| `rebase db push` | Envía los cambios de esquema directamente a la base de datos. Necesita tu propio PostgreSQL |
| `rebase db generate` | Genera archivos de migración SQL. Necesita tu propio PostgreSQL |
| `rebase db migrate` | Ejecuta las migraciones pendientes. Necesita tu propio PostgreSQL |

## Qué Sigue

- **[Estructura del Proyecto](/docs/getting-started/project-structure)** — Comprende el código generado
- **[Colecciones](/docs/collections)** — Profundiza en la definición del esquema
- **[Entorno y Configuración](/docs/getting-started/configuration)** — Todas las opciones de configuración
- **[Despliegue](/docs/getting-started/deployment)** — Despliega a producción
