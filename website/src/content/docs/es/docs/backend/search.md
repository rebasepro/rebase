---
sourceHash: 96b96a778ac5c3a6
title: Búsqueda
sidebar_label: Búsqueda
description: Cómo se comporta .search() por defecto y cómo habilitar en una colección de Postgres la búsqueda de texto completo con relevancia en los campos que indiques, incluyendo contenido JSONB y arrays.
---

`.search("term")` funciona en todas las colecciones sin necesidad de configuración. En qué se compila depende de si la colección ha solicitado algo más.

## El comportamiento por defecto

Sin ninguna configuración, `.search()` es una **coincidencia de subcadena que no distingue entre mayúsculas y minúsculas**, combinada con OR entre las propiedades `string` de nivel superior de la colección. La cadena de búsqueda se divide por espacios en blanco y cada término debe coincidir, pero pueden coincidir en diferentes propiedades, por lo que un nombre almacenado en dos columnas se sigue encontrando:

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Envuelve una secuencia entre comillas dobles — `.search('"ada lovelace"')` — para buscar la frase exacta en su lugar, del mismo modo en que la ruta de texto completo que se describe a continuación las interpreta.

Esto es suficiente para una colección pequeña con su texto en columnas simples. Tiene tres limitaciones que ningún ajuste dentro de ella puede resolver:

- **No puede ver dentro de propiedades `map` o `array`.** Una colección que guarda su contenido buscable en JSONB —etiquetas, certificaciones, un cuestionario— tiene un cuadro de búsqueda que silenciosamente no coincide con nada.
- **No tiene relevancia.** Las filas se devuelven en el orden de `orderBy`, por lo que la mejor coincidencia puede estar en la página siete.
- **No puede usar un índice.** Un `%` inicial anula un árbol B (B-tree), por lo que cada búsqueda es un escaneo secuencial. Funciona bien con mil filas; es un abismo con un millón.

El término se compara de forma **literal**: `%` y `_` son metacaracteres de LIKE y se escapan antes de construir el patrón, por lo que buscar `50%` busca `50%` en lugar de devolver todas las filas. Si deseas comodines, el operador de filtro `like` acepta un patrón (`.where("title", "like", "post-%")`); `.search()` no lo hace.

Una búsqueda de una sola palabra se compila exactamente en el SQL que siempre generó.

## Habilitación

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

Nada se infiere. Un campo se busca si y solo si lo nombras, y una ruta que no se resuelva fallará en el arranque en lugar de omitirse silenciosamente; tener un campo de búsqueda que crees que está activo y no lo está es exactamente el fallo que este bloque existe para prevenir.

`.search()` se compila entonces en una coincidencia de texto completo con relevancia, y las filas se devuelven con un `_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Qué crea al declararlo

Una columna `tsvector`, `GENERATED ALWAYS AS … STORED`, y un índice GIN sobre ella. Postgres recalcula la columna en cada escritura de un campo de origen y rechaza cualquier intento de escribir en ella directamente, por lo que el índice no puede desincronizarse de la fila. La columna nunca es devuelta por la API.

Se generan en `drizzle/search.sql`, junto a `schema.sql` y `policies.sql`, y `rebase db push` los aplica por ti —sin nada adicional que ejecutar. Obtienen su propio archivo porque una columna `tsvector` generada necesita que exista primero una función auxiliar `IMMUTABLE` (`unaccent` es solo `STABLE`, y aplanar un documento `jsonb` necesita una función que devuelva un conjunto de resultados), y Atlas —el motor detrás de `db push`— no puede gestionar funciones en su nivel gratuito.

Una consecuencia que vale la pena conocer si despliegas mediante migraciones en lugar de push: agregar un bloque `search` por sí solo no produce ninguna migración, porque el esquema que compara Atlas no ha cambiado. `rebase db generate` lo indica cuando ocurre. El bloque todavía se aplica mediante `rebase db push` y mediante la verificación del esquema en el momento de arranque; para incluirlo explícitamente en una migración, añade `drizzle/search.sql` a una de ellas.

### Modificar el bloque más adelante

Una columna generada lleva su expresión consigo, y Postgres no puede alterar esa expresión in situ; por lo tanto, añadir un campo, mover un peso, cambiar el idioma o activar `unaccent` **no** es algo que `ADD COLUMN IF NOT EXISTS` pueda aplicar a una columna que ya existe.

Rebase registra una huella digital (fingerprint) de la expresión en la columna al crearla, y la compara en cada arranque y en cada `db push`. Se rechaza cualquier cambio de forma explícita, mostrando las dos sentencias para aplicarlo: un `DROP COLUMN` y un `ADD COLUMN`, que reescriben la tabla y reconstruyen el índice GIN. Ejecútalas en el momento que elijas; nada reescribirá una tabla en producción por ti.

Dos cambios están exentos. Activar `fuzzy` es aditivo —una segunda columna— y se aplica sin nada de esto. Establecer [`mode`](#mode) cambia la consulta en lugar de la columna, por lo que se aplica con un despliegue.

El arranque se rechaza en lugar de iniciar el servicio, porque la alternativa es lo que esta comprobación vino a reemplazar: una columna que sigue indexando el conjunto de campos anterior y una búsqueda que no devuelve nada para contenido que está a la vista en la fila.

## Qué puedes especificar en `fields`

| Ruta | Se resuelve como | Ejemplo |
|------|-------------|---------|
| Una propiedad `string` | la columna | `"full_name"` |
| Una propiedad `string[]` | cada elemento | `"interests"` |
| Una propiedad `map` | cada valor de cadena en el documento | `"questionnaire"` |
| Una ruta dentro de un `map` | cada valor de cadena en o por debajo de ese punto | `"questionnaire.certifications"` |

Una ruta dentro de un map indexa **valores de cadena a cualquier nivel de profundidad** debajo de ella: arrays de cadenas, objetos anidados, arrays de objetos. Las *claves* JSON nunca se indexan, solo los valores, para que el nombre de un campo común a todas las filas no se convierta en un término que coincida con cada fila.

Especificar un enum, un UUID, una columna `json` (en lugar de `jsonb`) o un array de números genera un error en el arranque explicando el motivo. Los enums en particular son un vocabulario fijo: fíltralos con `where`, que es exacto y utiliza un índice.

## Opciones

### `language`

La configuración de búsqueda de texto de Postgres, que determina la lematización (stemming) y las palabras vacías (stopwords). `"spanish"` lematiza `auditores` a `auditor` y elimina `de`; el valor por defecto, `"simple"`, no hace ninguna de las dos cosas.

`"simple"` es el valor predeterminado porque es la única opción que nunca se equivoca: un lematizador aplicado al idioma incorrecto altera silenciosamente los lexemas. Establécelo en el idioma de tu contenido para obtener lematización.

### `mode`

<span class="since-badge" data-since="0.22">Desde 0.22</span> Cómo se compara una cadena de búsqueda con los campos que especificaste.

| `mode` | Coincidencias | Encuentra `Muñoz` a partir de `munoz` | Encuentra `sebastian` a partir de `seb` |
|---|---|---|---|
| `"fts"` (por defecto) | lexemas completos, mediante el `tsvector` y su índice GIN | con `unaccent` | no |
| `"hybrid"` | eso, `OR` una coincidencia de subcadena sobre los mismos campos | **siempre** | **sí** |

```typescript
search: {
    language: "spanish",
    mode: "hybrid",
    fields: ["full_name", "questionnaire.certifications"]
}
```

El comportamiento por defecto y el comportamiento sin bloque tienen carencias opuestas, que es lo que este modo soluciona. Medido en un Postgres real sobre cinco filas (`search-mode-matrix.test.ts` en `@rebasepro/server-postgres`):

| consulta | sin bloque (ILIKE) | `"fts"` + `unaccent` | `"hybrid"` |
|---|---|---|---|
| `munoz` | `Ana Munoz` | `Ana Munoz`, `Sebastian Muñoz` | `Ana Munoz`, `Sebastian Muñoz` |
| `seb` | ambos Sebastians | — | ambos Sebastians |
| `audit` | el `Lead Auditor` | — | el `Lead Auditor` |
| `iso 14001` | la fila `ISO 14001` | la fila `ISO 14001` | la fila `ISO 14001` |

`fuzzy` llega a las mismas filas, pero solo una vez ajustado su umbral de similitud: con el valor por defecto de 0.3, `iso 14001` también devuelve una fila con `ISO 9001`. `"hybrid"` no tiene un umbral que ajustar: una subcadena ocurre o no ocurre.

**Cuál es su coste.** La parte de la subcadena no puede usar el índice GIN; un `%` inicial nunca puede. La parte de `@@` aún se ejecuta primero y sigue usando el índice, por lo que lo que este modo añade es un escaneo sobre las filas que el índice descartó. En una tabla grande, esa es la diferencia entre un escaneo de índice y uno secuencial, razón por la cual esto es un modo opcional y no el comportamiento por defecto.

**Cambiarlo en una colección en producción es seguro**, la única opción en este bloque que lo es. `mode` actúa del lado de la consulta: no modifica ninguna columna generada, ninguna expresión de generación ni ningún índice, por lo que no provoca el rechazo descrito en [Modificar el bloque más adelante](#changing-the-block-later). Activarlo solo requiere un despliegue y nada más.

Normaliza los acentos en la parte de la subcadena **esté o no configurado `unaccent`**, porque esa normalización también se realiza del lado de la consulta. Esto es intencionado: `unaccent` es el ajuste que no puedes activar más tarde sin reescribir la tabla, por lo que una colección que no lo tenga configurado puede evitar perder `Muñoz`. Lo que `unaccent` sigue aportando es la normalización en la parte de `@@`, donde se almacenan los lexemas.

Añade la extensión `unaccent` y una función auxiliar `IMMUTABLE` a la base de datos si no existen ya. Ambas sentencias usan `IF NOT EXISTS` / `CREATE OR REPLACE`, y ninguna modifica una tabla.

### `unaccent`

Normaliza los acentos antes de indexar, de modo que `auditoria` coincida con `auditoría`.

Esto no es meramente cosmético en un idioma con acentos. Postgres lematiza ambas grafías en **lexemas diferentes** — `to_tsvector('spanish', 'auditoría')` genera `auditor` mientras que `'auditoria'` genera `auditori` —, por lo que sin ello, una consulta escrita sin tildes omitirá todas las filas que las lleven, que es como la mayoría de los usuarios escriben la mayoría de las consultas.

Requiere la extensión `unaccent`.

### `fuzzy`

Coincide también por similitud de trigramas, de modo que las coincidencias cercanas sigan posicionándose: `iso14000` alcanzando `ISO 14001`, algo que ninguna lematización logrará porque son simplemente lexemas distintos.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Añade una segunda columna generada y un índice de trigramas, y requiere `pg_trgm`. Cuesta tiempo de escritura y espacio en disco; resuelve el tipo más común de búsqueda fallida.

### `weight`

Cada campo tiene asignada una de las cuatro clases de peso de Postgres, desde `A` (la más fuerte) hasta `D`. `ts_rank` puntúa una coincidencia en `A` muy por encima de una en `D`, que es cómo un nombre supera a una mención secundaria en una descripción extensa. Los campos tienen `B` por defecto.

### `column`

La columna generada se llama `search_vector`. Cámbiala solo si entra en conflicto con una columna que ya tengas; una vez creada, forma parte de tu esquema, y renombrarla más tarde requiere eliminarla y recrearla, lo que reescribe la tabla.

## Clasificación por relevancia

`_score` es el `ts_rank` respecto a la misma consulta con la que se compararon las filas, y solo está presente cuando la colección ha habilitado esta función *y* la solicitud incluye una cadena de búsqueda.

<span class="since-badge" data-since="0.22">Desde 0.22</span> Con `mode: "hybrid"`, una fila encontrada únicamente por la parte de la subcadena obtiene una pequeña constante (0.001) en lugar de cero —por debajo del `ts_rank` más pequeño que una coincidencia de lexema real pueda producir—, por lo que una coincidencia de palabra completa siempre supera a una de subcadena, y las filas que solo coinciden por subcadena recurren al criterio de desempate de la propia consulta en lugar de devolverse en cualquier orden arbitrario determinado por la tabla.

Con `fuzzy` activado, la similitud de trigramas se **suma** a esa clasificación. Esto no es un simple ajuste fino; es lo que hace que `fuzzy` clasifique resultados. Un error tipográfico no coincide con nada en la ruta exacta, por lo que cada fila que encuentra tiene un `ts_rank` de exactamente cero; ordenar solo por rango devolvería la mejor coincidencia en cualquier orden arbitrario de la tabla. Los dos términos se suman en lugar de ponderarse, por lo que una fila que coincidió de forma exacta aporta ambos y supera a una fila meramente similar sin necesidad de un coeficiente que lo determine. Fuera de esas dos condiciones, `orderBy: "_score"` se considera un campo desconocido y devuelve 400 en lugar de devolver filas desordenadas silenciosamente.

`_score` no se puede combinar con paginación basada en cursor (`startAfter`). La relevancia se calcula por consulta en lugar de almacenarse, por lo que no hay ningún valor en la fila del cursor contra el cual comparar la siguiente página, y dos solicitudes con diferentes cadenas de búsqueda producen puntuaciones que no están en la misma escala. Utiliza `limit`/`offset` para páginas ordenadas por relevancia.

## ¿Por qué coincidió esta fila?

Una lista ordenada por relevancia te dice *cuáles* filas, nunca *por qué* una de ellas está allí. Pídele a cada fila que se explique:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` es la ruta exactamente como se declaró en `fields`, por lo que puedes mapearla a una etiqueta para mostrarla. Los campos se devuelven en el orden en que los declaraste.

Por consulta, no por colección, porque el coste es por consulta: un `ts_headline` por cada campo declarado por cada fila devuelta, y `ts_headline` vuelve a analizar el documento en lugar de leer el índice. Adecuado para una página de resultados, inadecuado para una exportación masiva.

**El fragmento (snippet) contiene marcado HTML por diseño**: cada coincidencia está envuelta en `<mark>`. Renderízalo como HTML o elimina las etiquetas, pero no lo trates como texto sin formato, y no confíes en el texto circundante: es lo que el usuario haya escrito. Dividir por `<mark>` y renderizar las partes es más seguro que usar `dangerouslySetInnerHTML`.

<span class="since-badge" data-since="0.22">Desde 0.22</span> Con `mode: "hybrid"`, un campo que coincide únicamente por subcadena también se reporta: es el campo que causó la coincidencia. Su fragmento se devuelve sin nada marcado: `ts_headline` marca lexemas, y media palabra no es un lexema.

Con `unaccent` activado, los fragmentos se leen con los acentos normalizados: `Auditoria`, no `Auditoría`. `ts_headline` sobre el texto original no puede encontrar una coincidencia producida por una consulta sin acentos, por lo que devolvería el texto sin nada resaltado; un fragmento legible que resalta es mejor que uno más bonito que silenciosamente no resalta nada.

## Añadir el bloque a una colección en producción

La columna generada se añade mediante la verificación del esquema en el arranque, como cualquier otra columna, y su índice se construye con `CREATE INDEX CONCURRENTLY` para que no se bloqueen las escrituras. Añadir una columna generada *almacenada* (`STORED`) reescribe la tabla, por lo que en una grande, planifícalo como cualquier otra reescritura.

## Motores compatibles

El bloque `search` es exclusivo de Postgres y se rechaza en el arranque en otros motores en lugar de ignorarse silenciosamente. Las colecciones de MongoDB mantienen su coincidencia basada en expresiones regulares; las colecciones de Firestore utilizan el controlador externo de búsqueda de texto.

## Relacionado

- [API REST](/docs/backend/api/) — los parámetros de consulta con los que una búsqueda llega al servidor
- [Índices](/docs/backend/indexes/) — qué crea el bloque de búsqueda y cuál es su coste
- [Consultar datos](/docs/sdk/querying/) — buscar desde el SDK del cliente
