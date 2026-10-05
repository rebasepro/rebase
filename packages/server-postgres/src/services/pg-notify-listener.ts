/**
 * A dedicated, self-healing Postgres `LISTEN` connection.
 *
 * Every cross-instance feature in the backend needs the same thing: one
 * connection *outside* the Drizzle pool that stays open, holds a `LISTEN`, and
 * comes back on its own after the database or the network drops it. CDC, the
 * channel bus and the cross-instance broadcast all use this one. By default the
 * **first** connect is validated and rethrown, so a caller can fall back to a
 * different strategy, while every later drop is repaired quietly in the
 * background; `retryInitialConnect` repairs the first one the same way.
 *
 * `LISTEN` is session state, so this connection must not go through a
 * transaction-mode pooler (PgBouncer): give it the direct database URL.
 */

import { Client as PgClient } from "pg";
import { logger } from "@rebasepro/server";
import { unref } from "@rebasepro/utils";

export interface PgNotifyListenerOptions {
    /** Direct Postgres connection string (must bypass a transaction-mode pooler). */
    connectionString: string;
    /** NOTIFY channel to LISTEN on. Must be a plain identifier — it is interpolated. */
    channel: string;
    /** Called for every notification payload received. */
    onPayload: (payload: string) => void | Promise<void>;
    /** Prefix for log lines, e.g. `"[CDC]"`. */
    logLabel: string;
    /** Delay before a reconnect attempt. */
    reconnectDelayMs?: number;
    /**
     * Called once the connection is listening again after a drop — never after
     * the first connect. Postgres keeps no NOTIFY for a session that is not
     * listening, so whatever was published while the connection was down is
     * gone for good; a caller that mirrors state from the channel resyncs here.
     */
    onReconnect?: () => void;
    /**
     * How often the connection proves it is alive with a round trip. `0`
     * turns the heartbeat off. See {@link PgNotifyListener} for why it exists.
     */
    heartbeatIntervalMs?: number;
    /** How long a heartbeat may take before the connection is declared dead. */
    heartbeatTimeoutMs?: number;
    /**
     * Treat a failed first connect like any later drop: `start()` resolves,
     * the listener reports itself down, and it keeps dialling in the
     * background. For a caller with nothing to fall back to, for whom a
     * database that is unreachable at boot is an outage to wait out rather
     * than a reason to run without the channel. Off by default: `start()`
     * rejects, so a caller with a fallback can take it.
     */
    retryInitialConnect?: boolean;
}

/**
 * What a listener can say about itself — read by `/health`.
 *
 * `connected` is "listening, and the last heartbeat answered", not "a socket
 * object exists": a half-open connection has a perfectly good socket object.
 */
export interface PgNotifyListenerStatus {
    channel: string;
    connected: boolean;
    /** Since when (epoch ms) it has been down, while it is down. */
    downSince?: number;
    /** When (epoch ms) it last answered a heartbeat. */
    lastHeartbeatAt?: number;
}

const DEFAULT_RECONNECT_DELAY_MS = 3000;
/**
 * Below every common idle-flow timeout: Azure's load balancer drops an idle
 * flow at 4 minutes, AWS's NLB at 350 s, and NAT and conntrack tables and
 * pooler-side reapers are often shorter. A LISTEN connection is idle by
 * nature, so it is exactly the connection those timeouts kill.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;
/** Guards the identifier interpolated into `LISTEN`. */
const SAFE_CHANNEL = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A half-open connection — one whose packets stop arriving, with no FIN and no
 * RST, which is what an idle-flow timeout on a load balancer, a NAT, a dead
 * middlebox or a failed-over network looks like — fires no `error` and no
 * `end`. The connection object stays, `LISTEN` stays registered on a backend
 * that may no longer exist, and every notification from then on is lost: CDC,
 * the cross-instance broadcast and the channel bus all went quiet with no
 * error, no reconnect and a green `/health`, while writes made through this
 * instance still looked live because they are delivered locally.
 *
 * So the connection proves itself: TCP keepalive is on, and every
 * {@link DEFAULT_HEARTBEAT_INTERVAL_MS} a `SELECT 1` must come back within
 * {@link DEFAULT_HEARTBEAT_TIMEOUT_MS}. One that does not is torn down and
 * replaced, and `onReconnect` resyncs whatever was missed.
 */
export class PgNotifyListener {
    private client?: PgClient;
    private running = false;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private heartbeatTimer?: ReturnType<typeof setInterval>;
    private heartbeatInFlight = false;
    private downSince?: number;
    private lastHeartbeatAt?: number;

    constructor(private readonly options: PgNotifyListenerOptions) {
        if (!SAFE_CHANNEL.test(options.channel)) {
            throw new Error(`Unsafe NOTIFY channel name "${options.channel}" — expected a plain SQL identifier.`);
        }
    }

    /** Whether the listener is meant to be connected right now. */
    get active(): boolean {
        return this.running;
    }

    /** Whether it is listening on a connection that answered its last heartbeat. */
    get connected(): boolean {
        return this.running && this.client !== undefined;
    }

    status(): PgNotifyListenerStatus {
        return {
            channel: this.options.channel,
            connected: this.connected,
            ...(this.downSince !== undefined && !this.connected ? { downSince: this.downSince } : {}),
            ...(this.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: this.lastHeartbeatAt } : {})
        };
    }

    /**
     * Connect and begin listening. Idempotent.
     *
     * Rejects if the *initial* connection or `LISTEN` fails, leaving the
     * listener stopped — callers use that to degrade deliberately instead of
     * running blind against a channel nothing is delivering. With
     * `retryInitialConnect` it resolves instead, reports itself down, and
     * keeps dialling.
     */
    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            await this.connect({ first: true });
        } catch (err) {
            this.running = false;
            throw err;
        }
    }

    /** Stop listening and release the connection. Idempotent. */
    async stop(): Promise<void> {
        this.running = false;
        this.stopHeartbeat();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        if (this.client) {
            try {
                await this.client.end();
            } catch { /* ignore close errors */ }
            this.client = undefined;
        }
    }

    /**
     * @param first The connect `start()` makes: never a reconnect, so it owes
     *        no resync, and — unless `retryInitialConnect` — a failure is
     *        thrown to the caller rather than retried.
     */
    private async connect({ first = false }: { first?: boolean } = {}): Promise<void> {
        const { connectionString, channel, onPayload, logLabel } = this.options;
        // Held here rather than only inside the `try` so the failure path can
        // still reach it: everything below `connect()` can throw, and until
        // `this.client` is assigned nothing else in this class knows the
        // connection exists. Left unreleased it stays open on the server while
        // `scheduleReconnect` opens another — one leaked backend per attempt,
        // every few seconds, for as long as the failure lasts.
        let pending: PgClient | undefined;
        try {
            // TCP keepalive as well as the heartbeat below: it costs nothing,
            // and it is what eventually errors a dead socket the heartbeat
            // has already given up on.
            const client = new PgClient({ connectionString, keepAlive: true, keepAliveInitialDelayMillis: 30_000 });
            pending = client;

            // Events from a connection already given up on — torn down after
            // a missed heartbeat, say — are not news about the current one.
            client.on("error", (err) => {
                if (client !== this.client) return;
                logger.error(`❌ ${logLabel} LISTEN client error`, { detail: err.message });
                this.abandon(client);
            });

            client.on("end", () => {
                if (client !== this.client) return;
                if (this.running) {
                    logger.warn(`⚠️ ${logLabel} LISTEN client disconnected unexpectedly.`);
                    this.abandon(client);
                }
            });

            client.on("notification", (msg) => {
                if (!msg.payload) return;
                // A handler rejection must never surface as an unhandled
                // rejection inside the pg client's event emitter.
                Promise.resolve(onPayload(msg.payload)).catch((err) =>
                    logger.error(`❌ ${logLabel} Error handling notification`, { error: err })
                );
            });

            await client.connect();
            await client.query(`LISTEN ${channel}`);
            this.client = client;
            // Adopted: `stop()` and `scheduleReconnect` will close it now.
            pending = undefined;
            this.downSince = undefined;
            this.lastHeartbeatAt = Date.now();
            this.startHeartbeat(client);
            logger.debug(`📡 ${logLabel} Listening on channel "${channel}".`);
        } catch (err) {
            // Never adopted, so nothing else will ever close it.
            if (pending) {
                try { await pending.end(); } catch { /* already dead */ }
            }
            // Surface the initial failure so callers can choose to fall back;
            // for reconnects, keep retrying quietly in the background.
            if (first && !this.options.retryInitialConnect) throw err;
            logger.error(`❌ ${logLabel} Failed to connect LISTEN client`, { error: err });
            this.scheduleReconnect();
            return;
        }
        // Outside the `try`: a throwing handler is not a failed connection,
        // and must not tear down the one that just came back.
        if (!first && this.options.onReconnect) {
            logger.warn(`⚠️ ${logLabel} LISTEN client reconnected; anything published while it was down was missed.`);
            try {
                this.options.onReconnect();
            } catch (err) {
                logger.error(`❌ ${logLabel} Error resyncing after a reconnect`, { error: err });
            }
        }
    }

    /**
     * Give up on the current connection: it is no longer the listener's, so
     * its late events are ignored and `connected` says so at once; it is
     * ended without waiting on it; and a replacement is scheduled.
     */
    private abandon(client: PgClient): void {
        if (client !== this.client) return;
        this.client = undefined;
        this.downSince ??= Date.now();
        this.stopHeartbeat();
        void client.end().catch(() => { /* already dead */ });
        this.scheduleReconnect();
    }

    private startHeartbeat(client: PgClient): void {
        this.stopHeartbeat();
        const interval = this.options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
        if (interval <= 0) return;
        this.heartbeatTimer = setInterval(() => void this.heartbeat(client), interval);
        // Housekeeping must never hold the process open.
        unref(this.heartbeatTimer);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
        this.heartbeatInFlight = false;
    }

    /**
     * One round trip on the LISTEN connection. Not answered in time, it is
     * treated as dead: the client is ended — which, with the query still
     * outstanding, destroys the socket rather than waiting on a goodbye that
     * cannot arrive — and replaced.
     */
    private async heartbeat(client: PgClient): Promise<void> {
        if (client !== this.client || this.heartbeatInFlight) return;
        this.heartbeatInFlight = true;
        const timeoutMs = this.options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                client.query("SELECT 1"),
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error(`no answer in ${timeoutMs}ms`)), timeoutMs);
                })
            ]);
            if (client === this.client) this.lastHeartbeatAt = Date.now();
        } catch (err) {
            if (client !== this.client) return;
            logger.warn(
                `⚠️ ${this.options.logLabel} LISTEN connection failed its heartbeat (${err instanceof Error ? err.message : String(err)}) — ` +
                "treating it as dead and reconnecting."
            );
            this.abandon(client);
        } finally {
            if (timer) clearTimeout(timer);
            if (client === this.client) this.heartbeatInFlight = false;
        }
    }

    private scheduleReconnect(): void {
        if (!this.running || this.reconnectTimer) return;
        this.downSince ??= Date.now();

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = undefined;
            if (!this.running) return;
            await this.connect();
        }, this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS);
    }
}
