/**
 * E2E: a job enqueued by one process starts on another one's worker at once,
 * woken by `NOTIFY` — not at its next poll.
 *
 * An idle worker used to claim every 2 seconds, forever, so that a job another
 * process enqueued would start within 2 seconds: about 45,000 round trips a day
 * per pod, and a database that could never suspend. The worker now holds a
 * `LISTEN` through the driver and polls only as a safety net, so this suite
 * gives it a 60-second poll: a job that starts within a second was woken.
 *
 * Nothing faked: one Postgres container, two pools, two real drivers — the
 * `api` role that enqueues and runs no workers, and the worker.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { createJobQueue, createJobStore, type JobQueue } from "../../../server/src/jobs/index.js";

async function waitFor(predicate: () => boolean | Promise<boolean>, message: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await predicate()) return;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${message}`);
        await new Promise(r => setTimeout(r, 20));
    }
}

function driverOn(pool: pg.Pool): PostgresBackendDriver {
    const registry = new PostgresCollectionRegistry();
    const db = drizzle(pool);
    return new PostgresBackendDriver(db as never, new RealtimeService(db as never, registry), registry);
}

describe("job worker wake-up (E2E, two processes)", () => {
    let container: PgContainer;
    let apiPool: pg.Pool;
    let workerPool: pg.Pool;
    let api: JobQueue;
    let worker: JobQueue;
    const started: Array<{ task: string; at: number }> = [];

    beforeAll(async () => {
        container = await startPgContainer();
        apiPool = new pg.Pool({ connectionString: container.connectionString });
        workerPool = new pg.Pool({ connectionString: container.connectionString });

        const apiStore = createJobStore(driverOn(apiPool))!;
        await apiStore.ensureTable();
        api = createJobQueue(apiStore);

        worker = createJobQueue(createJobStore(driverOn(workerPool))!, {
            pollIntervalMs: 60_000,
            tasks: {
                ping: () => { started.push({ task: "ping", at: Date.now() }); },
                later: () => { started.push({ task: "later", at: Date.now() }); }
            }
        });
        worker.start();
        // Listening once the LISTEN session is there.
        await waitFor(async () => {
            const { rows } = await apiPool.query<{ n: number }>(
                "SELECT count(*)::int AS n FROM pg_stat_activity WHERE query ILIKE 'LISTEN%rebase_jobs%'"
            );
            return rows[0].n > 0;
        }, "the worker's LISTEN connection");
    });

    afterAll(async () => {
        await worker?.stop(1_000);
        await apiPool?.end();
        await workerPool?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    it("starts a job another process enqueued within a second, with a 60 s poll", async () => {
        const enqueuedAt = Date.now();
        await api.enqueue("ping");
        await waitFor(() => started.some(s => s.task === "ping"), "the worker to run ping", 5_000);
        const ran = started.find(s => s.task === "ping")!;
        expect(ran.at - enqueuedAt).toBeLessThan(1_000);
    });

    it("starts a delayed job when it comes due, not at the next poll", async () => {
        const enqueuedAt = Date.now();
        await api.enqueue("later", undefined, { delayMs: 1_500 });
        await waitFor(() => started.some(s => s.task === "later"), "the worker to run later", 10_000);
        const ran = started.find(s => s.task === "later")!;
        expect(ran.at - enqueuedAt).toBeGreaterThanOrEqual(1_400);
        expect(ran.at - enqueuedAt).toBeLessThan(3_000);
    });
});
