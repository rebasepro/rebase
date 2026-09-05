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

Nada de base de datos que instalar, y sin Docker. `rebase dev` ejecuta un PostgreSQL gestionado para el proyecto, con sus datos en `.rebase/`. Consulta [Variante: usar tu propia PostgreSQL](#variante-usar-tu-propia-postgresql) si prefieres aportar el tuyo — una instalación local, Neon, Supabase o el contenedor que incluye esta estructura.

## Tu Entorno Ya Está Configurado

`init` genera un archivo `.env` listo para usar en la raíz del proyecto, con un `JWT_SECRET` real, una contraseña de base de datos y un puerto de base de datos local libre. No necesitas crear ni editar nada para empezar.

:::caution
No ejecutes `cp .env.example .env`. `.env.example` es una referencia de las variables disponibles — copiarlo sobre tu `.env` descarta los secretos generados y apunta `DATABASE_URL` a una base de datos que no existe. Edita `.env` directamente si quieres cambiar un valor.
:::

Si prefieres apuntar a tu propio PostgreSQL en lugar del contenedor incluido, edita `DATABASE_URL` en `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

## Iniciar los Servidores de Desarrollo

```bash
pnpm install
pnpm run dev
```

Ese es todo el primer arranque. No hay base de datos que instalar ni paso de
esquema: sin `DATABASE_URL` definida, `rebase dev` levanta una **PostgreSQL
gestionada (PGlite)** dentro del directorio del proyecto, genera el esquema de
Drizzle a partir de tus colecciones y crea las tablas en el arranque — incluidas
las de ejemplo `posts`, `authors` y `tags`.

Arranca las dos mitades a la vez:

- **Backend** — API REST, auth, almacenamiento, WebSocket
- **Frontend** — el panel de administración de Rebase
- **Recarga en caliente** para ambos

Los dos puertos se **derivan de la ruta de este proyecto** en lugar de ser fijos,
así que varios proyectos Rebase pueden convivir. `rebase dev` imprime las dos
URLs a las que se enlazó: **usa esas**, no `localhost:3001` / `localhost:5173`.
(`PORT` y `VITE_API_URL` en `.env` configuran `rebase start`, el servidor de
producción, y aquí se ignoran.) Fija un puerto con `rebase dev --port 3001`.

### Flags que conviene conocer

| Flag | En | Qué hace |
|---|---|---|
| `--yes` | `init` | Acepta todos los valores por defecto. **Obligatorio cuando no hay terminal que preguntar**, como en CI |
| `--headless` | `init` | Un backend sin archivos de colección y sin UI |
| `--template <nombre>` | `init` | Parte de una plantilla distinta de la predeterminada |
| `--install` / `--no-install` | `init` | Ejecuta el gestor de paquetes por ti, o no |
| `--docker` | `dev` | Usa PostgreSQL en un contenedor en lugar de la gestionada |
| `--no-db` | `dev` | No toca ninguna base de datos; la traes tú |

## Variante: usar tu propia PostgreSQL

La base de datos gestionada es una comodidad, no un requisito. Para apuntar el
proyecto a una PostgreSQL tuya, descomenta `DATABASE_URL` en `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Después arranca los servidores como arriba. Una `DATABASE_URL` ya definida nunca
se toca, y una que apunte fuera de esta máquina se deja completamente en paz.

Con tu propia base de datos dispones además de los comandos de migración, que la
gestionada no puede ofrecer: planifican los cambios con Atlas, que necesita una
segunda base de datos vacía con la que comparar, y PGlite sirve exactamente una:

```bash
pnpm run db:push
```

El arranque ya crea las tablas que faltan de forma aditiva, así que `db push` es
para las dos cosas que deja de lado a propósito: la RLS de las tablas puente en
relaciones muchos a muchos, y cualquier cambio que no sea puramente aditivo —una
columna renombrada, un tipo restringido, un campo eliminado.

El scaffold también incluye un `docker-compose.yml` con un servicio PostgreSQL,
si prefieres un contenedor a una Postgres instalada:

```bash
docker compose up -d db
```

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

Envía la nueva colección a la base de datos:

```bash
pnpm run db:push
```

Esto regenera el esquema a partir de tus colecciones y lo aplica. Reinicia los servidores de desarrollo y tu nueva colección de **Productos** aparecerá en la navegación.

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
