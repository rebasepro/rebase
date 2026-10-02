/**
 * Expired auth tokens are deleted on a schedule, once an hour across every
 * instance.
 *
 * `deleteExpiredTokens` was implemented by every repository and called by
 * nothing, so every expired reset link, magic link, email code, abandoned
 * refresh token and stale MFA challenge stayed in the database for good.
 */
import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DataDriver } from "@rebasepro/types";
import {
    EXPIRED_TOKEN_SWEEP_INTERVAL_MS,
    EXPIRED_TOKEN_SWEEP_JOB_ID,
    createExpiredTokenSweep,
    startExpiredTokenSweep
} from "../src/auth/expired-token-sweep";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const HOUR = EXPIRED_TOKEN_SWEEP_INTERVAL_MS;

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

describe("the expired-token sweep", () => {
    it("runs on one instance per hour, however many tick in it", async () => {
        let clock = Date.parse("2026-10-02T10:05:00Z");
        const claimSlot = claimsTable();
        const deleteExpiredTokens = jest.fn(async () => undefined);
        const instances = [1, 2, 3].map(() => createExpiredTokenSweep({ authRepo: { deleteExpiredTokens }, claimSlot, now: () => clock }));

        const outcomes = await Promise.all(instances.map(sweep => sweep.runSlot()));
        expect(outcomes.filter(o => o === "swept")).toHaveLength(1);
        expect(outcomes.filter(o => o === "claimed-elsewhere")).toHaveLength(2);
        expect(deleteExpiredTokens).toHaveBeenCalledTimes(1);

        // Later in the same hour: nobody sweeps again.
        clock += 40 * 60 * 1000;
        expect(await instances[2].runSlot()).toBe("claimed-elsewhere");
        // The next hour: one of them does.
        clock += 20 * 60 * 1000;
        expect(await instances[1].runSlot()).toBe("swept");
        expect(deleteExpiredTokens).toHaveBeenCalledTimes(2);
    });

    it("claims the hour it is in, under its own job id", async () => {
        const claimSlot = jest.fn(async () => true);
        const sweep = createExpiredTokenSweep({
            authRepo: { deleteExpiredTokens: async () => undefined },
            claimSlot,
            now: () => Date.parse("2026-10-02T10:59:59Z")
        });
        await sweep.runSlot();
        expect(claimSlot).toHaveBeenCalledWith(EXPIRED_TOKEN_SWEEP_JOB_ID, "2026-10-02T10:00:00.000Z");
    });

    it("does not sweep when the claim cannot be answered, rather than on every instance", async () => {
        const deleteExpiredTokens = jest.fn(async () => undefined);
        const sweep = createExpiredTokenSweep({
            authRepo: { deleteExpiredTokens },
            claimSlot: async () => { throw new Error("relation \"rebase.cron_claims\" does not exist"); }
        });
        expect(await sweep.runSlot()).toBe("unclaimed");
        expect(deleteExpiredTokens).not.toHaveBeenCalled();
    });

    it("sweeps when started and again every hour", async () => {
        jest.useFakeTimers();
        const deleteExpiredTokens = jest.fn(async () => undefined);
        const sweep = createExpiredTokenSweep({ authRepo: { deleteExpiredTokens } });
        sweep.start();
        await jest.advanceTimersByTimeAsync(0);
        expect(deleteExpiredTokens).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(HOUR);
        expect(deleteExpiredTokens).toHaveBeenCalledTimes(2);
        sweep.stop();
        await jest.advanceTimersByTimeAsync(3 * HOUR);
        expect(deleteExpiredTokens).toHaveBeenCalledTimes(2);
    });
});

describe("where the boot starts it", () => {
    const sqlDriver = (statements: string[]): DataDriver => ({
        admin: {
            executeSql: async (sql: string) => {
                statements.push(sql.replace(/\s+/g, " ").trim());
                return /INSERT INTO rebase\.cron_claims/.test(sql) ? [{ job_id: EXPIRED_TOKEN_SWEEP_JOB_ID }] : [];
            }
        }
    }) as unknown as DataDriver;

    it("on the process that owns the timers, claiming through the cron store", async () => {
        const statements: string[] = [];
        const deleteExpiredTokens = jest.fn(async () => undefined);
        const sweep = startExpiredTokenSweep({ authRepo: { deleteExpiredTokens }, driver: sqlDriver(statements), ownsTimers: true });
        try {
            expect(sweep).toBeDefined();
            await sweep!.runSlot();
            expect(deleteExpiredTokens).toHaveBeenCalled();
            expect(statements.some(s => s.startsWith("INSERT INTO rebase.cron_claims"))).toBe(true);
        } finally {
            sweep?.stop();
        }
    });

    it("not on a process that does not own the timers, nor without a repository that can sweep", () => {
        const driver = sqlDriver([]);
        expect(startExpiredTokenSweep({ authRepo: { deleteExpiredTokens: async () => undefined }, driver, ownsTimers: false })).toBeUndefined();
        expect(startExpiredTokenSweep({ authRepo: {}, driver, ownsTimers: true })).toBeUndefined();
    });

    it("is started by initializeRebaseBackend and stopped by its shutdown", () => {
        const init = readFileSync(path.join(__dirname, "../src/init.ts"), "utf8");
        expect(init).toMatch(/startExpiredTokenSweep\(\{[\s\S]*?ownsTimers: ownership\.cronScheduler/);
        expect(init).toMatch(/createShutdown\(\{[\s\S]*?authTokenSweep[\s\S]*?\}\)/);
    });
});
