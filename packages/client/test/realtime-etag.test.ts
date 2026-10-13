import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { etagOf } from "@rebasepro/common";
import { RebaseWebSocketClient } from "../src/websocket";
import { createCollectionClient } from "../src/collection";
import type { Transport } from "../src/transport";
import { defaultResponder, FaultServer, type Responder } from "./support/fault-socket";

/**
 * A row held through `listenOne` carries the version it arrived at.
 *
 * `If-Match` is honoured by `PATCH`, but a row that arrived over the socket
 * carried no version, so a client editing it — the admin form, the offline
 * queue — had nothing to send. The SDK now asks for a tag on every
 * `subscribe_one`, and keeps the one each frame carries on that frame's row,
 * where `etagOf` reads it. Both directions of a version mismatch keep working:
 * a server that predates the tag ignores the ask and sends untagged frames,
 * which read as rows with no version.
 */

let clients: RebaseWebSocketClient[] = [];

function connect(server: FaultServer): RebaseWebSocketClient {
    const client = new RebaseWebSocketClient({ websocketUrl: "ws://test", WebSocket: server.WebSocket });
    client.ensureConnected();
    clients.push(client);
    return client;
}

/** A server that tags `single_update` frames for a subscriber that asked. */
const taggingResponder: Responder = (frame, server) => defaultResponder(frame, server).map((reply) =>
    reply.type === "single_update" && frame.payload?.etag === true && reply.row
        ? { ...reply, etag: `"v-${String((reply.row as Record<string, unknown>).title)}"` }
        : reply);

describe("row frames carry the row's ETag", () => {
    beforeEach(() => {
        clients = [];
        jest.useFakeTimers();
        for (const level of ["log", "debug", "warn", "error"] as const) {
            jest.spyOn(console, level).mockImplementation(() => undefined);
        }
    });

    afterEach(() => {
        for (const client of clients) client.disconnect(true);
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("asks for the tag, and each frame's row carries its own", async () => {
        const server = new FaultServer(taggingResponder);
        server.setRows("posts", [{ id: "1", title: "first" }]);
        const client = connect(server);
        const rows: (Record<string, unknown> | null)[] = [];
        client.listenOne({ path: "posts", id: "1" }, (row) => rows.push(row));
        await jest.advanceTimersByTimeAsync(50);

        expect(server.receivedOfType("subscribe_one")[0].payload).toMatchObject({ path: "posts", id: "1", etag: true });
        expect(rows).toHaveLength(1);
        expect(etagOf(rows[0])).toBe("\"v-first\"");
        // A fact about the read, not a column: it stays out of the row's keys
        // and out of anything that copies it into a write.
        expect(Object.keys(rows[0]!)).toEqual(["id", "title"]);
        expect(JSON.stringify(rows[0])).toBe("{\"id\":\"1\",\"title\":\"first\"}");

        const subscriptionId = String(server.receivedOfType("subscribe_one")[0].payload?.subscriptionId);
        server.broadcast({ type: "single_update", subscriptionId, row: { id: "1", title: "second" }, etag: "\"v-second\"" });
        await jest.advanceTimersByTimeAsync(10);
        expect(rows).toHaveLength(2);
        expect(etagOf(rows[1])).toBe("\"v-second\"");
    });

    it("a second listener on the same row is handed the tagged row", async () => {
        const server = new FaultServer(taggingResponder);
        server.setRows("posts", [{ id: "1", title: "first" }]);
        const client = connect(server);
        client.listenOne({ path: "posts", id: "1" }, () => undefined);
        await jest.advanceTimersByTimeAsync(50);

        const late: (Record<string, unknown> | null)[] = [];
        client.listenOne({ path: "posts", id: "1" }, (row) => late.push(row));
        await jest.advanceTimersByTimeAsync(50);
        expect(etagOf(late[0])).toBe("\"v-first\"");
    });

    it("against a server that does not tag frames, rows arrive as before, with no version", async () => {
        const server = new FaultServer(defaultResponder);
        server.setRows("posts", [{ id: "1", title: "first" }]);
        const client = connect(server);
        const rows: (Record<string, unknown> | null)[] = [];
        const errors: Error[] = [];
        client.listenOne({ path: "posts", id: "1" }, (row) => rows.push(row), (error) => errors.push(error));
        await jest.advanceTimersByTimeAsync(50);

        expect(errors).toEqual([]);
        expect(rows).toEqual([{ id: "1", title: "first" }]);
        expect(etagOf(rows[0])).toBeUndefined();
    });

    it("a frame for a deleted row is null, whatever tag it carries", async () => {
        const server = new FaultServer(taggingResponder);
        server.setRows("posts", [{ id: "1", title: "first" }]);
        const client = connect(server);
        const rows: (Record<string, unknown> | null)[] = [];
        client.listenOne({ path: "posts", id: "1" }, (row) => rows.push(row));
        await jest.advanceTimersByTimeAsync(50);
        const subscriptionId = String(server.receivedOfType("subscribe_one")[0].payload?.subscriptionId);
        server.broadcast({ type: "single_update", subscriptionId, row: null, etag: "\"stray\"" });
        await jest.advanceTimersByTimeAsync(10);
        expect(rows[1]).toBeNull();
    });
});

describe("update() hands back the version it wrote", () => {
    function transportAnswering(etag: string | undefined): Transport {
        const request: Transport["request"] = async (_path, init, meta) => {
            if (meta) meta.etag = etag;
            return { id: 1, title: JSON.parse(String(init?.body)).title } as never;
        };
        const transport: Transport = {
            request,
            baseUrl: "http://localhost",
            apiPath: "/api",
            fetchFn: globalThis.fetch,
            setToken: () => undefined,
            setAuthTokenGetter: () => undefined,
            getHeaders: () => ({}),
            resolveToken: async () => null
        };
        return transport;
    }

    it("so the next conditional write can name it", async () => {
        const posts = createCollectionClient<Record<string, unknown>>(transportAnswering("\"v2\""), "posts");
        const updated = await posts.update(1, { title: "x" }, { ifMatch: "\"v1\"" });
        expect(etagOf(updated)).toBe("\"v2\"");
        expect(Object.keys(updated)).toEqual(["id", "title"]);
    });

    it("and nothing from a server that sends no ETag", async () => {
        const posts = createCollectionClient<Record<string, unknown>>(transportAnswering(undefined), "posts");
        expect(etagOf(await posts.update(1, { title: "x" }))).toBeUndefined();
    });
});
