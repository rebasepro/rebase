import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { CronScheduler, validateCronExpression } from "./cron-scheduler";
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
