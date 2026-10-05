import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * The cross-instance listener notices a half-open connection, and keeps
 * dialling a database it could not reach at boot.
 *
 * Without change capture (`REALTIME_CDC=off`, or a role that cannot create
 * triggers), writes cross instances on `rebase_entity_changes`, through a
 * LISTEN connection of the realtime service's own. That connection had no
 * heartbeat: once an idle-flow timeout on a load balancer or a NAT dropped it
 * without a FIN or an RST, it fired no `error` and no `end`, and every write
 * made on another instance was lost here with no error, no reconnect and
 * nothing in `/health`. It now proves itself the way the CDC listener does,
 * and a connection that stops answering is replaced and its subscribers
 * resynced.
 */

type FakeClient = {
    options: Record<string, unknown>;
    connect: jest.Mock;
    query: jest.Mock;
    end: jest.Mock;
    on: jest.Mock;
    handlers: Record<string, (arg?: unknown) => void>;
};
const clients: FakeClient[] = [];
/** When set, a heartbeat never comes back — the half-open link. */
let silent = false;
/** How many of the next connects fail, as against a database that is down. */
let failingConnects = 0;

jest.mock("pg", () => ({
    Client: jest.fn().mockImplementation((options: unknown) => {
        const client: FakeClient = {
            options: options as Record<string, unknown>,
            connect: jest.fn(async () => {
                if (failingConnects > 0) {
                    failingConnects--;
                    throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
                }
            }),
            query: jest.fn((text: unknown) => (text === "SELECT 1" && silent ? new Promise(() => undefined) : Promise.resolve({}))),
            end: jest.fn(async () => undefined),
            on: jest.fn(),
            handlers: {}
        };
        client.on.mockImplementation(((event: string, handler: (arg?: unknown) => void) => {
            client.handlers[event] = handler;
        }) as never);
        clients.push(client);
        return client;
    })
}));

const mockFetchCollection = jest.fn(async () => [{ id: 1, title: "Closed" }]);
const mockFetchEntity = jest.fn(async () => ({ id: 1, title: "Closed" }));
jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollectionForRest: mockFetchCollection,
        fetchOneForRest: mockFetchEntity,
        count: jest.fn(async () => 1),
        cursorFor: jest.fn().mockReturnValue(undefined),
        fetchCollection: mockFetchCollection,
        fetchOne: mockFetchEntity,
        searchRows: jest.fn(async () => [])
    }))
}));

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CollectionConfig } from "@rebasepro/types";
import { PgNotifyListener } from "../src/services/pg-notify-listener";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const posts = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number", isId: true },
        title: { type: "string" }
    }
} as unknown as CollectionConfig;

/** A drain for the async reconnect and the refetch it schedules. */
async function flush() {
    for (let i = 0; i < 40; i++) await Promise.resolve();
}

beforeEach(() => {
    clients.length = 0;
    silent = false;
    failingConnects = 0;
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
});

describe("PgNotifyListener told to keep dialling", () => {
    it("resolves a first connect that fails, retries it, and reports the gap once it is listening", async () => {
        failingConnects = 1;
        const onReconnect = jest.fn();
        const listener = new PgNotifyListener({
            connectionString: "postgres://localhost/db",
            channel: "rebase_test",
            onPayload: () => undefined,
            logLabel: "[TEST]",
            reconnectDelayMs: 1_000,
            retryInitialConnect: true,
            onReconnect
        });

        await listener.start();
        expect(listener.active).toBe(true);
        expect(listener.status()).toMatchObject({ connected: false, downSince: expect.any(Number) });
        expect(clients[0].end).toHaveBeenCalled();

        jest.advanceTimersByTime(1_000);
        await flush();

        expect(clients).toHaveLength(2);
        expect(clients[1].query).toHaveBeenCalledWith("LISTEN rebase_test");
        expect(listener.status()).toEqual(expect.objectContaining({ connected: true }));
        expect(onReconnect).toHaveBeenCalledTimes(1);

        await listener.stop();
    });

    it("still rejects a first connect that fails when not told to retry", async () => {
        failingConnects = 1;
        const listener = new PgNotifyListener({
            connectionString: "postgres://localhost/db",
            channel: "rebase_test",
            onPayload: () => undefined,
            logLabel: "[TEST]",
            reconnectDelayMs: 1_000
        });

        await expect(listener.start()).rejects.toThrow("ECONNREFUSED");
        expect(listener.active).toBe(false);
        jest.advanceTimersByTime(5_000);
        await flush();
        expect(clients).toHaveLength(1);
    });
});

describe("RealtimeService's cross-instance listener", () => {
    let service: RealtimeService;
    let ws: { readyState: number; send: jest.Mock; on: jest.Mock };

    beforeEach(() => {
        const db = {
            execute: jest.fn(async () => ({ rows: [] })),
            transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(db))
        } as unknown as NodePgDatabase<Record<string, never>>;
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([posts]);
        service = new RealtimeService(db, registry);
        service.setDataDriver({ fetchCollection: mockFetchCollection, fetchOne: mockFetchEntity } as never);

        ws = { readyState: 1, send: jest.fn(), on: jest.fn() };
        service.addClient("c1", ws as never);
    });

    afterEach(async () => {
        await service.stopListening();
    });

    async function subscribe() {
        await service.handleClientMessage("c1", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "list" }
        });
        await service.handleClientMessage("c1", {
            type: "subscribe_one",
            payload: { path: "posts", id: "1", subscriptionId: "one" }
        });
        jest.advanceTimersByTime(350);
        await flush();
        ws.send.mockClear();
        mockFetchCollection.mockClear();
        mockFetchEntity.mockClear();
    }

    const framesFor = (subscriptionId: string) => ws.send.mock.calls
        .map(([frame]) => JSON.parse(frame as string) as { subscriptionId?: string; type: string })
        .filter(frame => frame.subscriptionId === subscriptionId);

    it("listens with TCP keepalive on, and says so in its health", async () => {
        await service.startListening("postgres://localhost/db");

        expect(clients).toHaveLength(1);
        expect(clients[0].options).toMatchObject({ keepAlive: true });
        expect(clients[0].query).toHaveBeenCalledWith("LISTEN rebase_entity_changes");
        expect(service.health()).toEqual([{ name: "cross-instance", connected: true }]);
    });

    it("replaces a connection that stops answering its heartbeat, reports it down meanwhile, and resyncs every subscription", async () => {
        await service.startListening("postgres://localhost/db");
        await subscribe();

        silent = true;
        jest.advanceTimersByTime(30_000);
        await flush();
        // Asked, and not answered yet: nothing given up on.
        expect(clients[0].end).not.toHaveBeenCalled();

        jest.advanceTimersByTime(10_000);
        await flush();

        expect(clients[0].end).toHaveBeenCalled();
        expect(service.health()).toEqual([{ name: "cross-instance", connected: false, downSince: expect.any(Number) }]);

        silent = false;
        jest.advanceTimersByTime(3_000);
        await flush();

        expect(clients).toHaveLength(2);
        expect(clients[1].query).toHaveBeenCalledWith("LISTEN rebase_entity_changes");
        expect(service.health()).toEqual([{ name: "cross-instance", connected: true }]);

        jest.advanceTimersByTime(350);
        await flush();

        expect(framesFor("list").map(f => f.type)).toEqual(["collection_update"]);
        expect(framesFor("one")).toHaveLength(1);
    });

    it("keeps dialling a database it cannot reach at boot, rather than giving up on cross-instance realtime", async () => {
        failingConnects = 2;
        await expect(service.startListening("postgres://localhost/db")).resolves.toBeUndefined();
        expect(service.health()).toEqual([{ name: "cross-instance", connected: false, downSince: expect.any(Number) }]);

        jest.advanceTimersByTime(3_000);
        await flush();
        expect(clients).toHaveLength(2);
        expect(service.health()[0]).toMatchObject({ connected: false });

        jest.advanceTimersByTime(3_000);
        await flush();
        expect(clients).toHaveLength(3);
        expect(clients[2].query).toHaveBeenCalledWith("LISTEN rebase_entity_changes");
        expect(service.health()).toEqual([{ name: "cross-instance", connected: true }]);
    });

    it("refetches nothing on a first connect that succeeds", async () => {
        await subscribe();
        await service.startListening("postgres://localhost/db");

        jest.advanceTimersByTime(350);
        await flush();

        expect(mockFetchCollection).not.toHaveBeenCalled();
        expect(ws.send).not.toHaveBeenCalled();
    });

    it("relays another instance's change to its subscribers and skips its own", async () => {
        await service.startListening("postgres://localhost/db");
        await subscribe();
        const notify = clients[0].handlers.notification;

        // Its own sid: already delivered locally when the write was made.
        const ownSid = Reflect.get(service, "instanceId") as string;
        notify?.({ payload: JSON.stringify({ sid: ownSid, p: "posts", eid: "1", db: null }) });
        jest.advanceTimersByTime(350);
        await flush();
        expect(ws.send).not.toHaveBeenCalled();

        notify?.({ payload: JSON.stringify({ sid: "inst_other", p: "posts", eid: "1", db: null }) });
        await flush();
        jest.advanceTimersByTime(350);
        await flush();

        expect(framesFor("list").map(f => f.type)).toEqual(["collection_update"]);
        expect(framesFor("one")).toHaveLength(1);
        expect(Reflect.get(service, "foreignInstanceSeen")).toBe(true);
    });

    it("lets go of the connection when it stops listening", async () => {
        await service.startListening("postgres://localhost/db");
        await service.stopListening();

        expect(clients[0].end).toHaveBeenCalled();
        expect(service.health()).toEqual([]);
        jest.advanceTimersByTime(60_000);
        await flush();
        expect(clients).toHaveLength(1);
        expect(clients[0].query).not.toHaveBeenCalledWith("SELECT 1");
    });
});
