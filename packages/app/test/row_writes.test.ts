import { describe, expect, it, jest } from "@jest/globals";
import type { CollectionCallbacks, SDKCollectionClient } from "@rebasepro/types";
import type { AdminCollection, RebaseContext } from "@rebasepro/cms-types";
import { createDataChanges, type DataChanges } from "../src/hooks/data/dataChanges";
import { buildContextData, createRowWriter, MAX_WRITE_DEPTH } from "../src/hooks/data/rowWrites";
import type { SdkDataLayer } from "../src/hooks/data/sdkData";

/**
 * The flat layer's single-row writes and `context.data`, over a stub
 * accessor: what each write sends, which callbacks it runs and with what, how
 * deep callback-started writes may nest, and that every write says so on the
 * change signal.
 */

type Row = Record<string, unknown>;

interface Sent {
    method: string;
    args: unknown[];
}

function stubAccessor(sent: Sent[], answer: (method: string) => unknown = () => ({ id: 1, title: "Saved" })) {
    const record = (method: string) => async (...args: unknown[]) => {
        sent.push({ method, args });
        return answer(method);
    };
    return {
        find: async () => ({ data: [], meta: { total: 0, limit: 50, offset: 0, hasMore: false } }),
        findById: async () => ({ id: 1, title: "Before" }),
        create: record("create"),
        update: record("update"),
        delete: record("delete"),
        upsert: record("upsert"),
        trash: {
            find: async () => ({ data: [], meta: { total: 0, limit: 50, offset: 0, hasMore: false } }),
            count: async () => 0,
            restore: record("trash.restore"),
            restoreMany: record("trash.restoreMany"),
            purge: record("trash.purge"),
            purgeMany: record("trash.purgeMany")
        }
    };
}

function layerOver(accessor: object, callbacks?: CollectionCallbacks, changes: DataChanges = createDataChanges()) {
    const slugs: string[] = [];
    const tasks: AdminCollection = {
        slug: "tasks",
        name: "Tasks",
        properties: { id: { type: "number", name: "Id", isId: true }, title: { type: "string", name: "Title" } },
        ...(callbacks && { browserCallbacks: callbacks })
    };
    const layer: SdkDataLayer = {
        data: {
            collection: (slug: string) => {
                slugs.push(slug);
                // A stub answers per method, `undefined` included (as a `returning:
                // false` write does), and a class instance whose methods read
                // `this`; SDKCollectionClient's overloads type neither on an object.
                return accessor as unknown as SDKCollectionClient;
            }
        } as SdkDataLayer["data"],
        changes,
        resolveCollection: (slug) => slug === "tasks" || slug === "blog_posts" ? tasks : undefined
    };
    return { layer, slugs, changes };
}

// The writer only hands the context to callbacks, and these callbacks read none of it.
const context = () => ({}) as RebaseContext;

describe("createRowWriter", () => {
    it("passes a write's options on, for an update, a create and a delete", async () => {
        const sent: Sent[] = [];
        const { layer } = layerOver(stubAccessor(sent));
        const writer = createRowWriter(layer, context);
        const options = { returning: false };

        await writer.update("tasks", 1, { title: "A" }, options);
        await writer.create("tasks", { title: "B" }, 2, options);
        await writer.remove("tasks", 1, options);
        expect(sent).toEqual([
            { method: "update", args: [1, { title: "A" }, options] },
            { method: "create", args: [{ title: "B" }, 2, options] },
            { method: "delete", args: [1, options] }
        ]);
    });

    it("runs afterSaveError on a failed write in a collection whose only callback it is", async () => {
        const errors: string[] = [];
        const accessor = { ...stubAccessor([]), update: async () => Promise.reject(new Error("refused")) };
        const { layer } = layerOver(accessor, {
            afterSaveError: ({ error }) => {
                errors.push(error instanceof Error ? error.message : String(error));
            }
        });

        await expect(createRowWriter(layer, context).update("tasks", 1, { title: "A" })).rejects.toThrow("refused");
        expect(errors).toEqual(["refused"]);
    });

    it("runs afterDelete with the row in a collection whose only callback it is", async () => {
        const rows: Row[] = [];
        const { layer } = layerOver(stubAccessor([]), {
            afterDelete: ({ row }) => {
                rows.push(row);
            }
        });

        await createRowWriter(layer, context).remove("tasks", 1);
        expect(rows).toEqual([{ id: 1, title: "Before" }]);
    });

    it("hands afterSave the row beforeSave returned when the write returns none", async () => {
        const saved: { id: string | number; values: Row }[] = [];
        const sent: Sent[] = [];
        const { layer } = layerOver(stubAccessor(sent, () => undefined), {
            beforeSave: ({ values }) => ({ ...values, title: "From beforeSave" }),
            afterSave: ({ id, values }) => {
                saved.push({ id, values });
            }
        });

        await createRowWriter(layer, context).update("tasks", 1, { id: 1, title: "Typed" }, { returning: false });
        expect(sent[0].args[1]).toEqual({ id: 1, title: "From beforeSave" });
        expect(saved).toEqual([{ id: "1", values: { id: 1, title: "From beforeSave" } }]);
    });

    it("hands afterSave a created row's id, as the server assigned it", async () => {
        const ids: (string | number)[] = [];
        const { layer } = layerOver(stubAccessor([], () => ({ id: 42, title: "New" })), {
            afterSave: ({ id }) => {
                ids.push(id);
            }
        });

        await createRowWriter(layer, context).create("tasks", { title: "New" });
        expect(ids).toEqual(["42"]);
    });

    it("lets writes nest the backend's 16 deep, and refuses a save or a delete one deeper", async () => {
        // The backend's MAX_WRITE_DEPTH (`@rebasepro/server-postgres`): a chain
        // the server would run, the browser runs too.
        expect(MAX_WRITE_DEPTH).toBe(16);
        const { layer } = layerOver(stubAccessor([]));
        await expect(createRowWriter(layer, context, 16).update("tasks", 1, { title: "A" })).resolves.toBeDefined();
        await createRowWriter(layer, context, 16).remove("tasks", 1);
        await expect(createRowWriter(layer, context, 17).update("tasks", 1, { title: "A" }))
            .rejects.toMatchObject({ code: "CALLBACK_RECURSION" });
        await expect(createRowWriter(layer, context, 17).remove("tasks", 1))
            .rejects.toMatchObject({ code: "CALLBACK_RECURSION" });
    });
});

describe("buildContextData", () => {
    it("says on the change signal that an upsert or a trash restore changed the collection", async () => {
        const changes = createDataChanges();
        const signal = { emit: jest.spyOn(changes, "emit") };
        const { layer } = layerOver(stubAccessor([]), undefined, changes);
        const data = buildContextData(layer, context);

        await data.collection("tasks").upsert!({ id: 1, title: "A" });
        await data.collection("tasks").trash.restore(1);
        expect(signal.emit.mock.calls).toEqual([["tasks"], ["tasks"]]);
    });

    it("names a collection the way every data layer does: data.blogPosts is blog_posts", () => {
        const { layer, slugs } = layerOver(stubAccessor([]));
        const data = buildContextData(layer, context);
        void data.blogPosts;
        expect(slugs).toEqual(["blog_posts"]);
    });

    it("binds an accessor's own methods to it, so one that reads private state through `this` works", async () => {
        class Accessor {
            readonly #rows = [{ id: 1 }];
            find = async () => ({ data: this.#rows, meta: { total: 1, limit: 50, offset: 0, hasMore: false } });
            async count() {
                return this.#rows.length;
            }
        }
        const { layer } = layerOver(new Accessor());
        const { count } = buildContextData(layer, context).collection("tasks");
        await expect(count!()).resolves.toBe(1);
    });
});
