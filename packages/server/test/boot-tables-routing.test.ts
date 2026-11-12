import { col, defineTable, type AnyTableDef } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";
import { tablesStoredBy } from "../src/boot/provision";

/**
 * Which tables boot hands to a data source's bootstrapper.
 *
 * A schema holds every table the project declares, whatever database stores
 * it. Boot used to hand all of them to the primary source, so a table routed
 * to `database("analytics")` was created in the default database — where
 * nothing reads it — and the analytics one stayed empty.
 *
 * (Engine routing is gone with the collection model: a Firestore definition
 * lives in `frontend/src/cms` and never reaches the backend, so every table
 * here is a Postgres table.)
 */

const table = (slug: string, database?: string): AnyTableDef => defineTable(slug, {
    columns: { id: col.uuid().primaryKey() },
    rls: "admin-only",
    ...(database ? { database } : {})
});

describe("tablesStoredBy", () => {
    it("keeps a table that names no database for the default source", () => {
        const tables = compileTables([table("users")]);
        expect(tablesStoredBy(tables, "(default)")).toEqual(tables);
    });

    it("hands a second source its own tables, and nothing else", () => {
        const tables = compileTables([table("users"), table("events", "analytics")]);

        expect(tablesStoredBy(tables, "(default)").map(t => t.slug)).toEqual(["users"]);
        expect(tablesStoredBy(tables, "analytics").map(t => t.slug)).toEqual(["events"]);
    });

    it("hands a source no table routed elsewhere", () => {
        const tables = compileTables([table("facts", "warehouse")]);

        expect(tablesStoredBy(tables, "(default)")).toEqual([]);
        expect(tablesStoredBy(tables, "analytics")).toEqual([]);
    });
});
