---
sourceHash: 72daf47d8a15bafe
title: Búsqueda
sidebar_label: Búsqueda
description: Cómo se comporta .search() por defecto y cómo una tabla se habilita para la búsqueda de texto completo con clasificación sobre las columnas especificadas — incluyendo contenido JSONB y arrays.
---

`.search("term")` funciona en cada tabla sin configuración. A qué se
compila depende de si la tabla ha solicitado algo más.

## El comportamiento predeterminado

Sin configuración, `.search()` es una **coincidencia de subcadena insensible a mayúsculas y minúsculas**,
combinada con `OR` a través de las columnas de texto de la tabla. La cadena de búsqueda
se divide por espacios en blanco y cada término debe coincidir — pero pueden coincidir
en columnas diferentes, por lo que un nombre almacenado en dos columnas aún se encuentra:

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Envuelve una secuencia entre comillas dobles — `.search('"ada lovelace"')` — para buscar la
frase exacta en su lugar, del mismo modo en que la ruta de texto completo que se describe a continuación las interpreta.

Esto es suficiente para una tabla pequeña con su texto en columnas simples. Tiene
tres límites que ninguna configuración interna puede solucionar:

- **No puede ver dentro de columnas JSON o arrays.** Una tabla que mantiene
  su contenido buscable en JSONB — etiquetas, certificaciones, un cuestionario — tiene
  un cuadro de búsqueda que silenciosamente no coincide con nada.
- **No tiene relevancia.** Las filas se devuelven en el orden de `orderBy`, por lo que la mejor coincidencia
  puede estar en la página siete.
- **No puede utilizar un índice.** Un `%` al inicio anula un árbol B (B-tree), por lo que cada búsqueda es
  un escaneo secuencial. Está bien para mil filas; un abismo para un millón.
  `rebase doctor` nombra las tablas donde esto ha comenzado a importar: sin
  bloque `search` y más de unas 10.000 filas.

El término coincide **literalmente**: `%` y `_` son metacaracteres de LIKE y
se escapan antes de construir el patrón, por lo que buscar `50%` busca
`50%` en lugar de devolver todas las filas. Si deseas comodines, el operador de filtro
`like` acepta un patrón (`.where("title", "like", "post-%")`); `.search()` no
lo hace.

Una búsqueda de una sola palabra se compila exactamente al SQL que siempre tuvo.

## Habilitación

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Declara `search` en una tabla, nombrando las columnas que deseas indexar:

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const talents = defineTable("talents", {
    columns: {
        id:            col.uuid().primaryKey().defaultRandom(),
        fullName:      col.text().notNull(),
        bio:           col.text(),
        interests:     col.text().array(),
        questionnaire: col.jsonb(json.object({ certifications: json.array(json.string()) }, { additional: true })),
    },
    search: {
        language: "spanish",
        unaccent: true,
        fields: [
            { path: "fullName", weight: "A" },
            { path: "bio", weight: "D" },
            "interests",
            "questionnaire.certifications",
        ],
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

Nada se infiere. Un campo se busca si y solo si lo especificas, y una ruta
que no se resuelve es rechazada cuando se compila el esquema en lugar de ser
omitida silenciosamente — un campo de búsqueda que crees que está activo y no lo está es exactamente el
fallo que este bloque busca prevenir. Lo mismo ocurre con una columna que `.private()` o
`.access({ read })` restringe: el índice se comparte entre todos los llamadores.

`.search()` se compila entonces a una coincidencia de texto completo clasificada, y las filas se devuelven con un
`_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Qué crea al declararlo

Una columna `tsvector`, `GENERATED ALWAYS AS … STORED`, y un índice GIN sobre ella.
Postgres recalcula la columna en cada escritura de un campo de origen y rechaza cualquier
intento de escribir en ella directamente, por lo que el índice no puede desincronizarse de la fila. La columna
nunca es devuelta por la API.

Se generan en `.rebase/sql/search.sql`, junto a `schema.sql` y
`policies.sql`, y `rebase db push` los aplica por ti — nada adicional que
ejecutar. Tienen su propio archivo porque una columna `tsvector` generada necesita que
exista primero una función auxiliar `IMMUTABLE` (`unaccent` es solo `STABLE`, y
aplanar un documento `jsonb` necesita una función que retorne conjuntos), y Atlas — el
motor detrás de `db push` — no puede gestionar funciones en su plan gratuito.

Una consecuencia que vale la pena conocer si despliegas mediante migraciones en lugar de push:
añadir un bloque `search` por sí solo no produce ninguna migración, porque el esquema que
Atlas compara no ha cambiado. `rebase db generate` lo indica cuando esto ocurre.
El bloque todavía se aplica mediante `rebase db push` y por la verificación del esquema en
el momento del arranque; para incluirlo explícitamente en una migración, añade `.rebase/sql/search.sql`,
que `rebase db generate` acaba de escribir, al final de una de ellas.

### Modificar el bloque más adelante

Una columna generada lleva su expresión consigo, y Postgres no puede alterar esa
expresión in situ — por lo que añadir un campo, cambiar un peso, modificar el idioma
o activar `unaccent` **no** es algo que `ADD COLUMN IF NOT EXISTS` pueda
aplicar a una columna que ya existe.

Rebase registra una huella digital (fingerprint) de la expresión en la columna al crearla,
y la compara en cada arranque y en cada `db push`. Un cambio es rechazado, explícitamente,
mostrando las dos sentencias que lo aplican — un `DROP COLUMN` y un `ADD COLUMN`,
las cuales reescriben la tabla y reconstruyen el índice GIN. Ejecútalas en el momento que
elijas; nada reescribirá una tabla en producción por ti.

Dos cambios están exentos. Activar `fuzzy` es aditivo —una segunda columna— y
se aplica sin nada de esto. Configurar [`mode`](#mode) cambia la consulta en
lugar de la columna, por lo que se aplica con un simple despliegue.

El arranque rechaza iniciar en lugar de servir tráfico, porque la alternativa es lo que esta comprobación
reemplazó: una columna que sigue indexando el conjunto de campos anterior, y una búsqueda que
no devuelve nada para contenido que claramente está en la fila.

## Qué puedes especificar en `fields`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una ruta comienza con la clave de una columna.

| Ruta | Se resuelve a | Ejemplo |
|------|---------------|---------|
| Una columna de texto | la columna | `"fullName"` |
| Una columna `col.text().array()` | cada elemento | `"interests"` |
| Una columna `col.jsonb()` | cada valor de cadena en el documento | `"questionnaire"` |
| Una ruta dentro de una columna `col.jsonb()` | cada valor de cadena en o por debajo de ese punto | `"questionnaire.certifications"` |

Una ruta hacia un mapa indexa **valores de cadena a cualquier profundidad**
debajo de ella — arrays de cadenas, objetos anidados, arrays de objetos. Las *claves* JSON
nunca se indexan, solo los valores, para que el nombre de un campo común a todas las filas no se convierta en un término que coincida con cada fila.

Especificar un enum, un UUID, una columna `json` (en lugar de `jsonb`), o un array de
números será rechazado, indicando el motivo. Los enums en particular son un vocabulario
fijo: filtra sobre ellos con `where`, que es exacto y utiliza un índice.

## Opciones

### `language`

La configuración de búsqueda de texto de Postgres, que determina la derivación léxica (stemming) y las palabras vacías (stopwords).
`"spanish"` deriva `auditores` a `auditor` y descarta `de`; el valor predeterminado,
`"simple"`, no hace ninguna de las dos cosas.

`"simple"` es el valor predeterminado porque es la única opción que nunca se equivoca — un
lematizador aplicado al idioma incorrecto corrompe silenciosamente los lexemas. Establécelo en el
idioma de tu contenido para obtener derivación léxica.

### `mode`

Cómo se compara una cadena de búsqueda con los campos que especificaste.

| `mode` | Coincidencias | Encuentra `Muñoz` a partir de `munoz` | Encuentra `sebastian` a partir de `seb` |
|---|---|---|---|
| `"fts"` (predeterminado) | lexemas completos, mediante el `tsvector` y su índice GIN | con `unaccent` | no |
| `"hybrid"` | lo anterior, `OR` una coincidencia de subcadena sobre los mismos campos | **siempre** | **sí** |

```typescript
search: {
    language: "spanish",
    mode: "hybrid",
    fields: ["fullName", "questionnaire.certifications"]
}
```

El valor predeterminado y el comportamiento predeterminado sin bloque tienen carencias opuestas, que es lo que este
modo resuelve. Medido contra un Postgres real en cinco filas
(`search-mode-matrix.test.ts` en `@rebasepro/server-postgres`):

| consulta | sin bloque (ILIKE) | `"fts"` + `unaccent` | `"hybrid"` |
|---|---|---|---|
| `munoz` | `Ana Munoz` | `Ana Munoz`, `Sebastian Muñoz` | `Ana Munoz`, `Sebastian Muñoz` |
| `seb` | ambos Sebastians | — | ambos Sebastians |
| `audit` | la fila `Lead Auditor` | — | la fila `Lead Auditor` |
| `iso 14001` | la fila `ISO 14001` | la fila `ISO 14001` | la fila `ISO 14001` |

`fuzzy` alcanza las mismas filas, pero solo una vez que se ajusta su umbral de similitud: con
el valor predeterminado de 0.3, `iso 14001` también devuelve una fila con `ISO 9001`. `"hybrid"` no tiene
un umbral que ajustar — una subcadena o bien aparece o bien no.

**Lo que cuesta.** La parte de subcadena no puede utilizar el índice GIN; un `%`
inicial nunca puede. La parte `@@` sigue ejecutándose primero y continúa usando el índice, por lo que lo que
este modo añade es un escaneo sobre las filas que el índice descartó. En una tabla grande, esa es
la diferencia entre un escaneo por índice y uno secuencial, razón por la cual esto es
un modo y no el comportamiento predeterminado.

**Cambiarlo en una tabla en producción es seguro** — la única opción en este bloque
que lo es. `mode` opera del lado de la consulta: no modifica ninguna columna generada, ninguna
expresión de generación ni ningún índice, por lo que no activa el rechazo descrito en
[Modificar el bloque más adelante](#modificar-el-bloque-más-adelante). Activarlo solo requiere un
despliegue y nada más.

Elimina los acentos en la parte de subcadena **esté o no configurado `unaccent`**,
porque esa normalización también se realiza del lado de la consulta. Esto es deliberado: `unaccent` es la
configuración que no puedes activar más tarde sin reescribir la tabla, por lo que una tabla
que no lo tenga aún puede evitar perderse `Muñoz`. La ventaja que aún ofrece `unaccent` es
la normalización de acentos en la parte `@@`, donde se almacenan los lexemas.

Añade la extensión `unaccent` y una función auxiliar `IMMUTABLE` a la
base de datos si no existen previamente. Ambas sentencias son
`IF NOT EXISTS` / `CREATE OR REPLACE`, y ninguna modifica ninguna tabla.

### `unaccent`

Normaliza los acentos antes de indexar, de modo que `auditoria` coincida con `auditoría`.

Esto no es algo meramente cosmético en un idioma con acentos. Postgres deriva las dos grafías
a **lexemas diferentes** — `to_tsvector('spanish', 'auditoría')` produce
`auditor` mientras que `'auditoria'` produce `auditori` — por lo que sin esto, una consulta escrita
sin acentos no encontrará ninguna fila que los contenga, que es como la mayoría de los
usuarios escribe la mayoría de las consultas.

Requiere la extensión `unaccent`.

### `fuzzy`

Coincide también por similitud de trigramas, de modo que las coincidencias aproximadas sigan clasificándose: `iso14000` alcanzará
`ISO 14001`, algo que ninguna derivación léxica logrará porque son simplemente
lexemas diferentes.

```typescript
search: {
    fields: ["fullName", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Añade una segunda columna generada y un índice de trigramas, y requiere `pg_trgm`.
Consume tiempo de escritura y disco; a cambio, resuelve el tipo más común de búsqueda fallida.

### `weight`

Cada campo lleva una de las cuatro clases de peso de Postgres, desde `A` (más fuerte)
hasta `D`. `ts_rank` puntúa una coincidencia `A` muy por encima de una `D`, que es cómo un
nombre supera en clasificación a una mención de pasada en una descripción larga. Los campos tienen `B` por defecto.

### `column`

La columna generada se llama `search_vector`. Cámbiala solo si colisiona
con una columna que ya tengas — forma parte de tu esquema una vez creada, y
renombrarla más tarde requiere eliminarla y volver a crearla, lo que reescribe la tabla.

## Ranking

`_score` es el `ts_rank` calculado contra la misma consulta con la que coincidieron las filas, y solo está
presente cuando la tabla habilitó la búsqueda *y* la solicitud incluyó una cadena de
búsqueda.

Con `mode: "hybrid"`, una fila encontrada únicamente por la parte de subcadena obtiene una pequeña
constante (0.001) en lugar de cero — por debajo del menor `ts_rank` que puede producir una coincidencia de lexema
real, de modo que una coincidencia de palabra completa siempre supere a una de subcadena, y las
filas que solo coincidieron por subcadena recurran al propio criterio de desempate de la consulta en lugar de devolverse
en cualquier orden arbitrario.

Con `fuzzy` activado, la similitud de trigramas se **suma** a esa puntuación. Esto no es un
simple ajuste — es lo que hace que `fuzzy` tenga un orden de relevancia. Una errata no coincide con nada en
la ruta exacta, por lo que cada fila que encuentra tiene un `ts_rank` de exactamente cero; ordenar
solo por rango devolvería la mejor coincidencia en cualquier orden arbitrario.
Los dos términos se suman en lugar de ponderarse, de modo que una fila que coincidió exactamente
aporta ambos y supera a una fila meramente similar sin necesidad de un coeficiente
que lo indique. Fuera de esas dos condiciones, `orderBy: "_score"` es un campo desconocido y
devuelve 400 en lugar de retornar silenciosamente filas sin ordenar.

`_score` no se puede combinar con la paginación por cursor (`startAfter`). La relevancia se
calcula por consulta en lugar de almacenarse, por lo que no hay ningún valor en la fila del cursor contra el cual
comparar la página siguiente, y dos solicitudes con cadenas de búsqueda distintas
producen puntuaciones que no están en la misma escala. Utiliza `limit`/`offset` para
páginas ordenadas por relevancia.

## ¿Por qué coincidió esta fila?

Una lista clasificada te dice *cuáles* filas, pero nunca *por qué* una de ellas está allí. Pídele a cada fila que
se explique:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` es la ruta exactamente como se declaró en `fields`, para que puedas asignarla a una
etiqueta para su visualización. Los campos se devuelven en el orden en que los declaraste.

Es por consulta, no por tabla, porque el coste es por consulta: un `ts_headline`
por campo declarado por cada fila devuelta, y `ts_headline` vuelve a analizar el documento
en lugar de leer el índice. Adecuado para una página de resultados, inadecuado para una exportación.

**El fragmento (snippet) contiene marcado por diseño** — cada coincidencia se envuelve en
`<mark>`. Renderízalo como HTML o elimina las etiquetas, pero no lo trates como texto
plano, y no confíes en el texto circundante: es cualquier cosa que el usuario haya escrito.
Dividir por `<mark>` y renderizar las partes es más seguro que
`dangerouslySetInnerHTML`.

Bajo `mode: "hybrid"`, un campo que coincidió únicamente por subcadena también se reporta — es
el campo que causó la coincidencia. Su fragmento se devuelve sin nada resaltado:
`ts_headline` resalta lexemas, y media palabra no lo es.

Con `unaccent` activado, los fragmentos se leen con los acentos normalizados — `Auditoria`, no
`Auditoría`. `ts_headline` sobre el texto original no puede encontrar una coincidencia que haya producido una
consulta sin acentos, por lo que devolvería el texto sin nada resaltado en
absoluto; un fragmento legible que resalta las coincidencias es mejor que uno más estético que silenciosamente
no lo hace.

## Añadir el bloque a una tabla en producción

La columna generada se añade mediante la verificación del esquema en el momento de arranque, como
cualquier otra columna. Su índice se construye una vez que el servidor está prestando servicio, en segundo plano, con
`CREATE INDEX CONCURRENTLY` para que no se bloqueen las escrituras (consulta
[Indexes](/docs/backend/indexes#when-they-are-created)). Hasta que el índice se
construya, la búsqueda funciona pero lee la tabla completa. Añadir una columna generada de tipo *stored*
reescribe la tabla, por lo que en una tabla grande, planifícalo como cualquier otra
reescritura.

## Relacionado

- [REST API](/docs/backend/api/) — los parámetros de consulta con los que una búsqueda llega al servidor
- [Indexes](/docs/backend/indexes/) — qué crea el bloque de búsqueda y cuánto cuesta
- [Querying Data](/docs/sdk/querying/) — realizar búsquedas desde el SDK con tipado estático
