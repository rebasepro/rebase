---
name: rebase-realtime
description: Guide for the Rebase WebSocket realtime engine. Use this skill when the user needs real-time data synchronization, broadcast channels, presence tracking, channel message history and reconnect catch-up (collaborative/op-based editing), table change broadcasts, or live updates in their application.
---

# Rebase Realtime Engine

Rebase includes a built-in WebSocket-based realtime engine that broadcasts database changes, supports broadcast channels for arbitrary client-to-client messaging (optionally with replayable message history), and provides presence tracking for online status.

> **IMPORTANT FOR AGENTS:** The WebSocket protocol uses specific message types that differ from typical pub/sub patterns. Read the **Message Types** section carefully before generating any WebSocket code. Do NOT invent message type names — use only the types documented here.

## Architecture

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

The realtime pipeline has three stages:

1. **Database mutation** — A record is created/updated/deleted (via REST API, SDK, or Studio).
2. **Server fan-out** — The `RealtimeService` detects the change and fans out to every active WebSocket subscription matching the affected collection or entity.
3. **Client callback** — The client SDK fires the registered `onUpdate` callback with fresh data.

For multi-instance deployments, PostgreSQL `LISTEN/NOTIFY` broadcasts **row changes** across server instances via the `rebase_entity_changes` channel.

> **IMPORTANT FOR AGENTS:** That covers collection/entity subscriptions only. **Broadcast channels and presence are per-instance unless a channel bus is configured** — see [Multi-instance channels](#multi-instance-channels-and-presence). This is the single most likely cause of "collaboration works locally but not in production": behind a load balancer, two clients on different replicas see an empty room and nothing errors.

### Zero Configuration

Realtime is enabled out of the box. There is no flag to flip or service to start. If the Rebase server is running, the WebSocket endpoint is available on the same HTTP port.

## Client SDK Subscriptions (Recommended)

The `@rebasepro/client` SDK provides high-level methods with automatic authentication, reconnection, subscription deduplication, and typed responses.

### Subscribing to a Collection — `listen()`

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: "http://localhost:3001",
    websocketUrl: "ws://localhost:3001",
    token: myAuthToken,
});

// Subscribe to all products
const unsubscribe = client.data.products.listen(
    undefined, // FindParams — pass undefined for all records
    (response) => {
        console.log("Products updated:", response.data);   // Entity<M>[]
        console.log("Total:", response.meta.total);
    },
    (error) => {
        console.error("Subscription error:", error);
    }
);

// Stop listening when done
unsubscribe();
```

### Subscribing with Filters

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

The server respects these filters — only matching records are included in updates. Filter, sort, limit, offset, and searchString are all supported.

`orderBy` takes a multi-column sort here as anywhere else —
`orderBy: [["category", "asc"], ["created_at", "desc"]]`, or a second
`.orderBy()` call on the fluent builder, which adds a tie-breaker rather than
replacing the first key.

The server validates the *shape* of `orderBy` when the subscribe frame arrives
and answers a malformed one with an error frame (`INVALID_ORDER_BY`) instead of
subscribing. This matters more here than on the REST route: a
`collection_update` frame carries rows and nothing else — no `total`, no
`hasMore` — so a subscriber handed rows in no particular order has no way to
learn that its sort was dropped.

### `listen()` Signature

```typescript no-verify
listen(
    params: FindParams | undefined,
    onUpdate: (response: FindResponse<M>) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

The `FindResponse<M>` contains:

| Field | Type | Description |
|-------|------|-------------|
| `data` | `Entity<M>[]` | Array of matching entities |
| `meta.total` | `number` | Number of entities returned |
| `meta.limit` | `number` | Requested limit |
| `meta.offset` | `number` | Requested offset |
| `meta.hasMore` | `boolean` | Whether more records exist beyond limit |

### Subscribing to a Single Entity — `listenById()`

```typescript
const unsubscribe = client.data.products.listenById(
    "product-123",
    (entity) => {
        if (entity) {
            console.log("Product changed:", entity.values);
        } else {
            console.log("Product was deleted");
        }
    },
    (error) => {
        console.error("Subscription error:", error);
    }
);
```

### `listenById()` Signature

```typescript no-verify
listenById(
    id: string | number,
    onUpdate: (entity: Entity<M> | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

The callback receives `undefined` when the entity is deleted.

### Unsubscribing

Both `listen()` and `listenById()` return an unsubscribe function. Call it to stop receiving updates and clean up server-side resources:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
    // handle updates
});

// Later:
unsubscribe();
```

In React, use `useEffect` cleanup:

```tsx
useEffect(() => {
    const unsubscribe = client.data.products.listen(
        { where: { active: ["==", true] } },
        (response) => setProducts(response.data)
    );
    return () => unsubscribe();
}, []);
```

> **WARNING FOR AGENTS:** Always call the unsubscribe function when a component unmounts or a page navigates away. Failing to do so causes memory leaks and unnecessary server-side work.

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

### `.listen()` Signature on QueryBuilder

```typescript no-verify
listen(
    onUpdate: (data: FindResponse<M>) => void,
    onError?: (error: Error) => void
): () => void
```

> **IMPORTANT FOR AGENTS:** The `.listen()` method on the query builder is only available when the `RebaseClient` is configured with a `websocketUrl`. If the WebSocket is not configured, calling `.listen()` throws: `"Listen is only available when RebaseClient is configured with a websocketUrl."`

## Update Delivery: Instant Patch + Correctness Refetch

Rebase uses a two-phase update strategy for collection subscriptions:

1. **Phase 1 — Instant entity patch (`collection_entity_patch`):** When a single entity changes, the server immediately pushes a lightweight patch message. The client merges this into its cached collection data for near-instant cross-tab feedback — no database query needed.

2. **Phase 2 — Debounced full refetch (`collection_update`):** After a 300ms debounce window (`REFETCH_DEBOUNCE_MS`), the server runs a full collection query with the original filters and sort order, then sends the authoritative update. This ensures correctness when filters, sort order, or pagination are affected by the change.

This gives sub-millisecond perceived latency for simple updates and guaranteed correctness for complex queries. Multiple rapid mutations within the 300ms window are coalesced into a single database query.

## Subscription Deduplication and Caching

The client SDK automatically deduplicates subscriptions:

- If multiple components subscribe to the same collection with identical parameters (path, filter, orderBy, limit, etc.), only **one** WebSocket subscription is created on the server.
- Additional callbacks are registered locally and receive the same data.
- New subscribers immediately receive the cached latest data if available (`isInitialDataReceived`).
- The server subscription is only unsubscribed when the **last** callback for that key is removed.

Deduplication keys are computed deterministically:
- **Collection subscriptions:** JSON of `{ path, filter, limit, startAfter, orderBy, order, searchString, collection.name }` with sorted keys.
- **Entity subscriptions:** `"${path}|${entityId}"`.

## WebSocket Protocol (Raw / Low-Level)

For environments where the SDK is not available, you can use the raw WebSocket protocol. The connection URL is the same HTTP endpoint (no special path required).

### Connection Lifecycle

1. Open a WebSocket connection to the server URL.
2. Send an `AUTHENTICATE` message with your JWT token.
3. Wait for `AUTH_SUCCESS` before sending subscription or other messages.
4. Send `subscribe_collection` or `subscribe_entity` to start receiving data.
5. Receive `collection_update`, `entity_update`, and `collection_entity_patch` messages.
6. Send `unsubscribe` to stop a subscription.

### Authentication Step (Required First)

```typescript
const ws = new WebSocket("ws://localhost:3001");

ws.onopen = () => {
    // Step 1: Authenticate FIRST
    ws.send(JSON.stringify({
        type: "AUTHENTICATE",
        requestId: "auth_1",
        payload: { token: "<jwt-token>" }
    }));
};
```

> **IMPORTANT FOR AGENTS:** Authentication is a SEPARATE step. Do NOT put the token inside subscribe messages. The `AUTHENTICATE` message must be sent and acknowledged before any other operations.

### Authentication Responses

| Response Type | Payload | Description |
|--------------|---------|-------------|
| `AUTH_SUCCESS` | `{ userId, roles }` | Token accepted, session authenticated |
| `AUTH_ERROR` | `{ error: { message, code } }` | Token rejected |

Auth error codes:

| Code | Meaning |
|------|---------|
| `INVALID_INPUT` | No token provided |
| `INVALID_TOKEN` | Token is invalid or expired |

### Subscribe to a Collection

```typescript
ws.send(JSON.stringify({
    type: "subscribe_collection",
    payload: {
        subscriptionId: "sub_products_1",
        path: "products",
        filter: { status: ["==", "active"] },
        orderBy: "created_at",
        order: "desc",
        limit: 50
    }
}));
```

### Subscribe to a Single Entity

```typescript
ws.send(JSON.stringify({
    type: "subscribe_entity",
    payload: {
        subscriptionId: "sub_product_42",
        path: "products",
        entityId: "42"
    }
}));
```

### Unsubscribe

```typescript
ws.send(JSON.stringify({
    type: "unsubscribe",
    payload: { subscriptionId: "sub_products_1" }
}));
```

### Handling Server Messages

```typescript
ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    switch (message.type) {
        case "collection_update":
            // Full collection data after refetch
            console.log("Collection:", message.subscriptionId);
            console.log("Entities:", message.entities); // Entity[]
            break;

        case "entity_update":
            // Single entity update
            console.log("Entity:", message.subscriptionId);
            console.log("Data:", message.entity); // Entity | null
            break;

        case "collection_entity_patch":
            // Lightweight instant patch for a collection subscription
            console.log("Patch:", message.subscriptionId);
            console.log("Entity ID:", message.entityId);
            console.log("Entity:", message.entity); // Entity | null (null = deleted)
            break;

        case "ERROR":
            console.error("Error:", message.payload?.error?.message);
            console.error("Code:", message.payload?.error?.code);
            break;
    }
};
```

## Message Types Reference

### Client → Server

| Type | Payload | Description |
|------|---------|-------------|
| `AUTHENTICATE` | `{ token }` | Authenticate the WebSocket session with a JWT |
| `subscribe_collection` | `{ subscriptionId, path, filter?, orderBy?, order?, limit?, offset?, startAfter?, searchString? }` | Subscribe to collection changes |
| `subscribe_entity` | `{ subscriptionId, path, entityId }` | Subscribe to a single entity |
| `unsubscribe` | `{ subscriptionId }` | Unsubscribe from a subscription |
| `join_channel` | `{ channel }` | Join a broadcast channel |
| `leave_channel` | `{ channel }` | Leave a broadcast channel |
| `broadcast` | `{ channel, event, payload }` | Send a message to channel members |
| `presence_track` | `{ channel, state }` | Track presence with custom state (auto-joins channel) |
| `presence_untrack` | `{ channel }` | Stop tracking presence |
| `presence_state` | `{ channel }` | Request full presence entity |
| `channel_history` | `{ channel, sinceSeq?, limit? }` | Request retained messages after `sinceSeq` (retained channels only) |
| `FETCH_COLLECTION` | `FetchCollectionProps` | One-shot collection fetch (request/response) |
| `FETCH_ENTITY` | `FetchEntityProps` | One-shot entity fetch |
| `SAVE_ENTITY` | `SaveEntityProps` | Create or update a entity |
| `DELETE_ENTITY` | `DeleteEntityProps` | Delete a entity |
| `COUNT_ENTITIES` | `FetchCollectionProps` | Count entities matching criteria |
| `CHECK_UNIQUE_FIELD` | `{ path, name, value, entityId?, collection? }` | Check field uniqueness |

### Server → Client

| Type | Key Fields | Description |
|------|-----------|-------------|
| `AUTH_SUCCESS` | `{ requestId, payload: { userId, roles } }` | Authentication successful |
| `AUTH_ERROR` | `{ requestId, payload: { error: { message, code } } }` | Authentication failed |
| `collection_update` | `{ subscriptionId, entities }` | Full collection data (authoritative refetch) |
| `entity_update` | `{ subscriptionId, entity }` | Single entity data (entity or `null` if deleted) |
| `collection_entity_patch` | `{ subscriptionId, entityId, entity }` | Instant single-entity patch for a collection subscription |
| `broadcast` | `{ channel, event, payload, seq? }` | Broadcast from another channel member. `seq` is present only on retained channels |
| `presence_state` | `{ channel, presences }` | Full presence entity |
| `presence_diff` | `{ channel, joins, leaves }` | Incremental presence update |
| `channel_history` | `{ channel, messages, retained, latestSeq? }` | Retained messages a client missed. `retained: false` means the channel keeps no history |
| `ERROR` | `{ requestId?, payload: { error: { message, code } } }` | General error |
| `FETCH_COLLECTION_SUCCESS` | `{ requestId, payload: { entities } }` | Response to FETCH_COLLECTION |
| `FETCH_ENTITY_SUCCESS` | `{ requestId, payload: { entity } }` | Response to FETCH_ENTITY |
| `SAVE_ENTITY_SUCCESS` | `{ requestId, payload: { entity } }` | Response to SAVE_ENTITY |
| `DELETE_ENTITY_SUCCESS` | `{ requestId, payload: { success: true } }` | Response to DELETE_ENTITY |
| `COUNT_ENTITIES_SUCCESS` | `{ requestId, payload: { count } }` | Response to COUNT_ENTITIES |
| `CHECK_UNIQUE_FIELD_SUCCESS` | `{ requestId, payload: { isUnique } }` | Response to CHECK_UNIQUE_FIELD |

### Error Codes

| Code | Meaning |
|------|---------|
| `INVALID_INPUT` | Missing required field |
| `INVALID_TOKEN` | JWT invalid or expired |
| `UNAUTHORIZED` | Authentication required but session not authenticated |
| `FORBIDDEN` | Admin access required for this operation |
| `RATE_LIMITED` | Too many requests (see Rate Limiting) |
| `INTERNAL_ERROR` | Unexpected server error |
| `NOT_SUPPORTED` | Operation not available for this driver |
| `SQL_ERROR` | SQL execution error (admin only) |

### Admin-Only Message Types

These message types require the authenticated user to have the `admin` role:

| Type | Description |
|------|-------------|
| `EXECUTE_SQL` | Execute raw SQL |
| `FETCH_DATABASES` | List available databases |
| `FETCH_ROLES` | List available roles |
| `FETCH_UNMAPPED_TABLES` | List tables not mapped to collections |
| `FETCH_TABLE_METADATA` | Get column/FK metadata for a table |
| `FETCH_CURRENT_DATABASE` | Get the current database name |
| `CREATE_BRANCH` | Create a database branch |
| `DELETE_BRANCH` | Delete a database branch |
| `LIST_BRANCHES` | List all database branches |

## Broadcast Channels

Broadcast channels let clients send arbitrary messages to each other in real time — useful for typing indicators, cursor positions, or custom notifications.

### Joining a Channel

```typescript
ws.send(JSON.stringify({
    type: "join_channel",
    payload: { channel: "room-42" }
}));
```

### Sending a Broadcast

```typescript
ws.send(JSON.stringify({
    type: "broadcast",
    payload: {
        channel: "room-42",
        event: "typing",
        payload: { userId: "user-1", isTyping: true }
    }
}));
```

### Receiving Broadcasts

The server relays broadcasts to **all other members** of the channel (the sender does NOT receive its own message):

```typescript
// Received by other clients in the channel
{
    type: "broadcast",
    channel: "room-42",
    event: "typing",
    payload: { userId: "user-1", isTyping: true }
}
```

### Leaving a Channel

```typescript
ws.send(JSON.stringify({
    type: "leave_channel",
    payload: { channel: "room-42" }
}));
```

When a client disconnects, they are automatically removed from all channels.

## Multi-instance channels and presence

Broadcast and presence fan out **only to clients on the instance that received them**, unless a channel bus is configured. Correct and free on one instance; silently broken on two.

```typescript
createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: {
        bus: { type: "postgres" }   // "memory" (default) | "postgres"
    }
})
```

Or per deployment: `REALTIME_CHANNEL_BUS=postgres`.

| Bus | Use when |
|-----|----------|
| `memory` | Single instance. Default; zero overhead. |
| `postgres` | Two or more instances. Uses the database you already have — no extra service. |

> **No Redis ships in the box, and that is deliberate.** The Postgres bus measured ~10k cross-instance messages/second (flat out to 8 instances), about 8× what live-cursor collaboration generates, so a broker would add a stateful service to every deployment for no gain. Never suggest adding a broker dependency *to the framework*. If a user has genuinely outgrown it, point them at the extension point below.

### A transport can ship as its own package

`realtime.bus` accepts either a built-in name or **any `ChannelBus` instance**, so a Redis (or NATS, or anything) transport lives in its own package and plugs in without a framework change:

```typescript
import type { ChannelBus, ChannelBusFrame, ChannelBusHandler } from "@rebasepro/types";

class MyBus implements ChannelBus {
    constructor(private readonly url: string) {}
    readonly kind = "my-transport";
    readonly maxFrameBytes = Infinity;   // finite → large retained msgs go by pointer
    async start(handler: ChannelBusHandler) { /* reject if unusable */ }
    async publish(frame: ChannelBusFrame) { /* reach every other instance, or reject */ }
    async stop() { /* idempotent */ }
}

realtime: { bus: new MyBus(url) }
```

The contract is declared in `@rebasepro/types` (`types/channel_bus.ts`) — a transport package depends on that alone, never on `@rebasepro/server-postgres`. Must guarantee: `start()` rejects when unusable, `publish()` reaches all other instances or rejects, `stop()` is idempotent, malformed frames are dropped not thrown. Need **not** guarantee ordering, durability or exactly-once — retained frames dedupe by `seq`, presence diffs are idempotent.

`REALTIME_CHANNEL_BUS` only names built-ins; it never overrides a supplied instance (it warns if both are set).

**Diagnosing:** `realtimeService.getChannelBusKind()` returns the active transport. A misconfigured bus never blocks boot — it logs a warning and falls back to `"memory"`, so check the startup logs for `[ChannelBus]` when cross-instance delivery is missing.

### Coalescing (Postgres bus)

Outgoing frames are batched into one `pg_notify` per ~10ms window, leading-edge (the first frame of an idle stream goes immediately, so no added latency). Measured: **44× fewer database queries** on burst traffic, **12.5×** on paced ~500 msg/s traffic, 100% delivery in both. Tune with `bus: { type: "postgres", batchWindowMs: N }`; `0` disables it. The window is not sensitive — 5/10/20ms measured identically, since batches hit the 8KB ceiling or the traffic's natural gaps first.

> **IMPORTANT FOR AGENTS:** if a user reports missing channel messages *during a rolling deploy under load*, this is the likely cause: a batched payload is a different wire shape that an older instance drops. Single frames are always sent unwrapped, so idle/low-rate traffic is unaffected, and retained channels self-repair via history replay. Not a bug to "fix" by disabling batching — it resolves when the deploy completes.

### Two things agents get wrong here

1. **The Postgres bus needs a direct connection.** `LISTEN` is session state, so it must not go through pgBouncer or any transaction-mode pooler. Rebase uses `DATABASE_DIRECT_URL` when set.

2. **`pg_notify` caps payloads at 8000 bytes.** On a **retained** channel a large message travels as a `(channel, seq)` pointer and each instance reads the body back — no size limit. On an **ephemeral** channel it cannot: the message is delivered locally, the sender gets a `CHANNEL_BUS_PAYLOAD_TOO_LARGE` error, and a warning names the channel. The fix is always the same — add a retention rule for that channel.

With a bus active, presence rosters live in `rebase.channel_presence` (created automatically), so `presence_state` answers for the whole cluster. Rows whose instance stops heartbeating are reaped after the 30s presence timeout, which is also how a crashed pod's clients disappear from everyone's roster.

## Channel History and Catch-Up

By default a broadcast reaches currently-connected members and is then gone — correct for cursors and notifications, and it costs nothing. A channel can instead be configured to **retain** its messages, so a reconnecting client catches up on what it missed rather than resyncing. This is what makes channels usable for operation streams (collaborative editing).

> **IMPORTANT FOR AGENTS:** Retention is configured on the **server** and cannot be requested by a client. `{ history: true }` on the client only asks the SDK to *use* history for a channel the server already retains. If the user reports "history isn't working", check the server config first — the symptom of a missing rule is `retained: false`, not an error.

### Server config (required)

```typescript
createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: {
        channels: [
            // Most specific first — first match wins.
            { match: "doc:*", limit: 500, ttl: "24h" }
        ]
    }
})
```

`match` is an exact channel name or a trailing-`*` prefix — **not** a general glob (`"doc:*:live"` matches nothing). A rule needs at least one of `limit` or `ttl`, or it is ignored and logged; unbounded retention is refused rather than honoured.

`ttl` accepts `"30s"`, `"15m"`, `"24h"`, `"7d"`, or a millisecond number. An unparseable value is ignored with a warning rather than guessed at.

### Client usage

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Replayed messages arrive through the SAME handler, in order.
channel.onBroadcast("op", (payload) => applyOperation(payload));
await channel.join();
```

The SDK requests catch-up on `join()` and after every reconnect, resuming from the highest `seq` it has delivered. Explicit fetch:

```typescript
const { messages, retained, latestSeq } = await channel.history({ sinceSeq, limit });
console.log(channel.sequence); // highest seq delivered so far
```

### Behaviour worth knowing

- **`seq` is per-channel, dense and increasing.** It appears on `BroadcastEvent.seq` only for retained channels; ephemeral broadcasts have no `seq`.
- **`replayed: true`** marks a message delivered by catch-up rather than live. Handlers usually ignore it.
- **Replays overlap, and duplicates are dropped by the SDK.** Anything at or below the last delivered sequence is discarded, so handlers never see a message twice.
- **Your own messages are not filtered out of a replay.** A reconnect assigns a new client id, so filtering by sender would fail in exactly the case catch-up exists for. Operations must be idempotent.
- **A message that cannot be persisted is not delivered**, and the sender gets a `CHANNEL_HISTORY_WRITE_FAILED` error. Delivering it would leave a gap no replay could repair.
- **Live messages are held back during catch-up** so ordering holds, bounded by a 10s timeout.

### Storage

Two tables in the `rebase` schema, created on startup only when a rule exists: `rebase.channel_messages` (keyed `(channel, seq)`) and `rebase.channel_cursors`. Pruning removes messages only — cursors are kept forever, because restarting a sequence would change what a client's saved resume point means.

> **Security:** history has the same access model as the channel. Anyone who may join may replay what was said before they arrived. Enabling retention on a publicly-joinable channel makes its past readable to any visitor.

## Presence Tracking

Presence tracks which users are currently online in a channel, with custom state per user.

### Use the SDK, not the raw protocol

`client.realtime.channel(name)` wraps channels and presence, and handles the join roster and the heartbeat below for you. Reach for the raw messages only when you need something it doesn't expose.

```typescript
const channel = client.realtime.channel("document-42");

// Publish your own state — repeat calls update it (e.g. a moving cursor).
await channel.track({ name: "Alice", cursor: { line: 10, col: 5 } });

// Observe the roster. Fires with the full state, plus the diff that caused it.
const off = channel.onPresence((presences, diff) => {
    console.log(Object.keys(presences).length, "people here");
});

// Broadcasts — the sender never receives its own message.
await channel.broadcast("typing", { userId: "u1" });
channel.onBroadcast("typing", (payload) => { /* ... */ });

await channel.leave(); // releases the handlers and the heartbeat timer
```

Channels are per-name singletons: two components asking for `"document-42"` get the same object, so neither can cut the other off by leaving.

### Two behaviours that will bite you on the raw protocol

**1. A joining client is told only about its own join.** The `presence_diff` you receive after `presence_track` contains *just you* — the existing roster is not pushed. To learn who is already in the channel you must explicitly send `presence_state`. (The SDK's `join()` does this for you.)

**2. Presence expires after 30 seconds.** `presence_track` is not a durable registration. Unless you re-send it on a timer you silently disappear from everyone else's roster while still sitting in the document — no disconnect, no event, you just stop being listed. Beat well inside the window (the SDK uses 20s) so a single dropped frame isn't a disappearance. See [Presence Timeout](#presence-timeout).

A reconnect also drops server-side channel membership and presence, so both must be re-established; the SDK re-joins, re-requests the roster and re-tracks automatically.

### Tracking Presence

Sending `presence_track` **automatically joins the channel** — no separate `join_channel` needed:

```typescript
ws.send(JSON.stringify({
    type: "presence_track",
    payload: {
        channel: "document-42",
        state: { name: "Alice", cursor: { line: 10, col: 5 } }
    }
}));
```

### Receiving Presence Diffs

All channel members receive incremental `presence_diff` messages when users join or leave.

> The diff you receive on *your own* join contains only you. It is not the roster — request `presence_state` for that.

```typescript
{
    type: "presence_diff",
    channel: "document-42",
    joins: { "client_abc": { name: "Alice", cursor: { line: 10, col: 5 } } },
    leaves: {}
}
```

### Requesting Full Presence State

```typescript
ws.send(JSON.stringify({
    type: "presence_state",
    payload: { channel: "document-42" }
}));
```

Response:

```typescript
{
    type: "presence_state",
    channel: "document-42",
    presences: {
        "client_abc": { name: "Alice", cursor: { line: 10, col: 5 } },
        "client_def": { name: "Bob", cursor: { line: 22, col: 0 } }
    }
}
```

### Untracking Presence

```typescript
ws.send(JSON.stringify({
    type: "presence_untrack",
    payload: { channel: "document-42" }
}));
```

### Presence Timeout

Stale presences are automatically cleaned up after **30 seconds** of inactivity (`PRESENCE_TIMEOUT_MS = 30000`). The server checks for stale entries every 10 seconds. When a stale presence is removed, a `presence_diff` with a `leaves` entry is broadcast to the channel.

**This means `presence_track` must be re-sent on a timer.** A client that tracks once and then goes quiet is reaped at the 30s mark and vanishes from every other member's roster — while still connected and still sitting in the document. Re-send comfortably inside the window (20s is a good default: one lost beat still leaves time for the next). `client.realtime.channel().track()` starts this heartbeat for you and stops it on `untrack()` / `leave()`.

## Rate Limiting

The WebSocket server enforces per-client rate limiting:

| Setting | Value |
|---------|-------|
| Max messages per window | **2000** (`WS_RATE_LIMIT`) |
| Window duration | **60 seconds** (`WS_RATE_WINDOW_MS`) |

When the limit is exceeded, the server responds with:

```json
{
    "type": "ERROR",
    "payload": { "error": { "message": "Too many requests. Please slow down.", "code": "RATE_LIMITED" } }
}
```

The window is a sliding window — the counter resets after 60 seconds of the window start.

## Auto-Reconnect Behavior

The client SDK (`RebaseWebSocketClient`) automatically reconnects when the connection drops:

| Setting | Value |
|---------|-------|
| Initial delay | **1 second** |
| Backoff formula | `min(1000 * 2^attempt, 30000)` ms |
| Maximum delay | **30 seconds** |
| Maximum attempts | **5** (`maxReconnectAttempts`) |

### Reconnection sequence:

1. Connection drops → `onclose` fires.
2. Client sets `isAuthenticated = false` and queues pending requests.
3. Reconnect after exponential backoff delay.
4. On successful reconnect:
   - Auto-authenticates if `getAuthToken` is configured.
   - Calls `resubscribeAll()` — all active collection and entity subscriptions are re-registered with fresh subscription IDs.
   - Processes the queued message queue.
   - Emits `"reconnect"` event.

### Connection Lifecycle Events

```typescript
const ws = client.ws; // Access the RebaseWebSocketClient

ws.on("connect", () => console.log("Connected"));
ws.on("disconnect", () => console.log("Disconnected"));
ws.on("reconnect", () => console.log("Reconnected"));
ws.on("error", (error) => console.error("Error:", error));
```

Each `on()` call returns an unsubscribe function:

```typescript
const unsub = ws.on("connect", () => { /* ... */ });
unsub(); // Stop listening
```

## Authentication & RLS

WebSocket subscriptions automatically respect Row-Level Security (RLS) policies:

1. The client sends an `AUTHENTICATE` message with a JWT token.
2. The server verifies the token (via `extractUserFromToken` or a custom `AuthAdapter`).
3. Every subscription refetch runs inside a PostgreSQL transaction with:
   - `set_config('app.user_id', ...)` 
   - `set_config('app.user_roles', ...)`
   - `set_config('app.jwt', ...)`
4. RLS policies are enforced — each user only sees records they have permission to access.
5. If no auth context is present, the server defaults to `{ userId: "anon", roles: ["anon"] }`.

### Auto-Authentication

The client SDK handles authentication automatically:

- On connect, if `getAuthToken` is configured, the client authenticates immediately.
- On-demand authentication: if a non-auth message is sent before authentication, the client calls `ensureAuthenticated()` with up to 3 retries and backoff.
- `setAuthTokenGetter()` can be called after construction to provide the token getter dynamically.
- `reauthenticate()` forces re-authentication (call after token refresh).

### Auth Failure Recovery

When the server returns an `AUTH_ERROR` or `UNAUTHORIZED` error for any request or subscription:

1. The client calls `onUnauthorized()` (if configured) to attempt a token refresh.
2. If the refresh succeeds, the failed request is retried automatically.
3. If the refresh fails, the error is propagated to the callback.

## Client Configuration

### `RebaseWebSocketConfig`

This is the config of the low-level `RebaseWebSocketClient`, which
`createRebaseClient()` constructs for you. Only `websocketUrl` is also a
`createRebaseClient()` option — the rest are wired internally.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `websocketUrl` | `string` | Yes | WebSocket server URL (e.g., `"ws://localhost:3001"`) |
| `getAuthToken` | `() => Promise<string>` | No | Async function that returns the current JWT token |
| `WebSocket` | `typeof WebSocket` | No | Custom WebSocket constructor. **Only reachable when you construct `RebaseWebSocketClient` yourself** — `createRebaseClient()` does not forward it. |
| `onUnauthorized` | `() => Promise<boolean>` | No | Called on auth failure; return `true` if token was refreshed |

### Using in Node.js

The client resolves its constructor from `globalThis.WebSocket`. Node 22+ ships
one, so nothing is needed there. On older Node, set the global **before**
creating the client — `createRebaseClient()` takes no `WebSocket` option:

```typescript
import WS from "ws";
import { createRebaseClient } from "@rebasepro/client";

// Node < 22 only. Must run before createRebaseClient().
globalThis.WebSocket ??= WS as unknown as typeof globalThis.WebSocket;

const client = createRebaseClient({
    baseUrl: "http://localhost:3001",
    websocketUrl: "ws://localhost:3001",
});
```

> **IMPORTANT FOR AGENTS:** Do NOT pass `WebSocket` to `createRebaseClient()` —
> it is not an option and is silently ignored. If no constructor resolves, the
> client logs a warning and realtime subscriptions do NOT work. The warning is
> emitted on first *use*, not on construction, so a client that never subscribes
> stays silent.

### The socket connects lazily

Creating a client opens **no** WebSocket. The socket is dialled on the first operation that needs it — `collection().listen(...)`, or any channel operation (`join`, `track`, `broadcast`, `onPresence`, `onBroadcast`).

This matters for apps with meaningful signed-out traffic — marketing pages, docs, public read-only views, anonymous-first tools. Previously `realtime` was effectively all-or-nothing per client: enabling it to reach `channel()` dialled a socket on every page load, including the anonymous ones with no token to authenticate with. Realtime is a per-feature capability, so the socket is now per-use.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Notes:

- `realtime: false` is unchanged — a hard opt-out. No socket ever, and `channel()` throws.
- Signing in does not open a socket. A socket opened later authenticates itself; one already open is re-authenticated on `SIGNED_IN` / `TOKEN_REFRESHED`.
- **Channel and presence frames do not require an account.** They are exempt from the client-side auth gate, so anonymous visitors can join public channels; the server still authorizes them.
- `client.close()` is final: nothing queued afterwards redials.
- Apps that subscribe on boot are unaffected — they connect at the same moment, just triggered by the subscribe rather than the constructor.

## Server Configuration

### Multiple data sources

With more than one realtime-capable engine in a single instance (e.g. Postgres + MongoDB), the single WebSocket server routes each subscription to the provider owning the subscribed collection — Postgres via `LISTEN/NOTIFY`, MongoDB via change streams — based on the collection's resolved data source. Broadcast channels and presence use the default provider (they're engine-agnostic). Firestore (`direct` transport) realtime is handled entirely **client-side** by its SDK and never reaches the backend WebSocket. No extra configuration is needed beyond registering the engines; single-engine setups are unaffected. See the **rebase-collections** skill for the data-source model.

### Cross-Instance Broadcasting

For multi-instance deployments (behind a load balancer), Rebase uses PostgreSQL `LISTEN/NOTIFY` to synchronize changes:

- A mutation on Instance A triggers `pg_notify('rebase_entity_changes', ...)`.
- Instance B receives the notification via its dedicated `LISTEN` connection.
- Instance B refetches the affected entity and fans out the update to its local subscribers.
- Each instance has a unique ID (`inst_<uuid>`) to skip its own notifications.

This is **automatic** when `connectionString` is provided to the Postgres bootstrapper. The dedicated `LISTEN` connection auto-reconnects with a **3-second fixed delay** if it drops.

### `DATABASE_DIRECT_URL` Environment Variable

When using PgBouncer or a similar connection pooler, `LISTEN/NOTIFY` does not work through the pooler. Set `DATABASE_DIRECT_URL` to a direct PostgreSQL connection string that bypasses the pooler:

```bash
# Standard pooled connection
DATABASE_URL=postgres://user:pass@pgbouncer:6432/mydb

# Direct connection for LISTEN/NOTIFY (bypasses PgBouncer)
DATABASE_DIRECT_URL=postgres://user:pass@postgres:5432/mydb
```

The bootstrapper prefers `DATABASE_DIRECT_URL` over `connectionString` for the LISTEN client:

```
const directUrl = process.env.DATABASE_DIRECT_URL || pgConfig.connectionString;
```

### Debounce Window

The server coalesces rapid entity mutations into a single database refetch using a configurable debounce:

| Constant | Value | Description |
|----------|-------|-------------|
| `REFETCH_DEBOUNCE_MS` | `300` ms | Debounce window for collection and entity refetches |

If 10 entities change within 300ms, only **one** database query is executed for each affected subscription.

### Presence Cleanup

| Constant | Value | Description |
|----------|-------|-------------|
| `PRESENCE_TIMEOUT_MS` | `30000` ms (30s) | Stale presence entries are removed after this timeout |
| Cleanup interval | `10000` ms (10s) | How often the server checks for stale presences |

## Nested Relation Updates

The realtime engine handles nested relation paths (e.g., `"posts/70/tags"`). When a entity changes at a nested path:

1. The exact path is notified (`"posts/70/tags"`).
2. All parent paths are also notified (`"posts"`, `"posts/70"`).

This ensures that a subscription to `"posts"` receives updates even when a related `"tags"` entity changes.

## Error Handling

### SDK Error Types

The client throws `ApiError` for WebSocket errors:

```typescript
class ApiError extends Error {
    code?: string;   // Error code (e.g., "UNAUTHORIZED", "RATE_LIMITED")
    error?: string;  // Error description
}
```

### Subscription Error Callbacks

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* success */ },
    (error) => {
        // error is an Error or ApiError instance
        if (error instanceof ApiError) {
            console.error("Code:", error.code);
        }
        console.error("Message:", error.message);
    }
);
```

### Pending Request Timeout

To prevent client requests from hanging indefinitely, all pending WebSocket operations that expect a server response (such as `FETCH_COLLECTION`, `FETCH_ENTITY`, `SAVE_ENTITY`, `DELETE_ENTITY`, `COUNT_ENTITIES`, and `CHECK_UNIQUE_FIELD`) have a default timeout of 30 seconds (`requestTimeoutMs = 30000`).

If the server does not respond within this window, the client automatically deletes the pending request record and rejects the request's promise with an `ApiError`:
- Message: `"Request timed out"`
- Code: `undefined`

One-way messages that do not expect a response (like `subscribe_collection`, `subscribe_entity`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, and `presence_state`) resolve immediately upon transmission and do not trigger timeouts.

### Production Error Sanitization

In production (`NODE_ENV=production`):
- Debug logs are suppressed on both server and client.
- Error messages in responses are sanitized to `"An unexpected error occurred"` to prevent PII/data leaks.
- The `WebSocket` handler catches all unhandled errors and returns them as generic `ERROR` messages.

## When to Use Realtime

| Use Case | Method |
|----------|--------|
| Dashboard with live data | `listen()` with filters |
| Chat or notifications | `listen()` on messages collection |
| Detail page with live updates | `listenById()` |
| Admin panel monitoring | `listen()` with `orderBy` and `limit` |
| Collaborative editing cursors | Broadcast channels + presence |
| Typing indicators | Broadcast channels |
| Online user tracking | Presence tracking |
| A live list that must survive a dropped connection | `observe()` with `offline: true` |

### `listen()` vs `observe()`

`listen()` is the socket — it delivers what the server pushes and nothing at all when the socket is down.

`observe()` is the query. With `offline: true` on the client it emits from the local database first (before any request), subscribes to realtime itself, and re-emits on local writes, on queued writes reaching the server, and on rollbacks. Each result carries `fromCache` / `hasPendingWrites` / `partial`. Reach for it in a UI; reach for `listen()` when you specifically want the raw server stream. See the **rebase-sdk** skill.

## References

- **Backend Realtime Docs:** [rebase.pro/docs/backend/realtime](https://rebase.pro/docs/backend/realtime)
- **SDK Realtime Docs:** [rebase.pro/docs/sdk/realtime](https://rebase.pro/docs/sdk/realtime)
- **Offline & Live Queries:** [rebase.pro/docs/sdk/offline](https://rebase.pro/docs/sdk/offline)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
