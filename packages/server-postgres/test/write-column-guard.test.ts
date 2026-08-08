import { pgTable, text, integer } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { assertWritableColumns } from "../src/services/collection-helpers";

/**
 * The premise every unknown-field check in this codebase was built on — "the
 * key travels into the INSERT and Postgres rejects it" — is false. Drizzle
 * builds INSERT from the table's own column list, so a key the table does not
 * carry is left *out of the statement*: the write answers 201 having stored
 * nothing under that name. The two `toSQL()` assertions below are the evidence,
 * pinned here so the premise cannot quietly change under the guard again.
 */
describe("assertWritableColumns", () => {
    const posts = pgTable("posts", {
        id: text("id").primaryKey(),
        title: text("title_col"),
        views: integer("views")
    });

    // No connection is opened: `toSQL()` compiles the statement and stops.
    const db = drizzle({ query: async () => ({ rows: [] }) } as never);

    it("drizzle drops an unknown key from the INSERT instead of raising", () => {
        const { sql } = db.insert(posts).values({ id: "1",
title: "a",
titel: "typo" } as never).toSQL();
        expect(sql).toBe("insert into \"posts\" (\"id\", \"title_col\", \"views\") values ($1, $2, default)");
        expect(sql).not.toContain("titel");
    });

    it("drizzle builds a syntactically broken UPDATE when every key is unknown", () => {
        // `update "posts" set  where …` — SQLSTATE 42601, which is neither
        // class 22 nor 23, so the driver's error mapping calls it a 500. A
        // caller's typo reported as a server fault.
        const { sql } = db.update(posts).set({ titel: "typo" } as never).toSQL();
        expect(sql.trim()).toBe("update \"posts\" set");
    });

    it("accepts a write whose every key is a column", () => {
        expect(() => assertWritableColumns({ id: "1",
title: "a" }, posts, "posts")).not.toThrow();
    });

    it("rejects a key with no column behind it, naming it", () => {
        expect(() => assertWritableColumns({ title: "a",
titel: "typo" }, posts, "posts"))
            .toThrow(/'posts' has no column 'titel'/);
    });

    it("names every unknown key, not just the first", () => {
        expect(() => assertWritableColumns({ titel: 1,
viwes: 2 }, posts, "posts"))
            .toThrow(/has no columns 'titel', 'viwes'/);
    });

    it("keys off the Drizzle property name, not the SQL column name", () => {
        // `title` is declared as `text("title_col")`, and `title` is what a
        // caller writes — Drizzle's own `values()` is keyed the same way.
        expect(() => assertWritableColumns({ title: "a" }, posts, "posts")).not.toThrow();
        expect(() => assertWritableColumns({ title_col: "a" }, posts, "posts")).toThrow(/'title_col'/);
    });

    it("says nothing about a stand-in that is not a Drizzle table", () => {
        // Test doubles and hand-built registry entries carry no column list.
        // Judging a write by the double's own keys would reject it over the
        // shape of the stand-in rather than the shape of the table.
        const notATable = { id: { name: "id" } } as never;
        expect(() => assertWritableColumns({ anything: 1 }, notATable, "posts")).not.toThrow();
    });

    it("does not list the collection's other columns back to the caller", () => {
        // Reachable on paths where the REST field check was skipped, and
        // `excludeFromApi` promises a column is never served to a caller.
        try {
            assertWritableColumns({ titel: "typo" }, posts, "posts");
            throw new Error("should have thrown");
        } catch (error) {
            const message = (error as Error).message;
            expect(message).not.toContain("views");
            expect((error as { statusCode?: number }).statusCode).toBe(400);
            expect((error as { code?: string }).code).toBe("VALIDATION_UNKNOWN_FIELDS");
        }
    });
});
