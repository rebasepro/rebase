import { MongoConditionBuilder } from "../src/db/MongoConditionBuilder";

/**
 * The same ReDoS as the client's offline evaluator, on the server side.
 *
 * `like`/`ilike` is a public filter operator, so the pattern arrives over HTTP.
 * Here the translated expression is handed to MongoDB as `$regex`, so the
 * backtracking is spent on a database thread — one request, one pinned core.
 */
function sourceFor(pattern: string): string {
    const q = MongoConditionBuilder.buildQuery({ filter: { title: ["like", pattern] } }) as Record<string, { $regex: RegExp }>;
    return q.title.$regex.source;
}

describe("LIKE patterns handed to Mongo", () => {
    it("collapses a run of wildcards into one quantifier", () => {
        // Four adjacent `.*` is what makes a non-match exponential.
        expect(sourceFor("%%%%X")).toBe("^.*X$");
    });

    it("answers a hostile pattern promptly", () => {
        const re = new RegExp(sourceFor("%".repeat(14) + "X"));
        const started = Date.now();
        const result = re.test("a".repeat(48));

        expect(result).toBe(false);
        expect(Date.now() - started).toBeLessThan(1000);
    });

    it("still means what LIKE means", () => {
        expect(new RegExp(sourceFor("post-%")).test("post-1")).toBe(true);
        expect(new RegExp(sourceFor("post%%%%1")).test("post-1")).toBe(true);
        expect(new RegExp(sourceFor("a_c")).test("abc")).toBe(true);
        expect(new RegExp(sourceFor("a_c")).test("abbc")).toBe(false);
        expect(new RegExp(sourceFor("a__")).test("abc")).toBe(true);
        expect(new RegExp(sourceFor("other-%")).test("post-1")).toBe(false);
    });
});
