---
title: Cronologia Entità
sidebar_label: Cronologia Entità
description: Tieni traccia di ogni modifica alle tue entità con una traccia di audit completa — chi ha modificato cosa, quando, e lo entity completo prima/dopo.
---

## Overview

La cronologia delle entità registra uno entity dei valori delle entità ad ogni creazione, aggiornamento ed eliminazione. Questo ti fornisce una traccia di audit completa con differenze.

## Enabling History

### Backend

Abilita la cronologia in `initializeRebaseBackend`:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

Oppure con impostazioni di conservazione personalizzate:

```typescript
history: {
    maxEntries: 200,     // Per entità, i più vecchi vengono eliminati per primi (predefinito: 200)
    ttlDays: 90          // Le voci più vecchie di questo periodo vengono eliminate (predefinito: 90)
}
```

### Per Collection

Indica quali collezioni devono tracciare la cronologia:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const ordersCollection = defineCollection({
    slug: "orders",
    name: "Orders",
    table: "orders",
    history: true,       // Abilita per questa collezione
    properties: { /* ... */ }
});
```

## Come funziona

1. Il backend crea automaticamente una tabella `rebase.entity_history`
2. Ad ogni creazione, aggiornamento o eliminazione, viene registrato uno entity con:
   - ID entità, slug della collezione e nome della tabella
   - I valori completi dell'entità (prima e dopo)
   - Timestamp e ID utente
   - Tipo di operazione (`insert`, `update`, `delete`)
3. Le voci obsolete vengono eliminate periodicamente (ogni 6 ore)

## REST Endpoint

```
GET /api/data/:slug/:entityId/history
```

Restituisce un elenco di voci della cronologia per una specifica entità, ordinate dalla più recente alla meno recente:

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

## Retention Configuration

| Impostazione | Predefinito | Descrizione |
|---------|---------|-------------|
| `maxEntries` | 200 | Numero massimo di voci per entità. Le più vecchie vengono eliminate. |
| `ttlDays` | 90 | Le voci più vecchie di questo periodo vengono eliminate. |

Il backend esegue una pulizia globale ogni 6 ore.

## Next Steps

- **[Callback dell'Entità](/docs/collections/callbacks)** — Hook del ciclo di vita
- **[Panoramica del Backend](/docs/backend)** — Configurazione completa del backend

---
