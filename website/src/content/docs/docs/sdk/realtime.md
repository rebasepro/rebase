---
title: Realtime Subscriptions
sidebar_label: Realtime
description: Subscribe to live data changes with the Rebase Client SDK using WebSocket-based realtime listeners.
---

## Overview

The Rebase Client SDK provides real-time data subscriptions via WebSocket. When records change on the server, your subscribed callbacks fire immediately with the updated data.

The WebSocket connection is established automatically when a `websocketUrl` is available (derived from `baseUrl` by default). Reconnection and token refresh are handled transparently.

## Subscribing to a Collection

Use `listen()` to subscribe to a collection query. The callback fires whenever the matching data set changes:

```typescript
const unsubscribe = client.data.products.listen(
    { where: { active: true }, limit: 50 },
    (response) => {
        console.log("Products updated:", response.data);
        console.log("Total:", response.meta.total);
    }
);

// Stop listening when done
unsubscribe();
```

The `listen()` method accepts the same `FindParams` as `find()` — you can filter, sort, and paginate your subscription:

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

### Signature

```typescript
listen(
    params: FindParams | undefined,
    onUpdate: (response: FindResponse<M>) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

### Two-Phase Meta

When `listen()` fires, it emits updates in up to two phases:

1. **Immediate (estimated):** The first callback fires instantly with the entities and heuristic pagination metadata (`total` = number of returned entities, `hasMore` = whether the count equals the requested limit). This emission carries `meta.estimated: true`.

2. **Authoritative (optional):** An async count query runs in the background. If the authoritative `total` or `hasMore` differs from the estimate, a second callback fires with corrected metadata and **no** `estimated` flag. If the values match, the second emission is skipped entirely — your callback fires only once.

If the count query **fails**, no second emission occurs. The first emission's `estimated: true` flag remains as the signal that the metadata is heuristic. This is not treated as a subscription error.

```typescript
client.data.products.listen(
    { where: { active: true }, limit: 50 },
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

> **Tip:** If you don't need to distinguish between estimated and authoritative metadata, you can ignore the `estimated` flag — both emissions carry the same `data` array.

## Subscribing to a Single Entity

Use `listenById()` to watch a specific record by its ID:

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

### Signature

```typescript
listenById(
    id: string | number,
    onUpdate: (entity: Entity<M> | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

The callback receives `undefined` when the entity is deleted.

## Fluent Query Builder

You can also subscribe through the fluent query builder. This is equivalent to calling `listen()` with params, but lets you chain `.where()`, `.orderBy()`, etc.:

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

## Unsubscribing

Every subscription returns an `unsubscribe` function. Call it to stop receiving updates and clean up the WebSocket listener:

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

In React, use `useEffect` cleanup:

```tsx
useEffect(() => {
    const unsubscribe = client.data.products.listen(
        { where: { active: true } },
        (response) => setProducts(response.data)
    );
    return () => unsubscribe();
}, []);
```

## Authentication and Reconnection

The WebSocket client handles authentication automatically:

- On **sign-in** or **token refresh**, the new token is sent to the WebSocket server via an `authenticate` message.
- On **sign-out**, the WebSocket connection is disconnected.
- If the connection drops, the client **reconnects automatically** and re-establishes all active subscriptions.

No manual token management is needed — the integration between `client.auth` and the WebSocket layer is handled internally.

## Broadcast Channels

Broadcast channels let you send arbitrary messages between connected clients — ideal for chat, notifications, or collaborative features:

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

Channels are lightweight and ephemeral — they exist as long as at least one client is subscribed.

## Presence Tracking

Presence lets you track which users are online and sync shared state across all participants:

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

Presence is built on top of broadcast channels with automatic state diffing — only changes are transmitted.

## When to Use Realtime

| Use Case | Method |
|----------|--------|
| Dashboard with live data | `listen()` with filters |
| Chat or messaging | `channel.send()` via broadcast |
| Typing indicators / online status | `channel.presence.track()` |
| Detail page with live updates | `listenById()` |
| Admin panel monitoring | `listen()` with `orderBy` and `limit` |

> **Tip:** For one-time data fetches, use `find()` or `findById()` instead. Subscriptions are best for data that changes frequently and needs to be reflected in the UI immediately.

## Next Steps

- **[Querying Data](/docs/sdk/querying)** — CRUD operations and query builder
- **[Authentication](/docs/sdk/authentication)** — Sign in and session management
- **[Realtime Backend](/docs/backend/realtime)** — Server-side WebSocket configuration
