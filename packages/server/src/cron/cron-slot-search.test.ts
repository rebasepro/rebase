/** @jest-environment ./test/helpers/madrid-tz-environment.cjs */
import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { CronScheduler, findMostRecentSlot, parseCronExpression } from "./cron-scheduler";
import type { LoadedCronJob } from "./cron-loader";

/**
 * The slot search hops over minutes that cannot match instead of testing every
 * minute in turn. These tests hold it to the minute-by-minute answer — kept
 * below as the oracle — across the zones that make that hard, and hold its cost
 * to a count of wall-clock reads rather than a time.
 *
 * The host zone is Europe/Madrid (see the docblock), so a schedule that names
 * no zone crosses daylight-saving changes too.
 */

const MINUTE = 60_000;

/**
 * Zones whose offsets make a hop easy to get wrong: whole-hour summer time on
 * both hemispheres' calendars, half- and three-quarter-hour offsets with and
 * without summer time, Lord Howe's half-hour change, Troll's two-hour one,
 * and the host zone (`undefined`).
 */
const ZONES: (string | undefined)[] = [
    undefined,
    "Europe/Madrid",
    "America/New_York",
    "America/St_Johns",
    "Asia/Kolkata",
    "Asia/Kathmandu",
    "Australia/Lord_Howe",
    "Pacific/Chatham",
    "Antarctica/Troll"
];

// ─── The oracle: the search as it was, one real minute at a time ─────

function expand(field: string, min: number, max: number): number[] {
    const values = new Set<number>();
    for (const segment of field.split(",")) {
        if (segment === "*") {
            for (let i = min; i <= max; i++) values.add(i);
        } else if (segment.includes("/")) {
            const [range, step] = segment.split("/");
            let start = min;
            let end = max;
            if (range !== "*") {
                if (range.includes("-")) [start, end] = range.split("-").map(Number);
                else start = Number(range);
            }
            for (let i = start; i <= end; i += Number(step)) values.add(i);
        } else if (segment.includes("-")) {
            const [a, b] = segment.split("-").map(Number);
            for (let i = a; i <= b; i++) values.add(i);
        } else {
            values.add(Number(segment));
        }
    }
    return [...values];
}

const oracleFormatters = new Map<string, Intl.DateTimeFormat>();
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const expandedFields = new Map<string, Set<number>[]>();

/**
 * Wall clocks the oracle has read, per zone and minute. Only the oracle's own
 * reads are kept, so it stays independent of the search it checks — the memo
 * just stops every expression in the corpus paying for the same minutes again.
 */
const wallMemo = new Map<string, Map<number, number[]>>();

function oracleWall(instantMs: number, zone?: string): number[] {
    let memo = wallMemo.get(zone ?? "");
    if (!memo) {
        memo = new Map();
        wallMemo.set(zone ?? "", memo);
    }
    const known = memo.get(instantMs);
    if (known) return known;
    const instant = new Date(instantMs);
    let wall: number[];
    if (zone) {
        let formatter = oracleFormatters.get(zone);
        if (!formatter) {
            formatter = new Intl.DateTimeFormat("en-US", {
                timeZone: zone, hourCycle: "h23", weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric"
            });
            oracleFormatters.set(zone, formatter);
        }
        const parts: Record<string, string> = {};
        for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
        wall = [Number(parts.minute), Number(parts.hour), Number(parts.day), Number(parts.month), DOW[parts.weekday]];
    } else {
        wall = [instant.getMinutes(), instant.getHours(), instant.getDate(), instant.getMonth() + 1, instant.getDay()];
    }
    memo.set(instantMs, wall);
    return wall;
}

function oracleMatches(expression: string, instantMs: number, zone?: string): boolean {
    let fields = expandedFields.get(expression);
    if (!fields) {
        const [minute, hour, dom, month, dow] = expression.split(" ");
        fields = [expand(minute, 0, 59), expand(hour, 0, 23), expand(dom, 1, 31), expand(month, 1, 12), expand(dow, 0, 6)]
            .map(values => new Set(values));
        expandedFields.set(expression, fields);
    }
    const checked = fields;
    const [minute, hour, dom, month, dow] = oracleWall(instantMs, zone).map((value, i) => checked[i].has(value));
    // Standard cron: with both day fields restricted, either day will do.
    const [, , domField, , dowField] = expression.split(" ");
    const day = !domField.startsWith("*") && !dowField.startsWith("*") ? dom || dow : dom && dow;
    return minute && hour && month && day;
}

function oracleNext(expression: string, after: Date, zone?: string): string {
    let t = Math.floor(after.getTime() / MINUTE) * MINUTE + MINUTE;
    while (!oracleMatches(expression, t, zone)) t += MINUTE;
    return new Date(t).toISOString();
}

function oraclePrevious(expression: string, from: Date, to: Date, zone?: string): string | undefined {
    for (let t = Math.floor(to.getTime() / MINUTE) * MINUTE; t >= from.getTime(); t -= MINUTE) {
        if (oracleMatches(expression, t, zone)) return new Date(t).toISOString();
    }
    return undefined;
}

// ─── The corpus ──────────────────────────────────────────────────────

/** A small deterministic PRNG, so a failure names a case that fails again. */
function prng(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state / 2_147_483_648;
    };
}

/**
 * Expressions whose next slot is never more than a few days out, so the oracle
 * — one `Intl` read per minute — stays affordable: every field the hop treats
 * differently (minute lists and steps, hour lists and ranges, the hours a
 * change skips or repeats, weekdays, days of the month), in combination.
 */
function corpus(random: () => number, size: number): string[] {
    const pick = (options: string[]) => options[Math.floor(random() * options.length)];
    const expressions = new Set<string>([
        "* * * * *",
        "45 * * * *",
        "30 2 * * *",
        "15 1 * * *",
        "0 0 * * *",
        "59 23 * * *",
        "*/15 1-3 * * *",
        "0,30 2,3 * * 1-5"
    ]);
    while (expressions.size < size) {
        expressions.add([
            pick(["*", "0", "30", "45", "59", "*/7", "0,30", "5-10", "10-50/20"]),
            pick(["*", "0", "1", "2", "3", "23", "1-3", "*/5", "2,3", "22-23"]),
            pick(["*", "*", "*", "*", "*", "*", "1-31", "1-15,16-31"]),
            pick(["*", "*", "*", "*", "*", "1-12"]),
            pick(["*", "*", "*", "1-5", "0-6"])
        ].join(" "));
    }
    return [...expressions];
}

/** The instants a zone's offset changes during 2026, found by reading it hourly. */
function transitions2026(zone: string | undefined): number[] {
    const offsetOf = (t: number) => {
        if (!zone) return -new Date(t).getTimezoneOffset();
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric"
        }).formatToParts(new Date(t));
        const read = (type: string) => Number(parts.find(part => part.type === type)?.value);
        return (Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute")) - t) / MINUTE;
    };
    const found: number[] = [];
    let previous = offsetOf(Date.UTC(2026, 0, 1));
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 60 * MINUTE) {
        const offset = offsetOf(t);
        if (offset !== previous) found.push(t);
        previous = offset;
    }
    return found;
}

/**
 * Instants to search from: a few hours either side of each change of offset
 * in 2026, at an odd step so the seconds and minutes vary, plus a spread
 * across the year for the zones that never change.
 */
function instantsFor(zone: string | undefined): Date[] {
    const instants: Date[] = [];
    for (const change of transitions2026(zone)) {
        for (let k = -6; k <= 6; k++) instants.push(new Date(change + k * 29 * MINUTE + 17_000));
    }
    for (let month = 0; month < 12; month += 3) instants.push(new Date(Date.UTC(2026, month, 11, 7, 13, 41)));
    return instants;
}

describe("the zones this file needs", () => {
    it("change their offset during 2026 where they keep summer time", () => {
        // Guards the corpus: with no changes to search around, the DST cases
        // below would quietly test nothing.
        expect(transitions2026(undefined)).toHaveLength(2);
        expect(transitions2026("Australia/Lord_Howe")).toHaveLength(2);
        expect(transitions2026("Antarctica/Troll")).toHaveLength(2);
        expect(transitions2026("Asia/Kathmandu")).toHaveLength(0);
    });
});

describe("parseCronExpression gives the minute-by-minute answer", () => {
    for (const zone of ZONES) {
        it(`in ${zone ?? "the host zone"}`, () => {
            const expressions = corpus(prng(zone?.length ?? 7), 16);
            const mismatches: string[] = [];
            for (const after of instantsFor(zone)) {
                for (const expression of expressions) {
                    const expected = oracleNext(expression, after, zone);
                    const actual = parseCronExpression(expression, after, zone).toISOString();
                    if (actual !== expected) mismatches.push(`"${expression}" after ${after.toISOString()}: ${actual}, expected ${expected}`);
                }
            }
            expect(mismatches).toEqual([]);
        });
    }

    it("for sparse schedules: monthly, yearly and on 29 February", () => {
        const cases: [string, string, string | undefined][] = [
            ["0 9 * * 1", "2026-10-24T23:00:00Z", "Europe/Madrid"],
            ["45 1 * * 0", "2026-04-04T13:00:00Z", "Australia/Lord_Howe"],
            ["15 2 * * 0", "2026-10-03T13:00:00Z", "Australia/Lord_Howe"],
            ["5 4 * * 0,6", "2026-03-26T12:00:00Z", undefined],
            ["0 9 1 * *", "2026-10-06T12:00:00Z", "Europe/Madrid"],
            ["0 0 1 1 *", "2026-10-06T12:00:00Z", "Europe/Madrid"],
            ["30 2 29,30 3 *", "2026-03-28T23:00:00Z", "Europe/Madrid"],
            ["30 2 1 11 *", "2026-10-06T12:00:00Z", "America/New_York"],
            ["0 0 29 2 *", "2026-10-06T12:00:00Z", undefined]
        ];
        for (const [expression, after, zone] of cases) {
            expect(parseCronExpression(expression, new Date(after), zone).toISOString())
                .toBe(oracleNext(expression, new Date(after), zone));
        }
    });
});

describe("findMostRecentSlot gives the minute-by-minute answer", () => {
    for (const zone of ZONES) {
        it(`in ${zone ?? "the host zone"}`, () => {
            const expressions = corpus(prng((zone?.length ?? 7) + 1), 12);
            const mismatches: string[] = [];
            for (const to of instantsFor(zone)) {
                const from = new Date(to.getTime() - 26 * 60 * MINUTE);
                for (const expression of expressions) {
                    const expected = oraclePrevious(expression, from, to, zone);
                    const actual = findMostRecentSlot(expression, from, to, zone)?.toISOString();
                    if (actual !== expected) mismatches.push(`"${expression}" in [${from.toISOString()}, ${to.toISOString()}]: ${actual}, expected ${expected}`);
                }
            }
            expect(mismatches).toEqual([]);
        });
    }
});

describe("what a slot search costs", () => {
    afterEach(() => { jest.restoreAllMocks(); });

    /** Wall-clock reads in a named zone — the call the old search made once per minute. */
    function countZoneReads(): { readonly calls: number } {
        const spy = jest.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
        return { get calls() { return spy.mock.calls.length; } };
    }

    it("reads the wall clock about once a day for a yearly job in a zone, not once a minute", () => {
        // Minute by minute this was ~525,000 reads and a third of a second of
        // blocked event loop, on every re-arm.
        const reads = countZoneReads();
        const slot = parseCronExpression("0 0 1 1 *", new Date("2026-01-02T12:00:00Z"), "Europe/Madrid");
        expect(slot.toISOString()).toBe("2026-12-31T23:00:00.000Z");
        expect(reads.calls).toBeLessThan(1_000);
    });

    it("stays proportional to days, not minutes, for 29 February", () => {
        // Minute by minute: ~2.1 million reads, two seconds of blocked event loop.
        const reads = countZoneReads();
        const slot = parseCronExpression("0 0 29 2 *", new Date("2024-03-01T12:00:00Z"), "America/New_York");
        expect(slot.toISOString()).toBe("2028-02-29T05:00:00.000Z");
        expect(reads.calls).toBeLessThan(3_000);
    });

    it("gives up on a date that never occurs after a bounded number of reads", () => {
        const reads = countZoneReads();
        expect(() => parseCronExpression("0 0 31 2 *", new Date("2026-01-01T00:00:00Z"), "Europe/Madrid"))
            .toThrow(/no matching time/);
        expect(reads.calls).toBeLessThan(3_000);
    });

    it("searches back through a seven-day catch-up window in a handful of reads", () => {
        const reads = countZoneReads();
        const to = new Date("2026-10-06T12:00:00Z");
        const from = new Date(to.getTime() - 7 * 24 * 60 * MINUTE);
        expect(findMostRecentSlot("0 0 1 1 *", from, to, "Europe/Madrid")).toBeUndefined();
        expect(reads.calls).toBeLessThan(30);
    });
});

describe("a listing on a process whose scheduler is not started", () => {
    afterEach(() => { jest.restoreAllMocks(); });

    function job(id: string, schedule: string, timezone?: string): LoadedCronJob {
        return { id, definition: { schedule, timezone, handler: async () => undefined } };
    }

    it("does not search for the next slot again while the last answer still holds", async () => {
        // The api role answers Studio's Cron panel every 15 seconds; each
        // listing searched every job's schedule from scratch.
        const scheduler = new CronScheduler();
        scheduler.registerJobs([job("monthly", "0 9 1 * *", "Europe/Madrid"), job("yearly", "0 0 1 1 *", "Europe/Madrid")]);
        const first = await scheduler.fetchJobs();
        const spy = jest.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
        const second = await scheduler.fetchJobs();
        expect(spy).not.toHaveBeenCalled();
        expect(second.map(status => status.nextRunAt)).toEqual(first.map(status => status.nextRunAt));
        expect(first.every(status => status.nextRunAt !== undefined)).toBe(true);
    });

    it("searches again once the slot it showed has passed", async () => {
        jest.useFakeTimers({ now: new Date("2026-10-06T06:59:30Z") });
        try {
            const scheduler = new CronScheduler();
            scheduler.registerJobs([job("morning", "0 9 * * *", "Europe/Madrid")]);
            expect((await scheduler.fetchJob("morning"))?.nextRunAt).toBe("2026-10-06T07:00:00.000Z");
            jest.setSystemTime(new Date("2026-10-06T07:00:10Z"));
            expect((await scheduler.fetchJob("morning"))?.nextRunAt).toBe("2026-10-07T07:00:00.000Z");
        } finally {
            jest.useRealTimers();
        }
    });

    it("searches again when the job is registered with a different schedule", async () => {
        const scheduler = new CronScheduler();
        scheduler.registerJobs([job("report", "0 9 1 * *", "Europe/Madrid")]);
        const before = (await scheduler.fetchJob("report"))?.nextRunAt;
        scheduler.registerJobs([job("report", "0 9 2 * *", "Europe/Madrid")]);
        const after = (await scheduler.fetchJob("report"))?.nextRunAt;
        expect(after).not.toBe(before);
        expect(after).toBe(parseCronExpression("0 9 2 * *", new Date(), "Europe/Madrid").toISOString());
    });
});
