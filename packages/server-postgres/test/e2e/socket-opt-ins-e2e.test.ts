/**
 * E2E: what a client opts into on the socket URL, against the real server.
 *
 * `?rebase_caps=heartbeat,channel_seq` asks for two behaviours, and the server
 * answers with a `hello` naming the ones it honours:
 *
 *  - `heartbeat`: a `{ type: "heartbeat" }` frame every interval, which is how
 *    a browser — it cannot send or see a WebSocket ping — notices a socket that
 *    went half-open;
 *  - `channel_seq`: on a retained channel, the sender of a broadcast gets
 *    `broadcast_ack` with the number its message took, so its own messages
 *    leave no hole in the sequence it watches.
 *
 * A client that asks for nothing — every client before this — gets exactly
 * what it always got: no `hello`, no heartbeat, no acknowledgement. Raw sockets
 * for the wire; the SDK's own client for what an application sees.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket as NodeWebSocket } from "ws";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { createPostgresWebSocket } from "../../src/websocket.js";
import { RebaseWebSocketClient, RebaseRealtimeChannel, type BroadcastEvent } from "@rebasepro/client";
import type { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";

const HEARTBEAT_MS = 150;

type Frame = Record<string, unknown> & { type: string };

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${message}`);
        await new Promise((r) => setTimeout(r, 20));
    }
}

describe("socket opt-ins (E2E)", () => {
    let container: PgContainer;
    let pool: pg.Pool;
    let realtime: RealtimeService;
    let server: Server;
    let port: number;
    const sockets: NodeWebSocket[] = [];
    const clients: RebaseWebSocketClient[] = [];

    async function raw(query = ""): Promise<{ ws: NodeWebSocket; frames: Frame[] }> {
        const ws = new NodeWebSocket(`ws://127.0.0.1:${port}/${query}`);
        sockets.push(ws);
        const frames: Frame[] = [];
        ws.on("message", (data) => frames.push(JSON.parse(String(data)) as Frame));
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });
        return { ws, frames };
    }

    function sdk(): RebaseWebSocketClient {
        const client = new RebaseWebSocketClient({
            websocketUrl: `ws://127.0.0.1:${port}`,
            WebSocket: NodeWebSocket as unknown as typeof WebSocket
        });
        clients.push(client);
        return client;
    }

    beforeAll(async () => {
        container = await startPgContainer();
        pool = new pg.Pool({ connectionString: container.connectionString });
        realtime = new RealtimeService(drizzle(pool) as never, new PostgresCollectionRegistry());
        await realtime.configureChannelHistory([{ match: "doc:*", limit: 50, ttl: "1h" }]);
        server = createServer();
        createPostgresWebSocket(server, realtime, {} as PostgresBackendDriver, { requireAuth: false }, undefined, {
            heartbeatIntervalMs: HEARTBEAT_MS
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        port = (server.address() as AddressInfo).port;
    }, 120_000);

    afterAll(async () => {
        for (const client of clients) client.disconnect(true);
        for (const ws of sockets) ws.terminate();
        await realtime?.destroy();
        await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
        await pool?.end();
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("a client that asks is said hello first, and sent heartbeats", async () => {
        const { frames } = await raw("?rebase_caps=heartbeat,channel_seq,something_new");
        await waitFor(() => frames.filter((f) => f.type === "heartbeat").length >= 2, "two heartbeats");
        const [first] = frames;
        expect(first.type).toBe("hello");
        // Only what this server does; a name it does not know is left out.
        expect(first.capabilities).toEqual(["heartbeat", "channel_seq"]);
        // `cancel_sql` only when asked: this client did not.
        expect(first.capabilities).not.toContain("cancel_sql");
        expect(first.heartbeatMs).toBe(HEARTBEAT_MS);
        expect(first.clientId).toEqual(expect.any(String));
    });

    it("a client that asks for nothing gets nothing it did not get before", async () => {
        const { frames } = await raw();
        await new Promise((r) => setTimeout(r, HEARTBEAT_MS * 4));
        expect(frames).toEqual([]);
    });

    it("the sender of a retained broadcast is told its number; the others get the message", async () => {
        const sender = await raw("?rebase_caps=channel_seq");
        const reader = await raw("?rebase_caps=channel_seq");
        const old = await raw();
        for (const { ws } of [sender, reader, old]) ws.send(JSON.stringify({ type: "join_channel", payload: { channel: "doc:ack" } }));
        await new Promise((r) => setTimeout(r, 200));

        sender.ws.send(JSON.stringify({ type: "broadcast", payload: { channel: "doc:ack", event: "op", payload: { n: 1 } } }));
        await waitFor(() => reader.frames.some((f) => f.type === "broadcast"), "the reader's message");
        await waitFor(() => sender.frames.some((f) => f.type === "broadcast_ack"), "the sender's ack");
        const delivered = reader.frames.find((f) => f.type === "broadcast")!;
        const ack = sender.frames.find((f) => f.type === "broadcast_ack")!;
        expect(ack).toEqual({ type: "broadcast_ack", channel: "doc:ack", seq: delivered.seq });
        expect(sender.frames.some((f) => f.type === "broadcast")).toBe(false);

        // A sender that did not ask is sent neither its message nor an ack.
        old.ws.send(JSON.stringify({ type: "broadcast", payload: { channel: "doc:ack", event: "op", payload: { n: 2 } } }));
        await waitFor(() => reader.frames.filter((f) => f.type === "broadcast").length === 2, "the second message");
        await new Promise((r) => setTimeout(r, 100));
        expect(old.frames.filter((f) => f.type !== "broadcast")).toEqual([]);
        expect(old.frames.filter((f) => f.type === "broadcast").map((f) => (f.payload as { n: number }).n)).toEqual([1]);
    });

    it("through the SDK: a sender's own messages leave no hole, and history names it by the id its hello gave", async () => {
        const writer = sdk();
        const watcher = sdk();
        const writerChannel = new RebaseRealtimeChannel("doc:sdk", writer, { history: true });
        const watcherChannel = new RebaseRealtimeChannel("doc:sdk", watcher, { history: true });
        const seen: BroadcastEvent[] = [];
        watcherChannel.onBroadcast((event) => seen.push(event));
        const writerSaw: BroadcastEvent[] = [];
        writerChannel.onBroadcast((event) => writerSaw.push(event));
        await writerChannel.join();
        await watcherChannel.join();
        await waitFor(() => writer.hasServerOptIn("channel_seq") && watcher.hasServerOptIn("heartbeat"), "both said hello");

        for (let i = 1; i <= 3; i++) await writerChannel.broadcast("op", { i });
        await waitFor(() => seen.length === 3, "the watcher's three messages");
        await waitFor(() => writerChannel.sequence === seen[2].seq, "the writer's watermark follows its own messages");
        expect(writerSaw).toEqual([]);

        const history = await watcherChannel.history({ sinceSeq: 0 });
        expect(history.messages.map((m) => m.senderId)).toEqual([writer.socketClientId, writer.socketClientId, writer.socketClientId]);
    });
});
