---
sourceHash: c5e20681329ea646
title: Hooks Globales del Backend
sidebar_label: Hooks Globales
description: Aplique callbacks de ciclo de vida transversales a cada colección a nivel de servidor usando CollectionCallbacks.
---

## Resumen

Rebase proporciona dos niveles de callbacks del ciclo de vida de las entidades — ambos usan el mismo tipo `CollectionCallbacks` de `@rebasepro/types`:

- **[Callbacks por colección](/docs/collections/callbacks)**: Definidos en las configuraciones de colecciones individuales. Se ejecutan solo para esa colección.
- **Callbacks globales**: Definidos en `initializeRebaseBackend({ callbacks })`. Se disparan en **cada** colección, en cada ruta de datos (API REST, WebSocket / tiempo real, `rebase.dataAsAdmin` del lado del servidor).

Use los callbacks globales para:
- **Enmascaramiento de PII** — ocultar campos sensibles para llamantes no administradores en todas las colecciones.
- **Registro de auditoría unificado** — registrar cada creación, actualización o eliminación en un solo lugar.
- **Validación transversal** — imponer invariantes que abarcan varias colecciones.

:::note
**Orden de ejecución**: callbacks globales → callbacks de colección → callbacks de propiedad.
:::

---

## Configuración

Pase la clave `callbacks` a `initializeRebaseBackend`:

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

Todos los callbacks pueden devolver una `Promise` (asíncrono) o un valor simple (síncrono).

---

## Props del Callback

Cada callback recibe un único objeto de props. Campos comunes:

| Campo | Tipo | Presente en |
|-------|------|------------|
| `collection` | `ResolvedCollection` | Todos los callbacks |
| `path` | `string` | Todos los callbacks |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (opcional), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (opcional) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Todos los callbacks |

`context.user` contiene el usuario autenticado (`uid`, `roles`, etc.), o es `undefined` para las peticiones públicas.

---

## Pipeline de Ejecución

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

## Semántica de Bloqueo vs. Asíncrona

- **`beforeSave`, `beforeDelete`** — bloqueantes. Si el callback lanza una excepción, la operación se rechaza con una respuesta de error HTTP 400. La escritura en la base de datos nunca ocurre.
- **`afterRead`** — bloqueante. La fila devuelta (o transformada) es lo que recibe el llamante.
- **`afterSave`, `afterDelete`, `afterSaveError`** — se ejecutan después de que la transacción se confirma. No bloquean la respuesta HTTP.

---

## Ejemplos

### Enmascaramiento de PII

Oculte las direcciones de email para los llamantes no administradores en todas las colecciones:

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

### Registro de Auditoría Global

Registre todas las eliminaciones en todas las colecciones:

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

### Lógica Específica de una Colección

Los callbacks globales se disparan para todas las colecciones. Para limitar la lógica a una sola colección, compruebe `collection.slug` o `path`:

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

Para los callbacks que solo se aplican a una única colección, prefiera los [callbacks por colección](/docs/collections/callbacks) en su lugar.
