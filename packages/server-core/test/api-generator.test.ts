import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator.js";
import { DataDriver } from "../../types/src/controllers/data_driver.js";
import { EntityCollection } from "../../types/src/types/collections.js";

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

    function createApp() {
        const app = new Hono();
        const generator = new RestApiGenerator(mockCollections, mockDriver);
        app.route("/api", generator.generateRoutes());
        return app;
    }

    describe("Core Collection Routes", () => {
        it("list entities - GET /api/users", async () => {
            const app = createApp();
            mockDriver.fetchCollection.mockResolvedValue([
                { id: "1", path: "users", values: { name: "Alice" } } as any
            ]);
            mockDriver.countEntities!.mockResolvedValue(1);

            const res = await app.request("/api/users?limit=10");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.data).toEqual([{ id: "1", name: "Alice" }]);
            expect(mockDriver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users", limit: 10 })
            );
        });

        it("get entity - GET /api/users/123", async () => {
            const app = createApp();
            mockDriver.fetchEntity.mockResolvedValue(
                { id: "123", path: "users", values: { name: "Alice" } } as any
            );

            const res = await app.request("/api/users/123");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.id).toBe("123");
            expect(body.name).toBe("Alice");
            expect(mockDriver.fetchEntity).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users", entityId: "123" })
            );
        });

        it("create entity - POST /api/users", async () => {
            const app = createApp();
            mockDriver.saveEntity.mockResolvedValue(
                { id: "new-1", path: "users", values: { name: "Bob" } } as any
            );

            const res = await app.request("/api/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Bob" })
            });

            expect(res.status).toBe(201);
            expect(mockDriver.saveEntity).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users", values: { name: "Bob" }, status: "new" })
            );
        });

        it("update entity - PUT /api/users/123", async () => {
            const app = createApp();
            mockDriver.fetchEntity.mockResolvedValue({ id: "123", path: "users", values: {} } as any);
            mockDriver.saveEntity.mockResolvedValue(
                { id: "123", path: "users", values: { name: "Bob Jr" } } as any
            );

            const res = await app.request("/api/users/123", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Bob Jr" })
            });

            expect(res.status).toBe(200);
            expect(mockDriver.saveEntity).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users", entityId: "123", values: { name: "Bob Jr" }, status: "existing" })
            );
        });

        it("delete entity - DELETE /api/users/123", async () => {
            const app = createApp();
            const existingEntity = { id: "123", path: "users", values: {} } as any;
            mockDriver.fetchEntity.mockResolvedValue(existingEntity);
            mockDriver.deleteEntity.mockResolvedValue();

            const res = await app.request("/api/users/123", { method: "DELETE" });

            expect(res.status).toBe(204);
            expect(mockDriver.deleteEntity).toHaveBeenCalledWith(
                expect.objectContaining({ entity: existingEntity })
            );
        });
    });

    describe("Subcollection Routes (Fallback paths & Relation Eager Loading)", () => {
        it("list subcollection - GET /api/users/123/posts", async () => {
            const app = createApp();
            mockDriver.fetchCollection.mockResolvedValue([
                { id: "post-1", path: "users/123/posts", values: { title: "Hello" } } as any
            ]);

            const res = await app.request("/api/users/123/posts");
            expect(res.status).toBe(200);
            
            const body = await res.json() as any;
            expect(body.data).toEqual([{ id: "post-1", title: "Hello" }]);
            
            // Verifies the path parsed perfectly matches "users/123/posts" absolutely
            // unaffected by mounting prefix "api"
            expect(mockDriver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users/123/posts" })
            );
        });

        it("get subcollection entity - GET /api/users/123/posts/456", async () => {
            const app = createApp();
            mockDriver.fetchEntity.mockResolvedValue(
                { id: "456", path: "users/123/posts", values: { title: "Hello" } } as any
            );

            const res = await app.request("/api/users/123/posts/456");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.id).toBe("456");

            expect(mockDriver.fetchEntity).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users/123/posts", entityId: "456" })
            );
        });

        it("create subcollection entity - POST /api/users/123/posts", async () => {
            const app = createApp();
            mockDriver.saveEntity.mockResolvedValue(
                { id: "new-post", path: "users/123/posts", values: { title: "New" } } as any
            );

            const res = await app.request("/api/users/123/posts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "New" })
            });

            expect(res.status).toBe(201);
            expect(mockDriver.saveEntity).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users/123/posts", status: "new" })
            );
        });

        it("deeply nested subcollection list - GET /api/users/123/posts/456/comments", async () => {
            const app = createApp();
            mockDriver.fetchCollection.mockResolvedValue([
                { id: "comment-1", path: "users/123/posts/456/comments", values: { text: "Wow" } } as any
            ]);

            const res = await app.request("/api/users/123/posts/456/comments");
            expect(res.status).toBe(200);
            
            const body = await res.json() as any;
            expect(body.data).toEqual([{ id: "comment-1", text: "Wow" }]);
            
            expect(mockDriver.fetchCollection).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users/123/posts/456/comments" })
            );
        });
        
        it("returns 404 for malformed subcollection paths (e.g. GET /api/xyz without ID)", async () => {
            const app = createApp();
            // A request to /api/xyz would fall through normal collection routes
            // to the subcollection catch-all wildcard. Let's see if it correctly 404s.
            const res = await app.request("/api/xyz");
            expect(res.status).toBe(404);
            expect(mockDriver.fetchCollection).not.toHaveBeenCalled();
            expect(mockDriver.fetchEntity).not.toHaveBeenCalled();
        });
    });
});
