/**
 * A dedicated, self-healing Postgres `LISTEN` connection.
 *
 * Every cross-instance feature in the backend needs the same thing: one
 * connection *outside* the Drizzle pool that stays open, holds a `LISTEN`, and
 * comes back on its own after the database or the network drops it. CDC needed
 * it first; the channel bus needs it too. This is that connection, with the one
 * behaviour that matters to callers preserved: the **first** connect is
 * validated and rethrown, so a caller can fall back to a different strategy,
 * while every later drop is repaired quietly in the background.
 *
 * `LISTEN` is session state, so this connection must not go through a
 * transaction-mode pooler (PgBouncer): give it the direct database URL.
 */

import { Client as PgClient } from "pg";
import { logger } from "@rebasepro/server";

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
}

const DEFAULT_RECONNECT_DELAY_MS = 3000;
/** Guards the identifier interpolated into `LISTEN`. */
const SAFE_CHANNEL = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class PgNotifyListener {
    private client?: PgClient;
    private running = false;
    private reconnectTimer?: ReturnType<typeof setTimeout>;

    constructor(private readonly options: PgNotifyListenerOptions) {
        if (!SAFE_CHANNEL.test(options.channel)) {
            throw new Error(`Unsafe NOTIFY channel name "${options.channel}" — expected a plain SQL identifier.`);
        }
    }

    /** Whether the listener is meant to be connected right now. */
    get active(): boolean {
        return this.running;
    }

    /**
     * Connect and begin listening. Idempotent.
     *
     * Rejects if the *initial* connection or `LISTEN` fails, leaving the
     * listener stopped — callers use that to degrade deliberately instead of
     * running blind against a channel nothing is delivering.
     */
    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            await this.connect({ initial: true });
        } catch (err) {
            this.running = false;
            throw err;
        }
    }

    /** Stop listening and release the connection. Idempotent. */
    async stop(): Promise<void> {
        this.running = false;
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

    private async connect({ initial = false }: { initial?: boolean } = {}): Promise<void> {
        const { connectionString, channel, onPayload, logLabel } = this.options;
        // Held here rather than only inside the `try` so the failure path can
        // still reach it: everything below `connect()` can throw, and until
        // `this.client` is assigned nothing else in this class knows the
        // connection exists. Left unreleased it stays open on the server while
        // `scheduleReconnect` opens another — one leaked backend per attempt,
        // every few seconds, for as long as the failure lasts.
        let pending: PgClient | undefined;
        try {
            const client = new PgClient({ connectionString });
            pending = client;

            client.on("error", (err) => {
                logger.error(`❌ ${logLabel} LISTEN client error`, { detail: err.message });
                this.scheduleReconnect();
            });

            client.on("end", () => {
                if (this.running) {
                    logger.warn(`⚠️ ${logLabel} LISTEN client disconnected unexpectedly.`);
                    this.scheduleReconnect();
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
            logger.debug(`📡 ${logLabel} Listening on channel "${channel}".`);
        } catch (err) {
            // Never adopted, so nothing else will ever close it.
            if (pending) {
                try { await pending.end(); } catch { /* already dead */ }
            }
            // Surface the initial failure so callers can choose to fall back;
            // for reconnects, keep retrying quietly in the background.
            if (initial) throw err;
            logger.error(`❌ ${logLabel} Failed to connect LISTEN client`, { error: err });
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        if (!this.running || this.reconnectTimer) return;

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = undefined;
            if (!this.running) return;
            if (this.client) {
                try { await this.client.end(); } catch { /* ignore */ }
                this.client = undefined;
            }
            await this.connect();
        }, this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS);
    }
}
