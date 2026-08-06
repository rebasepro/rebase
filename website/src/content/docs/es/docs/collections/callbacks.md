---
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

## Definición de Callbacks

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

// The row shape. Without it every `values.x` below is `unknown`.
type Article = {
    title: string;
    slug: string;
    created_at: string;
    updated_at: string;
};

const articlesCollection: PostgresCollectionConfig<Article> = {
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { name: "Title", type: "string" },
        slug: { name: "Slug", type: "string" },
        created_at: { name: "Created at", type: "string" },
        updated_at: { name: "Updated at", type: "string" }
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
                values.created_at = new Date().toISOString();
            }
            values.updated_at = new Date().toISOString();

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
    },
    properties: { /* ... */ }
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
    return { ...values, updated_at: new Date() };
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

Se invoca después de una operación de guardar exitosa. Utilícelo para efectos secundarios.

```typescript
afterSave: async ({
    values,         // Saved values
    entityId,       // Entity ID
    previousValues, // Previous values (null for new entities)
    status,         // "new" | "existing" | "copy"
    context
}) => {
    // Send webhook
    await fetch("https://api.slack.com/webhook", {
        method: "POST",
        body: JSON.stringify({ text: `New article: ${values.title}` })
    });
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

Se invoca después de una eliminación exitosa.

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
        orderBy: ["created_at", "desc"]
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
- Activado por **trabajo en contexto de servidor** (`rebase.dataAsAdmin`, una tarea cron) → **sin ámbito**. Se ejecuta sobre la conexión propietaria y omite RLS.
:::

Esto importa sobre todo en la dirección que falla en silencio. RLS *filtra*, no lanza errores — así que un callback que lee una fila hermana la encontrará cuando guarde una tarea de administración y puede no encontrar nada cuando guarde un usuario final, sin error en ninguno de los dos casos. Escribe callbacks que toleren un resultado vacío, o recurre al plano de administración de forma deliberada:

```typescript
afterSave: async ({ context }) => {
    // Con ámbito de usuario cuando un usuario activó este guardado: se aplica RLS.
    await context.data.audit_logs.create({ action: "approved" });

    // Omitir RLS deliberadamente — para trabajo que el llamante realmente no
    // debe ver, como un registro de auditoría que no puede leer ni editar.
    await context.client.dataAsAdmin.audit_logs.create({ action: "approved" });
}
```

:::caution[Esta página decía lo contrario]
Versiones anteriores de esta página afirmaban que los callbacks siempre omiten RLS y tienen «acceso completo a la base de datos independientemente de los permisos del usuario que lo activa». Eso era incorrecto, e incorrecto en la dirección insegura — invitaba a escribir callbacks asumiendo que siempre podían verlo todo.

El comportamiento descrito arriba está verificado de extremo a extremo contra Postgres por el caso `"scopes context.data to the caller when a callback runs on a user request"` de la suite de aplicación de RLS de `@rebasepro/server-postgres`.
:::

### Semántica de Transacciones

:::warning
**Las operaciones de `context.data` NO se envuelven automáticamente en la misma transacción que el guardado que las activa.**

El guardado de la entidad original completa primero su transacción de base de datos. Luego se ejecuta `afterSave` y cualquier llamada a `context.data` abre **transacciones separadas**. Si una operación de `context.data` falla en `afterSave`, el guardado original **no se revierte**.
:::

Esto significa:

-   ✅ El guardado que activa la operación siempre se realiza con éxito de forma independiente
-   ⚠️ Las escrituras de efectos secundarios pueden fallar sin afectar la operación original
-   ⚠️ No hay garantía de atomicidad entre el guardado original y las llamadas `context.data` subsiguientes

Para operaciones que deben ser atómicas, envuélvalas en manejo de errores:

```typescript
afterSave: async ({ values, entityId, context }) => {
    try {
        await context.data.jobs.create({
            title: values.title,
            status: "published",
        });
    } catch (error) {
        // Log the failure — the original save already succeeded
        console.error(`Failed to promote job from submission ${entityId}:`, error);
        // Optionally: mark the submission as "promotion_failed"
        await context.data["job-submissions"].update(entityId, {
            promotion_status: "failed",
            promotion_error: String(error),
        });
    }
}
```

## Sincronización de Datos entre Colecciones

Uno de los usos más potentes de los callbacks es la **sincronización de datos entre colecciones** utilizando `context.data`:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

type Submission = {
    title: string;
    description: string;
    company_id: string;
    status: string;
    promoted_job_id: string;
};

const submissionsCollection: PostgresCollectionConfig<Submission> = {
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
    },
    properties: { /* ... */ }
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
    /** The underlying data driver (PostgresBackendDriver) */
    driver: DataDriver;
    /** Unified data access — context.data.<slug>.create/update/find/delete */
    data: RebaseData;
}
```

## Próximos Pasos

-   **[Reglas de Seguridad](/docs/collections/security-rules)** — Seguridad a Nivel de Fila
-   **[Historial de Entidades](/docs/backend/history)** — Registro de auditoría
-   **[Funciones Personalizadas](/docs/backend/custom-functions)** — Añadir endpoints de API personalizados

---
