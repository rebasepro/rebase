import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import { DataDriver } from "../../types/src/controllers/data_driver";
import { CollectionConfig } from "../../types/src/types/collections";

describe("RestApiGenerator", () => {
    let mockDriver: jest.Mocked<DataDriver>;
    let mockCollections: CollectionConfig[];

    beforeEach(() => {
        mockDriver = {
            key: "postgres",
            initialised: true,
            fetchCollection: jest.fn(),
            listenCollection: jest.fn(),
            fetchOne: jest.fn(),
            listenOne: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            checkUniqueField: jest.fn(),
            count: jest.fn(),
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
        // RestApiGenerator.getScopedDriver reads from c.get("driver") which is
        // normally set by auth middleware. Replicate that here for tests.
        app.use("/api/*", async (c, next) => {
            c.set("driver", mockDriver);
            await next();
        });
        const generator = new RestApiGenerator(mockCollections, mockDriver);
        app.route("/api", generator.generateRoutes());
        return app;
    }

    /**
     * Mount directly at root — eliminates Hono sub-router prefix stripping
     * so we can reliably test route matching without nesting interference.
     */
    function createFlatApp() {
        const app = new Hono();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("driver", mockDriver);
            await next();
        });
        const generator = new RestApiGenerator(mockCollections, mockDriver);
        app.route("/", generator.generateRoutes());
        return app;
    }

    describe("Core Collection Routes", () => {
        it("list entities - GET /api/users", async () => {
            const app = createApp();
            mockDriver.fetchCollection.mockResolvedValue([
                { id: "1",
name: "Alice" } as any
            ]);
            mockDriver.count!.mockResolvedValue(1);

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
            mockDriver.fetchOne.mockResolvedValue(
                { id: "123",
name: "Alice" } as any
            );

            const res = await app.request("/api/users/123");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.id).toBe("123");
            expect(body.name).toBe("Alice");
            expect(mockDriver.fetchOne).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users",
id: "123" })
            );
        });

        it("create entity - POST /api/users", async () => {
            const app = createApp();
            mockDriver.save.mockResolvedValue(
                { id: "new-1",
name: "Bob" } as any
            );

            const res = await app.request("/api/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Bob" })
            });

            expect(res.status).toBe(201);
            expect(mockDriver.save).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users",
values: { name: "Bob" },
status: "new" })
            );
        });

        it("update entity - PUT /api/users/123", async () => {
            const app = createApp();
            mockDriver.fetchOne.mockResolvedValue({ id: "123" } as any);
            mockDriver.save.mockResolvedValue(
                { id: "123",
name: "Bob Jr" } as any
            );

            const res = await app.request("/api/users/123", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Bob Jr" })
            });

            expect(res.status).toBe(200);
            expect(mockDriver.save).toHaveBeenCalledWith(
                expect.objectContaining({ path: "users",
id: "123",
values: { name: "Bob Jr" },
status: "existing" })
            );
        });

        it("delete entity - DELETE /api/users/123", async () => {
            const app = createApp();
            const existingEntity = { id: "123",
name: "Alice" } as any;
            mockDriver.fetchOne.mockResolvedValue(existingEntity);
            mockDriver.delete.mockResolvedValue();

            const res = await app.request("/api/users/123", { method: "DELETE" });

            expect(res.status).toBe(204);
            expect(mockDriver.delete).toHaveBeenCalledWith(
                expect.objectContaining({
                    row: expect.objectContaining({
                        id: "123",
                        path: "users",
                        values: existingEntity
                    })
                })
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
title: "Hello" } as any
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
            mockDriver.fetchOne.mockResolvedValue(
                { id: "456",
title: "Hello" } as any
            );

            const res = await app.request("/authors/123/posts/456");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.id).toBe("456");
            expect(body.title).toBe("Hello");
            expect(mockDriver.fetchOne).toHaveBeenCalledWith(
                expect.objectContaining({ path: "authors/123/posts",
id: "456" })
            );
        });

        it("create subcollection entity - POST /authors/123/posts", async () => {
            const app = createFlatApp();
            mockDriver.save.mockResolvedValue(
                { id: "new-post",
title: "New" } as any
            );

            const res = await app.request("/authors/123/posts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "New" })
            });

            expect(res.status).toBe(201);
            expect(mockDriver.save).toHaveBeenCalledWith(
                expect.objectContaining({ path: "authors/123/posts",
status: "new" })
            );
        });

        it("update subcollection entity - PUT /authors/123/posts/456", async () => {
            const app = createFlatApp();
            mockDriver.save.mockResolvedValue(
                { id: "456",
title: "Updated" } as any
            );

            const res = await app.request("/authors/123/posts/456", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Updated" })
            });

            expect(res.status).toBe(200);
            expect(mockDriver.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "authors/123/posts",
                    id: "456",
                    status: "existing"
                })
            );
        });

        it("delete subcollection entity - DELETE /authors/123/posts/456", async () => {
            const app = createFlatApp();
            const existingEntity = { id: "456",
title: "Hello" } as any;
            mockDriver.fetchOne.mockResolvedValue(existingEntity);
            mockDriver.delete.mockResolvedValue();

            const res = await app.request("/authors/123/posts/456", { method: "DELETE" });

            expect(res.status).toBe(204);
            expect(mockDriver.delete).toHaveBeenCalledWith(
                expect.objectContaining({
                    row: expect.objectContaining({
                        id: "456",
                        path: "authors/123/posts",
                        values: existingEntity
                    })
                })
            );
        });

        it("deeply nested subcollection list - GET /authors/123/posts/456/comments", async () => {
            const app = createFlatApp();
            mockDriver.fetchCollection.mockResolvedValue([
                { id: "c-1",
text: "Wow" } as any
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
            mockDriver.fetchOne.mockResolvedValue(
                { id: "789",
text: "Wow" } as any
            );

            const res = await app.request("/authors/123/posts/456/comments/789");
            expect(res.status).toBe(200);

            const body = await res.json() as any;
            expect(body.id).toBe("789");
            expect(mockDriver.fetchOne).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "authors/123/posts/456/comments",
                    id: "789"
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
            expect(mockDriver.fetchOne).not.toHaveBeenCalled();
        });

        it("POST /authors/123/undefined → 404, no driver calls", async () => {
            const app = createFlatApp();
            const res = await app.request("/authors/123/undefined", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "test" })
            });
            expect(res.status).toBe(404);
            expect(mockDriver.save).not.toHaveBeenCalled();
        });

        it("PUT /authors/123/undefined → 404, no driver calls", async () => {
            const app = createFlatApp();
            const res = await app.request("/authors/123/undefined", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "test" })
            });
            expect(res.status).toBe(404);
            expect(mockDriver.save).not.toHaveBeenCalled();
        });

        it("DELETE /authors/123/undefined → 404, no driver calls", async () => {
            const app = createFlatApp();
            const res = await app.request("/authors/123/undefined", { method: "DELETE" });
            expect(res.status).toBe(404);
            expect(mockDriver.delete).not.toHaveBeenCalled();
        });

        it("GET /authors/123/undefined/posts → 404, no driver calls", async () => {
            // Pinned deliberately, replacing a test that asserted 200 while its
            // own comment said "this should either 200 or 404" — a guess written
            // down as a guarantee. An `undefined` segment means the client
            // interpolated a variable it did not have, and the three siblings
            // above already refuse that with a 404 and no driver call. Dropping
            // the segment instead answered a *different* address,
            // `authors/123/posts`, with real rows — which tells the caller its
            // broken URL works. Behaviour change: it is now refused.
            const app = createFlatApp();
            mockDriver.fetchCollection.mockResolvedValue([]);
            const res = await app.request("/authors/123/undefined/posts");
            expect(res.status).toBe(404);
            expect(mockDriver.fetchCollection).not.toHaveBeenCalled();
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
        it("numeric IDs are correctly parsed as id", async () => {
            const app = createFlatApp();
            mockDriver.fetchOne.mockResolvedValue(
                { id: "999",
title: "Test" } as any
            );

            const res = await app.request("/authors/42/books/999");
            expect(res.status).toBe(200);
            expect(mockDriver.fetchOne).toHaveBeenCalledWith(
                expect.objectContaining({ path: "authors/42/books",
id: "999" })
            );
        });

        it("UUID-style IDs work as parentId and id", async () => {
            const app = createFlatApp();
            const uuid1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
            const uuid2 = "ffffffff-ffff-ffff-ffff-ffffffffffff";
            mockDriver.fetchOne.mockResolvedValue(
                { id: uuid2,
title: "UUID" } as any
            );

            const res = await app.request(`/authors/${uuid1}/posts/${uuid2}`);
            expect(res.status).toBe(200);
            expect(mockDriver.fetchOne).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: `authors/${uuid1}/posts`,
                    id: uuid2
                })
            );
        });

        it("entity not found returns 404 for subcollection GET", async () => {
            const app = createFlatApp();
            mockDriver.fetchOne.mockResolvedValue(undefined);

            const res = await app.request("/authors/123/posts/999");
            expect(res.status).toBe(404);
        });

        it("POST to even-segment path returns 404 (id present, can't create)", async () => {
            const app = createFlatApp();
            // 4 segments: authors/123/posts/456 — parseSubPath gives id="456"
            // POST handler checks: if (parsed.id) return c.notFound();
            const res = await app.request("/authors/123/posts/456", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "nope" })
            });
            expect(res.status).toBe(404);
            expect(mockDriver.save).not.toHaveBeenCalled();
        });

        it("PUT to odd-segment path returns 404 (no id, can't update)", async () => {
            const app = createFlatApp();
            // 3 segments: authors/123/posts — no id
            // PUT handler checks: if (!parsed.id) return c.notFound();
            const res = await app.request("/authors/123/posts", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "nope" })
            });
            expect(res.status).toBe(404);
            expect(mockDriver.save).not.toHaveBeenCalled();
        });

        it("DELETE to odd-segment path returns 404 (no id)", async () => {
            const app = createFlatApp();
            const res = await app.request("/authors/123/posts", { method: "DELETE" });
            expect(res.status).toBe(404);
            expect(mockDriver.delete).not.toHaveBeenCalled();
        });

        it("DELETE to non-existent entity returns 404", async () => {
            const app = createFlatApp();
            mockDriver.fetchOne.mockResolvedValue(undefined);
            const res = await app.request("/authors/123/posts/456", { method: "DELETE" });
            expect(res.status).toBe(404);
            expect(mockDriver.delete).not.toHaveBeenCalled();
        });
    });

    describe("Auth Hook Overrides (onAdminCreateUser via AuthAdapter)", () => {

        it("calls adapter.prepareUserCreation and saves user with returned values", async () => {
            const mockPrepare = jest.fn().mockResolvedValue({
                values: { email: "custom@example.com",
name: "Custom Name",
passwordHash: "custom-hash" },
                clearPassword: "custom-temp-password",
                hookHandledEmail: true,
                invitationSent: true
            });

            const mockAuthAdapter = {
                id: "test-adapter",
                verifyRequest: jest.fn(),
                getCapabilities: jest.fn(),
                prepareUserCreation: mockPrepare
            };

            const app = new Hono();
            app.onError(errorHandler);
            app.use("/api/*", async (c, next) => {
                c.set("driver", mockDriver);
                await next();
            });

            const authCollections = [
                {
                    slug: "users",
                    name: "Users",
                    singularName: "User",
                    auth: true,
                    properties: {}
                } as any
            ];

            const generator = new RestApiGenerator(authCollections, mockDriver, mockAuthAdapter as any);
            app.route("/api", generator.generateRoutes());

            mockDriver.save.mockResolvedValue({
                id: "custom-id",
                email: "custom@example.com",
                name: "Custom Name",
                passwordHash: "custom-hash"
            } as any);

            const res = await app.request("/api/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "original@example.com",
name: "Original Name" })
            });

            expect(res.status).toBe(201);
            const body = await res.json() as any;
            expect(body.email).toBe("custom@example.com");
            expect(body.invitationSent).toBe(true);
            expect(body.temporaryPassword).toBe("custom-temp-password");

            expect(mockPrepare).toHaveBeenCalledWith(
                expect.objectContaining({ email: "original@example.com",
name: "Original Name" }),
                undefined // auth: true → collectionAuthConfig is undefined
            );
            expect(mockDriver.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: "users",
                    values: { email: "custom@example.com",
name: "Custom Name",
passwordHash: "custom-hash" },
                    status: "new"
                })
            );
        });

        it("hands finalizeUserCreation the saved row as values, not undefined", async () => {
            // `driver.save` returns the flat row — the row IS the values. The
            // handler used to read `entity.values` (an Entity-era leftover),
            // handing the adapter `values: undefined`; its invite-email path
            // then threw on `values.email` inside a try that reports "email
            // delivery failed" — so no invitation was ever sent, and the flag
            // blamed SMTP.
            const mockFinalize = jest.fn().mockResolvedValue({ invitationSent: true });
            const mockAuthAdapter = {
                id: "test-adapter",
                verifyRequest: jest.fn(),
                getCapabilities: jest.fn(),
                prepareUserCreation: jest.fn().mockResolvedValue({
                    values: { email: "invited@example.com",
passwordHash: "hash" },
                    clearPassword: "temp-password",
                    hookHandledEmail: false
                }),
                finalizeUserCreation: mockFinalize
            };

            const app = new Hono();
            app.onError(errorHandler);
            app.use("/api/*", async (c, next) => {
                c.set("driver", mockDriver);
                await next();
            });

            const authCollections = [
                {
                    slug: "users",
                    name: "Users",
                    singularName: "User",
                    auth: true,
                    properties: {}
                } as any
            ];

            const generator = new RestApiGenerator(authCollections, mockDriver, mockAuthAdapter as any);
            app.route("/api", generator.generateRoutes());

            const savedRow = {
                id: "invited-id",
                email: "invited@example.com",
                displayName: "Invited User"
            };
            mockDriver.save.mockResolvedValue(savedRow as any);

            const res = await app.request("/api/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "invited@example.com" })
            });

            expect(res.status).toBe(201);
            expect(mockFinalize).toHaveBeenCalledWith(
                { id: "invited-id",
values: savedRow },
                "temp-password"
            );
        });
    });
});

/**
 * PATCH is the update verb; PUT is the alias published clients still send.
 *
 * The handler merges — it writes the columns in the body and leaves the rest —
 * which is what `update(id, data: Partial<M>)` means. PUT was the original
 * route, and PUT means replace, so the generated OpenAPI spec described a full
 * replacement (reusing the *create* input schema, `required` fields and all)
 * for an endpoint that performs a partial one. A client generated from that
 * spec demanded fields the server does not. PATCH is what the spec names, and
 * the only verb anything generated from it can send.
 *
 * The alias was removed once and that removal reached production before the
 * clients did: every SDK up to 0.16.0 sends PUT from `collection.update()`, so
 * `rebase cloud stop | start | restart` — three commands that are one
 * `update()` — answered 404 against a control plane that had already dropped
 * it. So both verbs are asserted here: same write, same 404 on a missing row,
 * and PUT additionally carrying the header that tells a caller it is on its way
 * out. The last test is what dates the alias — when no released SDK sends PUT,
 * it and the route go together.
 */
describe("RestApiGenerator — update verbs", () => {
    let mockDriver: jest.Mocked<DataDriver>;

    function app() {
        const a = new Hono();
        a.onError(errorHandler);
        a.use("/api/*", async (c, next) => {
            c.set("driver", mockDriver);
            await next();
        });
        const collections = [{ slug: "users", name: "Users", singularName: "User", properties: {} } as any];
        a.route("/api", new RestApiGenerator(collections, mockDriver).generateRoutes());
        return a;
    }

    beforeEach(() => {
        mockDriver = {
            key: "postgres",
            initialised: true,
            fetchOne: jest.fn().mockResolvedValue({ id: "123", name: "Bob", email: "b@x.com" }),
            save: jest.fn().mockResolvedValue({ id: "123", name: "Bob Jr", email: "b@x.com" }),
            fetchCollection: jest.fn(),
            listenCollection: jest.fn(),
            listenOne: jest.fn(),
            delete: jest.fn(),
            checkUniqueField: jest.fn(),
            count: jest.fn(),
            withAuth: jest.fn(),
            admin: {} as any
        } as unknown as jest.Mocked<DataDriver>;
    });

    it.each(["PATCH", "PUT"])("%s /api/users/123 performs the same partial write", async (method) => {
        const res = await app().request("/api/users/123", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Bob Jr" })
        });

        expect(res.status).toBe(200);
        expect(mockDriver.save).toHaveBeenCalledWith(
            expect.objectContaining({
                path: "users",
                id: "123",
                // Only what was sent. `email` is untouched rather than nulled —
                // the property that makes this a merge and not a replace.
                values: { name: "Bob Jr" },
                status: "existing"
            })
        );
    });

    it.each(["PATCH", "PUT"])("%s on a missing row is a 404", async (method) => {
        mockDriver.fetchOne.mockResolvedValue(undefined as any);

        const res = await app().request("/api/users/nope", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "x" })
        });

        expect(res.status).toBe(404);
        expect(mockDriver.save).not.toHaveBeenCalled();
    });

    it("answers PUT, and says it is deprecated", async () => {
        const res = await app().request("/api/users/123", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Bob Jr" })
        });

        expect(res.status).toBe(200);
        // RFC 8594. The signal a caller can act on without reading a changelog,
        // and the reason this alias can be removed later without a surprise.
        expect(res.headers.get("Deprecation")).toBe("true");
    });

    it("does not advertise PUT: PATCH is the only verb on the write path", async () => {
        // The alias is a courtesy to clients already in the field, not part of
        // the contract — anything generated from the spec sends PATCH, so the
        // spec must keep describing exactly one update operation.
        const res = await app().request("/api/users/123", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Bob Jr" })
        });

        expect(res.status).toBe(200);
        expect(res.headers.get("Deprecation")).toBeNull();
    });
});
