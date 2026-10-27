---
sourceHash: d672b029e72aca9e
title: L'API context.data
sidebar_label: API context.data
description: Leggi e scrivi altre collection dall'interno di un callback con context.data — i suoi metodi, i privilegi con cui viene eseguito, la semantica transazionale e la connessione che un callback occupa.
---

Ogni callback riceve un oggetto `context` che include `context.data` — un livello unificato di accesso ai dati per eseguire **operazioni tra collezioni** dall'interno degli hook del ciclo di vita.

## Accesso alle Collezioni

`context.data` utilizza un Proxy JavaScript, quindi puoi accedere a qualsiasi collezione tramite il suo slug come proprietà:

```typescript
afterSave: async ({ values, id, context }) => {
    // Dynamic property access — works for any collection slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .collection() method for dynamic slugs
    const collectionName = "jobs";
    const accessor = context.data.collection(collectionName);
}
```

Una proprietà è l'accessor della collection, il nome che l'SDK generato le dà:
`context.data.myNotes` è la collection `my-notes`, qualunque sia la tabella in cui è
archiviata. Un nome che non è l'accessor di nessuna collection viene letto come il suo snake_case,
quindi `context.data.auditLog` è `audit_log`.

Le righe non sono tipizzate (`Record<string, unknown>`) finché il progetto non registra il suo
`Database` generato; da quel momento ogni accessor è tipizzato a partire da esso. Vedi
[Dati lato server tipizzati](/docs/backend/typed-server-data).

## Metodi Disponibili

Ogni funzione di accesso alla collezione (`context.data.<slug>`) fornisce questi metodi:

| Metodo | Firma | Descrizione |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResult` | Interroga entità con filtri, ordinamento e paginazione |
| `.findById()` | `findById(id: string \| number) → Row \| undefined` | Recupera una singola riga per ID |
| `.create()` | `create(data: Insert, id?: string \| number) → Row` | Crea una nuova riga e la restituisce come memorizzata |
| `.update()` | `update(id: string \| number, data: Update) → Row` | Aggiorna una riga esistente e la restituisce come memorizzata |
| `.delete()` | `delete(id: string \| number) → void` | Elimina un record |
| `.count()` | `count(params?: FindParams) → number` | Conta le entità corrispondenti |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Sottoscrizione in tempo reale (dove supportato) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Ascolta una singola entità |
| `.trash` | `trash.find()`, `.count()`, `.restore(id)`, `.restoreMany(ids)`, `.purge(id)`, `.purgeMany(ids)` | Le righe che un [soft delete](/docs/collections/soft-delete#from-the-sdk) ha contrassegnato |

## Interrogare con `.find()`

Il metodo `find()` filtra con tuple `[operator, value]` — la forma tipizzata della stringa di query `?status=eq.published` letta dall'API REST:

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

## Creazione di Entità

`.create()` e `.update()` prendono i valori da scrivere, con le firme indicate sopra. [Sincronizzazione dei dati tra collezioni](/docs/collections/callbacks#syncing-data-between-collections) usa entrambi: una candidatura approvata crea un'offerta di lavoro pubblicata e viene ricollegata a essa.

## Sicurezza: con quali privilegi viene eseguito `context.data`

:::important
**`context.data` eredita i privilegi di ciò che ha attivato il callback.** Non si tratta di un livello di attendibilità fisso.

- Attivato da una **richiesta utente** (REST, realtime, una modifica dal pannello di amministrazione) → **con ambito utente**. Il callback viene eseguito all'interno della transazione vincolata a RLS aperta per quella richiesta, pertanto le policy si applicano sia alle letture *che* alle scritture. Un callback non può vedere una riga che il suo chiamante non potrebbe vedere.
- Attivato da **`rebase.dataAsAdmin` o da un cron job** (lo stesso singleton) → **con ambito admin**, non privo di ambito. Quel driver ha come ambito `{ uid: "service", roles: ["admin"] }`, quindi il callback viene comunque eseguito su una transazione vincolata a RLS — le tue policy vengono valutate a fronte di tale identità.
- Attivato dal **driver di base** (flussi di autenticazione integrati, migrazioni) → **senza ambito**. Viene eseguito sulla connessione proprietaria e ignora RLS.
:::

Questo ha un impatto notevole soprattutto nel caso che fallisce silenziosamente. RLS *filtra*, non solleva errori — quindi un callback che legge una riga di pari livello la troverà quando salva un'attività di amministrazione e potrebbe non trovare nulla quando salva un utente finale, senza alcun errore in entrambi i casi. Scrivi callback che tollerano un risultato vuoto, oppure ricorri deliberatamente al piano di amministrazione:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a collection whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    // `dataAsAdmin` is always there server-side; its type allows for the
    // browser SDK, which has none — hence the `!`.
    await context.client.dataAsAdmin!.audit_logs.create({ action: "approved" });
}
```

:::caution[`dataAsAdmin` è una seconda connessione, non fa parte di questa scrittura]
Su Postgres, `context.client.dataAsAdmin` all'interno del callback di una richiesta viene eseguito in una transazione a sé, su un'altra connessione del pool, mentre la transazione della scrittura scatenante è ancora aperta. Quindi esegue il commit per conto proprio, e rimane anche se la scrittura subisce un rollback. Inoltre non può vedere la riga in fase di salvataggio, che non è ancora stata confermata, e non deve scriverla:

- Una scrittura admin con una chiave esterna che rimanda a quella riga (un `audit_logs.article_id` che fa riferimento ad `articles`) non supera il controllo della chiave, e la scrittura del chiamante fallisce con essa.
- Una scrittura admin sulla riga in fase di salvataggio, o su qualsiasi riga che questa scrittura ha bloccato, attende il lock della scrittura mentre la scrittura attende il callback. Postgres non può riconoscerlo come un deadlock, quindi la richiesta resta sospesa fino a `statement_timeout` (30 secondi per impostazione predefinita) e poi fallisce.

Per un record che deve fare riferimento alla riga, scrivilo con `context.data`, che viaggia sulla transazione della scrittura, oppure accoda un [job](/docs/backend/jobs): un job accodato dal callback viene confermato insieme alla scrittura, e il suo handler viene eseguito dopo il commit.
:::

:::caution[Questa pagina indicava precedentemente il contrario]
Le versioni precedenti di questa pagina indicavano che i callback ignoravano sempre RLS e avevano "pieno accesso al database indipendentemente dai permessi dell'utente che li ha attivati". Questo non era corretto, ed era errato nella direzione non sicura — induceva a scrivere callback partendo dal presupposto che potessero sempre vedere tutto.

Il comportamento descritto sopra è verificato end-to-end su Postgres dal caso `"scopes context.data to the caller when a callback runs on a user request"` all'interno della suite di verifica RLS di `@rebasepro/server-postgres`.
:::

## Semantica delle Transazioni

:::important
**Le scritture di `context.data` di un callback fanno parte della scrittura che lo ha attivato.** Su Postgres, `beforeSave`, il salvataggio e `afterSave` — oppure `beforeDelete`, l'eliminazione e `afterDelete` — vengono eseguiti all'interno di un'unica transazione, ogni callback viene atteso prima del commit e `context.data` scrive tramite quella stessa transazione.
:::

Di conseguenza, la scrittura scatenante e tutto ciò che i suoi callback hanno scritto vengono confermati insieme oppure per niente:

- Un errore lanciato da `afterSave` o `afterDelete` annulla la scrittura scatenante, insieme a ogni scrittura di `context.data` effettuata dai callback. Al chiamante viene restituito **400 `CALLBACK_REJECTED`** con `details.stage` che indica il nome dell'hook — o con lo stato stesso dell'errore quando ne include uno: un `RebaseApiError` che hai lanciato, il 409 per violazione di unicità.
- I sottoscrittori realtime ricevono la notifica della riga solo dopo il commit, pertanto una scrittura che ha subito un rollback non viene mai annunciata.
- Un callback mantiene aperta la transazione durante la sua esecuzione, quindi un callback lento equivale a un blocco trattenuto e a una connessione del pool impegnata — `beforeSave` e `beforeDelete` tanto quanto gli hook `after`. Vedi [Un callback tiene una connessione](#un-callback-tiene-una-connessione).
- Una scrittura di `context.data` esegue anche i callback della collezione di destinazione, quindi un `afterSave` che aggiorna la propria riga esegue nuovamente se stesso. Le scritture annidate per più di 16 livelli vengono rifiutate con **500 `CALLBACK_RECURSION`**, indicando l'hook e la collezione, e l'intera scrittura subisce un rollback. Rendi condizionale una scrittura di questo tipo, come fa l'esempio sotto.

Lascia che un fallimento generi un'eccezione quando la scrittura scatenante non deve sopravvivere ad esso. Intercettalo quando invece deve sopravvivere, ma solo attorno a una **scrittura** di `context.data`: una creazione, un aggiornamento o un'eliminazione che il database rifiuta (una violazione di unicità o di chiave esterna, un trigger) viene annullata da sola, e il resto viene salvato tramite commit.

Qualsiasi altra istruzione che fallisce sulla transazione della scrittura — una ricerca, la lettura che un aggiornamento o un'eliminazione effettua per trovare la propria riga (un id che la colonna chiave non può contenere), l'accodamento di un job rifiutato dal database — interrompe quella transazione in Postgres, e intercettare l'errore in JavaScript non lo annulla. La scrittura viene rifiutata con **500 `TRANSACTION_ABORTED`** e non viene memorizzato nulla, anziché rispondere con un successo per una scrittura che ha subito un rollback. Lascia che un fallimento di questo tipo generi un'eccezione, oppure verifica la condizione prima di eseguire l'istruzione.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this collection again, which runs this callback
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

Le operazioni che devono uscire dal database — un'email, un webhook, una chiamata a un'API di terze parti — non appartengono al corpo del callback. Manterrebbero la transazione aperta per un tempo di andata e ritorno sulla rete, e nulla potrebbe annullarle in caso di rollback della scrittura. Accoda un [job](/docs/backend/jobs) a questo scopo, oppure eseguile dopo che la scrittura ha restituito la risposta: pubblica su un [canale realtime](/docs/backend/realtime), oppure usa `waitUntil` in una [funzione personalizzata](/docs/backend/custom-functions). La sezione [Hook](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) descrive quale soluzione sia più adatta.

Su MongoDB nulla di tutto questo è valido. Quel driver esegue gli stessi callback senza una transazione, pertanto la scrittura è già archiviata quando viene eseguito `afterSave`, e un'eccezione generata lì segnala il fallimento senza annullarla.

## Un callback tiene una connessione

Su Postgres una scrittura viene eseguita su una connessione prelevata dal pool del database,
e ogni callback viene eseguito su di essa: `beforeSave` e `beforeDelete` dopo che la
transazione è iniziata, `afterSave` e `afterDelete` prima del suo commit. Per tutto il
tempo in cui un callback è in esecuzione — in attesa di una ricerca, di un calcolo, di qualsiasi cosa — quella
connessione non serve nient'altro, e i lock che la scrittura ha preso restano presi:
in `afterSave`, la riga appena scritta; in una scrittura bulk o [`_batch`](/docs/backend/writes/#cross-collection-batches),
ogni riga che la transazione ha scritto prima.

Il costo è la durata propria del callback, e le scritture concorrenti la sommano:

- Il pool contiene 20 connessioni per impostazione predefinita (`DB_POOL_MAX`). 25 salvataggi
  contemporanei il cui `beforeSave` attendeva 300 ms hanno fatto durare 290 ms una lettura
  di una riga non correlata, quasi tutti spesi ad attendere una connessione.
- Una creazione bulk di 100 righe il cui `beforeSave` attende 50 ms è una transazione
  aperta per 5,3 s, che tiene la sua connessione e i lock di ogni riga scritta
  finora per tutto quel tempo.

Quindi:

- Tieni fuori dai callback tutto ciò che è lento. Una chiamata a un altro servizio appartiene a un
  [job](/docs/backend/jobs), o a dopo il ritorno della scrittura.
- Cerca ciò di cui un hook ha bisogno prima della scrittura quando puoi — nel client, o
  in una [funzione personalizzata](/docs/backend/custom-functions) che poi scrive.
- Invia le righe i cui hook sono lenti in bulk più piccoli.
- Se molti hook lenti sono eseguiti insieme per progetto, alza `DB_POOL_MAX`, entro quanto
  il `max_connections` del database consente per ogni istanza.
- Con
  `REBASE_METRICS=true`, `/metrics` riporta `rebase_db_pool_wait_ms`: quanto
  ha atteso ogni query per una connessione. Un pool sano lo tiene vicino a zero; una
  coda che cresce con il traffico sono richieste in attesa di connessioni che i callback
  tengono. Vedi [Metriche](/docs/deployment/self-hosting/#metrics).
