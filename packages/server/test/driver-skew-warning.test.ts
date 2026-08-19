import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { warnOnDriverSkew } from "../src/boot/boot";
import type { InitializedDataSource } from "../src/boot/driver";
import { logger } from "../src/utils/logger";

/**
 * Making a two-halves-disagree deployment say so at boot.
 *
 * A managed runtime is assembled from an image and a bundle. The image supplies
 * `@rebasepro/server`; every driver comes from the bundle's own dependencies,
 * pinned by the project's package.json. Nothing compared the two, so the
 * platform could ship a fix, roll every tenant onto the new image, and leave
 * all of them running a driver from before the fix — with no line anywhere
 * saying the halves disagreed. That is not a hypothetical: it cost a day, and
 * the visible symptom was a capability reported "not implemented" by a driver
 * that implements it perfectly well in a later version.
 *
 * The warning is advisory on purpose. Old drivers are a supported pairing, so
 * this must never escalate to a refusal — it only has to make the skew visible
 * to whoever reads the log next.
 */
function source(overrides: Partial<InitializedDataSource> = {}): InitializedDataSource {
    return {
        key: "(default)",
        engine: "postgres",
        driverPackage: "@rebasepro/server-postgres",
        driverVersion: "0.12.0",
        bootstrapper: {} as InitializedDataSource["bootstrapper"],
        connection: {} as InitializedDataSource["connection"],
        ...overrides
    };
}

describe("warnOnDriverSkew", () => {
    let warn: jest.SpiedFunction<typeof logger.warn>;

    beforeEach(() => {
        jest.restoreAllMocks();
        warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    });

    it("warns when the bundle's driver is older than the runtime", () => {
        warnOnDriverSkew([source({ driverVersion: "0.12.0" })], "0.12.1");

        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0][0]);
        // Both numbers, because one alone cannot be acted on.
        expect(message).toContain("0.12.0");
        expect(message).toContain("0.12.1");
        // The load-bearing sentence: it explains why upgrading the platform
        // does not fix this, which is the step everyone tries first.
        expect(message).toContain("package.json");
        expect(message).toMatch(/not supplied by the platform image/i);
    });

    it("says nothing when the driver matches the runtime", () => {
        warnOnDriverSkew([source({ driverVersion: "0.12.1" })], "0.12.1");
        expect(warn).not.toHaveBeenCalled();
    });

    it("says nothing when the driver is one patch ahead of the runtime", () => {
        // The original rationale, kept: a pinned-ahead driver at patch level is
        // someone taking a fix early, and complaining about it would train
        // people to ignore the line.
        warnOnDriverSkew([source({ driverVersion: "0.12.2" })], "0.12.1");
        expect(warn).not.toHaveBeenCalled();
    });

    it("warns when the driver is a minor or more ahead of the runtime", () => {
        // The pairing that cost a day: the image shipped framework 0.13.0 while
        // the bundle was built against 0.15.0, so a feature split across
        // `@rebasepro/server` and the driver had only its driver half present.
        // Realtime channels went silently inert — the socket connected, frames
        // were accepted, and nothing fanned out. Nobody chose this pairing; a
        // floating runtime range produced it when the image lagged.
        warnOnDriverSkew([source({ driverVersion: "0.15.0" })], "0.13.0");

        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0][0]);
        expect(message).toContain("0.15.0");
        expect(message).toContain("0.13.0");
        expect(message).toMatch(/ahead/i);
        // The load-bearing difference from the stale case: the remedy is the
        // opposite one. Telling this operator to bump package.json would send
        // them further from the fix.
        expect(message).toMatch(/newer platform image|pin the runtime/i);
        // And it must describe the symptom, because the symptom is nothing —
        // whoever reads this is looking for a subsystem that failed loudly.
        expect(message).toMatch(/silently inert/i);
    });

    it("warns when the driver leads by a major", () => {
        warnOnDriverSkew([source({ driverVersion: "1.1.0" })], "0.15.0");
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toMatch(/ahead/i);
    });

    it("gives a behind driver the stale remedy and only that one", () => {
        // The two remedies contradict each other — bump the package vs bump the
        // image — so emitting both for one source would be worse than silence.
        warnOnDriverSkew([source({ driverVersion: "0.11.0" })], "0.15.0");

        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0][0]);
        expect(message).toContain("package.json");
        expect(message).not.toMatch(/ahead/i);
        expect(message).not.toMatch(/newer platform image/i);
    });

    it("stays silent when either version is unknown", () => {
        warnOnDriverSkew([source({ driverVersion: undefined })], "0.12.1");
        warnOnDriverSkew([source({ driverVersion: "0.12.0" })], undefined);
        expect(warn).not.toHaveBeenCalled();
    });

    it("treats a canary as older than the release it precedes", () => {
        // The exact pairing from the incident: the fix shipped in canaries built
        // after 0.12.0, and a tenant pinned to plain 0.12.0 was behind them all.
        warnOnDriverSkew([source({ driverVersion: "0.12.0" })], "0.12.1-canary.g7f1150f");
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("reports each stale source separately and names which one", () => {
        // Multi-database projects pin drivers per source, so one can lag while
        // another is current — an aggregate count would not say which to bump.
        warnOnDriverSkew(
            [
                source({ key: "(default)", driverVersion: "0.12.0" }),
                source({ key: "analytics", driverVersion: "0.12.1" }),
                source({ key: "legacy", driverVersion: "0.11.0" })
            ],
            "0.12.1"
        );

        expect(warn).toHaveBeenCalledTimes(2);
        const messages = warn.mock.calls.map(call => String(call[0]));
        expect(messages.some(m => m.includes("\"(default)\""))).toBe(true);
        expect(messages.some(m => m.includes("\"legacy\""))).toBe(true);
        expect(messages.some(m => m.includes("\"analytics\""))).toBe(false);
    });
});
