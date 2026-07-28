import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * `WhereFilterOp` is declared twice, on purpose.
 *
 * `@rebasepro/ui` is a standalone component library — it does not depend on
 * `@rebasepro/types`, and giving it one to share a string union would couple a
 * presentational package to the data layer for no benefit. So `VirtualTable`
 * carries its own copy.
 *
 * The cost is that the two can drift, and a drift is close to invisible:
 * `VirtualTable` takes the UI copy, callers pass the types copy, and structural
 * typing keeps both compiling right up until a filter reaches the table with an
 * operator the table's own union does not list. Adding an operator to one side
 * only is the easy mistake, and nothing else in the repo reports it.
 */
const ROOT = path.resolve(__dirname, "../../..");
const SOURCES = {
    types: "packages/types/src/types/filter-operators.ts",
    ui: "packages/ui/src/components/VirtualTable/VirtualTableProps.tsx"
};

/** The members of the first `export type WhereFilterOp = …` union in a file. */
function operatorsIn(relPath: string): string[] {
    const source = readFileSync(path.join(ROOT, relPath), "utf8");
    const decl = /export type WhereFilterOp\s*=([\s\S]*?);/.exec(source);
    if (!decl) throw new Error(`no 'export type WhereFilterOp' declaration in ${relPath}`);
    return [...decl[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("WhereFilterOp is duplicated in @rebasepro/ui and must not drift", () => {
    it("declares the same operators in both packages", () => {
        const inTypes = operatorsIn(SOURCES.types);
        const inUi = operatorsIn(SOURCES.ui);

        // Sorted: the declaration order is cosmetic, the membership is not.
        expect([...inUi].sort()).toEqual([...inTypes].sort());
    });

    it("parses a non-empty union from each file, so a rename cannot pass vacuously", () => {
        // Without this, renaming the type in either file makes operatorsIn throw
        // — which is caught above as a failure — but an *emptied* union would
        // compare equal to an emptied union and the guard would go quiet.
        expect(operatorsIn(SOURCES.types).length).toBeGreaterThan(10);
        expect(operatorsIn(SOURCES.ui).length).toBeGreaterThan(10);
    });
});
