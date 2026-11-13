---
sourceHash: 8a72cff37e30800b
title: Vistas
sidebar_label: Vistas
description: "Sirve una vista SQL o una vista materializada de solo lectura con defineView: vistas security_invoker gobernadas por las tablas que leen, vistas materializadas restringidas por roles, actualizadas bajo demanda, creadas mediante db push."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`defineView` sirve una consulta SQL como una tabla de solo lectura. Declara la consulta, las
columnas que devuelve y la columna o columnas que identifican una fila:

```ts
// backend/schema/artist-stats.ts
import { defineView, col } from "@rebasepro/server/schema";

export const artistStats = defineView("artist_stats", {
    query: `SELECT lower(artist) AS artist, count(*)::int AS songs, max(fame) AS fame
            FROM songs GROUP BY 1`,
    columns: {
        artist: col.text().primaryKey(),
        songs:  col.integer().notNull(),
        fame:   col.integer(),
    },
});
```

Expórtala desde `backend/schema/index.ts` como una tabla. Se lee como cualquier
tabla — `find`, `findById`, `count`, [`aggregate`](/docs/sdk/aggregates-and-search/),
`listen`, las rutas REST, MCP y el CMS — y nunca se escribe en ella: cada
escritura es un `405 TABLE_READ_ONLY`. Escribe en las tablas que lee la vista.

`rebase db push` crea la vista después de las tablas, `rebase db generate`
la añade a la migración, y un arranque administrado la crea en su paso de esquema.
Una vista cuya consulta no ha cambiado se deja intacta; una cuya consulta haya cambiado se
elimina y se crea de nuevo, junto con cualquiera de tus vistas que la lean.
Rebase se niega a reemplazar una tabla, o una vista que no haya creado él mismo, que ya
tenga ese nombre.

## Opciones

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Clave | Qué hace |
|---|---|
| `query` | **Obligatorio.** El `SELECT` que la define. |
| `columns` | **Obligatorio.** Las columnas que devuelve la consulta, como constructores `col.*`. `.primaryKey()` marca las que identifican una fila. |
| `materialized` | `true` almacena las filas. Consulta [Vistas materializadas](#vistas-materializadas). |
| `roles` | Quién puede leer una vista materializada. `["admin"]` si se omite. Se rechaza en una vista normal. |
| `table` | El nombre de la vista SQL, cuando difiere del nombre. |
| `slug` | El nombre en la API. El nombre de la vista si se omite. |
| `schema` | El esquema de Postgres. `public` si se omite. |
| `database` | Una base de datos de Postgres distinta a la predeterminada. |
| `description` | Qué contiene la vista, para OpenAPI y MCP. |
| `relations` | Relaciones a través de las cuales leer, como en una tabla. No se crea ninguna restricción (constraint) para una vista. |
| `indexes` | Índices sobre las filas almacenadas de una vista materializada. |
| `hooks` | Solo `beforeQuery` y `afterRead`. Consulta [Hooks de tabla](/docs/collections/callbacks/). |
| `metadata` | Cualquier dato que desees servir con el descriptor de la vista. |

Una vista tiene al menos una columna `.primaryKey()`: una vista no tiene clave propia,
y una fila necesita una dirección.

## Quién ve qué filas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una vista normal se crea `WITH (security_invoker = true)`, por lo que se ejecuta **como el
emisor de la llamada**: la seguridad a nivel de fila (RLS) de las tablas que lee decide qué
ve cada emisor. Un usuario cuyas políticas le permiten ver sus propias canciones ve la vista de
sus propias canciones. Por eso una vista no tiene `rls`: no hay nada a lo que adjuntar
políticas, ni nada que pudieran añadir. Consulta
[Seguridad a nivel de fila](/docs/collections/security-rules/) para ver las políticas de las
tablas subyacentes.

## Vistas materializadas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`materialized: true` almacena las filas, de modo que una lectura no ejecuta la consulta:

```ts
import { defineView, col } from "@rebasepro/server/schema";

export const langs = defineView("langs", {
    query: "SELECT lang, count(*)::int AS songs FROM songs GROUP BY lang",
    materialized: true,
    roles: ["admin", "analyst"],
    columns: {
        lang:  col.text().primaryKey(),
        songs: col.integer().notNull(),
    },
    indexes: [{ columns: ["songs"], reason: "the most-used languages first" }],
});
```

Postgres no aplica seguridad a nivel de fila en una vista materializada: quienquiera que pueda leerla,
la lee por completo. Por lo tanto, Rebase solo la sirve a los emisores que tengan uno de los `roles`
(`["admin"]` cuando se omite, el cual posee `dataAsAdmin`) y rechaza a todos los demás
con `403 VIEW_NOT_READABLE`. No pongas nada en ella que sus lectores no deban ver.

La regla también se mantiene en la base de datos, por lo que el [SQL ejecutado como emisor de la llamada](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller)
también la cumple. Las filas se almacenan bajo `<view>_rebase_rows`, que solo el
propietario de la base de datos puede leer, y el propio nombre de la vista es una vista sobre ellas que
devuelve filas solo a un emisor que posea uno de los `roles`, y al propio servidor
(`rebase.sql()`, crons). Consulta el nombre de la vista, nunca las filas almacenadas.

Las filas corresponden al momento de la última actualización. Actualiza con `refresh()` — en el servidor
como `rebase.dataAsAdmin.langs.refresh()`, o desde un cliente autenticado con uno de
los roles — o a través de HTTP:

```typescript
await client.data.langs.refresh();
await client.data.langs.refresh({ concurrently: true });
```

```bash
POST /api/data/langs/refresh
{ "concurrently": true }
```

`concurrently` sigue sirviendo las filas antiguas mientras se calculan las nuevas.
Requiere el índice único que Rebase crea en las columnas `.primaryKey()`, por lo que estas
deben ser únicas en el resultado de la consulta. Para actualizar de forma programada, llama a
`refresh()` desde un [trabajo cron](/docs/backend/cron-jobs/). Una vista materializada puede
tener sus propios `indexes` (consulta [Índices](/docs/backend/indexes/)), construidos sobre sus
filas almacenadas; una vista normal lee los índices de sus tablas.

## Lo que una vista no puede tener

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`rls`, `history`, `softDelete`, `tenant` y `search` son rechazados cuando se
compila el esquema: cada uno necesita una tabla en la que escribir o a la que adjuntar políticas.
`roles` en una vista normal se rechaza cuando se carga el módulo, al igual que una
`query` vacía. `indexes` en una vista normal se rechaza cuando se compila el esquema.

Un `listen` en una vista recibe notificación de un `refresh()`. Una escritura en las tablas bajo una vista
no llega a los suscriptores de la vista: suscríbete a las tablas, o vuelve a leer
la vista.
