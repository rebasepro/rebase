---
sourceHash: 52f080ffe0793036
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

**`callbacks` es el que buscas.** Se ejecuta en cada ruta de datos que llega al
servidor — REST, el SDK, tiempo real, MCP y `rebase.data` — y su cuerpo nunca
sale de la máquina, por lo que una clave de API o una lectura de `process.env`
allí es segura. El resto de esta página trata sobre `callbacks`.

Hay un escritor que no es una ruta de datos: **el sistema de autenticación**.
El registro, el inicio de sesión por OAuth y la gestión de usuarios del
administrador escriben las filas de usuarios directamente y no ejecutan
ninguno de sus callbacks, así que un correo de bienvenida en `afterSave` sobre
`users` nunca se activa en el registro. Cuélgalo de los
[hooks de autenticación](/docs/backend/authentication/) que se pasan en
`auth.hooks` — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` —, que
requieren un backend con `eject`; el arranque avisa cuando la colección de
usuarios declara callbacks que el registro no ejecutará.

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

Un `browserCallbacks.afterSave` se ejecuta después de que la escritura se haya almacenado, y
nada en el navegador puede revertirla. Un error lanzado desde él se muestra como una advertencia;
el guardado en sí se da por hecho, de modo que el formulario no ofrece crear
el registro por segunda vez.

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
            // Throw (or return false) to block the deletion
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
- **Una escritura en una fila que excluye es un 404.** Una actualización o una eliminación dirigida a una fila fuera del alcance se rechaza antes de la escritura, con la misma respuesta de "no hay fila…" que da una lectura — por lo que un alcance es un alcance tanto para escrituras como para lecturas. Una escritura de pertenencia uno-a-muchos (`comments: [ids]` en un post) deja donde está a un hijo que el alcance del destino oculta, igual que deja un id que no nombra ninguna fila. Lo que *no* filtra son los valores que se están escribiendo: rechazar una escritura por su contenido corresponde a `beforeSave`.

Una lectura deliberadamente no se restringe: la comprobación de unicidad detrás de `validation: { unique: true }`. Pregunta si un valor existe en cualquier parte de la tabla, y si estuviera restringida respondería "único" para un valor que una fila oculta ya contiene.

:::caution[Solo Postgres, por ahora]
`beforeQuery` está implementado por `@rebasepro/server-postgres`. Una colección servida por MongoDB o Firestore que declare uno **falla al arrancar**, por nombre, en lugar de servirse con el hook silenciosamente inerte — lo que para un filtro de filas significaría que cada fila se sirve a todo el mundo. Un `beforeQuery` [global](/docs/backend/hooks) falla al arrancar de la misma manera si algún origen de datos no es Postgres, y también lo hace uno adjuntado más tarde con `setCollectionCallbacks`. La ocultación de campos que funciona en todos los motores es [`afterRead`](#afterread).
:::

→ [Extender el servidor](/docs/backend/extending#2-collection-callbacks) para ver dónde se sitúa esto entre las demás opciones.

### `beforeSave`

Se llama antes de que un registro se escriba en la base de datos. Devuelve los valores modificados.
En Postgres se ejecuta dentro de la transacción de la escritura, que ya ha comenzado,
así que retiene una conexión del pool mientras se ejecuta — consulta [Un callback retiene una
conexión](/docs/collections/context-data-api#a-callback-holds-a-connection).

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
Impórtalo desde `@rebasepro/types`, no desde `@rebasepro/server`. Un archivo de colección se comparte con el frontend — la compilación Vite del panel de administración lee este mismo directorio —, por lo que solo puede importar paquetes que se ejecuten en un navegador. `RebaseApiError` es el seguro para el navegador, y es la misma clase que lanza el SDK tipado.
:::

### `afterSave`

Se llama después de que la fila se escribe y antes del commit, dentro de la misma transacción. Lanzar un error revierte el guardado — consulta [Semántica de transacciones](/docs/collections/context-data-api#transaction-semantics).

```typescript
afterSave: async ({
    values,         // Saved values: the row as stored, not afterRead's view of it
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

Se ejecuta para un guardado que falló en la base de datos o después de ella —
no para un rechazo de `beforeSave`, una solicitud rechazada antes de la
escritura (validación, un permiso faltante, un 404), ni un commit rechazado
después de que el guardado retornara ([lista completa](/docs/backend/hooks/#when-aftersaveerror-runs)).

En una solicitud, se ejecuta una vez que la transacción de la escritura fallida se ha revertido, no dentro de ella. Su `context.data` es uno nuevo, para la misma identidad de quien llama, en el que cada llamada es una transacción propia, por lo que un [job](/docs/backend/jobs), mensaje de cola o webhook que encole se confirma y sobrevive al fallo del que informa. Un error lanzado desde `afterSaveError` se registra en el log, y quien llama sigue recibiendo el error del propio guardado.

### `afterRead`

Se llama después de leer entidades de la base de datos. Transforma los datos para su visualización.

Da forma a lo que recibe quien llama — la respuesta de una lectura o de una
escritura, y su frame en tiempo real — y nada más: `afterSave`, `beforeDelete`,
`afterDelete` y el [historial](/docs/backend/history) obtienen la fila tal
como se almacenó: un valor enmascarado aquí nunca es lo que registra una
auditoría ni lo que escribe de vuelta un revert, y un campo añadido aquí nunca
se escribe.

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

Se llama antes de que se elimine un registro. Lanza un error para bloquear la eliminación, y quien llama recibe `400 CALLBACK_REJECTED` con tu mensaje. Devolver `false` también la bloquea, como `403 CALLBACK_REJECTED` sin ningún mensaje tuyo.

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

Cada callback recibe además `context.data`, una capa de datos para leer y escribir otras colecciones desde dentro del hook — consulta [La API `context.data`](/docs/collections/context-data-api).

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
