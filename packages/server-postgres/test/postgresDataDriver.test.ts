
import { describe, it, expect, beforeEach } from "@jest/globals";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { DataService } from "../src/services/dataService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { CollectionConfig, Entity } from "@rebasepro/types";

type MockTx = { execute: jest.Mock };
type MockUser = { uid: string; email?: string; roles?: unknown[] };

// Mock dependencies
const mockDb = {
    transaction: jest.fn(),
    execute: jest.fn(),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis()
} as unknown as NodePgDatabase;

const mockRealtimeService = {
    registerDataDriverSubscription: jest.fn(),
    addSubscriptionCallback: jest.fn(),
    removeSubscriptionCallback: jest.fn(),
    subscriptions: new Map(),
    notifyUpdate: jest.fn()
} as unknown as RealtimeService;


describe("PostgresBackendDriver", () => {
    let delegate: PostgresBackendDriver;

    beforeEach(() => {
        jest.clearAllMocks();
        const mockRegistry = {
            getCollectionByPath: jest.fn().mockReturnValue({ slug: "test_coll",
properties: {} }),
            getCollections: jest.fn().mockReturnValue([]),
            getTable: jest.fn().mockReturnValue({}),
            getGlobalCallbacks: jest.fn().mockReturnValue(undefined)
        } as any;
        delegate = new PostgresBackendDriver(mockDb, mockRealtimeService, mockRegistry);
    });

    it("should initialize correctly", () => {
        expect(delegate).toBeDefined();
        expect(delegate.key).toBe("postgres");
    });

    describe("restFetchService runs afterRead (REST/SDK path)", () => {
        // Regression guard: the REST / `include` path fetches through the raw
        // FetchService, which does NOT run callbacks. Without the driver applying
        // afterRead on top, every REST/SDK read leaks unmasked data (e.g. PII).
        // This proves masking runs on both the collection- and fetchOne paths, and
        // one level into embedded relation data.

        const maskEmail = (e: string) => {
            const [l, d] = e.split("@");
            return l && d ? `${l[0]}***@${d}` : e;
        };

        function buildDriver(
            collection: Record<string, unknown>,
            rawService: { fetchCollectionForRest?: unknown; fetchOneForRest?: unknown },
            byPath?: (path: string) => unknown
        ) {
            const registry = {
                getCollectionByPath: jest.fn().mockImplementation((p: string) =>
                    byPath ? byPath(p) : collection),
                getCollections: jest.fn().mockReturnValue([]),
                getTable: jest.fn().mockReturnValue({}),
                getGlobalCallbacks: jest.fn().mockReturnValue(undefined)
            } as any;
            const driver = new PostgresBackendDriver(mockDb, mockRealtimeService, registry);
            jest.spyOn((driver as any).dataService, "getFetchService").mockReturnValue(rawService as any);
            return driver;
        }

        it("masks rows from fetchCollectionForRest", async () => {
            const driver = buildDriver(
                { slug: "customers", properties: {}, callbacks: { afterRead: ({ row }: any) => ({ ...row, email: maskEmail(row.email) }) } },
                { fetchCollectionForRest: async () => [{ id: "c1", email: "jane.doe@acme.com" }] }
            );
            const rows = await driver.restFetchService.fetchCollectionForRest("customers", {});
            expect(rows[0].email).toBe("j***@acme.com");
        });

        it("masks the single row from fetchOneForRest", async () => {
            const driver = buildDriver(
                { slug: "customers", properties: {}, callbacks: { afterRead: ({ row }: any) => ({ ...row, email: maskEmail(row.email) }) } },
                { fetchOneForRest: async () => ({ id: "c1", email: "jane.doe@acme.com" }) }
            );
            const row = await driver.restFetchService.fetchOneForRest("customers", "c1");
            expect(row?.email).toBe("j***@acme.com");
        });

        it("masks embedded relation data using the TARGET collection's afterRead", async () => {
            const authors = { slug: "authors", properties: {}, callbacks: { afterRead: ({ row }: any) => ({ ...row, email: maskEmail(row.email) }) } };
            const posts = {
                slug: "posts", properties: {},
                relations: [{
    kind: "belongsTo", relationName: "author", localKey: "author_id", target: () => authors }],
                callbacks: undefined
            };
            const driver = buildDriver(posts, {
                fetchCollectionForRest: async () => [{ id: "p1", title: "Hello", author: { id: "a1", email: "sam@acme.com" } }]
            }, (p) => (p === "authors" ? authors : posts));
            const rows = await driver.restFetchService.fetchCollectionForRest("posts", {}, ["author"]);
            expect((rows[0].author as any).email).toBe("s***@acme.com");
        });

        it("leaves data untouched when no afterRead is defined", async () => {
            const driver = buildDriver(
                { slug: "plain", properties: {}, callbacks: undefined },
                { fetchCollectionForRest: async () => [{ id: "x1", email: "raw@acme.com" }] }
            );
            const rows = await driver.restFetchService.fetchCollectionForRest("plain", {});
            expect(rows[0].email).toBe("raw@acme.com");
        });
    });

    describe("withAuth", () => {
        it("should return a new delegate instance", async () => {
            const user = { uid: "test-user",
email: "test@example.com" };
            const authDelegate = await delegate.withAuth(user);

            expect(authDelegate).toBeDefined();
            expect(authDelegate).not.toBe(delegate);
        });

        it("should wrap methods in a transaction", async () => {
            const user = { uid: "test-user",
email: "test@example.com" };
            const authDelegate = await delegate.withAuth(user);

            const mockTx = { execute: jest.fn() };
            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                return await cb(mockTx);
            });

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "test_collection",
collection: { slug: "test",
properties: {} } as unknown as CollectionConfig });

            expect(mockDb.transaction).toHaveBeenCalled();
        });

        it("should set app.user_id in the transaction for RLS", async () => {
            const user = { uid: "test-user-123",
email: "test@example.com" };
            const authDelegate = await delegate.withAuth(user);

            const mockTx: MockTx = { execute: jest.fn() };
            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                return await cb(mockTx);
            });

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "test",
collection: { slug: "test",
properties: {} } as unknown as CollectionConfig });

            expect(mockDb.transaction).toHaveBeenCalled();
            expect(mockTx.execute).toHaveBeenCalled();
            const sqlCall = mockTx.execute.mock.calls[0][0];
            const callString = JSON.stringify(sqlCall);
            expect(callString).toContain("set_config");
            expect(callString).toContain("test-user-123");
        });

        it("should set app.user_roles handling array of strings correctly", async () => {
            const user: MockUser = { uid: "test-user-123",
email: "test@example.com",
roles: ["admin", "editor"] };
            const authDelegate = await delegate.withAuth(user);

            const mockTx: MockTx = { execute: jest.fn() };
            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                return await cb(mockTx);
            });

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "test",
collection: { slug: "test",
properties: {} } as unknown as CollectionConfig });

            expect(mockTx.execute).toHaveBeenCalledTimes(1);
            const sqlCall = mockTx.execute.mock.calls[0][0];
            const callString = JSON.stringify(sqlCall);
            expect(callString).toContain("set_config");
            expect(callString).toContain("admin,editor");
        });

        it("should set app.user_roles handling array of objects correctly", async () => {
            const user: MockUser = { uid: "test-user-123",
email: "test@example.com",
roles: [{ id: "admin" }, { id: "editor" }] };
            const authDelegate = await delegate.withAuth(user);

            const mockTx: MockTx = { execute: jest.fn() };
            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                return await cb(mockTx);
            });

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "test",
collection: { slug: "test",
properties: {} } as unknown as CollectionConfig });

            expect(mockTx.execute).toHaveBeenCalledTimes(1);
            const sqlCall = mockTx.execute.mock.calls[0][0];
            const callString = JSON.stringify(sqlCall);
            expect(callString).toContain("set_config");
            expect(callString).toContain("admin,editor");
        });

        it("should fallback to anonymous and empty roles when missing from user", async () => {
            const user = {} as unknown as MockUser; // Empty user object
            const authDelegate = await delegate.withAuth(user);

            (mockDb.transaction as jest.Mock).mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => {
                const mockTx: MockTx = { execute: jest.fn() };
                return cb(mockTx);
            });

            // We mock fetchCollection to just return something and not crash
            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "test",
collection: { slug: "test",
properties: {} } as unknown as CollectionConfig });

            expect(mockDb.transaction).toHaveBeenCalledTimes(1);

            const transactionCallback = (mockDb.transaction as jest.Mock).mock.calls[0][0];
            const mockTx: MockTx = { execute: jest.fn() };
            await transactionCallback(mockTx).catch(() => {});

            const sqlCall = mockTx.execute.mock.calls[0][0];
            const callString = JSON.stringify(sqlCall);
            expect(callString).toContain("set_config");
            expect(callString).toContain("anonymous");
        });

        it("should gracefully handle completely null or undefined user objects", async () => {
            const authDelegate = await delegate.withAuth(null as unknown as MockUser);

            (mockDb.transaction as jest.Mock).mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => {
                const mockTx: MockTx = { execute: jest.fn() };
                return cb(mockTx);
            });

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "test",
collection: { slug: "test",
properties: {} } as unknown as CollectionConfig });

            const transactionCallback = (mockDb.transaction as jest.Mock).mock.calls[0][0];
            const mockTx: MockTx = { execute: jest.fn() };
            await transactionCallback(mockTx).catch(() => {});

            const sqlCall = mockTx.execute.mock.calls[0][0];
            const callString = JSON.stringify(sqlCall);
            expect(callString).toContain("set_config");
            expect(callString).toContain("anonymous");
        });
    });

    describe("AuthenticatedPostgresBackendDriver Transactional Integrity", () => {
        let authDelegate: Awaited<ReturnType<typeof delegate.withAuth>>;

        beforeEach(async () => {
            authDelegate = await delegate.withAuth({ uid: "test-user",
email: "test@example.com" });
        });

        it("should execute operation and flush notifications on success", async () => {
            const mockTx = {
                execute: jest.fn()
            };

            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                return await cb(mockTx);
            });

            // Let's pretend the operation queues a notification
            jest.spyOn(PostgresBackendDriver.prototype, "save").mockImplementationOnce(async function(this: { _pendingNotifications?: Array<Record<string, unknown>> }) {
                this._pendingNotifications?.push({
                    path: "test",
                    id: "123",
                    row: {} as unknown as Record<string, unknown>
                });
                return {} as unknown as Entity;
            });

            await authDelegate.save({ path: "test",
id: "123",
values: {},
collection: {} as unknown as CollectionConfig,
status: "new" });

            // Ensure transaction was called
            expect(mockDb.transaction).toHaveBeenCalled();

            // Ensure notification was flushed after commit
            expect(mockRealtimeService.notifyUpdate).toHaveBeenCalledWith("test", "123", {}, undefined);
        });

        it("should NOT flush notifications if transaction throws an error", async () => {
            const mockTx = {
                execute: jest.fn()
            };

            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                return await cb(mockTx);
            });

            jest.spyOn(PostgresBackendDriver.prototype, "save").mockImplementationOnce(async function(this: { _pendingNotifications?: Array<Record<string, unknown>> }) {
                this._pendingNotifications?.push({
                    path: "test",
                    id: "123",
                    row: {} as unknown as Record<string, unknown>
                });
                throw new Error("Transaction failed");
            });

            await expect(authDelegate.save({ path: "test",
id: "123",
values: {},
collection: {} as unknown as CollectionConfig,
status: "new" })).rejects.toThrow("Transaction failed");

            // Ensure notification was NOT flushed
            expect(mockRealtimeService.notifyUpdate).not.toHaveBeenCalled();
        });

        it("should return successfully even if a deferred notification throw an error (resilience)", async () => {
            const mockTx = {
                execute: jest.fn()
            };

            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                return await cb(mockTx);
            });

            jest.spyOn(PostgresBackendDriver.prototype, "save").mockImplementationOnce(async function(this: { _pendingNotifications?: Array<Record<string, unknown>> }) {
                this._pendingNotifications?.push({
                    path: "test",
                    id: "buggy-123",
                    row: {} as unknown as Record<string, unknown>
                });
                return { id: "success" } as unknown as Entity;
            });

            // Mock the notification service intentionally crashing
            const notifySpy = mockRealtimeService.notifyUpdate as jest.Mock;
            notifySpy.mockRejectedValueOnce(new Error("Network Failure on Notification"));

            // Should still return the entity successfully despite the error
            const result = await authDelegate.save({ path: "test",
id: "buggy-123",
values: {},
collection: {} as unknown as CollectionConfig,
status: "new" });

            expect(result).toEqual({ id: "success" });
            expect(notifySpy).toHaveBeenCalledWith("test", "buggy-123", {}, undefined);
        });

        it("should safely isolate completely concurrent transaction notifications from leaking across scopes", async () => {
            const mockTx = {
                execute: jest.fn()
            };

            // This mock introduces slight async delay to allow concurrent operations to interleave execution
            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                await new Promise(r => setTimeout(r, 10));
                return await cb(mockTx);
            });

            // Operation 1 flags a notification
            const save1 = jest.spyOn(PostgresBackendDriver.prototype, "save").mockImplementationOnce(async function(this: { _pendingNotifications?: Array<Record<string, unknown>> }) {
                this._pendingNotifications?.push({ path: "scope-1",
id: "1",
row: {} as unknown as Record<string, unknown> });
                return {} as unknown as Entity;
            });

            // Operation 2 flags a different notification
            const save2 = jest.spyOn(PostgresBackendDriver.prototype, "save").mockImplementationOnce(async function(this: { _pendingNotifications?: Array<Record<string, unknown>> }) {
                this._pendingNotifications?.push({ path: "scope-2",
id: "2",
row: {} as unknown as Record<string, unknown> });
                return {} as unknown as Entity;
            });

            // Fire simultaneously
            await Promise.all([
                authDelegate.save({ path: "scope-1",
id: "1",
values: {},
collection: {} as unknown as CollectionConfig,
status: "new" }),
                authDelegate.save({ path: "scope-2",
id: "2",
values: {},
collection: {} as unknown as CollectionConfig,
status: "new" })
            ]);

            // Ensure our notify was called with both exact combinations, but NOT cross-pollinated
            expect(mockRealtimeService.notifyUpdate).toHaveBeenCalledWith("scope-1", "1", {}, undefined);
            expect(mockRealtimeService.notifyUpdate).toHaveBeenCalledWith("scope-2", "2", {}, undefined);

            // Check count
            expect(mockRealtimeService.notifyUpdate).toHaveBeenCalledTimes(2);
        });
    });

    describe("AuthenticatedPostgresBackendDriver Delegation", () => {
        let authDelegate: Awaited<ReturnType<typeof delegate.withAuth>>;

        beforeEach(async () => {
            authDelegate = await delegate.withAuth({ uid: "test-user",
email: "test@example.com" });
        });

        it("should delegate executeSql via admin without a transaction", async () => {
            jest.spyOn(delegate, "executeSql").mockResolvedValueOnce([{ id: 1 }] as unknown as Record<string, unknown>[]);

            const result = await authDelegate.admin.executeSql("SELECT 1");

            expect(mockDb.transaction).not.toHaveBeenCalled();
            expect(delegate.executeSql).toHaveBeenCalledWith("SELECT 1");
            expect(result).toEqual([{ id: 1 }]);
        });

        it("should override listenCollection to inject auth context", () => {
            const mockUnsubscribe = jest.fn();

            // Clear original map instead of reassigning
            mockRealtimeService.subscriptions.clear();

            // The act of calling the delegated method should update the last subscription
            jest.spyOn(delegate, "listenCollection").mockImplementationOnce(() => {
                mockRealtimeService.subscriptions.set("sub1", { clientId: "driver",
authContext: undefined });
                return mockUnsubscribe;
            });

            const unsub = authDelegate.listenCollection({ path: "test",
collection: {} as unknown as CollectionConfig,
callbacks: {} as unknown as Record<string, unknown> });

            expect(unsub).toBe(mockUnsubscribe);
            expect(mockRealtimeService.subscriptions.get("sub1").authContext).toEqual({ uid: "test-user",
roles: [] });
        });

        it("should override listenOne to inject auth context", () => {
            const mockUnsubscribe = jest.fn();

            mockRealtimeService.subscriptions.clear();

            jest.spyOn(delegate, "listenOne").mockImplementationOnce(() => {
                mockRealtimeService.subscriptions.set("sub2", { clientId: "driver",
authContext: undefined });
                return mockUnsubscribe;
            });

            const unsub = authDelegate.listenOne({ path: "test",
id: "123",
collection: {} as unknown as CollectionConfig,
callbacks: {} as unknown as Record<string, unknown> });

            expect(unsub).toBe(mockUnsubscribe);
            expect(mockRealtimeService.subscriptions.get("sub2").authContext).toEqual({ uid: "test-user",
roles: [] });
        });

        it("should handle listenCollection gracefully if delegate fails to add a subscription", () => {
            const mockUnsubscribe = jest.fn();
            mockRealtimeService.subscriptions.clear();
            jest.spyOn(delegate, "listenCollection").mockImplementationOnce(() => mockUnsubscribe);
            const unsub = authDelegate.listenCollection({ path: "empty-test",
collection: {} as unknown as CollectionConfig,
callbacks: {} as unknown as Record<string, unknown> });
            expect(unsub).toBe(mockUnsubscribe);
        });

        it("should skip authContext injection if the last subscription has a non-driver clientId", () => {
            // `injectAuthContext` writes into whichever subscription happens to be
            // LAST in the map, on the assumption that the delegate call it just
            // made registered it. The `clientId === "driver"` guard is what keeps
            // that assumption honest: without it, a subscription registered by
            // some other client — a websocket session belonging to a different
            // user — would be stamped with this request's uid and roles, and the
            // RLS-aware poller would then read rows as the wrong user.
            const mockUnsubscribe = jest.fn();
            mockRealtimeService.subscriptions.clear();
            jest.spyOn(delegate, "listenCollection").mockImplementationOnce(() => {
                mockRealtimeService.subscriptions.set("sub-ext", { clientId: "external-client",
authContext: undefined });
                return mockUnsubscribe;
            });
            authDelegate.listenCollection({ path: "test",
collection: {} as unknown as CollectionConfig,
callbacks: {} as unknown as Record<string, unknown> });
            expect(mockRealtimeService.subscriptions.get("sub-ext").authContext).toBeUndefined();
        });

        it("should delegate fetchAvailableDatabases via admin without a transaction", async () => {
            jest.spyOn(delegate, "fetchAvailableDatabases").mockResolvedValueOnce(["db1", "db2"]);
            const result = await authDelegate.admin.fetchAvailableDatabases!();
            expect(mockDb.transaction).not.toHaveBeenCalled();
            expect(result).toEqual(["db1", "db2"]);
        });

        it("should delegate fetchAvailableRoles via admin without a transaction", async () => {
            jest.spyOn(delegate, "fetchAvailableRoles").mockResolvedValueOnce(["admin", "viewer"]);
            const result = await authDelegate.admin.fetchAvailableRoles!();
            expect(mockDb.transaction).not.toHaveBeenCalled();
            expect(result).toEqual(["admin", "viewer"]);
        });

        it("should delegate fetchCurrentDatabase via admin without a transaction", async () => {
            jest.spyOn(delegate, "fetchCurrentDatabase").mockResolvedValueOnce("my_db");
            const result = await authDelegate.admin.fetchCurrentDatabase!();
            expect(mockDb.transaction).not.toHaveBeenCalled();
            expect(result).toBe("my_db");
        });

        it("should delegate fetchUnmappedTables via admin without a transaction", async () => {
            jest.spyOn(delegate, "fetchUnmappedTables").mockResolvedValueOnce(["orphan_table"]);
            const result = await authDelegate.admin.fetchUnmappedTables!(["mapped"]);
            expect(mockDb.transaction).not.toHaveBeenCalled();
            expect(result).toEqual(["orphan_table"]);
        });

        it("should delegate fetchTableMetadata via admin without a transaction", async () => {
            jest.spyOn(delegate, "fetchTableMetadata").mockResolvedValueOnce([{ name: "id",
type: "int4" }] as unknown as Record<string, unknown>[]);
            const result = await authDelegate.admin.fetchTableMetadata!("users");
            expect(mockDb.transaction).not.toHaveBeenCalled();
            expect(result).toEqual([{ name: "id",
type: "int4" }]);
        });
    });

    describe("AuthenticatedPostgresBackendDriver Security & Contract", () => {
        it("should use parameterized queries (drizzle sql``) NOT string interpolation for set_config", async () => {
            // A malicious uid should be passed as a parameter, not concatenated
            const maliciousUser: MockUser = { uid: "admin'; DROP TABLE users; --",
email: "hacker@evil.com" };
            const authDelegate = await delegate.withAuth(maliciousUser);

            const mockTx: MockTx = { execute: jest.fn() };
            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                return await cb(mockTx);
            });

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "x",
collection: { slug: "x",
properties: {} } as unknown as CollectionConfig });

            // Compile the SQL object the way the pg driver does, rather than
            // stringifying it. A fully interpolated sql.raw() statement ALSO
            // yields an object with `queryChunks` whose JSON contains both
            // "set_config" and the uid, so the old assertions passed just as
            // happily on a query that concatenated the uid straight into the
            // statement text. Splitting the compiled text from the compiled
            // params is what tells the two apart.
            const { sql: text, params } = new PgDialect().sqlToQuery(mockTx.execute.mock.calls[0][0]);

            expect(text).toContain("set_config('app.uid'");
            // The uid reaches Postgres as a bound parameter only — it must not
            // appear anywhere in the statement text.
            expect(text).not.toContain("DROP TABLE");
            expect(text).not.toContain(maliciousUser.uid);
            expect(text).toMatch(/set_config\('app\.uid', \$\d+, true\)/);
            expect(params).toContain(maliciousUser.uid);
        });

        it("should produce a valid JWT payload in set_config even with exotic roles", async () => {
            const user: MockUser = { uid: "u1",
roles: ['role"with"quotes', "role,with,commas", "rôle-spécial"] };
            const authDelegate = await delegate.withAuth(user);

            const mockTx: MockTx = { execute: jest.fn() };
            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                return await cb(mockTx);
            });

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "x",
collection: { slug: "x",
properties: {} } as unknown as CollectionConfig });

            const serialized = JSON.stringify(mockTx.execute.mock.calls[0][0]);
            // The JWT should be valid JSON.stringify output containing the roles
            expect(serialized).toContain('role\\"with\\"quotes');
            expect(serialized).toContain("rôle-spécial");
        });

        it("should handle role objects missing the id field by falling back to String()", async () => {
            const user: MockUser = { uid: "u1",
roles: [{ name: "viewer" }, 42, null] };
            const authDelegate = await delegate.withAuth(user);

            const mockTx: MockTx = { execute: jest.fn() };
            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                return await cb(mockTx);
            });

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "x",
collection: { slug: "x",
properties: {} } as unknown as CollectionConfig });

            const { params } = new PgDialect().sqlToQuery(mockTx.execute.mock.calls[0][0]);

            // The point of the fallback is that `app.user_roles` is always a
            // comma-joined string of scalars, never `undefined` — a role that is
            // neither a string nor an `{ id }` must still normalize to something,
            // because `normalizedRoles.join(",")` on an `undefined` entry yields
            // an empty slot and silently drops the role from every `auth.roles()`
            // check. Objects without `id` → "[object Object]", 42 → "42",
            // null → "null" (the `?.` short-circuits before `String()` sees it).
            //
            // Found by shape rather than by index. These used to be
            // `params[2]` and `params[3]`, which broke the moment a fifth GUC
            // was added between them — a test that fails because a neighbour
            // moved is a test about the neighbour.
            expect(params).toContain("[object Object],42,null");
            // The JWT keeps the ORIGINAL role values, not the normalized ones —
            // `auth.jwt()` is meant to reflect what the caller presented.
            const claims = params.find(
                (p): p is string => typeof p === "string" && p.startsWith("{")
            );
            expect(JSON.parse(claims!)).toMatchObject({
                sub: "u1",
                roles: [{ name: "viewer" }, 42, null]
            });
        });

        it("should wrap delete in a transaction with RLS", async () => {
            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                return await cb({ execute: jest.fn() });
            });
            jest.spyOn(PostgresBackendDriver.prototype, "delete").mockResolvedValueOnce(undefined);

            const authDelegate = await delegate.withAuth({ uid: "deleter",
email: "del@test.com" } as MockUser);
            await authDelegate.delete({ row: { id: "1",
path: "x",
values: {} } as unknown as Entity });

            expect(mockDb.transaction).toHaveBeenCalled();
        });

        it("should wrap checkUniqueField in a transaction with RLS", async () => {
            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                return await cb({ execute: jest.fn() });
            });
            jest.spyOn(PostgresBackendDriver.prototype, "checkUniqueField").mockResolvedValueOnce(true);

            const authDelegate = await delegate.withAuth({ uid: "checker",
email: "c@test.com" } as MockUser);
            const result = await authDelegate.checkUniqueField("path", "email", "test@x.com", "1");

            expect(mockDb.transaction).toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it("should wrap count in a transaction with RLS", async () => {
            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => {
                return await cb({ execute: jest.fn() });
            });
            jest.spyOn(PostgresBackendDriver.prototype, "count").mockResolvedValueOnce(42);

            const authDelegate = await delegate.withAuth({ uid: "counter",
email: "c@test.com" } as MockUser);
            const result = await authDelegate.count({ path: "items",
collection: {} as unknown as CollectionConfig });

            expect(mockDb.transaction).toHaveBeenCalled();
            expect(result).toBe(42);
        });

        it('should expose key="postgres" and initialised=true on the authenticated wrapper', async () => {
            const authDelegate = await delegate.withAuth({ uid: "u",
email: "u@t.com" } as MockUser);
            expect(authDelegate.key).toBe("postgres");
            expect(authDelegate.initialised).toBe(true);
        });

        it("should NOT share user state if withAuth is called with different users", async () => {
            const auth1 = await delegate.withAuth({ uid: "alice",
email: "a@t.com" } as MockUser);
            const auth2 = await delegate.withAuth({ uid: "bob",
email: "b@t.com" } as MockUser);

            expect(auth1.user.uid).toBe("alice");
            expect(auth2.user.uid).toBe("bob");
            // They share the same underlying delegate
            expect(auth1.delegate).toBe(auth2.delegate);
        });

        it("should create a fresh pendingNotifications array per withTransaction call (no accumulation)", async () => {
            const authDelegate = await delegate.withAuth({ uid: "u1",
email: "u@t.com" } as MockUser);
            const mockTx = { execute: jest.fn() };

            (mockDb.transaction as jest.Mock).mockImplementation(async (cb) => await cb(mockTx));

            jest.spyOn(PostgresBackendDriver.prototype, "save")
                .mockImplementationOnce(async function(this: { _pendingNotifications?: Array<Record<string, unknown>> }) {
                    this._pendingNotifications?.push({ path: "call-1",
id: "1",
row: {} as unknown as Record<string, unknown> });
                    return {} as unknown as Entity;
                })
                .mockImplementationOnce(async function(this: { _pendingNotifications?: Array<Record<string, unknown>> }) {
                    this._pendingNotifications?.push({ path: "call-2",
id: "2",
row: {} as unknown as Record<string, unknown> });
                    return {} as unknown as Entity;
                });

            await authDelegate.save({ path: "call-1",
id: "1",
values: {},
collection: {} as unknown as CollectionConfig,
status: "new" });
            await authDelegate.save({ path: "call-2",
id: "2",
values: {},
collection: {} as unknown as CollectionConfig,
status: "new" });

            // Each call should have flushed exactly 1 notification, not accumulated
            expect(mockRealtimeService.notifyUpdate).toHaveBeenCalledTimes(2);
            expect(mockRealtimeService.notifyUpdate).toHaveBeenNthCalledWith(1, "call-1", "1", {}, undefined);
            expect(mockRealtimeService.notifyUpdate).toHaveBeenNthCalledWith(2, "call-2", "2", {}, undefined);
        });
    });

    describe("PostgresBackendDriver Admin operations", () => {
        it("fetchAvailableRoles should query roles filtered by current user membership", async () => {
            const executeSqlSpy = jest.spyOn(delegate, "executeSql").mockResolvedValueOnce([
                { rolname: "demo" },
                { rolname: "cloudsqlsuperuser" }
            ]);

            const result = await delegate.fetchAvailableRoles();

            expect(executeSqlSpy).toHaveBeenCalledWith(
                "SELECT rolname FROM pg_roles WHERE pg_has_role(current_user, rolname, 'member') ORDER BY rolname;"
            );
            expect(result).toEqual(["demo", "cloudsqlsuperuser"]);
            executeSqlSpy.mockRestore();
        });

        it("fetchApplicationRoles should read the users table, not pg_roles", async () => {
            const executeSqlSpy = jest.spyOn(delegate, "executeSql")
                .mockResolvedValueOnce([{ table_schema: "rebase",
table_name: "users" }])
                .mockResolvedValueOnce([{ role: "admin" }, { role: "editor" }]);

            const result = await delegate.fetchApplicationRoles();

            // Application roles come from assignments on the users table.
            // Sourcing them from pg_roles yields database roles, which can
            // never satisfy the auth.roles() condition a policy compiles to.
            const [locateSql] = executeSqlSpy.mock.calls[0];
            expect(locateSql).toContain("information_schema.columns");
            const [rolesSql] = executeSqlSpy.mock.calls[1];
            expect(rolesSql).toContain("unnest(roles)");
            expect(rolesSql).toContain("\"rebase\".\"users\"");
            expect(rolesSql).not.toContain("pg_roles");
            expect(result).toEqual(["admin", "editor"]);
            executeSqlSpy.mockRestore();
        });

        it("fetchApplicationRoles returns empty when no users table is present", async () => {
            const executeSqlSpy = jest.spyOn(delegate, "executeSql").mockResolvedValueOnce([]);

            expect(await delegate.fetchApplicationRoles()).toEqual([]);
            // Must not go on to query a table it did not find.
            expect(executeSqlSpy).toHaveBeenCalledTimes(1);
            executeSqlSpy.mockRestore();
        });
    });

    describe("storageSource in Callbacks", () => {
        it("should inject storageSource: client.storage into contextForCallback in fetchCollection", async () => {
            const mockStorage = { key: "mockStorage" };
            delegate.client = {
                storage: mockStorage
            } as any;

            const afterReadSpy = jest.fn().mockImplementation(async ({ entity }) => entity);
            const mockCollectionWithCallback = {
                slug: "test_coll",
                callbacks: {
                    afterRead: afterReadSpy
                }
            } as any;

            jest.spyOn(delegate.dataService, "fetchCollection").mockResolvedValueOnce([
                { id: "e1",
path: "test_coll",
values: {} } as any
            ]);

            await delegate.fetchCollection({
                path: "test_coll",
                collection: mockCollectionWithCallback
            });

            expect(afterReadSpy).toHaveBeenCalled();
            const callArgs = afterReadSpy.mock.calls[0][0];
            expect(callArgs.context).toBeDefined();
            expect(callArgs.context.storageSource).toBe(mockStorage);
        });

        it("should inject storageSource in fetchOne", async () => {
            const mockStorage = { key: "mockStorage" };
            delegate.client = {
                storage: mockStorage
            } as any;

            const afterReadSpy = jest.fn().mockImplementation(async ({ entity }) => entity);
            const mockCollectionWithCallback = {
                slug: "test_coll",
                callbacks: {
                    afterRead: afterReadSpy
                }
            } as any;

            jest.spyOn(delegate.dataService, "fetchOne").mockResolvedValueOnce(
                { id: "e1",
path: "test_coll",
values: {} } as any
            );

            await delegate.fetchOne({
                path: "test_coll",
                id: "e1",
                collection: mockCollectionWithCallback
            });

            expect(afterReadSpy).toHaveBeenCalled();
            const callArgs = afterReadSpy.mock.calls[0][0];
            expect(callArgs.context.storageSource).toBe(mockStorage);
        });

        it("should inject storageSource in save beforeSave and afterSave", async () => {
            const mockStorage = { key: "mockStorage" };
            delegate.client = {
                storage: mockStorage
            } as any;

            const beforeSaveSpy = jest.fn().mockImplementation(async ({ values }) => values);
            const afterSaveSpy = jest.fn();
            const mockCollectionWithCallback = {
                slug: "test_coll",
                callbacks: {
                    beforeSave: beforeSaveSpy,
                    afterSave: afterSaveSpy
                }
            } as any;

            jest.spyOn(delegate.dataService, "fetchOne").mockResolvedValue(undefined);
            jest.spyOn(delegate.dataService, "save").mockResolvedValueOnce(
                { id: "e1",
path: "test_coll",
values: { name: "test" } } as any
            );

            await delegate.save({
                path: "test_coll",
                id: "e1",
                values: { name: "test" },
                collection: mockCollectionWithCallback,
                status: "existing"
            });

            expect(beforeSaveSpy).toHaveBeenCalled();
            expect(beforeSaveSpy.mock.calls[0][0].context.storageSource).toBe(mockStorage);
            expect(afterSaveSpy).toHaveBeenCalled();
            expect(afterSaveSpy.mock.calls[0][0].context.storageSource).toBe(mockStorage);
        });

        it("should inject storageSource in delete beforeDelete and afterDelete", async () => {
            const mockStorage = { key: "mockStorage" };
            delegate.client = {
                storage: mockStorage
            } as any;

            const beforeDeleteSpy = jest.fn().mockImplementation(async () => true);
            const afterDeleteSpy = jest.fn();
            const mockCollectionWithCallback = {
                slug: "test_coll",
                callbacks: {
                    beforeDelete: beforeDeleteSpy,
                    afterDelete: afterDeleteSpy
                }
            } as any;

            jest.spyOn(delegate.dataService, "delete").mockResolvedValueOnce();

            await delegate.delete({
                row: { id: "e1",
path: "test_coll",
values: {} } as any,
                collection: mockCollectionWithCallback
            });

            expect(beforeDeleteSpy).toHaveBeenCalled();
            expect(beforeDeleteSpy.mock.calls[0][0].context.storageSource).toBe(mockStorage);
            expect(afterDeleteSpy).toHaveBeenCalled();
            expect(afterDeleteSpy.mock.calls[0][0].context.storageSource).toBe(mockStorage);
        });
    });
});

