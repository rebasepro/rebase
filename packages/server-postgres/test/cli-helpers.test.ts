import { col, defineTable, rel } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";
import { getDevDatabaseUrl, getTableIncludesFromTables } from "../src/cli-helpers";

describe("CLI Helpers", () => {
    describe("getDevDatabaseUrl", () => {
        it("should parse standard postgres URL and append _dev_diff", () => {
            const dbUrl = "postgresql://user:pass@localhost:5432/my_db";
            expect(getDevDatabaseUrl(dbUrl)).toBe("postgresql://user:pass@localhost:5432/my_db_dev_diff");
        });

        it("should parse postgres URL with query parameters", () => {
            const dbUrl = "postgresql://user:pass@localhost:5432/my_db?sslmode=disable";
            expect(getDevDatabaseUrl(dbUrl)).toBe("postgresql://user:pass@localhost:5432/my_db_dev_diff?sslmode=disable");
        });

        it("should fall back to simple string concatenation on invalid URL", () => {
            const dbUrl = "invalid-url-string";
            expect(getDevDatabaseUrl(dbUrl)).toBe("invalid-url-string_dev_diff");
        });
    });

    describe("getTableIncludesFromTables", () => {
        it("lists every declared table and the junction of a many-to-many", () => {
            const users = defineTable("users", {
                columns: { id: col.uuid().primaryKey(), name: col.text() },
                rls: "admin-only"
            });
            const tags = defineTable("tags", {
                columns: { id: col.uuid().primaryKey() },
                rls: "admin-only"
            });
            const posts = defineTable("posts", {
                columns: { id: col.uuid().primaryKey(), title: col.text() },
                relations: {
                    tags: rel.manyToMany(() => tags, { through: "posts_to_tags" })
                },
                rls: "admin-only"
            });

            const includes = getTableIncludesFromTables(compileTables([users, posts, tags]));
            expect(includes).toContain("public.users");
            expect(includes).toContain("public.posts");
            expect(includes).toContain("public.posts_to_tags");
        });
    });
});
