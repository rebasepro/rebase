/**
 * A pod's graceful shutdown with a browser connected over realtime.
 *
 * The HTTP server's `close()` waits for every connection it accepted, and an
 * upgraded WebSocket is one of them for as long as the browser keeps it open —
 * `closeAllConnections()` does not reach it either. So the shutdown only
 * finishes if the realtime teardown closes its sockets; one that just drops its
 * references leaves `server.close()` waiting out the whole budget with Studio
 * open in one tab.
 */

import { createServer, type Server } from "http";
import { connect, type AddressInfo } from "net";
import { randomBytes } from "crypto";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { WebSocket, WebSocketServer } from "ws";
import { createShutdown } from "../../server/src/init/shutdown";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

function realtimeServer(): { server: Server; service: RealtimeService } {
    const db = { execute: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as NodePgDatabase<Record<string, unknown>>;
    const service = new RealtimeService(db, new PostgresCollectionRegistry());
    const server = createServer((_req, res) => res.end("ok"));
    const wss = new WebSocketServer({ server });
    let n = 0;
    wss.on("connection", (ws) => service.addClient(`client_${++n}`, ws));
    return { server, service };
}

async function listen(server: Server): Promise<number> {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
}

describe("RealtimeService.destroy() at shutdown", () => {
    it("closes connected clients with 1001, so the HTTP server finishes closing", async () => {
        const { server, service } = realtimeServer();
        const port = await listen(server);
        const client = new WebSocket(`ws://127.0.0.1:${port}`);
        await new Promise(resolve => client.once("open", resolve));
        const closed = new Promise<number>(resolve => client.once("close", (code) => resolve(code)));
        let serverClosed = false;
        server.once("close", () => { serverClosed = true; });

        const started = Date.now();
        try {
            await createShutdown({ server, realtimeServices: { default: service } })(3_000);
        } finally {
            if (server.listening) server.close();
            client.terminate();
        }

        expect(serverClosed).toBe(true);
        // Not the forced resolve at the 3s budget.
        expect(Date.now() - started).toBeLessThan(1_500);
        expect(await closed).toBe(1001);
    });

    it("drops a client that never answers the close frame instead of waiting on it", async () => {
        const { server, service } = realtimeServer();
        const port = await listen(server);

        // A raw upgrade that then ignores every frame: `ws` would otherwise wait
        // its own 30s close timeout for the reply.
        const socket = connect(port, "127.0.0.1");
        await new Promise<void>((resolve, reject) => {
            socket.once("error", reject);
            socket.once("connect", () => {
                socket.write(
                    "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                    `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`
                );
            });
            socket.once("data", (chunk: Buffer) => {
                if (chunk.toString().startsWith("HTTP/1.1 101")) resolve();
                else reject(new Error(`upgrade refused: ${chunk.toString()}`));
            });
        });
        socket.on("data", () => { /* swallow the close frame, never answer */ });
        const socketEnded = new Promise<void>(resolve => socket.once("close", () => resolve()));
        let serverClosed = false;
        server.once("close", () => { serverClosed = true; });

        const started = Date.now();
        try {
            await createShutdown({ server, realtimeServices: { default: service } })(5_000);
        } finally {
            if (server.listening) server.close();
            socket.destroy();
        }

        expect(serverClosed).toBe(true);
        expect(Date.now() - started).toBeLessThan(3_000);
        await socketEnded;
    });
});
