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
 * Two properties make this safe rather than clever:
 *
 * - **It never parses SQL and never rewrites a byte.** Frames are forwarded
 *   verbatim; the only edit is delivering a copy of one to more sockets.
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
        const connection: Connection = { client, upstream, parser: new BackendMessageParser() };
        this.connections.add(connection);

        // Nagle would batch a notification behind nothing at all, adding latency
        // to the one message whose entire value is arriving promptly.
        client.setNoDelay(true);
        upstream.setNoDelay(true);

        client.on("data", (chunk: Buffer) => {
            if (isSslRequest(chunk)) connection.parser.expectSslReply();
            upstream.write(chunk);
        });

        upstream.on("data", (chunk: Buffer) => {
            for (const message of connection.parser.push(chunk)) {
                client.write(message);
                if (isNotificationFrame(message)) this.broadcast(message, connection);
            }
        });

        const close = () => {
            this.connections.delete(connection);
            client.destroy();
            upstream.destroy();
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
