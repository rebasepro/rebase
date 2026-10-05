/**
 * Letting go of client sockets the server can no longer reach.
 *
 * A phone that loses signal, a laptop that sleeps, a NAT that forgets the
 * connection: the peer is gone, and nothing tells the server. No close frame
 * arrives and no FIN, so the socket stays open until the operating system gives
 * up on the TCP connection — about two hours on Linux. Meanwhile every
 * subscription it holds is refetched on every write to its collection, and
 * every frame for it is serialised into a send buffer nobody drains.
 *
 * Two checks catch it. The socket must answer a ping: one that has not answered
 * by the next is terminated. And it must read what it is sent: one whose unsent
 * backlog passes {@link MAX_SOCKET_BUFFERED_BYTES} is terminated at the next
 * frame for it. A terminated socket closes like any other, so the realtime
 * service drops its subscriptions, channels and presence on its `close`.
 */

import { WebSocket, type WebSocketServer } from "ws";
import { logger } from "@rebasepro/server";
import { unref } from "@rebasepro/utils";

/**
 * How often every socket is pinged. A socket that has not answered one ping by
 * the next is terminated, so a peer that vanished is let go of within two
 * intervals. Every browser and `ws` client answers a ping by itself.
 */
export const SOCKET_PING_INTERVAL_MS = 30_000;

/**
 * The unsent bytes a socket may have queued before it is terminated.
 *
 * A healthy client drains its queue as fast as the network allows; one whose
 * backlog keeps growing is not reading, or is so far behind that what it would
 * read is stale. Set well above a single frame — the largest body the data API
 * accepts is 10 MiB, and a list frame can approach it — so a burst of large
 * frames to a client that is keeping up does not trip it. A terminated client
 * reconnects and resubscribes, which brings it up to date with one frame per
 * subscription instead of the backlog.
 */
export const MAX_SOCKET_BUFFERED_BYTES = 16 * 1024 * 1024;

/**
 * Ping every socket of `wss` each `intervalMs`, and terminate the ones that did
 * not answer the previous ping. Returns the function that stops it.
 */
export function reapSilentSockets(wss: WebSocketServer, intervalMs: number = SOCKET_PING_INTERVAL_MS): () => void {
    // Read here rather than on the first tick. A server made with
    // `clientTracking: false` has no `clients`, and finding that out inside the
    // timer throws from a callback nothing catches, which ends the process
    // `intervalMs` later — whatever it is doing by then. That is how a test
    // double without `clients` took down the jest worker that ran it, along with
    // every suite the worker had moved on to.
    const clients: Set<WebSocket> | undefined = wss.clients;
    if (!clients) {
        throw new Error("reapSilentSockets needs a WebSocketServer that tracks its clients; this one was created with clientTracking: false.");
    }
    const awaitingPong = new WeakSet<WebSocket>();
    wss.on("connection", (ws: WebSocket) => {
        ws.on("pong", () => awaitingPong.delete(ws));
    });
    const timer = setInterval(() => {
        for (const ws of clients) {
            if (awaitingPong.has(ws)) {
                logger.debug(`[WebSocket Server] Terminated a socket that did not answer a ping within ${intervalMs}ms.`);
                ws.terminate();
                continue;
            }
            if (ws.readyState !== WebSocket.OPEN) continue;
            awaitingPong.add(ws);
            ws.ping();
        }
    }, intervalMs);
    // Housekeeping must never hold the process open.
    unref(timer);
    return () => clearInterval(timer);
}

/**
 * Terminate `ws` if its unsent backlog has passed {@link MAX_SOCKET_BUFFERED_BYTES}.
 * Returns whether it did; the caller then sends nothing.
 */
export function terminateIfBacklogged(ws: WebSocket, clientId: string): boolean {
    const backlog = ws.bufferedAmount;
    if (backlog > MAX_SOCKET_BUFFERED_BYTES) {
        logger.warn(
            `[WebSocket Server] Terminated ${clientId}: ${backlog} bytes sent to it are still unread, ` +
            `past the ${MAX_SOCKET_BUFFERED_BYTES}-byte ceiling for one socket.`
        );
        ws.terminate();
        return true;
    }
    return false;
}
