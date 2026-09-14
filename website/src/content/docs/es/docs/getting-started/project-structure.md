---
sourceHash: 8fb63312e30e41a2
title: Estructura del proyecto
sidebar_label: Estructura del proyecto
description: "Conozca la estructura de un proyecto Rebase: frontend, backend y configuración de colecciones."
---

:::note[Cinco palabras que utiliza esta página]
Cada una de ellas significa algo específico aquí, y cuatro de ellas significan algo
diferente en otros ámbitos de la industria.

- **Collection** — una tabla, descrita en TypeScript. El esquema, la API y
  la pantalla de administración provienen del mismo archivo.
- **Studio** — la mitad para desarrolladores del panel de administración: editor de esquemas, consola SQL
  y explorador de políticas. Es la misma aplicación que utiliza su equipo de contenido, detrás de un conmutador (toggle).
- **Managed runtime** — la imagen publicada `rebasepro/server` arranca su
  proyecto. No escribe ningún archivo de servidor y obtiene actualizaciones del runtime sin necesidad de
  recompilar. La alternativa es `rebase eject`, que se explica más adelante.
- **Bundle** — lo que produce `rebase build`: sus colecciones, funciones y
  crons, compilados, con un manifiesto que indica dónde está cada uno. Es lo que
  arranca el runtime administrado.
- **Resource** — algo que el proyecto necesita de dondequiera que se ejecute: una base de datos,
  un bucket, un topic. Se declara en `config/resources.ts` y se vincula mediante variables de
  entorno.
:::

Un proyecto inicial de Rebase consta de tres paquetes interconectados:

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
│
├── config/                 # Shared by the backend and the admin panel
│   ├── index.ts            # Re-exports what the runtime reads (collections, storageAuthorize)
│   ├── collections/        # Your data model
│   │   ├── index.ts        # Exports `collections` and the default security rules
│   │   ├── posts.ts        # Example collections
│   │   └── users.ts        # The auth collection
│   ├── resources.ts        # What this project needs from wherever it runs
│   ├── storage.ts          # Who may read, write and list files
│   └── cms.d.ts            # One line that makes the `admin` block legal here
│
├── backend/
│   ├── functions/          # Custom API routes, auto-mounted at /api/functions/<name>
│   │   └── hello.ts
│   └── src/
│       └── schema.generated.ts   # Drizzle schema, regenerated from your collections
│
└── frontend/               # The admin panel (React + Vite)
    ├── src/App.tsx
    ├── src/main.tsx
    └── vite.config.ts
```

:::note[No existe `backend/src/index.ts`]
Ni tampoco un `Dockerfile`. Un proyecto generado declara `runtime: "managed"` en
`rebase.json`, lo que significa que la **imagen publicada de `rebasepro/server` arranca su
proyecto como un bundle** — el mismo artefacto tanto si lo autohospeda como si lo despliega
en Rebase Cloud. La configuración del servidor se realiza a través de `rebase.json`, `config/` y
variables de entorno, en lugar de escribiendo un punto de entrada.

Si desea tener el control total del proceso — sus propios middlewares, sus propias rutas, su propia
configuración de autenticación — `rebase eject` genera el punto de entrada, un Dockerfile y un archivo
compose para construirlos. Consulte [Custom Server Integration](/docs/backend/custom-server).
:::

## Frontend (`frontend/`)

El frontend es una aplicación estándar de **Vite + React + TypeScript**. El archivo clave es `App.tsx`, que conecta todos los controladores de Rebase:

```typescript title="frontend/src/App.tsx"
import React from "react";

import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

// `rebase dev` injects VITE_API_URL with the port it actually bound, and that
// port is derived from this project's path rather than fixed — so a
// `http://localhost:3001` fallback here names a port nothing is listening on.
// A deployed build serves the admin from the same origin as the API, where an
// empty value is exactly what you want.
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function App() {
    const rebaseClient = React.useMemo(() => createRebaseClient({
        baseUrl: API_URL,
        // Store the refresh token in an httpOnly cookie (XSS-safe) rather than
        // localStorage. The backend issues it via `auth.cookieAuth`.
        auth: { authFlowMode: "cookie" }
    }), []);

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
                <RebaseCMS
                    collections={collections}
                />
                <RebaseStudio/>
                <RebaseShell title="Rebase"/>
            </Rebase>
        </ErrorBoundary>
    );
}
```

`main.tsx` lo monta bajo un `basename` de `react-router` obtenido de
`import.meta.env.BASE_URL`, el cual `rebase build` establece a partir del `path` que esta aplicación
declara en `rebase.json`; de este modo, los assets, el enrutador y el servidor coinciden en
un único valor sin tener que definirlo tres veces.

### Conceptos clave

- **`createRebaseClient`** — Crea el cliente SDK que gestiona las peticiones HTTP, las conexiones WebSocket y la administración de tokens de autenticación
- **`virtual:rebase-collections`** — Un plugin de Vite que importa automáticamente sus colecciones compartidas en tiempo de compilación
- **`useRebaseAuthController`** — Mantiene el usuario autenticado y el ciclo de vida del token, y es lo que `<Rebase>` distribuye a todos los elementos por debajo de él

## Backend (`backend/`)

No hay ningún archivo de servidor que revisar, y ese es el diseño previsto: un proyecto generado
declara `runtime: "managed"`, por lo que la imagen publicada `rebasepro/server` arranca
su proyecto. Lo que contiene `backend/` es el código que el runtime recoge:

| Ruta | Qué es |
|---|---|
| `backend/functions/` | Rutas personalizadas, montadas automáticamente en `/api/functions/<filename>` |
| `backend/crons/` | Tareas programadas, detectadas de la misma manera (créelo cuando necesite una) |
| `backend/src/schema.generated.ts` | El esquema de Drizzle, regenerado a partir de sus colecciones en cada ejecución de `rebase dev` y `rebase build` |

El runtime configura:

- **API REST** en `/api/data/*` — operaciones CRUD generadas para cada colección
- **Autenticación** en `/api/auth/*` — registro, inicio de sesión, refresco, OAuth
- **Almacenamiento** en `/api/storage/*` — subida y descarga de archivos
- **WebSocket** — sincronización en tiempo real mediante LISTEN/NOTIFY de Postgres
- **Sus funciones y crons**, a partir de los directorios indicados arriba

La configuración proviene de `rebase.json`, el directorio `config/` y las variables de
entorno. Consulte [Environment & Configuration](/docs/getting-started/configuration).

`rebase build` convierte todo esto en un **bundle** — las colecciones,
funciones y crons compilados junto con un manifiesto — que el runtime administrado arranca. Nada
en el bundle se escribe a mano; si desea ver uno,
[Runtime & Bundles](/docs/architecture/runtime-and-bundles/) detalla su contenido.

El panel que sirve el frontend tiene dos partes. **Studio** es la destinada a los desarrolladores —
el editor de esquemas, la consola SQL, el explorador de políticas RLS — y se encuentra detrás
del conmutador en el cajón lateral (drawer), no como un despliegue independiente. Consulte [Studio](/docs/studio/).

Para tomar el control completo del proceso — sus propios middlewares, rutas y configuración de
autenticación — ejecute `rebase eject`. **Todo lo que sigue a continuación de este párrafo aplica únicamente a proyectos con eject**:
un proyecto generado no incluye ninguno de esos archivos y nada en él invoca
a `initializeRebaseBackend`. `rebase eject` genera un punto de entrada que llama directamente a
`initializeRebaseBackend`, además de un Dockerfile y un archivo compose que lo
compila; a partir de ese momento, usted mantiene el servidor y las actualizaciones del runtime de la
plataforma ya no se aplican al proyecto. Dicha interfaz está documentada en
[Custom Server Integration](/docs/backend/custom-server).

## Colecciones (`config/collections/`)

Las colecciones son la **única fuente de verdad** para su modelo de datos. Se definen en TypeScript y son consumidas tanto por el frontend (para la generación de la interfaz de usuario) como por el backend (para la generación de esquemas y el enrutamiento de la API).

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    properties: {
        name: { type: "string", name: "Name" },
        price: { type: "number", name: "Price" }
    }
});

// The default export is what the registry picks up — every collection in the
// scaffold is written this way.
export default productsCollection;
```

El `slug` se convierte en la ruta URL en la interfaz de administración y en el endpoint de la API REST (`/api/data/products`), y el nombre de la tabla en PostgreSQL adopta este valor por defecto. Agregue `table` únicamente cuando sean diferentes.

## Cómo se conectan

1. **Usted define** las colecciones en `config/collections/`
2. **El backend** las lee para generar esquemas de Drizzle y montar rutas REST
3. **El frontend** las lee (mediante el plugin de Vite) para renderizar tablas, formularios y navegación
4. **La CLI** las lee para generar archivos de migración con `rebase schema generate`

Mientras `rebase dev` está en ejecución, guardar un archivo en `config/collections/`
regenera `backend/src/schema.generated.ts` y reinicia el backend, y el arranque
crea las tablas y columnas que falten. Fuera de `rebase dev`, el paso equivalente
es `rebase schema generate`.

## Próximos pasos

- **[Inicio rápido](/docs/getting-started/quickstart)** — Comience con un nuevo proyecto Rebase
- **[Configuración](/docs/getting-started/configuration)** — Todas las variables de entorno y opciones
