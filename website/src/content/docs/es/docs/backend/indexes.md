---
sourceHash: e086faac3624de8d
title: Índices
sidebar_label: Índices
description: Declara índices estándar de Postgres en una tabla — btree, GIN y BRIN, parciales, compuestos, de cobertura y únicos — y por qué los escritos a mano solían desaparecer.
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una tabla declara los índices que necesitan sus consultas, junto a las columnas que cubren:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull(),
        status:      col.enum(["draft", "published"]).notNull().default("draft"),
        publishDate: col.timestamp({ withTimezone: true }),
    },
    indexes: [
        {
            columns: ["status", { column: "publishDate", direction: "desc" }],
            reason: "admin list: filter by status, newest first",
        },
    ],
    rls: "admin-only",
});
```

## Por qué existe esto

El generador de DDL siempre ha emitido sentencias de índice exactamente para dos cosas,
y ambas son estructuras pertenecientes a una *funcionalidad* más que a consultas que hayas escrito: el índice
GIN detrás de un [bloque `search`](/docs/backend/search), y el índice ANN detrás
de una [columna `col.vector()`](/docs/sdk/aggregates-and-search#the-index). El caso común —el btree
detrás de una cláusula `where`— no tenía ningún lugar de declaración.

Por lo tanto, la única forma de tener uno era escribirlo a mano. Y:

:::caution[Si tienes índices escritos a mano en una tabla gestionada por Rebase]
`rebase db push` es declarativo. Un índice en una tabla gestionada que no estuviera
presente en `schema.sql` se consideraba desvío (drift), y Atlas planificaba `DROP INDEX` para él —lo
cual no está en la lista de sentencias destructivas, por lo que la aplicación autoaprobada lo
ejecutaba sin preguntar. Cada índice escrito a mano en una tabla gestionada tenía los días
contados.

Eso se soluciona con la regla de propiedad que se detalla a continuación: un índice que Rebase no haya creado ahora
queda excluido del diff por nombre y nunca se toca. Declarar tus índices escritos a mano
sigue siendo el mejor estado final —un índice declarado se crea en una base de datos
nueva y en cada tenant, mientras que uno escrito a mano no—, pero mientras tanto nada los
eliminará.
:::

## La estructura

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `columns` | `(string \| { column, direction?, nulls? })[]` | **Obligatorio.** Las columnas clave, en orden. 1–5 entradas. |
| `reason` | `string` | Por qué existe este índice, en una línea. Muy recomendado. |
| `using` | `"btree" \| "gin" \| "brin"` | Método de acceso. Por defecto es `btree`. |
| `where` | `IndexPredicate` | Hace que el índice sea parcial: cubre solo las filas que coincidan con esto. |
| `unique` | `boolean` | Solo btree. Una garantía de unicidad compuesta. |
| `include` | `string[]` | Solo btree. Columnas de carga útil (payload) incluidas para index-only scans. |

### `columns` toma claves de columna, nunca nombres SQL

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El nombre de una relación `belongsTo` representa su columna de clave foránea, por lo que la relación
`author` es la columna `author_id`:

```ts
indexes: [
    // `author` is the relation; its key is the column author_id.
    { columns: ["author"], reason: "an author's posts, and the ON DELETE cascade" },
]
```

Escribir `author_id` aquí es rechazado: es un nombre de columna SQL, no una clave de la
tabla, y `columns` nombra claves. Postgres no
indexa automáticamente una columna de clave foránea; sin este índice, tanto "listar los
posts de este autor" como la cascada `ON DELETE` son escaneos secuenciales.

Una relación `hasMany` o many-to-many no tiene columna en esta tabla y es
rechazada: declara el índice en la tabla que posee la clave foránea.

### El orden importa, y solo se puede utilizar un subconjunto inicial

Postgres puede usar un subconjunto inicial de las columnas clave, por lo que
`["ownerId", "createdAt"]` sirve para una consulta que filtre por `ownerId`, y una que
filtre por ambos, y **nunca** para una que filtre únicamente por `createdAt`.

`direction` y `nulls` solo tienen sentido cuando el `ORDER BY` de una consulta mezcla
direcciones. Un índice `DESC` solitario es redundante con su gemelo `ASC` —Postgres
escanea un btree hacia atrás con la misma rapidez—, por lo que un solo índice sirve tanto para el filtro *como*
para la ordenación en el ejemplo al principio de esta página.

```ts
indexes: [{ columns: [{ column: "createdAt", direction: "desc", nulls: "last" }], reason: "…" }]
```

Escribir explícitamente el valor por defecto de Postgres es gratuito: el nombre derivado aplica un hash
al orden *efectivo*, por lo que añadir `direction: "asc"` a una columna que ya era
ascendente no constituye una redefinición y no reconstruye nada.

El límite es de cinco claves. Postgres permite treinta y dos; a partir de cuatro, las columnas
finales son un peso muerto en cada escritura, y la declaración suele ser el intento de alguien esperando que
una consulta sea más rápida por acumulación. Las columnas de carga útil que no se buscan pertenecen a
`include`, que no cuenta para el límite.

### `where` es estructurado, no SQL

```ts
indexes: [{
    columns: ["publishDate"],
    where: { column: "status", op: "=", value: "published" },
    reason: "public feed: published posts by date",
}]
```

De este modo, el índice solo contiene filas publicadas y se mantiene pequeño a medida que se acumulan los borradores.

Los operadores son `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null` e
`is not null`, combinados con `and`:

```ts
indexes: [{
    columns: ["assignee"],
    where: {
        and: [
            { column: "status", op: "in", value: ["open", "in_progress"] },
            { column: "archivedAt", op: "is null" },
        ],
    },
    reason: "the open-work queue, which is a fraction of the table",
}]
```

Deliberadamente no existe `or`. Un predicado OR casi siempre significa que el índice
no debería ser parcial en absoluto; si realmente necesitas uno, declara dos índices.

Un predicado es una estructura en lugar de una cadena porque una cadena no se podría
validar contra las columnas de la tabla, no se podría generar su huella (fingerprint) sin
incluir su propio texto en el nombre del índice —por lo que reformatearlo renombraría un
índice en producción— y sería el único lugar donde un llamador recurriría a una clase de operador
de extensión que el planificador no puede reproducir.

### `unique` es solo para compuestos

La unicidad de una sola columna se define con `.unique()` en la columna, y declararla aquí
también es rechazado en lugar de aceptarse como sinónimo. `.unique()` se compila en un
`UNIQUE` en línea cuyo índice subyacente es nombrado por
Postgres —no Rebase— como `<table>_<column>_key`.

```ts
indexes: [{ columns: ["workspaceId", "slug"], unique: true, reason: "one slug per workspace" }]
```

### `include` permite un index-only scan

Las columnas de carga útil residen en las páginas hoja: no son buscables ni están ordenadas, y
evitan un acceso al heap a costa de un índice más pesado. No pueden solaparse con `columns`.

```ts
indexes: [{ columns: ["status"], include: ["title"], reason: "the status sidebar counts, without touching the heap" }]
```

### `using`

`btree` (por defecto) responde a igualdad, rango, `ORDER BY` y unicidad.

`gin` es para contención sobre una columna de tipo array o `jsonb`. `brin` es para una
columna ordenada de forma natural en una tabla de solo inserción (append-only) —diminuto e inútil
en el momento en que las filas comiencen a llegar desordenadas. Ninguno de los dos tiene ordenación, por lo que
`direction` y `nulls` no son representables en ellos en lugar de ser rechazados más tarde por Postgres.

No hay `gist` ni `hash`: cada clase de operador gist interesante viene en
una extensión, y los índices hash no pueden ser únicos, compuestos ni ordenados. Esa
restricción es lo que mantiene todo el modelo en la ruta de Atlas: `rebase db push`
materializa el estado deseado en una base de datos temporal vacía para planificar contra ella, y
`CREATE EXTENSION` no puede incluirse en ese archivo. **La búsqueda por trigramas es
[`search:`](/docs/backend/search); ANN es una
[columna `col.vector()`](/docs/sdk/aggregates-and-search#the-index).** Un índice que requiera
`gin_trgm_ops` o `vector_cosine_ops` se rechaza en tiempo de compilación en lugar de
emitirse para fallar más tarde contra una base de datos que nunca has visto.

### `reason`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Es el único campo que no tiene SQL detrás y es opcional; pero escríbelo.

Un índice es lo único que un esquema puede declarar que cuesta dinero para siempre
y cuyo beneficio es invisible desde la configuración. El motivo (`reason`) es lo que se imprime
junto a "0 scans in 34 days, 412 MB", que es el único momento en el que alguien está en
posición de decidir si eliminarlo. Sin él nadie puede decidir, así que nadie lo hace,
y la tabla acumula índices durante toda la vida útil del producto.

Deliberadamente **no** forma parte de la identidad del índice: reformular una
justificación nunca reconstruye un índice.

## Cómo se nombra una declaración

`<table>_<columns>_ix_<7 hex>`, o `_ux_` cuando es único. Por ejemplo,
`posts_status_publish_date_ix_a91c3f4`.

El hash se calcula sobre la *semántica* del índice —método, columnas, orden, unicidad,
columnas incluidas, predicado— y no sobre su SQL generado, por lo que un cambio en la forma
en que Rebase formatea el DDL nunca renombra nada en tu base de datos.

El hash es fundamental. `CREATE INDEX IF NOT EXISTS` coincide por el **nombre**,
no por la definición: con un nombre legible, cambiar una declaración mantendría el
índice antiguo y reportaría éxito para siempre. Con el hash en el nombre, una redefinición
es un objeto diferente, por lo que se crea y se elimina el antiguo.

Dos consecuencias que vale la pena mencionar:

- **Cambiar una declaración implica un DROP y un CREATE**, emitidos sin adornos: sin
  `CONCURRENTLY`, y con un intervalo sin índice entre medias. Aceptable en una base de datos
  de desarrollo; en una tabla grande en producción, aplícalo en el momento que elijas.
- El nombre es [un nombre derivado congelado](/docs/architecture/schema-as-code). Está
  en `contracts/derived-names.txt` y no puede cambiar entre versiones.

## Quién es el propietario de un índice

`_ix_`/`_ux_` más siete caracteres hexadecimales es inalcanzable para cualquier otro generador de nombres aquí: `_fkey`,
`_gin`, `_trgm`, `_pkey`, `_key`, las distancias vectoriales, el prefijo `idx_` de auth. Por lo tanto,
solo el nombre decide la propiedad:

| El índice | ¿En el plan? | ¿Nombrado por Rebase? | Qué sucede |
|---|---|---|---|
| declarado | sí | sí | se crea y luego se mantiene |
| declaración eliminada | no | sí | **se elimina (dropped)**, según lo previsto |
| escrito a mano, o de introspección | no | no | **excluido — nunca se toca** |

Ninguno de los casos necesita confirmación. Eliminar una declaración *debería* borrar el índice
de forma silenciosa; lo que nunca debe eliminarse es uno que Rebase no haya creado. Esto es también
lo que hace seguro el ciclo de introspección: los índices existentes de una base de datos a la
que apuntaste Rebase son ajenos hasta que alguien los declare.

### Declarar un índice que ya tienes

Cuando declaras un índice que la base de datos ya tiene con otro nombre, Rebase
se hace cargo de ese índice en lugar de construir una segunda copia. Antes de construir un
índice declarado que falta, `rebase db push`, `rebase db migrate` y el arranque (boot)
buscan un índice existente en la misma tabla que coincida con él en cada parte.
Una coincidencia se renombra al nombre declarado con
`ALTER INDEX … RENAME TO …`, lo que cambia el catálogo y no reconstruye nada.
A partir de ese momento es el índice declarado: se encuentra por su nombre, se mantiene y se elimina si se
quita la declaración.

Todas estas partes deben coincidir:

- el método de acceso;
- la unicidad;
- las columnas clave, en orden, cada una con su dirección y posición de `NULLS`
  (la dirección solo cuenta para `btree`);
- las columnas `INCLUDE`;
- el predicado. Se ignoran las comillas de Postgres, los casts literales y los paréntesis;
  cualquier otra diferencia implica que no hay coincidencia.

Rebase no toca un índice existente y construye el declarado a su lado
cuando ese índice difiere en cualquiera de esas partes. También lo deja intacto cuando una
clave es una expresión, una clave usa una clase de operador o intercalación (collation) no predeterminada,
el índice respalda una restricción, el índice es `INVALID` o ya tiene un nombre
de Rebase.

`rebase db generate` escribe cada índice declarado en la migración como
`CREATE INDEX IF NOT EXISTS`, de modo que la sentencia tiene éxito cuando `rebase db migrate`
acaba de renombrar un índice existente a ese nombre.

## Cuándo se crean

Ambos generadores los emiten, lo cual es importante porque no todos los despliegues ejecutan
`db push`:

- **`rebase db push` / `rebase db generate`** los colocan en `schema.sql`, en la
  ruta habitual de Atlas, por lo que obtienen migraciones, detección de desviaciones (drift) y rollback
  como cualquier otro objeto.
- **`rebase schema generate`** también los escribe en `schema.generated.ts`, de modo
  que el esquema de Drizzle describe la misma tabla que tiene la base de datos. Las columnas
  `INCLUDE` de un índice de cobertura son la única excepción: Drizzle no puede expresarlas,
  y la línea generada incluye un comentario que lo indica y apunta a
  `schema.sql`, que sí puede.
- **La verificación del esquema en el arranque (Boot-time schema ensure)** también los crea,
  en los mismos términos que los índices search y ANN contiguos. Un tenant de runtime gestionado
  se aprovisiona en el arranque y nunca ejecuta `db push`; sin esto, se iniciaría sin ninguno
  de sus índices declarados y nada lo advertiría. Una tabla que el arranque crea obtiene sus
  índices junto con la tabla. En una tabla que ya existe, el arranque construye el índice
  faltante después de que el servidor esté prestando servicio, en segundo plano, del mismo modo en que
  construye los [índices de clave foránea](#qué-hace-la-actualización-en-una-base-de-datos-existente).
  Utiliza `CREATE INDEX CONCURRENTLY` en una conexión propia, de modo que el
  `statement_timeout` de 30 s del pool no puede cancelar una construcción prolongada. Un índice que una
  construcción interrumpida haya dejado como `INVALID` bajo su nombre se elimina y se vuelve a construir.
  `IF NOT EXISTS` coincide por el nombre, por lo que nunca repara uno. Un índice `unique`
  se construye de la misma manera pero antes de que el servidor preste servicio, y el arranque falla
  si no se puede construir. Prestar servicio sin él permitiría la entrada de filas duplicadas.

## Las claves foráneas se indexan automáticamente

Postgres crea el
índice al que una clave foránea *apunta* —la clave primaria del destino— y nunca uno en
la columna que la *contiene*. Cada lectura desde el otro lado de un enlace filtra por
esa columna: un include de `hasMany` o `hasOne`, un listado anidado como
`/authors/5/posts` (su página y su conteo), el lado inverso de un
`manyToMany`, y la comprobación `ON DELETE` cuando se elimina una fila padre. Sin
un índice, cada una de esas operaciones lee todas las filas de la tabla secundaria (child table).

Por lo tanto, Rebase deriva un btree estándar para:

- la `localKey` de cada [`belongsTo`](/docs/collections/relations/#belongsto--the-key-is-on-this-table),
  que también es la columna que lee el `hasOne` / `hasMany` del otro extremo;
- la columna destino de cada tabla intermedia (junction) de `manyToMany`. La clave primaria de la tabla intermedia
  `(source, target)` ya atiende búsquedas por la columna de origen; el lado inverso
  del enlace necesita esta. Una tabla intermedia pertenece a Rebase, por lo que esta
  no tiene opción de exclusión.

Medido en Postgres 18 con caché tibia (warm cache), 1M de comentarios sobre 50k publicaciones:

| La lectura | Sin el índice | Con él |
|---|---|---|
| `include=comments` en una página de 25 posts (`post_id IN (…)`) | 38 ms | 0.3 ms |
| `GET /posts/77/comments?limit=25` — la página | 28 ms | 0.3 ms |
| …y su `count(*)` | 29 ms | 0.2 ms |
| eliminar un post (comprobación `ON DELETE SET NULL`) | 129 ms | 1.7 ms |

Nada se indexa dos veces. El índice derivado se omite cuando la columna ya
encabeza la clave primaria, tiene un `UNIQUE` (`.unique()` en una columna vinculada o
`unique: true` en la relación), o encabeza un índice en `indexes:` —
simple o compuesto, siempre que sea un btree sin `where`. Un índice parcial
no puede atender una búsqueda que debe abarcar todas las filas, y un índice GIN o BRIN
responde a una pregunta diferente, por lo que ninguno cuenta.

El nombre es el que deriva [una declaración](#cómo-se-nombra-una-declaración) de un índice
estándar en esa columna —`posts_author_id_ix_00ad191`—, por lo que el índice derivado
e `indexes: [{ columns: ["author"], … }]` son un solo objeto, no dos. Es un
[nombre derivado congelado](/docs/architecture/schema-as-code) como cualquier otro.

Para mantener la restricción y descartar el índice —en una tabla con tanta escritura que el
índice cuesta más que las búsquedas que atiende, o una donde mantienes un índice
propio fuera de `indexes:`— indícalo en la relación:

```ts
relations: {
    author: rel.belongsTo(() => authors, { index: false }),
}
```

`index` existe solo en `belongsTo`: en los otros tipos, la clave foránea es una
columna en el destino (configura `index` en el `belongsTo` del destino) o en una tabla intermedia (junction).

Rebase lee únicamente tus tablas para decidir esto, nunca la base de datos: `db
push` y el arranque deben llegar al mismo conjunto de índices con los mismos nombres, o de
lo contrario el siguiente push eliminaría lo que el arranque construyó. Por lo tanto, un índice que hayas escrito a mano
en la misma columna, fuera de `indexes:`, no es visible: decláralo en
`indexes:` o establece `index: false` para mantener un índice en lugar de dos.

### Qué hace la actualización en una base de datos existente

Los índices son objetos nuevos en tablas que ya contienen datos, y las dos vías
los construyen de manera diferente:

- **El arranque no espera por ellos.** En una tabla que ya existe, la
  verificación del esquema deja los índices de clave foránea faltantes fuera del arranque y
  los construye después de que el servidor esté prestando servicio, uno a uno, con
  `CREATE INDEX CONCURRENTLY` en una conexión propia (el `statement_timeout` de 30 s
  del pool no se le aplica). Esto no adquiere ningún bloqueo que haga esperar a lecturas o escrituras.
  Si otra sesión retiene una tabla —la construcción de otra instancia, un
  `ALTER TABLE`—, se desiste de ella dentro del margen de bloqueo (lock budget) del arranque y se vuelve a
  intentar en el siguiente arranque. Un índice que una construcción interrumpida haya dejado como `INVALID` (un
  despliegue que reemplazó el proceso a mitad de construcción, dos instancias compitiendo por un mismo nombre) se elimina
  y se vuelve a construir. Cada uno se registra cuando comienza y cuando termina; un fallo es
  una advertencia, nunca un arranque fallido. Una tabla que este arranque crea obtiene sus índices con
  la tabla, antes de que nada pueda escribir en ella. Bajo `REBASE_PROVISION_ONLY`, las
  construcciones se ejecutan antes de que el proceso termine, ya que nada posterior las ejecutaría.
- **`rebase db push` los construye antes de planificar**, con el mismo mecanismo de construcción y
  en los mismos términos que el arranque: `CREATE INDEX CONCURRENTLY`, uno por uno,
  de modo que las lecturas y escrituras continúen mientras se ejecuta (aproximadamente 0.4 s para 1M de filas y 6 s para
  10M como construcción simple en el SSD de un portátil, `maintenance_work_mem` de 64 MB; una
  concurrente tarda más y no bloquea nada). Atlas luego encuentra cada índice
  en su lugar y no planifica nada para él. Un índice que no pudo construir primero —una
  tabla retenida por otra sesión durante todo el presupuesto de bloqueo— se deja a Atlas,
  que lo construye dentro de la transacción del push y, por tanto, bloquea las escrituras en esa
  tabla durante la construcción; el push indica cuáles. Una columna de clave foránea que el push
  mismo añade recibe su índice de Atlas junto con la columna, antes de que
  contenga datos. `--dry-run` no construye nada: nombra los índices que un push real
  construiría primero, y el plan que imprime los enumera, ya que aún no existen.

## Qué se rechaza y cuándo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Todo esto se rechaza cuando se compila el esquema, indicando la tabla y la
posición en el array; un índice que silenciosamente no existe es el fallo
que elimina toda esta funcionalidad:

- una clave que no sea una columna o relación `belongsTo` de la tabla, o una relación
  cuya clave foránea resida en la otra tabla
- más de cinco claves en `columns`, o la misma columna dos veces
- exactamente las columnas de la clave primaria —`<table>_pkey` ya las indexa
- una columna presente tanto en `columns` como en `include`
- `unique` en una columna que ya declara `.unique()`
- `direction` o `nulls` bajo `gin` o `brin`
- una lista `in` que repite un valor
- dos declaraciones que derivan el mismo nombre —son el mismo índice, dos veces
- un `reason` vacío

## Relacionado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Search](/docs/backend/search) — búsqueda de texto completo clasificada, que construye su propio
  índice GIN sobre un `tsvector` generado
- [Búsqueda vectorial](/docs/sdk/aggregates-and-search#vector-search) — el índice ANN sobre una
  columna de embeddings, configurado en `col.vector()`
- [Esquema como código](/docs/architecture/schema-as-code) — cómo llegan las declaraciones a
  la base de datos y qué es un nombre derivado
- [Tablas](/docs/schema/) — cada clave de `defineTable`
