---
sourceHash: 13eea3897cdb7bee
title: Callbacks de Entidad
sidebar_label: Callbacks
description: Utilice los callbacks del ciclo de vida para ejecutar lógica personalizada cuando las entidades son creadas, actualizadas, leídas o eliminadas. Incluye la API `context.data` para operaciones entre colecciones.
---

## Resumen

Los callbacks le permiten integrar su lógica en el ciclo de vida de la entidad para:

-   **Sincronizar datos entre colecciones** — copiar o mover entidades entre tablas en cambios de estado
-   **Transformar datos** antes de guardar (campos calculados, slugificación)
-   **Validar** reglas de negocio más allá de la validación de esquemas
-   **Disparar efectos secundarios** después de las escrituras (enviar correos electrónicos, sincronizar APIs, actualizar cachés)
-   **Filtrar/transformar** datos después de la lectura
-   **Operaciones en cascada** — limpiar registros relacionados al eliminar

## Dónde se ejecutan los callbacks

Una colección tiene dos bloques de callbacks, y la única diferencia es qué runtime los ejecuta.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Se ejecuta en | el servidor | el panel de administración, en el navegador |
| Se dispara para | REST, el SDK, realtime, `dataAsAdmin` | lecturas y escrituras que hace el panel |
| Llega al navegador | no — los cuerpos se eliminan del bundle | sí, íntegros |
| Usar para | todo lo que sigue | colecciones con las que el panel habla directamente |

**`callbacks` es el que quieres.** Se ejecuta en cada ruta que llega al
servidor, así que nada lo esquiva, y su cuerpo nunca sale de la máquina: una
clave de API o una lectura de `process.env` ahí está a salvo. El resto de esta
página trata sobre `callbacks`.

`admin.browserCallbacks` existe para un solo caso: una colección en un transporte
`direct` o `custom`, que el panel lee y escribe *por sí mismo*, sin ningún
servidor Rebase en la ruta de la petición. Nada del lado del servidor ve esas
operaciones, así que `callbacks` nunca puede dispararse para ellas, y este bloque
es el único sitio donde puede vivir su lógica de ciclo de vida.

```typescript
import type { CollectionConfig } from "@rebasepro/types";

const eventsCollection: CollectionConfig = {
    slug: "events",
    name: "Events",
    dataSource: "analytics",      // declarado con transport: "direct"
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

Dos reglas se siguen de "llega a cada visitante", y ninguna es estilística:

1. **Sin secretos.** Nada de claves de API, nada de `process.env`, nada que te
   importaría que leyera quien mire el bundle. Eso va en `callbacks`.
2. **No es una frontera de seguridad.** Un `browserCallbacks.afterRead` que
   oculta un campo lo oculta *después* de que el navegador ya tiene la fila — en
   un transporte directo el documento crudo vino directamente del almacén. Es
   presentación. La ocultación que debe sostenerse va en `callbacks`, o en las
   reglas del propio almacén.

En una colección con transporte de servidor — la predeterminada, y casi
seguramente la tuya — el servidor ya ejecutó `callbacks` antes de que la fila
llegue al panel, así que un `browserCallbacks.afterRead` se ejecuta *además* de
él. Escríbelo idempotente, o no lo escribas.

## Definición de Callbacks

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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

        afterSave: async ({ values, entityId }) => {
            // Send notification
            console.log(`Article ${entityId} saved: ${values.title}`);
        },

        beforeDelete: async ({ entityId }) => {
            // Prevent deletion of published articles
            // Throw to block the deletion
        },

        afterRead: async ({ entity }) => {
            // Transform data after loading
            return entity;
        }
    }
});
```

## Referencia de Callbacks

### `beforeSave`

Se invoca antes de que una entidad sea escrita en la base de datos. Devuelve los valores modificados.

```typescript
beforeSave: async ({
    values,       // Entity values
    entityId,     // Entity ID (null for new entities)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Lanza un error para **bloquear la acción de guardar**:

```typescript
beforeSave: async ({ values }) => {
    if (values.price < 0) {
        throw new Error("Price cannot be negative");
    }
    return values;
}
```

### `afterSave`

Se invoca después de escribir la fila y antes del commit, dentro de la misma transacción. Un error revierte el guardado; consulta [Semántica de Transacciones](#semántica-de-transacciones).

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

Se invoca cuando una operación de guardar falla.

```typescript
afterSaveError: async ({
    values,
    entityId,
    error,
    context
}) => {
    console.error("Save failed:", error);
}
```

### `afterRead`

Se invoca después de leer entidades de la base de datos. Transforma los datos para su visualización.

```typescript
afterRead: async ({
    entity,    // The entity to transform
    context
}) => {
    // Add computed fields
    return {
        ...entity,
        values: {
            ...entity.values,
            displayName: `${entity.values.first_name} ${entity.values.last_name}`
        }
    };
}
```

### `beforeDelete`

Se invoca antes de que una entidad sea eliminada. Lanza un error para bloquear la eliminación.

```typescript
beforeDelete: async ({
    entityId,
    entity,
    context
}) => {
    if (entity.values.status === "published") {
        throw new Error("Cannot delete published articles. Unpublish first.");
    }
}
```

### `afterDelete`

Se invoca después de borrar la fila y antes del commit, dentro de la misma transacción. Un error revierte el borrado.

```typescript
afterDelete: async ({
    entityId,
    entity,
    context
}) => {
    // Cleanup related data
    console.log(`Article ${entityId} deleted`);
}
```

## Callbacks de Propiedad

También puede definir callbacks a nivel de propiedad para transformaciones específicas de campo:

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

Cada callback recibe un objeto `context` que incluye `context.data` — una capa unificada de acceso a datos para realizar **operaciones entre colecciones** desde los hooks del ciclo de vida.

### Acceso a Colecciones

`context.data` utiliza un Proxy de JavaScript, por lo que puede acceder a cualquier colección por su slug como una propiedad:

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

### Métodos Disponibles

Cada accesor de colección (`context.data.<slug>`) proporciona estos métodos:

| Método | Firma | Descripción |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Consulta entidades con filtros, ordenación y paginación |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Obtiene una sola entidad por ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Crea una nueva entidad |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Actualiza una entidad existente |
| `.delete()` | `delete(id: string \| number) → void` | Elimina una entidad |
| `.count()` | `count(params?: FindParams) → number` | Cuenta las entidades coincidentes |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Suscripción en tiempo real (donde sea compatible) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Escucha a una sola entidad |

### Consultas con `.find()`

El método `find()` soporta filtrado avanzado:

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

### Creando Entidades

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
**`context.data` hereda los privilegios de aquello que activó el callback.** No es un nivel de confianza fijo.

- Activado por una **petición de usuario** (REST, tiempo real, una edición en el panel de administración) → **con ámbito de usuario**. El callback se ejecuta dentro de la transacción sujeta a RLS abierta para esa petición, por lo que las políticas se aplican tanto a lecturas *como* a escrituras. Un callback no puede ver una fila que su llamante no pudiera ver.
- Activado por **`rebase.dataAsAdmin` o una tarea cron** (el mismo singleton) → **con ámbito de administrador**, no sin ámbito. Ese driver está limitado a `{ uid: "service", roles: ["admin"] }`, así que el callback sigue ejecutándose en una transacción sujeta a RLS: tus políticas se evalúan, contra esa identidad.
- Activado por **el driver base** (los flujos de autenticación integrados, las migraciones) → **sin ámbito**. Se ejecuta sobre la conexión propietaria y omite RLS.
:::

Esto importa sobre todo en la dirección que falla en silencio. RLS *filtra*, no lanza errores — así que un callback que lee una fila hermana la encontrará cuando guarde una tarea de administración y puede no encontrar nada cuando guarde un usuario final, sin error en ninguno de los dos casos. Escribe callbacks que toleren un resultado vacío, o recurre al plano de administración de forma deliberada:

```typescript
afterSave: async ({ context }) => {
    // Con ámbito de usuario cuando un usuario activó este guardado: se aplica RLS.
    await context.data.audit_logs.create({ action: "approved" });

    // Ámbito de administrador deliberado — para trabajo que el llamante
    // realmente no debe ver, como un registro de auditoría que no puede leer ni
    // editar. Ojo: es el alcance de un administrador, no una omisión de RLS: una
    // colección cuya única regla sea `policy.serverContext()` le sigue estando
    // cerrada, porque eso compila a `rebase.uid() IS NULL` y el uid de este
    // accesor es `service`.
    await context.client.dataAsAdmin.audit_logs.create({ action: "approved" });
}
```

:::caution[Esta página decía lo contrario]
Versiones anteriores de esta página afirmaban que los callbacks siempre omiten RLS y tienen «acceso completo a la base de datos independientemente de los permisos del usuario que lo activa». Eso era incorrecto, e incorrecto en la dirección insegura — invitaba a escribir callbacks asumiendo que siempre podían verlo todo.

El comportamiento descrito arriba está verificado de extremo a extremo contra Postgres por el caso `"scopes context.data to the caller when a callback runs on a user request"` de la suite de aplicación de RLS de `@rebasepro/server-postgres`.
:::

### Semántica de Transacciones

:::important
**Lo que un callback escribe con `context.data` forma parte de la escritura que lo activó.** En Postgres, `beforeSave`, el guardado y `afterSave` —o `beforeDelete`, el borrado y `afterDelete`— se ejecutan dentro de una sola transacción; cada callback se espera antes del commit, y `context.data` escribe a través de esa misma transacción.
:::

Así que la escritura que lo activa y todo lo que escribieron sus callbacks se confirman juntos o no se confirman:

-   Un error lanzado en `afterSave` o `afterDelete` revierte la escritura que lo activó, junto con cada escritura que los callbacks hicieron con `context.data`. Al llamante se le responde **400 `CALLBACK_REJECTED`**, con `details.stage` indicando el hook, o con el estado propio del error cuando lo trae: un `RebaseApiError` que lanzaste, el 409 de una violación de unicidad.
-   Los suscriptores en tiempo real se enteran de la fila solo después del commit, así que una escritura revertida nunca se anuncia.
-   Un callback mantiene la transacción abierta mientras se ejecuta, así que uno lento es un bloqueo mantenido y una conexión del pool ocupada.

Deja que el error se propague cuando la escritura que lo activó no deba sobrevivirle. Captúralo cuando sí deba: la escritura fallida se deshace por sí sola y el resto se confirma.

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

El trabajo que tiene que salir de la base de datos —un correo, un webhook, una llamada a una API de terceros— no va en el cuerpo del callback. Mantendría la transacción abierta durante un viaje de ida y vuelta por la red, y nada puede deshacerlo cuando la escritura se revierte. Encola un [job](/docs/backend/jobs) para ello, o hazlo después de que la escritura regrese: publica en un [canal en tiempo real](/docs/backend/realtime) o usa `waitUntil` en una [función personalizada](/docs/backend/custom-functions). [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) explica cuál conviene.

En MongoDB nada de esto se cumple. Ese driver ejecuta los mismos callbacks sin transacción, así que la escritura ya está guardada cuando se ejecuta `afterSave`, y un error ahí informa del fallo sin deshacer la escritura.

## Sincronización de Datos entre Colecciones

Uno de los usos más potentes de los callbacks es la **sincronización de datos entre colecciones** utilizando `context.data`:

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
                await context.data["job-submissions"].update(entityId, {
                    promoted_job_id: newJob.id,
                });
            }
        }
    }
});
```

Otros patrones entre colecciones:

-   **Eliminación en cascada**: Utilice `afterDelete` para eliminar registros relacionados en colecciones secundarias
-   **Desnormalización**: Utilice `afterSave` para actualizar campos de resumen en una colección padre
-   **Registro de auditoría**: Utilice `afterSave` / `afterDelete` para escribir en una colección de registro de auditoría
-   **Contadores**: Utilice `afterSave` / `afterDelete` para actualizar campos de recuento en entidades relacionadas

## Referencia Completa del Contexto

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

Consulta a través de `context.data`. `context.client` no tiene `data`: en el
servidor es el singleton `rebase`, cuyo único plano de datos es `dataAsAdmin`,
con ámbito de administrador, así que `context.client.data` es un error de
compilación.

## Próximos Pasos

-   **[Reglas de Seguridad](/docs/collections/security-rules)** — Seguridad a Nivel de Fila
-   **[Historial de Entidades](/docs/backend/history)** — Registro de auditoría
-   **[Funciones Personalizadas](/docs/backend/custom-functions)** — Añadir endpoints de API personalizados

---
