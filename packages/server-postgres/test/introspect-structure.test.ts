/**
 * Structural table classification.
 *
 * Two halves, deliberately:
 *
 * - **Against real schemas** — pagila, chinook and northwind, captured from a
 *   live PostgreSQL server. These are the cases the classifier exists for, and
 *   they are the ones that decide whether the rules are any good. A rule that
 *   only works on schemas written to demonstrate it is not a rule.
 * - **Against built schemas** — the discriminating cases no sample database
 *   happens to contain: a junction that carries a quantity, a junction other
 *   rows point at, a child with two equally plausible parents. Each isolates
 *   one clause of one rule, so a failure names the clause.
 *
 * The refusal cases carry the weight here. Under-classifying is the intended
 * failure mode — a table wrongly left in the navigation is the status quo, a
 * table wrongly hidden is one the user cannot find — so most of what is asserted
 * below is that a rule *declines* when its evidence is ambiguous.
 */
import {
    classifyTables,
    deriveKanbanProperty,
    deriveListProperties,
    deriveSort,
    deriveTitleProperty,
    buildColumnFacts,
    groupForeignKeys,
    isAutoTimestamp,
    isBoundedString,
    isDerivedIndexColumn,
    isGeneratedColumn,
    isPayloadColumn,
    isReadOnlyColumn,
    lookupCandidates,
    LOOKUP_MAX_ROWS,
    type TableRole
} from "../src/schema/introspect-db-structure";
import { parseCheckConstraints } from "../src/schema/introspect-db-constraints";
import { buildEnumMap } from "../src/schema/introspect-db-logic";
import {
    autoStamp,
    buildSchema,
    column,
    foreignKey,
    loadRealSchema,
    serialPk,
    unique,
    type RealSchemaName
} from "./helpers/schema-metadata";

function rolesOf(name: RealSchemaName): Map<string, TableRole> {
    const { metadata, tables } = loadRealSchema(name);
    const classified = classifyTables(metadata, tables);
    return new Map(Array.from(classified, ([table, c]) => [table, c.role]));
}

function classifyBuilt(spec: Parameters<typeof buildSchema>[0]) {
    const { metadata, tables } = buildSchema(spec);
    return classifyTables(metadata, tables);
}

// ═══════════════════════════════════════════════════════════════════════
// Real schemas
// ═══════════════════════════════════════════════════════════════════════
describe("classifyTables on pagila", () => {
    const roles = rolesOf("pagila");

    it("folds the two pure join tables away", () => {
        expect(roles.get("film_actor")).toBe("junction");
        expect(roles.get("film_category")).toBe("junction");
    });

    it("names the two tables each junction relates", () => {
        const { metadata, tables } = loadRealSchema("pagila");
        const junction = classifyTables(metadata, tables).get("film_actor");
        expect(junction?.junction).toEqual({
            sourceTable: "actor",
            sourceColumn: "actor_id",
            targetTable: "film",
            targetColumn: "film_id"
        });
    });

    it("recognises the small referenced code lists", () => {
        // 16 categories, 6 languages.
        expect(roles.get("category")).toBe("lookup");
        expect(roles.get("language")).toBe("lookup");
    });

    it("keeps a referenced table with too many rows as an entity", () => {
        // `actor` has the same shape as `category` — referenced, no outbound
        // keys, two simple columns — and 200 rows. Only the count separates them.
        expect(roles.get("actor")).toBe("entity");
        // `country` is referenced by `city` and holds 109 rows.
        expect(roles.get("country")).toBe("entity");
    });

    it("keeps a table that references another as an entity", () => {
        // `city` is small and referenced, but points at `country`, so it is part
        // of the data rather than a closed list.
        expect(roles.get("city")).toBe("entity");
    });

    it("classifies the remaining tables as entities", () => {
        for (const table of ["film", "customer", "rental", "payment", "inventory", "staff", "store", "address"]) {
            expect(roles.get(table)).toBe("entity");
        }
    });

    it("sees only the partition parent, never the 26 monthly partitions", () => {
        const { metadata } = loadRealSchema("pagila");
        const names = metadata.tables.map((t) => t.table_name);
        expect(names).toContain("payment");
        expect(names.filter((n) => n.startsWith("payment_p2022"))).toEqual([]);
    });

    it("attributes the partitions' foreign keys to the partition parent", () => {
        // pagila declares payment's keys on each partition and none on the
        // parent. Read literally, the `payment` collection has no relations.
        const { metadata } = loadRealSchema("pagila");
        const paymentFks = metadata.fks.filter((fk) => fk.table_name === "payment");
        expect(paymentFks.map((fk) => fk.foreign_table_name).sort()).toEqual(["customer", "rental", "staff"]);
    });

    it("does not repeat a key once per partition", () => {
        const { metadata } = loadRealSchema("pagila");
        const customerKeys = metadata.fks.filter(
            (fk) => fk.table_name === "payment" && fk.foreign_table_name === "customer"
        );
        expect(customerKeys).toHaveLength(1);
    });
});

describe("classifyTables on chinook", () => {
    const roles = rolesOf("chinook");

    it("folds the playlist/track join table away", () => {
        expect(roles.get("playlist_track")).toBe("junction");
    });

    it("recognises the code lists", () => {
        expect(roles.get("genre")).toBe("lookup");
        expect(roles.get("media_type")).toBe("lookup");
    });

    it("leaves an association that carries its own columns as an entity", () => {
        // `invoice_line` has two required keys, to `invoice` and `track`, and
        // nothing in the schema says which owns it. Guessing would hide it under
        // the wrong parent; it stays where the user can find it.
        expect(roles.get("invoice_line")).toBe("entity");
    });

    it("keeps a self-referencing table as an entity", () => {
        // `employee.reports_to` points at `employee`, so it is referenced.
        expect(roles.get("employee")).toBe("entity");
    });
});

describe("classifyTables on northwind", () => {
    const roles = rolesOf("northwind");

    it("folds both join tables away", () => {
        expect(roles.get("employee_territories")).toBe("junction");
        expect(roles.get("customer_customer_demo")).toBe("junction");
    });

    it("does not fold away an association carrying price and quantity", () => {
        // `order_details` is keyed (order_id, product_id) like a junction, and
        // carries unit_price, quantity and discount. Folding it into a
        // many-to-many would drop those three columns from the UI entirely.
        expect(roles.get("order_details")).not.toBe("junction");
    });

    it("files that association under the order it belongs to", () => {
        const { metadata, tables } = loadRealSchema("northwind");
        const details = classifyTables(metadata, tables).get("order_details");
        expect(details?.role).toBe("owned-child");
        expect(details?.owner).toEqual({
            table: "orders",
            column: "order_id",
            evidence: "leading-key-column"
        });
    });

    it("recognises the code lists", () => {
        expect(roles.get("region")).toBe("lookup");
        expect(roles.get("shippers")).toBe("lookup");
    });

    it("keeps the tables the app is about", () => {
        for (const table of ["orders", "products", "customers", "employees", "suppliers"]) {
            expect(roles.get(table)).toBe("entity");
        }
    });
});

describe("classifyTables on openstreetmap", () => {
    const roles = rolesOf("openstreetmap");

    it("files the great many child tables under their parents", () => {
        // The OSM schema is mostly things belonging to a node, a way, a relation
        // or a changeset. 15 of its 56 tables leave the navigation.
        const owned = [...roles.values()].filter((r) => r === "owned-child").length;
        expect(owned).toBeGreaterThanOrEqual(12);
    });

    it("names an owner for each of them that is a real table", () => {
        const { metadata, tables } = loadRealSchema("openstreetmap");
        for (const c of classifyTables(metadata, tables).values()) {
            if (c.role !== "owned-child") continue;
            expect(tables.has(c.owner!.table)).toBe(true);
            expect(c.owner!.table).not.toBe(c.table);
        }
    });

    it("still leaves the tables the app is about in the navigation", () => {
        for (const table of ["users", "changesets", "notes", "nodes", "ways", "relations"]) {
            expect(roles.get(table)).toBe("entity");
        }
    });
});

describe("classifyTables on musicbrainz", () => {
    // Captured as a subset — see the fixture README. MusicBrainz names every
    // foreign key column after the table it points at, with no `_id` suffix,
    // which is the shape nothing else here has.
    const roles = rolesOf("musicbrainz");

    it("does not fold a tag link that carries a count", () => {
        // `area_tag (area, tag)` has the exact key shape of a junction and a
        // `count` column. The count is the interesting part of the row — folding
        // the table into a many-to-many would delete it from the UI.
        expect(roles.get("area_tag")).toBe("owned-child");
    });

    it("reads a foreign key column with no `_id` suffix", () => {
        const { metadata } = loadRealSchema("musicbrainz");
        const areaTag = metadata.fks.filter((fk) => fk.table_name === "area_tag");
        expect(areaTag.map((fk) => fk.column_name).sort()).toEqual(["area", "tag"]);
    });

    it("handles a three-column key made entirely of foreign keys", () => {
        // `area_tag_raw (area, editor, tag)` — every key column is a foreign key,
        // so the ownership ladder falls through to the leading one.
        const { metadata, tables } = loadRealSchema("musicbrainz");
        const raw = classifyTables(metadata, tables).get("area_tag_raw");
        expect(raw?.role).toBe("owned-child");
        expect(raw?.owner).toEqual({ table: "area", column: "area", evidence: "leading-key-column" });
    });
});

describe("classification across every real schema", () => {
    const names: RealSchemaName[] = ["pagila", "chinook", "northwind", "openstreetmap", "musicbrainz"];

    it.each(names)("classifies every table in %s exactly once", (name) => {
        const { metadata, tables } = loadRealSchema(name);
        const classified = classifyTables(metadata, tables);
        expect(classified.size).toBe(tables.size);
        for (const table of tables.keys()) {
            expect(classified.get(table)?.table).toBe(table);
        }
    });

    it.each(names)("gives every table in %s a reason", (name) => {
        const { metadata, tables } = loadRealSchema(name);
        for (const c of classifyTables(metadata, tables).values()) {
            expect(c.reason.length).toBeGreaterThan(10);
        }
    });

    it.each(names)("is deterministic on %s", (name) => {
        const first = rolesOf(name);
        const second = rolesOf(name);
        expect([...second]).toEqual([...first]);
    });

    it.each(names)("never leaves a junction pointing at a missing table in %s", (name) => {
        const { metadata, tables } = loadRealSchema(name);
        for (const c of classifyTables(metadata, tables).values()) {
            if (!c.junction) continue;
            expect(tables.has(c.junction.sourceTable)).toBe(true);
            expect(tables.has(c.junction.targetTable)).toBe(true);
        }
    });

    it.each(names)("never makes a table its own parent in %s", (name) => {
        const { metadata, tables } = loadRealSchema(name);
        for (const [table, c] of classifyTables(metadata, tables)) {
            expect(c.owner?.table).not.toBe(table);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Junction detection — the discriminating cases
// ═══════════════════════════════════════════════════════════════════════
describe("junction detection", () => {
    const pair = () => ({
        tables: [
            { name: "posts", columns: [serialPk("posts"), column("posts", "title")] },
            { name: "tags", columns: [serialPk("tags"), column("tags", "label")] }
        ]
    });

    it("folds a composite-keyed pair of foreign keys", () => {
        const result = classifyBuilt({
            ...pair(),
            tables: [
                ...pair().tables,
                {
                    name: "posts_tags",
                    pks: ["post_id", "tag_id"],
                    columns: [
                        column("posts_tags", "post_id", { data_type: "integer", is_nullable: "NO" }),
                        column("posts_tags", "tag_id", { data_type: "integer", is_nullable: "NO" })
                    ]
                }
            ],
            fks: [foreignKey("posts_tags", "post_id", "posts"), foreignKey("posts_tags", "tag_id", "tags")]
        });
        expect(result.get("posts_tags")?.role).toBe("junction");
    });

    it("folds a surrogate-keyed pair when a unique index covers it", () => {
        const result = classifyBuilt({
            tables: [
                ...pair().tables,
                {
                    name: "posts_tags",
                    columns: [
                        serialPk("posts_tags"),
                        column("posts_tags", "post_id", { data_type: "integer", is_nullable: "NO" }),
                        column("posts_tags", "tag_id", { data_type: "integer", is_nullable: "NO" }),
                        autoStamp("posts_tags", "created_at")
                    ]
                }
            ],
            fks: [foreignKey("posts_tags", "post_id", "posts"), foreignKey("posts_tags", "tag_id", "tags")],
            uniques: [unique("posts_tags", "post_id", "tag_id")]
        });
        expect(result.get("posts_tags")?.role).toBe("junction");
    });

    it("refuses when the pair is not unique", () => {
        // Without uniqueness the table can hold the same pair twice, which makes
        // it a log of events between two things rather than a set membership.
        const result = classifyBuilt({
            tables: [
                ...pair().tables,
                {
                    name: "post_tag_events",
                    columns: [
                        serialPk("post_tag_events"),
                        column("post_tag_events", "post_id", { data_type: "integer", is_nullable: "NO" }),
                        column("post_tag_events", "tag_id", { data_type: "integer", is_nullable: "NO" })
                    ]
                }
            ],
            fks: [foreignKey("post_tag_events", "post_id", "posts"), foreignKey("post_tag_events", "tag_id", "tags")]
        });
        expect(result.get("post_tag_events")?.role).not.toBe("junction");
    });

    it("refuses when the table carries a payload column", () => {
        const result = classifyBuilt({
            tables: [
                ...pair().tables,
                {
                    name: "posts_tags",
                    pks: ["post_id", "tag_id"],
                    columns: [
                        column("posts_tags", "post_id", { data_type: "integer", is_nullable: "NO" }),
                        column("posts_tags", "tag_id", { data_type: "integer", is_nullable: "NO" }),
                        column("posts_tags", "weight", { data_type: "integer" })
                    ]
                }
            ],
            fks: [foreignKey("posts_tags", "post_id", "posts"), foreignKey("posts_tags", "tag_id", "tags")]
        });
        expect(result.get("posts_tags")?.role).not.toBe("junction");
    });

    it("refuses when another table references the junction", () => {
        const result = classifyBuilt({
            tables: [
                ...pair().tables,
                {
                    name: "posts_tags",
                    pks: ["post_id", "tag_id"],
                    columns: [
                        column("posts_tags", "post_id", { data_type: "integer", is_nullable: "NO" }),
                        column("posts_tags", "tag_id", { data_type: "integer", is_nullable: "NO" })
                    ]
                },
                {
                    name: "approvals",
                    columns: [serialPk("approvals"), column("approvals", "post_id", { data_type: "integer" })]
                }
            ],
            fks: [
                foreignKey("posts_tags", "post_id", "posts"),
                foreignKey("posts_tags", "tag_id", "tags"),
                foreignKey("approvals", "post_id", "posts_tags")
            ]
        });
        expect(result.get("posts_tags")?.role).not.toBe("junction");
    });

    it("refuses a table with three foreign keys", () => {
        const result = classifyBuilt({
            tables: [
                ...pair().tables,
                { name: "users", columns: [serialPk("users")] },
                {
                    name: "triple",
                    pks: ["post_id", "tag_id", "user_id"],
                    columns: [
                        column("triple", "post_id", { data_type: "integer", is_nullable: "NO" }),
                        column("triple", "tag_id", { data_type: "integer", is_nullable: "NO" }),
                        column("triple", "user_id", { data_type: "integer", is_nullable: "NO" })
                    ]
                }
            ],
            fks: [
                foreignKey("triple", "post_id", "posts"),
                foreignKey("triple", "tag_id", "tags"),
                foreignKey("triple", "user_id", "users")
            ]
        });
        expect(result.get("triple")?.role).not.toBe("junction");
    });

    it("folds a self-referencing junction", () => {
        // A follow graph: both keys point at the same table.
        const result = classifyBuilt({
            tables: [
                { name: "users", columns: [serialPk("users"), column("users", "handle")] },
                {
                    name: "follows",
                    pks: ["follower_id", "followee_id"],
                    columns: [
                        column("follows", "follower_id", { data_type: "integer", is_nullable: "NO" }),
                        column("follows", "followee_id", { data_type: "integer", is_nullable: "NO" })
                    ]
                }
            ],
            fks: [
                foreignKey("follows", "follower_id", "users"),
                foreignKey("follows", "followee_id", "users")
            ]
        });
        const junction = result.get("follows");
        expect(junction?.role).toBe("junction");
        expect(junction?.junction?.sourceTable).toBe("users");
        expect(junction?.junction?.targetTable).toBe("users");
    });

    it("refuses a composite foreign key that spans two columns", () => {
        // One two-column key, not two one-column keys — grouping by constraint
        // name is what tells them apart.
        const result = classifyBuilt({
            tables: [
                { name: "parents", pks: ["a", "b"], columns: [column("parents", "a"), column("parents", "b")] },
                {
                    name: "children",
                    pks: ["a", "b"],
                    columns: [column("children", "a", { is_nullable: "NO" }), column("children", "b", { is_nullable: "NO" })]
                }
            ],
            fks: [
                foreignKey("children", "a", "parents", { constraint_name: "children_parent_fkey", ordinal: 1 }),
                foreignKey("children", "b", "parents", { constraint_name: "children_parent_fkey", ordinal: 2 })
            ]
        });
        expect(result.get("children")?.role).not.toBe("junction");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Lookup detection
// ═══════════════════════════════════════════════════════════════════════
describe("lookup detection", () => {
    const codeList = (rows: number | undefined) => ({
        tables: [
            {
                name: "statuses",
                columns: [serialPk("statuses"), column("statuses", "label", { is_nullable: "NO" })]
            },
            {
                name: "orders",
                columns: [serialPk("orders"), column("orders", "status_id", { data_type: "integer" })]
            }
        ],
        fks: [foreignKey("orders", "status_id", "statuses")],
        rowCounts: rows === undefined ? {} : { statuses: rows }
    });

    it("classifies a small referenced list", () => {
        expect(classifyBuilt(codeList(5)).get("statuses")?.role).toBe("lookup");
    });

    it("refuses when the row count is unknown", () => {
        // `reltuples` reports -1 on a table that has never been analyzed, which
        // is every table in a restored dump. An absent count must not read as
        // "small" — that would file half a freshly restored database as reference
        // data.
        expect(classifyBuilt(codeList(undefined)).get("statuses")?.role).toBe("entity");
    });

    it("refuses an empty table", () => {
        expect(classifyBuilt(codeList(0)).get("statuses")?.role).toBe("entity");
    });

    it("refuses just above the threshold and accepts just below it", () => {
        expect(classifyBuilt(codeList(LOOKUP_MAX_ROWS)).get("statuses")?.role).toBe("lookup");
        expect(classifyBuilt(codeList(LOOKUP_MAX_ROWS + 1)).get("statuses")?.role).toBe("entity");
    });

    it("refuses a table nothing references", () => {
        const spec = codeList(5);
        expect(classifyBuilt({ ...spec, fks: [] }).get("statuses")?.role).toBe("entity");
    });

    it("refuses a table that references something else", () => {
        const result = classifyBuilt({
            tables: [
                { name: "groups", columns: [serialPk("groups")] },
                {
                    name: "statuses",
                    columns: [
                        serialPk("statuses"),
                        column("statuses", "label"),
                        column("statuses", "group_id", { data_type: "integer" })
                    ]
                },
                { name: "orders", columns: [serialPk("orders"), column("orders", "status_id", { data_type: "integer" })] }
            ],
            fks: [foreignKey("statuses", "group_id", "groups"), foreignKey("orders", "status_id", "statuses")],
            rowCounts: { statuses: 5 }
        });
        expect(result.get("statuses")?.role).toBe("entity");
    });

    it("refuses a table carrying content columns", () => {
        const result = classifyBuilt({
            tables: [
                {
                    name: "statuses",
                    columns: [
                        serialPk("statuses"),
                        column("statuses", "label"),
                        column("statuses", "config", { data_type: "jsonb", udt_name: "jsonb" })
                    ]
                },
                { name: "orders", columns: [serialPk("orders"), column("orders", "status_id", { data_type: "integer" })] }
            ],
            fks: [foreignKey("orders", "status_id", "statuses")],
            rowCounts: { statuses: 5 }
        });
        expect(result.get("statuses")?.role).toBe("entity");
    });

    it("refuses a table with too many payload columns", () => {
        const result = classifyBuilt({
            tables: [
                {
                    name: "statuses",
                    columns: [
                        serialPk("statuses"),
                        column("statuses", "a"), column("statuses", "b"),
                        column("statuses", "c"), column("statuses", "d")
                    ]
                },
                { name: "orders", columns: [serialPk("orders"), column("orders", "status_id", { data_type: "integer" })] }
            ],
            fks: [foreignKey("orders", "status_id", "statuses")],
            rowCounts: { statuses: 5 }
        });
        expect(result.get("statuses")?.role).toBe("entity");
    });

    it("does not count database-maintained timestamps against the payload budget", () => {
        const result = classifyBuilt({
            tables: [
                {
                    name: "statuses",
                    columns: [
                        serialPk("statuses"),
                        column("statuses", "a"), column("statuses", "b"), column("statuses", "c"),
                        autoStamp("statuses", "created_at"), autoStamp("statuses", "updated_at")
                    ]
                },
                { name: "orders", columns: [serialPk("orders"), column("orders", "status_id", { data_type: "integer" })] }
            ],
            fks: [foreignKey("orders", "status_id", "statuses")],
            rowCounts: { statuses: 5 }
        });
        expect(result.get("statuses")?.role).toBe("lookup");
    });
});

describe("lookupCandidates", () => {
    it("names only the tables whose classification a row count could change", () => {
        const { metadata, tables } = loadRealSchema("pagila");
        const candidates = lookupCandidates(metadata, tables);
        expect(candidates.sort()).toEqual(["actor", "category", "country", "language"]);
    });

    it("does not depend on row counts already present", () => {
        // The caller has to be able to run it *before* counting anything.
        const { metadata, tables } = loadRealSchema("pagila");
        const before = lookupCandidates({ ...metadata, rowCounts: {} }, tables);
        const after = lookupCandidates({ ...metadata, rowCounts: { category: 1000 } }, tables);
        expect(after).toEqual(before);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Ownership
// ═══════════════════════════════════════════════════════════════════════
describe("ownership", () => {
    const twoParents = (childColumns: ReturnType<typeof column>[], fks: ReturnType<typeof foreignKey>[]) => ({
        tables: [
            { name: "invoices", columns: [serialPk("invoices")] },
            { name: "products", columns: [serialPk("products")] },
            { name: "lines", columns: childColumns }
        ],
        fks
    });

    it("follows ON DELETE CASCADE", () => {
        const result = classifyBuilt(twoParents(
            [
                serialPk("lines"),
                column("lines", "invoice_id", { data_type: "integer", is_nullable: "NO" }),
                column("lines", "product_id", { data_type: "integer", is_nullable: "NO" })
            ],
            [
                foreignKey("lines", "invoice_id", "invoices", { delete_rule: "CASCADE" }),
                foreignKey("lines", "product_id", "products")
            ]
        ));
        expect(result.get("lines")?.owner).toEqual({
            table: "invoices",
            column: "invoice_id",
            evidence: "cascade-delete"
        });
    });

    it("declines when two keys both cascade", () => {
        const result = classifyBuilt(twoParents(
            [
                serialPk("lines"),
                column("lines", "invoice_id", { data_type: "integer", is_nullable: "NO" }),
                column("lines", "product_id", { data_type: "integer", is_nullable: "NO" })
            ],
            [
                foreignKey("lines", "invoice_id", "invoices", { delete_rule: "CASCADE" }),
                foreignKey("lines", "product_id", "products", { delete_rule: "CASCADE" })
            ]
        ));
        expect(result.get("lines")?.role).toBe("entity");
    });

    it("follows a foreign key inside the primary key when only one is", () => {
        // Keyed (invoice_id, seq): the row is identified *by* its invoice, which
        // is as close to containment as a relational schema gets.
        const result = classifyBuilt({
            tables: [
                { name: "invoices", columns: [serialPk("invoices")] },
                { name: "products", columns: [serialPk("products")] },
                {
                    name: "lines",
                    pks: ["invoice_id", "seq"],
                    columns: [
                        column("lines", "invoice_id", { data_type: "integer", is_nullable: "NO" }),
                        column("lines", "seq", { data_type: "integer", is_nullable: "NO" }),
                        column("lines", "product_id", { data_type: "integer", is_nullable: "NO" })
                    ]
                }
            ],
            fks: [foreignKey("lines", "invoice_id", "invoices"), foreignKey("lines", "product_id", "products")]
        });
        expect(result.get("lines")?.owner?.evidence).toBe("identifying-key");
        expect(result.get("lines")?.owner?.table).toBe("invoices");
    });

    it("follows the only required key", () => {
        const result = classifyBuilt(twoParents(
            [
                serialPk("lines"),
                column("lines", "invoice_id", { data_type: "integer", is_nullable: "NO" }),
                column("lines", "product_id", { data_type: "integer", is_nullable: "YES" })
            ],
            [foreignKey("lines", "invoice_id", "invoices"), foreignKey("lines", "product_id", "products")]
        ));
        expect(result.get("lines")?.owner?.evidence).toBe("sole-required-key");
        expect(result.get("lines")?.owner?.table).toBe("invoices");
    });

    it("declines when two keys are equally required and nothing else separates them", () => {
        const result = classifyBuilt(twoParents(
            [
                serialPk("lines"),
                column("lines", "invoice_id", { data_type: "integer", is_nullable: "NO" }),
                column("lines", "product_id", { data_type: "integer", is_nullable: "NO" })
            ],
            [foreignKey("lines", "invoice_id", "invoices"), foreignKey("lines", "product_id", "products")]
        ));
        expect(result.get("lines")?.role).toBe("entity");
        expect(result.get("lines")?.owner).toBeUndefined();
    });

    it("declines when another table references the child", () => {
        const result = classifyBuilt({
            tables: [
                { name: "invoices", columns: [serialPk("invoices")] },
                {
                    name: "lines",
                    columns: [serialPk("lines"), column("lines", "invoice_id", { data_type: "integer", is_nullable: "NO" })]
                },
                { name: "returns", columns: [serialPk("returns"), column("returns", "line_id", { data_type: "integer" })] }
            ],
            fks: [
                foreignKey("lines", "invoice_id", "invoices", { delete_rule: "CASCADE" }),
                foreignKey("returns", "line_id", "lines")
            ]
        });
        expect(result.get("lines")?.role).toBe("entity");
    });

    it("prefers a cascade over an identifying key when they disagree", () => {
        const result = classifyBuilt({
            tables: [
                { name: "invoices", columns: [serialPk("invoices")] },
                { name: "products", columns: [serialPk("products")] },
                {
                    name: "lines",
                    pks: ["product_id", "seq"],
                    columns: [
                        column("lines", "product_id", { data_type: "integer", is_nullable: "NO" }),
                        column("lines", "seq", { data_type: "integer", is_nullable: "NO" }),
                        column("lines", "invoice_id", { data_type: "integer", is_nullable: "NO" })
                    ]
                }
            ],
            fks: [
                foreignKey("lines", "product_id", "products"),
                foreignKey("lines", "invoice_id", "invoices", { delete_rule: "CASCADE" })
            ]
        });
        expect(result.get("lines")?.owner?.table).toBe("invoices");
    });

    it("uses key order only when the whole primary key is foreign keys", () => {
        // With a surrogate key present, the ordering argument does not apply.
        const result = classifyBuilt(twoParents(
            [
                serialPk("lines"),
                column("lines", "invoice_id", { data_type: "integer", is_nullable: "NO" }),
                column("lines", "product_id", { data_type: "integer", is_nullable: "NO" })
            ],
            [foreignKey("lines", "invoice_id", "invoices"), foreignKey("lines", "product_id", "products")]
        ));
        expect(result.get("lines")?.owner?.evidence).not.toBe("leading-key-column");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Column predicates
// ═══════════════════════════════════════════════════════════════════════
describe("isAutoTimestamp", () => {
    it.each([
        "now()", "CURRENT_TIMESTAMP", "current_timestamp", "LOCALTIMESTAMP",
        "transaction_timestamp()", "statement_timestamp()", "clock_timestamp()"
    ])("accepts a temporal column defaulting to %s", (def) => {
        expect(isAutoTimestamp(column("t", "c", {
            data_type: "timestamp with time zone", column_default: def
        }))).toBe(true);
    });

    it("accepts a stamp whose name is not English", () => {
        // The point of reading the default rather than the name.
        expect(isAutoTimestamp(autoStamp("t", "fecha_creacion"))).toBe(true);
        expect(isAutoTimestamp(autoStamp("t", "last_update"))).toBe(true);
    });

    it("rejects a temporal column with no default", () => {
        // A user-editable `created_at date` is not database-maintained, and
        // marking it read-only would take a real field away.
        expect(isAutoTimestamp(column("t", "created_at", { data_type: "date" }))).toBe(false);
    });

    it("rejects a temporal column defaulting to a constant", () => {
        expect(isAutoTimestamp(column("t", "c", {
            data_type: "date", column_default: "'2020-01-01'::date"
        }))).toBe(false);
    });

    it("rejects a non-temporal column defaulting to now()", () => {
        expect(isAutoTimestamp(column("t", "c", { data_type: "text", column_default: "now()::text" }))).toBe(false);
    });
});

describe("isBoundedString / isGeneratedColumn / isDerivedIndexColumn", () => {
    it("recognises a declared length", () => {
        expect(isBoundedString(column("t", "c", {
            data_type: "character varying", character_maximum_length: 50
        }))).toBe(true);
        expect(isBoundedString(column("t", "c", { data_type: "text" }))).toBe(false);
    });

    it("recognises a generated column", () => {
        expect(isGeneratedColumn(column("t", "c", { is_generated: "ALWAYS" }))).toBe(true);
        expect(isGeneratedColumn(column("t", "c", { is_generated: "NEVER" }))).toBe(false);
    });

    it("recognises a full-text index column", () => {
        expect(isDerivedIndexColumn(column("t", "c", { data_type: "tsvector", udt_name: "tsvector" }))).toBe(true);
        expect(isReadOnlyColumn(column("t", "c", { data_type: "tsvector", udt_name: "tsvector" }))).toBe(true);
        expect(isReadOnlyColumn(column("t", "c", { data_type: "text" }))).toBe(false);
    });

    it("finds pagila's generated column and its tsvector without knowing their names", () => {
        const { metadata } = loadRealSchema("pagila");
        const film = metadata.columns.filter((c) => c.table_name === "film");
        expect(film.filter(isGeneratedColumn).map((c) => c.column_name)).toEqual(["length_hours"]);
        expect(film.filter(isDerivedIndexColumn).map((c) => c.column_name)).toEqual(["fulltext"]);
    });
});

describe("isPayloadColumn", () => {
    const pks = ["id"];
    const fkColumns = new Set(["owner_id"]);

    it("excludes keys, foreign keys, stamps and generated columns", () => {
        expect(isPayloadColumn(column("t", "id"), pks, fkColumns)).toBe(false);
        expect(isPayloadColumn(column("t", "owner_id"), pks, fkColumns)).toBe(false);
        expect(isPayloadColumn(autoStamp("t", "updated_at"), pks, fkColumns)).toBe(false);
        expect(isPayloadColumn(column("t", "computed", { is_generated: "ALWAYS" }), pks, fkColumns)).toBe(false);
    });

    it("includes an ordinary column", () => {
        expect(isPayloadColumn(column("t", "quantity", { data_type: "integer" }), pks, fkColumns)).toBe(true);
    });
});

describe("groupForeignKeys", () => {
    it("groups a composite key back into one constraint", () => {
        const grouped = groupForeignKeys([
            foreignKey("c", "a", "p", { constraint_name: "k", ordinal: 1 }),
            foreignKey("c", "b", "p", { constraint_name: "k", ordinal: 2 })
        ]);
        expect(grouped).toHaveLength(1);
        expect(grouped[0].columns).toEqual(["a", "b"]);
    });

    it("keeps two single-column keys separate", () => {
        const grouped = groupForeignKeys([
            foreignKey("c", "a", "p"),
            foreignKey("c", "b", "q")
        ]);
        expect(grouped).toHaveLength(2);
    });

    it("keeps two keys to the same table separate", () => {
        // pagila's `film` points at `language` twice.
        const { metadata } = loadRealSchema("pagila");
        const filmKeys = groupForeignKeys(metadata.fks.filter((fk) => fk.table_name === "film"));
        expect(filmKeys).toHaveLength(2);
        expect(filmKeys.every((k) => k.foreignTable === "language")).toBe(true);
    });

    it("treats rows with no constraint name as single-column keys", () => {
        // The shape older callers build by hand.
        const grouped = groupForeignKeys([
            { table_name: "c", column_name: "a", foreign_table_name: "p", foreign_column_name: "id" },
            { table_name: "c", column_name: "b", foreign_table_name: "q", foreign_column_name: "id" }
        ]);
        expect(grouped).toHaveLength(2);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Presentation derived from structure
// ═══════════════════════════════════════════════════════════════════════
function factsFor(schema: RealSchemaName, table: string) {
    const { metadata, tables } = loadRealSchema(schema);
    return buildColumnFacts(
        tables.get(table)!,
        metadata,
        buildEnumMap(metadata.enumValues),
        parseCheckConstraints(metadata.checks)
    );
}

describe("deriveTitleProperty", () => {
    it.each([
        ["pagila", "film", "title"],
        ["pagila", "category", "name"],
        ["pagila", "country", "country"],
        ["pagila", "actor", "first_name"],
        ["chinook", "album", "title"],
        ["chinook", "track", "name"],
        ["northwind", "products", "product_name"]
    ] as const)("picks %s.%s → %s without reading the column's name", (schema, table, expected) => {
        expect(deriveTitleProperty(factsFor(schema, table))).toBe(expected);
    });

    it("declines when the only label column is nullable", () => {
        // chinook's `artist.name` is `varchar(120)` with no NOT NULL. A title the
        // row may not have is not a title; the panel's own fallback handles it.
        expect(deriveTitleProperty(factsFor("chinook", "artist"))).toBeUndefined();
    });

    it("prefers a uniquely-constrained column over an earlier one", () => {
        const { metadata, tables } = buildSchema({
            tables: [{
                name: "users",
                columns: [
                    serialPk("users"),
                    column("users", "display", { is_nullable: "NO" }),
                    column("users", "handle", { is_nullable: "NO" })
                ]
            }],
            uniques: [unique("users", "handle")]
        });
        const facts = buildColumnFacts(tables.get("users")!, metadata, new Map(), new Map());
        expect(deriveTitleProperty(facts)).toBe("handle");
    });

    it("prefers a bounded string when the table also has unbounded ones", () => {
        const { metadata, tables } = buildSchema({
            tables: [{
                name: "posts",
                columns: [
                    serialPk("posts"),
                    column("posts", "body", { data_type: "text", is_nullable: "NO" }),
                    column("posts", "headline", {
                        data_type: "character varying", character_maximum_length: 120, is_nullable: "NO"
                    })
                ]
            }]
        });
        const facts = buildColumnFacts(tables.get("posts")!, metadata, new Map(), new Map());
        expect(deriveTitleProperty(facts)).toBe("headline");
    });

    it("skips nullable columns, keys and enums", () => {
        const { metadata, tables } = buildSchema({
            tables: [
                { name: "owners", columns: [serialPk("owners")] },
                {
                    name: "things",
                    columns: [
                        serialPk("things"),
                        column("things", "owner_id", { data_type: "integer", is_nullable: "NO" }),
                        column("things", "maybe", { is_nullable: "YES" }),
                        column("things", "state", { is_nullable: "NO" }),
                        column("things", "label", { is_nullable: "NO" })
                    ]
                }
            ],
            fks: [foreignKey("things", "owner_id", "owners")],
            checks: [{
                table_name: "things",
                constraint_name: "things_state_check",
                definition: "CHECK ((state = ANY (ARRAY['a'::text, 'b'::text])))"
            }]
        });
        const facts = buildColumnFacts(
            tables.get("things")!, metadata, new Map(), parseCheckConstraints(metadata.checks)
        );
        expect(deriveTitleProperty(facts)).toBe("label");
    });

    it("returns nothing when no column qualifies", () => {
        const { metadata, tables } = buildSchema({
            tables: [{ name: "counters", columns: [serialPk("counters"), column("counters", "n", { data_type: "integer" })] }]
        });
        expect(deriveTitleProperty(buildColumnFacts(tables.get("counters")!, metadata, new Map(), new Map()))).toBeUndefined();
    });
});

describe("deriveKanbanProperty", () => {
    const withEnum = (values: string[], nullable: "YES" | "NO") => {
        const { metadata, tables } = buildSchema({
            tables: [{
                name: "tickets",
                columns: [
                    serialPk("tickets"),
                    column("tickets", "state", {
                        data_type: "USER-DEFINED", udt_name: "ticket_state", is_nullable: nullable
                    })
                ]
            }],
            enumValues: values.map((v, i) => ({ enum_name: "ticket_state", enum_value: v, sort_order: i + 1 }))
        });
        return buildColumnFacts(tables.get("tickets")!, metadata, buildEnumMap(metadata.enumValues), new Map());
    };

    it("picks a required enum column with a workable number of values", () => {
        expect(deriveKanbanProperty(withEnum(["open", "doing", "done"], "NO"))).toBe("state");
    });

    it("declines a nullable enum, which has no column to sit in", () => {
        expect(deriveKanbanProperty(withEnum(["open", "doing", "done"], "YES"))).toBeUndefined();
    });

    it("declines a one-value enum", () => {
        expect(deriveKanbanProperty(withEnum(["only"], "NO"))).toBeUndefined();
    });

    it("declines an enum with more values than a board can show", () => {
        expect(deriveKanbanProperty(withEnum(Array.from({ length: 20 }, (_, i) => `v${i}`), "NO"))).toBeUndefined();
    });

    it("declines pagila's nullable rating enum", () => {
        expect(deriveKanbanProperty(factsFor("pagila", "film"))).toBeUndefined();
    });

    it("accepts a set declared by CHECK rather than by an enum type", () => {
        const { metadata, tables } = buildSchema({
            tables: [{
                name: "tickets",
                columns: [serialPk("tickets"), column("tickets", "state", { is_nullable: "NO" })]
            }],
            checks: [{
                table_name: "tickets",
                constraint_name: "tickets_state_check",
                definition: "CHECK ((state = ANY (ARRAY['open'::text, 'closed'::text])))"
            }]
        });
        const facts = buildColumnFacts(tables.get("tickets")!, metadata, new Map(), parseCheckConstraints(metadata.checks));
        expect(deriveKanbanProperty(facts)).toBe("state");
    });
});

describe("deriveSort", () => {
    it("sorts by the single database-maintained stamp, newest first", () => {
        expect(deriveSort(factsFor("pagila", "film"))).toEqual(["last_update", "desc"]);
    });

    it("declines when a table has two stamps and the schema does not say which", () => {
        const { metadata, tables } = buildSchema({
            tables: [{
                name: "posts",
                columns: [serialPk("posts"), autoStamp("posts", "created_at"), autoStamp("posts", "updated_at")]
            }]
        });
        expect(deriveSort(buildColumnFacts(tables.get("posts")!, metadata, new Map(), new Map()))).toBeUndefined();
    });

    it("declines when a table has none", () => {
        const { metadata, tables } = buildSchema({ tables: [{ name: "posts", columns: [serialPk("posts")] }] });
        expect(deriveSort(buildColumnFacts(tables.get("posts")!, metadata, new Map(), new Map()))).toBeUndefined();
    });
});

describe("deriveListProperties", () => {
    it("caps a wide table", () => {
        const order = ["a", "b", "c", "d", "e", "f", "g", "h"];
        expect(deriveListProperties(order)).toEqual(["a", "b", "c", "d", "e", "f"]);
    });

    it("returns nothing for a table that is already narrow", () => {
        // Restating every column is config that does nothing and quietly stops
        // later columns from showing up.
        expect(deriveListProperties(["a", "b", "c"])).toBeUndefined();
    });

    it("skips properties the list view does not render", () => {
        // Spending one of six columns on a value the list will not draw is worse
        // than not capping at all.
        const order = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
        expect(deriveListProperties(order, new Set(["b", "d"]))).toEqual(["a", "c", "e", "f", "g", "h"]);
    });

    it("returns nothing when hiding brings the table under the cap", () => {
        expect(deriveListProperties(["a", "b", "c", "d", "e", "f", "g"], new Set(["a"]))).toBeUndefined();
    });
});
