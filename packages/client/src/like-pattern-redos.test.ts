import { matchesOperator } from "./offline-query";

/**
 * A `like` pattern is user input, and it becomes a regular expression.
 *
 * `%` translates to `[\s\S]*`, so `%%%%X` becomes four adjacent unbounded
 * quantifiers followed by a literal. On a subject that does not match, the
 * engine has to try every way of splitting the subject between them — which is
 * exponential. Twelve `%` against a forty-character value took **100 seconds**
 * on this machine before answering `false`.
 *
 * The pattern arrives over HTTP: `?title=like.%25%25%25…` is a public filter
 * operator, listed in the operator table. On the offline evaluator that freezes
 * the tab; the same translation in the Mongo driver hands the expression to the
 * database, where it occupies a server thread instead.
 *
 * Consecutive `%` mean exactly what one `%` means, so collapsing a run is
 * semantics-preserving and removes the ambiguity the backtracking feeds on.
 */
const HOSTILE = "%".repeat(14) + "X";
const SUBJECT = "a".repeat(48);

describe("like patterns cannot be made to backtrack", () => {
    it("answers a hostile pattern promptly", () => {
        const started = Date.now();
        const result = matchesOperator(SUBJECT, "like", HOSTILE);
        const elapsed = Date.now() - started;

        expect(result).toBe(false);
        expect(elapsed).toBeLessThan(1000);
    });

    it("answers the case-insensitive form promptly too", () => {
        const started = Date.now();
        matchesOperator(SUBJECT, "ilike", HOSTILE);

        expect(Date.now() - started).toBeLessThan(1000);
    });

    it("still means what LIKE means", () => {
        expect(matchesOperator("post-1", "like", "post-%")).toBe(true);
        expect(matchesOperator("post-1", "like", "%1")).toBe(true);
        expect(matchesOperator("post-1", "like", "%st-%")).toBe(true);
        expect(matchesOperator("post-1", "like", "other-%")).toBe(false);
        // A run of wildcards is the same query as one wildcard.
        expect(matchesOperator("post-1", "like", "post%%%%1")).toBe(true);
        expect(matchesOperator("abc", "like", "a_c")).toBe(true);
        expect(matchesOperator("abbc", "like", "a_c")).toBe(false);
        // `_` is fixed-width, so a run of them still counts.
        expect(matchesOperator("abc", "like", "a__")).toBe(true);
        expect(matchesOperator("ab", "like", "a__")).toBe(false);
    });

    it("keeps an escaped percent literal", () => {
        expect(matchesOperator("50%", "like", "50\\%")).toBe(true);
        expect(matchesOperator("500", "like", "50\\%")).toBe(false);
        // An escaped percent next to a wildcard is still a literal.
        expect(matchesOperator("50%off", "like", "50\\%%")).toBe(true);
        expect(matchesOperator("50off", "like", "50\\%%")).toBe(false);
    });
});
