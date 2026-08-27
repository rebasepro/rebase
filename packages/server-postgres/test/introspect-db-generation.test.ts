import {
    generateCollectionFile, buildTablesMap, buildEnumMap,
    identifyJoinTables, TableRow, TableColumn, PrimaryKeyRow,
    ForeignKeyRow, EnumValue, TableMeta, CollectionBuilder
} from "../src/schema/introspect-db-logic";

// ── Helpers ───────────────────────────────────────────────────────────

const mkCol = (table: string, col: string, opts: Partial<TableColumn> = {}): TableColumn => ({
    table_name: table,
column_name: col,
data_type: "character varying",
    udt_name: "varchar",
is_nullable: "YES",
column_default: null,
...opts
});

const mkFk = (table: string, col: string, fTable: string, fCol = "id"): ForeignKeyRow => ({
    table_name: table,
column_name: col,
foreign_table_name: fTable,
foreign_column_name: fCol
});

function makeSimpleTable(name: string, columns: TableColumn[], pks: string[] = ["id"], fks: ForeignKeyRow[] = []): TableMeta {
    return { name,
columns,
pks,
fks };
}

/**
 * Slice out the generated block for one property. Assertions about a mapped
 * column type have to be anchored to the column they belong to: a whole-file
 * `toContain('type: "number"')` is satisfied by ANY numeric column, so a
 * generator that swapped two columns' type mappings would still pass.
 */
function propertyBlock(generated: string, propertyKey: string): string {
    const open = generated.indexOf(`\n        ${propertyKey}: {`);
    if (open === -1) throw new Error(`No generated property "${propertyKey}" in:\n${generated}`);
    const close = generated.indexOf("\n        },", open);
    if (close === -1) throw new Error(`Unterminated generated property "${propertyKey}" in:\n${generated}`);
    return generated.slice(open, close);
}

// ═══════════════════════════════════════════════════════════════════════
// generateCollectionFile() — property generation
// ═══════════════════════════════════════════════════════════════════════
describe("generateCollectionFile", () => {
    describe("basic property generation", () => {
        it("generates a simple collection with slug, name, singularName and table", () => {
            const meta = makeSimpleTable("products", [
                mkCol("products", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("products", "name", { is_nullable: "NO" })
            ]);
            const result = generateCollectionFile("products", meta, [], new Set(), new Map([["products", meta]]), new Map());
            expect(result).toContain('slug: "products"');
            expect(result).toContain('name: "Products"');
            expect(result).toContain('singularName: "Product"');
            expect(result).toContain('table: "products"');
        });

        it("generates correct property types from columns", () => {
            const meta = makeSimpleTable("items", [
                mkCol("items", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("items", "count", { data_type: "integer",
udt_name: "int4" }),
                mkCol("items", "active", { data_type: "boolean",
udt_name: "bool" }),
                mkCol("items", "created_at", { data_type: "timestamp",
udt_name: "timestamp" }),
                mkCol("items", "metadata", { data_type: "jsonb",
udt_name: "jsonb" })
            ]);
            const result = generateCollectionFile("items", meta, [], new Set(), new Map([["items", meta]]), new Map());
            expect(propertyBlock(result, "id")).toContain('type: "string"');
            expect(propertyBlock(result, "count")).toContain('type: "number"');
            expect(propertyBlock(result, "active")).toContain('type: "boolean"');
            expect(propertyBlock(result, "createdAt")).toContain('type: "date"');
            expect(propertyBlock(result, "metadata")).toContain('type: "map"');
        });

        it("skips FK columns from properties (they become relations)", () => {
            const fks = [mkFk("posts", "author_id", "users")];
            const meta = makeSimpleTable("posts", [
                mkCol("posts", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("posts", "title", { is_nullable: "NO" }),
                mkCol("posts", "author_id", { is_nullable: "NO" })
            ], ["id"], fks);
            const result = generateCollectionFile("posts", meta, fks, new Set(), new Map([["posts", meta]]), new Map());
            // author_id should NOT appear as a regular property
            expect(result).not.toMatch(/author_id:\s*\{[^}]*type:\s*"string"/);
            // but author should appear as a relation
            expect(result).toContain('type: "relation"');
        });
    });

    describe("propertiesOrder correctness", () => {
        it("includes relation property key, not FK column name", () => {
            const fks = [mkFk("posts", "author_id", "users")];
            const meta = makeSimpleTable("posts", [
                mkCol("posts", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("posts", "title"),
                mkCol("posts", "author_id")
            ], ["id"], fks);
            const result = generateCollectionFile("posts", meta, fks, new Set(), new Map([["posts", meta]]), new Map());
            // propertiesOrder should contain "author" (the relation key), not "author_id" (the FK column)
            const orderMatch = result.match(/propertiesOrder:\s*(\[[\s\S]*?\])/);
            expect(orderMatch).toBeTruthy();
            const orderBlock = orderMatch![1];
            expect(orderBlock).toContain('"author"');
            // author_id should NOT appear in propertiesOrder (it may appear in localKey elsewhere)
            expect(orderBlock).not.toContain('"author_id"');
        });
    });

    describe("ID detection", () => {
        it("marks uuid PK as isId uuid", () => {
            const meta = makeSimpleTable("users", [
                mkCol("users", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" })
            ]);
            const result = generateCollectionFile("users", meta, [], new Set(), new Map([["users", meta]]), new Map());
            expect(result).toContain('isId: "uuid"');
        });

        it("marks integer PK as isId increment", () => {
            const meta = makeSimpleTable("counters", [
                mkCol("counters", "id", { data_type: "integer",
udt_name: "int4",
is_nullable: "NO",
column_default: "nextval" })
            ]);
            const result = generateCollectionFile("counters", meta, [], new Set(), new Map([["counters", meta]]), new Map());
            expect(result).toContain('isId: "increment"');
        });

        it("flags composite primary keys with a comment", () => {
            const meta = makeSimpleTable("scores", [
                mkCol("scores", "user_id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("scores", "game_id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("scores", "score", { data_type: "integer",
udt_name: "int4" })
            ], ["user_id", "game_id"]);
            const result = generateCollectionFile("scores", meta, [], new Set(), new Map([["scores", meta]]), new Map());
            expect(result).toContain("composite primary key");
            expect(result).toContain("user_id, game_id");
        });
    });

    describe("validation.required", () => {
        it("adds required when is_nullable is NO, not a PK, and no default", () => {
            const meta = makeSimpleTable("items", [
                mkCol("items", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("items", "name", { is_nullable: "NO" })
            ]);
            const result = generateCollectionFile("items", meta, [], new Set(), new Map([["items", meta]]), new Map());
            // name should have required
            expect(result).toContain("required: true");
        });

        it("does NOT add required for nullable columns", () => {
            const meta = makeSimpleTable("items", [
                mkCol("items", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("items", "bio", { is_nullable: "YES" })
            ]);
            const result = generateCollectionFile("items", meta, [], new Set(), new Map([["items", meta]]), new Map());
            const bioSection = result.split("bio:")[1].split("},")[0];
            expect(bioSection).not.toContain("required");
        });

        it("does NOT add required for columns with defaults", () => {
            const meta = makeSimpleTable("items", [
                mkCol("items", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("items", "role", { is_nullable: "NO",
column_default: "'user'" })
            ]);
            const result = generateCollectionFile("items", meta, [], new Set(), new Map([["items", meta]]), new Map());
            const roleSection = result.split("role:")[1].split("},")[0];
            expect(roleSection).not.toContain("required");
        });
    });

    describe("enum support", () => {
        it("generates enum for USER-DEFINED columns with matching enum", () => {
            const enumMap = new Map([["order_status", ["pending", "shipped", "delivered"]]]);
            const meta = makeSimpleTable("orders", [
                mkCol("orders", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("orders", "status", { data_type: "USER-DEFINED",
udt_name: "order_status" })
            ]);
            const result = generateCollectionFile("orders", meta, [], new Set(), new Map([["orders", meta]]), enumMap);
            expect(result).toContain("enum:");
            expect(result).toContain('{ id: "pending", label: "Pending" }');
            expect(result).toContain('{ id: "shipped", label: "Shipped" }');
            expect(result).toContain('{ id: "delivered", label: "Delivered" }');
            expect(result).toContain('type: "string"');
        });

        it("does NOT add enum for USER-DEFINED without matching enum", () => {
            const meta = makeSimpleTable("things", [
                mkCol("things", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("things", "geom", { data_type: "USER-DEFINED",
udt_name: "geometry" })
            ]);
            const result = generateCollectionFile("things", meta, [], new Set(), new Map([["things", meta]]), new Map());
            expect(result).not.toContain("enum");
        });

        it("humanizes enum value labels with underscores", () => {
            const enumMap = new Map([["my_enum", ["in_progress", "on_hold"]]]);
            const meta = makeSimpleTable("tasks", [
                mkCol("tasks", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("tasks", "state", { data_type: "USER-DEFINED",
udt_name: "my_enum" })
            ]);
            const result = generateCollectionFile("tasks", meta, [], new Set(), new Map([["tasks", meta]]), enumMap);
            expect(result).toContain('label: "In Progress"');
            expect(result).toContain('label: "On Hold"');
        });
    });

    describe("date auto-value heuristics", () => {
        it("sets autoValue on_create for created_at", () => {
            const meta = makeSimpleTable("items", [
                mkCol("items", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("items", "created_at", { data_type: "timestamp",
udt_name: "timestamp" })
            ]);
            const result = generateCollectionFile("items", meta, [], new Set(), new Map([["items", meta]]), new Map());
            expect(result).toContain('autoValue: "on_create"');
            expect(result).toContain("hideFromCollection: true");
        });

        it("sets autoValue on_update for updated_at", () => {
            const meta = makeSimpleTable("items", [
                mkCol("items", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("items", "updated_at", { data_type: "timestamp",
udt_name: "timestamp" })
            ]);
            const result = generateCollectionFile("items", meta, [], new Set(), new Map([["items", meta]]), new Map());
            expect(result).toContain('autoValue: "on_update"');
        });

        it("sets autoValue on_create for columns with now() default", () => {
            const meta = makeSimpleTable("items", [
                mkCol("items", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("items", "published_at", { data_type: "timestamp",
udt_name: "timestamp",
column_default: "now()" })
            ]);
            const result = generateCollectionFile("items", meta, [], new Set(), new Map([["items", meta]]), new Map());
            expect(result).toContain('autoValue: "on_create"');
        });
    });

    describe("string sub-type heuristics", () => {
        it("adds storage config for image-like column names", () => {
            for (const name of ["profile_image", "avatar", "photo_url", "logo", "cover_image"]) {
                const meta = makeSimpleTable("t", [
                    mkCol("t", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                    mkCol("t", name)
                ]);
                const result = generateCollectionFile("t", meta, [], new Set(), new Map([["t", meta]]), new Map());
                expect(result).toContain("storagePath:");
            }
        });

        it("adds multiline for description/summary/excerpt", () => {
            for (const name of ["description", "summary", "excerpt"]) {
                const meta = makeSimpleTable("t", [
                    mkCol("t", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                    mkCol("t", name)
                ]);
                const result = generateCollectionFile("t", meta, [], new Set(), new Map([["t", meta]]), new Map());
                expect(result).toContain("multiline: true");
            }
        });

        it("adds markdown for content/body", () => {
            for (const name of ["content", "body"]) {
                const meta = makeSimpleTable("t", [
                    mkCol("t", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                    mkCol("t", name)
                ]);
                const result = generateCollectionFile("t", meta, [], new Set(), new Map([["t", meta]]), new Map());
                expect(result).toContain("markdown: true");
            }
        });

        it("adds multiline for text data_type columns", () => {
            const meta = makeSimpleTable("t", [
                mkCol("t", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("t", "notes", { data_type: "text",
udt_name: "text" })
            ]);
            const result = generateCollectionFile("t", meta, [], new Set(), new Map([["t", meta]]), new Map());
            expect(result).toContain("multiline: true");
        });

        it("does NOT apply string heuristics to enum columns", () => {
            const enumMap = new Map([["img_type", ["png", "jpg"]]]);
            const meta = makeSimpleTable("t", [
                mkCol("t", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("t", "image_type", { data_type: "USER-DEFINED",
udt_name: "img_type" })
            ]);
            const result = generateCollectionFile("t", meta, [], new Set(), new Map([["t", meta]]), enumMap);
            expect(result).not.toContain("storagePath");
            expect(result).toContain("enum:");
        });
    });

    describe("owning relation (FK -> other table)", () => {
        it("generates a one-to-one owning relation with correct import", () => {
            const fks = [mkFk("posts", "author_id", "users")];
            const meta = makeSimpleTable("posts", [
                mkCol("posts", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("posts", "author_id")
            ], ["id"], fks);
            const result = generateCollectionFile("posts", meta, fks, new Set(), new Map([["posts", meta]]), new Map());
            expect(result).toContain('import usersCollection from "./users"');
            expect(result).toContain("author: {");
            expect(result).toContain('kind: "belongsTo"');
            expect(result).toContain('localKey: "author_id"');
            // The link nests under `relation` — it is not spread across the property.
            expect(result).toContain("relation: {");
            expect(result).not.toContain("cardinality:");
            expect(result).not.toContain("direction:");
        });
    });

    describe("inverse relation (other table -> this table)", () => {
        it("generates a one-to-many inverse relation in the relations array", () => {
            const allFks: ForeignKeyRow[] = [mkFk("comments", "post_id", "posts")];
            const meta = makeSimpleTable("posts", [
                mkCol("posts", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" })
            ]);
            const result = generateCollectionFile("posts", meta, allFks, new Set(), new Map([["posts", meta]]), new Map());
            expect(result).toContain('import commentsCollection from "./comments"');
            // Should be in the relations array, not as an inline property
            expect(result).toContain("relations: [");
            expect(result).toContain('relationName: "comments"');
            expect(result).toContain('kind: "hasMany"');
            expect(result).toContain('foreignKeyOnTarget: "post_id"');
            expect(result).not.toContain("direction:");
            // Should NOT appear as an inline property with type: "relation"
            const propsSection = result.split("properties:")[1].split("relations:")[0];
            expect(propsSection).not.toContain('"relation"');
        });

        it("does NOT include inverse relations in propertiesOrder", () => {
            const allFks: ForeignKeyRow[] = [mkFk("comments", "post_id", "posts")];
            const meta = makeSimpleTable("posts", [
                mkCol("posts", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" })
            ]);
            const result = generateCollectionFile("posts", meta, allFks, new Set(), new Map([["posts", meta]]), new Map());
            const orderMatch = result.match(/propertiesOrder:\s*(\[[\s\S]*?\])/);
            expect(orderMatch).toBeTruthy();
            const orderBlock = orderMatch![1];
            expect(orderBlock).not.toContain('"comments"');
        });
    });

    describe("many-to-many relations", () => {
        it("generates owning M2M with through config in relations array", () => {
            const jtFks: ForeignKeyRow[] = [
                mkFk("articles_tags", "article_id", "articles"),
                mkFk("articles_tags", "tag_id", "tags")
            ];
            const jtMeta: TableMeta = {
                name: "articles_tags",
pks: [],
                columns: [mkCol("articles_tags", "article_id"), mkCol("articles_tags", "tag_id")],
                fks: jtFks
            };
            const articlesMeta = makeSimpleTable("articles", [
                mkCol("articles", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" })
            ]);
            const tablesMap = new Map([["articles", articlesMeta], ["articles_tags", jtMeta]]);
            const joinTables = new Set(["articles_tags"]);

            const result = generateCollectionFile("articles", articlesMeta, [], joinTables, tablesMap, new Map());
            expect(result).toContain("relations: [");
            expect(result).toContain('relationName: "tags"');
            expect(result).toContain('kind: "manyToMany"');
            expect(result).toContain('table: "articles_tags"');
            expect(result).toContain('sourceColumn: "article_id"');
            expect(result).toContain('targetColumn: "tag_id"');
        });

        it("generates inverse M2M in relations array", () => {
            const jtFks: ForeignKeyRow[] = [
                mkFk("articles_tags", "article_id", "articles"),
                mkFk("articles_tags", "tag_id", "tags")
            ];
            const jtMeta: TableMeta = {
                name: "articles_tags",
pks: [],
                columns: [mkCol("articles_tags", "article_id"), mkCol("articles_tags", "tag_id")],
                fks: jtFks
            };
            const tagsMeta = makeSimpleTable("tags", [
                mkCol("tags", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" })
            ]);
            const tablesMap = new Map([["tags", tagsMeta], ["articles_tags", jtMeta]]);
            const joinTables = new Set(["articles_tags"]);

            const result = generateCollectionFile("tags", tagsMeta, [], joinTables, tablesMap, new Map());
            expect(result).toContain("relations: [");
            expect(result).toContain('kind: "manyToMany"');
        });
    });

    describe("self-referencing M2M", () => {
        it("generates self-ref M2M with _via_ relation name in relations array", () => {
            const jtFks: ForeignKeyRow[] = [
                mkFk("user_friends", "user_id", "users"),
                mkFk("user_friends", "friend_id", "users")
            ];
            const jtMeta: TableMeta = {
                name: "user_friends",
pks: [],
                columns: [mkCol("user_friends", "user_id"), mkCol("user_friends", "friend_id")],
                fks: jtFks
            };
            const usersMeta = makeSimpleTable("users", [
                mkCol("users", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" })
            ]);
            const tablesMap = new Map([["users", usersMeta], ["user_friends", jtMeta]]);
            const joinTables = new Set(["user_friends"]);

            const result = generateCollectionFile("users", usersMeta, [], joinTables, tablesMap, new Map());
            expect(result).toContain("relations: [");
            expect(result).toContain('relationName: "users_via_friend"');
            expect(result).toContain('table: "user_friends"');
            expect(result).toContain('sourceColumn: "user_id"');
            expect(result).toContain('targetColumn: "friend_id"');
            // Self-ref should reference its own collection variable
            expect(result).toContain("usersCollection");
        });
    });

    describe("icon mapping", () => {
        it("assigns correct icons based on table name", () => {
            const make = (name: string) => {
                const meta = makeSimpleTable(name, [mkCol(name, "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" })]);
                return generateCollectionFile(name, meta, [], new Set(), new Map([[name, meta]]), new Map());
            };
            expect(make("users")).toContain('icon: "Users"');
            expect(make("blog_posts")).toContain('icon: "FileText"');
            expect(make("products")).toContain('icon: "Package"');
            expect(make("orders")).toContain('icon: "ShoppingCart"');
            expect(make("app_settings")).toContain('icon: "Settings"');
            expect(make("random_xyz")).toContain('icon: "Database"');
        });
    });

    describe("humanized names", () => {
        it("uses Title Case for collection name from snake_case table", () => {
            const meta = makeSimpleTable("user_profiles", [
                mkCol("user_profiles", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" })
            ]);
            const result = generateCollectionFile("user_profiles", meta, [], new Set(), new Map([["user_profiles", meta]]), new Map());
            expect(result).toContain('name: "User Profiles"');
            expect(result).toContain('singularName: "User Profile"');
        });

        it("humanizes property names", () => {
            const meta = makeSimpleTable("t", [
                mkCol("t", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("t", "first_name")
            ]);
            const result = generateCollectionFile("t", meta, [], new Set(), new Map([["t", meta]]), new Map());
            expect(result).toContain('name: "First Name"');
        });
    });

    describe("import generation", () => {
        /**
         * The import has to name a builder the target project can resolve, and
         * `defineCollection` is what keeps the property keys literal — without it
         * the `admin` block's key-shaped fields (`propertiesOrder`, `sort`,
         * `listProperties`) are checked against `string` and a stale key left by a
         * renamed column compiles silently. See `CollectionBuilder`.
         */
        it("imports the builder the project can resolve", () => {
            const meta = makeSimpleTable("t", [mkCol("t", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" })]);
            const gen = (builder: CollectionBuilder) => generateCollectionFile(
                "t", meta, [], new Set(), new Map([["t", meta]]), new Map(), undefined, { builder }
            );

            expect(gen("admin-types")).toContain('import { defineCollection } from "@rebasepro/cms-types"');
            expect(gen("admin-types")).toContain("const tCollection = defineCollection({");

            // No admin-types in a headless project, so the headless builder — same
            // key inference, no admin surface, nothing React in its graph.
            expect(gen("common")).toContain('import { defineCollection } from "@rebasepro/common"');
            expect(gen("common")).not.toContain("@rebasepro/cms-types");

            // Neither package declared: neither import would resolve, so the old
            // annotation is the only honest thing to emit.
            expect(gen("annotation")).toContain('import { PostgresCollectionConfig } from "@rebasepro/types"');
            expect(gen("annotation")).toContain("const tCollection: PostgresCollectionConfig = {");
        });

        /**
         * `@rebasepro/types` declares no `admin` field at all — the augmentation in
         * `@rebasepro/cms-types` is what adds it — so emitting the block into a
         * project that does not have that package writes a type error into every
         * generated file. It did, until this.
         */
        it("emits no admin block where the field is not declared", () => {
            const meta = makeSimpleTable("t", [
                mkCol("t", "id", { data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
                // `created_at` and a `text` column are the two that carry a
                // property-level admin block: readOnly/hideFromCollection and
                // multiline respectively.
                mkCol("t", "created_at", { data_type: "timestamp with time zone", udt_name: "timestamptz" }),
                mkCol("t", "description", { data_type: "text", udt_name: "text" })
            ]);
            const gen = (builder: CollectionBuilder) => generateCollectionFile(
                "t", meta, [], new Set(), new Map([["t", meta]]), new Map(), undefined, { builder }
            );

            expect(gen("admin-types")).toContain("admin: {");
            for (const builder of ["common", "annotation"] as const) {
                expect(gen(builder)).not.toContain("admin: {");
                // The core options next to them survive: `autoValue` is declared on
                // `DateProperty` in the core types and describes a write, not a form.
                expect(gen(builder)).toContain('autoValue: "on_create"');
            }
        });

        it("does not duplicate imports for multiple relations to same table", () => {
            const fks = [mkFk("posts", "author_id", "users"), mkFk("posts", "reviewer_id", "users")];
            const meta = makeSimpleTable("posts", [
                mkCol("posts", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" }),
                mkCol("posts", "author_id"),
                mkCol("posts", "reviewer_id")
            ], ["id"], fks);
            const result = generateCollectionFile("posts", meta, fks, new Set(), new Map([["posts", meta]]), new Map());
            const importMatches = result.match(/import usersCollection/g);
            expect(importMatches).toHaveLength(1);
        });
    });

    describe("export default", () => {
        it("exports the collection variable as default", () => {
            const meta = makeSimpleTable("orders", [mkCol("orders", "id", { data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO" })]);
            const result = generateCollectionFile("orders", meta, [], new Set(), new Map([["orders", meta]]), new Map());
            expect(result).toContain("export default ordersCollection;");
        });
    });
});
