---
title: Entitäts-Callbacks
sidebar_label: Callbacks
description: Verwenden Sie Lebenszyklus-Callbacks, um benutzerdefinierte Logik auszuführen, wenn Entitäten erstellt, aktualisiert, gelesen oder gelöscht werden. Beinhaltet die context.data API für sammlungsübergreifende Operationen.
---

## Übersicht

Callbacks ermöglichen es Ihnen, sich in den Entitätslebenszyklus einzuhängen, um:

- **Daten zwischen Sammlungen synchronisieren** — Entitäten bei Statusänderungen über Tabellen hinweg kopieren oder verschieben
- **Daten transformieren** vor dem Speichern (berechnete Felder, Slug-Erstellung)
- **Geschäftsregeln validieren** über die Schema-Validierung hinaus
- **Nebeneffekte auslösen** nach Schreibvorgängen (E-Mails senden, APIs synchronisieren, Caches aktualisieren)
- **Daten filtern/transformieren** nach dem Lesen
- **Kaskadenoperationen** — verwandte Datensätze beim Löschen bereinigen

## Wo Callbacks laufen

Eine Collection hat zwei Callback-Blöcke, und der einzige Unterschied ist, welche Laufzeitumgebung sie ausführt.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Läuft auf | dem Server | dem Admin-Panel, im Browser |
| Feuert für | REST, das SDK, Realtime, `dataAsAdmin` | Lese- und Schreibvorgänge des Panels |
| Erreicht den Browser | nein — die Rümpfe werden aus dem Bundle entfernt | ja, vollständig |
| Verwenden für | alles Folgende | Collections, mit denen das Panel direkt spricht |

**`callbacks` ist der, den du willst.** Er läuft auf jedem Pfad, der den Server
erreicht, also umgeht ihn nichts, und sein Rumpf verlässt die Maschine nie — ein
API-Schlüssel oder ein `process.env`-Zugriff darin ist sicher. Der Rest dieser
Seite handelt von `callbacks`.

`admin.browserCallbacks` gibt es für einen Fall: eine Collection auf einem
`direct`- oder `custom`-Transport, die das Panel *selbst* liest und schreibt,
ohne Rebase-Server im Anfragepfad. Serverseitig sieht nichts diese Operationen,
`callbacks` kann für sie also nie feuern, und dieser Block ist der einzige Ort,
an dem ihre Lebenszyklus-Logik leben kann.

```typescript
import type { CollectionConfig } from "@rebasepro/types";

const eventsCollection: CollectionConfig = {
    slug: "events",
    name: "Events",
    dataSource: "analytics",      // deklariert mit transport: "direct"
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

Zwei Regeln folgen aus „geht an jeden Besucher", und keine davon ist
Geschmackssache:

1. **Keine Geheimnisse.** Keine API-Schlüssel, kein `process.env`, nichts, was
   dich stören würde, wenn jemand es im Bundle liest. Das gehört in `callbacks`.
2. **Es ist keine Sicherheitsgrenze.** Ein `browserCallbacks.afterRead`, das ein
   Feld schwärzt, schwärzt es *nachdem* der Browser die Zeile bereits hat — bei
   einem direkten Transport kam das rohe Dokument direkt aus dem Store. Das ist
   Darstellung. Schwärzung, die halten muss, gehört in `callbacks` oder in die
   Regeln des Stores selbst.

Bei einer Collection mit Server-Transport — der Standard, und mit ziemlicher
Sicherheit deiner — hat der Server `callbacks` bereits ausgeführt, bevor die
Zeile das Panel erreicht, ein `browserCallbacks.afterRead` läuft also
*zusätzlich*. Schreibe es idempotent, oder schreibe es nicht.

## Callbacks definieren

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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

        afterSave: async ({ values, entityId }) => {
            // Send notification
            console.log(`Article ${entityId} saved: ${values.title}`);
        },

        beforeDelete: async ({ entityId }) => {
            // Prevent deletion of published articles
            // Throw to block the deletion
        },

        afterRead: async ({ entity }) => {
            // Transform data after loading
            return entity;
        }
    }
});
```

## Callback-Referenz

### `beforeSave`

Wird aufgerufen, bevor eine Entität in die Datenbank geschrieben wird. Geben Sie die geänderten Werte zurück.

```typescript
beforeSave: async ({
    values,       // Entity values
    entityId,     // Entity ID (null for new entities)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Werfen Sie einen Fehler, um das **Speichern zu blockieren**:

```typescript
beforeSave: async ({ values }) => {
    if (values.price < 0) {
        throw new Error("Price cannot be negative");
    }
    return values;
}
```

### `afterSave`

Wird nach einem erfolgreichen Speichervorgang aufgerufen. Für Nebeneffekte verwenden.

```typescript
afterSave: async ({
    values,         // Saved values
    entityId,       // Entity ID
    previousValues, // Previous values (null for new entities)
    status,         // "new" | "existing" | "copy"
    context
}) => {
    // Send webhook
    await fetch("https://api.slack.com/webhook", {
        method: "POST",
        body: JSON.stringify({ text: `New article: ${values.title}` })
    });
}
```

### `afterSaveError`

Wird aufgerufen, wenn ein Speichervorgang fehlschlägt.

```typescript
afterSaveError: async ({
    values,
    entityId,
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
    entity,    // The entity to transform
    context
}) => {
    // Add computed fields
    return {
        ...entity,
        values: {
            ...entity.values,
            displayName: `${entity.values.first_name} ${entity.values.last_name}`
        }
    };
}
```

### `beforeDelete`

Wird aufgerufen, bevor eine Entität gelöscht wird. Werfen Sie einen Fehler, um das Löschen zu blockieren.

```typescript
beforeDelete: async ({
    entityId,
    entity,
    context
}) => {
    if (entity.values.status === "published") {
        throw new Error("Cannot delete published articles. Unpublish first.");
    }
}
```

### `afterDelete`

Wird nach einem erfolgreichen Löschvorgang aufgerufen.

```typescript
afterDelete: async ({
    entityId,
    entity,
    context
}) => {
    // Cleanup related data
    console.log(`Article ${entityId} deleted`);
}
```

## Eigenschaften-Callbacks

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

## Die `context.data` API

Jeder Callback erhält ein `context`-Objekt, das `context.data` enthält – eine vereinheitlichte Datenschicht für die Durchführung von **sammlungsübergreifenden Operationen** innerhalb von Lebenszyklus-Hooks.

### Auf Sammlungen zugreifen

`context.data` verwendet einen JavaScript Proxy, sodass Sie auf jede Sammlung über ihren Slug als Eigenschaft zugreifen können:

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

Jeder Sammlungs-Accessor (`context.data.<slug>`) bietet diese Methoden:

| Methode | Signatur | Beschreibung |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Entitäten mit Filtern, Sortierung und Paginierung abfragen |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Eine einzelne Entität nach ID abrufen |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Eine neue Entität erstellen |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Eine bestehende Entität aktualisieren |
| `.delete()` | `delete(id: string \| number) → void` | Eine Entität löschen |
| `.count()` | `count(params?: FindParams) → number` | Übereinstimmende Entitäten zählen |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Echtzeit-Abonnement (wo unterstützt) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Einer einzelnen Entität lauschen |

### Abfragen mit `.find()`

Die `find()`-Methode unterstützt umfangreiche Filterung:

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

### Sicherheit: mit welchen Rechten `context.data` läuft

:::important
**`context.data` erbt die Rechte dessen, was den Callback ausgelöst hat.** Es ist keine feste Vertrauensstufe.

- Ausgelöst durch eine **Benutzeranfrage** (REST, Realtime, eine Änderung im Admin-Panel) → **benutzergebunden**. Der Callback läuft in der RLS-gebundenen Transaktion, die für diese Anfrage geöffnet wurde; Richtlinien gelten also für Lese- *und* Schreibvorgänge. Ein Callback kann keine Zeile sehen, die sein Aufrufer nicht sehen konnte.
- Ausgelöst durch **`rebase.dataAsAdmin` oder einen Cron-Job** (dasselbe Singleton) → **admin-gebunden**, nicht ungebunden. Dieser Treiber ist auf `{ uid: "service", roles: ["admin"] }` eingegrenzt, der Callback läuft also weiterhin in einer RLS-gebundenen Transaktion: Ihre Richtlinien werden ausgewertet — gegen diese Identität.
- Ausgelöst durch den **Basis-Treiber** (die eingebauten Auth-Abläufe, Migrationen) → **ungebunden**. Er läuft über die Owner-Verbindung und umgeht RLS.
:::

Das ist vor allem in der Richtung wichtig, die stillschweigend fehlschlägt. RLS *filtert*, es wirft keinen Fehler — ein Callback, der eine benachbarte Zeile liest, findet sie, wenn eine Admin-Aufgabe speichert, und findet möglicherweise nichts, wenn ein Endbenutzer speichert, in beiden Fällen ohne Fehler. Schreiben Sie Callbacks, die ein leeres Ergebnis vertragen, oder greifen Sie bewusst zur Admin-Ebene:

```typescript
afterSave: async ({ context }) => {
    // Benutzergebunden, wenn ein Benutzer diesen Speichervorgang ausgelöst hat:
    // RLS greift.
    await context.data.audit_logs.create({ action: "approved" });

    // Bewusst admin-gebunden — für Arbeit, die der Aufrufer tatsächlich nicht
    // sehen soll, etwa ein Audit-Log, das er weder lesen noch bearbeiten darf.
    // Beachten Sie: das ist die Reichweite eines Admins, kein Umgehen von RLS —
    // eine Collection, deren einzige Regel `policy.serverContext()` ist, bleibt
    // auch dafür verschlossen, denn das kompiliert zu `rebase.uid() IS NULL`, und
    // die uid dieses Accessors ist `service`.
    await context.client.dataAsAdmin.audit_logs.create({ action: "approved" });
}
```

:::caution[Diese Seite behauptete das Gegenteil]
Frühere Fassungen dieser Seite besagten, Callbacks umgingen RLS immer und hätten „vollen Datenbankzugriff unabhängig von den Berechtigungen des auslösenden Benutzers". Das war falsch, und zwar in die unsichere Richtung — es lud dazu ein, Callbacks in der Annahme zu schreiben, sie sähen immer alles.

Das oben beschriebene Verhalten ist end-to-end gegen Postgres verifiziert, durch den Fall `"scopes context.data to the caller when a callback runs on a user request"` in der RLS-Enforcement-Suite von `@rebasepro/server-postgres`.
:::

### Transaktionssemantik

:::warning
**`context.data`-Operationen werden NICHT automatisch in dieselbe Transaktion eingeschlossen wie der auslösende Speichervorgang.**

Der ursprüngliche Entitätsspeichervorgang schließt zuerst seine Datenbanktransaktion ab. Dann läuft `afterSave`, und alle `context.data`-Aufrufe öffnen **separate Transaktionen**. Wenn eine `context.data`-Operation in `afterSave` fehlschlägt, wird der ursprüngliche Speichervorgang **nicht rückgängig gemacht**.
:::

Das bedeutet:

- ✅ Der auslösende Speichervorgang ist immer unabhängig erfolgreich
- ⚠️ Schreibvorgänge mit Nebeneffekten können fehlschlagen, ohne die ursprüngliche Operation zu beeinflussen
- ⚠️ Es gibt keine Atomizitätsgarantie zwischen dem ursprünglichen Speichervorgang und nachfolgenden `context.data`-Aufrufen

Für Operationen, die atomar sein müssen, umwickeln Sie diese mit Fehlerbehandlung:

```typescript
afterSave: async ({ values, entityId, context }) => {
    try {
        await context.data.jobs.create({
            title: values.title,
            status: "published",
        });
    } catch (error) {
        // Den Fehler protokollieren — der ursprüngliche Speichervorgang war bereits erfolgreich
        console.error(`Failed to promote job from submission ${entityId}:`, error);
        // Optional: Die Einreichung als "promotion_failed" markieren
        await context.data["job-submissions"].update(entityId, {
            promotion_status: "failed",
            promotion_error: String(error),
        });
    }
}
```

## Daten zwischen Sammlungen synchronisieren

Eine der mächtigsten Anwendungen von Callbacks ist das **Synchronisieren von Daten über Sammlungen hinweg** mit `context.data`:

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
            // Wenn eine Einreichung genehmigt wird, einen veröffentlichten Job erstellen
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const newJob = await context.data.collection<Record<string, unknown>>("jobs").create({
                    title: values.title,
                    description: values.description,
                    company_id: values.company_id,
                    status: "published",
                    source_submission_id: id,
                });

                // Die Einreichung mit der Referenz des beworbenen Jobs aktualisieren
                await context.data["job-submissions"].update(entityId, {
                    promoted_job_id: newJob.id,
                });
            }
        }
    }
});
```

Andere sammlungsübergreifende Muster:

- **Kaskadierendes Löschen**: Verwenden Sie `afterDelete`, um verknüpfte Datensätze in Kind-Sammlungen zu entfernen
- **Denormalisierung**: Verwenden Sie `afterSave`, um Übersichtsfelder in einer übergeordneten Sammlung zu aktualisieren
- **Audit-Protokollierung**: Verwenden Sie `afterSave` / `afterDelete`, um in eine Audit-Log-Sammlung zu schreiben
- **Zähler**: Verwenden Sie `afterSave` / `afterDelete`, um Zählerfelder in verknüpften Entitäten zu aktualisieren

## Vollständige Kontextreferenz

Jeder Callback erhält ein `context`-Objekt vom Typ `RebaseCallContext`:

```typescript
interface RebaseCallContext {
    /** Der authentifizierte Benutzer, falls vorhanden */
    user?: User;
    /** Der zugrunde liegende Datentreiber (PostgresBackendDriver) */
    driver: DataDriver;
    /** Vereinheitlichter Datenzugriff — context.data.<slug>.create/update/find/delete */
    data: RebaseData;
}
```

## Nächste Schritte

- **[Sicherheitsregeln](/docs/collections/security-rules)** — Zeilenebene Sicherheit
- **[Entitätshistorie](/docs/backend/history)** — Audit-Trail
- **[Benutzerdefinierte Funktionen](/docs/backend/custom-functions)** — Benutzerdefinierte API-Endpunkte hinzufügen
---
