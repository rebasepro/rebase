---
sourceHash: 067f45147f37ef16
title: Tabellen-Hooks
sidebar_label: Tabellen-Hooks
description: "Führen Sie serverseitigen Code in jeder Phase des Lebenszyklus einer Tabelle mit Hooks aus: Lesezugriffe einschränken, Felder maskieren, Schreibvorgänge validieren und vervollständigen, auf Speichervorgänge und Löschungen reagieren und einzelne Spalten transformieren."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die `hooks` einer Tabelle laufen auf dem Server bei jedem Schritt im Leben
einer Zeile: vor einem Lesevorgang, bei jeder Zeile, die den Server verlässt,
vor und nach einem Schreibvorgang sowie vor und nach einem Löschvorgang. Sie
werden für jeden Zugang zur Tabelle ausgeführt – REST, das SDK, Realtime,
MCP und Server-Code über `rebase.data` – und ihr Code verlässt niemals den
Server. Daher ist ein API-Schlüssel oder das Auslesen von `process.env` in
einem Hook sicher.

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

Die Props sind anhand der Spalten der Tabelle typisiert: `values.title` oben
ist ein `string`, und `values.status` ist `"draft" | "published"`.

:::note[Kommen Sie von Collections?]
Tabellen-Hooks entsprechen den serverseitigen `callbacks` einer Collection
mit demselben Lebenszyklus. Jeder Hook erhält den Deskriptor der Tabelle als
`table`, und `afterRead` sowie die Delete-Hooks erhalten die Zeile als
`values`. Der Upgrade-Leitfaden für dieses Release listet die Umbenennungen
auf.
:::

## Die sieben Hooks

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Hook | Wann er ausgeführt wird | Rückgabewert |
|---|---|---|
| `beforeQuery` | bevor ein Lesevorgang kompiliert wird | ein Filter, der per AND mit der Leseabfrage verknüpft wird, oder nichts |
| `afterRead` | bei jeder Zeile, die den Server verlässt | die auszuliefernde Zeile |
| `beforeSave` | vor einem Erstellen oder Aktualisieren, innerhalb der Transaktion | die zu schreibenden Werte; einen Fehler werfen (throw), um abzulehnen |
| `afterSave` | nach dem Schreibvorgang, vor dem Commit | nichts; einen Fehler werfen (throw), um den Schreibvorgang zurückzurollen |
| `afterSaveError` | nachdem ein Schreibvorgang fehlgeschlagen ist und zurückgerollt wurde | nichts |
| `beforeDelete` | vor dem Löschen, innerhalb der Transaktion | `false` oder einen Fehler werfen (throw), um abzulehnen |
| `afterDelete` | nach dem Löschen, vor dem Commit | nichts; einen Fehler werfen (throw), um das Löschen zurückzurollen |

Jeder Hook kann `async` sein. Jeder Hook erhält:

| Prop | Bedeutung |
|---|---|
| `table` | Die Tabelle, wie der Server sie kennt: ihr Deskriptor mit Spalten, Relationen und der `rls`-Konfiguration. |
| `path` | Der Pfad, an den die Anfrage adressiert war: der Slug oder ein verschachtelter Pfad. |
| `context` | Der Aufrufer (`context.user`) und der auf ihn beschränkte Datenzugriff `context.data`. Siehe [Die `context.data`-API](/docs/collections/context-data-api/). |

Ein Writer führt sie nicht aus: **das Authentifizierungssystem**. Registrierung,
OAuth-Anmeldung und die Benutzerverwaltung eines Administrators schreiben direkt
in die Users-Tabelle. Siehe [Die Users-Tabelle](/docs/schema/auth-table/#what-does-not-run-for-auth-writes).

Eine Tabelle, die direkt im Browser über das CMS beschrieben wird – ohne Rebase-Server
im Anfragepfad –, erreicht diese Hooks niemals. Das CMS verfügt für diesen Fall
über eigene browserseitige Hooks, die in den CMS-Anpassungen beschrieben sind.

## `beforeQuery`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wird ausgeführt, **bevor ein Lesevorgang kompiliert wird**, um einzugrenzen,
welche Zeilen abgefragt werden. Geben Sie Bedingungen zurück, die per AND mit
der Abfrage verknüpft werden sollen; geben Sie nichts zurück, um keine hinzuzufügen.

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

- **Es kann nur eingrenzen.** `filter` akzeptiert dieselben Feldfilter wie eine
  normale Abfrage; `logical` nimmt eine `or`/`and`-Gruppe für einen Scope wie
  „meine oder mit mir geteilte“, die dennoch als Ganzes per AND verknüpft wird.
- **Wird auf jedem Lesepfad ausgeführt**: beim Listing, bei einem einzelnen Get,
  bei Count, Aggregate, der Suche, dem Vektor-Lesevorgang, einem verschachtelten
  Pfad-Listing, dem Realtime-Refetch hinter einem `.listen()` und den für eine
  Relation oder ein `?include=` geladenen Zeilen, wobei der Hook der **Ziel**tabelle
  greift.
- **Ein Filter, der nicht kompiliert werden kann, lehnt die Anfrage ab.** Das
  Nennen einer Spalte, die die Tabelle nicht hat, resultiert in einem 400-Fehler,
  niemals in einer ignorierten Bedingung.
- **Ein Schreibvorgang auf eine ausgeschlossene Zeile führt zu einem 404.** Eine
  Aktualisierung oder ein Löschvorgang, der an eine Zeile außerhalb des Scopes
  adressiert ist, wird vor dem Schreiben abgelehnt. Das Ablehnen eines
  Schreibvorgangs anhand seines Inhalts ist Aufgabe von `beforeSave`.

Die Eindeutigkeitsprüfung hinter `.unique()` wird nicht eingegrenzt: Eingegrenzt
würde sie für einen Wert, den eine ausgeblendete Zeile bereits enthält, „eindeutig“
melden.

Row-Level Security ist das Autorisierungsmodell; `beforeQuery` ist darauf aufbauende
Anwendungslogik. Verwenden Sie [`rls`](/docs/collections/security-rules/) für alles,
was auch für SQL gelten muss, das als der jeweilige Aufrufer ausgeführt wird.

## `beforeSave`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wird ausgeführt, bevor eine Zeile geschrieben wird, und gibt die zu schreibenden
Werte zurück. `values` enthält jeden Wert bei einer Erstellung und die geänderten
Werte bei einer Aktualisierung; `previousValues` ist die Zeile im vorherigen
Zustand bei einer Aktualisierung; `status` ist `"new"`, `"existing"` oder `"copy"`;
`id` fehlt bei einer Erstellung, deren Schlüssel von der Datenbank generiert wird.

Er wird innerhalb der Transaktion des Schreibvorgangs ausgeführt, belegt also für
seine gesamte Laufzeit eine Verbindung aus dem Verbindungspool. Siehe
[Ein Hook belegt eine Verbindung](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Werfen Sie einen Fehler (throw), um **den Schreibvorgang abzulehnen**. Es gelangt
nichts in die Datenbank, und der Aufrufer erhält **400** mit Ihrer Nachricht
und dem Code `CALLBACK_REJECTED`:

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

Um den Status und Code selbst zu wählen – eine 409 bei einem Konflikt, eine 422
für etwas Wohlgeformtes, aber Inakzeptables –, werfen Sie einen `RebaseApiError`:

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

Importieren Sie `RebaseApiError` aus `@rebasepro/types`: Schema-Dateien laden
keinen Server-Code, und es ist dieselbe Klasse, die auch das typisierte SDK wirft.

## `afterSave` und `afterSaveError`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`afterSave` wird ausgeführt, nachdem die Zeile geschrieben wurde und vor dem
Commit, in derselben Transaktion. Seine `values` entsprechen der Zeile im
gespeicherten Zustand. Ein geworfener Fehler rollt den Speichervorgang zurück,
zusammen mit allem, was der Hook über `context.data` geschrieben hat:

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

Aufgaben, die die Datenbank verlassen – eine E-Mail, ein Webhook –, gehören nicht
in den Hook-Body: Sie halten die Transaktion für einen Netzwerk-Roundtrip offen,
und nichts macht sie rückgängig, wenn der Schreibvorgang zurückgerollt wird.
Reihen Sie stattdessen einen [Job](/docs/backend/jobs/) ein; ein aus einem Hook
eingereihter Job wird zusammen mit dem Schreibvorgang committet.

`afterSaveError` wird ausgeführt, wenn ein Speichervorgang in der Datenbank oder
danach fehlgeschlagen ist, sobald die Transaktion des fehlgeschlagenen Schreibvorgangs
zurückgerollt wurde. Er wird nicht ausgeführt bei einer Ablehnung in `beforeSave`
oder einer Anfrage, die vor dem Schreiben abgelehnt wurde. Sein `context.data` ist
eine neue Instanz für denselben Aufrufer, sodass ein von ihm eingereihter Job
den gemeldeten Fehler übersteht. Ein von ihm geworfener Fehler wird protokolliert,
und der Aufrufer erhält weiterhin den ursprünglichen Fehler des Speichervorgangs.

## `afterRead`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wird für jede Zeile ausgeführt, die den Server verlässt – die Antwort eines
Lesevorgangs, die Antwort eines Schreibvorgangs, ein Realtime-Frame, ein
MCP-Ergebnis – und gibt die auszuliefernde Zeile zurück. `values` ist die Zeile
im gespeicherten Zustand, nachdem der [Feldzugriff](/docs/collections/field-access/)
entfernt hat, was der Aufrufer nicht lesen darf.

Er formt ausschließlich das, was ein Aufrufer empfängt: `afterSave`, die
Delete-Hooks und die [Historie](/docs/backend/history/) erhalten die Zeile im
gespeicherten Zustand. Ein hier maskierter Wert ist also niemals das, was ein
Audit-Log aufzeichnet oder ein Revert zurückschreibt. Die Historie *liefert*
ihre Einträge jedoch ebenfalls über `afterRead` aus, sodass ein Snapshot den
Wert genauso maskiert anzeigt wie die Zeile selbst.

Zeilen, die in der Antwort einer anderen Tabelle eingebettet sind – ein `include`,
Werte einer Relationsreferenz, die Zeilen, die ein Realtime-Frame für eine
Relation transportiert –, werden eine Ebene tief mit dem `afterRead` der
**Ziel**tabelle maskiert. Die Reihenfolge ist: global, dann Tabelle, dann Spalte
`.transform({ afterRead })`. Ein Realtime-Dienst ohne Treiber zum Ausführen der
Hooks lehnt Frames für eine Tabelle, die solche Hooks besitzt, lieber ab, als
sie unmaskiert zu senden.

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

Ein Aggregate liefert Summen und Zählwerte, keine Zeilen, und kann daher
`afterRead` nicht durchlaufen. Bei einer Tabelle mit diesem Hook wird nur
`count()` ohne `groupBy` verarbeitet; jedes andere
[Aggregate](/docs/sdk/aggregates-and-search/#aggregates) wird mit
`400 AGGREGATE_MASKED_BY_AFTER_READ` abgelehnt.

Ein Wert, den ein Aufrufer niemals erhalten darf, wird besser vorenthalten als
maskiert: [`.access()` oder `.private()`](/docs/collections/field-access/) entfernen
die Spalte, bevor ein Hook ausgeführt wird, und halten sie auch aus Filtern heraus.

## `beforeDelete` und `afterDelete`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Beide erhalten die zu löschende Zeile als `values` und deren `id`.

`beforeDelete` wird innerhalb der Transaktion des Löschvorgangs ausgeführt.
Werfen Sie einen Fehler, um das Löschen abzulehnen; der Aufrufer erhält
`400 CALLBACK_REJECTED` mit Ihrer Nachricht. Die Rückgabe von `false` lehnt
es ebenfalls ab, als `403 CALLBACK_REJECTED` ohne eigene Nachricht.

`afterDelete` wird ausgeführt, nachdem die Zeile gelöscht wurde und vor dem
Commit. Ein geworfener Fehler rollt den Löschvorgang zurück. Bei einer Tabelle
mit [Soft Delete](/docs/collections/soft-delete/) ist ein Löschvorgang eine
Kennzeichnung (Stamp), und beide Hooks werden weiterhin ausgeführt.

## Feld-Hooks: `.transform()`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Das `.transform()` einer Spalte akzeptiert zwei Hooks auf Feldebene: `beforeSave`
gibt den zu speichernden Wert zurück, und `afterRead` gibt den auszuliefernden
Wert zurück. Sie laufen auf dem Server für jeden Aufrufer und erhalten `value`,
die gesamte Zeile als `values` sowie die Props, die jeder Hook bekommt.

`value` ist präzise typisiert: `T | null` bei einer Nullable-Spalte und `T`,
wenn `.notNull()` **vor** `.transform()` deklariert ist. Bei einem JSON-Feld
ist es `T | undefined`, es sei denn, `.required()` steht an erster Stelle.

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

`.transform()` ist auch für Array-Elemente und jedes Feld eines
[JSON-Dokuments](/docs/schema/json/) verfügbar. Für Trimming und Groß-/Kleinschreibung
erfordern die [Validierungsregeln](/docs/schema/columns/#validation) `trim`,
`lowercase` und `uppercase` keinen Code.

## Schreiben in andere Tabellen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`context.data` liest und schreibt jede Tabelle über ihren Slug, im Namen des
Aufrufers und in derselben Transaktion wie der Schreibvorgang, der den Hook
ausgelöst hat:

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

Das obige Update speichert `job_submissions` erneut, wodurch dieser Hook erneut
ausgeführt wird; die Statusprüfung verhindert eine Endlosschleife.
[Die `context.data`-API](/docs/collections/context-data-api/) beschreibt die
Berechtigungen, mit denen sie ausgeführt wird, sowie die Transaktions- und
Verschachtelungsgrenzen.

## Hooks für jede Tabelle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Hooks, die für jede Tabelle gelten – PII-Maskierung über das gesamte Schema,
ein globales Audit-Log –, werden als `hooks` aus `backend/hooks.ts` in derselben
`TableHooks`-Struktur exportiert. Sie laufen vor den tabelleneigenen Hooks,
welche wiederum vor dem `.transform()` ihrer Spalten ausgeführt werden. Siehe
[Globale Hooks](/docs/backend/hooks/).

Hooks können nach dem Booten auch mit `setTableHooks(slug, hooks)` auf dem
Backend registriert werden. Dies **ersetzt** die von der Tabelle deklarierten
Hooks; um sie zu ergänzen, übergeben Sie `composeTableHooks(declared, yours)`.

## Hook-Sets kombinieren

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine Tabelle hat ein einzelnes `hooks`-Objekt. Wenn mehrere Anforderungen jeweils
einen Hook benötigen – ein Slug-Generator, ein Audit-Trail, ein Mandanten-Scope –,
schreiben Sie jede Anforderung als eigenes Set und kombinieren Sie diese mit
`composeTableHooks` aus `@rebasepro/common`:

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

Die Sets werden in der angegebenen Reihenfolge ausgeführt, und jeder Hook wird so
kombiniert, wie das Backend seine globalen und tabellenspezifischen Ebenen
zusammenführt:

| Hook | Kombinationsverhalten |
|---|---|
| `beforeSave` | Verkettet: Jedes Set sieht die Werte, die das vorherige zurückgegeben hat, flach über das gemergt, was ihm übergeben wurde |
| `afterRead` | Verkettet: Jedes Set erhält die Zeile, die das vorherige zurückgegeben hat |
| `beforeQuery` | Per AND verknüpft: Jedes Set sieht die Abfrage des Aufrufers, und eine Zeile muss jede Einschränkung erfüllen |
| `beforeDelete` | Jedes `false` legt ein Veto gegen das Löschen ein; jedes Set wird dennoch ausgeführt |
| `afterSave`, `afterDelete` | Werden der Reihe nach ausgeführt und jeweils abgewartet (await); ein geworfener Fehler stoppt die restlichen |
| `afterSaveError` | Werden der Reihe nach ausgeführt; ein geworfener Fehler stoppt das nächste Set nicht, und der erste Fehler wird am Ende erneut geworfen |

Ein Hook ist nur dann im Ergebnis enthalten, wenn mindestens ein Set ihn definiert;
ein `undefined`-Set wird übersprungen. Ein Set, das unabhängig von seiner Tabelle
geschrieben wird (wie `auditTrail` oben), ist mit der generischen Zeile typisiert.
Lesen Sie seine Werte daher als `unknown` aus und prüfen Sie diese.

## Einen Hook testen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Hook ist eine einfache Funktion mit einem einzigen Props-Objekt, sodass ein
Unit-Test ihn direkt aufrufen kann: `posts.config.hooks?.beforeSave?.(props)`.
`createCallContext` aus `@rebasepro/server` baut das `context`-Prop nur mit den
Feldern auf, die der Test übergibt; jedes andere Feld wirft bei der ersten
Verwendung einen Fehler und nennt sich selbst. `table` ist der Deskriptor, den
`compileTables` aus `@rebasepro/common` für die Tabelle zurückgibt. Um Hooks
gegen eine echte Datenbank auszuführen, siehe [Skripte und die Konsole](/docs/backend/scripts/).

## Nächste Schritte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- [Die `context.data`-API](/docs/collections/context-data-api/): Berechtigungen, Transaktionen und die Verbindung, die ein Hook belegt
- [Globale Hooks](/docs/backend/hooks/): Hooks über alle Tabellen hinweg
- [Entitätshistorie](/docs/backend/history/): Ein Audit-Trail ohne das Schreiben von Hooks
