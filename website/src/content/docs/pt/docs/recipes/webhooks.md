---
sourceHash: 517637e2cfd34608
title: "Receita: Integração de Webhooks"
sidebar_label: Webhooks
description: Use table hooks para enviar webhooks para serviços externos quando os dados mudarem, sem manter a transação de escrita aberta.
---

## Visão Geral

Use os [table hooks](/docs/collections/callbacks/) `afterSave` e `afterDelete` para notificar serviços externos quando houver alterações de dados no Rebase.

Dois detalhes sobre esses hooks determinam como esta receita foi estruturada, e nenhum deles é opcional:

- **Eles são executados dentro da transação do banco de dados da escrita.** Qualquer coisa que você use `await` ali manterá uma conexão do pool e os bloqueios (locks) da linha até que ela retorne. Um receptor que leva dez segundos significa uma transação de dez segundos; um receptor que nunca responde é uma transação que nunca termina.
- **Um erro lançado (`throw`) em `afterSave` reverte (`rollback`) a escrita.** O erro chega ao chamador como um 500 e a linha não é salva. Fazer `await` de um serviço terceiro dentro do hook transforma a indisponibilidade deles na sua perda de dados.

Portanto: nunca use `await` em uma requisição HTTP de saída em um hook. Enfileire-a.

## Notificação do Slack em Novo Pedido

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O `WebhookDispatcher` é exportado de `@rebasepro/server`. `enqueueEntityChange` retorna imediatamente — o POST acontece assim que a escrita faz commit, nunca para uma que sofre rollback — e o dispatcher valida o destino, assina o payload, limita cada tentativa com um prazo (deadline) e tenta novamente em caso de falha.

Forneça a ele a fila de jobs do backend e cada entrega se tornará uma linha em `rebase.jobs`: ela sobrevive a um deploy ou a uma falha (crash), é tentada novamente com backoff pelo worker da instância que a reivindicar, e um receptor fora do ar por um dia custa linhas, não memória. Ative a fila com `jobs: { enabled: true }` em `initializeRebaseBackend`, e conecte o dispatcher assim que ele retornar:

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

Apenas o id do webhook é armazenado no job, portanto seu segredo de assinatura nunca fica em `rebase.jobs`. Um destino recusado pelo dispatcher, ou um receptor que responde com redirecionamento, é enviado para a fila de mensagens mortas (dead-letter) após uma tentativa com o motivo; qualquer outro caso é tentado novamente como qualquer job. Consulte [Webhooks duráveis](/docs/backend/jobs#durable-webhooks).

`setTableHooks` **substitui** os hooks que a tabela `orders` declara. Se ela declarar algum, mantenha-os: passe `composeTableHooks(declared, { afterSave })`, com `composeTableHooks` de `@rebasepro/common` e `declared` sendo os próprios `hooks` da tabela (`orders.config.hooks`). Consulte [Combinando conjuntos de hooks](/docs/collections/callbacks/#combining-hook-sets).

### Sem uma fila de jobs

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Omita `jobQueue` — ou execute onde o backend não tem fila de jobs — e as entregas serão enfileiradas na memória, no processo que fez a alteração. Isso é mais simples e suficiente para notificações que você pode se dar ao luxo de perder:

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

Mantenha o dispatcher fora do arquivo da tabela em si. O `backend/schema` é carregado por todos os comandos que leem o schema — `rebase db push`, `generate-sdk`, `doctor` — e um dispatcher criado no topo do arquivo seria instanciado por cada um deles. Anexe-o onde o backend é criado, como mostrado acima.

Uma falha (crash) ou um deploy entre o commit e a entrega descarta o evento. Cada webhook tem sua própria fila, de modo que um receptor fora do ar atrasa apenas suas próprias entregas, nunca as de outro webhook. A fila de cada webhook comporta no máximo 10.000 entregas em espera; enquanto estiver cheia, uma nova entrega é recusada e reportada ao `onDelivery` com `success: false`, `statusCode: 0`, `attemptNumber: 0` e `responseBody: "queue full"`, e o log do servidor registra isso uma vez. Chame `await dispatcher.flush(10_000)` no encerramento (shutdown): ele aguarda o que estiver na fila e resolve como `false` se o tempo limite se esgotar antes, já que um receptor fora do ar pode reter cada uma de suas entregas por até ~36 segundos de tentativas.

### O que o receptor recebe

Cada entrega é um `POST` com um corpo JSON e estes cabeçalhos:

| Cabeçalho | Valor |
| --- | --- |
| `X-Webhook-Id` | O `id` do webhook |
| `X-Webhook-Event` | `INSERT`, `UPDATE` ou `DELETE` |
| `X-Webhook-Delivery` | Um id por entrega, o mesmo em cada tentativa |
| `X-Webhook-Attempt` | Qual tentativa é esta, a partir de `1` |
| `X-Webhook-Signature` | `sha256=` e o HMAC-SHA256 em hexadecimal do corpo bruto, assinado com o `secret` do webhook (apenas quando houver um) |

As entregas são no modelo *at-least-once* (pelo menos uma vez): um receptor que respondeu lentamente demais, ou um worker que caiu após o `POST`, significa que a mesma entrega chegará novamente. Desduplique usando `X-Webhook-Delivery` e verifique a assinatura sobre o corpo exatamente como ele chegou — antes de fazer o parse:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function isSignedByRebase(rawBody: string, header: string | null, secret: string): boolean {
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
    const received = Buffer.from(header ?? "");
    return received.length === expected.length && timingSafeEqual(received, expected);
}
```

### Chamando um endpoint diretamente

Se você estiver enviando um payload montado manualmente para um endpoint e não quiser usar o dispatcher, as mesmas duas regras ainda se aplicam — limite a requisição e nunca deixe que a falha dela chegue ao chamador:

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

Nunca passe uma URL que veio do seu banco de dados diretamente para um `fetch`. O dispatcher rejeita destinos loopback, link-local, privados e diferentes de `http(s)` antes de se conectar, e recusa-se a seguir redirecionamentos, precisamente porque uma URL armazenada é uma entrada controlada pelo usuário/atacante. No Node, ele avalia o endereço ao qual cada conexão é de fato realizada, dentro da própria resolução de DNS da conexão, de modo que um nome cujo registro mude entre a verificação e a conexão não possa passar despercebido; o nome de um receptor é resolvido uma vez por conexão, não uma vez por entrega.

## Sincronização com API Externa

`afterDelete` recebe a linha excluída de forma simples, como `values` — as colunas da tabela, não um wrapper de entidade.

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

## Tratamento de Erros

`afterSaveError` é executado quando o save — ou qualquer hook `afterSave` — lança uma exceção. Trata-se de um hook de notificação, não de recuperação (rescue): a transação sofre rollback, a linha não é salva e **o erro é relançado após a sua execução**. Em uma requisição, ele é executado assim que o rollback é concluído, fora da transação que falhou, portanto, uma entrega passada para a fila do dispatcher é mantida em vez de sofrer rollback junto com a escrita.

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

Se uma falha *não* deve custar a escrita do usuário, ela não deve lançar exceções para fora do `afterSave` — capture-a ali ou encaminhe o trabalho para a fila do dispatcher.

## Próximos Passos

- **[Table hooks](/docs/collections/callbacks)** — Referência completa de hooks
- **[Receita de Blog CMS](/docs/recipes/blog-cms)** — Exemplo completo de blog
