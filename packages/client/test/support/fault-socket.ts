/**
 * A fault-injecting stand-in for the WebSocket, with the server on the far end.
 *
 * The client socket's failure modes are the ones a happy-path mock cannot say:
 *
 * - **drop after send, before the answer** — the frame reached the server, the
 *   server acted on it, and the connection died before the answer came back.
 *   A client that re-sends such a frame on reconnect runs it twice.
 * - **an outage longer than the retry budget** — every dial is refused for as
 *   long as the test says, then the server is back.
 * - **half-open** — the socket still reads as open on this side, but nothing
 *   goes through in either direction and no close ever arrives.
 *
 * `FaultServer.received` is what the *server* saw, which is the number that
 * matters for at-most-once: a request is "executed" when it lands there, no
 * matter what the client was told.
 *
 * Written for jest's fake timers: a dial resolves (opens or is refused) on a
 * 10 ms timer, like the other mocks in this package, so `advanceTimersByTime`
 * drives it.
 */

/** One frame as the server reads it. */
export interface Frame {
    type: string;
    requestId?: string;
    subscriptionId?: string;
    payload?: Record<string, unknown>;
    [key: string]: unknown;
}

/** How a request frame is answered. Return the frames to send back. */
export type Responder = (frame: Frame, server: FaultServer) => Frame[];

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/**
 * Answers the frames the SDK sends, the way the Postgres backend does:
 * a response envelope for a request, the initial payload for a subscribe,
 * nothing for channel traffic or an unsubscribe.
 */
export const defaultResponder: Responder = (frame, server) => {
    switch (frame.type) {
        case "AUTHENTICATE":
            return [{ type: "AUTH_SUCCESS", requestId: frame.requestId, payload: { userId: "u1" } }];
        case "subscribe_collection": {
            const path = String(frame.payload?.path ?? "");
            return [{
                type: "collection_update",
                subscriptionId: String(frame.payload?.subscriptionId),
                rows: server.rows(path),
                pks: [{ fieldName: "id", type: "string" }]
            }];
        }
        case "subscribe_one": {
            const path = String(frame.payload?.path ?? "");
            const id = frame.payload?.id;
            return [{
                type: "single_update",
                subscriptionId: String(frame.payload?.subscriptionId),
                row: server.rows(path).find(row => String(row.id) === String(id)) ?? null
            }];
        }
        case "SAVE": {
            const path = String(frame.payload?.path ?? "");
            const values = (frame.payload?.values ?? {}) as Record<string, unknown>;
            const row = { id: String(server.nextId++), ...values };
            server.setRows(path, [...server.rows(path), row]);
            return [{ type: "RESPONSE", requestId: frame.requestId, payload: { row } }];
        }
        case "EXECUTE_SQL":
            return [{ type: "RESPONSE", requestId: frame.requestId, payload: { result: [{ ok: true }] } }];
        case "unsubscribe":
        case "join_channel":
        case "leave_channel":
        case "broadcast":
        case "presence_track":
        case "presence_untrack":
        case "presence_state":
        case "channel_history":
            return [];
        default:
            return [{ type: "RESPONSE", requestId: frame.requestId, payload: {} }];
    }
};

export class FaultSocket {
    static readonly CONNECTING = CONNECTING;
    static readonly OPEN = OPEN;
    static readonly CLOSING = CLOSING;
    static readonly CLOSED = CLOSED;

    readyState = CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;

    /** Every frame the client wrote to this socket, parsed — whether or not it got through. */
    readonly written: Frame[] = [];
    /** Set by {@link FaultServer.halfOpen}: frames vanish both ways, no close. */
    blackHoled = false;

    constructor(readonly url: string, private readonly server: FaultServer) {
        server.sockets.push(this);
        setTimeout(() => this.server.dial(this), 10);
    }

    send(data: string): void {
        if (this.readyState !== OPEN) throw new Error("WebSocket is not open");
        const frame = JSON.parse(data) as Frame;
        this.written.push(frame);
        if (this.blackHoled) return;
        this.server.receive(this, frame);
    }

    close(): void {
        if (this.readyState === CLOSED) return;
        this.readyState = CLOSED;
        this.onclose?.();
    }

    /** The server side ends the connection (LB reset, deploy, crash). */
    drop(): void {
        this.close();
    }

    /** Deliver a frame from the server. Lost if the socket is black-holed or closed. */
    deliver(frame: Frame): void {
        if (this.readyState !== OPEN || this.blackHoled) return;
        this.onmessage?.({ data: JSON.stringify(frame) });
    }
}

/** What to do with the next request frame that matches. */
interface DropAfterSend {
    match: (frame: Frame) => boolean;
}

export class FaultServer {
    readonly sockets: FaultSocket[] = [];
    /** Every frame that reached the server, in arrival order. */
    readonly received: Frame[] = [];
    nextId = 1;

    private refusing = 0;
    private dropAfterSend: DropAfterSend | undefined;
    private readonly tables = new Map<string, Record<string, unknown>[]>();

    constructor(private readonly responder: Responder = defaultResponder) {}

    /** The constructor to hand the client, as `config.WebSocket`. */
    get WebSocket(): typeof WebSocket {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const server = this;
        class BoundFaultSocket extends FaultSocket {
            static readonly CONNECTING = CONNECTING;
            static readonly OPEN = OPEN;
            static readonly CLOSING = CLOSING;
            static readonly CLOSED = CLOSED;
            constructor(url: string) {
                super(url, server);
            }
        }
        // The client reads `OPEN` off the constructor and calls the members
        // above; nothing else of the DOM type is touched.
        return BoundFaultSocket as unknown as typeof WebSocket;
    }

    rows(path: string): Record<string, unknown>[] {
        return this.tables.get(path) ?? [];
    }

    setRows(path: string, rows: Record<string, unknown>[]): void {
        this.tables.set(path, rows);
    }

    /** The newest socket. */
    get current(): FaultSocket | undefined {
        return this.sockets[this.sockets.length - 1];
    }

    /** Frames of one type that reached the server. */
    receivedOfType(type: string): Frame[] {
        return this.received.filter(frame => frame.type === type);
    }

    /** Refuse every dial until {@link up}. */
    down(): void {
        this.refusing = Number.POSITIVE_INFINITY;
    }

    /** Accept dials again. */
    up(): void {
        this.refusing = 0;
    }

    /** Refuse the next `count` dials, then accept. */
    refuseNext(count: number): void {
        this.refusing = count;
    }

    /**
     * The next frame matching `match` reaches the server and is acted on, the
     * answer is lost, and the connection drops — the order a Wi-Fi blip or an
     * LB reset produces.
     */
    dropNextAfterSend(match: (frame: Frame) => boolean = () => true): void {
        this.dropAfterSend = { match };
    }

    /**
     * The current connection goes half-open: it still reads as open on the
     * client, but frames vanish in both directions and no close arrives.
     */
    halfOpen(): void {
        const socket = this.current;
        if (socket) socket.blackHoled = true;
    }

    /** Push a frame to every open socket (a server-side change). */
    broadcast(frame: Frame): void {
        for (const socket of this.sockets) socket.deliver(frame);
    }

    /** @internal Called by a socket's dial timer. */
    dial(socket: FaultSocket): void {
        if (socket.readyState !== CONNECTING) return;
        if (this.refusing > 0) {
            this.refusing -= 1;
            socket.readyState = CLOSED;
            socket.onerror?.(new Error("connection refused"));
            socket.onclose?.();
            return;
        }
        socket.readyState = OPEN;
        socket.onopen?.();
    }

    /** @internal Called by a socket's `send`. */
    receive(socket: FaultSocket, frame: Frame): void {
        this.received.push(frame);
        const replies = this.responder(frame, this);
        const drop = this.dropAfterSend;
        if (drop && drop.match(frame)) {
            this.dropAfterSend = undefined;
            // Acted on above; the answer never makes it back.
            queueMicrotask(() => socket.drop());
            return;
        }
        // Answers arrive asynchronously, as they do over a real socket.
        queueMicrotask(() => {
            for (const reply of replies) socket.deliver(reply);
        });
    }
}
