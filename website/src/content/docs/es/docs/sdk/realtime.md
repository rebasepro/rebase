---
sourceHash: b9f712f58936dac9
title: Suscripciones en tiempo real
sidebar_label: Tiempo real
description: Suscríbete a cambios de datos en vivo con el SDK tipado de Rebase usando listeners en tiempo real basados en WebSocket.
---

## Visión general

El SDK tipado de Rebase proporciona suscripciones a datos en tiempo real a través de WebSocket. Cuando los registros cambian en el servidor, tus callbacks suscritos se ejecutan inmediatamente con los datos actualizados.

La conexión WebSocket se establece automáticamente cuando un `websocketUrl` está disponible (derivado de `baseUrl` por defecto). La reconexión y la actualización del token se gestionan por ti. Una interrupción que dure más de unos 15 segundos se reporta una vez, al `onError` de cada suscripción, como `CONNECTION_LOST` — consulta [Autenticación y reconexión](#autenticación-y-reconexión).

## Suscribirse a una colección

Usa `listen()` para suscribirte a una consulta de colección. El callback se dispara cada vez que cambia el conjunto de datos coincidentes:

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

El método `listen()` acepta los mismos `FindParams` que `find()` — puedes filtrar, ordenar y paginar tu suscripción:

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

`FindResult<M>` tiene la misma forma que devuelve `find()`: filas planas en `data`, y
`{ total, limit, offset, hasMore, nextCursor }` en `meta`.

### `listen()` acepta lo que acepta `find()`

`params` es un `FindParams` completo. Una suscripción es la misma consulta que el
`find()` que la acompaña, por lo que acepta los mismos filtros y opciones — `where`, `logical`,
`orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** y
**`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Esto importa más de lo que parece. Antes, `include` y `fields` se descartaban silenciosamente
aquí, por lo que la misma consulta respondía con una estructura a través de `find()` y con otra
a través de `listen()`, y un componente que renderizaba ambas veía cambiar la forma de sus filas
en el momento en que se producía una escritura. Ahora pasan por el mismo pipeline de lectura,
por lo que `find({ q })` y `listen({ q })` devuelven filas que coinciden campo por campo.

La excepción es `vectorSearch`, que es **rechazado** en lugar de ignorado: una
suscripción se vuelve a ejecutar con cada escritura coincidente y nada allí calcula
distancias. Usa `.vectorSearch(…).find()` para la consulta y suscríbete sin él.

### Una emisión por cambio

Cada push del servidor llama a tu callback **una vez**, con metadatos que describen las
filas que lo acompañan. No hay una emisión separada para el primer renderizado (first-paint) ni ningún indicador que comprobar.

Los metadatos llegan **en el mismo frame que las filas**: el servidor cuenta la
consulta dentro de la misma transacción vinculada a la seguridad a nivel de fila (RLS) que las leyó, por lo que
`meta.total`, `meta.hasMore` y `meta.nextCursor` describen exactamente las filas
junto a ellos. (Antes, cada push iba seguido de un `GET /count` desde el cliente
— un round trip adicional por escritura, por suscriptor, y una ventana de tiempo en la que el
recuento y las filas describían estados diferentes de la colección).

Dos mecanismos de respaldo (fallbacks), ninguno de los cuales es un error de suscripción ni llama a
`onError`:

- Si el **conteo del servidor falló**, el frame no contiene ningún total y se reutiliza el último
  que llegó. Un conteo fallido no dice nada sobre cuán grande es la colección,
  por lo que no debe sobrescribir una respuesta real.
- Si nunca ha llegado un total para esta suscripción —un servidor más antiguo que
  no envía ningún metadato—, el cliente pregunta una vez, en el primer push. Si eso
  también falla, `meta.total` es un **límite inferior**: las filas en esta página más
  las que se paginaron previamente para llegar a ellas.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## Suscribirse a una entidad individual

Usa `listenById()` para observar un registro específico por su ID:

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
    onError?: (error: Error) => void,
    options?: { include?: IncludeSpec }
): () => void   // returns unsubscribe function
```

El callback recibe una fila plana —no un `Entity`, por lo que no hay `.values`—
y `undefined` cuando el registro es eliminado.

Cada frame incluye las relaciones nombradas en `options.include`, cargadas tal como `find({ include })`
las carga en cada fila de una lista. Una relación de uno a muchos no especificada allí estará ausente
de la fila, no vacía:

```typescript
client.data.posts.listenById(1, (post) => {
    console.log(post?.tags); // the post's tags, on every update
}, undefined, { include: ["tags"] });
```

**Límites.** Se envía un frame cuando la fila en sí cambia, y cada frame recarga sus relaciones
incluidas. Un cambio únicamente en una fila relacionada no envía ningún frame: editar el nombre de una etiqueta no
actualiza un post escuchado con `include: ["tags"]` hasta que el post también cambie. Para seguir
las filas relacionadas, escucha también su colección.

## Observar un recuento

`listenCount()` mantiene actualizado un conteo: el total de lo que coincide con el filtro de una lista, para una
barra de herramientas o una opción de "seleccionar los N" que no debe quedar desactualizada mientras otras personas agregan y eliminan filas.
El callback se ejecuta con el total una vez que se conoce, y nuevamente cada vez que una escritura lo modifique.

```typescript
const stop = client.data.orders.listenCount(
    { where: { status: ["==", "open"] } },
    (total) => console.log(`${total} open orders`),
    (error) => console.error(error)
);
```

Solo se toma en cuenta el filtro — `where`, `logical` y `searchString`; un `limit`, un `offset` o una ordenación se
ignoran. El servidor no lee ninguna fila para esto, solo el recuento, bajo la identidad del suscriptor como cualquier
otro frame. Un servidor anterior a la versión 0.25 no reconoce la solicitud; esta se responde con una fila y el
mismo total, y el SDK lee el total de allí. En un cliente sin socket, `listenCount()` es un
stub que arroja un error, al igual que `listen()`. Con el [soporte sin conexión](/docs/sdk/offline/)
activado, el conteo es el del servidor: las escrituras en cola no se reflejan en él hasta que se reproduzcan.

## Constructor de consultas fluido (Fluent Query Builder)

También puedes suscribirte mediante el constructor de consultas fluido. Esto es equivalente a llamar a `listen()` con parámetros, pero te permite encadenar `.where()`, `.orderBy()`, etc.:

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

Una suscripción admite ordenación por múltiples columnas como cualquier otra consulta — ya sea
`orderBy: [["category", "asc"], ["createdAt", "desc"]]` en los parámetros, o una
segunda llamada a `.orderBy()`, que agrega un criterio de desempate en lugar de reemplazar al
primero. Consulta [Ordenación](/docs/sdk/querying#sorting).

El servidor verifica la *forma* del `orderBy` de una suscripción al recibirlo y
rechaza uno mal formado con un frame de error en lugar de suscribir. De lo contrario, un orden
que no pudiera leer transmitiría filas sin ningún orden mientras reporta que todo está bien — y un
frame `collection_update` solo lleva filas y nada más, por lo que un suscriptor no tendría forma de notarlo.

## Cancelar la suscripción

Cada suscripción devuelve una función `unsubscribe`. Llámala para dejar de recibir actualizaciones y limpiar el listener de WebSocket:

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

En React, usa la limpieza de `useEffect`:

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

- Al **iniciar sesión** o **actualizar el token**, un socket ya abierto toma la nueva credencial. Una actualización, o un inicio de sesión con la cuenta que ya tiene, envía el token en un mensaje `authenticate`; un inicio de sesión con una cuenta diferente —incluido un visitante que inicia sesión— reconstruye el socket, el cual se autentica con esa cuenta y vuelve a enviar cada suscripción y canal activo. Si no hay ninguno abierto, no ocurre nada: iniciar sesión no es una solicitud de tiempo real, y un socket abierto más tarde se autentica por sí mismo.
- Al **cerrar sesión**, la conexión WebSocket se desconecta. El cliente sigue siendo utilizable; una suscripción posterior se reconecta de forma anónima.
- Si la conexión se cae, el cliente **se reconecta automáticamente** y restablece todas las suscripciones activas. Nunca deja de intentarlo mientras exista una suscripción o un canal al que se haya unido; la espera entre intentos aumenta hasta un máximo de 30 segundos.
- Si el servidor finaliza la sesión del socket —el usuario cerró sesión en todas partes, esta sesión fue revocada, la cuenta fue eliminada o el token expiró antes de que la actualización llegara al socket—, cierra el socket con el código `4001`. El cliente se reconecta como después de cualquier caída, autenticándose con la sesión que tenga en ese momento (actualizada si es posible), o de forma anónima cuando no haya ninguna. La revocación de un rol no cierra el socket: se aplica a partir del siguiente frame. Consulta [Autenticación y RLS](/docs/backend/realtime/#authentication--rls).
- Si la conexión permanece caída durante más de unos 15 segundos, se llama **una vez** al `onError` de cada suscripción (y al `onError` de cada canal unido) con un `RebaseApiError` cuyo `code` es `CONNECTION_LOST`. La suscripción no se finaliza: sigue mostrando lo que tienes, márcalo como posiblemente desactualizado y espera. Cuando el socket vuelva, el siguiente `onUpdate` de la suscripción traerá todo lo escrito en el intervalo.
- `client.ws.state` es el estado de la conexión — `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` o `closed` — y a `client.ws.onStateChange(listener)` se le notifica cada cambio. `disconnected` es el estado en el que se ha reportado `CONNECTION_LOST`.
- Las solicitudes enviadas a través del socket son de tipo **a lo sumo una vez (at-most-once)**. Una enviada cuando la conexión se cayó falla con `CONNECTION_LOST` y nunca se vuelve a enviar, ya que el servidor podría haberla ejecutado. Una que aún espera un socket después de 30 segundos falla con `REQUEST_TIMEOUT` sin haber sido enviada.

Todo en la lista posterior al cierre de sesión se incorporó en la versión 0.24. En la 0.23, el cliente se rinde tras
cinco intentos fallidos de reconexión, pone en cola las solicitudes realizadas mientras está desconectado y
las envía al reconectarse, no tiene `client.ws.state`, y el servidor nunca cierra un
socket cuya sesión haya finalizado.

```typescript
import { RebaseApiError } from "@rebasepro/client";

const unsubscribe = client.data.orders.listen(
    { where: { status: ["==", "open"] } },
    (response) => {
        setOrders(response.data);
        setStale(false);
    },
    (error) => {
        if (error instanceof RebaseApiError && error.code === "CONNECTION_LOST") {
            setStale(true); // keep the rows; the next update clears it
            return;
        }
        setError(error);
    }
);
```

### Qué token envía el socket

En la versión 0.24, el
socket solo utiliza la propia sesión del cliente y la opción `token`: un getter
instalado con `client.setAuthTokenGetter()` nunca llega a él, por lo que un host que use
su propio proveedor de autenticación obtiene un socket anónimo.

El socket se autentica con el mismo token que llevaría una solicitud HTTP. Ese
es primero el getter instalado con `client.setAuthTokenGetter()`; cuando no hay
ninguno, o este responde `null` o arroja un error, es el token que tiene el cliente: el de su
sesión, uno configurado con `client.setToken()`, o la opción `token`. Con el
`client.auth` integrado no hay nada que configurar.

Para un proveedor de autenticación externo (Clerk, Firebase Auth, una sesión propia),
instala el getter una vez. Cubre tanto HTTP como el socket:

```typescript
client.setAuthTokenGetter(() => provider.getToken());

// Optional: let the provider recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await provider.refresh();
    return true; // retry with the token resolved again
});
```

- `client.setOnUnauthorized(handler)` responde a un token rechazado en ambos: un 401
  a través de HTTP y un error de autenticación en el socket. Resuelve `true` para reintentar con el
  token resuelto de nuevo. Reemplaza la actualización de sesión propia del cliente.
- Instalar un getter o llamar a `client.setToken()` reconstruye un socket abierto:
  el nuevo se autentica con la nueva credencial y reenvía cada suscripción y canal activo
  bajo esta, y nada de lo que tenía la identidad anterior se transfiere. Si no hay ningún socket abierto, el siguiente se autenticará automáticamente.
- `client.ws.setAuthTokenGetter()` está obsoleto (deprecated). Todavía funciona, reemplazando
  únicamente el getter del socket, y emite una advertencia una sola vez. Usa `client.setAuthTokenGetter()`.

Consulta [Uso de tu propio proveedor de autenticación](/docs/sdk/authentication#using-your-own-auth-provider).

### La conexión es perezosa (lazy)

Crear un cliente **no** abre un WebSocket. Se conecta en la primera operación que realmente necesita uno — una suscripción `listen()` / `listenById()`, o una operación de canal como `join()`, `track()` o `broadcast()`. Obtener un canal no significa usarlo.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Esto es importante para aplicaciones con tráfico considerable de usuarios no autenticados —páginas de marketing, vistas públicas de solo lectura, herramientas anónimas por defecto— que antes pagaban el costo de una conexión en cada carga de página simplemente para tener el tiempo real disponible.

Dos comportamientos relacionados:

- `realtime: false` sigue siendo una desactivación explícita estricta: nunca habrá socket, y `client.realtime.channel()` arroja un error. Lo mismo ocurre con `listen()` y `listenById()` — siempre están disponibles para ser llamados, y en un cliente sin socket arrojan un `RebaseClientError` indicando la opción que los habilitaría. `observe()` no lo hace: se degrada a una sola petición (fetch).
- `client.close()` es definitivo. Libera el socket y su temporizador de reconexión, y nada de lo que se ponga en cola posteriormente volverá a conectarse. En Node, un socket abierto mantiene activo el bucle de eventos (event loop), por lo que un script que nunca lo llame no finalizará por sí solo.

### Mantener un grupo en una sola instancia

Con más de una instancia de servidor, los miembros de un canal pueden terminar en diferentes instancias, y cada mensaje entre ellos entonces [cruza el bus de canales](/docs/backend/realtime-transports/#channels-and-presence-across-instances). `affinity` nombra el grupo al que pertenece un socket, como una sala o un documento, de modo que una plataforma pueda enviar a todo el grupo a la misma instancia:

```typescript
const client = createRebaseClient({
    baseUrl,
    realtime: { affinity: roomCode }
});
```

Cuando la clave solo se conoce más tarde, establécela antes de que se abra el socket:

```typescript
const client = createRebaseClient({ baseUrl });

client.realtime.setAffinity(roomCode);          // no socket yet
await client.realtime.channel(roomCode).join(); // opens with the key
```

La clave se añade a la dirección del socket como `?affinity=`, y reemplaza a la que ya esté en un `websocketUrl` configurado. `setAffinity(null)` la borra.

- **Es una optimización.** Rebase Cloud enruta según esto cuando un proyecto ejecuta más de una instancia. En implementaciones autoalojadas (self-hosted), o detrás de un proxy que no haga hash con ella, no hace nada y los canales funcionan igual: el bus sigue transmitiendo todo lo que abarque múltiples instancias, incluido un grupo que se divida por un escalado.
- **Surte efecto cuando el socket se conecta.** Un socket ya abierto permanece donde está y usará la nueva clave la próxima vez que se conecte. Para mover un cliente que ya esté conectado, crea uno nuevo o establece la clave antes de su primer `join()` o `listen()`.
- **Decide a dónde va a parar un socket, no a qué puede unirse.** El acceso a un canal no depende de esto, y la dirección termina en los registros de acceso (access logs), por lo que es preferible usar un código en lugar de un secreto o cualquier dato personal.

Para ver si funciona, compara lo que cada instancia publica y omite: consulta [Ver qué hace el bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Canales de difusión (Broadcast Channels)

Los canales de difusión te permiten enviar mensajes arbitrarios entre clientes conectados — ideales para chat, notificaciones o funciones colaborativas:

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

Los canales son ligeros y efímeros — existen mientras al menos un cliente esté suscrito. Las llamadas repetidas a `channel()` con el mismo nombre devuelven el **mismo** objeto, por lo que dos componentes pueden adjuntar manejadores de forma independiente sin que uno desconecte al otro al salir.

Los frames de canales y presencia no requieren una cuenta: los visitantes anónimos pueden unirse a canales públicos.

:::caution[Los canales aún no tienen reglas de acceso]
La única comprobación que aplica el servidor es la **membresía**: para emitir en un canal, leer su lista de presencia o reproducir su historial, un cliente debe haberse unido a ese canal primero. Unirse en sí es abierto — cualquier cliente que conozca el nombre de un canal puede unirse a él, esté o no autenticado.

Por lo tanto, el nombre de un canal no es un secreto ni un permiso. No pongas nada en un canal (incluido el historial retenido y el estado de presencia) que no deba ser visto por todos los usuarios de tu aplicación, y no derives el nombre de un canal a partir de datos que no compartirías públicamente. Las reglas de autorización por canal no están implementadas; si las necesitas hoy, mantén la parte confidencial del intercambio en `client.data`, donde se aplica la seguridad a nivel de fila (RLS).
:::

> **Por defecto, las difusiones no se reproducen.** Solo llegan a los miembros conectados en ese momento. Eso es lo deseable para notificaciones que se autocorigen —un aviso de "alguien guardó" queda sustituido por el siguiente guardado— y no tiene coste. Para un flujo de operaciones, donde una brecha silenciosa causa divergencias, habilita el [historial de mensajes](#historial-de-mensajes-y-puesta-al-día-catch-up) en el canal.

## Historial de mensajes y puesta al día (Catch-Up)

Un canal se puede configurar para conservar sus difusiones, de modo que un cliente que se reconecte se ponga al día con lo que se perdió en lugar de resincronizar desde cero. Esto es lo que hace que los canales sean utilizables como transporte para la edición colaborativa.

La retención se configura **en el servidor**, por patrón de canal — consulta [Backend en tiempo real](/docs/backend/realtime#channel-retention). Un cliente no puede activarla por sí mismo, porque un canal es creado por cualquiera que lo nombre, y una profundidad de historial elegida por el cliente permitiría a cualquier visitante comprometer tu backend a un almacenamiento ilimitado.

En un canal con retención, pasa `{ history: true }` y el SDK hace el resto:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

En `join()` y después de cada reconexión, el SDK solicita al servidor todo lo posterior al último número de secuencia que vio, y entrega el resultado a través de los mismos manejadores. No hay una segunda ruta de código que escribir: un manejador que aplica una operación correctamente en vivo la aplica correctamente al ponerse al día.

### Números de secuencia

Cada difusión en un canal con retención incluye un `seq` — por canal, sin saltos y creciente. Es el punto de reanudación del cliente.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Persiste `channel.sequence` si deseas que la puesta al día sobreviva tanto a una recarga de página como a una reconexión, y pásalo de vuelta mediante `history({ sinceSeq })`.

### Obtener el historial explícitamente

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` significa que el canal no conserva ningún historial y nunca lo hará — una respuesta explícita, para que puedas distinguir entre "no te perdiste nada" y "este canal no tiene reglas de retención". En el segundo caso, un cliente que necesite converger debe recurrir a una resincronización completa.

`latestSeq` es la secuencia más alta que tiene el servidor, independientemente de si este lote la alcanzó o no. Si está muy por encima de tu último `seq` entregado, estás más retrasado que una sola página y resincronizar podría ser más económico que paginar.

:::note[Las reproducciones pueden superponerse, y no pasa nada]
El servidor no puede saber con exactitud qué mensajes te llegaron antes de que se cayera el socket, por lo que un rango de puesta al día puede incluir algunos que ya aplicaste. El SDK descarta cualquier cosa igual o inferior a la secuencia que ya ha entregado, por lo que los manejadores nunca ven un mensaje dos veces.

Tus propios mensajes se filtran de una reproducción, al igual que en vivo, incluidos los enviados antes de que una reconexión le diera al socket un nuevo id de cliente: el canal recuerda los ids desde los que transmitió. Un nuevo objeto de canal —después de recargar la página, por ejemplo— no recuerda ninguno, por lo que una puesta al día allí entrega tus mensajes anteriores como los de cualquier otra persona, que es lo que requiere reconstruir el estado a partir del historial.
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

El SDK mantiene la lista de participantes (roster) por ti, por lo que `presences` siempre está completo y nunca tienes que reconstruirlo a partir de diferencias (diffs).

También gestiona dos detalles del protocolo con los que es fácil equivocarse al trabajar directamente con el WebSocket nativo:

- **La lista de presencia no se envía al unirse.** El primer `presence_diff` de un cliente que se une solo se contiene a sí mismo; la lista existente debe solicitarse explícitamente. `join()` hace eso por ti.
- **La presencia expira después de 30 segundos.** `track()` no es un registro duradero — sin un reenvío periódico, desapareces silenciosamente de la lista de todos los demás mientras sigues conectado y en la página. El SDK envía un latido (heartbeat) cada 20 segundos y se detiene con `untrack()` / `leave()`.

Una reconexión también elimina la membresía del canal y la presencia del lado del servidor; el SDK se vuelve a unir, vuelve a solicitar la lista de presencia y vuelve a rastrear automáticamente.

## Cuándo usar tiempo real

| Caso de uso | Método |
|----------|--------|
| Panel de control con datos en vivo | `listen()` con filtros |
| Chat o mensajería | `channel.broadcast()` |
| Edición colaborativa / flujos de operaciones | `channel(name, { history: true })` |
| Indicadores de escritura / estado en línea | `channel.track()` + `channel.onPresence()` |
| Página de detalle con actualizaciones en vivo | `listenById()` |
| Monitorización en paneles de administración | `listen()` con `orderBy` y `limit` |
| Una lista que debe sobrevivir a una conexión caída | `observe()` con [offline](/docs/sdk/offline) habilitado |

> **Consejo:** Para consultas de datos puntuales, usa `find()` o `findById()` en su lugar. Las suscripciones son ideales para datos que cambian frecuentemente y necesitan reflejarse en la interfaz de usuario de inmediato.

## `listen()` frente a `observe()`

Ambos mantienen actualizada una consulta y ambos devuelven una función para cancelar la suscripción, pero responden a necesidades diferentes.

`listen()` es el socket: entrega lo que el servidor envía y no entrega nada cuando el socket está caído.

`observe()` es la consulta: con el modo [sin conexión](/docs/sdk/offline) habilitado, emite primero desde la base de datos local —antes de cualquier solicitud— y vuelve a emitir en escrituras locales, cuando las escrituras en cola llegan al servidor, en rollbacks y en eventos en tiempo real, a los cuales se suscribe automáticamente a menos que pases `{ realtime: false }`. Cada resultado indica si provino de la caché y si contiene escrituras que el servidor aún no ha aceptado.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Sin el modo sin conexión habilitado, `observe()` equivale a `find()` más `listen()` en una sola llamada, con esos indicadores siempre en `false`.

## Próximos pasos

- **[Consultar datos](/docs/sdk/querying)** — Operaciones CRUD y constructor de consultas
- **[Sincronización sin conexión y Local-First](/docs/sdk/offline)** — Consultas en vivo que sobreviven a una conexión caída
- **[Autenticación](/docs/sdk/authentication)** — Inicio de sesión y gestión de sesiones
- **[Backend en tiempo real](/docs/backend/realtime)** — Configuración de WebSocket del lado del servidor
