import { describe, expect, it } from "@jest/globals";
import { getTableName, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";

import { buildDrizzleTablesFromSchema } from "./dynamic-tables";
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
                    column({ table_name: "t", column_name: "tags", data_type: "ARRAY", udt_name: "_text" })
                ],
                [{ table_name: "t", column_name: "id" }]
            )
        );

        const names = getTableConfig(tables.t).columns.map((c) => c.name);
        expect(names).toEqual(expect.arrayContaining(["location", "tags"]));
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
