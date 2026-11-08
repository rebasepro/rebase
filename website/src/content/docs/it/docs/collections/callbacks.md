---
sourceHash: a5ffa9633889db28
title: Callback delle entità
sidebar_label: Callback
description: Utilizza i callback del ciclo di vita per eseguire logica personalizzata quando le entità vengono create, aggiornate, lette o eliminate. Include l'API context.data per operazioni tra collezioni.
---

## Panoramica

I callback consentono di agganciarsi al ciclo di vita delle entità per:

- **Sincronizzare dati tra collezioni** — copiare o spostare entità tra tabelle al variare dello stato
- **Trasformare i dati** prima del salvataggio (campi calcolati, generazione di slug)
- **Validare** regole di business oltre la validazione dello schema
- **Attivare effetti collaterali** dopo le scritture (inviare email, sincronizzare API, aggiornare cache)
- **Restringere una lettura** prima che venga compilata, in modo che un chiamante veda solo le proprie righe
- **Filtrare/trasformare** i dati dopo la lettura
- **Operazioni a cascata** — ripulire i record correlati durante l'eliminazione

## Dove vengono eseguiti i callback

<span class="since-badge" data-since="0.29">Dalla versione 0.29</span>
Una collezione ha due blocchi di callback, e l'unica differenza è quale runtime li esegue.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Eseguito su | il server | il pannello di amministrazione, nel browser |
| Si attiva per | REST, l'SDK, realtime, `dataAsAdmin` | letture e scritture effettuate dal pannello |
| Raggiunge il browser | no — i corpi vengono rimossi dal bundle | sì, per intero |
| Utilizzare per | tutto ciò che segue | collezioni con cui il pannello comunica direttamente |

**`callbacks` è quello che desideri.** Viene eseguito su ogni percorso dati che raggiunge il server — REST, l'SDK, realtime, MCP e `rebase.data` — e il suo corpo non lascia mai la macchina, quindi una chiave API o una lettura di `process.env` al suo interno è sicura. Il resto di questa pagina riguarda `callbacks`.

Un elemento di scrittura non è un percorso dati: **il sistema di autenticazione**. La registrazione, l'accesso OAuth e la gestione utenti dell'admin scrivono direttamente le righe degli utenti e non eseguono alcuno dei loro callback, quindi un'email di benvenuto in `afterSave` su `users` non si attiverà mai alla registrazione. Agganciala agli [hook di autenticazione](/docs/backend/authentication/) passati in `auth.hooks` — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` — che accettano un backend ejected; l'avvio (boot) avvisa quando la collezione utenti dichiara callback che la registrazione non eseguirà.

`admin.browserCallbacks` esiste per un solo caso: una collezione su un trasporto `direct` o `custom`, che il pannello legge e scrive *autonomamente* senza alcun server Rebase nel percorso della richiesta. Nessun elemento lato server vede tali operazioni, quindi `callbacks` non può mai attivarsi per esse, e questo blocco è l'unico posto in cui la loro logica del ciclo di vita può risiedere.

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

Due regole derivano dall'essere «inviato a ogni visitatore», e nessuna delle due è una questione di stile:

1. **Nessun segreto.** Nessuna chiave API, nessun `process.env`, nulla che ti dispiacerebbe venisse visto da chi esamina il bundle. Tutto ciò appartiene a `callbacks`.
2. **Non è un perimetro di sicurezza.** Un `browserCallbacks.afterRead` che oscura un campo lo oscura *dopo* che il browser ha già ricevuto la riga — su un trasporto diretto il documento grezzo proviene direttamente dallo store. È una questione di presentazione. L'oscuramento che deve essere rigoroso va inserito in `callbacks` o nelle regole proprie dello store.

In una collezione con trasporto server — quella predefinita, e quasi certamente la tua — il server ha già eseguito `callbacks` prima che la riga raggiunga il pannello, quindi un `browserCallbacks.afterRead` viene eseguito *in aggiunta* a esso. Scrivilo affinché sia idempotente, altrimenti non scriverlo.

A entrambi i blocchi viene passato lo stesso contenuto: le righe come inviate dal server, una data come stringa ISO e un belongsTo come colonna della chiave esterna. Questo vale per ogni scrittura effettuata dal pannello — il salvataggio del modulo di un record, una modifica inline della tabella, `useRowWrites` e una scrittura tramite il `context.data` del browser — quindi il corpo di un callback funziona in entrambi i blocchi. Ciò che un `browserCallbacks.beforeSave` modifica nella riga restituita è ciò che il modulo salva. Il `context` ricevuto è quello del browser: il suo `data` legge le righe allo stesso modo, e una scrittura eseguita tramite esso esegue anche i `browserCallbacks` della collezione; di conseguenza, un hook che scrive sulla propria stessa collezione verrà rieseguito.

Un `browserCallbacks.afterSave` viene eseguito dopo che la scrittura è stata memorizzata, e nulla nel browser può annullarla (rollback). Un'eccezione generata al suo interno viene mostrata come avviso; il salvataggio stesso viene segnalato come completato, così che il modulo non proponga di creare il record una seconda volta.

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
            // Throw (or return false) to block the deletion
        },

        afterRead: async ({ row }) => {
            // Transform data after loading
            return row;
        }
    }
});
```

## Combinare set di callback

Nella 0.24, combina i set manualmente.

Una collezione ha un solo oggetto `callbacks`. Quando diverse funzionalità o requisiti necessitano ciascuno di un hook, come timestamp, audit trail e ambito per tenant (tenant scope), scrivi ciascuno come set a sé stante e combinali con `composeCallbacks`:

```typescript
import { composeCallbacks, defineCollection } from "@rebasepro/cms-types";
import type { CollectionCallbacks } from "@rebasepro/types";

const timestamps: CollectionCallbacks = {
    beforeSave: ({ values, status }) => ({
        ...values,
        ...(status === "new" ? { createdAt: new Date().toISOString() } : {}),
        updatedAt: new Date().toISOString()
    })
};

const auditTrail: CollectionCallbacks = {
    afterSave: async ({ context, id, status }) => {
        await context.data.audit_log.create({ entity: "articles", entityId: String(id), action: status });
    }
};

export default defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { name: "Title", type: "string" },
        createdAt: { name: "Created at", type: "string" },
        updatedAt: { name: "Updated at", type: "string" }
    },
    callbacks: composeCallbacks(timestamps, auditTrail)
});
```

I set vengono eseguiti nell'ordine indicato e ogni hook si combina nello stesso modo in cui il backend combina i propri livelli [globali](/docs/backend/hooks), di collezione e di proprietà:

| Hook | Combinato |
|---|---|
| `beforeSave` | Concatenato: ciascun set vede i valori restituiti dal precedente, uniti superficialmente (shallow-merged) su quanto gli era stato fornito |
| `afterRead` | Concatenato: ciascun set riceve la riga restituita dal precedente |
| `beforeQuery` | In AND: ciascun set vede la query del chiamante e una riga deve superare ogni restringimento |
| `beforeDelete` | Qualsiasi `false` pone il veto sull'eliminazione; ogni set viene comunque eseguito |
| `afterSave`, `afterDelete` | Eseguiti in ordine, ciascuno atteso con await; un errore blocca i successivi |
| `afterSaveError` | Eseguiti in ordine; un errore non blocca il set successivo e il primo errore viene rilanciato alla fine |

Un hook è presente nel risultato solo se almeno un set lo definisce, e un set `undefined` viene ignorato. `composeCallbacks` viene esportato anche da `@rebasepro/server` e `@rebasepro/common`.

Collegare callback dopo l'avvio con `backend.setCollectionCallbacks(slug, callbacks)` **sostituisce** quelli dichiarati dalla collezione. Per aggiungere i tuoi a quelli esistenti, passa `composeCallbacks(declared, yours)`.

## Riferimento dei callback

### `beforeQuery`

Chiamato **prima che una lettura venga compilata**, per restringere le righe richieste. Restituisci le condizioni da inserire in AND nella query; non restituire nulla per non aggiungerne alcuna.

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

`afterRead` vede le righe che sono già state recuperate, quindi può oscurare un valore ma non può impedire che la riga venga letta. Questo viene eseguito prima, e vale la pena conoscere tre aspetti a riguardo:

- **Può solo restringere.** Il valore restituito è un filtro da aggiungere in AND e nessun valore restituito può ampliare la lettura. `filter` accetta gli stessi filtri di campo di una query; `logical` accetta un gruppo `or`/`and`, per un ambito come "miei, o condivisi con me" — sempre combinato in AND nel suo complesso, quindi l'`or` sceglie sempre e solo tra le righe già consentite dal resto della query.
- **Si attiva su ogni percorso di lettura.** L'elenco (listing), la singola get, il conteggio, l'aggregazione, la ricerca, la lettura vettoriale, un elenco su percorso nidificato, il refetch realtime dietro un `.listen()` e le righe caricate per una relazione o un `?include=` — dove è l'hook della collezione di **destinazione** ad applicarsi, poiché si tratta delle righe della destinazione.
- **Un filtro impossibile da compilare rifiuta la richiesta.** Indicare una colonna non presente nella tabella genera un 400, non una condizione ignorata.
- **Una scrittura su una riga esclusa restituisce un 404.** Un aggiornamento o un'eliminazione indirizzati a una riga esterna all'ambito vengono rifiutati prima della scrittura, con la stessa risposta "nessuna riga …" fornita da una lettura — quindi un ambito è un ambito anche per le scritture, non solo per le letture. Una scrittura di appartenenza uno-a-molti (`comments: [ids]` su un post) lascia un elemento figlio nascosto dall'ambito di destinazione dov'è, poiché lascia un id che non corrisponde ad alcuna riga. Ciò che *non* controlla sono i valori in fase di scrittura: rifiutare una scrittura in base ai suoi contenuti compete a `beforeSave`.

Una lettura non viene volutamente ristretta: il controllo di univocità dietro `validation: { unique: true }`. Essa verifica se un valore esiste ovunque nella tabella e, se ristretta, risponderebbe "univoco" per un valore già presente in una riga nascosta.

:::caution[Solo Postgres, per ora]
`beforeQuery` è implementato da `@rebasepro/server-postgres`. Una collezione servita da MongoDB o Firestore che ne dichiara uno **fallisce all'avvio**, indicandone il nome, invece di essere servita con l'hook silenziosamente inerte — il che, per un filtro sulle righe, significherebbe servire ogni riga a chiunque. Un `beforeQuery` [globale](/docs/backend/hooks) fallisce all'avvio nello stesso modo se una qualsiasi origine dati non è Postgres, così come uno collegato successivamente con `setCollectionCallbacks`. L'oscuramento che funziona su ogni motore è [`afterRead`](#afterread).
:::

→ [Estendere il server](/docs/backend/extending#2-collection-callbacks) per scoprire come si colloca rispetto alle altre opzioni.

### `beforeSave`

Chiamato prima che un record venga scritto nel database. Restituisci i valori modificati. Su Postgres viene eseguito all'interno della transazione della scrittura, che è già iniziata, quindi occupa una connessione del pool per tutta la durata della sua esecuzione — vedi [Un callback occupa una connessione](/docs/collections/context-data-api#a-callback-holds-a-connection).

```typescript
beforeSave: async ({
    values,       // Entity values
    id,           // Entity ID (undefined for a new entity, unless the caller sent one)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Lancia un errore per **bloccare il salvataggio**. La scrittura non raggiunge mai il database e il chiamante riceve **400** con il tuo messaggio e il codice `CALLBACK_REJECTED`:

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

Per scegliere autonomamente lo stato e il codice — un 409 per un conflitto, un 422 per un elemento ben formato ma non accettabile — lancia un `RebaseApiError`:

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
Importalo da `@rebasepro/types`, non da `@rebasepro/server`. Il file di una collezione è condiviso con il frontend — la build Vite del pannello di amministrazione legge questa stessa directory — quindi può importare solo pacchetti eseguibili in un browser. `RebaseApiError` è la versione compatibile con il browser ed è la stessa classe che l'SDK tipizzato lancia.
:::

### `afterSave`

Chiamato dopo che la riga è stata scritta e prima del commit, all'interno della stessa transazione. Un'eccezione annulla il salvataggio (rollback) — vedi [Semantica delle transazioni](/docs/collections/context-data-api#transaction-semantics).

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

Viene eseguito per un salvataggio fallito nel database o successivamente — non per un rifiuto in `beforeSave`, una richiesta rifiutata prima della scrittura (validazione, autorizzazione mancante, 404), o un commit rifiutato dopo il ritorno del salvataggio ([elenco completo](/docs/backend/hooks/#when-aftersaveerror-runs)).

Durante una richiesta, viene eseguito una volta completato il rollback della transazione di scrittura fallita, non al suo interno. Il suo `context.data` è una nuova istanza per lo stesso chiamante, in cui ogni chiamata costituisce una transazione a sé stante, pertanto un [job](/docs/backend/jobs), un messaggio di coda o un webhook accodato viene salvato tramite commit e sopravvive al fallimento segnalato. Un'eccezione lanciata da `afterSaveError` viene registrata nei log e il chiamante riceve comunque l'errore originario del salvataggio.

### `afterRead`

Chiamato dopo la lettura delle entità dal database. Trasforma i dati per la visualizzazione.

Modella ciò che un chiamante riceve — la risposta di una lettura o di una scrittura, e il relativo frame realtime — e nient'altro: `afterSave`, `beforeDelete`, `afterDelete` e la [cronologia](/docs/backend/history) ricevono la riga così come memorizzata: un valore mascherato qui non è mai ciò che un audit registra o che un ripristino riscrive, e un campo aggiunto qui non viene mai scritto.

Un'aggregazione restituisce somme e conteggi, non righe, quindi non può passare attraverso `afterRead`. Su una collezione a cui se ne applica uno, viene servito solo `count()` senza `groupBy`; qualsiasi altra [aggregazione](/docs/sdk/aggregates-and-search/#aggregates) viene rifiutata con `400 AGGREGATE_MASKED_BY_AFTER_READ`.

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

Chiamato prima che un record venga eliminato. Lancia un errore per bloccare l'eliminazione e il chiamante riceverà `400 CALLBACK_REJECTED` con il tuo messaggio. Anche restituire `false` la blocca, con `403 CALLBACK_REJECTED` senza alcun messaggio personalizzato.

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

Ogni callback riceve anche `context.data`, un livello dati per leggere e scrivere altre collezioni dall'interno dell'hook — vedi [L'API `context.data`](/docs/collections/context-data-api).

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
- **Registro di controllo (audit logging)**: usa `afterSave` / `afterDelete` per scrivere in una collezione di log di audit
- **Contatori**: usa `afterSave` / `afterDelete` per aggiornare campi conteggio su entità correlate

## Testare un callback

Un callback è una semplice funzione con un singolo oggetto di props, quindi un unit test può chiamarla direttamente. `createCallContext` crea la prop `context`: i campi passati vengono utilizzati così come sono, mentre quelli omessi sono sostituti (stand-in) che generano un errore al primo utilizzo indicando il proprio nome, garantendo che il test fornisca solo ciò che l'hook tocca realmente.

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCallContext } from "@rebasepro/server";
import type { User } from "@rebasepro/types";
import articlesCollection from "../config/collections/articles";

const editor: User = {
    uid: "u1", displayName: null, email: null, photoURL: null,
    providerId: "password", isAnonymous: false, roles: ["editor"]
};

test("beforeSave derives the slug from the title", async () => {
    const values = await articlesCollection.callbacks!.beforeSave!({
        collection: articlesCollection,
        path: "articles",
        status: "new",
        values: { title: "Hello World" },
        context: createCallContext({ user: editor })
    });
    assert.equal(values.slug, "hello-world");
});
```

Un hook che legge o scrive tramite `context.data` necessita di un driver: passa `createCallContext({ data: buildSdkData(driver) })`, con `buildSdkData` da `@rebasepro/common` e qualsiasi `DataDriver`, inclusa un'implementazione in memoria. `user` rimane assente a meno che non venga passato, esattamente come avviene in una scrittura senza chiamante, consentendo di testare fedelmente un ramo `if (context.user)`. Per eseguire invece gli hook su un database reale, consulta [Script e Console](/docs/backend/scripts/).

## Riferimento completo del Context

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

Esegui le query tramite `context.data`. `context.client` non contiene `data`: lato server è il singleton `rebase`, il cui unico piano dati è `dataAsAdmin` con ambito amministratore, quindi `context.client.data` genera un errore di compilazione. Per costruirne uno a scopo di test, consulta [Testare un callback](#testare-un-callback).

## Passaggi successivi

- **[Regole di sicurezza](/docs/collections/security-rules)** — Sicurezza a livello di riga (Row Level Security)
- **[Cronologia delle entità](/docs/backend/history)** — Audit trail
- **[Funzioni personalizzate](/docs/backend/custom-functions)** — Aggiungi endpoint API personalizzati
