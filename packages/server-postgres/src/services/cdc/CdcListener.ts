import { logger } from "@rebasepro/server";
import { CDC_CHANNEL } from "./trigger-cdc";
import { PgNotifyListener, type PgNotifyListenerStatus } from "../pg-notify-listener";

/**
 * A single database change captured by the CDC triggers and delivered over the
 * `rebase_cdc` NOTIFY channel.
 */
export interface CdcChangeEvent {
    schema: string;
    table: string;
    op: "INSERT" | "UPDATE" | "DELETE";
    /**
     * The changed row's identity, by column: its key, and for a junction table
     * the two ids naming the child list (from NEW for insert/update, OLD for
     * delete). Never the row's other values — any login can LISTEN; see
     * `buildCdcFunctionSql`.
     */
    row: Record<string, unknown>;
    /** True when even the key was too large to notify, so `row` is empty. */
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
 * A {@link PgNotifyListener} — a connection outside the Drizzle pool that stays
 * open and repairs itself — plus the parsing that turns a `rebase_cdc` payload
 * into a change event. Each backend instance runs one, so every instance
 * observes every committed change regardless of which instance (or external
 * process) made the write.
 */
export class CdcListener {
    private readonly listener: PgNotifyListener;

    /**
     * @param onReconnect Called when the connection is listening again after a
     *        drop. Every change committed in the gap was notified to nobody, so
     *        this is where subscribers are told to look again.
     */
    constructor(
        connectionString: string,
        onEvent: (event: CdcChangeEvent) => void | Promise<void>,
        onReconnect?: () => void
    ) {
        this.listener = new PgNotifyListener({
            connectionString,
            channel: CDC_CHANNEL,
            logLabel: "[CDC]",
            onReconnect,
            onPayload: (payload) => {
                const event = parseCdcPayload(payload);
                if (!event) {
                    logger.warn("⚠️ [CDC] Dropping unparseable change notification.");
                    return;
                }
                return onEvent(event);
            }
        });
    }

    /**
     * Connect and begin listening. Idempotent.
     *
     * The **initial** connection is validated synchronously: if it cannot be
     * established (or `LISTEN` is refused), this rejects so callers — notably
     * `REALTIME_CDC=auto` — can detect an unusable connection and fall back to
     * app-level realtime. Once the initial connection succeeds, later drops
     * self-heal in the background.
     */
    async start(): Promise<void> {
        if (this.listener.active) {
            logger.warn("⚠️ [CDC] CdcListener.start() called but already running. Ignoring.");
            return;
        }
        await this.listener.start();
    }

    /** Stop listening and release the connection. */
    async stop(): Promise<void> {
        await this.listener.stop();
    }

    /** Listening on a connection that answered its last heartbeat — see {@link PgNotifyListener}. */
    get connected(): boolean {
        return this.listener.connected;
    }

    status(): PgNotifyListenerStatus {
        return this.listener.status();
    }
}
