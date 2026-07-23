import {
    resolveClientListLimit,
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

    it("clamps an over-large limit to the hard maximum (the core DoS fix)", () => {
        expect(resolveClientListLimit(100_000_000)).toBe(MAX_LIST_LIMIT);
        expect(resolveClientListLimit("100000000")).toBe(MAX_LIST_LIMIT);
        // Even on a vector search, an explicit limit is clamped (not defaulted).
        expect(resolveClientListLimit(100_000_000, { vectorSearch: true })).toBe(MAX_LIST_LIMIT);
    });

    it("honours a limit at or below the maximum", () => {
        expect(resolveClientListLimit(50)).toBe(50);
        expect(resolveClientListLimit("50")).toBe(50);
        expect(resolveClientListLimit(MAX_LIST_LIMIT)).toBe(MAX_LIST_LIMIT);
    });

    it("never yields an unbounded read: 0, negatives, and non-integers floor to >= 1", () => {
        expect(resolveClientListLimit(0)).toBe(1);
        expect(resolveClientListLimit("0")).toBe(1);
        expect(resolveClientListLimit(-5)).toBe(1);
        expect(resolveClientListLimit(2.9)).toBe(2);
    });

    it("falls back to the default when the limit is non-numeric", () => {
        expect(resolveClientListLimit("abc")).toBe(DEFAULT_LIST_LIMIT);
        expect(resolveClientListLimit(NaN)).toBe(DEFAULT_LIST_LIMIT);
        expect(resolveClientListLimit(Infinity)).toBe(DEFAULT_LIST_LIMIT);
    });

    it("respects caller-supplied bounds", () => {
        expect(resolveClientListLimit(undefined, { defaultLimit: 25 })).toBe(25);
        expect(resolveClientListLimit(9999, { maxLimit: 200 })).toBe(200);
        expect(resolveClientListLimit(undefined, { vectorSearch: true, vectorDefaultLimit: 3 })).toBe(3);
    });
});
