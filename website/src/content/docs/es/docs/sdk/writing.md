---
sourceHash: dc2857e881f65bd3
title: Escritura de datos
sidebar_label: Escritura de datos
description: create, upsert, update y delete con el SDK — operaciones de campo, escrituras condicionales, claves de idempotencia, escrituras por lotes y escritura entre tablas en una sola transacción.
---

Las lecturas se encuentran en [Consulta de datos](/docs/sdk/querying/). Esta página es la otra mitad:
todo lo que modifica una fila.

Cada método aquí pasa por el mismo pipeline que una escritura desde cualquier otro
lugar: los [hooks](/docs/collections/callbacks/), las
[relaciones](/docs/collections/relations/) y la
[seguridad a nivel de fila](/docs/collections/security-rules/) siguen aplicándose. Nada
de esto es un atajo para saltarse sus propias reglas; lo que ofrecen estas opciones
es ahorrarse un viaje de ida y vuelta (round trip), una transacción o una condición de carrera que ya no tendrá que perder.

## Escrituras de una sola fila

### Create

```typescript
const newProduct = await client.data.products.create({
    name: "New Product",
    price: 29.99,
    active: true
});

// With a specific ID
const newProduct = await client.data.products.create(
    { name: "Custom ID Product" },
    "my-custom-id"
);
```

### Upsert

Inserta la fila o actualiza la que ya ocupa su clave:

```typescript
await client.data.products.upsert(
    { sku: "LAMP-01", name: "Desk lamp", price: 39 },
    { onConflict: ["sku"] }
);
```

El servidor decide cuál ejecutar dentro de una única transacción y recurre a
`INSERT … ON CONFLICT DO UPDATE`, por lo que, a diferencia de un `findById` seguido de
`create` o `update`, no puede perder la condición de carrera entre ambos, y a diferencia
de `create`, no falla cuando la fila ya existe.

Cuando la fila ya existe, el upsert se comporta como una actualización de esta. Los campos
que envíe se escriben y los que omita conservan sus valores almacenados; no se restablecen
a su `defaultValue`. `beforeSave` y `afterSave` reciben `status: "existing"`
con los valores anteriores, y el historial registra una actualización. Una clave que haga
referencia a una fila fuera del alcance de `beforeQuery` de quien realiza la llamada devuelve un 404.

`onConflict` toma por defecto la clave primaria, la cual suele ser el objetivo incorrecto
para la mayoría de las escrituras en las que se recurre a un upsert: indexada en un id serial,
se comporta como una inserción simple porque quien llama no conoce el id; por lo tanto, una
importación ejecutable varias veces duplicaría cada fila en la segunda ejecución. Indique la
clave natural en su lugar. Debe contar con una garantía de unicidad que la base de datos pueda
cotejar (`validation: { unique: true }` en la propiedad, o las columnas de un
[índice](/docs/backend/indexes/) `unique: true`). Cualquier otra cosa devolverá un 400
listando los objetivos válidos existentes, en lugar de un error lanzado desde el interior de
una transacción.

La marca de tiempo `on_create` y el creador `user_on_create` de una fila que ya existía
permanecen intactos: un conflicto significa que su creación es un hecho del pasado.

#### Conservar la fila almacenada: `where` e `ignoreDuplicates`

`where` reemplaza la fila almacenada únicamente cuando coincide: un filtro sobre las
columnas de la fila almacenada, escrito del mismo modo en que se formula en un `find()`.
`ignoreDuplicates` nunca la reemplaza. En ambos casos, la llamada se resuelve como
`undefined` cuando la fila almacenada se deja como estaba, y la comprobación es propia de
la sentencia (`ON CONFLICT … DO UPDATE … WHERE`, `ON CONFLICT DO NOTHING`), por lo que
ninguna otra escritura puede intercalarse entre una lectura y la decisión:

```typescript
// Keep the best score of the day: written only when it beats the stored one.
const kept = await client.data.scores.upsert(
    { day, player, score },
    { where: { score: ["<", score] } }
);

// Claim a slot once; a second claim changes nothing.
const claim = await client.data.claims.upsert({ slot, owner }, { ignoreDuplicates: true });
if (!claim) throw new Error("taken");
```

`createMany(rows, { upsert: true, where })` y `{ upsert: true, ignoreDuplicates: true }`
hacen lo mismo por cada fila y devuelven únicamente las filas que escribieron. Ambos
requieren `upsert`, y los dos no pueden combinarse (`INVALID_CONFLICT_RULE`).

#### No disponible en la tabla de autenticación

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`upsert()` en la tabla de autenticación (la declarada con `defineAuthTable`) se rechaza
con un 400 (`INVALID_CONFLICT_TARGET`), al igual que `createMany` con `upsert` en ella.
Crear un usuario y modificarlo siguen reglas diferentes: una creación aplica hash a la
contraseña y envía la invitación, mientras que una actualización no puede degradar al
último administrador; además, un upsert solo sabe cuál de las dos operaciones es dentro
de la propia escritura. En su lugar, llame a `create` o `update`.

### Update

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

#### Operaciones de campo

Un valor puede ser, en su lugar, una operación sobre el valor *almacenado*:

```typescript
await client.data.posts.update(postId, {
    views: { $inc: 1 },
    tags:  { $push: "featured" },
    meta:  { $merge: { lastSeen: Date.now() } }
});
```

| Operador | Tipo de propiedad | Significado |
|----------|-------------------|-------------|
| `$inc` | `number` | sumar (negativo para restar) |
| `$push` | `array` | añadir un valor o cada elemento de un array de valores |
| `$pull` | `array` | eliminar todas las apariciones de un valor |
| `$merge` | `map` | fusionar superficialmente (shallow-merge) un objeto |

La razón para utilizarlos es evitar la lectura previa y la condición de carrera que dicha
lectura introduce. `views = current + 1` implica obtener `current` primero, y dos
peticiones que lean `4` escribirán ambas `5`: se pierde un incremento y ninguna de las
respuestas lo notifica. Al compilarse dentro de la sentencia, la operación aritmética
ocurre bajo el bloqueo de la fila.

Exactamente un operador por campo, y solo en una actualización: en una fila que aún no
existe no hay nada sobre lo que operar, por lo que una operación dentro de `create`,
`createMany` o `upsert` devuelve un 400. Un operador sobre el tipo de propiedad incorrecto
o un `$operator` mal escrito devuelve un 400 indicando el campo, en lugar de escribir
un documento JSON en la columna.

Una operación responde a la `validation` de la propiedad al igual que un valor, y eso
incluye el valor resultante que produce. `{ stock: { $inc: -1 } }` sobre un campo `stock` con
`validation: { min: 0 }` tiene éxito mientras el stock sea de al menos 1 y se rechaza
en 0 con el mismo error 400 (`VALIDATION_CONSTRAINT`) que recibiría `{ stock: -1 }`. Lo
mismo se aplica a `max`, `moreThan`, `lessThan`, `positive` y `negative`, así como a los
elementos `min` y `max` de un array tras un `$push` o `$pull`. La comprobación forma
parte de la sentencia de actualización, por lo que dos decrementos concurrentes de un
stock de 1 no pueden completarse con éxito al mismo tiempo, y una actualización rechazada
no escribe nada.

En modo sin conexión (offline) se rechazan en lugar de encolarse: una operación se evalúa
frente a un valor almacenado del cual el dispositivo no tiene una copia actualizada, y una
fila optimista solo podría mostrar el marcador de la operación hasta que la cola se vacíe.

### Delete

```typescript
await client.data.products.delete(42);
```

En una tabla con [borrado suave (soft delete)](/docs/collections/soft-delete), esto marca
la fila en lugar de eliminarla. `client.data.products.trash` lista, cuenta, restaura
y purga las filas marcadas.

### Escrituras condicionales

`update` y `delete` aceptan un parámetro `ifMatch`, de modo que la escritura se rechaza
si la fila ha cambiado desde que la leyó:

```typescript
import { etagOf } from "@rebasepro/client";

const post = await client.data.posts.get(1);
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(post) });
// → RebaseApiError, status 412, if somebody edited it in between
```

Sin esto, el patrón lectura-modificación-escritura hace que prevalezca el último escritor
(last-writer-wins) sobre todo lo que no haya enviado: dos editores con un segundo de
diferencia tendrán éxito y el cambio del primero desaparecerá sin ningún error visible.

`etagOf(row)` lee la versión a partir de una fila obtenida mediante `findById`/`get`. Reside
en una clave no enumerable, por lo que nunca entra en el tipo generado `Row`, en un
`JSON.stringify`, ni en la propagación (spread) en el cuerpo de una siguiente actualización.
Es `undefined` para una fila proveniente de `find()`, de la caché sin conexión o de un
servidor que no envíe ningún encabezado `ETag`; y pasar `undefined` no envía ninguna
precondición, por lo que la llamada anterior pasa a ser una actualización normal en lugar
de arrojar un error.

Una fila devuelta por `update()` incluye la versión que generó esa escritura, por lo que
las ediciones condicionales pueden encadenarse sin una lectura intermedia. La fila que
recibe un callback de `listenById()` contiene la versión que muestra ese cuadro (frame):

```typescript
import { etagOf } from "@rebasepro/client";

let shown: Record<string, unknown> | undefined;
client.data.posts.listenById(1, (post) => {
    shown = post; // etagOf(shown) is the version this frame shows
});

// On save: refused with 412 if the row has moved on since that frame
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(shown) });
```

Desde un navegador en otro origen (por ejemplo, un frontend Vite en su propio puerto o un
host `app.` llamando a un host `api.`), el `ETag` solo se puede leer porque el servidor
lo incluye en `Access-Control-Expose-Headers`. El runtime de Rebase lo hace, junto con
`Retry-After`, `X-Request-ID`, los encabezados `X-RateLimit-*` y `Preference-Applied`.
Un backend que configure su propio `cors()` debe exponer la misma lista, o de lo contrario
`etagOf` siempre será `undefined` allí y todas las escrituras condicionales se enviarán
sin condiciones.

### Omitir la respuesta

Cada escritura se resuelve devolviendo la fila que escribió. Pase `{ returning: false }`
cuando no la necesite:

```typescript
await client.data.events.create({ kind: "page_view" }, undefined, { returning: false });
```

Esto envía `Prefer: return=minimal`; el servidor responde `204` para una escritura individual
y únicamente con los IDs en el caso de un lote. El método se resuelve entonces como `undefined`
(o `[]`), lo que evita que utilice accidentalmente una fila que el servidor nunca envió.
Resulta muy útil en importaciones y escrituras de tipo "disparar y olvidar" (fire-and-forget);
el valor predeterminado es devolver la fila porque contiene lo que el *servidor* resolvió.

## Escrituras por lotes

Tres operaciones permiten escribir muchas filas en una **única petición y una única
transacción**. Cada fila sigue pasando por el pipeline habitual (hooks, relaciones,
seguridad a nivel de fila), por lo que un lote no es un atajo para saltarse sus propias
reglas; la ventaja radica en realizar un solo viaje de ida y vuelta y una única transacción
en lugar de N de cada uno.

Las tres son **todo o nada**. Si alguna fila es rechazada, ninguna de ellas se aplica y
el error identifica el índice que causó el fallo.

```typescript
// Create
await client.data.products.createMany([
    { name: "Widget", price: 9.99 },
    { name: "Gadget", price: 19.99 }
]);

// Update — each entry names its row and the fields to change
await client.data.orders.updateMany([
    { id: "o-1", data: { status: "shipped" } },
    { id: "o-2", data: { status: "shipped" } }
]);

// Delete — by id
await client.data.sessions.deleteMany(["s-1", "s-2"]);
```

### Cuántas sentencias componen un lote

En una tabla sin hooks `beforeSave`, `afterSave` ni `afterSaveError`, sin `history`
y sin `tenant`, un lote se traduce en un puñado de sentencias en lugar de una por fila:
`createMany` envía sentencias `INSERT … RETURNING` multifila (con `upsert`,
`INSERT … ON CONFLICT … DO UPDATE`), y `updateMany` envía una sentencia
`UPDATE … FROM (VALUES …) RETURNING` por cada serie de entradas que modifiquen los mismos
campos. Los valores por defecto declarados, las marcas `.onCreateNow()` / `.onUpdateNow()`,
`afterRead` y los eventos en tiempo real se aplican a cada fila igual que si se hiciera de
forma individual. Si la base de datos rechaza el lote, este se revierte y se repite fila
por fila para que el error identifique con precisión la entrada que falló. Una tabla que
declare alguno de esos hooks conserva el pipeline fila por fila, ya que cada hook se
ejecuta una vez por fila entre las escrituras de dicha fila.

Del mismo modo, un `update` individual no lee nada cuando nada necesita la fila
almacenada: el `UPDATE … RETURNING` actúa tanto de 404 para una fila inexistente como
de la propia fila devuelta. Un `delete` sin hooks, historial ni papelera a la que recurrir
tampoco realiza ninguna lectura.

### Cuántos viajes de ida y vuelta supone una escritura

Una escritura en dicha tabla representa un único viaje de ida y vuelta a la base de datos:
el `BEGIN` de la transacción, la identidad de quien llama, la sentencia y el `COMMIT` van
en un solo lote. Esto se aplica a `create`, `update`, `upsert`, `delete`, `updateWhere`,
`deleteWhere` y a un `createMany` escritos conjuntamente. Una sentencia rechazada por la
base de datos omite el `COMMIT` posterior, y la escritura se revierte como cualquier otra
operación fallida. Una escritura que ejecute un hook o registre historial envía su `COMMIT`
después de estos, en un segundo viaje de ida y vuelta.

### Por qué `{ id, data }` en lugar de filas planas

`createMany` recibe filas planas porque una fila que se está creando *es* en sí misma sus
columnas. `updateMany` especifica la dirección por separado, ya que en una tabla cuya clave
no sea `id` (un `sku`, una clave compuesta), una fila plana no puede determinar si una
columna es la dirección o un valor a escribir. Esto refleja exactamente el comportamiento
de un `update(id, data)` de una sola fila.

## Escribir mediante un filtro

`updateWhere` y `deleteWhere` escriben todas las filas que coincidan con un filtro en una
sola sentencia: `UPDATE … WHERE … RETURNING` y `DELETE … WHERE`. El filtro utiliza los
mismos parámetros `where` y `logical` que acepta `find()`:

```typescript
// Every expired session, gone; resolves to how many.
const removed = await client.data.sessions.deleteWhere({ where: { expiresAt: ["<", cutoff] } });

// Field operations work as on update(); resolves to the rows updated.
const bumped = await client.data.songs.updateWhere(
    { where: { "lower(artist)": ["in", ["abba", "queen"]] } },
    { plays: { $inc: 1 } }
);
```

Un filtro que no coincide con nada no produce un error (devuelve `[]` o `0`), lo que
también convierte a `deleteWhere` en la opción adecuada para eliminar una fila que podría
ya no existir, situación en la que `delete` respondería con un 404. Y dado que la sentencia
que escribe es la misma que comprueba el filtro, funciona como una operación compare-and-set:

```typescript
// Save only over the revision this client read; [] means somebody else saved first.
const [saved] = await client.data.saves.updateWhere(
    { where: { player: ["==", player], rev: ["==", rev] } },
    { body, rev: { $inc: 1 } }
);
```

Un filtro sin condiciones se rechaza con `FILTER_REQUIRED` en lugar de ejecutarse (ya que
afectaría a todas las filas), y un campo que no sea una columna se rechaza de la misma
manera que en una lectura, sin ignorarse jamás. Una actualización filtrada no puede
modificar una columna de clave.

En una tabla cuyas escrituras ejecuten tareas por cada fila (un hook de guardado o borrado,
historial, tenencia múltiple, un `beforeQuery`, borrado suave o acceso a nivel de campo),
las filas coincidentes se leen bajo el alcance de quien realiza la llamada y se escriben
una a una a través del pipeline completo, dentro de una sola transacción. Mediante HTTP,
estas son las rutas masivas que utilizan un filtro en lugar de IDs:
`PATCH /api/data/<slug>/bulk` con `{ where, logical, data }` y
`POST /api/data/<slug>/bulk/delete` con `{ where, logical }`. No están disponibles en la
tabla de autenticación, cuyas actualizaciones y eliminaciones se validan usuario por usuario
(`FILTERED_USER_WRITE`); especifique los usuarios mediante `updateMany`/`deleteMany`.

### Reintentos y duplicados

Un cliente que nunca llega a recibir la respuesta no puede saber si el lote llegó a
confirmarse (commit), por lo que reintenta la operación; y sin una clave, el servidor no
puede distinguir ese reintento de un segundo lote genuino. Envíe una clave de idempotencia
en cualquier operación susceptible de ser reenviada:

```typescript
const attemptKey = crypto.randomUUID();
await client.data.products.createMany(rows, { idempotencyKey: attemptKey });
```

Una clave identifica una sola petición, no un trabajo: se registra asociada al método, la
ruta y el cuerpo con el que fue enviada. Reenviar exactamente esa petición reproduce su
respuesta original; reutilizar la misma clave en una petición distinta se rechaza con
`IDEMPOTENCY_KEY_REUSED` (422). Por tanto, genere una por cada llamada en lugar de reutilizar
un identificador de negocio (un `importId` compartido entre el `createMany` y el
`deleteMany` de una importación provocaría que la eliminación se omitiera silenciosamente).

Un reintento que llega mientras el primer intento aún se está procesando recibe
`IDEMPOTENCY_KEY_IN_PROGRESS` (409): reenvíelo de nuevo y se responderá con el resultado
del primer intento una vez finalice. Las claves son válidas durante 24 horas y únicamente
para un emisor con sesión iniciada (de lo contrario, no existe una entidad a la que
asociar el ámbito).

La cola sin conexión asigna automáticamente una clave en cada reproducción.

### Límites

Los lotes están limitados en el servidor (1000 filas por defecto), ya que un lote retiene
sus bloqueos durante toda la transacción. Superar el límite genera un error `BULK_TOO_LARGE`
que especifica tanto el límite como el número de filas enviadas, por lo que conviene
fragmentarlo en bloques:

```typescript
for (const chunk of chunks(rows, 1000)) {
    await client.data.products.createMany(chunk, { upsert: true });
}
```

Un origen de datos incapaz de escribir de forma atómica responde con `BULK_UNSUPPORTED`
en lugar de realizar silenciosamente un bucle de escrituras individuales, lo cual no le
proporcionaría ni la atomicidad ni el viaje de ida y vuelta único que buscaba al recurrir a
un lote.

## Escribir entre tablas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`createMany` y sus variantes operan en una sola tabla a la vez. `client.batch()` es la
modalidad para múltiples tablas: una sola petición, una sola transacción, todo o nada.

```typescript
const result = await client.batch([
    { op: "create", table: "orders",
      values: { total: 40 }, ref: "order" },
    { op: "create", table: "orderItems",
      values: { orderId: { $ref: "order.id" }, sku: "A-1" } },
    { op: "update", table: "stock",
      id: "A-1", values: { count: { $inc: -1 } } },
    { op: "delete", table: "carts", id: "c-9" }
]);

result.data;  // [ order, item, stock, null ] — aligned to the operations
result.meta;  // { operations: 4 }
```

`op` puede ser `create`, `update`, `upsert` o `delete`, y `table` restringe `values` a
la estructura generada de `Insert` o `Update` de dicha tabla: indicar una columna que la
tabla no tenga generará un error de compilación, al igual que un create al que le falte
un campo obligatorio. `table` representa el descriptor de acceso, el nombre que adopta
`client.data.<accessor>` (`orderItems` para el slug `order_items`); el cliente envía el
slug a través del diccionario `tables` con el que fue creado. Cada operación ejecuta el
mismo pipeline que su equivalente de fila única: las mismas validaciones, hooks y
seguridad a nivel de fila, bajo el mismo usuario.

### `$ref`

Una operación puede asignarse un nombre mediante `ref`; una operación posterior puede
utilizar `{ $ref: "<name>.<field>" }` en cualquier lugar donde se admita un valor,
incluido como un `id` y a cualquier nivel de profundidad dentro de `values`. Esto se
resuelve con dicho campo de la fila que la operación nombrada escribió.

Esta es la razón por la que este método existe en lugar de un bucle sobre `createMany`: la
clave foránea del registro secundario no existe hasta que se inserta el registro principal,
por lo que ambos tendrían que ser peticiones independientes, y las peticiones independientes
pueden completarse a medias. Recuperarse de ello (leer el estado, determinar qué mitad se
ejecutó y revertirla) es un código que nadie desea escribir.

Solo se resuelven referencias hacia atrás. Una referencia hacia adelante se rechaza antes
de abrir la transacción, junto con tablas desconocidas, campos no reconocidos, operaciones
de campo no permitidas y objetivos de conflicto no válidos; de lo contrario, encontrar un
error en la operación 40 implicaría el coste de revertir las 39 escrituras anteriores.

### Límites y fallos

Aplica el mismo límite de 1000 operaciones que una escritura masiva, por la misma razón:
un lote mantiene sus bloqueos durante toda la transacción. Un `update` o `delete` que haga
referencia a una fila inexistente hace fallar todo el lote con un 404. Un backend cuyo
driver no pueda garantizar la atomicidad responde con `BATCH_UNSUPPORTED` en lugar de
ejecutar un bucle.

`idempotencyKey` y `returning` funcionan del mismo modo que en cualquier otra escritura.

En el lado del servidor, `rebase.dataAsAdmin.batch([...])` y `context.data.batch([...])`
aceptan las mismas operaciones y devuelven el mismo resultado, dentro de la propia
transacción de quien realiza la llamada. `batch` es una palabra reservada allí del mismo
modo que `table`: se accede a una tabla cuyo descriptor sea `batch` mediante
`data.table("batch")`.
