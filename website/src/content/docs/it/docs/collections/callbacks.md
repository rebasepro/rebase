---
sourceHash: f10be03939ad9c7f
title: Callback delle Entità
sidebar_label: Callback
description: Utilizza i callback del ciclo di vita per eseguire logica personalizzata quando le entità vengono create, aggiornate, lette o eliminate. Include l'API context.data per operazioni tra collezioni.
---

## Overview

I callback ti consentono di agganciarti al ciclo di vita dell'entità per:

-   **Sincronizzare i dati tra collezioni** — copiare o spostare entità tra tabelle in base ai cambiamenti di stato
-   **Trasformare i dati** prima del salvataggio (campi calcolati, slugificazione)
-   **Validare** le regole di business oltre la validazione dello schema
-   **Attivare effetti collaterali** dopo le scritture (inviare email, sincronizzare API, aggiornare cache)
-   **Filtrare/trasformare** i dati dopo la lettura
-   **Operazioni a cascata** — pulire i record correlati in caso di eliminazione

## Dove vengono eseguiti i callback

Una collezione ha due blocchi di callback, e l'unica differenza è quale runtime li esegue.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Eseguito su | il server | il pannello di amministrazione, nel browser |
| Si attiva per | REST, l'SDK, realtime, `dataAsAdmin` | letture e scritture effettuate dal pannello |
| Raggiunge il browser | no — i corpi vengono rimossi dal bundle | sì, per intero |
| Da usare per | tutto ciò che segue | collezioni con cui il pannello parla direttamente |

**`callbacks` è quello che vuoi.** Viene eseguito su ogni percorso che raggiunge
il server, quindi nulla lo aggira, e il suo corpo non lascia mai la macchina: una
chiave API o una lettura di `process.env` lì è al sicuro. Il resto di questa
pagina riguarda `callbacks`.

`admin.browserCallbacks` esiste per un solo caso: una collezione su un transport
`direct` o `custom`, che il pannello legge e scrive *da solo*, senza alcun server
Rebase nel percorso della richiesta. Nulla lato server vede quelle operazioni,
quindi `callbacks` non può mai attivarsi per esse, e questo blocco è l'unico
posto in cui può vivere la loro logica di ciclo di vita.

```typescript
import type { CollectionConfig } from "@rebasepro/types";

const eventsCollection: CollectionConfig = {
    slug: "events",
    name: "Events",
    dataSource: "analytics",      // dichiarato con transport: "direct"
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

Due regole derivano da "arriva a ogni visitatore", e nessuna delle due è
stilistica:

1. **Nessun segreto.** Nessuna chiave API, nessun `process.env`, niente che ti
   dispiacerebbe far vedere a chi legge il bundle. Quello va in `callbacks`.
2. **Non è un confine di sicurezza.** Un `browserCallbacks.afterRead` che oscura
   un campo lo oscura *dopo* che il browser ha già la riga — su un transport
   diretto il documento grezzo è arrivato direttamente dallo store. È
   presentazione. L'oscuramento che deve reggere va in `callbacks`, o nelle
   regole dello store stesso.

Su una collezione con transport server — l'impostazione predefinita, e quasi
certamente la tua — il server ha già eseguito `callbacks` prima che la riga
raggiunga il pannello, quindi un `browserCallbacks.afterRead` viene eseguito *in
aggiunta*. Scrivilo idempotente, o non scriverlo.

## Definire i Callback

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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

        afterSave: async ({ values, entityId }) => {
            // Send notification
            console.log(`Article ${entityId} saved: ${values.title}`);
        },

        beforeDelete: async ({ entityId }) => {
            // Prevent deletion of published articles
            // Throw to block the deletion
        },

        afterRead: async ({ entity }) => {
            // Transform data after loading
            return entity;
        }
    }
});
```

## Riferimento ai Callback

### `beforeSave`

Chiamato prima che un'entità venga scritta nel database. Restituisce i valori modificati.

```typescript
beforeSave: async ({
    values,       // Entity values
    entityId,     // Entity ID (null for new entities)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Lancia un errore per **bloccare il salvataggio**:

```typescript
beforeSave: async ({ values }) => {
    if (values.price < 0) {
        throw new Error("Price cannot be negative");
    }
    return values;
}
```

### `afterSave`

Chiamato dopo la scrittura della riga e prima del commit, nella stessa transazione. Un errore annulla il salvataggio — vedi [Semantica delle Transazioni](#semantica-delle-transazioni).

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
    entityId,
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
    entity,    // The entity to transform
    context
}) => {
    // Add computed fields
    return {
        ...entity,
        values: {
            ...entity.values,
            displayName: `${entity.values.first_name} ${entity.values.last_name}`
        }
    };
}
```

### `beforeDelete`

Chiamato prima che un'entità venga eliminata. Lancia un errore per bloccare l'eliminazione.

```typescript
beforeDelete: async ({
    entityId,
    entity,
    context
}) => {
    if (entity.values.status === "published") {
        throw new Error("Cannot delete published articles. Unpublish first.");
    }
}
```

### `afterDelete`

Chiamato dopo l'eliminazione della riga e prima del commit, nella stessa transazione. Un errore annulla l'eliminazione.

```typescript
afterDelete: async ({
    entityId,
    entity,
    context
}) => {
    // Cleanup related data
    console.log(`Article ${entityId} deleted`);
}
```

## Callback delle Proprietà

Puoi anche definire callback a livello di proprietà per trasformazioni specifiche del campo:

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

Ogni callback riceve un oggetto `context` che include `context.data` — un livello di accesso ai dati unificato per eseguire **operazioni tra collezioni** all'interno dei hook del ciclo di vita.

### Accesso alle Collezioni

`context.data` utilizza un Proxy JavaScript, quindi puoi accedere a qualsiasi collezione tramite il suo slug come proprietà:

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

### Metodi Disponibili

Ogni accessor di collezione (`context.data.<slug>`) fornisce questi metodi:

| Metodo | Firma | Descrizione |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Interroga le entità con filtri, ordinamento e paginazione |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Recupera una singola entità tramite ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Crea una nuova entità |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Aggiorna un'entità esistente |
| `.delete()` | `delete(id: string \| number) → void` | Elimina un'entità |
| `.count()` | `count(params?: FindParams) → number` | Conta le entità corrispondenti |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Sottoscrizione in tempo reale (dove supportato) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Ascolta una singola entità |

### Interrogare con `.find()`

Il metodo `find()` supporta il filtraggio avanzato:

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

### Creare Entità

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
**`context.data` eredita i privilegi di ciò che ha attivato il callback.** Non è un livello di fiducia fisso.

- Attivato da una **richiesta utente** (REST, realtime, una modifica nel pannello di amministrazione) → **con ambito utente**. Il callback viene eseguito all'interno della transazione vincolata da RLS aperta per quella richiesta, quindi le policy si applicano sia alle letture *sia* alle scritture. Un callback non può vedere una riga che il suo chiamante non poteva vedere.
- Attivato da **`rebase.dataAsAdmin` o da un job cron** (lo stesso singleton) → **con ambito amministratore**, non senza ambito. Quel driver è limitato a `{ uid: "service", roles: ["admin"] }`, quindi il callback viene comunque eseguito in una transazione vincolata da RLS: le tue policy vengono valutate, rispetto a quell'identità.
- Attivato dal **driver base** (i flussi di autenticazione integrati, le migrazioni) → **senza ambito**. Viene eseguito sulla connessione proprietaria e bypassa RLS.
:::

Questo conta soprattutto nella direzione che fallisce in silenzio. RLS *filtra*, non solleva errori — quindi un callback che legge una riga adiacente la troverà quando salva un'attività amministrativa e potrebbe non trovare nulla quando salva un utente finale, senza errori in nessuno dei due casi. Scrivi callback che tollerino un risultato vuoto, oppure ricorri deliberatamente al piano di amministrazione:

```typescript
afterSave: async ({ context }) => {
    // Con ambito utente quando è un utente ad aver attivato questo salvataggio:
    // RLS si applica.
    await context.data.audit_logs.create({ action: "approved" });

    // Ambito amministratore deliberato — per lavoro che il chiamante davvero
    // non deve vedere, come un log di audit che non può leggere né modificare.
    // Attenzione: è la portata di un amministratore, non un bypass di RLS: una
    // collection la cui unica regola è `policy.serverContext()` resta chiusa
    // anche a lui, perché quella compila in `rebase.uid() IS NULL` e l'uid di
    // questo accessor è `service`.
    await context.client.dataAsAdmin.audit_logs.create({ action: "approved" });
}
```

:::caution[Questa pagina affermava il contrario]
Le versioni precedenti di questa pagina sostenevano che i callback bypassano sempre RLS e hanno «accesso completo al database indipendentemente dai permessi dell'utente che li attiva». Era sbagliato, e sbagliato nella direzione non sicura — induceva a scrivere callback presumendo che potessero sempre vedere tutto.

Il comportamento descritto sopra è verificato end-to-end su Postgres dal caso `"scopes context.data to the caller when a callback runs on a user request"` nella suite di enforcement RLS di `@rebasepro/server-postgres`.
:::

### Semantica delle Transazioni

:::important
**Ciò che un callback scrive tramite `context.data` fa parte della scrittura che lo ha attivato.** Su Postgres, `beforeSave`, il salvataggio e `afterSave` — oppure `beforeDelete`, l'eliminazione e `afterDelete` — vengono eseguiti in un'unica transazione; ogni callback viene atteso prima del commit, e `context.data` scrive attraverso quella stessa transazione.
:::

La scrittura che attiva il callback e tutto ciò che i suoi callback hanno scritto vengono quindi confermati insieme o per niente:

-   Un errore lanciato in `afterSave` o `afterDelete` annulla la scrittura che lo ha attivato, insieme a ogni scrittura fatta dai callback tramite `context.data`. Al chiamante viene risposto **400 `CALLBACK_REJECTED`**, con `details.stage` che indica l'hook — oppure lo status proprio dell'errore, quando ne porta uno: un `RebaseApiError` che hai lanciato, il 409 di una violazione di unicità.
-   I sottoscrittori realtime vengono a sapere della riga solo dopo il commit, quindi una scrittura annullata non viene mai annunciata.
-   Un callback tiene aperta la transazione mentre è in esecuzione, quindi uno lento è un lock mantenuto e una connessione del pool occupata.

Lascia propagare l'errore quando la scrittura che lo ha attivato non deve sopravvivergli. Catturalo quando deve: la scrittura fallita viene annullata da sola, e il resto viene confermato.

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

Il lavoro che deve uscire dal database — un'email, un webhook, una chiamata a un'API di terze parti — non va nel corpo del callback. Terrebbe aperta la transazione per un viaggio di andata e ritorno sulla rete, e niente può annullarlo quando la scrittura viene annullata. Metti in coda un [job](/docs/backend/jobs) per questo, oppure fallo dopo che la scrittura è tornata: pubblica su un [canale realtime](/docs/backend/realtime) o usa `waitUntil` in una [funzione personalizzata](/docs/backend/custom-functions). [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) spiega quale scegliere.

Su MongoDB niente di tutto questo vale. Quel driver esegue gli stessi callback senza transazione: la scrittura è già salvata quando `afterSave` viene eseguito, e un errore lì segnala il fallimento senza annullare la scrittura.

## Sincronizzazione dei Dati tra Collezioni

Uno degli usi più potenti dei callback è la **sincronizzazione dei dati tra collezioni** utilizzando `context.data`:

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
                await context.data["job-submissions"].update(entityId, {
                    promoted_job_id: newJob.id,
                });
            }
        }
    }
});
```

Altri pattern tra collezioni:

-   **Eliminazione a cascata**: Usa `afterDelete` per rimuovere i record correlati nelle collezioni figlie
-   **Denormalizzazione**: Usa `afterSave` per aggiornare i campi riepilogativi in una collezione padre
-   **Registrazione audit**: Usa `afterSave` / `afterDelete` per scrivere in una collezione di log di audit
-   **Contatori**: Usa `afterSave` / `afterDelete` per aggiornare i campi contatore sulle entità correlate

## Riferimento Completo al Contesto

<span class="since-badge" data-since="0.21">Since 0.21</span>

Ogni callback riceve un oggetto `context` di tipo `RebaseCallContext`:

```typescript
interface RebaseCallContext {
    /** L'utente autenticato, se presente */
    user?: User;
    /** Il driver che esegue questa operazione (solo lato server) */
    driver?: DataDriver;
    /** L'accessor delle query — context.data.<slug>.create/update/find/delete */
    data: RebaseSdkData;
    /** Funzioni, storage, email e dataAsAdmin — ma nessun `data` */
    client: RebaseCallbackClient;
    /** La sorgente di storage predefinita */
    storageSource: StorageSource;
}
```

Le query passano da `context.data`. `context.client` non ha `data`: lato server
è il singleton `rebase`, il cui unico piano dati è `dataAsAdmin`, con ambito
amministratore, quindi `context.client.data` è un errore di compilazione.

## Prossimi Passi

-   **[Regole di Sicurezza](/docs/collections/security-rules)** — Sicurezza a Livello di Riga
-   **[Cronologia delle Entità](/docs/backend/history)** — Traccia di audit
-   **[Funzioni Personalizzate](/docs/backend/custom-functions)** — Aggiungere endpoint API personalizzati
---
