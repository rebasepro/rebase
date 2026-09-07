---
sourceHash: 8894ea74b3dd7b7d
title: Historial de Entidades
sidebar_label: Historial de Entidades
description: "Rastrea cada cambio en tus entidades con una auditoría completa: quién cambió qué, cuándo y una instantánea completa del antes/después."
---

## Visión General

El historial de entidades registra una instantánea de los valores de las entidades en cada creación, actualización y eliminación. Esto proporciona una auditoría completa con diferencias.

## Habilitar Historial

### Backend

Habilita el historial en `initializeRebaseBackend`:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

O con configuraciones de retención personalizadas:

```typescript
history: {
    maxEntries: 200,     // Per entity, oldest pruned first (default: 200)
    ttlDays: 90          // Entries older than this are pruned (default: 90)
}
```

### Por Colección

Marca qué colecciones deben rastrear el historial:

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

## Cómo Funciona

1. El backend crea una tabla `rebase.entity_history` automáticamente
2. En cada creación, actualización o eliminación, se registra una instantánea con:
   - ID de entidad, slug de colección y nombre de tabla
   - Los valores completos de la entidad (antes y después)
   - Marca de tiempo e ID de usuario
   - Tipo de operación (`insert`, `update`, `delete`)
3. Las entradas antiguas se eliminan periódicamente (cada 6 horas)

## Endpoint REST

```
GET /api/data/:slug/:entityId/history
```

Devuelve una lista de entradas del historial para una entidad específica, ordenadas por las más recientes primero:

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

## Configuración de Retención

| Configuración | Predeterminado | Descripción |
|---------------|----------------|-------------|
| `maxEntries`  | 200            | Número máximo de entradas por entidad. Las más antiguas se eliminan. |
| `ttlDays`     | 90             | Las entradas más antiguas que esto se eliminan. |

El backend realiza una limpieza global cada 6 horas.

## Próximos Pasos

- **[Callbacks de Entidad](/docs/collections/callbacks)** — Ganchos de ciclo de vida
- **[Visión General del Backend](/docs/backend)** — Configuración completa del backend

---
