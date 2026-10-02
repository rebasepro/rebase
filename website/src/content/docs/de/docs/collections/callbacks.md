---
sourceHash: b3d7ff032778e376
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
- **Ein Schreibvorgang auf eine ausgeschlossene Zeile ist ein 404-Fehler.** Ein Update oder Delete, das auf eine Zeile außerhalb des Scopes zielt, wird vor dem Schreibvorgang abgelehnt — mit derselben Antwort „keine Zeile …“, die ein Lesevorgang liefert. Ein Scope gilt also auch für Schreibvorgänge, nicht nur für Lesevorgänge. Was er *nicht* regelt, sind die zu schreibenden Werte: Einen Schreibvorgang aufgrund seines Inhalts abzulehnen, ist Aufgabe von `beforeSave`.

Ein Lesevorgang wird bewusst nicht eingeschränkt: die Eindeutigkeitsprüfung hinter `validation: { unique: true }`. Sie prüft, ob ein Wert irgendwo in der Tabelle existiert, und eingeschränkt würde sie für einen Wert, den eine verborgene Zeile bereits besitzt, fälschlicherweise „eindeutig“ zurückgeben.

:::caution[Vorerst nur für Postgres]
`beforeQuery` wird von `@rebasepro/server-postgres` implementiert. Eine Kollektion, die über MongoDB oder Firestore bereitgestellt wird und diesen Hook deklariert, **schlägt beim Start fehl** (unter Nennung des Namens), anstatt stillschweigend mit einem inaktiven Hook ausgeführt zu werden — was bei einem Zeilenfilter bedeuten würde, dass jede Zeile an jeden ausgeliefert wird. Ein [globaler](/docs/backend/hooks) `beforeQuery`-Hook schlägt beim Start auf dieselbe Weise fehl, wenn eine Datenquelle nicht Postgres ist, ebenso wie ein Hook, der später über `setCollectionCallbacks` hinzugefügt wird. Eine Bereinigung, die auf jeder Engine funktioniert, ist [`afterRead`](#afterread).
:::

→ [Server erweitern](/docs/backend/extending#2-collection-callbacks) für Details dazu, wie sich dies in die anderen Optionen einfügt.

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

Wird aufgerufen, nachdem die Zeile geschrieben wurde und vor dem Commit, innerhalb derselben Transaktion. Ein Fehler (Throw) rollt den Speichervorgang zurück — siehe [Transaktionssemantik](#transaction-semantics).

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

## Die `context.data`-API

Jeder Callback erhält ein `context`-Objekt, das `context.data` enthält — eine einheitliche Datenzugriffsschicht zur Durchführung von **kollektionsübergreifenden Operationen** innerhalb von Lifecycle-Hooks.

### Zugriff auf Kollektionen

`context.data` verwendet einen JavaScript-Proxy, sodass Sie über den Slug als Eigenschaft auf jede Kollektion zugreifen können:

```typescript
afterSave: async ({ values, id, context }) => {
    // Dynamic property access — works for any collection slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .collection() method for dynamic slugs
    const collectionName = "jobs";
    const accessor = context.data.collection(collectionName);
}
```

### Verfügbare Methoden

Jeder Kollektions-Accessor (`context.data.<slug>`) stellt die folgenden Methoden bereit:

| Methode | Signatur | Beschreibung |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Entitäten mit Filtern, Sortierung und Paginierung abfragen |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Eine einzelne Entität anhand der ID abrufen |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Eine neue Entität erstellen |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Eine bestehende Entität aktualisieren |
| `.delete()` | `delete(id: string \| number) → void` | Einen Datensatz löschen |
| `.count()` | `count(params?: FindParams) → number` | Übereinstimmende Entitäten zählen |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Echtzeit-Abonnement (sofern unterstützt) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Eine einzelne Entität überwachen |

### Abfragen mit `.find()`

Die `find()`-Methode filtert mit `[operator, value]`-Tupeln — der typisierten Form des Query-Strings `?status=eq.published`, den die REST-API liest:

```typescript
afterSave: async ({ values, context }) => {
    // Equality
    const { data: activeJobs } = await context.data.jobs.find({
        where: { status: ["==", "published"] },
        limit: 10,
        orderBy: ["createdAt", "desc"]
    });

    // Several conditions, AND-ed
    const { data: expensiveJobs } = await context.data.jobs.find({
        where: {
            salary: [">=", 100000],
            role: ["in", ["admin", "manager"]]
        }
    });
}
```

### Entitäten erstellen

`.create()` und `.update()` erwarten die zu schreibenden Werte, mit den oben genannten Signaturen. [Daten zwischen Kollektionen synchronisieren](#syncing-data-between-collections) verwendet beide: Eine genehmigte Einreichung erstellt einen veröffentlichten Job und wird mit ihm verknüpft.

### Sicherheit: Mit welchen Berechtigungen `context.data` ausgeführt wird

:::important
**`context.data` erbt die Berechtigungen dessen, was den Callback ausgelöst hat.** Es handelt sich nicht um eine feste Vertrauensstufe.

- Ausgelöst durch eine **Benutzeranfrage** (REST, Realtime, eine Bearbeitung im Admin-Panel) → **User-Scoped**. Der Callback wird innerhalb der RLS-gebundenen Transaktion ausgeführt, die für diese Anfrage geöffnet wurde, sodass Richtlinien für Lese- *und* Schreibvorgänge gelten. Ein Callback kann keine Zeile sehen, die sein Aufrufer nicht sehen konnte.
- Ausgelöst durch **`rebase.dataAsAdmin` oder einen Cron-Job** (dasselbe Singleton) → **Admin-Scoped**, nicht unbeschränkt (unscoped). Dieser Treiber ist als `{ uid: "service", roles: ["admin"] }` definiert, sodass der Callback dennoch in einer RLS-gebundenen Transaktion ausgeführt wird — Ihre Richtlinien werden anhand dieser Identität ausgewertet.
- Ausgelöst durch **den Basistreiber** (integrierte Authentifizierungs-Flows, Migrationen) → **Unscoped**. Er wird über die Owner-Verbindung ausgeführt und umgeht RLS.
:::

Dies ist besonders in jenen Fällen von Bedeutung, die stillschweigend fehlschlagen. RLS *filtert*, es wirft keine Fehler — ein Callback, der eine benachbarte Zeile liest, findet diese also, wenn eine Admin-Aufgabe speichert, findet jedoch möglicherweise nichts, wenn ein Endbenutzer speichert, jeweils ohne Fehlermeldung. Schreiben Sie Callbacks so, dass sie ein leeres Ergebnis tolerieren, oder greifen Sie bewusst auf die Admin-Ebene zu:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a collection whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    // `dataAsAdmin` is always there server-side; its type allows for the
    // browser SDK, which has none — hence the `!`.
    await context.client.dataAsAdmin!.audit_logs.create({ action: "approved" });
}
```

:::caution[`dataAsAdmin` ist eine zweite Verbindung, nicht Teil dieses Schreibvorgangs]
Unter Postgres läuft `context.client.dataAsAdmin` im Callback eines Requests in einer eigenen Transaktion, auf einer anderen Verbindung aus dem Pool, während die Transaktion des auslösenden Schreibvorgangs noch offen ist. Es committet also für sich allein und bleibt bestehen, wenn der Schreibvorgang zurückgerollt wird. Es kann außerdem die gerade gespeicherte Zeile nicht sehen, da sie noch nicht committet ist, und darf sie nicht schreiben:

- Ein Admin-Schreibvorgang mit einem Fremdschlüssel zurück auf diese Zeile (eine `audit_logs.article_id`, die auf `articles` verweist) scheitert an seiner Schlüsselprüfung, und der Schreibvorgang des Aufrufers scheitert mit ihm.
- Ein Admin-Schreibvorgang auf die gerade gespeicherte Zeile oder auf eine beliebige Zeile, die dieser Schreibvorgang gesperrt hat, wartet auf die Sperre des Schreibvorgangs, während der Schreibvorgang auf den Callback wartet. Postgres kann das nicht als Deadlock erkennen, sodass der Request bis zum `statement_timeout` (standardmäßig 30 Sekunden) hängt und dann fehlschlägt.

Für einen Datensatz, der auf die Zeile verweisen muss, schreiben Sie ihn mit `context.data`, das auf der Transaktion des Schreibvorgangs mitläuft, oder reihen Sie einen [Job](/docs/backend/jobs) ein: Ein aus dem Callback eingereihter Job wird mit dem Schreibvorgang committet, und sein Handler läuft nach dem Commit.
:::

:::caution[Diese Seite besagte früher das Gegenteil]
Frühere Versionen dieser Seite gaben an, dass Callbacks RLS immer umgehen und „vollen Datenbankzugriff unabhängig von den Berechtigungen des auslösenden Benutzers“ haben. Das war falsch, und zwar in die unsichere Richtung — es verleitete dazu, Callbacks in der Annahme zu schreiben, dass sie immer alles sehen könnten.

Das obige Verhalten wird durch den Testfall `"scopes context.data to the caller when a callback runs on a user request"` in der RLS-Enforcement-Suite von `@rebasepro/server-postgres` End-to-End gegen Postgres verifiziert.
:::

### Transaktionssemantik

:::important
**`context.data`-Schreibvorgänge eines Callbacks sind Teil des Schreibvorgangs, der ihn ausgelöst hat.** Unter Postgres laufen `beforeSave`, das Speichern und `afterSave` — bzw. `beforeDelete`, das Löschen und `afterDelete` — innerhalb einer einzigen Transaktion. Jeder Callback wird vor dem Commit abgewartet, und `context.data` schreibt über dieselbe Transaktion.
:::

Der auslösende Schreibvorgang und alles, was seine Callbacks geschrieben haben, werden also entweder gemeinsam oder gar nicht committet:

- Ein Fehler (Throw) in `afterSave` oder `afterDelete` rollt den auslösenden Schreibvorgang sowie jeden `context.data`-Schreibvorgang der Callbacks zurück. Der Aufrufer erhält **400 `CALLBACK_REJECTED`** mit `details.stage`, das den jeweiligen Hook benennt — oder den spezifischen Fehlerstatus, falls vorhanden: ein von Ihnen geworfener `RebaseApiError`, der 409-Fehler einer Eindeutigkeitsverletzung.
- Realtime-Abonnenten erfahren erst nach dem Commit von der Zeile; ein zurückgerollter Schreibvorgang wird also niemals angekündigt.
- Ein Callback hält die Transaktion während seiner Ausführung offen. Ein langsamer Callback bedeutet daher eine gehaltene Sperre und eine blockierte Verbindung im Connection-Pool.
- Ein `context.data`-Schreibvorgang führt auch die Callbacks der Zielkollektion aus, sodass ein `afterSave`, das seine eigene Zeile aktualisiert, sich selbst erneut ausführt. <span class="since-badge" data-since="0.24">Seit 0.24</span> Schreibvorgänge, die mehr als 16 Ebenen tief verschachtelt sind, werden mit **500 `CALLBACK_RECURSION`** abgelehnt, unter Angabe des Hooks und der Collection, und der gesamte Schreibvorgang wird zurückgerollt. Machen Sie einen solchen Schreibvorgang bedingt, wie es das Beispiel unten tut.

Lassen Sie einen Fehler werfen, wenn der auslösende Schreibvorgang diesen nicht überstehen soll. Fangen Sie ihn ab, wenn er überstehen soll, aber nur um einen `context.data`-**Schreibvorgang** herum: Ein Create, Update oder Delete, das die Datenbank ablehnt (eine Unique- oder Foreign-Key-Verletzung, ein Trigger), wird isoliert rückgängig gemacht, und der Rest wird committet.

Jede andere Anweisung, die auf der Transaktion des Schreibvorgangs fehlschlägt — eine Abfrage, der Lesevorgang, den ein Update oder Delete zum Auffinden seiner Zeile durchführt (eine ID, die die Schlüsselspalte nicht aufnehmen kann), ein von der Datenbank abgelehntes Einreihen eines Jobs —, bricht diese Transaktion in Postgres ab, und das Abfangen des Fehlers in JavaScript macht das nicht rückgängig. Der Schreibvorgang wird mit **500 `TRANSACTION_ABORTED`** abgelehnt und nichts wird gespeichert, statt Erfolg für einen Schreibvorgang zu melden, der zurückgerollt wurde. Lassen Sie einen solchen Fehler werfen, oder prüfen Sie die Bedingung, bevor Sie die Anweisung ausführen.

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

Arbeiten, die die Datenbank verlassen müssen — eine E-Mail, ein Webhook, ein Aufruf einer Drittanbieter-API —, gehören nicht in den Callback-Body. Sie würden die Transaktion für einen Netzwerk-Roundtrip offenhalten, und nichts kann sie zurücknehmen, wenn der Schreibvorgang zurückgerollt wird. Stellen Sie dafür einen [Job](/docs/backend/jobs) in die Warteschlange oder führen Sie die Aktion aus, nachdem der Schreibvorgang zurückgekehrt ist: Veröffentlichen Sie auf einem [Realtime-Kanal](/docs/backend/realtime) oder verwenden Sie `waitUntil` in einer [benutzerdefinierten Funktion](/docs/backend/custom-functions). Unter [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) erfahren Sie, was sich am besten eignet.

Bei MongoDB trifft nichts davon zu. Dieser Treiber führt dieselben Callbacks ohne Transaktion aus, sodass der Schreibvorgang bereits gespeichert ist, wenn `afterSave` ausgeführt wird, und ein dortiger Fehler lediglich das Scheitern meldet, ohne es rückgängig zu machen.

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

Führen Sie Abfragen über `context.data` durch. `context.client` hat kein `data`: Serverseitig handelt es sich um das `rebase`-Singleton, dessen einzige Datenebene das admin-gescopte `dataAsAdmin` ist, sodass `context.client.data` zu einem Kompilierungsfehler führt.

## Nächste Schritte

- **[Sicherheitsregeln](/docs/collections/security-rules)** — Row Level Security
- **[Entitätshistorie](/docs/backend/history)** — Audit-Trail
- **[Benutzerdefinierte Funktionen](/docs/backend/custom-functions)** — Eigene API-Endpunkte hinzufügen
