/**
 * Row history past its retention period is deleted on a schedule, once an
 * hour across every instance.
 *
 * Pruning ran only inline, after a write, for the row written — so the history
 * of a row nobody writes again (every deleted row) stayed for good, whatever
 * `retention` said. `pruneExpired` existed and had no caller.
 */
import { describe, it, expect, jest, afterEach } from "@jest/globals";
import type { DataDriver } from "@rebasepro/types";
import {
    HISTORY_RETENTION_SWEEP_INTERVAL_MS,
    HISTORY_RETENTION_SWEEP_JOB_ID,
    createHistoryRetentionSweep,
    startHistoryRetentionSweep
} from "../src/history/retention-sweep";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const HOUR = HISTORY_RETENTION_SWEEP_INTERVAL_MS;

/** A `cron_claims` that remembers who took which slot. */
function claimsTable() {
    const taken = new Set<string>();
    return async (jobId: string, slot: string) => {
        const key = `${jobId}@${slot}`;
        if (taken.has(key)) return false;
        taken.add(key);
        return true;
    };
}

afterEach(() => {
    jest.useRealTimers();
});

describe("the history retention sweep", () => {
    it("runs on one instance per hour, however many tick in it", async () => {
        let clock = Date.parse("2026-10-07T10:05:00Z");
        const claimSlot = claimsTable();
        const pruneExpired = jest.fn(async () => 3);
        const instances = [1, 2, 3].map(() => createHistoryRetentionSweep({ pruneExpired, claimSlot, now: () => clock }));

        const outcomes = await Promise.all(instances.map(sweep => sweep.runSlot()));
        expect(outcomes.filter(o => o === "swept")).toHaveLength(1);
        expect(outcomes.filter(o => o === "claimed-elsewhere")).toHaveLength(2);
        expect(pruneExpired).toHaveBeenCalledTimes(1);

        clock += 40 * 60 * 1000;
        expect(await instances[2].runSlot()).toBe("claimed-elsewhere");
        clock += 20 * 60 * 1000;
        expect(await instances[1].runSlot()).toBe("swept");
        expect(pruneExpired).toHaveBeenCalledTimes(2);
    });

    it("claims the hour it is in, under its own job id", async () => {
        const claimSlot = jest.fn(async () => true);
        const sweep = createHistoryRetentionSweep({
            pruneExpired: async () => 0,
            claimSlot,
            now: () => Date.parse("2026-10-07T10:59:59Z")
        });
        await sweep.runSlot();
        expect(claimSlot).toHaveBeenCalledWith(HISTORY_RETENTION_SWEEP_JOB_ID, "2026-10-07T10:00:00.000Z");
    });

    it("does not sweep when the claim cannot be answered, rather than on every instance", async () => {
        const pruneExpired = jest.fn(async () => 0);
        const sweep = createHistoryRetentionSweep({
            pruneExpired,
            claimSlot: async () => { throw new Error("relation \"rebase.cron_claims\" does not exist"); }
        });
        expect(await sweep.runSlot()).toBe("unclaimed");
        expect(pruneExpired).not.toHaveBeenCalled();
    });

    it("sweeps when started and again every hour, until stopped, and outlives a failed sweep", async () => {
        jest.useFakeTimers();
        const pruneExpired = jest.fn<() => Promise<number>>()
            .mockRejectedValueOnce(new Error("statement timeout"))
            .mockResolvedValue(0);
        const sweep = createHistoryRetentionSweep({ pruneExpired });
        sweep.start();
        await jest.advanceTimersByTimeAsync(0);
        expect(pruneExpired).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(HOUR);
        expect(pruneExpired).toHaveBeenCalledTimes(2);
        await sweep.stop();
        await jest.advanceTimersByTimeAsync(3 * HOUR);
        expect(pruneExpired).toHaveBeenCalledTimes(2);
    });

    it("lets a stop wait for the sweep still running, and tells that sweep to end after its batch", async () => {
        let finish!: () => void;
        let signal: AbortSignal | undefined;
        const pruneExpired = jest.fn((options: { signal: AbortSignal }) => {
            signal = options.signal;
            return new Promise<number>(resolve => { finish = () => resolve(10); });
        });
        const sweep = createHistoryRetentionSweep({ pruneExpired });
        sweep.start();
        expect(signal?.aborted).toBe(false);
        let stopped = false;
        const stopping = sweep.stop().then(() => { stopped = true; });
        await Promise.resolve();
        expect(signal?.aborted).toBe(true);
        expect(stopped).toBe(false);
        finish();
        await stopping;
        expect(stopped).toBe(true);
    });
});

describe("where the boot starts it", () => {
    const sqlDriver = (statements: string[]): DataDriver => ({
        admin: {
            executeSql: async (sql: string) => {
                statements.push(sql.replace(/\s+/g, " ").trim());
                return /INSERT INTO rebase\.cron_claims/.test(sql) ? [{ job_id: HISTORY_RETENTION_SWEEP_JOB_ID }] : [];
            }
        }
    }) as unknown as DataDriver;

    it("on the process that owns the timers, claiming through the cron store", async () => {
        const statements: string[] = [];
        const pruneExpired = jest.fn(async () => 0);
        const sweep = startHistoryRetentionSweep({ historyService: { pruneExpired }, driver: sqlDriver(statements), ownsTimers: true });
        try {
            expect(sweep).toBeDefined();
            await sweep!.runSlot();
            expect(pruneExpired).toHaveBeenCalled();
            expect(statements.some(s => s.startsWith("INSERT INTO rebase.cron_claims"))).toBe(true);
        } finally {
            await sweep?.stop();
        }
    });

    it("not on a process that does not own the timers, nor without history, nor for a service that cannot prune by age", () => {
        const driver = sqlDriver([]);
        expect(startHistoryRetentionSweep({ historyService: { pruneExpired: async () => 0 }, driver, ownsTimers: false })).toBeUndefined();
        expect(startHistoryRetentionSweep({ historyService: undefined, driver, ownsTimers: true })).toBeUndefined();
        expect(startHistoryRetentionSweep({ historyService: {}, driver, ownsTimers: true })).toBeUndefined();
    });
});
