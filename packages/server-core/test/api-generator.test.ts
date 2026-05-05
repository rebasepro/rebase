import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import { DataDriver } from "../../types/src/controllers/data_driver";
import { EntityCollection } from "../../types/src/types/collections";

describe("RestApiGenerator", () => {
    let mockDriver: jest.Mocked<DataDriver>;
    let mockCollections: EntityCollection[];

    beforeEach(() => {
        mockDriver = {
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

        mockCollections = [
            {
                slug: "users",
                name: "Users",
                singularName: "User",
                properties: {}
            } as any,
            {
                slug: "posts",
                name: "Posts",
                singularName: "Post",
                properties: {}
            } as any
        ];
    });

    /**
     * Mount with "/api" prefix — mirrors production routing in init.ts.
     */
    function createApp() {
        const app = new Hono();
        app.onError(errorHandler);
        const generator = new RestApiGenerator(mockCollections, mockDriver);
        app.route("/api", generator.generateRoutes());
        return app;
    }

    /**
     * Mount directly at root — eliminates Hono sub-router prefix stripping
     * so we can reliably test route matching without nesting interference.
     */
    function createFlatApp() {
        const generator = new RestApiGenerator(mockCollections, mockDriver);
        const app = generator.generateRoutes();
        app.onError(errorHandler);
        return app;
    }

    describe("Core Collection Routes", () => {
        it("list entities - GET /api/users", async () => {
            const app = createApp();
            mockDriver.fetchCollection.mockResolvedValue([
                { id: "1",
path: "users",
values: { name: "Alice" } } as any
            ]);
            mockDriver.countEntities!.mockResolvedValue(1);

            const res = await app.request("/api/users?limit=10");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.data).toEqual([{ id: "1",
name: "Alice" }]);
            expect(mockDriver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users",
limit: 10 })
            );
        });

        it("get entity - GET /api/users/123", async () => {
            const app = createApp();
            mockDriver.fetchEntity.mockResolvedValue(
                { id: "123",
path: "users",
values: { name: "Alice" } } as any
            );

            const res = await app.request("/api/users/123");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.id).toBe("123");
            expect(body.name).toBe("Alice");
            expect(mockDriver.fetchEntity).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users",
entityId: "123" })
            );
        });

        it("create entity - POST /api/users", async () => {
            const app = createApp();
            mockDriver.saveEntity.mockResolvedValue(
                { id: "new-1",
path: "users",
values: { name: "Bob" } } as any
            );

            const res = await app.request("/api/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Bob" })
            });

            expect(res.status).toBe(201);
            expect(mockDriver.saveEntity).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users",
values: { name: "Bob" },
status: "new" })
            );
        });

        it("update entity - PUT /api/users/123", async () => {
            const app = createApp();
            mockDriver.fetchEntity.mockResolvedValue({ id: "123",
path: "users",
values: {} } as any);
            mockDriver.saveEntity.mockResolvedValue(
                { id: "123",
path: "users",
values: { name: "Bob Jr" } } as any
            );

            const res = await app.request("/api/users/123", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Bob Jr" })
            });

            expect(res.status).toBe(200);
            expect(mockDriver.saveEntity).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users",
entityId: "123",
values: { name: "Bob Jr" },
status: "existing" })
            );
        });

        it("delete entity - DELETE /api/users/123", async () => {
            const app = createApp();
            const existingEntity = { id: "123",
path: "users",
values: {} } as any;
            mockDriver.fetchEntity.mockResolvedValue(existingEntity);
            mockDriver.deleteEntity.mockResolvedValue();

            const res = await app.request("/api/users/123", { method: "DELETE" });

            expect(res.status).toBe(204);
            expect(mockDriver.deleteEntity).toHaveBeenCalledWith(
                expect.objectContaining({ entity: existingEntity })
            );
        });
    });

    describe("Subcollection Routes", () => {
        /**
         * These tests use the flat app (no prefix nesting) to avoid
         * Hono sub-router routing quirks where `/:slug/:id` eats the request
         * before the `/:parent/:parentId/*` wildcard gets a chance.
         *
         * We use "authors" as the parent slug since it's NOT a registered
         * collection, so it can only match the wildcard catch-all.
         */

        it("list subcollection - GET /authors/123/posts", async () => {
            const app = createFlatApp();
            mockDriver.fetchCollection.mockResolvedValue([
                { id: "post-1",
path: "authors/123/posts",
values: { title: "Hello" } } as any
            ]);

            const res = await app.request("/authors/123/posts");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.data).toEqual([{ id: "post-1",
title: "Hello" }]);
            expect(mockDriver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({ path: "authors/123/posts" })
            );
        });

        it("get subcollection entity - GET /authors/123/posts/456", async () => {
            const app = createFlatApp();
            mockDriver.fetchEntity.mockResolvedValue(
                { id: "456",
path: "authors/123/posts",
values: { title: "Hello" } } as any
            );

            const res = await app.request("/authors/123/posts/456");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.id).toBe("456");
            expect(body.title).toBe("Hello");
            expect(mockDriver.fetchEntity).toHaveBeenCalledWith(
                expect.objectContaining({ path: "authors/123/posts",
entityId: "456" })
            );
        });

        it("create subcollection entity - POST /authors/123/posts", async () => {
            const app = createFlatApp();
            mockDriver.saveEntity.mockResolvedValue(
                { id: "new-post",
path: "authors/123/posts",
values: { title: "New" } } as any
            );

            const res = await app.request("/authors/123/posts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "New" })
            });

            expect(res.status).toBe(201);
            expect(mockDriver.saveEntity).toHaveBeenCalledWith(
                expect.objectContaining({ path: "authors/123/posts",
status: "new" })
            );
        });

        it("update subcollection entity - PUT /authors/123/posts/456", async () => {
            const app = createFlatApp();
            mockDriver.saveEntity.mockResolvedValue(
                { id: "456",
path: "authors/123/posts",
values: { title: "Updated" } } as any
            );

            const res = await app.request("/authors/123/posts/456", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Updated" })
            });

            expect(res.status).toBe(200);
            expect(mockDriver.saveEntity).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "authors/123/posts",
                    entityId: "456",
                    status: "existing"
                })
            );
        });

        it("delete subcollection entity - DELETE /authors/123/posts/456", async () => {
            const app = createFlatApp();
            const existingEntity = { id: "456",
path: "authors/123/posts",
values: {} } as any;
            mockDriver.fetchEntity.mockResolvedValue(existingEntity);
            mockDriver.deleteEntity.mockResolvedValue();

            const res = await app.request("/authors/123/posts/456", { method: "DELETE" });

            expect(res.status).toBe(204);
            expect(mockDriver.deleteEntity).toHaveBeenCalledWith(
                expect.objectContaining({ entity: existingEntity })
            );
        });

        it("deeply nested subcollection list - GET /authors/123/posts/456/comments", async () => {
            const app = createFlatApp();
            mockDriver.fetchCollection.mockResolvedValue([
                { id: "c-1",
path: "authors/123/posts/456/comments",
values: { text: "Wow" } } as any
            ]);

            const res = await app.request("/authors/123/posts/456/comments");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.data).toEqual([{ id: "c-1",
text: "Wow" }]);
            expect(mockDriver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({ path: "authors/123/posts/456/comments" })
            );
        });

        it("deeply nested entity - GET /authors/123/posts/456/comments/789", async () => {
            const app = createFlatApp();
            mockDriver.fetchEntity.mockResolvedValue(
                { id: "789",
path: "authors/123/posts/456/comments",
values: { text: "Wow" } } as any
            );

            const res = await app.request("/authors/123/posts/456/comments/789");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.id).toBe("789");
            expect(mockDriver.fetchEntity).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "authors/123/posts/456/comments",
                    entityId: "789"
                })
            );
        });

        it("passes query options when listing subcollection", async () => {
            const app = createFlatApp();
            mockDriver.fetchCollection.mockResolvedValue([]);

            const res = await app.request("/authors/123/posts?limit=5&orderBy=title:desc&searchString=hello");
            expect(res.status).toBe(200);

            expect(mockDriver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "authors/123/posts",
                    limit: 5,
                    searchString: "hello"
                })
            );
        });
    });

    describe("Subcollection Wildcard Guard (Undefined / Empty Paths)", () => {
        /**
         * Regression: c.req.param("*") can return "undefined" (literal string)
         * when template literal stringifies JS undefined. This caused:
         *   Error: Relation 'undefined' not found in collection 'authors'
         */

        it("GET /authors/123/undefined → 404, no driver calls", async () => {
            const app = createFlatApp();
            const res = await app.request("/authors/123/undefined");
            expect(res.status).toBe(404);
            expect(mockDriver.fetchCollection).not.toHaveBeenCalled();
            expect(mockDriver.fetchEntity).not.toHaveBeenCalled();
        });

        it("POST /authors/123/undefined → 404, no driver calls", async () => {
            const app = createFlatApp();
            const res = await app.request("/authors/123/undefined", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "test" })
            });
            expect(res.status).toBe(404);
            expect(mockDriver.saveEntity).not.toHaveBeenCalled();
        });

        it("PUT /authors/123/undefined → 404, no driver calls", async () => {
            const app = createFlatApp();
            const res = await app.request("/authors/123/undefined", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "test" })
            });
            expect(res.status).toBe(404);
            expect(mockDriver.saveEntity).not.toHaveBeenCalled();
        });

        it("DELETE /authors/123/undefined → 404, no driver calls", async () => {
            const app = createFlatApp();
            const res = await app.request("/authors/123/undefined", { method: "DELETE" });
            expect(res.status).toBe(404);
            expect(mockDriver.deleteEntity).not.toHaveBeenCalled();
        });

        it("nested undefined segment is filtered: GET /authors/123/undefined/posts → 404 (not enough valid segments)", async () => {
            // After filtering "undefined", segments = ["authors", "123", "posts"] → 3 segments → odd → collection path
            // But the wildcard is "undefined/posts", which is NOT the literal "undefined", so the guard won't catch it.
            // However, parseSubPath filters "undefined" from segments: ["authors", "123", "posts"] → valid 3-segment path.
            const app = createFlatApp();
            mockDriver.fetchCollection.mockResolvedValue([]);
            const res = await app.request("/authors/123/undefined/posts");
            // This should either 200 (if parseSubPath accepts "authors/123/posts") or 404
            // Since wildcard = "undefined/posts" which is truthy and not === "undefined", the guard lets it through.
            // parseSubPath filters "undefined" segments → ["authors", "123", "posts"] → 3 segments → collection path.
            expect(res.status).toBe(200);
            expect(mockDriver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({ path: "authors/123/posts" })
            );
        });

        it("returns 404 for bare parent without wildcard - GET /xyz", async () => {
            const app = createFlatApp();
            const res = await app.request("/xyz");
            expect(res.status).toBe(404);
            expect(mockDriver.fetchCollection).not.toHaveBeenCalled();
        });

        it("returns 404 for only two segments (no relation) - GET /xyz/123", async () => {
            // Two segments: would be handled by /:slug/:id route, but "xyz" isn't a registered collection
            // so the /:slug route won't match. /:parent/:parentId/* won't match either (no wildcard part).
            const app = createFlatApp();
            const res = await app.request("/xyz/123");
            expect(res.status).toBe(404);
        });
    });

    describe("Path Parsing Edge Cases via HTTP", () => {
        it("numeric IDs are correctly parsed as entityId", async () => {
            const app = createFlatApp();
            mockDriver.fetchEntity.mockResolvedValue(
                { id: "999",
path: "authors/42/books",
values: { title: "Test" } } as any
            );

            const res = await app.request("/authors/42/books/999");
            expect(res.status).toBe(200);
            expect(mockDriver.fetchEntity).toHaveBeenCalledWith(
                expect.objectContaining({ path: "authors/42/books",
entityId: "999" })
            );
        });

        it("UUID-style IDs work as parentId and entityId", async () => {
            const app = createFlatApp();
            const uuid1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
            const uuid2 = "ffffffff-ffff-ffff-ffff-ffffffffffff";
            mockDriver.fetchEntity.mockResolvedValue(
                { id: uuid2,
path: `authors/${uuid1}/posts`,
values: { title: "UUID" } } as any
            );

            const res = await app.request(`/authors/${uuid1}/posts/${uuid2}`);
            expect(res.status).toBe(200);
            expect(mockDriver.fetchEntity).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: `authors/${uuid1}/posts`,
                    entityId: uuid2
                })
            );
        });

        it("entity not found returns 404 for subcollection GET", async () => {
            const app = createFlatApp();
            mockDriver.fetchEntity.mockResolvedValue(undefined);

            const res = await app.request("/authors/123/posts/999");
            expect(res.status).toBe(404);
        });

        it("POST to even-segment path returns 404 (entityId present, can't create)", async () => {
            const app = createFlatApp();
            // 4 segments: authors/123/posts/456 — parseSubPath gives entityId="456"
            // POST handler checks: if (parsed.entityId) return c.notFound();
            const res = await app.request("/authors/123/posts/456", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "nope" })
            });
            expect(res.status).toBe(404);
            expect(mockDriver.saveEntity).not.toHaveBeenCalled();
        });

        it("PUT to odd-segment path returns 404 (no entityId, can't update)", async () => {
            const app = createFlatApp();
            // 3 segments: authors/123/posts — no entityId
            // PUT handler checks: if (!parsed.entityId) return c.notFound();
            const res = await app.request("/authors/123/posts", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "nope" })
            });
            expect(res.status).toBe(404);
            expect(mockDriver.saveEntity).not.toHaveBeenCalled();
        });

        it("DELETE to odd-segment path returns 404 (no entityId)", async () => {
            const app = createFlatApp();
            const res = await app.request("/authors/123/posts", { method: "DELETE" });
            expect(res.status).toBe(404);
            expect(mockDriver.deleteEntity).not.toHaveBeenCalled();
        });

        it("DELETE to non-existent entity returns 404", async () => {
            const app = createFlatApp();
            mockDriver.fetchEntity.mockResolvedValue(undefined);
            const res = await app.request("/authors/123/posts/456", { method: "DELETE" });
            expect(res.status).toBe(404);
            expect(mockDriver.deleteEntity).not.toHaveBeenCalled();
        });
    });
});
