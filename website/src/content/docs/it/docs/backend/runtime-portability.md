---
sourceHash: 088ee76c9513e196
title: Portabilità del runtime
sidebar_label: Portabilità del runtime
description: Ciò che una funzione personalizzata importa decide se potrebbe girare fuori da un processo Node — cosa è portabile, cosa funziona solo su Node e come lo segnalano rebase build e rebase doctor.
---

Una funzione personalizzata è un'app Hono, e Hono può essere eseguito su qualsiasi runtime server JavaScript. La possibilità che la *tua* funzione possa essere eseguita altrove rispetto a un processo Node dipende quindi da cosa il suo file importa e utilizza.

Nulla di quanto descritto rappresenta una limitazione a ciò che puoi scrivere oggi. Ogni deployment di Rebase è un processo Node, una funzione che legge un file o apre un socket è una funzione perfettamente valida, e nessuna build o deploy fallirà per queste ragioni. Questo è documentato affinché la compatibilità sia chiara fin da subito, anziché doverla scoprire file per file in seguito.

**Portabile — funziona su qualsiasi runtime:**

- Tutto ciò che viene esportato da `@rebasepro/server/functions`
- `getDriver(c)` e `rebase.dataAsAdmin` — entrambi comunicano tramite la stessa connessione ovunque vengano eseguiti
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la piattaforma web standard
- Qualsiasi dipendenza che non richieda Node

**Solo per Node:**

- `rebase.sql()` — la connessione owner al database è un socket TCP
- Un client Drizzle/`pg`/`mongodb` importato direttamente, per lo stesso motivo
- Moduli nativi di Node: `fs`, `path`, `crypto` (il modulo Node — `globalThis.crypto` è portabile), `child_process`, …
- Pacchetti basati su di essi: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bug latenti su qualsiasi runtime** — vale la pena risolverli a prescindere:

- Lettura di `process.env` a livello di modulo (vedi [Configurazione e segreti](/docs/backend/custom-functions/#configuration-and-secrets))
- Promise "fire-and-forget" invece di [`waitUntil`](/docs/backend/custom-functions/#background-work)
- Fare affidamento sull'esecuzione continua di un handler dopo il timeout della richiesta. Su Node ciò accade; è una caratteristica del processo, non una garanzia offerta dal framework

## Verificare le proprie funzioni

`rebase build` stampa una riga per ogni segnalazione rilevante e registra l'esito per ciascuna funzione nel manifest del bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` segnala le stesse informazioni senza eseguire la build.

## Se hai bisogno di un percorso specifico per il runtime

`runtimeKey()` restituisce `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` o `"other"`; `isNodeRuntime()` è il controllo più comune. Usali per degradare gradualmente le funzionalità, non per ramificare un'implementazione — una funzione che richiede due implementazioni è in realtà costituita da due funzioni distinte.

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
