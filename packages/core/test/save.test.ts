import { saveSnapshotWithCallbacks } from "../src/hooks/data/save";
import type { SnapshotCollection, Snapshot, RebaseData, RebaseContext } from "@rebasepro/types";

describe("saveSnapshotWithCallbacks", () => {
    const mockCollection: SnapshotCollection = {
        slug: "test-collection",
        name: "Test",
        properties: {}
    } as SnapshotCollection;

    const mockSnapshot: Snapshot = {
        id: "snapshot-1",
        path: "test-collection",
        values: { name: "Test Snapshot" }
    };

    function createMockData(overrides?: Partial<{ create: jest.Mock; update: jest.Mock }>): RebaseData {
        const createFn = overrides?.create ?? jest.fn().mockResolvedValue(mockSnapshot);
        const updateFn = overrides?.update ?? jest.fn().mockResolvedValue(mockSnapshot);
        return {
            collection: jest.fn().mockReturnValue({
                create: createFn,
                update: updateFn
            })
        } as unknown as RebaseData;
    }

    const mockContext = {} as RebaseContext;

    it("should call create for status 'new'", async () => {
        const createFn = jest.fn().mockResolvedValue(mockSnapshot);
        const data = createMockData({ create: createFn });

        await saveSnapshotWithCallbacks({
            collection: mockCollection,
            path: "test-collection",
            snapshotId: undefined,
            values: { name: "New Snapshot" },
            previousValues: undefined,
            status: "new",
            data,
            context: mockContext
        });

        expect(createFn).toHaveBeenCalledWith({ name: "New Snapshot" }, undefined);
    });

    it("should call create for status 'copy'", async () => {
        const createFn = jest.fn().mockResolvedValue(mockSnapshot);
        const data = createMockData({ create: createFn });

        await saveSnapshotWithCallbacks({
            collection: mockCollection,
            path: "test-collection",
            snapshotId: "copy-id",
            values: { name: "Copied Snapshot" },
            previousValues: undefined,
            status: "copy",
            data,
            context: mockContext
        });

        expect(createFn).toHaveBeenCalledWith({ name: "Copied Snapshot" }, "copy-id");
    });

    it("should call update for status 'existing'", async () => {
        const updateFn = jest.fn().mockResolvedValue(mockSnapshot);
        const data = createMockData({ update: updateFn });

        await saveSnapshotWithCallbacks({
            collection: mockCollection,
            path: "test-collection",
            snapshotId: "snapshot-1",
            values: { name: "Updated Snapshot" },
            previousValues: { name: "Old Snapshot" },
            status: "existing",
            data,
            context: mockContext
        });

        expect(updateFn).toHaveBeenCalledWith("snapshot-1", { name: "Updated Snapshot" });
    });

    it("should throw if status is 'existing' and snapshotId is missing", async () => {
        const data = createMockData();

        await expect(
            saveSnapshotWithCallbacks({
                collection: mockCollection,
                path: "test-collection",
                snapshotId: undefined,
                values: { name: "Bad" },
                previousValues: undefined,
                status: "existing",
                data,
                context: mockContext
            })
        ).rejects.toThrow("Snapshot id must be specified");
    });

    it("should NOT throw if status is 'new' and snapshotId is missing", async () => {
        const data = createMockData();

        await expect(
            saveSnapshotWithCallbacks({
                collection: mockCollection,
                path: "test-collection",
                snapshotId: undefined,
                values: { name: "New" },
                previousValues: undefined,
                status: "new",
                data,
                context: mockContext
            })
        ).resolves.toBeDefined();
    });

    it("should NOT throw if status is 'copy' and snapshotId is missing", async () => {
        const data = createMockData();

        await expect(
            saveSnapshotWithCallbacks({
                collection: mockCollection,
                path: "test-collection",
                snapshotId: undefined,
                values: { name: "Copy" },
                previousValues: undefined,
                status: "copy",
                data,
                context: mockContext
            })
        ).resolves.toBeDefined();
    });

    it("should call afterSave on success", async () => {
        const afterSave = jest.fn();
        const data = createMockData();

        await saveSnapshotWithCallbacks({
            collection: mockCollection,
            path: "test-collection",
            snapshotId: undefined,
            values: { name: "New" },
            previousValues: undefined,
            status: "new",
            data,
            context: mockContext,
            afterSave
        });

        expect(afterSave).toHaveBeenCalledWith(mockSnapshot);
    });

    it("should call afterSaveError on failure", async () => {
        const error = new Error("DB failure");
        const createFn = jest.fn().mockRejectedValue(error);
        const afterSaveError = jest.fn();
        const data = createMockData({ create: createFn });

        await expect(
            saveSnapshotWithCallbacks({
                collection: mockCollection,
                path: "test-collection",
                snapshotId: undefined,
                values: { name: "Fail" },
                previousValues: undefined,
                status: "new",
                data,
                context: mockContext,
                afterSaveError
            })
        ).rejects.toThrow("DB failure");

        expect(afterSaveError).toHaveBeenCalledWith(error);
    });
});
