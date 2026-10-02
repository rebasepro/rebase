---
sourceHash: c1478b42d3c890a5
title: Callback delle Entità
sidebar_label: Callback
description: Usa i callback del ciclo di vita per eseguire logica personalizzata quando le entità vengono create, aggiornate, lette o eliminate. Include l'API context.data per operazioni tra collezioni.
---

## Panoramica

I callback ti consentono di agganciarti al ciclo di vita delle entità per:

- **Sincronizzare i dati tra le collezioni** — copiare o spostare entità tra tabelle al variare dello stato
- **Trasformare i dati** prima del salvataggio (campi calcolati, generazione di slug)
- **Validare** le regole di business oltre la validazione dello schema
- **Attivare effetti collaterali** dopo le scritture (inviare email, sincronizzare API, aggiornare cache)
- **Restringere una lettura** prima che venga compilata, in modo che un chiamante veda sempre e solo le proprie righe
- **Filtrare/trasformare** i dati dopo la lettura
- **Operazioni a cascata** — ripulire i record correlati durante l'eliminazione

## Dove vengono eseguiti i callback

Una collezione ha due blocchi di callback, e l'unica differenza è quale runtime li esegue.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Eseguito su | il server | il pannello di amministrazione, nel browser |
| Scatenato per | REST, l'SDK, realtime, `dataAsAdmin` | letture e scritture effettuate dal pannello |
| Raggiunge il browser | no — i corpi vengono rimossi dal bundle | sì, per intero |
| Utilizzare per | tutto ciò che segue | collezioni con cui il pannello comunica direttamente |

**`callbacks` è quello che desideri.** Viene eseguito su ogni percorso dati che raggiunge il server — REST, l'SDK, realtime, MCP e `rebase.data` — e il suo corpo non lascia mai la macchina, quindi una chiave API o una lettura di `process.env` lì è sicura. Il resto di questa pagina riguarda `callbacks`.

Un writer non è un percorso dati: **il sistema di autenticazione**. La registrazione, l'accesso OAuth e la gestione utenti dell'admin scrivono direttamente le righe utente e non eseguono nessuno dei loro callback, quindi un'email di benvenuto in `afterSave` su `users` non si attiva mai alla registrazione. Agganciala invece agli [hook di autenticazione](/docs/backend/authentication/) passati in `auth.hooks` — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` — che richiedono un backend ottenuto con `rebase eject`; l'avvio avvisa quando la collezione users dichiara callback che la registrazione non eseguirà.

`admin.browserCallbacks` esiste per un solo caso: una collezione su un trasporto `direct` o `custom`, che il pannello legge e scrive *autonomamente* senza alcun server Rebase nel percorso della richiesta. Nulla lato server vede queste operazioni, quindi `callbacks` non potrà mai essere attivato per esse, e questo blocco è l'unico posto in cui può risiedere la loro logica del ciclo di vita.

```typescript
import type { CollectionConfig } from "@rebasepro/types";

const eventsCollection: CollectionConfig = {
    slug: "events",
    name: "Events",
    dataSource: "analytics",      // declared with transport: "direct"
    properties: {
        city: { name: "City", type: "string" },
        code: { name: "Code", type: "string" }
    },
    admin: {
        browserCallbacks: {
            afterRead: ({ row }) => ({ ...row, label: [row.city, row.code].join(" · ") })
        }
    }
};
```

Due regole derivano dal fatto che "viene inviato a ogni visitatore", e nessuna delle due è una questione di stile:

1. **Nessun segreto.** Niente chiavi API, niente `process.env`, nulla che ti dispiacerebbe venisse visto da chi esamina il bundle. Quello appartiene a `callbacks`.
2. **Non è un perimetro di sicurezza.** Un `browserCallbacks.afterRead` che oscura un campo lo oscura *dopo* che il browser possiede già la riga — su un trasporto diretto il documento grezzo proviene direttamente dallo store. È una questione di presentazione. L'oscuramento che deve rimanere saldo va in `callbacks`, o nelle regole stesse dello store.

Su una collezione con trasporto server — l'impostazione predefinita, e quasi certamente la tua — il server ha già eseguito `callbacks` prima che la riga raggiunga il pannello, quindi un `browserCallbacks.afterRead` viene eseguito *in aggiunta* ad esso. Scrivilo in modo che sia idempotente, oppure non scriverlo affatto.

## Definizione dei Callback

```typescript
import { defineCollection } from "@rebasepro/cms-types";

// The row shape is inferred from `properties`, so `values.title` below is a
// `string` without anything being written twice.
const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { name: "Title", type: "string" },
        slug: { name: "Slug", type: "string" },
        createdAt: { name: "Created at", type: "string" },
        updatedAt: { name: "Updated at", type: "string" }
    },
    callbacks: {
        beforeSave: async ({ values, id, status }) => {
            // Auto-generate slug from title
            if (values.title) {
                values.slug = values.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/(^-|-$)/g, "");
            }

            // Set timestamps
            if (status === "new") {
                values.createdAt = new Date().toISOString();
            }
            values.updatedAt = new Date().toISOString();

            return values;
        },

        afterSave: async ({ values, id }) => {
            // Send notification
            console.log(`Article ${id} saved: ${values.title}`);
        },

        beforeDelete: async ({ id }) => {
            // Prevent deletion of published articles
            // Throw to block the deletion
        },

        afterRead: async ({ row }) => {
            // Transform data after loading
            return row;
        }
    }
});
```

## Riferimento dei Callback

### `beforeQuery`

Chiamato **prima che una lettura venga compilata**, per restringere quali righe richiede. Restituisce le condizioni da combinare in AND nella query; non restituire nulla per non aggiungerne alcuna.

```typescript
beforeQuery: ({
    operation,   // "list" | "get" | "count" | "aggregate" | "relation"
    query,       // the parsed read, read-only
    context
}) => {
    if (context.user?.roles?.includes("admin")) return;
    return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
}
```

`afterRead` vede le righe che sono già state recuperate, quindi può oscurare un valore ma non può impedire che la riga venga letta. Questo viene eseguito prima, e ci sono tre aspetti utili da sapere al riguardo:

- **Può solo restringere.** Il valore restituito è un filtro da combinare in AND, e nessun valore che può restituire amplia la lettura. `filter` accetta gli stessi filtri di campo di una query; `logical` accetta un gruppo `or`/`and`, per un ambito come "i miei, o condivisi con me" — sempre combinato in AND nel suo complesso, quindi l'`or` sceglie solo tra le righe che il resto della query già ammette.
- **Si attiva su ogni percorso di lettura.** L'elenco, il get singolo, il count, l'aggregazione, la ricerca, la lettura vettoriale, un elenco su percorso annidato, il refetch realtime alla base di un `.listen()`, e le righe caricate per una relazione o un `?include=` — dove è l'hook della collezione **di destinazione** ad essere applicato, perché quelle sono le righe della destinazione.
- **Un filtro che non può compilare rifiuta la richiesta.** Indicare una colonna che la tabella non possiede genera un 400, mai una condizione ignorata.
- **Una scrittura su una riga che esclude genera un 404.** Un aggiornamento o un'eliminazione indirizzati a una riga al di fuori dell'ambito vengono rifiutati prima della scrittura, con la stessa risposta "nessuna riga …" restituita da una lettura — quindi un ambito è un ambito anche per le scritture, non solo per le letture. Ciò che *non* controlla sono i valori che vengono scritti: il rifiuto di una scrittura in base al suo contenuto spetta a `beforeSave`.

Una lettura è deliberatamente non ristretta: il controllo di unicità alla base di `validation: { unique: true }`. Essa verifica se un valore esiste in qualsiasi punto della tabella e, se ristretta, risponderebbe "univoco" per un valore che una riga nascosta contiene già.

:::caution[Solo per Postgres, per ora]
`beforeQuery` è implementato da `@rebasepro/server-postgres`. Una collezione servita da MongoDB o Firestore che ne dichiara uno **fallisce all'avvio**, per nome, anziché essere servita con l'hook silenziosamente inattivo — il che per un filtro di riga significherebbe servire ogni riga a chiunque. Un `beforeQuery` [globale](/docs/backend/hooks) fallisce all'avvio nello stesso modo se una qualsiasi origine dati non è Postgres, e lo stesso vale per uno collegato in seguito con `setCollectionCallbacks`. L'oscuramento che funziona su ogni motore è [`afterRead`](#afterread).
:::

→ Consulta [Estendere il server](/docs/backend/extending#2-collection-callbacks) per capire dove questo si posiziona tra le altre opzioni.

### `beforeSave`

Chiamato prima che un record venga scritto nel database. Restituisce i valori modificati.

```typescript
beforeSave: async ({
    values,       // Entity values
    id,           // Entity ID (null for new entities)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Lancia un errore per **bloccare il salvataggio**. La scrittura non raggiunge mai il database, e il chiamante riceve un **400** con il tuo messaggio e il codice `CALLBACK_REJECTED`:

```typescript
beforeSave: async ({ values }) => {
    if (values.price < 0) {
        throw new Error("Price cannot be negative");
    }
    return values;
}
```

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

Per scegliere autonomamente lo stato e il codice — un 409 per un conflitto, un 422 per qualcosa di ben formato ma inaccettabile — lancia un `RebaseApiError`:

```typescript
import { RebaseApiError } from "@rebasepro/types";

beforeSave: async ({ values }) => {
    if (await isTaken(values.slug)) {
        throw new RebaseApiError("That slug is taken", { status: 409, code: "SLUG_TAKEN" });
    }
    return values;
}
```

:::note
Importalo da `@rebasepro/types`, non da `@rebasepro/server`. Un file di collezione è condiviso con il frontend — la build Vite del pannello di amministrazione legge questa stessa directory — pertanto può importare solo pacchetti eseguibili in un browser. `RebaseApiError` è quello compatibile con il browser, ed è la stessa classe lanciata dall'SDK tipizzato.
:::

### `afterSave`

Chiamato dopo che la riga è stata scritta e prima del commit, all'interno della stessa transazione. Un errore lanciato annulla il salvataggio (rollback) — vedi [Semantica delle transazioni](#transaction-semantics).

```typescript
afterSave: async ({
    values,         // Saved values: the row as stored, not afterRead's view of it
    id,             // Entity ID
    previousValues, // Previous values (undefined for new entities)
    status,         // "new" | "existing" | "copy"
    context
}) => {
    // Same transaction as the save: the log row commits with the article or not at all
    await context.data.audit_log.create({ action: status, article_id: id, title: values.title });
}
```

### `afterSaveError`

Chiamato quando un'operazione di salvataggio fallisce.

```typescript
afterSaveError: async ({
    values,
    id,
    error,
    context
}) => {
    console.error("Save failed:", error);
}
```

Viene eseguito per un salvataggio fallito a livello di database o successivamente — non per un rifiuto di `beforeSave`, una richiesta rifiutata prima della scrittura (validazione, un permesso mancante, un 404), o un commit rifiutato dopo che il salvataggio è stato restituito ([elenco completo](/docs/backend/hooks/#when-aftersaveerror-runs)).

In una richiesta, viene eseguito una volta completato il rollback della transazione della scrittura fallita, non al suo interno. Il suo `context.data` è un'istanza nuova per lo stesso chiamante, in cui ogni chiamata è una transazione a sé, quindi un [job](/docs/backend/jobs), un messaggio di coda o un webhook che accoda viene confermato con un commit e sopravvive al fallimento che segnala. Un errore lanciato da `afterSaveError` viene registrato nei log, e il chiamante riceve comunque l'errore del salvataggio stesso.

### `afterRead`

Chiamato dopo aver letto le entità dal database. Trasforma i dati per la visualizzazione.

Modella ciò che riceve un chiamante — la risposta di una lettura o di una scrittura, e il suo frame realtime — e nulla altro: `afterSave`, `beforeDelete`, `afterDelete` e la [cronologia](/docs/backend/history) ricevono la riga come memorizzata: un valore mascherato qui non è mai ciò che un audit registra o un revert riscrive, e un campo aggiunto qui non viene mai scritto.

```typescript
afterRead: async ({
    row,    // The row to transform
    context
}) => {
    // Add computed fields
    return {
        ...row,
        displayName: `${row.first_name} ${row.last_name}`
    };
}
```

### `beforeDelete`

Chiamato prima che un record venga eliminato. Lancia un errore per bloccare l'eliminazione.

```typescript
beforeDelete: async ({
    id,
    row,
    context
}) => {
    if (row.status === "published") {
        throw new Error("Cannot delete published articles. Unpublish first.");
    }
}
```

### `afterDelete`

Chiamato dopo che la riga è stata eliminata e prima del commit, all'interno della stessa transazione. Un errore lanciato annulla l'eliminazione (rollback).

```typescript
afterDelete: async ({
    id,
    row,
    context
}) => {
    // Cleanup related data
    console.log(`Article ${id} deleted`);
}
```

## Callback delle Proprietà

Puoi anche definire callback a livello di proprietà per trasformazioni specifiche di un campo:

```typescript
properties: {
    email: {
        type: "string",
        name: "Email",
        callbacks: {
            beforeSave: ({ value }) => value?.toLowerCase().trim(),
            afterRead: ({ value }) => value // Could decrypt, etc.
        }
    }
}
```

## L'API `context.data`

Ogni callback riceve un oggetto `context` che include `context.data` — un livello unificato di accesso ai dati per eseguire **operazioni tra collezioni** dall'interno degli hook del ciclo di vita.

### Accesso alle Collezioni

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

### Metodi Disponibili

Ogni funzione di accesso alla collezione (`context.data.<slug>`) fornisce questi metodi:

| Metodo | Firma | Descrizione |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Interroga entità con filtri, ordinamento e paginazione |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Recupera una singola entità per ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Crea una nuova entità |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Aggiorna un'entità esistente |
| `.delete()` | `delete(id: string \| number) → void` | Elimina un record |
| `.count()` | `count(params?: FindParams) → number` | Conta le entità corrispondenti |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Sottoscrizione in tempo reale (dove supportato) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Ascolta una singola entità |

### Interrogare con `.find()`

Il metodo `find()` filtra con tuple `[operatore, valore]` — la forma tipizzata della stringa di query `?status=eq.published` letta dall'API REST:

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

### Creazione di Entità

`.create()` e `.update()` prendono i valori da scrivere, con le firme indicate sopra. [Sincronizzazione dei dati tra collezioni](#syncing-data-between-collections) usa entrambi: una candidatura approvata crea un'offerta di lavoro pubblicata e viene ricollegata a essa.

### Sicurezza: con quali privilegi viene eseguito `context.data`

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

### Semantica delle Transazioni

:::important
**Le scritture di `context.data` di un callback fanno parte della scrittura che lo ha attivato.** Su Postgres, `beforeSave`, il salvataggio e `afterSave` — oppure `beforeDelete`, l'eliminazione e `afterDelete` — vengono eseguiti all'interno di un'unica transazione, ogni callback viene atteso prima del commit e `context.data` scrive tramite quella stessa transazione.
:::

Di conseguenza, la scrittura scatenante e tutto ciò che i suoi callback hanno scritto vengono confermati insieme oppure per niente:

- Un errore lanciato da `afterSave` o `afterDelete` annulla la scrittura scatenante, insieme a ogni scrittura di `context.data` effettuata dai callback. Al chiamante viene restituito **400 `CALLBACK_REJECTED`** con `details.stage` che indica il nome dell'hook — o con lo stato stesso dell'errore quando ne include uno: un `RebaseApiError` che hai lanciato, il 409 per violazione di unicità.
- I sottoscrittori realtime ricevono la notifica della riga solo dopo il commit, pertanto una scrittura che ha subito un rollback non viene mai annunciata.
- Un callback mantiene aperta la transazione durante la sua esecuzione, quindi un callback lento equivale a un blocco trattenuto e a una connessione del pool impegnata.
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

## Sincronizzazione dei Dati Tra le Collezioni

Uno degli usi più potenti dei callback è la **sincronizzazione dei dati tra collezioni** mediante `context.data`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const submissionsCollection = defineCollection({
    slug: "job_submissions",
    name: "Job Submissions",
    table: "job_submissions",
    properties: {
        title: { name: "Title", type: "string" },
        description: { name: "Description", type: "string" },
        company_id: { name: "Company", type: "string" },
        status: { name: "Status", type: "string" },
        promoted_job_id: { name: "Promoted job", type: "string" }
    },
    callbacks: {
        afterSave: async ({ values, id, previousValues, context }) => {
            // When a submission is approved, create a published job
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const newJob = await context.data.collection<Record<string, unknown>>("jobs").create({
                    title: values.title,
                    description: values.description,
                    company_id: values.company_id,
                    status: "published",
                    source_submission_id: id,
                });

                // Update the submission with the promoted job reference
                await context.data.collection<Record<string, unknown>>("job_submissions").update(id, {
                    promoted_job_id: newJob.id,
                });
            }
        }
    }
});
```

Altri pattern tra collezioni:

- **Cancellazione a cascata**: Usa `afterDelete` per rimuovere i record correlati nelle collezioni figlie
- **Denormalizzazione**: Usa `afterSave` per aggiornare i campi di riepilogo in una collezione genitore
- **Log di audit**: Usa `afterSave` / `afterDelete` per scrivere in una collezione di log di audit
- **Contatori**: Usa `afterSave` / `afterDelete` per aggiornare i campi di conteggio sulle entità correlate

## Riferimento Completo del Contesto

Ogni callback riceve un oggetto `context` di tipo `RebaseCallContext`:

```typescript
interface RebaseCallContext {
    /** The authenticated user, if any */
    user?: User;
    /** The driver running this operation (server-side only) */
    driver?: DataDriver;
    /** The query accessor — context.data.<slug>.create/update/find/delete */
    data: RebaseSdkData;
    /** Functions, storage, email and dataAsAdmin — but no `data` */
    client: RebaseCallbackClient;
    /** The default storage source */
    storageSource: StorageSource;
}
```

Esegui le query tramite `context.data`. `context.client` non contiene `data`: lato server è il singleton `rebase`, il cui unico piano dati è `dataAsAdmin` limitato ad admin, pertanto `context.client.data` genera un errore di compilazione.

## Passaggi Successivi

- **[Regole di Sicurezza](/docs/collections/security-rules)** — Row Level Security
- **[Cronologia delle Entità](/docs/backend/history)** — Audit trail
- **[Funzioni Personalizzate](/docs/backend/custom-functions)** — Aggiungi endpoint API personalizzati
