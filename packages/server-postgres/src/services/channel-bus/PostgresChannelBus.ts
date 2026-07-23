/**
 * Channel bus over Postgres LISTEN/NOTIFY.
 *
 * Chosen because it needs nothing that a Rebase deployment does not already
 * have — the same database, the same direct URL the CDC listener uses. Three
 * properties of `NOTIFY` shape everything below:
 *
 *  - **8000 bytes per payload.** Presence and cursors fit with room to spare; a
 *    scene snapshot does not. Rather than truncate or drop, an oversized frame
 *    on a *retained* channel is published as a pointer — the body is already in
 *    `rebase.channel_messages` with a sequence number, so the receiver reads it
 *    back. That is the same trick the entity path uses (notify an address,
 *    refetch the row), applied to a different table. On an ephemeral channel
 *    there is nothing to point at, so the publish is refused loudly instead of
 *    reaching some instances and not others.
 *
 *  - **A notify is a query on the primary database.** Not a slow one, but it
 *    competes with the application's real queries, and that — not throughput —
 *    is what actually limits this transport. Measured, it carried ~10k
 *    cross-instance messages/second and stayed flat out to eight instances; what
 *    it should not do is spend 10k queries/second of the database's budget on
 *    cursor movement. Hence the batching below.
 *
 *  - **Delivery is best-effort.** Retained channels repair themselves through
 *    the client's history replay, so a lost frame costs a live update rather
 *    than correctness. That is what makes coalescing safe.
 */

import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { logger } from "@rebasepro/server";
import { PgNotifyListener } from "../pg-notify-listener";
import { ChannelBus, ChannelBusFrame, ChannelBusHandler, frameByteLength } from "./ChannelBus";

/** NOTIFY channel carrying channel-bus frames. */
export const CHANNEL_BUS_NOTIFY_CHANNEL = "rebase_channel_bus";

/**
 * Postgres refuses a NOTIFY payload of 8000 bytes or more. The margin below it
 * is for nothing in particular — it is there so that a payload which passes this
 * check cannot fail at the server for being a few bytes over.
 */
export const PG_NOTIFY_MAX_PAYLOAD_BYTES = 7500;

/**
 * How long a batching window stays open.
 *
 * Ten milliseconds is below the threshold where a human notices a cursor lag,
 * and it is the difference between one query per message and one query per
 * window under load. Set to 0 to disable coalescing entirely.
 */
export const DEFAULT_BATCH_WINDOW_MS = 10;

/** JSON overhead per frame inside a batch: the wrapping array's comma. */
const BATCH_SEPARATOR_BYTES = 1;
/** JSON overhead of the batch envelope itself: `{"batch":[]}`. */
const BATCH_ENVELOPE_BYTES = 12;

interface PendingFrame {
    frame: ChannelBusFrame;
    bytes: number;
    resolve: () => void;
    reject: (error: unknown) => void;
}

export class PostgresChannelBus implements ChannelBus {
    readonly kind = "postgres" as const;
    readonly maxFrameBytes = PG_NOTIFY_MAX_PAYLOAD_BYTES;

    private listener?: PgNotifyListener;
    private readonly batchWindowMs: number;

    /**
     * Frames waiting for the current window to close.
     *
     * The window is opened by a publish that found none open, and that publish
     * is sent *immediately* rather than joining a batch — see {@link publish}.
     */
    private pending: PendingFrame[] = [];
    private pendingBytes = BATCH_ENVELOPE_BYTES;
    private windowTimer?: ReturnType<typeof setTimeout>;
    private stopped = false;

    constructor(
        private readonly db: NodePgDatabase<Record<string, unknown>>,
        private readonly connectionString: string,
        options: { batchWindowMs?: number } = {}
    ) {
        const configured = options.batchWindowMs;
        this.batchWindowMs = typeof configured === "number" && configured >= 0
            ? configured
            : DEFAULT_BATCH_WINDOW_MS;
    }

    async start(handler: ChannelBusHandler): Promise<void> {
        this.stopped = false;
        this.listener = new PgNotifyListener({
            connectionString: this.connectionString,
            channel: CHANNEL_BUS_NOTIFY_CHANNEL,
            logLabel: "[ChannelBus]",
            onPayload: async (payload) => {
                const frames = parseChannelBusPayload(payload);
                if (!frames.length) {
                    logger.warn("⚠️ [ChannelBus] Dropping unparseable payload.");
                    return;
                }
                // In order: a batch preserves the sender's publish order, and a
                // retained channel's consumers rely on it.
                for (const frame of frames) await handler(frame);
            }
        });
        await this.listener.start();
    }

    /**
     * Publish, coalescing under load.
     *
     * The window is *leading edge*: a publish arriving when no window is open is
     * sent straight away and opens one, so an idle channel pays no added latency
     * at all. Frames arriving while it is open are collected and leave together
     * when it closes. The effect is that cost tracks elapsed time rather than
     * message count — one query per window instead of one per message — which is
     * the same shape as the retention pruning throttle, for the same reason.
     *
     * The returned promise settles when the frame has actually left, not when it
     * was queued, so the contract ("reaches the other instances, or rejects")
     * still holds.
     */
    async publish(frame: ChannelBusFrame): Promise<void> {
        if (this.batchWindowMs === 0 || this.stopped) {
            await this.send([frame]);
            return;
        }

        if (!this.windowTimer) {
            this.openWindow();
            await this.send([frame]);
            return;
        }

        const bytes = frameByteLength(frame) + BATCH_SEPARATOR_BYTES;

        // A batch is one NOTIFY payload, so the 8 KB ceiling applies to the
        // whole batch. Send what we have rather than let the frame push it over.
        if (this.pending.length && this.pendingBytes + bytes > this.maxFrameBytes) {
            this.flush();
        }

        return new Promise<void>((resolve, reject) => {
            this.pending.push({ frame, bytes, resolve, reject });
            this.pendingBytes += bytes;
        });
    }

    async stop(): Promise<void> {
        this.stopped = true;
        if (this.windowTimer) {
            clearTimeout(this.windowTimer);
            this.windowTimer = undefined;
        }
        // Anything still queued belongs to clients that are already waiting on
        // it; dropping it on shutdown would be a silent loss where a flush costs
        // one more query.
        this.flush();
        await this.listener?.stop();
        this.listener = undefined;
    }

    private openWindow(): void {
        this.windowTimer = setTimeout(() => {
            this.windowTimer = undefined;
            if (this.pending.length) {
                // Still busy: send this window's frames and open the next one,
                // so a sustained stream keeps costing one query per window.
                this.flush();
                this.openWindow();
            }
            // Otherwise leave it closed, so the next publish after a quiet
            // moment goes out immediately.
        }, this.batchWindowMs);

        // Housekeeping must never hold the process open.
        (this.windowTimer as unknown as { unref?: () => void }).unref?.();
    }

    /** Send everything queued and settle the promises waiting on it. */
    private flush(): void {
        if (!this.pending.length) return;

        const batch = this.pending;
        this.pending = [];
        this.pendingBytes = BATCH_ENVELOPE_BYTES;

        this.send(batch.map(p => p.frame))
            .then(() => { for (const p of batch) p.resolve(); })
            .catch((error) => { for (const p of batch) p.reject(error); });
    }

    /**
     * One NOTIFY.
     *
     * A single frame goes out in the plain, unwrapped shape. That is not just
     * economy: during a rolling deploy an instance running the previous build
     * understands only that shape, and low-rate traffic — presence, the tail of
     * a session — is exactly what is flowing while pods restart. Batching only
     * appears under load, which shrinks the mixed-version window to almost
     * nothing.
     */
    private async send(frames: ChannelBusFrame[]): Promise<void> {
        if (!frames.length) return;
        const payload = frames.length === 1
            ? JSON.stringify(frames[0])
            : JSON.stringify({ batch: frames });

        await this.db.execute(sql`SELECT pg_notify(${CHANNEL_BUS_NOTIFY_CHANNEL}, ${payload})`);
    }
}

/**
 * Parse a bus payload into the frames it carries.
 *
 * Accepts both wire shapes — a bare frame and a `{ batch: [...] }` envelope —
 * so an instance on the new build understands one on the old. Returns an empty
 * array for anything unrecognisable: a malformed or future-versioned message
 * must never take the listener down.
 */
export function parseChannelBusPayload(payload: string): ChannelBusFrame[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(payload);
    } catch {
        return [];
    }
    if (!parsed || typeof parsed !== "object") return [];

    const batch = (parsed as { batch?: unknown }).batch;
    if (Array.isArray(batch)) {
        return batch
            .map(entry => coerceFrame(entry))
            .filter((frame): frame is ChannelBusFrame => frame !== null);
    }

    const single = coerceFrame(parsed);
    return single ? [single] : [];
}

/**
 * Parse a single bus frame, returning null for anything that is not a frame we
 * understand.
 */
export function parseChannelBusFrame(payload: string): ChannelBusFrame | null {
    try {
        return coerceFrame(JSON.parse(payload));
    } catch {
        return null;
    }
}

function coerceFrame(value: unknown): ChannelBusFrame | null {
    if (!value || typeof value !== "object") return null;

    const obj = value as Record<string, unknown>;
    const sid = typeof obj.sid === "string" ? obj.sid : undefined;
    const channel = typeof obj.channel === "string" ? obj.channel : undefined;
    if (!sid || !channel) return null;

    switch (obj.kind) {
        case "broadcast":
            if (typeof obj.event !== "string") return null;
            return {
                kind: "broadcast",
                sid,
                channel,
                event: obj.event,
                from: typeof obj.from === "string" ? obj.from : undefined,
                seq: typeof obj.seq === "number" ? obj.seq : undefined,
                payload: obj.payload
            };
        case "broadcast_ref":
            if (typeof obj.seq !== "number") return null;
            return {
                kind: "broadcast_ref",
                sid,
                channel,
                from: typeof obj.from === "string" ? obj.from : undefined,
                seq: obj.seq
            };
        case "presence_diff":
            return {
                kind: "presence_diff",
                sid,
                channel,
                joins: (obj.joins ?? {}) as Record<string, Record<string, unknown>>,
                leaves: (obj.leaves ?? {}) as Record<string, Record<string, unknown>>
            };
        default:
            return null;
    }
}
