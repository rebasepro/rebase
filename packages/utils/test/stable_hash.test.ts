import { describe, it, expect } from "@jest/globals";
import { stableHash } from "../src/stable_hash";
import { getHashValue } from "../src/objects";

describe("stableHash", () => {
    it("is the same for the same content, whatever the key order", () => {
        expect(stableHash({ a: 1,
b: [1, 2, { c: "x" }] })).toBe(stableHash({ b: [1, 2, { c: "x" }],
a: 1 }));
    });

    it("tells apart values that differ in content or in type", () => {
        const values: unknown[] = [
            { a: 1 }, { a: 2 }, { a: "1" }, { b: 1 }, [1, 2], [2, 1], "1", 1, 1n, true, false, null, undefined,
            new Date(0), new Date(1), new Map([["a", 1]]), new Set([1]), [], {}, "", { a: undefined }
        ];
        const hashes = values.map(stableHash);
        expect(new Set(hashes).size).toBe(values.length);
    });

    it("skips functions and symbols, as object-hash's ignoreUnknown did", () => {
        expect(stableHash({ a: 1,
f: () => 1,
s: Symbol("s") })).toBe(stableHash({ a: 1 }));
    });

    it("names a class instance's constructor", () => {
        class Point { constructor(public x: number) {} }
        expect(stableHash(new Point(1))).not.toBe(stableHash({ x: 1 }));
    });

    it("survives a cycle", () => {
        const a: Record<string, unknown> = { name: "a" };
        a.self = a;
        expect(stableHash(a)).toMatch(/^[0-9a-f]{28}$/);
    });

    it("is 28 hex characters", () => {
        expect(stableHash({ nested: { deep: [1, 2, 3] } })).toMatch(/^[0-9a-f]{28}$/);
    });
});

describe("getHashValue", () => {
    it("keys by `id` when there is one, by content otherwise", () => {
        expect(getHashValue({ id: 7,
name: "x" })).toBe("7");
        expect(getHashValue({ name: "x" })).toBe(getHashValue({ name: "x" }));
        expect(getHashValue({ name: "x" })).not.toBe(getHashValue({ name: "y" }));
        expect(getHashValue({ latitude: 1,
longitude: 2,
extra: "ignored" })).toBe(getHashValue({ latitude: 1,
longitude: 2 }));
        expect(getHashValue(null)).toBeNull();
    });
});
