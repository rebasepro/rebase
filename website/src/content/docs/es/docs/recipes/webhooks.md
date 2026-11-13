---
sourceHash: 517637e2cfd34608
title: "Receta: Integración de webhooks"
sidebar_label: Webhooks
description: Usa hooks de tabla para enviar webhooks a servicios externos cuando cambien los datos, sin mantener abierta la transacción de escritura.
---

## Descripción general

Usa los [hooks de tabla](/docs/collections/callbacks/) `afterSave` y `afterDelete` para notificar a servicios externos cuando los datos cambien en Rebase.

Dos aspectos sobre estos hooks determinan cómo está planteada esta receta, y ninguno es opcional:

- **Se ejecutan dentro de la transacción de base de datos de la escritura.** Cualquier cosa a la que le apliques `await` allí retiene una conexión del pool y los bloqueos de la fila hasta que responda. Un receptor que tarda diez segundos representa una transacción de diez segundos; un receptor que nunca responde es una transacción que nunca termina.
- **Un error lanzado (throw) desde `afterSave` revierte la escritura.** El error llega al llamador como un 500 y la fila no se guarda. Esperar a un servicio externo dentro del hook convierte la caída de dicho servicio en tu propia pérdida de datos.

Por lo tanto: nunca uses `await` con una petición HTTP saliente en un hook. Ponla en cola.

## Notificación de Slack en un nuevo pedido

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`WebhookDispatcher` se exporta desde `@rebasepro/server`. `enqueueEntityChange` retorna inmediatamente —el POST se realiza una vez que la escritura se confirma (commit), nunca para una que se revierte— y el dispatcher valida el destino, firma el payload, limita cada intento con un tiempo límite y reintenta los fallos.

Proporciónale la cola de trabajos (job queue) del backend y cada entrega se convertirá en una fila en `rebase.jobs`: sobrevive a un despliegue o a una caída, se reintenta con backoff por el worker de cualquier instancia que lo reclame, y un receptor que esté caído durante un día cuesta filas, no memoria. Activa la cola con `jobs: { enabled: true }` en `initializeRebaseBackend`, y conecta el dispatcher una vez que haya retornado:

```typescript
import {
    WebhookDispatcher,
    WEBHOOK_DELIVERY_TASK,
    type QueuedWebhookDelivery,
    type RebaseBackendInstance
} from "@rebasepro/server";

// Call once, with what `initializeRebaseBackend({ …, jobs: { enabled: true } })` returned.
export function sendOrderWebhooks(backend: RebaseBackendInstance): void {
    const dispatcher = new WebhookDispatcher({
        // Each delivery is a job: kept across deploys, retried by the queue.
        jobQueue: backend.jobQueue,
        // Queued deliveries return nothing to the caller, so this is where their
        // failures surface. Without it, a receiver that has been down for a week
        // looks exactly like one that is working.
        onDelivery: (result) => {
            if (!result.success) {
                console.error(`Webhook ${result.webhookId} failed: ${result.statusCode} ${result.responseBody}`);
            }
        }
    });

    dispatcher.setWebhooks([
        {
            id: "wh_orders_slack",
            url: process.env.SLACK_WEBHOOK_URL!,
            secret: process.env.WEBHOOK_SECRET,
            events: ["INSERT"],
            table: "orders",
            enabled: true
        }
    ]);

    // The worker side: one attempt per job, and the queue's retries. Passing
    // `ctx` lets each attempt send its real `X-Webhook-Attempt`.
    backend.jobQueue?.register<QueuedWebhookDelivery>(WEBHOOK_DELIVERY_TASK, (ctx) => dispatcher.deliverQueuedJob(ctx.payload, ctx));

    backend.setTableHooks("orders", {
        afterSave: async ({ values, id, status }) => {
            if (status === "new") {
                // Returns void, immediately. The job is written after the
                // write commits, so the transaction is not waiting on it.
                dispatcher.enqueueEntityChange("orders", "INSERT", String(id), values);
            }
        }
    });
}
```

Solo el id del webhook se almacena en el trabajo, por lo que su secreto de firma nunca se guarda en `rebase.jobs`. Un destino que el dispatcher rechace, o un receptor que responda con una redirección, se envía a dead-letter tras un intento junto con el motivo; cualquier otra cosa se reintenta como cualquier trabajo. Consulta [Webhooks duraderos](/docs/backend/jobs#durable-webhooks).

`setTableHooks` **reemplaza** los hooks que declara la tabla `orders`. Si declara alguno, consérvalos: pasa `composeTableHooks(declared, { afterSave })`, con `composeTableHooks` de `@rebasepro/common` y `declared` como los propios `hooks` de la tabla (`orders.config.hooks`). Consulta [Combinar conjuntos de hooks](/docs/collections/callbacks/#combining-hook-sets).

### Sin una cola de trabajos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Omite `jobQueue` —o ejecuta la aplicación donde el backend no tenga cola de trabajos— y las entregas se pondrán en cola en memoria, dentro del proceso que realizó el cambio. Esto es más sencillo y resulta suficiente para notificaciones que te puedas permitir perder:

```typescript
import { WebhookDispatcher, type RebaseBackendInstance } from "@rebasepro/server";

// Server-only, like the version above: call it with what `initializeRebaseBackend` returned.
export function sendOrderWebhooks(backend: RebaseBackendInstance): void {
    const dispatcher = new WebhookDispatcher({
        onDelivery: (result) => {
            if (!result.success) {
                console.error(`Webhook ${result.webhookId} failed: ${result.statusCode} ${result.responseBody}`);
            }
        }
    });

    dispatcher.setWebhooks([
        {
            id: "wh_orders_slack",
            url: process.env.SLACK_WEBHOOK_URL!,
            secret: process.env.WEBHOOK_SECRET,
            events: ["INSERT"],
            table: "orders",
            enabled: true
        }
    ]);

    backend.setTableHooks("orders", {
        afterSave: async ({ values, id, status }) => {
            if (status === "new") {
                dispatcher.enqueueEntityChange("orders", "INSERT", String(id), values);
            }
        }
    });
}
```

Mantén el dispatcher fuera del propio archivo de la tabla. `backend/schema` es cargado por cada comando que lee el esquema —`rebase db push`, `generate-sdk`, `doctor`— y un dispatcher inicializado en la parte superior del archivo se crearía en cada uno de ellos. Conéctalo donde se crea el backend, como se indicó anteriormente.

Una caída o un despliegue entre la confirmación y la entrega descartará el evento. Cada webhook tiene su propia cola, por lo que un receptor que esté caído solo retrasará sus propias entregas, nunca las de otro webhook. La cola de cada webhook almacena un máximo de 10.000 entregas en espera; mientras esté llena, cualquier entrega nueva será rechazada y reportada a `onDelivery` con `success: false`, `statusCode: 0`, `attemptNumber: 0` y `responseBody: "queue full"`, notificándolo una vez en el log del servidor. Llama a `await dispatcher.flush(10_000)` durante el apagado: esperará a lo que esté en cola y devolverá `false` si el tiempo límite se agota antes, ya que un receptor caído puede demorar cada una de sus entregas hasta ~36 segundos de reintentos.

### Qué recibe el receptor

Cada entrega es una petición `POST` con un cuerpo JSON y estas cabeceras:

| Cabecera | Valor |
| --- | --- |
| `X-Webhook-Id` | El `id` del webhook |
| `X-Webhook-Event` | `INSERT`, `UPDATE` o `DELETE` |
| `X-Webhook-Delivery` | Un id por entrega, el mismo en cada intento de esta |
| `X-Webhook-Attempt` | Qué número de intento es este, comenzando en `1` |
| `X-Webhook-Signature` | `sha256=` y el HMAC-SHA256 en hexadecimal del cuerpo sin procesar (raw body), firmado con el `secret` del webhook (solo si tiene uno) |

Las entregas son al menos una vez (at-least-once): un receptor que responda con demasiada lentitud, o un worker que se detenga tras el `POST`, provocará que la misma entrega llegue de nuevo. Deduplica usando `X-Webhook-Delivery`, y valida la firma sobre el cuerpo exactamente tal como llegó, antes de parsearlo:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function isSignedByRebase(rawBody: string, header: string | null, secret: string): boolean {
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
    const received = Buffer.from(header ?? "");
    return received.length === expected.length && timingSafeEqual(received, expected);
}
```

### Llamar a un endpoint directamente

Si vas a enviar un cuerpo creado manualmente a un único endpoint y no deseas utilizar el dispatcher, se siguen aplicando las mismas dos reglas: delimita el tiempo de la petición y nunca permitas que un fallo alcance al llamador:

```typescript
import type { TableHooks } from "@rebasepro/server/schema";

type Order = { customer_name: string; total: number };

const hooks: TableHooks<Order> = {
    afterSave: async ({ values, id, status }) => {
        if (status !== "new") return;
        // No `await`: the transaction must not wait for Slack. `AbortSignal.timeout`
        // because `fetch` has no default timeout at all — without it a black-holed
        // connection holds the transaction until the OS gives up, minutes later.
        void fetch(process.env.SLACK_WEBHOOK_URL!, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text: `New order #${id}\nCustomer: ${values.customer_name}\nTotal: $${values.total}`
            }),
            signal: AbortSignal.timeout(10_000)
        }).catch((error) => {
            // Swallowed on purpose. A throw here would be an unhandled rejection;
            // a throw *inside* the hook would roll the order back.
            console.error("Slack notification failed", error);
        });
    }
};
```

Nunca pases una URL que provenga de tu base de datos a un `fetch` sin protección. El dispatcher rechaza destinos de tipo loopback, link-local, privados y no pertenecientes a `http(s)` antes de conectarse, y se niega a seguir redirecciones, precisamente porque una URL almacenada constituye una entrada controlada por un atacante. En Node, valida la dirección a la que realmente se realiza cada conexión dentro de la propia resolución DNS de la conexión, de modo que un nombre cuyo registro cambie entre la comprobación y la conexión no pueda eludir la seguridad; el nombre del receptor se resuelve una vez por conexión, no una vez por entrega.

## Sincronización con una API externa

`afterDelete` recibe la fila eliminada de forma plana como `values`: las columnas de la tabla, no un wrapper de entidad.

```typescript
import type { TableHooks } from "@rebasepro/server/schema";

type Product = { name: string; description: string; price: number; shopify_id: string };

const syncQueue: Promise<unknown>[] = [];

const hooks: TableHooks<Product> = {
    afterSave: async ({ values, id }) => {
        // Queued, not awaited: Shopify being down must not fail the save.
        syncQueue.push(
            fetch("https://your-shop.myshopify.com/admin/api/2024-01/products.json", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN!
                },
                body: JSON.stringify({
                    product: {
                        id: values.shopify_id,
                        title: values.name,
                        body_html: values.description,
                        variants: [{ price: values.price }]
                    }
                }),
                signal: AbortSignal.timeout(10_000)
            }).catch((error) => console.error(`Shopify sync failed for ${id}`, error))
        );
    },

    afterDelete: async ({ values }) => {
        const shopifyId = values.shopify_id;
        if (!shopifyId) return;
        syncQueue.push(
            fetch(
                `https://your-shop.myshopify.com/admin/api/2024-01/products/${shopifyId}.json`,
                {
                    method: "DELETE",
                    headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN! },
                    signal: AbortSignal.timeout(10_000)
                }
            ).catch((error) => console.error(`Shopify delete failed for ${shopifyId}`, error))
        );
    }
};
```

## Manejo de errores

`afterSaveError` se ejecuta cuando el guardado —o cualquier hook `afterSave`— lanza un error. Es un hook de notificación, no de rescate: la transacción se revierte, la fila no se guarda y **el error se vuelve a lanzar después de que finalice su ejecución**. En una petición se ejecuta una vez completado el rollback, fuera de la transacción fallida, por lo que una entrega remitida a la cola del dispatcher se conserva en lugar de revertirse con la escritura.

```typescript
import type { TableHooks } from "@rebasepro/server/schema";

const hooks: TableHooks = {
    afterSave: async ({ values }) => {
        // If this throws, the write is rolled back. That is the right behaviour
        // for a validation or an invariant, and the wrong one for a notification.
        await recordAuditEntry(values);
    },
    afterSaveError: async ({ id, values }) => {
        // Runs, and then the error is rethrown. Use it to alert, not to recover.
        console.error(`Save failed for row ${id}`, values);
    }
};
```

Si un fallo *no* debería costarle la escritura al usuario, no debe propagarse fuera de `afterSave`: captúralo allí o transfiere la tarea a la cola del dispatcher.

## Próximos pasos

- **[Hooks de tabla](/docs/collections/callbacks)** — Referencia completa de hooks
- **[Receta de CMS para blog](/docs/recipes/blog-cms)** — Ejemplo completo de blog
