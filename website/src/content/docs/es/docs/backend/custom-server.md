---
sourceHash: aeb69aa6164eafbc
title: Integración con Servidores Personalizados
sidebar_label: Servidor Personalizado (Express)
description: Cómo incrustar los servicios de base de datos y tiempo real de Rebase en su propio backend Node.js sin utilizar Hono ni el coordinador de Rebase.
---

# Integración con Servidores Personalizados

Rebase fue diseñado para ser completamente modular. Mientras que el coordinador `initializeRebaseBackend` proporciona un backend completo que incluye Hono, usted puede omitirlo por completo e integrar el **Adaptador de Base de Datos** central y los **WebSockets en Tiempo Real** directamente en su propia aplicación Node.js (como Express, Fastify o HTTP básico de Node.js).

El paquete `@rebasepro/server-postgres` es completamente agnóstico con respecto al framework. Solo depende de Drizzle ORM y del `http.Server` estándar de Node.js.

## Configuración del Entorno

Rebase proporciona una utilidad centralizada `loadEnv()` en `@rebasepro/server` que valida sus variables de entorno frente a un esquema estricto de Zod. Llámela **después** de cargar su archivo `.env`:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

dotenv.config({ path: "../../.env" });

// Básico — solo variables de entorno de Rebase:
export const env = loadEnv();

// Extendido — añada sus propias variables tipadas:
import { z } from "@rebasepro/server";
export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST  → string | undefined  (completamente tipado)
// env.STRIPE_SECRET_KEY → string        (validado, requerido)
```

Importar `z` desde `@rebasepro/server` es nuevo <span class="since-badge" data-since="0.18">Since 0.18</span>. En 0.17 y
versiones anteriores el paquete no exportaba ningún `z`: impórtalo desde `zod`,
con la misma versión mayor que usa el runtime, y deja que tu bundler deduplique
las dos copias.

**Comportamientos clave:**
- Genera automáticamente variables efímeras `JWT_SECRET` y `REBASE_SERVICE_KEY` en desarrollo para que pueda comenzar sin una configuración manual.
- Bloquea los secretos autogenerados en producción — debe configurarlos explícitamente.
- Valida que `CORS_ORIGINS` o `FRONTEND_URL` estén configurados en producción.

Consulte `.env.example` en la aplicación generada para obtener la lista completa de variables compatibles.

## Uso de Rebase con Express

A continuación se muestra un ejemplo completo de cómo inicializar el adaptador PostgreSQL de Rebase y los WebSockets en tiempo real dentro de una aplicación Express estándar.

### 1. Instalar Dependencias

Necesitará el paquete del servidor Postgres junto con Express:

```bash
npm install @rebasepro/server-postgres @rebasepro/types express
```

### 2. Ejemplo de Inicialización

```typescript
import express from 'express';
import { createServer } from 'http';
import { createPostgresBootstrapper } from '@rebasepro/server-postgres';

async function startServer() {
    const app = express();
    
    // 1. DEBE crear el servidor HTTP nativo de Node para que el servidor WebSocket pueda vincularse a él
    const server = createServer(app);

    // 2. Inicializar el Postgres Bootstrapper directamente
    const bootstrapper = createPostgresBootstrapper({
        connectionString: process.env.DATABASE_URL,
        // Opcional: defina cualquier esquema de Drizzle aquí si desea relaciones/consultas tipadas
        // schema: { tables: { ... } } 
    });

    // 3. Inicializar el controlador (conecta a la base de datos, inicia los oyentes de replicación lógica)
    const { driver, realtimeProvider } = await bootstrapper.initializeDriver({
        collections: [] // Pase sus colecciones de Rebase aquí si las está utilizando
    });

    // 4. Vincular los WebSockets de Rebase a su servidor HTTP
    await bootstrapper.initializeWebsockets(
        server, 
        realtimeProvider, 
        driver
    );

    // --- Rutas de Express ---
    app.use(express.json());

    app.get('/', (req, res) => {
        res.send('¡Servidor Express ejecutándose con Rebase integrado!');
    });

    // Puede interactuar directamente con el controlador de Rebase en cualquier parte de sus rutas Express
    app.post('/custom-data', async (req, res) => {
        try {
            // Utilizar el controlador de base de datos nativo de Rebase
            const result = await driver.save({
                collection: 'products',
                entity: req.body
            });
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 5. Iniciar la escucha utilizando la instancia del servidor nativo (NO app.listen)
    server.listen(3000, () => {
        console.log('Express y Rebase Realtime ejecutándose en el puerto 3000');
    });
}

startServer();
```

## Conceptos Clave

### Servidor HTTP Nativo
Debido a que los WebSockets requieren una solicitud HTTP `Upgrade`, **debe** vincular Rebase a la instancia nativa de `http.Server` de Node.js. Si simplemente llama a `app.listen(3000)` en Express, no tendrá acceso al objeto del servidor subyacente que requiere `initializeWebsockets()`.

### Omitir Hono
Al invocar directamente `createPostgresBootstrapper()` y llamar manualmente a `initializeDriver()` y `initializeWebsockets()`, está omitiendo por completo al coordinador de Rebase (`initializeRebaseBackend`). Esto significa que no se cargan las dependencias de Hono y no se montan las API REST autogeneradas, las rutas de la interfaz de usuario del administrador ni los endpoints de autenticación.

Esto le otorga un control total sobre su API mientras sigue aprovechando el potente motor de WebSockets de replicación lógica y el controlador basado en Drizzle de Rebase.
