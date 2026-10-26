---
sourceHash: e515564ee1857435
title: Typisierte serverseitige Daten
sidebar_label: Typisierte serverseitige Daten
description: "Registrieren Sie Ihren generierten Database-Typ einmal, und context.data, rebase.dataAsAdmin und das rebase, das eine Funktion oder ein Cron erhält, sind daraus typisiert: Zeilen, Filter, Sortierungen, Includes und Schreib-Eingaben."
---

Der Browser-Client wird typisiert, indem Sie Ihre generierte `Database` an
`createRebaseClient<Database>()` übergeben (siehe [Typisierte SDK-Generierung](/docs/sdk#typed-sdk-generation)).
Die serverseitigen Datenoberflächen haben keinen solchen Aufruf, dem Sie sie übergeben könnten:

- `context.data` in einem [Collection-Callback](/docs/collections/callbacks),
- `rebase.dataAsAdmin` am `rebase`-Singleton,
- das `rebase`, das eine [Custom Function](/docs/backend/custom-functions) oder ein
  [Cron-Job](/docs/backend/cron-jobs) erhält.

Sie sagen TypeScript also einmal für das ganze Projekt, welche `Database` sie bedienen.
Bis dahin bleiben sie untypisiert: jede Collection unter jedem Namen, Zeilen als
`Record<string, unknown>`. Für ein Projekt, das nichts registriert, ändert sich nichts.

## Die `Database` registrieren

```bash
rebase generate-sdk --register
```

Neben dem SDK in `generated/sdk/` schreibt dies zwei Dateien nach
`config/generated/`: eine Kopie von `database.types.ts` und eine `register.ts`, die
die Registrierung deklariert:

```ts
import type { Database } from "./database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
```

Sie liegen in `config/`, weil Ihre Collection-Dateien zweimal kompiliert werden, vom
Backend (dessen `tsconfig.json` `../config/` einschließt) und vom eigenen `tsc` des
`config`-Pakets, und `config/` das eine Verzeichnis ist, das beide lesen. Eine
Registrierung dort, die `../generated/sdk/` importierte, würde eine Datei von
außerhalb von `config/` in die Kompilierung dieses Pakets ziehen, was TypeScript ablehnt. Eine
Registrierung typisiert also Ihre Funktionen, Ihre Cron-Jobs und die Callbacks in Ihren
Collection-Dateien, in beiden Kompilierungen. Sie ist nur eine Deklaration: Die Runtime tut
genau das, was sie zuvor tat.

Das Flag wird in `rebase.json` gemerkt, als `"registerDatabase": true` an der
Backend-App, sodass jedes spätere `rebase generate-sdk` und `rebase dev` bei jeder
Collection-Änderung beide Dateien aktuell hält. Die `.gitignore` des Scaffolds
ignoriert `generated/`-Verzeichnisse, sodass ein frischer Klon keine der beiden Dateien hat,
bis etwas sie erneut schreibt. `rebase build` (und `rebase cloud deploy`, das dasselbe Bundle
baut) schreibt sie aus den Collections, bevor es kompiliert, sodass ein CI-Job, der
`rebase build` auf einem frischen Klon ausführt, typisierte Callbacks kompiliert.
Ein CI-Schritt, der das Backend oder das `config`-Paket auf andere Weise kompiliert
(`tsc`, `pnpm build`), braucht weiterhin zuerst `rebase generate-sdk`, sonst kompilieren
Callbacks, die typisierte Zeilen lesen, gegen das untypisierte `context.data` und scheitern. Ein
Projekt ohne
`rebase.json` registriert weiter, solange `config/generated/register.ts`
vorhanden ist. Um zu untypisierten serverseitigen Daten zurückzukehren, entfernen Sie `registerDatabase` und
löschen Sie `config/generated/`.

Sie können die Registrierung auch selbst schreiben, in jeder Datei, die das Backend kompiliert
(`backend/src/rebase-env.d.ts`, mit Import von `../../generated/sdk/database.types`).
Sie erreicht dann nur die Kompilierung des Backends: Im eigenen `tsc` des `config`-Pakets
bleibt `context.data` das untypisierte Objekt, sodass Callbacks in beiden Fällen kompilieren müssen.

## Was typisiert wird

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

Jeder Accessor ist so typisiert wie der des Browser-Clients: `find`, `findById`
und `listen` geben das `Row` der Collection zurück; `where` und `orderBy` sind
nach ihren Spalten benannt; `include` nennt ihre Relationen; `create` nimmt ihr
`Insert` und `update` ihr `Update`. Accessoren sind die camelCase-Namen aus der
generierten Datei (`order_items` ist `orderItems`).
Der Server löst diese Namen über die registrierten Collections auf, sodass eine
Collection `my-notes`, die in einer Tabelle `notes` gespeichert ist, `context.data.myNotes` ist.

`collection(slug)` mit einem Slug, den die `Database` deklariert, ist genauso typisiert:
`context.data.collection("my-notes")` ist `context.data.myNotes`. Ein Slug, den Sie zur
Laufzeit berechnen, oder einer, den das Schema nicht deklariert, erhält den
untypisierten Client.

## Eine Funktion, ohne die Registrierung

`defineFunction` und `defineCron` nehmen den Typ auch als Argument, das Vorrang vor
der Registrierung hat. Nutzen Sie es, um eine einzelne Datei zu typisieren oder um typisierte Daten auszuprobieren, bevor Sie
registrieren:

```ts
import type { Database } from "../../generated/sdk/database.types";

export default defineFunction<Database>((app, { rebase }) => {
    // rebase.dataAsAdmin is typed from Database here
});
```

## Helfer, die das Datenobjekt annehmen

Ein Helfer, der `context.data` oder `rebase.dataAsAdmin` erhält, nennt den
registrierten Typ, sodass er typisiert bleibt und beides akzeptiert:

```ts
import type { RebaseSdkData, RegisteredDatabase } from "@rebasepro/types";

export async function paidOrders(data: RebaseSdkData<RegisteredDatabase>) {
    return data.orders.find({ where: { status: ["==", "paid"] } });
}
```

Ein Helfer, der mit einem bloßen `RebaseSdkData` deklariert ist, behält den untypisierten Typ, und ein
typisiertes Datenobjekt ist ihm nicht zuweisbar. Ändern Sie den Parameter wie oben, wenn
Sie registrieren.
