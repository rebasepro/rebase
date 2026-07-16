import { Hono } from "hono";
import { RestApiGenerator, DEFAULT_MAX_BULK_ROWS } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import { DataDriver } from "../../types/src/controllers/data_driver";
import { CollectionConfig } from "../../types/src/types/collections";

function buildApp(driverOverrides: Partial<DataDriver> = {}, maxBulkRows?: number) {
    const driver = {
        key: "postgres",
        initialised: true,
        fetchCollection: jest.fn(),
        fetchOne: jest.fn(),
        save: jest.fn(),
        saveMany: jest.fn(async ({ rows }: { rows: Record<string, unknown>[] }) => rows),
        delete: jest.fn(),
        checkUniqueField: jest.fn(),
        count: jest.fn(),
        withAuth: jest.fn(),
        admin: {} as any,
        ...driverOverrides
    } as unknown as jest.Mocked<DataDriver>;

    const collections = [
        { slug: "products", name: "Products", singularName: "Product", properties: {} } as unknown as CollectionConfig
    ];

    const app = new Hono();
    app.onError(errorHandler as never);
    // The routes read the request-scoped driver off the context, the way the
    // real auth middleware supplies it.
    app.use("*", async (c, next) => {
        c.set("driver" as never, driver as never);
        await next();
    });
    app.route("/", new RestApiGenerator(collections, driver, undefined, maxBulkRows).generateRoutes());
    return { app, driver };
}

const post = (app: Hono, body: unknown) =>
    app.request("/products/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

describe("POST /<collection>/bulk", () => {
    it("writes the rows and reports how many landed", async () => {
        const { app, driver } = buildApp();
        const rows = [{ id: "a", title: "A" }, { id: "b", title: "B" }];

        const res = await post(app, { rows });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ data: rows, meta: { written: 2 } });
        expect(driver.saveMany).toHaveBeenCalledWith(
            expect.objectContaining({ path: "products", rows, upsert: false })
        );
    });

    it("passes upsert through when asked", async () => {
        const { app, driver } = buildApp();

        await post(app, { rows: [{ id: "a" }], upsert: true });

        expect(driver.saveMany).toHaveBeenCalledWith(expect.objectContaining({ upsert: true }));
    });

    it("is not mistaken for an entity with the id 'bulk'", async () => {
        // POST /products/bulk must reach the bulk route, not create a row.
        const { app, driver } = buildApp();

        await post(app, { rows: [{ id: "a" }] });

        expect(driver.saveMany).toHaveBeenCalled();
        expect(driver.save).not.toHaveBeenCalled();
    });

    it("accepts an empty batch without troubling the driver", async () => {
        const { app, driver } = buildApp();

        const res = await post(app, { rows: [] });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ data: [], meta: { written: 0 } });
        expect(driver.saveMany).not.toHaveBeenCalled();
    });

    it("rejects a body without a rows array", async () => {
        const { app } = buildApp();

        const res = await post(app, { data: [{ id: "a" }] });

        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe("INVALID_BULK_BODY");
    });

    it("rejects rows that are not objects", async () => {
        const { app } = buildApp();

        const res = await post(app, { rows: [{ id: "a" }, "nope"] });

        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe("INVALID_BULK_BODY");
    });

    it("refuses a batch beyond the row cap, and says what the cap is", async () => {
        const { app, driver } = buildApp({}, 2);

        const res = await post(app, { rows: [{ id: "a" }, { id: "b" }, { id: "c" }] });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe("BULK_TOO_LARGE");
        // The caller has to chunk, so both numbers have to be in the message.
        expect(body.error.message).toContain("3");
        expect(body.error.message).toContain("2");
        expect(driver.saveMany).not.toHaveBeenCalled();
    });

    it("defaults the cap to DEFAULT_MAX_BULK_ROWS", async () => {
        const { app, driver } = buildApp();
        const rows = Array.from({ length: DEFAULT_MAX_BULK_ROWS + 1 }, (_, i) => ({ id: String(i) }));

        const res = await post(app, { rows });

        expect(res.status).toBe(400);
        expect(driver.saveMany).not.toHaveBeenCalled();
    });

    it("reports a driver that cannot do bulk writes instead of failing obscurely", async () => {
        const { app } = buildApp({ saveMany: undefined });

        const res = await post(app, { rows: [{ id: "a" }] });

        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe("BULK_UNSUPPORTED");
    });

    it("surfaces the driver's status rather than flattening it to a 500", async () => {
        const { app } = buildApp({
            saveMany: jest.fn(async () => {
                throw Object.assign(new Error("Row 3 of 9 (id \"x\") failed: denied"), {
                    name: "ApiError",
                    statusCode: 403,
                    code: "WRITE_DENIED"
                });
            }) as never
        });

        const res = await post(app, { rows: [{ id: "a" }] });

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error.code).toBe("WRITE_DENIED");
        expect(body.error.message).toContain("Row 3 of 9");
    });
});
