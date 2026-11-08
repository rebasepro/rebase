---
sourceHash: 9b21d41a290148dd
title: Callback delle entità
sidebar_label: Callback
description: Utilizza i callback del ciclo di vita per eseguire logica personalizzata quando le entità vengono create, aggiornate, lette o eliminate. Include l'API context.data per operazioni tra collezioni.
---

## Panoramica

I callback ti consentono di agganciarti al ciclo di vita delle entità per:

- **Sincronizzare i dati tra collezioni** — copiare o spostare entità tra tabelle in base ai cambiamenti di stato
- **Trasformare i dati** prima del salvataggio (campi calcolati, generazione di slug)
- **Validare** le regole di business oltre la validazione dello schema
- **Attivare effetti collaterali** dopo le scritture (inviare email, sincronizzare API, aggiornare cache)
- **Restringere una lettura** prima che venga compilata, in modo che un chiamante veda sempre e solo le proprie righe
- **Filtrare/trasformare** i dati dopo la lettura
- **Operazioni a cascata** — ripulire i record correlati durante l'eliminazione

## Dove vengono eseguiti i callback

Una collezione ha due blocchi di callback, e l'unica differenza è quale runtime
li esegue.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Viene eseguito su | il server | il pannello di amministrazione, nel browser |
| Si attiva per | REST, l'SDK, realtime, `dataAsAdmin` | letture e scritture effettuate dal pannello |
| Raggiunge il browser | no — i corpi vengono rimossi dal bundle | sì, per intero |
| Utilizzare per | tutto ciò che segue | collezioni con cui il pannello comunica direttamente |

**`callbacks` è quello che desideri.** Viene eseguito su ogni percorso dati che raggiunge
il server — REST, l'SDK, realtime, MCP e `rebase.data` — e il suo corpo non lascia
mai la macchina, quindi una chiave API o una lettura di `process.env` al suo interno è sicura. Il
resto di questa pagina riguarda `callbacks`.

Un elemento di scrittura non è un percorso dati: **il sistema di autenticazione**. La registrazione, l'accesso OAuth
e la gestione utenti dell'admin scrivono direttamente le righe degli utenti senza eseguire nessuno dei
loro callback, quindi un'email di benvenuto in `afterSave` su `users` non viene mai attivata alla
registrazione. Agganciala agli [hook di autenticazione](/docs/backend/authentication/) passati in
`auth.hooks` — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` — che
richiedono un backend espulso; l'avvio avvisa quando la collezione utenti dichiara callback
che la registrazione non eseguirà.

`admin.browserCallbacks` esiste per un unico caso: una collezione su un trasporto `direct` o
`custom`, che il pannello legge e scrive *autonomamente* senza alcun server Rebase
nel percorso della richiesta. Nessun elemento lato server vede queste operazioni, quindi
`callbacks` non potrà mai attivarsi per esse, e questo blocco è l'unico posto in cui la loro
logica del ciclo di vita può risiedere.

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

Due regole derivano dall'essere "inviato a ogni visitatore", e nessuna delle due riguarda lo stile:

1. **Nessun segreto.** Nessuna chiave API, nessun `process.env`, niente che ti dispiacerebbe venisse
   visto da chi legge il bundle. Questo appartiene a `callbacks`.
2. **Non è un limite di sicurezza.** Un `browserCallbacks.afterRead` che
   oscura un campo lo fa *dopo* che il browser possiede già la riga — su un
   trasporto diretto il documento grezzo proviene direttamente dallo store. Si tratta di
   presentazione. L'oscuramento che deve essere garantito va inserito in `callbacks`, o nelle
   regole stesse dello store.

Su una collezione con trasporto server — l'impostazione predefinita, e quasi certamente la tua —
il server ha già eseguito `callbacks` prima che la riga raggiunga il pannello, quindi un
`browserCallbacks.afterRead` viene eseguito *in aggiunta* ad esso. Scrivilo in modo che sia
idempotente, oppure non scriverlo.

Un `browserCallbacks.afterSave` viene eseguito dopo che la scrittura è stata memorizzata, e
nulla nel browser può annullarla. Un errore generato da esso viene mostrato come un avviso;
il salvataggio stesso viene segnalato come completato, in modo che il form non proponga di creare il
record una seconda volta.

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

## Combinare insiemi di callback

Nella versione 0.24, combina
gli insiemi manualmente.

Una collezione ha un unico oggetto `callbacks`. Quando diverse funzionalità richiedono ciascuna un hook,
come timestamp, un audit trail e uno scope di tenancy, scrivi ciascuna come un proprio insieme
e combinale con `composeCallbacks`:

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

Gli insiemi vengono eseguiti nell'ordine specificato, e ogni hook si combina nel modo in cui il backend
combina i propri livelli [globali](/docs/backend/hooks), di collezione e di proprietà:

| Hook | Combinato |
|---|---|
| `beforeSave` | Concatenato: ogni insieme vede i valori restituiti da quello precedente, uniti in modalità shallow sopra quanto ricevuto |
| `afterRead` | Concatenato: ogni insieme riceve la riga restituita da quello precedente |
| `beforeQuery` | In AND: ogni insieme vede la query del chiamante, e una riga deve superare ogni restrizione |
| `beforeDelete` | Qualsiasi `false` pone il veto all'eliminazione; ogni insieme viene comunque eseguito |
| `afterSave`, `afterDelete` | Eseguiti in ordine, ciascuno atteso con await; un'eccezione interrompe i rimanenti |
| `afterSaveError` | Eseguiti in ordine; un'eccezione non interrompe l'insieme successivo, e il primo errore viene rilanciato alla fine |

Un hook è presente nel risultato solo se qualche insieme lo contiene, e un insieme `undefined` viene
ignorato. `composeCallbacks` viene esportato anche da `@rebasepro/server` e
`@rebasepro/common`.

Collegare callback dopo l'avvio con `backend.setCollectionCallbacks(slug,
callbacks)` **sostituisce** quelli dichiarati dalla collezione. Per aggiungere i tuoi ad
essi, passa `composeCallbacks(declared, yours)`.

## Riferimento dei callback

### `beforeQuery`

Chiamato **prima che una lettura venga compilata**, per restringere le righe richieste. Restituisce
le condizioni da aggiungere in AND alla query; non restituire nulla per non aggiungerne alcuna.

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

`afterRead` vede righe che sono già state recuperate, quindi può oscurare un valore
ma non può impedire che la riga venga letta. Questo viene eseguito prima, e vale la pena
conoscere tre aspetti a riguardo:

- **Può solo restringere.** Il valore restituito è un filtro da aggiungere in AND, e nessun valore
  che può restituire amplia la lettura. `filter` accetta gli stessi filtri di campo di una query;
  `logical` accetta un gruppo `or`/`and`, per uno scope come "miei, o condivisi
  con me" — comunque inserito in AND nel suo complesso, quindi l'`or` sceglie solo tra
  le righe già ammesse dal resto della query.
- **Si attiva su ogni percorso di lettura.** L'elenco, la singola get, il conteggio,
  l'aggregazione, la ricerca, la lettura vettoriale, un elenco a percorsi annidati, il refetch
  realtime dietro a un `.listen()`, e le righe caricate per una relazione o un
  `?include=` — dove si applica l'hook della collezione di **destinazione**,
  poiché quelle sono le righe della destinazione.
- **Un filtro che non può compilare rifiuta la richiesta.** Indicare una colonna che
  la tabella non possiede genera un errore 400, mai una condizione ignorata.
- **Una scrittura su una riga che esclude genera un 404.** Un aggiornamento o un'eliminazione indirizzati a
  una riga al di fuori dello scope vengono rifiutati prima della scrittura, con la stessa
  risposta "nessuna riga …" fornita da una lettura — quindi uno scope è uno scope anche per le scritture,
  non solo per le letture. Una scrittura di appartenenza uno-a-molti (`comments: [ids]` su un post) lascia
  un elemento figlio nascosto dallo scope di destinazione dov'è, poiché lascia un id che non fa riferimento ad alcuna
  riga. Ciò che *non* controlla sono i valori scritti: rifiutare una scrittura
  in base al suo contenuto è compito di `beforeSave`.

Una lettura viene deliberatamente non ristretta: il controllo di unicità alla base di
`validation: { unique: true }`. Verifica se un valore esiste ovunque nella
tabella, e se ristretta risponderebbe "univoco" per un valore che una riga nascosta
contiene già.

:::caution[Solo Postgres, per ora]
`beforeQuery` è implementato da `@rebasepro/server-postgres`. Una collezione servita
da MongoDB o Firestore che ne dichiara uno **fallisce all'avvio**, per nome, piuttosto
che essere servita con l'hook silenziosamente inerte — il che, per un filtro di riga,
significherebbe servire ogni riga a chiunque. Un `beforeQuery` [globale](/docs/backend/hooks)
fallisce all'avvio allo stesso modo se una qualsiasi origine dati non è Postgres, così come
uno collegato successivamente con `setCollectionCallbacks`. L'oscuramento che funziona
su ogni motore è [`afterRead`](#afterread).
:::

→ [Estendere il server](/docs/backend/extending#2-collection-callbacks) per
sapere dove questo si colloca rispetto alle altre opzioni.

### `beforeSave`

Chiamato prima che un record venga scritto nel database. Restituisce i valori modificati.
Su Postgres viene eseguito all'interno della transazione della scrittura, che è già iniziata, quindi
trattiene una connessione del pool per tutta la durata dell'esecuzione — vedi [Un callback trattiene una
connessione](/docs/collections/context-data-api#a-callback-holds-a-connection).

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

Lancia un errore per **bloccare il salvataggio**. La scrittura non raggiunge mai il database, e
il chiamante riceve un **400** con il tuo messaggio e il codice `CALLBACK_REJECTED`:

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

Per scegliere personalmente lo stato e il codice — un 409 per un conflitto, un 422 per un dato
ben formato ma non accettabile — lancia un `RebaseApiError`:

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
è quello compatibile con il browser, ed è la stessa classe lanciata dall'SDK tipizzato.
:::

### `afterSave`

Chiamato dopo che la riga è stata scritta e prima del commit, all'interno della stessa transazione. Un errore generato annulla il salvataggio (rollback) — vedi [Semantica delle transazioni](/docs/collections/context-data-api#transaction-semantics).

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

Viene eseguito per un salvataggio fallito nel database o successivamente — non per un
rifiuto di `beforeSave`, una richiesta rifiutata prima della scrittura (validazione, un
permesso mancante, un 404), o un commit rifiutato dopo il completamento del salvataggio ([elenco completo](/docs/backend/hooks/#when-aftersaveerror-runs)).

Su una richiesta, viene eseguito una volta che la transazione della scrittura fallita ha effettuato il rollback, non
al suo interno. Il suo `context.data` è una nuova istanza per lo stesso chiamante, in cui ogni chiamata
rappresenta una transazione a sé stante, quindi un [job](/docs/backend/jobs), un messaggio di coda o un
webhook accodato esegue il commit e sopravvive al fallimento segnalato. Un errore generato da
`afterSaveError` viene registrato nei log, e il chiamante riceve comunque l'errore del salvataggio stesso.

### `afterRead`

Chiamato dopo aver letto le entità dal database. Trasforma i dati per la visualizzazione.

Modella ciò che riceve un chiamante — la risposta di una lettura o di una scrittura, e il relativo
frame realtime — e nient'altro: `afterSave`, `beforeDelete`, `afterDelete` e
la [cronologia](/docs/backend/history) ottengono la riga così come memorizzata: un valore mascherato qui non è
mai ciò che un audit registra o un ripristino riscrive, e un campo aggiunto qui non viene
mai scritto.

Un'aggregazione restituisce somme e conteggi, non righe, quindi non può passare attraverso
`afterRead`. Su una collezione a cui se ne applica uno, viene servito solo il `count()` senza `groupBy`;
qualsiasi altra [aggregazione](/docs/sdk/aggregates-and-search/#aggregates) viene
rifiutata con `400 AGGREGATE_MASKED_BY_AFTER_READ`.

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

Chiamato prima dell'eliminazione di un record. Genera un errore per bloccare l'eliminazione; il chiamante riceve `400 CALLBACK_REJECTED` con il tuo messaggio. Anche restituire `false` la blocca, come `403 CALLBACK_REJECTED` senza alcun tuo messaggio.

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

Chiamato dopo l'eliminazione della riga e prima del commit, all'interno della stessa transazione. Un errore generato annulla l'eliminazione (rollback).

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

È anche possibile definire callback a livello di proprietà per trasformazioni specifiche di un campo:

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

Altri pattern tra collezioni:

- **Eliminazione a cascata**: usa `afterDelete` per rimuovere i record correlati nelle collezioni figlie
- **Denormalizzazione**: usa `afterSave` per aggiornare i campi di riepilogo in una collezione genitore
- **Log di audit**: usa `afterSave` / `afterDelete` per scrivere in una collezione di log di audit
- **Contatori**: usa `afterSave` / `afterDelete` per aggiornare i campi di conteggio sulle entità correlate

## Testare un callback

Un callback è una semplice funzione con un unico oggetto di props, quindi un test unitario la chiama direttamente.
`createCallContext` crea la prop `context`: i campi passati vengono utilizzati così
come sono, e qualsiasi campo omesso è un sostituto che genera un errore al primo utilizzo, indicando
il proprio nome, in modo che un test fornisca solo ciò che l'hook tocca realmente.

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

Un hook che legge o scrive tramite `context.data` necessita di un driver: passa
`createCallContext({ data: buildSdkData(driver) })`, con `buildSdkData` da
`@rebasepro/common` e un qualsiasi `DataDriver`, incluso uno in-memory. `user`
rimane assente a meno che non venga passato, esattamente come avviene in una scrittura senza chiamante, in modo che un
ramo `if (context.user)` venga testato fedelmente. Per eseguire invece gli hook su un
database reale, consulta [Script e Console](/docs/backend/scripts/).

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

Esegui le query tramite `context.data`. `context.client` non contiene `data`: lato server è
il singleton `rebase`, il cui unico piano dati è `dataAsAdmin` con ambito admin,
quindi `context.client.data` genera un errore di compilazione. Per costruirne uno per un test,
consulta [Testare un callback](#testare-un-callback).

## Passaggi successivi

- **[Regole di sicurezza](/docs/collections/security-rules)** — Row Level Security
- **[Cronologia delle entità](/docs/backend/history)** — Audit trail
- **[Funzioni personalizzate](/docs/backend/custom-functions)** — Aggiungere endpoint API personalizzati
