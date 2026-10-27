import { describe, expect, it } from "@jest/globals";
import { csvField, csvRecord, escapeCsvFormula, unescapeCsvFormula } from "../src";

/**
 * Every CSV the product writes — the CMS export, the SQL console's export and
 * copy, and the server's streamed "Download full result" — goes through these.
 * Quoting is not enough: a spreadsheet strips it, then evaluates a cell whose
 * first character is a formula trigger.
 */
describe("csvField", () => {
    it.each(["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\tcmd", "\rcmd", "=HYPERLINK(\"https://evil.test\")"])(
        "writes %j as text, not a formula", (value) => {
            const field = csvField(value);
            const unquoted = field.startsWith("\"") ? field.slice(1, -1).replace(/""/g, "\"") : field;
            expect(unquoted).toBe("'" + value);
        });

    it("leaves a signed number a number", () => {
        expect(csvField("-12.5")).toBe("-12.5");
        expect(csvField("+3")).toBe("+3");
        expect(csvField(-7)).toBe("-7");
    });

    it("leaves other text, NULL and objects as they were", () => {
        expect(csvField("Alice")).toBe("Alice");
        expect(csvField("a,b")).toBe("\"a,b\"");
        expect(csvField(null)).toBe("");
        expect(csvField(undefined)).toBe("");
        expect(csvField({ k: 1 })).toBe("\"{\"\"k\"\":1}\"");
    });

    it("escapes each field of a record", () => {
        expect(csvRecord(["=a", "b", "@c"])).toBe("'=a,b,'@c");
    });
});

describe("escapeCsvFormula / unescapeCsvFormula", () => {
    it("round-trips a neutralised cell", () => {
        expect(unescapeCsvFormula(escapeCsvFormula("=1+1"))).toBe("=1+1");
        expect(unescapeCsvFormula("'plain")).toBe("'plain");
    });
});
