/**
 * @jest-environment jsdom
 */
import { MAX_LIST_LIMIT, resolveClientListLimit } from "@rebasepro/types";
import type { Entity, FindParams, FindResponse } from "@rebasepro/types";
import { CollectionWindow, CollectionWindowState } from "../../src/hooks/data/collectionWindow";

/**
 * The paging behind every scrolled collection view. See the class's own
 * comment for why it exists; these pin the parts the views cannot see.
 */

type Row = { name: string };

function rowsOf(n: number, prefix = "r"): Entity<Row>[] {
    return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, path: "items", values: { name: `${prefix}${i}` } }));
}

/** A collection served the way the API serves it: by offset, under the ceiling. */
class FakeCollection {
    rows: Entity<Row>[];
    reads: { limit: number; offset: number }[] = [];
    push: ((response: FindResponse<Row>) => void) | undefined;
    liveError: ((error: Error) => void) | undefined;
    gate: Promise<void> | undefined;
    failWith: Error | undefined;

    constructor(rows: Entity<Row>[]) {
        this.rows = rows;
    }

    answer(params?: FindParams<Row>): FindResponse<Row> {
        const limit = resolveClientListLimit(params?.limit);
        const offset = params?.offset ?? 0;
        return {
            data: this.rows.slice(offset, offset + limit),
            meta: { total: this.rows.length, limit, offset, hasMore: offset + limit < this.rows.length }
        };
    }

    find = async (params?: FindParams<Row>): Promise<FindResponse<Row>> => {
        const limit = resolveClientListLimit(params?.limit);
        this.reads.push({ limit, offset: params?.offset ?? 0 });
        if (this.gate) await this.gate;
        if (this.failWith) throw this.failWith;
        return this.answer(params);
    };

    listen = (params: FindParams<Row> | undefined,
        onUpdate: (response: FindResponse<Row>) => void,
        onError?: (error: Error) => void) => {
        this.push = () => onUpdate(this.answer(params));
        this.liveError = (error) => onError?.(error);
        return () => {
            this.push = undefined;
        };
    };
}

function open(collection: FakeCollection, options: { pageSize?: number; target?: number; live?: boolean; fallbackToFind?: boolean; firstPaintTimeoutMs?: number } = {}) {
    const states: CollectionWindowState<Row>[] = [];
    const window = new CollectionWindow<Row>({
        accessor: options.live === false ? { find: collection.find } : collection,
        query: {},
        pageSize: options.pageSize ?? 10,
        target: options.target ?? options.pageSize ?? 10,
        fallbackToFind: options.fallbackToFind,
        firstPaintTimeoutMs: options.firstPaintTimeoutMs,
        onChange: (state) => states.push(state)
    });
    window.start();
    const last = () => states[states.length - 1];
    return { window, states, last };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

async function until(predicate: () => boolean) {
    for (let i = 0; i < 200 && !predicate(); i++) await settle();
    expect(predicate()).toBe(true);
}

describe("CollectionWindow", () => {

    it("reads a page past the first by offset, and only that page", async () => {
        const collection = new FakeCollection(rowsOf(25));
        const { window, last } = open(collection, { live: false });
        await until(() => last()?.rows?.length === 10);

        window.setTarget(20);
        await until(() => last()?.rows?.length === 20);

        expect(collection.reads).toEqual([{ limit: 10, offset: 0 }, { limit: 10, offset: 10 }]);
        expect(last().complete).toBe(false);

        window.setTarget(30);
        await until(() => last()?.complete === true);
        expect(last().rows!.map(r => r.id)).toEqual(collection.rows.map(r => r.id));
    });

    it("never asks for more than the API serves in one read", async () => {
        const collection = new FakeCollection(rowsOf(2_500));
        const { last } = open(collection, { live: false, target: Infinity, pageSize: 50 });
        await until(() => last()?.complete === true);

        expect(last().error).toBeUndefined();
        expect(last().rows).toHaveLength(2_500);
        expect(Math.max(...collection.reads.map(read => read.limit))).toBe(MAX_LIST_LIMIT);
    });

    it("holds a restored count back until it is all there, then shows it at once", async () => {
        const collection = new FakeCollection(rowsOf(300));
        const { states, last } = open(collection, { live: false, target: 120, pageSize: 50 });
        await until(() => last()?.rows !== undefined);

        // The first page alone would have thrown the restored scroll away.
        expect(states.filter(state => state.rows !== undefined)[0].rows).toHaveLength(120);
    });

    it("stops at a short page, and says so", async () => {
        const collection = new FakeCollection(rowsOf(15));
        const { window, last } = open(collection, { live: false });
        await until(() => last()?.rows?.length === 10);
        window.setTarget(20);
        await until(() => last()?.complete === true);
        expect(last().rows).toHaveLength(15);
    });

    it("a push re-reads every held row past the first page", async () => {
        const collection = new FakeCollection(rowsOf(40));
        const { window, last } = open(collection);
        collection.push!(collection.answer({ limit: 10 }));
        await until(() => last()?.rows?.length === 10);
        window.setTarget(30);
        await until(() => last()?.rows?.length === 30);

        collection.rows = collection.rows.map(row => row.id === "r25" ? { ...row, values: { name: "changed" } } : row);
        collection.reads = [];
        collection.push!(collection.answer({ limit: 10 }));

        await until(() => last()?.rows?.find(row => row.id === "r25")?.values.name === "changed");
        // The rows past the first page, read again as one span.
        expect(collection.reads).toEqual([{ limit: 20, offset: 10 }]);
        expect(last().rows).toHaveLength(30);
    });

    it("shows a row once while the first page and the rest disagree", async () => {
        const collection = new FakeCollection(rowsOf(30));
        const { window, last } = open(collection);
        collection.push!(collection.answer({ limit: 10 }));
        await until(() => last()?.rows?.length === 10);
        window.setTarget(20);
        await until(() => last()?.rows?.length === 20);

        // r0 is deleted: the first page now ends with r10, which the rest
        // still starts with until it is read again.
        let release!: () => void;
        collection.gate = new Promise(resolve => {
            release = resolve;
        });
        collection.rows = collection.rows.slice(1);
        collection.push!(collection.answer({ limit: 10 }));
        await settle();

        const ids = last().rows!.map(row => row.id);
        expect(new Set(ids).size).toBe(ids.length);

        release();
        collection.gate = undefined;
        await until(() => last()?.rows?.[19]?.id === "r20");
    });

    it("folds pushes that arrive during a re-read into one more", async () => {
        const collection = new FakeCollection(rowsOf(40));
        const { window, last } = open(collection);
        collection.push!(collection.answer({ limit: 10 }));
        await until(() => last()?.rows?.length === 10);
        window.setTarget(30);
        await until(() => last()?.rows?.length === 30);

        let release!: () => void;
        collection.gate = new Promise(resolve => {
            release = resolve;
        });
        collection.reads = [];
        // One push starts a re-read; four more land while it is in flight.
        collection.push!(collection.answer({ limit: 10 }));
        await until(() => collection.reads.length === 1);
        for (let i = 0; i < 4; i++) {
            collection.push!(collection.answer({ limit: 10 }));
            await settle();
        }
        collection.gate = undefined;
        release();
        await until(() => collection.reads.length === 2);
        for (let i = 0; i < 10; i++) await settle();
        expect(collection.reads).toHaveLength(2);
    });

    it("drops the rows past a smaller target", async () => {
        const collection = new FakeCollection(rowsOf(40));
        const { window, last } = open(collection, { live: false });
        await until(() => last()?.rows?.length === 10);
        window.setTarget(30);
        await until(() => last()?.rows?.length === 30);
        window.setTarget(10);
        await until(() => last()?.rows?.length === 10);
        expect(last().complete).toBe(false);
    });

    it("reports a page that fails, keeps the rows it has, and retries when asked for more", async () => {
        const collection = new FakeCollection(rowsOf(40));
        const { window, last } = open(collection, { live: false });
        await until(() => last()?.rows?.length === 10);

        collection.failWith = new Error("network down");
        window.setTarget(20);
        await until(() => last()?.error?.message === "network down");
        expect(last().rows).toHaveLength(10);
        expect(last().loading).toBe(false);

        collection.failWith = undefined;
        window.setTarget(30);
        await until(() => last()?.rows?.length === 30);
        expect(last().error).toBeUndefined();
    });

    it("can read the first page once when the subscription fails", async () => {
        const collection = new FakeCollection(rowsOf(5));
        const { last } = open(collection, { fallbackToFind: true });
        collection.liveError!(new Error("socket refused"));
        await until(() => last()?.rows?.length === 5);
        expect(last().error).toBeUndefined();
    });

    it("reports the subscription's failure when it may not fall back", async () => {
        const collection = new FakeCollection(rowsOf(5));
        const { last } = open(collection);
        collection.liveError!(new Error("socket refused"));
        await until(() => last()?.error?.message === "socket refused");
        expect(last().loading).toBe(false);
    });

    it("reads the first page once when the subscription is slow to answer, and the subscription still wins", async () => {
        jest.useFakeTimers();
        try {
            const collection = new FakeCollection(rowsOf(5));
            const { last } = open(collection, { firstPaintTimeoutMs: 100 });
            jest.advanceTimersByTime(150);
            jest.useRealTimers();
            await until(() => last()?.rows?.length === 5);

            collection.rows = rowsOf(3, "live");
            collection.push!(collection.answer({ limit: 10 }));
            await until(() => last()?.rows?.[0]?.id === "live0");
        } finally {
            jest.useRealTimers();
        }
    });

    it("says nothing after it is disposed", async () => {
        const collection = new FakeCollection(rowsOf(5));
        const { window, states } = open(collection, { live: false });
        window.dispose();
        await settle();
        await settle();
        expect(states).toHaveLength(0);
    });
});
