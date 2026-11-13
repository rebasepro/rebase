---
sourceHash: eb117d132ea516de
title: Suscripciones en tiempo real
sidebar_label: Tiempo real
description: Suscríbase a los cambios de datos en vivo con el SDK tipado de Rebase mediante listeners en tiempo real basados en WebSocket.
---

## Descripción general

El SDK tipado de Rebase proporciona suscripciones a datos en tiempo real a través de WebSocket. Cuando los registros cambian en el servidor, las callbacks suscritas se ejecutan inmediatamente con los datos actualizados.

La conexión WebSocket se establece automáticamente cuando un `websocketUrl` está disponible (derivado de `baseUrl` por defecto). La reconexión y la actualización del token se gestionan por usted. Una interrupción que dure más de unos 15 segundos se reporta una vez, al `onError` de cada suscripción, como `CONNECTION_LOST` — consulte [Autenticación y reconexión](#autenticación-y-reconexión).

## Suscribirse a una tabla

Use `listen()` para suscribirse a una consulta de tabla. La callback se ejecuta cada vez que cambia el conjunto de datos coincidentes:

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

`FindResult<M>` tiene la misma forma que devuelve `find()`: filas planas en `data` y `{ total, limit, offset, hasMore, nextCursor }` en `meta`.

### `listen()` acepta lo que acepta `find()`

`params` es un `FindParams` completo. Una suscripción es la misma consulta que el `find()` que la acompaña, por lo que acepta la misma delimitación — `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** y **`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Esto es más importante de lo que parece. Anteriormente, `include` y `fields` se descartaban silenciosamente aquí, por lo que la misma consulta respondía con una forma a través de `find()` y con otra a través de `listen()`, y un componente que renderizaba ambas veía cambiar la forma de sus filas en el momento en que se producía una escritura. Ahora pasan por el idéntico pipeline de lectura, por lo que `find({ q })` y `listen({ q })` devuelven filas que son iguales campo por campo.

La excepción es `vectorSearch`, que es **rechazado** en lugar de descartado: una suscripción se vuelve a ejecutar en cada escritura coincidente y nada allí calcula distancias. Use `.vectorSearch(…).find()` para la consulta y suscríbase sin él.

### Una emisión por cambio

Cada push del servidor llama a su callback **una vez**, con metadatos que describen las filas que lo acompañan. No hay una emisión de primer renderizado (first-paint) separada ni un flag que verificar.

Los metadatos llegan **en el mismo frame que las filas**: el servidor cuenta la consulta dentro de la misma transacción vinculada a la seguridad a nivel de fila (row-level security) que las leyó, por lo que `meta.total`, `meta.hasMore` y `meta.nextCursor` describen exactamente las filas contiguas. (Anteriormente, cada push iba seguido de un `GET /count` desde el cliente — un round trip adicional por escritura, por suscriptor, y una ventana de tiempo en la que el recuento y las filas describían estados diferentes de la tabla).

Dos mecanismos de reserva (fallbacks), ninguno de los cuales es un error de suscripción y ninguno llama a `onError`:

- Si el **conteo del servidor falló**, el frame no lleva total y se reutiliza el último que llegó. Un conteo fallido no dice nada sobre el tamaño de la tabla, por lo que no debe sobrescribir una respuesta real.
- Si nunca ha llegado un total para esta suscripción — un servidor más antiguo que no envía metadatos en absoluto — el cliente pregunta una vez, en el primer push. Si eso también falla, `meta.total` es un **límite inferior**: las filas en esta página más las paginadas anteriormente para alcanzarlas.

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

Use `listenById()` para observar un registro específico por su ID:

```typescript
// The SDK hands back a flat row, not an `Entity` — there is no `.values`.
const unsubscribe = client.data
    .table<{ id: number; name: string }>("products")
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

La callback recibe una fila plana — no una `Entity`, por lo que no hay `.values` — y `undefined` cuando el registro es eliminado.

Cada frame contiene las relaciones nombradas en `options.include`, cargadas del mismo modo en que `find({ include })` las carga en cada fila de una lista. Una relación to-many no nombrada allí estará ausente de la fila, no vacía:

```typescript
client.data.posts.listenById(1, (post) => {
    console.log(post?.tags); // the post's tags, on every update
}, undefined, { include: ["tags"] });
```

**Límites.** Se envía un frame cuando la fila en sí cambia, y cada frame recarga sus relaciones incluidas. Un cambio únicamente en una fila relacionada no envía ningún frame: editar el nombre de una etiqueta no actualiza una publicación escuchada con `include: ["tags"]` hasta que la publicación también cambie. Para seguir las filas relacionadas, escuche también su tabla.

## Observar un recuento

`listenCount()` mantiene un recuento actualizado: el total de lo que coincide con el filtro de una lista, para una barra de herramientas o una opción de "seleccionar los N" que no debe desactualizarse mientras otras personas agregan y eliminan filas. La callback se ejecuta con el total una vez que se conoce, y nuevamente cada vez que una escritura lo modifique.

```typescript
const stop = client.data.orders.listenCount(
    { where: { status: ["==", "open"] } },
    (total) => console.log(`${total} open orders`),
    (error) => console.error(error)
);
```

Solo cuenta el filtro — `where`, `logical` y `searchString`; un `limit`, un `offset` o un ordenamiento se ignoran. El servidor no lee filas para esto, solo el recuento, bajo la identidad del suscriptor como cualquier otro frame. Un servidor anterior a la versión 0.25 no reconoce la solicitud; se responde con una fila y el mismo total, y el SDK lee el total de allí. En un cliente sin socket, `listenCount()` es un stub que arroja un error, al igual que `listen()`. Con el [soporte offline](/docs/sdk/offline/) activado, el recuento es el del servidor: las escrituras en cola no se incluyen en él hasta que se repliquen.

## Constructor de consultas fluido

También puede suscribirse a través del constructor fluido de consultas. Esto equivale a llamar a `listen()` con parámetros, pero le permite encadenar `.where()`, `.orderBy()`, etc.:

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

Una suscripción admite una ordenación multicolumna como cualquier otra consulta — ya sea `orderBy: [["category", "asc"], ["createdAt", "desc"]]` en los parámetros, o una segunda llamada a `.orderBy()`, la cual añade un criterio de desempate en lugar de reemplazar al primero. Consulte [Ordenación](/docs/sdk/querying#sorting).

El servidor verifica la *forma* del `orderBy` de una suscripción al recibirlo y rechaza uno mal formado con un frame de error en lugar de suscribirse. De lo contrario, una ordenación que no pudiera leer transmitiría filas sin ningún orden sin reportar ningún problema — y un frame `collection_update` transporta filas y nada más, por lo que un suscriptor no tendría forma de darse cuenta.

## Cancelar la suscripción

Cada suscripción devuelve una función `unsubscribe`. Llámela para dejar de recibir actualizaciones y limpiar el listener de WebSocket:

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

En React, use la función de limpieza de `useEffect`:

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

- Al **iniciar sesión** o **actualizar el token**, un socket ya abierto adopta la nueva credencial. Una actualización, o un inicio de sesión con la misma cuenta que ya posee, envía el token en un mensaje de `authenticate`; un inicio de sesión con una cuenta diferente — incluido un visitante que inicia sesión — reconstruye el socket, que se autentica como esa cuenta y vuelve a enviar cada suscripción y canal activos. Si no hay ninguno abierto, no ocurre nada — iniciar sesión no es una solicitud de tiempo real, y un socket abierto más tarde se autentica a sí mismo.
- Al **cerrar sesión**, la conexión WebSocket se desconecta. El cliente sigue siendo utilizable; una suscripción posterior se reconecta de forma anónima.
- Si la conexión se cae, el cliente **se reconecta automáticamente** y restablece todas las suscripciones activas. Nunca deja de intentarlo mientras exista una suscripción o un canal al que se haya unido; la demora entre intentos aumenta como máximo a 30 segundos.
- Si el servidor finaliza la sesión del socket — el usuario cerró sesión en todas partes, esta sesión fue revocada, la cuenta fue eliminada o el token expiró antes de que una actualización llegara al socket — cierra el socket con el código `4001`. El cliente se reconecta como después de cualquier caída, autenticándose con la sesión que posea en ese momento (actualizada si es posible) o de forma anónima cuando no haya ninguna. La revocación de un rol no cierra el socket: se aplica a partir del siguiente frame. Consulte [Autenticación y RLS](/docs/backend/realtime/#authentication--rls).
- Si la conexión permanece caída durante más de unos 15 segundos, se llama **una vez** al `onError` de cada suscripción (y al `onError` de cada canal al que se haya unido) con un `RebaseApiError` cuyo `code` es `CONNECTION_LOST`. La suscripción no se finaliza: continúe mostrando lo que tiene, márquelo como posiblemente desactualizado y espere. Cuando el socket regrese, el próximo `onUpdate` de la suscripción traerá todo lo escrito mientras tanto.
- `client.ws.state` es el estado de la conexión — `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` o `closed` — y a `client.ws.onStateChange(listener)` se le notifica cada cambio. `disconnected` es el estado en el que se ha reportado `CONNECTION_LOST`.
- Las solicitudes enviadas a través del socket son de tipo **a lo sumo una vez (at-most-once)**. Una solicitud que se envió cuando se cayó la conexión falla con `CONNECTION_LOST` y nunca se vuelve a enviar, ya que es posible que el servidor ya la haya ejecutado. Una que aún esté esperando un socket después de 30 segundos falla con `REQUEST_TIMEOUT` sin haber sido enviada.

Todo lo que figura en la lista después del cierre de sesión se incorporó en la versión 0.24.

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

El socket se autentica con el mismo token que llevaría una solicitud HTTP. Ese es el getter instalado con `client.setAuthTokenGetter()` en primer lugar; cuando no hay ninguno, o responde `null` o arroja un error, es el token que el cliente tiene: el de su sesión, uno establecido con `client.setToken()`, o la opción `token`. Con el `client.auth` integrado no hay nada que configurar.

Para un proveedor de autenticación externo (Clerk, Firebase Auth, una sesión propia), instale el getter una vez. Cubre tanto HTTP como el socket:

```typescript
client.setAuthTokenGetter(() => provider.getToken());

// Optional: let the provider recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await provider.refresh();
    return true; // retry with the token resolved again
});
```

- `client.setOnUnauthorized(handler)` responde a un token rechazado en ambos: un 401 sobre HTTP y un error de autenticación en el socket. Resuelva `true` para reintentar con el token resuelto nuevamente. Reemplaza la actualización de sesión propia del cliente.
- Instalar un getter, o llamar a `client.setToken()`, reconstruye un socket abierto: el nuevo se autentica con la nueva credencial y reenvía cada suscripción y canal activo bajo esta, y nada de lo que tenía la identidad anterior se transfiere. Sin ningún socket abierto, el siguiente se autenticará a sí mismo.
- `client.ws.setAuthTokenGetter()` está obsoleto (deprecated). Todavía funciona, reemplazando únicamente el getter del socket, y emite una advertencia una sola vez. Use `client.setAuthTokenGetter()`.

Consulte [Su propio proveedor de autenticación](/docs/sdk/your-own-auth-provider/).

### La conexión es diferida (lazy)

Crear un cliente **no** abre un WebSocket. Se establece la conexión en la primera operación que realmente la necesita — una suscripción `listen()` / `listenById()`, o una operación de canal como `join()`, `track()` o `broadcast()`. Obtener un canal no significa usarlo.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Esto es importante para aplicaciones con un tráfico significativo de usuarios no autenticados — páginas de marketing, vistas públicas de solo lectura, herramientas anónimas por defecto — que anteriormente asumían el coste de una conexión en cada carga de página simplemente para tener el tiempo real disponible.

Dos comportamientos relacionados:

- `realtime: false` sigue siendo una exclusión total: nunca habrá un socket, y `client.realtime.channel()` arroja un error. Lo mismo ocurre con `listen()` y `listenById()` — siempre están disponibles para ser llamados, y en un cliente sin socket arrojan un `RebaseClientError` indicando la opción que los habilitaría. `observe()` no lo hace: se degrada a un solo fetch.
- `client.close()` es definitivo. Libera el socket y su temporizador de reconexión, y nada de lo que se ponga en cola posteriormente volverá a conectarse. En Node, un socket abierto mantiene activo el bucle de eventos (event loop), por lo que un script que nunca lo llame no terminará por sí solo.

### Mantener un grupo en una sola instancia

Con más de una instancia de servidor, los miembros de un canal pueden terminar en diferentes instancias, y cada mensaje entre ellos luego [cruza el bus de canales](/docs/backend/realtime-transports/#channels-and-presence-across-instances). `affinity` nombra el grupo al que pertenece un socket, como una sala o un documento, de modo que una plataforma pueda enviar a todo el grupo a la misma instancia:

```typescript
const client = createRebaseClient({
    baseUrl,
    realtime: { affinity: roomCode }
});
```

Cuando la clave solo se conoce más tarde, establézcala antes de que se abra el socket:

```typescript
const client = createRebaseClient({ baseUrl });

client.realtime.setAffinity(roomCode);          // no socket yet
await client.realtime.channel(roomCode).join(); // opens with the key
```

La clave se añade a la dirección del socket como `?affinity=`, y reemplaza a la que ya esté presente en una `websocketUrl` que haya configurado. `setAffinity(null)` la elimina.

- **Es una optimización.** Rebase Cloud enruta en función de ella cuando un proyecto ejecuta más de una instancia. En implementaciones autohospedadas (self-hosted), o detrás de un proxy que no realice hashing sobre ella, no hace nada y los canales funcionan igual: el bus continúa transportando lo que abarque diferentes instancias, incluido un grupo dividido por un escalado horizontal.
- **Surte efecto cuando el socket se conecta.** Un socket ya abierto permanece donde está y utiliza la nueva clave la próxima vez que se conecte. Para mover un cliente que ya está conectado, cree uno nuevo o configure la clave antes de su primer `join()` o `listen()`.
- **Decide dónde aterriza un socket, no a qué puede unirse.** El acceso a un canal no depende de ello, y la dirección termina en los registros de acceso (access logs), por lo que debe utilizar un código en lugar de un secreto o cualquier dato personal.

Para comprobar si funciona, compare lo que publica y omite cada instancia: consulte [Ver qué hace el bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Canales de difusión (Broadcast Channels)

Los canales de difusión (broadcast) le permiten enviar mensajes arbitrarios entre clientes conectados — ideales para chat, notificaciones o funciones colaborativas:

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

Los canales son ligeros y efímeros — existen mientras al menos un cliente esté suscrito. Las llamadas repetidas a `channel()` con el mismo nombre devuelven el **mismo** objeto, por lo que dos componentes pueden adjuntar controladores (handlers) de forma independiente sin que ninguno interrumpa al otro al salir.

Los frames de canal y de presencia no requieren una cuenta: los visitantes anónimos pueden unirse a canales públicos.

:::caution[Los canales aún no tienen reglas de acceso]
La única comprobación que aplica el servidor es la **membresía**: para emitir en un canal, leer su lista de presencia o reproducir su historial, un cliente debe haberse unido a ese canal primero. Unirse en sí está abierto a cualquiera — cualquier cliente que pueda nombrar un canal puede unirse a él, esté o no autenticado.

Por lo tanto, el nombre de un canal no es un secreto ni un permiso. No incluya nada en un canal (incluidos el historial retenido y el estado de presencia) que no deba ser visible para todos los usuarios de su aplicación, y no derive un nombre de canal a partir de datos que no compartiría públicamente. Las reglas de autorización por canal no están implementadas; si las necesita actualmente, mantenga la parte sensible del intercambio en `client.data`, donde se aplica la seguridad a nivel de fila (RLS).
:::

> **Por defecto, las emisiones no se retransmiten.** Solo llegan a los miembros conectados en ese momento. Esto es lo adecuado para notificaciones que se autocorigen — un aviso de "alguien guardó" queda reemplazado por el siguiente guardado — y no tiene ningún costo. Para un flujo de operaciones (operation stream), donde una interrupción silenciosa causa divergencia, habilite el [historial de mensajes](#historial-de-mensajes-y-puesta-al-día-catch-up) en el canal.

## Historial de mensajes y puesta al día (Catch-Up)

Un canal se puede configurar para conservar sus emisiones, de modo que un cliente que se reconecte se ponga al día con lo que se perdió en lugar de volver a sincronizarse desde cero. Esto es lo que permite usar canales como transporte para la edición colaborativa.

La retención se configura **en el servidor**, por patrón de canal — consulte [Backend en tiempo real](/docs/backend/realtime#channel-retention). Un cliente no puede activarla por sí mismo, ya que un canal es creado por cualquiera que lo nombre, y una profundidad de historial elegida por el cliente permitiría a cualquier visitante comprometer su backend a un almacenamiento ilimitado.

En un canal con retención, pase `{ history: true }` y el SDK se encargará del resto:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

En `join()` y después de cada reconexión, el SDK solicita al servidor todo lo posterior al último número de secuencia que vio y entrega el resultado a través de los mismos controladores. No hay que escribir un segundo flujo de código: un controlador que aplica una operación correctamente en vivo la aplica correctamente al ponerse al día.

### Números de secuencia

Cada emisión en un canal con retención lleva un `seq` — por canal, continuo y creciente. Es el punto de reanudación del cliente.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Persista `channel.sequence` si desea que la puesta al día sobreviva tanto a una recarga de página como a una reconexión, y páselo de vuelta mediante `history({ sinceSeq })`.

### Obtener el historial de forma explícita

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` significa que el canal no conserva historial y nunca lo hará — una respuesta explícita, para que pueda distinguir entre "no se perdió nada" y "este canal no tiene regla de retención". En el segundo caso, un cliente que necesite converger tendrá que recurrir a una resincronización completa.

`latestSeq` es la secuencia más alta que conserva el servidor, independientemente de si este lote la alcanzó o no. Si está muy por encima de su último `seq` entregado, está más atrasado que una sola página y resincronizar puede ser más eficiente que paginar.

:::note[Las retransmisiones pueden superponerse, y no pasa nada]
El servidor no puede saber con exactitud qué mensajes le llegaron antes de que se cayera el socket, por lo que un rango de puesta al día puede incluir algunos que ya haya aplicado. El SDK descarta cualquier elemento igual o inferior a la secuencia que ya ha entregado, de modo que los controladores nunca vean un mensaje dos veces.

Sus propios mensajes se filtran de una retransmisión, al igual que en vivo, incluidos los enviados antes de que una reconexión le diera al socket un nuevo id de cliente: el canal recuerda los ids desde los que emitió. Un nuevo objeto de canal — después de recargar la página, por ejemplo — no recuerda ninguno, por lo que una puesta al día allí entrega sus mensajes anteriores como los de cualquier otra persona, que es lo que requiere reconstruir el estado a partir del historial.
:::

## Seguimiento de presencia (Presence Tracking)

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

El SDK mantiene la lista de participantes (roster) por usted, por lo que `presences` siempre está completo y nunca tendrá que reconstruirlo a partir de diferencias (diffs).

También gestiona dos detalles del protocolo en los que es fácil equivocarse al trabajar directamente con el WebSocket:

- **La lista de participantes no se envía automáticamente al unirse.** El primer `presence_diff` de un cliente que se une solo se contiene a sí mismo; la lista de participantes existente debe solicitarse explícitamente. `join()` hace esto por usted.
- **La presencia expira después de 30 segundos.** `track()` no es un registro duradero — sin un reenvío periódico, usted desaparece silenciosamente de la lista de todos los demás mientras sigue conectado y en la página. El SDK envía latidos (heartbeats) cada 20 s y se detiene al ejecutar `untrack()` / `leave()`.

Una reconexión también elimina la membresía del canal y la presencia en el lado del servidor; el SDK vuelve a unirse, vuelve a solicitar la lista y reactiva el seguimiento de presencia automáticamente.

## Cuándo usar tiempo real

| Caso de uso | Método |
|-------------|--------|
| Panel de control con datos en vivo | `listen()` con filtros |
| Chat o mensajería | `channel.broadcast()` |
| Edición colaborativa / flujos de operaciones | `channel(name, { history: true })` |
| Indicadores de escritura / estado en línea | `channel.track()` + `channel.onPresence()` |
| Página de detalles con actualizaciones en vivo | `listenById()` |
| Monitoreo de panel de administración | `listen()` con `orderBy` y `limit` |
| Una lista que debe sobrevivir a una conexión interrumpida | `observe()` con [offline](/docs/sdk/offline) habilitado |

> **Consejo:** Para recuperaciones de datos puntuales, use `find()` o `findById()`. Las suscripciones son ideales para datos que cambian con frecuencia y deben reflejarse en la interfaz de usuario de inmediato.

## `listen()` frente a `observe()`

Ambos mantienen una consulta actualizada y ambos devuelven una función para cancelar la suscripción — pero responden a preguntas diferentes.

`listen()` es el socket: entrega lo que el servidor envía (push) y no entrega nada cuando el socket está caído.

`observe()` es la consulta: con el modo [offline](/docs/sdk/offline) habilitado, emite primero desde la base de datos local — antes de cualquier solicitud — y vuelve a emitir ante escrituras locales, cuando las escrituras en cola llegan al servidor, en rollbacks y ante eventos en tiempo real, a los cuales se suscribe automáticamente a menos que pase `{ realtime: false }`. Cada resultado indica si provino de la caché y si contiene escrituras que el servidor aún no ha aceptado.

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

## Pasos siguientes

- **[Consultar datos](/docs/sdk/querying)** — Operaciones CRUD y constructor de consultas
- **[Sincronización offline y local-first](/docs/sdk/offline)** — Consultas en vivo que sobreviven a una conexión interrumpida
- **[Autenticación](/docs/sdk/authentication)** — Inicio de sesión y gestión de sesiones
- **[Backend en tiempo real](/docs/backend/realtime)** — Configuración de WebSocket en el servidor
