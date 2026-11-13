---
sourceHash: 9e21b0515cf58869
title: Trabajos en segundo plano
sidebar_label: Trabajos en segundo plano
description: Una cola de trabajos duradera respaldada por Postgres — trabajo que sobrevive a un reinicio, se reintenta con backoff y conserva los fallos en lugar de descartarlos.
---

## Visión general

Un trabajo es una fila en `rebase.jobs`. Es reclamado por exactamente un worker,
reintentado con un retraso creciente si su handler lanza un error, y se mantiene en
la tabla cuando finalmente desiste para que alguien pueda inspeccionarlo.

No hay nada que instalar ni nada que ejecutar junto a Postgres. Un trabajo
encolado dentro de una transacción que se revierte (rollback) nunca llegó a encolarse.

Utilízalo para tareas que no deban perderse y no deban ocurrir dentro de una petición:
enviar correos, llamar a servicios de terceros, generar un archivo, sincronizar con un
sistema externo.

| | Ejecución | Sobrevive a un reinicio |
|---|---|---|
| [Cron](/docs/backend/cron-jobs) | Según una programación | Sí — la programación está en el código |
| **Jobs** | Una vez, tan pronto como un worker esté libre | **Sí — el trabajo es una fila** |
| Un `setTimeout` en un callback | Una vez, en este proceso | No |

## Habilitación

:::note[Dónde va esto]
**Runtime gestionado** — en ningún lugar. `jobs` recibe *funciones* handler, que
ninguna variable de entorno ni exportación de `backend/storage.ts` o `backend/hooks.ts` puede contener,
por lo que un proyecto generado no puede habilitar la cola. Ejecuta `rebase eject` (o escribe un
[servidor personalizado](/docs/backend/custom-server/)) para acceder a ella. `REBASE_JOB_WORKERS`
en `.env` solo decide si los workers de una cola ya habilitada se ejecutan en *este*
proceso.

**Ejected** — el bloque `jobs` en `initializeRebaseBackend({ … })`, como se muestra a continuación.

El mapa completo se encuentra en [Visión general del backend](/docs/backend/#where-each-option-lives).
:::

```typescript no-verify
await initializeRebaseBackend({
    jobs: {
        enabled: true,
        tasks: {
            "send-welcome": async ({ payload }) => {
                await sendEmail((payload as { email: string }).email);
            }
        }
    }
});
```

Desactivado a menos que lo solicites: un worker continúa buscando trabajo mientras el
proceso esté activo, lo cual no es un comportamiento predeterminado que nadie haya elegido. Requiere un driver que
pueda ejecutar SQL; en uno que no pueda, la cola no estará disponible y se te notificará
al arrancar en lugar de al realizar el primer encolado.

Un worker inactivo no realiza sondeos (polling) cada dos segundos. Cada encolado envía un
`NOTIFY` en el canal `rebase_jobs` cuando se confirma la transacción (commit), y un worker que mantenga un
`LISTEN` sobre él lo reclama de inmediato: un trabajo encolado por otro proceso (el rol `api`,
otra réplica) comienza en cuestión de milisegundos, y uno diferido, cuando llegue su
vencimiento. Además de eso, comprueba cada 30 segundos de todos modos. Un trabajo que este proceso
encole, un reintento que haya programado y un trabajo que haya recuperado lo despiertan sin
necesidad de notificación.

El `LISTEN` necesita una conexión propia, encontrada del mismo modo en que realtime encuentra una:
`DATABASE_DIRECT_URL` si está configurada, o `DATABASE_URL` en caso contrario. Detrás de un pooler en modo transacción
como PgBouncer, configura `DATABASE_DIRECT_URL`: un pooler no mantiene un
`LISTEN`, y los trabajos de otros procesos tendrían que esperar a la comprobación de los 30 segundos.
Donde no exista dicha conexión en absoluto (la base de datos de desarrollo en el proceso),
un worker inactivo aplica backoff en su lugar: comprueba tras `pollIntervalMs` (2 segundos),
luego el doble de tiempo tras cada comprobación que no encuentre nada, hasta 30 segundos, y
vuelve a empezar cada vez que encuentra trabajo. Un worker inactivo realiza alrededor de 2.900 reclamaciones al
día en lugar de 43.200.

## Encolado

```typescript no-verify
const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true, tasks } });

await jobQueue?.enqueue("send-welcome", { email: "ada@example.com" });
```

### Opciones

```typescript no-verify
await jobQueue?.enqueue("send-digest", { userId: "u7" }, {
    delayMs: 60_000,               // not before a minute from now
    maxAttempts: 5,                // default 3
    idempotencyKey: "digest:u7"    // at most one *unfinished* job with this key
});
```

`idempotencyKey` unifica un doble clic, una petición reintentada y dos instancias
reaccionando al mismo evento en un único trabajo. Está delimitado al trabajo no finalizado,
por lo que la clave vuelve a ser reutilizable una vez que el trabajo se completa; de lo contrario, «el
resumen nocturno para el usuario 7» solo se podría enviar exactamente una vez en toda la historia. Un encolado
duplicado se resuelve como `null` en lugar de lanzar una excepción: el trabajo solicitado queda encolado,
que es el resultado esperado.

## Fallos

Un handler falla al lanzar una excepción. No existe `return false`; un booleano sería
ignorado silenciosamente por cualquier handler que olvidara devolverlo, y el fallo debe
ser el comportamiento por defecto.

- **Intentos restantes** → vuelve a `pending`, con `run_at` pospuesto por el backoff
  (1s, 5s, 25s… limitado a una hora; personalizable con `backoff`).
- **Sin intentos restantes** → `failed`, y la fila *permanece*. Una cola que descarta
  silenciosamente lo que no pudo procesar es indistinguible de una que no tiene nada
  que hacer.
- **Un fallo que ningún reintento puede solucionar** → lanza `PermanentJobError`, de
  `@rebasepro/server`: el trabajo pasa a `failed` en este intento, con el
  mensaje como su `last_error`, en lugar de consumir sus intentos restantes.

```sql
SELECT task, attempts, last_error, updated_at
FROM rebase.jobs WHERE status = 'failed'
ORDER BY updated_at DESC;
```

Las filas fallidas se conservan 30 días; las exitosas, 3. Cada worker elimina las
filas expiradas al iniciarse y luego cada hora, por lotes, fuera de la
ruta de las peticiones.

## Qué sucede cuando un worker muere

Un proceso terminado a mitad de un trabajo no puede liberar su reclamación, por lo que nada salvo un tiempo de espera (timeout)
liberará la fila. Mientras un handler se ejecuta, su worker renueva la reclamación cada tercio de
`visibilityTimeoutMs` (por defecto 5 minutos). Una reclamación que pase ese tiempo
sin renovarse es recuperada: vuelve a `pending` si el trabajo aún tiene intentos
restantes, o se envía a la cola de fallos definitivos (dead-letter) con un error indicando lo sucedido.

De este modo, un handler lento en un worker activo mantiene su trabajo, sin importar cuánto tarde, y el
timeout solo determina la rapidez con la que se recuperan los trabajos de un worker caído. Un intento que
haya perdido su reclamación tampoco puede sobrescribir el resultado del trabajo: su éxito o fallo
se registra en los logs y se descarta, y el intento que mantenga la reclamación es el que decide.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // the first wait after a look that found nothing; it doubles up to 30 s
    visibilityTimeoutMs: 300_000 // how long an unrenewed claim holds
}
```

### Un handler que nunca termina

La otra cara de la moneda: un handler esperando un `fetch` que nunca responde retiene su
ranura de worker, y su reclamación, mientras el proceso continúe en ejecución; con cinco de ellos, el
worker no ejecutará nada más, mientras que `/health` se mantendrá en verde.
`timeoutMs`
limita un intento. Al alcanzarse el límite, el intento falla —reintentándose mientras queden
intentos disponibles, como cualquier excepción—, su ranura se libera y el `signal` del handler se
aborta. Pasa la señal (signal) para que el trabajo también se detenga; un handler que la ignore
seguirá ejecutándose en segundo plano sin que nada registre su resultado.

Si se omite, es de 15 minutos (`900_000`), y el worker lo indicará en una línea de log
al iniciarse. Un trabajo que legítimamente requiera más tiempo puede definir su propio valor, y
`timeoutMs: 0` elimina el límite.

```typescript no-verify
jobs: {
    enabled: true,
    timeoutMs: 120_000,          // one attempt; 15 minutes when left out, 0 for no limit
    tasks: {
        "sync-crm": async ({ payload, signal }) => {
            await fetch(crmUrl, { method: "POST", body: JSON.stringify(payload), signal });
        }
    }
}
```

Los handlers de cola y las suscripciones a temas reciben el mismo `signal` en su contexto.

## Varias instancias

Seguro por diseño. Los workers reclaman con `SELECT … FOR UPDATE SKIP LOCKED`, de modo
que cada trabajo va exactamente a uno de ellos y los demás pasan a la siguiente fila
en lugar de encolarse detrás. No es necesario elegir ningún líder.

Una instancia reclama únicamente las tareas para las cuales tiene un handler. Durante un despliegue continuo (rolling deploy),
una instancia que ejecute código más antiguo ignora los trabajos cuyas tareas solo implementa
el código nuevo: permanecen en `pending`, con sus intentos intactos, hasta que un par
actualizado los reclame. Una tarea que ninguna instancia implemente también permanece en `pending`, en lugar
de enviarse a dead-letter.

## Escaneos de huérfanos de almacenamiento

`rebase storage orphans` se ejecuta en esta cola cuando está habilitada: cada escaneo, y cada
eliminación derivada de un escaneo, es un trabajo de `storage.orphans`, con un solo intento. El backend
registra el handler automáticamente, en cada proceso con almacenamiento configurado, y
solo los procesos cuyos workers de trabajos estén activos lo ejecutan. Un escaneo está limitado por
`timeoutMs` como cualquier trabajo, por lo que un origen demasiado grande para escanearse en 15 minutos necesita un
`timeoutMs` mayor, o 0. Sin la cola, el servidor ejecuta el escaneo dentro de
su propio proceso. Consulta [la CLI](/docs/cli/#rebase-storage).

## Webhooks duraderos

[`WebhookDispatcher`](/docs/recipes/webhooks) encola sus entregas en memoria por
defecto, lo que significa que una caída o un despliegue entre el cambio y la entrega
descarta el evento. Conéctalo a la cola y cada entrega se convertirá en una fila:

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never, ctx));
```

Solo el **id** del webhook se almacena en el trabajo, nunca el webhook en sí; de lo
contrario, su secreto de firma residiría en `rebase.jobs` en texto no cifrado durante el tiempo que
la retención conserve la fila, y un webhook editado entre el encolado y la
entrega debe procesarse con su estado actual. Al pasar `ctx` como segundo argumento,
cada intento envía su propio `X-Webhook-Attempt`; todos los intentos de una misma entrega envían
el mismo `X-Webhook-Delivery`, lo que permite al receptor deduplicar los reintentos.

Una entrega que el despachador rechace enviar (un destino loopback, link-local, privado o
no `http(s)`), o una a la que el receptor responda con una redirección, falla de la
misma manera siempre. Se envía a dead-letter tras un intento, con el motivo
en `last_error`. Cualquier otro fallo se reintenta como cualquier otro trabajo.

## Apagado

`shutdown()` detiene al worker para que no reclame nuevos trabajos y espera a los que están
en curso, de modo que un despliegue no ejecute dos veces el final de un lote. La espera está limitada
a dos tercios del tiempo de espera de apagado (10 segundos del valor predeterminado de 15), por lo que un
handler que nunca finalice no podrá bloquear el apagado. Un trabajo que continúe ejecutándose después de
eso conserva su reclamación y es recuperado por el tiempo de espera de visibilidad.

## Próximos pasos

- **[Cron Jobs](/docs/backend/cron-jobs)** — tareas según una programación
- **[Webhooks](/docs/recipes/webhooks)** — notificar a otros sistemas ante un cambio
