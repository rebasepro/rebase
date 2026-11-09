/**
 * A `_batch` update or delete whose `$ref` id resolves to nothing is refused.
 *
 * The REST layer checks that an update or delete carries an `id` before the
 * transaction opens, and a `{ "$ref": "c.parent_id" }` passes that check. It
 * is resolved inside the transaction, and an earlier row whose `parent_id` is
 * NULL resolved it to `null` — which the driver read as "no id". An update
 * with no id is the persistence layer's INSERT, so the batch created a new row
 * where it asked to update one, and told its hooks and history it was an
 * update of an existing row.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const commentsTable = pgTable("comments", { id: serial("id").primaryKey(), body: varchar("body"), parentId: integer("parent_id") });

function comments(): CollectionConfig {
    return {
        name: "Comments", slug: "comments", table: "comments",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            body: { name: "Body", type: "string" },
            parentId: { name: "Parent", type: "number", columnName: "parent_id" }
        }
    };
}

let db: PGlite;

function driverOver(pglite: PGlite): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([comments()]);
    registry.registerTable(commentsTable, "comments");
    const orm = drizzle(pglite, { schema: { comments: commentsTable } }) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec("CREATE TABLE comments (id serial PRIMARY KEY, body varchar, parent_id integer)");
});

afterEach(async () => {
    await db.close();
});

const count = async () => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM comments")).rows[0].n;

describe("a batch id that resolves to nothing", () => {
    it("refuses an update, and the batch rolls back", async () => {
        await expect(driverOver(db).batchWrite({
            operations: [
                { op: "create", path: "comments", ref: "c", values: { body: "root", parentId: null } },
                { op: "update", path: "comments", id: { $ref: "c.parentId" }, values: { body: "edited" } }
            ]
        } as never)).rejects.toMatchObject({ statusCode: 400 });
        expect(await count()).toBe(0);
    });

    it("refuses a delete", async () => {
        await expect(driverOver(db).batchWrite({
            operations: [
                { op: "create", path: "comments", ref: "c", values: { body: "root", parentId: null } },
                { op: "delete", path: "comments", id: { $ref: "c.parentId" } }
            ]
        } as never)).rejects.toMatchObject({ statusCode: 400 });
        expect(await count()).toBe(0);
    });

    it("still resolves one that names a row", async () => {
        await driverOver(db).batchWrite({
            operations: [
                { op: "create", path: "comments", ref: "c", values: { body: "root" } },
                { op: "update", path: "comments", id: { $ref: "c.id" }, values: { body: "edited" } }
            ]
        } as never);
        expect((await db.query<{ body: string }>("SELECT body FROM comments")).rows).toEqual([{ body: "edited" }]);
    });
});
