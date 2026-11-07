import { formatValue } from "./format";

describe("formatValue", () => {
    // The scorecard wrote every figure as en-US, whatever the panel's language.
    it("writes numbers in the panel's language", () => {
        expect(formatValue(1234.5, { style: "decimal", decimals: 1 }, "en")).toBe("1,234.5");
        expect(formatValue(1234.5, { style: "decimal", decimals: 1 }, "de")).toBe("1.234,5");
    });

    it("keeps integers whole and currency at two decimals unless told otherwise", () => {
        expect(formatValue(80, undefined, "en")).toBe("80");
        expect(formatValue(452.95, { style: "currency", currency: "USD" }, "en")).toBe("$452.95");
        expect(formatValue(30_600, { style: "currency", currency: "USD", notation: "compact", decimals: 1 }, "en")).toBe("$30.6K");
    });

    it("falls back to the browser's language for a tag Intl refuses", () => {
        expect(() => formatValue(1, undefined, "cimode")).not.toThrow();
    });
});
