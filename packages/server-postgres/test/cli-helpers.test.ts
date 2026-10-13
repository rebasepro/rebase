import { getDevDatabaseUrl, getTableIncludesFromCollections } from "../src/cli-helpers";

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

    describe("getTableIncludesFromCollections", () => {
        it("should parse collections and return correct includes array", async () => {
            const mockCollections = [
                {
                    slug: "users",
                    table: "users",
                    properties: {
                        name: { type: "string" }
                    }
                },
                {
                    slug: "posts",
                    table: "posts",
                    properties: {
                        title: { type: "string" }
                    },
                    relations: [
                        {
                            kind: "manyToMany",
                            relationName: "tags",
                            target: () => ({ table: "tags", slug: "tags" }),
                            through: {
                                table: "posts_to_tags",
                                sourceColumn: "post_id",
                                targetColumn: "tag_id"
                            }
                        }
                    ]
                }
            ];

            const includes = await getTableIncludesFromCollections(mockCollections);
            expect(includes).toContain("public.users");
            expect(includes).toContain("public.posts");
            expect(includes).toContain("public.posts_to_tags");
        });
    });
});
