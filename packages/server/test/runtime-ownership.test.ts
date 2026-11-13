import { describe, expect, it, afterEach, jest } from "@jest/globals";
import { Hono } from "hono";
import path from "node:path";
import type { BackendBootstrapper, DataDriver } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { initializeRebaseBackend } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import { fakeBootstrapper, fakeDataDriver, idleServer } from "./helpers/server-b-fakes";
import { resolveOwnership } from "../src/init/surfaces";
import { tablesFrom } from "./helpers/tables";

/**
 * What a process *owns*, as distinct from what it serves.
 *
 * Ownership is not a correctness control — the cron scheduler claims each
 * `(job, slot)` pair in `rebase.cron_claims` and the job store claims rows
 * `FOR UPDATE SKIP LOCKED`, so several processes doing both is already safe.
 * It is about not handing scheduled work to a process whose replica count is a
 * scaling decision, and about not paying for a poll loop in a process that will
 * never run a task.
 *
 * Two things are asserted, and the second is the one that matters:
 *
 * 1. Not owning the scheduler leaves no timer running.
 * 2. Not owning the job workers still leaves `enqueue` working. A function
 *    running on a functions-only process must be able to hand work to the
 *    worker tier; if disowning the workers also took away the ability to
 *    enqueue, the split would silently drop background work at the point where
 *    it is most likely to be used.
 */

/**
 * The importer seam, for the reason spelled out in `runtime-surfaces.test.ts`:
 * booting through `initializeRebaseBackend` means the cron loader runs with no
 * injectable importer, and a native dynamic `import()` inside jest's vm is the
 * one thing that cannot be relied on here. This file paid for that already —
 * the two cron assertions below were deleted in 55cf62efe for loading zero jobs
 * on the runner while the same fixture loaded elsewhere in the same run. They
 * are back because the dependency is gone, not because the runner changed.
 */
jest.mock("../src/utils/dynamic-import", () => ({
    ...(jest.requireActual("../src/utils/dynamic-import") as Record<string, unknown>),
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deterministic CJS load, as in the helper's own docblock
    nativeDynamicImport: (url: string) => require("./helpers/require-importer").requireImporter(url)
}));

const CRONS_DIR = path.join(__dirname, "fixtures", "crons");

function collection(slug: string): LegacyCollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    };
}

/** Records the SQL it is asked to run, and answers no rows to everything. */
function recordingDriver(sql: string[]): DataDriver {
    return fakeDataDriver({
        admin: {
            executeSql: async (statement: string) => {
                sql.push(statement);
                return [];
            }
        }
    });
}

function bootstrapperFor(sql: string[]): BackendBootstrapper {
    return fakeBootstrapper({ driver: recordingDriver(sql) }, {
        async initializeAuth() {
            return { userService: {}, authRepository: {} };
        }
    });
}

type Backend = Awaited<ReturnType<typeof initializeRebaseBackend>>;

const started: Backend[] = [];

async function boot(ownership?: { cronScheduler?: boolean; jobWorkers?: boolean }): Promise<{
    backend: Backend;
    sql: string[];
}> {
    const sql: string[] = [];
    const backend = await initializeRebaseBackend({
        app: new Hono<HonoEnv>(),
        server: idleServer(),
        ...tablesFrom([collection("jobs")]),
        cronsDir: CRONS_DIR,
        cronPersistence: false,
        bootstrappers: [bootstrapperFor(sql)],
        jobs: { enabled: true, tasks: {} },
        ...(ownership ? { ownership } : {})
    });
    started.push(backend);
    return { backend, sql };
}

afterEach(() => {
    while (started.length) {
        const backend = started.pop()!;
        void backend.cronScheduler?.stop();
        void backend.jobQueue?.stop();
    }
});

describe("resolveOwnership", () => {
    it("owns everything when nothing is named", () => {
        expect(resolveOwnership()).toEqual({
            cronScheduler: true,
            jobWorkers: true,
            rlsAudit: true
        });
    });

    it("leaves the unnamed half owned", () => {
        expect(resolveOwnership({ cronScheduler: false })).toEqual({
            cronScheduler: false,
            jobWorkers: true,
            rlsAudit: true
        });
    });
});

describe("runtime ownership", () => {
    it("schedules cron jobs by default", async () => {
        const { backend } = await boot();

        const scheduler = backend.cronScheduler;
        expect(scheduler?.listJobs().length).toBeGreaterThan(0);
        expect(hasPendingTimer(backend)).toBe(true);
    });

    it("registers cron jobs but starts no timer when it does not own the scheduler", async () => {
        const { backend } = await boot({ cronScheduler: false });

        // Registered, so the admin surface still lists them...
        const scheduler = backend.cronScheduler;
        expect(scheduler?.listJobs().length).toBeGreaterThan(0);
        // ...but nothing is going to fire.
        expect(hasPendingTimer(backend)).toBe(false);
    });

    it("keeps the job queue enqueueable when it does not own the workers", async () => {
        const { backend, sql } = await boot({ jobWorkers: false });

        const queue = backend.jobQueue;
        expect(queue).toBeDefined();

        sql.length = 0;
        await queue!.enqueue("send-welcome", { email: "a@b.c" });

        // The insert reached the database: a process that runs no workers can
        // still hand work to the tier that does.
        expect(sql.some(statement => /insert into/i.test(statement))).toBe(true);
    });
});

/**
 * Whether the scheduler is holding a timer.
 *
 * Read off the scheduler's own job records rather than by counting Node
 * handles: `jest --forceExit` and other suites' timers make a process-wide
 * count meaningless, and the question here is specifically about this
 * scheduler.
 */
function hasPendingTimer(backend: Backend): boolean {
    const scheduler = backend.cronScheduler;
    return (scheduler?.listJobs() ?? []).some(job => Boolean(job.nextRunAt));
}
