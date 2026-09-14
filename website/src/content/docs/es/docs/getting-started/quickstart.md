---
sourceHash: 7b2e4e449b0ca1dc
title: Inicio rápido
sidebar_label: Inicio rápido
description: Crea un nuevo proyecto de Rebase y ponlo en marcha localmente en menos de 2 minutos.
---

## Crea un nuevo proyecto

```bash
pnpm dlx @rebasepro/cli init my-app
```

Esto genera la estructura de un proyecto con tres paquetes. Si alguno de los términos *collection*, *Studio*, *managed runtime*, *bundle* o *resource* te resulta nuevo, el cuadro de cinco términos en [Project Structure](/docs/getting-started/project-structure/) los define.



| Carpeta | Descripción |
|---------|-------------|
| `frontend/` | SPA de React — Vite + TypeScript con la UI de administración de Rebase |
| `backend/` | Tus funciones personalizadas y tareas cron, además del esquema generado de Drizzle. No hay archivo de servidor: el runtime publicado arranca el proyecto |
| `config/` | Archivos de configuración y definiciones de colecciones compartidos por ambas partes |

## Requisitos previos

- **Node.js** 22.22+ — cada estructura generada, incluida la headless, declara `"node": ">=22.22.0"`
- **pnpm** (recomendado) o npm

No es necesario instalar ninguna base de datos ni Docker. `rebase dev` ejecuta un PostgreSQL administrado para el proyecto, con sus datos en `.rebase/`. Consulta [Variante: usa tu propio PostgreSQL](#variante-usa-tu-propio-postgresql) si prefieres proporcionar uno: una instalación local, Neon, Supabase o el contenedor que incluye esta estructura inicial.

## Tu entorno ya está configurado

`init` genera un archivo `.env` listo para usar en la raíz del proyecto con un `JWT_SECRET` real, una contraseña de base de datos y un puerto libre para la base de datos local. No necesitas crear ni editar nada para comenzar.

:::caution
No ejecutes `cp .env.example .env`. `.env.example` es una referencia de las variables disponibles; copiarlo sobre tu `.env` descarta los secretos generados y apunta `DATABASE_URL` a una base de datos que no existe. Edita `.env` directamente si deseas cambiar algún valor.
:::

## Inicia los servidores de desarrollo

```bash
pnpm install
pnpm run dev
```

Eso es todo para la primera ejecución. No hay base de datos que instalar ni ningún paso previo de esquemas: sin una variable `DATABASE_URL` configurada, `rebase dev` inicia un **PostgreSQL administrado (PGlite)** en el directorio del proyecto, genera el esquema de Drizzle a partir de tus colecciones y crea las tablas al arrancar, incluidas las de ejemplo: `posts`, `authors` y `tags`.

Inicia ambas partes al mismo tiempo:

- **Backend** — API REST, autenticación, almacenamiento, WebSocket
- **Frontend** — el panel: Rebase CMS y Rebase Studio
- **Recarga en caliente (hot reload)** para ambos

Ambos puertos se **derivan de la ruta de este proyecto** en lugar de ser fijos, por lo que varios proyectos de Rebase pueden ejecutarse en paralelo. `rebase dev` imprime las dos URL a las que se vinculó: **utiliza esas**, no `localhost:3001` / `localhost:5173`. (`PORT` y `VITE_API_URL` en `.env` configuran `rebase start`, el servidor de producción, y se ignoran aquí). Fija un puerto con `rebase dev --port 3001`.

### Flags que vale la pena conocer

| Flag | En | Qué hace |
|---|---|---|
| `--yes` | `init` | No solicitar confirmaciones nunca. **Requerido cuando no hay una terminal para responder**, como en CI. Omite git init y la instalación de dependencias (los valores predeterminados del modo interactivo responden que sí a ambos, así que pasa `--git` / `--install` si los deseas) |
| `--headless` | `init` | Un backend sin archivos de colección y sin interfaz de usuario — consulta [Backend only](/docs/getting-started/headless/) |
| `--template <name>` | `init` | Iniciar desde una plantilla distinta a la predeterminada |
| `--install` / `--no-install` | `init` | Ejecutar el gestor de paquetes por ti, o no hacerlo |
| `--docker` | `dev` | Usar PostgreSQL en un contenedor en lugar del administrado |
| `--no-db` | `dev` | No iniciar ninguna base de datos: ni el contenedor ni la administrada. Configura `DATABASE_URL` tú mismo |

## Variante: usa tu propio PostgreSQL

La base de datos administrada es una comodidad, no un requisito. Para apuntar el proyecto a un Postgres que tú ejecutes, descomenta `DATABASE_URL` en `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Luego, inicia los servidores de desarrollo como se indicó anteriormente. Si se define una variable `DATABASE_URL`, esta nunca se modifica, y si apunta a cualquier lugar fuera de esta máquina, se deja completamente intacta.

Con tu propia base de datos también obtienes los comandos de migración, que la administrada no puede ofrecer; estos planifican los cambios con [Atlas](https://atlasgo.io/), el motor de migración de esquemas con el que Rebase planifica, el cual necesita una segunda base de datos vacía con la cual comparar, y PGlite solo proporciona una:

```bash
pnpm run db:push
```

El arranque ya crea las tablas faltantes de forma aditiva, por lo que `db push` se utiliza para las dos cosas que deliberadamente deja de lado: la [RLS](/docs/collections/security-rules/) (seguridad a nivel de fila de PostgreSQL, que es como Rebase controla quién puede leer una fila) en tablas intermedias para relaciones de muchos a muchos, y cualquier cambio que no sea puramente aditivo: una columna renombrada, un tipo más restringido o un campo eliminado.

La estructura del proyecto también incluye un `docker-compose.yml` con un servicio de PostgreSQL, si prefieres un contenedor en lugar de un Postgres instalado en tu sistema:

```bash
docker compose up -d db
```

## Introspección de una base de datos existente (opcional)

Si te estás conectando a una base de datos existente con tablas preexistentes, puedes realizar una introspección para generar automáticamente tus archivos de colección de TypeScript:

```bash
pnpm rebase schema introspect
```

Esto analizará las tablas de tu base de datos y generará los archivos TypeScript correspondientes en `config/collections/` para que no tengas que escribirlos manualmente.

## Primer inicio de sesión

Cuando abras la URL del frontend que imprimió `rebase dev`, verás la pantalla de inicio de sesión. El **primer usuario** en registrarse se convierte automáticamente en administrador; este es el flujo de inicialización (bootstrap).

1. Haz clic en **Sign Up**
2. Introduce tu correo electrónico y contraseña
3. ¡Listo! Ya estás dentro con acceso total de administrador

`rebase init` también escribió `REBASE_ADMIN_EMAIL` y una contraseña generada `REBASE_ADMIN_PASSWORD` en `.env`. Esas no son tus credenciales en este entorno: `rebase dev` las ignora y lo indica al arrancar. Pertenecen a un arranque en producción (`docker compose up`, o cualquier entorno con `NODE_ENV=production`), donde esta ventana de inicialización está cerrada, ya que el servidor responde en un nombre de host antes de que hayas escrito nada. Consulta [Tu primer administrador](/docs/getting-started/deployment#your-first-admin).

## Define tu primera colección

Abre `config/collections/` y crea un nuevo archivo. Exporta la colección como el **export por defecto (default export)**; así es como el registro la detecta. El nombre de la tabla es opcional: por defecto usa el slug, así que defínelo solo cuando difieran:

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
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

Luego regístrala en `config/collections/index.ts` para que tanto el backend como el panel de administración la reconozcan:

```typescript title="config/collections/index.ts" {2,5}
// ...existing imports
import productsCollection from "./products.js";

export const collections = [
    postsCollection, authorsCollection, tagsCollection, usersCollection, productsCollection
];
```

## Crea la tabla

Guarda el archivo. Eso es todo: `rebase dev` regenera `backend/src/schema.generated.ts` a partir de tus colecciones, reinicia el backend y el arranque crea la nueva tabla, por lo que tu colección **Products** aparecerá en la navegación.

Lo mismo ocurre con una propiedad añadida a una colección que ya tienes: guarda y la columna estará allí.

`rebase db push` es para los cambios que el arranque deja de lado deliberadamente: una columna renombrada, un tipo restringido, un campo eliminado y RLS en tablas intermedias para relaciones de muchos a muchos. Requiere tu propio PostgreSQL:

```bash
pnpm run db:push
```

## Referencia de comandos de base de datos

| Comando | Descripción |
|---------|-------------|
| `rebase schema generate` | Genera el esquema de Drizzle a partir de tus colecciones de TypeScript. No se necesita base de datos: `rebase dev` lo ejecuta por ti |
| `rebase schema introspect` | Genera colecciones de TypeScript a partir de una base de datos existente |
| `rebase db push` | Aplica los cambios de esquema directamente a la base de datos. Requiere tu propio PostgreSQL |
| `rebase db generate` | Genera archivos de migración SQL. Requiere tu propio PostgreSQL |
| `rebase db migrate` | Ejecuta las migraciones pendientes. Requiere tu propio PostgreSQL |

## Próximos pasos

- **[Estructura del proyecto](/docs/getting-started/project-structure)** — Comprende el código generado
- **[Colecciones](/docs/collections)** — Profundiza en la definición del esquema
- **[Entorno y configuración](/docs/getting-started/configuration)** — Todas las opciones de configuración
- **[Despliegue](/docs/getting-started/deployment)** — Despliega en producción
