/**
 * The cron claim retention sweep against a real Postgres (PGlite).
 *
 * A claim is the only record that a slot already ran, and the catch-up path at
 * boot re-runs the most recent slot in its window unless a claim says
 * otherwise. So the sweep that keeps `rebase.cron_claims` small must never
 * delete the claim a catch-up could still ask about: a monthly job with a
 * 31-day catch-up window, run on the 1st, redeployed on the 10th, used to have
 * its claim swept (older than seven days) and then re-run by the very boot that
 * swept it.
 *
 * The unit tests for the store record SQL text; whether a `DELETE` keeps the
 * right row is the database's answer, so it is asked of one here.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { DataDriver } from "@rebasepro/types";
import { createCronStore, type CronStore } from "../../server/src/cron/cron-store";
import { CronScheduler } from "../../server/src/cron/cron-scheduler";

/**
 * A driver whose SQL escape hatch is a real database. Parameterised
 * statements go through the extended protocol; the store's parameterless DDL
 * includes multi-statement blocks, which only the simple protocol accepts.
 */
function pgliteDriver(db: PGlite): DataDriver {
    return {
        key: "postgres",
        admin: {
            async executeSql(sql: string, options?: { params?: unknown[] }) {
                if (options?.params) {
                    return (await db.query(sql, options.params)).rows as Record<string, unknown>[];
                }
                const results = await db.exec(sql);
                return (results[results.length - 1]?.rows ?? []) as Record<string, unknown>[];
            }
        }
    } as unknown as DataDriver;
}

const DAY = 86_400_000;

let db: PGlite;

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    // The first boot: the tables exist before any claim is written.
    await createCronStore(pgliteDriver(db))!.ensureTable();
});

afterEach(async () => {
    await db.close();
});

/** A minute-aligned instant `days` ago, as a claim's slot is. */
function slotDaysAgo(days: number): Date {
    const slot = new Date(Date.now() - days * DAY);
    slot.setUTCSeconds(0, 0);
    return slot;
}

async function claim(jobId: string, slot: Date): Promise<void> {
    await db.query(
        "INSERT INTO rebase.cron_claims (job_id, slot, claimed_at) VALUES ($1, $2, $3)",
        [jobId, slot.toISOString(), new Date(slot.getTime() + 1_000).toISOString()]
    );
}

async function claimedSlots(jobId: string): Promise<string[]> {
    const { rows } = await db.query<{ slot: Date }>(
        "SELECT slot FROM rebase.cron_claims WHERE job_id = $1 ORDER BY slot",
        [jobId]
    );
    return rows.map(r => new Date(r.slot).toISOString());
}

/** A redeploy: a fresh store, and the boot-time `ensureTable` that sweeps. */
async function redeploy(): Promise<CronStore> {
    const store = createCronStore(pgliteDriver(db))!;
    await store.ensureTable();
    return store;
}

describe("the claim retention sweep", () => {
    it("keeps a job's most recent claim however old it is", async () => {
        const slot = slotDaysAgo(9);
        await claim("monthly-invoices", slot);

        await redeploy();

        expect(await claimedSlots("monthly-invoices")).toEqual([slot.toISOString()]);
    });

    it("still sweeps the older claims behind it", async () => {
        const older = slotDaysAgo(40);
        const old = slotDaysAgo(20);
        const latest = slotDaysAgo(9);
        for (const slot of [older, old, latest]) await claim("monthly-invoices", slot);
        // Another job's history is its own: its latest claim survives too.
        const otherLatest = slotDaysAgo(12);
        await claim("weekly-digest", slotDaysAgo(19));
        await claim("weekly-digest", otherLatest);

        await redeploy();

        expect(await claimedSlots("monthly-invoices")).toEqual([latest.toISOString()]);
        expect(await claimedSlots("weekly-digest")).toEqual([otherLatest.toISOString()]);
    });

    it("keeps the latest real claim when a stranded future claim is released", async () => {
        // The future-slot sweep drops a claim no slot has reached yet. If it
        // ran second, the retention sweep would have kept that future claim as
        // the job's latest, swept the real one, and left the job with neither.
        const latest = slotDaysAgo(9);
        await claim("monthly-invoices", latest);
        await claim("monthly-invoices", slotDaysAgo(-3));

        await redeploy();

        expect(await claimedSlots("monthly-invoices")).toEqual([latest.toISOString()]);
    });
});

describe("a catch-up after a redeploy", () => {
    it("does not re-run a slot that ran before the retention period", async () => {
        const slot = slotDaysAgo(9);
        await claim("monthly-invoices", slot);

        const store = await redeploy();

        // Record each claim answer, so the test waits for the catch-up to
        // have asked rather than for an arbitrary amount of time.
        const answers: boolean[] = [];
        const scheduler = new CronScheduler();
        scheduler.setStore({
            ...store,
            tryClaimRun: async (jobId, slotIso) => {
                const won = await store.tryClaimRun!(jobId, slotIso);
                answers.push(won);
                return won;
            }
        });
        let runs = 0;
        scheduler.registerJobs([{
            id: "monthly-invoices",
            definition: {
                schedule: `${slot.getUTCMinutes()} ${slot.getUTCHours()} ${slot.getUTCDate()} * *`,
                timezone: "UTC",
                catchUpWindowSeconds: 31 * 86_400,
                handler: async () => { runs++; }
            }
        }]);
        scheduler.start();
        try {
            for (let i = 0; i < 200 && answers.length === 0; i++) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        } finally {
            scheduler.stop();
        }

        expect(answers).toEqual([false]);
        expect(runs).toBe(0);
    });
});
