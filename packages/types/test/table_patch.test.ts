import { describe, expect, it } from "@jest/globals";
import {
    TablePatchError,
    columnDefFromWire,
    isTablePatchList,
    parseTablePatches,
    rulePatches,
    tablePatchProblems,
    type TablePatch
} from "../src";

describe("tablePatchProblems", () => {
    it("accepts every operation, well formed", () => {
        const patches: TablePatch[] = [
            { op: "createTable", table: { name: "notes", columns: { id: { type: { kind: "uuid" }, primaryKey: true } }, rls: "admin-only", history: true } },
            { op: "deleteTable", table: "tags" },
            { op: "addColumn", table: "posts", key: "subtitle", column: { type: { kind: "varchar", length: 160 } }, before: "status" },
            { op: "changeColumn", table: "posts", key: "title", column: { type: { kind: "text" }, notNull: true } },
            { op: "renameColumn", table: "posts", key: "title", to: "headline", column: { type: { kind: "text" }, column: "title" } },
            { op: "removeColumn", table: "posts", key: "subtitle" },
            { op: "moveColumn", table: "posts", key: "title" },
            { op: "addRelation", table: "posts", name: "tags", relation: { kind: "manyToMany", target: "tags", pivot: { sortOrder: { type: { kind: "integer" } } } } },
            { op: "changeRelation", table: "posts", name: "author", relation: { kind: "belongsTo", target: "users", onDelete: "cascade" } },
            { op: "removeRelation", table: "posts", name: "author" },
            { op: "setRls", table: "posts", rls: [{ operation: "select", access: "public" }] },
            { op: "addRule", table: "posts", rule: { operation: "delete", roles: ["admin"] } },
            { op: "replaceRule", table: "posts", index: 0, rule: { operation: "select", ownerField: "authorId" } },
            { op: "removeRule", table: "posts", index: 1 },
            { op: "setOption", table: "posts", option: "description", value: "Blog posts." },
            { op: "setOption", table: "posts", option: "history", value: null }
        ];
        expect(tablePatchProblems(patches)).toEqual([]);
        expect(isTablePatchList(patches)).toBe(true);
    });

    it("refuses a slug, table or name rename with the reason, as a migration", () => {
        for (const option of ["slug", "table", "schema", "name"]) {
            const [problem] = tablePatchProblems([{ op: "setOption", table: "posts", option, value: "x" }]);
            expect(problem).toMatchObject({ index: 0, table: "posts", key: option });
            expect(problem.message).toMatch(/migration, not an edit/);
        }
    });

    it("names every problem, each with the edit it is in", () => {
        const problems = tablePatchProblems([
            { op: "addColumn", table: "posts", key: "x", column: { type: { kind: "nope" } } },
            { op: "createTable", table: { name: "1bad", columns: {}, rls: [] } },
            { op: "addRelation", table: "posts", name: "r", relation: { kind: "belongsTo", target: "", through: "x" } },
            { op: "setRls", table: "posts", rls: [] },
            { op: "frobnicate", table: "posts" }
        ]);
        expect(problems.map(problem => problem.index)).toEqual([0, 1, 1, 1, 2, 2, 3, 4]);
        const text = problems.map(problem => problem.message).join("\n");
        expect(text).toMatch(/column\.type must be a column type/);
        expect(text).toMatch(/`name` must be a SQL identifier/);
        expect(text).toMatch(/at least one column/);
        expect(text).toMatch(/Send "admin-only" instead/);
        expect(text).toMatch(/target must be the slug/);
        expect(text).toMatch(/through is not an option of `rel\.belongsTo`/);
        expect(text).toMatch(/is not a schema edit/);
    });

    it("refuses an identifier that would reach SQL unquoted-safe, and code", () => {
        const problems = tablePatchProblems([
            { op: "addColumn", table: "posts", key: "x", column: { type: { kind: "text" }, column: "a\"; DROP TABLE users; --" } },
            { op: "changeColumn", table: "posts", key: "x", column: { type: { kind: "text" }, transform: "() => 1" } },
            { op: "createTable", table: { name: "notes", columns: { id: { type: { kind: "uuid" }, primaryKey: true } }, rls: "admin-only", hooks: {} } }
        ]);
        expect(problems.map(problem => problem.message)).toEqual([
            expect.stringMatching(/column\.column must be a SQL identifier/),
            expect.stringMatching(/transform is code/),
            expect.stringMatching(/hooks are code/)
        ]);
    });

    it("refuses what is not a list, or an empty one", () => {
        expect(tablePatchProblems({ op: "deleteTable" })[0].message).toMatch(/must be a list/);
        expect(tablePatchProblems([])[0].message).toMatch(/nothing to edit/);
    });
});

describe("parseTablePatches", () => {
    it("throws every problem at once, in the shape of a schema error", () => {
        try {
            parseTablePatches([{ op: "removeColumn", table: "posts" }, { op: "deleteTable" }]);
            throw new Error("not refused");
        } catch (error) {
            expect(error).toBeInstanceOf(TablePatchError);
            if (!(error instanceof TablePatchError)) return;
            expect(error.code).toBe("TABLE_PATCH_INVALID");
            expect(error.problems).toHaveLength(2);
            expect(error.message).toBe(
                "The schema edit cannot be applied (2 problems):\n" +
                "  - edit 0 (posts): `key` must name the column.\n" +
                "  - edit 1 ((no table)): `table` must be the slug of the table to edit."
            );
        }
    });
});

describe("columnDefFromWire", () => {
    it("fills the flags the wire left out, an array item's included", () => {
        expect(columnDefFromWire({ type: { kind: "array", of: { kind: "text" } }, element: { type: { kind: "text" }, oneOf: ["a"] } })).toEqual({
            type: { kind: "array", of: { kind: "text" } },
            notNull: false, primaryKey: false, unique: false, readOnly: false, private: false,
            element: { type: { kind: "text" }, oneOf: ["a"], notNull: false, primaryKey: false, unique: false, readOnly: false, private: false }
        });
    });
});

describe("rulePatches", () => {
    const select = { operation: "select" as const, access: "public" as const };
    const write = { operations: ["insert" as const, "update" as const], roles: ["editor"] };
    const remove = { operation: "delete" as const, roles: ["admin"] };

    it("touches only the rules that changed", () => {
        expect(rulePatches("posts", [select, write, remove], [select, write, { ...remove, roles: ["admin", "owner"] }])).toEqual([
            { op: "replaceRule", table: "posts", index: 2, rule: { operation: "delete", roles: ["admin", "owner"] } }
        ]);
        expect(rulePatches("posts", [select, write], [select, { roles: ["editor"], operations: ["insert", "update"] }])).toEqual([]);
    });

    it("adds at the end and removes from the end, positions valid as each runs", () => {
        expect(rulePatches("posts", [select], [select, write, remove])).toEqual([
            { op: "addRule", table: "posts", rule: write, index: 1 },
            { op: "addRule", table: "posts", rule: remove, index: 2 }
        ]);
        expect(rulePatches("posts", [select, write, remove], [select])).toEqual([
            { op: "removeRule", table: "posts", index: 2 },
            { op: "removeRule", table: "posts", index: 1 }
        ]);
    });
});
