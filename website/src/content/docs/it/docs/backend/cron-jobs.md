---
sourceHash: 9df2202ffe55b40c
title: Lavori Cron
sidebar_label: Lavori Cron
description: Pianifica attività in background ricorrenti con il sistema di lavori cron integrato di Rebase. Definisci i lavori come file TypeScript, monitorali in Studio e gestiscili tramite l'API REST.
---

## Panoramica

Rebase include uno **scheduler di lavori cron** integrato per l'esecuzione di attività in background ricorrenti — pulizia dati, generazione di report, controlli di integrità, sincronizzazioni API esterne e altro ancora.

I lavori cron seguono lo stesso schema di **rilevamento basato su file** delle funzioni personalizzate: inserisci un file TypeScript nella tua directory `crons/`, e Rebase lo registrerà e pianificherà automaticamente.

- **Zero dipendenze** — Non sono richieste librerie scheduler esterne
- **API di amministrazione** — Endpoint REST per elencare, attivare, abilitare/disabilitare e visualizzare i log
- **Dashboard di Studio** — Monitora tutti i lavori, visualizza la cronologia di esecuzione e attiva manualmente le esecuzioni
- **Persistenza nel database** — I log di esecuzione vengono memorizzati in PostgreSQL, sopravvivendo ai riavvii
- **Cache in memoria** — Buffer circolare veloce (ultime 50 esecuzioni) per la dashboard, supportato dal DB

## Definizione di un lavoro Cron

Crea un file nella tua directory `backend/crons/` che esporta di default una `CronJobDefinition`:

```typescript
// backend/crons/health-check.ts
import type { CronJobDefinition } from "@rebasepro/types";

const job: CronJobDefinition = {
    schedule: "*/5 * * * *",     // ogni 5 minuti
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
};

export default job;
```

Il **nome del file** (senza estensione) diventa l'ID univoco del lavoro — ad es., `health-check`.

## Configurazione

Abilita i lavori cron aggiungendo `cronsDir` alla tua configurazione backend:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← aggiungi questo
});
```

Questo è tutto. Rebase farà quanto segue:

1. Scansiona la directory alla ricerca di file `.ts` / `.js`
2. Registra ogni export di default come lavoro cron
3. Crea automaticamente la tabella `rebase.cron_logs` in PostgreSQL (se il driver supporta SQL)
4. Avvia lo scheduler e inizializza i contatori dai log DB esistenti
5. Monta le rotte REST di amministrazione su `/api/admin/cron`

## Sintassi della pianificazione

Le espressioni Cron utilizzano il **formato standard a 5 campi**:

```
┌───────────── minuto (0–59)
│ ┌─────────── ora (0–23)
│ │ ┌───────── giorno del mese (1–31)
│ │ │ ┌─────── mese (1–12)
│ │ │ │ ┌───── giorno della settimana (0–6, Domenica = 0)
│ │ │ │ │
* * * * *
```

| Espressione | Significato |
|---|---|
| `* * * * *` | Ogni minuto |
| `0 * * * *` | Ogni ora |
| `0 3 * * *` | Ogni giorno alle 3:00 del mattino |
| `0 0 * * 1` | Ogni lunedì a mezzanotte |
| `0 9 1 * *` | Primo giorno di ogni mese alle 9:00 del mattino |
| `0,30 * * * *` | Ogni 30 minuti (ai :00 e :30) |
| `0 9-17 * * 1-5` | Ogni ora, dalle 9:00 alle 17:00, solo nei giorni feriali |

Sono supportati valori di passo (`*/n`), intervalli (`a-b`) ed elenchi (`a,b,c`).

## Riferimento CronJobDefinition

`timezone` è nuovo <span class="since-badge" data-since="0.18">Since 0.18</span> — in 0.17.3 una pianificazione viene sempre letta nel
fuso dell'host. Tutto il resto di questa interfaccia è già rilasciato.

```typescript
interface CronJobDefinition {
    // Espressione di pianificazione Cron (formato a 5 campi)
    schedule: string;

    // Nome leggibile dall'uomo mostrato in Studio
    name: string;

    // Descrizione opzionale mostrata in Studio
    description?: string;

    // Se il lavoro viene avviato abilitato (predefinito: true)
    enabled?: boolean;

    // Tempo massimo di esecuzione in secondi (predefinito: 300)
    timeoutSeconds?: number;

    // La funzione da eseguire ad ogni tick
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

## Contesto dell'Handler

Ogni handler riceve un `CronJobContext`:

```typescript
interface CronJobContext {
    // L'ID univoco del lavoro (derivato dal nome del file)
    jobId: string;

    // Il timestamp del tick pianificato
    scheduledAt: Date;

    // Logger — le righe catturate appaiono in Studio e nell'API dei log
    log: (...args: unknown[]) => void;
}
```

Usa `ctx.log()` per emettere output strutturato. Queste righe vengono catturate nel log di esecuzione e sono visibili in Studio e tramite l'API REST.

:::tip
L'handler può restituire qualsiasi valore serializzabile in JSON. Verrà memorizzato nella voce di log come `result` e visualizzato nella cronologia di esecuzione di Studio.
:::

## API REST

Tutte le rotte cron richiedono **autenticazione amministrativa** (`requireAuth` + `requireAdmin`).

| Metodo | Percorso | Descrizione |
|---|---|---|
| `GET` | `/api/admin/cron` | Elenca tutti i lavori cron registrati |
| `GET` | `/api/admin/cron/:id` | Ottieni lo stato di un singolo lavoro |
| `POST` | `/api/admin/cron/:id/trigger` | Attiva manualmente un lavoro |
| `GET` | `/api/admin/cron/:id/logs` | Ottieni la cronologia di esecuzione (`?limit=N`) |
| `PUT` | `/api/admin/cron/:id` | Abilita/disabilita un lavoro (`{ "enabled": true }`) |

### Esempio: Elenca tutti i lavori

`$TOKEN` è un token di accesso amministratore: accedi e usa l'`accessToken` restituito dalla risposta di login. `$API_URL` è l'URL stampato da `rebase dev` — la porta è derivata dal progetto e non è fissa.

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

### Esempio: Attiva un lavoro manualmente

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/health-check/trigger"
```

## SDK del client

L'SDK client di Rebase espone un namespace `cron` per tutte le operazioni:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

// Elenca tutti i lavori
const { jobs } = await client.cron.listJobs();

// Ottieni un singolo lavoro
const { job } = await client.cron.getJob("health-check");

// Attiva manualmente
const { log, job: updated } = await client.cron.triggerJob("health-check");

// Visualizza la cronologia di esecuzione
const { logs } = await client.cron.getJobLogs("health-check", { limit: 10 });

// Abilita o disabilita
await client.cron.toggleJob("health-check", false); // metti in pausa
await client.cron.toggleJob("health-check", true);  // riprendi
```

## Dashboard di Studio

Quando i lavori cron sono configurati, uno strumento **Lavori Cron** appare in Rebase Studio sotto la sezione **Automazione**. La dashboard fornisce:

- **Elenco lavori** — Tutti i lavori registrati con indicatori di stato in tempo reale
- **Pannello dettagli** — Pianificazione, prossima/ultima esecuzione, durata e informazioni sugli errori
- **Cronologia esecuzioni** — Voci di log espandibili con output e risultati catturati
- **Attivazione manuale** — Esegui qualsiasi lavoro su richiesta con un click
- **Abilita/disabilita** — Metti in pausa e riprendi i lavori senza riavviare il server

La dashboard si aggiorna automaticamente ogni 15 secondi.

## Persistenza

Quando il driver del database supporta SQL (ad es. PostgreSQL), i log di esecuzione vengono **automaticamente persistiti** in una tabella `rebase.cron_logs`. Questo significa:

- La cronologia di esecuzione **sopravvive ai riavvii del server** e ai deploy
- I contatori `totalRuns` e `totalFailures` vengono **inizializzati dal database** all'avvio
- L'endpoint `/api/admin/cron/:id/logs` interroga il database, non solo la memoria
- Più istanze server condividono la stessa cronologia di esecuzione

La tabella viene creata automaticamente al primo avvio — nessuna migrazione necessaria.

:::tip
La persistenza non è bloccante. Se una scrittura nel database fallisce, lo scheduler continua a funzionare e il buffer di log in memoria è comunque disponibile come fallback.
:::

## Gestione degli errori e timeout

- Se un handler **genera un errore**, l'errore viene catturato nella voce di log e lo stato del lavoro viene impostato su `"error"`. Lo scheduler continua a funzionare — il prossimo tick programmato verrà comunque attivato.
- Se un handler supera `timeoutSeconds` (predefinito: 300), viene terminato con un errore di timeout.
- Tutte le metriche di esecuzione (conteggio successi, conteggio fallimenti, ultimo errore) sono tracciate per lavoro e accessibili tramite l'API.
- Le scritture persistenti fallite vengono registrate ma non mandano mai in crash lo scheduler.

## Esempio: Lavoro di pulizia giornaliero

```typescript
// backend/crons/cleanup-sessions.ts
import type { CronJobDefinition } from "@rebasepro/types";
import { rebase } from "@rebasepro/server";

const job: CronJobDefinition = {
    schedule: "0 3 * * *",  // ogni giorno alle 3 del mattino
    name: "Cleanup Expired Sessions",
    description: "Removes user sessions older than 30 days",

    async handler(ctx) {
        ctx.log("Starting session cleanup...");

        // Usa il singleton rebase per l'accesso al database a livello di amministratore
        const count = Math.floor(Math.random() * 50); // segnaposto

        ctx.log(`Cleaned up ${count} expired sessions`);

        return { deletedSessions: count };
    },
};

export default job;
```

## Passi successivi

- **[Panoramica Backend](/docs/backend)** — Riferimento completo alla configurazione backend
- **[Callback delle Entità](/docs/collections/callbacks)** — Esegui logica sulle modifiche dei dati
- **[Integrazione Webhook](/docs/recipes/webhooks)** — Invia notifiche sugli eventi
---
