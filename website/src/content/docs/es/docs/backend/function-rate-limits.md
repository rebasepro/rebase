---
sourceHash: bbe811696d5a81cb
title: Límites de tasa en funciones
sidebar_label: Límites de tasa en funciones
description: "rateLimit y checkRateLimit para funciones personalizadas: respuestas 429 con Retry-After, contabilizadas en el propio almacén del backend para que las réplicas compartan una misma cuota."
---

Para una ruta que tiene un coste por llamada (una API de pago, un correo electrónico, una notificación), `rateLimit` es un middleware que responde con `429` y `Retry-After`, y `checkRateLimit` toma la decisión dentro de un controlador, usando cualquier clave:

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

Los conteos residen donde el backend almacena los suyos: por proceso de forma predeterminada, compartidos entre réplicas con `REBASE_RATE_LIMIT_STORE=sql` (consulta [Configuración](/docs/getting-started/configuration/) y [Ejecutar múltiples instancias](/docs/deployment/multiple-instances/)). Un `Map` en el ámbito del módulo solo cuenta por proceso. La clave predeterminada, `clientAddress(c)`, sigue a `TRUSTED_PROXY_HOPS`, nunca una cabecera escrita por quien realiza la llamada.

Para conocer el resto de posibilidades que ofrece una función, consulta [Funciones personalizadas](/docs/backend/custom-functions/).
