/**
 * A vector read that also filters serves the rows that match, on an HNSW index.
 *
 * An HNSW index answers with the `hnsw.ef_search` (40) candidates nearest the
 * query, and every other condition is applied to those candidates afterwards.
 * Here half the rows are `rare`, all of them far from the query vector, so the
 * 40 candidates are all `common` and `status = 'rare'` kept none of them: a
 * page of 10 came back empty while 10,000 rows matched, and offset pages were
 * empty until the planner switched to an exact scan further down — a walk that
 * skipped the nearest rows. pgvector 0.8's iterative scan keeps the index
 * scanning until the page is full (`vector-iterative-scan.ts`).
 *
 * Nothing is stubbed: PGlite with pgvector 0.8.1, an HNSW index, and the reads
 * go through `FetchService`. The planner has to choose the index for the
 * question to arise at all, which is why the table has 20,000 rows; the first
 * test checks that it does.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, serial, text, vector } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { FetchService } from "../src/services/FetchService";
import { hasIterativeIndexScans } from "../src/services/vector-iterative-scan";

// pgvector for PGlite is a dependency of the CLI, which runs `rebase dev` on
// it, and not of this package; resolved from there rather than added here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { vector: pgvector } = require(path.resolve(__dirname, "../../cli/node_modules/@electric-sql/pglite-pgvector")) as {
    vector: NonNullable<ConstructorParameters<typeof PGlite>[1]>["extensions"] extends infer E ? E[keyof E] : never;
};

const DIM = 16;
const ROWS = 20_000;

const items = {
    slug: "items", name: "Items", table: "items",
    properties: {
        id: { type: "number", isId: "increment" },
        status: { type: "string" },
        emb: { type: "vector", dimensions: DIM }
    }
} as unknown as CollectionConfig;

const itemsTable = pgTable("items", {
    id: serial("id").primaryKey(),
    status: text("status"),
    emb: vector("emb", { dimensions: DIM })
});

/** A deterministic generator (mulberry32), so a failure reproduces. */
let seed = 42;
const rand = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** A vector in one of two clusters: every component near +0.75, or near -0.75. */
const clustered = (sign: 1 | -1): number[] =>
    Array.from({ length: DIM }, () => sign * (0.5 + rand() * 0.5) + (rand() - 0.5) * 0.2);

let db: PGlite;
let service: FetchService;
let registry: PostgresCollectionRegistry;
const query = clustered(1);
const literal = `'[${query.join(",")}]'::vector`;

type Row = Record<string, unknown> & { id: number; _distance: number };

const read = (options: Record<string, unknown>) =>
    service.fetchCollectionForRest("items", {
        vectorSearch: { property: "emb", vector: query },
        ...options
    }) as Promise<Row[]>;

beforeAll(async () => {
    db = new PGlite({ extensions: { vector: pgvector } });
    await db.waitReady;
    await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
    await db.exec(`CREATE TABLE items (id serial PRIMARY KEY, status text, emb vector(${DIM}));`);
    for (let start = 0; start < ROWS; start += 1000) {
        const values: string[] = [];
        for (let i = start; i < start + 1000; i++) {
            const rare = i % 2 === 0;
            values.push(`('${rare ? "rare" : "common"}', '[${clustered(rare ? -1 : 1).join(",")}]')`);
        }
        await db.exec(`INSERT INTO items (status, emb) VALUES ${values.join(",")};`);
    }
    await db.exec("CREATE INDEX items_emb_hnsw ON items USING hnsw (emb vector_cosine_ops); ANALYZE items;");

    registry = new PostgresCollectionRegistry();
    registry.registerMultiple([items]);
    registry.registerTable(itemsTable, "items");
    service = new FetchService(drizzle(db) as never, registry);
}, 120_000);

afterAll(async () => {
    await db?.close();
});

describe("the setup", () => {
    it("runs on a pgvector with iterative scans, and the planner reads the filtered page off the index", async () => {
        const version = await db.query<{ extversion: string }>("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
        expect(hasIterativeIndexScans(version.rows[0].extversion)).toBe(true);

        const plan = await db.query<{ "QUERY PLAN": string }>(
            `EXPLAIN SELECT id FROM items WHERE status = 'rare' ORDER BY emb <=> ${literal}, id DESC LIMIT 10`
        );
        expect(plan.rows.map(r => r["QUERY PLAN"]).join("\n")).toContain("Index Scan using items_emb_hnsw");
    });
});

describe("a vector read with a filter", () => {
    it("serves a full page when that many rows match", async () => {
        const rows = await read({ filter: { status: ["==", "rare"] }, limit: 10 });
        expect(rows).toHaveLength(10);
        expect(rows.every(row => row.status === "rare")).toBe(true);
    });

    it("pages by offset without an empty page, a repeated row, or a step back in distance", async () => {
        const served: Row[] = [];
        for (let offset = 0; offset < 200; offset += 10) {
            const page = await read({ filter: { status: ["==", "rare"] }, limit: 10, offset });
            expect(page).toHaveLength(10);
            served.push(...page);
        }
        expect(new Set(served.map(row => row.id)).size).toBe(200);
        for (let i = 1; i < served.length; i++) {
            expect(served[i]._distance).toBeGreaterThanOrEqual(served[i - 1]._distance);
        }
    });

    it("does the same inside a transaction it is handed, as a signed-in request's read is", async () => {
        // The request-scoped driver reads inside its own transaction (identity,
        // role, RLS), and the setting is made in that one rather than a new one.
        const rows = await drizzle(db).transaction(async (tx) =>
            new FetchService(tx as never, registry).fetchCollectionForRest("items", {
                vectorSearch: { property: "emb", vector: query },
                filter: { status: ["==", "rare"] },
                limit: 10
            }));
        expect(rows).toHaveLength(10);
    });

    it("leaves nothing set on the connection once the read is over", async () => {
        await read({ filter: { status: ["==", "rare"] }, limit: 10 });
        const setting = await db.query<{ value: string }>("SELECT current_setting('hnsw.iterative_scan') AS value");
        expect(setting.rows[0].value).toBe("off");
    });
});

describe("a vector read with a threshold", () => {
    /**
     * A threshold between the `n`th and the next row of the read without one,
     * so exactly `n` of its rows lie inside it. Taken from the index's own
     * answer, not an exact scan: which rows an approximate index finds is the
     * index's business, and the threshold's is only where to stop.
     */
    const thresholdAfter = async (n: number) => {
        const plain = await read({ limit: n + 1 });
        expect(plain[n]._distance).toBeGreaterThan(plain[n - 1]._distance);
        return (plain[n - 1]._distance + plain[n]._distance) / 2;
    };

    it("serves the rows inside it, all of them when fewer than the page", async () => {
        const threshold = await thresholdAfter(6);
        const rows = await read({ limit: 10, vectorSearch: { property: "emb", vector: query, threshold } });
        expect(rows.map(row => row.id)).toEqual((await read({ limit: 6 })).map(row => row.id));
        expect(rows.every(row => row._distance < threshold)).toBe(true);
    });

    it("pages inside it by offset exactly as the read without it does", async () => {
        const threshold = await thresholdAfter(45);
        const served: Row[] = [];
        for (let offset = 0; offset < 60; offset += 10) {
            served.push(...await read({ limit: 10, offset, vectorSearch: { property: "emb", vector: query, threshold } }));
        }
        expect(served.map(row => row.id)).toEqual((await read({ limit: 45 })).map(row => row.id));
    });

    it("is not a condition of the read, which would send the index past the page looking for rows", async () => {
        // Under an iterative scan a distance condition is applied to the
        // index's rows one by one, so a page asking for more rows than lie
        // inside the threshold walked the index to its scan limit: 22 ms
        // against 1 ms for the same page on 20,000 × 256. The rows inside are
        // the front of the ordering, so they are cut after the read instead.
        const statements: string[] = [];
        const logged = new FetchService(
            drizzle(db, { logger: { logQuery: (text: string) => { statements.push(text); } } }) as never,
            registry
        );
        await logged.fetchCollectionForRest("items", {
            limit: 10, vectorSearch: { property: "emb", vector: query, threshold: 0.01 }
        });
        const page = statements.find(text => /order by/i.test(text));
        expect(page).toBeDefined();
        expect(page).not.toMatch(/::vector\)\s*</);
    });

    it("with a filter as well, still fills the page from the rows inside both", async () => {
        const rare = await read({ filter: { status: ["==", "rare"] }, limit: 13 });
        const threshold = (rare[11]._distance + rare[12]._distance) / 2;
        const rows = await read({
            filter: { status: ["==", "rare"] }, limit: 10,
            vectorSearch: { property: "emb", vector: query, threshold }
        });
        expect(rows.map(row => row.id)).toEqual(rare.slice(0, 10).map(row => row.id));
    });
});

describe("hasIterativeIndexScans", () => {
    it.each([
        ["0.8.0", true], ["0.8.1", true], ["0.10.2", true], ["1.0.0", true],
        ["0.7.4", false], ["0.5.1", false], [undefined, false], ["", false], ["garbage", false]
    ])("%s → %s", (version, expected) => {
        expect(hasIterativeIndexScans(version)).toBe(expected);
    });
});
