import { describe, expect, it, afterEach } from "@jest/globals";
import { setIn, getIn } from "../src/utils";

/**
 * `setIn` writes a value at a dotted path. Nothing stopped that path from
 * naming the prototype chain.
 *
 * `setIn({}, "__proto__.polluted", "x")` assigned through `res["__proto__"]`,
 * which is a setter for the object's prototype rather than an own property — so
 * the write landed on `Object.prototype` and every object in the process gained
 * a `polluted` property. `constructor.prototype.x` reached it a second way, and
 * `__proto__.0` did the same to arrays.
 *
 * `setIn` is exported from `@rebasepro/forms`, and inside the admin it is the
 * function that writes a form field, keyed by a *path*. Paths are property keys
 * — which for a map property, or for a column mapped out of an imported CSV,
 * are data rather than code.
 *
 * These assertions have to run in a process where nothing else has already
 * polluted the prototype, and they clean up after themselves so a failure
 * cannot cascade into unrelated suites.
 */
const OBJECT_KEYS = ["polluted", "polluted2", "polluted3"];

afterEach(() => {
    for (const key of OBJECT_KEYS) {
        delete (Object.prototype as Record<string, unknown>)[key];
        delete (Array.prototype as unknown as Record<string, unknown>)[key];
    }
    delete (Array.prototype as unknown as Record<string, unknown>)["0"];
});

describe("setIn cannot reach the prototype chain", () => {
    it("refuses __proto__", () => {
        setIn({}, "__proto__.polluted", "yes");

        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("refuses constructor.prototype", () => {
        setIn({}, "constructor.prototype.polluted2", "yes");

        expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
    });

    it("refuses a nested __proto__ segment", () => {
        setIn({ a: {} }, "a.__proto__.polluted3", "yes");

        expect(({} as Record<string, unknown>).polluted3).toBeUndefined();
    });

    it("refuses to write an index through an array's prototype", () => {
        setIn({}, "__proto__.0", "yes");

        expect(([] as unknown as Record<string, unknown>)[0]).toBeUndefined();
    });

    it("leaves the object it was given unchanged when the path is refused", () => {
        const original = { a: 1 };
        const result = setIn(original, "__proto__.polluted", "yes");

        expect(result).toEqual({ a: 1 });
    });
});

describe("setIn still does its job", () => {
    it("sets a plain key", () => {
        expect(setIn({ a: 1 }, "b", 2)).toEqual({ a: 1, b: 2 });
    });

    it("sets a nested key, creating the objects on the way", () => {
        expect(setIn({}, "a.b.c", 3)).toEqual({ a: { b: { c: 3 } } });
    });

    it("sets an array index, creating the array", () => {
        expect(setIn({}, "a[0].b", "x")).toEqual({ a: [{ b: "x" }] });
    });

    it("keeps a property legitimately called `prototype` reachable as a value", () => {
        // The guard is about the *path segments* that reach the prototype
        // chain, not about the word appearing in data.
        const result = setIn({}, "config.prototypeName", "v1") as Record<string, Record<string, unknown>>;

        expect(result.config.prototypeName).toBe("v1");
    });
});

describe("getIn cannot read through the prototype chain either", () => {
    it("does not hand back Object.prototype", () => {
        expect(getIn({}, "__proto__")).toBeUndefined();
        expect(getIn({}, "constructor.prototype")).toBeUndefined();
    });
});
