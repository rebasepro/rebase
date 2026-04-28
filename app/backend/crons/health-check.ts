import type { CronJobDefinition } from "@rebasepro/types";

/**
 * Example cron job: logs a heartbeat every minute.
 *
 * This file is auto-discovered by Rebase and registered as cron job
 * "health-check". The schedule uses standard 5-field cron syntax.
 *
 * Visible in the Studio under Automation → Cron Jobs.
 */
const job: CronJobDefinition = {
    schedule: "*/5 * * * *",
    name: "System Health Check",
    description: "Periodically logs system health metrics.",
    async handler(ctx) {
        ctx.log("Running health check...");

        const uptime = process.uptime();
        const memUsage = process.memoryUsage();

        ctx.log(`Uptime: ${Math.round(uptime)}s`);
        ctx.log(`Heap used: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
        ctx.log(`RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);

        // Perform a query using the RebaseClient SDK
        ctx.log("Pinging database via SDK...");
        let authorCount = 0;
        try {
            const res = await ctx.client.data.authors.find({ limit: 1 });
            authorCount = res.meta?.total || 0;
            ctx.log(`SDK query successful. Authors found: ${authorCount}`);
        } catch (e: any) {
            ctx.log(`SDK query failed: ${e.message}`);
        }

        return {
            uptimeSeconds: Math.round(uptime),
            heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
            rssMB: Math.round(memUsage.rss / 1024 / 1024),
            authorCount,
            timestamp: new Date().toISOString(),
        };
    },
};

export default job;
