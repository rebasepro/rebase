---
sourceHash: ead814d8414e0434
title: "Receta: Integración de Webhooks"
sidebar_label: Webhooks
description: Utiliza las devoluciones de llamada de la entidad para enviar webhooks a servicios externos cuando los datos cambien, sin mantener abierta la transacción de la escritura.
---

## Descripción general

Utiliza las devoluciones de llamada `afterSave` y `afterDelete` para notificar a servicios externos cuando los datos cambien en Rebase.

Dos características de esas devoluciones de llamada determinan cómo está escrita esta receta, y ninguna es opcional:

- **Se ejecutan dentro de la transacción de la escritura.** Todo lo que esperes con `await` ahí
  retiene una conexión del pool y los bloqueos de la fila hasta que vuelva. Un receptor que tarda
  diez segundos es una transacción de diez segundos; un receptor que nunca responde es una
  transacción que nunca termina.
- **Una excepción lanzada desde `afterSave` deshace la escritura.** El error llega al llamante como
  un 500 y la fila no se guarda. Esperar a un tercero dentro de la devolución de llamada convierte
  su caída en tu pérdida de datos.

Así que: nunca uses `await` sobre una petición HTTP saliente en una devolución de llamada. Encólala.

## Notificación de Slack sobre un Nuevo Pedido

`WebhookDispatcher` se exporta desde `@rebasepro/server`. `enqueueEntityChange` retorna
inmediatamente — el POST ocurre cuando la escritura se confirma, nunca para una que se revierte —
y el dispatcher valida el destino, firma el payload, limita cada intento con un plazo
y reintenta los fallos.

Dale la cola de jobs del backend y cada entrega se convierte en una fila de `rebase.jobs`: sobrevive a
un despliegue o a un fallo, el worker de cualquier instancia que la reclame la reintenta con retroceso, y un
receptor caído durante un día cuesta filas, no memoria. Activa la cola con
`jobs: { enabled: true }` en `initializeRebaseBackend`, y conecta el dispatcher una vez que
haya devuelto:

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

    backend.setCollectionCallbacks("orders", {
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

Solo el id del webhook se almacena en el job, de modo que su secreto de firma nunca queda en `rebase.jobs`. Un
destino que el dispatcher rechaza, o un receptor que responde con una redirección, va a la cola de fallidos (dead-letter)
tras un intento, con el motivo; todo lo demás se reintenta como cualquier job. Consulta
[Webhooks duraderos](/docs/backend/jobs#durable-webhooks).

`setCollectionCallbacks` **reemplaza** los callbacks que declara la colección `orders`.
Si declara alguno, consérvalos:
pasa
`composeCallbacks(declared, { afterSave })`, con `composeCallbacks` de
`@rebasepro/server` y `declared` los `callbacks` propios de la colección. Consulta
[Combinar conjuntos de callbacks](/docs/collections/callbacks/#combining-callback-sets).

### Sin una cola de jobs

Omite `jobQueue` — o ejecuta sobre un driver sin SQL, donde el backend no tiene ninguna — y las
entregas se encolan en memoria, en el proceso que hizo el cambio. Es más simple, y
basta para una notificación que puedes permitirte perder:

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

    backend.setCollectionCallbacks("orders", {
        afterSave: async ({ values, id, status }) => {
            if (status === "new") {
                dispatcher.enqueueEntityChange("orders", "INSERT", String(id), values);
            }
        }
    });
}
```

Mantén el dispatcher fuera del propio archivo de la colección. Un archivo de colección también se incluye en el
administrador, en el navegador: la compilación elimina sus callbacks, pero un dispatcher construido al principio del archivo
y su importación de `@rebasepro/server` llegarían a todos los visitantes, y harían fallar la compilación del administrador.

Un fallo del proceso o un despliegue entre la confirmación y la entrega pierde el evento. Cada webhook tiene su propia
cola, así que un receptor caído retrasa solo sus propias entregas, nunca las de otro webhook.
La cola de cada webhook admite como máximo
10.000 entregas en espera; mientras está llena, una nueva entrega se rechaza y se informa a `onDelivery`
con `success: false`, `statusCode: 0`, `attemptNumber: 0` y `responseBody: "queue full"`, y
el registro del servidor lo dice una vez. Llama a `await dispatcher.flush(10_000)` al apagar: espera a lo que
está en cola y se resuelve con `false` si se agota el tiempo antes, porque un receptor caído puede
retener cada una de sus entregas hasta ~36 segundos de reintentos.

### Lo que recibe el receptor

Cada entrega es un `POST` con un cuerpo JSON y estas cabeceras:

| Cabecera | Valor |
| --- | --- |
| `X-Webhook-Id` | El `id` del webhook |
| `X-Webhook-Event` | `INSERT`, `UPDATE` o `DELETE` |
| `X-Webhook-Delivery` | Un id por entrega, el mismo en cada intento de ella |
| `X-Webhook-Attempt` | Qué intento es este, desde `1` |
| `X-Webhook-Signature` | `sha256=` y el HMAC-SHA256 en hexadecimal del cuerpo en bruto, con la clave del `secret` del webhook (solo cuando lo tiene) |

Las entregas son al-menos-una-vez: un receptor que respondió demasiado despacio, o un worker que murió tras el
`POST`, hacen que la misma entrega llegue de nuevo. Deduplica por `X-Webhook-Delivery`, y comprueba la
firma sobre el cuerpo exactamente como llegó — antes de analizarlo:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function isSignedByRebase(rawBody: string, header: string | null, secret: string): boolean {
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
    const received = Buffer.from(header ?? "");
    return received.length === expected.length && timingSafeEqual(received, expected);
}
```

### Llamar directamente a un endpoint

Si vas a enviar un cuerpo construido a mano a un único endpoint y no quieres el dispatcher, siguen
aplicando las mismas dos reglas — acota la petición, y nunca dejes que su fallo llegue al llamante:

```typescript
import type { CollectionCallbacks } from "@rebasepro/types";

type Order = { customer_name: string; total: number };

const callbacks: CollectionCallbacks<Order> = {
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
            // a throw *inside* the callback would roll the order back.
            console.error("Slack notification failed", error);
        });
    }
};
```

Nunca pases a un `fetch` desnudo una URL que venga de tu base de datos. El dispatcher rechaza
destinos loopback, link-local, privados y esquemas que no sean `http(s)` antes de conectarse, y se
niega a seguir redirecciones, precisamente porque una URL almacenada es entrada controlada por un
atacante.
En Node juzga la dirección a la que
realmente se hace cada conexión, dentro de la propia búsqueda DNS de la conexión, de modo que un nombre cuyo registro
cambia entre una comprobación y la conexión no puede colarse; el nombre de un receptor se resuelve
una vez por conexión, no una vez por entrega.

## Sincronización con API Externa

`afterDelete` recibe la fila eliminada en plano, como `row` — las columnas de la tabla, no un envoltorio de entidad.

```typescript
import type { CollectionCallbacks } from "@rebasepro/types";

type Product = { name: string; description: string; price: number; shopify_id: string };

const syncQueue: Promise<unknown>[] = [];

const callbacks: CollectionCallbacks<Product> = {
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

    afterDelete: async ({ row }) => {
        const shopifyId = row.shopify_id;
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

## Gestión de Errores

`afterSaveError` se ejecuta cuando el guardado — o cualquier devolución de llamada `afterSave` —
lanza una excepción. Es un hook de notificación, no un rescate: la transacción se deshace, la fila
no se guarda y **el error se relanza después de ejecutarlo**. En una solicitud se ejecuta una vez
completado el rollback, fuera de la transacción fallida, de modo que una entrega que pase a la cola
del dispatcher se conserva en lugar de deshacerse junto con la escritura.

```typescript
import type { CollectionCallbacks } from "@rebasepro/types";

const callbacks: CollectionCallbacks = {
    afterSave: async ({ values }) => {
        // If this throws, the write is rolled back. That is the right behaviour
        // for a validation or an invariant, and the wrong one for a notification.
        await recordAuditEntry(values);
    },
    afterSaveError: async ({ id, values }) => {
        // Runs, and then the error is rethrown. Use it to alert, not to recover.
        console.error(`Save failed for entity ${id}`, values);
    }
};
```

Si un fallo *no* debe costarle al usuario su escritura, no debe propagarse fuera de `afterSave` —
captúralo ahí, o entrega el trabajo a la cola del dispatcher.

## Próximos Pasos

- **[Devoluciones de llamada de entidad](/docs/collections/callbacks)** — Referencia completa de devoluciones de llamada
- **[Receta de CMS para Blog](/docs/recipes/blog-cms)** — Ejemplo completo de blog
