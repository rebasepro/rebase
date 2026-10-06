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
let transaction: jest.Mock;

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

function subscribeList(clientId: string, subscriptionId: string, auth?: SubscriptionAuthContext, filter?: Record<string, unknown>, page?: { limit: number }) {
    return service.handleClientMessage(clientId, {
        type: "subscribe_collection",
        payload: { path: "posts", subscriptionId, ...(filter ? { filter } : {}), ...page }
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
    transaction = (db as unknown as { transaction: jest.Mock }).transaction;
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
            // A full page, so there is something to count.
            for (let j = 0; j < 5; j++) await subscribeList(`c${i}`, `s${j}`, ALICE, undefined, { limit: 1 });
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

    it("costs the same per row however many principals watch the list", async () => {
        // Every changed row used to visit every list group on its path: a
        // 100k-row UPDATE on a list open as 1,000 principals was 100M visits,
        // ~3.9 s of event loop no socket or request on the instance got
        // past. The groups are visited once per burst now. Two sizes, the
        // same 10,000 changes: the time must not grow with the groups.
        jest.useRealTimers();
        const timeFor = async (principals: number) => {
            await service.destroy();
            service = new RealtimeService(service["db"], service["registry"]);
            service.setDataDriver({ callContextWithin: () => ({}) } as never);
            for (let i = 0; i < principals; i++) {
                connect(`c${i}`);
                await subscribeList(`c${i}`, "s", { uid: `user${i}`, roles: ["editor"] });
            }
            await flush();
            const started = performance.now();
            for (let i = 0; i < 10_000; i++) {
                await service.notifyUpdate("posts", String(i), { _rebase_invalidated: true }, undefined, false, "cdc");
            }
            await new Promise((resolve) => setImmediate(resolve));
            return performance.now() - started;
        };
        await timeFor(10);
        const few = Math.min(await timeFor(10), await timeFor(10));
        const many = Math.min(await timeFor(2000), await timeFor(2000));

        // Measured on a laptop: 2,000 groups took 44x as long as 10 before,
        // about as long now.
        expect(many / few).toBeLessThan(4);
    });
});

describe("a steady stream of writes", () => {
    it("still reaches the subscribers, at least once a second", async () => {
        // The refetch waits for 300 ms without a change. A collection written
        // more often than that — an orders or events table at a few writes a
        // second — never went quiet, so its subscribers got nothing for as
        // long as the writes went on (measured: 0 frames during a 3 s stream
        // of one write per 100 ms; the first one after the writes stopped).
        const ws = connect("a");
        await subscribeList("a", "s", ALICE);
        await flush();
        ws.send.mockClear();

        const start = Date.now();
        const deliveredAt: number[] = [];
        for (let i = 0; i < 30; i++) {
            await service.notifyUpdate("posts", String(i), { _rebase_invalidated: true });
            jest.advanceTimersByTime(100);
            await flush();
            const updates = frames(ws).filter(f => f.type === "collection_update").length;
            while (deliveredAt.length < updates) deliveredAt.push(Date.now() - start);
        }

        // 3 s of writes: a frame at least every ~1 s, from the first write on.
        expect(deliveredAt.length).toBeGreaterThanOrEqual(3);
        const gaps = deliveredAt.map((at, i) => at - (i === 0 ? 0 : deliveredAt[i - 1]));
        expect(Math.max(...gaps, 3000 - deliveredAt[deliveredAt.length - 1])).toBeLessThanOrEqual(1100);
    });
});

describe("one write to a list many different principals watch", () => {
    it("refetches a few groups at a time, so the fan-out cannot take the whole pool", async () => {
        // Every group armed by one change used to start its refetch in the
        // same tick: 200 principals on a list were 200 transactions queued on
        // the 20-connection pool every REST request shares (measured: an
        // unrelated `SELECT 1` waited 521 ms behind one write's fan-out).
        const users = Array.from({ length: 40 }, (_, i): SubscriptionAuthContext => ({ uid: `user${i}`, roles: ["editor"] }));
        const sockets = users.map((_, i) => connect(`c${i}`));
        for (let i = 0; i < users.length; i++) await subscribeList(`c${i}`, "s", users[i]);
        await flush();
        for (const ws of sockets) ws.send.mockClear();

        let inFlight = 0;
        let peak = 0;
        const held: Array<() => void> = [];
        fetchCollectionForRest.mockClear();
        fetchCollectionForRest.mockImplementation(async () => {
            peak = Math.max(peak, ++inFlight);
            await new Promise<void>((release) => held.push(release));
            inFlight--;
            return [{ id: 1, title: "Row" }];
        });
        try {
            await service.notifyUpdate("posts", "1", { _rebase_invalidated: true });
            jest.advanceTimersByTime(350);
            await flush();
            for (let round = 0; held.length > 0 && round < 100; round++) {
                for (const release of held.splice(0)) release();
                await flush();
            }
        } finally {
            fetchCollectionForRest.mockImplementation(async () => [{ id: 1, title: "Row" }]);
        }

        // A quarter of the default 20-connection pool, and every group still served.
        expect(peak).toBeLessThanOrEqual(5);
        expect(fetchCollectionForRest).toHaveBeenCalledTimes(40);
        for (const ws of sockets) expect(frames(ws).filter(f => f.type === "collection_update")).toHaveLength(1);
    });
});

describe("a list refetch for sockets", () => {
    const subscribePage = (clientId: string, subscriptionId: string, payload: Record<string, unknown>) =>
        service.handleClientMessage(clientId, { type: "subscribe_collection", payload: { path: "posts", subscriptionId, ...payload } }, ALICE);
    const lastMeta = (ws: Socket) => (frames(ws).filter(f => f.type === "collection_update").pop() as { meta?: Record<string, unknown> } | undefined)?.meta;

    it("reads its rows and counts them in one transaction, as one principal", async () => {
        // The count ran in a second transaction of its own: two pool
        // acquisitions and two rounds of BEGIN / set_config / COMMIT per group
        // per write (801 statements for one write with 100 principals).
        const ws = connect("a");
        await subscribePage("a", "s", { limit: 1 });
        await flush();
        expect(transaction).toHaveBeenCalledTimes(1);
        transaction.mockClear();
        count.mockClear();

        await service.notifyUpdate("posts", "1", { _rebase_invalidated: true });
        jest.advanceTimersByTime(350);
        await flush();

        expect(transaction).toHaveBeenCalledTimes(1);
        expect(count).toHaveBeenCalledTimes(1);
        expect(lastMeta(ws)).toMatchObject({ total: 1, limit: 1, offset: 0, hasMore: false });
    });

    it("does not count a first page that came back short: its length is the total", async () => {
        const ws = connect("a");
        await subscribePage("a", "s", { limit: 10 });
        await flush();
        expect(count).not.toHaveBeenCalled();
        expect(lastMeta(ws)).toEqual({ total: 1, limit: 10, offset: 0, hasMore: false });
    });

    it.each([
        ["a later page", { limit: 10, offset: 10 }],
        ["a search", { limit: 10, searchString: "row" }],
        ["a cursor page", { limit: 10, startAfter: { id: 0 } }]
    ])("still counts %s that came back short", async (_label, payload) => {
        connect("a");
        await subscribePage("a", "s", payload);
        await flush();
        expect(count).toHaveBeenCalledTimes(1);
    });

    it("reports a failed count as a partial frame, with its rows", async () => {
        const ws = connect("a");
        count.mockRejectedValueOnce(new Error("statement timeout"));
        await subscribePage("a", "s", { limit: 1 });
        await flush();
        expect(frames(ws).filter(f => f.type === "collection_update")).toHaveLength(1);
        expect(lastMeta(ws)).toEqual({ limit: 1, offset: 0, hasMore: false, partial: true });
    });
});
