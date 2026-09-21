---
sourceHash: b853df8c5b0b5e4a
title: Entitäts-Callbacks
sidebar_label: Callbacks
description: Nutzen Sie Lifecycle-Callbacks, um benutzerdefinierte Logik auszuführen, wenn Entitäten erstellt, aktualisiert, gelesen oder gelöscht werden. Beinhaltet die context.data-API für kollektionsübergreifende Operationen.
---

## Übersicht

Mit Callbacks können Sie sich in den Entitäts-Lebenszyklus einbinden, um:

- **Daten zwischen Kollektionen zu synchronisieren** — Entitäten bei Statusänderungen tabellenübergreifend kopieren oder verschieben
- **Daten vor dem Speichern zu transformieren** (berechnete Felder, Slug-Generierung)
- Geschäftsregeln jenseits der Schema-Validierung zu **validieren**
- **Nebeneffekte nach Schreibvorgängen auszulösen** (E-Mails senden, APIs synchronisieren, Caches aktualisieren)
- **Einen Lesevorgang einzuschränken**, bevor er kompiliert wird, sodass ein Aufrufer immer nur seine eigenen Zeilen sieht
- Daten nach dem Lesen zu **filtern/transformieren**
- **Kaskadierende Operationen** durchzuführen — verknüpfte Datensätze beim Löschen bereinigen

## Wo Callbacks ausgeführt werden

Eine Kollektion verfügt über zwei Callback-Blöcke, und der einzige Unterschied besteht darin, welche Laufzeitumgebung sie ausführt.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Läuft auf | dem Server | dem Admin-Panel, im Browser |
| Wird ausgelöst für | REST, das SDK, Realtime, `dataAsAdmin` | Lese- und Schreibvorgänge, die das Panel durchführt |
| Erreicht den Browser | nein — Funktionskörper werden aus dem Bundle entfernt | ja, vollständig |
| Verwenden für | alles Nachfolgende | Kollektionen, mit denen das Panel direkt kommuniziert |

**`callbacks` ist der Block, den Sie verwenden möchten.** Er wird auf jedem Pfad ausgeführt, der den Server erreicht, sodass nichts daran vorbeiläuft, und sein Funktionskörper verlässt niemals die Maschine — ein API-Schlüssel oder ein Aufruf von `process.env` ist dort sicher. Der Rest dieser Seite bezieht sich auf `callbacks`.

`admin.browserCallbacks` existiert für einen bestimmten Fall: eine Kollektion über einen `direct`- oder `custom`-Transport, die das Panel *selbst* liest und schreibt, ohne dass sich ein Rebase-Server im Anfragepfad befindet. Nichts auf der Serverseite sieht diese Operationen, daher können `callbacks` für sie niemals ausgelöst werden, und dieser Block ist der einzige Ort, an dem ihre Lifecycle-Logik existieren kann.

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

Aus der Tatsache, dass Code an jeden Besucher ausgeliefert wird, folgen zwei Regeln, und keine davon ist bloße Stilfrage:

1. **Keine Secrets.** Keine API-Schlüssel, kein `process.env`, nichts, von dem Sie nicht möchten, dass ein Leser des Bundles es sieht. Das gehört in `callbacks`.
2. **Es ist keine Sicherheitsgrenze.** Ein `browserCallbacks.afterRead`, das ein Feld unkenntlich macht, tut dies, *nachdem* der Browser die Zeile bereits enthält — bei einem direkten Transport kam das rohe Dokument direkt aus dem Store. Es dient der Darstellung. Schwärzungen bzw. Bereinigungen, die zwingend greifen müssen, gehören in `callbacks` oder in die eigenen Regeln des Stores.

Bei einer Kollektion mit Server-Transport — dem Standardfall und fast sicher auch Ihrem Fall — hat der Server `callbacks` bereits ausgeführt, bevor die Zeile das Panel erreicht, sodass ein `browserCallbacks.afterRead` *zusätzlich* dazu läuft. Schreiben Sie es idempotent, oder schreiben Sie es gar nicht.

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
            // Throw to block the deletion
        },

        afterRead: async ({ row }) => {
            // Transform data after loading
            return row;
        }
    }
});
```

## Callback-Referenz

### `beforeQuery`

<span class="since-badge" data-since="0.22">Seit 0.22</span> Wird aufgerufen, **bevor ein Lesevorgang kompiliert wird**, um einzugrenzen, welche Zeilen angefordert werden. Geben Sie Bedingungen zurück, die mit UND in die Abfrage eingefügt werden; geben Sie nichts zurück, um keine hinzuzufügen.

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

`afterRead` sieht Zeilen, die bereits abgerufen wurden, kann also einen Wert unkenntlich machen, aber nicht verhindern, dass die Zeile gelesen wird. Dies läuft früher ab, und drei Dinge darüber sind wissenswert:

- **Es kann nur einschränken.** Der Rückgabewert ist ein Filter, der per UND verknüpft wird, und kein Wert, den es zurückgeben kann, erweitert den Lesevorgang. `filter` akzeptiert dieselben Feldfilter wie eine Abfrage; `logical` akzeptiert eine `or`/`and`-Gruppe für Scopes wie „meine oder mit mir geteilt“ — immer noch als Ganzes per UND verknüpft, sodass das `or` immer nur unter den Zeilen auswählt, die der Rest der Abfrage ohnehin zulässt.
- **Es wird auf jedem Lesepfad ausgelöst.** Bei Listenabfragen, beim einzelnen Abruf (Get), bei Count, Aggregationen, der Suche, Vektor-Lesevorgängen, verschachtelten Pfadauflistungen, dem Realtime-Refetch hinter einem `.listen()` sowie bei Zeilen, die für eine Relation oder ein `?include=` geladen werden — wobei hier der Hook der **Ziel**-Kollektion greift, da dies die Zeilen des Ziels sind.
- **Ein Filter, der nicht kompiliert werden kann, weist die Anfrage ab.** Die Angabe einer Spalte, die die Tabelle nicht besitzt, führt zu einem 400-Fehler, niemals zu einer verworfenen Bedingung.

Ein Lesevorgang wird bewusst nicht eingeschränkt: die Eindeutigkeitsprüfung (Uniqueness Check) hinter `validation: { unique: true }`. Sie prüft, ob ein Wert irgendwo in der Tabelle existiert; wäre sie eingeschränkt, würde sie für einen Wert, den eine ausgeblendete Zeile bereits besitzt, mit „eindeutig“ antworten.

:::caution[Vorerst nur Postgres]
`beforeQuery` wird von `@rebasepro/server-postgres` implementiert. Eine Kollektion, die von MongoDB oder Firestore bereitgestellt wird und ein solches deklariert, **schlägt beim Start namentlich fehl**, anstatt mit einem stillschweigend inaktiven Hook betrieben zu werden — was bei einem Zeilenfilter bedeuten würde, dass jede Zeile an jeden ausgeliefert wird. Ein [globaler](/docs/backend/hooks) `beforeQuery` schlägt beim Start auf dieselbe Weise fehl, wenn eine Datenquelle nicht Postgres ist, und ebenso einer, der später mit `setCollectionCallbacks` angehängt wird. Eine Bereinigung/Schwärzung, die auf jeder Engine funktioniert, ist [`afterRead`](#afterread).
:::

→ [Den Server erweitern](/docs/backend/extending#2-collection-callbacks), um zu sehen, wie sich dies in die anderen Optionen einfügt.

### `beforeSave`

Wird aufgerufen, bevor ein Datensatz in die Datenbank geschrieben wird. Geben Sie die geänderten Werte zurück.

```typescript
beforeSave: async ({
    values,       // Entity values
    id,           // Entity ID (null for new entities)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Werfen Sie einen Fehler, um **das Speichern zu blockieren**. Der Schreibvorgang erreicht niemals die Datenbank, und der Aufrufer erhält **400** mit Ihrer Nachricht und dem Code `CALLBACK_REJECTED`:

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

Um den Status und den Code selbst zu wählen — eine 409 bei einem Konflikt, eine 422 für etwas Wohlgeformtes, aber Unzulässiges —, werfen Sie einen `RebaseApiError`:

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
Importieren Sie dies aus `@rebasepro/types`, nicht aus `@rebasepro/server`. Eine Kollektionsdatei wird mit dem Frontend geteilt — der Vite-Build des Admin-Panels liest dasselbe Verzeichnis —, daher darf sie nur Pakete importieren, die im Browser lauffähig sind. `RebaseApiError` ist die browsersichere Variante und dieselbe Klasse, die auch das Client-SDK wirft.
:::

### `afterSave`

Wird aufgerufen, nachdem die Zeile geschrieben wurde und vor dem Commit, innerhalb derselben Transaktion. Ein geworfener Fehler setzt das Speichern zurück — siehe [Transaktionssemantik](#transaction-semantics).

```typescript
afterSave: async ({
    values,         // Saved values
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

### `afterRead`

Wird nach dem Lesen von Entitäten aus der Datenbank aufgerufen. Transformieren Sie die Daten für die Anzeige.

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

Wird aufgerufen, bevor ein Datensatz gelöscht wird. Werfen Sie einen Fehler, um das Löschen zu blockieren.

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

Wird aufgerufen, nachdem die Zeile gelöscht wurde und vor dem Commit, innerhalb derselben Transaktion. Ein geworfener Fehler setzt das Löschen zurück.

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

## Die `context.data`-API

Jeder Callback erhält ein `context`-Objekt, das `context.data` enthält — eine einheitliche Datenzugriffsschicht zur Durchführung von **kollektionsübergreifenden Operationen** aus Lifecycle-Hooks heraus.

### Zugriff auf Kollektionen

`context.data` verwendet einen JavaScript-Proxy, sodass Sie über den Slug als Eigenschaft auf jede Kollektion zugreifen können:

```typescript
afterSave: async ({ values, entityId, context }) => {
    // Dynamic property access — works for any collection slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .collection() method for dynamic slugs
    const collectionName = "jobs";
    const accessor = context.data.collection(collectionName);
}
```

### Verfügbare Methoden

Jeder Kollektions-Accessor (`context.data.<slug>`) stellt diese Methoden bereit:

| Methode | Signatur | Beschreibung |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Entitäten mit Filtern, Sortierung und Paginierung abfragen |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Eine einzelne Entität anhand der ID abrufen |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Eine neue Entität erstellen |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Eine bestehende Entität aktualisieren |
| `.delete()` | `delete(id: string \| number) → void` | Einen Datensatz löschen |
| `.count()` | `count(params?: FindParams) → number` | Passende Entitäten zählen |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Echtzeit-Abonnement (wo unterstützt) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Auf eine einzelne Entität lauschen |

### Abfragen mit `.find()`

Die Methode `find()` unterstützt vielseitige Filtermöglichkeiten:

```typescript
afterSave: async ({ values, context }) => {
    // Simple equality
    const { data: activeJobs } = await context.data.jobs.find({
        where: { status: "published" },
        limit: 10,
        orderBy: ["createdAt", "desc"]
    });

    // PostgREST-style operators
    const { data: recentJobs } = await context.data.jobs.find({
        where: {
            status: "eq.published",
            salary: "gte.50000"
        }
    });

    // Tuple syntax
    const { data: expensiveJobs } = await context.data.jobs.find({
        where: {
            salary: [">=", 100000],
            role: ["in", ["admin", "manager"]]
        }
    });
}
```

### Entitäten erstellen

```typescript
afterSave: async ({ values, entityId, previousValues, context }) => {
    // Promote an approved submission to a published job
    if (values.status === "approved" && previousValues?.status !== "approved") {
        const newJob = await context.data.jobs.create({
            title: values.title,
            description: values.description,
            company_id: values.company_id,
            status: "published",
            source_submission_id: entityId,
        });

        // Link back to the original submission
        await context.data["job-submissions"].update(entityId, {
            promoted_job_id: newJob.id,
        });
    }
}
```

### Sicherheit: Mit welchen Berechtigungen `context.data` ausgeführt wird

:::important
**`context.data` erbt die Berechtigungen des Auslösers des Callbacks.** Es handelt sich nicht um eine feste Vertrauensstufe.

- Ausgelöst durch eine **Benutzeranfrage** (REST, Realtime, eine Bearbeitung im Admin-Panel) → **benutzerbezogen (user-scoped)**. Der Callback läuft innerhalb der RLS-gebundenen Transaktion, die für diese Anfrage geöffnet wurde, sodass Richtlinien für Lese- *und* Schreibvorgänge gelten. Ein Callback kann keine Zeile sehen, die sein Aufrufer nicht sehen konnte.
- Ausgelöst durch **`rebase.dataAsAdmin` oder einen Cron-Job** (dasselbe Singleton) → **adminbezogen (admin-scoped)**, nicht unbeschränkt. Dieser Treiber ist als `{ uid: "service", roles: ["admin"] }` berechtigt, sodass der Callback weiterhin in einer RLS-gebundenen Transaktion ausgeführt wird — Ihre Richtlinien werden gegen diese Identität ausgewertet.
- Ausgelöst durch **den Basis-Treiber** (integrierte Auth-Flows, Migrationen) → **unbeschränkt (unscoped)**. Er läuft über die Owner-Verbindung und umgeht RLS.
:::

Dies ist besonders in jenen Fällen wichtig, die stillschweigend fehlschlagen. RLS *filtert*, es wirft keinen Fehler — ein Callback, der eine Geschwisterzeile liest, wird sie also finden, wenn eine Admin-Aufgabe speichert, findet jedoch möglicherweise nichts, wenn ein Endbenutzer speichert, ohne dass in beiden Fällen ein Fehler auftritt. Schreiben Sie Callbacks so, dass sie ein leeres Ergebnis tolerieren, oder greifen Sie gezielt auf die Admin-Ebene zu:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a collection whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    await context.client.dataAsAdmin.audit_logs.create({ action: "approved" });
}
```

:::caution[Auf dieser Seite stand früher das Gegenteil]
Frühere Versionen dieser Seite gaben an, dass Callbacks RLS immer umgehen und „vollen Datenbankzugriff unabhängig von den Berechtigungen des auslösenden Benutzers“ haben. Das war falsch, und zwar in die unsichere Richtung — es verleitete dazu, Callbacks in der Annahme zu schreiben, dass sie immer alles sehen könnten.

Das oben beschriebene Verhalten wird in der RLS-Enforcement-Suite von `@rebasepro/server-postgres` durch den Testfall `"scopes context.data to the caller when a callback runs on a user request"` End-to-End gegen Postgres überprüft.
:::

### Transaktionssemantik

:::important
**Die `context.data`-Schreibvorgänge eines Callbacks sind Teil des Schreibvorgangs, der ihn ausgelöst hat.** Unter Postgres laufen `beforeSave`, das Speichern und `afterSave` — bzw. `beforeDelete`, das Löschen und `afterDelete` — innerhalb einer einzigen Transaktion; jeder Callback wird vor dem Commit abgewartet, und `context.data` schreibt über dieselbe Transaktion.
:::

Daher werden der auslösende Schreibvorgang und alles, was seine Callbacks geschrieben haben, gemeinsam oder gar nicht committet:

- Ein geworfener Fehler aus `afterSave` oder `afterDelete` setzt den auslösenden Schreibvorgang zusammen mit allen von den Callbacks durchgeführten `context.data`-Schreibvorgängen zurück. Der Aufrufer erhält **400 `CALLBACK_REJECTED`**, wobei `details.stage` den Hook benennt — oder den eigenen Status des Fehlers, falls vorhanden: ein von Ihnen geworfener `RebaseApiError`, die 409 einer Unique-Verletzung.
- Realtime-Abonnenten erfahren erst nach dem Commit von der Zeile, sodass ein zurückgesetzter Schreibvorgang niemals angekündigt wird.
- Ein Callback hält die Transaktion während seiner Ausführung offen; ein langsamer Callback bedeutet daher eine gehaltene Sperre und eine blockierte Verbindung im Connection-Pool.

Lassen Sie einen Fehler werfen, wenn der auslösende Schreibvorgang ihn nicht überstehen soll. Fangen Sie ihn ab, wenn er es soll: Der fehlgeschlagene Schreibvorgang wird für sich allein rückgängig gemacht, und der Rest wird committet.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this collection again, which runs this callback
    // again: act on creates only, or it never stops.
    if (status !== "new") return;
    try {
        await context.data.jobs.create({ title: values.title, status: "published" });
    } catch (error) {
        // Only the failed create is undone. The submission and this marker commit.
        await context.data.job_submissions.update(id, {
            promotion_status: "failed",
            promotion_error: String(error)
        });
    }
}
```

Aufgaben, die die Datenbank verlassen müssen — eine E-Mail, ein Webhook, ein Aufruf einer Drittanbieter-API —, gehören nicht in den Funktionskörper des Callbacks. Sie würden die Transaktion für einen Netzwerk-Roundtrip offenhalten, und nichts kann sie zurücknehmen, wenn der Schreibvorgang zurückgesetzt wird. Stellen Sie dafür einen [Job](/docs/backend/jobs) in die Warteschlange oder führen Sie dies aus, nachdem der Schreibvorgang zurückgekehrt ist: Veröffentlichen Sie auf einem [Realtime-Kanal](/docs/backend/realtime) oder verwenden Sie `waitUntil` in einer [Custom Function](/docs/backend/custom-functions). Unter [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) erfahren Sie, was sich eignet.

Unter MongoDB gilt dies alles nicht. Dieser Treiber führt dieselben Callbacks ohne Transaktion aus, sodass der Schreibvorgang bereits gespeichert ist, wenn `afterSave` ausgeführt wird, und ein dort geworfener Fehler den Fehlschlag meldet, ohne ihn rückgängig zu machen.

## Daten zwischen Kollektionen synchronisieren

Einer der wirkungsvollsten Einsatzzwecke von Callbacks ist das **Synchronisieren von Daten zwischen Kollektionen** mithilfe von `context.data`:

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
- **Audit-Protokollierung**: Verwenden Sie `afterSave` / `afterDelete`, um in eine Audit-Log-Kollektion zu schreiben
- **Zähler**: Verwenden Sie `afterSave` / `afterDelete`, um Zählfelder verknüpfter Entitäten zu aktualisieren

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

Fragen Sie über `context.data` ab. `context.client` besitzt kein `data`: Serverseitig handelt es sich um das `rebase`-Singleton, dessen einzige Datenebene das adminbezogene `dataAsAdmin` ist, sodass `context.client.data` zu einem Kompilierfehler führt.

## Nächste Schritte

- **[Sicherheitsregeln](/docs/collections/security-rules)** — Row Level Security
- **[Entitäts-Historie](/docs/backend/history)** — Audit-Trail
- **[Custom Functions](/docs/backend/custom-functions)** — Benutzerdefinierte API-Endpunkte hinzufügen
