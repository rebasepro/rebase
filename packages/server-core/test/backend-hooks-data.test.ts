/**
 * BackendHooks — Data (REST API) Integration Tests
 *
 * Verifies that DataHooks are correctly applied within RestApiGenerator
 * for all collection CRUD operations.
 */

import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { DataDriver } from "@rebasepro/types";
import type { EntityCollection } from "@rebasepro/types";
import type { DataHooks } from "@rebasepro/types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function createMockDriver(): jest.Mocked<DataDriver> {
    return {
        key: "postgres",
        initialised: true,
        fetchCollection: jest.fn(),
        listenCollection: jest.fn(),
        fetchEntity: jest.fn(),
        listenEntity: jest.fn(),
        saveEntity: jest.fn(),
        deleteEntity: jest.fn(),
        checkUniqueField: jest.fn(),
        countEntities: jest.fn(),
        withAuth: jest.fn(),
        admin: {} as any
    } as unknown as jest.Mocked<DataDriver>;
}

const mockCollections: EntityCollection[] = [
    { slug: "products",
name: "Products",
singularName: "Product",
properties: {} } as any,
    { slug: "orders",
name: "Orders",
singularName: "Order",
properties: {} } as any
];

function createApp(mockDriver: jest.Mocked<DataDriver>, hooks?: DataHooks) {
    const app = new Hono();
    app.onError(errorHandler);
    const generator = new RestApiGenerator(mockCollections, mockDriver, hooks);
    app.route("/api", generator.generateRoutes());
    return app;
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe("DataHooks — REST API", () => {
    let mockDriver: jest.Mocked<DataDriver>;

    beforeEach(() => {
        mockDriver = createMockDriver();
    });

    // ── afterRead ─────────────────────────────────────────────────────
    describe("data.afterRead", () => {
        it("transforms entities in GET list response", async () => {
            const hooks: DataHooks = {
                afterRead(slug, entity) {
                    // Mask price for non-premium entities
                    if (slug === "products") {
                        return { ...entity,
price: "***" };
                    }
                    return entity;
                }
            };
            const app = createApp(mockDriver, hooks);

            mockDriver.fetchCollection.mockResolvedValue([
                { id: "p1",
path: "products",
values: { name: "Widget",
price: 99 } } as any,
                { id: "p2",
path: "products",
values: { name: "Gadget",
price: 199 } } as any
            ]);
            mockDriver.countEntities!.mockResolvedValue(2);

            const res = await app.request("/api/products");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.data).toHaveLength(2);
            expect(body.data[0].price).toBe("***");
            expect(body.data[1].price).toBe("***");
            // Original field should still be there
            expect(body.data[0].name).toBe("Widget");
        });

        it("filters out entities by returning null", async () => {
            const hooks: DataHooks = {
                afterRead(slug, entity) {
                    // Hide draft products
                    if (entity.status === "draft") return null;
                    return entity;
                }
            };
            const app = createApp(mockDriver, hooks);

            mockDriver.fetchCollection.mockResolvedValue([
                { id: "p1",
path: "products",
values: { name: "Published",
status: "active" } } as any,
                { id: "p2",
path: "products",
values: { name: "Draft",
status: "draft" } } as any,
                { id: "p3",
path: "products",
values: { name: "Also Published",
status: "active" } } as any
            ]);
            mockDriver.countEntities!.mockResolvedValue(3);

            const res = await app.request("/api/products");
            const body = await res.json() as any;
            expect(body.data).toHaveLength(2);
            expect(body.data.map((d: any) => d.name)).toEqual(["Published", "Also Published"]);
        });

        it("transforms single entity GET response", async () => {
            const hooks: DataHooks = {
                afterRead(slug, entity) {
                    return { ...entity,
_readAt: "2024-01-01" };
                }
            };
            const app = createApp(mockDriver, hooks);

            mockDriver.fetchEntity.mockResolvedValue(
                { id: "p1",
path: "products",
values: { name: "Widget" } } as any
            );

            const res = await app.request("/api/products/p1");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.name).toBe("Widget");
            expect(body._readAt).toBe("2024-01-01");
        });

        it("returns 404 when afterRead filters a single entity", async () => {
            const hooks: DataHooks = {
                afterRead(slug, entity) {
                    if (entity.id === "hidden") return null;
                    return entity;
                }
            };
            const app = createApp(mockDriver, hooks);

            mockDriver.fetchEntity.mockResolvedValue(
                { id: "hidden",
path: "products",
values: { name: "Secret" } } as any
            );

            const res = await app.request("/api/products/hidden");
            expect(res.status).toBe(404);
        });

        it("only affects targeted collection slug", async () => {
            const hooks: DataHooks = {
                afterRead(slug, entity) {
                    if (slug === "products") {
                        return { ...entity,
hooked: true };
                    }
                    return entity;
                }
            };
            const app = createApp(mockDriver, hooks);

            // Products should be hooked
            mockDriver.fetchEntity.mockResolvedValueOnce(
                { id: "p1",
path: "products",
values: { name: "Widget" } } as any
            );
            const prodRes = await app.request("/api/products/p1");
            const prodBody = await prodRes.json() as any;
            expect(prodBody.hooked).toBe(true);

            // Orders should NOT be hooked
            mockDriver.fetchEntity.mockResolvedValueOnce(
                { id: "o1",
path: "orders",
values: { total: 42 } } as any
            );
            const orderRes = await app.request("/api/orders/o1");
            const orderBody = await orderRes.json() as any;
            expect(orderBody.hooked).toBeUndefined();
        });
    });

    // ── beforeSave ────────────────────────────────────────────────────
    describe("data.beforeSave", () => {
        it("transforms values before POST (create)", async () => {
            const hooks: DataHooks = {
                beforeSave(slug, values, entityId) {
                    return { ...values,
slug: values.name?.toString().toLowerCase().replace(/\s+/g, "-") };
                }
            };
            const app = createApp(mockDriver, hooks);

            mockDriver.saveEntity.mockResolvedValue(
                { id: "new-1",
path: "products",
values: { name: "Cool Widget",
slug: "cool-widget" } } as any
            );

            const res = await app.request("/api/products", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Cool Widget" })
            });

            expect(res.status).toBe(201);
            expect(mockDriver.saveEntity).toHaveBeenCalledWith(
                expect.objectContaining({
                    values: expect.objectContaining({ slug: "cool-widget" })
                })
            );
        });

        it("transforms values before PUT (update)", async () => {
            const hooks: DataHooks = {
                beforeSave(slug, values, entityId) {
                    // Add an updatedBy field
                    return { ...values,
updatedBy: "hook" };
                }
            };
            const app = createApp(mockDriver, hooks);

            mockDriver.fetchEntity.mockResolvedValue({ id: "p1",
path: "products",
values: {} } as any);
            mockDriver.saveEntity.mockResolvedValue(
                { id: "p1",
path: "products",
values: { name: "Updated",
updatedBy: "hook" } } as any
            );

            const res = await app.request("/api/products/p1", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Updated" })
            });

            expect(res.status).toBe(200);
            expect(mockDriver.saveEntity).toHaveBeenCalledWith(
                expect.objectContaining({
                    values: expect.objectContaining({ updatedBy: "hook" })
                })
            );
        });

        it("receives entityId=undefined on POST, actual id on PUT", async () => {
            const beforeSaveSpy = jest.fn((slug, values, entityId) => values);
            const hooks: DataHooks = { beforeSave: beforeSaveSpy };
            const app = createApp(mockDriver, hooks);

            // POST
            mockDriver.saveEntity.mockResolvedValueOnce(
                { id: "new-1",
path: "products",
values: { name: "A" } } as any
            );
            await app.request("/api/products", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "A" })
            });
            expect(beforeSaveSpy.mock.calls[0][2]).toBeUndefined(); // entityId

            // PUT
            mockDriver.fetchEntity.mockResolvedValueOnce({ id: "p1",
path: "products",
values: {} } as any);
            mockDriver.saveEntity.mockResolvedValueOnce(
                { id: "p1",
path: "products",
values: { name: "B" } } as any
            );
            await app.request("/api/products/p1", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "B" })
            });
            expect(beforeSaveSpy.mock.calls[1][2]).toBe("p1"); // entityId
        });

        it("aborts save when beforeSave throws", async () => {
            const hooks: DataHooks = {
                beforeSave(slug, values) {
                    if (!values.name) throw new Error("Name is required");
                    return values;
                }
            };
            const app = createApp(mockDriver, hooks);

            const res = await app.request("/api/products", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ price: 99 })
            });

            // Should get an error status
            expect(res.status).toBeGreaterThanOrEqual(400);
            expect(mockDriver.saveEntity).not.toHaveBeenCalled();
        });
    });

    // ── afterSave ─────────────────────────────────────────────────────
    describe("data.afterSave", () => {
        it("fires afterSave after POST", async () => {
            const afterSaveSpy = jest.fn();
            const hooks: DataHooks = { afterSave: afterSaveSpy };
            const app = createApp(mockDriver, hooks);

            mockDriver.saveEntity.mockResolvedValue(
                { id: "new-1",
path: "products",
values: { name: "Widget" } } as any
            );

            const res = await app.request("/api/products", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Widget" })
            });

            expect(res.status).toBe(201);
            await new Promise(r => setTimeout(r, 50));
            expect(afterSaveSpy).toHaveBeenCalledTimes(1);
            expect(afterSaveSpy).toHaveBeenCalledWith(
                "products",
                expect.objectContaining({ id: "new-1",
name: "Widget" }),
                expect.objectContaining({ method: "POST" })
            );
        });

        it("fires afterSave after PUT", async () => {
            const afterSaveSpy = jest.fn();
            const hooks: DataHooks = { afterSave: afterSaveSpy };
            const app = createApp(mockDriver, hooks);

            mockDriver.fetchEntity.mockResolvedValue({ id: "p1",
path: "products",
values: {} } as any);
            mockDriver.saveEntity.mockResolvedValue(
                { id: "p1",
path: "products",
values: { name: "Updated" } } as any
            );

            await app.request("/api/products/p1", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Updated" })
            });

            await new Promise(r => setTimeout(r, 50));
            expect(afterSaveSpy).toHaveBeenCalledWith(
                "products",
                expect.objectContaining({ id: "p1" }),
                expect.objectContaining({ method: "PUT" })
            );
        });
    });

    // ── beforeDelete / afterDelete ───────────────────────────────────
    describe("data.beforeDelete / afterDelete", () => {
        it("aborts deletion when beforeDelete throws", async () => {
            const hooks: DataHooks = {
                beforeDelete(slug, entityId) {
                    if (entityId === "protected") {
                        throw new Error("Cannot delete protected entity");
                    }
                }
            };
            const app = createApp(mockDriver, hooks);

            mockDriver.fetchEntity.mockResolvedValue(
                { id: "protected",
path: "products",
values: {} } as any
            );

            const res = await app.request("/api/products/protected", { method: "DELETE" });
            expect(res.status).toBe(500);
            expect(mockDriver.deleteEntity).not.toHaveBeenCalled();
        });

        it("allows deletion when beforeDelete does not throw", async () => {
            const beforeDeleteSpy = jest.fn();
            const hooks: DataHooks = { beforeDelete: beforeDeleteSpy };
            const app = createApp(mockDriver, hooks);

            const existingEntity = { id: "p1",
path: "products",
values: {} } as any;
            mockDriver.fetchEntity.mockResolvedValue(existingEntity);
            mockDriver.deleteEntity.mockResolvedValue();

            const res = await app.request("/api/products/p1", { method: "DELETE" });
            expect(res.status).toBe(204);
            expect(beforeDeleteSpy).toHaveBeenCalledWith(
                "products", "p1", expect.objectContaining({ method: "DELETE" })
            );
            expect(mockDriver.deleteEntity).toHaveBeenCalled();
        });

        it("fires afterDelete after successful deletion", async () => {
            const afterDeleteSpy = jest.fn();
            const hooks: DataHooks = { afterDelete: afterDeleteSpy };
            const app = createApp(mockDriver, hooks);

            mockDriver.fetchEntity.mockResolvedValue({ id: "p1",
path: "products",
values: {} } as any);
            mockDriver.deleteEntity.mockResolvedValue();

            await app.request("/api/products/p1", { method: "DELETE" });
            await new Promise(r => setTimeout(r, 50));

            expect(afterDeleteSpy).toHaveBeenCalledWith(
                "products", "p1", expect.objectContaining({ method: "DELETE" })
            );
        });
    });

    // ── no hooks (passthrough) ──────────────────────────────────────
    describe("no hooks configured", () => {
        it("returns data unchanged when no hooks are provided", async () => {
            const app = createApp(mockDriver); // no hooks
            mockDriver.fetchCollection.mockResolvedValue([
                { id: "p1",
path: "products",
values: { name: "Widget" } } as any
            ]);
            mockDriver.countEntities!.mockResolvedValue(1);

            const res = await app.request("/api/products");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.data).toHaveLength(1);
            expect(body.data[0].name).toBe("Widget");
        });
    });
});
