import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { deleteApp, initializeApp } from "firebase/app";
import { getFirestore, terminate } from "firebase/firestore";

/**
 * `useFirestoreDataSource` hands `<Rebase>` the same entry on every render.
 *
 * `<Rebase>` rebuilds the data layer — and every view refetches — when an
 * entry's driver changes identity, so an entry written inline in
 * `dataSources={[useFirestoreDataSource(…)]}` must not be a new driver per
 * render. This package's tests run without a DOM, so the hook runs here under
 * a minimal hooks runtime: each call of `render` is one render of one
 * component, with `useMemo`/`useCallback`/`useRef` kept by call order and
 * recomputed when their dependencies change — React's rules, nothing more.
 */

type Slot = { deps?: readonly unknown[]; value: unknown };
const slots: Slot[] = [];
let cursor = 0;

function sameDeps(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
    return a !== undefined && b !== undefined && a.length === b.length && a.every((dep, i) => Object.is(dep, b[i]));
}

function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T {
    const index = cursor++;
    const slot = slots[index];
    if (slot && sameDeps(slot.deps, deps)) return slot.value as T;
    const value = factory();
    slots[index] = { deps, value };
    return value;
}

jest.mock("react", () => ({
    useMemo,
    useCallback: <T>(callback: T, deps?: readonly unknown[]): T => useMemo(() => callback, deps),
    useRef: <T>(initial: T): { current: T } => useMemo(() => ({ current: initial }), []),
    useEffect: () => undefined
}));

// After the mock, so the hooks read it.
import { useFirestoreDataSource, type FirestoreDataSourceOptions } from "../src/hooks/useFirestoreDataSource";
import { FIRESTORE_CAPABILITIES } from "../src/capabilities";

/** A component that calls the hook with `options`; one call is one render. */
function DataSourceComponent(options: FirestoreDataSourceOptions) {
    return useFirestoreDataSource(options);
}

function render(options: FirestoreDataSourceOptions) {
    cursor = 0;
    return DataSourceComponent(options);
}

const firebaseApp = initializeApp({ projectId: "demo-data-source", apiKey: "offline", appId: "offline" }, "data-source-test");
afterAll(() => terminate(getFirestore(firebaseApp)).then(() => deleteApp(firebaseApp)));

describe("useFirestoreDataSource", () => {

    beforeEach(() => {
        slots.length = 0;
    });

    it("is the entry <Rebase dataSources> takes: a direct Firestore source with its driver", () => {
        const source = render({ key: "firestore", firebaseApp, databaseId: "events-db", label: "Live events" });
        expect(source).toMatchObject({
            key: "firestore",
            engine: "firestore",
            transport: "direct",
            databaseId: "events-db",
            label: "Live events"
        });
        expect(source.driver.key).toBe("firestore");
        expect(source.driver.initialised).toBe(true);
    });

    it("is the same object, driver included, on every render with the same options", () => {
        const first = render({ key: "firestore", firebaseApp });
        // A new options object each render, as an inline call writes it.
        const second = render({ key: "firestore", firebaseApp });
        expect(second).toBe(first);
        expect(second.driver).toBe(first.driver);
    });

    it("is a new entry when what it describes changes", () => {
        const first = render({ key: "firestore", firebaseApp });
        const renamed = render({ key: "analytics", firebaseApp });
        expect(renamed).not.toBe(first);
        expect(renamed.key).toBe("analytics");
    });

    it("reports itself not initialised until the Firebase app is", () => {
        expect(render({ key: "firestore" }).driver.initialised).toBe(false);
    });

    it("registers Firestore's capabilities when it runs", () => {
        const key = Symbol.for("@rebasepro/types.dataSourceCapabilities.v1");
        const registered: unknown = Reflect.get(globalThis, key);
        if (registered instanceof Map) registered.delete("firestore");
        render({ key: "firestore", firebaseApp });
        const after: unknown = Reflect.get(globalThis, key);
        expect(after instanceof Map ? after.get("firestore") : undefined).toBe(FIRESTORE_CAPABILITIES);
    });
});
