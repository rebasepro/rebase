---
sourceHash: 088ee76c9513e196
title: Portabilidad en diferentes runtimes
sidebar_label: Portabilidad en diferentes runtimes
description: Lo que importa una función personalizada decide si podría ejecutarse fuera de un proceso de Node: qué es portable, qué es solo de Node y cómo lo informan rebase build y rebase doctor.
---

Una función personalizada es una app de Hono, y Hono se ejecuta en cualquier runtime de servidor de JavaScript. Por lo tanto, el hecho de que *tu* función pueda ejecutarse fuera de un proceso de Node depende de lo que su propio archivo importe y utilice.

Nada de lo mencionado aquí restringe lo que puedes escribir hoy. Todo despliegue de Rebase es un proceso de Node, una función que lee un archivo o abre un socket es perfectamente válida, y ninguna compilación o despliegue fallará por nada de esto. Se documenta para que la respuesta pueda conocerse desde ahora en lugar de descubrirse archivo por archivo más adelante.

**Portable — funciona en cualquier runtime:**

- Todo lo exportado desde `@rebasepro/server/functions`
- `getDriver(c)` y `rebase.dataAsAdmin` — ambos operan a través del mismo canal dondequiera que se ejecuten
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la plataforma web
- Cualquier dependencia que no requiera Node

**Exclusivo de Node:**

- `rebase.sql()` — la conexión de propietario de la base de datos es un socket TCP
- Un cliente de Drizzle/`pg`/`mongodb` importado directamente, por la misma razón
- Módulos integrados de Node: `fs`, `path`, `crypto` (el módulo de Node; `globalThis.crypto` es portable), `child_process`, …
- Paquetes construidos sobre ellos: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Errores latentes en cualquier runtime** — vale la pena corregirlos independientemente del entorno:

- Lectura de `process.env` en el ámbito del módulo (ver [Configuración y secretos](/docs/backend/custom-functions/#configuration-and-secrets))
- Promesas de tipo "disparar y olvidar" (fire-and-forget) en lugar de [`waitUntil`](/docs/backend/custom-functions/#background-work)
- Confiar en que un manejador continúe ejecutándose después de que su solicitud haya expirado. En Node lo hace; esa es una propiedad del proceso, no una garantía del framework

## Comprobar tus propias funciones

`rebase build` imprime una línea por cada hallazgo procesable y registra el veredicto por función en el manifiesto del bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` reporta lo mismo sin necesidad de compilar.

## Si necesitas una ruta específica según el runtime

`runtimeKey()` devuelve `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` u `"other"`; `isNodeRuntime()` es la comprobación habitual. Utilízalos para degradar funcionalidades, no para bifurcar una implementación — una función que necesita dos implementaciones son dos funciones.

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
