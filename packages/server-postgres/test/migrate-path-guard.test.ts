/**
 * `rebase db migrate` stops before Atlas runs on a database boot or `db push`
 * set up without migrations, and names the `--baseline` to run; `db push` says
 * so in one line on a database that records migrations.
 *
 * Without the guard, the first migration failed part-way through on
 * `type "posts_status" already exists (42710)`.
 */
import { PGlite } from "@electric-sql/pglite";
import {
    existingTables,
    provisionedWithoutHistoryProblem,
    pushOnMigratedDatabaseNote,
    tablesCreatedBy,
    type TableQueryable
} from "../src/schema/migrate-path-guard";

const INIT = [
    "-- Create enum type \"posts_status\"",
    "CREATE TYPE \"public\".\"posts_status\" AS ENUM ('draft', 'published');",
    "-- Create \"authors\" table",
    "CREATE TABLE \"public\".\"authors\" (\"id\" uuid NOT NULL, PRIMARY KEY (\"id\"));",
    "CREATE TABLE \"public\".\"posts\" (\"id\" uuid NOT NULL);",
    "CREATE TABLE IF NOT EXISTS \"public\".\"tags\" (\"id\" uuid NOT NULL);",
    "create table rebase.Audit (id int);",
    "CREATE UNLOGGED TABLE \"Weird\"\"Name\" (id int);",
    "ALTER TABLE \"public\".\"posts\" ADD COLUMN \"title\" text;"
].join("\n");

describe("tablesCreatedBy", () => {
    it("reads each plain CREATE TABLE, qualified or not, and skips IF NOT EXISTS", () => {
        expect(tablesCreatedBy(INIT)).toEqual([
            { schema: "public", table: "authors" },
            { schema: "public", table: "posts" },
            { schema: "rebase", table: "audit" },
            { schema: "public", table: "Weird\"Name" }
        ]);
    });

    it("finds nothing in a migration that only alters", () => {
        expect(tablesCreatedBy("ALTER TABLE \"public\".\"posts\" ADD COLUMN \"x\" text;")).toEqual([]);
    });
});

describe("provisionedWithoutHistoryProblem", () => {
    const posts = { schema: "public", table: "posts" };
    const authors = { schema: "public", table: "authors" };

    it("refuses, and names the baseline, on a provisioned database with no history", () => {
        const problem = provisionedWithoutHistoryProblem({
            latestRecorded: null,
            existing: [authors, posts],
            newestVersion: "20261122101530"
        });
        expect(problem).not.toBeNull();
        const lines = (problem ?? "").split("\n");
        expect(lines[0]).toBe(
            "This database already has the tables your migrations create, and records no migration as applied. Nothing was run."
        );
        expect(lines[1]).toContain("\"authors\" and \"posts\" are there");
        expect(lines).toContain("  rebase db migrate --baseline 20261122101530");
    });

    it("names three tables and counts the rest", () => {
        const many = ["a", "b", "c", "d", "e"].map(table => ({ schema: "public", table }));
        const problem = provisionedWithoutHistoryProblem({ latestRecorded: null, existing: many, newestVersion: "1" });
        expect(problem).toContain("\"a\", \"b\", \"c\" and 2 more are there");
    });

    it("says nothing on a database that records migrations", () => {
        expect(provisionedWithoutHistoryProblem({ latestRecorded: "1", existing: [posts], newestVersion: "2" })).toBeNull();
    });

    it("says nothing on an empty database", () => {
        expect(provisionedWithoutHistoryProblem({ latestRecorded: null, existing: [], newestVersion: "2" })).toBeNull();
    });
});

describe("pushOnMigratedDatabaseNote", () => {
    it("is one sentence naming the migration path on a migrated database", () => {
        const note = pushOnMigratedDatabaseNote("20261122101530");
        expect(note).toContain("newest recorded: 20261122101530");
        expect(note).toContain("`rebase db generate` and `rebase db migrate`");
        expect(note?.split(". ").length).toBe(1);
    });

    it("is nothing on a database with no migration history", () => {
        expect(pushOnMigratedDatabaseNote(null)).toBeNull();
    });
});

describe("existingTables", () => {
    let db: PGlite;
    const client: TableQueryable = {
        query: async <R extends Record<string, unknown>>(text: string, params?: unknown[]) => {
            const result = await db.query<R>(text, params);
            return { rows: result.rows };
        }
    };

    beforeAll(async () => {
        db = new PGlite();
        await db.exec("CREATE SCHEMA rebase; CREATE TABLE public.posts (id int); CREATE TABLE rebase.audit (id int); CREATE TABLE \"Weird\"\"Name\" (id int);");
    });

    afterAll(async () => {
        await db.close();
    });

    it("returns the ones the database already has, in order, case and quotes kept", async () => {
        const found = await existingTables(client, tablesCreatedBy(INIT));
        expect(found).toEqual([
            { schema: "public", table: "posts" },
            { schema: "rebase", table: "audit" },
            { schema: "public", table: "Weird\"Name" }
        ]);
    });

    it("queries nothing for no tables", async () => {
        expect(await existingTables(client, [])).toEqual([]);
    });
});
