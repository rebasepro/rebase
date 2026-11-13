import {
    getIconForTable,
    mapPgType, buildEnumMap, buildTablesMap, identifyJoinTables,
    mergeIndexModule, safeHostFromUrl,
    EnumValue, TableRow, TableColumn, PrimaryKeyRow, ForeignKeyRow
} from "../src/schema/introspect-db-logic";

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
        ["comments", "MessageCircle"], ["reviews", "MessageCircle"], ["feedback", "MessageCircle"]
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
            { enum_name: "status",
enum_value: "active",
sort_order: 1 },
            { enum_name: "status",
enum_value: "inactive",
sort_order: 2 },
            { enum_name: "role",
enum_value: "admin",
sort_order: 1 },
            { enum_name: "role",
enum_value: "user",
sort_order: 2 }
        ];
        const map = buildEnumMap(vals);
        expect(map.get("status")).toEqual(["active", "inactive"]);
        expect(map.get("role")).toEqual(["admin", "user"]);
    });
    it("returns empty map for no enums", () => {
        expect(buildEnumMap([]).size).toBe(0);
    });
    it("handles single-value enums", () => {
        const map = buildEnumMap([{ enum_name: "flag",
enum_value: "yes",
sort_order: 1 }]);
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
            { table_name: "users",
column_name: "id",
data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO",
column_default: null,
atttypmod: null },
            { table_name: "posts",
column_name: "id",
data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO",
column_default: null,
atttypmod: null },
            { table_name: "posts",
column_name: "user_id",
data_type: "uuid",
udt_name: "uuid",
is_nullable: "NO",
column_default: null,
atttypmod: null }
        ];
        const pks: PrimaryKeyRow[] = [
            { table_name: "users",
column_name: "id" },
            { table_name: "posts",
column_name: "id" }
        ];
        const fks: ForeignKeyRow[] = [
            { table_name: "posts",
column_name: "user_id",
foreign_table_name: "users",
foreign_column_name: "id" }
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
        table_name: table,
column_name: col,
data_type: "uuid",
        udt_name: "uuid",
is_nullable: "NO",
column_default: null,
atttypmod: null
    });

    it("detects a pure junction table with exactly 2 FKs", () => {
        const tablesMap = new Map([
            ["posts_to_tags", {
                name: "posts_to_tags",
                columns: [mkCol("posts_to_tags", "post_id"), mkCol("posts_to_tags", "tag_id")],
                pks: [],
                fks: [
                    { table_name: "posts_to_tags",
column_name: "post_id",
foreign_table_name: "posts",
foreign_column_name: "id" },
                    { table_name: "posts_to_tags",
column_name: "tag_id",
foreign_table_name: "tags",
foreign_column_name: "id" }
                ]
            }]
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
                    mkCol("posts_tags", "created_at")
                ],
                pks: ["id"],
                fks: [
                    { table_name: "posts_tags",
column_name: "post_id",
foreign_table_name: "posts",
foreign_column_name: "id" },
                    { table_name: "posts_tags",
column_name: "tag_id",
foreign_table_name: "tags",
foreign_column_name: "id" }
                ]
            }]
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
                    mkCol("enrollments", "grade") // extra column
                ],
                pks: [],
                fks: [
                    { table_name: "enrollments",
column_name: "student_id",
foreign_table_name: "students",
foreign_column_name: "id" },
                    { table_name: "enrollments",
column_name: "course_id",
foreign_table_name: "courses",
foreign_column_name: "id" }
                ]
            }]
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
                    { table_name: "posts",
column_name: "user_id",
foreign_table_name: "users",
foreign_column_name: "id" }
                ]
            }]
        ]);
        expect(identifyJoinTables(tablesMap).size).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// mergeIndexModule()
// ═══════════════════════════════════════════════════════════════════════
describe("mergeIndexModule", () => {
    const existing = [
        "import type { DefaultRls } from \"@rebasepro/server/schema\";",
        "",
        "export { users } from \"./users\";",
        "",
        "export const defaultRls: DefaultRls = \"admin-only\";",
        ""
    ].join("\n");

    it("adds an export line for each table the index does not export yet, after the last one", () => {
        const merged = mergeIndexModule(existing, [
            { identifier: "users", importPath: "./users" },
            { identifier: "blogPosts", importPath: "./blog_posts" }
        ]);
        expect(merged).toBe(existing.replace("export { users } from \"./users\";", "export { users } from \"./users\";\nexport { blogPosts } from \"./blog_posts\";"));
        expect(merged.match(/from "\.\/users"/g)).toHaveLength(1);
    });

    it("leaves an index that exports every table as it is", () => {
        expect(mergeIndexModule(existing, [{ identifier: "users", importPath: "./users" }])).toBe(existing);
    });

    it("prepends the lines to an index with no export yet", () => {
        expect(mergeIndexModule("// hand-written\n", [{ identifier: "tags", importPath: "./tags" }])).toBe("export { tags } from \"./tags\";\n\n// hand-written\n");
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
