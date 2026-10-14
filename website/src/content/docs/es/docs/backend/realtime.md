---
sourceHash: b0bd1a2197737033
title: Tiempo real y WebSocket
sidebar_label: Tiempo real
description: Sincronización de datos en tiempo real, canales de difusión y seguimiento de presencia mediante WebSocket.
---

Rebase incluye un motor en tiempo real integrado que envía los cambios de datos a los clientes conectados a través de WebSocket.
Cuando cualquier registro es creado, actualizado o eliminado, cada suscriptor que observa esa colección o entidad recibe la actualización al instante, sin necesidad de sondeos (polling).

## Cómo funciona

El flujo de procesamiento en tiempo real consta de tres etapas:

1. **Trigger de base de datos** — Una mutación impacta en la base de datos PostgreSQL (mediante la API REST, el SDK o Studio).
2. **Distribución en el servidor (Server fan-out)** — El servidor de Rebase detecta el cambio y lo distribuye a cada suscripción WebSocket activa que coincida con la colección o entidad afectada.
3. **Callback del cliente** — El SDK tipado ejecuta tu callback `onUpdate` con los datos actualizados.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Para despliegues de múltiples instancias, Rebase utiliza `LISTEN/NOTIFY` de PostgreSQL para difundir los cambios entre las instancias del servidor. Esto se gestiona automáticamente. Con la [captura de cambios a nivel de base de datos](/docs/backend/realtime-cdc/) activada (el valor por defecto allí donde el rol de la base de datos puede crear triggers), cada instancia escucha en el canal `rebase_cdc` en el que publican los triggers de captura, de modo que una escritura se oye venga del proceso o de la herramienta que venga. Sin captura, cada instancia anuncia sus propias escrituras en el canal `rebase_entity_changes`, y una conexión dedicada en cada una de las demás instancias las retransmite a sus suscriptores locales.

### Cero configuración

El tiempo real está habilitado de forma predeterminada. No hay ningún indicador que activar ni ningún servicio que iniciar: si tu servidor de Rebase está en ejecución, el endpoint de WebSocket estará disponible.

### Qué ruta responde el socket

En 0.24 el socket acepta cada actualización (upgrade) de WebSocket del servidor, sea cual sea su ruta.

El socket responde a las actualizaciones de una sola ruta: la ruta base de la API sin un `/api` final, es decir, `/` para una API en `/api`. Es donde marca el SDK: se conecta a su `baseUrl`, mientras que sus solicitudes HTTP van a `${baseUrl}/api`. Una actualización a cualquier otra ruta se deja a los demás oyentes `upgrade` del servidor, de modo que tu aplicación puede ejecutar su propio servidor WebSocket en el mismo `http.Server`. Sin otro oyente, esa actualización recibe un `404`.

En un [servidor personalizado](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` establece la ruta, y el `realtime.path` del adaptador de Postgres anula la que el servidor derivó.

> Por defecto, Rebase también emite eventos en tiempo real para las escrituras realizadas **fuera** de la API (mediante `psql`, otro servicio o el editor SQL de Studio) siempre que la conexión a la base de datos lo admita; consulta [captura de cambios a nivel de base de datos](/docs/backend/realtime-cdc/).

## Suscripciones del SDK tipado

El SDK tipado de Rebase expone dos métodos de suscripción en cada descriptor de acceso a colecciones:

- **`listen()`** — Suscribirse a una colección completa (con filtros opcionales).
- **`listenById()`** — Suscribirse a una sola entidad por su ID.

Ambos métodos devuelven una **función para cancelar la suscripción** que puedes llamar para dejar de recibir actualizaciones.

### Suscribirse a una colección

Utiliza `listen()` para recibir actualizaciones siempre que cambien los registros de una colección:

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

El callback recibe un `FindResponse<M>` que contiene:
- `data` — Array de objetos `Entity<M>`.
- `meta` — Información de paginación (`total`, `limit`, `offset`, `hasMore`).

### Suscribirse a una colección con filtros

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

El callback recibe la fila, plana, tal como la devuelve `findById()` (`row.name`, no `row.values.name`), o `undefined` una vez que la fila se elimina.

**Cada trama lleva la versión de la fila.** `etagOf(row)` es el `ETag` que responde un `GET` de la fila, así que una edición hecha sobre lo que mostraba una trama puede guardarse con `ifMatch: etagOf(row)` y se rechaza con `412` si la fila ha cambiado entretanto (consulta [Escrituras condicionales](/docs/backend/writes/)). En el protocolo, el `subscribe_one` del SDK pide con `etag: true`, y cada trama `single_update` de una fila que existe lleva `"etag"` junto a `"row"`. Un servidor anterior a esto ignora la petición y no envía etiqueta, y un cliente que no la pide recibe tramas sin ella.

### Cancelar la suscripción

Tanto `listen()` como `listenById()` devuelven una función de cancelación de suscripción. Llámala para dejar de recibir actualizaciones y liberar recursos en el servidor:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Llama siempre a la función de cancelación de suscripción cuando un componente se desmonte o se navegue fuera de la página. Esto evita fugas de memoria y trabajo innecesario en el servidor.
:::

## Query Builder `.listen()`

El constructor de consultas fluido (Query Builder) también admite suscripciones en tiempo real. Encadena tus filtros y luego llama a `.listen()` en lugar de `.find()`:

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
El método `.listen()` en el query builder solo está disponible cuando el `RebaseClient` está configurado con un `websocketUrl`. Si la conexión WebSocket no está configurada, llamar a `.listen()` generará un error.
:::

## Entrega de actualizaciones: Instant Patch + Refetch de corrección

Un cambio nunca viaja a un suscriptor como datos directos. Viaja como el hecho de que algo cambió, y luego a cada suscriptor se le informa lo que *él* puede ver mediante una consulta ejecutada con su propia identidad:

1. **Invalidación.** Cuando una entidad cambia (creada, actualizada, eliminada), el servidor marca las rutas afectadas. La fila que se escribió no se reenvía: se leyó bajo la autorización de quien escribió, lo cual no garantiza lo que un suscriptor tiene permitido ver.

2. **Refetch con RLS y debounce.** Tras **300ms** (`REFETCH_DEBOUNCE_MS`), el servidor vuelve a consultar la colección con tus filtros y orden originales. La consulta se ejecuta dentro de una transacción que establece `app.user_id` y `app.user_roles` locales a la transacción a partir del `SubscriptionAuthContext` del suscriptor, de modo que Postgres evalúa la Row-Level Security (RLS) bajo la identidad de ese cliente y solo las filas que tiene autorización para ver se envían en el `collection_update`. El debounce también agrupa ráfagas de escrituras en una sola consulta. Espera 300 ms sin un cambio más, pero nunca más de **1 s** (`REFETCH_MAX_WAIT_MS`) tras el primero, de modo que una colección escrita varias veces por segundo envía de todos modos una trama a sus suscriptores al menos una vez por segundo. Fija ese límite con `REALTIME_REFETCH_MAX_WAIT_MS` (o `realtime.refetchMaxWaitMs`): un valor mayor vuelve a consultar una tabla ocupada con menos frecuencia, uno menor envía tramas más recientes.

   Un refetch que lee exactamente lo que se le envió por última vez a un suscriptor no le envía
   nada: una escritura en la fila 9.000 de una lista que muestra las primeras 50 cuesta
   la lectura, no una trama a cada espectador. Tras una trama de error, las siguientes filas
   se vuelven a enviar aunque sean las mismas.

Las versiones anteriores enviaban un `collection_patch` inmediato con la fila escrita antes de este refetch, para ofrecer una respuesta de submilisegundos entre pestañas. Esa fila se había leído bajo el alcance de quien escribió, por lo que podía llegar —y llegaba— a suscriptores cuyas propias políticas la habrían denegado, y el filtro `where` propio de la suscripción tampoco se le aplicaba. El parche se ha eliminado: la latencia percibida para una actualización es ahora la ventana del debounce.

### El refetch es la lectura REST

El refetch ejecuta el mismo flujo de procesamiento que `GET /api/data/<collection>`, con el mismo tratamiento de `include`. Esto es lo que hace que `find({ q })` y `listen({ q })` devuelvan filas idénticas campo por campo.

Solía ser un método diferente: uno que anidaba cada relación bajo un envoltorio `{ "__type": "relation" }` y que, al no admitir `include` en la suscripción, cargaba de forma anticipada (eager loading) **todas** las relaciones declaradas por la colección. Por lo tanto, la misma consulta respondía con una estructura a través de HTTP y con otra a través del socket, y un cliente que renderizaba ambas veía cómo sus filas cambiaban de estructura en cuanto se producía una escritura.

Por lo tanto, una trama de suscripción acepta los mismos parámetros que una petición de listado: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` y `fields`. `vectorSearch` es la excepción y es **rechazado** con `VECTOR_SEARCH_NOT_LIVE`: una suscripción se vuelve a ejecutar con cada escritura coincidente y en ese punto nada calcula distancias.

### `collection_update` incluye sus propios metadatos

La trama es `{ rows, pks, meta }`:

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` se calcula dentro de la misma transacción sujeta a RLS que leyó las filas, por lo que describe con exactitud las filas que la acompañan. Sin esto, un cliente que necesitara el total tenía que emitir un `GET /count` **por cada push**: un viaje de ida y vuelta adicional por escritura y por suscriptor, además de una ventana en la que el conteo y las filas describían estados distintos de la colección.

Cuando el propio conteo falla, la trama incluye `partial: true` y ningún `total`; esto no constituye un error de suscripción, y el cliente debe conservar el último total real en lugar de sustituirlo por la longitud de la página. En una tabla grande, el conteo es la mayor parte de lo que cuesta una trama. Con `REALTIME_RECOUNT_INTERVAL_MS` definida, una lista cuyo último total fue de al menos `REALTIME_RECOUNT_MIN_ROWS` (100.000 por defecto) reutiliza ese total durante el intervalo en lugar de contar en cada escritura, y esa trama lleva `meta.totalAsOf`, el momento en que se tomó el total. Sin definir, como por defecto, cada trama cuenta.

### Lo que cuesta una escritura, y los límites

Como cada trama es una consulta ejecutada como su suscriptor, el costo de una
escritura crece con el número de **preguntas distintas que hacen principals
distintos** sobre la colección que tocó — no con el número de sockets
abiertos:

- Las suscripciones que hacen la misma pregunta (misma ruta, filtros, orden,
  página, `include`, `fields`, búsqueda) como el mismo principal (mismo id de
  usuario, roles, marca de invitado y claims) comparten un único refetch. Una
  escritura a una lista cuesta **una transacción por cada grupo así** — la
  lectura y su conteo —, sin importar cuántos sockets la tengan; cada miembro
  sigue recibiendo una trama construida a partir de filas leídas bajo esa
  identidad. Una primera página que llega más corta que su `limit` es el
  conjunto completo, así que no se cuenta en absoluto.
- Una suscripción de un solo registro solo se consulta cuando cambia su propio
  registro.
- Los principals distintos nunca comparten una lectura — eso es lo que evita
  que una trama lleve una fila que su lector no debería ver. Una lista
  observada por mil usuarios distintos con la sesión iniciada son mil lecturas
  y mil conteos en cada escritura a ella, en mil transacciones.

Medido en una laptop contra un PostgreSQL local con un pool de 20 conexiones, una escritura a una lista:

| Suscriptores | Transacciones por la escritura | Última trama tras la escritura |
|-------------|----------------------------|----------------------------|
| 1.000, un solo principal | 2 | ~310 ms |
| 1.000, cada uno un principal distinto | ~1.000 | ~600 ms |

300 ms de cada una son el debounce. La segunda fila es el techo para el que
hay que planificar. Los refetches se ejecutan en el mismo pool que tu tráfico
REST, pero como máximo en una cuarta parte de sus conexiones a la vez (5 de
las 20 por defecto, nunca menos de 2); el resto espera su turno en el
servidor, así que la distribución de una escritura retrasa sus propias tramas
y no tus solicitudes. Una colección escrita varias veces por segundo mientras
**cientos de usuarios distintos** observan la misma lista es donde esas
tramas empiezan a retrasarse. Más allá de eso, prefiere
suscripciones más estrechas (una página, un filtro sobre las propias filas
del usuario) o un [canal de difusión](#canales-de-difusión-broadcast-channels)
que lleve el cambio para que los clientes vuelvan a consultar en su propio
horario.

**Un socket puede tener como máximo 1.000 suscripciones.**
La siguiente se rechaza con una trama de error con el código
`TOO_MANY_SUBSCRIPTIONS`; volver a suscribirse con un id que el socket ya
tiene sustituye esa suscripción y no cuenta de nuevo. El SDK comparte
suscripciones idénticas en un mismo socket, así que esto cuenta las listas y
registros distintos que una página tiene abiertos. Cámbialo con
`REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` o `realtime.maxSubscriptionsPerSocket`
en el adaptador de Postgres (la variable de entorno prevalece); un valor que
no sea un entero positivo detiene el servidor en el arranque. En 0.23 las
suscripciones de un socket no tienen límite. **También se pueden limitar los sockets que mantiene un usuario**, por instancia del servidor: define `REALTIME_MAX_SOCKETS_PER_USER` (o `realtime.maxSocketsPerUser`), y un inicio de sesión por encima del límite se rechaza con `TOO_MANY_SOCKETS` y el socket se cierra con 4002. Sin definir, como por defecto, no hay techo.

Un id de suscripción es propio del socket: dos clientes que nombran ambos una
suscripción `"sub-1"` conservan cada uno la suya, y un `unsubscribe` termina
solo la del emisor.

**Suscribirse cuenta contra el límite de tasa de datos.** La primera trama de una suscripción es una lectura, ejecutada como el suscriptor, y lo mismo es la solicitud de historial de un canal. Por eso `subscribe_collection`, `subscribe_one` y `channel_history` cuentan como solicitudes de datos en el contador de límite de tasa de quien llama (el que comparten sus solicitudes HTTP y sus otros sockets) una vez agotada la asignación propia del socket. Cada socket puede enviar 1.000 de ellas sin contarlas, o tantas como su techo de suscripciones cuando este es mayor, y la asignación se recupera a lo largo de 15 minutos. Eso es todo lo que un socket puede tener, así que la nueva suscripción tras una reconexión nunca se rechaza y nunca gasta el presupuesto de la persona. Superada la asignación, una trama por encima del límite se rechaza con una trama de error con el código `RATE_LIMITED`, que el SDK entrega al `onError` de esa suscripción, o al del canal. En 0.23 estas tramas solo cuentan contra el presupuesto propio del socket de 2.000 tramas por minuto.

### Sockets que dejan de responder

Un cliente puede desaparecer sin cerrar su socket: un móvil
pierde la cobertura, un portátil entra en reposo, un NAT olvida la conexión. No
llega ningún frame de cierre, así que nada se lo dice al servidor. Por eso el
servidor envía un ping a cada socket cada 30 segundos y termina el que no ha
respondido antes del siguiente ping, de modo que un cliente desaparecido se
libera en menos de un minuto. Los navegadores y el SDK responden a los pings por
sí solos; un cliente que habla el protocolo directamente también tiene que
responderlos, como hacen la mayoría de las bibliotecas de WebSocket.

**El lado del navegador.** Un navegador no puede enviar un ping ni verlo, así que un socket medio abierto le parece conectado para siempre. El SDK abre el socket con `?rebase_caps=heartbeat,channel_seq,cancel_sql`; un servidor que las conoce responde con `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, listando las que respeta (`cancel_sql`: acepta la trama `CANCEL_SQL` de la consola SQL), y envía `{"type":"heartbeat"}` cada 30 segundos, y el SDK descarta el socket y [se reconecta](#reconexión-automática) tras perder dos. A un cliente que no nombra nada no se le envía ninguna, y un servidor anterior ignora el parámetro, así que un SDK que hable con uno se comporta como antes.

Un socket también se termina cuando más de 16&nbsp;MiB de frames enviados a él
siguen sin leerse. Es un cliente que no lee lo que se le envía, o uno tan
retrasado que lo que leería ya está desfasado. Y cuando los sockets de un servidor
juntos acumulan más de 256&nbsp;MiB sin leer (o una cuarta parte del límite de memoria bajo
el que se ejecuta el servidor, si este es menor), se terminan primero los que más tienen
sin leer, hasta que el resto cabe.

Un socket terminado se limpia como uno cerrado. Sus suscripciones terminan, sale
de sus canales y se elimina su presencia, y la salida se anuncia a los demás
miembros. Un cliente que sigue ahí ve caer la conexión, y el SDK
[se reconecta](#reconexión-automática) y vuelve a suscribirse. En 0.23 un socket
así sigue abierto hasta que el sistema operativo da por perdida la conexión
(unas dos horas en Linux), y cada escritura en una colección a la que está
suscrito sigue costando un refetch para él.

## Canales de difusión (Broadcast Channels)

Los canales de difusión permiten que los clientes se envíen mensajes arbitrarios entre sí en tiempo real, lo que resulta útil para funciones como indicadores de escritura, posiciones del cursor o notificaciones personalizadas.

El broadcast se gestiona a nivel del protocolo WebSocket. El servidor admite estos tipos de mensajes:

| Tipo de mensaje  | Dirección       | Descripción                              |
|-----------------|-----------------|------------------------------------------|
| `join_channel`    | Cliente → Servidor | Unirse a un canal con nombre             |
| `leave_channel`   | Cliente → Servidor | Salir de un canal                        |
| `broadcast`       | Cliente → Servidor | Enviar un mensaje a todos los miembros del canal |
| `broadcast`       | Servidor → Cliente | Recibir un mensaje de otro miembro       |
| `channel_history` | Cliente → Servidor | Solicitar mensajes retenidos posteriores a una secuencia |
| `channel_history` | Servidor → Cliente | Los mensajes retenidos que el cliente se perdió |

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

Por defecto, una difusión llega a los miembros actualmente conectados y luego desaparece. Esa es la compensación adecuada para notificaciones y cursores, y no supone ningún coste.

Para un flujo de operaciones —edición colaborativa, o cualquier caso donde una pérdida silenciosa cause divergencias—, un canal puede configurarse para **retener** sus mensajes. A las difusiones retenidas se les asigna un número de secuencia por canal y se almacenan, de modo que un cliente que se reconecte pueda solicitar todo lo ocurrido tras el último que vio.

:::caution[Dónde se configura esto]
**Runtime administrado: en ningún lugar.** La retención de canales y `realtime.bus` forman parte del adaptador de base de datos que el runtime administrado construye por sí mismo, y ninguno cuenta con variables de entorno. Haz un eject para configurarlos.
**Con eject:** `createPostgresAdapter({ realtime })` en `backend/src/index.ts`.
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

| Campo   | Descripción                                                                 |
|---------|-----------------------------------------------------------------------------|
| `match` | Nombre exacto del canal (`"doc:42"`) o un prefijo terminado en `*` (`"doc:*"`) |
| `limit` | Mantener como máximo esta cantidad de los mensajes más recientes por canal  |
| `ttl`   | Mantener los mensajes durante un tiempo máximo: `"30s"`, `"15m"`, `"24h"`, `"7d"` o milisegundos |

Una regla necesita al menos uno de entre `limit` o `ttl`. Si no tiene ninguno, se ignora y se registra en los logs, ya que una retención sin límites casi nunca es lo que se busca y no se puede revertir fácilmente una vez que la tabla ha crecido.

:::note[¿Por qué no dejar que los clientes soliciten el historial?]
Cualquiera que asigne un nombre a un canal lo crea. Si un cliente pudiera elegir la profundidad de su propio historial, cualquier visitante podría comprometer el almacenamiento de tu backend sin límite. Configurarlo aquí también significa que los canales de presencia y notificación —la inmensa mayoría— no pagan ningún coste: sin reglas configuradas, no se crea ninguna tabla y el broadcast se ejecuta a través de la misma vía sincrónica de siempre.
:::

### Almacenamiento

Los canales retenidos utilizan dos tablas en el esquema `rebase`, creadas automáticamente al iniciar si hay al menos una regla configurada:

| Tabla                     | Contenido                                                       |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | Los mensajes retenidos, identificados por `(channel, seq)`       |
| `rebase.channel_cursors`  | La secuencia más alta emitida por canal                         |

La purga se realiza a medida que llegan los mensajes, regulada por canal para que el coste dependa del tiempo transcurrido y no del volumen de escritura. Solo elimina filas de `channel_messages`; los cursores se conservan indefinidamente (ocupan una única fila pequeña por canal), ya que reiniciar la secuencia de un canal alteraría el significado del punto de reanudación guardado por el cliente.

### Garantías de entrega

- **Ordenado.** Los números de secuencia se asignan por canal y el orden de entrega coincide con el orden de la secuencia — en una sola instancia, y entre instancias en el bus `postgres`, donde la misma sentencia que numera un mensaje también lo anuncia, de modo que cada instancia (incluida la del emisor) recibe los anuncios en el orden de la secuencia. Un bus que proporciones tú mismo entrega las tramas en el orden en que las entregue.
- **Durable antes de ser entregado.** Un mensaje que no se puede almacenar no se entrega a nadie y se notifica al remitente. Entregarlo lo expondría ante los suscriptores en vivo pero lo omitiría en cualquier reproducción futura, y ningún mensaje posterior podría subsanar ese vacío.
- **Al menos una vez al ponerse al día (At-least-once).** Un rango de reproducción puede solaparse con mensajes que el cliente ya haya recibido; el SDK descarta aquellos que ya ha entregado.
- **Sin huecos.** Un mensaje retenido llega a todos los miembros: al emisor, a quien nunca se envía su propio mensaje, se le envía en su lugar `{"type":"broadcast_ack","channel","seq"}` si optó por `channel_seq`. Así, un mensaje posterior a `lastSeq + 1` significa que se perdió uno, y el SDK lo retiene, pide el historial intermedio y entrega todos en orden. Frente a un servidor sin `channel_seq`, un salto se entrega tal como llega.

:::caution[El historial comparte el mismo modelo de acceso que el canal]
Un cliente que se haya unido a un canal puede reproducir sus mensajes retenidos, incluidos los transmitidos antes de su llegada; la membresía es la única verificación, y unirse está abierto a cualquier cliente que conozca el nombre del canal. La retención se habilita de forma opcional por patrón de canal, por lo que activarla hace que el historial de ese canal sea legible para cualquier visitante que adivine el nombre. En los canales retenidos esto se vuelve duradero en lugar de momentáneo, por lo que debes tratar el contenido de un canal retenido como público para tus usuarios.
:::

## Seguimiento de presencia (Presence Tracking)

El seguimiento de presencia registra qué usuarios están conectados actualmente en un canal y permite a cada usuario compartir un estado personalizado (por ejemplo, la posición del cursor o el estado).

| Tipo de mensaje    | Dirección       | Descripción                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Cliente → Servidor | Iniciar el seguimiento de presencia con un estado personalizado |
| `presence_untrack`| Cliente → Servidor | Detener el seguimiento de presencia                  |
| `presence_state`  | Cliente → Servidor | Solicitar el estado completo de presencia de un canal |
| `presence_state`  | Servidor → Cliente | Entidad completa de todas las presencias en un canal  |
| `presence_diff`   | Servidor → Cliente | Actualización incremental (ingresos y salidas)       |

Cuando un cliente envía `presence_track`, el servidor lo une automáticamente al canal (sin necesidad de un `join_channel` aparte) y difunde un `presence_diff` a todos los miembros del canal. El SDK reenvía su estado cada ~20 segundos como latido (heartbeat); un latido cuyo estado no ha cambiado solo renueva el tiempo de espera del cliente y no envía ningún `presence_diff`.

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

El SDK tipado se reconecta automáticamente cuando se pierde la conexión WebSocket:

- **Retroceso exponencial (Exponential backoff)** — Cada reconexión espera un tramo que empieza en 2 segundos y se duplica cada vez, hasta 30 segundos. El retraso se elige al azar en cualquier punto de su tramo, pero nunca por debajo de un cuarto de segundo, de modo que los clientes que se desconectaron juntos por un despliegue vuelven repartidos a lo largo de todo el tramo en lugar de en el mismo instante.
- **No se rinde mientras algo esté vivo** — Mientras exista una suscripción o un canal al que se haya unido, el cliente sigue reconectándose con el techo de 30 segundos durante toda la interrupción. Sin nada registrado, se detiene tras 5 intentos fallidos, y la siguiente suscripción vuelve a marcar. En un navegador, el evento `online` y que la pestaña vuelva a ser visible provocan ambos una reconexión inmediata en lugar de esperar el retroceso.
- **Las interrupciones se informan una vez** — Cuando la conexión ha estado caída durante 14 segundos, cuantas reconexiones hayan sido, el `onError` de cada suscripción activa y el `onError` de cada canal al que se haya unido recibe un único `RebaseApiError` con el código `CONNECTION_LOST`. La suscripción se **conserva**: el error indica que sus datos no se están actualizando, no que haya terminado.
- **Resuscripción automática** — Al reconectarse con éxito, todas las suscripciones activas se vuelven a registrar en el servidor, y el siguiente `onUpdate` de cada una lleva todo lo que se escribió mientras el cliente estaba fuera. Esa actualización es la señal de recuperación. No requiere intervención manual.
- **Las solicitudes son como mucho una vez** — Una solicitud hecha mientras el socket está caído espera a que vuelva, hasta 30 segundos desde la llamada, y luego falla con `REQUEST_TIMEOUT` sin llegar a enviarse nunca. Una que ya se había enviado cuando la conexión cayó falla con `CONNECTION_LOST` y **no** se vuelve a enviar: el servidor puede haberla ejecutado o no, y solo quien la llamó sabe si ejecutarla dos veces es seguro.

`client.ws.state` indica dónde está la conexión, y `onStateChange` se notifica de
cada cambio. En 0.23 ninguno de los dos existe, el cliente se detiene tras 5 intentos fallidos, y
los mensajes enviados mientras está desconectado se ponen en cola y se envían al reconectar:

| Estado | Significado |
|---|---|
| `idle` | Sin socket, y ninguno deseado todavía (la conexión es diferida), o un cierre de sesión lo eliminó. |
| `connecting` | Marcando, sin ninguna interrupción en curso. |
| `connected` | El socket está abierto. |
| `reconnecting` | El socket se cayó y el cliente está volviendo a marcar. Aún no se ha informado nada. |
| `disconnected` | La interrupción ha durado unos 15 segundos o más. Se ha informado `CONNECTION_LOST`, y el cliente sigue volviendo a marcar. |
| `closed` | Se llamó a `client.close()`. Final. |

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

El panel de administración de Rebase muestra su propio banner mientras el estado es `disconnected`, y conserva las filas y los registros que ya están en pantalla en lugar de sustituirlos por un error.

## Autenticación y RLS

Las suscripciones WebSocket respetan automáticamente las políticas de Row-Level Security (RLS). Cuando el cliente está autenticado:

1. La conexión WebSocket se autentica utilizando el mismo token JWT que la API REST.
2. Cada reconsulta (refetch) de la suscripción se ejecuta dentro de una transacción de PostgreSQL con `set_config('app.user_id', ...)` y `set_config('app.user_roles', ...)`, garantizando la aplicación de las políticas RLS.
3. La identidad se vuelve a comprobar durante todo el tiempo que el socket esté abierto, no solo cuando se autentica. Antes de cada trama, el servidor pregunta lo mismo que preguntaría una solicitud HTTP: si el token sigue siendo válido, si su sesión se cerró o se revocó, si la cuenta todavía existe, y qué roles tiene ahora. Las tramas de canal se preguntan como máximo una vez por segundo. Las tramas que llegan a un mismo socket mientras su comprobación sigue en curso — un cliente que reenvía sus suscripciones tras una reconexión — comparten esa comprobación en lugar de preguntar cada una por separado; la siguiente trama, una vez resuelta, pregunta de nuevo. Un socket que solo escucha se pregunta al menos cada 30 segundos, y un token deja de respetarse en el instante en que expira. Un rol retirado se aplica desde la siguiente trama (o, para una trama que compartió una comprobación ya en curso, desde la que le sigue), tanto a lecturas como a escrituras y a suscripciones abiertas. Un socket cuya identidad ha terminado recibe una trama `AUTH_ERROR` y se cierra con el código `4001`. Con la autenticación integrada, el código de la trama dice por qué, como lo dicen las rutas HTTP: `SESSION_REVOKED` (sesión cerrada, revocada o cuenta eliminada), `ACCOUNT_DISABLED` o `TOKEN_EXPIRED`; el de otro adaptador de autenticación es `SESSION_ENDED`. Un `AUTHENTICATE` para una sesión revocada o una cuenta desactivada se rechaza con `SESSION_REVOKED` o `ACCOUNT_DISABLED` (un token que no se verifica, o que ha expirado, con `INVALID_TOKEN`). El SDK no vuelve a preguntar con el mismo token, y entrega el rechazo, código incluido, al `onError` de lo que necesitaba la cuenta. El SDK vuelve a autenticar su socket cada vez que renueva su token; un token nuevo para la misma identidad (el mismo id de usuario, roles, marca de invitado y claims) deja las suscripciones abiertas como están, y uno para una identidad distinta vuelve a consultar cada una como esa identidad. Tras un `4001` se reconecta con la sesión que tenga en ese momento, o sin ninguna. Un cliente que hable el protocolo directamente tiene que enviar un token nuevo en `AUTHENTICATE` antes de que expire el anterior.

Esto significa que cada socket solo recibe actualizaciones de los registros que su identidad autenticada tiene permiso para ver.

Una [clave de API](/docs/backend/api-keys/) también autentica el socket: envía la
clave `rk_…` donde iría el token de acceso. El socket comprueba entonces cada trama
contra los [alcances](/docs/backend/roles-and-scopes/) de la clave: una lectura, un
recuento o una suscripción necesitan `data:read` en su colección, un guardado
`data:write`, una eliminación `data:delete`. Una ruta anidada necesita el alcance sin
destino. Los canales (difusión y presencia) se rechazan para una clave, porque ningún
alcance los cubre. El editor SQL y los mensajes de ramas necesitan `database:read` o
`database:write`, tanto para una clave como para una persona.

Ejecutar más de una instancia —el bus LISTEN/NOTIFY, el comportamiento de la presencia entre procesos y cómo escribir tu propio transporte— tiene su propia página:
[Tiempo real entre instancias](/docs/backend/realtime-transports/).

## Captura de cambios a nivel de base de datos (CDC)

→ [Captura de cambios a nivel de base de datos (CDC)](/docs/backend/realtime-cdc/)

## Tiempo de espera de solicitudes pendientes (Timeout)

Para evitar que las solicitudes de los clientes se queden colgadas indefinidamente, todas las operaciones WebSocket pendientes que esperan una respuesta del servidor (como las consultas únicas de colecciones `FETCH_COLLECTION`, consultas de entidad única `FETCH_ONE`, creación/actualización `SAVE`, eliminaciones `DELETE`, conteos `COUNT` y comprobaciones de unicidad `CHECK_UNIQUE_FIELD`) tienen un tiempo de espera predeterminado de 30 segundos.

Si el servidor no responde dentro de esta ventana de 30 segundos, el cliente elimina automáticamente la solicitud pendiente y rechaza la promesa con un `ApiError` con el mensaje `"Request timed out"`.

Los mensajes unidireccionales que no esperan respuesta (como `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` y `presence_state`) se resuelven inmediatamente tras la transmisión y no activan tiempos de espera.

### Cuando se rechaza una trama de canal

Una trama de canal es de tipo disparar y olvidar (fire-and-forget): `await channel.broadcast(...)` se resuelve cuando la trama se escribe en el socket, **no** cuando el servidor la ha aceptado. Esto es intencionado: una aplicación colaborativa transmite la posición de un cursor sesenta veces por segundo, y esperar una confirmación de recepción en cada una convertiría cada envío en un viaje de ida y vuelta.

Por tanto, un rechazo no puede ser una promesa rechazada. Llega mediante `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Código | Significado |
|------|-------|
| `CHANNEL_FORBIDDEN` | No eres miembro del canal; únete a él antes de transmitir o leer su historial |
| `RATE_LIMITED` | Has superado el límite de tramas por canal mencionado anteriormente o, en una solicitud de historial, el [límite de tasa de datos](#lo-que-cuesta-una-escritura-y-los-límites) |
| `CHANNEL_HISTORY_WRITE_FAILED` | No se pudo persistir una difusión retenida, por lo que fue descartada |
| `CHANNEL_HISTORY_READ_FAILED` | No se pudo atender una solicitud para ponerse al día |
| `CHANNEL_HISTORY_GAP` | Lo genera el cliente: al ponerse al día se descubrió que el servidor ya no conserva mensajes que este cliente nunca recibió. `details` es `{ from, to }`, los números de secuencia perdidos. Vuelve a sincronizar el estado del canal desde su fuente de verdad |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | La difusión solo llegó a esta instancia; consulta [El límite de 8 KB en el bus de Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Si no se adjunta ningún controlador, estos se registran como una advertencia. Antes se descartaban por completo: no había ninguna promesa que rechazar ni ningún canal al que entregar, por lo que una difusión prohibida no se podía distinguir de una entregada.

## Próximos pasos

- [SDK tipado](/docs/sdk) — Referencia completa del SDK, incluidos los descriptores de acceso tipados a colecciones.
- [Autenticación](/docs/backend/authentication) — Configuración de autenticación JWT y políticas RLS.
- [Arquitectura del backend](/docs/backend) — Descripción general de la arquitectura del servidor Rebase.
