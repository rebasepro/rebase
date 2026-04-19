import { describe, expect, test } from "@jest/globals";
import { getIn, setIn, clone } from "../src/utils";

// ─────────────────────────────────────────────────────────────
// clone
// ─────────────────────────────────────────────────────────────
describe("clone", () => {
    test("shallow clones plain objects", () => {
        const obj = { a: 1, b: 2 };
        const cloned = clone(obj);
        expect(cloned).toEqual(obj);
        expect(cloned).not.toBe(obj);
    });

    test("shallow clones arrays", () => {
        const arr = [1, 2, 3];
        const cloned = clone(arr);
        expect(cloned).toEqual(arr);
        expect(cloned).not.toBe(arr);
    });

    test("returns primitives as-is", () => {
        expect(clone(42)).toBe(42);
        expect(clone("hello")).toBe("hello");
        expect(clone(true)).toBe(true);
        expect(clone(null)).toBe(null);
        expect(clone(undefined)).toBe(undefined);
    });

    test("preserves class instances (does NOT spread them)", () => {
        class Foo {
            constructor(public x: number) {}
            double() { return this.x * 2; }
        }
        const instance = new Foo(5);
        const cloned = clone(instance);
        // Class instances should be returned by reference, not spread
        expect(cloned).toBe(instance);
        expect((cloned as Foo).double()).toBe(10);
    });

    test("preserves Date instances", () => {
        const date = new Date("2024-01-01");
        const cloned = clone(date);
        // Date is a class instance, should be preserved
        expect(cloned).toBe(date);
    });

    test("spreads plain objects (prototype === Object.prototype)", () => {
        const obj = { a: { b: 1 } };
        const cloned = clone(obj) as Record<string, unknown>;
        expect(cloned).not.toBe(obj);
        // But inner objects are shallow copies — same references
        expect(cloned.a).toBe(obj.a);
    });
});

// ─────────────────────────────────────────────────────────────
// getIn
// ─────────────────────────────────────────────────────────────
describe("getIn", () => {
    test("gets a top-level value", () => {
        expect(getIn({ a: 1 }, "a")).toBe(1);
    });

    test("gets a deeply nested value via dot notation", () => {
        expect(getIn({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
    });

    test("gets a value via array path", () => {
        expect(getIn({ a: { b: 10 } }, ["a", "b"])).toBe(10);
    });

    test("gets array element via bracket notation", () => {
        expect(getIn({ items: ["zero", "one", "two"] }, "items[1]")).toBe("one");
    });

    test("gets nested property inside array element", () => {
        const obj = { users: [{ name: "Alice" }, { name: "Bob" }] };
        expect(getIn(obj, "users[0].name")).toBe("Alice");
        expect(getIn(obj, "users[1].name")).toBe("Bob");
    });

    test("returns default value when path doesn't exist", () => {
        expect(getIn({ a: 1 }, "b", "default")).toBe("default");
        expect(getIn({ a: 1 }, "a.b.c", 99)).toBe(99);
    });

    test("returns undefined when path doesn't exist and no default", () => {
        expect(getIn({ a: 1 }, "x.y")).toBeUndefined();
    });

    test("returns the root object for empty path array", () => {
        const obj = { a: 1 };
        expect(getIn(obj, [])).toBe(obj);
    });

    test("handles null/undefined in path chain gracefully", () => {
        expect(getIn({ a: null }, "a.b", "fallback")).toBe("fallback");
        expect(getIn({ a: undefined }, "a.b", "fallback")).toBe("fallback");
    });

    test("handles falsy values that are not undefined", () => {
        expect(getIn({ a: 0 }, "a")).toBe(0);
        expect(getIn({ a: false }, "a")).toBe(false);
        expect(getIn({ a: "" }, "a")).toBe("");
    });
});

// ─────────────────────────────────────────────────────────────
// setIn
// ─────────────────────────────────────────────────────────────
describe("setIn", () => {
    test("sets a top-level property immutably", () => {
        const obj = { a: 1 };
        const result = setIn(obj, "b", 2);
        expect(result).toEqual({ a: 1, b: 2 });
        expect(obj).toEqual({ a: 1 }); // original not mutated
    });

    test("sets a deeply nested value", () => {
        const obj = { a: { b: { c: 1 } } };
        const result = setIn(obj, "a.b.c", 99);
        expect(result.a.b.c).toBe(99);
        expect(obj.a.b.c).toBe(1); // original not mutated
    });

    test("creates intermediate objects if path doesn't exist", () => {
        const obj = {};
        const result = setIn(obj, "a.b.c", 5);
        expect(result).toEqual({ a: { b: { c: 5 } } });
    });

    test("creates intermediate arrays for numeric path segments", () => {
        const obj = {};
        const result = setIn(obj, "items[0].name", "first");
        expect(result).toEqual({ items: [{ name: "first" }] });
    });

    test("deletes key when value is undefined (top-level)", () => {
        const obj = { a: 1, b: 2 };
        const result = setIn(obj, "a", undefined);
        expect(result).toEqual({ b: 2 });
        expect(result).not.toHaveProperty("a");
    });

    test("deletes key when value is undefined (nested)", () => {
        const obj = { a: { b: 1, c: 2 } };
        const result = setIn(obj, "a.b", undefined);
        expect(result.a).toEqual({ c: 2 });
    });

    test("returns original object if value hasn't changed", () => {
        const obj = { a: 1 };
        const result = setIn(obj, "a", 1);
        expect(result).toBe(obj); // same reference — no change
    });

    test("preserves false values correctly", () => {
        const obj = { name: "John" };
        const result = setIn(obj, "active", false);
        expect(result).toEqual({ name: "John", active: false });
    });

    test("preserves null values correctly", () => {
        const obj = { name: "John" };
        const result = setIn(obj, "deletedAt", null);
        expect(result).toEqual({ name: "John", deletedAt: null });
    });

    test("sets value inside existing arrays", () => {
        const obj = { items: ["a", "b", "c"] };
        const result = setIn(obj, "items[1]", "B");
        expect(result.items[1]).toBe("B");
        expect(obj.items[1]).toBe("b");
    });

    test("handles class instances in the path without destroying them", () => {
        class Custom {
            constructor(public value: number) {}
        }
        const instance = new Custom(10);
        const obj = { wrapper: instance };
        // Setting a sibling property should preserve the class instance
        const result = setIn(obj, "other", "test");
        expect(result.wrapper).toBe(instance);
    });
});
