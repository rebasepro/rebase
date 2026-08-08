# Audit 33 — the realtime channel bus, broadcast and presence

Read-only audit, 2026-08-08. Scope: `packages/server-postgres/src/services/channel-bus/**`,
`channel-presence.ts`, `channel-history.ts`, the channel half of `realtimeService.ts`,
`packages/server/src/services/routed-realtime-service.ts`, `packages/client/src/realtime-channel.ts`,
the channel paths in both `websocket.ts` files, and the published realtime docs.

## Verdict

The transport layer is the strongest part of this subsystem and it is genuinely good: the
`ChannelBus` contract is honest about what it does and does not guarantee, the Postgres
implementation's leading-edge coalescing is well-reasoned, the oversized-frame pointer path is
correct, the shared presence roster with `RETURNING`-based sweep ownership is a real solution to a
real problem, and the retained-channel sequence allocation takes the right row lock. The
established context checks out: the bus is opt-in via `realtime.bus`, the default is
`MemoryChannelBus`, and on multi-pod that means broadcast and presence reach only same-pod
subscribers. The docs say so plainly, which is more than most projects manage.

What is missing is everything *above* the transport. There is no channel authorization of any
kind — not a hook, not a config key, not a stub — yet three separate places in the code and the
docs assert that one exists and make security decisions on the strength of it: two internal tables
have their grants revoked "because the server evaluates channel rules before it reads", and the SDK
docs tell users "the server still authorizes every frame". Any client can read the presence roster
and replay the retained history of any channel it can name, without joining it. Alongside that,
three of the subsystem's four published guarantees do not hold as written (ordering across
instances, presence repair, error delivery to the sender), and the per-client WebSocket rate limit
sits two orders of magnitude below the cursor workload the capacity docs use as their headline
example — with the rejection frame silently discarded by the client. The correctness of the pipe is
not in question; the contract painted on it is.

Counts: 3 high, 4 medium, 5 low.

---

## HIGH

### H1. No channel authorization exists, and three places make security decisions assuming one does

**Where**
- `packages/server-postgres/src/services/realtimeService.ts:365-421` — the channel arms of
  `handleMessage`. `authContext` is threaded in from the socket
  (`packages/server-postgres/src/websocket.ts:628-639`) and is never read by any of them.
- `packages/server-postgres/src/services/channel-presence.ts:75-78` — *"The roster of every client
  on every channel, with no RLS — presence authorization is a channel rule, not a row policy.
  Revoke the schema-wide grant…"*
- `packages/server-postgres/src/services/channel-history.ts:202-207` — *"Retained broadcasts for
  every channel in one table, with no RLS: who may replay a channel is decided by the channel rules
  the server evaluates before it reads."*
- `website/src/content/docs/docs/sdk/realtime.md:213` — *"…and the server still authorizes every
  frame."*
- `website/src/content/docs/docs/backend/realtime.md:252` — *"Anyone who may join a channel may
  replay its retained messages."*

**What's wrong.** Grepping `authoriz|canJoin|canBroadcast|channelAuth` across
`packages/{server,server-postgres,types,client}/src` returns nothing for channels.
`RealtimeChannelsConfig` (`packages/types/src/types/backend.ts:292-303`) has exactly two keys,
`channels` and `bus`; neither is an access rule. The only gate anywhere on the channel path is the
blanket `requireAuth` check at `packages/server-postgres/src/websocket.ts:242-248`, which asks
"is this socket authenticated at all", not "may this principal touch this channel".

Worse, none of the four channel reads even require *membership*:
- `handleChannelHistoryRequest` (`realtimeService.ts:1443-1470`) never consults `this.channels`.
- `sendPresenceState` (`realtimeService.ts:1564-1580`) never consults `this.channels`.
- `broadcastToChannel` (`realtimeService.ts:1146-1168`) fans out to the channel's members without
  the sender being one.

So this is a class-30 finding twice over. The comments at `channel-presence.ts:76` and
`channel-history.ts:203` are the load-bearing ones: they are the stated justification for taking
these two tables *out* of the RLS model that protects every other table in `rebase.`, and the
mechanism they defer to ("the channel rules the server evaluates before it reads") was never built.
The docs sentence is the same claim pointed at users, and `docs/backend/realtime.md:252` describes
an access model — "anyone who may join" — that is strictly weaker than reality, because you do not
have to join.

**Failure scenario.** A collaborative editor with `realtime: { channels: [{ match: "doc:*",
limit: 500 }] }`. Any account on the system (or any visitor at all, on a deployment with no auth
adapter and `requireAuth` false) opens a socket and sends:

```json
{"type":"channel_history","payload":{"channel":"doc:42","sinceSeq":0,"limit":1000}}
```

and receives up to 1000 retained operations for a document their RLS policies forbid them from
reading through `client.data`. `{"type":"presence_state","payload":{"channel":"doc:42"}}` returns
every collaborator's client id and presence state, which in the documented usage carries user id,
display name and avatar. `{"type":"broadcast","payload":{"channel":"doc:42","event":"op",…}}`
injects a forged operation into everyone else's live stream. None of it is logged, and the
`channel_messages` row records the attacker only as an opaque `sender_id` client id.

**Fix direction.** A `realtime.authorizeChannel` hook shaped like the existing
`storageAuthorize` (`packages/server/src/init.ts:1283`), taking `(channel, user, action)` where
action ∈ join / broadcast / presence / history, evaluated once per `(clientId, channel)` in
`handleMessage` and cached on the membership entry. Default-allow preserves today's behaviour for
existing deployments; the boot warning should name it when a retention rule is configured, since
that is the case where the data becomes durable. Until it exists, the two "no RLS because channel
rules" comments and `sdk/realtime.md:213` should be corrected — they are the reason a reviewer
would not go looking.

---

### H2. Channel frames are capped at ~33/s per client, the rejection is invisible, and the capacity docs assume 60/s

**Where**
- `packages/server-postgres/src/websocket.ts:46-48` — `WS_RATE_LIMIT = 2000`,
  `WS_RATE_WINDOW_MS = 60_000`.
- `packages/server-postgres/src/websocket.ts:250-265` — the limiter runs before the type switch, so
  it counts every `broadcast` and `presence_track` frame.
- `packages/client/src/websocket.ts:1040-1046` — channel types are in the `expectsResponse = false`
  set, so no `pendingRequests` entry is registered.
- `packages/client/src/websocket.ts:631` — the error path requires
  `requestId && this.pendingRequests.has(requestId)`; an unmatched `ERROR` frame falls through
  every subsequent branch of `handleMessage` and is dropped at `packages/client/src/websocket.ts:898`.
- `website/src/content/docs/docs/backend/realtime.md:388` — *"Twenty people dragging cursors at 60
  fps generate around 1,200 messages per second — roughly an eighth of that."*

**What's wrong.** 2000 messages per 60s is 33 messages/second per client. The workload the capacity
section uses to argue the Postgres bus is sufficient — 60 fps cursor movement per client — is
refused by the socket before it ever reaches the bus. And the refusal is a
`sendError("ERROR", "RATE_LIMITED", …)` frame carrying a `requestId` that the client assigned but
deliberately did not register a waiter for, so it matches nothing and is silently discarded.
`await channel.broadcast(...)` resolves normally.

The documented cursor idiom makes this worse, not better: `realtime-channel.ts:310-311` tells users
to call `track()` again for each cursor move, so presence updates spend the same budget.

**Failure scenario.** Twenty people in a document, cursors broadcast at 60 fps. For the first ~33
seconds of each minute everything works. At message 2001 every further frame from that client is
refused for the rest of the window. Cursors freeze for ~27 seconds, resume at the top of the next
minute, and repeat. Nothing appears in the browser console, nothing rejects, and the only trace is
`RATE_LIMITED` frames the client throws away.

**Fix direction.** Two changes, independent: give channel frames their own budget (or a byte-rate
budget) distinct from the query/subscribe budget and set it against the documented workload; and
route unmatched `ERROR`/`error` frames somewhere observable — at minimum a `console.warn`, better
an `onError` on `RebaseRealtimeChannel` (see L1, same root cause). Either fix alone leaves half the
bug.

---

### H3. Channel traffic is routed to whichever provider is default, and `MongoRealtimeService` silently ignores it

**Where**
- `packages/server/src/services/routed-realtime-service.ts:81-82` — *"Channels/presence/broadcast
  (and anything else) → default provider."* `fallback()` is `providers[defaultKey]`.
- `packages/server/src/services/routed-realtime-service.ts:23-26` — `CHANNEL_MESSAGE_TYPES` is
  declared, documented ("Channel/presence/broadcast messages are engine-agnostic pub/sub"), and
  never read. `grep -rn CHANNEL_MESSAGE_TYPES packages/` confirms the only reads are of the
  identically-named set in `packages/client/src/websocket.ts`. It also omits `channel_history`.
- `packages/server-mongo/src/services/MongoRealtimeService.ts:386-444` — a `switch` with cases for
  `subscribe_collection`, `subscribe_one` and `unsubscribe`, and no `default`.
- `packages/server/src/init.ts:672-674` — `defaultDriverId` is whichever bootstrapper sets
  `isDefault`, i.e. user-chosen.
- `packages/server/src/init.ts:1815-1819` — the router is only installed when there is more than one
  realtime service.

**What's wrong.** This is class 29 in its plainest form. The routing comment calls channel messages
"engine-agnostic pub/sub", but they are routed to a *specific* engine — the default one — and only
the Postgres provider implements them. Mongo's `handleClientMessage` falls off the end of its
switch: no error, no log, no reply. The set that names exactly the six types needing engine-agnostic
handling sits unused ten lines above the code that fails to use it.

**Failure scenario.** A project with a Mongo bootstrapper marked `isDefault: true` and a Postgres
data source alongside it. `client.realtime.channel("room").track({...})` resolves. `onPresence`
never fires. `broadcast()` resolves and reaches nobody. `channel_history` never answers, so the
client's catch-up sits buffering live messages for the full `CATCH_UP_TIMEOUT_MS` (10s,
`realtime-channel.ts:117`) on every join and every reconnect before `abandonCatchUp` releases them.
The same project on a single Postgres source works perfectly, so this only appears once a second
engine is added.

**Fix direction.** Pick the channel provider by capability, not by default-ness: route
`CHANNEL_MESSAGE_TYPES` (plus `channel_history`, which belongs in that set) to the first provider
that declares channel support, and log once at boot which one that is. Independently, give
`MongoRealtimeService`'s switch a `default` arm that logs an unhandled type — a silent `switch` over
a wire protocol is how this stayed invisible.

---

## MEDIUM

### M1. "Delivery order matches sequence order" does not hold across instances, and the client discards the late message permanently

**Where**
- `website/src/content/docs/docs/backend/realtime.md:247` — *"**Ordered.** Sequence numbers are
  allocated per channel, and delivery order matches sequence order."*
- `packages/types/src/types/channel_bus.ts:89-91` — *"Ordering… Retained channels carry `seq`, and
  the client SDK orders by it."*
- `packages/client/src/realtime-channel.ts:476` — `if (seq <= this.lastSeq) break; // already delivered`
- `packages/server-postgres/src/services/channel-history.ts:228-240` — `append` serializes seq
  allocation on the cursor row lock.
- `packages/server-postgres/src/services/realtimeService.ts:1203-1204` — the publish happens
  *after* `append` returns, in JS, outside that lock.
- `packages/server-postgres/src/services/channel-bus/PostgresChannelBus.ts:129-153` — the 10 ms
  leading-edge window: a frame arriving while a window is open waits; a frame arriving when none is
  open goes out immediately.

**What's wrong.** The client does not order by `seq`; it *filters* by it, and the filter is a
one-way watermark. Anything arriving below `lastSeq` is dropped with no gap detection and no
repair, because the next `channel_history` request asks `sinceSeq: this.lastSeq`
(`realtime-channel.ts:277`) — the skipped message is below that floor forever.

Seq allocation is globally ordered; NOTIFY emission is not. Instance A's frame for seq 5 can sit in
an open batch window while instance B, whose window happens to be closed, sends seq 6 immediately.
A third instance then delivers 6 before 5. The same reordering is possible within one instance: the
overflow path at `PostgresChannelBus.ts:145-147` fires `flush()` without awaiting it and the timer's
flush follows, so two `db.execute` calls race for pool connections (UNCONFIRMED that this second
path is reachable often enough to matter in practice; the cross-instance path clearly is).

**Failure scenario.** Two users editing `doc:42` through different pods, both typing. A's operation
gets seq 5 and is held 10 ms; B's gets seq 6 and goes out at once. Every client on a third pod
applies operation 6, sets `lastSeq = 6`, then discards operation 5. Their document diverges from
everyone else's, permanently, and the reconnect path cannot repair it. This is precisely the
divergence the history mechanism was built to prevent.

**Fix direction.** Make the client detect the gap it currently ignores: on `seq > lastSeq + 1`, hold
briefly and/or issue a targeted `channel_history` from `lastSeq`, and on `seq <= lastSeq` only drop
if the seq was actually delivered rather than merely skipped. Independently, restate the docs and
`channel_bus.ts:89-91` as per-publisher ordering, which is what the transport actually provides.

### M2. Presence has no repair path, and the repair the contract names does not apply to it

**Where**
- `packages/types/src/types/channel_bus.ts:92-93` — *"Durability. A frame lost in transit is a
  missed live update; retained channels repair themselves through the client's `channel_history`
  replay."*
- `packages/server-postgres/src/services/realtimeService.ts:1511, 1521-1523` — the heartbeat only
  publishes a cross-instance diff when the state *changed*, so a lost join diff is never re-sent.
- `packages/server-postgres/src/services/channel-presence.ts:84-92` — the shared table holds the
  truth and is refreshed on every heartbeat.
- `packages/client/src/realtime-channel.ts:238-248` — `presence_state` is requested exactly twice:
  on join and on reconnect. Never again.

**What's wrong.** Presence frames are neither retained nor replayed, so the durability escape
clause covers everything except the one feature that most needs it. The correct roster is sitting in
`rebase.channel_presence` on every instance and nothing ever re-reads it. The heartbeat *would* be a
natural repair signal and is deliberately suppressed as an optimisation — a good optimisation for
bandwidth, but it removes the only self-healing path that existed.

**Failure scenario.** Two pods, Postgres bus. User A joins `doc:42` on pod 1; the single
`presence_diff` NOTIFY announcing the join is lost (a listener reconnect window at
`pg-notify-listener.ts:113-118` is enough). Users on pod 2 never see A in the roster for the rest of
their session, while A's broadcasts arrive normally — the avatar strip says the room is empty and
edits appear from nobody. `presence_state` is correct if anyone asks, and nobody does.

**Fix direction.** Cheapest correct fix: have the sweep pass (`sweepStalePresence`,
`realtimeService.ts:1691-1706`, already on a timer with a shared roster in hand) periodically emit a
full `presence_state` to local members of channels whose local view differs from the table. Or
client-side: re-request `presence_state` on a slow interval, and immediately on receiving a
`presence_diff` leave for a client id the roster never had.

### M3. No frame-size ceiling and no backpressure anywhere on the channel path

**Where**
- `packages/server-postgres/src/websocket.ts:105` — `new WebSocketServer({ server })`, no
  `maxPayload`; the `ws` default is 100 MiB.
- `packages/server-postgres/src/services/realtimeService.ts:1226-1231` (`fanOutBroadcast`),
  `1622-1629` (`deliverPresenceDiff`), `1541-1545` (`sendChannelHistory`) — every one calls
  `ws.send(message)` with no `bufferedAmount` check. `grep bufferedAmount` over
  `packages/{server,server-postgres,client}/src` returns nothing.
- `packages/server-postgres/src/services/realtimeService.ts:1634-1641` — `publishPresenceDiff`
  publishes without the `frameByteLength > maxFrameBytes` check that `publishBroadcast`
  performs at line 1321.
- `packages/server-postgres/src/services/channel-presence.ts:84-92` — the state is
  `JSON.stringify`'d straight into a JSONB column, unbounded.

**What's wrong.** Broadcast payload size is unvalidated at ingress and unvalidated at fan-out; only
the *cross-instance* hop checks size, and only for broadcasts, not presence. A presence state large
enough to exceed 7500 bytes produces a `pg_notify` error caught and logged by `publishFrame`
(`realtimeService.ts:1338-1347`) — so oversized presence stops crossing instances with no client-
visible signal, unlike the broadcast case which at least tries to tell the sender.

Backpressure is simply absent. A member whose socket has stalled accumulates the full fan-out in the
server's heap.

**Failure scenario.** One client sends a 50 MB `broadcast` on a 30-member channel: the server parses
it, then queues ~1.5 GB across 30 send buffers. Or, more mundanely, a laptop lid closes on a busy
cursor channel and that one socket's buffer grows until the pod OOMs.

**Fix direction.** Set `maxPayload` on the `WebSocketServer` (a few hundred KB is generous for this
protocol), reject oversized presence state at `trackPresence` with the same
`CHANNEL_BUS_PAYLOAD_TOO_LARGE` treatment broadcasts get, and add a `bufferedAmount` threshold in
the three `ws.send` sites above that drops the frame (channels are best-effort by contract) or
closes the socket.

### M4. Client-controlled channel names create unbounded and, in one case, permanent server state

**Where**
- `packages/server-postgres/src/services/realtimeService.ts:1114-1120` — `joinChannel` creates a map
  entry for any string, with no validation and no per-client cap.
- `packages/server-postgres/src/services/channel-history.ts:113, 157-159` — the `resolved` cache is
  keyed by channel name; the comment claims it is "bounded by the number of distinct channel names
  seen", which is the attacker's choice.
- `packages/server-postgres/src/services/realtimeService.ts:129-132` —
  `oversizedBroadcastWarned`, same key space, cleared only on `destroy()`.
- `packages/server-postgres/src/services/channel-history.ts:25-30, 195-200, 343-379` —
  `rebase.channel_cursors` is documented as never pruned, one row per channel that ever retained a
  message; `prune()` touches only `channel_messages`.

**What's wrong.** Every one of these is keyed by a string the client invents. Retention is
per-channel (`limit` / `ttl`), so a wide rule such as `{ match: "*" }` or `{ match: "doc:*" }` —
both supported, `channelMatchesRule` at `channel-history.ts:90-95` — bounds each channel and bounds
nothing in aggregate. The `channel_cursors` row is the sharp end: it survives pruning by design and
by design forever.

**Failure scenario.** With `{ match: "doc:*", limit: 500 }` configured, a script joins and
broadcasts once to `doc:<random>` 2000 times a minute (exactly the rate limit). Each iteration adds
a permanent `channel_cursors` row, a `channel_messages` row that only that channel's own limit
governs, a `channels` map entry, and a `resolved` cache entry. Nothing reclaims the cursors, and the
in-process maps only shrink when a channel's membership hits zero.

**Fix direction.** Validate channel names (length ceiling and a documented charset) in
`handleMessage` before any of them are used as a key; cap channels joined per client; and give
`prune` a pass that deletes cursor rows whose channel has had no message for well past the TTL —
the "cursors are kept forever" reasoning protects `sinceSeq` semantics for *live* channels, which a
long-idle threshold preserves.

---

## LOW

### L1. Channel errors written to be seen by the sender never reach the application

`sendError` (`realtimeService.ts:1065-1075`) emits `{ type: "error", subscriptionId, payload, error }`
— no `requestId`, no `channel`. The client matches errors by pending `requestId`
(`packages/client/src/websocket.ts:631`), by `channel` for the four channel frame types
(`websocket.ts:662-663`), or by `subscriptionId` (`websocket.ts:885`). A channel error matches none
of them and is dropped at `websocket.ts:898`.

Two errors are affected, and both have docblocks explaining at length why telling the sender
matters: `CHANNEL_HISTORY_WRITE_FAILED` (`realtimeService.ts:1194-1200`, justified at 1173-1181 —
"Failing loudly to the sender instead lets it retry, which for an operation stream is the only
outcome that keeps clients convergent") and `CHANNEL_BUS_PAYLOAD_TOO_LARGE`
(`realtimeService.ts:1372-1377`, justified at 1349-1357 — "the message says exactly that"). Neither
message is deliverable. On a retained channel the sender's broadcast is dropped server-side and the
client's `await broadcast()` resolves as if it had been sent.

**Fix:** address channel errors by `channel` so the existing dispatcher at `websocket.ts:662` picks
them up, and expose an `onError` on `RebaseRealtimeChannel`.

### L2. `leave()` on a shared channel object cuts off every other consumer — which the docs say it cannot

`packages/client/src/index.ts:558-563` and `website/src/content/docs/docs/sdk/realtime.md:211` both
justify returning the same object per name on the grounds that it stops one caller's `leave()` from
cutting off the others. `RebaseRealtimeChannel.leave()` (`realtime-channel.ts:404-430`) calls
`this.presenceHandlers.clear()` and `this.broadcastHandlers.clear()`, unsubscribes the socket
handler, and sends `leave_channel` — for everyone. The shared object is exactly what makes one
component's unmount silence the others.

**Fix:** refcount joins, or make `leave()` a per-caller operation and reserve the teardown for the
last holder.

### L3. Nothing signals that the default memory bus is wrong on a multi-pod deployment

With the default, `PostgresBootstrapper.ts:454-467` evaluates `wantsBus` as false and
`configureChannelBus` is never called — no log line at all. Every warning in this subsystem covers
the *configured* bus failing (`channel-bus/index.ts:99-104`, `realtimeService.ts:1259-1263`,
`1279-1283`), i.e. the case where the operator already knew a bus mattered. The far more common
misconfiguration — scaled to two replicas, never touched `realtime.bus` — produces silence, and
`getChannelBusKind()` (`realtimeService.ts:1293`) is exposed to nothing: no health endpoint, no
doctor check (`grep getChannelBusKind` finds only the service and its tests).

The evidence needed is already in the process: the entity LISTEN handler at
`realtimeService.ts:2067-2077` reads a foreign `sid` off `rebase_entity_changes` on every
cross-instance notification.

**Fix:** record "a foreign sid has been seen"; on the first `join_channel` while the bus is memory
and that flag is set, warn once with the `realtime.bus` remedy. Also surface the bus kind in the
health payload so it is checkable without reading logs.

### L4. `undefined` and `""` are usable channel names, and `undefined` is a shared global channel

`handleMessage` passes `payload?.channel as string` straight through
(`realtimeService.ts:383-419`), and `joinChannel` keys the map on whatever it gets. This is pinned
deliberately as behaviour rather than intent at
`packages/server-postgres/test/realtimeService-channels.test.ts:119-142`, which is the right call —
but the consequence is that every client whose frame is malformed in the same way lands in the same
`undefined` channel and can read each other's broadcasts. Fold into the name validation in M4.

### L5. Two smaller inconsistencies in the lifecycle

- `ensurePresenceCleanup` (`realtimeService.ts:1654-1656`) does not `unref()` its 10-second
  interval, while its cross-instance twin `ensurePresenceSweep` (`1687-1690`) does. A Node process
  with any presence tracked will not exit on its own until `destroy()` runs.
- `PostgresChannelBus.publish` (`PostgresChannelBus.ts:130-133`) still issues a `pg_notify` when
  `this.stopped` is true. During shutdown `destroy()` stops the bus at
  `realtimeService.ts:1755-1757` and the pool closes shortly after, so a straggler publish can query
  a closing pool.
- Related, `configureChannelBus` installs the bus before creating the presence store and leaves the
  bus installed when the store fails (`realtimeService.ts:1269-1285`). The warning says "broadcast is
  unaffected", which is true, but the resulting state is that pods disagree about the roster: the
  pod without a store answers `presence_state` from its local map while the others answer from the
  table.

---

## Checked and clean

- **`ChannelBus` contract and `MemoryChannelBus`** (`types/channel_bus.ts`,
  `channel-bus/ChannelBus.ts`). The interface documents start/publish/stop obligations and is
  explicit about what it does *not* guarantee. `isChannelBusInstance` is structural on purpose so a
  separately-versioned transport package works — a real trap, correctly avoided.
- **Bus resolution** (`channel-bus/index.ts:53-114`). Env wins over a named built-in but never over
  a supplied instance, with a warning when both are set; unknown env values fall back rather than
  guessing; a postgres bus with no usable URL degrades to memory instead of failing boot. Well
  covered by `test/channel-bus.test.ts:420-509`.
- **Coalescing** (`PostgresChannelBus.ts:129-197`). Leading-edge window, early flush before the 8 KB
  NOTIFY ceiling, single frames sent unwrapped so a mid-rolling-deploy older build can still read
  them, queued frames flushed rather than dropped on `stop()`. Ten tests at
  `test/channel-bus.test.ts:547-670`.
- **Frame parsing** (`PostgresChannelBus.ts:227-299`). Both wire shapes, per-entry coercion so one
  bad frame in a batch does not lose the rest, null for anything unrecognised — the contract's
  "malformed message never throws out of the transport" is genuinely met.
- **Oversized-broadcast pointer path** (`realtimeService.ts:1304-1336`, `handleBusFrame` case
  `broadcast_ref` at `1395-1412`). Retained → travels by `(channel, seq)` and the receiver reads it
  back; ephemeral → refused rather than reaching half the cluster; a pruned target is dropped rather
  than delivered empty. Correct, and the skip when no local member is in the channel is a nice touch.
- **Sequence allocation and replay** (`channel-history.ts:222-299`). One statement allocates and
  stores, the `ON CONFLICT DO UPDATE` row lock serialises concurrent appends per channel, cursors
  outlive the messages they numbered so `sinceSeq` keeps meaning one thing, `latestSeq` is read from
  the cursor rather than the messages, replay is capped at `MAX_REPLAY_LIMIT`.
- **Persist-before-deliver** (`realtimeService.ts:1183-1214`). A message that cannot be stored is not
  delivered, the per-channel queue keeps delivery order equal to sequence order *within an
  instance*, a failed predecessor does not poison the chain, and a failed prune does not surface as a
  broadcast failure.
- **Presence roster mechanics** (`channel-presence.ts`). Keyed `(channel, client_id)` so a
  reconnect onto another replica replaces rather than duplicates; `sweepStale` excludes own rows and
  uses `RETURNING` so exactly one instance announces a departure; `removeInstance` on graceful
  shutdown avoids a TTL window of ghosts on every rolling deploy. `revokeInternalTableSql` is
  correctly applied to all three internal tables.
- **Self-`sid` filtering** (`realtimeService.ts:1388`) matches the entity path's behaviour, and the
  bus contract explicitly permits an echoing transport.
- **Client catch-up buffering** (`realtime-channel.ts:143-164, 472-529`). Live messages held during
  a replay, bounded by `CATCH_UP_TIMEOUT_MS`, released rather than dropped on timeout, flushed in
  sequence order. The bug it was written to prevent (a live message advancing the watermark past an
  in-flight replay) is real and is genuinely prevented. Pinned at
  `client/src/realtime-channel.test.ts:206-231`.
- **Client payload envelope** (`realtime-channel.ts:205-219`). Funnelling every channel frame
  through one `send()` closes a real silent-failure mode, and the reasoning is written down.
- **Retention rule validation** (`channel-history.ts:118-134, 63-81`). A rule with neither `limit`
  nor `ttl` is refused rather than honoured; an unparseable `ttl` becomes "no TTL" rather than an
  aggressive one, with a warning.
- **Anonymous channel access on the client** (`packages/client/src/websocket.ts:56-72, 1018-1031`).
  Exempting channel frames from the client-side auth gate is correct — the server is the right place
  to decide — and the comment explains why. (That the server then decides nothing is H1, not a fault
  of this code.)

---

## Open questions

1. **Is default-allow the intended channel access model?** Every comment in the subsystem reads as
   though an authorization layer was designed and then not built (H1). If it was intentionally
   deferred, the two "no RLS because channel rules" comments and `sdk/realtime.md:213` are the
   things to change first — they are actively misleading a reader doing a security pass.
2. **What is the intended per-client channel message budget?** `WS_RATE_LIMIT` looks sized for
   queries and subscriptions, not for 60 fps cursors. Deciding this settles whether H2 is a limiter
   change, a docs change, or both.
3. **Should a lost `presence_diff` be repairable at all,** or is presence explicitly best-effort with
   reconnect as the only repair? The roster table makes a cheap repair possible; the current design
   just does not use it (M2).
4. **Is Mongo-as-default with a second engine a supported configuration?** If yes, H3 is a real
   product gap. If no, the router should say so at boot rather than routing channels into a switch
   that ignores them.
5. **Does `channel_cursors` growth have an intended bound?** "Kept forever" is right for a channel
   namespace the server controls and wrong for one clients invent (M4). An idle-age prune would
   preserve the `sinceSeq` reasoning; confirming that is a design call, not a code one.
6. UNCONFIRMED: whether the intra-instance flush race at `PostgresChannelBus.ts:145-147` can actually
   reorder two NOTIFYs in practice. The cross-instance reordering in M1 stands regardless.
