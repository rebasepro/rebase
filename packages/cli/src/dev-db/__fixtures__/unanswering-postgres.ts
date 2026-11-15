/**
 * A server on 127.0.0.1 that stands in for a local database that stopped
 * answering, the way the managed one does once its daemon is wedged.
 *
 * - `silent` accepts the socket and never sends anything. A client waits for
 *   the start-up reply that never comes.
 * - `after-handshake` completes the start-up (AuthenticationOk, then
 *   ReadyForQuery) and then never answers a query.
 *
 * It refuses nothing, which is the point. A refused connection fails on its
 * own, and only a connection with no answer at all shows whether a client has
 * a bound.
 */
import net from "node:net";

/** One of the servers {@link unansweringPostgres} starts. */
export interface UnansweringPostgres {
    /** A connection string for it. */
    url: string;
    /** How many connections it has accepted, which shows a client really reached it. */
    connections(): number;
    /** Drop every connection and stop listening. */
    close(): Promise<void>;
}

/** `AuthenticationOk`: `R`, length 8, code 0. */
const AUTHENTICATION_OK = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]);
/** `ReadyForQuery`, idle: `Z`, length 5, `I`. */
const READY_FOR_QUERY = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);

/** Start a server that answers as `mode` says, on a free port. */
export async function unansweringPostgres(mode: "silent" | "after-handshake"): Promise<UnansweringPostgres> {
    const sockets = new Set<net.Socket>();
    let accepted = 0;
    const server = net.createServer((socket) => {
        accepted += 1;
        sockets.add(socket);
        socket.on("error", () => undefined);
        socket.on("close", () => sockets.delete(socket));
        // The start-up message is the client's first write; nothing after it
        // gets a reply.
        if (mode === "after-handshake") socket.once("data", () => socket.write(Buffer.concat([AUTHENTICATION_OK, READY_FOR_QUERY])));
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("the stand-in server has no TCP address");

    return {
        url: `postgresql://postgres@127.0.0.1:${address.port}/postgres?sslmode=disable`,
        connections: () => accepted,
        close: async () => {
            for (const socket of sockets) socket.destroy();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    };
}
