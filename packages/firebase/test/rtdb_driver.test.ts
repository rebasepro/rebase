import { afterAll, describe, expect, it, jest } from "@jest/globals";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { deleteApp, FirebaseApp, initializeApp } from "firebase/app";
import { getDatabase, goOffline, ref, set } from "firebase/database";
import { DataDriver } from "@rebasepro/types";
import { useFirebaseRTDBDelegate } from "../src/hooks/useFirebaseRealTimeDBDelegate";

/*
 * The driver runs against a real Realtime Database client with its connection
 * taken offline, so every write lands in the client's local view and every
 * query is evaluated by the SDK itself — ordering, bounds and all.
 *
 * Offline, two things never settle: a write's promise waits for a server
 * acknowledgement, and `get()` asks the server. Both are answered from the local
 * view instead, which is exactly what the SDK would answer from once the server
 * had acknowledged the writes.
 */
jest.mock("firebase/database", () => {
    const actual = jest.requireActual<typeof import("firebase/database")>("firebase/database");
    const settled = (write: Promise<void>): Promise<void> => {
        write.catch(() => undefined);
        return Promise.resolve();
    };
    return {
        ...actual,
        set: (...args: Parameters<typeof actual.set>) => settled(actual.set(...args)),
        update: (...args: Parameters<typeof actual.update>) => settled(actual.update(...args)),
        remove: (...args: Parameters<typeof actual.remove>) => settled(actual.remove(...args)),
        get: (query: Parameters<typeof actual.get>[0]) =>
            new Promise((resolve, reject) => actual.onValue(query, resolve, reject, { onlyOnce: true }))
    };
});

const app: FirebaseApp = initializeApp({
    projectId: "demo-rtdb-driver",
    apiKey: "offline",
    appId: "offline",
    databaseURL: "http://127.0.0.1:9000/?ns=demo-rtdb-driver"
}, "rtdb-driver-test");
const database = getDatabase(app);
goOffline(database);

afterAll(() => deleteApp(app));

/** The delegate is a hook; render it once and keep what it returned. */
function renderDriver(firebaseApp: FirebaseApp): DataDriver {
    let driver: DataDriver | undefined;
    function Probe() {
        driver = useFirebaseRTDBDelegate({ firebaseApp });
        return null;
    }
    renderToString(createElement(Probe));
    if (!driver) throw new Error("the delegate did not render");
    return driver;
}

const driver = renderDriver(app);

/** Let the client raise the events a local write or a new listener queued. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Seed a whole node, so the local view of it is complete. */
function seed(path: string, value: Record<string, unknown>): void {
    set(ref(database, path), value).catch(() => undefined);
}

describe("useFirebaseRTDBDelegate", () => {

    describe("save", () => {

        it("an update of an existing row keeps every field it does not name", async () => {
            seed("partial_users", {});
            await driver.save({
                path: "partial_users",
                id: "u1",
                values: { name: "bob", email: "bob@x.io", role: "admin" },
                status: "new"
            });

            // What the SDK's `update(id, { name })` and the admin form's save of
            // one changed property both send.
            await driver.save({
                path: "partial_users",
                id: "u1",
                values: { name: "robert" },
                status: "existing"
            });

            expect(await driver.fetchOne({ path: "partial_users", id: "u1" })).toEqual({
                id: "u1",
                name: "robert",
                email: "bob@x.io",
                role: "admin"
            });
        });

        it("an update that clears a field removes only that field", async () => {
            seed("cleared_users", { u1: { name: "bob", email: "bob@x.io", role: "admin" } });

            await driver.save({
                path: "cleared_users",
                id: "u1",
                values: { role: null },
                status: "existing"
            });

            expect(await driver.fetchOne({ path: "cleared_users", id: "u1" })).toEqual({
                id: "u1",
                name: "bob",
                email: "bob@x.io"
            });
        });

        it("a create writes the row it is given", async () => {
            seed("created_users", {});
            const saved = await driver.save({
                path: "created_users",
                values: { name: "zoe" },
                status: "new"
            });

            expect(typeof saved.id).toBe("string");
            expect(await driver.fetchOne({ path: "created_users", id: String(saved.id) }))
                .toEqual({ id: saved.id, name: "zoe" });
        });

    });

    describe("reads", () => {

        const people = {
            a1: { name: "zed", age: 50 },
            b2: { name: "amy", age: 10 },
            c3: { name: "bob", age: 30 },
            d4: { name: "cat", age: 20 }
        };

        it("an ordered read comes back in that order", async () => {
            seed("people_ordered", people);

            const rows = await driver.fetchCollection({ path: "people_ordered", orderBy: "age" });

            // In key order — how the plain object `val()` lists them — this was
            // a1, b2, c3, d4.
            expect(rows.map((row) => `${row.id}:${row.age}`)).toEqual(["b2:10", "d4:20", "c3:30", "a1:50"]);
        });

        it("a page of an ordered read is that page of the order", async () => {
            seed("people_paged", people);

            const rows = await driver.fetchCollection({
                path: "people_paged",
                orderBy: "age",
                limit: 2,
                offset: 2
            });

            expect(rows.map((row) => `${row.id}:${row.age}`)).toEqual(["c3:30", "a1:50"]);
        });

        it("a live page of an ordered read is that page of the order", async () => {
            seed("people_live", people);
            const { listenCollection } = driver;
            if (!listenCollection) throw new Error("the delegate cannot listen");

            const updates: Record<string, unknown>[][] = [];
            const unsubscribe = listenCollection({
                path: "people_live",
                orderBy: "age",
                limit: 2,
                offset: 2,
                onUpdate: (rows) => updates.push(rows)
            });
            await settle();
            unsubscribe();

            expect(updates.at(-1)?.map((row) => `${row.id}:${row.age}`)).toEqual(["c3:30", "a1:50"]);
        });

    });

    describe("checkUniqueField", () => {

        seed("unique_users", {
            u1: { email: "bob@x.io" },
            u2: { email: "zoe@x.io" },
            u3: { email: "dup@x.io" },
            u4: { email: "dup@x.io" }
        });

        const isUnique = (value: unknown, id?: string) => {
            const { checkUniqueField } = driver;
            if (!checkUniqueField) throw new Error("the delegate cannot check uniqueness");
            return checkUniqueField("unique_users", "email", value, id);
        };

        it("a value no row has is unique", async () => {
            // `startAt` found bob@x.io — the first value sorting after
            // alice@x.io — and answered "taken".
            expect(await isUnique("alice@x.io")).toBe(true);
        });

        it("a value another row has is not", async () => {
            expect(await isUnique("bob@x.io")).toBe(false);
            expect(await isUnique("bob@x.io", "u2")).toBe(false);
        });

        it("the row being edited does not collide with itself", async () => {
            expect(await isUnique("bob@x.io", "u1")).toBe(true);
        });

        it("the row being edited does not hide a second row with its value", async () => {
            expect(await isUnique("dup@x.io", "u3")).toBe(false);
            expect(await isUnique("dup@x.io", "u4")).toBe(false);
        });

    });

});
