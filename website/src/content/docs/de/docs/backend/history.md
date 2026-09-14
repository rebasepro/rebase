---
sourceHash: 2c6e24a9d83f64ab
title: Entitätshistorie
sidebar_label: Entitätshistorie
description: Verfolgen Sie jede Änderung an Ihren Entitäten mit einem vollständigen Audit-Trail – wer hat was wann geändert, inklusive vollständigem Vorher-/Nachher-Zustand.
---

## Übersicht

Die Entitätshistorie zeichnet bei jedem Erstellen, Aktualisieren und Löschen einen Snapshot der Entitätswerte auf. Dadurch erhalten Sie einen vollständigen Audit-Trail mit Diffs.

## Historie aktivieren

:::note[Wo dies hingehört]
**Managed Runtime** – standardmäßig aktiviert. `REBASE_HISTORY=false` in der `.env` deaktiviert sie.

**Ejected** – `history: true` in `initializeRebaseBackend({ … })`. Die unten gezeigte Objektform – `{ retention }` – ist nur im Ejected-Modus verfügbar; die Umgebungsvariable ist ein Boolean.

Die vollständige Zuordnung finden Sie in der [Backend-Übersicht](/docs/backend/#where-each-option-lives).
:::

### Backend

:::note[Wo dies hingehört]
**Managed Runtime:** `REBASE_HISTORY` (standardmäßig `true`; auf `false` setzen, um sie zu deaktivieren). Retention-Einstellungen haben keine Entsprechung als Umgebungsvariable – führen Sie ein Eject durch, um sie zu ändern.
**Ejected:** `initializeRebaseBackend({ history })` in `backend/src/index.ts`.
:::

Aktivieren Sie die Historie in `initializeRebaseBackend`:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

Oder mit einem benutzerdefinierten Aufbewahrungszeitraum (Retention Period):

```typescript
history: {
    retention: 30        // Days. Entries older than this are pruned (default: 90)
}
```

### Pro Collection

Legen Sie fest, welche Collections eine Historie aufzeichnen sollen:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const ordersCollection = defineCollection({
    slug: "orders",
    name: "Orders",
    table: "orders",
    history: true,       // Enable for this collection
    properties: { /* ... */ }
});
```

## Funktionsweise

1. Das Backend erstellt automatisch eine Tabelle `rebase.entity_history`.
2. Bei jedem Erstellen, Aktualisieren oder Löschen wird ein Snapshot aufgezeichnet mit:
   - Der Entitäts-ID und dem Collection-Slug (in `table_name`)
   - Den vollständigen Werten der Entität (vorher und nachher)
   - Zeitstempel und Benutzer-ID
   - Der Aktion (`create`, `update`, `delete`)
   - Einem Array aus `changed_fields`, das zeigt, welche Spalten geändert wurden

### Diff-Tracking & strukturelle Deep Equality

Um redundante Protokolle zu vermeiden, wenn Felder gespeichert werden, sich aber keine Werte ändern, führt der `HistoryService` einen strukturellen Deep-Equality-Vergleich auf den Top-Level-Schlüsseln der alten und neuen Werte durch:
- Er ignoriert System-Metadaten-Eigenschaften, die mit `__` beginnen.
- Wenn Unterschiede festgestellt werden, werden die Namen der geänderten Eigenschaften in der Spalte `changed_fields` (`text[]`) gespeichert.
- Wenn die Deep-Equality-Prüfung keinerlei Änderungen feststellt, wird das Einfügen in die Historie vollständig übersprungen.

### Nicht-blockierendes Pruning nach dem Speichern

Im Gegensatz zu herkömmlichen Systemen, die sich vollständig auf langsame, periodische Batch-Skripte verlassen, setzt Rebase Ihre Aufbewahrungsrichtlinien kontinuierlich durch:
- Direkt nachdem eine Entität gespeichert oder gelöscht wurde, plant der Server einen **inline asynchronen Bereinigungsdurchlauf** in einem nicht-blockierenden Fire-and-Forget-Promise ein.
- Dieser Durchlauf prüft sofort die Retention-Limits für diese spezifische Entitäts-ID und entfernt Einträge, die über die neuesten 200 hinausgehen oder älter als der Aufbewahrungszeitraum sind.

## REST-Endpunkt

```
GET /api/data/:slug/:entityId/history
```

Gibt eine Liste von Historie-Einträgen für eine bestimmte Entität zurück, absteigend nach Aktualität sortiert:

```json
{
    "data": [
        {
            "id": "5b0e7c2e-…",
            "table_name": "orders",
            "entity_id": "123",
            "action": "update",
            "changed_fields": ["status"],
            "values": { "status": "shipped", "total": 99.99 },
            "previous_values": { "status": "pending", "total": 99.99 },
            "updated_by": "admin-user-id",
            "updated_at": "2025-01-15T10:30:00Z"
        }
    ],
    "meta": { "total": 1, "limit": 20, "offset": 0, "hasMore": false }
}
```

## Retention-Konfiguration

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| `retention` | 90 | Einträge, die älter als diese Anzahl an Tagen sind, werden gelöscht. |

Jede Entität behält zudem höchstens ihre neuesten **200** Einträge. Diese Obergrenze ist fest vorgegeben; es gibt dafür keine Einstellung.

### Pruning-Lebenszyklusmechanik

Das Pruning erfolgt ausschließlich inline. Es wird asynchron direkt nach jeder aufgezeichneten Änderung für die geänderte Entität ausgeführt: Einträge, die älter als der Aufbewahrungszeitraum sind, werden gelöscht, danach alles, was über die neuesten 200 hinausgeht. Es gibt keinen periodischen Durchlauf; daher wird die Historie einer Entität, in die nie wieder geschrieben wird, nicht bereinigt – ihre alten Einträge bleiben bestehen, bis die nächste Änderung an dieser Entität vorgenommen wird oder Sie sie selbst aus `rebase.entity_history` löschen.

## Nächste Schritte

- **[Entity Callbacks](/docs/collections/callbacks)** – Lifecycle-Hooks
- **[Backend Overview](/docs/backend)** – Vollständige Backend-Konfiguration
