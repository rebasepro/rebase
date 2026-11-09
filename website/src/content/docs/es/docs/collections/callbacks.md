---
sourceHash: 3885c8f3dc44eb65
title: Callbacks de entidad
sidebar_label: Callbacks
description: Utilice callbacks del ciclo de vida para ejecutar lógica personalizada cuando las entidades se crean, actualizan, leen o eliminan. Incluye la API context.data para operaciones entre colecciones.
---

## Descripción general

Los callbacks le permiten intervenir en el ciclo de vida de la entidad para:

- **Sincronizar datos entre colecciones**: copiar o mover entidades entre tablas al cambiar de estado
- **Transformar datos** antes de guardar (campos calculados, generación de slugs)
- **Validar** reglas de negocio más allá de la validación del esquema
- **Desencadenar efectos secundarios** después de las escrituras (enviar correos electrónicos, sincronizar APIs, actualizar cachés)
- **Restringir una lectura** antes de que se compile, de modo que el llamador solo vea sus propias filas
- **Filtrar/transformar** datos después de la lectura
- **Operaciones en cascada**: limpiar registros relacionados al eliminar

## Dónde se ejecutan los callbacks

Una colección tiene dos bloques de callbacks, y la única diferencia es qué entorno de ejecución los ejecuta.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Se ejecuta en | el servidor | el panel de administración, en el navegador |
| Se activa para | REST, el SDK, tiempo real, `dataAsAdmin` | lecturas y escrituras que realiza el panel |
| Llega al navegador | no: los cuerpos se eliminan del bundle | sí, por completo |
| Usar para | todo lo que se describe a continuación | colecciones con las que el panel se comunica directamente |

**`callbacks` es el que usted necesita.** Se ejecuta en cada ruta de datos que llega al servidor (REST, el SDK, tiempo real, MCP y `rebase.data`), y su cuerpo nunca sale de la máquina, por lo que una clave de API o una lectura de `process.env` allí es segura. El resto de esta página trata sobre `callbacks`.

Hay un escritor que no es una ruta de datos: **el sistema de autenticación**. El registro, el inicio de sesión OAuth y la gestión de usuarios del panel de administración escriben las filas de usuarios directamente y no ejecutan ninguno de sus callbacks, por lo que un correo de bienvenida en `afterSave` en `users` nunca se activará al registrarse. Vincúlelo a los [hooks de autenticación](/docs/backend/authentication/) pasados en `auth.hooks` (`beforeUserCreate`, `afterUserCreate`, `afterUserDelete`), los cuales reciben un backend expulsado (ejected backend); el arranque advierte cuando la colección de usuarios declara callbacks que el registro no ejecutará.

`admin.browserCallbacks` existe para un único caso: una colección en un transporte `direct` o `custom`, que el panel lee y escribe *por sí mismo* sin ningún servidor Rebase en la ruta de la solicitud. Nada en el lado del servidor ve esas operaciones, por lo que `callbacks` nunca puede activarse para ellas, y este bloque es el único lugar donde puede residir su lógica de ciclo de vida.

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

De que «se envía a cada visitante» se derivan dos reglas, y ninguna es de estilo:

1. **Sin secretos.** Nada de claves de API, ni `process.env`, ni nada que le importaría que viera un lector del bundle. Eso pertenece a `callbacks`.
2. **No es un límite de seguridad.** Un `browserCallbacks.afterRead` que oculta o censura un campo lo hace *después* de que el navegador ya tenga la fila; en un transporte directo, el documento sin procesar provino directamente del almacén de datos. Es solo presentación. La censura u ocultamiento que deba ser estricta va en `callbacks`, o en las propias reglas del almacén de datos.

En una colección con transporte de servidor —la predeterminada, y casi con certeza la suya— el servidor ya ha ejecutado `callbacks` antes de que la fila llegue al panel, por lo que un `browserCallbacks.afterRead` se ejecuta *además* de este. Escríbalo para que sea idempotente, o no lo escriba.

A ambos bloques se les entrega lo mismo: las filas tal como las envía el servidor, una fecha como su cadena ISO y un belongsTo como su columna de clave foránea. Esto aplica a cada escritura que realiza el panel: el guardado de un formulario de registro, una edición en línea de la tabla, `useRowWrites` y una escritura a través del `context.data` del navegador, por lo que el cuerpo de un callback funciona en cualquiera de los dos bloques. Lo que un `browserCallbacks.beforeSave` modifique en la fila que devuelve es lo que guarda el formulario. El `context` que recibe es el del navegador: su `data` lee filas de la misma manera, y una escritura a través de él también ejecuta los `browserCallbacks` de la colección, por lo que un hook que escribe en su propia colección se ejecuta a sí mismo nuevamente.

Un `browserCallbacks.afterSave` se ejecuta después de que la escritura se haya almacenado, y nada en el navegador puede revertirla (rollback). Si lanza un error (throw), este se muestra como una advertencia; el guardado en sí se informa como completado, por lo que el formulario no ofrece crear el registro por segunda vez.

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

## Combinación de conjuntos de callbacks

En 0.24, combine los conjuntos manualmente.

Una colección tiene un único objeto `callbacks`. Cuando varias responsabilidades necesitan un hook (como marcas de tiempo, un registro de auditoría y un ámbito de inquilino), escriba cada una como su propio conjunto y combínelas con `composeCallbacks`:

```typescript
import { composeCallbacks, defineCollection } from "@rebasepro/cms-types";
import type { CollectionCallbacks } from "@rebasepro/types";

const timestamps: CollectionCallbacks = {
    beforeSave: ({ values, status }) => ({
        ...values,
        ...(status === "new" ? { createdAt: new Date().toISOString() } : {}),
        updatedAt: new Date().toISOString()
    })
};

const auditTrail: CollectionCallbacks = {
    afterSave: async ({ context, id, status }) => {
        await context.data.audit_log.create({ entity: "articles", entityId: String(id), action: status });
    }
};

export default defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { name: "Title", type: "string" },
        createdAt: { name: "Created at", type: "string" },
        updatedAt: { name: "Updated at", type: "string" }
    },
    callbacks: composeCallbacks(timestamps, auditTrail)
});
```

Los conjuntos se ejecutan en el orden indicado, y cada hook se combina de la misma forma en que el backend combina sus propios niveles [globales](/docs/backend/hooks), de colección y de propiedad:

| Hook | Combinado |
|---|---|
| `beforeSave` | Encadenado: cada conjunto ve los valores que devolvió el anterior, combinados superficialmente (shallow merge) sobre lo que recibió |
| `afterRead` | Encadenado: cada conjunto recibe la fila devuelta por el anterior |
| `beforeQuery` | Conjunción (AND): cada conjunto ve la consulta del llamador, y una fila debe cumplir con todas las restricciones |
| `beforeDelete` | Cualquier `false` veta la eliminación; aun así, todos los conjuntos se ejecutan |
| `afterSave`, `afterDelete` | Se ejecutan en orden, esperando a cada uno; una excepción detiene el resto |
| `afterSaveError` | Se ejecutan en orden; una excepción no detiene el siguiente conjunto, y el primer error se vuelve a lanzar al final |

Un hook está presente en el resultado solo si algún conjunto lo tiene, y cualquier conjunto `undefined` se omite. `composeCallbacks` también se exporta desde `@rebasepro/server` y `@rebasepro/common`.

Adjuntar callbacks después del arranque con `backend.setCollectionCallbacks(slug, callbacks)` **reemplaza** los declarados por la colección. Para añadir los suyos a estos, pase `composeCallbacks(declared, yours)`.

## Referencia de callbacks

### `beforeQuery`

Se llama **antes de compilar una lectura**, para restringir las filas solicitadas. Devuelva condiciones para combinarlas con AND en la consulta; no devuelva nada para no añadir ninguna.

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

`afterRead` ve filas que ya han sido obtenidas, por lo que puede ocultar un valor pero no puede evitar que la fila sea leída. Este se ejecuta antes, y vale la pena conocer tres cosas sobre él:

- **Solo puede restringir.** El valor devuelto es un filtro para combinar con AND, y ningún valor que devuelva puede ampliar la lectura. `filter` admite los mismos filtros de campo que una consulta; `logical` acepta un grupo `or`/`and`, para un ámbito como «míos, o compartidos conmigo», manteniéndose combinado con AND en su totalidad, de modo que el `or` solo elija entre las filas que el resto de la consulta ya admite.
- **Se activa en cada ruta de lectura.** El listado, la obtención individual (get), el recuento (count), la agregación, la búsqueda, la lectura vectorial, un listado de ruta anidada, la recarga en tiempo real detrás de un `.listen()` y las filas cargadas para una relación o un `?include=`, donde se aplica el hook de la colección de **destino**, porque esas son las filas de destino.
- **Un filtro que no se pueda compilar rechaza la solicitud.** Nombrar una columna que la tabla no tiene da como resultado un 400, nunca una condición descartada.
- **Una escritura en una fila que excluye es un 404.** Una actualización o eliminación dirigida a una fila fuera del alcance se rechaza antes de la escritura, con la misma respuesta «no row …» que da una lectura; por lo tanto, un ámbito también lo es para las escrituras, no solo para las lecturas. Una escritura de pertenencia uno a muchos (`comments: [ids]` en una publicación) deja al elemento secundario donde está si el ámbito de destino lo oculta, ya que deja un ID que no nombra ninguna fila. Lo que *no* controla son los valores que se escriben: rechazar una escritura en función de su contenido corresponde a `beforeSave`.

Hay una lectura que deliberadamente no se restringe: la comprobación de unicidad detrás de `validation: { unique: true }`. Esta consulta si un valor existe en cualquier parte de la tabla, y si se restringiera respondería «único» para un valor que una fila oculta ya contiene.

:::caution[Solo Postgres, por ahora]
`beforeQuery` está implementado por `@rebasepro/server-postgres`. Una colección servida por MongoDB o Firestore que declare uno **falla en el arranque**, indicando su nombre, en lugar de servirse con el hook silenciosamente inerte (lo que, para un filtro de filas, significaría servir cada fila a todo el mundo). Un `beforeQuery` [global](/docs/backend/hooks) falla en el arranque de la misma manera si alguna fuente de datos no es Postgres, y también ocurre con uno adjuntado más tarde mediante `setCollectionCallbacks`. La ocultación de datos que funciona en todos los motores es [`afterRead`](#afterread).
:::

→ Consulte [Extender el servidor](/docs/backend/extending#2-collection-callbacks) para ver dónde se ubica esto entre las demás opciones.

### `beforeSave`

Se llama antes de que un registro se escriba en la base de datos. Devuelva los valores modificados. En Postgres se ejecuta dentro de la transacción de escritura, que ya ha comenzado, por lo que retiene una conexión del grupo de conexiones (pool) durante todo el tiempo que se ejecute; consulte [Un callback retiene una conexión](/docs/collections/context-data-api#a-callback-holds-a-connection).

```typescript
beforeSave: async ({
    values,       // Entity values
    id,           // Entity ID (undefined for a new entity, unless the caller sent one)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Lance un error para **bloquear el guardado**. La escritura nunca llega a la base de datos y el llamador recibe un **400** con su mensaje y el código `CALLBACK_REJECTED`:

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

Para elegir el estado y el código usted mismo (un 409 para un conflicto, un 422 para algo bien formado pero inaceptable), lance un `RebaseApiError`:

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
Impórtelo desde `@rebasepro/types`, no desde `@rebasepro/server`. El archivo de una colección se comparte con el frontend (la compilación de Vite del panel de administración lee este mismo directorio), por lo que solo puede importar paquetes que se ejecuten en un navegador. `RebaseApiError` es la versión segura para el navegador, y es la misma clase que lanza el SDK tipado.
:::

### `afterSave`

Se llama después de que se escribe la fila y antes del commit, dentro de la misma transacción. Lanzar un error revierte el guardado; consulte [Semántica de transacciones](/docs/collections/context-data-api#transaction-semantics).

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

Se llama cuando una operación de guardado falla.

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

Se ejecuta para un guardado que falló en la base de datos o después de ella; no para un rechazo en `beforeSave`, una solicitud rechazada antes de la escritura (validación, permiso faltante, un 404), o un commit rechazado después de que el guardado haya retornado ([lista completa](/docs/backend/hooks/#when-aftersaveerror-runs)).

En una solicitud, se ejecuta una vez que la transacción de la escritura fallida se ha revertido, no dentro de ella. Su `context.data` es nuevo e independiente para el mismo llamador, donde cada llamada es una transacción propia, por lo que un [trabajo (job)](/docs/backend/jobs), mensaje de cola o webhook que encole se confirma (commit) y sobrevive al fallo que reporta. Si se lanza un error desde `afterSaveError`, este se registra en los logs y el llamador sigue recibiendo el error original del guardado.

### `afterRead`

Se llama después de leer entidades de la base de datos. Transforma los datos para su visualización.

Modela lo que recibe el llamador (la respuesta de una lectura o escritura, y su trama en tiempo real) y nada más: `afterSave`, `beforeDelete`, `afterDelete` y el [historial](/docs/backend/history) reciben la fila tal como está almacenada: un valor enmascarado aquí nunca es lo que registra una auditoría o lo que reescribe una reversión, y un campo añadido aquí nunca se escribe.

Una agregación devuelve sumas y recuentos, no filas, por lo que no puede pasar a través de `afterRead`. En una colección a la que se aplique, solo se atiende `count()` sin `groupBy`; cualquier otra [agregación](/docs/sdk/aggregates-and-search/#aggregates) se rechaza con `400 AGGREGATE_MASKED_BY_AFTER_READ`.

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

Se llama antes de que se elimine un registro. Lance un error para bloquear la eliminación, y el llamador recibirá `400 CALLBACK_REJECTED` con su mensaje. Devolver `false` también la bloquea, como `403 CALLBACK_REJECTED` sin ningún mensaje personalizado.

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

También puede definir callbacks a nivel de propiedad para transformaciones específicas de cada campo:

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

Cada callback también recibe `context.data`, una capa de datos para leer y escribir en otras colecciones desde dentro del hook; consulte [La API `context.data`](/docs/collections/context-data-api).

## Sincronización de datos entre colecciones

Uno de los usos más potentes de los callbacks es la **sincronización de datos entre colecciones** mediante `context.data`:

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

- **Eliminación en cascada**: use `afterDelete` para eliminar registros relacionados en colecciones secundarias
- **Desnormalización**: use `afterSave` para actualizar campos de resumen en una colección principal
- **Registro de auditoría**: use `afterSave` / `afterDelete` para escribir en una colección de registro de auditoría
- **Contadores**: use `afterSave` / `afterDelete` para actualizar campos de conteo en entidades relacionadas

## Probar un callback

Un callback es una función simple que recibe un objeto de propiedades (props), por lo que una prueba unitaria puede invocarla directamente. `createCallContext` construye la propiedad `context`: los campos que proporcione se utilizan tal como están, y cualquiera que omita es un sustituto que lanza un error al usarse por primera vez, indicando su propio nombre, de modo que una prueba solo proporcione lo que el hook realmente utiliza.

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCallContext } from "@rebasepro/server";
import type { User } from "@rebasepro/types";
import articlesCollection from "../config/collections/articles";

const editor: User = {
    uid: "u1", displayName: null, email: null, photoURL: null,
    providerId: "password", isAnonymous: false, roles: ["editor"]
};

test("beforeSave derives the slug from the title", async () => {
    const values = await articlesCollection.callbacks!.beforeSave!({
        collection: articlesCollection,
        path: "articles",
        status: "new",
        values: { title: "Hello World" },
        context: createCallContext({ user: editor })
    });
    assert.equal(values.slug, "hello-world");
});
```

Un hook que lee o escribe mediante `context.data` necesita un controlador (driver): pase `createCallContext({ data: buildSdkData(driver) })`, con `buildSdkData` desde `@rebasepro/common` y cualquier `DataDriver`, incluido uno en memoria. `user` permanece ausente a menos que lo pase, tal como ocurre en una escritura sin llamador, por lo que una rama `if (context.user)` se prueba de manera fidedigna. Para ejecutar hooks contra una base de datos real en su lugar, consulte [Scripts y la Consola](/docs/backend/scripts/).

## Referencia completa del contexto

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

Realice consultas a través de `context.data`. `context.client` no tiene `data`: en el lado del servidor es el singleton `rebase`, cuyo único plano de datos es `dataAsAdmin` con ámbito de administrador, por lo que `context.client.data` es un error de compilación. Para construir uno de estos en una prueba, consulte [Probar un callback](#probar-un-callback).

## Pasos siguientes

- **[Reglas de seguridad](/docs/collections/security-rules)** — Seguridad a nivel de fila (Row Level Security)
- **[Historial de entidades](/docs/backend/history)** — Registro de auditoría
- **[Funciones personalizadas](/docs/backend/custom-functions)** — Añadir endpoints de API personalizados
