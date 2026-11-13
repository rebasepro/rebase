---
sourceHash: 23be8a1faf1d5f49
title: Documentos JSON
sidebar_label: Documentos JSON
description: "Tipa una columna jsonb con col.jsonb().$type<T>(), o dale una forma con json.* para que el servidor valide campos anidados, aplique valores predeterminados y marcas de tiempo/usuario, encuentre los archivos a los que hace referencia un documento y busque dentro de él."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una columna `jsonb` se puede declarar de dos maneras. `col.jsonb().$type<T>()` tipa el documento
para TypeScript y no le dice nada al servidor sobre él. `col.jsonb(shape)` toma una
forma construida con `json.*`, la cual tipa el documento de la misma manera y también
lo describe al servidor.

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const pages = defineTable("pages", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),

        // Typed for TypeScript only.
        settings: col.jsonb().$type<{ theme?: "light" | "dark"; pinned?: boolean }>(),

        // Typed, and known to the server.
        seo: col.jsonb(json.object({
            title:        json.string().validate({ max: 60 }).required(),
            canonicalUrl: json.string().validate({ url: true }),
            noIndex:      json.boolean().default(false),
        })),
    },
    rls: "admin-only",
});
```

Con una forma, el servidor:

- **valida** cada campo antes de una escritura, con las mismas reglas que acepta una columna;
- **aplica valores predeterminados** a los campos ausentes al crear;
- **estampa** campos de fecha con `.onCreateNow()` / `.onUpdateNow()`, y campos de usuario con `.onCreateUser()` / `.onUpdateUser()`, a cualquier nivel de profundidad;
- **ejecuta** los hooks `.transform()` de cada campo;
- **encuentra los archivos** a los que hace referencia un documento (`json.storage()`), de modo que el barrido de huérfanos los contabilice;
- **puede buscar** dentro del documento: un campo `search` puede indicar una ruta como
  `"seo.title"` (consulta [Búsqueda](/docs/backend/search/)).

La forma se envía con el descriptor de la tabla, de modo que el CMS puede construir un formulario para
el documento sin necesidad de indicarle cómo hacerlo. En su lugar, `col.jsonb().$type<T>()` obtiene un editor JSON genérico.

## Constructores

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Constructor | Contiene | Tipo en TypeScript |
|---|---|---|
| `json.string()` | una cadena de texto | `string` |
| `json.number()` | un número | `number` |
| `json.boolean()` | un booleano | `boolean` |
| `json.date()` | un instante, como cadena ISO | `string` |
| `json.geopoint()` | un punto en la Tierra | `{ latitude: number; longitude: number }` |
| `json.storage(options)` | la ruta de un archivo almacenado | `string` |
| `json.object(fields, { additional? })` | un objeto con claves conocidas | un tipo de objeto: campos requeridos obligatorios, el resto opcionales |
| `json.array(of)` | un array de una sola forma | un array del tipo de `of` |
| `json.oneOf(variants, { typeField?, valueField? })` | un bloque tipado | una unión de `{ type: "<variant>"; value: <su tipo> }` |
| `json.unknown()` | cualquier cosa | `unknown` |

`json.storage()` acepta las mismas opciones que [`col.storage()`](/docs/schema/columns/#storage-columns).
`json.object(fields, { additional: true })` también acepta claves que no hayan sido nombradas.

## Modificadores

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Modificador | En | Qué hace |
|---|---|---|
| `.required()` | cada campo | La clave debe estar presente en el documento. Hace que la clave no sea opcional en el tipo. |
| `.default(value)` | cada campo | El valor que se escribe cuando la clave está ausente al crear. |
| `.describe(text)` | cada campo | Qué es el valor, para OpenAPI y MCP. |
| `.validate(rules)` | cada campo | Las reglas que acepta una columna del mismo tipo: reglas de texto en `json.string()`, reglas numéricas en `json.number()`, límites de fecha en `json.date()`, cantidad de elementos, `uniqueItems` y `uniqueBy` en `json.array()`. Consulta [Validación](/docs/schema/columns/#validation). |
| `.transform({ beforeSave?, afterRead? })` | cada campo | Hooks a nivel de campo, ejecutados en el servidor. `value` es `T \| undefined` a menos que `.required()` vaya primero. |
| `.oneOf(values)` | `json.string()`, `json.number()` | Un conjunto cerrado de valores aceptados, tipados como su unión. |
| `.onCreateNow()` | `json.date()` | El servidor escribe la hora actual cuando se crea la fila. |
| `.onUpdateNow()` | `json.date()` | El servidor escribe la hora actual en cada escritura. |
| `.onCreateUser()` | `json.string()` | El servidor escribe el id del usuario actuante cuando se crea la fila, o `null` cuando nadie está actuando. |
| `.onUpdateUser()` | `json.string()` | El servidor escribe el id del usuario actuante en cada escritura. |
| `.userId()` | `json.string()` | El valor es el id de un usuario: el panel ofrece un selector de usuarios, y quien tenga permiso de escritura en la tabla puede buscar usuarios para rellenarlo. Consulta [Columnas de usuario](/docs/schema/columns/#user-columns). |

Los campos son opcionales a menos que se use `.required()`. Una clave requerida también es obligatoria en el
tipo de TypeScript:

```ts
import { col, json } from "@rebasepro/server/schema";

const address = json.object({
    street:  json.string().required(),
    city:    json.string().required(),
    country: json.string().validate({ length: 2, uppercase: true }).required(),
    notes:   json.string(),
});

// { street: string; city: string; country: string; notes?: string }
const shipping = col.jsonb(address);
```

### Marcas dentro de un documento

Las marcas funcionan a cualquier nivel de profundidad en una columna JSON: campos de objeto, cada elemento de un array y
el valor de un elemento de `oneOf` cuyo `type` nombra la variante. En una creación,
los objetos faltantes en el camino hacia una marca se crean automáticamente. En una actualización, solo se marcan
los campos `onUpdate*`, y únicamente dentro de un documento que la actualización envíe; un
documento que no se envíe conserva su valor almacenado. Una marca reemplaza cualquier cosa que
la escritura haya enviado, y el `.default()` de un campo lo completa primero.

## Arrays y bloques tipados

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`json.array(of)` es una lista de una sola forma. `json.oneOf(variants)` es un bloque cuya
clave `type` indica qué variante es y cuya clave `value` contiene el
contenido de esa variante. Como elementos de un array, conforma la estructura de un editor de bloques:

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        body: col.jsonb(json.array(json.oneOf({
            paragraph: json.string(),
            image:     json.storage({ path: "articles/images/", accept: ["image/*"] }),
            quote:     json.object({ text: json.string().required(), author: json.string() }),
        }))),
    },
    rls: "admin-only",
});
```

El `body` de una fila queda entonces tipado como un array de:

```ts
type Block =
    | { type: "paragraph"; value: string }
    | { type: "image"; value: string }
    | { type: "quote"; value: { text: string; author?: string } };
```

`json.array(json.object({...})).validate({ uniqueBy: ["sku"] })` rechaza dos
elementos que compartan un valor en un campo indicado (`unique_by`; los valores ausentes y `null`
no se comparan, y un `$push` comprueba los elementos insertados entre
sí). `validate({ uniqueItems: true })` rechaza dos elementos idénticos.
La raíz de un documento puede ser en sí misma un escalar o un `json.oneOf`, y
`json.unknown()` es un campo con cualquier valor JSON; el servidor comprueba cada forma en
escrituras REST, MCP y sockets.

`typeField` y `valueField` renombran las dos claves, para documentos que ya utilizan
otros nombres: `json.oneOf({ … }, { typeField: "kind", valueField: "data" })`.

## `jsonb` o `json`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`col.json()` toma los mismos argumentos que `col.jsonb()`. Almacena el texto tal y como fue
proporcionado, incluyendo el orden de las claves y los espacios en blanco, y no se puede indexar ni buscar de
la forma en que se hace con `jsonb`. Utilízalo únicamente cuando el texto exacto sea importante; de lo contrario, usa
`col.jsonb()`.

Un punto en la Tierra tiene su propio constructor de columna, `col.geopoint()`, almacenado como `jsonb`.
Una lista de valores simples que Postgres deba indexar suele ser más adecuada como una columna
de array: `col.text().array()`. Las listas anidadas pertenecen a `jsonb`: el uso de `.array()` en
un array no está permitido.

## Próximos pasos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Columnas](/docs/schema/columns/): los constructores de columnas y sus reglas de validación
- [Búsqueda](/docs/backend/search/): búsqueda de rutas dentro de un documento
- [Hooks de tabla](/docs/collections/callbacks/): `.transform()` y los hooks a nivel de tabla
