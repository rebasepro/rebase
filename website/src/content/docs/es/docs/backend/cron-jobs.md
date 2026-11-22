---
sourceHash: 571b6448756b487e
title: Cron Jobs
sidebar_label: Cron Jobs
description: Programa tareas en segundo plano recurrentes con el sistema de cron jobs integrado de Rebase. Define tareas como archivos TypeScript, monitorízalas en Studio y gestiónalas a través de la API REST.
---

## Descripción general

Rebase incluye un **programador de cron jobs** integrado para ejecutar tareas periódicas en segundo plano: limpieza de datos, generación de informes, comprobaciones de estado (health checks), sincronizaciones con APIs externas y más.

Los cron jobs siguen el mismo patrón de **detección basada en archivos** que las funciones personalizadas: coloca un archivo TypeScript en tu directorio `crons/`, y Rebase lo registrará y programará automáticamente.

- **Cero dependencias** — No se requieren bibliotecas externas de programación de tareas
- **API de administración** — Endpoints REST para listar, disparar, habilitar/deshabilitar y ver registros (logs)
- **Panel de Studio** — Monitoriza todas las tareas, consulta el historial de ejecuciones y dispara ejecuciones manualmente
- **Persistencia en base de datos** — Registros de ejecución almacenados en PostgreSQL, sobreviviendo a reinicios
- **Caché en memoria** — Búfer circular rápido (últimas 50 ejecuciones) para el panel, respaldado por la base de datos

## Definición de un Cron Job

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

`rebase dev` observa el directorio crons, por lo que una tarea añadida mientras se está ejecutando se registra en la siguiente recarga — sin reiniciar. (Debe ser notificado: el directorio se escanea en lugar de importarse, por lo que el watcher no puede inferirlo).

:::note
`defineCron` es una función de identidad: devuelve el mismo objeto que le pasas. Un objeto plano `CronJobDefinition` exportado por defecto funciona de forma idéntica; `defineCron` simplemente proporciona verificación de tipos en tiempo de compilación y autocompletado en el editor.
:::

El **nombre del archivo** (sin extensión) se convierte en el ID único de la tarea — por ejemplo, `health-check`.


## Configuración

:::note[Dónde va esto]
**Runtime administrado** — coloca los archivos en `backend/crons/`; el runtime descubre ese directorio por sí mismo, y `entry.crons` en `rebase.json` solo es necesario si lo moviste. `REBASE_CRON_SCHEDULER` en `.env` decide si *este* proceso ejecuta los temporizadores.

**Ejected** — `cronsDir` en `initializeRebaseBackend({ … })`, como se muestra a continuación, o `crons` con las tareas como valores.

El mapa completo está en [Visión general del backend](/docs/backend/#where-each-option-lives).
:::

Habilita los cron jobs añadiendo `cronsDir` a tu configuración del backend:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

Eso es todo. Rebase se encargará de:

1. Escanear el directorio en busca de archivos `.ts` / `.js`
2. Registrar cada exportación por defecto como un cron job
3. Crear automáticamente las tablas `rebase.cron_logs`, `rebase.cron_claims` y `rebase.cron_job_state` en PostgreSQL (si el driver admite SQL)
4. Iniciar el programador e inicializar los contadores a partir de los logs existentes en la base de datos
5. Montar las rutas REST de administración en `/api/admin/cron`

### Cron jobs como valores

`crons` toma las tareas como un registro (record) del id de la tarea a su definición, junto a `tables`. Un directorio es una forma de construirlo: `loadCrons(dir)` lee uno exactamente con esa estructura.

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

Proporciona `crons` o `cronsDir`, no ambos: el arranque rechazará el par. Construir el backend registra las tareas; lo que inicia sus temporizadores es `start()`, el cual `initializeRebaseBackend` llama por ti. Con [`createRebaseBackend`](/docs/backend/custom-server/) lo llamas tú mismo, en el proceso que debe ejecutarlas. `loadCronJobsFromDirectory` y `loadCronJobsWithDiagnostics` todavía funcionan, están obsoletos (deprecated) y emiten una advertencia una sola vez.

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
| `0 9 1 * *` | Primer día de cada mes a las 9:00 AM |
| `0,30 * * * *` | Cada 30 minutos (en :00 y :30) |
| `0 9-17 * * 1-5` | Cada hora, de 9 AM a 5 PM, solo días laborables |

Se admiten valores de paso (`*/n`), rangos (`a-b`) y listas (`a,b,c`).

Cuando se restringen tanto el día del mes como el día de la semana, un día que coincida con cualquiera de ellos coincide, como en cron estándar: `0 9 1 * 1` se ejecuta el día 1 de cada mes y todos los lunes. Cuando cualquiera de los campos comienza con `*`, un día debe coincidir con ambos.

Una programación se evalúa según la hora local (reloj de pared) de su zona horaria. A lo largo de un cambio de horario de verano, esto significa que una tarea de hora fija dentro de la hora repetida (`30 2 * * *` donde los relojes se atrasan a las 03:00) se ejecutará en ambos pasos de esa hora, y una dentro de la hora omitida, cuando los relojes se adelantan, no se ejecutará ese día.

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

## Contexto del handler

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

Usa `ctx.log()` para emitir una salida estructurada. Estas líneas se capturan en el registro de ejecución y son visibles en Studio y a través de la API REST. Cada línea también se escribe en el log del servidor a nivel `info` con un campo `cron` que contiene el ID de la tarea, por lo que aparece dondequiera que se recopile la salida de tu contenedor, incluidos los logs de depuración de Rebase Cloud. Esa copia se redacta (ofusca) de la misma forma que las líneas de registro del propio servidor: los valores de claves como `password` o `apiKey`, y el SQL y los parámetros de una consulta fallida, se reemplazan. El registro de ejecución almacena la línea sin esa ofuscación.

El registro de ejecución conserva las primeras 500 líneas o 64 KB de una ejecución, lo que ocurra primero, y luego una línea que indica cuántas más hubo: `… 9500 more lines not kept — see the server log`. El registro del servidor recibe cada una de las líneas. Una tarea que registre una línea por cada elemento que procesa debe prever que su historial mostrará el inicio de la ejecución.

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

Sin esto, una tarea cuyo tiempo de espera coincida con su intervalo filtrará una solicitud abandonada por cada tick — de forma invisible, porque cada ejecución ya estará registrada como fallida.

:::note[`ctx.client` fue eliminado]
Era un segundo nombre para `ctx.rebase`, y su tipo volvía a exponer `client.data` — el alias que `RebaseServerClient` omite deliberadamente para que el plano privilegiado tenga exactamente un solo nombre. Un lector que aprendía `client.data` aquí lo trasladaba a un hook de tabla, donde `context.data` es el plano con *ámbito de usuario* (user-scoped): misma ortografía, privilegio opuesto. Usa `ctx.rebase.dataAsAdmin`.
:::

### Interactuar con la base de datos y servicios mediante `ctx.rebase`

`ctx.rebase.dataAsAdmin` es el plano de datos con ámbito de administrador (admin-scoped). Un cron no tiene un usuario por solicitud, por lo que no hay una alternativa con ámbito de usuario aquí — define el alcance de los filtros de cada consulta tú mismo.

:::caution[El ámbito de administrador no elude RLS]
`dataAsAdmin` se define una vez, en el arranque, como `{ uid: "service", roles: ["admin"] }`.
Cada lectura y escritura todavía se ejecuta en una transacción que ha aplicado `SET LOCAL ROLE rebase_user` con `app.uid = 'service'`, y **tus políticas se evalúan** — contra esa identidad. Supera las políticas predeterminadas integradas a través de su rama `rolesOverlap(['admin'])`, por lo que la diferencia rara vez se nota. Se nota cuando escribes las tuyas propias: `policy.serverContext()` se compila en `rebase.uid() IS NULL` y, por lo tanto, es **false** aquí, por lo que una tabla con `defaultPolicies: false` cuya única regla es `serverContext()` deniega estas escrituras y devuelve cero filas — HTTP 200, vacías — para estas lecturas.

`rebase.sql()` *sí* elude RLS incondicionalmente: conexión de propietario, sin políticas.
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
El handler puede devolver cualquier valor serializable en JSON. Se almacenará en la entrada del registro como `result` y se mostrará en el historial de ejecución de Studio.
:::

## API REST

El listado, la activación, la pausa y la reanudación de tareas a través de HTTP, y el SDK tipado `client.cron`, se encuentran en [API de Cron Jobs](/docs/backend/cron-jobs-api/).

## Panel de control en Studio

Cuando se configuran cron jobs, aparece la herramienta **Tareas programadas** en Rebase Studio bajo **Cómputo**, junto a la consola de JS. El panel proporciona:

- **Lista de tareas** — Todas las tareas registradas con indicadores de estado en tiempo real
- **Panel de detalles** — Programación, próxima/última ejecución, duración e información de errores
- **Historial de ejecuciones** — Entradas de registro expandibles con salidas y resultados capturados
- **Disparador manual** — Ejecuta cualquier tarea bajo demanda con un solo clic. El panel espera a que termine la ejecución e indica cómo fue: una ejecución fallida muestra su error
- **Habilitar/deshabilitar** — Pausa y reanuda tareas sin reiniciar el servidor, para todos los procesos a la vez; una pausa se mantiene a través de reinicios y despliegues
- **Tareas ausentes (Jobs that are not there)** — cada tarea que el programador rechazó, con su programación y el motivo, y cuántos archivos cron fallaron al cargarse. Ninguna de ellas está programada; consulta [Tareas ausentes](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

El panel se actualiza automáticamente cada 15 segundos.

El panel muestra lo mismo independientemente del proceso que lo atienda. Una tarea que otro proceso esté ejecutando se muestra como en ejecución.
En cada proceso que tiene un almacén de datos (store), el recuento de ejecuciones, el recuento de fallos y la última ejecución se leen desde la base de datos, donde se contabilizan las ejecuciones de cada proceso. Los contadores propios de un proceso solo conservan las ejecuciones que él mismo realizó: el rol `api` junto a un worker no ejecuta nada, y de dos réplicas que programan tareas, ninguna ve los slots que reclamó la otra. Solo cuando no se puede leer la base de datos, la tarjeta recurre a los contadores propios de este proceso, con una advertencia en el log del servidor.

Los recuentos son históricos (totales); el historial corresponde a los últimos 30 días. La fila de cada ejecución en `rebase.cron_logs` se elimina 30 días después de haber comenzado, mediante un barrido horario, mientras que los recuentos de ejecuciones y de fallos continúan contabilizándola. Una ejecución omitida cuenta como una ejecución, como siempre lo ha hecho: es una fila del historial.

## Validación de programación y análisis AST

Al inicializar el backend, Rebase analiza todas las programaciones cron registradas mediante un expansor cron basado en JS sin dependencias:
- **Comprobación de sintaxis**: Verifica que la cadena contenga exactamente 5 campos separados por espacios (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Expansión de rangos**: Descompone pasos (`*/15`), rangos (`9-17`) y listas separadas por comas (`0,30`) en arrays explícitos de enteros válidos asignados a sus límites respectivos (por ejemplo, minutos `0-59`, horas `0-23`, meses `1-12`).
- **Tokens de números enteros**: Cada número, límite de rango y paso debe ser un número entero: `5abc`, `*/5x` y `1.5` son rechazados, al igual que un rango inverso (`5-1`).
- Si alguna expresión cron falla la validación, Rebase rechaza la definición, registra un error de inicio y se niega a registrar la tarea para evitar fallos de ejecución en tiempo de ejecución.

---

## En profundidad: Corrección de desvío del reloj (Clock-Drift)

Los programadores estándar basados en intervalos (como `setInterval`) sufren desvíos con el tiempo y causan picos significativos de CPU debido a los retrasos de programación del bucle de eventos a nivel de sistema operativo. Para garantizar la precisión en la ejecución, Rebase implementa un **bucle de cálculo dinámico de tiempo objetivo**:
1. **Cálculo de candidatos**: Al completar una tarea o iniciar el programador, Rebase calcula la marca de tiempo exacta del *próximo* minuto candidato coincidente.
2. **Espera dinámica (Sleep)**: Calcula la diferencia en milisegundos (`nextRun.getTime() - now.getTime()`) y programa un único `setTimeout`.
3. **Umbral de seguridad contra desvíos**: Se aplica un búfer de espera mínimo (`MIN_SCHEDULE_INTERVAL_MS`) de **5.000 ms**. Si un tick del programador se completa con extrema rapidez, este umbral evita una doble ejecución casi instantánea.
4. **Cierre limpio (Shutdown Friendliness)**: Los manejadores de temporizador se desvinculan explícitamente del bucle de eventos de Node.js mediante `timer.unref()`, garantizando que los programadores cron en segundo plano no bloqueen la terminación limpia de los procesos durante los despliegues.

---

## Más de un proceso

Cada proceso cuyo programador esté activado arma los mismos temporizadores; la base de datos decide cuál de ellos ejecuta cada slot. Cómo se ejecuta un slot una sola vez, cómo se recupera un slot que se perdió por un reinicio, cómo una pausa llega a todas las réplicas y por qué un disparador manual nunca se ejecuta en paralelo con una ejecución programada se explican en [Cron entre instancias](/docs/backend/cron-across-instances).

---

## Tiempos de espera y aislamiento de errores

- **Competición por tiempo de espera forzado (Forced Timeout Race)**: Los bloques de ejecución están envueltos en un `Promise.race` frente a un temporizador derivado de `timeoutSeconds` (por defecto: `300` segundos / 5 minutos; `Infinity` para ninguno). Si el handler se bloquea superando este umbral, `ctx.signal` se aborta y la promesa se rechaza, lanzando:
  `Error: Cron job "<id>" timed out after <N>ms`
  El aborto es la mitad que detiene el *trabajo*; el rechazo solo detiene la espera del programador. Un handler que ignora `ctx.signal` sigue ejecutándose más allá de su propia ejecución.
- **Apagado (Shutdown)**: `backend.shutdown()` espera a que finalicen las ejecuciones en curso, dentro del mismo margen que la cola de trabajos (dos tercios del tiempo de espera de apagado). Una ejecución que continúe cuando este margen expire tendrá su `ctx.signal` abortada y se registrará como fallida, indicando el motivo. Su slot permanece reclamado, por lo que ninguna otra instancia la volverá a ejecutar.
- **Try/Catch a prueba de fallos**: Cada handler de tarea se ejecuta dentro de un contenedor aislado. Cualquier excepción no capturada es interceptada, registrando el mensaje de error (ofuscado) como una cadena, estableciendo el estado de la tarea en `"error"` y actualizando el contador de fallos de la misma. Un fallo dentro de una sola tarea cron nunca provocará la caída del bucle del programador ni del servidor web HTTP principal de Hono.
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

Cada una se crea al arrancar si no existe, por lo que una base de datos previa a su introducción la obtiene en su siguiente despliegue. Ninguna de ellas es una tabla declarada, y el rol de usuario final `rebase_user` no tiene privilegios sobre ninguna de ellas: un `cron_job_state` con permisos de escritura permitiría a un usuario autenticado pausar una tarea para todos o retener su concesión (lease) para que nada la ejecute.

La fila de una ejecución y su recuento se escriben en una sola sentencia: la inserción en `cron_logs` y un upsert de los contadores de la tarea en `cron_job_state`. Un listado lee una fila de `cron_job_state` por tarea, sin importar la longitud del historial, al igual que el programador cuando inicializa `totalRuns` y `totalFailures` al arrancar. Las escrituras de registros no retrasan la ejecución; si una falla, el programador registra el error y continúa, manteniendo la ejecución en el búfer circular en memoria.

Una vez por hora, y cuando se inicia, el programador elimina las filas del historial con más de 30 días y cuenta cualquier ejecución que aún no haya sido contabilizada, ambas operaciones en lotes de 5.000 filas. Un historial escrito antes de la versión 0.24 se contabiliza en el primero de estos barridos, fuera de la ruta de arranque. Hasta que finalice, un listado añade a los contadores las ejecuciones que aún no ha contado, de modo que los números no cambien durante la actualización. Lo mismo ocurre con una ejecución registrada por un servidor antiguo durante un despliegue progresivo (rolling deploy).

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

Cada archivo cron es también una declaración. `rebase resources` lo lista bajo el nombre del archivo — el mismo ID con el que el programador lo ejecuta y que muestra Studio — junto con su programación y zona horaria, de modo que el host pueda leer las programaciones del proyecto antes de ejecutar cualquier cosa. Un cron no se vincula a ninguna variable de entorno; `rebase status` lo muestra en verde sin nada que configurar.

Leer la programación implica importar el archivo, y `rebase resources` es un paso de compilación (build step): sin `.env`, sin secretos. Por lo tanto, mantén el **ámbito del módulo** de un cron libre de cualquier cosa que lea la configuración al importarse — un cliente de base de datos inicializado en la parte superior de un helper, un `env.ts` que valide `DATABASE_URL`. En su lugar, importa ese trabajo dentro del handler:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

El handler se ejecuta en el despliegue, donde existen esas variables. Una importación en el nivel superior (top-level) del mismo módulo hace que el grafo solo pueda deducirse en una máquina que disponga de un `.env` — y carga toda la dependencia en cada arranque que simplemente registre la tarea.

Cargar un cron no declara nada. Un paso de compilación propio que necesite crons en el grafo lo indica explícitamente con `declareCrons`:

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Siguientes pasos

- **[Visión general del backend](/docs/backend)** — Referencia completa de configuración del backend
- **[Hooks de tabla](/docs/collections/callbacks)** — Ejecuta lógica ante cambios en los datos
- **[Integración de webhooks](/docs/recipes/webhooks)** — Envía notificaciones ante eventos
- **[Cron entre instancias](/docs/backend/cron-across-instances)** — Una ejecución por slot, slots perdidos, pausar en todas partes y ejecuciones superpuestas
