import { describe, expect, jest, test } from "@jest/globals";
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

/**
 * Most cells of an import are text, and `JSON.parse` on text throws — the
 * throw was over half of the main-thread time of parsing a file (628 ms of
 * ~1 s for 10,000 rows × 20 columns). A cell that cannot be the canonical
 * JSON of a number, boolean or array is now passed over without parsing.
 */
describe("mapJsonParse on text cells", () => {

    /** The read as it was before the first-character check: the reference. */
    function referenceCell(cell: unknown): unknown {
        if (typeof cell !== "string") return cell;
        let parsed: unknown;
        try {
            parsed = JSON.parse(cell);
        } catch (e) {
            return cell;
        }
        const readable = typeof parsed === "number" || typeof parsed === "boolean" || Array.isArray(parsed);
        return readable && JSON.stringify(parsed) === cell ? parsed : cell;
    }

    const corpus: unknown[] = [
        "12", "-3", "0", "-0", "12.5", "1.10", "00123", "1E3", "1e3", "-1.5e-7", "1e+21", "12345678901234567890",
        "true", "false", "True", "null", "undefined", "NaN", "Infinity", "-Infinity",
        "[]", "[1]", "[1,]", "[\"a\",\"b\"]", "[ 1 ]", "[{\"a\":1}]", "[\"a\" ]",
        "{}", "{\"a\":1}", "\"quoted\"", "", " ", " 12", "12 ", "\t1", "\n[1]",
        "some text", "-", "--1", "-a", "t", "f", "tru", "falsey", "[", "]", "0x10", "+1", ".5", "5.",
        "2024-01-01", "2024-01-01T00:00:00.000Z", "é", "😀", "-é",
        12, 0, true, false, null, undefined, [1, 2], { a: 1 }
    ];

    test("reads every cell exactly as the full parse does", () => {
        const row: Record<string, unknown> = {};
        corpus.forEach((cell, i) => { row["c" + i] = cell; });
        const expected: Record<string, unknown> = {};
        corpus.forEach((cell, i) => { expected["c" + i] = referenceCell(cell); });

        expect(mapJsonParse(row)).toEqual(expected);
    });

    test("does not parse a cell that can only be text", () => {
        const parse = jest.spyOn(JSON, "parse");
        try {
            const row: Record<string, string> = {};
            for (let c = 0; c < 20; c++) row["text" + c] = "some text value " + c;
            row.date = "2024-01-01T00:00:00.000Z".replace(/^2/, "Y");
            row.sku = "SKU-001";
            row.quoted = "\"x\"";
            row.object = "{\"a\":1}";

            mapJsonParse(row);

            expect(parse).not.toHaveBeenCalled();
        } finally {
            parse.mockRestore();
        }
    });
});
