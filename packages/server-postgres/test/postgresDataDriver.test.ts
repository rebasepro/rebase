
import { describe, it, expect, beforeEach } from "@jest/globals";
import { AuthenticatedPostgresBackendDriver, PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { isSQLAdmin, type PostgresCollectionConfig, type RebaseServerClient, type User } from "@rebasepro/types";
import { recordingDb, type RecordedQuery } from "./helpers/spg-b-recording-db";
import { tableMetadata, testUser } from "./helpers/spg-b-fixtures";

const collection = (slug: string, extra: Partial<PostgresCollectionConfig> = {}): PostgresCollectionConfig => ({
    slug,
    name: slug,
    properties: {},
    ...extra
});

/** The statement that hands Postgres the caller's identity. */
const authStatement = (statements: RecordedQuery[]): RecordedQuery => {
    const found = statements.find(q => q.text.includes("set_config"));
    if (!found) throw new Error(`no set_config statement among ${JSON.stringify(statements.map(q => q.text))}`);
    return found;
};

describe("PostgresBackendDriver", () => {
    let rec: ReturnType<typeof recordingDb>;
    let realtime: RealtimeService;
    let registry: PostgresCollectionRegistry;
    let delegate: PostgresBackendDriver;

    const authed = async (user: User): Promise<AuthenticatedPostgresBackendDriver> => {
        const driver = await delegate.withAuth(user);
        if (!(driver instanceof AuthenticatedPostgresBackendDriver)) throw new Error("withAuth did not return an authenticated driver");
        return driver;
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        rec = recordingDb();
        registry = new PostgresCollectionRegistry([collection("test_coll")]);
        realtime = new RealtimeService(rec.db, registry);
        jest.spyOn(realtime, "notifyUpdate").mockResolvedValue(undefined);
        jest.spyOn(realtime, "startDataDriverSubscription").mockImplementation(() => undefined);
        jest.spyOn(rec.db, "transaction");
        delegate = new PostgresBackendDriver(rec.db, realtime, registry);
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

        const maskEmail = (e: unknown) => {
            if (typeof e !== "string") return e;
            const [l, d] = e.split("@");
            return l && d ? `${l[0]}***@${d}` : e;
        };
        const masking = (slug: string, extra: Partial<PostgresCollectionConfig> = {}) => collection(slug, {
            callbacks: { afterRead: ({ row }) => ({ ...row, email: maskEmail(row.email) }) },
            ...extra
        });

        function buildDriver(collections: PostgresCollectionConfig[]) {
            const driver = new PostgresBackendDriver(rec.db, realtime, new PostgresCollectionRegistry(collections));
            return { driver, fetch: driver.dataService.getFetchService() };
        }

        it("masks rows from fetchCollectionForRest", async () => {
            const { driver, fetch } = buildDriver([masking("customers")]);
            jest.spyOn(fetch, "fetchCollectionForRest").mockResolvedValue([{ id: "c1", email: "jane.doe@acme.com" }]);
            const rows = await driver.restFetchService.fetchCollectionForRest("customers", {});
            expect(rows[0].email).toBe("j***@acme.com");
        });

        it("masks the single row from fetchOneForRest", async () => {
            const { driver, fetch } = buildDriver([masking("customers")]);
            jest.spyOn(fetch, "fetchOneForRest").mockResolvedValue({ id: "c1", email: "jane.doe@acme.com" });
            const row = await driver.restFetchService.fetchOneForRest("customers", "c1");
            expect(row?.email).toBe("j***@acme.com");
        });

        it("masks embedded relation data using the TARGET collection's afterRead", async () => {
            const authors = masking("authors");
            const posts = collection("posts", {
                relations: [{ kind: "belongsTo", relationName: "author", localKey: "author_id", target: () => authors }]
            });
            const { driver, fetch } = buildDriver([posts, authors]);
            jest.spyOn(fetch, "fetchCollectionForRest").mockResolvedValue(
                [{ id: "p1", title: "Hello", author: { id: "a1", email: "sam@acme.com" } }]
            );
            const rows = await driver.restFetchService.fetchCollectionForRest("posts", {}, ["author"]);
            expect(rows[0].author).toMatchObject({ email: "s***@acme.com" });
        });

        it("leaves data untouched when no afterRead is defined", async () => {
            const { driver, fetch } = buildDriver([collection("plain")]);
            jest.spyOn(fetch, "fetchCollectionForRest").mockResolvedValue([{ id: "x1", email: "raw@acme.com" }]);
            const rows = await driver.restFetchService.fetchCollectionForRest("plain", {});
            expect(rows[0].email).toBe("raw@acme.com");
        });
    });

    describe("withAuth", () => {
        it("should return a new delegate instance", async () => {
            const authDelegate = await delegate.withAuth(testUser({ uid: "test-user", email: "test@example.com" }));

            expect(authDelegate).toBeDefined();
            expect(authDelegate).not.toBe(delegate);
        });

        it("should wrap methods in a transaction", async () => {
            const authDelegate = await authed(testUser({ uid: "test-user", email: "test@example.com" }));

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "test_collection", collection: collection("test") });

            expect(rec.db.transaction).toHaveBeenCalled();
        });

        it("should set app.user_id in the transaction for RLS", async () => {
            const authDelegate = await authed(testUser({ uid: "test-user-123", email: "test@example.com" }));

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "test", collection: collection("test") });

            expect(rec.db.transaction).toHaveBeenCalled();
            const statement = authStatement(rec.statements());
            expect(statement.text).toContain("set_config");
            expect(statement.values).toContain("test-user-123");
        });

        it("should set app.user_roles handling array of strings correctly", async () => {
            const authDelegate = await authed(testUser({ uid: "test-user-123", email: "test@example.com", roles: ["admin", "editor"] }));

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "test", collection: collection("test") });

            expect(rec.statements()).toHaveLength(1);
            const statement = authStatement(rec.statements());
            expect(statement.text).toContain("set_config");
            expect(statement.values).toContain("admin,editor");
        });

        it("should set app.user_roles handling array of objects correctly", async () => {
            // Deliberately invalid: `roles` is `string[]`, and the normalisation under test accepts `{ id }` objects too.
            const user = { ...testUser({ uid: "test-user-123", email: "test@example.com" }), roles: [{ id: "admin" }, { id: "editor" }] } as unknown as User;
            const authDelegate = await authed(user);

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "test", collection: collection("test") });

            expect(rec.statements()).toHaveLength(1);
            const statement = authStatement(rec.statements());
            expect(statement.text).toContain("set_config");
            expect(statement.values).toContain("admin,editor");
        });

        it("should fallback to anonymous and empty roles when missing from user", async () => {
            // Deliberately invalid: an empty object where a `User` belongs, which the driver must read as anonymous.
            const authDelegate = await authed({} as User);

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "test", collection: collection("test") });

            expect(rec.db.transaction).toHaveBeenCalledTimes(1);
            const statement = authStatement(rec.statements());
            expect(statement.text).toContain("set_config");
            expect(statement.values).toContain("anonymous");
        });

        it("should gracefully handle completely null or undefined user objects", async () => {
            // Deliberately invalid: `null` where a `User` belongs, which the driver must read as anonymous.
            const authDelegate = await authed(null as unknown as User);

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "test", collection: collection("test") });

            const statement = authStatement(rec.statements());
            expect(statement.text).toContain("set_config");
            expect(statement.values).toContain("anonymous");
        });
    });

    describe("AuthenticatedPostgresBackendDriver Transactional Integrity", () => {
        let authDelegate: AuthenticatedPostgresBackendDriver;

        beforeEach(async () => {
            authDelegate = await authed(testUser({ uid: "test-user", email: "test@example.com" }));
        });

        it("should execute operation and flush notifications on success", async () => {
            // Let's pretend the operation queues a notification
            jest.spyOn(PostgresBackendDriver.prototype, "save").mockImplementationOnce(async function(this: PostgresBackendDriver) {
                this._pendingNotifications?.push({
                    path: "test",
                    id: "123",
                    row: {}
                });
                return {};
            });

            await authDelegate.save({ path: "test", id: "123", values: {}, collection: collection("test"), status: "new" });

            // Ensure transaction was called
            expect(rec.db.transaction).toHaveBeenCalled();

            // Ensure notification was flushed after commit
            expect(realtime.notifyUpdate).toHaveBeenCalledWith("test", "123", {}, undefined);
        });

        it("should NOT flush notifications if transaction throws an error", async () => {
            jest.spyOn(PostgresBackendDriver.prototype, "save").mockImplementationOnce(async function(this: PostgresBackendDriver) {
                this._pendingNotifications?.push({
                    path: "test",
                    id: "123",
                    row: {}
                });
                throw new Error("Transaction failed");
            });

            await expect(authDelegate.save({ path: "test", id: "123", values: {}, collection: collection("test"), status: "new" }))
                .rejects.toThrow("Transaction failed");

            // Ensure notification was NOT flushed
            expect(realtime.notifyUpdate).not.toHaveBeenCalled();
        });

        it("should return successfully even if a deferred notification throw an error (resilience)", async () => {
            jest.spyOn(PostgresBackendDriver.prototype, "save").mockImplementationOnce(async function(this: PostgresBackendDriver) {
                this._pendingNotifications?.push({
                    path: "test",
                    id: "buggy-123",
                    row: {}
                });
                return { id: "success" };
            });

            // Mock the notification service intentionally crashing
            const notifySpy = jest.spyOn(realtime, "notifyUpdate").mockRejectedValueOnce(new Error("Network Failure on Notification"));

            // Should still return the entity successfully despite the error
            const result = await authDelegate.save({ path: "test", id: "buggy-123", values: {}, collection: collection("test"), status: "new" });

            expect(result).toEqual({ id: "success" });
            expect(notifySpy).toHaveBeenCalledWith("test", "buggy-123", {}, undefined);
        });

        it("should safely isolate completely concurrent transaction notifications from leaking across scopes", async () => {
            // Operation 1 flags a notification
            jest.spyOn(PostgresBackendDriver.prototype, "save").mockImplementationOnce(async function(this: PostgresBackendDriver) {
                await new Promise(r => setTimeout(r, 10));
                this._pendingNotifications?.push({ path: "scope-1", id: "1", row: {} });
                return {};
            });

            // Operation 2 flags a different notification
            jest.spyOn(PostgresBackendDriver.prototype, "save").mockImplementationOnce(async function(this: PostgresBackendDriver) {
                this._pendingNotifications?.push({ path: "scope-2", id: "2", row: {} });
                return {};
            });

            // Fire simultaneously
            await Promise.all([
                authDelegate.save({ path: "scope-1", id: "1", values: {}, collection: collection("test"), status: "new" }),
                authDelegate.save({ path: "scope-2", id: "2", values: {}, collection: collection("test"), status: "new" })
            ]);

            // Ensure our notify was called with both exact combinations, but NOT cross-pollinated
            expect(realtime.notifyUpdate).toHaveBeenCalledWith("scope-1", "1", {}, undefined);
            expect(realtime.notifyUpdate).toHaveBeenCalledWith("scope-2", "2", {}, undefined);

            // Check count
            expect(realtime.notifyUpdate).toHaveBeenCalledTimes(2);
        });
    });

    describe("AuthenticatedPostgresBackendDriver Delegation", () => {
        let authDelegate: AuthenticatedPostgresBackendDriver;

        beforeEach(async () => {
            authDelegate = await authed(testUser({ uid: "test-user", email: "test@example.com" }));
        });

        it("should delegate executeSql via admin without a transaction", async () => {
            jest.spyOn(delegate, "executeSql").mockResolvedValueOnce([{ id: 1 }]);

            const admin = authDelegate.admin;
            if (!isSQLAdmin(admin)) throw new Error("the authenticated driver's admin runs no SQL");
            const result = await admin.executeSql("SELECT 1");

            expect(rec.db.transaction).not.toHaveBeenCalled();
            expect(delegate.executeSql).toHaveBeenCalledWith("SELECT 1");
            expect(result).toEqual([{ id: 1 }]);
        });

        // The user's identity goes in WITH the listener, so the first read runs
        // as them. It used to be stamped onto the last registered subscription
        // after the delegate returned, by which time that read had been issued
        // on the owner connection. The e2e proof is
        // `test/e2e/listener-first-fetch-e2e.test.ts`.
        describe("listening", () => {
            const onUpdate = () => undefined;

            it("hands the delegate its user's identity with a collection listener", () => {
                const mockUnsubscribe = jest.fn();
                const listen = jest.spyOn(delegate, "listenCollection").mockImplementationOnce(() => mockUnsubscribe);
                const props = { path: "test", onUpdate };

                const unsub = authDelegate.listenCollection(props);

                expect(unsub).toBe(mockUnsubscribe);
                expect(listen).toHaveBeenCalledWith(props, { uid: "test-user", roles: [], isAnonymous: false });
            });

            it("hands the delegate its user's identity with a row listener", () => {
                const mockUnsubscribe = jest.fn();
                const listen = jest.spyOn(delegate, "listenOne").mockImplementationOnce(() => mockUnsubscribe);
                const props = { path: "test", id: "123", onUpdate };

                const unsub = authDelegate.listenOne(props);

                expect(unsub).toBe(mockUnsubscribe);
                expect(listen).toHaveBeenCalledWith(props, { uid: "test-user", roles: [], isAnonymous: false });
            });

            it("carries a guest's isAnonymous and its token's claims", async () => {
                // The hand-built copy this replaced dropped `isAnonymous`, so a
                // guest's refetches were read as an account's.
                const guest = await authed(testUser({
                    uid: "guest-1",
                    roles: ["member"],
                    isAnonymous: true,
                    claims: { org_id: "org-9" }
                }));
                const listen = jest.spyOn(delegate, "listenCollection").mockImplementationOnce(() => jest.fn());

                guest.listenCollection({ path: "test", onUpdate });

                expect(listen).toHaveBeenCalledWith(expect.anything(), {
                    uid: "guest-1",
                    roles: ["member"],
                    isAnonymous: true,
                    claims: { org_id: "org-9" }
                });
            });

            it("writes its identity into no other subscription", () => {
                // What the stamping it replaced had to be guarded against: a
                // websocket session belonging to another user sitting last in
                // the map, and reading as this user from then on.
                realtime.subscribeToCollection("sub-ext", { clientId: "external-client", path: "test_coll" });

                authDelegate.listenCollection({ path: "test", onUpdate });

                const external = realtime.subscriptions.get("sub-ext");
                expect(external).toBeDefined();
                expect(external?.authContext).toBeUndefined();
            });

            it("starts the subscription with the realtime service as the user", () => {
                authDelegate.listenOne({ path: "test", id: "123", onUpdate });

                expect(realtime.startDataDriverSubscription).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        type: "single",
                        path: "test",
                        id: "123",
                        authContext: { uid: "test-user", roles: [], isAnonymous: false }
                    }),
                    expect.any(Function)
                );
            });

            it("starts a listener on the base driver with no identity", () => {
                // Read as the anonymous user by the realtime service, first
                // fetch and refetches alike.
                delegate.listenCollection({ path: "test", onUpdate });

                expect(realtime.startDataDriverSubscription).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({ type: "collection", authContext: undefined }),
                    expect.any(Function)
                );
            });

            it("starts a listener on a driver bound to a request as that request's user", () => {
                // What `context.data` is inside a collection callback: a base
                // driver constructed with the request's user. It used to
                // subscribe with no identity, so its refetches read as the
                // anonymous user.
                const bound = new PostgresBackendDriver(rec.db, realtime, delegate.registry,
                    testUser({ uid: "u-7", roles: ["editor"], isAnonymous: false }));

                bound.listenCollection({ path: "test", onUpdate });

                expect(realtime.startDataDriverSubscription).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({ authContext: { uid: "u-7", roles: ["editor"], isAnonymous: false } }),
                    expect.any(Function)
                );
            });

            it("stores the whole query with the subscription", () => {
                // Hand-listed, it named nine fields and dropped `logical`, so an
                // `or(...)` listener was handed every row.
                const startSubscription = jest.spyOn(realtime, "startDataDriverSubscription");
                const logical = { type: "or" as const, conditions: [{ column: "title", operator: "==" as const, value: "a" }] };
                delegate.listenCollection({
                    path: "test",
                    collection: collection("test", { databaseId: "db-2" }),
                    filter: { done: ["==", false] },
                    logical,
                    orderBy: "title",
                    order: "asc",
                    limit: 5,
                    offset: 10,
                    startAfter: { title: "m" },
                    searchString: "report",
                    searchExplain: true,
                    include: { author: true },
                    fields: ["id", "title"],
                    distinct: true,
                    onUpdate
                });

                const [, request] = startSubscription.mock.calls[0];
                if (request.type !== "collection") throw new Error(`expected a collection subscription, got ${request.type}`);
                expect(request.collectionRequest).toEqual({
                    filter: { done: ["==", false] },
                    logical,
                    orderBy: "title",
                    order: "asc",
                    limit: 5,
                    offset: 10,
                    startAfter: { title: "m" },
                    searchString: "report",
                    searchExplain: true,
                    include: { author: true },
                    fields: ["id", "title"],
                    distinct: true,
                    databaseId: "db-2"
                });
            });

            it("passes a row listener's null on", () => {
                // How a listener learns its row is gone. It used to be dropped.
                const startSubscription = jest.spyOn(realtime, "startDataDriverSubscription");
                const heard: unknown[] = [];
                delegate.listenOne({ path: "test", id: "123", onUpdate: (row) => heard.push(row) });

                const [, , deliver] = startSubscription.mock.calls[0];
                deliver({ id: "123" });
                deliver(null);

                expect(heard).toEqual([{ id: "123" }, null]);
            });
        });

        it("should delegate fetchAvailableDatabases via admin without a transaction", async () => {
            jest.spyOn(delegate, "fetchAvailableDatabases").mockResolvedValueOnce(["db1", "db2"]);
            const result = await authDelegate.admin.fetchAvailableDatabases!();
            expect(rec.db.transaction).not.toHaveBeenCalled();
            expect(result).toEqual(["db1", "db2"]);
        });

        it("should delegate fetchAvailableRoles via admin without a transaction", async () => {
            jest.spyOn(delegate, "fetchAvailableRoles").mockResolvedValueOnce(["admin", "viewer"]);
            const result = await authDelegate.admin.fetchAvailableRoles!();
            expect(rec.db.transaction).not.toHaveBeenCalled();
            expect(result).toEqual(["admin", "viewer"]);
        });

        it("should delegate fetchCurrentDatabase via admin without a transaction", async () => {
            jest.spyOn(delegate, "fetchCurrentDatabase").mockResolvedValueOnce("my_db");
            const result = await authDelegate.admin.fetchCurrentDatabase!();
            expect(rec.db.transaction).not.toHaveBeenCalled();
            expect(result).toBe("my_db");
        });

        it("should delegate fetchUnmappedTables via admin without a transaction", async () => {
            jest.spyOn(delegate, "fetchUnmappedTables").mockResolvedValueOnce(["orphan_table"]);
            const result = await authDelegate.admin.fetchUnmappedTables!(["mapped"]);
            expect(rec.db.transaction).not.toHaveBeenCalled();
            expect(result).toEqual(["orphan_table"]);
        });

        it("should delegate fetchTableMetadata via admin without a transaction", async () => {
            const metadata = tableMetadata([{
                column_name: "id", data_type: "integer", udt_name: "int4", is_nullable: "NO", column_default: null, character_maximum_length: null
            }]);
            jest.spyOn(delegate, "fetchTableMetadata").mockResolvedValueOnce(metadata);
            const result = await authDelegate.admin.fetchTableMetadata!("users");
            expect(rec.db.transaction).not.toHaveBeenCalled();
            expect(result).toEqual(metadata);
        });
    });

    describe("AuthenticatedPostgresBackendDriver Security & Contract", () => {
        it("should use parameterized queries (drizzle sql``) NOT string interpolation for set_config", async () => {
            // A malicious uid should be passed as a parameter, not concatenated
            const maliciousUser = testUser({ uid: "admin'; DROP TABLE users; --", email: "hacker@evil.com" });
            const authDelegate = await authed(maliciousUser);

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "x", collection: collection("x") });

            // The text and the parameters pg was handed, apart. A fully
            // interpolated sql.raw() statement ALSO contains both "set_config"
            // and the uid somewhere, so asserting on the statement as a whole
            // would pass just as happily on a query that concatenated the uid
            // straight into the statement text. Splitting the text from the
            // params is what tells the two apart.
            const { text, values } = authStatement(rec.statements());

            expect(text).toContain("set_config('app.uid'");
            // The uid reaches Postgres as a bound parameter only — it must not
            // appear anywhere in the statement text.
            expect(text).not.toContain("DROP TABLE");
            expect(text).not.toContain(maliciousUser.uid);
            expect(text).toMatch(/set_config\('app\.uid', \$\d+, true\)/);
            expect(values).toContain(maliciousUser.uid);
        });

        it("should produce a valid JWT payload in set_config even with exotic roles", async () => {
            const authDelegate = await authed(testUser({ uid: "u1", roles: ['role"with"quotes', "role,with,commas", "rôle-spécial"] }));

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "x", collection: collection("x") });

            const { values } = authStatement(rec.statements());
            const claims = values.find((p): p is string => typeof p === "string" && p.startsWith("{"));
            // The JWT should be valid JSON.stringify output containing the roles
            expect(claims).toContain('role\\"with\\"quotes');
            expect(claims).toContain("rôle-spécial");
            expect(JSON.parse(claims ?? "null")).toMatchObject({ roles: ['role"with"quotes', "role,with,commas", "rôle-spécial"] });
        });

        it("should handle role objects missing the id field by falling back to String()", async () => {
            // Deliberately invalid: `roles` is `string[]`, and the fallback under test handles whatever else arrives.
            const user = { ...testUser({ uid: "u1" }), roles: [{ name: "viewer" }, 42, null] } as unknown as User;
            const authDelegate = await authed(user);

            jest.spyOn(PostgresBackendDriver.prototype, "fetchCollection").mockResolvedValueOnce([]);

            await authDelegate.fetchCollection({ path: "x", collection: collection("x") });

            const { values: params } = authStatement(rec.statements());

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
            expect(JSON.parse(claims ?? "null")).toMatchObject({
                sub: "u1",
                roles: [{ name: "viewer" }, 42, null]
            });
        });

        it("should wrap delete in a transaction with RLS", async () => {
            jest.spyOn(PostgresBackendDriver.prototype, "delete").mockResolvedValueOnce(undefined);

            const authDelegate = await authed(testUser({ uid: "deleter", email: "del@test.com" }));
            await authDelegate.delete({ row: { id: "1", path: "x" } });

            expect(rec.db.transaction).toHaveBeenCalled();
        });

        it("should wrap checkUniqueField in a transaction with RLS", async () => {
            jest.spyOn(PostgresBackendDriver.prototype, "checkUniqueField").mockResolvedValueOnce(true);

            const authDelegate = await authed(testUser({ uid: "checker", email: "c@test.com" }));
            const result = await authDelegate.checkUniqueField("path", "email", "test@x.com", "1");

            expect(rec.db.transaction).toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it("should wrap count in a transaction with RLS", async () => {
            jest.spyOn(PostgresBackendDriver.prototype, "count").mockResolvedValueOnce(42);

            const authDelegate = await authed(testUser({ uid: "counter", email: "c@test.com" }));
            const result = await authDelegate.count({ path: "items", collection: collection("items") });

            expect(rec.db.transaction).toHaveBeenCalled();
            expect(result).toBe(42);
        });

        it('should expose key="postgres" and initialised=true on the authenticated wrapper', async () => {
            const authDelegate = await authed(testUser({ uid: "u", email: "u@t.com" }));
            expect(authDelegate.key).toBe("postgres");
            expect(authDelegate.initialised).toBe(true);
        });

        it("should NOT share user state if withAuth is called with different users", async () => {
            const auth1 = await authed(testUser({ uid: "alice", email: "a@t.com" }));
            const auth2 = await authed(testUser({ uid: "bob", email: "b@t.com" }));

            expect(auth1.user?.uid).toBe("alice");
            expect(auth2.user?.uid).toBe("bob");
            // They share the same underlying delegate
            expect(auth1.delegate).toBe(auth2.delegate);
        });

        it("should create a fresh pendingNotifications array per withTransaction call (no accumulation)", async () => {
            const authDelegate = await authed(testUser({ uid: "u1", email: "u@t.com" }));

            jest.spyOn(PostgresBackendDriver.prototype, "save")
                .mockImplementationOnce(async function(this: PostgresBackendDriver) {
                    this._pendingNotifications?.push({ path: "call-1", id: "1", row: {} });
                    return {};
                })
                .mockImplementationOnce(async function(this: PostgresBackendDriver) {
                    this._pendingNotifications?.push({ path: "call-2", id: "2", row: {} });
                    return {};
                });

            await authDelegate.save({ path: "call-1", id: "1", values: {}, collection: collection("test"), status: "new" });
            await authDelegate.save({ path: "call-2", id: "2", values: {}, collection: collection("test"), status: "new" });

            // Each call should have flushed exactly 1 notification, not accumulated
            expect(realtime.notifyUpdate).toHaveBeenCalledTimes(2);
            expect(realtime.notifyUpdate).toHaveBeenNthCalledWith(1, "call-1", "1", {}, undefined);
            expect(realtime.notifyUpdate).toHaveBeenNthCalledWith(2, "call-2", "2", {}, undefined);
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
        const mockStorage = { key: "mockStorage" };
        // A `RebaseServerClient` needs auth, email, sql, buckets and an admin
        // SDK; these tests read `client.storage` alone, and server-postgres has
        // no builder for a whole client, so this is the one stand-in.
        const storageOnlyClient = { storage: mockStorage } as unknown as RebaseServerClient;

        beforeEach(() => {
            delegate.client = storageOnlyClient;
        });

        it("should inject storageSource: client.storage into contextForCallback in fetchCollection", async () => {
            const afterReadSpy = jest.fn().mockImplementation(async ({ entity }) => entity);
            const mockCollectionWithCallback = collection("test_coll", { callbacks: { afterRead: afterReadSpy } });

            jest.spyOn(delegate.dataService, "fetchCollection").mockResolvedValueOnce([
                { id: "e1", path: "test_coll", values: {} }
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
            const afterReadSpy = jest.fn().mockImplementation(async ({ entity }) => entity);
            const mockCollectionWithCallback = collection("test_coll", { callbacks: { afterRead: afterReadSpy } });

            jest.spyOn(delegate.dataService, "fetchOne").mockResolvedValueOnce(
                { id: "e1", path: "test_coll", values: {} }
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
            const beforeSaveSpy = jest.fn().mockImplementation(async ({ values }) => values);
            const afterSaveSpy = jest.fn();
            const mockCollectionWithCallback = collection("test_coll", {
                callbacks: { beforeSave: beforeSaveSpy, afterSave: afterSaveSpy }
            });

            jest.spyOn(delegate.dataService, "fetchOne").mockResolvedValue(undefined);
            jest.spyOn(delegate.dataService, "save").mockResolvedValueOnce(
                { id: "e1", path: "test_coll", values: { name: "test" } }
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
            const beforeDeleteSpy = jest.fn().mockImplementation(async () => true);
            const afterDeleteSpy = jest.fn();
            const mockCollectionWithCallback = collection("test_coll", {
                callbacks: { beforeDelete: beforeDeleteSpy, afterDelete: afterDeleteSpy }
            });

            jest.spyOn(delegate.dataService, "fetchOneForRest").mockResolvedValueOnce({ id: "e1" });
            jest.spyOn(delegate.dataService, "delete").mockResolvedValueOnce();

            await delegate.delete({
                row: { id: "e1", path: "test_coll" },
                collection: mockCollectionWithCallback
            });

            expect(beforeDeleteSpy).toHaveBeenCalled();
            expect(beforeDeleteSpy.mock.calls[0][0].context.storageSource).toBe(mockStorage);
            expect(afterDeleteSpy).toHaveBeenCalled();
            expect(afterDeleteSpy.mock.calls[0][0].context.storageSource).toBe(mockStorage);
        });
    });
});
