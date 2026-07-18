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
        where: { status: "pending" },
        orderBy: ["created_at", "desc"],
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

```typescript
listen(
    params: FindParams | undefined,
    onUpdate: (response: FindResponse<M>) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

### Metadatos en Dos Fases

Cuando `listen()` se dispara, emite actualizaciones en hasta dos fases:

1. **Inmediata (estimada):** El primer callback se dispara al instante con las entidades y metadatos de paginación heurísticos (`total` = número de entidades devueltas, `hasMore` = si el conteo es igual al límite solicitado). Esta emisión lleva `meta.estimated: true`.

2. **Autoritativa (opcional):** Una consulta de conteo asíncrona se ejecuta en segundo plano. Si el `total` o `hasMore` autoritativo difiere de la estimación, se dispara un segundo callback con metadatos corregidos y **sin** la marca `estimated`. Si los valores coinciden, la segunda emisión se omite por completo — su callback se dispara solo una vez.

Si la consulta de conteo **falla**, no se produce una segunda emisión. La marca `estimated: true` de la primera emisión permanece como señal de que los metadatos son heurísticos. Esto no se trata como un error de suscripción.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (response) => {
        if (response.meta.estimated) {
            // First-paint: render immediately, total/hasMore may change
            renderProducts(response.data, { loading: true });
        } else {
            // Authoritative: safe to render final pagination controls
            renderProducts(response.data, { loading: false });
        }
    }
);
```

> **Consejo:** Si no necesita distinguir entre metadatos estimados y autoritativos, puede ignorar la marca `estimated` — ambas emisiones llevan el mismo array `data`.

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
    onUpdate: (entity: Entity<M> | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

El callback recibe `undefined` cuando la entidad se elimina.

## Constructor de Consultas Fluido

También puede suscribirse a través del constructor de consultas fluido. Es equivalente a llamar a `listen()` con parámetros, pero permite encadenar `.where()`, `.orderBy()`, etc.:

```typescript
const unsubscribe = client.data.products
    .where("active", "==", true)
    .orderBy("created_at", "desc")
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
// Join a channel
const channel = client.realtime.channel("chat-room");

// Listen for messages
channel.on("message", (payload) => {
    console.log("New message:", payload);
});

// Send a message to all subscribers
channel.send("message", {
    text: "Hello, world!",
    userId: currentUser.id
});

// Leave the channel
channel.unsubscribe();
```

Los canales son ligeros y efímeros — existen mientras al menos un cliente esté suscrito.

## Seguimiento de Presencia

La presencia le permite rastrear qué usuarios están en línea y sincronizar el estado compartido entre todos los participantes:

```typescript
const channel = client.realtime.channel("editors");

// Track your presence
channel.presence.track({
    userId: currentUser.id,
    status: "editing",
    cursor: { x: 100, y: 200 }
});

// Listen for presence changes
channel.presence.on("sync", (state) => {
    console.log("Online users:", Object.keys(state));
});

channel.presence.on("join", (key, newPresence) => {
    console.log(`${key} came online:`, newPresence);
});

channel.presence.on("leave", (key) => {
    console.log(`${key} went offline`);
});

// Update your state
channel.presence.track({
    userId: currentUser.id,
    status: "idle"
});
```

La presencia se construye sobre los canales de difusión con diferenciación automática del estado — solo se transmiten los cambios.

## Cuándo Usar el Tiempo Real

| Caso de Uso | Método |
|----------|--------|
| Panel con datos en vivo | `listen()` con filtros |
| Chat o mensajería | `channel.send()` vía difusión |
| Indicadores de escritura / estado en línea | `channel.presence.track()` |
| Página de detalle con actualizaciones en vivo | `listenById()` |
| Monitorización del panel de administración | `listen()` con `orderBy` y `limit` |

> **Consejo:** Para obtener datos una sola vez, use `find()` o `findById()` en su lugar. Las suscripciones son mejores para datos que cambian con frecuencia y deben reflejarse en la UI de inmediato.

## Próximos Pasos

- **[Consultar Datos](/docs/sdk/querying)** — Operaciones CRUD y constructor de consultas
- **[Autenticación](/docs/sdk/authentication)** — Inicio de sesión y gestión de sesiones
- **[Backend en Tiempo Real](/docs/backend/realtime)** — Configuración de WebSocket del lado del servidor
