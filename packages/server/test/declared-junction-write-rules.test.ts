import { describe, expect, it } from "@jest/globals";
import { col, defineTable, rel, type TableDescriptor } from "@rebasepro/types";
import { compileSchemaDefs } from "../src/schema/load-schema";
import { assertKnownWriteFields, assertWriteRequestValid } from "../src/api/rest/write-validation";

/**
 * A many-to-many write through a DECLARED junction table is held to that
 * table's own column rules on the two link columns it sets (`.readOnly()`,
 * `access.write`), and on the `_pivot` fields it writes there
 * (FINAL-FIX-PRODUCT L-3; security look 4, F-3). An implicit junction (no
 * declared table) has no rules of its own and stays as it was.
 *
 * Before: `PATCH /cases/1 { tags: [7] }` set `case_tags.tag_id` although that
 * column is `.readOnly()` — `columnsWrittenOnOtherRows` answered nothing for a
 * many-to-many. Older than this branch (also 0.30.x).
 */

const tags = defineTable("tags", {
    columns: { id: col.integer().primaryKey(), label: col.text() },
    rls: [{ operation: "all", access: "authenticated" }]
});
const cases = defineTable("cases", {
    columns: { id: col.integer().primaryKey(), title: col.text() },
    relations: {
        tags: rel.manyToMany(() => tags, { through: "case_tags", sourceKey: "case_id", targetKey: "tag_id" }),
        labels: rel.manyToMany(() => tags, { through: "case_labels", sourceKey: "case_id", targetKey: "tag_id" }),
        graded: rel.manyToMany(() => tags, { through: "case_grades", sourceKey: "case_id", targetKey: "tag_id", pivot: { grade: col.text() } }),
        loose: rel.manyToMany(() => tags)
    },
    rls: [{ operation: "all", access: "authenticated" }]
});
const caseTags = defineTable("case_tags", {
    columns: { id: col.serial().primaryKey(), caseId: col.integer(), tagId: col.integer().readOnly() },
    rls: [{ operation: "all", access: "authenticated" }]
});
const caseLabels = defineTable("case_labels", {
    columns: { id: col.serial().primaryKey(), caseId: col.integer().access({ write: ["moderator"] }), tagId: col.integer() },
    rls: [{ operation: "all", access: "authenticated" }]
});
const caseGrades = defineTable("case_grades", {
    columns: { id: col.serial().primaryKey(), caseId: col.integer(), tagId: col.integer(), grade: col.text().access({ write: ["moderator"] }) },
    rls: [{ operation: "all", access: "authenticated" }]
});

const DESCRIPTORS = compileSchemaDefs([tags, cases, caseTags, caseLabels, caseGrades]).descriptors;
const casesTable = (): TableDescriptor => {
    const table = DESCRIPTORS.find(candidate => candidate.slug === "cases");
    if (!table) throw new Error("cases");
    return table;
};
const relatedTables = (name: string) => DESCRIPTORS.find(table => table.slug === name || table.table === name);
const editor = { roles: ["editor"] };
const moderator = { roles: ["moderator"] };

function codeOf(write: () => void): string | undefined {
    try {
        write();
        return undefined;
    } catch (error) {
        return typeof error === "object" && error !== null && "code" in error ? String(error.code) : String(error);
    }
}

describe("a many-to-many write through a declared junction", () => {
    it("is refused when the junction's link column is `.readOnly()`, as writing it on the junction is", () => {
        expect(codeOf(() => assertKnownWriteFields({ tagId: 7 }, DESCRIPTORS.find(t => t.slug === "case_tags") ?? casesTable(), { viewer: editor, relatedTables })))
            .toBe("VALIDATION_EXCLUDED_FIELDS");
        expect(codeOf(() => assertKnownWriteFields({ tags: [7] }, casesTable(), { viewer: editor, relatedTables }))).toBe("VALIDATION_EXCLUDED_FIELDS");
        expect(codeOf(() => assertKnownWriteFields({ tags: [] }, casesTable(), { viewer: editor, relatedTables }))).toBe("VALIDATION_EXCLUDED_FIELDS");
    });

    it("is refused to a caller the link column's access.write does not admit, and admitted to one it does", () => {
        expect(codeOf(() => assertKnownWriteFields({ labels: [7] }, casesTable(), { viewer: editor, relatedTables }))).toBe("FIELD_NOT_WRITABLE");
        expect(codeOf(() => assertKnownWriteFields({ labels: [7] }, casesTable(), { viewer: moderator, relatedTables }))).toBeUndefined();
    });

    it("holds `_pivot` fields to the declared junction's column rules", () => {
        const pivot = (fields: Record<string, unknown>) => ({ graded: [{ id: 7, _pivot: fields }] });
        expect(codeOf(() => assertKnownWriteFields(pivot({ grade: "A" }), casesTable(), { viewer: editor, relatedTables }))).toBe("FIELD_NOT_WRITABLE");
        expect(codeOf(() => assertKnownWriteFields(pivot({ grade: "A" }), casesTable(), { viewer: moderator, relatedTables }))).toBeUndefined();
    });

    it("runs on the socket's and MCP's check too", () => {
        expect(codeOf(() => assertWriteRequestValid({ tags: [7] }, casesTable(), { status: "existing", viewer: editor, relatedTables })))
            .toBe("VALIDATION_EXCLUDED_FIELDS");
    });

    it("leaves an implicit junction as it was: no rules of its own", () => {
        expect(codeOf(() => assertKnownWriteFields({ loose: [7] }, casesTable(), { viewer: editor, relatedTables }))).toBeUndefined();
        // Nor is a many-to-many refused when the junction's rules cannot be read.
        expect(codeOf(() => assertKnownWriteFields({ loose: [7] }, casesTable(), { viewer: editor }))).toBeUndefined();
    });
});
