/**
 * `rebase doctor` reads the database the way the planner built it.
 *
 * Two places it did not, each found against a real database:
 *
 *  - **Long enum names.** An enum type is named `<table>_<column>` and Postgres
 *    keeps 63 bytes of it. The planner truncates the same way; the doctor looked
 *    up the full name, so every enum on a long column was "missing" and its
 *    remedy — `rebase db push` — could never clear it. It also matched a type of
 *    the same name in any schema.
 *  - **Primary keys.** `id` sat in a skip list, so a collection whose key type
 *    or key column disagreed with the table read "In sync". So did a table
 *    keyed on two columns that the collection reads by a phantom `id`, and a
 *    junction whose key columns had drifted.
 *
 * The database is PGlite, provisioned by the boot ensure itself, behind the
 * `pg.Pool` the doctor opens.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { ensureCollectionTables } from "../src/schema/ensure-collection-tables";
import { checkCollectionsVsDatabase, type DoctorIssue } from "../src/schema/doctor";

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

const LONG_COLUMN = "a_status_column_with_quite_a_long_name_that_keeps_going_on";

const longThings = {
    slug: "long_things",
    table: "long_things_tbl",
    name: "Long things",
    properties: {
        id: { type: "string", isId: "uuid" },
        [LONG_COLUMN]: { type: "string", enum: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] }
    }
} as unknown as CollectionConfig;

const categories = (isId: "increment" | "uuid") => ({
    slug: "categories",
    table: "categories",
    name: "Categories",
    properties: {
        id: isId === "increment" ? { type: "number", isId: "increment" } : { type: "string", isId: "uuid" },
        title: { type: "string" }
    }
}) as unknown as CollectionConfig;

const people = {
    slug: "people",
    table: "people",
    name: "People",
    properties: {
        id: { type: "string", isId: "uuid" },
        categories: { type: "relation", relation: { kind: "manyToMany", target: () => categories("increment") } }
    }
} as unknown as CollectionConfig;

/** A collection over a table keyed on two columns, as introspection used to write it. */
const orderLines = {
    slug: "order_lines",
    table: "order_lines",
    name: "Order lines",
    properties: {
        orderId: { type: "number", columnName: "order_id" },
        lineNo: { type: "number", columnName: "line_no" },
        qty: { type: "number", validation: { integer: true } }
    }
} as unknown as CollectionConfig;

const DATABASE_URL = "postgres://doctor.test/db";
const issuesOf = async (collections: CollectionConfig[]): Promise<DoctorIssue[]> =>
    (await checkCollectionsVsDatabase(collections, DATABASE_URL)).issues;

describe("the doctor against the database the planner built", () => {
    beforeEach(async () => {
        mockDb = new PGlite();
        await mockDb.waitReady;
        await mockDb.exec('CREATE SCHEMA IF NOT EXISTS "rebase";');
    });

    afterEach(async () => {
        await mockDb?.close();
        mockDb = undefined;
    });

    it("finds an enum whose derived name Postgres cut to 63 bytes", async () => {
        await ensureCollectionTables(mockDb!, [longThings]);
        const issues = await issuesOf([longThings]);
        expect(issues.filter(i => i.category === "missing_enum" || i.category === "enum_value_mismatch")).toEqual([]);
    });

    it("does not take a same-named enum in another schema for this one", async () => {
        const tags = {
            slug: "tags",
            table: "tags",
            name: "Tags",
            properties: {
                id: { type: "string", isId: "uuid" },
                kind: { type: "string", enum: [{ id: "a", label: "A" }] }
            }
        } as unknown as CollectionConfig;
        await ensureCollectionTables(mockDb!, [tags]);
        // The collection's own type is gone; a stranger with its name remains.
        await mockDb!.exec(`
            ALTER TABLE "public"."tags" ALTER COLUMN "kind" TYPE text;
            DROP TYPE "public"."tags_kind";
            CREATE SCHEMA "elsewhere";
            CREATE TYPE "elsewhere"."tags_kind" AS ENUM ('a');
        `);
        const issues = await issuesOf([tags]);
        expect(issues.some(i => i.category === "missing_enum" && i.column === "kind")).toBe(true);
    });

    it("reports a key whose type no longer matches the collection's", async () => {
        await ensureCollectionTables(mockDb!, [categories("increment")]);
        const issues = await issuesOf([categories("uuid")]);
        const id = issues.find(i => i.column === "id");
        expect(id).toMatchObject({ category: "type_mismatch", table: "categories", expected: "uuid", actual: "integer" });
    });

    it("reports a table keyed on columns the collection does not read it by", async () => {
        await mockDb!.exec(`
            CREATE TABLE "public"."order_lines" (
                "order_id" integer NOT NULL,
                "line_no" integer NOT NULL,
                "qty" integer,
                PRIMARY KEY ("order_id", "line_no")
            );
        `);
        const issues = await issuesOf([orderLines]);
        const key = issues.find(i => i.category === "primary_key_mismatch");
        expect(key).toMatchObject({ severity: "error", table: "order_lines", expected: "id", actual: "order_id, line_no" });
    });

    it("reports a table with no primary key at all", async () => {
        await ensureCollectionTables(mockDb!, [categories("increment")]);
        await mockDb!.exec(`ALTER TABLE "public"."categories" DROP CONSTRAINT "categories_pkey";`);
        const issues = await issuesOf([categories("increment")]);
        const key = issues.find(i => i.category === "primary_key_mismatch");
        expect(key).toMatchObject({ severity: "error", table: "categories", expected: "id", actual: "(none)" });
        expect(key?.fix).toContain('ALTER TABLE "public"."categories" ADD PRIMARY KEY ("id");');
    });

    it("compares a junction's key columns against the keys they point at", async () => {
        await ensureCollectionTables(mockDb!, [people, categories("increment")]);
        expect((await issuesOf([people, categories("increment")])).filter(i => i.severity !== "info")).toEqual([]);

        await mockDb!.exec(`
            ALTER TABLE "public"."categories_people" DROP CONSTRAINT "categories_people_category_id_fkey";
            ALTER TABLE "public"."categories_people" ALTER COLUMN "category_id" TYPE text;
        `);
        const issues = await issuesOf([people, categories("increment")]);
        expect(issues.find(i => i.table === "categories_people" && i.column === "category_id"))
            .toMatchObject({ category: "type_mismatch", expected: "integer", actual: "text" });
    });

    it("says nothing about a database the planner would leave as it is", async () => {
        const all = [longThings, people, categories("increment")];
        await ensureCollectionTables(mockDb!, all);
        expect((await issuesOf(all)).filter(i => i.severity !== "info")).toEqual([]);
    });
});
