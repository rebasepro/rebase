---
title: Despliegue
sidebar_label: Despliegue
description: Despliega tu proyecto Rebase a producción usando Docker, plataformas en la nube o configuraciones manuales.
---

## Qué Sirve un Despliegue

Un proyecto Rebase se despliega como **un servidor en una URL** (en Rebase Cloud: `https://<project>.rebase.website`). Ese servidor gestiona:

- **`/api/*`** — la API de datos, la autenticación, el tiempo real y el almacenamiento
- **todo lo demás** — tu `frontend/` compilado como una SPA estática

No hay una URL de administración separada: el panel de administración forma parte de tu frontend, por lo que dónde aparece depende de qué sea tu frontend.

| Tipo de proyecto | La URL raíz muestra | El panel de administración está en |
|--------------|----------------|-------------------|
| Scaffold predeterminado (`rebase init`) | El panel de administración | `/` — el frontend **es** el administrador |
| Frontend de producto personalizado | Tu app | Donde lo montes, comúnmente `/admin` — consulta [Cambiar la URL Base](#changing-the-base-url) |
| Proyecto solo backend | Nada (solo API) | No desplegado |

:::note[Primera visita]
En la primera visita al administrador de un despliegue nuevo, Rebase muestra una pantalla de bootstrap para **crear tu cuenta de administrador**. La primera cuenta registrada recibe privilegios de administrador — reclámala justo después de desplegar.
:::

## Docker Compose (Recomendado)

El proyecto generado incluye un `Dockerfile` y un `docker-compose.yml`. Esta es la forma más sencilla de desplegar:

```yaml title="docker-compose.yml"
services:
  postgres:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: rebase
      POSTGRES_DB: rebase
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  app:
    build:
      context: .
      dockerfile: backend/Dockerfile
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://rebase_app:rebase@postgres:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    depends_on:
      - postgres
    volumes:
      - uploads:/app/uploads

volumes:
  pgdata:
  uploads:
```

```bash
docker compose up -d
```

:::note
El `docker-compose.yml` generado por Rebase es la fuente de verdad y ya usa este contexto de compilación (la raíz del proyecto con `dockerfile: backend/Dockerfile`); el ejemplo anterior solo lo reproduce. El Dockerfile del backend necesita todo el workspace como contexto (`pnpm-workspace.yaml`, `backend/`, `config/`), por lo que `build: ./backend` fallaría.
:::

## Crear el Esquema de la Base de Datos

Al arrancar, Rebase crea automáticamente **solo las tablas de autenticación**. Las tablas de tus propias colecciones **no se crean automáticamente**. Aplica el esquema una vez contra la base de datos de producción:

```bash
pnpm run db:push
```

Si omites este paso, la aplicación arranca con normalidad y el inicio de sesión funciona —esa es la trampa—, pero cada colección devuelve un error de «tabla inexistente» (*missing table*) en su primera consulta. Ejecútalo desde un checkout del proyecto o desde CI con `DATABASE_URL` apuntando a producción, **no dentro del contenedor**: la imagen de producción se distribuye sin la CLI. Para migraciones versionadas, usa `pnpm run db:generate` + `pnpm run db:migrate` en lugar de `pnpm run db:push`.

## Lista de Verificación para Producción

Antes de desplegar en producción, asegúrate de:

| Elemento | Detalles |
|------|---------|
| **JWT_SECRET** | Usa una cadena aleatoria criptográficamente fuerte (≥ 32 caracteres). Nunca la reutilices entre entornos. |
| **DATABASE_URL** | Usa una instancia de Postgres gestionada (Neon, Supabase, RDS) con TLS habilitado |
| **Esquema de la base de datos** | Ejecuta `pnpm run db:push` una vez contra la base de datos de producción para crear las tablas de tus colecciones (al arrancar, Rebase solo crea las tablas de autenticación) |
| **CORS** | Configura los orígenes permitidos en tu backend si el frontend y el backend están en dominios diferentes |
| **Volúmenes de almacenamiento** | Monta volúmenes persistentes para las subidas de archivos. O cambia a S3 para producción. |
| **HTTPS** | Termina TLS en tu proxy inverso (nginx, Cloudflare, balanceador de carga) |
| **Registro** | Establece `ALLOW_REGISTRATION=false` después de crear tu cuenta de administrador |

| **Las lecturas públicas siguen necesitando un llamante** | `access: "public"` amplía qué *filas* ve un llamante, no quién puede llamar: una petición anónima a `/api/data/*` responde 401 mientras `AUTH_REQUIRE` esté activo. Pon `AUTH_REQUIRE=false` para un sitio público que lee su propio backend y deja que RLS decida por sí solo. Es una variable de entorno, así que un `.env` local que la defina **no** viaja con tu despliegue. |

## Módulos Nativos en el Runtime Gestionado

El runtime gestionado de Rebase Cloud ejecuta tu bundle dentro de una imagen
compartida. No tiene compilador ni forma de cargar un **módulo nativo** —
cualquier cosa que incluya un binario `.node` precompilado. El más común con
diferencia es `sharp`, que además es la dependencia obvia para cualquier cosa
que sirva imágenes.

`rebase cloud deploy` lo rechaza antes de subir nada, no después:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Tres salidas, en el orden en que suelen ser la correcta:

1. **Mueve el trabajo al build.** Redimensiona y recodifica las imágenes en tu
   paso de build y despliega los resultados. Nada nativo se ejecuta en la ruta
   de la petición.
2. **Usa un servicio.** Un CDN de imágenes o una API de transformación hace el
   mismo trabajo detrás de una URL.
3. **Ejecuta tu propio contenedor.** Un despliegue autogestionado (Docker,
   Kubernetes, cualquiera de las
   [guías por plataforma](/docs/deployment/self-hosting)) es tu imagen, así que
   puede llevar lo que quiera.

Las funciones que solo necesitan Node y no un binario nativo no dan problema —
el despliegue las reporta por separado (`1 of 3 function(s) depend on Node`) y
las ejecuta.

## Sirviendo el Frontend

En producción, el backend puede servir el frontend como una SPA estática:

```typescript
import { serveSPA } from "@rebasepro/server";
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Compila primero el frontend:

```bash
cd frontend && pnpm build
```

De esta forma solo necesitas desplegar un servidor que gestione tanto la SPA como la API.

## Guías de Despliegue por Plataforma

Guías detalladas paso a paso para cada plataforma:

| Plataforma | Tipo | Guía |
|----------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Desplegar en AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Desplegar en GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Desplegar en Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Desplegar en Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Contenedores Serverless | [Desplegar en Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (autodetecta el Dockerfile) | [Desplegar en Railway →](/docs/deployment/railway) |
| **Fly.io** | Runtime de contenedores | [Desplegar en Fly.io →](/docs/deployment/flyio) |

:::caution
Cloud Run y otras plataformas serverless son sin estado. Usa **almacenamiento S3** en lugar del sistema de archivos local para las subidas de archivos, y establece `--min-instances 1` si usas las funciones de tiempo real de Rebase (las conexiones WebSocket se terminan cuando las instancias se reducen).
:::


## Cambiar la URL Base

Si quieres que el panel de administración se ejecute en una sub-ruta (p. ej. `/admin`), cambia una línea — el `path` de la app en `rebase.json`:

```json title="rebase.json"
"admin": {
    "type": "static",
    "root": "frontend",
    "build": "npm run build --workspace frontend",
    "output": "frontend/dist",
    "path": "/admin"
}
```

`rebase build` se lo pasa a Vite como `base` (mediante `REBASE_APP_BASE`), Vite lo devuelve como `import.meta.env.BASE_URL`, y el `main.tsx` del scaffold ya se lo entrega al router — así los assets, las rutas y el servidor coinciden sin escribir el prefijo en tres sitios:

```tsx title="frontend/src/main.tsx"
// At "/" this is "".
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

const router = createBrowserRouter([
    {
        path: "/*",
        element: <App/>
    }
], { basename });
```

El panel necesita un **data router** — `createBrowserRouter`, no el simple `BrowserRouter` — porque el bloqueo de cambios sin guardar usa `useBlocker`, que solo proporciona el data router.

**Backend** — si también mueves la API, actualiza su ruta base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montar sin un `basename` de router]
El enfoque de `basename` anterior es el recomendado — react-router elimina el
prefijo de la ubicación, por lo que el administrador funciona sin cambios. Si en su lugar incrustas el
administrador dentro de una **ruta con prefijo de path** de una app más grande (p. ej. `<Route path="/admin/*">`)
sin `basename`, la ruta actual conserva su prefijo `/admin`. Informa al CMS al
respecto para que la resolución URL⇄colección tenga en cuenta el prefijo — de lo contrario las vistas se quedan en un
spinner sin obtener datos:

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Establece **o bien** el `basename` del router **o bien** `RebaseCMS basePath` — no ambos, o el
prefijo se aplica dos veces.
:::

### App de Producto + Administrador en un Solo Despliegue

La razón habitual para mover el administrador a `/admin` es distribuir tu **propia app de producto**
en la raíz del mismo despliegue. Un único punto de entrada de Vite puede servir ambos, dividido por URL,
de modo que cada app se carga de forma diferida y los visitantes del producto nunca descargan el bundle del administrador:

```tsx title="frontend/src/main.tsx"
const isAdmin = window.location.pathname.startsWith("/admin");

const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp"));

const router = isAdmin
    // The admin lives under /admin, and `basename` is how the router is told.
    ? createBrowserRouter([{ path: "/*", element: <AdminApp/> }], { basename: "/admin" })
    : createBrowserRouter([{ path: "/*", element: <ProductApp/> }]);

root.render(<RouterProvider router={router}/>);
```

Un único router para ambas mitades: el panel necesita el data router de todas formas, y no hay razón para que la app de producto esté en otro.

El backend no necesita cambios para este patrón — la API permanece en `/api` y el catch-all de la SPA
sirve `index.html` tanto para `/` como para `/admin/*`.

## Próximos Pasos

- **[Resumen del Backend](/docs/backend)** — Configuración completa del backend
- **[Configuración de Almacenamiento](/docs/backend/storage)** — Configuración de S3 para producción
