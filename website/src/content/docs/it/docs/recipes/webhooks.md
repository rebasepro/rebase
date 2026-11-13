---
sourceHash: 517637e2cfd34608
title: "Ricetta: Integrazione webhook"
sidebar_label: Webhooks
description: Usa gli hook di tabella per inviare webhook a servizi esterni quando i dati cambiano, senza mantenere aperta la transazione di scrittura.
---

## Panoramica

Usa gli [hook di tabella](/docs/collections/callbacks/) `afterSave` e `afterDelete` per notificare i servizi esterni quando i dati cambiano in Rebase.

Due aspetti riguardanti questi hook determinano il modo in cui è scritta questa ricetta, e nessuno dei due è opzionale:

- **Vengono eseguiti all'interno della transazione di scrittura del database.** Qualsiasi operazione per cui si esegue un `await` trattiene una connessione del pool e i lock della riga finché non ritorna. Un ricevitore che impiega dieci secondi comporta una transazione di dieci secondi; un ricevitore che non risponde mai è una transazione che non termina mai.
- **Un'eccezione generata da `afterSave` esegue il rollback della scrittura.** L'errore raggiunge il chiamante come un 500 e la riga non viene salvata. Attendere una terza parte all'interno dell'hook trasforma il loro disservizio nella tua perdita di dati.

Quindi: non usare mai `await` per una richiesta HTTP in uscita all'interno di un hook. Mettila in coda.

## Notifica Slack su nuovo ordine

<span class="since-badge" data-since="0.31">Since 0.31</span>

`WebhookDispatcher` viene esportato da `@rebasepro/server`. `enqueueEntityChange` ritorna immediatamente — la POST viene effettuata una volta eseguito il commit della scrittura, mai per una che subisce il rollback — e il dispatcher convalida la destinazione, firma il payload, delimita ogni tentativo con una scadenza e ritenta i fallimenti.

Forniscigli la coda di job del backend e ogni consegna diventerà una riga in `rebase.jobs`: sopravvive a un deploy o a un crash, viene ritentata con backoff dal worker dell'istanza che la prende in carico, e un ricevitore non disponibile per un giorno costa righe, non memoria. Attiva la coda con `jobs: { enabled: true }` in `initializeRebaseBackend` e collega il dispatcher una volta completata l'inizializzazione:

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

Solo l'id del webhook viene memorizzato nel job, quindi il suo segreto di firma non risiede mai in `rebase.jobs`. Una destinazione rifiutata dal dispatcher, o un ricevitore che risponde con un reindirizzamento, viene spostata in dead-letter dopo un tentativo con la relativa motivazione; qualsiasi altra cosa viene ritentata come un normale job. Consulta [Durable webhooks](/docs/backend/jobs#durable-webhooks).

`setTableHooks` **sostituisce** gli hook dichiarati dalla tabella `orders`. Se ne dichiara già alcuni, mantienili: passa `composeTableHooks(declared, { afterSave })`, con `composeTableHooks` da `@rebasepro/common` e `declared` corrispondente agli `hooks` della tabella stessa (`orders.config.hooks`). Consulta [Combining hook sets](/docs/collections/callbacks/#combining-hook-sets).

### Senza una coda di job

<span class="since-badge" data-since="0.31">Since 0.31</span>

Ometti `jobQueue` — o esegui l'applicazione dove il backend non ha una coda di job — e le consegne verranno accodate in memoria, nel processo che ha apportato la modifica. Questo approccio è più semplice ed è sufficiente per le notifiche che ci si può permettere di perdere:

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

Mantieni il dispatcher fuori dal file della tabella stesso. `backend/schema` viene caricato da ogni comando che legge lo schema — `rebase db push`, `generate-sdk`, `doctor` — e un dispatcher istanziato in cima al file verrebbe creato da ciascuno di essi. Collegalo dove viene creato il backend, come mostrato sopra.

Un crash o un deploy tra il commit e la consegna comporterà la perdita dell'evento. Ogni webhook ha la propria coda, quindi un ricevitore offline ritarderà solo le proprie consegne, mai quelle di un altro webhook. La coda di ciascun webhook può contenere al massimo 10.000 consegne in attesa; quando è piena, una nuova consegna viene rifiutata e segnalata a `onDelivery` con `success: false`, `statusCode: 0`, `attemptNumber: 0` e `responseBody: "queue full"`, e il log del server lo segnalerà una volta. Chiama `await dispatcher.flush(10_000)` allo spegnimento: attende ciò che è in coda e si risolve in `false` se il tempo a disposizione si esaurisce prima, poiché un ricevitore offline può trattenere ciascuna delle sue consegne per un massimo di circa 36 secondi di tentativi.

### Cosa riceve il destinatario

Ogni consegna è una `POST` con un body JSON e questi header:

| Header | Valore |
| --- | --- |
| `X-Webhook-Id` | L'`id` del webhook |
| `X-Webhook-Event` | `INSERT`, `UPDATE` o `DELETE` |
| `X-Webhook-Delivery` | Un id per consegna, lo stesso per ogni tentativo relativo |
| `X-Webhook-Attempt` | Il numero del tentativo corrente, a partire da `1` |
| `X-Webhook-Signature` | `sha256=` e l'HMAC-SHA256 esadecimale del body grezzo, con chiave il `secret` del webhook (solo se configurato) |

Le consegne sono at-least-once (almeno una volta): un ricevitore che risponde troppo lentamente, o un worker che si arresta in modo anomalo dopo la `POST`, comporta che la stessa consegna arrivi nuovamente. Esegui la deduplicazione su `X-Webhook-Delivery` e verifica la firma sul body esattamente come è stato ricevuto — prima di effettuarne il parsing:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function isSignedByRebase(rawBody: string, header: string | null, secret: string): boolean {
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
    const received = Buffer.from(header ?? "");
    return received.length === expected.length && timingSafeEqual(received, expected);
}
```

### Chiamare direttamente un endpoint

Se stai inviando tramite POST un body creato manualmente a un singolo endpoint e non desideri usare il dispatcher, si applicano comunque le stesse due regole: imposta un timeout alla richiesta e non lasciare mai che il suo fallimento raggiunga il chiamante:

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

Non inserire mai in una semplice `fetch` un URL proveniente dal database. Il dispatcher rifiuta le destinazioni di loopback, link-local, private e non-`http(s)` prima di connettersi, e rifiuta di seguire i reindirizzamenti, proprio perché un URL memorizzato è un input controllato da potenziali aggressori. Su Node valuta l'indirizzo verso cui viene effettivamente stabilita ogni connessione, all'interno della risoluzione DNS della connessione stessa, in modo che un nome di dominio il cui record cambia tra il controllo e la connessione non possa sfuggirgli; il nome di un ricevitore viene risolto una volta per connessione, non una volta per consegna.

## Sincronizzazione con un'API esterna

`afterDelete` riceve la riga eliminata in formato piatto, come `values` — le colonne della tabella, non un wrapper di entità.

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

## Gestione degli errori

`afterSaveError` viene eseguito quando il salvataggio — o qualsiasi hook `afterSave` — genera un'eccezione. È un hook di notifica, non di recupero: la transazione viene annullata (rollback), la riga non viene salvata e **l'errore viene rilanciato dopo la sua esecuzione**. In una richiesta viene eseguito una volta completato il rollback, all'esterno della transazione fallita, quindi una consegna inoltrata alla coda del dispatcher viene conservata anziché essere annullata insieme alla scrittura.

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

Se un fallimento *non* deve compromettere la scrittura dell'utente, non deve propagare eccezioni all'esterno di `afterSave`: intercettalo lì o affida il lavoro alla coda del dispatcher.

## Passaggi successivi

- **[Table hooks](/docs/collections/callbacks)** — Riferimento completo agli hook
- **[Blog CMS Recipe](/docs/recipes/blog-cms)** — Esempio completo di blog
