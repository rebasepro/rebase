---
sourceHash: 85df48d51e9e9dd9
title: Entitäts-Callbacks
sidebar_label: Callbacks
description: Nutzen Sie Lifecycle-Callbacks, um benutzerdefinierte Logik auszuführen, wenn Entitäten erstellt, aktualisiert, gelesen oder gelöscht werden. Beinhaltet die context.data-API für kollektionsübergreifende Operationen.
---

## Übersicht

Mit Callbacks können Sie sich in den Entitäts-Lebenszyklus einklinken, um:

- **Daten zwischen Kollektionen zu synchronisieren** — Entitäten bei Statusänderungen über Tabellen hinweg kopieren oder verschieben
- **Daten vor dem Speichern zu transformieren** (berechnete Felder, Slug-Generierung)
- **Geschäftsregeln** über die reine Schema-Validierung hinaus zu **validieren**
- **Nebeneffekte nach Schreibvorgängen auszulösen** (E-Mails senden, APIs synchronisieren, Caches aktualisieren)
- **Einen Lesevorgang vor dem Kompilieren einzuschränken**, sodass ein Aufrufer immer nur seine eigenen Zeilen sieht
- **Daten nach dem Lesen zu filtern/transformieren**
- **Kaskadierende Operationen auszuführen** — zugehörige Datensätze beim Löschen bereinigen

## Wo Callbacks ausgeführt werden

Eine Kollektion verfügt über zwei Callback-Blöcke; der einzige Unterschied besteht darin, welche Runtime sie ausführt.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Wird ausgeführt auf | dem Server | dem Admin-Panel, im Browser |
| Wird ausgelöst für | REST, das SDK, Realtime, `dataAsAdmin` | Lese- und Schreibvorgänge, die das Panel durchführt |
| Erreicht den Browser | nein — Funktionskörper werden aus dem Bundle entfernt | ja, vollständig |
| Verwenden für | alles Nachfolgende | Kollektionen, mit denen das Panel direkt kommuniziert |

**`callbacks` ist der Block, den Sie verwenden sollten.** Er wird auf jedem Datenpfad ausgeführt, der den Server erreicht — REST, das SDK, Realtime, MCP und `rebase.data` —, und sein Code verlässt die Maschine niemals, sodass ein API-Schlüssel oder ein Aufruf von `process.env` dort sicher ist. Der Rest dieser Seite behandelt `callbacks`.

Ein Writer ist kein Datenpfad: **das Auth-System**. Registrierung, OAuth-Anmeldung und die Benutzerverwaltung des Admins schreiben die Users-Zeilen direkt und führen keinen ihrer Callbacks aus, sodass eine Willkommens-E-Mail in `afterSave` auf `users` bei der Registrierung niemals ausgelöst wird. Hängen Sie sie an die [Auth-Hooks](/docs/backend/authentication/) an, die bei `auth.hooks` übergeben werden — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` — wofür ein ejected Backend nötig ist; der Start warnt, wenn die Users-Collection Callbacks deklariert, die bei der Registrierung nicht ausgeführt werden.

`admin.browserCallbacks` existiert für einen bestimmten Fall: eine Kollektion über einen `direct`- oder `custom`-Transport, welche das Panel *selbst* liest und beschreibt, ohne dass sich ein Rebase-Server im Request-Pfad befindet. Da serverseitig nichts von diesen Operationen mitbekommt, kann `callbacks` für sie niemals ausgelöst werden, und dieser Block ist der einzige Ort, an dem ihre Lifecycle-Logik existieren kann.

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

Aus „wird an jeden Besucher ausgeliefert“ ergeben sich zwei Regeln, und keine davon ist stilistischer Natur:

1. **Keine Secrets.** Keine API-Schlüssel, kein `process.env`, nichts, von dem Sie nicht möchten, dass ein Betrachter des Bundles es sieht. Das gehört in `callbacks`.
2. **Es ist keine Sicherheitsgrenze.** Ein `browserCallbacks.afterRead`, das ein Feld unkenntlich macht (redacted), tut dies *nachdem* der Browser die Zeile bereits empfangen hat — bei einem direkten Transport kam das rohe Dokument direkt aus dem Datenspeicher. Es dient der Darstellung. Schwärzungen bzw. Bereinigungen, die zwingend greifen müssen, gehören in `callbacks` oder in die Regeln des Datenspeichers selbst.

Bei einer Kollektion mit Server-Transport — dem Standard und höchstwahrscheinlich auch Ihrem Fall — hat der Server `callbacks` bereits ausgeführt, bevor die Zeile das Panel erreicht, sodass ein `browserCallbacks.afterRead` *zusätzlich* dazu ausgeführt wird. Schreiben Sie es idempotent, oder schreiben Sie es gar nicht.

Ein `browserCallbacks.afterSave` läuft, nachdem der Schreibvorgang gespeichert wurde, und
nichts im Browser kann ihn zurückrollen. Ein Fehler (Throw) daraus wird als Warnung angezeigt;
das Speichern selbst wird als erledigt gemeldet, sodass das Formular nicht anbietet,
den Datensatz ein zweites Mal zu erstellen.

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

Unter 0.24 kombinieren Sie
Sets von Hand.

Eine Collection hat ein einziges `callbacks`-Objekt. Wenn mehrere Belange je einen Hook
wollen, etwa Zeitstempel, ein Audit-Trail und ein Tenant-Scope, schreiben Sie jeden als eigenes Set
und kombinieren Sie sie mit `composeCallbacks`:

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

Die Sets laufen in der angegebenen Reihenfolge, und jeder Hook wird so kombiniert, wie das Backend
seine eigenen [globalen](/docs/backend/hooks), Collection- und Property-Ebenen kombiniert:

| Hook | Kombiniert |
|---|---|
| `beforeSave` | Verkettet: Jedes Set sieht die Werte, die das vorherige zurückgegeben hat, flach über das Übergebene gemergt |
| `afterRead` | Verkettet: Jedes Set erhält die Zeile, die das vorherige zurückgegeben hat |
| `beforeQuery` | Per AND verknüpft: Jedes Set sieht die Abfrage des Aufrufers, und eine Zeile muss jede Einschränkung bestehen |
| `beforeDelete` | Jedes `false` legt sein Veto gegen das Löschen ein; jedes Set läuft dennoch |
| `afterSave`, `afterDelete` | Laufen der Reihe nach, jeweils abgewartet; ein Fehler stoppt den Rest |
| `afterSaveError` | Laufen der Reihe nach; ein Fehler stoppt das nächste Set nicht, und der erste Fehler wird am Ende erneut geworfen |

Ein Hook ist nur dann im Ergebnis, wenn irgendein Set ihn hat, und ein `undefined`-Set wird
übersprungen. `composeCallbacks` wird auch aus `@rebasepro/server` und
`@rebasepro/common` exportiert.

Das Anhängen von Callbacks nach dem Boot mit `backend.setCollectionCallbacks(slug,
callbacks)` **ersetzt** diejenigen, die die Collection deklariert hat. Um Ihre zu ihnen
hinzuzufügen, übergeben Sie `composeCallbacks(declared, yours)`.

## Callback-Referenz

### `beforeQuery`

Wird aufgerufen, **bevor ein Lesevorgang kompiliert wird**, um einzugrenzen, welche Zeilen abgefragt werden. Geben Sie Bedingungen zurück, die per AND mit der Abfrage verknüpft werden; geben Sie nichts zurück, um keine hinzuzufügen.

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

`afterRead` sieht Zeilen, die bereits abgerufen wurden; es kann also einen Wert unkenntlich machen, aber nicht verhindern, dass die Zeile gelesen wird. Dieser Hook wird früher ausgeführt, und drei Dinge darüber sind wichtig zu wissen:

- **Er kann nur einschränken.** Der Rückgabewert ist ein Filter, der per AND verknüpft wird, und kein Wert, den er zurückgeben kann, erweitert den Lesevorgang. `filter` akzeptiert dieselben Feldfilter wie eine Abfrage; `logical` akzeptiert eine `or`/`and`-Gruppe für einen Scope wie „gehört mir oder für mich freigegeben“ — wird dennoch als Ganzes per AND verknüpft, sodass das `or` immer nur unter Zeilen auswählt, die der Rest der Abfrage ohnehin zulässt.
- **Wird bei jedem Lesepfad ausgelöst.** Auflistungen, einzelne Gets, Counts, Aggregationen, Suchen, Vektorabfragen, verschachtelte Pfadauflistungen, das Realtime-Refetch hinter einem `.listen()` und die für eine Relation oder ein `?include=` geladenen Zeilen — wobei hier der Hook der **Zielkollektion** greift, da dies die Zeilen des Ziels sind.
- **Ein Filter, der nicht kompiliert werden kann, weist die Anfrage ab.** Die Angabe einer Spalte, die die Tabelle nicht besitzt, führt zu einem 400-Fehler, niemals zu einer verworfenen Bedingung.
- **Ein Schreibvorgang auf eine ausgeschlossene Zeile ist ein 404-Fehler.** Ein Update oder Delete, das auf eine Zeile außerhalb des Scopes zielt, wird vor dem Schreibvorgang abgelehnt — mit derselben Antwort „keine Zeile …“, die ein Lesevorgang liefert. Ein Scope gilt also auch für Schreibvorgänge, nicht nur für Lesevorgänge. Ein Mitgliedschafts-Schreibvorgang einer Eins-zu-viele-Relation (`comments: [ids]` an einem Post) lässt ein Kind, das der Scope des Ziels ausblendet, unverändert, so wie er auch eine ID unverändert lässt, die keine Zeile benennt. Was er *nicht* regelt, sind die zu schreibenden Werte: Einen Schreibvorgang aufgrund seines Inhalts abzulehnen, ist Aufgabe von `beforeSave`.

Ein Lesevorgang wird bewusst nicht eingeschränkt: die Eindeutigkeitsprüfung hinter `validation: { unique: true }`. Sie prüft, ob ein Wert irgendwo in der Tabelle existiert, und eingeschränkt würde sie für einen Wert, den eine verborgene Zeile bereits besitzt, fälschlicherweise „eindeutig“ zurückgeben.

:::caution[Vorerst nur für Postgres]
`beforeQuery` wird von `@rebasepro/server-postgres` implementiert. Eine Kollektion, die über MongoDB oder Firestore bereitgestellt wird und diesen Hook deklariert, **schlägt beim Start fehl** (unter Nennung des Namens), anstatt stillschweigend mit einem inaktiven Hook ausgeführt zu werden — was bei einem Zeilenfilter bedeuten würde, dass jede Zeile an jeden ausgeliefert wird. Ein [globaler](/docs/backend/hooks) `beforeQuery`-Hook schlägt beim Start auf dieselbe Weise fehl, wenn eine Datenquelle nicht Postgres ist, ebenso wie ein Hook, der später über `setCollectionCallbacks` hinzugefügt wird. Eine Bereinigung, die auf jeder Engine funktioniert, ist [`afterRead`](#afterread).
:::

→ [Server erweitern](/docs/backend/extending#2-collection-callbacks) für Details dazu, wie sich dies in die anderen Optionen einfügt.

### `beforeSave`

Wird aufgerufen, bevor ein Datensatz in die Datenbank geschrieben wird. Gibt die modifizierten Werte zurück.
Unter Postgres läuft er innerhalb der Transaktion des Schreibvorgangs, die bereits begonnen hat, und hält
daher eine Pool-Verbindung, solange er läuft — siehe [Ein Callback hält eine
Verbindung](/docs/collections/context-data-api#a-callback-holds-a-connection).

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

Werfen Sie einen Fehler, um **das Speichern zu blockieren**. Der Schreibvorgang erreicht niemals die Datenbank, und der Aufrufer erhält einen **400**-Fehler mit Ihrer Nachricht und dem Code `CALLBACK_REJECTED`:

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

Um Status und Code selbst zu bestimmen — etwa ein 409 bei einem Konflikt oder ein 422 für etwas Wohlgeformtes, aber Unzulässiges —, werfen Sie einen `RebaseApiError`:

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
Importieren Sie ihn aus `@rebasepro/types`, nicht aus `@rebasepro/server`. Eine Kollektionsdatei wird mit dem Frontend geteilt — der Vite-Build des Admin-Panels liest dasselbe Verzeichnis —, daher darf sie nur Packages importieren, die im Browser lauffähig sind. `RebaseApiError` ist die browsersichere Variante und dieselbe Klasse, die auch das typisierte SDK wirft.
:::

### `afterSave`

Wird aufgerufen, nachdem die Zeile geschrieben wurde und vor dem Commit, innerhalb derselben Transaktion. Ein Fehler (Throw) rollt den Speichervorgang zurück — siehe [Transaktionssemantik](/docs/collections/context-data-api#transaction-semantics).

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

Er wird für einen Speichervorgang ausgeführt, der auf Datenbankebene oder danach fehlgeschlagen ist — nicht für eine `beforeSave`-Ablehnung, eine vor dem Schreibvorgang abgelehnte Anfrage (Validierung, eine fehlende Berechtigung, ein 404) oder einen nach der Rückkehr des Speichervorgangs abgelehnten Commit ([vollständige Liste](/docs/backend/hooks/#when-aftersaveerror-runs)).

Bei einem Request läuft er, sobald die Transaktion des fehlgeschlagenen Schreibvorgangs zurückgerollt wurde, nicht innerhalb dieser. Sein `context.data` ist ein neues für denselben Aufrufer, in dem jeder Aufruf eine eigene Transaktion ist, sodass ein [Job](/docs/backend/jobs), eine Queue-Nachricht oder ein Webhook, den er einreiht, committet wird und den Fehler, den er meldet, überdauert. Ein Fehler (Throw) aus `afterSaveError` wird protokolliert, und der Aufrufer erhält weiterhin den eigenen Fehler des Speichervorgangs.

### `afterRead`

Wird nach dem Lesen von Entitäten aus der Datenbank aufgerufen. Transformieren Sie die Daten für die Anzeige.

Sie formt das, was ein Aufrufer erhält — die Antwort eines Lese- oder Schreibvorgangs sowie dessen Realtime-Frame — und nichts sonst: `afterSave`, `beforeDelete`, `afterDelete` und die [Historie](/docs/backend/history) erhalten die Zeile so, wie sie gespeichert ist: Ein hier maskierter Wert ist nie das, was ein Audit aufzeichnet oder ein Revert zurückschreibt, und ein hier hinzugefügtes Feld wird nie geschrieben.

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

Wird aufgerufen, bevor ein Datensatz gelöscht wird. Werfen Sie einen Fehler, um das Löschen zu blockieren, und der Aufrufer erhält `400 CALLBACK_REJECTED` mit Ihrer Meldung. Auch die Rückgabe von `false` blockiert es, als `403 CALLBACK_REJECTED` ohne Meldung von Ihnen.

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

Wird aufgerufen, nachdem die Zeile gelöscht wurde und vor dem Commit, innerhalb derselben Transaktion. Ein Fehler rollt den Löschvorgang zurück.

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

## Daten zwischen Kollektionen synchronisieren

Eine der leistungsfähigsten Anwendungsmöglichkeiten von Callbacks ist das **Synchronisieren von Daten über Kollektionen hinweg** mithilfe von `context.data`:

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

Weitere kollektionsübergreifende Muster:

- **Kaskadierendes Löschen**: Verwenden Sie `afterDelete`, um zugehörige Datensätze in untergeordneten Kollektionen zu entfernen
- **Denormalisierung**: Verwenden Sie `afterSave`, um Zusammenfassungsfelder in einer übergeordneten Kollektion zu aktualisieren
- **Audit-Logging**: Verwenden Sie `afterSave` / `afterDelete`, um in eine Audit-Log-Kollektion zu schreiben
- **Zähler (Counters)**: Verwenden Sie `afterSave` / `afterDelete`, um Zählerfelder bei zugehörigen Entitäten zu aktualisieren

## Einen Callback testen

Ein Callback ist eine einfache Funktion eines einzigen Props-Objekts, sodass ein Unit-Test sie
aufruft. `createCallContext` baut die `context`-Prop: Die Felder, die Sie übergeben, werden so
verwendet, wie sie sind, und jedes, das Sie weglassen, ist ein Platzhalter, der bei der ersten Verwendung
einen Fehler wirft und sich dabei benennt, sodass ein Test nur das liefert, was der Hook wirklich berührt.

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

Ein Hook, der über `context.data` liest oder schreibt, braucht einen Treiber: Übergeben Sie
`createCallContext({ data: buildSdkData(driver) })`, mit `buildSdkData` aus
`@rebasepro/common` und einem beliebigen `DataDriver`, auch einem In-Memory-Treiber. `user`
bleibt abwesend, wenn Sie ihn nicht übergeben, so wie bei einem Schreibvorgang ohne Aufrufer, sodass ein
`if (context.user)`-Zweig ehrlich getestet wird. Um Hooks stattdessen gegen eine echte
Datenbank auszuführen, siehe [Skripte und die Konsole](/docs/backend/scripts/).

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

Führen Sie Abfragen über `context.data` durch. `context.client` hat kein `data`: Serverseitig handelt es sich um das `rebase`-Singleton, dessen einzige Datenebene das admin-gescopte `dataAsAdmin` ist, sodass `context.client.data` zu einem Kompilierungsfehler führt. Um eines davon für einen Test zu bauen, siehe [Einen Callback testen](#einen-callback-testen).

## Nächste Schritte

- **[Sicherheitsregeln](/docs/collections/security-rules)** — Row Level Security
- **[Entitätshistorie](/docs/backend/history)** — Audit-Trail
- **[Benutzerdefinierte Funktionen](/docs/backend/custom-functions)** — Eigene API-Endpunkte hinzufügen
