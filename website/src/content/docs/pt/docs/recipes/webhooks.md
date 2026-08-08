---
title: "Receita: Integração de Webhook"
sidebar_label: Webhooks
description: Utilize callbacks de entidade para enviar webhooks a serviços externos quando os dados mudam, sem manter aberta a transação da escrita.
---

## Visão Geral

Utilize os callbacks `afterSave` e `afterDelete` para notificar serviços externos quando os dados mudam no Rebase.

Duas características desses callbacks determinam como esta receita está escrita, e nenhuma delas é opcional:

- **Eles são executados dentro da transação da escrita.** Tudo o que você aguardar com `await` ali
  retém uma conexão do pool e os bloqueios da linha até retornar. Um receptor que leva dez segundos
  é uma transação de dez segundos; um receptor que nunca responde é uma transação que nunca termina.
- **Uma exceção lançada por `afterSave` desfaz a escrita.** O erro chega ao chamador como um 500 e a
  linha não é gravada. Aguardar um terceiro dentro do callback transforma a indisponibilidade dele
  na sua perda de dados.

Portanto: nunca use `await` numa requisição HTTP de saída dentro de um callback. Enfileire-a.

## Notificação do Slack em Novo Pedido

`WebhookDispatcher` é exportado de `@rebasepro/server`. `enqueueEntityChange` retorna
imediatamente — o POST acontece depois de o callback retornar, fora da transação — e o dispatcher
valida o destino, assina o payload, limita cada tentativa com um prazo e repete as falhas.

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

A fila é em processo e em memória: uma falha do processo ou um deploy entre o enfileiramento e a
entrega perde o evento, e o receptor pode ver a notificação alguns milissegundos antes de a linha
ser confirmada. Chame `await dispatcher.flush()` no encerramento. Se as entregas precisam
sobreviver a um reinício, escreva uma linha de outbox na mesma transação e esvazie-a a partir de um
job.

### Chamar um endpoint diretamente

Se você vai enviar um corpo construído à mão para um único endpoint e não quer o dispatcher, as
mesmas duas regras continuam valendo — limite a requisição, e nunca deixe a falha dela chegar ao
chamador:

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

Nunca passe para um `fetch` nu uma URL vinda do seu banco de dados. O dispatcher recusa destinos
loopback, link-local, privados e esquemas que não sejam `http(s)` antes de conectar, e recusa-se a
seguir redirecionamentos, justamente porque uma URL armazenada é entrada controlada por um
atacante.

## Sincronização com API Externa

`afterDelete` recebe a linha excluída de forma plana, como `row` — as colunas da tabela, não um wrapper de entidade.

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

## Tratamento de Erros

`afterSaveError` é executado quando a gravação — ou qualquer callback `afterSave` — lança uma
exceção. É um hook de notificação, não um resgate: **o erro é relançado depois que ele roda**, a
transação é desfeita e a linha não é gravada.

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

Se uma falha *não* deve custar ao usuário a sua escrita, ela não pode escapar de `afterSave` —
capture-a ali, ou entregue o trabalho à fila do dispatcher.

## Próximos Passos

-   **[Callbacks de Entidade](/docs/collections/callbacks)** — Referência completa de callbacks
-   **[Receita de Blog CMS](/docs/recipes/blog-cms)** — Exemplo completo de blog

---
