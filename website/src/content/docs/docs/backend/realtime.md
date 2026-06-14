---
title: Realtime & WebSocket
sidebar_label: Realtime
description: Real-time data synchronization, broadcast channels, and presence tracking via WebSocket.
---

Rebase includes a built-in realtime engine that pushes data changes to connected clients over WebSocket.
When any record is created, updated, or deleted, every subscriber watching that collection or entity receives the update instantly — no polling required.

## How It Works

The realtime pipeline has three stages:

1. **Database trigger** — A mutation hits the PostgreSQL database (via REST API, SDK, or Studio).
2. **Server fan-out** — The Rebase server detects the change and fans it out to every active WebSocket subscription that matches the affected collection or entity.
3. **Client callback** — The client SDK fires your `onUpdate` callback with the fresh data.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

For multi-instance deployments, Rebase uses PostgreSQL's `LISTEN/NOTIFY` to broadcast changes across server instances. This is handled automatically — a dedicated PostgreSQL connection listens on the `rebase_entity_changes` channel and relays updates to local subscribers.

### Zero Configuration

Realtime is enabled out of the box. There is no flag to flip or service to start — if your Rebase server is running, the WebSocket endpoint is available.

## Client SDK Subscriptions

The Rebase client SDK exposes two subscription methods on every collection accessor:

- **`listen()`** — Subscribe to an entire collection (with optional filters).
- **`listenById()`** — Subscribe to a single entity by its ID.

Both methods return an **unsubscribe function** you call to stop receiving updates.

### Subscribing to a Collection

Use `listen()` to receive updates whenever records in a collection change:

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

The callback receives a `FindResponse<M>` containing:
- `data` — Array of `Entity<M>` objects.
- `meta` — Pagination info (`total`, `limit`, `offset`, `hasMore`).

### Subscribing to a Collection with Filters

Pass `FindParams` as the first argument to filter the subscription:

```typescript
const unsubscribe = client.data.products.listen(
  {
    where: { status: "published" },
    orderBy: "created_at:desc",
    limit: 50,
  },
  (response) => {
    console.log("Published products:", response.data);
  }
);
```

The server respects these filters — only matching records are included in updates.

### Subscribing to a Single Entity

Use `listenById()` to watch a specific record:

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

The callback receives `Entity<M> | undefined`. A value of `undefined` means the entity was deleted.

### Unsubscribing

Both `listen()` and `listenById()` return an unsubscribe function. Call it to stop receiving updates and clean up server-side resources:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Always call the unsubscribe function when a component unmounts or a page navigates away. This prevents memory leaks and unnecessary server-side work.
:::

## Query Builder `.listen()`

The fluent query builder also supports realtime subscriptions. Chain your filters, then call `.listen()` instead of `.find()`:

```typescript
const unsubscribe = client.data.orders
  .where("status", "==", "pending")
  .orderBy("created_at", "desc")
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
The `.listen()` method on the query builder is only available when the `RebaseClient` is configured with a `websocketUrl`. If the WebSocket connection is not configured, calling `.listen()` will throw an error.
:::

## Update Delivery: Instant Patch + Correctness Refetch

Rebase uses a two-phase update strategy for collection subscriptions:

1. **Phase 1 — Instant entity patch:** When a single entity changes, the server immediately pushes a lightweight `collection_entity_patch` message. The client merges this into its cached collection data for near-instant cross-tab feedback — no database query needed.

2. **Phase 2 — Debounced full refetch:** After a short delay (300ms), the server runs a full collection query with your original filters and sort order, then sends the authoritative `collection_update`. This ensures correctness when filters, sort order, or pagination are affected by the change.

This approach gives you the best of both worlds: sub-millisecond perceived latency for simple updates, and guaranteed correctness for complex queries.

## Broadcast Channels

Broadcast channels let clients send arbitrary messages to each other in real time — useful for features like typing indicators, cursor positions, or custom notifications.

Broadcast is managed at the WebSocket protocol level. The server supports these message types:

| Message Type     | Direction       | Description                              |
|-----------------|-----------------|------------------------------------------|
| `join_channel`  | Client → Server | Join a named channel                     |
| `leave_channel` | Client → Server | Leave a channel                          |
| `broadcast`     | Client → Server | Send a message to all channel members    |
| `broadcast`     | Server → Client | Receive a message from another member    |

When a client sends a `broadcast` message, the server relays it to **all other members** of that channel (the sender does not receive its own message).

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

## Presence Tracking

Presence tracks which users are currently online in a channel and lets each user share custom state (e.g., cursor position, status).

| Message Type       | Direction       | Description                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Start tracking presence with custom state            |
| `presence_untrack`| Client → Server | Stop tracking presence                               |
| `presence_state`  | Client → Server | Request the full presence state for a channel        |
| `presence_state`  | Server → Client | Full snapshot of all presences in a channel          |
| `presence_diff`   | Server → Client | Incremental update (joins and leaves)                |

When a client sends `presence_track`, the server automatically joins them to the channel (no separate `join_channel` needed) and broadcasts a `presence_diff` to all channel members.

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

Stale presences are automatically cleaned up after 30 seconds of inactivity.

## Auto-Reconnect

The client SDK automatically reconnects when the WebSocket connection drops:

- **Exponential backoff** — Reconnect delays start at 1 second and double on each attempt, capping at 30 seconds.
- **Maximum 5 attempts** — After 5 failed reconnection attempts, the client stops trying.
- **Automatic resubscription** — On successful reconnect, all active subscriptions are re-registered with the server. No manual intervention needed.
- **Message queuing** — Messages sent while disconnected are queued and delivered after reconnection.

You can listen to connection lifecycle events:

```typescript
const ws = client.ws; // Access the WebSocket client

ws.on("connect", () => console.log("Connected"));
ws.on("disconnect", () => console.log("Disconnected"));
ws.on("reconnect", () => console.log("Reconnected"));
ws.on("error", (error) => console.error("Error:", error));
```

## Authentication & RLS

WebSocket subscriptions automatically respect Row-Level Security (RLS) policies. When the client is authenticated:

1. The WebSocket connection authenticates using the same JWT token as the REST API.
2. Every subscription refetch runs inside a PostgreSQL transaction with `set_config('app.user_id', ...)` and `set_config('app.user_roles', ...)` — ensuring RLS policies are enforced.
3. If a token expires during an active session, the client automatically re-authenticates and re-subscribes.

This means each user only receives updates for records they have permission to see.

## Cross-Instance Broadcasting

In multi-instance deployments (e.g., behind a load balancer), Rebase uses PostgreSQL `LISTEN/NOTIFY` to synchronize changes across server instances:

- A mutation on Instance A triggers a `pg_notify('rebase_entity_changes', ...)` call.
- Instance B receives the notification via its dedicated `LISTEN` connection.
- Instance B refetches the affected entity and fans out the update to its local WebSocket subscribers.
- Each instance has a unique ID to prevent processing its own notifications.

This is **automatic** and requires no additional configuration. The dedicated `LISTEN` connection auto-reconnects with a 3-second delay if it drops.

## Next Steps

- [Client SDK](/docs/client-sdk) — Full SDK reference including typed collection accessors.
- [Authentication](/docs/backend/authentication) — Set up JWT auth and RLS policies.
- [Backend Architecture](/docs/backend/backend) — Overview of the Rebase server architecture.
