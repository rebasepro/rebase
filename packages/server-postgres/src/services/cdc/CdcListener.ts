import { logger } from "@rebasepro/server";
import { CDC_CHANNEL } from "./trigger-cdc";
import { PgNotifyListener, type PgNotifyListenerStatus } from "../pg-notify-listener";

/**
 * A single database change captured by the CDC triggers and delivered over the
 * `rebase_cdc` NOTIFY channel — one row of a notification, which may name many.
 */
export interface CdcChangeEvent {
    schema: string;
    table: string;
    /** `TRUNCATE` changed every row, and `row` is empty. */
    op: "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE";
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

const OPS = new Set(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]);

/**
 * Parse a `rebase_cdc` NOTIFY payload into the changes it names, one per row.
 * Returns `null` for anything malformed so a single bad message can never
 * crash the listener.
 *
 * Reads every shape a capture trigger sends, whichever version installed it —
 * during a rolling deploy the database's triggers and this instance need not
 * be the same version:
 *  - `{ schema, table, op, row }` — one row: the row trigger, and a statement
 *    that changed one row;
 *  - `{ schema, table, op, cols, keys }` — a statement's rows in a batch. With
 *    one column a key is the value; with several, an array in `cols` order;
 *  - `{ schema, table, op: "TRUNCATE" }`.
 */
export function parseCdcPayload(payload: string): CdcChangeEvent[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(payload);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const obj = parsed as Record<string, unknown>;
    const schema = typeof obj.schema === "string" ? obj.schema : undefined;
    const table = typeof obj.table === "string" ? obj.table : undefined;
    const op = obj.op;
    if (!schema || !table) return null;
    if (typeof op !== "string" || !OPS.has(op)) return null;
    const kind = op as CdcChangeEvent["op"];

    if (kind === "TRUNCATE") return [{ schema, table, op: kind, row: {}, truncated: false }];

    if (Array.isArray(obj.keys)) {
        const cols = obj.cols;
        if (!Array.isArray(cols) || cols.length === 0 || !cols.every((col) => typeof col === "string")) return null;
        const names = cols as string[];
        const events: CdcChangeEvent[] = [];
        for (const key of obj.keys) {
            let row: Record<string, unknown>;
            if (names.length === 1) {
                row = { [names[0]]: key };
            } else {
                if (!Array.isArray(key) || key.length !== names.length) return null;
                row = {};
                names.forEach((name, i) => { row[name] = key[i]; });
            }
            events.push({ schema, table, op: kind, row, truncated: false });
        }
        return events;
    }

    const row = obj.row && typeof obj.row === "object" && !Array.isArray(obj.row) ? (obj.row as Record<string, unknown>) : {};
    return [{
        schema,
        table,
        op: kind,
        row,
        truncated: obj.truncated === true
    }];
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
        onEvents: (events: CdcChangeEvent[]) => void | Promise<void>,
        onReconnect?: () => void,
        applicationName?: string
    ) {
        this.listener = new PgNotifyListener({
            connectionString,
            channel: CDC_CHANNEL,
            logLabel: "[CDC]",
            onReconnect,
            applicationName,
            onPayload: (payload) => {
                const events = parseCdcPayload(payload);
                if (!events) {
                    logger.warn("⚠️ [CDC] Dropping unparseable change notification.");
                    return;
                }
                return onEvents(events);
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
