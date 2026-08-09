/**
 * Properties of the REST wire codec.
 *
 * `filter-dialect.ts` and `sort-dialect.ts` are the only modules that know the
 * PostgREST-style dot syntax; everything else speaks tuples. That makes them a
 * codec, and a codec has an inverse law — but a *lossy* one, deliberately: the
 * wire format carries no type metadata, so `18` comes back as `"18"` and
 * coercion is the driver's job.
 *
 * The law for a lossy codec is idempotence through the wire, not equality:
 *
 *     serialize ∘ deserialize ∘ serialize  =  serialize
 *
 * That is the strongest true statement, and it is what actually matters
 * operationally — a filter must not drift when a request is re-encoded, which
 * is what happens when the SDK builds a query, the server parses it, and a
 * proxy or retry re-serializes it.
 *
 * The escaping algebra underneath is *not* lossy, and gets the stronger law.
 */

import fc from "fast-check";
import {
    ALL_WHERE_FILTER_OPS,
    CANONICAL_TO_REST,
    NULL_OPS,
    REST_TO_CANONICAL,
    WhereFilterOp,
    LogicalCondition,
    FilterCondition
} from "@rebasepro/types";
import {
    serializeFilter,
    deserializeFilter,
    serializeLogicalCondition,
    deserializeLogicalCondition,
    MAX_LOGICAL_NESTING_DEPTH
} from "../../src/data/filter-dialect";
import { serializeOrderBy, deserializeOrderBy } from "../../src/data/sort-dialect";

const RUNS = Number(process.env.FC_RUNS ?? 2000);

/** Field names that the colon- and dot-delimited wire formats can represent. */
const fieldName = fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/);

/** Scalar filter values, including the ones that stress the escaping. */
const scalarValue = fc.oneof(
    fc.stringMatching(/^[a-zA-Z0-9 @._%-]{0,14}$/),
    fc.constantFrom("a,b", "a\\b", "a\\,b", "", "()", "(a)", "eq.x", "1.2.3", "user@host.com"),
    fc.integer({ min: -999, max: 999 }),
    fc.boolean(),
    fc.constant(null)
);

const listValue = fc.array(scalarValue, { minLength: 1, maxLength: 4 });

const whereOp: fc.Arbitrary<WhereFilterOp> = fc.constantFrom(...ALL_WHERE_FILTER_OPS);

/** A `[op, value]` tuple, with list-shaped values for the list operators. */
const filterTuple: fc.Arbitrary<[WhereFilterOp, unknown]> = whereOp.chain(op => {
    if (op === "in" || op === "not-in" || op === "array-contains-any") {
        return listValue.map(v => [op, v] as [WhereFilterOp, unknown]);
    }
    if (NULL_OPS.has(op)) return fc.constant([op, null] as [WhereFilterOp, unknown]);
    return scalarValue.map(v => [op, v] as [WhereFilterOp, unknown]);
});

const filterValues = fc.dictionary(
    fieldName,
    fc.oneof(filterTuple, fc.array(filterTuple, { minLength: 1, maxLength: 3 })),
    { maxKeys: 4 }
);

describe("filter wire codec", () => {

    /**
     * The operator tables must be mutual inverses. They are two hand-maintained
     * objects, and an operator present in one but not the other is the shape of
     * a filter that serializes and then silently comes back as something else —
     * the same hazard as the `WhereFilterOp` union being declared in two places.
     */
    it("maps every canonical operator to a REST code and back", () => {
        for (const op of ALL_WHERE_FILTER_OPS) {
            const rest = (CANONICAL_TO_REST as Record<string, string>)[op];
            expect(rest).toBeDefined();
            expect((REST_TO_CANONICAL as Record<string, string>)[rest]).toBe(op);
        }
    });

    it("has no REST code that maps to an operator outside the union", () => {
        for (const [rest, canonical] of Object.entries(REST_TO_CANONICAL)) {
            expect(ALL_WHERE_FILTER_OPS).toContain(canonical);
            // …and back, so the two tables have the same cardinality in practice.
            expect((CANONICAL_TO_REST as Record<string, string>)[canonical as string]).toBe(rest);
        }
    });

    /**
     * The load-bearing one. A filter that changes shape on a second encode is a
     * filter that means something different after a retry.
     */
    it("serializes idempotently through the wire", () => {
        fc.assert(fc.property(filterValues, filter => {
            const once = serializeFilter(filter as never);
            const twice = serializeFilter(deserializeFilter(once) as never);
            expect(asQuery(twice)).toEqual(asQuery(once));
        }), { numRuns: RUNS });
    });

    /** The dual, entered from the wire — the direction the server takes. */
    it("deserializes idempotently from the wire", () => {
        fc.assert(fc.property(filterValues, filter => {
            const wire = serializeFilter(filter as never);
            const once = deserializeFilter(wire);
            const twice = deserializeFilter(serializeFilter(once as never));
            expect(twice).toEqual(once);
        }), { numRuns: RUNS });
    });

    /**
     * The operator itself is not lossy, unlike the value: whatever coercion the
     * driver later applies, it must be applying the operator the caller asked
     * for. An operator that silently degrades to `==` widens a filter, and a
     * widened filter on a `not-in` is a leak.
     */
    it("preserves the operator exactly, for every operator in the union", () => {
        fc.assert(fc.property(fieldName, filterTuple, (field, tuple) => {
            const back = deserializeFilter(serializeFilter({ [field]: tuple } as never));
            const result = back[field];
            // Presence is part of the property, not a precondition: a round trip
            // that drops the field entirely preserves the operator vacuously.
            if (!result) throw new Error(`round trip dropped the field "${field}"`);
            const op = Array.isArray(result[0]) ? undefined : result[0];

            // One deliberate exception: `== null` and `!= null` are carried as
            // the null-testing operators. `eq.null` was indistinguishable from
            // a search for the string "null", so the value was what regressed
            // instead — `f = 'null'`. SQL `= NULL` is never true, so these are
            // the same query, and the operator is the safe thing to change.
            if (tuple[1] === null && (tuple[0] === "==" || tuple[0] === "!=")) {
                expect(op).toBe(tuple[0] === "==" ? "is-null" : "is-not-null");
                return;
            }
            expect(op).toBe(tuple[0]);
        }), { numRuns: RUNS });
    });

    /**
     * Multiple conditions on one field arrive as repeated query params. Losing
     * one of them turns `18 <= age < 65` into `age >= 18`, which is a wider
     * result set, not an error anybody sees.
     */
    it("keeps every condition when a field carries several", () => {
        fc.assert(fc.property(
            fieldName,
            fc.array(filterTuple, { minLength: 2, maxLength: 4 }),
            (field, tuples) => {
                const back = deserializeFilter(serializeFilter({ [field]: tuples } as never));
                const result = back[field] as [WhereFilterOp, unknown][];
                expect(Array.isArray(result[0])).toBe(true);
                expect(result).toHaveLength(tuples.length);
                // `== null` / `!= null` are carried as the null-testing
                // operators — the same query, said unambiguously. See the
                // operator-preservation property above for why.
                const expected = tuples.map(t =>
                    t[1] === null && (t[0] === "==" || t[0] === "!=")
                        ? (t[0] === "==" ? "is-null" : "is-not-null")
                        : t[0]
                );
                expect(result.map(t => t[0])).toEqual(expected);
            }
        ), { numRuns: RUNS });
    });
});

describe("list-value escaping", () => {

    /**
     * Unlike the codec above, the escaping layer is *not* allowed to be lossy:
     * a comma inside a value and a comma separating two values are different
     * things, and confusing them changes which rows match. This is the
     * strong law — exact equality, not idempotence.
     */
    it("round-trips list items exactly, including commas and backslashes", () => {
        const items = fc.array(
            fc.oneof(
                fc.string({ maxLength: 10 }),
                fc.constantFrom("a,b", "\\", "\\\\", "\\,", ",", "", "a\\,b", "\\\\,")
            ),
            { minLength: 1, maxLength: 5 }
        );
        fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 8 }), items, (field, list) => {
            const wire = serializeFilter({ [field]: ["in", list] } as never);
            const back = deserializeFilter(wire)[field] as [WhereFilterOp, unknown];
            expect(back[0]).toBe("in");
            expect(back[1]).toEqual(list);
        }), { numRuns: RUNS });
    });
});

describe("logical condition codec", () => {

    const leafCondition: fc.Arbitrary<FilterCondition> = fc.record({
        column: fieldName,
        operator: whereOp,
        value: scalarValue
    }) as fc.Arbitrary<FilterCondition>;

    const nestedCondition: fc.Arbitrary<LogicalCondition | FilterCondition> = fc.letrec<{
        c: LogicalCondition | FilterCondition;
    }>(tie => ({
        c: fc.oneof(
            { maxDepth: 3, depthSize: "small" },
            leafCondition,
            fc.record({
                type: fc.constantFrom<"and" | "or">("and", "or"),
                conditions: fc.array(tie("c"), { minLength: 1, maxLength: 3 })
            }) as fc.Arbitrary<LogicalCondition>
        )
    })).c;

    it("serializes nested groups idempotently", () => {
        fc.assert(fc.property(nestedCondition, cond => {
            const once = serializeLogicalCondition(cond);
            const twice = serializeLogicalCondition(deserializeLogicalCondition(once));
            expect(twice).toBe(once);
        }), { numRuns: RUNS });
    });

    it("preserves the group structure of and/or nesting", () => {
        fc.assert(fc.property(nestedCondition, cond => {
            const back = deserializeLogicalCondition(serializeLogicalCondition(cond));
            expect(shape(back)).toEqual(shape(cond));
        }), { numRuns: RUNS });
    });

    /**
     * The nesting guard exists because unbounded recursion on a query-string
     * value produced a 500 about the call stack instead of a 400 about the
     * filter. The property that matters is the *boundary*: exactly at the limit
     * must parse, one past it must throw a real error rather than overflow the
     * stack — and it must throw for every depth beyond, not just the first.
     */
    it("accepts nesting at the limit and refuses it past the limit", () => {
        const nest = (depth: number): string => {
            let s = "a.eq.1";
            for (let i = 0; i < depth; i++) s = `or(${s})`;
            return s;
        };
        expect(() => deserializeLogicalCondition(nest(MAX_LOGICAL_NESTING_DEPTH))).not.toThrow();
        fc.assert(fc.property(
            fc.integer({ min: MAX_LOGICAL_NESTING_DEPTH + 1, max: MAX_LOGICAL_NESTING_DEPTH + 400 }),
            depth => {
                let err: unknown;
                try { deserializeLogicalCondition(nest(depth)); } catch (e) { err = e; }
                expect(err).toBeInstanceOf(Error);
                expect((err as Error).message).toMatch(/nest more than/);
                // A RangeError would mean the guard was outrun by the stack.
                expect(err).not.toBeInstanceOf(RangeError);
            }
        ), { numRuns: 200 });
    });

    it("parses arbitrary strings without throwing anything but the depth error", () => {
        fc.assert(fc.property(fc.stringMatching(/^[a-z0-9_.,()]{0,50}$/), s => {
            try {
                deserializeLogicalCondition(s);
            } catch (e) {
                expect((e as Error).message).toMatch(/nest more than/);
            }
        }), { numRuns: RUNS });
    });
});

describe("orderBy wire codec", () => {

    /**
     * Exact, not idempotent: unlike a filter value, a sort field and direction
     * carry no types to lose. The one documented exception is a field name
     * containing `:`, which the colon-delimited format cannot represent — and
     * it is excluded from the generator rather than papered over, because the
     * limitation is real and stated in `sort-dialect.ts`.
     */
    it("round-trips every representable tuple exactly", () => {
        const tuple = fc.tuple(
            fc.stringMatching(/^[a-zA-Z0-9_.-]{1,16}$/),
            fc.constantFrom<"asc" | "desc">("asc", "desc")
        );
        fc.assert(fc.property(tuple, t => {
            expect(deserializeOrderBy(serializeOrderBy(t as never))).toEqual(t);
        }), { numRuns: RUNS });
    });

    /**
     * Lenient parsing is deliberate, but it must be *stable* leniency: an
     * unknown direction becomes `asc`, and re-encoding must not then change it
     * again. A sort that drifts between requests paginates over shifting rows.
     */
    it("settles after one trip for arbitrary wire input", () => {
        fc.assert(fc.property(fc.string({ maxLength: 24 }), raw => {
            const once = deserializeOrderBy(raw);
            if (!once) return;
            expect(deserializeOrderBy(serializeOrderBy(once))).toEqual(once);
        }), { numRuns: RUNS });
    });
});

/**
 * A serialized filter reduced to what actually goes on the wire.
 *
 * `serializeFilter` returns `string | string[]` per field, and a one-element
 * array is the same HTTP query as the bare string — `?a=lt.x` either way. The
 * codec moves between the two representations across a round trip (a
 * single-element condition array deserializes to a lone tuple), and asserting
 * on the record shape would report that as drift when nothing observable
 * changed.
 *
 * This is a real weakening of the property and worth naming as one: it means
 * these runs cannot catch a bug whose only symptom is the array/scalar
 * distinction. The case that *would* matter — a field carrying several
 * conditions, where dropping to a scalar loses one — is covered separately and
 * strictly by "keeps every condition when a field carries several".
 */
function asQuery(record: Record<string, string | string[]>): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(record)) {
        out[k] = Array.isArray(v) && v.length === 1 ? v[0] : v;
    }
    return out;
}

/** Structural skeleton of a condition tree, ignoring leaf values. */
function shape(c: LogicalCondition | FilterCondition): unknown {
    if ("type" in c) return { type: c.type, conditions: (c.conditions ?? []).map(shape) };
    return { leaf: c.column };
}
