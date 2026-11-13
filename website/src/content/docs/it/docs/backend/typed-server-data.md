---
sourceHash: d08c6bb1dfd3357e
title: Dati server-side tipizzati
sidebar_label: Dati server-side tipizzati
description: "Registra il tipo Database generato una sola volta, e context.data, rebase.dataAsAdmin e l'istanza di rebase ricevuta da una funzione o un cron saranno tipizzati a partire da esso: righe, filtri, ordinamenti, include e input di scrittura."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

Il client browser viene tipizzato passando il tuo `Database` generato a
`createRebaseClient<Database>()` (vedi [Generazione SDK tipizzato](/docs/sdk#typed-sdk-generation)).
Le superfici dei dati lato server non prevedono una chiamata di questo tipo a cui passarlo:

- `context.data` in un [hook di tabella](/docs/collections/callbacks),
- `rebase.dataAsAdmin` sul singleton `rebase`,
- l'istanza di `rebase` passata a una [funzione personalizzata](/docs/backend/custom-functions) o a un
  [cron job](/docs/backend/cron-jobs).

Pertanto, indichi a TypeScript una sola volta, per l'intero progetto, quale `Database` gestiscono.
Finché non lo fai, rimangono non tipizzati: qualsiasi tabella con qualsiasi nome, righe come
`Record<string, unknown>`. Non cambia nulla per un progetto che non registra alcunché.

Esistono due modi per effettuare la registrazione: il `Database` generato, che è esatto, o
il tuo modulo `backend/schema` stesso, che non richiede alcuna esecuzione di codegen.

## Registrare il `Database` generato

<span class="since-badge" data-since="0.31">Since 0.31</span>

```bash
rebase generate-sdk --register
```

Oltre all'SDK in `generated/sdk/`, questo scrive due file in
`backend/generated/`: una copia di `database.types.ts` e un file `register.ts` che
dichiara la registrazione:

```ts
import type { Database } from "./database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
```

Risiedono in `backend/` perché è il programma in cui vengono compilati gli hook, le funzioni e i
cron che tipizzano, e i tipi vengono copiati accanto alla
registrazione anziché importati da `generated/sdk/`, che si trova al di fuori della
`rootDir` del backend. Si tratta solo di una dichiarazione: il runtime si comporta esattamente come
prima. `--register` si rifiuta di sovrascrivere un `register.ts` che non è stato
scritto da esso.

Il flag viene memorizzato in `rebase.json`, come `"registerDatabase": true` sull'app
backend, in modo che ogni successivo `rebase generate-sdk`, e `rebase dev` a ogni
modifica sotto `backend/schema/`, mantenga entrambi i file aggiornati. Il `.gitignore`
dello scaffold ignora le directory `generated/`, quindi un clone pulito non contiene nessuno dei
due file finché qualcosa non li scrive nuovamente. `rebase build` (e
`rebase cloud deploy`, che crea lo stesso bundle) li genera dalle
tabelle prima della compilazione, quindi un job di CI che esegue `rebase build` su un clone
pulito compilerà gli hook tipizzati. Un passaggio di CI che compila il backend in un altro modo
(`tsc`, `pnpm build`) richiede comunque prima `rebase generate-sdk`, altrimenti gli hook che
leggono righe tipizzate compileranno contro il `context.data` non tipizzato fallendo. Un progetto
senza `rebase.json` continua la registrazione finché
`backend/generated/register.ts` è presente. Per tornare ai dati lato server
non tipizzati, rimuovi `registerDatabase` ed elimina `backend/generated/`.

## Registrare lo schema, senza codegen

<span class="since-badge" data-since="0.31">Since 0.31</span>

Un progetto che non ha generato nulla registra invece il proprio modulo schema,
e viene tipizzato direttamente dai suoi `defineTable`:

```ts
// backend/rebase-env.d.ts
declare module "@rebasepro/types" {
    interface Register {
        tables: typeof import("./schema");
    }
}
```

Ogni export del modulo che è una tabella o una vista viene tipizzato sotto il rispettivo
funzione di accesso (`orderItems` per `order_items`), con i tipi `Row`, `Insert` e `Update`
che il generatore emetterebbe — esatti per ogni colonna dichiarata. È più flessibile sulle
relazioni, perché la destinazione di una relazione si trova dietro un thunk non tipizzato: una chiave
esterna derivata è `string | number`, una riga inclusa è `Record<string, unknown>`,
e un `include` nidificato non è controllato. Il `Database` generato è esatto per tutti
questi casi, e ha la precedenza quando entrambi sono registrati. [Tipi
inferiti](/docs/schema/types/) descrive cosa `DatabaseOf` può e non può dedurre.

Un'unica superficie viene tipizzata solo a partire dal `Database` generato: `context.data` all'interno
degli hook di tabella di quello stesso schema, poiché tipizzare gli hook di uno schema a partire dallo
schema stesso costituirebbe una dipendenza circolare rifiutata da TypeScript.

## Cosa tipizza

<span class="since-badge" data-since="0.31">Since 0.31</span>

```ts
// backend/schema/orders.ts — a hook
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        total: col.numeric().notNull(),
    },
    rls: "admin-only",
    hooks: {
        async beforeSave({ context, values }) {
            const { data } = await context.data.customers.find({
                where: { email: ["==", "ada@example.com"] },  // `email` is a column of customers
            });
            data[0]?.email;                      // completes from the customers Row
            return values;
        },
    },
});
```

Con il `Database` generato registrato, `context.data.customer` (tabella inesistente)
in quell'hook genererà un errore di tipo.

```ts
// backend/functions/stats.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/", async (c) => {
        const { data } = await rebase.dataAsAdmin.orders.find({
            where: { status: ["==", "paid"] },   // `status` and its values are checked
        });
        return c.json({ paid: data.length });
    });
});
```

```ts
// backend/crons/cleanup.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    name: "Cleanup",
    schedule: "0 3 * * *",
    async handler({ rebase }) {
        // `create` takes the table's Insert type: required columns are required.
        await rebase.dataAsAdmin.auditLog.create({ action: "cleanup" });
    },
});
```

Ogni funzione di accesso (accessor) è tipizzata allo stesso modo di quella del client browser: `find`, `findById`
e `listen` restituiscono il tipo `Row` della tabella; `where` e `orderBy` sono
indicizzati tramite le sue colonne; `include` definisce le sue relazioni; `create` accetta il suo
`Insert` e `update` il suo `Update`. Gli accessor sono i nomi in camelCase del
file generato (`order_items` è `orderItems`).
Il server risolve tali nomi attraverso le tabelle servite, quindi una tabella il cui
slug è `my-notes` (memorizzata in una tabella `notes`) diventa `context.data.myNotes`.

`table(slug)` con uno slug dichiarato nel `Database` è tipizzato allo stesso modo:
`context.data.table("my-notes")` è `context.data.myNotes`. Uno slug calcolato
a runtime, o uno non dichiarato dallo schema, restituisce il
client non tipizzato.

## Una singola funzione, senza la registrazione

Anche `defineFunction` e `defineCron` accettano il tipo come argomento, che prevale
sulla registrazione. Usalo per tipizzare un singolo file, o per provare i dati tipizzati prima
di effettuare la registrazione:

```ts
import type { Database } from "../../generated/sdk/database.types";

export default defineFunction<Database>((app, { rebase }) => {
    // rebase.dataAsAdmin is typed from Database here
});
```

## Helper che accettano l'oggetto dati

Un helper che riceve `context.data` o `rebase.dataAsAdmin` specifica il
tipo registrato, così rimane tipizzato e accetta entrambi:

```ts
import type { RebaseSdkData, RegisteredDatabase } from "@rebasepro/types";

export async function paidOrders(data: RebaseSdkData<RegisteredDatabase>) {
    return data.orders.find({ where: { status: ["==", "paid"] } });
}
```

Un helper dichiarato con un semplice `RebaseSdkData` mantiene il tipo non tipizzato, e un
oggetto dati tipizzato non sarà assegnabile ad esso. Modifica il parametro come mostrato sopra quando
effettui la registrazione.
