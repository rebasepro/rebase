/**
 * Broadcast channels and presence, as an SDK surface.
 *
 * The realtime engine has supported `join_channel`, `broadcast`,
 * `presence_track`, `presence_untrack` and `presence_state` for a while, but
 * the client only recognised those types well enough to send them
 * fire-and-forget: there were no methods to call and no way to receive channel
 * or broadcast events, since `on()` handles only connect / disconnect /
 * reconnect / error. Anything wanting presence therefore opened a *second*
 * socket and reimplemented the AUTHENTICATE → AUTH_SUCCESS handshake, the
 * reconnect backoff, and the presence heartbeat — a couple of hundred lines
 * per app, all of it duplicating this package.
 *
 * Two protocol details this hides, because both are easy to get wrong and
 * neither is discoverable from the message list:
 *
 *  - **A joining client is told only about its own join.** The `presence_diff`
 *    it receives after `presence_track` contains just itself. The existing
 *    roster arrives only in response to an explicit `presence_state` request,
 *    so `join()` sends one.
 *  - **Presence expires after 30s** (`PRESENCE_TIMEOUT_MS` server-side). A
 *    client that tracks once and goes quiet silently vanishes from everyone
 *    else's roster while still sitting in the document, so `track()` starts a
 *    heartbeat and `leave()` stops it.
 */

/** Presence state keyed by the server's client id. */
export type PresenceState = Record<string, Record<string, unknown>>;

export interface PresenceDiff {
    joins: PresenceState;
    leaves: PresenceState;
}

export interface BroadcastEvent {
    event: string;
    payload: unknown;
    /**
     * Per-channel sequence number, present only on retained channels.
     *
     * Monotonically increasing and dense, so a consumer that remembers the last
     * one it applied can tell the server exactly where to resume from.
     */
    seq?: number;
    /**
     * True when this arrived through catch-up rather than live.
     *
     * Handlers do not have to care — replayed messages are delivered to the
     * same `onBroadcast` handlers, in sequence order, so an operation stream
     * needs no second code path. It is exposed for consumers that want to,
     * for example, skip an animation while fast-forwarding.
     */
    replayed?: boolean;
}

/**
 * One retained message, as returned by {@link RebaseRealtimeChannel.history}.
 *
 * Re-exported rather than re-declared: the copy that used to live here had
 * drifted `at` to optional, while the server always sends it.
 */
export type { ChannelHistoryEntry } from "@rebasepro/types";
import type { ChannelHistoryEntry } from "@rebasepro/types";
import { RebaseApiError } from "@rebasepro/types";

/** The answer to a catch-up request. */
export interface ChannelHistoryResult {
    messages: ChannelHistoryEntry[];
    /**
     * Whether the server retains anything for this channel.
     *
     * False means there is no retention rule configured for it, so the empty
     * list means "never keeps history" rather than "you missed nothing" — a
     * client that needs to converge has to fall back to a full resync.
     */
    retained: boolean;
    /** Highest sequence the server holds, even if this batch was capped. */
    latestSeq?: number;
}

/** Options for a channel handle. */
export interface ChannelOptions {
    /**
     * Ask the server to replay what this client missed, on join and on every
     * reconnect.
     *
     * Only meaningful for a channel the *server* has a retention rule for —
     * retention is configured on the backend, since a channel is created by
     * whoever names it and a client-chosen history depth would let any visitor
     * commit the backend to unbounded storage. On a channel with no rule the
     * server answers `retained: false` and this is inert.
     */
    history?: boolean;
}

/** The socket operations a channel needs; satisfied by RebaseWebSocketClient. */
export interface ChannelTransport {
    sendMessage(message: Record<string, unknown>): Promise<unknown>;
    onChannelMessage(channel: string, handler: (message: Record<string, unknown>) => void): () => void;
    onReconnect(handler: () => void): () => void;
}

/**
 * Re-send presence comfortably inside the server's 30s expiry.
 *
 * Two-thirds of the window: one lost heartbeat still leaves time for the next
 * before the entry is reaped, so a single dropped frame is not a disappearance.
 */
const PRESENCE_HEARTBEAT_MS = 20_000;

/**
 * How long live messages are held back waiting for a catch-up response.
 *
 * Short, because the cost of waiting is visible — on a collaborative document
 * this is a stall in everyone else's edits appearing. Long enough that a slow
 * replay of a busy channel is not abandoned needlessly.
 */
const CATCH_UP_TIMEOUT_MS = 10_000;

export class RebaseRealtimeChannel {
    private presenceHandlers = new Set<(state: PresenceState, diff?: PresenceDiff) => void>();
    private broadcastHandlers = new Set<(event: BroadcastEvent) => void>();
    private errorHandlers = new Set<(error: RebaseApiError) => void>();
    private unsubscribers: (() => void)[] = [];

    /** Last known roster, kept so handlers always get a full picture. */
    private presences: PresenceState = {};
    /** What this client last tracked, replayed on reconnect and heartbeat. */
    private trackedState: Record<string, unknown> | null = null;
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    private joined = false;

    /** Whether this handle asks the server to replay missed messages. */
    private wantsHistory: boolean;

    /**
     * Highest sequence number delivered to handlers so far.
     *
     * This is the resume point sent as `sinceSeq`, and the watermark that makes
     * replay idempotent: catch-up ranges overlap with what arrived live, and
     * anything at or below this has already been seen.
     */
    private lastSeq = 0;

    /**
     * Live messages that arrived while a catch-up was in flight.
     *
     * Without this they would be delivered ahead of the older messages being
     * fetched, and — worse — would advance {@link lastSeq} past them, so the
     * catch-up response would then be discarded as already-seen and those
     * messages would be lost for good. Held here and flushed, in order, once
     * the replay lands.
     */
    private pendingLive: BroadcastEvent[] = [];
    private catchUpInFlight = false;

    /**
     * Deadline for a catch-up response.
     *
     * Buffering live messages is only safe because the wait is bounded. A
     * catch-up frame that never arrives — a server that dropped it, a socket
     * that died between request and reply — would otherwise leave the channel
     * silently holding every subsequent edit forever, which is a worse failure
     * than the one replay was added to fix.
     */
    private catchUpTimeout: ReturnType<typeof setTimeout> | null = null;

    /**
     * Callers of {@link history} awaiting the next `channel_history` frame.
     *
     * These frames are addressed by channel rather than by request id, so they
     * are matched in arrival order. Requests on one channel are serialized by
     * the socket, so FIFO is the right correlation here.
     */
    private historyWaiters: Array<(result: ChannelHistoryResult) => void> = [];

    constructor(
        public readonly name: string,
        private transport: ChannelTransport,
        options: ChannelOptions = {}
    ) {
        this.wantsHistory = options.history ?? false;
    }

    /**
     * Turn on catch-up for a handle that was created without it.
     *
     * The client hands back the same channel object for a given name, so a
     * later `channel(name, { history: true })` has no new object to configure —
     * it upgrades this one instead. Idempotent, and never downgrades: one
     * caller asking for history must not be switched off by another that did
     * not ask.
     */
    enableHistory(): void {
        if (this.wantsHistory) return;
        this.wantsHistory = true;
        if (this.joined) void this.requestHistory();
    }

    /**
     * Join the channel and ask for the current roster.
     *
     * Called automatically by `track`, `broadcast`, `onPresence` and
     * `onBroadcast`; calling it directly is only needed to start receiving
     * before there is anything to send.
     */
    /**
     * Send a channel message.
     *
     * Every channel message is read by the server out of a `payload` envelope
     * (`payload?.channel`, `payload?.state`, `payload?.event`). Sending those
     * fields flat does not error: `payload?.channel` simply reads as
     * `undefined`, so the client is registered into channel `undefined` with
     * empty state, and the echo comes back with no `channel` for
     * `onChannelMessage` to match — presence and broadcast both go quiet with
     * nothing logged. Funnelled through one place so a new message type cannot
     * reintroduce that.
     */
    private send(type: string, fields: Record<string, unknown> = {}): Promise<unknown> {
        return this.transport.sendMessage({ type, payload: { channel: this.name, ...fields } });
    }

    async join(): Promise<void> {
        if (this.joined) return;
        this.joined = true;

        this.unsubscribers.push(
            this.transport.onChannelMessage(this.name, (message) => this.handle(message))
        );

        // A reconnect drops server-side channel membership and presence, so
        // both have to be re-established. Nothing else notices this: the
        // socket comes back, and the client just stops receiving.
        this.unsubscribers.push(
            this.transport.onReconnect(() => {
                void this.rejoin();
            })
        );

        await this.send("join_channel");
        // Not optional. Joining does not push the roster — without this the
        // channel believes it is alone until somebody else happens to move.
        await this.send("presence_state");
        if (this.wantsHistory) await this.requestHistory();
    }

    private async rejoin(): Promise<void> {
        try {
            await this.send("join_channel");
            await this.send("presence_state");
            if (this.trackedState) {
                await this.send("presence_track", { state: this.trackedState });
            }
            // The reason this class tracks a sequence number at all: whatever
            // was broadcast while the socket was down was delivered to everyone
            // else and never to us. Asking from `lastSeq` is the difference
            // between resuming and resyncing the whole document.
            if (this.wantsHistory) await this.requestHistory();
        } catch {
            // The socket is down again; the next reconnect will retry.
        }
    }

    /**
     * Ask the server for everything after {@link lastSeq}.
     *
     * Live messages are buffered from here until the answer arrives — see
     * {@link pendingLive}.
     */
    private async requestHistory(limit?: number): Promise<void> {
        this.catchUpInFlight = true;

        if (this.catchUpTimeout) clearTimeout(this.catchUpTimeout);
        this.catchUpTimeout = setTimeout(() => this.abandonCatchUp(), CATCH_UP_TIMEOUT_MS);
        (this.catchUpTimeout as unknown as { unref?: () => void }).unref?.();

        try {
            await this.send("channel_history", {
                sinceSeq: this.lastSeq,
                ...(limit !== undefined ? { limit } : {})
            });
        } catch {
            // The frame never went out, so nothing will answer it.
            this.abandonCatchUp();
        }
    }

    /**
     * Give up waiting for a catch-up and release what was held back.
     *
     * The buffered messages are still the freshest thing this client has, so
     * they are delivered rather than dropped. Callers of {@link history} are
     * answered with `retained: false` — accurate in the sense that matters:
     * this client has no history to work from and has to resync.
     */
    private abandonCatchUp(): void {
        if (this.catchUpTimeout) {
            clearTimeout(this.catchUpTimeout);
            this.catchUpTimeout = null;
        }
        if (!this.catchUpInFlight) return;
        this.catchUpInFlight = false;
        for (const resolve of this.historyWaiters.splice(0)) {
            resolve({ messages: [], retained: false });
        }
        this.flushPendingLive();
    }

    /**
     * Publish this client's presence state, and keep publishing it.
     *
     * Calling `track` again replaces the state (and restarts the heartbeat),
     * which is how you update e.g. a cursor position.
     */
    async track(state: Record<string, unknown>): Promise<void> {
        await this.join();
        this.trackedState = state;

        await this.send("presence_track", { state });

        if (!this.heartbeat) {
            this.heartbeat = setInterval(() => {
                if (!this.trackedState) return;
                void this.send("presence_track", { state: this.trackedState })
                    .catch(() => { /* a dropped beat is recoverable; the next one carries the same state */ });
            }, PRESENCE_HEARTBEAT_MS);
            // Do not hold a Node process open just to say "still here".
            (this.heartbeat as unknown as { unref?: () => void }).unref?.();
        }
    }

    /** Stop publishing presence, without leaving the channel. */
    async untrack(): Promise<void> {
        this.stopHeartbeat();
        this.trackedState = null;
        if (this.joined) {
            await this.send("presence_untrack");
        }
    }

    /**
     * Observe the roster. The handler fires immediately with what is already
     * known, then on every change.
     */
    onPresence(handler: (state: PresenceState, diff?: PresenceDiff) => void): () => void {
        this.presenceHandlers.add(handler);
        void this.join();
        if (Object.keys(this.presences).length > 0) handler({ ...this.presences });
        return () => this.presenceHandlers.delete(handler);
    }

    /**
     * Send a broadcast. The sender does not receive its own message.
     *
     * Resolves when the frame is written to the socket, **not** when the server
     * has accepted it. Channel frames are fire-and-forget by design — a
     * collaborative app broadcasts a cursor position sixty times a second, and
     * waiting for an acknowledgement on each would make that a round trip.
     *
     * A refusal therefore arrives on {@link onError}, not as a rejection here.
     */
    async broadcast(event: string, payload: unknown): Promise<void> {
        await this.join();
        await this.send("broadcast", { event, payload });
    }

    /**
     * Observe refusals about this channel.
     *
     * `CHANNEL_FORBIDDEN` when an authorizer refuses a join, a broadcast or a
     * history read; `RATE_LIMITED` past the channel frame budget;
     * `CHANNEL_HISTORY_WRITE_FAILED` / `CHANNEL_HISTORY_READ_FAILED` when
     * retention cannot be served; `CHANNEL_BUS_PAYLOAD_TOO_LARGE` when a
     * broadcast on an ephemeral channel is too big to cross the bus.
     *
     * These used to be dropped on the floor — there is no promise to reject on
     * a fire-and-forget frame, so a forbidden broadcast looked exactly like a
     * delivered one. With no handler attached they are logged as a warning,
     * because an unobserved refusal is the failure this exists for.
     *
     * @returns An unsubscribe function.
     */
    onError(handler: (error: RebaseApiError) => void): () => void {
        this.errorHandlers.add(handler);
        void this.join();
        return () => this.errorHandlers.delete(handler);
    }

    /** Observe broadcasts. Pass an event name to filter. */
    onBroadcast(handler: (event: BroadcastEvent) => void): () => void;
    onBroadcast(event: string, handler: (payload: unknown) => void): () => void;
    onBroadcast(
        eventOrHandler: string | ((event: BroadcastEvent) => void),
        maybeHandler?: (payload: unknown) => void
    ): () => void {
        const wrapped: (event: BroadcastEvent) => void = typeof eventOrHandler === "string"
            ? (e) => { if (e.event === eventOrHandler) maybeHandler!(e.payload); }
            : eventOrHandler;

        this.broadcastHandlers.add(wrapped);
        void this.join();
        return () => this.broadcastHandlers.delete(wrapped);
    }

    /**
     * The last sequence number this channel has delivered.
     *
     * Zero on a channel that retains nothing. Persist it if you want catch-up
     * to survive a page reload as well as a reconnect, and pass it back via
     * {@link history}.
     */
    get sequence(): number {
        return this.lastSeq;
    }

    /**
     * Fetch retained messages explicitly, instead of waiting for join or
     * reconnect to do it.
     *
     * Defaults to resuming from {@link sequence}. Messages are delivered to
     * `onBroadcast` handlers as usual — the returned value is for callers that
     * want to inspect the batch, or to learn from `retained` that the channel
     * keeps no history at all.
     */
    async history(options: { sinceSeq?: number; limit?: number } = {}): Promise<ChannelHistoryResult> {
        await this.join();
        if (options.sinceSeq !== undefined) this.lastSeq = options.sinceSeq;

        const result = new Promise<ChannelHistoryResult>((resolve) => {
            this.historyWaiters.push(resolve);
        });
        await this.requestHistory(options.limit);
        return result;
    }

    /** Leave the channel and release every listener and timer. */
    async leave(): Promise<void> {
        this.stopHeartbeat();
        this.trackedState = null;
        this.presences = {};
        this.presenceHandlers.clear();
        this.broadcastHandlers.clear();
        // A rejoin is a fresh start: replaying from a watermark left over from
        // the previous membership would silently skip everything before it.
        this.lastSeq = 0;
        this.pendingLive = [];
        this.catchUpInFlight = false;
        if (this.catchUpTimeout) {
            clearTimeout(this.catchUpTimeout);
            this.catchUpTimeout = null;
        }
        for (const resolve of this.historyWaiters.splice(0)) {
            resolve({ messages: [], retained: false });
        }

        for (const off of this.unsubscribers) off();
        this.unsubscribers = [];

        if (this.joined) {
            this.joined = false;
            await this.send("leave_channel");
        }
    }

    private stopHeartbeat(): void {
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
            this.heartbeat = null;
        }
    }

    /** Fold an incoming frame into the roster and fan it out. */
    private handle(message: Record<string, unknown>): void {
        switch (message.type) {
            case "presence_state": {
                this.presences = (message.presences as PresenceState) ?? {};
                this.emitPresence();
                break;
            }
            case "presence_diff": {
                const joins = (message.joins as PresenceState) ?? {};
                const leaves = (message.leaves as PresenceState) ?? {};
                // A diff carries only what moved, so the roster is maintained
                // here rather than handed to callers to reassemble.
                for (const [id, state] of Object.entries(joins)) this.presences[id] = state;
                for (const id of Object.keys(leaves)) delete this.presences[id];
                this.emitPresence({ joins, leaves });
                break;
            }
            case "broadcast": {
                const seq = typeof message.seq === "number" ? message.seq : undefined;
                const event: BroadcastEvent = {
                    event: message.event as string,
                    payload: message.payload,
                    ...(seq !== undefined ? { seq } : {})
                };

                // Unsequenced channels keep the original behaviour exactly:
                // straight through, no buffering, no watermark.
                if (seq === undefined) {
                    this.deliver(event);
                    break;
                }

                if (this.catchUpInFlight) {
                    this.pendingLive.push(event);
                    break;
                }
                if (seq <= this.lastSeq) break; // already delivered
                this.lastSeq = seq;
                this.deliver(event);
                break;
            }
            case "channel_history": {
                this.catchUpInFlight = false;
                if (this.catchUpTimeout) {
                    clearTimeout(this.catchUpTimeout);
                    this.catchUpTimeout = null;
                }

                const entries = (message.messages as ChannelHistoryEntry[] | undefined) ?? [];
                const retained = message.retained === true;
                const latestSeq = typeof message.latestSeq === "number" ? message.latestSeq : undefined;

                for (const resolve of this.historyWaiters.splice(0)) {
                    resolve({ messages: entries, retained, latestSeq });
                }

                // Server-ordered ascending; the watermark check makes the
                // overlap with anything already seen a no-op rather than a
                // double-apply.
                for (const entry of entries) {
                    if (entry.seq <= this.lastSeq) continue;
                    this.lastSeq = entry.seq;
                    this.deliver({
                        event: entry.event,
                        payload: entry.payload,
                        seq: entry.seq,
                        replayed: true
                    });
                }

                this.flushPendingLive();
                break;
            }
            case "ERROR":
            case "error": {
                // The server refused something about this channel. Channel
                // frames are fire-and-forget — there is no promise to reject —
                // so this is where a refusal becomes visible.
                const payload = message.payload as { error?: unknown } | undefined;
                const raw = payload?.error;
                const asObject = typeof raw === "object" && raw !== null
                    ? raw as { message?: string; code?: string }
                    : undefined;
                const text = asObject?.message
                    ?? (typeof raw === "string" ? raw : undefined)
                    ?? (typeof message.error === "string" ? message.error : undefined)
                    ?? "The server refused a channel operation.";
                const error = new RebaseApiError(text, {
                    ...(asObject?.code ? { code: asObject.code } : {})
                });
                if (this.errorHandlers.size === 0) {
                    // Not silence: an unobserved refusal is exactly the failure
                    // this branch exists for.
                    console.warn(
                        `[Rebase] Channel "${this.name}" error${asObject?.code ? ` (${asObject.code})` : ""}: ${text}. ` +
                        "Attach `channel.onError(...)` to handle it."
                    );
                    break;
                }
                for (const handler of [...this.errorHandlers]) {
                    try {
                        handler(error);
                    } catch (e) {
                        console.error("Error in channel error handler:", e);
                    }
                }
                break;
            }
        }
    }

    /** Deliver everything held back during a catch-up, in sequence order. */
    private flushPendingLive(): void {
        if (this.pendingLive.length === 0) return;
        const buffered = this.pendingLive.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        this.pendingLive = [];
        for (const event of buffered) {
            const seq = event.seq;
            if (seq !== undefined) {
                if (seq <= this.lastSeq) continue;
                this.lastSeq = seq;
            }
            this.deliver(event);
        }
    }

    private deliver(event: BroadcastEvent): void {
        for (const handler of [...this.broadcastHandlers]) handler(event);
    }

    private emitPresence(diff?: PresenceDiff): void {
        const snapshot = { ...this.presences };
        for (const handler of this.presenceHandlers) handler(snapshot, diff);
    }
}
