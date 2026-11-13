---
sourceHash: 9e21b0515cf58869
title: Job in background
sidebar_label: Job in background
description: "Una coda di job persistente basata su Postgres: lavoro che sopravvive a un riavvio, ritentato con backoff, con i fallimenti conservati anziché scartati."
---

## Panoramica

Un job è una riga in `rebase.jobs`. Viene preso in carico da esattamente un worker, ritentato con un ritardo progressivo se il suo handler lancia un'eccezione, e lasciato nella tabella quando i tentativi si esauriscono definitivamente, consentendo a qualcuno di esaminarlo.

Non c'è nulla da installare e nulla da eseguire insieme a Postgres. Un job accodato all'interno di una transazione che esegue un rollback non viene mai effettivamente accodato.

Utilizzalo per le attività che non devono andare perdute e non devono essere eseguite durante la gestione di una richiesta HTTP: inviare email, chiamare un servizio di terze parti, generare un file, eseguire la riconciliazione con un sistema esterno.

| | Esecuzione | Sopravvive a un riavvio |
|---|---|---|
| [Cron](/docs/backend/cron-jobs) | Su pianificazione | Sì — la pianificazione è nel codice |
| **Job** | Una volta, non appena un worker è libero | **Sì — il job è una riga** |
| Un `setTimeout` in una callback | Una volta, in questo processo | No |

## Abilitazione

:::note[Dove va inserito]
**Runtime gestito** — da nessuna parte. `jobs` accetta *funzioni* di gestione (handler), che nessuna variabile d'ambiente e nessun export di `backend/storage.ts` o `backend/hooks.ts` può contenere, quindi un progetto generato tramite scaffold non può abilitare la coda. Esegui `rebase eject` (o scrivi un [server personalizzato](/docs/backend/custom-server/)) per accedervi. `REBASE_JOB_WORKERS` nel file `.env` decide solo se i worker di una coda già abilitata vengono eseguiti in *questo* processo.

**Ejected** — il blocco `jobs` in `initializeRebaseBackend({ … })`, come mostrato di seguito.

La mappa completa si trova in [Panoramica del backend](/docs/backend/#where-each-option-lives).
:::

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

Disabilitato a meno che non venga richiesto: un worker continua a cercare lavoro per tutta la durata del processo, il che non è un comportamento predefinito scelto a priori. Richiede un driver in grado di eseguire SQL — su uno che non può, la coda non è disponibile e la notifica avviene all'avvio anziché al primo accodamento.

Un worker inattivo non effettua il polling ogni due secondi. Ogni accodamento invia un `NOTIFY` sul canale `rebase_jobs` al momento del commit, e un worker con un `LISTEN` attivo su di esso prende subito in carico il job — un'attività accodata da un altro processo (il ruolo `api`, un'altra replica) si avvia entro pochi millisecondi, e una ritardata al momento della scadenza. Oltre a questo, controlla comunque ogni 30 secondi. Un job accodato da questo processo, un retry pianificato o un job recuperato lo risvegliano senza necessità di notifiche.

Il comando `LISTEN` necessita di una connessione dedicata, individuata nello stesso modo in cui il realtime ne trova una: `DATABASE_DIRECT_URL` se impostata, altrimenti `DATABASE_URL`. Dietro a un pooler in modalità transazione come PgBouncer, imposta `DATABASE_DIRECT_URL`: un pooler non mantiene un `LISTEN`, e i job provenienti da altri processi dovrebbero altrimenti attendere il controllo periodico ogni 30 secondi. Dove non è presente alcuna connessione di questo tipo (il database di sviluppo in-process), un worker inattivo applica invece un backoff: controlla dopo `pollIntervalMs` (2 secondi), poi attende il doppio del tempo dopo ogni controllo andato a vuoto, fino a 30 secondi, e ricomincia da capo ogni volta che trova lavoro. Un worker inattivo effettua circa 2.900 tentativi di presa in carico al giorno anziché 43.200.

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

`idempotencyKey` raggruppa un doppio clic, una richiesta ritentata e due istanze che reagiscono allo stesso evento in un unico job. Il suo ambito è limitato al lavoro non completato, quindi la chiave diventa riutilizzabile una volta che il job è terminato — altrimenti "il digest notturno per l'utente 7" potrebbe essere inviato una sola volta in assoluto. Un accodamento duplicato si risolve in `null` anziché lanciare un'eccezione: il lavoro richiesto è in coda, che è esattamente il risultato desiderato.

## Gestione dei fallimenti

Un handler fallisce lanciando un'eccezione. Non esiste `return false` — un booleano verrebbe ignorato silenziosamente da qualsiasi handler che dimenticasse di restituirne uno, e il fallimento deve essere il comportamento ottenuto per impostazione predefinita.

- **Tentativi rimanenti** → torna a `pending`, con `run_at` posticipato dal backoff (1s, 5s, 25s … limitato a un'ora; sovrascrivibile con `backoff`).
- **Nessun tentativo rimasto** → `failed`, e la riga *rimane*. Una coda che scarta silenziosamente ciò che non è riuscita a consegnare è indistinguibile da una che non ha nulla da fare.
- **Un fallimento che nessun retry può risolvere** → lancia `PermanentJobError`, da `@rebasepro/server`: il job passa a `failed` a questo tentativo, con il messaggio impostato come `last_error`, invece di consumare i tentativi rimanenti.

```sql
SELECT task, attempts, last_error, updated_at
FROM rebase.jobs WHERE status = 'failed'
ORDER BY updated_at DESC;
```

Le righe fallite vengono conservate per 30 giorni; quelle completate per 3. Ogni worker elimina le righe scadute al momento dell'avvio e successivamente ogni ora, in batch, al di fuori del percorso di gestione delle richieste.

## Cosa succede quando un worker muore

Un processo arrestato a metà di un job non può rilasciare la propria presa in carico (claim), quindi solo un timeout potrà liberare la riga. Mentre un handler è in esecuzione, il suo worker rinnova il claim a intervalli pari a un terzo di `visibilityTimeoutMs` (predefinito a 5 minuti). Un claim che rimane per tutto quel tempo senza essere rinnovato viene riacquisito — torna a `pending` se il job ha ancora tentativi a disposizione, altrimenti viene inviato in dead-letter con un errore che ne illustra l'accaduto.

Di conseguenza, un handler lento su un worker attivo mantiene il proprio job, per quanto tempo possa richiedere, e il timeout decide soltanto con quale rapidità vengono recuperati i job di un worker terminato. Inoltre, un tentativo che ha perso il proprio claim non può sovrascrivere l'esito del job: il suo successo o fallimento viene registrato nei log e scartato, mentre è il tentativo che detiene il claim a determinarne l'esito finale.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // the first wait after a look that found nothing; it doubles up to 30 s
    visibilityTimeoutMs: 300_000 // how long an unrenewed claim holds
}
```

### Un handler che non termina mai

Il rovescio della medaglia: un handler in attesa di una chiamata `fetch` che non risponde mai occupa il proprio slot nel worker, e il suo claim, per tutta la durata del processo — con cinque handler di questo tipo il worker non eseguirà più nient'altro, mentre `/health` rimarrà verde.
`timeoutMs` delimita la durata di un singolo tentativo. Al raggiungimento della scadenza il tentativo fallisce — ritentato finché rimangono tentativi, come per qualsiasi eccezione lanciata — il suo slot viene liberato e il `signal` dell'handler viene interrotto (`aborted`). Inoltra il signal in modo che anche il lavoro si interrompa; un handler che lo ignora continuerà a essere eseguito in background senza che nulla ne registri l'esito.

Se omesso, il valore predefinito è di 15 minuti (`900_000`), e il worker lo segnala con una riga di log all'avvio. Un job che legittimamente richiede più tempo può specificare un proprio valore, e `timeoutMs: 0` rimuove ogni limite.

```typescript no-verify
jobs: {
    enabled: true,
    timeoutMs: 120_000,          // one attempt; 15 minutes when left out, 0 for no limit
    tasks: {
        "sync-crm": async ({ payload, signal }) => {
            await fetch(crmUrl, { method: "POST", body: JSON.stringify(payload), signal });
        }
    }
}
```

Gli handler della coda e le sottoscrizioni ai topic ricevono lo stesso `signal` all'interno del proprio contesto.

## Più istanze

Sicuro per progettazione. I worker acquisiscono i job con `SELECT … FOR UPDATE SKIP LOCKED`, in modo che ogni job vada a esattamente uno di essi e gli altri passino alla riga successiva anziché accodarsi dietro di essa. Non è necessario eleggere alcun leader.

Un'istanza prende in carico solo i task per cui possiede un handler. Durante un rolling deploy, un'istanza che esegue il codice precedente non tocca i job il cui task è implementato esclusivamente dal codice più recente: rimangono in stato `pending`, con i relativi tentativi intatti, finché un'istanza aggiornata non li prende in carico. Anche un task che nessuna istanza implementa rimane in stato `pending`, anziché essere inviato in dead-letter.

## Scansione degli orfani dello storage

`rebase storage orphans` viene eseguito su questa coda quando è attiva: ogni scansione, e ogni eliminazione derivante da una scansione, è un job `storage.orphans`, con un solo tentativo. Il backend registra autonomamente l'handler in ogni processo con lo storage configurato, e viene eseguito solo dai processi in cui i job worker sono attivi. Una scansione è vincolata da `timeoutMs` come qualsiasi altro job, quindi una sorgente troppo grande per essere esaminata in 15 minuti richiede un `timeoutMs` più alto, oppure 0. In assenza della coda, il server esegue invece la scansione all'interno del proprio processo. Consulta [la CLI](/docs/cli/#rebase-storage).

## Webhook persistenti

[`WebhookDispatcher`](/docs/recipes/webhooks) accoda le proprie consegne in memoria per impostazione predefinita, il che significa che un crash o un deploy tra la modifica e la consegna provoca la perdita dell'evento. Assegnagli la coda e ciascuna consegna diventerà una riga nel database:

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never, ctx));
```

Sul job viene memorizzato solo l'**id** del webhook, mai il webhook stesso — altrimenti il suo segreto di firma rimarrebbe in chiaro in `rebase.jobs` per tutta la durata del periodo di retention della riga, mentre un webhook modificato tra l'accodamento e la consegna deve essere inoltrato con lo stato attuale. Passare `ctx` come secondo argomento fa sì che ogni tentativo invii il proprio header `X-Webhook-Attempt`; ogni tentativo relativo a una determinata consegna invia lo stesso `X-Webhook-Delivery`, consentendo al destinatario di deduplicare i tentativi ripetuti.

Una consegna che il dispatcher rifiuta di inviare (una destinazione di loopback, link-local, privata o non-`http(s)`), o una a cui il destinatario risponde con un redirect, fallisce nello stesso modo a ogni tentativo. Viene inviata in dead-letter dopo un solo tentativo, con la motivazione memorizzata in `last_error`. Qualsiasi altro fallimento viene ritentato normalmente come qualsiasi job.

## Shutdown

`shutdown()` impedisce al worker di acquisire nuovi job e attende il completamento di quelli in corso, garantendo che un deploy non esegua due volte la parte finale di un batch. L'attesa è limitata a due terzi del timeout di shutdown (10 secondi rispetto ai 15 predefiniti), evitando che un handler che non termina mai possa bloccare l'arresto. Un job ancora in esecuzione al termine di questo periodo mantiene il proprio claim e viene recuperato dal timeout di visibilità.

## Passaggi successivi

- **[Cron Jobs](/docs/backend/cron-jobs)** — lavoro su pianificazione
- **[Webhooks](/docs/recipes/webhooks)** — notifica altri sistemi in caso di modifiche
