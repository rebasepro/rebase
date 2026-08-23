import {
    readStoredString,
    removeStoredString,
    writeStoredString
} from "../src/util/local_storage";

/**
 * These helpers exist because `typeof window !== "undefined"` was the guard at
 * every call site and it answers the wrong question — "am I in a browser",
 * not "can I read storage".
 *
 * Each case below is a real shape that guard lets through. The third is how it
 * was found: a saas/frontend run in which all 709 tests passed and the suite
 * still failed, on `TypeError: localStorage.getItem is not a function` thrown
 * out of a React render after jsdom had been disposed.
 */
describe("localStorage helpers survive a storage that does not work", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");

    const installStorage = (value: unknown): void => {
        Object.defineProperty(window, "localStorage", {
            configurable: true,
            get: () => value
        });
    };

    afterEach(() => {
        if (original) Object.defineProperty(window, "localStorage", original);
    });

    it("reads through a working store", () => {
        window.localStorage.setItem("k", "v");
        expect(readStoredString("k")).toBe("v");
    });

    it("returns null when reading the property throws", () => {
        // Safari private mode, a blocked cookie policy, a sandboxed iframe:
        // the SecurityError is raised on ACCESS, before any method is called,
        // so null-checking the result never sees it.
        Object.defineProperty(window, "localStorage", {
            configurable: true,
            get: () => { throw new Error("SecurityError: storage is disabled"); }
        });
        expect(readStoredString("k")).toBeNull();
        expect(() => writeStoredString("k", "v")).not.toThrow();
        expect(() => removeStoredString("k")).not.toThrow();
    });

    it("returns null when the store is a husk with no methods", () => {
        // A torn-down jsdom: `window` survives, `localStorage` is an object,
        // and `getItem` is gone. This is the exact failure that was observed.
        installStorage({});
        expect(readStoredString("k")).toBeNull();
        expect(() => writeStoredString("k", "v")).not.toThrow();
        expect(() => removeStoredString("k")).not.toThrow();
    });

    it("returns null when the store is absent", () => {
        installStorage(undefined);
        expect(readStoredString("k")).toBeNull();
        expect(() => writeStoredString("k", "v")).not.toThrow();
    });

    it("does not throw when a write is refused", () => {
        // A full store throws on setItem and reads perfectly well.
        installStorage({
            getItem: () => "v",
            setItem: () => { throw new Error("QuotaExceededError"); },
            removeItem: () => undefined
        });
        expect(readStoredString("k")).toBe("v");
        expect(() => writeStoredString("k", "v")).not.toThrow();
    });
});
