---
sourceHash: b1b5ef4227e130d2
title: Escritura a través de REST
sidebar_label: Escritura a través de REST
description: Claves de idempotencia, escrituras condicionales con ETag e If-Match, operaciones de campo, upserts sobre una clave natural, return=minimal y lotes entre tablas.
---

Los verbos se encuentran en la página de la [API REST](/docs/backend/api/). Esta trata sobre las
cinco cosas que una escritura puede *solicitar* más allá de su verbo, y el endpoint que escribe
en varias tablas a la vez. Todas ellas son opcionales por solicitud (opt-in): una escritura que
no solicite nada de esto se comporta exactamente como siempre lo ha hecho.

## Escritura

Más allá de los verbos, las rutas de escritura admiten cinco elementos que modifican el comportamiento
de una escritura. Los cinco son opcionales por solicitud, por lo que nada de lo aquí expuesto cambia
lo que hace una solicitud que no los pide. Las rutas anidadas
(`/api/data/authors/42/posts`) ejecutan el mismo código de escritura que las rutas raíz, por lo
que todo lo indicado en esta sección también se aplica a ellas, excepto `?on_conflict=`.

El cuerpo de una escritura debe ser un objeto JSON. Un valor `null`, un número, una cadena o un array resulta
en un `400 BAD_REQUEST`.

<span class="since-badge" data-since="0.31">Desde 0.31</span> Una escritura acepta los valores documentados en la API REST y nada más — la
misma forma que devuelve una lectura: una relación a-uno (`belongsTo`, `hasOne`, un `via` a-uno)
como la clave de la fila relacionada o `null`, una relación a-muchos como una lista de claves
o de objetos `{ id, _pivot? }`, una fecha como texto ISO, un vector como una lista de números,
un geopunto como `{ latitude, longitude }`, un `bytea` como una
URL `data:application/octet-stream;base64,`. Una relación a-uno escrita como un
objeto (`{ "author": { "id": 5 } }`) devuelve un `400 VALIDATION_INVALID_VALUE`
("'posts.author' links one 'authors' row: write that row's key …"), al igual que un
vector escrito como `{ "value": [...] }`. En el proceso, `rebase.data` también admite un
`Date` y un `Buffer` / `Uint8Array`.

Escribir una relación `hasMany` o `hasOne` desde el padre (`{ "replies": [1, 2] }`
en un hilo) establece la clave foránea en las filas secundarias, por lo que queda sujeta a las
reglas de dicha clave: una columna de clave que sea `.readOnly()`, `.private()` o esté restringida por
`access.write` la rechazará (`400 VALIDATION_EXCLUDED_FIELDS` /
`FIELD_NOT_WRITABLE`, "Writing 'replies' on 'threads' sets 'threadId' on the
rows of 'replies'"), al igual que lo hace una escritura de la clave en la fila secundaria.

Una actualización no puede cambiar la clave de una fila. Un cuerpo que indique la clave con otro
valor resulta en un `400 KEY_IMMUTABLE`, antes de que se ejecute cualquier hook y sin escribir nada,
independientemente de cómo llegue la actualización: REST, el socket en tiempo real, MCP o el
`rebase.data` dentro del proceso. La clave que la fila ya tiene sí se acepta, tal como la envía un formulario
que devuelve la fila completa. Para mover una fila a una nueva clave, créela
allí y elimine la antigua.

### Idempotencia

`Idempotency-Key: <uuid>` en cualquier escritura significa "si ya has respondido a esta
solicitud exacta, vuelve a responderla en lugar de ejecutarla dos veces".

```bash
curl -X POST /api/data/orders \
     -H "Idempotency-Key: 1f0f…" \
     -d '{"total": 40}'
```

Un cliente que nunca llega a ver una respuesta no puede saber si la escritura se confirmó, por
lo que reintenta — y sin una clave, el servidor no puede distinguir ese reintento de una segunda
escritura auténtica. En una tabla con un id asignado por el servidor, esto generaría una fila duplicada,
ya que el id que inventó el cliente nunca llegó a utilizarse.

Una clave identifica **una única solicitud**: registra el método, la ruta, la query string
y el cuerpo para los que fue solicitada. Vuelva a enviar esa solicitud exacta y se reproducirá su respuesta; envíe una
diferente bajo la misma clave y será rechazada con `IDEMPOTENCY_KEY_REUSED`
(422) en lugar de responder con el resultado de la primera. Un reintento que llega
mientras la primera todavía está en curso recibe `IDEMPOTENCY_KEY_IN_PROGRESS` (409) —
envíelo de nuevo una vez que la primera haya finalizado. La query string cuenta porque
cambia lo que hace una solicitud: `DELETE /api/data/posts/5?hard=true` bajo la clave de un
borrado lógico anterior es una solicitud diferente, no una repetición. El orden de sus
parámetros no importa.

Se respeta en `POST`, `PATCH`, `DELETE`, en las tres rutas `/bulk` y en `/_batch`.
Las claves duran 24 horas y están limitadas al ámbito del emisor autenticado; una
solicitud no autenticada no tiene una identidad a la cual asociarla, por lo que el encabezado se
ignora en ese caso. Un backend que no pueda almacenar claves ignora el encabezado en lugar de
rechazar la escritura.

`DELETE` es el caso que merece una segunda lectura. Si se reintenta sin una clave, el segundo
intento comprueba que la fila ya no existe y responde con `404` — lo cual un cliente que reintenta interpreta como
un fallo definitivo para una eliminación que en realidad tuvo éxito. Con una clave, reproduce
el `204`.

### Concurrencia optimista: `ETag` e `If-Match`

`GET /api/data/:slug/:id` devuelve un `ETag`, y también lo hace el `GET` anidado
de una sola fila. Reenvíelo como `If-Match` en un `PATCH` o `DELETE` posterior y la escritura se
rechazará con `412` si la fila ha cambiado en el ínterin.

Un `PATCH` exitoso responde con el `ETag` de la versión que escribió,
por lo que la siguiente escritura condicional no necesita una lectura previa. La etiqueta también viaja en un
`204` devuelto para `Prefer: return=minimal`, y una respuesta reproducida por una
`Idempotency-Key` lleva la misma etiqueta que la primera. Una suscripción a filas en vivo
lleva la misma etiqueta en cada frame (consulte [Tiempo real](/docs/backend/realtime/)).

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

Sin esto, la secuencia lectura-modificación-escritura funciona como "el último gana" sobre todo lo que la segunda
escritura no haya enviado: dos editores con un segundo de diferencia tienen éxito ambos y el cambio del primero
desaparece sin ningún error en ningún sitio.

La etiqueta se obtiene de una columna de marca de tiempo con `.onUpdateNow()` cuando la
tabla la declara —esa columna ya *es* una versión— y de un hash estable
de la fila en caso contrario. `If-Match: *` solo asegura que la fila exista.
No se escribe nada cuando la condición previa falla.

El formulario de registros del panel de administración guarda con `If-Match`: si se intenta guardar sobre una versión
que alguien ha reemplazado entretanto, se rechaza, el formulario lo indica y la edición permanece en
el formulario, rebasada sobre la nueva versión con los campos en conflicto señalados.

La etiqueta se compara dentro de la propia transacción de la escritura, una vez bloqueada la
fila. Dos escrituras con la misma etiqueta no pueden prosperar al mismo tiempo: la segunda espera a que
la primera haga commit, lee lo que escribió y se rechaza con `412`.

### Operaciones de campo

El valor de una propiedad en el cuerpo de un `PATCH` puede ser una operación sobre el valor almacenado
en lugar de un valor:

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
| `$push` | `array` | `array_append(col, …)`, o una concatenación jsonb |
| `$pull` | `array` | `array_remove(col, …)`, o una reagregación jsonb |
| `$merge` | `map` | `col || '…'::jsonb` (una fusión **superficial**) |

La clave está en la lectura que el emisor ya no necesita hacer. Expresar `views + 1` como un
valor implica leerlo primero, y dos solicitudes que lean `4` cada una, sumen uno y
escriban `5` terminarán en `5` — sin que ninguna respuesta indique que se perdió un
incremento. Compilada en la propia sentencia, la operación aritmética ocurre dentro del bloqueo de la fila
y no puede perderse.

Exactamente un operador por campo. Un operador sobre un tipo de propiedad para el que no está definido,
un `$operator` desconocido o un operando con una estructura incorrecta resulta en un `400`
(`INVALID_FIELD_OPERATION`) indicando el campo — un error tipográfico nunca se escribe en
la columna como un documento JSON.

Un `map` es la excepción, ya que su valor *es* un documento JSON y puede contener
claves `$` propias —el `$schema` y `$id` de un JSON Schema, un documento exportado desde otra base de datos. En un
`map`, solo un objeto con exactamente una clave que sea uno de los operadores anteriores se considera
una operación; cualquier otro objeto se almacena tal como se envía, incluyendo las claves `$`. Por lo tanto,
`{ "meta": { "$merge": { … } } }` realiza la fusión, y
`{ "meta": { "$schema": "https://json-schema.org/draft/2020-12/schema" } }` se
almacena. En consecuencia, un operador mal escrito en un `map` también se almacena; en cualquier otro
tipo sigue siendo rechazado. El cliente sin conexión no tiene un esquema para distinguir un `map` de
otra cosa, por lo que mientras esté sin conexión rechazará dicho valor como una operación de campo;
envíelo una vez restablecida la conexión.

Las operaciones se aplican únicamente a las actualizaciones: sobre una fila que
aún no existe no hay nada sobre lo que operar, por lo que se rechazan en
`POST`, en creaciones `/bulk` y en upserts.

Una operación responde a la `validation` de la propiedad al igual que lo hace un valor. Los elementos
añadidos con push se evalúan según las reglas de los elementos, las claves fusionadas según las propiedades del mapa,
y el valor que una operación *produce*, según los límites declarados: `min`,
`max`, `moreThan`, `lessThan`, `positive` y `negative` de un número, `min` y
`max` elementos de un array. Esta última comprobación es una condición en el mismo `UPDATE`, no una lectura
previa. En `stock: { validation: { min: 0 } }`, `{ "stock": { "$inc": -1 } }`
tiene éxito mientras el stock sea de al menos 1 y se rechaza en 0 con el `400`
(`VALIDATION_CONSTRAINT`) que recibiría `{ "stock": -1 }`, indicando el campo y el
límite. Dos decrementos concurrentes de un stock de 1 no pueden tener éxito a la vez, ya que
el segundo se evalúa frente a la fila confirmada por el primero. Un número no definido cuenta
como `0` y un array no definido como vacío. Una operación rechazada no escribe nada, ni siquiera
los valores normales que la acompañan en el cuerpo. Dado que la comprobación forma parte de la
sentencia, también se mantiene para las escrituras en proceso mediante `rebase.data`, las cuales omiten
la validación a nivel de solicitud.

### Upsert sobre una clave natural

`POST /api/data/:slug?on_conflict=sku` inserta la fila, o actualiza la que
ya contiene ese SKU, en lugar de fallar por el conflicto. La ruta bulk admite
el mismo objetivo como `onConflict` junto a `upsert: true`, y lo mismo ocurre con cada operación
`upsert` de un lote.

```bash
curl -X POST '/api/data/products?on_conflict=sku' \
     -d '{"sku": "LAMP-01", "name": "Desk lamp", "price": 39}'

curl -X POST /api/data/products/bulk -d '{
  "rows": [ … ],
  "upsert": true,
  "onConflict": ["tenant_id", "sku"]
}'
```

El objetivo debe contar con una garantía de unicidad que la base de datos pueda cotejar: la
clave primaria (el valor por defecto cuando no se especifica ninguna), una columna declarada como
`.unique()`, o las columnas de un [índice](/docs/backend/indexes/) con `unique: true`.
Cualquier otra cosa resulta en un `400` (`INVALID_CONFLICT_TARGET`) que enumera los objetivos
que sí existen — de lo contrario, Postgres respondería *there is no unique or exclusion constraint matching the ON CONFLICT specification* desde dentro de una transacción que ya ha realizado operaciones.

Especificar un objetivo sin `upsert: true` en una escritura bulk también es un `400`: ignorarlo
silenciosamente convertiría una importación reejecutable en una que duplica datos.

`?on_conflict=` se rechaza en una creación anidada (`INVALID_CONFLICT_TARGET`). La
fila con la que coincidió podría pertenecer a otro registro padre, y el upsert la movería
bajo este. Envíe el upsert a la ruta propia de la tabla.

Un upsert que coincide con una fila almacenada se convierte en una actualización de la misma. El servidor lee la fila
que indica la clave, dentro del ámbito del emisor y dentro de la transacción de la escritura, y
ejecuta la actualización ordinaria: se escriben los campos presentes en el cuerpo, los omitidos
conservan sus valores almacenados en lugar de restablecerse a su `.default()`,
`beforeSave` y `afterSave` reciben `status: "existing"` con los valores anteriores,
y el historial registra una actualización. Una fila que la lectura no pudo ver, o una insertada
de forma concurrente, sigue siendo capturada por `ON CONFLICT … DO UPDATE`, que establece únicamente lo que
el cuerpo y los hooks escribieron, junto con las marcas de `.onUpdateNow()`. Una clave que apunte a una fila
fuera del ámbito de `beforeQuery` del emisor responde con `404`. Una clave que pertenezca a una
fila en la [papelera](/docs/collections/soft-delete/) responde con `409 ROW_IN_TRASH`
y no escribe nada: restaure la fila primero o púrguela.

Una fila que ya existía conserva su marca de tiempo `.onCreateNow()` y su
creador `.onCreateUser()`. Un conflicto significa que la creación de la fila es un hecho del
pasado, y una reimportación nocturna que restableciera `createdAt` en todo lo que toque
arruinaría cualquier consulta de "nuevo esta semana".

#### No en la tabla de autenticación

<span class="since-badge" data-since="0.31">Desde 0.31</span>

La tabla de autenticación (la declarada con `defineAuthTable`) rechaza un upsert por cualquier
vía — `?on_conflict=`, `/bulk` con `upsert: true`, una operación `upsert` en `_batch`,
el `upsert()` del SDK y el socket en tiempo real — con un `400`
(`INVALID_CONFLICT_TARGET`). Sus filas son los usuarios, y crear uno o
modificarlo siguen reglas diferentes: una creación calcula el hash de la contraseña, normaliza
el correo electrónico, ejecuta `onCreateUser` y envía la invitación, mientras que una actualización no puede
degradar al último administrador. Un upsert solo descubre cuál de los dos casos es dentro de la
escritura, demasiado tarde para aplicar cualquiera de ellos. Cree usuarios con un `POST` simple y modifíquelos
con `PATCH`.

### `Prefer: return=minimal`

Por defecto, cada escritura responde con la fila completa, que es lo que contiene las
decisiones tomadas por el servidor: un id serial, una marca `.onCreateNow()`, lo que sea
que `beforeSave` haya modificado. Envíe `Prefer: return=minimal` cuando no necesite nada de esto:

```bash
curl -X POST /api/data/events \
     -H "Prefer: return=minimal" \
     -d '{"kind": "page_view"}'
# → 204 No Content, Preference-Applied: return=minimal
```

Una escritura individual responde `204`. Una escritura `/bulk` o `/_batch` responde `200`
devolviendo los **ids** en lugar de las filas completas — en una creación, el id es lo único
que el emisor no puede calcular, por lo que descartarlo implicaría volver a leer la tabla mediante
alguna clave natural para saber qué se acaba de escribir. Una clave de una sola columna se
devuelve como un escalar; una clave compuesta como un objeto con sus columnas.

## Lotes entre tablas

<span class="since-badge" data-since="0.31">Desde 0.31</span> Cada operación indica su tabla mediante `table` (antes era `collection`).

`POST /api/data/_batch` escribe en múltiples tablas en una sola transacción, bajo el
propio rol del emisor, con las mismas validaciones, hooks y seguridad a nivel de fila
que aplicaría la ruta individual de cada operación.

```json
POST /api/data/_batch
{
  "operations": [
    { "op": "create", "table": "orders",
      "values": { "total": 40 }, "ref": "order" },
    { "op": "create", "table": "order_items",
      "values": { "order_id": { "$ref": "order.id" }, "sku": "A-1" } },
    { "op": "update", "table": "stock",
      "id": "A-1", "values": { "count": { "$inc": -1 } } },
    { "op": "delete", "table": "carts", "id": "c-9" }
  ]
}
```

```json
{
  "data": [ { "id": 31, "total": 40 }, { "id": 88, … }, { … }, null ],
  "meta": { "operations": 4 }
}
```

`op` puede ser `create`, `update`, `upsert` o `delete`. `update` y `delete` necesitan un
`id`; `create`, `update` y `upsert` necesitan `values`; `upsert` puede indicar un
objetivo `onConflict` en los mismos términos expuestos anteriormente. `data` está alineado con
`operations` — la fila escrita en caso de create, update o upsert, y `null` en caso de
delete — por lo que un índice en uno corresponde al mismo índice en el otro.

### `$ref`: apuntar a una fila creada en el mismo lote

Una operación puede nombrarse a sí misma con `ref`, y cualquier operación posterior puede colocar
`{ "$ref": "<name>.<field>" }` donde iría un valor — en `values` a cualquier profundidad, o
como un `id`. Se resuelve al campo correspondiente de la fila que escribió la operación indicada.

Esta es la razón por la que existe este endpoint en lugar de ser un simple bucle: la clave foránea
de un registro secundario no se puede conocer hasta que se haya insertado el registro padre, por lo que sin esto
el padre y los hijos tendrían que ser solicitudes separadas — precisamente la
secuencia que puede completarse a medias. Solo se resuelven referencias hacia **atrás**; una referencia
hacia adelante se rechaza antes de abrir la transacción.

### Qué se comprueba antes de escribir nada

La estructura, las tablas desconocidas, los campos desconocidos, las restricciones de valores, las operaciones de campo,
los objetivos de conflicto y la accesibilidad de `$ref` se resuelven antes de que se
abra la transacción. Un lote es todo o nada, y encontrar un error tipográfico en la operación 40
costaría de otro modo la reversión de las 39 escrituras anteriores.

Está limitado al mismo número de operaciones que una escritura bulk (1000 por defecto), ya que
un lote mantiene sus bloqueos durante toda la transacción. Los hooks de cada operación se
ejecutan dentro de ella, uno tras otro, por lo que el coste de un hook lento se asume por cada fila con la
transacción abierta: 100 filas cuyo `beforeSave` espere 50 ms retienen una conexión,
y los bloqueos de cada fila escrita hasta el momento, durante 5,3 s. Lo mismo aplica a una
escritura `/bulk`. Consulte [Un hook retiene una conexión](/docs/collections/context-data-api/#a-hook-holds-a-connection). Un controlador que no pueda hacer
que el lote sea atómico responderá con `BATCH_UNSUPPORTED` en lugar de recurrir a un bucle
de escrituras individuales — lo cual no ofrecería ni la atomicidad ni el viaje de ida y vuelta único por el que se utiliza un lote.

Un `update` o `delete` que indique una fila que no existe hace fallar todo el lote
con un `404`, por la misma razón por la que se rechaza una escritura parcial en cualquier otro sitio:
un estado aplicado a medias no tiene una buena recuperación.
