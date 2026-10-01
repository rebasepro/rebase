
import { describe, it, expect } from "@jest/globals";
import { acceptsAutoLimit, buildExplainSql, needsDestructiveConfirmation, quoteIdentifier, quoteTableName, resolveCellEdit, resolveQueryCollections, type ResultProvenance } from "./sql_utils";
import type { SqlScriptColumn, SqlScriptTable } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * The provenance below is what Postgres 18 reports for each query — the
 * `tableID`/`columnID` of every field of its row description, named — read
 * from a live server with `proofs/studio-sql/fields.mjs`. A computed column
 * has no source; a column of a join has the source of the side it came from;
 * a self-join's two sides are one table.
 */
const table = (name: string, primaryKey: string[], extra: Partial<SqlScriptTable> = {}): SqlScriptTable =>
    ({ schema: "public", table: name, kind: "table", primaryKey, hasInheritors: false, ...extra });
const read = (name: string, from: string, column: string = name, schema = "public"): SqlScriptColumn =>
    ({ name, source: { schema, table: from, column } });
const computed = (name: string): SqlScriptColumn => ({ name });

const posts = table("posts", ["id"]);
const authors = table("authors", ["id"]);
const users = table("users", ["id"]);

/**
 * The critical case. Editing a cell of a join wrote to the edited table with
 * a key read from the other one: `UPDATE "authors" SET "name" = … WHERE "id"
 * = <the post's id>` overwrote whichever author shared the post's id.
 */
describe("editing a cell of a join", () => {
    const sql = "SELECT p.id, a.name FROM posts p JOIN authors a ON a.id = p.author_id";
    const provenance: ResultProvenance = { columns: [read("id", "posts"), read("name", "authors")], tables: [posts, authors] };

    it("refuses a column whose table's key is not in the result", () => {
        const resolution = resolveCellEdit(sql, provenance, "name");
        expect(resolution.target).toBeUndefined();
        expect(resolution.refusal).toEqual({ key: "studio_sql_edit_key_missing", params: { table: "public.authors", columns: "id" } });
    });

    it("still edits the table whose key is there", () => {
        expect(resolveCellEdit(sql, provenance, "id").target).toEqual({
            schema: "public", table: "posts", column: "id", key: [{ column: "id", resultColumn: "id" }]
        });
    });

    it("edits the other table once its own key is selected, under its own name", () => {
        const both = "SELECT p.id, a.id AS author_key, a.name FROM posts p JOIN authors a ON a.id = p.author_id";
        const resolution = resolveCellEdit(both, {
            columns: [read("id", "posts"), read("author_key", "authors", "id"), read("name", "authors")],
            tables: [posts, authors]
        }, "name");
        expect(resolution.target).toEqual({
            schema: "public", table: "authors", column: "name", key: [{ column: "id", resultColumn: "author_key" }]
        });
    });

    it("refuses when two columns of the result share the edited name or the key's", () => {
        const star = "SELECT * FROM posts p JOIN authors a ON a.id = p.author_id";
        const starProvenance: ResultProvenance = {
            columns: [read("id", "posts"), read("author_id", "posts"), read("title", "posts"), read("id", "authors"), read("name", "authors")],
            tables: [posts, authors]
        };
        expect(resolveCellEdit(star, starProvenance, "title").refusal?.key).toBe("studio_sql_edit_key_missing");
        expect(resolveCellEdit(star, starProvenance, "name").refusal?.key).toBe("studio_sql_edit_key_missing");
        expect(resolveCellEdit(star, starProvenance, "id").refusal?.key).toBe("studio_sql_edit_duplicate_column");
    });

    it("refuses a self-join, whose two sides the database reports as one table", () => {
        const resolution = resolveCellEdit(
            "SELECT a.id, b.name FROM authors a JOIN authors b ON b.id = a.mentor_id",
            { columns: [read("id", "authors"), read("name", "authors")], tables: [authors] },
            "name"
        );
        expect(resolution.refusal).toEqual({ key: "studio_sql_edit_table_read_twice", params: { table: "authors" } });
    });

    it("refuses a table read once inside a WITH query that is read twice", () => {
        const resolution = resolveCellEdit(
            "WITH x AS (SELECT * FROM posts) SELECT a.id, b.title FROM x a JOIN x b ON b.author_id = a.id",
            { columns: [read("id", "posts"), read("title", "posts")], tables: [posts] },
            "title"
        );
        expect(resolution.refusal?.key).toBe("studio_sql_edit_table_read_twice");
    });

    it("refuses a table read again in a subquery, however deep", () => {
        const resolution = resolveCellEdit(
            "SELECT id, title FROM posts WHERE author_id IN (SELECT author_id FROM public.posts WHERE id = 1)",
            { columns: [read("id", "posts"), read("title", "posts")], tables: [posts] },
            "title"
        );
        expect(resolution.refusal?.key).toBe("studio_sql_edit_table_read_twice");
    });
});

/**
 * A computed column was written to the real column of the same name: `SELECT
 * id, lower(email) AS name FROM users` edited `name` → `UPDATE users SET name`.
 */
describe("editing a computed column", () => {
    it("refuses an expression, a literal and an aggregate — the database gives them no source", () => {
        const sql = "SELECT id, lower(email) AS name, 'archived' AS status, count(*) OVER () AS total FROM users";
        const provenance: ResultProvenance = {
            columns: [read("id", "users"), computed("name"), computed("status"), computed("total")],
            tables: [users]
        };
        for (const column of ["name", "status", "total"]) {
            expect(resolveCellEdit(sql, provenance, column).refusal).toEqual({ key: "studio_sql_edit_computed_column", params: { column } });
        }
    });

    it("refuses every column when nothing about the result is known", () => {
        const resolution = resolveCellEdit("SELECT * FROM users", { columns: [{ name: "id" }, { name: "email" }], tables: [] }, "email");
        expect(resolution.refusal?.key).toBe("studio_sql_edit_computed_column");
    });
});

describe("editing a plain table", () => {
    it("writes the column the database named, under whatever alias the query gave it", () => {
        const resolution = resolveCellEdit(
            "SELECT u.email AS user_email, u.id FROM users u",
            { columns: [read("user_email", "users", "email"), read("id", "users")], tables: [users] },
            "user_email"
        );
        expect(resolution.target).toEqual({
            schema: "public", table: "users", column: "email", key: [{ column: "id", resultColumn: "id" }]
        });
    });

    it("keeps every column of a composite key, in key order", () => {
        const orderItems = table("order_items", ["order_id", "item_id"]);
        const resolution = resolveCellEdit(
            "SELECT quantity, item_id, order_id FROM order_items",
            { columns: [read("quantity", "order_items"), read("item_id", "order_items"), read("order_id", "order_items")], tables: [orderItems] },
            "quantity"
        );
        expect(resolution.target?.key).toEqual([
            { column: "order_id", resultColumn: "order_id" },
            { column: "item_id", resultColumn: "item_id" }
        ]);
    });

    it("keeps the schema the database reported, whatever the query left to the search path", () => {
        const archived = table("orders", ["order_no"], { schema: "archive" });
        const resolution = resolveCellEdit(
            "SELECT * FROM orders",
            { columns: [read("order_no", "orders", "order_no", "archive"), read("status", "orders", "status", "archive")], tables: [archived] },
            "status"
        );
        expect(resolution.target?.schema).toBe("archive");
        expect(quoteTableName(resolution.target!.table, resolution.target!.schema)).toBe("\"archive\".\"orders\"");
    });

    it("reads through a subquery and a WITH query used once", () => {
        const provenance: ResultProvenance = { columns: [read("id", "posts"), read("title", "posts")], tables: [posts] };
        expect(resolveCellEdit("SELECT s.* FROM (SELECT id, title FROM posts) s", provenance, "title").target?.column).toBe("title");
        expect(resolveCellEdit("WITH x AS (SELECT id, title FROM posts) SELECT * FROM x", provenance, "title").target?.column).toBe("title");
    });
});

describe("tables whose rows a key cannot find", () => {
    it("refuses a view, a table with no primary key, and a table others inherit", () => {
        const view = resolveCellEdit("SELECT * FROM post_view", {
            columns: [read("id", "post_view"), read("title", "post_view")],
            tables: [table("post_view", [], { kind: "view" })]
        }, "title");
        expect(view.refusal).toEqual({ key: "studio_sql_edit_not_a_table", params: { column: "title", table: "public.post_view" } });

        const keyless = resolveCellEdit("SELECT * FROM settings", {
            columns: [read("key", "settings"), read("value", "settings")],
            tables: [table("settings", [])]
        }, "value");
        expect(keyless.refusal).toEqual({ key: "studio_sql_edit_no_primary_key", params: { table: "public.settings" } });

        const inherited = resolveCellEdit("SELECT * FROM events", {
            columns: [read("id", "events"), read("kind", "events")],
            tables: [table("events", ["id"], { hasInheritors: true })]
        }, "kind");
        expect(inherited.refusal?.key).toBe("studio_sql_edit_inherited_table");
    });

    it("edits a partitioned table by its key", () => {
        const resolution = resolveCellEdit("SELECT * FROM measurements", {
            columns: [read("id", "measurements"), read("taken_at", "measurements"), read("value", "measurements")],
            tables: [table("measurements", ["id", "taken_at"], { kind: "partitioned table" })]
        }, "value");
        expect(resolution.target?.table).toBe("measurements");
    });
});

describe("what is not a single read", () => {
    const provenance: ResultProvenance = { columns: [read("id", "posts"), read("title", "posts")], tables: [posts] };

    it("refuses a script, a write and a write inside a WITH query", () => {
        expect(resolveCellEdit("SELECT 1; SELECT id, title FROM posts", provenance, "title").refusal?.key).toBe("studio_sql_edit_not_a_select");
        expect(resolveCellEdit("UPDATE posts SET title = title RETURNING id, title", provenance, "title").refusal?.key).toBe("studio_sql_edit_not_a_select");
        expect(resolveCellEdit("WITH d AS (DELETE FROM posts RETURNING *) SELECT * FROM d", provenance, "title").refusal?.key).toBe("studio_sql_edit_not_a_select");
    });

    it("refuses text it cannot read", () => {
        expect(resolveCellEdit("SELECT id, title FROM posts WHERE ???", provenance, "title").refusal?.key).toBe("studio_sql_edit_unreadable_query");
    });
});

describe("quoteIdentifier", () => {
    it("doubles every double quote, so a name cannot end the identifier", () => {
        expect(quoteIdentifier("weird\"col")).toBe("\"weird\"\"col\"");
        expect(quoteTableName("t\"x", "s\"y")).toBe("\"s\"\"y\".\"t\"\"x\"");
    });
});

describe("resolveQueryCollections", () => {
    const collections = [
        { slug: "users", name: "Users", table: "users", properties: {} },
        { slug: "posts", name: "Posts", table: "posts", properties: {} },
        { slug: "authors", name: "Authors", table: "authors", properties: {} }
    ] as unknown as AdminCollection[];

    it("offers a table's records only by the key the database says is that table's", () => {
        const matched = resolveQueryCollections({ columns: [read("id", "posts"), read("name", "authors")], tables: [posts, authors] }, collections);
        expect(matched.map(m => [m.tableName, m.pkColumn])).toEqual([["posts", "id"]]);
    });

    it("offers both sides of a join once each key has a name of its own", () => {
        const matched = resolveQueryCollections({
            columns: [read("post_id", "posts", "id"), read("author_key", "authors", "id")],
            tables: [posts, authors]
        }, collections);
        expect(matched.map(m => [m.tableName, m.pkColumn])).toEqual([["posts", "post_id"], ["authors", "author_key"]]);
    });

    it("does not offer a key column another column of the result shares a name with", () => {
        const matched = resolveQueryCollections({ columns: [read("id", "posts"), read("id", "authors")], tables: [posts, authors] }, collections);
        expect(matched).toEqual([]);
    });

    it("does not match a collection's table in another schema", () => {
        const archivedUsers = table("users", ["id"], { schema: "archive" });
        expect(resolveQueryCollections({ columns: [read("id", "users", "id", "archive")], tables: [archivedUsers] }, collections)).toEqual([]);
    });
});

describe("buildExplainSql", () => {
    it("plans one statement, without ANALYZE", () => {
        expect(buildExplainSql("DELETE FROM users WHERE id = 1;")).toBe("EXPLAIN (FORMAT JSON) DELETE FROM users WHERE id = 1");
    });

    it("refuses more than one statement", () => {
        expect(buildExplainSql("SELECT 1; DELETE FROM users")).toBeNull();
    });

    it("refuses text it cannot parse when a semicolon could hide a second statement", () => {
        // `CREATE TABLE … AS` is beyond the parser, so only the `;` can tell.
        expect(buildExplainSql("CREATE TABLE x AS SELECT 1; DROP TABLE users")).toBeNull();
        expect(buildExplainSql("CREATE TABLE x AS SELECT 1")).toBe("EXPLAIN (FORMAT JSON) CREATE TABLE x AS SELECT 1");
    });

    it("refuses an empty buffer", () => {
        expect(buildExplainSql("  ;  ")).toBeNull();
    });
});

describe("acceptsAutoLimit", () => {
    it("accepts one SELECT with no limit of its own", () => {
        expect(acceptsAutoLimit("SELECT * FROM users;")).toBe(true);
        expect(acceptsAutoLimit("SELECT * FROM users LIMIT 5")).toBe(false);
    });

    it("refuses a write that contains a SELECT", () => {
        expect(acceptsAutoLimit("INSERT INTO archive SELECT * FROM users")).toBe(false);
        expect(acceptsAutoLimit("WITH gone AS (DELETE FROM users RETURNING *) SELECT * FROM gone")).toBe(false);
    });

    it("refuses a script, and text it cannot parse", () => {
        expect(acceptsAutoLimit("SELECT 1; DELETE FROM users WHERE id = 1")).toBe(false);
        expect(acceptsAutoLimit("CREATE TABLE copy AS SELECT * FROM users")).toBe(false);
    });
});

describe("needsDestructiveConfirmation", () => {
    it("asks for a DELETE or UPDATE without WHERE, whatever else the text holds", () => {
        expect(needsDestructiveConfirmation("DELETE FROM posts")).toBe(true);
        expect(needsDestructiveConfirmation("DELETE FROM posts; SELECT * FROM posts WHERE id = 1")).toBe(true);
        expect(needsDestructiveConfirmation("-- clean up where needed\nDELETE FROM posts")).toBe(true);
        expect(needsDestructiveConfirmation("UPDATE users SET role = 'admin'; SELECT * FROM users WHERE id = 1")).toBe(true);
        expect(needsDestructiveConfirmation("WITH gone AS (DELETE FROM posts RETURNING id) SELECT count(*) FROM gone")).toBe(true);
    });

    it("asks for a drop or a truncate, with or without WHERE elsewhere", () => {
        expect(needsDestructiveConfirmation("DROP TABLE posts")).toBe(true);
        expect(needsDestructiveConfirmation("TRUNCATE posts; SELECT * FROM users WHERE id = 1")).toBe(true);
        expect(needsDestructiveConfirmation("ALTER TABLE posts DROP COLUMN title")).toBe(true);
    });

    it("asks for text it cannot read that names a destructive command", () => {
        expect(needsDestructiveConfirmation("DROP SCHEMA archive CASCADE")).toBe(true);
        expect(needsDestructiveConfirmation("DELETE FROM posts USING users WHERE posts.author_id = users.id")).toBe(true);
    });

    it("does not ask for a filtered DELETE or UPDATE, or a read", () => {
        expect(needsDestructiveConfirmation("DELETE FROM posts WHERE id = 1")).toBe(false);
        expect(needsDestructiveConfirmation("UPDATE posts SET title = 'x' WHERE id = 1; SELECT 1")).toBe(false);
        expect(needsDestructiveConfirmation("SELECT updated_at FROM posts")).toBe(false);
        expect(needsDestructiveConfirmation("-- delete these later\nSELECT * FROM posts")).toBe(false);
    });
});
