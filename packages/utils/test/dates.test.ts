import { formatRelativeTime } from "../src/dates";

/** A fixed "now", so none of this depends on when it runs. */
const NOW = new Date("2026-08-07T12:00:00.000Z");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An instant `ms` after {@link NOW}; negative reaches into the past. */
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("formatRelativeTime", () => {

    describe("the past", () => {
        it("names the tense at every scale", () => {
            expect(formatRelativeTime(at(-30 * 1000), { now: NOW })).toBe("just now");
            expect(formatRelativeTime(at(-5 * MINUTE), { now: NOW })).toBe("5m ago");
            expect(formatRelativeTime(at(-3 * HOUR), { now: NOW })).toBe("3h ago");
            expect(formatRelativeTime(at(-2 * DAY), { now: NOW })).toBe("2d ago");
        });

        it("truncates rather than rounds up into the next unit", () => {
            expect(formatRelativeTime(at(-59 * MINUTE - 59 * 1000), { now: NOW })).toBe("59m ago");
            expect(formatRelativeTime(at(-23 * HOUR - 59 * MINUTE), { now: NOW })).toBe("23h ago");
        });
    });

    // The regression this function exists for. Every hand-rolled formatter it
    // replaced tested only `now - then > 0`, so a future date fell through to
    // whichever branch came first — "Just now" for a post scheduled next month,
    // "-1d ago" for one due this afternoon.
    describe("the future", () => {
        it("is never described in the past tense", () => {
            expect(formatRelativeTime(at(30 * 1000), { now: NOW })).toBe("in a moment");
            expect(formatRelativeTime(at(5 * MINUTE), { now: NOW })).toBe("in 5m");
            expect(formatRelativeTime(at(3 * HOUR), { now: NOW })).toBe("in 3h");
            expect(formatRelativeTime(at(2 * DAY), { now: NOW })).toBe("in 2d");
        });

        it("never emits a negative quantity", () => {
            for (const ms of [1000, MINUTE, HOUR, 5 * HOUR, DAY, 6 * DAY]) {
                expect(formatRelativeTime(at(ms), { now: NOW })).not.toMatch(/-\d/);
            }
        });

        it("does not read as the present just because it is close", () => {
            // 2 hours out used to floor to -1 day and print "-1d ago"; the same
            // input on the other formatter printed "Just now".
            expect(formatRelativeTime(at(2 * HOUR), { now: NOW })).toBe("in 2h");
        });
    });

    describe("the distance it declines to describe", () => {
        it("returns null past the default week, in both directions", () => {
            expect(formatRelativeTime(at(-8 * DAY), { now: NOW })).toBeNull();
            expect(formatRelativeTime(at(8 * DAY), { now: NOW })).toBeNull();
        });

        it("still answers at the boundary", () => {
            expect(formatRelativeTime(at(-7 * DAY), { now: NOW })).toBe("7d ago");
            expect(formatRelativeTime(at(7 * DAY), { now: NOW })).toBe("in 7d");
        });

        it("honours a caller's own horizon", () => {
            expect(formatRelativeTime(at(-20 * DAY), { now: NOW, maxMs: 30 * DAY })).toBe("20d ago");
            expect(formatRelativeTime(at(-20 * DAY), { now: NOW, maxMs: 7 * DAY })).toBeNull();
        });
    });

    describe("input it cannot read", () => {
        it("returns null rather than a phrase built on NaN", () => {
            expect(formatRelativeTime(undefined, { now: NOW })).toBeNull();
            expect(formatRelativeTime(null, { now: NOW })).toBeNull();
            expect(formatRelativeTime("", { now: NOW })).toBeNull();
            expect(formatRelativeTime("not a date", { now: NOW })).toBeNull();
            expect(formatRelativeTime(new Date("nope"), { now: NOW })).toBeNull();
        });

        it("accepts the shapes a record actually holds", () => {
            expect(formatRelativeTime("2026-08-07T09:00:00.000Z", { now: NOW })).toBe("3h ago");
            expect(formatRelativeTime(NOW.getTime() - 3 * HOUR, { now: NOW })).toBe("3h ago");
            expect(formatRelativeTime(new Date(NOW.getTime() - 3 * HOUR), { now: NOW })).toBe("3h ago");
        });
    });

    it("accepts `now` as a number as readily as a Date", () => {
        expect(formatRelativeTime(at(-5 * MINUTE), { now: NOW.getTime() })).toBe("5m ago");
    });

    it("defaults `now` to the current time", () => {
        expect(formatRelativeTime(new Date(Date.now() - 5 * MINUTE))).toBe("5m ago");
        expect(formatRelativeTime(new Date(Date.now() + 5 * MINUTE))).toBe("in 5m");
    });
});
