import React from "react";
import { renderHook } from "@testing-library/react";
import { isBranchAdmin } from "@rebasepro/types";
import { usePostgresClientDriver } from "../src/usePostgresClientDriver";

describe("usePostgresClientDriver hook", () => {
    let mockWsClient: any;

    beforeEach(() => {
        mockWsClient = {
            fetchCollection: jest.fn().mockResolvedValue([{ id: "1",
name: "Entity 1" }]),
            fetchOne: jest.fn().mockResolvedValue({ id: "1",
name: "Entity 1" }),
            save: jest.fn().mockResolvedValue({ id: "1",
name: "Saved Entity" }),
            delete: jest.fn().mockResolvedValue(undefined),
            checkUniqueField: jest.fn().mockResolvedValue(true),
            count: jest.fn().mockResolvedValue(42),
            listenCollection: jest.fn(() => jest.fn()),
            listenOne: jest.fn(() => jest.fn()),
            executeSql: jest.fn().mockResolvedValue([]),
            fetchAvailableDatabases: jest.fn().mockResolvedValue(["db1"]),
            fetchAvailableRoles: jest.fn().mockResolvedValue(["role1"]),
            fetchCurrentDatabase: jest.fn().mockResolvedValue("db1"),
            fetchUnmappedTables: jest.fn().mockResolvedValue([]),
            fetchTableMetadata: jest.fn().mockResolvedValue({}),
            createBranch: jest.fn().mockResolvedValue({ name: "branch1" }),
            deleteBranch: jest.fn().mockResolvedValue(undefined),
            listBranches: jest.fn().mockResolvedValue([]),
            setAuthTokenGetter: jest.fn()
        };
    });

    it("throws error if wsClient is not provided", () => {
        expect(() => {
            renderHook(() => usePostgresClientDriver({} as any));
        }).toThrow("RebaseWebSocketClient must be provided in config.wsClient");
    });

    it("returns active database driver object", () => {
        const { result } = renderHook(() => usePostgresClientDriver({ wsClient: mockWsClient }));

        expect(result.current.key).toBe("postgres");
        expect(result.current.name).toBe("PostgreSQL");
        expect(result.current.client).toBe(mockWsClient);
    });

    it("correctly routes fetchCollection, fetchOne, save, delete", async () => {
        const { result } = renderHook(() => usePostgresClientDriver({ wsClient: mockWsClient }));
        const driver = result.current;

        // fetchCollection
        const list = await driver.fetchCollection({ path: "posts" });
        expect(mockWsClient.fetchCollection).toHaveBeenCalledWith({ path: "posts" });
        expect(list).toEqual([{ id: "1",
name: "Entity 1" }]);

        // fetchOne
        const item = await driver.fetchOne({ path: "posts",
id: "1" });
        expect(mockWsClient.fetchOne).toHaveBeenCalledWith({ path: "posts",
id: "1" });
        expect(item).toEqual({ id: "1",
name: "Entity 1" });

        // save — `status` is a required part of `SaveProps`, so a caller always has one
        const saved = await driver.save({ path: "posts",
values: { name: "Test" },
status: "new" });
        expect(mockWsClient.save).toHaveBeenCalledWith({
            path: "posts",
            values: { name: "Test" },
            status: "new"
        });
        expect(saved).toEqual({ id: "1",
name: "Saved Entity" });

        // delete — a `DeleteProps` row addresses the entity with `id`/`path` and
        // carries its column data under `values`
        await driver.delete({ row: { id: "1",
path: "test",
values: { name: "Test" } } });
        expect(mockWsClient.delete).toHaveBeenCalledWith({ row: { id: "1",
path: "test",
values: { name: "Test" } } });
    });

    it("hands the socket every part of a one-shot read's query", async () => {
        const { result } = renderHook(() => usePostgresClientDriver({ wsClient: mockWsClient }));
        const driver = result.current;

        const logical = {
            type: "or" as const,
            conditions: [{ column: "status", operator: "==" as const, value: "draft" }]
        };
        const vectorSearch = { property: "embedding", vector: [0.1, 0.2] };
        const query = {
            path: "posts",
            filter: { author: ["==", "u1"] as ["==", string] },
            logical,
            limit: 25,
            // The two the hand-written list dropped. `offset` made page two a
            // second copy of page one — beside a `count` that forwards `props`
            // whole, so `hasMore` stayed true and `findAll()`/`iterate()`
            // returned the same page N times and terminated cleanly.
            offset: 50,
            startAfter: ["2024-01-01"],
            orderBy: "created_at",
            order: "desc" as const,
            searchString: "widget",
            searchExplain: true,
            vectorSearch
        };

        await driver.fetchCollection(query);

        // Asserted whole, like the `listenCollection` case below: a field-by-
        // field assertion is exactly what let five fields go missing here while
        // the test stayed green.
        expect(mockWsClient.fetchCollection).toHaveBeenCalledWith(query);
    });

    it("keeps the fields the hand-written lists dropped on the write paths", async () => {
        const { result } = renderHook(() => usePostgresClientDriver({ wsClient: mockWsClient }));
        const driver = result.current;
        const collection = { name: "Posts", properties: {} } as any;

        // `upsert` is what makes a re-runnable import re-runnable; dropping it
        // turns the second run into a duplicate-key error.
        await driver.save({ path: "posts",
values: { name: "Test" },
status: "new",
upsert: true,
collection });
        expect(mockWsClient.save).toHaveBeenCalledWith({
            path: "posts",
            values: { name: "Test" },
            status: "new",
            upsert: true,
            collection
        });

        await driver.delete({ row: { id: "1",
path: "posts" },
collection });
        expect(mockWsClient.delete).toHaveBeenCalledWith({ row: { id: "1",
path: "posts" },
collection });

        await driver.fetchOne({ path: "posts",
id: "1",
databaseId: "branch_a",
collection });
        expect(mockWsClient.fetchOne).toHaveBeenCalledWith({ path: "posts",
id: "1",
databaseId: "branch_a",
collection });

        driver.listenOne!({ path: "posts",
id: "1",
databaseId: "branch_a",
collection,
onUpdate: jest.fn() });
        expect(mockWsClient.listenOne).toHaveBeenCalledWith(
            { path: "posts",
id: "1",
databaseId: "branch_a",
collection },
            expect.any(Function),
            undefined
        );
    });

    it("wires an auth token getter onto the socket", () => {
        const getAuthToken = jest.fn().mockResolvedValue("token");

        // Without this the driver *works* — as `anon`, returning whatever the
        // anonymous policies allow — so a hand-built socket looks like a data
        // bug rather than an auth one.
        renderHook(() => usePostgresClientDriver({ wsClient: mockWsClient,
getAuthToken }));

        expect(mockWsClient.setAuthTokenGetter).toHaveBeenCalledWith(getAuthToken);
    });

    it("leaves a socket that already has a getter alone", () => {
        renderHook(() => usePostgresClientDriver({ wsClient: mockWsClient }));

        // `createRebaseClient()`'s socket carries the session's own getter;
        // overwriting it with `undefined` would sign the driver out.
        expect(mockWsClient.setAuthTokenGetter).not.toHaveBeenCalled();
    });

    it("correctly routes admin database branching operations", async () => {
        const { result } = renderHook(() => usePostgresClientDriver({ wsClient: mockWsClient }));
        const driver = result.current;

        // `DataDriver.admin` is optional and every capability on `DatabaseAdmin`
        // is partial, so consumers narrow with the exported guards before
        // calling. Doing the same here also asserts the driver really does
        // advertise the branching capability.
        //
        // Note that `isBranchAdmin` narrows on `createBranch` alone while
        // `BranchAdmin` requires four methods: neither this driver nor
        // `RebaseWebSocketClient` has `getBranchInfo`, so the guard certifies
        // more than it checks. That gap lives in `@rebasepro/types`
        // (`backend.ts` `BranchAdmin` / `isBranchAdmin`), not here — only the
        // three methods that exist are exercised below.
        const admin = driver.admin;
        if (!isBranchAdmin(admin)) {
            throw new Error("the postgres driver should expose branch admin capabilities");
        }

        // createBranch
        await admin.createBranch("branch_test");
        expect(mockWsClient.createBranch).toHaveBeenCalledWith("branch_test", undefined);

        // deleteBranch
        await admin.deleteBranch("branch_test");
        expect(mockWsClient.deleteBranch).toHaveBeenCalledWith("branch_test");

        // listBranches
        await admin.listBranches();
        expect(mockWsClient.listBranches).toHaveBeenCalled();
    });

    it("hands the socket every part of a subscription's query", () => {
        const { result } = renderHook(() => usePostgresClientDriver({ wsClient: mockWsClient } as any));
        const driver = result.current;

        const logical = {
            type: "or",
            conditions: [{ column: "status", operator: "==", value: "draft" }]
        };
        const onUpdate = jest.fn();

        driver.listenCollection!({
            path: "posts",
            filter: { author: ["==", "u1"] },
            logical,
            limit: 10,
            offset: 20,
            orderBy: "created_at",
            order: "desc",
            searchString: "widget",
            onUpdate
        } as any);

        // Asserted as a whole rather than field by field: this hop used to
        // destructure a hand-written list of seven names, and the two it left
        // out — `offset` and `logical` — were accepted by the caller's types and
        // then silently dropped.
        expect(mockWsClient.listenCollection).toHaveBeenCalledWith(
            {
                path: "posts",
                filter: { author: ["==", "u1"] },
                logical,
                limit: 10,
                offset: 20,
                orderBy: "created_at",
                order: "desc",
                searchString: "widget"
            },
            expect.any(Function),
            undefined
        );
    });
});
