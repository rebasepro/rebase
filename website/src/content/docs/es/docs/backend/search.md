---
sourceHash: 04421ade309db1ce
title: Búsqueda
sidebar_label: Búsqueda
description: Cómo se comporta .search() por defecto y cómo habilitar en una colección de Postgres la búsqueda de texto completo clasificada sobre los campos que elijas, incluyendo contenido JSONB y de arrays.
---

`.search("term")` funciona en todas las colecciones sin necesidad de configuración. En qué
se compila depende de si la colección ha solicitado algo más.

## Por defecto

Sin configuración, `.search()` es una **coincidencia de subcadena que no distingue entre mayúsculas y minúsculas**,
combinada con OR a través de las propiedades `string` de nivel superior de la colección:

```sql
WHERE name ILIKE '%term%' OR description ILIKE '%term%'
```

Esto es suficiente para una colección pequeña con su texto en columnas simples. Tiene
tres limitaciones que ninguna configuración interna puede solucionar:

- **No puede ver dentro de propiedades `map` o `array`.** Una colección que guarda
  su contenido buscable en JSONB —etiquetas, certificaciones, un cuestionario— tiene
  un cuadro de búsqueda que silenciosamente no coincide con nada.
- **No tiene relevancia.** Las filas se devuelven en el orden de `orderBy`, por lo que la mejor coincidencia
  puede estar en la página siete.
- **No puede usar un índice.** Un `%` inicial anula un índice B-tree, por lo que cada búsqueda es
  un escaneo secuencial. Funciona bien con mil filas; es un abismo con un millón.

El término se busca de forma **literal**: `%` y `_` son metacaracteres de LIKE, y se
escapan antes de construir el patrón, por lo que buscar `50%` busca
`50%` en lugar de devolver todas las filas. Si deseas comodines, el operador
de filtro `like` acepta un patrón (`.where("title", "like", "post-%")`); `.search()` no
lo hace.

El comportamiento por defecto no cambia, y una colección que no haya habilitado esta opción se compila
exactamente al mismo SQL de siempre.

## Habilitación

Declara un bloque `search` en una colección de Postgres, indicando los campos que deseas
indexar:

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

No se infiere nada. Un campo se busca si y solo si lo especificas, y una ruta
que no se resuelve falla al arrancar en lugar de omitirse silenciosamente: un campo
de búsqueda que crees activo y no lo está es exactamente el fallo que este bloque
busca prevenir.

Luego, `.search()` se compila a una coincidencia de texto completo clasificada, y las filas se devuelven con un
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
intento de escribir en ella directamente, por lo que el índice no puede desfasarse de la fila. La columna
nunca es devuelta por la API.

Se generan en `drizzle/search.sql`, junto a `schema.sql` y
`policies.sql`, y `rebase db push` los aplica por ti —sin necesidad de ejecutar
nada adicional. Tienen su propio archivo porque una columna `tsvector` generada necesita que
exista primero una función auxiliar `IMMUTABLE` (`unaccent` es solo `STABLE`, y
aplanar un documento `jsonb` necesita una función que devuelva un conjunto de filas), y Atlas —el
motor detrás de `db push`— no puede gestionar funciones en su plan gratuito.

Una consecuencia que vale la pena conocer si despliegas mediante migraciones en lugar de push:
añadir un bloque `search` por sí solo no genera ninguna migración, porque el esquema
que Atlas compara no ha cambiado. `rebase db generate` lo notifica cuando ocurre.
El bloque se sigue aplicando mediante `rebase db push` y mediante la verificación
del esquema en el arranque; para incluirlo explícitamente en una migración, añade el contenido de `drizzle/search.sql` a una.

### Modificar el bloque más adelante

Una columna generada lleva consigo su expresión, y Postgres no puede alterar esa
expresión in situ; por lo tanto, añadir un campo, mover un peso, cambiar el idioma
o activar `unaccent` **no** es algo que `ADD COLUMN IF NOT EXISTS` pueda
aplicar a una columna que ya existe.

Rebase registra una huella digital (fingerprint) de la expresión en la columna al crearla,
y la compara en cada arranque y en cada `db push`. Cualquier cambio se rechaza, de forma explícita,
mostrando las dos sentencias necesarias para aplicarlo: un `DROP COLUMN` y un `ADD COLUMN`,
los cuales reescriben la tabla y reconstruyen el índice GIN. Ejecútalos en el momento que
elijas; nada reescribe una tabla en producción por ti. (Activar `fuzzy` es
aditivo —una segunda columna— y se aplica sin nada de esto).

El arranque rechaza la ejecución en lugar de servir tráfico, porque la alternativa es lo que
esta comprobación vino a reemplazar: una columna que sigue indexando el conjunto de campos anterior, y una búsqueda
que no devuelve nada para contenido claramente presente en la fila.

## Qué puedes especificar en `fields`

| Ruta | Resuelve a | Ejemplo |
|------|------------|---------|
| Una propiedad `string` | la columna | `"full_name"` |
| Una propiedad `string[]` | cada elemento | `"interests"` |
| Una propiedad `map` | cada valor de cadena en el documento | `"questionnaire"` |
| Una ruta dentro de un `map` | cada valor de cadena en o por debajo de ese punto | `"questionnaire.certifications"` |

Una ruta dentro de un mapa indexa **valores de cadena a cualquier profundidad**
por debajo de ella: arrays de cadenas, objetos anidados, arrays de objetos. Las *claves* JSON
nunca se indexan, solo los valores, para que el nombre de un campo común a todas las filas no se convierta en un término que coincida
con todas las filas.

Especificar un enum, un UUID, una columna `json` (en lugar de `jsonb`) o un array de
números produce un error en el arranque que explica el motivo. Los enums en particular son un
vocabulario fijo: fíltralos con `where`, que es exacto y utiliza un índice.

## Opciones

### `language`

La configuración de búsqueda de texto de Postgres, que determina la lematización (stemming) y las palabras vacías (stopwords).
`"spanish"` reduce `auditores` a `auditor` y elimina `de`; el valor por defecto,
`"simple"`, no hace ninguna de las dos cosas.

`"simple"` es la opción predeterminada porque es la única opción que nunca se equivoca: un
lematizador aplicado al idioma incorrecto altera silenciosamente los lexemas. Configúralo con el
idioma de tu contenido para obtener lematización.

### `unaccent`

Elimina los acentos antes de indexar, de modo que `auditoria` coincida con `auditoría`.

Esto no es un detalle cosmético en un idioma con acentos. Postgres reduce las dos grafías
a **lexemas diferentes** —`to_tsvector('spanish', 'auditoría')` genera
`auditor` mientras que `'auditoria'` genera `auditori`—, por lo que sin esto, una consulta escrita
sin acentos no coincidirá con ninguna fila que los contenga, que es como la mayoría de los usuarios
escribe la mayoría de las consultas.

Requiere la extensión `unaccent`.

### `fuzzy`

Coincide también por similitud de trigramas, para que las coincidencias cercanas sigan clasificándose: `iso14000` alcanzando
a `ISO 14001`, algo que ninguna lematización logrará porque son simplemente
lexemas distintos.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Añade una segunda columna generada y un índice de trigramas, y requiere `pg_trgm`.
Tiene un coste en tiempo de escritura y disco; resuelve el tipo más común de búsqueda fallida.

### `weight`

Cada campo lleva una de las cuatro clases de peso de Postgres, desde `A` (la más alta)
hasta `D`. `ts_rank` puntúa una coincidencia en `A` muy por encima de una en `D`, que es la forma en que un
nombre supera a una mención pasajera en una descripción larga. Los campos tienen `B` por defecto.

### `column`

La columna generada se llama `search_vector`. Cámbiala solo si entra en conflicto
con una columna que ya tengas: forma parte de tu esquema una vez creada, y
renombrarla más adelante requiere eliminarla y recrearla, lo que reescribe la tabla.

## Clasificación (Ranking)

`_score` es el resultado de `ts_rank` frente a la misma consulta con la que se emparejaron las filas, y está
presente solo cuando la colección activó la opción *y* la petición incluía una
cadena de búsqueda.

Con `fuzzy` activado, la similitud de trigramas se **suma** a esa puntuación. Esto no es un
refinamiento: es lo que hace que `fuzzy` tenga una clasificación en absoluto. Un error tipográfico no coincide con nada en
la ruta exacta, por lo que cada fila que encuentra tiene un `ts_rank` exactamente de cero; ordenar
solo por rango devolvería la mejor coincidencia en cualquier orden aleatorio de la tabla.
Los dos términos se suman en lugar de ponderarse, por lo que una fila que coincidió exactamente
aporta ambos y supera a una fila meramente similar sin necesidad de un coeficiente
adicional. Fuera de esas dos condiciones, `orderBy: "_score"` es un campo desconocido y
devuelve 400 en lugar de retornar silenciosamente filas sin ordenar.

`_score` no se puede combinar con la paginación por cursor (`startAfter`). La relevancia se
calcula por consulta en lugar de almacenarse, por lo que no hay un valor en la fila del cursor contra
el cual comparar la siguiente página, y dos peticiones con cadenas de búsqueda distintas
producen puntuaciones que no están en la misma escala. Usa `limit`/`offset` para
páginas ordenadas por relevancia.

## ¿Por qué coincidió esta fila?

Una lista clasificada te dice *cuáles* filas, nunca *por qué* una de ellas está allí. Pide a cada fila que
se explique a sí misma:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` es la ruta exactamente como se declaró en `fields`, para que puedas asignarla a
una etiqueta para su visualización. Los campos se devuelven en el orden en que los declaraste.

Es por consulta, no por colección, porque el coste es por consulta: un `ts_headline`
por campo declarado por cada fila devuelta, y `ts_headline` vuelve a analizar el documento
en lugar de leer el índice. Es adecuado para una página de resultados, pero no para una exportación.

**El fragmento (snippet) contiene marcado por diseño**: cada coincidencia está envuelta en
`<mark>`. Renderízalo como HTML o elimina las etiquetas, pero no lo trates como texto
plano y no confíes en el texto circundante: contiene lo que haya escrito el usuario.
Dividir el texto por `<mark>` y renderizar las partes es más seguro que
usar `dangerouslySetInnerHTML`.

Con `unaccent` activado, los fragmentos se leen con los acentos normalizados: `Auditoria`, no
`Auditoría`. `ts_headline` sobre el texto original no puede encontrar una coincidencia producida por
una consulta sin acentos, por lo que devolvería el texto sin nada resaltado;
un fragmento legible que resalta los términos es preferible a uno más estético que silenciosamente
no resalta nada.

## Añadir el bloque a una colección activa

La columna generada se añade mediante la verificación del esquema en el arranque, como cualquier otra
columna, y su índice se construye con `CREATE INDEX CONCURRENTLY` para que las escrituras
no se bloqueen. Añadir una columna generada *almacenada* (`STORED`) sí reescribe la tabla, por lo que en una
tabla grande, planifícalo como cualquier otra reescritura.

## Qué motores

El bloque `search` es exclusivo de Postgres, y se rechaza al arrancar en otros motores
en lugar de ignorarse silenciosamente. Las colecciones de MongoDB conservan su coincidencia
basada en expresiones regulares; las colecciones de Firestore utilizan el controlador externo de búsqueda de texto.

## Relacionado

- [REST API](/docs/backend/api/) — los parámetros de consulta con los que una búsqueda llega al servidor
- [Índices](/docs/backend/indexes/) — qué crea el bloque de búsqueda y cuál es su coste
- [Consultar datos](/docs/sdk/querying/) — cómo buscar desde el SDK cliente
