/**
 * A row's history lists its entries newest first, also when one transaction
 * recorded several of them — in the order they were written, every time.
 *
 * An entry written on the write's transaction took the column default,
 * `NOW()` — the transaction's start. A `_batch` that creates a row and then
 * updates it recorded both entries with one `updated_at`, and the history list
 * (`ORDER BY updated_at DESC`) put them in whatever order the scan met them:
 * oldest first, so the "latest" entry was the create. Stamping
 * `clock_timestamp()` left the same tie on a coarse clock (PGlite's is
 * milliseconds): the list broke it by the random entry id. Every entry is now
 * stamped after the row's latest one (`historyStampSql`).
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { HistoryService } from "../src/history/HistoryService";
import { ensureHistoryTableExists } from "../src/history/ensure-history-table";
import { runInWriteScope, WriteTransactionScope } from "../src/services/write-transaction-scope";

let pglite: PGlite;
let db: NodePgDatabase;

beforeEach(async () => {
    pglite = new PGlite();
    await pglite.waitReady;
    // PGlite's drizzle database stands in for node-postgres's: the driver names NodePgDatabase, whose
    // `$client` is a pg pool, and no typed bridge between the two exists.
    db = drizzle(pglite) as unknown as NodePgDatabase;
});

afterEach(async () => {
    await pglite.close();
});

describe("history order within one transaction", () => {
    it("lists a create and the update after it, in the same write, newest first", async () => {
        const state = await ensureHistoryTableExists(db);
        expect(state.inTransaction).toBe(true);
        const history = new HistoryService(db, undefined, { ...state, pruneOnRecord: false });

        const scope = new WriteTransactionScope();
        await runInWriteScope(scope, () => db.transaction(async tx => {
            scope.bind(tx, async () => []);
            await history.recordHistory({ tableName: "docs", id: "1", action: "create", values: { id: 1, title: "a" } });
            await history.recordHistory({ tableName: "docs", id: "1", action: "update", values: { id: 1, title: "b" }, previousValues: { id: 1, title: "a" } });
            await history.recordHistory({ tableName: "docs", id: "1", action: "update", values: { id: 1, title: "c" }, previousValues: { id: 1, title: "b" } });
            await scope.settle();
        }));

        const { data } = await history.fetchHistory("docs", "1");
        expect(data.map(entry => (entry.values as { title: string }).title)).toEqual(["c", "b", "a"]);
    });

    it("lists a revert and the revert of that revert in the order they were written", async () => {
        const state = await ensureHistoryTableExists(db);
        const history = new HistoryService(db, undefined, { ...state, pruneOnRecord: false });

        const scope = new WriteTransactionScope();
        await runInWriteScope(scope, () => db.transaction(async tx => {
            scope.bind(tx, async () => []);
            await history.recordHistory({ tableName: "docs", id: "1", action: "create", values: { id: 1, title: "a" } });
            await history.recordHistory({ tableName: "docs", id: "1", action: "update", values: { id: 1, title: "b" }, previousValues: { id: 1, title: "a" } });
            // Revert to "a", then revert that revert back to "b".
            await history.recordHistory({ tableName: "docs", id: "1", action: "update", values: { id: 1, title: "a" }, previousValues: { id: 1, title: "b" } });
            await history.recordHistory({ tableName: "docs", id: "1", action: "update", values: { id: 1, title: "b" }, previousValues: { id: 1, title: "a" } });
            await scope.settle();
        }));

        const { data } = await history.fetchHistory("docs", "1");
        expect(data.map(entry => [entry.action, (entry.values as { title: string }).title]))
            .toEqual([["update", "b"], ["update", "a"], ["update", "b"], ["create", "a"]]);
    });

    it("orders entries recorded outside a write's transaction too, and keeps rows apart", async () => {
        const state = await ensureHistoryTableExists(db);
        // The service's own path: each entry its own statement, no write scope.
        const history = new HistoryService(db, undefined, { ...state, inTransaction: false, pruneOnRecord: false });

        let previous: string | undefined;
        for (const title of ["a", "b", "c", "d", "e"]) {
            for (const id of [1, 2]) {
                await history.recordHistory({
                    tableName: "docs",
                    id: String(id),
                    action: previous ? "update" : "create",
                    values: { id, title },
                    previousValues: previous ? { id, title: previous } : undefined
                });
            }
            previous = title;
        }

        for (const id of ["1", "2"]) {
            const { data } = await history.fetchHistory("docs", id);
            expect(data.map(entry => (entry.values as { title: string }).title)).toEqual(["e", "d", "c", "b", "a"]);
        }
    });
});
