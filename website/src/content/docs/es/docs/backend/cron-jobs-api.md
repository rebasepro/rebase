---
sourceHash: 3e450f0960514c50
title: "API de Cron Jobs"
sidebar_label: "API de Cron Jobs"
---

## API REST

Leer necesita el alcance `cron:read`. Disparar, pausar y reanudar necesitan
`cron:write`. Un administrador tiene ambos. También los tiene una persona cuyo rol los
declare, y una clave de API creada con ellos, que es lo que debería llevar un
planificador externo:

```bash
rebase api-keys create -n "Scheduler" --scopes cron:read,cron:write
```

Consulta [Roles y alcances](/docs/backend/roles-and-scopes/).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/admin/cron` | Listar todos los cron jobs registrados |
| `GET` | `/api/admin/cron/:id` | Obtener el estado de una tarea individual |
| `POST` | `/api/admin/cron/:id/trigger` | Activar manualmente una tarea — `409` mientras ya se está ejecutando. `?async=1` responde `202` en cuanto la ejecución ha empezado |
| `GET` | `/api/admin/cron/:id/logs` | Obtener el historial de ejecución (`?limit=N`), de los últimos 30 días. `503` cuando no se puede leer `rebase.cron_logs`, en lugar de un historial vacío |
| `PUT` | `/api/admin/cron/:id` | Pausar o reanudar una tarea en todos los procesos (`{ "enabled": false }`); `null` vuelve a seguir el código |

### Ejemplo: Listar todas las tareas

`$TOKEN` es un token de acceso de una cuenta que tiene `cron:read`: inicia sesión y usa el `accessToken` devuelto en la respuesta de inicio de sesión. Una clave de API que tenga el alcance funciona igual. `$API_URL` es lo que haya impreso `rebase dev`; el puerto se deriva de la ruta del proyecto, por lo que no es fijo.

```bash
curl -H "Authorization: Bearer $TOKEN" "$API_URL/api/admin/cron"
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

### Tareas que no están ahí

Una tarea que nunca se dispara no aparece en `jobs` (nada la registró), por lo que «falta mi cron» y «mi cron nunca se ejecutará» parecen idénticos desde este endpoint a menos que indique lo contrario. Y lo hace:

```json
{
    "jobs": [],
    "skipped": 2,
    "rejected": [
        {
            "id": "nightly-report",
            "name": "Nightly report",
            "schedule": "0 0 3 * * *",
            "reason": "Expected 5 fields, got 6"
        }
    ],
    "note": "1 cron file(s) failed to load and 1 job(s) were refused — NOT scheduled. See `rejected` for the reason; the server log has the rest."
}
```

`rejected` nombra la tarea y el motivo. Un archivo que falló al *cargar* solo tiene un recuento: el fallo ocurrió antes de que hubiera una tarea que nombrar, por lo que el motivo está en los registros del servidor.

La entrada más común aquí es la de arriba: seis campos, a partir de una expresión copiada de una herramienta que admite segundos. Rebase acepta cinco; elimina el primer campo. Un `timeoutSeconds` de cero, un número negativo o `NaN` también aparece aquí.

### Ejemplo: Activar una tarea manualmente

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/health-check/trigger"
```

Mientras la tarea se está ejecutando — aquí o en cualquier otro proceso —, la
respuesta es `409` con el código `CRON_JOB_ALREADY_EXECUTING`; consulta
[Protección de concurrencia](/docs/backend/cron-across-instances/#concurrency-guarding).

La llamada espera a que termine la ejecución y responde `200` con su log. Para una tarea que se ejecuta
más tiempo del que un proxy delante del servidor mantiene una petición (muchos lo hacen a los 60 segundos), añade
`?async=1`. La respuesta es entonces `202` en cuanto la ejecución ha empezado:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/nightly-report/trigger?async=1"
```

```json
{
    "accepted": true,
    "startedAt": "2026-04-24T08:21:04.512Z",
    "job": { "id": "nightly-report", "state": "running" }
}
```

La ejecución continúa tras la respuesta. Su resultado está en `GET /api/admin/cron/:id/logs`, como la
entrada con `"manual": true` y el mismo `startedAt`. Una ejecución que no puede empezar sigue respondiendo
`409`. `?async` acepta `1`, `true`, `0` o `false`; cualquier otro valor es un `400`.

### Pausar una tarea

Una pausa desde Studio o con
`PUT /api/admin/cron/:id` se aplica a todos los procesos y se mantiene tras
reinicios y redespliegues; `{ "enabled": null }` devuelve la tarea al `enabled`
que declara su archivo. Cómo la lee cada réplica, y qué ocurre cuando una no
puede, está en [Cron entre instancias](/docs/backend/cron-across-instances/#pausing-a-job-across-every-process).

## SDK tipado

El SDK tipado de Rebase expone un espacio de nombres `cron` para todas las operaciones:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

// List all jobs, and the ones that did not register
const { jobs, rejected } = await client.cron.listJobs();

// Get a single job
const { job } = await client.cron.getJob("health-check");

// Trigger manually, and wait for the run
const { log, job: updated } = await client.cron.triggerJob("health-check");

// Trigger manually, and answer once the run has started
const { startedAt } = await client.cron.triggerJob("nightly-report", { async: true });

// View execution history
const { logs } = await client.cron.getJobLogs("health-check", { limit: 10 });

// Enable or disable
await client.cron.toggleJob("health-check", false); // pause
await client.cron.toggleJob("health-check", true);  // resume
```

`triggerJob()` espera a que termine la ejecución y responde con su log. Un proxy delante del
servidor puede cortar la respuesta de un trabajo largo (muchos lo hacen a los 60 segundos) mientras la
ejecución sigue su curso. Para un trabajo así pasa `{ async: true }`: la llamada responde en cuanto la ejecución ha empezado,
y `getJobLogs()` tiene el resultado, como la entrada con `manual: true` y el `startedAt` devuelto.

`listJobs()` tiene el tipo `CronJobListing`: `jobs`, más los campos `skipped`,
`rejected` y `note` descritos en [Tareas que no están ahí](#tareas-que-no-están-ahí).
