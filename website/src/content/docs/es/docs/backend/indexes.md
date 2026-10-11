---
sourceHash: 3d8676ac5f8d58c7
title: Índices
sidebar_label: Índices
description: Declara índices ordinarios de Postgres en una colección — btree, GIN y BRIN, parciales, compuestos, cubrientes y únicos — y por qué uno escrito a mano solía desaparecer.
---

Una colección declara los índices que necesitan sus consultas, en el mismo archivo que las
propiedades que cubren:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const posts: PostgresCollectionConfig = {
    slug: "posts",
    table: "posts",
    name: "Blog posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string", enum: { draft: "Draft", published: "Published" } },
        publish_date: { name: "Publish date", type: "date" }
    },
    indexes: [
        {
            on: ["status", { prop: "publish_date", direction: "desc" }],
            reason: "admin list: filter by status, newest first"
        }
    ]
};
```

Solo para Postgres. En otro motor, la clave se rechaza en el arranque en lugar de
ignorarse silenciosamente.

## Por qué existe esto

El generador de DDL siempre ha emitido sentencias de índice para exactamente dos cosas,
y ambas son estructuras que pertenecen a una *funcionalidad* en lugar de a consultas que tú hayas escrito: el
índice GIN detrás de un [bloque `search`](/docs/backend/search) y el índice ANN detrás
de una [propiedad `vector`](/docs/sdk/aggregates-and-search#the-index). El caso común —el btree
detrás de una cláusula `where`— no tenía ningún lugar de declaración en absoluto.

Por lo tanto, la única forma de tener uno era escribirlo a mano. Y:

:::caution[Si tienes índices escritos a mano en una tabla administrada por Rebase]
`rebase db push` es declarativo. Un índice en una tabla administrada que no estuviera presente
en `schema.sql` se consideraba una desviación (*drift*), y Atlas planificaba un `DROP INDEX` para él —lo
cual no está en la lista de sentencias destructivas, por lo que la aplicación autoaprobada lo
eliminaba sin preguntar. Cada índice escrito a mano en una tabla administrada estaba viviendo en
tiempo prestado.

Esto se soluciona mediante la regla de propiedad que se explica a continuación: un índice que Rebase no haya creado
ahora se excluye del diff por nombre y nunca se modifica. Declarar tus índices
escritos a mano sigue siendo el mejor estado final —un índice declarado se crea en una base
de datos nueva y en cada inquilino (*tenant*), mientras que uno escrito a mano no— pero, mientras tanto,
nada los eliminará.
:::

## La estructura

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `on` | `(string \| IndexKey)[]` | **Requerido.** Las columnas clave, en orden. 1–5 entradas. |
| `reason` | `string` | **Requerido.** Por qué existe este índice, en una línea. |
| `using` | `"btree" \| "gin" \| "brin"` | Método de acceso. Por defecto es `btree`. |
| `where` | `IndexPredicate` | Hace que el índice sea parcial: solo cubre las filas que coinciden con esto. |
| `unique` | `boolean` | Solo btree. Una garantía de unicidad compuesta. |
| `include` | `string[]` | Solo btree. Columnas de carga útil (*payload*) transportadas para escaneos solo de índice (*index-only scans*). |

### `on` acepta claves de propiedad, nunca nombres de columna

Este es el detalle que suele causar problemas. Una relación `belongsTo` compila a su
`localKey` resuelta, por lo que la propiedad `author` es la columna `author_id`:

```typescript
// Correct — `author` is the relation property.
{ on: ["author"], reason: "an author's posts, and the ON DELETE cascade" }
```

Escribir `author_id` aquí se rechaza en la compilación: es una columna, no una propiedad de
la colección, y `on` nombra propiedades. Postgres no
indexa una columna de clave foránea por ti; sin este índice, tanto "listar los posts de este
autor" como la cascada `ON DELETE` son escaneos secuenciales (*sequential scans*).

Una relación `hasMany` o de muchos a muchos no tiene columna en esta tabla, y se
rechaza indicando la colección que sí posee la clave foránea.

### El orden importa, y solo se puede utilizar un subconjunto inicial

Postgres puede usar un subconjunto inicial (*leading subset*) de las columnas clave, por lo que
`["ownerId", "createdAt"]` sirve para una consulta que filtra por `ownerId`, y para una
que filtra por ambos, y **nunca** para una que filtra solo por `createdAt`.

`direction` y `nulls` solo se justifican cuando el `ORDER BY` de una consulta mezcla
direcciones. Un índice `DESC` solitario es redundante con su gemelo `ASC` —Postgres
escanea un btree hacia atrás con la misma rapidez—, por lo que un solo índice cubre el filtro *y* la
ordenación en el ejemplo al principio de esta página.

```typescript
{ on: [{ prop: "createdAt", direction: "desc", nulls: "last" }], reason: "…" }
```

Escribir el valor por defecto de Postgres de forma explícita no cuesta nada: el nombre derivado calcula el hash
del orden *efectivo*, por lo que añadir `direction: "asc"` a una columna que ya era
ascendente no es una redefinición y no reconstruye nada.

El límite es de cinco claves. Postgres permite treinta y dos; a partir de cuatro, las columnas
finales son peso muerto en cada escritura, y la declaración suele ser alguien que espera que una
consulta sea más rápida por acumulación. Las columnas de carga útil (*payload*) que no se buscan pertenecen a
`include`, que no cuenta para el límite.

### `where` es estructurado, no SQL

```typescript
{
    on: ["publish_date"],
    where: { prop: "status", op: "=", value: "published" },
    reason: "public feed: published posts by date"
}
```

De este modo, el índice solo contiene filas publicadas y se mantiene pequeño a medida que se acumulan los borradores.

Los operadores son `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null` e
`is not null`, combinados con `and`:

```typescript
{
    on: ["assignee"],
    where: {
        and: [
            { prop: "status", op: "in", value: ["open", "in_progress"] },
            { prop: "archived_at", op: "is null" }
        ]
    },
    reason: "the open-work queue, which is a fraction of the table"
}
```

Deliberadamente no existe `or`. Un predicado OR casi siempre significa que el índice
no debería ser parcial en absoluto; si realmente necesitas uno, declara dos índices.

Un predicado es una estructura en lugar de una cadena porque una cadena no podría
verificarse contra las propiedades de la colección, no podría identificarse con una huella (*fingerprint*) sin
poner su propio texto en el nombre del índice —por lo que reformatearlo renombraría un
índice en producción— y sería el único lugar donde un llamador recurriría a una clase de operador de
extensión que el planificador no puede reproducir.

### `unique` es solo para compuestos

La unicidad para una sola columna se define con `validation.unique` en la propiedad, y declararla
aquí también se rechaza en lugar de aceptarse como sinónimo.
`validation.unique` compila a un `UNIQUE` en línea cuyo índice de respaldo
Postgres —no Rebase— nombra como `<table>_<column>_key`.

```typescript
{ on: ["workspaceId", "slug"], unique: true, reason: "one slug per workspace" }
```

### `include` permite un escaneo solo de índice (index-only scan)

Las columnas de carga útil (*payload*) residen en las páginas hoja: no admiten búsquedas, no están ordenadas y
ahorran una lectura del montón (*heap fetch*) a costa de un índice más pesado. No pueden solaparse con `on`.

```typescript
{ on: ["status"], include: ["title"], reason: "the status sidebar counts, without touching the heap" }
```

### `using`

`btree` (el predeterminado) responde a igualdad, rango, `ORDER BY` y unicidad.

`gin` sirve para contención sobre una propiedad `array` o un `map` JSONB. `brin` es para una
columna ordenada naturalmente en una tabla de solo inserción (*append-only*): diminuto e inútil en cuanto
las filas empiezan a llegar desordenadas. Ninguno de los dos tiene ordenación, por lo que `direction` y
`nulls` no son representables en ellos en lugar de ser rechazados más tarde por Postgres.

No hay `gist` ni `hash`: cada clase de operador gist interesante viene en
una extensión, y los índices hash no pueden ser únicos, compuestos ni ordenados. Esa
restricción es lo que mantiene todo el modelo en la ruta de Atlas: `rebase db push`
materializa el estado deseado en una base de datos temporal (*scratch database*) limpia para planificar sobre ella, y
`CREATE EXTENSION` no puede ir en ese archivo. **La búsqueda por trigramas es
[`search:`](/docs/backend/search); ANN es una
[propiedad `vector`](/docs/sdk/aggregates-and-search#the-index).** Un índice que requiera
`gin_trgm_ops` o `vector_cosine_ops` se rechaza en tiempo de compilación en lugar de
emitirse para fallar más tarde contra una base de datos que nunca has visto.

### `reason` es obligatorio

Es el único campo obligatorio que no tiene SQL detrás.

Un índice es lo único que una configuración de Rebase puede declarar que cuesta dinero para siempre
y cuyo beneficio es invisible desde la configuración. El motivo (*reason*) es lo que se imprime
junto a "0 scans in 34 days, 412 MB", que es el único momento en el que alguien está en
posición de decidir si eliminarlo. Sin él nadie puede decidir, por lo que nadie lo hace,
y la tabla acumula índices durante toda la vida del producto.

Deliberadamente **no** forma parte de la identidad del índice: reformular una
justificación nunca reconstruye un índice.

## Cómo se nombra una declaración

`<table>_<columns>_ix_<7 hex>`, o `_ux_` cuando es único. Por ejemplo,
`posts_status_publish_date_ix_a91c3f4`.

El hash se calcula sobre la *semántica* del índice —método, columnas, orden, unicidad,
columnas incluidas, predicado— y no sobre su SQL renderizado, por lo que un cambio en la forma en que
Rebase formatea el DDL nunca renombra nada en tu base de datos.

El hash cumple una función estructural fundamental. `CREATE INDEX IF NOT EXISTS` compara por el **nombre**,
no por la definición: con un nombre legible, cambiar una declaración mantendría el
índice antiguo y reportaría éxito para siempre. Con el hash en el nombre, una redefinición
es un objeto diferente, por lo que se crea y el antiguo se elimina.

Dos consecuencias que vale la pena mencionar:

- **Cambiar una declaración implica un DROP y un CREATE**, emitidos directamente —sin
  `CONCURRENTLY` y con una ventana de tiempo sin índice entre medias. No hay problema en una base de
  datos de desarrollo; en una tabla grande en producción, aplícalo en el momento que elijas.
- El nombre es [un nombre derivado congelado](/docs/architecture/schema-as-code). Está
  en `contracts/derived-names.txt` y no puede cambiar entre versiones.

## A quién pertenece un índice

`_ix_`/`_ux_` más siete caracteres hexadecimales es inaccesible para cualquier otro generador de nombres aquí —`_fkey`,
`_gin`, `_trgm`, `_pkey`, `_key`, las distancias vectoriales, el prefijo `idx_` de autenticación—. Por lo
tanto, el nombre por sí solo decide la propiedad:

| El índice | ¿En el plan? | ¿Nombrado por Rebase? | Qué sucede |
|---|---|---|---|
| declarado | sí | sí | se crea, luego se mantiene |
| declaración eliminada | no | sí | **se elimina (dropped)**, según lo previsto |
| escrito a mano, o de introspección | no | no | **excluido — nunca se toca** |

Ninguno de los casos necesita confirmación. Eliminar una declaración *debería* quitar el índice
de forma silenciosa; lo que nunca debe eliminarse es uno que Rebase no haya creado. Esto es también
lo que hace que el ciclo completo (*round trip*) de introspección sea seguro: los índices existentes de una base de datos
a la que apuntaste Rebase son ajenos hasta que alguien los declare.

## Cuándo se crean

Ambos productores los emiten, lo cual es importante porque no todos los despliegues ejecutan
`db push`:

- **`rebase db push` / `rebase db generate`** los colocan en `schema.sql`, en la
  ruta habitual de Atlas —por lo que obtienen migraciones, detección de desviaciones (*drift detection*) y reversiones (*rollback*)
  como cualquier otro objeto.
- **`rebase schema generate`** también los escribe en `schema.generated.ts`, de
  modo que el esquema de Drizzle describe la misma tabla que tiene la base de datos. Las columnas
  `INCLUDE` de un índice cubriente son la única excepción: Drizzle no puede expresarlas,
  y la línea generada incluye un comentario indicándolo y apuntando a
  `schema.sql`, que sí puede.
- **Boot-time schema ensure** también los crea, en los mismos términos que los índices de
  búsqueda y ANN a su lado. Un inquilino (*tenant*) de entorno de ejecución administrado se aprovisiona en el arranque y nunca ejecuta
  `db push`; sin esto, comenzaría sin ninguno de sus índices declarados y
  nada lo advertiría. Una tabla que crea el arranque recibe sus índices junto con la tabla.
  En una tabla que ya existe, el arranque construye un índice que falta una vez que el
  servidor ya está sirviendo, en segundo plano, igual que construye los
  [índices de claves foráneas](#qué-hace-la-actualización-a-una-base-de-datos-existente).
  Usa `CREATE INDEX CONCURRENTLY` en una conexión propia, de modo que el
  `statement_timeout` de 30 s del pool no pueda cancelar una construcción larga. Un índice
  que una construcción interrumpida dejó `INVALID` bajo su nombre se elimina y se construye de nuevo.
  `IF NOT EXISTS` compara por el nombre, así que nunca repara uno. Un índice `unique`
  se construye del mismo modo, pero antes de que el servidor sirva, y el arranque falla
  si no se puede construir. Servir sin él dejaría entrar filas duplicadas.

## Las claves foráneas se indexan por ti

<span class="since-badge" data-since="0.25">Desde 0.25</span> Postgres crea el
índice al que una clave foránea *apunta* —la clave primaria del destino— y nunca uno en
la columna que la *contiene*. Toda lectura desde el otro lado de un enlace filtra por
esa columna: una inclusión `hasMany` o `hasOne`, un listado anidado como
`/authors/5/posts` (su página y su conteo), el lado inverso de un
`manyToMany`, y la comprobación de `ON DELETE` cuando se elimina una fila padre. Sin
un índice, cada una de esas lecturas recorre todas las filas de la tabla hija.

Por eso Rebase deriva un btree simple para:

- la `localKey` de cada [`belongsTo`](/docs/collections/relations#belongsto--the-key-is-on-this-table)
  —que es también la columna que lee el `hasOne` / `hasMany` del otro lado—;
- la columna de destino de cada tabla de unión de un `manyToMany`. La clave primaria
  `(source, target)` de la tabla de unión ya sirve las búsquedas por la columna de origen;
  el lado inverso del enlace necesita este. Una tabla de unión es una tabla de Rebase, así que este
  no tiene opción de exclusión.

Medido en Postgres 18 con la caché caliente, 1M de comentarios en 50k posts:

| La lectura | Sin el índice | Con él |
|---|---|---|
| `include=comments` en una página de 25 posts (`post_id IN (…)`) | 38 ms | 0,3 ms |
| `GET /posts/77/comments?limit=25` — la página | 28 ms | 0,3 ms |
| …y su `count(*)` | 29 ms | 0,2 ms |
| eliminar un post (comprobación de `ON DELETE SET NULL`) | 129 ms | 1,7 ms |

Nada se indexa dos veces. El índice derivado se omite cuando la columna ya encabeza la
clave primaria, lleva un `UNIQUE` (`validation.unique` en la relación o en la propiedad
que posee la columna), o encabeza un índice de `indexes:` —simple o compuesto, siempre
que sea un btree sin `where`. Un índice parcial no puede servir una búsqueda que tiene que
alcanzar todas las filas, y un índice GIN o BRIN responde a una pregunta distinta, así que
ninguno cuenta.

El nombre es el que deriva [una declaración](#cómo-se-nombra-una-declaración) de un índice
simple en esa columna —`posts_author_id_ix_00ad191`—, de modo que el índice derivado y
`indexes: [{ on: ["author"], … }]` son un solo objeto, no dos. Es un
[nombre derivado congelado](/docs/architecture/schema-as-code) como todos los demás.

Para conservar la restricción y eliminar el índice —una tabla con tantas escrituras que
el índice cuesta más que las búsquedas que sirve, o una donde mantienes un índice
propio fuera de `indexes:`— indícalo en la relación:

```typescript
author: {
    name: "Author",
    type: "relation",
    relation: { kind: "belongsTo", target: () => authors, index: false }
}
```

`index` se acepta solo en un `belongsTo`; en los demás tipos el validador de configuración
lo rechaza, porque su clave foránea es una columna del destino (define
`index` en el `belongsTo` del destino) o está en una tabla de unión.

Rebase lee solo tus colecciones para decidir esto, nunca la base de datos: `db
push` y el arranque tienen que llegar al mismo conjunto de índices con los mismos nombres, o
el siguiente push eliminaría lo que construyó el arranque. Por lo tanto, un índice que escribiste
a mano en la misma columna, fuera de `indexes:`, no se ve: decláralo en
`indexes:`, o define `index: false`, para conservar un índice en lugar de dos.

### Qué hace la actualización a una base de datos existente

Los índices son objetos nuevos en tablas que ya contienen datos, y las dos vías
los construyen de forma distinta:

- **El arranque no los espera.** En una tabla que ya existe, el schema ensure deja
  fuera del arranque los índices de claves foráneas que faltan y los
  construye cuando el servidor ya está sirviendo, de uno en uno, con
  `CREATE INDEX CONCURRENTLY` en una conexión propia (el `statement_timeout` de 30 s
  del pool no se aplica). Eso no toma ningún bloqueo que esperen lecturas o escrituras. Una
  tabla que otra sesión retiene —la construcción de otra instancia, un
  `ALTER TABLE`— se abandona dentro del presupuesto de bloqueo del arranque y se reintenta en
  el siguiente arranque. Un índice que una construcción interrumpida dejó `INVALID` (un despliegue
  que reemplazó el proceso a mitad de la construcción, dos instancias compitiendo por un mismo nombre) se elimina
  y se construye de nuevo. Cada uno se registra al empezar y al terminar; un fallo es una
  advertencia, nunca un arranque fallido. Una tabla que crea este arranque recibe sus índices junto con
  la tabla, antes de que nada pueda escribir en ella. Con `REBASE_PROVISION_ONLY` las
  construcciones se ejecutan antes de que el proceso termine, ya que nada posterior las ejecutaría.
- **`rebase db push` los construye antes de planificar**, con el mismo constructor y
  en los mismos términos que el arranque: `CREATE INDEX CONCURRENTLY`, de uno en uno,
  de modo que lecturas y escrituras continúan mientras se ejecuta (alrededor de 0,4 s con 1M de filas y 6 s con
  10M como construcción simple en un SSD de portátil, `maintenance_work_mem` 64 MB; una
  concurrente tarda más y no bloquea nada). Atlas encuentra entonces cada índice
  en su sitio y no planifica nada para él. Un índice que no se pudo construir antes —una
  tabla que otra sesión retuvo durante todo el presupuesto de bloqueo— se deja a Atlas,
  que lo construye dentro de la transacción del push y por tanto bloquea las escrituras en esa
  tabla durante la construcción; el push lo indica. Una columna de clave foránea que añade el propio
  push recibe su índice de Atlas junto con la columna, antes de que haya nada
  en ella. `--dry-run` no construye nada: nombra los índices que un push real
  construiría primero, y el plan que imprime los lista, ya que todavía no existen.

## Qué se rechaza y cuándo

Todo lo siguiente lanza un error en tiempo de compilación, indicando la colección y la posición en el
array —un índice que silenciosamente no existe es el fallo que toda esta funcionalidad
elimina:

- una propiedad que no está en la colección, o una relación cuya clave foránea
  reside en la otra tabla
- más de cinco claves en `on`, o la misma columna dos veces
- exactamente las columnas de la clave primaria —`<table>_pkey` ya las indexa
- una columna presente tanto en `on` como en `include`
- `unique` en una sola columna cuya propiedad ya declara `validation.unique`
- `direction` o `nulls` bajo `gin` o `brin`
- una lista `in` que repite un valor
- dos declaraciones que derivan en el mismo nombre —son el mismo índice, por duplicado
- un `reason` vacío o ausente

## Relacionado

- [Búsqueda](/docs/backend/search) — búsqueda de texto completo con clasificación (*ranked full-text*), que construye su propio índice GIN sobre un `tsvector` generado
- [Búsqueda vectorial](/docs/sdk/aggregates-and-search#vector-search) — el índice ANN sobre una columna de embeddings, configurado en la propiedad
- [Schema as code](/docs/architecture/schema-as-code) — cómo llegan las declaraciones a la base de datos y qué es un nombre derivado
