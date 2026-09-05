import { describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import { serializeLogicalCondition } from "@rebasepro/common";
import type { CollectionConfig, DataDriver, FilterCondition, WhereFilterOp } from "@rebasepro/types";

import { RestApiGenerator } from "../src/api/rest/api-generator";

/**
 * `?or=(...)` and `?and=(...)` reached the driver.
 *
 * They were parsed — `query-parser.ts` turns them into `options.logical`, and
 * the Postgres driver has applied `logical` all along — and then dropped in
 * between: the REST layer built its driver call out of `filter`, `limit`,
 * `offset`, `orderBy` and `searchString`, and never passed the group. So
 * `?or=(name.eq.A,name.eq.B)` ran **unfiltered** and returned every row the
 * caller's policies allowed, and `?and=` of two impossible conditions returned
 * the whole table instead of nothing.
 *
 * The `where` parser's own docblock states the rule this broke: "dropping the
 * filter would run the read unfiltered and return everything RLS happens to
 * allow." A dropped filter widens a result set, which is the direction that
 * does not announce itself.
 *
 * `meta.total` is pinned alongside the rows, because a count that ignores the
 * group describes a different set of rows from the `data` beside it.
 */

const authors: CollectionConfig = {
    name: "Authors",
    slug: "authors",
    table: "authors",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        name: { name: "Name", type: "string" }
    }
} as unknown as CollectionConfig;

function driverRecording(calls: { fetch?: unknown; count?: unknown }): DataDriver {
    return {
        fetchCollection: jest.fn(async (props: unknown) => { calls.fetch = props; return []; }),
        count: jest.fn(async (props: unknown) => { calls.count = props; return 0; }),
        fetchOne: jest.fn(async () => undefined),
        saveEntity: jest.fn(async () => ({})),
        deleteEntity: jest.fn(async () => undefined),
        checkUniqueField: jest.fn(async () => true)
    } as unknown as DataDriver;
}

async function listWith(query: string): Promise<{ fetch?: unknown; count?: unknown }> {
    const calls: { fetch?: unknown; count?: unknown } = {};
    const driver = driverRecording(calls);

    const app = new Hono();
    // The routes read the request-scoped driver, never the constructor's.
    app.use("/*", async (c, next) => { c.set("driver", driver); await next(); });
    app.route("/", new RestApiGenerator([authors], driver).generateRoutes());

    const res = await app.request(`/authors${query}`);
    expect(res.status).toBe(200);
    return calls;
}

const logicalOf = (props: unknown) => (props as { logical?: unknown } | undefined)?.logical;

describe("logical filter groups reach the driver", () => {
    it("passes an `or` group to the listing", async () => {
        const { fetch } = await listWith("?or=(name.eq.Ada,name.eq.Grace)");

        expect(logicalOf(fetch)).toMatchObject({ type: "or" });
    });

    it("passes an `and` group to the listing", async () => {
        const { fetch } = await listWith("?and=(name.eq.Ada,name.eq.Grace)");

        expect(logicalOf(fetch)).toMatchObject({ type: "and" });
    });

    it("counts with the same group it fetched with", async () => {
        // Otherwise `meta.total` reports rows the group excluded — the listing
        // shows two and the pager offers twenty.
        const { fetch, count } = await listWith("?or=(name.eq.Ada,name.eq.Grace)");

        expect(logicalOf(count)).toEqual(logicalOf(fetch));
        expect(logicalOf(count)).toBeDefined();
    });

    it("leaves `logical` unset when no group was asked for", async () => {
        const { fetch, count } = await listWith("?limit=5");

        expect(logicalOf(fetch)).toBeUndefined();
        expect(logicalOf(count)).toBeUndefined();
    });

    it("carries the group alongside an ordinary field filter", async () => {
        // The two dialects compose; the group must not replace `filter`.
        const { fetch } = await listWith("?name=eq.Ada&or=(name.eq.Ada,name.eq.Grace)");

        expect((fetch as { filter?: unknown }).filter).toBeDefined();
        expect(logicalOf(fetch)).toMatchObject({ type: "or" });
    });
});

/**
 * The server parses exactly what the SDK emits.
 *
 * `serializeLogicalCondition` (in `@rebasepro/common`, used by
 * `packages/client/src/transport.ts`) and `parseLogicalGroup` here are the two
 * halves of one wire format, and only this test holds them against each other.
 * The leaf encoder used to have two copies; the copy the SDK used wrote
 * `deleted_at.eq.null`, `id.in.()` and — for any operator spelled the way the
 * wire spells it — `eq`, all of which this parser accepted and turned into a
 * query that ran and answered something else.
 */
describe("the SDK's wire form parses back to the conditions it was built from", () => {
    const wireFor = (conditions: FilterCondition[], type: "or" | "and" = "or") =>
        `?${type}=${encodeURIComponent(`(${conditions.map(serializeLogicalCondition).join(",")})`)}`;

    it("round-trips a null test, a relation path, a REST-spelled operator and an empty list", async () => {
        const conditions = [
            { column: "deleted_at", operator: "==" as WhereFilterOp, value: null },
            { column: "author.name", operator: "==" as WhereFilterOp, value: "bob" },
            { column: "age", operator: "gte" as WhereFilterOp, value: 18 },
            { column: "id", operator: "in" as WhereFilterOp, value: [] }
        ];

        const { fetch } = await listWith(wireFor(conditions));

        expect(logicalOf(fetch)).toEqual({
            type: "or",
            conditions: [
                { column: "deleted_at", operator: "is-null", value: null },
                { column: "author.name", operator: "==", value: "bob" },
                { column: "age", operator: ">=", value: "18" },
                { column: "id", operator: "in", value: [] }
            ]
        });
    });

    it("keeps a comma inside a scalar out of the group split", async () => {
        const { fetch } = await listWith(wireFor([
            { column: "name", operator: "==" as WhereFilterOp, value: "Doe, John" }
        ]));

        expect(logicalOf(fetch)).toEqual({
            type: "or",
            conditions: [{ column: "name", operator: "==", value: "Doe, John" }]
        });
    });
});
