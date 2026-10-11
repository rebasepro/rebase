/**
 * @jest-environment jsdom
 */
import { resolveClientListLimit } from "@rebasepro/types";
import type { Entity, FindParams, FindResponse } from "@rebasepro/types";
import { CollectionWindow, CollectionWindowState } from "../../src/hooks/data/collectionWindow";

/**
 * A view that says which rows it draws has only those — and a page either
 * side — read again when a push says the collection changed. Every push used
 * to re-read every row held past the first page: a table scrolled to 10,000
 * rows ran ten 1,000-row reads per write to the collection.
 *
 * Offsets shift under inserts and deletes, so the rows on screen are checked
 * against the collection itself after each change: the right rows, current,
 * each once.
 */

type Row = { name: string; rank: number };

function rowsOf(n: number, prefix = "r"): Entity<Row>[] {
    return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, path: "items", values: { name: `${prefix}${i}`, rank: i } }));
}

class FakeCollection {
    rows: Entity<Row>[];
    reads: { limit: number; offset: number }[] = [];
    push: (() => void) | undefined;

    constructor(rows: Entity<Row>[]) {
        this.rows = rows;
    }

    answer(params?: FindParams<Row>): FindResponse<Row> {
        const limit = resolveClientListLimit(params?.limit);
        const offset = params?.offset ?? 0;
        // A fresh object per row per read, as the wire delivers them.
        const data = this.rows.slice(offset, offset + limit).map(row => ({ ...row, values: { ...row.values } }));
        return { data, meta: { total: this.rows.length, limit, offset, hasMore: offset + limit < this.rows.length } };
    }

    find = async (params?: FindParams<Row>): Promise<FindResponse<Row>> => {
        this.reads.push({ limit: resolveClientListLimit(params?.limit), offset: params?.offset ?? 0 });
        return this.answer(params);
    };

    listen = (params: FindParams<Row> | undefined, onUpdate: (response: FindResponse<Row>) => void) => {
        this.push = () => onUpdate(this.answer(params));
        return () => {
            this.push = undefined;
        };
    };

    readRows(): number {
        return this.reads.reduce((sum, read) => sum + read.limit, 0);
    }
}

const flush = async () => {
    for (let i = 0; i < 100; i++) await Promise.resolve();
};

async function scrolledTo(collection: FakeCollection, held: number, options: { pageSize?: number; seed?: { offset: number; rows: Entity<Row>[] } } = {}) {
    const states: CollectionWindowState<Row>[] = [];
    const pageSize = options.pageSize ?? 50;
    const window = new CollectionWindow<Row>({
        accessor: collection,
        query: {},
        pageSize,
        target: held,
        rereadIntervalMs: 0,
        seed: options.seed,
        onChange: (state) => states.push(state)
    });
    window.start();
    collection.push!();
    await flush();
    return { window, states, last: () => states[states.length - 1] };
}

/** Positions `[start, end)` of what the window shows, as row ids. */
function shown(state: CollectionWindowState<Row>, start: number, end: number): (string | undefined)[] {
    const rows = state.sparse ?? state.rows!;
    return rows.slice(start, end).map(row => row ? String(row.id) : undefined);
}

/** Every row changes with the write, so a copy read before it is told apart. */
function touchAll(collection: FakeCollection) {
    collection.rows = collection.rows.map(row => ({ ...row, values: { ...row.values, name: `${row.values.name}!` } }));
}

/** The rows the block starting at `id` shows, `length` of them: ids and current. */
function expectBlock(state: CollectionWindowState<Row>, collection: FakeCollection, from: number, length: number) {
    const rows = state.rows!;
    const at = rows.findIndex(row => row.id === collection.rows[from].id);
    const block = rows.slice(at, at + length);
    expect(block.map(row => String(row.id))).toEqual(collection.rows.slice(from, from + length).map(row => String(row.id)));
    expect(block.map(row => row.values.name)).toEqual(collection.rows.slice(from, from + length).map(row => row.values.name));
}

function expectNoDuplicates(state: CollectionWindowState<Row>) {
    const ids = state.rows!.map(row => String(row.id));
    expect(new Set(ids).size).toBe(ids.length);
}

describe("CollectionWindow — a view's range", () => {

    it("re-reads the rows on screen and a page either side per push, however far it is scrolled", async () => {
        for (const held of [1_000, 10_000]) {
            const collection = new FakeCollection(rowsOf(held + 500));
            const { window, last } = await scrolledTo(collection, held);
            expect(last().rows).toHaveLength(held);
            window.setVisibleRange({ start: held - 300, end: held - 280 });
            await flush();

            collection.reads = [];
            collection.rows[held - 290] = { ...collection.rows[held - 290], values: { name: "edited", rank: held - 290 } };
            collection.push!();
            await flush();

            // One read of the 20 rows on screen and 50 either side.
            expect(collection.reads).toEqual([{ limit: 120, offset: held - 350 }]);
            expect(last().rows![held - 290].values.name).toBe("edited");
        }
    });

    it("an insert at the top, scrolled deep: the rows on screen are the rows now at those offsets, each once", async () => {
        const collection = new FakeCollection(rowsOf(2_000));
        const { window, last } = await scrolledTo(collection, 1_000);
        window.setVisibleRange({ start: 500, end: 520 });
        await flush();

        touchAll(collection);
        collection.rows = [{ id: "new", path: "items", values: { name: "new", rank: -1 } }, ...collection.rows];
        collection.push!();
        await flush();

        expectNoDuplicates(last());
        // The block read again is the collection as it is now, in order.
        expectBlock(last(), collection, 450, 120);
        expect(last().rows![0].id).toBe("new");
    });

    it("a delete inside the range: the row is gone from the screen, and its neighbours close up", async () => {
        const collection = new FakeCollection(rowsOf(2_000));
        const { window, last } = await scrolledTo(collection, 1_000);
        window.setVisibleRange({ start: 500, end: 520 });
        await flush();

        touchAll(collection);
        collection.rows = collection.rows.filter(row => row.id !== "r510");
        collection.push!();
        await flush();

        expectNoDuplicates(last());
        expect(last().rows!.map(row => String(row.id))).not.toContain("r510");
        expectBlock(last(), collection, 450, 120);
    });

    it("a sort key that moves a row out of the range: it leaves the screen, and is never shown twice", async () => {
        const collection = new FakeCollection(rowsOf(2_000));
        const { window, last } = await scrolledTo(collection, 1_000);
        window.setVisibleRange({ start: 500, end: 520 });
        await flush();

        // r505 now sorts after r900.
        touchAll(collection);
        const moved = { ...collection.rows[505], values: { name: "moved", rank: 900.5 } };
        collection.rows = collection.rows.filter(row => row.id !== "r505");
        collection.rows.splice(900, 0, moved);
        collection.push!();
        await flush();

        expectNoDuplicates(last());
        expectBlock(last(), collection, 450, 120);
        expect(last().rows!.filter(row => row.id === "r505").length).toBeLessThanOrEqual(1);
    });

    it("rows outside the range stay stale until the view scrolls near them, then are read before they are on screen", async () => {
        const collection = new FakeCollection(rowsOf(2_000));
        const { window, last } = await scrolledTo(collection, 1_000);
        window.setVisibleRange({ start: 500, end: 520 });
        await flush();

        collection.rows = collection.rows.map(row => ({ ...row, values: { ...row.values, name: `${row.values.name}!` } }));
        collection.push!();
        await flush();
        expect(last().rows![800].values.name).toBe("r800");

        collection.reads = [];
        // Scrolled to within half a page of row 800: read ahead of the screen.
        window.setVisibleRange({ start: 760, end: 780 });
        await flush();
        expect(collection.reads).toHaveLength(1);
        expect(last().rows![800].values.name).toBe("r800!");
        expect(shown(last(), 760, 780)).toEqual(collection.rows.slice(760, 780).map(row => String(row.id)));

        // Scrolling on through rows already read reads nothing.
        collection.reads = [];
        window.setVisibleRange({ start: 765, end: 785 });
        await flush();
        expect(collection.reads).toHaveLength(0);
    });

    it("with no view reporting a range, a push still re-reads every held row", async () => {
        const collection = new FakeCollection(rowsOf(3_000));
        await scrolledTo(collection, 2_500);
        collection.reads = [];
        collection.push!();
        await flush();
        expect(collection.readRows()).toBe(2_450);

        // A view that reported a range and went away hands it back.
        const other = new FakeCollection(rowsOf(3_000));
        const { window } = await scrolledTo(other, 2_500);
        window.setVisibleRange({ start: 100, end: 120 });
        window.setVisibleRange(undefined);
        await flush();
        other.reads = [];
        other.push!();
        await flush();
        expect(other.readRows()).toBe(2_450);
    });
});

describe("CollectionWindow — a restored scroll position", () => {

    const band = (collection: FakeCollection, from: number, to: number) => collection.rows.slice(from, to);

    it("shows the rows kept for it at once, reads only those, and leaves the rows above it as gaps", async () => {
        const collection = new FakeCollection(rowsOf(20_000));
        const states: CollectionWindowState<Row>[] = [];
        const window = new CollectionWindow<Row>({
            accessor: collection,
            query: {},
            pageSize: 50,
            target: 10_000,
            seed: { offset: 9_850, rows: band(collection, 9_850, 10_000) },
            onChange: (state) => states.push(state)
        });
        // The view draws the kept rows before anything is read.
        window.setVisibleRange({ start: 9_900, end: 9_920 });
        window.start();
        collection.push!();
        await flush();

        const last = states[states.length - 1];
        expect(collection.reads).toEqual([{ limit: 120, offset: 9_850 }]);
        expect(last.sparse).toHaveLength(10_000);
        expect(last.sparse![60]).toBeUndefined();
        expect(shown(last, 9_900, 9_920)).toEqual(collection.rows.slice(9_900, 9_920).map(row => String(row.id)));
        expect(last.rows).toHaveLength(50 + 150);

        // Scrolling up to a gap reads it.
        collection.reads = [];
        window.setVisibleRange({ start: 5_000, end: 5_020 });
        await flush();
        expect(collection.reads).toEqual([{ limit: 120, offset: 4_950 }]);
        expect(shown(states[states.length - 1], 5_000, 5_020)).toEqual(collection.rows.slice(5_000, 5_020).map(row => String(row.id)));
    });

    it("a window no view reports a range to reads its gaps before it shows anything", async () => {
        const collection = new FakeCollection(rowsOf(3_000));
        const states: CollectionWindowState<Row>[] = [];
        const window = new CollectionWindow<Row>({
            accessor: collection,
            query: {},
            pageSize: 50,
            target: 2_000,
            seed: { offset: 1_900, rows: band(collection, 1_900, 2_000) },
            onChange: (state) => states.push(state)
        });
        window.start();
        collection.push!();
        await flush();

        const shownAny = states.filter(state => state.rows !== undefined);
        expect(shownAny[0].sparse).toBeUndefined();
        expect(shownAny[0].rows!.map(row => String(row.id))).toEqual(collection.rows.slice(0, 2_000).map(row => String(row.id)));
    });
});
