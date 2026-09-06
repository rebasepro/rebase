---
sourceHash: 3346d2728eb8f2e4
title: Entorno y Configuración
sidebar_label: Configuración
description: Todas las variables de entorno y opciones de configuración para proyectos Rebase.
---

## Variables de Entorno

Toda la configuración se realiza a través de variables de entorno en tu archivo `.env` en la raíz del proyecto.

> **Importante**: Rebase utiliza **Zod** para validar las variables de entorno al inicio en `src/env.ts`. Si falta alguna variable requerida o está formateada incorrectamente (como URLs o puertos), el servidor no se iniciará y proporcionará un mensaje de error claro.

### Obligatorias

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clave secreta para firmar tokens JWT. Utiliza una cadena aleatoria fuerte (mín. 32 caracteres). | `a1b2c3d4e5...` |

### Frontend

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `VITE_API_URL` | URL de la API del backend para el SDK del cliente. **Defínela solo en desarrollo.** | origen de la página |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth. Habilita "Iniciar sesión con Google". | — |

### Backend

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `PORT` | Puerto para el servidor HTTP del backend | `3001` |
| `LOG_LEVEL` | Nivel de verbosidad del registro: `error`, `warn`, `info`, `debug` | `info` |
| `NODE_ENV` | Entorno: `development` o `production` | `development` |

### Autenticación

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `JWT_SECRET` | Secreto para la firma JWT (requerido si la autenticación está habilitada) | — |
| `JWT_ACCESS_EXPIRES_IN` | Tiempo de vida del token de acceso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tiempo de vida del token de actualización | `30d` |
| `ALLOW_REGISTRATION` | Permitir que nuevos usuarios se registren (`true`/`false`). El primer usuario siempre puede registrarse. | `true` |
| `GOOGLE_CLIENT_ID` | ID de cliente de Google OAuth (validación del backend) | — |

### Almacenamiento

| Variable | Descripción | Valor por defecto |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de almacenamiento: `local` o `s3` | `local` |
| `STORAGE_PATH` | Ruta base para almacenamiento local | `./uploads` |
| `S3_BUCKET` | Nombre del bucket de S3 (cuando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Región de AWS | — |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |

### Correo Electrónico (Opcional)

| Variable | Descripción |
|----------|-------------|
| `SMTP_HOST` | Host del servidor SMTP |
| `SMTP_PORT` | Puerto del servidor SMTP |
| `SMTP_SECURE` | Enable secure connection (`true`/`false`) |
| `SMTP_USER` | Nombre de usuario SMTP |
| `SMTP_PASS` | Contraseña SMTP |
| `EMAIL_FROM` | Dirección del remitente para correos electrónicos del sistema |

## Objeto de Configuración del Backend

El `RebaseBackendConfig` pasado a `initializeRebaseBackend()` proporciona control programático:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : {
            type: "local",
            basePath: env.STORAGE_PATH || "./uploads"
        },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

    logging: {
        level: "info"
    }
});
```

## Próximos Pasos

- **[Despliegue](/docs/getting-started/deployment)** — Guía de despliegue en producción
- **[Visión General del Backend](/docs/backend)** — Referencia completa de la configuración del backend
