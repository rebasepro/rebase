import { describe, expect, test } from "@jest/globals";
import { mapJsonParse } from "../../src/data_import/utils/transforms";

describe("mapJsonParse utility function", () => {
    test("should parse JSON strings correctly", () => {
        const input = {
            b: '[1,2,{"a":"x"}]',
            c: "12.5",
            d: "true"
        };

        const result = mapJsonParse(input);

        expect(result).toEqual({
            b: [1, 2, { a: "x" }],
            c: 12.5,
            d: true
        });
    });

    // The read happens before anyone knows which property a column lands in,
    // so it may only read what it can give back: a cell is parsed only when it
    // is the canonical JSON of its value, and a string property turns that
    // value back into the same text.
    test("keeps a cell whose JSON reading would not give its text back", () => {
        const input = {
            long: "12345678901234567890",
            trailingZero: "1.10",
            wholeFloat: "2.0",
            exponent: "1E3",
            padded: " 12",
            nullWord: "null",
            quoted: '"just a string"',
            spacedArray: "[1, 2, 3]",
            spacedObject: '{"nested": "value"}',
            object: '{"nested":"value"}'
        };

        expect(mapJsonParse(input)).toEqual(input);
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
