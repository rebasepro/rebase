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

    // ── Relations ────────────────────────────────────────────────────────────
    //
    // These columns were once skipped outright, on the reasoning that a bare
    // column without its foreign key would disagree with what `db push` later
    // generated. On a managed tenant nothing pushes afterwards, so the table
    // arrived without the column its own collection reads: every insert 400ed
    // with `column "author_id" does not exist`. The answer is to emit the key
    // too, from the same planner `db push` uses.

    const authors = {
        name: "Authors",
        slug: "authors",
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            name: { name: "Name", type: "string" }
        }
    } as unknown as CollectionConfig;

    const postsWithAuthor = {
        ...posts,
        properties: {
            ...(posts as unknown as { properties: Record<string, unknown> }).properties,
            author: { name: "Author", type: "reference", path: "authors" }
        }
    } as unknown as CollectionConfig;

    const tags = {
        name: "Tags",
        slug: "tags",
        properties: {
            id: { name: "ID", type: "number", isId: "increment" },
            name: { name: "Name", type: "string" }
        }
    } as unknown as CollectionConfig;

    const postsWithTags = {
        ...posts,
        properties: {
            ...(posts as unknown as { properties: Record<string, unknown> }).properties,
            tags: {
                name: "Tags",
                type: "relation",
                relation: { kind: "manyToMany", target: () => tags, relationName: "tags" }
            }
        }
    } as unknown as CollectionConfig;

    it("adds a reference column, and the foreign key that makes it one", () => {
        const plan = planCollectionSchemaEnsure([postsWithAuthor, authors], withTable("public.posts", ["id"]));

        expect(plan.actions.some(a => a.kind === "add-column" && a.target === "public.posts.author")).toBe(true);
        const fk = plan.actions.find(a => a.kind === "add-constraint");
        expect(fk?.target).toBe("public.posts.posts_author_fkey");
        expect(fk?.sql).toMatch(/REFERENCES "public"\."authors" \("id"\)/);
    });

    it("orders every constraint after the columns and tables it depends on", () => {
        const plan = planCollectionSchemaEnsure([postsWithAuthor, authors], empty());
        const kinds = plan.actions.map(a => a.kind);
        expect(kinds.lastIndexOf("add-column")).toBeLessThan(kinds.indexOf("add-constraint"));
        expect(kinds.lastIndexOf("create-table")).toBeLessThan(kinds.indexOf("add-constraint"));
    });

    it("skips a foreign key the database already has, since ADD CONSTRAINT has no IF NOT EXISTS", () => {
        const existing: ExistingSchema = {
            tables: new Map([
                ["public.posts", new Set(["id", "author"])],
                ["public.authors", new Set(["id", "name"])]
            ]),
            enums: new Set(["public.posts_status"]),
            constraints: new Set(["public.posts.posts_author_fkey"])
        };
        const plan = planCollectionSchemaEnsure([postsWithAuthor, authors], existing);
        expect(plan.actions.some(a => a.kind === "add-constraint")).toBe(false);
    });

    it("creates the junction table behind a many-to-many, keyed on both endpoints", () => {
        const plan = planCollectionSchemaEnsure([postsWithTags, tags], empty());
        const junction = plan.actions.find(a => a.kind === "create-table" && a.target === "public.posts_tags");

        expect(junction).toBeDefined();
        // The endpoint key types have to match the primary keys they reference:
        // posts is a uuid, tags an auto-increment integer.
        expect(junction!.sql).toMatch(/"post_id" UUID NOT NULL/);
        expect(junction!.sql).toMatch(/"tag_id" INTEGER NOT NULL/);
        expect(junction!.sql).toMatch(/PRIMARY KEY \("post_id", "tag_id"\)/);

        const fks = plan.actions.filter(a => a.kind === "add-constraint").map(a => a.target);
        expect(fks).toContain("public.posts_tags.posts_tags_post_id_fkey");
        expect(fks).toContain("public.posts_tags.posts_tags_tag_id_fkey");
    });

    it("leaves an existing junction table alone", () => {
        const existing: ExistingSchema = {
            tables: new Map([
                ["public.posts", new Set(["id", "title", "views", "status"])],
                ["public.tags", new Set(["id", "name"])],
                ["public.posts_tags", new Set(["post_id", "tag_id"])]
            ]),
            enums: new Set(["public.posts_status"]),
            constraints: new Set([
                "public.posts_tags.posts_tags_post_id_fkey",
                "public.posts_tags.posts_tags_tag_id_fkey"
            ])
        };
        expect(planCollectionSchemaEnsure([postsWithTags, tags], existing).actions).toEqual([]);
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

/**
 * Two instances booting into the same fresh database.
 *
 * These inject the error at the statement level rather than driving two real
 * boots, and that is deliberate: the end state after a real race is usually
 * correct anyway — one instance always finishes — so a test that only asserts
 * the end state passes against the broken code as well as the fixed code. The
 * defect was never "the table is missing"; it was that the throw abandoned
 * every remaining action, so the loser skipped work it had not attempted yet.
 */
describe("a simultaneous boot", () => {
    /** A driver error shaped the way node-postgres reports one, through drizzle. */
    function pgError(code: string, extra: Record<string, unknown> = {}): Error {
        const inner = Object.assign(new Error(`pg error ${code}`), { code, ...extra });
        // Drizzle wraps the driver error; nothing useful is ever on the top level.
        return Object.assign(new Error("Failed query"), { cause: inner });
    }

    /** Records every statement, and fails the first match of `failOn` once. */
    function racingClient(
        failOn: RegExp,
        error: Error,
        options: { forever?: boolean } = {}
    ): { client: Queryable; executed: string[] } {
        const executed: string[] = [];
        let thrown = false;
        return {
            executed,
            client: {
                async query<T>(sql: string): Promise<{ rows: T[] }> {
                    executed.push(sql);
                    if (failOn.test(sql) && (options.forever || !thrown)) {
                        thrown = true;
                        throw error;
                    }
                    return { rows: [] as T[] };
                }
            }
        };
    }

    it("carries on to the remaining actions when it loses a CREATE TABLE race", async () => {
        // 42P07 duplicate_table: a peer created it between our catalog read and
        // our write. The table exists; everything after it still has to run.
        const { client, executed } = racingClient(/^CREATE TABLE/, pgError("42P07"), { forever: true });

        const plan = await ensureCollectionTables(client, [posts]);

        expect(plan.actions.length).toBeGreaterThan(0);
        // The proof: statements that come *after* the losing one were attempted.
        expect(executed.some(s => s.startsWith("ALTER TABLE"))).toBe(true);
    });

    it("treats a catalog unique violation as the object already existing", async () => {
        // The one measured in practice: `CREATE TYPE` has no IF NOT EXISTS, so
        // the loser gets 23505 on pg_type's own index.
        const { client, executed } = racingClient(
            /^CREATE TYPE/,
            pgError("23505", { constraint: "pg_type_typname_nsp_index" }),
            { forever: true }
        );

        await ensureCollectionTables(client, [posts]);

        expect(executed.some(s => s.startsWith("CREATE TABLE"))).toBe(true);
    });

    it("retries a deadlock and then succeeds", async () => {
        // 40P01: two boots taking catalog locks in step. Unlike a duplicate, the
        // statement did nothing at all, so it must actually be run again.
        const { client, executed } = racingClient(/^CREATE TABLE/, pgError("40P01"));

        await ensureCollectionTables(client, [posts]);

        expect(executed.filter(s => s.startsWith("CREATE TABLE")).length).toBeGreaterThan(1);
    });

    it("still fails loudly on a unique violation from the customer's own data", async () => {
        // A named constraint, not a `pg_` catalog index — this is a real problem
        // with real rows and must not be swallowed as "someone beat me to it".
        // It is still retried first, because 23505 is in the retryable set and
        // this shape cannot be told from a race until the constraint name is
        // read; what matters is that it ends in a throw rather than a shrug.
        const { client } = racingClient(
            /^CREATE TABLE/,
            pgError("23505", { constraint: "posts_slug_key" }),
            { forever: true }
        );

        await expect(ensureCollectionTables(client, [posts])).rejects.toThrow(/public\.posts/);
    });

    it("still fails loudly on a permission error", async () => {
        const { client } = racingClient(/^CREATE TABLE/, pgError("42501"), { forever: true });

        await expect(ensureCollectionTables(client, [posts])).rejects.toThrow(/public\.posts/);
    });
});
