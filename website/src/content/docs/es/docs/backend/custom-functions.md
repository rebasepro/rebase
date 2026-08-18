---
title: Funciones Personalizadas
sidebar_label: Funciones Personalizadas
description: Añada puntos finales de API Hono personalizados junto con sus rutas CRUD de Rebase. Auto-descubiertos desde un directorio, con acceso completo a la instancia de backend.
---

## Resumen

Las funciones personalizadas le permiten añadir **rutas de API Hono arbitrarias** junto con los puntos finales CRUD auto-generados de Rebase. Siguen el mismo patrón de **descubrimiento basado en archivos** que las colecciones y los trabajos cron: coloque un archivo TypeScript en su directorio `functions/`, y Rebase lo montará automáticamente.

Utilice funciones personalizadas para:

- **Puntos finales de lógica de negocio** — aprobaciones, promociones, flujos de trabajo personalizados
- **Integraciones de terceros** — webhooks de Stripe, comandos de Slack, proxies de API externos
- **Puntos finales públicos** — formularios de contacto, captura de clientes potenciales, comprobaciones de estado
- **Consultas agregadas** — estadísticas de panel de control, informes, análisis

## Definiendo una Función Personalizada

Cree un archivo en su directorio `backend/functions/` que exporte por defecto una aplicación Hono:

```typescript
// backend/functions/hello.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

app.get("/", (c) => {
    return c.json({ message: "Hello from custom function!" });
});

export default app;
```

Esto se monta en **`/api/functions/hello`**. El nombre del archivo (sin extensión) se convierte en el prefijo de la ruta.

## Configuración

Habilite las funciones personalizadas añadiendo `functionsDir` a su configuración de backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase hará:

1. Escanear el directorio en busca de archivos `.ts` / `.js`
2. Validar que cada exportación por defecto sea una aplicación Hono (tipado dinámico vía `.fetch()` + `.routes`)
3. Montar cada aplicación en `/api/functions/<filename>`
4. Aplicar el middleware de autenticación (ver [Autenticación](#authentication) a continuación)

## Nomenclatura de Archivos y Mapeo de Rutas

| Archivo | Ruta de Montaje |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Archivos que son **ignorados**:

- `index.ts` / `index.js` — reservados
- `*.test.ts` / `*.test.js` — archivos de prueba
- `*.d.ts` — declaraciones de tipo

## Formatos de Exportación

El cargador acepta dos formatos de exportación:

### Aplicación Hono (recomendado)

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Función de Fábrica

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

Ambos se detectan mediante duck-typing — el cargador comprueba las propiedades `.fetch()` y `.routes`, por lo que cualquier instancia compatible con Hono funcionará independientemente de la versión de Hono instalada.

## Autenticación

Las funciones personalizadas se montan con el **mismo middleware de autenticación** que las rutas de datos, pero con `requireAuth: false`. Esto significa:

- El JWT del usuario es **analizado e inyectado** en el contexto si está presente
- Pero las solicitudes **no son rechazadas** si no se proporciona un JWT
- Debe **proteger explícitamente** las rutas que necesitan autenticación

### Protegiendo Rutas

Utilice los helpers de autenticación incorporados de Rebase:

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

// Public endpoint — no auth required
app.get("/public", (c) => {
    return c.json({ message: "Anyone can access this" });
});

// Protected endpoint — requires a valid JWT
app.post("/protected", async (c) => {
    // Narrowed: the env types every variable the middleware may set.
    const user = c.get("user") as { uid: string; roles?: string[] } | undefined;
    if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
    }
    return c.json({ message: `Hello, ${user.uid}` });
});

// Admin-only endpoint
app.post("/admin-only", async (c) => {
    const user = c.get("user") as { uid: string; roles?: string[] } | undefined;
    const roles: string[] = user?.roles ?? [];
    if (!roles.includes("admin")) {
        return c.json({ error: "Admin access required" }, 403);
    }
    return c.json({ message: "Admin operation succeeded" });
});

export default app;
```

:::important
El middleware JWT de Rebase está limitado a las rutas de API incorporadas (`/api/data`, `/api/auth`, etc.). Las rutas de funciones personalizadas obtienen el **contexto de usuario analizado**, pero debe aplicar el control de acceso usted mismo.
:::

## Accediendo a la Base de Datos

Las funciones personalizadas se ejecutan junto con Rebase, por lo que puede acceder a la base de datos a través de dos enfoques:

### 1. Vía el Singleton de Rebase (Recomendado)

El paquete `@rebasepro/server` proporciona un singleton `rebase` que le da acceso a nivel de administrador a todos los servicios con alcance de aplicación (datos, autenticación, almacenamiento, correo electrónico) desde cualquier lugar de su backend.

```typescript
// backend/functions/approve-job.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { rebase } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

app.post("/:id/approve", async (c) => {
    const id = c.req.param("id");

    // Use the admin-level data API (bypasses RLS)
    await rebase.data.saveEntity("jobs", {
        id,
        status: "published",
        approved_at: new Date().toISOString(),
    });

    return c.json({ success: true });
});

export default app;
```

### 2. Vía Acceso Directo a Drizzle

```typescript
// backend/functions/reports.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { db } from "../src/db"; // Your Drizzle instance
import { sql } from "drizzle-orm";

const app = new Hono<HonoEnv>();

app.get("/stats", async (c) => {
    const result = await db.execute(sql`
        SELECT COUNT(*) as total FROM jobs WHERE status = 'published'
    `);
    return c.json({ totalJobs: result.rows[0]?.total });
});

export default app;
```

:::tip
La instancia de Drizzle `db` utilizada por Rebase es la misma que le pasa a `createPostgresBootstrapper`. Puede compartirla libremente entre funciones personalizadas y Rebase.
:::

## Orden de Registro de Rutas

Las funciones personalizadas se cargan y montan **después** de que `initializeRebaseBackend()` complete la configuración central. El orden de inicialización es:

1. **Bootstrappers** — Conexiones a la base de datos, tablas de autenticación, servicios en tiempo real
2. **Rutas de autenticación** — `/api/auth/*`, `/api/admin/*`
3. **Rutas de almacenamiento** — `/api/storage/*`
4. **Rutas de datos** — `/api/data/*` (CRUD para colecciones)
5. **Funciones personalizadas** ← `/api/functions/*`
6. **Trabajos Cron** — `/api/cron/*`
7. **WebSocket** — Suscripciones en tiempo real

Esto significa que sus funciones personalizadas tienen acceso a todos los servicios inicializados. Registre cualquier ruta que necesite ejecutarse **antes** de Rebase directamente en la aplicación Hono, antes de llamar a `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

## Ejemplo: Handler de Webhook

```typescript
// backend/functions/stripe-webhook.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import Stripe from "stripe";
import { instance } from "../src/index";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const app = new Hono<HonoEnv>();

app.post("/", async (c) => {
    const sig = c.req.header("stripe-signature")!;
    const body = await c.req.text();

    const event = stripe.webhooks.constructEvent(
        body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
    );

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        await instance.driver.data.subscriptions.create({
            userId: session.client_reference_id,
            stripe_id: session.subscription,
            status: "active",
        });
    }

    return c.json({ received: true });
});

export default app;
```

## Depuración

Cuando una función se carga correctamente, verá:

```
⚡ Loaded function route: hello
```

Si la carga falla, el cargador proporciona una salida de diagnóstico:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

## Próximos Pasos

- **[Visión General del Backend](/docs/backend)** — Referencia completa de la configuración del backend
- **[Callbacks de Entidad](/docs/collections/callbacks)** — Ejecutar lógica sobre cambios de datos
- **[Trabajos Cron](/docs/backend/cron-jobs)** — Tareas en segundo plano programadas
---
