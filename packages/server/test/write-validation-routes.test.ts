import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { Hono } from "hono";
import { CollectionConfig } from "@rebasepro/types";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";

/**
 * The validator is only worth anything if it is actually mounted on the write
 * routes — these drive real requests, so they fail if the wiring is dropped
 * even while the unit tests keep passing.
 */
describe("unknown write fields are rejected by the REST routes", () => {
    const skuItems: CollectionConfig = {
        slug: "sku_items",
        name: "SKU Items",
        table: "sku_items",
        properties: {
            sku: { type: "string",
isId: true },
            label: { type: "string" }
        }
    };

    let mockDriver: Record<string, jest.Mock>;

    const createApp = () => {
        const app = new Hono();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("driver", mockDriver);
            await next();
        });
        const generator = new RestApiGenerator([skuItems], mockDriver as never);
        app.route("/", generator.generateRoutes());
        return app;
    };

    beforeEach(() => {
        mockDriver = {
            save: jest.fn(async () => ({ sku: "ABC-1",
label: "Widget" })),
            saveMany: jest.fn(async () => [{ sku: "ABC-1",
label: "Widget" }]),
            fetchOne: jest.fn(async () => ({ sku: "ABC-1",
label: "Widget" }))
        } as never;
    });

    const post = (path: string, body: unknown) =>
        createApp().fetch(new Request(`http://localhost${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
        }));

    it("400s a create with a typo'd field, and does not write", async () => {
        const res = await post("/sku_items", { labell: "Widget" });

        expect(res.status).toBe(400);
        const body = await res.json() as { error: { message: string; code: string } };
        expect(body.error.code).toBe("VALIDATION_UNKNOWN_FIELDS");
        expect(body.error.message).toContain("'labell'");
        expect(mockDriver.save).not.toHaveBeenCalled();
    });

    it("400s `create(data, id)` against a table with no `id` column", async () => {
        // This is what the SDK sends for `create({...}, "ABC-1")`.
        const res = await post("/sku_items", { id: "ABC-1",
label: "Widget" });

        expect(res.status).toBe(400);
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toContain("keyed on 'sku'");
        expect(mockDriver.save).not.toHaveBeenCalled();
    });

    it("lets a valid create through", async () => {
        const res = await post("/sku_items", { sku: "ABC-1",
label: "Widget" });

        expect(res.status).toBe(201);
        expect(mockDriver.save).toHaveBeenCalled();
    });

    it("400s an update with a typo'd field", async () => {
        const res = await createApp().fetch(new Request("http://localhost/sku_items/ABC-1", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ labell: "Widget" })
        }));

        expect(res.status).toBe(400);
        expect(mockDriver.save).not.toHaveBeenCalled();
    });

    it("deletes by the address in the URL, not one read off the row", async () => {
        // The row it just fetched is columns only, so `existingEntity.id` is
        // undefined for a table not keyed on `id` — the driver was asked to
        // delete a row called "undefined" and 404'd on a row that was right
        // there. Every mocked test missed it; a live database found it at once.
        const del = jest.fn(async () => undefined);
        mockDriver.delete = del as never;

        const res = await createApp().fetch(new Request("http://localhost/sku_items/ABC-1", {
            method: "DELETE"
        }));

        expect(res.status).toBe(204);
        expect(del).toHaveBeenCalledWith(expect.objectContaining({
            row: expect.objectContaining({ id: "ABC-1" })
        }));
    });

    it("400s a bulk write naming the offending row, before the transaction opens", async () => {
        const res = await post("/sku_items/bulk", {
            rows: [
                { sku: "ABC-1",
label: "Widget" },
                { sku: "ABC-2",
labell: "Gadget" }
            ]
        });

        expect(res.status).toBe(400);
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toMatch(/^Row 1: /);
        // Nothing was written: the good row did not land and get rolled back.
        expect(mockDriver.saveMany).not.toHaveBeenCalled();
    });
});
