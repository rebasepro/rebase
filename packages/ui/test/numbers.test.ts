import { compactFormat, describeChange, formatNumber, niceTicks } from "../src/util/numbers";

describe("niceTicks", () => {
    it("starts at zero and steps in round numbers past the maximum", () => {
        expect(niceTicks(120, 4054.79)).toEqual([0, 2000, 4000, 6000]);
        expect(niceTicks(0, 22)).toEqual([0, 10, 20, 30]);
    });

    it("keeps zero on the axis when every value is above it", () => {
        expect(niceTicks(500, 900)[0]).toBe(0);
    });

    it("reaches below zero for negative values", () => {
        expect(niceTicks(-30, 50)).toEqual([-40, -20, 0, 20, 40, 60]);
    });

    it("writes fractional steps as they read, without float noise", () => {
        expect(niceTicks(0, 0.7)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    });

    it("is one tick when there is nothing to span", () => {
        expect(niceTicks(0, 0)).toEqual([0]);
    });

    // A NaN bound made the step NaN, so no tick was ever `>= high` and the loop
    // pushed until the tab ran out of memory.
    it("ends, with one tick at zero, when a bound is not a finite number", () => {
        expect(niceTicks(NaN, NaN)).toEqual([0]);
        expect(niceTicks(0, NaN)).toEqual([0]);
        expect(niceTicks(NaN, 10)).toEqual([0]);
        expect(niceTicks(0, Infinity)).toEqual([0]);
        expect(niceTicks(-Infinity, 0)).toEqual([0]);
    });

    it("ends when the span is too wide for a finite step", () => {
        expect(niceTicks(-Number.MAX_VALUE, Number.MAX_VALUE)).toEqual([-Number.MAX_VALUE, 0, Number.MAX_VALUE]);
    });
});

describe("describeChange", () => {
    it("writes a percentage, one decimal under 10%", () => {
        expect(describeChange({ current: 30_560, previous: 30_620, locale: "en" }))
            .toEqual({ direction: "down", tone: "negative", magnitude: "0.2%" });
        expect(describeChange({ current: 71, previous: 50, locale: "en" }))
            .toEqual({ direction: "up", tone: "positive", magnitude: "42%" });
    });

    it("reads a rise as bad news when down is good", () => {
        expect(describeChange({ current: 10, previous: 6, goodWhen: "down", show: "absolute", locale: "en" }))
            .toEqual({ direction: "up", tone: "negative", magnitude: "4" });
    });

    it("writes a change from zero as the difference, in the figure's format", () => {
        expect(describeChange({ current: 250, previous: 0, format: { style: "currency", currency: "USD" }, locale: "en" }))
            .toEqual({ direction: "up", tone: "positive", magnitude: "$250.00" });
    });

    it("is neutral when nothing moved", () => {
        expect(describeChange({ current: 5, previous: 5, locale: "en" }).tone).toBe("neutral");
    });
});

describe("formatNumber", () => {
    it("falls back to the default locale for a tag Intl refuses", () => {
        expect(formatNumber(1234, undefined, "cimode")).toBe(new Intl.NumberFormat().format(1234));
    });

    it("compacts a format for axis ticks", () => {
        expect(formatNumber(4000, compactFormat({ style: "currency", currency: "USD" }), "en")).toBe("$4K");
        expect(formatNumber(12_900, compactFormat(undefined), "en")).toBe("12.9K");
    });
});
