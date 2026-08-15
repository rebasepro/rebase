/**
 * E2E: the offline query evaluator returns what the server would have.
 *
 * `isExactlyEvaluable` is a promise. It tells the SDK that a cached answer to
 * this query is not an approximation — that filtering the local rows gives
 * *exactly* the rows the server would have sent. Everything the offline layer
 * does with a cache hit rests on it, and today it returns true for any query
 * without `include` or `searchString`, which is nearly all of them.
 *
 * Nothing checks it. The client-side operators are hand-written JavaScript, the
 * server's are Drizzle conditions compiled to SQL, and the two have never been
 * compared against each other on the same data. The places they can part are
 * the usual ones and none of them announce themselves: NULL, type coercion of a
 * wire value that is always a string, `LIKE` pattern semantics, and the order
 * NULLs sort in.
 *
 * So: one table, one set of rows, every operator on every column, evaluated
 * both ways and compared by row id. The local input is the *unfiltered server
 * result*, which is exactly the cache the SDK would be holding.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar, integer, boolean } from "drizzle-orm/pg-core";
import type { CollectionConfig, FilterValues, WhereFilterOp } from "@rebasepro/types";
// Not on the client's public surface — imported from source, like the
// evaluator it is checking.
import { runLocalQuery, isExactlyEvaluable, isLocallySortable } from "../../../client/src/offline-query.js";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

let container: PgContainer;
let pool: pg.Pool;
let driver: PostgresBackendDriver;
let allRows: Record<string, unknown>[];

const itemsTable = pgTable("items", {
    id: varchar("id").primaryKey(),
    name: varchar("name"),
    qty: integer("qty"),
    active: boolean("active")
});

const itemsCollection = {
    name: "Items", slug: "items", table: "items",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        name: { name: "Name", type: "string" },
        qty: { name: "Qty", type: "number" },
        active: { name: "Active", type: "boolean" }
    }
} as unknown as CollectionConfig;

/**
 * Rows chosen for the places the two evaluators can disagree: a NULL in every
 * nullable column, a case variation, a duplicate sort key, a zero, and a
 * negative number.
 */
const ROWS = [
    { id: "i1", name: "apple", qty: 10, active: true },
    { id: "i2", name: "Banana", qty: 2, active: false },
    { id: "i3", name: "cherry", qty: 10, active: true },
    { id: "i4", name: null, qty: 0, active: null },
    { id: "i5", name: "date", qty: null, active: true },
    { id: "i6", name: "apple pie", qty: -5, active: false }
];

/** Every filter worth trying, labelled. */
function queries(): { label: string; filter: FilterValues<string> }[] {
    const out: { label: string; filter: FilterValues<string> }[] = [];
    const add = (col: string, op: WhereFilterOp, value: unknown) =>
        out.push({ label: `${col} ${op} ${JSON.stringify(value)}`, filter: { [col]: [op, value] } as never });

    for (const op of ["==", "!=", ">", ">=", "<", "<="] as WhereFilterOp[]) {
        add("qty", op, 10);
        add("qty", op, 0);
        add("name", op, "apple");
        add("name", op, "Banana");
    }
    for (const op of ["is-null", "is-not-null"] as WhereFilterOp[]) {
        add("name", op, null);
        add("qty", op, null);
        add("active", op, null);
    }
    add("name", "in", ["apple", "cherry"]);
    add("name", "not-in", ["apple", "cherry"]);
    add("qty", "in", [10, 2]);
    add("qty", "not-in", [10, 2]);
    add("name", "like", "apple%");
    add("name", "like", "%e");
    add("name", "ilike", "APPLE%");
    add("name", "ilike", "%A%");
    add("name", "not-like", "apple%");
    add("name", "not-ilike", "APPLE%");
    add("active", "==", true);
    add("active", "==", false);
    add("active", "!=", true);
    return out;
}

const QUERIES = queries();

/**
 * Filters whose answer depends on how *strings* are ordered.
 *
 * Split out because they cannot agree, and the reason is structural rather
 * than a bug in either evaluator — see the pinned test at the bottom.
 */
const ORDERING_OPS = new Set(["<", "<=", ">", ">="]);
const opOf = (q: { filter: FilterValues<string> }): WhereFilterOp =>
    (Object.values(q.filter)[0] as [WhereFilterOp, unknown])[0];
const columnOf = (q: { filter: FilterValues<string> }): string => Object.keys(q.filter)[0]!;

/** Orders its operands — the operators whose answer depends on a collation. */
const isOrdering = (q: { filter: FilterValues<string> }): boolean => ORDERING_OPS.has(opOf(q));

/** Orders *text* operands — the subset that actually diverges here. */
const isStringOrdering = (q: { filter: FilterValues<string> }): boolean =>
    isOrdering(q) && columnOf(q) === "name";

const idsOf = (rows: Record<string, unknown>[]): string[] => rows.map(r => String(r.id)).sort();

async function serverIds(props: Record<string, unknown>): Promise<string[]> {
    return idsOf(await driver.fetchCollection({ path: "items", collection: itemsCollection, limit: 1000, ...props } as never));
}

async function serverOrder(props: Record<string, unknown>): Promise<string[]> {
    const rows = await driver.fetchCollection({ path: "items", collection: itemsCollection, limit: 1000, ...props } as never);
    return rows.map(r => String(r.id));
}

const localIds = (params: Record<string, unknown>): string[] =>
    idsOf(runLocalQuery(allRows as never, { limit: 1000, ...params } as never).data as never);

const localOrder = (params: Record<string, unknown>): string[] =>
    (runLocalQuery(allRows as never, { limit: 1000, ...params } as never).data as Record<string, unknown>[])
        .map(r => String(r.id));

beforeAll(async () => {
    container = await startPgContainer();
    pool = new pg.Pool({ connectionString: container.connectionString });
    await pool.query(`
        CREATE TABLE items (
            id varchar PRIMARY KEY, name varchar, qty integer, active boolean
        )
    `);
    for (const r of ROWS) {
        await pool.query("INSERT INTO items VALUES ($1,$2,$3,$4)", [r.id, r.name, r.qty, r.active]);
    }

    const db = drizzle(pool);
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([itemsCollection]);
    registry.registerTable(itemsTable, "items");
    const realtime = new RealtimeService(db as never, registry);
    driver = new PostgresBackendDriver(db as never, realtime as never, registry);
    realtime.setDataDriver(driver);

    // The cache the SDK would be holding: the unfiltered server result.
    allRows = await driver.fetchCollection({ path: "items", collection: itemsCollection, limit: 1000 } as never);
    expect(allRows).toHaveLength(ROWS.length);
}, 180_000);

afterAll(async () => {
    await pool?.end().catch(() => {});
    if (container) await stopPgContainer(container.containerName);
}, 30_000);

describe("offline evaluator vs the server, on identical data", () => {

    it("covers every operator in the union at least once", () => {
        const covered = new Set(QUERIES.map(q => Object.values(q.filter)[0]![0]));
        for (const op of ["==", "!=", ">", ">=", "<", "<=", "in", "not-in", "like", "ilike",
            "not-like", "not-ilike", "is-null", "is-not-null"]) {
            expect({ op, covered: covered.has(op as WhereFilterOp) }).toEqual({ op, covered: true });
        }
    });

    /**
     * Everything except string ordering agrees exactly: equality with the
     * wire's type erasure, all four NULL-testing operators, membership, and all
     * four `LIKE` variants including the case-insensitive ones. That is the
     * part `isExactlyEvaluable` can honestly promise, and it is worth a strict
     * assertion because it is a lot of hand-written JavaScript matching a lot
     * of generated SQL.
     */
    it("selects the same rows for every filter that does not order strings", async () => {
        const divergences: string[] = [];
        for (const q of QUERIES) {
            if (isStringOrdering(q)) continue;
            const server = await serverIds({ filter: q.filter });
            const local = localIds({ where: q.filter });
            if (JSON.stringify(server) !== JSON.stringify(local)) {
                divergences.push(`${q.label}\n    server: [${server}]\n    local:  [${local}]`);
            }
        }
        expect(divergences).toEqual([]);
    });

    /** A unique, single-case sort key agrees in both directions. */
    it("returns the same order when sorting on a unique single-case column", async () => {
        for (const order of ["asc", "desc"] as const) {
            expect({ order, ids: await serverOrder({ orderBy: "id", order }) })
                .toEqual({ order, ids: localOrder({ orderBy: ["id", order] }) });
        }
    });

    it("returns the same page for every offset on that column", async () => {
        for (const offset of [0, 1, 2, 4, 6]) {
            const server = await serverOrder({ orderBy: "id", order: "asc", limit: 2, offset });
            const local = localOrder({ orderBy: ["id", "asc"], limit: 2, offset });
            expect({ offset, server }).toEqual({ offset, server: local });
        }
    });

    /**
     * **KNOWN: string ordering cannot agree, and not because either side is
     * wrong.**
     *
     * `compareValues` orders strings with an `Intl.Collator`. PostgreSQL orders
     * them with the *database's* collation, which is a property of the server
     * the client has never been told. Under the C collation this container uses,
     * `'apple' < 'Banana'` is false (byte order, `B` = 66 before `a` = 97);
     * under `en_US.UTF-8` it is true; the collator says true. So the two agree
     * or disagree depending on how the database was created.
     *
     * The consequence is about the promise, not the comparator:
     * `isExactlyEvaluable` returns true for these queries, and it cannot. A
     * cache hit on `name < 'Banana'` returns a different set from the server,
     * silently, and the offline layer has been told the answer is exact.
     *
     * The same trap is already recorded one layer down, for board order keys,
     * where the fix was to restrict the alphabet so every collation agrees.
     * There is no equivalent move for arbitrary user text, so the promise was
     * narrowed instead: `isExactlyEvaluable` now refuses these queries, which
     * is asserted below. The divergence itself remains — it is not a defect in
     * either comparator — and this test exists to keep it *declared*.
     */
    it("string ordering comparisons diverge, and the offline layer refuses to claim otherwise", async () => {
        const divergences: string[] = [];
        for (const q of QUERIES) {
            if (!isStringOrdering(q)) continue;
            const server = await serverIds({ filter: q.filter });
            const local = localIds({ where: q.filter });
            if (JSON.stringify(server) !== JSON.stringify(local)) divergences.push(q.label);
        }
        // Every one of them, not merely some — a partial agreement here would
        // mean the cause is something narrower than collation.
        expect(divergences).toHaveLength(QUERIES.filter(isStringOrdering).length);

        const { rows } = await pool.query("SELECT ('apple' < 'Banana') AS pg, datcollate FROM pg_database WHERE datname = current_database()");
        expect(rows[0].pg).toBe(false);                               // this container: byte order
        expect("apple".localeCompare("Banana") < 0).toBe(true);       // the collator: locale order

        // The contract: every query that diverges is one the offline layer
        // declines to answer exactly. This is the assertion that makes the
        // divergence safe rather than merely known.
        for (const q of QUERIES.filter(isStringOrdering)) {
            expect({ q: q.label, exact: isExactlyEvaluable({ where: q.filter } as never) })
                .toEqual({ q: q.label, exact: false });
        }
        // …and everything that is not an ordering comparison is still claimed,
        // or the narrowing would be a blanket refusal dressed up as a fix.
        for (const q of QUERIES.filter(x => !isOrdering(x))) {
            expect({ q: q.label, exact: isExactlyEvaluable({ where: q.filter } as never) })
                .toEqual({ q: q.label, exact: true });
        }

        // The cost of the conservatism, stated rather than hidden: a *numeric*
        // range filter is refused too, even though it agrees here. The operand
        // type does not settle it — `compareValues` deliberately reads numeric
        // strings as numbers, so it cannot tell an integer column from a text
        // column of digits, and on the latter Postgres orders "10" before "9"
        // while this orders 9 before 10. Passing the collection schema in would
        // let a number- or date-typed column be claimed again; nothing else
        // would.
        expect(isExactlyEvaluable({ where: { qty: [">", 10] } } as never)).toBe(false);
    });

    it("sorting a text column diverges, and is not claimed as locally sortable", async () => {
        for (const order of ["asc", "desc"] as const) {
            expect(await serverOrder({ orderBy: "name", order }))
                .not.toEqual(localOrder({ orderBy: ["name", order] }));
        }
        // NULL placement, at least, does agree: last on asc, first on desc.
        expect((await serverOrder({ orderBy: "name", order: "asc" })).at(-1)).toBe("i4");
        expect(localOrder({ orderBy: ["name", "asc"] }).at(-1)).toBe("i4");

        // The contract: the overlay keeps the server's order for this column
        // rather than replacing it with the collator's.
        expect(isLocallySortable(allRows, ["name", "asc"])).toBe(false);
        // A numeric column is reproducible, so the overlay still sorts it —
        // the narrowing has to be a distinction, not a blanket refusal.
        expect(isLocallySortable(allRows, ["qty", "asc"])).toBe(true);
        expect(isLocallySortable(allRows, ["id", "asc"])).toBe(false); // text ids
    });

    /**
     * Ties in an ORDER BY resolve the same way on both sides.
     *
     * This was recorded as KNOWN-divergent: sorting on `qty`, where two rows
     * share the value 10, the two sides returned the same values in the same
     * order and disagreed on which of the tied rows came first. Neither was
     * wrong — `ORDER BY qty` with no further key leaves equal rows undefined —
     * but pagination is built on it, and `LIMIT 2 OFFSET 2` over an undefined
     * order can skip a row and repeat another with nothing to notice it.
     *
     * The fix the old note called for has since landed: every sort ends on the
     * primary key, on both sides. So the assertion is inverted rather than
     * deleted. A characterization test kept asserting the OLD behaviour is worse
     * than none — it goes red the moment the bug is fixed, and reads as a
     * regression in whatever change happened to be in flight at the time.
     */
    it("orders tied sort keys identically, because every sort ends on the id", async () => {
        const server = await serverOrder({ orderBy: "qty", order: "asc" });
        const local = localOrder({ orderBy: ["qty", "asc"] });

        expect(server).toEqual(local);

        // Still the right values in the right order, not merely two lists that
        // happen to match — the tie is broken, not the sort. Checked as
        // "ascending, nulls last" rather than against a JS `.sort()`, which
        // compares `null` with `NaN` and would place it second.
        const qtyOf = (id: string) => ROWS.find(r => r.id === id)!.qty;
        const values = server.map(qtyOf);
        const present = values.filter((v): v is number => v !== null && v !== undefined);

        expect(present).toEqual([...present].sort((a, b) => a - b));
        expect(values.slice(present.length).every(v => v === null || v === undefined)).toBe(true);
    });
});
