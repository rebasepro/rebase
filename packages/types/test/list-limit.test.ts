import {
    resolveClientListLimit,
    ListLimitError,
    DEFAULT_LIST_LIMIT,
    DEFAULT_VECTOR_LIST_LIMIT,
    MAX_LIST_LIMIT
} from "../src/controllers/data_driver";

// The single shared guarantee applied at every untrusted list ingress (REST
// `GET /<collection>` and the WebSocket `subscribe_collection`). If these
// change, both surfaces change together.
describe("resolveClientListLimit", () => {
    it("defaults an absent limit to the plain-read page size", () => {
        expect(resolveClientListLimit(undefined)).toBe(DEFAULT_LIST_LIMIT);
        expect(resolveClientListLimit(null)).toBe(DEFAULT_LIST_LIMIT);
        expect(resolveClientListLimit("")).toBe(DEFAULT_LIST_LIMIT);
        expect(resolveClientListLimit("   ")).toBe(DEFAULT_LIST_LIMIT);
    });

    it("defaults an absent limit to the smaller vector page size for a vector search", () => {
        expect(resolveClientListLimit(undefined, { vectorSearch: true })).toBe(DEFAULT_VECTOR_LIST_LIMIT);
        expect(DEFAULT_VECTOR_LIST_LIMIT).toBeLessThan(DEFAULT_LIST_LIMIT);
    });

    // The heart of it. This used to answer 1 000 — a page the caller cannot
    // tell apart from a collection that holds 1 000 rows, which is how an
    // export asking for everything wrote a short file that looked complete.
    it("refuses an over-large limit instead of quietly shrinking it", () => {
        expect(() => resolveClientListLimit(100_000_000)).toThrow(ListLimitError);
        expect(() => resolveClientListLimit("100000000")).toThrow(ListLimitError);
        // A vector search has a smaller default but the same ceiling.
        expect(() => resolveClientListLimit(100_000_000, { vectorSearch: true })).toThrow(ListLimitError);
        // One over is over.
        expect(() => resolveClientListLimit(MAX_LIST_LIMIT + 1)).toThrow(ListLimitError);
    });

    it("names the ceiling it enforces, so a caller can page by it without guessing", () => {
        let caught: ListLimitError | undefined;
        try {
            resolveClientListLimit(5000);
        } catch (e) {
            caught = e as ListLimitError;
        }
        expect(caught).toBeInstanceOf(ListLimitError);
        expect(caught!.maxLimit).toBe(MAX_LIST_LIMIT);
        expect(caught!.status).toBe(400);
        expect(caught!.code).toBe("INVALID_LIMIT");
        expect(caught!.message).toContain(String(MAX_LIST_LIMIT));
        expect(caught!.message).toContain("offset");
    });

    it("honours a limit at or below the maximum", () => {
        expect(resolveClientListLimit(50)).toBe(50);
        expect(resolveClientListLimit("50")).toBe(50);
        expect(resolveClientListLimit(1)).toBe(1);
        expect(resolveClientListLimit(MAX_LIST_LIMIT)).toBe(MAX_LIST_LIMIT);
    });

    // Each of these used to be silently coerced into range: `0` and `-5` became
    // 1 row, `2.9` became 2. All of them are a caller asking for a window that
    // does not exist, and answering with a different one hides the mistake.
    it("refuses a limit that is not a whole number of at least one row", () => {
        expect(() => resolveClientListLimit(0)).toThrow(ListLimitError);
        expect(() => resolveClientListLimit("0")).toThrow(ListLimitError);
        expect(() => resolveClientListLimit(-5)).toThrow(ListLimitError);
        expect(() => resolveClientListLimit(2.9)).toThrow(ListLimitError);
    });

    // A typo'd limit used to fall back to the default, so `?limit=1O0` (letter
    // O) served 50 rows and said nothing. `parseInt` was worse than that:
    // "50rows" parsed as 50.
    it("refuses a limit that is not a number at all rather than defaulting", () => {
        expect(() => resolveClientListLimit("abc")).toThrow(ListLimitError);
        expect(() => resolveClientListLimit("50rows")).toThrow(ListLimitError);
        expect(() => resolveClientListLimit(NaN)).toThrow(ListLimitError);
        expect(() => resolveClientListLimit(Infinity)).toThrow(ListLimitError);
    });

    it("respects caller-supplied bounds", () => {
        expect(resolveClientListLimit(undefined, { defaultLimit: 25 })).toBe(25);
        expect(resolveClientListLimit(200, { maxLimit: 200 })).toBe(200);
        expect(resolveClientListLimit(undefined, { vectorSearch: true, vectorDefaultLimit: 3 })).toBe(3);
    });

    it("reports the caller's own ceiling, not the global one, when bounds are overridden", () => {
        expect(() => resolveClientListLimit(9999, { maxLimit: 200 })).toThrow(/maximum of 200/);
        // …and the tighter ceiling really is enforced.
        expect(() => resolveClientListLimit(201, { maxLimit: 200 })).toThrow(ListLimitError);
    });
});
