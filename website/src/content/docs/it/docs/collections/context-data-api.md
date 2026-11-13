---
sourceHash: aaaaecaefd6bb6c4
title: L'API context.data
sidebar_label: API context.data
description: Leggi e scrivi su altre tabelle dall'interno di un hook di tabella con context.data — i suoi metodi, i privilegi con cui viene eseguito, la semantica delle transazioni e la connessione trattenuta da un hook.
---

Ogni [hook di tabella](/docs/collections/callbacks/) riceve un oggetto `context` che include `context.data`: il layer di dati per leggere e scrivere su **altre tabelle** dall'interno dell'hook.

## Accesso alle tabelle

`context.data` utilizza un Proxy JavaScript, quindi puoi accedere a qualsiasi tabella tramite il suo slug come proprietà:

```typescript
afterSave: async ({ values, id, context }) => {
    // Dynamic property access — works for any table slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .table() method for dynamic slugs
    const slug = "jobs";
    const accessor = context.data.table(slug);
}
```

Una proprietà è l'accessor della tabella, ovvero il nome assegnatole dall'SDK generato:
`context.data.myNotes` è la tabella il cui slug è `my-notes`, indipendentemente dalla
tabella SQL in cui è archiviata. Un nome che non corrisponde all'accessor di alcuna tabella viene letto nel suo
formato snake_case, quindi `context.data.auditLog` diventa `audit_log`.

Le righe sono prive di tipi (`Record<string, unknown>`) finché il progetto non registra il proprio
`Database` generato; a quel punto ogni accessor viene tipizzato a partire da esso. Consulta
[Dati tipizzati lato server](/docs/backend/typed-server-data).

## Metodi disponibili

Ciascun accessor di tabella (`context.data.<slug>`) fornisce i seguenti metodi:

| Metodo | Firma | Descrizione |
|--------|-------|-------------|
| `.find()` | `find(params?: FindParams) → FindResult` | Esegue query sulle righe con filtri, ordinamento e paginazione |
| `.findById()` | `findById(id: string \| number) → Row \| undefined` | Recupera una singola riga tramite ID |
| `.create()` | `create(data: Insert, id?: string \| number) → Row` | Crea una nuova riga e la restituisce così come archiviata |
| `.update()` | `update(id: string \| number, data: Update) → Row` | Aggiorna una riga esistente e la restituisce così come archiviata |
| `.delete()` | `delete(id: string \| number) → void` | Elimina un record |
| `.count()` | `count(params?: FindParams) → number` | Conta le righe corrispondenti |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Sottoscrizione in tempo reale (dove supportata) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Ascolta le modifiche a una singola riga |
| `.trash` | `trash.find()`, `.count()`, `.restore(id)`, `.restoreMany(ids)`, `.purge(id)`, `.purgeMany(ids)` | Le righe contrassegnate da un'[eliminazione soft](/docs/collections/soft-delete#from-the-sdk) |

### Limiti noti in-process

La stessa superficie su HTTP (`@rebasepro/client`) offre alcune funzionalità che
quella in-process (`context.data`, `rebase.data`, `rebase.dataAsAdmin`) non supporta.
Nulla di tutto ciò è nuovo nella versione 0.31:

- Una riga in-process non include i `_matches` di ricerca né una versione: `etagOf(row)`
  è `undefined`, quindi passa `ifMatch` ricavandolo da una riga letta tramite HTTP.
- `listenCount()` non è disponibile in-process: genera l'errore "Realtime is not
  available".
- La scorciatoia di tabella `.search(text)` non accetta `{ explain }` (il metodo `.search` del query
  builder lo accetta, ma in-process non ci sono `_matches` da restituire).

## Interrogare con `.find()`

Il metodo `find()` filtra tramite tuple `[operatore, valore]` — la forma tipizzata della
query string `?status=eq.published` letta dall'API REST:

```typescript
afterSave: async ({ values, context }) => {
    // Equality
    const { data: activeJobs } = await context.data.jobs.find({
        where: { status: ["==", "published"] },
        limit: 10,
        orderBy: ["createdAt", "desc"]
    });

    // Several conditions, AND-ed
    const { data: expensiveJobs } = await context.data.jobs.find({
        where: {
            salary: [">=", 100000],
            role: ["in", ["admin", "manager"]]
        }
    });
}
```

## Creazione di righe

`.create()` e `.update()` accettano i valori da scrivere, con le firme riportate sopra.
[Scrivere su altre tabelle](/docs/collections/callbacks/#writing-to-other-tables) li utilizza entrambi:
un invio approvato crea un lavoro pubblicato e viene collegato a quest'ultimo.

## Sicurezza: con quali privilegi viene eseguito `context.data`

:::important
**`context.data` eredita i privilegi di ciò che ha attivato l'hook.** Non si tratta di un livello di attendibilità fisso.

- Attivato da una **richiesta utente** (REST, realtime, una modifica nel CMS) → **con ambito utente (user-scoped)**. L'hook viene eseguito all'interno della transazione vincolata a RLS aperta per tale richiesta, quindi le policy si applicano sia alle letture *che* alle scritture. Un hook non può vedere una riga che il suo chiamante non poteva vedere.
- Attivato da **`rebase.dataAsAdmin` o da un cron job** (lo stesso singleton) → **con ambito admin (admin-scoped)**, non privo di ambito. Quel driver ha come ambito `{ uid: "service", roles: ["admin"] }`, quindi l'hook viene comunque eseguito su una transazione vincolata a RLS — le tue policy vengono valutate rispetto a tale identità.
- Attivato dal **driver di base** (flussi di autenticazione integrati, migrazioni) → **senza ambito (unscoped)**. Viene eseguito sulla connessione proprietaria (owner connection) e ignora RLS.
:::

Questo ha importanza soprattutto nella casistica in cui il fallimento avviene silenziosamente. RLS *filtra*, non solleva errori — quindi un hook che legge una riga correlata la troverà quando a salvare è un'attività amministrativa e potrebbe non trovare nulla quando a salvare è un utente finale, senza alcun errore in entrambi i casi. Scrivi hook che tollerino un risultato vuoto, oppure accedi deliberatamente al piano amministrativo:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a table whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    // `dataAsAdmin` is always there server-side; its type allows for the
    // browser SDK, which has none — hence the `!`.
    await context.client.dataAsAdmin!.audit_logs.create({ action: "approved" });
}
```

:::caution[`dataAsAdmin` è una seconda connessione, non fa parte di questa scrittura]
`context.client.dataAsAdmin` all'interno dell'hook di una richiesta viene eseguito in una
transazione separata, su un'altra connessione del pool, mentre la transazione della
scrittura scatenante è ancora aperta. Pertanto, esegue il commit in modo indipendente e rimane memorizzato
anche se la scrittura subisce un rollback. Inoltre non può vedere la riga in fase di salvataggio, che non è ancora
stata sottoposta a commit, e non deve scriverla:

- Una scrittura di amministrazione con una chiave esterna che punta a quella riga (un `audit_logs.article_id`
  che fa riferimento ad `articles`) fallisce il controllo della chiave, e la scrittura del chiamante fallisce
  insieme ad essa.
- Una scrittura di amministrazione sulla riga in fase di salvataggio, o su qualsiasi riga bloccata da questa scrittura,
  rimane in attesa del lock della scrittura mentre la scrittura attende l'hook. Postgres
  non è in grado di rilevarlo come un deadlock, quindi la richiesta rimane bloccata fino allo `statement_timeout`
  (30 secondi per impostazione predefinita) e poi fallisce.

Per un record che deve fare riferimento alla riga, scrivilo con `context.data`, che
sfrutta la transazione della scrittura, oppure accoda un [job](/docs/backend/jobs): un job
accodato dall'hook esegue il commit insieme alla scrittura e il suo handler viene eseguito dopo
il commit.
:::

:::caution[Questa pagina in precedenza indicava l'opposto]
Le versioni precedenti di questa pagina affermavano che gli hook (all'epoca chiamati callback) bypassavano sempre RLS e avevano "accesso completo al database indipendentemente dai permessi dell'utente che ha attivato l'operazione". Ciò era errato, ed errato nella direzione non sicura — incoraggiava la scrittura di hook basati sul presupposto di poter sempre vedere tutto.

Il comportamento sopra descritto è verificato end-to-end su Postgres dal caso `"scopes context.data to the caller when a callback runs on a user request"` all'interno della suite di verifica di RLS di `@rebasepro/server-postgres`.
:::

## Semantica delle transazioni

:::important
**Le scritture di un hook tramite `context.data` fanno parte della scrittura che lo ha attivato.** `beforeSave`, il salvataggio e `afterSave` — oppure `beforeDelete`, l'eliminazione e `afterDelete` — vengono eseguiti all'interno di una sola transazione, con ciascun hook atteso prima del commit, e `context.data` scrive tramite quella medesima transazione.
:::

Di conseguenza, la scrittura scatenante e tutto ciò che i suoi hook hanno scritto eseguono il commit insieme o non lo eseguono affatto:

- Un errore generato da `afterSave` o `afterDelete` annulla la scrittura scatenante tramite rollback, insieme a ogni scrittura effettuata con `context.data` dagli hook. Il chiamante riceve come risposta **400 `CALLBACK_REJECTED`** con `details.stage` che indica l'hook — oppure con lo stato proprio dell'errore quando ne include uno: un `RebaseApiError` generato da te, il 409 di una violazione di unicità.
- I sottoscrittori realtime ricevono notifica della riga solo dopo il commit, quindi una scrittura per cui è stato eseguito il rollback non viene mai notificata.
- Un hook mantiene la transazione aperta durante la propria esecuzione, quindi un hook lento comporta un lock trattenuto e una connessione del pool occupata — tanto per `beforeSave` e `beforeDelete` quanto per gli hook `after`. Consulta [Un hook trattiene una connessione](#un-hook-trattiene-una-connessione).
- Una scrittura tramite `context.data` esegue anche gli hook della tabella di destinazione, quindi un `afterSave` che aggiorna la propria stessa riga eseguirà nuovamente se stesso. Le scritture nidificate per più di 16 livelli vengono rifiutate con **500 `CALLBACK_RECURSION`**, indicando l'hook e la tabella, e l'intera scrittura viene annullata con un rollback. Rendi tale scrittura condizionale, come mostrato nell'esempio seguente.

Lascia che un fallimento generi un errore quando la scrittura scatenante non deve sopravvivere ad esso. Intercettalo (catch) quando invece deve sopravvivere, ma solo attorno a una **scrittura** di `context.data`: una creazione, un aggiornamento o un'eliminazione rifiutata dal database (una violazione di chiave univoca o di chiave esterna, un trigger) viene annullata singolarmente, e il resto esegue il commit.

Qualsiasi altra istruzione che fallisce sulla transazione della scrittura — una ricerca, la lettura effettuata da un aggiornamento o da un'eliminazione per individuare la propria riga (un id che la colonna chiave non può contenere), l'accodamento di un job rifiutato dal database — interrompe tale transazione in Postgres, e intercettare l'errore in JavaScript non annulla tale interruzione. La scrittura viene rifiutata con **500 `TRANSACTION_ABORTED`** e non viene salvato nulla, invece di restituire successo per una scrittura per cui è stato eseguito il rollback. Lascia che tale fallimento generi un errore, oppure verifica la condizione prima di eseguire l'istruzione.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this table again, which runs this hook
    // again: act on creates only, or it never stops.
    if (status !== "new") return;
    try {
        await context.data.jobs.create({ title: values.title, status: "published" });
    } catch (error) {
        // Only the failed create is undone. The submission and this marker commit.
        await context.data.job_submissions.update(id, {
            promotion_status: "failed",
            promotion_error: String(error)
        });
    }
}
```

Le operazioni che devono uscire dal database — un'email, un webhook, una chiamata a un'API di terze parti — non devono risiedere nel corpo dell'hook. Manterrebbero la transazione aperta per un round trip di rete, e nulla può annullarle in caso di rollback della scrittura. Accoda un [job](/docs/backend/jobs) a tale scopo, oppure esegui l'operazione dopo il ritorno della scrittura: pubblica su un [canale realtime](/docs/backend/realtime), oppure usa `waitUntil` in una [funzione personalizzata](/docs/backend/custom-functions). La documentazione sugli [Hook](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) descrive quale soluzione sia più idonea.

## Un hook trattiene una connessione

Una scrittura viene eseguita su una connessione prelevata dal pool del database, e ogni
hook viene eseguito su di essa: `beforeSave` e `beforeDelete` dopo che
la transazione è iniziata, `afterSave` e `afterDelete` prima che esegua il commit. Per tutto
il tempo in cui un hook è in esecuzione — in attesa di una ricerca, di un calcolo o di qualsiasi altra cosa — quella
connessione non serve nient'altro, e i lock acquisiti dalla scrittura rimangono attivi:
in `afterSave`, la riga appena scritta; in una scrittura bulk o [`_batch`](/docs/backend/writes/#cross-table-batches),
ogni riga scritta dalla transazione prima di essa.

Il costo corrisponde alla durata stessa dell'hook, e le scritture concorrenti la accumulano:

- Il pool gestisce 20 connessioni per impostazione predefinita (`DB_POOL_MAX`). 25 salvataggi simultanei
  il cui `beforeSave` ha atteso 300 ms hanno fatto sì che una lettura indipendente di una singola riga richiedesse 290 ms,
  trascorsi quasi interamente in attesa di una connessione.
- Una creazione bulk di 100 righe il cui `beforeSave` attende 50 ms corrisponde a un'unica transazione
  aperta per 5,3 s, che trattiene la propria connessione e i lock di ogni riga scritta
  finora per l'intera durata.

Pertanto:

- Escludi dagli hook qualsiasi operazione lenta. Una chiamata a un altro servizio appartiene a un
  [job](/docs/backend/jobs), o va eseguita dopo che la scrittura ha restituito il controllo.
- Quando possibile, recupera ciò di cui l'hook ha bisogno prima della scrittura — nel client o
  all'interno di una [funzione personalizzata](/docs/backend/custom-functions) che procede poi alla scrittura.
- Invia le righe i cui hook sono lenti suddividendole in batch più piccoli.
- Se per progettazione vengono eseguiti contemporaneamente molti hook lenti, aumenta `DB_POOL_MAX`,
  entro i limiti consentiti da `max_connections` del database per ciascuna istanza.
- Con
  `REBASE_METRICS=true`, `/metrics` riporta `rebase_db_pool_wait_ms`: il tempo
  durante il quale ciascuna query è rimasta in attesa di una connessione. Un pool in buono stato mantiene questo valore vicino allo zero; una
  coda che cresce con il traffico è indice di richieste in attesa delle connessioni trattenute
  dagli hook. Consulta [Metriche](/docs/deployment/self-hosting/#metrics).
