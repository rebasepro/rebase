---
sourceHash: 7f143b9dd11e44cb
title: Cron Jobs
sidebar_label: Cron Jobs
description: Programa tareas recurrentes en segundo plano con el sistema integrado de cron jobs de Rebase. Define tareas como archivos TypeScript, monitorízalas en Studio y gestiónalas a través de la API REST.
---

## Visión general

Rebase incluye un **programador de cron jobs** integrado para ejecutar tareas recurrentes en segundo plano: limpieza de datos, generación de informes, comprobaciones de estado (health checks), sincronizaciones de APIs externas y más.

Los cron jobs siguen el mismo patrón de **descubrimiento basado en archivos** que las funciones personalizadas: coloca un archivo TypeScript en tu directorio `crons/`, y Rebase lo registrará y programará automáticamente.

- **Cero dependencias** — No requiere librerías externas de programación
- **API de administración** — Endpoints REST para listar, activar manualmente, habilitar/deshabilitar y ver registros (logs)
- **Panel de Studio** — Monitoriza todas las tareas, consulta el historial de ejecución y activa ejecuciones manualmente
- **Persistencia en base de datos** — Registros de ejecución almacenados en PostgreSQL, que sobreviven a los reinicios
- **Caché en memoria** — Búfer circular rápido (últimas 50 ejecuciones) para el panel, respaldado por la base de datos

## Definición de un Cron Job

Crea un archivo en tu directorio `backend/crons/` que exporte por defecto una definición de cron. Utiliza el helper `defineCron` de `@rebasepro/server` para inferencia de tipos y autocompletado:

```typescript
// backend/crons/health-check.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
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
});
```

`rebase dev` observa el directorio crons, por lo que una tarea agregada mientras se está ejecutando se registra en la siguiente recarga, sin necesidad de reiniciar. (Se le debe indicar: el directorio se escanea en lugar de importarse, por lo que el watcher no puede inferirlo).

:::note
`defineCron` es una función de identidad: devuelve el mismo objeto que le pasas. Un objeto `CronJobDefinition` plano exportado por defecto funciona de manera idéntica; `defineCron` simplemente proporciona comprobación de tipos en tiempo de compilación y autocompletado en el editor.
:::

El **nombre del archivo** (sin extensión) se convierte en el ID único de la tarea; por ejemplo, `health-check`.


## Configuración

:::note[Dónde va esto]
**Runtime gestionado** — coloca los archivos en `backend/crons/`; el runtime descubre ese directorio por sí mismo, y `entry.crons` en `rebase.json` solo es necesario si lo moviste. `REBASE_CRON_SCHEDULER` en `.env` decide si *este* proceso ejecuta los temporizadores.

**Ejected** — `cronsDir` en `initializeRebaseBackend({ … })`, como se muestra a continuación.

El mapa completo se encuentra en [Backend Overview](/docs/backend/#where-each-option-lives).
:::

Habilita los cron jobs añadiendo `cronsDir` a tu configuración del backend:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

Eso es todo. Rebase hará lo siguiente:

1. Escaneará el directorio en busca de archivos `.ts` / `.js`
2. Registrará cada exportación por defecto como un cron job
3. Creará automáticamente las tablas `rebase.cron_logs`, `rebase.cron_claims` y `rebase.cron_job_state` en PostgreSQL (si el controlador soporta SQL)
4. Iniciará el programador y cargará los contadores a partir de los registros existentes en la base de datos
5. Montará las rutas REST de administración en `/api/admin/cron`

## Sintaxis de programación

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
| `0 0 * * 1` | Todos los lunes a medianoche |
| `0 9 1 * *` | El primer día de cada mes a las 9:00 AM |
| `0,30 * * * *` | Cada 30 minutos (en :00 y :30) |
| `0 9-17 * * 1-5` | Cada hora, de 9 AM a 5 PM, solo días laborables |

Se admiten valores de intervalo o pasos (`*/n`), rangos (`a-b`) y listas (`a,b,c`).

Una programación se compara con la hora local de su zona. En un cambio de horario de verano, eso significa que una tarea a hora fija dentro de la hora repetida (`30 2 * * *` donde los relojes se atrasan a las 03:00) se ejecuta en las dos pasadas de esa hora, y una dentro de la hora que se salta, cuando los relojes se adelantan, no se ejecuta ese día.

## Referencia de CronJobDefinition

`timezone` es nuevo; en la versión 0.17.3 una programación siempre se lee en la zona horaria propia del host. Todo lo demás en esta interfaz ya ha sido lanzado.

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // IANA zone the schedule is read in, e.g. "Europe/Madrid". Without it the
    // schedule is read in the host's own zone — UTC in nearly every container,
    // yours on a laptop — so name it. An unknown zone is refused when the job
    // loads rather than read as local time.
    timezone?: string;

    // Human-readable name shown in Studio
    name: string;

    // Optional description shown in Studio
    description?: string;

    // Whether the job runs (default: true). A pause or a resume from Studio
    // or the admin API overrides it, for every process, until reset.
    enabled?: boolean;

    // Max execution time in seconds (default: 300). Infinity means no
    // timeout; 0, a negative number or NaN is refused when the job loads.
    timeoutSeconds?: number;

    // How far back to look on startup for a slot that elapsed while no
    // instance was ticking (default: off). See "Cron across instances".
    catchUpWindowSeconds?: number;

    // The function to run on each tick
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

## Contexto del handler

Cada handler recibe un `CronJobContext` que contiene métodos de utilidad y la instancia del cliente de Rebase:

```typescript no-verify
interface CronJobContext {
    // The job's unique ID (derived from filename)
    jobId: string;

    // The scheduled tick timestamp
    scheduledAt: Date;

    // Logger — captured lines appear in Studio and the logs API
    log: (...args: unknown[]) => void;

    // Aborted when the run exceeds `timeoutSeconds`, or when a shutdown's
    // wait for it runs out
    signal: AbortSignal;

    // The server-side Rebase singleton — the same object `import { rebase }
    // from "@rebasepro/server"` returns, and the same one `defineFunction`
    // hands its callback.
    rebase: RebaseServerClient;
}
```

Usa `ctx.log()` para emitir salida estructurada. Estas líneas se capturan en el registro de ejecución y son visibles en Studio y a través de la API REST.

### `ctx.signal` — detén el trabajo cuando la ejecución se detenga

El tiempo de espera (timeout) finaliza la *ejecución*: el programador deja de esperar y registra un fallo. No finaliza el handler. Pasa `ctx.signal` a cualquier cosa que acepte una señal, y el trabajo se detendrá con ella:

```typescript no-verify
export default defineCron({
    name: "Sync inventory",
    schedule: "*/15 * * * *",
    timeoutSeconds: 60,
    async handler({ signal, log }) {
        const res = await fetch("https://supplier.example.com/stock", { signal });
        log(`fetched ${res.status}`);
    }
});
```

Sin ella, una tarea cuyo tiempo de espera coincide con su intervalo pierde (fuga) una petición abandonada por cada tick, de forma invisible, porque cada ejecución ya se ha registrado como fallida.

:::note[`ctx.client` fue eliminado]
Era un segundo nombre para `ctx.rebase`, y su tipo volvía a exponer `client.data`, el cual el alias `RebaseServerClient` omite deliberadamente para que el plano privilegiado tenga exactamente un solo nombre. Un lector que aprendiera `client.data` aquí lo trasladaba a un callback de colección, donde `context.data` es el plano *con alcance de usuario (user-scoped)*: misma ortografía, privilegio opuesto. Usa `ctx.rebase.dataAsAdmin`.
:::

### Interactuar con la base de datos y los servicios mediante `ctx.rebase`

`ctx.rebase.dataAsAdmin` es el plano de datos con alcance de administrador (admin-scoped). Un cron no tiene un usuario por petición, por lo que aquí no hay una alternativa con alcance de usuario; define tú mismo los filtros de cada consulta.

:::caution[El alcance de administrador no omite RLS]
`dataAsAdmin` se define una sola vez, al arrancar, como `{ uid: "service", roles: ["admin"] }`. Cada lectura y escritura aún se ejecuta en una transacción que ha realizado `SET LOCAL ROLE rebase_user` con `app.uid = 'service'`, y **tus políticas se evalúan** contra esa identidad. Supera las políticas predeterminadas integradas a través de su cláusula `rolesOverlap(['admin'])`, por lo que la diferencia rara vez se nota. Se nota cuando escribes las tuyas propias: `policy.serverContext()` compila a `rebase.uid() IS NULL` y, por tanto, es **false** aquí, de modo que una colección con `disableDefaultPolicies: true` cuya única regla sea `serverContext()` denegará estas escrituras y devolverá cero filas — HTTP 200, vacío — para estas lecturas.

`rebase.sql()` *sí* es una omisión incondicional: conexión de propietario (owner), sin políticas.
:::

```typescript
// backend/crons/expire-users.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    schedule: "0 0 * * *", // Daily at midnight
    name: "Expire Inactive Accounts",
    
    async handler(ctx) {
        ctx.log("Checking for expired trial users...");

        // Fetch using the pre-initialized data driver. `collection<Row>(slug)`
        // gives the query builder the row type — `where` keys are checked
        // against it. Every filter is an `[operator, value]` tuple; a bare
        // value is passed straight through and builds a malformed query.
        const users = ctx.rebase.dataAsAdmin.collection<{
            id: string;
            email: string;
            trial_status: string;
            trial_ends_at: string;
            status: string;
        }>("users");

        const { data: trials } = await users.find({
            where: {
                trial_status: ["==", "active"],
                trial_ends_at: ["<", new Date().toISOString()]
            }
        });

        ctx.log(`Found ${trials.length} users with expired trials.`);

        for (const user of trials) {
            await users.update(user.id, {
                trial_status: "expired",
                status: "disabled"
            });
            
            // Send email notification using the Rebase email service
            await ctx.rebase.email.send({
                to: user.email,
                subject: "Your trial has expired",
                html: "<p>Please upgrade your subscription to continue.</p>"
            });
        }
    }
});
```

:::tip
El handler puede devolver cualquier valor serializable en JSON. Se almacenará en la entrada del registro como `result` y se mostrará en el historial de ejecuciones de Studio.
:::

## API REST

Todas las rutas de cron requieren **autenticación de administrador** (`requireAuth` + `requireAdmin`).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/admin/cron` | Listar todos los cron jobs registrados |
| `GET` | `/api/admin/cron/:id` | Obtener el estado de una tarea individual |
| `POST` | `/api/admin/cron/:id/trigger` | Activar manualmente una tarea — `409` mientras ya se está ejecutando |
| `GET` | `/api/admin/cron/:id/logs` | Obtener el historial de ejecución (`?limit=N`) |
| `PUT` | `/api/admin/cron/:id` | Pausar o reanudar una tarea en todos los procesos (`{ "enabled": false }`); `null` vuelve a seguir el código |

### Ejemplo: Listar todas las tareas

`$TOKEN` es un token de acceso de administrador: inicia sesión y usa el `accessToken` devuelto en la respuesta de inicio de sesión. `$API_URL` es lo que haya impreso `rebase dev`; el puerto se deriva de la ruta del proyecto, por lo que no es fijo.

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
    "note": "1 cron file(s) failed to load and 1 job(s) have an invalid schedule — NOT scheduled. See `rejected` for the reason; the server log has the rest."
}
```

`rejected` nombra la tarea y el motivo. Un archivo que falló al *cargar* solo tiene un recuento: el fallo ocurrió antes de que hubiera una tarea que nombrar, por lo que el motivo está en los registros del servidor.

La entrada más común aquí es la de arriba: seis campos, a partir de una expresión copiada de una herramienta que admite segundos. Rebase acepta cinco; elimina el primer campo. Un `timeoutSeconds` de cero, un número negativo o `NaN` también aparece aquí.

### Ejemplo: Activar una tarea manualmente

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/health-check/trigger"
```

<span class="since-badge" data-since="0.23">Desde 0.23</span> Mientras la tarea se está ejecutando — aquí o en cualquier otro proceso —, la
respuesta es `409` con el código `CRON_JOB_ALREADY_EXECUTING`; consulta
[Protección de concurrencia](/docs/backend/cron-across-instances/#concurrency-guarding).

### Pausar una tarea

<span class="since-badge" data-since="0.23">Since 0.23</span> Una pausa desde Studio o con
`PUT /api/admin/cron/:id` se aplica a todos los procesos y se mantiene tras
reinicios y redespliegues; `{ "enabled": null }` devuelve la tarea al `enabled`
que declara su archivo. Cómo la lee cada réplica, y qué ocurre cuando una no
puede, está en [Cron entre instancias](/docs/backend/cron-across-instances/#pausing-a-job-across-every-process).

## SDK de cliente

El SDK cliente de Rebase expone un espacio de nombres `cron` para todas las operaciones:

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

## Panel de Studio

Cuando los cron jobs están configurados, aparece una herramienta **Cron Jobs** en Rebase Studio bajo **Compute**, junto a la consola de JS. El panel proporciona:

- **Lista de tareas** — Todas las tareas registradas con indicadores de estado en vivo
- **Panel de detalles** — Programación, próxima/última ejecución, duración e información de errores
- **Historial de ejecución** — Entradas de registro desplegables con salida capturada y resultados
- **Activación manual** — Ejecuta cualquier tarea bajo demanda con un solo clic
- **Habilitar/deshabilitar** — Pausa y reanuda tareas sin reiniciar el servidor, en todos los procesos a la vez; una pausa se mantiene tras reinicios y despliegues

El panel se actualiza automáticamente cada 15 segundos.

El panel muestra lo mismo sea cual sea el proceso que lo sirve. Una tarea que
otro proceso está ejecutando aparece como en ejecución, y en un proceso cuyo
programador no está iniciado — el rol `api` junto a un worker — el número de
ejecuciones, el número de fallos y la última ejecución se leen de
`rebase.cron_logs`, con una consulta limitada a las filas de cada tarea, en lugar
de un proceso que no ejecuta nada.

## Validación de programación y análisis AST

Durante la inicialización del backend, Rebase analiza todas las programaciones de cron registradas utilizando un expansor de cron basado en JS sin dependencias:
- **Comprobación de sintaxis**: Verifica que la cadena contenga exactamente 5 campos separados por espacios en blanco (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Expansión de rangos**: Descompone pasos (`*/15`), rangos (`9-17`) y listas separadas por comas (`0,30`) en arrays explícitos de enteros válidos mapeados a sus respectivos límites (por ejemplo, minutos `0-59`, horas `0-23`, meses `1-12`).
- Si alguna expresión cron no supera la validación, Rebase rechaza la definición, registra un error de inicio y se niega a registrar la tarea para evitar fallos de ejecución en tiempo de ejecución.

---

## Bajo el capó: Corrección de desvío del reloj (Clock-Drift)

Los programadores estándar basados en intervalos (como `setInterval`) se desvían con el tiempo y causan picos significativos de CPU debido a los retrasos en la programación del bucle de eventos a nivel del sistema operativo. Para garantizar la precisión en la ejecución, Rebase implementa un **bucle dinámico de cálculo de tiempo objetivo**:
1. **Cálculo de candidatos**: Al completar una tarea o iniciar el programador, Rebase calcula la marca de tiempo exacta del *siguiente* minuto candidato coincidente.
2. **Espera dinámica (Dynamic Sleep)**: Calcula la diferencia en milisegundos (`nextRun.getTime() - now.getTime()`) y programa un único `setTimeout`.
3. **Umbral de seguridad contra desvíos**: Se aplica un búfer mínimo de espera (`MIN_SCHEDULE_INTERVAL_MS`) de **5.000 ms**. Si un tick del programador se completa con extrema rapidez, este umbral evita una doble activación casi instantánea.
4. **Facilidad de apagado (Shutdown Friendliness)**: Los identificadores de temporizadores se desacoplan explícitamente del bucle de eventos de Node.js mediante `timer.unref()`, asegurando que los programadores de cron en segundo plano no bloqueen las terminaciones limpias de procesos durante los despliegues.

---

## Más de un proceso

Cada proceso cuyo programador está activo arma los mismos temporizadores; la
base de datos decide cuál de ellos ejecuta cada intervalo. Cómo un intervalo se
ejecuta una sola vez, cómo se recupera un intervalo que un reinicio perdió, cómo
una pausa llega a todas las réplicas y por qué una activación manual nunca se
ejecuta junto a una programada se explica en [Cron entre instancias](/docs/backend/cron-across-instances).

---

## Tiempos de espera y aislamiento de errores

- **Carrera de tiempo de espera forzado (Forced Timeout Race)**: Los bloques de ejecución están envueltos en un `Promise.race` contra un temporizador de tiempo de espera derivado de `timeoutSeconds` (por defecto: `300` segundos / 5 minutos; `Infinity` para ningún límite). Si el handler se queda colgado superando este umbral, `ctx.signal` se aborta y la promesa se rechaza, lanzando:
  `Error: Cron job "<id>" timed out after <N>ms`
  El aborto es la parte que detiene el *trabajo*; el rechazo solo detiene la espera del programador. Un handler que ignore `ctx.signal` seguirá ejecutándose más allá de su propia ejecución.
- **Apagado**: `backend.shutdown()` espera a una ejecución en curso, dentro del mismo presupuesto que la cola de trabajos (dos tercios del tiempo de espera de apagado). Si la ejecución sigue en marcha cuando se agota, `ctx.signal` se aborta y se registra como fallida, con el motivo. Su intervalo sigue reclamado, así que ninguna otra instancia lo vuelve a ejecutar.
- **Try/Catch a prueba de fallos**: El handler de cada tarea se ejecuta dentro de un contenedor aislado. Cualquier excepción no capturada es interceptada, formateando el seguimiento de errores (traceback) en una cadena, estableciendo el estado de la tarea en `"error"` y actualizando los contadores de fallos de `rebase.cron_logs`. Un fallo dentro de una sola tarea cron nunca hará caer el bucle del programador ni el servidor web HTTP principal de Hono.
- **Búfer circular en memoria**: El programador mantiene un búfer circular que contiene las últimas **50 ejecuciones** por tarea. Este búfer se mantiene en memoria para permitir lecturas casi instantáneas desde Rebase Studio.

---

## Esquema de persistencia en base de datos

Cuando los adaptadores de base de datos compatibles con SQL (por ejemplo, PostgreSQL) están activos, Rebase aprovisiona la tabla `rebase.cron_logs`:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.cron_logs (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id       TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ NOT NULL,
    duration_ms  INTEGER NOT NULL,
    success      BOOLEAN NOT NULL DEFAULT true,
    error        TEXT,                                 -- Stack trace or error message
    result       JSONB,                                -- Return value of handler
    logs         JSONB,                                -- Ring buffer array of ctx.log outputs
    manual       BOOLEAN NOT NULL DEFAULT false        -- True if triggered from Studio/REST
);

CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON rebase.cron_logs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_logs_job_failures ON rebase.cron_logs(job_id) WHERE NOT success;

CREATE TABLE IF NOT EXISTS rebase.cron_job_state (
    job_id         TEXT PRIMARY KEY,
    enabled        BOOLEAN,       -- NULL: follow the job's own `enabled`
    updated_at     TIMESTAMPTZ,   -- when `enabled` was last set, and by whom
    updated_by     TEXT,
    running_until  TIMESTAMPTZ,   -- the run lease: live while in the future
    running_by     TEXT
);
```

Cada una se crea al arrancar si falta, así que una base de datos anterior a ella
la obtiene en su siguiente despliegue. Ninguna es una colección, y el rol de
usuario final `rebase_user` no tiene ningún privilegio sobre ellas: un
`cron_job_state` escribible permitiría a un usuario autenticado pausar una tarea
para todos, o retener su lease para que nada la ejecute.

Al arrancar, el programador lee las estadísticas de esta tabla mediante consultas de agregación (`COUNT(*)`, `SUM(CASE WHEN success = false THEN 1 ELSE 0 END)`) para completar el historial de `totalRuns` y `totalFailures`. Las inserciones de registros se ejecutan en un barrido asíncrono no bloqueante; si falla el volcado a la base de datos, el programador registra el error y continúa la ejecución normal utilizando el búfer circular en memoria como alternativa de respaldo.

## Ejemplo: Tarea de limpieza diaria

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

        // Admin-scoped data access — see `ctx.rebase` above.
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const expired = await ctx.rebase.dataAsAdmin.sessions.findAll({
            where: { last_seen_at: ["<", cutoff] }
        });
        for (const session of expired) {
            await ctx.rebase.dataAsAdmin.sessions.delete(session.id as string);
        }

        ctx.log(`Cleaned up ${expired.length} expired sessions`);

        return { deletedSessions: expired.length };
    },
};

export default job;
```

## Cron jobs en el grafo de recursos

Cada archivo de cron es también una declaración. `rebase resources` lo lista bajo el nombre del archivo —el mismo id con el que el programador lo ejecuta y el que muestra Studio— con su programación y zona horaria, de modo que el host lee las programaciones de un proyecto antes de ejecutar nada. Un cron no se vincula a ninguna variable de entorno; `rebase status` lo muestra en verde sin nada que configurar.

Leer la programación implica importar el archivo, y `rebase resources` es un paso de compilación: sin `.env`, sin secretos. Por lo tanto, mantén el **alcance del módulo (module scope)** de un cron libre de cualquier cosa que lea la configuración al importarse: un cliente de base de datos creado en la parte superior de un helper, un `env.ts` que valide `DATABASE_URL`. En su lugar, importa ese trabajo dentro del handler:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

El handler se ejecuta en el despliegue, donde esas variables existen. Una importación en el nivel superior (top-level) del mismo módulo hace que el grafo solo pueda derivarse en una máquina que tenga un `.env`, y carga toda la dependencia en cada arranque que simplemente registre la tarea.

## Siguientes pasos

- **[Backend Overview](/docs/backend)** — Referencia completa de configuración del backend
- **[Entity Callbacks](/docs/collections/callbacks)** — Ejecuta lógica ante cambios de datos
- **[Webhook Integration](/docs/recipes/webhooks)** — Envía notificaciones en eventos
- **[Cron entre instancias](/docs/backend/cron-across-instances)** — Una ejecución por intervalo, intervalos perdidos, pausar en todas partes y ejecuciones solapadas
