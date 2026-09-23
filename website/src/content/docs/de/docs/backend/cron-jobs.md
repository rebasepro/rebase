---
sourceHash: bd5ebbaf6bff7eb9
title: Cron-Jobs
sidebar_label: Cron-Jobs
description: Planen Sie wiederkehrende Hintergrundaufgaben mit dem integrierten Cron-Job-System von Rebase. Definieren Sie Jobs als TypeScript-Dateien, überwachen Sie sie in Studio und verwalten Sie sie über die REST-API.
---

## Übersicht

Rebase enthält einen integrierten **Cron-Job-Scheduler** zum Ausführen wiederkehrender Hintergrundaufgaben – Datenbereinigung, Berichterstellung, Health-Checks, Synchronisierungen externer APIs und mehr.

Cron-Jobs folgen demselben **dateibasierten Discovery-Muster** wie benutzerdefinierte Funktionen: Legen Sie eine TypeScript-Datei in Ihrem Verzeichnis `crons/` ab, und Rebase registriert und plant sie automatisch.

- **Keine Abhängigkeiten** — Keine externen Scheduler-Bibliotheken erforderlich
- **Admin-API** — REST-Endpunkte zum Auflisten, Triggern, Aktivieren/Deaktivieren und Anzeigen von Logs
- **Studio-Dashboard** — Überwachen Sie alle Jobs, sehen Sie sich den Ausführungsverlauf an und lösen Sie Ausführungen manuell aus
- **Datenbankpersistenz** — Ausführungslogs werden in PostgreSQL gespeichert und überstehen Neustarts
- **In-Memory-Cache** — Schneller Ringpuffer (letzte 50 Ausführungen) für das Dashboard, gestützt durch die Datenbank

## Definieren eines Cron-Jobs

Erstellen Sie eine Datei in Ihrem Verzeichnis `backend/crons/`, die standardmäßig eine Cron-Definition exportiert. Verwenden Sie den `defineCron`-Helper aus `@rebasepro/server` für Typinferenz und Autovervollständigung:

```typescript
// backend/crons/health-check.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    schedule: "*/5 * * * *",     // every 5 minutes
    name: "System Health Check",
    description: "Monitors uptime and memory usage",

    async handler(ctx) {
        ctx.log("Running health check...");

        const uptime = process.uptime();
        const mem = process.memoryUsage();

        ctx.log(`Uptime: ${Math.round(uptime)}s`);
        ctx.log(`Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`);

        return {
            uptimeSeconds: Math.round(uptime),
            heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        };
    },
});
```

`rebase dev` überwacht das Crons-Verzeichnis, sodass ein Job, der während der Laufzeit hinzugefügt wird, beim nächsten Neuladen registriert wird – ganz ohne Neustart. (Er muss darauf hingewiesen werden: Das Verzeichnis wird gescannt statt importiert, daher kann der Watcher dies nicht ableiten.)

:::note
`defineCron` ist eine Identitätsfunktion – sie gibt dasselbe Objekt zurück, das Sie übergeben. Ein einfaches, per Default exportiertes `CronJobDefinition`-Objekt funktioniert identisch; `defineCron` bietet lediglich Typüberprüfung zur Kompilierzeit und Editor-Autovervollständigung.
:::

Der **Dateiname** (ohne Erweiterung) wird zur eindeutigen ID des Jobs – z. B. `health-check`.


## Konfiguration

:::note[Wo dies hingehört]
**Verwaltete Laufzeit** — legen Sie die Dateien in `backend/crons/` ab; die Laufzeit erkennt dieses Verzeichnis selbstständig, und `entry.crons` in `rebase.json` wird nur benötigt, wenn Sie es verschoben haben. `REBASE_CRON_SCHEDULER` in `.env` bestimmt, ob *dieser* Prozess die Timer ausführt.

**Ausgekoppelt (Ejected)** — `cronsDir` bei `initializeRebaseBackend({ … })`, wie unten gezeigt.

Die vollständige Übersicht finden Sie in der [Backend-Übersicht](/docs/backend/#where-each-option-lives).
:::

Aktivieren Sie Cron-Jobs, indem Sie `cronsDir` zu Ihrer Backend-Konfiguration hinzufügen:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

Das ist alles. Rebase wird:

1. Das Verzeichnis nach `.ts`- / `.js`-Dateien durchsuchen
2. Jeden Standardexport als Cron-Job registrieren
3. Die Tabellen `rebase.cron_logs`, `rebase.cron_claims` und `rebase.cron_job_state` in PostgreSQL automatisch erstellen (sofern der Treiber SQL unterstützt)
4. Den Scheduler starten und Zähler aus vorhandenen DB-Logs initialisieren
5. Admin-REST-Routen unter `/api/admin/cron` mounten

## Zeitplan-Syntax

Cron-Ausdrücke verwenden das standardmäßige **5-Felder-Format**:

```
┌───────────── minute (0–59)
│ ┌─────────── hour (0–23)
│ │ ┌───────── day of month (1–31)
│ │ │ ┌─────── month (1–12)
│ │ │ │ ┌───── day of week (0–6, Sunday = 0)
│ │ │ │ │
* * * * *
```

| Ausdruck | Bedeutung |
|------------|---------|
| `* * * * *` | Jede Minute |
| `0 * * * *` | Jede Stunde |
| `0 3 * * *` | Täglich um 03:00 Uhr |
| `0 0 * * 1` | Jeden Montag um Mitternacht |
| `0 9 1 * *` | Am ersten Tag jedes Monats um 09:00 Uhr |
| `0,30 * * * *` | Alle 30 Minuten (um :00 und :30) |
| `0 9-17 * * 1-5` | Stündlich, 09:00–17:00 Uhr, nur an Wochentagen |

Schrittwerte (`*/n`), Bereiche (`a-b`) und Listen (`a,b,c`) werden vollständig unterstützt.

Ein Zeitplan wird mit der Uhrzeit seiner Zeitzone abgeglichen. Bei einer Zeitumstellung bedeutet das: Ein Job mit fester Uhrzeit in der wiederholten Stunde (`30 2 * * *`, wo die Uhren um 03:00 zurückgestellt werden) läuft in beiden Durchgängen dieser Stunde, und einer in der übersprungenen Stunde, wenn die Uhren vorgestellt werden, läuft an diesem Tag nicht.

## CronJobDefinition-Referenz

`timezone` ist neu – in Version 0.17.3 wird ein Zeitplan immer in der Zone des Hosts selbst interpretiert. Alles andere an dieser Schnittstelle ist bereits veröffentlicht.

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // IANA zone the schedule is read in, e.g. "Europe/Madrid". Without it the
    // schedule is read in the host's own zone — UTC in nearly every container,
    // yours on a laptop — so name it. An unknown zone is refused when the job
    // loads rather than read as local time.
    timezone?: string;

    // Human-readable name shown in Studio
    name: string;

    // Optional description shown in Studio
    description?: string;

    // Whether the job runs (default: true). A pause or a resume from Studio
    // or the admin API overrides it, for every process, until reset.
    enabled?: boolean;

    // Max execution time in seconds (default: 300). Infinity means no
    // timeout; 0, a negative number or NaN is refused when the job loads.
    timeoutSeconds?: number;

    // How far back to look on startup for a slot that elapsed while no
    // instance was ticking (default: off). See "Cron across instances".
    catchUpWindowSeconds?: number;

    // The function to run on each tick
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

## Handler-Kontext

Jeder Handler erhält einen `CronJobContext`, der Hilfsmethoden und die Rebase-Client-Instanz enthält:

```typescript no-verify
interface CronJobContext {
    // The job's unique ID (derived from filename)
    jobId: string;

    // The scheduled tick timestamp
    scheduledAt: Date;

    // Logger — captured lines appear in Studio and the logs API
    log: (...args: unknown[]) => void;

    // Aborted when the run exceeds `timeoutSeconds`, or when a shutdown's
    // wait for it runs out
    signal: AbortSignal;

    // The server-side Rebase singleton — the same object `import { rebase }
    // from "@rebasepro/server"` returns, and the same one `defineFunction`
    // hands its callback.
    rebase: RebaseServerClient;
}
```

Verwenden Sie `ctx.log()`, um strukturierte Ausgaben zu erzeugen. Diese Zeilen werden im Ausführungslog erfasst und sind in Studio sowie über die REST-API sichtbar.

### `ctx.signal` — die Arbeit stoppen, wenn der Durchlauf endet

Das Timeout beendet den *Durchlauf*: Der Scheduler hört auf zu warten und zeichnet einen Fehler auf.
Es beendet nicht den Handler. Übergeben Sie `ctx.signal` an alles, was ein Signal akzeptiert, und die Arbeit stoppt damit:

```typescript no-verify
export default defineCron({
    name: "Sync inventory",
    schedule: "*/15 * * * *",
    timeoutSeconds: 60,
    async handler({ signal, log }) {
        const res = await fetch("https://supplier.example.com/stock", { signal });
        log(`fetched ${res.status}`);
    }
});
```

Ohne dies verliert ein Job, dessen Timeout seinem Intervall entspricht, einen verwaisten Request pro Tick – unsichtbar, da jeder Durchlauf bereits als fehlgeschlagen verbucht ist.

:::note[`ctx.client` wurde entfernt]
Es war ein zweiter Name für `ctx.rebase`, und sein Typ machte `client.data` erneut verfügbar – der Alias, den `RebaseServerClient` bewusst weglässt, damit die privilegierte Ebene genau einen Namen hat. Ein Entwickler, der `client.data` hier kennengelernt hat, übertrug es in einen Collection-Callback, wo `context.data` die *benutzerbezogene* Ebene ist: gleiche Schreibweise, gegenteilige Rechte. Verwenden Sie `ctx.rebase.dataAsAdmin`.
:::

### Interaktion mit der Datenbank und Diensten über `ctx.rebase`

`ctx.rebase.dataAsAdmin` ist die Data-Plane mit Admin-Berechtigungen. Ein Cron-Job hat keinen Benutzer pro Request, daher gibt es hier keine benutzerbezogene Alternative – schränken Sie die Filter jeder Abfrage selbst ein.

:::caution[Admin-Scope umgeht nicht RLS]
`dataAsAdmin` wird einmalig beim Start als `{ uid: "service", roles: ["admin"] }` festgelegt. Jeder Lese- und Schreibvorgang läuft weiterhin in einer Transaktion ab, die `SET LOCAL ROLE rebase_user` mit `app.uid = 'service'` ausgeführt hat, und **Ihre Richtlinien werden evaluiert** – gegen diese Identität. Es passiert die integrierten Standardrichtlinien über deren `rolesOverlap(['admin'])`-Zweig, weshalb der Unterschied selten auffällt. Er zeigt sich, wenn Sie eigene schreiben: `policy.serverContext()` wird zu `rebase.uid() IS NULL` kompiliert und ist daher hier **false**. Eine Collection mit `disableDefaultPolicies: true`, deren einzige Regel `serverContext()` ist, verweigert diese Schreibzugriffe und liefert null Zeilen zurück – HTTP 200, leer – für diese Lesevorgänge.

`rebase.sql()` *ist* ein bedingungsloser Bypass: Owner-Verbindung, keine Richtlinien.
:::

```typescript
// backend/crons/expire-users.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    schedule: "0 0 * * *", // Daily at midnight
    name: "Expire Inactive Accounts",
    
    async handler(ctx) {
        ctx.log("Checking for expired trial users...");

        // Fetch using the pre-initialized data driver. `collection<Row>(slug)`
        // gives the query builder the row type — `where` keys are checked
        // against it. Every filter is an `[operator, value]` tuple; a bare
        // value is passed straight through and builds a malformed query.
        const users = ctx.rebase.dataAsAdmin.collection<{
            id: string;
            email: string;
            trial_status: string;
            trial_ends_at: string;
            status: string;
        }>("users");

        const { data: trials } = await users.find({
            where: {
                trial_status: ["==", "active"],
                trial_ends_at: ["<", new Date().toISOString()]
            }
        });

        ctx.log(`Found ${trials.length} users with expired trials.`);

        for (const user of trials) {
            await users.update(user.id, {
                trial_status: "expired",
                status: "disabled"
            });
            
            // Send email notification using the Rebase email service
            await ctx.rebase.email.send({
                to: user.email,
                subject: "Your trial has expired",
                html: "<p>Please upgrade your subscription to continue.</p>"
            });
        }
    }
});
```

:::tip
Der Handler kann jeden JSON-serialisierbaren Wert zurückgeben. Dieser wird im Log-Eintrag als `result` gespeichert und im Ausführungsverlauf von Studio angezeigt.
:::

## REST-API

Alle Cron-Routen erfordern **Admin-Authentifizierung** (`requireAuth` + `requireAdmin`).

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/admin/cron` | Alle registrierten Cron-Jobs auflisten |
| `GET` | `/api/admin/cron/:id` | Status eines einzelnen Jobs abrufen |
| `POST` | `/api/admin/cron/:id/trigger` | Einen Job manuell auslösen — `409`, solange er bereits läuft |
| `GET` | `/api/admin/cron/:id/logs` | Ausführungsverlauf abrufen (`?limit=N`) |
| `PUT` | `/api/admin/cron/:id` | Einen Job überall pausieren oder fortsetzen (`{ "enabled": false }`); `null` folgt wieder dem Code |

### Beispiel: Alle Jobs auflisten

`$TOKEN` ist ein Admin-Zugriffstoken: Melden Sie sich an und verwenden Sie das `accessToken`, das die Login-Antwort zurückgibt. `$API_URL` ist das, was `rebase dev` ausgegeben hat – der Port wird vom Projektpfad abgeleitet, es gibt also keinen festen Port.

```bash
curl -H "Authorization: Bearer $TOKEN" "$API_URL/api/admin/cron"
```

```json
{
    "jobs": [
        {
            "id": "health-check",
            "name": "System Health Check",
            "schedule": "*/5 * * * *",
            "enabled": true,
            "state": "idle",
            "totalRuns": 12,
            "totalFailures": 0,
            "lastRunAt": "2026-04-24T08:15:00.000Z",
            "nextRunAt": "2026-04-24T08:20:00.000Z",
            "lastDurationMs": 3
        }
    ]
}
```

### Jobs, die nicht vorhanden sind

Ein Job, der nie ausgelöst wird, ist nicht in `jobs` enthalten – nichts hat ihn registriert. Daher sehen „Mein Cron fehlt“ und „Mein Cron wird nie ausgeführt“ an diesem Endpunkt identisch aus, es sei denn, er gibt etwas anderes an. Das tut er:

```json
{
    "jobs": [],
    "skipped": 2,
    "rejected": [
        {
            "id": "nightly-report",
            "name": "Nightly report",
            "schedule": "0 0 3 * * *",
            "reason": "Expected 5 fields, got 6"
        }
    ],
    "note": "1 cron file(s) failed to load and 1 job(s) have an invalid schedule — NOT scheduled. See `rejected` for the reason; the server log has the rest."
}
```

`rejected` nennt den Job und den Grund. Eine Datei, die beim *Laden* fehlgeschlagen ist, hat nur eine Zählung: Der Fehler trat auf, bevor ein Job benannt werden konnte, der Grund steht also im Server-Log.

Der häufigste Eintrag hier ist der obige – sechs Felder aus einem Ausdruck, der aus einem Tool kopiert wurde, das Sekunden unterstützt. Rebase akzeptiert fünf; entfernen Sie das führende Feld. Ein `timeoutSeconds` von null, eine negative Zahl oder `NaN` wird hier ebenfalls aufgeführt.

### Beispiel: Einen Job manuell auslösen

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/health-check/trigger"
```

Solange der Job läuft — hier oder in einem anderen Prozess —, lautet die Antwort
`409` mit dem Code `CRON_JOB_ALREADY_EXECUTING`; siehe [Concurrency Guarding](/docs/backend/cron-across-instances/#concurrency-guarding).

### Einen Job pausieren

<span class="since-badge" data-since="0.23">Since 0.23</span> Eine Pause aus Studio oder per
`PUT /api/admin/cron/:id` gilt für jeden Prozess und bleibt über Neustarts und
Redeploys hinweg bestehen; `{ "enabled": null }` gibt den Job an das `enabled`
zurück, das seine Datei deklariert. Wie jede Replik sie liest und was passiert,
wenn eine das nicht kann, steht unter
[Cron über mehrere Instanzen](/docs/backend/cron-across-instances/#pausing-a-job-across-every-process).

## Client-SDK

Das Rebase Client-SDK stellt einen `cron`-Namespace für alle Operationen bereit:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

// List all jobs
const { jobs } = await client.cron.listJobs();

// Get a single job
const { job } = await client.cron.getJob("health-check");

// Trigger manually
const { log, job: updated } = await client.cron.triggerJob("health-check");

// View execution history
const { logs } = await client.cron.getJobLogs("health-check", { limit: 10 });

// Enable or disable
await client.cron.toggleJob("health-check", false); // pause
await client.cron.toggleJob("health-check", true);  // resume
```

## Studio-Dashboard

Wenn Cron-Jobs konfiguriert sind, erscheint in Rebase Studio unter **Compute** neben der JS-Konsole ein Tool namens **Cron Jobs**. Das Dashboard bietet:

- **Job-Liste** — Alle registrierten Jobs mit Live-Statusanzeigen
- **Detail-Panel** — Zeitplan, nächste/letzte Ausführung, Dauer und Fehlerinformationen
- **Ausführungsverlauf** — Erweiterbare Log-Einträge mit erfassten Ausgaben und Ergebnissen
- **Manuelles Triggern** — Führen Sie jeden Job bei Bedarf mit einem Klick aus
- **Aktivieren/Deaktivieren** — Jobs pausieren und fortsetzen, ohne den Server neu zu starten, für alle Prozesse gleichzeitig; eine Pause bleibt über Neustarts und Deploys hinweg bestehen

Das Dashboard aktualisiert sich automatisch alle 15 Sekunden.

Das Panel zeigt dasselbe, egal welcher Prozess es ausliefert. Ein Job, den ein
anderer Prozess gerade ausführt, wird als laufend angezeigt, und auf einem
Prozess, dessen Scheduler nicht gestartet ist — der `api`-Rolle neben einem
Worker —, werden die Anzahl der Ausführungen, die Anzahl der Fehlschläge und die
letzte Ausführung aus `rebase.cron_logs` gelesen, mit einer Abfrage, die auf die
eigenen Zeilen jedes Jobs begrenzt ist, statt aus einem Prozess, der nichts
ausführt.

## Zeitplan-Validierung & AST-Parsing

Bei der Backend-Initialisierung parst Rebase alle registrierten Cron-Zeitpläne mithilfe eines abhängigkeitsfreien JS-basierten Cron-Expanders:
- **Syntaxprüfung**: Überprüft, ob der String genau 5 durch Leerzeichen getrennte Felder enthält (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Bereichsexpansion**: Löst Schritte (`*/15`), Bereiche (`9-17`) und kommagetrennte Listen (`0,30`) in explizite Arrays gültiger Ganzzahlen auf, die ihren jeweiligen Grenzen zugeordnet sind (z. B. Minuten `0-59`, Stunden `0-23`, Monate `1-12`).
- Wenn ein Cron-Ausdruck die Validierung nicht besteht, lehnt Rebase die Definition ab, protokolliert einen Startfehler und verweigert die Registrierung des Jobs, um Ausführungsfehler zur Laufzeit zu verhindern.

---

## Unter der Haube: Clock-Drift-Korrektur

Standardmäßige intervallbasierte Scheduler (wie `setInterval`) driften mit der Zeit ab und verursachen aufgrund von Verzögerungen bei der Event-Loop-Planung auf Betriebssystemebene erhebliche CPU-Spitzen. Um die Ausführungsgenauigkeit zu gewährleisten, implementiert Rebase eine **dynamische Zielzeitberechnungsschleife**:
1. **Kandidatenberechnung**: Nach Abschluss eines Jobs oder beim Starten des Schedulers berechnet Rebase den exakten Zeitstempel der *nächsten* passenden Kandidatenminute.
2. **Dynamischer Sleep**: Die Differenz in Millisekunden (`nextRun.getTime() - now.getTime()`) wird berechnet und ein einzelnes `setTimeout` geplant.
3. **Drift-Sicherheitsschwellenwert**: Ein Mindest-Sleep-Puffer (`MIN_SCHEDULE_INTERVAL_MS`) von **5.000 ms** wird erzwungen. Wenn ein Scheduler-Tick extrem schnell abgeschlossen ist, verhindert dieser Schwellenwert ein nahezu sofortiges doppeltes Auslösen.
4. **Shutdown-Freundlichkeit**: Timer-Handles werden mithilfe von `timer.unref()` explizit von der Node.js-Event-Loop entkoppelt, wodurch sichergestellt wird, dass Hintergrund-Cron-Scheduler saubere Prozessbeendigungen während Deployments nicht blockieren.

---

## Mehr als ein Prozess

Jeder Prozess, dessen Scheduler eingeschaltet ist, stellt dieselben Timer; die
Datenbank entscheidet, welcher von ihnen jeden Slot ausführt. Wie ein Slot genau
einmal läuft, wie ein Slot, den ein Neustart verloren hat, nachgeholt wird, wie
eine Pause jede Replik erreicht und warum ein manueller Trigger nie neben einer
geplanten Ausführung läuft, steht unter [Cron über mehrere Instanzen](/docs/backend/cron-across-instances).

---

## Timeouts & Fehlerisolation

- **Erzwungene Timeout-Race**: Ausführungsblöcke werden in ein `Promise.race` gegen einen Timeout-Timer gekapselt, der von `timeoutSeconds` abgeleitet ist (Standard: `300` Sekunden / 5 Minuten; `Infinity` für kein Timeout). Wenn der Handler diese Schwelle überschreitet, wird `ctx.signal` abgebrochen und das Promise rejected mit dem Fehler:
  `Error: Cron job "<id>" timed out after <N>ms`
  Der Abbruch ist der Teil, der die *Arbeit* stoppt; die Rejection beendet lediglich das Warten des Schedulers. Ein Handler, der `ctx.signal` ignoriert, läuft über seinen eigenen Durchlauf hinaus weiter.
- **Herunterfahren**: `backend.shutdown()` wartet auf eine laufende Ausführung, innerhalb desselben Budgets wie die Job-Warteschlange (zwei Drittel des Shutdown-Timeouts). Bei einer Ausführung, die danach noch läuft, wird `ctx.signal` abgebrochen, und sie wird mit dem Grund als fehlgeschlagen protokolliert. Ihr Slot bleibt beansprucht, sodass keine andere Instanz ihn erneut ausführt.
- **Fail-Safe Try/Catch**: Jeder Job-Handler läuft in einem isolierten Wrapper. Alle nicht abgefangenen Exceptions werden abgefangen, der Traceback des Fehlers in einen String formatiert, der Jobstatus auf `"error"` gesetzt und die Fehlerzähler in `rebase.cron_logs` aktualisiert. Ein Absturz innerhalb eines einzelnen Cron-Tasks bringt niemals die Scheduler-Schleife oder den primären Hono-HTTP-Webserver zum Absturz.
- **In-Memory-Ringpuffer**: Der Scheduler verwaltet einen Ringpuffer mit den letzten **50 Ausführungen** pro Job. Dieser Puffer wird im Speicher gehalten, um nahezu verzögerungsfreie Lesevorgänge aus Rebase Studio zu ermöglichen.

---

## Datenbankschema für Persistenz

Wenn Datenbank-Adapter mit SQL-Unterstützung (z. B. PostgreSQL) aktiv sind, richtet Rebase die Tabelle `rebase.cron_logs` ein:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.cron_logs (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id       TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ NOT NULL,
    duration_ms  INTEGER NOT NULL,
    success      BOOLEAN NOT NULL DEFAULT true,
    error        TEXT,                                 -- Stack trace or error message
    result       JSONB,                                -- Return value of handler
    logs         JSONB,                                -- Ring buffer array of ctx.log outputs
    manual       BOOLEAN NOT NULL DEFAULT false        -- True if triggered from Studio/REST
);

CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON rebase.cron_logs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_logs_job_failures ON rebase.cron_logs(job_id) WHERE NOT success;

CREATE TABLE IF NOT EXISTS rebase.cron_job_state (
    job_id         TEXT PRIMARY KEY,
    enabled        BOOLEAN,       -- NULL: follow the job's own `enabled`
    updated_at     TIMESTAMPTZ,   -- when `enabled` was last set, and by whom
    updated_by     TEXT,
    running_until  TIMESTAMPTZ,   -- the run lease: live while in the future
    running_by     TEXT
);
```

Jede davon wird beim Start erstellt, falls sie fehlt, sodass eine Datenbank,
die älter ist, sie beim nächsten Deploy erhält. Keine davon ist eine Collection,
und die Endbenutzerrolle `rebase_user` hat auf keiner davon Rechte: Ein
beschreibbares `cron_job_state` würde es einem angemeldeten Benutzer erlauben,
einen Job für alle zu pausieren oder seine Lease zu halten, sodass nichts ihn
ausführt.

Beim Start liest der Scheduler Statistiken aus dieser Tabelle über Aggregatabfragen (`COUNT(*)`, `SUM(CASE WHEN success = false THEN 1 ELSE 0 END)`), um die Historie für `totalRuns` und `totalFailures` zu füllen. Log-Einträge werden in einem nicht blockierenden, asynchronen Durchlauf geschrieben; schlägt ein Schreibvorgang in die Datenbank fehl, protokolliert der Scheduler den Fehler und setzt die normale Ausführung fort, wobei der In-Memory-Ringpuffer als Fallback dient.

## Beispiel: Täglicher Bereinigungsjob

```typescript
// backend/crons/cleanup-sessions.ts
import type { CronJobDefinition } from "@rebasepro/types";
import { rebase } from "@rebasepro/server";

const job: CronJobDefinition = {
    schedule: "0 3 * * *",  // daily at 3 AM
    name: "Cleanup Expired Sessions",
    description: "Removes user sessions older than 30 days",

    async handler(ctx) {
        ctx.log("Starting session cleanup...");

        // Admin-scoped data access — see `ctx.rebase` above.
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const expired = await ctx.rebase.dataAsAdmin.sessions.findAll({
            where: { last_seen_at: ["<", cutoff] }
        });
        for (const session of expired) {
            await ctx.rebase.dataAsAdmin.sessions.delete(session.id as string);
        }

        ctx.log(`Cleaned up ${expired.length} expired sessions`);

        return { deletedSessions: expired.length };
    },
};

export default job;
```

## Crons im Ressourcen-Graphen

Jede Cron-Datei ist gleichzeitig eine Deklaration. `rebase resources` listet sie unter dem Namen der Datei auf – derselben ID, unter der der Scheduler sie ausführt und die Studio anzeigt – zusammen mit ihrem Zeitplan und ihrer Zeitzone, sodass ein Host die Zeitpläne eines Projekts lesen kann, bevor er etwas ausführt. Ein Cron-Job bindet sich an keine Umgebungsvariable; `rebase status` zeigt ihn grün an, ohne dass etwas konfiguriert werden muss.

Das Lesen des Zeitplans bedeutet das Importieren der Datei, und `rebase resources` ist ein Build-Schritt: keine `.env`, keine Secrets. Halten Sie daher den **Modul-Scope** eines Cron-Jobs frei von allem, was beim Import Konfigurationen liest – etwa ein Datenbank-Client, der am Anfang eines Helpers erstellt wird, oder eine `env.ts`, die `DATABASE_URL` validiert. Importieren Sie diese Arbeit stattdessen innerhalb des Handlers:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

Der Handler läuft im Deployment, wo diese Variablen existieren. Ein Top-Level-Import desselben Moduls sorgt dafür, dass der Graph nur auf einer Maschine abgeleitet werden kann, die zufällig eine `.env`-Datei hat – und er lädt die gesamte Abhängigkeit bei jedem Bootvorgang, der den Job lediglich registrieren will.

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz zur Backend-Konfiguration
- **[Entitäts-Callbacks](/docs/collections/callbacks)** — Logik bei Datenänderungen ausführen
- **[Webhook-Integration](/docs/recipes/webhooks)** — Benachrichtigungen bei Ereignissen senden
- **[Cron über mehrere Instanzen](/docs/backend/cron-across-instances)** — Eine Ausführung pro Slot, verpasste Slots, Pausieren überall und sich überschneidende Ausführungen
