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

export class RebaseRealtimeChannel {
    private presenceHandlers = new Set<(state: PresenceState, diff?: PresenceDiff) => void>();
    private broadcastHandlers = new Set<(event: BroadcastEvent) => void>();
    private unsubscribers: (() => void)[] = [];

    /** Last known roster, kept so handlers always get a full picture. */
    private presences: PresenceState = {};
    /** What this client last tracked, replayed on reconnect and heartbeat. */
    private trackedState: Record<string, unknown> | null = null;
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    private joined = false;

    constructor(
        public readonly name: string,
        private transport: ChannelTransport
    ) {}

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
    }

    private async rejoin(): Promise<void> {
        try {
            await this.send("join_channel");
            await this.send("presence_state");
            if (this.trackedState) {
                await this.send("presence_track", { state: this.trackedState });
            }
        } catch {
            // The socket is down again; the next reconnect will retry.
        }
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

    /** Send a broadcast. The sender does not receive its own message. */
    async broadcast(event: string, payload: unknown): Promise<void> {
        await this.join();
        await this.send("broadcast", { event, payload });
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

    /** Leave the channel and release every listener and timer. */
    async leave(): Promise<void> {
        this.stopHeartbeat();
        this.trackedState = null;
        this.presences = {};
        this.presenceHandlers.clear();
        this.broadcastHandlers.clear();

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
                const event = { event: message.event as string, payload: message.payload };
                for (const handler of this.broadcastHandlers) handler(event);
                break;
            }
        }
    }

    private emitPresence(diff?: PresenceDiff): void {
        const snapshot = { ...this.presences };
        for (const handler of this.presenceHandlers) handler(snapshot, diff);
    }
}
