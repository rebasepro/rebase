---
sourceHash: bbe811696d5a81cb
title: Limites de débit dans les fonctions
sidebar_label: Limites de débit dans les fonctions
description: "rateLimit et checkRateLimit pour les fonctions personnalisées : réponses 429 avec Retry-After, comptabilisées dans le propre stockage du backend afin que les réplicas partagent un même quota."
---

Pour une route qui engendre un coût par appel (une API payante, un e-mail, une notification), `rateLimit` est un middleware qui répond `429` avec `Retry-After`, et `checkRateLimit` prend la décision au sein d'un gestionnaire, basé sur la clé de votre choix :

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

Les compteurs résident là où le backend conserve les siens : par processus par défaut, ou partagés entre les réplicas avec `REBASE_RATE_LIMIT_STORE=sql` (voir [Configuration](/docs/getting-started/configuration/) et [Exécution de plusieurs instances](/docs/deployment/multiple-instances/)). Une `Map` dans la portée du module ne comptabilise toujours que par processus. La clé par défaut, `clientAddress(c)`, respecte `TRUSTED_PROXY_HOPS`, et jamais un en-tête défini par l'appelant.

Pour découvrir tout ce qu'une fonction peut faire d'autre, consultez [Fonctions personnalisées](/docs/backend/custom-functions/).
