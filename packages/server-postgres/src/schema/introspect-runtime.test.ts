import { describe, expect, it } from "@jest/globals";
import { resolveCollectionRelations } from "@rebasepro/common";
import type { CollectionConfig } from "@rebasepro/types";

import { buildCollectionsFromSchema, introspectSchema, readRlsStatus, IntrospectedSchema, Queryable } from "./introspect-runtime";
import { buildTablesMap, identifyJoinTables, TableColumn, ForeignKeyRow, PrimaryKeyRow } from "./introspect-db-logic";

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

function schemaOf(
    columns: TableColumn[],
    pks: PrimaryKeyRow[],
    fks: ForeignKeyRow[] = [],
    enums: Map<string, string[]> = new Map()
): IntrospectedSchema {
    const tableNames = [...new Set(columns.map((c) => c.table_name))].map((table_name) => ({ table_name }));
    const tablesMap = buildTablesMap(tableNames, columns, pks, fks);
    return { tablesMap, enumMap: enums, joinTables: identifyJoinTables(tablesMap) };
}

describe("buildCollectionsFromSchema", () => {
    it("derives a collection per table with humanized names and the pg schema", () => {
        const schema = schemaOf(
            [
                column({ table_name: "blog_posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                column({ table_name: "blog_posts", column_name: "title", is_nullable: "NO" })
            ],
            [{ table_name: "blog_posts", column_name: "id" }]
        );

        const [collection] = buildCollectionsFromSchema(schema, "public");

        expect(collection.slug).toBe("blog_posts");
        expect(collection.table).toBe("blog_posts");
        expect((collection as { schema?: string }).schema).toBe("public");
        expect(collection.name).toBe("Blog Posts");
        expect(collection.singularName).toBe("Blog Post");
    });

    it("maps a uuid primary key to isId uuid and a serial one to increment", () => {
        const schema = schemaOf(
            [
                column({ table_name: "users", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                column({ table_name: "orders", column_name: "id", data_type: "integer", udt_name: "int4", is_nullable: "NO" })
            ],
            [
                { table_name: "users", column_name: "id" },
                { table_name: "orders", column_name: "id" }
            ]
        );

        const collections = buildCollectionsFromSchema(schema, "public");
        const users = collections.find((c) => c.slug === "users")!;
        const orders = collections.find((c) => c.slug === "orders")!;

        expect((users.properties as any).id.isId).toBe("uuid");
        expect((orders.properties as any).id.isId).toBe("increment");
    });

    it("marks NOT NULL columns without a default as required, and leaves others optional", () => {
        const schema = schemaOf(
            [
                column({ table_name: "posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                column({ table_name: "posts", column_name: "title", is_nullable: "NO" }),
                column({ table_name: "posts", column_name: "subtitle", is_nullable: "YES" }),
                column({ table_name: "posts", column_name: "status", is_nullable: "NO", column_default: "'draft'" })
            ],
            [{ table_name: "posts", column_name: "id" }]
        );

        const props = buildCollectionsFromSchema(schema, "public")[0].properties as any;

        expect(props.title.validation).toEqual({ required: true });
        expect(props.subtitle.validation).toBeUndefined();
        // A default means the database fills it in, so the API must not demand it.
        expect(props.status.validation).toBeUndefined();
    });

    it("expands a pg enum column into enum entries", () => {
        const schema = schemaOf(
            [
                column({ table_name: "posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                column({ table_name: "posts", column_name: "status", data_type: "USER-DEFINED", udt_name: "post_status" })
            ],
            [{ table_name: "posts", column_name: "id" }],
            [],
            new Map([["post_status", ["draft", "in_review"]]])
        );

        const props = buildCollectionsFromSchema(schema, "public")[0].properties as any;

        expect(props.status.type).toBe("string");
        expect(props.status.enum).toEqual([
            { id: "draft", label: "Draft" },
            { id: "in_review", label: "In Review" }
        ]);
    });

    it("turns a foreign key into an owning relation and drops the raw fk column", () => {
        const schema = schemaOf(
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

        const posts = buildCollectionsFromSchema(schema, "public").find((c) => c.slug === "posts")!;
        const props = posts.properties as any;

        expect(props.author_id).toBeUndefined();
        expect(props.author.name).toBe("Author");
        expect(props.author.type).toBe("relation");
        // The descriptor is nested under `relation`, carries `kind`, and its
        // `target` is a thunk — see the resolvability test below for why none of
        // those three are stylistic.
        expect(props.author.relation).toMatchObject({ kind: "belongsTo", localKey: "author_id" });
        expect(typeof props.author.relation.target).toBe("function");
        expect(props.author.relation.target().slug).toBe("authors");
    });

    /**
     * The shape has to be one the resolver actually reads.
     *
     * This path emitted `cardinality` / `direction` / a bare-string `target`
     * flat on the property — the shape `Relation` stopped accepting, and the
     * same drift `introspect-emits-valid-relations.test.ts` caught in the
     * generated-file path and this one was missed by. Nothing threw:
     * `resolveCollectionRelations` reads `property.relation`, found none, and
     * reported a collection with no relations at all.
     *
     * The visible cost was writes. `assertKnownWriteFields` learns an owning
     * relation's FK column from the *resolved* relation's `localKey`, and the FK
     * column is deliberately absent from `properties` ("surfaces as a
     * relation"), so with nothing resolving, `POST /api/data/orders` with
     * `product_id` came back 400 `has no field 'product_id'` — the column was
     * simultaneously the only way to set the relation and not a known field.
     *
     * Asserting the literal object is what let it drift, so this asserts
     * through the resolver instead: a future reshape has to keep it resolvable,
     * not merely keep the keys someone once wrote down.
     */
    it("emits a relation the resolver can read, so the fk column is writable", () => {
        const schema = schemaOf(
            [
                column({ table_name: "products", column_name: "id", data_type: "integer", udt_name: "int4", is_nullable: "NO" }),
                column({ table_name: "orders", column_name: "id", data_type: "integer", udt_name: "int4", is_nullable: "NO" }),
                column({ table_name: "orders", column_name: "product_id", data_type: "integer", udt_name: "int4" })
            ],
            [
                { table_name: "products", column_name: "id" },
                { table_name: "orders", column_name: "id" }
            ],
            [{ table_name: "orders", column_name: "product_id", foreign_table_name: "products", foreign_column_name: "id" }]
        );

        const orders = buildCollectionsFromSchema(schema, "public").find((c) => c.slug === "orders")!;
        const resolved = resolveCollectionRelations(orders as unknown as CollectionConfig);

        expect(Object.keys(resolved)).toEqual(["product"]);
        expect(resolved.product.kind).toBe("belongsTo");
        // `localKey` is the field `assertKnownWriteFields` adds to the known set,
        // which is what makes `product_id` writable. The write itself is covered
        // end-to-end by `scripts/smoke-baas.ts` against a real database.
        expect((resolved.product as { localKey: string }).localKey).toBe("product_id");
    });

    it("skips join tables — they are an edge between collections, not a collection", () => {
        const schema = schemaOf(
            [
                column({ table_name: "posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                column({ table_name: "tags", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                column({ table_name: "posts_tags", column_name: "post_id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                column({ table_name: "posts_tags", column_name: "tag_id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" })
            ],
            [
                { table_name: "posts", column_name: "id" },
                { table_name: "tags", column_name: "id" },
                { table_name: "posts_tags", column_name: "post_id" },
                { table_name: "posts_tags", column_name: "tag_id" }
            ],
            [
                { table_name: "posts_tags", column_name: "post_id", foreign_table_name: "posts", foreign_column_name: "id" },
                { table_name: "posts_tags", column_name: "tag_id", foreign_table_name: "tags", foreign_column_name: "id" }
            ]
        );

        const slugs = buildCollectionsFromSchema(schema, "public").map((c) => c.slug);

        expect(slugs).toEqual(expect.arrayContaining(["posts", "tags"]));
        expect(slugs).not.toContain("posts_tags");
    });
});

describe("introspectSchema", () => {
    it("scopes every query to the requested schema", async () => {
        const calls: unknown[][] = [];
        const client: Queryable = {
            query: async (_text: string, values?: unknown[]) => {
                calls.push(values ?? []);
                return { rows: [] as any[] };
            }
        };

        await introspectSchema(client, "analytics");

        expect(calls.length).toBeGreaterThan(0);
        for (const values of calls) {
            expect(values).toEqual(["analytics"]);
        }
    });
});

describe("readRlsStatus", () => {
    it("reports RLS state and policy count per table", async () => {
        const client: Queryable = {
            query: async () => ({
                rows: [
                    { table: "posts", rls_enabled: true, policy_count: "2" },
                    { table: "secrets", rls_enabled: false, policy_count: "0" },
                    { table: "locked", rls_enabled: true, policy_count: 0 }
                ] as never[]
            })
        };

        const status = await readRlsStatus(client, "public");

        // Unprotected: no authorization model, so baas must not serve it.
        expect(status.get("secrets")).toEqual({ table: "secrets", rlsEnabled: false, policyCount: 0 });
        // Protected and policied.
        expect(status.get("posts")).toEqual({ table: "posts", rlsEnabled: true, policyCount: 2 });
        // RLS on, no policies — legal, and returns nothing at all.
        expect(status.get("locked")).toEqual({ table: "locked", rlsEnabled: true, policyCount: 0 });
    });

    it("scopes the lookup to the requested schema", async () => {
        const calls: unknown[][] = [];
        const client: Queryable = {
            query: async (_t: string, v?: unknown[]) => { calls.push(v ?? []); return { rows: [] as never[] }; }
        };

        await readRlsStatus(client, "analytics");

        expect(calls[0]).toEqual(["analytics"]);
    });
});
