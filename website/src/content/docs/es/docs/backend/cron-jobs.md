---
sourceHash: dc15b1a8aff0e700
title: Tareas cron
sidebar_label: Tareas cron
description: Programa tareas recurrentes en segundo plano con el sistema de tareas cron integrado de Rebase. Define tareas como archivos TypeScript, monitorízalas en Studio y gestiónalas a través de la API REST.
---

## Visión general

Rebase incluye un **programador de tareas cron** integrado para ejecutar tareas periódicas en segundo plano: limpieza de datos, generación de informes, comprobaciones de estado, sincronizaciones con APIs externas y más.

Las tareas cron siguen el mismo patrón de **detección basada en archivos** que las funciones personalizadas: coloca un archivo TypeScript en tu directorio `crons/`, y Rebase lo registrará y programará automáticamente.

- **Cero dependencias** — No se requieren librerías de programación externas
- **API de administración** — Endpoints REST para listar, activar, habilitar/deshabilitar y consultar registros
- **Panel de control de Studio** — Monitoriza todas las tareas, consulta el historial de ejecuciones y activa ejecuciones manualmente
- **Persistencia en base de datos** — Registros de ejecución almacenados en PostgreSQL, sobreviviendo a reinicios
- **Caché en memoria** — Búfer circular rápido (últimas 50 ejecuciones) para el panel, respaldado por la base de datos

## Definición de una tarea cron

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

`rebase dev` vigila el directorio crons, por lo que una tarea agregada mientras se está ejecutando se
registra en la siguiente recarga — sin necesidad de reiniciar. (Se le debe indicar: el directorio se
escanea en lugar de importarse, por lo que el watcher no puede inferirlo).

:::note
`defineCron` es una función de identidad: devuelve el mismo objeto que le pasas. Un objeto `CronJobDefinition` simple exportado por defecto funciona de forma idéntica; `defineCron` simplemente proporciona comprobación de tipos en tiempo de compilación y autocompletado en el editor.
:::

El **nombre de archivo** (sin extensión) se convierte en el ID único de la tarea; por ejemplo, `health-check`.


## Configuración

:::note[Dónde va esto]
**Runtime administrado** — coloca los archivos en `backend/crons/`; el runtime descubre ese directorio por sí mismo, y `entry.crons` en `rebase.json` solo es necesario si lo moviste. `REBASE_CRON_SCHEDULER` en `.env` decide si *este* proceso ejecuta los temporizadores.

**Ejected** — `cronsDir` en `initializeRebaseBackend({ … })`, como se muestra a continuación, o `crons` con las tareas como valores.

El mapa completo está en [Visión general del backend](/docs/backend/#where-each-option-lives).
:::

Habilita las tareas cron agregando `cronsDir` a la configuración de tu backend:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

Eso es todo. Rebase:

1. Escaneará el directorio en busca de archivos `.ts` / `.js`
2. Registrará cada exportación por defecto como una tarea cron
3. Creará automáticamente las tablas `rebase.cron_logs`, `rebase.cron_claims` y `rebase.cron_job_state` en PostgreSQL (si el driver soporta SQL)
4. Iniciará el programador e inicializará los contadores a partir de los registros existentes en la BD
5. Montará las rutas REST de administración en `/api/admin/cron`

### Tareas cron como valores

`crons` toma las tareas como un registro (record) del ID de la tarea a su definición, junto a `tables`. Un directorio es una forma de construirlo: `loadCrons(dir)` lee uno y lo convierte exactamente en esa estructura.

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

Indica `crons` o `cronsDir`, no ambos: el arranque rechazará el par. Construir el backend registra las tareas; lo que inicia sus temporizadores es `start()`, el cual `initializeRebaseBackend` llama por ti. Con [`createRebaseBackend`](/docs/backend/custom-server/) lo llamas tú mismo, en el proceso que deba ejecutarlas. `loadCronJobsFromDirectory` y `loadCronJobsWithDiagnostics` todavía funcionan, están obsoletos y emiten una advertencia una sola vez.

## Sintaxis de programación

Las expresiones cron utilizan el formato estándar de **5 campos**:

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
| `0 9 1 * *` | El primer día de cada mes a las 9:00 AM |
| `0,30 * * * *` | Cada 30 minutos (en :00 y :30) |
| `0 9-17 * * 1-5` | Cada hora, de 9 AM a 5 PM, solo días laborables |

Los valores de paso (`*/n`), rangos (`a-b`) y listas (`a,b,c`) son todos compatibles.

Cuando tanto el día del mes como el día de la semana están restringidos, un día que coincida con cualquiera de los dos coincidirá, como en cron estándar: `0 9 1 * 1` se ejecuta el primer día de cada mes y cada lunes. Cuando cualquiera de los campos comienza con `*`, un día tiene que coincidir con ambos.

Una programación se evalúa según la hora local (wall clock) de su zona horaria. A través de un cambio de horario de verano, eso significa que una tarea de hora fija dentro de la hora repetida (`30 2 * * *` donde los relojes se retrasan a las 03:00) se ejecuta en ambos pasos de esa hora, y una dentro de la hora omitida, cuando los relojes se adelantan, no se ejecuta ese día.

## CronJobDefinition Reference

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

Cada manejador recibe un `CronJobContext` que contiene métodos de utilidad y la instancia del cliente de Rebase:

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

Usa `ctx.log()` para emitir salida estructurada. Estas líneas se capturan en el registro de ejecución y son visibles en Studio y a través de la API REST. Cada línea también se escribe en el registro del servidor con nivel `info` con un campo `cron` que contiene el ID de la tarea, por lo que aparece dondequiera que se recopile la salida de tu contenedor, incluidos los registros de depuración de Rebase Cloud. Esa copia se redacta (oculta información sensible) de la misma forma que las líneas de registro del propio servidor: los valores de claves como `password` o `apiKey`, y el SQL y los parámetros de una consulta fallida, se reemplazan. El registro de ejecución almacena la línea sin esa redacción.

El registro de ejecución conserva las primeras 500 líneas de una ejecución o 64 KB de ellas, lo que ocurra primero, y luego una línea indicando cuántas más hubo: `… 9500 more lines not kept — see the server log`. El registro del servidor recibe todas las líneas. Una tarea que registra una línea por cada elemento que procesa debe esperar que su historial muestre el inicio de la ejecución.

### `ctx.signal` — detener el trabajo cuando la ejecución finaliza

El tiempo de espera (timeout) finaliza la *ejecución*: el programador deja de esperar y registra un fallo.
No finaliza el manejador. Pasa `ctx.signal` a cualquier cosa que acepte una señal, y
el trabajo se detendrá con ella:

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

Sin ella, una tarea cuyo tiempo de espera coincide con su intervalo filtra una petición abandonada
por tick — invisible, porque cada ejecución ya se registra como fallida.

:::note[`ctx.client` fue eliminado]
Era un segundo nombre para `ctx.rebase`, y su tipo volvía a exponer `client.data` —
el alias que `RebaseServerClient` omite deliberadamente para que el plano privilegiado
tenga exactamente un único nombre. Un lector que aprendía `client.data` aquí lo trasladaba a un
hook de tabla, donde `context.data` es el plano con *ámbito de usuario*: misma
escritura, privilegio opuesto. Usa `ctx.rebase.dataAsAdmin`.
:::

### Interacción con la base de datos y servicios mediante `ctx.rebase`

`ctx.rebase.dataAsAdmin` es el plano de datos con ámbito de administrador. Una tarea cron no
tiene un usuario por solicitud, por lo que no hay una alternativa con ámbito de usuario aquí: define tú
mismo los filtros de cada consulta.

:::caution[El ámbito de administrador no elude RLS]
`dataAsAdmin` tiene un ámbito asignado una vez, en el arranque, como `{ uid: "service", roles: ["admin"] }`.
Cada lectura y escritura aún se ejecuta en una transacción que ha ejecutado `SET LOCAL ROLE
rebase_user` con `app.uid = 'service'`, y **tus políticas se evalúan** —
contra esa identidad. Supera las políticas predeterminadas integradas a través de su
rama `rolesOverlap(['admin'])`, por lo que la diferencia rara vez se nota. Se
nota cuando escribes las tuyas propias: `policy.serverContext()` se compila en
`rebase.uid() IS NULL` y, por lo tanto, es **false** aquí, por lo que una tabla con
`disableDefaultPolicies: true` cuya única regla sea `serverContext()` denegará estas
escrituras y devolverá cero filas — HTTP 200, vacío — para estas lecturas.

`rebase.sql()` *sí* es una omisión incondicional: conexión de propietario, sin políticas.
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
El manejador puede devolver cualquier valor serializable en JSON. Se almacenará en la entrada de registro como `result` y se mostrará en el historial de ejecución de Studio.
:::

## API REST

El listado, activación, pausa y reanudación de tareas a través de HTTP, y el `client.cron` del SDK tipado, se encuentran en [API de tareas cron](/docs/backend/cron-jobs-api/).

## Panel de control de Studio

Cuando las tareas cron están configuradas, aparece una herramienta de **Cron Jobs** en Rebase Studio bajo **Compute**, junto a la consola de JS. El panel proporciona:

- **Lista de tareas** — Todas las tareas registradas con indicadores de estado en tiempo real
- **Panel de detalles** — Programación, próxima/última ejecución, duración e información de errores
- **Historial de ejecuciones** — Entradas de registro desplegables con salida capturada y resultados
- **Activación manual** — Ejecuta cualquier tarea bajo demanda con un solo clic. El panel espera a que termine la ejecución e informa cómo fue: una ejecución fallida muestra su error
- **Habilitar/deshabilitar** — Pausa y reanuda tareas sin reiniciar el servidor, para todos los procesos a la vez; una pausa se mantiene a través de reinicios y despliegues
- **Tareas ausentes** — cada tarea que el programador rechazó, con su programación y la razón, y cuántos archivos cron no se pudieron cargar. Ninguno de ellos está programado; consulta [Tareas ausentes](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

El panel se actualiza automáticamente cada 15 segundos.

El panel muestra lo mismo independientemente del proceso que lo sirva. Una tarea que otro proceso esté ejecutando se muestra como en ejecución.
En cada proceso que tiene un almacén (store), el conteo de ejecuciones, el conteo de fallos y la última ejecución se leen desde la base de datos, donde se cuentan las ejecuciones de cada proceso. Los propios contadores de un proceso solo guardan las ejecuciones que él mismo realizó: el rol `api` junto a un worker no ejecuta nada, y de dos réplicas que programan tareas, ninguna ve los slots que la otra reclamó. Solo cuando la base de datos no se puede leer, la tarjeta recurre a los contadores propios de este proceso, con una advertencia en el registro del servidor.

Los conteos son históricos totales (all-time); el historial cubre los últimos 30 días. La fila de cada ejecución en `rebase.cron_logs` se elimina 30 días después de haber comenzado mediante una limpieza horaria, mientras que los contadores de ejecuciones y fallos la siguen contabilizando. Una ejecución omitida cuenta como una ejecución, como siempre lo ha hecho: es una fila del historial.

## Validación de programación y análisis AST

Durante la inicialización del backend, Rebase analiza todas las programaciones cron registradas utilizando un expansor cron basado en JS y sin dependencias:
- **Comprobación de sintaxis**: Verifica que la cadena contenga exactamente 5 campos separados por espacios en blanco (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Expansión de rangos**: Descompone pasos (`*/15`), rangos (`9-17`) y listas separadas por comas (`0,30`) en arrays explícitos de enteros válidos asignados a sus límites respectivos (por ejemplo, minutos `0-59`, horas `0-23`, meses `1-12`).
- **Tokens completos**: Cada número, límite de rango y paso debe ser un número entero: `5abc`, `*/5x` y `1.5` son rechazados, al igual que un rango invertido (`5-1`).
- Si alguna expresión cron falla la validación, Rebase rechaza la definición, registra un error de inicio y se niega a registrar la tarea para evitar fallos de ejecución en tiempo de ejecución.

---

## Bajo el capó: Corrección de desviación del reloj (Clock-Drift)

Los programadores estándar basados en intervalos (como `setInterval`) sufren desviaciones con el tiempo y causan picos significativos de CPU debido a los retrasos de programación del event loop a nivel del sistema operativo. Para garantizar la precisión en la ejecución, Rebase implementa un **bucle de cálculo dinámico del tiempo objetivo**:
1. **Cálculo de candidatos**: Al completar una tarea o iniciar el programador, Rebase calcula la marca de tiempo exacta del *siguiente* minuto candidato que coincida.
2. **Espera dinámica (Dynamic Sleep)**: Calcula la diferencia en milisegundos (`nextRun.getTime() - now.getTime()`) y programa un único `setTimeout`.
3. **Umbral de seguridad contra desviaciones**: Se aplica un búfer de espera mínimo (`MIN_SCHEDULE_INTERVAL_MS`) de **5.000 ms**. Si un ciclo del programador finaliza con extrema rapidez, este umbral evita una doble ejecución casi instantánea.
4. **Facilidad de apagado (Shutdown Friendliness)**: Los identificadores de temporizador se desvinculan explícitamente del event loop de Node.js mediante `timer.unref()`, lo que garantiza que los programadores cron en segundo plano no bloqueen las terminaciones limpias del proceso durante los despliegues.

---

## Más de un proceso

Cada proceso cuyo programador está activo arma los mismos temporizadores; la base de datos decide
cuál de ellos ejecuta cada slot. Cómo se ejecuta un slot una sola vez, cómo se recupera un slot
que un reinicio descartó, cómo llega una pausa a cada réplica y por qué una activación manual nunca
se ejecuta junto a una ejecución programada se explican en [Cron en múltiples instancias](/docs/backend/cron-across-instances).

---

## Tiempos de espera y aislamiento de errores

- **Competición de tiempo de espera forzado (Forced Timeout Race)**: Los bloques de ejecución se envuelven en un `Promise.race` frente a un temporizador de límite derivado de `timeoutSeconds` (predeterminado: `300` segundos / 5 minutos; `Infinity` para ninguno). Si el manejador se bloquea más allá de este umbral, `ctx.signal` se cancela (abort) y la promesa se rechaza, arrojando:
  `Error: Cron job "<id>" timed out after <N>ms`
  La cancelación es la parte que detiene el *trabajo*; el rechazo solo hace que el programador deje de esperar. Un manejador que ignore `ctx.signal` continúa ejecutándose más allá de su propia ejecución.
- **Apagado (Shutdown)**: `backend.shutdown()` espera a que finalice una ejecución en curso, dentro del mismo margen que la cola de trabajos (dos tercios del tiempo de espera de apagado). Una ejecución que continúe cuando se agote el tiempo tendrá `ctx.signal` cancelado y se registrará como fallida, junto con el motivo. Su slot permanece reclamado, por lo que ninguna otra instancia lo volverá a ejecutar.
- **Try/Catch a prueba de fallos**: Cada manejador de tareas se ejecuta dentro de un contenedor aislado. Cualquier excepción no capturada es interceptada, registrando el mensaje del error (redactado/censurado) como una cadena, estableciendo el estado de la tarea en `"error"` y actualizando el contador de fallos de la tarea. Un fallo dentro de una sola tarea cron nunca provocará la caída del bucle del programador ni del servidor web HTTP principal de Hono.
- **Búfer circular en memoria**: El programador mantiene un búfer circular que contiene las últimas **50 ejecuciones** por tarea. Este búfer se mantiene en memoria para permitir lecturas casi instantáneas desde Rebase Studio.

---

## Esquema de persistencia en base de datos

Cuando los adaptadores de base de datos que soportan SQL (por ejemplo, PostgreSQL) están activos, Rebase aprovisiona la tabla `rebase.cron_logs`:

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

Cada una se crea al arrancar si no existe, por lo que una base de datos anterior a su introducción la obtiene en su siguiente despliegue. Ninguna de ellas es una tabla declarada, y el rol de usuario final `rebase_user` no tiene privilegios sobre ninguna de ellas: un `cron_job_state` con permisos de escritura permitiría a un usuario autenticado pausar una tarea para todos, o retener su concesión (lease) para que nada la ejecute.

La fila de una ejecución y su conteo se escriben en una sola sentencia: la inserción en `cron_logs` y un upsert de los contadores de la tarea en `cron_job_state`. Un listado lee una fila de `cron_job_state` por tarea, sin importar cuán extenso sea el historial, y lo mismo hace el programador cuando inicializa `totalRuns` y `totalFailures` al inicio. Las escrituras de registros no retrasan la ejecución; si una falla, el programador registra el error y continúa, manteniendo la ejecución en el búfer circular en memoria.

Una vez por hora, y al iniciarse, el programador elimina las filas del historial con más de 30 días de antigüedad y cuenta cualquier ejecución que aún no esté contabilizada, ambos en lotes de 5.000 filas. Un historial escrito antes de la versión 0.24 es contabilizado por la primera de estas limpiezas, fuera de la ruta crítica de arranque. Hasta que haya finalizado, un listado añade a los contadores las ejecuciones que aún no han sido contabilizadas, de modo que los números no cambien tras la actualización. Lo mismo aplica a una ejecución que un servidor más antiguo registre durante un despliegue gradual (rolling deploy).

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

## Tareas cron en el grafo de recursos

Cada archivo cron es también una declaración. `rebase resources` lo lista bajo el
nombre del archivo — el mismo ID con el que el programador lo ejecuta y el que muestra Studio —
con su programación y zona horaria, de modo que un host pueda leer las programaciones de un proyecto
antes de ejecutar nada. Un cron no se vincula a ninguna variable de entorno; `rebase status`
lo muestra en verde sin nada que configurar.

Leer la programación implica importar el archivo, y `rebase resources` es un paso de compilación (build step): sin `.env`, sin secretos. Por lo tanto, mantén el **ámbito de módulo** de una tarea cron libre de cualquier cosa que lea configuraciones durante la importación: un cliente de base de datos instanciado en la parte superior de un helper, o un `env.ts` que valide `DATABASE_URL`. En su lugar, importa ese trabajo dentro del manejador:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

El manejador se ejecuta en el despliegue, donde esas variables existen. Una importación
en el nivel superior del mismo módulo hace que el grafo solo se pueda derivar en una máquina
que disponga de un `.env`, además de cargar toda la dependencia en cada arranque
que simplemente registre la tarea.

Cargar un cron no declara nada. Si deseas incluir tareas cron en el grafo mediante un paso de compilación propio, especifícalo con `declareCrons`:

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Próximos pasos

- **[Visión general del backend](/docs/backend)** — Referencia completa de configuración del backend
- **[Hooks de tablas](/docs/collections/callbacks)** — Ejecuta lógica ante cambios en los datos
- **[Integración de Webhooks](/docs/recipes/webhooks)** — Envía notificaciones ante eventos
- **[Cron en múltiples instancias](/docs/backend/cron-across-instances)** — Una ejecución por slot, slots perdidos, pausar en todas partes y ejecuciones superpuestas
