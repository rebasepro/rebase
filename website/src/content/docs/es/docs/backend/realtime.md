---
sourceHash: 512b1a9970d23a5b
title: Realtime y WebSocket
sidebar_label: Realtime
description: Sincronización de datos en tiempo real, canales de difusión y seguimiento de presencia mediante WebSocket.
---

Rebase incluye un motor en tiempo real integrado que envía cambios de datos a los clientes conectados a través de WebSocket.
Cuando cualquier registro se crea, actualiza o elimina, cada suscriptor que esté observando esa tabla o entidad recibe la actualización al instante, sin necesidad de sondeo (polling).

## Cómo funciona

La canalización en tiempo real consta de tres etapas:

1. **Disparador en base de datos** — Una mutación llega a la base de datos PostgreSQL (mediante API REST, SDK o Studio).
2. **Distribución en el servidor (fan-out)** — El servidor de Rebase detecta el cambio y lo distribuye a cada suscripción WebSocket activa que coincida con la tabla o entidad afectada.
3. **Callback del cliente** — El SDK tipado dispara tu callback `onUpdate` con los datos actualizados.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Para implementaciones de múltiples instancias, Rebase utiliza `LISTEN/NOTIFY` de PostgreSQL para transportar los cambios entre las instancias del servidor. Esto se maneja automáticamente. Con la [captura de cambios a nivel de base de datos](/docs/backend/realtime-cdc/) activada (el valor predeterminado siempre que el rol de la base de datos pueda crear triggers), cada instancia escucha en el canal `rebase_cdc` al que publican los disparadores de captura, de modo que se registra una escritura sin importar qué proceso o herramienta la haya realizado. Sin la captura, cada instancia anuncia sus propias escrituras en el canal `rebase_entity_changes`, y una conexión dedicada en cada otra instancia las retransmite a sus suscriptores locales.

### Cero configuración

El tiempo real está habilitado de forma predeterminada. No hay ninguna bandera que activar ni servicio que iniciar: si tu servidor Rebase se está ejecutando, el endpoint de WebSocket está disponible.

### A qué ruta responde el socket

El socket responde a las actualizaciones (upgrades) en una sola ruta: la ruta base de la API sin el `/api` final, es decir, `/` para una API en `/api`. Ahí es donde se conecta el SDK: se conecta a su `baseUrl`, mientras que sus peticiones HTTP van a `${baseUrl}/api`. Una actualización a cualquier otra ruta se delega a los demás listeners `upgrade` del servidor, por lo que tu aplicación puede ejecutar su propio servidor WebSocket en el mismo `http.Server`. Si no hay ningún otro listener, dicha actualización responde con un `404`.

En un [servidor personalizado](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` define la ruta, y la opción `realtime.path` del adaptador de Postgres sobrescribe la que el servidor derivó.

> De forma predeterminada, Rebase también emite eventos en tiempo real para escrituras realizadas **fuera** de la API (mediante `psql`, otro servicio o el editor SQL de Studio) siempre que la conexión a la base de datos lo admita; consulta [captura de cambios a nivel de base de datos](/docs/backend/realtime-cdc/).

## Suscripciones con el SDK tipado

El SDK tipado de Rebase expone dos métodos de suscripción en el descriptor de acceso de cada tabla:

- **`listen()`** — Suscríbete a una tabla completa (con filtros opcionales).
- **`listenById()`** — Suscríbete a una sola entidad por su ID.

Ambos métodos devuelven una **función para cancelar la suscripción** que ejecutas para dejar de recibir actualizaciones.

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
- `data` — Las filas, planas, tal como las devuelve `find()` (`row.name`, no `row.values.name`).
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

El callback recibe la fila, plana, tal como la devuelve `findById()` (`row.name`, no `row.values.name`), o `undefined` una vez que la fila se elimina.

**Cada frame transporta la versión de la fila.** `etagOf(row)` es el `ETag` al que responde un `GET` de la fila, por lo que una edición realizada sobre lo que mostró un frame se puede guardar con `ifMatch: etagOf(row)` y se rechaza con un `412` si la fila ha cambiado (consulta [Escrituras condicionales](/docs/backend/writes/)). En la red, el `subscribe_one` del SDK solicita con `etag: true`, y cada frame `single_update` para una fila existente lleva `"etag"` junto a `"row"`. Un servidor anterior a esto ignora la solicitud y no envía ninguna etiqueta, y un cliente que no lo solicite obtiene frames sin ella.

### Cancelar suscripciones

Tanto `listen()` como `listenById()` devuelven una función de cancelación de suscripción. Llámala para dejar de recibir actualizaciones y liberar recursos del lado del servidor:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Llama siempre a la función para cancelar la suscripción cuando un componente se desmonte o una página cambie de ruta. Esto evita fugas de memoria y trabajo innecesario en el servidor.
:::

## Query Builder `.listen()`

El generador de consultas fluido también admite suscripciones en tiempo real. Encadena tus filtros y luego llama a `.listen()` en lugar de `.find()`:

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
`.listen()` — tanto en el query builder como en el descriptor de la tabla — requiere el WebSocket del cliente. El cliente deriva su URL a partir de `baseUrl` a menos que se proporcione `websocketUrl`. En un cliente creado con `realtime: false`, o uno que no pudo derivar ninguna URL, llamar a `.listen()` arroja un error.
:::

## Entrega de actualizaciones: Instant Patch + Refetch de corrección

Un cambio nunca viaja a un suscriptor en forma de datos. Viaja como el hecho de que algo cambió, y a cada suscriptor se le informa lo que *él* puede ver mediante una consulta ejecutada en su nombre:

1. **Invalidación.** Cuando una entidad cambia (creada, actualizada, eliminada), el servidor marca las rutas afectadas. La fila escrita no se reenvía: se leyó bajo la autorización del autor de la escritura, lo cual no indica nada sobre lo que un suscriptor tiene permitido ver.

2. **Refetch de RLS con debounce.** Tras **300ms** (`REFETCH_DEBOUNCE_MS`), el servidor vuelve a consultar la tabla con tus filtros y orden originales. La consulta se ejecuta dentro de una transacción que establece los parámetros locales de la transacción `app.user_id` y `app.user_roles` a partir del `SubscriptionAuthContext` del suscriptor, de modo que Postgres evalúa la Seguridad a Nivel de Fila (RLS) bajo la identidad de ese cliente y solo las filas que tiene autorización para ver se envían en el `collection_update`. El debounce también agrupa una ráfaga de escrituras en una sola consulta. Espera 300 ms sin un cambio posterior, pero nunca más de **1 s** (`REFETCH_MAX_WAIT_MS`) después del primero, de modo que una tabla modificada varias veces por segundo seguirá enviando a sus suscriptores un frame al menos una vez por segundo. Configura ese límite con `REALTIME_REFETCH_MAX_WAIT_MS` (o `realtime.refetchMaxWaitMs`): un valor más alto actualiza una tabla muy activa con menor frecuencia, uno más bajo envía frames más frescos.

   Un refetch que lee exactamente lo que se le envió al suscriptor por última vez no le envía nada: escribir en la fila 9.000 de una lista que muestra las primeras 50 cuesta la lectura, no un frame a cada observador. Tras un frame de error, las siguientes filas se envían de nuevo incluso si son idénticas.

Las versiones anteriores enviaban un `collection_patch` inmediato con la fila escrita antes de este refetch, para obtener una respuesta en menos de un milisegundo entre pestañas. Esa fila se había leído bajo el alcance del autor de la escritura, por lo que podía —y de hecho lo hacía— llegar a suscriptores cuyas propias políticas la habrían denegado, y el propio filtro `where` de la suscripción tampoco se le aplicaba. El parche ha sido eliminado: la latencia percibida para una actualización es ahora la ventana de debounce.

### El refetch es la lectura REST

El refetch ejecuta la misma canalización que ejecuta `GET /api/data/<table>`, con el mismo manejo de `include`. Eso es lo que hace que `find({ q })` y `listen({ q })` devuelvan filas que son idénticas campo por campo.

Solía ser un método diferente: uno que anidaba cada relación bajo una estructura `{ "__type": "relation" }` y, dado que una suscripción no podía incluir un `include`, cargaba de forma diligente (eager load) **todas** las relaciones que la tabla declaraba. De este modo, la misma consulta respondía con una estructura por HTTP y otra distinta por el socket, y un cliente que renderizaba ambas veía cambiar la forma de sus filas en el momento en que se producía una escritura.

Por lo tanto, un frame de suscripción admite lo mismo que una petición de lista: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` y `fields`. `vectorSearch` es la excepción y se **rechaza** con `VECTOR_SEARCH_NOT_LIVE`: una suscripción se vuelve a ejecutar en cada escritura coincidente y nada en ese proceso calcula distancias.

### `collection_update` transporta sus propios metadatos

El frame tiene la estructura `{ rows, pks, meta }`:

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` se contabiliza dentro de la misma transacción sujeta a RLS que leyó las filas, por lo que describe exactamente las filas que lo acompañan. Sin esto, un cliente que necesitara un total tendría que emitir un `GET /count` **por cada push**: un viaje de ida y vuelta adicional por escritura, por suscriptor, y una ventana de tiempo en la que el recuento y las filas describían estados diferentes de la tabla.

Cuando el recuento en sí falla, el frame incluye `partial: true` y ningún `total`; esto no constituye un error de suscripción, y el cliente debe conservar el último total real en lugar de sustituirlo por la longitud de la página. En una tabla grande, el recuento representa la mayor parte del costo de un frame. Con `REALTIME_RECOUNT_INTERVAL_MS` configurado, una lista cuyo último total fue de al menos `REALTIME_RECOUNT_MIN_ROWS` (100.000 por defecto) reutiliza ese total durante el intervalo en lugar de contar en cada escritura, y dicho frame incluye `meta.totalAsOf`, el momento en que se obtuvo el total. Cuando se agota el intervalo, una lista cuyo último frame reutilizó el total se vuelve a contar y se le envía el nuevo total, se haya escrito algo o no desde entonces. Si no está configurado, como ocurre de forma predeterminada, cada frame realiza el recuento.

### Cuánto cuesta una escritura y sus límites

Dado que cada frame es una consulta ejecutada en nombre de su suscriptor, el costo de una escritura crece con el número de **preguntas distintas realizadas por entidades principales distintas** en la tabla que modificó, no con el número de sockets abiertos:

- Las suscripciones que hacen la misma pregunta (misma ruta, filtros, orden, página, `include`, `fields`, búsqueda) como la misma entidad principal (mismo ID de usuario, roles, bandera de invitado y claims) comparten un solo refetch. Una escritura en una lista cuesta **una transacción por cada grupo de este tipo** —la lectura y su recuento— sin importar cuántos sockets la contengan; cada miembro sigue recibiendo un frame construido a partir de filas leídas bajo esa identidad. Una primera página que devuelve menos elementos que su `limit` constituye el conjunto completo, por lo que no se vuelve a contar.
- Una suscripción de un solo registro solo se evalúa cuando su propio registro cambia.
- Una lista filtrada con `==` o `in` en una columna de la tabla solo se consulta cuando la escritura puede alcanzarla: cuando la fila coincidía con el filtro antes de la escritura o coincide con él después. `listen({ where: { owner: ["==", me] } })` en manos de cinco mil usuarios cuesta una lectura cuando uno de ellos escribe una de sus filas, no cinco mil. Esto solo decide *quién* vuelve a consultar, nunca lo que cada uno recibe: cada lista consultada sigue leyendo bajo el alcance de su propio suscriptor, de modo que una lista que pide filas de otra persona es evaluada y no encuentra nada que su política oculte.
- Diferentes identidades nunca comparten una lectura; eso es lo que evita que un frame transporte una fila que su lector no tiene permitido ver. Una lista que solo RLS restringe (la misma lista sin filtrar, observada por mil usuarios conectados diferentes) implica mil lecturas en cada escritura sobre ella, en mil transacciones.

El prefiltro consulta cada lista de la tabla, como antes, siempre que no pueda estar seguro de que una lista no se vio afectada:

- Evalúa `==` e `in` en columnas de tipo texto, `varchar`, uuid, enum, entero y booleano. Otras condiciones (rangos, patrones, rutas JSON, relaciones, grupos `or(...)`, búsqueda) quedan fuera, lo que solo amplía lo que admite. Una lista que carga relaciones (`include`), una tabla con un hook `afterRead` y una columna con un hook a nivel de campo nunca se prefiltran.
- Necesita los valores de la fila antes y después de la escritura. Una escritura a través de la API los proporciona para una creación, y para una actualización que leyó la fila previamente (toda actualización REST lo hace). Un cambio leído desde el WAL (`REALTIME_CDC=wal`, o `auto` donde el WAL esté disponible) proporciona la nueva fila completa, pero la anterior solo como su clave a menos que la tabla tenga `REPLICA IDENTITY FULL`; por lo tanto, un `UPDATE` o `DELETE` externo de una columna que no sea clave consulta todas las listas. El disparador de captura (`REALTIME_CDC=trigger`) envía únicamente la clave, por lo que solo puede descartar listas filtradas por la clave. Una eliminación a través de la API, y una clave demasiado grande para notificar, consultan todas las listas.

Medido en una laptop contra PostgreSQL 18 en Docker, con un pool de 20 conexiones (`tooling/scripts/bench-realtime-fanout.mts`), una escritura en una tabla cuya política muestra a cada usuario sus propias filas:

| Suscriptores en la tabla | Transacciones para la escritura | Fan-out completado tras la escritura |
|--------------------------|----------------------------|------------------------------|
| 5.000 usuarios, cada uno `where owner == me`, escritura a través de la API | 1 | ~305 ms |
| 5.000 usuarios, cada uno `where owner == me`, SQL puro leído desde el WAL | 1 | ~307 ms |
| 5.000 sockets de un usuario, una lista | 1 | ~311 ms |
| 1.000 usuarios, la misma lista sin filtrar | 1.000 | ~780 ms |
| 5.000 usuarios, la misma lista sin filtrar | 5.000 | ~2,6 s |

300 ms de cada uno corresponden al debounce. Las dos últimas filas representan el techo que se debe planificar: una lista que solo RLS delimita cuesta una lectura por usuario distinto por cada escritura. Los refetches se ejecutan en el mismo pool que tu tráfico REST, pero como máximo en una cuarta parte de sus conexiones a la vez (5 de las 20 predeterminadas, nunca menos de 2); el resto espera su turno en el servidor, por lo que el fan-out de una escritura retrasa sus propios frames en lugar de tus peticiones. Una tabla en la que se escribe varias veces por segundo mientras **miles de usuarios diferentes** observan la misma lista sin filtrar es el punto donde esos frames comienzan a retrasarse. Filtra la suscripción por la columna que lee tu política (`where owner == me` junto a `owner = app.uid`) y volverá a costar una sola lectura; o utiliza un [canal de difusión](#canales-de-difusión-broadcast-channels) que transporte el cambio para que los clientes vuelvan a consultar según su propio ritmo.

**Un socket puede mantener un máximo de 1.000 suscripciones.** La siguiente se rechaza con un frame de error con código `TOO_MANY_SUBSCRIPTIONS`; volver a suscribirse con un ID que el socket ya contiene reemplaza esa suscripción y no cuenta nuevamente. El SDK comparte suscripciones idénticas en un socket, por lo que esto cuenta las listas y registros distintos que una página tiene abiertos. Modifícalo con `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` o `realtime.maxSubscriptionsPerSocket` en el adaptador de Postgres (la variable de entorno tiene prioridad); un valor que no sea un número entero positivo detiene el servidor al arrancar. **Los sockets que mantiene un usuario también se pueden limitar**, por instancia de servidor: configura `REALTIME_MAX_SOCKETS_PER_USER` (o `realtime.maxSocketsPerUser`), y un inicio de sesión que supere el límite se rechazará con `TOO_MANY_SOCKETS` y el socket se cerrará con 4002. Los sockets autenticados con una clave de API cuentan para esa clave, cada clave por su cuenta, no para la cuenta que la creó; la service key es una sola credencial, por lo que todos sus sockets cuentan juntos. Los sockets de un administrador que suplantan a un usuario cuentan para el administrador, junto con sus propios sockets, no para el usuario al que representan. El SDK informa a cada suscripción activa y a `onConnectionLost` al mismo tiempo, con un error `CONNECTION_LOST` cuyo `details.reason` es `TOO_MANY_SOCKETS`, y continúa reintentando, esperando más tiempo en cada intento hasta 30 s, para que la pestaña ingrese una vez que se cierre otro socket. Sin configurar, como por defecto, no hay límite.

El ID de una suscripción pertenece al propio socket: dos clientes que nombran una suscripción `"sub-1"` conservan cada uno la suya, y un `unsubscribe` finaliza únicamente la del remitente.

**Suscribirse cuenta para el límite de tasa (rate limit) de datos.** El primer frame de una suscripción es una lectura, ejecutada en nombre del suscriptor, al igual que la solicitud de historial de un canal. Por lo tanto, `subscribe_collection`, `subscribe_one` y `channel_history` cuentan como solicitudes de datos en el cupo de rate limit del emisor (el que comparten sus peticiones HTTP y sus otros sockets) una vez agotada la cuota propia del socket. Cada socket puede enviar 1.000 de ellas sin contabilizarlas, o tantas como el límite máximo de suscripciones cuando este sea mayor, y la asignación se repone a lo largo de 15 minutos. Esto cubre todo lo que un socket puede contener, de modo que la resuscripción tras una reconexión nunca se rechaza ni consume el presupuesto de la persona. Superada la asignación, cualquier frame que exceda el límite se rechaza con un frame de error con código `RATE_LIMITED`, que el SDK envía al `onError` de esa suscripción, o al del canal.

### Sockets que dejan de responder

Un cliente puede desaparecer sin cerrar su socket: un teléfono pierde la señal, una laptop entra en suspensión, un NAT olvida la conexión. No llega ningún frame de cierre, por lo que nada avisa al servidor. En consecuencia, el servidor envía un ping a cada socket cada 30 segundos y finaliza cualquiera que no haya respondido para el siguiente ping, liberando al cliente desconectado en un plazo de un minuto. Los navegadores y el SDK responden a los pings automáticamente; un cliente que implemente el protocolo directamente también debe responderlos, tal como lo hace la mayoría de las librerías de WebSocket.

**El lado del navegador.** Un navegador no puede enviar un ping ni verlo, por lo que un socket entreabierto le parece conectado indefinidamente. El SDK abre el socket con `?rebase_caps=heartbeat,channel_seq,cancel_sql`; un servidor compatible responde con `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, enumerando las capacidades que admite (`cancel_sql`: acepta el frame `CANCEL_SQL` de la consola SQL), y envía `{"type":"heartbeat"}` cada 30 segundos, tras lo cual el SDK descarta el socket y [se reconecta](#reconexión-automática) si se pierden dos heartbeats. A un cliente que no especifique nada no se le envía ninguno de los dos, y un servidor antiguo ignora el parámetro, por lo que un SDK que se comunique con uno se comporta como antes.

Un socket también se termina cuando más de 16&nbsp;MiB de frames enviados hacia él permanecen sin leer. Esto ocurre con un cliente que no lee lo que se le envía, o uno tan atrasado que lo que leería ya está obsoleto. Y cuando los sockets de un servidor acumulan juntos más de 256&nbsp;MiB sin leer (o una cuarta parte del límite de memoria bajo el cual se ejecuta el servidor, si este fuera menor), aquellos con más datos sin leer se terminan primero, hasta que el resto quepa.

Un socket terminado se limpia del mismo modo que uno cerrado. Sus suscripciones finalizan, abandona sus canales y se elimina su presencia, anunciando la salida a los demás miembros. Un cliente que todavía está activo nota la caída de la conexión, y el SDK [se reconecta](#reconexión-automática) y se suscribe nuevamente.

## Canales de difusión (Broadcast Channels)

Los canales de difusión permiten a los clientes enviarse mensajes arbitrarios entre sí en tiempo real, lo cual resulta útil para funciones como indicadores de escritura, posiciones del cursor o notificaciones personalizadas.

La difusión se gestiona a nivel del protocolo WebSocket. El servidor admite los siguientes tipos de mensaje:

| Tipo de mensaje | Dirección | Descripción |
|-----------------|-----------------|------------------------------------------|
| `join_channel` | Cliente → Servidor | Unirse a un canal con nombre |
| `leave_channel` | Cliente → Servidor | Salir de un canal |
| `broadcast` | Cliente → Servidor | Enviar un mensaje a todos los miembros del canal |
| `broadcast` | Servidor → Cliente | Recibir un mensaje de otro miembro |
| `channel_history` | Cliente → Servidor | Solicitar mensajes retenidos tras una secuencia |
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

## Retención en canales

De forma predeterminada, una difusión llega a los miembros actualmente conectados y luego desaparece. Esa es la compensación adecuada para notificaciones y cursores, y no tiene costo alguno.

Para un flujo de operaciones —edición colaborativa o cualquier caso donde una brecha silenciosa cause divergencia—, un canal puede configurarse para **retener** sus mensajes. A las difusiones retenidas se les asigna un número de secuencia por canal y se almacenan, de modo que un cliente que se reconecte pueda solicitar todo lo ocurrido tras el último mensaje que vio.

:::caution[Dónde va esto]
**Runtime administrado: en ningún lugar.** La retención de canales y `realtime.bus` forman parte del adaptador de base de datos que el runtime administrado construye por sí mismo, y ninguno tiene una forma en variables de entorno. Haz un eject para configurarlos.
**Ejected:** `createPostgresAdapter({ realtime })` en `backend/src/index.ts`.
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
| `ttl` | Conservar mensajes como máximo durante este tiempo — `"30s"`, `"15m"`, `"24h"`, `"7d"` o milisegundos |

Una regla requiere al menos uno de entre `limit` o `ttl`. Una regla sin ninguno de los dos se ignora y se registra en los logs, ya que una retención ilimitada casi nunca es intencional y no se puede deshacer una vez que la tabla ha crecido.

:::note[¿Por qué no dejar que los clientes pidan el historial?]
Un canal es creado por quienquiera que le dé un nombre. Si un cliente pudiera elegir su propia profundidad de historial, cualquier visitante podría comprometer tu backend a un almacenamiento ilimitado. Configurarlo aquí también significa que los canales de presencia y notificación —la gran mayoría— no pagan ningún costo: sin reglas configuradas, no se crea ninguna tabla y la difusión sigue la misma ruta sincrónica de siempre.
:::

### Almacenamiento

Los canales retenidos utilizan dos tablas en el esquema `rebase`, creadas automáticamente al iniciar cuando se configura al menos una regla:

| Tabla | Contenido |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | Los mensajes retenidos, indexados por `(channel, seq)` |
| `rebase.channel_cursors` | La secuencia más alta emitida por canal |

La depuración ocurre a medida que llegan los mensajes, regulada por canal para que el costo dependa del tiempo transcurrido y no del volumen de escrituras. Solo elimina filas de `channel_messages`: los cursores se conservan indefinidamente (ocupan una pequeña fila por canal), porque reiniciar la secuencia de un canal alteraría el significado del punto de reanudación guardado por un cliente.

### Garantías de entrega

- **Ordenada.** Los números de secuencia se asignan por canal, y el orden de entrega coincide con el orden de secuencia: en una instancia, y a través de instancias en el bus `postgres`, donde la sentencia que numera un mensaje también lo anuncia, de modo que cada instancia (incluida la del remitente) recibe los anuncios en orden de secuencia. Un bus provisto por ti entrega los frames en el orden en que los transmita.
- **Durable antes de entregarse.** Un mensaje que no se pueda almacenar no se entrega a nadie, y se le notifica al remitente. Entregarlo lo pondría frente a suscriptores en vivo mientras lo excluiría de cualquier reproducción futura, y ningún mensaje posterior podría subsanar esa brecha.
- **Al menos una vez al ponerse al día (At-least-once on catch-up).** Un rango de reproducción puede superponerse con mensajes que un cliente ya recibió; el SDK descarta aquellos que ya entregó.
- **Sin huecos.** Un mensaje retenido llega a todos los miembros: al remitente, a quien nunca se le envía su propio mensaje, se le envía `{"type":"broadcast_ack","channel","seq"}` en su lugar cuando ha optado por `channel_seq`. Por lo tanto, un mensaje posterior a `lastSeq + 1` significa que se perdió uno, por lo que el SDK lo retiene, solicita el historial intermedio y entrega todos en orden. Frente a un servidor sin `channel_seq`, un salto se entrega a medida que llega.

:::caution[El historial tiene el mismo modelo de acceso que el canal]
Un cliente que se ha unido a un canal puede reproducir sus mensajes retenidos, incluidos los transmitidos antes de su llegada: la membresía es la única comprobación, y unirse está abierto a cualquier cliente que conozca el nombre del canal. La retención se habilita de forma opcional por patrón de canal, por lo que activarla hace que el pasado de ese canal sea legible para cualquier visitante que adivine el nombre. En los canales retenidos esto se vuelve duradero en lugar de momentáneo, por lo que debes tratar el contenido de un canal retenido como público para tus usuarios.
:::

## Seguimiento de presencia (Presence Tracking)

La presencia rastrea qué usuarios están actualmente en línea en un canal y permite a cada uno compartir un estado personalizado (por ejemplo, posición del cursor, estado).

| Tipo de mensaje | Dirección | Descripción |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track` | Cliente → Servidor | Comenzar a rastrear la presencia con un estado personalizado |
| `presence_untrack`| Cliente → Servidor | Dejar de rastrear la presencia |
| `presence_state` | Cliente → Servidor | Solicitar el estado completo de presencia de un canal |
| `presence_state` | Servidor → Cliente | Todas las presencias del canal al completo |
| `presence_diff` | Servidor → Cliente | Actualización incremental (entradas y salidas) |

Cuando un cliente envía `presence_track`, el servidor lo une automáticamente al canal (sin necesidad de un `join_channel` por separado) y transmite un `presence_diff` a todos los miembros del canal. El SDK reenvía su estado cada ~20 segundos a modo de heartbeat; un heartbeat cuyo estado no ha variado solo renueva el tiempo de espera del cliente y no envía ningún `presence_diff`.

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

El SDK tipado se reconecta automáticamente cuando la conexión WebSocket se cae:

- **Retroceso exponencial (exponential backoff)** — Cada reintento espera un intervalo que comienza en 2 segundos y se duplica cada vez, hasta un máximo de 30 segundos. El retraso se escoge de forma aleatoria dentro de su intervalo, pero nunca por debajo de un cuarto de segundo, de modo que los clientes desconectados simultáneamente por un despliegue regresen distribuidos a lo largo de todo el intervalo en lugar de hacerlo en el mismo instante.
- **Sin rendirse mientras haya algo activo** — Mientras exista una suscripción o un canal al que se haya unido, el cliente continúa reintentando en el tope de 30 segundos durante todo el tiempo que dure la interrupción. Si no hay nada registrado, se detiene tras 5 intentos fallidos, y la siguiente suscripción volverá a iniciar la conexión. En un navegador, el evento `online` y el hecho de que la pestaña vuelva a estar visible provocan la reconexión inmediata en lugar de agotar el tiempo de espera.
- **Las interrupciones se reportan una sola vez** — Cuando la conexión ha estado caída durante 14 segundos, sin importar cuántos reintentos haya tomado, el `onError` de cada suscripción activa y el `onError` de cada canal unido reciben un `RebaseApiError` con código `CONNECTION_LOST`. La suscripción se **mantiene**: el error indica que sus datos no se están actualizando, no que haya finalizado.
- **Resuscripción automática** — Tras una reconexión exitosa, todas las suscripciones activas se vuelven a registrar en el servidor, y el siguiente `onUpdate` de cada una transporta lo que se haya escrito mientras el cliente estuvo ausente. Dicha actualización es la señal de recuperación. No se requiere intervención manual.
- **Las solicitudes son a lo sumo una vez (at-most-once)** — Una solicitud realizada mientras el socket está caído lo espera por un máximo de 30 segundos desde la llamada, y luego falla con `REQUEST_TIMEOUT` sin haber llegado a enviarse. Una solicitud que ya había sido enviada cuando la conexión se interrumpió falla con `CONNECTION_LOST` y **no** se reenvía: el servidor puede o no haberla ejecutado, y solo el invocador sabe si es seguro ejecutarla dos veces.

`client.ws.state` indica en qué estado se encuentra la conexión, y `onStateChange` es notificado de cada cambio:

| Estado | Significado |
|---|---|
| `idle` | Sin socket, y ninguno solicitado todavía (la conexión es diferida/lazy), o un cierre de sesión lo cerró. |
| `connecting` | Conectando, sin ninguna interrupción en curso. |
| `connected` | El socket está abierto. |
| `reconnecting` | El socket se cayó y el cliente está reintentando la conexión. Aún no se ha reportado nada. |
| `disconnected` | La interrupción ha durado 14 segundos o más. Se ha reportado `CONNECTION_LOST` y el cliente sigue reintentando. |
| `closed` | Se llamó a `client.close()`. Definitivo. |

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

El panel de administración de Rebase muestra un banner propio mientras el estado es `disconnected`, y conserva las filas y registros que ya están en pantalla en lugar de reemplazarlos por un error.

## Autenticación y RLS

Las suscripciones por WebSocket respetan automáticamente las políticas de Seguridad a Nivel de Fila (RLS). Cuando el cliente está autenticado:

1. La conexión WebSocket se autentica utilizando el mismo token JWT que la API REST.
2. Cada refetch de suscripción se ejecuta dentro de una transacción de PostgreSQL con `set_config('app.user_id', ...)` y `set_config('app.user_roles', ...)`, asegurando que las políticas RLS se apliquen.
3. La identidad se vuelve a verificar mientras el socket permanezca abierto, no solo al autenticarse. Antes de cada frame, el servidor comprueba lo mismo que comprobaría una petición HTTP: si el token sigue siendo válido, si su sesión fue cerrada o revocada, si la cuenta todavía existe y qué roles posee actualmente. Los frames de canal se evalúan como máximo una vez por segundo. Los frames que llegan a un socket mientras su verificación aún está en curso —un cliente que reenvía sus suscripciones tras una reconexión— comparten esa verificación en lugar de consultar de nuevo individualmente; el siguiente frame tras completarse evalúa nuevamente. Un socket que solo escucha es evaluado al menos cada 30 segundos, y un token deja de ser aceptado en el instante en que expira. Un rol retirado se aplica a partir del siguiente frame (o, para un frame que compartió una verificación en curso, desde el subsiguiente), afectando lecturas, escrituras y suscripciones abiertas por igual. Un socket cuya identidad haya finalizado recibe un frame `AUTH_ERROR` y se cierra con el código `4001`. Con la autenticación integrada, el código del frame explica la razón, de la misma forma que lo indican las rutas HTTP: `SESSION_REVOKED` (sesión cerrada, revocada o cuenta eliminada), `ACCOUNT_DISABLED` o `TOKEN_EXPIRED`; en otro adaptador de autenticación es `SESSION_ENDED`. Un `AUTHENTICATE` para una sesión revocada o una cuenta deshabilitada se rechaza con `SESSION_REVOKED` o `ACCOUNT_DISABLED` (un token que no se valida o ha expirado, con `INVALID_TOKEN`). El SDK no vuelve a preguntar con el mismo token y transfiere el rechazo, código incluido, al `onError` de lo que requería la cuenta. El SDK vuelve a autenticar su socket cada vez que renueva su token; un nuevo token para la misma identidad (mismo ID de usuario, roles, flag de invitado y claims) deja las suscripciones abiertas intactas, y uno para una identidad diferente vuelve a consultar cada una bajo esa nueva identidad. Tras un `4001`, se reconecta con la sesión que posea en ese momento, o sin ninguna. Un cliente que hable el protocolo directamente debe enviar un token actualizado en `AUTHENTICATE` antes de que expire el anterior.

Esto significa que cada socket solo recibe actualizaciones de los registros que su identidad autenticada tiene permiso para ver.

Una [clave de API](/docs/backend/api-keys/) también autentica el socket: envía la clave `rk_…` en el lugar donde iría el token de acceso. El socket comprueba entonces cada frame contra los [ámbitos (scopes)](/docs/backend/roles-and-scopes/) de la clave: una lectura, un recuento o una suscripción requiere `data:read` en su tabla; un guardado, `data:write`; una eliminación, `data:delete`. Una ruta anidada requiere el ámbito simple. Los canales (broadcast y presencia) se rechazan para una clave, ya que ningún ámbito los cubre. El editor SQL y los mensajes de bifurcación requieren `database:read` o `database:write`, tanto para una clave como para una persona.

Ejecutar más de una instancia —el bus LISTEN/NOTIFY, el comportamiento de la presencia entre procesos y cómo escribir tu propio transporte— tiene su propia página:
[Tiempo real entre instancias](/docs/backend/realtime-transports/).

## Captura de cambios a nivel de base de datos (CDC)

Cada escritura confirmada emite eventos en tiempo real, independientemente de cómo se haya realizado: REST, el SDK, Studio, `psql` o un cron job en otro servicio. Cómo funciona la captura, el ajuste `REALTIME_CDC` y lo que requiere: [Captura de cambios en base de datos](/docs/backend/realtime-cdc/).

## Tiempo de espera para solicitudes pendientes (Pending Request Timeout)

Para evitar que las peticiones del cliente se queden bloqueadas indefinidamente, todas las operaciones pendientes de WebSocket que esperan una respuesta del servidor (como las lecturas únicas de tablas `FETCH_COLLECTION`, lecturas de una sola entidad `FETCH_ONE`, creación/actualización `SAVE`, eliminaciones `DELETE`, recuentos `COUNT` y comprobaciones de unicidad `CHECK_UNIQUE_FIELD`) tienen un tiempo de espera predeterminado de 30 segundos.

Si el servidor no responde dentro de esta ventana de 30 segundos, el cliente elimina automáticamente la solicitud pendiente y rechaza la promesa con un `RebaseApiError` cuyo código es `REQUEST_TIMEOUT`.

Los mensajes unidireccionales que no esperan respuesta (como `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` y `channel_history`) se resuelven inmediatamente tras su transmisión y no activan este tiempo de espera. Una suscripción cuyo primer frame no haya llegado 30 segundos después de haber enviado su solicitud de suscripción falla en su lugar con `SUBSCRIPTION_TIMEOUT` en su `onError`.

### Cuando se rechaza un frame de canal

Un frame de canal funciona bajo el esquema "fire-and-forget": `await channel.broadcast(...)` se resuelve cuando el frame se escribe en el socket, **no** cuando el servidor lo ha aceptado. Esto es intencional: una aplicación colaborativa transmite la posición de un cursor sesenta veces por segundo, y esperar una confirmación de cada una convertiría cada emisión en un viaje de ida y vuelta.

Por lo tanto, un rechazo no puede ser una promesa rechazada. Llega a través de `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Código | Significado |
|------|-------|
| `CHANNEL_FORBIDDEN` | No eres miembro del canal — únete a él antes de transmitir o leer su historial |
| `RATE_LIMITED` | Se superó el presupuesto de frames del canal (7.200 frames de canal por minuto por socket) o, para una solicitud de historial, se superó el [límite de tasa de datos](#cuánto-cuesta-una-escritura-y-sus-límites) |
| `CHANNEL_HISTORY_WRITE_FAILED` | No se pudo persistir una difusión retenida, por lo que fue descartada |
| `CHANNEL_HISTORY_READ_FAILED` | No se pudo procesar una solicitud de recuperación de mensajes anteriores |
| `CHANNEL_HISTORY_GAP` | Generado por el cliente: una recuperación detectó que el servidor ya no retiene mensajes que este cliente nunca recibió. `details` es `{ from, to }`, los números de secuencia perdidos. Resincroniza el estado del canal desde su fuente de verdad |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | La difusión llegó únicamente a esta instancia — consulta [El límite de 8 KB en el bus de Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Si no se adjunta ningún controlador, estos se registran como advertencias. Antes se descartaban por completo: no había ninguna promesa que rechazar ni ningún canal al que notificar, por lo que una difusión prohibida era indistinguible de una entregada con éxito.

## Pasos siguientes

- [SDK tipado](/docs/sdk) — Referencia completa del SDK, incluidos los descriptores de acceso de tablas tipados.
- [Autenticación](/docs/backend/authentication) — Configura la autenticación JWT y las políticas RLS.
- [Arquitectura del backend](/docs/backend) — Información general sobre la arquitectura del servidor Rebase.
