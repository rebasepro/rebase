/**
 * Properties of the shared list-limit clamp.
 *
 * `resolveClientListLimit` exists so the REST parser and the WebSocket ingress
 * enforce **one** guarantee rather than two similar ones — its own comment says
 * so. That makes the guarantee itself worth writing down, because "one shared
 * function" only helps if the function's postcondition is what both callers
 * assume it is.
 *
 * What both callers assume: whatever comes back is bounded. Without that, a
 * bare `GET /<collection>` buffers the entire table into a JSON response, which
 * is the OOM the clamp was introduced to prevent.
 */

import fc from "fast-check";
import {
    resolveClientListLimit,
    DEFAULT_LIST_LIMIT,
    DEFAULT_VECTOR_LIST_LIMIT,
    MAX_LIST_LIMIT
} from "@rebasepro/types";

const RUNS = Number(process.env.FC_RUNS ?? 5000);

/** Everything a query string can actually deliver for `?limit=`. */
const rawLimit = fc.oneof(
    fc.integer({ min: -1000, max: 100000 }),
    fc.double({ min: -1000, max: 100000, noNaN: false }),
    fc.stringMatching(/^-?[0-9]{0,7}$/),
    fc.constantFrom("", "   ", "abc", "1e9", "0x10", "Infinity", "-Infinity", "NaN", "10abc", "1.9"),
    fc.constant(null),
    fc.constant(undefined)
);

describe("resolveClientListLimit", () => {

    it("always returns a positive integer", () => {
        fc.assert(fc.property(rawLimit, raw => {
            const limit = resolveClientListLimit(raw as never);
            expect(Number.isInteger(limit)).toBe(true);
            expect(limit).toBeGreaterThan(0);
        }), { numRuns: RUNS });
    });

    /**
     * The DoS guard, stated as a postcondition. Any client-supplied value, in
     * any spelling a query string can produce, is bounded by the cap.
     */
    it("never exceeds the cap for any client-supplied value", () => {
        fc.assert(fc.property(rawLimit, raw => {
            expect(resolveClientListLimit(raw as never)).toBeLessThanOrEqual(MAX_LIST_LIMIT);
        }), { numRuns: RUNS });
    });

    it("never returns more than the client asked for", () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: 100000 }), asked => {
            expect(resolveClientListLimit(asked)).toBeLessThanOrEqual(asked);
        }), { numRuns: RUNS });
    });

    /** Monotone: asking for more never yields less. */
    it("is monotone in the requested limit", () => {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 100000 }),
            fc.integer({ min: 1, max: 100000 }),
            (a, b) => {
                const [lo, hi] = a <= b ? [a, b] : [b, a];
                expect(resolveClientListLimit(lo)).toBeLessThanOrEqual(resolveClientListLimit(hi));
            }
        ), { numRuns: RUNS });
    });

    it("agrees between the numeric and string spellings of the same value", () => {
        fc.assert(fc.property(fc.integer({ min: -100, max: 100000 }), n => {
            expect(resolveClientListLimit(String(n))).toBe(resolveClientListLimit(n));
        }), { numRuns: RUNS });
    });

    it("falls back to the mode default when nothing usable was sent", () => {
        for (const raw of [null, undefined, "", "   ", "abc", "NaN"]) {
            expect(resolveClientListLimit(raw as never)).toBe(DEFAULT_LIST_LIMIT);
            expect(resolveClientListLimit(raw as never, { vectorSearch: true }))
                .toBe(DEFAULT_VECTOR_LIST_LIMIT);
        }
    });
});

describe("resolveClientListLimit — configured bounds", () => {

    const bounds = fc.record({
        defaultLimit: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
        maxLimit: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined }),
        vectorDefaultLimit: fc.option(fc.integer({ min: 1, max: 100000 }), { nil: undefined })
    }, { requiredKeys: [] });

    /**
     * With a configured cap, a *client-supplied* limit respects it. This half
     * holds.
     */
    it("respects a configured cap for any client-supplied value", () => {
        fc.assert(fc.property(bounds, rawLimit, (opts, raw) => {
            if (opts.maxLimit === undefined) return;
            if (raw === null || raw === undefined || String(raw).trim() === "") return;
            const parsed = typeof raw === "number" ? raw : parseInt(String(raw), 10);
            if (!Number.isFinite(parsed)) return; // falls through to the default
            expect(resolveClientListLimit(raw as never, opts)).toBeLessThanOrEqual(opts.maxLimit);
        }), { numRuns: RUNS });
    });

    /**
     * **KNOWN: the fallback default is not bounded by the cap.**
     *
     * `maxLimit` is applied only on the branch that parses a client value. When
     * no usable `?limit` arrives, the configured `defaultLimit` is returned
     * verbatim — so a deployment configured with `defaultLimit` above `maxLimit`
     * answers a bare `GET /<collection>` with *more* rows than its own cap
     * allows, and does so precisely for the request that carries no limit at
     * all, which is the one the cap exists for.
     *
     * The same applies to `vectorDefaultLimit`.
     *
     * Only reachable by misconfiguration — the shipped defaults are 50 and 1000,
     * the right way round — and nothing in the config layer rejects the
     * inversion, so the misconfiguration is silent. Pinned rather than fixed
     * because clamping the default changes the meaning of an existing config
     * key, and because the better fix is arguably to reject the inverted config
     * at boot, where it can say so. Either way it is a decision, not a
     * correction.
     */
    it("KNOWN: a configured default above the cap is returned unclamped", () => {
        const opts = { defaultLimit: 5000, maxLimit: 100 };
        expect(resolveClientListLimit(undefined, opts)).toBe(5000);
        expect(resolveClientListLimit(5000, opts)).toBe(100); // the client path clamps
        expect(resolveClientListLimit(undefined, { vectorDefaultLimit: 5000, maxLimit: 100, vectorSearch: true }))
            .toBe(5000);
    });

    /**
     * The property that *would* hold if the above were fixed, restricted to the
     * configurations where the two bounds are the right way round. Stated so
     * the guarantee is on record for every sane config, rather than being lost
     * because one insane one breaks it.
     */
    it("bounds every result by the cap whenever the config is not inverted", () => {
        fc.assert(fc.property(bounds, rawLimit, (opts, raw) => {
            const max = opts.maxLimit ?? MAX_LIST_LIMIT;
            const def = opts.defaultLimit ?? DEFAULT_LIST_LIMIT;
            const vecDef = opts.vectorDefaultLimit ?? DEFAULT_VECTOR_LIST_LIMIT;
            if (def > max || vecDef > max) return; // the inverted config, pinned above
            expect(resolveClientListLimit(raw as never, opts)).toBeLessThanOrEqual(max);
            expect(resolveClientListLimit(raw as never, { ...opts, vectorSearch: true }))
                .toBeLessThanOrEqual(max);
        }), { numRuns: RUNS });
    });

    /** The shipped constants are the right way round, which is what makes the default safe. */
    it("ships bounds that are not inverted", () => {
        expect(DEFAULT_LIST_LIMIT).toBeLessThanOrEqual(MAX_LIST_LIMIT);
        expect(DEFAULT_VECTOR_LIST_LIMIT).toBeLessThanOrEqual(MAX_LIST_LIMIT);
    });
});
