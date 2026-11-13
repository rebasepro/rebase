---
sourceHash: d08c6bb1dfd3357e
title: Datos tipados del lado del servidor
sidebar_label: Datos tipados del lado del servidor
description: "Registra tu tipo Database generado una sola vez, y context.data, rebase.dataAsAdmin y el rebase que recibe una función o cron se tiparán a partir de él: filas, filtros, ordenamientos, includes y datos de entrada de escritura."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El cliente del navegador se tipa pasando tu `Database` generada a
`createRebaseClient<Database>()` (consulta [Generación de SDK tipado](/docs/sdk#typed-sdk-generation)).
Las superficies de datos del lado del servidor no tienen una llamada de ese tipo a la que pasarlo:

- `context.data` en un [hook de tabla](/docs/collections/callbacks),
- `rebase.dataAsAdmin` en el singleton `rebase`,
- el `rebase` que se entrega a una [función personalizada](/docs/backend/custom-functions) o a un
  [trabajo cron](/docs/backend/cron-jobs).

Así que le indicas a TypeScript una sola vez, para todo el proyecto, a qué `Database` sirven.
Hasta que lo hagas, permanecerán sin tipar: cualquier tabla con cualquier nombre, filas como
`Record<string, unknown>`. Nada cambia para un proyecto que no registra nada.

Hay dos formas de registrar: la `Database` generada, que es exacta, o
tu propio módulo `backend/schema`, que no necesita una ejecución de generación de código.

## Registrar la `Database` generada

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```bash
rebase generate-sdk --register
```

Además del SDK en `generated/sdk/`, esto escribe dos archivos en
`backend/generated/`: una copia de `database.types.ts` y un `register.ts` que
declara el registro:

```ts
import type { Database } from "./database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
```

Residen en `backend/` porque ese es el programa en el que se compilan los hooks, funciones y
crons a los que tipan, y los tipos se copian junto al
registro en lugar de importarse desde `generated/sdk/`, que está fuera del
`rootDir` del backend. Es solo una declaración: el runtime hace exactamente lo
mismo que hacía antes. `--register` se niega a sobrescribir un `register.ts` que no
haya escrito él mismo.

El flag se recuerda en `rebase.json` como `"registerDatabase": true` en la
aplicación de backend, de modo que cada `rebase generate-sdk` posterior, y cada `rebase dev` ante cada
cambio en `backend/schema/`, mantiene ambos archivos actualizados. El `.gitignore`
del scaffold ignora los directorios `generated/`, por lo que un clon limpio no tendrá ninguno
de los dos archivos hasta que algo los vuelva a escribir. `rebase build` (y
`rebase cloud deploy`, que compila el mismo bundle) los escribe a partir de las
tablas antes de compilar, por lo que un trabajo de CI que ejecute `rebase build` en un clon
limpio compilará hooks tipados. Un paso de CI que compile el backend de otra manera
(`tsc`, `pnpm build`) aún necesita ejecutar `rebase generate-sdk` primero, o de lo contrario los hooks
que leen filas tipadas se compilarán contra el `context.data` sin tipar y fallarán. Un proyecto
sin `rebase.json` seguirá registrándose mientras
`backend/generated/register.ts` esté allí. Para volver a los datos del lado del servidor
sin tipar, elimina `registerDatabase` y borra `backend/generated/`.

## Registrar el esquema, sin codegen

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un proyecto que no ha generado nada registra su módulo de esquema en su lugar,
y se tipa directamente a partir de sus `defineTable`:

```ts
// backend/rebase-env.d.ts
declare module "@rebasepro/types" {
    interface Register {
        tables: typeof import("./schema");
    }
}
```

Cada exportación del módulo que sea una tabla o una vista se tipa bajo su
accessor (`orderItems` para `order_items`), con el `Row`, `Insert` y `Update`
que emitiría el generador: exacto para cada columna declarada. Es más flexible
con las relaciones, porque el objetivo de una relación está detrás de un thunk sin tipar:
una clave foránea derivada es `string | number`, una fila incluida es `Record<string, unknown>`,
y un `include` anidado no se valida. La `Database` generada es exacta para
todo esto, y tiene prioridad cuando ambas están registradas. [Tipos
inferidos](/docs/schema/types/) explica lo que `DatabaseOf` puede y no puede saber.

Una superficie solo se tipa a partir de la `Database` generada: `context.data` dentro
de los hooks de tabla de ese mismo esquema, porque tipar los hooks de un esquema a partir del
propio esquema genera un ciclo que TypeScript rechaza.

## Qué tipa

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```ts
// backend/schema/orders.ts — a hook
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        total: col.numeric().notNull(),
    },
    rls: "admin-only",
    hooks: {
        async beforeSave({ context, values }) {
            const { data } = await context.data.customers.find({
                where: { email: ["==", "ada@example.com"] },  // `email` is a column of customers
            });
            data[0]?.email;                      // completes from the customers Row
            return values;
        },
    },
});
```

Con la `Database` generada registrada, `context.data.customer` (tabla
inexistente) en ese hook es un error de tipo.

```ts
// backend/functions/stats.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/", async (c) => {
        const { data } = await rebase.dataAsAdmin.orders.find({
            where: { status: ["==", "paid"] },   // `status` and its values are checked
        });
        return c.json({ paid: data.length });
    });
});
```

```ts
// backend/crons/cleanup.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    name: "Cleanup",
    schedule: "0 3 * * *",
    async handler({ rebase }) {
        // `create` takes the table's Insert type: required columns are required.
        await rebase.dataAsAdmin.auditLog.create({ action: "cleanup" });
    },
});
```

Cada accessor está tipado de la misma manera que el del cliente del navegador: `find`, `findById`
y `listen` devuelven el `Row` de la tabla; `where` y `orderBy` toman como
claves sus columnas; `include` especifica sus relaciones; `create` toma su
`Insert` y `update` su `Update`. Los accessors son los nombres en camelCase del
archivo generado (`order_items` es `orderItems`).
El servidor resuelve esos nombres a través de las tablas servidas, por lo que una tabla cuyo
slug es `my-notes` (almacenada en una tabla `notes`) es `context.data.myNotes`.

`table(slug)` con un slug que la `Database` declara se tipa de la misma manera:
`context.data.table("my-notes")` es `context.data.myNotes`. Un slug que
calcules en tiempo de ejecución, o uno que el esquema no declare, obtiene el
cliente sin tipar.

## Una sola función, sin el registro

`defineFunction` y `defineCron` también aceptan el tipo como argumento, el cual tiene prioridad
sobre el registro. Utilízalo para tipar un solo archivo o para probar datos tipados antes
de registrar:

```ts
import type { Database } from "../../generated/sdk/database.types";

export default defineFunction<Database>((app, { rebase }) => {
    // rebase.dataAsAdmin is typed from Database here
});
```

## Helpers que toman el objeto de datos

Un helper que recibe `context.data` o `rebase.dataAsAdmin` nombra el
tipo registrado, de modo que se mantiene tipado y acepta ambos:

```ts
import type { RebaseSdkData, RegisteredDatabase } from "@rebasepro/types";

export async function paidOrders(data: RebaseSdkData<RegisteredDatabase>) {
    return data.orders.find({ where: { status: ["==", "paid"] } });
}
```

Un helper declarado simplemente con `RebaseSdkData` mantiene el tipo sin tipar, y un
objeto de datos tipado no es asignable a él. Cambia el parámetro como se muestra arriba
cuando hagas el registro.
