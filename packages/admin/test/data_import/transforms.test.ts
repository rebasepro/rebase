import { describe, expect, test } from "@jest/globals";
import { mapJsonParse } from "../../src/data_import/utils/transforms";

describe("mapJsonParse utility function", () => {
    test("should parse JSON strings correctly", () => {
        const input = {
            a: '{"nested": "value"}',
            b: "[1, 2, 3]",
            c: '"just a string"'
        };

        const result = mapJsonParse(input);

        expect(result).toEqual({
            a: { nested: "value" },
            b: [1, 2, 3],
            c: "just a string"
        });
    });

    test("should keep non-JSON strings or malformed JSON as-is", () => {
        const input = {
            a: "hello world",
            b: "{invalid json",
            c: "[1, 2,"
        };

        const result = mapJsonParse(input);

        expect(result).toEqual(input);
    });

    test("should handle non-string values gracefully", () => {
        const input = {
            a: 123,
            b: true,
            c: null
        };

        const result = mapJsonParse(input);

        expect(result).toEqual({
            a: 123,
            b: true,
            c: null
        });
    });
});
