import { describe, expect, it } from "@jest/globals";
import { col, defineTable, isTableDef, json, pgEnum, sql } from "@rebasepro/types";
import type { AnyColumn, AnyTableDef, ColumnDef } from "@rebasepro/types";

import { compileTables } from "../../src/schema/compile-tables";
import { printColumn } from "../../src/schema/print-column";
import { printTableModule } from "../../src/schema/print-table";
import { evaluateModules } from "./print-eval";

const assertTable = (value: unknown): AnyTableDef => {
    if (!isTableDef(value)) throw new Error("the printed module did not evaluate to a table");
    return value;
};

/**
 * The printer writes a column the way Drizzle's `pg-core` spells it
 * (`drizzle-alignment.md`), whatever built the definition, and what it writes
 * reads back to the same definition. The old spellings are gone; the builders
 * refuse them (`packages/types/test/schema/drizzle-spelling.test.ts`).
 */

const postStatus = pgEnum("post_status", ["draft", "published"]);

describe("the printer writes the Drizzle spelling", () => {
    const printed: readonly [AnyColumn, string][] = [
        [col.timestamp({ withTimezone: true }).notNull().default(sql`now()`), "col.timestamp({ withTimezone: true }).notNull().defaultNow()"],
        [col.varchar({ length: 160 }), "col.varchar({ length: 160 })"],
        [col.text("legacy_title"), "col.text(\"legacy_title\")"],
        [col.bigint({ mode: "number" }), "col.bigint({ mode: \"number\" })"],
        [col.decimal({ precision: 10, scale: 2 }), "col.numeric({ precision: 10, scale: 2 })"],
        [col.text().default(sql`gen_short_id()`), "col.text().default(sql`gen_short_id()`)"],
        [col.text().generatedAlwaysAs(() => sql`lower(title)`), "col.text().generatedAlwaysAs(sql`lower(title)`)"],
        [col.integer().primaryKey().generatedByDefaultAsIdentity(), "col.integer().primaryKey().generatedByDefaultAsIdentity()"],
        [col.text({ enum: ["a", "b"] }).array().notNull(), "col.text({ enum: [\"a\", \"b\"] }).array().notNull()"],
        [col.text("tag_list").array(), "col.text(\"tag_list\").array()"],
        [col.vector({ dimensions: 3, index: false }), "col.vector({ dimensions: 3, index: false })"],
        [col.custom("ip_addr", { dataType: "inet" }), "col.custom(\"ip_addr\", { dataType: \"inet\" })"],
        [col.jsonb("meta", json.object({ a: json.string() })), "col.jsonb(\"meta\", json.object({ a: json.string() }))"],
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
        const issueStatus = pgEnum("issue_status_enum", ["open", "closed"]);
        const issues = defineTable("issues", {
            columns: {
                id: col.serial().primaryKey(),
                status: issueStatus().notNull().default("open"),
                previous: issueStatus(),
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
        // A SQL default as the database or a descriptor states it, not as a template wrote it.
        const def: ColumnDef = { ...col.text().def, default: { kind: "sql", expression: "'a`b' || '${x}' || E'\\n'" } };
        const source = printColumn(def, { key: "subject" });
        expect(source).toBe("col.text().default(sql`'a\\`b' || '\\${x}' || E'\\\\n'`)");
        // What the source would build: the cooked text of the template.
        const rebuilt = col.text().default(sql`'a\`b' || '\${x}' || E'\\n'`);
        expect(rebuilt.def).toEqual(def);
    });
});
