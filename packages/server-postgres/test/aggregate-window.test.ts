/**
 * A grouped aggregate, paged: `offset`, `orderBy`, and an order that is total.
 *
 * A grouped aggregate is bounded by `limit`, so more groups than one page holds
 * have to be paged — and the window was never applied: `offset` and `orderBy`
 * were dropped before reaching the statement, which had no ORDER BY at all. So
 * the first page was whichever fifty groups Postgres produced first, and every
 * later page was that same page again.
 *
 * Asserted on the compiled SQL, because a dropped clause produces a perfectly
 * well-formed query that answers the wrong question.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { CollectionConfig } from "@rebasepro/types";
import { ApiError } from "@rebasepro/server";
import { numeric, pgTable, serial, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const orders = pgTable("orders", {
    id: serial("id").primaryKey(),
    status: text("status"),
    customer: text("customer"),
    total: numeric("total")
});

const ordersCollection: CollectionConfig = {
    slug: "orders",
    name: "Orders",
    table: "orders",
    properties: {
        id: { type: "number", isId: true },
        status: { type: "string" },
        customer: { type: "string" },
        total: { type: "number" }
    }
};

/** A FetchService over a proxy driver that records the SQL it is handed. */
const setup = () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    const db = drizzle(async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [] };
    });

    const registry = new PostgresCollectionRegistry();
    jest.spyOn(registry, "getCollectionByPath").mockImplementation(path =>
        path === "orders" ? ordersCollection : undefined
    );
    jest.spyOn(registry, "getTable").mockImplementation(name =>
        name === "orders" ? (orders as never) : undefined
    );

    return { service: new FetchService(db as never, registry), queries };
};

const count = { fn: "count" as const, alias: "count" };
const sumTotal = { fn: "sum" as const, field: "total", alias: "sum_total" };

describe("a grouped aggregate", () => {
    it("is ordered by its group keys, so a page boundary falls in the same place every time", async () => {
        const { service, queries } = setup();

        await service.aggregate("orders", { aggregates: [count], groupBy: ["customer", "status"], limit: 50 });

        expect(queries[0].sql).toMatch(/order by "orders"\."customer" ASC NULLS LAST, "orders"\."status" ASC NULLS LAST limit \$\d+$/);
    });

    it("skips the groups before `offset`", async () => {
        const { service, queries } = setup();

        await service.aggregate("orders", { aggregates: [count], groupBy: ["customer"], limit: 50, offset: 100 });

        expect(queries[0].sql).toMatch(/limit \$\d+ offset \$\d+$/);
        expect(queries[0].params.slice(-2)).toEqual([50, 100]);
    });

    it("sorts by an aggregate, with the group keys breaking its ties", async () => {
        const { service, queries } = setup();

        await service.aggregate("orders", {
            aggregates: [count, sumTotal],
            groupBy: ["customer"],
            orderBy: [["sum_total", "desc", "last"]],
            limit: 10
        });

        expect(queries[0].sql).toMatch(/order by sum\(("orders"\.)?"total"\)::numeric DESC NULLS LAST, "orders"\."customer" ASC NULLS LAST limit/);
    });

    it("sorts by a group key without naming it twice", async () => {
        const { service, queries } = setup();

        await service.aggregate("orders", {
            aggregates: [count],
            groupBy: ["customer", "status"],
            orderBy: [["status", "desc"]],
            limit: 10
        });

        expect(queries[0].sql).toMatch(/order by "orders"\."status" DESC NULLS FIRST, "orders"\."customer" ASC NULLS LAST limit/);
    });

    it("refuses a sort on a column that is neither grouped nor aggregated", async () => {
        // Postgres would refuse it too — as a 500 about `GROUP BY`, from a
        // column the caller named in a query parameter.
        const { service, queries } = setup();

        const refused = await service.aggregate("orders", {
            aggregates: [count],
            groupBy: ["customer"],
            orderBy: [["total", "asc"]]
        }).catch((e: unknown) => e);

        expect(refused).toBeInstanceOf(ApiError);
        expect((refused as ApiError).statusCode).toBe(400);
        expect((refused as ApiError).code).toBe("INVALID_ORDER_BY");
        expect((refused as ApiError).message).toContain("'customer', 'count'");
        expect(queries).toHaveLength(0);
    });
});
