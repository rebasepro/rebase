import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * Two realtime costs a deployment can now tune, each defaulting to what it was.
 *
 * - **How long a change may wait for its refetch.** A refetch waits for 300 ms
 *   without a change, and at most a fixed 1 s under a steady stream of writes.
 *   `REALTIME_REFETCH_MAX_WAIT_MS` moves that bound: up, to refetch a busy
 *   table less often; down, for fresher frames.
 * - **How often a big list is counted.** Every refetch of a list that does not
 *   fit on one page also counts it, inside the same transaction — on a table
 *   of millions that count is most of the frame's cost, and a hot table pays it
 *   per write per principal. `REALTIME_RECOUNT_INTERVAL_MS` lets a group whose
 *   last total was at least `REALTIME_RECOUNT_MIN_ROWS` reuse it for that long;
 *   such a frame says when the total was taken (`meta.totalAsOf`).
 */

const fetchCollectionForRest = jest.fn(async (..._args: unknown[]) => [{ id: 1, title: "Row" }]);
const count = jest.fn(async (..._args: unknown[]) => 1);
jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollectionForRest,
        fetchOneForRest: jest.fn(async () => ({ id: 1 })),
        count,
        cursorFor: jest.fn().mockReturnValue(undefined)
    }))
}));

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CollectionConfig, CollectionUpdateMeta } from "@rebasepro/types";
import { RealtimeService, parseRealtimeTuning, DEFAULT_RECOUNT_MIN_ROWS } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const posts = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { id: { type: "number", isId: true }, title: { type: "string" } }
} as unknown as CollectionConfig;

type Socket = { readyState: number; send: jest.Mock; on: jest.Mock; close: jest.Mock; terminate: jest.Mock };

let service: RealtimeService;
let ws: Socket;
let version: number;

async function flush() {
    for (let i = 0; i < 40; i++) await Promise.resolve();
}

const metas = () => ws.send.mock.calls
    .map(([frame]) => JSON.parse(frame as string) as { type: string; meta?: CollectionUpdateMeta })
    .filter((frame) => frame.type === "collection_update")
    .map((frame) => frame.meta!);

/** A write, and the refetch it starts. */
async function write(advanceMs = 350) {
    await service.notifyUpdate("posts", "1", { _rebase_invalidated: true });
    jest.advanceTimersByTime(advanceMs);
    await flush();
}

beforeEach(async () => {
    jest.useFakeTimers();
    version = 0;
    // Every read is news, and a full page, so the list is counted.
    fetchCollectionForRest.mockImplementation(async () => [{ id: 1, title: `Row ${++version}` }]);
    count.mockReset();
    const db = {
        execute: jest.fn(async () => ({ rows: [] })),
        transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(db))
    } as unknown as NodePgDatabase<Record<string, never>>;
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([posts]);
    service = new RealtimeService(db, registry);
    service.setDataDriver({ callContextWithin: () => ({}) } as never);
    ws = { readyState: 1, send: jest.fn(), on: jest.fn(), close: jest.fn(), terminate: jest.fn() };
    service.addClient("c", ws as never);
});

afterEach(async () => {
    await service.destroy();
    jest.useRealTimers();
});

async function subscribe() {
    await service.handleClientMessage("c", { type: "subscribe_collection", payload: { path: "posts", subscriptionId: "s", limit: 1 } }, { uid: "u", roles: ["editor"] });
    await flush();
}

describe("the refetch's longest wait", () => {
    /** Writes every 100 ms, never quiet for the 300 ms debounce; returns the times frames went out. */
    async function steadyWrites(forMs: number): Promise<number[]> {
        const sentAt: number[] = [];
        let seen = ws.send.mock.calls.length;
        for (let t = 100; t <= forMs; t += 100) {
            await service.notifyUpdate("posts", "1", { _rebase_invalidated: true });
            jest.advanceTimersByTime(100);
            await flush();
            if (ws.send.mock.calls.length > seen) {
                sentAt.push(t);
                seen = ws.send.mock.calls.length;
            }
        }
        return sentAt;
    }

    it("is a second by default, under a stream that never goes quiet", async () => {
        count.mockResolvedValue(10);
        await subscribe();
        expect(service.refetchMaxWaitMs).toBe(1000);
        const sentAt = await steadyWrites(3000);
        expect(sentAt).toEqual([1000, 2000, 3000]);
    });

    it("is what REALTIME_REFETCH_MAX_WAIT_MS says", async () => {
        count.mockResolvedValue(10);
        service.refetchMaxWaitMs = 2500;
        await subscribe();
        const sentAt = await steadyWrites(5000);
        expect(sentAt).toEqual([2500, 5000]);
    });
});

describe("recounting a big list", () => {
    it("counts with every frame by default", async () => {
        count.mockResolvedValue(5_000_000);
        await subscribe();
        count.mockClear();
        for (let i = 0; i < 3; i++) await write();
        expect(count).toHaveBeenCalledTimes(3);
        expect(metas().every((meta) => meta.totalAsOf === undefined)).toBe(true);
    });

    it("reuses a big group's total for the interval, and says when it was taken", async () => {
        service.recountIntervalMs = 10_000;
        count.mockResolvedValue(5_000_000);
        await subscribe();
        await write();
        count.mockClear();
        const before = metas().length;

        await write();
        await write();
        expect(count).not.toHaveBeenCalled();
        const reused = metas().slice(before);
        expect(reused.map((meta) => meta.total)).toEqual([5_000_000, 5_000_000]);
        expect(reused.every((meta) => typeof meta.totalAsOf === "string")).toBe(true);

        jest.advanceTimersByTime(10_000);
        await write();
        expect(count).toHaveBeenCalledTimes(1);
        expect(metas().at(-1)!.totalAsOf).toBeUndefined();
    });

    it("keeps counting a list smaller than REALTIME_RECOUNT_MIN_ROWS", async () => {
        service.recountIntervalMs = 10_000;
        expect(service.recountMinRows).toBe(DEFAULT_RECOUNT_MIN_ROWS);
        count.mockResolvedValue(DEFAULT_RECOUNT_MIN_ROWS - 1);
        await subscribe();
        await write();
        count.mockClear();
        await write();
        await write();
        expect(count).toHaveBeenCalledTimes(2);
    });

    it("a mistyped setting stops the boot instead of becoming the default", () => {
        expect(parseRealtimeTuning("2500", "REALTIME_REFETCH_MAX_WAIT_MS", "milliseconds")).toBe(2500);
        for (const bad of ["0", "-5", "1.5", "soon", 0]) {
            expect(() => parseRealtimeTuning(bad, "REALTIME_RECOUNT_INTERVAL_MS", "milliseconds"))
                .toThrow(/REALTIME_RECOUNT_INTERVAL_MS must be a positive whole number of milliseconds/);
        }
    });
});
