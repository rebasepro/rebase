---
sourceHash: 97a20df64eaeffc7
title: Globale Backend-Hooks
sidebar_label: Globale Hooks
description: Wenden Sie querschnittliche Lifecycle-Callbacks auf Serverebene mithilfe von CollectionCallbacks auf jede Collection an.
---

## Übersicht

Rebase bietet zwei Ebenen für Entity-Lifecycle-Callbacks – beide verwenden denselben `CollectionCallbacks`-Typ aus `@rebasepro/types`:

- **[Callbacks pro Collection](/docs/collections/callbacks)**: Werden in einzelnen Collection-Konfigurationen definiert. Sie werden nur für diese Collection ausgeführt.
- **Globale Callbacks**: Werden bei `initializeRebaseBackend({ callbacks })` definiert. Sie werden bei **jeder** Collection und auf jedem Datenpfad ausgelöst (REST-API, WebSocket / Realtime, serverseitiges `rebase.dataAsAdmin`).

Verwenden Sie globale Callbacks für:
- **Row-Scoping** — <span class="since-badge" data-since="0.22">Seit 0.22</span> `beforeQuery` auf jeder Collection, sodass Lesezugriffe eines Mandanten an einer zentralen Stelle statt pro Collection eingegrenzt werden. Nur Postgres: Neben einer MongoDB- oder Firestore-Datenquelle verweigert ein globales `beforeQuery` den Start, anstatt die Lesezugriffe dieser Quelle uneingeschränkt zu lassen. Siehe [`beforeQuery`](/docs/collections/callbacks#beforequery).
- **PII-Maskierung** — Ausblenden sensibler Felder für Nicht-Admin-Aufrufer über alle Collections hinweg.
- **Einheitliches Audit-Logging** — Protokollieren jeder Erstellung, Aktualisierung oder Löschung an einem zentralen Ort.
- **Querschnittliche Validierung** — Durchsetzen von Invarianten, die mehrere Collections umfassen.

:::note
**Ausführungsreihenfolge**: Globale Callbacks → Collection-Callbacks → Property-Callbacks.
:::

---

## Konfiguration

:::note[Wo dies hingehört]
**Managed Runtime** — `export const callbacks = { … }` aus `config/index.ts`. Die Runtime liest diesen Export beim Start; sonst muss nichts geändert werden.

**Ejected** — Der Schlüssel `callbacks` bei `initializeRebaseBackend({ … })`.

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

## `CollectionCallbacks`-Typ

```typescript
type CollectionCallbacks = {
    beforeQuery?(props): QueryNarrowing | void;     // Conditions to AND into a read before it is compiled
    afterRead?(props):   Record<string, unknown>;  // Transform row before returning to caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

<span class="since-badge" data-since="0.22">Seit 0.22</span> `beforeQuery` grenzt einen Lesezugriff ein, bevor er kompiliert wird; siehe
[`beforeQuery`](/docs/collections/callbacks#beforequery).

Alle Callbacks können ein `Promise` (asynchron) oder einen einfachen Wert (synchron) zurückgeben.

---

## Callback-Props

Jeder Callback erhält ein einzelnes Props-Objekt. Gemeinsame Felder:

| Feld | Typ | Vorhanden in |
|-------|------|------------|
| `collection` | `CollectionConfig` | Allen Callbacks |
| `path` | `string` | Allen Callbacks |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (optional), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (optional) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Allen Callbacks |

`context.user` enthält den authentifizierten Benutzer (`uid`, `roles` usw.) oder ist bei öffentlichen Anfragen `undefined`.

`collection` ist immer vorhanden. Ein globaler Callback wird für jede Collection ausgelöst, ist also
die einzige Ebene, die unabhängig von einer bestimmten Collection registriert wird – dennoch wird ihm
niemals eine fehlende Collection übergeben. Eine Anfrage, die einen Pfad angibt, den die
Collection-Registry nicht auflösen kann, wird mit `404 NOT_FOUND` abgewiesen, bevor irgendeine Ebene ausgeführt wird.
Dies ist dieselbe Antwort, die Lese- und Schreibpfade für einen solchen Pfad ohnehin liefern. Die
Alternative – das Überspringen der Ebene für diese Pfade – würde `afterRead` zu einem
Redaktionsschritt mit einer stillschweigenden Ausnahme machen, weshalb dies nicht vorgesehen ist.

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

**Jeder Callback in der folgenden Liste wird per `await` abgewartet, und alle laufen innerhalb der
Transaktion, die den Schreibvorgang ausführt.** Es gibt keine „Fire-and-Forget“-Ebene: Die
Zeile und alles, was ihre Callbacks getan haben, werden zusammen committet oder gar nicht.

- **`beforeSave`, `beforeDelete`** — Wenn der Callback einen Fehler auslöst (throw), wird die Operation mit einem HTTP 400 abgelehnt, der Ihre Nachricht und den Code `CALLBACK_REJECTED` enthält, und der Schreibvorgang in die Datenbank findet niemals statt. Werfen Sie einen `RebaseApiError` aus `@rebasepro/types`, um den Status selbst zu wählen – siehe [Entity-Callbacks](/docs/collections/callbacks#beforesave). Ein `beforeDelete`, das `false` *zurückgibt*, stellt dieselbe Verweigerung ohne Nachricht dar und antwortet mit **403** und diesem Code.
- **`afterRead`** — Die zurückgegebene Zeile (oder transformierte Zeile) ist das, was der Aufrufer erhält. Ihre Transaktion ist `READ ONLY` – siehe [unten](#afterread-kann-nicht-schreiben).
- **`afterSave`, `afterDelete`** — Werden *vor* dem Commit ausgeführt und abgewartet. Ein Fehler (throw) an dieser Stelle rollt die Zeile zurück und antwortet ebenfalls mit **400 `CALLBACK_REJECTED`**, wobei `details.stage` den Hook benennt. Sie halten die Transaktion während ihrer Ausführung offen; ein langsamer Hook blockiert somit Sperren (Locks).
- **`afterSaveError`** — Wird ausgeführt, wenn das Speichern fehlgeschlagen ist, auf dem Rückweg.

:::caution[Diese Seite besagte früher das Gegenteil]
Frühere Versionen besagten, dass `afterSave` und `afterDelete` „nach dem Commit der Transaktion ausgeführt werden“
und „die HTTP-Antwort nicht blockieren“. Beides war nie der Fall. Code, der
auf Basis dieser Aussage geschrieben wurde – etwa ein Webhook-Aufruf in `afterSave` –, hielt
eine Datenbanktransaktion für die Dauer eines HTTP-Roundtrips offen
und rollte die Zeile jedes Mal zurück, wenn die Gegenstelle nicht erreichbar war.
:::

### Seiteneffekte, die die Transaktion nicht blockieren dürfen

Alles, was langsam ist oder nicht rückgängig gemacht werden kann, wenn die Transaktion zurückgerollt wird,
gehört nicht in den Callback-Body:

| Anwendungsfall | Stattdessen dies tun |
|---|---|
| Drittanbieter aufrufen, E-Mail senden, Datei generieren | [Einen Job einreihen](/docs/backend/jobs). Ein Job, der in einer Transaktion eingereiht wurde, die zurückgerollt wird, wurde nie eingereiht – was genau das gewünschte Verhalten ist. |
| Anderen Prozessen mitteilen, dass etwas passiert ist | Auf einem [Realtime-Kanal](/docs/backend/realtime) veröffentlichen, nachdem der Schreibvorgang zurückgekehrt ist, nicht aus dem Hook heraus. |
| Arbeiten in einer [Custom Function](/docs/backend/custom-functions), auf die der Aufrufer nicht warten muss | `waitUntil(c, promise)` aus `@rebasepro/server/functions` — dies läuft nach der Antwort, und der Host wartet darauf, bevor er herunterfährt. |

Die Faustregel: Wenn die Arbeit auch dann stattfinden soll, wenn der Schreibvorgang rückgängig gemacht wird,
ist sie nicht Teil des Schreibvorgangs und gehört daher nicht in den Hook.

### `afterRead` kann nicht schreiben

Ein Lesezugriff im Request-Scope öffnet seine Transaktion als `READ ONLY`. `afterRead` läuft darin,
sodass **kein Schreibvorgang aus diesem Callback erfolgreich sein kann** — weder ein Erstellen
über `context.data`, noch ein Update, noch ein Aufruf, der in einer aufgerufenen Hilfsfunktion verborgen ist. Postgres weist das
Statement mit SQLSTATE `25006` ab, und der Aufrufer erhält als Antwort:

```json
{ "error": { "message": "An `afterRead` callback tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Das ist ein 409, kein 500: Es bedeutet, dass Ihr Code abgelehnt wird, nicht dass der Server ausfällt.
Der Read-Only-Modus ist beabsichtigt — ein Lesevorgang, der heimlich schreibt, ist ein Lesevorgang, dessen
Kosten, Sperren und RLS-Angriffsfläche von niemandem einkalkuliert wurden.

Daher **gehört Lese-Auditing nicht in `afterRead`**. Protokollieren Sie den Lesevorgang stattdessen
außerhalb der Anfrage — über einen Hintergrundjob, der mit dem gespeist wird, was Sie bereits ausgeben, oder
über eine Custom Function, die das Lesen *und* das Schreiben über zwei separate
Aufrufe durchführt:

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

Schreibseitiges Auditing hat dieses Problem nicht: `afterSave` und `afterDelete` laufen in einer
Read-Write-Transaktion, und die Audit-Zeile wird zusammen mit der Änderung committet, die sie aufzeichnet.

---

## Beispiele

### PII-Maskierung

E-Mail-Adressen für Nicht-Admin-Aufrufer über alle Collections hinweg unkenntlich machen:

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

Jede Löschung über jede Collection hinweg in einer `audit_log`-Tabelle aufzeichnen. Da
`afterDelete` in der eigenen Transaktion des Löschvorgangs läuft, werden die Audit-Zeile und die
Löschung zusammen committet — es gibt kein Zeitfenster, in dem das eine ohne das
andere existiert:

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

Beachten Sie, was dies bringt und was es kostet: Wenn die Audit-Zeile nicht geschrieben werden kann,
findet auch die Löschung nicht statt. Für ein Audit-Trail ist das meist genau das, was Sie wollen.
Wenn dies nicht gewünscht ist, fangen Sie den Fehler im Callback ab und vermerken Sie dies in einem Kommentar.

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
