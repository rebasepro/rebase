/**
 * A `map` value whose keys start with `$` is a document, not an operation.
 *
 * Every `$`-keyed object used to read as an attempted field operation, so a
 * JSON Schema (`$schema`, `$id`) or a MongoDB-style export could not be stored
 * in a map at all: the driver refused it as an unknown operator. On a map, only
 * `{ <operator>: … }` with one real operator is an operation now (calls
 * 2026-10-12, S1 / DD-13 option a); every other type keeps the strict reading,
 * so a misspelled `$inc` on a number is still refused rather than written.
 *
 * A real driver over PGlite, through the in-process write path, which is the
 * one that splits operations from values.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { integer, jsonb, pgTable, serial } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";

const docsTable = pgTable("docs", {
    id: serial("id").primaryKey(),
    views: integer("views"),
    schema: jsonb("schema")
});

const docs = {
    name: "Docs",
    slug: "docs",
    table: "docs",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        views: { name: "Views", type: "number" },
        schema: { name: "Schema", type: "map" }
    }
} as CollectionConfig;

let db: PGlite;

function driver(): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([docs]);
    registry.registerTable(docsTable, "docs");
    const orm = drizzle(db, { schema: { docs: docsTable } }) as never;
    return new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
}

async function storedSchema(): Promise<unknown> {
    const result = await db.query<{ schema: unknown }>("SELECT schema FROM docs");
    return result.rows[0]?.schema;
}

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec("CREATE TABLE docs (id serial PRIMARY KEY, views integer, schema jsonb);");
});

afterEach(async () => {
    await db.close();
});

describe("a map value with `$` keys", () => {
    it("is stored as sent on a create", async () => {
        const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", $id: "doc", type: "object" };
        await driver().save({ path: "docs", status: "new", collection: docs, values: { views: 0, schema } });
        expect(await storedSchema()).toEqual(schema);
    });

    it("is stored as sent on an update, a single `$` key included", async () => {
        const created = await driver().save({ path: "docs", status: "new", collection: docs, values: { views: 0 } });
        await driver().save({
            path: "docs", id: created.id, status: "existing", collection: docs,
            values: { schema: { $ref: "#/defs/a" } }
        });
        expect(await storedSchema()).toEqual({ $ref: "#/defs/a" });

        await driver().save({
            path: "docs", id: created.id, status: "existing", collection: docs,
            values: { schema: { $comment: "only key" } }
        });
        expect(await storedSchema()).toEqual({ $comment: "only key" });
    });

    it("is still an operation when it is one real operator", async () => {
        const created = await driver().save({ path: "docs", status: "new", collection: docs, values: { schema: { a: 1 } } });
        await driver().save({
            path: "docs", id: created.id, status: "existing", collection: docs,
            values: { schema: { $merge: { b: 2 } } }
        });
        expect(await storedSchema()).toEqual({ a: 1, b: 2 });
    });

    it("leaves a misspelled operator on a number refused", async () => {
        const created = await driver().save({ path: "docs", status: "new", collection: docs, values: { views: 1 } });
        await expect(driver().save({
            path: "docs", id: created.id, status: "existing", collection: docs,
            values: { views: { $incr: 1 } }
        })).rejects.toMatchObject({ code: "INVALID_FIELD_OPERATION" });
    });
});
