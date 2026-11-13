---
sourceHash: 8cfa91fb2859caf0
title: Tiempo real y WebSocket
sidebar_label: Tiempo real
description: Sincronización de datos en tiempo real, canales de difusión y seguimiento de presencia mediante WebSocket.
---

Rebase incluye un motor de tiempo real integrado que envía los cambios de datos a los clientes conectados a través de WebSocket.
Cuando cualquier registro es creado, actualizado o eliminado, cada suscriptor que esté observando esa tabla o entidad recibe la actualización al instante — sin necesidad de sondeo (polling).

## Cómo funciona

La canalización en tiempo real consta de tres etapas:

1. **Disparador de base de datos** — Una mutación llega a la base de datos PostgreSQL (mediante la API REST, el SDK o Studio).
2. **Distribución en el servidor (fan-out)** — El servidor Rebase detecta el cambio y lo distribuye a cada suscripción WebSocket activa que coincida con la tabla o entidad afectada.
3. **Callback del cliente** — El SDK tipado ejecuta tu callback `onUpdate` con los datos actualizados.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Para despliegues multi-instancia, Rebase utiliza el mecanismo `LISTEN/NOTIFY` de PostgreSQL para transportar los cambios entre las instancias del servidor. Esto se gestiona automáticamente. Con la [captura de cambios a nivel de base de datos](/docs/backend/realtime-cdc/) activada (el valor predeterminado siempre que el rol de la base de datos pueda crear disparadores), cada instancia escucha en el canal `rebase_cdc` donde publican los disparadores de captura, por lo que una escritura se detecta sin importar qué proceso o herramienta la haya realizado. Sin la captura, cada instancia anuncia sus propias escrituras en el canal `rebase_entity_changes`, y una conexión dedicada en cada una de las demás instancias las retransmite a sus suscriptores locales.

### Cero configuración

El tiempo real está habilitado de forma predeterminada. No hay ningún flag que cambiar ni servicio que iniciar: si tu servidor Rebase está ejecutándose, el endpoint de WebSocket está disponible.

### A qué ruta responde el socket

El socket responde a las solicitudes de actualización (upgrade) en una única ruta: la ruta base de la API sin el `/api` final, es decir, `/` para una API en `/api`. Ahí es donde se conecta el SDK: se conecta a su `baseUrl`, mientras que sus peticiones HTTP van a `${baseUrl}/api`. Una actualización a cualquier otra ruta se delega a los demás listeners de `upgrade` del servidor, lo que permite que tu aplicación ejecute su propio servidor WebSocket en el mismo `http.Server`. Si no hay ningún otro listener, dicha actualización responde con un `404`.

En un [servidor personalizado](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` define la ruta, y la opción `realtime.path` del adaptador de Postgres sobrescribe la que el servidor haya derivado.

> De forma predeterminada, Rebase también emite eventos en tiempo real para las escrituras realizadas **fuera** de la API (mediante `psql`, otro servicio o el editor SQL de Studio) siempre que la conexión a la base de datos lo admita; consulta [captura de cambios a nivel de base de datos](/docs/backend/realtime-cdc/).

## Suscripciones tipadas del SDK

El SDK tipado de Rebase expone dos métodos de suscripción en cada descriptor de acceso a tablas:

- **`listen()`** — Suscribirse a una tabla completa (con filtros opcionales).
- **`listenById()`** — Suscribirse a una sola entidad por su ID.

Ambos métodos devuelven una **función para cancelar la suscripción** que se invoca para dejar de recibir actualizaciones.

### Suscribirse a una tabla

Utiliza `listen()` para recibir actualizaciones siempre que cambien los registros de una tabla:

```typescript
const unsubscribe = client.data.products.listen(
  undefined, // FindParams — pass undefined for all records
  (response) => {
    console.log("Products updated:", response.data);
    console.log("Total:", response.meta.total);
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

El callback recibe un `FindResult<M>` que contiene:
- `data` — Las filas, aplanadas, tal como las devuelve `find()` (`row.name`, no `row.values.name`).
- `meta` — Información de paginación (`total`, `limit`, `offset`, `hasMore`).

### Suscribirse a una tabla con filtros

Pasa `FindParams` como primer argumento para filtrar la suscripción:

```typescript
const unsubscribe = client.data.products.listen(
  {
    where: { status: ["==", "published"] },
    orderBy: ["createdAt", "desc"],
    limit: 50,
  },
  (response) => {
    console.log("Published products:", response.data);
  }
);
```

El servidor respeta estos filtros: solo los registros que coincidan se incluirán en las actualizaciones.

### Suscribirse a una sola entidad

Utiliza `listenById()` para observar un registro específico:

```typescript
const unsubscribe = client.data.products.listenById(
  "product-123",
  (row) => {
    if (row) {
      console.log("Product updated:", row.name);
    } else {
      console.log("Product was deleted");
    }
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

El callback recibe la fila, aplanada, tal como la devuelve `findById()` (`row.name`, no `row.values.name`), o `undefined` una vez que la fila ha sido eliminada.

**Cada frame incluye la versión de la fila.** `etagOf(row)` es el `ETag` con el que responde un `GET` de la fila, de modo que una edición realizada sobre lo que mostró un frame se puede guardar con `ifMatch: etagOf(row)` y se rechaza con `412` si la fila ha cambiado (consulta [Escrituras condicionales](/docs/backend/writes/)). En la conexión, el método `subscribe_one` del SDK solicita `etag: true`, y cada frame `single_update` para una fila existente incluye `"etag"` junto a `"row"`. Un servidor anterior a esto ignora la petición y no envía ningún tag, y un cliente que no lo solicita recibe frames sin él.

### Cancelar la suscripción

Tanto `listen()` como `listenById()` devuelven una función de cancelación de suscripción. Invócala para dejar de recibir actualizaciones y liberar recursos en el servidor:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Llama siempre a la función de cancelación de suscripción cuando un componente se desmonte o se navegue fuera de una página. Esto evita fugas de memoria y trabajo innecesario en el servidor.
:::

## Query Builder `.listen()`

El constructor de consultas fluido también admite suscripciones en tiempo real. Encadena tus filtros y luego llama a `.listen()` en lugar de `.find()`:

```typescript
const unsubscribe = client.data.orders
  .where("status", "==", "pending")
  .orderBy("createdAt", "desc")
  .limit(20)
  .listen(
    (response) => {
      console.log("Pending orders:", response.data);
    },
    (error) => {
      console.error("Error:", error);
    }
  );
```

:::note
`.listen()` — tanto en el constructor de consultas como en el descriptor de acceso a la tabla — necesita el WebSocket del cliente. El cliente deriva su URL a partir de `baseUrl` a menos que se proporcione `websocketUrl`. En un cliente creado con `realtime: false`, o en uno que no haya podido derivar ninguna URL, llamar a `.listen()` arrojará un error.
:::

## Entrega de actualizaciones: Parche instantáneo + Refetch de exactitud

Un cambio nunca viaja a un suscriptor como datos directos. Viaja como el hecho de que
algo cambió, y luego a cada suscriptor se le informa de lo que *él* puede ver mediante una
consulta ejecutada bajo su identidad:

1. **Invalidación.** Cuando una entidad cambia (creada, actualizada, eliminada), el
   servidor marca las rutas afectadas. La fila escrita no se reenvía directamente;
   se leyó bajo la autorización del autor de la escritura, lo cual no garantiza lo que
   un suscriptor tiene permitido ver.

2. **Refetch con RLS amortiguado (debounced).** Tras **300ms** (`REFETCH_DEBOUNCE_MS`), el servidor
   vuelve a consultar la tabla con tus filtros y orden originales. La consulta
   se ejecuta dentro de una transacción que establece las variables locales de transacción `app.user_id` y
   `app.user_roles` a partir del `SubscriptionAuthContext` del suscriptor, de modo que Postgres
   evalúa la Seguridad a Nivel de Fila (RLS) bajo la identidad de ese cliente y solo las filas
   que tiene autorización para ver se envían en el `collection_update`. La amortiguación (debounce)
   también agrupa una ráfaga de escrituras en una sola consulta. Espera 300 ms sin
   nuevos cambios, pero nunca más de **1 s** (`REFETCH_MAX_WAIT_MS`) después
   del primero, de modo que una tabla en la que se escribe varias veces por segundo siga enviando
   a sus suscriptores un frame al menos una vez por segundo. Configura ese límite con `REALTIME_REFETCH_MAX_WAIT_MS` (o `realtime.refetchMaxWaitMs`): un valor más alto consulta con menor frecuencia una tabla muy activa, y uno más bajo envía frames más recientes.

   Un refetch que lee exactamente lo que se le envió por última vez a un suscriptor no le envía
   nada: una escritura en la fila 9.000 de una lista que muestra las primeras 50 solo cuesta
   la lectura, no un frame a cada observador. Tras un frame de error, las siguientes filas
   se envían de nuevo incluso si son las mismas.

Las versiones anteriores enviaban un `collection_patch` inmediato con la fila escrita
antes de este refetch, para ofrecer una respuesta visual sub-milisegundo entre pestañas. Esa fila se había
leído bajo el ámbito del autor de la escritura, por lo que podía —y solía— llegar a suscriptores cuyas
propias políticas la habrían denegado, y el propio filtro `where` de la suscripción
tampoco se le aplicaba. El parche ha sido eliminado: la latencia percibida para una
actualización es ahora la ventana de amortiguación (debounce).

### El refetch es la lectura REST

El refetch ejecuta la misma canalización que `GET /api/data/<collection>`, con el
mismo manejo de `include`. Eso es lo que hace que `find({ q })` y `listen({ q })`
devuelvan filas que son idénticas campo por campo.

Antes solía ser un método diferente, uno que anidaba cada relación bajo una
envoltura `{ "__type": "relation" }` y, dado que una suscripción no podía incluir
ningún `include`, cargaba de forma diligente (eager load) **todas** las relaciones declaradas en la tabla. Por tanto, la misma
consulta respondía con una estructura a través de HTTP y con otra a través del socket, y un cliente
que renderizaba ambas veía cómo sus filas cambiaban de estructura en cuanto se producía una escritura.

Por lo tanto, un frame de suscripción acepta lo mismo que una petición de lista: `filter`,
`logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` y
`fields`. `vectorSearch` es la excepción y es **rechazado** con
`VECTOR_SEARCH_NOT_LIVE`: una suscripción se vuelve a ejecutar con cada escritura coincidente y
nada en ella calcula distancias.

### `collection_update` incluye sus propios metadatos

El frame tiene la forma `{ rows, pks, meta }`:

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` se calcula dentro de la misma transacción sujeta a RLS que leyó las filas, por lo que
describe exactamente las filas que lo acompañan. Sin esto, un cliente que necesitara un total
tenía que emitir un `GET /count` **por cada push**: un viaje de ida y vuelta adicional por escritura y por
suscriptor, y una ventana de tiempo en la que el recuento y las filas describían diferentes
estados de la tabla.

Cuando el propio recuento falla, el frame incluye `partial: true` y ningún `total`;
esto no es un error de suscripción, y el cliente debería conservar el último total real
en lugar de sustituirlo por la longitud de la página. En una tabla grande, el recuento representa la mayor parte del costo de un frame. Con `REALTIME_RECOUNT_INTERVAL_MS` configurado, una lista cuyo último total fue al menos `REALTIME_RECOUNT_MIN_ROWS` (100.000 por defecto) reutiliza ese total durante el intervalo en lugar de volver a contar en cada escritura, y dicho frame incluye `meta.totalAsOf`, el momento en que se obtuvo el total. Cuando el intervalo finaliza, una lista cuyo último frame reutilizó el total se vuelve a contar y se le envía el nuevo total, independientemente de si se escribió algo desde entonces. Si no está configurado, como ocurre por defecto, cada frame realiza el recuento.

### Cuánto cuesta una escritura y cuáles son los límites

Dado que cada frame es una consulta ejecutada bajo la identidad de su suscriptor, el costo de una escritura crece
con el número de **preguntas distintas realizadas por entidades (principals) distintas** sobre
la tabla modificada, no con el número de sockets abiertos:

- Las suscripciones que realizan la misma pregunta (misma ruta, filtros, ordenación, página,
  `include`, `fields`, búsqueda) bajo la misma entidad (mismo ID de usuario, roles,
  flag de invitado y claims) comparten un único refetch. Una escritura en una lista cuesta **una
  transacción por cada uno de estos grupos** —la lectura y su recuento— independientemente de cuántos sockets
  la mantengan; cada miembro sigue recibiendo un frame construido a partir de filas leídas bajo esa
  identidad. Una primera página que devuelva menos elementos que su `limit` representa el conjunto
  completo, por lo que no se cuenta en absoluto.
- Una suscripción a un solo registro solo se evalúa cuando su propio registro cambia.
- Diferentes entidades nunca comparten una lectura; esto es lo que evita que un
  frame incluya una fila que su lector no deba ver. Una lista observada por mil
  usuarios con sesión iniciada diferentes representa mil lecturas y mil recuentos en cada
  escritura sobre ella, repartidos en mil transacciones.

Medido en un ordenador portátil contra un PostgreSQL local con un pool de 20 conexiones, una
escritura en una lista resulta en:

| Suscriptores | Transacciones por escritura | Último frame tras la escritura |
|-------------|----------------------------|----------------------------|
| 1.000, una sola entidad | 2 | ~310 ms |
| 1.000, cada uno con una entidad diferente | ~1.000 | ~600 ms |

300 ms de cada uno corresponden a la amortiguación (debounce). La segunda fila es el límite superior a prever. Los
refetches se ejecutan en el mismo pool que tu tráfico REST, pero utilizando como máximo una cuarta parte de
sus conexiones a la vez (5 de las 20 predeterminadas, nunca menos de 2); el resto
espera su turno en el servidor, por lo que la propagación de una escritura retrasa sus propios frames
en lugar de tus peticiones. Una tabla en la que se escribe varias veces por segundo mientras
**cientos de usuarios diferentes** observan la misma lista es el escenario en el que esos frames
comienzan a experimentar demoras. Más allá de ese punto, opta por suscripciones más específicas (una página, un filtro en
las filas propias del usuario) o un [canal de difusión (broadcast channel)](#canales-de-difusión-broadcast-channels) que transmita el
cambio para que los clientes vuelvan a consultar los datos según su propia planificación.

**Un socket puede mantener como máximo 1.000 suscripciones.** La siguiente será rechazada con un frame de error con código `TOO_MANY_SUBSCRIPTIONS`; volver a suscribirse bajo un ID que el socket ya mantiene reemplaza dicha suscripción y no se vuelve a contabilizar. El SDK comparte suscripciones idénticas en un mismo socket, por lo que esto contabiliza las listas y registros distintos que una página tiene abiertos. Modifícalo con `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` o `realtime.maxSubscriptionsPerSocket` en el adaptador de Postgres (la variable de entorno tiene prioridad); un valor que no sea un número entero positivo detendrá el servidor al iniciar. **Los sockets que un usuario mantiene también pueden limitarse**, por instancia de servidor: define `REALTIME_MAX_SOCKETS_PER_USER` (o `realtime.maxSocketsPerUser`), y un inicio de sesión que lo supere será rechazado con `TOO_MANY_SOCKETS` y el socket se cerrará con 4002. Los sockets autenticados con una clave de API cuentan para esa clave, cada clave por su cuenta, no contra la cuenta que la creó; la clave de servicio es una sola credencial, por lo que todos sus sockets se contabilizan juntos. Los sockets de un administrador que suplanta la identidad de un usuario cuentan para el administrador, junto con sus propios sockets, no para el usuario al que representa. El SDK notifica a todas las suscripciones activas y a `onConnectionLost` a la vez, con un error `CONNECTION_LOST` cuyo `details.reason` es `TOO_MANY_SOCKETS`, y continúa reintentándolo, esperando más tiempo en cada intento hasta 30 s, para que la pestaña pueda entrar una vez que se cierre otro socket. Si no está configurado, como ocurre por defecto, no existe ningún límite.

El ID de una suscripción pertenece al propio socket: dos clientes que nombren una suscripción `"sub-1"` mantendrán cada uno la suya, y un `unsubscribe` finaliza únicamente la del remitente.

**Suscribirse cuenta para el límite de tasa (rate limit) de datos.** El primer frame de una suscripción es una lectura, ejecutada bajo la identidad del suscriptor, al igual que una solicitud de historial de un canal. Por lo tanto, `subscribe_collection`, `subscribe_one` y `channel_history` cuentan como solicitudes de datos en el cupo de límite de tasa del emisor (el que comparten sus peticiones HTTP y sus otros sockets) una vez agotado el cupo propio del socket. Cada socket puede enviar 1.000 de ellas sin que se contabilicen, o tantas como su límite de suscripciones cuando este sea superior, y el cupo se repone a lo largo de 15 minutos. Esto cubre todo lo que un socket puede contener, por lo que la resuscripción tras una reconexión nunca es rechazada ni consume el presupuesto del usuario. Superado el cupo, un frame que exceda el límite se rechaza con un frame de error con código `RATE_LIMITED`, que el SDK entrega al `onError` de esa suscripción, o al del canal.

### Sockets que dejan de responder

Un cliente puede desaparecer sin cerrar su socket: un teléfono pierde
cobertura, un portátil entra en reposo, un NAT olvida la conexión. No llega ningún
frame de cierre, por lo que nada avisa al servidor. Por ello, el servidor envía un ping a cada socket
cada 30 segundos y finaliza cualquiera que no haya respondido antes del siguiente ping, de modo
que un cliente desconectado se libera en un plazo de un minuto. Los navegadores y el SDK responden a los
pings automáticamente; un cliente que implemente el protocolo directamente también debe responder a
ellos, tal como hacen la mayoría de las librerías WebSocket.

**En el navegador.** Un navegador no puede enviar un ping ni verlo, por lo que un socket semiabierto le parece conectado indefinidamente. El SDK abre el socket con `?rebase_caps=heartbeat,channel_seq,cancel_sql`; un servidor compatible responde con `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, enumerando las que admite (`cancel_sql`: acepta el frame `CANCEL_SQL` de la consola SQL), y envía `{"type":"heartbeat"}` cada 30 segundos, tras lo cual el SDK descarta el socket y se [reconecta](#reconexión-automática) si se pierden dos consecutivos. A un cliente que no especifique nada no se le envía ninguno de los dos, y un servidor antiguo ignora el parámetro, por lo que un SDK comunicándose con él se comporta como antes.

Un socket también se termina cuando más de 16&nbsp;MiB de frames enviados hacia él permanecen
sin leer. Esto corresponde a un cliente que no lee lo que se le envía, o a uno tan
retrasado que lo que leería estaría obsoleto. Y cuando los sockets de un servidor acumulan
en conjunto más de 256&nbsp;MiB sin leer (o una cuarta parte del límite de memoria bajo el cual se ejecuta
el servidor, si este fuera menor), los que tengan más datos sin leer se terminan
primero, hasta que el resto encaje en el límite.

Un socket terminado se limpia igual que uno cerrado. Sus suscripciones finalizan,
abandona sus canales y su presencia se elimina, anunciando la salida
a los demás miembros. Un cliente que aún esté activo verá caer la conexión,
y el SDK se [reconectará](#reconexión-automática) y se suscribirá nuevamente.

## Canales de difusión (Broadcast Channels)

Los canales de difusión permiten a los clientes enviarse mensajes arbitrarios entre sí en tiempo real — muy útil para funciones como indicadores de escritura, posiciones del cursor o notificaciones personalizadas.

La difusión se gestiona a nivel del protocolo WebSocket. El servidor admite estos tipos de mensaje:

| Tipo de mensaje | Dirección | Descripción |
|-----------------|-----------------|------------------------------------------|
| `join_channel` | Cliente → Servidor | Unirse a un canal con nombre |
| `leave_channel` | Cliente → Servidor | Salir de un canal |
| `broadcast` | Cliente → Servidor | Enviar un mensaje a todos los miembros del canal |
| `broadcast` | Servidor → Cliente | Recibir un mensaje de otro miembro |
| `channel_history` | Cliente → Servidor | Solicitar mensajes retenidos posteriores a una secuencia |
| `channel_history` | Servidor → Cliente | Los mensajes retenidos que un cliente se perdió |

Cuando un cliente envía un mensaje `broadcast`, el servidor lo retransmite a **todos los demás miembros** de ese canal (el remitente no recibe su propio mensaje).

```typescript
// Broadcast message structure (sent by client)
{
  type: "broadcast",
  payload: {
    channel: "room-42",
    event: "typing",
    payload: { userId: "user-1", isTyping: true }
  }
}

// Received by other clients in the channel
{
  type: "broadcast",
  channel: "room-42",
  event: "typing",
  payload: { userId: "user-1", isTyping: true }
}
```

## Retención de canales

De forma predeterminada, una difusión llega a los miembros actualmente conectados y luego desaparece. Esa es la compensación adecuada para notificaciones y cursores, y no tiene ningún coste adicional.

Para un flujo de operaciones —edición colaborativa o cualquier caso donde una brecha silenciosa provoque discrepancias— un canal puede configurarse para **retener** sus mensajes. A las difusiones retenidas se les asigna un número de secuencia por canal y se almacenan, de modo que un cliente que se reconecte pueda solicitar todo lo ocurrido tras el último mensaje que vio.

:::caution[Dónde se configura esto]
**Runtime gestionado: en ninguna parte.** La retención de canales y `realtime.bus` forman parte
del adaptador de base de datos que el propio runtime gestionado construye, y ninguno cuenta con una
variable de entorno. Debes expulsar (eject) para configurarlos.
**Expulsado:** `createPostgresAdapter({ realtime })` en `backend/src/index.ts`.
:::

La retención es opcional y se configura aquí, en el servidor:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";

await initializeRebaseBackend({
    app,
    server,
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations },
        realtime: {
            channels: [
                // Most specific first — the first match wins.
                { match: "doc:draft:*", limit: 100 },
                { match: "doc:*", limit: 500, ttl: "24h" }
            ]
        }
    })
});
```

| Campo | Descripción |
|---------|-----------------------------------------------------------------------------|
| `match` | Nombre exacto del canal (`"doc:42"`) o prefijo terminado en `*` (`"doc:*"`) |
| `limit` | Conservar como máximo esta cantidad de los mensajes más recientes por canal |
| `ttl` | Conservar los mensajes durante este tiempo como máximo — `"30s"`, `"15m"`, `"24h"`, `"7d"`, o milisegundos |

Una regla necesita al menos uno de entre `limit` o `ttl`. Una regla que no tenga ninguno se ignora y se registra en los logs, ya que una retención ilimitada casi nunca es intencionada y no se puede revertir fácilmente una vez que la tabla ha crecido.

:::note[¿Por qué no permitir que los clientes soliciten el historial?]
Un canal es creado por cualquiera que le asigne un nombre. Si un cliente pudiera elegir la profundidad de su propio historial, cualquier visitante podría comprometer tu backend con un almacenamiento ilimitado. Configurarlo aquí también implica que los canales de presencia y notificaciones —la inmensa mayoría— no tengan ningún coste: sin reglas configuradas, no se crea ninguna tabla y la difusión sigue la misma ruta sincrónica de siempre.
:::

### Almacenamiento

Los canales retenidos utilizan dos tablas en el esquema `rebase`, creadas automáticamente al iniciar cuando se configura al menos una regla:

| Tabla | Contenido |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | Los mensajes retenidos, indexados por `(channel, seq)` |
| `rebase.channel_cursors` | La secuencia más alta emitida por canal |

La purga se produce a medida que llegan los mensajes, regulada por canal para que el coste dependa del tiempo transcurrido en lugar del volumen de escritura. Solo elimina filas de `channel_messages`; los cursores se conservan indefinidamente (ocupan una fila pequeña por canal), ya que reiniciar la secuencia de un canal alteraría el significado del punto de reanudación guardado por un cliente.

### Garantías de entrega

- **Ordenada.** Los números de secuencia se asignan por canal y el orden de entrega coincide con el orden de secuencia: en una sola instancia y entre instancias mediante el bus de `postgres`, donde la sentencia que numera un mensaje también lo anuncia, de modo que cada instancia (incluida la del remitente) recibe los anuncios en orden secuencial. Un bus proporcionado por ti transporta los frames en el orden en que los entregue.
- **Durable antes de ser entregado.** Un mensaje que no pueda almacenarse no se entrega a nadie, y se le notifica al remitente. Entregarlo lo pondría a disposición de los suscriptores activos mientras quedaría excluido de cualquier repetición futura, y ningún mensaje posterior podría reparar esa brecha.
- **Al menos una vez (at-least-once) en la sincronización.** Un rango de reproducción puede solaparse con mensajes que un cliente ya recibió; el SDK descarta los que ya haya entregado.
- **Sin huecos.** Un mensaje retenido llega a todos los miembros: al remitente, a quien nunca se le envía su propio mensaje, se le envía `{"type":"broadcast_ack","channel","seq"}` en su lugar cuando ha optado por `channel_seq`. Por lo tanto, un mensaje posterior a `lastSeq + 1` significa que se perdió uno, por lo que el SDK lo retiene, solicita el historial intermedio y los entrega todos en orden. Frente a un servidor sin `channel_seq`, un salto se entrega conforme llega.

:::caution[El historial tiene el mismo modelo de acceso que el canal]
Un cliente que se haya unido a un canal puede reproducir sus mensajes retenidos, incluidos los transmitidos antes de su llegada —la pertenencia al canal es la única comprobación, y unirse está abierto a cualquier cliente que conozca el nombre del canal. La retención se configura de forma explícita por patrón de canal, por lo que habilitarla hace que el pasado de ese canal sea legible para cualquier visitante que adivine el nombre. Los canales retenidos son el escenario en el que esto se vuelve duradero en lugar de momentáneo, por lo que debes tratar el contenido de un canal retenido como público para tus usuarios.
:::

## Seguimiento de presencia

El seguimiento de presencia registra qué usuarios están conectados en un canal y permite a cada usuario compartir un estado personalizado (por ejemplo, posición del cursor, estado).

| Tipo de mensaje | Dirección | Descripción |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track` | Cliente → Servidor | Iniciar el seguimiento de presencia con un estado personalizado |
| `presence_untrack`| Cliente → Servidor | Detener el seguimiento de presencia |
| `presence_state` | Cliente → Servidor | Solicitar el estado de presencia completo de un canal |
| `presence_state` | Servidor → Cliente | Todas las presencias en el canal, al completo |
| `presence_diff` | Servidor → Cliente | Actualización incremental (incorporaciones y salidas) |

Cuando un cliente envía `presence_track`, el servidor lo une automáticamente al canal (no es necesario un `join_channel` por separado) y transmite un `presence_diff` a todos los miembros del canal. El SDK reenvía su estado cada ~20 segundos como latido (heartbeat); un latido cuyo estado no haya cambiado solo renueva el tiempo de espera del cliente y no envía ningún `presence_diff`.

```typescript
// Track presence
{
  type: "presence_track",
  payload: {
    channel: "document-edit-42",
    state: { name: "Alice", cursor: { line: 10, col: 5 } }
  }
}

// Presence diff received by other clients
{
  type: "presence_diff",
  channel: "document-edit-42",
  joins: { "client-abc": { name: "Alice", cursor: { line: 10, col: 5 } } },
  leaves: {}
}

// Full presence state response
{
  type: "presence_state",
  channel: "document-edit-42",
  presences: {
    "client-abc": { name: "Alice", cursor: { line: 10, col: 5 } },
    "client-def": { name: "Bob", cursor: { line: 22, col: 0 } }
  }
}
```

Las presencias inactivas se eliminan automáticamente tras 30 segundos de inactividad.

## Reconexión automática

El SDK tipado se reconecta automáticamente cuando se interrumpe la conexión WebSocket:

- **Retroceso exponencial (exponential backoff)** — Cada reintento espera un intervalo que comienza en 2 segundos y se duplica en cada intento, hasta un máximo de 30 segundos. El retraso se elige aleatoriamente dentro del intervalo, pero nunca por debajo de un cuarto de segundo, de modo que los clientes desconectados simultáneamente por un despliegue regresen repartidos a lo largo de todo el intervalo en lugar de en el mismo instante.
- **Sin desistir mientras haya elementos activos** — Mientras exista una suscripción o un canal al que se haya unido, el cliente continúa reintentando al límite de 30 segundos durante todo el tiempo que dure la interrupción. Si no hay nada registrado, se detiene tras 5 intentos fallidos, y la siguiente suscripción volverá a iniciar la conexión. En un navegador, el evento `online` y el hecho de que la pestaña vuelva a estar visible desencadenan un reintento inmediato en lugar de esperar a que venza el retroceso.
- **Las interrupciones se notifican una sola vez** — Cuando la conexión ha estado cada durante 14 segundos, sin importar cuántos reintentos haya tomado, el `onError` de cada suscripción activa y el `onError` de cada canal al que se haya unido reciben un `RebaseApiError` con el código `CONNECTION_LOST`. La suscripción se **mantiene**: el error indica que sus datos no se están actualizando, no que haya finalizado.
- **Resuscripción automática** — Tras una reconexión exitosa, todas las suscripciones activas se vuelven a registrar en el servidor, y el siguiente `onUpdate` de cada una incluirá lo que se haya escrito mientras el cliente estaba ausente. Dicha actualización es la señal de recuperación. No se requiere intervención manual.
- **Las solicitudes son a lo sumo una vez (at-most-once)** — Una solicitud realizada mientras el socket está inactivo espera a que se restablezca durante un máximo de 30 segundos desde la llamada, y luego falla con `REQUEST_TIMEOUT` sin llegar a enviarse. Una solicitud que ya se había enviado cuando se interrumpió la conexión falla con `CONNECTION_LOST` y **no** se reenvía: el servidor puede haberla ejecutado o no, y solo el emisor sabe si es seguro ejecutarla dos veces.

`client.ws.state` indica en qué estado se encuentra la conexión, y `onStateChange` recibe cada cambio:

| Estado | Significado |
|---|---|
| `idle` | Sin socket, y ninguno solicitado todavía (la conexión es diferida/lazy), o un cierre de sesión lo eliminó. |
| `connecting` | Conectando, sin ninguna interrupción en curso. |
| `connected` | El socket está abierto. |
| `reconnecting` | El socket se desconectó y el cliente está reintentando. Aún no se ha notificado nada. |
| `disconnected` | La interrupción ha durado 14 segundos o más. Se ha notificado `CONNECTION_LOST` y el cliente sigue reintentando. |
| `closed` | Se invocó `client.close()`. Estado definitivo. |

```typescript
// `ws` is undefined on a client built without realtime, so narrow it once.
const ws = client.ws;
if (ws) {
    ws.onStateChange((state) => {
        showOfflineBanner(state === "disconnected");
    });
    ws.on("connect", () => console.log("Connected"));
    ws.on("disconnect", () => console.log("Disconnected"));
    ws.on("reconnect", () => console.log("Reconnected"));
    ws.on("error", (error) => console.error("Error:", error));
}
```

El panel de administración de Rebase muestra un banner propio mientras el estado es `disconnected`, y mantiene las filas y registros que ya están en pantalla en lugar de reemplazarlos por un error.

## Autenticación y RLS

Las suscripciones WebSocket respetan automáticamente las políticas de Row-Level Security (RLS). Cuando el cliente está autenticado:

1. La conexión WebSocket se autentica utilizando el mismo token JWT que la API REST.
2. Cada refetch de suscripción se ejecuta dentro de una transacción PostgreSQL con `set_config('app.user_id', ...)` y `set_config('app.user_roles', ...)` — garantizando la aplicación de las políticas de RLS.
3. La identidad se vuelve a comprobar durante todo el tiempo que el socket permanezca abierto, no solo al autenticarse. Antes de cada frame, el servidor comprueba lo mismo que comprobaría una petición HTTP: si el token sigue siendo válido, si su sesión fue cerrada o revocada, si la cuenta todavía existe y qué roles posee ahora. Los frames de canal se comprueban como máximo una vez por segundo. Los frames que llegan a un socket mientras su comprobación aún está en curso —un cliente que reenvía sus suscripciones tras una reconexión— comparten esa comprobación en lugar de consultar cada uno por su cuenta; el siguiente frame tras finalizar esta realiza una comprobación nueva. Un socket que solo escucha se comprueba al menos cada 30 segundos, y un token deja de ser aceptado en el instante en que expira. La retirada de un rol se aplica a partir del siguiente frame (o, para un frame que compartió una comprobación ya en curso, a partir del posterior), afectando a lecturas, escrituras y suscripciones abiertas por igual. Un socket cuya identidad haya expirado recibe un frame `AUTH_ERROR` y se cierra con el código `4001`. Con la autenticación integrada, el código del frame indica el motivo, al igual que lo indican las rutas HTTP: `SESSION_REVOKED` (cierre de sesión, revocada o cuenta eliminada), `ACCOUNT_DISABLED` o `TOKEN_EXPIRED`; con otro adaptador de autenticación es `SESSION_ENDED`. Un `AUTHENTICATE` para una sesión revocada o una cuenta deshabilitada se rechaza con `SESSION_REVOKED` o `ACCOUNT_DISABLED` (un token que no se valida, o que ha expirado, con `INVALID_TOKEN`). El SDK no vuelve a preguntar con el mismo token y transfiere el rechazo, código incluido, al `onError` de lo que haya requerido la cuenta. El SDK autentica su socket de nuevo cada vez que renueva su token; un nuevo token para la misma identidad (mismo ID de usuario, roles, flag de invitado y claims) mantiene las suscripciones abiertas tal como están, mientras que uno para una identidad diferente vuelve a consultar cada una de ellas bajo la nueva identidad. Tras un `4001`, se reconecta con la sesión que posea en ese momento, o sin ninguna. Un cliente que hable directamente el protocolo debe enviar un token actualizado en `AUTHENTICATE` antes de que el anterior expire.

Esto significa que cada socket solo recibe actualizaciones de los registros que su identidad autenticada tiene autorización para ver.

Una [clave de API](/docs/backend/api-keys/) también autentica el socket: envía la
clave `rk_…` en el lugar donde iría el token de acceso. A continuación, el socket comprueba cada frame
frente a los [ámbitos (scopes)](/docs/backend/roles-and-scopes/) de la clave: una lectura, un recuento o una
suscripción requiere `data:read` en su tabla, una operación de guardado `data:write`, una eliminación
`data:delete`. Una ruta anidada requiere el ámbito simple. Los canales (difusión y
presencia) son rechazados para una clave, ya que ningún ámbito los abarca. El editor SQL y los
mensajes de ramas requieren `database:read` o `database:write`, tanto para una clave como para un
usuario.

La ejecución de más de una instancia —el bus LISTEN/NOTIFY, el funcionamiento de la presencia
entre procesos y la creación de tu propio transporte— cuenta con su propia página:
[Tiempo real entre instancias](/docs/backend/realtime-transports/).

## Captura de cambios a nivel de base de datos (CDC)

Cada escritura confirmada emite eventos en tiempo real, independientemente de cómo se haya realizado: REST, el
SDK, Studio, `psql`, o una tarea cron en otro servicio. Cómo funciona la captura, el
ajuste `REALTIME_CDC` y lo que requiere: [Captura de cambios en la base de datos](/docs/backend/realtime-cdc/).

## Tiempo de espera de solicitudes pendientes

Para evitar que las solicitudes de los clientes queden bloqueadas indefinidamente, todas las operaciones WebSocket pendientes que esperan una respuesta del servidor (como las lecturas puntuales de tablas `FETCH_COLLECTION`, las lecturas de una sola entidad `FETCH_ONE`, la creación/actualización `SAVE`, las eliminaciones `DELETE`, los recuentos `COUNT` y las comprobaciones de unicidad `CHECK_UNIQUE_FIELD`) tienen un tiempo de espera predeterminado de 30 segundos.

Si el servidor no responde dentro de este margen de 30 segundos, el cliente elimina automáticamente la solicitud pendiente y rechaza la promesa con un `RebaseApiError` cuyo código es `REQUEST_TIMEOUT`.

Los mensajes unidireccionales que no esperan respuesta (como `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` y `channel_history`) se resuelven inmediatamente tras su transmisión y no activan este tiempo de espera. Una suscripción cuyo primer frame no haya llegado 30 segundos después de haber enviado la solicitud de suscripción fallará en su lugar con `SUBSCRIPTION_TIMEOUT` en su `onError`.

### Cuándo se rechaza un frame de canal

Un frame de canal funciona bajo el modelo de disparo y olvido (fire-and-forget): `await channel.broadcast(...)` se resuelve cuando
el frame se escribe en el socket, **no** cuando el servidor lo ha aceptado. Esto
es deliberado: una aplicación colaborativa transmite la posición del cursor sesenta veces por
segundo, y esperar una confirmación de cada una convertiría a cada una en un viaje
de ida y vuelta.

Por lo tanto, un rechazo no puede manifestarse como una promesa rechazada. Llega a través de `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Código | Significado |
|------|-------|
| `CHANNEL_FORBIDDEN` | No eres miembro del canal — únete antes de transmitir o leer su historial |
| `RATE_LIMITED` | Se superó el límite de frames del canal (7.200 frames de canal por minuto por socket), o, para una solicitud de historial, se superó el [límite de tasa de datos](#cuánto-cuesta-una-escritura-y-cuáles-son-los-límites) |
| `CHANNEL_HISTORY_WRITE_FAILED` | No se pudo persistir una difusión retenida, por lo que fue descartada |
| `CHANNEL_HISTORY_READ_FAILED` | No se pudo procesar una solicitud de recuperación de historial |
| `CHANNEL_HISTORY_GAP` | Generado por el cliente: una sincronización detectó que el servidor ya no retiene mensajes que este cliente nunca recibió. `details` es `{ from, to }`, los números de secuencia perdidos. Resincroniza el estado del canal desde su fuente de confianza |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | La difusión llegó únicamente a esta instancia — consulta [El límite de 8 KB en el bus de Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Si no se adjunta ningún controlador, estos se registran como advertencias. Anteriormente se
descartaban por completo: no había ninguna promesa que rechazar ni ningún canal al que realizar la entrega,
por lo que una difusión prohibida resultaba indistinguible de una entregada con éxito.

## Siguientes pasos

- [SDK tipado](/docs/sdk) — Referencia completa del SDK, incluidos los descriptores de acceso tipados a tablas.
- [Autenticación](/docs/backend/authentication) — Configuración de autenticación JWT y políticas RLS.
- [Arquitectura del backend](/docs/backend) — Información general sobre la arquitectura del servidor Rebase.
