---
sourceHash: e806583db3fff138
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

Un `browserCallbacks.afterSave` viene eseguito dopo che la scrittura è stata memorizzata, e
nulla nel browser può annullarla. Un'eccezione lanciata da esso viene mostrata come avviso;
il salvataggio stesso viene segnalato come completato, così il modulo non propone di creare
di nuovo il record una seconda volta.

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
            // Throw (or return false) to block the deletion
        },

        afterRead: async ({ row }) => {
            // Transform data after loading
            return row;
        }
    }
});
```

## Combinare Insiemi di Callback

<span class="since-badge" data-since="0.25">Da 0.25</span> Su 0.24, combina gli
insiemi a mano.

Una collezione ha un solo oggetto `callbacks`. Quando più responsabilità vogliono ciascuna
un hook, come i timestamp, un audit trail e un ambito per tenant, scrivi ciascuna come
insieme a sé e combinale con `composeCallbacks`:

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

Gli insiemi vengono eseguiti nell'ordine indicato, e ogni hook si combina nel modo in cui
il backend combina i propri livelli [globale](/docs/backend/hooks), di collezione e di
proprietà:

| Hook | Combinazione |
|---|---|
| `beforeSave` | A catena: ogni insieme vede i valori restituiti dal precedente, uniti in modo superficiale (shallow merge) a quelli che aveva ricevuto |
| `afterRead` | A catena: ogni insieme riceve la riga restituita dal precedente |
| `beforeQuery` | In AND: ogni insieme vede la query del chiamante, e una riga deve superare ogni restrizione |
| `beforeDelete` | Qualsiasi `false` pone il veto all'eliminazione; tutti gli insiemi vengono comunque eseguiti |
| `afterSave`, `afterDelete` | Eseguiti in ordine, ciascuno atteso (await); un errore lanciato ferma i successivi |
| `afterSaveError` | Eseguiti in ordine; un errore lanciato non ferma l'insieme successivo, e il primo errore viene rilanciato alla fine |

Un hook compare nel risultato solo se qualche insieme lo ha, e un insieme `undefined`
viene saltato. `composeCallbacks` è esportato anche da `@rebasepro/server` e
`@rebasepro/common`.

Collegare i callback dopo l'avvio con `backend.setCollectionCallbacks(slug,
callbacks)` **sostituisce** quelli che la collezione aveva dichiarato. Per aggiungere i
tuoi ai loro, passa `composeCallbacks(declared, yours)`.

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
- **Una scrittura su una riga che esclude genera un 404.** Un aggiornamento o un'eliminazione indirizzati a una riga al di fuori dell'ambito vengono rifiutati prima della scrittura, con la stessa risposta "nessuna riga …" restituita da una lettura — quindi un ambito è un ambito anche per le scritture, non solo per le letture. Una scrittura di appartenenza uno-a-molti (`comments: [ids]` su un post) lascia dov'è un figlio che l'ambito del target nasconde, come lascia un id che non indica alcuna riga. Ciò che *non* controlla sono i valori che vengono scritti: il rifiuto di una scrittura in base al suo contenuto spetta a `beforeSave`.

Una lettura è deliberatamente non ristretta: il controllo di unicità alla base di `validation: { unique: true }`. Essa verifica se un valore esiste in qualsiasi punto della tabella e, se ristretta, risponderebbe "univoco" per un valore che una riga nascosta contiene già.

:::caution[Solo per Postgres, per ora]
`beforeQuery` è implementato da `@rebasepro/server-postgres`. Una collezione servita da MongoDB o Firestore che ne dichiara uno **fallisce all'avvio**, per nome, anziché essere servita con l'hook silenziosamente inattivo — il che per un filtro di riga significherebbe servire ogni riga a chiunque. Un `beforeQuery` [globale](/docs/backend/hooks) fallisce all'avvio nello stesso modo se una qualsiasi origine dati non è Postgres, e lo stesso vale per uno collegato in seguito con `setCollectionCallbacks`. L'oscuramento che funziona su ogni motore è [`afterRead`](#afterread).
:::

→ Consulta [Estendere il server](/docs/backend/extending#2-collection-callbacks) per capire dove questo si posiziona tra le altre opzioni.

### `beforeSave`

Chiamato prima che un record venga scritto nel database. Restituisce i valori modificati.
Su Postgres viene eseguito all'interno della transazione della scrittura, che è già iniziata,
quindi tiene impegnata una connessione del pool per tutto il tempo in cui è in esecuzione — vedi [Un callback tiene
una connessione](/docs/collections/context-data-api#a-callback-holds-a-connection).

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

Chiamato dopo che la riga è stata scritta e prima del commit, all'interno della stessa transazione. Un errore lanciato annulla il salvataggio (rollback) — vedi [Semantica delle transazioni](/docs/collections/context-data-api#transaction-semantics).

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

Chiamato prima che un record venga eliminato. Lancia un errore per bloccare l'eliminazione, e il chiamante riceve `400 CALLBACK_REJECTED` con il tuo messaggio. Anche restituire `false` la blocca, come `403 CALLBACK_REJECTED` senza alcun messaggio tuo.

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

Ogni callback riceve anche `context.data`, un livello di accesso ai dati per leggere e scrivere altre collection dall'interno dell'hook — vedi [L'API `context.data`](/docs/collections/context-data-api).

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

## Testare un Callback

<span class="since-badge" data-since="0.25">Da 0.25</span>

Un callback è una semplice funzione di un unico oggetto props, quindi un test unitario
lo chiama direttamente. `createCallContext` costruisce la prop `context`: i campi che
passi vengono usati così come sono, e quelli che ometti sono segnaposto che lanciano un
errore al primo utilizzo, indicando il proprio nome, così un test fornisce soltanto ciò
che l'hook tocca davvero.

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

Un hook che legge o scrive tramite `context.data` ha bisogno di un driver: passa
`createCallContext({ data: buildSdkData(driver) })`, con `buildSdkData` da
`@rebasepro/common` e qualsiasi `DataDriver`, compreso uno in memoria. `user` resta
assente a meno che tu non lo passi, come accade in una scrittura senza chiamante, così un
ramo `if (context.user)` viene testato in modo onesto. Per eseguire gli hook su un
database reale, vedi [Script e console](/docs/backend/scripts/).

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

Esegui le query tramite `context.data`. `context.client` non contiene `data`: lato server è il singleton `rebase`, il cui unico piano dati è `dataAsAdmin` limitato ad admin, pertanto `context.client.data` genera un errore di compilazione. Per costruirne uno per un test, vedi [Testare un Callback](#testare-un-callback).

## Passaggi Successivi

- **[Regole di Sicurezza](/docs/collections/security-rules)** — Row Level Security
- **[Cronologia delle Entità](/docs/backend/history)** — Audit trail
- **[Funzioni Personalizzate](/docs/backend/custom-functions)** — Aggiungi endpoint API personalizzati
