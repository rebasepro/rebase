import { changeTone, formatChange, formatValue } from "./format";
import type { InsightComparison } from "./types";

const percent: InsightComparison = { previous: "previous", intent: "increase_is_good" };
const absolute: InsightComparison = { previous: "previous", intent: "increase_is_good", show: "absolute" };

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

describe("formatChange", () => {
    it("writes the relative change, unsigned, with its direction", () => {
        expect(formatChange(71, 50, percent, undefined, "en")).toEqual({ direction: "up", magnitude: "42%" });
        expect(formatChange(30_550, 30_620, percent, undefined, "en")).toEqual({ direction: "down", magnitude: "0.2%" });
    });

    it("keeps a decimal under 10% and drops it above", () => {
        expect(formatChange(109.5, 100, percent, undefined, "en").magnitude).toBe("9.5%");
        expect(formatChange(110.4, 100, percent, undefined, "en").magnitude).toBe("10%");
    });

    // Three shipped orders becoming twelve is "↑ 300%" as a percentage, and
    // "↑ 9" as what happened.
    it("writes the difference when asked for an absolute change", () => {
        expect(formatChange(12, 3, absolute, undefined, "en")).toEqual({ direction: "up", magnitude: "9" });
        expect(formatChange(431.11, 613.2, absolute, { style: "currency", currency: "USD", decimals: 2 }, "en"))
            .toEqual({ direction: "down", magnitude: "$182.09" });
    });

    it("writes the difference when there is no previous figure to take a percentage of", () => {
        expect(formatChange(5, 0, percent, undefined, "en")).toEqual({ direction: "up", magnitude: "5" });
    });

    it("reports no change as flat", () => {
        expect(formatChange(4, 4, percent, undefined, "en")).toEqual({ direction: "flat", magnitude: "0.0%" });
        expect(formatChange(0, 0, percent, undefined, "en")).toEqual({ direction: "flat", magnitude: "0" });
    });
});

describe("changeTone", () => {
    it("reads a change by whether it is good news for the insight", () => {
        expect(changeTone("up", "increase_is_good")).toBe("positive");
        expect(changeTone("down", "increase_is_good")).toBe("negative");
        expect(changeTone("up", "decrease_is_good")).toBe("negative");
        expect(changeTone("down", "decrease_is_good")).toBe("positive");
        expect(changeTone("flat", "decrease_is_good")).toBe("neutral");
    });
});
