import {
    isArrayValue,
    isRecordValue,
    readStoredJson,
    readStoredString,
    writeStoredJson,
    writeStoredString,
    type WebStorageLike
} from "../src/storage";

/** A `localStorage` stand-in, so none of this depends on a DOM. */
function fakeStorage(seed: Record<string, string> = {}): WebStorageLike {
    const map = new Map(Object.entries(seed));
    return {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => { map.set(key, value); },
        removeItem: (key) => { map.delete(key); }
    };
}

/** Storage that is present but refuses every operation, as Safari's does. */
function throwingStorage(): WebStorageLike {
    return {
        getItem: () => { throw new DOMException("denied", "SecurityError"); },
        setItem: () => { throw new DOMException("denied", "SecurityError"); },
        removeItem: () => { throw new DOMException("denied", "SecurityError"); }
    };
}

describe("readStoredJson", () => {

    it("returns the stored value when it parses and is accepted", () => {
        const storage = fakeStorage({ tabs: JSON.stringify([{ id: "1" }]) });
        expect(readStoredJson("tabs", { fallback: [], accept: isArrayValue, storage }))
            .toEqual([{ id: "1" }]);
    });

    it("falls back when the key was never written", () => {
        expect(readStoredJson("tabs", { fallback: [], storage: fakeStorage() })).toEqual([]);
    });

    it("falls back on an empty string, which no JSON value serialises to", () => {
        expect(readStoredJson("tabs", { fallback: [], storage: fakeStorage({ tabs: "" }) })).toEqual([]);
    });

    // The read used to be `JSON.parse(localStorage.getItem(key)!)` inside a
    // `useState` initializer, so this threw during render — and, because the
    // value stayed in storage, threw again on every reload.
    it("falls back on text that is not JSON, rather than throwing", () => {
        const storage = fakeStorage({ tabs: "{not json" });
        expect(() => readStoredJson("tabs", { fallback: [], storage })).not.toThrow();
        expect(readStoredJson("tabs", { fallback: [], storage })).toEqual([]);
    });

    // Valid JSON of the wrong shape is what an upgrade produces: the previous
    // release wrote an object where this one calls `.map`.
    it("falls back on valid JSON of a shape the caller rejects", () => {
        const storage = fakeStorage({ tabs: JSON.stringify({ id: "1" }) });
        expect(readStoredJson("tabs", { fallback: [], accept: isArrayValue, storage })).toEqual([]);
    });

    it("returns the wrong shape when the caller asks for no check", () => {
        // `accept` is opt-in, so this documents that omitting it means trusting
        // whatever is there — which is why the array callers all pass it.
        const storage = fakeStorage({ tabs: JSON.stringify({ id: "1" }) });
        expect(readStoredJson("tabs", { fallback: [] as unknown, storage })).toEqual({ id: "1" });
    });

    it("falls back when storage is absent", () => {
        expect(readStoredJson("tabs", { fallback: [], storage: null })).toEqual([]);
    });

    it("falls back when storage is present but throws on access", () => {
        expect(readStoredJson("tabs", { fallback: [], storage: throwingStorage() })).toEqual([]);
    });

    it("preserves a falsy-but-valid stored value", () => {
        const storage = fakeStorage({ n: "0", f: "false" });
        expect(readStoredJson("n", { fallback: 99, storage })).toBe(0);
        expect(readStoredJson("f", { fallback: true, storage })).toBe(false);
    });

    it("leaves a rejected value in place rather than clearing it", () => {
        const storage = fakeStorage({ tabs: "{not json" });
        readStoredJson("tabs", { fallback: [], storage });
        expect(storage.getItem("tabs")).toBe("{not json");
    });
});

describe("writeStoredJson", () => {

    it("round-trips through readStoredJson", () => {
        const storage = fakeStorage();
        expect(writeStoredJson("widths", { a: 10 }, { storage })).toBe(true);
        expect(readStoredJson("widths", { fallback: {}, accept: isRecordValue, storage })).toEqual({ a: 10 });
    });

    // A view that persists query text on every edit reaches the origin's quota,
    // and `setItem` throws synchronously out of the effect doing the writing.
    it("reports failure instead of throwing when the quota is full", () => {
        const storage: WebStorageLike = {
            getItem: () => null,
            setItem: () => { throw new DOMException("full", "QuotaExceededError"); },
            removeItem: () => { /* noop */ }
        };
        expect(() => writeStoredJson("tabs", [1, 2, 3], { storage })).not.toThrow();
        expect(writeStoredJson("tabs", [1, 2, 3], { storage })).toBe(false);
    });

    it("reports failure when storage is absent", () => {
        expect(writeStoredJson("tabs", [], { storage: null })).toBe(false);
    });
});

describe("string helpers", () => {

    it("round-trip a plain value", () => {
        const storage = fakeStorage();
        expect(writeStoredString("db", "main", { storage })).toBe(true);
        expect(readStoredString("db", { storage })).toBe("main");
    });

    it("survive storage that throws", () => {
        expect(writeStoredString("db", "main", { storage: throwingStorage() })).toBe(false);
        expect(readStoredString("db", { storage: throwingStorage() })).toBeNull();
    });

    it("report an absent key as null", () => {
        expect(readStoredString("db", { storage: fakeStorage() })).toBeNull();
    });
});

describe("shape predicates", () => {
    it("isArrayValue accepts only arrays", () => {
        expect(isArrayValue([])).toBe(true);
        expect(isArrayValue([1])).toBe(true);
        expect(isArrayValue({})).toBe(false);
        expect(isArrayValue(null)).toBe(false);
        expect(isArrayValue("[]")).toBe(false);
    });

    it("isRecordValue accepts keyed objects and rejects arrays and null", () => {
        expect(isRecordValue({})).toBe(true);
        expect(isRecordValue({ a: 1 })).toBe(true);
        expect(isRecordValue([])).toBe(false);
        expect(isRecordValue(null)).toBe(false);
        expect(isRecordValue(4)).toBe(false);
    });
});
