---
title: Entitätshistorie
sidebar_label: Entitätshistorie
description: Verfolgen Sie jede Änderung an Ihren Entitäten mit einem vollständigen Audit-Trail – wer was wann geändert hat und die vollständige Vorher-/Nachher-Momentaufnahme.
---

## Übersicht

Die Entitätshistorie zeichnet bei jeder Erstellung, Aktualisierung und Löschung eine Momentaufnahme der Entitätswerte auf. Dies bietet Ihnen einen vollständigen Audit-Trail mit Diffs.

## Historie aktivieren

### Backend

Aktivieren Sie die Historie in `initializeRebaseBackend`:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

Oder mit benutzerdefinierten Aufbewahrungseinstellungen:

```typescript
history: {
    maxEntries: 200,     // Pro Entität, die ältesten werden zuerst gelöscht (Standard: 200)
    ttlDays: 90          // Einträge, die älter als dieser Wert sind, werden gelöscht (Standard: 90)
}
```

### Pro Kollektion

Markieren Sie, welche Kollektionen die Historie verfolgen sollen:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const ordersCollection = defineCollection({
    slug: "orders",
    name: "Orders",
    table: "orders",
    history: true,       // Für diese Kollektion aktivieren
    properties: { /* ... */ }
});
```

## Funktionsweise

1. Das Backend erstellt automatisch eine Tabelle namens `rebase.entity_history`
2. Bei jeder Erstellung, Aktualisierung oder Löschung wird eine Momentaufnahme aufgezeichnet mit:
   - Entitäts-ID, Kollektions-Slug und Tabellenname
   - Die vollständigen Entitätswerte (vorher und nachher)
   - Zeitstempel und Benutzer-ID
   - Operationstyp (`insert`, `update`, `delete`)
3. Alte Einträge werden regelmäßig gelöscht (alle 6 Stunden)

## REST-Endpunkt

```
GET /api/data/:slug/:entityId/history
```

Gibt eine Liste der Historieeinträge für eine bestimmte Entität zurück, sortiert nach den neuesten zuerst:

```json
{
    "data": [
        {
            "id": 42,
            "entity_id": "123",
            "collection_slug": "orders",
            "operation": "update",
            "values": { "status": "shipped", "total": 99.99 },
            "previous_values": { "status": "pending", "total": 99.99 },
            "userId": "admin-user-id",
            "createdAt": "2025-01-15T10:30:00Z"
        }
    ]
}
```

## Aufbewahrungskonfiguration

| Einstellung | Standard | Beschreibung |
|---|---|---|
| `maxEntries` | 200 | Maximale Einträge pro Entität. Die ältesten werden gelöscht. |
| `ttlDays` | 90 | Einträge, die älter als dieser Wert sind, werden gelöscht. |

Das Backend führt alle 6 Stunden eine globale Bereinigung durch.

## Nächste Schritte

- **[Entitäts-Callbacks](/docs/collections/callbacks)** — Lebenszyklus-Hooks
- **[Backend-Übersicht](/docs/backend)** — Vollständige Backend-Konfiguration

---
