import type { CollectionAccessor, RebaseData } from "@rebasepro/types";
import { createDataChanges, withDataChanges } from "../src/hooks/data/dataChanges";

/**
 * The change signal itself: which listeners a name reaches, and which writes
 * of the admin's data say so.
 */
/** Listeners hear of a change in a microtask. */
const heardOf = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("createDataChanges", () => {
    it("reaches a collection's listeners by its slug, or by the path its driver stores it under", async () => {
        const changes = createDataChanges((slug) => slug === "fs_diagnosis" ? "diagnosis" : slug);
        const heard: string[] = [];
        changes.subscribe("fs_diagnosis", () => heard.push("fs_diagnosis"));
        changes.subscribe("posts", () => heard.push("posts"));

        changes.emit("fs_diagnosis");
        await heardOf();
        changes.emit("diagnosis");
        await heardOf();
        expect(heard).toEqual(["fs_diagnosis", "fs_diagnosis"]);
    });

    it("reaches a view that names the collection by its stored path, for a write named by its slug", async () => {
        // A registry hands back a path it does not know, unchanged.
        const changes = createDataChanges((path) => path === "orders" ? "public.orders" : path);
        const heard: string[] = [];
        changes.subscribe("public.orders", () => heard.push("by path"));
        changes.subscribe("orders", () => heard.push("by slug"));
        changes.subscribe("customers", () => heard.push("customers"));

        changes.emit("orders");
        await heardOf();
        changes.emit("public.orders");
        await heardOf();
        expect(heard).toEqual(["by path", "by slug", "by path", "by slug"]);
    });

    it("stops calling a listener once it unsubscribes", async () => {
        const changes = createDataChanges();
        let calls = 0;
        const stop = changes.subscribe("posts", () => calls++);
        changes.emit("posts");
        await heardOf();
        stop();
        changes.emit("posts");
        await heardOf();
        expect(calls).toBe(1);
    });

    it("tells each listener once for every change said before it hears, under one name or two", async () => {
        const changes = createDataChanges((path) => path === "orders" ? "public.orders" : path);
        const heard: string[] = [];
        changes.subscribe("orders", () => heard.push("orders"));
        changes.subscribe("posts", () => heard.push("posts"));

        for (let i = 0; i < 20; i++) changes.emit("orders");
        changes.emit("public.orders");
        changes.emit("posts");
        expect(heard).toEqual([]);
        await heardOf();
        expect(heard).toEqual(["orders", "posts"]);

        changes.emit("orders");
        await heardOf();
        expect(heard).toEqual(["orders", "posts", "orders"]);
    });

    it("does not tell a listener that left before it would have heard", async () => {
        const changes = createDataChanges();
        let calls = 0;
        const stop = changes.subscribe("posts", () => calls++);
        changes.emit("posts");
        stop();
        await heardOf();
        expect(calls).toBe(0);
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
        await heardOf();
        await data.collection("posts").update(1, {});
        await heardOf();
        await data.collection("posts").deleteMany!([1]);
        await heardOf();
        await data.blogPosts.delete(1);
        await heardOf();
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
        await heardOf();
        expect(emitted).toBe(0);
        expect(data.collection("posts").createMany).toBeUndefined();
    });
});
