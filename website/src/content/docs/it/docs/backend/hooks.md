---
title: Hook globali del backend
sidebar_label: Hook globali
description: Applica callback del ciclo di vita trasversali a ogni collezione a livello di server usando CollectionCallbacks.
---

## Panoramica

Rebase fornisce due livelli di callback del ciclo di vita delle entità — entrambi usano lo stesso tipo `CollectionCallbacks` da `@rebasepro/types`:

- **[Callback per collezione](/docs/collections/callbacks)**: Definiti sulle configurazioni delle singole collezioni. Vengono eseguiti solo per quella collezione.
- **Callback globali**: Definiti su `initializeRebaseBackend({ callbacks })`. Si attivano su **ogni** collezione, su ogni percorso dati (API REST, WebSocket / tempo reale, `rebase.data` lato server).

Usa i callback globali per:
- **Mascheramento delle PII** — oscurare i campi sensibili per i chiamanti non amministratori su tutte le collezioni.
- **Logging di audit unificato** — registrare ogni creazione, aggiornamento o eliminazione in un unico punto.
- **Validazione trasversale** — imporre invarianti che si estendono su più collezioni.

:::note
**Ordine di esecuzione**: callback globali → callback di collezione → callback di proprietà.
:::

---

## Configurazione

Passa la chiave `callbacks` a `initializeRebaseBackend`:

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

## Tipo `CollectionCallbacks`

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

Tutti i callback possono restituire una `Promise` (asincrono) o un valore semplice (sincrono).

---

## Props del callback

Ogni callback riceve un singolo oggetto di props. Campi comuni:

| Campo | Tipo | Presente in |
|-------|------|------------|
| `collection` | `ResolvedCollection` | Tutti i callback |
| `path` | `string` | Tutti i callback |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (opzionale), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (opzionale) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Tutti i callback |

`context.user` contiene l'utente autenticato (`uid`, `roles`, ecc.), oppure è `undefined` per le richieste pubbliche.

---

## Pipeline di esecuzione

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

## Semantica bloccante vs. asincrona

- **`beforeSave`, `beforeDelete`** — bloccanti. Se il callback genera un'eccezione, l'operazione viene rifiutata con una risposta di errore HTTP 400. La scrittura sul database non avviene mai.
- **`afterRead`** — bloccante. La riga restituita (o trasformata) è ciò che riceve il chiamante.
- **`afterSave`, `afterDelete`, `afterSaveError`** — vengono eseguiti dopo il commit della transazione. Non bloccano la risposta HTTP.

---

## Esempi

### Mascheramento delle PII

Oscura gli indirizzi email per i chiamanti non amministratori su ogni collezione:

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

### Logging di audit globale

Registra tutte le eliminazioni su ogni collezione:

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

### Logica specifica di una collezione

I callback globali si attivano per tutte le collezioni. Per limitare la logica a una singola collezione, controlla `collection.slug` o `path`:

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

Per i callback che si applicano solo a una singola collezione, preferisci i [callback per collezione](/docs/collections/callbacks).
