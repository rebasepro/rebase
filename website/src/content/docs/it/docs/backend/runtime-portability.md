---
sourceHash: 78888eb91334da42
title: Portabilità del runtime
sidebar_label: Portabilità del runtime
description: "Ciò che una funzione personalizzata importa determina se può essere eseguita al di fuori di un processo Node: cosa è portabile, cosa è solo per Node e come rebase build e rebase doctor lo segnalano."
---

Una funzione personalizzata è un'app Hono, e Hono può essere eseguito su qualsiasi runtime server JavaScript. Se la *tua* funzione possa essere eseguita altrove rispetto a un processo Node dipende quindi da ciò che il suo file importa e tocca.

Nulla di quanto riportato qui rappresenta una limitazione su ciò che puoi scrivere oggi. Ogni deployment di Rebase è un processo Node, una funzione che legge un file o apre un socket è una funzione perfettamente valida, e nessuna build o deploy fallirà a causa di questo. È documentato affinché la risposta sia nota fin da subito, anziché essere scoperta file per file in seguito.

**Portabile — funziona su qualsiasi runtime:**

- Tutto ciò che viene esportato da `@rebasepro/server/functions`
- `getDriver(c)` e `rebase.dataAsAdmin` — entrambi viaggiano sulla stessa connessione ovunque vengano eseguiti
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la piattaforma web
- Qualsiasi dipendenza che non richieda Node

**Solo per Node:**

- `rebase.sql()` — la connessione del proprietario del database è un socket TCP
- Un client Drizzle o `pg` importato direttamente, per lo stesso motivo
- Moduli integrati di Node: `fs`, `path`, `crypto` (il modulo Node — `globalThis.crypto` è portabile), `child_process`, …
- Pacchetti basati su di essi: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bug latenti su qualsiasi runtime** — vale la pena risolverli a prescindere:

- `process.env` letto nello scope del modulo (vedi [Configurazione e segreti](/docs/backend/custom-functions/#configuration-and-secrets))
- Promise di tipo fire-and-forget invece di [`waitUntil`](/docs/backend/custom-functions/#background-work)
- Fare affidamento su un handler che continua a essere eseguito dopo che la sua richiesta è andata in timeout. Su Node ciò accade; si tratta di una proprietà del processo, non di una garanzia offerta dal framework

## Verificare le proprie funzioni

`rebase build` stampa una riga per ogni segnalazione utile e registra il verdetto per ciascuna funzione nel manifest del bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` segnala la stessa cosa senza eseguire la build.

## Se hai bisogno di un percorso specifico per il runtime

`runtimeKey()` restituisce `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` o `"other"`; `isNodeRuntime()` è il controllo standard. Usali per degradare il comportamento, non per biforcare un'implementazione — una funzione che necessita di due implementazioni è di fatto costituita da due funzioni.

```typescript
import { defineFunction, isNodeRuntime } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", async (c) => {
        if (!isNodeRuntime()) return c.json({ error: "Not available here" }, 501);
        const rows = await rebase.sql("SELECT count(*) AS total FROM jobs");
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```
