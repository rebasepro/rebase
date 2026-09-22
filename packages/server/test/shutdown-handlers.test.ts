import { createServer } from "http";
import type { RealtimeProvider } from "@rebasepro/types";
import { createShutdown, installShutdownHandlers } from "../src/init/shutdown";
import { createJobQueue } from "../src/jobs";
import { CronScheduler } from "../src/cron/cron-scheduler";
import type { JobRecord, JobStore } from "../src/jobs";

// Use SIGUSR2 in tests so we never trigger listeners that other tooling
// may have registered on SIGTERM/SIGINT.
const TEST_SIGNAL: NodeJS.Signals = "SIGUSR2";

function flushAsync(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 10));
}

describe("installShutdownHandlers", () => {
    let uninstall: (() => void) | undefined;

    afterEach(() => {
        uninstall?.();
        uninstall = undefined;
    });

    it("drains the backend, runs cleanup, and exits 0", async () => {
        const calls: string[] = [];
        const backend = {
            shutdown: async () => { calls.push("shutdown"); }
        };
        const exit = jest.fn(() => { calls.push("exit"); });

        uninstall = installShutdownHandlers(backend, {
            signals: [TEST_SIGNAL],
            onCleanup: () => { calls.push("cleanup"); },
            exit: exit as unknown as (code: number) => void
        });

        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        await flushAsync();

        expect(calls).toEqual(["shutdown", "cleanup", "exit"]);
        expect(exit).toHaveBeenCalledWith(0);
    });

    it("ignores repeated signals while shutting down", async () => {
        const shutdown = jest.fn(async () => { await flushAsync(); });
        const exit = jest.fn();

        uninstall = installShutdownHandlers({ shutdown }, {
            signals: [TEST_SIGNAL],
            exit: exit as unknown as (code: number) => void
        });

        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        await flushAsync();
        await flushAsync();

        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
    });

    it("exits 1 when the backend drain fails", async () => {
        const exit = jest.fn();

        uninstall = installShutdownHandlers(
            { shutdown: async () => { throw new Error("drain failed"); } },
            { signals: [TEST_SIGNAL], exit: exit as unknown as (code: number) => void }
        );

        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        await flushAsync();

        expect(exit).toHaveBeenCalledWith(1);
    });

    it("exits 1 when cleanup fails", async () => {
        const exit = jest.fn();

        uninstall = installShutdownHandlers(
            { shutdown: async () => {} },
            {
                signals: [TEST_SIGNAL],
                onCleanup: () => { throw new Error("pool close failed"); },
                exit: exit as unknown as (code: number) => void
            }
        );

        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        await flushAsync();

        expect(exit).toHaveBeenCalledWith(1);
    });

    it("force-exits 1 when shutdown hangs past timeoutMs", async () => {
        const exit = jest.fn();

        uninstall = installShutdownHandlers(
            // Never resolves — simulates a hung drain.
            { shutdown: () => new Promise<void>(() => {}) },
            {
                signals: [TEST_SIGNAL],
                timeoutMs: 30,
                exit: exit as unknown as (code: number) => void
            }
        );

        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        await new Promise((resolve) => setTimeout(resolve, 80));

        expect(exit).toHaveBeenCalledWith(1);
    });

    it("uninstall removes the signal listeners", async () => {
        const shutdown = jest.fn(async () => {});
        const exit = jest.fn();

        const remove = installShutdownHandlers({ shutdown }, {
            signals: [TEST_SIGNAL],
            exit: exit as unknown as (code: number) => void
        });
        remove();

        process.emit(TEST_SIGNAL, TEST_SIGNAL);
        await flushAsync();

        expect(shutdown).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
    });
});

/** A store holding one job whose handler will be claimed and never finish. */
function oneJobStore(task: string): JobStore & { jobs: JobRecord[] } {
    const jobs: JobRecord[] = [{
        id: "1", task, payload: null, status: "pending", runAt: new Date(0).toISOString(),
        attempts: 0, maxAttempts: 3, lastError: null,
        createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()
    }];
    return {
        jobs,
        ensureTable: async () => undefined,
        insert: async () => null,
        claim: async () => jobs.filter(j => j.status === "pending").map(j => {
            j.status = "running";
            j.attempts++;
            return { ...j };
        }),
        complete: async () => undefined,
        fail: async () => undefined,
        reapExpired: async () => 0,
        fetch: async () => null
    };
}

describe("createShutdown", () => {
    it("finishes within its budget when a job never does, and still tears down", async () => {
        // One handler awaiting a socket that never answers used to hold
        // `jobQueue.stop()` — and with it the realtime teardown, the HTTP
        // server and the shutdown promise — until the process was killed.
        const store = oneJobStore("stuck");
        const jobQueue = createJobQueue(store, {
            pollIntervalMs: 10,
            tasks: { stuck: () => new Promise<void>(() => { /* never settles */ }) }
        });
        jobQueue.start();
        while (store.jobs[0].status !== "running") await flushAsync();

        const server = createServer();
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        const shutdown = createShutdown({ server, jobQueue, realtimeServices: {} });

        const started = Date.now();
        let outcome: unknown;
        let closedByShutdown: boolean;
        try {
            outcome = await Promise.race([
                shutdown(300).then(() => "resolved"),
                new Promise(resolve => setTimeout(() => resolve("still waiting"), 2_000))
            ]);
            closedByShutdown = !server.listening;
        } finally {
            if (server.listening) server.close();
        }

        expect(outcome).toBe("resolved");
        expect(Date.now() - started).toBeLessThan(1_000);
        // The job drain gave up inside the budget, leaving time for the rest.
        expect(closedByShutdown).toBe(true);
    });

    it("waits for a cron run in flight before tearing down under it", async () => {
        const cronScheduler = new CronScheduler();
        let finished = false;
        cronScheduler.registerJobs([{
            id: "nightly",
            definition: {
                schedule: "0 3 * * *",
                handler: async () => {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    finished = true;
                }
            }
        }]);
        const run = cronScheduler.triggerJob("nightly");

        await createShutdown({ server: createServer(), cronScheduler, realtimeServices: {} })(3_000);

        expect(finished).toBe(true);
        expect((await run)?.success).toBe(true);
    });

    it("aborts a cron run that outlasts the budget, rather than leaving it running", async () => {
        const cronScheduler = new CronScheduler();
        let signal: AbortSignal | undefined;
        cronScheduler.registerJobs([{
            id: "stuck",
            definition: {
                schedule: "0 3 * * *",
                handler: (ctx) => { signal = ctx.signal; return new Promise<void>(() => { /* never settles */ }); }
            }
        }]);
        const run = cronScheduler.triggerJob("stuck");

        await createShutdown({ server: createServer(), cronScheduler, realtimeServices: {} })(300);

        expect(signal?.aborted).toBe(true);
        expect((await run)?.success).toBe(false);
    });

    it("resolves at its timeout even when a teardown step hangs", async () => {
        // The force-resolve used to be armed last, after every awaited step,
        // so it bounded nothing that came before it.
        const hung: RealtimeProvider = {
            subscribeToCollection: () => undefined,
            subscribeToOne: () => undefined,
            unsubscribe: () => undefined,
            notifyUpdate: async () => undefined,
            destroy: () => new Promise<void>(() => { /* never settles */ })
        };
        const shutdown = createShutdown({ server: createServer(), realtimeServices: { default: hung } });

        const outcome = await Promise.race([
            shutdown(100).then(() => "resolved"),
            new Promise(resolve => setTimeout(() => resolve("still waiting"), 1_000))
        ]);

        expect(outcome).toBe("resolved");
    });
});
