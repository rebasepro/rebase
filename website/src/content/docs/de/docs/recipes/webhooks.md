---
sourceHash: 75953facb59d9645
title: "Rezept: Webhook-Integration"
sidebar_label: Webhooks
description: Verwenden Sie Entity-Callbacks, um Webhooks an externe Dienste zu senden, wenn sich Daten ändern, ohne die Transaktion des Schreibvorgangs offen zu halten.
---

## Übersicht

Verwenden Sie die Callbacks `afterSave` und `afterDelete`, um externe Dienste zu benachrichtigen, wenn sich Daten in Rebase ändern.

Zwei Eigenschaften dieser Callbacks bestimmen, wie dieses Rezept geschrieben ist, und keine davon ist optional:

- **Sie laufen innerhalb der Transaktion des Schreibvorgangs.** Alles, was Sie dort mit `await`
  abwarten, hält eine Verbindung aus dem Pool und die Sperren der Zeile, bis es zurückkommt. Ein
  Empfänger, der zehn Sekunden braucht, ist eine Transaktion von zehn Sekunden; ein Empfänger, der
  nie antwortet, ist eine Transaktion, die nie endet.
- **Eine Exception aus `afterSave` macht den Schreibvorgang rückgängig.** Der Fehler erreicht den
  Aufrufer als 500 und die Zeile wird nicht gespeichert. Auf einen Dritten im Callback zu warten
  macht dessen Ausfall zu Ihrem Datenverlust.

Also: niemals `await` auf eine ausgehende HTTP-Anfrage in einem Callback. Stellen Sie sie in die Warteschlange.

## Slack-Benachrichtigung bei neuer Bestellung

`WebhookDispatcher` wird aus `@rebasepro/server` exportiert. `enqueueEntityChange` kehrt sofort
zurück — der POST passiert, sobald der Schreibvorgang committet ist, nie für einen zurückgerollten — und
der Dispatcher validiert das Ziel, signiert die Nutzlast, begrenzt jeden Versuch mit einer Frist und
wiederholt Fehlschläge.

Geben Sie ihm die Job-Queue des Backends, und jede Zustellung wird zu einer Zeile in `rebase.jobs`: Sie überlebt
einen Deploy oder einen Absturz, wird mit Backoff von der Instanz wiederholt, deren Worker sie beansprucht, und ein
Empfänger, der einen Tag lang ausfällt, kostet Zeilen, nicht Arbeitsspeicher. Schalten Sie die Queue mit
`jobs: { enabled: true }` in `initializeRebaseBackend` ein und verdrahten Sie den Dispatcher, sobald es
zurückgekehrt ist:

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

Auf dem Job wird nur die ID des Webhooks gespeichert, sodass sein Signatur-Secret nie in `rebase.jobs` liegt. Ein
Ziel, das der Dispatcher ablehnt, oder ein Empfänger, der mit einer Weiterleitung antwortet, geht nach
einem Versuch mit dem Grund in die Dead-Letter-Ablage; alles andere wird wie jeder Job wiederholt. Siehe
[Durable Webhooks](/docs/backend/jobs#durable-webhooks).

`setCollectionCallbacks` **ersetzt** die Callbacks, die die Collection `orders`
deklariert. Wenn sie welche deklariert, behalten Sie diese:
<span class="since-badge" data-since="0.25">Seit 0.25</span> Übergeben Sie
`composeCallbacks(declared, { afterSave })`, mit `composeCallbacks` aus
`@rebasepro/server` und `declared` als den eigenen `callbacks` der Collection. Siehe
[Callback-Sets kombinieren](/docs/collections/callbacks/#combining-callback-sets).

### Ohne Job-Queue

Lassen Sie `jobQueue` weg — oder arbeiten Sie mit einem Treiber ohne SQL, bei dem das Backend keine hat —, und die
Zustellungen werden im Arbeitsspeicher in die Warteschlange gestellt, in dem Prozess, der die Änderung vorgenommen hat. Das ist einfacher, und es
reicht für eine Benachrichtigung, die Sie sich leisten können zu verlieren:

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

Halten Sie den Dispatcher aus der Collection-Datei selbst heraus. Eine Collection-Datei wird auch im
Admin, im Browser, gebündelt: Der Build entfernt ihre Callbacks, aber ein Dispatcher, der oben in der Datei erstellt wird,
und sein `@rebasepro/server`-Import würden an jeden Besucher ausgeliefert und den Admin-Build scheitern lassen.

Ein Absturz oder ein Deploy zwischen dem Commit und der Zustellung verliert das Ereignis. Jeder Webhook hat seine eigene
Warteschlange, sodass ein ausgefallener Empfänger nur seine eigenen Zustellungen verzögert, nie die eines anderen Webhooks.
<span class="since-badge" data-since="0.25">Seit 0.25</span> Die Warteschlange jedes Webhooks hält höchstens
10.000 wartende Zustellungen; solange sie voll ist, wird eine neue Zustellung abgelehnt und an `onDelivery` gemeldet,
mit `success: false`, `statusCode: 0`, `attemptNumber: 0` und `responseBody: "queue full"`, und
das Server-Log sagt es einmal. Rufen Sie beim Herunterfahren `await dispatcher.flush(10_000)` auf: Es wartet auf das, was
in der Warteschlange steht, und liefert `false`, wenn das Budget zuvor aufgebraucht ist, weil ein ausgefallener Empfänger
jede seiner Zustellungen bis zu ~36 Sekunden lang mit Wiederholungen festhalten kann.

### Was der Empfänger erhält

Jede Zustellung ist ein `POST` mit einem JSON-Body und diesen Headern:

| Header | Wert |
| --- | --- |
| `X-Webhook-Id` | Die `id` des Webhooks |
| `X-Webhook-Event` | `INSERT`, `UPDATE` oder `DELETE` |
| `X-Webhook-Delivery` | Eine ID pro Zustellung, bei jedem Versuch dieselbe |
| `X-Webhook-Attempt` | Welcher Versuch dies ist, ab `1` |
| `X-Webhook-Signature` | `sha256=` und der Hex-HMAC-SHA256 des rohen Bodys, mit dem `secret` des Webhooks als Schlüssel (nur wenn er eines hat) |

Zustellungen sind at-least-once: Ein Empfänger, der zu langsam geantwortet hat, oder ein Worker, der nach dem
`POST` gestorben ist, bedeutet, dass dieselbe Zustellung erneut ankommt. Deduplizieren Sie über `X-Webhook-Delivery`, und prüfen Sie die
Signatur über den Body genau so, wie er ankam — bevor Sie ihn parsen:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function isSignedByRebase(rawBody: string, header: string | null, secret: string): boolean {
    const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
    const received = Buffer.from(header ?? "");
    return received.length === expected.length && timingSafeEqual(received, expected);
}
```

### Einen Endpunkt direkt aufrufen

Wenn Sie einen handgebauten Body an einen einzelnen Endpunkt senden und den Dispatcher nicht
wollen, gelten dieselben zwei Regeln — begrenzen Sie die Anfrage, und lassen Sie ihren Fehlschlag
niemals den Aufrufer erreichen:

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

Geben Sie niemals eine URL aus Ihrer Datenbank an ein nacktes `fetch`. Der Dispatcher lehnt
Loopback-, Link-Local- und private Ziele sowie andere Schemata als `http(s)` ab, bevor er sich
verbindet, und folgt keinen Weiterleitungen — genau deshalb, weil eine gespeicherte URL eine von
Angreifern kontrollierte Eingabe ist.
<span class="since-badge" data-since="0.25">Seit 0.25</span> Unter Node beurteilt er die Adresse, zu der jede
Verbindung tatsächlich aufgebaut wird, innerhalb des eigenen DNS-Lookups der Verbindung, sodass ein Name, dessen Eintrag
sich zwischen einer Prüfung und der Verbindung ändert, nicht daran vorbeischlüpfen kann; der Name eines Empfängers wird
einmal pro Verbindung aufgelöst, nicht einmal pro Zustellung.

## Synchronisation mit externer API

`afterDelete` erhält die gelöschte Zeile flach, als `row` — die Spalten der Tabelle, nicht einen Entity-Wrapper.

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

## Fehlerbehandlung

`afterSaveError` läuft, wenn das Speichern — oder irgendein `afterSave`-Callback — eine Exception
wirft. Es ist ein Benachrichtigungs-Hook, keine Rettung: Die Transaktion wird zurückgerollt, die Zeile
wird nicht gespeichert, und **der Fehler wird danach erneut geworfen**. Bei einem Request läuft er, sobald
das Zurückrollen abgeschlossen ist, außerhalb der fehlgeschlagenen Transaktion, sodass eine Zustellung, die
er an die Queue des Dispatchers übergibt, erhalten bleibt, statt mit dem Schreibvorgang zurückgerollt zu werden.

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

Wenn ein Fehlschlag den Nutzer *nicht* seinen Schreibvorgang kosten soll, darf er nicht aus
`afterSave` herausfliegen — fangen Sie ihn dort, oder übergeben Sie die Arbeit der Warteschlange des
Dispatchers.

## Nächste Schritte

- **[Entity-Callbacks](/docs/collections/callbacks)** — Vollständige Callback-Referenz
- **[Blog-CMS-Rezept](/docs/recipes/blog-cms)** — Vollständiges Blog-Beispiel
