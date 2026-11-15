---
sourceHash: bbe811696d5a81cb
title: Limites de taxa em funções
sidebar_label: Limites de taxa em funções
description: "rateLimit e checkRateLimit para funções customizadas: 429s com Retry-After, contabilizados no próprio armazenamento do backend para que réplicas compartilhem uma cota."
---

Para uma rota que tem algum custo por chamada (uma API paga, um e-mail, uma notificação), `rateLimit` é um middleware que responde `429` com `Retry-After`, e `checkRateLimit` toma a decisão dentro de um handler, com base em qualquer chave:

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

As contagens ficam armazenadas onde o backend mantém as suas: por processo por padrão, compartilhadas entre réplicas com `REBASE_RATE_LIMIT_STORE=sql` (consulte [Configuração](/docs/getting-started/configuration/) e [Executando múltiplas instâncias](/docs/deployment/multiple-instances/)). Um `Map` no escopo do módulo sempre conta apenas por processo. A chave padrão, `clientAddress(c)`, segue `TRUSTED_PROXY_HOPS`, nunca um cabeçalho definido pelo chamador.

Para o restante do que uma função pode fazer, consulte [Funções customizadas](/docs/backend/custom-functions/).
