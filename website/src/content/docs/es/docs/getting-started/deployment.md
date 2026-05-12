---
title: Despliegue
sidebar_label: Despliegue
slug: docs/getting-started/deployment
description: Despliega tu proyecto Rebase a producción usando Docker, plataformas en la nube o configuraciones manuales.
---

## Docker Compose (Recomendado)

El proyecto generado incluye un `Dockerfile` y un `docker-compose.yml`. Esta es la forma más sencilla de desplegar:

```yaml title="docker-compose.yml"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: rebase
      POSTGRES_PASSWORD: rebase
      POSTGRES_DB: rebase
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  app:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://rebase:rebase@postgres:5432/rebase
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

## Lista de verificación para producción

Antes de desplegar a producción, asegúrate de:

| Elemento | Detalles |
|------|---------|
| **JWT_SECRET** | Usa una cadena aleatoria criptográficamente fuerte (≥ 32 caracteres). Nunca la reutilices en diferentes entornos. |
| **DATABASE_URL** | Usa una instancia de Postgres gestionada (Neon, Supabase, RDS) con TLS habilitado |
| **CORS** | Configura los orígenes permitidos en tu backend si el frontend y el backend están en dominios diferentes |
| **Volúmenes de almacenamiento** | Monta volúmenes persistentes para la carga de archivos. O cambia a S3 para producción. |
| **HTTPS** | Termina TLS en tu proxy inverso (nginx, Cloudflare, balanceador de carga) |
| **Registro** | Establece `ALLOW_REGISTRATION=false` después de crear tu cuenta de administrador |

## Sirviendo el Frontend

En producción, el backend puede servir el frontend como una SPA estática:

```typescript
import { serveSPA } from "@rebasepro/backend";

// After initializeRebaseBackend()
serveSPA(app, "./frontend/dist");
```

Primero, construye el frontend:

```bash
cd frontend && pnpm build
```

De esta manera, solo necesitas desplegar un servidor que maneje tanto la SPA como la API.

## Plataformas en la Nube

### Railway / Render / Fly.io

1. Sube tu código a un repositorio Git
2. Conecta el repositorio a tu plataforma en la nube
3. Configura las variables de entorno (`DATABASE_URL`, `JWT_SECRET`, etc.)
4. El `Dockerfile` incluido será detectado automáticamente

### Google Cloud Run

```bash
# Build the container
docker build -t gcr.io/YOUR_PROJECT/rebase-backend ./backend

# Push to Container Registry
docker push gcr.io/YOUR_PROJECT/rebase-backend

# Deploy
gcloud run deploy rebase-backend \
  --image gcr.io/YOUR_PROJECT/rebase-backend \
  --set-env-vars DATABASE_URL=...,JWT_SECRET=... \
  --allow-unauthenticated
```

:::caution
Las instancias de Cloud Run son sin estado. Usa **almacenamiento S3** en lugar del sistema de archivos local para las cargas de archivos, y habilita **tiempo real entre instancias** proporcionando una `connectionString` en tu `PostgresBootstrapper` para que las actualizaciones de WebSocket se propaguen entre réplicas.
:::

## Cambiar la URL Base

Si quieres que Rebase se ejecute en una subruta (por ejemplo, `/admin`):

**Frontend** — Actualiza el `basename` de `BrowserRouter`:

```tsx title="frontend/src/main.tsx"
<BrowserRouter basename="/admin">
    <App />
</BrowserRouter>
```

**Backend** — Actualiza la ruta base:

```typescript
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

## Próximos Pasos

- **[Descripción general del Backend](/docs/backend)** — Configuración completa del backend
- **[Configuración de Almacenamiento](/docs/storage)** — Configuración de S3 para producción

---
