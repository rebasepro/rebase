/**
 * E2E: a grouped aggregate sorts its groups by an alias or a group column — the
 * same groups, in the same order, over HTTP and in process.
 *
 * `GET /:collection/aggregate?orderBy=` has sorted the groups since grouped
 * aggregates landed. The in-process accessor (`rebase.data.<c>.aggregate`)
 * dropped `orderBy` and answered in group-key order, the HTTP client never put
 * it on the wire, and the SDK type had no `orderBy` to ask with. The HTTP half
 * here is the client's own query string, sent to the route the server mounts;
 * the in-process half is the accessor on the same driver.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import type { AggregateParams, AggregateRow, CollectionConfig, DataDriver, SDKCollectionClient } from "@rebasepro/types";
import { buildSdkData } from "@rebasepro/common";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { RestApiGenerator } from "../../../server/src/api/rest/api-generator.js";
import { errorHandler } from "../../../server/src/api/errors.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import { buildAggregateQueryString } from "../../../client/src/transport.js";

const ordersTable = pgTable("orders", {
    id: serial("id").primaryKey(),
    status: varchar("status"),
    total: integer("total")
});

const orders = {
    name: "Orders", slug: "orders", table: "orders",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        status: { name: "Status", type: "string" },
        total: { name: "Total", type: "number" }
    }
} as unknown as CollectionConfig;

type Order = { id: number; status: string; total: number };

const ADMIN = { uid: "admin-1", roles: ["admin"] };

describe("aggregate orderBy, over HTTP and in process (E2E)", () => {
    let container: PgContainer;
    let observer: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;
    const app = new Hono<HonoEnv>();

    /** The HTTP door, with the query string the SDK client builds. */
    async function overHttp(params: AggregateParams<Order>): Promise<{ status: number; rows: AggregateRow[]; body: unknown }> {
        const response = await app.request(`/api/data/orders/aggregate${buildAggregateQueryString(params)}`);
        const body = await response.json() as { data?: AggregateRow[] };
        return { status: response.status, rows: body.data ?? [], body };
    }

    /** The in-process door: `rebase.data.orders.aggregate`. */
    function inProcess(): SDKCollectionClient<Order> {
        return buildSdkData(driver as unknown as DataDriver).orders as unknown as SDKCollectionClient<Order>;
    }

    beforeAll(async () => {
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                observer = new pg.Client({ connectionString: container.connectionString });
                await observer.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        // Group keys in alphabetical order are a, b, c; their totals rank them
        // c, a, b — so a sort that is dropped cannot pass for one that ran.
        await observer.query(`
            CREATE TABLE public.orders (id serial PRIMARY KEY, status varchar, total integer);
            INSERT INTO public.orders (status, total) VALUES
                ('a', 50), ('a', 10),
                ('b', 5),
                ('c', 100), ('c', 1), ('c', 1);
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([orders]);
        registry.registerTable(ordersTable, "orders");
        const realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);

        app.onError(errorHandler);
        app.use("/api/data/*", async (c, next) => {
            c.set("user", ADMIN as never);
            c.set("driver", await driver.withAuth(ADMIN as never));
            await next();
        });
        app.route("/api/data", new RestApiGenerator([orders], driver).generateRoutes());
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await observer?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    const statuses = (rows: AggregateRow[]) => rows.map(row => row.status);

    it("sorts the groups by an aggregate's alias, the same on both doors", async () => {
        const params: AggregateParams<Order> = {
            select: [{ fn: "sum", field: "total" }],
            groupBy: ["status"],
            orderBy: ["sum_total", "desc"]
        };
        const http = await overHttp(params);
        expect(http.status).toBe(200);
        expect(statuses(http.rows)).toEqual(["c", "a", "b"]);
        const local = await inProcess().aggregate(params);
        expect(statuses(local)).toEqual(["c", "a", "b"]);
        expect([...local]).toEqual(http.rows);
    });

    it("sorts them by `count`, and by a group column", async () => {
        const byCount: AggregateParams<Order> = { select: [{ fn: "count" }], groupBy: ["status"], orderBy: ["count", "asc"] };
        expect(statuses((await overHttp(byCount)).rows)).toEqual(["b", "a", "c"]);
        expect(statuses(await inProcess().aggregate(byCount))).toEqual(["b", "a", "c"]);

        const byGroup: AggregateParams<Order> = { select: [{ fn: "count" }], groupBy: ["status"], orderBy: ["status", "desc"] };
        expect(statuses((await overHttp(byGroup)).rows)).toEqual(["c", "b", "a"]);
        expect(statuses(await inProcess().aggregate(byGroup))).toEqual(["c", "b", "a"]);
    });

    it("pages the sorted groups", async () => {
        const params: AggregateParams<Order> = {
            select: [{ fn: "sum", field: "total" }],
            groupBy: ["status"],
            orderBy: ["sum_total", "desc"],
            limit: 1,
            offset: 1
        };
        expect(statuses((await overHttp(params)).rows)).toEqual(["a"]);
        expect(statuses(await inProcess().aggregate(params))).toEqual(["a"]);
    });
});
