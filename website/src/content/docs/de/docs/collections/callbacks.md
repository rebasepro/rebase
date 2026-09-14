---
sourceHash: 13eea3897cdb7bee
title: Entity-Callbacks
sidebar_label: Callbacks
description: Nutzen Sie Lebenszyklus-Callbacks, um benutzerdefinierte Logik auszuführen, wenn Entitäten erstellt, aktualisiert, gelesen oder gelöscht werden. Beinhaltet die context.data-API für sammlungsübergreifende Operationen.
---

## Übersicht

Mit Callbacks können Sie sich in den Lebenszyklus von Entitäten einklinken, um:

- **Daten zwischen Sammlungen zu synchronisieren** — Entitäten bei Statusänderungen über Tabellen hinweg kopieren oder verschieben
- **Daten vor dem Speichern zu transformieren** (berechnete Felder, Slug-Generierung)
- Geschäftsregeln über die Schema-Validierung hinaus zu **validieren**
- **Nebeneffekte nach Schreibvorgängen auszulösen** (E-Mails senden, APIs synchronisieren, Caches aktualisieren)
- Daten nach dem Lesen zu **filtern/transformieren**
- **Operationen zu kaskadieren** — zugehörige Datensätze beim Löschen bereinigen

## Wo Callbacks ausgeführt werden

Eine Sammlung verfügt über zwei Callback-Blöcke, und der einzige Unterschied besteht darin, welche Laufzeitumgebung sie ausführt.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Wird ausgeführt auf | dem Server | dem Admin-Panel, im Browser |
| Wird ausgelöst für | REST, das SDK, Realtime, `dataAsAdmin` | Lese- und Schreibvorgänge, die das Panel durchführt |
| Erreicht den Browser | nein — Funktionsrümpfe werden aus dem Bundle entfernt | ja, vollständig |
| Verwendung für | alles Nachfolgende | Sammlungen, mit denen das Panel direkt kommuniziert |

**`callbacks` ist der Block, den Sie verwenden möchten.** Er wird auf jedem Pfad ausgeführt, der den Server erreicht, sodass nichts an ihm vorbeigeleitet werden kann, und sein Code verlässt niemals die Maschine — ein API-Schlüssel oder das Auslesen von `process.env` ist dort sicher. Der Rest dieser Seite bezieht sich auf `callbacks`.

`admin.browserCallbacks` existiert für einen bestimmten Fall: eine Sammlung über ein `direct`- oder `custom`-Transportprotokoll, die das Panel *selbst* liest und schreibt, ohne dass sich ein Rebase-Server im Anfragepfad befindet. Auf Serverseite bekommt nichts diese Operationen mit, weshalb `callbacks` für sie niemals ausgelöst werden kann; dieser Block ist der einzige Ort, an dem ihre Lebenszykluslogik liegen kann.

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

Aus der Tatsache, dass Code „an jeden Besucher ausgeliefert wird“, folgen zwei Regeln, und keine davon ist bloße Stilfrage:

1. **Keine Secrets.** Keine API-Schlüssel, kein `process.env`, nichts, von dem Sie nicht möchten, dass es jemand im Bundle einsehen kann. Das gehört in `callbacks`.
2. **Es ist keine Sicherheitsgrenze.** Ein `browserCallbacks.afterRead`, das ein Feld unkenntlich macht (redigiert), tut dies *nachdem* der Browser die Zeile bereits erhalten hat — bei einem direkten Transport kam das rohe Dokument direkt aus dem Datenspeicher. Es dient rein der Darstellung. Zensierung bzw. Zugriffsbeschränkungen, die verbindlich sein müssen, gehören in `callbacks` oder in die eigenen Regeln des Datenspeichers.

Bei einer Sammlung mit Server-Transport — dem Standardfall und fast sicher auch Ihrem — hat der Server `callbacks` bereits ausgeführt, bevor die Zeile das Panel erreicht, sodass ein `browserCallbacks.afterRead` *zusätzlich* dazu läuft. Schreiben Sie es idempotent, oder schreiben Sie es gar nicht.

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

### `beforeSave`

Wird aufgerufen, bevor ein Datensatz in die Datenbank geschrieben wird. Gibt die modifizierten Werte zurück.

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

Werfen Sie einen Fehler, um **den Speichervorgang zu blockieren**. Der Schreibvorgang erreicht die Datenbank niemals, und der Aufrufer erhält den Status **400** mit Ihrer Nachricht und dem Code `CALLBACK_REJECTED`:

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

Um den Status und den Code selbst festzulegen — ein 409 bei einem Konflikt, ein 422 für etwas Wohlgeformtes, aber Unzulässiges — werfen Sie einen `RebaseApiError`:

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
Importieren Sie diesen aus `@rebasepro/types`, nicht aus `@rebasepro/server`. Eine Sammlungsdatei wird mit dem Frontend geteilt — der Vite-Build des Admin-Panels liest dasselbe Verzeichnis —, daher darf sie nur Pakete importieren, die im Browser lauffähig sind. `RebaseApiError` ist die browser-sichere Variante und dieselbe Klasse, die auch das Client-SDK wirft.
:::

### `afterSave`

Wird aufgerufen, nachdem die Zeile geschrieben wurde und vor dem Commit, innerhalb derselben Transaktion. Ein Fehler (Throw) rollt den Speichervorgang zurück — siehe [Transaktionssemantik](#transaktionssemantik).

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

Wird nach dem Lesen von Entitäten aus der Datenbank aufgerufen. Dient der Transformation der Daten für die Anzeige.

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

Wird aufgerufen, nachdem die Zeile gelöscht wurde und vor dem Commit, innerhalb derselben Transaktion. Ein Fehler rollt das Löschen zurück.

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

## Eigenschafts-Callbacks

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

Jeder Callback erhält ein `context`-Objekt, das `context.data` enthält — eine einheitliche Datenzugriffsschicht zur Durchführung von **sammlungsübergreifenden Operationen** aus Lebenszyklus-Hooks heraus.

### Auf Sammlungen zugreifen

`context.data` verwendet einen JavaScript-Proxy, sodass Sie über den Slug als Eigenschaft auf jede Sammlung zugreifen können:

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

Jeder Sammlungs-Accessor (`context.data.<slug>`) stellt die folgenden Methoden bereit:

| Methode | Signatur | Beschreibung |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Entitäten mit Filtern, Sortierung und Paginierung abfragen |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Eine einzelne Entität anhand der ID abrufen |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Eine neue Entität erstellen |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Eine bestehende Entität aktualisieren |
| `.delete()` | `delete(id: string \| number) → void` | Einen Datensatz löschen |
| `.count()` | `count(params?: FindParams) → number` | Übereinstimmende Entitäten zählen |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Echtzeit-Abonnement (wo unterstützt) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Eine einzelne Entität überwachen |

### Abfragen mit `.find()`

Die Methode `find()` unterstützt umfassende Filterfunktionen:

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
**`context.data` erbt die Berechtigungen der Operation, die den Callback ausgelöst hat.** Es handelt sich nicht um eine feste Vertrauensstufe.

- Ausgelöst durch eine **Benutzeranfrage** (REST, Realtime, eine Bearbeitung im Admin-Panel) → **benutzerbezogener Gültigkeitsbereich (User-scoped)**. Der Callback läuft innerhalb der RLS-gebundenen Transaktion, die für diese Anfrage geöffnet wurde, sodass Richtlinien für Lese- *und* Schreibvorgänge gelten. Ein Callback kann keine Zeile sehen, die sein Aufrufer nicht sehen durfte.
- Ausgelöst durch **`rebase.dataAsAdmin` oder einen Cronjob** (dasselbe Singleton) → **adminbezogener Gültigkeitsbereich (Admin-scoped)**, nicht unbeschränkt. Dieser Treiber hat den Scope `{ uid: "service", roles: ["admin"] }`, sodass der Callback weiterhin in einer RLS-gebundenen Transaktion läuft — Ihre Richtlinien werden anhand dieser Identität ausgewertet.
- Ausgelöst durch den **Basis-Treiber** (integrierte Authentifizierungsabläufe, Migrationen) → **ohne Gültigkeitsbereich (unscoped)**. Er läuft über die Verbindung des Eigentümers und umgeht RLS.
:::

Dies ist vor allem in der Richtung von Bedeutung, die still fehlschlägt. RLS *filtert*, es wirft keine Fehler — ein Callback, der eine Geschwisterzeile liest, findet diese also bei einem Speichervorgang durch einen Admin-Task, findet aber möglicherweise nichts, wenn ein Endbenutzer speichert, ohne dass in beiden Fällen ein Fehler auftritt. Schreiben Sie Callbacks so, dass sie ein leeres Ergebnis tolerieren, oder greifen Sie gezielt auf die Admin-Ebene zurück:

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

:::caution[Auf dieser Seite stand zuvor das Gegenteil]
Frühere Versionen dieser Seite besagten, dass Callbacks RLS immer umgehen und „vollen Datenbankzugriff unabhängig von den Berechtigungen des auslösenden Benutzers“ haben. Das war falsch, und zwar in unsicherer Hinsicht — es verleitete dazu, Callbacks in der Annahme zu schreiben, sie könnten immer alles sehen.

Das oben beschriebene Verhalten ist für Postgres durch den Testfall `"scopes context.data to the caller when a callback runs on a user request"` in der RLS-Durchsetzungssuite von `@rebasepro/server-postgres` durchgehend verifiziert.
:::

### Transaktionssemantik

:::important
**Die Schreibvorgänge über `context.data` eines Callbacks sind Teil des Schreibvorgangs, der ihn ausgelöst hat.** Bei Postgres laufen `beforeSave`, das Speichern und `afterSave` — bzw. `beforeDelete`, das Löschen und `afterDelete` — innerhalb einer einzigen Transaktion. Jeder Callback wird vor dem Commit abgewartet, und `context.data` schreibt über dieselbe Transaktion.
:::

Daher werden der auslösende Schreibvorgang und alles, was seine Callbacks geschrieben haben, zusammen festgeschrieben (committed) oder gar nicht:

- Ein Fehler (Throw) aus `afterSave` oder `afterDelete` rollt den auslösenden Schreibvorgang zusammen mit jedem Schreibvorgang zurück, den die Callbacks über `context.data` getätigt haben. Der Aufrufer erhält die Antwort **400 `CALLBACK_REJECTED`**, wobei `details.stage` den Hook benennt — oder den eigenen Status des Fehlers, wenn dieser einen trägt: ein von Ihnen geworfener `RebaseApiError`, der 409-Code einer Eindeutigkeitsverletzung usw.
- Realtime-Abonnenten erfahren erst nach dem Commit von der Zeile; ein zurückgerollter Schreibvorgang wird also niemals angekündigt.
- Ein Callback hält die Transaktion während seiner Ausführung offen. Ein langsamer Callback blockiert somit Sperren und bindet eine Verbindung aus dem Verbindungspool.

Lassen Sie einen Fehler werfen, wenn der auslösende Schreibvorgang diesen nicht überleben soll. Fangen Sie ihn ab, wenn er überleben soll: Der fehlgeschlagene Schreibvorgang wird isoliert rückgängig gemacht, und der Rest wird festgeschrieben.

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

Arbeiten, die die Datenbank verlassen müssen — eine E-Mail, ein Webhook, ein Aufruf einer Drittanbieter-API —, gehören nicht in den Funktionsrumpf des Callbacks. Sie würden die Transaktion für einen Netzwerk-Roundtrip offenhalten, und nichts kann sie zurücknehmen, wenn der Schreibvorgang zurückgerollt wird. Reihen Sie dafür einen [Job](/docs/backend/jobs) in die Warteschlange ein oder führen Sie dies aus, nachdem der Schreibvorgang zurückgekehrt ist: Veröffentlichen Sie auf einem [Realtime-Kanal](/docs/backend/realtime) oder verwenden Sie `waitUntil` in einer [benutzerdefinierten Funktion](/docs/backend/custom-functions). Im Abschnitt [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) erfahren Sie, was sich am besten eignet.

Bei MongoDB gilt dies alles nicht. Dieser Treiber führt dieselben Callbacks ohne Transaktion aus, sodass der Schreibvorgang bereits gespeichert ist, wenn `afterSave` läuft, und ein dortiger Fehler den Fehlschlag zwar meldet, ihn aber nicht rückgängig macht.

## Daten zwischen Sammlungen synchronisieren

Eine der mächtigsten Einsatzmöglichkeiten von Callbacks ist die **Synchronisierung von Daten über Sammlungen hinweg** mittels `context.data`:

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

- **Kaskadierendes Löschen**: Verwenden Sie `afterDelete`, um zugehörige Datensätze in untergeordneten Sammlungen zu entfernen
- **Denormalisierung**: Verwenden Sie `afterSave`, um Zusammenfassungsfelder in einer übergeordneten Sammlung zu aktualisieren
- **Audit-Logging**: Verwenden Sie `afterSave` / `afterDelete`, um in eine Audit-Log-Sammlung zu schreiben
- **Zähler**: Verwenden Sie `afterSave` / `afterDelete`, um Zählerfelder bei zugehörigen Entitäten zu aktualisieren

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

Führen Sie Abfragen über `context.data` aus. `context.client` besitzt kein `data`: Serverseitig ist es das `rebase`-Singleton, dessen einzige Datenebene das adminbezogene `dataAsAdmin` ist; `context.client.data` führt daher zu einem Kompilierungsfehler.

## Nächste Schritte

- **[Sicherheitsregeln](/docs/collections/security-rules)** — Row-Level Security
- **[Entitätsverlauf](/docs/backend/history)** — Audit-Trail
- **[Benutzerdefinierte Funktionen](/docs/backend/custom-functions)** — Benutzerdefinierte API-Endpunkte hinzufügen
