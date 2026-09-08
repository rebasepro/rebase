import { CollectionConfig } from "@rebasepro/types";
import { isNotNull, isNull } from "drizzle-orm";
import { PgDialect, pgTable, timestamp } from "drizzle-orm/pg-core";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { HistoryService } from "../src/history/HistoryService";
import {
    DEFAULT_SOFT_DELETE_FIELD,
    andSoftDelete,
    resolveSoftDelete,
    softDeleteColumn,
    softDeleteCondition
} from "../src/services/soft-delete";

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

describe("resolveSoftDelete", () => {
    const base = (softDelete: unknown, extra: Record<string, unknown> = {}): CollectionConfig => ({
        slug: "posts",
        name: "Posts",
        table: "posts",
        softDelete,
        properties: {
            id: { type: "number", isId: "increment" },
            deletedAt: { type: "date" },
            ...extra
        }
    } as CollectionConfig);

    it("says nothing for a collection that does not declare it", () => {
        expect(resolveSoftDelete(base(undefined))).toBeUndefined();
        expect(resolveSoftDelete(base(false))).toBeUndefined();
        expect(resolveSoftDelete(undefined)).toBeUndefined();
    });

    it("defaults to deletedAt / deleted_at", () => {
        expect(resolveSoftDelete(base(true))).toEqual({
            field: DEFAULT_SOFT_DELETE_FIELD,
            columnName: "deleted_at"
        });
    });

    it("takes a named field, and its columnName when it has one", () => {
        const collection = base({ field: "removedOn" }, {
            removedOn: { type: "date", columnName: "removed_on_ts" }
        });
        expect(resolveSoftDelete(collection)).toEqual({
            field: "removedOn",
            columnName: "removed_on_ts"
        });
    });

    it("snake-cases a named field with no columnName", () => {
        const collection = base({ field: "removedOn" }, { removedOn: { type: "date" } });
        expect(resolveSoftDelete(collection)?.columnName).toBe("removed_on");
    });
});

describe("softDeleteCondition", () => {
    const posts = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        softDelete: true,
        properties: {
            id: { type: "number", isId: "increment" },
            deletedAt: { type: "date" }
        }
    } as unknown as CollectionConfig;

    const table = realTable("posts", { id: "id", deletedAt: "deleted_at" });
    const render = (sql: unknown) => new PgDialect().sqlToQuery(sql as never).sql;

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

    it("adds nothing for a collection without soft delete", () => {
        const plain = { ...posts, softDelete: undefined } as CollectionConfig;
        expect(softDeleteCondition(plain, table)).toBeUndefined();
        // Even for `"only"`: silently returning nothing on a collection with no
        // stamp is a worse answer than ignoring a parameter it cannot honour.
        expect(softDeleteCondition(plain, table, "only")).toBeUndefined();
    });

    it("adds nothing when the table has no such column", () => {
        // The boot check is what refuses this config; failing open *here* would
        // be a 500 on a read rather than a message at startup.
        expect(softDeleteCondition(posts, realTable("posts", { id: "id" }))).toBeUndefined();
    });

    it("finds the column keyed under its physical name too", () => {
        // An introspected schema keys columns by the column name; a generated
        // one keys them by the property. Both have to work.
        const byColumn = {
            ...posts,
            properties: { ...posts.properties, deletedAt: { type: "date", columnName: "deleted_at" } }
        } as CollectionConfig;
        expect(softDeleteColumn(byColumn, realTable("posts", { deleted_at: "deleted_at" }))).toBeDefined();
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
    const registry = new PostgresCollectionRegistry();

    const posts: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        idField: "id",
        softDelete: true,
        properties: {
            id: { type: "number", isId: "increment" },
            title: { type: "string" },
            deletedAt: { type: "date" }
        }
    } as CollectionConfig;

    const plain: CollectionConfig = {
        slug: "notes",
        name: "Notes",
        table: "notes",
        idField: "id",
        properties: {
            id: { type: "number", isId: "increment" },
            title: { type: "string" }
        }
    };

    let driver: PostgresBackendDriver;
    let saveSpy: jest.SpyInstance;
    let deleteSpy: jest.SpyInstance;
    let notifyUpdate: jest.Mock;

    const stand = () => {
        notifyUpdate = jest.fn().mockResolvedValue(undefined);
        driver = new PostgresBackendDriver(
            {} as any,
            { notifyUpdate } as unknown as RealtimeService,
            registry,
            undefined,
            undefined,
            { recordHistory: jest.fn().mockResolvedValue(undefined) } as unknown as HistoryService
        );
        saveSpy = jest.spyOn(driver.dataService, "save")
            .mockImplementation(async (_p, values) => ({ id: 1, ...(values as object) }) as any);
        deleteSpy = jest.spyOn(driver.dataService, "delete").mockResolvedValue(undefined as any);
        return driver;
    };

    beforeEach(() => {
        jest.restoreAllMocks();
    });

    it("stamps the field instead of issuing a DELETE", async () => {
        await stand().delete({
            row: { id: "7", path: "posts", values: { title: "Hi" } },
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
            row: { id: "7", path: "posts", values: {} },
            collection: posts
        });
        expect(notifyUpdate).toHaveBeenCalledWith("posts", "7", null, undefined);
    });

    it("still runs beforeDelete, and a veto still blocks it", async () => {
        const beforeDelete = jest.fn().mockResolvedValue(false);
        await expect(stand().delete({
            row: { id: "7", path: "posts", values: {} },
            collection: { ...posts, callbacks: { beforeDelete } } as CollectionConfig
        })).rejects.toThrow();
        expect(beforeDelete).toHaveBeenCalled();
        expect(saveSpy).not.toHaveBeenCalled();
    });

    it("still runs afterDelete", async () => {
        const afterDelete = jest.fn().mockResolvedValue(undefined);
        await stand().delete({
            row: { id: "7", path: "posts", values: {} },
            collection: { ...posts, callbacks: { afterDelete } } as CollectionConfig
        });
        expect(afterDelete).toHaveBeenCalled();
    });

    it("issues a real DELETE when asked for a hard one", async () => {
        await stand().delete({
            row: { id: "7", path: "posts", values: {} },
            collection: posts,
            hard: true
        });
        expect(deleteSpy).toHaveBeenCalledTimes(1);
        expect(saveSpy).not.toHaveBeenCalled();
    });

    it("is a real DELETE on a collection that does not soft-delete", async () => {
        await stand().delete({
            row: { id: "7", path: "notes", values: {} },
            collection: plain
        });
        expect(deleteSpy).toHaveBeenCalledTimes(1);
    });
});
