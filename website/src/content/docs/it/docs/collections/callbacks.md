---
sourceHash: 13eea3897cdb7bee
title: Callback delle entità
sidebar_label: Callback
description: Utilizza i callback del ciclo di vita per eseguire logica personalizzata quando le entità vengono create, aggiornate, lette o eliminate. Include l'API context.data per operazioni cross-collection.
---

## Panoramica

I callback consentono di inserirsi nel ciclo di vita delle entità per:

- **Sincronizzare i dati tra collezioni** — copiare o spostare entità tra tabelle al variare dello stato
- **Trasformare i dati** prima del salvataggio (campi calcolati, generazione di slug)
- **Validare** regole di business oltre la validazione dello schema
- **Attivare effetti collaterali (side effect)** dopo le scritture (invio di email, sincronizzazione API, aggiornamento di cache)
- **Filtrare/trasformare** i dati dopo la lettura
- **Operazioni a cascata** — ripulire i record correlati durante l'eliminazione

## Dove vengono eseguiti i callback

Una collezione ha due blocchi di callback, e l'unica differenza è quale runtime
li esegue.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Eseguito su | il server | il pannello di amministrazione, nel browser |
| Scatenato da | REST, l'SDK, realtime, `dataAsAdmin` | letture e scritture effettuate dal pannello |
| Raggiunge il browser | no — i corpi sono rimossi dal bundle | sì, per intero |
| Utilizzo per | tutto quanto descritto sotto | collezioni con cui il pannello interagisce direttamente |

**`callbacks` è quello che cerchi.** Viene eseguito su ogni percorso che raggiunge
il server, quindi nulla può aggirarlo, e il suo corpo non lascia mai la macchina —
una chiave API o una lettura di `process.env` lì è al sicuro. Il resto di questa pagina
tratta di `callbacks`.

`admin.browserCallbacks` esiste per un unico caso: una collezione con transport `direct` o
`custom`, che il pannello legge e scrive *autonomamente* senza alcun server Rebase
nel percorso della richiesta. Nessun componente lato server vede tali operazioni, quindi
`callbacks` non potrà mai essere attivato per esse, e questo blocco è l'unico posto in cui
la loro logica del ciclo di vita può risiedere.

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

Due regole derivano dal fatto che il codice "viene inviato a ogni visitatore", e nessuna delle due riguarda lo stile:

1. **Nessun segreto.** Niente chiavi API, niente `process.env`, niente che non vorresti
   venisse letto analizzando il bundle. Quello appartiene a `callbacks`.
2. **Non è un confine di sicurezza.** Un `browserCallbacks.afterRead` che
   rimuove o oscura un campo lo fa *dopo* che il browser ha già ricevuto la riga — su
   un transport diretto il documento grezzo proviene direttamente dallo store. Si tratta solo di
   presentazione. La rimozione di dati riservati che deve essere garantita va gestita in `callbacks`, o nelle
   regole proprietarie dello store.

Su una collezione con transport server — l'impostazione predefinita, e quasi certamente la tua —
il server ha già eseguito `callbacks` prima che la riga raggiunga il pannello, quindi un
`browserCallbacks.afterRead` viene eseguito *in aggiunta* a esso. Scrivilo in modo che sia
idempotente, o non scriverlo affatto.

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

Lancia un errore per **bloccare il salvataggio**. La scrittura non raggiunge mai il database, e
il chiamante riceve un codice **400** con il tuo messaggio e il codice `CALLBACK_REJECTED`:

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

Per scegliere personalmente lo status e il codice — un 409 per un conflitto, un 422 per qualcosa
di ben formato ma inaccettabile — lancia un `RebaseApiError`:

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
Importalo da `@rebasepro/types`, non da `@rebasepro/server`. Un file di collezione
è condiviso con il frontend — la build Vite del pannello di amministrazione legge questa stessa
directory — quindi può importare solo pacchetti eseguibili in un browser. `RebaseApiError`
è la versione browser-safe, ed è la stessa classe che l'SDK client lancia.
:::

### `afterSave`

Chiamato dopo che la riga è stata scritta e prima del commit, all'interno della stessa transazione. Un'eccezione annulla il salvataggio (rollback) — vedi [Semantica delle transazioni](#semantica-delle-transazioni).

```typescript
afterSave: async ({
    values,         // Saved values
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

### `afterRead`

Chiamato dopo la lettura delle entità dal database. Trasforma i dati per la visualizzazione.

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

Chiamato dopo che la riga è stata eliminata e prima del commit, all'interno della stessa transazione. Un'eccezione annulla l'eliminazione (rollback).

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

## Callback delle proprietà

È inoltre possibile definire i callback a livello di singola proprietà per trasformazioni specifiche di un campo:

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

Ogni callback riceve un oggetto `context` che include `context.data` — un livello di accesso ai dati unificato per eseguire **operazioni cross-collection** direttamente dagli hook del ciclo di vita.

### Accesso alle collezioni

`context.data` utilizza un Proxy JavaScript, permettendoti di accedere a qualsiasi collezione tramite il suo slug come proprietà:

```typescript
afterSave: async ({ values, entityId, context }) => {
    // Dynamic property access — works for any collection slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .collection() method for dynamic slugs
    const collectionName = "jobs";
    const accessor = context.data.collection(collectionName);
}
```

### Metodi disponibili

Ogni accessor di collezione (`context.data.<slug>`) fornisce questi metodi:

| Metodo | Firma | Descrizione |
|--------|-------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Interroga le entità con filtri, ordinamento e paginazione |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Recupera una singola entità tramite ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Crea una nuova entità |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Aggiorna un'entità esistente |
| `.delete()` | `delete(id: string \| number) → void` | Elimina un record |
| `.count()` | `count(params?: FindParams) → number` | Conta le entità corrispondenti |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Sottoscrizione in tempo reale (dove supportata) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Ascolta i cambiamenti di una singola entità |

### Query con `.find()`

Il metodo `find()` supporta un ricco sistema di filtraggio:

```typescript
afterSave: async ({ values, context }) => {
    // Simple equality
    const { data: activeJobs } = await context.data.jobs.find({
        where: { status: "published" },
        limit: 10,
        orderBy: ["createdAt", "desc"]
    });

    // PostgREST-style operators
    const { data: recentJobs } = await context.data.jobs.find({
        where: {
            status: "eq.published",
            salary: "gte.50000"
        }
    });

    // Tuple syntax
    const { data: expensiveJobs } = await context.data.jobs.find({
        where: {
            salary: [">=", 100000],
            role: ["in", ["admin", "manager"]]
        }
    });
}
```

### Creazione di entità

```typescript
afterSave: async ({ values, entityId, previousValues, context }) => {
    // Promote an approved submission to a published job
    if (values.status === "approved" && previousValues?.status !== "approved") {
        const newJob = await context.data.jobs.create({
            title: values.title,
            description: values.description,
            company_id: values.company_id,
            status: "published",
            source_submission_id: entityId,
        });

        // Link back to the original submission
        await context.data["job-submissions"].update(entityId, {
            promoted_job_id: newJob.id,
        });
    }
}
```

### Sicurezza: con quali privilegi viene eseguito `context.data`

:::important
**`context.data` eredita i privilegi dell'evento o utente che ha attivato il callback.** Non si tratta di un livello di attendibilità fisso.

- Attivato da una **richiesta utente** (REST, realtime, una modifica dal pannello admin) → **con ambito utente (user-scoped)**. Il callback viene eseguito all'interno della transazione vincolata da RLS aperta per quella richiesta, pertanto le policy si applicano sia alle letture *che* alle scritture. Un callback non può vedere una riga che il suo chiamante non potrebbe vedere.
- Attivato da **`rebase.dataAsAdmin` o da un cron job** (lo stesso singleton) → **con ambito admin (admin-scoped)**, non privo di ambito. Quel driver è associato a `{ uid: "service", roles: ["admin"] }`, quindi il callback viene comunque eseguito su una transazione vincolata da RLS — le tue policy vengono valutate a fronte di tale identità.
- Attivato dal **driver di base** (flussi di autenticazione integrati, migrazioni) → **senza ambito (unscoped)**. Viene eseguito sulla connessione proprietaria (owner) ed elude RLS.
:::

Questo aspetto è particolarmente critico nei casi di errore silente. RLS *filtra*, non genera eccezioni — pertanto un callback che legge una riga correlata la troverà quando il salvataggio è avviato da un'attività di amministrazione, ma potrebbe non trovare nulla quando a salvare è un utente finale, senza restituire alcun errore in entrambi i casi. Scrivi callback in grado di gestire un risultato vuoto, oppure accedi deliberatamente al piano di amministrazione:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a collection whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    await context.client.dataAsAdmin.audit_logs.create({ action: "approved" });
}
```

:::caution[Questa pagina in precedenza indicava il contrario]
Le versioni precedenti di questa pagina indicavano che i callback ignorassero sempre RLS e avessero "pieno accesso al database indipendentemente dai permessi dell'utente scatenante". Questo era inesatto, e lo era a sfavore della sicurezza — incentivava la scrittura di callback basati sul presupposto di poter visualizzare sempre ogni dato.

Il comportamento sopra descritto è verificato end-to-end su Postgres dal caso `"scopes context.data to the caller when a callback runs on a user request"` presente nella suite di enforcement RLS di `@rebasepro/server-postgres`.
:::

### Semantica delle transazioni

:::important
**Le scritture di `context.data` di un callback fanno parte della scrittura che lo ha scatenato.** Su Postgres, `beforeSave`, il salvataggio e `afterSave` — oppure `beforeDelete`, l'eliminazione e `afterDelete` — vengono eseguiti all'interno di un'unica transazione; ogni callback viene atteso prima del commit, e `context.data` scrive attraverso quella stessa transazione.
:::

Di conseguenza, la scrittura scatenante e tutto ciò che i suoi callback hanno scritto eseguono il commit insieme o non lo eseguono affatto:

- Un errore generato da `afterSave` o `afterDelete` annulla la scrittura scatenante (rollback), insieme a ogni scrittura effettuata con `context.data` dai callback. Al chiamante viene restituito **400 `CALLBACK_REJECTED`** con `details.stage` che specifica l'hook coinvolto — o con lo status proprio dell'errore, se definito: un `RebaseApiError` da te sollevato, o un 409 per violazione di unicità.
- I sottoscrittori realtime ricevono notifica della riga solo dopo il commit, pertanto una scrittura su cui è stato eseguito il rollback non viene mai notificata.
- Un callback mantiene aperta la transazione durante la sua esecuzione, quindi un'operazione lenta equivale a un blocco (lock) mantenuto e a una connessione del pool impegnata.

Lascia che un'eccezione si propaghi se la scrittura scatenante non deve sopravvivere a essa. Intercettala se invece deve essere mantenuta: la scrittura fallita verrà annullata singolarmente, e il resto eseguirà il commit regolarmente.

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

Le operazioni che devono uscire dal database — un'email, un webhook, una chiamata a un'API di terze parti — non appartengono al corpo del callback. Manterrebbero la transazione aperta per l'intera durata della richiesta di rete, e nulla potrebbe annullarle in caso di rollback della scrittura. Inserisci un [job](/docs/backend/jobs) in coda, oppure esegui l'operazione dopo la risposta di scrittura: pubblica su un [canale realtime](/docs/backend/realtime), o usa `waitUntil` in una [funzione personalizzata](/docs/backend/custom-functions). La sezione [Hook](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) descrive quale soluzione sia più adatta.

Su MongoDB nulla di tutto ciò si applica. Quel driver esegue gli stessi callback senza transazione, quindi la scrittura è già salvata quando `afterSave` viene eseguito, e un errore lì generato segnalerà il fallimento senza poterlo annullare.

## Sincronizzazione dei dati tra collezioni

Uno degli usi più potenti dei callback è la **sincronizzazione dei dati tra collezioni** tramite `context.data`:

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

Altri pattern cross-collection:

- **Eliminazione a cascata**: usa `afterDelete` per rimuovere i record correlati nelle collezioni figlie
- **Denormalizzazione**: usa `afterSave` per aggiornare campi di riepilogo in una collezione padre
- **Audit log**: usa `afterSave` / `afterDelete` per scrivere in una collezione di log delle attività
- **Contatori**: usa `afterSave` / `afterDelete` per aggiornare i campi di conteggio sulle entità correlate

## Riferimento completo di Context

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

Esegui le query tramite `context.data`. `context.client` non include `data`: lato server rappresenta il singleton `rebase`, il cui unico piano dati è `dataAsAdmin` con ambito amministrativo, pertanto `context.client.data` genera un errore di compilazione.

## Passaggi successivi

- **[Regole di sicurezza](/docs/collections/security-rules)** — Row Level Security (Sicurezza a livello di riga)
- **[Cronologia delle entità](/docs/backend/history)** — Audit trail
- **[Funzioni personalizzate](/docs/backend/custom-functions)** — Aggiunta di endpoint API personalizzati
