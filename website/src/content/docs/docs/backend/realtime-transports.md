---
title: Realtime across instances
sidebar_label: Realtime across instances
description: "How broadcast channels and presence survive more than one server process: the LISTEN/NOTIFY bus, what each instance owns, and writing your own transport."
---

## Cross-Instance Broadcasting & LISTEN/NOTIFY Architecture

For multi-instance cluster environments (e.g., running inside Kubernetes or Docker containers behind a load balancer), Rebase relies on PostgreSQL `LISTEN/NOTIFY` to synchronize **row changes** across instances. Collection and entity subscriptions therefore span instances with no configuration — that is what this section describes.

**Broadcast channels and presence are separate**, and are per-instance until you turn on a channel bus. See [Channels and presence across instances](#channels-and-presence-across-instances) below.

### Bypassing pgBouncer Pools

Because connection poolers like **pgBouncer** do not support the persistent connection model required for long-lived SQL `LISTEN` sessions, the real-time supervisor opens a dedicated, unpooled Postgres client (`PgClient`) directly to the database. This direct connection utilizes the `DATABASE_DIRECT_URL` environment variable if configured, ensuring stability and preventing pool exhaustion or abrupt drops.

### Notification Mechanics & Payload Layout

When a record is modified on Instance A, it broadcasts a notification on the `rebase_entity_changes` channel. To minimize database overhead and network bandwidth, the notification payload is kept extremely compact:

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

The transport can also be set per deployment with
`REALTIME_CHANNEL_BUS=memory|postgres`, so it can be changed without a rebuild.
It overrides a **named** built-in (`bus: { type: "memory" }`), and is
deliberately **ignored** when `realtime.bus` was handed a constructed
`ChannelBus` *instance* — the variable can only name transports this package
knows how to build, so honouring it there would mean silently discarding the
object the application supplied. That case logs a warning naming both, and an
unrecognised value falls back to whatever was configured rather than to memory.

### Why there is no Redis option in the box

Rebase deploys as Postgres + backend + frontend. A bus that needed a message broker would put a second stateful service into every `docker-compose.yml` the CLI scaffolds, for a feature most applications never use — so the bar for adding one is that the database genuinely cannot carry the load.

It can. Measured across two backend instances against a single Postgres container, the Postgres bus delivered **~10,000 cross-instance messages per second with no losses**, and stayed flat out to **eight instances** (14,000 deliveries, no losses). Twenty people dragging cursors at 60 fps generate around 1,200 messages per second — roughly an eighth of that.

The limit worth watching is not capacity, it is that every notification is a query against your primary database, competing with your application's real queries. The Postgres bus therefore **coalesces** outgoing frames (see below), which is what keeps that cost proportional to elapsed time rather than message count.

Per client, the socket accepts up to **7,200 channel frames a minute** (120/s — 60 fps of cursor broadcasts plus the presence update each one carries), counted separately from the budget queries and subscriptions share. Frames past that are refused with a `RATE_LIMITED` error rather than queued.

The refusal arrives on `channel.onError()`, not as a rejected `broadcast()` — see [When a channel frame is refused](#when-a-channel-frame-is-refused).

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
- **On an ephemeral channel** there is nothing to point at. The broadcast is delivered locally, the sender receives a `CHANNEL_BUS_PAYLOAD_TOO_LARGE` error on `channel.onError()`, and a warning names the channel — rather than the message silently reaching half the cluster.

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

## Next Steps

- [Realtime & WebSocket](/docs/backend/realtime/) — subscriptions, channels and presence on one instance
- [Split Processes](/docs/deployment/split-processes/) — the deployment shape this matters for
- [Self-hosting](/docs/deployment/self-hosting/) — running the runtime yourself
