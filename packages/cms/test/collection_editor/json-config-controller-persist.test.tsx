import { renderHook, act, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { useJsonCollectionsConfigController } from "../../src/collection_editor/useJsonCollectionsConfigController";
import type { JsonCollectionStore, SerializableCollectionConfig } from "../../src/collection_editor/serializable_types";

/**
 * The editor said "saved" for schema changes the store had refused.
 *
 * Three of this controller's mutators computed their new value inside
 * `setCollections(prev => …)` and persisted from in there, fire-and-forget with
 * a `console.error`. Two things followed, and the hook's own siblings —
 * `saveCollection`, `deleteCollection`, `updatePropertiesOrder` — did neither:
 *
 *  - The promise they returned resolved before the store had answered, so an
 *    embedding app awaiting `saveProperty` could not tell a stored change from
 *    a rejected one. Its docblock's example store is a `fetch` to an API; a
 *    500, an expired session or an offline laptop all read as success, and the
 *    change was gone on reload.
 *  - A `setState` updater must be pure. Under `StrictMode` React invokes it
 *    twice, so every one of those saves wrote to the store twice in dev — and
 *    a store that is a `PUT` is a request that happened twice.
 */
describe("useJsonCollectionsConfigController persistence", () => {
    const collection = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: { title: { name: "Title", dataType: "string" } },
        propertiesOrder: ["title"]
    } as unknown as SerializableCollectionConfig;

    /** A store that records every call and can be told to refuse. */
    function makeStore(behaviour: "accept" | "refuse" = "accept") {
        const saves: string[] = [];
        const deletes: string[] = [];
        const store: JsonCollectionStore = {
            load: async () => [collection],
            save: async (slug) => {
                saves.push(slug);
                if (behaviour === "refuse") throw new Error("store is unreachable");
            },
            delete: async (slug) => {
                deletes.push(slug);
                if (behaviour === "refuse") throw new Error("store is unreachable");
            }
        };
        return { store, saves, deletes };
    }

    async function mounted(store: JsonCollectionStore, strict = false) {
        const { result } = renderHook(
            () => useJsonCollectionsConfigController({ store }),
            strict ? { wrapper: StrictMode } : undefined
        );
        await waitFor(() => expect(result.current.loading).toBe(false));
        return result;
    }

    describe("a store that refuses the write", () => {
        it("rejects saveProperty rather than reporting the property saved", async () => {
            const { store } = makeStore("refuse");
            const result = await mounted(store);

            await expect(act(() => result.current.saveProperty!({
                path: "posts",
                propertyKey: "body",
                property: { name: "Body", dataType: "string" } as never
            }))).rejects.toThrow(/unreachable/);
        });

        it("rejects deleteProperty", async () => {
            const { store } = makeStore("refuse");
            const result = await mounted(store);

            await expect(act(() => result.current.deleteProperty!({
                path: "posts",
                propertyKey: "title"
            }))).rejects.toThrow(/unreachable/);
        });

        it("rejects updateCollection", async () => {
            const { store } = makeStore("refuse");
            const result = await mounted(store);

            await expect(act(() => result.current.updateCollection!({
                id: "posts",
                collectionData: { name: "Renamed" } as never
            }))).rejects.toThrow(/unreachable/);
        });
    });

    describe("a store that accepts", () => {
        it("saves the property once, and to the right collection", async () => {
            const { store, saves } = makeStore();
            const result = await mounted(store);

            await act(() => result.current.saveProperty!({
                path: "posts",
                propertyKey: "body",
                property: { name: "Body", dataType: "string" } as never
            }));

            expect(saves).toEqual(["posts"]);
            expect(result.current.collections[0].properties).toHaveProperty("body");
        });

        it("writes once per call under StrictMode, not twice", async () => {
            // The double write was invisible in production and duplicated every
            // request in development, because a state updater with a side
            // effect in it runs twice.
            const { store, saves } = makeStore();
            const result = await mounted(store, true);

            await act(() => result.current.saveProperty!({
                path: "posts",
                propertyKey: "body",
                property: { name: "Body", dataType: "string" } as never
            }));

            expect(saves).toEqual(["posts"]);
        });

        it("renames by writing the new slug before dropping the old one", async () => {
            // Order matters: dropping the old key first and then failing the
            // write loses the collection outright.
            const { store, saves, deletes } = makeStore();
            const result = await mounted(store);

            await act(() => result.current.updateCollection!({
                id: "articles",
                previousId: "posts",
                collectionData: { slug: "articles", name: "Articles" } as never
            }));

            expect(saves).toEqual(["articles"]);
            expect(deletes).toEqual(["posts"]);
        });
    });
});
