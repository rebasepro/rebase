import { describe, expect, it } from "vitest";
import { describePending, parseDay } from "./maintenance";

describe("compute window --day", () => {
    it("takes a day by name, by its first letters, or by number", () => {
        expect(parseDay("sun")).toBe(0);
        expect(parseDay("Saturday")).toBe(6);
        expect(parseDay("th")).toBe(4);
        expect(parseDay("tu")).toBe(2);
        expect(parseDay("3")).toBe(3);
    });

    it("refuses what could be two days, or none", () => {
        expect(parseDay("t")).toBeUndefined();
        expect(parseDay("s")).toBeUndefined();
        expect(parseDay("7")).toBeUndefined();
        expect(parseDay("someday")).toBeUndefined();
    });
});

describe("the Waiting line", () => {
    it("says what will change and when, or that it is happening now", () => {
        expect(describePending({ id: "m", state: "notified", summary: "Database 0.16 → 0.5 vCPU", scheduledLabel: "Sunday 8 November, 03:00 UTC" }))
            .toBe("Database 0.16 → 0.5 vCPU — applies Sunday 8 November, 03:00 UTC");
        expect(describePending({ id: "m", state: "pending", summary: "Database settings update", scheduledFor: null }))
            .toBe("Database settings update — applies when the project starts");
        expect(describePending({ id: "m", state: "applying", summary: "X" })).toMatch(/applying now/);
        expect(describePending(null)).toBeUndefined();
    });
});
