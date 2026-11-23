---
sourceHash: 1487ed768dd198b7
title: Tabellen-Hooks
sidebar_label: Tabellen-Hooks
description: "Führen Sie mit Hooks serverseitigen Code bei jedem Schritt des Lebenszyklus einer Tabelle aus: Lesevorgänge einschränken, Felder maskieren, Schreibvorgänge validieren und vervollständigen, auf Speicher- und Löschvorgänge reagieren und einzelne Spalten transformieren."
---

Die `hooks` einer Tabelle werden auf dem Server bei jedem Schritt im Lebenszyklus einer Zeile ausgeführt: vor einem Lesevorgang, für jede Zeile, die den Server verlässt, vor und nach einem Schreibvorgang sowie vor und nach einem Löschvorgang. Sie werden für jeden Zugang zur Tabelle ausgeführt – REST, das SDK, Realtime, MCP und Server-Code über `rebase.data` – und ihr Code verlässt niemals den Server, sodass ein API-Schlüssel oder das Auslesen von `process.env` in einem Hook sicher ist.

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

Die Props sind anhand der Tabellenspalten typisiert: `values.title` oben ist ein `string`, und `values.status` ist `"draft" | "published"`.

`.serverDefault()` für `slug` gibt an, was der Hook tut, da sein Code nicht gelesen werden kann: Bei einer Erstellung (Create) kann die Spalte weggelassen werden, der Insert-Typ des SDK macht sie optional, und das Formular des Panels erlaubt es, einen Datensatz ohne sie zu erstellen.

:::note[Kommen Sie von Collections?]
Tabellen-Hooks sind die Server-`callbacks` einer Collection mit demselben Lebenszyklus. Jeder Hook erhält den Deskriptor der Tabelle als `table`, und `afterRead` sowie die Lösch-Hooks erhalten die Zeile als `values`. Der Upgrade-Leitfaden für dieses Release listet die Umbenennungen auf.
:::

## Die sieben Hooks

| Hook | Wird ausgeführt | Gibt zurück |
|---|---|---|
| `beforeQuery` | bevor jeder Lesevorgang kompiliert wird | einen Filter, der mit AND in den Lesevorgang verknüpft wird, oder nichts |
| `afterRead` | für jede Zeile, die den Server verlässt | die auszuliefernde Zeile |
| `beforeSave` | vor einem Erstellen oder Aktualisieren, innerhalb der jeweiligen Transaktion | die zu schreibenden Werte; Werfen einer Exception zum Ablehnen |
| `afterSave` | nach dem Schreibvorgang, vor dem Commit | nichts; Werfen einer Exception zum Zurückrollen des Schreibvorgangs |
| `afterSaveError` | nachdem ein Schreibvorgang fehlgeschlagen ist und zurückgerollt wurde | nichts |
| `beforeDelete` | vor einem Löschvorgang, innerhalb dessen Transaktion | `false` oder Werfen einer Exception zum Ablehnen |
| `afterDelete` | nach dem Löschvorgang, vor dem Commit | nichts; Werfen einer Exception zum Zurückrollen des Löschvorgangs |

Jeder Hook kann `async` sein. Jeder Hook empfängt:

| Prop | Bedeutung |
|---|---|
| `table` | Die Tabelle, wie der Server sie kennt: ihr Deskriptor mit Spalten, Relationen und der `rls`-Konfiguration. |
| `path` | Der vom Request adressierte Pfad: der Slug oder ein verschachtelter Pfad. |
| `context` | Der Aufrufer (`context.user`) und der auf ihn beschränkte `context.data`. Siehe [Die `context.data`-API](/docs/collections/context-data-api/). |

Ein Schreiber führt sie nicht aus: **das Authentifizierungssystem**. Registrierung, OAuth-Anmeldung und die Benutzerverwaltung durch Admins schreiben direkt in die Benutzertabelle. Siehe [Die Benutzertabelle](/docs/schema/auth-table/#what-does-not-run-for-auth-writes).

Eine Tabelle, die vom CMS direkt im Browser ohne Rebase-Server im Anfragepfad beschrieben wird, erreicht diese Hooks nie. Das CMS verfügt für diesen Fall über eigene browserseitige Hooks, die bei den CMS-Anpassungen beschrieben sind.

## `beforeQuery`

Wird ausgeführt, **bevor ein Lesevorgang kompiliert wird**, um einzugrenzen, welche Zeilen abgefragt werden. Geben Sie Bedingungen zurück, die per AND mit der Abfrage verknüpft werden sollen; geben Sie nichts zurück, um keine hinzuzufügen.

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

- **Es kann nur eingrenzen.** `filter` akzeptiert dieselben Feldfilter wie eine Abfrage; `logical` akzeptiert eine `or`/`and`-Gruppe für einen Gültigkeitsbereich wie „meine oder mit mir geteilte“, wird aber als Ganzes dennoch per AND verknüpft.
- **Es wird bei jedem Lesepfad ausgeführt**: beim Auflisten, einem einzelnen Abruf (Get), beim Zählen (Count), beim Aggregieren, bei der Suche, beim Vektor-Lesevorgang, beim Auflisten verschachtelter Pfade, beim Realtime-Refetch hinter einem `.listen()` sowie bei Zeilen, die für eine Relation oder ein `?include=` geladen werden, wobei hier der Hook der **Ziel**tabelle greift.
- **Ein Filter, der nicht kompiliert werden kann, lehnt die Anfrage ab.** Das Benennen einer Spalte, die die Tabelle nicht besitzt, führt zu einem 400-Fehler, niemals zu einer ignorierten Bedingung.
- **Ein Schreibvorgang auf eine Zeile, die ausgeschlossen wird, führt zu einem 404.** Ein Update oder Delete, das an eine Zeile außerhalb des Gültigkeitsbereichs adressiert ist, wird vor dem Schreiben abgelehnt. Das Ablehnen eines Schreibvorgangs basierend auf seinen Inhalten ist Aufgabe von `beforeSave`.

Die Eindeutigkeitsprüfung hinter `.unique()` wird nicht eingegrenzt: Wäre sie eingegrenzt, würde sie für einen Wert, den eine verborgene Zeile bereits besitzt, fälschlicherweise „eindeutig“ zurückgeben.

Row-Level Security ist das Autorisierungsmodell; `beforeQuery` ist Anwendungslogik darauf aufbauend. Verwenden Sie [`rls`](/docs/collections/security-rules/) für alles, was auch für SQL gelten muss, das im Kontext des Aufrufers ausgeführt wird.

## `beforeSave`

Wird ausgeführt, bevor eine Zeile geschrieben wird, und gibt die zu schreibenden Werte zurück. `values` enthält bei einer Erstellung jeden Wert und bei einer Aktualisierung die geänderten Werte; `previousValues` ist bei einer Aktualisierung die Zeile im vorherigen Zustand; `status` ist `"new"`, `"existing"` oder `"copy"`; `id` fehlt bei einer Erstellung, deren Schlüssel von der Datenbank generiert wird.

Er wird innerhalb der Transaktion des Schreibvorgangs ausgeführt und belegt daher eine Verbindung aus dem Pool, solange er läuft. Siehe [Ein Hook belegt eine Verbindung](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Werfen Sie einen Fehler (throw), um den **Schreibvorgang abzulehnen**. Nichts gelangt in die Datenbank, und der Aufrufer erhält einen **400**-Fehler mit Ihrer Nachricht und dem Code `CALLBACK_REJECTED`:

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

Um den Status und Code selbst zu wählen – ein 409 bei einem Konflikt, ein 422 für etwas Wohlgeformtes, aber Unzulässiges –, werfen Sie einen `RebaseApiError`:

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

Importieren Sie `RebaseApiError` aus `@rebasepro/types`: Schemadateien laden keinen Server-Code, und es handelt sich um dieselbe Klasse, die auch das typisierte SDK wirft.

## `afterSave` und `afterSaveError`

`afterSave` wird ausgeführt, nachdem die Zeile geschrieben wurde und vor dem Commit, innerhalb derselben Transaktion. Die `values` entsprechen der Zeile im gespeicherten Zustand. Ein Fehler rollt den Speichervorgang zurück, zusammen mit allem, was der Hook über `context.data` geschrieben hat:

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

Aktionen, die über die Datenbank hinausgehen – eine E-Mail, ein Webhook –, gehören nicht in den Hook-Body: Sie halten die Transaktion für einen Netzwerk-Roundtrip offen, und nichts nimmt sie zurück, wenn der Schreibvorgang zurückgerollt wird. Reihen Sie stattdessen einen [Job](/docs/backend/jobs/) in die Warteschlange ein; ein aus einem Hook eingereihter Job wird zusammen mit dem Schreibvorgang committet.

`afterSaveError` wird ausgeführt, wenn ein Speichervorgang in der Datenbank oder danach fehlgeschlagen ist, sobald die Transaktion des fehlgeschlagenen Schreibvorgangs zurückgerollt wurde. Er wird nicht bei einer Ablehnung durch `beforeSave` oder einer Anfrage ausgeführt, die vor dem Schreibvorgang abgewiesen wurde. Sein `context.data` ist eine neue Instanz für denselben Aufrufer, sodass ein von ihm eingereihter Job den gemeldeten Fehler übersteht. Ein Fehler, der hier geworfen wird, wird protokolliert, und der Aufrufer erhält weiterhin den ursprünglichen Fehler des Speichervorgangs.

## `afterRead`

Wird für jede Zeile ausgeführt, die den Server verlässt – die Antwort eines Lesevorgangs, die Antwort eines Schreibvorgangs, ein Realtime-Frame, ein MCP-Ergebnis – und gibt die auszuliefernde Zeile zurück. `values` ist die Zeile im gespeicherten Zustand, nachdem der [Feldzugriff](/docs/collections/field-access/) entfernt hat, was der Aufrufer nicht lesen darf.

Er bestimmt ausschließlich, was ein Aufrufer empfängt: `afterSave`, die Lösch-Hooks und die [Historie](/docs/backend/history/) erhalten die Zeile so, wie sie gespeichert ist. Ein hier maskierter Wert ist also niemals das, was ein Audit erfasst oder ein Revert zurückschreibt. Die Historie *liefert* ihre Einträge ebenfalls über `afterRead` aus, sodass ein Snapshot den Wert genauso maskiert anzeigt wie die Zeile.

Zeilen, die in die Antwort einer anderen Tabelle eingebettet sind – ein `include`, Werte einer Relations-Referenz, die Zeilen, die ein Realtime-Frame für eine Relation mitführt –, werden eine Ebene tief mit dem `afterRead` der **Ziel**tabelle maskiert. Die Reihenfolge ist: global, dann Tabelle, dann Spalten-`.transform({ afterRead })`. Ein Realtime-Dienst ohne Treiber zur Ausführung der Hooks weist Frames für eine Tabelle ab, die über Hooks verfügt, anstatt sie unmaskiert zu senden.

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

Ein Aggregat gibt Summen und Anzahlen zurück, keine Zeilen, weshalb es `afterRead` nicht durchlaufen kann. Bei einer Tabelle mit diesem Hook wird nur `count()` ohne `groupBy` ausgeliefert; jedes andere [Aggregat](/docs/sdk/aggregates-and-search/#aggregates) wird mit `400 AGGREGATE_MASKED_BY_AFTER_READ` abgelehnt.

Ein Wert, den ein Aufrufer niemals erhalten darf, wird besser vorenthalten als maskiert: [`.access()` oder `.private()`](/docs/collections/field-access/) entfernen die Spalte, bevor irgendein Hook ausgeführt wird, und halten sie auch aus Filtern heraus.

## `beforeDelete` und `afterDelete`

Beide erhalten die zu löschende Zeile als `values` und deren `id`.

`beforeDelete` wird innerhalb der Transaktion des Löschvorgangs ausgeführt. Werfen Sie einen Fehler, um das Löschen abzulehnen; der Aufrufer erhält `400 CALLBACK_REJECTED` mit Ihrer Nachricht. Die Rückgabe von `false` lehnt es ebenfalls ab, als `403 CALLBACK_REJECTED` ohne eigene Nachricht.

`afterDelete` wird nach dem Löschen der Zeile und vor dem Commit ausgeführt. Ein Fehler rollt das Löschen zurück. Bei einer Tabelle mit [Soft Delete](/docs/collections/soft-delete/) ist ein Löschvorgang eine Markierung (Stamp), und beide Hooks werden weiterhin ausgeführt.

## Feld-Hooks: `.transform()`

Das `.transform()` einer Spalte akzeptiert zwei Hooks auf Feldebene: `beforeSave` gibt den zu speichernden Wert zurück und `afterRead` den auszuliefernden Wert. Sie laufen auf dem Server für jeden Aufrufer und empfangen `value`, die gesamte Zeile als `values` sowie die Props, die jeder Hook erhält.

`value` ist präzise typisiert: `T | null` bei einer Nullable-Spalte und `T`, wenn `.notNull()` **vor** `.transform()` deklariert wurde. Bei einem JSON-Feld ist es `T | undefined`, es sei denn, `.required()` steht an erster Stelle.

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

`.transform()` ist auch für Array-Elemente und für jedes Feld eines [JSON-Dokuments](/docs/schema/json/) verfügbar. Für das Kürzen von Leerzeichen und die Groß-/Kleinschreibung erfordern die [Validierungsregeln](/docs/schema/columns/#validation) `trim`, `lowercase` und `uppercase` keinen Code.

## In andere Tabellen schreiben

`context.data` liest und schreibt jede Tabelle anhand ihres Slugs im Kontext des Aufrufers und innerhalb derselben Transaktion wie der Schreibvorgang, der den Hook ausgelöst hat:

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

Das obige Update speichert `job_submissions` erneut, was diesen Hook wieder ausführt; die Statusprüfung unterbricht diese Schleife. [Die `context.data`-API](/docs/collections/context-data-api/) behandelt die Berechtigungen, mit denen sie ausgeführt wird, sowie Transaktions- und Verschachtelungsgrenzen.

## Hooks für jede Tabelle

Hooks, die für jede Tabelle gelten – wie die Maskierung personenbezogener Daten (PII) im gesamten Schema oder ein globales Audit-Log –, werden als `hooks` aus `backend/hooks.ts` in derselben `TableHooks`-Struktur exportiert. Sie werden vor den eigenen Hooks jeder Tabelle ausgeführt, welche wiederum vor dem `.transform()` ihrer Spalten laufen. Siehe [Globale Hooks](/docs/backend/hooks/).

Hooks können auch nach dem Booten mit `setTableHooks(slug, hooks)` auf dem Backend angehängt werden. Dies **ersetzt** die von der Tabelle deklarierten Hooks; um sie zu ergänzen, übergeben Sie `composeTableHooks(declared, yours)`.

## Hook-Sets kombinieren

Eine Tabelle hat ein einzelnes `hooks`-Objekt. Wenn mehrere Anliegen jeweils einen Hook erfordern – ein Slug-Generator, ein Audit-Trail, ein Mandanten-Scope –, schreiben Sie jedes als eigenes Set und kombinieren Sie sie mit `composeTableHooks` aus `@rebasepro/common`:

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

Die Sets werden in der angegebenen Reihenfolge ausgeführt, und jeder Hook wird so kombiniert, wie das Backend seine globalen und tabellenspezifischen Ebenen kombiniert:

| Hook | Kombiniert |
|---|---|
| `beforeSave` | Verkettet: Jedes Set sieht die Werte, die das vorherige zurückgegeben hat, shallow-gemergt über die übergebenen Werte |
| `afterRead` | Verkettet: Jedes Set erhält die Zeile, die das vorherige zurückgegeben hat |
| `beforeQuery` | Per AND verknüpft: Jedes Set sieht die Abfrage des Aufrufers, und eine Zeile muss jede Einschränkung erfüllen |
| `beforeDelete` | Jedes `false` legt ein Veto gegen das Löschen ein; alle Sets werden dennoch ausgeführt |
| `afterSave`, `afterDelete` | Werden nacheinander ausgeführt, jeweils abgewartet (awaited); ein Fehler bricht die restlichen ab |
| `afterSaveError` | Werden nacheinander ausgeführt; ein Fehler hält das nächste Set nicht auf, und der erste Fehler wird am Ende erneut geworfen |

Ein Hook ist nur dann im Ergebnis enthalten, wenn mindestens ein Set ihn definiert; ein `undefined`-Set wird übersprungen. Ein Set, das getrennt von seiner Tabelle geschrieben wird, wie `auditTrail` oben, ist mit der generischen Zeile typisiert. Lesen Sie dessen Werte daher als `unknown` aus und validieren Sie diese.

## Einen Hook testen

Ein Hook ist eine gewöhnliche Funktion mit einem einzigen Props-Objekt, sodass ein Unit-Test ihn direkt aufrufen kann: `posts.config.hooks?.beforeSave?.(props)`. `createCallContext` aus `@rebasepro/server` erstellt das `context`-Prop nur mit den Feldern, die der Test übergibt; jedes andere Feld wirft bei der ersten Verwendung einen Fehler und nennt sich selbst. `table` ist der Deskriptor, den `compileTables` aus `@rebasepro/common` für die Tabelle zurückgibt. Um Hooks gegen eine echte Datenbank auszuführen, siehe [Skripte und die Konsole](/docs/backend/scripts/).

## Nächste Schritte

- [Die `context.data`-API](/docs/collections/context-data-api/): Berechtigungen, Transaktionen und die Verbindung, die ein Hook belegt
- [Globale Hooks](/docs/backend/hooks/): Hooks für alle Tabellen
- [Entitätshistorie](/docs/backend/history/): Ein Audit-Trail, ohne Hooks schreiben zu müssen
