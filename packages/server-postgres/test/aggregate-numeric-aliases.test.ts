/**
 * Which aggregate results come back as numbers, and which are left alone.
 *
 * Postgres returns `bigint` and `numeric` as text, so an aggregate over them
 * arrives as a string and has to be parsed before it reaches a caller. `count`,
 * `sum` and `avg` were parsed from the start. `min` and `max` were not — and
 * they are uncast, so over a `numeric` column they came back as strings:
 *
 *     ?select=avg(price),max(price)  →  { avg_price: 5, max_price: "8.5" }
 *
 * One column, two functions, two JSON types. `max_price * 2` is `"8.58.5"`.
 * Found by reading the response of a freshly scaffolded project rather than by
 * any test, which is why this one exists.
 *
 * The decision is made from the column's declared type, and that is the part
 * worth pinning: `min`/`max` are also the two functions that apply to text and
 * dates, so "parse anything that looks numeric" would turn a `min(sku)` of
 * `"00123"` into `123` — a different value, and one no NaN guard would catch.
 */
import { describe, expect, it } from "@jest/globals";

import { numericAggregateAliases } from "../src/services/FetchService";

const properties = {
    price: { type: "number" },
    quantity: { type: "number" },
    sku: { type: "string" },
    name: { type: "string" },
    createdAt: { type: "date" }
};

/** `select` as the route parses it, for one function over one field. */
const agg = (fn: "count" | "sum" | "avg" | "min" | "max", field?: string) =>
    ({ fn, field, alias: field ? `${fn}_${field}` : fn });

describe("numericAggregateAliases", () => {

    it("always parses count, sum and avg", () => {
        // These are numeric whatever the column is: a count is a count, and
        // `sum`/`avg` are cast through `::numeric` on the way out.
        const aliases = numericAggregateAliases(
            [agg("count"), agg("sum", "price"), agg("avg", "price")],
            properties
        );
        expect([...aliases].sort()).toEqual(["avg_price", "count", "sum_price"]);
    });

    it("parses min and max over a number column — the case that was missing", () => {
        const aliases = numericAggregateAliases(
            [agg("min", "price"), agg("max", "price"), agg("max", "quantity")],
            properties
        );
        expect([...aliases].sort()).toEqual(["max_price", "max_quantity", "min_price"]);
    });

    it("leaves min and max over text alone, so a zero-padded sku survives", () => {
        // `Number("00123")` is 123 and not NaN, so a value-shaped test would
        // silently rewrite it. Only the declared type can tell these apart.
        const aliases = numericAggregateAliases(
            [agg("min", "sku"), agg("max", "name")],
            properties
        );
        expect([...aliases]).toEqual([]);
    });

    it("leaves min and max over a date alone", () => {
        const aliases = numericAggregateAliases([agg("max", "createdAt")], properties);
        expect([...aliases]).toEqual([]);
    });

    it("mixes them correctly in one request", () => {
        // The shape a dashboard actually asks for.
        const aliases = numericAggregateAliases(
            [agg("count"), agg("avg", "price"), agg("max", "price"), agg("max", "createdAt")],
            properties
        );
        expect([...aliases].sort()).toEqual(["avg_price", "count", "max_price"]);
    });

    it("does not parse a field the collection does not declare", () => {
        // An unknown field is refused earlier, but this must not guess `number`
        // for something it cannot see.
        expect([...numericAggregateAliases([agg("max", "nope")], properties)]).toEqual([]);
    });

    it("does not parse min or max when there are no properties at all", () => {
        // A derived or nested path can resolve to a collection this method
        // cannot read. Leaving the value untouched is the conservative answer.
        expect([...numericAggregateAliases([agg("max", "price")], {})]).toEqual([]);
    });
});
