import { describe, it, expect, afterEach } from "@jest/globals";
import http from "http";
import WebSocket from "ws";
import { createPostgresWebSocket } from "../src/websocket";
import type { RealtimeService } from "../src/services/realtimeService";
import type { PostgresBackendDriver } from "../src/PostgresBackendDriver";

/**
 * The socket reads a filter the way every other door does.
 *
 * REST, MCP and the in-process SDK decode `where` through `deserializeFilter`,
 * so `{ title: ["foo", "bar"] }` is an implicit `in`, and `["!!", "x"]` is a
 * 400 naming the operator. The socket's `FETCH_COLLECTION` and `COUNT` handed
 * the frame's filter to the driver raw, which read the first element as an
 * operator: the same filter answered rows on one door and an error on the
 * other (calls 2026-10-12, S2 / DD-11).
 */

type Frame = { type: string; payload?: { error?: { code?: string } } };

const servers: http.Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function start(): Promise<{ port: number; seen: Record<string, unknown>[] }> {
    const seen: Record<string, unknown>[] = [];
    const driver = {
        key: "postgres",
        initialised: true,
        fetchCollection: async (props: Record<string, unknown>) => {
            seen.push(props);
            return [];
        },
        count: async (props: Record<string, unknown>) => {
            seen.push(props);
            return 0;
        },
        withAuth: async () => driver
    } as unknown as PostgresBackendDriver;
    const realtime = {
        addClient: () => undefined,
        handleClientMessage: async () => undefined,
        rescopeClient: async () => undefined
    } as unknown as RealtimeService;

    const server = http.createServer();
    servers.push(server);
    createPostgresWebSocket(server, realtime, driver, { requireAuth: false });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    return { port, seen };
}

async function exchange(port: number, frame: unknown): Promise<Frame> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(ws);
    await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
    });
    return new Promise<Frame>((resolve) => {
        ws.once("message", (data) => resolve(JSON.parse(data.toString()) as Frame));
        ws.send(JSON.stringify(frame));
    });
}

describe("the socket's filter", () => {
    for (const type of ["FETCH_COLLECTION", "COUNT"] as const) {
        it(`${type}: a two-element value array is an implicit \`in\``, async () => {
            const { port, seen } = await start();
            const answer = await exchange(port, {
                type, requestId: "r1",
                payload: { path: "posts", filter: { title: ["foo", "bar"], views: [">=", 3] } }
            });
            expect(answer.type).toBe(`${type}_SUCCESS`);
            expect(seen[0].filter).toEqual({ title: ["in", ["foo", "bar"]], views: [">=", 3] });
        });

        it(`${type}: an unknown operator is refused by name`, async () => {
            const { port, seen } = await start();
            const answer = await exchange(port, {
                type, requestId: "r1",
                payload: { path: "posts", filter: { title: ["!!", "x"] } }
            });
            expect(answer.type).toBe("ERROR");
            expect(answer.payload?.error?.code).toBe("UNKNOWN_FILTER_OPERATOR");
            expect(seen).toHaveLength(0);
        });
    }
});
