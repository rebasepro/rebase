import { saveEntityWithCallbacks } from "../src/hooks/data/save";
import { EntityRelation } from "@rebasepro/types";
import type { CollectionCallbacks, CollectionConfig, Entity, RebaseData } from "@rebasepro/types";
import { fakeCollectionAccessor, rebaseDataOver } from "./helpers/fakes";
import type { AdminCollection, RebaseContext } from "@rebasepro/cms-types";

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
        return rebaseDataOver((slug) => fakeCollectionAccessor(slug, {
            create: createFn,
            update: updateFn
        }));
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
        const withCallbacks = (browserCallbacks: CollectionCallbacks): AdminCollection => ({
            ...mockCollection,
            browserCallbacks
        });

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

        // `context.data`'s writer saves whatever beforeSave hands back, edited
        // in place or not (data_changes.test.tsx); the form's save is held to
        // the same.
        it.each([
            ["edits the row in place and returns it", ({ values }: { values: Record<string, unknown> }) => {
                values.slug = "new-entity";
                return values;
            }],
            ["returns a new row", ({ values }: { values: Record<string, unknown> }) => ({ ...values, slug: "new-entity" })]
        ])("saves beforeSave's change when it %s", async (_how, beforeSave) => {
            const createFn = jest.fn().mockResolvedValue(mockEntity);
            const values = { name: "New Entity" };

            await saveEntityWithCallbacks({
                collection: withCallbacks({ beforeSave }),
                path: "test-collection",
                entityId: undefined,
                values,
                previousValues: undefined,
                status: "new",
                data: createMockData({ create: createFn }),
                context: mockContext
            });

            expect(createFn).toHaveBeenCalledWith({ name: "New Entity", slug: "new-entity" }, undefined);
            // The form's own values are not the row it handed out.
            expect(values).toEqual({ name: "New Entity" });
        });

        describe("a relation's loaded target, edited in beforeSave", () => {
            const people = { slug: "people", table: "people", name: "People", properties: { id: { type: "string", name: "Id", isId: true }, name: { type: "string", name: "Name" } } } as CollectionConfig;
            const tags = { slug: "tags", table: "tags", name: "Tags", properties: { id: { type: "string", name: "Id", isId: true }, label: { type: "string", name: "Label" } } } as CollectionConfig;
            const posts = {
                slug: "posts",
                table: "posts",
                name: "Posts",
                properties: {
                    title: { type: "string", name: "Title" },
                    author: { type: "relation", name: "Author", relation: { kind: "belongsTo", target: () => people, localKey: "author_id" } },
                    tags: { type: "relation", name: "Tags", relation: { kind: "manyToMany", target: () => tags, through: { table: "post_tags", sourceColumn: "post_id", targetColumn: "tag_id" } } }
                }
            } as CollectionConfig;
            const author = new EntityRelation("p1", "people", { id: "p1", path: "people", values: { name: "Ada" } });
            const tagged = [
                new EntityRelation("g1", "tags", { id: "g1", path: "tags", values: { label: "news" } }),
                new EntityRelation("g2", "tags", { id: "g2", path: "tags", values: { label: "tech" } })
            ];

            async function create(beforeSave: (props: { values: Record<string, unknown> }) => Record<string, unknown>) {
                const createFn = jest.fn().mockResolvedValue({ id: "n1", path: "posts", values: {} });
                await saveEntityWithCallbacks({
                    collection: { ...posts, browserCallbacks: { beforeSave } } as AdminCollection,
                    path: "posts",
                    entityId: undefined,
                    values: { title: "Hello", author, tags: tagged },
                    previousValues: undefined,
                    status: "new",
                    data: createMockData({ create: createFn }),
                    context: mockContext
                });
                return createFn.mock.calls[0][0] as Record<string, unknown>;
            }

            it("keeps a belongsTo whose loaded target is stripped: its foreign key is the relation", async () => {
                const inPlace = await create(({ values }) => {
                    delete values.author;
                    return values;
                });
                expect(inPlace.author).toBe(author);
                const copied = await create(({ values }) => {
                    const { author: _author, ...rest } = values;
                    return rest;
                });
                expect(copied.author).toBe(author);
            });

            it("keeps a belongsTo whose loaded target is edited: what was read is not written", async () => {
                const written = await create(({ values }) => ({ ...values, author: { id: "p1", name: "Grace" } }));
                expect(written.author).toBe(author);
            });

            it("drops a belongsTo only when its foreign key is dropped", async () => {
                const written = await create(({ values }) => {
                    const { authorId: _authorId, ...rest } = values;
                    return rest;
                });
                expect(written).not.toHaveProperty("author");
            });

            it("unlinks a belongsTo whose foreign key is cleared", async () => {
                const written = await create(({ values }) => ({ ...values, authorId: null }));
                expect(written.author).toBeNull();
            });

            it("keeps a to-many whose loaded rows are removed from the row, or edited", async () => {
                expect((await create(({ values }) => {
                    delete values.tags;
                    return values;
                })).tags).toBe(tagged);
                expect((await create(({ values }) => ({ ...values, tags: [{ id: "g1", label: "renamed" }] }))).tags).toBe(tagged);
            });

            it("writes a to-many given as ids", async () => {
                const written = await create(({ values }) => ({ ...values, tags: ["g2"] }));
                expect((written.tags as EntityRelation[]).map((tag) => tag.id)).toEqual(["g2"]);
            });
        });

        it("hands the callbacks rows as the server sends them, and writes beforeSave's change onto the form's values", async () => {
            const people = { slug: "people", table: "people", name: "People", properties: { id: { type: "string", name: "Id", isId: true } } } as CollectionConfig;
            const tasks = {
                slug: "tasks",
                table: "tasks",
                name: "Tasks",
                properties: {
                    title: { type: "string", name: "Title" },
                    due: { type: "date", name: "Due" },
                    assignee: { type: "relation", name: "Assignee", relation: { kind: "belongsTo", target: () => people, localKey: "assignee_id" } }
                }
            } as CollectionConfig;
            const due = new Date("2026-11-08T09:30:00.000Z");
            const assignee = new EntityRelation("p1", "people", { id: "p1", path: "people", values: { id: "p1", name: "Ada" } });
            const seen: { values: Record<string, unknown>; previousValues?: Record<string, unknown> }[] = [];
            const after: Record<string, unknown>[] = [];
            const updateFn = jest.fn().mockResolvedValue({
                id: "t1",
                path: "tasks",
                values: { title: "Plan!", due, assignee }
            });
            const data = createMockData({ update: updateFn });

            const collection: AdminCollection = {
                ...tasks,
                browserCallbacks: {
                    beforeSave: ({ values, previousValues }) => {
                        seen.push({ values, previousValues });
                        return { ...values, title: `${String(values.title)}!` };
                    },
                    afterSave: ({ values }) => {
                        after.push(values);
                    }
                }
            };
            await saveEntityWithCallbacks({
                collection,
                path: "tasks",
                entityId: "t1",
                values: { title: "Plan", due, assignee },
                previousValues: { title: "Old", due, assignee },
                status: "existing",
                data,
                context: mockContext
            });

            // The loaded assignee rides along under its name, as REST's include
            // returns it, beside its foreign key.
            const ada = { id: "p1", name: "Ada" };
            expect(seen).toEqual([{
                values: { title: "Plan", due: "2026-11-08T09:30:00.000Z", assigneeId: "p1", assignee: ada },
                previousValues: { title: "Old", due: "2026-11-08T09:30:00.000Z", assigneeId: "p1", assignee: ada }
            }]);
            // The form's values, with what beforeSave changed: the date and the
            // relation it left alone are the form's own instances.
            expect(updateFn).toHaveBeenCalledWith("t1", { title: "Plan!", due, assignee });
            expect(updateFn.mock.calls[0][1].due).toBe(due);
            expect(updateFn.mock.calls[0][1].assignee).toBe(assignee);
            expect(after).toEqual([{ title: "Plan!", due: "2026-11-08T09:30:00.000Z", assigneeId: "p1", assignee: ada }]);
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

        it("reports a committed write as saved when the collection's afterSave throws", async () => {
            // A webhook that is down, say. The row is in the database: calling
            // it a failed save kept the form on "new", and the next click of
            // Save created a second row.
            const createFn = jest.fn().mockResolvedValue(mockEntity);
            const afterSave = jest.fn();
            const afterSaveError = jest.fn();
            const collectionAfterSaveError = jest.fn();
            const open = jest.fn();
            const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

            const saved = await saveEntityWithCallbacks({
                collection: withCallbacks({
                    afterSave: () => { throw new Error("webhook down"); },
                    afterSaveError: collectionAfterSaveError
                }),
                path: "test-collection",
                entityId: undefined,
                values: { name: "New Entity" },
                previousValues: undefined,
                status: "new",
                data: createMockData({ create: createFn }),
                context: { ...mockContext, snackbarController: { open, close: jest.fn() } },
                afterSave,
                afterSaveError
            });
            consoleError.mockRestore();

            expect(saved).toBe(mockEntity);
            expect(createFn).toHaveBeenCalledTimes(1);
            expect(afterSave).toHaveBeenCalledWith(mockEntity);
            expect(afterSaveError).not.toHaveBeenCalled();
            expect(collectionAfterSaveError).not.toHaveBeenCalled();
            // The hook's failure is still said, as what it is.
            expect(open).toHaveBeenCalledWith(expect.objectContaining({
                type: "warning",
                message: expect.stringContaining("webhook down")
            }));
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
