---
sourceHash: 9b21d41a290148dd
title: Entity-Callbacks
sidebar_label: Callbacks
description: Nutzen Sie Lifecycle-Callbacks, um benutzerdefinierte Logik auszuführen, wenn Entitäten erstellt, aktualisiert, gelesen oder gelöscht werden. Enthält die context.data-API für sammlungsübergreifende Operationen.
---

## Übersicht

Mit Callbacks können Sie sich in den Lifecycle von Entitäten einhängen, um:

- **Daten zwischen Collections zu synchronisieren** – Entitäten bei Statusänderungen über Tabellen hinweg kopieren oder verschieben
- **Daten vor dem Speichern zu transformieren** (berechnete Felder, Slug-Generierung)
- Geschäftsregeln jenseits der Schema-Validierung zu **validieren**
- **Nebeneffekte nach Schreibvorgängen auszulösen** (E-Mails senden, APIs synchronisieren, Caches aktualisieren)
- **Einen Lesevorgang einzuschränken**, bevor er kompiliert wird, sodass ein Aufrufer immer nur seine eigenen Zeilen sieht
- Daten nach dem Lesen zu **filtern/transformieren**
- **Kaskadierende Operationen** durchzuführen – zugehörige Datensätze beim Löschen bereinigen

## Wo Callbacks ausgeführt werden

Eine Collection verfügt über zwei Callback-Blöcke; der einzige Unterschied besteht darin, welche Runtime sie ausführt.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Läuft auf | dem Server | dem Admin-Panel, im Browser |
| Wird ausgelöst für | REST, das SDK, Realtime, `dataAsAdmin` | Lese- und Schreibvorgänge, die das Panel ausführt |
| Erreicht den Browser | nein – Funktionsrümpfe werden aus dem Bundle entfernt | ja, vollständig |
| Verwenden für | alles Nachfolgende | Collections, mit denen das Panel direkt kommuniziert |

**`callbacks` ist der Block, den Sie verwenden sollten.** Er wird auf jedem Datenpfad ausgeführt, der den Server erreicht – REST, das SDK, Realtime, MCP und `rebase.data` – und sein Code verlässt die Maschine nie, sodass ein API-Schlüssel oder das Auslesen von `process.env` dort sicher ist. Der Rest dieser Seite behandelt `callbacks`.

Ein schreibender Akteur ist kein gewöhnlicher Datenpfad: **das Auth-System**. Registrierung, OAuth-Sign-in und die Benutzerverwaltung des Admins schreiben die Zeilen der `users`-Tabelle direkt und führen keinen ihrer Callbacks aus. Daher wird eine Willkommens-E-Mail in `afterSave` auf `users` bei der Registrierung niemals ausgelöst. Binden Sie diese an die in `auth.hooks` übergebenen [Auth-Hooks](/docs/backend/authentication/) an – `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` –, die ein ejected Backend entgegennehmen; beim Booten wird gewarnt, wenn die `users`-Collection Callbacks deklariert, die bei der Registrierung nicht ausgeführt werden.

`admin.browserCallbacks` existiert für einen bestimmten Fall: eine Collection mit einem `direct`- oder `custom`-Transport, die das Panel *selbst* liest und schreibt, ohne dass sich ein Rebase-Server im Request-Pfad befindet. Serverseitig bekommt nichts diese Operationen mit, sodass `callbacks` für sie niemals ausgelöst werden kann – dieser Block ist der einzige Ort, an dem ihre Lifecycle-Logik verbleiben kann.

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

Aus „wird an jeden Besucher ausgeliefert“ folgen zwei Regeln, und keine davon ist stilistischer Natur:

1. **Keine Secrets.** Keine API-Schlüssel, kein `process.env`, nichts, bei dem es Sie stören würde, wenn ein Leser des Bundles es sehen könnte. Das gehört in `callbacks`.
2. **Es ist keine Sicherheitsgrenze.** Ein `browserCallbacks.afterRead`, das ein Feld unkenntlich macht, tut dies *nachdem* der Browser die Zeile bereits empfangen hat – bei einem Direct-Transport kam das Rohdokument direkt aus dem Datenspeicher. Es ist reine Präsentation. Ausblendungen, die sicher sein müssen, gehören in `callbacks` oder in die eigenen Regeln des Datenspeichers.

Bei einer Collection mit Server-Transport – dem Standard und mit ziemlicher Sicherheit Ihrer – hat der Server `callbacks` bereits ausgeführt, bevor die Zeile das Panel erreicht, sodass ein `browserCallbacks.afterRead` *zusätzlich* dazu ausgeführt wird. Schreiben Sie es idempotent oder verzichten Sie darauf.

Ein `browserCallbacks.afterSave` wird ausgeführt, nachdem der Schreibvorgang gespeichert wurde, und nichts im Browser kann ihn rückgängig machen. Ein Fehler (`throw`) daraus wird als Warnung angezeigt; der Speichervorgang selbst wird als abgeschlossen gemeldet, sodass das Formular nicht anbietet, den Datensatz ein zweites Mal zu erstellen.

## Callbacks definieren

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

## Callback-Sets kombinieren

Unter 0.24 kombinieren Sie Sets manuell.

Eine Collection hat ein einziges `callbacks`-Objekt. Wenn mehrere Belange jeweils einen Hook erfordern, wie z. B. Zeitstempel, ein Audit-Trail und ein Mandanten-Scope, schreiben Sie jeden als eigenes Set und kombinieren Sie diese mit `composeCallbacks`:

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

Die Sets werden in der angegebenen Reihenfolge ausgeführt, und jeder Hook kombiniert sich so, wie das Backend seine eigenen [globalen](/docs/backend/hooks), Sammlungs- und Eigenschafts-Ebenen kombiniert:

| Hook | Kombiniert |
|---|---|
| `beforeSave` | Verkettet: Jedes Set sieht die vom vorherigen zurückgegebenen Werte, per Shallow-Merge über die übergebenen Werte gelegt |
| `afterRead` | Verkettet: Jedes Set erhält die vom vorherigen zurückgegebene Zeile |
| `beforeQuery` | UND-verknüpft: Jedes Set sieht die Abfrage des Aufrufers, und eine Zeile muss jede Einschränkung erfüllen |
| `beforeDelete` | Jedes `false` legt ein Veto gegen das Löschen ein; jedes Set wird dennoch ausgeführt |
| `afterSave`, `afterDelete` | Werden der Reihe nach ausgeführt, jeweils mit `await`; ein geworfener Fehler bricht den Rest ab |
| `afterSaveError` | Werden der Reihe nach ausgeführt; ein Fehler stoppt nicht das nächste Set, und der erste Fehler wird am Ende erneut geworfen |

Ein Hook ist nur dann im Ergebnis enthalten, wenn irgendein Set ihn besitzt, und ein `undefined`-Set wird übersprungen. `composeCallbacks` wird auch aus `@rebasepro/server` und `@rebasepro/common` exportiert.

Das Anhängen von Callbacks nach dem Booten mit `backend.setCollectionCallbacks(slug, callbacks)` **ersetzt** diejenigen, die die Collection deklariert hat. Um Ihre eigenen hinzuzufügen, übergeben Sie `composeCallbacks(declared, yours)`.

## Callback-Referenz

### `beforeQuery`

Wird aufgerufen, **bevor ein Lesevorgang kompiliert wird**, um einzugrenzen, welche Zeilen angefordert werden. Geben Sie Bedingungen zurück, die per UND in die Abfrage eingefügt werden sollen; geben Sie nichts zurück, um keine hinzuzufügen.

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

`afterRead` sieht Zeilen, die bereits abgerufen wurden, kann also einen Wert ausblenden, aber nicht verhindern, dass die Zeile gelesen wird. `beforeQuery` läuft früher ab, und drei Dinge darüber sind wissenswert:

- **Es kann nur einschränken.** Der Rückgabewert ist ein Filter, der per UND verknüpft wird, und kein Rückgabewert kann den Lesevorgang erweitern. `filter` akzeptiert dieselben Feldfilter wie eine Abfrage; `logical` akzeptiert eine `or`/`and`-Gruppe für einen Scope wie „meine oder mit mir geteilte“ – immer noch als Ganzes per UND verknüpft, sodass das `or` immer nur unter Zeilen auswählt, die der Rest der Abfrage ohnehin zulässt.
- **Es wird auf jedem Lesepfad ausgelöst.** Beim Listing, beim einzelnen Get, beim Count, beim Aggregat, bei der Suche, beim Vektor-Lesevorgang, bei verschachtelten Pfad-Listings, beim Realtime-Refetch hinter einem `.listen()` und bei den für eine Relation oder ein `?include=` geladenen Zeilen – wobei hier der Hook der **Ziel-Collection** greift, da dies die Zeilen des Ziels sind.
- **Ein Filter, der nicht kompiliert werden kann, weist die Anfrage ab.** Das Benennen einer Spalte, die die Tabelle nicht besitzt, führt zu einem 400-Fehler, niemals zu einer verworfenen Bedingung.
- **Ein Schreibvorgang auf eine ausgeschlossene Zeile führt zu einem 404.** Eine Aktualisierung oder Löschung, die an eine Zeile außerhalb des Scopes gerichtet ist, wird vor dem Schreibvorgang mit derselben „no row …“-Antwort abgelehnt, die auch ein Lesevorgang liefert – ein Scope ist also auch ein Scope für Schreibvorgänge, nicht nur für Lesevorgänge. Ein One-to-Many-Zugehörigkeitsschreibvorgang (`comments: [ids]` auf einem Post) belässt ein Child, das der Scope des Ziels verbirgt, dort wo es ist, da es eine ID hinterlässt, die keine Zeile benennt. Was es *nicht* filtert, sind die geschriebenen Werte: Die Ablehnung eines Schreibvorgangs anhand seines Inhalts ist Aufgabe von `beforeSave`.

Ein Lesevorgang wird bewusst nicht eingeschränkt: die Eindeutigkeitsprüfung hinter `validation: { unique: true }`. Sie prüft, ob ein Wert irgendwo in der Tabelle existiert; wäre sie eingeschränkt, würde sie für einen Wert, den eine verborgene Zeile bereits enthält, „eindeutig“ zurückmelden.

:::caution[Vorerst nur Postgres]
`beforeQuery` wird von `@rebasepro/server-postgres` implementiert. Eine von MongoDB oder Firestore bereitgestellte Collection, die einen solchen Hook deklariert, **schlägt beim Booten fehl** (unter Nennung des Namens), anstatt dass der Hook stillschweigend wirkungslos bleibt – was bei einem Zeilenfilter bedeuten würde, dass jede Zeile an jeden ausgeliefert wird. Ein [globaler](/docs/backend/hooks) `beforeQuery`-Hook schlägt beim Booten auf dieselbe Weise fehl, wenn eine Datenquelle nicht Postgres ist, ebenso wie ein nachträglich mit `setCollectionCallbacks` angehängter. Eine Schwärzung/Ausblendung, die auf jeder Engine funktioniert, ist [`afterRead`](#afterread).
:::

→ [Server erweitern](/docs/backend/extending#2-collection-callbacks) dafür, wo sich dies im Vergleich zu den anderen Optionen einordnet.

### `beforeSave`

Wird aufgerufen, bevor ein Datensatz in die Datenbank geschrieben wird. Gibt die modifizierten Werte zurück. Unter Postgres wird er innerhalb der Transaktion des Schreibvorgangs ausgeführt, die bereits begonnen hat, und belegt daher für die Dauer seiner Ausführung eine gepoolte Verbindung – siehe [Ein Callback belegt eine Verbindung](/docs/collections/context-data-api#a-callback-holds-a-connection).

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

Werfen Sie einen Fehler, um **den Speichervorgang zu blockieren**. Der Schreibvorgang erreicht die Datenbank nie, und der Aufrufer erhält einen **400**-Fehler mit Ihrer Nachricht und dem Code `CALLBACK_REJECTED`:

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

Um den Status und den Code selbst zu wählen – eine 409 bei einem Konflikt, eine 422 bei etwas Wohlgeformtem, aber Inakzeptablem –, werfen Sie einen `RebaseApiError`:

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
Importieren Sie ihn aus `@rebasepro/types`, nicht aus `@rebasepro/server`. Eine Collection-Datei wird mit dem Frontend geteilt – der Vite-Build des Admin-Panels liest dasselbe Verzeichnis –, daher darf sie nur Packages importieren, die im Browser lauffähig sind. `RebaseApiError` ist die browsersichere Variante und dieselbe Klasse, die auch das typisierte SDK wirft.
:::

### `afterSave`

Wird aufgerufen, nachdem die Zeile geschrieben wurde und bevor der Commit erfolgt, innerhalb derselben Transaktion. Ein geworfener Fehler setzt den Speichervorgang zurück – siehe [Transaktionssemantik](/docs/collections/context-data-api#transaction-semantics).

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

Wird aufgerufen, wenn ein Speichervorgang fehlschlägt.

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

Er wird für Speichervorgänge ausgeführt, die in der Datenbank oder danach fehlgeschlagen sind – nicht bei einer Verweigerung in `beforeSave`, einer vor dem Schreiben abgelehnten Anfrage (Validierung, fehlende Berechtigung, 404) oder einem nach Rückkehr des Speichervorgangs abgelehnten Commit ([vollständige Liste](/docs/backend/hooks/#when-aftersaveerror-runs)).

Bei einer Anfrage wird er ausgeführt, sobald die Transaktion des fehlgeschlagenen Schreibvorgangs zurückgerollt wurde, nicht innerhalb dieser. Sein `context.data` ist eine neue Instanz für denselben Aufrufer, bei der jeder Aufruf eine eigene Transaktion darstellt. Daher wird ein eingereihter [Job](/docs/backend/jobs), eine Queue-Nachricht oder ein Webhook committet und übersteht den gemeldeten Fehler. Ein Fehler aus `afterSaveError` wird protokolliert, und der Aufrufer erhält weiterhin den ursprünglichen Fehler des Speichervorgangs.

### `afterRead`

Wird nach dem Lesen von Entitäten aus der Datenbank aufgerufen. Transformieren Sie die Daten für die Anzeige.

Er bestimmt, was ein Aufrufer empfängt – die Antwort eines Lese- oder Schreibvorgangs sowie dessen Realtime-Frame – und sonst nichts: `afterSave`, `beforeDelete`, `afterDelete` und die [Historie](/docs/backend/history) erhalten die Zeile so, wie sie gespeichert ist: Ein hier maskierter Wert wird niemals in einem Audit protokolliert oder bei einem Revert zurückgeschrieben, und ein hier hinzugefügtes Feld wird niemals geschrieben.

Ein Aggregat gibt Summen und Anzahlen zurück, keine Zeilen, und kann daher `afterRead` nicht durchlaufen. Bei einer Collection, auf die dies zutrifft, wird nur `count()` ohne `groupBy` unterstützt; jedes andere [Aggregat](/docs/sdk/aggregates-and-search/#aggregates) wird mit `400 AGGREGATE_MASKED_BY_AFTER_READ` abgelehnt.

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

Wird aufgerufen, bevor ein Datensatz gelöscht wird. Werfen Sie einen Fehler, um das Löschen zu blockieren, und der Aufrufer erhält `400 CALLBACK_REJECTED` mit Ihrer Nachricht. Die Rückgabe von `false` blockiert es ebenfalls, als `403 CALLBACK_REJECTED` ohne Ihre Nachricht.

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

Wird aufgerufen, nachdem die Zeile gelöscht wurde und bevor der Commit erfolgt, innerhalb derselben Transaktion. Ein geworfener Fehler setzt das Löschen zurück.

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

## Property-Callbacks

Sie können Callbacks auch auf Eigenschaftsebene für feldspezifische Transformationen definieren:

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

Jeder Callback erhält außerdem `context.data`, einen Daten-Layer zum Lesen und Schreiben anderer Collections aus dem Hook heraus – siehe [Die `context.data`-API](/docs/collections/context-data-api).

## Daten zwischen Collections synchronisieren

Eine der mächtigsten Einsatzmöglichkeiten von Callbacks ist die **Synchronisierung von Daten über Collections hinweg** mithilfe von `context.data`:

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

Weitere sammlungsübergreifende Muster:

- **Kaskadierendes Löschen**: Verwenden Sie `afterDelete`, um zugehörige Datensätze in untergeordneten Collections zu entfernen
- **Denormalisierung**: Verwenden Sie `afterSave`, um Zusammenfassungsfelder in einer übergeordneten Collection zu aktualisieren
- **Audit-Logging**: Verwenden Sie `afterSave` / `afterDelete`, um in eine Audit-Log-Collection zu schreiben
- **Zähler**: Verwenden Sie `afterSave` / `afterDelete`, um Zählerfelder bei zugehörigen Entitäten zu aktualisieren

## Einen Callback testen

Ein Callback ist eine einfache Funktion mit einem Props-Objekt, sodass ein Unit-Test ihn direkt aufrufen kann. `createCallContext` erstellt die `context`-Prop: Die übergebenen Felder werden unverändert verwendet, und jedes weggelassene Feld ist ein Platzhalter, der bei der ersten Verwendung einen Fehler wirft und sich selbst benennt. Dadurch stellt ein Test nur das bereit, was der Hook tatsächlich verwendet.

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

Ein Hook, der über `context.data` liest oder schreibt, benötigt einen Driver: Übergeben Sie `createCallContext({ data: buildSdkData(driver) })` mit `buildSdkData` aus `@rebasepro/common` und einem beliebigen `DataDriver`, einschließlich eines In-Memory-Drivers. `user` bleibt abwesend, sofern Sie ihn nicht übergeben – genau wie bei einem Schreibvorgang ohne Aufrufer –, sodass ein `if (context.user)`-Zweig unverfälscht getestet wird. Um Hooks stattdessen gegen eine echte Datenbank auszuführen, siehe [Skripte und die Konsole](/docs/backend/scripts/).

## Vollständige Kontext-Referenz

Jeder Callback erhält ein `context`-Objekt vom Typ `RebaseCallContext`:

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

Führen Sie Abfragen über `context.data` durch. `context.client` besitzt kein `data`: Serverseitig handelt es sich um das `rebase`-Singleton, dessen einzige Datenebene das admin-bezogene `dataAsAdmin` ist; `context.client.data` führt daher zu einem Kompilierungsfehler. Wie Sie ein solches Objekt für einen Test erstellen, erfahren Sie unter [Testing a callback](#einen-callback-testen).

## Nächste Schritte

- **[Security Rules](/docs/collections/security-rules)** — Row Level Security
- **[Entity History](/docs/backend/history)** — Audit-Trail
- **[Custom Functions](/docs/backend/custom-functions)** — Benutzerdefinierte API-Endpunkte hinzufügen
