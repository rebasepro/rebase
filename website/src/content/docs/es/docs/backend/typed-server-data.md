---
sourceHash: c098315f51933896
title: Datos tipados del lado del servidor
sidebar_label: Datos tipados del lado del servidor
description: "Registra tu tipo Database generado una sola vez, y context.data, rebase.dataAsAdmin y el rebase que recibe una función o un cron quedan tipados a partir de él: filas, filtros, ordenaciones, includes y entradas de escritura."
---

El cliente del navegador se tipa pasando tu `Database` generada a
`createRebaseClient<Database>()` (consulta [Generación del SDK tipado](/docs/sdk#typed-sdk-generation)).
Las superficies de datos del lado del servidor no tienen una llamada así a la que pasársela:

- `context.data` en un [callback de colección](/docs/collections/callbacks),
- `rebase.dataAsAdmin` en el singleton `rebase`,
- el `rebase` que recibe una [función personalizada](/docs/backend/custom-functions) o un
  [cron job](/docs/backend/cron-jobs).

Así que le indicas a TypeScript una vez, para todo el proyecto, qué `Database` sirven.
Hasta que lo haces, no tienen tipos: cualquier colección con cualquier nombre, filas como
`Record<string, unknown>`. Nada cambia en un proyecto que no registra nada.

## Registrar la `Database`

<span class="since-badge" data-since="0.25">Desde 0.25</span>

```bash
rebase generate-sdk --register
```

Además del SDK en `generated/sdk/`, esto escribe dos archivos en
`config/generated/`: una copia de `database.types.ts`, y un `register.ts` que
declara el registro:

```ts
import type { Database } from "./database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
```

Viven en `config/` porque tus archivos de colección se compilan dos veces, por el
backend (cuyo `tsconfig.json` incluye `../config/`) y por el propio `tsc` del paquete
`config`, y `config/` es el único directorio que ambos leen. Un registro allí que
importara `../generated/sdk/` metería un archivo de fuera de `config/` en la compilación de
ese paquete, lo que TypeScript rechaza. Así, un solo registro tipa tus funciones, tus cron jobs
y los callbacks de tus archivos de colección, en ambas compilaciones. Es solo una declaración: el runtime hace
exactamente lo mismo que antes.

La opción se recuerda en `rebase.json`, como `"registerDatabase": true` en la
app del backend, de modo que cada `rebase generate-sdk` posterior, y `rebase dev` en cada
cambio de colección, mantiene ambos archivos al día. Eso vale también en un clon nuevo y en
CI: el `.gitignore` del scaffold ignora los directorios `generated/`, y el
primer `rebase generate-sdk` o `rebase dev` los escribe de nuevo. Un proyecto sin
`rebase.json` sigue registrando mientras `config/generated/register.ts`
esté ahí. Para volver a datos del servidor sin tipos, elimina `registerDatabase` y
borra `config/generated/`.

También puedes escribir el registro tú mismo, en cualquier archivo que compile el backend
(`backend/src/rebase-env.d.ts`, importando `../../generated/sdk/database.types`).
Entonces llega solo a la compilación del backend: en el propio `tsc` del paquete `config`,
`context.data` sigue siendo el objeto sin tipos, así que los callbacks tienen que compilar de ambas formas.

## Qué tipa

```ts
// config/collections/orders.ts — a callback
callbacks: {
    async beforeSave({ context, values }) {
        const { data } = await context.data.customers.find({
            where: { email: ["==", "ada@example.com"] },  // `email` is a column of customers
        });
        data[0]?.email;                      // completes from the customers Row

        await context.data.customer.find();  // error: no collection `customer`
        return values;
    }
}
```

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
        // `create` takes the collection's Insert type: required columns are required.
        await rebase.dataAsAdmin.auditLog.create({ action: "cleanup" });
    },
});
```

Cada accesor se tipa como el del cliente del navegador: `find`, `findById`
y `listen` devuelven el `Row` de la colección; `where` y `orderBy` se
indexan por sus columnas; `include` nombra sus relaciones; `create` toma su
`Insert` y `update` su `Update`. Los accesores son los nombres en camelCase del
archivo generado (`order_items` es `orderItems`).
El servidor resuelve esos nombres a través de las colecciones registradas, así que una
colección `my-notes` almacenada en una tabla `notes` es `context.data.myNotes`.

`collection(slug)` con un slug que la `Database` declara se tipa del mismo modo:
`context.data.collection("my-notes")` es `context.data.myNotes`. Un slug que
calculas en tiempo de ejecución, o uno que el esquema no declara, obtiene el cliente
sin tipos.

## Una función, sin el registro

`defineFunction` y `defineCron` también aceptan el tipo como argumento, que prevalece
sobre el registro. Úsalo para tipar un solo archivo, o para probar datos tipados antes de
registrar:

```ts
import type { Database } from "../../generated/sdk/database.types";

export default defineFunction<Database>((app, { rebase }) => {
    // rebase.dataAsAdmin is typed from Database here
});
```

## Helpers que reciben el objeto de datos

Un helper que recibe `context.data` o `rebase.dataAsAdmin` nombra el tipo
registrado, de modo que sigue tipado y acepta ambos:

```ts
import type { RebaseSdkData, RegisteredDatabase } from "@rebasepro/types";

export async function paidOrders(data: RebaseSdkData<RegisteredDatabase>) {
    return data.orders.find({ where: { status: ["==", "paid"] } });
}
```

Un helper declarado con un `RebaseSdkData` sin más conserva el tipo sin tipar, y un
objeto de datos tipado no es asignable a él. Cambia el parámetro como arriba cuando
registres.
