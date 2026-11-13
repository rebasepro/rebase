import { col, defineTable, type AnyColumn, type AnyTableDef } from "@rebasepro/types";
import { type LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { compileSchema } from "@rebasepro/common";
import { buildRuntimeTable, type RuntimeTable } from "../src/model/runtime-table";
import { isNotNull, isNull } from "drizzle-orm";
import { PgDialect, pgTable, timestamp } from "drizzle-orm/pg-core";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { RealtimeService } from "../src/services/realtimeService";
import { HistoryService } from "../src/history/HistoryService";
import { DEFAULT_SOFT_DELETE_FIELD } from "@rebasepro/common";
import type { SQL } from "drizzle-orm";
import {
    andSoftDelete,
    resolveSoftDelete,
    softDeleteColumn,
    softDeleteCondition
} from "../src/services/soft-delete";
import { unusedDb } from "./helpers/spg-c-db";

/**
 * Soft delete: a delete becomes a timestamp, and every read hides the stamped
 * rows unless asked otherwise.
 *
 * The second half is the one that goes wrong in every implementation of this —
 * a listing that filters and a count that does not is a page saying "1 of 4
 * results", and a relation load that does not is a deleted comment reappearing
 * under its post. So the condition is built by one function and the read paths
 * call it, which is what these tests hold.
 */

/**
 * A real drizzle table, because `getTableColumns` reads drizzle's own symbols
 * and a plain object answers `undefined` for every one of them.
 *
 * `columns` are keyed by property name and named by the second argument, which
 * is exactly the generated schema's shape (`deletedAt: timestamp("deleted_at")`)
 * — and is why the column has to be found under either spelling.
 */
function realTable(name: string, columns: Record<string, string>) {
    const shape: Record<string, ReturnType<typeof timestamp>> = {};
    for (const [key, columnName] of Object.entries(columns)) {
        shape[key] = timestamp(columnName);
    }
    return pgTable(name, shape);
}

/** The runtime table of one definition, over no catalogue table. */
function runtimeOf(def: AnyTableDef): RuntimeTable {
    return buildRuntimeTable(compileSchema([def])[0], undefined);
}

const plainPosts = defineTable("posts", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), deletedAt: col.timestamp({ withTimezone: true }) },
    rls: "admin-only"
});
const offPosts = defineTable("posts", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), deletedAt: col.timestamp({ withTimezone: true }) },
    softDelete: false,
    rls: "admin-only"
});
const softPosts = defineTable("posts", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), deletedAt: col.timestamp({ withTimezone: true }) },
    softDelete: true,
    rls: "admin-only"
});
const removedOnPosts = (removedOn: AnyColumn) => defineTable("posts", {
    columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), removedOn },
    softDelete: { field: "removedOn" },
    rls: "admin-only"
});

describe("resolveSoftDelete", () => {
    it("says nothing for a table that does not declare it", () => {
        expect(resolveSoftDelete(runtimeOf(plainPosts))).toBeUndefined();
        expect(resolveSoftDelete(runtimeOf(offPosts))).toBeUndefined();
        expect(resolveSoftDelete(undefined)).toBeUndefined();
    });

    it("defaults to deletedAt / deleted_at", () => {
        expect(resolveSoftDelete(runtimeOf(softPosts))).toEqual({
            field: DEFAULT_SOFT_DELETE_FIELD,
            columnName: "deleted_at"
        });
    });

    it("takes a named field, and the SQL name its column declares", () => {
        const table = runtimeOf(removedOnPosts(col.timestamp("removed_on_ts", { withTimezone: true })));
        expect(resolveSoftDelete(table)).toEqual({ field: "removedOn", columnName: "removed_on_ts" });
    });

    it("reads the derived SQL name of a named field with no .column()", () => {
        const table = runtimeOf(removedOnPosts(col.timestamp({ withTimezone: true })));
        expect(resolveSoftDelete(table)?.columnName).toBe("removed_on");
    });
});

describe("softDeleteCondition", () => {
    const posts = runtimeOf(softPosts);

    const table = realTable("posts", { id: "id", deletedAt: "deleted_at" });
    const render = (sql: SQL | undefined) => {
        if (!sql) throw new Error("no condition was built");
        return new PgDialect().sqlToQuery(sql).sql;
    };

    it("hides stamped rows by default", () => {
        expect(render(softDeleteCondition(posts, table))).toBe(render(isNull(table.deletedAt)));
    });

    it("adds nothing when the caller asked to include them", () => {
        expect(softDeleteCondition(posts, table, true)).toBeUndefined();
    });

    it("returns only them for `only`", () => {
        expect(render(softDeleteCondition(posts, table, "only")))
            .toBe(render(isNotNull(table.deletedAt)));
    });

    it("adds nothing for a table without soft delete", () => {
        const plain = runtimeOf(plainPosts);
        expect(softDeleteCondition(plain, table)).toBeUndefined();
        // Even for `"only"`: silently returning nothing on a table with no
        // stamp is a worse answer than ignoring a parameter it cannot honour.
        expect(softDeleteCondition(plain, table, "only")).toBeUndefined();
    });

    it("adds nothing when the catalogue table has no such column", () => {
        // Compiling refuses a definition without the column; failing open
        // *here* would be a 500 on a read of a database behind its schema.
        expect(softDeleteCondition(posts, realTable("posts", { id: "id" }))).toBeUndefined();
    });

    it("finds the column keyed under its physical name too", () => {
        // A hand-written drizzle table may key columns by the column name; one
        // read back from the catalogue keys them by the key. Both have to work.
        expect(softDeleteColumn(posts, realTable("posts", { deleted_at: "deleted_at" }))).toBeDefined();
    });

    it("composes with an existing where", () => {
        const combined = andSoftDelete(isNull(table.id), posts, table);
        expect(render(combined)).toContain("and");
    });
});

/**
 * The driver half: what a delete actually writes.
 */
describe("PostgresBackendDriver.delete — soft delete", () => {
    const registry = new FixtureTableRegistry();

    const posts: LegacyCollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        softDelete: true,
        properties: {
            id: { type: "number", isId: "increment" },
            title: { type: "string" },
            deletedAt: { type: "date" }
        }
    } as LegacyCollectionConfig;

    const plain: LegacyCollectionConfig = {
        slug: "notes",
        name: "Notes",
        table: "notes",
        properties: {
            id: { type: "number", isId: "increment" },
            title: { type: "string" }
        }
    };
    registry.registerMultiple([posts, plain]);

    let driver: PostgresBackendDriver;
    let saveSpy: jest.SpyInstance;
    let deleteSpy: jest.SpyInstance;
    let fetchOneSpy: jest.SpyInstance;
    let notifyUpdate: jest.SpyInstance;

    const stand = () => {
        const db = unusedDb();
        const realtime = new RealtimeService(db, registry);
        notifyUpdate = jest.spyOn(realtime, "notifyUpdate").mockResolvedValue(undefined);
        const history = new HistoryService(db);
        jest.spyOn(history, "recordHistory").mockResolvedValue(undefined);
        driver = new PostgresBackendDriver(db, realtime, registry, undefined, undefined, history);
        saveSpy = jest.spyOn(driver.dataService, "save")
            .mockImplementation(async (_p, values) => ({ id: 1, ...values }));
        deleteSpy = jest.spyOn(driver.dataService, "delete").mockResolvedValue(undefined);
        // The row the delete reads before it deletes.
        fetchOneSpy = jest.spyOn(driver.dataService, "fetchOneForRest").mockResolvedValue({ id: 7, title: "Hi" });
        return driver;
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        // Hooks are the table's, read from the registry; none unless a test attaches them.
        registry.setTableHooks("posts", {});
    });

    it("stamps the field instead of issuing a DELETE", async () => {
        await stand().delete({
            row: { id: "7", path: "posts" },
            collection: posts
        });
        expect(deleteSpy).not.toHaveBeenCalled();
        expect(saveSpy).toHaveBeenCalledTimes(1);
        const [path, values, id] = saveSpy.mock.calls[0];
        expect(path).toBe("posts");
        expect(id).toBe("7");
        expect((values as Record<string, unknown>).deletedAt).toBeInstanceOf(Date);
    });

    it("still tells subscribers the row is gone", async () => {
        // From the application's point of view it *was* deleted. How the table
        // records that is the flag's business, not the subscriber's.
        await stand().delete({
            row: { id: "7", path: "posts" },
            collection: posts
        });
        expect(notifyUpdate).toHaveBeenCalledWith("posts", "7", null, undefined);
    });

    it("still runs beforeDelete, and a veto still blocks it", async () => {
        const beforeDelete = jest.fn().mockResolvedValue(false);
        registry.setTableHooks("posts", { beforeDelete });
        await expect(stand().delete({
            row: { id: "7", path: "posts" },
            collection: posts
        })).rejects.toThrow();
        expect(beforeDelete).toHaveBeenCalled();
        expect(saveSpy).not.toHaveBeenCalled();
    });

    it("still runs afterDelete", async () => {
        const afterDelete = jest.fn().mockResolvedValue(undefined);
        registry.setTableHooks("posts", { afterDelete });
        await stand().delete({
            row: { id: "7", path: "posts" },
            collection: posts
        });
        expect(afterDelete).toHaveBeenCalled();
    });

    it("issues a real DELETE when asked for a hard one", async () => {
        await stand().delete({
            row: { id: "7", path: "posts" },
            collection: posts,
            hard: true
        });
        expect(deleteSpy).toHaveBeenCalledTimes(1);
        expect(saveSpy).not.toHaveBeenCalled();
    });

    it("reaches the trash when the delete is hard, and only then", async () => {
        // A hard delete of a row that is already stamped is how the trash is
        // emptied. With nothing to judge it reads nothing: the DELETE reaches
        // a stamped row, where a read hiding stamped rows would answer 404.
        await stand().delete({ row: { id: "7", path: "posts" }, collection: posts, hard: true });
        expect(fetchOneSpy).not.toHaveBeenCalled();
        expect(deleteSpy).toHaveBeenCalledTimes(1);

        // A soft delete of a stamped row is a delete of nothing.
        await stand().delete({ row: { id: "7", path: "posts" }, collection: posts });
        expect(fetchOneSpy).toHaveBeenCalledWith("posts", "7", undefined, undefined, { withDeleted: undefined });
    });

    it("is a real DELETE on a collection that does not soft-delete", async () => {
        await stand().delete({
            row: { id: "7", path: "notes" },
            collection: plain
        });
        expect(deleteSpy).toHaveBeenCalledTimes(1);
    });
});
