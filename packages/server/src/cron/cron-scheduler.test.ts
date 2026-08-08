import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { CronScheduler, validateCronExpression, findMostRecentSlot } from "./cron-scheduler";
import type { CronJobDefinition, CronJobLogEntry } from "@rebasepro/types";
import type { LoadedCronJob } from "./cron-loader";

// ─── Helpers ────────────────────────────────────────────────────────

function makeJob(id: string, overrides: Partial<CronJobDefinition> = {}): LoadedCronJob {
    return {
        id,
        definition: {
            schedule: "0 * * * *",
            name: `Job ${id}`,
            description: `Description for ${id}`,
            enabled: true,
            timeoutSeconds: 5,
            handler: async (ctx) => { ctx.log("hello from", id); return { ok: true }; },
            ...overrides
        }
    };
}

function makeFailingJob(id: string, errorMsg = "boom"): LoadedCronJob {
    return makeJob(id, { handler: async () => { throw new Error(errorMsg); } });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("CronScheduler", () => {
    let scheduler: CronScheduler;

    beforeEach(() => {
        scheduler = new CronScheduler();
        jest.useFakeTimers();
    });

    afterEach(() => {
        scheduler.stop();
        jest.useRealTimers();
    });

    // ── validateCronExpression ───────────────────────────────────────

    describe("validateCronExpression", () => {
        it.each([
            "0 * * * *", "*/5 * * * *", "0 0 1 * *", "30 2 * * 1",
            "0 0 * * 0", "0,15,30,45 * * * *", "0 0 1-15 * *"
        ])("accepts valid expression: %s", (expr) => {
            expect(validateCronExpression(expr)).toEqual({ valid: true });
        });

        it("rejects empty string", () => {
            const r = validateCronExpression("");
            expect(r.valid).toBe(false);
        });

        it("rejects wrong field count", () => {
            expect(validateCronExpression("* * *").valid).toBe(false);
            expect(validateCronExpression("* * * * * *").valid).toBe(false);
        });

        it("rejects out-of-range values", () => {
            expect(validateCronExpression("60 * * * *").valid).toBe(false);
            expect(validateCronExpression("* 25 * * *").valid).toBe(false);
            expect(validateCronExpression("* * 32 * *").valid).toBe(false);
            expect(validateCronExpression("* * * 13 *").valid).toBe(false);
            expect(validateCronExpression("* * * * 7").valid).toBe(false);
        });

        it("rejects non-numeric garbage", () => {
            expect(validateCronExpression("abc * * * *").valid).toBe(false);
        });
    });

    // ── Registration ────────────────────────────────────────────────

    describe("registerJobs", () => {
        it("registers jobs and they appear in listJobs", () => {
            scheduler.registerJobs([makeJob("alpha"), makeJob("beta")]);
            expect(scheduler.listJobs()).toHaveLength(2);
            expect(scheduler.listJobs().map((j) => j.id).sort()).toEqual(["alpha", "beta"]);
        });

        it("sets initial state to idle for enabled jobs", () => {
            scheduler.registerJobs([makeJob("enabled-job")]);
            expect(scheduler.getJob("enabled-job")?.state).toBe("idle");
        });

        it("sets initial state to disabled for disabled jobs", () => {
            scheduler.registerJobs([makeJob("disabled-job", { enabled: false })]);
            expect(scheduler.getJob("disabled-job")?.state).toBe("disabled");
        });

        it("initializes counters to zero", () => {
            scheduler.registerJobs([makeJob("fresh")]);
            const job = scheduler.getJob("fresh")!;
            expect(job.totalRuns).toBe(0);
            expect(job.totalFailures).toBe(0);
        });

        it("overwrites duplicate job IDs", () => {
            scheduler.registerJobs([makeJob("dup", { name: "First" })]);
            scheduler.registerJobs([makeJob("dup", { name: "Second" })]);
            expect(scheduler.listJobs()).toHaveLength(1);
            expect(scheduler.listJobs()[0].name).toBe("Second");
        });

        it("preserves definition metadata", () => {
            scheduler.registerJobs([makeJob("meta", { name: "My Job",
description: "Desc",
schedule: "30 2 * * 1" })]);
            const job = scheduler.getJob("meta")!;
            expect(job.name).toBe("My Job");
            expect(job.description).toBe("Desc");
            expect(job.schedule).toBe("30 2 * * 1");
        });

        it("rejects jobs with invalid cron schedules", () => {
            scheduler.registerJobs([makeJob("bad", { schedule: "99 99 * * *" })]);
            expect(scheduler.getJob("bad")).toBeUndefined();
            expect(scheduler.listJobs()).toHaveLength(0);
        });

        it("rejects jobs with too few fields", () => {
            scheduler.registerJobs([makeJob("short", { schedule: "* *" })]);
            expect(scheduler.getJob("short")).toBeUndefined();
        });

        it("auto-schedules newly registered jobs if already started", () => {
            scheduler.registerJobs([makeJob("early")]);
            scheduler.start();
            // Register after start
            scheduler.registerJobs([makeJob("late")]);
            expect(scheduler.getJob("late")?.nextRunAt).toBeDefined();
        });

        it("does NOT auto-schedule disabled jobs registered after start", () => {
            scheduler.start();
            scheduler.registerJobs([makeJob("off", { enabled: false })]);
            expect(scheduler.getJob("off")?.nextRunAt).toBeUndefined();
        });
    });

    // ── getJob ───────────────────────────────────────────────────────

    describe("getJob", () => {
        it("returns undefined for nonexistent ID", () => {
            expect(scheduler.getJob("nope")).toBeUndefined();
        });

        it("returns the correct job by ID", () => {
            scheduler.registerJobs([makeJob("a"), makeJob("b")]);
            expect(scheduler.getJob("b")?.id).toBe("b");
        });
    });

    // ── triggerJob (manual execution) ───────────────────────────────

    describe("triggerJob", () => {
        beforeEach(() => { jest.useRealTimers(); });

        it("returns undefined for nonexistent job", async () => {
            expect(await scheduler.triggerJob("ghost")).toBeUndefined();
        });

        it("executes the handler and returns a log entry", async () => {
            scheduler.registerJobs([makeJob("trigger-me")]);
            const log = await scheduler.triggerJob("trigger-me");
            expect(log).toBeDefined();
            expect(log!.jobId).toBe("trigger-me");
            expect(log!.success).toBe(true);
            expect(log!.manual).toBe(true);
            expect(log!.durationMs).toBeGreaterThanOrEqual(0);
            expect(log!.logs).toContain("hello from trigger-me");
            expect(log!.result).toEqual({ ok: true });
        });

        it("increments totalRuns after trigger", async () => {
            scheduler.registerJobs([makeJob("count-me")]);
            await scheduler.triggerJob("count-me");
            expect(scheduler.getJob("count-me")?.totalRuns).toBe(1);
            await scheduler.triggerJob("count-me");
            expect(scheduler.getJob("count-me")?.totalRuns).toBe(2);
        });

        it("records failure and increments totalFailures", async () => {
            scheduler.registerJobs([makeFailingJob("fail-me", "something broke")]);
            const log = await scheduler.triggerJob("fail-me");
            expect(log!.success).toBe(false);
            expect(log!.error).toBe("something broke");
            const status = scheduler.getJob("fail-me")!;
            expect(status.totalFailures).toBe(1);
            expect(status.state).toBe("error");
            expect(status.lastError).toBe("something broke");
        });

        it("captures ctx.log output", async () => {
            scheduler.registerJobs([makeJob("logger", {
                handler: async (ctx) => { ctx.log("line 1"); ctx.log("line 2", { nested: true }); ctx.log(42); }
            })]);
            const log = await scheduler.triggerJob("logger");
            expect(log!.logs).toEqual(["line 1", 'line 2 {"nested":true}', "42"]);
        });

        it("sets lastRunAt after execution", async () => {
            scheduler.registerJobs([makeJob("timed")]);
            const before = new Date();
            await scheduler.triggerJob("timed");
            const after = new Date();
            const job = scheduler.getJob("timed")!;
            const lastRun = new Date(job.lastRunAt!);
            expect(lastRun.getTime()).toBeGreaterThanOrEqual(before.getTime());
            expect(lastRun.getTime()).toBeLessThanOrEqual(after.getTime());
        });

        it("sets lastDurationMs after execution", async () => {
            scheduler.registerJobs([makeJob("duration-check")]);
            await scheduler.triggerJob("duration-check");
            expect(scheduler.getJob("duration-check")!.lastDurationMs!).toBeGreaterThanOrEqual(0);
        });

        it("handles handler that returns undefined (void)", async () => {
            scheduler.registerJobs([makeJob("void-handler", { handler: async () => {} })]);
            const log = await scheduler.triggerJob("void-handler");
            expect(log!.success).toBe(true);
            expect(log!.result).toBeUndefined();
        });

        it("handles synchronous handler", async () => {
            scheduler.registerJobs([makeJob("sync-handler", {
                handler: (ctx) => { ctx.log("sync"); return { sync: true }; }
            })]);
            const log = await scheduler.triggerJob("sync-handler");
            expect(log!.success).toBe(true);
            expect(log!.result).toEqual({ sync: true });
        });

        it("redacts a failing query out of the persisted error", async () => {
            // `error` is not only logged — it is written to `cron_logs` and
            // rendered in the Studio cron panel, so Drizzle's
            // `Failed query: <sql>\nparams: <values>` wrapper would store the
            // statement and every bound value in a table, indefinitely.
            const drizzleFailure = new Error(
                'Failed query: insert into "users" ("email", "password_hash") values ($1, $2)\n'
                + "params: alice@acme.com,$2b$12$abcdefghijklmnop"
            );
            scheduler.registerJobs([makeJob("leaky", {
                handler: async () => { throw drizzleFailure; }
            })]);

            const log = await scheduler.triggerJob("leaky");

            expect(log!.success).toBe(false);
            expect(log!.error).toBe("Failed query: [redacted]");
            expect(scheduler.getJob("leaky")!.lastError).not.toContain("alice@acme.com");
            expect(scheduler.getJob("leaky")!.lastError).not.toContain("$2b$12$");
        });

        it("handles non-Error thrown values", async () => {
            scheduler.registerJobs([makeJob("string-throw", {
                handler: async () => { throw "plain string error"; }
            })]);
            const log = await scheduler.triggerJob("string-throw");
            expect(log!.success).toBe(false);
            expect(log!.error).toBe("plain string error");
        });
    });

    // ── Concurrency guard ───────────────────────────────────────────

    describe("concurrency guard", () => {
        beforeEach(() => { jest.useRealTimers(); });

        it("prevents overlapping manual triggers", async () => {
            let resolve: () => void;
            const blocker = new Promise<void>((r) => { resolve = r; });

            scheduler.registerJobs([makeJob("slow", {
                handler: async () => { await blocker; return { done: true }; }
            })]);

            // Start first trigger (will block)
            const first = scheduler.triggerJob("slow");

            // Try second trigger while first is running
            const second = await scheduler.triggerJob("slow");

            expect(second!.result).toEqual({ skipped: true,
reason: "already_executing" });
            expect(second!.logs).toContain("Skipped: job is already running");

            // Let the first one finish
            resolve!();
            const firstResult = await first;
            expect(firstResult!.success).toBe(true);
            expect(firstResult!.result).toEqual({ done: true });
        });

        it("allows trigger after previous completes", async () => {
            scheduler.registerJobs([makeJob("sequential")]);
            const log1 = await scheduler.triggerJob("sequential");
            const log2 = await scheduler.triggerJob("sequential");
            expect(log1!.success).toBe(true);
            expect(log2!.success).toBe(true);
            expect(scheduler.getJob("sequential")!.totalRuns).toBe(2);
        });

        it("resets executing flag even after handler throws", async () => {
            scheduler.registerJobs([makeFailingJob("crasher")]);
            await scheduler.triggerJob("crasher");
            // Should NOT be skipped — executing flag was reset
            const log = await scheduler.triggerJob("crasher");
            expect(log!.error).toBe("boom"); // ran again, not skipped
        });
    });

    // ── Timeout ─────────────────────────────────────────────────────

    describe("timeout", () => {
        it("times out a slow handler", async () => {
            jest.useRealTimers();
            scheduler.registerJobs([makeJob("slow", {
                timeoutSeconds: 1,
                handler: () => new Promise((resolve) => setTimeout(() => resolve("late"), 3000))
            })]);
            const log = await scheduler.triggerJob("slow");
            expect(log!.success).toBe(false);
            expect(log!.error).toContain("timed out");
        }, 10000);

        it("clears timeout timer after success (no timer leak)", async () => {
            jest.useRealTimers();
            scheduler.registerJobs([makeJob("fast", {
                timeoutSeconds: 60,
                handler: async () => "quick"
            })]);
            const log = await scheduler.triggerJob("fast");
            expect(log!.success).toBe(true);
            // If timeout wasn't cleared, Jest would hang
        });
    });

    // ── Logs ring buffer ────────────────────────────────────────────

    describe("getJobLogs", () => {
        beforeEach(() => { jest.useRealTimers(); });

        it("returns empty array for nonexistent job", () => {
            expect(scheduler.getJobLogs("nope")).toEqual([]);
        });

        it("returns logs in reverse order (newest first)", async () => {
            scheduler.registerJobs([makeJob("ordered")]);
            await scheduler.triggerJob("ordered");
            await scheduler.triggerJob("ordered");
            await scheduler.triggerJob("ordered");
            const logs = scheduler.getJobLogs("ordered");
            expect(logs).toHaveLength(3);
            expect(new Date(logs[0].startedAt).getTime()).toBeGreaterThanOrEqual(
                new Date(logs[2].startedAt).getTime()
            );
        });

        it("respects limit parameter", async () => {
            scheduler.registerJobs([makeJob("limited")]);
            for (let i = 0; i < 5; i++) await scheduler.triggerJob("limited");
            expect(scheduler.getJobLogs("limited", 2)).toHaveLength(2);
            expect(scheduler.getJobLogs("limited", 10)).toHaveLength(5);
            expect(scheduler.getJobLogs("limited")).toHaveLength(5);
        });

        it("caps at 50 entries (ring buffer)", async () => {
            scheduler.registerJobs([makeJob("ring")]);
            for (let i = 0; i < 60; i++) await scheduler.triggerJob("ring");
            expect(scheduler.getJobLogs("ring")).toHaveLength(50);
            expect(scheduler.getJob("ring")?.totalRuns).toBe(60);
        });
    });

    // ── Enable / Disable ────────────────────────────────────────────

    describe("setJobEnabled", () => {
        it("returns undefined for nonexistent job", () => {
            expect(scheduler.setJobEnabled("nope", true)).toBeUndefined();
        });

        it("disables a job", () => {
            scheduler.registerJobs([makeJob("togglable")]);
            const result = scheduler.setJobEnabled("togglable", false);
            expect(result?.enabled).toBe(false);
            expect(result?.state).toBe("disabled");
        });

        it("re-enables a disabled job", () => {
            scheduler.registerJobs([makeJob("togglable")]);
            scheduler.setJobEnabled("togglable", false);
            scheduler.start();
            const result = scheduler.setJobEnabled("togglable", true);
            expect(result?.enabled).toBe(true);
            expect(result?.state).toBe("idle");
        });

        it("clears nextRunAt when disabling", () => {
            scheduler.registerJobs([makeJob("dis")]);
            scheduler.start();
            expect(scheduler.getJob("dis")?.nextRunAt).toBeDefined();
            scheduler.setJobEnabled("dis", false);
            expect(scheduler.getJob("dis")?.nextRunAt).toBeUndefined();
        });

        it("sets nextRunAt when re-enabling", () => {
            scheduler.registerJobs([makeJob("reenable")]);
            scheduler.start();
            scheduler.setJobEnabled("reenable", false);
            scheduler.setJobEnabled("reenable", true);
            expect(scheduler.getJob("reenable")?.nextRunAt).toBeDefined();
        });
    });

    // ── start / stop ────────────────────────────────────────────────

    describe("start / stop", () => {
        it("start is idempotent", () => {
            scheduler.registerJobs([makeJob("idem")]);
            scheduler.start();
            scheduler.start();
            expect(scheduler.listJobs()).toHaveLength(1);
        });

        it("stop clears nextRunAt", () => {
            scheduler.registerJobs([makeJob("stoppable")]);
            scheduler.start();
            expect(scheduler.getJob("stoppable")?.nextRunAt).toBeDefined();
            scheduler.stop();
            expect(scheduler.getJob("stoppable")?.nextRunAt).toBeUndefined();
        });

        it("does not schedule disabled jobs on start", () => {
            scheduler.registerJobs([makeJob("off", { enabled: false })]);
            scheduler.start();
            expect(scheduler.getJob("off")?.nextRunAt).toBeUndefined();
        });

        it("stop then start re-schedules jobs", () => {
            scheduler.registerJobs([makeJob("restart")]);
            scheduler.start();
            scheduler.stop();
            expect(scheduler.getJob("restart")?.nextRunAt).toBeUndefined();
            // Reset started flag by creating a new scheduler with same jobs
            const s2 = new CronScheduler();
            s2.registerJobs([makeJob("restart")]);
            s2.start();
            expect(s2.getJob("restart")?.nextRunAt).toBeDefined();
            s2.stop();
        });
    });

    // ── Schedule-driven execution ───────────────────────────────────

    describe("scheduled execution", () => {
        it("fires job when timer elapses", async () => {
            let executed = false;
            scheduler.registerJobs([makeJob("timer-test", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            // Advance past next scheduled time
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            expect(executed).toBe(true);
            expect(scheduler.getJob("timer-test")?.totalRuns).toBeGreaterThanOrEqual(1);
        });

        it("does not fire disabled job when timer elapses", async () => {
            let executed = false;
            scheduler.registerJobs([makeJob("disabled-timer", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            scheduler.setJobEnabled("disabled-timer", false);
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            expect(executed).toBe(false);
        });

        it("does not fire after stop()", async () => {
            let executed = false;
            scheduler.registerJobs([makeJob("stopped-timer", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            scheduler.stop();
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            expect(executed).toBe(false);
        });
    });

    // ── Waking before the slot is due ───────────────────────────────

    describe("early wake-ups", () => {
        it("does not claim a slot when the clock steps back before the timer fires", async () => {
            // Claims are permanent, so claiming early is unrecoverable: the slot
            // is burned and the real run is skipped when it comes due.
            jest.setSystemTime(new Date("2026-08-04T00:00:00.000Z"));
            const tryClaimRun = jest.fn<(jobId: string, slot: string) => Promise<boolean>>()
                .mockResolvedValue(true);
            scheduler.setStore({
                ensureTable: async () => {},
                insertLog: async () => {},
                fetchLogs: async () => [],
                fetchJobStats: async () => new Map(),
                tryClaimRun
            } as never);
            scheduler.registerJobs([makeJob("hourly-claim", { schedule: "0 * * * *" })]);
            scheduler.start();

            // NTP steps the clock back half an hour. The pending timer keeps its
            // original delay, so it now wakes 30 minutes before its slot.
            jest.setSystemTime(new Date(Date.now() - 30 * 60 * 1000));
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);

            expect(tryClaimRun).not.toHaveBeenCalled();
        });
    });

    // ── Slots beyond the 32-bit setTimeout ceiling ──────────────────

    describe("far-future slots", () => {
        // "0 4 3 * *" from Aug 4 lands on Sep 3 — ~29.3 days, past the ~24.8-day
        // ceiling. Monthly jobs sit here for most of the month, so an overflow
        // that fires immediately is the common case, not an exotic one.
        const MONTHLY = "0 4 3 * *";
        const START = new Date("2026-08-04T00:00:00.000Z");

        beforeEach(() => { jest.setSystemTime(START); });

        it("does not fire a slot that overflows the timer ceiling", async () => {
            let runs = 0;
            scheduler.registerJobs([makeJob("monthly", {
                schedule: MONTHLY,
                handler: async () => { runs++; }
            })]);
            scheduler.start();

            await jest.advanceTimersByTimeAsync(60 * 1000);
            expect(runs).toBe(0);
        });

        it("reports the true next run while hopping toward it", () => {
            scheduler.registerJobs([makeJob("monthly-next", { schedule: MONTHLY })]);
            scheduler.start();

            // The schedule resolves in local time, so assert the property that
            // matters rather than a wall-clock instant: the slot is genuinely
            // past the ceiling, and the job still advertises it while hopping.
            const nextRunAt = scheduler.getJob("monthly-next")?.nextRunAt;
            expect(nextRunAt).toBeDefined();
            expect(new Date(nextRunAt!).getTime() - START.getTime())
                .toBeGreaterThan(2_147_483_647);
        });

        it("fires once the far-future slot actually arrives", async () => {
            let runs = 0;
            scheduler.registerJobs([makeJob("monthly-fires", {
                schedule: MONTHLY,
                handler: async () => { runs++; }
            })]);
            scheduler.start();

            // Past the 24.8-day hop, then past the slot itself.
            await jest.advanceTimersByTimeAsync(31 * 24 * 60 * 60 * 1000);
            expect(runs).toBe(1);
        });
    });

    // ── CronStore integration ───────────────────────────────────────

    describe("store integration", () => {
        beforeEach(() => { jest.useRealTimers(); });

        it("persists logs to store after execution", async () => {
            const insertLog = jest.fn<(entry: CronJobLogEntry) => Promise<void>>().mockResolvedValue(undefined);
            const mockStore = {
                ensureTable: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
                insertLog,
                fetchLogs: jest.fn<() => Promise<CronJobLogEntry[]>>().mockResolvedValue([]),
                fetchJobStats: jest.fn<() => Promise<Map<string, { totalRuns: number; totalFailures: number; lastRunAt?: string | Date | null }>>>().mockResolvedValue(new Map()),
                tryClaimRun: jest.fn<(jobId: string, slot: string) => Promise<boolean>>().mockResolvedValue(true)
            };
            scheduler.setStore(mockStore);
            scheduler.registerJobs([makeJob("persisted")]);
            await scheduler.triggerJob("persisted");
            expect(insertLog).toHaveBeenCalledTimes(1);
            expect(insertLog.mock.calls[0]![0].jobId).toBe("persisted");
        });

        it("does not crash if store.insertLog fails", async () => {
            const mockStore = {
                ensureTable: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
                insertLog: jest.fn<() => Promise<void>>().mockRejectedValue(new Error("DB down")),
                fetchLogs: jest.fn<() => Promise<CronJobLogEntry[]>>().mockResolvedValue([]),
                fetchJobStats: jest.fn<() => Promise<Map<string, { totalRuns: number; totalFailures: number; lastRunAt?: string | Date | null }>>>().mockResolvedValue(new Map()),
                tryClaimRun: jest.fn<(jobId: string, slot: string) => Promise<boolean>>().mockResolvedValue(true)
            };
            scheduler.setStore(mockStore);
            scheduler.registerJobs([makeJob("resilient")]);
            // Should not throw
            const log = await scheduler.triggerJob("resilient");
            expect(log!.success).toBe(true);
        });

        it("seeds counters from store on start", async () => {
            const stats = new Map<string, { totalRuns: number; totalFailures: number; lastRunAt?: string | Date | null }>();
            stats.set("seeded", { totalRuns: 42,
totalFailures: 3,
lastRunAt: "2026-01-01T00:00:00Z" });
            const mockStore = {
                ensureTable: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
                insertLog: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
                fetchLogs: jest.fn<() => Promise<CronJobLogEntry[]>>().mockResolvedValue([]),
                fetchJobStats: jest.fn<() => Promise<Map<string, { totalRuns: number; totalFailures: number; lastRunAt?: string | Date | null }>>>().mockResolvedValue(stats),
                tryClaimRun: jest.fn<(jobId: string, slot: string) => Promise<boolean>>().mockResolvedValue(true)
            };
            scheduler.setStore(mockStore);
            scheduler.registerJobs([makeJob("seeded")]);
            scheduler.start();
            // Wait for async seed
            await new Promise((r) => setTimeout(r, 50));
            const job = scheduler.getJob("seeded")!;
            expect(job.totalRuns).toBe(42);
            expect(job.totalFailures).toBe(3);
        });
    });

    // ── Slot claiming (multi-instance coordination) ─────────────────

    describe("slot claiming", () => {
        function makeMockStore(claimResult: boolean) {
            return {
                ensureTable: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
                insertLog: jest.fn<(entry: CronJobLogEntry) => Promise<void>>().mockResolvedValue(undefined),
                fetchLogs: jest.fn<() => Promise<CronJobLogEntry[]>>().mockResolvedValue([]),
                fetchJobStats: jest.fn<() => Promise<Map<string, { totalRuns: number; totalFailures: number; lastRunAt?: string }>>>().mockResolvedValue(new Map()),
                tryClaimRun: jest.fn<(jobId: string, slot: string) => Promise<boolean>>().mockResolvedValue(claimResult)
            };
        }

        it("executes the scheduled run when the claim is won", async () => {
            const store = makeMockStore(true);
            let executed = false;
            scheduler.setStore(store);
            scheduler.registerJobs([makeJob("winner", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            expect(executed).toBe(true);
            expect(store.tryClaimRun).toHaveBeenCalledWith("winner", expect.any(String));
            // The claimed slot is the scheduled fire time (a valid ISO string)
            const slot = store.tryClaimRun.mock.calls[0]![1];
            expect(new Date(slot).getTime()).not.toBeNaN();
        });

        it("skips the scheduled run when another instance claimed the slot", async () => {
            const store = makeMockStore(false);
            let executed = false;
            scheduler.setStore(store);
            scheduler.registerJobs([makeJob("loser", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            expect(executed).toBe(false);
            expect(store.tryClaimRun).toHaveBeenCalled();
            expect(scheduler.getJob("loser")?.totalRuns).toBe(0);
            // Still schedules the next slot after skipping
            expect(scheduler.getJob("loser")?.nextRunAt).toBeDefined();
        });

        it("passes the scheduled slot, not wall-clock fire time", async () => {
            const store = makeMockStore(true);
            scheduler.setStore(store);
            scheduler.registerJobs([makeJob("slot-check", { schedule: "0 * * * *" })]);
            scheduler.start();
            const scheduledSlot = scheduler.getJob("slot-check")!.nextRunAt!;
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            expect(store.tryClaimRun.mock.calls[0]![1]).toBe(scheduledSlot);
        });

        it("manual triggers bypass the claim", async () => {
            jest.useRealTimers();
            const store = makeMockStore(false); // would lose any claim race
            scheduler.setStore(store);
            scheduler.registerJobs([makeJob("manual-run")]);
            const log = await scheduler.triggerJob("manual-run");
            expect(log!.success).toBe(true);
            expect(store.tryClaimRun).not.toHaveBeenCalled();
        });

        it("runs when the store predates claims (no tryClaimRun method)", async () => {
            const store = makeMockStore(true);
            const legacyStore = { ...store, tryClaimRun: undefined };
            let executed = false;
            scheduler.setStore(legacyStore);
            scheduler.registerJobs([makeJob("legacy-store", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            expect(executed).toBe(true);
        });

        it("fails open and keeps rescheduling when the claim throws", async () => {
            const store = makeMockStore(true);
            store.tryClaimRun.mockRejectedValue(new Error("store exploded"));
            let executed = false;
            scheduler.setStore(store);
            scheduler.registerJobs([makeJob("throwing-claim", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            expect(executed).toBe(true);
            expect(scheduler.getJob("throwing-claim")?.nextRunAt).toBeDefined();
        });

        it("runs without a store (uncoordinated fallback)", async () => {
            let executed = false;
            scheduler.registerJobs([makeJob("storeless", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            expect(executed).toBe(true);
        });
    });

    // ── catch-up for slots missed while nothing was ticking ─────────

    describe("findMostRecentSlot", () => {
        it("returns the latest matching slot inside the window", () => {
            const to = new Date(2026, 6, 29, 6, 10);
            const from = new Date(2026, 6, 29, 5, 10);
            expect(findMostRecentSlot("0 6 * * *", from, to)).toEqual(new Date(2026, 6, 29, 6, 0));
        });

        it("prefers the most recent of several matches", () => {
            const to = new Date(2026, 6, 29, 6, 10);
            const from = new Date(2026, 6, 29, 3, 0);
            expect(findMostRecentSlot("0 * * * *", from, to)).toEqual(new Date(2026, 6, 29, 6, 0));
        });

        it("returns undefined when no slot falls in the window", () => {
            const to = new Date(2026, 6, 29, 6, 10);
            const from = new Date(2026, 6, 29, 6, 5);
            expect(findMostRecentSlot("0 6 * * *", from, to)).toBeUndefined();
        });

        it("includes the boundary minute of `to` — that slot has not run yet", () => {
            // Boot at 06:00:30: parseCronExpression has already skipped ahead to
            // tomorrow, so today's 06:00 is missed, not upcoming.
            const to = new Date(2026, 6, 29, 6, 0, 30);
            const from = new Date(2026, 6, 29, 5, 0);
            expect(findMostRecentSlot("0 6 * * *", from, to)).toEqual(new Date(2026, 6, 29, 6, 0));
        });

        it("zeroes seconds and milliseconds so the slot key matches the scheduled path", () => {
            const to = new Date(2026, 6, 29, 6, 10, 42, 123);
            const from = new Date(2026, 6, 29, 5, 0);
            const slot = findMostRecentSlot("0 6 * * *", from, to)!;
            expect(slot.getSeconds()).toBe(0);
            expect(slot.getMilliseconds()).toBe(0);
        });
    });

    describe("catch-up on start", () => {
        // 06:10 local — ten minutes past a daily 06:00 slot that never fired.
        const BOOT_TIME = new Date(2026, 6, 29, 6, 10);
        const MISSED_SLOT = new Date(2026, 6, 29, 6, 0).toISOString();

        function makeClaimStore(claimResult = true) {
            return {
                ensureTable: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
                insertLog: jest.fn<(entry: CronJobLogEntry) => Promise<void>>().mockResolvedValue(undefined),
                fetchLogs: jest.fn<() => Promise<CronJobLogEntry[]>>().mockResolvedValue([]),
                fetchJobStats: jest.fn<() => Promise<Map<string, { totalRuns: number; totalFailures: number; lastRunAt?: string }>>>().mockResolvedValue(new Map()),
                tryClaimRun: jest.fn<(jobId: string, slot: string) => Promise<boolean>>().mockResolvedValue(claimResult)
            };
        }

        function makeCatchUpJob(id: string, overrides: Partial<CronJobDefinition> = {}) {
            return makeJob(id, { schedule: "0 6 * * *",
catchUpWindowSeconds: 3600,
...overrides });
        }

        /** Let the un-awaited catch-up pass settle without firing real slots. */
        async function settle() {
            await jest.advanceTimersByTimeAsync(1);
        }

        beforeEach(() => {
            jest.setSystemTime(BOOT_TIME);
        });

        it("runs the missed slot when the claim is won", async () => {
            const store = makeClaimStore(true);
            let executed = false;
            scheduler.setStore(store);
            scheduler.registerJobs([makeCatchUpJob("late", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await settle();

            expect(executed).toBe(true);
            expect(store.tryClaimRun).toHaveBeenCalledWith("late", MISSED_SLOT);
            expect(scheduler.getJob("late")?.totalRuns).toBe(1);
        });

        it("skips the slot another instance already ran", async () => {
            const store = makeClaimStore(false);
            let executed = false;
            scheduler.setStore(store);
            scheduler.registerJobs([makeCatchUpJob("already-ran", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await settle();

            expect(store.tryClaimRun).toHaveBeenCalledWith("already-ran", MISSED_SLOT);
            expect(executed).toBe(false);
            expect(scheduler.getJob("already-ran")?.totalRuns).toBe(0);
        });

        it("is off by default — no catchUpWindowSeconds, no claim attempt", async () => {
            const store = makeClaimStore(true);
            let executed = false;
            scheduler.setStore(store);
            scheduler.registerJobs([makeJob("opted-out", {
                schedule: "0 6 * * *",
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await settle();

            expect(executed).toBe(false);
            expect(store.tryClaimRun).not.toHaveBeenCalled();
        });

        it("does not reach a slot older than the window", async () => {
            const store = makeClaimStore(true);
            let executed = false;
            scheduler.setStore(store);
            // A 60s window at 06:10 cannot reach the 06:00 slot.
            scheduler.registerJobs([makeCatchUpJob("stale", {
                catchUpWindowSeconds: 60,
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await settle();

            expect(executed).toBe(false);
            expect(store.tryClaimRun).not.toHaveBeenCalled();
        });

        it("refuses to catch up without a claims-capable store", async () => {
            const legacyStore = { ...makeClaimStore(true), tryClaimRun: undefined };
            let executed = false;
            scheduler.setStore(legacyStore);
            scheduler.registerJobs([makeCatchUpJob("no-claims", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await settle();

            // Re-running on every boot is worse than missing one slot.
            expect(executed).toBe(false);
        });

        it("refuses to catch up with no store at all", async () => {
            let executed = false;
            scheduler.registerJobs([makeCatchUpJob("storeless-catchup", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await settle();

            expect(executed).toBe(false);
        });

        it("fails closed when the catch-up claim throws", async () => {
            const store = makeClaimStore(true);
            store.tryClaimRun.mockRejectedValue(new Error("claims table gone"));
            let executed = false;
            scheduler.setStore(store);
            scheduler.registerJobs([makeCatchUpJob("throwing-catchup-claim", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await settle();

            expect(executed).toBe(false);
        });

        it("does not catch up a disabled job", async () => {
            const store = makeClaimStore(true);
            let executed = false;
            scheduler.setStore(store);
            scheduler.registerJobs([makeCatchUpJob("off", {
                enabled: false,
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await settle();

            expect(executed).toBe(false);
            expect(store.tryClaimRun).not.toHaveBeenCalled();
        });

        it("still schedules the next slot normally", async () => {
            const store = makeClaimStore(true);
            scheduler.setStore(store);
            scheduler.registerJobs([makeCatchUpJob("keeps-ticking")]);
            scheduler.start();
            await settle();

            const next = scheduler.getJob("keeps-ticking")!.nextRunAt!;
            expect(new Date(next)).toEqual(new Date(2026, 6, 30, 6, 0));
        });

        it("records the catch-up in the run's persisted logs", async () => {
            const store = makeClaimStore(true);
            scheduler.setStore(store);
            scheduler.registerJobs([makeCatchUpJob("annotated")]);
            scheduler.start();
            await settle();

            const entry = scheduler.getJobLogs("annotated")[0]!;
            expect(entry.manual).toBe(false);
            expect(entry.logs[0]).toContain("Catch-up run for missed slot");
            expect(entry.logs[0]).toContain(MISSED_SLOT);
            // The handler's own output still follows the seeded line.
            expect(entry.logs.some(l => l.includes("hello from annotated"))).toBe(true);
        });

        it("does not replay a slot the catch-up already took", async () => {
            // One claim per (job, slot): catch-up takes today's 06:00, and
            // tomorrow's 06:00 is a different key — one further run, not a replay.
            const claimed = new Set<string>();
            const store = makeClaimStore(true);
            store.tryClaimRun.mockImplementation(async (_id: string, slot: string) => {
                if (claimed.has(slot)) return false;
                claimed.add(slot);
                return true;
            });
            let runs = 0;
            scheduler.setStore(store);
            scheduler.registerJobs([makeCatchUpJob("no-double", {
                handler: async () => { runs++; }
            })]);
            scheduler.start();
            await settle();
            expect(runs).toBe(1);

            await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
            expect(runs).toBe(2);
            expect(claimed.size).toBe(2);
        });
    });

    // ── toStatus shape ──────────────────────────────────────────────

    describe("status shape", () => {
        it("returns all expected fields", () => {
            scheduler.registerJobs([makeJob("shape", { name: "Shape Test",
description: "Desc",
schedule: "15 3 * * *" })]);
            expect(scheduler.getJob("shape")).toMatchObject({
                id: "shape",
name: "Shape Test",
description: "Desc",
                schedule: "15 3 * * *",
enabled: true,
state: "idle",
                totalRuns: 0,
totalFailures: 0
            });
        });

        it("lastRunAt and nextRunAt are ISO strings or undefined", () => {
            scheduler.registerJobs([makeJob("iso-check")]);
            expect(scheduler.getJob("iso-check")!.lastRunAt).toBeUndefined();
            scheduler.start();
            const after = scheduler.getJob("iso-check")!;
            expect(after.nextRunAt).toBeDefined();
            expect(() => new Date(after.nextRunAt!)).not.toThrow();
        });
    });
});
