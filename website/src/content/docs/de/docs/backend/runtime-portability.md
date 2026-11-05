---
sourceHash: 088ee76c9513e196
title: Portabilität der Laufzeitumgebung
sidebar_label: Portabilität der Laufzeitumgebung
description: Was eine eigene Funktion importiert, entscheidet, ob sie außerhalb eines Node-Prozesses laufen könnte – was portabel ist, was nur unter Node läuft und wie rebase build und rebase doctor es melden.
---

Eine Custom Function ist eine Hono-App, und Hono läuft auf jeder JavaScript-Server-Laufzeitumgebung. Ob *Ihre* Funktion außerhalb eines Node-Prozesses laufen kann, hängt davon ab, was ihre eigene Datei importiert und verwendet.

Nichts davon schränkt ein, was Sie heute schreiben können. Jedes Rebase-Deployment ist ein Node-Prozess; eine Funktion, die eine Datei liest oder einen Socket öffnet, ist völlig legitim, und kein Build oder Deployment schlägt deswegen fehl. Dies ist dokumentiert, damit die Antwort bereits jetzt bekannt ist und nicht später dateiweise ermittelt werden muss.

**Portabel — funktioniert auf jeder Laufzeitumgebung:**

- Alles, was aus `@rebasepro/server/functions` exportiert wird
- `getDriver(c)` und `rebase.dataAsAdmin` — beide kommunizieren unabhängig von der Umgebung über dieselbe Schnittstelle
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — Web-Standards
- Jede Abhängigkeit, die kein Node erfordert

**Nur unter Node:**

- `rebase.sql()` — die Owner-Verbindung zur Datenbank ist ein TCP-Socket
- Ein direkt importierter Drizzle-/`pg`-/`mongodb`-Client aus demselben Grund
- Node-eigene Module: `fs`, `path`, `crypto` (das Node-Modul — `globalThis.crypto` ist portabel), `child_process`, …
- Darauf aufbauende Pakete: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Latente Fehler auf jeder Laufzeitumgebung** — diese sollten in jedem Fall behoben werden:

- `process.env`-Zugriffe auf Modulebene (siehe [Konfiguration und Secrets](/docs/backend/custom-functions/#configuration-and-secrets))
- Fire-and-Forget-Promises anstelle von [`waitUntil`](/docs/backend/custom-functions/#background-work)
- Sich darauf zu verlassen, dass ein Handler nach dem Timeout seiner Anfrage weiterläuft. Unter Node tut er das; das ist jedoch eine Eigenschaft des Prozesses, keine Garantie des Frameworks

## Eigene Funktionen überprüfen

`rebase build` gibt für jeden relevanten Befund eine Zeile aus und vermerkt das Ergebnis pro Funktion im Bundle-Manifest:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` meldet dasselbe, ohne dass ein Build erforderlich ist.

## Wenn Sie einen laufzeitspezifischen Pfad benötigen

`runtimeKey()` gibt `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` oder `"other"` zurück; `isNodeRuntime()` ist die gängige Prüfung. Nutzen Sie diese für Fallbacks, nicht um eine Implementierung zu forken — eine Funktion, die zwei Implementierungen erfordert, sind eigentlich zwei Funktionen.

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
