---
sourceHash: 3885c8f3dc44eb65
title: Entitäts-Callbacks
sidebar_label: Callbacks
description: Nutzen Sie Lifecycle-Callbacks, um benutzerdefinierte Logik auszuführen, wenn Entitäten erstellt, aktualisiert, gelesen oder gelöscht werden. Beinhaltet die context.data-API für collections-übergreifende Operationen.
---

## Übersicht

Mit Callbacks können Sie sich in den Entitäts-Lebenszyklus einhängen, um:

- **Daten zwischen Collections zu synchronisieren** — Entitäten bei Statusänderungen tabellenübergreifend kopieren oder verschieben
- **Daten vor dem Speichern zu transformieren** (berechnete Felder, Slug-Generierung)
- **Geschäftsregeln zu validieren**, die über die Schema-Validierung hinausgehen
- **Nebeneffekte nach Schreibvorgängen auszulösen** (E-Mails senden, APIs synchronisieren, Caches aktualisieren)
- **Einen Lesevorgang einzugrenzen**, bevor er kompiliert wird, sodass ein Aufrufer immer nur seine eigenen Zeilen sieht
- **Daten nach dem Lesen zu filtern/transformieren**
- **Kaskadierende Operationen durchzuführen** — zugehörige Datensätze beim Löschen bereinigen

## Wo Callbacks ausgeführt werden

Eine Collection verfügt über zwei Callback-Blöcke, und der einzige Unterschied besteht darin, welche Runtime sie ausführt.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Läuft auf | dem Server | dem Admin-Panel, im Browser |
| Wird ausgelöst für | REST, das SDK, Realtime, `dataAsAdmin` | Lese- und Schreibvorgänge, die das Panel ausführt |
| Erreicht den Browser | Nein — Funktionskörper werden aus dem Bundle entfernt | Ja, vollständig |
| Verwenden für | Alles unten Beschriebene | Collections, mit denen das Panel direkt kommuniziert |

**`callbacks` ist der Block, den Sie verwenden möchten.** Er wird bei jedem Datenpfad ausgeführt, der den Server erreicht — REST, das SDK, Realtime, MCP und `rebase.data` — und sein Funktionskörper verlässt niemals die Maschine, sodass ein API-Schlüssel oder ein `process.env`-Aufruf dort sicher ist. Der Rest dieser Seite bezieht sich auf `callbacks`.

Ein Writer ist kein Datenpfad: **das Auth-System**. Registrierung, OAuth-Anmeldung und die Benutzerverwaltung des Admins schreiben die Zeilen der `users`-Tabelle direkt und führen keine ihrer Callbacks aus; daher wird eine Willkommens-E-Mail in `afterSave` auf `users` bei einer Registrierung niemals ausgelöst. Hängen Sie dies an die [Auth-Hooks](/docs/backend/authentication/) an, die in `auth.hooks` übergeben werden — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` —, die ein ausgeworfenes Backend (ejected backend) entgegennehmen; der Boot-Vorgang warnt, wenn die `users`-Collection Callbacks deklariert, die bei der Registrierung nicht ausgeführt werden.

`admin.browserCallbacks` existiert für einen bestimmten Fall: eine Collection mit einem `direct`- oder `custom`-Transport, die das Panel *selbst* liest und schreibt, ohne dass sich ein Rebase-Server im Request-Pfad befindet. Auf der Serverseite sieht nichts diese Operationen, daher können `callbacks` für sie niemals ausgelöst werden, und dieser Block ist der einzige Ort, an dem ihre Lifecycle-Logik existieren kann.

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

Aus "wird an jeden Besucher ausgeliefert" folgen zwei Regeln, und keine davon ist stilistischer Natur:

1. **Keine Secrets.** Keine API-Schlüssel, kein `process.env`, nichts, von dem Sie nicht möchten, dass ein Betrachter des Bundles es sieht. Das gehört in `callbacks`.
2. **Es ist keine Sicherheitsgrenze.** Ein `browserCallbacks.afterRead`, das ein Feld zensiert, zensiert es *nachdem* der Browser die Zeile bereits enthält — bei einem direkten Transport kam das rohe Dokument direkt aus dem Store. Es dient der Darstellung. Eine Zensierung, die greifen muss, gehört in `callbacks` oder in die eigenen Regeln des Stores.

Bei einer Collection mit Server-Transport — dem Standard, und mit ziemlicher Sicherheit bei Ihnen der Fall — hat der Server `callbacks` bereits ausgeführt, bevor die Zeile das Panel erreicht, sodass ein `browserCallbacks.afterRead` *zusätzlich* dazu ausgeführt wird. Schreiben Sie es so, dass es idempotent ist, oder schreiben Sie es gar nicht.

Beiden Blöcken wird dasselbe übergeben: Zeilen, wie der Server sie sendet, ein Datum als ISO-String und ein `belongsTo` als Fremdschlüssel-Spalte. Das gilt für jeden Schreibvorgang, den das Panel ausführt — das Speichern eines Datensatzformulars, eine Inline-Tabellenbearbeitung, `useRowWrites` und ein Schreibvorgang über `context.data` des Browsers — sodass derselbe Callback-Körper in beiden Blöcken funktioniert. Was ein `browserCallbacks.beforeSave` in der von ihm zurückgegebenen Zeile ändert, ist das, was das Formular speichert. Der `context`, den er erhält, ist der des Browsers: sein `data` liest Zeilen auf die gleiche Weise, und ein Schreibvorgang darüber führt auch die `browserCallbacks` der Collection aus, sodass ein Hook, der in seine eigene Collection schreibt, sich selbst erneut ausführt.

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

Eine Collection hat ein `callbacks`-Objekt. Wenn mehrere Anliegen jeweils einen Hook erfordern, wie etwa Zeitstempel, ein Audit-Trail und ein Mandanten-Scope (Tenant Scope), schreiben Sie jedes als eigenes Set und kombinieren Sie sie mit `composeCallbacks`:

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

Die Sets werden in der angegebenen Reihenfolge ausgeführt, und jeder Hook wird so kombiniert, wie das Backend seine eigenen [globalen](/docs/backend/hooks), Collection- und Property-Ebenen kombiniert:

| Hook | Kombiniert |
|---|---|
| `beforeSave` | Verkettet: Jedes Set sieht die vom vorherigen zurückgegebenen Werte, flach zusammengeführt (shallow-merged) mit dem, was übergeben wurde |
| `afterRead` | Verkettet: Jedes Set erhält die Zeile, die das vorherige zurückgegeben hat |
| `beforeQuery` | Mit UND (AND) verknüpft: Jedes Set sieht die Abfrage des Aufrufers, und eine Zeile muss jede Eingrenzung bestehen |
| `beforeDelete` | Jedes `false` legt ein Veto gegen das Löschen ein; jedes Set wird dennoch ausgeführt |
| `afterSave`, `afterDelete` | Werden der Reihe nach ausgeführt, jeweils mit `await`; ein `throw` stoppt die restlichen |
| `afterSaveError` | Werden der Reihe nach ausgeführt; ein `throw` stoppt das nächste Set nicht, und der erste Fehler wird am Ende erneut geworfen |

Ein Hook ist nur dann im Ergebnis enthalten, wenn ein Set ihn definiert, und ein `undefined`-Set wird übersprungen. `composeCallbacks` wird auch von `@rebasepro/server` und `@rebasepro/common` exportiert.

Das Anhängen von Callbacks nach dem Booten mit `backend.setCollectionCallbacks(slug, callbacks)` **ersetzt** diejenigen, die die Collection deklariert hat. Um Ihre eigenen hinzuzufügen, übergeben Sie `composeCallbacks(declared, yours)`.

## Callback-Referenz

### `beforeQuery`

Wird aufgerufen, **bevor ein Lesevorgang kompiliert wird**, um einzugrenzen, welche Zeilen angefordert werden. Geben Sie Bedingungen zurück, die per UND (AND) in die Abfrage eingefügt werden; geben Sie nichts zurück, um keine hinzuzufügen.

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

`afterRead` sieht Zeilen, die bereits abgerufen wurden, kann also einen Wert unkenntlich machen/redigieren, aber nicht verhindern, dass die Zeile gelesen wird. `beforeQuery` läuft früher, und drei Dinge darüber sind wissenswert:

- **Es kann nur eingrenzen.** Der Rückgabewert ist ein Filter, der per UND hinzugefügt wird, und kein Rückgabewert kann den Lesevorgang erweitern. `filter` akzeptiert dieselben Feldfilter wie eine Abfrage; `logical` nimmt eine `or`/`and`-Gruppe auf, etwa für einen Scope wie "meine oder mit mir geteilt" — immer noch als Ganzes per UND verknüpft, sodass das `or` immer nur unter Zeilen auswählt, die der Rest der Abfrage bereits zulässt.
- **Wird bei jedem Lesepfad ausgelöst.** Die Auflistung (List), der einzelne Abruf (Get), Count, Aggregate, die Suche, der Vektor-Lesevorgang, ein Listing verschachtelter Pfade, das Realtime-Refetch hinter einem `.listen()` und die für eine Relation oder ein `?include=` geladenen Zeilen — wobei der Hook der **Ziel-Collection** greift, da dies die Zeilen des Ziels sind.
- **Ein Filter, der nicht kompiliert werden kann, weist die Anfrage ab.** Die Angabe einer Spalte, die die Tabelle nicht besitzt, führt zu einem 400-Fehler, niemals zu einer verworfenen Bedingung.
- **Ein Schreibvorgang auf eine ausgeschlossene Zeile führt zu 404.** Ein Update oder Delete, das an eine Zeile außerhalb des Scopes adressiert ist, wird vor dem Schreibvorgang mit derselben "Keine Zeile …"-Antwort abgewiesen, die ein Lesevorgang liefert — ein Scope ist also auch ein Scope für Schreibvorgänge, nicht nur für Lesevorgänge. Ein 1:n-Zugehörigkeitsschreibvorgang (`comments: [ids]` auf einem Post) belässt ein Child, das der Scope des Ziels verbirgt, dort wo es ist, da es eine ID hinterlässt, die keine Zeile benennt. Was es *nicht* filtert, sind die geschriebenen Werte: Das Verweigern eines Schreibvorgangs aufgrund seiner Inhalte ist Aufgabe von `beforeSave`.

Ein Lesevorgang wird bewusst nicht eingegrenzt: die Eindeutigkeitsprüfung hinter `validation: { unique: true }`. Sie prüft, ob ein Wert irgendwo in der Tabelle existiert, und eingegrenzt würde sie für einen Wert, den eine ausgeblendete Zeile bereits enthält, "eindeutig" zurückgeben.

:::caution[Vorerst nur für Postgres]
`beforeQuery` wird von `@rebasepro/server-postgres` implementiert. Eine von MongoDB oder Firestore bediente Collection, die einen solchen Hook deklariert, **schlägt beim Booten fehl** (mit Namensnennung), anstatt mit stillschweigend inaktivem Hook ausgeführt zu werden — was bei einem Zeilenfilter bedeuten würde, dass jede Zeile an jeden ausgeliefert wird. Ein [globaler](/docs/backend/hooks) `beforeQuery`-Hook schlägt beim Booten auf dieselbe Weise fehl, wenn eine Datenquelle nicht Postgres ist, und ebenso einer, der später mit `setCollectionCallbacks` angehängt wird. Zensierung/Schwärzung (Redaction), die auf jeder Engine funktioniert, ist [`afterRead`](#afterread).
:::

→ [Server erweitern](/docs/backend/extending#2-collection-callbacks) zeigt, wo sich dies unter den anderen Optionen einordnet.

### `beforeSave`

Wird aufgerufen, bevor ein Datensatz in die Datenbank geschrieben wird. Gibt die geänderten Werte zurück. Unter Postgres wird er innerhalb der Transaktion des Schreibvorgangs ausgeführt, die bereits begonnen hat, und hält daher eine gepoolte Verbindung für die Dauer seiner Ausführung — siehe [Ein Callback hält eine Verbindung](/docs/collections/context-data-api#a-callback-holds-a-connection).

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

Werfen Sie einen Fehler (`throw`), um **den Speichervorgang zu blockieren**. Der Schreibvorgang erreicht die Datenbank nie, und der Aufrufer erhält **400** mit Ihrer Nachricht und dem Code `CALLBACK_REJECTED`:

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

Um den Status und den Code selbst zu wählen — eine 409 bei einem Konflikt, eine 422 für etwas Wohlgeformtes, aber Inakzeptables —, werfen Sie einen `RebaseApiError`:

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
Importieren Sie ihn aus `@rebasepro/types`, nicht aus `@rebasepro/server`. Eine Collection-Datei wird mit dem Frontend geteilt — der Vite-Build des Admin-Panels liest dasselbe Verzeichnis —, daher darf sie nur Pakete importieren, die im Browser lauffähig sind. `RebaseApiError` ist die browser-sichere Variante und dieselbe Klasse, die das typisierte SDK wirft.
:::

### `afterSave`

Wird aufgerufen, nachdem die Zeile geschrieben wurde und vor dem Commit, innerhalb derselben Transaktion. Ein Fehler (`throw`) rollt den Speichervorgang zurück — siehe [Transaktionssemantik](/docs/collections/context-data-api#transaction-semantics).

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

Er wird für einen Speichervorgang ausgeführt, der bei der Datenbank oder danach fehlgeschlagen ist — nicht für eine Ablehnung in `beforeSave`, eine vor dem Schreibvorgang abgelehnte Anfrage (Validierung, fehlende Berechtigung, 404) oder einen nach der Rückkehr des Speicherns abgelehnten Commit ([vollständige Liste](/docs/backend/hooks/#when-aftersaveerror-runs)).

Bei einem Request läuft er, sobald die Transaktion des fehlgeschlagenen Schreibvorgangs zurückgerollt wurde, nicht darin. Sein `context.data` ist eine neue Instanz für denselben Aufrufer, bei der jeder Aufruf eine eigene Transaktion darstellt, sodass ein [Job](/docs/backend/jobs), eine Queue-Nachricht oder ein Webhook, den er einreiht, committed wird und den gemeldeten Fehler übersteht. Ein Fehler (`throw`) aus `afterSaveError` wird protokolliert, und der Aufrufer erhält weiterhin den eigentlichen Fehler des Speichervorgangs.

### `afterRead`

Wird nach dem Lesen von Entitäten aus der Datenbank aufgerufen. Transformieren Sie die Daten für die Anzeige.

Er formt, was ein Aufrufer empfängt — die Antwort eines Lese- oder Schreibvorgangs und dessen Realtime-Frame — und sonst nichts: `afterSave`, `beforeDelete`, `afterDelete` und die [Historie](/docs/backend/history) erhalten die Zeile so, wie sie gespeichert ist: Ein hier maskierter Wert ist niemals das, was ein Audit aufzeichnet oder ein Revert zurückschreibt, und ein hier hinzugefügtes Feld wird niemals geschrieben.

Ein Aggregat gibt Summen und Zählwerte zurück, keine Zeilen, und kann daher `afterRead` nicht durchlaufen. Bei einer Collection, für die dies gilt, wird nur `count()` ohne `groupBy` bedient; jedes andere [Aggregat](/docs/sdk/aggregates-and-search/#aggregates) wird mit `400 AGGREGATE_MASKED_BY_AFTER_READ` abgewiesen.

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

Wird aufgerufen, bevor ein Datensatz gelöscht wird. Werfen Sie einen Fehler, um das Löschen zu blockieren, und der Aufrufer erhält `400 CALLBACK_REJECTED` mit Ihrer Nachricht. Die Rückgabe von `false` blockiert es ebenfalls, als `403 CALLBACK_REJECTED` ohne eigene Nachricht.

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

Wird aufgerufen, nachdem die Zeile gelöscht wurde und vor dem Commit, innerhalb derselben Transaktion. Ein Fehler (`throw`) rollt das Löschen zurück.

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

Sie können Callbacks auch auf Property-Ebene für feldspezifische Transformationen definieren:

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

Jeder Callback erhält außerdem `context.data`, eine Datenebene zum Lesen und Schreiben anderer Collections aus dem Hook heraus — siehe [Die `context.data`-API](/docs/collections/context-data-api).

## Daten zwischen Collections synchronisieren

Eine der leistungsfähigsten Einsatzmöglichkeiten von Callbacks ist das **Synchronisieren von Daten über Collections hinweg** mithilfe von `context.data`:

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

Weitere collections-übergreifende Muster:

- **Kaskadierendes Löschen**: Verwenden Sie `afterDelete`, um zugehörige Datensätze in untergeordneten Collections zu entfernen
- **Denormalisierung**: Verwenden Sie `afterSave`, um Zusammenfassungsfelder in einer übergeordneten Collection zu aktualisieren
- **Audit-Protokollierung**: Verwenden Sie `afterSave` / `afterDelete`, um in eine Audit-Log-Collection zu schreiben
- **Zähler**: Verwenden Sie `afterSave` / `afterDelete`, um Zählerfelder bei zugehörigen Entitäten zu aktualisieren

## Einen Callback testen

Ein Callback ist eine einfache Funktion mit einem einzigen Props-Objekt, sodass ein Unit-Test ihn direkt aufrufen kann. `createCallContext` baut die `context`-Prop auf: Die übergebenen Felder werden so verwendet, wie sie sind, und jedes weggelassene Feld ist ein Platzhalter, der bei der ersten Verwendung einen Fehler wirft und sich selbst benennt. So muss ein Test nur das bereitstellen, worauf der Hook tatsächlich zugreift.

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

Ein Hook, der über `context.data` liest oder schreibt, benötigt einen Treiber: Übergeben Sie `createCallContext({ data: buildSdkData(driver) })`, mit `buildSdkData` aus `@rebasepro/common` und einem beliebigen `DataDriver`, einschließlich eines In-Memory-Treibers. `user` bleibt abwesend, es sei denn, Sie übergeben es, genau wie bei einem Schreibvorgang ohne Aufrufer, sodass ein `if (context.user)`-Zweig wahrheitsgetreu getestet wird. Um Hooks stattdessen gegen eine echte Datenbank auszuführen, siehe [Skripte und die Konsole](/docs/backend/scripts/).

## Vollständige Context-Referenz

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

Fragen Sie Daten über `context.data` ab. `context.client` hat kein `data`: Auf der Serverseite ist es das `rebase`-Singleton, dessen einzige Datenebene das admin-bezogene `dataAsAdmin` ist, sodass `context.client.data` ein Compile-Fehler ist. Um ein solches Objekt für einen Test zu erstellen, siehe [Einen Callback testen](#einen-callback-testen).

## Nächste Schritte

- **[Sicherheitsregeln](/docs/collections/security-rules)** — Row Level Security
- **[Entitätshistorie](/docs/backend/history)** — Audit-Trail
- **[Benutzerdefinierte Funktionen](/docs/backend/custom-functions)** — Benutzerdefinierte API-Endpunkte hinzufügen
