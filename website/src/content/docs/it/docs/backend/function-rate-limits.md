---
sourceHash: bbe811696d5a81cb
title: Rate limit nelle funzioni
sidebar_label: Rate limit nelle funzioni
description: "rateLimit e checkRateLimit per le funzioni personalizzate: risposte 429 con Retry-After, conteggiate nello store del backend in modo che le repliche condividano una singola soglia."
---

Per una route che comporta un costo per chiamata (un'API a pagamento, un'email, una notifica), `rateLimit` è un middleware che risponde con `429` e `Retry-After`, mentre `checkRateLimit` prende decisioni all'interno di un handler, usando qualsiasi chiave:

```typescript
import { defineFunction, rateLimit, checkRateLimit } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post("/invite", rateLimit({ name: "invite", limit: 40, windowMs: 3_600_000 }), (c) => c.json({ ok: true }));
    app.post("/speak", async (c) => {
        const { allowed } = await checkRateLimit(c, { name: "speak", limit: 200, windowMs: 86_400_000, key: c.req.query("room") });
        return allowed ? c.json({ ok: true }) : c.json({ error: "limit reached" }, 429);
    });
});
```

I conteggi risiedono dove il backend memorizza i propri: per processo per impostazione predefinita, condivisi tra le repliche con `REBASE_RATE_LIMIT_STORE=sql` (vedere [Configurazione](/docs/getting-started/configuration/) ed [Esecuzione di istanze multiple](/docs/deployment/multiple-instances/)). Una `Map` nell'ambito del modulo conta sempre e solo per processo. La chiave predefinita, `clientAddress(c)`, segue `TRUSTED_PROXY_HOPS`, mai un header specificato dal chiamante.

Per scoprire tutto ciò che può fare una funzione, consultare [Funzioni personalizzate](/docs/backend/custom-functions/).
