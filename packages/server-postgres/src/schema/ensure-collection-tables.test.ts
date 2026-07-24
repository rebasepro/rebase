import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";
import {
    planCollectionSchemaEnsure,
    ensureCollectionTables,
    type ExistingSchema,
    type Queryable
} from "./ensure-collection-tables";

const posts = {
    name: "Posts",
    slug: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        views: { name: "Views", type: "number" },
        status: {
            name: "Status",
            type: "string",
            enum: [
                { id: "draft", label: "Draft" },
                { id: "published", label: "Published" }
            ]
        }
    }
} as unknown as CollectionConfig;

const empty = (): ExistingSchema => ({ tables: new Map(), enums: new Set() });

const withTable = (key: string, columns: string[]): ExistingSchema => ({
    tables: new Map([[key, new Set(columns)]]),
    enums: new Set()
});

describe("planning an additive schema ensure", () => {
    it("creates a missing table, its enum type, and its columns in that order", () => {
        const plan = planCollectionSchemaEnsure([posts], empty());
        const kinds = plan.actions.map(a => a.kind);

        // The enum must exist before the column that references it, and the
        // table before its own columns.
        expect(kinds.indexOf("create-enum")).toBeLessThan(kinds.indexOf("create-table"));
        expect(kinds.indexOf("create-table")).toBeLessThan(kinds.indexOf("add-column"));
        expect(plan.statements.join("\n")).toMatch(/CREATE TABLE IF NOT EXISTS "public"\."posts"/);
    });

    it("adds only the columns an existing table is missing", () => {
        const plan = planCollectionSchemaEnsure([posts], withTable("public.posts", ["id", "title"]));
        const added = plan.actions.filter(a => a.kind === "add-column").map(a => a.target);

        expect(added).toContain("public.posts.views");
        expect(added).toContain("public.posts.status");
        expect(added).not.toContain("public.posts.title");
        expect(plan.actions.some(a => a.kind === "create-table")).toBe(false);
    });

    it("is a no-op against a database that is already current", () => {
        const existing: ExistingSchema = {
            tables: new Map([["public.posts", new Set(["id", "title", "views", "status"])]]),
            enums: new Set(["public.posts_status"])
        };
        expect(planCollectionSchemaEnsure([posts], existing).actions).toEqual([]);
    });

    it("skips an enum type that already exists, since CREATE TYPE has no IF NOT EXISTS", () => {
        const existing: ExistingSchema = { tables: new Map(), enums: new Set(["public.posts_status"]) };
        const plan = planCollectionSchemaEnsure([posts], existing);
        expect(plan.actions.some(a => a.kind === "create-enum")).toBe(false);
    });

    it("NEVER emits a destructive statement, whatever the database contains", () => {
        // The core safety property. This runs unattended against customer data
        // with nobody reading a diff, so a column the collections no longer
        // mention must be left alone, not dropped.
        const existing = withTable("public.posts", ["id", "title", "legacy_column", "another_old_one"]);
        const sql = planCollectionSchemaEnsure([posts], existing).statements.join("\n");

        expect(sql).not.toMatch(/\bDROP\b/i);
        expect(sql).not.toMatch(/\bTRUNCATE\b/i);
        expect(sql).not.toMatch(/ALTER COLUMN/i);
        expect(sql).not.toMatch(/legacy_column/);
    });

    it("never adds a NOT NULL column, which an existing table with rows could not take", () => {
        const sql = planCollectionSchemaEnsure([posts], withTable("public.posts", ["id"]))
            .statements.join("\n");
        expect(sql).not.toMatch(/NOT NULL/i);
    });

    it("leaves relation columns to a real migration rather than adding them without their key", () => {
        const withRelation = {
            ...posts,
            properties: {
                ...(posts as unknown as { properties: Record<string, unknown> }).properties,
                author: { name: "Author", type: "reference", target: () => posts }
            }
        } as unknown as CollectionConfig;
        const plan = planCollectionSchemaEnsure([withRelation], withTable("public.posts", ["id"]));
        expect(plan.actions.some(a => a.target.endsWith(".author"))).toBe(false);
    });
});

describe("applying the plan", () => {
    function fakeClient(): { client: Queryable; executed: string[] } {
        const executed: string[] = [];
        const client: Queryable = {
            async query<T>(sql: string): Promise<{ rows: T[] }> {
                executed.push(sql);
                return { rows: [] as T[] };
            }
        };
        return { client, executed };
    }

    it("creates the schema, reads what exists, then applies", async () => {
        const { client, executed } = fakeClient();
        const plan = await ensureCollectionTables(client, [posts]);

        expect(plan.actions.length).toBeGreaterThan(0);
        expect(executed.some(s => s.includes("information_schema.columns"))).toBe(true);
        expect(executed.some(s => s.includes("CREATE TABLE IF NOT EXISTS"))).toBe(true);
    });

    it("surfaces which statement failed rather than a bare driver error", async () => {
        const client: Queryable = {
            async query<T>(sql: string): Promise<{ rows: T[] }> {
                if (sql.startsWith("CREATE TABLE")) throw new Error("permission denied");
                return { rows: [] as T[] };
            }
        };
        await expect(ensureCollectionTables(client, [posts])).rejects.toThrow(/permission denied/);
        await expect(ensureCollectionTables(client, [posts])).rejects.toThrow(/public\.posts/);
    });

    it("does nothing when the database is already current", async () => {
        const client: Queryable = {
            async query<T>(sql: string): Promise<{ rows: T[] }> {
                if (sql.includes("information_schema.columns")) {
                    return {
                        rows: ["id", "title", "views", "status"].map(c => ({
                            table_schema: "public",
                            table_name: "posts",
                            column_name: c
                        })) as unknown as T[]
                    };
                }
                if (sql.includes("pg_type")) {
                    return { rows: [{ schema: "public", name: "posts_status" }] as unknown as T[] };
                }
                return { rows: [] as T[] };
            }
        };
        const plan = await ensureCollectionTables(client, [posts]);
        expect(plan.actions).toEqual([]);
    });
});
