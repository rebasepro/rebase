import { Client as PgClient } from "pg";
import { logger } from "@rebasepro/server";
import { CDC_CHANNEL } from "./trigger-cdc";

/**
 * A single database change captured by the CDC triggers and delivered over the
 * `rebase_cdc` NOTIFY channel.
 */
export interface CdcChangeEvent {
    schema: string;
    table: string;
    op: "INSERT" | "UPDATE" | "DELETE";
    /**
     * The changed tuple (NEW for insert/update, OLD for delete). May be a
     * partial identity-only object when the full row overflowed the pg_notify
     * size cap — see {@link truncated}.
     */
    row: Record<string, unknown>;
    /** True when the row was reduced to its identity because it was too large to notify. */
    truncated?: boolean;
}

/**
 * Parse a `rebase_cdc` NOTIFY payload. Returns `null` for anything malformed so
 * a single bad message can never crash the listener.
 */
export function parseCdcPayload(payload: string): CdcChangeEvent | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(payload);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;

    const obj = parsed as Record<string, unknown>;
    const schema = typeof obj.schema === "string" ? obj.schema : undefined;
    const table = typeof obj.table === "string" ? obj.table : undefined;
    const op = obj.op;
    if (!schema || !table) return null;
    if (op !== "INSERT" && op !== "UPDATE" && op !== "DELETE") return null;

    const row = obj.row && typeof obj.row === "object" ? (obj.row as Record<string, unknown>) : {};

    return {
        schema,
        table,
        op,
        row,
        truncated: obj.truncated === true
    };
}

/**
 * Dedicated Postgres LISTEN client for database-level CDC.
 *
 * Mirrors the resilience of the RealtimeService cross-instance LISTEN client: a
 * standalone `pg.Client` (outside the Drizzle pool) that stays connected, and
 * transparently reconnects on error/disconnect. Each backend instance runs one,
 * so every instance observes every committed change regardless of which
 * instance (or external process) made the write.
 */
export class CdcListener {
    private client?: PgClient;
    private running = false;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private static readonly RECONNECT_DELAY_MS = 3000;

    constructor(
        private readonly connectionString: string,
        private readonly onEvent: (event: CdcChangeEvent) => void | Promise<void>
    ) {}

    /**
     * Connect and begin listening. Idempotent.
     *
     * The **initial** connection is validated synchronously: if it cannot be
     * established (or `LISTEN` is refused), this rejects so callers — notably
     * `REALTIME_CDC=auto` — can detect an unusable connection and fall back to
     * app-level realtime. Once the initial connection succeeds, later drops
     * self-heal via {@link scheduleReconnect}.
     */
    async start(): Promise<void> {
        if (this.running) {
            logger.warn("⚠️ [CDC] CdcListener.start() called but already running. Ignoring.");
            return;
        }
        this.running = true;
        try {
            await this.connect({ initial: true });
        } catch (err) {
            this.running = false;
            throw err;
        }
    }

    /** Stop listening and release the connection. */
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
        try {
            const client = new PgClient({ connectionString: this.connectionString });

            client.on("error", (err) => {
                logger.error("❌ [CDC] LISTEN client error", { detail: err.message });
                this.scheduleReconnect();
            });

            client.on("end", () => {
                if (this.running) {
                    logger.warn("⚠️ [CDC] LISTEN client disconnected unexpectedly.");
                    this.scheduleReconnect();
                }
            });

            client.on("notification", (msg) => {
                if (!msg.payload) return;
                const event = parseCdcPayload(msg.payload);
                if (!event) {
                    logger.warn("⚠️ [CDC] Dropping unparseable change notification.");
                    return;
                }
                // Never let a handler rejection escape into the pg client.
                Promise.resolve(this.onEvent(event)).catch((err) =>
                    logger.error("❌ [CDC] Error handling change event", { error: err })
                );
            });

            await client.connect();
            await client.query(`LISTEN ${CDC_CHANNEL}`);
            this.client = client;
            logger.info(`📡 [CDC] Listening for database changes on channel "${CDC_CHANNEL}".`);
        } catch (err) {
            // Surface the initial failure so callers can choose to fall back;
            // for reconnects, keep retrying quietly in the background.
            if (initial) throw err;
            logger.error("❌ [CDC] Failed to connect LISTEN client", { error: err });
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
        }, CdcListener.RECONNECT_DELAY_MS);
    }
}
