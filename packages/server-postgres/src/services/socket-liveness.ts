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
 * frame for it, and when all of the process's sockets together hold more than
 * {@link MAX_PROCESS_BUFFERED_BYTES}, the ones with the largest backlogs go
 * first. A terminated socket closes like any other, so the realtime service
 * drops its subscriptions, channels and presence on its `close`.
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
 * The unsent bytes all of this process's sockets may hold between them before
 * the ones with the largest backlogs are terminated.
 *
 * The per-socket ceiling alone bounds nothing for the process: a hundred slow
 * phones during a bulk-update storm could each sit just under it, 1.6 GB of
 * frames between them, before any one was let go. A healthy socket's backlog
 * is close to nothing — the kernel takes a frame as it is written — so a
 * process holding this much unread is already in a storm. 256 MiB is sixteen
 * sockets at their own ceiling, and an eighth of a 2 GiB container; under a
 * smaller memory limit it is a quarter of that limit (see
 * {@link processSendBudget}).
 */
export const MAX_PROCESS_BUFFERED_BYTES = 256 * 1024 * 1024;

/**
 * How often, at most, the process budget is summed, in ms. Summing it walks
 * every socket, so it is not done for every frame; between two sums only the
 * frames sent in this window can have been added.
 */
const PROCESS_BUDGET_CHECK_MS = 250;

/**
 * The process-wide budget: {@link MAX_PROCESS_BUFFERED_BYTES}, or a quarter of
 * the memory limit the process runs under when that is smaller — never less
 * than one socket's own ceiling. `constrained` is the limit in bytes, 0 for
 * none, as `process.constrainedMemory()` reports it.
 */
export function processSendBudget(constrained: number = process.constrainedMemory()): number {
    if (!(constrained > 0)) return MAX_PROCESS_BUFFERED_BYTES;
    return Math.max(MAX_SOCKET_BUFFERED_BYTES, Math.min(MAX_PROCESS_BUFFERED_BYTES, Math.floor(constrained / 4)));
}

/** Read once: the limit a process runs under does not change while it runs. */
let sendBudget: number | undefined;

/** The clients of every socket server in this process that counts in the budget. */
const budgetedClients = new Set<Set<WebSocket>>();
let lastBudgetCheckAt = 0;

/**
 * Count the sockets of `wss` in the process-wide send budget. Returns the
 * function that stops counting them, for when the server closes.
 */
export function budgetSendBuffers(wss: WebSocketServer): () => void {
    const clients: Set<WebSocket> | undefined = wss.clients;
    if (!clients) return () => undefined;
    budgetedClients.add(clients);
    return () => {
        budgetedClients.delete(clients);
    };
}

/**
 * Terminate sockets, largest backlog first, until what this process's sockets
 * hold unread between them is back within `budget`. Returns the sockets it
 * terminated. A terminated socket closes like any other, and its client
 * reconnects and re-subscribes: one fresh frame per subscription, instead of
 * the backlog.
 */
export function enforceProcessSendBudget(budget?: number): WebSocket[] {
    const limit = budget ?? (sendBudget ??= processSendBudget());
    let total = 0;
    const backlogged: Array<{ ws: WebSocket; bytes: number }> = [];
    for (const clients of budgetedClients) {
        for (const ws of clients) {
            const bytes = ws.bufferedAmount;
            if (bytes > 0) {
                total += bytes;
                backlogged.push({ ws, bytes });
            }
        }
    }
    if (total <= limit) return [];
    backlogged.sort((a, b) => b.bytes - a.bytes);
    const held = total;
    const terminated: WebSocket[] = [];
    for (const { ws, bytes } of backlogged) {
        if (total <= limit) break;
        ws.terminate();
        total -= bytes;
        terminated.push(ws);
    }
    // One line for the lot: a storm can let go of hundreds at once.
    logger.warn(
        `[WebSocket Server] Terminated ${terminated.length} socket(s), largest backlog first: the process's sockets held ` +
        `${held} unread bytes between them, past the ${limit}-byte budget for all of them, and hold ${total} now.`
    );
    return terminated;
}

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
 *
 * Every frame in and out of a socket comes through here, so this is also where
 * the process-wide budget is kept, summed at most every
 * {@link PROCESS_BUDGET_CHECK_MS} — see {@link enforceProcessSendBudget}.
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
    const now = Date.now();
    // A clock that went back (or a fake one in a test) starts the window again.
    if (now - lastBudgetCheckAt >= PROCESS_BUDGET_CHECK_MS || now < lastBudgetCheckAt) {
        lastBudgetCheckAt = now;
        if (budgetedClients.size > 0 && enforceProcessSendBudget().includes(ws)) return true;
    }
    return false;
}
