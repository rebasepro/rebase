---
sourceHash: a31d37ab40b701e5
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

Inserta la fila o reemplaza la que ya esté ocupando su clave:

```typescript
await client.data.users.upsert(
    { email: "ada@example.com", name: "Ada" },
    { onConflict: ["email"] }
);
```

Una sola sentencia en el servidor (`INSERT … ON CONFLICT DO UPDATE`), por lo que, a diferencia de
un `findById` seguido de `create` o `update`, no puede perder la condición de carrera
entre ambos, y a diferencia de `create`, no falla cuando la fila ya existe.

`onConflict` utiliza por defecto la clave primaria, que no es el destino adecuado para la mayoría
de las escrituras para las que se recurre a un upsert: con una clave basada en un id secuencial,
esto es una simple inserción, ya que quien llama no conoce el id; por lo tanto, una importación
reejecutable duplicará cada fila en la segunda ejecución. En su lugar, indica la clave natural.
Debe contar con una garantía de unicidad con la que la base de datos pueda coincidir: `validation: { unique:
true }` en la propiedad, o las columnas de un [índice](/docs/backend/indexes/) con `unique: true`;
cualquier otra cosa devolverá un error 400 listando los destinos que sí existen, en lugar de un error
generado desde el interior de una transacción.

La marca de tiempo `on_create` de una fila que ya existía no se modifica: un
conflicto significa que su creación es un hecho del pasado.

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

Mientras se está sin conexión (offline), se rechazan en lugar de encolarse: una operación se evalúa
contra un valor almacenado del cual el dispositivo no tiene una copia actualizada, y una fila
optimista solo podría mostrar el marcador en sí hasta que la cola se vaciase.

### Delete

```typescript
await client.data.products.delete(42);
```

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

### Por qué `{ id, data }` en lugar de filas planas

`createMany` toma filas planas porque una fila que se está creando *son* sus columnas.
`updateMany` especifica la dirección por separado, ya que en una tabla cuya clave sea
otra cosa diferente de `id` (un `sku`, una clave compuesta), una fila plana no puede indicar si
una columna es la dirección o un valor a escribir. Esto refleja con exactitud el comportamiento de
`update(id, data)` para una sola fila.

### Por qué `deleteMany` toma IDs y no un filtro

Una eliminación masiva basada en filtros es una operación diferente y mucho más peligrosa: el
modo de fallo es una condición omitida o mal escrita que vacía una tabla, y no
se puede revisar en el punto de llamada de la misma manera que una lista explícita. Lee primero y luego pasa
los IDs que deseabas:

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
await client.data.sessions.deleteMany(stale.map(s => s.id as string));
```

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
    { op: "create", collection: "order_items",
      values: { order_id: { $ref: "order.id" }, sku: "A-1" } },
    { op: "update", collection: "stock",
      id: "A-1", values: { count: { $inc: -1 } } },
    { op: "delete", collection: "carts", id: "c-9" }
]);

result.data;  // [ order, item, stock, null ] — aligned to the operations
result.meta;  // { operations: 4 }
```

`op` es `create`, `update`, `upsert` o `delete`, y `collection` restringe
`values` a la forma `Insert` o `Update` generada de esa colección. Cada
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

---
