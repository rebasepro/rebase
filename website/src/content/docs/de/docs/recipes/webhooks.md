---
sourceHash: 517637e2cfd34608
title: "Rezept: Webhook-Integration"
sidebar_label: Webhooks
description: Verwenden Sie Table Hooks, um Webhooks an externe Dienste zu senden, wenn sich Daten ändern, ohne die Transaktion des Schreibvorgangs offenzuhalten.
---

## Übersicht

Verwenden Sie die `afterSave`- und `afterDelete`-[Table Hooks](/docs/collections/callbacks/), um externe Dienste zu benachrichtigen, wenn sich Daten in Rebase ändern.

Zwei Eigenschaften dieser Hooks bestimmen, wie dieses Rezept aufgebaut ist, und keine davon ist optional:

- **Sie laufen innerhalb der Datenbanktransaktion des Schreibvorgangs.** Alles, was Sie dort mit `await` abwarten, hält eine Verbindung aus dem Connection-Pool sowie die Zeilensperren (Row Locks) offen, bis eine Rückmeldung erfolgt. Ein Empfänger, der zehn Sekunden benötigt, bedeutet eine zehnsekündige Transaktion; ein Empfänger, der nie antwortet, bedeutet eine Transaktion, die niemals endet.
- **Ein Fehler (`throw`) aus `afterSave` führt zum Rollback des Schreibvorgangs.** Der Fehler erreicht den Aufrufer als 500-Fehler und die Zeile wird nicht gespeichert. Das Abwarten eines Drittanbieters innerhalb des Hooks macht dessen Ausfall zu Ihrem Datenverlust.

Daher gilt: Führen Sie niemals ein `await` für eine ausgehende HTTP-Anfrage in einem Hook aus. Stellen Sie sie in eine Warteschlange (Queue).

## Slack-Benachrichtigung bei neuer Bestellung

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`WebhookDispatcher` wird aus `@rebasepro/server` exportiert. `enqueueEntityChange` kehrt sofort zurück – der POST-Request erfolgt erst, sobald der Schreibvorgang committet wurde, und niemals bei einem Rollback – und der Dispatcher validiert das Ziel, signiert die Payload, begrenzt jeden Versuch mit einer Frist (Deadline) und wiederholt fehlgeschlagene Versuche.

Übergeben Sie ihm die Job-Queue des Backends, und jede Zustellung wird zu einer Zeile in `rebase.jobs`: Sie übersteht ein Deployment oder einen Absturz, wird mit Backoff von dem Worker der Instanz wiederholt, die sie reserviert, und ein Empfänger, der einen Tag lang offline ist, kostet lediglich Zeilen, keinen Arbeitsspeicher. Aktivieren Sie die Queue mit `jobs: { enabled: true }` in `initializeRebaseBackend` und binden Sie den Dispatcher ein, sobald dieses zurückgekehrt ist:

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

Es wird nur die ID des Webhooks im Job gespeichert, sodass dessen Signaturgeheimnis (Secret) niemals in `rebase.jobs` verbleibt. Ein Ziel, das der Dispatcher verweigert, oder ein Empfänger, der mit einem Redirect antwortet, wird nach einem einzigen Versuch mit der Begründung als Dead Letter behandelt; alles andere wird wie jeder andere Job wiederholt. Siehe [Durable Webhooks](/docs/backend/jobs#durable-webhooks).

`setTableHooks` **ersetzt** die Hooks, die von der Tabelle `orders` deklariert wurden. Falls bereits Hooks vorhanden sind, behalten Sie diese bei: Übergeben Sie `composeTableHooks(declared, { afterSave })`, wobei `composeTableHooks` aus `@rebasepro/common` stammt und `declared` die eigenen `hooks` der Tabelle darstellen (`orders.config.hooks`). Siehe [Kombinieren von Hook-Sets](/docs/collections/callbacks/#combining-hook-sets).

### Ohne Job-Queue

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Lassen Sie `jobQueue` weg – oder führen Sie den Code dort aus, wo das Backend keine Job-Queue hat –, werden die Zustellungen im Arbeitsspeicher des Prozesses eingereiht, der die Änderung vorgenommen hat. Das ist einfacher und reicht für Benachrichtigungen aus, deren Verlust verkraftbar ist:

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

Halten Sie den Dispatcher aus der Tabellendatei selbst heraus. `backend/schema` wird von jedem Befehl geladen, der das Schema einliest – `rebase db push`, `generate-sdk`, `doctor` – und ein am Anfang der Datei erstellter Dispatcher würde von jedem dieser Befehle instanziiert werden. Binden Sie ihn stattdessen dort ein, wo das Backend erstellt wird, wie oben gezeigt.

Ein Absturz oder ein Deployment zwischen dem Commit und der Zustellung führt zum Verlust des Ereignisses. Jeder Webhook verfügt über eine eigene Queue, sodass ein nicht erreichbarer Empfänger nur seine eigenen Zustellungen verzögert, niemals die eines anderen Webhooks.
Die Queue jedes Webhooks fasst maximal 10.000 wartende Zustellungen. Ist sie voll, wird eine neue Zustellung abgelehnt und an `onDelivery` mit `success: false`, `statusCode: 0`, `attemptNumber: 0` und `responseBody: "queue full"` gemeldet, und das Server-Log gibt dies einmalig aus. Rufen Sie `await dispatcher.flush(10_000)` beim Herunterfahren auf: Dies wartet auf ausstehende Elemente in der Queue und gibt `false` zurück, falls das Zeitbudget zuerst erschöpft ist, da ein ausgefallener Empfänger jede seiner Zustellungen für bis zu ca. 36 Sekunden an Retry-Versuchen aufhalten kann.

### Was der Empfänger erhält

Jede Zustellung ist ein `POST`-Request mit einem JSON-Body und diesen Headern:

| Header | Wert |
| --- | --- |
| `X-Webhook-Id` | Die `id` des Webhooks |
| `X-Webhook-Event` | `INSERT`, `UPDATE` oder `DELETE` |
| `X-Webhook-Delivery` | Eine ID pro Zustellung, identisch bei jedem Versuch |
| `X-Webhook-Attempt` | Der wievielte Versuch dies ist, beginnend bei `1` |
| `X-Webhook-Signature` | `sha256=` gefolgt vom hexadezimalen HMAC-SHA256 des rohen Request-Bodys, generiert mit dem `secret` des Webhooks (nur vorhanden, wenn ein Secret konfiguriert ist) |

Die Zustellung erfolgt nach dem At-least-Once-Prinzip: Antwortet ein Empfänger zu langsam oder stürzt ein Worker nach dem `POST` ab, wird dieselbe Zustellung erneut gesendet. Führen Sie eine Deduplizierung anhand von `X-Webhook-Delivery` durch und prüfen Sie die Signatur über den Body exakt so, wie er eingetroffen ist – noch vor dem Parsen:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function isSignedByRebase(rawBody: string, header: string | null, secret: string): boolean {
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
    const received = Buffer.from(header ?? "");
    return received.length === expected.length && timingSafeEqual(received, expected);
}
```

### Einen Endpunkt direkt aufrufen

Wenn Sie einen manuell erstellten Body an einen einzelnen Endpunkt senden und den Dispatcher nicht verwenden möchten, gelten dennoch dieselben zwei Regeln – begrenzen Sie den Request zeitlich und lassen Sie niemals zu, dass Fehler den Aufrufer erreichen:

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

Übergeben Sie niemals eine URL aus Ihrer Datenbank an ein ungeschütztes `fetch`. Der Dispatcher weist Loopback-, Link-Local-, private sowie Nicht-`http(s)`-Ziele ab, bevor eine Verbindung hergestellt wird, und weigert sich, Weiterleitungen zu folgen – eben weil eine gespeicherte URL potenziell vom Angreifer kontrollierte Eingabedaten darstellt.
Unter Node prüft er die Adresse, zu der die Verbindung tatsächlich aufgebaut wird, innerhalb des verbindungs-eigenen DNS-Lookups. Dadurch kann ein Name, dessen Eintrag sich zwischen Prüfung und Verbindungsaufbau ändert, nicht unbemerkt durchschlüpfen; der Hostname eines Empfängers wird einmal pro Verbindung aufgelöst, nicht einmal pro Zustellung.

## Synchronisierung mit einer externen API

`afterDelete` erhält die gelöschte Zeile flach als `values` – die Spalten der Tabelle, kein Entity-Wrapper.

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

## Fehlerbehandlung

`afterSaveError` wird ausgeführt, wenn der Speichervorgang – oder ein beliebiger `afterSave`-Hook – einen Fehler auslöst. Es ist ein Benachrichtigungs-Hook, keine Rettungsroutine: Die Transaktion wird zurückgerollt, die Zeile wird nicht gespeichert und **der Fehler wird nach der Ausführung erneut geworfen**. Bei einem Request läuft er, sobald das Rollback abgeschlossen ist, außerhalb der fehlgeschlagenen Transaktion. Daher bleibt eine Zustellung, die an die Queue des Dispatchers übergeben wird, erhalten, anstatt mit dem Schreibvorgang zurückgerollt zu werden.

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

Wenn ein Fehler den Benutzer *nicht* seinen Schreibvorgang kosten soll, darf er nicht aus `afterSave` heraus geworfen werden – fangen Sie ihn dort ab oder übergeben Sie die Arbeit an die Queue des Dispatchers.

## Nächste Schritte

- **[Table Hooks](/docs/collections/callbacks)** – Vollständige Hook-Referenz
- **[Blog-CMS-Rezept](/docs/recipes/blog-cms)** – Vollständiges Blog-Beispiel
