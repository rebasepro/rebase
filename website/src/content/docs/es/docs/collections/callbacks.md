---
sourceHash: b853df8c5b0b5e4a
title: Callbacks de entidades
sidebar_label: Callbacks
description: Usa callbacks del ciclo de vida para ejecutar lógica personalizada cuando las entidades se crean, actualizan, leen o eliminan. Incluye la API context.data para operaciones entre colecciones.
---

## Descripción general

Los callbacks te permiten intervenir en el ciclo de vida de la entidad para:

- **Sincronizar datos entre colecciones** — copiar o mover entidades entre tablas ante cambios de estado
- **Transformar datos** antes de guardar (campos calculados, generación de slugs)
- **Validar** reglas de negocio más allá de la validación del esquema
- **Desencadenar efectos secundarios** después de las escrituras (enviar correos electrónicos, sincronizar APIs, actualizar cachés)
- **Restringir una lectura** antes de que se compile, para que quien realiza la llamada solo vea sus propias filas
- **Filtrar/transformar** datos después de la lectura
- **Operaciones en cascada** — limpiar registros relacionados al eliminar

## Dónde se ejecutan los callbacks

Una colección tiene dos bloques de callbacks, y la única diferencia es qué entorno de ejecución los ejecuta.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Se ejecuta en | el servidor | el panel de administración, en el navegador |
| Se activa para | REST, el SDK, realtime, `dataAsAdmin` | lecturas y escrituras que realiza el panel |
| Llega al navegador | no — los cuerpos se eliminan del bundle | sí, por completo |
| Usar para | todo lo que figura a continuación | colecciones con las que el panel se comunica directamente |

**`callbacks` es el que necesitas.** Se ejecuta en cada ruta que llega al servidor, por lo que nada lo elude, y su cuerpo nunca sale de la máquina — una clave de API o una lectura de `process.env` allí es segura. El resto de esta página trata sobre `callbacks`.

`admin.browserCallbacks` existe para un caso: una colección en un transporte `direct` o `custom`, que el panel lee y escribe *por sí mismo* sin ningún servidor de Rebase en la ruta de la solicitud. Nada en el lado del servidor ve esas operaciones, por lo que `callbacks` nunca puede activarse para ellas, y este bloque es el único lugar donde puede residir su lógica de ciclo de vida.

```typescript
import type { CollectionConfig } from "@rebasepro/types";

const eventsCollection: CollectionConfig = {
    slug: "events",
    name: "Events",
    dataSource: "analytics",      // declared with transport: "direct"
    properties: {
        city: { name: "City", type: "string" },
        code: { name: "Code", type: "string" }
    },
    admin: {
        browserCallbacks: {
            afterRead: ({ row }) => ({ ...row, label: [row.city, row.code].join(" · ") })
        }
    }
};
```

Dos reglas se derivan de «se envía a cada visitante», y ninguna es de estilo:

1. **Sin secretos.** Nada de claves de API, nada de `process.env`, nada que te importaría que un lector del bundle viera. Eso pertenece a `callbacks`.
2. **No es un límite de seguridad.** Un `browserCallbacks.afterRead` que oculta o anonimiza un campo lo hace *después* de que el navegador ya contiene la fila — en un transporte directo, el documento sin procesar provino directamente del almacén. Es presentación. La redacción u ocultamiento que deba ser estricto va en `callbacks`, o en las propias reglas del almacén.

En una colección con transporte de servidor — el valor predeterminado, y casi con certeza la tuya —, el servidor ya ha ejecutado `callbacks` antes de que la fila llegue al panel, por lo que un `browserCallbacks.afterRead` se ejecuta *además* de este. Escríbelo para que sea idempotente o no lo escribas.

## Definir callbacks

```typescript
import { defineCollection } from "@rebasepro/cms-types";

// The row shape is inferred from `properties`, so `values.title` below is a
// `string` without anything being written twice.
const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { name: "Title", type: "string" },
        slug: { name: "Slug", type: "string" },
        createdAt: { name: "Created at", type: "string" },
        updatedAt: { name: "Updated at", type: "string" }
    },
    callbacks: {
        beforeSave: async ({ values, id, status }) => {
            // Auto-generate slug from title
            if (values.title) {
                values.slug = values.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/(^-|-$)/g, "");
            }

            // Set timestamps
            if (status === "new") {
                values.createdAt = new Date().toISOString();
            }
            values.updatedAt = new Date().toISOString();

            return values;
        },

        afterSave: async ({ values, id }) => {
            // Send notification
            console.log(`Article ${id} saved: ${values.title}`);
        },

        beforeDelete: async ({ id }) => {
            // Prevent deletion of published articles
            // Throw to block the deletion
        },

        afterRead: async ({ row }) => {
            // Transform data after loading
            return row;
        }
    }
});
```

## Referencia de callbacks

### `beforeQuery`

<span class="since-badge" data-since="0.22">Desde 0.22</span> Se llama **antes de que se compile una lectura**, para restringir qué filas solicita. Devuelve condiciones para combinar mediante AND en la consulta; no devuelvas nada para no agregar ninguna.

```typescript
beforeQuery: ({
    operation,   // "list" | "get" | "count" | "aggregate" | "relation"
    query,       // the parsed read, read-only
    context
}) => {
    if (context.user?.roles?.includes("admin")) return;
    return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
}
```

`afterRead` ve filas que ya han sido obtenidas, por lo que puede ocultar un valor pero no puede evitar que la fila sea leída. Esto se ejecuta antes, y vale la pena conocer tres cosas al respecto:

- **Solo puede restringir.** El valor de retorno es un filtro para combinar mediante AND, y ningún valor que pueda devolver amplía la lectura. `filter` admite los mismos filtros de campo que una consulta; `logical` admite un grupo `or`/`and`, para un alcance como "míos, o compartidos conmigo" — aún combinado mediante AND en su conjunto, por lo que el `or` solo elige entre las filas que el resto de la consulta ya admite.
- **Se activa en cada ruta de lectura.** El listado, la obtención individual (get), el conteo, la agregación, la búsqueda, la lectura vectorial, un listado de rutas anidadas, la reobtención en tiempo real detrás de un `.listen()`, y las filas cargadas para una relación o un `?include=` — donde se aplica el hook de la colección **de destino**, porque esas son las filas de destino.
- **Un filtro que no se puede compilar rechaza la solicitud.** Nombrar una columna que la tabla no tiene devuelve un 400, nunca una condición descartada.

Una lectura deliberadamente no se restringe: la comprobación de unicidad detrás de `validation: { unique: true }`. Pregunta si un valor existe en cualquier lugar de la tabla, y si estuviera restringida respondería "único" para un valor que una fila oculta ya contiene.

:::caution[Solo para Postgres, por ahora]
`beforeQuery` está implementado por `@rebasepro/server-postgres`. Una colección servida por MongoDB o Firestore que declare uno **falla en el arranque**, por nombre, en lugar de servirse con el hook silenciosamente inerte — lo que para un filtro de filas significaría que cada fila se sirve a todo el mundo. Un `beforeQuery` [global](/docs/backend/hooks) falla en el arranque de la misma manera si alguna fuente de datos no es Postgres, y también lo hace uno adjuntado más tarde con `setCollectionCallbacks`. La ocultación/redacción que funciona en todos los motores es [`afterRead`](#afterread).
:::

→ [Extender el servidor](/docs/backend/extending#2-collection-callbacks) para ver dónde se ubica esto entre las demás opciones.

### `beforeSave`

Se llama antes de que un registro se escriba en la base de datos. Devuelve los valores modificados.

```typescript
beforeSave: async ({
    values,       // Entity values
    id,           // Entity ID (null for new entities)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Lanza un error para **bloquear el guardado**. La escritura nunca llega a la base de datos y quien realiza la llamada recibe un **400** con tu mensaje y el código `CALLBACK_REJECTED`:

```typescript
beforeSave: async ({ values }) => {
    if (values.price < 0) {
        throw new Error("Price cannot be negative");
    }
    return values;
}
```

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

Para elegir el estado y el código tú mismo — un 409 para un conflicto, un 422 para algo bien formado pero inaceptable —, lanza un `RebaseApiError`:

```typescript
import { RebaseApiError } from "@rebasepro/types";

beforeSave: async ({ values }) => {
    if (await isTaken(values.slug)) {
        throw new RebaseApiError("That slug is taken", { status: 409, code: "SLUG_TAKEN" });
    }
    return values;
}
```

:::note
Impórtalo desde `@rebasepro/types`, no desde `@rebasepro/server`. Un archivo de colección se comparte con el frontend — la compilación de Vite del panel de administración lee este mismo directorio —, por lo que solo puede importar paquetes que se ejecuten en un navegador. `RebaseApiError` es el seguro para el navegador, y es la misma clase que lanza el SDK del cliente.
:::

### `afterSave`

Se llama después de que se escribe la fila y antes del commit, dentro de la misma transacción. Lanzar un error revierte el guardado — consulta [Semántica de transacciones](#transaction-semantics).

```typescript
afterSave: async ({
    values,         // Saved values
    id,             // Entity ID
    previousValues, // Previous values (undefined for new entities)
    status,         // "new" | "existing" | "copy"
    context
}) => {
    // Same transaction as the save: the log row commits with the article or not at all
    await context.data.audit_log.create({ action: status, article_id: id, title: values.title });
}
```

### `afterSaveError`

Se llama cuando falla una operación de guardado.

```typescript
afterSaveError: async ({
    values,
    id,
    error,
    context
}) => {
    console.error("Save failed:", error);
}
```

### `afterRead`

Se llama después de leer entidades de la base de datos. Transforma los datos para su visualización.

```typescript
afterRead: async ({
    row,    // The row to transform
    context
}) => {
    // Add computed fields
    return {
        ...row,
        displayName: `${row.first_name} ${row.last_name}`
    };
}
```

### `beforeDelete`

Se llama antes de que se elimine un registro. Lanza un error para bloquear la eliminación.

```typescript
beforeDelete: async ({
    id,
    row,
    context
}) => {
    if (row.status === "published") {
        throw new Error("Cannot delete published articles. Unpublish first.");
    }
}
```

### `afterDelete`

Se llama después de que se elimina la fila y antes del commit, dentro de la misma transacción. Lanzar un error revierte la eliminación.

```typescript
afterDelete: async ({
    id,
    row,
    context
}) => {
    // Cleanup related data
    console.log(`Article ${id} deleted`);
}
```

## Callbacks de propiedades

También puedes definir callbacks a nivel de propiedad para transformaciones específicas de campos:

```typescript
properties: {
    email: {
        type: "string",
        name: "Email",
        callbacks: {
            beforeSave: ({ value }) => value?.toLowerCase().trim(),
            afterRead: ({ value }) => value // Could decrypt, etc.
        }
    }
}
```

## La API `context.data`

Cada callback recibe un objeto `context` que incluye `context.data` — una capa de acceso a datos unificada para realizar **operaciones entre colecciones** desde los hooks del ciclo de vida.

### Acceso a colecciones

`context.data` utiliza un Proxy de JavaScript, por lo que puedes acceder a cualquier colección mediante su slug como una propiedad:

```typescript
afterSave: async ({ values, entityId, context }) => {
    // Dynamic property access — works for any collection slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .collection() method for dynamic slugs
    const collectionName = "jobs";
    const accessor = context.data.collection(collectionName);
}
```

### Métodos disponibles

Cada descriptor de acceso a colección (`context.data.<slug>`) proporciona estos métodos:

| Método | Firma | Descripción |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Consultar entidades con filtros, ordenación y paginación |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Obtener una sola entidad por ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Crear una nueva entidad |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Actualizar una entidad existente |
| `.delete()` | `delete(id: string \| number) → void` | Eliminar un registro |
| `.count()` | `count(params?: FindParams) → number` | Contar entidades coincidentes |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Suscripción en tiempo real (donde sea compatible) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Escuchar una sola entidad |

### Consultar con `.find()`

El método `find()` admite un filtrado avanzado:

```typescript
afterSave: async ({ values, context }) => {
    // Simple equality
    const { data: activeJobs } = await context.data.jobs.find({
        where: { status: "published" },
        limit: 10,
        orderBy: ["createdAt", "desc"]
    });

    // PostgREST-style operators
    const { data: recentJobs } = await context.data.jobs.find({
        where: {
            status: "eq.published",
            salary: "gte.50000"
        }
    });

    // Tuple syntax
    const { data: expensiveJobs } = await context.data.jobs.find({
        where: {
            salary: [">=", 100000],
            role: ["in", ["admin", "manager"]]
        }
    });
}
```

### Crear entidades

```typescript
afterSave: async ({ values, entityId, previousValues, context }) => {
    // Promote an approved submission to a published job
    if (values.status === "approved" && previousValues?.status !== "approved") {
        const newJob = await context.data.jobs.create({
            title: values.title,
            description: values.description,
            company_id: values.company_id,
            status: "published",
            source_submission_id: entityId,
        });

        // Link back to the original submission
        await context.data["job-submissions"].update(entityId, {
            promoted_job_id: newJob.id,
        });
    }
}
```

### Seguridad: con qué privilegios se ejecuta `context.data`

:::important
**`context.data` hereda los privilegios de lo que haya activado el callback.** No es un nivel de confianza fijo.

- Activado por una **solicitud de usuario** (REST, realtime, una edición en el panel de administración) → **con alcance de usuario (user-scoped)**. El callback se ejecuta dentro de la transacción vinculada a RLS abierta para esa solicitud, por lo que las políticas se aplican tanto a lecturas *como* a escrituras. Un callback no puede ver una fila que quien realizó la llamada no pudo ver.
- Activado por **`rebase.dataAsAdmin` o un cron job** (el mismo singleton) → **con alcance de administrador (admin-scoped)**, no sin alcance (unscoped). Ese controlador tiene el alcance asignado como `{ uid: "service", roles: ["admin"] }`, por lo que el callback aún se ejecuta en una transacción vinculada a RLS — tus políticas se evalúan contra esa identidad.
- Activado por **el controlador base** (flujos de autenticación integrados, migraciones) → **sin alcance (unscoped)**. Se ejecuta en la conexión del propietario y omite RLS.
:::

Esto es especialmente relevante en la dirección que falla silenciosamente. RLS *filtra*, no genera excepciones — por lo tanto, un callback que lee una fila hermana la encontrará cuando se guarde una tarea de administración y puede no encontrar nada cuando guarde un usuario final, sin ningún error en ninguno de los casos. Escribe callbacks que toleren un resultado vacío, o accede deliberadamente al plano de administración:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a collection whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    await context.client.dataAsAdmin.audit_logs.create({ action: "approved" });
}
```

:::caution[Esta página solía decir lo contrario]
Las versiones anteriores de esta página indicaban que los callbacks siempre omitían RLS y tenían «acceso total a la base de datos independientemente de los permisos del usuario que los activara». Eso era incorrecto, y en el sentido inseguro — invitaba a escribir callbacks bajo el supuesto de que siempre podían ver todo.

El comportamiento anterior está verificado de extremo a extremo frente a Postgres mediante el caso `"scopes context.data to the caller when a callback runs on a user request"` en la suite de aplicación de RLS de `@rebasepro/server-postgres`.
:::

### Semántica de transacciones

:::important
**Las escrituras de `context.data` de un callback forman parte de la escritura que lo activó.** En Postgres, `beforeSave`, el guardado y `afterSave` — o `beforeDelete`, la eliminación y `afterDelete` — se ejecutan dentro de una transacción, esperando a cada callback antes del commit, y `context.data` escribe a través de esa misma transacción.
:::

Por lo tanto, la escritura desencadenante y todo lo que escribieron sus callbacks se confirman juntos o no se confirma nada:

- Si se lanza un error desde `afterSave` o `afterDelete`, se revierte la escritura desencadenante, junto con cada escritura de `context.data` realizada por los callbacks. A quien realizó la llamada se le responde con **400 `CALLBACK_REJECTED`** indicando en `details.stage` el nombre del hook — o con el estado propio del error cuando incluye uno: un `RebaseApiError` lanzado por ti, el 409 de una infracción de unicidad.
- Los suscriptores en tiempo real se enteran de la fila solo después del commit, por lo que una escritura que se revirtió nunca se anuncia.
- Un callback mantiene la transacción abierta mientras se ejecuta, por lo que uno lento mantiene un bloqueo activo y una conexión del pool ocupada.

Deja que un fallo lance una excepción cuando la escritura desencadenante no deba persistir ante él. Captúralo cuando sí deba: la escritura fallida se deshace por sí sola y el resto se confirma.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this collection again, which runs this callback
    // again: act on creates only, or it never stops.
    if (status !== "new") return;
    try {
        await context.data.jobs.create({ title: values.title, status: "published" });
    } catch (error) {
        // Only the failed create is undone. The submission and this marker commit.
        await context.data.job_submissions.update(id, {
            promotion_status: "failed",
            promotion_error: String(error)
        });
    }
}
```

El trabajo que tiene que salir de la base de datos — un correo electrónico, un webhook, una llamada a una API de terceros — no pertenece al cuerpo del callback. Mantendría la transacción abierta durante un viaje de ida y vuelta por la red (network round trip), y nada puede deshacerlo cuando la escritura se revierte. Encola un [trabajo (job)](/docs/backend/jobs) para ello, o realízalo después de que la escritura retorne: publica en un [canal en tiempo real](/docs/backend/realtime) o usa `waitUntil` en una [función personalizada](/docs/backend/custom-functions). La sección de [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) indica cuál se adapta mejor.

En MongoDB nada de esto aplica. Ese controlador ejecuta los mismos callbacks sin una transacción, por lo que la escritura ya está almacenada cuando se ejecuta `afterSave`, y lanzar un error allí reporta el fallo sin deshacerlo.

## Sincronizar datos entre colecciones

Uno de los usos más potentes de los callbacks es **sincronizar datos entre colecciones** utilizando `context.data`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const submissionsCollection = defineCollection({
    slug: "job_submissions",
    name: "Job Submissions",
    table: "job_submissions",
    properties: {
        title: { name: "Title", type: "string" },
        description: { name: "Description", type: "string" },
        company_id: { name: "Company", type: "string" },
        status: { name: "Status", type: "string" },
        promoted_job_id: { name: "Promoted job", type: "string" }
    },
    callbacks: {
        afterSave: async ({ values, id, previousValues, context }) => {
            // When a submission is approved, create a published job
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const newJob = await context.data.collection<Record<string, unknown>>("jobs").create({
                    title: values.title,
                    description: values.description,
                    company_id: values.company_id,
                    status: "published",
                    source_submission_id: id,
                });

                // Update the submission with the promoted job reference
                await context.data.collection<Record<string, unknown>>("job_submissions").update(id, {
                    promoted_job_id: newJob.id,
                });
            }
        }
    }
});
```

Otros patrones entre colecciones:

- **Eliminación en cascada**: Usa `afterDelete` para eliminar registros relacionados en colecciones secundarias
- **Desnormalización**: Usa `afterSave` para actualizar campos de resumen en una colección principal
- **Registro de auditoría**: Usa `afterSave` / `afterDelete` para escribir en una colección de registro de auditoría
- **Contadores**: Usa `afterSave` / `afterDelete` para actualizar campos de conteo en entidades relacionadas

## Referencia completa de context

Cada callback recibe un objeto `context` de tipo `RebaseCallContext`:

```typescript
interface RebaseCallContext {
    /** The authenticated user, if any */
    user?: User;
    /** The driver running this operation (server-side only) */
    driver?: DataDriver;
    /** The query accessor — context.data.<slug>.create/update/find/delete */
    data: RebaseSdkData;
    /** Functions, storage, email and dataAsAdmin — but no `data` */
    client: RebaseCallbackClient;
    /** The default storage source */
    storageSource: StorageSource;
}
```

Consulta a través de `context.data`. `context.client` no tiene `data`: en el lado del servidor es el singleton `rebase`, cuyo único plano de datos es `dataAsAdmin` con alcance de administrador, por lo que `context.client.data` es un error de compilación.

## Siguientes pasos

- **[Reglas de seguridad](/docs/collections/security-rules)** — Row Level Security (Seguridad a nivel de fila)
- **[Historial de entidades](/docs/backend/history)** — Registro de auditoría
- **[Funciones personalizadas](/docs/backend/custom-functions)** — Agregar endpoints de API personalizados
