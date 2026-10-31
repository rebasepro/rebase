---
title: Realtime Subscriptions
sidebar_label: Realtime
description: Subscribe to live data changes with the Rebase typed SDK using WebSocket-based realtime listeners.
---

## Overview

The Rebase typed SDK provides real-time data subscriptions via WebSocket. When records change on the server, your subscribed callbacks fire immediately with the updated data.

The WebSocket connection is established automatically when a `websocketUrl` is available (derived from `baseUrl` by default). Reconnection and token refresh are handled for you. An outage that lasts more than about 15 seconds is reported once, to each subscription's `onError`, as `CONNECTION_LOST` — see [Authentication and Reconnection](#authentication-and-reconnection).

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

### Signature

```typescript no-verify
listen(
    params: FindParams<M> | undefined,
    onUpdate: (result: FindResult<M>) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

`FindResult<M>` is the same shape `find()` returns: flat rows in `data`, and
`{ total, limit, offset, hasMore, nextCursor }` in `meta`.

### `listen()` takes what `find()` takes

`params` is a full `FindParams`. A subscription is the same query as the
`find()` beside it, so it accepts the same narrowing — `where`, `logical`,
`orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** and
**`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

That matters more than it sounds. `include` and `fields` used to be silently
dropped here, so the same query answered in one shape through `find()` and
another through `listen()` — and a component rendering both saw its rows change
shape the moment a write landed. They now go through the identical read
pipeline, so `find({ q })` and `listen({ q })` return rows that are equal field
for field.

The exception is `vectorSearch`, which is **refused** rather than dropped: a
subscription is re-run on every matching write and nothing there computes
distances. Use `.vectorSearch(…).find()` for the query and subscribe without it.

### One emission per change

Each server push calls your callback **once**, with metadata that describes the
rows beside it. There is no separate first-paint emission and no flag to check.

The metadata arrives **in the same frame as the rows**: the server counts the
query inside the same row-level-security-bound transaction that read them, so
`meta.total`, `meta.hasMore` and `meta.nextCursor` describe exactly the rows
next to them. (Every push used to be followed by a `GET /count` from the client
— one extra round trip per write, per subscriber, and a window in which the
count and the rows described different states of the collection.)

Two fallbacks, neither of them a subscription error and neither calling
`onError`:

- If the server's **count failed**, the frame carries no total and the last one
  that did arrive is reused. A failed count says nothing about how big the
  collection is, so it must not overwrite a real answer.
- If no total has ever arrived for this subscription — an older server that
  sends no metadata at all — the client asks once, on the first push. If that
  also fails, `meta.total` is a **lower bound**: the rows on this page plus the
  ones paged past to reach them.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## Subscribing to a Single Entity

Use `listenById()` to watch a specific record by its ID:

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

### Signature

```typescript no-verify
listenById(
    id: string | number,
    onUpdate: (row: M | undefined) => void,
    onError?: (error: Error) => void,
    options?: { include?: IncludeSpec }
): () => void   // returns unsubscribe function
```

The callback receives a flat row — not an `Entity`, so there is no `.values` —
and `undefined` when the record is deleted.

Each frame carries the relations `options.include` names, loaded as `find({ include })`
loads them into each row of a list. A to-many relation not named there is absent
from the row, not empty:

```typescript
client.data.posts.listenById(1, (post) => {
    console.log(post?.tags); // the post's tags, on every update
}, undefined, { include: ["tags"] });
```

**Limits.** A frame is sent when the row itself changes, and each frame reloads its included
relations. A change to a related row alone sends no frame: editing a tag's name does not
refresh a post listened to with `include: ["tags"]` until the post changes too. To follow
the related rows, listen to their collection as well.

## Watching a Count

`listenCount()` keeps a count current: the total of what a list's filter matches, for a
toolbar or a "select all N" offer that should not go stale while other people add and remove rows.
The callback runs with the total once it is known, and again whenever a write changes it.

```typescript
const stop = client.data.orders.listenCount(
    { where: { status: ["==", "open"] } },
    (total) => console.log(`${total} open orders`),
    (error) => console.error(error)
);
```

Only the filter counts — `where`, `logical` and `searchString`; a `limit`, an `offset` or a sort is
ignored. The server reads no rows for it, only the count, under the subscriber's identity like any
other frame. A server older than 0.25 does not know the request; it is answered with one row and the
same total, and the SDK reads the total from that. On a client with no socket, `listenCount()` is a
stub that throws, as `listen()` is. With [offline support](/docs/sdk/offline/) on, the count is the
server's: queued writes are not in it until they replay.

## Fluent Query Builder

You can also subscribe through the fluent query builder. This is equivalent to calling `listen()` with params, but lets you chain `.where()`, `.orderBy()`, etc.:

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

A subscription takes a multi-column sort like any other query — either
`orderBy: [["category", "asc"], ["createdAt", "desc"]]` in the params, or a
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

- On **sign-in** or **token refresh**, an already-open socket takes the new credential. A refresh, or a sign-in as the account it already holds, sends the token in an `authenticate` message; a sign-in as a different account — a visitor signing in included — rebuilds the socket, which authenticates as that account and re-sends every live subscription and channel. If none is open, nothing happens — signing in is not a request for realtime, and a socket opened later authenticates itself.
- On **sign-out**, the WebSocket connection is disconnected. The client stays usable; a later subscription reconnects anonymously.
- If the connection drops, the client **reconnects automatically** and re-establishes all active subscriptions. It never stops trying while a subscription or a joined channel exists; the delay between attempts grows to at most 30 seconds.
- If the server ends the socket's session — the user signed out everywhere, this session was revoked, the account was deleted, or the token expired before a refresh reached the socket — it closes the socket with code `4001`. The client reconnects like after any drop, authenticating with the session it holds then (refreshed if it can be), or anonymously when there is none. A role taken away does not close the socket: it applies from the next frame. See [Authentication & RLS](/docs/backend/realtime/#authentication--rls).
- If the connection stays down for more than about 15 seconds, each subscription's `onError` (and each joined channel's `onError`) is called **once** with a `RebaseApiError` whose `code` is `CONNECTION_LOST`. The subscription is not ended: keep showing what you have, mark it as possibly stale, and wait. When the socket is back, the subscription's next `onUpdate` carries everything written in the meantime.
- `client.ws.state` is the connection's state — `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` or `closed` — and `client.ws.onStateChange(listener)` is told every change. `disconnected` is the state in which `CONNECTION_LOST` has been reported.
- Requests sent over the socket are **at-most-once**. One that was sent when the connection dropped fails with `CONNECTION_LOST` and is never sent again, since the server may already have run it. One that is still waiting for a socket after 30 seconds fails with `REQUEST_TIMEOUT` without being sent.

Everything in the list after sign-out arrived in 0.24. On 0.23 the client gives up after
five failed reconnection attempts, queues requests made while disconnected and
sends them on reconnect, has no `client.ws.state`, and the server never closes a
socket whose session has ended.

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

### Which token the socket sends

On 0.24 the
socket uses only the client's own session and the `token` option: a getter
installed with `client.setAuthTokenGetter()` never reaches it, so a host using
its own auth provider gets an anonymous socket.

The socket authenticates with the same token an HTTP request would carry. That
is the getter installed with `client.setAuthTokenGetter()` first; when there is
none, or it answers `null` or throws, it is the token the client holds: its
session's, one set with `client.setToken()`, or the `token` option. With the
built-in `client.auth` there is nothing to wire.

For an external auth provider (Clerk, Firebase Auth, a session of your own),
install the getter once. It covers HTTP and the socket:

```typescript
client.setAuthTokenGetter(() => provider.getToken());

// Optional: let the provider recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await provider.refresh();
    return true; // retry with the token resolved again
});
```

- `client.setOnUnauthorized(handler)` answers a refused token on both: a 401
  over HTTP, and an auth error on the socket. Resolve `true` to retry with the
  token resolved again. It replaces the client's own session refresh.
- Installing a getter, or calling `client.setToken()`, rebuilds an open socket:
  the new one authenticates with the new credential and re-sends every live
  subscription and channel as it, and nothing the previous identity held
  carries over. With no socket open, the next one authenticates itself.
- `client.ws.setAuthTokenGetter()` is deprecated. It still works, replacing
  only the socket's getter, and warns once. Use `client.setAuthTokenGetter()`.

See [Using your own auth provider](/docs/sdk/authentication#using-your-own-auth-provider).

### The connection is lazy

Creating a client opens **no** WebSocket. It is dialled on the first operation that actually needs one — a `listen()` / `listenById()` subscription, or a channel operation such as `join()`, `track()` or `broadcast()`. Obtaining a channel is not using it.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

This matters for apps with meaningful signed-out traffic — marketing pages, public read-only views, anonymous-first tools — which previously paid a connection on every page load simply to have realtime available.

Two related behaviours:

- `realtime: false` remains a hard opt-out: no socket ever, and `client.realtime.channel()` throws. So do `listen()` and `listenById()` — they are always there to call, and on a client with no socket they throw a `RebaseClientError` naming the option that would enable them. `observe()` does not: it degrades to a single fetch.
- `client.close()` is final. It releases the socket and its reconnect timer, and nothing queued afterwards will redial. In Node, an open socket keeps the event loop alive, so a script that never calls it will not exit on its own.

### Keeping a group on one instance

With more than one server instance, members of a channel can land on different instances, and every message between them then [crosses the channel bus](/docs/backend/realtime-transports/#channels-and-presence-across-instances). `affinity` names the group a socket belongs to, such as a room or a document, so a platform can send the whole group to the same instance:

```typescript
const client = createRebaseClient({
    baseUrl,
    realtime: { affinity: roomCode }
});
```

When the key is only known later, set it before the socket opens:

```typescript
const client = createRebaseClient({ baseUrl });

client.realtime.setAffinity(roomCode);          // no socket yet
await client.realtime.channel(roomCode).join(); // opens with the key
```

The key goes on the socket's address as `?affinity=`, and it replaces one already on a `websocketUrl` you set. `setAffinity(null)` clears it.

- **It's an optimisation.** Rebase Cloud routes on it when a project runs more than one instance. Self-hosted, or behind a proxy that doesn't hash on it, it does nothing, and channels work the same: the bus still carries whatever spans instances, a group that is split by a scale-up included.
- **It takes effect when the socket connects.** A socket already open stays where it is, and uses the new key the next time it connects. To move a client that is connected, make a new one, or set the key before its first `join()` or `listen()`.
- **It decides where a socket lands, not what it may join.** Access to a channel doesn't depend on it, and the address ends up in access logs, so use a code rather than a secret or anything personal.

To see whether it works, compare what each instance publishes and skips: see [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

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

Your own messages are filtered out of a replay, as they are live, including ones sent before a reconnect gave the socket a new client id: the channel remembers the ids it broadcast from. A new channel object — after a page reload, say — remembers none, so a catch-up there delivers your earlier messages like anyone else's, which is what rebuilding state from history needs.
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
