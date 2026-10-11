---
sourceHash: 97ec2f8d66caedf1
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
imediatamente — o POST acontece quando a escrita é confirmada, nunca para uma revertida — e o dispatcher
valida o destino, assina o payload, limita cada tentativa com um prazo e repete as falhas.

Entregue a ele a fila de jobs do backend e cada entrega se torna uma linha em `rebase.jobs`: ela sobrevive a
um deploy ou a uma falha, é repetida com backoff pelo worker de qualquer instância que a reivindique, e um
receptor que fica fora do ar por um dia custa linhas, não memória. Ligue a fila com
`jobs: { enabled: true }` em `initializeRebaseBackend`, e conecte o dispatcher depois que ela
tiver retornado:

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

Apenas o id do webhook é armazenado no job, de modo que o seu segredo de assinatura nunca fica em `rebase.jobs`. Um
destino que o dispatcher recusa, ou um receptor que responde com um redirecionamento, vai para a dead-letter
após uma tentativa, com o motivo; qualquer outra falha é repetida como em qualquer job. Veja
[Webhooks duráveis](/docs/backend/jobs#durable-webhooks).

### Sem uma fila de jobs

Deixe `jobQueue` de fora — ou execute em um driver sem SQL, onde o backend não tem uma — e as
entregas ficam na fila em memória, no processo que fez a alteração. É mais simples, e
basta para uma notificação que você pode se dar ao luxo de perder:

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

Mantenha o dispatcher fora do próprio arquivo da coleção. Um arquivo de coleção também é incluído no
admin, no navegador: o build remove os seus callbacks, mas um dispatcher criado no topo do arquivo
e o seu import de `@rebasepro/server` iriam para todos os visitantes, e fariam o build do admin falhar.

Uma falha ou um deploy entre a confirmação e a entrega perde o evento. Cada webhook tem a sua própria
fila, então um receptor fora do ar atrasa apenas as suas próprias entregas, nunca as de outro webhook.
<span class="since-badge" data-since="0.25">Desde 0.25</span> A fila de cada webhook comporta no máximo
10.000 entregas em espera; enquanto estiver cheia, uma nova entrega é recusada e reportada ao `onDelivery`
com `success: false`, `statusCode: 0`, `attemptNumber: 0` e `responseBody: "queue full"`, e
o log do servidor avisa uma vez. Chame `await dispatcher.flush(10_000)` no encerramento: ele espera o que
está na fila e resolve `false` se o orçamento de tempo acabar antes, porque um receptor que está fora do ar pode
reter cada uma das suas entregas por até ~36 segundos de tentativas.

### O que o receptor recebe

Toda entrega é um `POST` com um corpo JSON e estes cabeçalhos:

| Cabeçalho | Valor |
| --- | --- |
| `X-Webhook-Id` | O `id` do webhook |
| `X-Webhook-Event` | `INSERT`, `UPDATE` ou `DELETE` |
| `X-Webhook-Delivery` | Um id por entrega, o mesmo em toda tentativa dela |
| `X-Webhook-Attempt` | Qual tentativa é esta, a partir de `1` |
| `X-Webhook-Signature` | `sha256=` e o HMAC-SHA256 em hexadecimal do corpo bruto, com a chave `secret` do webhook (apenas quando ele tem uma) |

As entregas são at-least-once: um receptor que respondeu devagar demais, ou um worker que morreu depois do
`POST`, faz a mesma entrega chegar de novo. Deduplique por `X-Webhook-Delivery` e verifique a
assinatura sobre o corpo exatamente como ele chegou — antes de interpretá-lo:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function isSignedByRebase(rawBody: string, header: string | null, secret: string): boolean {
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
    const received = Buffer.from(header ?? "");
    return received.length === expected.length && timingSafeEqual(received, expected);
}
```

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
<span class="since-badge" data-since="0.25">Desde 0.25</span> No Node, ele julga o endereço para o qual cada
conexão é de fato feita, dentro da própria resolução de DNS da conexão, de modo que um nome cujo registro
muda entre uma verificação e a conexão não consegue passar; o nome de um receptor é resolvido
uma vez por conexão, não uma vez por entrega.

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
exceção. É um hook de notificação, não um resgate: a transação é desfeita, a linha não é gravada e
**o erro é relançado depois que ele roda**. Em uma requisição, ele roda depois que o rollback termina,
fora da transação que falhou, então uma entrega que ele passa para a fila do dispatcher é mantida em vez
de ser desfeita junto com a escrita.

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
