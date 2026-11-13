---
sourceHash: d47ac3d32c961db1
title: Cron-Jobs
sidebar_label: Cron-Jobs
description: Planen Sie wiederkehrende Hintergrundaufgaben mit dem integrierten Cron-Job-System von Rebase. Definieren Sie Jobs als TypeScript-Dateien, überwachen Sie sie in Studio und verwalten Sie sie über die REST-API.
---

## Übersicht

Rebase enthält einen integrierten **Cron-Job-Scheduler** zum Ausführen wiederkehrender Hintergrundaufgaben – Datenbereinigung, Berichterstellung, Health-Checks, Synchronisierungen mit externen APIs und mehr.

Cron-Jobs folgen demselben Muster der **dateibasierten Erkennung** wie benutzerdefinierte Funktionen: Legen Sie eine TypeScript-Datei in Ihrem `crons/`-Verzeichnis ab, und Rebase registriert und plant sie automatisch.

- **Keine Abhängigkeiten** — Keine externen Scheduler-Bibliotheken erforderlich
- **Admin-API** — REST-Endpunkte zum Auflisten, Auslösen, Aktivieren/Deaktivieren und Anzeigen von Protokollen
- **Studio-Dashboard** — Überwachen Sie alle Jobs, sehen Sie sich den Ausführungsverlauf an und lösen Sie Ausführungen manuell aus
- **Datenbankpersistenz** — Ausführungsprotokolle werden in PostgreSQL gespeichert und überstehen Neustarts
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

`rebase dev` überwacht das Crons-Verzeichnis, sodass ein Job, der während der Laufzeit hinzugefügt wird, beim nächsten Reload registriert wird – kein Neustart erforderlich. (Es muss mitgeteilt werden: Das Verzeichnis wird gescannt statt importiert, daher kann der Watcher dies nicht ableiten.)

:::note
`defineCron` ist eine Identitätsfunktion – sie gibt dasselbe Objekt zurück, das Sie übergeben. Ein einfaches, standardmäßig exportiertes `CronJobDefinition`-Objekt funktioniert identisch; `defineCron` bietet lediglich eine Typprüfung zur Kompilierzeit und Editor-Autovervollständigung.
:::

Der **Dateiname** (ohne Erweiterung) wird zur eindeutigen ID des Jobs – z. B. `health-check`.


## Konfiguration

:::note[Wo dies hingehört]
**Managed Runtime** – legen Sie die Dateien in `backend/crons/` ab; die Runtime erkennt dieses Verzeichnis selbstständig, und `entry.crons` in `rebase.json` wird nur benötigt, wenn Sie es verschoben haben. `REBASE_CRON_SCHEDULER` in `.env` entscheidet, ob *dieser* Prozess die Timer ausführt.

**Ejected** – `cronsDir` bei `initializeRebaseBackend({ … })`, wie unten gezeigt, oder `crons` mit den Jobs als Werten.

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
3. Die Tabellen `rebase.cron_logs`, `rebase.cron_claims` und `rebase.cron_job_state` automatisch in PostgreSQL erstellen (sofern der Treiber SQL unterstützt)
4. Den Scheduler starten und Zähler aus vorhandenen Datenbankprotokollen initialisieren
5. Admin-REST-Routen unter `/api/admin/cron` einbinden

### Cron-Jobs als Werte

`crons` akzeptiert die Jobs als Record von Job-ID zu Definition, neben `collections`. Ein Verzeichnis ist eine Möglichkeit, dies aufzubauen: `loadCrons(dir)` liest eines genau in diese Struktur ein.

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

Geben Sie entweder `crons` oder `cronsDir` an, nicht beides: Der Start verweigert die Kombination. Das Erstellen des Backends registriert die Jobs; was ihre Timer startet, ist `start()`, das `initializeRebaseBackend` für Sie aufruft. Mit [`createRebaseBackend`](/docs/backend/custom-server/) rufen Sie es selbst auf, und zwar in dem Prozess, der sie ausführen soll. `loadCronJobsFromDirectory` und `loadCronJobsWithDiagnostics` funktionieren weiterhin, sind jedoch veraltet und geben eine einmalige Warnung aus.

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
| `0,30 * * * *` | Alle 30 Minuten (um :00 und :30) |
| `0 9-17 * * 1-5` | Stündlich, 09:00–17:00 Uhr, nur an Wochentagen |

Schrittwerte (`*/n`), Bereiche (`a-b`) und Listen (`a,b,c`) werden alle unterstützt.

Wenn sowohl der Tag des Monats als auch der Wochentag eingeschränkt sind, stimmt ein Tag überein, wenn er auf eines von beiden zutrifft, wie beim Standard-Cron: `0 9 1 * 1` läuft am 1. jedes Monats und an jedem Montag. Wenn eines der Felder mit `*` beginnt, muss ein Tag mit beiden übereinstimmen.

Ein Zeitplan wird mit der Wanduhrzeit seiner Zeitzone abgeglichen. Bei einer Umstellung auf Sommer-/Winterzeit bedeutet dies, dass ein Job mit fester Uhrzeit innerhalb der wiederholten Stunde (`30 2 * * *`, wenn die Uhren um 03:00 Uhr zurückgestellt werden) in beiden Durchläufen dieser Stunde ausgeführt wird. Ein Job innerhalb der übersprungenen Stunde, wenn die Uhren vorgestellt werden, wird an diesem Tag nicht ausgeführt.

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

Jeder Handler empfängt einen `CronJobContext`, der Hilfsmethoden und die Rebase-Client-Instanz enthält:

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

Verwenden Sie `ctx.log()`, um strukturierte Ausgaben zu erzeugen. Diese Zeilen werden im Ausführungsprotokoll erfasst und sind im Studio sowie über die REST-API sichtbar. Jede Zeile wird außerdem mit dem Level `info` und einem `cron`-Feld, das die Job-ID enthält, in das Server-Log geschrieben, sodass sie überall dort erscheint, wo die Ausgaben Ihres Containers gesammelt werden, einschließlich der Debug-Logs von Rebase Cloud. Diese Kopie wird wie die eigenen Logzeilen des Servers bereinigt: Die Werte von Schlüsseln wie `password` oder `apiKey` sowie das SQL und die Parameter einer fehlgeschlagenen Abfrage werden unkenntlich gemacht. Das Ausführungsprotokoll speichert die Zeile ohne diese Bereinigung.

Das Ausführungsprotokoll behält die ersten 500 Zeilen oder 64 KB eines Laufs (je nachdem, was zuerst eintritt) und fügt dann eine Zeile hinzu, die angibt, wie viele weitere Zeilen vorhanden waren: `… 9500 more lines not kept — see the server log`. Das Server-Log erhält jede Zeile. Ein Job, der eine Zeile pro verarbeitetem Element protokolliert, sollte damit rechnen, dass sein Verlauf nur den Beginn des Laufs anzeigt.

### `ctx.signal` — Arbeit stoppen, wenn der Lauf beendet wird

Der Timeout beendet den *Lauf*: Der Scheduler wartet nicht mehr und zeichnet einen Fehler auf. Er beendet jedoch nicht den Handler. Übergeben Sie `ctx.signal` an alles, was ein AbortSignal akzeptiert, damit die Arbeit damit beendet wird:

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

Ohne dies verliert ein Job, dessen Timeout seinem Intervall entspricht, einen verwaisten Request pro Tick – unsichtbar, da jeder Lauf bereits als fehlgeschlagen erfasst wurde.

:::note[`ctx.client` wurde entfernt]
Es war ein alternativer Name für `ctx.rebase`, und sein Typ machte `client.data` wieder zugänglich – was der Alias `RebaseServerClient` bewusst weglässt, damit die privilegierte Ebene genau einen Namen hat. Entwickler, die `client.data` hier gelernt hatten, übertrugen dies in einen Collection-Callback, wo `context.data` die Ebene mit *Benutzerkontext (user-scoped)* ist: gleiche Schreibweise, gegenteilige Berechtigungen. Verwenden Sie `ctx.rebase.dataAsAdmin`.
:::

### Interaktion mit der Datenbank und Diensten über `ctx.rebase`

`ctx.rebase.dataAsAdmin` ist die Datenebene mit Admin-Berechtigungen. Ein Cron-Job hat keinen benutzerspezifischen Anfragekontext, daher gibt es hier keine benutzerbezogene Alternative – schränken Sie die Filter jeder Abfrage selbst ein.

:::caution[Admin-Scope umgeht kein RLS]
`dataAsAdmin` wird beim Booten einmalig als `{ uid: "service", roles: ["admin"] }` konfiguriert. Jeder Lese- und Schreibvorgang wird dennoch in einer Transaktion ausgeführt, die `SET LOCAL ROLE rebase_user` mit `app.uid = 'service'` aufgerufen hat, und **Ihre Policies werden ausgewertet** – bezogen auf diese Identität. Es passiert die integrierten Standard-Policies über deren `rolesOverlap(['admin'])`-Zweig, weshalb der Unterschied selten auffällt. Er zeigt sich, wenn Sie eigene Richtlinien schreiben: `policy.serverContext()` kompiliert zu `rebase.uid() IS NULL` und ist hier daher **false**. Eine Collection mit `disableDefaultPolicies: true`, deren einzige Regel `serverContext()` ist, verweigert diese Schreibvorgänge und liefert null Zeilen – HTTP 200, leer – für diese Lesevorgänge.

`rebase.sql()` ist eine bedingungslose Umgehung: Owner-Verbindung, keine Policies.
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

Wenn Cron-Jobs konfiguriert sind, erscheint im Rebase Studio unter **Compute** neben der JS-Konsole ein Tool namens **Cron Jobs**. Das Dashboard bietet:

- **Job-Liste** — Alle registrierten Jobs mit Live-Statusanzeigen
- **Detailbereich** — Zeitplan, nächste/letzte Ausführung, Dauer und Fehlerinformationen
- **Ausführungsverlauf** — Aufklappbare Protokolleinträge mit erfasster Ausgabe und Ergebnissen
- **Manuelles Auslösen** — Führen Sie jeden Job bei Bedarf mit einem Klick aus. Das Panel wartet auf das Ende der Ausführung und meldet das Ergebnis: Bei einem fehlgeschlagenen Lauf wird der Fehler angezeigt
- **Aktivieren/Deaktivieren** — Pausieren und setzen Sie Jobs fort, ohne den Server neu zu starten, und zwar für jeden Prozess gleichzeitig; eine Pause bleibt über Neustarts und Deployments hinweg bestehen
- **Jobs, die nicht vorhanden sind** — Jeder vom Scheduler abgelehnte Job mit seinem Zeitplan und dem Grund sowie der Anzahl der Cron-Dateien, die nicht geladen werden konnten. Keiner davon wird eingeplant; siehe [Jobs, die nicht vorhanden sind](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

Das Dashboard aktualisiert sich automatisch alle 15 Sekunden.

Das Panel zeigt dieselben Informationen an, unabhängig davon, welcher Prozess sie ausliefert. Ein Job, der von einem anderen Prozess ausgeführt wird, wird als aktiv angezeigt.
Auf jedem Prozess, der über einen Speicher verfügt, werden die Ausführungsanzahl, die Fehleranzahl und der letzte Lauf aus der Datenbank gelesen, in der die Läufe aller Prozesse gezählt werden. Die eigenen Zähler eines Prozesses enthalten nur die Läufe, die er selbst durchgeführt hat: Die `api`-Rolle neben einem Worker führt nichts aus, und von zwei Replikaten, die beide planen, sieht keines die Slots, die das andere beansprucht hat. Nur wenn die Datenbank nicht gelesen werden kann, greift die Karte auf die eigenen Zähler dieses Prozesses zurück, begleitet von einer Warnung im Server-Log.

Die Zähler gelten für den gesamten Zeitraum; der Verlauf umfasst die letzten 30 Tage. Die Zeile jedes Laufs in `rebase.cron_logs` wird 30 Tage nach ihrem Beginn durch einen stündlichen Bereinigungslauf gelöscht, während die Gesamtzahlen für Ausführungen und Fehler diesen weiterhin mitzählen. Ein übersprungener Lauf zählt wie gewohnt als Ausführung: Er ist eine Zeile im Verlauf.

## Zeitplan-Validierung & AST-Parsing

Bei der Backend-Initialisierung analysiert Rebase alle registrierten Cron-Zeitpläne mithilfe eines abhängigkeitsfreien, JS-basierten Cron-Expanders:
- **Syntaxprüfung**: Überprüft, ob der String genau 5 durch Leerzeichen getrennte Felder enthält (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Bereichsexpansion**: Zerlegt Schrittweiten (`*/15`), Bereiche (`9-17`) und kommagetrennte Listen (`0,30`) in explizite Arrays gültiger Ganzzahlen, die ihren jeweiligen Grenzen zugeordnet sind (z. B. Minuten `0-59`, Stunden `0-23`, Monate `1-12`).
- **Ganzzahlige Tokens**: Jede Zahl, Bereichsgrenze und Schrittweite muss eine ganze Zahl sein: `5abc`, `*/5x` und `1.5` werden abgewiesen, ebenso wie ein rückwärts verlaufender Bereich (`5-1`).
- Wenn ein Cron-Ausdruck die Validierung nicht besteht, weist Rebase die Definition ab, protokolliert einen Startfehler und verweigert die Registrierung des Jobs, um Ausführungsfehler zur Laufzeit zu verhindern.

---

## Unter der Haube: Korrektur von Takt-Drift (Clock-Drift)

Standardmäßige intervallbasierte Scheduler (wie `setInterval`) driften mit der Zeit ab und verursachen erhebliche CPU-Spitzen aufgrund von Verzögerungen bei der Event-Loop-Planung auf Betriebssystemebene. Um die Ausführungsgenauigkeit zu gewährleisten, implementiert Rebase eine **dynamische Zielzeit-Berechnungsschleife**:
1. **Kandidatenberechnung**: Nach Abschluss eines Jobs oder beim Starten des Schedulers berechnet Rebase den genauen Zeitstempel der *nächsten* übereinstimmenden Kandidatenminute.
2. **Dynamisches Warten**: Es berechnet die Differenz in Millisekunden (`nextRun.getTime() - now.getTime()`) und plant ein einzelnes `setTimeout`.
3. **Drift-Sicherheitsschwelle**: Ein minimaler Wartepuffer (`MIN_SCHEDULE_INTERVAL_MS`) von **5.000 ms** wird erzwungen. Wenn ein Scheduler-Tick extrem schnell abgeschlossen ist, verhindert dieser Schwellenwert ein nahezu sofortiges doppeltes Auslösen.
4. **Sauberes Herunterfahren**: Timer-Handles werden mithilfe von `timer.unref()` explizit von der Node.js-Event-Loop entkoppelt, wodurch sichergestellt wird, dass Hintergrund-Cron-Scheduler eine saubere Prozessbeendigung während Deployments nicht blockieren.

---

## Mehrere Prozesse

Jeder Prozess, dessen Scheduler aktiv ist, schärft dieselben Timer; die Datenbank entscheidet, welcher davon den jeweiligen Slot ausführt. Wie ein Slot genau einmal ausgeführt wird, wie ein durch einen Neustart verlorener Slot wiederhergestellt wird, wie eine Pause jedes Replikat erreicht und warum ein manueller Auslöser niemals parallel zu einem geplanten Lauf ausgeführt wird, erfahren Sie unter [Cron über mehrere Instanzen](/docs/backend/cron-across-instances).

---

## Timeouts & Fehlerisolierung

- **Erzwungenes Timeout-Race**: Ausführungsblöcke werden in ein `Promise.race` gegen einen von `timeoutSeconds` abgeleiteten Timeout-Timer gehüllt (Standard: `300` Sekunden / 5 Minuten; `Infinity` für kein Timeout). Wenn der Handler über diesen Schwellenwert hinaus hängt, wird `ctx.signal` abgebrochen und das Promise abgewiesen, was folgenden Fehler wirft:
  `Error: Cron job "<id>" timed out after <N>ms`
  Der Abbruch ist der Teil, der die *Arbeit* stoppt; die Zurückweisung beendet lediglich das Warten des Schedulers. Ein Handler, der `ctx.signal` ignoriert, läuft über seinen eigenen Lauf hinaus weiter.
- **Herunterfahren (Shutdown)**: `backend.shutdown()` wartet auf einen laufenden Durchlauf innerhalb desselben Budgets wie die Job-Queue (zwei Drittel des Shutdown-Timeouts). Ein Lauf, der nach Ablauf dieser Zeit immer noch aktiv ist, bricht `ctx.signal` ab und wird mit dem Grund als fehlgeschlagen erfasst. Sein Slot bleibt beansprucht, sodass keine andere Instanz ihn erneut ausführt.
- **Ausfallsicheres Try/Catch**: Jeder Job-Handler läuft in einem isolierten Wrapper. Alle nicht abgefangenen Ausnahmen werden abgefangen, die Fehlermeldung (bereinigt) als String aufgezeichnet, der Job-Status auf `"error"` gesetzt und der Fehlerzähler des Jobs aktualisiert. Ein Absturz innerhalb einer einzelnen Cron-Aufgabe bringt niemals die Scheduler-Schleife oder den primären Hono-HTTP-Webserver zum Absturz.
- **In-Memory-Ringpuffer**: Der Scheduler verwaltet einen Ringpuffer, der die letzten **50 Läufe** pro Job enthält. Dieser Puffer wird im Arbeitsspeicher gehalten, um nahezu verzögerungsfreie Lesevorgänge über Rebase Studio zu ermöglichen.

---

## Datenbankschema für Persistenz

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

Jede davon wird beim Booten erstellt, falls sie fehlt; eine Datenbank aus einer früheren Version erhält sie also beim nächsten Deployment. Keine davon ist eine Collection, und die Endbenutzerrolle `rebase_user` besitzt keinerlei Rechte darauf: Ein beschreibbares `cron_job_state` würde es einem angemeldeten Benutzer ermöglichen, einen Job für alle zu pausieren oder dessen Lease zu blockieren, sodass nichts mehr ausgeführt wird.

Die Zeile eines Laufs und seine Zählung werden in einer einzigen Anweisung geschrieben: das Einfügen in `cron_logs` und ein Upsert der Zähler des Jobs in `cron_job_state`. Eine Auflistung liest unabhängig von der Länge des Verlaufs genau eine `cron_job_state`-Zeile pro Job, ebenso wie der Scheduler, wenn er `totalRuns` und `totalFailures` beim Start initialisiert. Protokollschreibvorgänge verzögern die Ausführung nicht; schlägt einer fehl, protokolliert der Scheduler den Fehler und fährt fort, während der Lauf weiterhin im In-Memory-Ringpuffer verbleibt.

Einmal pro Stunde sowie beim Start löscht der Scheduler Verlaufseinträge, die älter als 30 Tage sind, und zählt alle noch nicht gezählten Läufe – beides in Batches von 5.000 Zeilen. Ein vor Version 0.24 geschriebener Verlauf wird beim ersten dieser Durchläufe außerhalb des Boot-Pfads gezählt. Bis dieser Vorgang abgeschlossen ist, rechnet eine Auflistung die noch nicht gezählten Läufe zu den Zählern hinzu, sodass sich die Zahlen beim Upgrade nicht verändern. Dasselbe gilt für Läufe, die ein älterer Server während eines Rolling Deployments protokolliert.

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

## Crons im Ressourcengraphen

Jede Cron-Datei ist auch eine Deklaration. `rebase resources` listet sie unter dem Namen der Datei auf – derselben ID, unter der der Scheduler sie ausführt und die das Studio anzeigt – zusammen mit ihrem Zeitplan und ihrer Zeitzone, sodass ein Host die Zeitpläne eines Projekts lesen kann, bevor er etwas ausführt. Ein Cron-Job bindet keine Umgebungsvariablen; `rebase status` zeigt ihn grün an, ohne dass etwas konfiguriert werden müsste.

Das Lesen des Zeitplans erfordert das Importieren der Datei, und `rebase resources` ist ein Build-Schritt: keine `.env`, keine Secrets. Halten Sie den **Modul-Scope** eines Crons daher frei von allem, was beim Import Konfigurationen einliest – etwa ein Datenbank-Client, der am Anfang eines Helpers erstellt wird, oder eine `env.ts`, die `DATABASE_URL` validiert. Importieren Sie solche Logik stattdessen innerhalb des Handlers:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

Der Handler läuft im Deployment, wo diese Variablen existieren. Ein Top-Level-Import desselben Moduls führt dazu, dass der Graph nur auf einem Rechner abgeleitet werden kann, der zufällig über eine `.env`-Datei verfügt – und er lädt die gesamte Abhängigkeit bei jedem Bootvorgang, der den Job lediglich registriert.

Das Laden eines Crons deklariert nichts. Ein eigener Build-Schritt, der Crons im Graphen haben möchte, gibt dies mit `declareCrons` an:

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz zur Backend-Konfiguration
- **[Tabellen-Hooks](/docs/collections/callbacks)** — Logik bei Datenänderungen ausführen
- **[Webhook-Integration](/docs/recipes/webhooks)** — Benachrichtigungen bei Ereignissen senden
- **[Cron über mehrere Instanzen](/docs/backend/cron-across-instances)** — Eine Ausführung pro Slot, verpasste Slots, instanzweites Pausieren und überlappende Läufe
