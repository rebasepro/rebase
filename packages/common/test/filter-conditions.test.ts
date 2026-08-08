import { toFilterTuples } from "../src/data/filter-conditions";

/**
 * The `FilterValues` grammar has two shapes per field, and each driver used to
 * read it for itself. The Postgres compiler normalised both; the Mongo one
 * destructured the param directly, so an array of tuples bound `op` to a tuple,
 * matched no operator, and dropped every condition on that field — a filtered
 * read answering 200 with the whole collection. This is the one reading both
 * compilers now share.
 */
describe("toFilterTuples", () => {
    it("reads a single tuple as one condition", () => {
        expect(toFilterTuples(["==", "active"])).toEqual([["==", "active"]]);
    });

    it("reads an array of tuples as every condition in it", () => {
        expect(toFilterTuples([[">=", 18], ["<", 65]]))
            .toEqual([[">=", 18], ["<", 65]]);
    });

    it("keeps a list value from being mistaken for a list of conditions", () => {
        // `["in", ["a", "b"]]` is one condition whose *value* is an array. The
        // discriminator is the FIRST element: a tuple starts with an operator
        // string, a list of tuples starts with a tuple.
        expect(toFilterTuples(["in", ["a", "b"]])).toEqual([["in", ["a", "b"]]]);
    });

    it("has no conditions in an absent or malformed param", () => {
        expect(toFilterTuples(undefined)).toEqual([]);
        expect(toFilterTuples(null)).toEqual([]);
        expect(toFilterTuples("eq.active")).toEqual([]);
        expect(toFilterTuples([])).toEqual([]);
    });
});
