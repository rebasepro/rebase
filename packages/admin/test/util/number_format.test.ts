import { formatNumber } from "../../src/util/number_format";

/**
 * `admin.format` is the whole contract. Nothing about a number is inferred —
 * not from its column name, not from a `currency` column sitting beside it —
 * because a panel that renders arbitrary collections cannot know which of a
 * record's numbers are money, and a euro sign on a quantity is worse than a
 * bare number on a price.
 */
describe("formatNumber", () => {

    it("returns the stored number when nothing is declared", () => {
        expect(formatNumber(185.11, undefined)).toBe("185.11");
        expect(formatNumber(0, undefined)).toBe("0");
        expect(formatNumber(1234567, undefined)).toBe("1234567");
    });

    it("does not group or round an undeclared number", () => {
        // Not `1,234,567` and not `1234567.00`: an undeclared number renders as
        // the value in the database, so what is on screen is what was stored.
        expect(formatNumber(1234567.5, undefined)).toBe("1234567.5");
    });

    it("treats a currency code as the whole declaration", () => {
        // `style` omitted with a currency present is the common way to write it,
        // and there is nothing else `currency` could have meant.
        const formatted = formatNumber(185.11, { currency: "EUR", locale: "en-US" });
        expect(formatted).toContain("185.11");
        expect(formatted).toContain("€");
    });

    it("formats a percentage", () => {
        expect(formatNumber(0.15, { style: "percent", locale: "en-US" })).toBe("15%");
    });

    it("honours a declared locale over the panel's", () => {
        expect(formatNumber(1234.5, { style: "decimal", locale: "de-DE" }, "en-US"))
            .toBe("1.234,5");
    });

    it("falls back to the panel locale when the property names none", () => {
        expect(formatNumber(1234.5, { style: "decimal" }, "de-DE")).toBe("1.234,5");
    });

    it("pins the fraction digits when asked", () => {
        expect(formatNumber(5, {
            style: "decimal",
            locale: "en-US",
            minimumFractionDigits: 2
        })).toBe("5.00");
    });

    it("renders zero, formatted", () => {
        // A zero is a value. It formats like any other number and is never
        // swapped for a dash or hidden — a discount of nothing is a fact about
        // the order, and the panel does not get to decide it is uninteresting.
        expect(formatNumber(0, { currency: "USD", locale: "en-US" })).toBe("$0.00");
        expect(formatNumber(0, { style: "percent", locale: "en-US" })).toBe("0%");
    });

    it("renders a negative", () => {
        expect(formatNumber(-42.5, { currency: "USD", locale: "en-US" })).toBe("-$42.50");
    });

    it("falls back to the raw value rather than throwing on a bad currency", () => {
        // `Intl` throws on an unknown code. One misconfigured property must not
        // blank the record it is on.
        expect(formatNumber(12, { style: "currency", currency: "NOT_A_CODE" })).toBe("12");
    });

    it("falls back when currency style is asked for without a code", () => {
        expect(formatNumber(12, { style: "currency" })).toBe("12");
    });

    it("compacts when asked", () => {
        expect(formatNumber(12000, { notation: "compact", locale: "en-US" })).toBe("12K");
    });
});
