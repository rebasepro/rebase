import { describe, expect, it, afterEach } from "@jest/globals";
import { setIn, getIn } from "../src/objects";

/**
 * The same defect as `@rebasepro/forms`' `setIn`, in the second copy of it.
 *
 * Two implementations of "deeply set a value at a dotted path" exist in this
 * workspace — this one and the form engine's — and they were the same code, so
 * they had the same hole: `res["__proto__"] = …` assigns the object's prototype
 * rather than an own property, and the write lands on `Object.prototype`.
 *
 * This copy is worse placed. `@rebasepro/utils` is a core dependency of the
 * server as well as the client, so the polluted prototype is a *backend*
 * process's, shared by every request it goes on to serve.
 */
const KEYS = ["utilsPolluted", "utilsPolluted2"];

afterEach(() => {
    for (const key of KEYS) {
        delete (Object.prototype as Record<string, unknown>)[key];
        delete (Array.prototype as unknown as Record<string, unknown>)[key];
    }
});

describe("setIn cannot reach the prototype chain", () => {
    it("refuses __proto__", () => {
        setIn({}, "__proto__.utilsPolluted", "yes");

        expect(({} as Record<string, unknown>).utilsPolluted).toBeUndefined();
    });

    it("refuses constructor.prototype", () => {
        setIn({}, "constructor.prototype.utilsPolluted2", "yes");

        expect(({} as Record<string, unknown>).utilsPolluted2).toBeUndefined();
    });

    it("still sets ordinary and nested paths", () => {
        expect(setIn({ a: 1 }, "b.c", 2)).toEqual({ a: 1, b: { c: 2 } });
        expect(setIn({}, "a[0].b", "x")).toEqual({ a: [{ b: "x" }] });
    });
});

describe("getIn cannot read through the prototype chain", () => {
    it("does not hand back Object.prototype", () => {
        expect(getIn({}, "__proto__")).toBeUndefined();
        expect(getIn({}, "constructor.prototype")).toBeUndefined();
    });
});
