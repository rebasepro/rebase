---
sourceHash: 3885c8f3dc44eb65
title: Callback delle entità
sidebar_label: Callback
description: Usa i callback del ciclo di vita per eseguire logica personalizzata quando le entità vengono create, aggiornate, lette o eliminate. Include l'API context.data per operazioni tra collezioni.
---

## Panoramica

I callback ti consentono di agganciarti al ciclo di vita delle entità per:

- **Sincronizzare i dati tra le collezioni** — copiare o spostare entità tra tabelle al variare dello stato
- **Trasformare i dati** prima del salvataggio (campi calcolati, generazione di slug)
- **Validare** le regole di business oltre la validazione dello schema
- **Attivare effetti collaterali** dopo le scritture (invio di email, sincronizzazione API, aggiornamento cache)
- **Restringere una lettura** prima che venga compilata, in modo che un chiamante veda sempre e solo le proprie righe
- **Filtrare/trasformare** i dati dopo la lettura
- **Operazioni a cascata** — ripulire i record correlati durante l'eliminazione

## Dove vengono eseguiti i callback

Una collezione ha due blocchi di callback, e l'unica differenza è quale runtime
li esegue.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Eseguito su | il server | il pannello di amministrazione, nel browser |
| Si attiva per | REST, SDK, realtime, `dataAsAdmin` | letture e scritture effettuate dal pannello |
| Raggiunge il browser | no — i corpi vengono rimossi dal bundle | sì, per intero |
| Utilizzo | tutto ciò che è descritto sotto | collezioni con cui il pannello interagisce direttamente |

**`callbacks` è quello che cerchi.** Viene eseguito su ogni percorso dati che raggiunge
il server — REST, SDK, realtime, MCP e `rebase.data` — e il suo corpo non lascia
mai la macchina, quindi una chiave API o una lettura di `process.env` al suo interno è sicura. Il
resto di questa pagina riguarda `callbacks`.

Un elemento di scrittura non è un percorso dati: **il sistema di autenticazione**. La registrazione, l'accesso OAuth
e la gestione degli utenti dell'admin scrivono direttamente le righe degli utenti e non eseguono
nessuno dei loro callback, quindi un'email di benvenuto in `afterSave` su `users` non scatterà mai alla
registrazione. Collegala agli [hook di autenticazione](/docs/backend/authentication/) passati in
`auth.hooks` — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` — che
richiedono un backend espulso; il boot avvisa quando la collezione users dichiara callback
che la registrazione non eseguirà.

`admin.browserCallbacks` esiste per un solo caso: una collezione su un trasporto `direct` o
`custom`, che il pannello legge e scrive *autonomamente* senza alcun server
Rebase nel percorso della richiesta. Nessun componente lato server vede queste operazioni, quindi
`callbacks` non potrà mai attivarsi per esse, e questo blocco è l'unico posto in cui
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

Dalla caratteristica "inviato a ogni visitatore" derivano due regole, nessuna delle quali è stilistica:

1. **Nessun segreto.** Niente chiavi API, niente `process.env`, niente che ti dispiacerebbe far
   vedere a chi legge il bundle. Questo tipo di dati appartiene a `callbacks`.
2. **Non è un perimetro di sicurezza.** Un `browserCallbacks.afterRead` che
   oscura un campo lo fa *dopo* che il browser possiede già la riga — su un
   trasporto diretto il documento grezzo arriva direttamente dallo storage. Si tratta
   di presentazione. L'oscuramento che deve essere rigoroso va inserito in `callbacks`, o nelle
   regole stesse dello store.

Su una collezione con trasporto server — l'impostazione predefinita, e quasi sicuramente la tua —
il server ha già eseguito `callbacks` prima che la riga raggiunga il pannello, quindi un
`browserCallbacks.afterRead` viene eseguito *in aggiunta* ad esso. Scrivilo in modo che sia
idempotente, altrimenti non scriverlo.

A entrambi i blocchi viene passata la stessa cosa: le righe come inviate dal server, una data
come stringa ISO e un belongsTo come colonna di chiave esterna. Questo vale per
ogni scrittura effettuata dal pannello — il salvataggio di un form di record, una modifica inline della tabella,
`useRowWrites` e una scrittura tramite il `context.data` del browser — quindi un singolo
corpo di callback funziona in entrambi i blocchi. Ciò che un `browserCallbacks.beforeSave`
modifica nella riga restituita è ciò che il form salva. Il `context` che riceve è
quello del browser: il suo `data` legge le righe allo stesso modo, e una scrittura effettuata tramite esso esegue
anche i `browserCallbacks` della collezione, quindi un hook che scrive sulla propria
collezione rieseguirà se stesso.

Un `browserCallbacks.afterSave` viene eseguito dopo che la scrittura è stata memorizzata, e
nulla nel browser può annullarla. Un errore lanciato al suo interno viene mostrato come un avviso;
il salvataggio stesso viene segnalato come completato, così il form non propone di creare il
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

## Combinare set di callback

Nella versione 0.24, combina
i set manualmente.

Una collezione ha un solo oggetto `callbacks`. Quando diverse esigenze richiedono ciascuna un hook,
come timestamp, audit trail e scope di tenant, scrivi ciascuna esigenza come un set a sé stante
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

I set vengono eseguiti nell'ordine specificato, e ogni hook si combina nel modo in cui il backend
combina i propri livelli [globali](/docs/backend/hooks), di collezione e di proprietà:

| Hook | Combinato |
|---|---|
| `beforeSave` | Concatenato: ogni set vede i valori restituiti da quello precedente, uniti in modo superficiale (shallow-merge) rispetto a quanto ricevuto |
| `afterRead` | Concatenato: ogni set riceve la riga restituita da quello precedente |
| `beforeQuery` | In AND logico: ogni set vede la query del chiamante, e una riga deve superare ogni restringimento |
| `beforeDelete` | Qualsiasi `false` pone il veto sull'eliminazione; ogni set viene comunque eseguito |
| `afterSave`, `afterDelete` | Eseguiti in ordine, ciascuno atteso con await; un errore blocca l'esecuzione dei restanti |
| `afterSaveError` | Eseguiti in ordine; un errore non blocca il set successivo, e il primo errore viene rilanciato alla fine |

Un hook è presente nel risultato solo se almeno un set lo include, e un set `undefined` viene
ignorato. `composeCallbacks` è esportato anche da `@rebasepro/server` e
`@rebasepro/common`.

L'aggiunta di callback dopo l'avvio con `backend.setCollectionCallbacks(slug,
callbacks)` **sostituisce** quelli dichiarati dalla collezione. Per aggiungere i tuoi ad
essi, passa `composeCallbacks(declared, yours)`.

## Riferimento dei callback

### `beforeQuery`

Chiamato **prima che una lettura venga compilata**, per restringere quali righe vengono richieste. Restituisce
condizioni da inserire in AND nella query; non restituire nulla per non aggiungerne alcuna.

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

`afterRead` vede le righe che sono già state recuperate, quindi può oscurare un valore
ma non può impedire la lettura della riga. Questo viene eseguito prima, e ci sono tre aspetti
importanti da considerare:

- **Può solo restringere.** Il valore restituito è un filtro da aggiungere in AND, e nessun valore
  che può restituire amplierà la lettura. `filter` accetta gli stessi filtri di campo
  di una query; `logical` accetta un gruppo `or`/`and`, per uno scope come "miei, o condivisi
  con me" — sempre inserito in AND nel suo complesso, quindi l'operatore `or` sceglie solo
  tra le righe già ammesse dal resto della query.
- **Si attiva su ogni percorso di lettura.** L'elenco, la singola lettura, il conteggio,
  l'aggregazione, la ricerca, la lettura vettoriale, l'elenco su percorso nidificato, il refetch realtime
  dietro un `.listen()`, e le righe caricate per una relazione o un
  `?include=` — dove è l'hook della collezione di **destinazione** ad applicarsi,
  poiché si tratta delle righe della destinazione.
- **Un filtro che non può essere compilato rifiuta la richiesta.** Indicare una colonna che
  la tabella non possiede genera un errore 400, mai una condizione ignorata.
- **Una scrittura su una riga che esclude genera un 404.** Un aggiornamento o un'eliminazione indirizzati a
  una riga al di fuori dello scope vengono rifiutati prima della scrittura, con la stessa risposta
  "nessuna riga …" restituita da una lettura — quindi uno scope funge da scope anche per le scritture, non solo per
  le letture. Una scrittura di appartenenza uno-a-molti (`comments: [ids]` su un post) lascia un
  figlio nascosto dallo scope di destinazione esattamente dove si trova, così come farebbe con un id che non punta ad alcuna
  riga. Ciò su cui *non* interviene sono i valori in fase di scrittura: rifiutare una scrittura
  in base ai suoi contenuti spetta a `beforeSave`.

Una lettura viene deliberatamente non ristretta: il controllo di univocità dietro
`validation: { unique: true }`. Questo verifica se un valore esiste ovunque nella
tabella e, se ristretto, risponderebbe "univoco" per un valore già presente in una riga nascosta.

:::caution[Al momento solo per Postgres]
`beforeQuery` è implementato da `@rebasepro/server-postgres`. Una collezione gestita
da MongoDB o Firestore che ne dichiara uno **fallisce all'avvio**, con un errore esplicito, invece
di essere servita con l'hook silenziosamente inerte — il che, per un filtro di riga,
significherebbe servire ogni riga a chiunque. Un `beforeQuery` [globale](/docs/backend/hooks)
fallisce all'avvio allo stesso modo se una qualsiasi origine dati non è Postgres, e
lo stesso accade per uno collegato successivamente con `setCollectionCallbacks`. L'oscuramento che funziona
su qualsiasi engine è [`afterRead`](#afterread).
:::

→ Consulta [Estendere il server](/docs/backend/extending#2-collection-callbacks) per comprendere
la sua collocazione tra le altre opzioni.

### `beforeSave`

Chiamato prima che un record venga scritto nel database. Restituisce i valori modificati.
Su Postgres viene eseguito all'interno della transazione di scrittura, che è già iniziata, quindi
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

Per scegliere autonomamente lo stato e il codice — un 409 per un conflitto, un 422 per un dato
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
è condiviso con il frontend — la build Vite del pannello admin legge questa stessa
directory — quindi può importare solo pacchetti eseguibili in un browser. `RebaseApiError`
è la versione browser-safe, ed è la stessa classe lanciata dall'SDK tipizzato.
:::

### `afterSave`

Chiamato dopo che la riga è stata scritta e prima del commit, all'interno della stessa transazione. Un errore lanciato annulla (rollback) il salvataggio — vedi [Semantica delle transazioni](/docs/collections/context-data-api#transaction-semantics).

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

Viene eseguito per un salvataggio fallito sul database o dopo di esso — non per un
rifiuto di `beforeSave`, una richiesta rifiutata prima della scrittura (validazione,
permesso mancante, 404), o un commit rifiutato dopo il ritorno del salvataggio ([elenco completo](/docs/backend/hooks/#when-aftersaveerror-runs)).

Su una richiesta, viene eseguito una volta che la transazione della scrittura fallita ha effettuato il rollback, non
al suo interno. Il suo `context.data` è una nuova istanza per lo stesso chiamante, in cui ogni chiamata
è una transazione a sé stante, quindi un [job](/docs/backend/jobs), un messaggio di coda o
un webhook che inserisce in coda esegue il commit e sopravvive al fallimento segnalato. Un errore lanciato da
`afterSaveError` viene registrato nei log, e il chiamante riceve comunque l'errore del salvataggio originario.

### `afterRead`

Chiamato dopo la lettura delle entità dal database. Trasforma i dati per la visualizzazione.

Modella ciò che un chiamante riceve — la risposta di una lettura o di una scrittura, e il relativo
frame realtime — e nient'altro: `afterSave`, `beforeDelete`, `afterDelete` e
la [cronologia](/docs/backend/history) ricevono la riga così come è memorizzata: un valore mascherato qui non è
mai ciò che un audit registra o che un ripristino riscrive, e un campo aggiunto qui non viene
mai scritto.

Un'aggregazione restituisce somme e conteggi, non righe, quindi non può passare attraverso
`afterRead`. Su una collezione a cui si applica, viene gestito solo `count()` senza `groupBy`;
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

Chiamato prima che un record venga eliminato. Lancia un errore per bloccare l'eliminazione, e il chiamante riceverà `400 CALLBACK_REJECTED` con il tuo messaggio. Restituire `false` la blocca ugualmente, come `403 CALLBACK_REJECTED` senza alcun messaggio personalizzato.

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

## Callback di proprietà

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

## Sincronizzare i dati tra le collezioni

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

- **Eliminazione a cascata**: Usa `afterDelete` per rimuovere record correlati nelle collezioni figlie
- **Denormalizzazione**: Usa `afterSave` per aggiornare campi di riepilogo in una collezione genitore
- **Log di audit**: Usa `afterSave` / `afterDelete` per scrivere in una collezione di audit log
- **Contatori**: Usa `afterSave` / `afterDelete` per aggiornare i campi di conteggio sulle entità correlate

## Testare un callback

Un callback è una semplice funzione con un singolo oggetto di props, quindi un unit test può chiamarla direttamente.
`createCallContext` crea la prop `context`: i campi che passi vengono usati
così come sono, e qualsiasi campo omesso è un sostituto che lancia un errore al primo utilizzo, indicando
il proprio nome, così un test fornisce solo ciò che l'hook tocca realmente.

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
`@rebasepro/common` e qualsiasi `DataDriver`, incluso uno in memoria. `user`
rimane assente a meno che non venga passato, esattamente come avviene in una scrittura senza chiamante, così
un ramo `if (context.user)` può essere testato fedelmente. Per eseguire gli hook su un
database reale, vedi [Script e console](/docs/backend/scripts/).

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
il singleton `rebase`, il cui unico piano dati è `dataAsAdmin` con ambito di amministrazione,
quindi `context.client.data` genera un errore di compilazione. Per crearne uno per un test,
vedi [Testare un callback](#testare-un-callback).

## Prossimi passi

- **[Regole di sicurezza](/docs/collections/security-rules)** — Sicurezza a livello di riga (RLS)
- **[Cronologia delle entità](/docs/backend/history)** — Audit trail
- **[Funzioni personalizzate](/docs/backend/custom-functions)** — Aggiungere endpoint API personalizzati
