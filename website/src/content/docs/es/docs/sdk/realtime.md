---
sourceHash: f49369700dcdc098
title: Suscripciones en tiempo real
sidebar_label: Tiempo real
description: Suscríbete a cambios de datos en vivo con el SDK de cliente de Rebase utilizando listeners en tiempo real basados en WebSocket.
---

## Descripción general

El SDK de cliente de Rebase proporciona suscripciones a datos en tiempo real mediante WebSocket. Cuando los registros cambian en el servidor, las callbacks suscritas se ejecutan inmediatamente con los datos actualizados.

La conexión WebSocket se establece automáticamente cuando hay una `websocketUrl` disponible (derivada de `baseUrl` por defecto). La reconexión y la renovación de tokens se gestionan de forma transparente.

## Suscribirse a una colección

Usa `listen()` para suscribirte a una consulta de colección. La callback se ejecuta cada vez que cambia el conjunto de datos coincidente:

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

El método `listen()` acepta los mismos `FindParams` que `find()`; puedes filtrar, ordenar y paginar tu suscripción:

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

`FindResult<M>` tiene la misma forma que devuelve `find()`: filas planas en `data`, y `{ total, limit, offset, hasMore, nextCursor }` en `meta`.

### `listen()` acepta lo mismo que `find()`

`params` es un `FindParams` completo. Una suscripción es la misma consulta que el `find()` equivalente, por lo que acepta los mismos filtros y restricciones: `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** y **`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Esto es más importante de lo que parece. Antes, `include` y `fields` se omitían silenciosamente aquí, por lo que la misma consulta respondía con una estructura a través de `find()` y con otra a través de `listen()`, y un componente que renderizaba ambos veía cómo sus filas cambiaban de estructura en cuanto se realizaba una escritura. Ahora pasan por el mismo pipeline de lectura, por lo que `find({ q })` y `listen({ q })` devuelven filas que son idénticas campo por campo.

La excepción es `vectorSearch`, la cual es **rechazada** en lugar de omitida: una suscripción se vuelve a ejecutar con cada escritura coincidente y nada en ese proceso calcula distancias. Usa `.vectorSearch(…).find()` para la consulta y suscríbete sin ella.

### Una emisión por cambio

Cada push del servidor llama a tu callback **una sola vez**, con metadatos que describen las filas que lo acompañan. No hay una emisión separada para el render inicial ni ningún flag que comprobar.

Los metadatos llegan **en el mismo frame que las filas**: el servidor cuenta la consulta dentro de la misma transacción sujeta a seguridad a nivel de fila (row-level security) que las leyó, por lo que `meta.total`, `meta.hasMore` y `meta.nextCursor` describen con exactitud las filas adyacentes a ellos. (Antes, a cada push le seguía un `GET /count` del cliente: un viaje de ida y vuelta (round trip) adicional por escritura y por suscriptor, además de una ventana en la que el recuento y las filas describían estados diferentes de la colección).

Dos alternativas de respaldo (fallbacks), ninguna de las cuales constituye un error de suscripción ni invoca a `onError`:

- Si el **conteo del servidor falla**, el frame no contiene ningún total y se reutiliza el último que haya llegado. Un conteo fallido no dice nada sobre el tamaño de la colección, por lo que no debe sobrescribir una respuesta real.
- Si nunca ha llegado un total para esta suscripción (un servidor más antiguo que no envía metadatos en absoluto), el cliente lo solicita una vez, en el primer push. Si eso también falla, `meta.total` es un **límite inferior**: las filas de esta página más las páginas anteriores recorridas para llegar a ellas.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## Suscribirse a una sola entidad

Usa `listenById()` para observar un registro específico mediante su ID:

```typescript
// The SDK hands back a flat row, not an `Entity` — there is no `.values`.
const unsubscribe = client.data
    .collection<{ id: number; name: string }>("products")
    .listenById(
    42,
    (product) => {
        if (product) {
            console.log("Product changed:", product.name);
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

```typescript no-verify
listenById(
    id: string | number,
    onUpdate: (row: M | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

La callback recibe una fila plana (no una `Entity`, por lo que no existe `.values`) y `undefined` cuando el registro se elimina.

## Fluent Query Builder

También puedes suscribirte a través del fluent query builder. Esto es equivalente a llamar a `listen()` con parámetros, pero te permite encadenar `.where()`, `.orderBy()`, etc.:

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

Una suscripción admite ordenación por múltiples columnas como cualquier otra consulta, ya sea mediante `orderBy: [["category", "asc"], ["createdAt", "desc"]]` en los parámetros o con una segunda llamada a `.orderBy()`, la cual añade un criterio de desempate en lugar de reemplazar al primero. Consulta [Sorting](/docs/sdk/querying#sorting).

El servidor comprueba la *estructura* del `orderBy` de una suscripción al recibirlo y rechaza uno mal formado con un frame de error en lugar de suscribirse. De lo contrario, un ordenamiento que no pudiera interpretar transmitiría filas sin ningún orden en absoluto sin reportar ningún problema; y un frame `collection_update` solo transporta filas y nada más, por lo que un suscriptor no tendría forma de notarlo.

## Cancelar suscripción

Cada suscripción devuelve una función `unsubscribe`. Llámala para dejar de recibir actualizaciones y limpiar el listener de WebSocket:

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

En React, usa la función de limpieza de `useEffect`:

```tsx
useEffect(() => {
    const unsubscribe = client.data.products.listen(
        { where: { active: ["==", true] } },
        (response) => setProducts(response.data)
    );
    return () => unsubscribe();
}, []);
```

## Autenticación y reconexión

El cliente WebSocket gestiona la autenticación automáticamente:

- Al **iniciar sesión** o **renovar el token**, el nuevo token se envía a un socket ya abierto a través de un mensaje `authenticate`. Si no hay ninguno abierto, no ocurre nada: iniciar sesión no es una solicitud de tiempo real, y un socket abierto más tarde se autentica por sí mismo.
- Al **cerrar sesión**, la conexión WebSocket se desconecta. El cliente sigue siendo utilizable; una suscripción posterior se reconecta de forma anónima.
- Si la conexión se cae, el cliente **se reconecta automáticamente** y restablece todas las suscripciones activas.

No se requiere una gestión manual de tokens: la integración entre `client.auth` y la capa WebSocket se maneja internamente.

### La conexión es diferida (lazy)

Crear un cliente **no** abre un WebSocket. Este se establece en la primera operación que realmente lo necesita: una suscripción con `listen()` / `listenById()`, o una operación de canal como `join()`, `track()` o `broadcast()`. Obtener un canal no implica usarlo.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Esto es importante para aplicaciones con un tráfico significativo de usuarios no autenticados (páginas de marketing, vistas públicas de solo lectura, herramientas anónimas), que antes pagaban el coste de una conexión en cada carga de página simplemente para tener el tiempo real disponible.

Dos comportamientos relacionados:

- `realtime: false` sigue siendo una exclusión estricta: nunca se crea ningún socket y `client.realtime.channel()` lanza un error. Lo mismo ocurre con `listen()` y `listenById()`: siempre están disponibles para ser llamados, y en un cliente sin socket lanzan un `RebaseClientError` indicando la opción que los habilitaría. `observe()` no lo hace: se degrada a una sola petición (fetch).
- `client.close()` es definitivo. Libera el socket y su temporizador de reconexión, y nada que se ponga en cola después volverá a intentar la conexión. En Node, un socket abierto mantiene vivo el bucle de eventos (event loop), por lo que un script que nunca lo llame no finalizará por sí solo.

## Canales de difusión (Broadcast Channels)

Los canales de difusión (broadcast channels) te permiten enviar mensajes arbitrarios entre clientes conectados; ideal para chat, notificaciones o funciones colaborativas:

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

Los canales son ligeros y efímeros: existen mientras al menos un cliente esté suscrito. Las llamadas repetidas a `channel()` con el mismo nombre devuelven el **mismo** objeto, por lo que dos componentes pueden asociar manejadores de forma independiente sin que uno desconecte al otro al salir.

Los frames de canal y de presencia no requieren una cuenta: los visitantes anónimos pueden unirse a canales públicos.

:::caution[Los canales aún no tienen reglas de acceso]
La única comprobación que aplica el servidor es la **membresía**: para emitir en un canal, leer su lista de presencia o reproducir su historial, un cliente debe haberse unido a ese canal primero. El unirse en sí es abierto: cualquier cliente que conozca el nombre de un canal puede unirse a él, esté o no autenticado.

Por lo tanto, el nombre de un canal no es un secreto ni un permiso. No pongas nada en un canal (incluido el historial retenido y el estado de presencia) que no deba ser visto por todos los usuarios de tu aplicación, y no derives el nombre de un canal a partir de datos que no compartirías públicamente. Las reglas de autorización por canal no están implementadas; si las necesitas actualmente, mantén la parte confidencial del intercambio en `client.data`, donde se aplica la seguridad a nivel de fila.
:::

> **Por defecto, las difusiones no se reproducen.** Solo llegan a los miembros conectados actualmente. Esto es lo adecuado para notificaciones que se autocorigen (un aviso de "alguien guardó" es reemplazado por el siguiente guardado) y no supone ningún coste adicional. Para un flujo de operaciones, donde una omisión silenciosa causa divergencia, habilita el [historial de mensajes](#message-history-and-catch-up) en el canal.

## Historial de mensajes y puesta al día (Catch-Up)

Un canal puede configurarse para conservar sus difusiones, de modo que un cliente que se reconecte se ponga al día con lo que se perdió en lugar de volver a sincronizarse desde cero. Esto es lo que hace que los canales sean utilizables como transporte para la edición colaborativa.

La retención se configura **en el servidor**, por patrón de canal; consulta [Realtime Backend](/docs/backend/realtime#channel-retention). Un cliente no puede activarla por sí mismo, ya que un canal es creado por cualquiera que le dé un nombre, y una profundidad de historial elegida por el cliente permitiría a cualquier visitante comprometer el almacenamiento de tu backend sin límite.

En un canal con retención, pasa `{ history: true }` y el SDK se encargará del resto:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

En `join()` y tras cada reconexión, el SDK solicita al servidor todo lo ocurrido después del último número de secuencia que vio y entrega el resultado a través de los mismos manejadores. No hay que escribir una segunda ruta de código: un manejador que aplica una operación correctamente en vivo la aplica correctamente al ponerse al día.

### Números de secuencia

Cada emisión en un canal con retención incluye un `seq`: por canal, sin huecos y estrictamente incremental. Es el punto de reanudación del cliente.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Persiste `channel.sequence` si deseas que la puesta al día sobreviva a la recarga de una página además de a una reconexión, y pásalo de nuevo mediante `history({ sinceSeq })`.

### Obtener el historial explícitamente

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` significa que el canal no conserva ningún historial y nunca lo hará; una respuesta explícita para poder diferenciar entre "no te has perdido nada" y "este canal no tiene regla de retención". En el segundo caso, un cliente que necesite converger debe recurrir a una resincronización completa.

`latestSeq` es la secuencia más alta que conserva el servidor, independientemente de si este lote la alcanzó o no. Si está muy por delante de tu último `seq` entregado, estás más retrasado que una sola página y resincronizar puede ser más eficiente que paginar.

:::note[Las reproducciones pueden solaparse, y eso no es un problema]
El servidor no puede saber con certeza qué mensajes recibiste antes de que cayera el socket, por lo que un rango de puesta al día puede incluir algunos que ya hayas aplicado. El SDK descarta cualquier elemento que esté en o por debajo de la secuencia que ya entregó, por lo que los manejadores nunca ven un mensaje dos veces.

Tus propios mensajes **no** se filtran de una reproducción: una reconexión asigna un nuevo client id, por lo que el caso exacto para el que existe la puesta al día es aquel en el que dicho filtro fallaría. Haz que las operaciones sean idempotentes si volver a aplicar las tuyas resultara problemático.
:::

## Seguimiento de presencia (Presence Tracking)

La presencia te permite rastrear qué usuarios están en línea y sincronizar el estado compartido entre todos los participantes:

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

El SDK mantiene la lista de participantes (roster) por ti, por lo que `presences` siempre está completo y nunca tienes que reconstruirlo a partir de diffs.

También gestiona dos detalles de protocolo que son fáciles de implementar incorrectamente cuando se trabaja directamente con WebSocket puro:

- **La lista de participantes no se envía automáticamente al unirse.** El primer `presence_diff` de un cliente que se une solo se contiene a sí mismo; la lista existente debe solicitarse explícitamente. `join()` lo hace por ti.
- **La presencia expira después de 30 segundos.** `track()` no es un registro duradero: sin un reenvío periódico, desaparecerás silenciosamente de la lista de los demás mientras sigues conectado y en la página. El SDK envía un heartbeat cada 20 segundos y se detiene en `untrack()` / `leave()`.

Una reconexión también elimina la membresía del canal y la presencia en el servidor; el SDK se vuelve a unir, solicita nuevamente la lista de participantes y vuelve a registrar la presencia automáticamente.

## Cuándo usar tiempo real

| Caso de uso | Método |
|-------------|--------|
| Dashboard con datos en vivo | `listen()` con filtros |
| Chat o mensajería | `channel.broadcast()` |
| Edición colaborativa / flujos de operaciones | `channel(name, { history: true })` |
| Indicadores de escritura / estado en línea | `channel.track()` + `channel.onPresence()` |
| Página de detalle con actualizaciones en vivo | `listenById()` |
| Monitorización en paneles de administración | `listen()` con `orderBy` y `limit` |
| Una lista que debe sobrevivir a una conexión caída | `observe()` con [offline](/docs/sdk/offline) habilitado |

> **Consejo:** Para consultas de datos puntuales, usa `find()` o `findById()` en su lugar. Las suscripciones son ideales para datos que cambian con frecuencia y necesitan reflejarse en la interfaz de usuario de inmediato.

## `listen()` frente a `observe()`

Ambos mantienen una consulta actualizada y ambos devuelven una función para cancelar la suscripción, pero responden a diferentes necesidades.

`listen()` es el socket: entrega lo que el servidor envía y no entrega nada cuando el socket está caído.

`observe()` es la consulta: con [offline](/docs/sdk/offline) habilitado, emite primero desde la base de datos local (antes de cualquier petición) y vuelve a emitir ante escrituras locales, escrituras en cola que llegan al servidor, rollbacks y eventos en tiempo real, a los cuales se suscribe internamente a menos que pases `{ realtime: false }`. Cada resultado indica si provino de la caché y si contiene escrituras que el servidor aún no ha aceptado.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Sin el modo offline habilitado, `observe()` es `find()` más `listen()` en una sola llamada, con esos flags siempre en `false`.

## Próximos pasos

- **[Consultar datos](/docs/sdk/querying)** — Operaciones CRUD y constructor de consultas
- **[Sincronización offline y local-first](/docs/sdk/offline)** — Consultas en vivo que sobreviven a una conexión caída
- **[Autenticación](/docs/sdk/authentication)** — Inicio de sesión y gestión de sesiones
- **[Backend en tiempo real](/docs/backend/realtime)** — Configuración de WebSocket en el lado del servidor

---
