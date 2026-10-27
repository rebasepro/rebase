---
sourceHash: 3e450f0960514c50
title: "Cron-Jobs-API"
sidebar_label: "Cron-Jobs-API"
description: "Cron-Jobs über die REST-API oder mit dem client.cron des typisierten SDK auflisten, auslösen, pausieren und fortsetzen."
---

## REST-API

Lesen braucht den Scope `cron:read`. Auslösen, Pausieren und Fortsetzen brauchen
`cron:write`. Ein Admin hält beide. Ebenso eine Person, deren Rolle sie deklariert, und
ein API-Schlüssel, der mit ihnen erstellt wurde – genau das sollte ein externer Scheduler tragen:

```bash
rebase api-keys create -n "Scheduler" --scopes cron:read,cron:write
```

Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/).

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/admin/cron` | Alle registrierten Cron-Jobs auflisten |
| `GET` | `/api/admin/cron/:id` | Status eines einzelnen Jobs abrufen |
| `POST` | `/api/admin/cron/:id/trigger` | Einen Job manuell auslösen — `409`, solange er bereits läuft. `?async=1` antwortet mit `202`, sobald der Lauf gestartet ist |
| `GET` | `/api/admin/cron/:id/logs` | Ausführungsverlauf abrufen (`?limit=N`), die letzten 30 Tage davon. `503`, wenn `rebase.cron_logs` nicht gelesen werden kann, statt eines leeren Verlaufs |
| `PUT` | `/api/admin/cron/:id` | Einen Job überall pausieren oder fortsetzen (`{ "enabled": false }`); `null` folgt wieder dem Code |

### Beispiel: Alle Jobs auflisten

`$TOKEN` ist ein Zugriffstoken für ein Konto, das `cron:read` hält: Melden Sie sich an und verwenden Sie das `accessToken`, das die Login-Antwort zurückgibt. Ein API-Schlüssel, der den Scope hält, funktioniert genauso. `$API_URL` ist das, was `rebase dev` ausgegeben hat – der Port wird vom Projektpfad abgeleitet, es gibt also keinen festen Port.

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
    "note": "1 cron file(s) failed to load and 1 job(s) were refused — NOT scheduled. See `rejected` for the reason; the server log has the rest."
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

Der Aufruf wartet, bis der Lauf beendet ist, und antwortet mit `200` und seinem Log. Für einen Job, der
länger läuft, als ein Proxy vor dem Server eine Anfrage hält (viele brechen nach 60 Sekunden ab), fügen Sie
`?async=1` hinzu. Die Antwort ist dann `202`, sobald der Lauf gestartet ist:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/nightly-report/trigger?async=1"
```

```json
{
    "accepted": true,
    "startedAt": "2026-04-24T08:21:04.512Z",
    "job": { "id": "nightly-report", "state": "running" }
}
```

Der Lauf geht nach der Antwort weiter. Sein Ergebnis steht in `GET /api/admin/cron/:id/logs`, als
Eintrag mit `"manual": true` und demselben `startedAt`. Ein Lauf, der nicht starten kann, antwortet weiterhin
mit `409`. `?async` akzeptiert `1`, `true`, `0` oder `false`; jeder andere Wert ergibt `400`.

### Einen Job pausieren

Eine Pause aus Studio oder per
`PUT /api/admin/cron/:id` gilt für jeden Prozess und bleibt über Neustarts und
Redeploys hinweg bestehen; `{ "enabled": null }` gibt den Job an das `enabled`
zurück, das seine Datei deklariert. Wie jede Replik sie liest und was passiert,
wenn eine das nicht kann, steht unter
[Cron über mehrere Instanzen](/docs/backend/cron-across-instances/#pausing-a-job-across-every-process).

## Typisiertes SDK

Das typisierte SDK von Rebase stellt einen `cron`-Namespace für alle Operationen bereit:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

// List all jobs, and the ones that did not register
const { jobs, rejected } = await client.cron.listJobs();

// Get a single job
const { job } = await client.cron.getJob("health-check");

// Trigger manually, and wait for the run
const { log, job: updated } = await client.cron.triggerJob("health-check");

// Trigger manually, and answer once the run has started
const { startedAt } = await client.cron.triggerJob("nightly-report", { async: true });

// View execution history
const { logs } = await client.cron.getJobLogs("health-check", { limit: 10 });

// Enable or disable
await client.cron.toggleJob("health-check", false); // pause
await client.cron.toggleJob("health-check", true);  // resume
```

`triggerJob()` wartet, bis der Lauf beendet ist, und antwortet mit seinem Log. Ein Proxy vor dem
Server kann die Antwort eines langen Jobs abschneiden (viele tun das nach 60 Sekunden), während der Lauf
selbst weiterläuft. Übergeben Sie für einen solchen Job `{ async: true }`: Der Aufruf antwortet, sobald der Lauf
gestartet ist, und `getJobLogs()` hat das Ergebnis, als Eintrag mit `manual: true` und dem zurückgegebenen `startedAt`.

`listJobs()` ist als `CronJobListing` typisiert: `jobs`, dazu die Felder `skipped`,
`rejected` und `note`, die unter [Jobs, die nicht vorhanden sind](#jobs-die-nicht-vorhanden-sind) beschrieben sind.
