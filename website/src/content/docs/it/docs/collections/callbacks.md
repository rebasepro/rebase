---
sourceHash: 067f45147f37ef16
title: Hook delle tabelle
sidebar_label: Hook delle tabelle
description: "Esegui codice lato server a ogni passaggio del ciclo di vita di una tabella con gli hook: limita le letture, maschera campi, convalida e completa scritture, reagisci a salvataggi ed eliminazioni, e trasforma singole colonne."
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

Gli `hooks` di una tabella vengono eseguiti sul server a ogni passaggio della vita di una riga: prima di una lettura, su ogni riga che lascia il server, prima e dopo una scrittura, e prima e dopo un'eliminazione. Vengono eseguiti per qualsiasi punto di accesso alla tabella — REST, l'SDK, realtime, MCP e codice server tramite `rebase.data` — e il loro codice non lascia mai il server, quindi una chiave API o una lettura di `process.env` all'interno di un hook è sicura.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        title:  col.text().notNull(),
        slug:   col.text().notNull().unique(),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
    },
    rls: "admin-only",
    hooks: {
        beforeSave: ({ values, previousValues }) => {
            // Derive the slug from the title when none is given.
            const title = values.title ?? previousValues?.title;
            if (title && !values.slug && !previousValues?.slug) {
                values.slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            }
            return values;
        },
        beforeDelete: ({ values }) => {
            if (values.status === "published") {
                throw new Error("Unpublish the article before deleting it.");
            }
        },
    },
});
```

Le proprietà sono tipizzate a partire dalle colonne della tabella: `values.title` qui sopra è una `string`, e `values.status` è `"draft" | "published"`.

:::note[Arrivi dalle collection?]
Gli hook delle tabelle sono i `callbacks` lato server di una collection, con lo stesso ciclo di vita. Ogni hook riceve il descrittore della tabella come `table`, mentre `afterRead` e gli hook di eliminazione ricevono la riga come `values`. La guida all'aggiornamento per questa release elenca le modifiche ai nomi.
:::

## I sette hook

<span class="since-badge" data-since="0.31">Da 0.31</span>

| Hook | Quando viene eseguito | Valore restituito |
|---|---|---|
| `beforeQuery` | prima che ogni lettura venga compilata | un filtro da combinare in AND nella lettura, o nulla |
| `afterRead` | su ogni riga che lascia il server | la riga da servire |
| `beforeSave` | prima di una creazione o di un aggiornamento, all'interno della relativa transazione | i valori da scrivere; lancia un errore per rifiutare |
| `afterSave` | dopo la scrittura, prima del commit | nulla; lancia un errore per eseguire il rollback della scrittura |
| `afterSaveError` | dopo che una scrittura è fallita ed è stato eseguito il rollback | nulla |
| `beforeDelete` | prima di un'eliminazione, all'interno della relativa transazione | `false` o lancia un errore per rifiutare |
| `afterDelete` | dopo l'eliminazione, prima del commit | nulla; lancia un errore per eseguire il rollback dell'eliminazione |

Ogni hook può essere `async`. Ogni hook riceve:

| Proprietà | Che cos'è |
|---|---|
| `table` | La tabella così come è nota al server: il suo descrittore, con colonne, relazioni e la configurazione `rls`. |
| `path` | Il percorso a cui è stata indirizzata la richiesta: lo slug o un percorso nidificato. |
| `context` | Il chiamante (`context.user`) e `context.data` limitato al suo ambito. Consulta [L'API `context.data`](/docs/collections/context-data-api/). |

C'è un'operazione di scrittura che non li esegue: **il sistema di autenticazione**. La registrazione, l'accesso OAuth e la gestione degli utenti da parte dell'amministratore scrivono direttamente sulla tabella degli utenti. Consulta [La tabella users](/docs/schema/auth-table/#what-does-not-run-for-auth-writes).

Una tabella scritta dal CMS direttamente nel browser, senza alcun server Rebase nel percorso della richiesta, non raggiunge mai questi hook. Il CMS dispone di hook proprietari lato browser per questo caso, descritti insieme alle personalizzazioni del CMS.

## `beforeQuery`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Viene eseguito **prima che una lettura venga compilata**, per limitare le righe richieste. Restituisce condizioni da combinare in AND nella query; non restituire nulla per non aggiungerne alcuna.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        tenantId: col.text().notNull(),
        subject:  col.text().notNull(),
    },
    rls: [{ operation: "all", access: "authenticated" }],
    hooks: {
        beforeQuery: ({ operation, context }) => {
            // operation: "list" | "get" | "count" | "aggregate" | "relation"
            if (context.user?.roles?.includes("admin")) return;
            return { filter: { tenantId: ["==", String(context.user?.uid ?? "")] } };
        },
    },
});
```

- **Può solo restringere l'ambito.** `filter` accetta gli stessi filtri di campo di una query; `logical` accetta un gruppo `or`/`and` per un ambito come "i miei, o condivisi con me", comunque combinato in AND nel suo complesso.
- **Viene eseguito su ogni percorso di lettura**: l'elenco, una singola get, il conteggio, l'aggregazione, la ricerca, la lettura vettoriale, un elenco a percorso nidificato, il refetch realtime alla base di un `.listen()`, e le righe caricate per una relazione o un `?include=`, dove è l'hook della tabella di **destinazione** che viene applicato.
- **Un filtro che non può essere compilato rifiuta la richiesta.** Indicare una colonna che la tabella non possiede genera un errore 400, mai una condizione ignorata.
- **Una scrittura su una riga che esclude genera un 404.** Un aggiornamento o un'eliminazione indirizzati a una riga al di fuori dell'ambito vengono rifiutati prima della scrittura. Rifiutare una scrittura in base ai suoi contenuti spetta a `beforeSave`.

Il controllo di unicità alla base di `.unique()` non viene ristretto: se lo fosse, risponderebbe "univoco" per un valore che una riga nascosta contiene già.

La Row-Level Security è il modello di autorizzazione; `beforeQuery` è logica applicativa al di sopra di essa. Usa [`rls`](/docs/collections/security-rules/) per qualsiasi cosa debba valere anche per l'SQL eseguito con l'identità del chiamante.

## `beforeSave`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Viene eseguito prima che una riga venga scritta e restituisce i valori da scrivere. `values` contiene ogni valore in caso di creazione e quelli modificati in caso di aggiornamento; `previousValues` è la riga così com'era, in caso di aggiornamento; `status` è `"new"`, `"existing"` o `"copy"`; `id` è assente in una creazione la cui chiave viene generata dal database.

Viene eseguito all'interno della transazione della scrittura, quindi trattiene una connessione del pool per tutta la durata della sua esecuzione. Consulta [Un hook trattiene una connessione](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Lancia un errore per **rifiutare la scrittura**. Nulla raggiungerà il database e il chiamante riceverà **400** con il tuo messaggio e il codice `CALLBACK_REJECTED`:

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

Per scegliere lo stato e il codice — un 409 per un conflitto, un 422 per qualcosa di ben formato ma inaccettabile — lancia un `RebaseApiError`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";
import { RebaseApiError } from "@rebasepro/types";

export const products = defineTable("products", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        slug:  col.text().notNull(),
        price: col.numeric({ precision: 10, scale: 2 }).notNull(),
    },
    rls: "admin-only",
    hooks: {
        beforeSave: async ({ values, context }) => {
            if (values.slug) {
                const taken = await context.data.products.count({ where: { slug: ["==", values.slug] } });
                if (taken > 0) throw new RebaseApiError("That slug is taken", { status: 409, code: "SLUG_TAKEN" });
            }
            return values;
        },
    },
});
```

Importa `RebaseApiError` da `@rebasepro/types`: i file di schema non caricano codice server, ed è la stessa classe lanciata dall'SDK tipizzato.

## `afterSave` e `afterSaveError`

<span class="since-badge" data-since="0.31">Da 0.31</span>

`afterSave` viene eseguito dopo che la riga è stata scritta e prima del commit, nella stessa transazione. Le sue `values` rappresentano la riga così come memorizzata. Un'eccezione lanciata esegue il rollback del salvataggio, insieme a tutto ciò che l'hook ha scritto tramite `context.data`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["open", "paid", "shipped"]).notNull().default("open"),
    },
    rls: "admin-only",
    hooks: {
        afterSave: async ({ id, status, values, context }) => {
            // Commits with the order, or not at all.
            await context.data.audit_log.create({ table: "orders", rowId: String(id), action: status, state: values.status });
        },
    },
});
```

Le operazioni che escono dal database — un'e-mail, un webhook — non appartengono al corpo dell'hook: mantengono aperta la transazione per un round trip di rete e nulla può annullarle se la scrittura esegue il rollback. Metti invece in coda un [job](/docs/backend/jobs/); un job accodato da un hook esegue il commit insieme alla scrittura.

`afterSaveError` viene eseguito quando un salvataggio fallisce sul database o successivamente, dopo che la transazione della scrittura fallita ha eseguito il rollback. Non viene eseguito per un rifiuto in `beforeSave` o per una richiesta rifiutata prima della scrittura. Il suo `context.data` è una nuova istanza per lo stesso chiamante, quindi un job accodato al suo interno sopravvive al fallimento segnalato. Un errore lanciato al suo interno viene registrato nei log e il chiamante riceve comunque l'errore originario del salvataggio.

## `afterRead`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Viene eseguito su ogni riga che lascia il server — la risposta di una lettura, la risposta di una scrittura, un frame realtime, un risultato MCP — e restituisce la riga da servire. `values` è la riga così come memorizzata, dopo che il [controllo accessi ai campi](/docs/collections/field-access/) ha rimosso ciò che il chiamante non può leggere.

Modella esclusivamente ciò che un chiamante riceve: `afterSave`, gli hook di eliminazione e la [cronologia](/docs/backend/history/) ottengono la riga così come memorizzata, quindi un valore mascherato qui non è mai ciò che viene registrato da un audit o riscritto da un ripristino. Anche la cronologia *serve* le sue voci tramite `afterRead`, quindi uno snapshot mostra il valore mascherato nello stesso modo della riga.

Le righe incorporate nella risposta di un'altra tabella — un `include`, i valori del riferimento di una relazione, le righe trasportate da un frame realtime per una relazione — vengono mascherate a un livello di profondità con l'`afterRead` della tabella di **destinazione**. L'ordine è: globale, poi tabella, poi `.transform({ afterRead })` della colonna. Un servizio realtime privo del driver per eseguire gli hook rifiuta i frame per una tabella che li possiede, piuttosto che inviarli non mascherati.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const customers = defineTable("customers", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        name:  col.text().notNull(),
        email: col.text().notNull(),
        phone: col.text(),
    },
    rls: [{ operation: "select", roles: ["support", "sales"] }],
    hooks: {
        // Mask contact details for everyone but support.
        afterRead: ({ values, context }) => {
            if (context.user?.roles?.includes("support")) return values;
            return {
                ...values,
                email: values.email.replace(/^(.).*(@.*)$/, "$1***$2"),
                phone: values.phone === null ? null : "•••",
            };
        },
    },
});
```

Un'aggregazione restituisce somme e conteggi, non righe, quindi non può passare attraverso `afterRead`. Su una tabella che ne possiede uno, viene servito solo `count()` senza `groupBy`; qualsiasi altra [aggregazione](/docs/sdk/aggregates-and-search/#aggregates) viene rifiutata con `400 AGGREGATE_MASKED_BY_AFTER_READ`.

Un valore che un chiamante non deve mai ricevere è meglio che venga escluso del tutto anziché mascherato: [`.access()` o `.private()`](/docs/collections/field-access/) rimuovono la colonna prima dell'esecuzione di qualsiasi hook e la tengono fuori anche dai filtri.

## `beforeDelete` e `afterDelete`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Entrambi ricevono come `values` la riga in fase di eliminazione e il suo `id`.

`beforeDelete` viene eseguito all'interno della transazione dell'eliminazione. Lancia un errore per rifiutare l'eliminazione e il chiamante riceverà `400 CALLBACK_REJECTED` con il tuo messaggio. Anche restituire `false` la rifiuta, con `403 CALLBACK_REJECTED` senza alcun messaggio personalizzato.

`afterDelete` viene eseguito dopo che la riga è stata eliminata e prima del commit. Un'eccezione lanciata esegue il rollback dell'eliminazione. Su una tabella con [soft delete](/docs/collections/soft-delete/), un'eliminazione corrisponde all'applicazione di un contrassegno, ed entrambi gli hook vengono comunque eseguiti.

## Hook di campo: `.transform()`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il metodo `.transform()` di una colonna accetta due hook a livello di campo: `beforeSave` restituisce il valore da memorizzare e `afterRead` restituisce il valore da servire. Vengono eseguiti sul server per qualsiasi chiamante e ricevono `value`, l'intera riga come `values`, e le proprietà ricevute da ogni hook.

`value` è tipizzato fedelmente: `T | null` su una colonna nullable, e `T` quando `.notNull()` viene specificato **prima** di `.transform()`. Su un campo JSON è `T | undefined`, a meno che non sia preceduto da `.required()`.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const contacts = defineTable("contacts", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().transform({
            beforeSave: ({ value }) => value.trim().toLowerCase(),
        }),
        iban: col.text().transform({
            afterRead: ({ value, context }) =>
                value && !context.user?.roles?.includes("finance") ? `•••• ${value.slice(-4)}` : value,
        }),
    },
    rls: "admin-only",
});
```

`.transform()` è disponibile anche sugli elementi degli array e su ciascun campo di un [documento JSON](/docs/schema/json/). Per la rimozione degli spazi bianchi e la gestione di maiuscole/minuscole, le [regole di convalida](/docs/schema/columns/#validation) `trim`, `lowercase` e `uppercase` non richiedono codice.

## Scrivere su altre tabelle

<span class="since-badge" data-since="0.31">Da 0.31</span>

`context.data` legge e scrive su qualsiasi tabella tramite il suo slug, agendo con l'identità del chiamante e nella stessa transazione della scrittura che ha attivato l'hook:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const submissions = defineTable("job_submissions", {
    columns: {
        id:            col.uuid().primaryKey().defaultRandom(),
        title:         col.text().notNull(),
        status:        col.enum(["pending", "approved", "rejected"]).notNull().default("pending"),
        promotedJobId: col.uuid(),
    },
    rls: "admin-only",
    hooks: {
        afterSave: async ({ id, values, previousValues, context }) => {
            // When a submission is approved, publish it as a job and link it back.
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const job = await context.data.jobs.create({ title: values.title, status: "published" });
                await context.data.job_submissions.update(id, { promotedJobId: job.id });
            }
        },
    },
});
```

L'aggiornamento riportato sopra salva nuovamente `job_submissions`, provocando una nuova esecuzione di questo hook; è il controllo sullo stato a interrompere il ciclo. [L'API `context.data`](/docs/collections/context-data-api/) approfondisce i privilegi con cui viene eseguito, la transazione e i limiti di nidificazione.

## Hook per tutte le tabelle

<span class="since-badge" data-since="0.31">Da 0.31</span>

Gli hook validi per tutte le tabelle — mascheramento di dati personali (PII) nell'intero schema, un log di audit globale — vengono esportati come `hooks` da `backend/hooks.ts`, con la medesima struttura `TableHooks`. Vengono eseguiti prima degli hook specifici di ciascuna tabella, i quali vengono eseguiti a loro volta prima del `.transform()` delle relative colonne. Consulta [Hook globali](/docs/backend/hooks/).

Gli hook possono anche essere collegati dopo l'avvio tramite `setTableHooks(slug, hooks)` sul backend. Questa operazione **sostituisce** gli hook dichiarati dalla tabella; per aggiungerne altri a quelli esistenti, usa `composeTableHooks(declared, yours)`.

## Combinare set di hook

<span class="since-badge" data-since="0.31">Da 0.31</span>

Una tabella ha un solo oggetto `hooks`. Quando diverse funzionalità richiedono ciascuna un hook — un generatore di slug, una traccia di audit, un filtro per tenant — scrivi ciascuna di esse come set a sé stante e combinale con `composeTableHooks` da `@rebasepro/common`:

```ts
import { defineTable, col, type TableHooks } from "@rebasepro/server/schema";
import { composeTableHooks } from "@rebasepro/common";

const auditTrail: TableHooks = {
    afterSave: async ({ table, id, status, context }) => {
        await context.data.audit_log.create({ table: table.slug, rowId: String(id), action: status });
    },
};

export const pages = defineTable("pages", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        slug:  col.text(),
    },
    rls: "admin-only",
    hooks: composeTableHooks(auditTrail, {
        beforeSave: ({ values }) =>
            typeof values.title === "string" && !values.slug
                ? { ...values, slug: values.title.toLowerCase().replace(/\s+/g, "-") }
                : values,
    }),
});
```

I set vengono eseguiti nell'ordine specificato e ogni hook si combina nello stesso modo in cui il backend combina i propri livelli globale e di tabella:

| Hook | Comportamento combinato |
|---|---|
| `beforeSave` | Concatenato: ogni set vede i valori restituiti dal precedente, uniti superficialmente (shallow merge) a quanto ricevuto in input |
| `afterRead` | Concatenato: ogni set riceve la riga restituita dal precedente |
| `beforeQuery` | In AND: ogni set vede la query del chiamante e una riga deve superare ogni restrizione |
| `beforeDelete` | Qualsiasi `false` pone il veto sull'eliminazione; ogni set viene comunque eseguito |
| `afterSave`, `afterDelete` | Eseguiti in ordine, ciascuno atteso con await; un'eccezione lanciata interrompe i successivi |
| `afterSaveError` | Eseguiti in ordine; un'eccezione lanciata non interrompe il set successivo e il primo errore viene rilanciato al termine |

Un hook è presente nel risultato solo se è definito in almeno un set, mentre un set `undefined` viene ignorato. Un set scritto separatamente dalla propria tabella, come `auditTrail` qui sopra, è tipizzato con la riga generica, pertanto leggi i suoi valori come `unknown` e verificali.

## Testare un hook

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un hook è una semplice funzione con un singolo oggetto di proprietà, quindi un unit test può chiamarlo direttamente: `posts.config.hooks?.beforeSave?.(props)`. `createCallContext` da `@rebasepro/server` crea la proprietà `context` solo con i campi passati dal test; qualsiasi altro campo lancerà un'eccezione al primo utilizzo, indicando il proprio nome. `table` è il descrittore restituito per la tabella da `compileTables` di `@rebasepro/common`. Per eseguire gli hook a fronte di un database reale, consulta [Script e Console](/docs/backend/scripts/).

## Passaggi successivi

<span class="since-badge" data-since="0.31">Da 0.31</span>

- [L'API `context.data`](/docs/collections/context-data-api/): privilegi, transazioni e la connessione trattenuta da un hook
- [Hook globali](/docs/backend/hooks/): hook validi su tutte le tabelle
- [Cronologia entità](/docs/backend/history/): una traccia di audit senza scrivere hook
