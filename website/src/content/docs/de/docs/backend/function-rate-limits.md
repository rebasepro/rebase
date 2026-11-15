---
sourceHash: bbe811696d5a81cb
title: Rate-Limits in Funktionen
sidebar_label: Rate-Limits in Funktionen
description: "rateLimit und checkRateLimit für benutzerdefinierte Funktionen: 429-Statuscodes mit Retry-After, gezählt im backend-eigenen Store, sodass Replikate ein gemeinsames Kontingent teilen."
---

Für eine Route, die pro Aufruf etwas kostet (eine kostenpflichtige API, eine E-Mail, eine Benachrichtigung), ist `rateLimit` eine Middleware, die mit `429` und `Retry-After` antwortet, und `checkRateLimit` entscheidet innerhalb eines Handlers, basierend auf einem beliebigen Schlüssel:

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

Zähler werden dort gespeichert, wo das Backend seine eigenen Daten verwaltet: standardmäßig pro Prozess, über Replikate hinweg geteilt mit `REBASE_RATE_LIMIT_STORE=sql` (siehe [Konfiguration](/docs/getting-started/configuration/) und [Ausführen mehrerer Instanzen](/docs/deployment/multiple-instances/)). Eine `Map` im Modul-Scope zählt immer nur pro Prozess. Der Standardschlüssel `clientAddress(c)` folgt `TRUSTED_PROXY_HOPS`, niemals einem vom Aufrufer gesetzten Header.

Für alles Weitere, was eine Funktion tun kann, siehe [Benutzerdefinierte Funktionen](/docs/backend/custom-functions/).
