import { describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import { parseAggregateSelect, parseGroupBy } from "../src/api/rest/query-parser";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";

/**
 * `GET /data/:slug/aggregate` — count, sum, avg, min, max, optionally grouped.
 *
 * Until now the query API could return rows and a total, and nothing else. Every
 * dashboard question — revenue by status, orders per day — meant either a custom
 * function holding hand-written SQL, or fetching the rows and reducing them in
 * the client, which is wrong at any size that matters and *silently* wrong under
 * a `limit`: the numbers look plausible and describe the first page.
 *
 * The SQL is asserted in `FetchService`'s own tests. What matters here is the
 * boundary: that the parameters are parsed strictly, that a malformed request is
 * a 400 rather than an inventive interpretation, that the filters reach the
 * aggregate — an aggregate over a wider set than the caller asked for is a wrong
 * number, not a slow query — and that a driver which cannot do this says so.
 */

const orders = {
    slug: "orders",
    name: "Orders",
    singularName: "Order",
    table: "orders",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        total: { name: "Total", type: "number" },
        status: { name: "Status", type: "string" }
    }
} as unknown as CollectionConfig;

function createApp(options: { aggregate?: boolean } = {}) {
    const aggregate = jest.fn<any>().mockResolvedValue([{ count: 3, sum_total: 60 }]);

    const driver = {
        fetchCollection: jest.fn<any>().mockResolvedValue([]),
        fetchOne: jest.fn<any>().mockResolvedValue(null),
        save: jest.fn<any>(),
        delete: jest.fn<any>(),
        count: jest.fn<any>().mockResolvedValue(0),
        restFetchService: options.aggregate === false
            ? { fetchCollectionForRest: jest.fn<any>(), fetchOneForRest: jest.fn<any>() }
            : { fetchCollectionForRest: jest.fn<any>(), fetchOneForRest: jest.fn<any>(), aggregate }
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        await next();
    });
    app.route("/", new RestApiGenerator([orders], driver).generateRoutes());
    return { app, aggregate };
}

describe("the aggregate route", () => {
    it("answers a plain count", async () => {
        const { app } = createApp();

        const res = await app.request("/orders/aggregate?select=count()");

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ data: [{ count: 3, sum_total: 60 }] });
    });

    it("passes the parsed aggregates and grouping down", async () => {
        const { app, aggregate } = createApp();

        await app.request("/orders/aggregate?select=count(),sum(total)&groupBy=status");

        expect(aggregate).toHaveBeenCalledWith("orders", expect.objectContaining({
            aggregates: [
                { fn: "count", field: undefined, alias: "count" },
                { fn: "sum", field: "total", alias: "sum_total" }
            ],
            groupBy: ["status"]
        }));
    });

    it("is not mistaken for a row id", async () => {
        // `/:id` would otherwise match first and 404 for a row nobody asked for.
        const { app, aggregate } = createApp();

        const res = await app.request("/orders/aggregate?select=count()");

        expect(res.status).toBe(200);
        expect(aggregate).toHaveBeenCalled();
    });

    it("carries the filter into the aggregate", async () => {
        // The failure this guards is a plausible number, not an error: an
        // aggregate over more rows than the caller asked about.
        const { app, aggregate } = createApp();

        await app.request("/orders/aggregate?select=sum(total)&status=eq.paid");

        expect(aggregate).toHaveBeenCalledWith("orders", expect.objectContaining({
            filter: { status: ["==", "paid"] }
        }));
    });

    it("carries a logical group and a search string too", async () => {
        const { app, aggregate } = createApp();

        await app.request("/orders/aggregate?select=count()&or=(status.eq.paid,status.eq.shipped)&searchString=abc");

        const options = aggregate.mock.calls[0][1] as { logical?: unknown; searchString?: string };
        expect(options.logical).toBeDefined();
        expect(options.searchString).toBe("abc");
    });

    it("refuses a request with no `select`", async () => {
        const { app } = createApp();

        const res = await app.request("/orders/aggregate");

        expect(res.status).toBe(400);
    });

    it("answers 501, not 500 or an empty list, on a driver that cannot aggregate", async () => {
        // An empty result set reads as "nothing matched", which is the wrong
        // thing for a dashboard to believe.
        const { app } = createApp({ aggregate: false });

        const res = await app.request("/orders/aggregate?select=count()");

        expect(res.status).toBe(501);
    });
});

describe("parsing `select`", () => {
    it("reads a function over a column", () => {
        expect(parseAggregateSelect("sum(total)")).toEqual([{ fn: "sum", field: "total", alias: "sum_total" }]);
    });

    it("reads a bare count as counting rows", () => {
        expect(parseAggregateSelect("count()")).toEqual([{ fn: "count", field: undefined, alias: "count" }]);
    });

    it("derives the alias rather than accepting one", () => {
        // A caller-chosen alias could collide with a `groupBy` field and
        // silently overwrite it — a rule nobody would guess.
        expect(parseAggregateSelect("avg(total)")?.[0].alias).toBe("avg_total");
    });

    it("rejects an unknown function", () => {
        expect(() => parseAggregateSelect("median(total)")).toThrow(/Unknown aggregate function/);
    });

    it("rejects a function that is not one at all", () => {
        expect(() => parseAggregateSelect("total")).toThrow(/Expected `fn\(field\)`/);
    });

    it("rejects `sum()` without a field, since there is nothing to sum", () => {
        expect(() => parseAggregateSelect("sum()")).toThrow(/needs a field/);
    });

    it("rejects anything that is not a plain identifier inside the parens", () => {
        // The field reaches a column lookup, but a parser that let this through
        // would be the first half of an injection in some later caller.
        expect(() => parseAggregateSelect("sum(total); DROP TABLE orders)")).toThrow();
        expect(() => parseAggregateSelect("sum(a b)")).toThrow();
    });

    it("is undefined when absent, so the route can require it", () => {
        expect(parseAggregateSelect(undefined)).toBeUndefined();
        expect(parseAggregateSelect("")).toBeUndefined();
    });
});

describe("parsing `groupBy`", () => {
    it("splits a comma-separated list", () => {
        expect(parseGroupBy("status,country")).toEqual(["status", "country"]);
    });

    it("is undefined when absent or empty", () => {
        expect(parseGroupBy(undefined)).toBeUndefined();
        expect(parseGroupBy(" , ")).toBeUndefined();
    });
});
