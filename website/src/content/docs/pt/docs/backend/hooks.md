---
sourceHash: c5e20681329ea646
title: Hooks Globais do Backend
sidebar_label: Hooks Globais
description: Aplique callbacks de ciclo de vida transversais a cada coleção no nível do servidor usando CollectionCallbacks.
---

## Visão Geral

A Rebase fornece dois níveis de callbacks do ciclo de vida das entidades — ambos usam o mesmo tipo `CollectionCallbacks` de `@rebasepro/types`:

- **[Callbacks por coleção](/docs/collections/callbacks)**: Definidos nas configurações de coleções individuais. Eles são executados apenas para aquela coleção.
- **Callbacks globais**: Definidos em `initializeRebaseBackend({ callbacks })`. Eles disparam em **todas** as coleções, em todos os caminhos de dados (API REST, WebSocket / tempo real, `rebase.dataAsAdmin` do lado do servidor).

Use callbacks globais para:
- **Mascaramento de PII** — ocultar campos sensíveis para chamadores não administradores em todas as coleções.
- **Log de auditoria unificado** — registrar cada criação, atualização ou exclusão em um único lugar.
- **Validação transversal** — impor invariantes que abrangem várias coleções.

:::note
**Ordem de execução**: callbacks globais → callbacks de coleção → callbacks de propriedade.
:::

---

## Configuração

Passe a chave `callbacks` para `initializeRebaseBackend`:

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

Todos os callbacks podem retornar uma `Promise` (assíncrono) ou um valor simples (síncrono).

---

## Props do Callback

Cada callback recebe um único objeto de props. Campos comuns:

| Campo | Tipo | Presente em |
|-------|------|------------|
| `collection` | `ResolvedCollection` | Todos os callbacks |
| `path` | `string` | Todos os callbacks |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (opcional), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (opcional) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Todos os callbacks |

`context.user` contém o usuário autenticado (`uid`, `roles`, etc.), ou é `undefined` para requisições públicas.

---

## Pipeline de Execução

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

## Semântica Bloqueante vs. Assíncrona

- **`beforeSave`, `beforeDelete`** — bloqueantes. Se o callback lançar uma exceção, a operação é rejeitada com uma resposta de erro HTTP 400. A escrita no banco de dados nunca acontece.
- **`afterRead`** — bloqueante. A linha retornada (ou transformada) é o que o chamador recebe.
- **`afterSave`, `afterDelete`, `afterSaveError`** — executam depois que a transação é confirmada. Elas não bloqueiam a resposta HTTP.

---

## Exemplos

### Mascaramento de PII

Oculte endereços de e-mail para chamadores não administradores em todas as coleções:

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

### Log de Auditoria Global

Registre todas as exclusões em todas as coleções:

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

### Lógica Específica de uma Coleção

Callbacks globais disparam para todas as coleções. Para limitar a lógica a uma única coleção, verifique `collection.slug` ou `path`:

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

Para callbacks que se aplicam apenas a uma única coleção, prefira os [callbacks por coleção](/docs/collections/callbacks).
