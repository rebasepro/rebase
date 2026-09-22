---
sourceHash: a45467350cfc4cad
title: Callbacks de entidades
sidebar_label: Callbacks
description: Usa callbacks de ciclo de vida para ejecutar lógica personalizada cuando las entidades se crean, actualizan, leen o eliminan. Incluye la API context.data para operaciones entre colecciones.
---

## Descripción general

Los callbacks te permiten engancharte al ciclo de vida de la entidad para:

- **Sincronizar datos entre colecciones**: copiar o mover entidades entre tablas ante cambios de estado
- **Transformar datos** antes de guardar (campos calculados, generación de slugs)
- **Validar** reglas de negocio más allá de la validación de esquemas
- **Desencadenar efectos secundarios** después de escribir (enviar correos electrónicos, sincronizar APIs, actualizar cachés)
- **Restringir una lectura** antes de que se compile, para que quien llama solo vea sus propias filas
- **Filtrar/transformar** datos después de leer
- **Operaciones en cascada**: limpiar registros relacionados al eliminar

## Dónde se ejecutan los callbacks

Una colección tiene dos bloques de callbacks, y la única diferencia es qué entorno de ejecución los ejecuta.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Se ejecuta en | el servidor | el panel de administración, en el navegador |
| Se activa para | REST, el SDK, tiempo real, `dataAsAdmin` | lecturas y escrituras que realiza el panel |
| Llega al navegador | no — los cuerpos se eliminan del bundle | sí, en su totalidad |
| Usar para | todo lo siguiente | colecciones con las que el panel se comunica directamente |

**`callbacks` es el que buscas.** Se ejecuta en cada ruta que llega al servidor, por lo que nada lo elude, y su cuerpo nunca sale de la máquina — una clave de API o una lectura de `process.env` allí es segura. El resto de esta página trata sobre `callbacks`.

`admin.browserCallbacks` existe para un caso: una colección en un transporte `direct` o `custom`, que el panel lee y escribe *por sí mismo* sin un servidor Rebase en la ruta de la solicitud. Nada en el lado del servidor ve esas operaciones, por lo que `callbacks` nunca se activará para ellas, y este bloque es el único lugar donde puede residir su lógica de ciclo de vida.

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

1. **Sin secretos.** Nada de claves de API, ni `process.env`, ni nada que te importaría que viera un lector del bundle. Eso pertenece a `callbacks`.
2. **No es una barrera de seguridad.** Un `browserCallbacks.afterRead` que oculta un campo lo hace *después* de que el navegador ya tiene la fila — en un transporte directo, el documento sin procesar provino directamente del almacén de datos. Es presentación. La ocultación que deba mantenerse firme va en `callbacks`, o en las propias reglas del almacén de datos.

En una colección con transporte de servidor — el predeterminado, y casi con certeza el tuyo —, el servidor ya ha ejecutado `callbacks` antes de que la fila llegue al panel, por lo que un `browserCallbacks.afterRead` se ejecuta *además* de él. Escríbelo para que sea idempotente, o no lo escribas.

## Definición de callbacks

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

Se llama **antes de compilar una lectura**, para limitar qué filas solicita. Devuelve condiciones para aplicar con AND a la consulta; no devuelvas nada para no añadir ninguna.

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

`afterRead` ve las filas que ya se han obtenido, por lo que puede ocultar un valor pero no puede evitar que la fila se lea. Esto se ejecuta antes, y vale la pena conocer tres cosas al respecto:

- **Solo puede restringir.** El valor de retorno es un filtro para combinar mediante AND, y ningún valor que pueda devolver amplía la lectura. `filter` admite los mismos filtros de campo que una consulta; `logical` admite un grupo `or`/`and`, para un alcance como "míos, o compartidos conmigo" — aún así combinado con AND en su totalidad, por lo que el `or` solo elige entre las filas que el resto de la consulta ya admite.
- **Se activa en cada ruta de lectura.** El listado, la obtención individual (get), el recuento (count), el agregado, la búsqueda, la lectura vectorial, un listado de ruta anidada, la reobtención en tiempo real detrás de un `.listen()`, y las filas cargadas para una relación o un `?include=` — donde se aplica el hook de la colección **de destino**, porque esas son las filas de destino.
- **Un filtro que no pueda compilar rechaza la solicitud.** Nombrar una columna que la tabla no tiene es un 400, nunca una condición descartada.
- **Una escritura en una fila que excluye es un 404.** Una actualización o una eliminación dirigida a una fila fuera del alcance se rechaza antes de la escritura, con la misma respuesta de "no hay fila…" que da una lectura — por lo que un alcance es un alcance tanto para escrituras como para lecturas. Lo que *no* filtra son los valores que se están escribiendo: rechazar una escritura por su contenido corresponde a `beforeSave`.

Una lectura deliberadamente no se restringe: la comprobación de unicidad detrás de `validation: { unique: true }`. Pregunta si un valor existe en cualquier parte de la tabla, y si estuviera restringida respondería "único" para un valor que una fila oculta ya contiene.

:::caution[Solo Postgres, por ahora]
`beforeQuery` está implementado por `@rebasepro/server-postgres`. Una colección servida por MongoDB o Firestore que declare uno **falla al arrancar**, por nombre, en lugar de servirse con el hook silenciosamente inerte — lo que para un filtro de filas significaría que cada fila se sirve a todo el mundo. Un `beforeQuery` [global](/docs/backend/hooks) falla al arrancar de la misma manera si algún origen de datos no es Postgres, y también lo hace uno adjuntado más tarde con `setCollectionCallbacks`. La ocultación de campos que funciona en todos los motores es [`afterRead`](#afterread).
:::

→ [Extender el servidor](/docs/backend/extending#2-collection-callbacks) para ver dónde se sitúa esto entre las demás opciones.

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

Lanza un error para **bloquear el guardado**. La escritura nunca llega a la base de datos y quien llama recibe un **400** con tu mensaje y el código `CALLBACK_REJECTED`:

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
Impórtalo desde `@rebasepro/types`, no desde `@rebasepro/server`. Un archivo de colección se comparte con el frontend — la compilación Vite del panel de administración lee este mismo directorio —, por lo que solo puede importar paquetes que se ejecuten en un navegador. `RebaseApiError` es el seguro para el navegador, y es la misma clase que lanza el SDK del cliente.
:::

### `afterSave`

Se llama después de que la fila se escribe y antes del commit, dentro de la misma transacción. Lanzar un error revierte el guardado — consulta [Semántica de transacciones](#transaction-semantics).

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

También puedes definir callbacks a nivel de propiedad para transformaciones específicas de cada campo:

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

Cada callback recibe un objeto `context` que incluye `context.data` — una capa unificada de acceso a datos para realizar **operaciones entre colecciones** desde los hooks de ciclo de vida.

### Acceso a colecciones

`context.data` utiliza un Proxy de JavaScript, por lo que puedes acceder a cualquier colección mediante su slug como propiedad:

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

Cada descriptor de acceso a la colección (`context.data.<slug>`) proporciona estos métodos:

| Método | Firma | Descripción |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Consulta entidades con filtros, ordenación y paginación |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Obtiene una sola entidad por ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Crea una nueva entidad |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Actualiza una entidad existente |
| `.delete()` | `delete(id: string \| number) → void` | Elimina un registro |
| `.count()` | `count(params?: FindParams) → number` | Cuenta las entidades que coinciden |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Suscripción en tiempo real (donde sea compatible) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Escucha una sola entidad |

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

- Activado por una **solicitud de usuario** (REST, tiempo real, una edición en el panel de administración) → **con alcance de usuario**. El callback se ejecuta dentro de la transacción vinculada a RLS abierta para esa solicitud, por lo que las políticas se aplican tanto a lecturas *como* a escrituras. Un callback no puede ver una fila que quien llama no pueda ver.
- Activado por **`rebase.dataAsAdmin` o un cron job** (el mismo singleton) → **con alcance de administrador**, no sin alcance. Ese driver tiene un alcance establecido como `{ uid: "service", roles: ["admin"] }`, por lo que el callback todavía se ejecuta en una transacción vinculada a RLS — tus políticas se evalúan contra esa identidad.
- Activado por **el driver base** (flujos de autenticación integrados, migraciones) → **sin alcance**. Se ejecuta en la conexión del propietario y omite RLS.
:::

Esto importa más en la dirección que falla silenciosamente. RLS *filtra*, no genera excepciones — por lo que un callback que lee una fila hermana la encontrará cuando una tarea de administrador guarde y puede que no encuentre nada cuando un usuario final guarde, sin errores en ningún caso. Escribe callbacks que toleren un resultado vacío, o recurre al plano de administración deliberadamente:

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
Las versiones anteriores de esta página indicaban que los callbacks siempre omitían RLS y tenían "acceso completo a la base de datos independientemente de los permisos del usuario que los activaba". Eso era incorrecto, e incorrecto en el sentido inseguro — invitaba a escribir callbacks asumiendo que siempre podrían ver todo.

El comportamiento anterior está verificado de extremo a extremo en Postgres mediante el caso `"scopes context.data to the caller when a callback runs on a user request"` en la suite de aplicación de RLS de `@rebasepro/server-postgres`.
:::

### Semántica de transacciones

:::important
**Las escrituras con `context.data` de un callback forman parte de la escritura que lo activó.** En Postgres, `beforeSave`, el guardado y `afterSave` — o `beforeDelete`, la eliminación y `afterDelete` — se ejecutan dentro de una sola transacción, esperando a cada callback antes del commit, y `context.data` escribe a través de esa misma transacción.
:::

Por lo tanto, la escritura desencadenante y todo lo que escribieron sus callbacks se confirman juntos o no se confirma nada:

- Lanzar un error desde `afterSave` o `afterDelete` revierte la escritura desencadenante, junto con cada escritura de `context.data` que hicieron los callbacks. A quien llama se le responde **400 `CALLBACK_REJECTED`** con `details.stage` indicando el hook — o con el propio estado del error cuando lleva uno: un `RebaseApiError` que hayas lanzado, el 409 de una infracción de unicidad.
- Los suscriptores en tiempo real se enteran de la fila solo después del commit, por lo que una escritura que se revirtió nunca se anuncia.
- Un callback mantiene la transacción abierta mientras se ejecuta, por lo que uno lento representa un bloqueo retenido y una conexión del pool ocupada.

Deja que un fallo lance un error cuando la escritura desencadenante no deba sobrevivir a él. Captúralo cuando sí deba: solo se deshace la escritura fallida y el resto se confirma.

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

El trabajo que deba salir de la base de datos — un correo electrónico, un webhook, una llamada a una API de terceros — no pertenece al cuerpo del callback. Mantendría la transacción abierta durante un viaje de ida y vuelta por la red, y nada puede revertirlo cuando la escritura se revierte. Ponlo en cola en un [job](/docs/backend/jobs), o hazlo después de que la escritura retorne: publica en un [canal en tiempo real](/docs/backend/realtime), o usa `waitUntil` en una [función personalizada](/docs/backend/custom-functions). La sección de [hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) indica cuál se adapta mejor.

En MongoDB nada de esto aplica. Ese driver ejecuta los mismos callbacks sin transacción, por lo que la escritura ya está almacenada cuando se ejecuta `afterSave`, y lanzar un error allí informa del fallo sin deshacerlo.

## Sincronización de datos entre colecciones

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
- **Contadores**: Usa `afterSave` / `afterDelete` para actualizar campos de recuento en entidades relacionadas

## Referencia completa de Context

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

Realiza consultas a través de `context.data`. `context.client` no tiene `data`: en el lado del servidor es el singleton `rebase`, cuyo único plano de datos es `dataAsAdmin` con alcance de administrador, por lo que `context.client.data` genera un error de compilación.

## Próximos pasos

- **[Reglas de seguridad](/docs/collections/security-rules)** — Seguridad a nivel de fila (Row Level Security)
- **[Historial de entidades](/docs/backend/history)** — Registro de auditoría
- **[Funciones personalizadas](/docs/backend/custom-functions)** — Añadir endpoints de API personalizados
