import { saveEntityWithCallbacks } from "../src/hooks/data/save";
import type { CollectionConfig, Entity, RebaseData } from "@rebasepro/types";
import type { RebaseContext } from "@rebasepro/cms-types";

describe("saveEntityWithCallbacks", () => {
    const mockCollection: CollectionConfig = {
        slug: "test-collection",
        name: "Test",
        properties: {}
    } as CollectionConfig;

    const mockEntity: Entity = {
        id: "entity-1",
        path: "test-collection",
        values: { name: "Test Entity" }
    };

    function createMockData(overrides?: Partial<{ create: jest.Mock; update: jest.Mock }>): RebaseData {
        const createFn = overrides?.create ?? jest.fn().mockResolvedValue(mockEntity);
        const updateFn = overrides?.update ?? jest.fn().mockResolvedValue(mockEntity);
        return {
            collection: jest.fn().mockReturnValue({
                create: createFn,
                update: updateFn
            })
        } as unknown as RebaseData;
    }

    const mockContext = {} as RebaseContext;

    it("should call create for status 'new'", async () => {
        const createFn = jest.fn().mockResolvedValue(mockEntity);
        const data = createMockData({ create: createFn });

        await saveEntityWithCallbacks({
            collection: mockCollection,
            path: "test-collection",
            entityId: undefined,
            values: { name: "New Entity" },
            previousValues: undefined,
            status: "new",
            data,
            context: mockContext
        });

        expect(createFn).toHaveBeenCalledWith({ name: "New Entity" }, undefined);
    });

    it("should call create for status 'copy'", async () => {
        const createFn = jest.fn().mockResolvedValue(mockEntity);
        const data = createMockData({ create: createFn });

        await saveEntityWithCallbacks({
            collection: mockCollection,
            path: "test-collection",
            entityId: "copy-id",
            values: { name: "Copied Entity" },
            previousValues: undefined,
            status: "copy",
            data,
            context: mockContext
        });

        expect(createFn).toHaveBeenCalledWith({ name: "Copied Entity" }, "copy-id");
    });

    it("should call update for status 'existing'", async () => {
        const updateFn = jest.fn().mockResolvedValue(mockEntity);
        const data = createMockData({ update: updateFn });

        await saveEntityWithCallbacks({
            collection: mockCollection,
            path: "test-collection",
            entityId: "entity-1",
            values: { name: "Updated Entity" },
            previousValues: { name: "Old Entity" },
            status: "existing",
            data,
            context: mockContext
        });

        expect(updateFn).toHaveBeenCalledWith("entity-1", { name: "Updated Entity" });
    });

    it("should throw if status is 'existing' and entityId is missing", async () => {
        const data = createMockData();

        await expect(
            saveEntityWithCallbacks({
                collection: mockCollection,
                path: "test-collection",
                entityId: undefined,
                values: { name: "Bad" },
                previousValues: undefined,
                status: "existing",
                data,
                context: mockContext
            })
        ).rejects.toThrow("Entity id must be specified");
    });

    it("should NOT throw if status is 'new' and entityId is missing", async () => {
        const data = createMockData();

        await expect(
            saveEntityWithCallbacks({
                collection: mockCollection,
                path: "test-collection",
                entityId: undefined,
                values: { name: "New" },
                previousValues: undefined,
                status: "new",
                data,
                context: mockContext
            })
        ).resolves.toBeDefined();
    });

    it("should NOT throw if status is 'copy' and entityId is missing", async () => {
        const data = createMockData();

        await expect(
            saveEntityWithCallbacks({
                collection: mockCollection,
                path: "test-collection",
                entityId: undefined,
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

        await saveEntityWithCallbacks({
            collection: mockCollection,
            path: "test-collection",
            entityId: undefined,
            values: { name: "New" },
            previousValues: undefined,
            status: "new",
            data,
            context: mockContext,
            afterSave
        });

        expect(afterSave).toHaveBeenCalledWith(mockEntity);
    });

    it("should call afterSaveError on failure", async () => {
        const error = new Error("DB failure");
        const createFn = jest.fn().mockRejectedValue(error);
        const afterSaveError = jest.fn();
        const data = createMockData({ create: createFn });

        await expect(
            saveEntityWithCallbacks({
                collection: mockCollection,
                path: "test-collection",
                entityId: undefined,
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
