/**
 * On a `softDelete` collection, stamping the field is a delete, and only a
 * delete may do it.
 *
 * The field is an ordinary declared `date` property, so an update could set it:
 * `PATCH /posts/1 {deletedAt: now}` trashed the row as surely as `DELETE`, but
 * as a write — past an API key scoped to read+write with delete withheld, past
 * `beforeDelete`'s veto, without `afterDelete`, recorded in history as an
 * update. The same through `PATCH /bulk`, `_batch`, the socket and MCP, which
 * all reach the driver's save.
 *
 * Clearing the field stays an ordinary update — that is how a row is restored.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const postsTable = pgTable("posts", {
    id: serial("id").primaryKey(),
    title: varchar("title"),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" })
});

/** How many times `beforeDelete` was asked. */
let beforeDeleteCalls: number;

function postsCollection(): CollectionConfig {
    return {
        name: "Posts",
        slug: "posts",
        table: "posts",
        softDelete: true,
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            title: { name: "Title", type: "string" },
            deletedAt: { name: "Deleted at", type: "date", columnName: "deleted_at" }
        },
        callbacks: {
            beforeDelete: () => {
                beforeDeleteCalls++;
                return false;
            }
        }
    } as unknown as CollectionConfig;
}

let db: PGlite;

function driverOver(pglite: PGlite): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([postsCollection()]);
    registry.registerTable(postsTable, "posts");
    const orm = drizzle(pglite, { schema: { posts: postsTable } }) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

const deletedAtOf = async (id: number): Promise<string | null> =>
    (await db.query<{ deleted_at: string | null }>("SELECT (deleted_at AT TIME ZONE 'UTC')::text AS deleted_at FROM posts WHERE id = $1", [id])).rows[0].deleted_at;
const titleOf = async (id: number): Promise<string> =>
    (await db.query<{ title: string }>("SELECT title FROM posts WHERE id = $1", [id])).rows[0].title;

const TRASH = { deletedAt: "2026-01-01T00:00:00Z" };
const REFUSAL = { statusCode: 400, code: "FIELD_NOT_WRITABLE" };

beforeEach(async () => {
    beforeDeleteCalls = 0;
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE posts (id serial PRIMARY KEY, title varchar, deleted_at timestamptz);
        INSERT INTO posts (id, title, deleted_at) VALUES (1, 'live', NULL), (2, 'trashed', '2025-01-01T00:00:00Z');
    `);
});

afterEach(async () => {
    await db.close();
});

describe("an update may not stamp the soft-delete field", () => {
    it("control: the delete a beforeDelete vetoes leaves the row live", async () => {
        await expect(driverOver(db).delete({ row: { id: "1", path: "posts" } })).rejects.toMatchObject({ code: "CALLBACK_REJECTED" });
        expect(beforeDeleteCalls).toBe(1);
        expect(await deletedAtOf(1)).toBeNull();
    });

    it("a single update setting it is refused, and the row stays live", async () => {
        await expect(driverOver(db).save({
            path: "posts", id: "1", values: { title: "edited", ...TRASH }, status: "existing"
        })).rejects.toMatchObject(REFUSAL);

        expect(await deletedAtOf(1)).toBeNull();
        expect(await titleOf(1)).toBe("live");
    });

    it("a bulk update (PATCH /bulk) setting it is refused", async () => {
        await expect(driverOver(db).updateMany({
            path: "posts", updates: [{ id: 1, values: TRASH }]
        })).rejects.toMatchObject(REFUSAL);

        expect(await deletedAtOf(1)).toBeNull();
    });

    it("a `_batch` update setting it is refused", async () => {
        await expect(driverOver(db).batchWrite({
            operations: [{ op: "update", path: "posts", id: "1", values: TRASH }]
        })).rejects.toMatchObject(REFUSAL);

        expect(await deletedAtOf(1)).toBeNull();
    });

    it("an upsert over the stored row setting it is refused", async () => {
        await expect(driverOver(db).save({
            path: "posts", values: { id: 1, ...TRASH }, status: "new", upsert: true
        })).rejects.toMatchObject(REFUSAL);

        expect(await deletedAtOf(1)).toBeNull();
    });

    it("an upsert onto a trashed row's key leaves the row as it was", async () => {
        // It used to write the title into the trashed row and keep the old
        // stamp. An upsert does not write into the trash at all now: it is
        // refused by name, and the stamp and the title both stay.
        await expect(driverOver(db).save({
            path: "posts", values: { id: 2, title: "re-imported", ...TRASH }, status: "new", upsert: true
        })).rejects.toMatchObject({ statusCode: 409, code: "ROW_IN_TRASH" });

        expect(await titleOf(2)).toBe("trashed");
        expect((await deletedAtOf(2))?.startsWith("2025-01-01")).toBe(true);
    });

    it("an upsert may create a row already trashed", async () => {
        await driverOver(db).save({
            path: "posts", values: { id: 3, title: "archived import", ...TRASH }, status: "new", upsert: true
        });

        expect((await deletedAtOf(3))?.startsWith("2026-01-01")).toBe(true);
    });

    it("an update that clears it restores the row", async () => {
        await driverOver(db).save({ path: "posts", id: "2", values: { deletedAt: null }, status: "existing" });

        expect(await deletedAtOf(2)).toBeNull();
    });

    it("an update carrying it as null, as a form does, is an ordinary edit", async () => {
        await driverOver(db).save({ path: "posts", id: "1", values: { title: "edited", deletedAt: null }, status: "existing" });

        expect(await titleOf(1)).toBe("edited");
        expect(await deletedAtOf(1)).toBeNull();
    });
});

/**
 * The restore through the doors that read the row first. `updateMany` and
 * `batchWrite` look a row up before updating it, so a missing one is a 404 —
 * and that read hides trashed rows, so the restore, an ordinary update of a
 * row the default read hides, was a 404 too. `save` (the socket, MCP, the SDK
 * in-process) does not read first, and restored.
 */
describe("a restore through the doors that read the row first", () => {
    it("a bulk update (PATCH /bulk) clearing the field restores the row", async () => {
        await driverOver(db).updateMany({ path: "posts", updates: [{ id: 2, values: { deletedAt: null } }] });

        expect(await deletedAtOf(2)).toBeNull();
    });

    it("a `_batch` update clearing the field restores the row", async () => {
        await driverOver(db).batchWrite({
            operations: [{ op: "update", path: "posts", id: "2", values: { deletedAt: null } }]
        });

        expect(await deletedAtOf(2)).toBeNull();
    });

    it("any other bulk edit of a trashed row is still a 404", async () => {
        await expect(driverOver(db).updateMany({
            path: "posts", updates: [{ id: 2, values: { title: "edited in the trash" } }]
        })).rejects.toMatchObject({ statusCode: 404 });

        expect(await titleOf(2)).toBe("trashed");
    });
});
