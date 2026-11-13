---
sourceHash: 81fb68b88d544514
title: Hooks globales del backend
sidebar_label: Hooks globales
description: "Aplica hooks de ciclo de vida transversales a cada tabla a nivel de servidor: exporta hooks desde backend/hooks.ts, con la misma estructura TableHooks que usan los propios hooks de una tabla."
---

## Descripción general

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Rebase ejecuta los hooks de tabla en dos niveles, ambos del tipo `TableHooks` de
`@rebasepro/server/schema`:

- **[Hooks de tabla](/docs/collections/callbacks)**: la clave `hooks` de un `defineTable`. Se ejecutan únicamente para esa tabla.
- **Hooks globales**: exportados como `hooks` desde `backend/hooks.ts`. Se activan en **cada** tabla, en cada ruta de datos (API REST, WebSocket / tiempo real, MCP, `rebase.dataAsAdmin` en el servidor). El único escritor que no ven es el sistema de autenticación: el registro, el inicio de sesión OAuth y la administración de usuarios por parte del admin escriben filas de usuario directamente y ejecutan los [hooks de autenticación](/docs/backend/authentication/) (`afterUserCreate`, …) en su lugar.

Usa hooks globales para:
- **Restricción de filas (row scoping)** — `beforeQuery` en cada tabla, para que las lecturas de un tenant se delimiten en un solo lugar en vez de por tabla. Consulta [`beforeQuery`](/docs/collections/callbacks#beforequery).
- **Enmascaramiento de PII** — redactar campos sensibles para llamadas que no sean de administradores en todas las tablas.
- **Registro de auditoría unificado** — registrar cada creación, actualización o eliminación en un solo lugar. Las cuentas nuevas provenientes de registros y OAuth no están entre ellas; regístralas desde `afterUserCreate`.
- **Validación transversal** — hacer cumplir invariantes que abarcan múltiples tablas.

:::note
**Orden de ejecución**: hooks globales → hooks propios de la tabla → `.transform()` de sus columnas.
:::

Cada hook recibe el descriptor de la tabla para la que se ejecuta como `table`, por lo que los hooks globales necesitan tablas declaradas: un backend que inspecciona la base de datos (sin `backend/schema`) los rechazará al arrancar.

---

## Configuración

:::note[Dónde va esto]
**Runtime gestionado** — `export const hooks = { … }` desde `backend/hooks.ts`. El runtime lee esa exportación al iniciar; no es necesario cambiar nada más. Cualquier otra exportación del archivo se reporta al arrancar y se ignora.

**Ejected** — la clave `hooks` en `initializeRebaseBackend({ … })`.

El mapa completo se encuentra en [Visión general del backend](/docs/backend/#where-each-option-lives).
:::

```typescript
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    afterRead({ values }) {
        // Runs after every row read, across all tables
        return values;
    },
    beforeSave({ values }) {
        // Runs before every save
        return values;
    }
};
```

`hooks` toma un único conjunto. Para mantener separadas distintas responsabilidades, escribe cada una como su propio conjunto y pasa `composeTableHooks(tenantScope, auditTrail)` desde `@rebasepro/common`: se combinan exactamente igual que los niveles anteriores. Consulta [Combinar conjuntos de hooks](/docs/collections/callbacks/#combining-hook-sets).
Lo mismo aplica para `backend.setTableHooks(slug, hooks)`, que reemplaza los hooks declarados por una tabla: pasa `composeTableHooks(declared, yours)` para conservarlos.

---

## Tipo `TableHooks`

```typescript
type TableHooks = {
    beforeQuery?(props): QueryNarrowing | void;     // Conditions to AND into a read before it is compiled
    afterRead?(props):   Record<string, unknown>;  // Transform the row before returning it to the caller
    beforeSave?(props):  Partial<Values>;           // Modify values before writing to DB
    afterSave?(props):   void;                      // After the write, still in the transaction
    afterSaveError?(props): void;                   // Side-effects after a failed save
    beforeDelete?(props): boolean | void;           // Return false (403) or throw to block deletion
    afterDelete?(props): void;                      // After the delete, still in the transaction
};
```

`beforeQuery` delimita una lectura antes de que se compile; consulta [`beforeQuery`](/docs/collections/callbacks#beforequery).

Todos los hooks pueden devolver una `Promise` (asíncrono) o un valor plano (síncrono).

---

## Props del hook

Cada hook recibe un único objeto de propiedades (props). Campos comunes:

| Campo | Tipo | Presente en |
|-------|------|-------------|
| `table` | `TableDescriptor` | Todos los hooks |
| `path` | `string` | Todos los hooks |
| `values` | `Record<string, unknown>` | Todos excepto `beforeQuery`: la fila leída (`afterRead`), en proceso de eliminación (`beforeDelete`, `afterDelete`), o los valores escritos (los hooks de guardado) |
| `id` | `string \| number` | `beforeSave` (opcional), `afterSave`, `afterSaveError` (opcional), `beforeDelete`, `afterDelete` |
| `previousValues` | fila (opcional) | `beforeSave`, `afterSave`, `afterSaveError` |
| `status` | `"new" \| "existing" \| "copy"` | `beforeSave`, `afterSave`, `afterSaveError` |
| `error` | `unknown` | `afterSaveError` |
| `operation`, `query` | tipo de lectura, la consulta del llamador | `beforeQuery` |
| `context` | `RebaseCallContext` | Todos los hooks |

`context.user` contiene al usuario autenticado (`uid`, `roles`, etc.). Una solicitud sin token, donde la API permite el paso, lleva la identidad anónima `{ uid: "anonymous", roles: ["anon"] }` en lugar de `undefined`.

`context.credential` identifica la clave de API con la que se realizó una escritura: `{ kind, id, name }`, donde `kind` es `"personal"` o `"service"`. Una clave personal actúa como su propietario, por lo que `context.user` es el propietario ya sea que guardó manualmente o que una tarea de CI escribió con su clave; `context.credential` permite distinguir entre ambos casos. Se establece en la API de datos, el socket en tiempo real y `/mcp`, y está ausente en una sesión, en la clave de servicio, en tareas del contexto del servidor (`rebase.dataAsAdmin`, crons) y en el navegador. Nunca contiene el secreto.

`table` siempre está presente. Un hook global se ejecuta para cada tabla, por lo que es el único nivel que se registra independientemente de cualquiera de ellas — pero aun así nunca recibe una tabla faltante. Una solicitud que nombra una ruta que el servidor no puede resolver es rechazada con `404 NOT_FOUND` antes de que se ejecute cualquier nivel, que es la misma respuesta que las rutas de lectura y escritura darían a tal ruta de todos modos. La alternativa —omitir el nivel para esas rutas— convertiría a `afterRead` en un paso de redacción con una excepción silenciosa, por lo que no está disponible.

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
 │ 3. Global hook: beforeSave         ─┐                       │
 │ 4. Table hook: beforeSave          ─┘ awaited               │
 │ 5. Drizzle SQL execution & Postgres RLS evaluation          │
 │ 6. Global hook: afterSave          ─┐                       │
 │ 7. Table hook: afterSave           ─┘ awaited               │
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

**Todos los hooks en la lista a continuación son esperados (`await`), y todos ellos excepto `afterSaveError` se ejecutan dentro de la transacción que realiza la escritura.** No existe un nivel de tipo "disparar y olvidar": la fila y todo lo que hicieron sus hooks se confirman (commit) juntos o no se confirma nada.

- **`beforeSave`, `beforeDelete`** — si el hook lanza un error (`throw`), la operación es rechazada con un HTTP 400 que incluye tu mensaje y el código `CALLBACK_REJECTED`, y la escritura en la base de datos nunca ocurre. Lanza un `RebaseApiError` de `@rebasepro/types` para elegir el código de estado tú mismo — consulta [Hooks de tabla](/docs/collections/callbacks#beforesave). Un `beforeDelete` que *devuelve* `false` es el mismo rechazo pero sin mensaje, y responde **403** con ese código.
- **`afterRead`** — la fila devuelta (o fila transformada) es lo que recibe el llamador, y solo el llamador: en una escritura da forma a la respuesta, mientras que `afterSave`, `beforeDelete`, `afterDelete` y el historial reciben la fila tal como fue almacenada — un valor enmascarado nunca se registra ni se restaura en la columna. Su transacción es `READ ONLY` — consulta [más abajo](#afterread-no-puede-escribir).
- **`afterSave`, `afterDelete`** — se ejecutan *antes* del commit, de forma esperada (`await`). Un error lanzado aquí revierte la fila y responde con el mismo **400 `CALLBACK_REJECTED`**, con `details.stage` indicando el hook. Mantienen la transacción abierta mientras se ejecutan, por lo que uno lento mantendrá un bloqueo activo.
- **`afterSaveError`** — se ejecuta cuando el guardado falló, al salir. En una solicitud, se ejecuta después de que la transacción de la escritura fallida haya sido revertida, con un `context` cuyas llamadas son cada una una transacción propia, de modo que cualquier trabajo que encole para reportar el fallo se conserva. Si este hook lanza un error, se registra en el log; el llamador recibe el error original del guardado.

:::caution[Esta página solía decir lo contrario]
Versiones anteriores decían que `afterSave` y `afterDelete` "se ejecutan después de que la transacción se confirma" y "no bloquean la respuesta HTTP". Nunca hicieron ninguna de las dos cosas. El código escrito en base a esa afirmación —como una llamada a un webhook en `afterSave`— ha estado manteniendo abierta una transacción de base de datos durante el tiempo que dura un viaje de ida y vuelta HTTP, y revirtiendo la fila cada vez que el extremo remoto estaba caído.
:::

### Cuándo se ejecuta `afterSaveError`

Reporta un guardado que falló **en la base de datos o después de ella** — a partir de la sentencia INSERT o UPDATE en adelante. Un guardado rechazado antes de ese punto nunca llegó a la base de datos, por lo que no se notifica al hook al respecto.

| Se ejecuta | No se ejecuta |
|---|---|
| La base de datos rechaza la sentencia: una infracción de clave única o foránea, una restricción check o trigger, una política de seguridad a nivel de fila (`WRITE_DENIED`) | Un rechazo en `beforeSave` — el hook que lo rechazó es el que lo sabe |
| `afterRead` o `afterSave` lanzan un error (el llamador recibe `CALLBACK_REJECTED`) | Una solicitud rechazada antes del driver: validación (`VALIDATION_*`), un campo que el llamador no tiene permitido escribir, un permiso faltante |
| La entrada de historial no se puede registrar | Una fila que el llamador no puede direccionar (`404`), un sello de tenant que no tiene permitido establecer |
| | El commit es rechazado después de que el guardado retornó: `TRANSACTION_ABORTED` (una sentencia fallida capturada por un hook), o una restricción diferida comprobada en el `COMMIT` |
| | Una eliminación — no existe un equivalente para delete |

En una escritura masiva o `_batch`, se ejecuta para la fila que falló; las filas anteriores se revierten con el lote y no se reportan.

### Efectos secundarios que no deben retener la transacción

Cualquier cosa lenta, o cualquier cosa que no se pueda deshacer si la transacción se revierte, no pertenece al cuerpo del hook:

| Necesidad | Haz esto en su lugar |
|---|---|
| Llamar a un tercero, enviar un correo, generar un archivo | [Encola un job](/docs/backend/jobs). Un job encolado en una transacción que se revierte nunca fue encolado — que es el comportamiento deseado. |
| Notificar a otros procesos que algo ocurrió | Publica en un [canal de tiempo real](/docs/backend/realtime) después de que la escritura retorne, no desde dentro del hook. |
| Trabajar en una [función personalizada](/docs/backend/custom-functions) que el llamador no necesita esperar | `waitUntil(c, promise)` de `@rebasepro/server/functions` — se ejecuta después de la respuesta y el host espera a que termine antes de apagarse. |

La regla general: si el trabajo aún debe ocurrir cuando la escritura se deshace, no es parte de la escritura, por lo que no va dentro del hook.

### `afterRead` no puede escribir

Una lectura con alcance de solicitud abre su transacción como `READ ONLY`, y lo mismo hace la recarga de una suscripción en tiempo real. `afterRead` se ejecuta dentro de ella, por lo que **ninguna escritura desde ese hook puede tener éxito** — ni una creación con `context.data`, ni una actualización, ni una oculta dentro de un helper que llame. Postgres rechaza la sentencia con el código SQLSTATE `25006`, y se responde al llamador:

```json
{ "error": { "message": "An `afterRead` hook tried to write. …",
             "code": "READ_ONLY_TRANSACTION",
             "details": { "dbCode": "25006" } } }
```

Eso es un 409, no un 500: es tu código siendo rechazado, no una falla del servidor. El modo de solo lectura es deliberado — una lectura que escribe silenciosamente es una lectura cuyo costo, bloqueos y superficie de RLS nadie presupuestó.

Por lo tanto, **la auditoría de lecturas no pertenece a `afterRead`**. Registra la lectura fuera de la solicitud — desde un job en segundo plano alimentado por lo que ya emites, o desde una función personalizada que haga la lectura *y* la escritura mediante dos llamadas independientes:

```typescript no-verify
// ✗ Fails with READ_ONLY_TRANSACTION on every read.
export const hooks: TableHooks = {
    afterRead: async ({ path, values, context }) => {
        await context.data.read_log.create({ path, uid: context.user?.uid });
        return values;
    }
};
```

```typescript
// backend/functions/read-article.ts — served at /api/functions/read-article/:id
// ✓ The read and the audit row are two operations, and only the second writes.
import { defineFunction, getUserId, requireAuth, requireDriver } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/:id", requireAuth, async (c) => {
        const article = await requireDriver(c).fetchOne({ path: "articles", id: c.req.param("id") });
        await rebase.dataAsAdmin.read_log.create({ path: "articles", uid: getUserId(c) });
        return c.json(article);
    });
});
```

La auditoría en el lado de la escritura no tiene este problema: `afterSave` y `afterDelete` se ejecutan en una transacción de lectura y escritura, y la fila de auditoría se confirma junto con el cambio que registra.

---

## Ejemplos

### Enmascaramiento de PII

Redactar direcciones de correo electrónico para llamadas de usuarios no administradores en todas las tablas:

```typescript
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    afterRead({ values, context }) {
        const isAdmin = context.user?.roles?.includes("admin");
        if (!isAdmin && values.email) {
            return { ...values, email: "********" };
        }
        return values;
    }
};
```

### Registro de auditoría global

Registra cada eliminación, en todas las tablas, en una tabla `audit_log`. Dado que `afterDelete` se ejecuta dentro de la propia transacción de eliminación, la fila de auditoría y la eliminación se confirman juntas — no hay margen de tiempo en el que una exista sin la otra:

```typescript no-verify
// backend/hooks.ts
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    async afterDelete({ table, id, values, context }) {
        if (table.slug === "audit_log") return;   // don't audit the audit
        await context.data.audit_log.create({
            action: "delete",
            table: table.slug,
            entity_id: String(id),
            actor: context.user?.uid ?? "anonymous",
            // The API key, when the delete was made with one.
            via_key: context.credential?.name ?? null,
            snapshot: values
        });
    }
};
```

Ten en cuenta lo que esto aporta y lo que cuesta: si la fila de auditoría no se puede escribir, la eliminación tampoco ocurre. Para un registro de auditoría, generalmente esto es lo deseado. Si no es así, captura el error en el hook y acláralo en un comentario.

### Lógica específica de tabla

Los hooks globales se activan para todas las tablas. Para limitar la lógica a una sola tabla, comprueba `table.slug` o `path`:

```typescript
import type { TableHooks } from "@rebasepro/server/schema";

export const hooks: TableHooks = {
    beforeSave({ table, values }) {
        if (table.slug === "orders") {
            const total = values.total;
            if (typeof total !== "number" || total <= 0) {
                throw new Error("Order total must be positive");
            }
        }
        return values;
    }
};
```

Para hooks que solo aplican a una única tabla, es preferible utilizar [los hooks propios de la tabla](/docs/collections/callbacks) en su lugar.
