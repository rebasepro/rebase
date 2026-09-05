---
title: Globale Backend-Hooks
sidebar_label: Globale Hooks
description: Wenden Sie mit CollectionCallbacks übergreifende Lifecycle-Callbacks auf jede Collection auf Serverebene an.
---

## Überblick

Rebase bietet zwei Ebenen von Entity-Lifecycle-Callbacks — beide verwenden denselben Typ `CollectionCallbacks` aus `@rebasepro/types`:

- **[Callbacks pro Collection](/docs/collections/callbacks)**: Auf einzelnen Collection-Konfigurationen definiert. Sie laufen nur für diese Collection.
- **Globale Callbacks**: Auf `initializeRebaseBackend({ callbacks })` definiert. Sie werden für **jede** Collection ausgelöst, auf jedem Datenpfad (REST-API, WebSocket / Echtzeit, serverseitiges `rebase.dataAsAdmin`).

Verwenden Sie globale Callbacks für:
- **PII-Maskierung** — sensible Felder für Nicht-Admin-Aufrufer über alle Collections hinweg schwärzen.
- **Einheitliches Audit-Logging** — jedes Erstellen, Aktualisieren oder Löschen an einer Stelle protokollieren.
- **Übergreifende Validierung** — Invarianten durchsetzen, die mehrere Collections umfassen.

:::note
**Ausführungsreihenfolge**: globale Callbacks → Collection-Callbacks → Property-Callbacks.
:::

---

## Konfiguration

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
    afterSave?(props):   void;                      // Side-effects after successful save
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false or throw to block deletion
    afterDelete?(props): void;                      // Side-effects after successful deletion
};
```

Alle Callbacks können ein `Promise` (asynchron) oder einen einfachen Wert (synchron) zurückgeben.

---

## Callback-Props

Jeder Callback erhält ein einzelnes Props-Objekt. Gemeinsame Felder:

| Feld | Typ | Vorhanden in |
|-------|------|------------|
| `collection` | `ResolvedCollection` | Alle Callbacks |
| `path` | `string` | Alle Callbacks |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (optional), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (optional) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Alle Callbacks |

`context.user` enthält den authentifizierten Benutzer (`uid`, `roles` usw.) oder ist `undefined` bei öffentlichen Anfragen.

---

## Ausführungspipeline

```
[Client Request]
       │
       ▼
 [Hono Router]
       │
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 1. Global Callback: beforeSave (Blocking)                   │
 │ 2. Collection Callback: beforeSave (Blocking)               │
 └─────┬───────────────────────────────────────────────────────┘
       │
 [Database Driver]
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 3. Start PostgreSQL Transaction                             │
 │ 4. Set Config: app.userId = '<uid>', app.user_roles = ...  │
 │ 5. Drizzle SQL execution & Postgres RLS evaluation          │
 │ 6. Commit Transaction                                       │
 └─────┬───────────────────────────────────────────────────────┘
       │
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 7. Global Callback: afterSave                               │
 │ 8. Collection Callback: afterSave                           │
 └─────┬───────────────────────────────────────────────────────┘
       │
       ▼
[Client Response]
```

---

## Blockierende vs. asynchrone Semantik

- **`beforeSave`, `beforeDelete`** — blockierend. Wenn der Callback eine Ausnahme wirft, wird die Operation mit einer HTTP-400-Fehlerantwort abgelehnt. Der Datenbankschreibvorgang findet nie statt.
- **`afterRead`** — blockierend. Die zurückgegebene (oder transformierte) Zeile ist das, was der Aufrufer erhält.
- **`afterSave`, `afterDelete`, `afterSaveError`** — laufen, nachdem die Transaktion committet wurde. Sie blockieren die HTTP-Antwort nicht.

---

## Beispiele

### PII-Maskierung

Schwärzen Sie E-Mail-Adressen für Nicht-Admin-Aufrufer über jede Collection hinweg:

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

Protokollieren Sie alle Löschungen über jede Collection hinweg:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        afterDelete({ collection, id, context }) {
            console.log(
                `[AUDIT] User ${context.user?.uid} deleted ${collection.slug}/${id}`
            );
        }
    }
});
```

### Collection-spezifische Logik

Globale Callbacks werden für alle Collections ausgelöst. Um die Logik auf eine einzelne Collection zu beschränken, prüfen Sie `collection.slug` oder `path`:

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

Für Callbacks, die nur auf eine einzelne Collection zutreffen, bevorzugen Sie stattdessen [Callbacks pro Collection](/docs/collections/callbacks).
