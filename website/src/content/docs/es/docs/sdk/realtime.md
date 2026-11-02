---
sourceHash: 901c6998adce627e
title: Suscripciones en tiempo real
sidebar_label: Tiempo real
description: Suscríbase a los cambios de datos en vivo con el SDK tipado de Rebase usando listeners en tiempo real basados en WebSocket.
---

## Descripción general

El SDK tipado de Rebase proporciona suscripciones a datos en tiempo real mediante WebSocket. Cuando los registros cambian en el servidor, las callbacks suscritas se ejecutan inmediatamente con los datos actualizados.

La conexión WebSocket se establece automáticamente cuando hay un `websocketUrl` disponible (derivado de `baseUrl` por defecto). La reconexión y la actualización de tokens se gestionan de forma automática. Una interrupción que dure más de unos 15 segundos se reporta una vez, al `onError` de cada suscripción, como `CONNECTION_LOST` — consulte [Autenticación y reconexión](#autenticación-y-reconexión).

## Suscribirse a una colección

Use `listen()` para suscribirse a una consulta de colección. La callback se ejecuta cada vez que cambia el conjunto de datos coincidente:

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

`FindResult<M>` tiene la misma forma que devuelve `find()`: filas planas en `data`, y `{ total, limit, offset, hasMore, nextCursor }` en `meta`.

### `listen()` acepta lo mismo que `find()`

`params` es un `FindParams` completo. Una suscripción es la misma consulta que el `find()` equivalente, por lo que acepta los mismos filtros y delimitaciones — `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** y **`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Esto importa más de lo que parece. Anteriormente, `include` y `fields` se descartaban silenciosamente aquí, por lo que la misma consulta respondía con una forma a través de `find()` y con otra a través de `listen()` — y un componente que renderizaba ambas veía cómo sus filas cambiaban de forma en el momento en que se producía una escritura. Ahora pasan por una canalización de lectura idéntica, por lo que `find({ q })` y `listen({ q })` devuelven filas que son iguales campo por campo.

La excepción es `vectorSearch`, que es **rechazado** en lugar de descartado: una suscripción se vuelve a ejecutar en cada escritura coincidente y nada allí calcula distancias. Utilice `.vectorSearch(…).find()` para la consulta y suscríbase sin él.

### Una emisión por cambio

Cada push del servidor llama a su callback **una vez**, con metadatos que describen las filas que lo acompañan. No hay una emisión separada de renderizado inicial (first-paint) ni ningún flag que comprobar.

Los metadatos llegan **en el mismo frame que las filas**: el servidor cuenta la consulta dentro de la misma transacción vinculada a la seguridad a nivel de fila (row-level security) que las leyó, de modo que `meta.total`, `meta.hasMore` y `meta.nextCursor` describen exactamente las filas junto a ellos. (Antes, cada push iba seguido de un `GET /count` desde el cliente — un round trip adicional por escritura, por suscriptor, y una ventana de tiempo en la que el recuento y las filas describían diferentes estados de la colección).

Dos mecanismos de respaldo (fallbacks), ninguno de los cuales es un error de suscripción ni llama a `onError`:

- Si el **recuento del servidor falló**, el frame no contiene ningún total y se reutiliza el último que haya llegado. Un recuento fallido no dice nada sobre el tamaño de la colección, por lo que no debe sobrescribir una respuesta real.
- Si nunca ha llegado ningún total para esta suscripción —un servidor más antiguo que no envía ningún metadato—, el cliente pregunta una vez, en el primer push. Si eso también falla, `meta.total` es un **límite inferior**: las filas de esta página más las que se paginaron previamente para llegar a ellas.

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

Use `listenById()` para observar un registro específico por su ID:

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

La callback recibe una fila plana —no una `Entity`, por lo que no hay `.values`— y `undefined` cuando el registro se elimina.

Cada frame incluye las relaciones nombradas en `options.include`, cargadas del mismo modo que `find({ include })` las carga en cada fila de una lista. Una relación to-many no nombrada allí estará ausente de la fila, no vacía:

```typescript
client.data.posts.listenById(1, (post) => {
    console.log(post?.tags); // the post's tags, on every update
}, undefined, { include: ["tags"] });
```

**Límites.** Se envía un frame cuando la fila en sí cambia, y cada frame recarga sus relaciones incluidas. Un cambio únicamente en una fila relacionada no envía ningún frame: editar el nombre de una etiqueta no actualiza un post escuchado con `include: ["tags"]` hasta que el post también cambie. Para seguir las filas relacionadas, escuche también su colección.

## Observar un recuento

`listenCount()` mantiene un recuento actualizado: el total de lo que coincide con el filtro de una lista, ideal para una barra de herramientas o una opción de "seleccionar los N" que no debe quedar desactualizada mientras otras personas añaden o eliminan filas. La callback se ejecuta con el total una vez que se conoce, y nuevamente cada vez que una escritura lo modifique.

```typescript
const stop = client.data.orders.listenCount(
    { where: { status: ["==", "open"] } },
    (total) => console.log(`${total} open orders`),
    (error) => console.error(error)
);
```

Solo cuenta el filtro — `where`, `logical` y `searchString`; se ignora un `limit`, un `offset` o un ordenamiento. El servidor no lee ninguna fila para esto, solo el recuento, bajo la identidad del suscriptor como cualquier otro frame. Un servidor anterior a la versión 0.25 no reconoce la solicitud; esta se responde con una fila y el mismo total, y el SDK lee el total a partir de ahí. En un cliente sin socket, `listenCount()` es un stub que lanza una excepción, al igual que `listen()`. Con el [soporte offline](/docs/sdk/offline/) activado, el recuento es el del servidor: las escrituras en cola no se reflejan en él hasta que se replican.

## Constructor de consultas fluido

También puede suscribirse mediante el constructor de consultas fluido. Esto es equivalente a llamar a `listen()` con parámetros, pero le permite encadenar `.where()`, `.orderBy()`, etc.:

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

Una suscripción admite una ordenación multicolumna como cualquier otra consulta — ya sea mediante `orderBy: [["category", "asc"], ["createdAt", "desc"]]` en los parámetros, o una segunda llamada a `.orderBy()`, que añade un criterio de desempate en lugar de reemplazar el primero. Consulte [Ordenamiento](/docs/sdk/querying#sorting).

El servidor comprueba la *forma* del `orderBy` de una suscripción al recibirlo y rechaza uno mal formado con un frame de error en lugar de suscribirse. De lo contrario, un ordenamiento que no pudiera interpretar transmitiría filas sin ningún orden mientras reporta que no hay ningún problema — y un frame `collection_update` transporta filas y nada más, por lo que un suscriptor no tendría forma de darse cuenta.

## Cancelar suscripción

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

## Autenticación y reconexión

El cliente WebSocket gestiona la autenticación automáticamente:

- Al **iniciar sesión** o **actualizar el token**, un socket ya abierto adopta la nueva credencial. Una actualización, o un inicio de sesión con la misma cuenta que ya posee, envía el token en un mensaje de `authenticate`; un inicio de sesión con una cuenta diferente —incluido un visitante que inicia sesión— reconstruye el socket, el cual se autentica como esa cuenta y vuelve a enviar cada suscripción y canal activo. Si no hay ninguno abierto, no ocurre nada: iniciar sesión no es una solicitud de tiempo real, y un socket abierto más tarde se autentica a sí mismo.
- Al **cerrar sesión**, la conexión WebSocket se desconecta. El cliente sigue siendo utilizable; una suscripción posterior se reconecta de forma anónima.
- Si la conexión se cae, el cliente **se reconecta automáticamente** y restablece todas las suscripciones activas. Nunca deja de intentarlo mientras exista una suscripción o un canal al que se haya unido; la demora entre intentos aumenta hasta un máximo de 30 segundos.
- Si el servidor finaliza la sesión del socket —el usuario cerró sesión en todas partes, esta sesión fue revocada, la cuenta fue eliminada o el token expiró antes de que la actualización llegara al socket—, este cierra el socket con el código `4001`. El cliente se reconecta como después de cualquier caída, autenticándose con la sesión que tenga en ese momento (actualizada si es posible) o de forma anónima cuando no haya ninguna. La revocación de un rol no cierra el socket: se aplica a partir del siguiente frame. Consulte [Autenticación y RLS](/docs/backend/realtime/#authentication--rls).
- Si la conexión permanece caída durante más de unos 15 segundos, se llama **una vez** al `onError` de cada suscripción (y al `onError` de cada canal al que se haya unido) con un `RebaseApiError` cuyo `code` es `CONNECTION_LOST`. La suscripción no termina: mantenga la visualización de lo que tiene, márquelo como posiblemente desactualizado y espere. Cuando el socket vuelva a estar activo, el siguiente `onUpdate` de la suscripción traerá todo lo escrito mientras tanto.
- `client.ws.state` es el estado de la conexión — `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` o `closed` — y a `client.ws.onStateChange(listener)` se le notifica cada cambio. `disconnected` es el estado en el que se ha reportado `CONNECTION_LOST`.
- Las solicitudes enviadas a través del socket son de tipo **como máximo una vez (at-most-once)**. Una que se haya enviado cuando se cayó la conexión falla con `CONNECTION_LOST` y nunca se vuelve a enviar, ya que el servidor podría haberla ejecutado. Una que aún esté esperando un socket después de 30 segundos falla con `REQUEST_TIMEOUT` sin haber sido enviada.

Todo lo que aparece en la lista después del cierre de sesión llegó en la versión 0.24. En la 0.23, el cliente desiste tras cinco intentos fallidos de reconexión, encola las solicitudes realizadas mientras estaba desconectado y las envía al reconectarse, carece de `client.ws.state`, y el servidor nunca cierra un socket cuya sesión haya finalizado.

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

En la versión 0.24, el socket utiliza únicamente la propia sesión del cliente y la opción `token`: un getter configurado con `client.setAuthTokenGetter()` nunca llega a él, por lo que un host que utilice su propio proveedor de autenticación obtiene un socket anónimo.

El socket se autentica con el mismo token que llevaría una solicitud HTTP. Ese es, en primer lugar, el getter configurado con `client.setAuthTokenGetter()`; cuando no hay ninguno, o devuelve `null` o lanza una excepción, es el token que almacena el cliente: el de su sesión, uno establecido con `client.setToken()` o la opción `token`. Con el `client.auth` integrado no hay nada que conectar manualmente.

Para un proveedor de autenticación externo (Clerk, Firebase Auth, una sesión propia), configure el getter una vez. Cubre tanto HTTP como el socket:

```typescript
client.setAuthTokenGetter(() => provider.getToken());

// Optional: let the provider recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await provider.refresh();
    return true; // retry with the token resolved again
});
```

- `client.setOnUnauthorized(handler)` responde a un token rechazado en ambos: un 401 a través de HTTP y un error de autenticación en el socket. Resuelva `true` para reintentar con el token obtenido de nuevo. Reemplaza la actualización de sesión interna del cliente.
- Configurar un getter, o llamar a `client.setToken()`, reconstruye un socket abierto: el nuevo se autentica con la nueva credencial y vuelve a enviar cada suscripción y canal activo con ella, sin conservar nada de lo que tenía la identidad anterior. Si no hay ningún socket abierto, el siguiente se autenticará automáticamente.
- `client.ws.setAuthTokenGetter()` está obsoleto (deprecated). Todavía funciona, reemplazando únicamente el getter del socket, y muestra una advertencia una sola vez. Utilice `client.setAuthTokenGetter()`.

Consulte [Su propio proveedor de autenticación](/docs/sdk/your-own-auth-provider/).

### La conexión es bajo demanda (lazy)

Crear un cliente **no** abre un WebSocket. Se establece la conexión en la primera operación que realmente la necesite — una suscripción con `listen()` / `listenById()`, o una operación de canal como `join()`, `track()` o `broadcast()`. Obtener un canal no implica usarlo.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Esto es importante para aplicaciones con tráfico significativo sin iniciar sesión —páginas de marketing, vistas públicas de solo lectura, herramientas diseñadas principalmente para uso anónimo—, que anteriormente pagaban el coste de una conexión en cada carga de página simplemente para tener el tiempo real disponible.

Dos comportamientos relacionados:

- `realtime: false` sigue siendo una exclusión explícita y estricta: nunca se abre un socket y `client.realtime.channel()` lanza un error. Lo mismo ocurre con `listen()` y `listenById()` —siempre están disponibles para ser llamados, y en un cliente sin socket lanzan un `RebaseClientError` indicando la opción que los habilitaría. `observe()` no hace esto: se degrada a una única solicitud fetch.
- `client.close()` es definitivo. Libera el socket y su temporizador de reconexión, y nada encolado posteriormente volverá a intentar la conexión. En Node, un socket abierto mantiene activo el bucle de eventos (event loop), por lo que un script que nunca lo llame no finalizará por sí solo.

### Mantener un grupo en una sola instancia

Con más de una instancia de servidor, los miembros de un canal pueden terminar en diferentes instancias, y cada mensaje entre ellos entonces [atraviesa el bus de canales](/docs/backend/realtime-transports/#channels-and-presence-across-instances). `affinity` nombra el grupo al que pertenece un socket, como una sala o un documento, de modo que una plataforma pueda enviar a todo el grupo a la misma instancia:

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

La clave se añade a la dirección del socket como `?affinity=`, y reemplaza la que ya pudiera existir en un `websocketUrl` configurado. `setAffinity(null)` la elimina.

- **Es una optimización.** Rebase Cloud enruta en función de ella cuando un proyecto ejecuta más de una instancia. En autoalojamiento (self-hosted), o detrás de un proxy que no realice hashing sobre ella, no hace nada y los canales funcionan igual: el bus sigue transportando todo lo que abarque diferentes instancias, incluido un grupo dividido debido a un escalado.
- **Surte efecto cuando el socket se conecta.** Un socket que ya está abierto permanece donde está y utiliza la nueva clave la próxima vez que se conecte. Para mover un cliente que ya está conectado, cree uno nuevo o configure la clave antes de su primer `join()` o `listen()`.
- **Decide a dónde va a parar un socket, no a qué puede unirse.** El acceso a un canal no depende de esto, y la dirección termina en los registros de acceso (access logs), así que utilice un código en lugar de un secreto o cualquier dato personal.

Para comprobar si está funcionando, compare lo que cada instancia publica y omite: consulte [Ver qué hace el bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Canales de difusión

Los canales de difusión (broadcast channels) le permiten enviar mensajes arbitrarios entre clientes conectados — ideal para chat, notificaciones o funcionalidades colaborativas:

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

Los canales son ligeros y efímeros — existen mientras al menos un cliente esté suscrito. Las llamadas repetidas a `channel()` con el mismo nombre devuelven el **mismo** objeto, de modo que dos componentes pueden asociar manejadores de forma independiente sin que uno desconecte al otro al salir.

Los frames de canales y de presencia no requieren una cuenta: los visitantes anónimos pueden unirse a canales públicos.

:::caution[Los canales aún no tienen reglas de acceso]
La única comprobación que aplica el servidor es la **membresía**: para emitir en un canal, leer su lista de presencia o reproducir su historial, un cliente debe haberse unido a ese canal primero. El hecho de unirse es abierto: cualquier cliente que conozca el nombre de un canal puede unirse a él, tanto si ha iniciado sesión como si no.

Por lo tanto, el nombre de un canal no es un secreto ni un permiso. No incluya nada en un canal (incluidos el historial retenido y el estado de presencia) que no puedan ver todos los usuarios de su aplicación, y no derive el nombre de un canal a partir de datos que no compartiría públicamente. Las reglas de autorización por canal no están implementadas; si las necesita actualmente, mantenga la parte sensible del intercambio en `client.data`, donde se aplica la seguridad a nivel de fila.
:::

> **Por defecto, las difusiones no se retransmiten.** Llegan únicamente a los miembros conectados en ese momento. Esto es lo que se desea para notificaciones que se autocorringen —un aviso de "alguien guardó" queda sustituido por el siguiente guardado— y no tiene coste adicional. Para un flujo de operaciones, donde una pérdida de información silenciosa causa divergencias, habilite el [historial de mensajes](#historial-de-mensajes-y-puesta-al-día) en el canal.

## Historial de mensajes y puesta al día

Se puede configurar un canal para que conserve sus difusiones, de modo que un cliente que se reconecte se ponga al día con lo que se perdió en lugar de volver a sincronizar desde cero. Esto es lo que hace que los canales sean utilizables como mecanismo de transporte para la edición colaborativa.

La retención se configura **en el servidor**, por patrón de canal — consulte [Backend en tiempo real](/docs/backend/realtime#channel-retention). Un cliente no puede activarla por sí mismo, porque un canal es creado por cualquiera que le dé nombre, y una profundidad de historial elegida por el cliente permitiría a cualquier visitante comprometer el almacenamiento de su backend de forma ilimitada.

En un canal con retención, pase `{ history: true }` y el SDK se encargará del resto:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

En `join()` y después de cada reconexión, el SDK solicita al servidor todo lo posterior al último número de secuencia que vio y entrega el resultado a través de los mismos manejadores. No hay que escribir una segunda ruta de código: un manejador que aplique una operación correctamente en directo la aplica correctamente durante la puesta al día.

### Números de secuencia

Cada difusión en un canal con retención incluye un `seq` — propio de cada canal, sin huecos y creciente. Es el punto de reanudación del cliente.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Persista `channel.sequence` si desea que la puesta al día sobreviva a una recarga de página además de a una reconexión, y páselo de nuevo a través de `history({ sinceSeq })`.

### Obtener el historial explícitamente

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` significa que el canal no conserva ningún historial y nunca lo hará — una respuesta explícita, para que pueda distinguir entre "no te has perdido nada" y "este canal no tiene ninguna regla de retención". En el segundo caso, un cliente que necesite converger debe recurrir a una resincronización completa.

`latestSeq` es la secuencia más alta que tiene el servidor, independientemente de si este lote la alcanzó o no. Si está muy por encima de su último `seq` entregado, está más retrasado que una sola página y volver a sincronizar podría ser más económico que paginar.

:::note[Las retransmisiones pueden solaparse, y eso está bien]
El servidor no puede saber con exactitud qué mensajes le llegaron antes de que se cayera el socket, por lo que un intervalo de puesta al día puede incluir algunos que ya aplicó. El SDK descarta cualquier elemento que esté en o por debajo de la secuencia que ya haya entregado, por lo que los manejadores nunca ven un mensaje dos veces.

Sus propios mensajes se filtran de la retransmisión, al igual que en directo, incluidos los enviados antes de que una reconexión le diera al socket un nuevo ID de cliente: el canal recuerda los ID desde los que emitió. Un nuevo objeto de canal —después de recargar la página, por ejemplo— no recuerda ninguno, por lo que una puesta al día en ese caso entregará sus mensajes anteriores como los de cualquier otra persona, que es precisamente lo que necesita la reconstrucción del estado a partir del historial.
:::

## Seguimiento de presencia

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

El SDK mantiene la lista de participantes (roster) por usted, de modo que `presences` siempre está completo y nunca tiene que reconstruirlo a partir de diffs.

También gestiona dos detalles del protocolo en los que es fácil equivocarse cuando se trabaja directamente con el WebSocket sin procesar:

- **La lista de participantes no se envía mediante push al unirse.** El primer `presence_diff` de un cliente que se une contiene únicamente a sí mismo; la lista de participantes existente debe solicitarse de forma explícita. `join()` hace eso por usted.
- **La presencia expira después de 30 segundos.** `track()` no es un registro duradero: sin un reenvío periódico, usted desaparecerá silenciosamente de la lista de participantes de todos los demás mientras sigue conectado y en la página. El SDK envía latidos (heartbeats) cada 20 s y se detiene al llamar a `untrack()` / `leave()`.

Una reconexión también elimina la membresía del canal y la presencia en el servidor; el SDK vuelve a unirse, vuelve a solicitar la lista de participantes y vuelve a registrar la presencia automáticamente.

## Cuándo usar tiempo real

| Caso de uso | Método |
|---|---|
| Panel de control (Dashboard) con datos en vivo | `listen()` con filtros |
| Chat o mensajería | `channel.broadcast()` |
| Edición colaborativa / flujos de operaciones | `channel(name, { history: true })` |
| Indicadores de escritura / estado en línea | `channel.track()` + `channel.onPresence()` |
| Página de detalle con actualizaciones en vivo | `listenById()` |
| Monitorización en panel de administración | `listen()` con `orderBy` y `limit` |
| Una lista que debe sobrevivir a una conexión caída | `observe()` con [soporte offline](/docs/sdk/offline) habilitado |

> **Consejo:** Para obtener datos una sola vez, use `find()` o `findById()` en su lugar. Las suscripciones son ideales para datos que cambian con frecuencia y deben reflejarse en la interfaz de usuario de inmediato.

## `listen()` vs `observe()`

Ambos mantienen una consulta actualizada y ambos devuelven una función de cancelación de suscripción (unsubscribe), pero responden a necesidades diferentes.

`listen()` es el socket: entrega lo que el servidor envía mediante push y no entrega nada cuando el socket está caído.

`observe()` es la consulta: con el modo [offline](/docs/sdk/offline) habilitado, emite primero desde la base de datos local —antes de cualquier solicitud— y vuelve a emitir ante escrituras locales, cuando las escrituras en cola llegan al servidor, ante reversiones (rollbacks) y en eventos en tiempo real, a los cuales se suscribe automáticamente a menos que pase `{ realtime: false }`. Cada resultado indica si provino de la caché y si contiene escrituras que el servidor aún no ha aceptado.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Sin el soporte offline habilitado, `observe()` es `find()` más `listen()` en una sola llamada, con esos flags siempre en `false`.

## Próximos pasos

- **[Consultar datos](/docs/sdk/querying)** — Operaciones CRUD y constructor de consultas
- **[Sincronización offline y local-first](/docs/sdk/offline)** — Consultas en vivo que sobreviven a una conexión caída
- **[Autenticación](/docs/sdk/authentication)** — Inicio de sesión y gestión de sesiones
- **[Backend en tiempo real](/docs/backend/realtime)** — Configuración de WebSocket en el servidor
