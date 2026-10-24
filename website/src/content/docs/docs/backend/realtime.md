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
3. **Client callback** — The typed SDK fires your `onUpdate` callback with the fresh data.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

For multi-instance deployments, Rebase uses PostgreSQL's `LISTEN/NOTIFY` to carry changes across server instances. This is handled automatically. With [database-level change capture](/docs/backend/realtime-cdc/) on (the default wherever the database role can create triggers), every instance listens on the `rebase_cdc` channel the capture triggers publish to, so a write is heard whichever process or tool made it. Without capture, each instance announces its own writes on the `rebase_entity_changes` channel, and a dedicated connection on every other instance relays them to its local subscribers.

### Zero Configuration

Realtime is enabled out of the box. There is no flag to flip or service to start — if your Rebase server is running, the WebSocket endpoint is available.

### Which path the socket answers

On 0.24 the socket takes every WebSocket upgrade on the server, whatever its path.

The socket answers upgrades on one path: the API's base path with a trailing `/api` removed, so `/` for an API at `/api`. That is where the SDK dials: it connects to its `baseUrl`, while its HTTP requests go to `${baseUrl}/api`. An upgrade to any other path is left to the server's other `upgrade` listeners, so your app can run its own WebSocket server on the same `http.Server`. With no other listener, such an upgrade is answered `404`.

In a [custom server](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` sets the path, and the Postgres adapter's `realtime.path` overrides what the server derived.

> By default, Rebase also emits realtime events for writes made **outside** the API (via `psql`, another service, or Studio's SQL editor) whenever the database connection supports it — see [database-level change capture](/docs/backend/realtime-cdc/).

## Typed SDK Subscriptions

The Rebase typed SDK exposes two subscription methods on every collection accessor:

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
    orderBy: ["createdAt", "desc"],
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
  (row) => {
    if (row) {
      console.log("Product updated:", row.name);
    } else {
      console.log("Product was deleted");
    }
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

The callback receives the row, flat, as `findById()` returns it (`row.name`, not `row.values.name`), or `undefined` once the row is deleted.

**Each frame carries the row's version.** `etagOf(row)` is the `ETag` a `GET` of the row answers, so an edit made against what a frame showed can be saved with `ifMatch: etagOf(row)` and is refused with `412` if the row has moved on (see [Conditional writes](/docs/backend/writes/)). On the wire, the SDK's `subscribe_one` asks with `etag: true`, and each `single_update` frame for a row that exists carries `"etag"` beside `"row"`. A server that predates this ignores the ask and sends no tag, and a client that does not ask gets frames without one.

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
  .orderBy("createdAt", "desc")
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
   also coalesces a burst of writes into one query. It waits for 300 ms without
   a further change, but never more than **1 s** (`REFETCH_MAX_WAIT_MS`) after
   the first one, so a collection written several times a second still sends
   its subscribers a frame at least once a second. Set that bound with `REALTIME_REFETCH_MAX_WAIT_MS` (or `realtime.refetchMaxWaitMs`): higher refetches a busy table less often, lower sends fresher frames.

   A refetch that reads exactly what a subscriber was last sent sends that
   subscriber nothing: a write to row 9,000 of a list showing the first 50 costs
   the read, not a frame to every viewer. After an error frame, the next rows
   are sent again even if they are the same.

Earlier versions sent an immediate `collection_patch` carrying the written row
before this refetch, for sub-millisecond cross-tab feedback. That row had been
read under the writer's scope, so it could — and did — reach subscribers whose
own policies would have denied it, and the subscription's own `where` filter was
not applied to it either. The patch has been removed: perceived latency for an
update is now the debounce window.

### The refetch is the REST read

The refetch runs the same pipeline `GET /api/data/<collection>` runs, with the
same `include` handling. That is what makes `find({ q })` and `listen({ q })`
return rows that are equal field for field.

It used to be a different method — one that nested each relation under a
`{ "__type": "relation" }` envelope and, because a subscription could carry no
`include`, eagerly loaded **every** relation the collection declares. So the same
query answered in one shape over HTTP and another over the socket, and a client
rendering both saw its rows change shape the moment a write landed.

A subscribe frame therefore takes what a list request takes: `filter`,
`logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` and
`fields`. `vectorSearch` is the exception and is **refused** with
`VECTOR_SEARCH_NOT_LIVE` — a subscription is re-run on every matching write and
nothing there computes distances.

### `collection_update` carries its own metadata

The frame is `{ rows, pks, meta }`:

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` is counted inside the same RLS-bound transaction that read the rows, so
it describes exactly the rows beside it. Without it, a client needing a total
had to issue a `GET /count` **per push** — one extra round trip per write, per
subscriber, and a window in which the count and the rows described different
states of the collection.

When the count itself fails, the frame carries `partial: true` and no `total`;
that is not a subscription error, and a client should keep the last real total
rather than substituting the page length. On a big table the count is most of what a frame costs. With `REALTIME_RECOUNT_INTERVAL_MS` set, a list whose last total was at least `REALTIME_RECOUNT_MIN_ROWS` (100,000 by default) reuses that total for the interval instead of counting on every write, and such a frame carries `meta.totalAsOf`, when the total was taken. Unset, as by default, every frame counts.

### What a write costs, and the limits

Because every frame is a query run as its subscriber, the cost of a write grows
with the number of **distinct questions asked by distinct principals** on the
collection it touched — not with the number of open sockets:

- Subscriptions that ask the same question (same path, filters, sort, page,
  `include`, `fields`, search) as the same principal (same user id, roles,
  guest flag and claims) share one refetch. A write to a list costs **one
  transaction per such group** — the read and its count — however many sockets
  hold it; every member still gets a frame built from rows read under that
  identity. A first page that comes back shorter than its `limit` is the whole
  set, so it is not counted at all.
- A single-record subscription is asked only when its own record changes.
- Different principals never share a read — that is what keeps a frame from
  carrying a row its reader may not see. A list watched by a thousand
  different signed-in users is a thousand reads and a thousand counts on every
  write to it, in a thousand transactions.

Measured on a laptop against a local PostgreSQL with a 20-connection pool, one
write to a list:

| Subscribers | Transactions for the write | Last frame after the write |
|-------------|----------------------------|----------------------------|
| 1,000, one principal | 2 | ~310 ms |
| 1,000, each a different principal | ~1,000 | ~600 ms |

300 ms of each is the debounce. The second row is the ceiling to plan for. The
refetches run on the same pool as your REST traffic, but at most a quarter of
its connections at a time (5 of the default 20, never fewer than 2); the rest
wait their turn in the server, so a write's fan-out delays its own frames
rather than your requests. A collection written several times a second while
**hundreds of different users** watch the same list is where those frames
start to lag. Beyond that, prefer narrower subscriptions (a page, a filter on
the user's own rows) or a [broadcast channel](#broadcast-channels) carrying the
change for clients to re-fetch on their own schedule.

**One socket may hold at most 1,000 subscriptions.** The next is refused with an error frame coded `TOO_MANY_SUBSCRIPTIONS`; re-subscribing under an id the socket already holds replaces that subscription and does not count again. The SDK shares identical subscriptions on a socket, so this counts the distinct lists and records a page has open. Change it with `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` or `realtime.maxSubscriptionsPerSocket` on the Postgres adapter (the environment variable wins); a value that is not a positive whole number stops the server at boot. On 0.23 a socket's subscriptions are not limited. **The sockets one user holds can be limited too**, per server instance: set `REALTIME_MAX_SOCKETS_PER_USER` (or `realtime.maxSocketsPerUser`), and a sign-in past it is refused with `TOO_MANY_SOCKETS` and the socket closed with 4002. The SDK tells every live subscription and `onConnectionLost` at once, with a `CONNECTION_LOST` error whose `details.reason` is `TOO_MANY_SOCKETS`, and keeps retrying, waiting longer each time up to 30 s, so the tab gets in once another socket closes. Unset, as by default, there is no ceiling.

A subscription id is the socket's own: two clients that both name a subscription `"sub-1"` each keep theirs, and an `unsubscribe` ends only the sender's.

**Subscribing counts against the data rate limit.** A subscription's first frame is a read, run as the subscriber, and so is a channel's history request. So `subscribe_collection`, `subscribe_one` and `channel_history` count as data requests in the caller's rate-limit bucket (the one their HTTP requests and their other sockets share) once the socket's own allowance is spent. Each socket may send 1,000 of them without counting them, or as many as its subscription ceiling when that is higher, and the allowance comes back over 15 minutes. That is everything a socket can hold, so the re-subscribe after a reconnect is never refused and never spends the person's budget. Past the allowance, a frame over the limit is refused with an error frame coded `RATE_LIMITED`, which the SDK delivers to that subscription's `onError`, or to the channel's. On 0.23 these frames count only against the socket's own budget of 2,000 frames a minute.

### Sockets that stop answering

A client can vanish without closing its socket: a phone loses
signal, a laptop goes to sleep, a NAT forgets the connection. No close frame
arrives, so nothing tells the server. The server therefore pings every socket
every 30 seconds and terminates one that has not answered by the next ping, so
a vanished client is let go of within a minute. Browsers and the SDK answer
pings on their own; a client that speaks the protocol directly has to answer
them too, as most WebSocket libraries do.

**The browser side.** A browser cannot send a ping or see one, so a half-open socket looks connected to it forever. The SDK opens the socket with `?rebase_caps=heartbeat,channel_seq,cancel_sql`; a server that knows them answers with `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, listing the ones it honours (`cancel_sql`: it takes the SQL console's `CANCEL_SQL` frame), and sends `{"type":"heartbeat"}` every 30 seconds, and the SDK drops the socket and [reconnects](#auto-reconnect) after two missed. A client that names nothing is sent neither, and an older server ignores the parameter, so an SDK talking to one behaves as before.

A socket is also terminated when more than 16&nbsp;MiB of frames sent to it are
still unread. That is a client that does not read what it is sent, or one so far
behind that what it would read is stale. And when a server's sockets together
hold more than 256&nbsp;MiB unread (or a quarter of the memory limit the server
runs under, when that is smaller), the ones with the most unread are terminated
first, until the rest fit.

A terminated socket is cleaned up like a closed one. Its subscriptions end, it
leaves its channels, and its presence is removed, with the departure announced
to the other members. A client that is still there sees the connection drop,
and the SDK [reconnects](#auto-reconnect) and subscribes again. On 0.23 such a
socket stays open until the operating system gives up on the connection (about
two hours on Linux), and every write to a collection it subscribes to still
costs a refetch for it.

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

:::caution[Where this goes]
**Managed runtime: nowhere.** Channel retention and `realtime.bus` are part of
the database adapter the managed runtime constructs itself, and neither has an
environment form. Eject to configure them.
**Ejected:** `createPostgresAdapter({ realtime })` in `backend/src/index.ts`.
:::

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

- **Ordered.** Sequence numbers are allocated per channel, and delivery order matches sequence order — on one instance, and across instances on the `postgres` bus, where the statement that numbers a message also announces it, so every instance (the sender's included) receives the announcements in sequence order. A bus you supply yourself carries frames in whatever order it delivers them.
- **Durable before delivered.** A message that cannot be stored is not delivered to anyone, and the sender is told. Delivering it would put it in front of live subscribers while leaving it out of every future replay, and no later message could repair that gap.
- **At-least-once on catch-up.** A replay range may overlap messages a client already received; the SDK discards ones it has already delivered.
- **No holes.** A retained message reaches every member: the sender, who is never sent its own message, is sent `{"type":"broadcast_ack","channel","seq"}` instead when it opted into `channel_seq`. So a message past `lastSeq + 1` means one was missed, and the SDK holds it back, asks for the history in between, and delivers all of them in order. Against a server without `channel_seq`, a jump is delivered as it arrives.

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

When a client sends `presence_track`, the server automatically joins them to the channel (no separate `join_channel` needed) and broadcasts a `presence_diff` to all channel members. The SDK re-sends its state every ~20 seconds as a heartbeat; a heartbeat whose state is unchanged only refreshes the client's timeout and sends no `presence_diff`.

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

The typed SDK automatically reconnects when the WebSocket connection drops:

- **Exponential backoff** — Each redial waits for a step that starts at 2 seconds and doubles each time, up to 30 seconds. The delay is drawn at random from anywhere in its step, but never under a quarter of a second, so clients dropped together by a deploy come back spread across the whole step rather than at the same instant.
- **No give-up while anything is live** — While a subscription or a joined channel exists, the client keeps redialling at the 30-second ceiling for as long as the outage lasts. With nothing registered it stops after 5 failed attempts, and the next subscription dials again. In a browser, the `online` event and the tab becoming visible again both redial at once instead of waiting out the backoff.
- **Outages are reported once** — When the connection has been down for 14 seconds, however many redials that took, every live subscription's `onError` and every joined channel's `onError` receives one `RebaseApiError` with code `CONNECTION_LOST`. The subscription is **kept**: the error says its data is not updating, not that it has ended.
- **Automatic resubscription** — On successful reconnect, all active subscriptions are re-registered with the server, and each one's next `onUpdate` carries whatever was written while the client was away. That update is the recovery signal. No manual intervention needed.
- **Requests are at-most-once** — A request made while the socket is down waits for it, for up to 30 seconds from the call, and then fails with `REQUEST_TIMEOUT` without ever being sent. A request that was already sent when the connection dropped fails with `CONNECTION_LOST` and is **not** sent again: the server may or may not have run it, and only the caller knows whether running it twice is safe.

`client.ws.state` says where the connection is, and `onStateChange` is told every
change. On 0.23 neither exists, the client stops after 5 failed attempts, and
messages sent while disconnected are queued and sent after reconnecting:

| State | Meaning |
|---|---|
| `idle` | No socket, and none wanted yet (the connection is lazy), or a sign-out dropped it. |
| `connecting` | Dialling, with no outage in progress. |
| `connected` | The socket is open. |
| `reconnecting` | The socket dropped and the client is redialling. Nothing has been reported yet. |
| `disconnected` | The outage has lasted about 15 seconds or more. `CONNECTION_LOST` has been reported, and the client keeps redialling. |
| `closed` | `client.close()` was called. Final. |

```typescript
// `ws` is undefined on a client built without realtime, so narrow it once.
const ws = client.ws;
if (ws) {
    ws.onStateChange((state) => {
        showOfflineBanner(state === "disconnected");
    });
    ws.on("connect", () => console.log("Connected"));
    ws.on("disconnect", () => console.log("Disconnected"));
    ws.on("reconnect", () => console.log("Reconnected"));
    ws.on("error", (error) => console.error("Error:", error));
}
```

The Rebase admin shows a banner of its own while the state is `disconnected`, and keeps the rows and records already on screen instead of replacing them with an error.

## Authentication & RLS

WebSocket subscriptions automatically respect Row-Level Security (RLS) policies. When the client is authenticated:

1. The WebSocket connection authenticates using the same JWT token as the REST API.
2. Every subscription refetch runs inside a PostgreSQL transaction with `set_config('app.user_id', ...)` and `set_config('app.user_roles', ...)` — ensuring RLS policies are enforced.
3. The identity is checked again for as long as the socket is open, not only when it authenticates. Before each frame the server asks what an HTTP request would ask: is the token still valid, was its session signed out or revoked, does the account still exist, and which roles does it hold now. Channel frames are asked at most once a second. Frames that arrive on one socket while its check is still under way — a client re-sending its subscriptions after a reconnect — share that check rather than each asking again; the next frame after it settles asks afresh. A socket that only listens is asked at least every 30 seconds, and a token stops being honoured at the instant it expires. A role taken away applies from the next frame (or, for a frame that shared a check already under way, from the one after), to reads, writes and open subscriptions alike. A socket whose identity has ended receives an `AUTH_ERROR` frame and is closed with code `4001`. With the built-in auth the frame's code says why, as the HTTP routes say it: `SESSION_REVOKED` (signed out, revoked, or the account deleted), `ACCOUNT_DISABLED` or `TOKEN_EXPIRED`; another auth adapter's is `SESSION_ENDED`. An `AUTHENTICATE` for a revoked session or a disabled account is refused with `SESSION_REVOKED` or `ACCOUNT_DISABLED` (a token that does not verify, or has expired, with `INVALID_TOKEN`). The SDK does not ask again with the same token, and hands the refusal, code included, to the `onError` of whatever needed the account. The SDK authenticates its socket again each time it refreshes its token; a new token for the same identity (the same user id, roles, guest flag and claims) leaves the open subscriptions as they are, and one for a different identity refetches each of them as it. After a `4001` it reconnects with the session it holds then, or with none. A client speaking the protocol directly has to send a fresh token in `AUTHENTICATE` before the old one expires.

This means each socket only receives updates for records its authenticated identity may see.

An [API key](/docs/backend/api-keys/) authenticates the socket too: send the
`rk_…` key where the access token would go. The socket then checks each frame
against the key's [scopes](/docs/backend/roles-and-scopes/): a fetch, a count or a
subscription needs `data:read` on its collection, a save `data:write`, a delete
`data:delete`. A nested path needs the plain scope. Channels (broadcast and
presence) are refused for a key, because no scope covers them. The SQL editor and
branch messages need `database:read` or `database:write`, for a key and a person
alike.

Running more than one instance — the LISTEN/NOTIFY bus, what presence does
across processes, and writing your own transport — has a page of its own:
[Realtime across instances](/docs/backend/realtime-transports/).

## Database-Level Change Capture (CDC)

Every committed write emits realtime events, however it was made: REST, the
SDK, Studio, `psql`, a cron job in another service. How the capture works, the
`REALTIME_CDC` setting and what it needs: [Database change capture](/docs/backend/realtime-cdc/).

## Pending Request Timeout

To prevent client requests from hanging indefinitely, all pending WebSocket operations that expect a server response (such as one-shot collection fetches `FETCH_COLLECTION`, single entity fetches `FETCH_ONE`, creating/updating `SAVE`, deletes `DELETE`, counts `COUNT`, and uniqueness checks `CHECK_UNIQUE_FIELD`) have a default timeout of 30 seconds.

If the server does not respond within this 30-second window, the client automatically deletes the pending request and rejects the promise with an `ApiError` with the message `"Request timed out"`.

One-way messages that do not expect a response (like `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, and `presence_state`) resolve immediately upon transmission and do not trigger timeouts.

### When a channel frame is refused

A channel frame is fire-and-forget: `await channel.broadcast(...)` resolves when
the frame is written to the socket, **not** when the server has accepted it. That
is deliberate — a collaborative app broadcasts a cursor position sixty times a
second, and waiting for an acknowledgement on each would make every one a round
trip.

So a refusal cannot be a rejected promise. It arrives on `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Code | Means |
|------|-------|
| `CHANNEL_FORBIDDEN` | You are not a member of the channel — join it before broadcasting or reading its history |
| `RATE_LIMITED` | Past the channel frame budget above, or, for a history request, past the [data rate limit](#what-a-write-costs-and-the-limits) |
| `CHANNEL_HISTORY_WRITE_FAILED` | A retained broadcast could not be persisted, so it was dropped |
| `CHANNEL_HISTORY_READ_FAILED` | A catch-up request could not be served |
| `CHANNEL_HISTORY_GAP` | Raised by the client: a catch-up found that the server no longer retains messages this client never received. `details` is `{ from, to }`, the sequence numbers missed. Resync the channel's state from its source of truth |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | The broadcast reached this instance only — see [The 8 KB limit on the Postgres bus](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

With no handler attached, these are logged as a warning. They used to be
discarded entirely: there was no promise to reject and no channel to deliver to,
so a forbidden broadcast was indistinguishable from a delivered one.

## Next Steps

- [Typed SDK](/docs/sdk) — Full SDK reference including typed collection accessors.
- [Authentication](/docs/backend/authentication) — Set up JWT auth and RLS policies.
- [Backend Architecture](/docs/backend) — Overview of the Rebase server architecture.
