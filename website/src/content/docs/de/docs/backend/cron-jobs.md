---
sourceHash: dc15b1a8aff0e700
title: Cron-Jobs
sidebar_label: Cron Jobs
description: Planen Sie wiederkehrende Hintergrundaufgaben mit dem integrierten Cron-Job-System von Rebase. Definieren Sie Jobs als TypeScript-Dateien, überwachen Sie sie in Studio und verwalten Sie sie über die REST-API.
---

## Übersicht

Rebase enthält einen integrierten **Cron-Job-Scheduler** zur Ausführung wiederkehrender Hintergrundaufgaben – Datenbereinigung, Berichterstellung, Health-Checks, Synchronisierung externer APIs und mehr.

Cron-Jobs folgen demselben **dateibasierten Erkennungsmuster** wie benutzerdefinierte Funktionen: Legen Sie eine TypeScript-Datei in Ihrem `crons/`-Verzeichnis ab, und Rebase registriert und plant sie automatisch.

- **Keine externen Abhängigkeiten** — Keine externen Scheduler-Bibliotheken erforderlich
- **Admin-API** — REST-Endpunkte zum Auflisten, Triggern, Aktivieren/Deaktivieren und Anzeigen von Logs
- **Studio-Dashboard** — Überwachen Sie alle Jobs, sehen Sie den Ausführungsverlauf ein und starten Sie Durchläufe manuell
- **Datenbankpersistenz** — In PostgreSQL gespeicherte Ausführungsprotokolle, die Neustarts überstehen
- **In-Memory-Cache** — Schneller Ringpuffer (letzte 50 Ausführungen) für das Dashboard, gestützt durch die Datenbank

## Definieren eines Cron-Jobs

Erstellen Sie eine Datei in Ihrem `backend/crons/`-Verzeichnis, die standardmäßig eine Cron-Definition exportiert. Verwenden Sie den `defineCron`-Helper aus `@rebasepro/server` für Typinferenz und Autovervollständigung:

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

`rebase dev` überwacht das Crons-Verzeichnis, sodass ein Job, der während der Ausführung hinzugefügt wird, beim nächsten Neuladen registriert wird – kein Neustart erforderlich. (Es muss darauf hingewiesen werden: Das Verzeichnis wird gescannt statt importiert, sodass der Watcher dies nicht ableiten kann.)

:::note
`defineCron` ist eine Identitätsfunktion – sie gibt dasselbe Objekt zurück, das Sie übergeben. Ein einfaches, per Default exportiertes `CronJobDefinition`-Objekt funktioniert identisch; `defineCron` bietet lediglich Typüberprüfung zur Kompilierzeit und Autovervollständigung im Editor.
:::

Der **Dateiname** (ohne Erweiterung) wird zur eindeutigen ID des Jobs – z. B. `health-check`.


## Konfiguration

:::note[Wo dies hingehört]
**Managed Runtime** — legen Sie die Dateien in `backend/crons/` ab; die Runtime erkennt dieses Verzeichnis automatisch, und `entry.crons` in `rebase.json` ist nur erforderlich, wenn Sie es verschoben haben. `REBASE_CRON_SCHEDULER` in `.env` entscheidet, ob *dieser* Prozess die Timer ausführt.

**Ejected** — `cronsDir` bei `initializeRebaseBackend({ … })`, wie unten gezeigt, oder `crons` mit den Jobs als Werten.

Die vollständige Übersicht finden Sie in [Backend Overview](/docs/backend/#where-each-option-lives).
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
4. Den Scheduler starten und Zähler aus bestehenden DB-Logs initialisieren
5. Admin-REST-Routen unter `/api/admin/cron` einhängen

### Cron-Jobs als Werte

`crons` akzeptiert die Jobs neben `tables` als Record von Job-ID zu Definition. Ein Verzeichnis ist eine Möglichkeit, dies aufzubauen: `loadCrons(dir)` liest eines genau in dieses Format ein.

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

Geben Sie entweder `crons` oder `cronsDir` an, nicht beides: Beim Booten wird die Kombination abgelehnt. Das Erstellen des Backends registriert die Jobs; was deren Timer startet, ist `start()`, was `initializeRebaseBackend` für Sie aufruft. Bei [`createRebaseBackend`](/docs/backend/custom-server/) rufen Sie es selbst in dem Prozess auf, der sie ausführen soll. `loadCronJobsFromDirectory` und `loadCronJobsWithDiagnostics` funktionieren weiterhin, sind jedoch veraltet (deprecated) und geben eine einmalige Warnung aus.

## Syntax für Zeitpläne

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
| `0,30 * * * *` | Alle 30 Minuten (bei :00 und :30) |
| `0 9-17 * * 1-5` | Stündlich, 09:00–17:00 Uhr, nur an Wochentagen |

Schrittwerte (`*/n`), Bereiche (`a-b`) und Listen (`a,b,c`) werden alle unterstützt.

Wenn sowohl der Tag des Monats als auch der Wochentag eingeschränkt sind, stimmt ein Tag überein, der auf eines von beiden zutrifft, wie bei Standard-Cron: `0 9 1 * 1` läuft am 1. jedes Monats und an jedem Montag. Wenn eines der Felder mit `*` beginnt, muss ein Tag mit beiden übereinstimmen.

Ein Zeitplan wird mit der Wanduhrzeit seiner Zeitzone abgeglichen. Bei einer Zeitumstellung bedeutet dies, dass ein Job mit fester Uhrzeit innerhalb der wiederholten Stunde (`30 2 * * *`, wenn die Uhren um 03:00 Uhr zurückgestellt werden) in beiden Durchläufen dieser Stunde ausgeführt wird, und ein Job innerhalb der übersprungenen Stunde, wenn die Uhren vorgestellt werden, an diesem Tag nicht ausgeführt wird.

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

Jeder Handler erhält einen `CronJobContext`, der Dienstprogrammmethoden und die Rebase-Client-Instanz enthält:

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

Verwenden Sie `ctx.log()`, um strukturierte Ausgaben zu erzeugen. Diese Zeilen werden im Ausführungsprotokoll erfasst und sind in Studio sowie über die REST-API sichtbar. Jede Zeile wird außerdem mit dem Loglevel `info` und einem `cron`-Feld, das die Job-ID enthält, in das Server-Log geschrieben, sodass sie überall dort erscheint, wo die Ausgabe Ihres Containers gesammelt wird, einschließlich der Debug-Logs von Rebase Cloud. Diese Kopie wird auf die gleiche Weise unkenntlich gemacht (redacted) wie die servereigenen Logzeilen: Die Werte von Schlüsseln wie `password` oder `apiKey` sowie das SQL und die Parameter einer fehlgeschlagenen Abfrage werden ersetzt. Das Ausführungsprotokoll speichert die Zeile ohne diese Schwärzung.

Das Ausführungsprotokoll behält die ersten 500 Zeilen oder 64 KB eines Durchlaufs, je nachdem, was zuerst eintritt, und danach eine Zeile, die angibt, wie viele weitere Zeilen vorhanden waren: `… 9500 more lines not kept — see the server log`. Das Server-Log erhält jede Zeile. Ein Job, der pro verarbeitetem Element eine Zeile protokolliert, sollte davon ausgehen, dass in seinem Verlauf der Beginn des Durchlaufs angezeigt wird.

### `ctx.signal` – Arbeit stoppen, wenn der Durchlauf endet

Das Timeout beendet den *Durchlauf*: Der Scheduler wartet nicht mehr und zeichnet einen Fehler auf. Es beendet nicht den Handler. Übergeben Sie `ctx.signal` an alles, was ein Signal akzeptiert, und die Arbeit stoppt damit:

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

Ohne dies verliert ein Job, dessen Timeout seinem Intervall entspricht, pro Tick eine verwaiste Anfrage – unsichtbar, da jeder Durchlauf bereits als fehlgeschlagen protokolliert wurde.

:::note[`ctx.client` wurde entfernt]
Es war ein zweiter Name für `ctx.rebase`, und sein Typ machte `client.data` wieder zugänglich – den Alias, den `RebaseServerClient` bewusst weglässt, damit die privilegierte Ebene genau einen Namen hat. Ein Leser, der `client.data` hier gelernt hatte, übertrug dies auf einen Tabellen-Hook, wo `context.data` die *benutzerbezogene* Ebene ist: gleiche Schreibweise, gegenteilige Berechtigung. Verwenden Sie `ctx.rebase.dataAsAdmin`.
:::

### Interaktion mit der Datenbank und Diensten über `ctx.rebase`

`ctx.rebase.dataAsAdmin` ist die Daten-Ebene mit Admin-Berechtigung (admin-scoped). Ein Cron-Job hat keinen anfragebezogenen Benutzer, daher gibt es hier keine benutzerbezogene Alternative – schränken Sie die Filter jeder Abfrage selbst ein.

:::caution[Admin-Berechtigung umgeht RLS nicht automatisch]
`dataAsAdmin` wird einmalig beim Booten als `{ uid: "service", roles: ["admin"] }` festgelegt. Jeder Lese- und Schreibvorgang läuft weiterhin in einer Transaktion ab, die `SET LOCAL ROLE rebase_user` mit `app.uid = 'service'` ausgeführt hat, und **Ihre Policies werden ausgewertet** – bezogen auf diese Identität. Dies erfüllt die integrierten Standard-Policies über deren `rolesOverlap(['admin'])`-Zweig, weshalb der Unterschied selten auffällt. Er zeigt sich, wenn Sie eigene schreiben: `policy.serverContext()` wird zu `rebase.uid() IS NULL` kompiliert und ist hier daher **false**. Eine Tabelle mit `disableDefaultPolicies: true`, deren einzige Regel `serverContext()` ist, verweigert diese Schreibvorgänge und gibt für diese Lesevorgänge null Zeilen zurück – HTTP 200, leer.

`rebase.sql()` *ist* eine bedingungslose Umgehung: Owner-Verbindung, keine Policies.
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

Das Auflisten, Auslösen, Pausieren und Fortsetzen von Jobs über HTTP sowie `client.cron` des typisierten SDKs finden Sie unter [Cron Jobs API](/docs/backend/cron-jobs-api/).

## Studio-Dashboard

Wenn Cron-Jobs konfiguriert sind, erscheint in Rebase Studio unter **Compute** neben der JS-Konsole ein **Cron Jobs**-Werkzeug. Das Dashboard bietet:

- **Job-Liste** — Alle registrierten Jobs mit Live-Statusanzeigen
- **Detailbereich** — Zeitplan, nächster/letzter Durchlauf, Dauer und Fehlerinformationen
- **Ausführungsverlauf** — Aufklappbare Protokolleinträge mit erfasster Ausgabe und Ergebnissen
- **Manuelle Auslösung** — Führen Sie jeden Job mit einem Klick nach Bedarf aus. Das Panel wartet auf das Ende des Durchlaufs und meldet das Ergebnis: Ein fehlgeschlagener Durchlauf zeigt seinen Fehler an
- **Aktivieren/Deaktivieren** — Pausieren und Fortsetzen von Jobs ohne Neustart des Servers, für jeden Prozess gleichzeitig; eine Pause bleibt auch über Neustarts und Deployments hinweg bestehen
- **Jobs, die nicht vorhanden sind** — jeder Job, den der Scheduler abgelehnt hat, mit seinem Zeitplan und dem Grund, sowie die Anzahl der Cron-Dateien, die nicht geladen werden konnten. Keiner von ihnen ist eingeplant; siehe [Jobs that are not there](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

Das Dashboard aktualisiert sich automatisch alle 15 Sekunden.

Das Panel zeigt dasselbe an, unabhängig davon, welcher Prozess es bedient. Ein Job, den ein anderer Prozess ausführt, wird als laufend angezeigt.
Auf jedem Prozess, der über einen Store verfügt, werden die Anzahl der Durchläufe, die Anzahl der Fehler und der letzte Durchlauf aus der Datenbank gelesen, wo die Durchläufe jedes Prozesses gezählt werden. Die prozessinternen Zähler eines Prozesses enthalten nur die von ihm selbst durchgeführten Durchläufe: Die `api`-Rolle neben einem Worker führt nichts aus, und von zwei Replikaten, die beide zeitgesteuert arbeiten, sieht keines die Slots, die das andere beansprucht hat. Nur wenn die Datenbank nicht gelesen werden kann, greift die Karte auf die prozessinternen Zähler dieses Prozesses zurück, begleitet von einer Warnung im Server-Log.

Die Zählungen gelten für den gesamten Zeitraum; der Verlauf umfasst die letzten 30 Tage. Die Zeile jedes Durchlaufs in `rebase.cron_logs` wird 30 Tage nach ihrem Beginn durch einen stündlichen Bereinigungslauf gelöscht, während die Durchlauf- und Fehlerzähler ihn weiterhin mitzählen. Ein übersprungener Durchlauf zählt wie bisher als Durchlauf: Er ist eine Zeile des Verlaufs.

## Zeitplan-Validierung & AST-Parsing

Bei der Backend-Initialisierung parst Rebase alle registrierten Cron-Zeitpläne mithilfe eines abhängigkeitsfreien, JS-basierten Cron-Expanders:
- **Syntaxprüfung**: Überprüft, ob der String genau 5 durch Leerzeichen getrennte Felder enthält (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Bereichserweiterung**: Zerlegt Schritte (`*/15`), Bereiche (`9-17`) und kommagetrennte Listen (`0,30`) in explizite Arrays gültiger Ganzzahlen, die ihren jeweiligen Grenzen zugeordnet sind (z. B. Minuten `0-59`, Stunden `0-23`, Monate `1-12`).
- **Ganzzahlige Tokens**: Jede Zahl, Bereichsgrenze und jeder Schritt muss eine ganze Zahl sein: `5abc`, `*/5x` und `1.5` werden abgelehnt, ebenso wie ein rückwärts laufender Bereich (`5-1`).
- Wenn ein Cron-Ausdruck die Validierung nicht besteht, weist Rebase die Definition ab, protokolliert einen Startfehler und verweigert die Registrierung des Jobs, um Ausführungsfehler zur Laufzeit zu verhindern.

---

## Unter der Haube: Clock-Drift-Korrektur

Herkömmliche intervallbasierte Scheduler (wie `setInterval`) driften mit der Zeit ab und verursachen erhebliche CPU-Spitzen aufgrund von Verzögerungen bei der Event-Loop-Planung auf Betriebssystemebene. Um die Ausführungsgenauigkeit zu gewährleisten, implementiert Rebase eine **dynamische Zielzeit-Berechnungsschleife**:
1. **Kandidatenberechnung**: Nach Abschluss eines Jobs oder beim Starten des Schedulers berechnet Rebase den exakten Zeitstempel der *nächsten* passenden Kandidatenminute.
2. **Dynamischer Sleep**: Es berechnet die Differenz in Millisekunden (`nextRun.getTime() - now.getTime()`) und plant ein einzelnes `setTimeout`.
3. **Drift-Sicherheitsschwellenwert**: Ein minimaler Sleep-Puffer (`MIN_SCHEDULE_INTERVAL_MS`) von **5.000 ms** wird erzwungen. Wenn ein Scheduler-Tick extrem schnell abgeschlossen wird, verhindert dieser Schwellenwert ein nahezu sofortiges doppeltes Auslösen.
4. **Shutdown-Freundlichkeit**: Timer-Handles werden mithilfe von `timer.unref()` explizit von der Node.js-Event-Loop entkoppelt, wodurch sichergestellt wird, dass Hintergrund-Cron-Scheduler ein sauberes Beenden von Prozessen während Deployments nicht blockieren.

---

## Mehr als ein Prozess

Jeder Prozess, dessen Scheduler aktiviert ist, stellt dieselben Timer scharf; die Datenbank entscheidet, welcher von ihnen welchen Slot ausführt. Wie ein Slot genau einmal ausgeführt wird, wie ein durch einen Neustart verpasster Slot wiederhergestellt wird, wie eine Pause alle Replikate erreicht und warum eine manuelle Auslösung niemals parallel zu einem geplanten Durchlauf ausgeführt wird, erfahren Sie unter [Cron across instances](/docs/backend/cron-across-instances).

---

## Timeouts & Fehlerisolation

- **Erzwungenes Timeout-Race**: Ausführungsblöcke werden in ein `Promise.race` gegen einen Timeout-Timer eingebunden, der aus `timeoutSeconds` abgeleitet wird (Standard: `300` Sekunden / 5 Minuten; `Infinity` für kein Timeout). Wenn der Handler über diesen Schwellenwert hinaus hängt, wird `ctx.signal` abgebrochen und das Promise zurückgewiesen, wodurch Folgendes ausgelöst wird:
  `Error: Cron job "<id>" timed out after <N>ms`
  Der Abbruch ist der Teil, der die *Arbeit* stoppt; die Zurückweisung hält lediglich den Scheduler davon ab, weiter zu warten. Ein Handler, der `ctx.signal` ignoriert, läuft über seinen eigenen Durchlauf hinaus weiter.
- **Herunterfahren (Shutdown)**: `backend.shutdown()` wartet auf einen laufenden Durchlauf innerhalb desselben Zeitbudgets wie die Job-Queue (zwei Drittel des Shutdown-Timeouts). Ein Durchlauf, der nach Ablauf dieser Zeit immer noch aktiv ist, bricht `ctx.signal` ab und wird mit der Begründung als fehlgeschlagen protokolliert. Sein Slot bleibt beansprucht, sodass keine andere Instanz ihn erneut ausführt.
- **Ausfallsicheres Try/Catch**: Jeder Job-Handler läuft in einem isolierten Wrapper. Alle nicht abgefangenen Ausnahmen werden abgefangen, wobei die Fehlermeldung (geschwärzt) als String aufgezeichnet, der Job-Status auf `"error"` gesetzt und der Fehlerzähler des Jobs aktualisiert wird. Ein Absturz innerhalb einer einzelnen Cron-Aufgabe bringt niemals die Scheduler-Schleife oder den primären Hono-HTTP-Webserver zum Absturz.
- **In-Memory-Ringpuffer**: Der Scheduler verwaltet einen Ringpuffer, der die letzten **50 Durchläufe** pro Job enthält. Dieser Puffer wird im Arbeitsspeicher gehalten, um nahezu verzögerungsfreie Lesevorgänge über Rebase Studio zu ermöglichen.

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

Jede davon wird beim Booten erstellt, falls sie fehlt, sodass eine Datenbank, die vor deren Einführung existierte, diese beim nächsten Deployment erhält. Keine davon ist eine deklarierte Tabelle, und die Endbenutzerrolle `rebase_user` verfügt über keinerlei Berechtigungen für diese Tabellen: Ein beschreibbares `cron_job_state` würde es einem angemeldeten Benutzer ermöglichen, einen Job für alle zu pausieren oder dessen Lease zu blockieren, sodass nichts ihn ausführt.

Die Zeile eines Durchlaufs und seine Zählung werden in einer einzigen Anweisung geschrieben: das Einfügen in `cron_logs` und ein Upsert der Zähler des Jobs in `cron_job_state`. Eine Auflistung liest genau eine `cron_job_state`-Zeile pro Job, unabhängig von der Länge des Verlaufs, und ebenso verfährt der Scheduler, wenn er beim Start `totalRuns` und `totalFailures` initialisiert. Protokollschreibvorgänge verzögern den Durchlauf nicht; schlägt einer fehl, protokolliert der Scheduler den Fehler und fährt fort, wobei der Durchlauf weiterhin im In-Memory-Ringpuffer verbleibt.

Einmal pro Stunde sowie beim Start löscht der Scheduler die Verlaufszeilen, die älter als 30 Tage sind, und zählt alle noch nicht gezählten Durchläufe – beides in Batches von 5.000 Zeilen. Ein vor Version 0.24 erstellter Verlauf wird beim ersten dieser Bereinigungsläufe außerhalb des Boot-Pfads gezählt. Bis dieser Vorgang abgeschlossen ist, rechnet eine Auflistung die noch nicht gezählten Durchläufe zu den Zählern hinzu, sodass sich die Zahlen bei einem Upgrade nicht ändern. Dasselbe gilt für einen Durchlauf, den ein älterer Server während eines Rolling Deployments protokolliert.

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

Jede Cron-Datei ist gleichzeitig eine Deklaration. `rebase resources` listet sie unter dem Namen der Datei auf – derselben ID, unter der der Scheduler sie ausführt und die Studio anzeigt – zusammen mit ihrem Zeitplan und ihrer Zeitzone, sodass ein Host die Zeitpläne eines Projekts liest, bevor er irgendetwas ausführt. Ein Cron-Job bindet sich an keine Umgebungsvariable; `rebase status` zeigt ihn grün an, ohne dass etwas konfiguriert werden müsste.

Das Einlesen des Zeitplans erfordert das Importieren der Datei, und `rebase resources` ist ein Build-Schritt: keine `.env`, keine Secrets. Halten Sie daher den **Modul-Scope** eines Crons frei von allem, was Konfigurationen beim Import einliest – ein Datenbank-Client, der am Anfang eines Helpers instanziiert wird, oder eine `env.ts`, die `DATABASE_URL` validiert. Importieren Sie solche Logik stattdessen innerhalb des Handlers:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

Der Handler läuft im Deployment, wo diese Variablen existieren. Ein Import desselben Moduls auf oberster Ebene (Top-Level) führt dazu, dass der Graph nur auf einem Rechner abgeleitet werden kann, der zufällig über eine `.env` verfügt – und er lädt die gesamte Abhängigkeit bei jedem Bootvorgang, der den Job lediglich registriert.

Das Laden eines Cron-Jobs deklariert nichts. Ein eigener Build-Schritt, der Crons im Graphen haben möchte, gibt dies mit `declareCrons` an:

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Nächste Schritte

- **[Backend Overview](/docs/backend)** – Vollständige Referenz zur Backend-Konfiguration
- **[Table hooks](/docs/collections/callbacks)** – Logik bei Datenänderungen ausführen
- **[Webhook Integration](/docs/recipes/webhooks)** – Benachrichtigungen bei Ereignissen senden
- **[Cron across instances](/docs/backend/cron-across-instances)** – Ein Durchlauf pro Slot, verpasste Slots, instanzweites Pausieren und überlappende Durchläufe
