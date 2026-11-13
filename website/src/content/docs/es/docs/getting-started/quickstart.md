---
sourceHash: 04353ad7d35cfe5c
title: Inicio rápido
sidebar_label: Inicio rápido
description: Crea un nuevo proyecto de Rebase y ponlo en marcha localmente en menos de 2 minutos.
---

## Crear un nuevo proyecto

```bash
pnpm dlx @rebasepro/cli init my-app
```

Esto genera la estructura de un proyecto con dos paquetes. Si términos como *table*, *collection*,
*Studio*, *managed runtime*, *bundle* o *resource* son nuevos para ti, el cuadro en
[Project Structure](/docs/getting-started/project-structure/) los define.

| Carpeta | Descripción |
|---------|-------------|
| `backend/` | Tus tablas (`backend/schema/`), lo que el runtime lee junto a ellas (`resources.ts`, `storage.ts`), tus funciones y tareas programadas (crons), y el esquema generado de Drizzle. No hay un archivo de servidor: el runtime publicado inicializa el proyecto |
| `frontend/` | SPA de React — Vite + TypeScript con la interfaz de administración de Rebase y las personalizaciones de sus tablas en `src/cms/` |

## Requisitos previos

- **Node.js** 22.22+ — cada estructura generada, incluida la versión headless, declara `"node": ">=22.22.0"`
- **pnpm** (recomendado) o npm

Sin bases de datos que instalar ni Docker. `rebase dev` ejecuta un PostgreSQL administrado para el proyecto, con sus datos bajo `.rebase/`. Consulta [Variante: usar tu propio PostgreSQL](#variante-usar-tu-propio-postgresql) si prefieres proporcionar uno: una instalación local, Neon, Supabase o el contenedor incluido en este proyecto.

## Tu entorno ya está configurado

`init` genera un archivo `.env` listo para usar en la raíz del proyecto con un `JWT_SECRET` real, una contraseña para la base de datos y un puerto libre para la base de datos local. No necesitas crear ni editar nada para comenzar.

:::caution
No ejecutes `cp .env.example .env`. `.env.example` es solo una referencia de las variables disponibles; copiarlo sobre tu `.env` descartará los secretos generados: `JWT_SECRET`, la clave de servicio, la contraseña de la base de datos y las credenciales del primer administrador, que allí aparecen en blanco o comentadas. Edita `.env` directamente si deseas cambiar un valor.
:::

## Iniciar los servidores de desarrollo

```bash
cd my-app
pnpm install
pnpm run dev
```

Eso es todo para la primera ejecución. No hay ninguna base de datos que instalar ni pasos para el esquema:
sin una variable `DATABASE_URL` configurada, `rebase dev` inicia un **PostgreSQL administrado (PGlite)**
en el directorio del proyecto, genera el esquema de Drizzle a partir de tus tablas y
crea las tablas al arrancar, incluidas las tablas de ejemplo `posts`, `authors` y `tags`.

Inicia ambas partes juntas:

- **Backend** — API REST, autenticación, almacenamiento, WebSocket
- **Frontend** — el panel: Rebase CMS y Rebase Studio
- **Hot reload** para ambos

Ambos puertos se **derivan de la ruta de este proyecto** en lugar de ser fijos, por lo que varios
proyectos de Rebase pueden ejecutarse en paralelo. `rebase dev` imprime las dos URLs que vinculó —
**usa esas**, no `localhost:3001` / `localhost:5173`. (`PORT` y `VITE_API_URL`
en `.env` configuran `rebase start`, que ejecuta el bundle compilado, y aquí se ignoran).
Fija un puerto con `rebase dev --port 3001`.

### Flags útiles

| Flag | En | Qué hace |
|---|---|---|
| `--yes` | `init` | No preguntar nunca. **Obligatorio cuando no hay una terminal para responder**, como en CI. Omite git init y la instalación de dependencias (los valores interactivos predeterminados aceptan ambos, así que pasa `--git` / `--install` si los deseas) |
| `--headless` | `init` | Un backend sin `backend/schema/` y sin interfaz de usuario, que sirve las tablas de tu propia base de datos — consulta [Backend only](/docs/getting-started/headless/) |
| `--template <name>` | `init` | Comenzar desde una plantilla distinta a la predeterminada |
| `--install` / `--no-install` | `init` | Ejecutar el gestor de paquetes automáticamente, o no hacerlo |
| `--docker` | `dev` | Usar PostgreSQL en un contenedor en lugar del administrado. Los demás comandos lo seguirán hasta que `rebase dev` se ejecute sin él. Una variable `DATABASE_URL` tiene prioridad: en ese caso no inicia nada y muestra un aviso |
| `--no-db` | `dev` | No iniciar ninguna base de datos, ni el contenedor ni la administrada. Debes configurar `DATABASE_URL` tú mismo |

## Variante: usar tu propio PostgreSQL

La base de datos administrada es una comodidad, no un requisito. Para apuntar el proyecto a
un Postgres que tengas en ejecución, descomenta `DATABASE_URL` en `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Luego inicia los servidores de desarrollo como se indicó anteriormente. Un `DATABASE_URL` configurado
nunca se modifica, y uno que apunte a cualquier lugar fuera de esta máquina se deja
completamente intacto.

Los comandos de migración planifican los cambios con [Atlas](https://atlasgo.io/), el
motor de migración de esquemas con el que Rebase planifica, el cual necesita una segunda base de datos vacía para
comparar. En tu propia base de datos, Rebase crea una base de datos secundaria junto a ella; en la
administrada, que sirve exactamente una base de datos, inicia una instancia desechable de PGlite durante
la duración del comando.
De cualquier manera:

```bash
pnpm run db:push
```

El arranque ya crea de forma acumulativa las tablas faltantes —y sus
políticas de [RLS](/docs/collections/security-rules/), la seguridad a nivel de fila de PostgreSQL,
que es como Rebase controla quién puede leer una fila—, por lo
que `db push` es para lo que intencionalmente se deja sin modificar: cualquier cambio que no sea
puramente acumulativo (una columna renombrada, un tipo restringido o un campo eliminado).

El proyecto generado también incluye un `docker-compose.yml` con un servicio de PostgreSQL, si
prefieres usar un contenedor en lugar de un Postgres instalado:

```bash
docker compose up -d db
```

## Inspeccionar una base de datos existente (Opcional)

<span class="since-badge" data-since="0.31">Since 0.31</span>

Si te estás conectando a una base de datos existente con tablas previas, puedes inspeccionarla para generar un archivo `defineTable` para cada una:

```bash
pnpm rebase schema introspect
```

Esto lee cada tabla, columna, clave foránea y política de seguridad a nivel de fila y escribe `backend/schema/<table>.ts` y el archivo `index.ts` que las exporta, para que no tengas que escribirlas a mano. Consulta [`schema introspect`](/docs/cli/schema/#rebase-schema-introspect).

## Primer inicio de sesión

Cuando abras la URL del frontend que imprimió `rebase dev`, verás la pantalla de inicio de sesión. El **primer usuario** que se registre se convierte automáticamente en administrador; este es el flujo de inicialización (bootstrap).

1. La pantalla se abre en **Welcome!**, el formulario para esa primera cuenta
2. Introduce tu correo electrónico y contraseña, luego haz clic en **Create account**
3. Ya estás dentro, con acceso total de administrador

`rebase init` también escribió `REBASE_ADMIN_EMAIL` y un `REBASE_ADMIN_PASSWORD` generado en `.env`. Esas no son tus credenciales aquí: `rebase dev` las ignora y lo advierte al arrancar. Pertenecen a un arranque en producción (`docker compose up`, o cualquier entorno con `NODE_ENV=production`), donde esta ventana de inicialización está cerrada porque el servidor responde en un nombre de host antes de que hayas escrito nada. Consulta [Your first admin](/docs/getting-started/deployment#your-first-admin).

## Define tu primera tabla

<span class="since-badge" data-since="0.31">Since 0.31</span>

Crea un archivo en `backend/schema/`:

```typescript title="backend/schema/products.ts"
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        name:        col.text().notNull(),
        price:       col.numeric().notNull().validate({ min: 0 }),
        description: col.text(),
        active:      col.boolean().default(true),
        createdAt:   col.timestamp({ withTimezone: true }).onCreateNow(),
    },
    // Takes the defaultRls the scaffold's index.ts exports: everyone reads, admins write.
    rls: "inherit",
});
```

Luego expórtalo desde `backend/schema/index.ts`. El archivo index es lo que el backend,
la CLI y el generador de SDK leen: si no exporta un `defineTable`,
el arranque fallará indicando el nombre del archivo.

```typescript title="backend/schema/index.ts"
// ...existing exports
export { products } from "./products";
```

## Crear la tabla

<span class="since-badge" data-since="0.31">Since 0.31</span>

Guarda el archivo. Ese es todo el paso: `rebase dev` regenera
`backend/src/schema.generated.ts` y los tipos del SDK en `generated/sdk/` a partir de tus
tablas, reinicia el backend y el arranque crea la nueva tabla y sus políticas de
seguridad a nivel de fila — y **Products** aparece en la navegación del panel de administración,
con una lista, un formulario y filtros derivados de las columnas.

Lo mismo aplica para una columna agregada a una tabla existente: guarda y la
columna estará allí.

Para cambiar cómo se ve la tabla en el panel —un editor multilínea para
`description`, un icono, un grupo—, añade un archivo en `frontend/src/cms/` y pásalo
a `<RebaseCMS tableCustomizations>` en `App.tsx`:

```tsx title="frontend/src/cms/products.tsx"
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    icon: "ShoppingCart",
    fields: {
        description: { multiline: true },
    },
});
```

Consulta [Personalizar una tabla](/docs/frontend/customize-table/).

`rebase db push` es para los cambios que el arranque intencionalmente deja sin modificar: una columna
renombrada, un tipo restringido, un campo eliminado:

```bash
pnpm run db:push
```

Se ejecuta tanto en la
base de datos administrada como en la tuya propia.

## Referencia de comandos de base de datos

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Comando | Descripción |
|---------|-------------|
| `rebase schema generate` | Genera el esquema de Drizzle a partir de tus tablas. No se necesita base de datos: `rebase dev` lo ejecuta por ti |
| `rebase schema introspect` | Escribe archivos `defineTable` a partir de una base de datos existente |
| `rebase db push` | Envía los cambios de esquema directamente a la base de datos, incluida la administrada |
| `rebase db generate` | Genera archivos de migración SQL |
| `rebase db migrate` | Ejecuta las migraciones pendientes |

Los tres comandos `db`
funcionan en la base de datos administrada.

## Próximos pasos

- **[Project Structure](/docs/getting-started/project-structure)** — Comprende el código generado
- **[Tables](/docs/schema/)** — Profundiza en la definición del esquema
- **[Environment & Configuration](/docs/getting-started/configuration)** — Todas las opciones de configuración
- **[Deployment](/docs/getting-started/deployment)** — Despliega en producción
