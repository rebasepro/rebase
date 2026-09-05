---
title: Suscripciones en Tiempo Real
sidebar_label: Tiempo Real
description: Suscríbase a los cambios de datos en vivo con el SDK del Cliente de Rebase mediante listeners en tiempo real basados en WebSocket.
---

## Resumen

El SDK del Cliente de Rebase proporciona suscripciones a datos en tiempo real mediante WebSocket. Cuando los registros cambian en el servidor, sus callbacks suscritos se disparan de inmediato con los datos actualizados.

La conexión WebSocket se establece automáticamente cuando hay una `websocketUrl` disponible (derivada de `baseUrl` de forma predeterminada). La reconexión y el refresco de tokens se gestionan de forma transparente.

## Suscribirse a una Colección

Use `listen()` para suscribirse a una consulta de colección. El callback se dispara cada vez que cambia el conjunto de datos coincidente:

```typescript
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (response) => {
        console.log("Products updated:", response.data);
        console.log("Total:", response.meta.total);
    }
);

// Stop listening when done
unsubscribe();
```

El método `listen()` acepta los mismos `FindParams` que `find()` — puede filtrar, ordenar y paginar su suscripción:

```typescript
const unsubscribe = client.data.orders.listen(
    {
        where: { status: ["==", "pending"] },
        orderBy: ["createdAt", "desc"],
        limit: 20
    },
    (response) => {
        renderOrders(response.data);
    },
    (error) => {
        console.error("Subscription error:", error);
    }
);
```

### Firma

```typescript no-verify
listen(
    params: FindParams<M> | undefined,
    onUpdate: (result: FindResult<M>) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

`FindResult<M>` es la misma forma que devuelve `find()`: filas planas en `data` y
`{ total, limit, offset, hasMore }` en `meta`.

### Una emisión por cambio

Cada envío del servidor llama a tu callback **una vez**, con metadatos que describen
las filas que lo acompañan. No hay una primera emisión aparte ni ningún indicador que
comprobar:

- Antes de la emisión se ejecuta un `count()` para la consulta, así que `meta.total` y
  `meta.hasMore` son autoritativos.
- Si llega un envío mientras ese recuento sigue en curso, la emisión anterior se
  descarta: nunca recibirás un total que pertenece a una página anterior.
- Si el recuento **falla**, se reutiliza el último total que un recuento devolvió de
  verdad. Un recuento fallido no dice nada sobre el tamaño de la colección, así que no
  puede sobrescribir una respuesta real. Esto no es un error de suscripción y no se
  llama a `onError`.
- Si ningún recuento ha tenido éxito para esta suscripción, `meta.total` es una **cota
  inferior** — las filas de esta página más las que se saltaron para llegar a ellas — y
  `meta.hasMore` es `true` cuando la página vino llena.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## Suscribirse a una Sola Entidad

Use `listenById()` para observar un registro específico por su ID:

```typescript
const unsubscribe = client.data.products.listenById(
    42,
    (entity) => {
        if (entity) {
            console.log("Product changed:", entity.values.name);
        } else {
            console.log("Product was deleted");
        }
    },
    (error) => {
        console.error("Subscription error:", error);
    }
);
```

### Firma

```typescript
listenById(
    id: string | number,
    onUpdate: (row: M | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

El callback recibe una fila plana — no una `Entity`, así que no hay `.values` — y
`undefined` cuando el registro se elimina.

## Constructor de Consultas Fluido

También puede suscribirse a través del constructor de consultas fluido. Es equivalente a llamar a `listen()` con parámetros, pero permite encadenar `.where()`, `.orderBy()`, etc.:

```typescript
const unsubscribe = client.data.products
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(20)
    .listen(
        (response) => console.log("Updated:", response.data),
        (error) => console.error("Error:", error)
    );
```

## Cancelar la Suscripción

Cada suscripción devuelve una función `unsubscribe`. Llámela para dejar de recibir actualizaciones y limpiar el listener de WebSocket:

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

En React, use la limpieza de `useEffect`:

```tsx
useEffect(() => {
    const unsubscribe = client.data.products.listen(
        { where: { active: ["==", true] } },
        (response) => setProducts(response.data)
    );
    return () => unsubscribe();
}, []);
```

## Autenticación y Reconexión

El cliente WebSocket gestiona la autenticación automáticamente:

- Al **iniciar sesión** o **refrescar el token**, el nuevo token se envía al servidor WebSocket mediante un mensaje `authenticate`.
- Al **cerrar sesión**, la conexión WebSocket se desconecta.
- Si la conexión se cae, el cliente **se reconecta automáticamente** y restablece todas las suscripciones activas.

No se necesita gestión manual de tokens — la integración entre `client.auth` y la capa WebSocket se gestiona internamente.

## Canales de Difusión (Broadcast)

Los canales de difusión le permiten enviar mensajes arbitrarios entre clientes conectados — ideal para chat, notificaciones o funciones colaborativas:

```typescript
// Obtain a channel. This alone opens no connection.
const channel = client.realtime.channel("chat-room");

// Listen for broadcasts. Pass an event name to filter, or omit it for all.
channel.onBroadcast("message", (payload) => {
    console.log("New message:", payload);
});

// Send to every other member — the sender never receives its own message.
await channel.broadcast("message", {
    text: "Hello, world!",
    userId: currentUser.id
});

// Leave, releasing handlers and timers.
await channel.leave();
```

Los canales son ligeros y efímeros — existen mientras al menos un cliente esté suscrito. Las llamadas repetidas a `channel()` con el mismo nombre devuelven el **mismo** objeto, por lo que dos componentes pueden adjuntar manejadores de forma independiente sin que uno corte al otro al salir.

Las tramas de canal y presencia no requieren una cuenta: los visitantes anónimos pueden unirse a canales públicos.

:::caution[Los canales aún no tienen reglas de acceso]
La única comprobación que aplica el servidor es la **pertenencia**: para difundir en un canal, leer su lista de presencia o reproducir su historial, el cliente debe haberse unido antes a ese canal. Unirse, en cambio, está abierto — cualquier cliente que pueda nombrar un canal puede unirse a él, tenga o no sesión iniciada.

Así que el nombre de un canal no es un secreto ni un permiso. No ponga en un canal (incluidos el historial retenido y el estado de presencia) nada que no puedan ver todos los usuarios de su aplicación, y no derive el nombre de un canal de datos que no repartiría. Las reglas de autorización por canal no están implementadas; si las necesita hoy, mantenga la mitad sensible del intercambio en `client.data`, donde sí se aplica la seguridad a nivel de fila.
:::

> **Por defecto, las difusiones no se reproducen.** Solo llegan a los miembros conectados en ese momento. Eso es lo que se quiere para notificaciones que se autocorrigen — un aviso de «alguien ha guardado» queda sustituido por el siguiente guardado — y no cuesta nada. Para un flujo de operaciones, donde un hueco silencioso causa divergencia, active el [historial de mensajes](#historial-de-mensajes-y-recuperación) en el canal.

## Historial de Mensajes y Recuperación

Un canal puede configurarse para conservar sus difusiones, de modo que un cliente que se reconecta recupere lo que se perdió en lugar de resincronizarse desde cero. Esto es lo que hace que los canales sirvan como transporte para la edición colaborativa.

La retención se configura **en el servidor**, por patrón de canal — consulte [Backend de Tiempo Real](/docs/backend/realtime#retención-de-canales). Un cliente no puede activarla por su cuenta, porque un canal lo crea quien lo nombra, y una profundidad de historial elegida por el cliente permitiría a cualquier visitante comprometer su backend con almacenamiento ilimitado.

En un canal con retención, pase `{ history: true }` y el SDK hace el resto:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

Al hacer `join()` y tras cada reconexión, el SDK pide al servidor todo lo posterior al último número de secuencia que vio, y entrega el resultado a través de los mismos manejadores. No hay un segundo camino de código que escribir: un manejador que aplica una operación correctamente en vivo la aplica correctamente al recuperar.

### Números de secuencia

Cada difusión en un canal con retención lleva un `seq` — por canal, sin huecos y creciente. Es el punto de reanudación del cliente.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Guarde `channel.sequence` si quiere que la recuperación sobreviva también a una recarga de página, y devuélvalo mediante `history({ sinceSeq })`.

### Obtener el historial explícitamente

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` significa que el canal no guarda historial y nunca lo hará — una respuesta explícita, para que pueda distinguir «no se perdió nada» de «este canal no tiene regla de retención». En el segundo caso, un cliente que necesite converger debe recurrir a una resincronización completa.

`latestSeq` es la secuencia más alta que tiene el servidor, haya llegado o no este lote hasta ella. Si está muy por delante de su último `seq` entregado, va más atrasado que una página y resincronizar puede salir más barato que paginar.

:::note[Las repeticiones pueden solaparse, y no pasa nada]
El servidor no puede saber exactamente qué mensajes le llegaron antes de que cayera la conexión, así que un rango de recuperación puede incluir algunos que ya aplicó. El SDK descarta todo lo que esté en o por debajo de la secuencia que ya entregó, de modo que los manejadores nunca ven un mensaje dos veces.

Sus propios mensajes **no** se filtran de una repetición: una reconexión asigna un nuevo id de cliente, así que el caso mismo para el que existe la recuperación es aquel en el que ese filtro fallaría. Haga que las operaciones sean idempotentes si volver a aplicar las suyas fuera un problema.
:::
## Seguimiento de Presencia

La presencia le permite rastrear qué usuarios están en línea y sincronizar el estado compartido entre todos los participantes:

```typescript
const channel = client.realtime.channel("editors");

// Publish your presence. This is also what opens the connection.
await channel.track({
    userId: currentUser.id,
    status: "editing",
    cursor: { x: 100, y: 200 }
});

// One handler for every change. `presences` is always the full roster;
// `diff` is what changed, when you only care about the delta.
channel.onPresence((presences, diff) => {
    console.log("Online users:", Object.keys(presences));
    if (diff) {
        console.log("joined:", Object.keys(diff.joins));
        console.log("left:", Object.keys(diff.leaves));
    }
});

// Calling track() again replaces your state — this is how you publish a
// moving cursor.
await channel.track({ userId: currentUser.id, status: "idle" });

// Stop publishing without leaving the channel.
await channel.untrack();
```

La presencia se construye sobre los canales de difusión con diferenciación automática del estado — solo se transmiten los cambios.

## Cuándo Usar el Tiempo Real

| Caso de Uso | Método |
|----------|--------|
| Panel con datos en vivo | `listen()` con filtros |
| Chat o mensajería | `channel.broadcast()` |
| Edición colaborativa / flujos de operaciones | `channel(name, { history: true })` |
| Indicadores de escritura / estado en línea | `channel.track()` + `channel.onPresence()` |
| Página de detalle con actualizaciones en vivo | `listenById()` |
| Monitorización del panel de administración | `listen()` con `orderBy` y `limit` |

> **Consejo:** Para obtener datos una sola vez, use `find()` o `findById()` en su lugar. Las suscripciones son mejores para datos que cambian con frecuencia y deben reflejarse en la UI de inmediato.

## Próximos Pasos

- **[Consultar Datos](/docs/sdk/querying)** — Operaciones CRUD y constructor de consultas
- **[Autenticación](/docs/sdk/authentication)** — Inicio de sesión y gestión de sesiones
- **[Backend en Tiempo Real](/docs/backend/realtime)** — Configuración de WebSocket del lado del servidor
