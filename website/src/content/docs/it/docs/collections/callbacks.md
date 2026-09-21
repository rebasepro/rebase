---
sourceHash: c71850336649c023
title: Callback delle entità
sidebar_label: Callback
description: Utilizza i callback del ciclo di vita per eseguire logica personalizzata quando le entità vengono create, aggiornate, lette o eliminate. Include l'API context.data per operazioni tra collezioni.
---

## Panoramica

I callback consentono di agganciarsi al ciclo di vita delle entità per:

- **Sincronizzare dati tra collezioni** — copiare o spostare entità tra tabelle al variare dello stato
- **Trasformare dati** prima del salvataggio (campi calcolati, creazione di slug)
- **Validare** regole di business oltre la validazione dello schema
- **Attivare effetti collaterali (side effect)** dopo le scritture (invio di email, sincronizzazione API, aggiornamento delle cache)
- **Restringere una lettura** prima che venga compilata, in modo che un chiamante veda solo ed esclusivamente le proprie righe
- **Filtrare/trasformare** i dati dopo la lettura
- **Operazioni a cascata** — ripulire i record correlati durante l'eliminazione

## Dove vengono eseguiti i callback

Una collezione ha due blocchi di callback e l'unica differenza è quale runtime li esegue.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Eseguito su | il server | il pannello di amministrazione, nel browser |
| Scatta per | REST, l'SDK, realtime, `dataAsAdmin` | letture e scritture effettuate dal pannello |
| Arriva al browser | no — i corpi vengono rimossi dal bundle | sì, per intero |
| Usa per | tutto ciò che segue | collezioni con cui il pannello comunica direttamente |

**`callbacks` è quello che fa per te.** Viene eseguito su ogni percorso che raggiunge il server, quindi nulla lo bypassa, e il suo corpo non lascia mai la macchina — una chiave API o una lettura di `process.env` al suo interno è sicura. Il resto di questa pagina è dedicato a `callbacks`.

`admin.browserCallbacks` esiste per un solo caso: una collezione su un trasporto `direct` o `custom`, che il pannello legge e scrive *autonomamente* senza alcun server Rebase nel percorso della richiesta. Nessun componente lato server vede tali operazioni, pertanto `callbacks` non potrà mai attivarsi per esse, e questo blocco è l'unico posto in cui può risiedere la loro logica del ciclo di vita.

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

Due regole derivano dal fatto che il codice "viene inviato a ogni visitatore", e nessuna delle due è solo stilistica:

1. **Nessun segreto.** Niente chiavi API, niente `process.env`, niente che non vorresti fosse visibile a chi analizza il bundle. Tutto questo appartiene a `callbacks`.
2. **Non è un confine di sicurezza.** Un `browserCallbacks.afterRead` che oscura un campo lo fa *dopo* che il browser possiede già la riga — su un trasporto diretto il documento grezzo proviene direttamente dallo store. È solo una questione di presentazione. L'oscuramento dei dati che deve essere vincolante va in `callbacks`, o nelle regole proprietarie dello store.

In una collezione con trasporto via server — l'impostazione predefinita e quasi certamente la tua — il server ha già eseguito `callbacks` prima che la riga raggiunga il pannello, quindi un `browserCallbacks.afterRead` viene eseguito *in aggiunta* ad esso. Scrivilo in modo che sia idempotente, o non scriverlo affatto.

## Definizione dei callback

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

## Riferimento dei callback

### `beforeQuery`

Chiamato **prima che una lettura venga compilata**, per restringere le righe richieste. Restituisce condizioni da concatenare con AND nella query; non restituire nulla per non aggiungerne alcuna.

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

`afterRead` vede le righe che sono già state recuperate, quindi può oscurare un valore ma non può impedire la lettura della riga. Questo callback viene eseguito prima, e ci sono tre aspetti importanti da conoscere:

- **Può solo restringere.** Il valore restituito è un filtro da aggiungere con AND, e nessun valore restituito può ampliare la lettura. `filter` accetta gli stessi filtri di campo di una query; `logical` accetta un gruppo `or`/`and`, per uno scope come "miei, o condivisi con me" — sempre combinato con AND nel suo insieme, in modo che l'`or` selezioni solo tra le righe già consentite dal resto della query.
- **Scatta su ogni percorso di lettura.** L'elenco (list), la singola get, il conteggio (count), l'aggregazione, la ricerca, la lettura vettoriale, un elenco a percorso nidificato, il refetch realtime alla base di un `.listen()`, e le righe caricate per una relazione o un `?include=` — dove si applica l'hook della collezione di **destinazione**, poiché quelle sono le righe della destinazione.
- **Un filtro che non può compilare rifiuta la richiesta.** Indicare una colonna che la tabella non possiede restituisce un 400, la condizione non viene mai ignorata.

Una lettura non viene deliberatamente ristretta: il controllo di univocità dietro a `validation: { unique: true }`. Verifica se un valore esiste in qualsiasi punto della tabella e, se ristretto, risponderebbe "univoco" per un valore già presente in una riga nascosta.

:::caution[Solo Postgres, per ora]
`beforeQuery` è implementato da `@rebasepro/server-postgres`. Una collezione servita da MongoDB o Firestore che ne dichiara uno **fallisce all'avvio**, indicandone il nome, invece di essere eseguita con l'hook silenziosamente inattivo — il che, per un filtro sulle righe, significherebbe servire ogni riga a chiunque. Un `beforeQuery` [globale](/docs/backend/hooks) fallisce all'avvio nello stesso modo se una qualsiasi origine dati non è Postgres, così come uno collegato successivamente con `setCollectionCallbacks`. L'oscuramento dei dati che funziona su tutti i motori è [`afterRead`](#afterread).
:::

→ [Estensione del server](/docs/backend/extending#2-collection-callbacks) per scoprire come si posiziona rispetto alle altre opzioni.

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

Genera un errore (throw) per **bloccare il salvataggio**. La scrittura non raggiunge mai il database e il chiamante riceve **400** con il tuo messaggio e il codice `CALLBACK_REJECTED`:

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

Per scegliere autonomamente lo status e il codice — un 409 per un conflitto, un 422 per qualcosa di ben formato ma inaccettabile — genera un `RebaseApiError`:

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
Importalo da `@rebasepro/types`, non da `@rebasepro/server`. Un file di collezione è condiviso con il frontend — la build Vite del pannello di amministrazione legge questa stessa directory — pertanto può importare solo pacchetti eseguibili in un browser. `RebaseApiError` è la versione sicura per il browser ed è la stessa classe generata dall'SDK client.
:::

### `afterSave`

Chiamato dopo che la riga è stata scritta e prima del commit, all'interno della stessa transazione. Un errore (throw) esegue il rollback del salvataggio — vedi [Semantica delle transazioni](#transaction-semantics).

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

Chiamato dopo aver letto le entità dal database. Trasforma i dati per la visualizzazione.

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

Chiamato prima che un record venga eliminato. Genera un errore per bloccare l'eliminazione.

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

Chiamato dopo che la riga è stata eliminata e prima del commit, all'interno della stessa transazione. Un errore esegue il rollback dell'eliminazione.

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

## Property Callbacks

È inoltre possibile definire i callback a livello di proprietà per trasformazioni specifiche sui singoli campi:

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

### Accesso alle collezioni

`context.data` utilizza un Proxy JavaScript, consentendoti di accedere a qualsiasi collezione tramite il suo slug come proprietà:

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

Ciascun accessor di collezione (`context.data.<slug>`) fornisce questi metodi:

| Metodo | Firma | Descrizione |
|--------|-------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Esegue query su entità con filtri, ordinamento e paginazione |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Recupera una singola entità tramite ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Crea una nuova entità |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Aggiorna un'entità esistente |
| `.delete()` | `delete(id: string \| number) → void` | Elimina un record |
| `.count()` | `count(params?: FindParams) → number` | Conta le entità corrispondenti |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Sottoscrizione in tempo reale (dove supportata) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Resta in ascolto su una singola entità |

### Esecuzione di query con `.find()`

Il metodo `find()` supporta filtri avanzati:

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
**`context.data` eredita i privilegi di qualunque elemento abbia attivato il callback.** Non ha un livello di attendibilità fisso.

- Attivato da una **richiesta utente** (REST, realtime, una modifica dal pannello di amministrazione) → **user-scoped (ambito utente)**. Il callback viene eseguito all'interno della transazione vincolata a RLS aperta per tale richiesta, quindi i criteri si applicano a letture *e* scritture. Un callback non può vedere una riga che il suo chiamante non poteva vedere.
- Attivato da **`rebase.dataAsAdmin` o un cron job** (lo stesso singleton) → **admin-scoped (ambito admin)**, non privo di ambito. Tale driver ha come ambito `{ uid: "service", roles: ["admin"] }`, quindi il callback viene comunque eseguito su una transazione vincolata a RLS — i tuoi criteri vengono valutati rispetto a tale identità.
- Attivato dal **driver di base** (flussi di autenticazione integrati, migrazioni) → **unscoped (senza ambito)**. Viene eseguito sulla connessione proprietaria e bypassa RLS.
:::

Questo è particolarmente rilevante nella direzione che fallisce silenziosamente. RLS *filtra*, non genera errori — quindi un callback che legge una riga correlata la troverà quando a salvare è un'attività amministrativa, e potrebbe non trovare nulla quando a salvare è un utente finale, senza alcun errore in entrambi i casi. Scrivi callback che tollerino un risultato vuoto, oppure accedi deliberatamente al piano di amministrazione:

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

:::caution[Questa pagina indicava il contrario]
Le versioni precedenti di questa pagina indicavano che i callback ignoravano sempre RLS e avevano "accesso completo al database indipendentemente dai permessi dell'utente attivatore". Questo era errato, e lo era nella direzione meno sicura — portava a scrivere callback partendo dal presupposto che potessero sempre vedere tutto.

Il comportamento sopra descritto è verificato end-to-end su Postgres dal test case `"scopes context.data to the caller when a callback runs on a user request"` nella suite di imposizione RLS di `@rebasepro/server-postgres`.
:::

### Semantica delle transazioni

:::important
**Le scritture di `context.data` di un callback fanno parte della scrittura che lo ha attivato.** Su Postgres, `beforeSave`, il salvataggio e `afterSave` — oppure `beforeDelete`, l'eliminazione e `afterDelete` — vengono eseguiti all'interno di una singola transazione, ciascun callback viene atteso prima del commit, e `context.data` scrive attraverso la medesima transazione.
:::

Di conseguenza, la scrittura attivante e tutto ciò che i suoi callback hanno scritto vengono salvati (commit) insieme o non vengono salvati affatto:

- Un errore (throw) da `afterSave` o `afterDelete` esegue il rollback della scrittura attivante, insieme a ogni scrittura di `context.data` effettuata dai callback. Al chiamante viene restituito **400 `CALLBACK_REJECTED`** con `details.stage` che indica il nome dell'hook — oppure con lo stato proprio dell'errore, quando disponibile: un `RebaseApiError` che hai generato, o il 409 di una violazione di univocità.
- Gli iscritti al realtime ricevono notifiche relative alla riga solo dopo il commit, quindi una scrittura su cui è stato eseguito il rollback non viene mai annunciata.
- Un callback mantiene aperta la transazione durante la sua esecuzione, quindi uno lento manterrà un blocco attivo e occuperà una connessione del pool.

Lascia che un fallimento generi un errore quando la scrittura attivante non deve sopravvivere ad esso. Intercettalo (catch) quando invece deve farlo: la scrittura non riuscita viene annullata singolarmente, e il resto esegue il commit.

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

Le operazioni che devono uscire dal database — un'email, un webhook, una chiamata a un'API di terze parti — non appartengono al corpo del callback. Manterrebbero la transazione aperta per un round-trip di rete e nulla potrà annullarle se la scrittura subisce un rollback. Metti in coda un [job](/docs/backend/jobs) a tale scopo, oppure eseguile dopo il ritorno della scrittura: pubblica su un [canale realtime](/docs/backend/realtime), o usa `waitUntil` in una [funzione personalizzata](/docs/backend/custom-functions). La sezione [Hook](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) spiega quale approccio sia più adatto.

Su MongoDB nulla di tutto questo è valido. Quel driver esegue gli stessi callback senza una transazione, quindi la scrittura è già memorizzata quando `afterSave` viene eseguito, e un errore lì generato segnala il fallimento senza annullare l'operazione.

## Sincronizzazione dei dati tra collezioni

Uno degli utilizzi più potenti dei callback è la **sincronizzazione dei dati tra collezioni** tramite `context.data`:

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

- **Eliminazione a cascata**: usa `afterDelete` per rimuovere i record correlati nelle collezioni figlie
- **Denormalizzazione**: usa `afterSave` per aggiornare campi di riepilogo in una collezione genitore
- **Audit logging**: usa `afterSave` / `afterDelete` per scrivere in una collezione di log di audit
- **Contatori**: usa `afterSave` / `afterDelete` per aggiornare campi di conteggio sulle entità correlate

## Riferimento completo del contesto

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

Esegui le query tramite `context.data`. `context.client` non possiede `data`: lato server è il singleton `rebase`, il cui unico piano dati è `dataAsAdmin` con ambito admin, quindi `context.client.data` genererà un errore di compilazione.

## Passaggi successivi

- **[Regole di sicurezza](/docs/collections/security-rules)** — Row Level Security
- **[Cronologia delle entità](/docs/backend/history)** — Audit trail
- **[Funzioni personalizzate](/docs/backend/custom-functions)** — Aggiunta di endpoint API personalizzati
