---
sourceHash: e7b16241ef98f0de
title: Hooks globales del backend
sidebar_label: Hooks globales
description: Aplica callbacks de ciclo de vida transversales a cada colección a nivel de servidor usando CollectionCallbacks.
---

## Descripción general

Rebase proporciona dos niveles de callbacks del ciclo de vida de entidades — ambos usan el mismo tipo `CollectionCallbacks` de `@rebasepro/types`:

- **[Callbacks por colección](/docs/collections/callbacks)**: Definidos en configuraciones de colección individuales. Se ejecutan únicamente para esa colección.
- **Callbacks globales**: Definidos en `initializeRebaseBackend({ callbacks })`. Se activan en **cada** colección, en cada ruta de datos (API REST, WebSocket / realtime, `rebase.dataAsAdmin` en el servidor).

Usa callbacks globales para:
- **Enmascaramiento de PII** — ocultar campos confidenciales para emisores que no son administradores en todas las colecciones.
- **Registro de auditoría unificado** — registrar cada creación, actualización o eliminación en un solo lugar.
- **Validación transversal** — aplicar invariantes que abarcan múltiples colecciones.

:::note
**Orden de ejecución**: callbacks globales → callbacks de colección → callbacks de propiedad.
:::

---

## Configuración

:::note[Dónde va esto]
**Runtime administrado** — `export const callbacks = { … }` desde `config/index.ts`. El runtime lee esa exportación al arrancar; no es necesario cambiar nada más.

**Ejected** — la clave `callbacks` en `initializeRebaseBackend({ … })`.

El mapa completo está en [Descripción general del backend](/docs/backend/#where-each-option-lives).
:::

Pasa la clave `callbacks` a `initializeRebaseBackend`:

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
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

Todos los callbacks pueden devolver una `Promise` (asíncrona) o un valor plano (síncrono).

---

## Props de los callbacks

Cada callback recibe un único objeto de props. Campos comunes:

| Campo | Tipo | Presente en |
|-------|------|------------|
| `collection` | `CollectionConfig` | Todos los callbacks |
| `path` | `string` | Todos los callbacks |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (opcional), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (opcional) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Todos los callbacks |

`context.user` contiene el usuario autenticado (`uid`, `roles`, etc.), o es `undefined` para solicitudes públicas.

`collection` siempre está presente. Un callback global se activa para cada colección, por lo que es el único nivel que se registra independientemente de cualquiera de ellas — pero aun así nunca recibe una colección inexistente. Una solicitud que especifique una ruta que el registro de colecciones no pueda resolver es rechazada con `404 NOT_FOUND` antes de que se ejecute cualquier nivel, que es la misma respuesta que las rutas de lectura y escritura dan a dicha ruta de todos modos. La alternativa — omitir el nivel para esas rutas — convertiría a `afterRead` en un paso de ofuscación con una excepción silenciosa, por lo que no está disponible.

---

## Pipeline de ejecución

```
[Client Request]
       │
       ▼
 [Hono Router]
       │
 [Database Driver]
 ┌─────┴───────────────────────────────────────────────────────┐
 │ 1. Start PostgreSQL Transaction                             │
 │ 2. Set Config: app.user_id = '<uid>', app.user_roles = ...  │
 │                                                             │
 │ 3. Global Callback: beforeSave     ─┐                       │
 │ 4. Collection Callback: beforeSave ─┘ awaited               │
 │ 5. Drizzle SQL execution & Postgres RLS evaluation          │
 │ 6. Global Callback: afterSave      ─┐                       │
 │ 7. Collection Callback: afterSave  ─┘ awaited               │
 │                                                             │
 │ 8. Commit  ← a throw anywhere in 3–7 rolls the write back   │
 └─────┬───────────────────────────────────────────────────────┘
       │
 [Realtime notifications flushed — after the commit, never before]
       │
       ▼
[Client Response]
```

---

## Semántica bloqueante vs. asíncrona

**Todos los callbacks de la siguiente lista se esperan con `await`, y todos ellos se ejecutan dentro de la transacción que lleva la escritura.** No existe un nivel de tipo «fire and forget»: la fila y todo lo que hicieron sus callbacks se confirman juntos (commit) o no se confirman en absoluto.

- **`beforeSave`, `beforeDelete`** — si el callback lanza un error (throws), la operación se rechaza con un HTTP 400 que incluye tu mensaje y el código `CALLBACK_REJECTED`, y la escritura en la base de datos nunca ocurre. Lanza un `RebaseApiError` de `@rebasepro/types` para elegir el estado tú mismo — consulta [Callbacks de entidad](/docs/collections/callbacks#beforesave). Un `beforeDelete` que *devuelve* `false` es el mismo rechazo pero sin mensaje, y responde **403** con ese código.
- **`afterRead`** — la fila devuelta (o fila transformada) es lo que recibe el emisor. Su transacción es `READ ONLY` — consulta [más abajo](#afterread-cannot-write).
- **`afterSave`, `afterDelete`** — se ejecutan *antes* del commit, de forma esperada con `await`. Si lanzan un error aquí, se revierte (rollback) la fila y se responde con el mismo **400 `CALLBACK_REJECTED`**, con `details.stage` indicando el hook. Mantienen la transacción abierta mientras se ejecutan, por lo que uno lento mantiene un bloqueo (lock).
- **`afterSaveError`** — se ejecuta cuando el guardado falla, a la salida.

:::caution[Esta página solía decir lo contrario]
Las versiones anteriores decían que `afterSave` y `afterDelete` "se ejecutan después de que la transacción hace commit" y "no bloquean la respuesta HTTP". Nunca hicieron ninguna de las dos cosas. El código que se escribió basándose en esa afirmación — por ejemplo, una llamada de webhook en `afterSave` — ha estado manteniendo abierta una transacción de base de datos durante la duración de un viaje de ida y vuelta HTTP (round trip), y revirtiendo la fila cada vez que el extremo remoto estaba caído.
:::

### Efectos secundarios que no deben retener la transacción

Cualquier cosa lenta, o cualquier cosa que no se pueda deshacer si la transacción se revierte (rollback), no pertenece al cuerpo del callback:

| Objetivo | Haz esto en su lugar |
|---|---|
| Llamar a un tercero, enviar correos, generar un archivo | [Encolar un trabajo](/docs/backend/jobs). Un trabajo encolado en una transacción que se revierte nunca fue encolado — que es el comportamiento que deseas. |
| Notificar a otros procesos que algo sucedió | Publica en un [canal de tiempo real](/docs/backend/realtime) después de que la escritura retorne, no desde dentro del hook. |
| Trabajar en una [función personalizada](/docs/backend/custom-functions) que el emisor no necesita esperar | `waitUntil(c, promise)` de `@rebasepro/server/functions` — se ejecuta después de la respuesta, y el host lo espera antes de apagarse. |

La regla general: si el trabajo aún debe ocurrir cuando la escritura se deshace, no es parte de la escritura, por lo que no va dentro del hook.

### `afterRead` no puede escribir

Una lectura con ámbito de solicitud abre su transacción como `READ ONLY`. `afterRead` se ejecuta dentro de ella, por lo que **ninguna escritura desde ese callback puede tener éxito** — ni una creación con `context.data`, ni una actualización, ni una oculta en una función auxiliar que invoque. Postgres rechaza la instrucción con SQLSTATE `25006`, y al emisor se le responde:

```json
{ "error": { "message": "An `afterRead` callback tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Eso es un 409, no un 500: es tu código siendo rechazado, no el servidor fallando. El modo de solo lectura es deliberado — una lectura que escribe silenciosamente es una lectura cuyo costo, bloqueos y superficie de RLS nadie tenía presupuestados.

Por lo tanto, **la auditoría de lectura no pertenece a `afterRead`**. En su lugar, registra la lectura fuera de la solicitud — desde un trabajo en segundo plano alimentado por lo que ya emitas, o desde una función personalizada que haga la lectura *y* la escritura mediante dos llamadas separadas:

```typescript no-verify
// ✗ Fails with READ_ONLY_TRANSACTION on every read.
callbacks: {
    afterRead: async ({ path, row, context }) => {
        await context.data.read_log.create({ path, uid: context.user?.uid });
        return row;
    }
}
```

```typescript no-verify
// ✓ The read and the audit row are two operations, and only the second writes.
import { rebase } from "@rebasepro/server";

export default defineFunction("read-article", (app) => {
    app.get("/:id", async (c) => {
        const article = await c.var.driver.fetchOne({ path: "articles", id: c.req.param("id") });
        await rebase.dataAsAdmin.read_log.create({ path: "articles", uid: c.var.user?.uid });
        return c.json(article);
    });
});
```

La auditoría en el lado de la escritura no tiene ese problema: `afterSave` y `afterDelete` se ejecutan en una transacción de lectura y escritura, y la fila de auditoría se confirma (commit) junto con el cambio que registra.

---

## Ejemplos

### Enmascaramiento de PII

Enmascarar direcciones de correo electrónico para emisores que no son administradores en todas las colecciones:

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

### Registro de auditoría global

Registra cada eliminación, en todas las colecciones, en una tabla `audit_log`. Debido a que `afterDelete` se ejecuta en la propia transacción de la eliminación, la fila de auditoría y la eliminación se confirman juntas — no hay ventana en la que una exista sin la otra:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const instance = await initializeRebaseBackend({
    // ... other config
    callbacks: {
        async afterDelete({ collection, id, row, context }) {
            if (collection.slug === "audit_log") return;   // don't audit the audit
            await context.data.audit_log.create({
                action: "delete",
                collection: collection.slug,
                entity_id: String(id),
                actor: context.user?.uid ?? "anonymous",
                snapshot: row
            });
        }
    }
});
```

Ten en cuenta lo que esto aporta y lo que cuesta: si la fila de auditoría no se puede escribir, la eliminación tampoco se produce. Para un registro de auditoría, esto suele ser lo que se desea. Si no es así, captura el error en el callback y acláralo en un comentario.

### Lógica específica de la colección

Los callbacks globales se activan para todas las colecciones. Para acotar la lógica a una sola colección, verifica `collection.slug` o `path`:

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

Para callbacks que solo aplican a una única colección, opta en su lugar por los [callbacks por colección](/docs/collections/callbacks).

---
