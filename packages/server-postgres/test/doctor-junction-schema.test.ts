/**
 * `rebase doctor` looks for a many-to-many's junction table where the planner
 * puts it.
 *
 * Junctions live in `public` whatever schema the declaring collection is in —
 * `resolveJunctionSpecs` says so, and boot and `db push` create them there. The
 * doctor looked in the collection's own schema instead, so a correctly
 * provisioned `crm.contacts` with a `tags` many-to-many reported
 * `crm.contacts_tags` as missing and failed CI.
 *
 * The database is PGlite, provisioned by the boot ensure itself, behind the
 * `pg.Pool` the doctor opens.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { ensureCollectionTables } from "../src/schema/ensure-collection-tables";
import { checkCollectionsVsDatabase } from "../src/schema/doctor";

let mockDb: PGlite | undefined;
jest.mock("pg", () => {
    class Pool {
        async query(text: string, values?: unknown[]) {
            if (!mockDb) throw new Error("no database");
            const result = await mockDb.query(text, values);
            return { rows: result.rows };
        }
        async end() { /* the test owns the database */ }
    }
    return { Pool };
});

const tags = {
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: {
        id: { type: "string", isId: "uuid" },
        name: { type: "string" }
    }
} as unknown as CollectionConfig;

const contacts = {
    slug: "contacts",
    table: "contacts",
    name: "Contacts",
    schema: "crm",
    properties: {
        id: { type: "string", isId: "uuid" },
        tags: { type: "relation", relation: { kind: "manyToMany", target: () => tags } }
    }
} as unknown as CollectionConfig;

describe("the doctor on a collection outside public with a many-to-many", () => {
    beforeEach(async () => {
        mockDb = new PGlite();
        await mockDb.waitReady;
        await mockDb.exec('CREATE SCHEMA IF NOT EXISTS "rebase";');
    });

    afterEach(async () => {
        await mockDb?.close();
        mockDb = undefined;
    });

    it("finds the junction boot created, in public", async () => {
        const db = mockDb!;
        const outcome = await ensureCollectionTables({
            query: async <T = unknown>(sql: string) => ({ rows: (await db.query<T>(sql)).rows })
        }, [contacts, tags]);
        expect(outcome.failures).toEqual([]);
        const junction = await db.query<{ schema: string }>(
            "SELECT table_schema AS schema FROM information_schema.tables WHERE table_name = 'contacts_tags'"
        );
        expect(junction.rows).toEqual([{ schema: "public" }]);

        const phase = await checkCollectionsVsDatabase([contacts, tags], "postgres://doctor.test/db");
        const missing = phase.issues.filter(issue => issue.category === "missing_table");
        expect(missing).toEqual([]);
    });

    it("still reports the junction when it is absent", async () => {
        const db = mockDb!;
        await ensureCollectionTables({
            query: async <T = unknown>(sql: string) => ({ rows: (await db.query<T>(sql)).rows })
        }, [contacts, tags]);
        await db.exec('DROP TABLE "public"."contacts_tags";');

        const phase = await checkCollectionsVsDatabase([contacts, tags], "postgres://doctor.test/db");
        const missing = phase.issues.filter(issue => issue.category === "missing_table").map(issue => issue.table);
        expect(missing).toEqual(["contacts_tags"]);
    });
});
