---
sourceHash: 97a20df64eaeffc7
title: Hooks globales del backend
sidebar_label: Hooks globales
description: Aplica callbacks de ciclo de vida transversales a cada colección a nivel de servidor usando CollectionCallbacks.
---

## Visión general

Rebase proporciona dos niveles de callbacks del ciclo de vida de entidades; ambos utilizan el mismo tipo `CollectionCallbacks` de `@rebasepro/types`:

- **[Callbacks por colección](/docs/collections/callbacks)**: Se definen en configuraciones de colección individuales. Se ejecutan únicamente para esa colección.
- **Callbacks globales**: Se definen en `initializeRebaseBackend({ callbacks })`. Se disparan en **cada** colección, en cada ruta de datos (API REST, WebSocket / tiempo real, `rebase.dataAsAdmin` en el servidor).

Utilice callbacks globales para:
- **Alcance de filas (Row scoping)** — <span class="since-badge" data-since="0.22">Desde 0.22</span> `beforeQuery` en cada colección, de modo que las lecturas de un inquilino se delimiten en un solo lugar en vez de por colección. Solo Postgres: junto a una fuente de datos de MongoDB o Firestore, un `beforeQuery` global rechaza iniciarse en lugar de dejar las lecturas de esa fuente sin delimitar. Consulte [`beforeQuery`](/docs/collections/callbacks#beforequery).
- **Enmascaramiento de PII** — ofusca campos sensibles para quienes realizan llamadas sin permisos de administrador en todas las colecciones.
- **Registro de auditoría unificado** — registra cada creación, actualización o eliminación en un solo lugar.
- **Validación transversal** — aplica invariantes que abarcan múltiples colecciones.

:::note
**Orden de ejecución**: callbacks globales → callbacks de colección → callbacks de propiedad.
:::

---

## Configuración

:::note[Dónde va esto]
**Runtime gestionado** — `export const callbacks = { … }` desde `config/index.ts`. El runtime lee esa exportación al arrancar; no es necesario cambiar nada más.

**Eyectado (Ejected)** — la clave `callbacks` en `initializeRebaseBackend({ … })`.

El mapa completo está en [Visión general del backend](/docs/backend/#where-each-option-lives).
:::

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
    beforeQuery?(props): QueryNarrowing | void;     // Conditions to AND into a read before it is compiled
    afterRead?(props):   Record<string, unknown>;  // Transform row before returning to caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

<span class="since-badge" data-since="0.22">Desde 0.22</span> `beforeQuery` delimita una lectura antes de que se compile; consulte
[`beforeQuery`](/docs/collections/callbacks#beforequery).

Todos los callbacks pueden devolver una `Promise` (asíncrono) o un valor simple (síncrono).

---

## Props de callbacks

Cada callback recibe un único objeto de props. Campos comunes:

| Campo | Tipo | Presente en |
|-------|------|-------------|
| `collection` | `CollectionConfig` | Todos los callbacks |
| `path` | `string` | Todos los callbacks |
| `row` | `Record<string, unknown>` | `afterRead`, `beforeDelete`, `afterDelete` |
| `id` | `string` | `beforeSave` (opcional), `afterSave`, `afterSaveError`, `beforeDelete`, `afterDelete` |
| `values` | `EntityValues` | `beforeSave`, `afterSave`, `afterSaveError` |
| `previousValues` | `EntityValues` (opcional) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `context` | `RebaseCallContext` | Todos los callbacks |

`context.user` contiene el usuario autenticado (`uid`, `roles`, etc.), o es `undefined` para solicitudes públicas.

`collection` siempre está presente. Un callback global se dispara para cada colección, por lo que
es el único nivel que se registra independientemente de cualquiera de ellas, pero aun así
nunca recibe una colección faltante. Una solicitud que nombra una ruta que el registro de
colecciones no puede resolver se rechaza con `404 NOT_FOUND` antes de que se ejecute ningún nivel,
que es la misma respuesta que las rutas de lectura y escritura dan a dicha ruta de todos modos. La
alternativa —omitir el nivel para esas rutas— convertiría a `afterRead` en un paso de
ofuscación con una excepción silenciosa, por lo que no se ofrece.

---

## Flujo de ejecución

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

**Cada callback en la lista a continuación se espera con `await`, y todos ellos se ejecutan dentro de la
transacción que procesa la escritura.** No existe un nivel de "disparar y olvidar": la
fila y todo lo que hicieron sus callbacks se confirman (commit) juntos o no se confirma nada.

- **`beforeSave`, `beforeDelete`** — si el callback lanza un error (throw), la operación se rechaza con un HTTP 400 que incluye su mensaje y el código `CALLBACK_REJECTED`, y la escritura en la base de datos nunca ocurre. Lance un `RebaseApiError` de `@rebasepro/types` para elegir el estado usted mismo — consulte [Callbacks de entidad](/docs/collections/callbacks#beforesave). Un `beforeDelete` que *devuelve* `false` es el mismo rechazo sin mensaje, y responde **403** con ese código.
- **`afterRead`** — la fila devuelta (o la fila transformada) es lo que recibe el emisor de la llamada. Su transacción es `READ ONLY` — consulte [más abajo](#afterread-cannot-write).
- **`afterSave`, `afterDelete`** — se ejecutan *antes* del commit, con `await`. Si lanzan un error aquí, se revierte (rollback) la fila y se responde con el mismo **400 `CALLBACK_REJECTED`**, con `details.stage` indicando el hook. Mantienen la transacción abierta mientras se ejecutan, por lo que uno lento mantiene un bloqueo activo.
- **`afterSaveError`** — se ejecuta cuando el guardado falló, en la salida.

:::caution[Esta página solía decir lo contrario]
Las versiones anteriores decían que `afterSave` y `afterDelete` "se ejecutan después de que la transacción
haga commit" y "no bloquean la respuesta HTTP". En realidad, nunca hicieron ninguna de las dos cosas. El código que
se escribió en base a esa frase —por ejemplo, una llamada a un webhook en `afterSave`— ha
estado manteniendo una transacción de base de datos abierta durante la duración de un viaje de ida y vuelta HTTP,
y revirtiendo la fila siempre que el extremo remoto estuviera caído.
:::

### Efectos secundarios que no deben retener la transacción

Cualquier cosa lenta, o cualquier cosa que no se pueda deshacer si la transacción se revierte,
no pertenece al cuerpo del callback:

| Desea | Haga esto en su lugar |
|---|---|
| Llamar a un tercero, enviar correo, generar un archivo | [Encolar un trabajo](/docs/backend/jobs). Un trabajo encolado en una transacción que se revierte nunca fue encolado — lo cual es el comportamiento deseado. |
| Notificar a otros procesos que algo sucedió | Publicar en un [canal en tiempo real](/docs/backend/realtime) después de que la escritura retorne, no desde dentro del hook. |
| Trabajo en una [función personalizada](/docs/backend/custom-functions) que el emisor de la llamada no necesita esperar | `waitUntil(c, promise)` de `@rebasepro/server/functions` — se ejecuta después de la respuesta, y el host espera a que termine antes de apagarse. |

La regla general: si el trabajo aún debe ocurrir cuando se deshace la escritura,
no es parte de la escritura, por lo que no debe ir dentro del hook.

### `afterRead` no puede escribir {#afterread-cannot-write}

Una lectura con alcance de solicitud abre su transacción en modo `READ ONLY`. `afterRead` se ejecuta dentro
de ella, por lo que **ninguna escritura desde ese callback puede tener éxito** — ni una creación con `context.data`,
ni una actualización, ni una oculta dentro de una función auxiliar a la que invoque. Postgres rechaza la
instrucción con SQLSTATE `25006`, y al emisor de la llamada se le responde:

```json
{ "error": { "message": "An `afterRead` callback tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Eso es un 409, no un 500: es su código el que está siendo rechazado, no el servidor fallando.
El modo de solo lectura es deliberado — una lectura que escribe de forma silenciosa es una lectura cuyo
costo, bloqueos y superficie de RLS nadie tenía presupuestados.

Por lo tanto, **la auditoría de lectura no pertenece a `afterRead`**. Registre la lectura fuera de la
solicitud en su lugar — desde un trabajo en segundo plano alimentado por lo que ya emita, o
desde una función personalizada que realice la lectura *y* la escritura mediante dos llamadas
independientes:

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

La auditoría del lado de la escritura no tiene tal problema: `afterSave` y `afterDelete` se ejecutan en una
transacción de lectura-escritura, y la fila de auditoría se confirma junto con el cambio que registra.

---

## Ejemplos

### Enmascaramiento de PII

Ofusque las direcciones de correo electrónico para los emisores sin privilegios de administrador en todas las colecciones:

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

Registre cada eliminación, en todas las colecciones, en una tabla `audit_log`. Debido a que
`afterDelete` se ejecuta en la propia transacción de la eliminación, la fila de auditoría y la
eliminación se confirman juntas — no hay un intervalo en el que una exista sin la
otra:

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

Tenga en cuenta lo que esto aporta y lo que cuesta: si la fila de auditoría no se puede escribir, la
eliminación tampoco se produce. Para un registro de auditoría, esto suele ser lo que se desea.
Si no es así, capture el error en el callback e indíquelo en un comentario.

### Lógica específica por colección

Los callbacks globales se disparan para todas las colecciones. Para delimitar la lógica a una sola colección, verifique `collection.slug` o `path`:

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

Para callbacks que solo se aplican a una única colección, prefiera en su lugar [callbacks por colección](/docs/collections/callbacks).
