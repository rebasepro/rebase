import { describe, it, expect, beforeAll } from "@jest/globals";
import { Hono, Context } from "hono";
import type { DataDriver } from "@rebasepro/types";
import { configureJwt } from "../src/auth/jwt";
import { createAuthMiddleware } from "../src/auth/middleware";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { DEFAULT_DRIVER_ID, DefaultDriverRegistry } from "../src/services/driver-registry";
import {
    createRequestDriverResolver,
    DATABASE_NOT_CONFIGURED,
    driverForDatabaseKey
} from "../src/services/request-driver";
import { fakeDataDriver } from "./helpers/server-b-fakes";

/**
 * A table whose `database` names a database this process never opened is
 * answered 503, naming the key — not served by the default driver, which put
 * its rows in the wrong database while every read of it came back empty.
 */
describe("the request driver for a table's database", () => {
    const main = fakeDataDriver({ key: "main" });
    const analytics = fakeDataDriver({ key: "analytics" });
    const registry = DefaultDriverRegistry.create({ [DEFAULT_DRIVER_ID]: main, analytics });

    // The table → database map the backend reads off its table registry.
    const databaseOf: Record<string, string | undefined> = {
        products: undefined,
        orders: DEFAULT_DRIVER_ID,
        events: "analytics",
        reports: "warehouse"
    };
    const keyForCollectionPath = (path: string): string | undefined =>
        databaseOf[path.replace(/^\/+/, "").split("/")[0]];

    beforeAll(() => {
        configureJwt({ secret: "test-secret-key-for-request-driver-routing-12345678", accessExpiresIn: "1h" });
    });

    describe("driverForDatabaseKey", () => {
        it("gives the default driver for no key, an empty key and (default)", () => {
            expect(driverForDatabaseKey(registry, main, undefined)).toBe(main);
            expect(driverForDatabaseKey(registry, main, null)).toBe(main);
            expect(driverForDatabaseKey(registry, main, "")).toBe(main);
            expect(driverForDatabaseKey(registry, main, DEFAULT_DRIVER_ID)).toBe(main);
        });

        it("gives the registered driver for a named database", () => {
            expect(driverForDatabaseKey(registry, main, "analytics")).toBe(analytics);
        });

        it("refuses a database that has no driver with a 503 naming it", () => {
            expect(() => driverForDatabaseKey(registry, main, "warehouse")).toThrow(
                expect.objectContaining({ statusCode: 503, code: DATABASE_NOT_CONFIGURED, details: { database: "warehouse" } })
            );
        });

        it("keeps a single-database backend on its one driver", () => {
            const single = DefaultDriverRegistry.create(main);
            expect(driverForDatabaseKey(single, main, undefined)).toBe(main);
            expect(driverForDatabaseKey(single, main, DEFAULT_DRIVER_ID)).toBe(main);
        });
    });

    describe("through the auth middleware", () => {
        function createApp(): Hono<HonoEnv> {
            const app = new Hono<HonoEnv>();
            app.onError(errorHandler);
            app.use("/data/*", async (c, next) => {
                c.set("mountPath", "/data");
                await next();
            });
            app.use("/data/*", createAuthMiddleware({
                driver: main,
                resolveDriver: createRequestDriverResolver({ registry, defaultDriver: main, keyForCollectionPath }),
                requireAuth: false
            }));
            app.get("/data/:slug", (c: Context<HonoEnv>) => c.json({ key: (c.get("driver") as DataDriver | undefined)?.key }));
            return app;
        }

        it("serves the default database's tables from the default driver", async () => {
            const app = createApp();
            for (const slug of ["products", "orders"]) {
                const res = await app.request(`/data/${slug}`);
                expect(res.status).toBe(200);
                expect(await res.json()).toEqual({ key: "main" });
            }
        });

        it("serves a named database's table from its driver", async () => {
            const res = await createApp().request("/data/events");
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ key: "analytics" });
        });

        it("answers 503 NOT_CONFIGURED, naming the database, for a table on an unregistered database", async () => {
            const res = await createApp().request("/data/reports");
            expect(res.status).toBe(503);
            const body = await res.json() as { error: { code: string; message: string } };
            expect(body.error.code).toBe("NOT_CONFIGURED");
            expect(body.error.message).toContain('"warehouse"');
        });
    });
});
