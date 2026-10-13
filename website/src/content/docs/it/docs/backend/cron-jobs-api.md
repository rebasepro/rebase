---
sourceHash: 3e450f0960514c50
title: "API dei Cron Job"
sidebar_label: "API dei Cron Job"
description: "Elenca, avvia, metti in pausa e riprendi i cron job tramite l'API REST, oppure con il client.cron dell'SDK tipizzato."
---

## API REST

La lettura richiede lo scope `cron:read`. L'avvio, la sospensione e la ripresa richiedono
`cron:write`. Un admin li possiede entrambi. Li possiede anche una persona il cui ruolo li dichiara, e
una chiave API creata con essi, che è ciò che dovrebbe usare uno scheduler esterno:

```bash
rebase api-keys create -n "Scheduler" --scopes cron:read,cron:write
```

Vedi [Ruoli e scope](/docs/backend/roles-and-scopes/).

| Metodo | Percorso | Descrizione |
|--------|----------|-------------|
| `GET` | `/api/admin/cron` | Elenca tutti i cron job registrati |
| `GET` | `/api/admin/cron/:id` | Recupera lo stato di un singolo job |
| `POST` | `/api/admin/cron/:id/trigger` | Avvia manualmente un job — `409` mentre è già in esecuzione. `?async=1` risponde `202` appena l'esecuzione è partita |
| `GET` | `/api/admin/cron/:id/logs` | Ottieni la cronologia delle esecuzioni (`?limit=N`), degli ultimi 30 giorni. `503` quando `rebase.cron_logs` non può essere letto, anziché una cronologia vuota |
| `PUT` | `/api/admin/cron/:id` | Mette in pausa o riprende un job ovunque (`{ "enabled": false }`); `null` torna a seguire il codice |

### Esempio: Elencare tutti i job

`$TOKEN` è un token di accesso per un account che possiede `cron:read`: effettua il login e usa l'`accessToken` restituito dalla risposta di autenticazione. Una chiave API che possiede lo scope funziona allo stesso modo. `$API_URL` corrisponde a quanto stampato da `rebase dev` — la porta viene calcolata in base al percorso del progetto, quindi non ce n'è una fissa.

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

### Job non presenti

Un job che non viene mai attivato non è presente in `jobs` — nulla lo ha registrato — quindi "il mio cron manca" e "il mio cron non verrà mai eseguito" appaiono identici da questo endpoint a meno che non indichi diversamente. Ed è così:

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

`rejected` riporta il nome del job e il motivo. Un file che non è stato possibile *caricare* ha solo un conteggio: l'errore si è verificato prima che ci fosse un job da nominare, quindi il motivo si trova nei log del server.

Il caso più comune è quello sopra indicato: sei campi, derivati da un'espressione copiata da uno strumento che supporta i secondi. Rebase ne accetta cinque; rimuovi il primo campo. Qui compare anche un `timeoutSeconds` pari a zero, negativo o `NaN`.

### Esempio: Avviare manualmente un job

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/health-check/trigger"
```

Mentre il job è in esecuzione — qui o in qualsiasi altro processo —, la risposta
è `409` con il codice `CRON_JOB_ALREADY_EXECUTING`; vedi
[Protezione della concorrenza](/docs/backend/cron-across-instances/#concurrency-guarding).

La chiamata attende la fine dell'esecuzione e risponde `200` con il suo log. Per un job che dura
più di quanto un proxy davanti al server mantenga aperta una richiesta (molti si fermano a 60 secondi),
aggiungi `?async=1`. La risposta è allora `202`, appena l'esecuzione è partita:

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

L'esecuzione prosegue dopo la risposta. Il suo esito è in `GET /api/admin/cron/:id/logs`, come la
voce con `"manual": true` e lo stesso `startedAt`. Un'esecuzione che non può partire risponde
comunque `409`. `?async` accetta `1`, `true`, `0` o `false`; qualsiasi altro valore è un `400`.

### Mettere in pausa un job

Una pausa da Studio o tramite
`PUT /api/admin/cron/:id` vale per ogni processo e resta valida dopo riavvii e
nuovi deploy; `{ "enabled": null }` restituisce il job all'`enabled` dichiarato
nel suo file. Come ogni replica la legge, e cosa succede quando una non può, è
descritto in [Cron su più istanze](/docs/backend/cron-across-instances/#pausing-a-job-across-every-process).

## SDK tipizzato

L'SDK tipizzato di Rebase espone un namespace `cron` per tutte le operazioni:

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

`triggerJob()` attende la fine dell'esecuzione e risponde con il suo log. Un proxy davanti al
server può interrompere la risposta di un job lungo (molti lo fanno a 60 secondi) mentre l'esecuzione
prosegue. Per un job di questo tipo passa `{ async: true }`: la chiamata risponde appena l'esecuzione è partita,
e `getJobLogs()` contiene l'esito, come la voce con `manual: true` e il `startedAt` restituito.

`listJobs()` è tipizzato `CronJobListing`: `jobs`, più i campi `skipped`,
`rejected` e `note` descritti in [Job non presenti](#job-non-presenti).
