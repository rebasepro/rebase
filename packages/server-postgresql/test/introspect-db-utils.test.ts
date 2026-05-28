import {
    singularize, humanize, toCollectionVarName, getIconForTable,
    mapPgType, buildEnumMap, buildTablesMap, identifyJoinTables,
    generateIndexContent, mergeIndexContent, safeHostFromUrl,
    EnumValue, TableRow, TableColumn, PrimaryKeyRow, ForeignKeyRow,
} from "../src/schema/introspect-db-logic";

// ═══════════════════════════════════════════════════════════════════════
// singularize()
// ═══════════════════════════════════════════════════════════════════════
describe("singularize", () => {
    it("strips trailing s from regular plurals", () => {
        expect(singularize("users")).toBe("user");
        expect(singularize("products")).toBe("product");
        expect(singularize("posts")).toBe("post");
    });

    it("converts -ies to -y", () => {
        expect(singularize("categories")).toBe("category");
        expect(singularize("companies")).toBe("company");
        expect(singularize("stories")).toBe("story");
    });

    it("converts -ves to -f", () => {
        expect(singularize("wolves")).toBe("wolf");
        expect(singularize("leaves")).toBe("leaf");
        expect(singularize("knives")).toBe("knif"); // known edge-case
    });

    it("converts -ches, -shes, -sses, -xes, -zes", () => {
        expect(singularize("batches")).toBe("batch");
        expect(singularize("wishes")).toBe("wish");
        expect(singularize("classes")).toBe("class");
        expect(singularize("boxes")).toBe("box");
        expect(singularize("buzzes")).toBe("buzz");
    });

    it("converts -ses (not -sses) by removing trailing s", () => {
        expect(singularize("responses")).toBe("response");
        expect(singularize("databases")).toBe("database");
    });

    it("converts -ices to -ex", () => {
        expect(singularize("indices")).toBe("index");
        expect(singularize("vertices")).toBe("vertex");
    });

    it("handles irregular plurals", () => {
        expect(singularize("people")).toBe("person");
        expect(singularize("children")).toBe("child");
        expect(singularize("men")).toBe("man");
        expect(singularize("women")).toBe("woman");
        expect(singularize("mice")).toBe("mouse");
        expect(singularize("geese")).toBe("goose");
        expect(singularize("teeth")).toBe("tooth");
        expect(singularize("feet")).toBe("foot");
        expect(singularize("data")).toBe("datum");
        expect(singularize("media")).toBe("medium");
        expect(singularize("criteria")).toBe("criterion");
        expect(singularize("phenomena")).toBe("phenomenon");
    });

    it("preserves casing on irregular plurals", () => {
        expect(singularize("People")).toBe("Person");
        expect(singularize("Children")).toBe("Child");
    });

    it("leaves uncountable words unchanged", () => {
        expect(singularize("status")).toBe("status");
        expect(singularize("news")).toBe("news");
        expect(singularize("series")).toBe("series");
        expect(singularize("species")).toBe("species");
        expect(singularize("analysis")).toBe("analysis");
        expect(singularize("diagnosis")).toBe("diagnosis");
        expect(singularize("crisis")).toBe("crisis");
        expect(singularize("thesis")).toBe("thesis");
        expect(singularize("bus")).toBe("bus");
    });

    it("leaves already-singular words unchanged", () => {
        expect(singularize("user")).toBe("user");
        expect(singularize("address")).toBe("address");
    });

    it("does not strip -ss words", () => {
        expect(singularize("boss")).toBe("boss");
        expect(singularize("glass")).toBe("glass");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// humanize()
// ═══════════════════════════════════════════════════════════════════════
describe("humanize", () => {
    it("converts snake_case to Title Case", () => {
        expect(humanize("created_at")).toBe("Created At");
        expect(humanize("customer_id")).toBe("Customer Id");
        expect(humanize("first_name")).toBe("First Name");
    });

    it("capitalizes single words", () => {
        expect(humanize("name")).toBe("Name");
        expect(humanize("id")).toBe("Id");
    });

    it("handles multiple underscores", () => {
        expect(humanize("user_profile_image")).toBe("User Profile Image");
    });

    it("handles already capitalized input", () => {
        expect(humanize("Name")).toBe("Name");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// toCollectionVarName()
// ═══════════════════════════════════════════════════════════════════════
describe("toCollectionVarName", () => {
    it("converts snake_case to camelCase + Collection", () => {
        expect(toCollectionVarName("company_token")).toBe("companyTokenCollection");
        expect(toCollectionVarName("user_profile")).toBe("userProfileCollection");
    });

    it("handles single-word tables", () => {
        expect(toCollectionVarName("users")).toBe("usersCollection");
    });

    it("handles multi-segment names", () => {
        expect(toCollectionVarName("user_account_settings")).toBe("userAccountSettingsCollection");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// getIconForTable()
// ═══════════════════════════════════════════════════════════════════════
describe("getIconForTable", () => {
    const cases: [string, string][] = [
        ["users", "Users"], ["accounts", "Users"], ["members", "Users"],
        ["customers", "Users"], ["clients", "Users"], ["patients", "Users"],
        ["posts", "FileText"], ["articles", "FileText"], ["blog_entries", "FileText"],
        ["pages", "FileText"],
        ["products", "Package"], ["items", "Package"],
        ["orders", "ShoppingCart"], ["cart", "ShoppingCart"],
        ["purchases", "ShoppingCart"], ["invoices", "ShoppingCart"],
        ["settings", "Settings"], ["app_config", "Settings"],
        ["tags", "Tag"], ["categories", "Tag"],
        ["images", "Image"], ["photos", "Image"], ["media_assets", "Image"],
        ["notifications", "Mail"], ["messages", "Mail"], ["emails", "Mail"],
        ["audit_log", "Activity"], ["events", "Activity"],
        ["subscriptions", "CreditCard"], ["plans", "CreditCard"], ["billing", "CreditCard"],
        ["comments", "MessageCircle"], ["reviews", "MessageCircle"], ["feedback", "MessageCircle"],
    ];

    it.each(cases)("returns %s -> %s", (table, icon) => {
        expect(getIconForTable(table)).toBe(icon);
    });

    it("falls back to Database for unknown tables", () => {
        expect(getIconForTable("foobar")).toBe("Database");
        expect(getIconForTable("xyz_data")).toBe("Database");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// mapPgType()
// ═══════════════════════════════════════════════════════════════════════
describe("mapPgType", () => {
    it("maps integer types to number", () => {
        for (const t of ["integer", "smallint", "bigint", "int4", "int8"]) {
            expect(mapPgType(t)).toBe("number");
        }
    });
    it("maps serial types to number", () => {
        // serial/bigserial don't contain 'int' — they need explicit matching
        for (const t of ["serial", "bigserial"]) {
            expect(mapPgType(t)).toBe("number");
        }
    });
    it("maps decimal types to number", () => {
        for (const t of ["numeric", "decimal", "real", "float4", "float8", "double precision", "money"]) {
            expect(mapPgType(t)).toBe("number");
        }
    });
    it("maps boolean types", () => {
        expect(mapPgType("boolean")).toBe("boolean");
        expect(mapPgType("bool")).toBe("boolean");
    });
    it("maps date/time types to date", () => {
        for (const t of ["timestamp", "timestamptz", "date", "time", "timetz", "timestamp with time zone"]) {
            expect(mapPgType(t)).toBe("date");
        }
    });
    it("maps JSON types to map", () => {
        expect(mapPgType("json")).toBe("map");
        expect(mapPgType("jsonb")).toBe("map");
    });
    it("maps ARRAY and underscore-prefixed types to array", () => {
        expect(mapPgType("ARRAY")).toBe("array");
        expect(mapPgType("_int4")).toBe("array");
        expect(mapPgType("_text")).toBe("array");
    });
    it("maps string-like types to string", () => {
        for (const t of ["text", "varchar", "character varying", "char", "character", "uuid", "inet", "cidr", "macaddr", "macaddr8", "interval"]) {
            expect(mapPgType(t)).toBe("string");
        }
    });
    it("maps bytea to binary", () => {
        expect(mapPgType("bytea")).toBe("binary");
    });
    it("defaults unknown types to string", () => {
        expect(mapPgType("tsvector")).toBe("string");
        expect(mapPgType("xml")).toBe("string");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// buildEnumMap()
// ═══════════════════════════════════════════════════════════════════════
describe("buildEnumMap", () => {
    it("groups enum values by name in order", () => {
        const vals: EnumValue[] = [
            { enum_name: "status", enum_value: "active", sort_order: 1 },
            { enum_name: "status", enum_value: "inactive", sort_order: 2 },
            { enum_name: "role", enum_value: "admin", sort_order: 1 },
            { enum_name: "role", enum_value: "user", sort_order: 2 },
        ];
        const map = buildEnumMap(vals);
        expect(map.get("status")).toEqual(["active", "inactive"]);
        expect(map.get("role")).toEqual(["admin", "user"]);
    });
    it("returns empty map for no enums", () => {
        expect(buildEnumMap([]).size).toBe(0);
    });
    it("handles single-value enums", () => {
        const map = buildEnumMap([{ enum_name: "flag", enum_value: "yes", sort_order: 1 }]);
        expect(map.get("flag")).toEqual(["yes"]);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// buildTablesMap()
// ═══════════════════════════════════════════════════════════════════════
describe("buildTablesMap", () => {
    it("groups columns, pks and fks by table", () => {
        const tables: TableRow[] = [{ table_name: "users" }, { table_name: "posts" }];
        const cols: TableColumn[] = [
            { table_name: "users", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO", column_default: null },
            { table_name: "posts", column_name: "id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO", column_default: null },
            { table_name: "posts", column_name: "user_id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO", column_default: null },
        ];
        const pks: PrimaryKeyRow[] = [
            { table_name: "users", column_name: "id" },
            { table_name: "posts", column_name: "id" },
        ];
        const fks: ForeignKeyRow[] = [
            { table_name: "posts", column_name: "user_id", foreign_table_name: "users", foreign_column_name: "id" },
        ];
        const map = buildTablesMap(tables, cols, pks, fks);
        expect(map.size).toBe(2);
        expect(map.get("users")!.pks).toEqual(["id"]);
        expect(map.get("posts")!.fks).toHaveLength(1);
        expect(map.get("posts")!.columns).toHaveLength(2);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// identifyJoinTables()
// ═══════════════════════════════════════════════════════════════════════
describe("identifyJoinTables", () => {
    const mkCol = (table: string, col: string): TableColumn => ({
        table_name: table, column_name: col, data_type: "uuid",
        udt_name: "uuid", is_nullable: "NO", column_default: null,
    });

    it("detects a pure junction table with exactly 2 FKs", () => {
        const tablesMap = new Map([
            ["posts_to_tags", {
                name: "posts_to_tags",
                columns: [mkCol("posts_to_tags", "post_id"), mkCol("posts_to_tags", "tag_id")],
                pks: [],
                fks: [
                    { table_name: "posts_to_tags", column_name: "post_id", foreign_table_name: "posts", foreign_column_name: "id" },
                    { table_name: "posts_to_tags", column_name: "tag_id", foreign_table_name: "tags", foreign_column_name: "id" },
                ],
            }],
        ]);
        expect(identifyJoinTables(tablesMap)).toEqual(new Set(["posts_to_tags"]));
    });

    it("allows id, created_at, updated_at metadata columns on join tables", () => {
        const tablesMap = new Map([
            ["posts_tags", {
                name: "posts_tags",
                columns: [
                    mkCol("posts_tags", "id"),
                    mkCol("posts_tags", "post_id"),
                    mkCol("posts_tags", "tag_id"),
                    mkCol("posts_tags", "created_at"),
                ],
                pks: ["id"],
                fks: [
                    { table_name: "posts_tags", column_name: "post_id", foreign_table_name: "posts", foreign_column_name: "id" },
                    { table_name: "posts_tags", column_name: "tag_id", foreign_table_name: "tags", foreign_column_name: "id" },
                ],
            }],
        ]);
        expect(identifyJoinTables(tablesMap).has("posts_tags")).toBe(true);
    });

    it("does NOT flag tables with extra non-metadata columns", () => {
        const tablesMap = new Map([
            ["enrollments", {
                name: "enrollments",
                columns: [
                    mkCol("enrollments", "student_id"),
                    mkCol("enrollments", "course_id"),
                    mkCol("enrollments", "grade"), // extra column
                ],
                pks: [],
                fks: [
                    { table_name: "enrollments", column_name: "student_id", foreign_table_name: "students", foreign_column_name: "id" },
                    { table_name: "enrollments", column_name: "course_id", foreign_table_name: "courses", foreign_column_name: "id" },
                ],
            }],
        ]);
        expect(identifyJoinTables(tablesMap).size).toBe(0);
    });

    it("does NOT flag tables with only 1 FK", () => {
        const tablesMap = new Map([
            ["posts", {
                name: "posts",
                columns: [mkCol("posts", "id"), mkCol("posts", "user_id")],
                pks: ["id"],
                fks: [
                    { table_name: "posts", column_name: "user_id", foreign_table_name: "users", foreign_column_name: "id" },
                ],
            }],
        ]);
        expect(identifyJoinTables(tablesMap).size).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// generateIndexContent()
// ═══════════════════════════════════════════════════════════════════════
describe("generateIndexContent", () => {
    it("generates sorted export lines", () => {
        const result = generateIndexContent(["zebra", "apple", "mango"]);
        const lines = result.trim().split("\n");
        expect(lines[0]).toContain("apple");
        expect(lines[1]).toContain("mango");
        expect(lines[2]).toContain("zebra");
    });

    it("generates import statements and collections array", () => {
        const result = generateIndexContent(["users"]);
        expect(result).toContain('import usersCollection from "./users";');
        expect(result).toContain('export const collections = [');
        expect(result).toContain('    usersCollection,');
        expect(result).toContain('];');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// mergeIndexContent()
// ═══════════════════════════════════════════════════════════════════════
describe("mergeIndexContent", () => {
    it("adds new exports without duplicating existing ones", () => {
        const existing = 'import usersCollection from "./users";\n\nexport const collections = [\n    usersCollection,\n];\n';
        const result = mergeIndexContent(existing, ["users", "posts"]);
        expect(result.match(/import usersCollection from ".\/users";/g)!.length).toBe(1);
        expect(result).toContain('import postsCollection from "./posts";');
        expect(result).toContain('usersCollection,');
        expect(result).toContain('postsCollection,');
    });

    it("returns existing content trimmed + newline when no new files", () => {
        const existing = 'import aCollection from "./a";\n\nexport const collections = [\n    aCollection,\n];\n';
        const result = mergeIndexContent(existing, ["a"]);
        expect(result.trim()).toBe(existing.trim());
    });
});

// ═══════════════════════════════════════════════════════════════════════
// safeHostFromUrl()
// ═══════════════════════════════════════════════════════════════════════
describe("safeHostFromUrl", () => {
    it("extracts host after @", () => {
        expect(safeHostFromUrl("postgres://user:pass@localhost:5432/db")).toBe("localhost:5432/db");
    });
    it("returns fallback for URLs without @", () => {
        expect(safeHostFromUrl("localhost:5432/db")).toBe("(local connection)");
    });
});
