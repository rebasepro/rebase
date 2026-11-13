---
sourceHash: c6b361597710219f
title: Estructura del proyecto
sidebar_label: Estructura del proyecto
description: "La estructura de un proyecto Rebase: las tablas en backend/schema, los módulos del backend que lee el runtime y las personalizaciones del panel de administración en frontend/src/cms, con y sin el panel."
---

:::note[Seis palabras que utiliza esta página]
Cada una de ellas significa algo específico aquí, y la mayoría significa algo diferente en otros lugares de la industria.

- **Table** — una tabla de Postgres, declarada en TypeScript con `defineTable` en
  `backend/schema/`. El SQL, las políticas de seguridad a nivel de fila (row-level security), la API, los
  tipos del SDK y los valores predeterminados del panel de administración provienen de ella.
- **Collection** — lo que muestra el panel de administración: una tabla renderizada como una lista y un
  formulario, personalizada en `frontend/src/cms/`, o una colección de Firestore que el panel
  lee directamente.
- **Studio** — la parte para desarrolladores del panel de administración: editor de esquemas, consola SQL,
  explorador de políticas. La misma aplicación que utiliza tu equipo de contenido, detrás de un interruptor.
- **Managed runtime** — la imagen publicada `rebasepro/server` inicia tu
  proyecto. No escribes ningún archivo de servidor y obtienes actualizaciones del runtime sin necesidad de
  recompilar. La alternativa es `rebase eject`, más abajo.
- **Bundle** — lo que produce `rebase build`: tus tablas, funciones y crons,
  compilados, con un manifiesto que indica dónde se encuentra cada uno. Es lo que inicia el
  runtime administrado.
- **Resource** — algo que el proyecto necesita del lugar donde se ejecuta: una base de datos,
  un bucket, un topic. Declarado en `backend/resources.ts`, vinculado mediante variables de
  entorno.
:::

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`rebase init` genera una de dos estructuras iniciales. Ambas tienen el mismo `backend/`; la
diferencia radica en si el proyecto incluye o no el panel de administración.

**Con el panel de administración** (por defecto):

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── tsconfig.json           # Typechecks scripts/; each workspace typechecks on its own
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
├── scripts/
│   └── example.ts          # A health check and an SDK call to uncomment: `pnpm example`
│
├── backend/
│   ├── schema/             # Your tables
│   │   ├── index.ts        # Exports every table, and the optional defaultRls
│   │   ├── posts.ts        # defineTable("posts", …)
│   │   └── users.ts        # defineAuthTable("users", …)
│   ├── resources.ts        # What this project needs from wherever it runs
│   ├── storage.ts          # Who may read, write and list files (storageAuthorize)
│   ├── functions/          # Custom API routes, auto-mounted at /api/functions/<name>
│   │   └── hello.ts
│   └── src/
│       └── schema.generated.ts   # Drizzle schema, regenerated from your tables
│
└── frontend/               # The admin panel (React + Vite)
    ├── src/
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── cms/            # How tables look in the panel: customizeTable(...)
    │       └── posts.tsx
    └── vite.config.ts
```

**Solo backend** (`rebase init --headless`): el mismo `backend/`, sin
`frontend/` — y tampoco `backend/schema/`. El servidor lee las tablas de la
propia base de datos al arrancar y sirve cada una que tenga habilitada la seguridad a nivel de fila. Consulta
[Solo backend](/docs/getting-started/headless/).

```
my-api/
├── .env
├── rebase.json
├── package.json
└── backend/
    ├── storage.ts
    └── functions/
```

Aparecen dos archivos más cuando los necesitas, y el runtime lee ambos:
`backend/hooks.ts`, cuya exportación `hooks` se ejecuta para cada tabla
([Hooks globales](/docs/backend/hooks/)), y `backend/crons/`, para tareas
programadas. `rebase generate-sdk --register` añade `backend/generated/`.

`tsc --noEmit` en la raíz comprueba `scripts/`; en `backend/` o `frontend/`
comprueba ese workspace específico. No hay un paquete `config/` separado: el frontend
importa una tabla de `backend/schema` solo como un tipo (`import type`). Una importación
de valor de cualquier cosa bajo `backend/` enviaría código del servidor —hooks y los
secretos que leen— al navegador, por lo que `rebaseBackendGuard()` de
`@rebasepro/app/vitePlugin`, en el `frontend/vite.config.ts` del scaffold, hace fallar
`vite build` y `vite dev` cuando cualquier cosa resuelve hacia `backend/`, indicando el
importador, la importación y el archivo. `rebase build` rechaza un frontend que no lo
incluya. Para añadirlo a un proyecto existente, impórtalo y agrega `rebaseBackendGuard()`
a `plugins` en `frontend/vite.config.ts`.

:::note[No existe `backend/src/index.ts`]
Y ningún `Dockerfile`. Un proyecto generado declara `runtime: "managed"` en
`rebase.json`, lo que significa que la **imagen publicada de `rebasepro/server` arranca tu
proyecto como un bundle** —el mismo artefacto tanto si lo autoalojas como si lo despliegas
en Rebase Cloud. Configuras el servidor mediante `rebase.json`, los archivos en
`backend/` y variables de entorno en lugar de escribir un punto de entrada.

Si deseas tener el control total del proceso —tus propios middlewares, tus propias rutas, tu
propia configuración de autenticación—, `rebase eject` genera el punto de entrada, un Dockerfile y un
archivo compose que los construye. Consulta [Integración de servidor personalizado](/docs/backend/custom-server).
:::

## Tablas (`backend/schema/`)

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Las tablas son la **única fuente de verdad** para tu modelo de datos:

```typescript title="backend/schema/products.ts"
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        name:  col.text().notNull(),
        price: col.numeric(),
    },
    rls: "admin-only",
});
```

El nombre se convierte en el endpoint REST (`/api/data/products`), el nombre de la tabla en
Postgres y la ruta del panel; `table` y `slug` los sobrescriben. `rls` es
obligatorio. Una tabla se toma en cuenta una vez que `backend/schema/index.ts` la exporta — un
`defineTable` que el índice omita impedirá el arranque. [Tablas](/docs/schema/)
cubre todas las opciones.

## Frontend (`frontend/`)

El frontend es una aplicación estándar de **Vite + React + TypeScript**. El archivo clave es `App.tsx`, el cual conecta todos los controladores de Rebase:

```tsx title="frontend/src/App.tsx"
import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { postsCms } from "./cms/posts";
import { authorsCms } from "./cms/authors";
import { tagsCms } from "./cms/tags";
import { usersCms } from "./cms/users";
// How the collection editor laid out the tables in development (labels, columns, views).
import uiConfig from "./cms/ui-config.json";

// `rebase dev` injects VITE_API_URL with the port it actually bound, and that
// port is derived from this project's path rather than fixed — so a
// `http://localhost:3001` fallback here names a port nothing is listening on.
// A deployed build serves the admin from the same origin as the API, where an
// empty value is exactly what you want.
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// One client for the page, created when this module loads. Inside a component,
// even in a `useMemo`, `<React.StrictMode>` builds a second one in development,
// and both restore the session and open their own connections.
const rebaseClient = createRebaseClient({
    baseUrl: API_URL,
    // Store the refresh token in an httpOnly cookie (XSS-safe) rather than
    // localStorage. The backend issues it via `auth.cookieAuth`.
    auth: { authFlowMode: "cookie" }
});

export function App() {
    const authController = useRebaseAuthController({
        client: rebaseClient,
        googleClientId: GOOGLE_CLIENT_ID
    });

    return (
        <ErrorBoundary fullPage>
            <Rebase
                client={rebaseClient}
                authController={authController}
            >
                {/* The sign-in screen. On its own this changes nothing —
                    it is where you pass `loginView` to replace it. */}
                <RebaseAuth />
                {/* Every table the backend serves gets an admin view with no
                    code. A file in ./cms changes how one of them looks:
                    labels, icons, enum colours, custom fields and actions. */}
                <RebaseCMS tableCustomizations={[postsCms, authorsCms, tagsCms, usersCms]} uiConfig={uiConfig} />
                <RebaseStudio/>
                <RebaseShell title="Rebase"/>
            </Rebase>
        </ErrorBoundary>
    );
}
```

`main.tsx` lo monta bajo un `basename` de `react-router` tomado de
`import.meta.env.BASE_URL`, el cual `rebase build` establece a partir del `path` que
declara esta aplicación en `rebase.json` — de modo que los assets, el enrutador y el servidor
coincidan en un único valor sin necesidad de escribirlo tres veces.

### Conceptos clave

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- **`createRebaseClient`** — Crea el cliente SDK que gestiona las solicitudes HTTP, las conexiones WebSocket y la administración de tokens de autenticación. Llámalo una sola vez, en el alcance del módulo: dentro de un componente, incluso en un `useMemo`, `<React.StrictMode>` construye un segundo cliente en desarrollo
- **`<RebaseCMS tableCustomizations>`** — el panel renderiza cada tabla que el backend sirve en `GET /api/schema/tables`; los objetos `customizeTable` de `frontend/src/cms/` modifican la apariencia de algunas de ellas, y `uiConfig` traslada lo que el editor de colecciones guardó en desarrollo. Consulta [Personalización de una tabla](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences)
- **`useRebaseAuthController`** — Contiene el usuario autenticado y el ciclo de vida del token, y es lo que `<Rebase>` distribuye a todos los componentes que están debajo

## Backend (`backend/`)

No hay un archivo de servidor que leer, y así es por diseño: un proyecto generado
declara `runtime: "managed"`, por lo que la imagen publicada de `rebasepro/server` arranca
tu proyecto. Lo que contiene `backend/` es el código que el runtime recoge:

| Ruta | Qué es |
|---|---|
| `backend/schema/` | Las tablas y el `defaultRls` que exporta su índice |
| `backend/resources.ts`, `backend/storage.ts`, `backend/hooks.ts` | Recursos declarados, `storageAuthorize` y hooks globales de tablas |
| `backend/functions/` | Rutas personalizadas, montadas automáticamente en `/api/functions/<filename>` |
| `backend/crons/` | Tareas programadas, descubiertas de la misma manera (créalo cuando necesites uno) |
| `backend/src/schema.generated.ts` | El esquema de Drizzle de tus tablas: escrito por `rebase init` y regenerado en cada `rebase dev` y `rebase build` |

El runtime configura:

- **API REST** en `/api/data/*` — CRUD generado para cada tabla
- **Autenticación (Auth)** en `/api/auth/*` — registro, inicio de sesión, refresco de token, OAuth
- **Almacenamiento (Storage)** en `/api/storage/*` — subida y descarga de archivos
- **WebSocket** — sincronización en tiempo real mediante LISTEN/NOTIFY de Postgres
- **Tus funciones y crons**, a partir de los directorios anteriores

La configuración proviene de `rebase.json`, los archivos en `backend/` y variables de
entorno. Consulta [Entorno y configuración](/docs/getting-started/configuration).

`rebase build` convierte todo esto en un **bundle** —las tablas, funciones y crons
compilados junto con un manifiesto— que el runtime administrado arranca. Nada del bundle
se escribe a mano; si deseas ver uno, [Runtime y bundles](/docs/architecture/runtime-and-bundles/)
explica lo que contiene.

El panel que sirve el frontend tiene dos partes. **Studio** es la parte para desarrolladores —el
editor de esquemas, la consola SQL, el explorador de políticas RLS— y se encuentra detrás del
selector en el menú lateral desplegable, no como un despliegue independiente. Consulta [Studio](/docs/studio/).

Para tomar el control del proceso en su lugar —tus propios middlewares, rutas y
configuración de autenticación—, ejecuta `rebase eject`. **Todo lo que se describe a continuación de este párrafo aplica únicamente a proyectos con "eject"**:
un proyecto generado inicialmente no tiene ninguno de esos archivos y nada en él llama a
`initializeRebaseBackend`. Escribe un punto de entrada que llama a
`initializeRebaseBackend` directamente, además de un Dockerfile y un archivo compose que lo
construye; a partir de ese momento, tú mantienes el servidor y las actualizaciones del runtime
de la plataforma ya no llegarán al proyecto. Dicha interfaz está documentada en
[Integración de servidor personalizado](/docs/backend/custom-server).

## Cómo se conectan

<span class="since-badge" data-since="0.31">Desde 0.31</span>

1. **Tú declaras** las tablas en `backend/schema/`
2. **El backend** las compila, crea las tablas y políticas, y monta las rutas REST, de tiempo real y MCP
3. **El panel de administración** las lee desde `GET /api/schema/tables` y renderiza una vista para cada una, modificada por los archivos en `frontend/src/cms/`
4. **La CLI** las lee para generar el esquema de Drizzle (`rebase schema generate`), los tipos del SDK (`rebase generate-sdk`) y, a partir de ese esquema, los archivos de migración (`rebase db generate`)

Mientras `rebase dev` está en ejecución, guardar un archivo bajo `backend/schema/`
regenera `backend/src/schema.generated.ts` y los tipos del SDK en
`generated/sdk/`, reinicia el backend y, al arrancar, crea las tablas y columnas
faltantes. Fuera de `rebase dev`, los mismos pasos se realizan con `rebase schema generate`
y `rebase generate-sdk`.

Un proyecto anterior a la versión 0.31 tiene en su lugar un directorio `config/collections/`.
Todos los comandos lo rechazarán y sugerirán ejecutar `rebase migrate collections-to-tables`,
que lo migra — consulta [la guía de actualización](/docs/upgrading/0-30-to-0-31/).

## Próximos pasos

- **[Inicio rápido](/docs/getting-started/quickstart)** — Comienza con un nuevo proyecto de Rebase
- **[Tablas](/docs/schema/)** — Declara tu modelo de datos
- **[Configuración](/docs/getting-started/configuration)** — Todas las variables de entorno y opciones
