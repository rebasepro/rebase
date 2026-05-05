import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { CronScheduler } from "./cron-scheduler";
import type { CronJobDefinition } from "@rebasepro/types";
import type { LoadedCronJob } from "./cron-loader";

// ─── Helpers ────────────────────────────────────────────────────────

function makeJob(
    id: string,
    overrides: Partial<CronJobDefinition> = {}
): LoadedCronJob {
    return {
        id,
        definition: {
            schedule: "0 * * * *", // every hour
            name: `Job ${id}`,
            description: `Description for ${id}`,
            enabled: true,
            timeoutSeconds: 5,
            handler: async (ctx) => {
                ctx.log("hello from", id);
                return { ok: true };
            },
            ...overrides
        }
    };
}

function makeFailingJob(id: string, errorMsg = "boom"): LoadedCronJob {
    return makeJob(id, {
        handler: async () => {
            throw new Error(errorMsg);
        }
    });
}

function makeSlowJob(id: string, delayMs: number): LoadedCronJob {
    return makeJob(id, {
        timeoutSeconds: 1, // 1s timeout
        handler: () =>
            new Promise((resolve) => setTimeout(() => resolve({ done: true }), delayMs))
    });
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

    // ── Registration ────────────────────────────────────────────────

    describe("registerJobs", () => {
        it("registers jobs and they appear in listJobs", () => {
            scheduler.registerJobs([makeJob("alpha"), makeJob("beta")]);

            const jobs = scheduler.listJobs();
            expect(jobs).toHaveLength(2);
            expect(jobs.map((j) => j.id).sort()).toEqual(["alpha", "beta"]);
        });

        it("sets initial state to idle for enabled jobs", () => {
            scheduler.registerJobs([makeJob("enabled-job")]);
            const job = scheduler.getJob("enabled-job");
            expect(job?.state).toBe("idle");
            expect(job?.enabled).toBe(true);
        });

        it("sets initial state to disabled for disabled jobs", () => {
            scheduler.registerJobs([makeJob("disabled-job", { enabled: false })]);
            const job = scheduler.getJob("disabled-job");
            expect(job?.state).toBe("disabled");
            expect(job?.enabled).toBe(false);
        });

        it("initializes counters to zero", () => {
            scheduler.registerJobs([makeJob("fresh")]);
            const job = scheduler.getJob("fresh");
            expect(job?.totalRuns).toBe(0);
            expect(job?.totalFailures).toBe(0);
        });

        it("overwrites duplicate job IDs", () => {
            scheduler.registerJobs([makeJob("dup", { name: "First" })]);
            scheduler.registerJobs([makeJob("dup", { name: "Second" })]);

            const jobs = scheduler.listJobs();
            expect(jobs).toHaveLength(1);
            expect(jobs[0].name).toBe("Second");
        });

        it("preserves definition metadata", () => {
            scheduler.registerJobs([
                makeJob("meta", {
                    name: "My Job",
                    description: "Does stuff",
                    schedule: "30 2 * * 1"
                })
            ]);

            const job = scheduler.getJob("meta");
            expect(job?.name).toBe("My Job");
            expect(job?.description).toBe("Does stuff");
            expect(job?.schedule).toBe("30 2 * * 1");
        });
    });

    // ── getJob ───────────────────────────────────────────────────────

    describe("getJob", () => {
        it("returns undefined for nonexistent ID", () => {
            expect(scheduler.getJob("nope")).toBeUndefined();
        });

        it("returns the correct job by ID", () => {
            scheduler.registerJobs([makeJob("a"), makeJob("b")]);
            const job = scheduler.getJob("b");
            expect(job?.id).toBe("b");
        });
    });

    // ── triggerJob (manual execution) ───────────────────────────────

    describe("triggerJob", () => {
        beforeEach(() => {
            jest.useRealTimers(); // triggerJob uses real async
        });

        it("returns undefined for nonexistent job", async () => {
            const result = await scheduler.triggerJob("ghost");
            expect(result).toBeUndefined();
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

            const status = scheduler.getJob("fail-me");
            expect(status?.totalFailures).toBe(1);
            expect(status?.state).toBe("error");
            expect(status?.lastError).toBe("something broke");
        });

        it("captures ctx.log output", async () => {
            scheduler.registerJobs([
                makeJob("logger", {
                    handler: async (ctx) => {
                        ctx.log("line 1");
                        ctx.log("line 2", { nested: true });
                        ctx.log(42);
                    }
                })
            ]);

            const log = await scheduler.triggerJob("logger");
            expect(log!.logs).toEqual([
                "line 1",
                'line 2 {"nested":true}',
                "42"
            ]);
        });

        it("sets lastRunAt after execution", async () => {
            scheduler.registerJobs([makeJob("timed")]);

            const before = new Date();
            await scheduler.triggerJob("timed");
            const after = new Date();

            const job = scheduler.getJob("timed");
            expect(job?.lastRunAt).toBeDefined();
            const lastRun = new Date(job!.lastRunAt!);
            expect(lastRun.getTime()).toBeGreaterThanOrEqual(before.getTime());
            expect(lastRun.getTime()).toBeLessThanOrEqual(after.getTime());
        });

        it("sets lastDurationMs after execution", async () => {
            scheduler.registerJobs([makeJob("duration-check")]);
            await scheduler.triggerJob("duration-check");

            const job = scheduler.getJob("duration-check");
            expect(job?.lastDurationMs).toBeDefined();
            expect(job!.lastDurationMs!).toBeGreaterThanOrEqual(0);
        });

        it("handles handler that returns undefined (void)", async () => {
            scheduler.registerJobs([
                makeJob("void-handler", {
                    handler: async () => {
                        // returns void
                    }
                })
            ]);

            const log = await scheduler.triggerJob("void-handler");
            expect(log!.success).toBe(true);
            expect(log!.result).toBeUndefined();
        });

        it("handles synchronous handler", async () => {
            scheduler.registerJobs([
                makeJob("sync-handler", {
                    handler: (ctx) => {
                        ctx.log("sync");
                        return { sync: true };
                    }
                })
            ]);

            const log = await scheduler.triggerJob("sync-handler");
            expect(log!.success).toBe(true);
            expect(log!.result).toEqual({ sync: true });
        });
    });

    // ── Timeout ─────────────────────────────────────────────────────

    describe("timeout", () => {
        it("times out a slow handler", async () => {
            jest.useRealTimers();
            scheduler.registerJobs([
                makeJob("slow", {
                    timeoutSeconds: 1,
                    handler: () =>
                        new Promise((resolve) =>
                            setTimeout(() => resolve("late"), 3000)
                        )
                })
            ]);

            const log = await scheduler.triggerJob("slow");
            expect(log!.success).toBe(false);
            expect(log!.error).toContain("timed out");
        }, 10000);
    });

    // ── Logs ring buffer ────────────────────────────────────────────

    describe("getJobLogs", () => {
        beforeEach(() => {
            jest.useRealTimers();
        });

        it("returns empty array for nonexistent job", () => {
            expect(scheduler.getJobLogs("nope")).toEqual([]);
        });

        it("returns logs in reverse order (newest first)", async () => {
            scheduler.registerJobs([
                makeJob("ordered", {
                    handler: async (ctx) => {
                        return { run: ctx.jobId };
                    }
                })
            ]);

            await scheduler.triggerJob("ordered");
            await scheduler.triggerJob("ordered");
            await scheduler.triggerJob("ordered");

            const logs = scheduler.getJobLogs("ordered");
            expect(logs).toHaveLength(3);
            // newest first means the last entry's startedAt >= first entry's startedAt
            const t0 = new Date(logs[0].startedAt).getTime();
            const t2 = new Date(logs[2].startedAt).getTime();
            expect(t0).toBeGreaterThanOrEqual(t2);
        });

        it("respects limit parameter", async () => {
            scheduler.registerJobs([makeJob("limited")]);

            for (let i = 0; i < 5; i++) {
                await scheduler.triggerJob("limited");
            }

            expect(scheduler.getJobLogs("limited", 2)).toHaveLength(2);
            expect(scheduler.getJobLogs("limited", 10)).toHaveLength(5);
            expect(scheduler.getJobLogs("limited")).toHaveLength(5);
        });

        it("caps at 50 entries (ring buffer)", async () => {
            scheduler.registerJobs([makeJob("ring")]);

            for (let i = 0; i < 60; i++) {
                await scheduler.triggerJob("ring");
            }

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
    });

    // ── start / stop ────────────────────────────────────────────────

    describe("start / stop", () => {
        it("start is idempotent", () => {
            scheduler.registerJobs([makeJob("idem")]);
            scheduler.start();
            scheduler.start(); // should not throw
            expect(scheduler.listJobs()).toHaveLength(1);
        });

        it("stop clears nextRunAt", () => {
            scheduler.registerJobs([makeJob("stoppable")]);
            scheduler.start();

            // After start, nextRunAt should be set
            expect(scheduler.getJob("stoppable")?.nextRunAt).toBeDefined();

            scheduler.stop();
            expect(scheduler.getJob("stoppable")?.nextRunAt).toBeUndefined();
        });

        it("does not schedule disabled jobs on start", () => {
            scheduler.registerJobs([makeJob("off", { enabled: false })]);
            scheduler.start();

            expect(scheduler.getJob("off")?.nextRunAt).toBeUndefined();
        });
    });

    // ── toStatus shape ──────────────────────────────────────────────

    describe("status shape", () => {
        it("returns all expected fields", () => {
            scheduler.registerJobs([
                makeJob("shape", {
                    name: "Shape Test",
                    description: "Desc",
                    schedule: "15 3 * * *"
                })
            ]);

            const job = scheduler.getJob("shape")!;
            expect(job).toMatchObject({
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
            const before = scheduler.getJob("iso-check")!;
            expect(before.lastRunAt).toBeUndefined();

            scheduler.start();
            const after = scheduler.getJob("iso-check")!;
            // nextRunAt should be set as an ISO string after start
            expect(after.nextRunAt).toBeDefined();
            expect(() => new Date(after.nextRunAt!)).not.toThrow();
        });
    });
});
