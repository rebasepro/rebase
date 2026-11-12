import { describe, expect, it } from "@jest/globals";
import { col, defineTable, isTableDef, json, pgEnum, sql } from "@rebasepro/types";
import type { AnyColumn, AnyTableDef } from "@rebasepro/types";

import { compileTables } from "../../src/schema/compile-tables";
import { printColumn } from "../../src/schema/print-column";
import { printTableModule } from "../../src/schema/print-table";
import { evaluateModules } from "./print-eval";

const assertTable = (value: unknown): AnyTableDef => {
    if (!isTableDef(value)) throw new Error("the printed module did not evaluate to a table");
    return value;
};

/**
 * The Drizzle spelling of a column (`drizzle-alignment.md`) builds exactly what
 * the old spelling built: the same `ColumnDef`, and — compiled inside a table —
 * the same `ColumnDescriptor`, so the planner, the API and the SDK cannot tell
 * them apart. The printer writes the Drizzle spelling, and what it writes reads
 * back to the same definition.
 */

const postStatus = pgEnum("post_status", ["draft", "published"]);

/** [what, old spelling, Drizzle spelling]. */
const PAIRS: readonly [string, AnyColumn, AnyColumn][] = [
    ["SQL name", col.text().column("legacy_title"), col.text("legacy_title")],
    ["SQL name on a config builder", col.varchar(40).column("short_code"), col.varchar("short_code", { length: 40 })],
    ["varchar length", col.varchar(160).notNull().unique(), col.varchar({ length: 160 }).notNull().unique()],
    ["varchar default length", col.varchar(), col.varchar({ length: 255 })],
    ["char length", col.char(2), col.char({ length: 2 })],
    ["text enum", col.text().oneOf(["news", "guide"]), col.text({ enum: ["news", "guide"] })],
    ["varchar enum", col.varchar(8).oneOf(["a", "b"]), col.varchar({ length: 8, enum: ["a", "b"] })],
    ["bigint mode", col.bigint().notNull().default(0), col.bigint({ mode: "number" }).notNull().default(0)],
    ["bigserial mode", col.bigserial().primaryKey(), col.bigserial({ mode: "number" }).primaryKey()],
    ["numeric", col.numeric(10, 2), col.numeric({ precision: 10, scale: 2 })],
    ["numeric precision", col.numeric(10), col.numeric({ precision: 10, mode: "number" })],
    ["bare numeric", col.numeric(), col.numeric()],
    ["decimal", col.numeric(8, 3), col.decimal({ precision: 8, scale: 3 })],
    ["timestamptz", col.timestamptz().notNull(), col.timestamp({ withTimezone: true }).notNull()],
    ["timestamp mode string", col.timestamptz(), col.timestamp({ withTimezone: true, mode: "string" })],
    ["timestamp named", col.timestamptz().column("created"), col.timestamp("created", { withTimezone: true })],
    ["date mode string", col.date(), col.date({ mode: "string" })],
    ["time without zone", col.time(), col.time({ withTimezone: false })],
    ["defaultNow", col.timestamptz().defaultSql("now()"), col.timestamp({ withTimezone: true }).defaultNow()],
    ["sql default", col.text().defaultSql("gen_short_id()"), col.text().default(sql`gen_short_id()`)],
    ["generated", col.text().generatedAs("lower(title)"), col.text().generatedAlwaysAs(sql`lower(title)`)],
    ["generated thunk", col.text().generatedAs("lower(title)"), col.text().generatedAlwaysAs(() => sql`lower(title)`)],
    ["identity", col.integer().primaryKey().identity(), col.integer().primaryKey().generatedByDefaultAsIdentity()],
    ["array", col.array(col.text()).notNull(), col.text().array().notNull()],
    ["array with item rules", col.array(col.text().oneOf(["a", "b"])), col.text({ enum: ["a", "b"] }).array()],
    ["array of validated numbers", col.array(col.integer().validate({ min: 0 })), col.integer().validate({ min: 0 }).array()],
    ["array named", col.array(col.text()).column("tag_list"), col.text("tag_list").array()],
    ["array default", col.array(col.text()).default([]), col.text().array().default([])],
    ["jsonb typed", col.jsonb<{ a?: string }>(), col.jsonb().$type<{ a?: string }>()],
    ["jsonb shape named", col.jsonb(json.object({ a: json.string() })).column("meta"), col.jsonb("meta", json.object({ a: json.string() }))],
    ["vector", col.vector(3), col.vector({ dimensions: 3 })],
    ["vector index", col.vector(3, { index: { metric: "l2" } }), col.vector({ dimensions: 3, index: { metric: "l2" } })],
    ["vector no index", col.vector(3, { index: false }), col.vector({ dimensions: 3, index: false })],
    ["named enum", col.enum(["draft", "published"], { name: "post_status" }).notNull(), postStatus().notNull()],
    ["named enum column", col.enum(["draft", "published"], { name: "post_status" }).column("state"), postStatus("state")],
    ["anonymous enum named column", col.enum(["x", "y"]).column("kind_col"), col.enum("kind_col", ["x", "y"])],
    ["custom", col.custom("inet"), col.custom({ dataType: "inet" })],
    ["custom named", col.custom("inet").column("ip_addr"), col.custom("ip_addr", { dataType: "inet" })],
    ["storage named", col.storage({ path: "a/" }).column("hero"), col.storage("hero", { path: "a/" })],
    ["storage multiple named", col.storage({ path: "a/" }).column("files").multiple(), col.storage("files", { path: "a/" }).multiple()],
    ["geopoint named", col.geopoint().column("loc"), col.geopoint("loc")],
    ["uuid named", col.uuid().column("ext_id"), col.uuid("ext_id")],
    ["integer named", col.integer().column("n"), col.integer("n")],
    ["boolean named", col.boolean().column("flag"), col.boolean("flag")],
    ["serial named", col.serial().column("seq"), col.serial("seq")]
];

const tableOf = (column: AnyColumn) =>
    defineTable("t", { columns: { id: col.uuid().primaryKey(), subject: column }, rls: "admin-only" });

const compiledColumn = (column: AnyColumn) => {
    const [table] = compileTables([tableOf(column)]);
    return table.columns.find(each => each.key === "subject");
};

describe("the Drizzle spelling builds what the old spelling built", () => {
    it.each(PAIRS)("%s: the same ColumnDef", (_what, before, after) => {
        expect(after.def).toEqual(before.def);
    });

    it.each(PAIRS)("%s: the same compiled ColumnDescriptor", (_what, before, after) => {
        expect(compiledColumn(after)).toEqual(compiledColumn(before));
    });

    it("compiles a whole table of Drizzle spellings to the old table's descriptors", () => {
        const before = defineTable("posts", {
            columns: Object.fromEntries(PAIRS.map(([, old], index) => [`c${index}`, old]).concat([["id", col.uuid().primaryKey()]])),
            rls: "admin-only"
        });
        const after = defineTable("posts", {
            columns: Object.fromEntries(PAIRS.map(([, , next], index) => [`c${index}`, next]).concat([["id", col.uuid().primaryKey()]])),
            rls: "admin-only"
        });
        expect(compileTables([after])).toEqual(compileTables([before]));
    });
});

describe("the printer writes the Drizzle spelling", () => {
    const printed: readonly [AnyColumn, string][] = [
        [col.timestamptz().notNull().defaultSql("now()"), "col.timestamp({ withTimezone: true }).notNull().defaultNow()"],
        [col.varchar(160), "col.varchar({ length: 160 })"],
        [col.varchar(), "col.varchar({ length: 255 })"],
        [col.text().column("legacy_title"), "col.text(\"legacy_title\")"],
        [col.bigint(), "col.bigint({ mode: \"number\" })"],
        [col.numeric(10, 2), "col.numeric({ precision: 10, scale: 2 })"],
        [col.text().defaultSql("gen_short_id()"), "col.text().default(sql`gen_short_id()`)"],
        [col.text().generatedAs("lower(title)"), "col.text().generatedAlwaysAs(sql`lower(title)`)"],
        [col.integer().primaryKey().identity(), "col.integer().primaryKey().generatedByDefaultAsIdentity()"],
        [col.array(col.text().oneOf(["a", "b"])).notNull(), "col.text({ enum: [\"a\", \"b\"] }).array().notNull()"],
        [col.array(col.text()).column("tag_list"), "col.text(\"tag_list\").array()"],
        [col.vector(3, { index: false }), "col.vector({ dimensions: 3, index: false })"],
        [col.custom("inet").column("ip_addr"), "col.custom(\"ip_addr\", { dataType: \"inet\" })"],
        [col.integer().oneOf([1, 2]), "col.integer().oneOf([1, 2])"]
    ];

    it.each(printed)("%#: prints the canonical chain", (column, source) => {
        expect(printColumn(column.def, { key: "subject" })).toBe(source);
    });

    it("prints a named enum through its pgEnum binding", () => {
        const def = postStatus().notNull().def;
        expect(printColumn(def, { key: "status", enumIdentifier: () => "postStatus" })).toBe("postStatus().notNull()");
    });

    it("declares a named enum once with pgEnum above the table, and the module evaluates back", () => {
        const issues = defineTable("issues", {
            columns: {
                id: col.serial().primaryKey(),
                status: col.enum(["open", "closed"], { name: "issue_status_enum" }).notNull().default("open"),
                previous: col.enum(["open", "closed"], { name: "issue_status_enum" }),
                kind: col.enum(["bug", "idea"])
            },
            rls: "admin-only"
        });
        const module = printTableModule(issues);
        expect(module).toBe([
            "import { defineTable, col, pgEnum } from \"@rebasepro/server/schema\";",
            "",
            "const issueStatusEnum = pgEnum(\"issue_status_enum\", [\"open\", \"closed\"]);",
            "",
            "export const issues = defineTable(\"issues\", {",
            "    columns: {",
            "        id: col.serial().primaryKey(),",
            "        status: issueStatusEnum().notNull().default(\"open\"),",
            "        previous: issueStatusEnum(),",
            "        kind: col.enum([\"bug\", \"idea\"])",
            "    },",
            "    rls: \"admin-only\"",
            "});",
            ""
        ].join("\n"));
        const evaluated = evaluateModules([module]).issues;
        expect(compileTables([assertTable(evaluated)])).toEqual(compileTables([issues]));
    });

    it("escapes what a template literal would read differently", () => {
        const def = col.text().defaultSql("'a`b' || '${x}' || E'\\n'").def;
        const source = printColumn(def, { key: "subject" });
        expect(source).toBe("col.text().default(sql`'a\\`b' || '\\${x}' || E'\\\\n'`)");
        // What the source would build: the cooked text of the template.
        const rebuilt = col.text().default(sql`'a\`b' || '\${x}' || E'\\n'`);
        expect(rebuilt.def).toEqual(def);
    });
});
