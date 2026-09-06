---
sourceHash: 713d80a42d70ff87
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
zurück — der POST passiert, nachdem der Callback zurückgekehrt ist, außerhalb der Transaktion — und
der Dispatcher validiert das Ziel, signiert die Nutzlast, begrenzt jeden Versuch mit einer Frist und
wiederholt Fehlschläge.

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

Die Warteschlange liegt im Prozess und im Speicher: ein Absturz oder ein Deploy zwischen dem
Einreihen und der Zustellung verliert das Ereignis, und der Empfänger sieht die Benachrichtigung
womöglich einige Millisekunden, bevor die Zeile committet ist. Rufen Sie beim Herunterfahren
`await dispatcher.flush()` auf. Sollen Zustellungen einen Neustart überleben, schreiben Sie eine
Outbox-Zeile in derselben Transaktion und leeren Sie sie aus einem Job.

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
wirft. Es ist ein Benachrichtigungs-Hook, keine Rettung: **der Fehler wird danach erneut geworfen**,
die Transaktion wird zurückgerollt und die Zeile wird nicht gespeichert.

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

---
