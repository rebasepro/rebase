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
    { where: { active: ["==", true] }, limit: 50 },
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
        where: { status: ["==", "pending"] },
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

```typescript no-verify
listen(
    params: FindParams | undefined,
    onUpdate: (response: FindResponse<M>) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

### Two-Phase Meta

When `listen()` fires, it emits updates in up to two phases:

1. **Immediate (estimated):** The first callback fires instantly with the entities and heuristic pagination metadata (`total` = number of returned entities, `hasMore` = whether the count equals the requested limit). This emission carries `meta.total: true`.

2. **Authoritative (optional):** An async count query runs in the background. If the authoritative `total` or `hasMore` differs from the estimate, a second callback fires with corrected metadata and **no** `estimated` flag. If the values match, the second emission is skipped entirely — your callback fires only once.

If the count query **fails**, no second emission occurs. The first emission's `estimated: true` flag remains as the signal that the metadata is heuristic. This is not treated as a subscription error.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (response) => {
        if (response.meta.total) {
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
// The SDK hands back a flat row, not an `Entity` — there is no `.values`.
const unsubscribe = client.data
    .collection<{ id: number; name: string }>("products")
    .listenById!(
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

### Signature

```typescript no-verify
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

A subscription takes a multi-column sort like any other query — either
`orderBy: [["category", "asc"], ["created_at", "desc"]]` in the params, or a
second `.orderBy()` call, which adds a tie-breaker rather than replacing the
first. See [Sorting](/docs/sdk/querying#sorting).

The server checks the *shape* of a subscription's `orderBy` on arrival and
refuses a malformed one with an error frame rather than subscribing. A sort it
could not read would otherwise stream rows in no order at all while reporting
nothing wrong — and a `collection_update` frame carries rows and nothing else,
so a subscriber has no way to notice.

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
        { where: { active: ["==", true] } },
        (response) => setProducts(response.data)
    );
    return () => unsubscribe();
}, []);
```

## Authentication and Reconnection

The WebSocket client handles authentication automatically:

- On **sign-in** or **token refresh**, the new token is sent to an already-open socket via an `authenticate` message. If none is open, nothing happens — signing in is not a request for realtime, and a socket opened later authenticates itself.
- On **sign-out**, the WebSocket connection is disconnected. The client stays usable; a later subscription reconnects anonymously.
- If the connection drops, the client **reconnects automatically** and re-establishes all active subscriptions.

No manual token management is needed — the integration between `client.auth` and the WebSocket layer is handled internally.

### The connection is lazy

Creating a client opens **no** WebSocket. It is dialled on the first operation that actually needs one — a `listen()` / `listenById()` subscription, or a channel operation such as `join()`, `track()` or `broadcast()`. Obtaining a channel is not using it.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

This matters for apps with meaningful signed-out traffic — marketing pages, public read-only views, anonymous-first tools — which previously paid a connection on every page load simply to have realtime available.

Two related behaviours:

- `realtime: false` remains a hard opt-out: no socket ever, and `client.realtime.channel()` throws.
- `client.close()` is final. It releases the socket and its reconnect timer, and nothing queued afterwards will redial. In Node, an open socket keeps the event loop alive, so a script that never calls it will not exit on its own.

## Broadcast Channels

Broadcast channels let you send arbitrary messages between connected clients — ideal for chat, notifications, or collaborative features:

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

Channels are lightweight and ephemeral — they exist as long as at least one client is subscribed. Repeated `channel()` calls with the same name return the **same** object, so two components can attach handlers independently without either cutting the other off by leaving.

Channel and presence frames do not require an account: anonymous visitors can join public channels.

:::caution[Channels have no access rules yet]
The only check the server applies is **membership**: to broadcast into a channel, read its presence roster or replay its history, a client must have joined that channel first. Joining itself is open — any client that can name a channel can join it, whether or not it is signed in.

So a channel name is not a secret and is not a permission. Do not put anything in a channel (including retained history and presence state) that every user of your app may not see, and do not derive a channel name from data you would not hand out. Per-channel authorization rules are not implemented; if you need them today, keep the sensitive half of the exchange on `client.data`, where row-level security applies.
:::

> **By default, broadcasts are not replayed.** They reach currently-connected members only. That is what you want for notifications that self-correct — a "someone saved" nudge is superseded by the next save — and it costs nothing. For an operation stream, where a silent gap causes divergence, enable [message history](#message-history-and-catch-up) on the channel.

## Message History and Catch-Up

A channel can be configured to keep its broadcasts, so a client that reconnects catches up on what it missed instead of resyncing from scratch. This is what makes channels usable as a transport for collaborative editing.

Retention is configured **on the server**, per channel pattern — see [Realtime Backend](/docs/backend/realtime#channel-retention). A client cannot turn it on for itself, because a channel is created by whoever names it, and a client-chosen history depth would let any visitor commit your backend to unbounded storage.

On a retained channel, pass `{ history: true }` and the SDK does the rest:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

On `join()` and after every reconnect, the SDK asks the server for everything after the last sequence number it saw, and delivers the result through the same handlers. There is no second code path to write: a handler that applies an operation correctly when live applies it correctly on catch-up.

### Sequence numbers

Every broadcast on a retained channel carries a `seq` — per-channel, gapless, and increasing. It is the client's resume point.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Persist `channel.sequence` if you want catch-up to survive a page reload as well as a reconnect, and pass it back via `history({ sinceSeq })`.

### Fetching history explicitly

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` means the channel keeps no history and never will — an explicit answer, so you can tell "you missed nothing" apart from "this channel has no retention rule". In the second case a client that needs to converge has to fall back to a full resync.

`latestSeq` is the highest sequence the server holds, whether or not this batch reached it. If it is far beyond your last delivered `seq`, you are further behind than one page and resyncing may be cheaper than paging.

:::note[Replays can overlap, and that is fine]
The server cannot know exactly which messages reached you before the socket dropped, so a catch-up range may include some you already applied. The SDK discards anything at or below the sequence it has already delivered, so handlers never see a message twice.

Your own messages are **not** filtered out of a replay: a reconnect assigns a new client id, so the very case catch-up exists for is the one where that filter would fail. Make operations idempotent if re-applying your own would be a problem.
:::

## Presence Tracking

Presence lets you track which users are online and sync shared state across all participants:

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

The SDK keeps the roster for you, so `presences` is always complete and you never reassemble it from diffs.

It also handles two protocol details that are easy to get wrong when working against the raw WebSocket:

- **The roster is not pushed on join.** A joining client's first `presence_diff` contains only itself; the existing roster must be requested explicitly. `join()` does that for you.
- **Presence expires after 30 seconds.** `track()` is not a durable registration — without a periodic re-send you silently disappear from everyone else's roster while still connected and still on the page. The SDK heartbeats at 20s, and stops on `untrack()` / `leave()`.

A reconnect also drops server-side channel membership and presence; the SDK re-joins, re-requests the roster and re-tracks automatically.

## When to Use Realtime

| Use Case | Method |
|----------|--------|
| Dashboard with live data | `listen()` with filters |
| Chat or messaging | `channel.broadcast()` |
| Collaborative editing / operation streams | `channel(name, { history: true })` |
| Typing indicators / online status | `channel.track()` + `channel.onPresence()` |
| Detail page with live updates | `listenById()` |
| Admin panel monitoring | `listen()` with `orderBy` and `limit` |
| A list that must survive a dropped connection | `observe()` with [offline](/docs/sdk/offline) enabled |

> **Tip:** For one-time data fetches, use `find()` or `findById()` instead. Subscriptions are best for data that changes frequently and needs to be reflected in the UI immediately.

## `listen()` vs `observe()`

Both keep a query current, and both return an unsubscribe function — but they answer different questions.

`listen()` is the socket: it delivers what the server pushes, and delivers nothing when the socket is down.

`observe()` is the query: with [offline](/docs/sdk/offline) enabled it emits from the local database first — before any request — and re-emits on local writes, on queued writes reaching the server, on rollbacks, and on realtime events, which it subscribes to itself unless you pass `{ realtime: false }`. Each result says whether it came from the cache and whether it carries writes the server has not accepted yet.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Without offline enabled, `observe()` is `find()` plus `listen()` in one call, with those flags always `false`.

## Next Steps

- **[Querying Data](/docs/sdk/querying)** — CRUD operations and query builder
- **[Offline & Local-First Sync](/docs/sdk/offline)** — Live queries that survive a dropped connection
- **[Authentication](/docs/sdk/authentication)** — Sign in and session management
- **[Realtime Backend](/docs/backend/realtime)** — Server-side WebSocket configuration
