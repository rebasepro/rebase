import { classifyTable, isRebaseInternalTable, detectJunctionTables } from "../src/table-classification";

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
            expect(mockExecuteSql).toHaveBeenCalled();
        });

        it("should handle empty results", async () => {
            const mockExecuteSql = jest.fn().mockResolvedValue([]);
            const result = await detectJunctionTables(mockExecuteSql);
            expect(result.size).toBe(0);
        });
    });
});
