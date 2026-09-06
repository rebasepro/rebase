---
sourceHash: 9dc4adc1ff3c773b
title: Trabajos en segundo plano
sidebar_label: Trabajos en segundo plano
description: Una cola de trabajos duradera respaldada por Postgres — trabajo que sobrevive a un reinicio, reintentado con retroceso, donde los fallos se conservan en lugar de descartarse.
---

## Descripción general

Un trabajo es una fila en `rebase.jobs`. Es reclamado exactamente por un worker, reintentado con un retraso creciente si su handler lanza un error, y se mantiene en la tabla cuando finalmente se rinde para que alguien pueda revisarlo.

No hay nada que instalar ni nada que ejecutar junto a Postgres. Un trabajo encolado dentro de una transacción que hace rollback nunca fue encolado.

Úselo para trabajo que no debe perderse y no debe ocurrir dentro de una solicitud: enviar correos, llamar a servicios de terceros, generar un archivo, conciliar con un sistema externo.

| | Se ejecuta | Sobrevive a un reinicio |
|---|---|---|
| [Cron](/docs/backend/cron-jobs) | Según una programación | Sí — la programación está en el código |
| **Trabajos** | Una vez, tan pronto como un worker esté libre | **Sí — el trabajo es una fila** |
| Un `setTimeout` en un callback | Una vez, en este proceso | No |

## Habilitación

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

Desactivado a menos que lo solicite: un worker sondea la base de datos continuamente, lo cual no es un valor predeterminado que cualquiera elegiría. Necesita un controlador capaz de ejecutar SQL; en uno que no puede (MongoDB), la cola no está disponible y se le informa al arrancar en lugar de al realizar el primer encolado.

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

`idempotencyKey` unifica un doble clic, una solicitud reintentada y dos instancias que reaccionan al mismo evento en un solo trabajo. Está delimitado al trabajo no finalizado, por lo que la clave vuelve a ser reutilizable una vez que el trabajo se completa; de lo contrario, "el resumen nocturno para el usuario 7" solo se podría enviar exactamente una vez en la historia. Un encolado duplicado se resuelve como `null` en lugar de lanzar un error: el trabajo solicitado ya está en cola, que es el resultado deseado.

## Fallos

Un handler falla al lanzar una excepción (throw). No existe un `return false`: un booleano sería ignorado silenciosamente por cualquier handler que olvidara retornar uno, y el fallo debe ser lo que se obtenga por defecto.

- **Intentos restantes** → vuelve a `pending`, con `run_at` pospuesto por el retroceso (1s, 5s, 25s … con un límite de una hora; modifíquelo con `backoff`).
- **Sin intentos restantes** → `failed`, y la fila *permanece*. Una cola que descarta silenciosamente lo que no pudo entregar es indistinguible de una que no tiene nada que hacer.

```sql
SELECT task, attempts, last_error, updated_at
FROM rebase.jobs WHERE status = 'failed'
ORDER BY updated_at DESC;
```

Las filas fallidas se conservan 30 días; las exitosas, 3.

## Qué sucede cuando un worker muere

Un proceso terminado a mitad de un trabajo no puede liberar su bloqueo, por lo que solo un tiempo de espera (timeout) liberará la fila. Los trabajos reclamados durante más tiempo que `visibilityTimeoutMs` (por defecto 5 minutos) se vuelven a reclamar: vuelven a `pending` si les quedan intentos; de lo contrario, se envían a la cola de fallidos (dead-letter) con un error que explica lo sucedido.

Esta es también la razón por la cual el tiempo de espera debe superar a su handler más lento: pasado este límite, un segundo worker podría iniciar un trabajo que el primero todavía está ejecutando.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // when the last look found nothing
    visibilityTimeoutMs: 300_000 // must exceed the slowest handler
}
```

## Varias instancias

Seguro por diseño. Los workers reclaman con `SELECT … FOR UPDATE SKIP LOCKED`, por lo que cada trabajo va a exactamente uno de ellos y los demás pasan a la siguiente fila en lugar de hacer cola detrás de ella. No es necesario elegir ningún líder.

Durante un despliegue progresivo (rolling deploy), a una instancia que ejecuta código más antiguo se le asignarán trabajos cuya tarea no implementa. Estos se devuelven a la cola en lugar de marcarse como fallidos, de modo que se ejecuten tan pronto como un par actualizado los recoja.

## Webhooks duraderos

[`WebhookDispatcher`](/docs/recipes/webhooks) encola sus entregas en memoria por defecto, lo que significa que una caída o un despliegue entre el cambio y la entrega descarta el evento. Proporciónele la cola y cada entrega se convertirá en una fila:

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never));
```

Solo el **id** del webhook se almacena en el trabajo, nunca el webhook en sí; de lo contrario, su secreto de firma permanecería en texto plano en `rebase.jobs` durante todo el tiempo que la retención conserve la fila, y un webhook editado entre el encolado y la entrega debe enviarse con su estado actual.

## Apagado

`shutdown()` detiene al worker para que no reclame nuevos trabajos y espera a los que están en curso, de modo que un despliegue no ejecute dos veces el final de un lote. Cualquier cosa que siga ejecutándose cuando el proceso finalice conserva su reclamo y se recupera mediante el tiempo de espera de visibilidad.

## Próximos pasos

- **[Trabajos Cron](/docs/backend/cron-jobs)** — trabajo según una programación
- **[Webhooks](/docs/recipes/webhooks)** — notificar a otros sistemas ante un cambio

---
