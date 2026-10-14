/**
 * A client that goes away mid-response gives its connection back.
 *
 * `rebase db migrate` on the managed database failed with `Error: EOF` while
 * `rebase dev` ran, and kept failing after any wait. Part of it was a slot the
 * socket server never gave back. When a client died with a response still on
 * its way (Atlas exiting on a failed migration does exactly that), the proxy
 * destroyed its upstream socket with that response unread, the kernel answered
 * with a reset, and `PGLiteSocketServer` (0.2.9) handles a reset by detaching
 * the handler's listeners before its `close` — the one event it stops counting
 * a connection on. Each such exit took one of the four connections until the
 * daemon restarted. The proxy now ends its upstream instead, so the server sees
 * an ordinary close.
 *
 * Built as the daemon builds it: PGlite, the socket server with the daemon's
 * limit, the proxy in front.
 */
import net from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MANAGED_SERVER_MAX_CONNECTIONS } from "./constraints";
import { NotificationProxy } from "./notification-proxy";
import { findFreePort } from "./state";

interface SocketServer {
    start(): Promise<void>;
    stop(): Promise<void>;
    getStats(): { activeConnections: number };
}

/** A protocol 3.0 startup message for PGlite's built-in user and database. */
function startupMessage(): Buffer {
    const body = Buffer.from("user\0postgres\0database\0postgres\0\0", "utf8");
    const message = Buffer.alloc(8 + body.length);
    message.writeInt32BE(message.length, 0);
    message.writeInt32BE(196608, 4);
    body.copy(message, 8);
    return message;
}

/** A simple-query message. */
function queryMessage(sql: string): Buffer {
    const text = Buffer.from(`${sql}\0`, "utf8");
    const message = Buffer.alloc(5 + text.length);
    message.write("Q", 0, "ascii");
    message.writeInt32BE(4 + text.length, 1);
    text.copy(message, 5);
    return message;
}

/**
 * Connect through the proxy, ask for a large result, and vanish as soon as
 * the first of it arrives. Resolves `false` when the server refused the
 * connection instead (`Too many connections`).
 */
function dieMidResponse(port: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        let phase: "startup" | "query" | "done" = "startup";
        socket.once("connect", () => socket.write(startupMessage()));
        socket.on("data", (chunk: Buffer) => {
            if (phase === "startup") {
                // ReadyForQuery ('Z') ends the startup exchange.
                if (!chunk.includes(Buffer.from("Z\0\0\0\x05", "binary"))) return;
                phase = "query";
                socket.write(queryMessage("SELECT repeat('x', 2000000)"));
                return;
            }
            if (phase === "query") {
                phase = "done";
                socket.destroy();
                resolve(true);
            }
        });
        socket.once("close", () => {
            if (phase !== "done") resolve(false);
        });
        socket.once("error", reject);
    });
}

describe("the proxy in front of the managed database", () => {
    let db: { close(): Promise<void> };
    let server: SocketServer;
    let proxy: NotificationProxy;
    let port: number;

    beforeAll(async () => {
        const { PGlite } = (await import("@electric-sql/pglite")) as {
            PGlite: { create(options?: unknown): Promise<{ close(): Promise<void> }> };
        };
        const { PGLiteSocketServer } = (await import("@electric-sql/pglite-socket")) as {
            PGLiteSocketServer: new (options: unknown) => SocketServer;
        };
        db = await PGlite.create();
        const upstreamPort = await findFreePort();
        server = new PGLiteSocketServer({
            db, port: upstreamPort, host: "127.0.0.1", maxConnections: MANAGED_SERVER_MAX_CONNECTIONS
        });
        await server.start();
        port = await findFreePort();
        proxy = new NotificationProxy({ listenPort: port, upstreamPort });
        await proxy.start();
    });

    afterAll(async () => {
        await proxy?.stop();
        await server?.stop();
        await db?.close();
    });

    it("gives the socket server its connection back when a client dies mid-response", async () => {
        // More exits than the server has connections: before, the third or
        // fourth found every slot taken and was refused.
        const served: boolean[] = [];
        for (let i = 0; i < MANAGED_SERVER_MAX_CONNECTIONS + 2; i++) {
            served.push(await dieMidResponse(port));
        }
        await new Promise(resolve => setTimeout(resolve, 500));

        expect(served).toEqual(served.map(() => true));
        expect(server.getStats().activeConnections).toBe(0);
    });
});
