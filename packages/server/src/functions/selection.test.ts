import { describe, expect, it } from "@jest/globals";
import { FunctionSelectionError, selectFunctions } from "./selection";

/**
 * Which functions a process serves.
 *
 * Most of these are about the refusal rather than the filtering, because the
 * filtering is a `.filter` and the refusal is the design decision: a process
 * told to serve `send-invoice` and given a name that does not exist would
 * otherwise start, serve nothing, and answer 404 to the only caller it has.
 */

const loaded = (...names: string[]) => names.map(name => ({ name, app: {} as never }));

describe("selectFunctions", () => {
    it("serves everything when nothing is named", () => {
        expect(selectFunctions(loaded("a", "b")).map(f => f.name)).toEqual(["a", "b"]);
        expect(selectFunctions(loaded("a", "b"), {}).map(f => f.name)).toEqual(["a", "b"]);
        expect(selectFunctions(loaded("a", "b"), { only: [], exclude: [] }).map(f => f.name))
            .toEqual(["a", "b"]);
    });

    it("serves only what `only` names", () => {
        expect(selectFunctions(loaded("a", "b", "c"), { only: ["a", "c"] }).map(f => f.name))
            .toEqual(["a", "c"]);
    });

    it("drops what `exclude` names", () => {
        expect(selectFunctions(loaded("a", "b", "c"), { exclude: ["b"] }).map(f => f.name))
            .toEqual(["a", "c"]);
    });

    it("applies exclude after only", () => {
        expect(selectFunctions(loaded("a", "b", "c"), { only: ["a", "b"], exclude: ["b"] }).map(f => f.name))
            .toEqual(["a"]);
    });

    it("preserves the loader's order rather than the selection's", () => {
        // The order functions mount in is the loader's, and a selection that
        // silently reordered them would make two processes disagree about which
        // handler wins an overlapping route.
        expect(selectFunctions(loaded("a", "b", "c"), { only: ["c", "a"] }).map(f => f.name))
            .toEqual(["a", "c"]);
    });

    describe("a name the bundle does not contain", () => {
        it("refuses to boot rather than serving nothing", () => {
            expect(() => selectFunctions(loaded("send-invoice"), { only: ["send-invoices"] }))
                .toThrow(FunctionSelectionError);
        });

        it("lists what the bundle does contain", () => {
            // The list is the whole message: the usual cause is a name that
            // differs by a plural, a dash or an extension, and it is obvious the
            // moment the two sit side by side.
            try {
                selectFunctions(loaded("send-invoice", "webhook"), { only: ["send-invoices"] });
                throw new Error("expected a refusal");
            } catch (err) {
                expect(err).toBeInstanceOf(FunctionSelectionError);
                expect((err as Error).message).toContain("send-invoices");
                expect((err as FunctionSelectionError).hint).toContain("send-invoice, webhook");
            }
        });

        it("holds exclude to the same standard", () => {
            // An excluded name that matches nothing means a function is still
            // being served by a process someone believed had stopped serving it.
            expect(() => selectFunctions(loaded("a"), { exclude: ["typo"] }))
                .toThrow(/REBASE_FUNCTIONS_EXCLUDE/);
        });

        it("says so plainly when the bundle has no functions at all", () => {
            try {
                selectFunctions([], { only: ["anything"] });
                throw new Error("expected a refusal");
            } catch (err) {
                expect((err as FunctionSelectionError).hint).toContain("no functions at all");
            }
        });

        it("names every unknown entry, not just the first", () => {
            expect(() => selectFunctions(loaded("a"), { only: ["x", "y"] }))
                .toThrow(/x, y/);
        });
    });
});
