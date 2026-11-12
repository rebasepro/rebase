/**
 * What `rebase schema introspect` writes for one table, column by column.
 *
 * Built inputs, so each case states exactly the catalogue it reads; the real
 * schemas are `introspect-real-generation.test.ts`. Every generated module is
 * also evaluated and compiled (`compileTables`), so what is asserted as text is
 * a table the backend accepts.
 */
import { compileTables } from "@rebasepro/common";

import { generateSchemaModules, type SchemaGeneration, type SchemaGenerationInput } from "../src/schema/introspect-db-logic";
import { classifyTables } from "../src/schema/introspect-db-structure";
import { evaluateSchemaModules } from "./helpers/introspect-generation";
import { autoStamp, buildSchema, column, foreignKey, serialPk, unique, type SchemaSpec } from "./helpers/schema-metadata";

const CMS = { tableImport: (table: string) => `../../../backend/schema/${table}` };

function generate(spec: SchemaSpec, extra: Partial<SchemaGenerationInput> = {}): SchemaGeneration {
    const { metadata, tables } = buildSchema(spec);
    return generateSchemaModules({ metadata, classifications: classifyTables(metadata, tables), cms: CMS, ...extra });
}

const moduleOf = (generation: SchemaGeneration, table: string): string => {
    const found = generation.tables.find(t => t.table === table);
    if (!found) throw new Error(`no module for ${table}: ${JSON.stringify(generation.failed)}`);
    return found.schemaModule;
};

/** Every module evaluates and compiles. */
function compiles(generation: SchemaGeneration): void {
    expect(() => compileTables(evaluateSchemaModules(generation.tables.map(t => t.schemaModule)))).not.toThrow();
}

describe("a generated table", () => {
    it("is a defineTable module named after its table, importing the builders it uses", () => {
        const g = generate({ tables: [{ name: "blog_posts", columns: [serialPk("blog_posts"), column("blog_posts", "title", { is_nullable: "NO" })] }] });
        expect(moduleOf(g, "blog_posts")).toBe([
            "import { defineTable, col } from \"@rebasepro/server/schema\";",
            "",
            "export const blogPosts = defineTable(\"blog_posts\", {",
            "    columns: {",
            "        id: col.serial().primaryKey(),",
            "        title: col.text().notNull()",
            "    },",
            "    rls: \"admin-only\"",
            "});",
            ""
        ].join("\n"));
        expect(g.tables[0].identifier).toBe("blogPosts");
        compiles(g);
    });

    it("states each key the way the database fills it", () => {
        const g = generate({
            tables: [
                { name: "a", columns: [column("a", "id", { data_type: "uuid", udt_name: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" })] },
                { name: "b", columns: [column("b", "id", { data_type: "uuid", udt_name: "uuid", is_nullable: "NO" })] },
                { name: "c", columns: [column("c", "id", { data_type: "integer", udt_name: "int4", is_nullable: "NO", is_identity: "YES" })] },
                { name: "d", columns: [column("d", "id", { data_type: "bigint", udt_name: "int8", is_nullable: "NO", column_default: "nextval('d_id_seq'::regclass)" })] },
                { name: "e", columns: [column("e", "id", { data_type: "integer", udt_name: "int4", is_nullable: "NO", column_default: "nextval('shared_seq'::regclass)" })] }
            ]
        });
        expect(moduleOf(g, "a")).toContain("id: col.uuid().primaryKey().defaultRandom()");
        expect(moduleOf(g, "b")).toContain("id: col.uuid().primaryKey()");
        expect(moduleOf(g, "c")).toContain("id: col.integer().primaryKey().identity()");
        expect(moduleOf(g, "d")).toContain("id: col.bigserial().primaryKey()");
        // A sequence Rebase did not create: the database keeps the default.
        expect(moduleOf(g, "e")).toContain("id: col.integer().primaryKey().dbDefault()");
        compiles(g);
    });

    it("declares a composite key in key order, whatever the key columns' types", () => {
        const g = generate({
            tables: [{
                name: "rates",
                columns: [
                    column("rates", "currency", { data_type: "character", udt_name: "bpchar", character_maximum_length: 3, is_nullable: "NO" }),
                    column("rates", "day", { data_type: "date", udt_name: "date", is_nullable: "NO" }),
                    column("rates", "rate", { data_type: "numeric", udt_name: "numeric", numeric_precision: 12, numeric_scale: 6 })
                ],
                pks: ["day", "currency"]
            }]
        });
        expect(moduleOf(g, "rates")).toContain("currency: col.char(3).primaryKey()");
        expect(moduleOf(g, "rates")).toContain("day: col.date().primaryKey()");
        expect(moduleOf(g, "rates")).toContain("rate: col.numeric(12, 6)");
        compiles(g);
    });

    it("keeps NOT NULL and the default together, and a generated column read-only", () => {
        const g = generate({
            tables: [{
                name: "items",
                columns: [
                    serialPk("items"),
                    column("items", "qty", { data_type: "integer", udt_name: "int4", is_nullable: "NO", column_default: "1" }),
                    column("items", "code", { is_nullable: "NO", column_default: "gen_code()" }),
                    column("items", "doubled", { data_type: "integer", udt_name: "int4", is_generated: "ALWAYS", generation_expression: "(qty * 2)" }),
                    column("items", "sku")
                ]
            }],
            uniques: [unique("items", "sku")]
        });
        const items = moduleOf(g, "items");
        expect(items).toContain("qty: col.integer().notNull().default(1)");
        expect(items).toContain("code: col.text().notNull().defaultSql(\"gen_code()\")");
        expect(items).toContain("doubled: col.integer().generatedAs(\"(qty * 2)\")");
        expect(items).toContain("sku: col.text().unique()");
        compiles(g);
    });

    it("stamps created_at, updated_at and a now() default the way the generator always has", () => {
        const g = generate({
            tables: [{
                name: "posts",
                columns: [serialPk("posts"), autoStamp("posts", "created_at"), autoStamp("posts", "updated_at"), autoStamp("posts", "published_at")]
            }]
        });
        const posts = moduleOf(g, "posts");
        expect(posts).toContain("createdAt: col.timestamptz().notNull().onCreateNow()");
        expect(posts).toContain("updatedAt: col.timestamptz().notNull().onUpdateNow()");
        expect(posts).toContain("publishedAt: col.timestamptz().notNull().onCreateNow()");
        compiles(g);
    });

    it("validates a `_url` column as a URL", () => {
        const g = generate({ tables: [{ name: "links", columns: [serialPk("links"), column("links", "target_url")] }] });
        expect(moduleOf(g, "links")).toContain("targetUrl: col.text().validate({ url: true })");
    });

    it("keeps an enum's own type name and labels", () => {
        const g = generate({
            tables: [{ name: "orders", columns: [serialPk("orders"), column("orders", "state", { data_type: "USER-DEFINED", udt_name: "order_state", is_nullable: "NO" })] }],
            enumValues: [
                { enum_name: "order_state", enum_value: "new", sort_order: 1 },
                { enum_name: "order_state", enum_value: "paid_up", sort_order: 2 }
            ]
        });
        expect(moduleOf(g, "orders")).toContain("state: col.enum([\"new\", \"paid_up\"], { name: \"order_state\" }).notNull()");
        compiles(g);
    });

    it("declares a type no other builder names with col.custom, as `format_type` prints it — which a push plans", () => {
        const g = generate({ tables: [{ name: "hits", columns: [
            serialPk("hits"),
            column("hits", "ip", { data_type: "inet", udt_name: "inet" }),
            column("hits", "at", { data_type: "timestamp without time zone", udt_name: "timestamp", formatted_type: "timestamp(3) without time zone" })
        ] }] });
        expect(moduleOf(g, "hits")).toContain("ip: col.custom(\"inet\")");
        expect(moduleOf(g, "hits")).toContain("at: col.custom(\"timestamp(3) without time zone\")");
        expect(g.tables[0].notes).toEqual([]);
        const precise = generate({ tables: [{ name: "ticks", columns: [
            serialPk("ticks"),
            column("ticks", "at", { data_type: "timestamp with time zone", udt_name: "timestamptz", formatted_type: "timestamp(3) with time zone" }),
            column("ticks", "plain", { data_type: "timestamp with time zone", udt_name: "timestamptz", formatted_type: "timestamp with time zone" })
        ] }] });
        // A declared precision is kept; the default one is the builder's.
        expect(moduleOf(precise, "ticks")).toContain("at: col.custom(\"timestamp(3) with time zone\")");
        expect(moduleOf(precise, "ticks")).toContain("plain: col.timestamptz()");
        expect(moduleOf(g, "hits")).not.toContain("Not reproduced exactly");
    });

    it("leaves out a table with no primary key, saying why", () => {
        const g = generate({ tables: [{ name: "log", columns: [column("log", "line")], pks: [] }] });
        expect(g.tables).toEqual([]);
        expect(g.failed).toEqual([{ table: "log", reason: expect.stringContaining("it has no primary key") }]);
    });
});

describe("relations", () => {
    const blog: SchemaSpec = {
        tables: [
            { name: "authors", columns: [serialPk("authors"), column("authors", "name", { is_nullable: "NO" })] },
            {
                name: "posts",
                columns: [
                    serialPk("posts"),
                    column("posts", "author_id", { data_type: "integer", udt_name: "int4", is_nullable: "NO" }),
                    column("posts", "editor_id", { data_type: "integer", udt_name: "int4" })
                ]
            },
            { name: "tags", columns: [serialPk("tags"), column("tags", "label", { is_nullable: "NO" })] },
            {
                name: "posts_tags",
                columns: [
                    column("posts_tags", "post_id", { data_type: "integer", udt_name: "int4", is_nullable: "NO" }),
                    column("posts_tags", "tag_id", { data_type: "integer", udt_name: "int4", is_nullable: "NO" })
                ],
                pks: ["post_id", "tag_id"]
            }
        ],
        fks: [
            foreignKey("posts", "author_id", "authors", { delete_rule: "CASCADE" }),
            foreignKey("posts", "editor_id", "authors", { delete_rule: "SET NULL" }),
            foreignKey("posts_tags", "post_id", "posts", { delete_rule: "CASCADE" }),
            foreignKey("posts_tags", "tag_id", "tags", { delete_rule: "CASCADE" })
        ],
        uniques: [unique("posts_tags", "post_id", "tag_id")]
    };

    it("turns a foreign key into the declared column and a belongsTo, ON DELETE when it is not the default", () => {
        const posts = moduleOf(generate(blog), "posts");
        expect(posts).toContain("authorId: col.integer().notNull()");
        expect(posts).toContain("author: rel.belongsTo(() => authors, { onDelete: \"cascade\" })");
        expect(posts).toContain("editor: rel.belongsTo(() => authors)");
        expect(posts).toContain("import { authors } from \"./authors\";");
        expect(posts.match(/import \{ authors \}/g)).toHaveLength(1);
    });

    it("gives the target a hasMany back, and folds the junction into a manyToMany on both ends", () => {
        const g = generate(blog);
        expect(g.tables.map(t => t.table)).toEqual(["authors", "posts", "tags"]);
        expect(moduleOf(g, "authors")).toContain("posts: rel.hasMany(() => posts)");
        expect(moduleOf(g, "posts")).toContain("tags: rel.manyToMany(() => tags)");
        expect(moduleOf(g, "tags")).toContain("posts: rel.manyToMany(() => posts)");
        compiles(g);
    });

    it("names a self-referencing many-to-many after the column it goes through", () => {
        const g = generate({
            tables: [
                { name: "people", columns: [serialPk("people")] },
                {
                    name: "people_friends",
                    columns: [
                        column("people_friends", "person_id", { data_type: "integer", udt_name: "int4", is_nullable: "NO" }),
                        column("people_friends", "friend_id", { data_type: "integer", udt_name: "int4", is_nullable: "NO" })
                    ],
                    pks: ["person_id", "friend_id"]
                }
            ],
            fks: [foreignKey("people_friends", "person_id", "people"), foreignKey("people_friends", "friend_id", "people")],
            uniques: [unique("people_friends", "person_id", "friend_id")]
        });
        expect(moduleOf(g, "people")).toMatch(/people_via_friend: rel\.manyToMany\(\(\) => people, \{[\s\S]*through: "people_friends"/);
        compiles(g);
    });

    it("says `index: false` where the database has no index on the key, and why", () => {
        const g = generate({ ...blog, indexes: [] });
        expect(moduleOf(g, "posts")).toContain("author: rel.belongsTo(() => authors, { onDelete: \"cascade\", index: false })");
        expect(g.tables.find(t => t.table === "posts")?.remarks).toEqual(expect.arrayContaining([
            expect.stringContaining("the database has no index on \"author_id\"")
        ]));
    });
});

describe("row-level security", () => {
    const one = (rls: Record<string, boolean> | undefined, policies?: SchemaSpec["policies"]) => moduleOf(generate({
        tables: [{ name: "notes", columns: [serialPk("notes")] }],
        ...(rls ? { rls } : {}),
        ...(policies ? { policies } : {})
    }), "notes");

    it("is \"admin-only\" for a table with RLS off, and says the push switches it on", () => {
        const notes = one({ notes: false }, []);
        expect(notes).toContain("rls: \"admin-only\"");
        expect(notes).toContain("// ⚠ Row-level security is off on this table");
    });

    it("is a rule that grants nothing for RLS on with no policy, which no one but the owner reads today", () => {
        const notes = one({ notes: true }, []);
        expect(notes).toContain("rls: [\n        { name: \"notes_closed\", operation: \"all\", using: \"false\" }\n    ],\n    defaultPolicies: false");
    });
});

describe("panel customizations", () => {
    it("are written only for a project with a frontend, and only when a heuristic fired", () => {
        const spec: SchemaSpec = { tables: [{ name: "products", columns: [serialPk("products"), column("products", "description", { data_type: "text" })] }] };
        const withCms = generate(spec);
        expect(withCms.tables[0].customization).toBe([
            "import { customizeTable } from \"@rebasepro/cms\";",
            "import type { products } from \"../../../backend/schema/products\";",
            "",
            "export const productsCms = customizeTable<typeof products>(\"products\", {",
            "    icon: \"Package\",",
            "    fields: {",
            "        description: {",
            "            multiline: true",
            "        }",
            "    }",
            "});",
            ""
        ].join("\n"));
        const headless = generate(spec, { cms: undefined });
        expect(headless.tables[0].customization).toBeUndefined();
        const plain = generate({ tables: [{ name: "widgets", columns: [serialPk("widgets"), column("widgets", "code", { data_type: "character varying", udt_name: "varchar", character_maximum_length: 8 })] }] });
        expect(plain.tables[0].customization).toBeUndefined();
    });

    it("hide the stamps from the list and make them read-only, and carry what sampled rows suggest", () => {
        const g = generate({
            tables: [{ name: "articles", columns: [serialPk("articles"), autoStamp("articles", "created_at"), column("articles", "body", { data_type: "text" }), column("articles", "cover", { data_type: "text" }), column("articles", "views", { data_type: "integer", udt_name: "int4" })] }]
        }, {
            samples: new Map([["articles", [
                { id: 1, body: "# Title\n\nSome **bold** text.", cover: "https://cdn.example.com/a.png", views: 3 },
                { id: 2, body: "Plain", cover: "https://cdn.example.com/b.jpg", views: 10 }
            ]]])
        });
        const customization = g.tables[0].customization ?? "";
        expect(customization).toContain("createdAt: {\n            readOnly: true,\n            hidden: true\n        }");
        expect(customization).toContain("body: {\n            multiline: true,\n            markdown: true\n        }");
        expect(customization).toContain("cover: {\n            urlPreview: \"image\"\n        }");
        expect(moduleOf(g, "articles")).toContain("cover: col.text().validate({ url: true })");
    });
});
