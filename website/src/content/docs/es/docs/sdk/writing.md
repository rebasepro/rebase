---
sourceHash: 19c48df5377fcbee
title: Escritura de datos
sidebar_label: Escritura de datos
description: create, upsert, update y delete con el SDK — operaciones de campo, escrituras condicionales, claves de idempotencia, escrituras por lotes y escritura entre colecciones en una sola transacción.
---

Las lecturas se encuentran en [Consultar datos](/docs/sdk/querying/). Esta página es la otra mitad:
todo lo que modifica una fila.

Cada método aquí pasa por el mismo pipeline que cualquier otra
escritura: [callbacks](/docs/collections/callbacks/),
[relaciones](/docs/collections/relations/) y
[seguridad a nivel de fila](/docs/collections/security-rules/) siguen aplicándose. Nada
de esto es un atajo que eluda tus propias reglas; lo que estas opciones ofrecen
es ahorrarse un viaje de ida y vuelta (round trip), una transacción o una condición
de carrera que ya no tendrás que perder.

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

Inserta la fila o actualiza la que ya esté ocupando su clave:

```typescript
await client.data.products.upsert(
    { sku: "LAMP-01", name: "Desk lamp", price: 39 },
    { onConflict: ["sku"] }
);
```

El servidor decide cuál de las dos dentro de una transacción, y recurre a
`INSERT … ON CONFLICT DO UPDATE`, por lo que, a diferencia de un `findById` seguido de
`create` o `update`, no puede perder la condición de carrera entre ambos, y a diferencia de
`create`, no falla cuando la fila ya existe.

Cuando la fila existe, el upsert es una actualización de ella. Los campos que envías se
escriben y los que omites conservan sus valores almacenados: no se restablecen a su
`defaultValue`. `beforeSave` y `afterSave` ven `status: "existing"` con los valores
anteriores, y el historial registra una actualización. Una clave que nombra una fila fuera
del ámbito `beforeQuery` de quien llama es un 404.

`onConflict` utiliza por defecto la clave primaria, que no es el destino adecuado para la mayoría
de las escrituras para las que se recurre a un upsert: con una clave basada en un id secuencial,
esto es una simple inserción, ya que quien llama no conoce el id; por lo tanto, una importación
reejecutable duplicará cada fila en la segunda ejecución. En su lugar, indica la clave natural.
Debe contar con una garantía de unicidad con la que la base de datos pueda coincidir: `validation: { unique:
true }` en la propiedad, o las columnas de un [índice](/docs/backend/indexes/) con `unique: true`;
cualquier otra cosa devolverá un error 400 listando los destinos que sí existen, en lugar de un error
generado desde el interior de una transacción.

La marca de tiempo `on_create` y el creador `user_on_create` de una fila que ya existía no se
modifican: un conflicto significa que su creación es un hecho del pasado.

#### Conservar la fila almacenada: `where` e `ignoreDuplicates`

`where` reemplaza la fila almacenada solo cuando coincide: un filtro sobre las
columnas de la fila almacenada, escrito como lo escribe un `find()`.
`ignoreDuplicates` nunca la reemplaza. En ambos casos la llamada se resuelve en
`undefined` cuando la fila almacenada se dejó como estaba, y la comprobación es
la de la propia sentencia (`ON CONFLICT … DO UPDATE … WHERE`,
`ON CONFLICT DO NOTHING`), de modo que ninguna otra escritura puede colarse entre
una lectura y la decisión:

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
hacen lo mismo por fila y responden solo con las filas que escribieron. Ambos
necesitan `upsert`, y los dos no se pueden combinar (`INVALID_CONFLICT_RULE`).

#### No en la colección de usuarios

`upsert()` en la colección de usuarios (la que tiene `auth` activado) se rechaza con un 400 (`INVALID_CONFLICT_TARGET`), igual que `createMany` con `upsert` en ella. Crear un usuario y modificarlo siguen reglas distintas — una creación cifra la contraseña con hash y envía la invitación, una actualización no puede degradar al último administrador — y un upsert solo sabe cuál de las dos es dentro de la escritura. Llame a `create` o a `update` en su lugar.

### Update

```typescript
const updated = await client.data.products.update(42, {
    name: "Updated Name",
    price: 39.99
});
```

#### Operaciones de campo

En su lugar, un valor puede ser una operación sobre el valor *almacenado*:

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
| `$push` | `array` | añadir un valor, o cada uno de los valores de un array |
| `$pull` | `array` | eliminar cada aparición de un valor |
| `$merge` | `map` | fusionar superficialmente (shallow-merge) un objeto |

La razón para utilizarlas es la lectura que ya no necesitas hacer y la condición de carrera
que dicha lectura provocaría. `views = current + 1` implica obtener `current` primero, y dos
solicitudes que lean `4` escribirán ambas `5`: se pierde un incremento y ninguna
de las respuestas lo indica. Al compilarse dentro de la sentencia, la operación aritmética ocurre
dentro del bloqueo de la fila.

Exactamente un operador por campo, y solo en una actualización (`update`): sobre una fila que aún no
existe no hay nada sobre lo que operar, por lo que una operación en un `create`,
`createMany` o `upsert` devolverá un error 400. Un operador sobre el tipo de propiedad incorrecto o un
`$operator` mal escrito devolverá un 400 indicando el campo; nunca se escribirá un documento JSON
en la columna.

Una operación responde a la `validation` de la propiedad igual que un valor, y eso incluye el valor que produce. `{ stock: { $inc: -1 } }` sobre un `stock` con `validation: { min: 0 }` tiene éxito mientras el stock sea al menos 1 y se rechaza en 0 con el mismo 400 (`VALIDATION_CONSTRAINT`) que recibe `{ stock: -1 }`. Lo mismo vale para `max`, `moreThan`, `lessThan`, `positive` y `negative`, y para el mínimo y máximo de elementos (`min`, `max`) de un array tras un `$push` o un `$pull`. La comprobación forma parte de la sentencia de actualización, así que dos decrementos concurrentes de un stock de 1 no pueden tener éxito ambos, y una actualización rechazada no escribe nada.

Mientras se está sin conexión (offline), se rechazan en lugar de encolarse: una operación se evalúa
contra un valor almacenado del cual el dispositivo no tiene una copia actualizada, y una fila
optimista solo podría mostrar el marcador en sí hasta que la cola se vaciase.

### Delete

```typescript
await client.data.products.delete(42);
```

En una colección con [borrado lógico](/docs/collections/soft-delete) esto marca la
fila en lugar de eliminarla. `client.data.products.trash` lista, cuenta, restaura
y purga las filas marcadas.

### Escrituras condicionales

`update` y `delete` aceptan un `ifMatch`, de modo que la escritura se rechaza si la fila ha
cambiado desde que la leíste:

```typescript
import { etagOf } from "@rebasepro/client";

const post = await client.data.posts.get(1);
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(post) });
// → RebaseApiError, status 412, if somebody edited it in between
```

Sin esto, el patrón leer-modificar-escribir aplica la regla de que el último en escribir gana sobre todo lo que no
enviaste: dos editores con un segundo de diferencia tienen éxito, y el cambio del primero
desaparece sin ningún error en ninguna parte.

`etagOf(row)` lee la versión de una fila obtenida mediante `findById`/`get`.
Reside en una clave no enumerable, por lo que nunca entra en el tipo `Row` generado, en un
`JSON.stringify` ni en una propagación (spread) en el cuerpo de la siguiente actualización. Es `undefined` para
una fila proveniente de `find()`, de la caché offline o de un servidor que no envíe ningún
`ETag`; y pasar `undefined` no envía ninguna precondición, por lo que la llamada anterior
se degrada a una actualización ordinaria en lugar de lanzar un error.

Una fila devuelta por `update()` lleva la versión que produjo esa escritura, de modo que
las ediciones condicionales se encadenan sin una lectura intermedia. Una fila que recibe un callback de `listenById()`
lleva la versión que muestra ese frame:

```typescript
import { etagOf } from "@rebasepro/client";

let shown: Record<string, unknown> | undefined;
client.data.posts.listenById(1, (post) => {
    shown = post; // etagOf(shown) is the version this frame shows
});

// On save: refused with 412 if the row has moved on since that frame
await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(shown) });
```

Desde un navegador en otro origen — un frontend de Vite en su propio puerto,
un host `app.` que llama a un host `api.` — el `ETag` solo es legible porque
el servidor lo nombra en `Access-Control-Expose-Headers`. El runtime de Rebase
lo hace, junto con `Retry-After`, `X-Request-ID`, las cabeceras
`X-RateLimit-*` y `Preference-Applied`. Un backend que conecta su propio
`cors()` tiene que exponer la misma lista, o `etagOf` es siempre `undefined`
ahí y toda escritura condicional sale sin condición.

### Omitir la respuesta

Cada escritura se resuelve con la fila que escribió. Pasa `{ returning: false }` cuando
no la necesites:

```typescript
await client.data.events.create({ kind: "page_view" }, undefined, { returning: false });
```

Esto envía `Prefer: return=minimal`; el servidor responde con `204` para una sola escritura
y solo con los IDs para un lote. El método se resuelve entonces como `undefined` (o `[]`),
por lo que no puedes usar accidentalmente una fila que el servidor nunca envió. Vale la pena
en importaciones y escrituras de tipo «dispara y olvida» (fire-and-forget); el valor predeterminado
es la fila porque contiene lo que el *servidor* determinó.

## Escrituras por lotes

Tres operaciones escriben muchas filas en una **única solicitud y una sola
transacción**. Cada fila sigue ejecutando el pipeline habitual (callbacks, relaciones,
seguridad a nivel de fila), por lo que un lote no es un atajo que eluda tus propias reglas;
la ventaja es un solo round trip y una sola transacción en lugar de N de cada uno.

Las tres son de tipo **todo o nada**. Si alguna fila es rechazada, ninguna se aplica y
el error indica el índice infractor.

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

### Cuántas sentencias es un lote

En una colección sin hooks `beforeSave`, `afterSave` ni `afterSaveError`,
sin `history` y sin `tenant`, un lote son un puñado de sentencias y no una
por fila: `createMany` envía sentencias `INSERT … RETURNING` de varias filas (con
`upsert`, `INSERT … ON CONFLICT … DO UPDATE`), y `updateMany` un
`UPDATE … FROM (VALUES …) RETURNING` por cada serie de entradas que establecen los mismos
campos. Los valores predeterminados declarados, los sellos `autoValue`, `afterRead` y los eventos
en tiempo real se aplican a cada fila igual que cuando se escriben una a una. Si la base de datos rechaza el
lote, se deshace y se repite fila por fila, de modo que el error siga nombrando la entrada
que falló. Una colección que declara uno de esos hooks mantiene el pipeline
fila por fila, porque cada hook se ejecuta una vez por fila entre las escrituras de esa fila.

Un `update` individual tampoco lee nada cuando nada necesita la fila almacenada:
el `UPDATE … RETURNING` es a la vez el 404 de una fila inexistente y la fila con
la que responde. Un `delete` sin hook, historial ni papelera que atender tampoco
lee nada.

### Cuántos round trips es una escritura

Una escritura en una colección así es un solo round trip a la base de datos: el
`BEGIN` de la transacción, la identidad de quien llama, la sentencia y el
`COMMIT` van en un mismo lote. Eso vale para `create`, `update`, `upsert`,
`delete`, `updateWhere`, `deleteWhere` y un `createMany` escrito de una vez. Una
sentencia que la base de datos rechaza omite el `COMMIT` que la sigue, y la
escritura se deshace como cualquier otra que falla. Una escritura que ejecuta un
hook o registra historial envía su `COMMIT` después de ellos, en un segundo round
trip.

### Por qué `{ id, data }` en lugar de filas planas

`createMany` toma filas planas porque una fila que se está creando *son* sus columnas.
`updateMany` especifica la dirección por separado, ya que en una tabla cuya clave sea
otra cosa diferente de `id` (un `sku`, una clave compuesta), una fila plana no puede indicar si
una columna es la dirección o un valor a escribir. Esto refleja con exactitud el comportamiento de
`update(id, data)` para una sola fila.

## Escritura por filtro

`updateWhere` y `deleteWhere` escriben todas las filas con las que coincide un filtro, en
una sola sentencia: `UPDATE … WHERE … RETURNING` y `DELETE … WHERE`. El filtro es
el `where` y el `logical` que acepta un `find()`:

```typescript
// Every expired session, gone; resolves to how many.
const removed = await client.data.sessions.deleteWhere({ where: { expiresAt: ["<", cutoff] } });

// Field operations work as on update(); resolves to the rows updated.
const bumped = await client.data.songs.updateWhere(
    { where: { "lower(artist)": ["in", ["abba", "queen"]] } },
    { plays: { $inc: 1 } }
);
```

Un filtro que no coincide con nada no es un error — `[]` o `0` — lo que también
hace de `deleteWhere` el delete para una fila que puede que ya no exista, donde
`delete` responde 404. Y como la sentencia que escribe es la que comprueba el
filtro, es un compare-and-set:

```typescript
// Save only over the revision this client read; [] means somebody else saved first.
const [saved] = await client.data.saves.updateWhere(
    { where: { player: ["==", player], rev: ["==", rev] } },
    { body, rev: { $inc: 1 } }
);
```

Un filtro sin ninguna condición se rechaza con `FILTER_REQUIRED` en lugar de
ejecutarse —abarcaría todas las filas—, y un campo que no es una columna se
rechaza como en una lectura, nunca se descarta. Un update con filtro no puede
asignar una columna clave.

En una colección cuyas escrituras ejecutan trabajo por fila —un hook de guardado
o de borrado, historial, tenancy, un `beforeQuery`, borrado lógico, acceso por
campo— las filas coincidentes se leen con el ámbito de quien llama y se escriben
una a una a través del pipeline completo, en una sola transacción. Por HTTP son
las rutas masivas con un filtro en lugar de ids: `PATCH /api/data/<slug>/bulk` con
`{ where, logical, data }` y `POST /api/data/<slug>/bulk/delete` con
`{ where, logical }`. No están disponibles en la colección de usuarios, cuyos
updates y deletes se comprueban usuario por usuario (`FILTERED_USER_WRITE`);
nombra a los usuarios con `updateMany`/`deleteMany`.

### Reintentos y duplicados

Un cliente que nunca ve la respuesta no puede saber si el lote se confirmó,
por lo que reintenta; y sin una clave, el servidor no puede distinguir ese reintento de
un segundo lote legítimo. Pasa una clave de idempotencia en cualquier cosa que pueda ser reenviada:

```typescript
const attemptKey = crypto.randomUUID();
await client.data.products.createMany(rows, { idempotencyKey: attemptKey });
```

Una clave identifica una solicitud, no un trabajo: se registra asociada al método, la ruta
y el cuerpo con los que se envió. Reenviar esa solicitud exacta reproduce su respuesta;
la misma clave en una solicitud diferente se rechaza con `IDEMPOTENCY_KEY_REUSED`
(422). Por tanto, genera una por llamada en lugar de reutilizar un ID de negocio: un `importId`
compartido por el `createMany` y el `deleteMany` de una misma importación dejaría la
eliminación silenciosamente sin ejecutar.

Un reintento que llega mientras el primer intento todavía se está procesando recibe
`IDEMPOTENCY_KEY_IN_PROGRESS` (409): envíalo de nuevo y se responderá con el
resultado del primer intento una vez que este finalice. Las claves se respetan durante 24 horas y
solo para un emisor autenticado; de lo contrario, no hay un principal al que asociarla.

La cola offline establece una clave automáticamente en cada reproducción.

### Límites

Los lotes están limitados en el servidor (1000 filas por defecto), ya que un lote mantiene
sus bloqueos durante toda la transacción. Superar este límite produce un error `BULK_TOO_LARGE`
que indica tanto el límite como tu recuento de filas, así que divídelo en fragmentos:

```typescript
for (const chunk of chunks(rows, 1000)) {
    await client.data.products.createMany(chunk, { upsert: true });
}
```

Una fuente de datos que no puede escribir de forma atómica reporta `BULK_UNSUPPORTED` en lugar
de ejecutar escrituras individuales en bucle de forma silenciosa, lo cual no te daría ni la atomicidad
ni el único round trip que buscabas al usar un lote.

## Escritura entre colecciones

`createMany` y sus variantes operan en una colección a la vez. `client.batch()` es la
variante entre colecciones: una solicitud, una transacción, todo o nada.

```typescript
const result = await client.batch([
    { op: "create", collection: "orders",
      values: { total: 40 }, ref: "order" },
    { op: "create", collection: "orderItems",
      values: { orderId: { $ref: "order.id" }, sku: "A-1" } },
    { op: "update", collection: "stock",
      id: "A-1", values: { count: { $inc: -1 } } },
    { op: "delete", collection: "carts", id: "c-9" }
]);

result.data;  // [ order, item, stock, null ] — aligned to the operations
result.meta;  // { operations: 4 }
```

`op` es `create`, `update`, `upsert` o `delete`, y `collection` restringe
`values` a la forma `Insert` o `Update` generada de esa colección — una
columna que la colección no tiene es un error de compilación, y también lo es
un create al que le falta una obligatoria. `collection` es el accesor, el
nombre que toma `client.data.<accessor>` (`orderItems` para el slug
`order_items`); el cliente envía el slug, a través del diccionario
`collections` con el que se creó. Cada
operación ejecuta el pipeline que ejecutaría su equivalente de una sola fila:
la misma validación, callbacks y seguridad a nivel de fila, con el mismo usuario.

### `$ref`

Una operación puede nombrarse a sí misma con `ref`; una posterior puede colocar
`{ $ref: "<name>.<field>" }` en cualquier lugar donde vaya un valor, incluso como `id` y
a cualquier nivel de profundidad dentro de `values`. Se resuelve en ese campo de la fila que
la operación nombrada escribió.

Esta es la razón por la que existe este método en lugar de un bucle sobre `createMany`: la
clave foránea del hijo no existe hasta que se inserta el padre, por lo que ambas tendrían
que ser solicitudes independientes; y las solicitudes independientes pueden tener un éxito parcial.
La recuperación de eso (volver a leer, averiguar qué mitad se guardó y deshacerla) es código
que nadie escribe.

Solo se resuelven referencias hacia atrás. Una referencia hacia adelante se rechaza antes de que
se abra la transacción, junto con colecciones desconocidas, campos desconocidos,
operaciones de campo no válidas y destinos de conflicto no aptos; de lo contrario,
encontrar un error en la operación 40 implicaría el costo de revertir las 39 escrituras anteriores.

### Límites y fallos

El mismo límite de 1000 operaciones que una escritura masiva, por la misma razón: un lote
mantiene sus bloqueos durante toda la transacción. Un `update` o `delete` que especifique una fila
que no existe hace fallar todo el lote con un 404. Un backend cuyo controlador no
pueda hacerlo atómico responde con `BATCH_UNSUPPORTED` en lugar de ejecutar un bucle.

`idempotencyKey` y `returning` funcionan exactamente igual que en cualquier otra escritura.

En el servidor, `rebase.dataAsAdmin.batch([...])` y `context.data.batch([...])`
aceptan las mismas operaciones y responden con el mismo resultado, dentro de la
transacción de quien llama. `batch` está reservado ahí igual que `collection`: una
colección cuyo accessor es `batch` se alcanza con `data.collection("batch")`.
