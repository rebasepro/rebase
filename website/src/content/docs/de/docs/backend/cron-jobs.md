---
title: Cron-Jobs
sidebar_label: Cron-Jobs
description: Planen Sie wiederkehrende Hintergrundaufgaben mit dem integrierten Cron-Job-System von Rebase. Definieren Sie Jobs als TypeScript-Dateien, überwachen Sie sie in Studio und verwalten Sie sie über die REST-API.
---

## Übersicht

Rebase enthält einen integrierten **Cron-Job-Scheduler** zum Ausführen wiederkehrender Hintergrundaufgaben — Datenbereinigung, Berichterstellung, Systemprüfungen, externe API-Synchronisationen und mehr.

Cron-Jobs folgen dem gleichen **dateibasierten Erkennungsmuster** wie benutzerdefinierte Funktionen: Legen Sie eine TypeScript-Datei in Ihrem `crons/`-Verzeichnis ab, und Rebase registriert und plant diese automatisch.

- **Null Abhängigkeiten** — Keine externen Scheduler-Bibliotheken erforderlich
- **Admin-API** — REST-Endpunkte zum Auflisten, Auslösen, Aktivieren/Deaktivieren und Anzeigen von Logs
- **Studio-Dashboard** — Alle Jobs überwachen, den Ausführungsverlauf anzeigen und Läufe manuell auslösen
- **Datenbankpersistenz** — Ausführungslogs werden in PostgreSQL gespeichert und überleben Neustarts
- **In-Memory-Cache** — Schneller Ringpuffer (letzte 50 Läufe) für das Dashboard, unterstützt durch die DB

## Definieren eines Cron-Jobs

Erstellen Sie eine Datei in Ihrem `backend/crons/`-Verzeichnis, die einen `CronJobDefinition` als Standard-Export enthält:

```typescript
// backend/crons/health-check.ts
import type { CronJobDefinition } from "@rebasepro/types";

const job: CronJobDefinition = {
    schedule: "*/5 * * * *",     // alle 5 Minuten
    name: "System Health Check",
    description: "Überwacht die Betriebszeit und Speicherauslastung",

    async handler(ctx) {
        ctx.log("Führe Systemprüfung aus...");

        const uptime = process.uptime();
        const mem = process.memoryUsage();

        ctx.log(`Uptime: ${Math.round(uptime)}s`);
        ctx.log(`Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`);

        return {
            uptimeSeconds: Math.round(uptime),
            heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        };
    },
};

export default job;
```

Der **Dateiname** (ohne Erweiterung) wird zur eindeutigen ID des Jobs — z.B. `health-check`.

## Konfiguration

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
2. Jeden Standard-Export als Cron-Job registrieren
3. Die Tabelle `rebase.cron_logs` in PostgreSQL automatisch erstellen (falls der Treiber SQL unterstützt)
4. Den Scheduler starten und Zähler aus vorhandenen DB-Logs initialisieren
5. Admin-REST-Routen unter `/api/cron` bereitstellen

## Zeitplan-Syntax

Cron-Ausdrücke verwenden das Standard-**5-Feld-Format**:

```
┌───────────── Minute (0–59)
│ ┌─────────── Stunde (0–23)
│ │ ┌───────── Tag des Monats (1–31)
│ │ │ ┌─────── Monat (1–12)
│ │ │ │ ┌───── Wochentag (0–6, Sonntag = 0)
│ │ │ │ │
* * * * *
```

| Expression | Bedeutung |
|------------|---------|
| `* * * * *` | Jede Minute |
| `0 * * * *` | Jede Stunde |
| `0 3 * * *` | Täglich um 3:00 Uhr morgens |
| `0 0 * * 1` | Jeden Montag um Mitternacht |
| `0 9 1 * *` | Am ersten Tag jedes Monats um 9:00 Uhr morgens |
| `0,30 * * * *` | Alle 30 Minuten (um :00 und :30) |
| `0 9-17 * * 1-5` | Stündlich, 9 Uhr morgens – 17 Uhr nachmittags, nur an Wochentagen |

Schrittwerte (`*/n`), Bereiche (`a-b`) und Listen (`a,b,c`) werden alle unterstützt.

## CronJobDefinition Referenz

`timezone` ist neu <span class="since-badge" data-since="0.18">Since 0.18</span> — in 0.17.3 wird ein Zeitplan immer in der Zone des
Hosts gelesen. Alles Übrige an dieser Schnittstelle ist bereits ausgeliefert.

```typescript
interface CronJobDefinition {
    // Cron-Zeitplan-Ausdruck (5-Feld-Format)
    schedule: string;

    // Im Studio angezeigter, menschenlesbarer Name
    name: string;

    // Optionale Beschreibung, die im Studio angezeigt wird
    description?: string;

    // Ob der Job aktiviert startet (Standard: true)
    enabled?: boolean;

    // Maximale Ausführungszeit in Sekunden (Standard: 300)
    timeoutSeconds?: number;

    // Die Funktion, die bei jedem Tick ausgeführt wird
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

## Handler-Kontext

Jeder Handler erhält einen `CronJobContext`:

```typescript
interface CronJobContext {
    // Die eindeutige ID des Jobs (abgeleitet vom Dateinamen)
    jobId: string;

    // Der Zeitstempel des geplanten Ticks
    scheduledAt: Date;

    // Logger — erfasste Zeilen erscheinen im Studio und in der Logs-API
    log: (...args: unknown[]) => void;
}
```

Verwenden Sie `ctx.log()`, um strukturierte Ausgaben zu erzeugen. Diese Zeilen werden im Ausführungs-Log erfasst und sind im Studio sowie über die REST-API sichtbar.

:::tip
Der Handler kann jeden JSON-serialisierbaren Wert zurückgeben. Dieser wird im Log-Eintrag als `result` gespeichert und in der Ausführungsverlauf des Studios angezeigt.
:::

## REST-API

Alle Cron-Routen erfordern eine **Admin-Authentifizierung** (`requireAuth` + `requireAdmin`).

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/cron` | Alle registrierten Cron-Jobs auflisten |
| `GET` | `/api/cron/:id` | Status eines einzelnen Jobs abrufen |
| `POST` | `/api/cron/:id/trigger` | Einen Job manuell auslösen |
| `GET` | `/api/cron/:id/logs` | Ausführungsverlauf abrufen (`?limit=N`) |
| `PUT` | `/api/cron/:id` | Einen Job aktivieren/deaktivieren (`{ "enabled": true }`) |

### Beispiel: Alle Jobs auflisten

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/cron
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

### Beispiel: Einen Job manuell auslösen

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    http://localhost:3001/api/cron/health-check/trigger
```

## Client-SDK

Das Rebase Client-SDK stellt einen `cron`-Namespace für alle Operationen bereit:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3001" });

// Alle Jobs auflisten
const { jobs } = await client.cron.listJobs();

// Einen einzelnen Job abrufen
const { job } = await client.cron.getJob("health-check");

// Manuell auslösen
const { log, job: updated } = await client.cron.triggerJob("health-check");

// Ausführungsverlauf anzeigen
const { logs } = await client.cron.getJobLogs("health-check", { limit: 10 });

// Aktivieren oder deaktivieren
await client.cron.toggleJob("health-check", false); // pausieren
await client.cron.toggleJob("health-check", true);  // fortsetzen
```

## Studio-Dashboard

Wenn Cron-Jobs konfiguriert sind, erscheint im Rebase Studio unter dem Abschnitt **Automatisierung** ein Tool namens **Cron-Jobs**. Das Dashboard bietet:

- **Jobliste** — Alle registrierten Jobs mit Live-Statusindikatoren
- **Detailbereich** — Zeitplan, nächster/letzter Lauf, Dauer und Fehlerinformationen
- **Ausführungsverlauf** — Erweiterbare Log-Einträge mit erfasster Ausgabe und Ergebnissen
- **Manueller Auslöser** — Jeden Job bei Bedarf mit einem Klick ausführen
- **Aktivieren/Deaktivieren** — Jobs anhalten und fortsetzen, ohne den Server neu zu starten

Das Dashboard aktualisiert sich alle 15 Sekunden automatisch.

## Persistenz

Wenn der Datenbanktreiber SQL unterstützt (z.B. PostgreSQL), werden Ausführungs-Logs **automatisch** in einer `rebase.cron_logs`-Tabelle **gespeichert**. Das bedeutet:

- Der Ausführungsverlauf **überlebt Server-Neustarts** und Deployments
- Die Zähler `totalRuns` und `totalFailures` werden beim Start **aus der Datenbank initialisiert**
- Der `/api/cron/:id/logs`-Endpunkt fragt die Datenbank ab, nicht nur den In-Memory-Speicher
- Mehrere Server-Instanzen teilen sich denselben Ausführungsverlauf

Die Tabelle wird beim ersten Start automatisch erstellt — keine Migrationen erforderlich.

:::tip
Die Persistenz ist nicht blockierend. Schlägt ein Datenbank-Schreibvorgang fehl, läuft der Scheduler weiter, und der In-Memory-Logpuffer steht weiterhin als Fallback zur Verfügung.
:::

## Fehlerbehandlung & Timeouts

- Wenn ein Handler einen Fehler **auslöst**, wird der Fehler im Log-Eintrag erfasst und der Job-Status auf `"error"` gesetzt. Der Scheduler läuft weiter — der nächste geplante Tick wird trotzdem ausgeführt.
- Wenn ein Handler `timeoutSeconds` (Standard: 300) überschreitet, wird er mit einem Timeout-Fehler beendet.
- Alle Ausführungsmetriken (Erfolgszähler, Fehlerzähler, letzter Fehler) werden pro Job verfolgt und sind über die API zugänglich.
- Fehlgeschlagene Persistenz-Schreibvorgänge werden protokolliert, bringen den Scheduler jedoch niemals zum Absturz.

## Beispiel: Täglicher Bereinigungs-Job

```typescript
// backend/crons/cleanup-sessions.ts
import type { CronJobDefinition } from "@rebasepro/types";
import { rebase } from "@rebasepro/server";

const job: CronJobDefinition = {
    schedule: "0 3 * * *",  // täglich um 3 Uhr morgens
    name: "Abgelaufene Sitzungen bereinigen",
    description: "Entfernt Benutzersitzungen, die älter als 30 Tage sind",

    async handler(ctx) {
        ctx.log("Starte Sitzungsbereinigung...");

        // Verwenden Sie den Rebase-Singleton für den Datenbankzugriff auf Admin-Ebene
        const count = Math.floor(Math.random() * 50); // Platzhalter

        ctx.log(`${count} abgelaufene Sitzungen bereinigt`);

        return { deletedSessions: count };
    },
};

export default job;
```

## Nächste Schritte

- **[Backend-Übersicht](/docs/backend)** — Vollständige Referenz zur Backend-Konfiguration
- **[Entitäts-Callbacks](/docs/collections/callbacks)** — Logik bei Datenänderungen ausführen
- **[Webhook-Integration](/docs/recipes/webhooks)** — Benachrichtigungen bei Ereignissen senden
