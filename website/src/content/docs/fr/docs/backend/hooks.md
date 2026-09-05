---
title: Hooks globaux du backend
sidebar_label: Hooks globaux
description: Appliquez des callbacks de cycle de vie transversaux à chaque collection au niveau du serveur à l'aide de CollectionCallbacks.
---

## Vue d'ensemble

Rebase fournit deux niveaux de callbacks du cycle de vie des entités — tous deux utilisent le même type `CollectionCallbacks` de `@rebasepro/types` :

- **[Callbacks par collection](/docs/collections/callbacks)** : Définis sur les configurations de collections individuelles. Ils ne s'exécutent que pour cette collection.
- **Callbacks globaux** : Définis sur `initializeRebaseBackend({ callbacks })`. Ils se déclenchent sur **chaque** collection, sur chaque chemin de données (API REST, WebSocket / temps réel, `rebase.dataAsAdmin` côté serveur).

Utilisez les callbacks globaux pour :
- **Masquage des PII** — masquer les champs sensibles pour les appelants non administrateurs sur toutes les collections.
- **Journalisation d'audit unifiée** — journaliser chaque création, mise à jour ou suppression en un seul endroit.
- **Validation transversale** — imposer des invariants qui s'étendent sur plusieurs collections.

:::note
**Ordre d'exécution** : callbacks globaux → callbacks de collection → callbacks de propriété.
:::

---

## Configuration

Passez la clé `callbacks` à `initializeRebaseBackend` :

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

## Type `CollectionCallbacks`

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

Tous les callbacks peuvent renvoyer une `Promise` (asynchrone) ou une valeur simple (synchrone).

---

## Props des callbacks

Chaque callback reçoit un objet de props unique. Champs communs :

| Champ | Type | Présent dans |
|-------|------|------------|
| `collection` | `ResolvedCollection` | Tous les callbacks |
| `path` | `string` | Tous les callbacks |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (facultatif), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (facultatif) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Tous les callbacks |

`context.user` contient l'utilisateur authentifié (`uid`, `roles`, etc.), ou vaut `undefined` pour les requêtes publiques.

---

## Pipeline d'exécution

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

## Sémantique bloquante vs. asynchrone

- **`beforeSave`, `beforeDelete`** — bloquants. Si le callback lève une exception, l'opération est rejetée avec une réponse d'erreur HTTP 400. L'écriture en base de données n'a jamais lieu.
- **`afterRead`** — bloquant. La ligne renvoyée (ou transformée) est ce que reçoit l'appelant.
- **`afterSave`, `afterDelete`, `afterSaveError`** — s'exécutent après le commit de la transaction. Ils ne bloquent pas la réponse HTTP.

---

## Exemples

### Masquage des PII

Masquez les adresses e-mail pour les appelants non administrateurs sur chaque collection :

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

### Journalisation d'audit globale

Journalisez toutes les suppressions sur chaque collection :

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

### Logique spécifique à une collection

Les callbacks globaux se déclenchent pour toutes les collections. Pour restreindre la logique à une seule collection, vérifiez `collection.slug` ou `path` :

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

Pour les callbacks qui ne s'appliquent qu'à une seule collection, préférez plutôt les [callbacks par collection](/docs/collections/callbacks).
