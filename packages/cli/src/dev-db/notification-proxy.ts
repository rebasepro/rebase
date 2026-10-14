/**
 * A transparent Postgres proxy that puts LISTEN/NOTIFY back.
 *
 * Without this, realtime does not work against the managed database — and it
 * fails silently, which is worse than failing. The reason is specific and
 * measurable:
 *
 * PGlite is a *single* backend session, and `PGLiteSocketServer` multiplexes
 * every client connection onto it. `LISTEN` is therefore session-wide: whichever
 * client issues it arms the whole database. But a `NotificationResponse` is an
 * asynchronous message with no request to answer, so the multiplexer hands it to
 * whichever socket happens to be reading the protocol stream at that moment —
 * which is the client that *caused* the notification, not the one that asked for
 * it.
 *
 * Measured against pglite-socket 0.2.9:
 *
 *   LISTEN and NOTIFY on one connection      → delivered
 *   trigger-fired pg_notify, same connection → delivered
 *   another connection causes the notify     → NOT delivered to the listener
 *   …and the same notification IS delivered to the notifier, which never asked
 *
 * The realtime engine listens on a dedicated connection and the writes come
 * from request connections, so it is exactly the broken case, every time.
 *
 * The fix is to stop treating a notification as belonging to one connection,
 * which for a single-session database is the truth anyway: this proxy watches
 * the server→client direction, and every `NotificationResponse` frame it sees is
 * copied to every other connected client. A client that never issued `LISTEN`
 * may receive one it did not ask for; `pg` raises a `notification` event nobody
 * has subscribed to, which costs nothing. A client that *did* ask now always
 * gets it, which is the whole point.
 *
 * It corrects one more defect on the way: PGlite answers a failed
 * extended-protocol message with a ReadyForQuery of its own and the Sync after
 * it with another, and the proxy drops the extra one (`ReadyForQueryLedger`),
 * because a client that takes it for the next query's answer reads that
 * query's rows as empty and every answer after it one request late.
 *
 * Two properties make this safe rather than clever:
 *
 * - **It never parses SQL and never rewrites a byte.** Frames are forwarded
 *   verbatim; the only edits are delivering a copy of one to more sockets and
 *   holding back that extra ReadyForQuery.
 * - **Injection only happens on a message boundary.** The server→client stream
 *   is reassembled into whole protocol messages before anything is written on,
 *   so an injected frame can never land inside another message.
 *
 * This exists only for the managed development database. Against a real Postgres
 * there is no proxy, because there is no defect to correct.
 */

import net from "net";

/** `NotificationResponse`. The one message type this proxy treats specially. */
const NOTIFICATION_RESPONSE = 0x41; // 'A'

/**
 * The SSL negotiation request, which is the one thing on the wire that is not
 * a typed message.
 *
 * A client may open with an 8-byte `SSLRequest` (length 8, code 80877103), and
 * the server answers with a *single untyped byte* — `N` or `S`. Feeding that
 * byte to a parser expecting `type + Int32 length` would desynchronise the
 * stream for the rest of the connection, so it is recognised and passed through.
 */
const SSL_REQUEST_LENGTH = 8;
const SSL_REQUEST_CODE = 80877103;

function isSslRequest(chunk: Buffer): boolean {
    return (
        chunk.length >= SSL_REQUEST_LENGTH &&
        chunk.readInt32BE(0) === SSL_REQUEST_LENGTH &&
        chunk.readInt32BE(4) === SSL_REQUEST_CODE
    );
}

/**
 * Reassembles a server→client byte stream into whole protocol messages.
 *
 * Every backend message is `Int8 type` + `Int32 length` + payload, where the
 * length counts itself but not the type byte. Anything shorter than a full
 * message is held until the rest arrives — TCP offers no guarantee that a
 * message arrives in one chunk, and a proxy that assumed otherwise would inject
 * into the middle of a row description under load.
 */
export class BackendMessageParser {
    private buffered: Buffer = Buffer.alloc(0);
    /** Set once the untyped SSL negotiation byte has been dealt with. */
    private awaitingSslReply = false;

    expectSslReply(): void {
        this.awaitingSslReply = true;
    }

    /** Feed bytes in; get whole messages out, in order. */
    push(chunk: Buffer): Buffer[] {
        const messages: Buffer[] = [];
        this.buffered = this.buffered.length === 0 ? chunk : Buffer.concat([this.buffered, chunk]);

        if (this.awaitingSslReply && this.buffered.length >= 1) {
            // Single untyped byte: 'N' (no SSL) or 'S' (proceed).
            messages.push(this.buffered.subarray(0, 1));
            this.buffered = this.buffered.subarray(1);
            this.awaitingSslReply = false;
        }

        while (this.buffered.length >= 5) {
            const length = this.buffered.readInt32BE(1);
            // A length below 4 cannot describe itself; the stream is not one we
            // understand, so stop parsing and let the rest through untouched
            // rather than guessing.
            if (length < 4) break;
            const total = length + 1;
            if (this.buffered.length < total) break;
            messages.push(this.buffered.subarray(0, total));
            this.buffered = this.buffered.subarray(total);
        }

        return messages;
    }

    /** Bytes held back because they are not yet a whole message. */
    get pending(): number {
        return this.buffered.length;
    }
}

/** The startup packet's protocol code, which no request code shares. */
const PROTOCOL_3 = 196608;

/**
 * Reassembles the client→server stream into whole messages, so the proxy
 * knows what each answer is an answer to.
 *
 * The connection opens untyped — an `SSLRequest` or `GSSENCRequest` (each
 * answered with one byte) and then the startup packet, each a bare `Int32
 * length` and a code — and is `type + Int32 length` after it. Each message is
 * returned as its type character, `"startup"` for the startup packet, and the
 * negotiation requests not at all.
 */
export class FrontendMessageParser {
    private buffered: Buffer = Buffer.alloc(0);
    private started = false;

    push(chunk: Buffer): string[] {
        const types: string[] = [];
        this.buffered = this.buffered.length === 0 ? chunk : Buffer.concat([this.buffered, chunk]);

        while (true) {
            if (!this.started) {
                if (this.buffered.length < 8) break;
                const length = this.buffered.readInt32BE(0);
                if (length < 8) break;
                if (this.buffered.length < length) break;
                if (this.buffered.readInt32BE(4) === PROTOCOL_3) {
                    this.started = true;
                    types.push("startup");
                }
                this.buffered = this.buffered.subarray(length);
                continue;
            }
            if (this.buffered.length < 5) break;
            const length = this.buffered.readInt32BE(1);
            if (length < 4) break;
            if (this.buffered.length < length + 1) break;
            types.push(String.fromCharCode(this.buffered[0]));
            this.buffered = this.buffered.subarray(length + 1);
        }

        return types;
    }
}

/** One request the backend ends with a ReadyForQuery. */
interface PendingRequest {
    /** Parse/Bind/Describe/Execute/Close messages up to a Sync, rather than one Query. */
    extended: boolean;
    /** Its extended messages that answer with a message of their own. */
    messages: number;
    /** How many of them have been answered. */
    answered: number;
    /** The Sync that closes it has been sent. */
    synced: boolean;
    /** PGlite answered a failed message with a ReadyForQuery of its own, owed before the Sync's. */
    extraReady: boolean;
}

/**
 * The backend messages that complete one extended-protocol message: Parse,
 * Bind, Close, Describe (its row description or NoData) and Execute (its
 * CommandComplete, EmptyQueryResponse or PortalSuspended).
 */
const EXTENDED_REPLIES = new Set(["1", "2", "3", "T", "n", "C", "I", "s"]);

/** Frontend messages that are part of an extended-protocol request and are answered. */
const EXTENDED_MESSAGES = new Set(["P", "B", "D", "E", "C"]);

/**
 * Keeps a connection's ReadyForQuery messages one to a request.
 *
 * PGlite (0.5.6) answers an extended-protocol message that fails with an
 * ErrorResponse *and* a ReadyForQuery, then answers the Sync after it with a
 * second ReadyForQuery. Real Postgres sends one: after an error it ignores
 * everything up to the Sync and answers the Sync. `pg` absorbs the extra one
 * when both arrive in one read. When they arrive apart — under load, a script
 * beside a running `rebase dev` — it takes the second as the answer to the
 * next query it sent:
 *
 *  - a refused write's ROLLBACK "finished" on it, the pool saw the client
 *    released in a failed transaction (status 'E'), and the real ROLLBACK's
 *    answer arrived as "Received unexpected commandComplete message from
 *    backend" — two `[pg-pool]` ERROR lines on every refused write;
 *  - on a connection held across queries, the next query "finished" with no
 *    rows: a `SELECT` that answered `[]`.
 *
 * So the proxy follows each request and drops the ReadyForQuery that answers
 * a failed message before its Sync. An error raised *by* the Sync — a deferred
 * constraint failing as the implicit transaction commits — comes with the
 * one ReadyForQuery, and that is kept, as is every simple Query's.
 */
export class ReadyForQueryLedger {
    private readonly pending: PendingRequest[] = [];

    /** Note a message the client sent, before it is forwarded. */
    sent(type: string): void {
        const open = this.pending.at(-1);
        const extendedOpen = open && open.extended && !open.synced ? open : undefined;
        if (type === "startup" || type === "Q" || type === "F") {
            this.pending.push({ extended: false, messages: 0, answered: 0, synced: true, extraReady: false });
        } else if (EXTENDED_MESSAGES.has(type)) {
            if (extendedOpen) extendedOpen.messages += 1;
            else this.pending.push({ extended: true, messages: 1, answered: 0, synced: false, extraReady: false });
        } else if (type === "S") {
            if (extendedOpen) extendedOpen.synced = true;
            else this.pending.push({ extended: true, messages: 0, answered: 0, synced: true, extraReady: false });
        }
    }

    /** Whether a message the backend sent goes on to the client. */
    deliver(message: Buffer): boolean {
        const type = String.fromCharCode(message[0]);
        const request = this.pending[0];
        if (!request) return true;
        if (request.extended && EXTENDED_REPLIES.has(type)) {
            request.answered += 1;
        } else if (type === "E" && request.extended && request.answered < request.messages) {
            request.extraReady = true;
        } else if (type === "Z") {
            if (request.extraReady) {
                request.extraReady = false;
                return false;
            }
            this.pending.shift();
        }
        return true;
    }
}

export function isNotificationFrame(message: Buffer): boolean {
    return message.length > 0 && message[0] === NOTIFICATION_RESPONSE;
}

/** Channel and payload of a NotificationResponse, for logging and tests. */
export function decodeNotification(message: Buffer): { channel: string; payload: string } | null {
    if (!isNotificationFrame(message) || message.length < 10) return null;
    // 1 type byte + 4 length + 4 process id, then two null-terminated strings.
    const body = message.subarray(9);
    const split = body.indexOf(0);
    if (split === -1) return null;
    const channel = body.subarray(0, split).toString("utf8");
    const rest = body.subarray(split + 1);
    const end = rest.indexOf(0);

    return { channel, payload: (end === -1 ? rest : rest.subarray(0, end)).toString("utf8") };
}

export interface NotificationProxyOptions {
    /** Port clients connect to. */
    listenPort: number;
    /** Port the real PGlite socket server is on. */
    upstreamPort: number;
    host?: string;
    /** Called for every notification broadcast. For diagnostics and tests. */
    onNotification?: (channel: string, payload: string, copies: number) => void;
}

interface Connection {
    client: net.Socket;
    upstream: net.Socket;
    parser: BackendMessageParser;
    frontend: FrontendMessageParser;
    ledger: ReadyForQueryLedger;
}

/**
 * The proxy itself.
 *
 * One upstream connection per client connection, so the multiplexer downstream
 * sees exactly what it would have seen without the proxy.
 */
export class NotificationProxy {
    private server: net.Server | null = null;
    private readonly connections = new Set<Connection>();

    constructor(private readonly options: NotificationProxyOptions) {}

    get connectionCount(): number {
        return this.connections.size;
    }

    start(): Promise<void> {
        const host = this.options.host ?? "127.0.0.1";

        return new Promise((resolve, reject) => {
            const server = net.createServer((client) => this.accept(client, host));
            server.once("error", reject);
            server.listen(this.options.listenPort, host, () => {
                this.server = server;
                resolve();
            });
        });
    }

    private accept(client: net.Socket, host: string): void {
        const upstream = net.connect(this.options.upstreamPort, host);
        const connection: Connection = {
            client,
            upstream,
            parser: new BackendMessageParser(),
            frontend: new FrontendMessageParser(),
            ledger: new ReadyForQueryLedger()
        };
        this.connections.add(connection);

        // Nagle would batch a notification behind nothing at all, adding latency
        // to the one message whose entire value is arriving promptly.
        client.setNoDelay(true);
        upstream.setNoDelay(true);

        client.on("data", (chunk: Buffer) => {
            if (isSslRequest(chunk)) connection.parser.expectSslReply();
            // Noted before it is forwarded, so every answer finds its request.
            for (const type of connection.frontend.push(chunk)) connection.ledger.sent(type);
            upstream.write(chunk);
        });

        upstream.on("data", (chunk: Buffer) => {
            for (const message of connection.parser.push(chunk)) {
                // PGlite's second ReadyForQuery for one failed request; see
                // `ReadyForQueryLedger`.
                if (!connection.ledger.deliver(message)) continue;
                // The rest of a response to a client that has gone is read
                // and dropped — see `close`.
                if (!client.destroyed) client.write(message);
                if (isNotificationFrame(message)) this.broadcast(message, connection);
            }
        });

        // The upstream socket is ended, never destroyed. A client that goes
        // away mid-response (Atlas exiting on a failed migration) leaves the
        // rest of that response in flight, and closing a socket with data
        // unread makes the kernel answer with a reset. `PGLiteSocketServer`
        // (0.2.9) handles a reset by detaching the connection's listeners
        // before its `close`, the one event it stops counting a connection
        // on, so every such exit cost one of the few connections it accepts
        // until the daemon restarted, and the next `rebase db migrate` beside
        // a running `rebase dev` got `Error: EOF`. Ended, the server reads an
        // ordinary close, and the proxy's upstream closes once it has.
        const close = () => {
            this.connections.delete(connection);
            client.destroy();
            upstream.end();
        };
        client.on("close", close);
        client.on("error", close);
        upstream.on("close", close);
        upstream.on("error", close);
    }

    /**
     * Copy a notification to every other client.
     *
     * Written directly rather than through a parser: it is already a whole
     * message, and every other socket is only ever written whole messages, so
     * there is no boundary to land inside.
     */
    private broadcast(message: Buffer, origin: Connection): void {
        let copies = 0;
        for (const connection of this.connections) {
            if (connection === origin) continue;
            if (connection.client.destroyed || !connection.client.writable) continue;
            connection.client.write(message);
            copies += 1;
        }

        const decoded = decodeNotification(message);
        if (decoded) this.options.onNotification?.(decoded.channel, decoded.payload, copies);
    }

    async stop(): Promise<void> {
        for (const connection of [...this.connections]) {
            connection.client.destroy();
            connection.upstream.destroy();
        }
        this.connections.clear();

        const server = this.server;
        this.server = null;
        if (!server) return;

        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}
