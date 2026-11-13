---
sourceHash: 78888eb91334da42
title: Laufzeit-Portabilität
sidebar_label: Laufzeit-Portabilität
description: Was eine Custom Function importiert, entscheidet darüber, ob sie außerhalb eines Node-Prozesses ausgeführt werden kann – was portabel ist, was Node-exklusiv ist und wie rebase build und rebase doctor dies melden.
---

Eine Custom Function ist eine Hono-App, und Hono läuft auf jeder JavaScript-Server-Runtime. Ob *Ihre* Funktion woanders als in einem Node-Prozess laufen kann, hängt daher davon ab, was ihre eigene Datei importiert und verwendet.

Nichts davon schränkt ein, was Sie heute schreiben können. Jedes Rebase-Deployment ist ein Node-Prozess; eine Funktion, die eine Datei liest oder einen Socket öffnet, ist eine vollkommen einwandfreie Funktion, und kein Build oder Deployment schlägt deswegen fehl. Dies ist dokumentiert, damit die Antwort bereits jetzt bekannt ist und nicht erst später für jede Datei einzeln herausgefunden werden muss.

**Portabel – funktioniert auf jeder Runtime:**

- Alles, was aus `@rebasepro/server/functions` exportiert wird
- `getDriver(c)` und `rebase.dataAsAdmin` – beide kommunizieren über dieselbe Verbindung, egal wo sie laufen
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` – die Web-Plattform
- Jede Abhängigkeit, die kein Node benötigt

**Node-exklusiv:**

- `rebase.sql()` – die Datenbank-Owner-Verbindung ist ein TCP-Socket
- Ein direkt importierter Drizzle- oder `pg`-Client aus demselben Grund
- Integrierte Node-Module: `fs`, `path`, `crypto` (das Node-Modul – `globalThis.crypto` ist portabel), `child_process`, …
- Pakete, die darauf aufbauen: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Latente Bugs auf jeder Runtime** – diese sollten in jedem Fall behoben werden:

- Das Lesen von `process.env` auf Modulebene (siehe [Konfiguration und Secrets](/docs/backend/custom-functions/#configuration-and-secrets))
- Fire-and-Forget-Promises anstelle von [`waitUntil`](/docs/backend/custom-functions/#background-work)
- Sich darauf zu verlassen, dass ein Handler weiterläuft, nachdem sein Request ein Timeout erreicht hat. Unter Node tut er das; dies ist eine Eigenschaft des Prozesses, keine Zusicherung des Frameworks

## Eigene Funktionen überprüfen

`rebase build` gibt pro relevantem Befund eine Zeile aus und erfasst das Ergebnis pro Funktion im Bundle-Manifest:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` meldet dasselbe, ohne einen Build durchzuführen.

## Wenn Sie einen Runtime-spezifischen Pfad benötigen

`runtimeKey()` gibt `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` oder `"other"` zurück; `isNodeRuntime()` ist die gängige Prüfung. Verwenden Sie diese, um Funktionalität kontrolliert herabzusetzen (Graceful Degradation), nicht um eine Implementierung aufzuspalten – eine Funktion, die zwei Implementierungen erfordert, sind zwei Funktionen.

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
