/**
 * What happens to this process's sockets: who opened and closed them and why,
 * what they carried, and what was refused on them.
 *
 * A socket that closed used to leave one debug line, and that only outside
 * production, so "the phones keep losing the room" had nothing to be read
 * against: not whether the server let a socket go (no pong, a backlog, a
 * session that ended, a shutdown), the client did (a close frame, its own
 * watchdog) or the network did (a connection that just went). Every close now
 * names its cause, here for `/metrics` and in one info line per socket.
 *
 * Process-wide, like the send budget in `socket-liveness.ts`: `/metrics` is
 * per process, and every socket server in it counts in the same totals.
 *
 * @module
 */

import type { RealtimeSocketTotals } from "@rebasepro/types";

/**
 * Who ended a socket.
 *
 * - `client`: the client sent a close frame (a tab closed, a sign-out, an app
 *   that closed its client).
 * - `client_watchdog`: the client gave up on the socket itself — its
 *   heartbeat or wake check found it silent — and said so with 4003.
 * - `network`: the connection went without a close frame (1006): a phone that
 *   lost signal, a proxy that dropped it, a NAT that forgot it.
 * - `no_pong`: this server let it go after it missed a ping.
 * - `backlog`: this server let it go for not reading what it was sent.
 * - `session`: its identity ended (signed out, revoked, expired).
 * - `ceiling`: refused for its user's socket ceiling.
 * - `shutdown`: this server is shutting down.
 * - `oversized_frame`: it sent a frame larger than the server reads.
 * - `server`: this server closed it for another reason.
 */
export type SocketCloser =
    | "client"
    | "client_watchdog"
    | "network"
    | "no_pong"
    | "backlog"
    | "session"
    | "ceiling"
    | "shutdown"
    | "oversized_frame"
    | "server";

/** The close code the SDK closes a socket with when its own watchdog gave up on it. */
export const CLIENT_WATCHDOG_CLOSE_CODE = 4003;

const serverCauses = new WeakMap<object, SocketCloser>();

/**
 * Record that this server is ending `ws`, and why, before it closes or
 * terminates it. The first cause given is the one kept.
 */
export function noteServerClose(ws: object, cause: SocketCloser): void {
    if (!serverCauses.has(ws)) serverCauses.set(ws, cause);
}

/** Who ended `ws`, given the code its `close` event carried. */
export function closerOf(ws: object, code: number): SocketCloser {
    const cause = serverCauses.get(ws);
    if (cause) return cause;
    if (code === CLIENT_WATCHDOG_CLOSE_CODE) return "client_watchdog";
    if (code === 1006) return "network";
    return "client";
}

/**
 * A close code as a metric label: the codes the protocol defines and the ones
 * Rebase uses as themselves, anything else as `other` — a client may close
 * with any of two thousand application codes, and a label per one is
 * unbounded.
 */
export function closeCodeLabel(code: number): string {
    if ((code >= 1000 && code <= 1015) || (code >= 4000 && code <= 4003)) return String(code);
    return "other";
}

/**
 * Refusals worth counting: each drops what a client sent, and only the client
 * was told. `AUTH_UNAVAILABLE` is a frame refused because the auth store could
 * not re-check the identity (past the channel grace); `UNAUTHORIZED` one from
 * a socket that is not signed in. Both are what an app that rebuilds its link
 * on a channel error reads as a lost connection.
 */
export type SocketRefusal =
    | "RATE_LIMITED"
    | "CHANNEL_FORBIDDEN"
    | "CHANNEL_BUS_PAYLOAD_TOO_LARGE"
    | "FRAME_TOO_LARGE"
    | "AUTH_UNAVAILABLE"
    | "UNAUTHORIZED";

export class SocketStats {
    private opened = 0;
    private readonly closedBy = new Map<SocketCloser, number>();
    private readonly closeCodes = new Map<string, number>();
    private framesIn = 0;
    private bytesIn = 0;
    private framesOut = 0;
    private bytesOut = 0;
    private readonly refused = new Map<SocketRefusal, number>();

    noteOpened(): void {
        this.opened++;
    }

    noteClosed(closer: SocketCloser, code: number): void {
        this.closedBy.set(closer, (this.closedBy.get(closer) ?? 0) + 1);
        const label = closeCodeLabel(code);
        this.closeCodes.set(label, (this.closeCodes.get(label) ?? 0) + 1);
    }

    noteFrameIn(bytes: number): void {
        this.framesIn++;
        this.bytesIn += bytes;
    }

    noteFrameOut(bytes: number): void {
        this.framesOut++;
        this.bytesOut += bytes;
    }

    noteRefused(code: SocketRefusal): void {
        this.refused.set(code, (this.refused.get(code) ?? 0) + 1);
    }

    totals(): RealtimeSocketTotals {
        return {
            opened: this.opened,
            closedBy: Object.fromEntries(this.closedBy),
            closeCodes: Object.fromEntries(this.closeCodes),
            framesIn: this.framesIn,
            bytesIn: this.bytesIn,
            framesOut: this.framesOut,
            bytesOut: this.bytesOut,
            refused: Object.fromEntries(this.refused)
        };
    }
}

/** This process's totals. */
export const socketStats = new SocketStats();
