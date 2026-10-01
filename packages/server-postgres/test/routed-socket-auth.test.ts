import { describe, it, expect, jest, afterEach } from "@jest/globals";

/**
 * A socket on a project with two realtime-capable sources signs in.
 *
 * With two Postgres sources the socket is driven by the routed composite, not
 * by one `RealtimeService`. `AUTHENTICATE` re-scopes what the socket already
 * holds by calling `rescopeClient` — added to the service and called from the
 * socket, and never added to the composite. The bootstrapper handed the
 * composite over as `realtimeService as RealtimeService`, so nothing checked:
 * every sign-in on such a project answered INTERNAL_ERROR ("An unexpected error
 * occurred" in production) after the session had already been marked
 * authenticated, and every token refresh did the same.
 *
 * Real sockets and the real composite, so the door is the one a client uses.
 */

jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollectionForRest: jest.fn(async () => [{ id: 1 }]),
        fetchOneForRest: jest.fn(async () => ({ id: 1 })),
        count: jest.fn(async () => 1),
        cursorFor: jest.fn().mockReturnValue(undefined)
    }))
}));

import http from "http";
import WebSocket from "ws";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AuthAdapter, CollectionConfig } from "@rebasepro/types";
import { createRoutedRealtimeService } from "../../server/src/services/routed-realtime-service";
import { createPostgresWebSocket } from "../src/websocket";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import type { PostgresBackendDriver } from "../src/PostgresBackendDriver";

const collection = (slug: string) => ({
    slug,
    name: slug,
    table: slug,
    properties: { id: { type: "number", isId: true } }
}) as unknown as CollectionConfig;

function provider(slug: string): RealtimeService {
    const db = {
        execute: jest.fn(async () => ({ rows: [] })),
        transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(db))
    } as unknown as NodePgDatabase<Record<string, never>>;
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([collection(slug)]);
    const service = new RealtimeService(db, registry);
    service.setDataDriver({ callContextWithin: () => ({}) } as never);
    return service;
}

const servers: http.Server[] = [];
const sockets: WebSocket[] = [];
const services: RealtimeService[] = [];

afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const service of services.splice(0)) await service.destroy();
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

type Frame = { type: string; requestId?: string; subscriptionId?: string; payload?: { error?: { code?: string; message?: string } } };

async function start() {
    const posts = provider("posts");
    const events = provider("events");
    services.push(posts, events);
    const routed = createRoutedRealtimeService({
        providers: { "(default)": posts, analytics: events },
        defaultKey: "(default)",
        resolveKey: (path) => (path.startsWith("events") ? "analytics" : "(default)")
    });
    const adapter = {
        verifyToken: async (token: string) => ({ uid: "u1", email: "", roles: [token], isAdmin: false }),
        verifyRequest: async () => null
    } as unknown as AuthAdapter;
    const driver = { key: "postgres", initialised: true } as unknown as PostgresBackendDriver;

    const server = http.createServer();
    servers.push(server);
    // Exactly what `initializeWebsockets` does on a multi-source project.
    createPostgresWebSocket(server, routed, driver, { requireAuth: true }, adapter);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(ws);
    await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
    const frames: Frame[] = [];
    ws.on("message", (data) => frames.push(JSON.parse(data.toString()) as Frame));
    const waitFor = async (predicate: (frame: Frame) => boolean): Promise<Frame> => {
        for (let i = 0; i < 200; i++) {
            const found = frames.find(predicate);
            if (found) return found;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error(`no such frame; got ${JSON.stringify(frames)}`);
    };
    return { ws, frames, waitFor, posts, events };
}

describe("signing in through the multi-source composite", () => {
    it("answers AUTH_SUCCESS", async () => {
        const { ws, waitFor } = await start();

        ws.send(JSON.stringify({ type: "AUTHENTICATE", requestId: "auth", payload: { token: "editor" } }));

        expect((await waitFor(f => f.requestId === "auth")).type).toBe("AUTH_SUCCESS");
    });

    it("re-scopes the subscriptions every source holds for the socket on the next sign-in", async () => {
        const { ws, waitFor, posts, events } = await start();
        ws.send(JSON.stringify({ type: "AUTHENTICATE", requestId: "auth-1", payload: { token: "editor" } }));
        await waitFor(f => f.requestId === "auth-1");
        ws.send(JSON.stringify({ type: "subscribe_collection", payload: { path: "posts", subscriptionId: "p" } }));
        ws.send(JSON.stringify({ type: "subscribe_collection", payload: { path: "events", subscriptionId: "e" } }));
        await waitFor(f => f.subscriptionId === "p");
        await waitFor(f => f.subscriptionId === "e");
        const rescoped = [jest.spyOn(posts, "rescopeClient"), jest.spyOn(events, "rescopeClient")];

        ws.send(JSON.stringify({ type: "AUTHENTICATE", requestId: "auth-2", payload: { token: "viewer" } }));

        expect((await waitFor(f => f.requestId === "auth-2")).type).toBe("AUTH_SUCCESS");
        for (const spy of rescoped) {
            expect(spy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ roles: ["viewer"] }));
        }
    });
});
