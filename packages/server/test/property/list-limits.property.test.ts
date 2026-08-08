/**
 * Properties of the shared list-limit resolver.
 *
 * `resolveClientListLimit` exists so the REST parser and the WebSocket ingress
 * enforce **one** guarantee rather than two similar ones — its own comment says
 * so. That makes the guarantee itself worth writing down, because "one shared
 * function" only helps if the function's postcondition is what both callers
 * assume it is.
 *
 * What both callers assume: no request escapes with an unbounded read. The
 * resolver delivers that by *refusing* a limit it cannot honour rather than
 * quietly shrinking it — a smaller page than the caller asked for is
 * indistinguishable, at the call site, from there being no more rows, so
 * clamping answers a question nobody asked. Every property below is therefore
 * two-sided: which inputs come back as a number, and which are refused.
 */

import fc from "fast-check";
import {
    resolveClientListLimit,
    ListLimitError,
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

type Outcome =
    | { ok: true; value: number }
    | { ok: false; refused: true };

/**
 * Run the resolver and describe the outcome instead of letting it throw, so a
 * property can talk about refusal as a result rather than only about returns.
 *
 * A non-`ListLimitError` is deliberately rethrown: "it threw something" is not
 * the contract, "it threw the declared refusal" is.
 */
function attempt(raw: unknown, opts?: Parameters<typeof resolveClientListLimit>[1]): Outcome {
    try {
        return { ok: true, value: resolveClientListLimit(raw as never, opts) };
    } catch (err) {
        if (err instanceof ListLimitError) return { ok: false, refused: true };
        throw err;
    }
}

/** Whether the raw value is one the resolver treats as "nothing was sent". */
function isBlank(raw: unknown): boolean {
    return raw === null || raw === undefined || String(raw).trim() === "";
}

describe("resolveClientListLimit", () => {

    /**
     * Totality. Whatever arrives, the resolver either hands back a usable
     * bound or refuses in the declared way — it never returns `undefined`,
     * `NaN`, a fraction, or something that would read as "no limit".
     */
    it("either returns a positive integer or refuses with ListLimitError", () => {
        fc.assert(fc.property(rawLimit, raw => {
            const outcome = attempt(raw);
            if (!outcome.ok) return;
            expect(Number.isInteger(outcome.value)).toBe(true);
            expect(outcome.value).toBeGreaterThan(0);
        }), { numRuns: RUNS });
    });

    /**
     * The DoS guard, stated as a postcondition. No client-supplied value, in
     * any spelling a query string can produce, yields a bound above the cap.
     */
    it("never returns above the cap for any client-supplied value", () => {
        fc.assert(fc.property(rawLimit, raw => {
            const outcome = attempt(raw);
            if (!outcome.ok) return;
            expect(outcome.value).toBeLessThanOrEqual(MAX_LIST_LIMIT);
        }), { numRuns: RUNS });
    });

    /**
     * No coercion, in either direction: an accepted limit is returned exactly
     * as asked. This is the property that makes the refusal worth having — it
     * is what lets a caller treat a short page as "the end of the collection"
     * rather than "possibly the resolver's opinion".
     *
     * It also subsumes the two properties this file used to state separately
     * ("never more than the client asked for", "monotone in the requested
     * limit"): identity is trivially both.
     */
    it("returns an in-range limit verbatim", () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: MAX_LIST_LIMIT }), asked => {
            expect(attempt(asked)).toEqual({ ok: true, value: asked });
        }), { numRuns: RUNS });
    });

    /**
     * The regression this contract was introduced for. Over the ceiling is a
     * refusal, never a quietly smaller page.
     */
    it("refuses a limit above the cap instead of shrinking it", () => {
        fc.assert(fc.property(fc.integer({ min: MAX_LIST_LIMIT + 1, max: 10_000_000 }), asked => {
            expect(attempt(asked).ok).toBe(false);
        }), { numRuns: RUNS });
    });

    /** Zero, negatives and fractions are refused rather than rounded into range. */
    it("refuses a present limit that is not a whole number ≥ 1", () => {
        fc.assert(fc.property(
            fc.oneof(
                fc.integer({ min: -10_000, max: 0 }),
                fc.double({ min: 0.001, max: 999.999, noNaN: true }).filter(n => !Number.isInteger(n)),
                fc.constantFrom("abc", "NaN", "10abc", "Infinity", "-Infinity", "1.9")
            ),
            raw => {
                expect(attempt(raw).ok).toBe(false);
            }
        ), { numRuns: RUNS });
    });

    /**
     * The resolver parses with `Number`, not `parseInt`, so that `"50rows"` is
     * refused rather than read as 50. The cost of that choice is that every
     * other spelling `Number` understands is accepted too: `"0x10"` is 16 and
     * `"1e2"` is 100.
     *
     * Harmless — both are in range, bounded by the cap, and mean what they say
     * — but pinned so the choice stays deliberate. Anything that tightened this
     * to decimal-only would be a wire change for a caller already sending them.
     */
    it("accepts any spelling `Number` understands, not just decimal", () => {
        expect(attempt("0x10")).toEqual({ ok: true, value: 16 });
        expect(attempt("1e2")).toEqual({ ok: true, value: 100 });
        expect(attempt("  25  ")).toEqual({ ok: true, value: 25 });
        // But not a number with a suffix, which is what `parseInt` would have taken.
        expect(attempt("50rows").ok).toBe(false);
    });

    /**
     * The two spellings a query string can deliver must agree — including
     * agreeing to refuse. A resolver that accepted `50` but refused `"50"`
     * would make the guarantee depend on the ingress that parsed it, which is
     * exactly what sharing this function is meant to rule out.
     */
    it("agrees between the numeric and string spellings of the same value", () => {
        fc.assert(fc.property(fc.integer({ min: -100, max: 100000 }), n => {
            expect(attempt(String(n))).toEqual(attempt(n));
        }), { numRuns: RUNS });
    });

    /**
     * Absent and blank are the only inputs that fall back. Note what is *not*
     * in this list any more: `"abc"` and `"NaN"` are present-but-unusable, and
     * a fallback there would answer a typo with a full default page.
     */
    it("falls back to the mode default when nothing was sent", () => {
        for (const raw of [null, undefined, "", "   "]) {
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
     * holds regardless of how the rest of the config is set.
     */
    it("respects a configured cap for any client-supplied value", () => {
        fc.assert(fc.property(bounds, rawLimit, (opts, raw) => {
            if (opts.maxLimit === undefined) return;
            if (isBlank(raw)) return;
            const outcome = attempt(raw, opts);
            if (!outcome.ok) return;
            expect(outcome.value).toBeLessThanOrEqual(opts.maxLimit);
        }), { numRuns: RUNS });
    });

    /**
     * **KNOWN: the fallback default is not bounded by the cap.**
     *
     * `maxLimit` is applied only on the branch that parses a client value. When
     * no `?limit` arrives, the configured `defaultLimit` is returned verbatim —
     * so a deployment configured with `defaultLimit` above `maxLimit` answers a
     * bare `GET /<collection>` with *more* rows than its own cap allows, and
     * does so precisely for the request that carries no limit at all, which is
     * the one the cap exists for.
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
        // The client path refuses rather than clamping, so the inversion is
        // reachable only through the fallback.
        expect(attempt(5000, opts).ok).toBe(false);
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
            for (const o of [opts, { ...opts, vectorSearch: true }]) {
                const outcome = attempt(raw, o);
                if (!outcome.ok) continue;
                expect(outcome.value).toBeLessThanOrEqual(max);
            }
        }), { numRuns: RUNS });
    });

    /** The shipped constants are the right way round, which is what makes the default safe. */
    it("ships bounds that are not inverted", () => {
        expect(DEFAULT_LIST_LIMIT).toBeLessThanOrEqual(MAX_LIST_LIMIT);
        expect(DEFAULT_VECTOR_LIST_LIMIT).toBeLessThanOrEqual(MAX_LIST_LIMIT);
    });
});
