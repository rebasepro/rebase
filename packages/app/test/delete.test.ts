import { deleteEntityWithCallbacks } from "../src/hooks/data/delete";
import type { Entity, RebaseData } from "@rebasepro/types";
import type { AdminCollection, RebaseContext } from "@rebasepro/cms-types";

/**
 * `deleteEntityWithCallbacks` has been named that since it was written and ran
 * no callbacks at all — it even took a `callbacks` prop and dropped it on the
 * floor. These cover the block it runs now.
 *
 * `browserCallbacks`, not `callbacks`: the server owns the latter and runs it
 * inside the delete it serves, and the Vite plugin strips its bodies out of this
 * bundle. The case that makes this matter is a collection on a `direct`
 * transport, where the panel deletes from the store itself and no server is in
 * the path to run anything.
 */
describe("deleteEntityWithCallbacks", () => {

    const mockEntity: Entity = {
        id: "entity-1",
        path: "test-collection",
        values: { name: "Test Entity" }
    };

    const mockContext = {} as RebaseContext;

    const collectionWith = (browserCallbacks?: Record<string, unknown>) => ({
        slug: "test-collection",
        name: "Test",
        properties: {},
        ...(browserCallbacks ? { browserCallbacks } : {})
    }) as unknown as AdminCollection;

    function createMockData(deleteFn = jest.fn().mockResolvedValue(undefined)): RebaseData {
        return {
            collection: jest.fn().mockReturnValue({ delete: deleteFn })
        } as unknown as RebaseData;
    }

    it("deletes and reports success", async () => {
        const deleteFn = jest.fn().mockResolvedValue(undefined);
        const onDeleteSuccess = jest.fn();

        const result = await deleteEntityWithCallbacks({
            data: createMockData(deleteFn),
            entity: mockEntity,
            collection: collectionWith(),
            onDeleteSuccess,
            context: mockContext
        });

        expect(result).toBe(true);
        expect(deleteFn).toHaveBeenCalledWith("entity-1");
        expect(onDeleteSuccess).toHaveBeenCalledWith(mockEntity);
    });

    it("blocks the delete when beforeDelete throws", async () => {
        const deleteFn = jest.fn().mockResolvedValue(undefined);
        const onDeleteFailure = jest.fn();

        const result = await deleteEntityWithCallbacks({
            data: createMockData(deleteFn),
            entity: mockEntity,
            collection: collectionWith({
                beforeDelete: () => { throw new Error("Published entries cannot be deleted"); }
            }),
            onDeleteFailure,
            context: mockContext
        });

        expect(result).toBe(false);
        expect(deleteFn).not.toHaveBeenCalled();
        expect(onDeleteFailure).toHaveBeenCalledWith(mockEntity, expect.objectContaining({
            message: "Published entries cannot be deleted"
        }));
    });

    it("hands beforeDelete and afterDelete the flat row", async () => {
        const beforeDelete = jest.fn();
        const afterDelete = jest.fn();

        await deleteEntityWithCallbacks({
            data: createMockData(),
            entity: mockEntity,
            collection: collectionWith({ beforeDelete, afterDelete }),
            context: mockContext
        });

        const expected = expect.objectContaining({
            id: "entity-1",
            path: "test-collection",
            row: { id: "entity-1", name: "Test Entity" }
        });
        expect(beforeDelete).toHaveBeenCalledWith(expected);
        expect(afterDelete).toHaveBeenCalledWith(expected);
    });

    it("does not run afterDelete when the delete fails", async () => {
        const afterDelete = jest.fn();
        const onDeleteFailure = jest.fn();

        const result = await deleteEntityWithCallbacks({
            data: createMockData(jest.fn().mockRejectedValue(new Error("DB failure"))),
            entity: mockEntity,
            collection: collectionWith({ afterDelete }),
            onDeleteFailure,
            context: mockContext
        });

        expect(result).toBe(false);
        expect(afterDelete).not.toHaveBeenCalled();
        expect(onDeleteFailure).toHaveBeenCalled();
    });

    it("does not run the server's `callbacks`", async () => {
        const serverCallback = jest.fn();

        await deleteEntityWithCallbacks({
            data: createMockData(),
            entity: mockEntity,
            collection: {
                ...collectionWith(),
                callbacks: { beforeDelete: serverCallback, afterDelete: serverCallback }
            } as unknown as AdminCollection,
            context: mockContext
        });

        expect(serverCallback).not.toHaveBeenCalled();
    });
});
