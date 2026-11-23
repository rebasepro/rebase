---
sourceHash: b2705ba2e3901257
title: Columnas
sidebar_label: Columnas
description: "Cada constructor col.* y modificador: el tipo de Postgres que crea cada uno, el tipo que un cliente lee y escribe, y lo que la API impone: nulabilidad, valores por defecto, stamps, validación, conjuntos cerrados de valores, acceso y almacenamiento."
---

Una columna es un constructor `col.*`, refinado mediante modificadores. El constructor decide el
tipo de Postgres; los modificadores definen todo lo demás: si la columna puede ser
nula, su valor por defecto, su validación, y quién puede leerla y escribirla.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        sku:       col.varchar({ length: 32 }).notNull().unique(),
        name:      col.text().notNull().validate({ min: 2, max: 120, trim: true }),
        price:     col.numeric({ precision: 10, scale: 2 }).notNull().validate({ min: 0 }),
        status:    col.enum(["draft", "active", "retired"]).notNull().default("draft"),
        tags:      col.text().array().validate({ maxItems: 10 }),
        photo:     col.storage({ path: "products/", accept: ["image/*"], maxBytes: "5MB" }),
        createdBy: col.uuid().onCreateUser().readOnly(),
        createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        updatedAt: col.timestamp({ withTimezone: true }).notNull().onUpdateNow(),
    },
    rls: "admin-only",
});
```

Los constructores son inmutables: cada modificador devuelve un nuevo constructor, por lo que una columna puede
declararse una vez y compartirse entre tablas.

Después del punto, una columna se lee como `pg-core` de [Drizzle](https://orm.drizzle.team/docs/column-types/pg):
los mismos nombres de constructores, primero un nombre opcional de columna SQL, luego
el objeto de configuración de Drizzle y después la cadena: `col.varchar({ length: 32 })`,
`col.timestamp({ withTimezone: true })`, `col.text().array()`,
`` .default(sql`now()`) ``. Una sintaxis de Drizzle que signifique algo diferente aquí
no compilará, y el error indicará qué escribir en su lugar. Dos diferencias a
tener en cuenta:

- **Una clave foránea es una relación.** Declárela bajo `relations`:
  `author: rel.belongsTo(() => users, { localKey: "author_id" })`. La
  clave de la relación es lo que nombra `include`. `.references()` no existe, y
  así lo indica. Consulte [Relaciones](/docs/collections/relations/).
- **`.defaultNow()` es solo un valor por defecto en la base de datos**: `DEFAULT now()`, que un cliente
  aún puede sobrescribir. `.onCreateNow()` es un [stamp](#stamps) del servidor: el servidor
  escribe la hora al crear, independientemente de lo que haya enviado el cliente.

## Constructores

Un constructor por cada tipo de Postgres. El tipo wire es lo que un cliente lee en una fila y
envía en una escritura, y cómo el SDK y [`InferRow`](/docs/schema/types/) tipan
la columna. Cada constructor acepta un nombre opcional de columna SQL como su primer
argumento (`col.text("legacy_title")`); sin él, el nombre SQL es el
snake_case de la clave.

| Constructor | Tipo de Postgres | Tipo wire | Notas |
|---|---|---|---|
| `col.uuid()` | `UUID` | `string` | `.defaultRandom()` para `gen_random_uuid()` |
| `col.text()` | `TEXT` | `string` | `col.text({ enum: [...] })` acepta únicamente esos valores; consulte [Conjuntos cerrados de valores](#conjuntos-cerrados-de-valores) |
| `col.varchar({ length })` | `VARCHAR(n)` | `string` | la longitud es obligatoria; también acepta `enum` |
| `col.char({ length })` | `CHAR(n)` | `string` | la longitud es obligatoria; también acepta `enum` |
| `col.enum(values)` | un tipo enum de Postgres, `<table>_<column>` | la unión de `values` | consulte [Conjuntos cerrados de valores](#conjuntos-cerrados-de-valores) |
| `pgEnum(name, values)`, luego `status()` | un tipo enum de Postgres con nombre | la unión de `values` | cada columna de este comparte el mismo tipo |
| `col.smallint()` | `SMALLINT` | `number` | |
| `col.integer()` | `INTEGER` | `number` | |
| `col.bigint({ mode: "number" })` | `BIGINT` | `number` | se lee y se escribe como un número de JavaScript |
| `col.smallserial()` | `SMALLSERIAL` | `number` | tiene un valor por defecto; es preferible usar `col.smallint().generatedByDefaultAsIdentity()` en un esquema nuevo |
| `col.serial()` | `SERIAL` | `number` | tiene un valor por defecto; es preferible usar `col.integer().generatedByDefaultAsIdentity()` |
| `col.bigserial({ mode: "number" })` | `BIGSERIAL` | `number` | tiene un valor por defecto; es preferible usar `col.bigint({ mode: "number" }).generatedByDefaultAsIdentity()` |
| `col.real()` | `REAL` | `number` | |
| `col.doublePrecision()` | `DOUBLE PRECISION` | `number` | |
| `col.numeric({ precision?, scale? })` | `NUMERIC`, `NUMERIC(p)`, `NUMERIC(p, s)` | `number` | una escala requiere una precisión; `col.decimal()` es el mismo constructor |
| `col.boolean()` | `BOOLEAN` | `boolean` | |
| `col.timestamp({ withTimezone: true })` | `TIMESTAMPTZ` | `string` (ISO 8601) | una escritura también acepta un `Date`; un timestamp sin zona horaria es `col.custom({ dataType: "timestamp" })` |
| `col.date()` | `DATE` | `string` (`YYYY-MM-DD`) | una escritura también acepta un `Date` |
| `col.time()` | `TIME` | `string` (`HH:MM:SS`) | una escritura también acepta un `Date` |
| `col.jsonb()` / `col.jsonb(shape)` | `JSONB` | `unknown` (`.$type<T>()` le asigna tipo), o el tipo de la estructura | consulte [Documentos JSON](/docs/schema/json/) |
| `col.json()` / `col.json(shape)` | `JSON` | igual que `jsonb` | conserva el texto exacto que recibió; prefiera `jsonb` |
| `<builder>.array()` | `<inner>[]` | un array del tipo wire interno | `col.text().array()`; no se permiten arrays de arrays; consulte [Arrays](#arrays) |
| `col.vector({ dimensions, index? })` | `vector(dimensions)` (pgvector) | `number[]` | un índice de coseno HNSW a menos que `index` indique lo contrario; consulte [Búsqueda vectorial](/docs/backend/vector-search/) |
| `col.bytea()` | `BYTEA` | `string` (base64) | |
| `col.geopoint()` | `JSONB` | `{ latitude: number; longitude: number }` | |
| `col.storage(options)` | `TEXT` | `string` (la ruta del archivo) | `.multiple()` lo convierte en `TEXT[]`; consulte [Columnas de almacenamiento](#columnas-de-almacenamiento) |
| `col.custom({ dataType })` | cualquier otro tipo de Postgres, literal (`"inet"`, `"citext"`) | `string` (`.$type<T>()` le asigna tipo) | Rebase nombra el tipo en el DDL y transfiere los valores directamente |

## Modificadores

Cada constructor cuenta con el primer grupo. El resto solo existe en los constructores donde tiene
sentido; llamar a uno en otro lugar produce un error de tipo.

| Modificador | En | Base de datos | API y tipos |
|---|---|---|---|
| `.notNull()` | cada columna | `NOT NULL` | nunca `null` en una fila; obligatorio al crear a menos que tenga un valor por defecto |
| `.primaryKey()` | cada columna | parte de la clave primaria, `NOT NULL` | ausente del tipo `Update` |
| `.unique()` | cada columna | `UNIQUE` en una sola columna | un duplicado genera un `409` |
| `.default(value)` | cada columna | `DEFAULT <value>` | aplicado por el driver también al crear; opcional al crear |
| `` .default(sql`expr`) `` | cada columna | `DEFAULT <expr>` | opcional al crear; `sql` se importa junto a `col` |
| `.dbDefault()` | cada columna | no modifica el valor por defecto existente en la base de datos | opcional al crear |
| `.serverDefault()` | cada columna | ninguno | un hook lo completa; opcional al crear, y el formulario del panel no lo requiere |
| `` .generatedAlwaysAs(sql`expr`) `` | cada columna | `GENERATED ALWAYS AS (<expr>) STORED` | nunca editable, por nadie |
| `.$type<T>()` | cada columna | ninguno | asigna el tipo al valor solo para TypeScript, como en Drizzle |
| `.array()` | cada columna | `<type>[]` | consulte [Arrays](#arrays) |
| `.readOnly()` | cada columna | ninguno | se rechazan las escrituras del cliente; ausente de `Insert` y `Update` |
| `.private()` | cada columna | ninguno | nunca viaja por la red (wire), ni en el SDK ni en OpenAPI |
| `.access({ read?, write? })` | cada columna | ninguno | lectura y escritura por rol; consulte [Acceso a campos](/docs/collections/field-access/) |
| `.describe(text)` | cada columna | ninguno | la descripción en OpenAPI y MCP |
| `.validate(rules)` | cada columna | ninguno | se verifica antes de cada escritura; las reglas dependen del tipo, consulte [Validación](#validación) |
| `.transform({ beforeSave?, afterRead? })` | cada columna | ninguno | hooks a nivel de campo; `value` es `T \| null` a menos que `.notNull()` vaya primero; consulte [Hooks de tabla](/docs/collections/callbacks/#field-hooks-transform) |
| `.oneOf(values)` | columnas numéricas | ninguno | solo se aceptan estos valores; tipado como su unión (una columna de texto acepta `{ enum: [...] }`) |
| `.defaultRandom()` | `col.uuid()` | `DEFAULT gen_random_uuid()` | opcional al crear |
| `.generatedByDefaultAsIdentity()` | `col.smallint()`, `col.integer()`, `col.bigint({ mode: "number" })` | `GENERATED BY DEFAULT AS IDENTITY` | opcional al crear |
| `.defaultNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | opcional al crear; un cliente aún puede enviar un valor |
| `.onCreateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | el servidor estampa la hora al crear |
| `.onUpdateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` y un trigger `BEFORE UPDATE` | el servidor estampa la hora al crear y en cada actualización |
| `.onCreateUser()` | columnas de texto, `col.uuid()` | ninguno | el servidor escribe el id del invocador al crear |
| `.onUpdateUser()` | columnas de texto, `col.uuid()` | ninguno | el servidor escribe el id del invocador en cada escritura |
| `.userId()` | columnas de texto, `col.uuid()` | ninguno | la columna contiene el id de un usuario; el panel ofrece un selector de usuarios; consulte [Columnas de usuario](#columnas-de-usuario) |
| `.multiple()` | `col.storage()` | `TEXT[]` | la columna contiene varias rutas de archivos |

## Nulos, requeridos y valores por defecto

Las columnas admiten valores nulos (nullable) por defecto. `.notNull()` y `.primaryKey()` hacen que una columna sea
`NOT NULL`, y la API pasa a requerirla al crear a menos que tenga un valor por defecto. Una
columna `NOT NULL` es de tipo `T` en una fila; cualquier otra columna es `T | null`.

Un valor por defecto puede ser cualquiera entre `.default()`, `` .default(sql`…`) ``, `.defaultNow()`,
`.dbDefault()`, `.serverDefault()`, `.defaultRandom()`,
`.generatedByDefaultAsIdentity()`, un stamp o un constructor serial. Una columna con un
valor por defecto puede omitirse en una operación de creación:

```ts
import { defineTable, col, sql } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id:       col.integer().primaryKey().generatedByDefaultAsIdentity(),
        code:     col.text().notNull().default(sql`gen_short_id()`),
        priority: col.smallint().notNull().default(3),
        legacy:   col.text().dbDefault(),
    },
    rls: "admin-only",
});
```

- **`.default(value)`** se escribe como el `DEFAULT` de la columna y también lo aplica
  el driver al crear, de modo que la fila resulta igual sin importar quién la inserte. Una
  columna temporal también acepta un `Date`, almacenado como su cadena ISO. El valor por
  defecto de una columna enum debe ser uno de sus valores.
- **`` .default(sql`expression`) ``** es evaluado por Postgres. La expresión se
  escribe tal cual en el DDL, por lo que la etiqueta `sql` no admite `${…}`.
  `.defaultNow()` es `` .default(sql`now()`) ``.
- **`.dbDefault()`** indica que la base de datos ya contiene un valor por defecto que el
  esquema no declara. Una creación puede omitir la columna, y un push del esquema no elimina
  dicho valor por defecto.
- **`.serverDefault()`** indica que el propio código del servidor de la tabla completa la columna cuando
  una creación la omite: un `hooks.beforeSave` que genera un slug a partir del
  título, o el `.transform()` de la columna. Un hook es código que nadie puede leer, por lo que la
  columna indica lo que hace. No se escribe ningún valor por defecto en el DDL; una creación puede omitir la
  columna, OpenAPI no la lista como obligatoria y el formulario del panel permite que se
  cree un registro sin ella (sin `filledByServer` en la personalización).

`.generatedAlwaysAs()` no puede tener un valor por defecto ni un stamp: Postgres calcula la columna
en cada escritura. Una columna de clave primaria no puede ser `.private()`.

## Stamps

Un stamp es un valor que el servidor escribe en una columna por su cuenta. Sobrescribe
cualquier cosa que el cliente envíe para esa columna.

| Stamp | Escribe | Cuándo |
|---|---|---|
| `.onCreateNow()` | la hora actual | al crear |
| `.onUpdateNow()` | la hora actual | al crear y en cada actualización |
| `.onCreateUser()` | el id de usuario del invocador | al crear |
| `.onUpdateUser()` | el id de usuario del invocador | al crear y en cada actualización |

Una columna admite un solo stamp. Invocar un segundo stamp diferente lanza un error cuando el
módulo se carga; `.onUpdateNow()` por sí solo ya estampa la fila cuando esta se crea.
Las columnas con stamp permanecen admitiendo nulos a menos que se escriba `.notNull()`.

`.onCreateUser()` es la forma en que una columna que una regla de seguridad a nivel de fila compara con
el invocador (`ownerField`) obtiene su valor. Una columna que completa el invocador es una columna
en la que el invocador puede mentir.

## Columnas de usuario

`.userId()` indica que una columna contiene el id de un usuario. Es un significado semántico, no un
tipo: la columna sigue siendo `text` (o `varchar`, `char`, `uuid`), y el
descriptor que sirve el servidor incluye `semantic: "user"`.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        subject: col.text().notNull(),
        assignedTo: col.text().userId().describe("Team member assigned to this ticket"),
        watchers: col.text().userId().array()
    },
    rls: "admin-only"
});
```

De ello se derivan dos cosas:

- El panel de administración muestra un selector de usuarios para la columna en lugar de un
  campo de texto, y muestra al usuario en lugar del id en bruto.
- Un invocador que tenga permisos de escritura en la tabla puede buscar usuarios para completarla. La lectura
  del selector le responde incluso cuando la seguridad a nivel de fila le oculta las filas de otros
  usuarios.

Funciona en `col.text()`, `col.varchar()`, `col.char()` y `col.uuid()`,
en los elementos de un array (`col.text().userId().array()`), y en
`json.string()` dentro de un [documento JSON](/docs/schema/json/). En cualquier otro lugar,
lanza un error al cargar el módulo. No declara ninguna clave foránea: escriba
`rel.belongsTo(() => users)` cuando la base de datos deba imponer una. Para hacer que el
servidor complete la columna con el id del invocador, use un [stamp](#stamps) en su lugar.

## Validación

`.validate(rules)` toma las reglas para el tipo de la columna. La API las comprueba
antes de una creación o actualización y rechaza la escritura con un `400` que nombra la
columna. Invocar `.validate()` dos veces fusiona las reglas.

| Regla | Columnas de texto y `col.storage()` | Columnas numéricas | `timestamptz`, `date`, `time` | Arrays |
|---|---|---|---|---|
| `min`, `max` | longitud | límites inclusivos | valor más temprano y más tardío (cadena ISO o `Date`) | |
| `length` | longitud exacta | | | |
| `matches`, `matchesFlags`, `matchesMessage` | un patrón (cadena o `RegExp`) y el error | | | |
| `email`, `url` | el valor es una dirección o una URL | | | |
| `trim`, `lowercase`, `uppercase` | el valor se normaliza antes de almacenarse | | | |
| `lessThan`, `moreThan` | | límites exclusivos | | |
| `positive`, `negative`, `integer` | | signo, número entero | | |
| `minItems`, `maxItems`, `uniqueItems` | | | | cantidad de elementos, sin duplicados |
| `requiredMessage` | ✓ | ✓ | ✓ | ✓ |

`requiredMessage` es el error que recibe una creación cuando omite una columna
`.notNull()` sin un valor por defecto. Todos los demás tipos de columna (`uuid`, `enum`, `boolean`,
JSON, `vector`, `bytea`, `geopoint`) aceptan únicamente `requiredMessage`.

Una `RegExp` se almacena como su origen (source) y flags, y un límite de `Date` como su
cadena ISO, por lo que las reglas servidas en el wire son las mismas reglas que el servidor comprueba.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const signups = defineTable("signups", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        email:    col.text().notNull().validate({ email: true, lowercase: true, trim: true, requiredMessage: "Enter your e-mail address." }),
        handle:   col.varchar({ length: 32 }).validate({ matches: /^[a-z0-9_]+$/, matchesMessage: "Lower-case letters, digits and _ only." }),
        age:      col.smallint().validate({ integer: true, min: 13 }),
        birthday: col.date().validate({ max: "2013-01-01" }),
    },
    rls: "admin-only",
});
```

En `col.varchar({ length })` y `col.char({ length })`, la longitud es impuesta
por Postgres y por la API. Un `max` que difiera de esta entra en contradicción; indique
la longitud una sola vez.

## Conjuntos cerrados de valores

Dos formas de aceptar únicamente ciertos valores:

- **Un tipo enum de Postgres**, para que la base de datos también imponga el conjunto.
  `col.enum(values)` crea uno denominado `<table>_<column>`. Un tipo con un nombre
  de su elección, compartido por varias columnas, se declara una sola vez con
  `pgEnum(name, values)` —como en Drizzle— y se invoca en cada columna:
  `postStatus()`. Dos declaraciones con el mismo nombre deben listar los mismos valores
  en el mismo orden.
- **Un conjunto que la API comprueba**, sin tipo en Postgres: `{ enum: [...] }` en
  `col.text()`, `col.varchar()` o `col.char()`, y `.oneOf(values)` en una
  columna numérica. También es la forma para un array de cadenas conocidas:
  `col.text({ enum: ["a", "b"] }).array()`.

Todas ellas tipan la columna como la unión de sus valores: `status` a continuación es
`"draft" | "published"` en la fila, `kind` es `"news" | "guide"`, y `rating`
es `1 | 2 | 3 | 4 | 5`.

```ts
import { defineTable, col, pgEnum } from "@rebasepro/server/schema";

const reviewStatus = pgEnum("review_status", ["draft", "published"]);

export const reviews = defineTable("reviews", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: reviewStatus().notNull().default("draft"),
        kind:   col.text({ enum: ["news", "guide"] }),
        rating: col.smallint().notNull().oneOf([1, 2, 3, 4, 5]),
        labels: col.text({ enum: ["bug", "praise", "question"] }).array(),
    },
    rls: "admin-only",
});
```

Las etiquetas y los colores de los valores forman parte de la presentación. Pertenecen al CMS, no
a la tabla.

## Arrays

`.array()` crea un array de Postgres del tipo de la columna, como en Drizzle:
`col.text().array()` es `TEXT[]`, `col.integer().array()` es `INTEGER[]`. Lo que
se encadena antes de `.array()` describe cada elemento: su `{ enum }`, `.validate()`,
`.oneOf()`, opciones de almacenamiento y `.transform()`. Lo que va después describe
la columna del array: su propio `.validate()` acepta `minItems`, `maxItems` y
`uniqueItems`.

Los modificadores que describen una columna (`.notNull()`, un valor por defecto, `.unique()`,
`.access()`) van después de `.array()` — `col.text().array().notNull().default([])`;
antes de él no compilan. Se rechaza un array de arrays; use
`col.jsonb()` para listas anidadas. Un array contiene escalares: texto, `uuid`, números,
booleanos, fechas, enums: se rechaza un `.array()` de `jsonb`, `json`, `vector`, `bytea`,
geopoints o `col.custom()`, y una lista de documentos, puntos o
vectores se define como `col.jsonb(json.array(…))`. Un tipo de lista personalizado se nombra por sí mismo:
`col.custom({ dataType: "inet[]" })`.

Cada elemento se sirve tal como se sirve su tipo en una columna escalar: un
elemento `timestamptz[]` como una cadena RFC 3339, un elemento `numeric[]` como un número y
un elemento nulo como `null`.

## Claves, identidad y seriales

`.generatedByDefaultAsIdentity()` hace que una columna de enteros sea `GENERATED BY DEFAULT
AS IDENTITY`. Es la forma recomendada para una clave entera en un esquema nuevo
(`.generatedAlwaysAsIdentity()` no compila: Rebase crea identidades solo by default).
Los constructores serial (`col.smallserial()`, `col.serial()`,
`col.bigserial({ mode: "number" })`) existen para esquemas que
ya los utilizan; una columna que apunta a una clave serial es el entero simple del
mismo ancho. Consulte [Claves primarias](/docs/schema/#primary-keys) para claves compuestas.

`col.bigint({ mode: "number" })` se lee y se escribe como un `number` de JavaScript
(el `mode: "bigint"` de Drizzle no compila), el cual es exacto hasta
2⁵³ − 1. `col.numeric()` también es un `number`, por lo que transmite la precisión de un
double en el wire, independientemente de la precisión que Postgres almacene.

## Quién puede leer y escribir una columna

La seguridad a nivel de fila (row-level security) decide a qué filas accede un invocador. Tres modificadores restringen
lo que este ve de una fila y lo que puede establecer:

- **`.readOnly()`** rechaza cualquier escritura del cliente en la columna, tanto al crear como al
  actualizar, sin importar el rol del invocador. La base de datos (un valor por defecto, un trigger) y
  el código del servidor aún pueden completarla. La columna no aparece en los tipos
  `Insert` y `Update`.
- **`.private()`** mantiene la columna en el servidor: ausente de cada fila en
  el wire, del SDK, de OpenAPI, y se rechaza en filtros y ordenaciones. Los hooks y
  el código del servidor aún la ven. Una columna privada no puede declarar también `.access()`.
- **`.access({ read, write })`** lista los roles que reciben la columna y los
  roles que pueden escribirla. Omitir una lista deja esa dirección a nivel de fila; una
  lista vacía la cierra para todos los invocadores.

[Acceso a campos](/docs/collections/field-access/) detalla lo que ve un invocador cuando
se oculta una columna y cada vía a la que se aplica la regla.

## Columnas de almacenamiento

`col.storage(options)` contiene la ruta de un archivo en un bucket de almacenamiento. La ruta de
subida impone `accept` y `maxBytes`, y la limpieza de huérfanos considera el archivo como
referenciado mientras una fila conserve su ruta. `.multiple()` hace que la columna contenga
varias rutas (`TEXT[]`).

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const listings = defineTable("listings", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        cover:  col.storage({ path: "listings/{id}/", accept: ["image/*"], maxBytes: "10MB",
                              imageResize: { maxWidth: 1600, format: "webp", quality: 80 } }),
        photos: col.storage({ path: "listings/{id}/gallery/", accept: ["image/*"] }).multiple(),
        terms:  col.storage({ path: "listings/terms/", accept: ["application/pdf"], public: true }),
    },
    rls: "admin-only",
});
```

| Opción | Qué hace |
|---|---|
| `path` | **Obligatorio.** Dónde van los archivos, como una plantilla de ruta: `"posts/heroes/"`, `"users/{id}/"`. |
| `source` | El bucket, declarado en `backend/resources.ts`. El bucket por defecto si se omite. |
| `accept` | Tipos MIME aceptados, con comodines: `["image/*", "application/pdf"]`. |
| `maxBytes` | El archivo más grande aceptado: un número de bytes, o un tamaño como `"10MB"`, `"512 kb"`, `"1.5GB"`. Múltiplos binarios: 1 MB son 1.048.576 bytes. Un tamaño ilegible lanza un error. |
| `imageResize` | Redimensionar imágenes antes de almacenarlas: `maxWidth`, `maxHeight`, `mode` (`"contain"` o `"cover"`), `format` (`"original"`, `"jpeg"`, `"png"`, `"webp"`), `quality`. |
| `public` | Los archivos se pueden leer sin una URL firmada. |
| `fileName` | El nombre del archivo almacenado, como una plantilla. El nombre subido si se omite. |
| `metadata` | Metadatos almacenados con cada archivo. |
| `includeBucketUrl` | Almacena la URL del bucket delante de la ruta. |
| `storeUrl` | Almacena la URL de descarga en lugar de la ruta. |

Una columna de almacenamiento acepta las reglas de validación de las columnas de texto. Un archivo dentro de un
documento JSON es `json.storage()`, con las mismas opciones; consulte
[Documentos JSON](/docs/schema/json/). Quién puede subir y descargar qué rutas corresponde a
la [autorización de almacenamiento](/docs/backend/storage-authorization/); servir y
almacenar en caché los archivos corresponde a [Almacenamiento](/docs/backend/storage/).

## Qué se rechaza

Al cargar el módulo, un constructor lanza un error si encuentra:

- `col.varchar()` o `col.char()` sin una longitud; un `length` o `dimensions`
  que no sea un número entero positivo, y `col.numeric({ scale })` sin
  precisión;
- `col.enum([])`, `pgEnum(name, { … })`, y el `.array()` de un array;
- un valor por defecto o expresión generada con `sql` que contenga una interpolación;
- un segundo stamp diferente en una misma columna, y `.oneOf()` con un valor que no
  sea ni una cadena ni un número;
- un `.access()` cuyo `read` o `write` no sea una lista de nombres de rol no vacíos;
- `col.storage()` sin un `path`, o con un `maxBytes` que no sea un tamaño válido.

Cuando el esquema se compila, la tabla se rechaza por:

- un valor por defecto junto con `.generatedAlwaysAs()`, o un stamp junto con este;
- `.generatedByDefaultAsIdentity()` en una columna no entera, `.defaultRandom()` en una columna
  que no sea `uuid`, un stamp de tiempo en una columna no temporal, un stamp de usuario en una columna que
  no sea de texto ni `uuid`;
- una clave primaria `.private()`, o una clave primaria `timestamptz` o `time`;
- una clave primaria en una columna `jsonb`, `json`, geopoint, `vector`, `bytea`, array o
  lista personalizada: una clave es un escalar (texto, `varchar`, `char`, `uuid`, un
  enum, un número, un booleano o una fecha). `schema introspect` omite una tabla con clave
  de este tipo e indica el motivo;
- un `.array()` de `jsonb`, `json`, `vector`, `bytea`, geopoints o
  `col.custom()` (consulte [Arrays](#arrays));
- una regla `.validate()` que el tipo de columna, sus elementos o un nodo JSON no
  verifiquen (`integer` en una columna de texto, `trim` en un número, `minItems` en un escalar);
- una columna que sea tanto `.private()` como `.access()`;
- un `.transform()` en una columna y otro en su estructura JSON;
- un `col.custom({ dataType })` cuyo nombre de tipo no tenga la forma de un nombre de tipo
  de Postgres;
- `.oneOf([])`, y `.oneOf()` en una columna que no sea de texto ni numérica;
- un enum con un valor en blanco o repetido, o un valor por defecto que no sea uno de sus
  valores;
- dos claves que resuelvan a la misma columna SQL, incluso después de que Postgres
  trunque los nombres a 63 bytes;
- un tipo enum con nombre al que se le proporcionan dos listas de valores diferentes.

Cada rechazo especifica la tabla, la columna y qué escribir en su lugar.

La sintaxis de Drizzle que signifique algo diferente aquí no compilará, y el
compilador mostrará qué escribir: `col.timestamp()` sin `withTimezone: true`,
`.references()`, `.$defaultFn()`, `.$onUpdate()`, `.generatedAlwaysAsIdentity()`,
`.unique("name")`, el `mode: "string"` de `numeric`, y `col.inet()`, `col.interval()`
junto con los demás tipos que Rebase nombra únicamente mediante `col.custom({ dataType })`.

## Siguientes pasos

- [Documentos JSON](/docs/schema/json/): la estructura de una columna `jsonb`
- [Relaciones](/docs/collections/relations/): las claves foráneas provienen de `rel.*`, no de las columnas
- [Acceso a campos](/docs/collections/field-access/): `.access()`, `.private()` y `.readOnly()` en detalle
- [Inferencia de tipos](/docs/schema/types/): lo que hace cada modificador en `InferRow` e `InferInsert`
