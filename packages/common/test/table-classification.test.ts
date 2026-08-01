import {
    classifyTable,
    isRebaseInternalTable,
    detectJunctionTables,
    JUNCTION_TABLES_SQL
} from "../src/table-classification";

describe("table-classification", () => {
    describe("classifyTable", () => {
        it("should classify tables in internal schemas as rebase-internal", () => {
            expect(classifyTable("any_table", "rebase")).toBe("rebase-internal");
            expect(classifyTable("any_table", "auth")).toBe("rebase-internal");
        });

        it("should classify tables with internal prefixes as rebase-internal", () => {
            expect(classifyTable("_rebase_logs", "public")).toBe("rebase-internal");
            expect(classifyTable("_auth_sessions", "public")).toBe("rebase-internal");
            expect(classifyTable("drizzle_migrations", "public")).toBe("rebase-internal");
        });

        it("should classify normal tables as user", () => {
            expect(classifyTable("users", "public")).toBe("user");
            expect(classifyTable("posts", "custom_schema")).toBe("user");
        });
    });

    describe("isRebaseInternalTable", () => {
        it("should return true for internal tables", () => {
            expect(isRebaseInternalTable("_rebase_config", "public")).toBe(true);
            expect(isRebaseInternalTable("users", "auth")).toBe(true);
        });

        it("should return false for user tables", () => {
            expect(isRebaseInternalTable("orders", "public")).toBe(false);
        });
    });

    describe("detectJunctionTables", () => {
        it("should return a set of junction table names", async () => {
            const mockExecuteSql = jest.fn().mockResolvedValue([
                { table_name: "posts_tags" },
                { table_name: "users_roles" }
            ]);

            const result = await detectJunctionTables(mockExecuteSql);

            expect(result).toBeInstanceOf(Set);
            expect(result.has("posts_tags")).toBe(true);
            expect(result.has("users_roles")).toBe(true);
            expect(result.size).toBe(2);
            // The rows are a fixture, so `toHaveBeenCalled()` only proved the
            // mock was reached. The query is the part that decides what a
            // junction table is, so assert it is the one that was sent.
            expect(mockExecuteSql).toHaveBeenCalledTimes(1);
            expect(mockExecuteSql).toHaveBeenCalledWith(JUNCTION_TABLES_SQL);
        });

        it("should ignore rows without a string table_name", async () => {
            const mockExecuteSql = jest.fn().mockResolvedValue([
                { table_name: "posts_tags" },
                { table_name: null },
                { table_name: 42 },
                {}
            ]);
            const result = await detectJunctionTables(mockExecuteSql);
            expect([...result]).toEqual(["posts_tags"]);
        });

        it("should handle empty results", async () => {
            const mockExecuteSql = jest.fn().mockResolvedValue([]);
            const result = await detectJunctionTables(mockExecuteSql);
            expect(result.size).toBe(0);
        });
    });

    describe("JUNCTION_TABLES_SQL", () => {
        it("asks for base tables in the public schema whose every column is a foreign key", () => {
            // The definition of a junction table lives in this string and nowhere
            // else, so a silent edit to it is a silent change of meaning.
            const sql = JUNCTION_TABLES_SQL.replace(/\s+/g, " ").trim();
            expect(sql).toContain("FROM information_schema.tables t");
            expect(sql).toContain("t.table_schema = 'public'");
            expect(sql).toContain("t.table_type = 'BASE TABLE'");
            // "no column that is not a foreign-key column" — the double negative
            // is the whole test: dropping the NOT would return every table.
            expect(sql).toContain("AND NOT EXISTS");
            expect(sql).toContain("c.column_name NOT IN");
            expect(sql).toContain("tc.constraint_type = 'FOREIGN KEY'");
            expect(sql).toContain("SELECT t.table_name");
        });
    });
});
