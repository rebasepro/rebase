import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * What one write costs the subscribers of the rows it changed.
 *
 * Every frame is a refetch under its subscriber's own scope, and it used to be
 * one refetch — plus one `count(*)` — per subscription. A thousand viewers of
 * one list made each write two thousand transactions on the pool every REST
 * request shares (measured: 2002 pool acquisitions for one INSERT). Viewers
 * asking the identical question as the identical principal are answered by
 * one read now; a different principal is a different read, so a frame is
 * still never built from rows its reader may not see.
 *
 * Also here, because they live in the same registry: a subscription id is the
 * socket's own, not a name shared by every socket on the server; a socket may
 * hold only so many subscriptions; and a change finds its subscribers through
 * an index rather than by walking every subscription once per changed row.
 */

const fetchCollectionForRest = jest.fn(async (..._args: unknown[]) => [{ id: 1, title: "Row" }]);
const fetchOneForRest = jest.fn(async (..._args: unknown[]) => ({ id: 1, title: "Row" }));
const count = jest.fn(async (..._args: unknown[]) => 1);
jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollectionForRest,
        fetchOneForRest,
        count,
        cursorFor: jest.fn().mockReturnValue(undefined)
    }))
}));

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CollectionConfig } from "@rebasepro/types";
import { RealtimeService, parseMaxSubscriptionsPerSocket, DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET, type SubscriptionAuthContext } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const posts = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { id: { type: "number", isId: true }, title: { type: "string" } }
} as unknown as CollectionConfig;

const ALICE: SubscriptionAuthContext = { uid: "alice", roles: ["editor"] };
const BOB: SubscriptionAuthContext = { uid: "bob", roles: ["editor"] };

type Socket = { readyState: number; send: jest.Mock; on: jest.Mock; close: jest.Mock; terminate: jest.Mock };

let service: RealtimeService;
let statements: string[];

async function flush() {
    for (let i = 0; i < 40; i++) await Promise.resolve();
}

function connect(clientId: string): Socket {
    const ws: Socket = { readyState: 1, send: jest.fn(), on: jest.fn(), close: jest.fn(), terminate: jest.fn() };
    service.addClient(clientId, ws as never);
    return ws;
}

const frames = (ws: Socket) => ws.send.mock.calls.map(([frame]) => JSON.parse(frame as string) as {
    type: string; subscriptionId?: string; rows?: unknown[]; row?: unknown; payload?: { error?: { code?: string } };
});

function subscribeList(clientId: string, subscriptionId: string, auth?: SubscriptionAuthContext, filter?: Record<string, unknown>) {
    return service.handleClientMessage(clientId, {
        type: "subscribe_collection",
        payload: { path: "posts", subscriptionId, ...(filter ? { filter } : {}) }
    }, auth);
}

/** The uids the transactions since `from` were scoped to, read off their `set_config`. */
const uidsSince = (from: number) => [...new Set(statements.slice(from).flatMap(s => [...s.matchAll(/\b(alice|bob)\b/g)].map(m => m[1])))];

beforeEach(() => {
    jest.useFakeTimers();
    statements = [];
    const db = {
        execute: jest.fn(async (statement: unknown) => {
            statements.push(JSON.stringify(statement));
            return { rows: [] };
        }),
        transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(db))
    } as unknown as NodePgDatabase<Record<string, never>>;
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([posts]);
    service = new RealtimeService(db, registry);
    service.setDataDriver({ callContextWithin: () => ({}) } as never);
    fetchCollectionForRest.mockClear();
    fetchOneForRest.mockClear();
    count.mockClear();
});

afterEach(async () => {
    await service.destroy();
    jest.useRealTimers();
});

describe("one write, many identical subscribers", () => {
    it("is one read and one count for all of them, and every one of them gets the frame", async () => {
        const sockets = Array.from({ length: 10 }, (_, i) => connect(`c${i}`));
        for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 5; j++) await subscribeList(`c${i}`, `s${j}`, ALICE);
        }
        await flush();
        fetchCollectionForRest.mockClear();
        count.mockClear();
        for (const ws of sockets) ws.send.mockClear();

        await service.notifyUpdate("posts", "1", { _rebase_invalidated: true });
        jest.advanceTimersByTime(350);
        await flush();

        expect(fetchCollectionForRest).toHaveBeenCalledTimes(1);
        expect(count).toHaveBeenCalledTimes(1);
        for (const ws of sockets) {
            expect(frames(ws).filter(f => f.type === "collection_update").map(f => f.subscriptionId).sort())
                .toEqual(["s0", "s1", "s2", "s3", "s4"]);
        }
    });

    it("is a read per principal, each scoped as its own", async () => {
        connect("a");
        connect("b");
        await subscribeList("a", "s", ALICE);
        await subscribeList("b", "s", BOB);
        await flush();
        fetchCollectionForRest.mockClear();
        const before = statements.length;

        await service.notifyUpdate("posts", "1", { _rebase_invalidated: true });
        jest.advanceTimersByTime(350);
        await flush();

        expect(fetchCollectionForRest).toHaveBeenCalledTimes(2);
        expect(uidsSince(before).sort()).toEqual(["alice", "bob"]);
    });

    it("is a read per question", async () => {
        connect("a");
        await subscribeList("a", "drafts", ALICE, { status: ["==", "draft"] });
        await subscribeList("a", "published", ALICE, { status: ["==", "published"] });
        await flush();
        fetchCollectionForRest.mockClear();

        await service.notifyUpdate("posts", "1", { _rebase_invalidated: true });
        jest.advanceTimersByTime(350);
        await flush();

        expect(fetchCollectionForRest).toHaveBeenCalledTimes(2);
    });

    it("reads a row once for every subscriber of it", async () => {
        const sockets = Array.from({ length: 5 }, (_, i) => connect(`c${i}`));
        for (let i = 0; i < 5; i++) {
            await service.handleClientMessage(`c${i}`, { type: "subscribe_one", payload: { path: "posts", id: 1, subscriptionId: "one" } }, ALICE);
        }
        await flush();
        fetchOneForRest.mockClear();
        for (const ws of sockets) ws.send.mockClear();

        // A numeric id on the subscription and the string a write reports are
        // one row.
        await service.notifyUpdate("posts", "1", { _rebase_invalidated: true });
        jest.advanceTimersByTime(350);
        await flush();

        expect(fetchOneForRest).toHaveBeenCalledTimes(1);
        for (const ws of sockets) expect(frames(ws).filter(f => f.type === "single_update")).toHaveLength(1);
    });
});

describe("a subscription id", () => {
    it("is the socket's own: two sockets that both say \"sub-1\" both keep theirs", async () => {
        const a = connect("a");
        const b = connect("b");
        await subscribeList("a", "sub-1", ALICE);
        await subscribeList("b", "sub-1", ALICE);
        await flush();
        a.send.mockClear();
        b.send.mockClear();

        await service.notifyUpdate("posts", "1", { _rebase_invalidated: true });
        jest.advanceTimersByTime(350);
        await flush();

        expect(frames(a).filter(f => f.type === "collection_update")).toHaveLength(1);
        expect(frames(b).filter(f => f.type === "collection_update")).toHaveLength(1);
    });

    it("is ended only by the socket that holds it", async () => {
        const a = connect("a");
        connect("b");
        await subscribeList("a", "sub-1", ALICE);
        await flush();
        a.send.mockClear();

        await service.handleClientMessage("b", { type: "unsubscribe", subscriptionId: "sub-1" });
        await service.notifyUpdate("posts", "1", { _rebase_invalidated: true });
        jest.advanceTimersByTime(350);
        await flush();

        expect(frames(a).filter(f => f.type === "collection_update")).toHaveLength(1);
    });
});

describe("the subscriptions one socket may hold", () => {
    it("stop at the ceiling, refused by name", async () => {
        service.maxSubscriptionsPerSocket = 3;
        const ws = connect("a");
        for (const id of ["s1", "s2", "s3", "s4"]) await subscribeList("a", id, ALICE);
        await flush();

        const refused = frames(ws).filter(f => f.type === "error");
        expect(refused).toHaveLength(1);
        expect(refused[0]).toMatchObject({ subscriptionId: "s4", payload: { error: { code: "TOO_MANY_SUBSCRIPTIONS" } } });
        expect(frames(ws).filter(f => f.type === "collection_update").map(f => f.subscriptionId).sort()).toEqual(["s1", "s2", "s3"]);
    });

    it("count a re-subscribe under a held id as the same one, and free a slot on unsubscribe", async () => {
        service.maxSubscriptionsPerSocket = 2;
        const ws = connect("a");
        await subscribeList("a", "s1", ALICE);
        await subscribeList("a", "s2", ALICE);
        await subscribeList("a", "s2", ALICE, { status: ["==", "draft"] });
        await service.handleClientMessage("a", { type: "unsubscribe", subscriptionId: "s1" });
        await subscribeList("a", "s3", ALICE);
        await flush();

        expect(frames(ws).filter(f => f.type === "error")).toHaveLength(0);
    });

    it("are counted per socket", async () => {
        service.maxSubscriptionsPerSocket = 1;
        const a = connect("a");
        const b = connect("b");
        await subscribeList("a", "s1", ALICE);
        await subscribeList("b", "s1", ALICE);
        await flush();

        expect([...frames(a), ...frames(b)].filter(f => f.type === "error")).toHaveLength(0);
    });
});

describe("the ceiling's setting", () => {
    it("defaults to a thousand", () => {
        expect(DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET).toBe(1000);
        expect(service.maxSubscriptionsPerSocket).toBe(1000);
    });

    it("takes a positive whole number, from config or from the environment's string", () => {
        expect(parseMaxSubscriptionsPerSocket(250, "realtime.maxSubscriptionsPerSocket")).toBe(250);
        expect(parseMaxSubscriptionsPerSocket(" 5000 ", "REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET")).toBe(5000);
    });

    it.each([0, -1, 1.5, "abc", "10k", "", NaN, null])("refuses %j at boot, naming the setting", (value) => {
        expect(() => parseMaxSubscriptionsPerSocket(value, "REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET"))
            .toThrow(/REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET must be a positive whole number/);
    });
});

describe("a statement that changes many rows", () => {
    it("finds its subscribers without walking every subscription per row", async () => {
        // 1000 list subscriptions (20 distinct questions) and 1000 row
        // subscriptions, then 10,000 changes — a 10k-row UPDATE under change
        // capture. Walking every subscription per change, re-resolving every
        // nested path per change and re-arming a timer per subscription per
        // change cost ~780 ms of event loop with 200 subscriptions. Real
        // clocks: fake timers fake every clock there is to measure with.
        jest.useRealTimers();
        for (let i = 0; i < 10; i++) connect(`c${i}`);
        for (let i = 0; i < 1000; i++) {
            await subscribeList(`c${i % 10}`, `list-${i}`, ALICE, { bucket: ["==", i % 20] });
            await service.handleClientMessage(`c${i % 10}`, { type: "subscribe_one", payload: { path: "posts", id: String(i), subscriptionId: `row-${i}` } }, ALICE);
        }
        await flush();

        const started = performance.now();
        for (let i = 0; i < 10_000; i++) {
            await service.notifyUpdate("posts", String(i), { _rebase_invalidated: true }, undefined, false, "cdc");
        }
        const elapsed = performance.now() - started;

        // Measured on a laptop: ~190 ms now, ~14,800 ms before. The ceiling
        // is loose for a slow runner and still an order of magnitude under
        // the walk it replaced.
        expect(elapsed).toBeLessThan(1500);
    });
});
