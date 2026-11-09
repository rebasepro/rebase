import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * A LISTEN connection that comes back after a drop resyncs its subscribers.
 *
 * Postgres keeps no NOTIFY for a session that is not listening. When the CDC
 * listener's backend went away — a failover, an idle reaper, a proxy restart,
 * `pg_terminate_backend` — it reconnected three seconds later, and every change
 * committed in between (by another instance, psql, a cron) had been notified to
 * nobody. Nothing told the subscriptions, so each view kept its pre-gap rows
 * until some later change to the same collection happened to arrive — for
 * good, if none did. The legacy cross-instance broadcast had the same gap.
 *
 * Now the listener says when it is back, and every live subscription is
 * refetched under its own scope.
 */

type FakeClient = {
    connect: jest.Mock;
    query: jest.Mock;
    end: jest.Mock;
    on: jest.Mock;
    handlers: Record<string, (arg?: unknown) => void>;
};
const clients: FakeClient[] = [];

// Only the listener's `Client` is stood in for; the rest of pg — the `Pool`
// the realtime service's database sits on — is the real thing.
jest.mock("pg", () => ({
    ...jest.requireActual<typeof import("pg")>("pg"),
    Client: jest.fn().mockImplementation(() => {
        const client: FakeClient = {
            connect: jest.fn(async () => undefined),
            query: jest.fn(async () => ({})),
            end: jest.fn(async () => undefined),
            on: jest.fn(),
            handlers: {}
        };
        client.on.mockImplementation((event: unknown, handler: unknown) => {
            if (typeof event === "string" && typeof handler === "function") client.handlers[event] = (arg?: unknown) => handler(arg);
        });
        clients.push(client);
        return client;
    })
}));

// Each read is news: a refetch that reads what its subscriber was last sent sends nothing.
let mockReads = 0;
const mockFetchCollection = jest.fn(async () => [{ id: 1, title: "Closed", read: ++mockReads }]);
const mockFetchEntity = jest.fn(async () => ({ id: 1, title: "Closed", read: ++mockReads }));
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

import { WebSocket } from "ws";
import type { CollectionConfig } from "@rebasepro/types";
import { PgNotifyListener } from "../src/services/pg-notify-listener";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { recordingDb } from "./helpers/spg-b-recording-db";

const posts: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number", isId: true },
        title: { type: "string" }
    }
};

/** A drain for the async reconnect and the refetch it schedules. */
async function flush() {
    for (let i = 0; i < 40; i++) await Promise.resolve();
}

/** Drop the listener's current connection the way the server does. */
function dropConnection(client: FakeClient) {
    client.handlers.end?.();
}

beforeEach(() => {
    clients.length = 0;
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
});

describe("PgNotifyListener", () => {
    it("reports a reconnect once the connection is listening again, and not the first connect", async () => {
        const onReconnect = jest.fn();
        const listener = new PgNotifyListener({
            connectionString: "postgres://localhost/db",
            channel: "rebase_test",
            onPayload: () => undefined,
            logLabel: "[TEST]",
            reconnectDelayMs: 1_000,
            onReconnect
        });

        await listener.start();
        expect(onReconnect).not.toHaveBeenCalled();

        dropConnection(clients[0]);
        jest.advanceTimersByTime(1_000);
        await flush();

        expect(clients).toHaveLength(2);
        expect(clients[1].query).toHaveBeenCalledWith("LISTEN rebase_test");
        expect(onReconnect).toHaveBeenCalledTimes(1);

        await listener.stop();
    });
});

describe("RealtimeService after its LISTEN connection comes back", () => {
    let service: RealtimeService;
    let ws: { readyState: number; send: jest.Mock; on: jest.Mock };

    beforeEach(async () => {
        // On a real pg client, not the listener's stand-in above, so the listener's clients are the only ones counted.
        const { db } = recordingDb(() => [], { Client: jest.requireActual<typeof import("pg")>("pg").Client });
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([posts]);
        service = new RealtimeService(db, registry);
        const driver = new PostgresBackendDriver(db, service, registry);
        jest.spyOn(driver, "fetchCollection").mockImplementation(mockFetchCollection);
        jest.spyOn(driver, "fetchOne").mockImplementation(mockFetchEntity);
        service.setDataDriver(driver);

        ws = { readyState: WebSocket.OPEN, send: jest.fn(), on: jest.fn() };
        // A server-side `ws` socket comes only out of WebSocketServer's upgrade:
        // `new WebSocket(null)`, the constructor @types/ws declares for one,
        // throws at runtime without the options it does not declare.
        service.addClient("c1", ws as unknown as WebSocket);
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
        await flush();
        ws.send.mockClear();
        mockFetchCollection.mockClear();
        mockFetchEntity.mockClear();
    }

    const framesFor = (subscriptionId: string) => ws.send.mock.calls
        .map(([frame]): unknown => JSON.parse(String(frame)))
        .filter((frame): frame is { subscriptionId: string; type: string } =>
            frame !== null && typeof frame === "object" && "subscriptionId" in frame && frame.subscriptionId === subscriptionId);

    it("refetches every subscription after the CDC listener reconnects", async () => {
        await service.enableCdc("postgres://localhost/db");
        await subscribe();

        dropConnection(clients[0]);
        jest.advanceTimersByTime(3_000);
        await flush();
        expect(clients).toHaveLength(2);

        jest.advanceTimersByTime(350);
        await flush();

        expect(mockFetchCollection).toHaveBeenCalled();
        expect(mockFetchEntity).toHaveBeenCalled();
        expect(framesFor("list").map(f => f.type)).toEqual(["collection_update"]);
        expect(framesFor("one")).toHaveLength(1);

        await service.stopCdc();
    });

    it("refetches every subscription after the cross-instance listener reconnects", async () => {
        await service.startListening("postgres://localhost/db");
        await subscribe();

        dropConnection(clients[0]);
        jest.advanceTimersByTime(3_000);
        await flush();
        expect(clients).toHaveLength(2);

        jest.advanceTimersByTime(350);
        await flush();

        expect(framesFor("list").map(f => f.type)).toEqual(["collection_update"]);
        expect(framesFor("one")).toHaveLength(1);

        await service.stopListening();
    });

    it("refetches nothing on the first connect", async () => {
        await subscribe();
        await service.enableCdc("postgres://localhost/db");

        jest.advanceTimersByTime(350);
        await flush();

        expect(mockFetchCollection).not.toHaveBeenCalled();
        expect(ws.send).not.toHaveBeenCalled();

        await service.stopCdc();
    });
});
