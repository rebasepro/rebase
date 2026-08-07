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
    image: postgres:18-alpine
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

Si quieres que Rebase se ejecute en una subruta (p. ej., `/admin`):

**Frontend** — Actualiza el `basename` de `BrowserRouter`:

```tsx title="frontend/src/main.tsx"
<BrowserRouter basename="/admin">
    <App />
</BrowserRouter>
```

**Backend** — Actualiza la ruta base:

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
<RebaseAdmin collections={collections} basePath="/admin" />
```

Establece **o bien** el `basename` del router **o bien** `RebaseAdmin basePath` — no ambos, o el
prefijo se aplica dos veces.
:::

### App de Producto + Administrador en un Solo Despliegue

La razón habitual para mover el administrador a `/admin` es distribuir tu **propia app de producto**
en la raíz del mismo despliegue. Un único punto de entrada de Vite puede servir ambos, dividido por URL,
de modo que cada app se carga de forma diferida y los visitantes del producto nunca descargan el bundle del administrador:

```tsx title="frontend/src/main.tsx"
const isAdmin = window.location.pathname.startsWith("/admin");

const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp")); // renders <RebaseAdmin basePath="/admin" />

if (isAdmin) {
    // The admin uses useBlocker → needs a data router
    const router = createBrowserRouter([{ path: "/admin/*", element: <AdminApp /> }]);
    root.render(<RouterProvider router={router} />);
} else {
    root.render(<BrowserRouter><ProductApp /></BrowserRouter>);
}
```

El backend no necesita cambios para este patrón — la API permanece en `/api` y el catch-all de la SPA
sirve `index.html` tanto para `/` como para `/admin/*`.

## Próximos Pasos

- **[Resumen del Backend](/docs/backend)** — Configuración completa del backend
- **[Configuración de Almacenamiento](/docs/backend/storage)** — Configuración de S3 para producción
