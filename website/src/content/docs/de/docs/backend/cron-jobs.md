---
sourceHash: 08355086a3a04e8c
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

**Ausgekoppelt (Ejected)** — `cronsDir` bei `initializeRebaseBackend({ … })`, wie unten gezeigt, oder `crons` mit den Jobs als Werten.

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

### Cron-Jobs als Werte

<span class="since-badge" data-since="0.25">Seit 0.25</span> Unter 0.24 stammen Cron-Jobs nur aus einem Verzeichnis.

`crons` nimmt die Jobs als Record von der Job-ID zur Definition entgegen, neben `collections`. Ein Verzeichnis ist eine Möglichkeit, ihn zu bauen: `loadCrons(dir)` liest eines in genau diese Form ein.

```typescript
import path from "path";
import { defineCron, initializeRebaseBackend, loadCrons } from "@rebasepro/server";

const nightlyReport = defineCron({
    schedule: "0 3 * * *",
    async handler({ log }) {
        log("building the report");
    }
});

await initializeRebaseBackend({ app, server, crons: { "nightly-report": nightlyReport } });
// the same as cronsDir:
await initializeRebaseBackend({ app, server, crons: await loadCrons(path.resolve(__dirname, "../crons")) });
```

Geben Sie `crons` oder `cronsDir` an, nicht beides: Der Boot lehnt das Paar ab. Das Bauen des Backends registriert die Jobs; was ihre Timer startet, ist `start()`, das `initializeRebaseBackend` für Sie aufruft. Mit [`createRebaseBackend`](/docs/backend/custom-server/) rufen Sie es selbst auf, in dem Prozess, der sie ausführen soll. `loadCronJobsFromDirectory` und `loadCronJobsWithDiagnostics` funktionieren weiterhin, sind veraltet (deprecated) und warnen einmalig.

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

    // Logger — lines appear in Studio, the logs API and the server log
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

Verwenden Sie `ctx.log()`, um strukturierte Ausgaben zu erzeugen. Diese Zeilen werden im Ausführungslog erfasst und sind in Studio sowie über die REST-API sichtbar. Jede Zeile wird außerdem auf Level `info` in das Server-Log geschrieben, mit einem Feld `cron`, das die Job-ID enthält. So erscheint sie überall dort, wo die Ausgabe Ihres Containers gesammelt wird, auch in den Debug-Logs von Rebase Cloud. Diese Kopie wird so geschwärzt wie die eigenen Log-Zeilen des Servers: Die Werte von Schlüsseln wie `password` oder `apiKey` sowie SQL und Parameter einer fehlgeschlagenen Abfrage werden ersetzt. Das Ausführungslog speichert die Zeile ohne diese Schwärzung.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Das Ausführungslog behält die ersten 500 Zeilen eines Durchlaufs oder 64 KB davon, je nachdem, was zuerst erreicht wird, und danach eine Zeile, die nennt, wie viele weitere es gab: `… 9500 more lines not kept — see the server log`. Das Server-Log erhält jede Zeile. Ein Job, der eine Zeile pro verarbeitetem Element loggt, sollte damit rechnen, dass sein Verlauf den Anfang des Durchlaufs zeigt.

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

Jobs über HTTP auflisten, auslösen, pausieren und fortsetzen, und `client.cron` im typisierten SDK: [Cron-Jobs-API](/docs/backend/cron-jobs-api/).

## Studio-Dashboard

Wenn Cron-Jobs konfiguriert sind, erscheint in Rebase Studio unter **Compute** neben der JS-Konsole ein Tool namens **Cron Jobs**. Das Dashboard bietet:

- **Job-Liste** — Alle registrierten Jobs mit Live-Statusanzeigen
- **Detail-Panel** — Zeitplan, nächste/letzte Ausführung, Dauer und Fehlerinformationen
- **Ausführungsverlauf** — Erweiterbare Log-Einträge mit erfassten Ausgaben und Ergebnissen
- **Manuelles Triggern** — Führen Sie jeden Job bei Bedarf mit einem Klick aus. Das Panel wartet, bis die Ausführung endet, und zeigt, wie sie verlaufen ist: Eine fehlgeschlagene Ausführung zeigt ihren Fehler
- **Aktivieren/Deaktivieren** — Jobs pausieren und fortsetzen, ohne den Server neu zu starten, für alle Prozesse gleichzeitig; eine Pause bleibt über Neustarts und Deploys hinweg bestehen
- **Jobs, die nicht vorhanden sind** — jeder Job, den der Scheduler abgelehnt hat, mit seinem Zeitplan und dem Grund, und wie viele Cron-Dateien nicht geladen werden konnten. Keiner von ihnen ist eingeplant; siehe [Jobs, die nicht vorhanden sind](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

Das Dashboard aktualisiert sich automatisch alle 15 Sekunden.

Das Panel zeigt dasselbe, egal welcher Prozess es ausliefert. Ein Job, den ein
anderer Prozess gerade ausführt, wird als laufend angezeigt.
Auf jedem Prozess, der einen Store hat, werden die Anzahl der Ausführungen, die Anzahl der Fehlschläge und die letzte Ausführung aus der Datenbank gelesen, in der die Ausführungen jedes Prozesses gezählt werden. Die eigenen Zähler eines Prozesses enthalten nur die Ausführungen, die er selbst gemacht hat: Die `api`-Rolle neben einem Worker führt nichts aus, und von zwei Repliken, die beide planen, sieht keine die Slots, die die andere beansprucht hat. Nur wenn die Datenbank nicht gelesen werden kann, greift die Karte auf die eigenen Zähler dieses Prozesses zurück, mit einer Warnung im Server-Log.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Die Zähler gelten für alle Zeiten; der Verlauf umfasst die letzten 30 Tage. Die Zeile jeder Ausführung in `rebase.cron_logs` wird 30 Tage nach ihrem Start von einem stündlichen Durchlauf gelöscht, während die Zähler für Ausführungen und Fehlschläge sie weiter mitzählen. Eine übersprungene Ausführung zählt wie eh und je als Ausführung: Sie ist eine Zeile des Verlaufs.

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
- **Fail-Safe Try/Catch**: Jeder Job-Handler läuft in einem isolierten Wrapper. Alle nicht abgefangenen Exceptions werden abgefangen, der Traceback des Fehlers in einen String formatiert, der Jobstatus auf `"error"` gesetzt und den Fehlerzähler des Jobs aktualisiert. Ein Absturz innerhalb eines einzelnen Cron-Tasks bringt niemals die Scheduler-Schleife oder den primären Hono-HTTP-Webserver zum Absturz.
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

ALTER TABLE rebase.cron_logs ADD COLUMN IF NOT EXISTS counted BOOLEAN;  -- the run is in the counters below

CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON rebase.cron_logs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_logs_started ON rebase.cron_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_cron_logs_uncounted ON rebase.cron_logs(job_id, started_at DESC) WHERE counted IS NULL;

CREATE TABLE IF NOT EXISTS rebase.cron_job_state (
    job_id            TEXT PRIMARY KEY,
    enabled           BOOLEAN,       -- NULL: follow the job's own `enabled`
    updated_at        TIMESTAMPTZ,   -- when `enabled` was last set, and by whom
    updated_by        TEXT,
    running_until     TIMESTAMPTZ,   -- the run lease: live while in the future
    running_by        TEXT,
    total_runs        BIGINT NOT NULL DEFAULT 0,   -- all-time, skips included
    total_failures    BIGINT NOT NULL DEFAULT 0,
    last_run_at       TIMESTAMPTZ,                 -- the most recently started run
    last_duration_ms  INTEGER,
    last_success      BOOLEAN,
    last_error        TEXT
);
```

Jede davon wird beim Start erstellt, falls sie fehlt, sodass eine Datenbank,
die älter ist, sie beim nächsten Deploy erhält. Keine davon ist eine Collection,
und die Endbenutzerrolle `rebase_user` hat auf keiner davon Rechte: Ein
beschreibbares `cron_job_state` würde es einem angemeldeten Benutzer erlauben,
einen Job für alle zu pausieren oder seine Lease zu halten, sodass nichts ihn
ausführt.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Die Zeile einer Ausführung und ihre Zählung werden in einer Anweisung geschrieben: das Einfügen in `cron_logs` und ein Upsert der Zähler des Jobs in `cron_job_state`. Eine Auflistung liest eine `cron_job_state`-Zeile pro Job, egal wie lang der Verlauf ist, und der Scheduler tut dasselbe, wenn er beim Start `totalRuns` und `totalFailures` befüllt. Log-Schreibvorgänge halten die Ausführung nicht auf; schlägt einer fehl, protokolliert der Scheduler den Fehler und macht weiter, wobei die Ausführung weiterhin im In-Memory-Ringpuffer liegt.

Einmal pro Stunde und beim Start löscht der Scheduler die Verlaufszeilen, die älter als 30 Tage sind, und zählt jede Ausführung, die noch nicht gezählt ist, beides in Batches von 5.000 Zeilen. Ein vor 0.24 geschriebener Verlauf wird vom ersten dieser Durchläufe gezählt, abseits des Boot-Pfads. Bis dieser beendet ist, addiert eine Auflistung die noch nicht gezählten Ausführungen zu den Zählern, sodass sich die Zahlen beim Upgrade nicht ändern. Dasselbe gilt für eine Ausführung, die ein älterer Server während eines Rolling Deploys protokolliert.

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

<span class="since-badge" data-since="0.25">Seit 0.25</span> Das Laden eines Crons
deklariert nichts. Ein eigener Build-Schritt, der Crons im Graphen haben möchte, sagt
das mit `declareCrons`:

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz zur Backend-Konfiguration
- **[Entitäts-Callbacks](/docs/collections/callbacks)** — Logik bei Datenänderungen ausführen
- **[Webhook-Integration](/docs/recipes/webhooks)** — Benachrichtigungen bei Ereignissen senden
- **[Cron über mehrere Instanzen](/docs/backend/cron-across-instances)** — Eine Ausführung pro Slot, verpasste Slots, Pausieren überall und sich überschneidende Ausführungen
