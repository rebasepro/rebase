---
sourceHash: 571b6448756b487e
title: Cron-Jobs
sidebar_label: Cron-Jobs
description: Planen Sie wiederkehrende Hintergrundaufgaben mit dem integrierten Cron-Job-System von Rebase. Definieren Sie Jobs als TypeScript-Dateien, überwachen Sie sie in Studio und verwalten Sie sie über die REST-API.
---

## Übersicht

Rebase enthält einen integrierten **Cron-Job-Scheduler** zum Ausführen wiederkehrender Hintergrundaufgaben – Datenbereinigung, Berichterstellung, Health-Checks, Synchronisierungen mit externen APIs und mehr.

Cron-Jobs folgen demselben Muster der **dateibasierten Erkennung** wie benutzerdefinierte Funktionen: Legen Sie eine TypeScript-Datei in Ihrem `crons/`-Verzeichnis ab, und Rebase registriert und plant sie automatisch.

- **Keine Abhängigkeiten** — Keine externen Scheduler-Bibliotheken erforderlich
- **Admin-API** — REST-Endpunkte zum Auflisten, Auslösen, Aktivieren/Deaktivieren und Anzeigen von Protokollen
- **Studio-Dashboard** — Überwachen Sie alle Jobs, sehen Sie den Ausführungsverlauf ein und lösen Sie Ausführungen manuell aus
- **Datenbank-Persistenz** — Ausführungsprotokolle werden in PostgreSQL gespeichert und überstehen Neustarts
- **In-Memory-Cache** — Schneller Ringpuffer (letzte 50 Durchläufe) für das Dashboard, gestützt durch die Datenbank

## Definieren eines Cron-Jobs

Erstellen Sie eine Datei in Ihrem `backend/crons/`-Verzeichnis, die eine Cron-Definition als Default-Export exportiert. Verwenden Sie den `defineCron`-Helper aus `@rebasepro/server` für Typinferenz und Autovervollständigung:

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

`rebase dev` überwacht das Crons-Verzeichnis. Ein Job, der während der Laufzeit hinzugefügt wird, wird beim nächsten Neuladen registriert – kein Neustart erforderlich. (Es muss mitgeteilt werden: Das Verzeichnis wird gescannt statt importiert, daher kann der Watcher dies nicht ableiten.)

:::note
`defineCron` ist eine Identitätsfunktion – sie gibt dasselbe Objekt zurück, das Sie übergeben. Ein einfaches, standardmäßig exportiertes `CronJobDefinition`-Objekt funktioniert identisch; `defineCron` bietet lediglich Typüberprüfung zur Kompilierzeit und Editor-Autovervollständigung.
:::

Der **Dateiname** (ohne Erweiterung) wird zur eindeutigen ID des Jobs – z. B. `health-check`.


## Konfiguration

:::note[Wo dies hingehört]
**Managed Runtime** — legen Sie die Dateien in `backend/crons/` ab; die Runtime erkennt dieses Verzeichnis von selbst, und `entry.crons` in `rebase.json` ist nur erforderlich, wenn Sie es verschoben haben. `REBASE_CRON_SCHEDULER` in `.env` bestimmt, ob *dieser* Prozess die Timer ausführt.

**Ejected** — `cronsDir` bei `initializeRebaseBackend({ … })`, wie unten gezeigt, oder `crons` mit den Jobs als Werten.

Die vollständige Übersicht finden Sie unter [Backend-Übersicht](/docs/backend/#where-each-option-lives).
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
2. Jeden Default-Export als Cron-Job registrieren
3. Die Tabellen `rebase.cron_logs`, `rebase.cron_claims` und `rebase.cron_job_state` in PostgreSQL automatisch erstellen (falls der Treiber SQL unterstützt)
4. Den Scheduler starten und die Zähler aus vorhandenen DB-Protokollen initialisieren
5. Admin-REST-Routen unter `/api/admin/cron` einhängen

### Cron-Jobs als Werte

`crons` akzeptiert die Jobs als Record von Job-ID zu Definition, neben `tables`. Ein Verzeichnis ist eine Möglichkeit, diesen aufzubauen: `loadCrons(dir)` liest ein Verzeichnis genau in diese Form ein.

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

Geben Sie entweder `crons` oder `cronsDir` an, nicht beides: Beim Booten wird die Kombination abgelehnt. Das Erstellen des Backends registriert die Jobs; was ihre Timer startet, ist `start()`, das `initializeRebaseBackend` für Sie aufruft. Mit [`createRebaseBackend`](/docs/backend/custom-server/) rufen Sie es selbst auf, in dem Prozess, der sie ausführen soll. `loadCronJobsFromDirectory` und `loadCronJobsWithDiagnostics` funktionieren weiterhin, sind veraltet (deprecated) und geben einmalig eine Warnung aus.

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

Schrittwerte (`*/n`), Bereiche (`a-b`) und Listen (`a,b,c`) werden alle unterstützt.

Wenn sowohl der Tag des Monats als auch der Wochentag eingeschränkt sind, stimmt ein Tag überein, der auf eine der beiden Bedingungen zutrifft, wie bei Standard-Cron: `0 9 1 * 1` wird am 1. jedes Monats und an jedem Montag ausgeführt. Wenn eines der Felder mit `*` beginnt, muss ein Tag beide Bedingungen erfüllen.

Ein Zeitplan wird mit der Uhrzeit seiner Zeitzone abgeglichen. Bei einer Sommerzeitumstellung bedeutet dies, dass ein Job mit fester Uhrzeit innerhalb der wiederholten Stunde (`30 2 * * *`, wenn die Uhren um 03:00 Uhr zurückgestellt werden) in beiden Durchläufen dieser Stunde ausgeführt wird. Ein Job innerhalb der übersprungenen Stunde, wenn die Uhren vorgestellt werden, wird an diesem Tag nicht ausgeführt.

## CronJobDefinition-Referenz

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // IANA zone the schedule is read in, e.g. "Europe/Madrid". Without it the
    // schedule is read in the host's own zone — UTC in nearly every container,
    // yours on a laptop — so name it. An unknown zone is refused when the job
    // loads rather than read as local time.
    timezone?: string;

    // Human-readable name shown in Studio (default: the job id, the file's name)
    name?: string;

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

    // The slot this run fires for: a catch-up run gets the slot it
    // missed, a manual trigger the moment it started
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

Verwenden Sie `ctx.log()`, um strukturierte Ausgaben zu erzeugen. Diese Zeilen werden im Ausführungsprotokoll erfasst und sind in Studio sowie über die REST-API sichtbar. Jede Zeile wird außerdem mit dem Level `info` und einem `cron`-Feld, das die Job-ID enthält, in das Serverprotokoll geschrieben, sodass sie überall dort erscheint, wo die Ausgaben Ihres Containers gesammelt werden, einschließlich der Debug-Protokolle von Rebase Cloud. Diese Kopie wird auf dieselbe Weise bereinigt (redacted) wie die Protokollzeilen des Servers selbst: Die Werte von Schlüsseln wie `password` oder `apiKey` sowie das SQL und die Parameter einer fehlgeschlagenen Abfrage werden ersetzt. Das Ausführungsprotokoll speichert die Zeile ohne diese Bereinigung.

Das Ausführungsprotokoll behält die ersten 500 Zeilen oder 64 KB eines Durchlaufs, je nachdem, was zuerst eintritt, und fügt dann eine Zeile hinzu, die angibt, wie viele weitere Zeilen vorhanden waren: `… 9500 more lines not kept — see the server log`. Das Serverprotokoll erhält jede Zeile. Ein Job, der für jedes verarbeitete Element eine Zeile protokolliert, sollte davon ausgehen, dass sein Verlauf den Beginn des Durchlaufs anzeigt.

### `ctx.signal` — die Arbeit stoppen, wenn der Durchlauf endet

Das Timeout beendet den *Durchlauf*: Der Scheduler wartet nicht mehr und erfasst einen Fehler. Es beendet nicht den Handler. Übergeben Sie `ctx.signal` an alles, was ein Signal akzeptiert, und die Arbeit stoppt damit:

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

Ohne dies hinterlässt ein Job, dessen Timeout seinem Intervall entspricht, einen verwaisten Request pro Tick – unsichtbar, da jeder Durchlauf bereits als fehlgeschlagen erfasst ist.

:::note[`ctx.client` wurde entfernt]
Es war ein zweiter Name für `ctx.rebase`, und sein Typ legte `client.data` erneut offen – den Alias, den `RebaseServerClient` bewusst weglässt, damit die privilegierte Ebene genau einen Namen hat. Leser, die `client.data` hier gelernt haben, übertrugen es auf einen Tabellen-Hook, wo `context.data` die *benutzerbezogene* Ebene ist: gleiche Schreibweise, gegenteilige Berechtigung. Verwenden Sie `ctx.rebase.dataAsAdmin`.
:::

### Interaktion mit der Datenbank und Diensten über `ctx.rebase`

`ctx.rebase.dataAsAdmin` ist die Datenebene mit Admin-Berechtigung. Ein Cron-Job hat keinen Benutzer pro Anfrage, daher gibt es hier keine benutzerbezogene Alternative – schränken Sie die Filter jeder Abfrage selbst ein.

:::caution[Admin-Scope umgeht kein RLS]
`dataAsAdmin` wird einmalig beim Start als `{ uid: "service", roles: ["admin"] }` festgelegt. Jeder Lese- und Schreibvorgang wird weiterhin in einer Transaktion ausgeführt, die `SET LOCAL ROLE rebase_user` mit `app.uid = 'service'` ausgeführt hat, und **Ihre Richtlinien werden evaluiert** – gegen diese Identität. Es passiert die integrierten Standardrichtlinien über deren `rolesOverlap(['admin'])`-Zweig, weshalb der Unterschied selten auffällt. Er zeigt sich, wenn Sie eigene Richtlinien schreiben: `policy.serverContext()` wird zu `rebase.uid() IS NULL` kompiliert und ist hier daher **false**. Eine Tabelle mit `defaultPolicies: false`, deren einzige Regel `serverContext()` ist, verweigert diese Schreibvorgänge und gibt für diese Lesevorgänge null Zeilen zurück – HTTP 200, leer.

`rebase.sql()` *ist* eine bedingungslose Umgehung: Owner-Verbindung, keine Richtlinien.
:::

```typescript
// backend/crons/expire-users.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    schedule: "0 0 * * *", // Daily at midnight
    name: "Expire Inactive Accounts",
    
    async handler(ctx) {
        ctx.log("Checking for expired trial users...");

        // Fetch using the pre-initialized data driver. `table<Row>(slug)`
        // gives the query builder the row type — `where` keys are checked
        // against it. Every filter is an `[operator, value]` tuple; a bare
        // value is passed straight through and builds a malformed query.
        const users = ctx.rebase.dataAsAdmin.table<{
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
Der Handler kann jeden JSON-serialisierbaren Wert zurückgeben. Dieser wird im Protokolleintrag als `result` gespeichert und im Ausführungsverlauf von Studio angezeigt.
:::

## REST-API

Das Auflisten, Auslösen, Pausieren und Fortsetzen von Jobs über HTTP sowie `client.cron` des typisierten SDKs finden Sie unter [Cron-Jobs-API](/docs/backend/cron-jobs-api/).

## Studio-Dashboard

Wenn Cron-Jobs konfiguriert sind, erscheint in Rebase Studio unter **Rechenleistung** neben der JS-Konsole das Tool **Geplante Jobs**. Das Dashboard bietet:

- **Job-Liste** — Alle registrierten Jobs mit Live-Statusanzeigen
- **Detail-Panel** — Zeitplan, nächste/letzte Ausführung, Dauer und Fehlerinformationen
- **Ausführungsverlauf** — Erweiterbare Protokolleinträge mit erfassten Ausgaben und Ergebnissen
- **Manuelles Auslösen** — Führen Sie jeden Job bei Bedarf mit einem Klick aus. Das Panel wartet auf das Ende des Durchlaufs und meldet das Ergebnis: Ein fehlgeschlagener Durchlauf zeigt seinen Fehler an
- **Aktivieren/Deaktivieren** — Jobs ohne Neustart des Servers pausieren und fortsetzen, für alle Prozesse gleichzeitig; eine Pausierung bleibt über Neustarts und Deployments hinweg bestehen
- **Jobs, die nicht vorhanden sind** — Jeder vom Scheduler abgelehnte Job mit seinem Zeitplan und dem Grund sowie die Anzahl der Cron-Dateien, die nicht geladen werden konnten. Keiner davon wird eingeplant; siehe [Jobs, die nicht vorhanden sind](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

Das Dashboard aktualisiert sich automatisch alle 15 Sekunden.

Das Panel zeigt dasselbe an, unabhängig davon, welcher Prozess die Anfrage bedient. Ein Job, den ein anderer Prozess ausführt, wird als laufend angezeigt.
Auf jedem Prozess, der über einen Store verfügt, werden die Anzahl der Durchläufe, die Anzahl der Fehler und der letzte Durchlauf aus der Datenbank gelesen, in der die Durchläufe jedes Prozesses gezählt werden. Die prozessinternen Zähler enthalten nur die von ihm selbst ausgeführten Durchläufe: Die `api`-Rolle neben einem Worker führt nichts aus, und von zwei Replikaten, die beide planen, sieht keines die vom anderen beanspruchten Slots. Nur wenn die Datenbank nicht gelesen werden kann, greift die Karte auf die prozessinternen Zähler dieses Prozesses zurück, begleitet von einer Warnung im Serverprotokoll.

Die Zähler gelten für die gesamte Zeit (All-Time); der Verlauf umfasst die letzten 30 Tage. Der Eintrag jedes Durchlaufs in `rebase.cron_logs` wird 30 Tage nach seinem Start durch einen stündlichen Bereinigungsvorgang gelöscht, während die Gesamtzahlen für Durchläufe und Fehler ihn weiterhin mitzählen. Ein übersprungener Durchlauf zählt wie bisher als Durchlauf: Er bildet eine Zeile im Verlauf.

## Zeitplan-Validierung & AST-Parsing

Bei der Backend-Initialisierung analysiert Rebase alle registrierten Cron-Zeitpläne mithilfe eines abhängigkeitsfreien, JS-basierten Cron-Expanders:
- **Syntaxprüfung**: Überprüft, ob der String genau 5 durch Leerzeichen getrennte Felder enthält (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Bereichsexpansion**: Zerlegt Schritte (`*/15`), Bereiche (`9-17`) und kommagetrennte Listen (`0,30`) in explizite Arrays gültiger Ganzzahlen, die ihren jeweiligen Grenzen zugeordnet sind (z. B. Minuten `0-59`, Stunden `0-23`, Monate `1-12`).
- **Ganze Token**: Jede Zahl, Bereichsgrenze und jeder Schritt muss eine ganze Zahl sein: `5abc`, `*/5x` und `1.5` werden abgelehnt, ebenso wie ein rückwärts laufender Bereich (`5-1`).
- Wenn ein Cron-Ausdruck die Validierung nicht besteht, weist Rebase die Definition ab, protokolliert einen Startfehler und weigert sich, den Job zu registrieren, um Ausführungsfehler zur Laufzeit zu verhindern.

---

## Unter der Haube: Clock-Drift-Korrektur

Standardmäßige intervallbasierte Scheduler (wie `setInterval`) driften mit der Zeit ab und verursachen erhebliche CPU-Spitzen aufgrund von Verzögerungen bei der Event-Loop-Planung auf Betriebssystemebene. Um die Ausführungsgenauigkeit zu gewährleisten, implementiert Rebase eine **dynamische Zielzeit-Berechnungsschleife**:
1. **Kandidatenberechnung**: Nach Abschluss eines Jobs oder beim Starten des Schedulers berechnet Rebase den genauen Zeitstempel der *nächsten* passenden Kandidatenminute.
2. **Dynamischer Sleep**: Rebase berechnet die Differenz in Millisekunden (`nextRun.getTime() - now.getTime()`) und plant ein einzelnes `setTimeout`.
3. **Drift-Sicherheitsschwelle**: Ein minimaler Sleep-Puffer (`MIN_SCHEDULE_INTERVAL_MS`) von **5.000 ms** wird erzwungen. Wenn ein Scheduler-Tick extrem schnell abgeschlossen wird, verhindert diese Schwelle ein nahezu sofortiges doppeltes Auslösen.
4. **Shutdown-Freundlichkeit**: Timer-Handles werden mithilfe von `timer.unref()` explizit von der Node.js-Event-Loop getrennt, wodurch sichergestellt wird, dass Hintergrund-Cron-Scheduler saubere Prozessbeendigungen während Deployments nicht blockieren.

---

## Mehr als ein Prozess

Jeder Prozess, dessen Scheduler aktiviert ist, schärft dieselben Timer; die Datenbank entscheidet, welcher von ihnen welchen Slot ausführt. Wie ein Slot einmalig ausgeführt wird, wie ein durch einen Neustart verloren gegangener Slot wiederhergestellt wird, wie eine Pause jedes Replikat erreicht und warum ein manueller Trigger niemals neben einem geplanten Lauf ausgeführt wird, erfahren Sie unter [Cron über Instanzen hinweg](/docs/backend/cron-across-instances).

---

## Timeouts & Fehlerisolation

- **Erzwungenes Timeout-Race**: Ausführungsblöcke werden in ein `Promise.race` gegen einen Timeout-Timer eingebunden, der aus `timeoutSeconds` abgeleitet wird (Standard: `300` Sekunden / 5 Minuten; `Infinity` für keines). Wenn der Handler diese Schwelle überschreitet, wird `ctx.signal` abgebrochen und das Promise zurückgewiesen, was folgenden Fehler auslöst:
  `Error: Cron job "<id>" timed out after <N>ms`
  Der Abbruch ist der Teil, der die *Arbeit* beendet; die Zurückweisung beendet lediglich das Warten des Schedulers. Ein Handler, der `ctx.signal` ignoriert, läuft über seinen eigenen Durchlauf hinaus weiter.
- **Shutdown**: `backend.shutdown()` wartet auf einen laufenden Durchlauf innerhalb desselben Budgets wie die Job-Warteschlange (zwei Drittel des Shutdown-Timeouts). Bei einem Durchlauf, der nach Ablauf dieser Frist immer noch aktiv ist, wird `ctx.signal` abgebrochen und er wird mit der entsprechenden Begründung als fehlgeschlagen erfasst. Sein Slot bleibt beansprucht, sodass keine andere Instanz ihn erneut ausführt.
- **Ausfallsicheres Try/Catch**: Jeder Job-Handler läuft in einem isolierten Wrapper. Alle nicht abgefangenen Ausnahmen werden abgefangen, wobei die (bereinigte) Fehlermeldung als String erfasst, der Jobstatus auf `"error"` gesetzt und der Fehlerzähler des Jobs aktualisiert wird. Ein Absturz innerhalb einer einzelnen Cron-Aufgabe bringt niemals die Scheduler-Schleife oder den primären Hono-HTTP-Webserver zum Absturz.
- **In-Memory-Ringpuffer**: Der Scheduler verwaltet einen Ringpuffer mit den letzten **50 Durchläufen** pro Job. Dieser Puffer wird im Arbeitsspeicher gehalten, um nahezu verzögerungsfreie Lesevorgänge aus Rebase Studio zu ermöglichen.

---

## Schema der Datenbankpersistenz

Wenn Datenbankadapter aktiv sind, die SQL unterstützen (z. B. PostgreSQL), richtet Rebase die Tabelle `rebase.cron_logs` ein:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.cron_logs (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id       TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ NOT NULL,
    duration_ms  INTEGER NOT NULL,
    success      BOOLEAN NOT NULL DEFAULT true,
    error        TEXT,                                 -- The error's message, redacted
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

Jede Tabelle wird beim Booten erstellt, falls sie fehlt, sodass eine Datenbank aus der Zeit vor deren Einführung sie beim nächsten Deployment erhält. Keine von ihnen ist eine deklarierte Tabelle, und die Endbenutzerrolle `rebase_user` hat keinerlei Rechte auf eine von ihnen: Eine beschreibbare `cron_job_state`-Tabelle würde es einem angemeldeten Benutzer ermöglichen, einen Job für alle zu pausieren oder dessen Lease zu halten, sodass nichts ihn ausführt.

Die Zeile eines Durchlaufs und seine Zählung werden in einem einzigen Statement geschrieben: das Einfügen in `cron_logs` und ein Upsert der Zähler des Jobs in `cron_job_state`. Eine Auflistung liest eine `cron_job_state`-Zeile pro Job, unabhängig von der Länge des Verlaufs, und ebenso verfährt der Scheduler, wenn er `totalRuns` und `totalFailures` beim Start initialisiert. Protokollschreibvorgänge verzögern den Durchlauf nicht; schlägt einer fehl, protokolliert der Scheduler den Fehler und fährt fort, wobei der Durchlauf weiterhin im In-Memory-Ringpuffer verbleibt.

Einmal pro Stunde sowie beim Start löscht der Scheduler Verlaufseinträge, die älter als 30 Tage sind, und zählt alle Durchläufe, die noch nicht gezählt wurden, beides in Batches von 5.000 Zeilen. Ein vor Version 0.24 geschriebener Verlauf wird beim ersten dieser Durchläufe außerhalb des Boot-Pfads gezählt. Bis dieser Vorgang abgeschlossen ist, rechnet eine Auflistung die noch nicht gezählten Durchläufe zu den Zählern hinzu, sodass sich die Zahlen bei einem Upgrade nicht ändern. Dasselbe gilt für einen Durchlauf, den ein älterer Server während eines Rolling Deployments protokolliert.

## Beispiel: Täglicher Bereinigungs-Job

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

## Crons im Ressourcengraphen

Jede Cron-Datei ist auch eine Deklaration. `rebase resources` listet sie unter dem Namen der Datei auf – derselben ID, unter der der Scheduler sie ausführt und die Studio anzeigt – mit ihrem Zeitplan und ihrer Zeitzone, sodass ein Host die Zeitpläne eines Projekts liest, bevor er irgendetwas ausführt. Ein Cron bindet sich an keine Umgebungsvariable; `rebase status` zeigt ihn grün an, ohne dass etwas konfiguriert werden müsste.

Das Lesen des Zeitplans erfordert das Importieren der Datei, und `rebase resources` ist ein Build-Schritt: keine `.env`, keine Secrets. Halten Sie daher den **Modul-Scope** eines Crons frei von allem, was beim Import Konfiguration liest – ein Datenbank-Client am Anfang eines Helpers, eine `env.ts`, die `DATABASE_URL` validiert. Importieren Sie diese Aufgaben stattdessen innerhalb des Handlers:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

Der Handler wird im Deployment ausgeführt, wo diese Variablen existieren. Ein Import desselben Moduls auf oberster Ebene führt dazu, dass der Graph nur auf einem Rechner abgeleitet werden kann, der zufällig über eine `.env` verfügt – und er lädt die gesamte Abhängigkeit in jeden Bootvorgang, der den Job lediglich registriert.

Das Laden eines Crons deklariert nichts. Ein eigener Build-Schritt, der Crons im Graphen haben möchte, gibt dies mit `declareCrons` an:

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz zur Backend-Konfiguration
- **[Tabellen-Hooks](/docs/collections/callbacks)** — Logik bei Datenänderungen ausführen
- **[Webhook-Integration](/docs/recipes/webhooks)** — Benachrichtigungen bei Ereignissen senden
- **[Cron über Instanzen hinweg](/docs/backend/cron-across-instances)** — Ein Durchlauf pro Slot, verpasste Slots, überall pausieren und überlappende Durchläufe
