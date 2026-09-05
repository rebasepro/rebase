import { defineCron } from "@rebasepro/server";

/**
 * Periodically wipes and reseeds every demo collection so the public
 * demo always returns to a known, clean state after visitors edit it.
 *
 * Runs entirely inside the Rebase server via the built-in cron scheduler —
 * no external scheduler (Cloud Scheduler, GitHub Actions) is involved.
 *
 * NOTE: the in-process scheduler only ticks while a server instance is
 * alive. On Cloud Run this requires --min-instances=1 (see
 * tooling/scripts/deploy-demo.sh); with scale-to-zero the instance sleeps and
 * this job will not fire.
 */
export default defineCron({
    name: "Reset demo data",
    // Top of every hour. Adjust the expression to change the cadence.
    schedule: "0 * * * *",
    description: "Truncates and reseeds all demo collections back to their pristine seed.",
    // A full reseed (truncate + ~1500 posts, orders, customers, tickets, images) can take a while.
    timeoutSeconds: 600,

    async handler({ log }) {
        // Imported here, not at module scope. A cron file is read twice: once
        // by the scheduler, which has the deployment's environment, and once by
        // `rebase resources`, which is a build step and has none. The seeder
        // reaches `env.ts`, which validates `DATABASE_URL` at import — so a
        // top-level import made the graph underivable on any machine without a
        // `.env`, CI included. It also kept the whole seeder and its Postgres
        // connection factory out of every boot that only registers this job.
        const { runSeed } = await import("../src/seed.js");
        log("Resetting demo data — truncating and reseeding all collections…");
        await runSeed();
        log("Demo data reset complete.");
        return { reseeded: true };
    },
});
