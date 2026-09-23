/** @jest-environment ./test/helpers/madrid-tz-environment.cjs */
import { describe, it, expect } from "@jest/globals";
import { parseCronExpression, findMostRecentSlot } from "./cron-scheduler";

/**
 * Slot search across a daylight-saving change, on a host whose own zone has
 * one.
 *
 * The search stepped a minute at a time with the local-time setters, and a
 * local minute is not always a real one. On the night Europe/Madrid falls back
 * (2026-10-25, 03:00 CEST → 02:00 CET, 01:00 UTC), stepping from 02:59 CEST
 * landed on 03:00 CET — an hour later, skipping the repeated hour — and at
 * 02:30 CET the "next" slot came out as 02:31 CEST, an hour in the past, so the
 * scheduler floored the delay to five seconds and re-armed every five seconds
 * for an hour. A schedule that named its zone went the same way, since only the
 * matching read the zone; the stepping was still the host's.
 *
 * The host zone is set to Europe/Madrid by the environment named in the
 * docblock above, not here: Jest hands a test file its own copy of
 * `process.env`, so assigning `TZ` in the file never reached Node — the file
 * passed on a machine already on Madrid time and failed in CI's UTC. The guard
 * below is what caught it.
 */

/** The zone the environment sets, and the one the zone-naming schedules below name. */
const HOST_ZONE = "Europe/Madrid";

const MINUTE = 60_000;

describe("the host zone is the one this file needs", () => {
    it("reads 2026-10-25T00:30Z as 02:30 summer time", () => {
        // Guards the rest of the file: if the runtime ignored the assignment,
        // every test below would pass against UTC and prove nothing.
        const instant = new Date("2026-10-25T00:30:00Z");
        expect(instant.getHours()).toBe(2);
        expect(instant.getTimezoneOffset()).toBe(-120);
    });
});

describe("parseCronExpression across the autumn fall-back", () => {
    it("finds the next minute one real minute ahead, all through the repeated hour", () => {
        // Every 30s from 01:30 CEST to 03:30 CET, both passes of 02:xx included.
        const start = Date.parse("2026-10-24T23:30:15Z");
        const end = Date.parse("2026-10-25T02:30:15Z");
        for (let t = start; t <= end; t += 30_000) {
            const after = new Date(t);
            const next = parseCronExpression("* * * * *", after);
            const ahead = next.getTime() - t;
            expect({ after: after.toISOString(), ahead: ahead > 0 && ahead <= MINUTE }).toEqual({
                after: after.toISOString(),
                ahead: true
            });
            expect(next.getTime() % MINUTE).toBe(0);
        }
    });

    it("steps from the last summer-time minute into the repeated hour", () => {
        // 02:59:30 CEST → 02:00 CET, thirty seconds later — not 03:00 CET.
        expect(parseCronExpression("* * * * *", new Date("2026-10-25T00:59:30Z")).toISOString())
            .toBe("2026-10-25T01:00:00.000Z");
    });

    it("keeps an hourly job hourly through the repeated hour", () => {
        // From 02:50 CEST the next :45 is 02:45 CET, fifty-five real minutes
        // on — not 03:45 CET, which is what stepping over the hour answered.
        expect(parseCronExpression("45 * * * *", new Date("2026-10-25T00:50:00Z")).toISOString())
            .toBe("2026-10-25T01:45:00.000Z");
    });

    it("never answers with a slot in the past during the second pass", () => {
        // 02:30:10 CET. The old answer was 02:31 CEST, an hour ago.
        expect(parseCronExpression("* * * * *", new Date("2026-10-25T01:30:10Z")).toISOString())
            .toBe("2026-10-25T01:31:00.000Z");
    });

    it("does the same for a schedule that names its zone", () => {
        expect(parseCronExpression("* * * * *", new Date("2026-10-25T01:30:10Z"), HOST_ZONE).toISOString())
            .toBe("2026-10-25T01:31:00.000Z");
    });
});

describe("parseCronExpression across the spring-forward", () => {
    it("steps from 01:59 CET straight to 03:00 CEST", () => {
        // 2026-03-29, 02:00 CET → 03:00 CEST (01:00 UTC): 02:xx never happens.
        expect(parseCronExpression("* * * * *", new Date("2026-03-29T00:59:30Z")).toISOString())
            .toBe("2026-03-29T01:00:00.000Z");
    });
});

describe("findMostRecentSlot across the autumn fall-back", () => {
    it("walks back through the repeated hour rather than over it", () => {
        // From 02:10 CET, the latest :45 is 02:45 CEST — in the first pass of
        // the hour. Stepping back with local setters went from 02:00 CET to
        // 01:59 CEST and answered 01:45 CEST, an hour too early.
        const to = new Date("2026-10-25T01:10:00Z");
        const from = new Date(to.getTime() - 2 * 60 * MINUTE);
        expect(findMostRecentSlot("45 * * * *", from, to)?.toISOString()).toBe("2026-10-25T00:45:00.000Z");
    });

    it("walks back through it for a schedule that names its zone", () => {
        const to = new Date("2026-10-25T01:10:00Z");
        const from = new Date(to.getTime() - 2 * 60 * MINUTE);
        expect(findMostRecentSlot("45 * * * *", from, to, HOST_ZONE)?.toISOString()).toBe("2026-10-25T00:45:00.000Z");
    });
});
