---
sourceHash: d47ac3d32c961db1
title: Cron Jobs
sidebar_label: Cron Jobs
description: Programa tareas recurrentes en segundo plano con el sistema de cron jobs integrado de Rebase. Define tareas como archivos TypeScript, monitorízalas en Studio y gestiónalas mediante la API REST.
---

## Visión general

Rebase incluye un **programador de cron jobs integrado** para ejecutar tareas recurrentes en segundo plano: limpieza de datos, generación de reportes, comprobaciones de estado (health checks), sincronizaciones con APIs externas y más.

Los cron jobs siguen el mismo patrón de **detección basada en archivos** que las funciones personalizadas: coloca un archivo TypeScript en tu directorio `crons/` y Rebase lo registrará y programará automáticamente.

- **Cero dependencias** — No se requieren librerías externas de programación
- **API de administración** — Endpoints REST para listar, disparar, activar/desactivar y ver logs
- **Panel de Studio** — Monitoriza todas las tareas, consulta el historial de ejecuciones y dispara ejecuciones manualmente
- **Persistencia en base de datos** — Registros de ejecución almacenados en PostgreSQL, resistiendo reinicios
- **Caché en memoria** — Búfer circular rápido (últimas 50 ejecuciones) para el panel, respaldado por la base de datos

## Definir un Cron Job

Crea un archivo en tu directorio `backend/crons/` que exporte por defecto una definición de cron. Usa el helper `defineCron` de `@rebasepro/server` para inferencia de tipos y autocompletado:

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

`rebase dev` observa el directorio de crons, por lo que una tarea agregada mientras se está ejecutando se registra en la siguiente recarga, sin necesidad de reiniciar. (Se le debe indicar: el directorio se escanea en lugar de importarse, por lo que el observador no puede inferirlo).

:::note
`defineCron` es una función de identidad: devuelve el mismo objeto que le pasas. Un objeto `CronJobDefinition` simple exportado por defecto funciona de forma idéntica; `defineCron` simplemente proporciona comprobación de tipos en tiempo de compilación y autocompletado en el editor.
:::

El **nombre del archivo** (sin extensión) se convierte en el ID único de la tarea; por ejemplo, `health-check`.


## Configuración

:::note[Dónde va esto]
**Runtime administrado** — coloca los archivos en `backend/crons/`; el runtime descubre ese directorio por sí mismo, y `entry.crons` en `rebase.json` solo es necesario si lo moviste. `REBASE_CRON_SCHEDULER` en `.env` decide si *este* proceso ejecuta los temporizadores.

**Ejected** — `cronsDir` en `initializeRebaseBackend({ … })`, como se muestra abajo, o `crons` con las tareas como valores.

El mapa completo se encuentra en [Visión general del backend](/docs/backend/#where-each-option-lives).
:::

Habilita los cron jobs agregando `cronsDir` a la configuración de tu backend:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

Eso es todo. Rebase:

1. Escaneará el directorio en busca de archivos `.ts` / `.js`
2. Registrará cada exportación por defecto como un cron job
3. Creará automáticamente las tablas `rebase.cron_logs`, `rebase.cron_claims` y `rebase.cron_job_state` en PostgreSQL (si el driver soporta SQL)
4. Iniciará el programador y alimentará los contadores a partir de los logs existentes en la BD
5. Montará las rutas REST de administración en `/api/admin/cron`

### Cron jobs como valores

`crons` toma las tareas como un registro de ID de tarea a definición, junto a `collections`. Un directorio es una forma de construirlo: `loadCrons(dir)` lee uno exactamente con esa estructura.

```typescript
import path from "path";
import { defineCron, initializeRebaseBackend, loadCrons } from "@rebasepro/server";

const nightlyReport = defineCron({
    schedule: "0 3 * * *",
    async handler({ log }) {
        log("building the report");
    }
});

await initializeRebaseBackend({ app, server, crons: { "nightly-report": nightlyReport } });
// the same as cronsDir:
await initializeRebaseBackend({ app, server, crons: await loadCrons(path.resolve(__dirname, "../crons")) });
```

Pasa `crons` o `cronsDir`, no ambos: el arranque rechazará el par. Construir el backend registra las tareas; lo que inicia sus temporizadores es `start()`, que `initializeRebaseBackend` llama por ti. Con [`createRebaseBackend`](/docs/backend/custom-server/) lo llamas tú mismo, en el proceso que debe ejecutarlas. `loadCronJobsFromDirectory` y `loadCronJobsWithDiagnostics` todavía funcionan, están obsoletos y emiten una advertencia una sola vez.

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
| `0 0 * * 1` | Cada lunes a medianoche |
| `0 9 1 * *` | Primer día de cada mes a las 9:00 AM |
| `0,30 * * * *` | Cada 30 minutos (en :00 y :30) |
| `0 9-17 * * 1-5` | Cada hora, de 9 AM a 5 PM, solo entre semana |

Se admiten valores de paso (`*/n`), rangos (`a-b`) y listas (`a,b,c`).

Cuando tanto el día del mes como el día de la semana están restringidos, un día que coincida con cualquiera de los dos coincide, como en el cron estándar: `0 9 1 * 1` se ejecuta el día 1 de cada mes y cada lunes. Cuando cualquiera de los campos comienza con `*`, un día debe coincidir con ambos.

Una programación se evalúa según el reloj de pared de su zona horaria. A través de un cambio de horario de verano, esto significa que una tarea con hora fija dentro de la hora repetida (`30 2 * * *` donde los relojes se retrasan a las 03:00) se ejecuta en ambas pasadas de esa hora, y una dentro de la hora omitida, cuando los relojes se adelantan, no se ejecuta ese día.

## Referencia de CronJobDefinition

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // IANA zone the schedule is read in, e.g. "Europe/Madrid". Without it the
    // schedule is read in the host's own zone — UTC in nearly every container,
    // yours on a laptop — so name it. An unknown zone is refused when the job
    // loads rather than read as local time.
    timezone?: string;

    // Human-readable name shown in Studio (default: the job id, the file's name)
    name?: string;

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

## Contexto del manejador (Handler Context)

Cada handler recibe un `CronJobContext` que contiene métodos de utilidad y la instancia de Rebase Client:

```typescript no-verify
interface CronJobContext {
    // The job's unique ID (derived from filename)
    jobId: string;

    // The slot this run fires for: a catch-up run gets the slot it
    // missed, a manual trigger the moment it started
    scheduledAt: Date;

    // Logger — lines appear in Studio, the logs API and the server log
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

Usa `ctx.log()` para emitir salidas estructuradas. Estas líneas se capturan en el log de ejecución y son visibles en Studio y a través de la API REST. Cada línea también se escribe en el log del servidor a nivel `info` con un campo `cron` que contiene el ID de la tarea, por lo que aparece dondequiera que se recopile la salida de tu contenedor, incluidos los logs de depuración de Rebase Cloud. Esa copia se redacta de la misma manera que las propias líneas de log del servidor: se reemplazan los valores de claves como `password` o `apiKey`, y el SQL y los parámetros de una consulta fallida. El log de ejecución almacena la línea sin esa redacción.

El log de ejecución conserva las primeras 500 líneas de una ejecución o 64 KB de las mismas, lo que ocurra primero, y luego una línea que indica cuántas más hubo: `… 9500 more lines not kept — see the server log`. El log del servidor recibe cada línea. Una tarea que registra una línea por elemento procesado debe esperar que su historial muestre el inicio de la ejecución.

### `ctx.signal` — detener el trabajo cuando la ejecución se detiene

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

Sin ella, una tarea cuyo timeout coincida con su intervalo dejará escapar una solicitud abandonada por tick, de forma invisible, porque cada ejecución ya queda registrada como fallida.

:::note[`ctx.client` fue eliminado]
Era un segundo nombre para `ctx.rebase`, y su tipo volvía a exponer `client.data`, el alias que `RebaseServerClient` omite deliberadamente para que el plano con privilegios tenga exactamente un solo nombre. Un lector que aprendía `client.data` aquí lo trasladaba a un callback de colección, donde `context.data` es el plano *con alcance de usuario (user-scoped)*: misma sintaxis, privilegio opuesto. Usa `ctx.rebase.dataAsAdmin`.
:::

### Interactuar con la base de datos y servicios mediante `ctx.rebase`

`ctx.rebase.dataAsAdmin` es el plano de datos con alcance de administrador (admin-scoped). Un cron no tiene un usuario por solicitud, por lo que no hay una alternativa con alcance de usuario aquí; define los filtros de cada consulta tú mismo.

:::caution[El alcance de administrador no elude RLS]
`dataAsAdmin` se configura una vez, en el arranque, como `{ uid: "service", roles: ["admin"] }`. Cada lectura y escritura aún se ejecuta en una transacción que ha hecho `SET LOCAL ROLE rebase_user` con `app.uid = 'service'`, y **tus políticas se evalúan** frente a esa identidad. Supera las políticas predeterminadas integradas a través de su rama `rolesOverlap(['admin'])`, razón por la cual la diferencia rara vez se nota. Se nota cuando escribes las tuyas propias: `policy.serverContext()` se compila en `rebase.uid() IS NULL` y, por lo tanto, es **falso** aquí, por lo que una colección con `disableDefaultPolicies: true` cuya única regla sea `serverContext()` denegará estas escrituras y devolverá cero filas (HTTP 200, vacío) para estas lecturas.

`rebase.sql()` *sí* es una elusión incondicional: conexión de propietario, sin políticas.
:::

```typescript
// backend/crons/expire-users.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    schedule: "0 0 * * *", // Daily at midnight
    name: "Expire Inactive Accounts",
    
    async handler(ctx) {
        ctx.log("Checking for expired trial users...");

        // Fetch using the pre-initialized data driver. `table<Row>(slug)`
        // gives the query builder the row type — `where` keys are checked
        // against it. Every filter is an `[operator, value]` tuple; a bare
        // value is passed straight through and builds a malformed query.
        const users = ctx.rebase.dataAsAdmin.table<{
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
El handler puede devolver cualquier valor serializable en JSON. Se almacenará en la entrada del log como `result` y se mostrará en el historial de ejecuciones de Studio.
:::

## API REST

El listado, activación, pausa y reanudación de tareas a través de HTTP, y el `client.cron` del SDK tipado, se encuentran en [API de Cron Jobs](/docs/backend/cron-jobs-api/).

## Panel de Studio

Cuando los cron jobs están configurados, aparece una herramienta **Cron Jobs** en Rebase Studio bajo **Compute**, junto a la consola JS. El panel proporciona:

- **Lista de tareas** — Todas las tareas registradas con indicadores de estado en vivo
- **Panel de detalles** — Programación, próxima/última ejecución, duración e información de errores
- **Historial de ejecuciones** — Entradas de log desplegables con la salida capturada y los resultados
- **Disparo manual** — Ejecuta cualquier tarea bajo demanda con un solo clic. El panel espera a que termine la ejecución e indica cómo fue: una ejecución fallida muestra su error
- **Activar/desactivar** — Pausa y reanuda tareas sin reiniciar el servidor, para todos los procesos a la vez; una pausa se mantiene a través de reinicios y despliegues
- **Tareas que no están ahí** — Cada tarea que el programador rechazó, con su programación y el motivo, y cuántos archivos cron no pudieron cargarse. Ninguna de ellas está programada; consulta [Tareas que no están ahí](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

El panel se actualiza automáticamente cada 15 segundos.

El panel muestra lo mismo independientemente del proceso que lo sirva. Una tarea que otro proceso esté ejecutando se muestra en ejecución.
En cada proceso que tiene un store, el recuento de ejecuciones, el recuento de fallos y la última ejecución se leen de la base de datos, donde se cuentan las ejecuciones de cada proceso. Los contadores propios de un proceso solo guardan las ejecuciones que él mismo realizó: el rol `api` junto a un worker no ejecuta nada, y de dos réplicas que programan a la vez, ninguna ve los slots que la otra reclamó. Solo cuando no se puede leer la base de datos, la tarjeta recurre a los contadores propios de este proceso, con una advertencia en el log del servidor.

Los recuentos son históricos (desde el inicio); el historial comprende los últimos 30 días. La fila de cada ejecución en `rebase.cron_logs` se elimina 30 días después de haber comenzado, mediante un barrido horario, mientras que los contadores de ejecuciones y fallos la siguen contabilizando. Una ejecución omitida cuenta como una ejecución, como siempre lo ha hecho: es una fila del historial.

## Validación de programación y análisis de AST

En la inicialización del backend, Rebase analiza todas las programaciones cron registradas utilizando un expansor de cron basado en JS sin dependencias:
- **Comprobación de sintaxis**: Verifica que la cadena contenga exactamente 5 campos separados por espacios en blanco (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Expansión de rangos**: Descompone pasos (`*/15`), rangos (`9-17`) y listas separadas por comas (`0,30`) en arrays explícitos de enteros válidos asignados a sus respectivos límites (por ejemplo, minutos `0-59`, horas `0-23`, meses `1-12`).
- **Tokens enteros**: Cada número, límite de rango y paso debe ser un número entero: `5abc`, `*/5x` y `1.5` son rechazados, al igual que un rango que vaya hacia atrás (`5-1`).
- Si alguna expresión cron falla en la validación, Rebase rechaza la definición, registra un error de inicio y se niega a registrar la tarea para evitar fallos de ejecución en tiempo de ejecución.

---

## Bajo el capó: Corrección de desviación del reloj (Clock-Drift)

Los programadores estándar basados en intervalos (como `setInterval`) se desvían con el tiempo y causan picos significativos de CPU debido a los retrasos de programación del event loop a nivel del sistema operativo. Para garantizar la precisión de ejecución, Rebase implementa un **bucle dinámico de cálculo de tiempo objetivo**:
1. **Cálculo de candidatos**: Al completar una tarea o iniciar el programador, Rebase calcula la marca de tiempo exacta del *próximo* minuto candidato coincidente.
2. **Espera dinámica (Sleep)**: Calcula la diferencia en milisegundos (`nextRun.getTime() - now.getTime()`) y programa un único `setTimeout`.
3. **Umbral de seguridad contra desviaciones**: Se aplica un búfer de espera mínimo (`MIN_SCHEDULE_INTERVAL_MS`) de **5,000 ms**. Si un tick del programador se completa con extrema rapidez, este umbral evita un doble disparo casi instantáneo.
4. **Facilidad de apagado (Shutdown Friendliness)**: Los identificadores de los temporizadores se desacoplan explícitamente del event loop de Node.js mediante `timer.unref()`, lo que garantiza que los programadores cron en segundo plano no bloqueen las terminaciones limpias de procesos durante los despliegues.

---

## Más de un proceso

Cada proceso cuyo programador está activo arma los mismos temporizadores; la base de datos decide cuál de ellos ejecuta cada slot. Cómo se ejecuta un slot una sola vez, cómo se recupera un slot que un reinicio perdió, cómo llega una pausa a cada réplica y por qué un disparo manual nunca se ejecuta junto a una ejecución programada se explican en [Cron entre instancias](/docs/backend/cron-across-instances).

---

## Tiempos de espera y aislamiento de errores

- **Carrera de timeout forzado**: Los bloques de ejecución están envueltos en un `Promise.race` contra un temporizador de tiempo de espera derivado de `timeoutSeconds` (por defecto: `300` segundos / 5 minutos; `Infinity` para ninguno). Si el handler se queda colgado más allá de este umbral, `ctx.signal` se aborta y la promesa se rechaza, lanzando:
  `Error: Cron job "<id>" timed out after <N>ms`
  El aborto es la mitad que detiene el *trabajo*; el rechazo solo detiene la espera del programador. Un handler que ignore `ctx.signal` seguirá ejecutándose más allá de su propia ejecución.
- **Apagado (Shutdown)**: `backend.shutdown()` espera a que finalice una ejecución en curso, dentro del mismo margen que la cola de tareas (dos tercios del tiempo de espera de apagado). Si una ejecución continúa activa cuando este tiempo se agota, se aborta su `ctx.signal` y se registra como fallida, indicando el motivo. Su slot permanece reclamado, por lo que ninguna otra instancia vuelve a ejecutarlo.
- **Try/Catch seguro contra fallos**: Cada handler de tarea se ejecuta dentro de un contenedor aislado. Cualquier excepción no capturada es interceptada, registrando el mensaje de error (redactado) como una cadena, estableciendo el estado de la tarea en `"error"` y actualizando el contador de fallos de la tarea. Un fallo dentro de una tarea cron individual nunca provocará la caída del bucle del programador ni del servidor web HTTP primario de Hono.
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
    error        TEXT,                                 -- The error's message, redacted
    result       JSONB,                                -- Return value of handler
    logs         JSONB,                                -- Ring buffer array of ctx.log outputs
    manual       BOOLEAN NOT NULL DEFAULT false        -- True if triggered from Studio/REST
);

ALTER TABLE rebase.cron_logs ADD COLUMN IF NOT EXISTS counted BOOLEAN;  -- the run is in the counters below

CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON rebase.cron_logs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_logs_started ON rebase.cron_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_cron_logs_uncounted ON rebase.cron_logs(job_id, started_at DESC) WHERE counted IS NULL;

CREATE TABLE IF NOT EXISTS rebase.cron_job_state (
    job_id            TEXT PRIMARY KEY,
    enabled           BOOLEAN,       -- NULL: follow the job's own `enabled`
    updated_at        TIMESTAMPTZ,   -- when `enabled` was last set, and by whom
    updated_by        TEXT,
    running_until     TIMESTAMPTZ,   -- the run lease: live while in the future
    running_by        TEXT,
    total_runs        BIGINT NOT NULL DEFAULT 0,   -- all-time, skips included
    total_failures    BIGINT NOT NULL DEFAULT 0,
    last_run_at       TIMESTAMPTZ,                 -- the most recently started run
    last_duration_ms  INTEGER,
    last_success      BOOLEAN,
    last_error        TEXT
);
```

Cada una se crea al arrancar si no existe, de modo que una base de datos anterior a su introducción la obtiene en su siguiente despliegue. Ninguna de ellas es una colección, y el rol de usuario final `rebase_user` no tiene privilegios sobre ninguna de ellas: un `cron_job_state` con permisos de escritura permitiría a un usuario autenticado pausar una tarea para todos o retener su concesión (lease) para que nada la ejecute.

La fila de una ejecución y su recuento se escriben en una sola sentencia: la inserción en `cron_logs` y un upsert de los contadores de la tarea en `cron_job_state`. Un listado lee una fila de `cron_job_state` por tarea, sin importar la longitud del historial, al igual que el programador cuando inicializa `totalRuns` y `totalFailures` al inicio. Las escrituras de logs no retrasan la ejecución; si una falla, el programador registra el error y continúa, manteniendo aún la ejecución en el búfer circular en memoria.

Una vez por hora, y al iniciar, el programador elimina las filas del historial con más de 30 días y cuenta cualquier ejecución que aún no esté contabilizada, ambas operaciones en lotes de 5,000 filas. Un historial escrito antes de la versión 0.24 es contabilizado por el primero de estos barridos, fuera de la ruta de arranque. Hasta que haya terminado, un listado añade a los contadores las ejecuciones que aún no han sido contabilizadas, por lo que los números no cambian al actualizar. Lo mismo ocurre con una ejecución que un servidor más antiguo registre durante un despliegue progresivo (rolling deploy).

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

## Crons en el grafo de recursos

Cada archivo cron es también una declaración. `rebase resources` lo lista bajo el nombre del archivo —el mismo ID con el que el programador lo ejecuta y que muestra Studio— con su programación y zona horaria, de modo que el host lee las programaciones de un proyecto antes de ejecutar nada. Un cron no se vincula a ninguna variable de entorno; `rebase status` lo muestra en verde sin nada que configurar.

Leer la programación implica importar el archivo, y `rebase resources` es un paso de compilación (build step): sin `.env`, sin secretos. Por lo tanto, mantén el **alcance del módulo** (module scope) de un cron libre de cualquier cosa que lea la configuración al importarse: un cliente de base de datos instanciado en la parte superior de un helper, un `env.ts` que valide `DATABASE_URL`. En su lugar, importa ese trabajo dentro del handler:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

El handler se ejecuta en el despliegue, donde esas variables existen. Una importación en el nivel superior del mismo módulo hace que el grafo solo pueda derivarse en una máquina que tenga un archivo `.env`, y carga toda la dependencia en cada arranque que simplemente registre la tarea.

Cargar un cron no declara nada. Un paso de compilación propio que requiera crons en el grafo lo indica explícitamente con `declareCrons`:

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Siguientes pasos

- **[Visión general del backend](/docs/backend)** — Referencia completa de configuración del backend
- **[Hooks de tabla](/docs/collections/callbacks)** — Ejecuta lógica ante cambios de datos
- **[Integración de webhooks](/docs/recipes/webhooks)** — Envía notificaciones ante eventos
- **[Cron entre instancias](/docs/backend/cron-across-instances)** — Una ejecución por slot, slots perdidos, pausar en todas partes y ejecuciones superpuestas
