---
title: Historique des Entités
sidebar_label: Historique des Entités
description: Suivez chaque modification apportée à vos entités grâce à une piste d'audit complète — qui a changé quoi, quand, et l'instantané complet avant/après.
---

## Vue d'ensemble

L'historique des entités enregistre un instantané des valeurs d'entité à chaque création, mise à jour et suppression. Cela vous offre une piste d'audit complète avec les différences.

## Activation de l'historique

### Backend

Activez l'historique dans `initializeRebaseBackend` :

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

Ou avec des paramètres de rétention personnalisés :

```typescript
history: {
    maxEntries: 200,     // Par entité, les plus anciennes sont élaguées en premier (par défaut : 200)
    ttlDays: 90          // Les entrées plus anciennes que cette durée sont élaguées (par défaut : 90)
}
```

### Par Collection

Indiquez quelles collections doivent suivre l'historique :

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const ordersCollection = defineCollection({
    slug: "orders",
    name: "Orders",
    table: "orders",
    history: true,       // Activer pour cette collection
    properties: { /* ... */ }
});
```

## Comment ça marche

1. Le backend crée automatiquement une table `rebase.entity_history`
2. À chaque création, mise à jour ou suppression, un instantané est enregistré avec :
   - ID de l'entité, slug de la collection et nom de la table
   - Les valeurs complètes de l'entité (avant et après)
   - Horodatage et ID de l'utilisateur
   - Type d'opération (`insert`, `update`, `delete`)
3. Les anciennes entrées sont élaguées périodiquement (toutes les 6 heures)

## Point d'accès REST

```
GET /api/data/:slug/:entityId/history
```

Renvoie une liste d'entrées d'historique pour une entité spécifique, classées par les plus récentes en premier :

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

## Configuration de la rétention

| Paramètre | Par défaut | Description |
|---------|---------|-------------|
| `maxEntries` | 200 | Nombre maximum d'entrées par entité. Les plus anciennes sont élaguées. |
| `ttlDays` | 90 | Les entrées plus anciennes que cette durée sont supprimées. |

Le backend exécute un nettoyage global de l'élagage toutes les 6 heures.

## Étapes Suivantes

- **[Callbacks d'entités](/docs/collections/callbacks)** — Hooks de cycle de vie
- **[Vue d'ensemble du Backend](/docs/backend)** — Configuration complète du backend
---
