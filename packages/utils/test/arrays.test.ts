import { toArray } from "../src/arrays";

describe("arrays utils", () => {
    describe("toArray", () => {
        it("should return the same array if input is already an array", () => {
            const arr = [1, 2, 3];
            expect(toArray(arr)).toBe(arr); // reference equality
        });

        it("should return an empty array as-is rather than treating it as absent", () => {
            const arr: number[] = [];
            expect(toArray(arr)).toBe(arr);
        });

        it("should wrap single element in an array", () => {
            expect(toArray("hello")).toEqual(["hello"]);
            expect(toArray(42)).toEqual([42]);
            expect(toArray({ a: 1 })).toEqual([{ a: 1 }]);
        });

        it("should return an empty array only for null and undefined", () => {
            expect(toArray(undefined)).toEqual([]);
            expect(toArray(null)).toEqual([]);
            expect(toArray()).toEqual([]);
        });

        it("should wrap falsy-but-present values instead of dropping them", () => {
            // A truthiness check used to swallow these, so a caller normalising a
            // single `0`, `false` or "" got an empty list back and lost the value.
            expect(toArray(0)).toEqual([0]);
            expect(toArray(false)).toEqual([false]);
            expect(toArray("")).toEqual([""]);
            expect(toArray(NaN)).toEqual([NaN]);
        });
    });
});
