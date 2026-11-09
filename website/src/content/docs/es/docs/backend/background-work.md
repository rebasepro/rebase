---
sourceHash: 137350d3f13ed7f5
title: Trabajo en segundo plano
sidebar_label: Trabajo en segundo plano
description: "Ejecuta trabajo después de que una función personalizada haya respondido: waitUntil, qué hace el host con él al apagarse y qué se pierde sin él."
---

Las tareas que deban continuar tras emitir la respuesta van en `waitUntil`:

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

Una promesa a la que no se le aplica `await` parece equivalente pero no lo es. `waitUntil` aporta dos ventajas:

- **En Node**, se hace un seguimiento de la promesa, por lo que un apagado suave (graceful shutdown) la espera en lugar de que el proceso termine interrumpiendo un webhook a medio enviar. Una promesa flotante durante un `SIGTERM` simplemente se pierde.
- **En un entorno basado en aislados (isolates)**, se le indica al entorno que mantenga vivo el aislado hasta que la promesa se resuelva. Sin esto, la tarea se descarta en el instante en que se resuelve la respuesta —silenciosamente, con un 200 limpio en los registros.

Cualquier rechazo de promesa se registra en los logs en lugar de dejarse en manos del manejador de rechazos no controlados, por lo que un fallo indica la ruta de la que provino.

El código que se ejecuta fuera de cualquier petición no dispone de un `c` para pasar: un inicializador a nivel de módulo, un helper compartido entre rutas y crons, o una tarea que una ejecución cron inicia y no espera. Pasa a `waitUntil` la tarea directamente:

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

Se realiza un seguimiento de la tarea para el apagado ordenado y cualquier rechazo se registra, al igual que con `c`. Lo que no puede hacer es mantener vivo un aislado, porque ese es el contexto de ejecución de la petición: pasa `c` siempre que haya una petición. El trabajo al que una ejecución cron, un job o un manejador de colas simplemente puede hacerle `await` debería esperarse de ese modo; la ejecución es lo que el apagado espera, y su resultado se registra junto con ella.

El apagado espera como máximo 5 segundos para este trabajo. Las tareas que tarden minutos corresponden a un [cron job](/docs/backend/cron-jobs/) o a un [job](/docs/backend/jobs/), los cuales quedan registrados y se pueden reiniciar. Un cron job además se ejecuta de forma [unitaria entre instancias](/docs/backend/cron-across-instances/#concurrency-guarding), tanto si lo inició la programación como un disparador manual.
