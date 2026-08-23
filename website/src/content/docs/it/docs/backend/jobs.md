---
title: Job in background
sidebar_label: Job in background
description: Una coda di job persistente basata su Postgres — lavoro che sopravvive a un riavvio, ritentato con backoff, con i fallimenti conservati anziché eliminati.
---

## Panoramica

Un job è una riga in `rebase.jobs`. Viene acquisito da esattamente un worker, ritentato con un ritardo progressivo se il suo handler genera un errore, e lasciato nella tabella quando alla fine si arrende, in modo che qualcuno possa esaminarlo.

Non c'è nulla da installare e nulla da eseguire insieme a Postgres. Un job accodato all'interno di una transazione che esegue un rollback non è mai stato accodato.

Usalo per attività che non devono essere perse e che non devono essere eseguite all'interno di una richiesta: inviare email, chiamare terze parti, generare un file, riconciliare dati con un sistema esterno.

| | Esecuzione | Sopravvive a un riavvio |
|---|---|---|
| [Cron](/docs/backend/cron-jobs) | Pianificata | Sì — la pianificazione è nel codice |
| **Job** | Una volta, non appena un worker è libero | **Sì — il job è una riga** |
| Un `setTimeout` in un callback | Una volta, in questo processo | No |

## Abilitazione

```typescript no-verify
await initializeRebaseBackend({
    jobs: {
        enabled: true,
        tasks: {
            "send-welcome": async ({ payload }) => {
                await sendEmail((payload as { email: string }).email);
            }
        }
    }
});
```

Disabilitato se non richiesto esplicitamente: un worker interroga continuamente il database tramite polling, un comportamento che non è una scelta predefinita desiderabile per tutti. Richiede un driver in grado di eseguire SQL — su uno che non può farlo (MongoDB), la coda non è disponibile e ti viene segnalato all'avvio anziché al primo inserimento in coda.

## Accodamento

```typescript no-verify
const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true, tasks } });

await jobQueue?.enqueue("send-welcome", { email: "ada@example.com" });
```

### Opzioni

```typescript no-verify
await jobQueue?.enqueue("send-digest", { userId: "u7" }, {
    delayMs: 60_000,               // not before a minute from now
    maxAttempts: 5,                // default 3
    idempotencyKey: "digest:u7"    // at most one *unfinished* job with this key
});
```

`idempotencyKey` raggruppa un doppio clic, una richiesta ritentata e due istanze che reagiscono allo stesso evento in un unico job. Il suo ambito è limitato al lavoro non completato, quindi la chiave diventa riutilizzabile una volta completato il job — altrimenti "il digest notturno per l'utente 7" sarebbe inviabile esattamente una sola volta in assoluto. Un accodamento duplicato si risolve in `null` anziché generare un errore: il lavoro richiesto è in coda, che è il risultato desiderato.

## Fallimenti

Un handler fallisce sollevando un'eccezione (throwing). Non esiste alcun `return false` — un booleano verrebbe ignorato silenziosamente da ogni handler che si dimentica di restituirne uno, e il fallimento deve essere il comportamento predefinito in caso di errore.

- **Tentativi rimanenti** → torna a `pending`, con `run_at` posticipato dal backoff (1s, 5s, 25s … con un limite massimo di un'ora; sovrascrivibile con `backoff`).
- **Tentativi esauriti** → `failed`, e la riga *rimane*. Una coda che elimina silenziosamente ciò che non è riuscita a consegnare è indistinguibile da una che non ha nulla da fare.

```sql
SELECT task, attempts, last_error, updated_at
FROM rebase.jobs WHERE status = 'failed'
ORDER BY updated_at DESC;
```

Le righe con esito negativo vengono conservate per 30 giorni; quelle riuscite per 3.

## Cosa succede quando un worker si arresta

Un processo terminato durante l'esecuzione di un job non può rilasciare la presa in carico (claim), quindi solo un timeout potrà liberare la riga. I job bloccati per un tempo superiore a `visibilityTimeoutMs` (predefinito: 5 minuti) vengono recuperati — tornando a `pending` se hanno ancora tentativi disponibili, altrimenti spostati in dead-letter con un errore che spiega l'accaduto.

Questo è anche il motivo per cui il timeout deve essere superiore al tuo handler più lento: oltre tale limite, un secondo worker potrebbe avviare un job che il primo sta ancora eseguendo.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // when the last look found nothing
    visibilityTimeoutMs: 300_000 // must exceed the slowest handler
}
```

## Istanze multiple

Sicuro per progettazione. I worker acquisiscono i job con `SELECT … FOR UPDATE SKIP LOCKED`, quindi ogni job viene assegnato a uno solo di essi e gli altri passano alla riga successiva invece di mettersi in coda dietro di essa. Non è necessario eleggere alcun leader.

Durante un rolling deploy, a un'istanza che esegue codice precedente verranno assegnati job di cui non implementa il task. Questi vengono rimessi in coda anziché contrassegnati come falliti, in modo da essere eseguiti non appena un'istanza aggiornata li prende in carico.

## Webhook persistenti

Per impostazione predefinita, [`WebhookDispatcher`](/docs/recipes/webhooks) accoda i suoi invii in memoria; questo significa che un crash o un deploy tra la modifica e l'invio comporterebbe la perdita dell'evento. Assegnagli la coda e ogni invio diventerà una riga:

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never));
```

Sul job viene memorizzato solo l'**id** del webhook, mai il webhook stesso — altrimenti il suo segreto di firma rimarrebbe in chiaro in `rebase.jobs` per tutto il periodo di retention della riga, e un webhook modificato tra l'accodamento e l'invio deve essere inviato con la configurazione attuale.

## Arresto

`shutdown()` impedisce al worker di acquisire nuovi job e attende il completamento di quelli in corso (in flight), evitando che un deploy esegua due volte la coda di un batch. Qualsiasi operazione ancora in esecuzione quando il processo termina mantiene il proprio blocco e viene recuperata dal timeout di visibilità.

## Passaggi successivi

- **[Cron Jobs](/docs/backend/cron-jobs)** — lavoro pianificato
- **[Webhooks](/docs/recipes/webhooks)** — invia notifiche ad altri sistemi in caso di modifiche

---
