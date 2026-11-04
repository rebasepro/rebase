/**
 * Change capture read from the write-ahead log.
 *
 * The trigger listener's counterpart (see {@link CdcListener}): it hands
 * `RealtimeService` the same {@link CdcChangeEvent}s, but takes them from a
 * logical replication stream instead of `pg_notify`. Writers pay for neither a
 * trigger nor NOTIFY, whose commit-time lock serializes every notifying
 * transaction on the server, disk flush included (see
 * `tooling/scripts/bench-cdc-notify.mts`).
 *
 * Each instance opens its own replication connection and creates a
 * **temporary** slot on it. A temporary slot lives exactly as long as the
 * connection: a crashed or partitioned instance cannot leave a slot behind
 * holding WAL until the disk fills, which is the failure every permanent slot
 * invites. The price is that a reconnect starts a new slot from the present,
 * so whatever committed in the gap is not replayed — `onReconnect` tells
 * subscribers to look again, as the LISTEN connection's does.
 *
 * Requires `wal_level=logical`, a role with the REPLICATION attribute (or the
 * host's equivalent, e.g. `rds_replication`), a free replication slot and WAL
 * sender, and the publication provisioning creates ({@link CDC_PUBLICATION}).
 * The connection must reach Postgres directly: a pooler does not carry the
 * replication protocol.
 */
import { Client as PgClient, type ClientConfig, type Connection, type Submittable } from "pg";
import { randomBytes } from "crypto";
import { logger } from "@rebasepro/server";
import { unref } from "@rebasepro/utils";

import type { CdcChangeEvent } from "./CdcListener";
import type { PgNotifyListenerStatus } from "../pg-notify-listener";
import {
    PgoutputChanges,
    copyDataFrame,
    encodeStandbyStatus,
    formatLsn,
    parsePgoutputMessage,
    parseReplicationFrame
} from "./pgoutput";

/** `pg` reads it and sends `replication=database` at startup; `ClientConfig` does not declare it. */
interface ReplicationClientConfig extends ClientConfig {
    replication: "database";
}

export interface WalCdcListenerOptions {
    /** Direct Postgres connection string. Not a pooler: it carries the replication protocol. */
    connectionString: string;
    /** The publication to stream. Must be a plain identifier — it is interpolated. */
    publication: string;
    onEvents: (events: CdcChangeEvent[]) => void | Promise<void>;
    /**
     * Called once the stream is open again after a drop — never after the
     * first connect. The new slot starts from the present: what committed
     * while the connection was down is gone, so subscribers resync here.
     */
    onReconnect?: () => void;
    /** The columns a table's rows are addressed by; `undefined` for its replica identity. */
    identityColumns: (schema: string, table: string) => readonly string[] | undefined;
    applicationName?: string;
    reconnectDelayMs?: number;
    /** How often the stream must prove it is alive. `0` turns the check off. */
    heartbeatIntervalMs?: number;
    /** How long the server may take to answer a heartbeat. */
    heartbeatTimeoutMs?: number;
    /** How often the position read so far is reported, so the server can recycle WAL. */
    statusIntervalMs?: number;
    /**
     * How long creating the slot may take. It waits for every transaction
     * already running to finish, so one long transaction holds it up.
     */
    slotTimeoutMs?: number;
}

const DEFAULT_RECONNECT_DELAY_MS = 3000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;
const DEFAULT_STATUS_INTERVAL_MS = 10_000;
const DEFAULT_SLOT_TIMEOUT_MS = 30_000;
/** Changes handed on at once from inside one large transaction, rather than all of it at its commit. */
const EVENTS_PER_BATCH = 1000;
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function failureReason(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof Error && "code" in err && typeof err.code === "string" ? err.code : undefined;
    return code && !message.includes(code) ? `${message} [${code}]` : message;
}

/**
 * The `START_REPLICATION` command, driven through `pg`'s query queue.
 *
 * `pg` hands every CopyData frame of the active query to its
 * `handleCopyData`, and the rest of these handlers are the ones it calls on
 * any query. Frames back to the server — standby status updates — are written
 * to the connection's socket as whole CopyData messages, between the frames
 * `pg` itself writes.
 */
class ReplicationStream implements Submittable {
    readonly started: Promise<void>;
    private resolveStarted!: () => void;
    private rejectStarted!: (err: Error) => void;
    private connection?: Connection;
    private isStarted = false;

    constructor(
        private readonly command: string,
        private readonly handlers: {
            onFrame: (payload: Buffer) => void;
            /** The stream ended or failed after it started. */
            onClosed: (err?: Error) => void;
        }
    ) {
        this.started = new Promise((resolve, reject) => {
            this.resolveStarted = resolve;
            this.rejectStarted = reject;
        });
        // Rejected only before the caller awaits it on a failed start; never unhandled.
        this.started.catch(() => { /* surfaced through the awaiting caller */ });
    }

    submit(connection: Connection): void {
        this.connection = connection;
        connection.once("replicationStart", () => {
            this.isStarted = true;
            this.resolveStarted();
        });
        connection.query(this.command);
    }

    send(payload: Buffer): void {
        if (this.isStarted) this.connection?.stream.write(copyDataFrame(payload));
    }

    handleCopyData(message: { chunk: Buffer }): void {
        this.handlers.onFrame(message.chunk);
    }

    handleError(err: Error): void {
        if (this.isStarted) {
            this.isStarted = false;
            this.handlers.onClosed(err);
        } else {
            this.rejectStarted(err);
        }
    }

    handleReadyForQuery(): void {
        // The server ended the stream without an error: a shutdown, or the
        // slot was dropped under it.
        if (this.isStarted) {
            this.isStarted = false;
            this.handlers.onClosed();
        } else {
            this.rejectStarted(new Error("replication ended before it started"));
        }
    }

    handleCopyInResponse(): void { /* not a COPY FROM */ }
    handleRowDescription(): void { /* START_REPLICATION returns no rows */ }
    handleDataRow(): void { /* START_REPLICATION returns no rows */ }
    handlePortalSuspended(): void { /* simple protocol, no portals */ }
    handleEmptyQuery(): void { /* never empty */ }
    handleCommandComplete(): void { /* followed by ReadyForQuery, handled there */ }
}

/**
 * A logical replication consumer that repairs itself, shaped like
 * {@link PgNotifyListener}: the first connect is validated and rethrown, so a
 * caller can fall back to the trigger listener; every later drop is repaired in
 * the background.
 */
export class WalCdcListener {
    private client?: PgClient;
    /** The connection being opened: its frames count before it is adopted, an abandoned one's never do. */
    private connecting?: PgClient;
    private stream?: ReplicationStream;
    private running = false;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private heartbeatTimer?: ReturnType<typeof setInterval>;
    private heartbeatDeadline?: ReturnType<typeof setTimeout>;
    private statusTimer?: ReturnType<typeof setInterval>;
    private downSince?: number;
    private lastHeartbeatAt?: number;
    private lastFrameAt = 0;
    private outageWarned = false;
    /** The end of the last transaction handed on: what is reported as read. */
    private confirmedLsn = 0n;
    private inTransaction = false;
    private pending: CdcChangeEvent[] = [];
    private slotName?: string;

    constructor(private readonly options: WalCdcListenerOptions) {
        if (!SAFE_IDENTIFIER.test(options.publication)) {
            throw new Error(`Unsafe publication name "${options.publication}" — expected a plain SQL identifier.`);
        }
    }

    get active(): boolean {
        return this.running;
    }

    /** Streaming on a connection that answered its last heartbeat. */
    get connected(): boolean {
        return this.running && this.stream !== undefined;
    }

    status(): PgNotifyListenerStatus {
        return {
            channel: `wal:${this.options.publication}`,
            connected: this.connected,
            ...(this.downSince !== undefined && !this.connected ? { downSince: this.downSince } : {}),
            ...(this.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: this.lastHeartbeatAt } : {})
        };
    }

    /**
     * Open the stream. Rejects if the first connection, the slot or
     * `START_REPLICATION` fails — `wal_level` is not `logical`, the role may
     * not replicate, the publication is missing, no slot is free — leaving
     * the listener stopped so the caller can use triggers instead.
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

    /** Close the stream; the server drops the temporary slot with it. Idempotent. */
    async stop(): Promise<void> {
        this.running = false;
        this.stopTimers();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        const client = this.client;
        this.client = undefined;
        this.stream = undefined;
        if (client) {
            try {
                await client.end();
            } catch { /* already closed */ }
        }
    }

    private async connect({ first = false }: { first?: boolean } = {}): Promise<void> {
        const { connectionString, applicationName, publication } = this.options;
        let pending: PgClient | undefined;
        try {
            const config: ReplicationClientConfig = {
                connectionString,
                replication: "database",
                keepAlive: true,
                keepAliveInitialDelayMillis: 30_000,
                ...(applicationName ? { application_name: applicationName } : {})
            };
            const client = new PgClient(config);
            pending = client;
            this.connecting = client;
            client.on("error", (err) => {
                if (client !== this.client) return;
                logger.error("❌ [CDC] WAL stream connection error", { detail: err.message });
                this.abandon(client);
            });
            client.on("end", () => {
                if (client !== this.client || !this.running) return;
                logger.warn("⚠️ [CDC] WAL stream disconnected unexpectedly.");
                this.abandon(client);
            });

            await client.connect();

            // Unique per connection: two instances, or a reconnect racing the
            // server's cleanup of the last one, never collide.
            const slot = `rebase_cdc_${randomBytes(8).toString("hex")}`;
            await this.withTimeout(
                client.query(`CREATE_REPLICATION_SLOT ${slot} TEMPORARY LOGICAL pgoutput NOEXPORT_SNAPSHOT`),
                this.options.slotTimeoutMs ?? DEFAULT_SLOT_TIMEOUT_MS,
                "creating the replication slot (it waits for transactions already running to finish)"
            );

            const changes = new PgoutputChanges(this.options.identityColumns);
            this.confirmedLsn = 0n;
            this.inTransaction = false;
            this.pending = [];
            const stream: ReplicationStream = new ReplicationStream(
                `START_REPLICATION SLOT ${slot} LOGICAL 0/0 (proto_version '1', publication_names '${publication}')`,
                {
                    onFrame: (payload) => this.onFrame(client, stream, changes, payload),
                    onClosed: (err) => {
                        if (client !== this.client) return;
                        logger.warn(`⚠️ [CDC] WAL stream ended${err ? ` (${err.message})` : ""}; reopening it.`);
                        this.abandon(client);
                    }
                }
            );
            client.query(stream);
            await stream.started;

            this.client = client;
            this.connecting = undefined;
            this.stream = stream;
            this.slotName = slot;
            pending = undefined;
            this.downSince = undefined;
            this.outageWarned = false;
            this.lastFrameAt = Date.now();
            this.lastHeartbeatAt = Date.now();
            this.startTimers(client);
            logger.debug(`📡 [CDC] Streaming publication "${publication}" through temporary slot ${slot}.`);
        } catch (err) {
            this.connecting = undefined;
            if (pending) {
                try { await pending.end(); } catch { /* already dead */ }
            }
            if (first) throw err;
            const retry = `[CDC] WAL stream could not be opened (${failureReason(err)}); ` +
                `retrying every ${Math.round((this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS) / 1000)} s.`;
            if (this.outageWarned) {
                logger.debug(retry);
            } else {
                this.outageWarned = true;
                logger.warn(`⚠️ ${retry}`);
            }
            this.scheduleReconnect();
            return;
        }
        if (!first && this.options.onReconnect) {
            logger.warn("⚠️ [CDC] WAL stream reopened on a new slot; changes committed while it was down were missed.");
            try {
                this.options.onReconnect();
            } catch (err) {
                logger.error("❌ [CDC] Error resyncing after a reconnect", { error: err });
            }
        }
    }

    private onFrame(client: PgClient, stream: ReplicationStream, changes: PgoutputChanges, payload: Buffer): void {
        if (client !== this.client && client !== this.connecting) return;
        this.lastFrameAt = Date.now();
        this.clearHeartbeatDeadline();
        try {
            const frame = parseReplicationFrame(payload);
            if (frame.kind === "keepalive") {
                this.lastHeartbeatAt = Date.now();
                // Between transactions everything up to the server's position
                // has been read, so it can be reported: WAL that touched no
                // published table is then recycled too.
                if (!this.inTransaction && frame.walEnd > this.confirmedLsn) this.confirmedLsn = frame.walEnd;
                if (frame.replyRequested) stream.send(encodeStandbyStatus(this.confirmedLsn, false));
                return;
            }
            const message = parsePgoutputMessage(frame.data);
            if (message.tag === "begin") {
                this.inTransaction = true;
                return;
            }
            if (message.tag === "commit") {
                this.inTransaction = false;
                this.flush();
                if (message.endLsn > this.confirmedLsn) this.confirmedLsn = message.endLsn;
                return;
            }
            const events = changes.apply(message);
            if (events.length > 0) {
                this.pending.push(...events);
                if (this.pending.length >= EVENTS_PER_BATCH) this.flush();
            }
        } catch (err) {
            // A frame this cannot read is a stream it can no longer trust:
            // start again from the present and resync, rather than guess.
            logger.error(`❌ [CDC] Unreadable WAL stream frame — reopening the stream (${failureReason(err)}).`);
            if (client === this.client) {
                this.abandon(client);
            } else {
                // Still opening: ending it fails the open, which retries or rejects.
                void client.end().catch(() => { /* already dead */ });
            }
        }
    }

    /** Hand on what has been read. Every change in the stream is committed, so this needs no commit to wait for. */
    private flush(): void {
        if (this.pending.length === 0) return;
        const events = this.pending;
        this.pending = [];
        Promise.resolve(this.options.onEvents(events)).catch((err) =>
            logger.error("❌ [CDC] Error handling WAL changes", { error: err })
        );
    }

    private abandon(client: PgClient): void {
        if (client !== this.client) return;
        this.flush();
        this.client = undefined;
        this.stream = undefined;
        this.downSince ??= Date.now();
        this.stopTimers();
        void client.end().catch(() => { /* already dead */ });
        this.scheduleReconnect();
    }

    private startTimers(client: PgClient): void {
        this.stopTimers();
        const statusInterval = this.options.statusIntervalMs ?? DEFAULT_STATUS_INTERVAL_MS;
        this.statusTimer = setInterval(() => {
            if (client === this.client) this.stream?.send(encodeStandbyStatus(this.confirmedLsn, false));
        }, statusInterval);
        unref(this.statusTimer);

        const interval = this.options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
        if (interval <= 0) return;
        this.heartbeatTimer = setInterval(() => this.heartbeat(client), interval);
        unref(this.heartbeatTimer);
    }

    /**
     * Ask the server to answer at once. A half-open connection — packets
     * stopped, no FIN, no RST — fires no error, so a stream that went quiet
     * this way would look idle forever while every change went unseen.
     */
    private heartbeat(client: PgClient): void {
        if (client !== this.client || this.heartbeatDeadline) return;
        const sentAt = Date.now();
        this.stream?.send(encodeStandbyStatus(this.confirmedLsn, true));
        const timeoutMs = this.options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
        this.heartbeatDeadline = setTimeout(() => {
            this.heartbeatDeadline = undefined;
            if (client !== this.client || this.lastFrameAt >= sentAt) return;
            logger.warn(`⚠️ [CDC] WAL stream did not answer a heartbeat in ${timeoutMs}ms — treating it as dead and reopening it.`);
            this.abandon(client);
        }, timeoutMs);
        unref(this.heartbeatDeadline);
    }

    private clearHeartbeatDeadline(): void {
        if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
        this.heartbeatDeadline = undefined;
    }

    private stopTimers(): void {
        if (this.statusTimer) clearInterval(this.statusTimer);
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.statusTimer = undefined;
        this.heartbeatTimer = undefined;
        this.clearHeartbeatDeadline();
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

    private async withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                promise,
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms ${what}`)), ms);
                })
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** For logs and tests: the slot of the current stream, and how far it has read. */
    position(): { slot?: string; confirmedLsn: string } {
        return { slot: this.slotName, confirmedLsn: formatLsn(this.confirmedLsn) };
    }
}
