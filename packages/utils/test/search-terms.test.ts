/**
 * What a person typed into a search box, split into the terms they meant.
 *
 * The shape of the bug this exists for: on a collection that keeps a name in
 * `first_name` and `last_name`, searching `sebastian melendez` matched nothing
 * at all, because every search path compared the whole typed string against
 * each field on its own and no single field holds both words. `sebastian ` was
 * the same bug with one word — the trailing space was part of the needle.
 */
import { MAX_SEARCH_TERMS, splitSearchTerms } from "../src/strings";

describe("splitSearchTerms", () => {
    it("splits a name that lives in two fields", () => {
        expect(splitSearchTerms("sebastian melendez")).toEqual(["sebastian", "melendez"]);
    });

    it("drops a trailing space instead of searching for it", () => {
        expect(splitSearchTerms("sebastian ")).toEqual(["sebastian"]);
        expect(splitSearchTerms("  sebastian  melendez ")).toEqual(["sebastian", "melendez"]);
    });

    it("leaves a single term exactly as typed", () => {
        // The one-term case has to compile to what it always compiled to, or
        // every existing search changes meaning along with the broken ones.
        expect(splitSearchTerms("50%_")).toEqual(["50%_"]);
    });

    it("keeps a quoted run together, as the full-text path does", () => {
        expect(splitSearchTerms('"iso 14001" auditor')).toEqual(["iso 14001", "auditor"]);
    });

    it("strips an unbalanced quote rather than swallowing the rest", () => {
        expect(splitSearchTerms('"sebastian melendez')).toEqual(["sebastian", "melendez"]);
    });

    it("has no terms in a string that is only whitespace or quotes", () => {
        // The callers read this as "the user typed no terms" and each decides
        // what that means; none of them may read it as "every row".
        expect(splitSearchTerms("   ")).toEqual([]);
        expect(splitSearchTerms('""')).toEqual([]);
        expect(splitSearchTerms("")).toEqual([]);
    });

    it("caps the terms a pasted paragraph contributes", () => {
        // Each term is one ILIKE per searchable column per row on a sequential
        // scan, so an uncapped split makes the cost the caller's to choose.
        const many = Array.from({ length: 200 }, (_, i) => `t${i}`).join(" ");
        expect(splitSearchTerms(many)).toHaveLength(MAX_SEARCH_TERMS);
        expect(splitSearchTerms(many, 2)).toEqual(["t0", "t1"]);
    });
});
