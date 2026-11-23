---
sourceHash: 1487ed768dd198b7
title: Hooks de tabla
sidebar_label: Hooks de tabla
description: "Ejecute código del lado del servidor en cada paso del ciclo de vida de una tabla con hooks: restrinja lecturas, enmascare campos, valide y complete escrituras, reaccione a guardados y eliminaciones, y transforme columnas individuales."
---

Los `hooks` de una tabla se ejecutan en el servidor en cada paso de la vida de una fila: antes de una lectura, en cada fila que sale del servidor, antes y después de una escritura, y antes y después de una eliminación. Se ejecutan para cada puerta de entrada a la tabla — REST, el SDK, realtime, MCP y código del servidor mediante `rebase.data` — y su código nunca sale del servidor, por lo que una clave de API o una lectura de `process.env` en un hook es segura.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        title:  col.text().notNull(),
        slug:   col.text().notNull().unique().serverDefault(),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
    },
    rls: "admin-only",
    hooks: {
        beforeSave: ({ values, previousValues }) => {
            // Derive the slug from the title when none is given.
            const title = values.title ?? previousValues?.title;
            if (title && !values.slug && !previousValues?.slug) {
                values.slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            }
            return values;
        },
        beforeDelete: ({ values }) => {
            if (values.status === "published") {
                throw new Error("Unpublish the article before deleting it.");
            }
        },
    },
});
```

Las props están tipadas a partir de las columnas de la tabla: `values.title` arriba es un `string`, y `values.status` es `"draft" | "published"`.

`.serverDefault()` en `slug` indica lo que hace el hook, ya que su código no se puede leer: una creación puede omitir la columna, el tipo de inserción del SDK la hace opcional y el formulario del panel permite crear un registro sin ella.

:::note[¿Viene de colecciones?]
Los hooks de tabla son los `callbacks` del servidor de una colección, con el mismo ciclo de vida. Cada hook recibe el descriptor de la tabla como `table`, y `afterRead` y los hooks de eliminación reciben la fila como `values`. La guía de actualización para esta versión detalla los cambios de nombre.
:::

## Los siete hooks

| Hook | Se ejecuta | Retorna |
|---|---|---|
| `beforeQuery` | antes de que se compile cada lectura | un filtro para aplicar con AND a la lectura, o nada |
| `afterRead` | en cada fila que sale del servidor | la fila a servir |
| `beforeSave` | antes de una creación o actualización, dentro de su transacción | los valores a escribir; lance una excepción para rechazar |
| `afterSave` | después de la escritura, antes del commit | nada; lance una excepción para revertir la escritura |
| `afterSaveError` | después de que una escritura falló y se revirtió | nada |
| `beforeDelete` | antes de una eliminación, dentro de su transacción | `false` o lance una excepción para rechazar |
| `afterDelete` | después de la eliminación, antes del commit | nada; lance una excepción para revertir la eliminación |

Cada hook puede ser `async`. Cada hook recibe:

| Prop | Qué es |
|---|---|
| `table` | La tabla tal como la conoce el servidor: su descriptor, con columnas, relaciones y la postura de `rls`. |
| `path` | La ruta a la que se dirigió la solicitud: el slug o una ruta anidada. |
| `context` | El emisor de la llamada (`context.user`), y `context.data` con su alcance limitado a este. Consulte [La API de `context.data`](/docs/collections/context-data-api/). |

Un emisor de escritura no los ejecuta: **el sistema de autenticación**. El registro, el inicio de sesión OAuth y la administración de usuarios por parte de un administrador escriben directamente en la tabla de usuarios. Consulte [La tabla de usuarios](/docs/schema/auth-table/#what-does-not-run-for-auth-writes).

Una tabla escrita directamente por el CMS en el navegador, sin ningún servidor de Rebase en la ruta de la solicitud, nunca llega a estos hooks. El CMS dispone de sus propios hooks del lado del navegador para ese caso, descritos en las personalizaciones del CMS.

## `beforeQuery`

Se ejecuta **antes de que se compile una lectura**, para restringir qué filas solicita. Retorne condiciones para aplicar con AND a la consulta; no devuelva nada para no agregar ninguna.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        tenantId: col.text().notNull(),
        subject:  col.text().notNull(),
    },
    rls: [{ operation: "all", access: "authenticated" }],
    hooks: {
        beforeQuery: ({ operation, context }) => {
            // operation: "list" | "get" | "count" | "aggregate" | "relation"
            if (context.user?.roles?.includes("admin")) return;
            return { filter: { tenantId: ["==", String(context.user?.uid ?? "")] } };
        },
    },
});
```

- **Solo puede restringir.** `filter` toma los mismos filtros de campo que una consulta; `logical` toma un grupo `or`/`and` para un alcance como "mío, o compartido conmigo", aún combinado con AND como un todo.
- **Se ejecuta en cada ruta de lectura**: el listado, una obtención individual (get), el recuento, la agregación, la búsqueda, la lectura vectorial, un listado de ruta anidada, la recarga en tiempo real detrás de un `.listen()`, y las filas cargadas para una relación o un `?include=`, donde se aplica el hook de la tabla de **destino**.
- **Un filtro que no se puede compilar rechaza la solicitud.** Nombrar una columna que la tabla no tiene devuelve un 400, nunca una condición descartada.
- **Una escritura en una fila que excluye devuelve un 404.** Una actualización o una eliminación dirigida a una fila fuera del alcance se rechaza antes de la escritura. Rechazar una escritura por su contenido corresponde a `beforeSave`.

La comprobación de unicidad detrás de `.unique()` no se restringe: de estar restringida, respondería "único" para un valor que una fila oculta ya posee.

La seguridad a nivel de fila (Row-level security) es el modelo de autorización; `beforeQuery` es lógica de aplicación construida sobre él. Utilice [`rls`](/docs/collections/security-rules/) para todo aquello que también deba cumplirse para el SQL ejecutado como el emisor de la llamada.

## `beforeSave`

Se ejecuta antes de que se escriba una fila y devuelve los valores que se van a escribir. `values` contiene cada valor en una creación y los modificados en una actualización; `previousValues` es la fila tal como estaba, en una actualización; `status` es `"new"`, `"existing"` o `"copy"`; `id` está ausente en una creación cuya clave genera la base de datos.

Se ejecuta dentro de la transacción de escritura, por lo que retiene una conexión del pool durante todo el tiempo que se ejecuta. Consulte [Un hook retiene una conexión](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Lance una excepción para **rechazar la escritura**. Nada llega a la base de datos y el emisor de la llamada recibe un **400** con su mensaje y el código `CALLBACK_REJECTED`:

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

Para elegir el estado y el código — un 409 para un conflicto, un 422 para algo bien formado pero inaceptable —, lance un `RebaseApiError`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";
import { RebaseApiError } from "@rebasepro/types";

export const products = defineTable("products", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        slug:  col.text().notNull(),
        price: col.numeric({ precision: 10, scale: 2 }).notNull(),
    },
    rls: "admin-only",
    hooks: {
        beforeSave: async ({ values, context }) => {
            if (values.slug) {
                const taken = await context.data.products.count({ where: { slug: ["==", values.slug] } });
                if (taken > 0) throw new RebaseApiError("That slug is taken", { status: 409, code: "SLUG_TAKEN" });
            }
            return values;
        },
    },
});
```

Importe `RebaseApiError` desde `@rebasepro/types`: los archivos de esquema no cargan código del servidor, y es la misma clase que lanza el SDK tipado.

## `afterSave` y `afterSaveError`

`afterSave` se ejecuta después de que la fila se escribe y antes del commit, en la misma transacción. Sus `values` son la fila tal como se almacenó. Lanzar una excepción revierte el guardado, junto con todo lo que el hook haya escrito a través de `context.data`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["open", "paid", "shipped"]).notNull().default("open"),
    },
    rls: "admin-only",
    hooks: {
        afterSave: async ({ id, status, values, context }) => {
            // Commits with the order, or not at all.
            await context.data.audit_log.create({ table: "orders", rowId: String(id), action: status, state: values.status });
        },
    },
});
```

El trabajo que sale de la base de datos — un correo electrónico, un webhook — no pertenece al cuerpo del hook: mantiene abierta la transacción durante un viaje de ida y vuelta por la red (round trip), y nada lo revierte si la escritura falla y se revierte. En su lugar, ponga en cola un [trabajo (job)](/docs/backend/jobs/); un trabajo encolado desde un hook se confirma (commit) junto con la escritura.

`afterSaveError` se ejecuta cuando un guardado falló en la base de datos o después de ella, una vez que la transacción de la escritura fallida se ha revertido. No se ejecuta en caso de un rechazo en `beforeSave` ni de una solicitud rechazada antes de la escritura. Su `context.data` es nuevo para el mismo emisor de la llamada, por lo que un trabajo que ponga en cola sobrevive al fallo que reporta. Si lanza una excepción, esta se registra en los logs y el emisor de la llamada sigue recibiendo el error propio del guardado.

## `afterRead`

Se ejecuta en cada fila que sale del servidor — la respuesta de una lectura, la respuesta de una escritura, un frame de tiempo real, un resultado de MCP — y devuelve la fila a servir. `values` es la fila tal como se almacenó, después de que el [acceso a campos](/docs/collections/field-access/) haya eliminado lo que el emisor de la llamada no puede leer.

Da forma a lo que recibe el emisor de la llamada y nada más: `afterSave`, los hooks de eliminación y el [historial](/docs/backend/history/) obtienen la fila tal como se almacenó, por lo que un valor enmascarado aquí nunca es lo que registra una auditoría o lo que escribe una reversión. El historial también *sirve* sus entradas a través de `afterRead`, de modo que una instantánea muestra el valor enmascarado al igual que la fila.

Las filas incrustadas en la respuesta de otra tabla — un `include`, los valores de una referencia de relación, las filas que un frame de tiempo real transporta para una relación — se enmascaran a un nivel de profundidad con el `afterRead` de la tabla de **destino**. El orden es global, luego tabla, luego `.transform({ afterRead })` de columna. Un servicio de tiempo real sin un controlador para ejecutar los hooks rechazará los frames para una tabla que los tenga, en lugar de enviarlos sin enmascarar.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const customers = defineTable("customers", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        name:  col.text().notNull(),
        email: col.text().notNull(),
        phone: col.text(),
    },
    rls: [{ operation: "select", roles: ["support", "sales"] }],
    hooks: {
        // Mask contact details for everyone but support.
        afterRead: ({ values, context }) => {
            if (context.user?.roles?.includes("support")) return values;
            return {
                ...values,
                email: values.email.replace(/^(.).*(@.*)$/, "$1***$2"),
                phone: values.phone === null ? null : "•••",
            };
        },
    },
});
```

Una agregación devuelve sumas y recuentos, no filas, por lo que no puede pasar por `afterRead`. En una tabla con este hook, solo se sirve `count()` sin `groupBy`; cualquier otra [agregación](/docs/sdk/aggregates-and-search/#aggregates) se rechaza con `400 AGGREGATE_MASKED_BY_AFTER_READ`.

Es mejor retener un valor que el emisor de la llamada nunca deba recibir que enmascararlo: [`.access()` o `.private()`](/docs/collections/field-access/) eliminan la columna antes de que se ejecute cualquier hook y también la mantienen fuera de los filtros.

## `beforeDelete` y `afterDelete`

Ambos reciben la fila que se está eliminando como `values`, y su `id`.

`beforeDelete` se ejecuta dentro de la transacción de eliminación. Lance una excepción para rechazar la eliminación y el emisor de la llamada recibirá `400 CALLBACK_REJECTED` con su mensaje. Retornar `false` también la rechaza, como `403 CALLBACK_REJECTED` sin ningún mensaje personalizado.

`afterDelete` se ejecuta después de que la fila se elimina y antes del commit. Lanzar una excepción revierte la eliminación. En una tabla con [borrado suave (soft delete)](/docs/collections/soft-delete/), una eliminación es una marca temporal, y ambos hooks se siguen ejecutando.

## Hooks de campo: `.transform()`

El método `.transform()` de una columna admite dos hooks a nivel de campo: `beforeSave` devuelve el valor que se va a almacenar y `afterRead` devuelve el valor a servir. Se ejecutan en el servidor para cada emisor de llamada y reciben `value`, la fila completa como `values` y las props que recibe todo hook.

`value` está tipado con precisión: `T | null` en una columna que admite valores nulos, y `T` cuando se escribe `.notNull()` **antes** de `.transform()`. En un campo JSON es `T | undefined` a menos que `.required()` vaya primero.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const contacts = defineTable("contacts", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().transform({
            beforeSave: ({ value }) => value.trim().toLowerCase(),
        }),
        iban: col.text().transform({
            afterRead: ({ value, context }) =>
                value && !context.user?.roles?.includes("finance") ? `•••• ${value.slice(-4)}` : value,
        }),
    },
    rls: "admin-only",
});
```

`.transform()` también está disponible en elementos de array y en cada campo de un [documento JSON](/docs/schema/json/). Para recortar espacios y cambiar mayúsculas/minúsculas, las [reglas de validación](/docs/schema/columns/#validation) `trim`, `lowercase` y `uppercase` no necesitan código.

## Escribir en otras tablas

`context.data` lee y escribe en cualquier tabla mediante su slug, actuando como el emisor de la llamada y dentro de la misma transacción que la escritura que ejecutó el hook:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const submissions = defineTable("job_submissions", {
    columns: {
        id:            col.uuid().primaryKey().defaultRandom(),
        title:         col.text().notNull(),
        status:        col.enum(["pending", "approved", "rejected"]).notNull().default("pending"),
        promotedJobId: col.uuid(),
    },
    rls: "admin-only",
    hooks: {
        afterSave: async ({ id, values, previousValues, context }) => {
            // When a submission is approved, publish it as a job and link it back.
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const job = await context.data.jobs.create({ title: values.title, status: "published" });
                await context.data.job_submissions.update(id, { promotedJobId: job.id });
            }
        },
    },
});
```

La actualización anterior vuelve a guardar `job_submissions`, lo que vuelve a ejecutar este hook; la comprobación de estado es lo que lo detiene. [La API de `context.data`](/docs/collections/context-data-api/) cubre los privilegios con los que se ejecuta, los límites de transacción y anidamiento.

## Hooks para todas las tablas

Los hooks que se aplican a todas las tablas — enmascaramiento de PII en todo el esquema, un registro de auditoría global — se exportan como `hooks` desde `backend/hooks.ts`, con la misma estructura `TableHooks`. Se ejecutan antes de los hooks propios de cada tabla, que a su vez se ejecutan antes del `.transform()` de sus columnas. Consulte [Hooks globales](/docs/backend/hooks/).

Los hooks también se pueden vincular después del arranque con `setTableHooks(slug, hooks)` en el backend. Eso **reemplaza** los hooks declarados por la tabla; para añadirlos a los existentes, pase `composeTableHooks(declared, yours)`.

## Combinar conjuntos de hooks

Una tabla tiene un único objeto `hooks`. Cuando varias responsabilidades requieren un hook cada una — un generador de slugs, un registro de auditoría, un ámbito de inquilino (tenant) —, escriba cada una como su propio conjunto y combínelas con `composeTableHooks` de `@rebasepro/common`:

```ts
import { defineTable, col, type TableHooks } from "@rebasepro/server/schema";
import { composeTableHooks } from "@rebasepro/common";

const auditTrail: TableHooks = {
    afterSave: async ({ table, id, status, context }) => {
        await context.data.audit_log.create({ table: table.slug, rowId: String(id), action: status });
    },
};

export const pages = defineTable("pages", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        slug:  col.text(),
    },
    rls: "admin-only",
    hooks: composeTableHooks(auditTrail, {
        beforeSave: ({ values }) =>
            typeof values.title === "string" && !values.slug
                ? { ...values, slug: values.title.toLowerCase().replace(/\s+/g, "-") }
                : values,
    }),
});
```

Los conjuntos se ejecutan en el orden indicado y cada hook se combina de la forma en que el backend combina sus niveles global y de tabla:

| Hook | Combinado |
|---|---|
| `beforeSave` | Encadenado: cada conjunto ve los valores que devolvió el anterior, fusionados superficialmente (shallow-merge) sobre lo que recibió |
| `afterRead` | Encadenado: cada conjunto recibe la fila devuelta por el anterior |
| `beforeQuery` | Combinado con AND: cada conjunto ve la consulta del emisor de la llamada y una fila debe superar cada restricción |
| `beforeDelete` | Cualquier `false` veta la eliminación; todos los conjuntos se siguen ejecutando |
| `afterSave`, `afterDelete` | Se ejecutan en orden, esperando a cada uno; lanzar una excepción detiene el resto |
| `afterSaveError` | Se ejecutan en orden; lanzar una excepción no detiene al siguiente conjunto, y el primer error se vuelve a lanzar al final |

Un hook está presente en el resultado solo si algún conjunto lo incluye, y un conjunto `undefined` se omite. Un conjunto escrito de forma independiente a su tabla, como `auditTrail` arriba, está tipado con la fila genérica, así que lea sus valores como `unknown` y verifíquelos.

## Probar un hook

Un hook es una función común que recibe un único objeto de props, por lo que una prueba unitaria simplemente lo invoca: `posts.config.hooks?.beforeSave?.(props)`. `createCallContext` de `@rebasepro/server` construye la prop `context` solo con los campos pasados por la prueba; cualquier otro campo lanza una excepción en su primer uso, indicando su nombre. `table` es el descriptor que `compileTables` de `@rebasepro/common` devuelve para la tabla. Para ejecutar hooks contra una base de datos real, consulte [Scripts y la consola](/docs/backend/scripts/).

## Próximos pasos

- [La API de `context.data`](/docs/collections/context-data-api/): privilegios, transacciones y la conexión que retiene un hook
- [Hooks globales](/docs/backend/hooks/): hooks en todas las tablas
- [Historial de entidades](/docs/backend/history/): un registro de auditoría sin escribir hooks
