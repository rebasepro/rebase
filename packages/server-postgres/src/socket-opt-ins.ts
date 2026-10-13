import { WebSocket } from "ws";
import { unref } from "@rebasepro/utils";

/**
 * Behaviours a client opts into when it opens the socket.
 *
 * The client names them on the socket URL, `?rebase_caps=heartbeat,channel_seq,cancel_sql`,
 * and the server answers with a `hello` frame listing the ones it will honour:
 *
 * ```json
 * { "type": "hello", "capabilities": ["heartbeat", "channel_seq", "cancel_sql"], "heartbeatMs": 30000, "clientId": "client_…" }
 * ```
 *
 * Both halves are needed, so both directions of a version mismatch keep
 * working. An older client names none and gets no `hello`, no heartbeat and no
 * acknowledgement frames — nothing it would not recognise. An older server
 * ignores the query parameter and sends no `hello`, and a newer client that
 * hears none behaves as it always did.
 *
 * One list for both kinds: what the server sends (`heartbeat`, `channel_seq`)
 * and the frames it takes beyond the base protocol (`cancel_sql`). Named before
 * sign-in, so a socket that never signs in is served as one that does.
 *
 * - `heartbeat`: a `{ "type": "heartbeat" }` frame every `heartbeatMs`. A
 *   browser cannot send a WebSocket ping or see one, so a connection that went
 *   half-open — a NAT that forgot it, a laptop that slept — looks connected to
 *   it forever. With these, two missed beats tell it to redial.
 * - `channel_seq`: on a retained channel, the sender of a broadcast gets
 *   `{ "type": "broadcast_ack", "channel", "seq" }` where every other member
 *   gets the message. Its own messages then leave no hole in the sequence it
 *   watches, so a hole means a message it really missed — see
 *   `RealtimeChannel` in the SDK.
 * - `cancel_sql`: the server takes `CANCEL_SQL { requestId }`, which stops a
 *   console run (`EXECUTE_SQL`, `mode: "script"`) of the same socket. A client
 *   sends it only to a server whose `hello` listed it.
 *
 * @module
 */

/** The query parameter a client names its opt-ins in. */
export const SOCKET_OPT_IN_PARAM = "rebase_caps";

/** Every behaviour this server can be asked for. */
export const SOCKET_OPT_INS = ["heartbeat", "channel_seq", "cancel_sql"] as const;

export type SocketOptIn = typeof SOCKET_OPT_INS[number];

/** How often a socket that asked for heartbeats is sent one, by default. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

function isSocketOptIn(name: string): name is SocketOptIn {
    return (SOCKET_OPT_INS as readonly string[]).includes(name);
}

/**
 * What the client that opened this connection asked for, from its request
 * URL: `undefined` when it named nothing (a client that predates this, which
 * is sent no `hello`), otherwise the names this server honours — possibly
 * none.
 */
export function requestedOptIns(url: string | undefined): Set<SocketOptIn> | undefined {
    if (!url) return undefined;
    const query = url.indexOf("?");
    if (query === -1) return undefined;
    const raw = new URLSearchParams(url.slice(query + 1)).get(SOCKET_OPT_IN_PARAM);
    if (raw === null) return undefined;
    return new Set(raw.split(",").map((name) => name.trim()).filter(isSocketOptIn));
}

/**
 * The `hello` frame for a client that asked for `optIns`. With `channel_seq`
 * it also names the socket's own id, the `senderId` its broadcasts carry in a
 * channel's history, so a client filling a hole from history can tell its own
 * messages (which it is never sent live) from the ones it missed.
 */
export function helloFrame(optIns: ReadonlySet<SocketOptIn>, heartbeatMs: number, clientId: string): string {
    return JSON.stringify({
        type: "hello",
        capabilities: [...optIns],
        ...(optIns.has("heartbeat") ? { heartbeatMs } : {}),
        ...(optIns.has("channel_seq") ? { clientId } : {})
    });
}

const HEARTBEAT_FRAME = JSON.stringify({ type: "heartbeat" });

/**
 * Send a heartbeat every `intervalMs` to each socket `sockets()` lists. One
 * timer for the whole server, unref'd so it never holds the process open.
 *
 * @returns Stops it.
 */
export function startHeartbeats(sockets: () => Iterable<WebSocket>, intervalMs: number): () => void {
    const timer = setInterval(() => {
        for (const ws of sockets()) {
            if (ws.readyState !== WebSocket.OPEN) continue;
            try {
                ws.send(HEARTBEAT_FRAME);
            } catch {
                // A socket closing under the send: its close handler cleans up.
            }
        }
    }, intervalMs);
    unref(timer);
    return () => clearInterval(timer);
}
