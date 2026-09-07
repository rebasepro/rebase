---
sourceHash: 713d80a42d70ff87
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
inmediatamente — el POST ocurre después de que la devolución de llamada retorna, fuera de la
transacción — y el dispatcher valida el destino, firma el payload, limita cada intento con un plazo
y reintenta los fallos.

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";
import { WebhookDispatcher } from "@rebasepro/server";

// The row shape, so `values.customer_name` is a string rather than nothing.
type Order = { customer_name: string; total: number };

const dispatcher = new WebhookDispatcher({
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

const ordersCollection: PostgresCollectionConfig<Order> = {
    slug: "orders",
    name: "Orders",
    table: "orders",
    callbacks: {
        afterSave: async ({ values, id, status }) => {
            if (status === "new") {
                // Returns void, immediately. The delivery runs after this
                // callback returns, so the transaction is not waiting on it.
                dispatcher.enqueueEntityChange("orders", "INSERT", String(id), values);
            }
        }
    },
    properties: { /* ... */ }
};
```

La cola es en proceso y en memoria: un fallo del proceso o un despliegue entre el encolado y la
entrega pierde el evento, y el receptor puede ver la notificación unos milisegundos antes de que la
fila esté confirmada. Llama a `await dispatcher.flush()` al apagar. Si las entregas deben sobrevivir
a un reinicio, escribe una fila de outbox en la misma transacción y vacíala desde un job.

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
lanza una excepción. Es un hook de notificación, no un rescate: **el error se relanza después de
ejecutarlo**, la transacción se deshace y la fila no se guarda.

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

---
