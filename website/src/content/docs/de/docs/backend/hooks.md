---
sourceHash: e7b16241ef98f0de
title: Globale Backend-Hooks
sidebar_label: Globale Hooks
description: Wenden Sie übergreifende Lifecycle-Callbacks auf Serverebene mit CollectionCallbacks auf jede Collection an.
---

## Übersicht

Rebase bietet zwei Ebenen von Entity-Lifecycle-Callbacks – beide verwenden denselben Typ `CollectionCallbacks` aus `@rebasepro/types`:

- **[Callbacks pro Collection](/docs/collections/callbacks)**: Werden in individuellen Collection-Konfigurationen definiert. Sie werden nur für diese Collection ausgeführt.
- **Globale Callbacks**: Werden in `initializeRebaseBackend({ callbacks })` definiert. Sie werden bei **jeder** Collection und auf jedem Datenpfad ausgelöst (REST-API, WebSocket / Echtzeit, serverseitiges `rebase.dataAsAdmin`).

Verwenden Sie globale Callbacks für:
- **PII-Maskierung** – sensible Felder für Nicht-Admin-Aufrufer über alle Collections hinweg unkenntlich machen.
- **Einheitliches Audit-Logging** – jedes Erstellen, Aktualisieren oder Löschen an einem zentralen Ort protokollieren.
- **Übergreifende Validierung** – Invarianten durchsetzen, die sich über mehrere Collections erstrecken.

:::note
**Ausführungsreihenfolge**: Globale Callbacks → Collection-Callbacks → Eigenschafts-Callbacks.
:::

---

## Konfiguration

:::note[Wo dies hingehört]
**Managed Runtime** – `export const callbacks = { … }` aus `config/index.ts`. Die Runtime liest diesen Export beim Start; sonst muss nichts geändert werden.

**Ejected** – der Schlüssel `callbacks` in `initializeRebaseBackend({ … })`.

Die vollständige Übersicht finden Sie in der [Backend-Übersicht](/docs/backend/#where-each-option-lives).
:::

Übergeben Sie den Schlüssel `callbacks` an `initializeRebaseBackend`:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterRead({ row, context }) {
            // Runs after every entity read, across all collections
            return row;
        },
        beforeSave({ values, context }) {
            // Runs before every entity save
            return values;
        }
    }
});
```

---

## Typ `CollectionCallbacks`

```typescript
type CollectionCallbacks = {
    afterRead?(props):   Record<string, unknown>;  // Transform row before returning to caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

Alle Callbacks können ein `Promise` (asynchron) oder einen einfachen Wert (synchron) zurückgeben.

---

## Callback-Props

Jeder Callback erhält ein einzelnes Props-Objekt. Gängige Felder:

| Feld | Typ | Vorhanden in |
|-------|------|------------|
| `collection` | `CollectionConfig` | Alle Callbacks |
| `path` | `string` | Alle Callbacks |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (optional), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (optional) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Alle Callbacks |

`context.user` enthält den authentifizierten Benutzer (`uid`, `roles` usw.) oder ist bei öffentlichen Anfragen `undefined`.

`collection` ist immer vorhanden. Ein globaler Callback wird für jede Collection ausgelöst, daher ist er die einzige Ebene, die unabhängig von einer bestimmten Collection registriert wird – dennoch wird ihm niemals eine fehlende Collection übergeben. Eine Anfrage, die einen Pfad benennt, den die Collection-Registry nicht auflösen kann, wird mit `404 NOT_FOUND` abgewiesen, bevor irgendeine Ebene ausgeführt wird – dieselbe Antwort, die Lese- und Schreibpfade für einen solchen Pfad ohnehin liefern. Die Alternative – das Überspringen der Ebene für solche Pfade – würde `afterRead` zu einem Schwärzungsschritt mit einer stillen Ausnahme machen, weshalb dies nicht vorgesehen ist.

---

## Ausführungspipeline

```
[Client Request]
       │
       ▼
 [Hono Router]
       │
 [Database Driver]
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 1. Start PostgreSQL Transaction                             │
 │ 2. Set Config: app.user_id = '<uid>', app.user_roles = ...  │
 │                                                             │
 │ 3. Global Callback: beforeSave     ─┐                       │
 │ 4. Collection Callback: beforeSave ─┘ awaited               │
 │ 5. Drizzle SQL execution & Postgres RLS evaluation          │
 │ 6. Global Callback: afterSave      ─┐                       │
 │ 7. Collection Callback: afterSave  ─┘ awaited               │
 │                                                             │
 │ 8. Commit  ← a throw anywhere in 3–7 rolls the write back   │
 └─────┬───────────────────────────────────────────────────────┘
       │
 [Realtime notifications flushed — after the commit, never before]
       │
       ▼
[Client Response]
```

---

## Blockierende vs. asynchrone Semantik

**Jeder Callback in der folgenden Liste wird per `await` abgewartet, und alle laufen innerhalb der Transaktion, die den Schreibvorgang ausführt.** Es gibt keine „Fire-and-Forget“-Ebene: Die Zeile und alles, was ihre Callbacks getan haben, werden gemeinsam oder gar nicht committet.

- **`beforeSave`, `beforeDelete`** — wenn der Callback eine Exception auslöst (throws), wird die Operation mit einem HTTP 400 abgewiesen, der Ihre Nachricht und den Code `CALLBACK_REJECTED` enthält, und der Schreibvorgang in die Datenbank findet niemals statt. Lösen Sie einen `RebaseApiError` aus `@rebasepro/types` aus, um den Status selbst zu bestimmen – siehe [Entity-Callbacks](/docs/collections/callbacks#beforesave). Ein `beforeDelete`, das `false` *zurückgibt*, entspricht derselben Verweigerung ohne Nachricht und antwortet mit **403** und diesem Code.
- **`afterRead`** — die zurückgegebene Zeile (oder transformierte Zeile) ist das, was der Aufrufer erhält. Seine Transaktion ist `READ ONLY` – siehe [unten](#afterread-kann-nicht-schreiben).
- **`afterSave`, `afterDelete`** — laufen *vor* dem Commit, per `await` abgewartet. Ein Fehler hier rollt die Zeile zurück und antwortet mit demselben **400 `CALLBACK_REJECTED`**, wobei `details.stage` den Hook benennt. Sie halten die Transaktion während ihrer Ausführung offen; ein langsamer Callback bedeutet also gehaltene Locks.
- **`afterSaveError`** — wird ausgeführt, wenn das Speichern fehlgeschlagen ist, auf dem Rückweg.

:::caution[Auf dieser Seite stand früher das Gegenteil]
Frühere Versionen besagten, dass `afterSave` und `afterDelete` „nach dem Commit der Transaktion ausgeführt werden“ und „die HTTP-Antwort nicht blockieren“. Beides war nie der Fall. Code, der basierend auf diesem Satz geschrieben wurde – beispielsweise ein Webhook-Aufruf in `afterSave` –, hielt eine Datenbanktransaktion für die Dauer eines HTTP-Roundtrips offen und rollte die Zeile jedes Mal zurück, wenn die Gegenstelle nicht erreichbar war.
:::

### Nebeneffekte, die die Transaktion nicht blockieren dürfen

Alles, was langsam ist oder nicht rückgängig gemacht werden kann, wenn die Transaktion zurückgerollt wird, gehört nicht in den Callback-Body:

| Ziel | Stattdessen tun |
|---|---|
| Einen Drittanbieter aufrufen, E-Mails senden, Dateien generieren | [Einen Job einreihen](/docs/backend/jobs). Ein Job, der in einer zurückgerollten Transaktion eingereiht wurde, wurde nie eingereiht – genau das Verhalten, das Sie sich wünschen. |
| Andere Prozesse darüber informieren, dass etwas passiert ist | Auf einem [Realtime-Kanal](/docs/backend/realtime) veröffentlichen, nachdem der Schreibvorgang zurückgekehrt ist, nicht innerhalb des Hooks. |
| Aufgaben in einer [Custom Function](/docs/backend/custom-functions), auf die der Aufrufer nicht warten muss | `waitUntil(c, promise)` aus `@rebasepro/server/functions` – läuft nach der Antwort, und der Host wartet darauf vor dem Herunterfahren. |

Die Faustregel: Wenn die Arbeit auch dann noch ausgeführt werden soll, wenn der Schreibvorgang rückgängig gemacht wird, ist sie nicht Teil des Schreibvorgangs und gehört daher nicht in den Hook.

### `afterRead` kann nicht schreiben

Ein anfragebezogener Lesevorgang öffnet seine Transaktion im Modus `READ ONLY`. `afterRead` wird darin ausgeführt, daher kann **kein Schreibvorgang aus diesem Callback erfolgreich sein** – weder ein `context.data`-Create noch ein Update, noch ein Schreibvorgang, der in einem aufgerufenen Helper verborgen ist. Postgres weist das Statement mit SQLSTATE `25006` ab, und der Aufrufer erhält die folgende Antwort:

```json
{ "error": { "message": "An `afterRead` callback tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Das ist ein 409, kein 500: Ihr Code wird abgewiesen, es handelt sich nicht um einen Serverausfall. Der Read-Only-Modus ist beabsichtigt – ein Lesevorgang, der heimlich schreibt, ist ein Lesevorgang, dessen Kosten, Locks und RLS-Oberfläche von niemandem einkalkuliert wurden.

Daher gehört **Audit-Logging von Lesevorgängen nicht in `afterRead`**. Protokollieren Sie den Lesevorgang stattdessen außerhalb der Anfrage – über einen Hintergrundjob, der durch das gespeist wird, was Sie bereits ausgeben, oder über eine Custom Function, die das Lesen *und* das Schreiben in zwei separaten Aufrufen durchführt:

```typescript no-verify
// ✗ Fails with READ_ONLY_TRANSACTION on every read.
callbacks: {
    afterRead: async ({ path, row, context }) => {
        await context.data.read_log.create({ path, uid: context.user?.uid });
        return row;
    }
}
```

```typescript no-verify
// ✓ The read and the audit row are two operations, and only the second writes.
import { rebase } from "@rebasepro/server";

export default defineFunction("read-article", (app) => {
    app.get("/:id", async (c) => {
        const article = await c.var.driver.fetchOne({ path: "articles", id: c.req.param("id") });
        await rebase.dataAsAdmin.read_log.create({ path: "articles", uid: c.var.user?.uid });
        return c.json(article);
    });
});
```

Audit-Logging auf Schreibseite hat kein solches Problem: `afterSave` und `afterDelete` laufen in einer Lese-/Schreibtransaktion, und die Audit-Zeile wird zusammen mit der Änderung committet, die sie aufzeichnet.

---

## Beispiele

### PII-Maskierung

E-Mail-Adressen für Nicht-Admin-Aufrufer über jede Collection hinweg unkenntlich machen:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterRead({ row, context }) {
            const isAdmin = context.user?.roles?.includes("admin");
            if (!isAdmin && row.email) {
                return { ...row, email: "********" };
            }
            return row;
        }
    }
});
```

### Globales Audit-Logging

Jeden Löschvorgang über jede Collection hinweg in einer `audit_log`-Tabelle aufzeichnen. Da `afterDelete` in der transaktionseigenen Löschung läuft, werden die Audit-Zeile und die Löschung zusammen committet – es gibt kein Zeitfenster, in dem das eine ohne das andere existiert:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        async afterDelete({ collection, id, row, context }) {
            if (collection.slug === "audit_log") return;   // don't audit the audit
            await context.data.audit_log.create({
                action: "delete",
                collection: collection.slug,
                entity_id: String(id),
                actor: context.user?.uid ?? "anonymous",
                snapshot: row
            });
        }
    }
});
```

Beachten Sie die Vor- und Nachteile: Wenn die Audit-Zeile nicht geschrieben werden kann, findet auch die Löschung nicht statt. Für ein Audit-Protokoll ist dies normalerweise genau das gewünschte Verhalten. Falls nicht, fangen Sie den Fehler im Callback ab und vermerken Sie dies in einem Kommentar.

### Collection-spezifische Logik

Globale Callbacks werden für alle Collections ausgelöst. Um Logik auf eine einzelne Collection zu beschränken, prüfen Sie `collection.slug` oder `path`:

```typescript
callbacks: {
    beforeSave({ collection, values, context }) {
        if (collection.slug === "orders") {
            if (!values.total || values.total <= 0) {
                throw new Error("Order total must be positive");
            }
        }
        return values;
    }
}
```

Für Callbacks, die nur für eine einzelne Collection gelten, sollten Sie stattdessen [Callbacks pro Collection](/docs/collections/callbacks) bevorzugen.

---
