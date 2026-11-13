---
sourceHash: 78888eb91334da42
title: Portabilidad del runtime
sidebar_label: Portabilidad del runtime
description: "Lo que importa una función personalizada decide si podría ejecutarse fuera de un proceso de Node: qué es portable, qué es exclusivo de Node y cómo lo reportan rebase build y rebase doctor."
---

Una función personalizada es una aplicación de Hono, y Hono se ejecuta en cualquier runtime de JavaScript para servidor. El hecho de que *tu* función pueda ejecutarse en un entorno distinto a un proceso de Node se reduce, por tanto, a lo que su propio archivo importa y utiliza.

Nada de lo que se describe aquí es una restricción sobre lo que puedes escribir hoy. Cada despliegue de Rebase es un proceso de Node, una función que lee un archivo o abre un socket es una función perfectamente válida, y ninguna compilación o despliegue fallará debido a nada de esto. Está documentado aquí para que la respuesta se conozca de antemano en lugar de descubrirse archivo por archivo más adelante.

**Portable — funciona en cualquier runtime:**

- Todo lo exportado desde `@rebasepro/server/functions`
- `getDriver(c)` y `rebase.dataAsAdmin` — ambos se transmiten por el mismo canal dondequiera que se ejecuten
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la plataforma web
- Cualquier dependencia que no requiera Node

**Solo para Node:**

- `rebase.sql()` — la conexión del propietario de la base de datos es un socket TCP
- Un cliente de Drizzle o `pg` importado directamente, por la misma razón
- Módulos integrados de Node: `fs`, `path`, `crypto` (el módulo de Node; `globalThis.crypto` es portable), `child_process`, …
- Paquetes construidos sobre ellos: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Errores latentes en cualquier runtime** — vale la pena corregirlos en cualquier caso:

- `process.env` leído en el ámbito del módulo (consulta [Configuración y secretos](/docs/backend/custom-functions/#configuration-and-secrets))
- Promesas *fire-and-forget* en lugar de [`waitUntil`](/docs/backend/custom-functions/#background-work)
- Depender de que un manejador continúe ejecutándose después de que su solicitud haya agotado el tiempo de espera. En Node lo hace; esa es una propiedad del proceso, no una garantía que ofrezca el framework

## Comprobar tus propias funciones

`rebase build` imprime una línea por cada hallazgo accionable y registra el veredicto por función en el manifiesto del paquete:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` reporta lo mismo sin compilar.

## Si necesitas una ruta específica según el runtime

`runtimeKey()` devuelve `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` u `"other"`; `isNodeRuntime()` es la comprobación habitual. Úsalos para degradar gradualmente, no para bifurcar una implementación: una función que necesita dos implementaciones son dos funciones.

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
