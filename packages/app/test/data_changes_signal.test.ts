import type { Entity, RebaseData } from "@rebasepro/cms-types";
import React from "react";
import { fakeTableAccessor, rebaseDataOver } from "./helpers/fakes";
import { act, renderHook } from "@testing-library/react";
import {
    CHANGE_MAX_WAIT_MS,
    CHANGE_QUIET_MS,
    createDataChanges,
    DataChangesContext,
    signalWrite,
    useDataChangeVersion,
    withDataChanges
} from "../src/hooks/data/dataChanges";

/**
 * The change signal itself: which listeners a name reaches, which writes of
 * the admin's data say so, and when a burst of changes is heard — once, a
 * quiet window after the last, while no write to the collection is in
 * flight, and no later than the maximum wait after the first.
 */

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

/** Long enough for any burst said so far to be heard. */
const heardOf = () => jest.advanceTimersByTimeAsync(CHANGE_QUIET_MS);

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

    it("tells of a lone change within the quiet window", async () => {
        const changes = createDataChanges();
        let calls = 0;
        changes.subscribe("posts", () => calls++);

        changes.emit("posts");
        await jest.advanceTimersByTimeAsync(CHANGE_QUIET_MS - 1);
        expect(calls).toBe(0);
        await jest.advanceTimersByTimeAsync(1);
        expect(calls).toBe(1);
    });

    it("tells of changes that keep coming no later than the maximum wait, and again after it", async () => {
        const changes = createDataChanges();
        const heardAt: number[] = [];
        const start = Date.now();
        changes.subscribe("posts", () => heardAt.push(Date.now() - start));

        // A change every 20ms for three seconds: never a quiet window.
        const stream = setInterval(() => changes.emit("posts"), 20);
        changes.emit("posts");
        await jest.advanceTimersByTimeAsync(CHANGE_MAX_WAIT_MS - 1);
        expect(heardAt).toEqual([]);
        await jest.advanceTimersByTimeAsync(3_000 - CHANGE_MAX_WAIT_MS + 1);
        clearInterval(stream);
        await heardOf();

        // At the deadline (a timer due at once runs a tick later under fake timers).
        expect(heardAt[0]).toBeGreaterThanOrEqual(CHANGE_MAX_WAIT_MS);
        expect(heardAt[0]).toBeLessThanOrEqual(CHANGE_MAX_WAIT_MS + 1);
        expect(heardAt.length).toBeGreaterThanOrEqual(3);
        expect(heardAt.length).toBeLessThanOrEqual(4);
    });

    it("keeps each collection's burst its own: a stream of changes to one does not hold another", async () => {
        const changes = createDataChanges();
        const heard: string[] = [];
        changes.subscribe("orders", () => heard.push("orders"));
        changes.subscribe("posts", () => heard.push("posts"));

        const stream = setInterval(() => changes.emit("posts"), 20);
        changes.emit("orders");
        await heardOf();
        expect(heard).toEqual(["orders"]);
        clearInterval(stream);
    });

    it("waits for a write to the collection in flight, then tells once a quiet window after it lands", async () => {
        const changes = createDataChanges();
        let calls = 0;
        changes.subscribe("posts", () => calls++);

        const settled = changes.writing("posts");
        changes.emit("posts");
        await jest.advanceTimersByTimeAsync(400);
        expect(calls).toBe(0);

        // The write fails: nothing more to wait for.
        settled();
        await jest.advanceTimersByTimeAsync(CHANGE_QUIET_MS);
        expect(calls).toBe(1);
    });

    it("tells of a lone change within a tenth of a second, and of a stream of changes within a second", async () => {
        // What reads as instant, and the progress a long run of writes shows.
        const changes = createDataChanges();
        let calls = 0;
        changes.subscribe("posts", () => calls++);
        changes.emit("posts");
        await jest.advanceTimersByTimeAsync(100);
        expect(calls).toBe(1);

        const stream = setInterval(() => changes.emit("posts"), 20);
        // Its first change is one interval in.
        await jest.advanceTimersByTimeAsync(20 + 1_000 + 1);
        clearInterval(stream);
        expect(calls).toBe(2);
    });

    it("holds a burst for a write sent under the collection's slug when the change is said under its stored path", async () => {
        const changes = createDataChanges((path) => path === "orders" ? "public.orders" : path);
        let calls = 0;
        changes.subscribe("orders", () => calls++);

        const settled = changes.writing("orders");
        changes.emit("public.orders");
        await jest.advanceTimersByTimeAsync(400);
        expect(calls).toBe(0);
        settled();
        await heardOf();
        expect(calls).toBe(1);
    });

    it("waits for every write in flight, however often one of them says it settled", async () => {
        const changes = createDataChanges();
        let calls = 0;
        changes.subscribe("posts", () => calls++);

        const first = changes.writing("posts");
        const second = changes.writing("posts");
        changes.emit("posts");
        first();
        first();
        await jest.advanceTimersByTimeAsync(400);
        expect(calls).toBe(0);
        second();
        await heardOf();
        expect(calls).toBe(1);
    });

    it("waits for a write in flight no longer than the maximum wait", async () => {
        const changes = createDataChanges();
        let calls = 0;
        changes.subscribe("posts", () => calls++);

        changes.writing("posts");
        changes.emit("posts");
        await jest.advanceTimersByTimeAsync(CHANGE_MAX_WAIT_MS - 1);
        expect(calls).toBe(0);
        await jest.advanceTimersByTimeAsync(1);
        expect(calls).toBe(1);
    });
});

describe("withDataChanges", () => {
    function fakeData(writes: string[]): RebaseData {
        const accessor = fakeTableAccessor("posts", {
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
        });
        return rebaseDataOver(() => accessor);
    }

    /** Writes that each answer `ms` later, in a task of their own, as an HTTP response or an MCP reply does. */
    function slowData(ms: (index: number) => number): RebaseData {
        let sent = 0;
        const accessor = fakeTableAccessor("posts", {
            update: (id) => {
                const index = sent++;
                return new Promise<Entity>((resolve) => setTimeout(() => resolve({ id, path: "posts", values: {} }), ms(index)));
            }
        });
        return rebaseDataOver(() => accessor);
    }

    it("says so after each write that succeeds, under the path asked for, and not after a read", async () => {
        const changes = createDataChanges();
        const emitted: string[] = [];
        changes.subscribe("posts", () => emitted.push("posts"));
        changes.subscribe("blog_posts", () => emitted.push("blog_posts"));
        const writes: string[] = [];
        const data = withDataChanges(fakeData(writes), changes);

        await data.table("posts").find();
        await heardOf();
        expect(emitted).toEqual([]);

        await data.table("posts").create({});
        await heardOf();
        await data.table("posts").update(1, {});
        await heardOf();
        await data.table("posts").deleteMany!([1]);
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
        const failing = rebaseDataOver((slug) => fakeTableAccessor(slug, { create: async () => Promise.reject(new Error("refused")) }));
        const data = withDataChanges(failing, changes);

        await expect(data.table("posts").create({})).rejects.toThrow("refused");
        await heardOf();
        expect(emitted).toBe(0);
        expect(data.table("posts").createMany).toBeUndefined();
    });

    it("says so after a batch update and the trash's purges", async () => {
        const changes = createDataChanges();
        let emitted = 0;
        changes.subscribe("posts", () => emitted++);
        const accessor = fakeTableAccessor("posts", {
            update: async () => ({ id: 1, path: "posts", values: {} }),
            updateMany: async () => [],
            trash: {
                find: async () => ({ data: [], meta: { total: 0, limit: 50, offset: 0, hasMore: false } }),
                count: async () => 0,
                purge: async () => undefined,
                purgeMany: async () => undefined
            }
        });
        const data = withDataChanges(rebaseDataOver(() => accessor), changes);

        await data.table("posts").updateMany!([{ id: 1, data: {} }]);
        await heardOf();
        await data.table("posts").trash!.purge(1);
        await heardOf();
        await data.table("posts").trash!.purgeMany!([1]);
        await heardOf();
        expect(emitted).toBe(3);
    });

    it("lets go of a write that failed, so the next change is heard a quiet window on", async () => {
        const changes = createDataChanges();
        let heard = 0;
        changes.subscribe("posts", () => heard++);

        expect(() => signalWrite(changes, "posts", () => {
            throw new Error("not sent");
        })).toThrow("not sent");
        await expect(signalWrite(changes, "posts", () => Promise.reject(new Error("refused")))).rejects.toThrow("refused");

        changes.emit("posts");
        await heardOf();
        expect(heard).toBe(1);
    });

    it("reads each view again once for 20 writes sent one after another, each reply in a task of its own", async () => {
        const changes = createDataChanges();
        const reads = { table: 0, board: 0 };
        changes.subscribe("posts", () => reads.table++);
        changes.subscribe("posts", () => reads.board++);
        const data = withDataChanges(slowData(() => 40), changes);

        const run = (async () => {
            for (let i = 0; i < 20; i++) await data.table("posts").update(i, { status: "done" });
        })();
        await jest.advanceTimersByTimeAsync(20 * 40);
        await run;
        expect(reads).toEqual({ table: 0, board: 0 });
        await heardOf();
        expect(reads).toEqual({ table: 1, board: 1 });
    });

    it("reads a view again once for writes sent one after another that each take longer than the quiet window", async () => {
        const changes = createDataChanges();
        let reads = 0;
        changes.subscribe("posts", () => reads++);
        // An MCP round trip through the host: the view waits for the next
        // write, in flight, rather than reading between each two.
        const data = withDataChanges(slowData(() => 4 * CHANGE_QUIET_MS), changes);

        const run = (async () => {
            for (let i = 0; i < 4; i++) await data.table("posts").update(i, { status: "done" });
        })();
        await jest.advanceTimersByTimeAsync(4 * 4 * CHANGE_QUIET_MS);
        await run;
        expect(reads).toBe(0);
        await heardOf();
        expect(reads).toBe(1);
    });

    it("reads each view again once for 20 writes sent together whose replies land in separate tasks", async () => {
        const changes = createDataChanges();
        let reads = 0;
        changes.subscribe("posts", () => reads++);
        const data = withDataChanges(slowData((index) => 100 + index * 7), changes);

        const all = Promise.all(Array.from({ length: 20 }, (_, i) => data.table("posts").update(i, { status: "done" })));
        await jest.advanceTimersByTimeAsync(100 + 19 * 7);
        await all;
        expect(reads).toBe(0);
        await heardOf();
        expect(reads).toBe(1);
    });

    it("reads a view again a quiet window after a lone write lands", async () => {
        const changes = createDataChanges();
        let reads = 0;
        changes.subscribe("posts", () => reads++);
        const data = withDataChanges(slowData(() => 30), changes);

        const write = data.table("posts").update(1, { status: "done" });
        await jest.advanceTimersByTimeAsync(30);
        await write;
        await jest.advanceTimersByTimeAsync(CHANGE_QUIET_MS - 1);
        expect(reads).toBe(0);
        await jest.advanceTimersByTimeAsync(1);
        expect(reads).toBe(1);
    });
});

describe("useDataChangeVersion", () => {
    it("grows with each change heard, and never for a view whose data source subscribes", async () => {
        const changes = createDataChanges();
        const wrapper = ({ children }: { children: React.ReactNode }) =>
            React.createElement(DataChangesContext.Provider, { value: changes }, children);
        const live = renderHook(() => useDataChangeVersion("posts", false), { wrapper });
        const polled = renderHook(() => useDataChangeVersion("posts", true), { wrapper });

        await act(async () => {
            changes.emit("posts");
            await heardOf();
        });
        expect(polled.result.current).toBe(1);
        expect(live.result.current).toBe(0);
    });
});
