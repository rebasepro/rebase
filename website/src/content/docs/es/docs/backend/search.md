---
sourceHash: 04421ade309db1ce
title: Búsqueda
sidebar_label: Búsqueda
description: Cómo se comporta .search() por defecto y cómo habilitar en una colección de Postgres la búsqueda de texto completo clasificada sobre los campos que especifiques, incluyendo contenido JSONB y arrays.
---

`.search("term")` funciona en cada colección sin configuración. En qué se
compila depende de si la colección ha solicitado algo más.

## El comportamiento por defecto

Sin configuración, `.search()` es una **coincidencia de subcadena insensible a mayúsculas y minúsculas**,
combinada mediante OR entre las propiedades `string` de nivel superior de la colección:

```sql
WHERE name ILIKE '%term%' OR description ILIKE '%term%'
```

Esto es suficiente para una colección pequeña con su texto en columnas simples. Tiene
tres limitaciones que ninguna configuración interna puede solucionar:

- **No puede ver dentro de propiedades `map` o `array`.** Una colección que guarda
  su contenido buscable en JSONB (etiquetas, certificaciones, un cuestionario) tiene
  un cuadro de búsqueda que silenciosamente no coincide con nada.
- **No tiene relevancia.** Las filas se devuelven en el orden de `orderBy`, por lo
  que la mejor coincidencia puede estar en la página siete.
- **No puede usar un índice.** Un `%` inicial inhabilita un índice B-tree, por lo que
  cada búsqueda es un escaneo secuencial. Está bien para mil filas; un abismo para un millón.

El comportamiento por defecto no cambia, y una colección que no se ha habilitado se
compila exactamente al SQL de siempre.

## Habilitación

Declara un bloque `search` en una colección de Postgres, especificando los campos que
deseas indexar:

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

Nada se infiere. Un campo se busca si y solo si lo nombras, y una ruta que no se
resuelve falla al iniciar (boot) en lugar de omitirse en silencio; un campo de búsqueda
que crees que está activo y no lo está es exactamente el fallo que este bloque existe para
prevenir.

A continuación, `.search()` se compila en una coincidencia de texto completo clasificada,
y las filas se devuelven con un `_score`:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Qué crea al declararlo

Una columna `tsvector`, `GENERATED ALWAYS AS … STORED`, y un índice GIN sobre ella.
Postgres recalcula la columna en cada escritura de un campo de origen y rechaza cualquier
intento de escribir en ella directamente, por lo que el índice no puede desincronizarse
de la fila. La columna nunca es devuelta por la API.

Se generan en `drizzle/search.sql`, junto a `schema.sql` y `policies.sql`, y
`rebase db push` los aplica por ti; no hay nada adicional que ejecutar. Obtienen
su propio archivo porque una columna `tsvector` generada necesita que exista
primero una función auxiliar `IMMUTABLE` (`unaccent` es solo `STABLE`, y aplanar
un documento `jsonb` necesita una función que devuelva un conjunto), y Atlas (el
motor detrás de `db push`) no puede gestionar funciones en su nivel gratuito.

Una consecuencia que vale la pena conocer si despliegas mediante migraciones en lugar de push:
agregar un bloque `search` por sí solo no produce ninguna migración, porque el esquema
que Atlas compara no ha cambiado. `rebase db generate` lo indica cuando sucede.
El bloque aún se aplica mediante `rebase db push` y por el aseguramiento del esquema al
iniciar (boot-time schema ensure); para incluirlo explícitamente en una migración, adjunta
`drizzle/search.sql` a una.

## Qué puedes nombrar en `fields`

| Ruta | Se resuelve como | Ejemplo |
|------|-------------|---------|
| Una propiedad `string` | la columna | `"full_name"` |
| Una propiedad `string[]` | cada elemento | `"interests"` |
| Una propiedad `map` | cada valor de cadena en el documento | `"questionnaire"` |
| Una ruta dentro de un `map` | cada valor de cadena en ese punto o por debajo de él | `"questionnaire.certifications"` |

Una ruta hacia un map indexa **valores de cadena a cualquier profundidad** por debajo
de ella: arrays de cadenas, objetos anidados, arrays de objetos. Las *claves* JSON
nunca se indexan, solo los valores, de modo que un nombre de campo común a todas las filas
no se convierte en un término que coincida con todas las filas.

Nombrar un enum, un UUID, una columna `json` (en lugar de `jsonb`) o un array de
números produce un error en el arranque que explica el motivo. Los enums en particular son
un vocabulario fijo: fíltralos con `where`, que es exacto y utiliza un índice.

## Opciones

### `language`

La configuración de búsqueda de texto de Postgres, que decide la lematización (stemming)
y las palabras vacías (stopwords). `"spanish"` lematiza `auditores` a `auditor` y elimina
`de`; el valor por defecto, `"simple"`, no hace ninguna de las dos cosas.

`"simple"` es el valor por defecto porque es la única opción que nunca es incorrecta:
un lematizador aplicado al idioma equivocado altera silenciosamente los lexemas.
Establécelo en el idioma de tu contenido para obtener lematización.

### `unaccent`

Elimina o ignora acentos antes de indexar, de modo que `auditoria` coincida con `auditoría`.

Esto no es cosmético en un idioma con acentos. Postgres lematiza las dos grafías en
**diferentes lexemas**: `to_tsvector('spanish', 'auditoría')` produce `auditor`
mientras que `'auditoria'` produce `auditori`. Por lo tanto, sin esto, una consulta
escrita sin acentos omite cada fila que los lleve, que son la mayoría de las consultas
que escriben los usuarios.

Requiere la extensión `unaccent`.

### `fuzzy`

Coincide también por similitud de trigramas, para que las coincidencias cercanas aún se
clasifiquen: `iso14000` alcanzando a `ISO 14001`, lo cual ninguna cantidad de lematización
logrará porque son simplemente lexemas diferentes.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Añade una segunda columna generada y un índice de trigramas, y requiere `pg_trgm`.
Cuesta tiempo de escritura y disco; soluciona el tipo más común de búsqueda fallida.

### `weight`

Cada campo lleva una de las cuatro clases de peso de Postgres, de la `A` (más fuerte)
a la `D`. `ts_rank` otorga a una coincidencia de tipo `A` una puntuación mucho más alta
que a una de tipo `D`, que es como un nombre supera a una mención de pasada en una descripción
larga. Los campos tienen el valor por defecto `B`.

### `column`

La columna generada se llama `search_vector`. Cámbiala solo si colisiona con una
columna que ya tengas: forma parte de tu esquema una vez creada, y renombrarla más tarde
requiere eliminarla y volver a crearla (drop and recreate), lo que reescribe la tabla.

## Clasificación

`_score` es `ts_rank` frente a la misma consulta con la que coincidieron las filas,
y solo está presente cuando la colección se ha habilitado *y* la solicitud incluye una
cadena de búsqueda.

Con `fuzzy` activado, la similitud de trigramas se **añade** a esa clasificación. Esto no
es un refinamiento: es lo que hace que `fuzzy` sea una clasificación en absoluto. Un error
tipográfico no coincide con nada en la ruta exacta, por lo que cada fila que encuentra tiene
un `ts_rank` de exactamente cero; ordenar solo por rango devolvería la mejor coincidencia
en cualquier orden en que la tabla decidiera hacerlo. Los dos términos se suman en lugar de
ponderarse, de modo que una fila que coincidió exactamente aporta ambos y supera a una fila
simplemente similar sin necesidad de un coeficiente que lo indique. Fuera de esas dos condiciones,
`orderBy: "_score"` es un campo desconocido y devuelve un error 400 en lugar de devolver filas
sin ordenar en silencio.

`_score` no se puede combinar con la paginación por cursor (`startAfter`). La relevancia
se calcula por consulta en lugar de almacenarse, por lo que no hay ningún valor en la
fila del cursor contra el cual comparar la página siguiente, y dos solicitudes con diferentes
cadenas de búsqueda producen puntuaciones que no están en la misma escala. Utiliza `limit`/`offset`
para páginas ordenadas por relevancia.

## ¿Por qué coincidió esta fila?

Una lista clasificada te dice *qué* filas, nunca *por qué* está una allí. Pídele a cada
fila que se explique:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` es la ruta exactamente como se declaró en `fields`, por lo que puedes mapearla
a una etiqueta para mostrarla. Los campos se devuelven en el orden en que los declaraste.

Es por consulta, no por colección, porque el coste es por consulta: un `ts_headline` por
campo declarado por fila devuelta, y `ts_headline` vuelve a analizar el documento en lugar
de leer el índice. Adecuado para una página de resultados, incorrecto para una exportación.

**El extracto (snippet) contiene marcado por construcción**: cada coincidencia está envuelta
en `<mark>`. Renderízalo como HTML o elimina las etiquetas, pero no lo trates como texto
plano, y no confíes en el texto circundante: es lo que sea que el usuario haya escrito.
Dividir por `<mark>` y renderizar las partes es más seguro que usar `dangerouslySetInnerHTML`.

Con `unaccent` activado, los extractos se leen con los acentos eliminados: `Auditoria`, no
`Auditoría`. `ts_headline` sobre el texto original no puede encontrar una coincidencia
producida por una consulta sin acentos, por lo que devolvería el texto sin nada marcado
en absoluto; un extracto legible que resalta es mejor que uno más bonito que no lo hace en silencio.

## Añadir el bloque a una colección en vivo

La columna generada se añade mediante el aseguramiento del esquema al iniciar (boot-time
schema ensure), como cualquier otra columna, y su índice se construye con `CREATE INDEX CONCURRENTLY`
para no bloquear las escrituras. Añadir una columna generada *almacenada* (stored) sí
reescribe la tabla, por lo que en una grande, planifícalo como cualquier otra reescritura.

## Qué motores

El bloque `search` es solo para Postgres y se rechaza al iniciar en otros motores en
lugar de ignorarse en silencio. Las colecciones de MongoDB conservan su coincidencia
basada en expresiones regulares (regex); las colecciones de Firestore utilizan el
controlador de búsqueda de texto externo.

---
