import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import { col, defineTable, rel, type DataDriver, type RelationDescriptor, type TableDescriptor } from "@rebasepro/types";
import { compileSchemaDefs } from "../src/schema/load-schema";
import { assertKnownWriteFields, assertWriteRequestValid } from "../src/api/rest/write-validation";
import { assertNestedWriteAllowed } from "../src/api/rest/nested-write-access";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";

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
 *
 * The same rule holds on the nested routes (security look 5, L-1 / L-2):
 * `POST` / `PATCH` / `DELETE /cases/1/tags/7` link and unlink, and `PATCH
 * /cases/1/graded/7 { _pivot }` edits the link's columns — all through
 * `assertJunctionWritable`, the one place every door asks.
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

const tagsTable = (): TableDescriptor => {
    const table = DESCRIPTORS.find(candidate => candidate.slug === "tags");
    if (!table) throw new Error("tags");
    return table;
};
const relationOf = (name: string): RelationDescriptor => {
    const relation = casesTable().relations.find(candidate => candidate.name === name);
    if (!relation) throw new Error(name);
    return relation;
};

describe("the nested-path gate (REST's nested routes and the socket)", () => {
    const hop = (name: string) => ({ parent: casesTable(), relation: relationOf(name), target: tagsTable() });

    it("refuses linking and unlinking through a declared junction whose link column is closed", () => {
        for (const kind of ["create", "update", "unlink"] as const) {
            expect(codeOf(() => assertNestedWriteAllowed(hop("tags"), kind, "cases/1/tags", editor, relatedTables))).toBe("VALIDATION_EXCLUDED_FIELDS");
            expect(codeOf(() => assertNestedWriteAllowed(hop("labels"), kind, "cases/1/labels", editor, relatedTables))).toBe("FIELD_NOT_WRITABLE");
            expect(codeOf(() => assertNestedWriteAllowed(hop("labels"), kind, "cases/1/labels", moderator, relatedTables))).toBeUndefined();
            expect(codeOf(() => assertNestedWriteAllowed(hop("loose"), kind, "cases/1/loose", editor, relatedTables))).toBeUndefined();
        }
    });
});

describe("the nested REST routes", () => {
    function harness(roles: string[]) {
        const writes: string[] = [];
        const row = { id: 7, label: "t" };
        const driver: DataDriver = {
            key: "postgres",
            initialised: true,
            async fetchOne() { return { ...row }; },
            async fetchCollection() { return []; },
            async count() { return 0; },
            async save(props) { writes.push("save"); return { ...row, ...props.values }; },
            async delete() { writes.push("delete"); },
            async checkUniqueField() { return true; },
            async updateRelationPivot() { writes.push("pivot"); }
        };
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("driver", driver);
            c.set("user", { uid: "u1", roles });
            await next();
        });
        app.route("/", new RestApiGenerator({ descriptors: DESCRIPTORS }, driver).generateRoutes());
        const send = (method: string, path: string, body?: unknown) => app.request(path, {
            method,
            headers: { "Content-Type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        return { send, writes };
    }
    const codeOfResponse = async (response: Response) => (await response.json() as { error: { code: string } }).error.code;

    it("refuses POST, PATCH and DELETE through a declared junction whose link column is closed, writing nothing", async () => {
        const { send, writes } = harness(["editor"]);
        for (const [method, path, body] of [
            ["POST", "/cases/1/tags", { id: 8, label: "new" }],
            ["PATCH", "/cases/1/tags/7", { label: "x" }],
            ["DELETE", "/cases/1/tags/7", undefined]
        ] as const) {
            const response = await send(method, path, body);
            expect([method, response.status, await codeOfResponse(response)]).toEqual([method, 400, "VALIDATION_EXCLUDED_FIELDS"]);
        }
        expect(writes).toEqual([]);
    });

    it("holds a `_pivot` edit to the declared junction's column rules", async () => {
        const editorCall = harness(["editor"]);
        const refused = await editorCall.send("PATCH", "/cases/1/graded/7", { _pivot: { grade: "A" } });
        expect(refused.status).toBe(400);
        expect(await codeOfResponse(refused)).toBe("FIELD_NOT_WRITABLE");
        expect(editorCall.writes).toEqual([]);

        const moderatorCall = harness(["moderator"]);
        const admitted = await moderatorCall.send("PATCH", "/cases/1/graded/7", { _pivot: { grade: "A" } });
        expect(admitted.status).toBe(204);
        expect(moderatorCall.writes).toEqual(["pivot"]);
    });

    it("leaves an implicit junction as it was", async () => {
        const { send } = harness(["editor"]);
        expect((await send("DELETE", "/cases/1/loose/7")).status).not.toBe(400);
    });
});
