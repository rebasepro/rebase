---
sourceHash: 9c622813c5a4eca9
title: Escritura a través de REST
sidebar_label: Escritura a través de REST
description: Claves de idempotencia, escrituras condicionales con ETag e If-Match, operaciones de campo, upserts sobre clave natural, return=minimal y lotes entre colecciones.
---

Los verbos se encuentran en la página de la [REST API](/docs/backend/api/). Esta sección trata sobre las cinco cosas que una escritura puede *solicitar* más allá de su verbo, y el endpoint que escribe a través de múltiples colecciones a la vez. Todas ellas son opcionales por petición: una escritura que no solicite nada de esto se comporta exactamente como siempre lo ha hecho.

## Escritura

Más allá de los verbos, las rutas de escritura admiten cinco elementos que cambian el comportamiento de una escritura. Los cinco son opcionales por petición, por lo que nada de lo aquí expuesto cambia lo que hace una petición que no los solicite.

### Idempotencia

`Idempotency-Key: <uuid>` en cualquier escritura significa «si ya has respondido a esta petición exacta, responde de nuevo en lugar de ejecutarla dos veces».

```bash
curl -X POST /api/data/orders \
     -H "Idempotency-Key: 1f0f…" \
     -d '{"total": 40}'
```

Un cliente que nunca recibe una respuesta no puede saber si la escritura se confirmó, por lo que reintenta — y sin una clave, el servidor no puede distinguir ese reintento de una segunda escritura genuina. En una tabla con un id asignado por el servidor, esto genera una fila duplicada, ya que el id inventado por el cliente nunca se utilizó.

Una clave identifica **una sola petición**: registra el método, la ruta y el cuerpo para los que fue solicitada. Si se vuelve a enviar esa petición exacta, su respuesta se reproduce; si se envía una diferente bajo la misma clave, se rechaza con `IDEMPOTENCY_KEY_REUSED` (422) en lugar de responder con el resultado de la primera. Un reintento que llega mientras la primera aún está en curso recibe `IDEMPOTENCY_KEY_IN_PROGRESS` (409) — envíela de nuevo una vez que la primera haya finalizado.

Se admite en `POST`, `PATCH`, `DELETE`, las tres rutas `/bulk` y `/_batch`. Las claves duran 24 horas y se limitan al emisor autenticado; una petición no autenticada no tiene una entidad principal a la que asociarla, por lo que el encabezado se ignora en ese caso. Un backend que no pueda almacenar claves ignora el encabezado en lugar de rechazar la escritura.

`DELETE` es el caso que vale la pena leer dos veces. Si se repite sin una clave, el segundo intento comprueba que la fila ya no existe y responde con `404` — lo cual un cliente que reintenta interpreta como un error permanente de una eliminación que en realidad tuvo éxito. Con una clave, reproduce el `204`.

### Concurrencia optimista: `ETag` e `If-Match`

`GET /api/data/:slug/:id` devuelve un `ETag`. Envíelo de vuelta como `If-Match` en un `PATCH` o `DELETE` posterior y la escritura se rechazará con `412` si la fila ha cambiado en el ínterin.

```bash
# read
curl -i /api/data/docs/d1
# → ETag: "9f2c…"

# write, conditionally
curl -X PATCH /api/data/docs/d1 \
     -H 'If-Match: "9f2c…"' \
     -d '{"title": "Second draft"}'
# → 412 PRECONDITION_FAILED if somebody else edited it first
```

Sin esto, lectura-modificación-escritura funciona como «gana el último» sobre todo lo que la segunda escritura no haya enviado: dos editores con un segundo de diferencia tienen éxito y el cambio del primero desaparece sin ningún error en ninguna parte.

La etiqueta se deriva de una propiedad `date` con `autoValue: "on_update"` cuando la colección declara una — esa columna ya *es* una versión — y de un hash estable de la fila en caso contrario. `If-Match: *` solo afirma que la fila existe. No se escribe nada si la precondición falla.

### Operaciones de campo

El valor de una propiedad en el cuerpo de un `PATCH` puede ser una operación sobre el valor almacenado en lugar de un valor estático:

```bash
curl -X PATCH /api/data/posts/p1 -d '{
  "views": { "$inc": 1 },
  "tags":  { "$push": "featured" },
  "meta":  { "$merge": { "seen": true } }
}'
```

| Operador | Tipo de propiedad | Se convierte en |
|----------|-------------------|-----------------|
| `$inc` | `number` | `SET col = COALESCE(col, 0) + n` |
| `$push` | `array` | `array_append(col, …)` o una concatenación jsonb |
| `$pull` | `array` | `array_remove(col, …)` o una reagregación jsonb |
| `$merge` | `map` | `col || '…'::jsonb` (una fusión **superficial**) |

El beneficio principal es la lectura que el emisor ya no necesita hacer. Expresar `views + 1` como un valor implica leerlo primero, y dos peticiones que lean `4`, sumen uno y escriban `5` terminarán con `5` — sin que ninguna de las dos respuestas indique que se perdió un incremento. Al compilarse dentro de la sentencia, la aritmética se ejecuta dentro del bloqueo de la fila y no puede perderse.

Exactamente un operador por campo. Un operador sobre un tipo de propiedad para el que no está definido, un `$operator` desconocido o un operando con un formato incorrecto resulta en un `400` (`INVALID_FIELD_OPERATION`) indicando el campo — un error tipográfico nunca se escribe en la columna como un documento JSON. Las operaciones se aplican únicamente a actualizaciones: en una fila que aún no existe no hay nada sobre lo que operar, por lo que se rechazan en `POST`, en creaciones `/bulk` y en upserts.

### Upsert sobre una clave natural

`POST /api/data/:slug?on_conflict=email` escribe `INSERT … ON CONFLICT (email) DO UPDATE` en lugar de una inserción simple. La ruta bulk admite el mismo objetivo como `onConflict` junto a `upsert: true`, al igual que cada operación `upsert` de un lote.

```bash
curl -X POST '/api/data/users?on_conflict=email' \
     -d '{"email": "ada@example.com", "name": "Ada"}'

curl -X POST /api/data/users/bulk -d '{
  "rows": [ … ],
  "upsert": true,
  "onConflict": ["tenant_id", "slug"]
}'
```

El objetivo debe contar con una garantía de unicidad con la que la base de datos pueda coincidir: la clave primaria (el valor por defecto si no se especifica ninguno), una propiedad con `validation: { unique: true }` o las columnas de un [índice](/docs/backend/indexes/) `unique: true`. Cualquier otra cosa produce un error `400` (`INVALID_CONFLICT_TARGET`) listando los objetivos que sí existen; de lo contrario, Postgres respondería *there is no unique or exclusion constraint matching the ON CONFLICT specification* desde el interior de una transacción que ya ha realizado operaciones.

Especificar un objetivo sin `upsert: true` en una escritura masiva también genera un `400`: ignorarlo silenciosamente transformaría una importación reejecutable en una que duplica registros.

Una fila que ya existía conserva su marca de tiempo `on_create`. Un conflicto implica que la creación de la fila es un hecho del pasado, y una reimportación nocturna que restableciera `createdAt` en todo lo que modificara alteraría por completo cualquier consulta de «nuevos esta semana».

### `Prefer: return=minimal`

Por defecto, cada escritura responde con la fila completa, que es la que contiene las decisiones tomadas por el servidor: un id serial, una marca `autoValue`, o lo que `beforeSave` haya reescrito. Envíe `Prefer: return=minimal` cuando no necesite nada de esto:

```bash
curl -X POST /api/data/events \
     -H "Prefer: return=minimal" \
     -d '{"kind": "page_view"}'
# → 204 No Content, Preference-Applied: return=minimal
```

Una escritura individual responde con `204`. Una escritura `/bulk` o `/_batch` responde con `200` devolviendo los **ids** en lugar de las filas — en una creación, el id es lo único que el emisor no puede calcular, por lo que descartarlo requeriría volver a leer la tabla mediante alguna clave natural para conocer lo que se acaba de escribir. Una clave de una sola columna se devuelve como un escalar; una clave compuesta, como un objeto con sus columnas.

## Lotes entre colecciones

`POST /api/data/_batch` escribe a través de colecciones en una única transacción, bajo el propio rol del emisor, con la misma validación, callbacks y seguridad a nivel de fila que aplicaría la ruta de una sola fila de cada operación.

```json
POST /api/data/_batch
{
  "operations": [
    { "op": "create", "collection": "orders",
      "values": { "total": 40 }, "ref": "order" },
    { "op": "create", "collection": "order_items",
      "values": { "order_id": { "$ref": "order.id" }, "sku": "A-1" } },
    { "op": "update", "collection": "stock",
      "id": "A-1", "values": { "count": { "$inc": -1 } } },
    { "op": "delete", "collection": "carts", "id": "c-9" }
  ]
}
```

```json
{
  "data": [ { "id": 31, "total": 40 }, { "id": 88, … }, { … }, null ],
  "meta": { "operations": 4 }
}
```

`op` es `create`, `update`, `upsert` o `delete`. `update` y `delete` requieren un `id`; `create`, `update` y `upsert` requieren `values`; `upsert` puede especificar un objetivo `onConflict` bajo los mismos términos descritos anteriormente. `data` está alineado con `operations` — la fila escrita para create, update o upsert, y `null` para delete —, de modo que un índice en uno corresponde al mismo índice en el otro.

### `$ref`: apuntar a una fila creada por el mismo lote

Una operación puede asignarse un identificador con `ref`, y cualquier operación posterior puede colocar `{ "$ref": "<name>.<field>" }` donde iría un valor — dentro de `values` a cualquier nivel de anidamiento, o como un `id`. Esto se resuelve al campo correspondiente de la fila que escribió la operación nombrada.

Esta es la razón por la que existe este endpoint en lugar de ser un bucle: la clave foránea de un elemento secundario no se puede conocer hasta que el elemento principal haya sido insertado, por lo que sin esto, el elemento principal y los secundarios tendrían que ser peticiones independientes — precisamente la secuencia que puede completarse a medias. Solo se resuelven las referencias hacia **atrás**; una referencia hacia adelante se rechaza antes de que se inicie la transacción.

### Qué se comprueba antes de escribir nada

La estructura, las colecciones desconocidas, los campos desconocidos, las restricciones de valores, las operaciones de campo, los objetivos de conflicto y la accesibilidad de `$ref` se determinan antes de que se inicie la transacción. Un lote es de tipo todo o nada, y encontrar un error tipográfico en la operación 40 costaría, de lo contrario, la reversión de las 39 escrituras anteriores.

Está limitado al mismo número de operaciones que una escritura masiva (1000 por defecto), ya que un lote mantiene sus bloqueos durante toda la transacción. Un controlador que no pueda hacer que el lote sea atómico responderá con `BATCH_UNSUPPORTED` en lugar de recurrir a un bucle de escrituras individuales — lo que no proporcionaría ni la atomicidad ni el único viaje de ida y vuelta por los que se recurre a un lote.

Un `update` o `delete` que haga referencia a una fila inexistente hace fallar a todo el lote con un `404`, por la misma razón por la que se rechaza una escritura parcial en cualquier otro lugar: el estado aplicado a medias es un estado sin una buena recuperación.

---
