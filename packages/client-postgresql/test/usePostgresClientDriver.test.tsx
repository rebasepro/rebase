import React from "react";
import { renderHook } from "@testing-library/react";
import { usePostgresClientDriver } from "../src/usePostgresClientDriver";

describe("usePostgresClientDriver hook", () => {
    let mockWsClient: any;

    beforeEach(() => {
        mockWsClient = {
            fetchCollection: jest.fn().mockResolvedValue([{ id: "1",
name: "Snapshot 1" }]),
            fetchOne: jest.fn().mockResolvedValue({ id: "1",
name: "Snapshot 1" }),
            save: jest.fn().mockResolvedValue({ id: "1",
name: "Saved Snapshot" }),
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
            listBranches: jest.fn().mockResolvedValue([])
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
name: "Snapshot 1" }]);

        // fetchOne
        const item = await driver.fetchOne({ path: "posts",
id: "1" });
        expect(mockWsClient.fetchOne).toHaveBeenCalledWith({ path: "posts",
id: "1" });
        expect(item).toEqual({ id: "1",
name: "Snapshot 1" });

        // save
        const saved = await driver.save({ path: "posts",
values: { name: "Test" } });
        expect(mockWsClient.save).toHaveBeenCalledWith({
            path: "posts",
            values: { name: "Test" },
            id: undefined,
            previousValues: undefined,
            status: undefined
        });
        expect(saved).toEqual({ id: "1",
name: "Saved Snapshot" });

        // delete
        await driver.delete({ row: { id: "1",
path: "test",
name: "Test" } });
        expect(mockWsClient.delete).toHaveBeenCalledWith({ row: { id: "1",
path: "test",
name: "Test" } });
    });

    it("correctly routes admin database branching operations", async () => {
        const { result } = renderHook(() => usePostgresClientDriver({ wsClient: mockWsClient }));
        const driver = result.current;

        // createBranch
        await driver.admin.createBranch("branch_test");
        expect(mockWsClient.createBranch).toHaveBeenCalledWith("branch_test", undefined);

        // deleteBranch
        await driver.admin.deleteBranch("branch_test");
        expect(mockWsClient.deleteBranch).toHaveBeenCalledWith("branch_test");

        // listBranches
        await driver.admin.listBranches();
        expect(mockWsClient.listBranches).toHaveBeenCalled();
    });
});
