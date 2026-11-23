---
sourceHash: 1487ed768dd198b7
title: Hook di tabella
sidebar_label: Hook di tabella
description: "Esegui codice lato server in ogni fase del ciclo di vita di una tabella con gli hook: restringi le letture, maschera campi, convalida e completa le scritture, reagisci a salvataggi ed eliminazioni e trasforma singole colonne."
---

Gli `hooks` di una tabella vengono eseguiti sul server in ogni fase della vita di una riga: prima di una
lettura, su ogni riga che lascia il server, prima e dopo una scrittura, e prima e
dopo un'eliminazione. Vengono eseguiti per qualsiasi punto di ingresso alla tabella — REST, l'SDK,
realtime, MCP e codice server tramite `rebase.data` — e il loro codice non lascia
mai il server, quindi una chiave API o una lettura di `process.env` all'interno di un hook è sicura.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        title:  col.text().notNull(),
        slug:   col.text().notNull().unique().serverDefault(),
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

Le prop sono tipizzate in base alle colonne della tabella: `values.title` sopra è una
`string`, e `values.status` è `"draft" | "published"`.

`.serverDefault()` su `slug` indica ciò che fa l'hook, dato che il suo codice non può
essere letto: un'operazione di creazione può omettere la colonna, il tipo di inserimento dell'SDK la rende
opzionale e il form del pannello consente di creare un record senza di essa.

:::note[Provieni dalle collection?]
Gli hook di tabella sono i `callbacks` server di una collection, con lo stesso
ciclo di vita. Ogni hook riceve il descrittore della tabella come `table`, e `afterRead`
e gli hook di eliminazione ricevono la riga come `values`. La guida all'aggiornamento per questa
versione elenca le ridenominazioni.
:::

## I sette hook

| Hook | Esecuzione | Valore restituito |
|---|---|---|
| `beforeQuery` | prima che ogni lettura venga compilata | un filtro da concatenare con AND alla lettura, oppure niente |
| `afterRead` | su ogni riga che lascia il server | la riga da servire |
| `beforeSave` | prima di una creazione o di un aggiornamento, all'interno della relativa transazione | i valori da scrivere; lancia un errore per rifiutare |
| `afterSave` | dopo la scrittura, prima del commit | niente; lancia un errore per eseguire il rollback della scrittura |
| `afterSaveError` | dopo che una scrittura è fallita ed è stato eseguito il rollback | niente |
| `beforeDelete` | prima di un'eliminazione, all'interno della relativa transazione | `false` o lancia un errore per rifiutare |
| `afterDelete` | dopo l'eliminazione, prima del commit | niente; lancia un errore per eseguire il rollback dell'eliminazione |

Ogni hook può essere `async`. Ogni hook riceve:

| Prop | Che cos'è |
|---|---|
| `table` | La tabella così come la conosce il server: il suo descrittore, con colonne, relazioni e la configurazione `rls`. |
| `path` | Il percorso a cui la richiesta era indirizzata: lo slug o un percorso nidificato. |
| `context` | Il chiamante (`context.user`) e `context.data` con ambito limitato ad esso. Consulta [L'API `context.data`](/docs/collections/context-data-api/). |

C'è un writer che non li esegue: **il sistema di autenticazione**. La registrazione, l'accesso OAuth
e la gestione utenti da parte di un amministratore scrivono direttamente sulla tabella degli utenti. Consulta
[La tabella users](/docs/schema/auth-table/#what-does-not-run-for-auth-writes).

Una tabella scritta dal CMS direttamente nel browser, senza alcun server Rebase nel
percorso della richiesta, non raggiunge mai questi hook. Il CMS dispone di hook lato browser
dedicati per questo caso, descritti insieme alle personalizzazioni del CMS.

## `beforeQuery`

Viene eseguito **prima che una lettura venga compilata**, per restringere le righe richieste. Restituisce
condizioni da concatenare con AND nella query; non restituire nulla per non aggiungerne alcuna.

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

- **Può solo restringere.** `filter` accetta gli stessi filtri di campo di una query;
  `logical` accetta un gruppo `or`/`and` per un ambito come "i miei, o condivisi con
  me", comunque concatenato tramite AND nel suo complesso.
- **Viene eseguito su ogni percorso di lettura**: l'elenco, un singolo get, il count,
  l'aggregazione, la ricerca, la lettura vettoriale, un elenco di percorsi nidificati, il refetch realtime
  alla base di un `.listen()`, e le righe caricate per una relazione o un
  `?include=`, dove è l'hook della tabella di **destinazione** ad essere applicato.
- **Un filtro che non può essere compilato rifiuta la richiesta.** Indicare una colonna che la tabella
  non possiede produce un 400, mai una condizione ignorata.
- **Una scrittura su una riga da esso esclusa è un 404.** Un aggiornamento o un'eliminazione indirizzati a
  una riga al di fuori dell'ambito vengono rifiutati prima della scrittura. Il rifiuto di una scrittura in base al suo
  contenuto spetta a `beforeSave`.

Il controllo di univocità alla base di `.unique()` non viene ristretto: se ristretto,
risponderebbe "univoco" per un valore che una riga nascosta possiede già.

La Row-Level Security (sicurezza a livello di riga) è il modello di autorizzazione; `beforeQuery` è logica
applicativa al di sopra di essa. Usa [`rls`](/docs/collections/security-rules/) per qualsiasi cosa
che debba valere anche per l'SQL eseguito come chiamante.

## `beforeSave`

Viene eseguito prima della scrittura di una riga e restituisce i valori da scrivere. `values` contiene
tutti i valori in fase di creazione e quelli modificati in fase di aggiornamento; `previousValues` è
la riga così com'era, in fase di aggiornamento; `status` è `"new"`, `"existing"` o `"copy"`;
`id` è assente in una creazione la cui chiave viene generata dal database.

Viene eseguito all'interno della transazione di scrittura, quindi trattiene una connessione del pool per
tutta la durata della sua esecuzione. Consulta [Un hook trattiene una connessione](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Lancia un errore per **rifiutare la scrittura**. Nulla raggiungerà il database e il chiamante
riceverà **400** con il tuo messaggio e il codice `CALLBACK_REJECTED`:

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

Per scegliere lo status e il codice — un 409 per un conflitto, un 422 per un valore
ben formato ma inaccettabile — lancia un `RebaseApiError`:

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

Importa `RebaseApiError` da `@rebasepro/types`: i file di schema non caricano codice
server, ed è la stessa classe lanciata dall'SDK tipizzato.

## `afterSave` e `afterSaveError`

`afterSave` viene eseguito dopo che la riga è stata scritta e prima del commit, nella stessa
transazione. I suoi `values` corrispondono alla riga così come memorizzata. Il lancio di un errore annulla (rollback) il salvataggio,
insieme a tutto ciò che l'hook ha scritto tramite `context.data`:

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

Il lavoro che esce dal database — un'e-mail, un webhook — non appartiene al
corpo dell'hook: mantiene aperta la transazione per un round trip di rete e nulla
può revocarlo se la scrittura fallisce ed esegue il rollback. Accoda invece un [job](/docs/backend/jobs/);
un job accodato da un hook viene confermato (commit) insieme alla scrittura.

`afterSaveError` viene eseguito quando un salvataggio non è andato a buon fine a livello di database o successivamente, una volta
che è stato eseguito il rollback della transazione di scrittura fallita. Non viene eseguito per un rifiuto
in `beforeSave` o per una richiesta rifiutata prima della scrittura. Il suo `context.data` è una nuova
istanza per lo stesso chiamante, quindi un job da esso accodato sopravvive al fallimento segnalato. Un errore
lanciato al suo interno viene registrato nei log e il chiamante riceve comunque l'errore del salvataggio stesso.

## `afterRead`

Viene eseguito su ogni riga che lascia il server — la risposta di una lettura, la risposta di una scrittura,
un frame realtime, un risultato MCP — e restituisce la riga da servire. `values` è la
riga così come memorizzata, dopo che il [controllo accessi ai campi](/docs/collections/field-access/) ha
rimosso ciò che il chiamante non può leggere.

Modella esclusivamente ciò che un chiamante riceve: `afterSave`, gli hook di eliminazione
e la [cronologia](/docs/backend/history/) ottengono la riga così come memorizzata, quindi un valore
qui mascherato non è mai ciò che un audit registra o che un ripristino riscrive. La cronologia
*serve* le proprie voci anch'essa tramite `afterRead`, quindi uno snapshot mostra il valore
mascherato allo stesso modo della riga.

Le righe incorporate nella risposta di un'altra tabella — un `include`, i valori del riferimento di una relazione,
le righe veicolate da un frame realtime per una relazione — vengono mascherate a un
livello di profondità con l'`afterRead` della tabella di **destinazione**. L'ordine è globale, poi
tabella, poi `.transform({ afterRead })` della colonna. Un servizio realtime privo di un
driver per eseguire gli hook rifiuta i frame per una tabella che li possiede, piuttosto che
inviarli non mascherati.

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

Un'aggregazione restituisce somme e conteggi, non righe, pertanto non può passare attraverso
`afterRead`. Su una tabella che ne definisce uno, viene servito solo `count()` senza `groupBy`;
qualsiasi altra [aggregazione](/docs/sdk/aggregates-and-search/#aggregates) viene rifiutata
con `400 AGGREGATE_MASKED_BY_AFTER_READ`.

Un valore che un chiamante non deve mai ricevere è preferibile escluderlo del tutto piuttosto che mascherarlo:
[`.access()` o `.private()`](/docs/collections/field-access/) rimuovono la colonna
prima dell'esecuzione di qualsiasi hook ed evitano che venga inclusa anche nei filtri.

## `beforeDelete` e `afterDelete`

Entrambi ricevono la riga in fase di eliminazione come `values`, e il suo `id`.

`beforeDelete` viene eseguito all'interno della transazione dell'eliminazione. Lancia un errore per rifiutare l'eliminazione,
e il chiamante riceverà `400 CALLBACK_REJECTED` con il tuo messaggio. Anche restituire `false`
la rifiuta, come `403 CALLBACK_REJECTED` senza alcun messaggio personalizzato.

`afterDelete` viene eseguito dopo l'eliminazione della riga e prima del commit. Il lancio di un errore
annulla l'eliminazione (rollback). Su una tabella con [soft delete](/docs/collections/soft-delete/),
un'eliminazione consiste nell'impostazione di un timestamp, ed entrambi gli hook vengono comunque eseguiti.

## Hook di campo: `.transform()`

Il metodo `.transform()` di una colonna accetta due hook a livello di campo: `beforeSave` restituisce il
valore da memorizzare e `afterRead` restituisce il valore da servire. Vengono eseguiti sul
server, per ogni chiamante, e ricevono `value`, l'intera riga come `values` e
le prop che ogni hook riceve.

`value` è tipizzato fedelmente: `T | null` su una colonna nullable, e `T` quando
`.notNull()` è specificato **prima** di `.transform()`. Su un campo JSON è
`T | undefined` a meno che `.required()` non venga prima.

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

`.transform()` è disponibile anche sugli elementi di un array e su ogni campo di un
[documento JSON](/docs/schema/json/). Per il trimming e il formato del testo, le
[regole di convalida](/docs/schema/columns/#validation) `trim`, `lowercase` e `uppercase`
non richiedono codice.

## Scrittura su altre tabelle

`context.data` legge e scrive qualsiasi tabella tramite il suo slug, agendo come il chiamante e nella
stessa transazione della scrittura che ha eseguito l'hook:

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

L'aggiornamento sopra riportato salva nuovamente `job_submissions`, il che esegue di nuovo questo hook;
il controllo sullo status è ciò che impedisce il ciclo infinito. [L'API `context.data`](/docs/collections/context-data-api/)
descrive i privilegi con cui viene eseguita, la transazione e i limiti di annidamento.

## Hook validi per tutte le tabelle

Gli hook che si applicano a ogni tabella — mascheramento di dati personali (PII) nell'intero schema, un log di audit
globale — vengono esportati come `hooks` da `backend/hooks.ts`, con la medesima
struttura `TableHooks`. Vengono eseguiti prima degli hook propri di ciascuna tabella, i quali a loro volta vengono eseguiti prima del
`.transform()` delle rispettive colonne. Consulta [Hook globali](/docs/backend/hooks/).

Gli hook possono anche essere collegati dopo l'avvio con `setTableHooks(slug, hooks)` nel
backend. Questo **sostituisce** gli hook dichiarati dalla tabella; per aggiungerne altri senza sovrascriverli, passa
`composeTableHooks(declared, yours)`.

## Combinare insiemi di hook

Una tabella possiede un solo oggetto `hooks`. Quando diverse funzionalità richiedono ciascuna un hook — un generatore
di slug, un audit trail, un ambito multi-tenant — scrivi ciascuna come un set separato e
combinali con `composeTableHooks` da `@rebasepro/common`:

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

I set vengono eseguiti nell'ordine specificato, e ogni hook si combina nello stesso modo in cui il backend
combina i livelli globali e di tabella:

| Hook | Modalità combinata |
|---|---|
| `beforeSave` | Concatenati: ogni set vede i valori restituiti dal precedente, uniti in modalità shallow sopra quelli ricevuti inizialmente |
| `afterRead` | Concatenati: ogni set riceve la riga restituita dal precedente |
| `beforeQuery` | Concatenati con AND: ogni set vede la query del chiamante e una riga deve superare ogni restringimento |
| `beforeDelete` | Qualsiasi valore `false` pone il veto sull'eliminazione; ogni set viene comunque eseguito |
| `afterSave`, `afterDelete` | Eseguiti in ordine, ciascuno atteso con await; un errore lanciato blocca i successivi |
| `afterSaveError` | Eseguiti in ordine; un errore lanciato non interrompe il set successivo, e il primo errore viene rilanciato alla fine |

Un hook è presente nel risultato solo se almeno un set lo include, e un set `undefined` viene
ignorato. Un set scritto separatamente dalla propria tabella, come `auditTrail` sopra, è tipizzato
con la riga generica, pertanto leggi i suoi valori come `unknown` e verificali.

## Testare un hook

Un hook è una semplice funzione che accetta un singolo oggetto props, quindi uno unit test può chiamarlo direttamente:
`posts.config.hooks?.beforeSave?.(props)`. `createCallContext` da
`@rebasepro/server` crea la prop `context` includendo solo i campi passati
dal test; qualsiasi altro campo lancerà un errore al primo utilizzo, indicando il proprio nome. `table` è il
descrittore restituito da `compileTables` di `@rebasepro/common` per la tabella. Per eseguire
hook su un database reale, consulta [Script e Console](/docs/backend/scripts/).

## Passaggi successivi

- [L'API `context.data`](/docs/collections/context-data-api/): privilegi, transazioni e la connessione trattenuta da un hook
- [Hook globali](/docs/backend/hooks/): hook validi per tutte le tabelle
- [Cronologia entità](/docs/backend/history/): un audit trail senza dover scrivere hook
