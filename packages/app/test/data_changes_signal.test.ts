import type { CollectionAccessor, RebaseData } from "@rebasepro/types";
import { createDataChanges, withDataChanges } from "../src/hooks/data/dataChanges";

/**
 * The change signal itself: which listeners a name reaches, and which writes
 * of the admin's data say so.
 */
describe("createDataChanges", () => {
    it("reaches a collection's listeners by its slug, or by the path its driver stores it under", () => {
        const changes = createDataChanges((slug) => slug === "fs_diagnosis" ? "diagnosis" : slug);
        const heard: string[] = [];
        changes.subscribe("fs_diagnosis", () => heard.push("fs_diagnosis"));
        changes.subscribe("posts", () => heard.push("posts"));

        changes.emit("fs_diagnosis");
        changes.emit("diagnosis");
        expect(heard).toEqual(["fs_diagnosis", "fs_diagnosis"]);
    });

    it("stops calling a listener once it unsubscribes", () => {
        const changes = createDataChanges();
        let calls = 0;
        const stop = changes.subscribe("posts", () => calls++);
        changes.emit("posts");
        stop();
        changes.emit("posts");
        expect(calls).toBe(1);
    });
});

describe("withDataChanges", () => {
    function fakeData(writes: string[]): RebaseData {
        const accessor = {
            find: async () => ({ data: [], meta: { total: 0, limit: 50, offset: 0, hasMore: false } }),
            create: async () => {
                writes.push("create");
                return { id: 1, path: "posts", values: {} };
            },
            update: async () => {
                writes.push("update");
                return { id: 1, path: "posts", values: {} };
            },
            delete: async () => {
                writes.push("delete");
            },
            deleteMany: async () => {
                writes.push("deleteMany");
            }
        } as unknown as CollectionAccessor;
        return { collection: () => accessor } as unknown as RebaseData;
    }

    it("says so after each write that succeeds, under the path asked for, and not after a read", async () => {
        const changes = createDataChanges();
        const emitted: string[] = [];
        changes.subscribe("posts", () => emitted.push("posts"));
        changes.subscribe("blog_posts", () => emitted.push("blog_posts"));
        const writes: string[] = [];
        const data = withDataChanges(fakeData(writes), changes);

        await data.collection("posts").find();
        expect(emitted).toEqual([]);

        await data.collection("posts").create({});
        await data.collection("posts").update(1, {});
        await data.collection("posts").deleteMany!([1]);
        await data.blogPosts.delete(1);
        expect(writes).toEqual(["create", "update", "deleteMany", "delete"]);
        expect(emitted).toEqual(["posts", "posts", "posts", "blog_posts"]);
    });

    it("says nothing when a write fails, and keeps an absent batch method absent", async () => {
        const changes = createDataChanges();
        let emitted = 0;
        changes.subscribe("posts", () => emitted++);
        const failing = {
            collection: () => ({ create: async () => Promise.reject(new Error("refused")) })
        } as unknown as RebaseData;
        const data = withDataChanges(failing, changes);

        await expect(data.collection("posts").create({})).rejects.toThrow("refused");
        expect(emitted).toBe(0);
        expect(data.collection("posts").createMany).toBeUndefined();
    });
});
