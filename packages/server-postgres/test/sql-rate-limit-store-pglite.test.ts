/**
 * The shared rate-limit store, asked of a real Postgres (PGlite).
 *
 * `packages/server/src/auth/sql-rate-limit-store.test.ts` runs the store over a
 * fake SQL admin that re-implements the bucket table in a Map, and says so: the
 * arithmetic is tested there, the statement is not. Here the store's own DDL
 * and its own `INSERT … ON CONFLICT … RETURNING` run on a database, so a change
 * to the SQL — a read-then-write, a dropped conflict target, a refund that
 * misses its row — is caught by the database's answer, not by a fake's.
 * (In this package because PGlite is a dependency here, as `job-claim-fencing`
 * tests the job store the same way.)
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { DataDriver } from "@rebasepro/types";
import { createSqlRateLimitStore } from "../../server/src/auth/sql-rate-limit-store";
import type { RateLimitStore } from "../../server/src/auth/rate-limit-store";

/** Parameterised statements through the extended protocol, DDL through the simple one. */
function pgliteDriver(db: PGlite): DataDriver {
    return {
        key: "postgres",
        admin: {
            async executeSql(sql: string, options?: { params?: unknown[] }) {
                if (options?.params) {
                    return (await db.query(sql, options.params)).rows as Record<string, unknown>[];
                }
                const results = await db.exec(sql);
                return (results[results.length - 1]?.rows ?? []) as Record<string, unknown>[];
            }
        }
    } as unknown as DataDriver;
}

const WINDOW = 60_000;
// The first millisecond of a window, so the previous bucket carries its full
// weight and nothing about the test depends on where in a window it lands.
const START = 1_000 * WINDOW;

let db: PGlite;
let clock = START;
let store: RateLimitStore;

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    clock = START;
    store = createSqlRateLimitStore(pgliteDriver(db), { now: () => clock })!;
});

afterEach(async () => {
    store.dispose?.();
    await db.close();
});

async function hits(key: string): Promise<number> {
    const { rows } = await db.query<{ hits: number }>(
        "SELECT COALESCE(SUM(hits), 0)::int AS hits FROM rebase.rate_limit_hits WHERE key = $1",
        [key]
    );
    return rows[0].hits;
}

/** The refund on a denial is fire-and-forget; let it land before reading. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("the shared rate-limit store, on a real database", () => {
    it("allows the limit and denies the next hit, in sequence", async () => {
        const decisions = [];
        for (let i = 0; i < 6; i++) decisions.push(await store.hit("ip:1", WINDOW, 5));

        expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, true, true, false]);
        await settle();
        // The denied hit was given back: the table holds what was allowed.
        expect(await hits("ip:1")).toBe(5);
    });

    it("allows exactly the limit out of a burst that arrives together", async () => {
        const decisions = await Promise.all(
            Array.from({ length: 10 }, () => store.hit("ip:burst", WINDOW, 5))
        );

        expect(decisions.filter((d) => d.allowed)).toHaveLength(5);
        await settle();
        expect(await hits("ip:burst")).toBe(5);
    });

    it("counts each key on its own", async () => {
        for (let i = 0; i < 5; i++) await store.hit("ip:a", WINDOW, 5);

        expect((await store.hit("ip:b", WINDOW, 5)).allowed).toBe(true);
        expect((await store.hit("ip:a", WINDOW, 5)).allowed).toBe(false);
    });

    it("carries the previous window into the next, so a boundary burst is not free", async () => {
        for (let i = 0; i < 5; i++) await store.hit("ip:edge", WINDOW, 5);

        // The first millisecond of the next window: the previous bucket still
        // counts fully, so the caller has nothing left.
        clock = START + WINDOW;
        expect((await store.hit("ip:edge", WINDOW, 5)).allowed).toBe(false);

        // Two windows on, the old bucket is out of view.
        clock = START + 2 * WINDOW;
        expect((await store.hit("ip:edge", WINDOW, 5)).allowed).toBe(true);
    });
});
