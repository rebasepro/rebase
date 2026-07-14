import { describe, expect, it } from "@jest/globals";
import { getTableName, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";

import { buildDrizzleTablesFromSchema, buildDrizzleRelationsFromSchema } from "./dynamic-tables";
import { buildTablesMap, TableColumn, PrimaryKeyRow, ForeignKeyRow } from "./introspect-db-logic";

function column(overrides: Partial<TableColumn> & { table_name: string; column_name: string }): TableColumn {
    return {
        data_type: "text",
        udt_name: "text",
        is_nullable: "YES",
        column_default: null,
        atttypmod: null,
        ...overrides
    };
}

function tablesMapOf(columns: TableColumn[], pks: PrimaryKeyRow[], fks: ForeignKeyRow[] = []) {
    const tableNames = [...new Set(columns.map((c) => c.table_name))].map((table_name) => ({ table_name }));
    return buildTablesMap(tableNames, columns, pks, fks);
}

describe("buildDrizzleTablesFromSchema", () => {
    it("builds a table per introspected table, named after the pg table", () => {
        const tables = buildDrizzleTablesFromSchema(
            tablesMapOf(
                [column({ table_name: "posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" })],
                [{ table_name: "posts", column_name: "id" }]
            )
        );

        expect(Object.keys(tables)).toEqual(["posts"]);
        expect(getTableName(tables.posts)).toBe("posts");
    });

    it("maps pg types onto the matching drizzle column types", () => {
        const tables = buildDrizzleTablesFromSchema(
            tablesMapOf(
                [
                    column({ table_name: "t", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                    column({ table_name: "t", column_name: "count", data_type: "integer", udt_name: "int4" }),
                    column({ table_name: "t", column_name: "big", data_type: "bigint", udt_name: "int8" }),
                    column({ table_name: "t", column_name: "price", data_type: "numeric", udt_name: "numeric" }),
                    column({ table_name: "t", column_name: "active", data_type: "boolean", udt_name: "bool" }),
                    column({ table_name: "t", column_name: "meta", data_type: "jsonb", udt_name: "jsonb" }),
                    column({ table_name: "t", column_name: "created_at", data_type: "timestamp with time zone", udt_name: "timestamptz" }),
                    column({ table_name: "t", column_name: "born_on", data_type: "date", udt_name: "date" })
                ],
                [{ table_name: "t", column_name: "id" }]
            )
        );

        const byName = Object.fromEntries(
            getTableConfig(tables.t).columns.map((c) => [c.name, c.getSQLType()])
        );

        expect(byName.id).toBe("uuid");
        expect(byName.count).toBe("integer");
        expect(byName.big).toBe("bigint");
        expect(byName.price).toBe("numeric");
        expect(byName.active).toBe("boolean");
        expect(byName.meta).toBe("jsonb");
        expect(byName.created_at).toBe("timestamp with time zone");
        expect(byName.born_on).toBe("date");
    });

    it("carries NOT NULL and single-column primary keys onto the columns", () => {
        const tables = buildDrizzleTablesFromSchema(
            tablesMapOf(
                [
                    column({ table_name: "t", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                    column({ table_name: "t", column_name: "title", is_nullable: "NO" }),
                    column({ table_name: "t", column_name: "subtitle", is_nullable: "YES" })
                ],
                [{ table_name: "t", column_name: "id" }]
            )
        );

        const columns = getTableConfig(tables.t).columns;
        const id = columns.find((c) => c.name === "id")!;
        const title = columns.find((c) => c.name === "title")!;
        const subtitle = columns.find((c) => c.name === "subtitle")!;

        expect(id.primary).toBe(true);
        expect(title.notNull).toBe(true);
        expect(title.primary).toBe(false);
        expect(subtitle.notNull).toBe(false);
    });

    it("declares composite primary keys as a table constraint", () => {
        const tables = buildDrizzleTablesFromSchema(
            tablesMapOf(
                [
                    column({ table_name: "posts_tags", column_name: "post_id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                    column({ table_name: "posts_tags", column_name: "tag_id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" })
                ],
                [
                    { table_name: "posts_tags", column_name: "post_id" },
                    { table_name: "posts_tags", column_name: "tag_id" }
                ]
            )
        );

        const config = getTableConfig(tables.posts_tags);
        expect(config.primaryKeys).toHaveLength(1);
        expect(config.primaryKeys[0].columns.map((c) => c.name).sort()).toEqual(["post_id", "tag_id"]);
        // No column should claim the primary key on its own.
        expect(config.columns.every((c) => !c.primary)).toBe(true);
    });

    it("binds tables to a non-public schema", () => {
        const tables = buildDrizzleTablesFromSchema(
            tablesMapOf(
                [column({ table_name: "users", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" })],
                [{ table_name: "users", column_name: "id" }]
            ),
            "rebase"
        );

        expect(getTableConfig(tables.users).schema).toBe("rebase");
    });

    it("falls back to text for unknown types rather than dropping the column", () => {
        const tables = buildDrizzleTablesFromSchema(
            tablesMapOf(
                [
                    column({ table_name: "t", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                    column({ table_name: "t", column_name: "location", data_type: "USER-DEFINED", udt_name: "geography" }),
                    column({ table_name: "t", column_name: "weird", data_type: "USER-DEFINED", udt_name: "some_future_type" })
                ],
                [{ table_name: "t", column_name: "id" }]
            )
        );

        const byName = Object.fromEntries(getTableConfig(tables.t).columns.map((c) => [c.name, c.getSQLType()]));
        expect(byName.location).toBe("text");
        expect(byName.weird).toBe("text");
    });

    it("maps the types a plain type switch tends to miss", () => {
        const tables = buildDrizzleTablesFromSchema(
            tablesMapOf(
                [
                    column({ table_name: "t", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                    column({ table_name: "t", column_name: "blob", data_type: "bytea", udt_name: "bytea" }),
                    column({ table_name: "t", column_name: "span", data_type: "interval", udt_name: "interval" }),
                    column({ table_name: "t", column_name: "ip", data_type: "inet", udt_name: "inet" }),
                    column({ table_name: "t", column_name: "mac", data_type: "macaddr", udt_name: "macaddr" }),
                    column({ table_name: "t", column_name: "code", data_type: "character", udt_name: "bpchar", atttypmod: 14 }),
                    column({ table_name: "t", column_name: "name", data_type: "character varying", udt_name: "varchar", atttypmod: 104 }),
                    column({ table_name: "t", column_name: "clock", data_type: "time with time zone", udt_name: "timetz" }),
                    column({ table_name: "t", column_name: "embedding", data_type: "USER-DEFINED", udt_name: "vector", atttypmod: 3 })
                ],
                [{ table_name: "t", column_name: "id" }]
            )
        );

        const byName = Object.fromEntries(getTableConfig(tables.t).columns.map((c) => [c.name, c.getSQLType()]));

        // bytea has no drizzle builder — a text fallback would corrupt binary.
        expect(byName.blob).toBe("bytea");
        expect(byName.span).toBe("interval");
        expect(byName.ip).toBe("inet");
        expect(byName.mac).toBe("macaddr");
        expect(byName.code).toBe("char(10)");
        expect(byName.name).toBe("varchar(100)");
        expect(byName.clock).toBe("time with time zone");
        expect(byName.embedding).toBe("vector(3)");
    });

    it("types arrays by their element rather than flattening them to text[]", () => {
        const tables = buildDrizzleTablesFromSchema(
            tablesMapOf(
                [
                    column({ table_name: "t", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                    column({ table_name: "t", column_name: "tags", data_type: "ARRAY", udt_name: "_text" }),
                    column({ table_name: "t", column_name: "scores", data_type: "ARRAY", udt_name: "_int4" }),
                    column({ table_name: "t", column_name: "ids", data_type: "ARRAY", udt_name: "_uuid" })
                ],
                [{ table_name: "t", column_name: "id" }]
            )
        );

        const byName = Object.fromEntries(getTableConfig(tables.t).columns.map((c) => [c.name, c.getSQLType()]));

        expect(byName.tags).toBe("text[]");
        expect(byName.scores).toBe("integer[]");
        expect(byName.ids).toBe("uuid[]");
    });

    it("falls back to text for a vector of undeclared width", () => {
        const tables = buildDrizzleTablesFromSchema(
            tablesMapOf(
                [
                    column({ table_name: "t", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                    column({ table_name: "t", column_name: "embedding", data_type: "USER-DEFINED", udt_name: "vector", atttypmod: -1 })
                ],
                [{ table_name: "t", column_name: "id" }]
            )
        );

        const byName = Object.fromEntries(getTableConfig(tables.t).columns.map((c) => [c.name, c.getSQLType()]));
        expect(byName.embedding).toBe("text");
    });

    it("produces tables drizzle can compile into SQL", () => {
        // The real proof: a table object is only useful if the query builder
        // accepts it. Compiling a select exercises the whole construction.
        const tables = buildDrizzleTablesFromSchema(
            tablesMapOf(
                [
                    column({ table_name: "posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                    column({ table_name: "posts", column_name: "title", is_nullable: "NO" })
                ],
                [{ table_name: "posts", column_name: "id" }]
            )
        );

        const db = drizzle({ schema: tables, client: {} as never });
        const query = db.select().from(tables.posts as never).toSQL();

        expect(query.sql).toContain('from "posts"');
        expect(query.sql).toContain('"id"');
        expect(query.sql).toContain('"title"');
    });
});

describe("buildDrizzleRelationsFromSchema", () => {
    const schema = () =>
        tablesMapOf(
            [
                column({ table_name: "authors", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                column({ table_name: "posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                column({ table_name: "posts", column_name: "author_id", data_type: "uuid", udt_name: "uuid" })
            ],
            [
                { table_name: "authors", column_name: "id" },
                { table_name: "posts", column_name: "id" }
            ],
            [{ table_name: "posts", column_name: "author_id", foreign_table_name: "authors", foreign_column_name: "id" }]
        );

    it("pairs each owning one() with the inverse many() drizzle requires", () => {
        // Drizzle's normalizeRelation throws on a named one() with no matching
        // many(), which silently drops the query to the N+1 fallback path.
        const map = schema();
        const tables = buildDrizzleTablesFromSchema(map);
        const rels = buildDrizzleRelationsFromSchema(map, tables);

        expect(Object.keys(rels).sort()).toEqual(["authorsRelations", "postsRelations"]);

        const db = drizzle({ schema: { ...tables, ...rels }, client: {} as never });
        const config = (db as unknown as { _: { schema: Record<string, { relations: Record<string, unknown> }> } })._.schema;

        expect(Object.keys(config.posts.relations)).toEqual(["author"]);
        expect(Object.keys(config.authors.relations)).toEqual(["posts"]);
    });

    it("compiles a relational query that joins the related table", () => {
        const map = schema();
        const tables = buildDrizzleTablesFromSchema(map);
        const rels = buildDrizzleRelationsFromSchema(map, tables);
        const db = drizzle({ schema: { ...tables, ...rels }, client: {} as never });

        const query = (db as never as { query: Record<string, { findMany(a: unknown): { toSQL(): { sql: string } } }> })
            .query.posts.findMany({ with: { author: true } }).toSQL();

        expect(query.sql).toContain('"authors"');
        expect(query.sql).toContain("author_id");
    });

    it("skips a relation whose key would shadow a real column", () => {
        const map = tablesMapOf(
            [
                column({ table_name: "authors", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                column({ table_name: "posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                // A literal "author" column alongside the author_id foreign key.
                column({ table_name: "posts", column_name: "author", data_type: "text", udt_name: "text" }),
                column({ table_name: "posts", column_name: "author_id", data_type: "uuid", udt_name: "uuid" })
            ],
            [
                { table_name: "authors", column_name: "id" },
                { table_name: "posts", column_name: "id" }
            ],
            [{ table_name: "posts", column_name: "author_id", foreign_table_name: "authors", foreign_column_name: "id" }]
        );
        const tables = buildDrizzleTablesFromSchema(map);
        const rels = buildDrizzleRelationsFromSchema(map, tables);

        expect(rels.postsRelations).toBeUndefined();
    });

    it("returns nothing for a schema with no foreign keys", () => {
        const map = tablesMapOf(
            [column({ table_name: "posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" })],
            [{ table_name: "posts", column_name: "id" }]
        );
        expect(buildDrizzleRelationsFromSchema(map, buildDrizzleTablesFromSchema(map))).toEqual({});
    });
});
