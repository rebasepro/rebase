/**
 * `percentile` is refused as a 400 by the driver, whichever door asked.
 *
 * The REST parser checked `p` (`isPercentileFraction`); the in-process SDK
 * goes straight to the driver, which checked nothing. So `p: 2` and a
 * percentile of a text column were raw Postgres errors — a 500 — and a `p`
 * with four decimals came back under the key of its three-decimal rounding
 * (`0.1234` and `0.123` are both `p12_3_<field>`), so two percentiles in one
 * select overwrote each other.
 */
import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig, DriverAggregate } from "@rebasepro/types";
import { aggregateAlias } from "@rebasepro/types";
import { ApiError } from "@rebasepro/server";
import { integer, interval, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const songs = pgTable("songs", {
    id: serial("id").primaryKey(),
    title: text("title"),
    fame: integer("fame"),
    price: numeric("price", { precision: 10, scale: 2 }),
    length: interval("length"),
    released: timestamp("released")
});

const songsCollection: CollectionConfig = {
    slug: "songs",
    name: "Songs",
    table: "songs",
    properties: {
        id: { type: "number", isId: true },
        title: { type: "string" },
        fame: { type: "number" },
        price: { type: "number" },
        length: { type: "string" },
        released: { type: "date" }
    }
};

/**
 * A FetchService over drizzle's mock client, which logs each statement and then
 * fails to send it: what matters is whether a statement was built at all.
 */
const setup = () => {
    const queries: string[] = [];
    const db = drizzle.mock({ logger: { logQuery: (query: string) => { queries.push(query); } } });
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([songsCollection]);
    registry.registerTable(songs, "songs");
    return { service: new FetchService(db, registry), queries };
};

const percentile = (field: string, p: number | undefined): DriverAggregate =>
    ({ fn: "percentile", field, ...(p !== undefined ? { p } : {}), alias: aggregateAlias("percentile", field, p) });

async function refusal(aggregate: DriverAggregate): Promise<ApiError> {
    const { service, queries } = setup();
    const error = await service.aggregate("songs", { aggregates: [aggregate] }).then(() => undefined, (e: unknown) => e);
    expect(queries).toEqual([]);
    if (!(error instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(error)}`);
    return error;
}

describe("percentile in the driver", () => {
    it.each([2, -0.1, Number.NaN, 0.1234, undefined])("refuses p = %p as INVALID_AGGREGATE_SELECT", async (p) => {
        const error = await refusal(percentile("fame", p));
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe("INVALID_AGGREGATE_SELECT");
    });

    it.each(["title", "released"])("refuses a percentile of %s, which is not a number", async (field) => {
        const error = await refusal(percentile(field, 0.5));
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe("INVALID_AGGREGATE_SELECT");
        expect(error.message).toContain(field);
    });

    it.each(["fame", "price", "length"])("computes a percentile of %s", async (field) => {
        const { service, queries } = setup();
        // The mock client cannot send it; the statement was built and logged.
        await service.aggregate("songs", { aggregates: [percentile(field, 0.95)] }).catch(() => undefined);
        expect(queries[0]).toMatch(/percentile_cont/);
    });
});
