---
sourceHash: c098315f51933896
title: Dati lato server tipizzati
sidebar_label: Dati lato server tipizzati
description: "Registra una volta il tuo tipo Database generato, e context.data, rebase.dataAsAdmin e il rebase che una function o un cron riceve sono tipizzati a partire da esso: righe, filtri, ordinamenti, include e input di scrittura."
---

Il client del browser è tipizzato passando il tuo `Database` generato a
`createRebaseClient<Database>()` (vedi [Generazione dell'SDK tipizzato](/docs/sdk#typed-sdk-generation)).
Le superfici dati lato server non hanno una chiamata simile a cui passarlo:

- `context.data` in una [callback di collection](/docs/collections/callbacks),
- `rebase.dataAsAdmin` sul singleton `rebase`,
- il `rebase` che riceve una [function personalizzata](/docs/backend/custom-functions) o un
  [cron job](/docs/backend/cron-jobs).

Quindi dici a TypeScript una sola volta, per l'intero progetto, quale `Database` servono.
Finché non lo fai, restano non tipizzate: qualsiasi collection con qualsiasi nome, righe come
`Record<string, unknown>`. Nulla cambia per un progetto che non registra nulla.

## Registrare il `Database`

<span class="since-badge" data-since="0.25">Da 0.25</span>

```bash
rebase generate-sdk --register
```

Oltre all'SDK in `generated/sdk/`, questo scrive due file in
`config/generated/`: una copia di `database.types.ts`, e un `register.ts` che
dichiara la registrazione:

```ts
import type { Database } from "./database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
```

Stanno in `config/` perché i file delle tue collection vengono compilati due volte, dal
backend (il cui `tsconfig.json` include `../config/`) e dal `tsc` del pacchetto
`config` stesso, e `config/` è l'unica directory che entrambi leggono. Una
registrazione lì che importasse `../generated/sdk/` porterebbe un file da
fuori `config/` nella compilazione di quel pacchetto, cosa che TypeScript rifiuta. Quindi una sola
registrazione tipizza le tue function, i tuoi cron job e le callback nei file
delle collection, in entrambe le compilazioni. È solo una dichiarazione: il runtime fa
esattamente ciò che faceva prima.

Il flag viene ricordato in `rebase.json`, come `"registerDatabase": true` sull'app
backend, così ogni `rebase generate-sdk` successivo, e `rebase dev` a ogni
modifica di collection, mantiene aggiornati entrambi i file. Questo vale anche su un clone nuovo e in
CI: il `.gitignore` dello scaffold ignora le directory `generated/`, e il
primo `rebase generate-sdk` o `rebase dev` le scrive di nuovo. Un progetto senza
`rebase.json` continua a registrare finché `config/generated/register.ts`
è presente. Per tornare ai dati lato server non tipizzati, rimuovi `registerDatabase` ed
elimina `config/generated/`.

Puoi anche scrivere tu stesso la registrazione, in qualsiasi file compilato dal backend
(`backend/src/rebase-env.d.ts`, importando `../../generated/sdk/database.types`).
Raggiunge allora solo la compilazione del backend: nel `tsc` del pacchetto `config`,
`context.data` resta l'oggetto non tipizzato, quindi le callback devono compilare in entrambi i modi.

## Cosa tipizza

```ts
// config/collections/orders.ts — a callback
callbacks: {
    async beforeSave({ context, values }) {
        const { data } = await context.data.customers.find({
            where: { email: ["==", "ada@example.com"] },  // `email` is a column of customers
        });
        data[0]?.email;                      // completes from the customers Row

        await context.data.customer.find();  // error: no collection `customer`
        return values;
    }
}
```

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
        // `create` takes the collection's Insert type: required columns are required.
        await rebase.dataAsAdmin.auditLog.create({ action: "cleanup" });
    },
});
```

Ogni accessor è tipizzato come quello del client del browser: `find`, `findById`
e `listen` restituiscono il `Row` della collection; `where` e `orderBy` sono
indicizzati dalle sue colonne; `include` nomina le sue relazioni; `create` accetta il suo
`Insert` e `update` il suo `Update`. Gli accessor sono i nomi in camelCase dal
file generato (`order_items` è `orderItems`).
Il server risolve quei nomi attraverso le collection registrate, quindi una collection
`my-notes` archiviata in una tabella `notes` è `context.data.myNotes`.

`collection(slug)` con uno slug che il `Database` dichiara è tipizzato allo stesso modo:
`context.data.collection("my-notes")` è `context.data.myNotes`. Uno slug che
calcoli a runtime, o uno che lo schema non dichiara, ottiene il client non
tipizzato.

## Una function, senza la registrazione

`defineFunction` e `defineCron` accettano anche il tipo come argomento, che prevale
sulla registrazione. Usalo per tipizzare un singolo file, o per provare i dati tipizzati prima di
registrare:

```ts
import type { Database } from "../../generated/sdk/database.types";

export default defineFunction<Database>((app, { rebase }) => {
    // rebase.dataAsAdmin is typed from Database here
});
```

## Helper che accettano l'oggetto dati

Un helper che riceve `context.data` o `rebase.dataAsAdmin` nomina il tipo
registrato, così resta tipizzato e accetta entrambi:

```ts
import type { RebaseSdkData, RegisteredDatabase } from "@rebasepro/types";

export async function paidOrders(data: RebaseSdkData<RegisteredDatabase>) {
    return data.orders.find({ where: { status: ["==", "paid"] } });
}
```

Un helper dichiarato con un semplice `RebaseSdkData` mantiene il tipo non tipizzato, e un
oggetto dati tipizzato non gli è assegnabile. Cambia il parametro come sopra quando
registri.
