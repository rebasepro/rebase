import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { CronScheduler, validateCronExpression, findMostRecentSlot } from "./cron-scheduler";
import { createCronStore } from "./cron-store";
import type { CronJobPersistedState, CronJobRunSummary, CronRunLease, CronStore } from "./cron-store";
import type { CronJobDefinition, CronJobLogEntry, DataDriver } from "@rebasepro/types";
import type { LoadedCronJob } from "./cron-loader";
import { logger } from "../utils/logger";

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

/**
 * One database's worth of cron state, in memory, for several schedulers to
 * share the way replicas share Postgres: claims, the enabled overrides, the
 * run leases and the log rows. Lease expiry reads `Date.now()`, so it follows
 * jest's fake clock like everything else here.
 */
function makeFleetStore() {
    const overrides = new Map<string, boolean | null>();
    const leases = new Map<string, { holder: string; until: number }>();
    const claims = new Set<string>();
    const logs: CronJobLogEntry[] = [];
    const liveLease = (jobId: string) => {
        const lease = leases.get(jobId);
        return lease && lease.until > Date.now() ? lease : undefined;
    };
    const store = {
        ensureTable: async () => {},
        insertLog: async (entry: CronJobLogEntry) => { logs.push(entry); },
        fetchLogs: async () => [],
        fetchJobStats: async () => new Map<string, { totalRuns: number; totalFailures: number; lastRunAt?: string }>(),
        tryClaimRun: jest.fn(async (jobId: string, slot: string) => {
            const key = `${jobId}@${slot}`;
            if (claims.has(key)) return false;
            claims.add(key);
            return true;
        }),
        saveEnabledOverride: jest.fn(async (jobId: string, enabled: boolean | null, _updatedBy?: string) => {
            overrides.set(jobId, enabled);
        }),
        fetchJobStates: jest.fn(async (jobIds: readonly string[]) => {
            const states = new Map<string, CronJobPersistedState>();
            for (const id of jobIds) {
                if (overrides.has(id) || liveLease(id)) {
                    states.set(id, { enabled: overrides.get(id) ?? null, runningBy: liveLease(id)?.holder });
                }
            }
            return states;
        }),
        tryAcquireRunLease: jest.fn(async (jobId: string, holder: string, ttlSeconds: number): Promise<CronRunLease> => {
            const live = liveLease(jobId);
            if (live) return { acquired: false, holder: live.holder };
            leases.set(jobId, { holder, until: Date.now() + ttlSeconds * 1000 });
            return { acquired: true };
        }),
        releaseRunLease: jest.fn(async (jobId: string, holder: string) => {
            if (leases.get(jobId)?.holder === holder) leases.delete(jobId);
        }),
        fetchRunSummaries: jest.fn(async (_jobIds: readonly string[]) => new Map<string, CronJobRunSummary>())
    } satisfies Required<CronStore>;
    return { store, overrides, leases, claims, logs };
}

/** Wait until `check` holds, on real timers — for a run on another scheduler to get going. */
async function until(check: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !check(); i++) await new Promise(r => setTimeout(r, 5));
    if (!check()) throw new Error("condition never held");
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
            expect(log!.error).toBe("Failed query: [redacted — set REBASE_LOG_RAW_QUERIES=true in development to see it]");
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

    // ── Rejected schedules ──────────────────────────────────────────

    /**
     * A job the scheduler refused is absent from `listJobs()`, so from the admin
     * panel it is indistinguishable from a file nobody wrote. The commonest way
     * to land here is a six-field expression copied out of a tool that supports
     * seconds — a one-character fix that was previously visible only to whoever
     * had the boot log.
     */
    describe("rejected schedules", () => {
        it("keeps a six-field schedule with its reason instead of dropping it", () => {
            scheduler.registerJobs([makeJob("nightly-report", { schedule: "0 0 3 * * *" })]);

            expect(scheduler.listJobs()).toHaveLength(0);
            expect(scheduler.listRejectedJobs()).toEqual([{
                id: "nightly-report",
                name: "Job nightly-report",
                schedule: "0 0 3 * * *",
                reason: "Expected 5 fields, got 6"
            }]);
        });

        it("says nothing about a schedule it accepted", () => {
            scheduler.registerJobs([makeJob("fine")]);

            expect(scheduler.listRejectedJobs()).toEqual([]);
        });

        it("clears the complaint when the job is re-registered with a valid schedule", () => {
            // `rebase dev` re-registers on every reload. A fixed schedule must
            // stop being reported, or the panel accuses you of a bug you fixed.
            scheduler.registerJobs([makeJob("nightly-report", { schedule: "0 0 3 * * *" })]);
            scheduler.registerJobs([makeJob("nightly-report", { schedule: "0 3 * * *" })]);

            expect(scheduler.listRejectedJobs()).toEqual([]);
            expect(scheduler.listJobs().map(j => j.id)).toEqual(["nightly-report"]);
        });
    });

    // ── Concurrency guard ───────────────────────────────────────────

    describe("concurrency guard", () => {
        beforeEach(() => { jest.useRealTimers(); });

        it("persists the skip, so an overlap is in the run history and not only the log", async () => {
            // A run of these in a row is the signature of a job that has
            // outgrown its schedule. That pattern is only visible if the skips
            // are stored — a warning in the process log is gone by the time
            // anyone asks.
            const inserted: CronJobLogEntry[] = [];
            scheduler.setStore({
                ensureTable: async () => {},
                insertLog: async (entry: CronJobLogEntry) => { inserted.push(entry); },
                fetchLogs: async () => [],
                fetchJobStats: async () => new Map()
            } as never);

            let resolve: () => void;
            const blocker = new Promise<void>((r) => { resolve = r; });
            scheduler.registerJobs([makeJob("slow-store", {
                handler: async () => { await blocker; return { done: true }; }
            })]);

            const first = scheduler.triggerJob("slow-store");
            await scheduler.triggerJob("slow-store");

            const skip = inserted.find(entry => (entry.result as { skipped?: boolean })?.skipped);
            expect(skip).toBeDefined();
            expect(skip!.jobId).toBe("slow-store");
            expect(skip!.success).toBe(true);
            expect(skip!.result).toEqual({ skipped: true, reason: "already_executing" });

            resolve!();
            await first;
        });

        it("holds a shutdown until a skip's log row is written", async () => {
            // A skip is a row in the history like any run, and a shutdown that
            // closes the pool under its write loses it.
            let settleWrite!: () => void;
            let written = false;
            scheduler.setStore({
                ensureTable: async () => {},
                insertLog: (entry: CronJobLogEntry) => (entry.result as { skipped?: boolean })?.skipped
                    ? new Promise<void>(r => { settleWrite = () => { written = true; r(); }; })
                    : Promise.resolve(),
                fetchLogs: async () => [],
                fetchJobStats: async () => new Map()
            });
            let release!: () => void;
            const blocker = new Promise<void>((r) => { release = r; });
            scheduler.registerJobs([makeJob("slow-write", { handler: async () => { await blocker; } })]);

            const first = scheduler.triggerJob("slow-write");
            await scheduler.triggerJob("slow-write");
            release();
            await first;

            let stopped = false;
            const stopping = scheduler.stop().then(() => { stopped = true; });
            await new Promise(r => setTimeout(r, 20));
            expect(stopped).toBe(false);

            settleWrite();
            await stopping;
            expect(written).toBe(true);
        });

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
            expect(second!.logs).toContain("Skipped: the previous run has not finished");

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

        it("aborts ctx.signal, so the handler's work stops with the run", async () => {
            // The timeout stops the scheduler *waiting*. Without the abort it
            // never stopped the handler: a `fetch` to an unresponsive host kept
            // its socket, and a job whose timeout matches its interval leaked
            // one abandoned request per tick — invisible, because the run was
            // already recorded as failed.
            jest.useRealTimers();
            let aborted = false;
            scheduler.registerJobs([makeJob("hangs", {
                timeoutSeconds: 1,
                handler: ({ signal }) => new Promise((resolve) => {
                    signal.addEventListener("abort", () => { aborted = true; });
                    setTimeout(() => resolve("late"), 3000);
                })
            })]);

            await scheduler.triggerJob("hangs");

            expect(aborted).toBe(true);
        }, 10000);

        it("holds a timeout longer than the 32-bit timer ceiling", async () => {
            // setTimeout clamps anything past ~24.8 days to 1ms, so a 30-day
            // timeout failed every run a millisecond after it started.
            const DAY = 86_400_000;
            let settle: (value: string) => void = () => undefined;
            scheduler.registerJobs([makeJob("month-long", {
                timeoutSeconds: 30 * 86_400,
                handler: () => new Promise<string>((resolve) => { settle = resolve; })
            })]);

            let log: CronJobLogEntry | undefined;
            const run = scheduler.triggerJob("month-long").then((entry) => { log = entry; });
            await jest.advanceTimersByTimeAsync(29 * DAY);
            expect(log).toBeUndefined();
            expect(scheduler.getJob("month-long")?.state).toBe("running");

            await jest.advanceTimersByTimeAsync(DAY + 1_000);
            await run;
            expect(log!.success).toBe(false);
            expect(log!.error).toContain("timed out after 2592000000ms");
            settle("late");
        });

        it("finishes a run inside a timeout longer than the timer ceiling", async () => {
            jest.useRealTimers();
            scheduler.registerJobs([makeJob("month-long-quick", {
                timeoutSeconds: 30 * 86_400,
                handler: () => new Promise((resolve) => setTimeout(() => resolve("done"), 20))
            })]);
            const log = await scheduler.triggerJob("month-long-quick");
            expect(log!.success).toBe(true);
            expect(log!.result).toBe("done");
        });

        it("reads a timeout of Infinity as no timeout", async () => {
            jest.useRealTimers();
            scheduler.registerJobs([makeJob("unbounded", {
                timeoutSeconds: Infinity,
                handler: () => new Promise((resolve) => setTimeout(() => resolve("done"), 20))
            })]);
            const log = await scheduler.triggerJob("unbounded");
            expect(log!.success).toBe(true);
        });

        it.each([0, -5, Number.NaN])("refuses a job whose timeout is %p, rather than failing every run", (timeoutSeconds) => {
            scheduler.registerJobs([makeJob("bad-timeout", { timeoutSeconds })]);
            expect(scheduler.getJob("bad-timeout")).toBeUndefined();
            expect(scheduler.listRejectedJobs()).toEqual([
                expect.objectContaining({ id: "bad-timeout", reason: expect.stringContaining("timeoutSeconds") })
            ]);
        });

        it("leaves ctx.signal unaborted for a run that finished", async () => {
            jest.useRealTimers();
            let seen: AbortSignal | undefined;
            scheduler.registerJobs([makeJob("quick", {
                timeoutSeconds: 60,
                handler: async ({ signal }) => { seen = signal; return "ok"; }
            })]);

            await scheduler.triggerJob("quick");

            expect(seen!.aborted).toBe(false);
        });
    });

    // ── Stopping with a run in flight ───────────────────────────────

    describe("stop with a run in flight", () => {
        // A deploy's SIGTERM used to find `stop()` clearing timers and
        // returning at once: the backend went on to close the pool under a
        // running handler, whose signal was never aborted and whose run was
        // never recorded.
        beforeEach(() => { jest.useRealTimers(); });

        function recordingStore() {
            return {
                ensureTable: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
                insertLog: jest.fn<(entry: CronJobLogEntry) => Promise<void>>().mockResolvedValue(undefined),
                fetchLogs: jest.fn<() => Promise<CronJobLogEntry[]>>().mockResolvedValue([]),
                fetchJobStats: jest.fn<() => Promise<Map<string, { totalRuns: number; totalFailures: number; lastRunAt?: string }>>>().mockResolvedValue(new Map())
            };
        }

        it("waits for a run that finishes inside the budget, and its log", async () => {
            const store = recordingStore();
            let finished = false;
            scheduler.setStore(store);
            scheduler.registerJobs([makeJob("nightly", {
                handler: async () => {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    finished = true;
                }
            })]);

            const run = scheduler.triggerJob("nightly");
            await scheduler.stop(2_000);

            expect(finished).toBe(true);
            expect(store.insertLog).toHaveBeenCalledTimes(1);
            expect(store.insertLog.mock.calls[0]![0].success).toBe(true);
            await run;
        });

        it("aborts a run that outlasts the budget, and records why it ended", async () => {
            const store = recordingStore();
            let signal: AbortSignal | undefined;
            scheduler.setStore(store);
            scheduler.registerJobs([makeJob("stuck", {
                timeoutSeconds: 300,
                // Ignores its signal, as plenty of handlers will.
                handler: (ctx) => { signal = ctx.signal; return new Promise(() => { /* never settles */ }); }
            })]);

            const run = scheduler.triggerJob("stuck");
            const started = Date.now();
            await scheduler.stop(50);

            expect(Date.now() - started).toBeLessThan(1_000);
            expect(signal?.aborted).toBe(true);
            // The run ends with the abort even though the handler never
            // settles, so it is recorded rather than left "running".
            const log = await run;
            expect(log!.success).toBe(false);
            expect(log!.error).toMatch(/shutting down/i);
            expect(scheduler.getJob("stuck")?.state).toBe("error");
            expect(store.insertLog).toHaveBeenCalledTimes(1);
        });

        it("returns at once with nothing running", async () => {
            scheduler.registerJobs([makeJob("idle")]);
            scheduler.start();
            const started = Date.now();
            await scheduler.stop(5_000);
            expect(Date.now() - started).toBeLessThan(100);
            expect(scheduler.getJob("idle")?.nextRunAt).toBeUndefined();
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

        it("fails open with the real store when the claims table is unreadable", async () => {
            // The scheduled run is an obligation, not a recovery: a store that
            // cannot answer must not silently stop every job.
            const store = createCronStore({
                admin: {
                    executeSql: async (sql: string) => {
                        if (sql.includes("cron_claims")) throw new Error("connection terminated unexpectedly");
                        return [];
                    }
                }
            } as unknown as DataDriver)!;
            let executed = false;
            scheduler.setStore(store);
            scheduler.registerJobs([makeJob("scheduled-despite-store", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            expect(executed).toBe(true);
        });

        it("does not start a slot beside a manual run that began while the slot was being claimed", async () => {
            // The fire checks the in-process flag, then awaits its claim; a
            // manual trigger can start in that window. The run itself has to
            // check again, or both reach the handler.
            let settleClaim!: (won: boolean) => void;
            const store = makeMockStore(true);
            store.tryClaimRun.mockImplementation(() => new Promise<boolean>(r => { settleClaim = r; }));
            let release!: () => void;
            const gate = new Promise<void>(r => { release = r; });
            let running = 0;
            let mostAtOnce = 0;
            scheduler.setStore(store);
            scheduler.registerJobs([makeJob("racy", {
                timeoutSeconds: 7200,
                handler: async () => {
                    running++;
                    mostAtOnce = Math.max(mostAtOnce, running);
                    await gate;
                    running--;
                }
            })]);
            scheduler.start();

            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            expect(store.tryClaimRun).toHaveBeenCalledTimes(1);
            const manual = scheduler.triggerJob("racy");
            await jest.advanceTimersByTimeAsync(0);
            settleClaim(true);
            await jest.advanceTimersByTimeAsync(0);

            expect(mostAtOnce).toBe(1);
            const skip = scheduler.getJobLogs("racy").find(e => !e.manual);
            expect(skip?.result).toEqual({ skipped: true, reason: "already_executing" });

            release();
            await manual;
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

        it("fails closed with the real store when the claims table is unreadable", async () => {
            // The mock above throws; the store that ships used to answer `true`
            // on every error but a unique violation, so with a missing or
            // unreadable `cron_claims` every boot of every replica re-ran the
            // last slot.
            const claimAttempts: string[] = [];
            const store = createCronStore({
                admin: {
                    executeSql: async (sql: string) => {
                        if (sql.includes("cron_claims")) {
                            claimAttempts.push(sql);
                            throw new Error("Failed query", {
                                cause: Object.assign(new Error('relation "rebase.cron_claims" does not exist'), { code: "42P01" })
                            });
                        }
                        return [];
                    }
                }
            } as unknown as DataDriver)!;
            let runs = 0;
            scheduler.setStore(store);
            scheduler.registerJobs([makeCatchUpJob("claims-table-gone", {
                handler: async () => { runs++; }
            })]);
            scheduler.start();
            await settle();

            // It asked, and on not getting an answer, did nothing.
            expect(claimAttempts).toHaveLength(1);
            expect(runs).toBe(0);
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

        it("does not catch up a job paused in the store", async () => {
            // A pause outlives the deploy; the deploy's own catch-up must not
            // run the job the pause is holding off.
            const fleet = makeFleetStore();
            fleet.overrides.set("paused-late", false);
            let executed = false;
            scheduler.setStore(fleet.store);
            scheduler.registerJobs([makeCatchUpJob("paused-late", {
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await settle();

            expect(executed).toBe(false);
            expect(fleet.store.tryClaimRun).not.toHaveBeenCalled();
        });

        it("catches up a job the code disables once an override enables it", async () => {
            const fleet = makeFleetStore();
            fleet.overrides.set("resumed-late", true);
            let executed = false;
            scheduler.setStore(fleet.store);
            scheduler.registerJobs([makeCatchUpJob("resumed-late", {
                enabled: false,
                handler: async () => { executed = true; }
            })]);
            scheduler.start();
            await settle();

            expect(executed).toBe(true);
            expect(fleet.store.tryClaimRun).toHaveBeenCalledWith("resumed-late", MISSED_SLOT);
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

    // ── The enabled state every replica reads ───────────────────────
    //
    // A pause used to live in the memory of the process that served it: every
    // other replica kept running the job, and on a split deployment — where
    // the api role serves the admin surface and never starts its scheduler —
    // it stopped nothing at all.

    describe("persisted enabled state", () => {
        let other: CronScheduler;

        beforeEach(() => { other = new CronScheduler(); });
        afterEach(() => {
            other.stop();
            jest.restoreAllMocks();
        });

        /** Two schedulers over one fleet store, each running `job`. */
        function twoReplicas(job: (runs: string[], name: string) => LoadedCronJob) {
            const fleet = makeFleetStore();
            const runs: string[] = [];
            scheduler.setStore(fleet.store);
            other.setStore(fleet.store);
            scheduler.registerJobs([job(runs, "a")]);
            other.registerJobs([job(runs, "b")]);
            scheduler.start();
            other.start();
            return { fleet, runs };
        }

        const hourly = (overrides: Partial<CronJobDefinition> = {}) => (runs: string[], name: string) =>
            makeJob("report", { handler: () => { runs.push(name); }, ...overrides });

        it("does not run the next slot on a replica after another one paused the job", async () => {
            const { fleet, runs } = twoReplicas(hourly());

            await scheduler.persistJobEnabled("report", false);
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);

            expect(runs).toEqual([]);
            expect(fleet.overrides.get("report")).toBe(false);
            // Read before the claim: a paused job does not spend its slot.
            expect(fleet.store.tryClaimRun).not.toHaveBeenCalled();
        });

        it("runs the next slot once, somewhere, after another replica resumed the job", async () => {
            const { runs } = twoReplicas(hourly());

            await scheduler.persistJobEnabled("report", false);
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            await other.persistJobEnabled("report", true);
            await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

            expect(runs).toHaveLength(1);
        });

        it("runs a job the code disables once an override enables it, and not after a reset", async () => {
            const { runs } = twoReplicas(hourly({ enabled: false }));

            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            expect(runs).toEqual([]);

            await scheduler.persistJobEnabled("report", true);
            await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
            expect(runs).toHaveLength(1);

            // `null` hands the decision back to the code.
            await other.persistJobEnabled("report", null);
            expect(other.getJob("report")?.enabled).toBe(false);
            await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
            expect(runs).toHaveLength(1);
        });

        it("falls back to the code's enabled when the state cannot be read, and says so", async () => {
            // Scheduled runs fail open, as they do on a claims table that
            // cannot answer: a broken state table must not stop every job.
            const warnings: string[] = [];
            jest.spyOn(logger, "warn").mockImplementation((message: string) => { warnings.push(message); });
            const { fleet, runs } = twoReplicas(hourly());
            await scheduler.persistJobEnabled("report", false);
            fleet.store.fetchJobStates.mockRejectedValue(new Error("connection terminated unexpectedly"));

            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);

            expect(runs).toHaveLength(1);
            expect(warnings.some(m => /enabled state .*falling back to the code/i.test(m))).toBe(true);
        });

        it("falls back to a code-disabled job staying off", async () => {
            const { fleet, runs } = twoReplicas(hourly({ enabled: false }));
            await scheduler.persistJobEnabled("report", true);
            fleet.store.fetchJobStates.mockRejectedValue(new Error("connection terminated unexpectedly"));
            jest.spyOn(logger, "warn").mockImplementation(() => { /* silence */ });

            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);

            expect(runs).toEqual([]);
        });

        it("changes nothing when the pause cannot be saved", async () => {
            // Answering a pause that no replica but this one will honour is the
            // bug this table exists to fix.
            const { fleet } = twoReplicas(hourly());
            fleet.store.saveEnabledOverride.mockRejectedValue(new Error("permission denied"));

            await expect(scheduler.persistJobEnabled("report", false)).rejects.toThrow("permission denied");

            expect(scheduler.getJob("report")?.enabled).toBe(true);
            expect(scheduler.getJob("report")?.nextRunAt).toBeDefined();
        });

        it("records who changed it", async () => {
            const { fleet } = twoReplicas(hourly());
            await scheduler.persistJobEnabled("report", false, "admin-uid");
            expect(fleet.store.saveEnabledOverride).toHaveBeenCalledWith("report", false, "admin-uid");
        });

        it("applies to this process at once, as before", async () => {
            twoReplicas(hourly());
            const status = await scheduler.persistJobEnabled("report", false);
            expect(status?.enabled).toBe(false);
            expect(status?.state).toBe("disabled");
            // A paused job has no next run to show, even though the timer stays
            // armed to read the state again at that slot.
            expect(status?.nextRunAt).toBeUndefined();
        });

        it("answers undefined for a job it does not have", async () => {
            twoReplicas(hourly());
            await expect(scheduler.persistJobEnabled("nope", false)).resolves.toBeUndefined();
        });

        it("still pauses locally with no store, as before", async () => {
            const runs: string[] = [];
            scheduler.registerJobs([hourly()(runs, "solo")]);
            scheduler.start();
            await scheduler.persistJobEnabled("report", false);
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);
            expect(runs).toEqual([]);
        });
    });

    // ── The run lease: "already executing", across processes ────────

    describe("run lease", () => {
        let other: CronScheduler;

        beforeEach(() => {
            jest.useRealTimers();
            other = new CronScheduler();
        });
        afterEach(() => {
            other.stop();
            jest.restoreAllMocks();
        });

        function blockingJob(id: string, started: string[], name: string, gate: Promise<void>, overrides: Partial<CronJobDefinition> = {}) {
            return makeJob(id, {
                handler: async () => { started.push(name); await gate; },
                ...overrides
            });
        }

        it("answers a manual trigger with a skip while another process runs the job", async () => {
            const fleet = makeFleetStore();
            const started: string[] = [];
            let release!: () => void;
            const gate = new Promise<void>(r => { release = r; });
            scheduler.setStore(fleet.store);
            other.setStore(fleet.store);
            scheduler.registerJobs([blockingJob("sync", started, "api", gate)]);
            other.registerJobs([blockingJob("sync", started, "worker", gate)]);

            const workerRun = other.triggerJob("sync");
            await until(() => started.includes("worker"));

            const skip = await scheduler.triggerJob("sync");

            expect(started).toEqual(["worker"]);
            expect(skip?.result).toEqual({ skipped: true, reason: "already_executing" });
            // Says where, which is the thing an operator cannot see from here.
            expect(skip?.logs.join("\n")).toMatch(/running on .+:\d+/);
            // In the history as well, like an overlap on one process.
            expect(fleet.logs.some(e => e.jobId === "sync" && e.manual && (e.result as { skipped?: boolean })?.skipped)).toBe(true);

            release();
            await workerRun;
        });

        it("runs again once the other process has finished", async () => {
            const fleet = makeFleetStore();
            scheduler.setStore(fleet.store);
            other.setStore(fleet.store);
            scheduler.registerJobs([makeJob("sync")]);
            other.registerJobs([makeJob("sync")]);

            await other.triggerJob("sync");
            const log = await scheduler.triggerJob("sync");

            expect(log?.success).toBe(true);
            expect(log?.result).toEqual({ ok: true });
            expect(fleet.leases.size).toBe(0);
        });

        it("releases the lease when the run fails", async () => {
            const fleet = makeFleetStore();
            scheduler.setStore(fleet.store);
            scheduler.registerJobs([makeFailingJob("fragile")]);

            await scheduler.triggerJob("fragile");

            expect(fleet.store.releaseRunLease).toHaveBeenCalledTimes(1);
            expect(fleet.leases.size).toBe(0);
        });

        it("holds the lease for the job's timeout plus a grace, and caps a run with none", async () => {
            const fleet = makeFleetStore();
            scheduler.setStore(fleet.store);
            scheduler.registerJobs([
                makeJob("bounded", { timeoutSeconds: 120 }),
                makeJob("unbounded", { timeoutSeconds: Infinity }),
                makeJob("default", { timeoutSeconds: undefined })
            ]);

            await scheduler.triggerJob("bounded");
            await scheduler.triggerJob("unbounded");
            await scheduler.triggerJob("default");

            const ttl = (id: string) => fleet.store.tryAcquireRunLease.mock.calls.find(c => c[0] === id)?.[2];
            expect(ttl("bounded")).toBe(150);
            // A crashed holder of a job with no timeout frees it within the hour.
            expect(ttl("unbounded")).toBe(3600);
            expect(ttl("default")).toBe(330);
        });

        it("runs a manual trigger anyway when the lease cannot be taken", async () => {
            const fleet = makeFleetStore();
            jest.spyOn(logger, "warn").mockImplementation(() => { /* silence */ });
            fleet.store.tryAcquireRunLease.mockRejectedValue(new Error("relation does not exist"));
            scheduler.setStore(fleet.store);
            scheduler.registerJobs([makeJob("open")]);

            const log = await scheduler.triggerJob("open");

            expect(log?.success).toBe(true);
            expect(fleet.store.releaseRunLease).not.toHaveBeenCalled();
        });

        it("keeps two concurrent triggers on one process from both reaching the handler", async () => {
            // The lease is awaited, so the in-process flag must be taken before
            // it is — or two triggers could both pass the check and then race.
            const fleet = makeFleetStore();
            const started: string[] = [];
            let release!: () => void;
            const gate = new Promise<void>(r => { release = r; });
            scheduler.setStore(fleet.store);
            scheduler.registerJobs([blockingJob("once", started, "api", gate)]);

            const first = scheduler.triggerJob("once");
            const second = await scheduler.triggerJob("once");

            expect(second?.result).toEqual({ skipped: true, reason: "already_executing" });
            release();
            await first;
            expect(started).toEqual(["api"]);
        });
    });

    describe("run lease on the scheduled path", () => {
        let other: CronScheduler;

        beforeEach(() => { other = new CronScheduler(); });
        afterEach(() => {
            other.stop();
            jest.restoreAllMocks();
        });

        it("skips a slot while another process holds the lease, and records it", async () => {
            // The api role runs a manual trigger; the worker's slot comes due
            // in the middle of it. They used to run side by side.
            const fleet = makeFleetStore();
            const started: string[] = [];
            let release!: () => void;
            const gate = new Promise<void>(r => { release = r; });
            const job = (name: string) => makeJob("sync", {
                timeoutSeconds: 7200,
                handler: async () => { started.push(name); await gate; }
            });
            scheduler.setStore(fleet.store);
            other.setStore(fleet.store);
            scheduler.registerJobs([job("api")]);
            other.registerJobs([job("worker")]);
            other.start();

            const manual = scheduler.triggerJob("sync");
            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);

            expect(started).toEqual(["api"]);
            const skip = fleet.logs.find(e => !e.manual && (e.result as { skipped?: boolean })?.skipped);
            expect(skip?.result).toEqual({ skipped: true, reason: "already_executing" });
            // The slot still counts as taken, and the next one is armed.
            expect(other.getJob("sync")?.nextRunAt).toBeDefined();

            release();
            await manual;
        });

        it("runs the slot when the lease cannot be taken, as a failed claim does", async () => {
            const fleet = makeFleetStore();
            jest.spyOn(logger, "warn").mockImplementation(() => { /* silence */ });
            fleet.store.tryAcquireRunLease.mockRejectedValue(new Error("connection terminated unexpectedly"));
            let executed = false;
            other.setStore(fleet.store);
            other.registerJobs([makeJob("open", { handler: () => { executed = true; } })]);
            other.start();

            await jest.advanceTimersByTimeAsync(61 * 60 * 1000);

            expect(executed).toBe(true);
        });
    });

    // ── What a process that does not schedule shows ─────────────────

    describe("fetchJobs", () => {
        beforeEach(() => { jest.useRealTimers(); });
        afterEach(() => { jest.restoreAllMocks(); });

        it("reads run counts and the last run from the store when the scheduler is not started", async () => {
            // The api role runs nothing, so its own counters read 0 runs for a
            // job the worker has run a thousand times.
            const fleet = makeFleetStore();
            fleet.store.fetchRunSummaries.mockResolvedValue(new Map([["nightly", {
                totalRuns: 1204,
                totalFailures: 3,
                lastRunAt: "2026-09-22T03:00:00.000Z",
                lastDurationMs: 812,
                lastSuccess: false,
                lastError: "upstream 502"
            }]]));
            scheduler.setStore(fleet.store);
            scheduler.registerJobs([makeJob("nightly", { schedule: "0 3 * * *" })]);

            const [job] = await scheduler.fetchJobs();

            expect(job).toMatchObject({
                id: "nightly",
                totalRuns: 1204,
                totalFailures: 3,
                lastRunAt: "2026-09-22T03:00:00.000Z",
                lastDurationMs: 812,
                lastError: "upstream 502",
                state: "error"
            });
            // Nothing here arms a timer, but the slot the worker will fire is
            // the schedule's to say.
            expect(job.nextRunAt).toBeDefined();
            expect(fleet.store.fetchRunSummaries).toHaveBeenCalledWith(["nightly"]);
        });

        it("keeps its own counters when its scheduler is started", async () => {
            const fleet = makeFleetStore();
            scheduler.setStore(fleet.store);
            scheduler.registerJobs([makeJob("local")]);
            scheduler.start();
            await scheduler.triggerJob("local");

            const [job] = await scheduler.fetchJobs();

            expect(job.totalRuns).toBe(1);
            expect(fleet.store.fetchRunSummaries).not.toHaveBeenCalled();
        });

        it("shows a pause another process made", async () => {
            const fleet = makeFleetStore();
            fleet.overrides.set("paused", false);
            scheduler.setStore(fleet.store);
            scheduler.registerJobs([makeJob("paused")]);

            const job = await scheduler.fetchJob("paused");

            expect(job?.enabled).toBe(false);
            expect(job?.state).toBe("disabled");
            expect(job?.nextRunAt).toBeUndefined();
        });

        it("shows a job another process is running as running", async () => {
            const fleet = makeFleetStore();
            fleet.leases.set("busy", { holder: "worker-1:42#ab12", until: Date.now() + 60_000 });
            scheduler.setStore(fleet.store);
            scheduler.registerJobs([makeJob("busy")]);

            const job = await scheduler.fetchJob("busy");

            expect(job?.state).toBe("running");
        });

        it("answers from what it knows when the store cannot answer", async () => {
            const fleet = makeFleetStore();
            jest.spyOn(logger, "warn").mockImplementation(() => { /* silence */ });
            fleet.store.fetchJobStates.mockRejectedValue(new Error("connection terminated unexpectedly"));
            fleet.store.fetchRunSummaries.mockRejectedValue(new Error("connection terminated unexpectedly"));
            scheduler.setStore(fleet.store);
            scheduler.registerJobs([makeJob("steady")]);

            const [job] = await scheduler.fetchJobs();

            expect(job).toMatchObject({ id: "steady", enabled: true, state: "idle", totalRuns: 0, totalFailures: 0 });
        });

        it("answers undefined for a job it does not have", async () => {
            await expect(scheduler.fetchJob("nope")).resolves.toBeUndefined();
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
