/**
 * The cross-instance transport for channel broadcast and presence, and the
 * contract anyone implementing one has to meet.
 *
 * These types live in `@rebasepro/types` rather than in the Postgres adapter on
 * purpose: a transport package should depend on the contract, not on the
 * database driver that happens to ship the default implementation. A
 * `@rebasepro/channel-bus-<something>` package needs this file and nothing else.
 *
 * Why a transport exists at all: entity/collection realtime already spans
 * instances (CDC, or per-mutation LISTEN/NOTIFY). Channel broadcast and presence
 * did not — they fanned out from per-process maps, so two clients served by
 * different replicas could not see each other, and nothing errored. The bus is
 * the missing hop, and deliberately *only* that hop: which local clients receive
 * a frame stays in the realtime service, so a transport never has to know what a
 * subscription, a WebSocket or a presence roster is.
 */

/**
 * A frame in flight between instances.
 *
 * `sid` identifies the publishing instance. The realtime service drops frames
 * carrying its own `sid` on arrival — local fan-out already happened before the
 * publish — so a transport that echoes a publisher's own messages back to it is
 * still correct, merely wasteful.
 *
 * Keys are spelled out rather than abbreviated. The one shipped transport with a
 * size limit has a pointer path for anything that would approach it, so shaving
 * bytes off key names buys nothing worth the opacity.
 */
export type ChannelBusFrame =
    /** A broadcast carrying its payload. */
    | {
        kind: "broadcast";
        sid: string;
        channel: string;
        event: string;
        /** Originating client, echoed so receivers can skip it if it is theirs. */
        from?: string;
        /** Sequence number, present only on retained channels. */
        seq?: number;
        payload: unknown;
    }
    /**
     * A broadcast too large for the transport to carry inline: the body is
     * already durable in `rebase.channel_messages`, so the frame carries only
     * its address and each receiver reads it back. Only ever emitted for
     * retained channels, and only by a transport with a finite
     * {@link ChannelBus.maxFrameBytes}.
     */
    | {
        kind: "broadcast_ref";
        sid: string;
        channel: string;
        from?: string;
        seq: number;
    }
    /** A presence join/leave/update, small by construction. */
    | {
        kind: "presence_diff";
        sid: string;
        channel: string;
        joins: Record<string, Record<string, unknown>>;
        leaves: Record<string, Record<string, unknown>>;
    };

/** Receives frames published by *other* instances. */
export type ChannelBusHandler = (frame: ChannelBusFrame) => void | Promise<void>;

/**
 * A cross-instance transport.
 *
 * ## What an implementation must guarantee
 *
 * - **`start()` rejects if the transport is unusable.** The caller falls back to
 *   in-process delivery when it does. Resolving while disconnected produces a
 *   cluster that believes it is connected and silently is not, which is the
 *   exact failure this whole mechanism exists to remove.
 * - **`publish()` reaches every *other* instance, or rejects.** Delivery back to
 *   the publisher is permitted but pointless (see {@link ChannelBusFrame.sid}).
 * - **`stop()` is idempotent** and releases everything, including anything
 *   holding the event loop open.
 * - **A malformed message never throws out of the transport.** Parsing happens
 *   inside the implementation; drop and log what you cannot understand, so one
 *   bad frame cannot take the listener down.
 *
 * ## What it does *not* have to guarantee
 *
 * - **Ordering.** Retained channels carry `seq`, and the client SDK orders by
 *   it. Unsequenced broadcasts are cursor-grade traffic where order is not
 *   meaningful.
 * - **Durability.** A frame lost in transit is a missed live update; retained
 *   channels repair themselves through the client's `channel_history` replay.
 * - **Exactly-once.** Duplicates are tolerated — retained frames are deduped by
 *   `seq`, and presence diffs are idempotent by construction.
 */
export interface ChannelBus {
    /**
     * Identifies the transport in logs and in `getChannelBusKind()`. Use your
     * own name; the framework only compares against `"memory"` to decide
     * whether publishing is worth attempting at all.
     */
    readonly kind: string;

    /**
     * Largest frame this transport will carry, in bytes of encoded JSON, or
     * `Infinity` when there is no meaningful ceiling.
     *
     * A broadcast that exceeds it is published as a `broadcast_ref` pointer when
     * the channel is retained, and refused with an error to the sender when it
     * is not. Implementations with no limit should return `Infinity` rather than
     * a large number, so the pointer path is never taken needlessly.
     */
    readonly maxFrameBytes: number;

    /** Connect and begin delivering remote frames to `handler`. */
    start(handler: ChannelBusHandler): Promise<void>;

    /** Publish a frame to the other instances. */
    publish(frame: ChannelBusFrame): Promise<void>;

    /** Disconnect and release resources. Idempotent. */
    stop(): Promise<void>;
}

/**
 * Which transport to use, for the two that ship with the Postgres adapter.
 *
 * To use one that does not ship here — a Redis package, or your own class —
 * pass the {@link ChannelBus} instance itself instead of a config object.
 *
 * There are deliberately only two built in, and neither adds a service to a
 * deployment. Rebase deploys as Postgres + backend + frontend; a bus that
 * required a message broker would put a second stateful service into every
 * `docker-compose.yml` the CLI scaffolds, for a feature most applications never
 * use. Measured across two backend instances against one Postgres container,
 * the Postgres bus carried ~10k cross-instance messages/second with no losses,
 * and stayed flat out to eight instances — comfortably past what live-cursor
 * collaboration generates. The extension point below is the answer for anyone
 * who does outgrow it.
 */
export type ChannelBusConfig =
    /**
     * In-process only — the historical behaviour. Broadcast and presence reach
     * the clients connected to *this* instance and no further.
     */
    | { type: "memory" }
    /**
     * Postgres LISTEN/NOTIFY, reusing infrastructure the deployment already has.
     *
     * `pg_notify` caps a payload at 8000 bytes, so a broadcast larger than that
     * is delivered cross-instance only on a *retained* channel, where the
     * notification carries a pointer (`seq`) instead of the message and each
     * receiver reads the body back from `rebase.channel_messages`. An oversized
     * broadcast on an ephemeral channel is refused rather than silently
     * delivered to half the cluster.
     *
     * NOTE: `LISTEN` needs a session-mode connection. Behind PgBouncer in
     * transaction mode this must point at the database directly
     * (`DATABASE_DIRECT_URL`), not at the pooler.
     */
    | {
        type: "postgres";
        /** Direct connection for the LISTEN client. Defaults to `DATABASE_DIRECT_URL`. */
        connectionString?: string;
        /**
         * How long to coalesce outgoing frames into a single notification, in
         * milliseconds. Defaults to 10.
         *
         * A notify is a query on your primary database, so under load this is
         * the difference between one query per message and one per window. The
         * window is leading-edge: a frame arriving when none is open goes out
         * immediately, so an idle channel pays no added latency and only a
         * sustained stream is batched.
         *
         * Set to 0 to disable coalescing and send every frame on its own.
         */
        batchWindowMs?: number;
    };

/**
 * What `realtime.bus` accepts: a built-in transport by name, or any
 * {@link ChannelBus} instance.
 *
 * ```typescript
 * realtime: { bus: { type: "postgres" } }        // shipped
 * realtime: { bus: new MyRedisChannelBus(url) }  // a separate package, or your own
 * ```
 */
export type ChannelBusSetting = ChannelBusConfig | ChannelBus;

/**
 * Whether `setting` is an already-constructed transport rather than a request
 * for a built-in one.
 *
 * Structural rather than nominal so that an instance from a *different copy* of
 * `@rebasepro/types` — an entirely normal outcome of a separately versioned
 * transport package — is still recognised.
 */
export function isChannelBusInstance(setting: ChannelBusSetting | undefined): setting is ChannelBus {
    return typeof (setting as ChannelBus | undefined)?.publish === "function";
}
