---
sourceHash: 137350d3f13ed7f5
title: Hintergrundarbeiten
sidebar_label: Hintergrundarbeiten
description: "Arbeit ausführen, nachdem eine Custom Function geantwortet hat: waitUntil, was der Host beim Herunterfahren damit macht und was ohne es verloren geht."
---

Arbeiten, die über die Antwort hinaus fortgeführt werden sollen, gehören in `waitUntil`:

```typescript
import { defineFunction, requireAuth, waitUntil } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/orders", requireAuth, async (c) => {
        const order = await c.req.json();
        // The caller does not wait for this, but shutdown does.
        waitUntil(c, rebase.email.send({
            to: "warehouse@example.com",
            subject: "New order",
            html: "<p>Pick and pack</p>"
        }));
        return c.json({ received: true });
    });
});
```

Ein Promise ohne `await` sieht gleichwertig aus, ist es aber nicht. `waitUntil` bietet zwei Vorteile:

- **Unter Node** wird das Promise nachverfolgt, sodass ein Graceful Shutdown darauf wartet, anstatt dass der Prozess während eines halb gesendeten Webhooks beendet wird. Ein ungebundenes Promise geht bei `SIGTERM` einfach verloren.
- **Auf einem isolationsbasierten Host (Isolates)** wird der Host angewiesen, das Isolate am Leben zu erhalten, bis das Promise abgeschlossen ist. Ohne dies wird die Arbeit in dem Moment abgebrochen, in dem die Response aufgelöst wird – stillschweigend mit einem sauberen 200er-Status in den Logs.

Eine Rejection wird protokolliert, anstatt dem Handler für unbehandelte Rejections überlassen zu werden, sodass ein Fehler die Route benennt, von der er ausging.

Code, der außerhalb einer Anfrage ausgeführt wird, hat kein `c`, das übergeben werden könnte: ein Initialisierer auf Modulebene, ein Helper, den sich Routen und Cron-Jobs teilen, oder Arbeit, die ein Cron-Lauf startet und auf die er nicht wartet. Übergib `waitUntil` die Arbeit allein:

```typescript no-verify
import { waitUntil } from "@rebasepro/server/functions";

let ready: Promise<void> | undefined;

export function ensureCatalogue(): Promise<void> {
    ready ??= loadCatalogue().then(() => {
        // No request to attach it to, but shutdown still waits for it.
        waitUntil(rateNewSongs());
    });
    return ready;
}
```

Die Arbeit wird für einen Graceful Shutdown nachverfolgt und eine Rejection wird protokolliert, genau wie mit `c`. Was sie nicht tun kann, ist, ein Isolate am Leben zu erhalten, da dies der Ausführungskontext der Anfrage ist: Übergib immer `c`, wenn eine Anfrage vorliegt. Arbeit, die ein Cron-Lauf, ein Job oder ein Queue-Handler einfach `await`en kann, sollte stattdessen erwartet werden; der Lauf selbst ist das, worauf der Shutdown wartet, und dessen Ergebnis wird damit aufgezeichnet.

Der Shutdown wartet maximal 5 Sekunden auf diese Arbeit. Arbeiten, die Minuten dauern, gehören in einen [Cron-Job](/docs/backend/cron-jobs/) oder einen [Job](/docs/backend/jobs/), welche protokolliert und neu startbar sind. Ein Cron-Job läuft zudem [instanzübergreifend immer nur einzeln](/docs/backend/cron-across-instances/#concurrency-guarding), unabhängig davon, ob er über den Zeitplan oder einen manuellen Trigger gestartet wurde.
