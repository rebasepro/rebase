---
sourceHash: 3885c8f3dc44eb65
title: Entity-Callbacks
sidebar_label: Callbacks
description: Verwenden Sie Lifecycle-Callbacks, um benutzerdefinierte Logik auszuführen, wenn Entitäten erstellt, aktualisiert, gelesen oder gelöscht werden. Beinhaltet die context.data-API für collections-übergreifende Operationen.
---

## Übersicht

Mit Callbacks können Sie sich in den Entitäts-Lifecycle einklinken, um:

- **Daten zwischen Collections zu synchronisieren** — Entitäten bei Statusänderungen über Tabellen hinweg kopieren oder verschieben
- **Daten vor dem Speichern zu transformieren** (berechnete Felder, Slug-Erstellung)
- Geschäftsregeln über die Schemavalidierung hinaus zu **validieren**
- **Nebeneffekte nach Schreibvorgängen auszulösen** (E-Mails senden, APIs synchronisieren, Caches aktualisieren)
- **Einen Lesevorgang vor dem Kompilieren einzugrenzen**, sodass ein Aufrufer immer nur seine eigenen Zeilen sieht
- Daten nach dem Lesen zu **filtern/transformieren**
- **Kaskadierende Operationen auszuführen** — zugehörige Datensätze beim Löschen bereinigen

## Wo Callbacks ausgeführt werden

Eine Collection verfügt über zwei Callback-Blöcke, und der einzige Unterschied besteht darin, welche Runtime sie ausführt.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Wird ausgeführt auf | dem Server | dem Admin-Panel, im Browser |
| Wird ausgelöst bei | REST, dem SDK, Realtime, `dataAsAdmin` | Lese- und Schreibvorgängen des Panels |
| Erreicht den Browser | nein — Bodies werden aus dem Bundle entfernt | ja, vollständig |
| Verwenden für | alles Nachfolgende | Collections, mit denen das Panel direkt kommuniziert |

**`callbacks` ist das, was Sie benötigen.** Es wird auf jedem Datenpfad ausgeführt, der den Server erreicht — REST, das SDK, Realtime, MCP und `rebase.data` — und sein Body verlässt niemals die Maschine, sodass ein API-Schlüssel oder ein Aufruf von `process.env` dort sicher ist. Der Rest dieser Seite befasst sich mit `callbacks`.

Ein Schreibender ist kein Datenpfad: **das Auth-System**. Registrierung, OAuth-Anmeldung und die Benutzerverwaltung des Admins schreiben die Zeilen der Benutzertabelle (`users`) direkt und führen keine ihrer Callbacks aus; eine Willkommens-E-Mail in `afterSave` auf `users` wird bei der Registrierung daher nie ausgelöst. Hängen Sie dies an die in `auth.hooks` übergebenen [Auth-Hooks](/docs/backend/authentication/) an — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` —, die ein ejected Backend entgegennehmen; beim Booten wird gewarnt, wenn die users-Collection Callbacks deklariert, die bei der Registrierung nicht ausgeführt werden.

`admin.browserCallbacks` existiert für einen einzigen Fall: eine Collection mit einem `direct`- oder `custom`-Transport, die das Panel *selbst* ohne einen Rebase-Server im Request-Pfad liest und schreibt. Auf Serverseite bekommt nichts diese Operationen mit, sodass `callbacks` für sie niemals ausgelöst werden kann — und dieser Block ist der einzige Ort, an dem ihre Lifecycle-Logik liegen kann.

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

1. **Keine Geheimnisse.** Keine API-Schlüssel, kein `process.env`, nichts, von dem Sie nicht möchten, dass ein Leser des Bundles es sieht. Das gehört in `callbacks`.
2. **Es ist keine Sicherheitsgrenze.** Ein `browserCallbacks.afterRead`, das ein Feld schwärzt, tut dies *nachdem* der Browser die Zeile bereits enthält — bei einem direkten Transport kam das Rohdokument direkt aus dem Store. Es ist reine Darstellung. Eine Schwärzung, die verbindlich sein muss, gehört in `callbacks` oder in die eigenen Regeln des Stores.

Bei einer Collection mit Server-Transport — der Standard und höchstwahrscheinlich auch bei Ihnen der Fall — hat der Server `callbacks` bereits ausgeführt, bevor die Zeile das Panel erreicht, sodass ein `browserCallbacks.afterRead` *zusätzlich* dazu ausgeführt wird. Schreiben Sie es so, dass es idempotent ist, oder lassen Sie es ganz weg.

Beiden Blöcken wird dasselbe übergeben: Zeilen, wie der Server sie sendet, ein Datum als ISO-String und ein belongsTo als Fremdschlüsselspalte. Das gilt für jeden Schreibvorgang, den das Panel vornimmt — das Speichern eines Datensatzformulars, eine Inline-Tabellenbearbeitung, `useRowWrites` und ein Schreibvorgang über das browserseitige `context.data` — daher funktioniert ein Callback-Body in beiden Blöcken. Was ein `browserCallbacks.beforeSave` in der von ihm zurückgegebenen Zeile ändert, ist das, was das Formular speichert. Der `context`, den es erhält, ist der des Browsers: sein `data` liest Zeilen auf dieselbe Weise, und ein Schreibvorgang darüber führt auch die `browserCallbacks` der Collection aus, sodass ein Hook, der in seine eigene Collection schreibt, sich selbst erneut ausführt.

Ein `browserCallbacks.afterSave` wird ausgeführt, nachdem der Schreibvorgang gespeichert wurde, und nichts im Browser kann ihn rückgängig machen. Ein Fehler (`throw`) daraus wird als Warnung angezeigt; das Speichern selbst wird als erfolgreich gemeldet, sodass das Formular nicht anbietet, den Datensatz ein zweites Mal zu erstellen.

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

Eine Collection hat ein einzelnes `callbacks`-Objekt. Wenn mehrere Belange jeweils einen Hook beanspruchen, wie etwa Zeitstempel, ein Audit-Trail und ein Mandanten-Scope, schreiben Sie jeden als eigenes Set und kombinieren Sie sie mit `composeCallbacks`:

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

| Hook | Kombination |
|---|---|
| `beforeSave` | Gekettet: Jedes Set sieht die Werte, die das vorherige zurückgegeben hat, flach zusammengeführt (shallow-merged) mit dem, was ihm übergeben wurde |
| `afterRead` | Gekettet: Jedes Set erhält die Zeile, die das vorherige zurückgegeben hat |
| `beforeQuery` | UND-verknüpft: Jedes Set sieht die Query des Aufrufers, und eine Zeile muss jede Eingrenzung erfüllen |
| `beforeDelete` | Jedes `false` legt ein Veto gegen das Löschen ein; jedes Set wird dennoch ausgeführt |
| `afterSave`, `afterDelete` | Werden der Reihe nach ausgeführt und jeweils abgewartet; ein Fehler (`throw`) stoppt die restlichen |
| `afterSaveError` | Werden der Reihe nach ausgeführt; ein Fehler (`throw`) stoppt das nächste Set nicht, und der erste Fehler wird am Ende erneut geworfen |

Ein Hook ist nur dann im Ergebnis enthalten, wenn irgendein Set ihn enthält, und ein `undefined`-Set wird übersprungen. `composeCallbacks` wird auch aus `@rebasepro/server` und `@rebasepro/common` exportiert.

Das Anhängen von Callbacks nach dem Booten mit `backend.setCollectionCallbacks(slug, callbacks)` **ersetzt** die von der Collection deklarierten. Um Ihre eigenen hinzuzufügen, übergeben Sie `composeCallbacks(declared, yours)`.

## Callback-Referenz

### `beforeQuery`

Wird aufgerufen, **bevor ein Lesevorgang kompiliert wird**, um einzugrenzen, welche Zeilen abgefragt werden. Geben Sie Bedingungen zurück, die per UND in die Abfrage eingefügt werden sollen; geben Sie nichts zurück, um keine hinzuzufügen.

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

`afterRead` sieht Zeilen, die bereits abgerufen wurden, sodass es einen Wert schwärzen, aber nicht verhindern kann, dass die Zeile gelesen wird. Dies hier läuft früher, und drei Dinge darüber sind wichtig zu wissen:

- **Es kann nur eingrenzen.** Der Rückgabewert ist ein Filter, der per UND verknüpft wird, und kein möglicher Rückgabewert kann den Lesevorgang erweitern. `filter` akzeptiert dieselben Feldfilter wie eine Abfrage; `logical` akzeptiert eine `or`/`and`-Gruppe für einen Scope wie „meine oder mit mir geteilte“ — immer noch als Ganzes per UND verknüpft, sodass das `or` immer nur unter Zeilen auswählt, die der Rest der Abfrage bereits zulässt.
- **Es wird auf jedem Lesepfad ausgelöst.** Beim Auflisten, beim einzelnen Abruf, beim Zählen, beim Aggregieren, bei der Suche, beim Vektor-Lesen, beim Auflisten verschachtelter Pfade, beim Realtime-Refetch hinter einem `.listen()` und bei den für eine Relation oder ein `?include=` geladenen Zeilen — wobei hier der Hook der **Ziel-Collection** greift, da dies die Zeilen des Ziels sind.
- **Ein Filter, der nicht kompiliert werden kann, lehnt die Anfrage ab.** Das Benennen einer Spalte, die die Tabelle nicht besitzt, führt zu einem 400-Fehler, niemals zu einer verworfenen Bedingung.
- **Ein Schreibvorgang auf eine Zeile, die es ausschließt, ist ein 404.** Eine Aktualisierung oder Löschung, die sich an eine Zeile außerhalb des Scopes richtet, wird vor dem Schreibvorgang mit derselben „keine Zeile …“-Antwort abgelehnt, die ein Lesevorgang liefert — ein Scope ist also auch ein Scope für Schreibvorgänge, nicht nur für Lesevorgänge. Ein Schreibvorgang für eine 1:n-Zugehörigkeit (`comments: [ids]` bei einem Beitrag) belässt ein Child, das der Scope des Ziels verbirgt, dort, wo es ist, da es eine ID hinterlässt, die keine Zeile benennt. Was es *nicht* kontrolliert, sind die geschriebenen Werte: Das Ablehnen eines Schreibvorgangs anhand seiner Inhalte ist Aufgabe von `beforeSave`.

Ein Lesevorgang wird bewusst nicht eingegrenzt: die Eindeutigkeitsprüfung hinter `validation: { unique: true }`. Sie prüft, ob ein Wert irgendwo in der Tabelle existiert, und eingegrenzt würde sie für einen Wert, den eine verborgene Zeile bereits enthält, „eindeutig“ melden.

:::caution[Vorerst nur Postgres]
`beforeQuery` wird von `@rebasepro/server-postgres` implementiert. Eine von MongoDB oder Firestore bereitgestellte Collection, die einen solchen Callback deklariert, **schlägt beim Booten fehl** (namentlich benannt), anstatt bereitgestellt zu werden, während der Hook stillschweigend inaktiv bleibt — was bei einem Zeilenfilter bedeuten würde, dass jede Zeile an jeden ausgeliefert wird. Ein [globaler](/docs/backend/hooks) `beforeQuery`-Hook schlägt beim Booten auf dieselbe Weise fehl, wenn eine Datenquelle nicht Postgres ist, und ebenso verhält es sich mit einem Hook, der später über `setCollectionCallbacks` angehängt wird. Eine Schwärzung, die auf jeder Engine funktioniert, ist [`afterRead`](#afterread).
:::

→ [Server erweitern](/docs/backend/extending#2-collection-callbacks), um zu erfahren, wie sich dies in die anderen Optionen einordnet.

### `beforeSave`

Wird aufgerufen, bevor ein Datensatz in die Datenbank geschrieben wird. Geben Sie die geänderten Werte zurück. Unter Postgres wird dies innerhalb der Transaktion des Schreibvorgangs ausgeführt, die bereits begonnen hat, sodass eine gepoolte Verbindung für die gesamte Ausführungsdauer belegt wird — siehe [Ein Callback belegt eine Verbindung](/docs/collections/context-data-api#a-callback-holds-a-connection).

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

Werfen Sie einen Fehler, um **das Speichern zu blockieren**. Der Schreibvorgang erreicht die Datenbank nie, und der Aufrufer erhält einen **400**-Fehler mit Ihrer Nachricht und dem Code `CALLBACK_REJECTED`:

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

Um Status und Code selbst zu wählen — eine 409 bei einem Konflikt, eine 422 für etwas Wohlgeformtes, aber Unzulässiges —, werfen Sie einen `RebaseApiError`:

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
Importieren Sie dies aus `@rebasepro/types`, nicht aus `@rebasepro/server`. Eine Collection-Datei wird mit dem Frontend geteilt — der Vite-Build des Admin-Panels liest dasselbe Verzeichnis —, daher darf sie nur Pakete importieren, die im Browser laufen. `RebaseApiError` ist die browsersichere Variante und dieselbe Klasse, die auch das typisierte SDK wirft.
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

Wird aufgerufen, wenn eine Speicheroperation fehlschlägt.

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

Dies wird bei einem Speichervorgang ausgeführt, der in der Datenbank oder danach fehlgeschlagen ist — nicht bei einer Verweigerung in `beforeSave`, einer vor dem Schreibvorgang abgelehnten Anfrage (Validierung, fehlende Berechtigung, ein 404) oder einem nach Rückgabe des Speichervorgangs abgelehnten Commit ([vollständige Liste](/docs/backend/hooks/#when-aftersaveerror-runs)).

Bei einer Anfrage wird es ausgeführt, sobald die Transaktion des fehlgeschlagenen Schreibvorgangs zurückgerollt wurde, nicht darin. Sein `context.data` ist eine frische Instanz für denselben Aufrufer, bei der jeder Aufruf eine eigene Transaktion darstellt; ein eingereihte(r) [Job](/docs/backend/jobs), Warteschlangen-Nachricht oder Webhook wird daher committet und übersteht den gemeldeten Fehler. Ein Fehler (`throw`) aus `afterSaveError` wird protokolliert, und der Aufrufer erhält weiterhin den ursprünglichen Fehler des Speichervorgangs.

### `afterRead`

Wird nach dem Lesen von Entitäten aus der Datenbank aufgerufen. Transformieren Sie die Daten für die Anzeige.

Es formt das, was ein Aufrufer empfängt — die Antwort eines Lese- oder Schreibvorgangs und dessen Realtime-Frame — und sonst nichts: `afterSave`, `beforeDelete`, `afterDelete` und die [Historie](/docs/backend/history) erhalten die Zeile wie gespeichert. Ein hier maskierter Wert ist niemals das, was ein Audit aufzeichnet oder ein Revert zurückschreibt, und ein hier hinzugefügtes Feld wird niemals geschrieben.

Ein Aggregat gibt Summen und Anzahlen zurück, keine Zeilen, und kann daher `afterRead` nicht durchlaufen. Bei einer Collection, für die dies gilt, wird nur `count()` ohne `groupBy` verarbeitet; jede andere [Aggregation](/docs/sdk/aggregates-and-search/#aggregates) wird mit `400 AGGREGATE_MASKED_BY_AFTER_READ` abgelehnt.

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

Wird aufgerufen, nachdem die Zeile gelöscht wurde und vor dem Commit, innerhalb derselben Transaktion. Ein Fehler (`throw`) rollt die Löschung zurück.

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

Jeder Callback erhält außerdem `context.data`, eine Datenschicht zum Lesen und Schreiben anderer Collections aus dem Hook heraus — siehe [Die `context.data`-API](/docs/collections/context-data-api).

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

Weitere collections-übergreifende Muster:

- **Kaskadierendes Löschen**: Verwenden Sie `afterDelete`, um zugehörige Datensätze in untergeordneten Collections zu entfernen
- **Denormalisierung**: Verwenden Sie `afterSave`, um Übersichtsfelder in einer übergeordneten Collection zu aktualisieren
- **Audit-Protokollierung**: Verwenden Sie `afterSave` / `afterDelete`, um in eine Audit-Log-Collection zu schreiben
- **Zähler**: Verwenden Sie `afterSave` / `afterDelete`, um Zählerfelder bei zugehörigen Entitäten zu aktualisieren

## Einen Callback testen

Ein Callback ist eine einfache Funktion mit einem einzelnen Props-Objekt, sodass ein Unit-Test ihn direkt aufrufen kann. `createCallContext` erstellt die `context`-Prop: Die übergebenen Felder werden so verwendet, wie sie sind, und alle weggelassenen Felder sind Platzhalter, die bei der ersten Verwendung einen Fehler werfen und sich selbst benennen, sodass ein Test nur das bereitstellen muss, was der Hook tatsächlich anfasst.

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

Ein Hook, der über `context.data` liest oder schreibt, benötigt einen Treiber: Übergeben Sie `createCallContext({ data: buildSdkData(driver) })`, mit `buildSdkData` aus `@rebasepro/common` und einem beliebigen `DataDriver`, einschließlich einer In-Memory-Variante. `user` bleibt abwesend, es sei denn, Sie übergeben es (wie bei einem Schreibvorgang ohne Aufrufer), sodass eine `if (context.user)`-Verzweigung unverfälscht getestet wird. Um Hooks stattdessen gegen eine echte Datenbank auszuführen, siehe [Skripte und die Konsole](/docs/backend/scripts/).

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

Führen Sie Abfragen über `context.data` aus. `context.client` besitzt kein `data`: Auf Serverseite ist es das `rebase`-Singleton, dessen einzige Datenebene das Admin-bezogene `dataAsAdmin` ist, weshalb `context.client.data` ein Kompilierungsfehler ist. Um ein solches Objekt für einen Test zu erstellen, siehe [Einen Callback testen](#einen-callback-testen).

## Nächste Schritte

- **[Sicherheitsregeln](/docs/collections/security-rules)** — Row Level Security
- **[Entitätshistorie](/docs/backend/history)** — Audit-Trail
- **[Benutzerdefinierte Funktionen](/docs/backend/custom-functions)** — Eigene API-Endpunkte hinzufügen
