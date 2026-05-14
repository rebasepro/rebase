import { isLazyComponentRef } from "../src/types/component_ref";

describe("isLazyComponentRef", () => {
    it("returns true for a valid LazyComponentRef", () => {
        const ref = {
            __rebaseLazy: true as const,
            load: () => Promise.resolve({ default: () => null })
        };
        expect(isLazyComponentRef(ref)).toBe(true);
    });

    it("returns false for null", () => {
        expect(isLazyComponentRef(null)).toBe(false);
    });

    it("returns false for undefined", () => {
        expect(isLazyComponentRef(undefined)).toBe(false);
    });

    it("returns false for a plain string", () => {
        expect(isLazyComponentRef("./components/MyField")).toBe(false);
    });

    it("returns false for a number", () => {
        expect(isLazyComponentRef(42)).toBe(false);
    });

    it("returns false for a function", () => {
        expect(isLazyComponentRef(() => {})).toBe(false);
    });

    it("returns false for an object without __rebaseLazy", () => {
        const ref = { load: () => Promise.resolve({ default: () => null }) };
        expect(isLazyComponentRef(ref)).toBe(false);
    });

    it("returns false when __rebaseLazy is false", () => {
        const ref = {
            __rebaseLazy: false,
            load: () => Promise.resolve({ default: () => null })
        };
        expect(isLazyComponentRef(ref)).toBe(false);
    });

    it("returns false when __rebaseLazy is a truthy non-boolean", () => {
        const ref = {
            __rebaseLazy: 1,
            load: () => Promise.resolve({ default: () => null })
        };
        expect(isLazyComponentRef(ref)).toBe(false);
    });

    it("returns false for an empty object", () => {
        expect(isLazyComponentRef({})).toBe(false);
    });

    it("returns false for an array", () => {
        expect(isLazyComponentRef([1, 2, 3])).toBe(false);
    });
});
