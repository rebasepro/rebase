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

> By default, Rebase also emits realtime events for writes made **outside** the API (via `psql`, another service, or Studio's SQL editor) whenever the database connection supports it — see [database-level change capture](#database-level-change-capture-cdc).

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
    where: { status: ["==", "published"] },
    orderBy: ["created_at", "desc"],
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

A change never travels to a subscriber as data. It travels as the fact that
something changed, and every subscriber is then told what *they* can see by a
query run as them:

1. **Invalidation.** When an entity changes (created, updated, deleted), the
   server marks the affected paths. The row that was written is not forwarded —
   it was read under the writer's authorization, which says nothing about what
   any subscriber is allowed to see.

2. **Debounced RLS refetch.** After **300ms** (`REFETCH_DEBOUNCE_MS`), the server
   refetches the collection with your original filters and sort order. The query
   runs inside a transaction that sets the transaction-local `app.user_id` and
   `app.user_roles` from the subscriber's `SubscriptionAuthContext`, so Postgres
   evaluates Row-Level Security under that client's identity and only the rows
   they are authorized to see are sent in the `collection_update`. The debounce
   also coalesces a burst of writes into one query.

Earlier versions sent an immediate `collection_patch` carrying the written row
before this refetch, for sub-millisecond cross-tab feedback. That row had been
read under the writer's scope, so it could — and did — reach subscribers whose
own policies would have denied it, and the subscription's own `where` filter was
not applied to it either. The patch has been removed: perceived latency for an
update is now the debounce window.

## Broadcast Channels

Broadcast channels let clients send arbitrary messages to each other in real time — useful for features like typing indicators, cursor positions, or custom notifications.

Broadcast is managed at the WebSocket protocol level. The server supports these message types:

| Message Type     | Direction       | Description                              |
|-----------------|-----------------|------------------------------------------|
| `join_channel`    | Client → Server | Join a named channel                     |
| `leave_channel`   | Client → Server | Leave a channel                          |
| `broadcast`       | Client → Server | Send a message to all channel members    |
| `broadcast`       | Server → Client | Receive a message from another member    |
| `channel_history` | Client → Server | Request retained messages after a sequence |
| `channel_history` | Server → Client | The retained messages a client missed    |

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

## Channel Retention

By default a broadcast reaches currently-connected members and is then gone. That is the right trade for notifications and cursors, and it costs nothing.

For an operation stream — collaborative editing, anything where a silent gap causes divergence — a channel can be configured to **retain** its messages. Retained broadcasts are given a per-channel sequence number and stored, so a client that reconnects can ask for everything after the last one it saw.

Retention is opt-in and configured here, on the server:

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

| Field   | Description                                                                 |
|---------|-----------------------------------------------------------------------------|
| `match` | Exact channel name (`"doc:42"`) or a trailing-`*` prefix (`"doc:*"`)        |
| `limit` | Keep at most this many of the most recent messages per channel               |
| `ttl`   | Keep messages for at most this long — `"30s"`, `"15m"`, `"24h"`, `"7d"`, or milliseconds |

A rule needs at least one of `limit` or `ttl`. One with neither is ignored and logged, because unbounded retention is almost never intended and cannot be walked back once the table has grown.

:::note[Why not let clients ask for history?]
A channel is created by whoever names it. If a client could choose its own history depth, any visitor could commit your backend to unbounded storage. Configuring it here also means presence and notification channels — the overwhelming majority — pay nothing: with no rules configured, no table is created and broadcast runs the same synchronous path it always did.
:::

### Storage

Retained channels use two tables in the `rebase` schema, created automatically on startup when at least one rule is configured:

| Table                     | Contents                                                        |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | The retained messages, keyed by `(channel, seq)`                 |
| `rebase.channel_cursors`  | The highest sequence issued per channel                          |

Pruning happens as messages arrive, throttled per channel so cost tracks elapsed time rather than write volume. It only ever removes rows from `channel_messages` — cursors are kept indefinitely (they are one small row per channel), because restarting a channel's sequence would change what a client's saved resume point means.

### Delivery guarantees

- **Ordered.** Sequence numbers are allocated per channel, and delivery order matches sequence order.
- **Durable before delivered.** A message that cannot be stored is not delivered to anyone, and the sender is told. Delivering it would put it in front of live subscribers while leaving it out of every future replay, and no later message could repair that gap.
- **At-least-once on catch-up.** A replay range may overlap messages a client already received; the SDK discards ones it has already delivered.

:::caution[History has the same access model as the channel]
A client that has joined a channel may replay its retained messages, including those broadcast before it arrived — membership is the only check, and joining is open to any client that can name the channel. Retention is opt-in per channel pattern, so enabling it makes that channel's past readable to any visitor who guesses the name. Retained channels are the case where this becomes durable rather than momentary, so treat a retained channel's contents as public to your users.
:::

## Presence Tracking

Presence tracks which users are currently online in a channel and lets each user share custom state (e.g., cursor position, status).

| Message Type       | Direction       | Description                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Start tracking presence with custom state            |
| `presence_untrack`| Client → Server | Stop tracking presence                               |
| `presence_state`  | Client → Server | Request the full presence state for a channel        |
| `presence_state`  | Server → Client | Full entity of all presences in a channel          |
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

## Cross-Instance Broadcasting & LISTEN/NOTIFY Architecture

For multi-instance cluster environments (e.g., running inside Kubernetes or Docker containers behind a load balancer), Rebase relies on PostgreSQL `LISTEN/NOTIFY` to synchronize **row changes** across instances. Collection and entity subscriptions therefore span instances with no configuration — that is what this section describes.

**Broadcast channels and presence are separate**, and are per-instance until you turn on a channel bus. See [Channels and presence across instances](#channels-and-presence-across-instances) below.

### Bypassing pgBouncer Pools

Because connection poolers like **pgBouncer** do not support the persistent connection model required for long-lived SQL `LISTEN` sessions, the real-time supervisor opens a dedicated, unpooled Postgres client (`PgClient`) directly to the database. This direct connection utilizes the `DATABASE_DIRECT_URL` environment variable if configured, ensuring stability and preventing pool exhaustion or abrupt drops.

### Notification Mechanics & Payload Layout

When a entity is modified on Instance A, it broadcasts a notification on the `rebase_entity_changes` channel. To minimize database overhead and network bandwidth, the notification payload is kept extremely compact:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Note: `sid` represents the server's unique random instance ID generated at startup, `p` is the collection slug (path), and `eid` is the target entity ID.*

- **Self-Filtering**: Upon receiving a message, each instance reads the `sid`. If it matches its own instance ID, the server discards the notification to prevent infinite routing loops.
- **Relay and Fan-out**: If the notification came from another instance, the server schedules a debounced refetch and relays the update to its locally connected WebSocket subscribers.
- **Supervisor Reconnection Loop**: If the database connection drops, a background connection supervisor monitors the state and triggers an auto-reconnect sequence after a fixed **3-second** delay, restoring the `LISTEN` loop without affecting the main Hono application lifecycle.

## Channels and presence across instances

Row changes cross instances on their own (above). Broadcast channels and presence do **not**: by default they fan out only to the clients connected to the instance that received them.

On a single instance that is exactly right and costs nothing. Behind a load balancer it is a bug you will not see in development: two collaborators land on different replicas, join the same channel, and see an empty room while broadcasting to each other perfectly. Nothing errors.

The fix is a **channel bus** — an opt-in transport that carries channel frames and presence between instances:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: {
        bus: { type: "postgres" }
    }
})
```

| Bus          | When to use it                                                                                       |
|--------------|--------------------------------------------------------------------------------------------------------|
| `memory`     | **Default.** Single instance. No cross-instance delivery, no overhead.                                   |
| `postgres`   | Two or more instances. Uses `LISTEN/NOTIFY` on the database you already have — no new service to deploy. |

The transport can also be set per deployment with `REALTIME_CHANNEL_BUS=memory|postgres`, which overrides the configured value.

### Why there is no Redis option in the box

Rebase deploys as Postgres + backend + frontend. A bus that needed a message broker would put a second stateful service into every `docker-compose.yml` the CLI scaffolds, for a feature most applications never use — so the bar for adding one is that the database genuinely cannot carry the load.

It can. Measured across two backend instances against a single Postgres container, the Postgres bus delivered **~10,000 cross-instance messages per second with no losses**, and stayed flat out to **eight instances** (14,000 deliveries, no losses). Twenty people dragging cursors at 60 fps generate around 1,200 messages per second — roughly an eighth of that.

The limit worth watching is not capacity, it is that every notification is a query against your primary database, competing with your application's real queries. The Postgres bus therefore **coalesces** outgoing frames (see below), which is what keeps that cost proportional to elapsed time rather than message count.

Per client, the socket accepts up to **7,200 channel frames a minute** (120/s — 60 fps of cursor broadcasts plus the presence update each one carries), counted separately from the budget queries and subscriptions share. Frames past that are refused with a `RATE_LIMITED` error rather than queued.

If you are still pushing it after that, throttle cursor-grade events on the client (last-write-wins state does not need 60 updates a second), and consider routing a document's collaborators to the same instance — sticky routing drops cross-instance traffic to nearly nothing regardless of user count. Only past that is another transport worth it, and then the answer is a transport package, not a fork. See [Writing your own transport](#writing-your-own-transport).

### Coalescing

Frames published while a short window is open leave together in a single notification. The window is **leading-edge**: a frame arriving when no window is open is sent immediately, so an idle channel pays no added latency and only a sustained stream is ever batched.

Measured across two instances, 3,000 broadcasts, all delivered in every case:

| Traffic shape | Coalescing off | Coalescing on | Reduction |
|---|---|---|---|
| Burst (as fast as possible) | 3,000 queries | 68 queries | **44×** |
| Paced (~500 msg/s, spread out) | 3,000 queries | 240 queries | **12.5×** |

The burst case also finished ~11× faster in wall-clock, because the database round-trips were the bottleneck rather than the work.

The window defaults to 10 ms and is not a sensitive setting — 5 ms, 10 ms and 20 ms produced identical query counts in both shapes, because a batch is bounded by the 8 KB payload ceiling or by the natural shape of the traffic well before the timer matters. Change it only if you have a reason:

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 disables coalescing
}
```

One deployment note: a batch travels in a different wire shape from a single frame, and an instance running an older build does not understand it. Single frames are always sent unwrapped, so a rolling deploy only risks dropped frames if the cluster is under sustained load *during* the restart — and retained channels repair themselves through history replay regardless.

## Writing your own transport

`realtime.bus` accepts any object implementing the `ChannelBus` interface, so a transport can ship as its own package — `@rebasepro/types` declares the contract, and nothing else is required to implement it:

```typescript
import type { ChannelBus, ChannelBusFrame, ChannelBusHandler } from "@rebasepro/types";

export class MyChannelBus implements ChannelBus {
    readonly kind = "my-transport";
    readonly maxFrameBytes = Infinity;

    async start(handler: ChannelBusHandler): Promise<void> {
        // Connect. Reject if you cannot — the caller falls back to in-process
        // delivery, which is far better than a cluster that believes it is
        // connected and silently is not.
    }

    async publish(frame: ChannelBusFrame): Promise<void> {
        // Reach every other instance, or reject.
    }

    async stop(): Promise<void> {
        // Idempotent; release anything holding the event loop open.
    }
}
```

Pass the instance where a built-in name would go:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: { bus: new MyChannelBus(process.env.MY_TRANSPORT_URL!) }
})
```

**What your implementation must guarantee:** `start()` rejects when the transport is unusable; `publish()` reaches every other instance or rejects; `stop()` is idempotent; and a malformed message is dropped and logged rather than thrown, so one bad frame cannot take the listener down.

**What it does not have to guarantee:** ordering (retained channels carry `seq` and the SDK orders by it), durability (a lost frame is a missed live update, repaired by the client's history replay), or exactly-once delivery (retained frames are deduped by `seq`; presence diffs are idempotent).

`maxFrameBytes` is how the framework knows whether to send a large retained message inline or as a pointer. Return `Infinity` when your transport has no meaningful ceiling, so the pointer path is never taken needlessly.

Delivery to local clients is not your concern — the realtime service owns which subscribers receive a frame. A transport only moves frames between instances.

### The 8 KB limit on the Postgres bus

`pg_notify` refuses a payload of 8000 bytes or more. Cursors and presence fit with room to spare; a document snapshot does not. Rebase handles this the same way it handles large entity changes — by sending an address instead of a body:

- **On a retained channel** (see [Channel Retention](#channel-retention)) the message is already stored with a sequence number, so the notification carries only `(channel, seq)` and each receiving instance reads the body back. There is no size limit at all.
- **On an ephemeral channel** there is nothing to point at. The broadcast is delivered locally, the sender receives a `CHANNEL_BUS_PAYLOAD_TOO_LARGE` error, and a warning names the channel — rather than the message silently reaching half the cluster.

If you broadcast large messages, give that channel a retention rule. That is the whole fix.

### Presence is shared state, not just fan-out

`presence_state` has to answer "who is in this channel?" for the whole cluster, which per-instance memory cannot do. When a bus is active, Rebase keeps the roster in `rebase.channel_presence` (created automatically) and answers roster requests from it.

| Column        | Contents                                       |
|---------------|------------------------------------------------|
| `channel`     | Channel name                                   |
| `client_id`   | The tracked client                             |
| `instance_id` | Which backend instance it is connected to      |
| `state`       | The client's presence state                    |
| `last_seen`   | Refreshed by the SDK's presence heartbeat      |

The SDK heartbeats presence every ~20 seconds against a 30-second timeout. Rows that stop being refreshed are reaped, and the departures announced to every instance — which doubles as crash recovery: a pod that dies leaves rows behind that look, after one timeout window, exactly like any other client that went quiet. A graceful shutdown clears its own rows immediately, so a rolling deploy does not show a window of ghosts.

:::caution[The LISTEN connection must bypass your pooler]
`LISTEN` is session state, so the Postgres bus needs a direct connection — not pgBouncer or any transaction-mode pooler. Rebase uses `DATABASE_DIRECT_URL` when it is set; behind a pooler, point it at the database service itself. Without a usable direct URL the bus logs a warning and stays in memory mode.
:::

## Database-Level Change Capture (CDC)

**Change Data Capture is on by default.** Rebase captures changes at the database and emits realtime events for **every committed write, regardless of how it was made** — REST, SDK, Studio, `psql`, a cron job in another service, raw Drizzle/SQL, or Studio's **SQL editor**. This is the same model as Supabase Realtime tailing the write-ahead log.

No configuration is required. On a database connection that supports it, CDC self-provisions at startup; on one that doesn't (e.g. a restricted role that can't create triggers), Rebase quietly uses application-level realtime instead — nothing to turn on, nothing that breaks.

### Configuration

CDC is controlled by the `REALTIME_CDC` environment variable:

| Value | Behavior |
| --- | --- |
| `auto` *(default)* | Enable database-level capture where the connection supports it; **silently fall back** to application-level realtime otherwise. Zero-config. |
| `trigger` | Force trigger-based capture. Works on any PostgreSQL, including managed instances without logical replication. Warns (rather than silently falling back) if it can't provision. |
| `wal` | Prefer WAL logical replication. Not yet bundled — degrades to `trigger` and logs the active mode. |
| `off` | Application-level realtime only. Use this to avoid the per-write trigger overhead on write-heavy workloads. |

On boot you'll see a log line stating the active mode, e.g.:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

If the connection can't support it, `auto` logs an informational line instead and continues with application-level realtime:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

### How It Works

1. **Self-provisioning** — At startup (server/owner context), Rebase installs an idempotent `AFTER INSERT/UPDATE/DELETE` trigger on each managed table. The trigger emits a compact change notification on the `rebase_cdc` channel. A payload that would exceed PostgreSQL's 8&nbsp;KB `NOTIFY` limit falls back to an identity-only message, so CDC can never abort the triggering write.
2. **Capture** — A dedicated, unpooled `LISTEN` client per instance consumes `rebase_cdc`, maps the changed table back to its collection, and feeds the change into the same `RealtimeService` pipeline used by API mutations. Like the cross-instance listener, it prefers `DATABASE_DIRECT_URL` and auto-reconnects.
3. **RLS-safe delivery** — The raw row from the change stream is **never** forwarded to subscribers. The change is marked invalidated, and each subscription re-reads the row under its **own** auth context. Filtering is therefore per subscriber, never per publisher: a client only ever receives rows its RLS policies permit.
4. **Cross-instance** — Because every instance observes every commit through the change stream, CDC also *is* the cross-instance channel; the legacy per-mutation `rebase_entity_changes` broadcast is not used while CDC is active.
5. **De-duplication** — A mutation made through the Rebase API is delivered locally the instant it commits and is also echoed back through the change stream. The originating instance suppresses that echo (a short-lived record of its own emits), so subscribers never see an API write twice.

### Requirements & Notes

- CDC requires a direct connection string (`DATABASE_DIRECT_URL` or the primary connection) for the `LISTEN` client — connection poolers in transaction mode do not support long-lived `LISTEN` sessions.
- Triggers are installed only on tables backed by a registered collection. Writes to unmapped tables are ignored.
- A collection whose table has not yet been migrated is skipped with a warning rather than blocking CDC for the rest.
- Native WAL logical-replication streaming (`wal2json`/`pgoutput`) is planned; today `REALTIME_CDC=wal` degrades to the trigger-based path, which provides equivalent database-level coverage.

## Pending Request Timeout

To prevent client requests from hanging indefinitely, all pending WebSocket operations that expect a server response (such as one-shot collection fetches `FETCH_COLLECTION`, single entity fetches `FETCH_ONE`, creating/updating `SAVE`, deletes `DELETE`, counts `COUNT`, and uniqueness checks `CHECK_UNIQUE_FIELD`) have a default timeout of 30 seconds.

If the server does not respond within this 30-second window, the client automatically deletes the pending request and rejects the promise with an `ApiError` with the message `"Request timed out"`.

One-way messages that do not expect a response (like `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, and `presence_state`) resolve immediately upon transmission and do not trigger timeouts.

## Next Steps

- [Client SDK](/docs/sdk) — Full SDK reference including typed collection accessors.
- [Authentication](/docs/backend/authentication) — Set up JWT auth and RLS policies.
- [Backend Architecture](/docs/backend) — Overview of the Rebase server architecture.
