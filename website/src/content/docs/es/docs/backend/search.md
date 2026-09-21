---
sourceHash: a6c102be4bcc017e
title: Búsqueda
sidebar_label: Búsqueda
description: Cómo se comporta .search() por defecto y cómo habilitar la búsqueda de texto completo con clasificación en una colección de Postgres sobre los campos que especifiques, incluyendo contenido JSONB y arrays.
---

`.search("term")` funciona en todas las colecciones sin necesidad de configuración. A qué se compila depende de si la colección ha solicitado algo más.

## El comportamiento por defecto

Sin configuración, `.search()` es una **coincidencia de subcadena insensible a mayúsculas y minúsculas** (case-insensitive), combinada con OR entre las propiedades `string` de nivel superior de la colección. La cadena de búsqueda se divide por espacios en blanco y cada término debe coincidir, pero pueden coincidir en diferentes propiedades, por lo que un nombre almacenado en dos columnas se sigue encontrando:

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Envuelve una secuencia entre comillas dobles — `.search('"ada lovelace"')` — para buscar la frase exacta en su lugar, de la misma manera que las interpreta la ruta de texto completo más abajo.

Esto es suficiente para una colección pequeña con su texto en columnas simples. Tiene tres limitaciones que ninguna configuración interna puede solucionar:

- **No puede ver dentro de propiedades `map` o `array`.** Una colección que guarda su contenido buscable en JSONB —etiquetas, certificaciones, un cuestionario— tendrá un cuadro de búsqueda que silenciosamente no coincidirá con nada.
- **No tiene relevancia.** Las filas se devuelven en el orden de `orderBy`, por lo que la mejor coincidencia puede estar en la página siete.
- **No puede usar un índice.** Un `%` inicial anula un árbol B (B-tree), por lo que cada búsqueda es un escaneo secuencial. Funciona bien con mil filas; es un precipicio con un millón.

El término se busca **literalmente**: `%` y `_` son metacaracteres de LIKE y se escapan antes de construir el patrón, por lo que buscar `50%` busca `50%` en lugar de devolver todas las filas. Si deseas comodines, el operador de filtro `like` acepta un patrón (`.where("title", "like", "post-%")`); `.search()` no lo hace.

Una búsqueda de una sola palabra compila exactamente al mismo SQL de siempre.

## Activar la funcionalidad

Declara un bloque `search` en una colección de Postgres, indicando los campos que deseas indexar:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const talents: PostgresCollectionConfig = {
    slug: "talents",
    table: "talents",
    name: "Candidates",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        full_name: { name: "Full name", type: "string" },
        bio: { name: "Bio", type: "string" },
        interests: { name: "Interests", type: "array", of: { name: "Interest", type: "string" } },
        questionnaire: { name: "Questionnaire", type: "map", properties: {} }
    },
    search: {
        language: "spanish",
        unaccent: true,
        fields: [
            { path: "full_name", weight: "A" },
            { path: "bio", weight: "D" },
            "interests",
            "questionnaire.certifications"
        ]
    }
};
```

No se infiere nada. Un campo se busca si y solo si lo especificas, y una ruta que no se resuelva fallará al iniciar en lugar de omitirse silenciosamente; un campo de búsqueda que crees que está activo y no lo está es exactamente el fallo que este bloque busca prevenir.

Entonces `.search()` compila a una coincidencia de texto completo clasificada por relevancia, y las filas se devuelven con un `_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Qué se crea al declararlo

Una columna `tsvector`, `GENERATED ALWAYS AS … STORED`, y un índice GIN sobre ella. Postgres recalcula la columna en cada escritura de un campo de origen y rechaza cualquier intento de escribirla directamente, por lo que el índice no puede desincronizarse de la fila. La columna nunca es devuelta por la API.

Se generan en `drizzle/search.sql`, junto a `schema.sql` y `policies.sql`, y `rebase db push` los aplica automáticamente; no hay nada adicional que ejecutar. Tienen su propio archivo porque una columna `tsvector` generada necesita que exista primero una función auxiliar `IMMUTABLE` (`unaccent` es solo `STABLE`, y aplanar un documento `jsonb` requiere una función que retorne conjuntos), y Atlas —el motor detrás de `db push`— no puede gestionar funciones en su nivel gratuito.

Una consecuencia que vale la pena conocer si despliegas mediante migraciones en lugar de push: añadir un bloque `search` por sí solo no genera ninguna migración, porque el esquema que Atlas compara no ha cambiado. `rebase db generate` lo advierte cuando esto ocurre. El bloque todavía se aplica mediante `rebase db push` y mediante la comprobación del esquema al iniciar; para incluirlo en una migración explícitamente, anexa `drizzle/search.sql` a una de ellas.

### Modificar el bloque más adelante

Una columna generada lleva consigo su expresión, y Postgres no puede alterar esa expresión in situ; por lo tanto, añadir un campo, cambiar un peso, cambiar el idioma o activar `unaccent` **no** es algo que `ADD COLUMN IF NOT EXISTS` pueda aplicar a una columna que ya existe.

Rebase registra una huella digital (fingerprint) de la expresión en la columna al crearla, y la compara en cada arranque y en cada `db push`. Cualquier cambio es rechazado explícitamente, indicando las dos sentencias necesarias para aplicarlo: un `DROP COLUMN` y un `ADD COLUMN`, las cuales reescriben la tabla y reconstruyen el índice GIN. Ejecútalas en el momento que elijas; nada reescribe una tabla en producción por ti. (Activar `fuzzy` es aditivo —una segunda columna— y se aplica sin nada de esto).

El arranque se detiene en lugar de iniciar el servicio, porque la alternativa es lo que esta verificación vino a reemplazar: una columna que sigue indexando el conjunto de campos anterior y una búsqueda que no devuelve nada para contenido que claramente está en la fila.

## Qué puedes especificar en `fields`

| Ruta | Se resuelve como | Ejemplo |
|------|------------------|---------|
| Una propiedad `string` | la columna | `"full_name"` |
| Una propiedad `string[]` | cada elemento | `"interests"` |
| Una propiedad `map` | cada valor de tipo string en el documento | `"questionnaire"` |
| Una ruta dentro de un `map` | cada valor de tipo string en o por debajo de ese punto | `"questionnaire.certifications"` |

Una ruta hacia un map indexa **valores de tipo string a cualquier profundidad** debajo de ella: arrays de cadenas, objetos anidados, arrays de objetos. Las *claves* JSON nunca se indexan, solo los valores, por lo que el nombre de un campo común a todas las filas no se convierte en un término que coincida con todas las filas.

Especificar un enum, un UUID, una columna `json` (en lugar de `jsonb`) o un array de números genera un error en el arranque que explica el motivo. Los enums, en particular, son un vocabulario fijo: fíltralos con `where`, que es exacto y utiliza un índice.

## Opciones

### `language`

La configuración de búsqueda de texto de Postgres, que determina la lematización (stemming) y las palabras vacías (stopwords). `"spanish"` reduce `auditores` a `auditor` y elimina `de`; el valor predeterminado, `"simple"`, no hace ninguna de las dos cosas.

`"simple"` es el valor predeterminado porque es la única opción que nunca se equivoca: un lematizador aplicado al idioma incorrecto altera silenciosamente los lexemas. Establécelo en el idioma de tu contenido para habilitar la lematización.

### `unaccent`

Elimina los acentos antes de indexar, de modo que `auditoria` coincida con `auditoría`.

Esto no es cosmético en un idioma con acentos. Postgres reduce las dos variantes ortográficas a **lexemas diferentes** — `to_tsvector('spanish', 'auditoría')` produce `auditor` mientras que `'auditoria'` produce `auditori` —, por lo que sin esto, una consulta escrita sin acentos perderá todas las filas que los contengan, que es la forma en que la mayoría de los usuarios escriben la mayoría de las consultas.

Requiere la extensión `unaccent`.

### `fuzzy`

También busca coincidencias por similitud de trigramas, para que los errores tipográficos o coincidencias aproximadas sigan clasificándose: `iso14000` alcanzando a `ISO 14001`, algo que ninguna lematización lograría porque son simplemente lexemas diferentes.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Añade una segunda columna generada y un índice de trigramas, y requiere `pg_trgm`. Cuesta tiempo de escritura y espacio en disco; soluciona el tipo más común de búsqueda fallida.

### `weight`

Cada campo tiene una de las cuatro clases de peso de Postgres, desde `A` (la más fuerte) hasta `D`. `ts_rank` puntúa una coincidencia en `A` muy por encima de una en `D`, que es la forma en que un nombre supera a una mención secundaria en una descripción extensa. Los campos tienen el valor predeterminado `B`.

### `column`

La columna generada se llama `search_vector`. Cámbiala solo si colisiona con una columna que ya tengas; forma parte de tu esquema una vez creada, y renombrarla más tarde requiere eliminarla y recrearla, lo cual reescribe la tabla.

## Ranking

`_score` es `ts_rank` contra la misma consulta con la que coincidieron las filas, y está presente solo cuando la colección habilitó la búsqueda *y* la solicitud incluyó una cadena de búsqueda.

Con `fuzzy` activado, la similitud de trigramas se **suma** a esa clasificación. Esto no es un simple ajuste: es lo que hace que `fuzzy` sea una clasificación en absoluto. Un error tipográfico no coincide con nada en la ruta exacta, por lo que cada fila que encuentra tiene un `ts_rank` exactamente de cero; ordenar solo por rango devolvería la mejor coincidencia en el orden aleatorio que la tabla prefiera. Los dos términos se suman en lugar de ponderarse, por lo que una fila que coincidió de forma exacta aporta ambos y supera a una fila meramente similar sin necesidad de un coeficiente que lo indique. Fuera de esas dos condiciones, `orderBy: "_score"` es un campo desconocido y devuelve 400 en lugar de devolver silenciosamente filas no ordenadas.

`_score` no se puede combinar con paginación por cursor (`startAfter`). La relevancia se calcula por consulta en lugar de almacenarse, por lo que no hay ningún valor en la fila del cursor contra el cual comparar la página siguiente, y dos solicitudes con diferentes cadenas de búsqueda producen puntuaciones que no están en la misma escala. Utiliza `limit`/`offset` para páginas ordenadas por relevancia.

## ¿Por qué coincidió esta fila?

Una lista clasificada te dice *cuáles* filas, nunca *por qué* una está allí. Pídele a cada fila que se explique:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` es la ruta exactamente como se declaró en `fields`, para que puedas asignarla a una etiqueta para mostrar en pantalla. Los campos se devuelven en el orden en que los declaraste.

Es por consulta, no por colección, porque el coste es por consulta: un `ts_headline` por campo declarado por cada fila devuelta, y `ts_headline` vuelve a analizar el documento en lugar de leer el índice. Adecuado para una página de resultados, inadecuado para una exportación.

**El fragmento (snippet) contiene marcado por construcción**: cada coincidencia está envuelta en `<mark>`. Renderízalo como HTML o elimina las etiquetas, pero no lo trates como texto sin formato, y no confíes en el texto circundante: es lo que el usuario haya escrito. Dividir por `<mark>` y renderizar las partes es más seguro que usar `dangerouslySetInnerHTML`.

Con `unaccent` activado, los fragmentos se leen con los acentos normalizados: `Auditoria`, no `Auditoría`. `ts_headline` sobre el texto original no puede encontrar una coincidencia que produjo una consulta sin acentos, por lo que devolvería el texto sin nada resaltado; un fragmento legible que resalta coincidencias es mejor que uno más bonito que silenciosamente no resalta nada.

## Añadir el bloque a una colección activa

La columna generada se añade mediante la comprobación del esquema al iniciar, como cualquier otra columna, y su índice se construye con `CREATE INDEX CONCURRENTLY` para que las escrituras no se bloqueen. Añadir una columna generada *almacenada* (stored) sí reescribe la tabla, por lo que en una tabla grande, planifícalo como cualquier otra reescritura.

## Motores compatibles

El bloque `search` es exclusivo de Postgres y se rechaza al iniciar en otros motores en lugar de ignorarse silenciosamente. Las colecciones de MongoDB conservan su coincidencia basada en expresiones regulares; las colecciones de Firestore utilizan el controlador externo de búsqueda de texto.

## Relacionado

- [REST API](/docs/backend/api/) — los parámetros de consulta con los que una búsqueda llega al servidor
- [Indexes](/docs/backend/indexes/) — qué crea el bloque de búsqueda y cuánto cuesta
- [Querying Data](/docs/sdk/querying/) — cómo buscar desde el SDK cliente
