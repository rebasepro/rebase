/**
 * Channel bus over Postgres LISTEN/NOTIFY.
 *
 * Chosen because it needs nothing that a Rebase deployment does not already
 * have — the same database, the same direct URL the CDC listener uses. Three
 * properties of `NOTIFY` shape everything below:
 *
 *  - **8000 bytes per payload.** Presence and cursors fit with room to spare; a
 *    scene snapshot does not. A message on a *retained* channel never travels
 *    here at all, whatever its size: the statement that numbers it notifies a
 *    pointer — the body is already in `rebase.channel_messages` with a sequence
 *    number, so the receiver reads it back (`ChannelHistoryStore.append`). That
 *    is the same trick the entity path uses (notify an address, refetch the
 *    row), applied to a different table, and for the same reason: any database
 *    login can `LISTEN`. On an ephemeral channel there is nothing to point at,
 *    so a frame over the ceiling is cut into parts that leave together, in one
 *    statement, and each instance puts them back together (see
 *    {@link FrameAssembler}). It used to be refused instead: delivered on the
 *    sender's instance and nowhere else, with an error frame to a sender that
 *    had no reason to read one — a game screen's ~10 KB state reached the
 *    phones on its own pod and silently never the others. Only a frame over
 *    {@link PG_BUS_MAX_FRAME_BYTES} is refused now.
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

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { logger } from "@rebasepro/server";
import { PgNotifyListener, type PgNotifyListenerStatus } from "../pg-notify-listener";
import { ChannelBus, ChannelBusFrame, ChannelBusHandler, frameByteLength } from "./ChannelBus";
import { unref } from "@rebasepro/utils";
import type { PgSqlDatabase } from "../../interfaces";

/** NOTIFY channel carrying channel-bus frames. */
export const CHANNEL_BUS_NOTIFY_CHANNEL = "rebase_channel_bus";

/**
 * Postgres refuses a NOTIFY payload of 8000 bytes or more. The margin below it
 * is for nothing in particular — it is there so that a payload which passes this
 * check cannot fail at the server for being a few bytes over.
 */
export const PG_NOTIFY_MAX_PAYLOAD_BYTES = 7500;

/**
 * The largest frame the Postgres bus carries, cut into parts, in bytes of
 * encoded JSON. A frame larger than this is refused to its sender, as every
 * oversized frame used to be. One MiB is ~190 notifications in one statement:
 * far past any state a realtime app should broadcast, short of making the bus
 * a file transfer.
 */
export const PG_BUS_MAX_FRAME_BYTES = 1024 * 1024;

/**
 * Base64 characters of a frame per part. The envelope around them
 * (`{"part":{"id":"…","i":…,"n":…,"data":"…"}}`) stays under 100 bytes, so a
 * part is always under {@link PG_NOTIFY_MAX_PAYLOAD_BYTES}.
 */
const PART_DATA_CHARS = 7200;

/** A frame whose parts have not all arrived after this long is given up on, in ms. */
const PART_ASSEMBLY_TIMEOUT_MS = 30_000;

/**
 * How many bytes of unfinished parts an instance holds at most. Past it the
 * oldest unfinished frame is dropped: parts from one statement arrive
 * together, so a frame that waits at all has lost a part, and memory must not
 * be what an unlucky reconnect costs.
 */
const MAX_PENDING_PART_BYTES = 16 * 1024 * 1024;

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
    /**
     * What the bus carries, not what one notification does: a frame over
     * {@link PG_NOTIFY_MAX_PAYLOAD_BYTES} travels in parts.
     */
    readonly maxFrameBytes = PG_BUS_MAX_FRAME_BYTES;
    readonly publishesOnDemand = true;

    private listener?: PgNotifyListener;
    private readonly assembler = new FrameAssembler();
    /** Frames this instance cut into parts, so its own listener skips putting them back together. */
    private readonly ownPartIds = new Set<string>();
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
        private readonly db: PgSqlDatabase<Record<string, unknown>>,
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
            onPayload: async (raw) => {
                const part = parsePart(raw);
                let payload = raw;
                if (part) {
                    if (this.ownPartIds.has(part.id)) {
                        // Our own frame, which the service drops on arrival anyway.
                        if (part.i === part.n - 1) this.ownPartIds.delete(part.id);
                        return;
                    }
                    const whole = this.assembler.add(part);
                    if (whole === undefined) return;
                    payload = whole;
                }
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

        // Too large for any notification: it leaves on its own, in parts,
        // after what is already queued, so it does not overtake it.
        if (bytes > PG_NOTIFY_MAX_PAYLOAD_BYTES) {
            this.flush();
            await this.send([frame]);
            return;
        }

        // A batch is one NOTIFY payload, so the 8 KB ceiling applies to the
        // whole batch. Send what we have rather than let the frame push it over.
        if (this.pending.length && this.pendingBytes + bytes > PG_NOTIFY_MAX_PAYLOAD_BYTES) {
            this.flush();
        }

        return new Promise<void>((resolve, reject) => {
            this.pending.push({ frame, bytes, resolve, reject });
            this.pendingBytes += bytes;
        });
    }

    /** The LISTEN connection's state, for `/health` — see {@link PgNotifyListener}. */
    status(): PgNotifyListenerStatus | undefined {
        return this.listener?.status();
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
        this.assembler.clear();
        this.ownPartIds.clear();
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
        unref(this.windowTimer);
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

        if (Buffer.byteLength(payload, "utf8") <= PG_NOTIFY_MAX_PAYLOAD_BYTES) {
            await this.db.execute(sql`SELECT pg_notify(${CHANNEL_BUS_NOTIFY_CHANNEL}, ${payload})`);
            return;
        }

        // One statement, so the parts commit together and every listener
        // receives them in a row: nothing can be lost between two of them but
        // the whole frame.
        const parts = splitIntoParts(payload, randomUUID());
        this.ownPartIds.add(parts[0].id);
        // A frame whose own copy never comes back (the listener down) must not stay here.
        if (this.ownPartIds.size > 1000) this.ownPartIds.delete(this.ownPartIds.values().next().value!);
        const notifies = parts.map(part => sql`pg_notify(${CHANNEL_BUS_NOTIFY_CHANNEL}, ${JSON.stringify({ part })})`);
        await this.db.execute(sql`SELECT ${sql.join(notifies, sql`, `)}`);
    }
}

/** One part of a frame too large for a single notification. */
export interface ChannelBusPart {
    /** The same for every part of one frame. */
    id: string;
    /** This part's place, from 0. */
    i: number;
    /** How many parts the frame has. */
    n: number;
    /** A slice of the payload's UTF-8 bytes, base64: no character is ever cut in two. */
    data: string;
}

/** Cut a bus payload into parts, each of which fits one notification. */
export function splitIntoParts(payload: string, id: string): ChannelBusPart[] {
    const data = Buffer.from(payload, "utf8").toString("base64");
    const n = Math.ceil(data.length / PART_DATA_CHARS);
    return Array.from({ length: n }, (_, i) => ({
        id,
        i,
        n,
        data: data.slice(i * PART_DATA_CHARS, (i + 1) * PART_DATA_CHARS)
    }));
}

/** Most parts one frame can have, so a forged `n` cannot reserve unbounded memory. */
const MAX_PARTS = Math.ceil((PG_BUS_MAX_FRAME_BYTES * 4) / 3 / PART_DATA_CHARS) + 1;

/** The part a notification carries, or undefined when it carries a whole frame. */
export function parsePart(payload: string): ChannelBusPart | undefined {
    // Cheap test first: every whole frame starts `{"kind"` or `{"batch"`.
    if (!payload.startsWith("{\"part\"")) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(payload);
    } catch {
        return undefined;
    }
    const part = parsed && typeof parsed === "object" ? (parsed as { part?: unknown }).part : undefined;
    if (!part || typeof part !== "object") return undefined;
    const { id, i, n, data } = part as Record<string, unknown>;
    if (typeof id !== "string" || typeof data !== "string") return undefined;
    if (!Number.isInteger(i) || !Number.isInteger(n)) return undefined;
    const index = i as number;
    const count = n as number;
    if (count < 1 || count > MAX_PARTS || index < 0 || index >= count) return undefined;
    return { id, i: index, n: count, data };
}

/**
 * Puts frames that travelled in parts back together.
 *
 * The parts of one frame are sent in one statement, so they arrive in a row;
 * a frame still waiting after {@link PART_ASSEMBLY_TIMEOUT_MS} lost one (the
 * listener reconnected between them) and is dropped, as a lost notification
 * always was.
 */
export class FrameAssembler {
    private readonly pending = new Map<string, { parts: (string | undefined)[]; got: number; bytes: number; at: number }>();
    private pendingBytes = 0;

    constructor(private readonly now: () => number = Date.now) {}

    /** Add a part; the whole payload once its last part is in, otherwise undefined. */
    add(part: ChannelBusPart): string | undefined {
        this.expire();
        let entry = this.pending.get(part.id);
        if (!entry) {
            if (part.n === 1) return Buffer.from(part.data, "base64").toString("utf8");
            entry = { parts: new Array<string | undefined>(part.n), got: 0, bytes: 0, at: this.now() };
            this.pending.set(part.id, entry);
        }
        if (entry.parts.length !== part.n || entry.parts[part.i] !== undefined) return undefined;
        entry.parts[part.i] = part.data;
        entry.got++;
        entry.bytes += part.data.length;
        this.pendingBytes += part.data.length;
        if (entry.got < part.n) {
            while (this.pendingBytes > MAX_PENDING_PART_BYTES && this.pending.size > 1) this.dropOldest();
            return undefined;
        }
        this.forget(part.id);
        return Buffer.from(entry.parts.join(""), "base64").toString("utf8");
    }

    /** How many frames are waiting for parts. */
    get size(): number {
        return this.pending.size;
    }

    clear(): void {
        this.pending.clear();
        this.pendingBytes = 0;
    }

    private expire(): void {
        const cutoff = this.now() - PART_ASSEMBLY_TIMEOUT_MS;
        for (const [id, entry] of this.pending) {
            // Insertion order is arrival order: the first one young enough ends the scan.
            if (entry.at >= cutoff) break;
            logger.warn(`⚠️ [ChannelBus] Dropping a frame that arrived ${entry.got} of ${entry.parts.length} parts.`);
            this.forget(id);
        }
    }

    private dropOldest(): void {
        const oldest = this.pending.keys().next().value;
        if (oldest === undefined) return;
        logger.warn("⚠️ [ChannelBus] Dropping an unfinished multi-part frame: too many parts waiting.");
        this.forget(oldest);
    }

    private forget(id: string): void {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pendingBytes -= entry.bytes;
        this.pending.delete(id);
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
        case "channels":
            return {
                kind: "channels",
                sid,
                channel,
                add: Array.isArray(obj.add) ? obj.add.filter((c): c is string => typeof c === "string") : undefined,
                list: Array.isArray(obj.list) ? obj.list.filter((c): c is string => typeof c === "string") : undefined,
                done: obj.done === true,
                hello: obj.hello === true
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
