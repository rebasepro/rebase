---
sourceHash: 0804be5779f90bbb
title: Realtime & WebSocket
sidebar_label: Realtime
description: Sincronización de datos en tiempo real, canales de difusión y seguimiento de presencia a través de WebSocket.
---

Rebase incluye un motor de tiempo real integrado que envía los cambios de datos a los clientes conectados a través de WebSocket.
Cuando cualquier registro es creado, actualizado o eliminado, cada suscriptor que observe esa tabla o entidad recibe la actualización al instante, sin necesidad de sondeos (polling).

## Cómo funciona

El pipeline de tiempo real consta de tres etapas:

1. **Trigger de base de datos** — Una mutación llega a la base de datos PostgreSQL (mediante la API REST, el SDK o Studio).
2. **Distribución en abanico (fan-out) del servidor** — El servidor de Rebase detecta el cambio y lo distribuye a cada suscripción WebSocket activa que coincida con la tabla o entidad afectada.
3. **Callback del cliente** — El SDK tipado ejecuta tu callback `onUpdate` con los datos actualizados.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Para despliegues multi-instancia, Rebase utiliza `LISTEN/NOTIFY` de PostgreSQL para transmitir los cambios entre las instancias del servidor. Esto se gestiona automáticamente. Con la [captura de cambios a nivel de base de datos](/docs/backend/realtime-cdc/) habilitada (el valor predeterminado siempre que el rol de la base de datos pueda crear triggers), cada instancia escucha en el canal `rebase_cdc` en el que publican los triggers de captura, por lo que una escritura se percibe independientemente del proceso o herramienta que la haya realizado. Sin captura, cada instancia anuncia sus propias escrituras en el canal `rebase_entity_changes`, y una conexión dedicada en cada una de las demás instancias las retransmite a sus suscriptores locales.

### Cero configuración

El soporte en tiempo real viene habilitado por defecto. No hay que activar ningún flag ni iniciar ningún servicio: si tu servidor Rebase está en ejecución, el endpoint de WebSocket está disponible.

### Qué ruta atiende el socket

El socket responde a solicitudes de actualización (upgrade) en una única ruta: la ruta base de la API sin el `/api` final, es decir, `/` para una API en `/api`. Ahí es donde el SDK se conecta: se conecta a su `baseUrl`, mientras que sus peticiones HTTP van a `${baseUrl}/api`. La actualización a cualquier otra ruta se delega a los demás listeners de `upgrade` del servidor, lo que permite que tu aplicación ejecute su propio servidor WebSocket en el mismo `http.Server`. Si no hay ningún otro listener, dicha actualización se responde con `404`.

En un [servidor personalizado](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` establece la ruta, y la opción `realtime.path` del adaptador de Postgres anula lo que el servidor dedujo.

> De forma predeterminada, Rebase también emite eventos en tiempo real para las escrituras realizadas **fuera** de la API (mediante `psql`, otro servicio o el editor SQL de Studio) siempre que la conexión a la base de datos lo admita; consulta [captura de cambios a nivel de base de datos](/docs/backend/realtime-cdc/).

## Suscripciones del SDK tipado

El SDK tipado de Rebase expone dos métodos de suscripción en cada descriptor de acceso (accessor) de tabla:

- **`listen()`** — Suscribirse a una tabla completa (con filtros opcionales).
- **`listenById()`** — Suscribirse a una única entidad mediante su ID.

Ambos métodos devuelven una **función para cancelar la suscripción (unsubscribe)** a la que se llama para dejar de recibir actualizaciones.

### Suscribirse a una tabla

Utiliza `listen()` para recibir actualizaciones cada vez que cambien los registros de una tabla:

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

El servidor respeta estos filtros: solo se incluyen en las actualizaciones los registros que coincidan.

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

El callback recibe la fila, aplanada, tal como la devuelve `findById()` (`row.name`, no `row.values.name`), o `undefined` una vez que la fila se elimina.

**Cada frame lleva la versión de la fila.** `etagOf(row)` es el `ETag` que responde un `GET` de la fila, de modo que una edición realizada sobre lo que mostró un frame se puede guardar con `ifMatch: etagOf(row)` y se rechaza con `412` si la fila ha cambiado (consulta [Escrituras condicionales](/docs/backend/writes/)). A nivel de red, el método `subscribe_one` del SDK solicita con `etag: true`, y cada frame `single_update` para una fila que existe lleva `"etag"` junto a `"row"`. Un servidor anterior a esto ignora la petición y no envía la etiqueta, y un cliente que no la solicite recibe frames sin ella.

### Cancelar la suscripción

Tanto `listen()` como `listenById()` devuelven una función de cancelación de suscripción. Llámala para dejar de recibir actualizaciones y liberar recursos del lado del servidor:

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

## `.listen()` en el Query Builder

El query builder fluido también admite suscripciones en tiempo real. Encadena tus filtros y luego llama a `.listen()` en lugar de `.find()`:

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
`.listen()` —tanto en el query builder como en el descriptor de acceso a la tabla— necesita el WebSocket del cliente. El cliente deduce su URL a partir de `baseUrl` a menos que se proporcione `websocketUrl`. En un cliente creado con `realtime: false`, o en uno que no haya podido deducir ninguna URL, llamar a `.listen()` lanzará un error.
:::

## Entrega de actualizaciones: Instant Patch + Correctness Refetch

Un cambio nunca viaja a un suscriptor como datos directos. Viaja como el hecho de que algo cambió, y luego a cada suscriptor se le comunica lo que *él* puede ver mediante una consulta ejecutada en su nombre:

1. **Invalidación.** Cuando una entidad cambia (creada, actualizada, eliminada), el servidor marca las rutas afectadas. La fila que se escribió no se reenvía: se leyó bajo la autorización del autor de la escritura, lo cual no indica nada sobre lo que cualquier suscriptor tiene permitido ver.

2. **Re-consulta (refetch) RLS con debounce.** Tras **300ms** (`REFETCH_DEBOUNCE_MS`), el servidor vuelve a consultar la tabla con tus filtros y ordenación originales. La consulta se ejecuta dentro de una transacción que establece los parámetros locales de transacción `app.user_id` y `app.user_roles` a partir del `SubscriptionAuthContext` del suscriptor, de modo que Postgres evalúa la Seguridad a Nivel de Fila (Row-Level Security o RLS) bajo la identidad de ese cliente y solo las filas que está autorizado a ver se envían en el `collection_update`. El debounce también agrupa una ráfaga de escrituras en una sola consulta. Espera 300 ms sin cambios adicionales, pero nunca más de **1 s** (`REFETCH_MAX_WAIT_MS`) tras el primero, de modo que una tabla en la que se escribe varias veces por segundo sigue enviando a sus suscriptores un frame al menos una vez por segundo. Configura ese límite con `REALTIME_REFETCH_MAX_WAIT_MS` (o `realtime.refetchMaxWaitMs`): un valor más alto vuelve a consultar una tabla ocupada con menor frecuencia; un valor más bajo envía frames más recientes.

   Una re-consulta que lee exactamente lo que se le envió por última vez a un suscriptor no le envía nada: una escritura en la fila 9.000 de una lista que muestra las primeras 50 cuesta la lectura, no un frame a cada observador. Después de un frame de error, las siguientes filas se envían de nuevo aunque sean las mismas.

Las versiones anteriores enviaban un `collection_patch` inmediato con la fila escrita antes de este refetch, para ofrecer una respuesta entre pestañas en submilisegundos. Dicha fila se había leído bajo el alcance del autor, por lo que podía llegar —y llegaba— a suscriptores cuyas propias políticas la habrían denegado, y tampoco se le aplicaba el filtro `where` de la propia suscripción. El patch se ha eliminado: la latencia percibida para una actualización es ahora la ventana de debounce.

### El refetch es la lectura REST

El refetch ejecuta el mismo pipeline que `GET /api/data/<table>`, con el mismo manejo de `include`. Eso es lo que hace que `find({ q })` y `listen({ q })` devuelvan filas idénticas campo por campo.

Solía ser un método diferente: uno que anidaba cada relación bajo una estructura `{ "__type": "relation" }` y que, debido a que una suscripción no podía incluir un `include`, cargaba de forma diligente (eagerly) **todas** las relaciones declaradas por la tabla. De este modo, la misma consulta respondía con una estructura a través de HTTP y con otra a través del socket, y un cliente que renderizara ambas veía cambiar la estructura de sus filas en el momento en que se producía una escritura.

Por lo tanto, un frame de suscripción acepta lo mismo que una petición de listado: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` y `fields`. `vectorSearch` es la excepción y se **rechaza** con `VECTOR_SEARCH_NOT_LIVE`: una suscripción se vuelve a ejecutar con cada escritura coincidente y nada en ese proceso calcula distancias.

### `collection_update` incluye sus propios metadatos

El frame es `{ rows, pks, meta }`:

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` se contabiliza dentro de la misma transacción sujeta a RLS que leyó las filas, por lo que describe exactamente las filas que lo acompañan. Sin esto, un cliente que necesitara un total tenía que emitir un `GET /count` **por cada push**: un viaje de ida y vuelta (round trip) adicional por escritura y por suscriptor, además de una ventana en la que el conteo y las filas describían estados distintos de la tabla.

Cuando el conteo en sí falla, el frame incluye `partial: true` y ningún `total`; esto no constituye un error de suscripción, y el cliente debería conservar el último total real en lugar de sustituirlo por la longitud de la página. En una tabla grande, el conteo representa la mayor parte del coste de un frame. Con `REALTIME_RECOUNT_INTERVAL_MS` configurado, una lista cuyo último total fue de al menos `REALTIME_RECOUNT_MIN_ROWS` (100.000 por defecto) reutiliza ese total durante dicho intervalo en lugar de volver a contar en cada escritura, y dicho frame incluye `meta.totalAsOf`, indicando el momento en que se tomó el total. Cuando vence el intervalo, una lista cuyo último frame reutilizó el total se vuelve a contabilizar y recibe el nuevo total, se haya escrito algo o no desde entonces. Si no se configura, como ocurre de forma predeterminada, cada frame realiza el conteo.

### Cuánto cuesta una escritura y los límites

Dado que cada frame es una consulta ejecutada en nombre de su suscriptor, el coste de una escritura aumenta con el número de **preguntas distintas realizadas por entidades principales (principals) distintas** sobre la tabla afectada, no con el número de sockets abiertos:

- Las suscripciones que realizan la misma consulta (misma ruta, filtros, ordenación, página, `include`, `fields`, búsqueda) como el mismo principal (mismo id de usuario, roles, flag de invitado y claims) comparten un único refetch. Una escritura en una lista cuesta **una transacción por cada grupo de este tipo** (la lectura y su conteo), sin importar cuántos sockets la mantengan abierta; cada miembro sigue recibiendo un frame construido a partir de filas leídas bajo esa identidad. Una primera página que devuelva menos elementos que su `limit` representa el conjunto completo, por lo que no se contabiliza en absoluto.
- Una suscripción a un único registro solo se consulta cuando cambia su propio registro.
- Los distintos principals nunca comparten una lectura; esto es lo que evita que un frame contenga una fila que su lector no pueda ver. Una lista observada por mil usuarios autenticados distintos implica mil lecturas y mil conteos en cada escritura sobre ella, en mil transacciones.

Medido en un ordenador portátil contra un PostgreSQL local con un pool de 20 conexiones, una sola escritura en una lista:

| Suscriptores | Transacciones por escritura | Último frame tras la escritura |
|---|---|---|
| 1.000, un único principal | 2 | ~310 ms |
| 1.000, cada uno un principal diferente | ~1.000 | ~600 ms |

300 ms de cada uno corresponden al debounce. La segunda fila es el límite superior para el que hay que planificar. Los refetches se ejecutan en el mismo pool que tu tráfico REST, pero utilizan como máximo un cuarto de sus conexiones simultáneamente (5 de las 20 predeterminadas, nunca menos de 2); el resto espera su turno en el servidor, por lo que la distribución (fan-out) de una escritura retrasa sus propios frames en lugar de tus peticiones. Una tabla en la que se escribe varias veces por segundo mientras **cientos de usuarios distintos** observan la misma lista es el escenario en el que esos frames comienzan a retrasarse. Más allá de eso, es preferible utilizar suscripciones más acotadas (una página, un filtro sobre las filas del propio usuario) o un [canal de difusión (broadcast)](#canales-de-difusión-broadcast-channels) que transmita el cambio para que los clientes vuelvan a consultarlo a su propio ritmo.

**Un socket puede mantener como máximo 1.000 suscripciones.** La siguiente se rechaza con un frame de error con el código `TOO_MANY_SUBSCRIPTIONS`; volver a suscribirse con un id que el socket ya mantiene reemplaza esa suscripción y no vuelve a contar. El SDK comparte suscripciones idénticas en un socket, por lo que esto contabiliza las listas y registros distintos que tiene abiertos una página. Modifícalo con `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` o `realtime.maxSubscriptionsPerSocket` en el adaptador de Postgres (la variable de entorno tiene prioridad); un valor que no sea un número entero positivo detiene el servidor al arrancar. **Los sockets que mantiene un usuario también se pueden limitar**, por instancia de servidor: define `REALTIME_MAX_SOCKETS_PER_USER` (o `realtime.maxSocketsPerUser`), y un inicio de sesión que lo supere se rechazará con `TOO_MANY_SOCKETS` y el socket se cerrará con el código 4002. Los sockets autenticados con una clave de API cuentan para esa clave, cada clave por separado, no para la cuenta que la creó; la clave de servicio es una sola credencial, por lo que todos sus sockets cuentan juntos. Los sockets de un administrador que suplanta a un usuario cuentan para el administrador, junto con sus propios sockets, no para el usuario como el que actúa. El SDK notifica a todas las suscripciones activas y a `onConnectionLost` simultáneamente, con un error `CONNECTION_LOST` cuyo `details.reason` es `TOO_MANY_SOCKETS`, y continúa reintentando, esperando más tiempo en cada ocasión hasta 30 s, de modo que la pestaña pueda entrar una vez que se cierre otro socket. Si no se configura, como ocurre de forma predeterminada, no hay límite.

Un id de suscripción es propio del socket: dos clientes que llamen a una suscripción `"sub-1"` conservan cada uno la suya, y un `unsubscribe` finaliza únicamente la del remitente.

**Suscribirse cuenta para el límite de tasa (rate limit) de datos.** El primer frame de una suscripción es una lectura, ejecutada en nombre del suscriptor, al igual que una solicitud de historial de un canal. Por lo tanto, `subscribe_collection`, `subscribe_one` y `channel_history` cuentan como peticiones de datos en el bucket de límite de tasa del llamador (el que comparten sus peticiones HTTP y sus otros sockets) una vez agotada la asignación propia del socket. Cada socket puede enviar 1.000 de ellas sin que computen, o tantas como su límite máximo de suscripciones cuando este sea superior, y la asignación se repone a lo largo de 15 minutos. Eso es todo lo que un socket puede contener, por lo que la re-suscripción tras una reconexión nunca se rechaza y nunca consume el cupo de la persona. Superada la asignación, cualquier frame que exceda el límite se rechaza con un frame de error con código `RATE_LIMITED`, el cual el SDK entrega al `onError` de esa suscripción o al del canal.

### Sockets que dejan de responder

Un cliente puede desaparecer sin cerrar su socket: un teléfono pierde la señal, un portátil entra en suspensión, un NAT olvida la conexión. No llega ningún frame de cierre, por lo que nada avisa al servidor. Por lo tanto, el servidor envía un ping a cada socket cada 30 segundos y finaliza cualquiera que no haya respondido para el siguiente ping, de modo que un cliente desaparecido se libera en menos de un minuto. Los navegadores y el SDK responden a los pings por sí mismos; un cliente que implemente el protocolo directamente también debe responderlos, como hace la mayoría de las librerías de WebSocket.

**El lado del navegador.** Un navegador no puede enviar un ping ni verlo, por lo que un socket semiabierto le parece conectado para siempre. El SDK abre el socket con `?rebase_caps=heartbeat,channel_seq,cancel_sql`; un servidor que los reconozca responde con `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, enumerando los que admite (`cancel_sql`: acepta el frame `CANCEL_SQL` de la consola SQL), y envía `{"type":"heartbeat"}` cada 30 segundos, y el SDK desconecta el socket y [se reconecta](#reconexión-automática) tras perderse dos de ellos. A un cliente que no especifique nada no se le envía ninguno de los dos, y un servidor más antiguo ignora el parámetro, por lo que un SDK que se comunique con él se comporta como antes.

Un socket también se finaliza cuando más de 16&nbsp;MiB de frames enviados hacia él permanecen sin leer. Este es el caso de un cliente que no lee lo que se le envía, o uno tan rezagado que lo que leería estaría obsoleto. Y cuando los sockets de un servidor acumulan conjuntamente más de 256&nbsp;MiB sin leer (o una cuarta parte del límite de memoria bajo el cual se ejecuta el servidor, si esta cifra es menor), los que tengan más datos sin leer se terminan primero, hasta que el resto quepa.

Un socket finalizado se limpia del mismo modo que uno cerrado. Sus suscripciones terminan, abandona sus canales y se elimina su presencia, anunciando su salida al resto de miembros. Un cliente que todavía siga presente ve caer la conexión, y el SDK [se reconecta](#reconexión-automática) y se suscribe nuevamente.

## Canales de difusión (Broadcast Channels)

Los canales de difusión (broadcast channels) permiten que los clientes se envíen mensajes arbitrarios entre sí en tiempo real, lo que resulta útil para funciones como indicadores de escritura, posiciones del cursor o notificaciones personalizadas.

La difusión se gestiona a nivel del protocolo WebSocket. El servidor admite los siguientes tipos de mensaje:

| Tipo de mensaje | Dirección | Descripción |
|---|---|---|
| `join_channel` | Cliente → Servidor | Unirse a un canal con nombre |
| `leave_channel` | Cliente → Servidor | Abandonar un canal |
| `broadcast` | Cliente → Servidor | Enviar un mensaje a todos los miembros del canal |
| `broadcast` | Servidor → Cliente | Recibir un mensaje de otro miembro |
| `channel_history` | Cliente → Servidor | Solicitar mensajes retenidos después de una secuencia |
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

De forma predeterminada, una difusión llega a los miembros conectados en ese momento y luego desaparece. Ese es el balance adecuado para notificaciones y cursores, y no tiene ningún coste.

Para un flujo de operaciones (edición colaborativa, o cualquier caso donde una brecha silenciosa provoque divergencias), se puede configurar un canal para que **retenga** sus mensajes. A las difusiones retenidas se les asigna un número de secuencia por canal y se almacenan, de modo que un cliente que se reconecte pueda solicitar todo lo ocurrido después del último mensaje que vio.

:::caution[Dónde se configura esto]
**Runtime gestionado: en ningún sitio.** La retención de canales y `realtime.bus` forman parte del adaptador de base de datos que el runtime gestionado construye por sí mismo, y ninguno de los dos tiene una forma mediante variables de entorno. Haz un eject para configurarlos.
**Tras eject:** `createPostgresAdapter({ realtime })` en `backend/src/index.ts`.
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
|---|---|
| `match` | Nombre exacto del canal (`"doc:42"`) o un prefijo con asterisco final (`"doc:*"`) |
| `limit` | Conservar como máximo esta cantidad de los mensajes más recientes por canal |
| `ttl` | Conservar los mensajes durante este tiempo como máximo: `"30s"`, `"15m"`, `"24h"`, `"7d"` o milisegundos |

Una regla necesita al menos uno de entre `limit` o `ttl`. Una que no tenga ninguno se ignora y se registra en los logs, ya que una retención ilimitada casi nunca es la intención y no se puede revertir fácilmente una vez que la tabla ha crecido.

:::note[¿Por qué no dejar que los clientes pidan el historial?]
Un canal lo crea quienquiera que le dé nombre. Si un cliente pudiera elegir la profundidad de su propio historial, cualquier visitante podría comprometer tu backend a un almacenamiento ilimitado. Configurarlo aquí también significa que los canales de presencia y de notificación —la inmensa mayoría— no pagan ningún coste: sin reglas configuradas, no se crea ninguna tabla y el broadcast sigue la misma ruta sincrónica de siempre.
:::

### Almacenamiento

Los canales retenidos utilizan dos tablas en el esquema `rebase`, creadas automáticamente al iniciar cuando se configura al menos una regla:

| Tabla | Contenido |
|---|---|
| `rebase.channel_messages` | Los mensajes retenidos, identificados por `(channel, seq)` |
| `rebase.channel_cursors` | La secuencia más alta emitida por canal |

La purga (pruning) se realiza a medida que llegan los mensajes, regulada por canal para que el coste dependa del tiempo transcurrido en lugar del volumen de escritura. Solo elimina filas de `channel_messages`: los cursores se conservan indefinidamente (son una fila pequeña por canal), ya que reiniciar la secuencia de un canal alteraría el significado del punto de reanudación guardado por un cliente.

### Garantías de entrega

- **Ordenada.** Los números de secuencia se asignan por canal y el orden de entrega coincide con el orden de secuencia: en una sola instancia y entre instancias en el bus `postgres`, donde la sentencia que numera un mensaje también lo anuncia, de modo que cada instancia (incluida la del remitente) recibe los anuncios en orden de secuencia. Un bus suministrado por ti transporta los frames en el orden en que los entregue.
- **Durable antes de ser entregado.** Un mensaje que no se puede almacenar no se entrega a nadie, y se informa al remitente. Entregarlo lo pondría frente a los suscriptores en vivo dejándolo fuera de cualquier reproducción futura, y ningún mensaje posterior podría reparar ese vacío.
- **Al menos una vez (at-least-once) al ponerse al día.** Un rango de reproducción puede solaparse con mensajes que un cliente ya recibió; el SDK descarta los que ya ha entregado.
- **Sin huecos (no holes).** Un mensaje retenido llega a todos los miembros: al remitente, a quien nunca se le envía su propio mensaje, se le envía en su lugar `{"type":"broadcast_ack","channel","seq"}` cuando optó por `channel_seq`. Por lo tanto, un mensaje posterior a `lastSeq + 1` significa que se omitió uno, y el SDK lo retiene, solicita el historial intermedio y los entrega todos en orden. Frente a un servidor sin `channel_seq`, un salto se entrega tal como llega.

:::caution[El historial tiene el mismo modelo de acceso que el canal]
Un cliente que se haya unido a un canal puede reproducir sus mensajes retenidos, incluidos los transmitidos antes de su llegada: la pertenencia es la única comprobación, y unirse está abierto a cualquier cliente que conozca el nombre del canal. La retención se habilita de forma opcional por patrón de canal, por lo que activarla hace que el pasado de ese canal sea legible para cualquier visitante que adivine el nombre. Los canales retenidos representan el caso en que esto se vuelve duradero en lugar de momentáneo, así que trata el contenido de un canal retenido como público para tus usuarios.
:::

## Seguimiento de presencia (Presence Tracking)

La presencia permite saber qué usuarios están conectados actualmente en un canal y permite que cada usuario comparta un estado personalizado (por ejemplo, posición del cursor, estado).

| Tipo de mensaje | Dirección | Descripción |
|---|---|---|
| `presence_track` | Cliente → Servidor | Comenzar a rastrear la presencia con un estado personalizado |
| `presence_untrack` | Cliente → Servidor | Dejar de rastrear la presencia |
| `presence_state` | Cliente → Servidor | Solicitar el estado completo de presencia de un canal |
| `presence_state` | Servidor → Cliente | Todas las presencias en el canal, al completo |
| `presence_diff` | Servidor → Cliente | Actualización incremental (entradas y salidas) |

Cuando un cliente envía `presence_track`, el servidor lo une automáticamente al canal (sin necesidad de un `join_channel` por separado) y emite un `presence_diff` a todos los miembros del canal. El SDK reenvía su estado cada ~20 segundos como latido (heartbeat); un heartbeat cuyo estado no haya cambiado solo renueva el tiempo de espera del cliente y no envía ningún `presence_diff`.

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

Las presencias inactivas se limpian automáticamente tras 30 segundos de inactividad.

## Reconexión automática

El SDK tipado se reconecta automáticamente cuando se interrumpe la conexión WebSocket:

- **Retroceso exponencial (exponential backoff)** — Cada reintento de conexión espera un intervalo que comienza en 2 segundos y se duplica cada vez, hasta un máximo de 30 segundos. El retraso se elige de forma aleatoria dentro de su intervalo, pero nunca por debajo de un cuarto de segundo, de modo que los clientes desconectados simultáneamente por un despliegue vuelvan distribuidos a lo largo de todo el intervalo en lugar de en el mismo instante.
- **No se rinde mientras haya algo activo** — Mientras exista una suscripción o un canal al que se esté unido, el cliente continúa reintentando la conexión en el tope de 30 segundos mientras dure la interrupción. Si no hay nada registrado, se detiene tras 5 intentos fallidos, y la siguiente suscripción volverá a iniciar la conexión. En un navegador, tanto el evento `online` como el hecho de que la pestaña vuelva a ser visible provocan un reintento inmediato en lugar de esperar a que termine el tiempo de retroceso.
- **Las interrupciones se notifican una sola vez** — Cuando la conexión ha estado caída durante 14 segundos, sin importar cuántos reintentos haya tomado, el callback `onError` de cada suscripción activa y de cada canal unido recibe un `RebaseApiError` con el código `CONNECTION_LOST`. La suscripción se **mantiene**: el error indica que sus datos no se están actualizando, no que haya finalizado.
- **Resuscripción automática** — Tras una reconexión exitosa, todas las suscripciones activas se vuelven a registrar en el servidor, y el siguiente `onUpdate` de cada una incluye lo que se haya escrito mientras el cliente estuvo ausente. Dicha actualización es la señal de recuperación. No se requiere intervención manual.
- **Las peticiones son como máximo una vez (at-most-once)** — Una petición realizada mientras el socket está caído espera por él hasta 30 segundos desde la llamada, y luego falla con `REQUEST_TIMEOUT` sin haberse enviado nunca. Una petición que ya se había enviado cuando cayó la conexión falla con `CONNECTION_LOST` y **no** se vuelve a enviar: el servidor puede o no haberla ejecutado, y solo el llamador sabe si es seguro ejecutarla dos veces.

`client.ws.state` indica el estado de la conexión, y `onStateChange` recibe cada cambio:

| Estado | Significado |
|---|---|
| `idle` | Sin socket, y aún no se requiere ninguno (la conexión es perezosa o lazy), o un cierre de sesión lo desconectó. |
| `connecting` | Conectando, sin ninguna interrupción en curso. |
| `connected` | El socket está abierto. |
| `reconnecting` | El socket cayó y el cliente está reintentando la conexión. Todavía no se ha notificado nada. |
| `disconnected` | La interrupción ha durado 14 segundos o más. Se ha notificado `CONNECTION_LOST` y el cliente sigue reintentando. |
| `closed` | Se llamó a `client.close()`. Estado final. |

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

El panel de administración de Rebase muestra un banner propio mientras el estado sea `disconnected`, y mantiene las filas y registros que ya están en pantalla en lugar de reemplazarlos por un error.

## Autenticación y RLS

Las suscripciones WebSocket respetan automáticamente las directivas de seguridad a nivel de fila (Row-Level Security o RLS). Cuando el cliente está autenticado:

1. La conexión WebSocket se autentica utilizando el mismo token JWT que la API REST.
2. Cada refetch de suscripción se ejecuta dentro de una transacción de PostgreSQL con `set_config('app.user_id', ...)` y `set_config('app.user_roles', ...)`, garantizando que se apliquen las políticas de RLS.
3. La identidad se verifica periódicamente mientras el socket permanezca abierto, no solo al autenticarse. Antes de cada frame, el servidor comprueba lo mismo que comprobaría una petición HTTP: si el token sigue siendo válido, si su sesión fue cerrada o revocada, si la cuenta todavía existe y qué roles posee ahora. Los frames de canal se comprueban como máximo una vez por segundo. Los frames que llegan a un socket mientras su verificación aún está en curso —un cliente que reenvía sus suscripciones tras una reconexión— comparten esa verificación en lugar de consultar cada uno por separado; el siguiente frame una vez resuelta realiza una nueva comprobación. Un socket que solo escucha se comprueba al menos cada 30 segundos, y un token deja de aceptarse en el mismo instante en que expira. La retirada de un rol se aplica a partir del siguiente frame (o, para un frame que compartió una comprobación ya en curso, a partir del posterior), tanto a lecturas como a escrituras y suscripciones abiertas. Un socket cuya identidad haya expirado o terminado recibe un frame `AUTH_ERROR` y se cierra con el código `4001`. Con la autenticación integrada, el código del frame explica el motivo, tal como lo indican las rutas HTTP: `SESSION_REVOKED` (sesión cerrada, revocada o cuenta eliminada), `ACCOUNT_DISABLED` o `TOKEN_EXPIRED`; en el caso de otro adaptador de autenticación, es `SESSION_ENDED`. Un `AUTHENTICATE` para una sesión revocada o una cuenta deshabilitada se rechaza con `SESSION_REVOKED` o `ACCOUNT_DISABLED` (un token que no se verifique o haya expirado, con `INVALID_TOKEN`). El SDK no vuelve a solicitarlo con el mismo token y entrega el rechazo, código incluido, al `onError` de aquello que requería la cuenta. El SDK vuelve a autenticar su socket cada vez que renueva su token; un nuevo token para la misma identidad (mismo id de usuario, roles, flag de invitado y claims) mantiene las suscripciones abiertas tal como están, y uno para una identidad distinta vuelve a consultar cada una de ellas bajo esa nueva identidad. Tras un error `4001`, se reconecta con la sesión que posea en ese momento, o sin ninguna. Un cliente que hable directamente el protocolo debe enviar un nuevo token en `AUTHENTICATE` antes de que el anterior expire.

Esto significa que cada socket solo recibe actualizaciones de los registros que su identidad autenticada tiene permiso para ver.

Una [clave de API](/docs/backend/api-keys/) también autentica el socket: envía la clave `rk_…` en el lugar donde iría el token de acceso. A continuación, el socket comprueba cada frame con respecto a los [ámbitos (scopes)](/docs/backend/roles-and-scopes/) de la clave: una lectura (fetch), un conteo o una suscripción requiere `data:read` en su tabla, un guardado `data:write`, una eliminación `data:delete`. Una ruta anidada necesita el ámbito base simple. Los canales (broadcast y presencia) se rechazan para una clave, ya que ningún ámbito los cubre. El editor SQL y los mensajes de rama requieren `database:read` o `database:write`, tanto para una clave como para una persona.

Ejecutar más de una instancia —el bus LISTEN/NOTIFY, lo que hace la presencia entre procesos y cómo escribir tu propio transporte— tiene su propia página:
[Tiempo real entre instancias](/docs/backend/realtime-transports/).

## Captura de cambios a nivel de base de datos (CDC)

Cada escritura confirmada (committed) emite eventos en tiempo real, sin importar cómo se haya realizado: REST, el SDK, Studio, `psql` o una tarea cron en otro servicio. Cómo funciona la captura, la configuración `REALTIME_CDC` y lo que necesita: [Captura de cambios en la base de datos](/docs/backend/realtime-cdc/).

## Tiempo de espera para peticiones pendientes (Pending Request Timeout)

Para evitar que las peticiones del cliente se queden colgadas indefinidamente, todas las operaciones WebSocket pendientes que esperan una respuesta del servidor (como las lecturas puntuales de tablas `FETCH_COLLECTION`, lecturas de una sola entidad `FETCH_ONE`, creación/actualización `SAVE`, eliminaciones `DELETE`, conteos `COUNT` y comprobaciones de unicidad `CHECK_UNIQUE_FIELD`) tienen un tiempo de espera (timeout) predeterminado de 30 segundos.

Si el servidor no responde dentro de esta ventana de 30 segundos, el cliente elimina automáticamente la petición pendiente y rechaza la promesa con un `RebaseApiError` cuyo código es `REQUEST_TIMEOUT`.

Los mensajes unidireccionales que no esperan respuesta (como `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` y `channel_history`) se resuelven inmediatamente tras su transmisión y no activan este timeout. Una suscripción cuyo primer frame no haya llegado 30 segundos después de haber enviado la solicitud de suscripción falla en su lugar, emitiendo `SUBSCRIPTION_TIMEOUT` en su callback `onError`.

### Cuando se rechaza un frame de canal

Un frame de canal funciona bajo el modelo de "disparar y olvidar" (fire-and-forget): `await channel.broadcast(...)` se resuelve cuando el frame se escribe en el socket, **no** cuando el servidor lo ha aceptado. Esto es intencionado: una aplicación colaborativa transmite la posición del cursor sesenta veces por segundo, y esperar un acuse de recibo (acknowledgement) en cada una convertiría cada emisión en un viaje de ida y vuelta.

Por lo tanto, un rechazo no puede ser una promesa rechazada. Llega a través de `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Código | Significado |
|---|---|
| `CHANNEL_FORBIDDEN` | No eres miembro del canal: únete antes de transmitir o leer su historial |
| `RATE_LIMITED` | Se superó el límite de frames de canal (7.200 frames de canal por minuto por socket) o, para una petición de historial, se superó el [límite de tasa de datos](#cuánto-cuesta-una-escritura-y-los-límites) |
| `CHANNEL_HISTORY_WRITE_FAILED` | No se pudo persistir una difusión retenida, por lo que fue descartada |
| `CHANNEL_HISTORY_READ_FAILED` | No se pudo atender una solicitud para ponerse al día (catch-up) |
| `CHANNEL_HISTORY_GAP` | Generado por el cliente: un proceso de puesta al día detectó que el servidor ya no retiene los mensajes que este cliente nunca recibió. `details` contiene `{ from, to }`, los números de secuencia perdidos. Resincroniza el estado del canal desde su fuente de verdad |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | La difusión llegó únicamente a esta instancia; consulta [El límite de 8 KB en el bus de Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Si no hay ningún controlador adjunto, estos errores se registran como advertencia en los logs. Anteriormente se descartaban por completo: no había ninguna promesa que rechazar ni ningún canal al que entregarlos, por lo que una difusión prohibida no se podía distinguir de una entregada.

## Próximos pasos

- [SDK tipado](/docs/sdk) — Referencia completa del SDK, incluidos los descriptores de acceso a tablas tipados.
- [Autenticación](/docs/backend/authentication) — Configuración de autenticación JWT y directivas RLS.
- [Arquitectura del backend](/docs/backend) — Visión general de la arquitectura del servidor Rebase.
