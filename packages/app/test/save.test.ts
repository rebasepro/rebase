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

    /**
     * The collection's own callbacks, which this function is named after and
     * did not run. `browserCallbacks`, not `callbacks`: the server owns the
     * latter and runs it inside the write it serves, and the Vite plugin strips
     * its bodies out of this bundle — so reading it here would have been reading
     * `undefined` in any real build.
     *
     * The case that makes it matter is a collection on a `direct` transport,
     * where the panel writes to the store itself: no server sees the write, so
     * without these the collection has no write callbacks anywhere.
     */
    describe("admin.browserCallbacks", () => {
        const withCallbacks = (browserCallbacks: Record<string, unknown>) => ({
            ...mockCollection,
            browserCallbacks
        }) as CollectionConfig;

        it("saves what beforeSave returned, not what was passed in", async () => {
            const createFn = jest.fn().mockResolvedValue(mockEntity);
            const data = createMockData({ create: createFn });

            await saveEntityWithCallbacks({
                collection: withCallbacks({
                    beforeSave: ({ values }: { values: Record<string, unknown> }) =>
                        ({ ...values, slug: "new-entity" })
                }),
                path: "test-collection",
                entityId: undefined,
                values: { name: "New Entity" },
                previousValues: undefined,
                status: "new",
                data,
                context: mockContext
            });

            expect(createFn).toHaveBeenCalledWith({ name: "New Entity", slug: "new-entity" }, undefined);
        });

        it("blocks the write when beforeSave throws", async () => {
            const createFn = jest.fn().mockResolvedValue(mockEntity);
            const afterSaveError = jest.fn();
            const data = createMockData({ create: createFn });

            await expect(
                saveEntityWithCallbacks({
                    collection: withCallbacks({
                        beforeSave: () => { throw new Error("Price cannot be negative"); }
                    }),
                    path: "test-collection",
                    entityId: undefined,
                    values: { price: -1 },
                    previousValues: undefined,
                    status: "new",
                    data,
                    context: mockContext,
                    afterSaveError
                })
            ).rejects.toThrow("Price cannot be negative");

            // Blocked means blocked: nothing reached the store, and the form
            // heard about it the same way it hears about a rejected write.
            expect(createFn).not.toHaveBeenCalled();
            expect(afterSaveError).toHaveBeenCalledWith(expect.objectContaining({
                message: "Price cannot be negative"
            }));
        });

        it("hands afterSave the row as saved, not the values sent", async () => {
            // The auth create response carries `temporaryPassword` beside the
            // columns, and the panel's injected afterSave — the credentials
            // dialog — can only read it from the saved row. Passing the
            // submitted values here would show the dialog nothing.
            const saved: Entity = {
                id: "user-1",
                path: "users",
                values: { email: "a@b.c", temporaryPassword: "hunter2", invitationSent: false }
            };
            const afterSave = jest.fn();
            const data = createMockData({ create: jest.fn().mockResolvedValue(saved) });

            await saveEntityWithCallbacks({
                collection: withCallbacks({ afterSave }),
                path: "users",
                entityId: undefined,
                values: { email: "a@b.c" },
                previousValues: undefined,
                status: "new",
                data,
                context: mockContext
            });

            expect(afterSave).toHaveBeenCalledWith(expect.objectContaining({
                id: "user-1",
                status: "new",
                values: saved.values
            }));
        });

        it("awaits afterSave before the caller's own", async () => {
            const order: string[] = [];
            const data = createMockData();

            await saveEntityWithCallbacks({
                collection: withCallbacks({
                    afterSave: async () => {
                        await Promise.resolve();
                        order.push("collection");
                    }
                }),
                path: "test-collection",
                entityId: undefined,
                values: { name: "New Entity" },
                previousValues: undefined,
                status: "new",
                data,
                context: mockContext,
                afterSave: () => order.push("caller")
            });

            expect(order).toEqual(["collection", "caller"]);
        });

        it("runs afterSaveError when the write itself fails", async () => {
            const afterSaveError = jest.fn();
            const data = createMockData({ create: jest.fn().mockRejectedValue(new Error("DB failure")) });

            await expect(
                saveEntityWithCallbacks({
                    collection: withCallbacks({ afterSaveError }),
                    path: "test-collection",
                    entityId: undefined,
                    values: { name: "Fail" },
                    previousValues: undefined,
                    status: "new",
                    data,
                    context: mockContext
                })
            ).rejects.toThrow("DB failure");

            expect(afterSaveError).toHaveBeenCalledWith(expect.objectContaining({ status: "new" }));
        });

        it("does not run the server's `callbacks`", async () => {
            // The block that ships stripped. Reading it here would run whatever
            // survived in dev and nothing at all in a build — the worst of both.
            const serverCallback = jest.fn();
            const createFn = jest.fn().mockResolvedValue(mockEntity);
            const data = createMockData({ create: createFn });

            await saveEntityWithCallbacks({
                collection: {
                    ...mockCollection,
                    callbacks: { beforeSave: serverCallback, afterSave: serverCallback }
                } as CollectionConfig,
                path: "test-collection",
                entityId: undefined,
                values: { name: "New Entity" },
                previousValues: undefined,
                status: "new",
                data,
                context: mockContext
            });

            expect(serverCallback).not.toHaveBeenCalled();
        });
    });
});
