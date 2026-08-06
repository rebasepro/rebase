---
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

## Definire i Callback

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

// The row shape. Without it every `values.x` below is `unknown`.
type Article = {
    title: string;
    slug: string;
    created_at: string;
    updated_at: string;
};

const articlesCollection: PostgresCollectionConfig<Article> = {
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { name: "Title", type: "string" },
        slug: { name: "Slug", type: "string" },
        created_at: { name: "Created at", type: "string" },
        updated_at: { name: "Updated at", type: "string" }
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
                values.created_at = new Date().toISOString();
            }
            values.updated_at = new Date().toISOString();

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
    },
    properties: { /* ... */ }
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
    return { ...values, updated_at: new Date() };
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

Chiamato dopo un salvataggio riuscito. Utilizzare per effetti collaterali.

```typescript
afterSave: async ({
    values,         // Saved values
    entityId,       // Entity ID
    previousValues, // Previous values (null for new entities)
    status,         // "new" | "existing" | "copy"
    context
}) => {
    // Send webhook
    await fetch("https://api.slack.com/webhook", {
        method: "POST",
        body: JSON.stringify({ text: `New article: ${values.title}` })
    });
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

Chiamato dopo un'eliminazione riuscita.

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
        orderBy: ["created_at", "desc"]
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
- Attivato da **lavoro in contesto server** (`rebase.dataAsAdmin`, un job cron) → **senza ambito**. Viene eseguito sulla connessione proprietaria e bypassa RLS.
:::

Questo conta soprattutto nella direzione che fallisce in silenzio. RLS *filtra*, non solleva errori — quindi un callback che legge una riga adiacente la troverà quando salva un'attività amministrativa e potrebbe non trovare nulla quando salva un utente finale, senza errori in nessuno dei due casi. Scrivi callback che tollerino un risultato vuoto, oppure ricorri deliberatamente al piano di amministrazione:

```typescript
afterSave: async ({ context }) => {
    // Con ambito utente quando è un utente ad aver attivato questo salvataggio:
    // RLS si applica.
    await context.data.audit_logs.create({ action: "approved" });

    // Bypassare RLS deliberatamente — per lavoro che il chiamante davvero non
    // deve vedere, come un log di audit che non può leggere né modificare.
    await context.client.dataAsAdmin.audit_logs.create({ action: "approved" });
}
```

:::caution[Questa pagina affermava il contrario]
Le versioni precedenti di questa pagina sostenevano che i callback bypassano sempre RLS e hanno «accesso completo al database indipendentemente dai permessi dell'utente che li attiva». Era sbagliato, e sbagliato nella direzione non sicura — induceva a scrivere callback presumendo che potessero sempre vedere tutto.

Il comportamento descritto sopra è verificato end-to-end su Postgres dal caso `"scopes context.data to the caller when a callback runs on a user request"` nella suite di enforcement RLS di `@rebasepro/server-postgres`.
:::

### Semantica delle Transazioni

:::warning
**Le operazioni `context.data` NON sono automaticamente incluse nella stessa transazione del salvataggio che le attiva.**

Il salvataggio originale dell'entità completa prima la sua transazione di database. Quindi `afterSave` viene eseguito e qualsiasi chiamata `context.data` apre **transazioni separate**. Se un'operazione `context.data` fallisce in `afterSave`, il salvataggio originale **non viene annullato**.
:::

Questo significa:

-   ✅ Il salvataggio che attiva l'operazione ha sempre successo indipendentemente
-   ⚠️ Le scritture con effetti collaterali potrebbero fallire senza influenzare l'operazione originale
-   ⚠️ Non c'è garanzia di atomicità tra il salvataggio originale e le successive chiamate a `context.data`

Per operazioni che devono essere atomiche, avvolgile nella gestione degli errori:

```typescript
afterSave: async ({ values, entityId, context }) => {
    try {
        await context.data.jobs.create({
            title: values.title,
            status: "published",
        });
    } catch (error) {
        // Log the failure — the original save already succeeded
        console.error(`Failed to promote job from submission ${entityId}:`, error);
        // Optionally: mark the submission as "promotion_failed"
        await context.data["job-submissions"].update(entityId, {
            promotion_status: "failed",
            promotion_error: String(error),
        });
    }
}
```

## Sincronizzazione dei Dati tra Collezioni

Uno degli usi più potenti dei callback è la **sincronizzazione dei dati tra collezioni** utilizzando `context.data`:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

type Submission = {
    title: string;
    description: string;
    company_id: string;
    status: string;
    promoted_job_id: string;
};

const submissionsCollection: PostgresCollectionConfig<Submission> = {
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
    },
    properties: { /* ... */ }
});
```

Altri pattern tra collezioni:

-   **Eliminazione a cascata**: Usa `afterDelete` per rimuovere i record correlati nelle collezioni figlie
-   **Denormalizzazione**: Usa `afterSave` per aggiornare i campi riepilogativi in una collezione padre
-   **Registrazione audit**: Usa `afterSave` / `afterDelete` per scrivere in una collezione di log di audit
-   **Contatori**: Usa `afterSave` / `afterDelete` per aggiornare i campi contatore sulle entità correlate

## Riferimento Completo al Contesto

Ogni callback riceve un oggetto `context` di tipo `RebaseCallContext`:

```typescript
interface RebaseCallContext {
    /** L'utente autenticato, se presente */
    user?: User;
    /** Il driver dati sottostante (PostgresBackendDriver) */
    driver: DataDriver;
    /** Accesso dati unificato — context.data.<slug>.create/update/find/delete */
    data: RebaseData;
}
```

## Prossimi Passi

-   **[Regole di Sicurezza](/docs/collections/security-rules)** — Sicurezza a Livello di Riga
-   **[Cronologia delle Entità](/docs/backend/history)** — Traccia di audit
-   **[Funzioni Personalizzate](/docs/backend/custom-functions)** — Aggiungere endpoint API personalizzati
---
