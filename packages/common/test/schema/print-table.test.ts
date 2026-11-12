import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";
import { col, defineAuthTable, defineTable, defineView, json, rel } from "@rebasepro/types";
import type { AnyTableDef, AnyViewDef, ColumnDef, TableDescriptor } from "@rebasepro/types";

import { compileTables } from "../../src/schema/compile-tables";
import {
    COLUMN_MODIFIER_ORDER,
    TablePrintError,
    printByteSize,
    printColumn,
    printIndexModule,
    printIndexes,
    printJsonShape,
    printRelation,
    printRls,
    printTableModule,
    printTableSource,
    tableIdentifier
} from "../../src/schema/print-table";
import type { PrintTableOptions, PrintTargetResolver } from "../../src/schema/print-table";
import * as schemaIndex from "../../src/schema";
import { comparable, comparableColumn, evaluateColumn, evaluateModules } from "./print-eval";
import {
    DEFAULT_RLS,
    FIXTURE_HOOKS,
    FIXTURE_TRANSFORMS,
    PRINT_FIXTURES,
    TRANSFORM_SOURCE,
    kitchen,
    postStats,
    posts,
    publishedPosts,
    users
} from "./print-table.fixtures";
import { SPEC_POSTS_EXAMPLE } from "./print-table.spec-example";

/**
 * `printTableModule` and friends: one deterministic printer from a table
 * definition (or a compiled descriptor) to `defineTable` source, shared by the
 * codemod, introspection and the Studio editor.
 *
 * Three kinds of proof: golden strings for every builder, modifier, relation
 * kind and rls posture; a round trip through evaluation for every fixture
 * (`evaluate(print(def))` deep-equals `def`, and the compiled descriptors
 * agree); and lint of a printed module under the repository's config. The
 * property suite over random columns is `test/property/print-table.property.test.ts`.
 */

const optionsFor = (name: string): PrintTableOptions => ({
    sources: { transforms: FIXTURE_TRANSFORMS[name], hooks: FIXTURE_HOOKS[name] }
});

/** The column chain of one builder. */
const chain = (builder: { def: ColumnDef }, key?: string): string => printColumn(builder.def, { key });

describe("printColumn — golden chains", () => {
    it.each([
        [col.uuid().primaryKey().defaultRandom(), "col.uuid().primaryKey().defaultRandom()"],
        [col.text(), "col.text()"],
        [col.varchar(160).notNull().unique(), "col.varchar({ length: 160 }).notNull().unique()"],
        [col.varchar(), "col.varchar({ length: 255 })"],
        [col.varchar(255), "col.varchar({ length: 255 })"],
        [col.char(2), "col.char({ length: 2 })"],
        [col.enum(["draft", "published"]).notNull().default("draft"), "col.enum([\"draft\", \"published\"]).notNull().default(\"draft\")"],
        [col.enum(["a", "b"], { name: "ab_type" }), "pgEnum(\"ab_type\", [\"a\", \"b\"])()"],
        [col.smallint(), "col.smallint()"],
        [col.integer().primaryKey().identity(), "col.integer().primaryKey().generatedByDefaultAsIdentity()"],
        [col.bigint().default(10), "col.bigint({ mode: \"number\" }).default(10)"],
        [col.smallserial(), "col.smallserial()"],
        [col.serial().primaryKey(), "col.serial().primaryKey()"],
        [col.bigserial(), "col.bigserial({ mode: \"number\" })"],
        [col.real(), "col.real()"],
        [col.doublePrecision().validate({ min: 0 }), "col.doublePrecision().validate({ min: 0 })"],
        [col.numeric(), "col.numeric()"],
        [col.numeric(10), "col.numeric({ precision: 10 })"],
        [col.numeric(10, 2).default(0), "col.numeric({ precision: 10, scale: 2 }).default(0)"],
        [col.boolean().default(false), "col.boolean().default(false)"],
        [col.timestamptz().notNull().onCreateNow(), "col.timestamp({ withTimezone: true }).notNull().onCreateNow()"],
        [col.timestamptz().notNull().onUpdateNow(), "col.timestamp({ withTimezone: true }).notNull().onUpdateNow()"],
        [col.date().validate({ min: new Date("2020-01-01T00:00:00.000Z") }), "col.date().validate({ min: \"2020-01-01T00:00:00.000Z\" })"],
        [col.time(), "col.time()"],
        [col.jsonb(), "col.jsonb()"],
        [col.json(), "col.json()"],
        [col.jsonb(json.object({ seoTitle: json.string() })), "col.jsonb(json.object({ seoTitle: json.string() }))"],
        [col.array(col.text().oneOf(["a", "b"])), "col.text({ enum: [\"a\", \"b\"] }).array()"],
        [col.array(col.uuid()).notNull().default([]), "col.uuid().array().notNull().default([])"],
        [col.vector(1536), "col.vector({ dimensions: 1536 })"],
        [col.vector(1536, { index: { method: "hnsw", metric: "cosine" } }), "col.vector({ dimensions: 1536, index: { method: \"hnsw\", metric: \"cosine\" } })"],
        [col.vector(3, { index: false }), "col.vector({ dimensions: 3, index: false })"],
        [col.bytea(), "col.bytea()"],
        [col.geopoint().notNull(), "col.geopoint().notNull()"],
        [
            col.storage({ path: "posts/heroes/", accept: ["image/*"], maxBytes: "10MB" }),
            "col.storage({ path: \"posts/heroes/\", accept: [\"image/*\"], maxBytes: \"10MB\" })"
        ],
        [col.storage({ path: "g/" }).multiple(), "col.storage({ path: \"g/\" }).multiple()"],
        [
            col.storage({ path: "g/" }).validate({ max: 80 }).multiple().notNull().validate({ maxItems: 3 }),
            "col.storage({ path: \"g/\" }).validate({ max: 80 }).multiple().notNull().validate({ maxItems: 3 })"
        ],
        [col.array(col.storage({ path: "g/" })), "col.storage({ path: \"g/\" }).multiple()"],
        [col.uuid().onCreateUser(), "col.uuid().onCreateUser()"],
        [col.uuid().onUpdateUser(), "col.uuid().onUpdateUser()"],
        [col.uuid().userId(), "col.uuid().userId()"],
        [col.varchar(36).notNull().userId(), "col.varchar({ length: 36 }).notNull().userId()"],
        [col.array(col.text().userId()), "col.text().userId().array()"],
        [col.text().defaultSql("gen_short_id()"), "col.text().default(sql`gen_short_id()`)"],
        [col.text().dbDefault(), "col.text().dbDefault()"],
        [col.integer().generatedAs("length(title)"), "col.integer().generatedAlwaysAs(sql`length(title)`)"],
        [col.integer().oneOf([1, 2, 3]), "col.integer().oneOf([1, 2, 3])"],
        [col.text().readOnly(), "col.text().readOnly()"],
        [col.text().private(), "col.text().private()"],
        [col.text().access({ read: ["admin"], write: [] }), "col.text().access({ read: [\"admin\"], write: [] })"],
        [col.text().describe("What it is"), "col.text().describe(\"What it is\")"],
        [col.text().validate({ matches: /^a\/b$/i }), "col.text().validate({ matches: /^a\\/b$/i })"],
        [col.text().validate({ matches: "^\\d+$" }), "col.text().validate({ matches: /^\\d+$/ })"],
        [col.text().validate({ matches: "^[a-z]+$" }), "col.text().validate({ matches: \"^[a-z]+$\" })"],
        [col.text().validate({ matches: "^[a-z]+$", matchesFlags: "" }), "col.text().validate({ matches: \"^[a-z]+$\", matchesFlags: \"\" })"]
    ])("%#: %s", (builder, expected) => {
        expect(chain(builder)).toBe(expected);
        expect(comparableColumn(evaluateColumn(expected), undefined)).toEqual(comparableColumn(builder.def, undefined));
    });

    it("prints every modifier in the canonical order", () => {
        const builder = col.text()
            .describe("d")
            .access({ read: ["a"] })
            .private()
            .validate({ min: 1 })
            .oneOf(["x"])
            .userId()
            .onCreateUser()
            .defaultSql("x()")
            .unique()
            .notNull()
            .column("legacy_name");
        expect(printColumn(builder.def, { key: "name", transform: TRANSFORM_SOURCE })).toBe(
            "col.text(\"legacy_name\").notNull().unique().default(sql`x()`).onCreateUser().userId().oneOf([\"x\"])" +
            `.validate({ min: 1 }).transform(${TRANSFORM_SOURCE}).private().access({ read: ["a"] }).describe("d")`
        );
        expect(COLUMN_MODIFIER_ORDER).toEqual([
            "primaryKey", "notNull", "unique", "default", "generatedAlwaysAs", "stamp", "userId",
            "oneOf", "validate", "transform", "readOnly", "private", "access", "describe"
        ]);
    });

    it("leaves the SQL name out when it is the snake_case of the key, and writes it as the builder's first argument otherwise", () => {
        expect(chain(col.text().column("display_name"), "displayName")).toBe("col.text()");
        expect(chain(col.text().column("display_name"))).toBe("col.text(\"display_name\")");
        expect(chain(col.text().column("DisplayName"), "displayName")).toBe("col.text(\"DisplayName\")");
    });

    it("leaves out what a modifier implies: NOT NULL under a primary key, read-only under generatedAs", () => {
        expect(chain(col.uuid().notNull().primaryKey())).toBe("col.uuid().primaryKey()");
        expect(chain(col.integer().generatedAs("1").readOnly())).toBe("col.integer().generatedAlwaysAs(sql`1`)");
    });

    it("prints sizes human-readable only when exact", () => {
        expect(printByteSize(10 * 1024 * 1024)).toBe("\"10MB\"");
        expect(printByteSize(1024)).toBe("\"1KB\"");
        expect(printByteSize(2 * 1024 ** 3)).toBe("\"2GB\"");
        expect(printByteSize(3 * 1024 ** 4)).toBe("\"3TB\"");
        expect(printByteSize(1500)).toBe("1500");
        expect(printByteSize(0)).toBe("0");
        expect(chain(col.storage({ path: "a/", maxBytes: "1.5MB" }))).toBe("col.storage({ path: \"a/\", maxBytes: \"1536KB\" })");
    });

    it("prints a JSON shape with every node kind and modifier", () => {
        const shape = json.object({
            title: json.string().required().default("x").oneOf(["x", "y"]).validate({ max: 60 }).describe("t"),
            at: json.date().onCreateNow(),
            by: json.string().onCreateUser(),
            editor: json.string().required().onUpdateUser(),
            owner: json.string().userId(),
            n: json.number(),
            ok: json.boolean(),
            where: json.geopoint(),
            any: json.unknown(),
            file: json.storage({ path: "f/" }),
            list: json.array(json.string()).validate({ maxItems: 2 }),
            block: json.oneOf({ a: json.string() }, { typeField: "t", valueField: "v" })
        }, { additional: true });
        expect(printJsonShape(shape.shape)).toBe([
            "json.object({",
            "    title: json.string().required().default(\"x\").oneOf([\"x\", \"y\"]).validate({ max: 60 }).describe(\"t\"),",
            "    at: json.date().onCreateNow(),",
            "    by: json.string().onCreateUser(),",
            "    editor: json.string().required().onUpdateUser(),",
            "    owner: json.string().userId(),",
            "    n: json.number(),",
            "    ok: json.boolean(),",
            "    where: json.geopoint(),",
            "    any: json.unknown(),",
            "    file: json.storage({ path: \"f/\" }),",
            "    list: json.array(json.string()).validate({ maxItems: 2 }),",
            "    block: json.oneOf({ a: json.string() }, { typeField: \"t\", valueField: \"v\" })",
            "}, { additional: true })"
        ].join("\n"));
    });

    it("prints an array's `uniqueBy`", () => {
        const shape = json.array(json.object({ sku: json.string(), qty: json.number() })).validate({ uniqueBy: ["sku"], maxItems: 50 });
        expect(printJsonShape(shape.shape)).toBe(
            "json.array(json.object({ sku: json.string(), qty: json.number() })).validate({ uniqueBy: [\"sku\"], maxItems: 50 })");
    });

    it("prints a transform from its source, and refuses one without", () => {
        const builder = col.text().transform({ beforeSave: ({ value }) => value?.trim() ?? null });
        expect(printColumn(builder.def, { transform: TRANSFORM_SOURCE })).toBe(`col.text().transform(${TRANSFORM_SOURCE})`);
        expect(() => printColumn(builder.def, { key: "title" })).toThrow(TablePrintError);
        expect(() => printColumn(builder.def, { key: "title" })).toThrow(/title\.transform.*source text/);
        const nested = col.jsonb(json.object({ a: json.string().transform({ afterRead: ({ value }) => value }) }));
        expect(() => printColumn(nested.def, { key: "doc" })).toThrow(/transforms\["a"\]/);
        expect(printColumn(nested.def, { transforms: { a: "{}" } })).toBe("col.jsonb(json.object({ a: json.string().transform({}) }))");
        const element = col.array(col.text().transform({ afterRead: ({ value }) => value }));
        expect(() => printColumn(element.def)).toThrow(/transforms\["\[\]"\]/);
        expect(printColumn(element.def, { transforms: { "[]": "{}" } })).toBe("col.text().transform({}).array()");
    });

    it("refuses `.userId()` where no builder accepts it", () => {
        const flags = { notNull: false, primaryKey: false, unique: false, readOnly: false, private: false };
        expect(() => printColumn({ type: { kind: "integer" }, ...flags, semantic: "user" }, { key: "owner" }))
            .toThrow("owner: `.userId()` on a `integer` column; it applies to text, varchar, char and uuid columns.");
        expect(() => printColumn({ type: { kind: "text" }, ...flags, semantic: "user", storage: { path: "a/" } }, { key: "owner" }))
            .toThrow(/`\.userId\(\)` on a storage column/);
        expect(() => printJsonShape({ kind: "string", storage: { path: "a/" }, semantic: "user" })).toThrow(/`\.userId\(\)` on `json\.storage\(\)`/);
    });

    it("prints a type no other builder names as `col.custom(sqlType)`, and it evaluates back to the same column", () => {
        const flags = { notNull: false, primaryKey: false, unique: false, readOnly: false, private: false };
        const printed = printColumn({ type: { kind: "other", sqlType: "geometry(Point, 4326)" }, ...flags, notNull: true });
        expect(printed).toBe("col.custom({ dataType: \"geometry(Point, 4326)\" }).notNull()");
        expect(evaluateColumn(printed)).toEqual({ type: { kind: "other", sqlType: "geometry(Point, 4326)" }, ...flags, notNull: true });
        expect(printColumn(col.custom("inet[]").def)).toBe("col.custom({ dataType: \"inet[]\" })");
    });
});

describe("printRls", () => {
    it("prints the two postures and the rules, one per line, keys in the order written", () => {
        expect(printRls("admin-only")).toBe("\"admin-only\"");
        expect(printRls("inherit")).toBe("\"inherit\"");
        expect(printRls([
            { access: "public", operation: "select", condition: { status: "published" } },
            { roles: ["editor"], operations: ["insert"] }
        ])).toBe([
            "[",
            "    { access: \"public\", operation: \"select\", condition: { status: \"published\" } },",
            "    { roles: [\"editor\"], operations: [\"insert\"] }",
            "]"
        ].join("\n"));
    });

    it("breaks a rule that does not fit on one line", () => {
        const using = "{owner_id} = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['moderator', 'admin', 'support']";
        expect(printRls([{ operation: "select", using, withCheck: "true" }])).toBe([
            "[",
            "    {",
            "        operation: \"select\",",
            `        using: ${JSON.stringify(using)},`,
            "        withCheck: \"true\"",
            "    }",
            "]"
        ].join("\n"));
    });

    it("prints a descriptor's posture as it was written", () => {
        expect(printRls({ posture: "admin-only", rules: [], defaultPolicies: true })).toBe("\"admin-only\"");
        expect(printRls({ posture: "rules", rules: [{ operation: "select", access: "public" }], defaultPolicies: true, inherited: true })).toBe("\"inherit\"");
        // A view's posture is not an `rls` anyone writes.
        expect(() => printRls({ posture: "view", rules: [], defaultPolicies: false })).toThrow("a view has no `rls` of its own");
    });
});

describe("printRelation — every kind", () => {
    const owner = { name: "posts", slug: "posts" };
    const target = defineTable("authors", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });
    it.each([
        [rel.belongsTo(() => target), "rel.belongsTo(() => authors)"],
        [
            rel.belongsTo(() => target, { localKey: "author_id", notNull: true, unique: true, onDelete: "restrict", onUpdate: "cascade", index: false, constraint: false }),
            "rel.belongsTo(() => authors, {\n    localKey: \"author_id\",\n    notNull: true,\n    unique: true,\n    onDelete: \"restrict\",\n    onUpdate: \"cascade\",\n    index: false,\n    constraint: false\n})"
        ],
        [rel.hasOne(() => target, { foreignKey: "post_id", sourceKey: "code" }), "rel.hasOne(() => authors, { foreignKey: \"post_id\", sourceKey: \"code\" })"],
        [rel.hasMany(() => target, { orderBy: ["name", "asc"] }), "rel.hasMany(() => authors, { orderBy: [\"name\", \"asc\"] })"],
        [
            rel.manyToMany(() => target, { through: "posts_authors", sourceKey: "post_id", targetKey: "author_id", onDelete: "cascade" }),
            "rel.manyToMany(() => authors, {\n    through: \"posts_authors\",\n    sourceKey: \"post_id\",\n    targetKey: \"author_id\",\n    onDelete: \"cascade\"\n})"
        ],
        [
            rel.manyToMany(() => target, { pivot: { role: col.text().notNull() } }),
            "rel.manyToMany(() => authors, {\n    pivot: {\n        role: col.text().notNull()\n    }\n})"
        ],
        [
            rel.via(() => target, { steps: [{ table: "authors", on: { from: "author_id", to: "id" } }], cardinality: "one" }),
            "rel.via(() => authors, { steps: [{ table: \"authors\", on: { from: \"author_id\", to: \"id\" } }], cardinality: \"one\" })"
        ],
        [rel.hasMany(() => target, { access: { read: ["admin"], write: [] } }), "rel.hasMany(() => authors, { access: { read: [\"admin\"], write: [] } })"],
        [rel.belongsTo(() => target, { private: true }), "rel.belongsTo(() => authors, { private: true })"]
    ])("%#", (relation, expected) => {
        expect(printRelation("author", relation)).toBe(expected);
    });

    it("uses the caller's identifier for the target", () => {
        const resolveTarget: PrintTargetResolver = t => ({ identifier: `${t.name ?? t.slug}Table`, importPath: "./elsewhere" });
        expect(printRelation("author", rel.belongsTo(() => target), { resolveTarget })).toBe("rel.belongsTo(() => authorsTable)");
        void owner;
    });

    it("prints a descriptor's relation without the names the compiler derives", () => {
        const [descriptor] = compileTables([posts, users, ...PRINT_FIXTURES.filter(def => def !== posts && def !== users)], { defaultRls: DEFAULT_RLS });
        const author = descriptor.relations.find(relation => relation.name === "author");
        if (!author) throw new Error("no author relation");
        expect(printRelation("author", author, { owner: descriptor })).toBe("rel.belongsTo(() => users, { notNull: true, onDelete: \"restrict\" })");
        expect(() => printRelation("author", author)).toThrow(/context\.owner/);
    });
});

describe("printTableSource / printTableModule", () => {
    it("reproduces the spec's §4.1 example, token for token", () => {
        const hook = (name: string, next: string): string => {
            const start = SPEC_POSTS_EXAMPLE.indexOf(`${name}: `) + name.length + 2;
            const end = SPEC_POSTS_EXAMPLE.lastIndexOf("}", SPEC_POSTS_EXAMPLE.indexOf(next, start)) + 1;
            return SPEC_POSTS_EXAMPLE.slice(start, end);
        };
        const beforeSave = hook("beforeSave", "afterRead:");
        const afterRead = hook("afterRead", "\n    },\n});");
        const specUsers = defineAuthTable("users", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });
        const specTags = defineTable("tags", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });
        const spec = defineTable("posts", {
            slug: "posts",
            schema: "public",
            columns: {
                id: col.uuid().primaryKey().defaultRandom(),
                title: col.text().notNull().validate({ min: 3, max: 200 }),
                slug: col.varchar(160).notNull().unique(),
                status: col.enum(["draft", "needs_review", "published", "archived"]).notNull().default("draft"),
                heroImage: col.storage({ path: "posts/heroes/", accept: ["image/*"], maxBytes: "10MB" }),
                embedding: col.vector(1536, { index: { method: "hnsw", metric: "cosine" } }),
                metadata: col.jsonb<{ seoTitle?: string; canonicalUrl?: string }>(),
                publishDate: col.timestamptz(),
                orgId: col.uuid().notNull(),
                createdAt: col.timestamptz().notNull().onCreateNow(),
                updatedAt: col.timestamptz().notNull().onUpdateNow(),
                deletedAt: col.timestamptz(),
                __order: col.text()
            },
            relations: {
                author: rel.belongsTo(() => specUsers, { localKey: "author_id", notNull: true, onDelete: "restrict" }),
                tags: rel.manyToMany(() => specTags, { through: "posts_tags", pivot: { addedBy: col.uuid(), sortOrder: col.integer().default(0) } })
            },
            rls: [
                { operation: "select", access: "public", condition: { status: "published" } },
                { operations: ["select", "insert", "update"], roles: ["editor"] },
                { operation: "delete", roles: ["admin"] }
            ],
            tenant: { field: "orgId", from: { claim: "org_id" } },
            softDelete: { field: "deletedAt" },
            history: true,
            search: { fields: ["title"], language: "english" },
            indexes: [{ columns: ["orgId", "status", "publishDate"] }],
            hooks: { beforeSave: ({ values }) => values, afterRead: ({ values }) => values }
        });
        const printed = printTableSource(spec, { sources: { hooks: { beforeSave, afterRead } } });
        const tokens = (source: string): string => source
            .replace(/\/\/[^\n]*/g, "")
            .replace(/\s+/g, "")
            .replace(/,([}\])])/g, "$1");
        // The one thing a definition cannot say: the static type argument of
        // `col.jsonb<T>()` is erased at runtime, so the printer writes `col.jsonb()`.
        // And the spec as given predates the Drizzle spelling (drizzle-alignment.md):
        // the printer writes each of its old spellings the Drizzle way.
        const expected = SPEC_POSTS_EXAMPLE
            .replace("col.jsonb<{ seoTitle?: string; canonicalUrl?: string }>()", "col.jsonb()")
            .replace("col.varchar(160)", "col.varchar({ length: 160 })")
            .replace("col.vector(1536, { index:", "col.vector({ dimensions: 1536, index:")
            .replaceAll("col.timestamptz()", "col.timestamp({ withTimezone: true })");
        expect(tokens(printed.code)).toBe(tokens(expected));
        expect(printed.imports).toEqual({
            specifier: "@rebasepro/server/schema",
            builders: ["defineTable", "col", "rel"],
            tables: [{ identifier: "users", importPath: "./users" }, { identifier: "tags", importPath: "./tags" }]
        });
    });

    it("prints a whole module: imports, then the export", () => {
        expect(printTableModule(postStats)).toBe([
            "import { defineView, col } from \"@rebasepro/server/schema\";",
            "",
            "export const postStats = defineView(\"post_stats\", {",
            "    slug: \"post-stats\",",
            "    table: \"post_stats_mv\",",
            "    schema: \"reports\",",
            "    query: `select",
            "    status,",
            "    count(*) as total",
            "from posts",
            "group by status`,",
            "    materialized: true,",
            "    roles: [\"admin\", \"analyst\"],",
            "    columns: {",
            "        status: col.text().primaryKey(),",
            "        total: col.bigint({ mode: \"number\" }).notNull()",
            "    },",
            "    indexes: [{ columns: [\"total\"] }],",
            "    metadata: { refresh: \"hourly\" }",
            "});",
            ""
        ].join("\n"));
    });

    it("prints a plain view, with its relation and read hook", () => {
        expect(printTableModule(publishedPosts, optionsFor("published_posts"))).toBe([
            "import { defineView, col, rel } from \"@rebasepro/server/schema\";",
            "import { posts } from \"./posts\";",
            "",
            "export const publishedPosts = defineView(\"published_posts\", {",
            "    description: \"Posts anyone can read\",",
            "    query: \"select id, title from posts where status = 'published'\",",
            "    columns: {",
            "        id: col.uuid().primaryKey(),",
            "        title: col.text().notNull()",
            "    },",
            "    relations: {",
            "        post: rel.belongsTo(() => posts, { localKey: \"id\" })",
            "    },",
            "    hooks: {",
            "        afterRead: ({ values }) => values",
            "    }",
            "});",
            ""
        ].join("\n"));
    });

    it("prints an auth table, its auth options last", () => {
        expect(printTableModule(users)).toBe([
            "import { defineAuthTable, col } from \"@rebasepro/server/schema\";",
            "",
            "export const users = defineAuthTable(\"users\", {",
            "    schema: \"rebase\",",
            "    columns: {",
            "        id: col.uuid().primaryKey().defaultRandom(),",
            "        email: col.text().notNull().unique().validate({ email: true, lowercase: true, trim: true }),",
            "        roles: col.text({ enum: [\"admin\", \"editor\"] }).array().notNull().default([]),",
            "        passwordHash: col.text().private(),",
            "        displayName: col.varchar({ length: 120 }).describe(\"What the user is called in the panel\")",
            "    },",
            "    rls: \"admin-only\",",
            "    auth: {",
            "        personalKeys: true,",
            "        roles: { editor: { name: \"Editor\", scopes: [\"data:read\", \"data:write\"] } },",
            "        scopes: { \"reports:run\": { label: \"Run reports\" } }",
            "    }",
            "});",
            ""
        ].join("\n"));
    });

    it("prints the user-lifecycle functions of an auth table from their source, and refuses them without", () => {
        const table = defineAuthTable("members", {
            columns: { id: col.uuid().primaryKey() },
            rls: "admin-only",
            auth: { onResetPassword: async () => ({}) }
        });
        expect(() => printTableSource(table)).toThrow(/members\.auth\.onResetPassword/);
        expect(printTableSource(table, { sources: { auth: { onResetPassword: "async () => ({})" } } }).code).toContain("auth: { onResetPassword: async () => ({}) }");
    });

    it("prints a descriptor's user-lifecycle hook flags from their source, and refuses them without", () => {
        const table = defineAuthTable("members", {
            columns: { id: col.uuid().primaryKey() },
            rls: "admin-only",
            auth: { personalKeys: true, onCreateUser: async values => ({ values }), onResetPassword: async () => ({}) }
        });
        const [descriptor] = compileTables([table]);
        expect(() => printTableSource(descriptor)).toThrow(/members\.auth\.onCreateUser/);
        const sources = { auth: { onCreateUser: "inviteUser", onResetPassword: "sendReset" } };
        expect(printTableSource(descriptor, { sources }).code).toContain("auth: { personalKeys: true, onCreateUser: inviteUser, onResetPassword: sendReset }");
    });

    it("refuses a hook without its source, and takes the whole `hooks` expression as one string", () => {
        expect(() => printTableSource(posts, { sources: { transforms: FIXTURE_TRANSFORMS.posts } })).toThrow(/posts\.hooks\.beforeSave/);
        const code = printTableSource(posts, { sources: { transforms: FIXTURE_TRANSFORMS.posts, hooks: "postHooks" } }).code;
        expect(code).toContain("    hooks: postHooks\n});");
    });

    it("refuses a value that is not data, an unknown option and an unusable identifier", () => {
        const withFunction = defineTable("odd", {
            columns: { id: col.uuid().primaryKey() },
            rls: "admin-only",
            metadata: { compute: () => 1 }
        });
        expect(() => printTableSource(withFunction)).toThrow(/odd\.metadata\.compute.*function/);
        expect(() => printTableSource(withFunction, { identifier: "class" })).toThrow(/not a usable identifier/);
        const relation = { ...rel.belongsTo(() => users), cascade: true };
        const unknownOption = defineTable("odd2", { columns: { id: col.uuid().primaryKey() }, relations: { u: relation }, rls: "admin-only" });
        expect(() => printTableSource(unknownOption)).toThrow(/odd2\.relations\.u\.cascade.*not an option/);
    });

    it("chooses a valid, non-reserved identifier", () => {
        expect(tableIdentifier("posts")).toBe("posts");
        expect(tableIdentifier("blog_posts")).toBe("blogPosts");
        expect(tableIdentifier("2024_archive")).toBe("t2024Archive");
        expect(tableIdentifier("delete")).toBe("deleteTable");
        expect(tableIdentifier("json")).toBe("jsonTable");
        expect(printTableSource(posts, { ...optionsFor("posts"), identifier: "postsTable" }).code.startsWith("export const postsTable = defineTable(\"posts\", {")).toBe(true);
    });

    it("imports `json` only when a shape uses it, and every related table once", () => {
        const printed = printTableSource(posts, optionsFor("posts"));
        expect(printed.imports.builders).toEqual(["defineTable", "col", "rel", "json", "sql"]);
        expect(printed.imports.tables).toEqual([
            { identifier: "users", importPath: "./users" },
            { identifier: "tags", importPath: "./tags" },
            { identifier: "comments", importPath: "./comments" }
        ]);
        const accountsModule = printTableModule(PRINT_FIXTURES[5]);
        expect(accountsModule.split("\n").slice(0, 3)).toEqual([
            "import { defineTable, col, rel } from \"@rebasepro/server/schema\";",
            "import { profiles } from \"./profiles\";",
            "import { tags } from \"./tags\";"
        ]);
    });

    it("writes every thunk plainly, cycles included: a `TableThunk` needs no annotation", () => {
        const accountsModule = printTableModule(PRINT_FIXTURES[5]);
        // Self-references and accounts ↔ profiles close a cycle; tags does not. All print alike.
        expect(accountsModule).toContain("profile: rel.hasOne(() => profiles, { foreignKey: \"account_id\" })");
        expect(accountsModule).toContain("parent: rel.belongsTo(() => accounts)");
        expect(accountsModule).toContain("tags: rel.manyToMany(() => tags, { private: true })");
        expect(accountsModule).not.toContain("RelationTarget");
        const postsCode = printTableSource(posts, optionsFor("posts")).code;
        expect(postsCode).toContain("comments: rel.hasMany(() => comments, {");
        expect(postsCode).toContain("author: rel.belongsTo(() => users, {");
    });

    it("takes the import specifier and extra import lines from the caller", () => {
        const module = printTableModule(users, { specifier: "@rebasepro/types", extraImports: ["import { hashPassword } from \"../auth\";"] });
        expect(module.split("\n").slice(0, 3)).toEqual([
            "import { defineAuthTable, col } from \"@rebasepro/types\";",
            "import { hashPassword } from \"../auth\";",
            ""
        ]);
    });

    it("is deterministic", () => {
        for (const def of PRINT_FIXTURES) {
            const options = optionsFor(def.name);
            expect(printTableModule(def, options)).toBe(printTableModule(def, options));
        }
    });

    it("prints indexes", () => {
        expect(printIndexes([{ columns: ["a", { column: "b", direction: "desc", nulls: "last" }], where: { column: "a", op: "is null" } }]))
            .toBe("[{ columns: [\"a\", { column: \"b\", direction: \"desc\", nulls: \"last\" }], where: { column: \"a\", op: \"is null\" } }]");
    });

    it("is exported from the schema module", () => {
        expect(schemaIndex.printTableModule).toBe(printTableModule);
        expect(schemaIndex.printColumn).toBe(printColumn);
    });
});

describe("printIndexModule", () => {
    it("re-exports every table and exports defaultRls", () => {
        expect(printIndexModule(
            [{ identifier: "users", importPath: "./users" }, { identifier: "posts", importPath: "./posts" }],
            { defaultRls: [{ operation: "select", access: "public" }] }
        )).toBe([
            "export { users } from \"./users\";",
            "export { posts } from \"./posts\";",
            "",
            "export const defaultRls = [",
            "    { operation: \"select\", access: \"public\" }",
            "] as const;",
            ""
        ].join("\n"));
        expect(printIndexModule([{ identifier: "users", importPath: "./users" }], { defaultRls: "admin-only" }))
            .toBe("export { users } from \"./users\";\n\nexport const defaultRls = \"admin-only\" as const;\n");
    });
});

// ── Round trips ──────────────────────────────────────────────────────────────

/** Print every fixture, evaluate the modules together, and return the new definitions by name. */
function roundTrip(defs: readonly (AnyTableDef | AnyViewDef)[]): Map<string, unknown> {
    const printed = defs.map(def => printTableSource(def, optionsFor(def.name)));
    const exports = evaluateModules(printed.map(entry => entry.code));
    return new Map(defs.map((def, index) => [def.name, exports[printed[index].identifier]]));
}

describe("round trip: evaluate(print(def)) is def", () => {
    const evaluated = roundTrip(PRINT_FIXTURES);
    it.each(PRINT_FIXTURES.map(def => [def.name, def] as const))("%s", (name, def) => {
        expect(comparable(evaluated.get(name))).toEqual(comparable(def));
    });

    it("compiles to the same descriptors", () => {
        const again = PRINT_FIXTURES.map(def => evaluated.get(def.name));
        const isSchemaDef = (value: unknown): value is AnyTableDef | AnyViewDef =>
            typeof value === "object" && value !== null && "brand" in value && (value.brand === "rebase.table" || value.brand === "rebase.view");
        expect(compileTables(again.filter(isSchemaDef), { defaultRls: DEFAULT_RLS }))
            .toEqual(compileTables(PRINT_FIXTURES, { defaultRls: DEFAULT_RLS }));
    });
});

describe("round trip: compile(evaluate(print(compile(defs)))) is compile(defs)", () => {
    const descriptors = compileTables(PRINT_FIXTURES, { defaultRls: DEFAULT_RLS });
    const bySlug = new Map(descriptors.map(descriptor => [descriptor.slug, descriptor]));
    const resolveTarget: PrintTargetResolver = target => {
        const descriptor = bySlug.get(target.slug);
        if (!descriptor) throw new Error(`no descriptor for ${target.slug}`);
        return { identifier: tableIdentifier(descriptor.name), importPath: `./${descriptor.name}`, table: descriptor.table, kind: descriptor.kind };
    };
    const printDescriptor = (descriptor: TableDescriptor): string => printTableModule(descriptor, {
        resolveTarget,
        sources: {
            hooks: FIXTURE_HOOKS[descriptor.name],
            transforms: Object.fromEntries(descriptor.columns.filter(c => c.transforms).map(c => [c.key, TRANSFORM_SOURCE]))
        }
    });

    it("holds for every fixture", () => {
        const modules = descriptors.map(printDescriptor);
        const exports = evaluateModules(modules);
        const again = descriptors.map(descriptor => exports[tableIdentifier(descriptor.name)]);
        const isSchemaDef = (value: unknown): value is AnyTableDef | AnyViewDef =>
            typeof value === "object" && value !== null && "brand" in value && (value.brand === "rebase.table" || value.brand === "rebase.view");
        expect(again.every(isSchemaDef)).toBe(true);
        expect(compileTables(again.filter(isSchemaDef), { defaultRls: DEFAULT_RLS })).toEqual(descriptors);
    });

    it("leaves derived foreign keys to their relation and derived names out", () => {
        const module = printDescriptor(descriptors[3]);
        expect(module).not.toContain("reviewerId");
        expect(module).toContain("author: rel.belongsTo(() => users, { notNull: true, onDelete: \"restrict\" })");
        expect(module).toContain("tags: rel.manyToMany(() => tags, {\n            pivot: {");
        const accounts = printDescriptor(descriptors[5]);
        // A relation's field rules come back from the descriptor.
        expect(accounts).toContain("tags: rel.manyToMany(() => tags, { private: true })");
        expect(accounts).toContain("access: { read: [\"admin\", \"member\"], write: [\"admin\"] }");
        expect(accounts).toContain("parent: rel.belongsTo(() => accounts)");
        expect(accounts).toContain("profile: rel.hasOne(() => profiles)");
    });

    it("refuses a view descriptor without its query", () => {
        const view = descriptors[8];
        expect(() => printTableSource({ ...view, view: { materialized: true } })).toThrow(/carries no query/);
    });
});

// ── Lint ─────────────────────────────────────────────────────────────────────

describe("a printed module under the repository's eslint config", () => {
    it("has no problems beyond the style the spec itself uses", () => {
        const root = path.resolve(__dirname, "../../../..");
        const module = printTableModule(posts, optionsFor("posts"));
        const output = execFileSync(
            "pnpm",
            ["exec", "eslint", "--stdin", "--stdin-filename", "packages/common/src/schema/__printed__.ts", "--format", "json"],
            { cwd: root, input: module, encoding: "utf8" }
        );
        const parsed: unknown = JSON.parse(output);
        const messages = Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === "object" && parsed[0] !== null && "messages" in parsed[0] && Array.isArray(parsed[0].messages)
            ? parsed[0].messages
            : undefined;
        if (!messages) throw new Error(`unexpected eslint output: ${output}`);
        const rules = messages.map((message: unknown) =>
            typeof message === "object" && message !== null && "ruleId" in message ? String(message.ruleId) : "?");
        // `object-property-newline` asks for one property per line in every
        // object; the spec writes short objects on one line (`{ min: 3, max: 200 }`),
        // and so does the repository's own source, so it is the one warning a
        // printed module carries.
        expect(rules.filter(rule => rule !== "object-property-newline")).toEqual([]);
    }, 60_000);
});
