---
sourceHash: 137350d3f13ed7f5
title: Lavoro in background
sidebar_label: Lavoro in background
description: "Esegui lavoro dopo che una funzione personalizzata ha risposto: waitUntil, cosa ne fa l'host allo spegnimento e cosa si perde senza."
---

Il lavoro che deve proseguire oltre la risposta va inserito in `waitUntil`:

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

Una promise senza await sembra equivalente ma non lo è. `waitUntil` offre due vantaggi:

- **Su Node**, la promise viene tracciata, così che un arresto controllato (graceful shutdown) la attenda anziché terminare il processo lasciando ad esempio un webhook inviato a metà. Una promise fluttuante al momento del `SIGTERM` viene semplicemente persa.
- **Su un host basato su isolate**, l'host viene istruito a mantenere attivo l'isolate fino a quando la promise non si stabilizza. Senza di esso, l'elaborazione viene interrotta non appena la risposta viene risolta — silenziosamente, lasciando un codice 200 pulito nei log.

Un rifiuto (rejection) viene registrato nei log invece di essere lasciato al gestore delle rejection non gestite, consentendo di risalire al percorso da cui ha avuto origine il fallimento.

Il codice eseguito all'esterno di una richiesta non dispone di `c` da passare: un inizializzatore a livello di modulo, un helper condiviso tra route e cron, o un'attività avviata da un'esecuzione cron senza attenderne il completamento. Passa a `waitUntil` solo l'attività:

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

L'attività viene tracciata per il graceful shutdown e le eventuali rejection vengono registrate, proprio come con `c`. Ciò che non può fare è mantenere attivo un isolate, poiché quest'ultimo costituisce il contesto di esecuzione della richiesta: passa `c` ogniqualvolta sia presente una richiesta. Le attività che un'esecuzione cron, un job o un gestore di code possono semplicemente attendere con `await` dovrebbero essere attese; l'esecuzione è infatti ciò che la procedura di arresto attende e il relativo esito viene registrato insieme a essa.

L'arresto attende al massimo 5 secondi per questo lavoro. Le attività che richiedono minuti devono essere collocate in un [cron job](/docs/backend/cron-jobs/) o in un [job](/docs/backend/jobs/), che sono tracciati e riavviabili. Inoltre, un cron job viene eseguito [uno alla volta tra le varie istanze](/docs/backend/cron-across-instances/#concurrency-guarding), indipendentemente dal fatto che sia stato avviato dalla pianificazione o da un trigger manuale.
