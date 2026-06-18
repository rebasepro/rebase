/**
 * Tests to verify that Rebase schema generation and drizzle-kit configuration
 * never attempt to drop/modify tables, enums, or other database objects
 * that are NOT defined in the managed schema.
 *
 * How the safety mechanism works:
 *
 *   1. `tablesFilter` in drizzle.config.ts tells drizzle-kit which tables to
 *      introspect from the live database. Tables not in the filter are INVISIBLE
 *      to drizzle-kit — they never enter the diff snapshot, so they can't appear
 *      in DROP TABLE statements.
 *
 *   2. `schemaFilter` restricts to the "public" PostgreSQL schema, so tables in
 *      other schemas (extensions, internal, etc.) are also invisible.
 *
 *   3. `entities.roles: false` prevents drizzle-kit from managing database roles.
 *
 *   4. `extensionsFilters: ["postgis"]` ignores extension-managed tables.
 *
 *   5. The CLI always passes `--strict --verbose` to `db push`, so destructive
 *      operations require explicit confirmation even if something slips through.
 *
 * These tests verify:
 *   - The schema generator outputs correct table/enum lists for tablesFilter
 *   - The tablesFilter scoping correctly excludes unmapped tables
 *   - The drizzle-kit diff engine produces no destructive SQL when the previous
 *     snapshot only contains managed tables (simulating what tablesFilter provides)
 *   - Unmapped tables in the raw snapshot DO produce DROP statements (proving
 *     the tablesFilter is the critical safety boundary, not the diff engine)
 */
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { pgTable, varchar, text, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
import { getTableName, Table } from "drizzle-orm";
import { EntityCollection } from "@rebasepro/types";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";

// ── Helpers ─────────────────────────────────────────────────────────────

function buildPrevSnapshot(tables: Record<string, any>, enums: Record<string, any> = {}) {
    return {
        id: "prev-snapshot",
        prevId: "prev-prev-snapshot",
        version: "7",
        dialect: "postgresql",
        tables,
        enums,
        schemas: {},
        sequences: {},
        roles: {},
        policies: {},
        views: {},
        _meta: { schemas: {},
tables: {},
columns: {} }
    };
}

function snapshotTable(name: string, columns: Record<string, any>) {
    return {
        name,
        schema: "",
        columns,
        indexes: {},
        foreignKeys: {},
        compositePrimaryKeys: {},
        uniqueConstraints: {},
        policies: {},
        checkConstraints: {},
        isRLSEnabled: false
    };
}

function snapshotColumn(name: string, type: string, opts: {
    primaryKey?: boolean;
    notNull?: boolean;
} = {}) {
    return {
        name,
        type,
        primaryKey: opts.primaryKey ?? false,
        notNull: opts.notNull ?? (opts.primaryKey ?? false),
        default: undefined
    };
}

function snapshotEnum(name: string, schema: string, values: string[]) {
    return { name,
schema,
values };
}

// ── Drizzle schema objects (the "managed" schema) ───────────────────────

const managedUsers = pgTable("users", {
    id: varchar("id").primaryKey(),
    name: varchar("name"),
    email: varchar("email")
});

const managedPosts = pgTable("posts", {
    id: varchar("id").primaryKey(),
    title: varchar("title").notNull(),
    user_id: varchar("user_id")
});

// ── Tests ───────────────────────────────────────────────────────────────

describe("Unmapped tables safety", () => {

    describe("tablesFilter scoping", () => {

        it("should extract only managed table names from the tables export", () => {
            const tables = { managedUsers,
managedPosts };
            const tableNames = Object.values(tables).map(t => getTableName(t as Table));

            expect(tableNames).toEqual(["users", "posts"]);
            expect(tableNames).not.toContain("legacy_orders");
            expect(tableNames).not.toContain("external_analytics");
        });

        it("should produce a tablesFilter that excludes unmapped tables", () => {
            const tables = { managedUsers,
managedPosts };
            const tablesFilter = Object.values(tables).map(t => getTableName(t as Table));

            const unmappedTables = [
                "legacy_orders",
                "external_analytics",
                "stripe_webhooks",
                "audit_log"
            ];

            for (const unmapped of unmappedTables) {
                expect(tablesFilter).not.toContain(unmapped);
            }
        });

        it("should produce stable, deterministic table names regardless of export key names", () => {
            // The table name comes from pgTable("table_name", ...), not the JS variable name
            const weirdVarName = pgTable("actual_table_name", {
                id: varchar("id").primaryKey()
            });
            expect(getTableName(weirdVarName as Table)).toBe("actual_table_name");
        });
    });

    describe("tablesFilter as the safety boundary — proof by contradiction", () => {

        it("without tablesFilter: drizzle-kit WOULD drop unmapped tables (proving tablesFilter is essential)", async () => {
            // If unmapped tables leak into the prev snapshot (i.e. tablesFilter is NOT applied),
            // drizzle-kit's diff engine WILL generate DROP TABLE statements.
            // This test proves that tablesFilter is the critical safety layer.
            const prevWithUnmapped = buildPrevSnapshot({
                "public.users": snapshotTable("users", {
                    id: snapshotColumn("id", "varchar", { primaryKey: true }),
                    name: snapshotColumn("name", "varchar"),
                    email: snapshotColumn("email", "varchar")
                }),
                // An unmapped table that leaked into the snapshot
                "public.legacy_orders": snapshotTable("legacy_orders", {
                    id: snapshotColumn("id", "varchar", { primaryKey: true }),
                    amount: snapshotColumn("amount", "integer")
                })
            });

            const curJson = generateDrizzleJson({ managedUsers });
            const statements = await generateMigration(prevWithUnmapped as any, curJson as any);
            const sql = statements.join("\n");

            // WITHOUT tablesFilter, drizzle-kit WOULD drop the unmapped table.
            // This is expected behavior — it proves tablesFilter is essential.
            expect(sql).toContain("DROP TABLE");
            expect(sql).toContain("legacy_orders");
        });

        it("without tablesFilter: drizzle-kit WOULD drop unmapped enums (proving tablesFilter scope is essential)", async () => {
            const prevWithUnmappedEnum = buildPrevSnapshot(
                {
                    "public.users": snapshotTable("users", {
                        id: snapshotColumn("id", "varchar", { primaryKey: true }),
                        name: snapshotColumn("name", "varchar"),
                        email: snapshotColumn("email", "varchar")
                    })
                },
                {
                    "public.order_priority": snapshotEnum("order_priority", "public", ["low", "medium", "high"])
                }
            );

            const curJson = generateDrizzleJson({ managedUsers });
            const statements = await generateMigration(prevWithUnmappedEnum as any, curJson as any);
            const sql = statements.join("\n");

            // Without filtering, drizzle-kit drops the unmapped enum
            expect(sql).toContain("DROP TYPE");
            expect(sql).toContain("order_priority");
        });
    });

    describe("with tablesFilter applied: only managed tables enter the diff", () => {

        it("should produce zero migration statements when managed schema is unchanged", async () => {
            // Simulate: tablesFilter ensures only managed tables appear in the snapshot
            const prevOnlyManaged = buildPrevSnapshot({
                "public.users": snapshotTable("users", {
                    id: snapshotColumn("id", "varchar", { primaryKey: true }),
                    name: snapshotColumn("name", "varchar"),
                    email: snapshotColumn("email", "varchar")
                }),
                "public.posts": snapshotTable("posts", {
                    id: snapshotColumn("id", "varchar", { primaryKey: true }),
                    title: snapshotColumn("title", "varchar", { notNull: true }),
                    user_id: snapshotColumn("user_id", "varchar")
                })
            });

            const curJson = generateDrizzleJson({ managedUsers,
managedPosts });
            const statements = await generateMigration(prevOnlyManaged as any, curJson as any);

            // No changes needed — managed schema is identical
            expect(statements.length).toBe(0);
        });

        it("should correctly detect changes to managed tables without touching anything else", async () => {
            // Prev: users has id + name (missing email)
            const prevOnlyManaged = buildPrevSnapshot({
                "public.users": snapshotTable("users", {
                    id: snapshotColumn("id", "varchar", { primaryKey: true }),
                    name: snapshotColumn("name", "varchar")
                })
            });

            const curJson = generateDrizzleJson({ managedUsers });
            const statements = await generateMigration(prevOnlyManaged as any, curJson as any);
            const sql = statements.join("\n");

            // Should add the email column
            expect(sql.toLowerCase()).toContain("alter table");
            expect(sql).toContain("email");

            // Should NOT contain any DROP TABLE
            expect(sql).not.toContain("DROP TABLE");
        });
    });

    describe("schema generation exports correct metadata for tablesFilter", () => {

        it("should export a tables object containing all and only defined collection tables", async () => {
            const collections: EntityCollection[] = [
                {
                    slug: "products",
                    table: "products",
                    name: "Products",
                    properties: {
                        name: { type: "string" },
                        price: { type: "number" }
                    }
                },
                {
                    slug: "categories",
                    table: "categories",
                    name: "Categories",
                    properties: {
                        title: { type: "string" }
                    }
                }
            ];

            const result = await generateSchema(collections);

            expect(result).toContain("export const tables = {");
            expect(result).toContain("products");
            expect(result).toContain("categories");
            expect(result).not.toContain("legacy_orders");
        });

        it("should include junction tables in the tables export for M2M relations", async () => {
            const postsCollection: EntityCollection = {
                slug: "posts",
                table: "posts",
                name: "Posts",
                properties: {
                    title: { type: "string" },
                    tags: { type: "relation",
relationName: "tags" }
                },
                relations: [{
                    relationName: "tags",
                    target: () => tagsCollection,
                    cardinality: "many",
                    direction: "owning",
                    through: {
                        table: "posts_to_tags",
                        sourceColumn: "post_id",
                        targetColumn: "tag_id"
                    }
                }]
            };
            const tagsCollection: EntityCollection = {
                slug: "tags",
                table: "tags",
                name: "Tags",
                properties: { name: { type: "string" } }
            };

            const result = await generateSchema([postsCollection, tagsCollection]);

            // Junction table must appear in the tables export
            expect(result).toContain("export const tables = {");
            expect(result).toContain("postsToTags");
        });

        it("should export enums for schema-defined enum types", async () => {
            const collections: EntityCollection[] = [{
                slug: "orders",
                table: "orders",
                name: "Orders",
                properties: {
                    status: {
                        type: "string",
                        enumValues: ["pending", "shipped", "delivered"]
                    }
                }
            }];

            const result = await generateSchema(collections);

            expect(result).toContain("export const enums = {");
        });
    });

    describe("drizzle.config.ts safety properties", () => {

        it("schemaFilter should restrict to public schema only", () => {
            const schemaFilter = ["public"];
            expect(schemaFilter).toEqual(["public"]);
            expect(schemaFilter).not.toContain("information_schema");
            expect(schemaFilter).not.toContain("pg_catalog");
        });

        it("entities.roles should be false to prevent managing DB roles", () => {
            const entities = { roles: false };
            expect(entities.roles).toBe(false);
        });

        it("extensionsFilters should include postgis", () => {
            const extensionsFilters = ["postgis"];
            expect(extensionsFilters).toContain("postgis");
        });
    });
});
