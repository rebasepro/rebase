/**
 * The job retention sweep against a real Postgres (PGlite).
 *
 * It used to be one unbatched `DELETE` inside `ensureTable`: awaited in the
 * boot path, a sequential scan of the whole table, and never repeated for as
 * long as the process lived. It now runs on the worker's timer, in batches,
 * through `idx_jobs_finished`. Which rows a `DELETE` keeps is the database's
 * answer, so it is asked of one here.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { DataDriver } from "@rebasepro/types";
import { createJobStore, type JobStore } from "../../server/src/jobs";

/** Parameterised statements through the extended protocol, DDL through the simple one. */
function pgliteDriver(db: PGlite, statements: string[] = []): DataDriver {
    return {
        key: "postgres",
        admin: {
            async executeSql(sql: string, options?: { params?: unknown[] }) {
                statements.push(sql);
                if (options?.params) {
                    return (await db.query(sql, options.params)).rows as Record<string, unknown>[];
                }
                const results = await db.exec(sql);
                return (results[results.length - 1]?.rows ?? []) as Record<string, unknown>[];
            }
        }
    } as unknown as DataDriver;
}

let db: PGlite;
let store: JobStore;

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    store = createJobStore(pgliteDriver(db))!;
    await store.ensureTable();
});

afterEach(async () => {
    await db.close();
});

/** `count` jobs in `status`, last touched `days` ago. */
async function seed(status: string, days: number, count: number): Promise<void> {
    await db.query(
        `INSERT INTO rebase.jobs (task, status, updated_at)
         SELECT 'report', $1, now() - make_interval(days => $2) FROM generate_series(1, $3)`,
        [status, days, count]
    );
}

async function counts(): Promise<Record<string, number>> {
    const { rows } = await db.query<{ status: string; age: string; n: number }>(
        `SELECT status, CASE WHEN updated_at < now() - interval '3 days' THEN 'old' ELSE 'new' END AS age,
                count(*)::int AS n
         FROM rebase.jobs GROUP BY 1, 2`
    );
    return Object.fromEntries(rows.map(r => [`${r.status}/${r.age}`, r.n]));
}

describe("the job retention sweep", () => {
    it("is not part of booting", async () => {
        await seed("succeeded", 10, 3);
        const statements: string[] = [];

        await createJobStore(pgliteDriver(db, statements))!.ensureTable();

        expect(statements.filter(s => /\bDELETE\b/.test(s))).toEqual([]);
        expect(await counts()).toEqual({ "succeeded/old": 3 });
    });

    it("removes what is past retention, in batches, and nothing else", async () => {
        // More than two batches of expired successes, so the loop has to
        // come back for the rest.
        await seed("succeeded", 4, 12_000);
        await seed("succeeded", 1, 7);
        // Failures keep for thirty days.
        await seed("failed", 10, 5);
        await seed("failed", 31, 4);
        // Unfinished work is never swept, however old.
        await seed("pending", 40, 2);
        await seed("running", 40, 1);

        expect(await store.sweepExpired!()).toBe(12_004);

        expect(await counts()).toEqual({
            "succeeded/new": 7,
            "failed/old": 5,
            "pending/old": 2,
            "running/old": 1
        });
        expect(await store.sweepExpired!()).toBe(0);
    });

    it("has an index that holds only the rows it can delete", async () => {
        const { rows } = await db.query<{ indexdef: string }>(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'rebase' AND indexname = 'idx_jobs_finished'"
        );
        expect(rows[0]?.indexdef).toMatch(/\(status, updated_at\) WHERE \(status = ANY \(ARRAY\['succeeded'::text, 'failed'::text\]\)\)/);
    });
});
