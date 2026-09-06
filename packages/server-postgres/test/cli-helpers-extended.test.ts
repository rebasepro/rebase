import { getDevDatabaseUrl, getTableExcludes, getTableIncludesFromCollections } from "../src/cli-helpers";
import { CollectionConfig } from "@rebasepro/types";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ── Mock pg globally so dynamic import("pg") resolves to our mock ────────

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockEnd = jest.fn();

jest.mock("pg", () => ({
    Client: jest.fn().mockImplementation(() => ({
        connect: mockConnect,
        query: mockQuery,
        end: mockEnd,
    })),
}));

describe("CLI Helpers — Extended", () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ── getDevDatabaseUrl ────────────────────────────────────────────────

    describe("getDevDatabaseUrl", () => {

        it("should handle password with special characters (@ in password)", () => {
            // The URL class percent-encodes special chars, so the output may differ slightly
            const dbUrl = "postgresql://user:p%40ss@localhost:5432/mydb";
            const result = getDevDatabaseUrl(dbUrl);
            expect(result).toContain("mydb_dev_diff");
            expect(result).toContain("p%40ss");
            expect(result).toContain("localhost:5432");
        });

        it("should handle password with encoded special characters", () => {
            const dbUrl = "postgresql://admin:p%23word%21@db.host.com:5432/production";
            const result = getDevDatabaseUrl(dbUrl);
            expect(result).toContain("production_dev_diff");
            expect(result).toContain("p%23word%21");
        });

        it("should handle URL with multiple query parameters", () => {
            const dbUrl = "postgresql://user:pass@localhost:5432/testdb?sslmode=require&connect_timeout=10";
            const result = getDevDatabaseUrl(dbUrl);
            expect(result).toBe("postgresql://user:pass@localhost:5432/testdb_dev_diff?sslmode=require&connect_timeout=10");
        });

        it("should handle URL without port", () => {
            const dbUrl = "postgresql://user:pass@localhost/mydb";
            const result = getDevDatabaseUrl(dbUrl);
            expect(result).toContain("mydb_dev_diff");
        });

        it("should handle URL with path containing only the database name", () => {
            const dbUrl = "postgres://u:p@host:5432/db_name";
            const result = getDevDatabaseUrl(dbUrl);
            expect(result).toContain("db_name_dev_diff");
        });

        it("should fall back to concatenation for totally invalid URLs", () => {
            expect(getDevDatabaseUrl("")).toBe("_dev_diff");
            expect(getDevDatabaseUrl("just-some-text")).toBe("just-some-text_dev_diff");
        });
    });

    // ── resolveLocalBin ─────────────────────────────────────────────────

    describe("resolveLocalBin", () => {
        // We test this function by using real fs — we just pick a binary
        // that is known to exist (like "jest") vs. one that doesn't.

        it("should find a binary that exists in node_modules/.bin", () => {
            const { resolveLocalBin } = require("../src/cli-helpers");
            // "jest" is running this very test, so it is by definition installed
            // in a node_modules/.bin above the source directory. Guarding these
            // assertions behind `if (result !== null)` — as this test used to —
            // turns the interesting failure (the upward walk stops early and
            // finds nothing) into a silent pass.
            const result = resolveLocalBin("jest");
            expect(result).not.toBeNull();
            expect(typeof result).toBe("string");
            expect(result).toContain(path.join("node_modules", ".bin", "jest"));
            expect(fs.existsSync(result)).toBe(true);
        });

        it("should return null for a binary that definitely does not exist", () => {
            const { resolveLocalBin } = require("../src/cli-helpers");
            const result = resolveLocalBin("__nonexistent_binary_xyz_12345__");
            expect(result).toBeNull();
        });
    });

    // ── ensureDevDatabaseExists ─────────────────────────────────────────

    describe("ensureDevDatabaseExists", () => {

        it("should not create database when it already exists", async () => {
            mockConnect.mockResolvedValue(undefined);
            mockEnd.mockResolvedValue(undefined);
            mockQuery.mockResolvedValue({ rowCount: 1, rows: [{ "?column?": 1 }] });

            const { ensureDevDatabaseExists } = require("../src/cli-helpers");
            await ensureDevDatabaseExists(
                "postgresql://user:pass@localhost:5432/mydb",
                "postgresql://user:pass@localhost:5432/mydb_dev_diff"
            );

            expect(mockConnect).toHaveBeenCalledTimes(1);
            // Should query pg_database
            expect(mockQuery).toHaveBeenCalledWith(
                "SELECT 1 FROM pg_database WHERE datname = $1",
                ["mydb_dev_diff"]
            );
            // Should NOT issue CREATE DATABASE since rowCount is 1
            expect(mockQuery).toHaveBeenCalledTimes(1);
            expect(mockEnd).toHaveBeenCalledTimes(1);
        });

        it("should create database when it does not exist", async () => {
            mockConnect.mockResolvedValue(undefined);
            mockEnd.mockResolvedValue(undefined);
            mockQuery
                .mockResolvedValueOnce({ rowCount: 0, rows: [] })  // SELECT 1 FROM pg_database
                .mockResolvedValueOnce(undefined);                  // CREATE DATABASE

            const { ensureDevDatabaseExists } = require("../src/cli-helpers");
            await ensureDevDatabaseExists(
                "postgresql://user:pass@localhost:5432/mydb",
                "postgresql://user:pass@localhost:5432/mydb_dev_diff"
            );

            expect(mockQuery).toHaveBeenCalledTimes(2);
            expect(mockQuery).toHaveBeenNthCalledWith(1,
                "SELECT 1 FROM pg_database WHERE datname = $1",
                ["mydb_dev_diff"]
            );
            expect(mockQuery).toHaveBeenNthCalledWith(2,
                'CREATE DATABASE "mydb_dev_diff"'
            );
        });

        it("catches connection errors — but no longer silently", async () => {
            // It used to swallow them entirely, and Atlas then died four frames
            // later on `database "mydb_dev_diff" does not exist (3D000)` with
            // the cause gone. It still must not throw (a push must not die
            // here); it now reports, and says it created nothing.
            // `dev-database-scratch.test.ts` covers what it says.
            mockConnect.mockRejectedValue(new Error("connection refused"));

            const { ensureDevDatabaseExists } = require("../src/cli-helpers");
            await expect(
                ensureDevDatabaseExists(
                    "postgresql://user:pass@localhost:5432/mydb",
                    "postgresql://user:pass@localhost:5432/mydb_dev_diff"
                )
            ).resolves.toBe(false);
        });
    });

    // ── getTableExcludes ────────────────────────────────────────────────

    describe("getTableExcludes (via getTableIncludesFromCollections path)", () => {

        // Only the DB introspection is stubbed: the includes are derived from
        // real collections by the real `getTableIncludesFromCollections`, so the
        // whole collections → includes → excludes chain runs. `--exclude` is the
        // only thing keeping `db push` from dropping tables Rebase doesn't own,
        // so "some table went missing from the exclude list" has to fail here.
        const collections: CollectionConfig[] = [
            {
                slug: "users",
                table: "users",
                name: "Users",
                properties: { name: { type: "string" } },
            },
        ];

        const runExcludes = () => getTableExcludes("postgres://x/db", "/collections", {
            getIncludes: () => getTableIncludesFromCollections(collections),
            queryExistingTables: async () => ["public.users", "public.sessions", "public.migrations"],
        });

        it("should always include atlas_schema_revisions.* in excludes", async () => {
            const excludes = await runExcludes();
            expect(excludes).toContain("atlas_schema_revisions.*");
            // The framework-owned schemas go in whole *and* by contents —
            // excluding only the contents still lets Atlas plan a DROP SCHEMA.
            expect(excludes).toEqual(expect.arrayContaining(["auth", "auth.*", "rebase", "rebase.*"]));
        });

        it("should exclude live tables no collection maps, and only those", async () => {
            const excludes = await runExcludes();
            expect(excludes).toContain("public.sessions");
            expect(excludes).toContain("public.migrations");
            // `users` backs a collection, so `db push` must be allowed to manage it.
            expect(excludes).not.toContain("public.users");
        });
    });

    // ── getTableIncludesFromCollections ──────────────────────────────────

    describe("getTableIncludesFromCollections", () => {

        it("should return empty array for empty collections", async () => {
            const includes = await getTableIncludesFromCollections([]);
            expect(includes).toEqual([]);
        });

        it("should handle collection with custom schema", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "orders",
                    table: "orders",
                    name: "Orders",
                    schema: "sales",
                    properties: { total: { type: "number" } },
                },
            ];

            const includes = await getTableIncludesFromCollections(collections);
            expect(includes).toContain("sales.orders");
        });

        it("should deduplicate table names", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "users",
                    table: "users",
                    name: "Users",
                    properties: { name: { type: "string" } },
                },
                {
                    slug: "users_alias",
                    table: "users", // same table
                    name: "Users Alias",
                    properties: { email: { type: "string" } },
                },
            ];

            const includes = await getTableIncludesFromCollections(collections);
            // "public.users" should appear only once
            const userEntries = includes.filter(i => i === "public.users");
            expect(userEntries).toHaveLength(1);
        });

        it("should include junction tables from many-to-many relations", async () => {
            const tagsCollection: CollectionConfig = {
                slug: "tags",
                table: "tags",
                name: "Tags",
                properties: { name: { type: "string" } },
            };

            const postsCollection: CollectionConfig = {
                slug: "posts",
                table: "posts",
                name: "Posts",
                properties: { title: { type: "string" } },
                relations: [
                    {
                        kind: "manyToMany",
                        relationName: "tags",
                        target: () => tagsCollection,
                        through: {
                            table: "posts_to_tags",
                            sourceColumn: "post_id",
                            targetColumn: "tag_id",
                        },
                    },
                ],
            };

            const includes = await getTableIncludesFromCollections([postsCollection, tagsCollection]);
            expect(includes).toContain("public.posts");
            expect(includes).toContain("public.tags");
            expect(includes).toContain("public.posts_to_tags");
        });

        it("should include junction tables with custom schema from target collection", async () => {
            const categoriesCollection: CollectionConfig = {
                slug: "categories",
                table: "categories",
                name: "Categories",
                schema: "catalog",
                properties: { name: { type: "string" } },
            };

            const productsCollection: CollectionConfig = {
                slug: "products",
                table: "products",
                name: "Products",
                properties: { title: { type: "string" } },
                relations: [
                    {
                        kind: "manyToMany",
                        relationName: "categories",
                        target: () => categoriesCollection,
                        through: {
                            table: "products_categories",
                            sourceColumn: "product_id",
                            targetColumn: "category_id",
                        },
                    },
                ],
            };

            const includes = await getTableIncludesFromCollections([productsCollection, categoriesCollection]);
            expect(includes).toContain("public.products");
            expect(includes).toContain("catalog.categories");
            // Junction table uses the target collection's schema
            expect(includes).toContain("catalog.products_categories");
        });

        it("should handle collection without explicit table (uses slug)", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "customers",
                    name: "Customers",
                    properties: { name: { type: "string" } },
                },
            ];

            const includes = await getTableIncludesFromCollections(collections);
            // getTableName falls back to slug → "customers"
            expect(includes).toContain("public.customers");
        });
    });
});
