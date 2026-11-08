---
sourceHash: 040afb7b119d3d2a
title: Vistas
sidebar_label: Vistas
description: Sirve una vista SQL o una vista materializada como una colección de solo lectura, declarada en la configuración y creada por db push.
---

## Una colección sobre una consulta

Una colección puede servir una vista SQL en lugar de una tabla. Declara la consulta bajo
`view`, describe sus columnas como propiedades y marca con `isId` la que identifica una
fila: una vista no tiene clave primaria propia:

```ts
import { defineCollection } from "@rebasepro/cms-types";

export default defineCollection({
    slug: "artists",
    name: "Artists",
    table: "artist_stats",
    view: {
        query: `SELECT lower(artist) AS artist, count(*)::int AS songs, max(fame) AS fame
                FROM songs GROUP BY 1`
    },
    properties: {
        artist: { name: "Artist", type: "string", isId: true },
        songs: { name: "Songs", type: "number" },
        fame: { name: "Fame", type: "number" }
    }
});
```

Se lee como cualquier otra colección (`find`, `findById`, `count`,
[`aggregate`](/docs/sdk/aggregates-and-search/),
`listen`, las rutas REST, MCP y el panel de administración) y es de solo lectura: toda
escritura es un `405 COLLECTION_READ_ONLY`, y el panel no ofrece crear, editar ni
eliminar. Escribe en las tablas que lee la vista.

`rebase db push` crea la vista después de las tablas (la aplica Rebase,
no Atlas), `rebase db generate` la añade a la migración, y un arranque gestionado
la crea en su paso de esquema. Una vista cuya consulta no ha cambiado se deja
como está; una cuya consulta cambió se elimina y se vuelve a crear, junto con cualquiera
de tus vistas que la lean. Rebase se niega a reemplazar una tabla, o una vista que
no creó, que ya tenga ese nombre.

## Quién ve qué filas

Una vista simple se ejecuta **como el llamador** (`security_invoker`), así que las políticas de
las tablas que lee deciden lo que ve cada llamador: un usuario cuyas políticas le muestran
sus propias canciones ve la vista de sus propias canciones. Por eso
`securityRules` no se puede declarar en una vista: no hay nada a lo que adjuntarlas
y nada que pudieran añadir. Consulta [Reglas de seguridad](/docs/collections/security-rules/) para
las políticas de las tablas subyacentes.

## Vistas materializadas

`materialized: true` almacena las filas, así que una lectura no ejecuta la consulta:

```ts
view: {
    query: "SELECT lang, count(*)::int AS songs FROM songs GROUP BY lang",
    materialized: true,
    roles: ["admin", "analyst"]
}
```

Postgres no pone seguridad a nivel de fila en una vista materializada: quien puede leerla
la lee entera. Por eso Rebase la sirve solo a los llamadores que tengan uno de los `roles`
(`["admin"]` si se omite, rol que tiene `dataAsAdmin`) y rechaza a todos los demás
con `403 VIEW_NOT_READABLE`. No pongas en una vista nada que sus lectores no deban ver.

Las filas son las de la última actualización. Actualiza con `refresh()` (en el servidor
como `rebase.dataAsAdmin.langs.refresh()`, o desde un cliente con sesión iniciada con uno de
los roles) o por HTTP:

```ts
await client.data.langs.refresh();
await client.data.langs.refresh({ concurrently: true });
```

```bash
POST /api/data/langs/refresh
{ "concurrently": true }
```

`concurrently` sigue sirviendo las filas antiguas mientras se calculan las nuevas; necesita
el índice único que Rebase crea sobre las columnas `isId`, por lo que estas deben ser
únicas en el resultado de la consulta. Para actualizar de forma programada, llama a `refresh()` desde un
[cron job](/docs/backend/cron-jobs/). Una vista materializada puede llevar `indexes`
propios (consulta [Índices](/docs/backend/indexes/)); una vista simple usa los
índices de sus tablas.

## Lo que una vista no puede tener

`securityRules`, `history`, `softDelete`, `tenant` y `search` se rechazan en el
arranque, porque cada uno necesita una tabla en la que escribir o a la que adjuntarse.

Un `listen` sobre una vista se entera de un `refresh()`. Una escritura en las tablas bajo
una vista no llega a los suscriptores de la vista: suscríbete a las tablas, o
vuelve a leer la vista.
