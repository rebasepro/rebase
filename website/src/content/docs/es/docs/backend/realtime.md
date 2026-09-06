---
sourceHash: b05865d9a4f8b3f2
title: Tiempo Real y WebSocket
sidebar_label: Tiempo Real
description: Sincronización de datos en tiempo real, canales de difusión y seguimiento de presencia mediante WebSocket.
---

Rebase incluye un motor de tiempo real integrado que envía los cambios de datos a los clientes conectados a través de WebSocket.
Cuando cualquier registro se crea, actualiza o elimina, todos los suscriptores que observan esa colección o entidad reciben la actualización al instante — sin necesidad de sondeo (polling).

## Cómo Funciona

El pipeline de tiempo real tiene tres etapas:

1. **Trigger de base de datos** — Una mutación llega a la base de datos PostgreSQL (vía API REST, SDK o Studio).
2. **Fan-out del servidor** — El servidor de Rebase detecta el cambio y lo distribuye a cada suscripción WebSocket activa que coincida con la colección o entidad afectada.
3. **Callback del cliente** — El SDK del cliente dispara su callback `onUpdate` con los datos frescos.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Para despliegues con múltiples instancias, Rebase usa `LISTEN/NOTIFY` de PostgreSQL para difundir los cambios entre las instancias del servidor. Esto se gestiona automáticamente — una conexión PostgreSQL dedicada escucha en el canal `rebase_entity_changes` y retransmite las actualizaciones a los suscriptores locales.

### Cero Configuración

El tiempo real está habilitado de fábrica. No hay ningún flag que activar ni servicio que iniciar — si su servidor de Rebase está en ejecución, el endpoint WebSocket está disponible.

> De forma predeterminada, Rebase también emite eventos en tiempo real para las escrituras realizadas **fuera** de la API (vía `psql`, otro servicio o el editor SQL de Studio) siempre que la conexión de base de datos lo soporte — consulte [captura de cambios a nivel de base de datos](#captura-de-cambios-a-nivel-de-base-de-datos-cdc).

## Suscripciones del SDK del Cliente

El SDK del cliente de Rebase expone dos métodos de suscripción en cada accesor de colección:

- **`listen()`** — Suscribirse a una colección completa (con filtros opcionales).
- **`listenById()`** — Suscribirse a una sola entidad por su ID.

Ambos métodos devuelven una **función de cancelación de suscripción** que se llama para dejar de recibir actualizaciones.

### Suscribirse a una Colección

Use `listen()` para recibir actualizaciones cada vez que cambien los registros de una colección:

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

Pase `FindParams` como primer argumento para filtrar la suscripción:

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

El servidor respeta estos filtros — solo los registros coincidentes se incluyen en las actualizaciones.

### Suscribirse a una Sola Entidad

Use `listenById()` para observar un registro específico:

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

El callback recibe `Entity<M> | undefined`. Un valor `undefined` significa que la entidad fue eliminada.

### Cancelar la Suscripción

Tanto `listen()` como `listenById()` devuelven una función de cancelación. Llámela para dejar de recibir actualizaciones y liberar los recursos del lado del servidor:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Llame siempre a la función de cancelación cuando un componente se desmonta o una página cambia de navegación. Esto evita fugas de memoria y trabajo innecesario del lado del servidor.
:::

## `.listen()` del Query Builder

El constructor de consultas fluido también admite suscripciones en tiempo real. Encadene sus filtros y luego llame a `.listen()` en lugar de `.find()`:

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
El método `.listen()` del constructor de consultas solo está disponible cuando el `RebaseClient` está configurado con una `websocketUrl`. Si la conexión WebSocket no está configurada, llamar a `.listen()` lanzará un error.
:::

## Entrega de Actualizaciones: Parche Instantáneo + Refetch de Corrección

Rebase usa una estrategia de actualización en dos fases para las suscripciones de colección, combinando velocidad extrema con corrección absoluta:

1. **Fase 1 — Parche de entidad instantáneo:** Cuando una sola entidad cambia (creada, actualizada, eliminada), el servidor envía inmediatamente un mensaje ligero `collection_patch` que contiene los valores modificados de la entidad directamente a los suscriptores. El cliente fusiona esto en sus datos de colección en caché para una retroalimentación entre pestañas casi instantánea — evitando por completo la base de datos para actualizaciones percibidas en menos de un milisegundo.

2. **Fase 2 — Refetch RLS con debounce:** Tras un breve retraso de **300 ms** (`REFETCH_DEBOUNCE_MS`), el servidor realiza un refetch autoritativo de la base de datos de la colección que coincide con sus filtros y orden originales. Esto es crítico porque las mutaciones de campos podrían alterar la visibilidad de la entidad (p. ej., si su estado cambió y ya no coincide con un filtro `where`).

   Para mantener límites de seguridad estrictos, esta consulta de refetch se ejecuta dentro de una transacción que establece las variables locales de transacción `app.userId` y `app.user_roles` mapeadas desde el `SubscriptionAuthContext` del suscriptor. Esto garantiza que las restricciones de seguridad a nivel de fila (RLS) de PostgreSQL se evalúen correctamente bajo la sesión de autenticación del cliente, y solo los registros que el usuario está autorizado a ver se envían en el `collection_update` final.

Este enfoque garantiza que los filtros de lista y las políticas de acceso permanezcan perfectamente consistentes, manteniendo al mismo tiempo una alta capacidad de respuesta de la UI.

## Canales de Difusión (Broadcast)

Los canales de difusión permiten a los clientes enviarse mensajes arbitrarios entre sí en tiempo real — útil para funciones como indicadores de escritura, posiciones de cursor o notificaciones personalizadas.

La difusión se gestiona a nivel del protocolo WebSocket. El servidor admite estos tipos de mensajes:

| Tipo de Mensaje  | Dirección       | Descripción                              |
|-----------------|-----------------|------------------------------------------|
| `join_channel`  | Cliente → Servidor | Unirse a un canal con nombre           |
| `leave_channel` | Cliente → Servidor | Abandonar un canal                      |
| `broadcast`     | Cliente → Servidor | Enviar un mensaje a todos los miembros del canal |
| `broadcast`     | Servidor → Cliente | Recibir un mensaje de otro miembro      |
| `channel_history` | Cliente → Servidor | Solicitar mensajes retenidos posteriores a una secuencia |
| `channel_history` | Servidor → Cliente | Los mensajes retenidos que un cliente se perdió |

Cuando un cliente envía un mensaje `broadcast`, el servidor lo retransmite a **todos los demás miembros** de ese canal (el emisor no recibe su propio mensaje).

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

Por defecto, una difusión llega a los miembros conectados en ese momento y luego desaparece. Es el equilibrio correcto para notificaciones y cursores, y no cuesta nada.

Para un flujo de operaciones — edición colaborativa, cualquier cosa donde un hueco silencioso cause divergencia — un canal puede configurarse para **retener** sus mensajes. Las difusiones retenidas reciben un número de secuencia por canal y se almacenan, de modo que un cliente que se reconecta puede pedir todo lo posterior al último que vio.

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
|-------|-------------|
| `match` | Nombre exacto del canal (`"doc:42"`) o un prefijo terminado en `*` (`"doc:*"`) |
| `limit` | Conservar como máximo este número de mensajes más recientes por canal |
| `ttl` | Conservar los mensajes como máximo este tiempo — `"30s"`, `"15m"`, `"24h"`, `"7d"`, o milisegundos |

Una regla necesita al menos `limit` o `ttl`. Una que no tenga ninguno se ignora y se registra, porque la retención ilimitada casi nunca es intencionada y no se puede deshacer una vez que la tabla ha crecido.

:::note[¿Por qué no dejar que los clientes pidan historial?]
Un canal lo crea quien lo nombra. Si un cliente pudiera elegir su propia profundidad de historial, cualquier visitante podría comprometer su backend con almacenamiento ilimitado. Configurarlo aquí también significa que los canales de presencia y notificación — la inmensa mayoría — no pagan nada: sin reglas configuradas, no se crea ninguna tabla y la difusión sigue el mismo camino síncrono de siempre.
:::

### Almacenamiento

Los canales con retención usan dos tablas en el esquema `rebase`, creadas automáticamente al arrancar cuando hay al menos una regla configurada:

| Tabla | Contenido |
|-------|-----------|
| `rebase.channel_messages` | Los mensajes retenidos, indexados por `(channel, seq)` |
| `rebase.channel_cursors` | La secuencia más alta emitida por canal |

La poda ocurre a medida que llegan los mensajes, limitada por canal para que el coste dependa del tiempo transcurrido y no del volumen de escritura. Solo elimina filas de `channel_messages` — los cursores se conservan indefinidamente (es una fila pequeña por canal), porque reiniciar la secuencia de un canal cambiaría el significado del punto de reanudación guardado por un cliente.

### Garantías de entrega

- **Ordenado.** Los números de secuencia se asignan por canal, y el orden de entrega coincide con el orden de secuencia.
- **Duradero antes que entregado.** Un mensaje que no se puede almacenar no se entrega a nadie, y se avisa al remitente. Entregarlo lo pondría ante los suscriptores en vivo dejándolo fuera de toda repetición futura, y ningún mensaje posterior podría reparar ese hueco.
- **Al menos una vez al recuperar.** Un rango de repetición puede solaparse con mensajes que el cliente ya recibió; el SDK descarta los que ya entregó.

:::caution[El historial tiene el mismo modelo de acceso que el canal]
Cualquiera que pueda unirse a un canal puede reproducir sus mensajes retenidos, incluidos los difundidos antes de su llegada. La retención es opcional por patrón de canal, así que considere que activarla en un canal de acceso público hace legible el pasado de ese canal para cualquier visitante.
:::
## Seguimiento de Presencia

La presencia rastrea qué usuarios están actualmente en línea en un canal y permite que cada usuario comparta un estado personalizado (p. ej., posición del cursor, estado).

| Tipo de Mensaje    | Dirección       | Descripción                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Cliente → Servidor | Empezar a rastrear la presencia con estado personalizado |
| `presence_untrack`| Cliente → Servidor | Dejar de rastrear la presencia                      |
| `presence_state`  | Cliente → Servidor | Solicitar el estado de presencia completo de un canal |
| `presence_state`  | Servidor → Cliente | Estado completo de todas las presencias en un canal |
| `presence_diff`   | Servidor → Cliente | Actualización incremental (entradas y salidas)      |

Cuando un cliente envía `presence_track`, el servidor lo une automáticamente al canal (sin necesidad de un `join_channel` aparte) y difunde un `presence_diff` a todos los miembros del canal.

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

Las presencias obsoletas se limpian automáticamente tras 30 segundos de inactividad.

## Reconexión Automática

El SDK del cliente se reconecta automáticamente cuando la conexión WebSocket se cae:

- **Backoff exponencial** — Los retrasos de reconexión comienzan en 1 segundo y se duplican en cada intento, con un límite de 30 segundos.
- **Máximo 5 intentos** — Tras 5 intentos fallidos de reconexión, el cliente deja de intentarlo.
- **Resuscripción automática** — En una reconexión exitosa, todas las suscripciones activas se vuelven a registrar en el servidor. No se necesita intervención manual.
- **Cola de mensajes** — Los mensajes enviados mientras está desconectado se ponen en cola y se entregan tras la reconexión.

Puede escuchar los eventos del ciclo de vida de la conexión:

```typescript
const ws = client.ws; // Access the WebSocket client

ws.on("connect", () => console.log("Connected"));
ws.on("disconnect", () => console.log("Disconnected"));
ws.on("reconnect", () => console.log("Reconnected"));
ws.on("error", (error) => console.error("Error:", error));
```

## Autenticación y RLS

Las suscripciones WebSocket respetan automáticamente las políticas de seguridad a nivel de fila (RLS). Cuando el cliente está autenticado:

1. La conexión WebSocket se autentica usando el mismo token JWT que la API REST.
2. Cada refetch de suscripción se ejecuta dentro de una transacción PostgreSQL con `set_config('app.userId', ...)` y `set_config('app.user_roles', ...)` — garantizando que se apliquen las políticas RLS.
3. Si un token expira durante una sesión activa, el cliente se vuelve a autenticar y se vuelve a suscribir automáticamente.

Esto significa que cada usuario solo recibe actualizaciones de los registros que tiene permiso para ver.

## Difusión Entre Instancias y Arquitectura LISTEN/NOTIFY

Para entornos de clúster con múltiples instancias (p. ej., ejecutándose dentro de contenedores Kubernetes o Docker detrás de un balanceador de carga), Rebase se apoya en `LISTEN/NOTIFY` de PostgreSQL para sincronizar las operaciones de mutación y el estado en tiempo real entre instancias.

### Evitando los Pools de pgBouncer

Debido a que los agrupadores de conexiones como **pgBouncer** no admiten el modelo de conexión persistente que requieren las sesiones SQL `LISTEN` de larga duración, el supervisor de tiempo real abre un cliente Postgres dedicado y sin agrupar (`PgClient`) directamente a la base de datos. Esta conexión directa utiliza la variable de entorno `DATABASE_DIRECT_URL` si está configurada, garantizando la estabilidad y evitando el agotamiento del pool o cortes abruptos.

### Mecánica de Notificaciones y Diseño del Payload

Cuando una entidad se modifica en la Instancia A, esta difunde una notificación en el canal `rebase_entity_changes`. Para minimizar la sobrecarga de la base de datos y el ancho de banda de la red, el payload de la notificación se mantiene extremadamente compacto:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Nota: `sid` representa el ID de instancia aleatorio y único del servidor generado al iniciar, `p` es el slug (ruta) de la colección y `eid` es el ID de la entidad objetivo.*

- **Autofiltrado**: Al recibir un mensaje, cada instancia lee el `sid`. Si coincide con su propio ID de instancia, el servidor descarta la notificación para evitar bucles de enrutamiento infinitos.
- **Retransmisión y fan-out**: Si la notificación provino de otra instancia, el servidor programa un refetch con debounce y retransmite la actualización a sus suscriptores WebSocket conectados localmente.
- **Bucle de reconexión del supervisor**: Si la conexión de base de datos se cae, un supervisor de conexión en segundo plano monitoriza el estado y activa una secuencia de reconexión automática tras un retraso fijo de **3 segundos**, restaurando el bucle `LISTEN` sin afectar al ciclo de vida principal de la aplicación Hono.

## Captura de Cambios a Nivel de Base de Datos (CDC)

**La Captura de Datos de Cambios está activada de forma predeterminada.** Rebase captura los cambios en la base de datos y emite eventos en tiempo real para **cada escritura confirmada, sin importar cómo se hizo** — REST, SDK, Studio, `psql`, un cron job en otro servicio, Drizzle/SQL en crudo o el **editor SQL** de Studio. Este es el mismo modelo que Supabase Realtime siguiendo el registro de escritura anticipada (WAL).

No se requiere configuración. En una conexión de base de datos que lo admita, CDC se autoaprovisiona al iniciar; en una que no (p. ej., un rol restringido que no puede crear triggers), Rebase usa silenciosamente el tiempo real a nivel de aplicación en su lugar — nada que activar, nada que se rompa.

### Configuración

CDC se controla mediante la variable de entorno `REALTIME_CDC`:

| Valor | Comportamiento |
| --- | --- |
| `auto` *(predeterminado)* | Habilita la captura a nivel de base de datos donde la conexión lo admita; **recurre silenciosamente** al tiempo real a nivel de aplicación en caso contrario. Cero configuración. |
| `trigger` | Fuerza la captura basada en triggers. Funciona en cualquier PostgreSQL, incluidas instancias gestionadas sin replicación lógica. Advierte (en lugar de recurrir silenciosamente) si no puede aprovisionar. |
| `wal` | Prefiere la replicación lógica WAL. Aún no está incluida — degrada a `trigger` y registra el modo activo. |
| `off` | Solo tiempo real a nivel de aplicación. Úselo para evitar la sobrecarga del trigger por escritura en cargas de trabajo con muchas escrituras. |

Al iniciar verá una línea de log indicando el modo activo, p. ej.:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Si la conexión no puede admitirlo, `auto` registra una línea informativa en su lugar y continúa con el tiempo real a nivel de aplicación:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

### Cómo Funciona

1. **Autoaprovisionamiento** — Al iniciar (contexto de servidor/propietario), Rebase instala un trigger idempotente `AFTER INSERT/UPDATE/DELETE` en cada tabla gestionada. El trigger emite una notificación de cambio compacta en el canal `rebase_cdc`. Un payload que superaría el límite de 8&nbsp;KB de `NOTIFY` de PostgreSQL recurre a un mensaje de solo identidad, de modo que CDC nunca puede abortar la escritura que lo disparó.
2. **Captura** — Un cliente `LISTEN` dedicado y sin agrupar por instancia consume `rebase_cdc`, mapea la tabla modificada de vuelta a su colección y alimenta el cambio al mismo pipeline `RealtimeService` que usan las mutaciones de la API. Al igual que el listener entre instancias, prefiere `DATABASE_DIRECT_URL` y se reconecta automáticamente.
3. **Entrega segura para RLS** — La fila cruda del flujo de cambios **nunca** se reenvía a los suscriptores. El cambio se marca como invalidado, y cada suscripción vuelve a leer la fila bajo su **propio** contexto de autenticación. Por lo tanto, el filtrado es por suscriptor, nunca por emisor: un cliente solo recibe las filas que sus políticas RLS permiten.
4. **Entre instancias** — Debido a que cada instancia observa cada confirmación a través del flujo de cambios, CDC *es* también el canal entre instancias; la difusión heredada por mutación `rebase_entity_changes` no se usa mientras CDC está activo.
5. **De-duplicación** — Una mutación realizada a través de la API de Rebase se entrega localmente en el instante en que se confirma y también se refleja de vuelta a través del flujo de cambios. La instancia de origen suprime ese eco (un registro efímero de sus propias emisiones), de modo que los suscriptores nunca ven una escritura de la API dos veces.

### Requisitos y Notas

- CDC requiere una cadena de conexión directa (`DATABASE_DIRECT_URL` o la conexión principal) para el cliente `LISTEN` — los agrupadores de conexiones en modo transacción no admiten sesiones `LISTEN` de larga duración.
- Los triggers se instalan solo en tablas respaldadas por una colección registrada. Las escrituras en tablas no mapeadas se ignoran.
- Una colección cuya tabla aún no ha sido migrada se omite con una advertencia en lugar de bloquear CDC para el resto.
- El streaming nativo de replicación lógica WAL (`wal2json`/`pgoutput`) está planificado; hoy `REALTIME_CDC=wal` degrada a la ruta basada en triggers, que proporciona una cobertura equivalente a nivel de base de datos.

## Timeout de Peticiones Pendientes

Para evitar que las peticiones del cliente se queden colgadas indefinidamente, todas las operaciones WebSocket pendientes que esperan una respuesta del servidor (como las obtenciones puntuales de colección `FETCH_COLLECTION`, las obtenciones de una sola entidad `FETCH_ONE`, la creación/actualización `SAVE`, las eliminaciones `DELETE`, los conteos `COUNT` y las comprobaciones de unicidad `CHECK_UNIQUE_FIELD`) tienen un timeout predeterminado de 30 segundos.

Si el servidor no responde dentro de esta ventana de 30 segundos, el cliente elimina automáticamente la petición pendiente y rechaza la promesa con un `ApiError` con el mensaje `"Request timed out"`.

Los mensajes unidireccionales que no esperan respuesta (como `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` y `presence_state`) se resuelven inmediatamente al transmitirse y no activan timeouts.

## Próximos Pasos

- [SDK del Cliente](/docs/sdk) — Referencia completa del SDK, incluidos los accesores de colección tipados.
- [Autenticación](/docs/backend/authentication) — Configurar la autenticación JWT y las políticas RLS.
- [Arquitectura del Backend](/docs/backend) — Visión general de la arquitectura del servidor de Rebase.
