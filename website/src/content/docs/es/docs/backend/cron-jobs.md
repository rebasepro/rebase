---
sourceHash: c90a105840f07ad0
title: Trabajos Cron
sidebar_label: Trabajos Cron
description: Programa tareas en segundo plano recurrentes con el sistema de trabajos cron integrado de Rebase. Define trabajos como archivos TypeScript, monitorízalos en Studio y adminístralos a través de la API REST.
---

## Descripción general

Rebase incluye un **planificador de trabajos cron** integrado para ejecutar tareas recurrentes en segundo plano: limpieza de datos, generación de informes, comprobaciones de estado, sincronizaciones de API externas y mucho más.

Los trabajos cron siguen el mismo patrón de **descubrimiento basado en archivos** que las funciones personalizadas: coloca un archivo TypeScript en tu directorio `crons/` y Rebase lo registrará y programará automáticamente.

- **Cero dependencias** — No se requieren librerías de planificador externas
- **API de administración** — Endpoints REST para listar, disparar, habilitar/deshabilitar y ver registros
- **Panel de control de Studio** — Monitoriza todos los trabajos, ve el historial de ejecución y dispara ejecuciones manualmente
- **Persistencia en la base de datos** — Registros de ejecución almacenados en PostgreSQL, sobreviviendo a los reinicios
- **Caché en memoria** — Búfer circular rápido (últimas 50 ejecuciones) para el panel de control, respaldado por la base de datos

## Definición de un trabajo cron

Crea un archivo en tu directorio `backend/crons/` que exporte por defecto una `CronJobDefinition`:

```typescript
// backend/crons/health-check.ts
import type { CronJobDefinition } from "@rebasepro/types";

const job: CronJobDefinition = {
    schedule: "*/5 * * * *",     // every 5 minutes
    name: "System Health Check",
    description: "Monitors uptime and memory usage",

    async handler(ctx) {
        ctx.log("Running health check...");

        const uptime = process.uptime();
        const mem = process.memoryUsage();

        ctx.log(`Uptime: ${Math.round(uptime)}s`);
        ctx.log(`Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`);

        return {
            uptimeSeconds: Math.round(uptime),
            heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        };
    },
};

export default job;
```

El **nombre del archivo** (sin extensión) se convierte en el ID único del trabajo — por ejemplo, `health-check`.

## Configuración

Habilita los trabajos cron añadiendo `cronsDir` a tu configuración de backend:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

Eso es todo. Rebase hará lo siguiente:

1. Escaneará el directorio en busca de archivos `.ts` / `.js`
2. Registrará cada exportación por defecto como un trabajo cron
3. Creará automáticamente la tabla `rebase.cron_logs` en PostgreSQL (si el controlador soporta SQL)
4. Iniciará el planificador y rellenará los contadores a partir de los registros existentes en la base de datos
5. Montará las rutas REST de administración en `/api/cron`

## Sintaxis de la programación

Las expresiones cron utilizan el **formato estándar de 5 campos**:

```
┌───────────── minute (0–59)
│ ┌─────────── hour (0–23)
│ │ ┌───────── day of month (1–31)
│ │ │ ┌─────── month (1–12)
│ │ │ │ ┌───── day of week (0–6, Sunday = 0)
│ │ │ │ │
* * * * *
```

| Expresión | Significado |
|------------|---------|
| `* * * * *` | Cada minuto |
| `0 * * * *` | Cada hora |
| `0 3 * * *` | Diariamente a las 3:00 AM |
| `0 0 * * 1` | Cada lunes a medianoche |
| `0 9 1 * *` | Primer día de cada mes a las 9:00 AM |
| `0,30 * * * *` | Cada 30 minutos (a los :00 y :30) |
| `0 9-17 * * 1-5` | Cada hora, de 9 AM a 5 PM, solo días laborables |

Los valores de paso (`*/n`), rangos (`a-b`) y listas (`a,b,c`) son todos compatibles.

## Referencia de CronJobDefinition

`timezone` es nuevo <span class="since-badge" data-since="0.18">Since 0.18</span> — en 0.17.3 un horario siempre se lee en la zona del
anfitrión. Todo lo demás de esta interfaz ya está publicado.

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // Human-readable name shown in Studio
    name: string;

    // Optional description shown in Studio
    description?: string;

    // Whether the job starts enabled (default: true)
    enabled?: boolean;

    // Max execution time in seconds (default: 300)
    timeoutSeconds?: number;

    // The function to run on each tick
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

## Contexto del manejador

Cada manejador recibe un `CronJobContext`:

```typescript
interface CronJobContext {
    // The job's unique ID (derived from filename)
    jobId: string;

    // The scheduled tick timestamp
    scheduledAt: Date;

    // Logger — captured lines appear in Studio and the logs API
    log: (...args: unknown[]) => void;
}
```

Usa `ctx.log()` para emitir una salida estructurada. Estas líneas se capturan en el registro de ejecución y son visibles en Studio y a través de la API REST.

:::tip
El manejador puede devolver cualquier valor serializable en JSON. Se almacenará en la entrada del registro como `result` y se mostrará en el historial de ejecución de Studio.
:::

## API REST

Todas las rutas cron requieren **autenticación de administrador** (`requireAuth` + `requireAdmin`).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/cron` | Lista todos los trabajos cron registrados |
| `GET` | `/api/cron/:id` | Obtiene el estado de un único trabajo |
| `POST` | `/api/cron/:id/trigger` | Dispara un trabajo manualmente |
| `GET` | `/api/cron/:id/logs` | Obtiene el historial de ejecución (`?limit=N`) |
| `PUT` | `/api/cron/:id` | Habilita/deshabilita un trabajo (`{ "enabled": true }`) |

### Ejemplo: Listar todos los trabajos

`$API_URL` es la URL que imprimió `rebase dev` — el puerto se deriva del proyecto y no es fijo.

```bash
curl -H "Authorization: Bearer $TOKEN" "$API_URL/api/cron"
```

```json
{
    "jobs": [
        {
            "id": "health-check",
            "name": "System Health Check",
            "schedule": "*/5 * * * *",
            "enabled": true,
            "state": "idle",
            "totalRuns": 12,
            "totalFailures": 0,
            "lastRunAt": "2026-04-24T08:15:00.000Z",
            "nextRunAt": "2026-04-24T08:20:00.000Z",
            "lastDurationMs": 3
        }
    ]
}
```

### Ejemplo: Disparar un trabajo manualmente

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/cron/health-check/trigger"
```

## SDK del cliente

El SDK del cliente de Rebase expone un espacio de nombres `cron` para todas las operaciones:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

// List all jobs
const { jobs } = await client.cron.listJobs();

// Get a single job
const { job } = await client.cron.getJob("health-check");

// Trigger manually
const { log, job: updated } = await client.cron.triggerJob("health-check");

// View execution history
const { logs } = await client.cron.getJobLogs("health-check", { limit: 10 });

// Enable or disable
await client.cron.toggleJob("health-check", false); // pause
await client.cron.toggleJob("health-check", true);  // resume
```

## Panel de control de Studio

Cuando los trabajos cron están configurados, aparece una herramienta de **Trabajos Cron** en Rebase Studio bajo la sección **Automatización**. El panel de control proporciona:

- **Lista de trabajos** — Todos los trabajos registrados con indicadores de estado en tiempo real
- **Panel de detalles** — Información de programación, próxima/última ejecución, duración y errores
- **Historial de ejecución** — Entradas de registro expandibles con salida y resultados capturados
- **Disparador manual** — Ejecuta cualquier trabajo bajo demanda con un solo clic
- **Habilitar/deshabilitar** — Pausa y reanuda trabajos sin reiniciar el servidor

El panel de control se actualiza automáticamente cada 15 segundos.

## Persistencia

Cuando el controlador de la base de datos soporta SQL (p. ej. PostgreSQL), los registros de ejecución se **persisten automáticamente** en una tabla `rebase.cron_logs`. Esto significa:

- El historial de ejecución **sobrevive a los reinicios del servidor** y a las implementaciones
- Los contadores `totalRuns` y `totalFailures` se **inicializan desde la base de datos** al iniciar
- El endpoint `/api/cron/:id/logs` consulta la base de datos, no solo la memoria
- Múltiples instancias de servidor comparten el mismo historial de ejecución

La tabla se crea automáticamente en el primer inicio — no se necesitan migraciones.

:::tip
La persistencia no es bloqueante. Si una escritura en la base de datos falla, el planificador continúa ejecutándose y el búfer de registro en memoria sigue estando disponible como respaldo.
:::

## Manejo de errores y tiempos de espera

- Si un manejador **lanza un error**, este se captura en la entrada del registro y el estado del trabajo se establece en `"error"`. El planificador continúa ejecutándose — la siguiente ejecución programada se disparará de todos modos.
- Si un manejador excede `timeoutSeconds` (por defecto: 300), se termina con un error de tiempo de espera.
- Todas las métricas de ejecución (número de éxitos, número de fallos, último error) se rastrean por trabajo y son accesibles a través de la API.
- Los errores de escritura de persistencia se registran, pero nunca colapsan el planificador.

## Ejemplo: Trabajo de limpieza diaria

```typescript
// backend/crons/cleanup-sessions.ts
import type { CronJobDefinition } from "@rebasepro/types";
import { rebase } from "@rebasepro/server";

const job: CronJobDefinition = {
    schedule: "0 3 * * *",  // daily at 3 AM
    name: "Cleanup Expired Sessions",
    description: "Removes user sessions older than 30 days",

    async handler(ctx) {
        ctx.log("Starting session cleanup...");

        // Use the rebase singleton for admin-level database access
        const count = Math.floor(Math.random() * 50); // placeholder

        ctx.log(`Cleaned up ${count} expired sessions`);

        return { deletedSessions: count };
    },
};

export default job;
```

## Próximos pasos

- **[Descripción general del Backend](/docs/backend)** — Referencia completa de la configuración del backend
- **[Callbacks de Entidad](/docs/collections/callbacks)** — Ejecuta lógica ante cambios en los datos
- **[Integración de Webhooks](/docs/recipes/webhooks)** — Envía notificaciones sobre eventos
---
