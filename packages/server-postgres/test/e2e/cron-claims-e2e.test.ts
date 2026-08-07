/**
 * E2E: cron slot claiming across multiple backend instances, one Postgres.
 *
 * The unit tests for the scheduler and the store both stand in for the database
 * — one with a `tryClaimRun` mock that returns a fixed boolean, the other with a
 * fake `executeSql` that only records SQL text. Neither can observe the thing
 * the design actually rests on: that when N independent processes race to claim
 * the same `(job_id, slot)` against a real Postgres, exactly one wins.
 *
 * Two layers, both against a real container:
 *
 *   1. Store level — `tryClaimRun` through the real `PostgresBackendDriver`,
 *      so the `ON CONFLICT … DO NOTHING … RETURNING` contract, the parameter
 *      binding in the claim sweeps, the TIMESTAMPTZ key and the privilege
 *      revocation are executed rather than string-matched.
 *
 *   2. Scheduler level — N real `CronScheduler` instances, each with its own
 *      pool, driver and store, racing the same slot: once through the catch-up
 *      path at boot, and once through the real `setTimeout` path at a real
 *      minute boundary.
 *
 * Each "instance" gets its own connection pool on purpose. A shared pool would
 * serialise nothing but would also prove nothing — the claim has to hold across
 * connections, which is the only configuration production ever runs in.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { REBASE_USER_ROLE } from "@rebasepro/common";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { createCronStore, type CronStore } from "../../../server/src/cron/cron-store.js";
import { CronScheduler } from "../../../server/src/cron/cron-scheduler.js";

/** How many backend instances the tests simulate. */
const INSTANCES = 5;

/**
 * One simulated backend instance: its own pool, its own driver, its own store.
 * Nothing is shared but the database itself.
 */
interface Instance {
    pool: pg.Pool;
    store: CronStore;
}

describe("Cron slot claiming across instances (E2E)", () => {
    let container: PgContainer;
    let instances: Instance[] = [];
    /** An independent connection used only to inspect and reset state. */
    let inspector: pg.Client;

    function makeInstance(): Instance {
        const pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        const realtime = new RealtimeService(db as never, registry);
        const driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);
        const store = createCronStore(driver);
        if (!store) throw new Error("Expected the Postgres driver to expose a SQL admin");
        return {
            pool,
            store
        };
    }

    beforeAll(async () => {
        container = await startPgContainer();

        inspector = new pg.Client({ connectionString: container.connectionString });
        await inspector.connect();

        // The end-user role the internal-table revoke targets. Without it the
        // revoke is a guarded no-op and every privilege assertion below would
        // pass for the wrong reason.
        await inspector.query(`
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${REBASE_USER_ROLE}') THEN
                    CREATE ROLE ${REBASE_USER_ROLE};
                END IF;
            END $$;
        `);

        instances = Array.from({ length: INSTANCES }, () => makeInstance());
        await instances[0].store.ensureTable();
    }, 180_000);

    afterAll(async () => {
        await inspector?.end().catch(() => {});
        await Promise.all(instances.map(i => i.pool.end().catch(() => {})));
        if (container) await stopPgContainer(container.containerName);
    });

    // Unique per test, so no test can be polluted by another's rows.
    let jobCounter = 0;
    const nextJobId = (prefix: string) => `${prefix}-${++jobCounter}`;

    const countClaims = async (jobId: string) => {
        const { rows } = await inspector.query(
            "SELECT count(*)::int AS n FROM rebase.cron_claims WHERE job_id = $1", [jobId]
        );
        return rows[0].n as number;
    };

    const countLogs = async (jobId: string) => {
        const { rows } = await inspector.query(
            "SELECT count(*)::int AS n FROM rebase.cron_logs WHERE job_id = $1", [jobId]
        );
        return rows[0].n as number;
    };

    // ── Layer 1: the claim itself, against real Postgres ─────────────

    describe("cold boot", () => {
        /** Make anything created in `rebase` reachable by the end-user role. */
        const grantByDefault = () => inspector.query(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA rebase GRANT ALL ON TABLES TO ${REBASE_USER_ROLE}`
        );

        it("survives all instances creating the schema and tables at once", async () => {
            // A rolling deploy starts every replica at the same moment and each
            // one calls ensureTable. `CREATE … IF NOT EXISTS` reads the catalog
            // and then writes to it non-atomically, so the losers raise a
            // duplicate key on a catalog index rather than the no-op the syntax
            // implies. Dropping the schema too, so the race covers
            // `CREATE SCHEMA` as well as the tables.
            await inspector.query("DROP SCHEMA IF EXISTS rebase CASCADE");

            await Promise.all(instances.map(i => i.store.ensureTable()));

            const { rows } = await inspector.query(
                `SELECT to_regclass('rebase.cron_logs')   IS NOT NULL AS logs,
                        to_regclass('rebase.cron_claims') IS NOT NULL AS claims`
            );
            expect(rows[0].logs).toBe(true);
            expect(rows[0].claims).toBe(true);

            // Not just "someone can claim" — every instance has to come out of
            // the stampede able to coordinate. An instance that abandoned its
            // ensureTable half-way is exactly the one that would then run every
            // job uncoordinated.
            const jobId = nextJobId("post-stampede");
            const claims = await Promise.all(
                instances.map((i, n) =>
                    i.store.tryClaimRun!(jobId, new Date(Date.UTC(2026, 7, 8, n)).toISOString())
                )
            );
            expect(claims.every(Boolean)).toBe(true);
        });

        it("leaves no instance with the claims table still exposed", async () => {
            // The revoke used to sit at the end of one long try block, so the
            // loser of any race above it skipped the security control and said
            // only that log persistence was unavailable.
            await inspector.query("DROP SCHEMA IF EXISTS rebase CASCADE");
            // Pre-create so the default-privileges grant has a schema to attach
            // to; the table-level race — the one the revoke depends on — still
            // happens below.
            await inspector.query("CREATE SCHEMA rebase");
            await grantByDefault();

            await Promise.all(instances.map(i => i.store.ensureTable()));

            const { rows } = await inspector.query(
                `SELECT has_table_privilege($1, 'rebase.cron_claims', 'INSERT') AS can_claim,
                        has_table_privilege($1, 'rebase.cron_logs',   'SELECT') AS can_read_logs`,
                [REBASE_USER_ROLE]
            );
            expect(rows[0].can_claim).toBe(false);
            expect(rows[0].can_read_logs).toBe(false);

            await inspector.query(
                `ALTER DEFAULT PRIVILEGES IN SCHEMA rebase REVOKE ALL ON TABLES FROM ${REBASE_USER_ROLE}`
            );
        });
    });

    describe("tryClaimRun", () => {
        it("lets exactly one instance win a contended slot", async () => {
            const jobId = nextJobId("contended");
            const slot = new Date("2026-08-07T12:00:00.000Z").toISOString();

            const results = await Promise.all(
                instances.map(i => i.store.tryClaimRun!(jobId, slot))
            );

            expect(results.filter(Boolean)).toHaveLength(1);
            expect(await countClaims(jobId)).toBe(1);
        });

        it("lets every instance win when the slots are distinct", async () => {
            // The control for the test above: if the harness could not observe N
            // simultaneous wins, "exactly one" would be a property of the test
            // rather than of the claim.
            const jobId = nextJobId("uncontended");
            const results = await Promise.all(
                instances.map((i, n) =>
                    i.store.tryClaimRun!(jobId, new Date(Date.UTC(2026, 7, 7, n)).toISOString())
                )
            );

            expect(results.every(Boolean)).toBe(true);
            expect(await countClaims(jobId)).toBe(INSTANCES);
        });

        it("returns false on a re-claim — DO NOTHING yields no RETURNING row", async () => {
            // The whole win/lose contract is `rows.length > 0`. Postgres returns
            // zero rows from RETURNING when DO NOTHING suppresses the insert,
            // which the store never gets to find out under a fake executeSql.
            const jobId = nextJobId("repeat");
            const slot = new Date("2026-08-07T13:00:00.000Z").toISOString();

            await expect(instances[0].store.tryClaimRun!(jobId, slot)).resolves.toBe(true);
            await expect(instances[0].store.tryClaimRun!(jobId, slot)).resolves.toBe(false);
            await expect(instances[1].store.tryClaimRun!(jobId, slot)).resolves.toBe(false);
        });

        it("keys the claim on the instant, not the string", async () => {
            // The column is TIMESTAMPTZ and the slot arrives as an ISO string.
            // Two instances in different zones describe the same instant with
            // different text; the primary key has to collapse them, or a slot
            // would be claimable once per timezone.
            const jobId = nextJobId("tz");
            await expect(
                instances[0].store.tryClaimRun!(jobId, "2026-08-07T12:00:00.000Z")
            ).resolves.toBe(true);
            await expect(
                instances[1].store.tryClaimRun!(jobId, "2026-08-07T14:00:00.000+02:00")
            ).resolves.toBe(false);

            expect(await countClaims(jobId)).toBe(1);
        });
    });

    describe("claim sweeps on start-up", () => {
        it("releases a claim on a slot that has not happened yet", async () => {
            // A timer that woke early burns a slot permanently: claims never
            // expire, so the real run is skipped in silence when it comes due.
            const stranded = nextJobId("stranded");
            const legitimate = nextJobId("near-future");

            await inspector.query(
                `INSERT INTO rebase.cron_claims (job_id, slot) VALUES
                 ($1, now() + interval '10 minutes'),
                 ($2, now() + interval '1 minute')`,
                [stranded, legitimate]
            );

            await instances[0].store.ensureTable();

            expect(await countClaims(stranded)).toBe(0);
            // Inside the 2-minute skew margin — a peer with a slightly fast
            // clock claiming moments early is not the same as a stranded claim.
            expect(await countClaims(legitimate)).toBe(1);
        });

        it("garbage-collects claims past the retention window", async () => {
            // `make_interval(days => $1)` binds a parameter into a named
            // argument. That combination either parses or it does not, and a
            // fake executeSql cannot tell you which.
            const old = nextJobId("expired");
            const recent = nextJobId("retained");

            await inspector.query(
                `INSERT INTO rebase.cron_claims (job_id, slot, claimed_at) VALUES
                 ($1, now() - interval '8 days', now() - interval '8 days'),
                 ($2, now() - interval '1 day',  now() - interval '1 day')`,
                [old, recent]
            );

            await instances[0].store.ensureTable();

            expect(await countClaims(old)).toBe(0);
            expect(await countClaims(recent)).toBe(1);
        });
    });

    describe("privileges", () => {
        it("takes both internal tables away from the end-user role", async () => {
            // A writable cron_claims lets any signed-in user suppress a
            // scheduled run by claiming its slot first; a readable cron_logs
            // hands them arbitrary job output. Neither table is a collection, so
            // there is no RLS behind the revoke to catch a mistake here.
            // Stand in for the driver's schema-wide grant: anything created in
            // `rebase` from here on reaches the end-user role unless revoked.
            await inspector.query(
                `ALTER DEFAULT PRIVILEGES IN SCHEMA rebase GRANT ALL ON TABLES TO ${REBASE_USER_ROLE}`
            );
            await inspector.query("DROP TABLE IF EXISTS rebase.cron_claims, rebase.cron_logs");

            await instances[0].store.ensureTable();

            const { rows } = await inspector.query(
                `SELECT has_table_privilege($1, 'rebase.cron_claims', 'INSERT') AS can_claim,
                        has_table_privilege($1, 'rebase.cron_logs',   'SELECT') AS can_read_logs`,
                [REBASE_USER_ROLE]
            );
            expect(rows[0].can_claim).toBe(false);
            expect(rows[0].can_read_logs).toBe(false);

            await inspector.query(
                `ALTER DEFAULT PRIVILEGES IN SCHEMA rebase REVOKE ALL ON TABLES FROM ${REBASE_USER_ROLE}`
            );
        });
    });

    // ── Layer 2: real schedulers racing a real slot ──────────────────

    /**
     * Build N schedulers that share the database and nothing else, each with
     * the store belonging to its own instance.
     */
    function makeSchedulers(): CronScheduler[] {
        return instances.map(instance => {
            const scheduler = new CronScheduler();
            scheduler.setStore(instance.store);
            return scheduler;
        });
    }

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    describe("catch-up at boot", () => {
        it("runs a missed slot once across a simultaneous restart", async () => {
            // Every replica coming up at once after a rolling deploy, all of
            // them finding the same unrun slot inside their catch-up window.
            const jobId = nextJobId("catch-up");
            let executions = 0;

            const schedulers = makeSchedulers();
            for (const scheduler of schedulers) {
                scheduler.registerJobs([{
                    id: jobId,
                    definition: {
                        name: "Catch-up race",
                        // Hourly, so the timer for the *next* slot is up to an
                        // hour away and cannot fire during the test. The window
                        // still covers the most recent elapsed slot.
                        schedule: "0 * * * *",
                        catchUpWindowSeconds: 3600,
                        handler: async () => { executions++; }
                    }
                }]);
            }

            // start() launches catch-up without awaiting it — boot must not
            // block on the database — so poll until it has settled.
            schedulers.forEach(s => s.start());
            await sleep(2_000);
            schedulers.forEach(s => s.stop());

            expect(executions).toBe(1);
            expect(await countClaims(jobId)).toBe(1);
            expect(await countLogs(jobId)).toBe(1);
        }, 30_000);

        it("does nothing on a second wave, because the slot is already claimed", async () => {
            // The ordinary case: instances recycling after a slot ran normally.
            // Catch-up must cost one claim attempt and stay silent.
            const jobId = nextJobId("catch-up-settled");
            let executions = 0;

            const register = (scheduler: CronScheduler) => scheduler.registerJobs([{
                id: jobId,
                definition: {
                    name: "Catch-up second wave",
                    schedule: "0 * * * *",
                    catchUpWindowSeconds: 3600,
                    handler: async () => { executions++; }
                }
            }]);

            const first = makeSchedulers();
            first.forEach(s => { register(s); s.start(); });
            await sleep(2_000);
            first.forEach(s => s.stop());
            expect(executions).toBe(1);

            const second = makeSchedulers();
            second.forEach(s => { register(s); s.start(); });
            await sleep(2_000);
            second.forEach(s => s.stop());

            expect(executions).toBe(1);
            expect(await countLogs(jobId)).toBe(1);
        }, 60_000);
    });

    describe("scheduled execution at a real minute boundary", () => {
        it("fires once across instances, and N times without a claim", async () => {
            // The property the whole design exists for, through the real
            // setTimeout path rather than catch-up.
            //
            // The second job is the control. It runs on the same schedulers, at
            // the same slot, with claiming neutralised — so if it does not
            // record one execution per instance, then the coordinated job's
            // "exactly once" would only be telling us the timers never fired.
            const coordinated = nextJobId("scheduled");
            const uncoordinated = nextJobId("unclaimed");
            let coordinatedRuns = 0;
            let uncoordinatedRuns = 0;

            const schedulers = instances.map(instance => {
                const scheduler = new CronScheduler();
                scheduler.setStore({
                    ...instance.store,
                    tryClaimRun: async (jobId, slot) =>
                        jobId === uncoordinated
                            ? true
                            : instance.store.tryClaimRun!(jobId, slot)
                });
                scheduler.registerJobs([
                    {
                        id: coordinated,
                        definition: {
                            name: "Coordinated",
                            schedule: "* * * * *",
                            handler: async () => { coordinatedRuns++; }
                        }
                    },
                    {
                        id: uncoordinated,
                        definition: {
                            name: "Uncoordinated control",
                            schedule: "* * * * *",
                            handler: async () => { uncoordinatedRuns++; }
                        }
                    }
                ]);
                return scheduler;
            });

            schedulers.forEach(s => s.start());

            // Every instance must have derived the *same* slot from the cron
            // expression — that agreement is what makes the claim key work at
            // all, and it is also what the wait below is anchored to.
            const slots = schedulers.map(s => s.getJob(coordinated)!.nextRunAt!);
            expect(new Set(slots).size).toBe(1);

            const slot = new Date(slots[0]);
            // The scheduler clamps every delay to a 5s minimum, so a slot that
            // was moments away when start() ran fires slightly late. Wait past
            // that, and stop well before the following minute's slot.
            await sleep(Math.max(0, slot.getTime() - Date.now()) + 12_000);
            schedulers.forEach(s => s.stop());

            expect(coordinatedRuns).toBe(1);
            expect(uncoordinatedRuns).toBe(INSTANCES);

            // …and the persisted trail agrees with the counters.
            expect(await countLogs(coordinated)).toBe(1);
            expect(await countLogs(uncoordinated)).toBe(INSTANCES);

            const { rows } = await inspector.query(
                "SELECT slot FROM rebase.cron_claims WHERE job_id = $1", [coordinated]
            );
            expect(rows).toHaveLength(1);
            expect(new Date(rows[0].slot).toISOString()).toBe(slot.toISOString());
        }, 150_000);
    });
});
