/**
 * A row's history lists its entries newest first, also when one transaction
 * recorded several of them.
 *
 * An entry written on the write's transaction took the column default,
 * `NOW()` — the transaction's start. A `_batch` that creates a row and then
 * updates it recorded both entries with one `updated_at`, and the history list
 * (`ORDER BY updated_at DESC`) put them in whatever order the scan met them:
 * oldest first, so the "latest" entry was the create.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { HistoryService } from "../src/history/HistoryService";
import { ensureHistoryTableExists } from "../src/history/ensure-history-table";
import { runInWriteScope, WriteTransactionScope } from "../src/services/write-transaction-scope";
import type { DrizzleClient } from "../src/interfaces";

let pglite: PGlite;
let db: NodePgDatabase;

beforeEach(async () => {
    pglite = new PGlite();
    await pglite.waitReady;
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
            scope.bind(tx as unknown as DrizzleClient, async () => []);
            await history.recordHistory({ tableName: "docs", id: "1", action: "create", values: { id: 1, title: "a" } });
            await history.recordHistory({ tableName: "docs", id: "1", action: "update", values: { id: 1, title: "b" }, previousValues: { id: 1, title: "a" } });
            await history.recordHistory({ tableName: "docs", id: "1", action: "update", values: { id: 1, title: "c" }, previousValues: { id: 1, title: "b" } });
            await scope.settle();
        }));

        const { data } = await history.fetchHistory("docs", "1");
        expect(data.map(entry => (entry.values as { title: string }).title)).toEqual(["c", "b", "a"]);
    });
});
