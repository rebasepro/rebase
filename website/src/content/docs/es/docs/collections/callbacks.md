---
sourceHash: 9b21d41a290148dd
title: Callbacks de entidad
sidebar_label: Callbacks
description: Usa callbacks de ciclo de vida para ejecutar lógica personalizada cuando las entidades se crean, actualizan, leen o eliminan. Incluye la API context.data para operaciones entre colecciones.
---

## Descripción general

Los callbacks te permiten intervenir en el ciclo de vida de la entidad para:

- **Sincronizar datos entre colecciones** — copiar o mover entidades entre tablas ante cambios de estado
- **Transformar datos** antes de guardar (campos calculados, generación de slugs)
- **Validar** reglas de negocio más allá de la validación del esquema
- **Desencadenar efectos secundarios** tras las escrituras (enviar correos electrónicos, sincronizar APIs, actualizar cachés)
- **Restringir una lectura** antes de que se compile, para que quien llama solo vea sus propias filas
- **Filtrar/transformar** datos después de leer
- **Operaciones en cascada** — limpiar registros relacionados al eliminar

## Dónde se ejecutan los callbacks

Una colección tiene dos bloques de callbacks, y la única diferencia radica en qué entorno de ejecución los ejecuta.

| | `callbacks` | `admin.browserCallbacks` |
|---|---|---|
| Se ejecuta en | el servidor | el panel de administración, en el navegador |
| Se dispara para | REST, el SDK, tiempo real, `dataAsAdmin` | lecturas y escrituras que realiza el panel |
| Llega al navegador | no — los cuerpos se eliminan del bundle | sí, en su totalidad |
| Uso para | todo lo siguiente | colecciones con las que el panel se comunica directamente |

**`callbacks` es el que buscas.** Se ejecuta en cada ruta de datos que llega al servidor — REST, el SDK, tiempo real, MCP y `rebase.data` — y su cuerpo nunca sale de la máquina, por lo que una clave de API o una lectura de `process.env` allí es segura. El resto de esta página trata sobre `callbacks`.

Un emisor de escrituras no es una ruta de datos: **el sistema de autenticación**. El registro, el inicio de sesión OAuth y la gestión de usuarios del panel de administración escriben directamente en las filas de usuarios y no ejecutan ninguno de sus callbacks, por lo que un correo de bienvenida en el `afterSave` de `users` nunca se disparará durante el registro. Asígnalo a los [hooks de autenticación](/docs/backend/authentication/) pasados en `auth.hooks` — `beforeUserCreate`, `afterUserCreate`, `afterUserDelete` —, los cuales reciben un backend desacoplado (ejected); el arranque advierte cuando la colección de usuarios declara callbacks que el registro no ejecutará.

`admin.browserCallbacks` existe para un caso: una colección en un transporte `direct` o `custom`, la cual el panel lee y escribe *por sí mismo* sin ningún servidor Rebase en la ruta de la solicitud. Nada en el lado del servidor ve esas operaciones, por lo que `callbacks` nunca puede ejecutarse para ellas, y este bloque es el único lugar donde puede residir su lógica de ciclo de vida.

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

Dos reglas se derivan de «se envía a cada visitante», y ninguna es meramente estilística:

1. **Sin secretos.** Nada de claves de API, ni `process.env`, ni nada que te importaría que viera un lector del bundle. Eso pertenece a `callbacks`.
2. **No es un límite de seguridad.** Un `browserCallbacks.afterRead` que ofusca un campo lo hace *después* de que el navegador ya tenga la fila; en un transporte directo, el documento sin procesar provino directamente del almacén de datos. Es solo presentación. La ofuscación que deba mantenerse debe ir en `callbacks` o en las reglas propias del almacén de datos.

En una colección con transporte de servidor (la opción predeterminada y casi seguro la tuya), el servidor ya ha ejecutado `callbacks` antes de que la fila llegue al panel, por lo que un `browserCallbacks.afterRead` se ejecuta *además* de este. Escríbelo para que sea idempotente o no lo escribas.

Un `browserCallbacks.afterSave` se ejecuta después de que la escritura se haya almacenado, y nada en el navegador puede revertirla. Si lanza un error, este se muestra como una advertencia; el guardado en sí se informa como completado, por lo que el formulario no ofrecerá crear el registro una segunda vez.

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
            // Throw (or return false) to block the deletion
        },

        afterRead: async ({ row }) => {
            // Transform data after loading
            return row;
        }
    }
});
```

## Combinar conjuntos de callbacks

En 0.24, combina los conjuntos a mano.

Una colección tiene un único objeto `callbacks`. Cuando varias responsabilidades necesitan un hook cada una, como marcas de tiempo (timestamps), un registro de auditoría y un ámbito de inquilino (tenant scope), escribe cada una como su propio conjunto y combínalas con `composeCallbacks`:

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

Los conjuntos se ejecutan en el orden proporcionado, y cada hook se combina de la misma forma en que el backend combina sus propios niveles [global](/docs/backend/hooks), de colección y de propiedad:

| Hook | Combinación |
|---|---|
| `beforeSave` | Encadenado: cada conjunto ve los valores que devolvió el anterior, fusionados superficialmente (shallow-merged) sobre lo que recibió |
| `afterRead` | Encadenado: cada conjunto recibe la fila devuelta por el anterior |
| `beforeQuery` | Evaluado con AND: cada conjunto ve la consulta de quien llama, y una fila debe superar cada restricción |
| `beforeDelete` | Cualquier `false` veta la eliminación; aun así, todos los conjuntos se ejecutan |
| `afterSave`, `afterDelete` | Se ejecutan en orden, esperando a cada uno; un error lanzado detiene el resto |
| `afterSaveError` | Se ejecutan en orden; un error lanzado no detiene el siguiente conjunto, y el primer error se vuelve a lanzar al final |

Un hook está presente en el resultado solo si algún conjunto lo incluye, y un conjunto `undefined` se omite. `composeCallbacks` también se exporta desde `@rebasepro/server` y `@rebasepro/common`.

Adjuntar callbacks después del arranque con `backend.setCollectionCallbacks(slug, callbacks)` **reemplaza** los que la colección declaró. Para agregar los tuyos a ellos, pasa `composeCallbacks(declared, yours)`.

## Referencia de callbacks

### `beforeQuery`

Se llama **antes de que se compile una lectura**, para restringir qué filas solicita. Devuelve condiciones para combinar con AND en la consulta; no devuelvas nada si no deseas agregar ninguna.

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

`afterRead` ve filas que ya han sido obtenidas, por lo que puede ofuscar un valor pero no puede evitar que la fila sea leída. Este se ejecuta antes, y vale la pena conocer estos puntos sobre él:

- **Solo puede restringir.** El valor de retorno es un filtro para combinar con AND, y ningún valor que pueda devolver amplía la lectura. `filter` acepta los mismos filtros de campo que una consulta; `logical` acepta un grupo `or`/`and`, para un ámbito como «míos, o compartidos conmigo» —sigue combinándose con AND como un todo, por lo que el `or` solo elige entre filas que el resto de la consulta ya admite—.
- **Se dispara en cada ruta de lectura.** El listado, la obtención individual, el conteo, el agregado, la búsqueda, la lectura vectorial, un listado de rutas anidadas, la reobtención en tiempo real detrás de un `.listen()`, y las filas cargadas para una relación o un `?include=` —donde se aplica el hook de la colección **de destino**, ya que esas son las filas de destino—.
- **Un filtro que no se pueda compilar rechaza la solicitud.** Nombrar una columna que la tabla no tiene da un 400, nunca una condición descartada.
- **Una escritura en una fila que excluye devuelve un 404.** Una actualización o eliminación dirigida a una fila fuera del alcance se rechaza antes de la escritura, con la misma respuesta de «fila no encontrada…» que da una lectura; por lo tanto, un alcance es un alcance también para las escrituras, no solo para las lecturas. Una escritura de pertenencia uno a muchos (`comments: [ids]` en una publicación) deja al hijo que el alcance de destino oculta donde está, tal como dejaría un ID que no nombra ninguna fila. Lo que *no* restringe son los valores que se escriben: rechazar una escritura en función de su contenido corresponde a `beforeSave`.

Una lectura deliberadamente no se restringe: la comprobación de unicidad detrás de `validation: { unique: true }`. Esta consulta si un valor existe en cualquier parte de la tabla, y si estuviera restringida respondería «único» para un valor que una fila oculta ya posee.

:::caution[Solo en Postgres, por ahora]
`beforeQuery` está implementado por `@rebasepro/server-postgres`. Una colección servida por MongoDB o Firestore que declare uno **falla en el arranque**, por su nombre, en lugar de servirse con el hook silenciado de forma inerte —lo que para un filtro de filas significaría servir cada fila a todo el mundo—. Un `beforeQuery` [global](/docs/backend/hooks) falla en el arranque de la misma manera si alguna fuente de datos no es Postgres, al igual que uno adjuntado más tarde con `setCollectionCallbacks`. La ofuscación que funciona en todos los motores es [`afterRead`](#afterread).
:::

→ [Extender el servidor](/docs/backend/extending#2-collection-callbacks) para ver dónde se sitúa esto entre las demás opciones.

### `beforeSave`

Se llama antes de que un registro se escriba en la base de datos. Devuelve los valores modificados. En Postgres se ejecuta dentro de la transacción de escritura, que ya ha comenzado, por lo que retiene una conexión del pool durante todo el tiempo que se ejecuta — consulta [Un callback retiene una conexión](/docs/collections/context-data-api#a-callback-holds-a-connection).

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

Para elegir el estado y el código tú mismo —un 409 para un conflicto, un 422 para algo bien formado pero inaceptable—, lanza un `RebaseApiError`:

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
Impórtalo desde `@rebasepro/types`, no desde `@rebasepro/server`. Un archivo de colección se comparte con el frontend —la compilación de Vite del panel de administración lee este mismo directorio—, por lo que solo puede importar paquetes que se ejecuten en un navegador. `RebaseApiError` es la versión segura para el navegador y es la misma clase que lanza el SDK tipado.
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

Se ejecuta para un guardado que falló en la base de datos o después de ella —no para un rechazo en `beforeSave`, una solicitud rechazada antes de la escritura (validación, permiso faltante, un 404) ni un commit rechazado después de que el guardado haya retornado ([lista completa](/docs/backend/hooks/#when-aftersaveerror-runs)).

En una solicitud, se ejecuta una vez que la transacción de la escritura fallida se ha revertido, no dentro de ella. Su `context.data` es una instancia nueva para el mismo emisor, donde cada llamada es una transacción propia, por lo que un [trabajo](/docs/backend/jobs), mensaje de cola o webhook que encole se confirma (commit) y sobrevive al fallo que reporta. Si se lanza un error desde `afterSaveError`, este se registra en los logs y quien llama sigue recibiendo el error propio del guardado.

### `afterRead`

Se llama después de leer entidades de la base de datos. Transforma los datos para su visualización.

Da forma a lo que recibe quien llama —la respuesta de una lectura o de una escritura, y su trama en tiempo real— y a nada más: `afterSave`, `beforeDelete`, `afterDelete` y el [historial](/docs/backend/history) obtienen la fila tal como está almacenada: un valor enmascarado aquí nunca es lo que un registro de auditoría almacena ni lo que una reversión vuelve a escribir, y un campo agregado aquí nunca se escribe.

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

Se llama antes de que se elimine un registro. Lanza un error para bloquear la eliminación, y quien llama recibirá `400 CALLBACK_REJECTED` con tu mensaje. Devolver `false` también lo bloquea, como `403 CALLBACK_REJECTED` sin ningún mensaje tuyo.

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

Se llama después de que la fila se elimina y antes del commit, dentro de la misma transacción. Lanzar un error revierte la eliminación.

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

## Callbacks de propiedad

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

Cada callback también recibe `context.data`, una capa de datos para leer y escribir en otras colecciones desde dentro del hook — consulta [La API `context.data`](/docs/collections/context-data-api).

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

- **Eliminación en cascada**: Usa `afterDelete` para eliminar registros relacionados en colecciones hijas
- **Desnormalización**: Usa `afterSave` para actualizar campos de resumen en una colección padre
- **Registro de auditoría**: Usa `afterSave` / `afterDelete` para escribir en una colección de registro de auditoría
- **Contadores**: Usa `afterSave` / `afterDelete` para actualizar campos de recuento en entidades relacionadas

## Probar un callback

Un callback es una función simple que recibe un objeto de propiedades (props), por lo que una prueba unitaria puede invocarla directamente. `createCallContext` construye la propiedad `context`: los campos que pasas se usan tal cual, y cualquiera que omitas se convierte en un sustituto que lanza un error la primera vez que se usa, indicando su propio nombre, de modo que una prueba solo proporciona lo que el hook realmente utiliza.

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

Un hook que lee o escribe mediante `context.data` necesita un controlador (driver): pasa `createCallContext({ data: buildSdkData(driver) })`, con `buildSdkData` de `@rebasepro/common` y cualquier `DataDriver`, incluso uno en memoria. `user` permanece ausente a menos que lo pases, tal como ocurre en una escritura sin emisor, de modo que una rama `if (context.user)` se pruebe con fidelidad. Para ejecutar hooks contra una base de datos real en su lugar, consulta [Scripts y la Consola](/docs/backend/scripts/).

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

Consulta mediante `context.data`. `context.client` no tiene `data`: en el lado del servidor es el singleton `rebase`, cuyo único plano de datos es `dataAsAdmin` con alcance de administrador, por lo que `context.client.data` produce un error de compilación. Para construir uno de estos para una prueba, consulta [Probar un callback](#probar-un-callback).

## Próximos pasos

- **[Reglas de seguridad](/docs/collections/security-rules)** — Seguridad a nivel de fila (Row Level Security)
- **[Historial de entidades](/docs/backend/history)** — Registro de auditoría
- **[Funciones personalizadas](/docs/backend/custom-functions)** — Agregar endpoints de API personalizados
