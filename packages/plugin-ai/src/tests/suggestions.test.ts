import { getAppendableSuggestion } from "../utils/suggestions";

describe("getAppendableSuggestion", () => {
    it("returns the remaining part when suggestion starts with value", () => {
        const result = getAppendableSuggestion("Hello World", "Hello");
        expect(result).toBe(" World");
    });

    it("returns undefined when suggestion does not start with value", () => {
        const result = getAppendableSuggestion("Goodbye World", "Hello");
        expect(result).toBeUndefined();
    });

    it("performs case-insensitive matching", () => {
        const result = getAppendableSuggestion("Hello World", "hello");
        expect(result).toBe(" World");
    });

    it("returns undefined for number suggestion", () => {
        const result = getAppendableSuggestion(42, "4");
        expect(result).toBeUndefined();
    });

    it("returns undefined for undefined suggestion", () => {
        const result = getAppendableSuggestion(undefined, "hello");
        expect(result).toBeUndefined();
    });

    it("returns undefined for non-string value", () => {
        const result = getAppendableSuggestion("Hello", 42);
        expect(result).toBeUndefined();
    });

    it("returns full suggestion when value is empty string", () => {
        const result = getAppendableSuggestion("Hello World", "");
        expect(result).toBe("Hello World");
    });

    it("ignores whitespace around the value", () => {
        // What the user has typed arrives with the field's own padding, so the
        // comparison and the offset both trim it. Byte-identical to the first
        // test until the value actually carries whitespace.
        const result = getAppendableSuggestion("Hello World", "  Hello  ");
        expect(result).toBe(" World");
    });

    it("returns empty string when suggestion equals value", () => {
        const result = getAppendableSuggestion("Hello", "Hello");
        expect(result).toBe("");
    });

    it("returns undefined when value is longer than suggestion", () => {
        const result = getAppendableSuggestion("Hi", "Hello World");
        expect(result).toBeUndefined();
    });
});
