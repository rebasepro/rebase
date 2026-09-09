---
sourceHash: 05f7e05823faa1cf
title: Tiempo Real y WebSocket
sidebar_label: Tiempo Real
description: Sincronización de datos en tiempo real, canales de broadcast y seguimiento de presencia mediante WebSocket.
---

Rebase incluye un motor en tiempo real integrado que envía los cambios de datos a los clientes conectados a través de WebSocket.
Cuando se crea, actualiza o elimina cualquier registro, cada suscriptor que observa esa colección o entidad recibe la actualización al instante — sin necesidad de sondeos (polling).

## Cómo Funciona

El pipeline de tiempo real consta de tres etapas:

1. **Disparador de base de datos** — Una mutación llega a la base de datos PostgreSQL (mediante la API REST, el SDK o Studio).
2. **Distribución en el servidor (Fan-out)** — El servidor de Rebase detecta el cambio y lo distribuye a cada suscripción WebSocket activa que coincida con la colección o entidad afectada.
3. **Callback del cliente** — El SDK del cliente ejecuta tu callback `onUpdate` con los datos actualizados.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Para implementaciones con múltiples instancias, Rebase utiliza `LISTEN/NOTIFY` de PostgreSQL para transmitir los cambios entre las instancias del servidor. Esto se gestiona automáticamente: una conexión dedicada de PostgreSQL escucha en el canal `rebase_entity_changes` y retransmite las actualizaciones a los suscriptores locales.

### Configuración Cero

El tiempo real viene habilitado de fábrica. No hay ningún flag que activar ni servicio que iniciar — si tu servidor de Rebase está en ejecución, el endpoint de WebSocket está disponible.

> Por defecto, Rebase también emite eventos en tiempo real para las escrituras realizadas **fuera** de la API (mediante `psql`, otro servicio o el editor SQL de Studio) siempre que la conexión a la base de datos lo soporte — consulta [captura de cambios a nivel de base de datos](#database-level-change-capture-cdc).

## Suscripciones del SDK del Cliente

El SDK del cliente de Rebase expone dos métodos de suscripción en cada descriptor de acceso a colecciones:

- **`listen()`** — Suscribirse a una colección completa (con filtros opcionales).
- **`listenById()`** — Suscribirse a una entidad individual mediante su ID.

Ambos métodos devuelven una **función para cancelar la suscripción** que llamas para dejar de recibir actualizaciones.

### Suscribirse a una Colección

Usa `listen()` para recibir actualizaciones cada vez que cambien los registros de una colección:

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

### Suscribirse a una Colección con Filtros

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

El servidor respeta estos filtros: solo los registros coincidentes se incluyen en las actualizaciones.

### Suscribirse a una Sola Entidad

Usa `listenById()` para observar un registro específico:

```typescript
const unsubscribe = client.data.products.listenById(
  "product-123",
  (entity) => {
    if (entity) {
      console.log("Product updated:", entity.values);
    } else {
      console.log("Product was deleted");
    }
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

El callback recibe `Entity<M> | undefined`. Un valor de `undefined` significa que la entidad fue eliminada.

### Cancelar la Suscripción

Tanto `listen()` como `listenById()` devuelven una función de cancelación de suscripción. Llámala para dejar de recibir actualizaciones y liberar recursos en el lado del servidor:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Llama siempre a la función de cancelación de suscripción cuando un componente se desmonte o una página cambie de ruta. Esto evita fugas de memoria y trabajo innecesario en el servidor.
:::

## Query Builder `.listen()`

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
El método `.listen()` en el query builder solo está disponible cuando `RebaseClient` está configurado con una `websocketUrl`. Si la conexión WebSocket no está configurada, llamar a `.listen()` lanzará un error.
:::

## Entrega de Actualizaciones: Parche Instantáneo + Reconsulta de Corrección

Un cambio nunca viaja a un suscriptor como datos. Viaja como el hecho de que algo cambió, y luego a cada suscriptor se le informa lo que *puede* ver mediante una consulta ejecutada bajo su propia identidad:

1. **Invalidación.** Cuando una entidad cambia (creada, actualizada, eliminada), el servidor marca las rutas afectadas. La fila que se escribió no se reenvía — fue leída bajo la autorización del escritor, lo cual no dice nada sobre lo que un suscriptor tiene permitido ver.

2. **Reconsulta con RLS con debouncing.** Después de **300ms** (`REFETCH_DEBOUNCE_MS`), el servidor vuelve a consultar la colección con tus filtros y orden originales. La consulta se ejecuta dentro de una transacción que establece las variables locales de la transacción `app.user_id` y `app.user_roles` a partir del `SubscriptionAuthContext` del suscriptor, de modo que Postgres evalúa la Seguridad a Nivel de Fila (RLS) bajo la identidad de ese cliente y solo las filas que tiene autorización de ver se envían en el `collection_update`. El debounce también agrupa una ráfaga de escrituras en una sola consulta.

Las versiones anteriores enviaban un `collection_patch` inmediato que transportaba la fila escrita antes de esta reconsulta, para una retroalimentación entre pestañas de menos de un milisegundo. Esa fila se había leído bajo el ámbito del escritor, por lo que podía — y de hecho lo hacía — llegar a suscriptores cuyas propias políticas la habrían denegado, y el filtro `where` de la suscripción tampoco se le aplicaba. El parche ha sido eliminado: la latencia percibida para una actualización es ahora la ventana de debounce.

### La reconsulta es la lectura REST

La reconsulta ejecuta el mismo pipeline que ejecuta `GET /api/data/<collection>`, con el mismo manejo de `include`. Eso es lo que hace que `find({ q })` y `listen({ q })` devuelvan filas que son idénticas campo por campo.

Solía ser un método diferente — uno que anidaba cada relación bajo un envoltorio `{ "__type": "relation" }` y, dado que una suscripción no podía llevar ningún `include`, cargaba de forma diligente (eager load) **cada** relación que declara la colección. Por lo tanto, la misma consulta respondía con una estructura a través de HTTP y otra a través del socket, y un cliente que renderizaba ambas veía cambiar la forma de sus filas en el momento en que se producía una escritura.

Por lo tanto, una trama de suscripción acepta lo mismo que una solicitud de listado: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` y `fields`. `vectorSearch` es la excepción y es **rechazada** con `VECTOR_SEARCH_NOT_LIVE` — una suscripción se vuelve a ejecutar en cada escritura coincidente y nada allí calcula distancias.

### `collection_update` lleva sus propios metadatos

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

`meta` se cuenta dentro de la misma transacción sujeta a RLS que leyó las filas, por lo que describe exactamente las filas que lo acompañan. Sin esto, un cliente que necesitara un total tenía que emitir un `GET /count` **por cada push** — un viaje de ida y vuelta adicional por escritura, por suscriptor, y una ventana de tiempo en la que el conteo y las filas describían estados diferentes de la colección.

Cuando el conteo en sí falla, la trama lleva `partial: true` y ningún `total`; eso no es un error de suscripción, y el cliente debe conservar el último total real en lugar de sustituirlo por la longitud de la página.

## Canales de Broadcast

Los canales de broadcast permiten a los clientes enviarse mensajes arbitrarios entre sí en tiempo real — útil para funciones como indicadores de escritura, posiciones de cursor o notificaciones personalizadas.

El broadcast se gestiona a nivel del protocolo WebSocket. El servidor admite estos tipos de mensajes:

| Tipo de Mensaje | Dirección | Descripción |
|---|---|---|
| `join_channel` | Cliente → Servidor | Unirse a un canal con nombre |
| `leave_channel` | Cliente → Servidor | Salir de un canal |
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

## Retención de Canales

Por defecto, una transmisión (broadcast) llega a los miembros actualmente conectados y luego desaparece. Esa es la compensación adecuada para notificaciones y cursores, y no cuesta nada.

Para un flujo de operaciones — edición colaborativa o cualquier caso donde una brecha silenciosa provoque divergencia — se puede configurar un canal para que **retenga** sus mensajes. A las transmisiones retenidas se les asigna un número de secuencia por canal y se almacenan, de modo que un cliente que se reconecte pueda solicitar todo lo posterior al último que vio.

:::caution[Dónde va esto]
**Runtime gestionado: en ningún sitio.** La retención de canales y `realtime.bus` forman parte del adaptador de base de datos que el propio runtime gestionado construye, y ninguno tiene una forma en variables de entorno. Haz eject para configurarlos.
**Ejected:** `createPostgresAdapter({ realtime })` en `backend/src/index.ts`.
:::

La retención es opcional (opt-in) y se configura aquí, en el servidor:

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
| `match` | Nombre exacto del canal (`"doc:42"`) o un prefijo terminado en `*` (`"doc:*"`) |
| `limit` | Mantener como máximo esta cantidad de los mensajes más recientes por canal |
| `ttl` | Mantener los mensajes durante este tiempo como máximo — `"30s"`, `"15m"`, `"24h"`, `"7d"`, o milisegundos |

Una regla necesita al menos uno de `limit` o `ttl`. Una regla sin ninguno de los dos se ignora y se registra en los logs, porque la retención ilimitada casi nunca es intencional y no se puede revertir fácilmente una vez que la tabla ha crecido.

:::note[¿Por qué no permitir que los clientes soliciten el historial?]
Un canal es creado por quienquiera que le dé nombre. Si un cliente pudiera elegir su propia profundidad de historial, cualquier visitante podría comprometer tu backend a un almacenamiento ilimitado. Configurarlo aquí también significa que los canales de presencia y notificaciones — la gran mayoría — no pagan nada: sin reglas configuradas, no se crea ninguna tabla y el broadcast sigue la misma ruta sincrónica de siempre.
:::

### Almacenamiento

Los canales retenidos utilizan dos tablas en el esquema `rebase`, creadas automáticamente al iniciar cuando se configura al menos una regla:

| Tabla | Contenido |
|---|---|
| `rebase.channel_messages` | Los mensajes retenidos, indexados por `(channel, seq)` |
| `rebase.channel_cursors` | La secuencia más alta emitida por canal |

La depuración (pruning) ocurre a medida que llegan los mensajes, regulada por canal para que el costo dependa del tiempo transcurrido en lugar del volumen de escritura. Solo elimina filas de `channel_messages` — los cursores se conservan indefinidamente (son una pequeña fila por canal), porque reiniciar la secuencia de un canal alteraría el significado del punto de reanudación guardado de un cliente.

### Garantías de entrega

- **Ordenado.** Los números de secuencia se asignan por canal, y el orden de entrega coincide con el orden de secuencia.
- **Durable antes de entregarse.** Un mensaje que no se puede almacenar no se entrega a nadie, y se le notifica al remitente. Entregarlo lo pondría frente a suscriptores en vivo mientras quedaría fuera de cualquier reproducción futura, y ningún mensaje posterior podría reparar esa brecha.
- **Al menos una vez al ponerse al día (At-least-once).** Un rango de reproducción puede superponerse con mensajes que un cliente ya recibió; el SDK descarta aquellos que ya ha entregado.

:::caution[El historial tiene el mismo modelo de acceso que el canal]
Un cliente que se ha unido a un canal puede reproducir sus mensajes retenidos, incluidos los transmitidos antes de su llegada — la pertenencia es la única verificación, y unirse está abierto a cualquier cliente que conozca el nombre del canal. La retención es opcional por patrón de canal, por lo que habilitarla hace que el pasado de ese canal sea legible para cualquier visitante que adivine el nombre. Los canales retenidos son el caso donde esto se vuelve duradero en lugar de momentáneo, por lo que debes tratar el contenido de un canal retenido como público para tus usuarios.
:::

## Seguimiento de Presencia

La presencia rastrea qué usuarios están actualmente en línea en un canal y permite que cada usuario comparta un estado personalizado (por ejemplo, posición del cursor, estado).

| Tipo de Mensaje | Dirección | Descripción |
|---|---|---|
| `presence_track` | Cliente → Servidor | Comenzar a rastrear la presencia con estado personalizado |
| `presence_untrack` | Cliente → Servidor | Detener el rastreo de presencia |
| `presence_state` | Cliente → Servidor | Solicitar el estado de presencia completo de un canal |
| `presence_state` | Servidor → Cliente | Entidad completa de todas las presencias en un canal |
| `presence_diff` | Servidor → Cliente | Actualización incremental (ingresos y salidas) |

Cuando un cliente envía `presence_track`, el servidor lo une automáticamente al canal (no se necesita un `join_channel` por separado) y transmite un `presence_diff` a todos los miembros del canal.

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

Las presencias inactivas se limpian automáticamente después de 30 segundos de inactividad.

## Reconexión Automática

El SDK del cliente se reconecta automáticamente cuando se pierde la conexión WebSocket:

- **Backoff exponencial** — Los retrasos de reconexión comienzan en 1 segundo y se duplican en cada intento, con un límite de 30 segundos.
- **Máximo de 5 intentos** — Después de 5 intentos fallidos de reconexión, el cliente deja de intentar.
- **Resuscripción automática** — Tras una reconexión exitosa, todas las suscripciones activas se vuelven a registrar con el servidor. No se requiere intervención manual.
- **Cola de mensajes** — Los mensajes enviados mientras se está desconectado se ponen en cola y se entregan tras la reconexión.

Puedes escuchar los eventos del ciclo de vida de la conexión:

```typescript
// `ws` is undefined on a client built without realtime, so narrow it once.
const ws = client.ws;
if (ws) {
    ws.on("connect", () => console.log("Connected"));
    ws.on("disconnect", () => console.log("Disconnected"));
    ws.on("reconnect", () => console.log("Reconnected"));
    ws.on("error", (error) => console.error("Error:", error));
}
```

## Autenticación y RLS

Las suscripciones WebSocket respetan automáticamente las políticas de Seguridad a Nivel de Fila (RLS). Cuando el cliente está autenticado:

1. La conexión WebSocket se autentica utilizando el mismo token JWT que la API REST.
2. Cada reconsulta de suscripción se ejecuta dentro de una transacción de PostgreSQL con `set_config('app.user_id', ...)` y `set_config('app.user_roles', ...)` — garantizando que se apliquen las políticas de RLS.
3. Si un token expira durante una sesión activa, el cliente se vuelve a autenticar y se vuelve a suscribir automáticamente.

Esto significa que cada usuario solo recibe actualizaciones de los registros que tiene permiso para ver.

Ejecutar más de una instancia — el bus LISTEN/NOTIFY, qué hace la presencia entre procesos y cómo escribir tu propio transporte — tiene su propia página: [Tiempo real entre instancias](/docs/backend/realtime-transports/).

## Captura de Cambios a Nivel de Base de Datos (CDC)

**Change Data Capture (CDC) está activado de forma predeterminada.** Rebase captura cambios en la base de datos y emite eventos en tiempo real para **cada escritura confirmada (committed), independientemente de cómo se haya realizado** — REST, SDK, Studio, `psql`, un trabajo cron en otro servicio, Drizzle/SQL directo o el **editor SQL** de Studio. Este es el mismo modelo que Supabase Realtime siguiendo el log de escritura previa (write-ahead log).

No se requiere configuración. En una conexión a la base de datos que lo soporte, CDC se autoaprovisiona al iniciar; en una que no lo soporte (por ejemplo, un rol restringido que no puede crear triggers), Rebase utiliza silenciosamente tiempo real a nivel de aplicación — nada que activar, nada que se rompa.

### Configuración

CDC se controla mediante la variable de entorno `REALTIME_CDC`:

| Valor | Comportamiento |
| --- | --- |
| `auto` *(predeterminado)* | Habilita la captura a nivel de base de datos donde la conexión lo soporte; **recurre silenciosamente** al tiempo real a nivel de aplicación en caso contrario. Configuración cero. |
| `trigger` | Fuerza la captura basada en triggers. Funciona en cualquier PostgreSQL, incluidas instancias gestionadas sin replicación lógica. Advierte (en lugar de recurrir silenciosamente) si no se puede aprovisionar. |
| `wal` | Prefiere la replicación lógica de WAL. Aún no incluida — se degrada a `trigger` y registra el modo activo. |
| `off` | Solo tiempo real a nivel de aplicación. Usa esto para evitar la sobrecarga del trigger por escritura en cargas de trabajo intensivas en escritura. |

Al iniciar verás una línea de log indicando el modo activo, p. ej.:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Si la conexión no lo admite, `auto` registra una línea informativa en su lugar y continúa con el tiempo real a nivel de aplicación:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

### Cómo Funciona

1. **Autoaprovisionamiento** — Al inicio (contexto de servidor/propietario), Rebase instala un trigger idempotente `AFTER INSERT/UPDATE/DELETE` en cada tabla gestionada. El trigger emite una notificación de cambio compacta en el canal `rebase_cdc`. Una carga útil que exceda el límite de 8&nbsp;KB de `NOTIFY` de PostgreSQL recurre a un mensaje solo con la identidad, por lo que CDC nunca puede abortar la escritura desencadenante.
2. **Captura** — Un cliente `LISTEN` dedicado y sin pool por instancia consume `rebase_cdc`, asigna la tabla modificada a su colección correspondiente e introduce el cambio en el mismo pipeline de `RealtimeService` utilizado por las mutaciones de la API. Al igual que el listener entre instancias, prefiere `DATABASE_DIRECT_URL` y se reconecta automáticamente.
3. **Entrega segura con RLS** — La fila sin procesar del flujo de cambios **nunca** se reenvía a los suscriptores. El cambio se marca como invalidado y cada suscripción vuelve a leer la fila bajo su **propio** contexto de autenticación. Por lo tanto, el filtrado es por suscriptor, nunca por publicador: un cliente solo recibe las filas que sus políticas de RLS permiten.
4. **Entre instancias** — Dado que cada instancia observa cada confirmación (commit) a través del flujo de cambios, CDC también *es* el canal entre instancias; el broadcast heredado por mutación `rebase_entity_changes` no se utiliza mientras CDC esté activo.
5. **Deduplicación** — Una mutación realizada a través de la API de Rebase se entrega localmente en el instante en que se confirma y también se devuelve a través del flujo de cambios. La instancia de origen suprime ese eco (un registro de vida corta de sus propias emisiones), por lo que los suscriptores nunca ven una escritura de la API dos veces.

### Requisitos y Notas

- CDC requiere una cadena de conexión directa (`DATABASE_DIRECT_URL` o la conexión principal) para el cliente `LISTEN` — los poolers de conexiones en modo de transacción no admiten sesiones `LISTEN` de larga duración.
- Los triggers se instalan únicamente en tablas respaldadas por una colección registrada. Las escrituras en tablas no mapeadas se ignoran.
- Una colección cuya tabla aún no ha sido migrada se omite con una advertencia en lugar de bloquear CDC para el resto.
- La transmisión nativa de replicación lógica de WAL (`wal2json`/`pgoutput`) está planificada; actualmente `REALTIME_CDC=wal` se degrada a la ruta basada en triggers, que proporciona una cobertura equivalente a nivel de base de datos.

## Tiempo de Espera de Solicitudes Pendientes (Pending Request Timeout)

Para evitar que las solicitudes de los clientes queden colgadas indefinidamente, todas las operaciones WebSocket pendientes que esperan una respuesta del servidor (como las lecturas únicas de colección `FETCH_COLLECTION`, lecturas de entidad única `FETCH_ONE`, creación/actualización `SAVE`, eliminaciones `DELETE`, conteos `COUNT` y comprobaciones de unicidad `CHECK_UNIQUE_FIELD`) tienen un tiempo de espera predeterminado de 30 segundos.

Si el servidor no responde dentro de esta ventana de 30 segundos, el cliente elimina automáticamente la solicitud pendiente y rechaza la promesa con un `ApiError` con el mensaje `"Request timed out"`.

Los mensajes unidireccionales que no esperan una respuesta (como `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` y `presence_state`) se resuelven inmediatamente tras la transmisión y no activan tiempos de espera.

### Cuándo se rechaza una trama de canal

Una trama de canal es de tipo "disparar y olvidar" (fire-and-forget): `await channel.broadcast(...)` se resuelve cuando la trama se escribe en el socket, **no** cuando el servidor la ha aceptado. Esto es deliberado — una aplicación colaborativa transmite una posición de cursor sesenta veces por segundo, y esperar una confirmación de cada una convertiría a cada envío en un viaje de ida y vuelta.

Por lo tanto, un rechazo no puede ser una promesa rechazada. Llega en `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Código | Significado |
|---|---|
| `CHANNEL_FORBIDDEN` | No eres miembro del canal — únete antes de transmitir o leer su historial |
| `RATE_LIMITED` | Se superó el límite de presupuesto de tramas del canal mencionado anteriormente |
| `CHANNEL_HISTORY_WRITE_FAILED` | No se pudo persistir una transmisión retenida, por lo que fue descartada |
| `CHANNEL_HISTORY_READ_FAILED` | No se pudo atender una solicitud de puesta al día |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | La transmisión llegó solo a esta instancia — consulta [El límite de 8 KB en el bus de Postgres](#the-8-kb-limit-on-the-postgres-bus) |

Sin ningún controlador asignado, estos se registran como una advertencia en los logs. Antes se descartaban por completo: no había ninguna promesa que rechazar ni ningún canal al cual entregar, por lo que una transmisión prohibida era indistinguible de una entregada.

## Próximos Pasos

- [SDK del Cliente](/docs/sdk) — Referencia completa del SDK, incluidos los descriptores de acceso a colecciones tipados.
- [Autenticación](/docs/backend/authentication) — Configuración de autenticación JWT y políticas RLS.
- [Arquitectura del Backend](/docs/backend) — Resumen general de la arquitectura del servidor Rebase.

---
