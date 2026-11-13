---
sourceHash: d08c6bb1dfd3357e
title: Typisierte serverseitige Daten
sidebar_label: Typisierte serverseitige Daten
description: "Registrieren Sie Ihren generierten Database-Typ einmalig, und context.data, rebase.dataAsAdmin sowie das rebase, das eine Funktion oder ein Cron erhält, werden davon typisiert: Zeilen, Filter, Sortierungen, Includes und Schreib-Inputs."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Der Browser-Client wird typisiert, indem Sie Ihre generierte `Database` an
`createRebaseClient<Database>()` übergeben (siehe [Generierung des typisierten SDKs](/docs/sdk#typed-sdk-generation)).
Die serverseitigen Datenoberflächen besitzen keinen solchen Aufruf, an den sie übergeben werden könnte:

- `context.data` in einem [Table-Hook](/docs/collections/callbacks),
- `rebase.dataAsAdmin` auf dem `rebase`-Singleton,
- das `rebase`, das einer [benutzerdefinierten Funktion](/docs/backend/custom-functions) oder einem
  [Cron-Job](/docs/backend/cron-jobs) übergeben wird.

Daher teilen Sie TypeScript einmalig für das gesamte Projekt mit, welche `Database` bereitgestellt wird.
Bis Sie das tun, bleiben sie untypisiert: jede Tabelle unter beliebigem Namen, Zeilen als
`Record<string, unknown>`. Für ein Projekt, das nichts registriert, ändert sich nichts.

Es gibt zwei Möglichkeiten der Registrierung: über die generierte `Database`, was exakt ist, oder
über Ihr `backend/schema`-Modul selbst, was keinen Codegen-Lauf erfordert.

## Die generierte `Database` registrieren

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```bash
rebase generate-sdk --register
```

Neben dem SDK in `generated/sdk/` schreibt dies zwei Dateien nach
`backend/generated/`: eine Kopie von `database.types.ts` und eine `register.ts`,
die die Registrierung deklariert:

```ts
import type { Database } from "./database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
```

Sie befinden sich in `backend/`, da dies das Programm ist, in dem die Hooks, Funktionen und
Crons, die sie typisieren, kompiliert werden, und die Typen werden neben der
Registrierung hineinkopiert, anstatt aus `generated/sdk/` importiert zu werden, welches außerhalb des
`rootDir` des Backends liegt. Es ist lediglich eine Deklaration: die Laufzeit verhält sich exakt so
wie zuvor. `--register` weigert sich, eine `register.ts` zu überschreiben, die es nicht selbst
erstellt hat.

Das Flag wird in `rebase.json` als `"registerDatabase": true` in der
Backend-App gespeichert, sodass jedes spätere `rebase generate-sdk` und `rebase dev` bei jeder
Änderung unter `backend/schema/` beide Dateien aktuell hält. Die `.gitignore` des Scaffolds
ignoriert `generated/`-Verzeichnisse, sodass ein frischer Clone keine der beiden
Dateien enthält, bis sie erneut geschrieben werden. `rebase build` (und
`rebase cloud deploy`, welches dasselbe Bundle erstellt) generiert sie aus den
Tabellen, bevor es kompiliert, sodass ein CI-Job, der `rebase build` auf einem frischen
Clone ausführt, typisierte Hooks kompiliert. Ein CI-Schritt, der das Backend auf andere Weise kompiliert
(`tsc`, `pnpm build`), benötigt weiterhin zuerst `rebase generate-sdk`, andernfalls kompilieren Hooks,
die typisierte Zeilen lesen, gegen das untypisierte `context.data` und schlagen fehl. Ein Projekt
ohne `rebase.json` bleibt registriert, solange
`backend/generated/register.ts` vorhanden ist. Um zu untypisierten serverseitigen
Daten zurückzukehren, entfernen Sie `registerDatabase` und löschen Sie `backend/generated/`.

## Das Schema ohne Codegen registrieren

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Projekt, das nichts generiert hat, registriert stattdessen sein Schema-Modul
und wird direkt über dessen `defineTable`-Aufrufe typisiert:

```ts
// backend/rebase-env.d.ts
declare module "@rebasepro/types" {
    interface Register {
        tables: typeof import("./schema");
    }
}
```

Jeder Export des Moduls, der eine Tabelle oder eine View ist, wird unter seinem
Accessor typisiert (`orderItems` für `order_items`), mit dem `Row`-, `Insert`- und `Update`-Typ,
den der Generator erzeugen würde – exakt für jede deklarierte Spalte. Bei
Relationen ist es weniger strikt, da das Ziel einer Relation hinter einem untypisierten Thunk liegt:
ein abgeleiteter Fremdschlüssel ist `string | number`, eine inkludierte Zeile ist `Record<string, unknown>`,
und ein geschachteltes `include` ist ungeprüft. Die generierte `Database` ist für all
dies exakt und hat Vorrang, wenn beide registriert sind. [Inferred
types](/docs/schema/types/) beschreibt, was `DatabaseOf` ermitteln kann und was nicht.

Eine Oberfläche wird ausschließlich über die generierte `Database` typisiert: `context.data` innerhalb
der Table-Hooks desselben Schemas, da das Typisieren der Hooks eines Schemas anhand des
Schemas selbst einen Zyklus darstellt, den TypeScript verweigert.

## Was typisiert wird

<span class="since-badge" data-since="0.31">Seit 0.31</span>

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

Wenn die generierte `Database` registriert ist, führt `context.data.customer` (Tabelle existiert nicht)
in diesem Hook zu einem Typfehler.

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

Jeder Accessor ist genauso typisiert wie der des Browser-Clients: `find`, `findById`
und `listen` geben den `Row`-Typ der Tabelle zurück; `where` und `orderBy` basieren
auf ihren Spalten; `include` benennt ihre Relationen; `create` erwartet ihren
`Insert`- und `update` ihren `Update`-Typ. Accessoren sind die camelCase-Namen aus der
generierten Datei (`order_items` wird zu `orderItems`).
Der Server löst diese Namen anhand der bereitgestellten Tabellen auf, sodass eine Tabelle, deren
Slug `my-notes` lautet (gespeichert in einer Tabelle `notes`), als `context.data.myNotes` verfügbar ist.

`table(slug)` mit einem Slug, den die `Database` deklariert, ist auf dieselbe Weise typisiert:
`context.data.table("my-notes")` entspricht `context.data.myNotes`. Ein Slug, den Sie
zur Laufzeit berechnen, oder einer, den das Schema nicht deklariert, erhält den untypisierten
Client.

## Eine einzelne Funktion, ohne Registrierung

`defineFunction` und `defineCron` akzeptieren den Typ auch als Argument, welches Vorrang
vor der Registrierung hat. Verwenden Sie dies, um eine einzelne Datei zu typisieren oder typisierte Daten auszuprobieren,
bevor Sie die Registrierung vornehmen:

```ts
import type { Database } from "../../generated/sdk/database.types";

export default defineFunction<Database>((app, { rebase }) => {
    // rebase.dataAsAdmin is typed from Database here
});
```

## Helper-Funktionen, die das Datenobjekt entgegennehmen

Eine Helper-Funktion, die `context.data` oder `rebase.dataAsAdmin` entgegennimmt, gibt den
registrierten Typ an, sodass sie typisiert bleibt und beides akzeptiert:

```ts
import type { RebaseSdkData, RegisteredDatabase } from "@rebasepro/types";

export async function paidOrders(data: RebaseSdkData<RegisteredDatabase>) {
    return data.orders.find({ where: { status: ["==", "paid"] } });
}
```

Ein Helper, der mit einem einfachen `RebaseSdkData` deklariert ist, behält den untypisierten Typ, und ein
typisiertes Datenobjekt kann ihm nicht zugewiesen werden. Passen Sie den Parameter wie oben gezeigt an,
wenn Sie die Registrierung vornehmen.
