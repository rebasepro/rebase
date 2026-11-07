/**
 * E2E: an aggregate does not read past an `afterRead` mask, over HTTP or in
 * process.
 *
 * An aggregate reads stored columns and never runs `afterRead`, so on a
 * collection a callback masks, `max(email)` or `groupBy=email` handed back
 * the very values the mask withholds. Such a collection now serves only a
 * plain `count()`; the collection beside it, with no callback, aggregates as
 * it always did.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import { buildSdkData } from "@rebasepro/common";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { RestApiGenerator } from "../../../server/src/api/rest/api-generator.js";
import { errorHandler } from "../../../server/src/api/errors.js";
import type { HonoEnv } from "../../../server/src/api/types.js";

const customersTable = pgTable("customers", {
    id: serial("id").primaryKey(),
    email: varchar("email"),
    salary: integer("salary")
});
const ordersTable = pgTable("orders", {
    id: serial("id").primaryKey(),
    status: varchar("status"),
    total: integer("total")
});

const customers = {
    name: "Customers", slug: "customers", table: "customers",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        email: { name: "Email", type: "string" },
        salary: { name: "Salary", type: "number" }
    },
    callbacks: {
        afterRead: ({ row }: { row: Record<string, unknown> }) => ({ ...row, email: "***", salary: null })
    }
} as unknown as CollectionConfig;

const orders = {
    name: "Orders", slug: "orders", table: "orders",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        status: { name: "Status", type: "string" },
        total: { name: "Total", type: "number" }
    }
} as unknown as CollectionConfig;

const ADMIN = { uid: "admin-1", roles: ["admin"] };

describe("aggregates on a collection afterRead masks (E2E)", () => {
    let container: PgContainer;
    let observer: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;
    const app = new Hono<HonoEnv>();

    async function get(path: string): Promise<{ status: number; body: { data?: unknown; error?: { code?: string; message?: string } } }> {
        const response = await app.request(`/api/data/${path}`);
        return { status: response.status, body: await response.json() as never };
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
        await observer.query(`
            CREATE TABLE public.customers (id serial PRIMARY KEY, email varchar, salary integer);
            INSERT INTO public.customers (email, salary) VALUES ('ada@example.com', 9000), ('bob@example.com', 4000);
            CREATE TABLE public.orders (id serial PRIMARY KEY, status varchar, total integer);
            INSERT INTO public.orders (status, total) VALUES ('paid', 10), ('paid', 5), ('open', 1);
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([customers, orders]);
        registry.registerTable(customersTable, "customers");
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
        app.route("/api/data", new RestApiGenerator([customers, orders], driver).generateRoutes());
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await observer?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    it("REST refuses sum, max and groupBy on the masked collection", async () => {
        for (const query of ["select=sum(salary)", "select=max(email)", "select=count()&groupBy=email"]) {
            const { status, body } = await get(`customers/aggregate?${query}`);
            expect({ query, status, code: body.error?.code }).toEqual({ query, status: 400, code: "AGGREGATE_MASKED_BY_AFTER_READ" });
            expect(body.error?.message).toContain("Aggregates other than count are refused on a collection whose rows an afterRead callback rewrites");
            expect(JSON.stringify(body)).not.toContain("ada@example.com");
        }
    });

    it("REST still serves count() there", async () => {
        const { status, body } = await get("customers/aggregate?select=count()");
        expect(status).toBe(200);
        expect(body.data).toEqual([{ count: 2 }]);
    });

    it("REST aggregates a collection without afterRead as before", async () => {
        const { status, body } = await get("orders/aggregate?select=sum(total)&groupBy=status&orderBy=status:asc");
        expect(status).toBe(200);
        expect(body.data).toEqual([{ status: "open", sum_total: 1 }, { status: "paid", sum_total: 15 }]);
    });

    it("the in-process SDK refuses too, and counts", async () => {
        const data = buildSdkData(driver as unknown as DataDriver);
        await expect(data.collection("customers").aggregate({ select: [{ fn: "max", field: "email" }] }))
            .rejects.toMatchObject({ code: "AGGREGATE_MASKED_BY_AFTER_READ" });
        await expect(data.collection("customers").aggregate({ select: [{ fn: "count" }] }))
            .resolves.toEqual([{ count: 2 }]);
    });
});
