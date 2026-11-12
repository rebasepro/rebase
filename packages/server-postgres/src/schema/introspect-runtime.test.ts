import { describe, expect, it } from "@jest/globals";
import { resolveCollectionRelations } from "@rebasepro/common";
import type { TableDescriptor } from "@rebasepro/types";

import { introspectSchema, lowerIntrospectedTables, Queryable } from "./introspect-runtime";
import { describeTables, introspectTables, rlsRemediationSql } from "./introspect-tables";
import type { ForeignKeyRow, PolicyRow, PrimaryKeyRow, SchemaMetadata, TableColumn, TableRow } from "./introspect-db-logic";
import {
    CHECK_CONSTRAINTS_QUERY,
    COLUMNS_QUERY,
    COMMENTS_QUERY,
    ENUMS_QUERY,
    FOREIGN_KEYS_QUERY,
    INDEXES_QUERY,
    POLICIES_QUERY,
    PRIMARY_KEYS_QUERY,
    TABLES_QUERY,
    UNIQUE_CONSTRAINTS_QUERY,
    type QueryableClient
} from "./introspect-db-queries";

/**
 * Runtime introspection: what a backend with no `backend/schema` serves.
 *
 * The descriptors are read from the catalogue (`introspectTables`), and the
 * collections the request-time code reads are lowered from them
 * (`lowerIntrospectedTables`). The REST surface must not move by one key: the
 * keys asserted below are the ones the runtime has always served.
 */

function column(overrides: Partial<TableColumn> & { table_name: string; column_name: string }): TableColumn {
    return {
        data_type: "text",
        udt_name: "text",
        is_nullable: "YES",
        column_default: null,
        atttypmod: null,
        is_generated: "NEVER",
        generation_expression: null,
        is_identity: "NO",
        ...overrides
    };
}

const uuidKey = (table_name: string, column_name = "id"): TableColumn =>
    column({ table_name, column_name, data_type: "uuid", udt_name: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" });

function metadata(input: {
    tables?: TableRow[];
    columns: TableColumn[];
    pks: PrimaryKeyRow[];
    fks?: ForeignKeyRow[];
    enums?: Record<string, string[]>;
    policies?: PolicyRow[];
    uniques?: SchemaMetadata["uniques"];
    rlsOff?: string[];
}): SchemaMetadata {
    const names = [...new Set(input.columns.map(c => c.table_name))];
    return {
        schema: "public",
        tables: input.tables ?? names.map(table_name => ({ table_name, rls_enabled: !(input.rlsOff ?? []).includes(table_name) })),
        columns: input.columns.map((c, index) => ({ ...c, ordinal_position: index + 1 })),
        enumValues: Object.entries(input.enums ?? {}).flatMap(([enum_name, values]) => values.map((enum_value, sort_order) => ({ enum_name, enum_value, sort_order }))),
        pks: input.pks,
        fks: (input.fks ?? []).map(fk => ({ constraint_name: `${fk.table_name}_${fk.column_name}_fkey`, delete_rule: "NO ACTION", ...fk })),
        uniques: input.uniques ?? [],
        indexes: [],
        checks: [],
        comments: [],
        policies: input.policies ?? [],
        rowCounts: {}
    };
}

const byKey = (table: TableDescriptor) => Object.fromEntries(table.columns.map(c => [c.key, c]));
const tableOf = (tables: TableDescriptor[], slug: string): TableDescriptor => {
    const found = tables.find(t => t.slug === slug);
    if (!found) throw new Error(`no table ${slug}`);
    return found;
};

describe("describeTables (runtime) — column types", () => {
    const meta = metadata({
        columns: [
            column({ table_name: "t", column_name: "id", data_type: "integer", udt_name: "int4", is_nullable: "NO", column_default: "nextval('t_id_seq'::regclass)" }),
            column({ table_name: "t", column_name: "a_text" }),
            column({ table_name: "t", column_name: "a_varchar", data_type: "character varying", udt_name: "varchar", character_maximum_length: 40 }),
            column({ table_name: "t", column_name: "a_unbounded", data_type: "character varying", udt_name: "varchar" }),
            column({ table_name: "t", column_name: "a_char", data_type: "character", udt_name: "bpchar", character_maximum_length: 2 }),
            column({ table_name: "t", column_name: "a_uuid", data_type: "uuid", udt_name: "uuid" }),
            column({ table_name: "t", column_name: "a_small", data_type: "smallint", udt_name: "int2" }),
            column({ table_name: "t", column_name: "a_big", data_type: "bigint", udt_name: "int8" }),
            column({ table_name: "t", column_name: "a_real", data_type: "real", udt_name: "float4" }),
            column({ table_name: "t", column_name: "a_double", data_type: "double precision", udt_name: "float8" }),
            column({ table_name: "t", column_name: "a_numeric", data_type: "numeric", udt_name: "numeric", numeric_precision: 10, numeric_scale: 2 }),
            column({ table_name: "t", column_name: "a_free_numeric", data_type: "numeric", udt_name: "numeric" }),
            column({ table_name: "t", column_name: "a_bool", data_type: "boolean", udt_name: "bool" }),
            column({ table_name: "t", column_name: "a_tstz", data_type: "timestamp with time zone", udt_name: "timestamptz" }),
            column({ table_name: "t", column_name: "a_date", data_type: "date", udt_name: "date" }),
            column({ table_name: "t", column_name: "a_time", data_type: "time without time zone", udt_name: "time" }),
            column({ table_name: "t", column_name: "a_json", data_type: "json", udt_name: "json" }),
            column({ table_name: "t", column_name: "a_jsonb", data_type: "jsonb", udt_name: "jsonb" }),
            column({ table_name: "t", column_name: "a_bytea", data_type: "bytea", udt_name: "bytea" }),
            column({ table_name: "t", column_name: "a_enum", data_type: "USER-DEFINED", udt_name: "mood" }),
            column({ table_name: "t", column_name: "a_vector", data_type: "USER-DEFINED", udt_name: "vector", atttypmod: 3 }),
            column({ table_name: "t", column_name: "a_text_array", data_type: "ARRAY", udt_name: "_text" }),
            column({ table_name: "t", column_name: "a_uuid_array", data_type: "ARRAY", udt_name: "_uuid" }),
            column({ table_name: "t", column_name: "a_enum_array", data_type: "ARRAY", udt_name: "_mood" }),
            // Types Rebase serves but does not create.
            column({ table_name: "t", column_name: "a_inet", data_type: "inet", udt_name: "inet" }),
            column({ table_name: "t", column_name: "a_citext", data_type: "USER-DEFINED", udt_name: "citext" }),
            column({ table_name: "t", column_name: "a_interval", data_type: "interval", udt_name: "interval" }),
            column({ table_name: "t", column_name: "a_ts", data_type: "timestamp without time zone", udt_name: "timestamp" }),
            column({ table_name: "t", column_name: "a_money", data_type: "money", udt_name: "money" }),
            column({ table_name: "t", column_name: "a_xml", data_type: "xml", udt_name: "xml" }),
            column({ table_name: "t", column_name: "a_range", data_type: "int4range", udt_name: "int4range" }),
            column({ table_name: "t", column_name: "a_geometry", data_type: "USER-DEFINED", udt_name: "geometry" }),
            column({ table_name: "t", column_name: "a_inet_array", data_type: "ARRAY", udt_name: "_inet" })
        ],
        pks: [{ table_name: "t", column_name: "id" }],
        enums: { mood: ["happy", "sad"] }
    });
    const [t] = describeTables(meta).tables;
    const types = Object.fromEntries(t.columns.map(c => [c.column, c.type]));

    it("reads each column as its Postgres type", () => {
        expect(types).toEqual({
            id: { kind: "serial" },
            a_text: { kind: "text" },
            a_varchar: { kind: "varchar", length: 40 },
            a_unbounded: { kind: "text" },
            a_char: { kind: "char", length: 2 },
            a_uuid: { kind: "uuid" },
            a_small: { kind: "smallint" },
            a_big: { kind: "bigint" },
            a_real: { kind: "real" },
            a_double: { kind: "doublePrecision" },
            a_numeric: { kind: "numeric", precision: 10, scale: 2 },
            a_free_numeric: { kind: "numeric" },
            a_bool: { kind: "boolean" },
            a_tstz: { kind: "timestamptz" },
            a_date: { kind: "date" },
            a_time: { kind: "time" },
            a_json: { kind: "json" },
            a_jsonb: { kind: "jsonb" },
            a_bytea: { kind: "bytea" },
            a_enum: { kind: "enum", values: ["happy", "sad"], name: "mood" },
            a_vector: { kind: "vector", dimensions: 3 },
            a_text_array: { kind: "array", of: { kind: "text" } },
            a_uuid_array: { kind: "array", of: { kind: "uuid" } },
            a_enum_array: { kind: "array", of: { kind: "enum", values: ["happy", "sad"], name: "mood" } },
            a_inet: { kind: "other", sqlType: "inet" },
            a_citext: { kind: "other", sqlType: "citext" },
            a_interval: { kind: "other", sqlType: "interval" },
            a_ts: { kind: "other", sqlType: "timestamp without time zone" },
            a_money: { kind: "other", sqlType: "money" },
            a_xml: { kind: "other", sqlType: "xml" },
            a_range: { kind: "other", sqlType: "int4range" },
            a_geometry: { kind: "other", sqlType: "geometry" },
            a_inet_array: { kind: "other", sqlType: "inet[]" }
        });
    });

    it("serves a type Rebase does not create as the driver returns it — a list as an array, the rest as a string", () => {
        const { collections } = lowerIntrospectedTables([t]);
        const properties = collections[0].properties;
        for (const key of ["aInet", "aCitext", "aInterval", "aTs", "aMoney", "aXml", "aRange", "aGeometry"]) {
            expect({ key, type: properties[key]?.type }).toEqual({ key, type: "string" });
        }
        expect(properties.aInetArray?.type).toBe("array");
    });
});

describe("describeTables (runtime) — keys, defaults, generated columns", () => {
    it("classifies defaults, and keeps a generated column and a composite key in key order", () => {
        const meta = metadata({
            columns: [
                column({ table_name: "lines", column_name: "order_no", data_type: "integer", udt_name: "int4", is_nullable: "NO" }),
                column({ table_name: "lines", column_name: "line_no", data_type: "integer", udt_name: "int4", is_nullable: "NO" }),
                column({ table_name: "lines", column_name: "seq", data_type: "bigint", udt_name: "int8", is_identity: "YES", is_nullable: "NO" }),
                column({ table_name: "lines", column_name: "ticket", data_type: "integer", udt_name: "int4", column_default: "nextval('tickets_seq'::regclass)" }),
                column({ table_name: "lines", column_name: "note", column_default: "'none'::text", is_nullable: "NO" }),
                column({ table_name: "lines", column_name: "qty", data_type: "integer", udt_name: "int4", column_default: "1" }),
                column({ table_name: "lines", column_name: "paid", data_type: "boolean", udt_name: "bool", column_default: "false" }),
                column({ table_name: "lines", column_name: "meta", data_type: "jsonb", udt_name: "jsonb", column_default: "'{}'::jsonb" }),
                column({ table_name: "lines", column_name: "at", data_type: "timestamp with time zone", udt_name: "timestamptz", column_default: "now()" }),
                column({ table_name: "lines", column_name: "code", column_default: "gen_short_code()" }),
                column({ table_name: "lines", column_name: "total", data_type: "integer", udt_name: "int4", is_generated: "ALWAYS", generation_expression: "(qty * 2)" }),
                column({ table_name: "lines", column_name: "sku" })
            ],
            pks: [{ table_name: "lines", column_name: "line_no" }, { table_name: "lines", column_name: "order_no" }],
            uniques: [{ table_name: "lines", constraint_name: "lines_sku_key", column_names: ["sku"] }]
        });
        const [lines] = describeTables(meta).tables;
        const c = byKey(lines);
        expect(lines.primaryKey).toEqual(["lineNo", "orderNo"]);
        expect(c.orderNo).toMatchObject({ primaryKey: true, nullable: false });
        expect(c.seq.default).toEqual({ kind: "identity" });
        // A sequence that is not the column's own SERIAL one: Rebase does not create it.
        expect(c.ticket.default).toEqual({ kind: "database" });
        expect(c.note).toMatchObject({ default: { kind: "literal", value: "none" }, nullable: false });
        expect(c.qty.default).toEqual({ kind: "literal", value: 1 });
        expect(c.paid.default).toEqual({ kind: "literal", value: false });
        expect(c.meta.default).toEqual({ kind: "literal", value: {} });
        expect(c.at.default).toEqual({ kind: "sql", expression: "now()" });
        expect(c.code.default).toEqual({ kind: "sql", expression: "gen_short_code()" });
        expect(c.total).toMatchObject({ generated: { expression: "(qty * 2)" }, readOnly: true });
        expect(c.total.default).toBeUndefined();
        expect(c.sku.unique).toBe(true);
        // No stamp at runtime: the server writes nothing the database does not.
        expect(c.at.stamp).toBeUndefined();
    });

    it("keeps a uuid key's random default and a key with none", () => {
        const [t] = describeTables(metadata({
            columns: [uuidKey("a"), column({ table_name: "b", column_name: "code", is_nullable: "NO" })],
            pks: [{ table_name: "a", column_name: "id" }, { table_name: "b", column_name: "code" }]
        })).tables;
        expect(byKey(t).id).toMatchObject({ type: { kind: "uuid" }, default: { kind: "random-uuid" }, primaryKey: true });
    });

    it("keys every column as the runtime always has: camelCase, the column name on a clash, then a number", () => {
        const [t] = describeTables(metadata({
            columns: [
                uuidKey("t"),
                column({ table_name: "t", column_name: "user_name" }),
                column({ table_name: "t", column_name: "userName" }),
                column({ table_name: "t", column_name: "full name" })
            ],
            pks: [{ table_name: "t", column_name: "id" }]
        })).tables;
        expect(t.columns.map(c => [c.column, c.key])).toEqual([
            ["id", "id"],
            ["user_name", "userName"],
            ["userName", "userName_2"],
            ["full name", "fullName"]
        ]);
    });
});

describe("describeTables (runtime) — relations", () => {
    const meta = metadata({
        columns: [
            uuidKey("authors"),
            uuidKey("posts"),
            column({ table_name: "posts", column_name: "author_id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
            column({ table_name: "posts", column_name: "reviewer", data_type: "uuid", udt_name: "uuid" }),
            column({ table_name: "posts", column_name: "title" })
        ],
        pks: [{ table_name: "authors", column_name: "id" }, { table_name: "posts", column_name: "id" }],
        fks: [
            { table_name: "posts", column_name: "author_id", foreign_table_name: "authors", foreign_column_name: "id", delete_rule: "CASCADE" },
            { table_name: "posts", column_name: "reviewer", foreign_table_name: "authors", foreign_column_name: "id", delete_rule: "SET NULL" }
        ]
    });
    const { tables } = describeTables(meta);
    const posts = tableOf(tables, "posts");

    it("turns each foreign key into a belongsTo, its column served under the relation's key", () => {
        expect(posts.relations).toEqual([
            { name: "author", kind: "belongsTo", target: "authors", cardinality: "one", localKey: "author_id", localField: "authorId", onDelete: "cascade", index: false, constraint: true },
            { name: "reviewer", kind: "belongsTo", target: "authors", cardinality: "one", localKey: "reviewer", localField: "reviewer_2", index: false, constraint: true }
        ]);
        // `index: false`: the database holds no index on either column, and the
        // descriptor says what is there.
        expect(byKey(posts).authorId).toMatchObject({ column: "author_id", foreignKeyOf: "author", derived: true, nullable: false });
        // Not a relation of the runtime: no reverse links.
        expect(tableOf(tables, "authors").relations).toEqual([]);
    });

    it("lowers to the very property keys the REST surface has always had", () => {
        const { collections } = lowerIntrospectedTables(tables);
        const lowered = collections.find(c => c.slug === "posts");
        expect(Object.keys(lowered?.properties ?? {})).toEqual(["id", "title", "author", "reviewer"]);
        expect(lowered?.properties.author).toMatchObject({ type: "relation", validation: { required: true } });
        expect(lowered?.securityRules).toBeUndefined();
        expect(lowered?.disableDefaultPolicies).toBeUndefined();
    });

    /**
     * Asserted through the resolver: `assertKnownWriteFields` learns an owning
     * relation's foreign-key column from the resolved relation's `localKey`,
     * which is what makes `author_id` writable on an introspected table.
     */
    it("emits a relation the resolver can read, so the foreign-key column is writable", () => {
        const { collections } = lowerIntrospectedTables(tables);
        const resolved = resolveCollectionRelations(collections.find(c => c.slug === "posts")!);
        expect(Object.keys(resolved)).toEqual(["author", "reviewer"]);
        expect(resolved.author).toMatchObject({ kind: "belongsTo", localKey: "author_id" });
        expect(resolved.author.target().slug).toBe("authors");
    });

    it("keeps a key column that is also a foreign key, and names its relation apart", () => {
        const [areaTag] = describeTables(metadata({
            columns: [
                column({ table_name: "area", column_name: "id", data_type: "integer", udt_name: "int4", is_nullable: "NO" }),
                column({ table_name: "area_tag", column_name: "area", data_type: "integer", udt_name: "int4", is_nullable: "NO" }),
                column({ table_name: "area_tag", column_name: "count", data_type: "integer", udt_name: "int4" })
            ],
            pks: [{ table_name: "area", column_name: "id" }, { table_name: "area_tag", column_name: "area" }],
            fks: [{ table_name: "area_tag", column_name: "area", foreign_table_name: "area", foreign_column_name: "id" }]
        })).tables.filter(t => t.slug === "area_tag");
        expect(byKey(areaTag).area).toMatchObject({ primaryKey: true, foreignKeyOf: "areaRelation" });
        expect(byKey(areaTag).area.derived).toBeUndefined();
        expect(areaTag.relations.map(r => r.name)).toEqual(["areaRelation"]);
    });

    it("leaves a foreign key no relation can hold as a plain column: composite, or not at the target's key", () => {
        const { tables: described, notes } = describeTables(metadata({
            columns: [
                column({ table_name: "parent", column_name: "a", data_type: "integer", udt_name: "int4", is_nullable: "NO" }),
                column({ table_name: "parent", column_name: "b", data_type: "integer", udt_name: "int4", is_nullable: "NO" }),
                column({ table_name: "parent", column_name: "code", is_nullable: "NO" }),
                uuidKey("child"),
                column({ table_name: "child", column_name: "pa", data_type: "integer", udt_name: "int4" }),
                column({ table_name: "child", column_name: "pb", data_type: "integer", udt_name: "int4" }),
                column({ table_name: "child", column_name: "parent_code" })
            ],
            pks: [{ table_name: "parent", column_name: "a" }, { table_name: "parent", column_name: "b" }, { table_name: "child", column_name: "id" }],
            fks: [
                { table_name: "child", column_name: "pa", foreign_table_name: "parent", foreign_column_name: "a", constraint_name: "child_p_fkey" },
                { table_name: "child", column_name: "pb", foreign_table_name: "parent", foreign_column_name: "b", constraint_name: "child_p_fkey" },
                { table_name: "child", column_name: "parent_code", foreign_table_name: "parent", foreign_column_name: "code", constraint_name: "child_code_fkey" }
            ]
        }));
        const child = tableOf(described, "child");
        expect(child.relations).toEqual([]);
        expect(child.columns.map(c => c.key)).toEqual(["id", "pa", "pb", "parentCode"]);
        expect(notes.get("child")).toEqual([
            expect.stringContaining("the foreign key child_p_fkey spans (pa, pb)"),
            expect.stringContaining("\"parent_code\" references parent(code)")
        ]);
    });
});

describe("describeTables (runtime) — row-level security", () => {
    const meta = metadata({
        columns: [uuidKey("posts"), uuidKey("secrets"), uuidKey("locked"), uuidKey("tags"),
            column({ table_name: "posts_tags", column_name: "post_id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
            column({ table_name: "posts_tags", column_name: "tag_id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" })],
        pks: [
            { table_name: "posts", column_name: "id" }, { table_name: "secrets", column_name: "id" },
            { table_name: "locked", column_name: "id" }, { table_name: "tags", column_name: "id" },
            { table_name: "posts_tags", column_name: "post_id" }, { table_name: "posts_tags", column_name: "tag_id" }
        ],
        fks: [
            { table_name: "posts_tags", column_name: "post_id", foreign_table_name: "posts", foreign_column_name: "id" },
            { table_name: "posts_tags", column_name: "tag_id", foreign_table_name: "tags", foreign_column_name: "id" }
        ],
        rlsOff: ["secrets", "posts_tags"],
        policies: [
            { table_name: "posts", policy_name: "posts_read", permissive: "PERMISSIVE", roles: ["public"], cmd: "SELECT", qual: "(author_id = rebase.uid())", with_check: null },
            { table_name: "posts", policy_name: "posts_admins", permissive: "RESTRICTIVE", roles: ["rebase_user"], cmd: "ALL", qual: "true", with_check: "true" }
        ]
    });

    it("leaves a table with RLS off out, with the SQL that protects it", () => {
        const result = describeTables(meta);
        expect(result.tables.map(t => t.slug)).toEqual(["posts", "locked", "tags"]);
        expect(result.skipped).toEqual([{
            table: "secrets",
            reason: expect.stringContaining("row-level security is disabled"),
            remediationSql: rlsRemediationSql("public", "secrets")
        }]);
        expect(rlsRemediationSql("public", "secrets")).toBe(
            "ALTER TABLE \"public\".\"secrets\" ENABLE ROW LEVEL SECURITY;\n" +
            "CREATE POLICY \"secrets_owner\" ON \"public\".\"secrets\" FOR ALL TO public USING (owner_id = rebase.uid());  -- an example: write the condition that fits"
        );
        expect(result.junctions).toEqual([{ table: "posts_tags", rlsEnabled: false }]);
        expect(result.unprotected).toEqual([]);
    });

    it("states the catalogue's policies as the rules, and RLS on with no policy as closed", () => {
        const { tables } = describeTables(meta);
        expect(tableOf(tables, "posts").rls).toEqual({
            posture: "rules",
            rules: [
                { name: "posts_read", operation: "select", mode: "permissive", using: "(author_id = rebase.uid())" },
                { name: "posts_admins", operation: "all", mode: "restrictive", pgRoles: ["rebase_user"], using: "true", withCheck: "true" }
            ],
            defaultPolicies: false
        });
        expect(tableOf(tables, "locked").rls).toEqual({ posture: "rules", rules: [], defaultPolicies: false });
    });

    it("serves an unprotected table only when asked, saying every caller reaches every row", () => {
        const result = describeTables(meta, { unprotectedTables: "serve" });
        expect(result.skipped).toEqual([]);
        expect(result.unprotected).toEqual(["secrets"]);
        expect(tableOf(result.tables, "secrets").rls).toEqual({
            posture: "rules",
            rules: [{ name: "secrets_rls_disabled", operations: ["all"], access: "public" }],
            defaultPolicies: false
        });
    });
});

describe("lowerIntrospectedTables", () => {
    it("drops a descriptor no definition can state, and the relations into it, serving the rest", () => {
        const { tables } = describeTables(metadata({
            columns: [uuidKey("authors"), uuidKey("posts"), column({ table_name: "posts", column_name: "author_id", data_type: "uuid", udt_name: "uuid" })],
            pks: [{ table_name: "authors", column_name: "id" }, { table_name: "posts", column_name: "id" }],
            fks: [{ table_name: "posts", column_name: "author_id", foreign_table_name: "authors", foreign_column_name: "id" }]
        }));
        const broken = tables.map(t => t.slug === "authors" ? { ...t, schema: "not-an-identifier" } : t);
        const lowered = lowerIntrospectedTables(broken);
        expect(lowered.dropped).toEqual([{ table: "authors", reason: expect.stringContaining("must be a plain SQL identifier") }]);
        expect(lowered.tables.map(t => t.slug)).toEqual(["posts"]);
        expect(lowered.tables[0].relations).toEqual([]);
        expect(byKey(lowered.tables[0]).authorId).toMatchObject({ column: "author_id" });
        expect(byKey(lowered.tables[0]).authorId.foreignKeyOf).toBeUndefined();
        expect(Object.keys(lowered.collections[0].properties)).toEqual(["id", "authorId"]);
    });
});

describe("introspectTables", () => {
    it("reads the catalogue with the schema-metadata queries, every one scoped to the schema", async () => {
        const seen: { text: string; values: unknown[] }[] = [];
        const answers = new Map<string, unknown[]>([
            [TABLES_QUERY, [{ table_name: "notes", rls_enabled: true }]],
            [COLUMNS_QUERY, [column({ table_name: "notes", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO" })]],
            [PRIMARY_KEYS_QUERY, [{ table_name: "notes", column_name: "id" }]],
            [POLICIES_QUERY, [{ table_name: "notes", policy_name: "notes_all", permissive: "PERMISSIVE", roles: "{public}", cmd: "ALL", qual: "true", with_check: null }]]
        ]);
        const client: QueryableClient = {
            query: async <R>(text: string, values?: unknown[]) => {
                seen.push({ text, values: values ?? [] });
                const rows: unknown[] = answers.get(text) ?? [];
                return { rows: rows as R[] };
            }
        };
        const result = await introspectTables(client, "analytics");
        expect(seen.map(call => call.text)).toEqual([
            TABLES_QUERY, COLUMNS_QUERY, ENUMS_QUERY, PRIMARY_KEYS_QUERY, FOREIGN_KEYS_QUERY,
            UNIQUE_CONSTRAINTS_QUERY, INDEXES_QUERY, CHECK_CONSTRAINTS_QUERY, COMMENTS_QUERY, POLICIES_QUERY
        ]);
        for (const call of seen) expect(call.values).toEqual(["analytics"]);
        expect(result.tables.map(t => [t.slug, t.schema])).toEqual([["notes", "analytics"]]);
        expect(result.tables[0].rls.rules).toEqual([{ name: "notes_all", operation: "all", mode: "permissive", using: "true" }]);
    });
});

describe("introspectSchema", () => {
    it("scopes every query to the requested schema", async () => {
        const calls: unknown[][] = [];
        const client: Queryable = {
            query: async (_text: string, values?: unknown[]) => {
                calls.push(values ?? []);
                return { rows: [] };
            }
        };

        await introspectSchema(client, "analytics");

        expect(calls.length).toBeGreaterThan(0);
        for (const values of calls) {
            expect(values).toEqual(["analytics"]);
        }
    });
});
