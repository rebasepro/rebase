import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { deleteApp, initializeApp } from "firebase/app";
import { disableNetwork, doc, getFirestore, setDoc, terminate } from "firebase/firestore";
import {
    FirestoreDataDriver,
    listenToSearchResults,
    readSearchResults,
    useFirestoreDriver
} from "../src/hooks/useFirestoreDriver";

/** A promise and the handles to settle it from outside. */
function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: Error) => void = () => undefined;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Let settled promises run their callbacks. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A stand-in for the per-document listener: records which ids were listened
 * to, and lets a test push a document's state for each.
 */
function fakeDocuments() {
    const listeners = new Map<string, (row: Record<string, unknown> | null) => void>();
    const closed: string[] = [];
    return {
        listenOne: (id: string, onRow: (row: Record<string, unknown> | null) => void) => {
            listeners.set(id, onRow);
            return () => {
                closed.push(id);
            };
        },
        push: (id: string, row: Record<string, unknown> | null) => {
            const onRow = listeners.get(id);
            if (!onRow) throw new Error(`nothing listens to ${id}`);
            onRow(row);
        },
        listened: () => Array.from(listeners.keys()),
        closed
    };
}

describe("listenToSearchResults", () => {

    it("opens no listener for a search cancelled before it answered", async () => {
        const ids = deferred<readonly string[] | undefined>();
        const documents = fakeDocuments();
        const updates: Record<string, unknown>[][] = [];

        const unsubscribe = listenToSearchResults({
            ids: ids.promise,
            listenOne: documents.listenOne,
            onUpdate: (rows) => updates.push(rows)
        });
        // The list moved on — a new search string — before the index answered.
        unsubscribe();
        ids.resolve(["a", "b"]);
        await settle();

        // These listeners were opened after their only unsubscribe had run,
        // so nothing could ever close them.
        expect(documents.listened()).toEqual([]);
        expect(updates).toEqual([]);
    });

    it("delivers a change to a row it already found", async () => {
        const documents = fakeDocuments();
        const updates: Record<string, unknown>[][] = [];
        listenToSearchResults({
            ids: Promise.resolve(["a", "b"]),
            listenOne: documents.listenOne,
            onUpdate: (rows) => updates.push(rows)
        });
        await settle();

        documents.push("a", { id: "a", title: "first" });
        documents.push("b", { id: "b", title: "second" });
        documents.push("a", { id: "a", title: "first, edited" });

        expect(updates.at(-1)).toEqual([
            { id: "a", title: "first, edited" },
            { id: "b", title: "second" }
        ]);
    });

    it("keeps a deleted row out of every later update", async () => {
        const documents = fakeDocuments();
        const updates: Record<string, unknown>[][] = [];
        listenToSearchResults({
            ids: Promise.resolve(["a", "b"]),
            listenOne: documents.listenOne,
            onUpdate: (rows) => updates.push(rows)
        });
        await settle();

        documents.push("a", { id: "a" });
        documents.push("b", { id: "b" });
        documents.push("a", null);
        expect(updates.at(-1)).toEqual([{ id: "b" }]);

        // The delete filtered a copy and left the row in place, so the next
        // change to any other row brought it back.
        documents.push("b", { id: "b", title: "edited" });
        expect(updates.at(-1)).toEqual([{ id: "b", title: "edited" }]);
    });

    it("lists rows in the order the search ranked them", async () => {
        const documents = fakeDocuments();
        const updates: Record<string, unknown>[][] = [];
        listenToSearchResults({
            ids: Promise.resolve(["best", "good"]),
            listenOne: documents.listenOne,
            onUpdate: (rows) => updates.push(rows)
        });
        await settle();

        documents.push("good", { id: "good" });
        documents.push("best", { id: "best" });

        expect(updates.at(-1)).toEqual([{ id: "best" }, { id: "good" }]);
    });

    it("listens only to the requested window of hits", async () => {
        const documents = fakeDocuments();
        listenToSearchResults({
            ids: Promise.resolve(["a", "b", "c", "d"]),
            limit: 2,
            offset: 1,
            listenOne: documents.listenOne,
            onUpdate: () => undefined
        });
        await settle();

        expect(documents.listened()).toEqual(["b", "c"]);
    });

    it("answers a search with no hits with an empty list", async () => {
        const documents = fakeDocuments();
        const updates: Record<string, unknown>[][] = [];
        listenToSearchResults({
            ids: Promise.resolve([]),
            listenOne: documents.listenOne,
            onUpdate: (rows) => updates.push(rows)
        });
        await settle();

        expect(updates).toEqual([[]]);
    });

    it("reports a search that fails", async () => {
        const ids = deferred<readonly string[] | undefined>();
        const errors: Error[] = [];
        listenToSearchResults({
            ids: ids.promise,
            listenOne: fakeDocuments().listenOne,
            onUpdate: () => undefined,
            onError: (error) => errors.push(error)
        });
        ids.reject(new Error("index unavailable"));
        await settle();

        expect(errors.map((error) => error.message)).toEqual(["index unavailable"]);
    });

    it("closes every listener it opened", async () => {
        const documents = fakeDocuments();
        const unsubscribe = listenToSearchResults({
            ids: Promise.resolve(["a", "b"]),
            listenOne: documents.listenOne,
            onUpdate: () => undefined
        });
        await settle();
        unsubscribe();

        expect(documents.closed).toEqual(["a", "b"]);
    });

});

describe("readSearchResults", () => {

    it("reads the window of hits, in rank order, leaving out a hit that is gone", async () => {
        const stored: Record<string, Record<string, unknown>> = {
            a: { id: "a" },
            c: { id: "c" },
            d: { id: "d" }
        };
        const rows = await readSearchResults({
            ids: ["d", "b", "c", "a"],
            limit: 3,
            offset: 0,
            readOne: async (id) => stored[id]
        });

        expect(rows).toEqual([{ id: "d" }, { id: "c" }]);
    });

    it("skips the offset", async () => {
        const rows = await readSearchResults({
            ids: ["a", "b", "c"],
            offset: 1,
            readOne: async (id) => ({ id })
        });

        expect(rows).toEqual([{ id: "b" }, { id: "c" }]);
    });

});

describe("useFirestoreDriver", () => {

    const app = initializeApp({
        projectId: "demo-firestore-driver",
        apiKey: "offline",
        appId: "offline"
    }, "firestore-driver-test");
    const firestore = getFirestore(app);

    /** The driver is a hook; render it once and keep what it returned. */
    function renderDriver(): FirestoreDataDriver {
        let driver: FirestoreDataDriver | undefined;
        function Probe() {
            driver = useFirestoreDriver({ firebaseApp: app });
            return null;
        }
        renderToString(createElement(Probe));
        if (!driver) throw new Error("the driver did not render");
        return driver;
    }

    const driver = renderDriver();

    beforeAll(async () => {
        // Offline, a write lands in the local cache, and a query is answered
        // from there by the SDK's own query engine.
        await disableNetwork(firestore);
        const people: Record<string, { name: string, age: number }> = {
            a1: { name: "zed", age: 50 },
            b2: { name: "amy", age: 10 },
            c3: { name: "bob", age: 30 },
            d4: { name: "cat", age: 20 }
        };
        for (const [id, values] of Object.entries(people)) {
            setDoc(doc(firestore, "people", id), values).catch(() => undefined);
        }
        jest.spyOn(console, "debug").mockImplementation(() => undefined);
    });

    afterAll(() => terminate(firestore).then(() => deleteApp(app)));

    it("a live page past the first is that page", async () => {
        const { listenCollection } = driver;
        if (!listenCollection) throw new Error("the driver cannot listen");

        let unsubscribe: () => void = () => undefined;
        const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
            unsubscribe = listenCollection({
                path: "people",
                orderBy: "age",
                order: "asc",
                limit: 2,
                offset: 2,
                onUpdate: resolve,
                onError: reject
            });
        });
        unsubscribe();

        expect(rows.map((row) => `${row.id}:${row.age}`)).toEqual(["c3:30", "a1:50"]);
    });

    it("a fetch with a search string does not answer with the whole collection", async () => {
        // No search controller is configured, so there is nothing that can
        // answer a search — and the read says so, instead of ignoring the
        // search string and returning every row.
        await expect(driver.fetchCollection({ path: "people", searchString: "bob" }))
            .rejects.toThrow(/FirestoreTextSearchController/);
    });

    it("a count with a search string does not count the whole collection", async () => {
        const { count } = driver;
        if (!count) throw new Error("the driver cannot count");

        await expect(count({ path: "people", searchString: "bob" }))
            .rejects.toThrow(/FirestoreTextSearchController/);
    });

});
